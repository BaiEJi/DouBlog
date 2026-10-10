"""诊断写入线程速率：推 4000 行批量 → 每 200ms 打点 count/queue/dropped/failed。"""
import json, multiprocessing, os, sys, tempfile, time, urllib.request
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

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': AUTH}), timeout=10) as r:
        return json.loads(r.read())

def post(url, body, ct='text/plain'):
    req = urllib.request.Request(url, data=body.encode(), headers={'Content-Type': ct})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: r.read()
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read().decode()[:200]); raise

if __name__ == '__main__':
    multiprocessing.set_start_method('spawn')
    tmp = tempfile.mkdtemp(prefix='probe-')
    q = multiprocessing.Queue()
    p = multiprocessing.Process(target=_serve, args=(q, tmp), daemon=True); p.start()
    base = f"http://127.0.0.1:{q.get(timeout=30)}"

    from datetime import datetime, timedelta
    now = datetime.now()
    rec = lambda i: {"level": "INFO", "timestamp": (now - timedelta(seconds=i % 3600)).strftime('%Y-%m-%dT%H:%M:%S'),
                     "file": "a.py", "line": i, "sys_name": "probe", "user_id": "u1", "message": f"m{i}"}
    t0 = time.perf_counter()
    for c in range(4):   # 4 批 × 1000 行（单批上限 1000）
        body = '\n'.join(json.dumps(rec(c * 1000 + i)) for i in range(1000))
        post(base + '/api/v1/logs/batch', body)
    print(f"batch POST 4×1000 行耗时 {time.perf_counter()-t0:.2f}s（含服务端入队）")

    locked = 0
    for _ in range(50):   # 10 秒观察窗
        time.sleep(0.2)
        try:
            s = get(base + '/api/v1/stats')['data']
        except Exception as e:
            locked += 1
            print(f"t={time.perf_counter()-t0:5.1f}s stats 不可用（{e}）")
            continue
        print(f"t={time.perf_counter()-t0:5.1f}s rows={s['total_rows']:5d} queue={s['queue_size']:5d} "
              f"accepted={s['accepted']} dropped={s['dropped']} failed={s['failed']} dead={s['dead_letter']}")
        if s['queue_size'] == 0 and s['total_rows'] >= 4000:
            print(f"排空完成，总耗时 {time.perf_counter()-t0:.2f}s")
            break
    print(f"观察窗内 stats 被锁失败 {locked} 次")
    p.terminate()
