"""服务层对比：werkzeug threaded vs waitress（同 app、同 8 并发压法）。"""
import json, multiprocessing, os, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from concurrent.futures import ThreadPoolExecutor

PORT = 29871

def _serve(q, tmp, kind):
    sys.stderr = open(os.path.join(tmp, 'err.log'), 'w', encoding='utf-8')
    from app.config import settings
    settings.data_dir = tmp; settings.images_dir = os.path.join(tmp, 'images')
    from app.main import create_app
    app = create_app()
    if kind == 'waitress':
        from waitress import serve
        serve(app, host='127.0.0.1', port=PORT, threads=16, _quiet=True)
    else:
        from werkzeug.serving import make_server
        srv = make_server('127.0.0.1', 0, app, threaded=True)
        q.put(srv.port); srv.serve_forever()

def _one(base, i, rec):
    for attempt in range(6):   # Windows 临时端口 TIME_WAIT 耗尽时退避重试
        t0 = time.perf_counter()
        try:
            urllib.request.urlopen(urllib.request.Request(
                base + '/api/v1/logs', data=json.dumps(rec(i)).encode(),
                headers={'Content-Type': 'application/json'}), timeout=10).read()
            return (time.perf_counter() - t0) * 1000
        except urllib.error.URLError as e:
            if '10048' in str(e) and attempt < 5:
                time.sleep(0.3)
                continue
            raise

if __name__ == '__main__':
    multiprocessing.set_start_method('spawn')
    from datetime import datetime
    rec = lambda i: {"level": "INFO", "timestamp": datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
                     "file": "a.py", "line": i, "sys_name": "s", "user_id": "u", "message": f"m{i}"}
    for kind in ['werkzeug', 'waitress']:
        tmp = tempfile.mkdtemp(prefix=f'cmp-{kind}-')
        q = multiprocessing.Queue()
        p = multiprocessing.Process(target=_serve, args=(q, tmp, kind), daemon=True)
        p.start()
        port = q.get(timeout=30) if kind == 'werkzeug' else PORT
        if kind == 'waitress':
            time.sleep(2.5)
        base = f"http://127.0.0.1:{port}"
        try:
            import http.client, threading
            warm = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            for _ in range(30):
                warm.request('POST', '/api/v1/logs', body=json.dumps(rec(0)),
                             headers={'Content-Type': 'application/json'})
                warm.getresponse().read()
            warm.close()
            N, W = 2400, 8
            lat = []
            lock = threading.Lock()

            def worker(wid):
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
                for i in range(wid, N, W):
                    t0 = time.perf_counter()
                    conn.request('POST', '/api/v1/logs', body=json.dumps(rec(i)),
                                 headers={'Content-Type': 'application/json'})
                    conn.getresponse().read()
                    ms = (time.perf_counter() - t0) * 1000
                    with lock:
                        lat.append(ms)
                conn.close()

            t0 = time.perf_counter()
            with ThreadPoolExecutor(max_workers=W) as ex:
                list(ex.map(worker, range(W)))
            wall = time.perf_counter() - t0
            lat.sort()
            print(f"{kind:9s} 8并发×{N}: p50={lat[len(lat)//2]:.1f}ms p95={lat[int(len(lat)*.95)]:.1f}ms "
                  f"p99={lat[int(len(lat)*.99)]:.1f}ms  吞吐={N/wall:.0f} rps")
        finally:
            p.terminate(); p.join(3)
