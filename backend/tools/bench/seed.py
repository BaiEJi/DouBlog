"""bench 数据种子：对运行中的 bench 实例（60110）按 HTTP 灌入确定性数据。

用法：
    venv/Scripts/python.exe tools/bench/seed.py          # 灌数 + 快照到 data-seed/
产出 tools/bench/bench_state.json（压测场景所需的 id/token 等）。
"""
import base64
import json
import os
import shutil
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = f"http://127.0.0.1:{os.environ.get('BENCH_PORT', '60110')}"
AUTH = 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()

CONTENT = ('# 基准文章\n\n' + ('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '
           '中文内容混合测试 **bold** `code` [link](https://example.com)。\n\n' * 18))


def call(method, path, body=None, auth=True, expect=None):
    req = urllib.request.Request(BASE + path, method=method)
    if auth:
        req.add_header('Authorization', AUTH)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as resp:
            payload = json.loads(resp.read().decode())
            code = resp.status
    except urllib.error.HTTPError as e:
        payload = json.loads(e.read().decode())
        code = e.code
    ok = payload.get('success', False)
    if not ok or (expect is not None and code != expect):
        raise RuntimeError(f'{method} {path} -> {code} {payload}')
    return payload.get('data'), code


def main():
    state = {}

    # ── blog ─────────────────────────────────────────────
    for i in range(1, 5):  # 补 4 个知识库（默认库已存在）
        call('POST', '/api/workspaces', {'name': f'基准库{i}'})
    ws = [w['id'] for w in call('GET', '/api/workspaces')[0]]
    pid_root = None
    for i in range(120):
        d, _ = call('POST', '/api/posts', {
            'title': f'基准文章{i:03d}', 'name': f'bench-post-{i:03d}',
            'content': CONTENT, 'summary': f'摘要{i}', 'workspace_id': ws[i % len(ws)],
            'tags': ['bench', f'tag{i % 7}'],
        }, expect=201)
        if i == 0:
            pid_root = d['id']
    # 子层级（第二层）
    for i in range(30):
        call('POST', '/api/posts', {
            'title': f'基准子文{i:03d}', 'name': f'bench-child-{i:03d}',
            'content': CONTENT, 'workspace_id': ws[0], 'parent_id': pid_root,
        }, expect=201)
    state['post_id'] = pid_root
    state['workspace_id'] = ws[0]

    # ── diary ────────────────────────────────────────────
    today = datetime(2026, 10, 10)
    for i in range(120):
        d = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        call('POST', '/api/diary/entries', {
            'entry_date': d, 'content': f'第{i}天日记：' + '今天完成了迁移压测基准。' * (i % 20 + 1),
            'mood': ['great', 'good', 'ok', 'low', 'bad'][i % 5],
            'kind': 'note' if i % 3 else 'summary',
        }, expect=201)

    # ── vault ────────────────────────────────────────────
    call('POST', '/api/vault/account', {
        'kdf_algo': 'argon2id', 'kdf_params': {'t': 3, 'm': 65536, 'p': 1},
        'kdf_salt': 'a' * 32, 'recovery_salt': 'b' * 32,
        'wrapped_vault_key': {'n': 'c' * 16, 'ct': 'd' * 32},
        'recovery_wrapped_vault_key': {'n': 'e' * 16, 'ct': 'f' * 32},
    }, expect=201)
    for i in range(40):
        call('POST', '/api/vault/items', {
            'blob': {'n': f'nonce{i:03d}', 'ct': 'ct' * 40}, 'favorite': i % 5 == 0,
        }, expect=201)

    # ── pwsvc ────────────────────────────────────────────
    d, _ = call('POST', '/api/pwsvc/projects', {'name': 'bench'}, expect=201)
    pid = d['id']
    type_ids = []
    for i in range(3):
        d, _ = call('POST', f'/api/pwsvc/projects/{pid}/types',
                    {'name': f'type{i}', 'length': 16, 'rotation_seconds': 60}, expect=201)
        type_ids.append(d['id'])
    for i in range(30):
        call('POST', f'/api/pwsvc/projects/{pid}/users',
             {'username': f'user{i:02d}', 'type_id': type_ids[i % 3]}, expect=201)
    state['pwsvc_project_id'] = pid

    # ── subs ─────────────────────────────────────────────
    cat_ids = []
    for i in range(5):
        d, _ = call('POST', '/api/subs/categories', {'name': f'分类{i}', 'color': '#3b82f6'}, expect=201)
        cat_ids.append(d['id'])
    for i in range(10):
        d, _ = call('POST', '/api/subs/members', {
            'name': f'会员{i}', 'category_id': cat_ids[i % 5],
            'subscription': {
                'level': 'Pro', 'price': f'{9.9 + i}.90', 'currency': 'CNY',
                'billing_cycle': 'monthly',
                'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        }, expect=201)
        state.setdefault('member_id', d['id'])

    # ── sdklogs（摄入 2000 条）──────────────────────────
    now = datetime.now(timezone.utc)
    accepted = 0
    for b in range(20):
        logs = [{
            'level': 'INFO' if j % 5 else 'WARNING',
            'sys_name': f'bench.svc{j % 4}',
            'timestamp': (now - timedelta(seconds=b * 100 + j)).isoformat(),
            'message': f'bench log b{b} j{j}',
            'trace_id': f't{b:04x}{j:04x}',
            'user_id': str(j % 9),
        } for j in range(100)]
        d, _ = call('POST', '/api/v1/logs/batch', logs, auth=False, expect=202)
        accepted += d['accepted']
    state['sdklogs_ingested'] = accepted

    # ── apihub（系统=本机 mock 60111）───────────────────
    d, _ = call('POST', '/api/apihub/admin/systems', {
        'slug': 'echo', 'name': 'echo', 'base_url': 'http://127.0.0.1:60111',
        'auth_config': {'type': 'none'},
    }, expect=201)
    uid = d['id']
    d, _ = call('POST', '/api/apihub/admin/apis', {
        'slug': 'echo', 'name': 'echo', 'system_id': uid,
        'method': 'GET', 'path_tpl': '/echo',
    }, expect=201)
    aid = d['id']
    d, _ = call('POST', '/api/apihub/admin/tokens', {'name': 'bench', 'allowed_api_ids': [aid]}, expect=201)
    state['apihub_slug'] = 'echo'
    state['apihub_token'] = d.get('token') or d.get('plaintext') or ''
    assert state['apihub_token'].startswith('sk-'), f'token missing: {d}'

    # gw 冒烟一次
    d, _ = call('POST', '/api/apihub/gw/apis/echo', {'query': {'a': '1'}}, auth=False)
    assert d['status_code'] == 200, d

    with open(os.path.join(HERE, 'bench_state.json'), 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    # 快照（每次压测前恢复，保证两侧同起点）
    src = os.path.join(HERE, 'data')
    dst = os.path.join(HERE, 'data-seed')
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    print(json.dumps(state, ensure_ascii=False, indent=2))
    print('seeded & snapshot -> data-seed/')


if __name__ == '__main__':
    sys.exit(main())
