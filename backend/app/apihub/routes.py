"""API Hub 路由：管理端（Basic Auth）+ 网关（平台令牌 sk-，不走 Basic Auth）。

分类只有 system → api 两个维度：系统手动创建（类比 confcenter 的 namespace），
API 归属系统且路径模板映射到系统的 base_url 上；鉴权（providers + 凭证值）
明文内联在 API 的 auth_config（2026-10-17 起无密钥池，见 __init__.py 迁移）。

网关调用入口（外部调用方使用）：
- POST /api/apihub/gw/apis/<slug>               统一信封 {path, query, header, body}
- ANY  /api/apihub/gw/systems/<slug>/<path>     透明代理（原路径/query/body 透传，
  鉴权取该系统第一个 API 的 auth_config）
鉴权：Authorization: Bearer sk-...（平台令牌，SHA-256 落库）

管道：令牌鉴权 → 授权(有效期/scope/IP/健康) → 多级限流(内存) → 配额预占 →
请求构建(模板+凭证注入+剥离入站凭证) → 系统转发(超时重试) →
响应(透传/信封 + 错误归一化双通道) → 异步日志(writer 线程)。

请求执行模型：同步管道（含阻塞的上游 http.client 调用）经 _run_gw 提交到模块 SDK 池
apihub-gw（32 workers，不走 run_db 的共享 DB 池——网关常规路径不触库）；响应对象直接返回。
"""

import asyncio
import json
import orjson

from app.shared.response import FastJSONResponse
import math
import re
import threading
import time
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import case, func, select

from app.apihub.core import (DEFAULT_PROBE, Injection, LevelSpec, TemplateError,
                             apply_providers, generate_token, hash_token, level_key,
                             merge_probe, render, token_hint,
                             validate_auth_config)
from app.apihub.models import (ApihubApi, ApihubCallLog, ApihubHealthLog,
                               ApihubRule, ApihubToken, ApihubSystem)
from app.apihub.pool import UpstreamConnectError, UpstreamProtocolError, UpstreamTimeout
from app.apihub.proxy import load_proxy_config, save_proxy_config
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
    每请求 scoped_session 创建+回滚+回收的固定开销，且与其余模块抢 16 个共享 worker。"""
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
            data = orjson.loads(body_bytes.decode(charset or 'utf-8', errors='replace') or 'null')
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


def _url_for(system, cred, path_tpl, path_vars):
    base = render(system['base_url'], {'cred': cred}) if '{' in system['base_url'] else system['base_url']
    path = render(path_tpl, {'cred': cred, 'path': path_vars}) if '{' in path_tpl else path_tpl
    return base.rstrip('/') + '/' + path.lstrip('/')


def _auth_injection(state, api):
    """鉴权注入：取 API 内联 auth_config（providers + credential）；
    qq_bot 等动态令牌 provider 绑定 state.token_exchange（走共享池/出站代理）。"""
    auth_cfg = api['auth_config'] or {}
    def _fetch(provider, cred):
        return state.token_exchange.get(state.pool, provider, cred)
    return apply_providers(auth_cfg.get('providers') or [], auth_cfg.get('credential') or {},
                           token_fetch=_fetch)


def _system_default_auth(state, system_id) -> dict:
    """透明代理没有 API 上下文：取该系统第一个 API 的 auth_config（无 API 则空鉴权）。"""
    apis = state.store.apis_of_system(system_id)
    return apis[0]['auth_config'] if apis else {}


def _build_headers(inbound, inj: Injection):
    headers = {str(k): str(v) for k, v in (inbound or {}).items()
               if k.lower() not in STRIP_HEADERS}
    headers.update(inj.headers)
    return headers


def _merge_request_defaults(api, env_path, env_query, env_header, env_body):
    """请求四桶默认值合并（gw invoke 与 admin invoke 共用）。

    request_cfg 内可配：param_defaults（路径模板变量）/ query_defaults / header_defaults /
    body.defaults（JSON body 顶层字段）——调用方未传该参数时填充默认值，显式传值优先；
    body 默认值仅 JSON 类型且非 GET/HEAD 时生效。
    返回 (path, query, header, body, body_type, body_cfg)。"""
    req_cfg = api['request_cfg'] or {}
    body_cfg = req_cfg.get('body') or {}
    body_type = body_cfg.get('type', 'json')
    path = {**(req_cfg.get('param_defaults') or {}), **(env_path or {})}
    query = {**(req_cfg.get('query_defaults') or {}), **(env_query or {})}
    header = {**(req_cfg.get('header_defaults') or {}), **(env_header or {})}
    body = env_body
    body_defaults = body_cfg.get('defaults') or {}
    if body_defaults and api['method'] not in ('GET', 'HEAD'):
        if body is None:
            body = dict(body_defaults) if body_type == 'json' else None
        elif body_type == 'json' and isinstance(body, dict):
            body = {**body_defaults, **body}
    return path, query, header, body, body_type, body_cfg


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
        return _gw_err(503, 'api_disabled', f"API '{slug}' 已关闭，不可用")
    system = state.store.systems.get(api['system_id'])
    if system is None or system['status'] != 1:
        return _gw_err(503, 'system_disabled', '系统已禁用')
    if state.monitor.state_of(api['id'], api['health_status'])['status'] == 'down':
        _log(state, token, api, system, 'invoke', api['method'], slug, None, t0, False, 'unhealthy')
        return _gw_err(503, 'unhealthy', f"API '{slug}' 健康状态为 down")

    if token['allowed_api_ids'] is not None and api['id'] not in token['allowed_api_ids']:
        return _gw_err(403, 'forbidden', '该令牌无权调用此 API')
    if token['allowed_ips']:
        ip = _client_ip(request)
        if ip not in token['allowed_ips']:
            return _gw_err(403, 'forbidden', f'客户端 IP {ip} 不在白名单')

    cr = state.limiter.check(state.store.build_levels(api['id'], token['id']))
    if not cr.allowed:
        _log(state, token, api, system, 'invoke', api['method'], slug, 429, t0, False,
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

    env_path, env_query, env_header, env_body, body_type, body_cfg = _merge_request_defaults(
        api, raw.get('path') or {}, raw.get('query') or {},
        raw.get('header') or {}, raw.get('body'))
    timeout_s = (api['timeout_ms'] or system['timeout_ms']) / 1000.0
    cred = (api['auth_config'] or {}).get('credential') or {}

    attempts = max(1, system['max_retry'] + 1)
    last_error = 'no_attempt'
    for _attempt in range(attempts):
        try:
            url = _url_for(system, cred, api['path_tpl'], env_path)
            inj = _auth_injection(state, api)
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
                                   timeout_s, verify=system['transport'].get('verify', True))
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
            last_error = f'conn_error:{type(e).__name__}'
            continue

        if r.status in (401, 403):
            # 同一凭证重试无意义（无密钥池可换），直接失败
            last_error = f'auth_{r.status}'
            break

        latency = int((time.monotonic() - t0) * 1000)
        charset = (api['response_cfg'] or {}).get('charset')
        ok, err_code, err_msg = _eval_response(api['response_cfg'], r.status, r.content, charset)
        _log(state, token, api, system, 'invoke', api['method'], slug, r.status, t0, ok,
             None if ok else f'upstream_code:{err_code}')
        quota_remaining = (token['quota_total'] - state.store.quota_used.get(token['id'], 0)) \
            if token['quota_total'] is not None else None
        return _gw_response(api['response_cfg'], r, latency, quota_remaining, ok, err_code, err_msg)

    if quota_reserved:
        state.store.quota_used[token['id']] -= 1
    _log(state, token, api, system, 'invoke', api['method'], slug, None, t0, False, last_error)
    if last_error == 'timeout':
        return _gw_err(504, 'upstream_timeout', '系统转发超时')
    return _gw_err(503, 'upstream_error', f'所有尝试失败: {last_error}')


def _gw_response(response_cfg, r, latency_ms, quota_remaining, ok, err_code, err_msg):
    cfg = response_cfg or {}
    charset = cfg.get('charset')
    if cfg.get('envelope', 'passthrough') != 'wrap':
        # media_type 对齐旧版 Response 默认 Content-Type（随后被系统透传头覆盖）
        resp = Response(r.content, status_code=r.status, media_type='text/html')
        for k in PASSTHROUGH_RESP_HEADERS & set(r.headers):
            resp.headers[k] = r.headers[k]
        resp.headers['X-Hub-Latency-Ms'] = str(latency_ms)
        return resp
    try:
        text = r.content.decode(charset or 'utf-8', errors='replace')
        data = orjson.loads(text) if text else None
        if not isinstance(data, (dict, list)):
            data = text
    except (ValueError, UnicodeDecodeError):
        data = r.content.decode(charset or 'utf-8', errors='replace')
    meta = {'upstream_status': r.status, 'latency_ms': latency_ms}
    if quota_remaining is not None:
        meta['quota_remaining'] = quota_remaining
    return FastJSONResponse({
        'code': 0 if ok else (int(err_code) if str(err_code).isdigit() else 1),
        'message': 'ok' if ok else err_msg,
        'data': data, 'meta': meta,
    })


# ─── 网关：透明代理（路径映射到系统 base_url） ──────────────────────

@router.api_route('/gw/systems/{slug}/{system_path:path}',
                  methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
async def gw_passthrough(slug: str, system_path: str, request: Request):
    body = await request.body() or b''
    return await _run_gw(lambda: _gw_passthrough_sync(request, slug, system_path, body))


def _gw_passthrough_sync(request: Request, slug: str, system_path: str, body: bytes):
    state = get_state(request.app)
    t0 = time.monotonic()
    token = _authenticate(request)
    if token is None:
        return _gw_err(401, 'unauthorized', '缺少/无效平台令牌')
    system = state.store.systems_by_slug.get(slug)
    if system is None:
        return _gw_err(404, 'not_found', f"系统 '{slug}' 不存在")
    if system['status'] != 1:
        return _gw_err(503, 'system_disabled', '系统已禁用')

    levels = [lv for lv in state.store.build_levels(None, token['id'])
              if lv.scope in ('token', 'global')]
    cr = state.limiter.check(levels)
    if not cr.allowed:
        _log(state, token, None, system, 'passthrough', request.method,
             f'{slug}/{system_path}'[:250], 429, t0, False, 'rate_limited', rl_scope=cr.scope)
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

    # 透明代理无 API 上下文：鉴权取该系统第一个 API 的内联配置
    auth_cfg = _system_default_auth(state, system['id'])
    cred = auth_cfg.get('credential') or {}

    attempts = max(1, system['max_retry'] + 1)
    last_error = 'no_attempt'
    for _attempt in range(attempts):
        try:
            url = _url_for(system, cred, '/' + system_path, {})
            inj = _auth_injection(state, {'auth_config': auth_cfg})
            headers = _build_headers(inbound, inj)
            params = {**query, **inj.query}
            if inj.cookies:
                headers['Cookie'] = '; '.join(f'{k}={v}' for k, v in inj.cookies.items())
            r = state.pool.request(request.method, url, headers, params, body,
                                   system['timeout_ms'] / 1000.0,
                                   verify=system['transport'].get('verify', True))
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
            last_error = f'conn_error:{type(e).__name__}'
            continue

        if r.status in (401, 403):
            # 同一凭证重试无意义（无密钥池可换），直接失败
            last_error = f'auth_{r.status}'
            break

        latency = int((time.monotonic() - t0) * 1000)
        _log(state, token, None, system, 'passthrough', request.method,
             f'{slug}/{system_path}'[:250], r.status, t0, r.status < 400,
             None if r.status < 400 else f'http_{r.status}')
        resp = Response(r.content, status_code=r.status, media_type='text/html')
        for h in PASSTHROUGH_RESP_HEADERS & set(r.headers):
            resp.headers[h] = r.headers[h]
        resp.headers['X-Hub-Latency-Ms'] = str(latency)
        return resp

    if quota_reserved:
        state.store.quota_used[token['id']] -= 1
    _log(state, token, None, system, 'passthrough', request.method,
         f'{slug}/{system_path}'[:250], None, t0, False, last_error)
    if last_error == 'timeout':
        return _gw_err(504, 'upstream_timeout', '系统转发超时')
    return _gw_err(503, 'upstream_error', f'所有尝试失败: {last_error}')


def _log(state, token, api, system, mode, method, path_digest, status_code, t0, ok,
         error_type=None, rl_scope=None):
    state.writer.log(
        token_id=token['id'] if token else None,
        api_id=api['id'] if api else None,
        system_id=system['id'] if system else None,
        mode=mode, method=method,
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
    system = state.store.systems.get(api['system_id'])
    if system is None:
        return {'api_id': api_id, 'ok': False, 'detail': {'error': 'system not found'}}

    probe = merge_probe(api['probe'])
    if not (api['probe'] or {}).get('path'):
        probe['path'] = api['path_tpl']   # 默认探真实端点，避免误判 down 阻断流量

    cred = (api['auth_config'] or {}).get('credential') or {}
    started = time.monotonic()
    outcome = {'api_id': api_id, 'slug': api['slug'], 'name': api['name'],
               'ok': False, 'status_code': None, 'latency_ms': None,
               'detail': {}, 'new_status': 'unknown'}
    try:
        # 无凭证时以空 cred 渲染（模板需 {cred.x} 会抛错 → 探活失败，符合预期）
        url = _url_for(system, cred, probe['path'], {})
        inj = _auth_injection(state, api)
        headers = {str(k): str(v) for k, v in (probe.get('headers') or {}).items()}
        headers.update(inj.headers)
        payload = b''
        if probe.get('body') is not None:
            payload = json.dumps(probe['body']).encode()
            headers.setdefault('Content-Type', 'application/json')
        r = state.pool.request(probe['method'], url, headers, inj.query, payload,
                               max(0.5, probe['timeout_ms'] / 1000.0),
                               verify=system['transport'].get('verify', True))
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


# ─── 管理端：系统 ────────────────────────────────────────────────────

def _system_dict(app, s):
    state = get_state(app)
    d = s.to_dict()
    d['api_count'] = len(state.store.apis_of_system(s.id))
    return d


@router.get('/admin/systems', dependencies=_ADMIN_AUTH)
async def list_systems(request: Request):
    app = request.app

    def _run():
        rows = db.session.execute(select(ApihubSystem).order_by(ApihubSystem.id)).scalars().all()
        return api_response([_system_dict(app, s) for s in rows])
    return await run_db(_run)


@router.post('/admin/systems', dependencies=_ADMIN_AUTH)
async def create_system(request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', str(body.get('slug') or '')):
            return api_response(None, 400, 'slug 非法（字母数字_-，≤64）')
        if db.session.execute(select(ApihubSystem).where(ApihubSystem.slug == body['slug'])).scalar():
            return api_response(None, 400, f"slug '{body['slug']}' 已存在")
        s = ApihubSystem(
            name=body.get('name') or body['slug'], slug=body['slug'],
            base_url=body.get('base_url') or '', timeout_ms=int(body.get('timeout_ms') or 30000),
            max_retry=int(body.get('max_retry') or 2),
            transport=body.get('transport') or {},
            status=int(body.get('status') or 1))
        db.session.add(s)
        db.session.commit()
        get_state(app).reload()
        return api_response(_system_dict(app, s))
    return await run_db(_run)


@router.put('/admin/systems/{sid}', dependencies=_ADMIN_AUTH)
async def update_system(sid: int, request: Request):
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        s = db.session.get(ApihubSystem, sid)
        if s is None:
            return api_response(None, 404, '系统不存在')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', str(body.get('slug') or '')):
            return api_response(None, 400, 'slug 非法（字母数字_-，≤64）')
        dup = db.session.execute(select(ApihubSystem).where(
            ApihubSystem.slug == body.get('slug'), ApihubSystem.id != sid)).scalar()
        if dup:
            return api_response(None, 400, 'slug 已存在')
        s.name = body.get('name') or s.name
        s.slug = body.get('slug') or s.slug
        s.base_url = body.get('base_url') or s.base_url
        s.timeout_ms = int(body.get('timeout_ms') or s.timeout_ms)
        s.max_retry = int(body.get('max_retry') if body.get('max_retry') is not None else s.max_retry)
        s.status = int(body.get('status') or 1)
        if body.get('transport') is not None:
            s.transport = body['transport']
        db.session.commit()
        get_state(app).reload()
        return api_response(_system_dict(app, s))
    return await run_db(_run)


@router.delete('/admin/systems/{sid}', dependencies=_ADMIN_AUTH)
async def delete_system(sid: int, request: Request):
    app = request.app

    def _run():
        s = db.session.get(ApihubSystem, sid)
        if s is None:
            return api_response(None, 404, '系统不存在')
        n_apis = db.session.execute(select(func.count()).select_from(ApihubApi)
                                    .where(ApihubApi.system_id == sid)).scalar() or 0
        if n_apis:
            return api_response(None, 400, f'仍有 {n_apis} 个 API 引用该系统，请先删除')
        db.session.delete(s)
        db.session.commit()
        get_state(app).reload()
        return api_response({'ok': True})
    return await run_db(_run)


# ─── 管理端：出站代理（全局，/config 页读写） ────────────────────────

@router.get('/admin/proxy', dependencies=_ADMIN_AUTH)
async def get_proxy_config(request: Request):
    return api_response(load_proxy_config())


@router.put('/admin/proxy', dependencies=_ADMIN_AUTH)
async def put_proxy_config(request: Request):
    body = await _silent_json(request) or {}
    port = body.get('port')
    if port is not None and not (isinstance(port, int) and 1 <= port <= 65535):
        return api_response(None, 400, 'port 必须是 1-65535 的整数')
    host = str(body.get('host') or '').strip()
    if body.get('enabled') and not host:
        return api_response(None, 400, '启用代理时 host 不能为空')
    cfg = save_proxy_config({'enabled': bool(body.get('enabled')),
                             'host': host, 'port': port})
    # 配置变更即生效：清掉按旧代理键缓存的空闲连接
    get_state(request.app).pool.close_all()
    return api_response(cfg)


@router.post('/admin/proxy/test', dependencies=_ADMIN_AUTH)
async def test_proxy(request: Request):
    """经当前代理配置探测外网连通性（GET https://bots.qq.com/，任意 HTTP 状态都证明隧道通）。"""
    state = get_state(request.app)
    t0 = time.monotonic()
    try:
        r = state.pool.request('GET', 'https://bots.qq.com/', {}, {}, b'', 8.0)
        return api_response({'ok': True, 'status_code': r.status,
                             'latency_ms': int((time.monotonic() - t0) * 1000),
                             'proxy': load_proxy_config()})
    except Exception as e:  # noqa: BLE001 - 连通性问题以失败信封返回
        return api_response({'ok': False, 'error': f'{type(e).__name__}: {e}'[:200],
                             'latency_ms': int((time.monotonic() - t0) * 1000),
                             'proxy': load_proxy_config()})


# ─── 管理端：API ────────────────────────────────────────────────────

def _api_dict(app, a):
    """a 可为 ORM 行或 Store 快照 dict（键名一致）——列表/详情统一装配。"""
    state = get_state(app)
    st = state.monitor.state_of(a.id, a.health_status)
    return {
        'id': a.id, 'system_id': a.system_id, 'name': a.name, 'slug': a.slug,
        'description': a.description or '', 'method': a.method, 'path_tpl': a.path_tpl,
        'auth_config': a.auth_config,
        'request_cfg': a.request_cfg, 'response_cfg': a.response_cfg, 'timeout_ms': a.timeout_ms,
        'probe': a.probe, 'enabled': a.enabled,
        'health': {'status': st['status'], 'fails': st['fails'], 'succs': st['succs']},
        'health_status': a.health_status,
        'last_probe_at': _iso(a.last_probe_at),
        'last_latency_ms': a.last_latency_ms,
    }


class _SnapRow:
    """快照 dict 的属性行视图（_api_dict 兼容 ORM 行/快照两种来源）。"""
    __slots__ = ('id', 'system_id', 'name', 'slug', 'description', 'method', 'path_tpl',
                 'auth_config', 'request_cfg', 'response_cfg', 'timeout_ms', 'probe',
                 'enabled', 'health_status', 'last_probe_at', 'last_latency_ms')

    def __init__(self, cfg: dict):
        for k in self.__slots__:
            setattr(self, k, cfg.get(k))


@router.get('/admin/apis', dependencies=_ADMIN_AUTH)
async def list_apis(request: Request, system_id: int | None = Query(None)):
    """列表直读内存快照（管理端任何改动都 reload，探活回写同步快照）——免每请求全表查询。
    system_id 可选：系统详情页只取该系统的 API。"""
    state = get_state(request.app)
    cfgs = state.store.apis_by_id.values()
    if system_id is not None:
        cfgs = [c for c in cfgs if c['system_id'] == system_id]
    return api_response([_api_dict(request.app, _SnapRow(cfg))
                         for cfg in sorted(cfgs, key=lambda c: c['id'])])


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
    if db.session.get(ApihubSystem, body.get('system_id')) is None:
        return api_response(None, 400, 'system_id 不存在')
    auth_cfg = body.get('auth_config')
    if auth_cfg is not None:
        errors = validate_auth_config(auth_cfg)
        if errors:
            return api_response(None, 400, 'auth_config 无效: ' + '; '.join(errors))
    if aid:
        a = db.session.get(ApihubApi, aid)
        if a is None:
            return api_response(None, 404, 'API 不存在')
    else:
        a = ApihubApi(slug=body['slug'])
        db.session.add(a)
    a.system_id = body['system_id']
    a.name = body.get('name') or body['slug']
    a.slug = body['slug']
    a.description = body.get('description') or ''
    a.method = str(body.get('method') or 'GET').upper()
    a.path_tpl = body.get('path_tpl') or '/'
    if auth_cfg is not None:
        a.auth_config = auth_cfg
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


@router.post('/admin/apis/{aid}/invoke', dependencies=_ADMIN_AUTH)
async def admin_invoke_api(aid: int, request: Request):
    """页面调试调用：管理端直发一次系统请求（不走平台令牌/限流/配额，mode='test' 记日志），
    返回原始系统状态/延迟/响应体——/apihub 页「调用」弹窗用。"""
    raw = await _silent_json(request)
    if not isinstance(raw, dict):
        raw = {}
    return await _run_gw(lambda: _admin_invoke_sync(request.app, aid, raw))


def _admin_invoke_sync(app, aid: int, raw: dict):
    state = get_state(app)
    t0 = time.monotonic()
    api = state.store.apis_by_id.get(aid)
    if api is None:
        return _gw_err(404, 'not_found', 'API 不存在')
    if not api['enabled']:
        return _gw_err(503, 'api_disabled', f"API '{api['slug']}' 已关闭，不可用")
    system = state.store.systems.get(api['system_id'])
    if system is None or system['status'] != 1:
        return _gw_err(503, 'system_disabled', '系统已禁用')

    # 与 gw invoke 相同的四桶默认值语义（_merge_request_defaults）
    env_path, env_query, env_header, env_body, body_type, body_cfg = _merge_request_defaults(
        api, raw.get('path') or {}, raw.get('query') or {},
        raw.get('header') or {}, raw.get('body'))
    timeout_s = (api['timeout_ms'] or system['timeout_ms']) / 1000.0
    cred = (api['auth_config'] or {}).get('credential') or {}

    attempts = max(1, system['max_retry'] + 1)
    last_error = 'no_attempt'
    for _attempt in range(attempts):
        try:
            url = _url_for(system, cred, api['path_tpl'], env_path)
            inj = _auth_injection(state, api)
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
                else:
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
                                   timeout_s, verify=system['transport'].get('verify', True))
        except TemplateError as e:
            return _gw_err(400, 'template_error', str(e))
        except UpstreamTimeout:
            last_error = 'timeout'
            continue
        except ValueError as e:
            last_error = str(e)[:60]
            continue
        except (UpstreamConnectError, UpstreamProtocolError, OSError) as e:
            last_error = f'conn_error:{type(e).__name__}'
            continue

        if r.status in (401, 403):
            # 同一凭证重试无意义（无密钥池可换），直接失败
            last_error = f'auth_{r.status}'
            break

        latency = int((time.monotonic() - t0) * 1000)
        charset = (api['response_cfg'] or {}).get('charset')
        ok, err_code, err_msg = _eval_response(api['response_cfg'], r.status, r.content, charset)
        _log(state, None, api, system, 'test', api['method'], api['slug'],
             r.status, t0, ok, None if ok else f'upstream_code:{err_code}')
        try:
            parsed = orjson.loads(r.content) if r.content else None
            if not isinstance(parsed, (dict, list, int, float, bool, type(None))):
                parsed = r.content.decode(charset or 'utf-8', errors='replace')
        except (ValueError, UnicodeDecodeError):
            parsed = r.content.decode(charset or 'utf-8', errors='replace')
        return api_response({'status_code': r.status, 'latency_ms': latency, 'ok': ok,
                             'body': parsed})

    _log(state, None, api, system, 'test', api['method'], api['slug'],
         None, t0, False, last_error)
    if last_error == 'timeout':
        return _gw_err(504, 'upstream_timeout', '系统转发超时')
    return _gw_err(503, 'upstream_error', f'所有尝试失败: {last_error}')


# ─── 管理端：调用文档（Markdown，前端「文档」弹窗渲染） ─────────────

_PATH_VAR_RE = re.compile(r'\{path\.(\w+)\}')


def _sample_value(v):
    """默认值 → 文档示例串（字符串原样，其余 JSON 化）。"""
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)


@router.get('/admin/apis/{aid}/doc', dependencies=_ADMIN_AUTH)
async def api_doc(aid: int, request: Request):
    """单个 API 的调用文档：元信息 + 认证 + 参数表（含默认值）+ 可直接复制的调用示例。

    示例参数全部取自 request_cfg 默认值（未配置默认值的路径变量用 <var> 占位），
    与「调用」弹窗的预填一致——照抄即可发起一次完整调用。"""
    state = get_state(request.app)
    api = state.store.apis_by_id.get(aid)
    if api is None:
        return api_response(None, 404, 'API 不存在')
    system = state.store.systems.get(api['system_id'])
    base = str(request.base_url).rstrip('/')
    req_cfg = api['request_cfg'] or {}
    body_cfg = req_cfg.get('body') or {}
    body_type = body_cfg.get('type', 'json')
    param_defaults = req_cfg.get('param_defaults') or {}
    query_defaults = req_cfg.get('query_defaults') or {}
    header_defaults = req_cfg.get('header_defaults') or {}
    body_defaults = body_cfg.get('defaults') or {}
    path_vars = _PATH_VAR_RE.findall(api['path_tpl'])

    # 调用示例的参数集 = 默认值（调用方不传时网关自动填充）
    ex_path = {**param_defaults}
    ex_query = dict(query_defaults)
    ex_header = dict(header_defaults)
    ex_body = dict(body_defaults) if (body_defaults and api['method'] not in ('GET', 'HEAD')) else None

    lines = [
        f"# {api['name']}（`{api['slug']}`）",
        '',
        f"> {api['description'] or api['name']}",
        '',
        '| 项目 | 值 |',
        '|---|---|',
        f"| 所属系统 | {system['name'] if system else api['system_id']}（`{system['base_url'] if system else ''}`） |",
        f"| 方法 | `{api['method']}` |",
        f"| 系统路径模板 | `{api['path_tpl']}` |",
        f"| 统一信封调用 | `POST {base}/api/apihub/gw/apis/{api['slug']}` |",
        f"| 透明代理 | `ANY {base}/api/apihub/gw/systems/{system['slug'] if system else '<system>'}/<原路径>` |",
        '',
        '## 认证',
        '',
        '请求头携带 API Hub 平台令牌：`Authorization: Bearer sk-...`；',
        '系统侧身份验证由网关注入，调用方无需（也不应）携带内部凭据。',
        '',
        '## 参数与默认值',
        '',
        '调用方未传的参数若在下表有默认值，网关自动填充；显式传值优先。',
        '',
    ]
    if path_vars or param_defaults:
        lines.append('| 路径变量 | 默认值 | 说明 |')
        lines.append('|---|---|---|')
        for v in path_vars:
            dv = param_defaults.get(v)
            lines.append(f"| `{v}` | {_sample_value(dv) if dv is not None else '必填'} |"
                         f" 填入路径模板 `{ '{path.' + v + '}' }` |")
        for k, v in param_defaults.items():
            if k not in path_vars:
                lines.append(f"| `{k}` | {_sample_value(v)} | 路径变量（模板未引用，保留） |")
        lines.append('')
    else:
        lines += ['本接口无路径变量。', '']
    if query_defaults:
        lines.append('| Query 参数 | 默认值 |')
        lines.append('|---|---|')
        for k, v in query_defaults.items():
            lines.append(f"| `{k}` | {_sample_value(v)} |")
        lines.append('')
    if header_defaults:
        lines.append('| 请求头 | 默认值 |')
        lines.append('|---|---|')
        for k, v in header_defaults.items():
            lines.append(f"| `{k}` | {_sample_value(v)} |")
        lines.append('')
    if body_defaults or api['method'] not in ('GET', 'HEAD'):
        lines.append('| Body 字段 | 默认值 |')
        lines.append('|---|---|')
        if body_defaults:
            for k, v in body_defaults.items():
                lines.append(f"| `{k}` | {_sample_value(v)} |")
        else:
            lines.append(f"| （无预置默认） | body 类型 `{body_type}` |")
        lines.append('')

    # 统一信封示例：四桶全部带上（默认值已填），照抄即可调用
    env = {'path': ex_path}
    if ex_query:
        env['query'] = ex_query
    if ex_header:
        env['header'] = ex_header
    if ex_body is not None:
        env['body'] = ex_body
    lines += [
        '## 调用示例（统一信封，参数齐全可直接复制）',
        '',
        '```bash',
        f"curl -X POST '{base}/api/apihub/gw/apis/{api['slug']}' \\",
        "  -H 'Authorization: Bearer sk-...' \\",
        "  -H 'Content-Type: application/json' \\",
        f"  -d '{json.dumps(env, ensure_ascii=False)}'",
        '```',
        '',
    ]
    # 透明代理示例：路径变量代入默认值
    pt_path = api['path_tpl']
    for v in path_vars:
        pt_path = pt_path.replace('{path.' + v + '}', str(param_defaults.get(v, '<' + v + '>')))
    if system:
        q = ('?' + urlencode(ex_query)) if ex_query else ''
        lines += [
            '## 调用示例（透明代理）',
            '',
            '```bash',
            f"curl -X {api['method']} '{base}/api/apihub/gw/systems/{system['slug']}"
            f"{pt_path}{q}' \\",
            "  -H 'Authorization: Bearer sk-...'",
            '```',
            '',
        ]
    if api.get('probe'):
        probe = api['probe']
        lines += [
            '## 探活',
            '',
            f"路径 `{probe.get('path') or api['path_tpl']}`、间隔 {probe.get('interval_s', 0)}s"
            f"（0=不定时）；当前健康状态 **{api['health_status']}**。",
            '',
        ]
    return Response('\n'.join(lines), media_type='text/markdown; charset=utf-8')


@router.put('/admin/apis/{aid}/enabled', dependencies=_ADMIN_AUTH)
async def toggle_api(aid: int, request: Request):
    """一键启停（管理页行内开关）：关闭后 gw 调用立即 503 已关闭，不可用。"""
    body = await _silent_json(request) or {}
    app = request.app

    def _run():
        a = db.session.get(ApihubApi, aid)
        if a is None:
            return api_response(None, 404, 'API 不存在')
        a.enabled = bool(body.get('enabled'))
        db.session.commit()
        get_state(app).reload()
        return api_response(_api_dict(app, a))
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
            'id': r.id, 'token_id': r.token_id, 'api_id': r.api_id, 'system_id': r.system_id,
            'mode': r.mode, 'method': r.method, 'path_digest': r.path_digest,
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
                'systems': db.session.execute(select(func.count()).select_from(ApihubSystem)).scalar() or 0,
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
