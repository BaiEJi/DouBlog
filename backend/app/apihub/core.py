"""API Hub 框架无关核心：模板/鉴权适配/内存限流/探活状态机。

全部为纯同步实现（Flask 线程模型），线程安全由 threading.Lock 保证。
CryptoBox 仅为 2026-10-17「密钥池 → API 内联鉴权」迁移的回填读取而保留，
新代码不再加密任何东西（凭证明文内联在 API 的 auth_config）。
"""

import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field

# ─── AES-256-GCM（仅迁移回填读取旧密文用） ─────────────────────────

_AAD = b'doublog.apihub/v1'


class CryptoBox:
    """上游凭证/密钥加密：master_key 派生密钥，nonce(12B)+ciphertext 落库。

    2026-10-17 起运行时不再使用（auth_config 改明文 JSON 内联在 API 上），
    仅 __init__.ensure_migrations 回填旧库时解密读取。"""

    def __init__(self, master_key: str):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        self._aes = AESGCM(hashlib.sha256(master_key.encode()).digest())

    def encrypt(self, obj) -> bytes:
        nonce = os.urandom(12)
        ct = self._aes.encrypt(nonce, json.dumps(obj, ensure_ascii=False).encode(), _AAD)
        return nonce + ct

    def decrypt(self, data: bytes):
        return json.loads(self._aes.decrypt(bytes(data[:12]), bytes(data[12:]), _AAD))


def load_crypto() -> CryptoBox:
    """读 data/apihub.key 构建 CryptoBox（缺失则生成）——仅迁移回填用。"""
    from app.config import settings
    key_path = os.path.join(settings.data_dir, 'apihub.key')
    os.makedirs(settings.data_dir, exist_ok=True)
    if os.path.isfile(key_path):
        with open(key_path, encoding='utf-8') as f:
            master = f.read().strip()
    else:
        master = os.urandom(32).hex()
        with open(key_path, 'w', encoding='utf-8') as f:
            f.write(master)
    return CryptoBox(master)


# ─── 平台令牌 ───────────────────────────────────────────────────────

def generate_token() -> str:
    return 'sk-' + secrets.token_urlsafe(32)


def hash_token(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


def token_hint(plain: str) -> str:
    return f"{plain[:6]}...{plain[-4:]}"


# ─── 模板渲染 {a.b.c} ───────────────────────────────────────────────

VAR_RE = re.compile(r'\{([\w.]+)\}')

#: 模板 → 编译段（str 字面量 / list 路径）缓存：模板串来自上游配置，集合有限
_TPL_CACHE: dict = {}
_TPL_CACHE_MAX = 1024


class TemplateError(ValueError):
    pass


def _compile_tpl(template: str) -> list:
    segs = []
    pos = 0
    for m in VAR_RE.finditer(template):
        if m.start() > pos:
            segs.append(template[pos:m.start()])
        segs.append(m.group(1).split('.'))
        pos = m.end()
    if pos < len(template):
        segs.append(template[pos:])
    return segs


def render(template: str, ctx: dict) -> str:
    segs = _TPL_CACHE.get(template)
    if segs is None:
        if '{' not in template:
            return template                       # 恒定串免编译免遍历
        segs = _compile_tpl(template)
        if len(_TPL_CACHE) >= _TPL_CACHE_MAX:
            _TPL_CACHE.clear()
        _TPL_CACHE[template] = segs
    out = []
    for seg in segs:
        if isinstance(seg, str):
            out.append(seg)
            continue
        node = ctx
        for part in seg:
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                raise TemplateError(f"缺少模板变量 {'.'.join(seg)}")
            if node is None:
                raise TemplateError(f"模板变量为空 {'.'.join(seg)}")
        out.append(str(node))
    return ''.join(out)


def render_obj(obj, ctx: dict):
    if isinstance(obj, str):
        return render(obj, ctx)
    if isinstance(obj, dict):
        return {k: render_obj(v, ctx) for k, v in obj.items()}
    if isinstance(obj, list):
        return [render_obj(v, ctx) for v in obj]
    return obj


# ─── 鉴权适配（静态七式 + qq_bot 动态令牌，一个注入引擎） ────────────

STATIC_PROVIDER_TYPES = {
    'bearer', 'api_key_header', 'query_key', 'basic',
    'static_cookie', 'path_token', 'template',
    # qq_bot：QQ 开放平台动态令牌——appId+secret 换 access_token（约 7200s 有效），
    # 进程内缓存自动刷新，注入 Authorization: QQBot <token>；凭证字段 app_id/app_secret
    'qq_bot',
}


def validate_auth_config(cfg: dict) -> list:
    errors = []
    providers = cfg.get('providers')
    if not isinstance(providers, list) or not providers:
        return ['auth_config.providers 必须是非空数组']
    for i, p in enumerate(providers):
        if not isinstance(p, dict) or p.get('type') not in STATIC_PROVIDER_TYPES:
            errors.append(f"providers[{i}].type 必须是 {sorted(STATIC_PROVIDER_TYPES)} 之一")
    fields_ = cfg.get('credential_fields', [])
    if not isinstance(fields_, list) or not all(isinstance(x, str) for x in fields_):
        errors.append('credential_fields 必须是字符串数组')
    return errors


@dataclass
class Injection:
    headers: dict = field(default_factory=dict)
    query: dict = field(default_factory=dict)
    cookies: dict = field(default_factory=dict)


def apply_providers(providers: list, cred: dict, token_fetch=None) -> Injection:
    """把全部 provider 编译为注入规则；cred = 该把 key 的凭证字段字典。

    token_fetch(provider_cfg, cred) -> str：qq_bot 等动态令牌 provider 的取 token
    回调（网关/探活运行态绑定 state.tokens；未绑定时遇到 qq_bot 抛 TemplateError）。"""
    ctx = {'cred': cred}
    inj = Injection()
    for p in providers:
        t = p.get('type')
        if t == 'bearer':
            inj.headers['Authorization'] = 'Bearer ' + render(p.get('value', '{cred.token}'), ctx)
        elif t == 'qq_bot':
            if token_fetch is None:
                raise TemplateError('qq_bot provider 需要令牌交换器（运行态）')
            inj.headers['Authorization'] = 'QQBot ' + token_fetch(p, cred)
        elif t == 'api_key_header':
            inj.headers[p.get('header') or 'X-API-Key'] = render(p.get('value', '{cred.token}'), ctx)
        elif t == 'query_key':
            inj.query[p.get('param') or 'key'] = render(p.get('value', '{cred.key}'), ctx)
        elif t == 'basic':
            user = render(p.get('user', '{cred.user}'), ctx)
            password = render(p.get('password', '{cred.password}'), ctx)
            raw = base64.b64encode(f"{user}:{password}".encode()).decode()
            inj.headers['Authorization'] = f'Basic {raw}'
        elif t == 'static_cookie':
            inj.cookies[p.get('cookie') or 'SESSION'] = render(p.get('value', '{cred.session}'), ctx)
        elif t == 'template':
            tpl = p.get('template') or {}
            inj.headers.update(render_obj(tpl.get('headers', {}), ctx))
            inj.query.update(render_obj(tpl.get('query', {}), ctx))
            inj.cookies.update(render_obj(tpl.get('cookies', {}), ctx))
        # path_token: 凭证变量直接用于 path/base_url 模板，无注入动作
    return inj


# ─── qq_bot 动态令牌交换（appId+secret → access_token，进程内缓存） ──

QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
QQ_TOKEN_REFRESH_MARGIN_S = 300      # 提前 5 分钟刷新
QQ_TOKEN_TIMEOUT_S = 15.0


class TokenExchanger:
    """QQ 开放平台 access_token 交换器：按 (token_url, app_id) 缓存，
    过期前 QQ_TOKEN_REFRESH_MARGIN_S 秒自动重新交换；连接走共享池（含出站代理）。

    provider 可配置 token_url / app_id / app_secret 模板（默认取凭证字段）。"""

    def __init__(self):
        self._cache: dict = {}      # (url, app_id, secret fingerprint) -> token, expiry
        self._lock = threading.Lock()
        self._fetch_locks = [threading.Lock() for _ in range(32)]
        self._generation = 0

    def get(self, pool, provider: dict, cred: dict, deadline=None) -> str:
        from app.apihub.pool import UpstreamTimeout
        ctx = {'cred': cred}
        url = render(provider.get('token_url') or QQ_TOKEN_URL, ctx)
        app_id = render(provider.get('app_id') or '{cred.app_id}', ctx)
        secret = render(provider.get('app_secret') or '{cred.app_secret}', ctx)
        cache_key = (url, app_id, hashlib.sha256(secret.encode()).hexdigest())
        deadline = deadline or time.monotonic() + QQ_TOKEN_TIMEOUT_S
        lock = self._fetch_locks[hash(cache_key) % len(self._fetch_locks)]
        if not lock.acquire(timeout=max(0, deadline - time.monotonic())):
            raise UpstreamTimeout('token exchange queue deadline exceeded')
        try:
            with self._lock:
                generation = self._generation
                ent = self._cache.get(cache_key)
                if ent and ent[1] > time.monotonic():
                    return ent[0]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise UpstreamTimeout('token exchange deadline exceeded')
            payload = json.dumps({'appId': app_id, 'clientSecret': secret}).encode()
            response = pool.request('POST', url, {'Content-Type': 'application/json'},
                                    {}, payload, min(QQ_TOKEN_TIMEOUT_S, remaining))
            try:
                data = json.loads(response.content)
            except ValueError as error:
                raise ValueError('qq token 响应非 JSON') from error
            token = data.get('access_token') if isinstance(data, dict) else None
            if response.status != 200 or not token:
                raise ValueError(f'qq token 交换失败 http {response.status}')
            try:
                expires_in = max(60, int(data.get('expires_in') or 7200))
            except (TypeError, ValueError):
                expires_in = 7200
            with self._lock:
                if generation == self._generation:
                    if len(self._cache) >= 256:
                        self._cache.pop(next(iter(self._cache)))
                    margin = min(QQ_TOKEN_REFRESH_MARGIN_S, expires_in / 2)
                    self._cache[cache_key] = (token, time.monotonic() + expires_in - margin)
            return token
        finally:
            lock.release()

    def clear(self):
        with self._lock:
            self._generation += 1
            self._cache.clear()


# ─── 内存限流（令牌桶 + 固定窗口，多级 AND） ────────────────────────

SWEEP_IDLE_S = 600
SWEEP_EVERY_S = 60


@dataclass
class TokenBucket:
    rate: float
    capacity: float
    tokens: float
    last: float

    @classmethod
    def full(cls, rate: float, capacity: float) -> 'TokenBucket':
        now = time.monotonic()
        return cls(rate=rate, capacity=capacity, tokens=capacity, last=now)

    def allow(self, n: float = 1.0):
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= n:
            self.tokens -= n
            return True, 0.0, self.tokens
        retry = (n - self.tokens) / self.rate if self.rate > 0 else 1.0
        return False, retry, self.tokens


@dataclass
class FixedWindow:
    window_s: int
    max_count: int
    count: int = 0
    window_id: int = 0

    def allow(self):
        now = int(time.time())
        wid = now // self.window_s
        if wid != self.window_id:
            self.window_id = wid
            self.count = 0
        if self.count < self.max_count:
            self.count += 1
            return True, 0.0, self.max_count - self.count
        return False, float((wid + 1) * self.window_s - now), 0


@dataclass
class LevelSpec:
    scope: str
    key: str
    algorithm: str
    rate_per_sec: float = 0.0
    burst: int = 1
    window_s: int = 0
    max_count: int = 0


@dataclass
class CheckResult:
    allowed: bool
    scope: str | None = None
    retry_after: float = 0.0
    limit: float = 0.0
    remaining: float = 0.0


def strictest(rules: list) -> dict:
    """同层多条规则取最严格（每秒允许量最小者）。"""
    def allowance(r):
        if r.get('algorithm') == 'fixed_window':
            return r['max_count'] / max(1, r['window_s'])
        return r['rate_per_sec']
    return min(rules, key=allowance) if rules else None


def level_key(scope: str, api_id=None, token_id=None) -> str:
    """限流桶键：state.build_levels 构建层级与 routes 规则列表 usage 快照共用，
    保证两处键格式永远一致（改格式只动这里）。"""
    if scope == 'token_api':
        return f'rl:ta:{token_id}:{api_id}'
    if scope == 'api':
        return f'rl:a:{api_id}'
    if scope == 'token':
        return f'rl:t:{token_id}'
    return 'rl:g'


class RateLimiter:
    """进程内多级限流：check 依次判定 L1..Ln，任一拒绝即短路。

    锁粒度：按 key 哈希分片（16 把）——各桶/窗口独立互斥即可保证计数正确，
    避免全局锁把无关 key 的判定串行化；sweep 每 60s 一次，按固定顺序全量持锁清理。
    """

    N_SHARDS = 16

    def __init__(self):
        self._buckets: dict = {}
        self._windows: dict = {}
        self._shards = [threading.Lock() for _ in range(self.N_SHARDS)]
        self._sweep_gate = threading.Lock()
        self._last_sweep = 0.0

    def _shard(self, key: str) -> threading.Lock:
        return self._shards[hash(key) & (self.N_SHARDS - 1)]

    def check(self, levels: list) -> CheckResult:
        if not levels:
            return CheckResult(allowed=True)
        self._sweep_maybe()
        for lv in levels:
            lk = self._shard(lv.key)
            with lk:
                if lv.algorithm == 'token_bucket':
                    b = self._buckets.get(lv.key) or TokenBucket.full(lv.rate_per_sec, max(1, lv.burst))
                    self._buckets[lv.key] = b
                    ok, retry, remain = b.allow()
                    if not ok:
                        return CheckResult(False, lv.scope, retry, lv.burst, int(remain))
                elif lv.algorithm == 'fixed_window':
                    w = self._windows.get(lv.key) or FixedWindow(max(1, lv.window_s), max(1, lv.max_count))
                    self._windows[lv.key] = w
                    ok, retry, remain = w.allow()
                    if not ok:
                        return CheckResult(False, lv.scope, retry, lv.max_count, remain)
        last = levels[-1]
        lk = self._shard(last.key)
        with lk:
            return CheckResult(True, limit=last.burst if last.algorithm == 'token_bucket' else last.max_count,
                               remaining=self._remaining(last))

    def snapshot(self, lv: LevelSpec) -> dict:
        with self._shard(lv.key):
            if lv.algorithm == 'token_bucket':
                b = self._buckets.get(lv.key)
                if not b:
                    return {'algorithm': 'token_bucket', 'limit': lv.burst, 'remaining': lv.burst}
                return {'algorithm': 'token_bucket', 'limit': int(b.capacity), 'remaining': int(b.tokens)}
            w = self._windows.get(lv.key)
            if not w:
                return {'algorithm': 'fixed_window', 'limit': lv.max_count, 'remaining': lv.max_count}
            return {'algorithm': 'fixed_window', 'limit': w.max_count, 'remaining': w.max_count - w.count}

    def _remaining(self, lv):
        if lv.algorithm == 'token_bucket':
            b = self._buckets.get(lv.key)
            return int(b.tokens) if b else 0
        w = self._windows.get(lv.key)
        return w.max_count - w.count if w else 0

    def _sweep_maybe(self):
        now = time.monotonic()
        if now - self._last_sweep < SWEEP_EVERY_S:
            return
        with self._sweep_gate:
            now = time.monotonic()
            if now - self._last_sweep < SWEEP_EVERY_S:
                return
            self._last_sweep = now
            locks = list(self._shards)          # 固定顺序全量持锁（分片号升序，无死锁）
            for lk in locks:
                lk.acquire()
            try:
                for k in [k for k, b in self._buckets.items() if now - b.last > SWEEP_IDLE_S]:
                    del self._buckets[k]
                nowi = int(time.time())
                for k in [k for k, w in self._windows.items()
                          if nowi // max(1, w.window_s) - w.window_id >= 2]:
                    del self._windows[k]
            finally:
                for lk in reversed(locks):
                    lk.release()


# ─── key 池选择器 ───────────────────────────────────────────────────

# ─── 探活状态机 ─────────────────────────────────────────────────────

DEFAULT_PROBE = {
    'type': 'http', 'method': 'GET', 'path': '/', 'headers': {}, 'body': None,
    'timeout_ms': 5000, 'expect_status': [200, 201, 204, 301, 302], 'expect_body_regex': '',
    'interval_s': 0, 'failure_threshold': 3, 'success_threshold': 2,
}


def merge_probe(cfg: dict | None) -> dict:
    p = dict(DEFAULT_PROBE)
    if cfg:
        p.update({k: v for k, v in cfg.items() if v is not None})
    p['failure_threshold'] = max(1, int(p['failure_threshold']))
    p['success_threshold'] = max(1, int(p['success_threshold']))
    p['interval_s'] = max(0, int(p['interval_s']))
    return p


class HealthMonitor:
    """healthy/suspect/down；未配 probe.path 时探测 API 自身路径（在调用方处理）。
    锁用 RLock：apply_result/schedule_next 持锁内会经 state_of 再次进入。"""

    def __init__(self):
        self.states: dict = {}
        self._lock = threading.RLock()

    def state_of(self, api_id: int, persisted: str | None = None):
        with self._lock:
            st = self.states.get(api_id)
            if st is None:
                st = {'status': persisted if persisted in
                      ('healthy', 'suspect', 'down', 'half_open', 'unknown') else 'unknown',
                      'fails': 0, 'succs': 0, 'next_due': 0.0, 'last_latency_ms': None}
                self.states[api_id] = st
            return st

    def apply_result(self, api_id: int, probe_cfg: dict, ok: bool) -> str:
        with self._lock:
            st = self.state_of(api_id)
            if ok:
                st['fails'] = 0
                st['succs'] += 1
                if st['status'] == 'unknown':
                    st['status'], st['succs'] = 'healthy', 0
                elif st['status'] != 'healthy' and st['succs'] >= probe_cfg['success_threshold']:
                    st['status'], st['succs'] = 'healthy', 0
                elif st['status'] == 'healthy':
                    st['succs'] = 0
            else:
                st['succs'] = 0
                st['fails'] += 1
                if st['status'] == 'down':
                    pass
                elif st['fails'] >= probe_cfg['failure_threshold']:
                    st['status'], st['fails'] = 'down', 0
                else:
                    st['status'] = 'suspect'
            return st['status']

    def schedule_next(self, api_id: int, probe_cfg: dict) -> float:
        with self._lock:
            st = self.states[api_id]
            interval = max(1, probe_cfg['interval_s'])
            if st['status'] == 'down':
                interval *= 5
            st['next_due'] = time.monotonic() + interval
            return st['next_due']
