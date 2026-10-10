# Digital Vault 设计文档

> ⚠️ **历史设计稿**（成稿于 Flask 时代，先于附件/告警等功能）。实现与现行行为的权威文档是 `docs/modules/vault.md`；本文保留算法规范与威胁模型的参考价值，结构/路径/API 清单以模块文档为准。（2026-10-10 标注）


> 个人密码管理器（DouBlog 模块，与日记同级的独立模块，跟随设置中的数据库连接）。
> 安全优先级：Security > Correctness > UX > Features。
> 第一阶段面向个人使用；架构为未来多客户端（浏览器扩展/移动端）预留独立 Core 模块。

---

## 1. 产品信息架构

```
数字资产首页 (/vault，未锁定时为锁屏)
├── 初始化向导（首次）：设置主密码 → 生成并展示 Recovery Key（仅一次）
├── 锁屏：主密码 / Recovery Key 解锁
└── Vault 主界面（三面板）
    ├── 概览 Dashboard：总账号数 / 最近使用 / 最近修改 / 收藏 / 安全提醒 / Identity 概览
    ├── 列表（中栏）：All / Favorites / Recently Used / Passwords / Identities / Categories / Tags / Security / Trash
    ├── 详情（右栏）：LOGIN / IDENTITIES / SECURITY / PASSWORD HISTORY / NOTES / CUSTOM FIELDS
    ├── 编辑器：全字段表单（多 Email/手机/URL/登录方式/密钥/自定义字段/标签）
    ├── 生成器：Password（8-128，字符集，排除易混淆）+ Passphrase + 熵/强度
    ├── 安全中心：弱/复用/过旧/无2FA/重复/缺恢复方式（全部客户端分析）
    ├── 设置：自动锁定 / 剪贴板清理 / 修改主密码 / Recovery Key 轮换 / 导入导出
    └── Command Palette（Ctrl+K 全局搜索）
```

## 2. 页面结构

| 页面 | 布局 |
|---|---|
| 锁屏/初始化 | 居中单卡，品牌感、克制 |
| Dashboard | 窄栏信息流：总数 → 安全概览 → 最近使用 → 收藏 → Identity 排行 |
| Vault 三面板（桌面） | Sidebar(200px) \| Items(300px) \| Detail(flex)，不跳页，点击即右侧显示 |
| 移动端 | 单栏 + 层级推进（列表 → 详情 → 编辑），底部安全区适配 |
| 弹层 | Command Palette（居中浮层）、确认对话框、生成器抽屉 |

## 3. 用户核心操作流程

1. **初始化**：输入主密码（两次）→ 客户端生成 VEK + Argon2id 盐 → 展示 Recovery Key（必须确认已保存）→ 服务端建档（仅密文材料）
2. **解锁**：拉取 kdf 参数 + wrapped key → Argon2id 派生 KEK → AES-GCM 解包 VEK（仅在内存）→ 同步全部条目密文 → 本地解密
3. **日常使用**：Ctrl+K 搜索 → 选中条目 → 复制用户名/密码（剪贴板 N 秒自动清理）→ 记录"最近使用"（服务端只存 credential ID + 时间）
4. **改密码**：编辑器中修改 → 旧密码自动转入 PasswordHistory（replacedAt + 可选原因）→ 整条目重新加密上传
5. **锁定**：闲置超时（5/15/30/60 分钟或"关闭浏览器"）→ 清除内存中的 VEK 与解密缓存 → 重新访问需解锁
6. **主密码修改**：解锁态下仅需重派生 KEK 并重新 Wrap VEK（不重加密任何条目）
7. **恢复**：忘记主密码 → 用 Recovery Key 解锁 → 设置新主密码
8. **备份**：加密导出（自有格式：kdf 参数 + wrapped VEK + 全部条目密文）/ 导入恢复；CSV 明文导出需再次输入主密码 + 双重警告

## 4. 系统架构

```
┌─ 浏览器（零知识客户端）────────────────────────────┐
│ UI（React，三面板）                                 │
│  ├ vault/core.js   模型/生成器/熵/Identity/安全分析  │──┐ 未来复用：
│  ├ vault/crypto.js 加密核心（独立模块）              │──┘ Browser Ext / Mobile
│  │   Argon2id(@noble/hashes) + AES-256-GCM(WebCrypto)│
│  └ 内存态：VEK(CryptoKey, 不可导出) + 解密缓存       │
└──────────────┬──────────────────────────────────────┘
               │ HTTPS + Basic Auth；载荷全部是密文/非敏感元数据
┌──────────────▼──────────────────────────────────────┐
│ Flask（现有后端，同一 DB 会话，跟随 db_config.json）   │
│  vault 蓝图：账号密文材料 / 条目 CRUD / 回收站 / 审计  │
│  永远不做：解密、搜索、密码分析、明文存储              │
└──────────────────────────────────────────────────────┘
```

关键约束：**搜索/安全分析/强度评估全部在客户端解密后进行**；服务端不接收任何明文敏感字段（API 层面即不存在这些参数）。

## 5. 数据库 ER 设计（物理 = 逻辑加密模型的映射）

物理表（服务端仅存密文与非敏感元数据；逻辑 ER 中的 Credential/Secret/History/Identity/Tag/CustomField 全部位于条目密文 blob 内，比明文关系表更安全，且天然支持客户端关系计算）：

```
vault_accounts (单行)
  id, kdf_algo, kdf_params(JSON: t/m/p), kdf_salt, recovery_salt,
  wrapped_vault_key(ct+nonce), recovery_wrapped_vault_key(ct+nonce),
  created_at, updated_at

vault_items
  id, blob(ct+nonce)            -- 加密的完整条目（见 §6 载荷）
  favorite BOOL, last_used_at, password_updated_at   -- 非敏感元数据
  deleted_at NULL               -- 回收站（软删，保留 30 天语义）
  created_at, updated_at

vault_audit_logs
  id, action, item_id NULL, created_at   -- 仅行为；禁止 secret/旧密码/剪贴板内容
```

逻辑载荷（AES-256-GCM 密文内的 JSON）：

```
Credential {
  v, service, type(Website|App|Email|Social|Developer|Server|Finance|Work|Other),
  category(Social|Developer|Work|Finance|Shopping|Entertainment|Email|Server|Other),
  urls[{label,value}], app_name, username, account_id,
  password{value}, password_history[{value,createdAt,replacedAt,reason}],
  identities[{type:email|phone, value, role:primary|recovery}],
  login_methods[], secrets[{kind:2fa_secret|backup_code|pin|api_key|recovery_key|security_question, question?, value}],
  custom_fields[{key,value,secret}], notes, tags[]
}
Identity（派生视图）= 解密后按 identities[].value 分组 → 关联条目列表与计数
```

## 6. Vault 加密方案

```
Master Password ──Argon2id(salt₁, t/m/p)──▶ KEK₁ ──AES-GCM-wrap──▶ VEK(256-bit 随机)
Recovery Key(256-bit 随机，仅展示一次) ──Argon2id(salt₂)──▶ KEK₂ ──wrap──▶ VEK
条目/备份：VEK + AES-256-GCM(12-byte 随机 nonce，每次加密全新)
```

- **不发明密码学**：Argon2id 用 `@noble/hashes`（审计活跃维护），AEAD 用浏览器原生 Web Crypto `AES-GCM`
- VEK 以**不可导出的 CryptoKey** 存于内存，永不落 localStorage/cookie/URL/日志
- KDF 参数随账号存于服务端（明文、非敏感），可安全调优升级
- 主密码修改 = 重派生 KEK + 重新 wrap VEK（条目零重加密）
- 初始化默认参数 t=2, m=32768(32MiB), p=1（浏览器实测校准后固化，见测试记录）
- 数据库只保存：ciphertext、nonce、algorithm version、KDF 参数、wrapped VEK

## 7. API 设计（全部挂现有 Basic Auth；服务端无搜索接口）

```
GET    /api/vault/account                 KDF 参数 + wrapped keys（404=未初始化）
POST   /api/vault/account                 初始化 {kdf_algo,kdf_params,kdf_salt,recovery_salt,wrapped_vault_key,recovery_wrapped_vault_key}
PUT    /api/vault/account/keys            轮换 {kdf_params?,kdf_salt?,recovery_salt?,wrapped_vault_key,recovery_wrapped_vault_key}
GET    /api/vault/items?trash=0|1         列表（元数据+blob）
POST   /api/vault/items                   创建 {blob,favorite?,password_updated_at?}
PUT    /api/vault/items/<id>              更新 {blob,favorite?,password_updated_at?}
POST   /api/vault/items/<id>/use          记录最近使用（仅 ID+时间）
DELETE /api/vault/items/<id>              移入回收站（软删）
POST   /api/vault/items/<id>/restore      恢复
DELETE /api/vault/items/<id>/purge        永久删除
GET    /api/vault/audit?page=&page_size=  审计日志（行为+条目ID+时间）
GET    /api/vault/export                  加密备份（账号材料+全部条目）
POST   /api/vault/import                  导入（替换式恢复）
```

## 8. 前端组件结构

```
src/vault/
  crypto.js        createVault/unlock/wrapKey/encryptBlob/decryptBlob/recoveryKey 工具
  core.js          常量(类型/分类/密钥种类)、生成器(无偏随机)、熵与强度、
                   Identity 提取与分组、安全分析、密码历史辅助、示例/校验
  ui.jsx           SecretField(默认隐藏/Reveal 15s 自动隐藏/Copy)、CopyButton、
                   Favicon(DDG icons+字母回退)、小图标集
  VaultPage.jsx    壳：初始化/锁屏/主界面状态机、自动锁定、Cmd+K、设置、备份
  ItemList.jsx     中栏列表（搜索、分组、过滤：类别/身份/标签/安全状态/回收站）
  ItemDetail.jsx   右栏详情（LOGIN/IDENTITIES/SECURITY/HISTORY/NOTES/CUSTOM）
  ItemEditor.jsx   全字段编辑器（含改密码→历史、内嵌生成器）
  Generator.jsx    生成器面板（Password/Passphrase/熵/复制/重生成）
  SecurityCenter.jsx 六类风险清单（点击跳条目）
```

## 9. 安全威胁模型

| 威胁 | 缓解 |
|---|---|
| 服务端/数据库泄露 | 只拿到 Argon2id 保护下的 wrapped VEK 与 AES-GCM 密文；离线爆破需对抗 32MiB Argon2id |
| 恶意/被动网络 | 全密文传输（配合部署侧 HTTPS）；服务端无法解密 |
| XSS 窃取主密码 | 主密码仅出现在解锁表单内存；不写 localStorage；VEK 不可导出；复制不落 console |
| 闲置设备被物理接触 | 自动锁定清空密钥；Reload/关浏览器即锁（密钥仅存内存） |
| 剪贴板遗留 | 复制后 10/30/60s 自动覆写清理 |
| 日志泄密 | 审计只记行为+条目 ID；服务端 API 不存在明文字段；测试断言库内无明文 |
| 忘记主密码 | Recovery Key（Argon2id 包裹的同一 VEK）；两者同时丢失=数据不可恢复（明确告知用户） |
| 暴力破解在线 | 复用站点 Basic Auth 边界（个人内网部署假设，文档标注） |
| 依赖供应链 | 仅新增 @noble/hashes（广泛审计）；AEAD 用原生 WebCrypto |
| CSRF/点击复制滥用 | 单用户本地工具；复制仅由用户手势触发 |

已知限制（第一阶段）：Passkey/WebAuthn 解锁依赖浏览器 PRF 扩展普及，列为二期；在线暴力破解防护依赖部署层。

## 10. 项目目录结构（新增部分）

```
backend/app/api/vault.py            # 零知识 API
backend/app/models/models.py        # + VaultAccount/VaultItem/VaultAuditLog
backend/tests/test_vault.py
frontend/src/vault/{crypto,core,ui,VaultPage,ItemList,ItemDetail,ItemEditor,Generator,SecurityCenter}.{js,jsx}
frontend/src/api.js                 # + vault 封装
frontend/src/App.jsx                # + /vault 路由 + 首页"密码库"入口
docs/vault-design.md                # 本文档
```

## 附：UI 语言与视觉（用户确认后的实现口径）

- **界面文案全部中文**（原始需求文档中的英文词条仅作功能示意）；枚举值存储英文、展示层中文映射（TYPE_LABELS / CATEGORY_LABELS / SECRET_KIND_LABELS / METHOD_LABELS / 强度分级），改翻译不影响数据
- 视觉沿用本站暖石色（stone）体系，与日记模块同一语言：留白、克制、高信息密度、安全感；暗色为暖黑 `#100f0e`；顶栏标识「密码库」
- 概览页铺满全屏（max-w-6xl）：大数字统计 + 库健康度进度条 + 六卡安全风险网格（点击跳安全中心）+ 双栏最近使用/收藏/身份与最近修改；安全中心同宽双栏卡片分组
