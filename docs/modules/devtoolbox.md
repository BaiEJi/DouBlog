# 开发者工具箱（devtoolbox）模块文档

> 权威模块文档（2026-10-21 更新）。根文档只保留全局架构，本模块细节以本文为准。
> 前端 `frontend/src/devtoolbox/`（路由 `/devtoolbox`，个性色 lime）；后端 `backend/app/devtoolbox/`（前缀 `/api/devtoolbox`）。

## 1. 定位与设计原则

单用户日常开发高频工具集：**31 个工具、8 大分类**（JSON 6 / 文本 5 / 编码 5 / 加密哈希 3 / 时间 2 / 转换生成 5 / 网络 2 / 开发 3）。

- **本地优先**：除 4 类经后端计算的工具外，全部在浏览器本地完成；重计算放在可终止 Worker，输入默认防抖 180ms，显示计算 / 取消 / 超预算状态，不承诺零延迟。
- **后端只做浏览器做不了的**：MD5/SHA-3/BLAKE（WebCrypto 缺）、GBK/Big5 等字符集**编码**（TextEncoder 仅 UTF-8）、YAML 解析（未引入前端 yaml 库）、二维码（segno）
- **无表、无后台线程、无状态**：对外契约仅 `router`，不需要 `start_background` / `ensure_migrations`，不在 `MODULES_WITH_DB`

## 2. 工具清单

| 分类 | 工具（id） | 计算位置 |
|---|---|---|
| JSON | json-format 格式化/压缩/校验/键排序+节点统计 · json-diff 深度对比 · json-yaml ⇄YAML · json-csv ⇄CSV（RFC 4180） · json-to-code TS/Go/Python 类型推断 · json-escape 转义 | 仅 yaml 走后端 |
| 文本 | text-diff jsdiff 行级 / 行内高亮（并排/统一） · text-stats CJK 口径统计+词频 · case-convert 13 种命名风格 · text-lines 去重/排序/编号流水线 · lorem 中英占位文本 | 全本地 |
| 编码 | base64（文本+文件 data URL） · url-codec 三口径编解码 · html-entity 命名+数字实体 · unicode ⇄\uXXXX+码点表 · charset 乱码修复 | 仅 charset 走后端 |
| 加密哈希 | hash MD5/SHA-1/2/3/BLAKE/HMAC 全家桶 · jwt 解码（不验签） · password 生成器（熵估计+口令短语） | 仅 hash 走后端 |
| 时间 | timestamp 秒/毫秒/微秒互转+当前时间+时间差 · cron 5 字段解析+中文解释+未来 5 次运行 | 全本地 |
| 转换生成 | uuid v4/v7/NanoID · radix 2-36 进制（BigInt） · units 七类单位（温度非线性） · color HEX/RGB/HSL+WCAG 对比度+色阶 · qrcode SVG+PNG | 仅 qrcode 走后端 |
| 网络 | url-parse 组成部分+参数表 · subnet IPv4 CIDR（含公私网判断） | 全本地 |
| 开发 | regex 实时高亮+分组捕获+模板库 · md-preview 复用博客 md.js 渲染管线 · cheatsheet HTTP/MIME/ASCII 速查 | 全本地 |

## 3. 后端 API（全部 require_basic，DouBlog 信封，同步 def）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/devtoolbox/capabilities` | 能力声明：算法/字符集白名单/上限（前端选项据此渲染） |
| POST | `/api/devtoolbox/hash` | `{text, algorithm, hmac_key?}` → `{algorithm, hmac, hex}`；10 算法白名单 + 6 HMAC 算法 |
| POST | `/api/devtoolbox/charset/convert` | `{text, from_charset, to_charset}` → `{result, hex, bytes}`；语义 text --encode(from)--> 字节 --decode(to)--> 结果 |
| POST | `/api/devtoolbox/yaml/convert` | `{direction: json2yaml\|yaml2json, content}` → `{result}`；safe 模式，date/datetime 序列化为字符串 |
| POST | `/api/devtoolbox/qrcode` | `{content, scale?, border?, ecc?}` → `{svg, png_data_url, version, ecc}` |

约束：文本输入 ≤1MB（纯计算防滥用）；二维码内容 ≤2000 字符；scale∈[1,32]、border∈[0,10]、ecc∈l/m/q/h 越界钳制。错误统一 `ParamError`（HTTP 400，code=PARAM_INVALID，中文 message）。YAML 解析/序列化统一走 app/shared/yamlfast.py（libyaml C，CSafeLoader/CSafeDumper，safe 语义，未编译自动回退；实测 213KB yaml2json 端点级 301ms，纯 Python 版同规模约 2.1s；clash/practice 同源共用）。

## 4. 前端结构

```
frontend/src/devtoolbox/
├── DevToolboxPage.jsx    # 页面壳：?t=<工具id> 深链 + 搜索首页 + 分组导航注册
├── registry.js           # 工具注册表（分组/名称/描述/lazy 组件）——侧栏、首页、搜索共用单源
├── api.js                # 4 个后端调用（apiFetch；网络错误本地化为中文并保留 cause）
├── kit.jsx               # UI 原子（card/input/area/btn/Toast/CopyBtn/Segmented/Check/ToolHead/TwoPane）
├── data.js               # 静态数据（HTTP 状态码/MIME/ASCII/常用正则/Cron 预设/单位表）
├── lib/
│   ├── diff.js           # shared/diff.js 的兼容 re-export（jsdiff 与 JSON 深度差异）
│   ├── text.js           # shared/text.js 的兼容 re-export（CSV/统计/行处理等）
│   ├── cron.js           # 5 字段解析（@aliases/名称月周/DOM-DOW 并集）+ nextRuns 逐分钟推算（5 年上限）
│   ├── color.js          # hex/rgb/hsl 互转 + WCAG 亮度对比度 + 色阶
│   └── misc.js           # copy/download/UTF-8 安全 Base64/uuid v4v7/nanoId/密码生成（拒绝采样）
└── tools/                # 31 个工具组件（每个独立 lazy 分包）
```

关键实现点：

- **ToolHead 的 `right` prop**：工具头部动作区（Segmented/选择器/按钮）；`children` 为兼容别名
- **公共计算层**：`shared/compute.js` + `compute.worker.js` + `workerTask.js` / `useComputation.js` 承载 11 项重计算：JSON 格式 / Diff / CSV / 转义 / 类型代码、文本 Diff / 统计 / 行处理、正则、Base64、Unicode。每项有 ID / deadline / AbortSignal，过期结果不覆盖新输入，超时或取消终止 Worker，卸载释放。
- **编辑器**：共享 CodeMirror adapter 按需加载核心和语言，保留选择 / undo，统一中英文输入、只读与明暗；超过 100 万字符停用语法装饰，保留正文编辑。
- **diff**：采用 jsdiff `diffArrays` / `diffWordsWithSpace`，行级原文保留，忽略大小写 / 空白只影响匹配；按相邻删除 / 新增块生成并排配对并高亮。Worker 完成后 `DiffViewer` 通过 TanStack Virtual 挂载可见行，复制操作仍提供预算内完整补丁。单次 jsdiff 超过 1500ms / 20000 edit，或两侧合计超过 200000 行 / 元素时明确报错，不伪装成完整近似结果；整个文本差异 Worker 另有 8 秒截止。
- **jsonDiff**：对象按任意键名比较；数组按 jsdiff 序列对齐；「忽略数组顺序」保持稳定键多重集计数，重复元素不会被丢弃。
- **JSON / CSV / 类型推断**：JSON 键排序不使用属性白名单，保留 `__proto__` 等普通 JSON 键；CSV 按 RFC4180 处理引号 / 换行，扁平数组用明确下标避免覆盖，缺失字段不读取原型值。类型代码从所有数组样本推断对象字段，处理可选字段、空值 / 混合类型与非法标识符；输出是样本推断，不能代替业务 schema。
- **正则**：灾难性回溯在专用 Worker 内执行，UI 截止 1500ms、最多 500 匹配并明确提示上限；零宽 Unicode 匹配可终止。终止后可继续输入新表达式，主线程不被阻塞。
- **cron**：仅标准 5 字段（6 字段 Quartz 报错提示）；DOW 7 归一为 0；DOM 与 DOW 同时受限取并集（vixie 语义）；描述为尽力中文化，字段级明细始终给出
- **md-preview**：直接 import 博客 `shared/md.js` 的 `md` 实例与 `renderMermaidDiagrams`，零重复实现
- **门户卡片**：lime 个性色，`/devtoolbox` 入口；新增模块自动追加到用户布局末组（portal 自愈逻辑）

## 5. 测试与验证

- 后端：`backend/tests/devtoolbox/test_devtoolbox.py` **42 例**——鉴权 401、哈希对照标准库（10 算法参数化+HMAC 4 算法+已知向量）、字符集（GBK 往返/latin-1→utf-8 乱码修复/不可编码 400 提示 gb18030/不可解码 400）、YAML（往返/键序/日期字符串/两类解析错误/方向校验/**C loader 生效断言 + C/纯 Python 一致性 + 锚点合并键多行文本 + 100KB 级大文档往返**）、二维码（形态/空内容/非法 ecc/超长/参数钳制）
- 当前前端专项见 `docs/optimization/frontend-verification.md`：25 项公共单测包含 10000 行完整 diff、Unicode / CRLF、任意 JSON 键、500 万字节 JSON、CSV / Base64 / 转义往返、TS 解析和 Python 执行；114 个负责文件相对基线 ESLint 增量为 0，生产构建成功。未把仓库历史 lint 问题描述成全仓零问题。
- 隔离 Chromium 的 22 项常规回归包含上述 11 个工具的真实 CodeMirror / Worker、明暗截图和正则回溯超时后恢复；10000 可变高度行 DOM 有界且最后一行可达。结果见 `.ui-qa/optimization/frontend-results.json`。后端完整回归与正式性能以本轮汇总记录为准，旧 566 用例历史不再代表当前总数。

## 6. 已知边界

- Worker 通用输入预算每个文本字段 10 MiB；JSON 格式化最多 100 万节点 / 2048 层、预计输出 50 MiB，超预算报错。通用 Worker 默认 5 秒截止，文本差异 8 秒、正则 1.5 秒；大输入处理可能超时，不承诺固定毫秒响应。命名转换独立限制 20000 字符。
- 虚拟行减少 DOM，不减少完整差异结果的 Worker / 内存成本；完整补丁复制仍受浏览器剪贴板能力影响。CSV 的扁平点路径是表格表达，不提供无损还原任意同名点路径的 schema；生成 Go / TS / Python 类型只是样本推断。
- Cron 仅 5 字段（不支持 Quartz 6/7 字段秒与年）；描述的中文化覆盖常见模式，特殊组合回落到字段级明细
- JWT 解码不验签（调试用途）；MD5/SHA-1 仅用于校验场景
- 二维码容量受纠错级别限制（H 级约 1.2KB 二进制）；文件转 data URL 限 4MB（浏览器 FileReader 本地读取）
- 子网计算仅 IPv4（IPv6 未实现）
- `password` 工具与 vault 的生成器相互独立（vault 面向密码库条目，本工具面向临时密码）
