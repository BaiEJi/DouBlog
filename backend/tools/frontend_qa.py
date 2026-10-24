# -*- coding: utf-8 -*-
"""公共前端模块（frontend）专属 QA 引导入口：verify / serve / pytest。

仅供前端任务 QA 使用，不修改生产配置。核心约束（见
_collab/DouBlog/modules/frontend/PLAN.md v1.1.0 第 6 节）：

1. 必须在任何 `app.main` 导入之前完成进程环境与 settings 隔离注入；
2. 使用默认用户（admin，由空库按现有配置首次播种）——不覆盖
   settings.auth_username/auth_password，不创建替代账号；密码只经
   本模块数据目录下的凭据文件传递给浏览器工具，不写入报告/命令行；
3. 数据目录固定在本模块 worktree 的 .qa/frontend 下（默认
   data-defaultuser，独立空库），绝不读写业务 PG 或源 data/；
4. serve 只用登记表端口（frontend：20160/20161），host=127.0.0.1；
5. pytest 完整跑 tests/，--basetemp 指向本模块目录，返回 pytest 原始退出码，
   并保留 conftest 既有默认认证约定（不注入任何账号）；
6. 进程围栏：拒绝受保护端口 60100/60101；解释器必须与登记表 conda.prefix
   精确一致（规范化路径比较），启动即禁用用户 site（检查 sys.flags）。

用法（工作目录 = 本模块 backend/）：
  python tools/frontend_qa.py verify --module frontend --registry <collaboration.json>
  python tools/frontend_qa.py serve  --module frontend --registry <collaboration.json> [--seed]
  python tools/frontend_qa.py pytest --module frontend --registry <collaboration.json> [-- pytest args...]
"""
import argparse
import importlib.util
import json
import os
import socket
import sys
from datetime import date, datetime, timezone
from pathlib import Path

QA_SECRET = 'frontend-module-qa-secret-20160'
DEFAULT_DATA_DIR = 'data-defaultuser'   # 独立空库：默认用户按现有配置首次播种


def fail(message):
    print(f'[frontend_qa] 拒绝启动：{message}', file=sys.stderr)
    raise SystemExit(2)


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('verify', 'serve', 'pytest'))
    parser.add_argument('--module', default='frontend')
    parser.add_argument('--registry', required=True)
    parser.add_argument('--seed', action='store_true', help='serve 模式：空库时播种演示数据')
    parser.add_argument('--data-dir', default=DEFAULT_DATA_DIR,
                        help='模块数据目录名（位于 .qa/frontend 下；默认独立空库 data-defaultuser）')
    known, pytest_args = parser.parse_known_args(argv)
    return known, pytest_args


def resolve_registry(args):
    registry_path = Path(args.registry)
    if not registry_path.is_file():
        fail(f'登记表不存在：{registry_path}')
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    entry = registry.get('modules', {}).get(args.module)
    if not entry:
        fail(f'登记表没有 {args.module} 条目')
    backend_dir = Path(__file__).resolve().parents[1]
    module_root = backend_dir.parent
    worktree_root = Path(registry['worktree_root'])
    expected_root = worktree_root / registry['worktree_directory_pattern'].format(module=args.module)
    if module_root.resolve() != expected_root.resolve():
        fail(f'当前 worktree {module_root} 与登记表期望 {expected_root} 不一致')
    if backend_dir.name != 'backend' or not (backend_dir / 'app' / 'main.py').is_file():
        fail('必须以本模块 backend/ 为包根运行')
    backend_port = int(entry['backend_port'])
    reserved_lo, reserved_hi = entry['reserved_range']
    protected = set(registry['ports']['protected'])
    overlap = protected & set(range(reserved_lo, reserved_hi + 1))
    if overlap:
        fail(f'登记端口与保护端口重叠：{sorted(overlap)}')
    return {
        'registry_path': registry_path,
        'registry': registry,
        'backend_dir': backend_dir,
        'module_root': module_root,
        'backend_port': backend_port,
        'frontend_port': int(entry['frontend_port']),
        'reserved': (reserved_lo, reserved_hi),
        'protected_ports': protected,
        'conda_prefix': Path(registry['conda']['prefix']).resolve(),
    }


def hygiene_environment(ctx):
    """进程级环境收敛 + 解释器/依赖来源严格校验（F05）。"""
    os.environ['PYTHONUTF8'] = '1'
    os.environ['PYTHONNOUSERSITE'] = '1'
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    os.environ.pop('PYTHONPATH', None)
    os.environ['DOUBLOG_TESTING'] = '1'
    os.environ['DOUBLOG_LOG_SEND'] = '0'
    os.environ['DOUBLOG_CLASHCTL_DIR'] = str(ctx['qa_data'] / 'clashctl')
    exe = Path(sys.executable).resolve()
    # 解释器必须与登记表 conda.prefix 精确一致（规范化路径），拒绝 base/其他环境/venv
    if exe != ctx['conda_prefix'] / 'python.exe':
        fail(f'解释器与登记 conda.prefix 不符：{exe} != {ctx["conda_prefix"] / "python.exe"}')
    # 用户 site 必须在解释器启动时就已禁用（环境变量只在运行中设置不算数）
    if not sys.flags.no_user_site:
        fail('解释器启动时未禁用用户 site（需以 PYTHONNOUSERSITE=1 启动进程）')
    for entry in sys.path:
        lowered = str(entry).replace('\\', '/').lower()
        if 'site-packages' in lowered and ctx['conda_prefix'].as_posix().lower() not in lowered:
            fail(f'sys.path 混入非 dev 环境 site-packages：{entry}')
    for package in ('fastapi', 'uvicorn', 'pytest', 'lizysdk'):
        spec = importlib.util.find_spec(package)
        if spec is None or not spec.origin:
            fail(f'关键包 {package} 不可导入')
        origin = Path(spec.origin).resolve()
        if ctx['conda_prefix'] not in origin.parents:
            fail(f'{package} 不在登记 dev 环境内：{origin}')
    print(f'[frontend_qa] 解释器 {exe}（登记 dev 前缀一致，no_user_site={sys.flags.no_user_site}）')


def prepare_qa_dirs(ctx):
    qa_root = ctx['module_root'] / '.qa' / 'frontend'
    data_dir = qa_root / ctx['data_dir_name']
    if not str(data_dir.resolve()).startswith(str(qa_root.resolve())):
        fail(f'数据目录越界：{data_dir}')
    for name in ('images', 'logs', 'dead_letters', 'tmp'):
        (data_dir / name).mkdir(parents=True, exist_ok=True)
    for name in ('logs', 'tmp', 'pytest-tmp', 'chrome-profile', 'bench-profile'):
        (qa_root / name).mkdir(parents=True, exist_ok=True)
    db_config = data_dir / 'db_config.json'
    if not db_config.exists():
        db_config.write_text(json.dumps({'backend': 'sqlite'}), encoding='utf-8')
    # 日志配置文件优先级高于 settings：显式关闭外发并指向本模块后端。
    (data_dir / 'logs_config.json').write_text(json.dumps({
        'enabled': False,
        'url': f'http://127.0.0.1:{ctx["backend_port"]}/api/v1/logs',
        'level': 'WARNING',
    }), encoding='utf-8')
    ctx['qa_root'] = qa_root
    ctx['qa_data'] = data_dir


def install_loopback_guard(ctx):
    """QA 围栏：仅放行回环 + 本模块保留块端口；显式拒绝受保护端口 60100/60101。"""
    allowed_ports = set(range(ctx['reserved'][0], ctx['reserved'][1] + 1))
    protected = ctx['protected_ports']
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def check(address):
        if not isinstance(address, tuple):
            return
        host, port = address[0], address[1]
        if host not in ('127.0.0.1', 'localhost', '::1', b'127.0.0.1', b'localhost', b'::1', None):
            raise OSError('隔离 QA 禁止非回环连接')
        if port in protected:
            raise OSError(f'隔离 QA 禁止访问受保护端口 {port}')

    def guarded_connect(sock, address):
        check(address)
        return real_connect(sock, address)

    def guarded_connect_ex(sock, address):
        check(address)
        return real_connect_ex(sock, address)

    def guarded_getaddrinfo(host, *args, **kwargs):
        if host not in ('127.0.0.1', 'localhost', '::1', b'127.0.0.1', b'localhost', b'::1', None):
            raise OSError('隔离 QA 禁止非回环 DNS')
        return real_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.getaddrinfo = guarded_getaddrinfo
    print(f'[frontend_qa] 网络围栏：仅回环；放行保留块 {sorted(allowed_ports)}；拒绝保护端口 {sorted(protected)}')


def import_isolated_app(ctx):
    """按正确顺序注入 settings 后导入 app.main，返回应用对象。
    默认用户：不覆盖 auth_username/auth_password——空库由 system 模块按
    现有配置首次播种 admin（PLAN v1.1.0 F07）。"""
    sys.path.insert(0, str(ctx['backend_dir']))
    from app.config import settings  # noqa: E402  此时绝不能提前导入 app.main
    settings.host = '127.0.0.1'
    settings.port = ctx['backend_port']
    settings.debug = False
    settings.data_dir = str(ctx['qa_data'])
    settings.images_dir = str(ctx['qa_data'] / 'images')
    settings.database_backend = 'sqlite'
    settings.logs_send_json = False
    settings.logs_send_url = f'http://127.0.0.1:{ctx["backend_port"]}/api/v1/logs'
    settings.secret_key = QA_SECRET

    from app.main import app, MODULES  # noqa: E402
    loaded = list(app.state.loaded_modules)
    if len(loaded) != len(MODULES):
        fail(f'模块加载不完整：{len(loaded)}/{len(MODULES)}')
    engine_url = str(app.state.engine.url)
    if not engine_url.startswith('sqlite:///'):
        fail(f'引擎不是 SQLite：{engine_url}')
    if str(Path(engine_url.replace('sqlite:///', '', 1)).resolve().parent) != str(ctx['qa_data'].resolve()):
        fail(f'数据库文件不在隔离目录：{engine_url}')
    print(f'[frontend_qa] app 已按隔离 settings 构建：modules={len(loaded)} engine=sqlite '
          f'port={settings.port} data_dir={settings.data_dir} default_user={settings.auth_username}')
    return app


def check_ports_free(ctx):
    for port in (ctx['backend_port'],):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                fail(f'端口 {port} 已被占用（登记表冲突处理：报告协调者，不杀占用者）')


def write_credentials_file(ctx):
    """默认用户凭据文件（浏览器工具读取；位于模块 .qa 目录，不进 git、不写报告）。"""
    from app.config import settings
    target = ctx['qa_root'] / 'qa-credentials.json'
    target.write_text(json.dumps({
        'username': settings.auth_username,
        'password': settings.auth_password,
        'frontend': f'http://127.0.0.1:{ctx["frontend_port"]}',
        'backend': f'http://127.0.0.1:{ctx["backend_port"]}',
        'data_dir': str(ctx['qa_data']),
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False), encoding='utf-8')
    print(f'[frontend_qa] 默认用户凭据已写入 {target}（仅本机模块目录，供 QA 工具读取）')


def seed_demo_data(app, ctx):
    """空库时播种最小演示数据：分类 + 四象限任务 + 知识库文章。
    只写隔离库；author 使用默认用户名（settings.auth_username）。"""
    from app.config import settings
    manifest_path = ctx['qa_data'] / 'frontend-seed.json'
    if manifest_path.exists():
        print('[frontend_qa] 演示数据已存在，跳过播种')
        return
    from app.todo.models import Category as TodoCategory, Task as TodoTask
    from app.blog.models import Post, Workspace
    from app.mindmap.models import MindMap
    from app.gamemap.models import Game, Chapter, Board, BoardNode, Character, ChapterRelation, RelationType
    now = datetime.now(timezone.utc)
    today = date.today()
    from sqlalchemy.orm import Session
    with Session(app.state.engine) as session:
        categories = [
            TodoCategory(id='qa-cat-work', name='工作', color='#6366F1', sort_order=0,
                         created_at=now, updated_at=now),
            TodoCategory(id='qa-cat-life', name='生活', color='#10B981', sort_order=1,
                         created_at=now, updated_at=now),
        ]
        session.add_all(categories)
        quadrants = [
            ('重要且紧急：修复线上白屏问题', True, True),
            ('重要不紧急：梳理前端打开链路', True, False),
            ('紧急不重要：回复协作文档评论', False, True),
            ('不重要不紧急：整理浏览器书签', False, False),
        ]
        for index, (title, important, urgent) in enumerate(quadrants):
            session.add(TodoTask(
                id=f'qa-task-{index}', title=title, description='frontend 模块隔离 QA 演示数据',
                category_id=categories[index % 2].id,
                is_important=important, is_urgent=urgent,
                position=(index + 1) * 1024.0, status='pending',
                task_date=today, created_at=now, updated_at=now,
            ))
        session.add(TodoTask(
            id='qa-task-inbox', title='收件箱：无日期任务示例', description=None,
            category_id=None, is_important=False, is_urgent=False,
            position=1024.0, status='pending', task_date=None,
            created_at=now, updated_at=now,
        ))
        workspace = Workspace(name='前端优化验收库', created_at=now, updated_at=now)
        session.add(workspace)
        session.flush()
        posts = [
            Post(title='DouBlog 前端优化说明', name='frontend-optimization',
                 content='# 前端优化\n\n本文章由 frontend_qa 播种，用于验收公共外壳与侧栏。\n\n- 首帧与启动恢复\n- 认证截止时间\n- 侧栏拖动与折叠\n',
                 summary='公共前端模块验收演示文章', workspace_id=workspace.id,
                 level=0, author=settings.auth_username, status='published', created_at=now, updated_at=now),
            Post(title='Markdown 演示', name='markdown-demo',
                 content='# Markdown\n\n正文、`code` 与列表。\n\n```js\nconsole.log("ok")\n```\n',
                 summary='渲染管线演示', workspace_id=workspace.id,
                 level=0, author=settings.auth_username, status='published', created_at=now, updated_at=now),
        ]
        session.add_all(posts)
        # 导图种子：3 节点最小有效文档（结构与 validation.default_document 一致）
        import uuid as _uuid
        session.add(MindMap(
            name='前端优化导图', workspace_id=workspace.id, post_id=None,
            document={
                'root': {'data': {'uid': str(_uuid.uuid4()), 'text': '前端优化', 'expand': True}, 'children': [
                    {'data': {'uid': str(_uuid.uuid4()), 'text': '打开速度', 'expand': True}, 'children': []},
                    {'data': {'uid': str(_uuid.uuid4()), 'text': '白屏恢复', 'expand': True}, 'children': []},
                ]},
                'layout': 'logicalStructure', 'theme': {'template': 'default', 'config': {}},
            },
            schema_version=1, revision=1, node_count=3,
            created_by=settings.auth_username, updated_by=settings.auth_username,
            created_at=now, updated_at=now,
        ))
        # 剧情图谱种子：1 游戏 / 1 章节 / 30 人物 / 45 关系（照 optimization_qa_server.seed_graph）
        game = Game(name='前端验收图谱', description='isolated frontend fixture')
        session.add(game); session.flush()
        chapter = Chapter(game_id=game.id, title='第一章', order_index=1)
        session.add(chapter); session.flush()
        board = Board(chapter_id=chapter.id)
        session.add(board); session.flush()
        characters = []
        for i in range(30):
            character = Character(game_id=game.id, name=f'人物 {i:03}', faction=f'阵营 {i % 3}')
            session.add(character); session.flush(); characters.append(character)
            session.add(BoardNode(board_id=board.id, character_id=character.id,
                                  x=(i % 6) * 330, y=(i // 6) * 240))
        relation_type = session.query(RelationType).filter(RelationType.game_id.is_(None)).first()
        for i in range(45):
            session.add(ChapterRelation(board_id=board.id,
                from_character_id=characters[i % 30].id,
                to_character_id=characters[(i * 7 + 1 + (i // 30) * 3) % 30].id,
                relation_type_id=relation_type.id, description=f'关系 {i}'))
        session.commit()
    manifest_path.write_text(json.dumps({
        'seeded_at': now.isoformat(), 'tasks': 5, 'posts': 2, 'mindmaps': 1, 'gamemap': {'games': 1, 'characters': 30, 'relations': 45},
        'author': settings.auth_username,
    }, ensure_ascii=False), encoding='utf-8')
    print('[frontend_qa] 已播种演示数据：todo 5 / 文章 2 / 导图 1 / 图谱(30 人物 45 关系)（author=默认用户）')


def run_serve(app, ctx, seed):
    if seed:
        seed_demo_data(app, ctx)
    write_credentials_file(ctx)
    import uvicorn
    print(f'[frontend_qa] serve http://127.0.0.1:{ctx["backend_port"]} （uvicorn 单进程，reload=False，默认用户）')
    uvicorn.run(app, host='127.0.0.1', port=ctx['backend_port'],
                reload=False, workers=1, log_level='info')


def run_pytest(ctx, extra_args):
    """settings 已注入后进入 pytest.main；conftest 再按测试逐个隔离临时 SQLite
    （保留既有默认认证 fixture，不注入任何账号）。"""
    import pytest
    argv = ['tests', '-q', f'--basetemp={ctx["qa_root"] / "pytest-tmp"}']
    for item in extra_args:
        if item == '--':
            continue
        argv.append(item)
    print(f'[frontend_qa] pytest argv={argv}')
    code = pytest.main(argv)
    print(f'[frontend_qa] pytest 退出码 = {code}')
    return code


def main(argv=None):
    args, pytest_args = parse_args(argv if argv is not None else sys.argv[1:])
    ctx = resolve_registry(args)
    ctx['data_dir_name'] = args.data_dir
    prepare_qa_dirs(ctx)
    hygiene_environment(ctx)
    install_loopback_guard(ctx)
    if args.command == 'serve':
        check_ports_free(ctx)
    app = import_isolated_app(ctx)
    if args.command == 'verify':
        from app.config import settings
        from app.system.accounts import verify_account
        if not verify_account(settings.auth_username, settings.auth_password):
            fail('默认用户播种/校验失败（空库应按现有配置播种 admin）')
        print(f'[frontend_qa] verify 通过：登记、路径、解释器（dev 精确匹配）、包来源、'
              f'隔离 settings、{len(app.state.loaded_modules)} 模块、默认用户 {settings.auth_username}、围栏与端口全部一致')
        return 0
    if args.command == 'serve':
        run_serve(app, ctx, args.seed)
        return 0
    return run_pytest(ctx, pytest_args)


if __name__ == '__main__':
    raise SystemExit(main())
