# Vault 模块文档（零知识密码库）

> 生成日期：**2026-10-10**，依据当前代码（`backend/app/vault/`、`backend/tests/vault/`、`frontend/src/vault/`）与 `docs/vault-design.md` 整理。
> 威胁模型与算法规范详见 `docs/vault-design.md`；本文件是"代码现状"的模块级快照。

---

## 1. 功能概述

单用户零知识密码库（`/vault`）：服务端**只存密文**，所有加密/解密/搜索/分析在浏览器完成。

- **零知识加密模型**：主密码 --Argon2id--> KEK₁ --AES-GCM-wrap--> VEK（256-bit 随机）；Recovery Key --Argon2id(salt₂)--> KEK₂ 包裹**同一** VEK；条目/附件用 VEK + AES-256-GCM（每次全新 12-byte nonce）。VEK 以不可导出 `CryptoKey` 只存内存，锁定/刷新/关浏览器即清除。Argon2id 用 `@noble/hashes`，AEAD 用原生 WebCrypto——不发明密码学。
- **三面板主界面**（解锁后）：左侧栏（概览/全部/收藏/最近使用/分类/标签/身份/安全中心/密码服务/回收站）｜中栏条目列表（客户端解密后搜索）｜右栏详情或编辑器；移动端单栏层级推进；⌘K Command Palette 全局搜索。
- **概览 Dashboard**：大数字统计 + 库健康度进度条 + 密码到期提醒横条 + 六卡安全风险网格 + 最近使用/收藏/身份/最近修改双栏。
- **TOTP 验证码**（`components/totp.js`，RFC 6238）：2FA Secret 支持 Base32 或 `otpauth://` URI（编辑器粘贴自动解析，签发方回填服务名）；详情页实时生成 6-8 位码 + 30s 环形倒计时 + 一键复制；HMAC-SHA1 走 WebCrypto，密钥不出设备。
- **HIBP 泄露检查**（`components/hibp.js`）：k-anonymity——仅上传密码 SHA-1 前 5 位；结果缓存 localStorage（键为完整 SHA-1，单向不可逆）；网络不可达返回 -1（未知 ≠ 安全）。
- **健康总评分**（安全中心）：0-100 环 = 100 − 泄露×15 − 弱×8 − 复用组×10 − 到期×4 − 过旧×3 − 无2FA×2 − 重复组×2 − 缺恢复×1，点击下钻到对应分组。
- **安全中心**八组清单：已泄露/弱（熵<60）/复用/过旧（>180 天）/到期提醒/未开 2FA（含 Passkey 视为已开）/重复账号（同服务+用户名）/缺恢复方式——全部客户端分析。
- **安全附件**（`vault_attachments` 表）：前端 VEK 加密 `{filename, mime, data}` 后整包上传，服务端只见密文 + 客户端上报的明文 size；明文 ≤5MB、密文 base64 ≤8MB 双端校验；下载时解密还原文件名；软删条目附件冻结保留（恢复语义），purge 级联删除。
- **密码历史**：编辑器改密自动归档（`core.js applyPasswordChange`，旧密码 + createdAt/replacedAt/reason 进密文内 history），详情页时间线展示。
- **生成器**：随机密码（8-128 位、四字符集、默认排除易混淆 I/l/O/0/1）+ 口令短语（3-10 词、256 词 EFF 风格词表）+ 熵/强度评估；无偏随机（拒绝采样 + Fisher-Yates）。
- **密码到期提醒**：条目密文内 `expiry_days`（0-3650，null=不提醒）；判定纯客户端（`core.js expiryInfo()`），概览横条 + 详情徽标 + 安全中心分组；**服务端完全不感知到期与否**。
- **自动锁定**：5/15/30/60 分钟闲置或"关闭浏览器"（密钥仅内存，刷新即锁）；锁定清除 VEK、条目缓存并回锁屏。
- **Recovery Key**：256-bit（64 hex，4 位一组展示）仅初始化/轮换时显示一次；可轮换（旧钥立即作废）。
- **加密备份**：`GET /export` 自有格式（kdf 参数 + 双通道包裹 VEK + 全部条目密文）落盘 JSON；`POST /import` 替换式恢复（含回收站状态）；CSV 明文导出需再次验证主密码（本地）+ 双重警告。
- **审计日志**：仅记 action + item_id + 时间，永不包含密码/密钥/剪贴板内容。
- 密码服务子模块（轮换密码，**非零知识**，`components/PwsvcView.jsx` + `backend/app/pwsvc/`）作为 vault 页面内的一个侧栏入口存在，详见 `docs/modules/pwsvc.md` 与 `docs/pwsvc-design.md`。

**解锁 ≠ 登录**：站点统一登录走会话 Cookie（`/api/auth/login`，登录一次全站生效）；vault 主密码解锁是**零知识加密的解密步骤**（派生 KEK 解包 VEK），不是登录，不签发任何凭据。UI 文案一律"解锁保险库/主密码"，不使用"登录"。

## 2. 数据模型（`backend/app/vault/models.py`，四表）

表名规则 `vault_*`，与其他模块同库（`db_config.json` 切换生效）。**物理表无任何明文敏感列**（测试断言）。

| 表 | 列 | 说明 |
|---|---|---|
| `vault_accounts`（单行） | id, kdf_algo('argon2id'), kdf_params(JSON 文本 {t,m,p}), kdf_salt, recovery_salt（base64）, wrapped_vault_key, recovery_wrapped_vault_key（`{n,ct}` JSON 文本）, created_at, updated_at | 仅零知识加密材料；服务端永不接触主密码/Recovery Key/VEK 明文 |
| `vault_items` | id, blob(`{n,ct}` JSON 文本), favorite(BOOL, 索引), last_used_at, password_updated_at, deleted_at(索引，回收站软删), created_at, updated_at | 敏感内容全在密文 blob 内；明文列均为非敏感元数据 |
| `vault_attachments` | id, item_id(FK→vault_items, 索引), blob(`{n,ct}`，内含加密的文件名/mime/数据), size(明文字节数，客户端上报), created_at | 生命周期跟随条目：软删冻结保留，purge 级联删除 |
| `vault_audit_logs` | id, action(索引), item_id(可空), created_at | **只记行为与条目 ID**，禁止任何 secret/旧密码/剪贴板内容 |

密文统一结构 `blob = {n: base64(12B nonce), ct: base64(ciphertext)}`（AES-256-GCM）。
条目密文内的逻辑载荷（Credential JSON）：`v, service, type, category, urls[], app_name, username, account_id, password{value}, password_updated_at, expiry_days, password_history[], identities[], login_methods[], secrets[], custom_fields[], notes, tags[]`——类型/分类/密钥种类等枚举**存英文值，展示层中文映射**（`core.js *_LABELS`），改翻译不动数据。

审计 action 枚举：`vault_initialized, vault_keys_rotated, created, updated, password_changed, used, trashed, restored, purged, exported, imported, attachment_added, attachment_removed`。

## 3. API 契约（`backend/app/vault/routes.py`，17 端点）

统一前缀 `/api/vault`，整 router 挂 `Depends(require_basic)`（**优先会话 Cookie，其次 Basic**，与其他模块一致）；响应走 `api_response` 信封 `{success, code, message, data}`。

### 账号（加密材料）

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 1 | `GET /api/vault/account` | — | 账号 dict（kdf_algo/kdf_params/kdf_salt/recovery_salt/双通道包裹 VEK/created_at） | 404 未初始化 |
| 2 | `POST /api/vault/account` | `{kdf_algo:'argon2id', kdf_params:{t≥1,m≥8192,p≥1}, kdf_salt(16-64 字符), recovery_salt, wrapped_vault_key:{n,ct}, recovery_wrapped_vault_key:{n,ct}}` | 201 + 账号 dict | 409 已初始化；400 kdf_params/kdf_algo/盐/box 结构非法 |
| 3 | `PUT /api/vault/account/keys` | 可选组合 `{wrapped_vault_key, kdf_salt?, kdf_params?}` 和/或 `{recovery_wrapped_vault_key, recovery_salt?}` | 200 + 更新后账号 dict | 404 未初始化；400 结构非法 |

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

条目 dict 字段：`id, blob, favorite, last_used_at, password_updated_at, deleted_at, created_at, updated_at`。

### 安全附件

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 11 | `GET /api/vault/items/{id}/attachments` | — | 附件 dict 数组（created_at 升序） | 404 条目不存在；400 条目在回收站 |
| 12 | `POST /api/vault/items/{id}/attachments` | `{blob:{n,ct}, size}` | 201 + 附件 dict；审计 attachment_added | 404/400（回收站、结构非法、size 非整数）；**413**（明文 >5MB 或密文 base64 >8MB） |
| 13 | `GET /api/vault/attachments/{aid}` | — | 附件 dict（回收站条目的附件仍可单取——恢复语义） | 404 |
| 14 | `DELETE /api/vault/attachments/{aid}` | — | 200 `{id}`；审计 attachment_removed | 404 |

限额常量：`ATTACHMENT_MAX_BYTES = 5MB`（明文）、`ATTACHMENT_MAX_CIPHER_CHARS = 8MB`（密文 base64，5MB→约 6.7MB + 余量）。

### 审计 / 备份

| # | 方法/路径 | 参数 | 成功响应 | 错误 |
|---|---|---|---|---|
| 15 | `GET /api/vault/audit` | `?page=1&page_size=50`（page_size 上限 200，非法值回退默认） | `{items, total, page}`（created_at 倒序） | — |
| 16 | `GET /api/vault/export` | — | 备份对象（见下）；审计 exported | 404 未初始化 |
| 17 | `POST /api/vault/import` | 备份对象整体 | `{imported_items:N}`；审计 imported | 400（format 非法/账号材料不完整/条目密文结构非法/缺 items） |

备份格式：`{format:'doublog-vault-backup', version:1, exported_at, account, items:[全部条目，含回收站]}`；导入为**替换式**（覆盖账号材料、清空并重建全部条目），前端导入后强制重新解锁。

## 4. 后端要点

- **零知识红线**（AGENTS.md 第 13 条）：服务端只存取密文（blob/包裹 VEK），不解析、不搜索内容；**API 层不存在任何明文敏感参数**（无 password/secret 字段），禁止新增"服务端搜索/密码分析"类接口；搜索/强度/泄露/到期判定全部在客户端解密后进行。
- **`_valid_box()` 结构校验**：只接受 `{n: str(16-64 字符 base64), ct: str(8-200000 字符)}` 形态；附件走同结构但 ct 无 200000 上限（大密文先给 413 而非 400）。任何非该结构的 payload 直接 400——这是"契约层面不接受明文"的落地（测试 `test_item_rejects_plaintext_shape`）。
- **软删/恢复/purge 级联**：DELETE=软删（deleted_at）；restore 置空；purge 物理删除条目并 `DELETE ... WHERE item_id=` 清附件（响应带 `attachments_purged:true`）。回收站条目的附件列表/上传返回 400，单取仍 200（恢复语义）。
- DB 访问统一经 `run_db`（scoped session）；审计 `_audit(action, item_id)` 只落行为行。**条目列表/导出走性能路径**：核心查询取元组（免 ORM 实例化），blob 列原文（落库时均经 `json.dumps`，恒为合法 JSON 文本）直接拼进响应，免"每行 json.loads + 整包再 dumps"双重序列化（500 行列表请求 CPU 约减半，实测 27.9→47.8 rps，见 `tools/bench/vault/`）；单条端点仍走 `Model.query` + `to_dict`。
- **写锁重试**：全部端点的 `_impl` 经 `_retry_locked` 包装——偶发 `OperationalError(database is locked)`（高并发写下 ~0.1%）回滚后 20/40/60ms 退避重试至多 3 次；非锁类异常原样抛出。
- 模块包契约：`app/vault/__init__.py` 导出 `router` + `ensure_migrations(engine)`（幂等 `CREATE INDEX IF NOT EXISTS` 补建两个性能索引：`ix_vault_items_trash_order(deleted_at, updated_at)` 支撑列表过滤+排序、`ix_vault_audit_logs_created_at(created_at)` 支撑审计分页；新建库由 create_all 直接带上，无表改名需求）；无 start_background；由 `main.py` 的 `MODULES` 注册表按序挂载。
- 已知代码怪癖：`POST /import` 的格式串校验同时接受 `'doublog-vault-backup'` 与历史笔误 `'doublog-vault-backdown'`（导出只写前者；见"已知边界"）。

## 5. 前端（`frontend/src/vault/`）

- **`VaultPage.jsx`（状态机壳）**：`loading → setup（初始化向导）/ locked（锁屏）→ unlocked（三面板）`。进入时 `GET /account` 探测（200=已初始化→locked，404→setup）；`unlock()` 调 `unlockVault` 解包 VEK 存 `vekRef`（useRef，**不进 state/localStorage**），随后并行拉取 live+trash 两列表并逐条解密；`lockNow()` 清 VEK/条目/选择态回 locked。自动锁定：pointerdown/keydown 刷 lastActivity，15s 轮询比对阈值。其余职责：设置弹层（自动锁定/剪贴板/改主密码/轮换 Recovery Key/备份导入导出/活动记录）、⌘K Command Palette、purge 确认、移动端覆盖层。
  - **解锁≠登录**：锁屏文案"密码库已锁定/输入主密码/解锁保险库"；错误提示"主密码不正确"——这是本地解密步骤，与站点会话登录（Cookie）无关。
- **`components/crypto.js`（加密核心，独立可复用）**：`createVaultMaterial`（初始化）/ `unlockVault`（解锁，错误密码→GCM 校验失败抛错）/ `rewrapVaultKey`（改主密码/轮换恢复密钥，仅重包裹不重加密条目）/ `encryptBlob`/`decryptBlob`/`generateRecoveryKey`/`normalizeRecoveryKey`。Argon2id `@noble/hashes`（默认参数 t=2, m=32768, p=1，解锁以服务端账号参数为准），AEAD 原生 WebCrypto；VEK 以 `extractable:false` 的 CryptoKey 只存内存。**任何函数不 console 输出密钥/明文**。
- **`components/core.js`（纯逻辑，无 UI/网络）**：枚举常量 + 中文映射、`emptyItem()`、生成器（`randomInt` 拒绝采样无 modulo 偏差）、熵/强度（`passwordEntropy`/`passphraseEntropy`/`strengthLabel`）、`extractIdentities`、`analyzeSecurity`（弱/复用/过旧/expired/no2fa/重复/缺恢复）、`expiryInfo`（到期判定）、`applyPasswordChange`（历史推进）、`itemMatches`/`domainOf`/`daysAgo`。
- **`components/ui.jsx`（UI 原子）**：`makeClipboardCopier`（复制后 10/30/60s 自动覆写清理，仅清未被覆盖内容）、`CopyButton`、`SecretField`（默认 `•••` 遮蔽、Reveal 15s 自动隐藏、卸载即隐藏）、`FieldRow`、`Favicon`（DDG icons + 字母回退）、图标集 `I`。
- **`components/ItemDetail.jsx`**：LOGIN/TOTP/绑定身份/密钥/安全状况/附件/密码历史时间线/自定义字段/备注（Markdown 渲染）分区。
- **`components/ItemEditor.jsx`**：全字段表单；改密自动推进历史（可填原因）；2FA 字段支持粘贴 otpauth:// 自动解析；`expiry_days` 输入；标签/自定义字段/多 URL/多身份/多密钥。
- **`components/Generator.jsx`**：密码/口令短语双 tab + 熵条 + 复制/重生成/`onUse` 填充编辑器。
- **`components/SecurityCenter.jsx`**：健康总评分环 + HIBP 检查（密码去重、并发 3、进度）+ 八组风险分组（点击跳条目）。
- **`components/totp.js` / `hibp.js`**：见第 1 节；均零第三方依赖。
- **`api.js`**：vault 17 端点 + pwsvc 端点的 fetch 封装，全部经 `@/shared/client` 的 `apiFetch`（统一会话 Cookie/凭据）；文件内不出现任何明文口令参数。
- **`components/PwsvcView.jsx`**：密码服务子视图（侧栏"密码服务"入口），项目/类型/用户/当前轮换密码/校验日志/限流管理，UI 明确标注"非零知识"；见 `docs/modules/pwsvc.md`。
- 枚举存储英文、展示中文；`index.css` 有 `@source "./vault"` 白名单与 `.vault-input` 类（锁屏/设置输入框复用）。

## 6. 测试（`backend/tests/vault/test_vault.py`，14 用例）

自包含（conftest 临时 SQLite + TestClient + Basic 头）：

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
12. `test_attachment_limits_and_validation` — 非法 blob/size 400；明文>5MB、密文>8MB 413；上限内 201
13. `test_attachment_lifecycle_with_item` — 软删后列表/上传 400、恢复后回归、purge 级联、条目 404
14. `test_attachment_audit_logged` — attachment_added/attachment_removed 落审计

## 7. 已知边界

- **忘记主密码的完整恢复流程未闭环**：crypto 层支持用 Recovery Key 解锁并 rewrap 新主密码，但设置页"修改主密码"固定要求输入**当前主密码**（不支持"用 Recovery Key 解锁后直接设新主密码"的引导路径）；Recovery Key 与主密码同时丢失 = 数据不可恢复。
- **回收站无自动清理**：设计文档提到"保留 30 天语义"，但代码没有任何 30 天自动 purge（回收站条目永久保留直至手动 purge）。
- **审计日志无清理策略**（AGENTS.md 已知问题 #1 同源）：vault_audit_logs 只增不减。
- **`POST /import` 接受笔误格式串** `'doublog-vault-backdown'`（历史兼容残留，导出只写 `doublog-vault-backup`）。
- HIBP/Favicon 依赖外部网络（api.pwnedpasswords.com / icons.duckduckgo.com）：离线时泄露检查返回 -1（显示"不可达"）、favicon 回退字母块；部署在无外网环境功能降级。
- 导入是替换式（无合并）；单条目附件无数量上限（仅单文件 5MB），总量受库大小约束。
- 在线暴力破解防护复用站点认证边界（个人/内网部署假设，vault-design.md 威胁模型已声明）；Passkey/WebAuthn 解锁列为二期。
