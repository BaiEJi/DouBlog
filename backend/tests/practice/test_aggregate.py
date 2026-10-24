"""聚合编辑的事务、回执及并发边界；真实路由和 SQLite，无外部服务。"""
def mk_problem(client, **fields):
    response = client.post('/api/practice/problems', json={'title': '题目', **fields})
    assert response.status_code == 201, response.text
    return response.json()['data']


def test_aggregate_save_atomic_and_idempotent(client):
    p = mk_problem(client, solutions=[{'name': '旧解法', 'codes': [{'language': 'python', 'code': 'old'}]}])
    sid = p['solutions'][0]['id']; cid = p['solutions'][0]['codes'][0]['id']
    payload = {'title': '整体新标题', 'revision': p['revision'], 'mutation_id': 'aggregate-test-1',
        'solution_revisions': {sid: 1}, 'solutions': [
            {'id': sid, 'client_id': 's1', 'name': '新解法', 'is_preferred': True,
             'codes': [{'id': cid, 'client_id': 'c1', 'language': 'python', 'code': 'new'}]},
            {'client_id': 's2', 'name': '另一解法', 'codes': [{'client_id': 'c2', 'language': 'go', 'code': 'go-new'}]}]}
    r = client.put(f"/api/practice/problems/{p['id']}/aggregate", json=payload)
    assert r.status_code == 200, r.text
    saved = r.json()['data']
    assert saved['title'] == '整体新标题' and saved['revision'] == 2
    assert saved['solutions'][0]['codes'][0]['id'] == cid
    assert saved['client_ids']['solutions']['s1'] == sid
    assert saved['client_ids']['codes']['c1'] == cid
    assert len(saved['solutions']) == 2
    again = client.put(f"/api/practice/problems/{p['id']}/aggregate", json=payload)
    assert again.status_code == 200 and again.json()['data'] == saved
    assert client.get(f"/api/practice/problems/{p['id']}").json()['data']['revision'] == 2
    payload['title'] = 'reused-id'
    assert client.put(f"/api/practice/problems/{p['id']}/aggregate", json=payload).status_code == 409


def test_aggregate_invalid_child_rolls_back_all(client):
    p = mk_problem(client, solutions=[{'name': '保留', 'codes': [{'language': 'python', 'code': 'old'}]}])
    sid = p['solutions'][0]['id']
    payload = {'title': '不能部分保存', 'revision': p['revision'], 'mutation_id': 'aggregate-invalid-1',
        'solution_revisions': {sid: 1}, 'solutions': [{'name': '无效', 'codes': [{'language': 'no-such-language', 'code': 'bad'}]}]}
    assert client.put(f"/api/practice/problems/{p['id']}/aggregate", json=payload).status_code == 400
    assert client.get(f"/api/practice/problems/{p['id']}").json()['data'] == p


def test_aggregate_detects_child_changes_and_foreign_ids(client):
    p = mk_problem(client, solutions=[{'name': '旧解法'}]); sid = p['solutions'][0]['id']
    payload = {'title': '不可覆盖', 'revision': 1, 'mutation_id': 'aggregate-conflict-1',
               'solution_revisions': {sid: 1}, 'solutions': []}
    client.patch(f'/api/practice/solutions/{sid}', json={'name': '其他标签页', 'revision': 1})
    r = client.put(f"/api/practice/problems/{p['id']}/aggregate", json=payload)
    assert r.status_code == 409
    detail = client.get(f"/api/practice/problems/{p['id']}").json()['data']
    assert detail['title'] == p['title'] and detail['solutions'][0]['name'] == '其他标签页'
    payload['solution_revisions'][sid] = 2
    payload['solutions'] = [{'id': 'foreign-solution', 'name': '不可引用'}]
    assert client.put(f"/api/practice/problems/{p['id']}/aggregate", json=payload).status_code == 400


def test_problem_create_retry_does_not_duplicate_and_maps_client_ids(client):
    body = {'title': '幂等新建', 'mutation_id': 'practice-create-retry', 'solutions': [
        {'name': '方案', 'client_id': 'new-solution', 'codes': [
            {'client_id': 'new-code', 'language': 'python', 'code': 'print(1)'}]}]}
    first = client.post('/api/practice/problems', json=body)
    assert first.status_code == 201, first.text
    assert client.post('/api/practice/problems', json=body).json() == first.json()
    result = first.json()['data']
    assert result['client_ids']['solutions']['new-solution'] == result['solutions'][0]['id']
    assert result['client_ids']['codes']['new-code'] == result['solutions'][0]['codes'][0]['id']
    assert client.get('/api/practice/problems').json()['data']['total'] == 1
