"""Real isolated SQLite/API contracts, including races, rollback and round trips."""
import asyncio
import copy
import json
from uuid import uuid4

import pytest

from app.mindmap.validation import (
    MAX_BYTES, MAX_REQUEST_BYTES, MAX_SUMMARIES, METADATA_BYTES,
    default_document, json_bytes, validate_document,
)
from lizysdk.errors import ParamError

BASE = '/api/mindmap'


def test_cross_port_metadata_patch_preflight(client):
    response = client.options(f'{BASE}/maps/1', headers={
        'Origin': 'http://localhost:60101',
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'Content-Type',
    })
    assert response.status_code == 200
    assert 'PATCH' in response.headers['Access-Control-Allow-Methods']


def mutation(**kwargs):
    return {'mutation_id': str(uuid4()), **kwargs}


def node(uid, text=None, children=None, **data):
    return {'data': {'uid': uid, 'text': uid if text is None else text, 'expand': True, **data},
            'children': children or []}


def document():
    doc = default_document('Root')
    doc['root'] = node('root', children=[node('a'), node('b', children=[node('c')])])
    doc['view'] = {'transform': {'scaleX': 1.2, 'translateX': 10}}
    return doc


def create(client, headers, **kwargs):
    response = client.post(f'{BASE}/maps', headers=headers,
                           json=mutation(name='Test map', document=document(), **kwargs))
    assert response.status_code == 201, response.text
    return response.json()['data']


def get(client, headers, map_id):
    response = client.get(f'{BASE}/maps/{map_id}', headers=headers)
    assert response.status_code == 200, response.text
    return response.json()['data']


def batch(client, headers, row, operations):
    return client.post(f"{BASE}/maps/{row['id']}/nodes/batch", headers=headers,
                       json=mutation(revision=row['revision'], operations=operations))


def workspace(client, headers, name):
    response = client.post('/api/workspaces', headers=headers, json={'name': name})
    assert response.status_code == 201, response.text
    return response.json()['data']['id']


def post(client, headers, ws, name, parent=None):
    response = client.post('/api/posts', headers=headers, json={
        'title': name, 'name': name, 'workspace_id': ws, 'parent_id': parent, 'content': '',
    })
    assert response.status_code == 201, response.text
    return response.json()['data']['id']


@pytest.mark.parametrize(('method', 'path'), [
    ('get', '/maps'), ('post', '/maps'), ('post', '/import'), ('get', '/maps/1'),
    ('patch', '/maps/1'), ('delete', '/maps/1'), ('put', '/maps/1/document'),
    ('post', '/maps/1/duplicate'), ('post', '/maps/1/nodes/batch'),
    ('get', '/maps/1/export'), ('get', '/maps/1/versions'),
    ('get', '/maps/1/versions/1'), ('post', '/maps/1/restore'),
])
def test_every_endpoint_requires_login(client, method, path):
    assert getattr(client, method)(BASE + path).status_code == 401


def test_persistence_metadata_filter_sort_and_pagination(client, auth_headers):
    ws = workspace(client, auth_headers, 'Maps workspace')
    row = create(client, auth_headers, workspace_id=ws)
    assert row['revision'] == 1 and row['node_count'] == 4
    assert row['created_by'] == 'admin'
    assert get(client, auth_headers, row['id'])['document'] == document()
    response = client.patch(f"{BASE}/maps/{row['id']}", headers=auth_headers,
                            json=mutation(name='Renamed', revision=1))
    assert response.status_code == 200
    assert response.json()['data']['revision'] == 2
    listing = client.get(f'{BASE}/maps', headers=auth_headers, params={
        'workspace_id': ws, 'keyword': 'named', 'sort': 'name_asc', 'page_size': 1,
    }).json()['data']
    assert listing['total'] == 1 and listing['total_pages'] == 1
    assert listing['items'][0]['name'] == 'Renamed'
    assert 'document' not in listing['items'][0]
    assert client.get(f'{BASE}/maps?page=0', headers=auth_headers).status_code == 400
    assert client.get(f'{BASE}/maps?sort=invalid', headers=auth_headers).status_code == 400
    assert client.get(f'{BASE}/maps?page=99999999999999999999999', headers=auth_headers).status_code == 400
    assert client.get(f'{BASE}/maps/99999999999999999999999', headers=auth_headers).status_code == 400


def test_default_document_and_empty_node_text(client, auth_headers):
    response = client.post(f'{BASE}/maps', headers=auth_headers, json=mutation(name='Default'))
    assert response.status_code == 201
    row = response.json()['data']
    assert row['document']['root']['data']['text'] == 'Default'
    row['document']['root']['data']['text'] = ''
    response = client.put(f"{BASE}/maps/{row['id']}/document", headers=auth_headers,
                          json=mutation(document=row['document'], revision=1))
    assert response.status_code == 200


def test_duplicate_and_durable_create_retry(client, auth_headers):
    body = mutation(name='Once')
    a = client.post(f'{BASE}/maps', headers=auth_headers, json=body)
    b = client.post(f'{BASE}/maps', headers=auth_headers, json=body)
    assert a.status_code == b.status_code == 201
    assert a.json() == b.json()
    row = a.json()['data']
    body = mutation(revision=1)
    path = f"{BASE}/maps/{row['id']}/duplicate"
    duplicate = client.post(path, headers=auth_headers, json=body)
    assert duplicate.status_code == 201
    assert duplicate.json()['data']['id'] != row['id']
    assert duplicate.json()['data']['document'] == row['document']
    assert client.post(path, headers=auth_headers, json=body).json() == duplicate.json()
    assert client.get(f'{BASE}/maps', headers=auth_headers).json()['data']['total'] == 2


def test_compare_and_swap_and_retry_replays_original_version(client, auth_headers):
    row = create(client, auth_headers)
    edited = copy.deepcopy(row['document'])
    edited['root']['data']['text'] = 'Saved'
    body = mutation(document=edited, revision=1)
    path = f"{BASE}/maps/{row['id']}/document"
    saved = client.put(path, headers=auth_headers, json=body)
    assert saved.status_code == 200
    assert saved.json()['data']['revision'] == 2
    stale = client.put(path, headers=auth_headers, json=mutation(document=document(), revision=1))
    assert stale.status_code == 409
    assert stale.json()['data']['details']['current_revision'] == 2
    renamed = client.patch(f"{BASE}/maps/{row['id']}", headers=auth_headers,
                           json=mutation(name='Later', revision=2))
    assert renamed.status_code == 200
    assert client.put(path, headers=auth_headers, json=body).json() == saved.json()
    changed_body = dict(body, document=document())
    reused = client.put(path, headers=auth_headers, json=changed_body)
    assert reused.status_code == 409
    assert reused.json()['data']['details']['reason'] == 'mutation_reused'
    assert get(client, auth_headers, row['id'])['revision'] == 3


@pytest.mark.parametrize('same_request', [False, True])
def test_actual_simultaneous_stale_writers_only_one_commits(app, client, auth_headers, monkeypatch, same_request):
    import httpx
    import threading
    from app.mindmap import services
    row = create(client, auth_headers)
    barrier, lock, count = threading.Barrier(2), threading.Lock(), [0]
    original = services.check_revision

    def simultaneous_check(current, revision):
        original(current, revision)
        with lock:
            count[0] += 1
            must_wait = count[0] <= 2
        if must_wait:
            barrier.wait(timeout=15)
    monkeypatch.setattr(services, 'check_revision', simultaneous_check)
    shared_body = mutation(name='Writer A', revision=1)

    async def race():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as api:
            return await asyncio.gather(*[
                api.patch(f"{BASE}/maps/{row['id']}", headers=auth_headers,
                          json=shared_body if same_request else mutation(name=title, revision=1))
                for title in ('Writer A', 'Writer B')
            ])
    results = asyncio.run(race())
    assert sorted(r.status_code for r in results) == ([200, 200] if same_request else [200, 409]), [r.text for r in results]
    if same_request:
        assert results[0].json() == results[1].json()
    assert get(client, auth_headers, row['id'])['revision'] == 2
    versions = client.get(f"{BASE}/maps/{row['id']}/versions", headers=auth_headers).json()['data']
    assert versions['total'] == 2


def test_node_batch_is_ordered_atomic_and_moves_preserve_subtrees(client, auth_headers):
    row = create(client, auth_headers)
    response = batch(client, auth_headers, row, [
        {'op': 'add', 'parent_id': 'root', 'index': 1, 'node': node('new')},
        {'op': 'update', 'uid': 'new', 'data': {'text': 'New name', 'note': 'Notes', 'tag': ['one']}},
        {'op': 'move', 'uid': 'b', 'parent_id': 'a', 'index': 0},
    ])
    assert response.status_code == 200, response.text
    row = response.json()['data']
    root = row['document']['root']
    assert [n['data']['uid'] for n in root['children']] == ['a', 'new']
    assert root['children'][0]['children'][0]['children'][0]['data']['uid'] == 'c'
    assert row['revision'] == 2 and row['node_count'] == 5
    response = batch(client, auth_headers, row, [
        {'op': 'update', 'uid': 'new', 'data': {'text': 'Must roll back'}},
        {'op': 'move', 'uid': 'a', 'parent_id': 'c'},
    ])
    assert response.status_code == 400
    assert get(client, auth_headers, row['id']) == row


@pytest.mark.parametrize('operation', [
    {'op': 'delete', 'uid': 'root'},
    {'op': 'move', 'uid': 'root', 'parent_id': 'a'},
    {'op': 'update', 'uid': 'a', 'data': {'uid': 'changed'}},
    {'op': 'add', 'parent_id': 'root', 'node': node('a')},
    {'op': 'add', 'parent_id': 'root', 'node': {'data': {'uid': 'bad'}, 'children': [42]}},
    {'op': 'move', 'uid': 'a', 'parent_id': 'b', 'index': -1},
])
def test_invalid_node_operations_leave_document_intact(client, auth_headers, operation):
    row = create(client, auth_headers)
    response = batch(client, auth_headers, row, [operation])
    assert response.status_code == 400, response.text
    assert get(client, auth_headers, row['id']) == row


def test_delete_subtree_cleans_relation_plugin_metadata(client, auth_headers):
    row = create(client, auth_headers)
    doc = row['document']
    doc['root']['data'].update({
        'associativeLineTargets': ['a', 'c'], 'associativeLinePoint': [1, 2],
        'associativeLineTargetControlOffsets': [3, 4],
        'associativeLineText': {'a': 'Keep', 'c': 'Remove'},
        'associativeLineStyle': {'a': {'color': 'red'}, 'c': {'color': 'blue'}},
    })
    response = client.put(f"{BASE}/maps/{row['id']}/document", headers=auth_headers,
                          json=mutation(revision=1, document=doc))
    row = response.json()['data']
    response = batch(client, auth_headers, row, [{'op': 'delete', 'uid': 'b'}])
    assert response.status_code == 200, response.text
    data = response.json()['data']['document']['root']['data']
    assert data['associativeLineTargets'] == ['a']
    assert data['associativeLinePoint'] == [1]
    assert data['associativeLineTargetControlOffsets'] == [3]
    assert data['associativeLineText'] == {'a': 'Keep'}


def test_roundtrip_preserves_complete_plugin_data_and_import_never_implicitly_overwrites(client, auth_headers):
    doc = document()
    doc['root']['data'].update({
        'color': '#123456', 'fillColor': '#ffffff', 'lineWidth': 3, 'fontSize': 17,
        'hyperlink': 'https://example.org/page', 'hyperlinkTitle': 'Link', 'note': 'Note',
        'tag': ['tag'], 'icon': ['priority_1'], 'image': '/api/images/test.png',
        'generalization': [{'uid': 'summary-root', 'text': 'Summary', 'range': [0, 1]}],
        'associativeLineTargets': ['c'], 'associativeLineText': {'c': 'Related'},
    })
    doc['theme'] = {'template': 'default', 'config': {'backgroundColor': '#ffffff', 'backgroundImage': 'none'}}
    response = client.post(f'{BASE}/maps', headers=auth_headers,
                           json=mutation(name='Plugin map', document=doc))
    assert response.status_code == 201, response.text
    row = response.json()['data']
    exported = client.get(f"{BASE}/maps/{row['id']}/export", headers=auth_headers).json()['data']
    assert exported['format'] == 'doublog.mindmap' and exported['schema_version'] == 1
    imported = client.post(f'{BASE}/import', headers=auth_headers, json=mutation(payload=exported))
    assert imported.status_code == 201, imported.text
    assert imported.json()['data']['id'] != row['id']
    assert imported.json()['data']['document'] == doc
    assert get(client, auth_headers, row['id'])['revision'] == 1


def test_import_replace_is_atomic_and_history_restore_appends_version(client, auth_headers):
    row = create(client, auth_headers)
    payload = client.get(f"{BASE}/maps/{row['id']}/export", headers=auth_headers).json()['data']
    payload['name'] = 'Imported'
    payload['document']['root']['data']['text'] = 'New content'
    response = client.post(f'{BASE}/import', headers=auth_headers,
                           json=mutation(payload=payload, target_id=row['id'], revision=1))
    assert response.status_code == 200
    assert response.json()['data']['revision'] == 2
    payload['document']['root']['children'][0]['data']['uid'] = 'root'
    response = client.post(f'{BASE}/import', headers=auth_headers,
                           json=mutation(payload=payload, target_id=row['id'], revision=2))
    assert response.status_code == 400
    assert get(client, auth_headers, row['id'])['revision'] == 2
    response = client.post(f"{BASE}/maps/{row['id']}/restore", headers=auth_headers,
                           json=mutation(version=1, revision=2))
    assert response.status_code == 200
    restored = response.json()['data']
    assert restored['revision'] == 3
    assert restored['name'] == row['name'] and restored['document'] == row['document']
    versions = client.get(f"{BASE}/maps/{row['id']}/versions", headers=auth_headers).json()['data']
    assert [v['revision'] for v in versions['items']] == [3, 2, 1]
    assert versions['items'][0]['action'] == 'restore:1'
    assert all('document' not in v for v in versions['items'])
    version = client.get(f"{BASE}/maps/{row['id']}/versions/2", headers=auth_headers).json()['data']
    assert version['document']['root']['data']['text'] == 'New content'


def test_workspace_article_constraints_and_deletion_lifecycle(client, auth_headers):
    ws = workspace(client, auth_headers, 'Linked')
    other = workspace(client, auth_headers, 'Other')
    parent = post(client, auth_headers, ws, 'linked-parent')
    child = post(client, auth_headers, ws, 'linked-child', parent)
    bad = client.post(f'{BASE}/maps', headers=auth_headers,
                      json=mutation(name='Wrong', workspace_id=other, post_id=child))
    assert bad.status_code == 400
    row = create(client, auth_headers, workspace_id=ws, post_id=child)
    response = client.delete(f'/api/posts/id/{parent}?recursive=1', headers=auth_headers)
    assert response.status_code == 200, response.text
    after = get(client, auth_headers, row['id'])
    assert after['post_id'] is None and after['revision'] == 2
    assert client.delete(f'/api/workspaces/{ws}', headers=auth_headers).status_code == 400
    body = mutation(revision=2)
    deleted = client.request('DELETE', f"{BASE}/maps/{row['id']}", headers=auth_headers, json=body)
    assert deleted.status_code == 200
    assert client.request('DELETE', f"{BASE}/maps/{row['id']}", headers=auth_headers, json=body).json() == deleted.json()
    assert client.get(f"{BASE}/maps/{row['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f'/api/workspaces/{ws}', headers=auth_headers).status_code == 200


def test_bad_json_required_mutation_and_input_limit(client, auth_headers):
    for content in ('{', '[]', '{"name":NaN}', '{"name":"x","__proto__":{}}'):
        response = client.post(
            f'{BASE}/maps', headers={**auth_headers, 'Content-Type': 'application/json'}, content=content)
        assert response.status_code == 400
    assert client.post(f'{BASE}/maps', headers=auth_headers, json={'name': 'No id'}).status_code == 400
    huge = '{"extra":"' + ('x' * MAX_REQUEST_BYTES) + '"}'
    response = client.post(f'{BASE}/maps', headers=auth_headers, content=huge)
    assert response.status_code == 400 and 'HTTP' in response.json()['message']


@pytest.mark.parametrize('change', [
    lambda doc: doc.update(layout='invalid'),
    lambda doc: doc['root']['data'].update(expand='false'),
    lambda doc: doc['root']['data'].update(text=17),
    lambda doc: doc['root']['data'].update(uid='  '),
    lambda doc: doc['root']['data'].update(associativeLineTargets=['missing']),
    lambda doc: doc['root']['data'].update(associativeLineTargets=['root']),
    lambda doc: doc['root']['data'].update(richText=True, text='<img src=x onerror=alert(1)>'),
    lambda doc: doc['root']['data'].update(hyperlink='javascript:alert(1)'),
    lambda doc: doc['root']['data'].update(image='https://example.org/picture.svg?q=1'),
    lambda doc: doc['root']['data'].update(image='data:image/svg+xml;base64,PHN2Zz4='),
    lambda doc: doc['root']['data'].update(generalization=[{'uid': 's', 'text': 'x', 'richText': True}]),
    lambda doc: doc['root']['data'].update(generalization=[None]),
    lambda doc: doc['root']['data'].update(tag=[None]),
    lambda doc: doc['root']['data'].update(icon=[{}]),
    lambda doc: doc['root']['data'].update(hyperlinkTitle='</title><script>alert(1)</script>'),
    lambda doc: doc['root']['data'].update(attachmentUrl='javascript:alert(1)'),
    lambda doc: doc['root']['data'].update(attachmentName='</title><image href=x>'),
    lambda doc: doc['root']['data'].update(imgMap={'/api/images/a.png': 'javascript:alert(1)'}),
    lambda doc: doc['root']['data'].update(imgMap={'/api/images/a.png': 'https://example.org/a.svg'}),
    lambda doc: doc['theme']['config'].update(backgroundImage='javascript:alert(1)'),
    lambda doc: doc['theme']['config'].update(constructor={}),
    lambda doc: doc['root']['data'].update(fontSize=float('nan')),
])
def test_invalid_documents_are_rejected_at_boundary(change):
    doc = document()
    change(doc)
    with pytest.raises(ParamError):
        validate_document(doc)


def test_cyclic_duplicate_deep_and_large_documents():
    doc = document()
    doc['root']['children'].append(doc['root'])
    with pytest.raises(ParamError, match='循环'):
        validate_document(doc)
    doc = document()
    doc['root']['children'].append(node('a'))
    with pytest.raises(ParamError, match='重复'):
        validate_document(doc)
    doc = document()
    doc['root'] = node('n0')
    current = doc['root']
    for i in range(1, 129):
        current['children'] = [node(f'n{i}')]
        current = current['children'][0]
    with pytest.raises(ParamError, match='深度'):
        validate_document(doc)
    doc = document()
    doc['root']['children'] = [node(f'n{i}') for i in range(10000)]
    with pytest.raises(ParamError, match='总数'):
        validate_document(doc)


def test_five_thousand_nodes_are_persisted_and_exported_without_truncation(client, auth_headers):
    doc = default_document('5000 nodes')
    doc['root']['children'] = [node(f'n{i}') for i in range(4999)]
    response = client.post(f'{BASE}/maps', headers=auth_headers,
                           json=mutation(name='Scale', document=doc))
    assert response.status_code == 201, response.text
    row = response.json()['data']
    assert row['node_count'] == 5000
    exported = client.get(f"{BASE}/maps/{row['id']}/export", headers=auth_headers).json()['data']
    assert exported['document'] == doc


def test_depth_128_roundtrip_uses_valid_shared_envelope(client, auth_headers):
    doc = default_document('Deep')
    doc['root'] = node('n0')
    current = doc['root']
    for i in range(1, 128):
        current['children'] = [node(f'n{i}')]
        current = current['children'][0]
    response = client.post(f'{BASE}/maps', headers=auth_headers,
                           content=json.dumps(mutation(name='Deep', document=doc)))
    assert response.status_code == 201, response.text
    assert response.json()['success'] is True
    assert response.json()['data']['node_count'] == 128


def test_cookie_login_data_and_idempotency_survive_application_restart(client, app):
    from app.main import create_app
    from fastapi.testclient import TestClient
    login = client.post('/api/auth/login', json={'username': 'admin', 'password': 'lizy111A'})
    assert login.status_code == 200
    body = mutation(name='Durable cookie map', document=document())
    created = client.post(f'{BASE}/maps', json=body)
    assert created.status_code == 201
    with TestClient(create_app()) as restarted:
        restarted.cookies.update(client.cookies)
        recovered = restarted.get(f"{BASE}/maps/{created.json()['data']['id']}")
        assert recovered.json() == {**created.json(), 'code': 200}
        assert restarted.post(f'{BASE}/maps', json=body).json() == created.json()


def test_unknown_import_versions_and_required_fields_do_not_create_maps(client, auth_headers):
    row = create(client, auth_headers)
    payload = client.get(f"{BASE}/maps/{row['id']}/export", headers=auth_headers).json()['data']
    for patch in ({'schema_version': 2}, {'schema_version': True}, {'format': 'other'},
                  {'id': None}, {'revision': 0}, {'workspace_id': False}):
        response = client.post(f'{BASE}/import', headers=auth_headers,
                               json=mutation(payload={**payload, **patch}))
        assert response.status_code == 400, response.text
    assert client.get(f'{BASE}/maps', headers=auth_headers).json()['data']['total'] == 1


@pytest.mark.parametrize('article', [False, True])
def test_resource_delete_racing_map_creation_never_leaves_dangling_link(app, client, auth_headers, monkeypatch, article):
    import httpx
    import threading
    from app.mindmap import services
    ws = workspace(client, auth_headers, 'Concurrent links')
    linked_post = post(client, auth_headers, ws, 'concurrent-link') if article else None
    checked, deleting = threading.Event(), threading.Event()
    original_associations = services.associations
    original_delete_lock = services.lock_resource_deletion

    def paused_associations(*args, **kwargs):
        result = original_associations(*args, **kwargs)
        if kwargs.get('lock'):
            checked.set()
            assert deleting.wait(10)
        return result

    def observed_delete_lock(*args, **kwargs):
        deleting.set()
        return original_delete_lock(*args, **kwargs)

    monkeypatch.setattr(services, 'associations', paused_associations)
    monkeypatch.setattr(services, 'lock_resource_deletion', observed_delete_lock)

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
            pending_create = asyncio.create_task(api.post(f'{BASE}/maps', headers=auth_headers,
                json=mutation(name='Concurrent map', workspace_id=ws, post_id=linked_post)))
            # Event waits stay in the event loop through short cooperative polls.
            for _ in range(1000):
                if checked.is_set():
                    break
                await asyncio.sleep(0.01)
            assert checked.is_set()
            delete_url = f'/api/posts/id/{linked_post}' if article else f'/api/workspaces/{ws}'
            pending_delete = asyncio.create_task(api.delete(delete_url, headers=auth_headers))
            return await asyncio.gather(pending_create, pending_delete)

    created, deleted = asyncio.run(race())
    assert created.status_code == 201, created.text
    after = get(client, auth_headers, created.json()['data']['id'])
    if article:
        assert deleted.status_code == 200, deleted.text
        assert after['post_id'] is None and after['revision'] == 2
    else:
        assert deleted.status_code == 400, deleted.text
        assert after['workspace_id'] == ws


def test_full_ten_mib_document_exports_and_imports_without_losing_capacity(client, auth_headers):
    doc = document()
    doc['root']['data']['_padding'] = ''
    doc['root']['data']['_padding'] = 'x' * (MAX_BYTES - len(json_bytes(doc)))
    assert len(json_bytes(doc)) == MAX_BYTES
    response = client.post(f'{BASE}/maps', headers=auth_headers,
                           json=mutation(name='Exact 10MiB', document=doc))
    assert response.status_code == 201, response.text[:500]
    row = response.json()['data']
    exported = client.get(f"{BASE}/maps/{row['id']}/export", headers=auth_headers)
    assert exported.status_code == 200
    payload = exported.json()['data']
    assert MAX_BYTES < len(json_bytes(payload)) < MAX_BYTES + METADATA_BYTES
    imported = client.post(f'{BASE}/import', headers=auth_headers, json=mutation(payload=payload))
    assert imported.status_code == 201, imported.text[:500]
    assert imported.json()['data']['document'] == doc
    # The extra wrapper budgets must never enlarge the document's own limit.
    doc['root']['data']['_padding'] += 'x'
    rejected = client.put(f"{BASE}/maps/{row['id']}/document", headers=auth_headers,
                          json=mutation(document=doc, revision=1))
    assert rejected.status_code == 400 and 'document' in rejected.json()['message']


def test_import_and_request_metadata_have_independent_bounded_budgets(client, auth_headers):
    row = create(client, auth_headers)
    payload = client.get(f"{BASE}/maps/{row['id']}/export", headers=auth_headers).json()['data']
    response = client.post(f'{BASE}/maps', headers=auth_headers,
                           json=mutation(name='Extra wrapper', extra='x' * METADATA_BYTES))
    assert response.status_code == 400 and '请求封装元数据' in response.json()['message']
    payload['extra'] = 'x' * METADATA_BYTES
    response = client.post(f'{BASE}/import', headers=auth_headers, json=mutation(payload=payload))
    assert response.status_code == 400 and '信封元数据' in response.json()['message']


@pytest.mark.parametrize('by_slug', [False, True])
def test_post_unlink_audit_uses_authenticated_renamed_account(client, auth_headers, by_slug):
    import base64
    ws = workspace(client, auth_headers, 'Audit identity')
    post_id = post(client, auth_headers, ws, 'audit-article')
    row = create(client, auth_headers, workspace_id=ws, post_id=post_id)
    changed = client.put('/api/admin/account', headers=auth_headers,
                         json={'old_password': 'lizy111A', 'username': 'renamed-auditor'})
    assert changed.status_code == 200
    new_headers = {'Authorization': 'Basic ' + base64.b64encode(b'renamed-auditor:lizy111A').decode()}
    # Exercise the real Cookie-first identity rule for the slug variant as well.
    if by_slug:
        assert client.post('/api/auth/login', json={
            'username': 'renamed-auditor', 'password': 'lizy111A'}).status_code == 200
    url = '/api/posts/slug/audit-article' if by_slug else f'/api/posts/id/{post_id}'
    response = client.delete(url, headers=auth_headers if by_slug else new_headers)
    assert response.status_code == 200, response.text
    after = get(client, new_headers, row['id'])
    assert after['post_id'] is None and after['updated_by'] == 'renamed-auditor'
    version = client.get(f"{BASE}/maps/{row['id']}/versions/2", headers=new_headers).json()['data']
    assert version['action'] == 'post_unlinked' and version['actor'] == 'renamed-auditor'


@pytest.mark.parametrize('summary_range', [
    [], [0], [0, 1, 2], [-1, -1], [1, 0], [0, 2], [False, 1], [0, True],
    [0.0, 1], '0,1', {'start': 0, 'end': 1},
])
def test_summary_invalid_ranges_are_rejected(summary_range):
    doc = document()
    doc['root']['data']['generalization'] = [{'text': 'Summary', 'range': summary_range}]
    with pytest.raises(ParamError, match='range'):
        validate_document(doc)


@pytest.mark.parametrize('summary_uid', ['', '  ', None, True, 123, 'x' * 129, 'root', 'a', 'c'])
def test_summary_invalid_or_tree_duplicate_uids_are_rejected(summary_uid):
    doc = document()
    doc['root']['data']['generalization'] = [{'uid': summary_uid, 'text': 'Summary'}]
    with pytest.raises(ParamError, match='uid'):
        validate_document(doc)


def test_summary_limits_uid_namespace_and_legacy_null_range_compatibility():
    doc = document()
    doc['root']['data']['generalization'] = [
        {'text': 'Legacy summary'}, {'text': 'Null range', 'range': None},
        {'uid': 'summary-new', 'text': 'Valid interval', 'range': [0, 1]},
    ]
    assert validate_document(doc)[1] == 4
    # Duplicate summaries in separate branches still share one UID namespace.
    doc['root']['children'][1]['data']['generalization'] = [{'uid': 'summary-new', 'text': 'Duplicate'}]
    with pytest.raises(ParamError, match='重复'):
        validate_document(doc)
    doc['root']['children'][1]['data'].pop('generalization')
    doc['root']['data']['generalization'] = [{'text': f'Summary {i}'} for i in range(MAX_SUMMARIES)]
    assert validate_document(doc)[1] == 4
    doc['root']['children'][1]['data']['generalization'] = [{'text': 'One over the global limit'}]
    with pytest.raises(ParamError, match='1000'):
        validate_document(doc)


def test_invalid_summary_save_cannot_change_existing_map(client, auth_headers):
    row = create(client, auth_headers)
    doc = copy.deepcopy(row['document'])
    doc['root']['data']['generalization'] = [{'uid': 'summary-safe', 'text': 'Invalid', 'range': [-1, -1]}]
    response = client.put(f"{BASE}/maps/{row['id']}/document", headers=auth_headers,
                          json=mutation(document=doc, revision=1))
    assert response.status_code == 400
    assert get(client, auth_headers, row['id']) == row
