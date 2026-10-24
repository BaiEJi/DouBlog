"""apihub 模块隔离启动/测试入口（协作方案 §8.1，zcode 实现）。

用法（cwd 必须是本 worktree 的 backend 目录，经 conda dev 环境运行）::

    python tools/apihub_local.py --registry <登记表绝对路径> verify
    python tools/apihub_local.py --registry <登记表绝对路径> serve [--backend-root <路径>] [--data-dir <路径>]
    python tools/apihub_local.py --registry <登记表绝对路径> test [-- pytest 参数…]

- 强制 MODULE=apihub：从登记表读取 worktree 与后端端口（20061）；
- 路径围栏：校验本文件 realpath 与 cwd 均在本模块 worktree 内，拒绝源目录/其他
  worktree/目录联接越界；
- 在导入 app.main（或任何会间接导入 main 的模块）之前注入隔离 settings：
  host=127.0.0.1 / port=20061 / debug=False / database_backend=sqlite /
  data_dir=<worktree>/.ui-qa/apihub/runtime/data（可覆盖）/ 日志不外发；
  独立 secret_key 保存在模块隔离数据中，不打印；
- verify：只读检查（解释器/依赖来源/有效配置/无生产库路径），不导入默认 app；
- serve：复查端口后单进程 uvicorn（无 reload/无多 worker），复用已隔离的 app 对象；
- test：同一预注入后调用串行 pytest.main（不用 xdist 子进程），汇总全部 skip。

--backend-root：A/B 性能对照用——把指定快照的 backend 目录作为 import 根
（git archive 导出的 base 快照），在首次导入前注入同样隔离 settings。
"""

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys

MODULE = 'apihub'


def _real(path: str) -> str:
    return os.path.realpath(os.path.abspath(path))


def _fail(msg: str) -> 'None':
    print(f'[apihub_local] FAIL: {msg}', file=sys.stderr)
    raise SystemExit(2)


def _inside(path: str, root: str) -> bool:
    path, root = _real(path), _real(root)
    return os.path.commonpath([path, root]) == root


def load_registry(registry_path: str) -> dict:
    registry_path = _real(registry_path)
    if not os.path.isfile(registry_path):
        _fail(f'登记表不存在: {registry_path}')
    with open(registry_path, encoding='utf-8') as f:
        registry = json.load(f)
    mod = (registry.get('modules') or {}).get(MODULE)
    if not mod:
        _fail(f'登记表缺少 modules.{MODULE}')
    worktree = os.path.join(registry['worktree_root'],
                            f'module_feat_{MODULE}')
    if not os.path.isdir(worktree):
        _fail(f'worktree 不存在: {worktree}')
    return {
        'registry_path': registry_path,
        'worktree': _real(worktree),
        'backend_port': int(mod['backend_port']),
        'frontend_port': int(mod['frontend_port']),
        'protected_checkout': registry['protected_checkout'],
        'conda_prefix': _real(registry.get('conda', {}).get('prefix', '')),
    }


def fence(info: dict) -> None:
    """自身路径与 cwd 都必须在本模块 worktree 内（realpath 围栏，拒绝源目录越界）。"""
    here = _real(__file__)
    backend = os.path.join(info['worktree'], 'backend')
    if not _inside(here, backend):
        _fail(f'本文件不在模块 worktree 内: {here}')
    cwd = _real(os.getcwd())
    if not _inside(cwd, backend):
        _fail(f'cwd 必须是 {backend}（当前 {cwd}）')
    protected = _real(info['protected_checkout'])
    if _inside(here, protected) or _inside(cwd, protected):
        _fail('禁止在受保护源目录运行本工具')


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def _port_owner(port: int) -> str:
    """查 127.0.0.1:port 监听者（仅报告，绝不杀进程）。"""
    try:
        out = subprocess.run(['netstat', '-ano'], capture_output=True, text=True,
                             timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return ''
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[3] == 'LISTENING' and parts[1].endswith(f':{port}'):
            return f'pid={parts[4]} addr={parts[1]}'
    return ''


def port_free(port: int) -> bool:
    # Windows 下不设 SO_REUSEADDR：占用中的端口 bind 直接失败，探测才可靠
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def prepare_environment(info: dict, data_dir_override: str | None = None,
                        import_root: str | None = None) -> dict:
    """统一进程环境 + 隔离 settings 预注入（必须在导入 app.main 之前完成）。

    import_root：app 包的 import 根（默认本 worktree backend；A/B 基线传快照 backend）。
    返回不含凭据的有效配置摘要（供 verify/serve 打印）。
    """
    os.environ['PYTHONUTF8'] = '1'
    os.environ['PYTHONNOUSERSITE'] = '1'
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    os.environ.pop('PYTHONPATH', None)
    os.environ['DOUBLOG_TESTING'] = '1'
    os.environ['DOUBLOG_LOG_SEND'] = '0'

    # app 包 import 根：优先显式传入（基线快照），否则本工具所在的 backend 目录
    root = _real(import_root or os.path.dirname(os.path.dirname(_real(__file__))))
    if not _inside(root, info['worktree']):
        _fail(f'import 根必须在本 worktree 内: {root}')
    if not any(p and _real(p) == root for p in sys.path):
        sys.path.insert(0, root)

    qa_root = os.path.join(info['worktree'], '.ui-qa', MODULE)
    data_dir = _real(data_dir_override or os.path.join(qa_root, 'runtime', 'data'))
    if not _inside(data_dir, info['worktree']):
        _fail(f'数据目录必须在本 worktree 内: {data_dir}')
    tmp_dir = os.path.join(qa_root, 'tmp')
    os.makedirs(tmp_dir, exist_ok=True)
    os.environ['TEMP'] = tmp_dir
    os.environ['TMP'] = tmp_dir

    # 独立 secret_key：保存在模块隔离数据旁（runtime/secret_key），生成一次复用，不打印
    os.makedirs(data_dir, exist_ok=True)
    secret_path = os.path.join(os.path.dirname(data_dir), 'secret_key')
    if os.path.isfile(secret_path):
        with open(secret_path, encoding='utf-8') as f:
            secret = f.read().strip()
    else:
        import secrets
        secret = 'isolated-' + secrets.token_urlsafe(48)
        with open(secret_path, 'w', encoding='utf-8') as f:
            f.write(secret)

    # ── 仅导入 app.config（无 main 副作用），注入隔离 settings ──
    from app.config import settings
    port = info['backend_port']
    settings.host = '127.0.0.1'
    settings.port = port
    settings.debug = False
    settings.database_backend = 'sqlite'
    settings.data_dir = data_dir
    settings.images_dir = os.path.join(data_dir, 'images')
    settings.logs_send_json = False
    settings.logs_send_url = f'http://127.0.0.1:{port}/api/v1/logs'
    settings.secret_key = secret

    return {
        'module': MODULE,
        'worktree': info['worktree'],
        'backend_port': port,
        'host': settings.host,
        'debug': settings.debug,
        'database_backend': settings.database_backend,
        'data_dir': settings.data_dir,
        'images_dir': settings.images_dir,
        'logs_send_json': settings.logs_send_json,
        'logs_send_url': settings.logs_send_url,
        'testing': os.environ['DOUBLOG_TESTING'],
        'temp': tmp_dir,
    }


def _check_isolated_data(cfg: dict) -> list[str]:
    """隔离 data 目录不得存在业务 PG/Redis/代理/外发日志配置；返回发现的问题清单。"""
    problems = []
    data_dir = cfg['data_dir']
    db_cfg = os.path.join(data_dir, 'db_config.json')
    if os.path.isfile(db_cfg):
        try:
            with open(db_cfg, encoding='utf-8') as f:
                stored = json.load(f)
            if stored.get('backend') != 'sqlite':
                problems.append(f'db_config.json backend={stored.get("backend")}（必须 sqlite）')
        except (json.JSONDecodeError, OSError) as e:
            problems.append(f'db_config.json 不可读: {e}')
    for name, why in (('redis_config.json', 'Redis 缓存配置（隔离环境应为默认关闭）'),
                      ('apihub_proxy.json', 'apihub 出站代理配置（隔离环境应为默认关闭）'),
                      ('logs_config.json', '日志外发配置（隔离环境应关闭外发）')):
        path = os.path.join(data_dir, name)
        if os.path.isfile(path):
            problems.append(f'存在 {name}: {why}——请人工确认已关闭或删除后重试')
    return problems


# ─── verify ─────────────────────────────────────────────────────────

def cmd_verify(info: dict) -> int:
    cfg = prepare_environment(info)
    print('[apihub_local] verify（只读，不导入 app.main、不启动服务）')
    print(f'  python          : {sys.executable}')
    print(f'  python_version  : {sys.version.split()[0]}')
    for name in ('fastapi', 'uvicorn', 'sqlalchemy', 'pytest', 'pgserver',
                 'lizysdk', 'orjson', 'cryptography'):
        try:
            mod = __import__(name)
            origin = getattr(mod, '__file__', None)
            print(f'  {name:<15}: {origin or "(内建/命名空间)"}')
            if origin and info['conda_prefix'] and not _inside(origin, info['conda_prefix']):
                print(f'  WARN {name} 不在 dev 环境: {origin}')
        except ImportError as e:
            print(f'  {name:<15}: 缺失（{e}）')
    print('  有效配置（不含凭据）:')
    for k in sorted(cfg):
        print(f'    {k:<16}= {cfg[k]}')
    problems = _check_isolated_data(cfg)
    if problems:
        for p in problems:
            print(f'  FAIL {p}', file=sys.stderr)
        return 1
    owner = _port_owner(info['backend_port'])
    print(f'  端口 {info["backend_port"]}: {"空闲" if not owner else "被占用 " + owner}')
    print('[apihub_local] verify OK：SQLite 隔离、日志不外发、无生产库/Redis/代理配置')
    return 0


# ─── serve ──────────────────────────────────────────────────────────

def cmd_serve(info: dict, backend_root: str | None, data_dir: str | None) -> int:
    if backend_root:
        backend_root = _real(backend_root)
        if not _inside(backend_root, info['worktree']):
            _fail(f'--backend-root 必须在本 worktree 内: {backend_root}')
        print(f'[apihub_local] serve（基线快照 import 根: {backend_root}）')
    cfg = prepare_environment(info, data_dir_override=data_dir, import_root=backend_root)
    problems = _check_isolated_data(cfg)
    if problems:
        for p in problems:
            print(f'[apihub_local] FAIL {p}', file=sys.stderr)
        return 1
    if not port_free(info['backend_port']):
        owner = _port_owner(info['backend_port'])
        _fail(f'端口 {info["backend_port"]} 已被占用（{owner or "未知占用者"}）——'
              '报告协调者，不自动换号/不杀进程')
    print(f'[apihub_local] serve pid={os.getpid()} addr=127.0.0.1:{cfg["backend_port"]} '
          f'data_dir={cfg["data_dir"]}')

    # app.main 导入即创建 app（含日志初始化）；隔离 settings 已先行注入
    import app.main as app_main
    app = app_main.app
    runtime = getattr(app.state, 'db_runtime', None)
    if runtime is not None:
        snap = runtime.snapshot()
        print(f'[apihub_local] database backend={snap["running_backend"]} '
              f'identity={snap["identity"]} generation={snap["generation"]}')
    import uvicorn
    uvicorn.run(app, host=cfg['host'], port=cfg['backend_port'],
                workers=1, reload=False, log_level='info')
    print(f'[apihub_local] serve 退出 pid={os.getpid()}')
    return 0


# ─── test ───────────────────────────────────────────────────────────

class _SkipRecorder:
    """pytest 插件：记录全部 skip（nodeid + 原因），运行后汇总输出。"""

    def __init__(self):
        self.skipped = []

    def pytest_runtest_logreport(self, report):
        if report.when == 'call' and report.skipped:
            self.skipped.append((report.nodeid, report.longreprtext or ''))
        elif report.when == 'setup' and report.skipped:
            self.skipped.append((report.nodeid, str(report.longrepr or '')))


def cmd_test(info: dict, pytest_args: list[str]) -> int:
    cfg = prepare_environment(info)
    print('[apihub_local] test（串行 pytest，隔离 settings 已预注入）')
    for k in ('backend_port', 'data_dir', 'logs_send_json'):
        print(f'  {k:<16}= {cfg[k]}')
    import pytest
    args = list(pytest_args)
    if not any(a == '--basetemp' or a.startswith('--basetemp=') for a in args):
        args.append(f'--basetemp={os.path.join(cfg["temp"], "pytest-default")}')
    recorder = _SkipRecorder()
    code = pytest.main(args, plugins=[recorder])
    print(f'[apihub_local] pytest 退出码: {code}；skip 共 {len(recorder.skipped)} 项')
    for nodeid, reason in recorder.skipped:
        first = (reason or '').strip().splitlines()
        print(f'  SKIP {nodeid}: {first[-1] if first else "(无原因)"}')
    return int(code)


def main() -> int:
    parser = argparse.ArgumentParser(description='apihub 模块隔离入口')
    parser.add_argument('--registry', required=True, help='协作登记表绝对路径')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('verify')
    serve_p = sub.add_parser('serve')
    serve_p.add_argument('--backend-root', default=None,
                         help='A/B 基线快照的 backend 目录（import 根，须在本 worktree 内）')
    serve_p.add_argument('--data-dir', default=None,
                         help='覆盖隔离数据目录（须在本 worktree 内，如 AB 基线独立库）')
    test_p = sub.add_parser('test')
    args, rest = parser.parse_known_args()
    if args.command == 'test':
        rest = rest[1:] if rest and rest[0] == '--' else rest
    elif rest:
        _fail(f'{args.command} 不接受额外参数: {rest}')

    info = load_registry(args.registry)
    fence(info)
    if args.command == 'verify':
        return cmd_verify(info)
    if args.command == 'serve':
        return cmd_serve(info, args.backend_root, args.data_dir)
    return cmd_test(info, rest)


if __name__ == '__main__':
    raise SystemExit(main())
