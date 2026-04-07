"""
Authentication API tests
"""
import base64
from flask import Flask


def test_login_success(client, auth_headers):
    """Test successful login with correct credentials"""
    response = client.post('/api/auth/login', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['code'] == 200
    assert data['message'] == '登录成功'
    assert data['data']['username'] == 'admin'


def test_login_unauthorized_no_credentials(client):
    """Test login fails without authentication credentials"""
    response = client.post('/api/auth/login')
    
    assert response.status_code == 401
    data = response.get_json()
    assert data['success'] is False
    assert data['code'] == 401


def test_login_unauthorized_wrong_credentials(client):
    """Test login fails with wrong credentials"""
    credentials = base64.b64encode(b"wrong:wrong").decode('utf-8')
    headers = {'Authorization': f'Basic {credentials}'}
    
    response = client.post('/api/auth/login', headers=headers)
    
    assert response.status_code == 401
    data = response.get_json()
    assert data['success'] is False
    assert data['code'] == 401


def test_auth_check_success(client, auth_headers):
    """Test auth check endpoint with valid authentication"""
    response = client.get('/api/auth/check', headers=auth_headers)
    
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['code'] == 200
    assert data['data']['authenticated'] is True
    assert data['data']['username'] == 'admin'


def test_auth_check_unauthorized(client):
    """Test auth check endpoint without authentication"""
    response = client.get('/api/auth/check')
    
    assert response.status_code == 401
    data = response.get_json()
    assert data['success'] is False
    assert data['code'] == 401
