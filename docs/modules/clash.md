# Clash 模块（代理管理，2026-10-13 新增）

> 数据表：无　路由前缀：/api/clash　前端：/clash（门户"Clash 代理"卡）　sys_name：doublog.clash
> 后端 `app/clash/`；前端 `src/clash/`。**底层能力完全复用本机 clashctl**（bash 函数集），本模块只做 Web 管理迁移，不在 Python 重实现任何 clashctl 逻辑。

## 1. 模块契约（app/clash/__init__.py）

- 导出 `router`（17 端点，/api/clash/*，router 级 require_basic + 信封，处理器全部 sync def——subprocess 阻塞数秒，FastAPI 自动扔线程池不占事件循环）；无表、无后台线程（不需要 start_background / ensure_migrations，不进 MODULES_WITH_DB）

## 2. 安装检测与置灰

- 检测规则：`DOUBLOG_CLASHCTL_DIR`（环境变量覆盖，测试用）默认 `~/clashctl` 下存在 `scripts/cmd/clashctl.sh` 即视为已安装（对应 clash-for-linux-install 的 `CLASH_BASE_DIR`）
- `GET /api/clash/availability` 返回 `{available, base_dir, kernel}`（kernel 解析自安装目录 `.env` 的 KERNEL_NAME）——**未安装时 available=false 不报错**，门户据此把 Clash 卡片置灰（置灰卡不可进入但仍可拖拽归组）；其余端点在未安装时统一 404（`clashctl 未安装`）
- 前端检测失败/后端不可达时**不置灰**（避免后端抖动误伤）

## 3. 复用机制（service.py，核心）

- 所有能力经 `bash -c '. "$0"; <函数> "$@"' <脚本> [参数...]` source 真实 clashctl 后调用其函数（clashon/clashoff/clashstatus/clashproxy/clashtun/clashsecret/clashui/clashupgrade/clashsub/_merge_config_restart）
- **参数走 argv 注入不经 shell 拼接**（结构性防注入），另有正则校验：订阅 URL 必须 `http(s)://` 或 `file://` 开头且不含空白/引号；密钥限 1-64 位可打印字符且不含空格/引号；订阅 id 必须正整数；channel 限 release/alpha
- stdin=DEVNULL：clashctl 的 `_error_quit` 会 `exec $SHELL -i`，无 stdin 时立即 EOF 退出而不是挂起；全部调用带 subprocess timeout（常规 30s / 订阅 90s / 升级 120s），超时抛 UpstreamTimeoutError
- 输出合并 stdout/stderr 后剥离 ANSI 色码（clashctl 的 cat 提示带真彩色）
- **状态语义沿用 clashctl 约定**：查询类函数退出码 0=开启/启用、1=关闭/失败（clashproxy / clashtun 判定靠它，勿改成解析中文输出）
- 信封 message 取输出中 😼/😾 开头的猫叫行，无则取末行（🎉 结论行）
- 动作失败（退出码非 0）→ ParamError 400，clashctl 首行输出原样透传给前端 toast
- 只读面不经过 bash：内核日志/订阅日志读文件尾部 N 行（倒序分块，`?tail=` 1-5000，默认 200）；配置文件直读 resources/{mixin,config,runtime}.yaml（对应 clashmixin / -c / -r）
- mixin 保存 = 写文件后调 `_merge_config_restart`（与 `clashmixin -e` 保存后完全一致：合并 + 重启内核）；base/runtime 只读（base 由订阅管理生成，runtime 由合并生成）

## 4. API 一览（与 clashctl 命令一一对应）

| HTTP | 路径 | clashctl 等价 | 说明 |
|---|---|---|---|
| GET | /api/clash/availability | — | 安装检测（门户置灰依据） |
| GET | /api/clash/status | clashctl status | {running, output}（pgrep 判定） |
| POST | /api/clash/on | clashctl on | 启动内核 + 系统代理 |
| POST | /api/clash/off | clashctl off | pkill 内核 + 解除代理 |
| GET | /api/clash/proxy | clashctl proxy | {enabled, output} |
| POST | /api/clash/proxy | clashctl proxy on/off | body {enable}（写 mixin `_custom.system-proxy.enable`） |
| GET | /api/clash/tun | clashctl tun | {enabled, output} |
| POST | /api/clash/tun | clashctl tun on/off | body {enable}；需 sudo，失败透传 |
| GET | /api/clash/ui | clashctl ui | Web 控制台地址（原始输出） |
| GET | /api/clash/secret | clashctl secret | {secret, output} |
| PUT | /api/clash/secret | clashctl <new> | body {secret}；写 mixin + 重启生效 |
| POST | /api/clash/upgrade | clashctl upgrade [-r/-a] | body {channel: ''\|'release'\|'alpha'} |
| GET | /api/clash/log?tail= | clashctl log | mihomo.log 尾部 |
| GET | /api/clash/config?file= | clashmixin [-c/-r] | mixin/base/runtime；{file,path,editable,content} |
| PUT | /api/clash/config | clashmixin -e | body {content}；仅 mixin，保存即合并重启 |
| GET | /api/clash/sub | clashsub ls | {use, profiles:[{id,url,path}]}（yq 输出经 PyYAML 解析） |
| POST | /api/clash/sub | clashsub add/del/use/update | body {action, url?, id?, convert?, auto?}；update 的 flag 必须在 id 前（clashctl _sub_update 在 for 循环里 shift） |
| GET | /api/clash/sub/log?tail= | clashsub log | profiles.log 尾部 |

## 5. 前端（src/clash/，2 文件）

- ClashPage：PageHeader tabs → ModuleShell 侧栏（个性色 sky，与 logs 同色系）；四视图——**总览**（内核启停/系统代理/Tun/控制台地址/密钥/升级）、**订阅**（列表+使用中徽标+添加/切换/更新/两步删除/自动更新/订阅日志）、**配置**（mixin 编辑器+base/runtime 只读）、**日志**（尾部刷新+5s 自动刷新）；未安装时整页空态
- api.js：17 个函数走 apiFetch 信封 unwrap；门户 PortalPage 引其 `clashAvailability` 做卡片置灰
- 提示统一 Toast（猫叫行）；删除两步确认（3.5s 自动撤销）

## 6. 测试（tests/clash/，21 例）

conftest 搭**假 clashctl**（tmp 目录最小 bash 函数集：函数名/参数/退出码语义/ANSI 输出与真实一致，调用落 calls.log 供断言透传）；覆盖安装检测两态、未装 404、鉴权 401、启停往返、rc→enabled 语义、ANSI 剥离、失败透传、URL/id/secret/channel 校验（含注入尝试）、配置三读一写（写触发 merge-restart marker）、日志 tail、订阅动作 flag 顺序。

## 7. 已知边界

- **Tun 需要 sudo**：无免密 sudo 时 `clashtun on` 会出现 clashctl 自身语义——sudo 失败但内核未死仍报"已开启"（mixin 的 tun.enable 已翻 true，下次重启内核才真正生效）；`clashtun off` 在此状态下会因 sudo 失败而报错。这是 clashctl 原生行为，Web 层如实透传
- 系统代理开关写的是 mixin `_custom.system-proxy.enable` + 子进程环境变量；**对已开终端的 env 不生效**（与 clashctl `clashproxy` 在新 shell 生效的语义一致）
- `clashsub update --auto` 依赖 crontab；`--convert` 依赖本地 subconverter
- 单用户本机工具：接口未做频率限制，认证与其他模块一致（require_basic）
