"""Real HTTP A/B throughput with business validation, true latency quantiles.

Run only after both independently seeded sources have frozen. No tracing is
enabled. Source hashing is outside timed intervals; every error is counted.
"""
import argparse
import asyncio
import ctypes
from datetime import datetime, timezone
import hashlib
from importlib import metadata, util
import json
import math
import os
from pathlib import Path
import platform
import sqlite3
import time
import zlib

import httpx


def source_hash(root):
    root = Path(root)
    digest = hashlib.sha256()
    # HTTP backend timings do not load frontend code or npm dependencies.
    paths = list((root / 'backend/app').rglob('*.py')) + [root / 'backend/requirements.txt']
    for path in sorted(p for p in paths if p.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def quantile(values, fraction):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)] if ordered else None


def dependency_fingerprints():
    """Fingerprint shared installed code, without importing app/SDK modules."""
    result = {}
    for module, distribution in (
        ('fastapi', 'fastapi'), ('starlette', 'starlette'), ('anyio', 'anyio'),
        ('uvicorn', 'uvicorn'), ('sqlalchemy', 'SQLAlchemy'), ('httpx', 'httpx'),
        ('httpcore', 'httpcore'), ('h11', 'h11'), ('pydantic', 'pydantic'),
        ('pydantic_core', 'pydantic_core'), ('orjson', 'orjson'), ('lizysdk', 'basekit'),
    ):
        spec = util.find_spec(module)
        if spec is None:
            raise RuntimeError(f'Missing benchmark dependency: {module}')
        roots = [Path(path) for path in (spec.submodule_search_locations or ())]
        paths = ([(root, path) for root in roots for path in root.rglob('*')
                  if path.is_file() and path.suffix.lower() in {'.py', '.pyd', '.so', '.dll'}]
                 if roots else [(Path(spec.origin).parent, Path(spec.origin))])
        digest = hashlib.sha256()
        for root, path in sorted(paths, key=lambda pair: str(pair[1])):
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
        try:
            version = metadata.version(distribution)
        except metadata.PackageNotFoundError:
            version = None
        result[module] = {'version': version, 'origin': spec.origin,
                          'files': len(paths), 'sha256': digest.hexdigest()}
    result['zlib'] = {'origin': util.find_spec('zlib').origin,
                      'compile_version': zlib.ZLIB_VERSION,
                      'runtime_version': zlib.ZLIB_RUNTIME_VERSION}
    return result


def host_cpu_times():
    """Read whole-host counters without starting a sampling thread or process."""
    if os.name != 'nt':
        return None
    idle, kernel, user = (ctypes.c_ulonglong() for _ in range(3))
    if not ctypes.windll.kernel32.GetSystemTimes(
            ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        return None
    return idle.value, kernel.value + user.value


def business_value(name, data):
    """Ignore additive metadata, retain complete selected business rows/totals."""
    if name == 'subs_trend':
        rows = data['trend']
        return {'points': len(rows), 'totals': [row.get('total', row.get('amount')) for row in rows]}
    if name == 'logs_histogram':
        return {'total': data.get('total'), 'totals': data['totals'],
                'bucket_totals': [bucket['total'] for bucket in data['buckets']]}
    if name == 'portal_layout':
        return {'groups': [{'name': group['name'], 'cards': group['cards']} for group in data['groups']]}
    if name == 'gamemap_board':
        return {'nodes': data['nodes'], 'relations': data['relations']}
    if isinstance(data, list):
        return {'rows': len(data), 'total': len(data),
                'ids': [_row_id(row) for row in data]}
    if isinstance(data, dict):
        for key in ('items', 'logs', 'entries', 'connections'):
            if isinstance(data.get(key), list):
                rows = data[key]
                return {'rows': len(rows), 'total': data.get('total', len(rows)),
                        'ids': [_row_id(row) for row in rows]}
        if name == 'conf_get':
            return {'key': data.get('key'), 'value': data.get('data')}
        if name == 'apihub_invoke':
            return data
        # Status/aggregates: structural nonempty successful work is still required.
        return {'keys': sorted(data), 'empty': not bool(data)}
    raise AssertionError(f'{name}: unsupported business payload {type(data)}')


def _row_id(row):
    for key in ('id', 'key', 'steamid', 'name'):
        if row.get(key) is not None:
            return row[key]
    raise AssertionError(f'Fixture row has no business identifier: {sorted(row)}')


def cases(fixture):
    ids = fixture
    scenarios = {
        'blog_list': f"/api/posts?workspace_id={ids['workspace_id']}&page_size=100&page=1",
        'blog_backlinks': f"/api/posts/id/{ids['post_id']}/backlinks",
        'assets_list': '/api/assets/items?page_size=100',
        'assets_categories': '/api/assets/categories',
        'bookmarks_list': '/api/bookmarks/items?limit=50',
        'assets_history': f"/api/assets/items/{ids['asset_id']}/versions?page=1&page_size=20",
        'diary_page': f"/api/diary/entries?journal_id={ids['journal_id']}&limit=50&include_content=0",
        'todo_tasks': '/api/todo/tasks?status=active',
        'practice_list': '/api/practice/problems?page_size=50',
        'subs_members': '/api/subs/members?page_size=100',
        'subs_trend': '/api/subs/stats/trend?start_date=2026-01-01&end_date=2026-12-31&granularity=month',
        'portal_layout': '/api/home/layout',
        'gamemap_board': f"/api/gamemap/games/{ids['game_id']}/boards/chapters/{ids['chapter_id']}",
        'vault_items': '/api/vault/items',
        'pwsvc_projects': '/api/pwsvc/projects',
    }
    if 'platform' in fixture:
        scenarios.update(fixture['platform']['endpoints'])
    return scenarios


async def run_case(client, name, url, duration, concurrency, expected, fixture):
    headers = ({'Authorization': f"Bearer {fixture['platform']['token']}"}
               if name == 'apihub_invoke' else {})
    method = 'POST' if name == 'apihub_invoke' else 'GET'
    async def request():
        response = await client.request(method, url, headers=headers)
        body = response.json()
        valid = (body.get('success') is True or (name == 'apihub_invoke' and
                 body.get('code') == 0 and body.get('meta', {}).get('upstream_status') == 200))
        if not response.is_success or not valid:
            raise AssertionError(f'{response.status_code}: {body.get("message", "invalid envelope")}')
        value = business_value(name, body['data'])
        if expected is not None and value != expected:
            raise AssertionError(f'business result changed: {value!r} != {expected!r}')
        return value, len(response.content), response.num_bytes_downloaded
    for _ in range(3):
        value, _, _ = await request()
        if expected is None:
            expected = value
    elapsed_ms, errors = [], []
    count = 0
    byte_count = 0
    encoded_byte_count = 0
    cpu_start = host_cpu_times()
    start = time.perf_counter()
    deadline = start + duration
    async def worker():
        nonlocal count, byte_count, encoded_byte_count
        while time.perf_counter() < deadline:
            began = time.perf_counter()
            try:
                _, size, encoded_size = await request()
                elapsed_ms.append((time.perf_counter() - began) * 1000)
                count += 1
                byte_count += size
                encoded_byte_count += encoded_size
            except Exception as error:
                errors.append(f'{type(error).__name__}: {str(error)[:300]}')
    await asyncio.gather(*(worker() for _ in range(concurrency)))
    elapsed = time.perf_counter() - start
    cpu_end = host_cpu_times()
    cpu_busy = (100 * (1 - (cpu_end[0] - cpu_start[0]) / (cpu_end[1] - cpu_start[1]))
                if cpu_start and cpu_end and cpu_end[1] > cpu_start[1] else None)
    return {'success': count, 'errors': len(errors), 'error_examples': list(dict.fromkeys(errors))[:5],
            'seconds': elapsed, 'business_rps': count / elapsed, 'p50_ms': quantile(elapsed_ms, .5),
            'p95_ms': quantile(elapsed_ms, .95), 'bytes_per_success': byte_count / count if count else None,
            'encoded_body_bytes_per_success': encoded_byte_count / count if count else None,
            'host_cpu_busy_percent': cpu_busy,
            'business': expected}


async def main(args):
    fixture = json.loads(Path(args.fixture).read_text(encoding='utf-8'))
    output = {'protocol': {'rounds': args.rounds, 'seconds': args.seconds, 'concurrency': args.concurrency,
                           'started_at': datetime.now(timezone.utc).isoformat(),
                           'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                                           'processor': os.environ.get('PROCESSOR_IDENTIFIER', platform.processor()),
                                           'logical_cpus': os.cpu_count(), 'sqlite': sqlite3.sqlite_version,
                                           'httpx': httpx.__version__},
                           'fixture_sha256': hashlib.sha256(Path(args.fixture).read_bytes()).hexdigest(),
                           'benchmark_tool_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                           'dependencies': dependency_fingerprints(),
                           'fixture_tools_sha256': {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                                                   for name in ('optimization_qa_server.py', 'optimization_knowledge_fixture.py', 'platform_fixtures.py')},
                           'warmup_requests': 3, 'auth': 'session cookie', 'cache': 'warm',
                           'latency': 'nearest-rank distribution of successful end-to-end requests',
                           'source_scope': 'backend/app/**/*.py and backend/requirements.txt',
                           'bytes': 'decoded response body bytes; normal gzip negotiation',
                           'encoded_bytes': 'HTTPX num_bytes_downloaded: encoded response body only; excludes HTTP headers and protocol framing',
                           'source_hashes': {name: source_hash(root) for name, root in
                                             [('before', args.before_source), ('after', args.after_source)]}},
              'results': {}}
    clients = {}
    try:
        for name, url in [('before', args.before), ('after', args.after)]:
            client = httpx.AsyncClient(base_url=url, trust_env=False, timeout=20,
                limits=httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency))
            response = await client.post('/api/auth/login', json={
                'username': 'mindmap-qa', 'password': 'qa-only-isolated-db'})
            response.raise_for_status()
            clients[name] = client
        for case, url in cases(fixture).items():
            if args.only and case not in args.only.split(','):
                continue
            expected = None
            output['results'][case] = {'url': url, 'before': [], 'after': []}
            for round_index in range(args.rounds):
                for name in (('before', 'after') if round_index % 2 == 0 else ('after', 'before')):
                    result = await run_case(clients[name], case, url, args.seconds, args.concurrency, expected, fixture)
                    expected = result['business']
                    output['results'][case][name].append(result)
                    print(json.dumps({'case': case, 'variant': name, 'round': round_index + 1,
                                      'rps': round(result['business_rps'], 2), 'errors': result['errors']}), flush=True)
            Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        for name, root in [('before', args.before_source), ('after', args.after_source)]:
            if source_hash(root) != output['protocol']['source_hashes'][name]:
                raise AssertionError(f'{name} source changed while benchmark ran')
        output['source_unchanged'] = True
        if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != output['protocol']['benchmark_tool_sha256']:
            raise AssertionError('Benchmark tool changed while benchmark ran')
        output['tool_unchanged'] = True
        if hashlib.sha256(Path(args.fixture).read_bytes()).hexdigest() != output['protocol']['fixture_sha256']:
            raise AssertionError('Benchmark fixture changed while benchmark ran')
        for name, digest in output['protocol']['fixture_tools_sha256'].items():
            if hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() != digest:
                raise AssertionError(f'Fixture tool changed while benchmark ran: {name}')
        output['fixtures_unchanged'] = True
        if dependency_fingerprints() != output['protocol']['dependencies']:
            raise AssertionError('Shared installed dependencies changed while benchmark ran')
        output['dependencies_unchanged'] = True
        output['protocol']['finished_at'] = datetime.now(timezone.utc).isoformat()
    finally:
        await asyncio.gather(*(client.aclose() for client in clients.values()))
        Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', default='http://127.0.0.1:60117')
    parser.add_argument('--after', default='http://127.0.0.1:60119')
    parser.add_argument('--before-source', required=True)
    parser.add_argument('--after-source', required=True)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--seconds', type=float, default=2.0)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--only')
    asyncio.run(main(parser.parse_args()))
