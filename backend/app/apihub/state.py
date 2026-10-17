"""API Hub 应用级状态：每个 app 一份（挂 app.state.apihub，持真实 app 对象）。

含：加密盒（master key 自动生成 data/apihub.key）、配置内存快照（版本化）、
内存限流器、key 选择器、探活状态机、上游连接池、日志批量写线程、探活调度线程。
"""

import os
import queue
import threading
import time

from sqlalchemy import select

from app.apihub.core import CryptoBox, HealthMonitor, KeyCfg, KeySelector, \
    LevelSpec, RateLimiter, TokenExchanger, level_key, merge_probe, strictest
from app.apihub.models import ApihubApi, ApihubCallLog, ApihubKey, ApihubRule, ApihubToken, \
    ApihubUpstream
from app.apihub.pool import UpstreamPool
from app.config import settings
from app.shared.timestamps import _utcnow


class Store:
    """配置内存快照：管理端改动后 reload() 全量生效（与运行态限流桶/健康状态分离）。"""

    def __init__(self, crypto: CryptoBox):
        self.crypto = crypto
        self.version = 0
        self.lock = threading.RLock()
        self.apis: dict = {}            # slug -> dict
        self.apis_by_id: dict = {}
        self.apis_openapi: dict = {}    # (group1, group2, pub_name|slug) -> dict（OpenAPI 发布索引）
        self.upstreams: dict = {}       # id -> dict
        self.upstreams_by_slug: dict = {}
        self.keys: dict = {}            # upstream_id -> [KeyCfg]
        self.tokens: dict = {}          # key_hash -> dict
        self.rules: list = []
        self.quota_used: dict = {}      # token_id -> 内存计数（writer 线程落库）
        self._levels_cache: dict = {}   # (version, api_id, token_id) -> [LevelSpec]

    def reload(self):
        from app.db import db
        with self.lock:
            ups = db.session.execute(select(ApihubUpstream)).scalars().all()
            keys = db.session.execute(select(ApihubKey)).scalars().all()
            apis = db.session.execute(select(ApihubApi)).scalars().all()
            toks = db.session.execute(select(ApihubToken)).scalars().all()
            rules = db.session.execute(select(ApihubRule)).scalars().all()

            self.upstreams = {}
            for u in ups:
                try:
                    cfg = self.crypto.decrypt(bytes(u.auth_config_enc))
                except Exception:
                    cfg = {'_broken': True, 'providers': [], 'credential_fields': [],
                           'transport': {}}
                self.upstreams[u.id] = {
                    'id': u.id, 'slug': u.slug, 'name': u.name, 'base_url': u.base_url,
                    'timeout_ms': u.timeout_ms, 'max_retry': u.max_retry,
                    'providers': cfg.get('providers', []),
                    'credential_fields': cfg.get('credential_fields', []),
                    'transport': cfg.get('transport', {}) or {}, 'status': u.status,
                    'auth_config': cfg,   # 解密原文（管理端回读用，免每请求重复解密）
                }
            self.upstreams_by_slug = {c['slug']: c for c in self.upstreams.values()}

            self.keys = {}
            for k in keys:
                try:
                    cred = self.crypto.decrypt(bytes(k.credential_enc))
                except Exception:
                    continue
                self.keys.setdefault(k.upstream_id, []).append(
                    KeyCfg(id=k.id, cred=cred, weight=max(1, k.weight), status=k.status))
            for lst in self.keys.values():
                lst.sort(key=lambda x: x.id)

            self.apis = {}
            self.apis_by_id = {}
            self.apis_openapi = {}
            for a in apis:
                cfg = {
                    'id': a.id, 'slug': a.slug, 'name': a.name,
                    'upstream_id': a.upstream_id,
                    'method': a.method, 'path_tpl': a.path_tpl,
                    # 存原始值（可为 None）：管理端回读与库内 JSON 完全一致；
                    # 网关/探活消费方各自 `or {}` 兜底
                    'request_cfg': a.request_cfg, 'response_cfg': a.response_cfg,
                    'timeout_ms': a.timeout_ms, 'probe': a.probe, 'enabled': a.enabled,
                    'health_status': a.health_status,
                    'description': a.description or '',
                    'group1': a.group1 or '', 'group2': a.group2 or '',
                    'pub_name': a.pub_name or '', 'doc_md': a.doc_md or '',
                    'last_probe_at': a.last_probe_at,
                    'last_latency_ms': a.last_latency_ms,
                }
                self.apis[a.slug] = cfg
                self.apis_by_id[a.id] = cfg
                if cfg['group1']:
                    self.apis_openapi[(cfg['group1'], cfg['group2'],
                                        cfg['pub_name'] or a.slug)] = cfg

            self.tokens = {}
            for t in toks:
                self.tokens[t.key_hash] = {
                    'id': t.id, 'name': t.name, 'key_hash': t.key_hash,
                    'expires_at': t.expires_at, 'allowed_api_ids': t.allowed_api_ids,
                    'allowed_ips': t.allowed_ips, 'quota_total': t.quota_total,
                    'quota_used': t.quota_used, 'status': t.status,
                }
                self.quota_used[t.id] = t.quota_used

            self.rules = [{
                'id': r.id, 'scope': r.scope, 'api_id': r.api_id, 'token_id': r.token_id,
                'algorithm': r.algorithm, 'rate_per_sec': r.rate_per_sec, 'burst': r.burst,
                'window_s': r.window_s, 'max_count': r.max_count, 'enabled': r.enabled,
            } for r in rules if r.enabled]
            self.version += 1
            self._levels_cache = {}

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
        self.q: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._started = False
        self._lock = threading.Lock()

    def ensure_started(self):
        with self._lock:
            if not self._started:
                self._started = True
                threading.Thread(target=self._run, name='apihub-writer', daemon=True).start()

    def log(self, **entry):
        if not self._started:
            self.ensure_started()
        try:
            self.q.put_nowait(entry)
        except queue.Full:
            pass

    def _run(self):
        from sqlalchemy import insert
        from app.db import db
        while not self._stop.is_set():
            batch = []
            try:
                batch.append(self.q.get(timeout=self.FLUSH_INTERVAL_S))
                # 队列深时放大单批上限（高压时合并更多行、减少 commit 次数）
                cap = self.FLUSH_BATCH if self.q.qsize() < self.FLUSH_BATCH else self.FLUSH_MAX
                while len(batch) < cap and not self.q.empty():
                    batch.append(self.q.get_nowait())
            except queue.Empty:
                pass
            if batch:
                try:
                    # Core 批量插入（较 ORM add_all 免实例化/级联开销，高压落库更省）
                    now = _utcnow()
                    db.session.execute(insert(ApihubCallLog),
                                       [{**e, 'created_at': now} for e in batch])
                    token_ids = {e.get('token_id') for e in batch if e.get('token_id')}
                    state = self.app.state.apihub
                    for tid in token_ids:
                        row = db.session.get(ApihubToken, tid)
                        if row is not None:
                            row.quota_used = state.store.quota_used.get(tid, row.quota_used)
                            row.last_used_at = now
                    db.session.commit()
                except Exception:
                    try:
                        db.session.rollback()
                    except Exception:
                        pass
                finally:
                    db.session.remove()

    def stop(self):
        self._stop.set()


class ApiHubState:
    """每 app 一份的运行态聚合。"""

    def __init__(self, app):
        key_path = os.path.join(settings.data_dir, 'apihub.key')
        os.makedirs(settings.data_dir, exist_ok=True)
        if os.path.isfile(key_path):
            with open(key_path, encoding='utf-8') as f:
                master = f.read().strip()
        else:
            master = os.urandom(32).hex()
            with open(key_path, 'w', encoding='utf-8') as f:
                f.write(master)
        self.store = Store(CryptoBox(master))
        self.limiter = RateLimiter()
        self.selector = KeySelector()
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


def get_state(app) -> ApiHubState:
    # state 持真实 app 对象（FastAPI 无代理问题，writer/探活等后台线程直接用引用）
    state = getattr(app.state, 'apihub', None)
    if state is None:
        state = ApiHubState(app)
        app.state.apihub = state
    return state
