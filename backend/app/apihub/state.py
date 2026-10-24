"""API Hub 应用级状态：每个 app 一份（挂 app.state.apihub，持真实 app 对象）。

含：配置内存快照（版本化，鉴权内联在 API 的 auth_config 明文 JSON）、
内存限流器、探活状态机、上游连接池、日志批量写线程、探活调度线程。
"""

import queue
import threading
import time
from types import SimpleNamespace

from sqlalchemy import select

from app.apihub.core import HealthMonitor, LevelSpec, RateLimiter, TokenExchanger, \
    level_key, merge_probe, strictest
from app.apihub.models import ApihubApi, ApihubCallLog, ApihubRule, ApihubToken, \
    ApihubSystem
from app.apihub.pool import UpstreamPool
from app.shared.timestamps import _utcnow


class Store:
    """配置内存快照：管理端改动后 reload() 全量生效（与运行态限流桶/健康状态分离）。"""

    def __init__(self):
        self.version = 0
        self.lock = threading.RLock()
        self.apis: dict = {}            # slug -> dict
        self.apis_by_id: dict = {}
        self.systems: dict = {}         # id -> dict
        self.systems_by_slug: dict = {}
        self.tokens: dict = {}          # key_hash -> dict
        self.rules: list = []
        self.quota_used: dict = {}      # token_id -> 内存计数（writer 线程落库）
        self.quota_pending: dict = {}   # 与调用日志队列解耦，日志满时配额仍会持久化
        self.quota_epoch: dict = {}
        self._token_hashes: dict = {}
        self.auth_cache = {}
        self._levels_cache: dict = {}   # (version, api_id, token_id) -> [LevelSpec]

    def reload(self):
        from app.db import db
        systems = db.session.execute(select(ApihubSystem)).scalars().all()
        apis = db.session.execute(select(ApihubApi)).scalars().all()
        toks = db.session.execute(select(ApihubToken)).scalars().all()
        rules = db.session.execute(select(ApihubRule)).scalars().all()
        with self.lock:

            self.systems = {s.id: {
                'id': s.id, 'slug': s.slug, 'name': s.name, 'base_url': s.base_url,
                'timeout_ms': s.timeout_ms, 'max_retry': s.max_retry,
                'transport': s.transport or {}, 'status': s.status,
            } for s in systems}
            self.systems_by_slug = {c['slug']: c for c in self.systems.values()}

            self.apis = {}
            self.apis_by_id = {}
            for a in apis:
                cfg = {
                    'id': a.id, 'slug': a.slug, 'name': a.name,
                    'system_id': a.system_id,
                    'method': a.method, 'path_tpl': a.path_tpl,
                    # 鉴权内联（明文）：providers/credential_fields/credential/transport
                    'auth_config': a.auth_config or {},
                    # 存原始值（可为 None）：管理端回读与库内 JSON 完全一致；
                    # 网关/探活消费方各自 `or {}` 兜底
                    'request_cfg': a.request_cfg, 'response_cfg': a.response_cfg,
                    'timeout_ms': a.timeout_ms, 'probe': a.probe, 'enabled': a.enabled,
                    'health_status': a.health_status,
                    'description': a.description or '',
                    'last_probe_at': a.last_probe_at,
                    'last_latency_ms': a.last_latency_ms,
                }
                self.apis[a.slug] = cfg
                self.apis_by_id[a.id] = cfg

            self.tokens = {}
            for t in toks:
                if self._token_hashes.get(t.id) != t.key_hash:
                    self.quota_epoch[t.id] = self.quota_epoch.get(t.id, 0) + 1
                    self.quota_used[t.id] = t.quota_used
                    self.quota_pending[t.id] = 0
                    self._token_hashes[t.id] = t.key_hash
                self.tokens[t.key_hash] = {
                    'id': t.id, 'name': t.name, 'key_hash': t.key_hash,
                    'expires_at': t.expires_at, 'allowed_api_ids': t.allowed_api_ids,
                    'allowed_ips': t.allowed_ips, 'quota_total': t.quota_total,
                    'quota_used': t.quota_used, 'status': t.status,
                }
                self.quota_used.setdefault(t.id, t.quota_used)

            self.rules = [{
                'id': r.id, 'scope': r.scope, 'api_id': r.api_id, 'token_id': r.token_id,
                'algorithm': r.algorithm, 'rate_per_sec': r.rate_per_sec, 'burst': r.burst,
                'window_s': r.window_s, 'max_count': r.max_count, 'enabled': r.enabled,
            } for r in rules if r.enabled]
            self.version += 1
            self._levels_cache = {}
            self.auth_cache.clear()

    def snapshot(self):
        """一次捕获完整配置代次；发布后配置 dict 不原地修改。"""
        with self.lock:
            return SimpleNamespace(apis=self.apis, apis_by_id=self.apis_by_id,
                                   systems=self.systems, systems_by_slug=self.systems_by_slug,
                                   tokens=self.tokens, rules=self.rules, version=self.version)

    def reserve(self, token):
        with self.lock:
            tid = token['id']
            used = self.quota_used.get(tid, token.get('quota_used', 0))
            if token['quota_total'] is not None and used >= token['quota_total']:
                return None
            self.quota_used[tid] = used + 1
            self.quota_pending[tid] = self.quota_pending.get(tid, 0) + 1
            return tid, self.quota_epoch.get(tid, 0)

    def refund(self, ticket):
        if ticket is None:
            return
        tid, epoch = ticket
        with self.lock:
            if self.quota_epoch.get(tid, 0) != epoch:
                return
            self.quota_used[tid] = max(0, self.quota_used.get(tid, 0) - 1)
            self.quota_pending[tid] = self.quota_pending.get(tid, 0) - 1

    def remaining(self, token):
        with self.lock:
            return (max(0, token['quota_total'] - self.quota_used.get(token['id'], 0))
                    if token['quota_total'] is not None else None)

    def reset_quota(self, tid):
        # 调用者在同一 RLock 内提交 DB reset，使 writer 与 reset 不会交错。
        self.quota_epoch[tid] = self.quota_epoch.get(tid, 0) + 1
        self.quota_used[tid] = self.quota_pending[tid] = 0

    def apis_of_system(self, system_id) -> list:
        """某系统下的全部 API 快照（按 id 升序）——管理端系统详情页用。"""
        with self.lock:
            return sorted((c for c in self.apis_by_id.values()
                           if c['system_id'] == system_id), key=lambda c: c['id'])

    # ── 限流层级构建（同层多条取最严格，顺序 token_api → api → token → global） ──
    def build_levels(self, api_id, token_id) -> list:
        """按 (快照版本, api_id, token_id) 缓存——规则只在管理端改动（reload）后变化，
        网关热路径免去每请求全量规则扫描与 LevelSpec 重建。"""
        key = (self.version, api_id, token_id)
        hit = self._levels_cache.get(key)
        if hit is not None:
            return hit
        matched = {'token_api': [], 'api': [], 'token': [], 'global': []}
        for r in self.rules:
            if r['scope'] == 'token_api' and api_id and token_id \
                    and r['api_id'] == api_id and r['token_id'] == token_id:
                matched['token_api'].append(r)
            elif r['scope'] == 'api' and api_id and r['api_id'] == api_id:
                matched['api'].append(r)
            elif r['scope'] == 'token' and token_id and r['token_id'] == token_id:
                matched['token'].append(r)
            elif r['scope'] == 'global':
                matched['global'].append(r)
        levels = []
        for scope in ('token_api', 'api', 'token', 'global'):
            rs = matched[scope]
            if not rs:
                continue
            best = strictest([{
                'algorithm': r['algorithm'], 'rate_per_sec': r['rate_per_sec'] or 0.0,
                'burst': r['burst'] or 1, 'window_s': r['window_s'] or 1,
                'max_count': r['max_count'] or 1,
            } for r in rs])
            src = rs[0]
            levels.append(LevelSpec(
                scope=scope, key=level_key(scope, api_id, token_id), algorithm=src['algorithm'],
                rate_per_sec=best.get('rate_per_sec', 0.0), burst=best.get('burst', 1),
                window_s=best.get('window_s', 1), max_count=best.get('max_count', 1)))
        # 缓存无锁写：key 含快照版本，并发下至多重复构建一次（幂等）
        if len(self._levels_cache) > 4096:
            self._levels_cache.clear()
        self._levels_cache[key] = levels
        return levels


class LogWriter:
    """调用日志批量落库：队列 + 单写者 daemon 线程（sdklogs 同款模式）。"""

    FLUSH_INTERVAL_S = 2.0
    FLUSH_BATCH = 100
    FLUSH_MAX = 500      # 队列积压时单批上限（合并写、降 commit 频率）

    def __init__(self, app):
        self.app = app
        self.q: queue.Queue = queue.Queue(maxsize=10000)
        self._stop = threading.Event()
        self._started = False
        self._lock = threading.Lock()
        self._thread = None
        self.dropped = self.failed = self.persisted = 0
        self._registry = None

    def ensure_started(self):
        with self._lock:
            if not self._started:
                self._started = True
                from app.db import db
                self._registry = db.session
                self._thread = threading.Thread(target=self._run, name='apihub-writer', daemon=True)
                self._thread.start()

    def log(self, **entry):
        if not self._started:
            self.ensure_started()
        try:
            self.q.put_nowait(entry)
        except queue.Full:
            with self._lock:
                self.dropped += 1

    def _run(self):
        from sqlalchemy import insert, update, case
        while not self._stop.is_set() or not self.q.empty():
            batch = []
            try:
                batch.append(self.q.get(timeout=self.FLUSH_INTERVAL_S))
                # 队列深时放大单批上限（高压时合并更多行、减少 commit 次数）
                cap = self.FLUSH_BATCH if self.q.qsize() < self.FLUSH_BATCH else self.FLUSH_MAX
                while len(batch) < cap and not self.q.empty():
                    batch.append(self.q.get_nowait())
            except queue.Empty:
                pass
            state = getattr(self.app.state, 'apihub', None)
            if batch or self._has_pending(state):
                sess = self._registry
                try:
                    # Core 批量插入（较 ORM add_all 免实例化/级联开销，高压落库更省）
                    now = _utcnow()
                    with state.store.lock:
                        if batch:
                            sess.execute(insert(ApihubCallLog), [{**e, 'created_at': now} for e in batch])
                        pending = {tid: n for tid, n in state.store.quota_pending.items() if n}
                        for tid, delta in pending.items():
                            value = ApihubToken.quota_used + delta
                            sess.execute(update(ApihubToken).where(ApihubToken.id == tid).values(
                                quota_used=case((value < 0, 0), else_=value), last_used_at=now))
                        sess.commit()
                        for tid, delta in pending.items():
                            state.store.quota_pending[tid] -= delta
                    self.persisted += len(batch)
                except Exception:
                    self.failed += len(batch)
                    try:
                        sess.rollback()
                    except Exception:
                        pass
                finally:
                    sess.remove()
                    for _ in batch:
                        self.q.task_done()

    @staticmethod
    def _has_pending(state):
        if state is None:
            return False
        with state.store.lock:
            return any(state.store.quota_pending.values())

    def flush(self, timeout=5.0):
        self.ensure_started()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = getattr(self.app.state, 'apihub', None)
            if self.q.unfinished_tasks == 0 and not self._has_pending(state):
                return True
            self._stop.wait(0.01)
        return False

    def stop(self, timeout=5.0):
        deadline = time.monotonic() + timeout
        drained = self.flush(timeout)
        self._stop.set()
        if self._thread:
            self._thread.join(max(0, deadline - time.monotonic()))
        return drained and (self._thread is None or not self._thread.is_alive())


class ApiHubState:
    """每 app 一份的运行态聚合。"""

    def __init__(self, app):
        self.store = Store()
        self.limiter = RateLimiter()
        self.monitor = HealthMonitor()
        self.pool = UpstreamPool()
        self.token_exchange = TokenExchanger()   # qq_bot 等动态令牌缓存（区别于 store.tokens 平台令牌）
        self.writer = LogWriter(app)
        self.reload()

    def reload(self):
        self.store.reload()

    def probe_due_apis(self):
        """到期需探活的 (api_id, probe_cfg) 列表（interval_s>0 且启用）。"""
        now = time.monotonic()
        due = []
        for api in list(self.store.apis_by_id.values()):
            if not api['enabled']:
                continue
            probe = merge_probe(api['probe'])
            if probe['interval_s'] <= 0:
                continue
            st = self.monitor.state_of(api['id'], api['health_status'])
            if now >= st['next_due']:
                self.monitor.schedule_next(api['id'], probe)
                due.append((api['id'], probe))
        return due


_STATE_LOCK = threading.RLock()


def get_state(app) -> ApiHubState:
    # state 持真实 app 对象（FastAPI 无代理问题，writer/探活等后台线程直接用引用）
    state = getattr(app.state, 'apihub', None)
    if state is None:
        with _STATE_LOCK:
            state = getattr(app.state, 'apihub', None)
            if state is None:
                from app.db import db
                try:
                    state = ApiHubState(app)
                    app.state.apihub = state
                finally:
                    db.session.remove()
    return state
