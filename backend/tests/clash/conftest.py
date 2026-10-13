"""clash 测试共享件：在 tmp 目录搭建一套**假 clashctl**（最小 bash 函数集）。

假的 clashctl.sh 复刻真实脚本的对外契约（与本仓 service.py 依赖的行为一致）：
- 函数名与参数不变（clashon/clashoff/clashstatus/clashproxy/clashtun/clashsecret/
  clashsub/_merge_config_restart/clashui/clashupgrade）
- _okcat 到 stdout 退出码 0、_failcat 到 stderr 退出码 1（带 ANSI 色码，验证剥离）
- 每次调用把 "函数 参数…" 追加到 resources/calls.log，供断言透传参数正确
- 状态类查询按 marker 文件（resources/fake-state/*.flag）决定退出码，
  写操作翻转 marker——模拟 proxy/tun 状态往返
"""
import base64

import pytest

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b"admin:lizy111A").decode()}

FAKE_SCRIPT = r"""
THIS_SCRIPT_DIR=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
BASE_DIR=$(dirname "$(dirname "$THIS_SCRIPT_DIR")")
RES="$BASE_DIR/resources"
STATE="$RES/fake-state"
mkdir -p "$STATE"

_okcat()   { printf '\033[38;2;200;214;229m😼 %s\033[0m\n' "$*"; return 0; }
_failcat() { printf '\033[38;2;253;121;168m😾 %s\033[0m\n' "$*" >&2; return 1; }

_log_call() { printf '%s\n' "$*" >>"$RES/calls.log"; }

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
_merge_config_restart() { _log_call "_merge_config_restart"; touch "$STATE/merge-restart"; _okcat '配置更新成功，已重启生效'; }
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


@pytest.fixture
def fake_clashctl(tmp_path, monkeypatch):
    """搭建假 clashctl 目录并指认 DOUBLOG_CLASHCTL_DIR，返回目录路径。"""
    base = tmp_path / 'clashctl'
    (base / 'scripts' / 'cmd').mkdir(parents=True)
    (base / 'resources').mkdir()
    (base / 'scripts' / 'cmd' / 'clashctl.sh').write_text(FAKE_SCRIPT)
    (base / '.env').write_text('KERNEL_NAME=mihomo\nCLASH_BASE_DIR=%s\n' % base)
    res = base / 'resources'
    (res / 'mixin.yaml').write_text('_custom:\n  system-proxy:\n    enable: false\n')
    (res / 'config.yaml').write_text('proxies: []\n')
    (res / 'runtime.yaml').write_text('mixed-port: 7890\n')
    (res / 'mihomo.log').write_text(''.join(f'line-{i}\n' for i in range(1, 51)))
    (res / 'profiles.yaml').write_text('profiles:\n- id: 1\n  url: https://example.com/sub\n')
    (res / 'profiles.log').write_text('2026-10-13 10:00:00 ➕ 已添加订阅：[1] https://example.com/sub\n')
    monkeypatch.setenv('DOUBLOG_CLASHCTL_DIR', str(base))
    return base


@pytest.fixture
def state_dir(fake_clashctl):
    return fake_clashctl / 'resources' / 'fake-state'


@pytest.fixture
def calls(fake_clashctl):
    """读取假脚本记录的调用清单（每行 "函数 参数…"）；尚未有调用时为空表。"""
    path = fake_clashctl / 'resources' / 'calls.log'
    return lambda: ([line for line in path.read_text().splitlines() if line]
                    if path.exists() else [])
