"""
Authentication API tests
"""
import base64


def test_login_success(client, auth_headers):
    """Test successful login with correct credentials"""
    response = client.post('/api/auth/login', headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data['success'] is True
    assert data['code'] == 200
    assert data['message'] == '登录成功'
    assert data['data']['username'] == 'admin'


def test_login_unauthorized_no_credentials(client):
    """Test login fails without authentication credentials"""
    response = client.post('/api/auth/login')

    assert response.status_code == 401
    data = response.json()
    assert data['success'] is False
    assert data['code'] == 401


def test_login_unauthorized_wrong_credentials(client):
    """Test login fails with wrong credentials"""
    credentials = base64.b64encode(b"wrong:wrong").decode('utf-8')
    headers = {'Authorization': f'Basic {credentials}'}

    response = client.post('/api/auth/login', headers=headers)

    assert response.status_code == 401
    data = response.json()
    assert data['success'] is False
    assert data['code'] == 401


def test_auth_check_success(client, auth_headers):
    """Test auth check endpoint with valid authentication"""
    response = client.get('/api/auth/check', headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data['success'] is True
    assert data['code'] == 200
    assert data['data']['authenticated'] is True
    assert data['data']['username'] == 'admin'


def test_auth_check_unauthorized(client):
    """Test auth check endpoint without authentication"""
    response = client.get('/api/auth/check')

    assert response.status_code == 401
    data = response.json()
    assert data['success'] is False
    assert data['code'] == 401


# ─── 统一登录系统（会话 Cookie）─────────────────────────

def test_login_json_body_sets_session_cookie(client):
    """登录页 JSON 载荷 → 签发 HttpOnly 会话 Cookie"""
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'lizy111A'})
    assert r.status_code == 200
    assert r.json()['data']['username'] == 'admin'
    set_cookie = r.headers.get('set-cookie', '')
    assert 'doublog_session=' in set_cookie
    assert 'HttpOnly' in set_cookie


def test_session_cookie_authenticates_protected_endpoint(client):
    """Cookie 登录一次 → 受保护端点免 Basic"""
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'lizy111A'})
    assert r.status_code == 200
    # TestClient 的 cookie jar 自动携带后续请求
    r = client.get('/api/auth/check')
    assert r.status_code == 200
    assert r.json()['data']['authenticated'] is True


def test_login_wrong_json_credentials_401(client):
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'nope'})
    assert r.status_code == 401
    assert 'doublog_session' not in r.headers.get('set-cookie', '')


def test_logout_clears_session(client):
    client.post('/api/auth/login', json={'username': 'admin', 'password': 'lizy111A'})
    r = client.post('/api/auth/logout')
    assert r.status_code == 200
    r = client.get('/api/auth/check')
    assert r.status_code == 401


def test_tampered_session_token_rejected(client, auth_headers):
    """伪造/篡改会话令牌 → 401（签名校验）"""
    from app.shared.auth import issue_session
    client.cookies.set('doublog_session', issue_session('admin') + 'x')
    r = client.get('/api/auth/check')
    assert r.status_code == 401
    # Basic 通道不受影响
    r = client.get('/api/auth/check', headers=auth_headers)
    assert r.status_code == 200


def test_session_and_basic_coexist(client):
    """既有测试的 Basic 头在新依赖下继续工作（兼容通道）"""
    r = client.get('/api/posts?page=1&page_size=1', headers=auth_headers_of())
    assert r.status_code in (200, 404)  # blog 端点存在时 200


def auth_headers_of():
    import base64
    return {'Authorization': 'Basic ' + base64.b64encode(b'admin:lizy111A').decode()}
