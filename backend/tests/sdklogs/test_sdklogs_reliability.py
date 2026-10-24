"""日志容量、完成水位与全量查询回归；数据库和故障均在隔离 fixture 内。"""
import threading
import pytest
from datetime import datetime, timedelta

from sqlalchemy import insert


def test_cache_is_bounded_and_paths_follow_app_runtime(app, monkeypatch, tmp_path):
    from app.config import settings
    from app.db import database_context
    from app.sdklogs.routes import _cache_get, _cache_put, _CACHE_MAX, _Pipeline, save_alert_cfg, load_alert_cfg
    monkeypatch.setattr(settings, 'data_dir', str(tmp_path / 'different-app'))
    with database_context(app):
        save_alert_cfg({'threshold': 17})
        assert load_alert_cfg()['threshold'] == 17
        pipeline = _Pipeline(app)
    assert pipeline._data_dir == app.state.db_runtime.data_dir
    assert not (tmp_path / 'different-app' / 'logs_alerts.json').exists()
    for index in range(_CACHE_MAX * 2):
        _cache_put(app, ('histogram', index), index)
    assert len(app.state.sdklogs_cache) == _CACHE_MAX
    assert _cache_get(app, ('histogram', _CACHE_MAX * 2 - 1)) == _CACHE_MAX * 2 - 1
    monkeypatch.setattr(app.state.db_runtime, 'generation', 'next-generation')
    assert _cache_get(app, ('histogram', _CACHE_MAX * 2 - 1)) is None


def _row(index=0, ts=None):
    from app.sdklogs.routes import normalize_record
    return normalize_record({'level': 'INFO', 'timestamp': (ts or datetime(2026, 1, 1)).isoformat() + 'Z',
                             'sys_name': 'bounded-test', 'message': f'{index}:中文'}, datetime(2026, 1, 1))


@pytest.mark.parametrize('fastpath', [True, False])
def test_offset_metadata_keeps_global_watermark_on_empty_and_filtered_pages(client, app, auth_headers, monkeypatch, fastpath):
    from app.db import db
    from app.sdklogs.models import SdkLog
    from app.sdklogs import routes
    from sqlalchemy import event
    monkeypatch.setattr(routes, '_FASTPATH', fastpath)
    statements = []
    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        if 'sdklogs_logs' in statement.lower():
            statements.append(statement)
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        empty = client.get('/api/v1/logs?limit=1', headers=auth_headers).json()['data']
        assert empty['total'] == empty['next_after_id'] == 0 and empty['items'] == []
        assert len(statements) == 2
        late = _row(9, datetime(2020, 1, 1))
        late['sys_name'] = 'other-system'
        db.session.execute(insert(SdkLog), [_row(1), _row(2), late])
        db.session.commit()
        maximum = db.session.query(SdkLog.id).order_by(SdkLog.id.desc()).first()[0]
        cases = [('limit=1', 3, 1), ('sys_name=bounded-test&limit=1', 2, 1),
                 ('sys_name=missing&limit=1', 0, 0), ('sys_name=bounded-test&offset=100&limit=1', 2, 0),
                 ('q=1%3A%E4%B8%AD%E6%96%87&limit=1', 1, 1)]
        for query, count, size in cases:
            statements.clear()
            data = client.get('/api/v1/logs?' + query, headers=auth_headers).json()['data']
            assert data['total'] == count and len(data['items']) == size
            assert data['next_after_id'] == maximum, 'watermark is global, including late timestamps outside this filter/page'
            assert len(statements) == 2, 'count and global ID watermark share one statement, followed by the page'
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)


def test_overflow_flush_accounts_dropped_batches(app, monkeypatch):
    from app.sdklogs.routes import _Pipeline
    from app.config import settings
    monkeypatch.setattr(settings, 'logs_queue_max', 3)
    monkeypatch.setattr(settings, 'logs_flush_ms', 1)
    monkeypatch.setattr(settings, 'logs_batch_size', 1)
    entered, release = threading.Event(), threading.Event()
    pipeline = _Pipeline(app)
    original = pipeline._flush_rows
    def gated(rows):
        entered.set()
        assert release.wait(3)
        original(rows)
    monkeypatch.setattr(pipeline, '_flush_rows', gated)
    pipeline.submit(_row(0))
    assert entered.wait(2)
    pipeline.submit_list([_row(i) for i in range(1, 4)])
    pipeline.submit_list([_row(i) for i in range(4, 7)])
    assert pipeline._queued_rows == 3
    assert pipeline.stats['dropped'] == 3
    assert not pipeline.flush(0.01)
    release.set()
    assert pipeline.flush(3), 'overflow must not leave queue.join bookkeeping stuck'
    assert pipeline.q.unfinished_tasks == 0
    assert pipeline.stats['persisted'] == 4
    assert pipeline.stop(2)


def test_queue_byte_budget_and_oversized_single_record(app, monkeypatch):
    from app.sdklogs.routes import _Pipeline, _PIPELINES
    monkeypatch.setenv('LOGSDB_QUEUE_BYTES', '1024')
    pipeline = _Pipeline(app)
    monkeypatch.setattr(pipeline, 'ensure_started', lambda: None)
    try:
        row = _row()
        row['message'] = '中' * 1000
        pipeline.submit(row)
        assert pipeline._queued_bytes == pipeline._queued_rows == 0
        assert pipeline.stats['dropped'] == 1
        pipeline.submit_list([_row(i) for i in range(10)])
        assert pipeline._queued_bytes <= 1024
        assert pipeline._queued_rows < 10
    finally:
        _PIPELINES.discard(pipeline)


def test_histogram_counts_more_than_old_100k_limit(client, auth_headers):
    from app.db import db
    from app.sdklogs.models import SdkLog
    rows = [_row(i, datetime(2026, 1, 1) + timedelta(seconds=i % 100)) for i in range(100005)]
    db.session.execute(insert(SdkLog), rows)
    db.session.commit()
    response = client.get('/api/v1/logs/histogram?start=2026-01-01T00:00:00Z&end=2026-01-01T00:02:00Z&buckets=12', headers=auth_headers)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['total'] == 100005
    assert sum(b['total'] for b in data['buckets']) == 100005
    assert data['buckets'][1]['total'] == 10000  # exact 10s boundary belongs to next bucket


def test_export_streams_past_old_limit_in_bounded_pages(client, auth_headers, monkeypatch):
    from app.db import db
    from app.sdklogs.models import SdkLog
    from app.sdklogs import routes
    db.session.execute(insert(SdkLog), [_row(i) for i in range(10003)])
    db.session.commit()
    monkeypatch.setattr(routes, 'EXPORT_BATCH', 137)
    response = client.get('/api/v1/logs/export?format=json&sys_name=bounded-test', headers=auth_headers)
    assert response.status_code == 200
    result = response.json()
    assert len(result) == 10003
    assert result[0]['message'] == '10002:中文'
    assert result[-1]['message'] == '0:中文'


def test_tail_cursor_accepts_late_timestamp_and_has_no_duplicates(client, auth_headers):
    from app.db import db
    from app.sdklogs.models import SdkLog
    db.session.execute(insert(SdkLog), [_row(i) for i in range(6)])
    db.session.commit()
    cursor = db.session.query(SdkLog.id).order_by(SdkLog.id.desc()).first()[0]
    db.session.execute(insert(SdkLog), [_row(6, datetime(2020, 1, 1)), _row(7)])
    db.session.commit()
    response = client.get(f'/api/v1/logs?after_id={cursor}&limit=1', headers=auth_headers).json()['data']
    assert response['items'][0]['message'] == '6:中文'
    assert response['has_more']
    next_page = client.get(f"/api/v1/logs?after_id={response['next_after_id']}&limit=1", headers=auth_headers).json()['data']
    assert next_page['items'][0]['message'] == '7:中文'
    assert not next_page['has_more']


def test_context_same_timestamp_strictly_orders_ids(client, auth_headers):
    from app.db import db
    from app.sdklogs.models import SdkLog
    db.session.execute(insert(SdkLog), [_row(i) for i in range(5)])
    db.session.commit()
    ids = [r[0] for r in db.session.query(SdkLog.id).filter_by(sys_name='bounded-test').order_by(SdkLog.id)]
    result = client.get(f'/api/v1/logs/context?id={ids[2]}&before=2&after=2', headers=auth_headers).json()['data']
    assert [r['id'] for r in result['items']] == ids


def test_unexpected_writer_failure_goes_to_dead_letter_and_failed_dead_letter_is_visible(app, monkeypatch, tmp_path):
    import json
    from app.sdklogs.routes import _Pipeline
    from app.config import settings
    monkeypatch.setattr(settings, 'logs_flush_ms', 1)
    pipeline = _Pipeline(app)
    def fail(rows): raise RuntimeError('fixture writer failure')
    monkeypatch.setattr(pipeline, '_flush_rows', fail)
    pipeline.submit(_row(1))
    assert pipeline.flush(3)
    files = list((tmp_path / 'dead_letters').glob('*.jsonl'))
    assert len(files) == 1
    payload = json.loads(files[0].read_text(encoding='utf-8'))
    assert payload['reason'] == 'writer_exception'
    assert payload['payload']['message'] == '1:中文'
    assert pipeline.stats['failed'] == pipeline.stats['dead_letter'] == 1
    pipeline._data_dir = str(tmp_path / 'not-a-directory')
    (tmp_path / 'not-a-directory').write_text('fixture', encoding='utf-8')
    pipeline.dead_letter({'message': 'lost'}, 'fixture')
    assert pipeline.stats['dead_letter_failed'] == 1
    assert not pipeline.flush(0.01), 'drain must not falsely confirm a failed dead-letter write'
    pipeline.stop(1)
