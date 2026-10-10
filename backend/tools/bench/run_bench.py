"""bench 跑分器：恢复快照 → 起实例 → node autocannon 逐场景 → 汇总落盘。

用法：
    venv/Scripts/python.exe tools/bench/run_bench.py flask baseline            # 全场景
    venv/Scripts/python.exe tools/bench/run_bench.py fastapi fastapi-v1 blog_list,apihub_gw
输出：tools/bench/results/<label>.json
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(os.path.dirname(HERE))
PY = os.path.join(BACKEND, 'venv', 'Scripts', 'python.exe')
PORT = 60110
BASE = f'http://127.0.0.1:{PORT}'
AUTH = 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()

with open(os.path.join(HERE, 'bench_state.json'), encoding='utf-8') as f:
    ST = json.load(f)


def scen(name, method, path, body=None, auth=True, extra_headers=None):
    h = {'content-type': 'application/json'}
    if auth:
        h['Authorization'] = AUTH
    if extra_headers:
        h.update(extra_headers)
    return {'name': name, 'url': BASE + path, 'method': method,
            'body': json.dumps(body, ensure_ascii=False) if body is not None else None,
            'headers': h}


SCENARIOS = [
    scen('auth_login', 'POST', '/api/auth/login'),
    scen('admin_db', 'GET', '/api/admin/database'),
    scen('blog_list', 'GET', '/api/posts?page=1&page_size=20'),
    scen('blog_tree', 'GET', '/api/posts/tree'),
    scen('blog_detail', 'GET', f"/api/posts/id/{ST['post_id']}"),
    scen('blog_create', 'POST', '/api/posts',
         {'title': 'bench-create', 'name': 'bench-create', 'content': 'x' * 512,
          'workspace_id': ST['workspace_id']}),
    scen('diary_list', 'GET', '/api/diary/entries?page=1&page_size=20'),
    scen('diary_create', 'POST', '/api/diary/entries',
         {'entry_date': '2026-10-10', 'content': 'bench 压测日记' * 10}),
    scen('vault_items', 'GET', '/api/vault/items'),
    scen('pwsvc_users', 'GET', f"/api/pwsvc/projects/{ST['pwsvc_project_id']}/users"),
    scen('subs_members', 'GET', '/api/subs/members'),
    scen('sdklogs_ingest', 'POST', '/api/v1/logs/batch',
         [{'level': 'INFO', 'sys_name': 'bench.svc', 'timestamp': '2026-10-10T00:00:00+00:00',
           'message': 'bench ingest'}] * 50, auth=False),
    scen('sdklogs_search', 'GET', '/api/v1/logs?limit=20'),
    scen('apihub_gw', 'POST', f"/api/apihub/gw/apis/{ST['apihub_slug']}",
         {'query': {'a': '1'}}, auth=False,
         extra_headers={'Authorization': f"Bearer {ST['apihub_token']}"}),
]

CONNS, DUR, WARM = 20, 15, 3


def wait_health(timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(BASE + '/health', timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    impl, label = sys.argv[1], sys.argv[2]
    only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
    scens = [s for s in SCENARIOS if not only or s['name'] in only]

    # 恢复快照（同起点）
    src, dst = os.path.join(HERE, 'data-seed'), os.path.join(HERE, 'data')
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)

    env = dict(os.environ, BENCH_IMPL=impl, BENCH_PORT=str(PORT))
    procs = [subprocess.Popen([PY, os.path.join(HERE, 'mock_upstream.py')], env=env),
             subprocess.Popen([PY, os.path.join(HERE, 'launch.py')], env=env)]
    try:
        if not wait_health():
            raise RuntimeError('bench 实例未就绪')
        print(f'[{label}] instance up ({impl})', flush=True)
        tmp = os.path.join(HERE, '_scenarios.json')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(scens, f, ensure_ascii=False)
        r = subprocess.run(['node', os.path.join(HERE, 'bench_client.mjs'), tmp,
                            str(DUR), str(WARM)], env=env, capture_output=True,
                           text=True, timeout=1800)
        sys.stderr.write(r.stderr)
        results = json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        for p in procs:
            p.terminate()
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()

    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    out = os.path.join(HERE, 'results', f'{label}.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'label': label, 'impl': impl, 'conns': CONNS, 'duration': DUR,
                   'scenarios': results}, f, ensure_ascii=False, indent=2)
    print(f'saved -> {out}')


if __name__ == '__main__':
    main()
