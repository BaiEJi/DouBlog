"""API Hub 自注册：把本服务（DouBlog 后端）的全部模块 API 注册为 apihub 上游。

用法（需后端已在运行）：
    cd backend && ./venv/Scripts/python.exe tools/apihub_register_self.py [--base http://127.0.0.1:60100]
        [--prune]        # 删除本上游下已不存在于路由表的注册项（默认只报告）
        [--recreate-token]  # 删除同名旧令牌并重新签发（旧 sk- 立即失效）

做了什么：
1. 进程内导入 FastAPI app 枚举全部 /api/* 路由（排除 apihub 自身，防网关递归），
   路径参数 {id} 转为 apihub 模板 {path.id}；
2. 经管理端 API 幂等注册：上游 doublog（内部服务令牌注入 X-Apihub-Token——服务内
   API 不走用户身份验证，调用方鉴权由 apihub 平台令牌 sk- 承担）→ 密钥池一把 key
   → 每路由一条 API（发布为 OpenAPI：一级分组 self/自我服务，二级分组=模块名）
   → 限流规则；
3. 限流设计（token_bucket）：每 API 读写分级（GET/HEAD 20rps·burst40，
   写方法 5rps·burst10）+ 令牌级 50rps·burst100 + 全局 100rps·burst200；
4. 签发平台令牌 doublog-self（sk- 明文仅打印一次；已存在则跳过，见 --recreate-token）。

max_retry 固定 0：写接口重放会造成重复写入（如重复建任务），自转发不做自动重试。
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

os.environ.setdefault('DOUBLOG_TESTING', '1')   # 导入 app 时后台线程空转

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

UPSTREAM_SLUG = 'doublog'
TOKEN_NAME = 'doublog-self'
GROUP1 = 'self'          # 服务内 API 的一级分组（自我服务）；二级 = 模块名
METHODS = ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
#: 读方法限流（每 API 一条 scope=api 规则）
READ_RATE, READ_BURST = 20.0, 40
#: 写方法限流
WRITE_RATE, WRITE_BURST = 5.0, 10
#: 令牌级 / 全局兜底
TOKEN_RATE, TOKEN_BURST = 50.0, 100
GLOBAL_RATE, GLOBAL_BURST = 100.0, 200


# ─── 路由枚举（纯函数，测试覆盖）────────────────────────────────

def _iter_api_routes(routes):
    """展平路由树：FastAPI ≥0.13x 的 include_router 是惰性 _IncludedRouter 包装，
    真正的 APIRoute 挂在 original_router.routes 上。"""
    for r in routes:
        sub = getattr(r, 'original_router', None)
        if sub is not None and getattr(sub, 'routes', None) is not None:
            yield from _iter_api_routes(sub.routes)
        else:
            yield r


def enumerate_routes(app):
    """枚举全部可注册端点：[{module, method, path, slug, name, path_tpl}]。

    排除：非 /api/ 前缀（/ 与 /health）、apihub 自身（gw 递归与管理面）。
    """
    from app.shared.modules import module_for_path
    items, seen = [], set()
    for r in _iter_api_routes(app.routes):
        path = getattr(r, 'path', None)
        methods = getattr(r, 'methods', None) or set()
        if not path or not path.startswith('/api/') or path.startswith('/api/apihub/'):
            continue
        for m in sorted(methods & set(METHODS)):
            mod = module_for_path(path)
            slug = build_slug(mod, m, path)
            if slug in seen:
                continue          # 同一路由多 method 声明去重
            seen.add(slug)
            items.append({
                'module': mod, 'method': m, 'path': path, 'slug': slug,
                'name': f'{m} {path}',
                'path_tpl': re.sub(r'\{(\w+)(?::[^}]*)?\}', r'{path.\1}', path),
            })
    return items


def build_slug(module, method, path):
    """/api/gamemap/games/{game_id} GET → gamemap-get-games-game_id（≤64，字母数字_-；
    {slug:path} 转换器后缀剥掉；超长时截断 + 全路径哈希后缀防撞）"""
    sig = re.sub(r'\{(\w+)(:[^}]*)?\}', r'\1', path[len('/api/'):]).replace('/', '-')
    slug = f"{module}-{method.lower()}-{sig}"
    if len(slug) > 64:
        import hashlib
        h = hashlib.sha1(f'{module}-{method}-{path}'.encode()).hexdigest()[:11]
        slug = f"{slug[:52]}-{h}"
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', slug):
        raise ValueError(f'slug 非法: {slug}')
    return slug


def rule_for_method(method):
    """按读写分级返回限流参数"""
    if method in ('GET', 'HEAD'):
        return {'algorithm': 'token_bucket', 'rate_per_sec': READ_RATE, 'burst': READ_BURST}
    return {'algorithm': 'token_bucket', 'rate_per_sec': WRITE_RATE, 'burst': WRITE_BURST}


# ─── 管理端 HTTP 薄封装 ────────────────────────────────────────

class Admin:
    def __init__(self, base, username, password):
        self.base = base.rstrip('/')
        import base64
        self.auth = 'Basic ' + base64.b64encode(f'{username}:{password}'.encode()).decode()

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={'Authorization': self.auth,
                                              'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read() or b'{}')
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}')

    def ok(self, method, path, body=None):
        code, payload = self.call(method, path, body)
        if code >= 300 or not payload.get('success'):
            raise RuntimeError(f'{method} {path} -> {code} {payload.get("message")}')
        return payload['data']


def register(base, prune=False, recreate_token=False):
    from app.config import settings
    from app.main import create_app
    app = create_app()
    routes = enumerate_routes(app)
    print(f'枚举到 {len(routes)} 个端点（{len({r["module"] for r in routes})} 个模块）')

    admin = Admin(base, settings.auth_username, settings.auth_password)

    # ── 1) 上游（幂等 upsert）：内部服务令牌注入（不走用户身份验证）──
    from app.shared.auth import INTERNAL_TOKEN_HEADER, internal_token
    ups = admin.ok('GET', '/api/apihub/admin/upstreams')
    up = next((u for u in ups if u['slug'] == UPSTREAM_SLUG), None)
    auth_config = {'providers': [{'type': 'api_key_header',
                                  'header': INTERNAL_TOKEN_HEADER,
                                  'value': '{cred.token}'}],
                   'credential_fields': ['token'],
                   'transport': {'verify': True}}
    up_body = {'name': 'DouBlog 自身（本机回环）', 'slug': UPSTREAM_SLUG,
               'base_url': base, 'timeout_ms': 30000, 'max_retry': 0,
               'auth_config': auth_config}
    if up is None:
        up = admin.ok('POST', '/api/apihub/admin/upstreams', up_body)
        print(f"上游已创建: id={up['id']} base_url={base} max_retry=0")
    else:
        old_providers = (up.get('auth_config') or {}).get('providers')
        up = admin.ok('PUT', f"/api/apihub/admin/upstreams/{up['id']}", up_body)
        print(f"上游已更新: id={up['id']}")
    uid = up['id']

    # ── 2) 密钥池：凭证结构随 provider 变化——不匹配则整体重建 ──
    keys = admin.ok('GET', f'/api/apihub/admin/upstreams/{uid}/keys')
    fields_ok = all(set(k.get('credential') or {}) == {'token'} for k in keys) if keys else False
    if keys and not fields_ok:
        for k in keys:
            admin.ok('DELETE', f"/api/apihub/admin/upstreams/keys/{k['id']}")
        keys = []
        print('凭证结构已变（basic → 内部令牌），重建密钥池')
    if keys:
        print(f'密钥池已有 {len(keys)} 把，跳过')
    else:
        admin.ok('POST', f'/api/apihub/admin/upstreams/{uid}/keys',
                 {'credential': {'token': internal_token()}})
        print(f'密钥已注入（{INTERNAL_TOKEN_HEADER} 内部服务令牌，AES-GCM 密文落库）')

    # ── 3) API 注册（按 slug upsert；发布为 OpenAPI：self/模块 二级分组）──
    existing = admin.ok('GET', '/api/apihub/admin/apis')
    by_slug = {a['slug']: a for a in existing}
    created = updated = 0
    desired_ids = []
    for r in routes:
        body = {'upstream_id': uid, 'name': r['name'], 'slug': r['slug'],
                'description': f"模块 {r['module']}", 'method': r['method'],
                'path_tpl': r['path_tpl'],
                'group1': GROUP1, 'group2': r['module']}
        cur = by_slug.get(r['slug'])
        if cur is None:
            a = admin.ok('POST', '/api/apihub/admin/apis', body)
            created += 1
        elif (cur['method'] != r['method'] or cur['path_tpl'] != r['path_tpl']
              or cur.get('group1') != GROUP1 or cur.get('group2') != r['module']):
            a = admin.ok('PUT', f"/api/apihub/admin/apis/{cur['id']}", body)
            updated += 1
        else:
            a = cur
        desired_ids.append(a['id'])
    print(f'API 注册完成: 新建 {created}，更新 {updated}，共 {len(desired_ids)}'
          f'（OpenAPI 分组 {GROUP1}/<模块>）')

    stale = [a for a in existing if a['upstream_id'] == uid and a['id'] not in desired_ids]
    if stale:
        if prune:
            for a in stale:
                admin.ok('DELETE', f"/api/apihub/admin/apis/{a['id']}")
            print(f'已清理过期注册 {len(stale)} 条（--prune）')
        else:
            print(f'注意: {len(stale)} 条注册已不在当前路由表（重跑加 --prune 清理）')

    # ── 4) 限流规则（api 级逐条 + global；幂等=按 scope+api_id 查重）──
    rules = admin.ok('GET', '/api/apihub/admin/rules')
    api_rule_keys = {(r['scope'], r['api_id']) for r in rules if r['enabled']}
    for r, aid in zip(routes, desired_ids):
        if ('api', aid) in api_rule_keys:
            continue
        admin.ok('POST', '/api/apihub/admin/rules',
                 {'scope': 'api', 'api_id': aid, **rule_for_method(r['method'])})
    if not any(r['scope'] == 'global' and r['enabled'] for r in rules):
        admin.ok('POST', '/api/apihub/admin/rules',
                 {'scope': 'global', 'algorithm': 'token_bucket',
                  'rate_per_sec': GLOBAL_RATE, 'burst': GLOBAL_BURST})
    n_api_rules = sum(1 for r in admin.ok('GET', '/api/apihub/admin/rules') if r['scope'] == 'api')
    print(f'限流规则: api 级 {n_api_rules} 条（读 {READ_RATE}rps/写 {WRITE_RATE}rps）+ global '
          f'{GLOBAL_RATE}rps')

    # ── 5) 平台令牌（明文仅此一次）──
    tokens = admin.ok('GET', '/api/apihub/admin/tokens')
    tok = next((t for t in tokens if t['name'] == TOKEN_NAME), None)
    if tok and recreate_token:
        admin.ok('DELETE', f"/api/apihub/admin/tokens/{tok['id']}")
        tok = None
    if tok is None:
        tok_data = admin.ok('POST', '/api/apihub/admin/tokens', {'name': TOKEN_NAME})
        print(f"\n平台令牌已签发（仅显示一次，请妥善保存）:\n  {tok_data['key']}\n")
        tok_id = tok_data['id']
    else:
        print(f'平台令牌 {TOKEN_NAME} 已存在（id={tok["id"]}），沿用；换新请 --recreate-token')
        tok_id = tok['id']
    if not any(r['scope'] == 'token' and r.get('token_id') == tok_id and r['enabled']
               for r in admin.ok('GET', '/api/apihub/admin/rules')):
        admin.ok('POST', '/api/apihub/admin/rules',
                 {'scope': 'token', 'token_id': tok_id, 'algorithm': 'token_bucket',
                  'rate_per_sec': TOKEN_RATE, 'burst': TOKEN_BURST})
    print(f'令牌级限流: {TOKEN_RATE}rps')
    print('\n网关入口:')
    print(f'  OpenAPI:  ANY {base}/openapi/{GROUP1}/<模块>/<api名>   (Authorization: Bearer sk-…)')
    print(f'  OpenAPI 文档: GET {base}/openapi/{GROUP1}/<模块>/<api名>/doc（公开，Markdown）')
    print(f'  统一信封: POST {base}/api/apihub/gw/apis/<slug>   (Authorization: Bearer sk-…)')
    print(f'  透明代理: ANY {base}/api/apihub/gw/upstreams/{UPSTREAM_SLUG}/<原路径>')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', default='http://127.0.0.1:60100', help='本服务地址')
    ap.add_argument('--prune', action='store_true', help='清理已不存在的注册项')
    ap.add_argument('--recreate-token', action='store_true', help='重签平台令牌')
    args = ap.parse_args()
    register(args.base, prune=args.prune, recreate_token=args.recreate_token)
