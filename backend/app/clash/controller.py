"""
mihomo 控制器复用层：代理组/节点切换、延迟测速、连接管理、规则、运行时配置、
Provider 热更新——与 clashctl 的 Web 控制台（zashboard）同源同能力，全部转发
mihomo external-controller REST API（127.0.0.1:EXT_PORT + Bearer secret）。

- 控制器地址/密钥从 runtime.yaml 解析（external-controller / secret），
  **secret 只留在后端**，响应里不回传明文
- requests 会话 trust_env=False：不吃进程代理 env（目标就是本机控制器）
- 控制器不可达（内核未运行）→ ServiceUnavailableError（"内核未运行"），
  mihomo 返回 4xx → ParamError 透传其 message
- 名称经 urllib.parse.quote(safe='') 进路径段（组名含 emoji/中文/空格）
"""
import os
import urllib.parse

import requests
import yaml
from lizysdk.errors import ParamError, ServiceUnavailableError

#: 延迟测试默认目标（与 zashboard 一致，走节点出网）
DEFAULT_TEST_URL = 'http://www.gstatic.com/generate_204'

#: 各类调用的 HTTP 超时（秒）：控制器本体很短；整组测速/Provider 更新要等出网
TIMEOUT_FAST = 5
TIMEOUT_DELAY = 20
TIMEOUT_GROUP_DELAY = 90
TIMEOUT_PROVIDER = 60

#: 策略组类型（其余视为节点）
GROUP_TYPES = ('Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay')

_session = requests.Session()
_session.trust_env = False          # 不吃 http_proxy 等环境代理


def _controller_info():
    """(base_url, secret, 原始 external-controller)——解析失败抛 ParamError。"""
    from app.clash import service
    path = os.path.join(service.resources_dir(), 'runtime.yaml')
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            cfg = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError):
        raise ParamError(message=f'运行时配置不可读：{path}') from None
    addr = (cfg.get('external-controller') or '').strip()
    if not addr:
        raise ParamError(message='runtime.yaml 未配置 external-controller（控制器不可用）')
    host, _, port = addr.rpartition(':')
    if host in ('0.0.0.0', '*', '', '[::]'):
        host = '127.0.0.1'
    host = host.strip('[]')
    return f'http://{host}:{port}', str(cfg.get('secret') or ''), addr


def _req(method: str, path: str, body=None, timeout=TIMEOUT_FAST, params=None):
    base, secret, _ = _controller_info()
    try:
        resp = _session.request(
            method, base + path, json=body, params=params, timeout=timeout,
            headers={'Authorization': f'Bearer {secret}'})
    except requests.RequestException:
        raise ServiceUnavailableError(
            message='控制器不可达（内核未运行？）——请先开启代理内核') from None
    if resp.status_code >= 400:
        try:
            msg = (resp.json() or {}).get('message') or resp.text
        except ValueError:
            msg = resp.text
        raise ParamError(message=(msg or f'控制器返回 {resp.status_code}')[:200])
    if resp.status_code == 204 or not resp.content:
        return {}
    return resp.json()


def _q(name: str) -> str:
    return urllib.parse.quote(name, safe='')


# ─── 运行时配置（PATCH 热切换，不重启——与 zashboard 一致）────

CONFIG_FIELDS = ('mode', 'allow-lan', 'log-level')


def configs_get() -> dict:
    cfg = _req('GET', '/configs')
    return {k: cfg.get(k) for k in (
        'mode', 'allow-lan', 'log-level', 'port', 'socks-port', 'mixed-port',
        'bind-address', 'ipv6', 'tun')}


def configs_patch(patch: dict) -> dict:
    allowed = ('rule', 'global', 'direct')
    clean = {}
    if 'mode' in patch:
        if patch['mode'] not in allowed:
            raise ParamError(message='mode 只能是 rule / global / direct')
        clean['mode'] = patch['mode']
    if 'allow-lan' in patch:
        clean['allow-lan'] = bool(patch['allow-lan'])
    if 'log-level' in patch:
        if patch['log-level'] not in ('debug', 'info', 'warning', 'error', 'silent'):
            raise ParamError(message='log-level 只能是 debug / info / warning / error / silent')
        clean['log-level'] = patch['log-level']
    if not clean:
        raise ParamError(message='没有可更新的字段（mode / allow-lan / log-level）')
    _req('PATCH', '/configs', body=clean)
    return configs_get()


def version() -> dict:
    return _req('GET', '/version')


# ─── 代理组 / 节点 / 延迟测速 ─────────────────────────────

def _shape_proxy(p: dict) -> dict:
    history = p.get('history') or []
    return {
        'name': p.get('name'),
        'type': p.get('type'),
        'udp': p.get('udp'),
        'alive': p.get('alive'),
        # 最近一次延迟（ms；0 = 失败/超时；null = 未测过）
        'delay': history[-1]['delay'] if history else None,
    }


def proxies_list() -> dict:
    """策略组（含 GLOBAL 汇总组）+ 每组节点明细（名称/类型/存活/最近延迟）。"""
    proxies = _req('GET', '/proxies').get('proxies') or {}
    groups = []
    for name, p in proxies.items():
        if p.get('type') not in GROUP_TYPES or not p.get('all'):
            continue
        groups.append({
            'name': name,
            'type': p.get('type'),
            'now': p.get('now') or '',
            'fixed': p.get('fixed'),
            'nodes': [_shape_proxy(proxies.get(n) or {'name': n})
                      for n in p['all']],
        })
    return {'groups': groups}


def proxy_select(group: str, name: str) -> dict:
    if not group or not name:
        raise ParamError(message='缺少 group 或 name')
    _req('PUT', f'/proxies/{_q(group)}', body={'name': name})
    return {'group': group, 'now': name}


def _check_test_url(url: str) -> str:
    from app.clash.service import _URL_RE
    if not isinstance(url, str) or not _URL_RE.match(url) or len(url) > 2048:
        raise ParamError(message='url 必须以 http(s):// 开头且不含空格/引号')
    return url


def proxy_delay(name: str, url: str = '', timeout_ms: int = 5000) -> dict:
    """单节点延迟测试 → {delay: ms}（失败/超时 → 400 透传 mihomo 报错）。"""
    if not name:
        raise ParamError(message='缺少节点名')
    timeout_ms = max(500, min(int(timeout_ms), 30000))
    return _req('GET', f'/proxies/{_q(name)}/delay',
                params={'url': _check_test_url(url or DEFAULT_TEST_URL),
                        'timeout': timeout_ms},
                timeout=TIMEOUT_DELAY)


def group_delay(group: str, url: str = '', timeout_ms: int = 5000) -> dict:
    """整组并发测速 → {节点名: 延迟ms}（mihomo 并发执行，耗时≈单节点）。"""
    if not group:
        raise ParamError(message='缺少组名')
    timeout_ms = max(500, min(int(timeout_ms), 30000))
    return _req('GET', f'/group/{_q(group)}/delay',
                params={'url': _check_test_url(url or DEFAULT_TEST_URL),
                        'timeout': timeout_ms},
                timeout=TIMEOUT_GROUP_DELAY)


# ─── 连接 ────────────────────────────────────────────────

def connections_get() -> dict:
    data = _req('GET', '/connections')
    conns = []
    for c in data.get('connections') or []:
        m = c.get('metadata') or {}
        conns.append({
            'id': c.get('id'),
            'host': m.get('host') or m.get('sniffHost') or m.get('destinationIP') or '',
            'network': m.get('network'),
            'type': m.get('type'),
            'rule': c.get('rule'),
            'rulePayload': c.get('rulePayload'),
            'chains': c.get('chains') or [],
            'upload': c.get('upload') or 0,
            'download': c.get('download') or 0,
            'start': c.get('start'),
            'source': f"{m.get('sourceIP') or ''}:{m.get('sourcePort') or ''}",
        })
    return {
        'uploadTotal': data.get('uploadTotal') or 0,
        'downloadTotal': data.get('downloadTotal') or 0,
        'memory': data.get('memory'),
        'connections': conns,
    }


def connection_close(conn_id: str) -> dict:
    if not conn_id:
        raise ParamError(message='缺少连接 id')
    _req('DELETE', f'/connections/{_q(conn_id)}')
    return {'closed': conn_id}


def connections_close_all() -> dict:
    _req('DELETE', '/connections')
    return {'closed': 'all'}


# ─── 规则 ────────────────────────────────────────────────

def rules_get() -> dict:
    rules = _req('GET', '/rules').get('rules') or []
    return {'rules': rules, 'total': len(rules)}


# ─── Provider（订阅节点池，热更新不重启内核）──────────────

def providers_get() -> dict:
    providers = _req('GET', '/providers/proxies').get('providers') or {}
    out = []
    for name, p in providers.items():
        out.append({
            'name': name,
            'type': p.get('type'),
            'vehicleType': p.get('vehicleType'),
            'updatedAt': p.get('updatedAt'),
            'subscriptionInfo': p.get('subscriptionInfo'),
            'proxies': [_shape_proxy(x) for x in (p.get('proxies') or [])],
        })
    return {'providers': out}


def provider_update(name: str) -> dict:
    """热更新 Provider（HTTP 订阅即时拉新节点，不重启内核——zashboard 同款）。"""
    if not name:
        raise ParamError(message='缺少 Provider 名')
    _req('PUT', f'/providers/proxies/{_q(name)}', timeout=TIMEOUT_PROVIDER)
    return providers_get()


def provider_healthcheck(name: str) -> dict:
    if not name:
        raise ParamError(message='缺少 Provider 名')
    return _req('GET', f'/providers/proxies/{_q(name)}/healthcheck',
                timeout=TIMEOUT_GROUP_DELAY)
