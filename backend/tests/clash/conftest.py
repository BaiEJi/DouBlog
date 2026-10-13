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
