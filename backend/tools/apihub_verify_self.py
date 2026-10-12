"""一次性验证脚本：全模块 gw 转发一致性 + 路径参数 + 写操作 + 透明代理 + 限流 + 鉴权。

用法：后端运行中，cd backend && ./venv/Scripts/python.exe tools/apihub_verify_self.py <sk-令牌>
"""
import base64
import datetime
import json
import sys
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:60100'
SK = sys.argv[1]
BASIC = 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()
PASS = FAIL = 0


def http(method, url, body=None, auth='basic', headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json',
         'Authorization': f'Bearer {SK}' if auth == 'bearer' else BASIC}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def jparse(raw):
    try:
        return json.loads(raw)
    except Exception:
        return raw[:120].decode('utf-8', 'replace')


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f'  {detail}' if (detail and not cond) else ''))


apis = json.loads(http('GET', f'{BASE}/api/apihub/admin/apis')[1])['data']

# ── 1) 全模块代表性 GET：gw vs 直连 一致性 ──────────────────────
mods = {}
for a in apis:
    m = a['description'].removeprefix('模块 ')
    if a['method'] == 'GET' and '{' not in a['path_tpl'] and m not in mods:
        mods[m] = a
print(f'== 全模块转发一致性（{len(mods)} 个模块）==')
for m, a in sorted(mods.items()):
    ds, dr, _ = http('GET', BASE + a['path_tpl'])
    gs, gr, _ = http('POST', f"{BASE}/api/apihub/gw/apis/{a['slug']}", body={}, auth='bearer')
    check(f'{m:10s} GET {a["path_tpl"]}', ds == gs and jparse(dr) == jparse(gr),
          f'direct={ds} gw={gs} gw_body={jparse(gr)}')

# ── 2) 写操作 + 路径参数：todo 任务 建→查→补丁→删 全走 gw ────────
print('== 写操作 + 路径参数 ==')
today = datetime.date.today().isoformat()
gs, gr, _ = http('POST', f'{BASE}/api/apihub/gw/apis/todo-post-todo-tasks', auth='bearer',
                 body={'body': {'title': 'apihub 网关验证任务', 'task_date': today}})
tid, rev = (json.loads(gr)['data'] or {}).get('id'), (json.loads(gr)['data'] or {}).get('revision')
check('gw POST 创建任务 201', gs == 201, f'status={gs} body={jparse(gr)}')

gs, gr, _ = http('POST', f'{BASE}/api/apihub/gw/apis/todo-get-todo-tasks', auth='bearer',
                 body={'query': {'date': today}})
tasks = json.loads(gr)['data']
tasks = tasks['items'] if isinstance(tasks, dict) else tasks
row = next((t for t in tasks if t['id'] == tid), None)
check('gw GET 列表可见新任务', row is not None and row['title'] == 'apihub 网关验证任务')

gs, gr, _ = http('POST', f'{BASE}/api/apihub/gw/apis/todo-patch-todo-tasks-task_id', auth='bearer',
                 body={'path': {'task_id': tid}, 'body': {'title': 'apihub 已补丁', 'revision': row['revision']}})
check('gw PATCH 路径参数 + 乐观锁', gs == 200, f'status={gs} body={jparse(gr)}')

gs, gr, _ = http('POST', f'{BASE}/api/apihub/gw/apis/todo-delete-todo-tasks-task_id', auth='bearer',
                 body={'path': {'task_id': tid}})
check('gw DELETE 路径参数删除', gs == 200, f'status={gs} body={jparse(gr)}')

# ── 3) 透明代理模式 ────────────────────────────────────────────
print('== 透明代理 ==')
ds, dr, _ = http('GET', f'{BASE}/api/todo/tasks')
gs, gr, _ = http('GET', f'{BASE}/api/apihub/gw/upstreams/doublog/api/todo/tasks', auth='bearer')
check('透传 GET /api/todo/tasks', ds == gs and jparse(dr) == jparse(gr), f'direct={ds} gw={gs}')

# ── 4) 限流：token_api 低压规则触发 429 与恢复 ──────────────────
print('== 限流（token_api fixed_window 60s/2 次）==')
tok = json.loads(http('GET', f'{BASE}/api/apihub/admin/tokens')[1])['data']
tid_tok = next(t['id'] for t in tok if t['name'] == 'doublog-self')
target = next(a for a in apis if a['slug'] == 'todo-get-todo-categories')
rr = json.loads(http('POST', f'{BASE}/api/apihub/admin/rules',
                     body={'scope': 'token_api', 'api_id': target['id'], 'token_id': tid_tok,
                           'algorithm': 'fixed_window', 'window_s': 60, 'max_count': 2})[1])['data']
try:
    codes = [http('POST', f'{BASE}/api/apihub/gw/apis/todo-get-todo-categories', body={}, auth='bearer')[0]
             for _ in range(4)]
    check('429 触发（前 2 次放行，第 3/4 次限流）', codes[0] == 200 and codes[1] == 200
          and codes[2] == codes[3] == 429, f'codes={codes}')
    s429, _, h429 = http('POST', f'{BASE}/api/apihub/gw/apis/todo-get-todo-categories', body={}, auth='bearer')
    h429 = {k.lower(): v for k, v in h429.items()}
    check('429 响应头 Retry-After / X-RateLimit-Scope',
          s429 == 429 and 'retry-after' in h429 and h429.get('x-ratelimit-scope') == 'token_api',
          f'status={s429} headers={h429}')
finally:
    http('DELETE', f"{BASE}/api/apihub/admin/rules/{rr['id']}")
s, _, _ = http('POST', f'{BASE}/api/apihub/gw/apis/todo-get-todo-categories', body={}, auth='bearer')
check('规则删除后立即恢复', s == 200, f'status={s}')

# ── 5) 网关鉴权：伪造令牌拒绝；无令牌 401 ──────────────────────
print('== 网关鉴权 ==')
req = urllib.request.Request(f'{BASE}/api/apihub/gw/apis/todo-get-todo-categories', method='POST',
                             data=b'{}', headers={'Content-Type': 'application/json',
                                                 'Authorization': 'Bearer sk-fake-token'})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        fake = r.status
except urllib.error.HTTPError as e:
    fake = e.code
check('伪造令牌 401', fake == 401, f'status={fake}')

req = urllib.request.Request(f'{BASE}/api/apihub/gw/apis/todo-get-todo-categories', method='POST',
                             data=b'{}', headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        noauth = r.status
except urllib.error.HTTPError as e:
    noauth = e.code
check('无令牌 401', noauth == 401, f'status={noauth}')

# ── 6) OpenAPI 发布入口（/openapi/self/<模块>/<api名>，仅 sk- 鉴权）────────
print('== OpenAPI 发布入口 ==')
for m, a in sorted(mods.items()):
    mod = a['description'].removeprefix('模块 ')
    ds, dr, _ = http('GET', BASE + a['path_tpl'])
    gs, gr, _ = http('GET', f'{BASE}/openapi/self/{mod}/{a["slug"]}', auth='bearer')
    check(f'openapi {m:8s} /openapi/self/{mod}/{a["slug"].split("-", 2)[-1][:24]}',
          ds == gs and jparse(dr) == jparse(gr), f'direct={ds} gw={gs}')
s, _, _ = http('GET', f'{BASE}/openapi/self/todo/todo-get-todo-tasks')
check('openapi 无令牌 401', s == 401, f'status={s}')
s, _, _ = http('DELETE', f'{BASE}/openapi/self/todo/todo-get-todo-tasks', auth='bearer')
check('openapi 方法不符 405', s == 405, f'status={s}')
s, _, _ = http('GET', f'{BASE}/openapi/self/todo/no-such-api', auth='bearer')
check('openapi 不存在 404', s == 404, f'status={s}')

# 路径变量经 query：建任务 → DELETE ?task_id=
gs, gr, _ = http('POST', f'{BASE}/openapi/self/todo/todo-post-todo-tasks', auth='bearer',
                 body={'title': 'openapi 验证', 'task_date': today})
tid2 = (jparse(gr) or {}).get('data', {}).get('id')
check('openapi POST 创建任务 201', gs == 201, f'status={gs} body={jparse(gr)}')
gs, gr, _ = http('DELETE', f'{BASE}/openapi/self/todo/todo-delete-todo-tasks-task_id?task_id={tid2}',
                 auth='bearer')
check('openapi DELETE 路径变量（query 注入）', gs == 200, f'status={gs} body={jparse(gr)}')
s, _, _ = http('DELETE', f'{BASE}/openapi/self/todo/todo-delete-todo-tasks-task_id', auth='bearer')
check('openapi 缺路径变量 400', s == 400, f'status={s}')

# /doc：公开、text/markdown、含关键段
s, doc_raw, dh = http('GET', f'{BASE}/openapi/self/todo/todo-get-todo-tasks/doc')
md = doc_raw.decode('utf-8', 'replace')
ct = {k.lower(): v for k, v in dh.items()}.get('content-type', '')
check('doc 公开可访问 + text/markdown', s == 200 and ct.startswith('text/markdown'),
      f'status={s} ct={ct}')
need = ['# todo-get-todo-tasks', '`self/todo`', '`GET`', '## 认证', '## 调用示例', 'curl']
check('doc 含元信息/认证/限流/示例', all(k in md for k in need),
      f'缺: {[k for k in need if k not in md]}')

# 内部令牌：直连后端免用户鉴权（服务内 API 不走身份验证）
from pathlib import Path as _P
tok_file = _P(__file__).resolve().parents[2] / 'data' / 'internal_token'
s, _, _ = http('GET', f'{BASE}/api/todo/tasks',
               headers={'X-Apihub-Token': tok_file.read_text().strip()})
check('X-Apihub-Token 直连后端 200', s == 200, f'status={s}')

print(f'\n结果: {PASS} 通过, {FAIL} 失败')
sys.exit(1 if FAIL else 0)
