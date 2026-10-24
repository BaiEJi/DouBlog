"""confcenter 模块隔离 QA 启动入口（PLAN 8.2）。

在任何 app.main/app.db/业务模块导入**之前**完成环境注入，然后复用
`app.main:app` 单例启动 uvicorn（单进程、无 reload）：

- data/images/tmp 全部落在模块 worktree 的 ``.runtime/qa/`` 下，绝不触碰
  受保护源目录（C:/Users/Lizy/Desktop/Code/DouBlog）与其 data；
- 独立 db_config.json（sqlite）/ logs_config.json（enabled=false，URL 指向
  本模块 20131）/ redis_config.json（enabled=false）/ ratelimit_config.json
  （默认关闭，浏览器验收按需经管理端点启用）；
- 独立 secret_key 与 QA 账号；口令经环境变量传入，不进仓库/报告；
- DOUBLOG_TESTING=1 → 后台钩子空转，无外发副作用。

用法（cwd=backend，conda dev 环境）::

    python tools/confcenter_qa.py                 # 启动 127.0.0.1:20131
    python tools/confcenter_qa.py --check         # 只做注入自检，不起服务
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
WORKTREE = BACKEND_DIR.parent
QA_ROOT = WORKTREE / '.runtime' / 'qa'
PORT = 20131  # collaboration.json：confcenter 后端固定端口

#: worktree 根的规范路径前缀——注入目标必须落在模块内（防误指向源目录）
_WORKTREE_PREFIX = str(WORKTREE.resolve()).lower() + os.sep
#: 受保护源目录（只读；任何注入路径不得落在这里）
_PROTECTED_SOURCE = Path('C:/Users/Lizy/Desktop/Code/DouBlog').resolve()


def _ensure_inside_module(path: Path) -> Path:
    resolved = path.resolve()
    text = str(resolved).lower()
    if not text.startswith(_WORKTREE_PREFIX):
        raise SystemExit(f'[confcenter_qa] 路径越出模块 worktree: {resolved}')
    if resolved == _PROTECTED_SOURCE or str(_PROTECTED_SOURCE) in text:
        raise SystemExit(f'[confcenter_qa] 路径触碰受保护源目录: {resolved}')
    return resolved


def _atomic_write_json(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, path)


def prepare(data_subdir: str = 'qa') -> dict:
    """创建隔离目录 + 写独立配置 + 注入 settings；返回自检信息。"""
    qa_root = QA_ROOT if data_subdir == 'qa' else _ensure_inside_module(QA_ROOT.parent / data_subdir)
    data_dir = _ensure_inside_module(qa_root / 'data')
    images_dir = _ensure_inside_module(qa_root / 'images')
    tmp_dir = _ensure_inside_module(qa_root / 'tmp')
    log_dir = _ensure_inside_module(qa_root / 'logs')
    for directory in (data_dir, images_dir, tmp_dir, log_dir):
        directory.mkdir(parents=True, exist_ok=True)

    os.environ['DOUBLOG_TESTING'] = '1'
    os.environ['DOUBLOG_LOG_SEND'] = '0'

    # 首次业务导入之前注入 settings
    sys.path.insert(0, str(BACKEND_DIR))
    from app.config import settings  # noqa: E402

    settings.host = '127.0.0.1'
    settings.port = PORT
    settings.debug = False
    settings.database_backend = 'sqlite'
    settings.data_dir = str(data_dir)
    settings.images_dir = str(images_dir)
    settings.logs_send_json = False
    settings.logs_send_url = f'http://127.0.0.1:{PORT}/api/v1/logs'
    settings.secret_key = secrets.token_hex(32)
    # QA 账号默认与源站惯例一致（admin），可经环境变量覆盖；隔离库无真实数据
    settings.auth_username = os.environ.get('CONFCENTER_QA_USERNAME', 'admin')
    settings.auth_password = os.environ.get('CONFCENTER_QA_PASSWORD', 'lizy111A')

    # data_dir 内的独立配置文件（在 app.main 导入前落盘）
    _atomic_write_json(data_dir / 'db_config.json', {'backend': 'sqlite'})
    _atomic_write_json(data_dir / 'logs_config.json',
                       {'enabled': False, 'url': settings.logs_send_url, 'level': 'WARNING'})
    _atomic_write_json(data_dir / 'redis_config.json',
                       {'enabled': False, 'host': '127.0.0.1', 'port': 6379,
                        'db': 0, 'password': '', 'ttl_seconds': 3600})
    _atomic_write_json(data_dir / 'ratelimit_config.json',
                       {'enabled': False, 'limit': 100, 'window_seconds': 60, 'overrides': {}})

    return {'data_dir': str(data_dir), 'images_dir': str(images_dir),
            'tmp_dir': str(tmp_dir), 'port': PORT, 'username': settings.auth_username}


def verify(data_subdir: str = 'qa') -> None:
    """启动前验证：engine 是 SQLite 且位于隔离 data_dir、监听端口与日志目标正确。"""
    from app.config import settings
    from app.db import db, current_runtime

    runtime = current_runtime()
    engine = db.engine
    assert engine.url.get_backend_name() == 'sqlite', f'engine 不是 sqlite: {engine.url}'
    db_path = str(engine.url.database).replace('\\', '/').lower()
    expected = str(QA_ROOT.parent / data_subdir).replace('\\', '/').lower()
    assert db_path.startswith(expected), f'SQLite 位置越界: {engine.url.database}'
    assert runtime.data_dir == settings.data_dir, 'runtime.data_dir 与 settings 不一致'
    assert settings.host == '127.0.0.1' and settings.port == PORT
    assert settings.logs_send_json is False and settings.logs_send_url.endswith(f':{PORT}/api/v1/logs')
    print(f'[confcenter_qa] verified sqlite={engine.url.database}')


def main() -> None:
    parser = argparse.ArgumentParser(description='confcenter isolated QA server')
    parser.add_argument('--check', action='store_true', help='只做注入自检，不启动服务')
    parser.add_argument('--port', type=int, default=PORT,
                        help=f'监听端口（默认 {PORT}，须在本模块预留块 20130-20139 内）')
    parser.add_argument('--data-subdir', default='qa',
                        help='QA 根子目录（默认 qa；压测 A/B 用独立子目录隔离数据）')
    args = parser.parse_args()
    if not 20130 <= args.port <= 20139:
        raise SystemExit('[confcenter_qa] 端口必须在模块预留块 20130-20139 内')

    info = prepare(args.data_subdir)
    # 注入完成后才首次导入 app.main（复用其模块级 app，不再 create_app）
    from app.main import app  # noqa: E402,F401

    if args.check:
        verify(args.data_subdir)
        print('[confcenter_qa] check ok:', json.dumps(info, ensure_ascii=False))
        return

    verify(args.data_subdir)
    import uvicorn
    print('[confcenter_qa] serving on http://127.0.0.1:%d (%s)' % (args.port, info['data_dir']))
    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
