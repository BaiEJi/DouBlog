# 密码库模块竞品调研与升级建议

> 2026-09 调研。对象：DouBlog `/vault` 零知识密码库（含 pwsvc 密码服务子模块）。
> 方法：网络调研 12 个代表性产品（开源 7 + 商业 5），逐维度对比后给出分级升级清单。
>
> **2026-10 落地进度**：P0 三项（TOTP 验证码 / HIBP 泄露检查 / 编辑器实时强度）与 P1 的 #5 安全附件、#6 剪贴板自动清除、#7 健康总评分均已上线（详见 `docs/modules/vault.md`）。下文各表"DouBlog 现状"列是**调研时点快照**，请勿作为现状参考。

---

## 一、调研对象速览

### 开源项目

| 项目 | 形态 | 加密 | 特色 |
|---|---|---|---|
| **Bitwarden / Vaultwarden** | 云同步（可自建） | 零知识，PBKDF2/Argon2 | 开源标杆：全平台、passkey、Send 加密分享、TOTP、HIBP 泄露检查 |
| **KeePassXC** | 纯本地文件 | AES/ChaCha20 | 离线王者：TOTP、passkey（2.7.10+）、附件、浏览器无关、KDBX 格式生态 |
| **Proton Pass** | 云同步（瑞士） | 零知识 | 邮箱别名（hide-my-email）、passkey、TOTP、开源客户端 |
| **Passbolt** | 自建 + 浏览器扩展 | OpenPGP | 团队协作导向、共享、审计 |
| **Psono** | 自建 | 零知识 | 团队共享、API、多因素 |
| **Padloc** | 跨端同步 | 零知识 | 极简 UX、开源 |
| **Vaultwarden**（Bitwarden 兼容服务端） | 轻量自建 | 同 Bitwarden | Rust 重写、资源占用极小 |

### 商业产品

| 产品 | 定位 | 招牌能力 |
|---|---|---|
| **1Password** | 体验标杆 | Watchtower（泄露/弱/复用/不安全网站）、Secret Key 双密钥、18,328 词 passphrase 词表、丰富条目类别（登录/安全笔记/文档/信用卡/身份/护照/软件许可/服务器/SSN/WiFi…）、Travel Mode、紧急访问 |
| **Dashlane** | 全功能 | 暗网监控 + 密码健康分（0-100）、内置 VPN、密码更换自动化 |
| **Keeper** | 安全合规 | 高级加密与合规认证、BreachWatch、安全附件 |
| **NordPass** | 简单易用 | 密码健康、数据泄露监测器 |
| **LastPass** | 老牌 | （近年多次安全事件，口碑下滑，仅作反面对照） |

---

## 二、详细对比矩阵

评分：✅ 完整支持｜🟡 部分｜❌ 不支持

### 2.1 密码库核心（条目/组织/检索）

| 能力 | DouBlog 现状 | Bitwarden | KeePassXC | Proton Pass | 1Password | Dashlane |
|---|---|---|---|---|---|---|
| 登录条目（用户名/密码/网址） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 多种条目类型 | 🟡 9 类（平铺） | ✅ 4 类 | 🟡 模板 | ✅ | ✅ 20+ 类别 | ✅ |
| 收藏 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 文件夹/集合 | 🟡 类型+分类+标签等价 | ✅ | ✅ 组/标签 | 🟡 | 🟡 | 🟡 |
| 自定义字段（含机密字段） | ✅（2FA/PIN/API Key…） | ✅ | ✅ | ✅ | ✅ | ✅ |
| 密码历史 | ✅ 查看+归档 | ✅ | ✅ | 🟡 | ✅ | 🟡 |
| 回收站（软删/恢复） | ✅ | ✅ | 🟡 回收站组 | ✅ | ✅ | ✅ |
| ⌘K/快捷搜索 | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ |
| 密码到期/轮换周期 | ✅ expiry_days | ❌ | 🟡 过期插件 | ❌ | ❌ | 🟡 |
| 身份（邮箱/手机聚合） | ✅ | 🟡 Identity 类型 | 🟡 | ✅ 邮箱别名 | ✅ | ✅ |
| **TOTP 验证码生成** | ❌（仅存 Secret+标记） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Passkey 存储管理** | 🟡 只读标记 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 安全附件（加密文件） | ❌ | ✅ | ✅ | ✅ | ✅ Documents | ✅ |

### 2.2 安全分析（安全中心）

| 能力 | DouBlog 现状 | Bitwarden | 1Password Watchtower | Dashlane | NordPass |
|---|---|---|---|---|---|
| 弱密码检测 | ✅ 本地启发式 | ✅ | ✅ | ✅ | ✅ |
| 复用密码检测 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 过旧密码检测 | ✅ | ❌ | 🟡 | 🟡 | 🟡 |
| 到期提醒 | ✅ | ❌ | ❌ | 🟡 | ❌ |
| 无 2FA 项提示 | ✅ | 🟡 | 🟡 | 🟡 | 🟡 |
| **泄露/撞库检查（HIBP）** | ❌ | ✅ k-anonymity | ✅ | ✅ 暗网监控 | ✅ |
| 不安全网站（HTTP）标记 | ❌ | 🟡 | ✅ | 🟡 | 🟡 |
| 总体健康评分（0-100） | ❌ 列表式 | 🟡 | 🟡 | ✅ | ✅ |

### 2.3 生成器与日常 UX

| 能力 | DouBlog 现状 | Bitwarden | 1Password | KeePassXC |
|---|---|---|---|---|
| 随机密码生成 | ✅ | ✅ | ✅ | ✅ |
| 口令短语生成 | ✅ | ✅ | ✅（专用词表） | ✅ |
| 密码强度实时评估 | 🟡 生成器内 | ✅ | ✅ | ✅ |
| 一键复制 + 剪贴板自动清除提示 | 🟡 复制有/自动清无 | ✅ 30-120s | ✅ 90s | ✅ 10-60s |
| 编辑器内"重新生成" | ✅ | ✅ | ✅ | ✅ |
| 隐藏/显示密码、掩码查看 | ✅ | ✅ | ✅ | ✅ |

### 2.4 加密、备份与解锁

| 能力 | DouBlog 现状 | Bitwarden | 1Password | KeePassXC |
|---|---|---|---|---|
| 零知识（服务端只见密文） | ✅ | ✅ | ✅ + Secret Key | 本地文件 |
| Argon2id 密钥派生 | ✅ | 🟡 可选 | 🟡 | ✅ |
| 加密备份导出/导入（自家格式） | ✅ | ✅ | ✅ | ✅ |
| **第三方格式导入**（Chrome/Bitwarden/KeePass CSV） | ❌ | ✅ 多格式 | ✅ 多格式 | ✅ 多格式 |
| Recovery Key | ✅ | 🟡 恢复码 | ✅ | ❌ 需密钥文件 |
| 自动锁定 | ✅ | ✅ | ✅ | ✅ |
| PIN 快速解锁 | ❌ | ✅ | ✅ | ✅ 快速解锁 |
| 加密文本临时分享（Send 式） | ❌ | ✅ Bitwarden Send | 🟡 | ❌ |
| 紧急访问/继承 | ❌ | ✅ | ✅ | ❌ |

---

## 三、DouBlog 现状盘点

**已达标（做得好的）**
- 零知识架构（Argon2id + AES-256-GCM、服务端只存密文）与 1Password/Bitwarden 同级
- 安全中心维度比多数产品还多（过旧/到期/无2FA 是 Bitwarden 都没有的）
- 密码到期轮换周期（expiry_days）是差异化能力
- 机密字段细分（Backup Code/API Key/Recovery Key）+ 密码历史 + 回收站 + 身份聚合
- ⌘K 搜索、自动锁定、Recovery Key、加密备份——核心闭环完整
- pwsvc 轮换密码服务是独有超集能力

**缺失（对标后的真实差距）**
1. **TOTP 验证码生成**——2026 年所有主流产品的标配；DouBlog 已存 2FA Secret 却不能生成 6 位码，最痛
2. **泄露/撞库检查（HIBP）**——Watchtower/BreachWatch 级功能；可用 k-anonymity 范围查询保持零知识
3. **第三方格式导入**（Chrome / Bitwarden / KeePass CSV/JSON）——迁移刚需
4. **安全附件**（加密文件存储）——保险单扫描件、恢复码 PDF 等场景
5. 剪贴板自动清除、健康总评分、HTTP 不安全标记、PIN 快速解锁、Send 式加密分享（次级）

---

## 四、必须加入清单（分级）

### P0 —— 必须（业界 100% 标配）

| # | 功能 | 业界参照 | DouBlog 落地建议 |
|---|---|---|---|
| 1 | **TOTP 验证码生成与自动轮换显示** | Bitwarden/1Password/KeePassXC 全有 | 前端 `otpauth://` / Base32 Secret → TOTP（RFC 6238，jsOTP 级实现 ~40 行）；ItemDetail 机密字段为 2FA Secret 时显示 30s 环形倒计时 + 6 位码一键复制；编辑器支持粘贴 otpauth URI 自动解析 |
| 2 | **泄露检查（HIBP k-anonymity）** | 1Password Watchtower / Bitwarden | 密码 SHA-1 前 5 位查询 `https://api.pwnedpasswords.com/range/{前5}`（k-anonymity：不发送密码本体，保持零知识）；安全中心加"已泄露"维度 + 条目徽标；可配代理/开关（离线环境降级） |
| 3 | **编辑器内实时强度评估** | 全部产品 | 现有生成器强度逻辑复用到编辑器密码输入框旁（熵值/破解时长估计条） |

### P1 —— 强烈建议（高频真实需求）

| # | 功能 | 业界参照 | 落地建议 |
|---|---|---|---|
| 4 | **第三方导入**（Chrome/Edge 导出 CSV、Bitwarden JSON、KeePass CSV） | Bitwarden/1Password 导入器矩阵 | 设置区"导入"页：文件解析在前端完成（不落明文到服务端）→ 加密入库；字段映射 + 冲突跳过 |
| 5 | **安全附件** | KeePassXC/Bitwarden/Keeper | 条目附件：前端读文件 → AES-GCM 加密（分块）→ 服务端存密文 blob；上限 5MB/文件；下载解密预览 |
| 6 | **剪贴板自动清除** | Bitwarden（30-120s 可配） | 复制密码/TOTP 后启动倒计时，到期写空串清剪贴板 + toast 提示"Xs 后清除"；设置可配秒数 |
| 7 | **健康总评分（0-100）** | Dashlane/NordPass | 安全中心顶部大号评分环：100 − 弱×n − 复用×n − 泄露×n…加权；点击分数下钻对应分组 |

### P2 —— 可选（差异化与锦上添花）

| # | 功能 | 业界参照 | 说明 |
|---|---|---|---|
| 8 | 不安全网站标记（URL 为 http://） | 1Password Watchtower | 安全中心加一维 + 徽标，成本极低 |
| 9 | PIN 快速解锁 | Bitwarden/1Password | 自动锁定后用 6 位 PIN 派生二级密钥解锁（明文密钥内存中保留时），减少长主密码输入 |
| 10 | Send 式加密文本/文件临时分享 | Bitwarden Send | 与日记分享链接同构：限时 + 次数限制 + 独立密钥碎片（#fragment） |
| 11 | Passkey 条目存储（webauthn 凭据备份） | Bitwarden/1Password | 前端注册 credential JSON 当作机密字段加密存；导出/迁移展示（真正自动填充超出 Web 单机范围） |
| 12 | 条目图标（域名 favicon 拉取） | 全部产品 | `https://域名/favicon.ico` 经后端代理拉取缓存（防隐私泄露直连），列表/详情显示 |

### 不建议照搬的

- **团队共享/集合/权限矩阵**（Passbolt/Bitwarden Organizations）：单用户系统无意义
- **紧急访问/继承、Travel Mode**：依赖云服务与多成员
- **邮箱别名**（Proton hide-my-email）：需要外部邮件服务集成
- **浏览器扩展/自动填充**：与"Web 单机知识库"形态不匹配（且是独立大工程）
- **内置 VPN/密码更换机器人**（Dashlane）：纯营销捆绑

---

## 五、结论

DouBlog 密码库的**加密架构与安全分析维度已经是开源一线水准**（零知识 + Argon2id + 比竞品更多的到期/轮换/2FA 检查 + pwsvc 轮换服务是独有能力）。真实差距集中在三件事：**TOTP 生成**（存了 Secret 却发不了码，等于半个 2FA 管理）、**HIBP 泄露检查**（安全中心缺"已泄露"这个最硬的维度）、**第三方导入**（迁移门槛）。P0 三项 + P1 四项落地后，日常体验即可对齐 1Password/Bitwarden 的主路径。

## 参考来源

- [Wired – Best Password Managers (2026)](https://www.wired.com)
- [NYTimes Wirecutter – The 2 Best Password Managers of 2026](https://www.nytimes.com)
- [Security.org – Best Password Managers of 2026](https://www.security.org)
- [Bitwarden – Web Vault 文档](https://bitwarden.com)
- [Bitwarden Community – 扩展 UI 改版讨论（收藏/文件夹→过滤器）](https://community.bitwarden.com)
- [KeePassXC – User Guide（TOTP 章节与安全注意）](https://keepassxc.org)
- [Proton Pass](https://proton.me)
- [Passbolt vs KeePass](https://www.passbolt.com)
- [1Password – Watchtower 使用指南](https://support.1password.com)
- [1Password – Watchtower 与 HIBP](https://www.smile-comfort.com)
- [1Password – Passphrase 词表分析（18,328 词）](https://sts10.github.io)
- [1Password – 条目类别与 CLI 模板](https://1password.dev)
- [Privacy Guides – TOTP 存密码库的取舍讨论](https://discuss.privacyguides.net)
- [passwordmanager.com – 2FA 密码管理器评测](https://www.passwordmanager.com)
