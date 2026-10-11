"""API Hub 路由：管理端（Basic Auth）+ 网关（平台令牌 sk-，不走 Basic Auth）。

网关调用入口（外部调用方使用）：
- POST /api/apihub/gw/apis/<slug>              统一信封 {path, query, header, body}
- ANY  /api/apihub/gw/upstreams/<slug>/<path>  透明代理（原路径/query/body 透传）
鉴权：Authorization: Bearer sk-...（平台令牌，SHA-256 落库）

管道：令牌鉴权 → 授权(有效期/scope/IP/健康) → 多级限流(内存) → 配额预占 →
选 key(加权轮询) → 请求构建(模板+凭证注入+剥离入站凭证) → 上游转发(超时/换key重试) →
响应(透传/信封 + 错误归一化双通道) → 异步日志(writer 线程)。

请求执行模型：同步管道（含阻塞的上游 http.client 调用）经 _run_gw 提交到模块 SDK 池
apihub-gw（32 workers，不走 run_db 的共享 DB 池——网关常规路径不触库）；响应对象直接返回。
"""

import asyncio
import json
import math
import re
import threading
import time
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import case, func, select

from app.apihub.core import (DEFAULT_PROBE, Injection, LevelSpec, TemplateError,
                             apply_providers, generate_token, hash_token, level_key,
                             mask_secret, merge_probe, render, token_hint,
                             validate_auth_config)
from app.apihub.models import (ApihubApi, ApihubCallLog, ApihubHealthLog, ApihubKey,
                               ApihubRule, ApihubToken, ApihubUpstream)
from app.apihub.pool import UpstreamConnectError, UpstreamProtocolError, UpstreamTimeout
from app.apihub.state import get_state
from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.pools import get_pool
from app.shared.response import api_response
from app.shared.timestamps import _iso, _utcnow

router = APIRouter(prefix='/api/apihub', tags=['apihub'])

#: 管理端路由统一挂 Basic Auth；gw 路由走 sk- 平台令牌，不挂
_ADMIN_AUTH = [Depends(require_basic)]

STRIP_HEADERS = {
    'authorization', 'cookie', 'content-type', 'content-length', 'host', 'connection',
    'transfer-encoding', 'accept-encoding', 'keep-alive', 'proxy-authorization', 'te', 'upgrade',
}
PASSTHROUGH_RESP_HEADERS = {
    'content-type', 'content-disposition', 'content-language', 'cache-control', 'etag',
    'last-modified',
}


# ─── 工具 ───────────────────────────────────────────────────────────

async def _silent_json(request: Request):
    """get_json(silent=True) 等价：解析失败/空体返回 None。"""
    try:
        return await request.json()
    except Exception:
        return None


def _gw_err(status, code, message, headers=None):
    return JSONResponse({'code': status, 'error': code, 'message': message},
                        status_code=status, headers=headers or None)


async def _run_gw(fn):
    """网关同步管道执行器：模块 SDK 池（apihub-gw），不经 run_db 的共享 DB 池。

    网关常规路径（鉴权/限流/配额/转发/日志入队）全程不触数据库，走 DB 池会白付
    每请求 scoped_session 创建+回滚+回收的固定开销，且与其余模块抢 16 个共享 worker；
    仅 401/403 禁用 key 分支触库（该分支内就地清理会话）。"""
    fut = get_pool('apihub-gw', workers=32).submit(fn)
    return await asyncio.wrap_future(fut)


#: 平台令牌鉴权缓存：明文令牌串 → (过期时刻, 快照版本, 结果)；TTL 30s 且
#: 快照 reload（任何管理端改动）后立即失效——禁用/改配令牌即时生效，不放大窗口
_AUTH_CACHE_TTL_S = 30.0
_AUTH_CACHE_MAX = 512
_auth_cache: dict = {}


def _authenticate(request: Request):
    """平台令牌鉴权：Authorization: Bearer sk-... → 哈希查内存快照（短 TTL 版本门控缓存）。"""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.lower().startswith('bearer '):
        return None
    plain = auth_header[7:].strip()
    if not plain.startswith('sk-'):
        return None
    store = get_state(request.app).store
    now = time.monotonic()
    hit = _auth_cache.get(plain)
    if hit is not None and hit[0] > now and hit[1] == store.version:
        result = hit[2]
        if result is not None:   # 有效期仍逐次校验（不放大过期窗口）
            exp = result['expires_at']
            if exp is not None and exp < _utcnow():
                return None
        return result
    token = store.tokens.get(hash_token(plain))
    result = None
    if token is not None and token['status'] == 1:
        exp = token['expires_at']
        if exp is None or exp >= _utcnow():
            result = token
    if len(_auth_cache) >= _AUTH_CACHE_MAX:
        _auth_cache.clear()
    _auth_cache[plain] = (now + _AUTH_CACHE_TTL_S, store.version, result)
    return result


def _client_ip(request: Request):
    fwd = request.headers.get('X-Forwarded-For')
    if fwd:
        return fwd.split(',')[0].strip()
    return request.client.host if request.client else ''


def _disable_denied_key(state, key_id: int, status: int):
    """上游回 401/403：该 key 判定失效，落库禁用并刷新快照。

    运行在 apihub-gw 池（非 run_db 环境），触库分支就地清理线程会话。"""
    try:
        k = db.session.get(ApihubKey, key_id)
        if k is not None and k.status == 1:
            k.status = 2
            k.disabled_reason = f'upstream {status} (credential denied)'
        db.session.commit()
    except Exception:
        db.session.rollback()
    finally:
        db.session.remove()
    state.reload()


def _json_path(obj, path):
    node = obj
    for part in path.lstrip('$.').split('.'):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def _eval_response(response_cfg, status, body_bytes, charset):
    """错误归一化双通道：HTTP 状态 + body code（国内 API 常见 HTTP 200 + code 表错）。"""
    em = (response_cfg or {}).get('error_mapping') or {}
    ok = status < 400
    if em.get('http_statuses') and status in em['http_statuses']:
        ok = False
    if not ok:
        return False, str(status), f'upstream status {status}'
    bp_ = em.get('body_code_path')
    if bp_:
        try:
            data = json.loads(body_bytes.decode(charset or 'utf-8', errors='replace') or 'null')
        except (ValueError, UnicodeDecodeError):
            data = None
        if isinstance(data, dict):
            code = _json_path(data, bp_)
            if code is not None:
                success = {str(x) for x in (em.get('success_codes') or [0, 200, '0', 'OK', 'ok'])}
                if str(code) not in success:
                    msg = ''
                    if em.get('body_message_path'):
                        msg = str(_json_path(data, em['body_message_path']) or '')
                    return False, str(code), msg or f'upstream code {code}'
    return True, '0', 'ok'


def _url_for(up, key, path_tpl, path_vars):
    base = render(up['base_url'], {'cred': key.cred}) if '{' in up['base_url'] else up['base_url']
    path = render(path_tpl, {'cred': key.cred, 'path': path_vars}) if '{' in path_tpl else path_tpl
    return base.rstrip('/') + '/' + path.lstrip('/')


def _build_headers(inbound, inj: Injection):
    headers = {str(k): str(v) for k, v in (inbound or {}).items()
               if k.lower() not in STRIP_HEADERS}
    headers.update(inj.headers)
    return headers


# ─── 网关：invoke 统一信封 ──────────────────────────────────────────

@router.post('/gw/apis/{slug}')
async def gw_invoke(slug: str, request: Request):
    raw = await _silent_json(request)
    if not isinstance(raw, dict):
        raw = {}
    return await _run_gw(lambda: _gw_invoke_sync(request, slug, raw))


def _gw_invoke_sync(request: Request, slug: str, raw: dict):
    state = get_state(request.app)
    t0 = time.monotonic()
    token = _authenticate(request)
    if token is None:
        return _gw_err(401, 'unauthorized', '缺少/无效平台令牌（Authorization: Bearer sk-...）')

    api = state.store.apis.get(slug)
    if api is None:
        return _gw_err(404, 'not_found', f"API '{slug}' 不存在")
    if not api['enabled']:
        return _gw_err(503, 'api_disabled', f"API '{slug}' 已停用")
    up = state.store.upstreams.get(api['upstream_id'])
    if up is None or up['status'] != 1:
        return _gw_err(503, 'upstream_disabled', '上游已禁用')
    if state.monitor.state_of(api['id'], api['health_status'])['status'] == 'down':
        _log(state, token, api, up, None, 'invoke', api['method'], slug, None, t0, False, 'unhealthy')
        return _gw_err(503, 'unhealthy', f"API '{slug}' 健康状态为 down")

    if token['allowed_api_ids'] is not None and api['id'] not in token['allowed_api_ids']:
        return _gw_err(403, 'forbidden', '该令牌无权调用此 API')
    if token['allowed_ips']:
        ip = _client_ip(request)
        if ip not in token['allowed_ips']:
            return _gw_err(403, 'forbidden', f'客户端 IP {ip} 不在白名单')

    cr = state.limiter.check(state.store.build_levels(api['id'], token['id']))
    if not cr.allowed:
        _log(state, token, api, up, None, 'invoke', api['method'], slug, 429, t0, False,
             'rate_limited', rl_scope=cr.scope)
        return _gw_err(429, 'rate_limited', f"限流触发（层级 {cr.scope}）", headers={
            'Retry-After': str(max(1, math.ceil(cr.retry_after))),
            'X-RateLimit-Scope': cr.scope or '',
            'X-RateLimit-Limit': str(int(cr.limit)),
            'X-RateLimit-Remaining': str(int(cr.remaining)),
        })

    quota_reserved = False
    if token['quota_total'] is not None:
        used = state.store.quota_used.get(token['id'], 0)
        if used >= token['quota_total']:
            return _gw_err(429, 'quota_exceeded', f'配额已用尽: {used}/{token["quota_total"]}')
        state.store.quota_used[token['id']] = used + 1   # 预占-退还
        quota_reserved = True

    env_path = raw.get('path') or {}
    env_query = raw.get('query') or {}
    env_header = raw.get('header') or {}
    env_body = raw.get('body')

    req_cfg = api['request_cfg'] or {}
    body_cfg = req_cfg.get('body') or {}
    body_type = body_cfg.get('type', 'json')
    timeout_s = (api['timeout_ms'] or up['timeout_ms']) / 1000.0

    attempts = max(1, up['max_retry'] + 1)
    last_error = 'no_attempt'
    for _attempt in range(attempts):
        key = state.selector.next_key(up['id'], state.store.keys.get(up['id'], []))
        if key is None:
            last_error = (f'no_available_key(prev:{last_error})'
                          if last_error != 'no_attempt' else 'no_available_key')
            break
        try:
            url = _url_for(up, key, api['path_tpl'], env_path)
            inj = apply_providers(up['providers'], key.cred)
            headers = _build_headers(env_header, inj)
            params = {**env_query, **inj.query}

            body_json = body_data = body_content = None
            if api['method'] not in ('GET', 'HEAD') and env_body is not None:
                if body_type == 'json':
                    body_json = env_body
                    headers.setdefault('Content-Type', 'application/json')
                elif body_type == 'form':
                    body_data = env_body
                    headers.setdefault('Content-Type', 'application/x-www-form-urlencoded')
                else:  # raw
                    headers['Content-Type'] = body_cfg.get('content_type', 'application/octet-stream')
                    body_content = env_body.encode() if isinstance(env_body, str) else env_body

            if body_content is not None:
                payload = body_content if isinstance(body_content, bytes) else str(body_content).encode()
            elif body_json is not None:
                payload = json.dumps(body_json).encode()
            elif body_data is not None:
                payload = urlencode(body_data).encode()
            else:
                payload = b''
            if inj.cookies:
                headers['Cookie'] = '; '.join(f'{k}={v}' for k, v in inj.cookies.items())

            r = state.pool.request(api['method'], url, headers, params, payload,
                                   timeout_s, verify=up['transport'].get('verify', True))
        except TemplateError as e:
            if quota_reserved:
                state.store.quota_used[token['id']] -= 1
            return _gw_err(400, 'template_error', str(e))
        except UpstreamTimeout:
            last_error = 'timeout'
            continue
        except ValueError as e:
            last_error = str(e)[:60]
            continue
        except (UpstreamConnectError, UpstreamProtocolError, OSError) as e:
            # 连接错误仅在有备选 key 时计失败（唯一 key 不自我熔断）
            if len(state.store.keys.get(up['id'], [])) > 1:
                state.selector.note_failure(key.id, cooldown_s=10)
            last_error = f'conn_error:{type(e).__name__}'
            continue

        if r.status in (401, 403):
            _disable_denied_key(state, key.id, r.status)
            last_error = f'auth_{r.status}'
            continue

        state.selector.note_success(key.id)
        latency = int((time.monotonic() - t0) * 1000)
        charset = (api['response_cfg'] or {}).get('charset')
        ok, err_code, err_msg = _eval_response(api['response_cfg'], r.status, r.content, charset)
        _log(state, token, api, up, key.id, 'invoke', api['method'], slug, r.status, t0, ok,
             None if ok else f'upstream_code:{err_code}')
        quota_remaining = (token['quota_total'] - state.store.quota_used.get(token['id'], 0)) \
            if token['quota_total'] is not None else None
        return _gw_response(api['response_cfg'], r, latency, quota_remaining, ok, err_code, err_msg)

    if quota_reserved:
        state.store.quota_used[token['id']] -= 1
    _log(state, token, api, up, None, 'invoke', api['method'], slug, None, t0, False, last_error)
    if last_error == 'timeout':
        return _gw_err(504, 'upstream_timeout', '上游超时')
    return _gw_err(503, 'upstream_error', f'所有尝试失败: {last_error}')


def _gw_response(response_cfg, r, latency_ms, quota_remaining, ok, err_code, err_msg):
    cfg = response_cfg or {}
    charset = cfg.get('charset')
    if cfg.get('envelope', 'passthrough') != 'wrap':
        # media_type 对齐旧版 Response 默认 Content-Type（随后被上游透传头覆盖）
        resp = Response(r.content, status_code=r.status, media_type='text/html')
        for k in PASSTHROUGH_RESP_HEADERS & set(r.headers):
            resp.headers[k] = r.headers[k]
        resp.headers['X-Hub-Latency-Ms'] = str(latency_ms)
        return resp
    try:
        text = r.content.decode(charset or 'utf-8', errors='replace')
        data = json.loads(text) if text else None
        if not isinstance(data, (dict, list)):
            data = text
    except (ValueError, UnicodeDecodeError):
        data = r.content.decode(charset or 'utf-8', errors='replace')
    meta = {'upstream_status': r.status, 'latency_ms': latency_ms}
    if quota_remaining is not None:
        meta['quota_remaining'] = quota_remaining
    return JSONResponse({
        'code': 0 if ok else (int(err_code) if str(err_code).isdigit() else 1),
        'message': 'ok' if ok else err_msg,
        'data': data, 'meta': meta,
    })


# ─── 网关：透明代理 ─────────────────────────────────────────────────

@router.api_route('/gw/upstreams/{slug}/{upstream_path:path}',
                  methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
async def gw_passthrough(slug: str, upstream_path: str, request: Request):
    body = await request.body() or b''
    return await _run_gw(lambda: _gw_passthrough_sync(request, slug, upstream_path, body))


def _gw_passthrough_sync(request: Request, slug: str, upstream_path: str, body: bytes):
    state = get_state(request.app)
    t0 = time.monotonic()
    token = _authenticate(request)
    if token is None:
        return _gw_err(401, 'unauthorized', '缺少/无效平台令牌')
    up = state.store.upstreams_by_slug.get(slug)
    if up is None:
        return _gw_err(404, 'not_found', f"上游 '{slug}' 不存在")
    if up['status'] != 1:
        return _gw_err(503, 'upstream_disabled', '上游已禁用')

    levels = [lv for lv in state.store.build_levels(None, token['id'])
              if lv.scope in ('token', 'global')]
    cr = state.limiter.check(levels)
    if not cr.allowed:
        _log(state, token, None, up, None, 'passthrough', request.method,
             f'{slug}/{upstream_path}'[:250], 429, t0, False, 'rate_limited', rl_scope=cr.scope)
        return _gw_err(429, 'rate_limited', f"限流触发（层级 {cr.scope}）", headers={
            'Retry-After': str(max(1, math.ceil(cr.retry_after))),
            'X-RateLimit-Scope': cr.scope or '',
        })

    quota_reserved = False
    if token['quota_total'] is not None:
        used = state.store.quota_used.get(token['id'], 0)
        if used >= token['quota_total']:
            return _gw_err(429, 'quota_exceeded', f'配额已用尽: {used}/{token["quota_total"]}')
        state.store.quota_used[token['id']] = used + 1
        quota_reserved = True

    inbound = {k: v for k, v in request.headers.items() if k.lower() not in STRIP_HEADERS}
    query = dict(request.query_params)

    attempts = max(1, up['max_retry'] + 1)
    last_error = 'no_attempt'
    for _attempt in range(attempts):
        key = state.selector.next_key(up['id'], state.store.keys.get(up['id'], []))
        if key is None:
            last_error = (f'no_available_key(prev:{last_error})'
                          if last_error != 'no_attempt' else 'no_available_key')
            break
        try:
            url = _url_for(up, key, '/' + upstream_path, {})
            inj = apply_providers(up['providers'], key.cred)
            headers = _build_headers(inbound, inj)
            params = {**query, **inj.query}
            if inj.cookies:
                headers['Cookie'] = '; '.join(f'{k}={v}' for k, v in inj.cookies.items())
            r = state.pool.request(request.method, url, headers, params, body,
                                   up['timeout_ms'] / 1000.0,
                                   verify=up['transport'].get('verify', True))
        except TemplateError as e:
            if quota_reserved:
                state.store.quota_used[token['id']] -= 1
            return _gw_err(400, 'template_error', str(e))
        except UpstreamTimeout:
            last_error = 'timeout'
            continue
        except ValueError as e:
            last_error = str(e)[:60]
            continue
        except (UpstreamConnectError, UpstreamProtocolError, OSError) as e:
            if len(state.store.keys.get(up['id'], [])) > 1:
                state.selector.note_failure(key.id, cooldown_s=10)
            last_error = f'conn_error:{type(e).__name__}'
            continue

        if r.status in (401, 403):
            _disable_denied_key(state, key.id, r.status)
            last_error = f'auth_{r.status}'
            continue

        state.selector.note_success(key.id)
        latency = int((time.monotonic() - t0) * 1000)
        _log(state, token, None, up, key.id, 'passthrough', request.method,
             f'{slug}/{upstream_path}'[:250], r.status, t0, r.status < 400,
             None if r.status < 400 else f'http_{r.status}')
        resp = Response(r.content, status_code=r.status, media_type='text/html')
        for h in PASSTHROUGH_RESP_HEADERS & set(r.headers):
            resp.headers[h] = r.headers[h]
        resp.headers['X-Hub-Latency-Ms'] = str(latency)
        return resp

    if quota_reserved:
        state.store.quota_used[token['id']] -= 1
    _log(state, token, None, up, None, 'passthrough', request.method,
         f'{slug}/{upstream_path}'[:250], None, t0, False, last_error)
    if last_error == 'timeout':
        return _gw_err(504, 'upstream_timeout', '上游超时')
    return _gw_err(503, 'upstream_error', f'所有尝试失败: {last_error}')


def _log(state, token, api, up, key_id, mode, method, path_digest, status_code, t0, ok,
         error_type=None, rl_scope=None):
    state.writer.log(
        token_id=token['id'] if token else None,
        api_id=api['id'] if api else None,
        upstream_id=up['id'] if up else None,
        key_id=key_id, mode=mode, method=method,
        path_digest=str(path_digest)[:250], status_code=status_code,
        latency_ms=int((time.monotonic() - t0) * 1000), ok=ok,
        error_type=error_type, rl_scope=rl_scope,
    )


# ─── 探活 ───────────────────────────────────────────────────────────

def probe_api(app, api_id, source='manual'):
    """同步探测一个 API：构建探测请求（默认探 API 自身路径）→ 状态机 → 落库。"""
    state = get_state(app)
    api = state.store.apis_by_id.get(api_id)
    if api is None:
        return {'api_id': api_id, 'ok': False, 'detail': {'error': 'api not found'}}
    up = state.store.upstreams.get(api['upstream_id'])
    if up is None:
        return {'api_id': api_id, 'ok': False, 'detail': {'error': 'upstream not found'}}

    probe = merge_probe(api['probe'])
    if not (api['probe'] or {}).get('path'):
        probe['path'] = api['path_tpl']   # 默认探真实端点，避免误判 down 阻断流量

    keys = state.store.keys.get(up['id'], [])
    key = state.selector.next_key(up['id'], keys)
    cred = key.cred if key else {}
    started = time.monotonic()
    outcome = {'api_id': api_id, 'slug': api['slug'], 'name': api['name'],
               'ok': False, 'status_code': None, 'latency_ms': None,
               'detail': {}, 'new_status': 'unknown'}
    try:
        if key is None:
            # 无 key：空凭证渲染 base_url（模板需 {cred.x} 时抛错 → 探活失败，符合预期）
            url = render(up['base_url'], {'cred': {}}).rstrip('/') + '/' + probe['path'].lstrip('/')
        else:
            url = _url_for(up, key, probe['path'], {})
        inj = apply_providers(up['providers'], cred)
        headers = {str(k): str(v) for k, v in (probe.get('headers') or {}).items()}
        headers.update(inj.headers)
        payload = b''
        if probe.get('body') is not None:
            payload = json.dumps(probe['body']).encode()
            headers.setdefault('Content-Type', 'application/json')
        r = state.pool.request(probe['method'], url, headers, inj.query, payload,
                               max(0.5, probe['timeout_ms'] / 1000.0),
                               verify=up['transport'].get('verify', True))
        outcome['status_code'] = r.status
        outcome['latency_ms'] = int((time.monotonic() - started) * 1000)
        status_ok = r.status in (probe['expect_status'] or DEFAULT_PROBE['expect_status'])
        regex_ok = True
        if probe.get('expect_body_regex'):
            text = r.content.decode('utf-8', errors='replace') if len(r.content) < 65536 else ''
            try:
                regex_ok = re.search(probe['expect_body_regex'], text) is not None
            except re.error:
                regex_ok = False
        outcome['ok'] = status_ok and regex_ok
        outcome['detail'] = {'url': url, 'status_ok': status_ok, 'regex_ok': regex_ok}
    except Exception as e:  # noqa: BLE001
        outcome['latency_ms'] = int((time.monotonic() - started) * 1000)
        outcome['ok'] = False
        outcome['detail'] = {'error': f'{type(e).__name__}: {e}'[:300]}

    new_status = state.monitor.apply_result(api_id, probe, outcome['ok'])
    outcome['new_status'] = new_status
    state.monitor.state_of(api_id)['last_latency_ms'] = outcome['latency_ms']
    probed_at = _utcnow()
    try:
        db.session.add(ApihubHealthLog(api_id=api_id, source=source, ok=outcome['ok'],
                                       status_code=outcome['status_code'],
                                       latency_ms=outcome['latency_ms'],
                                       detail=outcome['detail']))
        row = db.session.get(ApihubApi, api_id)
        if row is not None:
            row.health_status = new_status
            row.last_probe_at = probed_at
            row.last_latency_ms = outcome['latency_ms']
        db.session.commit()
    except Exception:
        db.session.rollback()
    finally:
        db.session.remove()   # 对齐旧版 app context teardown 的会话回收
    # 快照同步（列表页直读快照，探活结果不再依赖 reload 才可见）
    snap = state.store.apis_by_id.get(api_id)
    if snap is not None:
        snap['health_status'] = new_status
        snap['last_probe_at'] = probed_at
        snap['last_latency_ms'] = outcome['latency_ms']
    return outcome


@router.post('/probes/run', dependencies=_ADMIN_AUTH)
async def probes_run(request: Request):
    body = await _silent_json(request) or {}
    api_ids = body.get('api_ids')
    app = request.app

    def _run():
        state = get_state(app)
        if api_ids:
            targets = [i for i in api_ids if i in state.store.apis_by_id]
        else:
            targets = list(state.store.apis_by_id.keys())
        ex = get_pool('apihub-probe', workers=10)
        return list(ex.map(lambda aid: probe_api(app, aid, 'manual'), targets))

    results = await run_db(_run)
    return api_response(results)


# ─── 管理端：上游 + 密钥池 ──────────────────────────────────────────

def _upstream_dict(app, u):
    state = get_state(app)
    # 优先用快照里的解密原文（reload 时已解密），避免列表页逐行重复 AES 解密
    snap = state.store.upstreams.get(u.id)
    if snap is not None:
        auth_cfg = snap.get('auth_config')
    else:
        try:
            auth_cfg = state.store.crypto.decrypt(bytes(u.auth_config_enc))
        except Exception:
            auth_cfg = {'_broken': True}
    d = u.to_dict(auth_config=auth_cfg)
    keys = state.store.keys.get(u.id, [])
    d['key_count'] = len(keys)
    d['key_enabled_count'] = sum(1 for k in keys if k.status == 1)
    return d


@router.get('/admin/upstreams', dependencies=_ADMIN_AUTH)
async def list_upstreams(request: Request):
    app = request.app

    def _run():
        rows = db.session.execute(select(ApihubUpstream).order_by(ApihubUpstream.id)).scalars().all()
        return api_response([_upstream_dict(app, u) for u in rows])
    return await run_db(_run)


@router.post('/admin/upstreams', dependencies=_ADMIN_AUTH)
async def create_upstream(request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        errors = validate_auth_config(body.get('auth_config') or {})
        if errors:
            return api_response(None, 400, 'auth_config 无效: ' + '; '.join(errors))
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', str(body.get('slug') or '')):
            return api_response(None, 400, 'slug 非法（字母数字_-，≤64）')
        if db.session.execute(select(ApihubUpstream).where(ApihubUpstream.slug == body['slug'])).scalar():
            return api_response(None, 400, f"slug '{body['slug']}' 已存在")
        u = ApihubUpstream(
            name=body.get('name') or body['slug'], slug=body['slug'],
            base_url=body.get('base_url') or '', timeout_ms=int(body.get('timeout_ms') or 30000),
            max_retry=int(body.get('max_retry') or 2),
            auth_config_enc=get_state(app).store.crypto.encrypt(body['auth_config']),
            status=int(body.get('status') or 1))
        db.session.add(u)
        db.session.commit()
        get_state(app).reload()
        return api_response(_upstream_dict(app, u))
    return await run_db(_run)


@router.put('/admin/upstreams/{uid}', dependencies=_ADMIN_AUTH)
async def update_upstream(uid: int, request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        u = db.session.get(ApihubUpstream, uid)
        if u is None:
            return api_response(None, 404, '上游不存在')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', str(body.get('slug') or '')):
            return api_response(None, 400, 'slug 非法（字母数字_-，≤64）')
        errors = validate_auth_config(body.get('auth_config') or {})
        if errors:
            return api_response(None, 400, 'auth_config 无效: ' + '; '.join(errors))
        dup = db.session.execute(select(ApihubUpstream).where(
            ApihubUpstream.slug == body.get('slug'), ApihubUpstream.id != uid)).scalar()
        if dup:
            return api_response(None, 400, 'slug 已存在')
        u.name = body.get('name') or u.name
        u.slug = body.get('slug') or u.slug
        u.base_url = body.get('base_url') or u.base_url
        u.timeout_ms = int(body.get('timeout_ms') or u.timeout_ms)
        u.max_retry = int(body.get('max_retry') if body.get('max_retry') is not None else u.max_retry)
        u.status = int(body.get('status') or 1)
        if body.get('auth_config'):
            u.auth_config_enc = get_state(app).store.crypto.encrypt(body['auth_config'])
        db.session.commit()
        get_state(app).reload()
        return api_response(_upstream_dict(app, u))
    return await run_db(_run)


@router.delete('/admin/upstreams/{uid}', dependencies=_ADMIN_AUTH)
async def delete_upstream(uid: int, request: Request):
    app = request.app

    def _run():
        u = db.session.get(ApihubUpstream, uid)
        if u is None:
            return api_response(None, 404, '上游不存在')
        n_apis = db.session.execute(select(func.count()).select_from(ApihubApi)
                                    .where(ApihubApi.upstream_id == uid)).scalar() or 0
        if n_apis:
            return api_response(None, 400, f'仍有 {n_apis} 个 API 引用该上游，请先删除')
        ApihubKey.query.filter_by(upstream_id=uid).delete()
        db.session.delete(u)
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


@router.get('/admin/upstreams/{uid}/keys', dependencies=_ADMIN_AUTH)
async def list_keys(uid: int, request: Request):
    app = request.app

    def _run():
        state = get_state(app)
        rows = db.session.execute(select(ApihubKey).where(ApihubKey.upstream_id == uid)
                                  .order_by(ApihubKey.id)).scalars().all()
        items = []
        for k in rows:
            try:
                cred = state.store.crypto.decrypt(bytes(k.credential_enc))
                masked = {f: mask_secret(str(v)) for f, v in cred.items()}
            except Exception:
                masked = {'_broken': True}
            items.append({'id': k.id, 'weight': k.weight, 'status': k.status,
                          'disabled_reason': k.disabled_reason, 'credential': masked,
                          'last_used_at': _iso(k.last_used_at),
                          'last_ok_at': _iso(k.last_ok_at)})
        return api_response(items)
    return await run_db(_run)


@router.post('/admin/upstreams/{uid}/keys', dependencies=_ADMIN_AUTH)
async def create_key(uid: int, request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        if db.session.get(ApihubUpstream, uid) is None:
            return api_response(None, 404, '上游不存在')
        cred = body.get('credential')
        if not isinstance(cred, dict) or not cred:
            return api_response(None, 400, 'credential 必须是非空对象')
        k = ApihubKey(upstream_id=uid, weight=max(1, int(body.get('weight') or 1)),
                      credential_enc=get_state(app).store.crypto.encrypt(cred))
        db.session.add(k)
        db.session.commit()
        get_state(app).reload()
        return api_response({'id': k.id, 'ok': True})
    return await run_db(_run)


@router.put('/admin/upstreams/keys/{kid}', dependencies=_ADMIN_AUTH)
async def update_key(kid: int, request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        k = db.session.get(ApihubKey, kid)
        if k is None:
            return api_response(None, 404, '密钥不存在')
        if body.get('weight') is not None:
            k.weight = max(1, int(body['weight']))
        if body.get('status') is not None:
            k.status = int(body['status'])
            if k.status == 1:
                k.disabled_reason = None
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


@router.delete('/admin/upstreams/keys/{kid}', dependencies=_ADMIN_AUTH)
async def delete_key(kid: int, request: Request):
    app = request.app

    def _run():
        k = db.session.get(ApihubKey, kid)
        if k is None:
            return api_response(None, 404, '密钥不存在')
        db.session.delete(k)
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


# ─── 管理端：API ────────────────────────────────────────────────────

def _api_dict(app, a):
    """a 可为 ORM 行或 Store 快照 dict（键名一致）——列表/详情统一装配。"""
    state = get_state(app)
    st = state.monitor.state_of(a.id, a.health_status)
    return {
        'id': a.id, 'upstream_id': a.upstream_id, 'name': a.name, 'slug': a.slug,
        'description': a.description or '', 'method': a.method, 'path_tpl': a.path_tpl,
        'request_cfg': a.request_cfg, 'response_cfg': a.response_cfg, 'timeout_ms': a.timeout_ms,
        'probe': a.probe, 'enabled': a.enabled,
        'health': {'status': st['status'], 'fails': st['fails'], 'succs': st['succs']},
        'health_status': a.health_status,
        'last_probe_at': _iso(a.last_probe_at),
        'last_latency_ms': a.last_latency_ms,
    }


class _SnapRow:
    """快照 dict 的属性行视图（_api_dict 兼容 ORM 行/快照两种来源）。"""
    __slots__ = ('id', 'upstream_id', 'name', 'slug', 'description', 'method', 'path_tpl',
                 'request_cfg', 'response_cfg', 'timeout_ms', 'probe', 'enabled',
                 'health_status', 'last_probe_at', 'last_latency_ms')

    def __init__(self, cfg: dict):
        for k in self.__slots__:
            setattr(self, k, cfg.get(k))


@router.get('/admin/apis', dependencies=_ADMIN_AUTH)
async def list_apis(request: Request):
    """列表直读内存快照（管理端任何改动都 reload，探活回写同步快照）——免每请求全表查询。"""
    state = get_state(request.app)
    return api_response([_api_dict(request.app, _SnapRow(cfg))
                         for cfg in sorted(state.store.apis_by_id.values(),
                                           key=lambda c: c['id'])])


@router.post('/admin/apis', dependencies=_ADMIN_AUTH)
async def create_api(request: Request):
    body = await _silent_json(request) or {}
    return await run_db(lambda: _upsert_api(request.app, None, body))


@router.put('/admin/apis/{aid}', dependencies=_ADMIN_AUTH)
async def update_api(aid: int, request: Request):
    body = await _silent_json(request) or {}
    return await run_db(lambda: _upsert_api(request.app, aid, body))


def _upsert_api(app, aid, body):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', str(body.get('slug') or '')):
        return api_response(None, 400, 'slug 非法')
    dup = db.session.execute(select(ApihubApi).where(
        ApihubApi.slug == body['slug'], ApihubApi.id != (aid or -1))).scalar()
    if dup:
        return api_response(None, 400, 'slug 已存在')
    if db.session.get(ApihubUpstream, body.get('upstream_id')) is None:
        return api_response(None, 400, 'upstream_id 不存在')
    if aid:
        a = db.session.get(ApihubApi, aid)
        if a is None:
            return api_response(None, 404, 'API 不存在')
    else:
        a = ApihubApi(slug=body['slug'])
        db.session.add(a)
    a.upstream_id = body['upstream_id']
    a.name = body.get('name') or body['slug']
    a.slug = body['slug']
    a.description = body.get('description') or ''
    a.method = str(body.get('method') or 'GET').upper()
    a.path_tpl = body.get('path_tpl') or '/'
    a.request_cfg = body.get('request_cfg')
    a.response_cfg = body.get('response_cfg')
    a.timeout_ms = body.get('timeout_ms')
    a.probe = merge_probe(body.get('probe')) if body.get('probe') else None
    a.enabled = bool(body.get('enabled', True))
    db.session.commit()
    get_state(app).reload()
    return api_response(_api_dict(app, a))


@router.delete('/admin/apis/{aid}', dependencies=_ADMIN_AUTH)
async def delete_api(aid: int, request: Request):
    app = request.app

    def _run():
        a = db.session.get(ApihubApi, aid)
        if a is None:
            return api_response(None, 404, 'API 不存在')
        db.session.delete(a)
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


# ─── 管理端：平台令牌 ───────────────────────────────────────────────

@router.get('/admin/tokens', dependencies=_ADMIN_AUTH)
async def list_tokens(request: Request):
    def _run():
        rows = db.session.execute(select(ApihubToken).order_by(ApihubToken.id)).scalars().all()
        return api_response([t.to_dict() for t in rows])
    return await run_db(_run)


@router.post('/admin/tokens', dependencies=_ADMIN_AUTH)
async def create_token(request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        plain = generate_token()
        t = ApihubToken(name=body.get('name') or 'token', key_hash=hash_token(plain),
                        key_hint=token_hint(plain), expires_at=body.get('expires_at'),
                        allowed_api_ids=body.get('allowed_api_ids'),
                        allowed_ips=body.get('allowed_ips'), quota_total=body.get('quota_total'))
        db.session.add(t)
        db.session.commit()
        get_state(app).reload()
        out = t.to_dict()
        out['key'] = plain   # 明文仅此一次
        return api_response(out)
    return await run_db(_run)


@router.put('/admin/tokens/{tid}', dependencies=_ADMIN_AUTH)
async def update_token(tid: int, request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        t = db.session.get(ApihubToken, tid)
        if t is None:
            return api_response(None, 404, '令牌不存在')
        for k in ('name', 'status', 'expires_at', 'allowed_api_ids', 'allowed_ips', 'quota_total'):
            if body.get(k) is not None:
                setattr(t, k, body[k])
        if body.get('quota_used_reset'):
            t.quota_used = 0
            get_state(app).store.quota_used[tid] = 0
        db.session.commit()
        get_state(app).reload()
        return api_response(t.to_dict())
    return await run_db(_run)


@router.delete('/admin/tokens/{tid}', dependencies=_ADMIN_AUTH)
async def delete_token(tid: int, request: Request):
    app = request.app

    def _run():
        t = db.session.get(ApihubToken, tid)
        if t is None:
            return api_response(None, 404, '令牌不存在')
        db.session.delete(t)
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


# ─── 管理端：限流规则 + 运营 ────────────────────────────────────────

SCOPES = {'token_api', 'api', 'token', 'global'}


def _validate_rule(body):
    if body.get('scope') not in SCOPES:
        return 'scope 非法'
    if body['scope'] == 'token_api' and (body.get('api_id') is None or body.get('token_id') is None):
        return 'scope=token_api 需要 api_id 与 token_id'
    if body['scope'] == 'api' and body.get('api_id') is None:
        return 'scope=api 需要 api_id'
    if body['scope'] == 'token' and body.get('token_id') is None:
        return 'scope=token 需要 token_id'
    if body.get('algorithm') not in ('token_bucket', 'fixed_window'):
        return 'algorithm 非法'
    if body['algorithm'] == 'token_bucket' and not (body.get('rate_per_sec') or 0) > 0:
        return 'token_bucket 需要 rate_per_sec > 0'
    if body['algorithm'] == 'fixed_window' and not (body.get('window_s') and body.get('max_count')):
        return 'fixed_window 需要 window_s 与 max_count'
    return None


@router.get('/admin/rules', dependencies=_ADMIN_AUTH)
async def list_rules(request: Request):
    app = request.app

    def _run():
        state = get_state(app)
        rows = db.session.execute(select(ApihubRule).order_by(ApihubRule.id)).scalars().all()
        items = []
        for r in rows:
            d = r.to_dict()
            if r.enabled:
                lv = LevelSpec(scope=r.scope, key=level_key(r.scope, r.api_id, r.token_id),
                               algorithm=r.algorithm,
                               rate_per_sec=r.rate_per_sec or 0.0, burst=r.burst or 1,
                               window_s=r.window_s or 1, max_count=r.max_count or 1)
                d['usage'] = state.limiter.snapshot(lv)
            else:
                d['usage'] = None
            items.append(d)
        return api_response(items)
    return await run_db(_run)


@router.post('/admin/rules', dependencies=_ADMIN_AUTH)
async def create_rule(request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        err = _validate_rule(body)
        if err:
            return api_response(None, 400, err)
        r = ApihubRule(**{k: body.get(k) for k in
                          ('scope', 'api_id', 'token_id', 'algorithm', 'rate_per_sec',
                           'burst', 'window_s', 'max_count', 'enabled')})
        db.session.add(r)
        db.session.commit()
        get_state(app).reload()
        return api_response(r.to_dict())
    return await run_db(_run)


@router.put('/admin/rules/{rid}', dependencies=_ADMIN_AUTH)
async def update_rule(rid: int, request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        r = db.session.get(ApihubRule, rid)
        if r is None:
            return api_response(None, 404, '规则不存在')
        err = _validate_rule(body)
        if err:
            return api_response(None, 400, err)
        for k in ('scope', 'api_id', 'token_id', 'algorithm', 'rate_per_sec',
                  'burst', 'window_s', 'max_count', 'enabled'):
            if body.get(k) is not None:
                setattr(r, k, body[k])
        db.session.commit()
        get_state(app).reload()
        return api_response(r.to_dict())
    return await run_db(_run)


@router.delete('/admin/rules/{rid}', dependencies=_ADMIN_AUTH)
async def delete_rule(rid: int, request: Request):
    app = request.app

    def _run():
        r = db.session.get(ApihubRule, rid)
        if r is None:
            return api_response(None, 404, '规则不存在')
        db.session.delete(r)
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


@router.get('/logs', dependencies=_ADMIN_AUTH)
async def list_logs(request: Request):
    def _run():
        q = select(ApihubCallLog).order_by(ApihubCallLog.id.desc()).limit(
            min(int(request.query_params.get('limit') or 200), 1000))
        if request.query_params.get('api_id'):
            q = q.where(ApihubCallLog.api_id == int(request.query_params['api_id']))
        if request.query_params.get('token_id'):
            q = q.where(ApihubCallLog.token_id == int(request.query_params['token_id']))
        rows = db.session.execute(q).scalars().all()
        return api_response([{
            'id': r.id, 'token_id': r.token_id, 'api_id': r.api_id, 'upstream_id': r.upstream_id,
            'key_id': r.key_id, 'mode': r.mode, 'method': r.method, 'path_digest': r.path_digest,
            'status_code': r.status_code, 'latency_ms': r.latency_ms, 'ok': r.ok,
            'error_type': r.error_type, 'rl_scope': r.rl_scope,
            'created_at': _iso(r.created_at),
        } for r in rows])
    return await run_db(_run)


@router.get('/stats/overview', dependencies=_ADMIN_AUTH)
async def stats_overview(request: Request):
    app = request.app

    def _run():
        state = get_state(app)
        since = _utcnow() - timedelta(hours=24)
        total = db.session.execute(select(func.count()).select_from(ApihubCallLog)
                                   .where(ApihubCallLog.created_at >= since)).scalar() or 0
        ok_cnt = db.session.execute(select(func.count()).select_from(ApihubCallLog)
                                    .where(ApihubCallLog.created_at >= since, ApihubCallLog.ok)).scalar() or 0
        per_api = db.session.execute(select(
            ApihubCallLog.api_id, func.count().label('calls'),
            func.sum(case((ApihubCallLog.ok, 1), else_=0)).label('oks'),
            func.avg(ApihubCallLog.latency_ms).label('avg_latency'),
        ).where(ApihubCallLog.created_at >= since, ApihubCallLog.api_id.isnot(None))
            .group_by(ApihubCallLog.api_id)).all()
        apis = {a.id: a for a in db.session.execute(select(ApihubApi)).scalars().all()}
        items = []
        for row in per_api:
            a = apis.get(row.api_id)
            calls, oks = int(row.calls), int(row.oks or 0)
            items.append({
                'api_id': row.api_id, 'slug': a.slug if a else str(row.api_id),
                'name': a.name if a else '', 'calls': calls, 'errors': calls - oks,
                'error_rate': round((calls - oks) / calls, 4) if calls else 0.0,
                'avg_latency_ms': int(row.avg_latency or 0),
                'health': state.monitor.state_of(row.api_id)['status'] if a else 'unknown',
                'enabled': bool(a.enabled) if a else False,
            })
        return api_response({
            'window_hours': 24, 'total_calls': int(total), 'total_ok': int(ok_cnt),
            'error_rate': round(1 - ok_cnt / total, 4) if total else 0.0,
            'per_api': items,
            'counts': {
                'apis': db.session.execute(select(func.count()).select_from(ApihubApi)).scalar() or 0,
                'upstreams': db.session.execute(select(func.count()).select_from(ApihubUpstream)).scalar() or 0,
                'tokens': db.session.execute(select(func.count()).select_from(ApihubToken)).scalar() or 0,
            },
        })
    return await run_db(_run)


# ─── 探活调度线程 ───────────────────────────────────────────────────

def start_apihub_loop(app):
    """daemon 调度线程：每秒检查到期探活（TESTING 模式跳过）。"""
    def _loop():
        ex = get_pool('apihub-probe', workers=10)
        while True:
            try:
                if getattr(app.state, 'testing', False):
                    time.sleep(1)
                    continue
                state = getattr(app.state, 'apihub', None)
                if state is not None:
                    for api_id, _probe in state.probe_due_apis():
                        ex.submit(probe_api, app, api_id, 'scheduled')
            except Exception:
                pass
            time.sleep(1)

    threading.Thread(target=_loop, name='apihub-scheduler', daemon=True).start()
