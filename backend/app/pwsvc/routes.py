"""
密码服务（Password Service）API

为项目提供轮换密码（默认 60s，按类型配置）与第三方校验接口。

核心机制（无状态时钟轮换，见 docs/pwsvc-design.md）：
    window   = floor(unix_time / rotation_seconds)      # 墙钟对齐
    password = Derive(seed, window, policy)             # HMAC-SHA256 确定性推导
- 密码本体从不落盘；每个用户独立 seed（AES-256-GCM 加密存储，密钥在 data/pwsvc.key）
- 校验：当前窗口 + 上一窗口宽限 30 秒（常数时间比较）
- 第三方校验走 X-Api-Key（按项目签发，只存哈希）；管理接口沿用 Basic Auth
"""
import hashlib
import hmac
import base64
import os
import secrets
import struct
import threading
import time
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Request
from lizysdk.errors import RateLimitError
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import OperationalError

from app.db import db, run_db
from app.shared.auth import require_basic
from app.config import settings
from app.shared.response import api_response
from app.shared.timestamps import _iso, _utcnow
from app.pwsvc.models import PwsvcProject, PwsvcType, PwsvcUser, PwsvcValidateLog

# 第三方校验端点用 X-Api-Key 自鉴权，不挂 Basic Auth；管理端点统一 Basic Auth
validate_router = APIRouter(prefix='/api/pwsvc', tags=['pwsvc'])
admin_router = APIRouter(prefix='/api/pwsvc', tags=['pwsvc'],
                         dependencies=[Depends(require_basic)])

router = APIRouter()
router.include_router(validate_router)
router.include_router(admin_router)

# 上一窗口宽限：窗口切换后 30 秒内，旧窗口密码仍可校验通过
GRACE_SECONDS = 30
ROTATION_CHOICES = {30, 60, 120, 300, 600}

# 校验限流（每项目可在页面配置）：令牌桶，容量=每分钟限额，匀速回填
RATE_LIMIT_DEFAULT = 120          # 次/分钟
RATE_LIMIT_MAX = 10000            # 配置上限
LOG_RETENTION_DAYS = 30           # 校验日志保留天数（写入时顺手清理过期行）

_buckets = {}                     # project_id -> [tokens, last_monotonic]
_bucket_lock = threading.Lock()


def _allow(pid: int, limit: int) -> bool:
    """令牌桶限流：limit=0 表示不限流；桶容量=限额，允许短时突发到限额"""
    if limit <= 0:
        return True
    now = time.monotonic()
    with _bucket_lock:
        b = _buckets.get(pid)
        if b is None:
            b = _buckets[pid] = [float(limit), now]
        tokens, last = b
        tokens = min(float(limit), tokens + (now - last) * limit / 60.0)
        allowed = tokens >= 1.0
        b[0] = tokens - 1.0 if allowed else tokens
        b[1] = now
        return allowed


def _reset_bucket(pid):
    """改限流配置/删项目后清桶，立即按新额度生效"""
    with _bucket_lock:
        _buckets.pop(pid, None)


def _run_write_retry(write) -> None:
    """执行一笔幂等写事务，对 database is locked 小步重试。

    SQLite 单写者下偶发 database is locked（busy_timeout 5s 打满，多为 WAL
    checkpoint 瞬时 convoy）：整笔回滚后重试（≤3 次、50ms 起退避），
    非 locked 的 OperationalError 不重试直接抛出。
    """
    for attempt in range(4):
        try:
            write()
            return
        except OperationalError as e:
            db.session.rollback()
            if 'locked' not in str(e).lower() or attempt == 3:
                raise
            time.sleep(0.05 * (attempt + 1))


def _log_validate(pid: int, username: str, valid: bool, ip: str,
                  last_validated: tuple | None = None):
    """记一条校验日志并顺手清理过期（永不含密码内容）。

    可选 last_validated=(uid, ts) 把"校验成功时间"的 UPDATE 并入同一笔写事务。
    全 Core 语句（created_at 列 default 生效），免 ORM 脏跟踪/autoflush 开销。
    """

    def _write():
        if last_validated is not None:
            uid, ts = last_validated
            db.session.execute(update(PwsvcUser)
                               .where(PwsvcUser.id == uid)
                               .values(last_validated_at=ts))
        db.session.execute(insert(PwsvcValidateLog).values(
            project_id=pid, username=username[:100],
            valid=bool(valid), ip=(ip or '')[:64]))
        cutoff = _utcnow() - timedelta(days=LOG_RETENTION_DAYS)
        db.session.execute(delete(PwsvcValidateLog).where(
            PwsvcValidateLog.project_id == pid,
            PwsvcValidateLog.created_at < cutoff))
        db.session.commit()

    _run_write_retry(_write)

# ─── 确定性推导（标准库 hmac/hashlib，黄金向量见测试）─────

CHARSET = {
    'uppercase': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'lowercase': 'abcdefghijklmnopqrstuvwxyz',
    'digits': '0123456789',
    'symbols': '!@#$%^&*()-_=+[]{};:,.<>?',
}
AMBIGUOUS = set('Il1O0o')

# 策略开关 → (各字符类池, 全集字符串) 的纯函数结果缓存（推导算法本身一字未动）
_POOLS_MEMO: dict = {}


def _policy_char_pools(policy: dict):
    flags = (bool(policy.get('uppercase', True)), bool(policy.get('lowercase', True)),
             bool(policy.get('digits', True)), bool(policy.get('symbols', True)),
             bool(policy.get('exclude_ambiguous', True)))
    memo = _POOLS_MEMO.get(flags)
    if memo is None:
        pools = []
        for flag, name in zip(flags[:4], ('uppercase', 'lowercase', 'digits', 'symbols')):
            if not flag:
                continue
            chars = CHARSET[name]
            if flags[4]:
                chars = ''.join(c for c in chars if c not in AMBIGUOUS)
            if chars:
                pools.append(chars)
        if not pools:
            pools = [CHARSET['lowercase']]
        memo = _POOLS_MEMO[flags] = (pools, ''.join(pools))
    return memo


def _mac(seed: bytes, window: int, counter: int) -> bytes:
    return hmac.new(seed, struct.pack('>II', window & 0xFFFFFFFF, counter), hashlib.sha256).digest()


def _rand_below(seed: bytes, window: int, state: list, n: int) -> int:
    """确定性拒绝采样：均匀取 [0, n)，无 modulo 偏差；state=[counter, buf]"""
    limit = (256 // n) * n
    while True:
        if not state[1]:
            state[0] += 1
            state[1] = _mac(seed, window, state[0])
        b = state[1][0]
        state[1] = state[1][1:]
        if b < limit:
            return b % n


def derive_password(seed: bytes, window: int, policy: dict) -> str:
    """由 seed + 窗口号 + 策略 确定性地推导密码（同输入永远同输出）"""
    length = policy.get('length', 16)
    pools, all_chars = _policy_char_pools(policy)

    state = [0, b'']
    chars = []
    # 每个启用的字符类至少 1 个字符
    for pool in pools:
        chars.append(pool[_rand_below(seed, window, state, len(pool))])
    # 补足长度
    while len(chars) < length:
        chars.append(all_chars[_rand_below(seed, window, state, len(all_chars))])
    # 确定性 Fisher-Yates 洗牌
    for i in range(len(chars) - 1, 0, -1):
        j = _rand_below(seed, window, state, i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return ''.join(chars[:length])


def validate_password(seed: bytes, policy: dict, rotation: int, presented: str, now: float) -> dict:
    """
    校验纯函数（便于单测注入时间）：
    当前窗口命中 → valid + 剩余秒数；窗口开始后 30s 内上一窗口命中 → valid + 宽限剩余
    """
    window = int(now // rotation)
    elapsed = now - window * rotation
    expected = derive_password(seed, window, policy)
    if presented and hmac.compare_digest(presented.encode('utf-8'), expected.encode('utf-8')):
        return {'valid': True, 'expires_in': max(0, int(rotation - elapsed))}
    grace = min(GRACE_SECONDS, rotation)
    if elapsed < grace:
        prev = derive_password(seed, window - 1, policy)
        if presented and hmac.compare_digest(presented.encode('utf-8'), prev.encode('utf-8')):
            return {'valid': True, 'expires_in': max(0, int(grace - elapsed))}
    return {'valid': False}


# ─── seed 加密（AES-256-GCM，密钥文件 data/pwsvc.key）────
#
# 性能：主密钥与 AESGCM 实例按密钥文件路径进程内缓存（密钥文件只在缺失时
# 创建一次、之后不再原地改写；手动换 key 需重启进程）。注意：缓存的只是
# 主密钥本身（本来就要参与每次解密），**不是**任何用户的明文 seed——
# 明文 seed 依然即解即弃，不做缓存（安全红线）。

_MASTER_KEY_CACHE: dict = {}     # 密钥文件路径 -> 32 字节主密钥
_CIPHER_CACHE: dict = {}         # 密钥文件路径 -> AESGCM 实例


def _master_key() -> bytes:
    path = os.path.join(settings.data_dir, 'pwsvc.key')
    key = _MASTER_KEY_CACHE.get(path)
    if key is None:
        if not os.path.exists(path):
            os.makedirs(settings.data_dir, exist_ok=True)
            with open(path, 'w', encoding='ascii') as f:
                f.write(secrets.token_hex(32))
        with open(path, 'r', encoding='ascii') as f:
            key = bytes.fromhex(f.read().strip())
        _MASTER_KEY_CACHE[path] = key
    return key


def _cipher() -> AESGCM:
    path = os.path.join(settings.data_dir, 'pwsvc.key')
    c = _CIPHER_CACHE.get(path)
    if c is None:
        c = _CIPHER_CACHE[path] = AESGCM(_master_key())
    return c


def encrypt_seed(seed: bytes) -> str:
    nonce = secrets.token_bytes(12)
    ct = _cipher().encrypt(nonce, seed, None)
    return base64.b64encode(nonce + ct).decode('ascii')


def decrypt_seed(enc: str) -> bytes:
    raw = base64.b64decode(enc)
    return _cipher().decrypt(raw[:12], raw[12:], None)


# ─── API Key ─────────────────────────────────────────────

def _new_api_key():
    key = 'pws_' + secrets.token_hex(20)
    return key, hashlib.sha256(key.encode()).hexdigest(), key[:12]


def _find_project_by_key(raw_key: str):
    """按 API Key 哈希定位项目（Core 只取校验路径用到的两列，免 ORM 实例化）"""
    if not raw_key:
        return None
    h = hashlib.sha256(raw_key.encode()).hexdigest()
    return db.session.execute(
        select(PwsvcProject.id, PwsvcProject.rate_limit)
        .where(PwsvcProject.api_key_hash == h)
    ).first()


# ─── 请求体/查询参数（保持原解析语义）────────────────────

async def _json_body(request: Request):
    """等价 Flask ``request.get_json(silent=True) or {}``：解析失败/空体给 {}"""
    try:
        data = await request.json()
    except ValueError:
        return {}
    return data or {}


def _query_int(request: Request, key: str, default: int) -> int:
    """等价 Flask ``request.args.get(key, default, type=int)``：非法值回退默认"""
    value = request.query_params.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


# ─── 校验接口（第三方服务，X-Api-Key 认证）───────────────

@validate_router.post('/validate')
async def validate(request: Request):
    """校验用户轮换密码（应用层结果用 200 + valid 表达，认证失败 401，超限 429）"""
    api_key = request.headers.get('X-Api-Key', '')
    ip = request.client.host if request.client else ''
    data = await _json_body(request)

    def _impl():
        proj = _find_project_by_key(api_key)
        if proj is None:
            return api_response(None, 401, 'API Key 无效')
        pid, rate_limit = proj
        if not _allow(pid, rate_limit):
            # 被限流的请求不落日志，避免攻击者刷爆日志表
            raise RateLimitError()
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
        if not username or not password:
            return api_response(None, 400, '缺少 username / password')

        # user + type 一次 JOIN 取齐（Core 列查询，免两次 ORM 实例化）
        row = db.session.execute(
            select(PwsvcUser.id, PwsvcUser.status, PwsvcUser.seed_encrypted,
                   PwsvcType.length, PwsvcType.uppercase, PwsvcType.lowercase,
                   PwsvcType.digits, PwsvcType.symbols, PwsvcType.exclude_ambiguous,
                   PwsvcType.rotation_seconds)
            .join(PwsvcType, PwsvcUser.type_id == PwsvcType.id)
            .where(PwsvcUser.project_id == pid, PwsvcUser.username == username)
        ).first()
        result = {'valid': False}
        valid_uid = None
        if row is not None:
            policy = {'length': row[3], 'uppercase': row[4], 'lowercase': row[5],
                      'digits': row[6], 'symbols': row[7], 'exclude_ambiguous': row[8]}
            if row[1] == 'enabled':
                result = validate_password(decrypt_seed(row[2]), policy,
                                           row[9], password, time.time())
                if result['valid']:
                    valid_uid = row[0]
        # 读事务到此为止：推导/校验已完成，先结束只读快照再开写事务。
        # 否则"读快照 →（毫秒级推导）→ 升级写"在并发写场景撞 SQLite WAL
        # 的 BUSY_SNAPSHOT（busy_timeout 不重试该错误）→ 500 database is locked。
        db.session.rollback()
        _log_validate(pid, username, result['valid'], ip,
                      last_validated=(valid_uid, datetime.now(timezone.utc))
                      if valid_uid is not None else None)
        return api_response(result)
    return await run_db(_impl)


def _clean_rate_limit(raw):
    """限流配置校验：int 0-10000；非法返回 None"""
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    return v if 0 <= v <= RATE_LIMIT_MAX else None


# ─── 项目管理（Basic Auth）───────────────────────────────

@admin_router.post('/projects')
async def create_project(request: Request):
    data = await _json_body(request)

    def _impl():
        name = (data.get('name') or '').strip()
        if not name or len(name) > 100:
            return api_response(None, 400, '项目名必填（≤100 字符）')
        if db.session.query(PwsvcProject).filter(PwsvcProject.name == name).count():
            return api_response(None, 400, '项目名已存在')
        rate_limit = RATE_LIMIT_DEFAULT
        if data.get('rate_limit') is not None:
            rate_limit = _clean_rate_limit(data.get('rate_limit'))
            if rate_limit is None:
                return api_response(None, 400, f'限流需为 0-{RATE_LIMIT_MAX} 的整数（0=不限）')
        key, key_hash, prefix = _new_api_key()
        p = PwsvcProject(name=name, description=(data.get('description') or '').strip()[:300],
                         api_key_hash=key_hash, api_key_prefix=prefix, rate_limit=rate_limit)
        db.session.add(p)
        db.session.commit()
        d = p.to_dict()
        d['api_key'] = key   # 明文仅此一次
        return api_response(d, 201, '创建成功')
    return await run_db(_impl)


@admin_router.get('/projects')
async def list_projects():
    def _impl():
        projects = db.session.query(PwsvcProject).order_by(PwsvcProject.id).all()
        # 计数一次 GROUP BY 拿全（原实现每项目 2 条 COUNT，N+1）
        type_counts = dict(db.session.query(
            PwsvcType.project_id, func.count(PwsvcType.id)).group_by(PwsvcType.project_id).all())
        user_counts = dict(db.session.query(
            PwsvcUser.project_id, func.count(PwsvcUser.id)).group_by(PwsvcUser.project_id).all())
        out = []
        for p in projects:
            d = p.to_dict()
            d['type_count'] = type_counts.get(p.id, 0)
            d['user_count'] = user_counts.get(p.id, 0)
            out.append(d)
        return api_response(out)
    return await run_db(_impl)


@admin_router.put('/projects/{pid}')
async def update_project(pid: int, request: Request):
    data = await _json_body(request)

    def _impl():
        p = db.session.query(PwsvcProject).filter(PwsvcProject.id == pid).first()
        if not p:
            return api_response(None, 404, '项目不存在')
        if 'name' in data:
            name = (data['name'] or '').strip()
            if not name:
                return api_response(None, 400, '项目名不能为空')
            dup = db.session.query(PwsvcProject).filter(PwsvcProject.name == name, PwsvcProject.id != pid).count()
            if dup:
                return api_response(None, 400, '项目名已存在')
            p.name = name
        if 'description' in data:
            p.description = (data['description'] or '').strip()[:300]
        if data.get('rate_limit') is not None:
            rate_limit = _clean_rate_limit(data.get('rate_limit'))
            if rate_limit is None:
                return api_response(None, 400, f'限流需为 0-{RATE_LIMIT_MAX} 的整数（0=不限）')
            if rate_limit != p.rate_limit:
                p.rate_limit = rate_limit
                _reset_bucket(pid)
        db.session.commit()
        return api_response(p.to_dict())
    return await run_db(_impl)


@admin_router.delete('/projects/{pid}')
async def delete_project(pid: int):
    def _impl():
        p = db.session.query(PwsvcProject).filter(PwsvcProject.id == pid).first()
        if not p:
            return api_response(None, 404, '项目不存在')
        PwsvcUser.query.filter(PwsvcUser.project_id == pid).delete()
        PwsvcType.query.filter(PwsvcType.project_id == pid).delete()
        PwsvcValidateLog.query.filter(PwsvcValidateLog.project_id == pid).delete()
        db.session.delete(p)
        db.session.commit()
        _reset_bucket(pid)
        return api_response({'id': pid})
    return await run_db(_impl)


@admin_router.post('/projects/{pid}/api-key')
async def reset_api_key(pid: int):
    """重置 API Key（旧 Key 立即失效；明文仅此一次）"""
    def _impl():
        p = db.session.query(PwsvcProject).filter(PwsvcProject.id == pid).first()
        if not p:
            return api_response(None, 404, '项目不存在')
        key, key_hash, prefix = _new_api_key()
        p.api_key_hash = key_hash
        p.api_key_prefix = prefix
        db.session.commit()
        d = p.to_dict()
        d['api_key'] = key
        return api_response(d)
    return await run_db(_impl)


# ─── 用户类型 ────────────────────────────────────────────

def _validate_policy(data):
    length = data.get('length', 16)
    if not isinstance(length, int) or not (8 <= length <= 64):
        return None, '密码长度需在 8-64 之间'
    flags = [data.get(k, True) for k in ('uppercase', 'lowercase', 'digits', 'symbols')]
    if not any(flags):
        return None, '至少启用一个字符集'
    rotation = data.get('rotation_seconds', 60)
    if rotation not in ROTATION_CHOICES:
        return None, '轮换周期可选：30/60/120/300/600 秒'
    return {
        'length': length, 'uppercase': bool(flags[0]), 'lowercase': bool(flags[1]),
        'digits': bool(flags[2]), 'symbols': bool(flags[3]),
        'exclude_ambiguous': bool(data.get('exclude_ambiguous', True)),
        'rotation_seconds': rotation,
    }, None


@admin_router.post('/projects/{pid}/types')
async def create_type(pid: int, request: Request):
    data = await _json_body(request)

    def _impl():
        if not db.session.query(PwsvcProject).filter(PwsvcProject.id == pid).count():
            return api_response(None, 404, '项目不存在')
        name = (data.get('name') or '').strip()
        if not name or len(name) > 50:
            return api_response(None, 400, '类型名必填（≤50 字符）')
        if db.session.query(PwsvcType).filter(PwsvcType.project_id == pid, PwsvcType.name == name).count():
            return api_response(None, 400, '类型名已存在')
        policy, err = _validate_policy(data)
        if err:
            return api_response(None, 400, err)
        t = PwsvcType(project_id=pid, name=name, **policy)
        db.session.add(t)
        db.session.commit()
        return api_response(t.to_dict(), 201, '创建成功')
    return await run_db(_impl)


@admin_router.get('/projects/{pid}/types')
async def list_types(pid: int):
    """项目下的类型列表（含用户数）"""
    def _impl():
        types = (db.session.query(PwsvcType)
                 .filter(PwsvcType.project_id == pid).order_by(PwsvcType.id).all())
        # 用户数一次 GROUP BY 拿全（原实现每类型 1 条 COUNT，N+1）
        user_counts = dict(db.session.query(
            PwsvcUser.type_id, func.count(PwsvcUser.id)).group_by(PwsvcUser.type_id).all())
        out = []
        for t in types:
            d = t.to_dict()
            d['user_count'] = user_counts.get(t.id, 0)
            out.append(d)
        return api_response(out)
    return await run_db(_impl)


@admin_router.put('/types/{tid}')
async def update_type(tid: int, request: Request):
    data = await _json_body(request)

    def _impl():
        t = db.session.query(PwsvcType).filter(PwsvcType.id == tid).first()
        if not t:
            return api_response(None, 404, '类型不存在')
        if 'name' in data:
            name = (data['name'] or '').strip()
            if not name:
                return api_response(None, 400, '类型名不能为空')
            dup = db.session.query(PwsvcType).filter(
                PwsvcType.project_id == t.project_id, PwsvcType.name == name, PwsvcType.id != tid).count()
            if dup:
                return api_response(None, 400, '类型名已存在')
            t.name = name
        policy, err = _validate_policy({**t.policy(), 'rotation_seconds': t.rotation_seconds, **data})
        if err:
            return api_response(None, 400, err)
        for k, v in policy.items():
            setattr(t, k, v)
        db.session.commit()
        return api_response(t.to_dict())
    return await run_db(_impl)


@admin_router.delete('/types/{tid}')
async def delete_type(tid: int):
    def _impl():
        t = db.session.query(PwsvcType).filter(PwsvcType.id == tid).first()
        if not t:
            return api_response(None, 404, '类型不存在')
        if db.session.query(PwsvcUser).filter(PwsvcUser.type_id == tid).count():
            return api_response(None, 409, '仍有用户属于该类型，先删除或迁移用户')
        db.session.delete(t)
        db.session.commit()
        return api_response({'id': tid})
    return await run_db(_impl)


# ─── 用户 ────────────────────────────────────────────────

@admin_router.post('/projects/{pid}/users')
async def create_user(pid: int, request: Request):
    data = await _json_body(request)

    def _impl():
        if not db.session.query(PwsvcProject).filter(PwsvcProject.id == pid).count():
            return api_response(None, 404, '项目不存在')
        username = (data.get('username') or '').strip()
        type_id = data.get('type_id')
        if not username or len(username) > 100:
            return api_response(None, 400, '用户名必填（≤100 字符）')
        t = db.session.query(PwsvcType).filter(PwsvcType.id == type_id, PwsvcType.project_id == pid).first()
        if not t:
            return api_response(None, 400, 'type_id 无效')
        if db.session.query(PwsvcUser).filter(PwsvcUser.project_id == pid, PwsvcUser.username == username).count():
            return api_response(None, 400, '用户名已存在')
        u = PwsvcUser(project_id=pid, type_id=type_id, username=username,
                      display_name=(data.get('display_name') or '').strip()[:100],
                      seed_encrypted=encrypt_seed(secrets.token_bytes(32)))
        db.session.add(u)
        db.session.commit()
        return api_response(u.to_dict(), 201, '创建成功')
    return await run_db(_impl)


@admin_router.get('/projects/{pid}/users')
async def list_users(pid: int):
    def _impl():
        # Core 按列查询：列表只要 to_dict 那几列（不含 seed_encrypted 密文），
        # 免去 ORM 逐行实例化（100 用户约 3.5ms → <1ms）；输出与 to_dict 逐字段一致
        rows = db.session.execute(
            select(PwsvcUser.id, PwsvcUser.project_id, PwsvcUser.type_id,
                   PwsvcUser.username, PwsvcUser.display_name, PwsvcUser.status,
                   PwsvcUser.last_validated_at, PwsvcUser.last_viewed_at, PwsvcUser.created_at)
            .where(PwsvcUser.project_id == pid)
            .order_by(PwsvcUser.id)
        ).all()
        out = [{'id': r[0], 'project_id': r[1], 'type_id': r[2],
                'username': r[3], 'display_name': r[4] or '', 'status': r[5],
                'last_validated_at': _iso(r[6]), 'last_viewed_at': _iso(r[7]),
                'created_at': _iso(r[8])} for r in rows]
        return api_response(out)
    return await run_db(_impl)


@admin_router.put('/users/{uid}')
async def update_user(uid: int, request: Request):
    data = await _json_body(request)

    def _impl():
        u = db.session.query(PwsvcUser).filter(PwsvcUser.id == uid).first()
        if not u:
            return api_response(None, 404, '用户不存在')
        if 'display_name' in data:
            u.display_name = (data['display_name'] or '').strip()[:100]
        if 'status' in data:
            if data['status'] not in ('enabled', 'disabled'):
                return api_response(None, 400, 'status 仅 enabled/disabled')
            u.status = data['status']
        if data.get('reset_seed'):
            u.seed_encrypted = encrypt_seed(secrets.token_bytes(32))  # 旧密码链全部失效
        db.session.commit()
        return api_response(u.to_dict())
    return await run_db(_impl)


@admin_router.delete('/users/{uid}')
async def delete_user(uid: int):
    def _impl():
        u = db.session.query(PwsvcUser).filter(PwsvcUser.id == uid).first()
        if not u:
            return api_response(None, 404, '用户不存在')
        db.session.delete(u)
        db.session.commit()
        return api_response({'id': uid})
    return await run_db(_impl)


@admin_router.get('/users/{uid}/current')
async def current_password(uid: int):
    """当前密码 + 剩余秒数（仅管理员 UI；密码即时推导，从不落盘）"""
    def _impl():
        row = (db.session.query(PwsvcUser, PwsvcType)
               .join(PwsvcType, PwsvcUser.type_id == PwsvcType.id)
               .filter(PwsvcUser.id == uid).first())
        if row is None:
            return api_response(None, 404, '用户不存在')
        u, t = row
        rotation = t.rotation_seconds
        now = time.time()
        window = int(now // rotation)
        password = derive_password(decrypt_seed(u.seed_encrypted), window, t.policy())
        expires_in = max(0, int((window + 1) * rotation - now))
        # 同 /validate：推导完成后先结束只读事务再写 last_viewed_at，
        # 避免读快照升级写时撞 WAL BUSY_SNAPSHOT（database is locked）
        db.session.rollback()

        def _write():
            db.session.execute(update(PwsvcUser).where(PwsvcUser.id == uid)
                               .values(last_viewed_at=datetime.now(timezone.utc)))
            db.session.commit()

        _run_write_retry(_write)
        return api_response({
            'password': password,
            'expires_in': expires_in,
            'rotation_seconds': rotation,
            'window': window,
        })
    return await run_db(_impl)


# ─── 校验日志（Basic Auth，管理员查看）────────────────────

@admin_router.get('/projects/{pid}/logs')
async def list_logs(pid: int, request: Request):
    """
    校验日志（倒序分页）+ 失败统计：
    stats.h1 / stats.h24 = 近 1 小时 / 24 小时的 成功(ok)/失败(fail) 计数，
    stats.fail_top = 近 24 小时失败最多的前 5 个用户名（爆破信号定位用）。
    """
    page = max(1, _query_int(request, 'page', 1))
    per_page = min(100, max(10, _query_int(request, 'per_page', 50)))

    def _impl():
        if not db.session.query(PwsvcProject).filter(PwsvcProject.id == pid).count():
            return api_response(None, 404, '项目不存在')

        q = db.session.query(PwsvcValidateLog).filter(PwsvcValidateLog.project_id == pid)
        total = q.count()
        items = (q.order_by(PwsvcValidateLog.id.desc())
                 .offset((page - 1) * per_page).limit(per_page).all())

        now = _utcnow()

        def _window_stats(hours):
            since = now - timedelta(hours=hours)
            rows = (db.session.query(PwsvcValidateLog.valid, func.count(PwsvcValidateLog.id))
                    .filter(PwsvcValidateLog.project_id == pid,
                            PwsvcValidateLog.created_at >= since)
                    .group_by(PwsvcValidateLog.valid).all())
            # 个别后端/驱动可能回 0/1 而非 bool；bool(v) 归一（注意 True==1 同哈希，不能相加）
            counts = {bool(v): c for v, c in rows}
            return {'ok': counts.get(True, 0), 'fail': counts.get(False, 0)}

        fail_top = (db.session.query(PwsvcValidateLog.username, func.count(PwsvcValidateLog.id))
                    .filter(PwsvcValidateLog.project_id == pid,
                            PwsvcValidateLog.valid.is_(False),
                            PwsvcValidateLog.created_at >= now - timedelta(hours=24))
                    .group_by(PwsvcValidateLog.username)
                    .order_by(func.count(PwsvcValidateLog.id).desc())
                    .limit(5).all())

        return api_response({
            'items': [l.to_dict() for l in items],
            'total': total,
            'page': page,
            'per_page': per_page,
            'stats': {
                'h1': _window_stats(1),
                'h24': _window_stats(24),
                'fail_top': [{'username': u, 'count': c} for u, c in fail_top],
            },
        })
    return await run_db(_impl)
