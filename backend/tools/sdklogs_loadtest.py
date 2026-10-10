"""
sdklogs 压力测试：子进程起隔离实例（临时 SQLite），真实 HTTP 打流量。

场景：
  A 单条摄入   POST /api/v1/logs          8 线程 × 250 条 = 2000 请求
  B 批量摄入   POST /api/v1/logs/batch    8 线程 × 30 批 × 200 条 = 48000 行
  C 查询       GET  /api/v1/logs          6 种过滤模式 × 100 次 × 4 线程

输出：stdout 摘要表 + backend/tools/reports/<tag>.json

用法：python tools/sdklogs_loadtest.py <tag>   # tag 如 baseline / optimized
"""
import json
import multiprocessing
import os
import random
import statistics
import sys
import tempfile
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import urlencode

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

AUTH = 'Basic ' + __import__('base64').b64encode(b'admin:lizy111A').decode()
SYS_NAMES = ['order-svc', 'pay-svc', 'user-svc', 'search-svc', 'cron-svc']
LEVELS_W = ['DEBUG'] * 2 + ['INFO'] * 6 + ['WARNING'] * 2 + ['ERROR'] * 2 + ['CRITICAL']


# ─── 服务端子进程 ────────────────────────────────────────

def _serve(q, tmp, errlog):
    sys.stderr = open(errlog, 'w', encoding='utf-8')
    from app.config import settings
    settings.data_dir = tmp
    settings.images_dir = os.path.join(tmp, 'images')
    from app.main import create_app
    app = create_app()
    from werkzeug.serving import make_server
    srv = make_server('127.0.0.1', 0, app, threaded=True)
    q.put(srv.port)
    srv.serve_forever()


# ─── 负载生成 ────────────────────────────────────────────

def _post(url, body, content_type='application/json', timeout=30):
    data = body.encode('utf-8') if isinstance(body, str) else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data,
                                 headers={'Content-Type': content_type})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        r.read()
    return True


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={'Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def bench(fn_list, workers):
    """并发执行 fn_list（每个元素无参调用），返回 (秒, 每项毫秒延迟列表, 错误数)"""
    lat = []
    lock = __import__('threading').Lock()
    errors = [0]

    def run(fn):
        t0 = time.perf_counter()
        try:
            fn()
        except Exception:
            with lock:
                errors[0] += 1
            return
        ms = (time.perf_counter() - t0) * 1000
        with lock:
            lat.append(ms)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run, fn_list))
    return time.perf_counter() - t0, lat, errors[0]


def pct(lat, p):
    if not lat:
        return None
    s = sorted(lat)
    return round(s[min(len(s) - 1, int(len(s) * p / 100))], 2)


def summarize(name, secs, lat, errors, unit='req'):
    ok = len(lat)
    return {
        'phase': name, 'ok': ok, 'errors': errors,
        'secs': round(secs, 2),
        f'{unit}_per_s': round(ok / secs, 1) if secs else 0,
        'p50_ms': pct(lat, 50), 'p95_ms': pct(lat, 95), 'p99_ms': pct(lat, 99),
        'max_ms': pct(lat, 100),
    }


# ─── 数据构造 ────────────────────────────────────────────

def make_log(now_base, i):
    ts = (now_base - timedelta(seconds=random.randint(0, 86400))).strftime('%Y-%m-%dT%H:%M:%S')
    return {
        'level': random.choice(LEVELS_W), 'timestamp': ts,
        'file': f'mod_{random.randint(1, 12)}.py', 'line': random.randint(1, 400),
        'sys_name': random.choice(SYS_NAMES),
        'trace_id': f'trace-{random.randint(1, 100):03d}',
        'user_id': f'u{random.randint(1, 200):03d}',
        'order_no': f'SO-{random.randint(10000, 99999)}',
        'message': random.choice([
            'user logged in', 'order created', 'payment settled',
            'db connection failed after retries', 'cache miss ratio high',
            'request completed', 'timeout calling downstream',
        ]) + f' seq={i}',
    }


# ─── 主流程 ──────────────────────────────────────────────

def wait_drained(base, timeout=60):
    """轮询 stats 直到写者队列排空且总数连续两次稳定（返回耗时；超时 None）"""
    t0 = time.perf_counter()
    last, stable = -1, 0
    while time.perf_counter() - t0 < timeout:
        try:
            st = _get(base + '/api/v1/stats')['data']
            if st['queue_size'] == 0:
                if st['total_rows'] == last:
                    stable += 1
                    if stable >= 2:
                        return round(time.perf_counter() - t0, 2)
                else:
                    stable = 0
                last = st['total_rows']
        except Exception:
            pass
        time.sleep(0.2)
    return None


def main(tag):
    tmp = tempfile.mkdtemp(prefix='sdklogs-loadtest-')
    errlog = os.path.join(tmp, 'server.err.log')
    q = multiprocessing.Queue()
    proc = multiprocessing.Process(target=_serve, args=(q, tmp, errlog), daemon=True)
    proc.start()
    port = q.get(timeout=30)
    base = f'http://127.0.0.1:{port}'
    _get(base + '/health') if False else _post(base + '/health', '{}') if False else None
    # health 无需认证：直接 GET
    import urllib.request as _u
    with _u.urlopen(base + '/health', timeout=5) as r:
        assert r.status == 200

    random.seed(20260919)
    now_base = datetime.now()
    report = {'tag': tag, 'rows_expected': 0, 'phases': []}

    # ── A 单条摄入 ──
    N_SINGLE, W = 2000, 8
    jobs = [lambda i=i: _post(base + '/api/v1/logs', make_log(now_base, i)) for i in range(N_SINGLE)]
    secs, lat, errs = bench(jobs, W)
    report['phases'].append(summarize(f'A 单条摄入 {W}线程×{N_SINGLE}', secs, lat, errs, 'req'))
    report['rows_expected'] += N_SINGLE

    # ── B 批量摄入 ──
    N_BATCH, BATCH, WB = 30, 200, 8
    batches = []
    idx = itertools_count = 0
    batch_jobs = []
    for w in range(WB):
        for k in range(N_BATCH):
            body = '\n'.join(json.dumps(make_log(now_base, 10_000 + idx + j)) for j in range(BATCH))
            idx += BATCH
            batch_jobs.append(lambda b=body: _post(base + '/api/v1/logs/batch', b, 'text/plain'))
    secs, lat, errs = bench(batch_jobs, WB)
    rows_b = len(batch_jobs) * BATCH
    report['phases'].append(summarize(f'B 批量摄入 {WB}线程×{len(batch_jobs)}批×{BATCH}条', secs, lat, errs, 'req'))
    report['phases'][-1]['rows_per_s'] = round(rows_b / secs, 1)
    report['rows_expected'] += rows_b

    # ── 排空（写入线程落库完成）──
    drain = wait_drained(base)
    report['drain_wait_s'] = drain
    st = _get(base + '/api/v1/stats')['data']
    report['rows_in_db'] = st['total_rows']
    report['accepted'] = st['accepted']
    report['dropped'] = st['dropped']            # 背压丢弃（设计行为：队列满丢最旧）
    report['failed'] = st['failed']
    report['no_loss'] = st['total_rows'] == st['accepted'] - st['dropped']

    # ── C 查询（50k 行上）──
    patterns = {
        'C1 最近100条(limit=100)': {'limit': 100},
        'C2 sys_name+时间范围': {'sys_name': 'order-svc', 'start': (now_base - timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%S'), 'limit': 100},
        'C3 level_gte=ERROR': {'level_gte': 'ERROR', 'limit': 100},
        'C4 trace_id': {'trace_id': 'trace-042', 'limit': 100},
        'C5 消息全文 q': {'q': 'timeout', 'limit': 100},
        'C6 kv 过滤 user_id': {'user_id': 'u123', 'limit': 100},
    }
    for name, params in patterns.items():
        qs = base + '/api/v1/logs?' + urlencode(params)
        jobs = [lambda u=qs: _get(u) for _ in range(100)]
        secs, lat, errs = bench(jobs, 4)
        report['phases'].append(summarize(name, secs, lat, errs, 'req'))

    proc.terminate()

    # 摘要表
    print(f"\n══ sdklogs 压测 [{tag}] ══")
    print(f"{'阶段':<28}{'吞吐/s':>10}{'p50':>8}{'p95':>8}{'p99':>8}{'max':>9}{'错误':>5}")
    for p in report['phases']:
        thr = p.get('rows_per_s') or p.get('req_per_s')
        print(f"{p['phase']:<26}{thr:>10}{p['p50_ms']:>8}{p['p95_ms']:>8}{p['p99_ms']:>8}{p['max_ms']:>9}{p['errors']:>5}")
    print(f"落库 {report['rows_in_db']} 行 = 已接收 {report['accepted']} - 背压丢弃 {report['dropped']}"
          f"（{'已接收全部持久化' if report['no_loss'] else '有丢失!'}），排空等待 {report['drain_wait_s']}s")

    out = os.path.join(HERE, 'reports')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, f'{tag}.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"报告: tools/reports/{tag}.json | 服务端日志: {errlog}")


if __name__ == '__main__':
    multiprocessing.set_start_method('spawn')
    main(sys.argv[1] if len(sys.argv) > 1 else 'run')
