"""每个已接入模块一个 Streamable HTTP 服务，发现和调用遵循同一份开放清单。"""
from contextlib import AsyncExitStack, asynccontextmanager
from contextvars import ContextVar

import mcp_types as types
import orjson
from fastapi import APIRouter, HTTPException, Request
from mcp.server.caching import CacheHint
from mcp.server.lowlevel.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecurityMiddleware
from mcp.shared.exceptions import MCPError
from pydantic import ValidationError
from starlette.responses import Response

from app.db import run_db
from app.shared.mcp_catalog import mcp_modules
from .mcp_admin import authenticate
from .mcp_network import McpNetwork


_access = ContextVar('mcp_request_access')


async def _call_tool(provider, params):
    token_id, enabled = _access.get()
    if params.name not in enabled:
        raise MCPError(-32602, '工具未开放或不存在')
    try:
        args = provider.tools[params.name].inputs.model_validate(params.arguments or {})
        data = await run_db(provider.execute, params.name, args, token_id)
    except ValidationError as error:
        fields = ', '.join('.'.join(map(str, item['loc'])) for item in error.errors(include_input=False))
        message = '参数不符合工具定义：' + fields
    except HTTPException as error:
        message = f'{error.status_code} {error.detail}'
    except ValueError as error:
        message = str(error)
    else:
        return types.CallToolResult(structured_content=data, content=[
            types.TextContent(type='text', text=orjson.dumps(data).decode())])
    return types.CallToolResult(is_error=True, content=[types.TextContent(type='text', text=message)])


def _transport(provider, security):
    catalog = {name: types.Tool(name=name, title=tool.title, description=tool.handler.__doc__,
                                input_schema=tool.inputs.model_json_schema(),
                                annotations=types.ToolAnnotations(read_only_hint=tool.read_only, open_world_hint=False))
               for name, tool in provider.tools.items()}

    async def list_tools(ctx, params):
        _, enabled = _access.get()
        return types.ListToolsResult(tools=[spec for name, spec in catalog.items() if name in enabled])

    async def call_tool(ctx, params):
        return await _call_tool(provider, params)

    def input_schema(name):
        _, enabled = _access.get()
        return catalog[name].input_schema if name in enabled else None

    server = Server(provider.server_name, version='1.0', instructions=provider.instructions,
                    on_list_tools=list_tools, on_call_tool=call_tool, get_tool_input_schema=input_schema,
                    cache_hints={'tools/list': CacheHint(ttl_ms=0, scope='private')})
    return StreamableHTTPSessionManager(server, json_response=True, stateless=True, security_settings=security)


@asynccontextmanager
async def _lifespan(app):
    managers = {}
    network = McpNetwork.configured()
    security = network.transport_security()
    async with AsyncExitStack() as stack:
        for key, provider in mcp_modules(app).items():
            manager = _transport(provider, security)
            await stack.enter_async_context(manager.run())
            managers[key] = (provider, manager)
        yield {'mcp_managers': managers, 'mcp_network': network, 'mcp_security': TransportSecurityMiddleware(security)}


class McpEndpoint:
    async def __call__(self, scope, receive, send):
        request = Request(scope)
        if not request.state.mcp_network.permits(request):
            return await Response('当前连接不符合 MCP 接入设置', status_code=403)(scope, receive, send)
        rejected = await request.state.mcp_security.validate_request(request)
        if rejected is not None:
            return await rejected(scope, receive, send)
        key = request.path_params['module']
        module = request.state.mcp_managers.get(key)
        if module is None:
            return await Response(status_code=404)(scope, receive, send)
        provider, manager = module
        kind, _, value = request.headers.get('authorization', '').partition(' ')
        access = await run_db(authenticate, value, key, provider) if kind.lower() == 'bearer' else None
        if access is None:
            return await Response(status_code=401, headers={'WWW-Authenticate': 'Bearer realm="DouBlog MCP"',
                                                          'Cache-Control': 'no-store'})(scope, receive, send)
        binding = _access.set(access)
        try:
            await manager.handle_request(scope, receive, send)
        finally:
            _access.reset(binding)


router = APIRouter(lifespan=_lifespan)
router.add_route('/mcp/{module}', McpEndpoint(), methods=['POST', 'GET', 'DELETE'])
