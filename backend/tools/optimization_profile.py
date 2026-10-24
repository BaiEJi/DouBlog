"""QA-only per-thread CPU/call diagnostic, never a throughput acceptance run.

Wrap the existing isolated QA launcher. Private control routes exist only on
60125/60127 and only in this process. Database workers retain SDK context and
Future/cancellation ownership. No application or installed dependency is edited.
Profiles use cProfile's elapsed timer; independent thread_time counters include
instrumentation cost. Neither metric proves production wall-time causation.
"""
import argparse
import cProfile
import hashlib
import json
from pathlib import Path
import pstats
import runpy
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / '.ui-qa'
parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--data-dir', required=True)
parser.add_argument('--port', type=int, choices=(60125, 60127), required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source, data_dir, output = (Path(value).resolve() for value in (args.source, args.data_dir, args.output))
assert source.is_relative_to(ROOT) and (source / 'app/main.py').is_file()
assert data_dir.is_relative_to(QA) and (data_dir / 'optimization-fixture.json').is_file()
assert output.is_relative_to(QA) and not output.exists()

# Imported before the helper starts uvicorn; this does not import app or change
# its settings. The helper applies its normal loopback/Steam/network guard.
import uvicorn
from lizysdk.pools.thread_pool import ThreadPool
from optimization_bench import dependency_fingerprints

original_run, original_submit = uvicorn.run, ThreadPool.submit
enabled = threading.Event()
lock = threading.Lock()
worker_profiles, worker_samples, captures = [], [], []
loop_profile = None
loop_started = None
active_mode = None


def source_hash():
    digest = hashlib.sha256()
    root = source.parent
    for path in sorted([*(source / 'app').rglob('*.py'), source / 'requirements.txt']):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


initial_hash = source_hash()
initial_dependencies = dependency_fingerprints()
initial_tool_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def submit(pool, fn, /, *fn_args, **fn_kwargs):
    if not enabled.is_set() or pool._name != 'doublog-db':
        return original_submit(pool, fn, *fn_args, **fn_kwargs)
    mode = active_mode
    submitted_at = time.perf_counter()

    def observed():
        profiler = cProfile.Profile() if mode == 'profile' else None
        began_cpu, began_wall = time.thread_time(), time.perf_counter()
        try:
            if profiler is not None:
                return profiler.runcall(fn, *fn_args, **fn_kwargs)
            return fn(*fn_args, **fn_kwargs)
        finally:
            sample = {'thread_cpu_ms': (time.thread_time() - began_cpu) * 1000,
                      'submit_to_start_ms': (began_wall - submitted_at) * 1000,
                      'wall_ms': (time.perf_counter() - began_wall) * 1000}
            with lock:
                worker_samples.append(sample)
                if profiler is not None:
                    worker_profiles.append(profiler)
    return original_submit(pool, observed)


def stats_rows(profilers):
    stats = None
    for profiler in profilers:
        if stats is None:
            stats = pstats.Stats(profiler)
        else:
            stats.add(profiler)
    if stats is None:
        return []
    rows = [{'file': filename, 'line': line, 'function': name, 'primitive_calls': cc,
             'calls': nc, 'self_elapsed_ms': tt * 1000, 'cumulative_elapsed_ms': ct * 1000}
            for (filename, line, name), (cc, nc, tt, ct, callers) in stats.stats.items()]
    return sorted(rows, key=lambda row: row['cumulative_elapsed_ms'], reverse=True)


def run(application, **kwargs):
    from fastapi import Request
    from app.shared.response import api_response
    ThreadPool.submit = submit

    async def start(request: Request):
        global loop_profile, loop_started, active_mode
        if enabled.is_set():
            return api_response(None, 409, 'Capture already active')
        active_mode = request.query_params.get('mode', 'timing')
        if active_mode not in ('timing', 'profile'):
            return api_response(None, 400, 'Unknown diagnostic mode')
        worker_profiles.clear()
        worker_samples.clear()
        loop_profile = cProfile.Profile() if active_mode == 'profile' else None
        loop_started = (time.thread_time(), time.perf_counter())
        enabled.set()
        if loop_profile is not None:
            loop_profile.enable()
        return api_response({'mode': active_mode})

    async def stop(request: Request):
        global loop_profile
        enabled.clear()
        if loop_profile is not None:
            loop_profile.disable()
        loop_cpu, loop_wall = time.thread_time() - loop_started[0], time.perf_counter() - loop_started[1]
        capture = {'name': request.query_params.get('name', ''), 'mode': active_mode,
                   'loop_thread_cpu_ms': loop_cpu * 1000, 'wall_ms': loop_wall * 1000,
                   'worker_tasks': len(worker_samples), 'worker_samples': list(worker_samples),
                   'worker_stats': stats_rows(worker_profiles),
                   'loop_stats': stats_rows([loop_profile]) if loop_profile is not None else []}
        captures.append(capture)
        assert source_hash() == initial_hash
        assert dependency_fingerprints() == initial_dependencies
        assert hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == initial_tool_hash
        output.write_text(json.dumps({'source_hash': initial_hash, 'source_unchanged': True,
            'tool_sha256': initial_tool_hash, 'tool_unchanged': True,
            'dependencies': initial_dependencies, 'dependencies_unchanged': True,
            'method': 'QA-only, instrumented CPU/calls; timing and profile passes distinct; no RPS acceptance claim',
            'captures': captures}, ensure_ascii=False, indent=2), encoding='utf8')
        return api_response({'capture': capture['name'], 'worker_tasks': capture['worker_tasks']})

    application.add_api_route('/__qa_profile/start', start, methods=['POST'])
    application.add_api_route('/__qa_profile/stop', stop, methods=['POST'])
    return original_run(application, **kwargs)


uvicorn.run = run
sys.argv = ['optimization_qa_server.py', '--source', str(source), '--data-dir', str(data_dir),
            '--port', str(args.port), '--seed', '--bench-extra', '--quiet']
runpy.run_path(str(Path(__file__).with_name('optimization_qa_server.py')), run_name='__main__')
