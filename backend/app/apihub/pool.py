"""上游 HTTP 连接池：标准库 http.client keepalive 复用（零新增依赖，线程安全）。

设计要点（承接独立版压测结论）：
- 每目标（scheme/host/port/verify）独立空闲池，空闲连接 4.5s 过期
  （低于常见服务端 keepalive 5s；残留竞态靠"换新连接重试一次"兜底）；
- 并发连接封顶 128/目标，超额短暂等待空闲连接（防瞬时全量新建连接
  打爆 Windows 临时端口/TIME_WAIT）；
- 空闲连接被服务端提前关闭（RemoteDisconnected/BadStatusLine）→ 换新连接重试一次；
  超时不重试（慢上游 ≠ 连接坏）。
"""

import http.client
import socket
import ssl
import threading
import time
import urllib.parse

from app.apihub.proxy import resolve_proxy

MAX_IDLE = 256
IDLE_MAX_AGE_S = 4.5
MAX_CONN_PER_TARGET = 128
MAX_BODY = 32 * 1024 * 1024

_ssl_lock = threading.Lock()
_ssl_default = None
_ssl_unverified = None


def _get_ssl(verify: bool):
    global _ssl_default, _ssl_unverified
    with _ssl_lock:
        if verify:
            if _ssl_default is None:
                _ssl_default = ssl.create_default_context()
            return _ssl_default
        if _ssl_unverified is None:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            _ssl_unverified = ctx
        return _ssl_unverified


class UpstreamTimeout(Exception):
    pass


class UpstreamConnectError(Exception):
    pass


class UpstreamProtocolError(Exception):
    pass


class FastResp:
    __slots__ = ('status', 'content', 'headers')

    def __init__(self, status, content, headers):
        self.status = status
        self.content = content
        self.headers = headers


class _Conn:
    __slots__ = ('conn', 'released_at')

    def __init__(self, conn):
        self.conn = conn
        self.released_at = 0.0


class _Target:
    def __init__(self, scheme, host, port, ssl_ctx, proxy=None):
        self.scheme = scheme
        self.host = host
        self.port = port
        self.ssl_ctx = ssl_ctx
        # (proxy_host, proxy_port) 或 None：https 目标经正向代理 CONNECT 隧道
        # （resolve_proxy 已保证仅 https 且非 localhost 才有值）
        self.proxy = proxy
        self.idle: list = []
        self.lock = threading.Lock()      # 保护 idle 列表
        self.sem = threading.Semaphore(MAX_CONN_PER_TARGET)

    def _connect(self, timeout_s):
        try:
            if self.proxy:
                conn = http.client.HTTPSConnection(self.proxy[0], self.proxy[1],
                                                   timeout=timeout_s, context=self.ssl_ctx)
                conn.set_tunnel(self.host, self.port)
            elif self.scheme == 'https':
                conn = http.client.HTTPSConnection(self.host, self.port, timeout=timeout_s,
                                                   context=self.ssl_ctx)
            else:
                conn = http.client.HTTPConnection(self.host, self.port, timeout=timeout_s)
            conn.connect()
            return conn
        except socket.timeout:
            raise UpstreamTimeout(f'connect timeout {self.host}:{self.port}')
        except (OSError, ssl.SSLError) as e:
            raise UpstreamConnectError(f'{type(e).__name__}: {e}')

    def _acquire_idle(self):
        with self.lock:
            now = time.monotonic()
            while self.idle:
                c = self.idle.pop()
                if now - c.released_at > IDLE_MAX_AGE_S:
                    self._close(c)
                    continue
                return c
        return None

    def _release(self, c):
        c.released_at = time.monotonic()
        with self.lock:
            if len(self.idle) >= MAX_IDLE:
                self._close(c)
            else:
                self.idle.append(c)

    @staticmethod
    def _close(c):
        try:
            c.conn.close()
        except Exception:
            pass

    def _roundtrip(self, conn, method, target, headers, payload) -> FastResp:
        hdrs = {k: v for k, v in headers.items()
                if k.lower() not in ('host', 'content-length', 'connection',
                                     'transfer-encoding', 'accept-encoding')}
        hdrs['Host'] = f'{self.host}:{self.port}' if self.port not in (80, 443) else self.host
        hdrs['Content-Length'] = str(len(payload))
        hdrs['Connection'] = 'keep-alive'
        try:
            conn.request(method.upper(), target, body=payload if payload else None, headers=hdrs)
            resp = conn.getresponse()
        except socket.timeout:
            raise UpstreamTimeout(f'upstream timeout {self.host}:{self.port}')
        chunks = []
        total = 0
        while True:
            try:
                chunk = resp.read(65536)
            except socket.timeout:
                raise UpstreamTimeout(f'upstream read timeout {self.host}:{self.port}')
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BODY:
                raise ValueError('upstream response too large')
            chunks.append(chunk)
        body = b''.join(chunks)
        out = {k.lower(): v for k, v in resp.getheaders()}
        keep = resp.will_close is False
        if keep:
            self._release(_Conn(conn))
        else:
            conn.close()
        return FastResp(resp.status, body, out)

    def request(self, method, target, headers, payload, timeout_s) -> FastResp:
        if not self.sem.acquire(timeout=max(0.05, timeout_s)):
            raise UpstreamTimeout(f'connection pool busy > {timeout_s}s')
        try:
            c = self._acquire_idle()
            fresh = c is None
            if fresh:
                conn = self._connect(timeout_s)
            else:
                conn = c.conn
            try:
                return self._roundtrip(conn, method, target, headers, payload)
            except (http.client.RemoteDisconnected, http.client.BadStatusLine,
                    ConnectionError, BrokenPipeError, OSError):
                # 连接层故障（不含超时）：关掉；空闲连接（服务端已关）换新连接重试一次
                try:
                    conn.close()
                except Exception:
                    pass
                if fresh:
                    raise
            except ValueError:
                try:
                    conn.close()
                except Exception:
                    pass
                raise
            conn = self._connect(timeout_s)
            try:
                return self._roundtrip(conn, method, target, headers, payload)
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
                raise
        finally:
            self.sem.release()


class UpstreamPool:
    """按 (scheme, host, port, verify, proxy) 分池的共享客户端。出站代理为全局
    可选配置（app/apihub/proxy.py，/config 页读写）：仅 https 目标且非 localhost
    时经正向代理 CONNECT 隧道，代理配置变更后新连接自动走新配置（旧空闲连接
    4.5s 过期自然淘汰）。自定义 CA 不支持——需要时在上游配置里关闭校验。"""

    def __init__(self):
        self._targets: dict = {}
        self._lock = threading.Lock()

    def request(self, method: str, url: str, headers: dict, params: dict,
                payload: bytes, timeout_s: float, verify=True) -> FastResp:
        u = urllib.parse.urlsplit(url)
        if u.scheme not in ('http', 'https') or not u.hostname:
            raise UpstreamProtocolError(f'unsupported url: {url}')
        ssl_ctx = _get_ssl(verify is not False) if u.scheme == 'https' else None
        port = u.port or (443 if u.scheme == 'https' else 80)
        proxy = resolve_proxy(u.scheme, u.hostname)
        key = (u.scheme, u.hostname, port, id(ssl_ctx), proxy)
        with self._lock:
            t = self._targets.get(key)
            if t is None:
                t = _Target(u.scheme, u.hostname, port, ssl_ctx, proxy)
                self._targets[key] = t
        target = u.path or '/'
        if u.query:
            target += '?' + u.query
        if params:
            target += ('&' if '?' in target else '?') + urllib.parse.urlencode(params)
        return t.request(method, target, headers, payload, max(0.05, timeout_s))

    def close_all(self):
        with self._lock:
            for t in self._targets.values():
                with t.lock:
                    while t.idle:
                        _Target._close(t.idle.pop())
            self._targets.clear()
