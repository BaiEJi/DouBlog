"""测试静态服务:8072 端口服务扩展目录,响应一律 Cache-Control: no-store。

背景:python -m http.server 不发缓存头,Chromium 会启发式缓存 popup.js 等脚本,
导致测试页刷新后 iframe 仍运行旧代码(表现为"修复不生效")。此服务强制每次都拉最新。
"""
import http.server
import os
import socketserver


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):  # 静默访问日志
        pass


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.ThreadingTCPServer(('127.0.0.1', 8072), NoCacheHandler) as httpd:
        print('serving http://127.0.0.1:8072 (Cache-Control: no-store)')
        httpd.serve_forever()
