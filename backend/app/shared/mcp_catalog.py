"""业务模块通过 mcp_provider 声明工具。配置中心负责开放策略、令牌和传输。"""
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True)
class McpTool:
    title: str
    group: str
    inputs: type[BaseModel]
    handler: Callable
    read_only: bool


@dataclass(frozen=True)
class McpProvider:
    title: str
    server_name: str
    instructions: str
    tools: Mapping[str, McpTool]
    execute: Callable
    initially_enabled: frozenset[str] = frozenset()


def mcp_modules(app) -> dict[str, McpProvider]:
    return {key: module.mcp_provider for key, module in app.state.loaded_modules
            if hasattr(module, 'mcp_provider')}
