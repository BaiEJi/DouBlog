"""Loopback-only, business-checked comparison of APIHub transport candidates.

Run after source freeze, without other load tests. The shared optimization mock
must be listening at --url. This tool changes neither the database nor config.
"""
import argparse
import hashlib
from concurrent.futures import FIRST_COMPLETED, wait
import json
import math
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def compare(url, requests=1000, rounds=3, concurrency=(1, 16, 64)):
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('Only the local echo fixture is allowed')
    from app.apihub import pool as transport
    from app.shared.pools import get_pool
    # The experiment must never read an installation's outbound proxy config.
    transport.resolve_proxy = lambda *args: None
    results = []
    for workers in concurrency:
        for round_index in range(rounds):
            # Alternate order to expose warmup/order effects in the result.
            candidates = [('stdlib', transport.UpstreamPool), ('httpx', transport.HttpxCandidatePool)]
            if round_index % 2:
                candidates.reverse()
            for name, factory in candidates:
                client = factory()
                failures, durations = [], []
                def once(_):
                    start = time.perf_counter()
                    try:
                        response = client.request('GET', url, {}, {}, b'', 5)
                        body = json.loads(response.content)
                        if response.status != 200 or body != {'ok': True, 'fixture': 'local-only'}:
                            raise AssertionError('The echo business payload differs')
                        return time.perf_counter() - start, None
                    except Exception as error:
                        return time.perf_counter() - start, type(error).__name__
                try:
                    for index in range(min(32, requests)):
                        elapsed, error = once(index)
                        if error:
                            raise RuntimeError(f'{name} preflight failed: {error}')
                    executor = get_pool(f'apihub-transport-bench-{workers}', workers=workers)
                    start = time.perf_counter()
                    submitted = min(workers * 2, requests)
                    pending = {executor.submit(once, index) for index in range(submitted)}
                    while pending:
                        completed, pending = wait(pending, return_when=FIRST_COMPLETED)
                        for future in completed:
                            elapsed, error = future.result()
                            durations.append(elapsed)
                            if error:
                                failures.append(error)
                            if submitted < requests:
                                pending.add(executor.submit(once, submitted))
                                submitted += 1
                    seconds = time.perf_counter() - start
                    ordered = sorted(durations)
                    quantile = lambda fraction: ordered[max(0, math.ceil(len(ordered) * fraction) - 1)] * 1000
                    result = dict(transport=name, round=round_index + 1, concurrency=workers,
                        requests=requests, failures=len(failures), errors=sorted(set(failures)),
                        seconds=seconds, rps=(requests-len(failures))/seconds,
                        p50_ms=quantile(.5), p95_ms=quantile(.95), p99_ms=quantile(.99))
                    results.append(result)
                    print(json.dumps(result), flush=True)
                finally:
                    client.close_all()
    return {'url': url, 'results': results,
            'decision_gate': 'Production remains stdlib unless throughput, errors, semantics and the strict total deadline all pass.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:60115/echo')
    parser.add_argument('--requests', type=int, default=1000)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--concurrency', type=int, nargs='+', default=[1, 16, 64])
    parser.add_argument('--output', required=True)
    options = parser.parse_args()
    if not 1 <= options.requests <= 100000 or not 1 <= options.rounds <= 10 or any(n < 1 or n > 128 for n in options.concurrency):
        parser.error('requests 1..100000, rounds 1..10 and concurrency 1..128 are required')
    inputs = [Path(__file__), Path(__file__).resolve().parents[1] / 'app/apihub/pool.py']
    before = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
    result = compare(options.url, options.requests, options.rounds, options.concurrency)
    after = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
    if before != after:
        raise RuntimeError('Transport benchmark sources changed during measurement')
    result.update(source_hashes=before, source_unchanged=True)
    output = Path(options.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
