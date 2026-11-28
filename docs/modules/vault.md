# Vault 模块文档（零知识密码库）

> 更新日期：**2026-11-21**，依据当前代码（`backend/app/vault/`、`backend/tests/vault/`、`frontend/src/vault/`）与 `docs/vault-design.md` 整理。
> 威胁模型与算法规范详见 `docs/vault-design.md`；本文件是"代码现状"的模块级快照。

---

## MCP 接入

在配置中心为本模块启用工具并签发令牌，再连接 `/mcp/vault`。查看密码库条目数量和审计摘要。写入工具支持设置收藏，移入回收站或恢复。[MCP 工具清单](../../api.md#mcp-模块目录)

## 1. 功能概述

单用户零知识密码库（`/vault`）：服务端**只存密文**，所有加密/解密/搜索/分析在浏览器完成。

- **零知识加密模型**：主密码 --Argon2id--> KEK₁ --AES-GCM-wrap--> VEK（256-bit 随机）；Recovery Key --Argon2id(salt₂)--> KEK₂ 包裹**同一** VEK；条目/附件用 VEK + AES-256-GCM（每次全新 12-byte nonce）。VEK 以不可导出 `CryptoKey` 只存内存，锁定/刷新/关浏览器即清除。Argon2id 用 `@noble/hashes`，AEAD 用原生 WebCrypto——不发明密码学。
- 解锁后进入「我的账号」。全部、收藏、最近使用共用虚拟列表。复制成功或打开网址会更新使用时间。搜索覆盖名称、所属网站、网址、标签、邮箱、手机号和用途，可用 Ctrl/Cmd+K 聚焦。
- 「筛选」可按所属网站、类别、标签和绑定身份筛选，也可进入类别管理。每行显示登录账号和用途，旧条目按已有用户名、邮箱、手机号或绑定身份解析。
- 每条账号可填写「所属网站」，例如谷歌、微软或自定义平台。选择器会复用库中已有名称。未填写时根据首个有效登录网址在本机识别平台，其他网址显示主机名和非默认端口。手填名称优先，登录网址仍控制「打开」操作。
- 分组栏支持新建、改名、删除和按组查看。每个账号可选一个分组，旧账号和已删除分组的成员显示为「未分组」。空分组可保留。名称、归属和搜索都在解锁后由浏览器处理。
- **自定义类别**（`components/categoryCatalog.js` + `components/CategoryManager.jsx`，类别页左栏「管理类别」入口）：可添加（≤12 字符、禁重名）/ 改名 / 删除；自定义类别仅存浏览器 localStorage（零知识：服务端不存任何 vault 元数据），key 为稳定生成 id（改名不牵连条目），label 为用户可见名；**删除时有条目的类别会被拒绝**（要求先改类，避免密码条目失去归属）。目录 = 内置 9 项 ∪ 自定义 ∪ 条目中的孤儿 key（本地数据被清/备份恢复时兜底展示）。编辑器「分类」下拉、类别页侧栏、详情页徽章、列表筛选统一走目录解析。导出备份时将目录加密到 `category_catalog`。成功恢复后写入本地，同时兼容旧 `custom_categories`。
- 分类、身份、密钥、自动锁定和剪贴板时限使用全站公共下拉框。
- 日常列表只在需要检查时显示一条提示，可进入安全检查查看具体账号。
- 安全检查的说明、健康度卡片和风险列表与工具栏共用左右边界。向下浏览较长的风险列表时，工具栏固定在页面顶部。
- **TOTP 验证码**（`components/totp.js`，RFC 6238）：2FA Secret 支持 Base32 或 `otpauth://` URI（编辑器粘贴自动解析，签发方回填服务名）；详情页实时生成 6-8 位码 + 30s 环形倒计时 + 一键复制；HMAC-SHA1 走 WebCrypto，密钥不出设备。
- **HIBP 泄露检查**（`components/hibp.js`）：k-anonymity——仅上传密码 SHA-1 前 5 位，`Add-Padding:true`，不带站点凭据、不用 HTTP 缓存；结果只留解锁会话内存，**不持久化完整哈希**。加载时和锁定时删除旧 `doublog.hibp.v1` 缓存；锁定取消当前请求并防止旧结果回填。网络不可达或 8 秒超时返回 -1（未知 ≠ 安全）。
- **健康总评分**（安全中心）：0-100 环 = 100 − 泄露×15 − 弱×8 − 复用组×10 − 到期×4 − 过旧×3 − 无2FA×2 − 重复组×2 − 缺恢复×1，点击下钻到对应分组。
- **安全中心**八组清单：已泄露/弱（熵<60）/复用/过旧（>180 天）/到期提醒/未开 2FA（含 Passkey 视为已开）/重复账号（按所属网站和登录账号匹配，缺少网站时按记录名称回退）/缺恢复方式——全部客户端分析。
- **安全附件**（`vault_attachments` 表）：前端 VEK 加密 `{filename, mime, data}` 后整包上传，服务端只见密文 + 客户端上报的明文 size；明文最多 5 MiB，密文限额包含两次 Base64 编码及加密开销；下载时解密还原文件名；软删条目附件冻结保留（恢复语义），purge 级联删除。
- **密码历史**：编辑器改密自动归档（`core.js applyPasswordChange`，旧密码 + createdAt/replacedAt/reason 进密文内 history），详情页时间线展示。
- **生成器**：随机密码（8-128 位、四字符集、默认排除易混淆 I/l/O/0/1）+ 口令短语（3-10 词、1004 词 EFF 风格词表）+ 熵/强度评估；无偏随机（拒绝采样 + Fisher-Yates）。
- **密码到期提醒**：条目密文内 `expiry_days`（0-3650，null=不提醒）；判定纯客户端（`core.js expiryInfo()`），账号列表提示 + 详情徽标 + 安全中心分组；**服务端完全不感知到期与否**。
- **自动锁定**：5/15/30/60 分钟闲置或"关闭浏览器"（密钥仅内存，刷新即锁）；锁定递增会话 generation，清除 VEK、条目、详情 / 编辑器 / 弹层与 HIBP 缓存，终止 KDF，旧异步结果不能重新填入页面。剪贴板仅在仍包含本模块复制内容时清除。
- **Recovery Key**：256-bit（64 hex，4 位一组展示）仅初始化/轮换时显示一次；可轮换（旧钥立即作废）。
- 已初始化的空库可以在「忘记主密码」页面选择「重新设置空密码库」。浏览器生成新库密钥、主密码包裹材料和恢复密钥，旧备份继续使用导出时的口令。服务器在写入时再次确认账号、最近删除、附件和分组均为空。
- v2 备份含包裹密钥、有效与已删除账号、加密附件。选择文件后在浏览器验证备份口令及全部密文，再确认替换。空库也可直接恢复。CSV 导入先在本机预览，跳过重复与冲突后只追加新账号。明文 CSV 导出需再验证主密码。
- **审计日志**：仅记 action + item_id + 时间，永不包含密码/密钥/剪贴板内容。
- 轮换密码服务的独立入口为 `/pwsvc`，模块契约见 `docs/modules/pwsvc.md`。

**解锁 ≠ 登录**：站点统一登录走会话 Cookie（`/api/auth/login`，登录一次全站生效）；vault 主密码解锁是**零知识加密的解密步骤**（派生 KEK 解包 VEK），不是登录，不签发任何凭据。UI 文案一律"解锁密码库/主密码"，不使用"登录"。

## 2. 数据模型（`backend/app/vault/models.py`，四表）

表名规则 `vault_*`，与其他模块同库（`db_config.json` 切换生效）。**物理表无任何明文敏感列**（测试断言）。

| 表 | 列 | 说明 |
|---|---|---|
| `vault_accounts`（单行） | id, kdf_algo('argon2id'), kdf_params(JSON 文本 {t,m,p}), kdf_salt, recovery_salt（base64）, wrapped_vault_key, recovery_wrapped_vault_key（`{n,ct}` JSON 文本）, group_catalog（可空的 VEK 密文）, created_at, updated_at | 仅零知识加密材料；服务端永不接触主密码/Recovery Key/VEK 明文 |
| `vault_items` | id, blob(`{n,ct}` JSON 文本), favorite(BOOL, 索引), last_used_at, password_updated_at, deleted_at(索引，回收站软删), created_at, updated_at | 敏感内容全在密文 blob 内；明文列均为非敏感元数据 |
| `vault_attachments` | id, item_id(FK→vault_items, 索引), blob(`{n,ct}`，内含加密的文件名/mime/数据), size(明文字节数，客户端上报), created_at | 生命周期跟随条目：软删冻结保留，purge 级联删除 |
| `vault_audit_logs` | id, action(索引), item_id(可空), created_at | **只记行为与条目 ID**，禁止任何 secret/旧密码/剪贴板内容 |

密文统一结构 `blob = {n: base64(12B nonce), ct: base64(ciphertext)}`（AES-256-GCM）。
条目密文内的逻辑载荷（Credential JSON）：`v, service, site_name, type, category, group_id, urls[], app_name, username, account_id, password{value}, password_updated_at, expiry_days, password_history[], identities[], login_methods[], secrets[], custom_fields[], notes, tags[]`——类型/分类/密钥种类等枚举**存英文值，展示层中文映射**（`core.js *_LABELS`），改翻译不动数据。

审计 action 枚举：`vault_initialized, vault_keys_rotated, empty_vault_reinitialized, groups_updated, created, updated, password_changed, used, trashed, restored, purged, exported, imported, attachment_added, attachment_removed`。

## 3. API 契约（`backend/app/vault/routes.py`，19 端点）

统一前缀 `/api/vault`，整 router 挂 `Depends(require_basic)`（**优先会话 Cookie，其次 Basic**，与其他模块一致）；响应走 `api_response` 信封 `{success, code, message, data}`。

### 账号（加密材料）

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 1 | `GET /api/vault/account` | — | 账号材料、created_at 与 can_reinitialize_empty | 404 未初始化 |
| 2 | `POST /api/vault/account` | `{kdf_algo:'argon2id', kdf_params:{t≥1,m≥8192,p≥1}, kdf_salt(16-64 字符), recovery_salt, wrapped_vault_key:{n,ct}, recovery_wrapped_vault_key:{n,ct}}` | 201 + 账号 dict | 409 已初始化；400 kdf_params/kdf_algo/盐/box 结构非法 |
| 3 | `PUT /api/vault/account/keys` | 可选组合 `{wrapped_vault_key, kdf_salt?, kdf_params?}` 和/或 `{recovery_wrapped_vault_key, recovery_salt?}` | 200 + 更新后账号 dict | 404 未初始化；400 结构非法 |
| 19 | `PUT /api/vault/account/groups` | `{blob:{n,ct} 或 null, expected_key, expected_nonce}`，首次写入传 `expected_nonce: null` | 200，加密目录或 null | 400 明文、格式无效或复用 nonce，404 未初始化，409 库或目录已变化 |

重新设置空库复用第 2 项接口，另外提交 `replace_empty: {kdf_salt, recovery_salt}` 标明要替换的原库材料。成功返回 200 并记录 `empty_vault_reinitialized`。最近删除、附件、并发新增或过期材料会阻止换发。前端新增条目带 `expected_key`，值为获取当前材料时的 `kdf_salt`。重新设置过的库拒绝缺少标识或标识过期的新增请求。

### 条目

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 4 | `GET /api/vault/items` | `?trash=0|1`（1=仅回收站） | `{items:[...], total}`（按 updated_at 倒序） | — |
| 5 | `POST /api/vault/items` | `{blob:{n,ct}, favorite?, password_updated_at?}` | 201 + 条目 dict；审计 created | 400 blob 非 `{n,ct}` |
| 6 | `PUT /api/vault/items/{id}` | `{blob:{n,ct}, favorite?, password_updated_at?}` | 200 + 条目 dict；审计 updated（password_updated_at 变化另记 password_changed） | 404；400 |
| 7 | `POST /api/vault/items/{id}/use` | — | 200（置 last_used_at，仅 ID+时间）；审计 used | 404 |
| 8 | `DELETE /api/vault/items/{id}` | — | 200（软删置 deleted_at，幂等）；审计 trashed | 404 |
| 9 | `POST /api/vault/items/{id}/restore` | — | 200（deleted_at 置空）；审计 restored | 404 |
| 10 | `DELETE /api/vault/items/{id}/purge` | — | 200 `{id, attachments_purged:true}`（物理删除 + 附件级联）；审计 purged | 404 |

批量追加使用 `POST /api/vault/items/append`，提交账号派生盐 `expected_key`、预览时的 `expected_items:[[id,nonce]]` 和新密文数组 `items`。成功返回 201 与 `imported_items`，账号或条目已变动返回 409。收藏可单独提交 `{favorite:bool}`。

条目 dict 字段：`id, blob, favorite, last_used_at, password_updated_at, deleted_at, created_at, updated_at`。

### 安全附件

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 11 | `GET /api/vault/items/{id}/attachments` | — | 附件 dict 数组（created_at 升序） | 404 条目不存在；400 条目在回收站 |
| 12 | `POST /api/vault/items/{id}/attachments` | `{blob:{n,ct}, size}` | 201 + 附件 dict；审计 attachment_added | 404/400（回收站、结构非法、size 非整数）；**413**（明文超过 5 MiB 或密文超过该文件大小对应的限额） |
| 13 | `GET /api/vault/attachments/{aid}` | — | 附件 dict（回收站条目的附件仍可单取——恢复语义） | 404 |
| 14 | `DELETE /api/vault/attachments/{aid}` | — | 200 `{id}`；审计 attachment_removed | 404 |

单个文件最多 5 MiB。密文限额保留历史 8 MiB 下限，再按文件大小计算两次 Base64 编码、JSON 元数据和 GCM 标签所需的空间。恢复和上传采用同一限额。

### 审计 / 备份

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 15 | `GET /api/vault/audit` | `?page=1&page_size=50`（page_size 上限 200，非法值回退默认） | `{items, total, page}`（created_at 倒序） | — |
| 16 | `GET /api/vault/export` | — | 备份对象（见下）；审计 exported | 404 未初始化 |
| 17 | `POST /api/vault/import` | 备份对象整体 | `{imported_items:N,imported_attachments:M}`；审计 imported | 400（format 非法/账号材料不完整/条目密文结构非法/缺 items） |

备份 v2 包含 `format, version, exported_at, account, items, attachments`。文件中的每个附件使用原 `item_id`，恢复事务为它关联新条目 ID。浏览器导出的 `category_catalog` 是本机类别目录的密文。界面先在本机验证，再提交恢复；目标库的包装盐有变化时返回 409。v1 缺少附件，恢复前会展示提示。 分组目录位于可选的 `account.group_catalog` 内，客户端在恢复前解密并验证目录。旧备份缺少目录时恢复为空。条目引用稳定的分组 ID，恢复时重建条目 ID 不影响归属。

## 4. 后端要点

- **零知识红线**（AGENTS.md 第 13 条）：服务端只存取密文（blob/包裹 VEK），不解析、不搜索内容；**API 层不存在任何明文敏感参数**（无 password/secret 字段），禁止新增"服务端搜索/密码分析"类接口；搜索/强度/泄露/到期判定全部在客户端解密后进行。
- **`_valid_box()` 结构校验**：只接受 `{n: str(16-64 字符 base64), ct: str(8-200000 字符)}` 形态；附件走同结构但 ct 无 200000 上限（大密文先给 413 而非 400）。任何非该结构的 payload 直接 400——这是"契约层面不接受明文"的落地（测试 `test_item_rejects_plaintext_shape`）。
- **软删/恢复/purge 级联**：DELETE=软删（deleted_at）；restore 置空；purge 物理删除条目并 `DELETE ... WHERE item_id=` 清附件（响应带 `attachments_purged:true`）。回收站条目的附件列表/上传返回 400，单取仍 200（恢复语义）。
- DB 访问统一经 `run_db`（scoped session）；审计 `_audit(action, item_id)` 只落行为行。**条目列表/导出均用列投影取元组**（免 ORM 实例化）。列表将 blob 原文直接放入响应，免逐条解析密文 JSON 再整包序列化；信封、逗号与条目片段一次 `join` 后编码，省去先合并条目再包裹信封的完整字符串拷贝。字段顺序、`_blob_json` 回退和 `_jts` 时间语义保持不变。导出仍解析 blob 为对象后走统一响应；单条端点仍走 `Model.query` + `to_dict`。这些装配变化不改变密文格式或加密参数，实际吞吐收益需以对应源码的性能结果为准。
- **写锁重试**：全部端点的 `_impl` 经 `_retry_locked` 包装——偶发 `OperationalError(database is locked)`（高并发写下 ~0.1%）回滚后 20/40/60ms 退避重试至多 3 次；非锁类异常原样抛出。
- 模块包契约：`app/vault/__init__.py` 导出 `router` + `ensure_migrations(engine)`（幂等补齐 `vault_accounts.group_catalog` 列，使用 `CREATE INDEX IF NOT EXISTS` 补建两个性能索引：`ix_vault_items_trash_order(deleted_at, updated_at)` 支撑列表过滤+排序、`ix_vault_audit_logs_created_at(created_at)` 支撑审计分页；新建库由 create_all 直接带上，无表改名需求）；无 start_background；由 `main.py` 的 `MODULES` 注册表按序挂载。
- 已知代码怪癖：`POST /import` 的格式串校验同时接受 `'doublog-vault-backup'` 与历史笔误 `'doublog-vault-backdown'`（导出只写前者；见"已知边界"）。

## 5. 前端（`frontend/src/vault/`）

- **`VaultPage.jsx`（状态机壳）**：`loading → setup（初始化向导）/ locked（锁屏）/ error（读取失败）→ unlocked（三面板）`。进入时只有 `GET /account` 的 404 才进入 setup，网络 / 503 进入明确错误与重试状态。`unlock()` 解包 VEK 存 `vekRef`（useRef，**不进 state/localStorage**）；列表读取 / 解密期间即可锁定。`components/session.js` 按最多 100 条一批、8 路并发解密，批间让出事件循环，发布前后均检查 generation；损坏条目跳过并显示数量。长列表由共享 `VirtualList` 只挂载可视行，明文仍仅在当前解锁内存。自动锁定：pointerdown/keydown 刷 lastActivity，15s 轮询比对阈值。详情删除调用软删，最近删除页负责恢复及二次确认后彻底删除。
  - **解锁≠登录**：锁屏文案"密码库已锁定/输入主密码/解锁密码库"；错误提示"主密码不正确"——这是本地解密步骤，与站点会话登录（Cookie）无关。
- **`components/crypto.js` + `kdf.worker.js`**：`createVaultMaterial` / `unlockVault` / `rewrapVaultKey` / `encryptBlob` / `decryptBlob` 保持原加密格式。浏览器 Argon2id 在专用本地 Worker 中执行，最多一个活动任务，120 秒截止、锁定终止；Node 测试 / CLI 才使用无 Worker 的实现。**默认参数仍为 t=2, m=32768 KiB, p=1，不降 KDF**，解锁以账号存储参数为准；派生字节和临时 VEK 原始字节及时清零，VEK / KEK 为不可导出 CryptoKey。Worker 不依赖远程脚本。任何函数不 console 输出密钥 / 明文。
- **`components/core.js`（纯逻辑，无 UI/网络）**：枚举常量 + 中文映射、`emptyItem()`、生成器（`randomInt` 拒绝采样无 modulo 偏差）、熵/强度（`passwordEntropy`/`passphraseEntropy`/`strengthLabel`）、`extractIdentities`、`analyzeSecurity`（弱/复用/过旧/expired/no2fa/重复/缺恢复）、`expiryInfo`（到期判定）、`applyPasswordChange`（历史推进）、`itemMatches`/`domainOf`/`daysAgo`。
- **`components/ui.jsx` + `clipboard.js`**：复制后 10/30/60s 自动清除，仅当剪贴板仍等于本模块拥有的内容；切换「永不」取消旧定时器，锁定会废止尚未完成的复制。`CopyButton`、`SecretField`（默认 `•••`、Reveal 15s 自动隐藏）、`FieldRow`、图标集 `I` 保持。`Favicon` 默认字母块；设置中明确启用外部图标后才请求 DDG，并使用 `no-referrer`，域名失败回退字母。
- **`components/ItemDetail.jsx`**：LOGIN（用户名/手机号/邮箱/实名人/账号昵称/密码/URL/登录方式，手机号与邮箱带一键复制）/TOTP/绑定身份/密钥/安全状况/附件/密码历史时间线/自定义字段/备注（Markdown 渲染）分区。附件按条目 ID 重挂，子任务 scope 关联会话 AbortSignal；读取、解密、文件读取、加密、POST、删除前后检查是否仍有效。锁定或换条目时取消请求，旧文件不能在晚到后继续上传，旧附件不填入新条目；附件解密也采用有限并发批处理。
- **`components/ItemEditor.jsx`** 默认显示名称、所属网站、所属分组、登录账号、密码、网址和选填备注。「更多信息」包含用途、分类、联系方式、身份、标签和密钥。编辑会保留旧条目额外字段，改密自动归档历史。
- **`components/Generator.jsx`**：密码/口令短语双 tab + 熵条 + 复制/重生成/`onUse` 填充编辑器。
- **`components/SecurityCenter.jsx`**：健康总评分环 + HIBP 检查（密码去重、并发 3、进度）+ 八组风险分组（点击跳条目）。每次启动后续检查和发布结果均检查子任务 scope；锁定 / 卸载 / 条目集合变化取消活动请求并停止队列，避免清空缓存后旧循环再启动新请求。
- **`components/CategoriesView.jsx`**：类别页（玫瑰粉个性色，布局对齐配置中心）：左侧类别目录栏（内置 9 项 + 自定义 + 孤儿 key，计数 + 选中态 + 「管理类别」入口），右侧当前类别条目表（favicon/名称/用户名/类型徽章/更新时间/查看）+ 类别内搜索；行点击打开账号详情；选中类别由父级 prop 控制（`active`/`onActiveChange`）。
- **`components/categoryCatalog.js`**：类别目录单源——localStorage 的 `vault_custom_categories:<dataIdentity>` 按账号 / 数据库隔离，不把旧无作用域目录静默归给任意新库。`buildCatalog` 合并内置 / 自定义 / 孤儿，备份导入仍通过 `replaceCustom` 恢复。
- **`components/CategoryManager.jsx`**：类别管理弹窗——内置只读（计数 + 内置标签）、自定义行内改名/删除（拒删带原因）、底部添加行；Esc/遮罩关闭。
- `components/ui.jsx` 继续导出全站的 `shared/ui/Select.jsx` 供密码库各视图使用。
- **`components/totp.js` / `hibp.js`**：见第 1 节；均零第三方依赖。
- **`api.js`** 仅封装 `/api/vault/*`。`components/Transfers.jsx` 负责本机 CSV 预览、追加与加密备份恢复。
- **`components/AccountList.jsx`** 包含账号列表和最近删除。删除后可撤销或恢复，彻底删除需二次确认。
- **`components/AccountGroups.jsx` / `groups.js`** 管理分组栏、选择器和加密目录。目录中的 ID 在改名时保持稳定。移动账号时，服务端核对库标识、目录版本和原条目 nonce，防止其他窗口的编辑被覆盖。
- 枚举存储英文、展示中文；`index.css` 有 `@source "./vault"` 白名单与 `.vault-input` 类（锁屏/设置输入框复用）。

## 6. 测试（`backend/tests/vault/`，25 个参数化用例）

自包含（conftest 临时 SQLite + TestClient + Basic 头，不访问外网）：

1. `test_account_init_and_get` — 初始化/读取 KDF 参数与包裹材料；响应无明文口令字段
2. `test_account_init_twice_rejected` — 二次初始化 409
3. `test_account_requires_auth` — 无凭据 401
4. `test_rotate_keys` — PUT /account/keys 替换包裹材料与新盐
5. `test_item_crud_and_trash` — 创建/更新/use/软删（live 与 trash 计数互斥）/恢复/purge 全链
6. `test_item_rejects_plaintext_shape` — 非 `{n,ct}` 结构、`password` 明文字段、残缺 box 均 400
7. `test_items_require_auth` — 401
8. `test_audit_log_content_safety` — 审计仅 {id, action, item_id, created_at} 四键
9. `test_export_import_roundtrip` — 备份格式/条目数/覆盖式导入往返/非法格式 400
10. `test_database_stores_only_ciphertext` — 直查数据库：包裹材料键集 = {n,ct}；两表无 password/secret/note/username/service 等明文列
11. `test_attachment_roundtrip_and_list` — 上传/列表/单取/删除往返
12. `test_attachment_limits_and_validation` — 非法 blob/size 400；明文或密文超限 413；上限内 201
13. `test_attachment_lifecycle_with_item` — 软删后列表/上传 400、恢复后回归、purge 级联、条目 404
14. `test_attachment_audit_logged` — attachment_added/attachment_removed 落审计
15. `test_list_fast_path_matches_contract` — 列表直拼响应：信封/条目字段集合与值/trash 过滤与契约一致
16. `test_export_fast_path_roundtrip` — export 核心查询路径字段与导入往返不变
17. `test_perf_indexes_created` — 两个性能索引存在（新建库与存量库同名同构）
18. `test_retry_locked_recovers` — 写锁重试：锁类 OperationalError 重试成功、非锁类原样抛出

`test_items_response_assembly.py` 另含 7 个参数化用例：空 / 单 / 多条目响应的固定 UTF-8 字节、字段顺序、转义与非 ASCII 密文、带外围空白的 JSON 回退、空 / naive / 带时区时间、非法 JSON 回退抛错，以及真实数据库的 live / trash 过滤与更新时间倒序。2026-10-21 与 Pwsvc 全域合跑共 48 项通过（隔离 SQLite，日志 `.ui-qa/optimization/vault-pwsvc-final-tests.log`）；该结果验证契约，不作为本次拼接改动的性能收益证明。

前端验证见 `docs/optimization/frontend-verification.md`。25 项共享专项包含旧 Argon2id 账号 / 密文兼容、不可导出密钥、错误密码、解密期间锁定、HIBP 不落完整哈希、子任务队列停止与剪贴板归属。隔离 Chromium 使用真实 KDF Worker 与 250 个真实密文条目，验证虚拟行数、最后一行可达、锁定期间返回旧响应不发布明文，以及 400 保存保留编辑输入；另 4 项取消验证挂起 HIBP 后锁定不发后续检查、挂起文件读取后锁定 / 换条目均不会 POST。没有降低 KDF 参数来获取测试性能。

账号本的前端纯函数回归见 `frontend/tests/vault-notebook.test.js`。端到端脚本 `frontend/tools/test-vault-notebook.mjs` 使用隔离 QA 环境，覆盖从门户进入独立服务、解锁与恢复、导入、删除、密文备份和附件逐字节还原。使用全新的隔离数据库运行同一脚本的 `--from-backup` 模式，可验证首次打开时直接恢复、加密类别目录和锁定时的任务取消。

`frontend/tools/test-vault-notebook.mjs --reset-empty` 使用隔离数据库验证空库换发、两种新凭据解锁、旧标签页拒绝写入和最近删除保护。

`--groups` 模式验证旧账号、空分组跨解锁、编辑器内建组、收藏与搜索、键盘选择、改名删组、并发冲突和备份还原。

`--sites` 模式验证网站预设、自定义名称、登录网址识别、键盘选择、搜索筛选和 CSV / 加密备份往返。明文 CSV 的可选 `site_name` 列记录手填的网站名称，标准浏览器 CSV 按原有网址列导入。

## 7. 已知边界

- 恢复密钥可从锁屏或设置中重设主密码。重新包裹原库密钥并保留原派生参数、条目和附件。主密码和恢复密钥同时遗失时，无法解密。
- 最近删除中的记录和附件会保留，直至手动彻底删除。
- **审计日志无清理策略**（AGENTS.md 已知问题 #1 同源）：vault_audit_logs 只增不减。
- **`POST /import` 接受笔误格式串** `'doublog-vault-backdown'`（历史兼容残留，导出只写 `doublog-vault-backup`）。
- HIBP 依赖用户主动发起的外部范围查询；外部 Favicon 默认为关闭，明确启用会向 DDG 披露域名。离线泄露检查返回 -1（未知），图标回退字母。
- 虚拟渲染减少 DOM，不是服务端明文分页：搜索 / 健康分析仍需当前解锁会话的完整内存条目。未引入明文磁盘缓存；锁定不能物理抹除 JavaScript 引擎已分配的不可变字符串，只能撤销引用、停止任务和阻止旧结果发布。Argon2id 120 秒超时是任务边界，不能保证所有设备在固定毫秒数内解锁。
- 恢复加密备份会替换全库；浏览器 CSV 可追加账号；单条目附件无数量上限（仅单文件 5MB），总量受库大小约束。
- 在线暴力破解防护复用站点认证边界（个人/内网部署假设，vault-design.md 威胁模型已声明）；Passkey/WebAuthn 解锁列为二期。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一侧栏（默认 220px，可拖动/键盘调整 180–420px，可折叠为 56px 图标窄轨；见 docs/modules/frontend.md）、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

锁定界面的返回与主题控制归入公共侧栏。Argon2id 的 m 参数显示单位修正为 KiB（与本地 hashes 实现一致），不改变加密参数。
