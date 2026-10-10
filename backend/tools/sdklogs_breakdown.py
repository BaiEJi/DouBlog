"""归因诊断：单条摄入/查询的耗时到底花在哪一层。

  L1  app 层      test_client 直调（无 socket/线程，纯 Flask 栈 + handler）
  L2  HTTP 层     完整往返（Werkzeug threaded + 新连接每请求 = SDK 现实）
  L3  HTTP+复用   http.client 复用连接（隔离"每请求新建连接"的成本）
"""
import json, multiprocessing, os, sys, tempfile, time, statistics, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUTH = 'Basic ' + __import__('base64').b64encode(b'admin:lizy111A').decode()

def _serve(q, tmp):
    sys.stderr = open(os.path.join(tmp, 'err.log'), 'w', encoding='utf-8')
    from app.config import settings
    settings.data_dir = tmp; settings.images_dir = os.path.join(tmp, 'images')
    from app.main import create_app
    from werkzeug.serving import make_server
    srv = make_server('127.0.0.1', 0, create_app(), threaded=True)
    q.put(srv.port); srv.serve_forever()

def rec(i):
    from datetime import datetime, timedelta
    ts = (datetime.now() - timedelta(seconds=i % 600)).strftime('%Y-%m-%dT%H:%M:%S')
    return {"level": "INFO", "timestamp": ts, "file": "a.py", "line": i, "sys_name": "probe",
            "user_id": "u1", "trace_id": f"t{i%50}", "message": f"msg {i}"}

def stats_pcts(lat):
    s = sorted(lat)
    return f"p50={s[len(s)//2]:.2f}ms mean={statistics.mean(s):.2f}ms"

if __name__ == '__main__':
    # ── L1: app 层（同进程 test_client）──
    tmp = tempfile.mkdtemp(prefix='brk-')
    from app.config import settings
    settings.data_dir = tmp; settings.images_dir = os.path.join(tmp, 'images')
    from app.main import create_app
    app = create_app()
    c = app.test_client()
    N = 2000
    lat = []
    for i in range(N):
        t0 = time.perf_counter()
        c.post('/api/v1/logs', json=rec(i))
        lat.append((time.perf_counter() - t0) * 1000)
    print(f"L1 app层 单条摄入×{N}:  {stats_pcts(lat)}  → {1000/statistics.mean(lat):.0f} rps/线程")
    # 排空
    import queue as _q
    p = app.extensions['sdklogs']; p.flush(timeout=10)
    lat = []
    for i in range(300):
        t0 = time.perf_counter()
        c.get('/api/v1/logs?limit=100', headers={'Authorization': AUTH})
        lat.append((time.perf_counter() - t0) * 1000)
    print(f"L1 app层 查询×300:      {stats_pcts(lat)}")

    # ── L2/L3: HTTP 层（子进程服务端）──
    multiprocessing.set_start_method('spawn', force=True)
    tmp2 = tempfile.mkdtemp(prefix='brk2-')
    q = multiprocessing.Queue()
    proc = multiprocessing.Process(target=_serve, args=(q, tmp2), daemon=True); proc.start()
    base = f"http://127.0.0.1:{q.get(timeout=30)}"
    # 预热 + 种数据
    import http.client
    for i in range(50):
        body = json.dumps(rec(i)).encode()
        req = urllib.request.Request(base + '/api/v1/logs', data=body, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=5).read()

    # L2: urllib 每请求新连接（SDK 现实）
    lat = []
    for i in range(500):
        t0 = time.perf_counter()
        req = urllib.request.Request(base + '/api/v1/logs', data=json.dumps(rec(i)).encode(),
                                     headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=5).read()
        lat.append((time.perf_counter() - t0) * 1000)
    print(f"L2 HTTP新连接 单条×500:  {stats_pcts(lat)}  → {1000/statistics.mean(lat):.0f} rps/线程")

    # L3: http.client 复用连接
    conn = http.client.HTTPConnection('127.0.0.1', base.split(':')[2].split('/')[0] and base.split(':')[2], timeout=5)
    lat = []
    for i in range(500):
        t0 = time.perf_counter()
        conn.request('POST', '/api/v1/logs', body=json.dumps(rec(i)), headers={'Content-Type': 'application/json'})
        conn.getresponse().read()
        lat.append((time.perf_counter() - t0) * 1000)
    print(f"L3 HTTP复用连接 单条×500: {stats_pcts(lat)}  → {1000/statistics.mean(lat):.0f} rps/线程")
    proc.terminate()
