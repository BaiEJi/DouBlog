"""
Posts API tests（与当前 API 契约对齐）

覆盖：创建/列表/树/详情/更新/移动/删除 + 本次优化的行为
- 列表与树接口不返回正文字段（#4/#5）
- 嵌套 slug 正确性与改名/移动后的级联更新（#7）
- 图片接口路径围栏与扩展名白名单（#1）
- gzip 压缩（#12）
"""
import json
import os


def _create(client, headers, title, name, content='body', parent_id=None, **extra):
    payload = {'title': title, 'name': name, 'content': content}
    if parent_id is not None:
        payload['parent_id'] = parent_id
    payload.update(extra)
    return client.post('/api/posts', json=payload, headers=headers)


# ─── 创建 ────────────────────────────────────────────────

def test_create_post_success(client, auth_headers):
    response = _create(client, auth_headers, 'Test Post', 'test-post')

    assert response.status_code == 201
    data = response.json()
    assert data['success'] is True
    assert data['data']['slug'] == '/test-post'
    assert data['data']['level'] == 0


def test_create_post_unauthorized(client):
    response = client.post('/api/posts', json={'title': 't', 'name': 'ttt'})

    assert response.status_code == 401


def test_create_post_missing_name(client, auth_headers):
    response = _create(client, auth_headers, 'No Name', '')

    assert response.status_code == 400
    assert '英文名不能为空' in response.json()['message']


def test_create_post_invalid_name(client, auth_headers):
    response = _create(client, auth_headers, 'Bad', '1abc')

    assert response.status_code == 400
    assert '格式无效' in response.json()['message']


def test_create_post_duplicate_name(client, auth_headers):
    _create(client, auth_headers, 'First', 'dup-name')
    response = _create(client, auth_headers, 'Second', 'dup-name')

    assert response.status_code == 400
    assert '已被使用' in response.json()['message']


def test_create_post_level_limit(client, auth_headers):
    """层级限制：最多 3 层（level 0/1/2）"""
    r1 = _create(client, auth_headers, 'L0', 'lvl-zero').json()['data']['id']
    r2 = _create(client, auth_headers, 'L1', 'lvl-one', parent_id=r1).json()['data']['id']
    r3 = _create(client, auth_headers, 'L2', 'lvl-two', parent_id=r2)
    assert r3.status_code == 201
    r3_id = r3.json()['data']['id']

    r4 = _create(client, auth_headers, 'L3', 'lvl-three', parent_id=r3_id)
    assert r4.status_code == 400
    assert '层级' in r4.json()['message']


# ─── 列表与树（#4/#5：不含正文）─────────────────────────

def test_list_excludes_content(client, auth_headers):
    _create(client, auth_headers, 'A', 'post-a', content='x' * 5000)
    _create(client, auth_headers, 'B', 'post-b', content='y' * 5000)

    response = client.get('/api/posts?page_size=10', headers=auth_headers)

    assert response.status_code == 200
    data = response.json()['data']
    assert data['total'] == 2
    for item in data['items']:
        assert 'content' not in item          # 正文不进入列表
        assert item['summary'] == ''          # 其他字段仍在
        assert item['slug'].startswith('/')


def test_tree_excludes_content_and_nests(client, auth_headers):
    p1 = _create(client, auth_headers, 'Java', 'java').json()['data']['id']
    _create(client, auth_headers, 'Java8', 'java8', parent_id=p1)

    response = client.get('/api/posts/tree', headers=auth_headers)

    assert response.status_code == 200
    tree = response.json()['data']
    assert len(tree) == 1
    root = tree[0]
    assert 'content' not in root                       # 正文不进入树
    assert root['name'] == 'java'
    assert len(root['children']) == 1
    assert root['children'][0]['slug'] == '/java/java8'


def test_pagination(client, auth_headers):
    for i in range(5):
        _create(client, auth_headers, f'P{i}', f'page-item-{i}')

    r = client.get('/api/posts?page=2&page_size=2', headers=auth_headers)
    data = r.json()['data']
    assert data['total'] == 5
    assert data['total_pages'] == 3
    assert len(data['items']) == 2


# ─── 全文搜索（keyword 覆盖正文）─────────────────────────

def test_keyword_searches_content(client, auth_headers):
    """关键词能命中正文（标题/摘要/英文名都不含该词）"""
    _create(client, auth_headers, '标题甲', 'kw-title-post',
            content='正文里藏着独角兽关键词', summary='摘要完全无关')
    _create(client, auth_headers, '标题乙', 'kw-other-post', content='另一篇的内容')

    r = client.get('/api/posts?keyword=独角兽', headers=auth_headers)
    items = r.json()['data']['items']
    assert [i['name'] for i in items] == ['kw-title-post']


def test_keyword_search_across_workspaces(client, auth_headers):
    """不带 workspace_id 的搜索跨知识库生效"""
    ws2 = client.post('/api/workspaces', json={'name': '搜索库'}, headers=auth_headers).json()['data']
    _create(client, auth_headers, '库一文', 'kw-ws-one', content='普通内容')
    client.post('/api/posts', json={
        'title': '库二文', 'name': 'kw-ws-two', 'content': '包含凤凰关键词', 'workspace_id': ws2['id'],
    }, headers=auth_headers)

    r = client.get('/api/posts?keyword=凤凰', headers=auth_headers)
    items = r.json()['data']['items']
    assert [i['name'] for i in items] == ['kw-ws-two']

    # 带库过滤时只在库内搜
    r = client.get('/api/posts?keyword=凤凰&workspace_id=1', headers=auth_headers)
    assert r.json()['data']['total'] == 0


# ─── 详情（含正文）──────────────────────────────────────

def test_detail_by_id_contains_content(client, auth_headers):
    pid = _create(client, auth_headers, 'Detail', 'detail-post', content='# hello').json()['data']['id']

    response = client.get(f'/api/posts/id/{pid}', headers=auth_headers)

    assert response.status_code == 200
    data = response.json()['data']
    assert data['content'] == '# hello'
    assert data['slug'] == '/detail-post'


def test_detail_by_slug(client, auth_headers):
    _create(client, auth_headers, 'By Slug', 'by-slug-post', content='c')

    response = client.get('/api/posts/slug/by-slug-post', headers=auth_headers)

    assert response.status_code == 200
    assert response.json()['data']['title'] == 'By Slug'


def test_detail_by_path(client, auth_headers):
    """/path/<完整路径>：按 slug 列精确匹配（回归：迁移期闭包变量误赋值曾致必现 500）"""
    p1 = _create(client, auth_headers, 'PathA', 'path-a').json()['data']['id']
    _create(client, auth_headers, 'PathB', 'path-b', parent_id=p1)

    response = client.get('/api/posts/path/path-a/path-b', headers=auth_headers)

    assert response.status_code == 200
    assert response.json()['data']['slug'] == '/path-a/path-b'
    # 无斜杠前缀同样命中（handler 内部补 /）
    assert client.get('/api/posts/path//path-a/path-b',
                      headers=auth_headers).status_code == 200
    assert client.get('/api/posts/path/no/such/path',
                      headers=auth_headers).status_code == 404


def test_detail_includes_children(client, auth_headers):
    pid = _create(client, auth_headers, 'Parent', 'parent-post').json()['data']['id']
    _create(client, auth_headers, 'Child', 'child-post', parent_id=pid)

    data = client.get(f'/api/posts/id/{pid}', headers=auth_headers).json()['data']

    assert len(data['children']) == 1
    assert data['children'][0]['slug'] == '/parent-post/child-post'


def test_detail_404(client, auth_headers):
    assert client.get('/api/posts/id/99999', headers=auth_headers).status_code == 404


def test_view_count_realtime_increment(client, auth_headers):
    """浏览计数实时写库：每次详情请求 +1"""
    pid = _create(client, auth_headers, 'Views', 'view-post').json()['data']['id']

    for expected in (1, 2, 3):
        data = client.get(f'/api/posts/id/{pid}', headers=auth_headers).json()['data']
        assert data['view_count'] == expected

    # 列表接口读到的是同一个（已提交的）计数
    lst = client.get('/api/posts?page_size=10', headers=auth_headers).json()['data']
    assert next(i for i in lst['items'] if i['id'] == pid)['view_count'] == 3


def test_view_count_no_view_param(client, auth_headers):
    """no_view=1（前端 hover 预取）不计浏览量"""
    pid = _create(client, auth_headers, 'NoView', 'noview-post').json()['data']['id']

    first = client.get(f'/api/posts/id/{pid}', headers=auth_headers).json()['data']
    assert first['view_count'] == 1

    for _ in range(3):
        data = client.get(f'/api/posts/id/{pid}?no_view=1', headers=auth_headers).json()['data']
        assert data['view_count'] == 1

    after = client.get(f'/api/posts/id/{pid}', headers=auth_headers).json()['data']
    assert after['view_count'] == 2


# ─── 更新 / 移动（#7：slug 级联）────────────────────────

def test_rename_cascades_descendant_slugs(client, auth_headers):
    p1 = _create(client, auth_headers, 'Old', 'old-name').json()['data']['id']
    _create(client, auth_headers, 'Child', 'child-of-old', parent_id=p1)

    response = client.put(f'/api/posts/id/{p1}', json={'name': 'new-name'}, headers=auth_headers)

    assert response.status_code == 200
    assert response.json()['data']['slug'] == '/new-name'

    child = client.get('/api/posts/slug/child-of-old', headers=auth_headers).json()['data']
    assert child['slug'] == '/new-name/child-of-old'


def test_move_updates_subtree_slugs(client, auth_headers):
    a = _create(client, auth_headers, 'A', 'dir-a').json()['data']['id']
    b = _create(client, auth_headers, 'B', 'dir-b').json()['data']['id']
    c = _create(client, auth_headers, 'C', 'child-c', parent_id=a).json()['data']['id']

    response = client.put(f'/api/posts/id/{c}', json={'parent_id': b}, headers=auth_headers)

    assert response.status_code == 200
    moved = client.get(f'/api/posts/id/{c}', headers=auth_headers).json()['data']
    assert moved['slug'] == '/dir-b/child-c'
    assert moved['level'] == 1


def test_move_rejects_self_parent(client, auth_headers):
    pid = _create(client, auth_headers, 'S', 'self-parent').json()['data']['id']

    response = client.put(f'/api/posts/id/{pid}', json={'parent_id': pid}, headers=auth_headers)

    assert response.status_code == 400


def test_move_rejects_descendant_parent(client, auth_headers):
    p1 = _create(client, auth_headers, 'Root', 'anc-root').json()['data']['id']
    p2 = _create(client, auth_headers, 'Sub', 'anc-sub', parent_id=p1).json()['data']['id']

    response = client.put(f'/api/posts/id/{p1}', json={'parent_id': p2}, headers=auth_headers)

    assert response.status_code == 400
    assert '子孙' in response.json()['message']


def test_update_content(client, auth_headers):
    pid = _create(client, auth_headers, 'Upd', 'upd-post', content='v1').json()['data']['id']

    client.put(f'/api/posts/id/{pid}', json={'content': 'v2'}, headers=auth_headers)

    data = client.get(f'/api/posts/id/{pid}', headers=auth_headers).json()['data']
    assert data['content'] == 'v2'


# ─── 删除 ────────────────────────────────────────────────

def test_delete_promotes_children(client, auth_headers):
    p1 = _create(client, auth_headers, 'Del', 'del-parent').json()['data']['id']
    _create(client, auth_headers, 'Kid', 'del-child', parent_id=p1)

    response = client.delete(f'/api/posts/id/{p1}', headers=auth_headers)

    assert response.status_code == 200
    promoted = client.get('/api/posts/slug/del-child', headers=auth_headers).json()['data']
    assert promoted['level'] == 0
    assert promoted['slug'] == '/del-child'


def test_delete_recursive(client, auth_headers):
    p1 = _create(client, auth_headers, 'RD', 'rec-parent').json()['data']['id']
    _create(client, auth_headers, 'RC', 'rec-child', parent_id=p1)

    response = client.delete(f'/api/posts/id/{p1}?recursive=1', headers=auth_headers)

    assert response.status_code == 200
    assert client.get('/api/posts/slug/rec-child', headers=auth_headers).status_code == 404


# ─── 图片接口（#1：路径围栏）────────────────────────────

def test_image_served_from_images_dir(client, auth_headers, app):
    from app.config import settings
    os.makedirs(settings.images_dir, exist_ok=True)
    path = os.path.join(settings.images_dir, 't.png')
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')

    response = client.get('/api/images/t.png', headers=auth_headers)

    assert response.status_code == 200
    assert response.content.startswith(b'\x89PNG')


def test_image_rejects_extension_outside_whitelist(client, auth_headers, app):
    from app.config import settings
    os.makedirs(settings.images_dir, exist_ok=True)
    with open(os.path.join(settings.images_dir, 'evil.exe'), 'wb') as f:
        f.write(b'MZ')

    response = client.get('/api/images/evil.exe', headers=auth_headers)

    assert response.status_code == 404


def test_image_rejects_path_traversal(client, auth_headers):
    for url in (
        '/api/images/?path=C:/Windows/win.ini&type=absolute',
        '/api/images/..%2F..%2F..%2FWindows%2Fwin.ini',
        '/api/images/?path=../../Windows/win.ini&type=relative',
    ):
        assert client.get(url, headers=auth_headers).status_code == 404, url


# ─── gzip 压缩（#12）────────────────────────────────────

def test_gzip_compression_for_large_json(client, auth_headers):
    import gzip as gz
    for i in range(3):
        _create(client, auth_headers, f'G{i}', f'gz-item-{i}', content='z' * 2000,
                summary='s' * 500)

    response = client.get('/api/posts?page_size=10',
                          headers={**auth_headers, 'Accept-Encoding': 'gzip'})

    assert response.headers.get('Content-Encoding') == 'gzip'
    # httpx 按响应头自动解压，content 即原始 JSON
    data = json.loads(response.content.decode('utf-8'))
    assert data['success'] is True
    assert data['data']['total'] == 3


def test_no_gzip_for_small_response(client, auth_headers):
    response = client.get('/health')

    assert response.headers.get('Content-Encoding') is None


# ─── 排序 ────────────────────────────────────────────────

def test_reorder_children(client, auth_headers):
    p = _create(client, auth_headers, 'R', 'reorder-parent').json()['data']['id']
    c1 = _create(client, auth_headers, 'C1', 'reorder-c1', parent_id=p).json()['data']['id']
    c2 = _create(client, auth_headers, 'C2', 'reorder-c2', parent_id=p).json()['data']['id']

    response = client.put('/api/posts/reorder',
                          json={'parent_id': p, 'children_order': [c2, c1]},
                          headers=auth_headers)

    assert response.status_code == 200
    tree = client.get('/api/posts/tree', headers=auth_headers).json()['data']
    parent_node = next(n for n in tree if n['id'] == p)
    assert [c['id'] for c in parent_node['children']] == [c2, c1]
