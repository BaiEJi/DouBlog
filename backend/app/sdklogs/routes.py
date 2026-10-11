"""
日志接收模块（sdklogs）：lizysdk send_json 的服务端，见 docs/lizylog 设计文档。

与独立服务版设计的差异（模块化适配）：
- 存储**不做独立配置**，跟随 DouBlog 设置页的数据库（data/db_config.json 切换即生效）
- Web 层是 DouBlog 的 FastAPI（单进程 uvicorn）；管理端点沿用 Basic Auth
- 摄入端点（/api/v1/logs[.../batch]）不挂 Basic Auth：SDK 现行发送不带凭据，
  可选静态 token（settings.logs_auth_token / LOGSDB_AUTH_TOKENS）时校验 Bearer

核心语义（与设计文档一致）：
- 接收协程只做轻活：校验 → 规范化 → 入队 → 202；落库由单写者线程批量完成
- 队列满丢最旧并计数（dropped）；批次落库失败重试 2 次后进死信（data/dead_letters/）
- 坏日志（级别/时间戳非法、缺必填）进死信而非 4xx，单条脏数据不影响整批
- ts 统一 naive UTC：无时区时间戳按 logs_incoming_tz 解释，RFC3339 带时区直接采用
- 保留策略：每日清理超过 retention_days 的行与死信文件（0=永久）
- 管道挂 app.state.sdklogs_pipeline：每 app 一条（多 app 测试互不泄漏），
  写者线程持有真实 app 对象
"""
import atexit
import json
import logging
import os
import queue
import threading
import time
import weakref
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, insert, select, text

from lizysdk.errors import AuthError, ParamError

from app.config import settings
from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response
from app.shared.timestamps import _iso, _utcnow
from app.sdklogs.models import SdkAlert, SdkLog

router = APIRouter(prefix='/api/v1', tags=['sdklogs'])


class _QuietIngestLog:
    """uvicorn 访问日志过滤：摄入端点高频 POST，逐条写日志纯耗 I/O（其他端点保留）。"""

    def filter(self, record):
        if record.name == 'uvicorn.access':
            try:
                msg = record.getMessage()
            except Exception:
                return True
            if 'POST /api/v1/logs' in msg:
                return False
        return True


logging.getLogger('uvicorn.access').addFilter(_QuietIngestLog())

LEVELS = {'DEBUG': 10, 'INFO': 20, 'WARNING': 30, 'ERROR': 40, 'CRITICAL': 50}
#: 数值 → 级别名（stats/直方图聚合反查用，与 LEVELS 同源不重复维护）
_LEVEL_NAMES = {num: name for name, num in LEVELS.items()}
RESERVED_KEYS = {'level', 'timestamp', 'file', 'line', 'sys_name', 'message', 'trace_id'}
#: 性能快路径总开关（压测 A/B 对照用：SDKLOGS_FASTPATH=0 回退到全 ORM 路径，
#: 行为完全一致，仅关掉检索静态 SQL / 写者 executemany / TTL 缓存三组优化）
_FASTPATH = os.environ.get('SDKLOGS_FASTPATH', '1') != '0'
BATCH_MAX = 1000
QUERY_RESERVED = {'start', 'end', 'sys_name', 'level', 'level_gte', 'trace_id',
                  'q', 'limit', 'offset', 'format', 'buckets', 'top',
                  'before', 'after', 'id'}
KEY_SAFE = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.')


# ─── 检索热路径：静态 SQL（绕过 ORM 会话机制，SQLite/PG 通用）────
# 实测（5200 行）裸 SQL 0.1ms，ORM 会话路径 2.5ms——开销几乎全在会话/编译层。
# 仅覆盖「无过滤」与「单一 sys_name」两个最热形状；其余过滤走原 ORM 路径。

_PAGE_COLS = ('id, ts, level, level_text, sys_name, file, line, trace_id, '
              'message, fields, received_at')
_COUNT_ALL = text('SELECT count(*) FROM sdklogs_logs')
_PAGE_ALL = text(f'SELECT {_PAGE_COLS} FROM sdklogs_logs '
                 'ORDER BY ts DESC, id DESC LIMIT :_lim OFFSET :_off')
_COUNT_SYS = text('SELECT count(*) FROM sdklogs_logs WHERE sys_name = :_sn')
_PAGE_SYS = text(f'SELECT {_PAGE_COLS} FROM sdklogs_logs WHERE sys_name = :_sn '
                 'ORDER BY ts DESC, id DESC LIMIT :_lim OFFSET :_off')


def _ts_out(v):
    """text() 裸读的时间列 → 与 ORM 路径 _iso() 完全一致的输出。

    SQLite 返回 'YYYY-MM-DD HH:MM:SS[.ffffff]' 字符串（ SQLAlchemy 落库格式，
    微秒恒 6 位）；isoformat() 语义 = 零微秒省略 '.000000'、分隔符换 'T'。
    PG（timestamptz）返回 datetime，走 _iso 归一。
    """
    if type(v) is str:
        if v.endswith('.000000'):
            v = v[:-7]
        return v.replace(' ', 'T', 1)
    return _iso(v)


def _row_out(r):
    """静态 SQL 行 → API dict（与 ORM 路径逐字段等价：fields 裸 JSON 文本需解析）"""
    return {'id': r[0], 'ts': _ts_out(r[1]), 'level': r[2], 'level_text': r[3],
            'sys_name': r[4], 'file': r[5], 'line': r[6], 'trace_id': r[7],
            'message': r[8],
            'fields': (json.loads(r[9]) if type(r[9]) is str else r[9]) or {},
            'received_at': _ts_out(r[10])}


def _fast_page(fast_key, limit: int, offset: int):
    """静态 SQL 取页：(总数, 行 dict 列表)；fast_key 为 None 时返回 None。"""
    if fast_key is None or not _FASTPATH:
        return None
    with db.engine.connect() as conn:
        if fast_key == 'all':
            total = conn.execute(_COUNT_ALL).scalar()
            rows = conn.execute(_PAGE_ALL, {'_lim': limit, '_off': offset}).fetchall()
        else:
            total = conn.execute(_COUNT_SYS, {'_sn': fast_key}).scalar()
            rows = conn.execute(_PAGE_SYS, {'_sn': fast_key, '_lim': limit,
                                             '_off': offset}).fetchall()
    return total, [_row_out(r) for r in rows]


# ─── 短 TTL 结果缓存（挂 app.state，多 app 测试互不泄漏；UI 轮询型端点专用）──

_CACHE_TTL = 5.0        # 秒；下拉/直方图/统计秒级新鲜度足够


def _cache_get(app, key):
    if not _FASTPATH:
        return None
    box = getattr(app.state, 'sdklogs_cache', None)
    if box is not None:
        hit = box.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return hit[1]
    return None


def _cache_put(app, key, value):
    box = getattr(app.state, 'sdklogs_cache', None)
    if box is None:
        box = {}
        app.state.sdklogs_cache = box
    box[key] = (time.monotonic() + _CACHE_TTL, value)


# ─── 时间解析：无时区按配置时区解释，带时区直接采用 ────────

_TZ_CACHE = {}

def _tz():
    tz = _TZ_CACHE.get('tz')
    if tz is None:
        from zoneinfo import ZoneInfo
        tz = _TZ_CACHE['tz'] = ZoneInfo(settings.logs_incoming_tz)
    return tz


def _tz_offset():
    """配置时区的 UTC 偏移（缓存；naive 快路径用，等价于 replace(tz)+astimezone 但省 zoneinfo 换算）"""
    off = _TZ_CACHE.get('off')
    if off is None:
        dt = datetime(2024, 6, 1, tzinfo=_tz())      # 任意固定时刻：偏移只随 DST 变化，本项目时区无 DST
        off = _TZ_CACHE['off'] = dt.utcoffset()
    return off


def parse_ts(raw: str):
    """
    SDK 时间戳 → naive UTC。支持：
    - '%Y-%m-%dT%H:%M:%S'（lizysdk 现行，无时区 → logs_incoming_tz 解释）
    - RFC3339 带偏移（+08:00 / Z 后缀）
    非法返回 None。热路径：无后缀的 19 字符朴素格式走减偏移快路径。
    """
    if not isinstance(raw, str) or not raw:
        return None
    s = raw.strip()
    # 快路径：'YYYY-MM-DDTHH:MM:SS'（SDK 现行格式，长度固定无时区，fromisoformat 走 C）
    if len(s) == 19 and s[10] == 'T':
        try:
            return datetime.fromisoformat(s) - _tz_offset()
        except ValueError:
            return None
    try:
        if s.endswith('Z') or s.endswith('z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_tz())
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _clip(value, n: int):
    """可选字符串列截断入库（None/空保留 None，非字符串统一转 str；file/trace_id 用）。"""
    return str(value)[:n] if value else None


# ─── 摄入管道：校验/规范化 → 队列 → 单写者批量落库/死信 ─────

def normalize_record(raw: dict, received_at=None):
    """
    SDK 单条 JSON → SdkLog 列 dict；非法抛 ValueError（调用方进死信）。
    fields 只保留业务 kv（剥离固定字段），值统一 str；trace_id 提升为列。
    received_at 可由批量调用方传入同一时刻（省去逐条取 now）。
    """
    if not isinstance(raw, dict):
        raise ValueError('日志必须是 JSON 对象')
    level_text = str(raw.get('level', '')).upper()
    if level_text not in LEVELS:
        raise ValueError(f'非法 level: {raw.get("level")!r}')
    sys_name = raw.get('sys_name')
    if not isinstance(sys_name, str) or not sys_name.strip() or len(sys_name) > 64:
        raise ValueError('sys_name 必填（≤64 字符）')
    ts = parse_ts(raw.get('timestamp'))
    if ts is None:
        raise ValueError(f'非法 timestamp: {raw.get("timestamp")!r}')
    message = raw.get('message')
    if message is None:
        raise ValueError('缺少 message')
    message = str(message)

    fields = {}
    for k, v in raw.items():
        if k in RESERVED_KEYS:
            continue
        # 与 SDK 行为一致：kv 值统一转字符串（容器转 JSON 文本）
        if isinstance(v, str):
            fields[k] = v
        elif isinstance(v, (dict, list)):
            fields[k] = json.dumps(v, ensure_ascii=False)
        else:
            fields[k] = str(v)

    line = raw.get('line')
    if isinstance(line, str) and line.isdigit():
        line = int(line)
    return {
        'ts': ts,
        'level': LEVELS[level_text],
        'level_text': level_text,
        'sys_name': sys_name.strip(),
        'file': _clip(raw.get('file'), 255),
        'line': line if isinstance(line, int) else None,
        'trace_id': _clip(raw.get('trace_id'), 64),
        'message': message,
        'fields': fields,
        'received_at': received_at if received_at is not None else _utcnow(),
    }


# ─── SQLite 写者快路径：驱动级 executemany（列序与落库格式对齐 SQLAlchemy）──

_SQLITE_INSERT = ('INSERT INTO sdklogs_logs (ts, level, level_text, sys_name, file, line, '
                  'trace_id, message, fields, received_at) VALUES (?,?,?,?,?,?,?,?,?,?)')


def _fmt_dt(dt: datetime) -> str:
    """datetime → SQLAlchemy SQLite DATETIME 落库格式（微秒恒 6 位，保证回读一致）"""
    return (f'{dt.year:04d}-{dt.month:02d}-{dt.day:02d} '
            f'{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d}.{dt.microsecond:06d}')


def _sqlite_row(r: dict) -> tuple:
    """normalize_record 输出 → 驱动参数元组（fields 预序列化，省 ORM 类型处理）"""
    return (_fmt_dt(r['ts']), r['level'], r['level_text'], r['sys_name'], r['file'],
            r['line'], r['trace_id'], r['message'],
            json.dumps(r['fields'], ensure_ascii=False), _fmt_dt(r['received_at']))


class _Pipeline:
    """每个 app 一条：队列 + 单写者线程 + 计数器 + 死信（挂 app.state.sdklogs_pipeline）。"""

    def __init__(self, app):
        self.app = app
        self.q = queue.Queue(maxsize=settings.logs_queue_max)
        self.lock = threading.Lock()
        self.stats = {'accepted': 0, 'dropped': 0, 'failed': 0, 'dead_letter': 0}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name='sdklogs-writer', daemon=True)
        self._started = False
        # 捕获创建时的 scoped_session：写者线程绑定本 app 的引擎。db.session 是随
        # rebuild_engine 整体替换的全局，若每次落库时才解析，测试多 app 并存时会
        # 把上一个 app 的存量行写进新 app 的库（跨库串写）。
        self._registry = db.session
        _PIPELINES.add(self)      # 弱引用注册表：进程退出前统一排空（不跨 app 泄漏）

    def ensure_started(self):
        if not self._started:
            with self.lock:
                if not self._started:
                    self._started = True
                    self._thread.start()

    def submit(self, row: dict):
        self.submit_list([row])

    def submit_list(self, rows: list):
        """入队（可整批作为一个队列元素，摊薄锁开销）；满则丢最旧并计数，永不阻塞接收协程。"""
        self.ensure_started()
        n = len(rows)
        while True:
            try:
                self.q.put_nowait(rows)
                with self.lock:
                    self.stats['accepted'] += n
                return
            except queue.Full:
                try:
                    old = self.q.get_nowait()
                    with self.lock:
                        self.stats['dropped'] += len(old) if isinstance(old, list) else 1
                except queue.Empty:
                    pass

    def dead_letter(self, payload, reason: str):
        """坏日志/落库失败批次 → data/dead_letters/YYYYMMDD.jsonl（可整文件重放回 /logs/batch）。"""
        try:
            d = os.path.join(settings.data_dir, 'dead_letters')
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, _utcnow().strftime('%Y%m%d') + '.jsonl')
            entry = {'reason': reason, 'received_at': _iso_now(), 'payload': payload}
            with open(path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
            with self.lock:
                self.stats['dead_letter'] += 1
        except OSError:
            pass

    def _batch_rows(self):
        """攒批：满 batch_size 或自首条起 flush_ms 到期才返回；返回 (行列表, 队列元素数)。
        队列元素可能是单行 dict 或整批 list（submit_list），统一摊平。"""
        rows = []
        try:
            first = self.q.get(timeout=0.2)
        except queue.Empty:
            return rows, 0
        rows.extend(first if isinstance(first, list) else (first,))
        items = 1
        deadline = time.monotonic() + settings.logs_flush_ms / 1000.0
        while len(rows) < settings.logs_batch_size:
            remain = deadline - time.monotonic()
            if remain <= 0:
                break
            try:
                item = self.q.get(timeout=remain)
            except queue.Empty:
                break
            rows.extend(item if isinstance(item, list) else (item,))
            items += 1
        return rows, items

    def _run(self):
        """单写者主循环：攒批 → 落库（重试 2 次）→ 死信；空转时低频轮询。"""
        while not self._stop.is_set() or not self.q.empty():
            rows, n_items = self._batch_rows()
            if not rows:
                self._stop.wait(0.2)
                continue
            self._flush_rows(rows)
            for _ in range(n_items):
                self.q.task_done()

    def _flush_rows(self, rows):
        """批量落库：SQLite 走驱动级 executemany 快路径（绕过 ORM 逐行参数处理），
        失败兜底原 ORM 路径；语义不变（重试后仍失败 → failed 计数 + 死信），
        单写者线程结构不变。"""
        ok = False
        sess = self._registry             # 本 app 的 scoped session（线程本地）
        try:
            bind = sess.get_bind()        # 本 app 的引擎（捕获语义与 _registry 一致）
            if _FASTPATH and bind.dialect.name == 'sqlite':
                data = [_sqlite_row(r) for r in rows]
                for attempt in range(3):  # 首次 + 重试 2 次
                    try:
                        with bind.begin() as conn:
                            conn.exec_driver_sql(_SQLITE_INSERT, data)
                        ok = True
                        break
                    except Exception:
                        if attempt < 2:
                            time.sleep(0.1 * (2 ** attempt))
        except Exception:
            ok = False
        if not ok:
            for attempt in range(3):      # PG 主路径 / sqlite 快路径异常兜底
                try:
                    sess.execute(insert(SdkLog), rows)
                    sess.commit()
                    ok = True
                    break
                except Exception:
                    sess.rollback()
                    if attempt < 2:
                        time.sleep(0.1 * (2 ** attempt))
        sess.remove()                     # 写者线程的 scoped session 用完即还
        if not ok:
            with self.lock:
                self.stats['failed'] += len(rows)
            for r in rows:
                self.dead_letter(r, 'db_insert_failed')

    def flush(self, timeout: float = 5.0) -> bool:
        """等待已入队日志全部落库或进死信（测试与停机语义用）。"""
        self.ensure_started()
        done = threading.Event()

        def _join():
            self.q.join()
            done.set()

        watcher = threading.Thread(target=_join, daemon=True)
        watcher.start()
        return done.wait(timeout)

    def stop(self, timeout: float = 5.0):
        """优雅停机：停接收 → 排空 → 退出（残留批次已由 _run 循环条件兜底落库/死信）。"""
        self._stop.set()
        self.flush(timeout)
        self._thread.join(timeout)


def _iso_now():
    return _utcnow().isoformat()


#: 全部存活管道的弱引用注册表（不延长 app 生命周期，仅用于退出排空）
_PIPELINES = weakref.WeakSet()


def get_pipeline(app) -> _Pipeline:
    """app 对应的管道（惰性创建，挂 app.state.sdklogs_pipeline 随 app 生命周期）。"""
    p = getattr(app.state, 'sdklogs_pipeline', None)
    if p is None:
        p = _Pipeline(app)
        app.state.sdklogs_pipeline = p
    return p


@atexit.register
def _drain_pipelines():
    """进程退出前尽力排空各 app 的写者队列（强杀时为尽力而为，设计已接受）。"""
    for p in list(_PIPELINES):
        try:
            p._stop.set()
            p.flush(3.0)      # _run 循环条件保证 stop 后仍会排空存量
        except Exception:
            pass


# ─── 摄入端点（SDK 调用；可选 Bearer token，不挂 Basic Auth）────

_TOKEN_CACHE = ['', []]                          # [原始配置串, 切分结果]


def _check_token(request: Request):
    """配置了 token 则校验 Authorization: Bearer <token>；未配置/全空白直接放行，不符抛 AuthError。"""
    raw = settings.logs_auth_token
    if not raw:
        return
    tokens = _TOKEN_CACHE[1]                     # 按原始配置串缓存切分结果
    if _TOKEN_CACHE[0] != raw or not _FASTPATH:
        tokens = [t.strip() for t in raw.split(',') if t.strip()]
        _TOKEN_CACHE[0] = raw
        _TOKEN_CACHE[1] = tokens
    if not tokens:
        return
    header = request.headers.get('Authorization', '')
    if not (header.startswith('Bearer ') and header[7:].strip() in tokens):
        raise AuthError(message='日志上传 token 无效')


async def _ingest_payload(request: Request) -> list:
    """请求体 → 记录列表：JSON 单对象 / JSON 数组 / JSONL 文本；非法直接抛 ParamError。"""
    ct = (request.headers.get('content-type') or '').lower()
    raw = (await request.body()).decode('utf-8') or ''
    if 'json' in ct or (raw.lstrip()[:1] == '[' and raw.rstrip()[-1:] == ']'):
        try:
            obj = json.loads(raw)
        except ValueError:
            raise ParamError(message='非法 JSON')
        return obj if isinstance(obj, list) else [obj]
    # JSONL：整包一次数组解析（比逐行 loads 快 ~20-30%）；失败退回逐行以定位坏行
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    if not lines:
        return []
    try:
        return json.loads('[' + ','.join(lines) + ']')
    except ValueError:
        pass
    records = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except ValueError:
            raise ParamError(message=f'非法 JSONL 行: {line[:80]!r}')
    return records


@router.post('/logs')
async def ingest_one(request: Request):
    _check_token(request)
    records = await _ingest_payload(request)
    if len(records) != 1:
        raise ParamError(message='单条端点仅接受一个 JSON 对象')
    p = get_pipeline(request.app)
    try:
        p.submit(normalize_record(records[0], _utcnow()))
    except ValueError as e:
        p.dead_letter(records[0], f'invalid: {e}')
        return api_response({'accepted': 0, 'dead_lettered': 1}, 202, '已接收（坏数据进死信）')
    return api_response({'accepted': 1, 'dead_lettered': 0}, 202, '已接收')


@router.post('/logs/batch')
async def ingest_batch(request: Request):
    _check_token(request)
    records = await _ingest_payload(request)
    if not records:
        raise ParamError(message='空批次')
    if len(records) > BATCH_MAX:
        raise ParamError(message=f'单批上限 {BATCH_MAX} 条（当前 {len(records)}）')
    p = get_pipeline(request.app)
    good = []
    dead = 0
    now = _utcnow()                     # 整批共享同一入库时刻（省逐条取 now）
    for raw in records:
        try:
            good.append(normalize_record(raw, now))
        except ValueError as e:
            p.dead_letter(raw, f'invalid: {e}')
            dead += 1
    if good:
        p.submit_list(good)
    return api_response({'accepted': len(good), 'dead_lettered': dead}, 202, '已接收')


# ─── 检索（Basic Auth 管理）──────────────────────────────

def _parse_query_ts(raw, is_end=False):
    if not raw:
        return None
    ts = parse_ts(raw)
    if ts is None:
        return None
    if is_end and len(raw.strip()) == 10:          # 'YYYY-MM-DD' → 当天 23:59:59.999
        return ts + timedelta(days=1) - timedelta(milliseconds=1)
    return ts


def _kv_condition(key: str, value: str):
    """fields kv 过滤 → 跨方言条件（SQLite json_extract / PG ->>）。key 限安全字符防注入。"""
    if not key or not set(key) <= KEY_SAFE:
        raise ValueError(f'非法过滤参数名: {key!r}')
    if db.engine.dialect.name == 'sqlite':
        return func.json_extract(SdkLog.fields, f'$.{key}') == value
    return SdkLog.fields.op('->>')(key) == value


def _build_filters(request: Request):
    """query string → (filters, err_response, fast_key)。

    fast_key：无过滤='all'、仅单一 sys_name=该名字（两者走静态 SQL 热路径），
    其余组合=None（ORM 路径）。任意保留字之外的参数视为 fields kv 过滤。
    """
    args = request.query_params
    filters = []
    fast_key = 'all'
    start = _parse_query_ts(args.get('start'))
    if args.get('start') and start is None:
        return None, api_response(None, 400, 'start 非法'), None
    end = _parse_query_ts(args.get('end'), is_end=True)
    if args.get('end') and end is None:
        return None, api_response(None, 400, 'end 非法'), None
    if start:
        filters.append(SdkLog.ts >= start)
        fast_key = None
    if end:
        filters.append(SdkLog.ts <= end)
        fast_key = None
    if args.get('sys_name'):
        names = [s.strip() for s in args.get('sys_name').split(',') if s.strip()]
        filters.append(SdkLog.sys_name.in_(names))
        fast_key = names[0] if len(names) == 1 and fast_key else None
    if args.get('level'):
        levels = [l.strip().upper() for l in args.get('level').split(',') if l.strip()]
        bad = [l for l in levels if l not in LEVELS]
        if bad:
            return None, api_response(None, 400, f'非法 level: {bad}'), None
        filters.append(SdkLog.level.in_([LEVELS[l] for l in levels]))
        fast_key = None
    if args.get('level_gte'):
        l = args.get('level_gte').strip().upper()
        if l not in LEVELS:
            return None, api_response(None, 400, f'非法 level_gte: {l!r}'), None
        filters.append(SdkLog.level >= LEVELS[l])
        fast_key = None
    if args.get('trace_id'):
        filters.append(SdkLog.trace_id == args.get('trace_id').strip())
        fast_key = None
    if args.get('q'):
        filters.append(SdkLog.message.contains(args.get('q'), autoescape=True))
        fast_key = None
    for key in args:
        if key in QUERY_RESERVED:
            continue
        try:
            filters.append(_kv_condition(key, args.get(key, '')))
        except ValueError as e:
            return None, api_response(None, 400, str(e)), None
        fast_key = None
    return filters, None, fast_key


@router.get('/logs', dependencies=[Depends(require_basic)])
async def search_logs(request: Request):
    filters, err, fast_key = _build_filters(request)
    if err is not None:
        return err
    try:
        limit = min(1000, max(1, int(request.query_params.get('limit', 100))))
        offset = max(0, int(request.query_params.get('offset', 0)))
    except ValueError:
        return api_response(None, 400, 'limit/offset 需为整数')

    def _impl():
        # 热路径（无过滤 / 单一 sys_name）：静态 SQL 直取，跳过 ORM 会话
        fast = _fast_page(fast_key, limit, offset)
        if fast is not None:
            return api_response({'total': fast[0], 'items': fast[1],
                                 'limit': limit, 'offset': offset})
        q = db.session.query(SdkLog)
        for f in filters:
            q = q.filter(f)
        total = q.count()
        # Core 直取列 + 手工装 dict：省掉 ORM 实例化与逐行 to_dict（百行级省毫秒）
        sel = (select(SdkLog.id, SdkLog.ts, SdkLog.level, SdkLog.level_text, SdkLog.sys_name,
                      SdkLog.file, SdkLog.line, SdkLog.trace_id, SdkLog.message,
                      SdkLog.fields, SdkLog.received_at)
               .where(*filters).order_by(SdkLog.ts.desc(), SdkLog.id.desc())
               .offset(offset).limit(limit))
        items = [{'id': r[0], 'ts': _iso(r[1]), 'level': r[2], 'level_text': r[3],
                  'sys_name': r[4], 'file': r[5], 'line': r[6], 'trace_id': r[7],
                  'message': r[8], 'fields': r[9] or {}, 'received_at': _iso(r[10])}
                 for r in db.session.execute(sel)]
        return api_response({'total': total, 'items': items,
                             'limit': limit, 'offset': offset})
    return await run_db(_impl)


@router.get('/logs/sysnames', dependencies=[Depends(require_basic)])
async def list_sysnames(request: Request):
    """库内实际出现过的 sys_name（查询页下拉用，附条数便于辨识；短 TTL 缓存）"""
    cached = _cache_get(request.app, 'sysnames')
    if cached is not None:
        return cached

    def _impl():
        rows = (db.session.query(SdkLog.sys_name, func.count(SdkLog.id))
                .group_by(SdkLog.sys_name)
                .order_by(func.count(SdkLog.id).desc()).limit(200).all())
        return api_response([{'sys_name': r[0], 'count': r[1]} for r in rows])
    resp = await run_db(_impl)
    _cache_put(request.app, 'sysnames', resp)
    return resp


@router.get('/logs/count', dependencies=[Depends(require_basic)])
async def count_logs(request: Request):
    filters, err, fast_key = _build_filters(request)
    if err is not None:
        return err

    def _impl():
        if fast_key == 'all' and _FASTPATH:        # 无过滤：静态 count（索引覆盖扫描）
            with db.engine.connect() as conn:
                return api_response({'total': conn.execute(_COUNT_ALL).scalar()})
        q = db.session.query(SdkLog)
        for f in filters:
            q = q.filter(f)
        return api_response({'total': q.count()})
    return await run_db(_impl)


@router.get('/stats', dependencies=[Depends(require_basic)])
async def stats(request: Request):
    """近 24h 按 sys_name/level 计数 + 队列/丢弃/死信计数 + 库内总数。

    DB 聚合部分短 TTL 缓存（三条聚合查询是固定开销）；队列/计数器保持实时。
    """
    cached = _cache_get(request.app, 'stats')
    if cached is not None:
        by_sys, by_level, total_rows = cached
    else:
        def _impl():
            since = _utcnow() - timedelta(hours=24)
            by_sys = [{'sys_name': r[0], 'count': r[1]}
                      for r in db.session.query(SdkLog.sys_name, func.count(SdkLog.id))
                      .filter(SdkLog.ts >= since).group_by(SdkLog.sys_name)
                      .order_by(func.count(SdkLog.id).desc()).limit(10)]
            by_level = dict.fromkeys(LEVELS, 0)
            for row in db.session.query(SdkLog.level, func.count(SdkLog.id)) \
                    .filter(SdkLog.ts >= since).group_by(SdkLog.level):
                by_level[_LEVEL_NAMES[row[0]]] = row[1]
            return by_sys, by_level, db.session.query(SdkLog).count()
        by_sys, by_level, total_rows = await run_db(_impl)
        _cache_put(request.app, 'stats', (by_sys, by_level, total_rows))

    p = getattr(request.app.state, 'sdklogs_pipeline', None)
    counters = dict(p.stats) if p else {'accepted': 0, 'dropped': 0, 'failed': 0, 'dead_letter': 0}
    return api_response({
        'h24_by_sys': by_sys,
        'h24_by_level': by_level,
        'queue_size': p.q.qsize() if p else 0,
        'total_rows': total_rows,
        **counters,
    })


# ─── 直方图 / 上下文 / 模式分组 / 导出 / trace（查询页探索能力）──

@router.get('/logs/histogram', dependencies=[Depends(require_basic)])
async def histogram(request: Request):
    """时间直方图：把过滤命中的行按等宽时间桶 × 级别计数。

    单用户量级（≤10 万行窗口）直接拉 (ts, level) 在 Python 聚合，
    避免跨方言的日期分桶 SQL。缺省时间窗 = 最近 24h。
    结果按查询串短 TTL 缓存（前端直方图轮询高频、桶数据秒级新鲜度足够）。
    """
    filters, err, _fast = _build_filters(request)
    if err is not None:
        return err
    try:
        buckets_n = min(240, max(10, int(request.query_params.get('buckets', 60))))
    except ValueError:
        return api_response(None, 400, 'buckets 需为整数')
    start = _parse_query_ts(request.query_params.get('start'))
    end = _parse_query_ts(request.query_params.get('end'), is_end=True)
    if not start or not end or end <= start:
        end = _utcnow()
        start = end - timedelta(hours=24)

    cache_key = ('hist', str(request.query_params))
    cached = _cache_get(request.app, cache_key)
    if cached is not None:
        return cached

    def _impl():
        bucket_secs = max(1, int((end - start).total_seconds() / buckets_n))
        rows = (db.session.query(SdkLog.ts, SdkLog.level)
                .filter(SdkLog.ts >= start, SdkLog.ts <= end, *filters)
                .order_by(SdkLog.ts).limit(100000).all())
        counts = [dict.fromkeys(LEVELS, 0) for _ in range(buckets_n)]
        for ts, level in rows:
            idx = min(buckets_n - 1, max(0, int((ts - start).total_seconds() // bucket_secs)))
            counts[idx][_LEVEL_NAMES.get(level, 'INFO')] += 1
        buckets = []
        for i, c in enumerate(counts):
            b_start = start + timedelta(seconds=i * bucket_secs)
            buckets.append({'start': b_start.isoformat(), 'total': sum(c.values()), 'counts': c})
        totals = {name: sum(c[name] for c in counts) for name in LEVELS}
        return api_response({'buckets': buckets, 'bucket_secs': bucket_secs,
                             'start': start.isoformat(), 'end': end.isoformat(),
                             'totals': totals, 'total': sum(totals.values())})
    resp = await run_db(_impl)
    _cache_put(request.app, cache_key, resp)
    return resp


@router.get('/logs/context', dependencies=[Depends(require_basic)])
async def log_context(request: Request):
    """日志上下文：某行前后各 N 条（全局时间序，含锚点行）。"""
    try:
        aid = int(request.query_params.get('id'))
        before = min(100, max(1, int(request.query_params.get('before', 10))))
        after = min(100, max(1, int(request.query_params.get('after', 10))))
    except (TypeError, ValueError):
        return api_response(None, 400, 'id/before/after 需为整数')

    def _impl():
        anchor = db.session.get(SdkLog, aid)
        if anchor is None:
            return api_response(None, 404, '日志不存在')
        sel_cols = (SdkLog.id, SdkLog.ts, SdkLog.level_text, SdkLog.sys_name,
                    SdkLog.file, SdkLog.line, SdkLog.trace_id, SdkLog.message)

        def _dict(r, anchor_flag=False):
            return {'id': r[0], 'ts': r[1].isoformat(), 'level_text': r[2], 'sys_name': r[3],
                    'file': r[4], 'line': r[5], 'trace_id': r[6], 'message': r[7], 'anchor': anchor_flag}

        prev = list(db.session.execute(
            select(*sel_cols).where(and_(SdkLog.ts <= anchor.ts, SdkLog.id != anchor.id))
            .order_by(SdkLog.ts.desc(), SdkLog.id.desc()).limit(before)))[::-1]
        nxt = list(db.session.execute(
            select(*sel_cols).where(and_(SdkLog.ts >= anchor.ts, SdkLog.id != anchor.id))
            .order_by(SdkLog.ts.asc(), SdkLog.id.asc()).limit(after)))
        items = [_dict(r) for r in prev] + \
            [_dict((anchor.id, anchor.ts, anchor.level_text, anchor.sys_name, anchor.file,
                    anchor.line, anchor.trace_id, anchor.message), True)] + \
            [_dict(r) for r in nxt]
        return api_response({'items': items, 'before': len(prev), 'after': len(nxt)})
    return await run_db(_impl)


_PATTERN_RULES = None

def _pattern_rules():
    """message 模板化规则（惰性编译）：uuid/ip/路径/长hex/引号串/数字 → 占位符。"""
    global _PATTERN_RULES
    if _PATTERN_RULES is None:
        import re
        _PATTERN_RULES = [
            (re.compile(r'\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b'), '<uuid>'),
            (re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b'), '<ip>'),
            (re.compile(r'(?:[A-Za-z]:)?[/\\][\w\-./\\]+\.\w{1,5}'), '<path>'),
            (re.compile(r'\b[0-9a-fA-F]{16,}\b'), '<hex>'),
            (re.compile(r'"[^"\n]{1,120}"'), '<str>'),
            (re.compile(r'\d+(?:\.\d+)?'), '<num>'),
        ]
    return _PATTERN_RULES


def templatize(message: str) -> str:
    out = message
    for rule, placeholder in _pattern_rules():
        out = rule.sub(placeholder, out)
    return out


@router.get('/logs/patterns', dependencies=[Depends(require_basic)])
async def log_patterns(request: Request):
    """模式分组：相似 message 归并为模板（数字/uuid/ip/路径 等占位化），按频次排序。"""
    filters, err, _fast = _build_filters(request)
    if err is not None:
        return err
    try:
        top = min(50, max(5, int(request.query_params.get('top', 20))))
    except ValueError:
        return api_response(None, 400, 'top 需为整数')

    def _impl():
        rows = (db.session.query(SdkLog.message, SdkLog.level_text)
                .filter(*filters).order_by(SdkLog.ts.desc()).limit(20000).all())
        grouped = {}
        for message, level_text in rows:
            tpl = templatize(message)
            g = grouped.setdefault(tpl, {'pattern': tpl, 'count': 0, 'sample': message, 'levels': {}})
            g['count'] += 1
            g['levels'][level_text] = g['levels'].get(level_text, 0) + 1
        items = sorted(grouped.values(), key=lambda g: -g['count'])[:top]
        return api_response({'items': items, 'analyzed': len(rows), 'distinct': len(grouped)})
    return await run_db(_impl)


EXPORT_MAX = 10000


@router.get('/logs/export', dependencies=[Depends(require_basic)])
async def export_logs(request: Request):
    """按当前查询条件导出 CSV / JSON（上限 1 万条，流式生成）。"""
    filters, err, _fast = _build_filters(request)
    if err is not None:
        return err
    fmt = request.query_params.get('format', 'csv').lower()
    if fmt not in ('csv', 'json'):
        return api_response(None, 400, 'format 仅支持 csv / json')

    def _impl():
        sel = (select(SdkLog.ts, SdkLog.level_text, SdkLog.sys_name, SdkLog.file,
                      SdkLog.line, SdkLog.trace_id, SdkLog.message, SdkLog.fields)
               .where(*filters).order_by(SdkLog.ts.desc(), SdkLog.id.desc()).limit(EXPORT_MAX))
        return db.session.execute(sel).fetchall()   # 取回后再流式拼装（session 不跨协程）

    rows = await run_db(_impl)
    stamp = _utcnow().strftime('%Y%m%d-%H%M%S')

    def _gen_csv():
        import csv as _csv
        import io as _io
        buf = _io.StringIO()
        w = _csv.writer(buf)
        w.writerow(['ts', 'level', 'sys_name', 'file', 'line', 'trace_id', 'message', 'fields'])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for r in rows:
            w.writerow([r[0].isoformat(), r[1], r[2], r[3] or '', r[4] or '', r[5] or '',
                        r[6], json.dumps(r[7] or {}, ensure_ascii=False)])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    def _gen_json():
        first = True
        yield '['
        for r in rows:
            yield ('' if first else ',') + json.dumps(
                {'ts': r[0].isoformat(), 'level': r[1], 'sys_name': r[2], 'file': r[3],
                 'line': r[4], 'trace_id': r[5], 'message': r[6], 'fields': r[7] or {}},
                ensure_ascii=False)
            first = False
        yield ']'

    mt = 'text/csv' if fmt == 'csv' else 'application/json'
    return StreamingResponse(_gen_csv() if fmt == 'csv' else _gen_json(),
                             media_type=mt,
                             headers={'Content-Disposition': f'attachment; filename=logs-{stamp}.{fmt}',
                                      'Content-Type': f'{mt}; charset=utf-8'})


@router.get('/logs/trace', dependencies=[Depends(require_basic)])
async def trace_view(request: Request):
    """trace 时间线：同 trace_id 的日志按时间升序（简化版 trace 视图）。"""
    tid = (request.query_params.get('id') or '').strip()
    if not tid:
        return api_response(None, 400, 'id 必填')

    def _impl():
        rows = (db.session.query(SdkLog).filter(SdkLog.trace_id == tid)
                .order_by(SdkLog.ts.asc(), SdkLog.id.asc()).limit(1000).all())
        items = [r.to_dict() for r in rows]
        span = None
        if items:
            span = {'start': items[0]['ts'], 'end': items[-1]['ts'],
                    'span_ms': int((rows[-1].ts - rows[0].ts).total_seconds() * 1000)}
        return api_response({'trace_id': tid, 'items': items, 'span': span})
    return await run_db(_impl)


# ─── 日志告警：阈值规则 + webhook 通知 + 事件表 ────────────

ALERT_CFG_KEYS = {'enabled': bool, 'level_gte': str, 'threshold': int,
                  'window_minutes': int, 'sys_name': str, 'webhook_url': str,
                  'cooldown_minutes': int}
DEFAULT_ALERT_CFG = {'enabled': False, 'level_gte': 'ERROR', 'threshold': 10,
                     'window_minutes': 5, 'sys_name': '', 'webhook_url': '',
                     'cooldown_minutes': 30}


def _alert_cfg_path():
    return os.path.join(settings.data_dir, 'logs_alerts.json')


def load_alert_cfg() -> dict:
    cfg = dict(DEFAULT_ALERT_CFG)
    try:
        with open(_alert_cfg_path(), encoding='utf-8') as f:
            stored = json.load(f)
        if isinstance(stored, dict):
            for k, cast in ALERT_CFG_KEYS.items():
                if k in stored and (not isinstance(cast, bool) or isinstance(stored[k], bool)):
                    try:
                        cfg[k] = cast(stored[k])
                    except (TypeError, ValueError):
                        pass
            cfg['enabled'] = bool(cfg['enabled'])
    except (OSError, ValueError):
        pass
    return cfg


def save_alert_cfg(cfg: dict):
    os.makedirs(settings.data_dir, exist_ok=True)
    with open(_alert_cfg_path(), 'w', encoding='utf-8') as f:
        json.dump({k: cfg.get(k, DEFAULT_ALERT_CFG[k]) for k in ALERT_CFG_KEYS},
                  f, ensure_ascii=False, indent=2)


def _webhook_notify(url: str, payload: dict):
    """尽力通知：3s 超时，任何失败静默（事件表已留 notified 标志可查）。"""
    import urllib.request
    try:
        req = urllib.request.Request(
            url, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=3):
            return True
    except Exception:
        return False


def check_alerts(app) -> dict:
    """立即执行一次告警检查（配置启用时）：窗口计数 → 触发事件 + webhook。

    冷却：距上次**未确认或已确认**的同规则事件 cooldown_minutes 内不重复触发。
    """
    cfg = load_alert_cfg()
    result = {'enabled': cfg['enabled'], 'count': 0, 'triggered': False}
    if not cfg['enabled']:
        return result
    try:
        lvl = LEVELS.get(cfg['level_gte'])
        if lvl is None:
            return result
        since = _utcnow() - timedelta(minutes=cfg['window_minutes'])
        q = (db.session.query(SdkLog).filter(SdkLog.ts >= since, SdkLog.level >= lvl))
        if cfg['sys_name']:
            q = q.filter(SdkLog.sys_name == cfg['sys_name'])
        latest = (q.order_by(SdkLog.ts.desc(), SdkLog.id.desc())
                  .limit(cfg['threshold']).all())
        result['count'] = q.count()
        if len(latest) < cfg['threshold']:
            return result
        # 冷却判断：同级别+同系统 最近一条事件还在冷却期内 → 不重复
        cooldown_cut = _utcnow() - timedelta(minutes=cfg['cooldown_minutes'])
        dup = (db.session.query(SdkAlert)
               .filter(SdkAlert.created_at > cooldown_cut,
                       SdkAlert.level_text == cfg['level_gte'],
                       SdkAlert.sys_name == (cfg['sys_name'] or None))
               .first())
        if dup is not None:
            return result
        evt = SdkAlert(level_text=cfg['level_gte'], sys_name=cfg['sys_name'] or None,
                       count=result['count'], window_minutes=cfg['window_minutes'],
                       sample=(latest[0].message or '')[:500])
        db.session.add(evt)
        db.session.commit()
        result['triggered'] = True
        result['event_id'] = evt.id
        if cfg['webhook_url'].startswith(('http://', 'https://')):
            evt.notified = _webhook_notify(cfg['webhook_url'], {
                'type': 'doublog.log_alert', 'level': evt.level_text,
                'sys_name': evt.sys_name or '*', 'count': evt.count,
                'window_minutes': evt.window_minutes, 'sample': evt.sample,
                'created_at': evt.created_at.isoformat()})
            db.session.commit()
        return result
    finally:
        db.session.rollback()
        db.session.remove()      # 可能被 run_db 或后台线程直接调用，用完即还


@router.get('/alerts', dependencies=[Depends(require_basic)])
async def alerts_state():
    def _impl():
        events = (db.session.query(SdkAlert).order_by(SdkAlert.created_at.desc())
                  .limit(50).all())
        return api_response({
            'config': load_alert_cfg(),
            'events': [e.to_dict() for e in events],
            'unacked': sum(1 for e in events if not e.acked),
        })
    return await run_db(_impl)


@router.put('/alerts/config', dependencies=[Depends(require_basic)])
async def alerts_put_config(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    cfg = load_alert_cfg()
    for k in ALERT_CFG_KEYS:
        if k not in data:
            continue
        v = data[k]
        if k in ('enabled',):
            if not isinstance(v, bool):
                return api_response(None, 400, 'enabled 需为布尔值')
            cfg[k] = v
        elif k == 'level_gte':
            if v not in LEVELS:
                return api_response(None, 400, f'非法 level_gte: {v!r}')
            cfg[k] = v
        elif k in ('threshold', 'window_minutes', 'cooldown_minutes'):
            try:
                v = int(v)
            except (TypeError, ValueError):
                return api_response(None, 400, f'{k} 需为整数')
            if k == 'threshold' and not (1 <= v <= 100000):
                return api_response(None, 400, 'threshold 需在 1–100000')
            if v < 1 or v > 1440:
                return api_response(None, 400, f'{k} 需在 1–1440')
            cfg[k] = v
        elif k == 'webhook_url':
            v = (v or '').strip()
            if v and not v.startswith(('http://', 'https://')):
                return api_response(None, 400, 'webhook_url 需为 http(s):// 开头')
            cfg[k] = v
        else:
            cfg[k] = (v or '').strip()[:64]
    save_alert_cfg(cfg)
    return api_response(cfg)


@router.post('/alerts/check', dependencies=[Depends(require_basic)])
async def alerts_check_now(request: Request):
    return await run_db(lambda: api_response(check_alerts(request.app)))


@router.post('/alerts/ack', dependencies=[Depends(require_basic)])
async def alerts_ack(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}

    def _impl():
        q = db.session.query(SdkAlert).filter(SdkAlert.acked.is_(False))
        if not data.get('all'):
            try:
                q = q.filter(SdkAlert.id == int(data.get('id')))
            except (TypeError, ValueError):
                return api_response(None, 400, 'id 需为整数或 all=true')
        n = q.update({'acked': True}, synchronize_session=False)
        db.session.commit()
        return api_response({'acked': n})
    return await run_db(_impl)


def start_alert_loop(app):
    """每 60s 巡检一次告警（daemon，随进程；测试直接调 check_alerts）。"""
    def _loop():
        time.sleep(10)
        while True:
            try:
                check_alerts(app)
            except Exception:  # noqa: BLE001
                from app.shared.modules import mod_logger
                mod_logger('sdklogs').warning('告警巡检失败', exc_info=True)
            time.sleep(60)
    threading.Thread(target=_loop, name='sdklogs-alerts', daemon=True).start()


# ─── 保留策略（每日清理；0=永久）─────────────────────────

def run_retention(app) -> int:
    """删除超期行 + 清理超期死信文件；返回删除行数。"""
    days = settings.logs_retention_days
    if days <= 0:
        return 0
    cutoff = _utcnow() - timedelta(days=days)
    try:
        deleted = (db.session.query(SdkLog)
                   .filter(SdkLog.ts < cutoff)
                   .delete(synchronize_session=False))
        db.session.commit()
    finally:
        db.session.rollback()
        db.session.remove()      # 可能被 run_db 或后台线程直接调用，用完即还
    d = os.path.join(settings.data_dir, 'dead_letters')
    if os.path.isdir(d):
        cutoff_name = cutoff.strftime('%Y%m%d')
        for name in os.listdir(d):
            stem = name.split('.')[0]
            if stem.isdigit() and stem < cutoff_name:
                try:
                    os.remove(os.path.join(d, name))
                except OSError:
                    pass
    return deleted


def start_retention_loop(app):
    """每日一次保留清理线程（daemon，随进程；测试直接调 run_retention）。"""
    def _loop():
        time.sleep(5)
        while True:
            try:
                run_retention(app)
            except Exception:  # noqa: BLE001
                from app.shared.modules import mod_logger
                mod_logger('sdklogs').warning('保留清理失败', exc_info=True)
            time.sleep(24 * 3600)
    threading.Thread(target=_loop, name='sdklogs-retention', daemon=True).start()


def start_background(app):
    """模块后台线程入口（main.py 钩子）：保留清理 + 告警巡检；testing 时空转。"""
    if getattr(app.state, 'testing', False):
        return
    start_retention_loop(app)
    start_alert_loop(app)


def ensure_migrations(engine):
    """幂等迁移：删除被复合索引 (sys_name, ts) 前缀覆盖的冗余单列索引
    ix_sdklogs_logs_sys_name（白付每次行插入约 1/6 的索引维护，实测写吞吐 +13.6%；
    新库由模型直接不再创建，存量库在此删除；DROP INDEX IF EXISTS 两方言通用）。"""
    from sqlalchemy import inspect
    try:
        names = {ix['name'] for ix in inspect(engine).get_indexes('sdklogs_logs')}
        if 'ix_sdklogs_logs_sys_name' in names:
            with engine.begin() as conn:
                conn.execute(text('DROP INDEX IF EXISTS ix_sdklogs_logs_sys_name'))
    except Exception:  # noqa: BLE001 - 表不存在（首建）等场景静默跳过
        pass
