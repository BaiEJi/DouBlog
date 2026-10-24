"""DouBlog（本机）内置目录：把本实例配置中心的两个只读查询作为对外 OpenAPI 提供。

- 幂等播种一个内置系统（slug=doublog，transport.builtin 标记）与两个目录 API：
  * doublog-confcenter-namespaces → GET /api/confcenter/namespaces（全部 namespace，含空空间）
  * doublog-confcenter-get-key    → GET /api/confcenter/{path.namespace}/{path.key}
- 对外统一 OpenAPI 入口（默认格式，全系统通用）：
  GET /api/apihub/openapi/{system}/{api}，如 /api/apihub/openapi/doublog/confcenter_namespaces；
  API 公开别名 = slug 去系统前缀、连字符转下划线；路径模板变量经同名 query 参数传入
  （confcenter_get_key?namespace=…&key=…）。旧 /gw/systems/{slug}/<原路径> 形式对内置
  系统一律 403（透明代理不适用于本机目录）。
- 内层经回环 HTTP 访问同一实例，require_basic 由 Basic provider 用默认用户注入
  （初次播种取 settings.auth_username/auth_password，之后由管理员在 API 表单维护内联凭据）。
- 不做新表/新列：marker 存系统 transport JSON；内置 API 以「系统 marker + 固定 slug」识别。
- 变量校验集中在 validate_local_path_vars，openapi 入口 / POST invoke / 管理调试调用共用，
  缺变量/非法字符一律 400，绝不 500。
"""

import re

from sqlalchemy import select

from app.apihub.core import TemplateError

BUILTIN_SYSTEM_SLUG = 'doublog'
BUILTIN_SYSTEM_NAME = 'DouBlog（本机）'
BUILTIN_MARKER = 'doublog'          # transport.builtin 的值；仅后端内部播种能写入
BUILTIN_VERSION = 1

NAMESPACE_API_SLUG = 'doublog-confcenter-namespaces'
GET_KEY_API_SLUG = 'doublog-confcenter-get-key'
#: 内置目录 API 的全局 slug（同时是管理端保留 slug，普通 API 不得占用）
RESERVED_API_SLUGS = (NAMESPACE_API_SLUG, GET_KEY_API_SLUG)
RESERVED_SYSTEM_SLUGS = (BUILTIN_SYSTEM_SLUG,)

NAMESPACE_VAR = 'namespace'
KEY_VAR = 'key'

#: 与 confcenter 的 NAME_RE 同源（字母数字 _ . : -），另排除独立 . / .. 段
_VAR_RE = re.compile(r'^[A-Za-z0-9_.:-]+$')
NAMESPACE_MAX = 100
KEY_MAX = 200


class LocalCatalogConflict(RuntimeError):
    """保留 slug 已被普通资源占用：登记事务回滚并停止本实例初始化（不含凭据）。"""


def is_builtin_transport(transport) -> bool:
    """系统 transport JSON 是否带本模块内置 marker（管理端无法伪造/移除）。"""
    return isinstance(transport, dict) and transport.get('builtin') == BUILTIN_MARKER


def loopback_origin(port: int) -> str:
    return f'http://127.0.0.1:{int(port)}'


def seed_auth_config() -> dict:
    """初次播种的内联鉴权：Basic provider + 默认用户（settings 默认认证配置）。"""
    from app.config import settings
    return {
        'providers': [{'type': 'basic'}],
        'credential_fields': ['user', 'password'],
        'credential': {'user': settings.auth_username, 'password': settings.auth_password},
    }


def _catalog_api_defs() -> list[dict]:
    """两个目录 API 的固定结构（slug/method/path_tpl/描述/默认配置）。"""
    return [
        {
            'name': '查询所有 namespace',
            'slug': NAMESPACE_API_SLUG,
            'description': '返回本实例配置中心全部 namespace（含空空间）及各空间条目数；'
                           '统一 OpenAPI 入口 GET /api/apihub/openapi/doublog/confcenter_namespaces。',
            'method': 'GET',
            'path_tpl': '/api/confcenter/namespaces',
            'request_cfg': None,
            'response_cfg': {'envelope': 'passthrough'},
        },
        {
            'name': '查询特定 key',
            'slug': GET_KEY_API_SLUG,
            'description': '按 namespace + key 查询单条配置（只读，str 原样、json 保结构）；'
                           '测试样例 apihub_demo/example；统一 OpenAPI 入口 '
                           'GET /api/apihub/openapi/doublog/confcenter_get_key?namespace=…&key=…。',
            'method': 'GET',
            'path_tpl': f'/api/confcenter/{{path.{NAMESPACE_VAR}}}/{{path.{KEY_VAR}}}',
            'request_cfg': None,
            'response_cfg': {'envelope': 'passthrough'},
        },
    ]


# ─── 变量校验（GET 别名 / invoke / admin invoke 共用）──────────────

def _check_var(kind: str, value, max_len: int) -> str:
    if not isinstance(value, str):
        raise TemplateError(f'{kind} 必须是字符串')
    if not value:
        raise TemplateError(f'{kind} 不能为空')
    if len(value) > max_len:
        raise TemplateError(f'{kind} 长度不得超过 {max_len}')
    if not _VAR_RE.fullmatch(value):
        raise TemplateError(f'{kind} 含非法字符（仅允许字母数字 _ . : -）')
    if value in ('.', '..'):
        raise TemplateError(f'{kind} 不能是独立的 . 或 .. 段')
    return value


def validate_local_path_vars(api_slug: str, path_vars: dict) -> None:
    """内置目录 API 的路径变量校验；非法抛 TemplateError（调用方统一转 400 template_error）。"""
    if api_slug == GET_KEY_API_SLUG:
        _check_var(NAMESPACE_VAR, (path_vars or {}).get(NAMESPACE_VAR), NAMESPACE_MAX)
        _check_var(KEY_VAR, (path_vars or {}).get(KEY_VAR), KEY_MAX)


# ─── OpenAPI 统一别名入口（/api/apihub/openapi/{system}/{api}，默认对外格式）──

#: 对外统一 OpenAPI 入口前缀（路由注册在 /api/apihub 下）
OPENAPI_ALIAS_PREFIX = 'openapi'

#: 内置目录两个 API 的公开别名（slug 去系统前缀、连字符转下划线）
PUBLIC_ALIASES = {
    NAMESPACE_API_SLUG: 'confcenter_namespaces',
    GET_KEY_API_SLUG: 'confcenter_get_key',
}


def api_public_alias(system_slug: str, api_slug: str) -> str:
    """API 的公开别名：内置目录用固定映射；普通 API 取 slug 去系统前缀后 - 转 _。"""
    if api_slug in PUBLIC_ALIASES:
        return PUBLIC_ALIASES[api_slug]
    normalized = api_slug.replace('-', '_')
    prefix = f'{system_slug.replace("-", "_")}_'
    return normalized[len(prefix):] if normalized.startswith(prefix) else normalized


def match_api_by_alias(system_slug: str, system_apis: list, api_name: str):
    """在系统的 API 列表（快照 dict，含 slug，按 id 升序）里按公开别名/slug 匹配。

    规则（`-` 与 `_` 等价）：命中「API slug 原文」「归一化 slug」「归一化 slug 去
    系统前缀」或「归一化 slug 以 _{api_name} 结尾」任一即匹配；未命中返回 None。
    """
    if not isinstance(api_name, str) or not api_name:
        return None
    target = api_name.replace('-', '_')
    system_prefix = system_slug.replace('-', '_') + '_'
    for api in system_apis:
        slug_norm = api['slug'].replace('-', '_')
        stripped = slug_norm[len(system_prefix):] if slug_norm.startswith(system_prefix) else slug_norm
        if api_name == api['slug'] or target in (slug_norm, stripped) \
                or slug_norm.endswith('_' + target):
            return api
    return None


def build_path_vars_from_query(api_cfg: dict, query_params: dict) -> dict:
    """把路径模板变量（{path.x}）从同名 query 参数取值；缺失变量交由调用方校验。

    返回 {变量名: str}；只收集模板声明的变量，多余 query 忽略。
    """
    import re as _re
    vars_needed = set(_re.findall(r'\{path\.(\w+)\}', api_cfg.get('path_tpl') or ''))
    out = {}
    for name in vars_needed:
        value = query_params.get(name) if isinstance(query_params, dict) else None
        if value is not None:
            out[name] = value
    return out


# ─── 播种（幂等；一事务创建缺失条目，冲突即回滚）──────────────────

def seed_local_catalog(runtime) -> dict:
    """幂等登记内置系统与两个目录 API；返回 {created_system, created_apis, origin}。

    - 使用当前 app 捕获的 runtime/engine（不得退回全局最新 engine）；
    - 首次：一事务创建 系统+两 API（凭据取默认用户）；
    - 再次：只更新该内置系统的回环 base_url、补齐缺失条目；不覆盖用户调整的
      status/enabled/名称/超时/重试/auth_config（含凭据）/合法请求默认值；
    - 保留 slug 被普通资源占用 → LocalCatalogConflict（事务回滚，无部分目录）。
    """
    from app.apihub.models import ApihubApi, ApihubSystem
    from app.config import settings
    from app.db import database_context, db

    origin = loopback_origin(settings.port)
    result = {'created_system': False, 'created_apis': 0, 'origin': origin}
    with database_context(runtime):
        sess = db.session
        try:
            sys_row = sess.execute(select(ApihubSystem)
                                   .where(ApihubSystem.slug == BUILTIN_SYSTEM_SLUG)).scalar()
            # 保留 API slug 被「非本目录」资源占用 = 冲突（无论系统是否内置）
            clash = sess.execute(select(ApihubApi)
                                 .where(ApihubApi.slug.in_(RESERVED_API_SLUGS))).scalars().all()
            builtin_sys_id = sys_row.id if sys_row is not None and is_builtin_transport(sys_row.transport) else None
            foreign = [a.slug for a in clash if a.system_id != builtin_sys_id]
            if foreign:
                raise LocalCatalogConflict(
                    f"保留 API slug 已被普通资源占用: {', '.join(sorted(foreign))}；"
                    '请协调处理后再启动本实例（目录登记已回滚）')
            if sys_row is not None and not is_builtin_transport(sys_row.transport):
                raise LocalCatalogConflict(
                    f"保留系统 slug '{BUILTIN_SYSTEM_SLUG}' 已被普通系统占用；"
                    '请协调处理后再启动本实例（目录登记已回滚）')

            if sys_row is None:
                sys_row = ApihubSystem(
                    name=BUILTIN_SYSTEM_NAME, slug=BUILTIN_SYSTEM_SLUG, base_url=origin,
                    timeout_ms=5000, max_retry=0, status=1,
                    transport={'builtin': BUILTIN_MARKER, 'builtin_version': BUILTIN_VERSION})
                sess.add(sys_row)
                sess.flush()          # 取 system_id 供 API 外键
                result['created_system'] = True
            else:
                sys_row.base_url = origin   # 仅回环 origin 随进程端口更新，其余连接参数不动

            existing = {a.slug: a for a in sess.execute(select(ApihubApi)
                                                        .where(ApihubApi.system_id == sys_row.id)
                                                        .where(ApihubApi.slug.in_(RESERVED_API_SLUGS))).scalars()}
            for defn in _catalog_api_defs():
                if defn['slug'] in existing:
                    continue
                sess.add(ApihubApi(
                    system_id=sys_row.id, name=defn['name'], slug=defn['slug'],
                    description=defn['description'], method=defn['method'],
                    path_tpl=defn['path_tpl'],
                    auth_config=seed_auth_config(),
                    request_cfg=defn['request_cfg'], response_cfg=defn['response_cfg'],
                    probe={'path': '/health', 'interval_s': 0},   # 不定时；手动探活走 /health
                ))
                result['created_apis'] += 1
            sess.commit()
            return result
        except Exception:
            sess.rollback()
            raise
        finally:
            sess.remove()
