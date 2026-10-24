"""列表Core投影保留完整DTO、关联顺序与复习队列共享helper语义。"""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event, literal, select, text
from sqlalchemy.orm import Session


@pytest.fixture
def projection_data(app, monkeypatch):
    from app.shared import timeutil
    from app.todo.models import AppSetting
    from app.practice.models import (PracticeProblem, PracticeTag, PracticeProblemTag,
        PracticeSolution, PracticeSolutionCode, PracticeReview)
    from app.practice.schemas import ProblemSummaryOut
    stamp = datetime(2026, 10, 20, 12, 34, 56, 123456, tzinfo=timezone.utc)
    monkeypatch.setattr(timeutil, 'now_utc', lambda: datetime(2026, 10, 22, 12, tzinfo=timezone.utc))
    with Session(app.state.engine) as session:
        setting = session.get(AppSetting, 'app')
        if setting is None: session.add(AppSetting(key='app', value='{"timezone":"UTC"}'))
        else: setting.value = '{"timezone":"UTC"}'
        for index, (pid, source, status, difficulty, created) in enumerate([
            ('projection-one', 'leetcode', 'reviewing', 3, stamp),
            ('projection-two', 'other', 'solved', 1, stamp + timedelta(days=1)),
            ('projection-empty', 'leetcode', 'todo', 2, stamp - timedelta(days=1)),
            ('projection-deleted', 'other', 'todo', 1, stamp + timedelta(days=2)),
        ]):
            session.add(PracticeProblem(id=pid, title=f'投影题 {index}', source=source, source_no=str(index),
                difficulty=difficulty, status=status, url='https://example.org/' + pid,
                description_md='不应读取的题干' * 10000, pitfall_md='不应读取的易错点' * 10000,
                first_solved_at=date(2026, 10, 21) if pid == 'projection-two' else None,
                last_reviewed_at=stamp if pid == 'projection-one' else None,
                revision=index + 3, created_at=created, updated_at=stamp,
                deleted_at=stamp if pid == 'projection-deleted' else None))
        session.add_all([
            PracticeTag(id='projection-tag-a', name='稍后标签', color='#123456', sort_order=20, created_at=stamp),
            PracticeTag(id='projection-tag-b', name='优先标签', color='#abcdef', sort_order=10, created_at=stamp),
        ])
        session.flush()
        session.add_all([PracticeProblemTag(problem_id=pid, tag_id=tid) for pid, tid in [
            ('projection-one', 'projection-tag-a'), ('projection-one', 'projection-tag-b'),
            ('projection-two', 'projection-tag-a')]])
        for sid, pid in [('projection-sol-a', 'projection-one'), ('projection-sol-b', 'projection-one'), ('projection-sol-c', 'projection-two')]:
            session.add(PracticeSolution(id=sid, problem_id=pid, name=sid,
                approach_md='不应读取的解法' * 10000, created_at=stamp, updated_at=stamp, revision=1))
        session.flush()
        for index, (sid, language) in enumerate([
            ('projection-sol-a', 'python'), ('projection-sol-a', 'cpp'), ('projection-sol-c', 'javascript')]):
            session.add(PracticeSolutionCode(id=f'projection-code-{index}', solution_id=sid, language=language,
                code='不应读取的大代码' * 10000, note='不应读取的代码备注' * 10000))
        session.add_all([
            PracticeReview(id='projection-review-one', problem_id='projection-one', cycle=2, seq=4,
                prev_interval_days=7, scheduled_date=date(2026, 10, 21), status='pending', created_at=stamp),
            PracticeReview(id='projection-review-empty', problem_id='projection-empty', cycle=1, seq=1,
                prev_interval_days=1, scheduled_date=date(2026, 10, 30), status='pending', created_at=stamp),
            PracticeReview(id='projection-review-done', problem_id='projection-two', cycle=1, seq=1,
                prev_interval_days=1, scheduled_date=date(2026, 10, 20), status='done', result='remembered',
                reviewed_at=stamp, next_interval_days=2, created_at=stamp),
        ])
        session.commit()
        # 原模型/schema路径作为完整序列化参考；在SQL/ORM监听前读取，不能掩盖列表惰性加载。
        expected = {}
        for problem in session.scalars(select(PracticeProblem).where(PracticeProblem.deleted_at.is_(None))):
            value = ProblemSummaryOut.model_validate(problem).model_dump(mode='json')
            value.update(description_md=None, pitfall_md=None)
            expected[problem.id] = value
        tag_a = {'id': 'projection-tag-a', 'name': '稍后标签', 'color': '#123456'}
        tag_b = {'id': 'projection-tag-b', 'name': '优先标签', 'color': '#abcdef'}
        expected['projection-one'].update(tags=[tag_b, tag_a], solution_count=2, code_languages=['cpp', 'python'],
            next_review={'id': 'projection-review-one', 'cycle': 2, 'seq': 4, 'prev_interval_days': 7, 'scheduled_date': '2026-10-21'})
        expected['projection-two'].update(tags=[tag_a], solution_count=1, code_languages=['javascript'])
        expected['projection-empty'].update(next_review={'id': 'projection-review-empty', 'cycle': 1, 'seq': 1,
            'prev_interval_days': 1, 'scheduled_date': '2026-10-30'})
    return expected


@pytest.mark.parametrize('query,ids,total,page,size', [
    ('', ['projection-two', 'projection-one', 'projection-empty'], 3, 1, 20),
    ('?sort=difficulty_asc', ['projection-two', 'projection-empty', 'projection-one'], 3, 1, 20),
    ('?sort=solved_desc', ['projection-two', 'projection-one', 'projection-empty'], 3, 1, 20),
    ('?sort=review_asc', ['projection-one', 'projection-empty', 'projection-two'], 3, 1, 20),
    ('?source=leetcode&status=reviewing', ['projection-one'], 1, 1, 20),
    ('?tags=projection-tag-a&tags_op=and&language=python', ['projection-one'], 1, 1, 20),
    ('?from=2026-10-20&to=2026-10-21', ['projection-two', 'projection-one'], 2, 1, 20),
    ('?only_due_review=true', ['projection-one'], 1, 1, 20),
    ('?page=9&page_size=1', [], 3, 9, 1),
    ('?page=1&page_size=1', ['projection-two'], 3, 1, 1),
])
def test_list_core_projection_matches_complete_original_dto(client, projection_data, query, ids, total, page, size):
    response = client.get('/api/practice/problems' + query)
    assert response.status_code == 200, response.text
    assert response.json()['data'] == {'items': [projection_data[pid] for pid in ids],
        'total': total, 'page': page, 'page_size': size}


def test_list_reads_only_used_columns_and_builds_no_domain_orm(client, app, projection_data):
    from app.practice.models import PracticeProblem, PracticeTag, PracticeSolution, PracticeSolutionCode, PracticeReview
    statements, assembled = [], []
    models = (PracticeProblem, PracticeTag, PracticeSolution, PracticeSolutionCode, PracticeReview)
    def capture(connection, cursor, statement, parameters, context, many):
        if 'practice_' in statement.lower(): statements.append(statement.lower())
    def loaded(session, instance):
        if isinstance(instance, models): assembled.append(type(instance).__name__)
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    event.listen(Session, 'loaded_as_persistent', loaded)
    try:
        response = client.get('/api/practice/problems')
    finally:
        event.remove(Session, 'loaded_as_persistent', loaded)
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    assert assembled == []
    assert len(statements) == 5, statements
    projections = [sql.split('from', 1)[0] for sql in statements]
    unused = ('practice_problems.description_md', 'practice_problems.pitfall_md', 'practice_problems.deleted_at',
        'practice_solutions.approach_md', 'practice_solution_codes.code', 'practice_solution_codes.note',
        'practice_tags.sort_order', 'practice_tags.created_at', 'practice_reviews.result',
        'practice_reviews.reviewed_at', 'practice_reviews.next_interval_days', 'practice_reviews.status', 'practice_reviews.created_at')
    assert not any(column in projection for column in unused for projection in projections), projections


def test_shared_summary_helper_keeps_orm_callers_and_review_queue(client, app, projection_data):
    from app.practice.models import PracticeProblem
    from app.practice.services import _build_summaries
    with Session(app.state.engine) as session:
        rows = list(session.scalars(select(PracticeProblem).where(PracticeProblem.deleted_at.is_(None))))
        assert {item['id']: item for item in _build_summaries(session, rows)} == projection_data
    response = client.get('/api/practice/review/today')
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['today'] == '2026-10-22' and len(data['items']) == 1
    assert data['items'][0]['problem'] == projection_data['projection-one']


def test_legacy_multiple_pending_keeps_original_iteration_choice(client, app, projection_data):
    from app.practice.models import PracticeReview
    from app.practice.services import _review_brief
    with app.state.engine.begin() as connection:
        connection.execute(text('DROP INDEX uq_reviews_open'))
    with Session(app.state.engine) as session:
        session.add(PracticeReview(id='projection-review-second', problem_id='projection-one', cycle=9, seq=12,
            prev_interval_days=30, scheduled_date=date(2026, 10, 15), status='pending',
            created_at=datetime(2026, 10, 20, tzinfo=timezone.utc)))
        session.commit()
        original_rows = list(session.scalars(select(PracticeReview).where(
            PracticeReview.problem_id.in_(list(projection_data)), PracticeReview.status == 'pending')))
        original_last = {row.problem_id: _review_brief(row) for row in original_rows}
    response = client.get('/api/practice/problems')
    assert response.status_code == 200, response.text
    item = next(item for item in response.json()['data']['items'] if item['id'] == 'projection-one')
    assert item['next_review'] == original_last['projection-one']


@pytest.mark.parametrize('solved,reviewed,revision', [
    (None, None, 1),
    (date(2026, 10, 20), None, 3),
    (None, datetime(2026, 10, 20, 8, 30), 17),
    (date(2026, 10, 21), datetime(2026, 10, 21, 4, tzinfo=timezone.utc), 999),
])
def test_summary_row_mapping_keeps_original_schema_json_and_orm_dates(app, solved, reviewed, revision):
    """真实类型Row保留日期/空值/版本与schema默认字段；ORM队列调用仍等价。"""
    import json
    from sqlalchemy.engine import Row
    from app.practice.models import PracticeProblem
    from app.practice.schemas import ProblemSummaryOut
    from app.practice.services import _summary_fields, _SUMMARY_COLUMNS

    values = dict(id='mapping-boundary', source='other', source_no=None,
        title='中文题目 🧪', difficulty=2, url=None, status='todo',
        first_solved_at=solved, last_reviewed_at=reviewed, revision=revision,
        created_at=datetime(2026, 10, 19, 12, 34, 56, 123456, tzinfo=timezone.utc),
        updated_at=datetime(2026, 10, 21, 4, tzinfo=timezone.utc))
    with Session(app.state.engine) as session:
        row = session.execute(select(*[
            literal(values[column.key], type_=column.type).label(column.key)
            for column in _SUMMARY_COLUMNS
        ])).one()
    assert isinstance(row, Row)
    original = ProblemSummaryOut.model_validate(row)
    assert original.model_dump_json() == ProblemSummaryOut.model_validate(row._mapping).model_dump_json()
    full = original.model_dump(mode='json')
    assert {key: full[key] for key in ('tags', 'solution_count', 'code_languages', 'next_review')} == {
        'tags': [], 'solution_count': 0, 'code_languages': [], 'next_review': None}
    assert full['revision'] == revision
    assert full['first_solved_at'] == (solved.isoformat() if solved else None)
    assert full['last_reviewed_at'] == (reviewed.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z') if reviewed else None)
    expected = original.model_dump(mode='json', exclude={'tags', 'solution_count', 'code_languages', 'next_review'})
    expected.update(description_md=None, pitfall_md=None)
    # 完整生产摘要的JSON文本和原Row属性路径相同，复习队列ORM对象也保持该形状。
    def encode(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    assert encode(_summary_fields(row)) == encode(expected)
    assert encode(_summary_fields(PracticeProblem(**values))) == encode(expected)
