# 密码服务（Password Service）设计文档

> ⚠️ **历史设计稿**（成稿于 Flask 时代，先于附件/告警等功能）。实现与现行行为的权威文档是 `docs/modules/pwsvc.md`；本文保留算法规范与威胁模型的参考价值，结构/路径/API 清单以模块文档为准。（2026-10-10 标注）


> DouBlog 密码库子模块：为多个项目提供**轮换密码**（默认每 60 秒更换）与**机器校验 API**。
> 定位：给测试环境/内部系统/演示账号等场景提供"密码始终在变、但随时可查可验"的统一服务。

---

## 1. 概念模型

```
项目 Project（如「商城测试环境」）
 ├── API Key（供其他服务调用校验接口，仅显示一次）
 ├── 用户类型 UserType（如 管理员 / 普通用户 / 访客）
 │     · 密码策略：长度 / 字符集（大小写/数字/符号/排除易混淆）
 │     · 轮换周期 rotation_seconds（默认 60s，可选 30/60/120/300/600）
 └── 用户 User（如 user001，属于某个类型）
       · 每个用户独立 seed（32 字节（256-bit）随机，加密存储）
       · 当前密码 = derive(seed, 时间窗口, 类型策略)——确定性推导，不存储密码本体
```

## 2. 核心机制：无状态时钟轮换（TOTP 思路）

**不存储"当前密码"，不依赖任何调度器**（本项目已明确无后台任务）：

```
window = floor(unix时间 / rotation_seconds)          # 墙钟对齐，如每分钟 :00 换
password = Derive(seed, window, policy)               # HMAC-SHA256 + 确定性拒绝采样
```

- **查看密码**：服务端即时计算 → UI 显示 + 倒计时 + 复制（剪贴板自动清理）
- **校验密码**：服务端对当前窗口各算一次，常数时间比较；
  未命中且进入窗口不足 **30 秒宽限**（`min(30, rotation)`，短周期时不超过周期本身）时
  再比对上一窗口——解决"59 秒复制的密码、61 秒提交"的边界问题
  （60s 轮换下实际有效期 60~90s；**每个用户密码链完全独立**，互不影响）
- **多副本/重启完全一致**：纯函数推导，无状态可失
- **改策略/重置 seed**：立即生效，所有旧密码全部失效

### Derive 算法规范（稳定，含黄金测试向量）

```python
def derive(seed: bytes, window: int, policy) -> str:
    # 1) 每类启用字符集保证至少 1 个字符（依次取各类首字符）
    # 2) 其余长度用 HMAC-SHA256(seed, window_be32 || counter_be32) 流
    #    经确定性拒绝采样映射到字符池（无 modulo 偏差）
    # 3) Fisher–Yates 洗牌（PRNG 种子取自首块 HMAC）打乱顺序
```

推导仅用 Python 标准库 `hmac`/`hashlib`；seed 落盘加密用 `cryptography` 包（AES-256-GCM，已加入 requirements.txt）。
测试锁定固定 seed+window → 固定密码 的黄金向量，防止日后误改算法导致所有密码漂移。

## 3. 数据库设计（服务端模块，跟随设置的数据库）

```
pwsvc_projects
  id, name(唯一), description,
  api_key_hash(SHA-256), api_key_prefix(8 字符, 用于识别),
  rate_limit(次/分钟, 默认120, 0=不限),
  created_at, updated_at

pwsvc_validate_logs
  id, project_id FK, username, valid, ip, created_at(naive UTC, 索引)
  -- 保留 30 天，写入时清理；永不含密码内容

pwsvc_user_types
  id, project_id FK, name,
  length(8-64), uppercase, lowercase, digits, symbols, exclude_ambiguous,
  rotation_seconds, created_at
  UNIQUE(project_id, name)

pwsvc_users
  id, project_id FK, type_id FK,
  username, display_name, status(enabled/disabled),
  seed_encrypted(AES-256-GCM, 密钥在 data/pwsvc.key，自动生成、gitignore),
  last_validated_at, last_viewed_at,
  created_at
  UNIQUE(project_id, username)
```

删除语义：删项目级联删类型与用户；删类型时若仍有关联用户则 409 拒绝。

## 4. API 设计

管理接口（沿用 Basic Auth）：

```
POST   /api/pwsvc/projects                  创建（响应含 api_key 明文，仅此一次）
GET    /api/pwsvc/projects                  列表（含类型数/用户数）
PUT    /api/pwsvc/projects/<id>             改名/描述
DELETE /api/pwsvc/projects/<id>             删除（级联）
POST   /api/pwsvc/projects/<id>/api-key     重置 API Key（旧 key 立即失效）

POST   /api/pwsvc/projects/<id>/types       创建类型
GET    /api/pwsvc/projects/<id>/types       类型列表（含用户数，UI 用）
PUT    /api/pwsvc/types/<id>                改策略（立即生效：当前窗口即按新策略重推导，旧密码立刻失效）
DELETE /api/pwsvc/types/<id>

POST   /api/pwsvc/projects/<id>/users       创建用户 {username, type_id}
PUT    /api/pwsvc/users/<id>                改 display_name / status / reset_seed
DELETE /api/pwsvc/users/<id>
GET    /api/pwsvc/projects/<id>/users       用户列表（不含密码）
GET    /api/pwsvc/users/<id>/current        当前密码 + expires_in（UI 用）
```

**校验接口（第三方服务调用，X-Api-Key 认证，不走 Basic Auth）**：

```
POST /api/pwsvc/validate
Headers: X-Api-Key: pws_xxxxxxxx....
Body:    { "username": "user001", "password": "..." }
Response:
  { "success": true, "data": { "valid": true,  "expires_in": 23 } }   // 剩余秒数
  { "success": true, "data": { "valid": false } }                     // 应用层结果，HTTP 200
```

校验流程：API Key 哈希定位项目 → **令牌桶限流检查**（超额 429，不落日志）→
查用户（禁用即 false）→ 计算当前+上一窗口期望值 → 常数时间比较 → 记录 last_validated_at。
**日志/审计永不含密码内容**。

### 限流（rate_limit，页面可配）

- 每项目 `rate_limit` 次/分钟（默认 120，0 = 不限，上限 10000），项目页 API 集成区可改，保存即生效
- 进程内令牌桶：容量 = 每分钟额度（允许短时突发到额度），按额度/60 每秒回填；多进程部署时每进程独立
- 超额返回 `429 请求过于频繁`；被限流的请求不写日志（防止攻击者刷爆日志表）

### 校验日志（pwsvc_validate_logs）

- 每次校验（成功/失败/用户不存在）各记一行：project_id / username / valid / ip / created_at（naive UTC），**永不含密码内容**
- 保留 30 天：写入时顺手 DELETE 该项目过期行（无后台任务）
- `GET /api/pwsvc/projects/<id>/logs?page=&per_page=`：倒序分页 + 统计（近 1h/24h 成败计数、失败 TOP5 用户名）
- UI（项目页「校验日志」区）：统计胶囊 + 疑似爆破警示（近 1 小时失败 ≥50 次标红）+ 时间线 + 加载更多

## 5. 安全模型与边界（如实声明）

- 本模块**不是**零知识：服务端必须能推导密码（否则无法提供校验 API）——这是功能定位决定的
  （与密码库本体的零知识加密是两套威胁模型，UI 中明确标注）
- 静态数据保护：seed AES-256-GCM 加密落盘；API Key 只存哈希；密码本体**从不落盘**
- 在线爆破无意义（≥90 位熵的随机密码）+ 常数时间比较；另设每项目进程内令牌桶限流
  （页面可配 0-10000 次/分钟，超额 429 且不落日志——现行实现，详见模块文档）
- API Key 泄露影响面：仅能"验密码"，不能读密码（读密码仅管理员 UI）
- 服务器被完全攻破 = 攻击者可推导该项目全部轮换密码（服务固有属性，文档声明）

## 6. UI 设计（密码库内新分区「密码服务」）

```
密码库侧栏
 └── 密码服务（分区，与 Trash 之间加分隔线）
      项目卡片列表（名称/描述/类型数/用户数）＋ 新建项目
      └── 项目页（三段）
          ① API 集成：端点地址 + curl 示例（一键复制）+ 重置 Key
          ② 用户类型：策略行（长度/字符集/周期），编辑弹层
          ③ 用户表：用户名 | 类型 | 当前密码(打码,Reveal+复制+圆环倒计时) | 状态 | 删除
```

- 新建项目后弹层显示 API Key（仅一次 + 确认已保存）
- 密码行复用 vault 的 SecretField 交互（默认隐藏、15s 自动隐藏、复制 30s 自动清理）
- 倒计时到 0 自动刷新本行密码
- 全中文文案、stone 暖色系，与现有视觉一致

## 7. 测试要点（pytest，自包含）

1. 黄金向量：固定 seed+window+policy → 固定密码（防算法漂移）
2. 校验：当前窗口通过 / 上一窗口通过（**仅进入窗口 30s 内宽限，且不超过轮换周期**）/
   宽限截止后拒绝 / 错误密码拒绝
3. API Key：正确通过、错误 401、重置后旧 Key 立即失效
4. 禁用用户校验 false；重置 seed 后旧密码全部失效
5. 策略变更：下一窗口按新策略；边界（长度上下限、空字符集拒绝）
6. CRUD/唯一性/级联删除/类型有关联用户时删除 409
7. 安全断言：数据库与 API 响应中不存在密码明文落盘字段
8. 校验日志：写入字段/倒序分页/统计与 fail_top/30 天清理/不含密码
9. 限流：额度内 200 超出 429/0=不限/参数校验/429 不落日志/改配置即生效

## 8. 实施清单

```
backend/app/api/pwsvc.py            蓝图（derive + CRUD + validate）
backend/app/models/models.py        + 三张表
backend/tests/test_pwsvc.py
frontend/src/vault/PwsvcView.jsx    项目/类型/用户/集成面板
frontend/src/VaultPage.jsx          侧栏入口
frontend/src/api.js                 封装
docs/pwsvc-design.md                本文档 → 完成后同步 api.md/frontend.md/backend.md
```
