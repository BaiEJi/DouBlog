"""
日志接收模块（sdklogs）测试：摄入/规范化/死信/检索过滤/统计/保留。
"""
import json
import os

from app.config import settings
from app.sdklogs.routes import normalize_record, run_retention


def _post(client, obj):
    return client.post('/api/v1/logs', json=obj)


def _flush(app):
    p = getattr(app.state, 'sdklogs_pipeline', None)
    assert p is not None
    assert p.flush(timeout=5.0), '写入线程未在时限内排空'


def _search(client, auth_headers, qs=''):
    r = client.get(f'/api/v1/logs{qs}', headers=auth_headers)
    assert r.status_code == 200, r.json()
    return r.json()['data']


REC = {'level': 'INFO', 'timestamp': '2026-09-19T10:30:00', 'file': 'app.py', 'line': 42,
       'sys_name': 'order-svc', 'user_id': '123', 'trace_id': 'a3f0', 'message': 'user logged in'}


# ─── 摄入与规范化 ────────────────────────────────────────

def test_ingest_single_roundtrip(client, auth_headers, app):
    """摄入 → flush → 检索往返：级别大写、无时区按 Asia/Shanghai 转 UTC、kv 进 fields、trace_id 成列"""
    assert _post(client, {**REC, 'level': 'info'}).status_code == 202
    _flush(app)
    d = _search(client, auth_headers)
    assert d['total'] == 1
    item = d['items'][0]
    assert item['level_text'] == 'INFO' and item['level'] == 20
    assert item['ts'] == '2026-09-19T02:30:00'          # 10:30 +08:00 → 02:30 UTC
    assert item['sys_name'] == 'order-svc' and item['file'] == 'app.py' and item['line'] == 42
    assert item['trace_id'] == 'a3f0'
    assert item['fields'] == {'user_id': '123'}          # 固定字段剥离，业务 kv 保留
    assert item['message'] == 'user logged in'


def test_ingest_rfc3339_offsets(client, auth_headers, app):
    """带时区时间戳直接采用：+00:00 与 Z 后缀等价，本地时区偏移正确换算"""
    _post(client, {**REC, 'timestamp': '2026-09-19T02:30:00Z'})
    _post(client, {**REC, 'timestamp': '2026-09-19T04:30:00+02:00', 'sys_name': 'pay-svc'})
    _flush(app)
    d = _search(client, auth_headers)
    assert d['total'] == 2
    assert {i['ts'] for i in d['items']} == {'2026-09-19T02:30:00'}


def test_ingest_batch_jsonl_and_array(client, auth_headers, app):
    """batch 端点：JSON 数组与 JSONL 文本等价；超 1000 条拒绝"""
    arr = [{**REC, 'message': f'm{i}'} for i in range(5)]
    r = client.post('/api/v1/logs/batch', json=arr)
    assert r.status_code == 202 and r.json()['data']['accepted'] == 5

    lines = '\n'.join(json.dumps({**REC, 'sys_name': 'jsonl-svc', 'message': f'j{i}'}) for i in range(3))
    r = client.post('/api/v1/logs/batch', content=lines,
                    headers={'Content-Type': 'text/plain'})
    assert r.status_code == 202 and r.json()['data']['accepted'] == 3

    big = [{**REC} for _ in range(1001)]
    assert client.post('/api/v1/logs/batch', json=big).status_code == 400
    _flush(app)
    assert _search(client, auth_headers)['total'] == 8


def test_bad_records_go_to_dead_letter(client, auth_headers, app):
    """坏日志（级别/时间戳/缺 sys_name）→ 202 + 死信文件；好日志不受影响"""
    for bad in [
        {**REC, 'level': 'NOPE'},
        {**REC, 'timestamp': 'not-a-time'},
        {k: v for k, v in REC.items() if k != 'sys_name'},
    ]:
        r = _post(client, bad)
        assert r.status_code == 202 and r.json()['data']['dead_lettered'] == 1
    _post(client, REC)   # 好日志正常
    _flush(app)
    assert _search(client, auth_headers)['total'] == 1
    dl = os.path.join(settings.data_dir, 'dead_letters')
    files = [f for f in os.listdir(dl) if f.endswith('.jsonl')]
    assert files
    content = open(os.path.join(dl, files[0]), encoding='utf-8').read()
    assert 'NOPE' in content and 'invalid' in content


def test_non_string_kv_values_stringified(client, auth_headers, app):
    """业务 kv 非字符串值统一转字符串/JSON 文本（与 SDK 行为一致）"""
    _post(client, {**REC, 'count': 7, 'meta': {'a': 1}})
    _flush(app)
    item = _search(client, auth_headers)['items'][0]
    assert item['fields']['count'] == '7'
    assert json.loads(item['fields']['meta']) == {'a': 1}


# ─── 摄入认证 ────────────────────────────────────────────

def test_ingest_token_auth(client, auth_headers, app, monkeypatch):
    monkeypatch.setattr(settings, 'logs_auth_token', 'secret-token')
    assert _post(client, REC).status_code == 401
    assert client.post('/api/v1/logs', json=REC,
                       headers={'Authorization': 'Bearer wrong'}).status_code == 401
    r = client.post('/api/v1/logs', json=REC,
                    headers={'Authorization': 'Bearer secret-token'})
    assert r.status_code == 202
    _flush(app)
    assert _search(client, auth_headers)['total'] == 1


# ─── 检索过滤 ────────────────────────────────────────────

def _seed(client, app):
    base = '2026-09-19T10:'
    rows = [
        {**REC, 'timestamp': base + '00:00', 'level': 'ERROR', 'sys_name': 'order-svc', 'trace_id': 't1', 'user_id': 'u1', 'message': 'db failed'},
        {**REC, 'timestamp': base + '01:00', 'level': 'INFO', 'sys_name': 'order-svc', 'trace_id': 't2', 'user_id': 'u2', 'message': 'ok'},
        {**REC, 'timestamp': base + '02:00', 'level': 'DEBUG', 'sys_name': 'pay-svc', 'trace_id': 't1', 'user_id': 'u1', 'message': 'trace msg'},
        {**REC, 'timestamp': '2020-01-01T00:00:00', 'level': 'CRITICAL', 'sys_name': 'old-svc', 'message': 'yesterday'},
    ]
    client.post('/api/v1/logs/batch', json=rows)
    _flush(app)


def test_search_filters(client, auth_headers, app):
    _seed(client, app)
    assert _search(client, auth_headers)['total'] == 4
    # sys_name 多值 OR
    assert _search(client, auth_headers, '?sys_name=order-svc,pay-svc')['total'] == 3
    # level 精确 / level_gte 区间
    assert _search(client, auth_headers, '?level=ERROR')['total'] == 1
    assert _search(client, auth_headers, '?level_gte=ERROR')['total'] == 2      # ERROR + CRITICAL
    # trace_id
    assert {i['trace_id'] for i in _search(client, auth_headers, '?trace_id=t1')['items']} == {'t1'}
    assert _search(client, auth_headers, '?trace_id=t1')['total'] == 2
    # message 全文（大小写不敏感由 LIKE 不区分大小写实现）
    assert _search(client, auth_headers, '?q=failed')['total'] == 1
    # kv 过滤（保留字之外任意参数）
    assert _search(client, auth_headers, '?user_id=u1')['total'] == 2
    assert _search(client, auth_headers, '?user_id=u1&sys_name=pay-svc')['total'] == 1
    # 时间范围（UTC；10:00+08 = 02:00Z）
    assert _search(client, auth_headers, '?start=2026-09-19T02:00:30Z')['total'] == 2
    assert _search(client, auth_headers, '?start=2026-09-19T00:00:00Z&end=2026-09-19T02:00:59Z')['total'] == 1
    # 倒序
    d = _search(client, auth_headers, '?sys_name=order-svc')
    assert d['items'][0]['ts'] >= d['items'][1]['ts']


def test_search_pagination_and_count(client, auth_headers, app):
    _seed(client, app)
    d = _search(client, auth_headers, '?limit=2&offset=0')
    assert d['total'] == 4 and len(d['items']) == 2
    d2 = _search(client, auth_headers, '?limit=2&offset=2')
    assert len(d2['items']) == 2 and d2['items'][0]['id'] != d['items'][0]['id']
    r = client.get('/api/v1/logs/count?sys_name=order-svc', headers=auth_headers)
    assert r.json()['data']['total'] == 2


def test_search_bad_params(client, auth_headers, app):
    assert client.get('/api/v1/logs?start=bad', headers=auth_headers).status_code == 400
    assert client.get('/api/v1/logs?level=NOPE', headers=auth_headers).status_code == 400
    assert client.get('/api/v1/logs?user;id=1', headers=auth_headers).status_code == 400   # 不安全 kv 参数名
    assert client.get('/api/v1/logs?limit=abc', headers=auth_headers).status_code == 400


def test_stats_endpoint(client, auth_headers, app):
    """统计端点。h24 窗口随墙钟移动，种子必须用动态「近 1 小时」时间戳
    （原固定 2026-09-19 的时间炸弹已随日期出窗，勿再引入）。"""
    from datetime import datetime, timedelta, timezone
    recent = (datetime.now(timezone(timedelta(hours=8))) - timedelta(hours=1)
              ).strftime('%Y-%m-%dT%H:%M:%S')
    rows = [
        {**REC, 'timestamp': recent, 'level': 'ERROR', 'sys_name': 'order-svc', 'trace_id': 't1', 'user_id': 'u1', 'message': 'db failed'},
        {**REC, 'timestamp': recent, 'level': 'INFO', 'sys_name': 'order-svc', 'trace_id': 't2', 'user_id': 'u2', 'message': 'ok'},
        {**REC, 'timestamp': recent, 'level': 'DEBUG', 'sys_name': 'pay-svc', 'trace_id': 't1', 'user_id': 'u1', 'message': 'trace msg'},
        {**REC, 'timestamp': '2020-01-01T00:00:00', 'level': 'CRITICAL', 'sys_name': 'old-svc', 'message': 'yesterday'},
    ]
    client.post('/api/v1/logs/batch', json=rows)
    _flush(app)
    r = client.get('/api/v1/stats', headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['total_rows'] == 4
    assert d['accepted'] >= 4
    lv = d['h24_by_level']
    assert lv['ERROR'] == 1 and lv['CRITICAL'] == 0                 # 2020 年的 CRITICAL 不进 24h
    sys_counts = {row['sys_name']: row['count'] for row in d['h24_by_sys']}
    assert sys_counts['order-svc'] == 2 and sys_counts['pay-svc'] == 1


def test_ingest_requires_no_basic_auth(client):
    """摄入端点不挂 Basic Auth（SDK 无凭据直发）"""
    r = client.post('/api/v1/logs', json=REC)
    assert r.status_code != 401
    assert client.get('/api/v1/logs').status_code == 401            # 检索仍需 Basic


# ─── 保留策略 ────────────────────────────────────────────

def test_retention(client, auth_headers, app):
    """fresh 种子用动态「近 1 小时」时间戳（retention 窗口随墙钟移动，勿再用固定日期）。"""
    from datetime import datetime, timedelta, timezone
    fresh = (datetime.now(timezone(timedelta(hours=8))) - timedelta(hours=1)
             ).strftime('%Y-%m-%dT%H:%M:%S')
    client.post('/api/v1/logs/batch', json=[
        {**REC, 'timestamp': fresh, 'message': 'fresh'},
        {**REC, 'timestamp': '2020-01-01T00:00:00', 'message': 'ancient'},
    ])
    _flush(app)
    assert _search(client, auth_headers)['total'] == 2
    deleted = run_retention(app)
    assert deleted == 1
    assert _search(client, auth_headers)['total'] == 1
    assert _search(client, auth_headers, '?q=ancient')['total'] == 0

    # retention=0 → 永久保留
    old_settings = settings.logs_retention_days
    settings.logs_retention_days = 0
    try:
        client.post('/api/v1/logs', json={**REC, 'timestamp': '2020-01-01T00:00:00', 'message': 'keep'})
        _flush(app)
        assert run_retention(app) == 0
    finally:
        settings.logs_retention_days = old_settings


# ─── 规范化纯函数 ────────────────────────────────────────

def test_normalize_record_edge_cases():
    row = normalize_record({'level': 'warning', 'timestamp': '2026-01-01T00:00:00',
                            'sys_name': ' x ', 'message': 123, 'line': '99'})
    assert row['level'] == 30 and row['level_text'] == 'WARNING'
    assert row['sys_name'] == 'x' and row['message'] == '123' and row['line'] == 99
    assert row['fields'] == {}
    no_msg = {k: v for k, v in REC.items() if k != 'message'}
    for bad in [{'level': 'X'}, {'timestamp': 'no'}, no_msg]:
        try:
            normalize_record({**REC, **bad} if 'message' in bad else bad)
            assert False, f'should reject {bad}'
        except ValueError:
            pass


def test_sysnames_endpoint(client, auth_headers, app):
    """查询页下拉数据源：distinct sys_name 按条数倒序"""
    _seed(client, app)
    r = client.get('/api/v1/logs/sysnames', headers=auth_headers)
    assert r.status_code == 200
    names = r.json()['data']
    assert names[0] == {'sys_name': 'order-svc', 'count': 2}
    assert {n['sys_name'] for n in names} == {'order-svc', 'pay-svc', 'old-svc'}


# ─── 探索能力：直方图/上下文/模式/导出/trace/告警 ─────────

def _seed_explore(client, app):
    """时间固定的 6 行（UTC）：00:00×2 INFO、00:05 ERROR、00:10 ERROR、00:20 INFO、01:00 WARNING。
    返回 (锚点=第 4 行的检索结果, trace 组)。"""
    rows = [
        {'level': 'INFO', 'timestamp': '2026-09-19T00:00:00Z', 'sys_name': 'a-svc', 'message': 'user 123 logged in', 'trace_id': 't1'},
        {'level': 'INFO', 'timestamp': '2026-09-19T00:00:30Z', 'sys_name': 'a-svc', 'message': 'user 456 logged in', 'trace_id': 't1'},
        {'level': 'ERROR', 'timestamp': '2026-09-19T00:05:00Z', 'sys_name': 'a-svc', 'message': 'user 123 payment failed after 3 retries', 'trace_id': 't1'},
        {'level': 'ERROR', 'timestamp': '2026-09-19T00:10:00Z', 'sys_name': 'b-svc', 'message': 'user 789 payment failed after 7 retries'},
        {'level': 'INFO', 'timestamp': '2026-09-19T00:20:00Z', 'sys_name': 'b-svc', 'message': 'task done'},
        {'level': 'WARNING', 'timestamp': '2026-09-19T01:00:00Z', 'sys_name': 'a-svc', 'message': 'disk usage 91%'},
    ]
    for r in rows:
        assert _post(client, r).status_code == 202
    _flush(app)


def test_histogram_buckets_and_levels(client, auth_headers, app):
    """直方图：桶数/分桶归属/级别计数/过滤下推/汇总正确"""
    _seed_explore(client, app)
    qs = '?start=2026-09-19T00:00:00Z&end=2026-09-19T01:00:00Z&buckets=60'
    r = client.get(f'/api/v1/logs/histogram{qs}', headers=auth_headers)
    assert r.status_code == 200, r.json()
    d = r.json()['data']
    assert d['total'] == 6 and d['totals'] == {'DEBUG': 0, 'INFO': 3, 'WARNING': 1, 'ERROR': 2, 'CRITICAL': 0}
    assert len(d['buckets']) == 60 and d['bucket_secs'] == 60
    b0 = d['buckets'][0]
    assert b0['counts']['INFO'] == 2                     # 00:00 与 00:00:30 都在第 0 桶
    b5 = d['buckets'][5]
    assert b5['counts']['ERROR'] == 1                    # 00:05
    # 过滤下推：只看 ERROR → 总量 2
    r = client.get(f'/api/v1/logs/histogram{qs}&level=ERROR', headers=auth_headers)
    assert r.json()['data']['total'] == 2
    # 非法 buckets
    assert client.get('/api/v1/logs/histogram?buckets=abc', headers=auth_headers).status_code == 400


def test_context_surrounding(client, auth_headers, app):
    """上下文：锚点行前后各 N 条按时间序返回，anchor 标记；不存在 404"""
    _seed_explore(client, app)
    d = _search(client, auth_headers, '?q=task done')
    aid = d['items'][0]['id']
    r = client.get(f'/api/v1/logs/context?id={aid}&before=2&after=1', headers=auth_headers)
    assert r.status_code == 200
    items = r.json()['data']['items']
    assert len(items) == 4
    anchors = [i for i in items if i['anchor']]
    assert len(anchors) == 1 and anchors[0]['message'] == 'task done'
    # 锚点(00:20)前最近 2 条 = 00:05 与 00:10，升序排最前；后 1 条 = 01:00
    assert items[0]['message'].startswith('user 123 payment failed')
    assert items[1]['message'].startswith('user 789')
    assert items[-1]['message'] == 'disk usage 91%'
    assert client.get('/api/v1/logs/context?id=99999', headers=auth_headers).status_code == 404


def test_templatize_and_patterns(client, auth_headers, app):
    """模式分组：数字/uuid 占位化归并相似消息，按频次排序"""
    from app.sdklogs.routes import templatize
    assert templatize('user 123 failed after 3 retries') == 'user <num> failed after <num> retries'
    assert templatize('id=550e8400-e29b-41d4-a716-446655440000 ok').startswith('id=<uuid> ok')

    _seed_explore(client, app)
    qs = '?start=2026-09-19T00:00:00Z&end=2026-09-19T01:00:00Z'
    r = client.get(f'/api/v1/logs/patterns{qs}', headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['analyzed'] == 6
    pats = {i['pattern']: i for i in d['items']}
    assert 'user <num> logged in' in pats and pats['user <num> logged in']['count'] == 2
    assert 'user <num> payment failed after <num> retries' in pats
    assert d['items'][0]['count'] == max(i['count'] for i in d['items'])   # 频次降序


def test_export_csv_and_json(client, auth_headers, app):
    """导出：CSV 头行+行数、JSON 可解析、Content-Disposition、非法 format 400"""
    _seed_explore(client, app)
    qs = '?start=2026-09-19T00:00:00Z&end=2026-09-19T01:00:00Z'
    r = client.get(f'/api/v1/logs/export{qs}&format=csv', headers=auth_headers)
    assert r.status_code == 200
    assert 'attachment; filename=logs-' in r.headers['Content-Disposition']
    body = r.text
    lines = [l for l in body.splitlines() if l.strip()]
    assert lines[0].startswith('ts,level,sys_name') and len(lines) == 7   # 表头 + 6 行
    r = client.get(f'/api/v1/logs/export{qs}&format=json', headers=auth_headers)
    arr = json.loads(r.text)
    assert len(arr) == 6 and arr[0]['level'] in ('INFO', 'ERROR', 'WARNING')
    assert client.get(f'/api/v1/logs/export{qs}&format=xls', headers=auth_headers).status_code == 400


def test_trace_view(client, auth_headers, app):
    """trace 时间线：同 trace_id 升序 + 跨度毫秒；无命中返回空"""
    _seed_explore(client, app)
    r = client.get('/api/v1/logs/trace?id=t1', headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    assert len(d['items']) == 3
    assert d['items'][0]['ts'] <= d['items'][-1]['ts']
    assert d['span'] == {'start': '2026-09-19T00:00:00', 'end': '2026-09-19T00:05:00', 'span_ms': 300000}
    r = client.get('/api/v1/logs/trace?id=nope', headers=auth_headers)
    assert r.json()['data']['items'] == []
    assert client.get('/api/v1/logs/trace', headers=auth_headers).status_code == 400


def test_alerts_flow(client, auth_headers, app, monkeypatch):
    """告警：配置校验/保存 → 阈值检查触发事件 → 冷却抑制 → 确认 → all 确认"""
    # 写配置到临时目录（settings.data_dir 已是测试 tmp）
    # 1) 非法配置被拒
    for bad in [{'level_gte': 'NOPE'}, {'threshold': 0}, {'webhook_url': 'ftp://x'}]:
        r = client.put('/api/v1/alerts/config', json=bad, headers=auth_headers)
        assert r.status_code == 400, bad
    # 2) 保存低阈值（窗口 60 分钟、冷却 30）
    r = client.put('/api/v1/alerts/config', json={'enabled': True, 'level_gte': 'ERROR',
                                                  'threshold': 2, 'window_minutes': 60,
                                                  'cooldown_minutes': 30}, headers=auth_headers)
    assert r.status_code == 200
    _seed_explore(client, app)                            # 固定时间种子不在“当前窗口”内：改用近实时数据
    from datetime import datetime, timezone as _tz
    now = datetime.now(_tz.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for i in range(3):
        assert _post(client, {'level': 'ERROR', 'timestamp': now, 'sys_name': 'alert-svc',
                              'message': f'boom {i}'}).status_code == 202
    _flush(app)
    # 3) 立即检查 → 触发一条事件
    r = client.post('/api/v1/alerts/check', headers=auth_headers)
    assert r.status_code == 200 and r.json()['data']['triggered'] is True
    # 4) 冷却期内重复检查不再触发
    r = client.post('/api/v1/alerts/check', headers=auth_headers)
    assert r.json()['data']['triggered'] is False
    # 5) 状态：1 条未确认
    r = client.get('/api/v1/alerts', headers=auth_headers)
    d = r.json()['data']
    assert d['unacked'] == 1 and len(d['events']) == 1
    eid = d['events'][0]['id']
    assert d['events'][0]['count'] >= 2 and d['events'][0]['sample'].startswith('boom')
    assert d['config']['threshold'] == 2
    # 6) 确认单条 → all 确认
    r = client.post('/api/v1/alerts/ack', json={'id': eid}, headers=auth_headers)
    assert r.json()['data']['acked'] == 1
    assert client.get('/api/v1/alerts', headers=auth_headers).json()['data']['unacked'] == 0


# ─── 性能优化回归：静态 SQL 快路径与短 TTL 缓存 ───────────

def test_search_fast_path_equivalence(client, auth_headers, app):
    """检索热路径（无过滤 / 单一 sys_name 静态 SQL）输出与 ORM 过滤路径逐字段一致：
    含零微秒省略、非零微秒保留、fields 解析、None 列"""
    rows = [
        {'level': 'DEBUG', 'timestamp': '2026-10-11T01:02:03.456789Z', 'sys_name': 'a-svc',
         'message': 'micro nonzero', 'user_id': '7', 'meta': {'k': [1, 2]}},
        {'level': 'ERROR', 'timestamp': '2026-10-11T01:02:04', 'sys_name': 'a-svc',
         'message': 'no micro', 'line': '88'},
        {'level': 'CRITICAL', 'timestamp': '2026-10-11T01:02:05+00:00', 'sys_name': 'b-svc',
         'message': 'no file'},
    ]
    for r in rows:
        assert _post(client, r).status_code == 202
    _flush(app)
    fast = _search(client, auth_headers, '?limit=100')            # 无过滤 → 快路径
    orm = _search(client, auth_headers, '?level_gte=DEBUG&limit=100')   # level 过滤 → ORM
    assert fast['total'] == orm['total'] == 3
    assert fast['items'] == orm['items']
    micro = next(i for i in fast['items'] if 'micro nonzero' in i['message'])
    assert micro['ts'] == '2026-10-11T01:02:03.456789'            # 非零微秒保留
    assert micro['fields'] == {'user_id': '7', 'meta': '{"k": [1, 2]}'}
    # 单一 sys_name 快路径与多值 ORM 路径等价
    one = _search(client, auth_headers, '?sys_name=a-svc')
    two = _search(client, auth_headers, '?sys_name=a-svc,b-svc&level_gte=DEBUG')
    a_ids = [i['id'] for i in two['items'] if i['sys_name'] == 'a-svc']
    assert one['total'] == 2 and [i['id'] for i in one['items']] == a_ids
    # count 端点无过滤走静态 count
    r = client.get('/api/v1/logs/count', headers=auth_headers)
    assert r.json()['data']['total'] == 3


def test_ttl_cache_second_call(client, auth_headers, app):
    """sysnames/stats/histogram 的缓存命中分支（TTL 内二次调用必须可用且结果一致）"""
    _seed(client, app)
    for _ in range(2):
        r1 = client.get('/api/v1/logs/sysnames', headers=auth_headers)
        assert r1.status_code == 200
    names = r1.json()['data']
    assert names[0] == {'sys_name': 'order-svc', 'count': 2}
    for _ in range(2):
        r2 = client.get('/api/v1/stats', headers=auth_headers)   # 命中缓存分支
        assert r2.status_code == 200
    assert r2.json()['data']['total_rows'] == 4
    qs = '?start=2019-01-01T00:00:00Z&end=2026-12-31T23:59:59Z'   # 覆盖 naive 旧行（-8h 进 UTC）
    for _ in range(2):
        r3 = client.get(f'/api/v1/logs/histogram{qs}', headers=auth_headers)
        assert r3.status_code == 200
    assert r3.json()['data']['total'] == 4


def test_writer_sqlite_fastpath_roundtrip(client, auth_headers, app):
    """SQLite 写者快路径（驱动级 executemany）落库后回读：时间精度/kv/空列无损"""
    rows = [
        {'level': 'INFO', 'timestamp': '2026-10-11T12:00:00.123456Z', 'sys_name': 'fp-svc',
         'message': 'fastpath', 'trace_id': 'fp1', 'n': 5, 'blob': {'x': [1, 2]}},
        {'level': 'WARNING', 'timestamp': '2026-10-11T12:00:01', 'sys_name': 'fp-svc',
         'message': 'naive tz'},
    ]
    r = client.post('/api/v1/logs/batch', json=rows)
    assert r.status_code == 202 and r.json()['data']['accepted'] == 2
    p = app.state.sdklogs_pipeline
    assert p.flush(timeout=5)
    assert p.stats['failed'] == 0 and p.stats['dead_letter'] == 0   # 快路径未走兜底/死信
    items = _search(client, auth_headers, '?sys_name=fp-svc')['items']
    assert len(items) == 2
    micro = next(i for i in items if i['trace_id'] == 'fp1')
    assert micro['ts'] == '2026-10-11T12:00:00.123456'
    assert micro['fields'] == {'n': '5', 'blob': '{"x": [1, 2]}'}
    naive = next(i for i in items if i['message'] == 'naive tz')
    assert naive['ts'] == '2026-10-11T04:00:01'                  # +08 解释 → UTC
    assert naive['fields'] == {}
