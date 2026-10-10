# 配置中心（confcenter）模块规范

> 2026-10-11。模块名 `confcenter`（配置中心）；表 `confcenter_entries`；前缀 `/api/confcenter`；前端 `/confcenter`（门户卡"配置中心"）。

## 1. 数据模型（app/confcenter/models.py）

一张扁平映射表，无中间实体：

```python
class ConfEntry(Base):
    __tablename__ = 'confcenter_entries'
    namespace: str  # CompositePK 左（≤100）
    key: str        # CompositePK 右（≤200）
    type: str       # 'str' | 'json'
    data: Text      # type=str → 原样字符串；type=json → 合法 JSON 文本（对象/数组/数字均可）
    updated_at: DateTime
    # 索引：namespace 单列（按 ns 浏览）
```

- **namespace + key 唯一定位一个 value**；value = {type, data} 包装
- 显式 type 的理由：裸存时 "123"/"[1,2]" 会被误判 JSON，读时无法还原"本来就是字符串"——显式声明消除歧义

## 2. 读写约定（硬性语义）

- 读：str → 客户端拿到字符串；json → 拿到结构化数据（响应里 data 为解析后的对象）
- 写（PUT 同一 ns+key 即**整体覆盖**，type 允许变更）；type=json 且 data 非法 JSON → 400 拒绝
- 删除：DELETE /{namespace}/{key}

## 3. API 契约（全部 require_basic，Doublog 信封）

```
GET    /api/confcenter/namespaces                 # distinct namespace + 每个 ns 的条目数
GET    /api/confcenter/entries?namespace=&q=&page=&page_size=   # 浏览（q 模糊匹配 key；省略 namespace=全部）
GET    /api/confcenter/{namespace}/{key}          # 读单条：data 按解析后返回（str→字符串，json→结构）
PUT    /api/confcenter/{namespace}/{key}          # upsert {type:'str'|'json', data}（201 新建 / 200 覆盖；json 非法 400）
DELETE /api/confcenter/{namespace}/{key}          # 200；不存在 404
# Redis 缓存管理（系统配置页用）
GET    /api/confcenter/cache/status               # {enabled, reachable, url_masked, hits, misses}（不可达时 enabled=false 不报错）
PUT    /api/confcenter/cache/config               # {enabled, host, port, db, password, ttl_seconds}（写入 data/redis_config.json）
POST   /api/confcenter/cache/test                 # 测试连通（PING），返回 {ok, message}
POST   /api/confcenter/cache/flush                # FLUSHDB 该 db（或按前缀 SCAN+DEL），管理用
```

key 命名约束：`[A-Za-z0-9_.:-]`（防注入）；namespace 同样。PUT body 校验：type 只能 str/json；type=json 时 data 必须可 json.loads。

## 4. Redis 缓存层（核心设计：可选、可降级）

- 配置存 `data/redis_config.json`：`{enabled, host, port, db, password, ttl_seconds}`（默认 enabled=false）
- **读路径**：GET 单条 → 配置启用且连接可用 → 先查 Redis（键 `confcenter:{namespace}:{key}`，值为整个 {type,data,updated_at} JSON）→ 命中直接返回并 hits+1 → 未命中介 DB、回填 Redis（misses+1）
- **写/删路径**：先落库 → **DEL 对应 Redis 键**（下次读重建；不做双写，避免一致性窗口）
- **降级**：redis 库缺失 / 配置未启用 / 连接失败 → 静默直连 DB（连接异常只 warn 一次/进程，不刷日志、不抛错）；hits/misses 计数仅在缓存生效时累计
- 客户端惰性连接：首次用到才建 Redis 客户端；配置变更后重建；TTL 默认 3600（键带 TTL，防止漏删的陈旧）
- 缓存状态挂 `app.state.confcenter_cache`（连接客户端 + 计数器 + 配置快照；测试多 app 不泄漏）

## 5. 前端（frontend/src/confcenter/）

- `ConfCenterPage.jsx`：左侧 namespace 列表（含计数）+ 右侧 KV 表格（key / 类型徽章 str|json / 值预览（json 折叠显示）/ 更新时间 / 操作）；新建/编辑 Modal（type 切换 str|json：str=多行文本框原样；json=JsonArea 失焦校验，非法标红禁止保存）；删除两步确认；搜索框（q）
- 顶部 Redis 状态条：`缓存 已启用/未启用`（调 cache/status；未启用显示"去配置"）+ 缓存配置 Modal（enabled/host/port/db/password/ttl + 测试连接 + 保存 + 清空缓存）
- `api.js` 走 apiFetch + unwrap；个性色 **cyan**；遵循 docs/ui-baseline.md
- 值预览：str 显示原文（截断 + title 全文）；json 显示 pretty（≤3 行折叠）

## 6. 测试（tests/confcenter/）

- CRUD：upsert 新建 201/覆盖 200/读回（str 保字符串形状、json 解析回对象）/**type 变更**（json→str 后读回字符串）/删除/404
- 校验：非法 type 400；json 非法 400（"[1,2" 拒绝）；key/namespace 非法字符 400
- **缓存**：monkeypatch 假 Redis 客户端（内存 dict）验证 命中/未命中回填/写后失效（DEL 被调用）/未启用直连 DB/连接抛错降级
- 浏览：namespaces 聚合、entries 过滤分页
- 鉴权：无凭据 401

## 7. 验收

`pytest tests/confcenter/ -q` 全绿；全量回归不退；真实 Redis 未运行时一切照常（降级路径）；前端 build 零报错；image 审查（含 Redis 配置 Modal）。
