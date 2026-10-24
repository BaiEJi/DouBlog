"""Small, offline compression-level diagnostic; never an HTTP throughput test.

Run only after the coordinator releases the formal measurement window. Fetches
seven validated QA JSON bodies from http://127.0.0.1:60119, then closes HTTP before
compressing. Default: 20 measured compressions/level/case, divided into four
rotating-order rounds. No application imports, mutations, workers or service
configuration changes. GzipFile remains an optional historical reference;
installed Starlette 1.7 uses the default starlette-zlib compression core.

Example (with the project's normal Python/PYTHONPATH environment):
    python backend/tools/optimization_gzip_poc.py --fixture PATH --output PATH
Both paths must be inside this repository's .ui-qa directory. Optional
--expected-data-dir asserts the precise isolated database directory as well.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
from importlib import metadata
from io import BytesIO
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import time
from urllib.parse import urljoin, urlsplit
import zlib

import httpx


ROOT = Path(__file__).resolve().parents[2]
QA_ROOT = ROOT / '.ui-qa'
BASE_URL = 'http://127.0.0.1:60119'
LEVELS = (1, 4, 5, 6)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def qa_path(value, *, exists=False):
    path = Path(value).resolve()
    if not path.is_relative_to(QA_ROOT.resolve()):
        raise ValueError('Paths must stay inside this repository .ui-qa directory')
    if exists and not path.is_file():
        raise ValueError(f'Expected an existing QA file: {path}')
    return path


def source_hash():
    digest = hashlib.sha256()
    files = list((ROOT / 'backend/app').rglob('*.py'))
    files.append(ROOT / 'backend/requirements.txt')
    for path in sorted(files):
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def checked_url(path):
    # An absolute or scheme-relative URL in a fixture must never escape QA.
    url = urljoin(BASE_URL + '/', path)
    parts = urlsplit(url)
    if (parts.scheme != 'http' or parts.hostname != '127.0.0.1'
            or parts.port != 60119 or parts.username or parts.password
            or not parts.path.startswith('/api/') or parts.fragment):
        raise ValueError('Only http://127.0.0.1:60119/api/ requests are allowed')
    return url


def request_guard(request):
    checked_url(str(request.url))
    if request.method != 'GET' and not (
            request.method == 'POST' and request.url.path == '/api/auth/login'):
        raise ValueError('Only QA login POST and read-only GET requests are allowed')


def envelope(response):
    response.raise_for_status()
    body = response.json()
    if (not isinstance(body, dict) or body.get('success') is not True
            or body.get('code') != 200 or 'data' not in body):
        raise ValueError(f'Invalid successful API envelope: HTTP {response.status_code}')
    return body['data']


def rows_from(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ('items', 'tasks', 'problems', 'entries'):
            if isinstance(data.get(key), list):
                return data[key]
    raise ValueError('Expected a list of business rows, not an empty envelope')


def validate_payload(name, data, fixture):
    expected_rows = {'todo_tasks': 1000, 'vault_items': 1000,
                     'practice_list': 50, 'pwsvc_projects': 12, 'conf_list': 50}
    if name in expected_rows:
        rows = rows_from(data)
        if len(rows) != expected_rows[name] or not all(isinstance(row, dict) for row in rows):
            raise ValueError(f'{name}: expected exactly {expected_rows[name]} business rows')
        keys = [row.get('id', row.get('key')) for row in rows]
        if any(key is None for key in keys) or len({str(key) for key in keys}) != len(rows):
            raise ValueError(f'{name}: missing or duplicate business identifiers')
        result = {'rows': len(rows), 'ids_sha256': sha256(json.dumps(keys).encode())}
        if isinstance(data, dict) and 'total' in data:
            result['total'] = data['total']
        if name == 'conf_list' and result.get('total') != fixture['platform']['counts']['conf']:
            raise ValueError('conf_list: fixture total changed')
        return result
    if name == 'gamemap_board':
        if (not isinstance(data, dict) or not isinstance(data.get('nodes'), list)
                or not data['nodes'] or not isinstance(data.get('relations'), list)):
            raise ValueError('gamemap_board: missing populated nodes/relations')
        return {'nodes': len(data['nodes']), 'relations': len(data['relations'])}
    if name == 'logs_histogram':
        expected = fixture['platform']['counts']['logs']
        buckets = data.get('buckets') if isinstance(data, dict) else None
        if (not isinstance(buckets, list) or len(buckets) != 60
                or data.get('total') != expected
                or sum(bucket['total'] for bucket in buckets) != expected
                or not isinstance(data.get('totals'), dict)):
            raise ValueError('logs_histogram: expected all fixture rows in 60 buckets')
        return {'total': expected, 'buckets': len(buckets), 'totals': data['totals']}
    raise ValueError(f'Unknown case: {name}')


def scenarios(fixture):
    platform_cases = fixture['platform']['endpoints']
    for name, expected_path in (('logs_histogram', '/api/v1/logs/histogram'),
                                ('conf_list', '/api/confcenter/entries')):
        if urlsplit(checked_url(platform_cases[name])).path != expected_path:
            raise ValueError(f'{name}: fixture endpoint differs from the read-only case')
    return {
        'todo_tasks': '/api/todo/tasks?status=active',
        'vault_items': '/api/vault/items',
        'practice_list': '/api/practice/problems?page_size=50',
        'gamemap_board': (f"/api/gamemap/games/{int(fixture['game_id'])}"
                          f"/boards/chapters/{int(fixture['chapter_id'])}"),
        'pwsvc_projects': '/api/pwsvc/projects',
        'logs_histogram': platform_cases['logs_histogram'],
        'conf_list': platform_cases['conf_list'],
    }


def server_state(client, expected_data_dir=None):
    data = envelope(client.get(checked_url('/api/admin/database')))
    directory = Path(data['data_dir']).resolve()
    if not directory.is_relative_to(QA_ROOT.resolve()):
        raise ValueError('The running server is not using an isolated .ui-qa database')
    if expected_data_dir is not None and directory != expected_data_dir:
        raise ValueError('Running server data_dir differs from --expected-data-dir')
    if data.get('closed') or data.get('pending_restart'):
        raise ValueError('QA server is closed or waiting for restart')
    return {'data_dir': str(directory), 'identity': data['identity'],
            'generation': data['generation'], 'backend': data['backend']}


def capture_payloads(fixture, expected_data_dir):
    payloads, captures = {}, {}
    # Explicit gzip negotiation permits recording the actual encoded input size;
    # HTTPX's response.content is decoded. No redirects or environment proxies.
    with httpx.Client(base_url=BASE_URL, trust_env=False, follow_redirects=False,
                      timeout=20, headers={'Accept-Encoding': 'gzip'},
                      event_hooks={'request': [request_guard]}) as client:
        envelope(client.post(checked_url('/api/auth/login'), json={
            'username': 'mindmap-qa', 'password': 'qa-only-isolated-db'}))
        before = server_state(client, expected_data_dir)
        client.headers['X-Expected-Database-Identity'] = before['identity']
        for name, path in scenarios(fixture).items():
            response = client.get(checked_url(path))
            data = envelope(response)
            for header, key in (('x-database-identity', 'identity'),
                                ('x-database-generation', 'generation')):
                if response.headers.get(header) != before[key]:
                    raise ValueError(f'{name}: response changed database {key}')
            if response.headers.get('content-type', '').partition(';')[0] != 'application/json':
                raise ValueError(f'{name}: expected JSON content type')
            payload = response.content
            if len(payload) < 1024:
                raise ValueError(f'{name}: body falls below current 1024-byte gzip threshold')
            captures[name] = {
                'url': path, 'business': validate_payload(name, data, fixture),
                'decoded_bytes': len(payload), 'decoded_sha256': sha256(payload),
                'captured_content_encoding': response.headers.get('content-encoding'),
                'captured_encoded_body_bytes': response.num_bytes_downloaded,
                'captured_content_length': response.headers.get('content-length'),
                'starlette_large_chunk_offload_threshold_reached': len(payload) >= 128 * 1024,
            }
            payloads[name] = payload
        after = server_state(client, expected_data_dir)
        if after != before:
            raise ValueError('QA database changed during capture')
    return payloads, captures, before


def compress(payload, level, adapter):
    if adapter == 'starlette-zlib':
        compressor = zlib.compressobj(level, zlib.DEFLATED, 16 + zlib.MAX_WBITS)
        return compressor.compress(payload) + compressor.flush()
    buffer = BytesIO()
    # Exactly one write and close; retain GzipFile's default timestamp/header.
    with gzip.GzipFile(fileobj=buffer, mode='wb', compresslevel=level) as stream:
        stream.write(payload)
    return buffer.getvalue()


def measured_batch(payload, level, adapter, iterations):
    samples, outputs = [], []
    batch_wall_start, batch_thread_start = time.perf_counter_ns(), time.thread_time_ns()
    for _ in range(iterations):
        wall_start, thread_start = time.perf_counter_ns(), time.thread_time_ns()
        compressed = compress(payload, level, adapter)
        thread_ns = time.thread_time_ns() - thread_start
        wall_ns = time.perf_counter_ns() - wall_start
        samples.append({'wall_ns': wall_ns, 'thread_cpu_ns': thread_ns,
                        'compressed_bytes': len(compressed), 'decoded_bytes': len(payload)})
        outputs.append(compressed)
    batch_thread_ns = time.thread_time_ns() - batch_thread_start
    batch_wall_ns = time.perf_counter_ns() - batch_wall_start
    # Decompression, byte equality and hashing never enter timed intervals.
    for compressed, sample in zip(outputs, samples):
        decoded = gzip.decompress(compressed)
        if decoded != payload:
            raise ValueError('Gzip decompression differs byte-for-byte from captured JSON')
        sample['roundtrip_exact'] = True
        sample['decompressed_bytes'] = len(decoded)
    return {'iterations': iterations, 'batch_wall_ns': batch_wall_ns,
            'batch_thread_cpu_ns': batch_thread_ns, 'samples': samples}


def package_metadata():
    packages = {}
    for name in ('httpx', 'starlette', 'anyio', 'uvicorn'):
        try:
            distribution = metadata.distribution(name)
            packages[name] = {'version': distribution.version}
            if name == 'starlette':
                source = Path(distribution.locate_file('starlette/middleware/gzip.py'))
                packages[name]['gzip_source_sha256'] = sha256(source.read_bytes())
                packages[name]['gzip_source_mtime_ns'] = source.stat().st_mtime_ns
                packages[name]['gzip_source_path'] = str(source.resolve())
        except metadata.PackageNotFoundError:
            packages[name] = {'version': None}
    for name, module in (('stdlib_gzip', gzip), ('zlib_extension', zlib)):
        module_file = getattr(module, '__file__', None)
        if module_file:
            source = Path(module_file)
            packages[name] = {'path': str(source.resolve()),
                              'sha256': sha256(source.read_bytes()),
                              'mtime_ns': source.stat().st_mtime_ns}
        else:
            packages[name] = {'origin': getattr(module.__spec__, 'origin', None),
                              'sha256': None, 'mtime_ns': None,
                              'file_hash_not_applicable': 'module has no separate file'}
    return packages


def nearest_rank(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def summarize(rounds, payload_size):
    samples = [sample for batch in rounds for sample in batch['samples']]
    sizes = {sample['compressed_bytes'] for sample in samples}
    if len(sizes) != 1:
        raise ValueError('Compressed size changed for identical input and level')
    compressed_size = sizes.pop()
    return {
        'iterations': len(samples), 'compressed_bytes': compressed_size,
        'decoded_bytes': payload_size, 'compressed_to_decoded_ratio': compressed_size / payload_size,
        'wall_median_ns': statistics.median(sample['wall_ns'] for sample in samples),
        'wall_p95_ns': nearest_rank([sample['wall_ns'] for sample in samples], .95),
        'sample_thread_cpu_ns_raw': [sample['thread_cpu_ns'] for sample in samples],
        'sample_thread_zero_count': sum(sample['thread_cpu_ns'] == 0 for sample in samples),
        'batch_wall_ns_total': sum(batch['batch_wall_ns'] for batch in rounds),
        'batch_thread_cpu_ns_total': sum(batch['batch_thread_cpu_ns'] for batch in rounds),
        'roundtrip_exact': all(sample['roundtrip_exact'] for sample in samples),
    }


def main(args):
    fixture_path = qa_path(args.fixture, exists=True)
    output_path = qa_path(args.output)
    if output_path.exists():
        raise ValueError('Refusing to overwrite an existing diagnostic result')
    if not 1 <= args.iterations <= 20 or not 1 <= args.rounds <= args.iterations:
        raise ValueError('Use 1..20 total measured iterations/level; rounds must fit iterations')
    fixture_bytes = fixture_path.read_bytes()
    fixture = json.loads(fixture_bytes)
    expected_dir = Path(args.expected_data_dir).resolve() if args.expected_data_dir else None
    if expected_dir is not None and not expected_dir.is_relative_to(QA_ROOT.resolve()):
        raise ValueError('--expected-data-dir must be inside .ui-qa')
    tool_sha, app_sha = sha256(Path(__file__).read_bytes()), source_hash()
    output = {'complete': False, 'protocol': {
        'started_at': datetime.now(timezone.utc).isoformat(), 'base_url': BASE_URL,
        'adapter': args.adapter, 'levels': list(LEVELS), 'baseline_level': 6,
        'iterations_per_level_per_case': args.iterations, 'rounds': args.rounds,
        'warmup_per_level_per_case': 2, 'level_orders': [],
        'fixture_sha256': sha256(fixture_bytes), 'tool_sha256': tool_sha,
        'app_source_sha256': app_sha, 'source_scope': 'backend/app/**/*.py + backend/requirements.txt',
        'dependency_guard_scope': ('httpx/starlette/anyio/uvicorn distribution versions; '
                                   'actual Starlette gzip.py, stdlib gzip.py and any file-backed zlib '
                                   'SHA/mtime; built-in zlib origin recorded without a file hash'),
        'environment': {'python': platform.python_version(), 'implementation': platform.python_implementation(),
                        'platform': platform.platform(), 'logical_cpus': os.cpu_count(),
                        'processor': os.environ.get('PROCESSOR_IDENTIFIER', platform.processor()),
                        'zlib_compile': zlib.ZLIB_VERSION, 'zlib_runtime': zlib.ZLIB_RUNTIME_VERSION,
                        'switch_interval_seconds': sys.getswitchinterval(),
                        'thread_clock_resolution_seconds': time.get_clock_info('thread_time').resolution,
                        'perf_clock_resolution_seconds': time.get_clock_info('perf_counter').resolution,
                        'packages': package_metadata()},
        'timing_scope': 'compression allocation + compress + final flush/close; no HTTP/ASGI/offload',
        'thread_cpu_caveat': ('Raw samples may be zero/quantized on Windows; batch cumulative counters '
                              'are retained including loop/timer bookkeeping, excluding decompression. '
                              'No per-sample CPU speedup is inferred from zero values.'),
        'limitations': ['Only captured fixed QA JSON; no HTTP RPS claim',
                        'Does not simulate AnyIO capacity, worker queueing, ASGI headers or streaming',
                        'Current minimum_size=1024; large-chunk offload threshold=128KiB',
                        'GzipFile optional reference is not installed Starlette 1.7 compression core'],
    }, 'results': {}}
    try:
        payloads, captures, state = capture_payloads(fixture, expected_dir)
        output['server'] = state
        # All subsequent work is offline. No payloads, cookies or credentials are persisted.
        for name, payload in payloads.items():
            result = {'capture': captures[name], 'levels': {str(level): [] for level in LEVELS}}
            output['results'][name] = result
            for level in LEVELS:
                for _ in range(2):
                    if gzip.decompress(compress(payload, level, args.adapter)) != payload:
                        raise ValueError('Warmup roundtrip mismatch')
            for index in range(args.rounds):
                order = list(LEVELS[index % len(LEVELS):] + LEVELS[:index % len(LEVELS)])
                if name == next(iter(payloads)):
                    output['protocol']['level_orders'].append(order)
                count = args.iterations // args.rounds + (index < args.iterations % args.rounds)
                for level in order:
                    batch = measured_batch(payload, level, args.adapter, count)
                    batch['round'] = index + 1
                    result['levels'][str(level)].append(batch)
            result['summary'] = {level: summarize(batches, len(payload))
                                 for level, batches in result['levels'].items()}
            reference = result['summary']['6']
            result['level_6_encoded_size_matches_capture'] = (
                reference['compressed_bytes'] == captures[name]['captured_encoded_body_bytes']
                if captures[name]['captured_content_encoding'] == 'gzip' else None)
            for summary in result['summary'].values():
                summary['relative_to_level_6'] = {
                    'wall_median_percent': (summary['wall_median_ns'] / reference['wall_median_ns'] - 1) * 100,
                    'encoded_bytes_percent': (summary['compressed_bytes'] / reference['compressed_bytes'] - 1) * 100,
                    # Windows short CPU intervals may be quantized even when
                    # nonzero; retain raw batch totals without a CPU speedup ratio.
                    'thread_cpu_ratio_omitted_due_to_clock_quantization': True,
                }
            print(json.dumps({'case': name, 'adapter': args.adapter,
                              'decoded_bytes': len(payload), 'roundtrip_exact': True}), flush=True)
        output['source_unchanged'] = source_hash() == app_sha
        output['tool_unchanged'] = sha256(Path(__file__).read_bytes()) == tool_sha
        output['dependency_metadata_after'] = package_metadata()
        output['dependencies_unchanged'] = (
            output['dependency_metadata_after'] == output['protocol']['environment']['packages'])
        if not all(output[key] for key in ('source_unchanged', 'tool_unchanged', 'dependencies_unchanged')):
            raise ValueError('Source or recorded shared dependency changed during diagnostic')
        output['complete'] = True
    except Exception as error:
        output['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        output['protocol']['finished_at'] = datetime.now(timezone.utc).isoformat()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--expected-data-dir')
    parser.add_argument('--adapter', choices=('starlette-zlib', 'gzipfile'), default='starlette-zlib')
    parser.add_argument('--iterations', type=int, default=20)
    parser.add_argument('--rounds', type=int, default=4)
    main(parser.parse_args())
