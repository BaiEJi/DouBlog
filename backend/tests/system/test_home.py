"""
门户工作台布局 API tests（system 模块，/api/home/layout）

- 空库默认 / PUT 往返与整体替换 / 文案规整（strip、空串→null）
- 校验拒绝：空分组、超量、非法/重复 key、缺名、超长
- DELETE 重置；未认证 401
- 真实 PostgreSQL 往返（需 venv 安装 pgserver，否则跳过）——布局确已落 PG 表
"""
import pytest

LAYOUT = {
    'groups': [
        {'name': '日常', 'cards': [
            {'key': 'blog', 'title': '我的知识库', 'desc': '  文章与双链  '},
            {'key': 'diary'},           # 无覆盖 → null（用前端默认文案）
        ]},
        {'name': '工具', 'cards': [
            {'key': 'devtoolbox', 'title': '', 'desc': None},   # 空串/None → null
            {'key': 'clash'},
        ]},
    ],
}


def test_get_empty_by_default(client, auth_headers):
    r = client.get('/api/home/layout', headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data'] == {'groups': [], 'revision': 0}


def test_put_roundtrip_with_ids(client, auth_headers):
    r = client.put('/api/home/layout', json=LAYOUT, headers=auth_headers)
    assert r.status_code == 200, r.json()
    data = r.json()['data']
    assert [g['name'] for g in data['groups']] == ['日常', '工具']
    ids = [g['id'] for g in data['groups']]
    assert len(set(ids)) == 2 and all(isinstance(i, int) for i in ids)
    # 文案覆盖：strip 保留；无覆盖/空串 → null
    assert data['groups'][0]['cards'][0] == {'key': 'blog', 'title': '我的知识库', 'desc': '文章与双链'}
    assert data['groups'][0]['cards'][1] == {'key': 'diary', 'title': None, 'desc': None}
    assert data['groups'][1]['cards'][0] == {'key': 'devtoolbox', 'title': None, 'desc': None}

    # GET 读回一致（持久化）
    g = client.get('/api/home/layout', headers=auth_headers).json()['data']
    assert g == data


def test_put_replaces_whole_layout(client, auth_headers):
    client.put('/api/home/layout', json=LAYOUT, headers=auth_headers)
    smaller = {'groups': [{'name': '唯一', 'cards': [{'key': 'blog'}]}]}
    r = client.put('/api/home/layout', json=smaller, headers=auth_headers)
    assert r.status_code == 200
    data = r.json()['data']
    assert len(data['groups']) == 1
    assert data['groups'][0]['cards'] == [{'key': 'blog', 'title': None, 'desc': None}]
    # 旧组/旧卡无残留
    got = client.get('/api/home/layout', headers=auth_headers).json()['data']
    assert got == data


def test_delete_resets(client, auth_headers):
    client.put('/api/home/layout', json=LAYOUT, headers=auth_headers)
    r = client.delete('/api/home/layout', headers=auth_headers)
    assert r.status_code == 200
    assert '默认' in r.json()['message']
    assert client.get('/api/home/layout', headers=auth_headers).json()['data'] == {'groups': [], 'revision': 2}


def test_auth_required(client):
    assert client.get('/api/home/layout').status_code == 401
    assert client.put('/api/home/layout', json=LAYOUT).status_code == 401
    assert client.delete('/api/home/layout').status_code == 401


def test_validation_rejections(client, auth_headers):
    cases = [
        ({}, 'groups'),                                        # 空体
        ({'groups': []}, '非空'),                                # 空数组
        ({'groups': [{'name': '' , 'cards': []}]}, '名称'),      # 缺名
        ({'groups': [{'name': 'g', 'cards': None}]}, '数组'),    # cards 非数组
        ({'groups': [{'name': 'g', 'cards': [{'key': 'Blog'}]}]}, 'key'),   # 大写开头
        ({'groups': [{'name': 'g', 'cards': [{'key': '/blog'}]}]}, 'key'),  # 路径不是 key
        ({'groups': [{'name': 'g', 'cards': [{'key': 'blog'}, {'key': 'blog'}]}]}, '重复'),  # 跨组重复
        ({'groups': [{'name': 'a' * 65, 'cards': []}]}, '名称超长'),
        ({'groups': [{'name': 'g', 'cards': [{'key': 'blog', 'title': 'x' * 121}]}]}, '标题超长'),
        ({'groups': [{'name': 'g', 'cards': [{'key': 'blog', 'desc': 'x' * 301}]}]}, '描述超长'),
        ({'groups': [{'name': f'g{i}', 'cards': []} for i in range(21)]}, '上限'),
    ]
    for body, hint in cases:
        r = client.put('/api/home/layout', json=body, headers=auth_headers)
        assert r.status_code == 400, (hint, body, r.json())
        assert hint in r.json()['message'], (hint, r.json()['message'])


def test_put_survives_restart(client, auth_headers, app, tmp_path):
    """重启（新 app 实例）后布局仍在——确为库持久化而非进程态"""
    client.put('/api/home/layout', json=LAYOUT, headers=auth_headers)

    from app.main import create_app
    from fastapi.testclient import TestClient
    with TestClient(create_app()) as c:
        data = c.get('/api/home/layout', headers=auth_headers).json()['data']
        assert [g['name'] for g in data['groups']] == ['日常', '工具']
        assert data['groups'][0]['cards'][0]['title'] == '我的知识库'


# ─── 真实 PostgreSQL 往返（pgserver 可选）──────────────────


def test_pg_layout_roundtrip(client, auth_headers, tmp_path_factory, monkeypatch):
    """布局持久化到真实 PG：切换 → 新 app 在 PG 上建表 → PUT/GET 往返 → 重启仍在"""
    pgserver = pytest.importorskip('pgserver', reason='未安装 pgserver，跳过真实 PG 集成测试')
    from app.config import settings
    monkeypatch.setattr(settings, 'debug', False)   # 生产语义：switch 不 touch 重启戳

    server = pgserver.get_server(str(tmp_path_factory.mktemp('pgdata')))
    pg = {
        'host': '127.0.0.1',
        'port': int(server.get_uri().split(':')[3].split('/')[0]),
        'user': 'postgres',
        'password': '',
        'dbname': 'doublog_home_test',
    }
    try:
        r = client.post('/api/admin/database/switch', json={'target': 'postgres', 'postgres': pg},
                        headers=auth_headers)
        assert r.status_code == 200, r.json()

        from app.main import create_app
        from fastapi.testclient import TestClient
        pg_app = create_app()
        with TestClient(pg_app) as c:
            # 空库：建表 + 空布局
            assert c.get('/api/home/layout', headers=auth_headers).json()['data'] == {'groups': [], 'revision': 0}
            r = c.put('/api/home/layout', json=LAYOUT, headers=auth_headers)
            assert r.status_code == 200, r.json()

            # 再起一个 app（模拟重启）：布局仍在 PG
            with TestClient(create_app()) as c2:
                data = c2.get('/api/home/layout', headers=auth_headers).json()['data']
                assert [g['name'] for g in data['groups']] == ['日常', '工具']
                assert data['groups'][0]['cards'][0] == {
                    'key': 'blog', 'title': '我的知识库', 'desc': '文章与双链'}

            # 两张表确在 PG 上
            from app.db import db
            from sqlalchemy import inspect
            tables = set(inspect(db.engine).get_table_names())
            assert {'system_home_groups', 'system_home_cards'} <= tables
    finally:
        server.cleanup()
