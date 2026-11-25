"""统一 MCP 管理 API 及运行时授权，所有配置都绑定当前数据库。"""
import hashlib
import secrets
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.config import settings
from app.db import current_runtime, db, run_db
from app.shared.auth import require_basic
from app.shared.mcp_catalog import mcp_modules
from app.shared.response import api_response
from app.shared.timeutil import ensure_aware, now_utc, uuid7

from .mcp_network import McpNetwork
from .models import McpToken, McpToolSetting


async def require_mcp_admin(request: Request):
    if not settings.auth_enabled:
        raise HTTPException(403, '请先启用站点登录，再管理 MCP 配置')
    await require_basic(request)


router = APIRouter(prefix='/api/confcenter/mcp', tags=['confcenter'], dependencies=[Depends(require_mcp_admin)])
PREFIX = 'dbmcp_'
TOKEN_LIFETIME = timedelta(days=30)


class IssueToken(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    name: str = Field(default='MCP 客户端', min_length=1, max_length=64)


def _digest(secret):
    return hashlib.sha256(secret.encode('ascii')).hexdigest()


def _provider(request, module):
    provider = mcp_modules(request.app).get(module)
    if provider is None:
        raise HTTPException(404, '模块尚未接入 MCP')
    return provider


def enabled_tools(session, module, provider):
    overrides = dict(session.execute(select(McpToolSetting.tool, McpToolSetting.enabled)
                                     .where(McpToolSetting.module == module)).all())
    return frozenset(name for name in provider.tools if overrides.get(name, name in provider.initially_enabled))


def authenticate(secret, module, provider):
    if not (len(secret) == len(PREFIX) + 43 and secret.isascii() and secret.startswith(PREFIX)):
        return None
    token_id = db.session.scalar(select(McpToken.id).where(
        McpToken.digest == _digest(secret), McpToken.expires_at > now_utc(),
        McpToken.module == module, McpToken.database_identity == current_runtime().identity))
    if token_id is not None:
        return token_id, enabled_tools(db.session, module, provider)
    return None


def _public(token):
    return {'id': token.id, 'name': token.name, 'hint': token.hint,
            'created_at': ensure_aware(token.created_at).isoformat(),
            'expires_at': ensure_aware(token.expires_at).isoformat()}


def _private_response(data, code=200):
    response = api_response(data, code)
    response.headers['Cache-Control'] = 'no-store'
    return response


@router.get('')
async def catalog(request: Request):
    modules = mcp_modules(request.app)
    network = getattr(request.state, 'mcp_network', None) or McpNetwork.configured()

    def query():
        items = []
        for key, provider in modules.items():
            enabled = enabled_tools(db.session, key, provider)
            items.append({
                'key': key, 'title': provider.title, 'server_name': provider.server_name,
                'endpoint': network.endpoint(request, key), 'remote_enabled': bool(network.public_origin),
                'env_name': f'DOUBLOG_{provider.server_name.upper()}_MCP_TOKEN',
                'tools': [{'name': name, 'title': spec.title, 'group': spec.group,
                           'description': spec.handler.__doc__, 'read_only': spec.read_only, 'enabled': name in enabled,
                           'input_schema': spec.inputs.model_json_schema()}
                          for name, spec in provider.tools.items()],
            })
        return _private_response(items)
    return await run_db(query)


class ToolSetting(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: StrictBool


@router.put('/{module}/tools/{tool}')
async def set_tool(request: Request, module: str, tool: str, body: ToolSetting):
    if tool not in _provider(request, module).tools:
        raise HTTPException(404, '模块未注册此工具')

    def save():
        session = db.session
        insert = pg_insert if session.bind.dialect.name == 'postgresql' else sqlite_insert
        stmt = insert(McpToolSetting).values(module=module, tool=tool, enabled=body.enabled)
        session.execute(stmt.on_conflict_do_update(index_elements=['module', 'tool'],
                                                  set_={'enabled': stmt.excluded.enabled}))
        session.commit()
        return _private_response({'name': tool, 'enabled': body.enabled})
    return await run_db(save)


@router.get('/{module}/tokens')
async def list_tokens(request: Request, module: str):
    _provider(request, module)
    def query():
        rows = db.session.scalars(select(McpToken).where(
            McpToken.module == module, McpToken.database_identity == current_runtime().identity
        ).order_by(McpToken.created_at.desc()))
        return _private_response([_public(row) for row in rows])
    return await run_db(query)


@router.post('/{module}/tokens')
async def issue_token(request: Request, module: str, body: IssueToken | None = None):
    _provider(request, module)
    name = (body or IssueToken()).name
    def issue():
        secret = PREFIX + secrets.token_urlsafe(32)
        now = now_utc()
        token = McpToken(id=uuid7(), module=module, name=name, digest=_digest(secret), hint=secret[-4:],
                         database_identity=current_runtime().identity, created_at=now,
                         expires_at=now + TOKEN_LIFETIME)
        db.session.add(token)
        result = {**_public(token), 'token': secret}
        db.session.commit()
        return _private_response(result, 201)
    return await run_db(issue)


class RenewToken(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_expires_at: AwareDatetime


@router.post('/{module}/tokens/{token_id}/renew')
async def renew_token(request: Request, module: str, token_id: str, body: RenewToken):
    _provider(request, module)
    try:
        expected = body.expected_expires_at.astimezone(timezone.utc)
        new_expiry = max(now_utc(), expected) + TOKEN_LIFETIME
    except OverflowError:
        raise HTTPException(422, '到期时间超出支持范围') from None

    def renew():
        session = db.session
        scope = (McpToken.id == token_id, McpToken.module == module,
                 McpToken.database_identity == current_runtime().identity)
        # 以页面读到的到期时间做条件更新，重复或并发点击最多续期一次。
        stmt = (update(McpToken).where(*scope, McpToken.expires_at == expected)
                .values(expires_at=new_expiry).returning(McpToken))
        token = session.scalar(stmt)
        if token is None:
            if session.scalar(select(McpToken.id).where(*scope)) is None:
                raise HTTPException(404, '令牌不存在或已撤销')
            raise HTTPException(409, '令牌有效期已变化，请核对最新日期')
        result = _public(token)
        session.commit()
        return _private_response(result)
    return await run_db(renew)


@router.delete('/{module}/tokens/{token_id}')
async def revoke_token(request: Request, module: str, token_id: str):
    _provider(request, module)
    def revoke():
        db.session.execute(delete(McpToken).where(McpToken.id == token_id, McpToken.module == module,
                                                  McpToken.database_identity == current_runtime().identity))
        db.session.commit()
        return _private_response({'revoked': True})
    return await run_db(revoke)
