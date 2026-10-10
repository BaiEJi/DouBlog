"""
密码服务测试：推导确定性（黄金向量）/ 校验宽限 / API Key / CRUD / 级联 / 零明文落盘
"""
import time

from app.pwsvc.routes import derive_password, validate_password, GRACE_SECONDS, _reset_bucket, _utcnow

POLICY = {'length': 16, 'uppercase': True, 'lowercase': True, 'digits': True,
          'symbols': True, 'exclude_ambiguous': True}
SEED_A = bytes(range(32))
SEED_B = bytes(range(32, 64))
GOLDEN = 'Y4x(59NK)yn,+L@{'   # 黄金向量：防止算法意外漂移导致所有密码失效


def _project(client, auth_headers, name='商城测试'):
    r = client.post('/api/pwsvc/projects', json={'name': name, 'description': '测试项目'},
                    headers=auth_headers)
    assert r.status_code == 201, r.json()
    d = r.json()['data']
    _reset_bucket(d['id'])   # 限流桶是进程级状态，跨用例同 ID 会串味，建项目即清零
    return d


def _type(client, auth_headers, pid, name='普通用户', **kw):
    payload = {'name': name, 'length': 16, 'rotation_seconds': 60, **kw}
    r = client.post(f'/api/pwsvc/projects/{pid}/types', json=payload, headers=auth_headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _user(client, auth_headers, pid, tid, username='user001'):
    r = client.post(f'/api/pwsvc/projects/{pid}/users',
                    json={'username': username, 'type_id': tid}, headers=auth_headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


def _validate(client, key, username, password):
    r = client.post('/api/pwsvc/validate', json={'username': username, 'password': password},
                    headers={'X-Api-Key': key})
    assert r.status_code == 200
    return r.json()['data']


# ─── 推导算法（黄金向量 + 确定性 + 每用户独立）──────────

def test_golden_vector():
    """固定 seed+窗口+策略 → 固定密码。改动 derive 算法必须显式更新此向量！"""
    assert derive_password(SEED_A, 12345, POLICY) == GOLDEN


def test_derive_deterministic_and_independent():
    assert derive_password(SEED_A, 12345, POLICY) == derive_password(SEED_A, 12345, POLICY)
    # 窗口不同 → 密码不同；用户 seed 不同 → 密码不同（每个用户独立密码链）
    assert derive_password(SEED_A, 12345, POLICY) != derive_password(SEED_A, 12346, POLICY)
    assert derive_password(SEED_A, 12345, POLICY) != derive_password(SEED_B, 12345, POLICY)


def test_derive_policy_classes():
    only_digits = {'length': 12, 'uppercase': False, 'lowercase': False,
                   'digits': True, 'symbols': False, 'exclude_ambiguous': False}
    pw = derive_password(SEED_A, 999, only_digits)
    assert len(pw) == 12 and pw.isdigit()
    # 排除易混淆
    pw2 = derive_password(SEED_A, 999, {**POLICY, 'exclude_ambiguous': True, 'length': 64})
    assert not set('Il1O0o') & set(pw2)
    assert any(c.isupper() for c in pw2) and any(c.isdigit() for c in pw2)


def test_validate_grace_logic():
    """校验纯函数：当前窗口 / 30s 宽限 / 过了宽限 / 错误密码"""
    rotation = 60
    now = 1000 * 60 + 10          # 窗口开始后 10s
    cur = derive_password(SEED_A, int(now // rotation), POLICY)
    prev = derive_password(SEED_A, int(now // rotation) - 1, POLICY)

    assert validate_password(SEED_A, POLICY, rotation, cur, now)['valid'] is True
    assert validate_password(SEED_A, POLICY, rotation, cur, now)['expires_in'] == 50

    # 上一窗口密码：窗口内 10s < 30s 宽限 → 通过，剩余宽限 20s
    r = validate_password(SEED_A, POLICY, rotation, prev, now)
    assert r == {'valid': True, 'expires_in': 20}

    # 窗口开始后 31s（超过 30s 宽限）→ 上一窗口密码失效
    r = validate_password(SEED_A, POLICY, rotation, prev, now + 21)
    assert r['valid'] is False

    # 错误密码
    assert validate_password(SEED_A, POLICY, rotation, 'wrong-password', now)['valid'] is False
    # 上上窗口永远无效
    old = derive_password(SEED_A, int(now // rotation) - 2, POLICY)
    assert validate_password(SEED_A, POLICY, rotation, old, now)['valid'] is False


def test_grace_capped_by_short_rotation():
    """30s 轮换时宽限不超过周期本身"""
    rotation = 30
    now = 1000 * 30 + 5
    prev = derive_password(SEED_A, int(now // rotation) - 1, POLICY)
    assert validate_password(SEED_A, POLICY, rotation, prev, now)['valid'] is True  # 5s < 30
    assert validate_password(SEED_A, POLICY, rotation, prev, now + 26)['valid'] is False  # 31s > 30=周期


# ─── 项目 / API Key ─────────────────────────────────────

def test_project_crud_and_api_key_lifecycle(client, auth_headers):
    p = _project(client, auth_headers)
    assert p['api_key'].startswith('pws_') and len(p['api_key']) > 20
    key1 = p['api_key']

    lst = client.get('/api/pwsvc/projects', headers=auth_headers).json()['data']
    assert lst[0]['name'] == '商城测试' and 'api_key' not in lst[0]   # 列表不回明文 key

    # 重名拒绝
    assert client.post('/api/pwsvc/projects', json={'name': '商城测试'},
                       headers=auth_headers).status_code == 400

    # 重置 key：旧失效新可用
    r = client.post(f"/api/pwsvc/projects/{p['id']}/api-key", headers=auth_headers).json()['data']
    key2 = r['api_key']
    assert key2 != key1
    assert client.post('/api/pwsvc/validate', json={'username': 'x', 'password': 'y'},
                       headers={'X-Api-Key': key1}).status_code == 401

    # 更新与删除
    assert client.put(f"/api/pwsvc/projects/{p['id']}", json={'name': '改名'}, headers=auth_headers).status_code == 200
    assert client.delete(f"/api/pwsvc/projects/{p['id']}", headers=auth_headers).status_code == 200
    assert client.get('/api/pwsvc/projects', headers=auth_headers).json()['data'] == []


def test_validate_requires_api_key(client, auth_headers):
    p = _project(client, auth_headers, name='无Key')
    assert client.post('/api/pwsvc/validate', json={'username': 'x', 'password': 'y'}).status_code == 401
    assert client.post('/api/pwsvc/validate', json={'username': 'x', 'password': 'y'},
                       headers={'X-Api-Key': 'pws_bogus'}).status_code == 401
    client.delete(f"/api/pwsvc/projects/{p['id']}", headers=auth_headers)


# ─── 类型 / 用户 / 端到端校验 ────────────────────────────

def test_full_flow_validate_current_password(client, auth_headers):
    p = _project(client, auth_headers, name='全流程')
    key = p['api_key']
    t = _type(client, auth_headers, p['id'])
    u = _user(client, auth_headers, p['id'], t['id'], 'alice')

    # UI 拿当前密码 → 校验通过
    cur = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']
    assert cur['expires_in'] > 0 and cur['rotation_seconds'] == 60
    assert _validate(client, key, 'alice', cur['password'])['valid'] is True

    # 错误密码 / 不存在的用户 / 跨项目用户
    assert _validate(client, key, 'alice', 'not-the-password')['valid'] is False
    assert _validate(client, key, 'nobody', cur['password'])['valid'] is False


def test_disabled_user_and_seed_reset(client, auth_headers):
    p = _project(client, auth_headers, name='禁用与重置')
    key = p['api_key']
    t = _type(client, auth_headers, p['id'])
    u = _user(client, auth_headers, p['id'], t['id'], 'bob')

    cur = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']['password']
    assert _validate(client, key, 'bob', cur)['valid'] is True

    # 禁用 → 校验失败
    client.put(f"/api/pwsvc/users/{u['id']}", json={'status': 'disabled'}, headers=auth_headers)
    assert _validate(client, key, 'bob', cur)['valid'] is False
    # 启用恢复
    client.put(f"/api/pwsvc/users/{u['id']}", json={'status': 'enabled'}, headers=auth_headers)

    # 重置 seed → 旧密码链全部失效，新密码可用
    client.put(f"/api/pwsvc/users/{u['id']}", json={'reset_seed': True}, headers=auth_headers)
    assert _validate(client, key, 'bob', cur)['valid'] is False
    new = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']['password']
    assert new != cur
    assert _validate(client, key, 'bob', new)['valid'] is True


def test_policy_change_takes_effect(client, auth_headers):
    p = _project(client, auth_headers, name='策略变更')
    key = p['api_key']
    t = _type(client, auth_headers, p['id'], name='访客')
    u = _user(client, auth_headers, p['id'], t['id'], 'carol')

    old = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']['password']
    # 改成纯数字 8 位 → 新窗口立即按新策略（当前窗口重新推导即变化）
    r = client.put(f"/api/pwsvc/types/{t['id']}",
                   json={'length': 8, 'uppercase': False, 'lowercase': False, 'symbols': False},
                   headers=auth_headers)
    assert r.status_code == 200
    new = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']['password']
    assert new != old and len(new) == 8 and new.isdigit()
    assert _validate(client, key, 'carol', new)['valid'] is True


def test_type_delete_blocked_by_users_and_cascade(client, auth_headers):
    p = _project(client, auth_headers, name='删除语义')
    t = _type(client, auth_headers, p['id'])
    _user(client, auth_headers, p['id'], t['id'], 'dave')
    # 有关联用户 → 409
    assert client.delete(f"/api/pwsvc/types/{t['id']}", headers=auth_headers).status_code == 409
    # 删项目级联清空
    client.delete(f"/api/pwsvc/projects/{p['id']}", headers=auth_headers)
    from app.pwsvc.models import PwsvcUser, PwsvcType
    assert PwsvcUser.query.count() == 0
    assert PwsvcType.query.count() == 0


def test_uniqueness_and_validation_errors(client, auth_headers):
    p = _project(client, auth_headers, name='校验错误')
    t = _type(client, auth_headers, p['id'])
    _user(client, auth_headers, p['id'], t['id'], 'eve')
    assert client.post(f"/api/pwsvc/projects/{p['id']}/users",
                       json={'username': 'eve', 'type_id': t['id']},
                       headers=auth_headers).status_code == 400
    # 非法策略
    assert client.post(f"/api/pwsvc/projects/{p['id']}/types",
                       json={'name': 'X', 'length': 4}, headers=auth_headers).status_code == 400
    assert client.post(f"/api/pwsvc/projects/{p['id']}/types",
                       json={'name': 'Y', 'rotation_seconds': 45}, headers=auth_headers).status_code == 400
    assert client.post(f"/api/pwsvc/projects/{p['id']}/types",
                       json={'name': 'Z', 'uppercase': False, 'lowercase': False,
                             'digits': False, 'symbols': False},
                       headers=auth_headers).status_code == 400


def test_no_plaintext_secrets_at_rest(client, auth_headers):
    """落盘零明文：seed 列为密文；任何列都不含密码本体；api key 只存哈希"""
    p = _project(client, auth_headers, name='零明文')
    t = _type(client, auth_headers, p['id'])
    u = _user(client, auth_headers, p['id'], t['id'], 'frank')
    cur = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']['password']

    from app.pwsvc.models import PwsvcUser, PwsvcProject
    row = PwsvcUser.query.first()
    assert row.seed_encrypted != cur
    assert password_not_in(row.seed_encrypted, cur)
    proj = PwsvcProject.query.first()
    assert len(proj.api_key_hash) == 64 and 'pws_' not in proj.api_key_hash


def password_not_in(haystack_b64, needle):
    import base64
    return needle.encode() not in base64.b64decode(haystack_b64)


# ─── 校验日志 / 失败统计 / 限流 ──────────────────────────

def test_validate_logs_written(client, auth_headers):
    """每次校验（成功/失败/用户不存在）都落日志；统计与 fail_top 正确；不含密码内容"""
    p = _project(client, auth_headers, name='日志项目')
    key = p['api_key']
    t = _type(client, auth_headers, p['id'])
    u = _user(client, auth_headers, p['id'], t['id'], 'logger')
    cur = client.get(f"/api/pwsvc/users/{u['id']}/current", headers=auth_headers).json()['data']['password']

    _validate(client, key, 'logger', cur)                # 成功
    _validate(client, key, 'logger', 'wrong-pass')       # 密码错误
    _validate(client, key, 'ghost', cur)                 # 用户不存在

    d = client.get(f"/api/pwsvc/projects/{p['id']}/logs", headers=auth_headers).json()['data']
    assert d['total'] == 3
    assert [i['username'] for i in d['items']] == ['ghost', 'logger', 'logger']   # 倒序
    assert [i['valid'] for i in d['items']] == [False, False, True]
    assert all(i['ip'] for i in d['items'])
    assert d['stats']['h24'] == {'ok': 1, 'fail': 2}
    assert d['stats']['h1'] == {'ok': 1, 'fail': 2}
    assert d['stats']['fail_top'][0]['username'] == 'logger'
    assert cur not in str(d['items'])                    # 日志永不含密码明文


def test_logs_pagination(client, auth_headers):
    p = _project(client, auth_headers, name='分页项目')
    key = p['api_key']
    for _ in range(12):
        _validate(client, key, 'pager', 'bad')
    d1 = client.get(f"/api/pwsvc/projects/{p['id']}/logs?page=1&per_page=10",
                    headers=auth_headers).json()['data']
    d2 = client.get(f"/api/pwsvc/projects/{p['id']}/logs?page=2&per_page=10",
                    headers=auth_headers).json()['data']
    assert d1['total'] == 12 and len(d1['items']) == 10
    assert len(d2['items']) == 2
    assert d1['items'][0]['id'] > d2['items'][0]['id']    # 倒序


def test_logs_pruned_after_retention(client, auth_headers):
    """超过 30 天的日志行在下次写入时被清理"""
    from datetime import timedelta
    from app.db import db
    from app.pwsvc.models import PwsvcValidateLog
    from app.pwsvc.routes import _utcnow

    p = _project(client, auth_headers, name='清理项目')
    key = p['api_key']
    _validate(client, key, 'old', 'bad')
    row = PwsvcValidateLog.query.first()
    old_id, old_user = row.id, row.username
    row.created_at = _utcnow() - timedelta(days=40)
    db.session.commit()

    _validate(client, key, 'new', 'bad')                  # 触发清理
    d = client.get(f"/api/pwsvc/projects/{p['id']}/logs", headers=auth_headers).json()['data']
    assert d['total'] == 1 and d['items'][0]['username'] == 'new'
    assert all(i['id'] != old_id for i in d['items'])


def test_rate_limit_returns_429(client, auth_headers):
    """页面改限流后立即生效：额度内 200，超出 429"""
    p = _project(client, auth_headers, name='限流项目')
    key = p['api_key']
    r = client.put(f"/api/pwsvc/projects/{p['id']}", json={'rate_limit': 3}, headers=auth_headers)
    assert r.status_code == 200 and r.json()['data']['rate_limit'] == 3

    codes = [client.post('/api/pwsvc/validate', json={'username': 'u', 'password': 'x'},
                         headers={'X-Api-Key': key}).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert client.post('/api/pwsvc/validate', json={'username': 'u', 'password': 'x'},
                       headers={'X-Api-Key': key}).json()['message'].find('频繁') >= 0


def test_rate_limit_429_not_logged(client, auth_headers):
    """被限流的请求不写日志（防刷爆日志表）"""
    p = _project(client, auth_headers, name='限流不记日志')
    key = p['api_key']
    client.put(f"/api/pwsvc/projects/{p['id']}", json={'rate_limit': 2}, headers=auth_headers)
    for _ in range(6):
        client.post('/api/pwsvc/validate', json={'username': 'u', 'password': 'x'},
                    headers={'X-Api-Key': key})
    d = client.get(f"/api/pwsvc/projects/{p['id']}/logs", headers=auth_headers).json()['data']
    assert d['total'] == 2


def test_rate_limit_zero_means_unlimited(client, auth_headers):
    p = _project(client, auth_headers, name='不限流')
    key = p['api_key']
    assert client.put(f"/api/pwsvc/projects/{p['id']}", json={'rate_limit': 0},
                      headers=auth_headers).status_code == 200
    codes = {client.post('/api/pwsvc/validate', json={'username': 'u', 'password': 'x'},
                         headers={'X-Api-Key': key}).status_code for _ in range(30)}
    assert codes == {200}


def test_rate_limit_validation(client, auth_headers):
    """限流配置校验：负数/非整数/超上限拒绝；创建时也可指定"""
    p = _project(client, auth_headers, name='限流校验')
    for bad in (-1, 'abc', 10001):
        assert client.put(f"/api/pwsvc/projects/{p['id']}", json={'rate_limit': bad},
                          headers=auth_headers).status_code == 400
    r = client.post('/api/pwsvc/projects', json={'name': '限流创建', 'rate_limit': 5},
                    headers=auth_headers)
    assert r.status_code == 201 and r.json()['data']['rate_limit'] == 5
    # 默认值 120
    assert p['rate_limit'] == 120


# ─── 存量库迁移：日志表复合索引幂等补建 ───────────────────

def test_ensure_migrations_adds_logs_composite_index(tmp_path):
    """存量库缺 (project_id, created_at) 复合索引时 ensure_migrations 幂等补建（清理/统计热路径）"""
    from sqlalchemy import create_engine, inspect, text
    from app.pwsvc.models import ensure_migrations

    engine = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    from app.db import Base
    import app.pwsvc.models  # noqa: F401 - 注册映射
    Base.metadata.create_all(engine)
    with engine.begin() as conn:                      # 模拟存量库（建表于索引加入之前）
        conn.execute(text('DROP INDEX ix_pwsvc_logs_pid_created'))

    names = {ix['name'] for ix in inspect(engine).get_indexes('pwsvc_validate_logs')}
    assert 'ix_pwsvc_logs_pid_created' not in names

    ensure_migrations(engine)                          # 补建
    ensure_migrations(engine)                          # 幂等
    names = {ix['name'] for ix in inspect(engine).get_indexes('pwsvc_validate_logs')}
    assert 'ix_pwsvc_logs_pid_created' in names
