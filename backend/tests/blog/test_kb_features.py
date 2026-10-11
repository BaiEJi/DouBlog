"""
知识库新功能测试：图片上传 / 最近浏览 / 双链反链 / Markdown 导出
"""
import io
import os
import zipfile

PNG_1PX = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000d4944415478da63fcffff3f030005fe02fea72d99480000000049454e44ae426082'
)


def _create(client, headers, title, name, content='', parent_id=None, ws=None):
    payload = {'title': title, 'name': name, 'content': content or f'# {title}'}
    if parent_id is not None:
        payload['parent_id'] = parent_id
    if ws is not None:
        payload['workspace_id'] = ws
    r = client.post('/api/posts', json=payload, headers=headers)
    assert r.status_code in (200, 201), r.json()
    return r.json()['data']['id']


# ─── 图片上传 ────────────────────────────────────────────

def test_upload_image_success(client, auth_headers):
    r = client.post('/api/images/upload',
                    files={'file': ('shot.png', io.BytesIO(PNG_1PX), 'image/png')},
                    headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['url'].startswith('/api/images/')
    assert d['url'].endswith('.png')

    # 上传后能通过 URL 取回
    g = client.get(d['url'], headers=auth_headers)
    assert g.status_code == 200
    assert g.content == PNG_1PX


def test_upload_image_rejects_bad_extension(client, auth_headers):
    r = client.post('/api/images/upload',
                    files={'file': ('evil.svg', io.BytesIO(b'<svg/>'), 'image/svg+xml')},
                    headers=auth_headers)
    assert r.status_code == 400


def test_upload_image_requires_auth(client):
    r = client.post('/api/images/upload',
                    files={'file': ('x.png', io.BytesIO(PNG_1PX), 'image/png')})
    assert r.status_code == 401


def test_upload_image_empty(client, auth_headers):
    r = client.post('/api/images/upload',
                    files={'file': ('x.png', io.BytesIO(b''), 'image/png')},
                    headers=auth_headers)
    assert r.status_code == 400


# ─── 最近浏览 ────────────────────────────────────────────

def test_recent_posts_order_and_no_view(client, auth_headers):
    a = _create(client, auth_headers, 'A', 'recent-a')
    b = _create(client, auth_headers, 'B', 'recent-b')

    # 访问 A、B、A：最近顺序应为 A、B
    client.get(f'/api/posts/id/{a}', headers=auth_headers)
    client.get(f'/api/posts/id/{b}', headers=auth_headers)
    client.get(f'/api/posts/id/{a}', headers=auth_headers)

    r = client.get('/api/posts/recent', headers=auth_headers)
    assert r.status_code == 200
    items = r.json()['data']
    ids = [i['id'] for i in items]
    assert ids[:2] == [a, b]
    assert all('workspace_name' in i and 'title' in i for i in items)
    assert all('content' not in i for i in items)

    # no_view 预取不进最近列表
    c = _create(client, auth_headers, 'C', 'recent-c')
    client.get(f'/api/posts/id/{c}?no_view=1', headers=auth_headers)
    r = client.get('/api/posts/recent', headers=auth_headers)
    assert c not in [i['id'] for i in r.json()['data']]


def test_recent_posts_limit(client, auth_headers):
    for i in range(5):
        pid = _create(client, auth_headers, f'T{i}', f'recent-l{i}')
        client.get(f'/api/posts/id/{pid}', headers=auth_headers)
    r = client.get('/api/posts/recent?limit=3', headers=auth_headers)
    assert len(r.json()['data']) == 3


# ─── 双链反链 ────────────────────────────────────────────

def test_backlinks_by_name_and_title(client, auth_headers):
    target = _create(client, auth_headers, '目标文章', 'target-post', '# 目标')
    _create(client, auth_headers, '按名链', 'link-by-name',
            '看 [[target-post]] 与 [[target-post|显示名]]')
    _create(client, auth_headers, '按标题链', 'link-by-title',
            '看 [[目标文章]]')
    _create(client, auth_headers, '无关', 'no-link', '没有链接 [[别的]]')

    r = client.get(f'/api/posts/id/{target}/backlinks', headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    titles = {i['title'] for i in d['items']}
    assert titles == {'按名链', '按标题链'}
    assert d['total'] == 2


def test_backlinks_workspace_scoped(client, auth_headers):
    # 建两个库，跨库同名文章不互链
    r = client.post('/api/workspaces', json={'name': 'kb-one'}, headers=auth_headers)
    ws_a = r.json()['data']['id']
    r = client.post('/api/workspaces', json={'name': 'kb-two'}, headers=auth_headers)
    ws_b = r.json()['data']['id']

    target = _create(client, auth_headers, '目标', 'same-name', ws=ws_a)
    _create(client, auth_headers, '同库链', 'in-ws-a', '[[same-name]]', ws=ws_a)
    _create(client, auth_headers, '异库链', 'in-ws-b', '[[same-name]]', ws=ws_b)

    r = client.get(f'/api/posts/id/{target}/backlinks', headers=auth_headers)
    titles = {i['title'] for i in r.json()['data']['items']}
    assert titles == {'同库链'}


def test_backlinks_404(client, auth_headers):
    r = client.get('/api/posts/id/99999/backlinks', headers=auth_headers)
    assert r.status_code == 404


# ─── Markdown 导出 ───────────────────────────────────────

def test_export_markdown_structure(client, auth_headers, app):
    from app.config import settings

    # 顶层文章（带子文章）+ 独立文章
    parent = _create(client, auth_headers, '父文章', 'parent-post',
                     '内容 ![图](/api/images/abc.png) [[child-post]]')
    _create(client, auth_headers, '子文章', 'child-post', '子内容', parent_id=parent)
    _create(client, auth_headers, '独立', 'solo-post', '单独一篇')

    # 图片目录放一个文件
    os.makedirs(settings.images_dir, exist_ok=True)
    with open(os.path.join(settings.images_dir, 'abc.png'), 'wb') as f:
        f.write(PNG_1PX)

    r = client.get('/api/export/markdown', headers=auth_headers)
    assert r.status_code == 200
    assert r.headers['content-type'].split(';')[0] == 'application/zip'

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())

    ws_dir = None
    for n in names:
        if n.endswith('/parent-post/index.md'):
            ws_dir = n.split('/')[0]
    assert ws_dir, names

    assert f'{ws_dir}/parent-post/index.md' in names
    assert f'{ws_dir}/parent-post/child-post.md' in names
    assert f'{ws_dir}/solo-post.md' in names
    assert 'images/abc.png' in names

    # frontmatter + 图片 URL 重写 + 双链原样保留
    idx = zf.read(f'{ws_dir}/parent-post/index.md').decode('utf-8')
    assert idx.startswith('---\n')
    assert 'title: "父文章"' in idx
    assert 'name: parent-post' in idx
    assert '../images/abc.png' in idx          # 深度 1 → 前缀 ../
    assert '[[child-post]]' in idx             # 双链保持源码

    solo = zf.read(f'{ws_dir}/solo-post.md').decode('utf-8')
    assert solo.startswith('---\n')

    # 图片内容一致
    assert zf.read('images/abc.png') == PNG_1PX


def test_export_requires_auth(client):
    assert client.get('/api/export/markdown').status_code == 401
