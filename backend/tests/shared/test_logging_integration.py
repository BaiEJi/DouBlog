"""
lizysdk 集成测试：DouBlog 自身日志经 lizysdk 落盘 + WARNING+ 回灌自身 /api/v1/logs；
AppError 异常经全局 handler 出统一响应。
（依赖 sdklogs 模块已迁移；uvicorn 线程内伺服本 app 实现真实 HTTP 回灌）
"""
import logging
import os
import socket
import threading
import time

import uvicorn

from app.config import settings


def _serve(app):
    """在本线程外用 uvicorn 伺服 app（随机端口），返回 (server, port)"""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(
        app, host='127.0.0.1', port=port, log_level='error'))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, 'uvicorn 测试实例未启动'
    return server, port


def _stop(server):
    server.should_exit = True
    time.sleep(0.2)


def _enable_send(app, monkeypatch, url):
    """改设置并重建日志管道（setup_logging 幂等）。"""
    monkeypatch.setattr(settings, 'logs_send_json', True)
    monkeypatch.setattr(settings, 'logs_send_url', url)
    from app.shared.logging_setup import setup_logging_for_app
    setup_logging_for_app()


def test_app_error_response_envelope(client, auth_headers, monkeypatch):
    """SDK 异常 → DouBlog 信封：message/http_status 来自 AppError，data 带 error_code"""
    # 摄入端非法 JSON（ParamError）
    r = client.post('/api/v1/logs', content='{bad json',
                    headers={'Content-Type': 'application/json'})
    assert r.status_code == 400
    d = r.json()
    assert d['success'] is False and d['code'] == 400
    assert d['data'] == {'error_code': 'PARAM_INVALID', 'details': None}
    assert d['message'] == '非法 JSON'
    # token 错误（AuthError → 401）
    with monkeypatch.context() as m:
        m.setattr(settings, 'logs_auth_token', 't0')
        r = client.post('/api/v1/logs', json={'level': 'INFO'})
        assert r.status_code == 401
        assert r.json()['data']['error_code'] == 'CREDENTIALS_ERROR'


def test_self_ingestion_warning_reaches_logs(app, client, auth_headers, monkeypatch, tmp_path):
    """DouBlog 的 WARNING 日志经 lizysdk 回灌自身 /api/v1/logs，且本地文件落盘"""
    server, port = _serve(app)
    try:
        _enable_send(app, monkeypatch, f'http://127.0.0.1:{port}/api/v1/logs')
        marker = f'self-ingest-probe-{port}'
        logging.getLogger('doublog.test').warning('这条告警应出现在日志系统 %s', marker)
        from lizysdk.logs.handlers import flush as sdk_flush
        sdk_flush(timeout=5)   # 排空写盘/发送队列（文件为缓冲写）

        deadline = time.time() + 10
        found = None
        while time.time() < deadline and not found:
            time.sleep(0.3)
            r = client.get(f'/api/v1/logs?q={marker}', headers=auth_headers)
            items = r.json()['data']['items']
            found = items[0] if items else None
        assert found, 'WARNING 未在 10s 内回灌到 /api/v1/logs'
        assert found['sys_name'] == 'doublog'
        assert found['level_text'] == 'WARNING'
        assert marker in found['message']

        # 本地文件也有（INFO+ 全量落盘）
        log_file = os.path.join(settings.data_dir, 'logs', 'doublog.log')
        assert os.path.exists(log_file)
        assert marker in open(log_file, encoding='utf-8').read()
    finally:
        _stop(server)
        # 恢复测试默认：关发送
        monkeypatch.setattr(settings, 'logs_send_json', False)
        from app.shared.logging_setup import setup_logging_for_app
        setup_logging_for_app()


def test_no_remote_guard_on_ingest_path(app, client, auth_headers, monkeypatch):
    """摄入端点自身的错误带 no_remote：仍落盘（文件），但不外发（/logs 里搜不到）"""
    server, port = _serve(app)
    try:
        _enable_send(app, monkeypatch, f'http://127.0.0.1:{port}/api/v1/logs')
        marker = f'ingest-path-error-{port}'
        lg = logging.getLogger('doublog.test')
        lg.error('摄入路径错误（no_remote） %s', marker, extra={'no_remote': True})
        from lizysdk.logs.handlers import flush as sdk_flush
        sdk_flush(timeout=5)   # 排空本地写盘（发送已被过滤器拦下）
        time.sleep(1.0)        # 给异步派发留窗口（不应发出）

        r = client.get(f'/api/v1/logs?q={marker}', headers=auth_headers)
        assert r.json()['data']['total'] == 0, 'no_remote 记录不应外发'
        log_file = os.path.join(settings.data_dir, 'logs', 'doublog.log')
        assert marker in open(log_file, encoding='utf-8').read(), '本地文件应保留'
    finally:
        _stop(server)
        monkeypatch.setattr(settings, 'logs_send_json', False)
        from app.shared.logging_setup import setup_logging_for_app
        setup_logging_for_app()
