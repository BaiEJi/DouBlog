# 开发者工具箱（devtoolbox）模块文档

> 权威模块文档（2026-10-16，随代码生成）。根文档只保留全局架构，本模块细节以本文为准。
> 前端 `frontend/src/devtoolbox/`（路由 `/devtoolbox`，个性色 lime）；后端 `backend/app/devtoolbox/`（前缀 `/api/devtoolbox`）。

## 1. 定位与设计原则

单用户日常开发高频工具集：**31 个工具、8 大分类**（JSON 6 / 文本 5 / 编码 5 / 加密哈希 3 / 时间 2 / 转换生成 5 / 网络 2 / 开发 3）。

- **本地优先**：除 4 类经后端计算的工具外，全部在浏览器本地完成（隐私——数据不出本机；零延迟——输入即时出结果）
- **后端只做浏览器做不了的**：MD5/SHA-3/BLAKE（WebCrypto 缺）、GBK/Big5 等字符集**编码**（TextEncoder 仅 UTF-8）、YAML 解析（未引入前端 yaml 库）、二维码（segno）
- **无表、无后台线程、无状态**：对外契约仅 `router`，不需要 `start_background` / `ensure_migrations`，不在 `MODULES_WITH_DB`

## 2. 工具清单

| 分类 | 工具（id） | 计算位置 |
|---|---|---|
| JSON | json-format 格式化/压缩/校验/键排序+节点统计 · json-diff 深度对比 · json-yaml ⇄YAML · json-csv ⇄CSV（RFC 4180） · json-to-code TS/Go/Python 类型推断 · json-escape 转义 | 仅 yaml 走后端 |
| 文本 | text-diff 行级 LCS+行内高亮（并排/统一） · text-stats CJK 口径统计+词频 · case-convert 13 种命名风格 · text-lines 去重/排序/编号流水线 · lorem 中英占位文本 | 全本地 |
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
│   ├── diff.js           # 行级 LCS（前后缀裁剪+DP 上限 16M 格）+ 行内 token diff + jsonDiff
│   ├── text.js           # 命名切词/CSV RFC4180/CJK 统计/行处理/lorem 语料
│   ├── cron.js           # 5 字段解析（@aliases/名称月周/DOM-DOW 并集）+ nextRuns 逐分钟推算（5 年上限）
│   ├── color.js          # hex/rgb/hsl 互转 + WCAG 亮度对比度 + 色阶
│   └── misc.js           # copy/download/UTF-8 安全 Base64/uuid v4v7/nanoId/密码生成（拒绝采样）
└── tools/                # 31 个工具组件（每个独立 lazy 分包）
```

关键实现点：

- **ToolHead 的 `right` prop**：工具头部动作区（Segmented/选择器/按钮）；`children` 为兼容别名
- **diff**：行级 LCS 先裁公共前后缀再 DP（`(n+1)(m+1) > 16M` 时保序兜底）；并排视图把相邻 del/add 块配对到同一视觉行，配对行做行内词级高亮
- **jsonDiff**：对象按键比较；数组按序列化键 LCS 对齐；「忽略数组顺序」按稳定键多重集计数
- **cron**：仅标准 5 字段（6 字段 Quartz 报错提示）；DOW 7 归一为 0；DOM 与 DOW 同时受限取并集（vixie 语义）；描述为尽力中文化，字段级明细始终给出
- **md-preview**：直接 import 博客 `shared/md.js` 的 `md` 实例与 `renderMermaidDiagrams`，零重复实现
- **门户卡片**：lime 个性色，`/devtoolbox` 入口；新增模块自动追加到用户布局末组（portal 自愈逻辑）

## 5. 测试与验证

- 后端：`backend/tests/devtoolbox/test_devtoolbox.py` **42 例**——鉴权 401、哈希对照标准库（10 算法参数化+HMAC 4 算法+已知向量）、字符集（GBK 往返/latin-1→utf-8 乱码修复/不可编码 400 提示 gb18030/不可解码 400）、YAML（往返/键序/日期字符串/两类解析错误/方向校验/**C loader 生效断言 + C/纯 Python 一致性 + 锚点合并键多行文本 + 100KB 级大文档往返**）、二维码（形态/空内容/非法 ecc/超长/参数钳制）
- 前端：`npm run build` 零报错 + eslint 零问题；UI 走查 47 张截图（33 亮 + 14 暗）经 image 子智能体审查，发现并修复：速查表分组过滤条件错误（`c<300` 混入 1xx → 区间判断）、网络错误文案未本地化、ToolHead 未实现 right prop（头部控件被静默丢弃）
- 回归：全量 pytest 566 用例（devtoolbox 37 全过；clash 14 例失败为该模块本地假环境问题，与本模块无关）

## 6. 已知边界

- 文本 diff 为 LCS 而非 Myers——极端大输入（裁剪后仍 >4000×4000 行）退化为整块删+增（保序不丢内容）
- Cron 仅 5 字段（不支持 Quartz 6/7 字段秒与年）；描述的中文化覆盖常见模式，特殊组合回落到字段级明细
- JWT 解码不验签（调试用途）；MD5/SHA-1 仅用于校验场景
- 二维码容量受纠错级别限制（H 级约 1.2KB 二进制）；文件转 data URL 限 4MB（浏览器 FileReader 本地读取）
- 子网计算仅 IPv4（IPv6 未实现）
- `password` 工具与 vault 的生成器相互独立（vault 面向密码库条目，本工具面向临时密码）
