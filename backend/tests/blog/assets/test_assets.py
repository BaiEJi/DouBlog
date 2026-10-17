"""
资产库（assets：Prompt 与 Skill）测试：分类/资产 CRUD 与校验、列表过滤与排序、
版本快照与恢复、软删/恢复/彻底删除、复制、使用统计、批量操作、标签聚合、
统计口径、导出（全量/单条 md·json）、导入（create/upsert/dry_run/分类自动建/
错误收集/历史版本导入）、认证。
"""
import base64

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()}


def _item(client, title='测试资产', content='内容 {{var1}} 与 {{var2}}', kind='prompt',
          headers=AUTH, **kw):
    payload = {'kind': kind, 'title': title, 'content': content}
    payload.update(kw)
    r = client.post('/api/assets/items', json=payload, headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _cat(client, name='写作', headers=AUTH, **kw):
    payload = {'name': name}
    payload.update(kw)
    r = client.post('/api/assets/categories', json=payload, headers=headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


# ─── 认证 ─────────────────────────────────────────────

def test_auth_required(client):
    for method, path in [('get', '/api/assets/items'), ('get', '/api/assets/categories'),
                         ('get', '/api/assets/stats'), ('post', '/api/assets/items')]:
        r = getattr(client, method)(path, **({'json': {}} if method == 'post' else {}))
        assert r.status_code == 401


# ─── 分类 ─────────────────────────────────────────────

def test_category_crud(client, auth_headers):
    cat = _cat(client, '编程', icon='💻', color='#7c3aed', kind='prompt')
    assert cat['name'] == '编程' and cat['icon'] == '💻'
    assert cat['color'] == '#7c3aed' and cat['kind'] == 'prompt'

    r = client.get('/api/assets/categories', headers=AUTH)
    names = [c['name'] for c in r.json()['data']]
    assert '编程' in names and '未分类' in names

    r = client.put(f"/api/assets/categories/{cat['id']}",
                   json={'name': '开发', 'kind': 'skill'}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data']['name'] == '开发' and r.json()['data']['kind'] == 'skill'

    r = client.delete(f"/api/assets/categories/{cat['id']}", headers=AUTH)
    assert r.status_code == 200


def test_category_name_unique(client, auth_headers):
    _cat(client, '重复名')
    r = client.post('/api/assets/categories', json={'name': '重复名'}, headers=AUTH)
    assert r.status_code == 409

    cat = _cat(client, '另一个')
    r = client.put(f"/api/assets/categories/{cat['id']}", json={'name': '重复名'}, headers=AUTH)
    assert r.status_code == 409
    # 改成自己的名字不算冲突
    r = client.put(f"/api/assets/categories/{cat['id']}", json={'name': '另一个'}, headers=AUTH)
    assert r.status_code == 200


def test_category_validation(client, auth_headers):
    r = client.post('/api/assets/categories', json={'name': ''}, headers=AUTH)
    assert r.status_code == 400
    r = client.post('/api/assets/categories', json={'name': 'x' * 51}, headers=AUTH)
    assert r.status_code == 400
    r = client.post('/api/assets/categories', json={'name': 'x', 'kind': 'bad'}, headers=AUTH)
    assert r.status_code == 400
    r = client.post('/api/assets/categories', json={'name': 'x', 'sort_order': 'a'}, headers=AUTH)
    assert r.status_code == 400
    r = client.put('/api/assets/categories/9999', json={'name': 'y'}, headers=AUTH)
    assert r.status_code == 404


def test_category_delete_guard_and_counts(client, auth_headers):
    cat = _cat(client, '有货')
    _item(client, '挂在分类下', category_id=cat['id'])
    r = client.delete(f"/api/assets/categories/{cat['id']}", headers=AUTH)
    assert r.status_code == 409

    r = client.get('/api/assets/categories', headers=AUTH)
    by_name = {c['name']: c for c in r.json()['data']}
    assert by_name['有货']['item_count'] == 1
    assert by_name['有货']['prompt_count'] == 1
    assert by_name['未分类']['item_count'] == 0


# ─── 资产创建 / 校验 ─────────────────────────────────

def test_item_create_and_variables(client, auth_headers):
    item = _item(client, '变量提取', '你好 {{name}}，路径 {{ path }}，重复 {{name}}',
                 tags=['a', 'a', ' b ', ''], summary=' 摘要 ')
    assert item['variables'] == ['name', 'path']       # 去重 + 保序 + 容忍空白
    assert item['tags'] == ['a', 'b']                   # 去重 + 去空白
    assert item['summary'] == '摘要'
    assert item['version'] == 1
    assert item['status'] == 'active' and item['favorite'] is False

    vers = client.get(f"/api/assets/items/{item['id']}/versions", headers=AUTH).json()['data']
    assert len(vers) == 1 and vers[0]['version'] == 1
    assert vers[0]['note'] == '初始版本'


def test_item_create_validation(client, auth_headers):
    for payload in [
        {'title': '无 kind'},                                   # 缺 kind
        {'kind': 'prompt'},                                     # 缺标题
        {'kind': 'prompt', 'title': ''},                        # 空标题
        {'kind': 'prompt', 'title': 'x'},                       # 缺正文
        {'kind': 'prompt', 'title': 'x', 'content': '  '},      # 空白正文
        {'kind': 'bad', 'title': 'x', 'content': 'y'},          # 非法 kind
        {'kind': 'prompt', 'title': 'x' * 201, 'content': 'y'}, # 标题超长
        {'kind': 'prompt', 'title': 'x', 'content': 'y', 'tags': 'not-list'},
        {'kind': 'prompt', 'title': 'x', 'content': 'y', 'tags': ['x' * 33]},
        {'kind': 'prompt', 'title': 'x', 'content': 'y', 'tags': [f't{i}' for i in range(21)]},
        {'kind': 'prompt', 'title': 'x', 'content': 'y', 'tags': ['a"b']},
        {'kind': 'prompt', 'title': 'x', 'content': 'y', 'summary': 's' * 501},
    ]:
        r = client.post('/api/assets/items', json=payload, headers=AUTH)
        assert r.status_code == 400, (payload, r.json())
    # 分类不存在 → 404
    r = client.post('/api/assets/items',
                    json={'kind': 'prompt', 'title': 'x', 'content': 'y', 'category_id': 999},
                    headers=AUTH)
    assert r.status_code == 404


def test_item_get_detail(client, auth_headers):
    item = _item(client)
    r = client.get(f"/api/assets/items/{item['id']}", headers=AUTH)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['content'] == '内容 {{var1}} 与 {{var2}}'
    assert d['versions_count'] == 1
    r = client.get('/api/assets/items/99999', headers=AUTH)
    assert r.status_code == 404


# ─── 列表过滤 / 排序 / 分页 ───────────────────────────

def test_list_filters(client, auth_headers):
    cat = _cat(client, '检索分类')
    a = _item(client, 'Alpha 提示词', 'unique-alpha-content', kind='prompt',
              category_id=cat['id'], tags=['t1', 't2'])
    b = _item(client, 'Beta 技能', 'common', kind='skill', tags=['t2'], favorite=True)
    _item(client, 'Gamma', 'common', kind='prompt')

    def _titles(**params):
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        r = client.get(f'/api/assets/items?{qs}', headers=AUTH)
        assert r.status_code == 200, r.json()
        return [i['title'] for i in r.json()['data']['items']]

    assert _titles() == ['Gamma', 'Beta 技能', 'Alpha 提示词']   # updated_desc 默认
    assert _titles(kind='skill') == ['Beta 技能']
    assert _titles(category_id=cat['id']) == ['Alpha 提示词']
    assert _titles(category_id='none') == ['Gamma', 'Beta 技能']
    assert _titles(tag='t1') == ['Alpha 提示词']
    assert _titles(tag='t2') == ['Beta 技能', 'Alpha 提示词']
    assert _titles(favorite=1) == ['Beta 技能']
    assert _titles(q='unique-alpha') == ['Alpha 提示词']          # 命中正文
    assert _titles(q='Alpha') == ['Alpha 提示词']
    assert _titles(q='提示词') == ['Alpha 提示词']

    # LIKE 通配符转义：内容里真有 % 的才能被 % 搜到
    _item(client, '百分号', 'a%b')
    assert _titles(q='%') == ['百分号']
    assert _titles(q='a%b') == ['百分号']

    # 列表不含正文
    r = client.get('/api/assets/items', headers=AUTH)
    assert all('content' not in i for i in r.json()['data']['items'])


def test_list_invalid_params(client, auth_headers):
    assert client.get('/api/assets/items?kind=bad', headers=AUTH).status_code == 400
    assert client.get('/api/assets/items?status=bad', headers=AUTH).status_code == 400
    assert client.get('/api/assets/items?sort=bad', headers=AUTH).status_code == 400
    assert client.get('/api/assets/items?category_id=abc', headers=AUTH).status_code == 400
    assert client.get('/api/assets/items?category_id=999', headers=AUTH).status_code == 404


def test_list_sort_and_pagination(client, auth_headers):
    for i in range(5):
        _item(client, f'条目{i:02d}')
    r = client.get('/api/assets/items?sort=title_asc', headers=AUTH)
    titles = [i['title'] for i in r.json()['data']['items']]
    assert titles == sorted(titles)

    r = client.get('/api/assets/items?page=2&page_size=2&sort=title_asc', headers=AUTH)
    d = r.json()['data']
    assert d['total'] == 5 and d['page'] == 2 and d['page_size'] == 2
    assert len(d['items']) == 2

    # 超范围页返回空列表而不是报错
    r = client.get('/api/assets/items?page=99', headers=AUTH)
    assert r.json()['data']['items'] == []

    # usage / last_used 排序（先用一次）
    first = _item(client, '用过的')
    client.post(f"/api/assets/items/{first['id']}/use", json={'action': 'copy'}, headers=AUTH)
    r = client.get('/api/assets/items?sort=usage_desc', headers=AUTH)
    assert r.json()['data']['items'][0]['title'] == '用过的'
    r = client.get('/api/assets/items?sort=last_used_desc', headers=AUTH)
    assert r.json()['data']['items'][0]['title'] == '用过的'


# ─── 更新 / 版本策略 ─────────────────────────────────

def test_update_version_policy(client, auth_headers):
    item = _item(client, '原标题', '原内容')
    iid = item['id']

    # 元数据变更：不产生版本
    r = client.put(f'/api/assets/items/{iid}', json={'favorite': True}, headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['version'] == 1
    r = client.put(f'/api/assets/items/{iid}', json={'tags': ['x']}, headers=AUTH)
    assert r.json()['data']['version'] == 1

    # 内容变更：产生版本 + 变量重提取
    r = client.put(f'/api/assets/items/{iid}',
                   json={'content': '新内容 {{only_one}}', 'version_note': '改写'},
                   headers=AUTH)
    assert r.json()['data']['version'] == 2
    assert r.json()['data']['variables'] == ['only_one']

    # 相同内容再保存：不产生新版本
    r = client.put(f'/api/assets/items/{iid}', json={'content': '新内容 {{only_one}}'},
                   headers=AUTH)
    assert r.json()['data']['version'] == 2

    vers = client.get(f'/api/assets/items/{iid}/versions', headers=AUTH).json()['data']
    assert [v['version'] for v in vers] == [2, 1]
    assert vers[0]['note'] == '改写'

    # favorite 类型校验
    r = client.put(f'/api/assets/items/{iid}', json={'favorite': 'yes'}, headers=AUTH)
    assert r.status_code == 400


def test_update_category_and_validation(client, auth_headers):
    cat = _cat(client, '目标')
    item = _item(client)
    r = client.put(f"/api/assets/items/{item['id']}",
                   json={'category_id': cat['id']}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data']['category'] == '目标'
    # 移回未分类
    r = client.put(f"/api/assets/items/{item['id']}", json={'category_id': None}, headers=AUTH)
    assert r.json()['data']['category_id'] is None
    r = client.put(f"/api/assets/items/{item['id']}", json={'category_id': 999}, headers=AUTH)
    assert r.status_code == 404
    r = client.put('/api/assets/items/99999', json={'title': 'x'}, headers=AUTH)
    assert r.status_code == 404


# ─── 删除 / 恢复 / 回收站 ────────────────────────────

def test_delete_soft_hard_restore(client, auth_headers):
    item = _item(client, '待删')
    iid = item['id']
    client.post(f'/api/assets/items/{iid}/use', json={'action': 'copy'}, headers=AUTH)

    # 软删 → 回收站，默认列表不可见
    r = client.delete(f'/api/assets/items/{iid}', headers=AUTH)
    assert r.status_code == 200 and '回收站' in r.json()['message']
    assert client.get(f'/api/assets/items/{iid}', headers=AUTH).status_code == 200   # 仍可取
    r = client.get('/api/assets/items', headers=AUTH)
    assert all(i['id'] != iid for i in r.json()['data']['items'])
    r = client.get('/api/assets/items?status=trash', headers=AUTH)
    assert [i['id'] for i in r.json()['data']['items']] == [iid]

    # 回收站内不可编辑 / 使用
    r = client.put(f'/api/assets/items/{iid}', json={'title': '改'}, headers=AUTH)
    assert r.status_code == 409
    r = client.post(f'/api/assets/items/{iid}/use', json={}, headers=AUTH)
    assert r.status_code == 409

    # 恢复 → active
    r = client.post(f'/api/assets/items/{iid}/restore', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['status'] == 'active'
    r = client.post(f'/api/assets/items/{iid}/restore', headers=AUTH)
    assert r.status_code == 409                                  # 已在库中

    # 彻底删除 → 404 + 版本/日志级联
    client.delete(f'/api/assets/items/{iid}?hard=1', headers=AUTH)
    assert client.get(f'/api/assets/items/{iid}', headers=AUTH).status_code == 404
    assert client.get(f'/api/assets/items/{iid}/versions', headers=AUTH).status_code == 404


# ─── 复制 ─────────────────────────────────────────────

def test_duplicate(client, auth_headers):
    src = _item(client, '原件', tags=['t'])
    r = client.post(f"/api/assets/items/{src['id']}/duplicate", headers=AUTH)
    assert r.status_code == 201
    copy = r.json()['data']
    assert copy['title'] == '原件（副本）'                        # 撞名自动加后缀
    assert copy['content'] == src['content']
    assert copy['tags'] == ['t'] and copy['favorite'] is False
    assert copy['version'] == 1
    assert copy['usage_count'] == 0                              # 使用计数不复制的原始语义：归零
    vers = client.get(f"/api/assets/items/{copy['id']}/versions", headers=AUTH).json()['data']
    assert vers[0]['note'] == f"复制自 #{src['id']}"


# ─── 使用统计 ─────────────────────────────────────────

def test_use_actions(client, auth_headers):
    item = _item(client)
    iid = item['id']
    for action in ('copy', 'fill', 'export'):
        r = client.post(f'/api/assets/items/{iid}/use', json={'action': action}, headers=AUTH)
        assert r.status_code == 200
        assert r.json()['data']['content'] == item['content']     # 返回最新正文供复制
    r = client.post(f'/api/assets/items/{iid}/use', json={'action': 'bad'}, headers=AUTH)
    assert r.status_code == 400
    r = client.get(f'/api/assets/items/{iid}', headers=AUTH)
    assert r.json()['data']['usage_count'] == 3
    assert r.json()['data']['last_used_at'] is not None


# ─── 批量操作 ─────────────────────────────────────────

def test_bulk_actions(client, auth_headers):
    cat = _cat(client, '批量目标')
    ids = [_item(client, f'批量{i}')['id'] for i in range(4)]

    def bulk(action, **kw):
        payload = {'ids': ids, 'action': action}
        payload.update(kw)
        return client.post('/api/assets/items/bulk', json=payload, headers=AUTH)

    assert bulk('favorite').json()['data']['affected'] == 4
    assert bulk('move', category_id=cat['id']).status_code == 200
    assert bulk('archive').status_code == 200
    r = client.get('/api/assets/items?status=archived', headers=AUTH)
    assert r.json()['data']['total'] == 4
    assert bulk('unarchive').status_code == 200
    assert bulk('trash').status_code == 200
    assert bulk('restore').status_code == 200

    assert bulk('bad').status_code == 400
    assert client.post('/api/assets/items/bulk', json={'ids': [], 'action': 'favorite'},
                       headers=AUTH).status_code == 400
    assert client.post('/api/assets/items/bulk', json={'ids': ids},
                       headers=AUTH).status_code == 400

    assert bulk('hard_delete').json()['data']['affected'] == 4
    assert client.get('/api/assets/items?status=all', headers=AUTH).json()['data']['total'] == 0


# ─── 版本恢复 ─────────────────────────────────────────

def test_version_restore(client, auth_headers):
    item = _item(client, 'T1', 'C1')
    iid = item['id']
    client.put(f'/api/assets/items/{iid}', json={'title': 'T2', 'content': 'C2'}, headers=AUTH)
    vers = client.get(f'/api/assets/items/{iid}/versions', headers=AUTH).json()['data']
    assert [v['version'] for v in vers] == [2, 1]

    v1_id = vers[-1]['id']
    detail = client.get(f'/api/assets/versions/{v1_id}', headers=AUTH).json()['data']
    assert detail['content'] == 'C1' and detail['title'] == 'T1'

    # 恢复 v1 → 产生 v3（内容回到 T1/C1）
    r = client.post(f'/api/assets/items/{iid}/versions/{v1_id}/restore', headers=AUTH)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['version'] == 3 and d['title'] == 'T1' and d['content'] == 'C1'

    # 恢复「当前版本」被拒
    vers = client.get(f'/api/assets/items/{iid}/versions', headers=AUTH).json()['data']
    current = vers[0]
    r = client.post(f'/api/assets/items/{iid}/versions/{current["id"]}/restore', headers=AUTH)
    assert r.status_code == 409

    # 跨资产版本 / 不存在
    other = _item(client, '另一个')
    r = client.post(f'/api/assets/items/{other["id"]}/versions/{v1_id}/restore', headers=AUTH)
    assert r.status_code == 404
    assert client.get('/api/assets/versions/99999', headers=AUTH).status_code == 404


# ─── 标签聚合 ─────────────────────────────────────────

def test_tags_aggregation(client, auth_headers):
    _item(client, 'A', tags=['x', 'y'])
    _item(client, 'B', tags=['y'])
    doomed = _item(client, 'C', tags=['y', 'z'])
    client.delete(f"/api/assets/items/{doomed['id']}", headers=AUTH)

    tags = client.get('/api/assets/tags', headers=AUTH).json()['data']
    counts = {t['tag']: t['count'] for t in tags}
    assert counts == {'y': 2, 'x': 1}                             # 回收站不计


# ─── 统计 ─────────────────────────────────────────────

def test_stats(client, auth_headers):
    cat = _cat(client, '统计分类')
    a = _item(client, 'P1', kind='prompt', category_id=cat['id'], tags=['s'])
    b = _item(client, 'S1', kind='skill', favorite=True)
    client.post(f'/api/assets/items/{a["id"]}/use', json={'action': 'copy'}, headers=AUTH)
    client.post(f'/api/assets/items/{a["id"]}/use', json={'action': 'fill'}, headers=AUTH)
    client.put(f'/api/assets/items/{b["id"]}', json={'title': 'S1', 'content': 'v2'}, headers=AUTH)
    client.delete(f'/api/assets/items/{_item(client, "垃圾")["id"]}', headers=AUTH)

    s = client.get('/api/assets/stats', headers=AUTH).json()['data']
    t = s['totals']
    assert t['prompts'] == 1 and t['skills'] == 1        # 垃圾项（prompt）已入回收站不计
    assert t['trash'] == 1 and t['favorites'] == 1
    assert t['categories'] == 1 and t['tags'] == 1
    assert t['versions'] == 4 and t['total_usage'] == 2  # a1 + b2 + 垃圾1（版本含回收站资产）

    by_name = {c['name']: c for c in s['by_category']}
    assert by_name['统计分类']['prompt_count'] == 1
    assert by_name['未分类']['skill_count'] == 1

    assert s['top_used'][0]['title'] == 'P1'
    assert s['top_used'][0]['usage_count'] == 2
    assert s['recent_used'][0]['id'] == a['id']
    assert len(s['usage_trend']) == 30
    assert sum(d['count'] for d in s['usage_trend']) == 2        # 今日两次使用


# ─── 导出 ─────────────────────────────────────────────

def test_export_all_and_filtered(client, auth_headers):
    cat = _cat(client, '导出分类')
    _item(client, 'P1', kind='prompt', category_id=cat['id'], tags=['e'])
    _item(client, 'S1', kind='skill')
    trashed = _item(client, '垃圾')
    client.delete(f'/api/assets/items/{trashed["id"]}', headers=AUTH)

    r = client.get('/api/assets/export', headers=AUTH)
    assert r.status_code == 200
    assert 'attachment' in r.headers.get('content-disposition', '')
    body = r.json()
    assert body['generator'] == 'doulog-assets' and body['count'] == 2
    titles = [i['title'] for i in body['items']]
    assert titles == ['P1', 'S1']                                # 回收站默认排除
    assert body['items'][0]['content']                           # 含正文
    assert body['items'][0]['category'] == '导出分类'

    r = client.get('/api/assets/export?kind=skill', headers=AUTH)
    assert r.json()['count'] == 1

    r = client.get('/api/assets/export?category_id=999', headers=AUTH)
    assert r.json()['count'] == 0

    # 带版本导出
    item = _item(client, '多版本')
    client.put(f'/api/assets/items/{item["id"]}', json={'content': 'v2'}, headers=AUTH)
    r = client.get('/api/assets/export?include_versions=1&kind=prompt&q=多版本', headers=AUTH)
    exported = r.json()['items'][0]
    assert [v['version'] for v in exported['versions']] == [1, 2]

    assert client.get('/api/assets/export?kind=bad', headers=AUTH).status_code == 400


def test_export_single_item(client, auth_headers):
    item = _item(client, '单导出', '正文内容', kind='skill', tags=['t'])
    r = client.get(f'/api/assets/items/{item["id"]}/export?format=md', headers=AUTH)
    assert r.status_code == 200
    assert 'text/markdown' in r.headers['content-type']
    text = r.text
    assert text.startswith('---')
    assert '"title": "单导出"' in text and '"kind": "skill"' in text
    assert '正文内容' in text

    r = client.get(f'/api/assets/items/{item["id"]}/export?format=json', headers=AUTH)
    assert r.json()['title'] == '单导出' and r.json()['content'] == '正文内容'

    assert client.get(f'/api/assets/items/{item["id"]}/export?format=pdf',
                      headers=AUTH).status_code == 400


# ─── 导入 ─────────────────────────────────────────────

def test_import_upsert_and_create(client, auth_headers):
    payload = {'items': [
        {'kind': 'prompt', 'title': '导入A', 'content': '内容A', 'tags': ['i'],
         'category': '导入分类'},
        {'title': '导入B', 'content': '内容B'},                   # 最小格式，默认 prompt
        {'title': '', 'content': '坏条目'},                       # 无标题 → 进 errors
    ]}
    r = client.post('/api/assets/import', json=payload, headers=AUTH)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['created'] == 2 and len(d['errors']) == 1
    assert d['errors'][0]['index'] == 2
    assert d['categories_created'] == ['导入分类']

    cats = {c['name'] for c in client.get('/api/assets/categories', headers=AUTH).json()['data']}
    assert '导入分类' in cats

    # upsert：同 kind+title 更新而非新建
    r = client.post('/api/assets/import', json={'items': [
        {'kind': 'prompt', 'title': '导入A', 'content': '内容A-v2'}]}, headers=AUTH)
    d = r.json()['data']
    assert d['created'] == 0 and d['updated'] == 1
    r = client.get('/api/assets/items?q=导入A', headers=AUTH)
    item = r.json()['data']['items'][0]
    detail = client.get(f'/api/assets/items/{item["id"]}', headers=AUTH).json()['data']
    assert detail['content'] == '内容A-v2' and detail['version'] == 2

    # create 模式：总是新建
    r = client.post('/api/assets/import', json={'items': [
        {'title': '导入A', 'content': '再来一份'}], 'mode': 'create'}, headers=AUTH)
    assert r.json()['data']['created'] == 1
    r = client.get('/api/assets/items?q=导入A', headers=AUTH)
    assert r.json()['data']['total'] == 2


def test_import_dry_run(client, auth_headers):
    _item(client, '既有', content='v1')
    r = client.post('/api/assets/import', json={
        'items': [
            {'title': '既有', 'content': 'v2'},
            {'title': '全新', 'content': 'n', 'category': '预检分类'},
        ], 'dry_run': True}, headers=AUTH)
    d = r.json()['data']
    assert d['dry_run'] is True and d['created'] == 0 and d['updated'] == 0
    assert d['valid'] == 2 and d['categories_created'] == ['预检分类']
    assert '预检' in r.json()['message']

    # dry_run 不落库
    r = client.get('/api/assets/items?q=全新', headers=AUTH)
    assert r.json()['data']['total'] == 0
    cats = {c['name'] for c in client.get('/api/assets/categories', headers=AUTH).json()['data']}
    assert '预检分类' not in cats
    detail = client.get('/api/assets/items?q=既有', headers=AUTH).json()['data']['items'][0]
    assert detail['version'] == 1


def test_import_with_versions(client, auth_headers):
    r = client.post('/api/assets/import', json={'items': [{
        'title': '带历史', 'content': '当前内容',
        'versions': [
            {'version': 1, 'title': '带历史', 'content': '第一版'},
            {'version': 2, 'title': '带历史', 'content': '第二版'},
        ],
    }]}, headers=AUTH)
    assert r.status_code == 200
    item = client.get('/api/assets/items?q=带历史', headers=AUTH).json()['data']['items'][0]
    detail = client.get(f'/api/assets/items/{item["id"]}', headers=AUTH).json()['data']
    assert detail['content'] == '当前内容'
    assert detail['version'] == 3                                  # 2 历史 + 当前
    vers = client.get(f'/api/assets/items/{item["id"]}/versions', headers=AUTH).json()['data']
    assert [v['version'] for v in vers] == [3, 2, 1]
    oldest = client.get(f'/api/assets/versions/{vers[-1]["id"]}', headers=AUTH).json()['data']
    assert oldest['content'] == '第一版'


def test_import_invalid_payload(client, auth_headers):
    assert client.post('/api/assets/import', json={}, headers=AUTH).status_code == 400
    assert client.post('/api/assets/import', json={'items': []}, headers=AUTH).status_code == 400
    assert client.post('/api/assets/import',
                       json={'items': [{'title': 'x'}], 'mode': 'bad'},
                       headers=AUTH).status_code == 400
    assert client.post('/api/assets/import',
                       json={'items': [{'t': i} for i in range(501)]},
                       headers=AUTH).status_code == 400
    # 单条字段非法 → 不阻断整体，进 errors 清单（200）
    r = client.post('/api/assets/import',
                    json={'items': [{'title': 'x', 'content': 'y', 'usage_count': -1},
                                    {'title': 'ok', 'content': 'fine'}]},
                    headers=AUTH)
    d = r.json()['data']
    assert r.status_code == 200
    assert d['created'] == 1 and len(d['errors']) == 1
    assert 'usage_count' in d['errors'][0]['error']


def test_import_export_roundtrip(client, auth_headers):
    _item(client, '往返', content='内容 {{v}}', tags=['r'], favorite=True)
    exported = client.get('/api/assets/export?include_versions=1', headers=AUTH).json()
    # 清空后回导
    for i in client.get('/api/assets/items?status=all&page_size=100',
                        headers=AUTH).json()['data']['items']:
        client.delete(f'/api/assets/items/{i["id"]}?hard=1', headers=AUTH)
    r = client.post('/api/assets/import', json=exported, headers=AUTH)
    assert r.json()['data']['created'] == 1
    item = client.get('/api/assets/items?q=往返', headers=AUTH).json()['data']['items'][0]
    detail = client.get(f'/api/assets/items/{item["id"]}', headers=AUTH).json()['data']
    assert detail['content'] == '内容 {{v}}'
    assert detail['tags'] == ['r'] and detail['favorite'] is True
    assert detail['variables'] == ['v']


# ─── Skill 包导入（单文件 / zip 规格） ────────────────

import io
import zipfile


def _zip_bytes(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for path, content in files.items():
            z.writestr(path, content)
    return buf.getvalue()


def _upload(client, filename, data, headers=AUTH):
    return client.post('/api/assets/skills/import',
                       files={'file': (filename, data, 'application/octet-stream')},
                       headers=headers)


def _skill_md(name='demo-skill', desc='演示技能描述', body='技能正文 {{input}}'):
    return f'---\nname: {name}\ndescription: {desc}\n---\n\n{body}\n'


def test_skill_zip_import_nested(client, auth_headers):
    data = _zip_bytes({
        'demo-skill/SKILL.md': _skill_md(),
        'demo-skill/reference.md': '参考文档',
        'demo-skill/scripts/convert.py': 'print(1)',
        'demo-skill/scripts/__pycache__/x.pyc': 'bin',
        'demo-skill/img/logo.png': '\x89PNG fake',
        '__MACOSX/junk': 'x',
        'demo-skill/.DS_Store': 'junk',
    })
    r = _upload(client, 'demo-skill.zip', data)
    assert r.status_code == 201, r.json()
    d = r.json()['data']
    # 描述自动提取（先输出）
    assert d['kind'] == 'skill'
    assert d['title'] == 'demo-skill'
    assert d['summary'] == '演示技能描述'
    assert d['skill']['name'] == 'demo-skill'
    assert d['skill']['description'] == '演示技能描述'
    assert '技能正文' in d['content']
    # 根目录前缀已剥掉；噪音（__pycache__/.DS_Store/__MACOSX）已滤掉
    assert d['skill']['files'] == ['SKILL.md', 'img/logo.png', 'reference.md',
                                   'scripts/convert.py']
    assert d['files_count'] == 4
    assert d['archive_name'] == 'demo-skill.zip'
    assert d['version'] == 1


def test_skill_zip_root_layout(client, auth_headers):
    """SKILL.md 在压缩包根（无外层目录）同样可识别"""
    data = _zip_bytes({'SKILL.md': _skill_md('root-skill'), 'run.sh': 'echo hi'})
    r = _upload(client, 'root.zip', data)
    assert r.status_code == 201
    assert r.json()['data']['skill']['files'] == ['SKILL.md', 'run.sh']


def test_skill_zip_files_tree_and_content(client, auth_headers):
    data = _zip_bytes({
        'demo-skill/SKILL.md': _skill_md(),
        'demo-skill/scripts/run.py': 'print("hello")',
        'demo-skill/assets/icon.png': '\x89PNG\x00binary',
    })
    iid = _upload(client, 's.zip', data).json()['data']['id']

    r = client.get(f'/api/assets/items/{iid}/files', headers=AUTH)
    files = {f['path']: f for f in r.json()['data']}
    assert set(files) == {'SKILL.md', 'scripts/run.py', 'assets/icon.png'}
    assert files['scripts/run.py']['is_text'] is True
    assert files['assets/icon.png']['is_text'] is False

    r = client.get(f"/api/assets/files/{files['scripts/run.py']['id']}", headers=AUTH)
    assert r.json()['data']['content'] == 'print("hello")'
    r = client.get(f"/api/assets/files/{files['assets/icon.png']['id']}", headers=AUTH)
    assert r.json()['data']['content'] is None          # 二进制无预览

    assert client.get('/api/assets/files/99999', headers=AUTH).status_code == 404


def test_skill_archive_download(client, auth_headers):
    data = _zip_bytes({'SKILL.md': _skill_md('dl-skill')})
    iid = _upload(client, '原包.zip', data).json()['data']['id']
    r = client.get(f'/api/assets/items/{iid}/archive', headers=AUTH)
    assert r.status_code == 200 and 'attachment' in r.headers.get('content-disposition', '')
    # 下载的字节就是原包（可再次作为 zip 打开）
    back = zipfile.ZipFile(io.BytesIO(r.content))
    assert back.namelist() == ['SKILL.md']
    # 无压缩包的资产 → 404
    other = _item(client, '普通技能', kind='skill')
    assert client.get(f"/api/assets/items/{other['id']}/archive",
                      headers=AUTH).status_code == 404


def test_skill_zip_spec_failures(client, auth_headers):
    # 无 SKILL.md
    r = _upload(client, 'a.zip', _zip_bytes({'readme.md': 'x'}))
    assert r.status_code == 400 and 'SKILL.md' in r.json()['message']
    # 多个 SKILL.md
    r = _upload(client, 'a.zip', _zip_bytes({'SKILL.md': _skill_md(),
                                             'sub/SKILL.md': _skill_md()}))
    assert r.status_code == 400
    # frontmatter 缺 name / description
    for fm in ('description: 只有描述\n', 'name: only-name\n'):
        r = _upload(client, 'a.zip', _zip_bytes(
            {'SKILL.md': f'---\n{fm}---\nbody'}))
        assert r.status_code == 400
    # name 不合规（大写 / 中文 / 超长）
    for name in ('BadName', '中文名', 'x' * 65):
        r = _upload(client, 'a.zip', _zip_bytes(
            {'SKILL.md': _skill_md(name)}))
        assert r.status_code == 400, name
    # description 超长
    r = _upload(client, 'a.zip', _zip_bytes(
        {'SKILL.md': _skill_md('ok-name', desc='x' * 1025)}))
    assert r.status_code == 400
    # frontmatter 非 YAML 映射
    r = _upload(client, 'a.zip', _zip_bytes({'SKILL.md': '---\n[1,2,3]\n---\nbody'}))
    assert r.status_code == 400
    # zip-slip
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, 'w') as z:
        z.writestr('../evil.txt', 'x')
        z.writestr('SKILL.md', _skill_md())
    r = _upload(client, 'slip.zip', bad.getvalue())
    assert r.status_code == 400 and '不安全' in r.json()['message']
    # 条目超限（201 个）
    many = {f'f{i}.md': 'x' for i in range(201)}
    many['SKILL.md'] = _skill_md()
    r = _upload(client, 'a.zip', _zip_bytes(many))
    assert r.status_code == 400
    # 坏 zip / 不支持的扩展
    r = _upload(client, 'a.zip', b'not a zip')
    assert r.status_code == 400
    r = _upload(client, 'a.exe', b'MZ')
    assert r.status_code == 400 and '.zip' in r.json()['message']
    # 缺 file 字段
    r = client.post('/api/assets/skills/import', headers=AUTH)
    assert r.status_code == 400


def test_skill_single_file(client, auth_headers):
    # 合规 frontmatter：严格提取
    r = _upload(client, 'note.md', _skill_md('single-skill', '单文件描述').encode())
    assert r.status_code == 201
    d = r.json()['data']
    assert d['title'] == 'single-skill' and d['summary'] == '单文件描述'
    assert d['files_count'] == 0 and d['archive_name'] is None

    # 无 frontmatter：宽松（标题=文件名，摘要=首个非标题行）
    r = _upload(client, '我的小技巧.md', '# 标题\n\n把窗口调成深色更护眼\n'.encode())
    assert r.status_code == 201
    d = r.json()['data']
    assert d['title'] == '我的小技巧'
    assert d['summary'] == '把窗口调成深色更护眼'

    # 非 UTF-8 → 400
    r = _upload(client, 'gbk.md', '中文'.encode('gbk'))
    assert r.status_code == 400


def test_skill_import_appears_in_list_and_stats(client, auth_headers):
    _upload(client, 's.zip', _zip_bytes({'SKILL.md': _skill_md('list-skill')}))
    r = client.get('/api/assets/items?kind=skill', headers=AUTH)
    item = next(i for i in r.json()['data']['items'] if i['title'] == 'list-skill')
    assert item['files_count'] == 1 and item['archive_name'] == 's.zip'
    s = client.get('/api/assets/stats', headers=AUTH).json()['data']['totals']
    assert s['skills'] >= 1


def test_skill_export_import_roundtrip_with_files(client, auth_headers):
    data = _zip_bytes({'SKILL.md': _skill_md('rt-skill'),
                       'scripts/run.py': 'print(1)',
                       'assets/icon.png': '\x89PNG bin'})
    iid = _upload(client, 'rt.zip', data).json()['data']['id']
    exported = client.get('/api/assets/export?kind=skill', headers=AUTH).json()
    item = next(i for i in exported['items'] if i['title'] == 'rt-skill')
    assert {f['path'] for f in item['files']} == {'SKILL.md', 'scripts/run.py', 'assets/icon.png'}
    assert item['archive_name'] == 'rt.zip'
    import base64 as _b64
    assert zipfile.ZipFile(io.BytesIO(
        _b64.b64decode(item['archive_b64']))).namelist() == list(data and
        zipfile.ZipFile(io.BytesIO(data)).namelist())
    # 清空回导 → 文件与原包均恢复
    for i in client.get('/api/assets/items?status=all&page_size=100',
                        headers=AUTH).json()['data']['items']:
        client.delete(f"/api/assets/items/{i['id']}?hard=1", headers=AUTH)
    r = client.post('/api/assets/import', json=exported, headers=AUTH)
    assert r.json()['data']['created'] == 1
    new = client.get('/api/assets/items?q=rt-skill', headers=AUTH).json()['data']['items'][0]
    assert new['files_count'] == 3
    dl = client.get(f"/api/assets/items/{new['id']}/archive", headers=AUTH)
    assert dl.status_code == 200 and dl.content == data


def test_skill_archive_b64_validation(client, auth_headers):
    r = client.post('/api/assets/import', json={'items': [
        {'title': 'x', 'content': 'y', 'archive_b64': '!!!not-base64!!!'}]}, headers=AUTH)
    assert r.status_code == 200
    assert 'base64' in r.json()['data']['errors'][0]['error']
