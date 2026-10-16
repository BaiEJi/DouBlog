"""
模块化日志标识：每个能力一个 sys_name（doublog.<module>），随记录覆盖发送到日志查询模块。

- 请求路径 → 模块映射（全局异常处理与请求日志用它标注来源模块）
- mod_logger(module) 返回带 sys_name 覆盖的 LoggerAdapter
- 日志上报配置（开关/服务地址/级别）持久化在 data/logs_config.json，管理页读写
"""
import json
import logging
import os
import threading

from app.config import settings

#: 请求路径前缀 → 模块名（按最长前缀优先顺序排列）
MODULE_BY_PREFIX = (
    ('/api/subs', 'subs'),
    ('/api/diary', 'diary'),
    ('/api/vault', 'vault'),
    ('/api/pwsvc', 'pwsvc'),
    ('/api/v1', 'sdklogs'),
    ('/api/admin', 'system'),
    ('/api/apihub', 'apihub'),
    ('/openapi', 'apihub'),
    ('/api/todo', 'todo'),
    ('/api/gamemap', 'gamemap'),
    ('/api/practice', 'practice'),
    ('/api/steamidler', 'steamidler'),
    ('/api/confcenter', 'confcenter'),
    ('/api/clash', 'clash'),
    ('/api/assets', 'assets'),
    ('/api/auth', 'shared'),
    ('/api/workspaces', 'blog'),
    ('/api/posts', 'blog'),
    ('/api/images', 'blog'),
    ('/api/export', 'blog'),
)

ALL_MODULES = ('blog', 'diary', 'vault', 'pwsvc', 'sdklogs', 'subs', 'apihub', 'system', 'todo',
               'gamemap', 'practice', 'steamidler', 'confcenter', 'clash', 'assets', 'shared', 'main')

#: 有数据库表的模块（init_db 逐个调用其 ensure_migrations 钩子）
MODULES_WITH_DB = ('blog', 'diary', 'vault', 'pwsvc', 'sdklogs', 'subs', 'apihub',
                   'system', 'todo', 'gamemap', 'practice', 'steamidler', 'confcenter', 'assets')

SYS_PREFIX = 'doublog'


def module_for_path(path: str) -> str:
    for prefix, mod in MODULE_BY_PREFIX:
        if path.startswith(prefix):
            return mod
    return 'main'


def sys_name_for(module: str) -> str:
    return f'{SYS_PREFIX}.{module}'


# ─── 上报配置（管理页可改，落 data/logs_config.json）────────

_LOCK = threading.Lock()


def logs_config_path() -> str:
    return os.path.join(settings.data_dir, 'logs_config.json')


def load_logs_config() -> dict:
    """上报配置：文件 > 环境默认。enabled/url/level 三项。"""
    cfg = {
        'enabled': settings.logs_send_json,
        'url': settings.logs_send_url,
        'level': 'INFO',             # 外发最低级别：INFO（全量采集）/ WARNING（只收告警）
    }
    try:
        with open(logs_config_path(), encoding='utf-8') as f:
            stored = json.load(f)
        if isinstance(stored, dict):
            if isinstance(stored.get('enabled'), bool):
                cfg['enabled'] = stored['enabled']
            if isinstance(stored.get('url'), str) and stored['url'].startswith('http'):
                cfg['url'] = stored['url'].strip()
            if stored.get('level') in ('INFO', 'WARNING'):
                cfg['level'] = stored['level']
    except (OSError, ValueError):
        pass
    return cfg


def save_logs_config(cfg: dict):
    with _LOCK:
        os.makedirs(settings.data_dir, exist_ok=True)
        with open(logs_config_path(), 'w', encoding='utf-8') as f:
            json.dump({'enabled': bool(cfg['enabled']),
                       'url': str(cfg['url']).strip(),
                       'level': cfg['level'] if cfg['level'] in ('INFO', 'WARNING') else 'WARNING'},
                      f, ensure_ascii=False, indent=2)


class _SysNameAdapter(logging.LoggerAdapter):
    """持有模块名（不是 logger 名），注入 extra.sys_name=doublog.<module> 记录级覆盖。"""

    def __init__(self, module: str):
        super().__init__(logging.getLogger(f'{SYS_PREFIX}.{module}'), {})
        self.module = module

    def process(self, msg, kwargs):
        extra = kwargs.setdefault('extra', {})
        extra.setdefault('sys_name', sys_name_for(self.module))
        return msg, kwargs


def mod_logger(module: str) -> _SysNameAdapter:
    """按模块取日志器：logger.warning(...) 自动以 sys_name=doublog.<module> 上报。"""
    return _SysNameAdapter(module)
