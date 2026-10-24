"""Compare one candidate SQLite index on two backup-API copies of QA data.

No HTTP or app startup. Original database is opened mode=ro. Actual service SQL
and full default-page DTO are captured with explicit SQLAlchemy Sessions bound
only to the two copied engines. All timing is offline, warm-cache and serial.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import statistics
import time

from sqlalchemy import Index, MetaData, Table, create_engine, event
from sqlalchemy.orm import Session


ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / '.ui-qa'
INDEX_NAME = 'ix_bmitem_deleted_created_id_poc'


def file_state(path):
    result = {}
    for file in (path, Path(str(path) + '-wal')):
        if file.exists():
            stat = file.stat()
            result[file.name] = {'bytes': stat.st_size, 'mtime_ns': stat.st_mtime_ns}
    return result


def relevant_sources():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in (
        'backend/app/blog/bookmarks/models.py', 'backend/app/blog/bookmarks/services.py',
        'backend/app/shared/timeutil.py')}


def full_body_digest(connection):
    digest = hashlib.sha256()
    lengths = []
    for ident, body in connection.execute('SELECT id, snapshot_md FROM bookmarks_items ORDER BY id'):
        payload = (body or '').encode('utf8')
        ident_bytes = ident.encode('utf8')
        digest.update(len(ident_bytes).to_bytes(8, 'big'))
        digest.update(ident_bytes)
        digest.update(len(payload).to_bytes(8, 'big'))
        digest.update(payload)
        lengths.append(len(payload))
    return {'rows': len(lengths), 'snapshot_utf8_bytes': sum(lengths),
            'minimum_snapshot_utf8_bytes': min(lengths), 'sha256': digest.hexdigest()}


def backup_pair(source, paths):
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        original.execute('PRAGMA query_only=ON')
        original.execute('BEGIN')
        # Pin one read snapshot, including committed WAL contents, for both copies.
        original.execute('SELECT count(*) FROM bookmarks_items').fetchone()
        original_digest = full_body_digest(original)
        for path in paths:
            with sqlite3.connect(path) as destination:
                original.backup(destination)
        original.rollback()
    return original_digest


def service_capture(engine):
    from app.blog.bookmarks.services import list_items
    statements = []

    def capture(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append({'sql': statement, 'parameters': list(parameters)})

    event.listen(engine, 'before_cursor_execute', capture)
    try:
        with Session(engine) as session:
            result = list_items(session)  # Actual defaults: page=1, page_size=20, created_desc.
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    queries = {}
    for statement in statements:
        sql = statement['sql']
        if 'FROM bookmarks_items' not in sql:
            continue
        queries['count' if sql.lstrip().lower().startswith('select count(') else 'list'] = statement
    assert set(queries) == {'count', 'list'}, statements
    assert len(statements) == 3, 'Default service must keep count/list/batch-tags work'
    assert result['total'] == 200 and len(result['items']) == 20
    return result, queries, statements


def explain(connection, query):
    return [list(row) for row in connection.execute('EXPLAIN QUERY PLAN ' + query['sql'], query['parameters'])]


def batch(connection, query, expected, repetitions):
    samples, results = [], []
    wall_start, cpu_start = time.perf_counter_ns(), time.thread_time_ns()
    for _ in range(repetitions):
        start = time.perf_counter_ns()
        cursor = connection.execute(query['sql'], query['parameters'])
        executed = time.perf_counter_ns()
        rows = cursor.fetchall()
        fetched = time.perf_counter_ns()
        cursor.close()
        samples.append({'execute_ns': executed - start, 'fetch_ns': fetched - executed,
                        'total_ns': fetched - start})
        results.append(rows)
    cpu_ns = time.thread_time_ns() - cpu_start
    wall_ns = time.perf_counter_ns() - wall_start
    # Every projected field on every selected row (or count scalar), not IDs alone.
    assert all(rows == expected for rows in results)
    return {'samples': samples, 'batch_wall_ns': wall_ns, 'batch_thread_cpu_ns': cpu_ns,
            'total_median_ns': statistics.median(sample['total_ns'] for sample in samples),
            'execute_median_ns': statistics.median(sample['execute_ns'] for sample in samples),
            'fetch_median_ns': statistics.median(sample['fetch_ns'] for sample in samples)}


def main(args):
    source, output_dir = Path(args.source).resolve(), Path(args.output_dir).resolve()
    if not source.is_relative_to(QA.resolve()) or not output_dir.is_relative_to(QA.resolve()):
        raise ValueError('Only isolated repository .ui-qa paths are allowed')
    if output_dir.exists():
        raise ValueError('Use a new output directory; never overwrite earlier evidence')
    if args.rounds < 7 or not 1 <= args.repetitions <= 20:
        raise ValueError('Use at least 7 groups and 1..20 queries per group')
    source_before, code_before = file_state(source), relevant_sources()
    output_dir.mkdir(parents=True)
    paths = {'before': output_dir / 'original-index.db', 'after': output_dir / 'composite-index.db'}
    output = {'complete': False, 'protocol': {
        'started_at': datetime.now(timezone.utc).isoformat(), 'source_read_only': str(source),
        'backup': 'sqlite3.Connection.backup, one pinned read snapshot, two independent copies',
        'rounds': args.rounds, 'repetitions_per_query_per_group': args.repetitions,
        'warmup_per_query_per_variant': 3, 'order': 'AB/BA alternating by group',
        'cache': 'warm; no OS cache eviction; no ANALYZE or pragma tuning',
        'python': platform.python_version(), 'platform': platform.platform(),
        'sqlite_runtime': sqlite3.sqlite_version, 'logical_cpus': os.cpu_count(),
        'tool_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'relevant_sources': code_before,
        'timing': 'sqlite3 execute and fetchall separately; batch CPU includes loop bookkeeping, not validation',
        'limitations': 'SQLite fixed 200-row large-body fixture; not HTTP throughput or PostgreSQL timing'},
        'results': {name: {} for name in ('before', 'after')}}
    engines, connections = {}, {}
    try:
        original_digest = backup_pair(source, paths.values())
        assert original_digest['rows'] == 200 and original_digest['minimum_snapshot_utf8_bytes'] > 50000
        output['source_bodies'] = original_digest
        for name, path in paths.items():
            engines[name] = create_engine('sqlite:///' + path.as_posix())
            with sqlite3.connect(path) as connection:
                assert full_body_digest(connection) == original_digest
        table = Table('bookmarks_items', MetaData(), autoload_with=engines['after'])
        candidate = Index(INDEX_NAME, table.c.deleted_at, table.c.created_at, table.c.id)
        candidate.create(engines['after'], checkfirst=True)
        candidate.create(engines['after'], checkfirst=True)  # Exercise idempotent DDL on the copy only.
        output['candidate'] = {'name': INDEX_NAME, 'columns': ['deleted_at', 'created_at', 'id'],
                               'checkfirst_twice_passed': True}
        expected_dto = None
        queries = None
        for name, path in paths.items():
            dto, captured_queries, captured_statements = service_capture(engines[name])
            if expected_dto is None:
                expected_dto, queries = dto, captured_queries
            assert dto == expected_dto, 'Full DTO differs between index variants'
            assert captured_queries == queries, 'Variants must execute identical service SQL'
            connections[name] = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
            connection = connections[name]
            connection.execute('PRAGMA query_only=ON')
            output['results'][name] = {
                'db_bytes': path.stat().st_size, 'sql_statements': captured_statements,
                'indexes': [list(row) for row in connection.execute("PRAGMA index_list('bookmarks_items')")],
                'plans': {key: explain(connection, query) for key, query in queries.items()},
                'rounds': {key: [] for key in queries},
                'dto_sha256': hashlib.sha256(json.dumps(dto, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                'dto_item_fields': sorted(dto['items'][0]), 'dto_rows': len(dto['items']), 'dto_total': dto['total'],
            }
        output['full_dto_equal'] = True
        expected_rows = {key: connections['before'].execute(query['sql'], query['parameters']).fetchall()
                         for key, query in queries.items()}
        for connection in connections.values():
            for key, query in queries.items():
                for _ in range(3):
                    assert connection.execute(query['sql'], query['parameters']).fetchall() == expected_rows[key]
        for group in range(args.rounds):
            for key, query in queries.items():
                for name in (('before', 'after') if group % 2 == 0 else ('after', 'before')):
                    result = batch(connections[name], query, expected_rows[key], args.repetitions)
                    result['group'] = group + 1
                    output['results'][name]['rounds'][key].append(result)
        output['summary'] = {}
        for key in queries:
            medians = {}
            for name in paths:
                rounds = output['results'][name]['rounds'][key]
                medians[name] = {metric: statistics.median(group[metric] for group in rounds)
                                 for metric in ('total_median_ns', 'execute_median_ns', 'fetch_median_ns')}
                medians[name]['group_total_median_ns'] = [group['total_median_ns'] for group in rounds]
                medians[name]['batch_thread_cpu_ns_total'] = sum(group['batch_thread_cpu_ns'] for group in rounds)
            medians['total_percent_change'] = (medians['after']['total_median_ns'] /
                                               medians['before']['total_median_ns'] - 1) * 100
            output['summary'][key] = medians
        for name, connection in connections.items():
            assert full_body_digest(connection) == original_digest
        output['all_body_data_preserved'] = True
        output['source_file_state_unchanged'] = file_state(source) == source_before
        output['relevant_sources_unchanged'] = relevant_sources() == code_before
        output['tool_unchanged'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == output['protocol']['tool_sha256']
        assert output['source_file_state_unchanged'] and output['relevant_sources_unchanged'] and output['tool_unchanged']
        output['complete'] = True
    except Exception as error:
        output['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        for connection in connections.values():
            connection.close()
        for engine in engines.values():
            engine.dispose()
        output['protocol']['finished_at'] = datetime.now(timezone.utc).isoformat()
        (output_dir / 'results.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'complete': output['complete'], 'summary': output['summary'],
                      'plans': {name: result['plans'] for name, result in output['results'].items()},
                      'output': str(output_dir / 'results.json')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--rounds', type=int, default=7)
    parser.add_argument('--repetitions', type=int, default=10)
    main(parser.parse_args())
