"""clash 测试共享件：在 tmp 目录搭建一套**假 clashctl**（最小 bash 函数集）。

假的 clashctl.sh 复刻真实脚本的对外契约（与本仓 service.py 依赖的行为一致）：
- 函数名与参数不变（clashon/clashoff/clashstatus/clashproxy/clashtun/clashsecret/
  clashsub/_merge_config_restart/clashui/clashupgrade）
- _okcat 到 stdout 退出码 0、_failcat 到 stderr 退出码 1（带 ANSI 色码，验证剥离）
- 每次调用把 "函数 参数…" 追加到 resources/calls.log，供断言透传参数正确
- 每次调用把 "proxy=yes|no" 追加到 resources/proxy-env.log（断言订阅下载剥离代理 env）
- 状态类查询按 marker 文件（resources/fake-state/*.flag）决定退出码，
  写操作翻转 marker——模拟 proxy/tun 状态往返
- BIN_YQ 与真实 common.sh 一致是**变量路径**（假环境指向 FAKE_YQ 极简脚本，
  只实现 yq -i '.log-level = "<级别>"' <file>）

另附**假 mihomo 控制器**（线程 http.server）：实现 /version /configs /proxies
/proxies/:name /proxies/:name/delay /group/:name/delay /connections /rules
/providers/proxies——校验 Bearer 密钥，记录请求供断言（含路径段编码）。
"""
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b"admin:lizy111A").decode()}

FAKE_SCRIPT = r"""
THIS_SCRIPT_DIR=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
BASE_DIR=$(dirname "$(dirname "$THIS_SCRIPT_DIR")")
RES="$BASE_DIR/resources"
STATE="$RES/fake-state"
mkdir -p "$STATE"

# 订阅下载直连验证：记录本次调用是否带了代理 env（strip_proxy 应为 no）
echo "proxy=$(env | grep -qi '^https\?_proxy=' && echo yes || echo no)" >>"$RES/proxy-env.log"

_okcat()   { printf '\033[38;2;200;214;229m😼 %s\033[0m\n' "$*"; return 0; }
_failcat() { printf '\033[38;2;253;121;168m😾 %s\033[0m\n' "$*" >&2; return 1; }

_log_call() { printf '%s\n' "$*" >>"$RES/calls.log"; }

# 真实 common.sh 的变量形态：BIN_YQ 指向 yq 可执行文件（假环境为 bin/yq 极简脚本）
BIN_YQ="$BASE_DIR/bin/yq"
CLASH_CONFIG_MIXIN="$RES/mixin.yaml"
CLASH_CONFIG_BASE="$RES/config.yaml"
CLASH_CONFIG_RUNTIME="$RES/runtime.yaml"

_flag() { [ -f "$STATE/$1" ]; }

clashstatus() {
    _log_call "clashstatus"
    if _flag running; then echo "1234 $BASE_DIR/bin/mihomo -d $RES -f $RES/runtime.yaml"; return 0; fi
    return 1
}
clashon()  { _log_call "clashon";  touch "$STATE/running"; _okcat '已开启代理环境'; }
clashoff() { _log_call "clashoff"; rm -f "$STATE/running"; _okcat '已关闭代理环境'; }
clashproxy() {
    _log_call "clashproxy $*"
    case "$1" in
    on)  touch "$STATE/proxy"; _okcat '已开启系统代理' ;;
    off) rm -f "$STATE/proxy"; _okcat '已关闭系统代理' ;;
    *)   if _flag proxy; then _okcat '系统代理：开启'; else _failcat '系统代理：关闭'; fi ;;
    esac
}
clashtun() {
    _log_call "clashtun $*"
    case "$1" in
    on)  touch "$STATE/tun"; _okcat 'Tun 模式已开启' ;;
    off) rm -f "$STATE/tun"; _okcat 'Tun 模式已关闭' ;;
    *)   if _flag tun; then _okcat 'Tun 状态：启用'; else _failcat 'Tun 状态：关闭'; fi ;;
    esac
}
clashsecret() {
    _log_call "clashsecret $*"
    if [ -n "$1" ]; then printf 'secret=%s\n' "$1" >"$STATE/secret"; _okcat '密钥更新成功，已重启生效'; fi
    _okcat "当前密钥：$(cat "$STATE/secret" 2>/dev/null | cut -d= -f2 || echo '')"
}
clashui()      { _log_call "clashui"; echo '🏠 内网：http://192.168.0.1:9090/ui'; }
clashupgrade() { _log_call "clashupgrade $*"; echo '{"status":"ok"}'; _okcat '内核升级成功'; }
_merge_config_restart() {
    _log_call "_merge_config_restart"; touch "$STATE/merge-restart"
    # 模拟真实合并：mixin 的 log-level 生效进 runtime（kernel_log_level 读 runtime）
    lvl=$(grep '^log-level:' "$RES/mixin.yaml" 2>/dev/null | head -1 | awk '{print $2}')
    if [ -n "$lvl" ]; then
        grep -v '^log-level:' "$RES/runtime.yaml" >"$RES/runtime.yaml.tmp" 2>/dev/null || : ;
        printf 'log-level: %s\n' "$lvl" >>"$RES/runtime.yaml.tmp"
        mv "$RES/runtime.yaml.tmp" "$RES/runtime.yaml"
    fi
    _okcat '配置更新成功，已重启生效'
}
clashsub() {
    _log_call "clashsub $*"
    case "$1" in
    ls)    cat "$RES/profiles.yaml" ;;
    add)   printf 'profiles:\n- id: 1\n  url: %s\n' "$2" >"$RES/profiles.yaml"
           _okcat "订阅已添加：[1] $2" ;;
    del)   [ "$2" = "9" ] && { _failcat '订阅 id 不存在，请检查'; return 1; }
           _okcat '订阅已删除' ;;
    use)   [ "$2" = "9" ] && { _failcat '订阅 id 不存在，请检查'; return 1; }
           _okcat '订阅已生效' ;;
    update) _okcat '订阅已更新' ;;
    esac
}
"""

#: 假 yq：只实现 service 用到的 `yq -i '.log-level = "<级别>"' <file>`（其余一律成功）
FAKE_YQ = """#!/usr/bin/env bash
[ "$1" = "-i" ] || exit 0
expr=$2; file=$3
case "$expr" in
'.log-level = "debug"'|'.log-level = "info"'|'.log-level = "warning"'|'.log-level = "error"'|'.log-level = "silent"')
    lvl=$(printf '%s' "$expr" | sed 's/.*"\\(.*\\)"$/\\1/')
    if grep -q '^log-level:' "$file" 2>/dev/null; then
        sed -i "s|^log-level:.*|log-level: $lvl|" "$file"
    else
        printf 'log-level: %s\\n' "$lvl" >>"$file"
    fi ;;
esac
exit 0
"""


@pytest.fixture
def fake_clashctl(tmp_path, monkeypatch):
    """搭建假 clashctl 目录并指认 DOUBLOG_CLASHCTL_DIR，返回目录路径。"""
    base = tmp_path / 'clashctl'
    (base / 'scripts' / 'cmd').mkdir(parents=True)
    (base / 'resources').mkdir()
    (base / 'bin').mkdir()
    (base / 'scripts' / 'cmd' / 'clashctl.sh').write_text(FAKE_SCRIPT)
    (base / '.env').write_text('KERNEL_NAME=mihomo\nCLASH_BASE_DIR=%s\n' % base)
    yq = base / 'bin' / 'yq'
    yq.write_text(FAKE_YQ)
    yq.chmod(0o755)
    res = base / 'resources'
    (res / 'mixin.yaml').write_text('_custom:\n  system-proxy:\n    enable: false\n')
    (res / 'config.yaml').write_text('proxies: []\n')
    (res / 'runtime.yaml').write_text('mixed-port: 7890\n')
    (res / 'mihomo.log').write_text(''.join(f'line-{i}\n' for i in range(1, 51)))
    (res / 'profiles.yaml').write_text('profiles:\n- id: 1\n  url: https://example.com/sub\n')
    (res / 'profiles.log').write_text('2026-10-13 10:00:00 ➕ 已添加订阅：[1] https://example.com/sub\n')
    monkeypatch.setenv('DOUBLOG_CLASHCTL_DIR', str(base))
    return base


# ─── 假 mihomo 控制器（external-controller REST API）────────

CONTROLLER_SECRET = 'test-secret-1'

_FAKE_PROXIES = {
    '🚀 节点选择': {'name': '🚀 节点选择', 'type': 'Selector', 'now': '香港 01',
                    'all': ['香港 01', '日本 02', '美国 03'],
                    'history': []},
    '♻️ 自动选择': {'name': '♻️ 自动选择', 'type': 'URLTest', 'now': '香港 01',
                    'all': ['香港 01', '日本 02'], 'history': []},
    '香港 01': {'name': '香港 01', 'type': 'Shadowsocks', 'udp': True, 'alive': True,
                'history': [{'time': '2026-10-13T10:00:00Z', 'delay': 42}]},
    '日本 02': {'name': '日本 02', 'type': 'Vmess', 'alive': False, 'history': []},
    '美国 03': {'name': '美国 03', 'type': 'Trojan', 'alive': True,
                'history': [{'time': 'x', 'delay': 0}]},
}


class _FakeController(BaseHTTPRequestHandler):
    """假 mihomo：校验 Bearer；记录 (method, path) 到列表；实现用到的子集。"""

    requests_log = None      # 由 fixture 注入
    selected = {}            # 组 → 当前节点（PUT 切换写入）

    def _send(self, code, payload=None):
        body = b'' if payload is None else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _authorized(self):
        return self.headers.get('Authorization') == f'Bearer {CONTROLLER_SECRET}'

    def log_message(self, *args):  # 静默
        pass

    def do_GET(self):
        self.requests_log.append(('GET', self.path))
        if not self._authorized():
            return self._send(401, {'message': 'Unauthorized'})
        from urllib.parse import urlparse, unquote
        path, query = urlparse(self.path).path, urlparse(self.path).query
        if path == '/version':
            return self._send(200, {'meta': True, 'version': 'v1.19.17-fake'})
        if path == '/configs':
            return self._send(200, {'mode': 'rule', 'allow-lan': False,
                                    'log-level': 'info', 'mixed-port': 7890})
        if path == '/proxies':
            return self._send(200, {'proxies': _FAKE_PROXIES})
        if path.startswith('/proxies/') and path.endswith('/delay'):
            name = unquote(path[len('/proxies/'):-len('/delay')])
            if name not in _FAKE_PROXIES:
                return self._send(404, {'message': 'proxy not found'})
            if 'bad' in (query or ''):
                return self._send(408, {'message': 'An error occurred in the delay test'})
            return self._send(200, {'delay': 42})
        if path.startswith('/group/') and path.endswith('/delay'):
            group = unquote(path[len('/group/'):-len('/delay')])
            if group not in _FAKE_PROXIES:
                return self._send(404, {'message': 'group not found'})
            return self._send(200, {n: 42 + i for i, n in
                                    enumerate(_FAKE_PROXIES[group]['all'])})
        if path == '/connections':
            return self._send(200, {
                'uploadTotal': 1024, 'downloadTotal': 2048, 'memory': 100,
                'connections': [{'id': 'c1', 'upload': 1, 'download': 2,
                                 'start': '2026-10-13T12:00:00+08:00',
                                 'rule': 'GeoSite', 'rulePayload': 'CN',
                                 'chains': ['🚀 节点选择', '香港 01'],
                                 'metadata': {'host': 'www.baidu.com', 'network': 'tcp',
                                              'type': 'HTTP', 'sourceIP': '127.0.0.1',
                                              'sourcePort': '40000'}}]})
        if path == '/rules':
            return self._send(200, {'rules': [
                {'type': 'DOMAIN-SUFFIX', 'payload': 'baidu.com', 'proxy': 'DIRECT'},
                {'type': 'GEOIP', 'payload': 'CN', 'proxy': 'DIRECT'},
            ]})
        if path == '/providers/proxies':
            return self._send(200, {'providers': {
                'sub1': {'name': 'sub1', 'type': 'Proxy', 'vehicleType': 'HTTP',
                         'updatedAt': '2026-10-13',
                         'subscriptionInfo': {'Upload': 1, 'Download': 2, 'Total': 100},
                         'proxies': [{'name': '香港 01', 'type': 'Shadowsocks',
                                      'alive': True, 'udp': True,
                                      'history': [{'time': 'x', 'delay': 42}]}]},
            }})
        return self._send(404, {'message': 'not found'})

    def do_PATCH(self):
        self.requests_log.append(('PATCH', self.path))
        if not self._authorized():
            return self._send(401, {'message': 'Unauthorized'})
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        if self.path == '/configs':
            if body.get('mode') not in (None, 'rule', 'global', 'direct'):
                return self._send(400, {'message': 'invalid mode'})
            return self._send(204)
        return self._send(404, {'message': 'not found'})

    def do_PUT(self):
        from urllib.parse import urlparse, unquote
        self.requests_log.append(('PUT', self.path))
        if not self._authorized():
            return self._send(401, {'message': 'Unauthorized'})
        path = urlparse(self.path).path
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        if path.startswith('/proxies/'):
            group = unquote(path[len('/proxies/'):])
            if group not in _FAKE_PROXIES:
                return self._send(404, {'message': 'proxy not found'})
            _FakeController.selected[group] = body.get('name')
            return self._send(204)
        if path.startswith('/providers/proxies/'):
            return self._send(204)
        return self._send(404, {'message': 'not found'})

    def do_DELETE(self):
        self.requests_log.append(('DELETE', self.path))
        if not self._authorized():
            return self._send(401, {'message': 'Unauthorized'})
        if self.path == '/connections' or self.path.startswith('/connections/'):
            return self._send(204)
        return self._send(404, {'message': 'not found'})


@pytest.fixture
def fake_controller(fake_clashctl):
    """启动假 mihomo 控制器（随机端口），runtime.yaml 指向它；返回 (port, 请求日志)。"""
    log = []
    _FakeController.requests_log = log
    _FakeController.selected = {}
    server = ThreadingHTTPServer(('127.0.0.1', 0), _FakeController)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    (fake_clashctl / 'resources' / 'runtime.yaml').write_text(
        f'mixed-port: 7890\nexternal-controller: 127.0.0.1:{port}\n'
        f'secret: {CONTROLLER_SECRET}\n')
    yield port, log
    server.shutdown()
    server.server_close()


@pytest.fixture
def state_dir(fake_clashctl):
    return fake_clashctl / 'resources' / 'fake-state'


@pytest.fixture
def calls(fake_clashctl):
    """读取假脚本记录的调用清单（每行 "函数 参数…"）；尚未有调用时为空表。"""
    path = fake_clashctl / 'resources' / 'calls.log'
    return lambda: ([line for line in path.read_text().splitlines() if line]
                    if path.exists() else [])


@pytest.fixture
def proxy_env_log(fake_clashctl):
    """读取假脚本记录的代理 env 出现情况（每次调用一行 proxy=yes|no）。"""
    path = fake_clashctl / 'resources' / 'proxy-env.log'
    return lambda: ([line for line in path.read_text().splitlines() if line]
                    if path.exists() else [])
