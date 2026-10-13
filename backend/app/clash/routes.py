"""
Clash 代理管理 API：clashctl 全能力的 Web 迁移（全部 require_basic，Doublog 信封）。

端点与 clashctl 命令一一对应（底层执行完全复用其 bash 函数）：

| HTTP | 路径 | clashctl 等价 |
|---|---|---|
| GET  | /availability | 安装检测（供门户卡片置灰） |
| GET  | /status / POST /on /off | clashctl status / on / off |
| GET/POST | /proxy | clashctl proxy [on|off] |
| GET/POST | /tun | clashctl tun [on|off] |
| GET  | /ui | clashctl ui（Web 控制台地址） |
| GET/PUT | /secret | clashctl [new_secret] |
| POST | /upgrade | clashctl upgrade [-r|-a] |
| GET  | /log | clashctl log（mihomo.log 尾部） |
| GET/PUT | /config | clashctl mixin [-c/-r] / -e（仅 mixin 可写） |
| GET/POST | /sub | clashctl sub ls / add / del / use / update |
| GET  | /sub/log | clashctl sub log |

全部为同步 def（内部 subprocess 阻塞数秒，FastAPI 自动扔线程池，不占事件循环）。
"""

from fastapi import APIRouter, Depends, Query
from lizysdk.errors import ParamError
from pydantic import BaseModel

from app.clash import service
from app.shared.auth import require_basic
from app.shared.response import api_response

router = APIRouter(prefix='/api/clash', tags=['clash'],
                   dependencies=[Depends(require_basic)])


class _EnableBody(BaseModel):
    enable: bool


class _SecretBody(BaseModel):
    secret: str


class _ConfigBody(BaseModel):
    content: str


class _UpgradeBody(BaseModel):
    channel: str = ''


class _LogLevelBody(BaseModel):
    level: str


class _SubBody(BaseModel):
    action: str
    url: str | None = None
    id: int | None = None
    convert: bool = False
    auto: bool = False


def _msg(data: dict, fallback: str = '执行成功') -> str:
    """信封 message 取 clashctl 的猫叫提示行（😼/😾 开头），无则取末行（🎉 结论行）。"""
    out = (data or {}).get('output') or ''
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    for line in lines:
        if line.startswith(('😼', '😾')):
            return line
    return lines[-1] if lines else fallback


def _tail_arg(tail: int) -> int:
    return max(1, min(tail, service.MAX_TAIL_LINES))


# ─── 安装检测 / 内核 ──────────────────────────────────────

@router.get('/availability')
def get_availability():
    """门户卡片置灰依据：{available, base_dir, kernel}——未安装时 available=false 不报错。"""
    return api_response({
        'available': service.is_available(),
        'base_dir': service.base_dir(),
        'kernel': service.kernel_name(),
    })


@router.get('/status')
def get_status():
    service.ensure_available()
    return api_response(service.kernel_status())


@router.post('/on')
def start_kernel():
    service.ensure_available()
    data = service.kernel_start()
    return api_response(data, 200, _msg(data))


@router.post('/off')
def stop_kernel():
    service.ensure_available()
    data = service.kernel_stop()
    return api_response(data, 200, _msg(data))


# ─── 系统代理 / Tun ───────────────────────────────────────

@router.get('/proxy')
def get_proxy():
    service.ensure_available()
    return api_response(service.system_proxy_get())


@router.post('/proxy')
def set_proxy(body: _EnableBody):
    service.ensure_available()
    data = service.system_proxy_set(body.enable)
    return api_response(data, 200, _msg(data))


@router.get('/tun')
def get_tun():
    service.ensure_available()
    return api_response(service.tun_get())


@router.post('/tun')
def set_tun(body: _EnableBody):
    service.ensure_available()
    data = service.tun_set(body.enable)
    return api_response(data, 200, _msg(data))


# ─── Web 控制台 / 密钥 / 升级 ──────────────────────────────

@router.get('/ui')
def get_ui():
    service.ensure_available()
    return api_response(service.ui_addresses())


@router.get('/secret')
def get_secret():
    service.ensure_available()
    return api_response(service.secret_get())


@router.put('/secret')
def put_secret(body: _SecretBody):
    service.ensure_available()
    data = service.secret_set(body.secret.strip())
    return api_response(data, 200, _msg(data))


@router.post('/upgrade')
def post_upgrade(body: _UpgradeBody):
    service.ensure_available()
    data = service.upgrade((body.channel or '').strip())
    return api_response(data, 200, _msg(data))


# ─── 内核日志 / 配置文件 ──────────────────────────────────

@router.get('/log')
def get_log(tail: int = Query(200, ge=1, le=5000)):
    service.ensure_available()
    return api_response(service.kernel_log_tail(_tail_arg(tail)))


@router.post('/log/level')
def set_log_level(body: _LogLevelBody):
    """切换内核日志级别（写 mixin 的 log-level + 合并重启，等价 clashmixin -e）。

    订阅配置常带 log-level: silent——内核静默后日志文件不增长，实时刷新无从谈起。
    """
    service.ensure_available()
    data = service.kernel_log_level_set((body.level or '').strip())
    return api_response(data, 200, f'😼 日志级别已切换为 {data.get("level")}，已重启生效')


@router.get('/config')
def get_config(file: str = Query('mixin')):
    service.ensure_available()
    return api_response(service.config_read(file))


@router.put('/config')
def put_config(body: _ConfigBody):
    """仅 mixin 可写：保存后与 clashmixin -e 一致（合并配置并重启内核）。"""
    service.ensure_available()
    data = service.config_write_mixin(body.content)
    return api_response(data, 200, _msg(data, 'Mixin 已保存并重启内核'))


# ─── 订阅管理 ─────────────────────────────────────────────

@router.get('/sub')
def get_sub():
    service.ensure_available()
    return api_response(service.sub_list())


@router.post('/sub')
def post_sub(body: _SubBody):
    service.ensure_available()
    if body.action == 'add':
        data = service.sub_add((body.url or '').strip())
    elif body.action == 'del':
        data = service.sub_del(body.id)
    elif body.action == 'use':
        data = service.sub_use(body.id)
    elif body.action == 'update':
        data = service.sub_update(body.id, convert=body.convert, auto=body.auto)
    else:
        raise ParamError(message='action 只能是 add / del / use / update')
    return api_response(data, 200, _msg(data))


@router.get('/sub/log')
def get_sub_log(tail: int = Query(200, ge=1, le=5000)):
    service.ensure_available()
    return api_response(service.sub_log_tail(_tail_arg(tail)))
