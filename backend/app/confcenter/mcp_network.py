"""MCP 对外地址由部署者配置。ASGI scheme 已由 Uvicorn 按代理信任设置处理。"""
from dataclasses import dataclass
from urllib.parse import urlsplit

from mcp.server.transport_security import TransportSecuritySettings
from pydantic import HttpUrl, ValidationError

from app.config import settings


@dataclass(frozen=True)
class McpNetwork:
    public_origin: str = ''

    @classmethod
    def configured(cls):
        value = settings.mcp_public_origin.strip()
        if not value:
            return cls()
        try:
            url = HttpUrl(value)
            raw = urlsplit(value)
            if (raw.scheme == 'https' and raw.netloc and raw.path in ('', '/')
                    and not any(c in value for c in ('@', '*', '?', '#', '\\'))
                    and not any(c.isspace() for c in value) and url.port != 0):
                return cls(str(url).rstrip('/'))
        except (ValidationError, ValueError):
            pass
        raise ValueError('DOUBLOG_MCP_PUBLIC_ORIGIN 须为完整的 HTTPS 来源，例如 https://todo.example.com，可含端口')

    @property
    def public_hosts(self):
        if not self.public_origin:
            return ()
        url = urlsplit(self.public_origin)
        return (url.netloc,) if url.port else (url.netloc, url.netloc + ':443')

    def transport_security(self):
        local = ['127.0.0.1', 'localhost', '[::1]']
        local += [host + ':*' for host in local]
        return TransportSecuritySettings(
            enable_dns_rebinding_protection=True, allowed_hosts=[*local, *self.public_hosts],
            allowed_origins=['http://' + host for host in local] + ['https://' + host for host in self.public_hosts],
        )

    def permits(self, request):
        if not request.client:
            return False
        if request.headers.get('host', '') in self.public_hosts:
            origin = request.headers.get('origin')
            return request.scope['scheme'] == 'https' and (
                origin is None or origin in ('https://' + host for host in self.public_hosts))
        return request.client.host in ('127.0.0.1', '::1')

    def endpoint(self, request, module):
        server = request.scope.get('server')
        port = (server and server[1]) or settings.port
        origin = self.public_origin or f'http://127.0.0.1:{port}'
        return f'{origin}/mcp/{module}'
