"""原子编辑、故障恢复与迟到回填回归。"""
from app.confcenter import cache


def test_get_uses_one_isolated_task_and_checks_limit_before_cache(client, auth_headers, monkeypatch):
    from app.confcenter import routes, ratelimit
    from app.shared.pools import get_pool
    response = client.put('/api/confcenter/ratelimit/config', headers=auth_headers,
        json={'enabled': True, 'limit': 1, 'window_seconds': 60})
    assert response.status_code == 200
    order, submissions = [], []
    check = ratelimit.check
    async_run = routes._shared_run_db
    def checked(*args):
        order.append('limit')
        return check(*args)
    def hit(*args):
        order.append('cache')
        return {'type': 'str', 'data': 'cached-value', 'updated_at': '2026-01-01T00:00:00'}
    async def submit(fn, *args, **kwargs):
        submissions.append(kwargs.get('_pool'))
        return await async_run(fn, *args, **kwargs)
    monkeypatch.setattr(ratelimit, 'check', checked)
    monkeypatch.setattr(cache, 'cache_get', hit)
    monkeypatch.setattr(routes, '_shared_run_db', submit)
    first = client.get('/api/confcenter/one/key', headers=auth_headers)
    assert first.status_code == 200 and first.json()['data']['data'] == 'cached-value'
    assert order == ['limit', 'cache']
    assert submissions == [get_pool('confcenter-db', workers=8)]
    order.clear(); submissions.clear()
    assert client.get('/api/confcenter/one/key', headers=auth_headers).status_code == 429
    assert order == ['limit'], 'a cache hit must never bypass namespace limiting'
    assert submissions == [get_pool('confcenter-db', workers=8)]


def test_rename_and_value_update_is_one_transaction(client, auth_headers):
    created = client.put('/api/confcenter/edit/old', headers=auth_headers,
                         json={'type': 'str', 'data': 'before'}).json()['data']
    response = client.put('/api/confcenter/rename', headers=auth_headers, json={
        'namespace': 'edit', 'old_key': 'old', 'new_key': 'new',
        'type': 'json', 'data': '{"after":true}', 'if_updated_at': created['updated_at'],
    })
    assert response.status_code == 200
    assert client.get('/api/confcenter/edit/old', headers=auth_headers).status_code == 404
    assert client.get('/api/confcenter/edit/new', headers=auth_headers).json()['data']['data'] == {'after': True}


def test_invalid_edit_does_not_partially_rename(client, auth_headers):
    client.put('/api/confcenter/edit/old', headers=auth_headers, json={'type': 'str', 'data': 'before'})
    response = client.put('/api/confcenter/rename', headers=auth_headers, json={
        'namespace': 'edit', 'old_key': 'old', 'new_key': 'new', 'type': 'json', 'data': '[broken',
    })
    assert response.status_code == 400
    assert client.get('/api/confcenter/edit/old', headers=auth_headers).json()['data']['data'] == 'before'
    assert client.get('/api/confcenter/edit/new', headers=auth_headers).status_code == 404


def test_stale_edit_preserves_latest_value_and_key(client, auth_headers):
    before = client.put('/api/confcenter/edit/old', headers=auth_headers,
                        json={'type': 'str', 'data': 'before'}).json()['data']
    latest = client.put('/api/confcenter/edit/old', headers=auth_headers,
                        json={'type': 'str', 'data': 'other writer'}).json()['data']
    assert latest['updated_at'] != before['updated_at']
    response = client.put('/api/confcenter/rename', headers=auth_headers, json={
        'namespace': 'edit', 'old_key': 'old', 'new_key': 'new',
        'type': 'str', 'data': 'stale editor', 'if_updated_at': before['updated_at'],
    })
    assert response.status_code == 409
    assert client.get('/api/confcenter/edit/old', headers=auth_headers).json()['data']['data'] == 'other writer'
    assert client.get('/api/confcenter/edit/new', headers=auth_headers).status_code == 404


def test_late_db_read_cannot_repopulate_invalidated_cache(client, auth_headers, app, cache_env):
    client.put('/api/confcenter/edit/key', headers=auth_headers, json={'type': 'str', 'data': 'before'})
    state = cache.get_cache_state(app)
    generation = state.generation
    old_payload = {'type': 'str', 'data': 'before', 'updated_at': 'old-read'}
    client.put('/api/confcenter/edit/key', headers=auth_headers, json={'type': 'str', 'data': 'latest'})
    cache.cache_put(state, 'edit', 'key', old_payload, generation=generation)
    assert client.get('/api/confcenter/edit/key', headers=auth_headers).json()['data']['data'] == 'latest'


def test_colon_names_do_not_collide_in_cache(client, auth_headers, cache_env):
    client.put('/api/confcenter/a:b/c', headers=auth_headers, json={'type': 'str', 'data': 'one'})
    client.put('/api/confcenter/a/b:c', headers=auth_headers, json={'type': 'str', 'data': 'two'})
    assert cache.cache_key('a:b', 'c') != cache.cache_key('a', 'b:c')
    for _ in range(2):
        assert client.get('/api/confcenter/a:b/c', headers=auth_headers).json()['data']['data'] == 'one'
        assert client.get('/api/confcenter/a/b:c', headers=auth_headers).json()['data']['data'] == 'two'


def test_same_key_atomic_update_honours_timestamp(client, auth_headers):
    initial = client.put('/api/confcenter/edit/key', headers=auth_headers,
                         json={'type': 'str', 'data': 'before'}).json()['data']
    response = client.put('/api/confcenter/rename', headers=auth_headers, json={
        'namespace': 'edit', 'old_key': 'key', 'new_key': 'key', 'type': 'str',
        'data': 'after', 'if_updated_at': initial['updated_at'],
    })
    assert response.status_code == 200
    assert client.get('/api/confcenter/edit/key', headers=auth_headers).json()['data']['data'] == 'after'


def test_conditional_put_delete_and_create_do_not_overwrite(client, auth_headers):
    initial = client.put('/api/confcenter/edit/key', headers=auth_headers,
                         json={'type': 'str', 'data': 'first', 'if_absent': True}).json()['data']
    assert client.put('/api/confcenter/edit/key', headers=auth_headers,
                      json={'type': 'str', 'data': 'second', 'if_absent': True}).status_code == 409
    updated = client.put('/api/confcenter/edit/key', headers=auth_headers, json={
        'type': 'str', 'data': 'latest', 'if_updated_at': initial['updated_at'],
    })
    assert updated.status_code == 200
    assert client.delete('/api/confcenter/edit/key', headers=auth_headers,
                         params={'if_updated_at': initial['updated_at']}).status_code == 409
    assert client.delete('/api/confcenter/edit/key', headers=auth_headers,
                         params={'if_updated_at': updated.json()['data']['updated_at']}).status_code == 200
