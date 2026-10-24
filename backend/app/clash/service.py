"""
clashctl 复用层：所有能力经 bash source 真实的 clashctl 脚本执行，不在 Python 重实现。

- 子进程统一 `bash -c '. "$0"; <函数> "$@"' <脚本> [参数...]`：参数走 argv 注入，
  不经 shell 字符串拼接（结构性防注入）；stdin=DEVNULL——clashctl 的 _error_quit
  会 `exec $SHELL -i`，无 stdin 时立即 EOF 退出而不是挂起
- 输出合并 stdout/stderr 并剥离 ANSI 色码（clashctl 的 _okcat/_failcat 带真彩色）
- 状态语义沿用 clashctl 约定：查询类函数退出码 0=开启/启用、1=关闭/失败
  （clashproxy / clashtun 靠它判定，勿改成解析中文输出）
"""
import os
import re
import shutil
import subprocess

import yaml

from app.shared.yamlfast import YamlLoader
from lizysdk.errors import NotFoundError, ParamError, UpstreamTimeoutError

#: ANSI 转义序列（SGR 参数串 + 字母结尾）
_ANSI_RE = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]')

DEFAULT_TIMEOUT = 30        # 常规命令（启停/切换/删除）
SUB_TIMEOUT = 90            # 订阅添加/更新（含下载 + 可能的订阅转换）
UPGRADE_TIMEOUT = 120       # 内核升级（内核自行下载，耗时不可控）

#: 订阅链接：http(s):// 或 file:// 开头，不含空白/引号/控制字符
_URL_RE = re.compile(r'^(?:https?|file)://[^\s\'"<>\x00-\x1f]+$')
#: Web 密钥：非空、可打印、不含空白与引号（clashctl 的 yq 内联写法限制）
_SECRET_RE = re.compile(r'^[!-~]{1,64}$')
_SECRET_BAD = set(' \t"\'`$')

CONFIG_FILES = {             # ?file= 参数 → 磁盘路径（base 即订阅原始配置 config.yaml）
    'mixin': 'mixin.yaml',
    'base': 'config.yaml',
    'runtime': 'runtime.yaml',
}

MAX_TAIL_LINES = 5000


def base_dir() -> str:
    """clashctl 安装目录：环境变量覆盖 > 默认 ~/clashctl。"""
    return os.environ.get('DOUBLOG_CLASHCTL_DIR') or os.path.expanduser('~/clashctl')


def script_path() -> str:
    return os.path.join(base_dir(), 'scripts', 'cmd', 'clashctl.sh')


def resources_dir() -> str:
    return os.path.join(base_dir(), 'resources')


def is_available() -> bool:
    return os.path.isfile(script_path())


def ensure_available():
    if not is_available():
        raise NotFoundError(message=f'clashctl 未安装（未找到 {script_path()}）')


def kernel_name() -> str:
    """解析安装目录 .env 的 KERNEL_NAME（mihomo/clash），供展示；失败回退空串。"""
    try:
        with open(os.path.join(base_dir(), '.env'), encoding='utf-8') as f:
            for line in f:
                m = re.match(r'^\s*KERNEL_NAME\s*=\s*(\S+)', line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return ''


#: 代理环境变量（订阅下载前剥离——后端进程继承的 *_proxy 指向本机 clash，
#: 而下载订阅发生在内核规则之外：出口节点不可达时 curl 全部超时，直连通常更稳）
_PROXY_ENV_KEYS = ('http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy',
                   'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY')

LOG_LEVELS = ('debug', 'info', 'warning', 'error', 'silent')


def run_clashctl(func: str, args=None, timeout=DEFAULT_TIMEOUT, strip_proxy=False) -> tuple:
    """source clashctl.sh 后调用指定函数，返回 (退出码, 去色后的合并输出)。

    strip_proxy=True 时从子进程环境移除 *_proxy（订阅下载用：不跟随会话代理，
    避免本机 clash 出口故障拖垮订阅更新；no_proxy=* 双保险）。
    """
    # Windows CreateProcess searches System32 before PATH for a bare "bash".
    # Resolve PATH explicitly so a configured Git Bash wins over the WSL stub.
    bash = shutil.which('bash') or 'bash'
    argv = [bash, '-c', f'. "$0"; {func} "$@"', script_path(), *(args or ())]
    env = {**os.environ, 'TERM': 'dumb'}
    if strip_proxy:
        for key in _PROXY_ENV_KEYS:
            env.pop(key, None)
        env['no_proxy'] = '*'
        env['NO_PROXY'] = '*'
    try:
        proc = subprocess.run(
            argv, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise UpstreamTimeoutError(
            message=f'clashctl {func} 执行超时（>{timeout}s），已中止') from None
    output = _ANSI_RE.sub('', proc.stdout.decode('utf-8', 'replace')).strip()
    return proc.returncode, output


def _require_ok(func: str, output: str, rc: int):
    """动作类命令失败（退出码非 0）→ 400 并透传 clashctl 的首行输出给前端。"""
    if rc != 0:
        raise ParamError(message=output.splitlines()[0] if output else f'{func} 执行失败')


def tail_lines(path: str, n: int):
    """读文件末尾 n 行（utf-8 容错）；文件不存在返回 None。倒序分块读，不整读大日志。"""
    if not os.path.isfile(path):
        return None
    n = max(1, min(n, MAX_TAIL_LINES))
    with open(path, 'rb') as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        buf = b''
        while pos > 0 and buf.count(b'\n') <= n:
            step = min(4096, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step) + buf
    lines = buf.decode('utf-8', 'replace').splitlines()
    return '\n'.join(lines[-n:])


# ─── 内核 / 系统代理 / Tun ────────────────────────────────

def kernel_status() -> dict:
    rc, out = run_clashctl('clashstatus')
    return {'running': rc == 0, 'output': out}


def kernel_start() -> dict:
    rc, out = run_clashctl('clashon')
    _require_ok('clashon', out, rc)
    return {'output': out}


def kernel_stop() -> dict:
    rc, out = run_clashctl('clashoff')
    _require_ok('clashoff', out, rc)
    return {'output': out}


def system_proxy_get() -> dict:
    rc, out = run_clashctl('clashproxy')
    return {'enabled': rc == 0, 'output': out}


def system_proxy_set(enable: bool) -> dict:
    rc, out = run_clashctl('clashproxy', ['on' if enable else 'off'])
    _require_ok('clashproxy', out, rc)
    return {'output': out}


def tun_get() -> dict:
    rc, out = run_clashctl('clashtun')
    return {'enabled': rc == 0, 'output': out}


def tun_set(enable: bool) -> dict:
    # Tun 需 sudo 重启内核；无免密 sudo 时 clashctl 会失败，输出原样透传
    rc, out = run_clashctl('clashtun', ['on' if enable else 'off'], timeout=60)
    _require_ok('clashtun', out, rc)
    return {'output': out}


# ─── Web 控制台 / 密钥 / 升级 ──────────────────────────────

def ui_addresses() -> dict:
    _, out = run_clashctl('clashui', timeout=15)
    return {'output': out}


def secret_get() -> dict:
    _, out = run_clashctl('clashsecret')
    secret = ''
    for line in out.splitlines():
        if '当前密钥' in line:
            secret = line.split('：', 1)[-1].strip()
    return {'secret': secret, 'output': out}


def secret_set(secret: str) -> dict:
    if not secret or any(c in _SECRET_BAD for c in secret) or not _SECRET_RE.match(secret):
        raise ParamError(message='密钥不能包含空格、引号或特殊字符（1-64 位可打印字符）')
    rc, out = run_clashctl('clashsecret', [secret])
    _require_ok('clashsecret', out, rc)
    return {'output': out}


def upgrade(channel: str = '') -> dict:
    if channel not in ('', 'release', 'alpha'):
        raise ParamError(message='channel 只能是 release 或 alpha')
    args = {'release': ['-r'], 'alpha': ['-a'], '': []}[channel]
    rc, out = run_clashctl('clashupgrade', args, timeout=UPGRADE_TIMEOUT)
    _require_ok('clashupgrade', out, rc)
    return {'output': out}


# ─── 配置文件（Mixin 可编辑；base/runtime 只读）────────────

def config_read(which: str) -> dict:
    name = CONFIG_FILES.get(which)
    if not name:
        raise ParamError(message='file 只能是 mixin、base 或 runtime')
    path = os.path.join(resources_dir(), name)
    if not os.path.isfile(path):
        raise NotFoundError(message=f'配置文件不存在：{path}')
    with open(path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    return {'file': which, 'path': path, 'editable': which == 'mixin', 'content': content}


def config_write_mixin(content: str) -> dict:
    path = os.path.join(resources_dir(), 'mixin.yaml')
    if not os.path.isfile(path):
        raise NotFoundError(message=f'配置文件不存在：{path}')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    # 与 clashmixin -e 保存后完全一致：合并配置并重启内核
    rc, out = run_clashctl('_merge_config_restart')
    _require_ok('_merge_config_restart', out, rc)
    return {'output': out}


def kernel_log_tail(n: int) -> dict:
    path = os.path.join(resources_dir(), 'mihomo.log')
    content = tail_lines(path, n)
    if content is None:
        raise NotFoundError(message=f'日志文件不存在：{path}')
    return {'path': path, 'tail': n, 'level': kernel_log_level(), 'content': content}


def kernel_log_level():
    """当前生效日志级别（runtime.yaml 的 log-level；缺省=info——mihomo 默认）。"""
    try:
        with open(os.path.join(resources_dir(), 'runtime.yaml'), encoding='utf-8',
                  errors='replace') as f:
            data = yaml.load(f, Loader=YamlLoader) or {}
        level = data.get('log-level') if isinstance(data, dict) else None
        return level if level in LOG_LEVELS else 'info'
    except (OSError, yaml.YAMLError):
        return 'info'


def kernel_log_level_set(level: str) -> dict:
    """写 mixin 的 log-level 并合并重启（等价 clashmixin -e 改一行后保存）。

    订阅原始配置常带 log-level: silent——内核静默后 mihomo.log 不再增长，
    页面日志无从实时；提级到 info/debug 才有内容可刷。
    """
    if level not in LOG_LEVELS:
        raise ParamError(message='level 只能是 debug / info / warning / error / silent')
    # level 已过白名单，内联安全；"$@" 兜底追加到 _merge_config_restart（忽略参数）
    cmd = (f'"$BIN_YQ" -i \'.log-level = "{level}"\' "$CLASH_CONFIG_MIXIN" '
           '&& _merge_config_restart')
    rc, out = run_clashctl(cmd, timeout=60)
    _require_ok('log-level', out, rc)
    return {'output': out, 'level': kernel_log_level()}


# ─── 订阅管理 ─────────────────────────────────────────────

def sub_list() -> dict:
    _, out = run_clashctl('clashsub', ['ls'])
    try:
        data = yaml.load(out, Loader=YamlLoader) or {}
    except yaml.YAMLError:
        raise ParamError(message='订阅列表解析失败（clashsub ls 输出非 YAML）') from None
    if not isinstance(data, dict):
        data = {}
    profiles = data.get('profiles') or []
    return {
        'use': data.get('use'),
        'profiles': [
            {'id': p.get('id'), 'url': p.get('url') or '', 'path': p.get('path') or ''}
            for p in profiles if isinstance(p, dict)
        ],
    }


def _check_sub_id(id_value) -> str:
    if not isinstance(id_value, int) or isinstance(id_value, bool) or id_value < 1:
        raise ParamError(message='订阅 id 必须是正整数')
    return str(id_value)


def sub_add(url: str) -> dict:
    if not isinstance(url, str) or not _URL_RE.match(url) or len(url) > 2048:
        raise ParamError(message='订阅链接必须以 http(s):// 或 file:// 开头，且不含空格/引号')
    # 下载直连（strip_proxy）：后端环境继承的 *_proxy 指向本机 clash，出口不可达时必挂
    rc, out = run_clashctl('clashsub', ['add', url], timeout=SUB_TIMEOUT, strip_proxy=True)
    _require_ok('clashsub add', out, rc)
    return {'output': out}


def sub_del(id_value) -> dict:
    rc, out = run_clashctl('clashsub', ['del', _check_sub_id(id_value)])
    _require_ok('clashsub del', out, rc)
    return {'output': out}


def sub_use(id_value) -> dict:
    rc, out = run_clashctl('clashsub', ['use', _check_sub_id(id_value)], timeout=SUB_TIMEOUT)
    _require_ok('clashsub use', out, rc)
    return {'output': out}


def sub_update(id_value=None, convert: bool = False, auto: bool = False) -> dict:
    # 注意 flag 必须在 id 之前（clashctl 的 _sub_update 在 for 循环里 shift）
    args = ['update']
    if auto:
        args.append('--auto')
    if convert:
        args.append('--convert')
    if id_value is not None:
        args.append(_check_sub_id(id_value))
    # 下载直连（同 sub_add）
    rc, out = run_clashctl('clashsub', args, timeout=SUB_TIMEOUT, strip_proxy=True)
    _require_ok('clashsub update', out, rc)
    return {'output': out}


def sub_log_tail(n: int) -> dict:
    path = os.path.join(resources_dir(), 'profiles.log')
    content = tail_lines(path, n)
    if content is None:
        raise NotFoundError(message=f'订阅日志不存在：{path}')
    return {'path': path, 'tail': n, 'content': content}
