"""
Workspace（知识库）API tests

覆盖：CRUD、删除保护、库间隔离、库内唯一性、跨库限制、顶级排序归属
"""
import pytest


def _ws(client, headers):
    return client.get('/api/workspaces', headers=headers).json()['data']


def _mk_ws(client, headers, name):
    r = client.post('/api/workspaces', json={'name': name}, headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _mk_post(client, headers, title, name, workspace_id=None, parent_id=None):
    payload = {'title': title, 'name': name, 'content': 'c'}
    if workspace_id:
        payload['workspace_id'] = workspace_id
    if parent_id:
        payload['parent_id'] = parent_id
    return client.post('/api/posts', json=payload, headers=headers)


# ─── 迁移与默认库 ────────────────────────────────────────

def test_default_workspace_auto_created(client, auth_headers):
    """任何新库自动有默认知识库，存量文章归入其中"""
    _mk_post(client, auth_headers, 'P', 'ws-default-post')
    wss = _ws(client, auth_headers)

    assert len(wss) == 1
    assert wss[0]['name'] == '默认知识库'
    assert wss[0]['post_count'] == 1


def test_tree_defaults_to_first_workspace(client, auth_headers):
    """树接口不传 workspace_id 时使用默认（id 最小）知识库"""
    _mk_post(client, auth_headers, 'A', 'ws-tree-post')
    tree = client.get('/api/posts/tree', headers=auth_headers).json()['data']
    assert [n['name'] for n in tree] == ['ws-tree-post']


# ─── CRUD ────────────────────────────────────────────────

def test_create_list_rename_workspace(client, auth_headers):
    ws = _mk_ws(client, auth_headers, '前端笔记')

    assert ws['name'] == '前端笔记'
    assert ws['post_count'] == 0

    r = client.put(f"/api/workspaces/{ws['id']}", json={'name': '前端笔记集'}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data']['name'] == '前端笔记集'

    names = [w['name'] for w in _ws(client, auth_headers)]
    assert '前端笔记集' in names and '前端笔记' not in names


def test_create_workspace_duplicate_name(client, auth_headers):
    _mk_ws(client, auth_headers, '唯一库')
    r = client.post('/api/workspaces', json={'name': '唯一库'}, headers=auth_headers)

    assert r.status_code == 400


def test_create_workspace_empty_name(client, auth_headers):
    r = client.post('/api/workspaces', json={'name': '  '}, headers=auth_headers)

    assert r.status_code == 400


def test_delete_empty_workspace(client, auth_headers):
    ws = _mk_ws(client, auth_headers, '待删库')
    r = client.delete(f"/api/workspaces/{ws['id']}", headers=auth_headers)

    assert r.status_code == 200
    assert all(w['id'] != ws['id'] for w in _ws(client, auth_headers))


def test_delete_nonempty_workspace_rejected(client, auth_headers):
    ws = _mk_ws(client, auth_headers, '非空库')
    _mk_post(client, auth_headers, 'P', 'ws-post-in-busy', workspace_id=ws['id'])

    r = client.delete(f"/api/workspaces/{ws['id']}", headers=auth_headers)

    assert r.status_code == 400
    assert '篇文章' in r.json()['message']


def test_delete_last_workspace_rejected(client, auth_headers):
    wss = _ws(client, auth_headers)
    assert len(wss) == 1  # 只有默认库

    r = client.delete(f"/api/workspaces/{wss[0]['id']}", headers=auth_headers)

    assert r.status_code == 400


def test_workspace_requires_auth(client):
    assert client.get('/api/workspaces').status_code == 401


# ─── 库间隔离 ────────────────────────────────────────────

def test_tree_isolation_between_workspaces(client, auth_headers):
    ws_a = _mk_ws(client, auth_headers, '库A')
    ws_b = _mk_ws(client, auth_headers, '库B')
    assert _mk_post(client, auth_headers, 'A1', 'iso-post-a', workspace_id=ws_a['id']).status_code == 201
    assert _mk_post(client, auth_headers, 'B1', 'iso-post-b', workspace_id=ws_b['id']).status_code == 201

    tree_a = client.get(f"/api/posts/tree?workspace_id={ws_a['id']}", headers=auth_headers).json()['data']
    tree_b = client.get(f"/api/posts/tree?workspace_id={ws_b['id']}", headers=auth_headers).json()['data']

    assert [n['name'] for n in tree_a] == ['iso-post-a']
    assert [n['name'] for n in tree_b] == ['iso-post-b']

    # 列表过滤
    lst_b = client.get(f"/api/posts?workspace_id={ws_b['id']}", headers=auth_headers).json()['data']
    assert [i['name'] for i in lst_b['items']] == ['iso-post-b']

    # post_count 汇总
    counts = {w['id']: w['post_count'] for w in _ws(client, auth_headers)}
    assert counts[ws_a['id']] == 1 and counts[ws_b['id']] == 1


def test_same_name_allowed_in_different_workspaces(client, auth_headers):
    ws_a = _mk_ws(client, auth_headers, '名字库A')
    ws_b = _mk_ws(client, auth_headers, '名字库B')

    r1 = _mk_post(client, auth_headers, 'T', 'shared-name', workspace_id=ws_a['id'])
    r2 = _mk_post(client, auth_headers, 'T', 'shared-name', workspace_id=ws_b['id'])

    assert r1.status_code == 201
    assert r2.status_code == 201

    # 同库内仍拒绝
    r3 = _mk_post(client, auth_headers, 'T', 'shared-name', workspace_id=ws_a['id'])
    assert r3.status_code == 400


def test_cross_workspace_parent_rejected(client, auth_headers):
    ws_a = _mk_ws(client, auth_headers, '父库')
    ws_b = _mk_ws(client, auth_headers, '子库')
    parent = _mk_post(client, auth_headers, 'P', 'xws-parent', workspace_id=ws_a['id']).json()['data']

    r = _mk_post(client, auth_headers, 'C', 'xws-child', workspace_id=ws_b['id'], parent_id=parent['id'])

    assert r.status_code == 400
    assert '不属于该知识库' in r.json()['message']


def test_move_across_workspaces_rejected(client, auth_headers):
    ws_a = _mk_ws(client, auth_headers, '源库')
    ws_b = _mk_ws(client, auth_headers, '目标库')
    pid = _mk_post(client, auth_headers, 'P', 'mvw-post', workspace_id=ws_a['id']).json()['data']['id']
    target = _mk_post(client, auth_headers, 'T', 'mvw-target', workspace_id=ws_b['id']).json()['data']

    r = client.put(f"/api/posts/id/{pid}", json={'parent_id': target['id']}, headers=auth_headers)

    assert r.status_code == 400
    assert '跨知识库' in r.json()['message']


# ─── 顶级排序归属知识库 ──────────────────────────────────

def test_root_reorder_writes_workspace_order(client, auth_headers):
    ws = _mk_ws(client, auth_headers, '排序库')
    p1 = _mk_post(client, auth_headers, '1', 'ord-ws-one', workspace_id=ws['id']).json()['data']['id']
    p2 = _mk_post(client, auth_headers, '2', 'ord-ws-two', workspace_id=ws['id']).json()['data']['id']

    tree = client.get(f"/api/posts/tree?workspace_id={ws['id']}", headers=auth_headers).json()['data']
    assert [n['id'] for n in tree] == [p1, p2]   # 创建顺序

    r = client.put('/api/posts/reorder',
                   json={'parent_id': 0, 'workspace_id': ws['id'], 'children_order': [p2, p1]},
                   headers=auth_headers)
    assert r.status_code == 200

    tree = client.get(f"/api/posts/tree?workspace_id={ws['id']}", headers=auth_headers).json()['data']
    assert [n['id'] for n in tree] == [p2, p1]   # 拖拽后顺序,且不影响默认库


def test_delete_top_level_post_updates_workspace_order(client, auth_headers):
    ws = _mk_ws(client, auth_headers, '删序库')
    p1 = _mk_post(client, auth_headers, '1', 'delord-one', workspace_id=ws['id']).json()['data']['id']
    p2 = _mk_post(client, auth_headers, '2', 'delord-two', workspace_id=ws['id']).json()['data']['id']

    r = client.delete(f'/api/posts/id/{p1}', headers=auth_headers)
    assert r.status_code == 200

    tree = client.get(f"/api/posts/tree?workspace_id={ws['id']}", headers=auth_headers).json()['data']
    assert [n['id'] for n in tree] == [p2]

    # workspaces.children_order 中的悬挂 id 不影响树渲染
    wss = _ws(client, auth_headers)
    target = next(w for w in wss if w['id'] == ws['id'])
    assert target['post_count'] == 1
