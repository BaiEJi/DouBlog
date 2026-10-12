"""system 模块登录账号测试（system_accounts 表，2026-10-12 自 config.py 迁入）。

覆盖：首次播种（config 凭据进表且为哈希）、表校验生效（Basic/登录两路）、
改密/改用户名（验旧密码、即刻生效、弱口令与非法用户名拒绝）、幂等播种不覆盖。
"""
import base64

BASIC_ADMIN = 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()
BASIC_NEW = 'Basic ' + base64.b64encode(b'admin:newpass123').decode()


def _login(client, username, password):
    return client.post('/api/auth/login', json={'username': username, 'password': password})


class TestSeed:
    def test_seeded_from_config_on_fresh_db(self, client):
        """空库播种：config 凭据可用，库里是哈希不是明文"""
        from app.db import db
        from app.system.models import SystemAccount
        from sqlalchemy.orm import Session

        with Session(db.engine) as s:
            row = s.query(SystemAccount).first()
        assert row is not None
        assert row.username == 'admin'
        assert 'lizy111A' not in row.password_hash
        assert row.password_hash.startswith('pbkdf2_sha256$')
        assert client.get('/api/todo/tasks', headers={'Authorization': BASIC_ADMIN}).status_code == 200

    def test_seed_idempotent_keeps_changed_password(self, app):
        """播种幂等：已有账号不覆盖"""
        from app.db import db
        from app.system import ensure_migrations
        from app.system.models import SystemAccount
        from sqlalchemy.orm import Session

        with Session(db.engine) as s:
            s.query(SystemAccount).filter(SystemAccount.id == 1).update(
                {'password_hash': 'pbkdf2_sha256$1$00$ff'})
            s.commit()
        ensure_migrations(db.engine)
        with Session(db.engine) as s:
            assert s.query(SystemAccount).first().password_hash == 'pbkdf2_sha256$1$00$ff'


class TestTableAuth:
    def test_login_uses_table(self, client):
        r = _login(client, 'admin', 'lizy111A')
        assert r.status_code == 200
        r = _login(client, 'admin', 'wrong')
        assert r.status_code == 401

    def test_basic_wrong_password_401(self, client):
        bad = 'Basic ' + base64.b64encode(b'admin:nope').decode()
        assert client.get('/api/todo/tasks', headers={'Authorization': bad}).status_code == 401


class TestAccountApi:
    def test_get_account(self, client, auth_headers):
        r = client.get('/api/admin/account', headers=auth_headers)
        assert r.status_code == 200
        assert r.json()['data']['username'] == 'admin'
        assert 'password' not in r.json()['data']

    def test_change_password(self, client, auth_headers):
        r = client.put('/api/admin/account', headers=auth_headers, json={
            'old_password': 'lizy111A', 'new_password': 'newpass123'})
        assert r.status_code == 200, r.text
        # 旧密码失效（Basic + 登录），新密码即刻生效
        assert client.get('/api/todo/tasks', headers={'Authorization': BASIC_ADMIN}).status_code == 401
        assert client.get('/api/todo/tasks', headers={'Authorization': BASIC_NEW}).status_code == 200
        assert _login(client, 'admin', 'newpass123').status_code == 200

    def test_change_username(self, client, auth_headers):
        r = client.put('/api/admin/account', headers=auth_headers, json={
            'old_password': 'lizy111A', 'username': 'lizy'})
        assert r.status_code == 200
        assert client.get('/api/todo/tasks', headers=auth_headers).status_code == 401  # 旧用户名 Basic 失效
        ok = 'Basic ' + base64.b64encode(b'lizy:lizy111A').decode()
        assert client.get('/api/todo/tasks', headers={'Authorization': ok}).status_code == 200

    def test_wrong_old_password(self, client, auth_headers):
        r = client.put('/api/admin/account', headers=auth_headers, json={
            'old_password': 'bad', 'new_password': 'newpass123'})
        assert r.status_code == 401

    def test_weak_password_rejected(self, client, auth_headers):
        r = client.put('/api/admin/account', headers=auth_headers, json={
            'old_password': 'lizy111A', 'new_password': 'short'})
        assert r.status_code == 400

    def test_bad_username_rejected(self, client, auth_headers):
        r = client.put('/api/admin/account', headers=auth_headers, json={
            'old_password': 'lizy111A', 'username': '非法 用户'})
        assert r.status_code == 400

    def test_noop_rejected(self, client, auth_headers):
        r = client.put('/api/admin/account', headers=auth_headers, json={'old_password': 'lizy111A'})
        assert r.status_code == 400

    def test_requires_auth(self, client):
        assert client.get('/api/admin/account').status_code == 401
