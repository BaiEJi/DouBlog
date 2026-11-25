"""生成 MCP 接入地址并校验浏览器请求携带的 Origin。"""
from dataclasses import dataclass
from urllib.parse import urlsplit

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
            if (raw.scheme in ('http', 'https') and raw.netloc and raw.path in ('', '/')
                    and not any(c in value for c in ('@', '*', '?', '#', '\\'))
                    and not any(c.isspace() for c in value) and url.port != 0):
                return cls(str(url).rstrip('/'))
        except (ValidationError, ValueError):
            pass
        raise ValueError('DOUBLOG_MCP_PUBLIC_ORIGIN 须为 HTTP 或 HTTPS 来源，例如 https://todo.example.com，可含端口')

    def accepts_origin(self, request):
        origins = request.headers.getlist('origin')
        if not origins:
            return True
        if len(origins) != 1:
            return False
        try:
            request_origin = HttpUrl(f'{request.url.scheme}://{request.url.netloc}')
        except ValidationError:
            return False
        return origins[0] == str(request_origin).rstrip('/') or (
            bool(self.public_origin) and origins[0] == self.public_origin)

    def endpoint(self, request, module):
        base = self.public_origin or str(request.base_url).rstrip('/')
        return f'{base}/mcp/{module}'
