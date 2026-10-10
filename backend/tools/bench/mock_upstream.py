"""bench 专用 mock 上游（60111）：HTTP/1.1 keep-alive echo。

供 apihub 压测场景的上游目标；协议精确、无日志噪声。
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # keep-alive

    def log_message(self, *a):  # 静音
        pass

    def _send(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send({'ok': True, 'echo': 'bench', 'path': self.path})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n) if n else b''
        self._send({'ok': True, 'echo': 'bench', 'len': len(raw)})


def serve(port=60111):
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True, name='bench-mock-upstream').start()
    return srv


if __name__ == '__main__':
    s = serve()
    print(f'mock upstream on {60111}', flush=True)
    threading.Event().wait()
