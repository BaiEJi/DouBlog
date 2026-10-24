# 思维导图（mindmap）

> 2026-10-20。独立顶级模块，与 todo/vault 平级；页面 `/mindmap`、`/mindmap/:id`，API 前缀 `/api/mindmap`。选型依据见 [核心选型与适配边界](../mindmap-selection.md)，接口总索引见 [api.md 第 25 章](../../api.md#25-思维导图-apimindmap)。

## 1. 模块边界

后端 `backend/app/mindmap/` 的 `models.py`、`validation.py`、`services.py`、`routes.py` 分别负责存储、数据边界、事务与树操作、HTTP 适配。`__init__.py` 只导出 router；没有新后台线程、缓存服务或独立数据库。模型随 `Base.metadata.create_all` 建表，注册在 `main.MODULES`、`MODULES_WITH_DB`、日志路径映射中。

请求复用 `Depends(require_basic)`（Cookie 优先、Basic 兼容）、`run_db` 的 SDK 共享池、`api_response` 信封及 `mod_logger('mindmap')`。深度 128 的合法原生树超过 orjson 容器深度时，本模块以标准库严格 JSON 输出完全相同的信封。单用户账号改名后仍能访问原导图；`created_by` 是审计字段，不是额外的租户权限系统。所有读取，包括只读页面，均要求现有登录。

前端的核心、业务界面与 API 分离：`adapter.js` 封装 SimpleMindMap，`data.js` 验证产品 JSON，`saveController.js` 管理自动保存和恢复，`api.js` 统一发请求。基础文本格式由节点样式实现，不接收 HTML 富文本。只读是当前已登录用户的编辑模式，不提供匿名公开链接或新的只读账号权限。

## 2. 数据模型与保留策略

| 表 | 内容 |
|---|---|
| `mindmap_maps` | 名称、workspace/post 引用、完整 `document` JSON、schema_version、revision、node_count、创建者/更新者与时间、deleted 标记 |
| `mindmap_versions` | 每个成功写入的完整快照；`(map_id, revision)` 唯一；action、actor、ip_address、created_at 共同形成审计记录 |
| `mindmap_mutations` | 全局唯一 mutation_id、请求指纹、结果元数据/状态码及结果版本引用；重试时读取原快照还原响应，避免额外再存一份大文档 |

节点不拆独立表；数组顺序就是同级顺序。列表使用 `defer(document)`，版本列表用 SQLite/PostgreSQL JSON 路径提取摘要字段，两者都不加载完整正文。

`revision` 从 1 开始。名称、关联、文档、节点批次、导入覆盖、恢复、删除和文章删除导致的解除关联都会产生新版本；提交相同内容也会形成一次成功写入。恢复历史生成新 revision，不回退当前计数。创建/导入新图/复制返回新资源 ID，复制保留节点 UID（UID 的唯一性范围为每张图）。

删除采用 tombstone：普通列表、详情、导出与历史 API 均不可再访问该图；版本、审计与幂等回执保留，已成功删除请求的同标识重试仍返回原结果。本版没有回收站、硬删除或自动清理 API。快照和回执长期保留，存储量随保存次数增长；应纳入共用数据库备份与容量管理，不能把删除按钮理解为物理擦除。

活动导图必须归属有效知识库，可选关联该库内的非虚拟文章（禁止 post id=0）。库内有活动导图时删除知识库返回 400；已删除导图在库删除时清空 workspace 引用。删除文章或递归删除其子孙，先解除相关活动导图的 post 引用、递增 revision 并记 `post_unlinked` 快照，导图正文保留；删除 tombstone 的文章引用只清空外键。ID/slug 两种文章删除入口均通过共享 `request_username` 透传实际认证账号（Cookie优先），解除关联的 actor/updated_by 不固定为初始 admin。

SQLite 既有连接未全局启用 foreign_keys，因此创建/改变/恢复关联前使用 `BEGIN IMMEDIATE` 取得写事务，知识库与文章删除也进入该事务围栏；普通画布内容保存仍使用原有写入方式。PostgreSQL 使用声明的外键，资源删除前对相应行 `FOR UPDATE`，等待并发外键插入后再查询导图。解除关联、文章/知识库删除和审计都在同一事务内。

## 3. 完整 JSON 格式

JSON envelope 的 `format` 固定为 `doublog.mindmap`，`schema_version` 为格式版本，`revision` 为该服务端资源的并发版本，两者含义不同。必需字段为 format/schema_version/id/name/workspace_id/post_id/revision/document。导入不会依据嵌入的 id 隐式覆盖同 ID 资源。

以下是隔离 QA 实例实际 `GET /api/mindmap/maps/14/export` 响应的 **data 原文**（采样于 2026-10-20 北京时间；样例 ID/名称不是服务端默认值）：

```json
{
  "format": "doublog.mindmap",
  "schema_version": 1,
  "id": 14,
  "name": "接口契约示例",
  "workspace_id": 1,
  "post_id": null,
  "revision": 2,
  "document": {
    "root": {
      "data": {"uid": "sample-root", "text": "项目计划", "expand": true},
      "children": [
        {
          "data": {"uid": "sample-first", "text": "调研", "expand": true,
                   "note": "先核对现有架构", "tag": ["准备"]},
          "children": []
        },
        {
          "data": {"uid": "sample-second", "text": "实现", "expand": true},
          "children": []
        }
      ]
    },
    "layout": "logicalStructure",
    "theme": {"template": "default", "config": {}}
  }
}
```

原生 `document` 包含 root、layout、theme（template 字符串和 config 对象），可选 view 对象。节点必须有 `data.uid`、字符串 `data.text`，children 缺省为空数组，expand 若有则必须为布尔值；空文本合法。样式、备注、标签、链接、图片、关联线、概要、布局与主题配置保留原字段，不做只保留文本的有损归一化。概要 `generalization` 可为对象或数组，兼容旧数据省略概要 UID；提供 UID 时须为1–128字符的非空字符串，且不能与全图任何树节点或其他概要重复。概要不计入10000个正式树节点，另设全图最多1000个概要。`range` 缺省或为 `null` 表示单节点概要；非空时必须是两个整数（布尔值不算整数）的数组，满足 `0 <= start <= end < children.length`，区间下标指所属节点的直接子节点。

创建时省略 document，服务端生成 UUID 根、text=name、expand=true、layout=logicalStructure、theme={template:'default',config:{}}。每张图只有一个根；节点 API 禁止删除或移动根。

后端支持的 layout：`logicalStructure`、`logicalStructureLeft`、`mindMap`、`organizationStructure`、`catalogOrganization`、`timeline`、`timeline2`、`fishbone`、`verticalTimeline`。界面提供的布局选项见前端适配层，不假定上游所有新增布局已经开放。

## 4. API 契约

统一响应 `{success,code,message,data}`。成功新建为 201，其余读取/更新/删除为 200；AppError 的失败 data 含 `{error_code,details}`。下表路径均以 `/api/mindmap` 开头；所有写入必需 `mutation_id`（1–128 字符，建议 UUID）。对已有资源写入还必需当前 `revision`。

| 方法和路径 | 请求与响应 |
|---|---|
| `GET /maps` | page=1、page_size=20（≤100）、keyword/q 名称子串、workspace_id、post_id、sort=updated_desc/created_desc/name_asc；返回 items/total/page/page_size/total_pages，items 不带 document |
| `POST /maps` | `{name,workspace_id?,post_id?,document?,mutation_id}`；workspace 缺省取最小 ID 的知识库；返回完整地图 |
| `GET /maps/{id}` | 完整地图：id/name/workspace_id/post_id/revision/schema_version/node_count/created_by/updated_by/created_at/updated_at/document |
| `PATCH /maps/{id}` | `{name?,workspace_id?,post_id?,revision,mutation_id}`；至少一项元数据；解除文章关联传 post_id:null；切库时原 post 若不匹配，须同时清空或替换 |
| `PUT /maps/{id}/document` | `{document,revision,mutation_id}`；经完整校验保存整份文档，不接受缺省/部分 document |
| `DELETE /maps/{id}` | JSON body `{revision,mutation_id}`；返回 `{id,revision,deleted:true}` |
| `POST /maps/{id}/duplicate` | `{revision,mutation_id,name?}`；缺省原名截 195 字符后加「（副本）」；201 + 新图完整数据 |
| `POST /maps/{id}/nodes/batch` | `{operations,revision,mutation_id}`；全批一个新版本，返回完整地图；兼容 `/operations` 别名 |
| `POST /maps/{id}/nodes` | `{node,parent_id,index?,revision,mutation_id}`，单节点新增便捷入口 |
| `PATCH /maps/{id}/nodes/{uid}` | `{data,revision,mutation_id}`，合并节点 data，禁止更改 uid |
| `DELETE /maps/{id}/nodes/{uid}` | JSON body `{revision,mutation_id}`，删除子树 |
| `GET /maps/{id}/export` | data 为上述完整 JSON envelope，普通 JSON 响应，不是二进制附件 |
| `POST /import` | `{payload:envelope,mutation_id,workspace_id?,post_id?,target_id?,revision?}`；无 target_id 新建（201）；有 target_id 显式替换且需 revision（200） |
| `GET /maps/{id}/versions` | page/page_size；返回分页摘要；按 revision 倒序，含 revision/name/workspace_id/post_id/node_count/action/actor/ip_address/created_at |
| `GET /maps/{id}/versions/{revision}` | 对应完整快照及审计字段；不存在 404 |
| `POST /maps/{id}/restore` | `{version,revision,mutation_id}`；version 为要恢复的历史编号，revision 为当前编号；返回新 revision 的完整地图 |

导入新图时，显式 workspace_id/post_id 必须有效；未指定则优先使用仍存在的源 workspace，否则默认库。未指定 post_id 时只保留仍存在且匹配目标库的源文章，其余清空。导入覆盖默认保留目标图的 workspace/post，可显式修改，不跟随源文件越库。恢复优先恢复仍存在的历史库，历史库已被删除则保留当前库；历史文章已删除或不再匹配则保持无关联，不复活文章。

## 5. 原子节点操作

operations 为 1–500 项，按数组顺序执行：

- `add`：`{op:'add',parent_id:uid,node:{data,children},index?}`；node 可包含完整新子树，必须给每个正式节点新 UID。
- `update`：`{op:'update',uid,data:{...}}`；只浅合并该节点 data，不能更改 UID 或直接替换 children。
- `delete`：`{op:'delete',uid}`；整棵子树一起删除，并同步清理其他节点关联线的 targets、坐标、控制点、文字和样式引用。
- `move`：`{op:'move',uid,parent_id,index?}`；移动整个子树，禁止移入自身/后代；index 是从原父移除后目标 children 数组中的插入位置，省略则追加。

任何无效目标、重复 UID、非法 index、根删除、循环移动或最终格式错误都回滚整批；部分成功不落库。结构/ID 在步骤间校验，关联线目标在最终文档验证，允许同一批先建立双方再引用。布局/主题等全局配置用完整 document 保存；名称与归属用 PATCH。

以下批次来自 QA 真实请求，其结果是上例 id=14、revision=2、node_count=3：

```json
{
  "revision": 1,
  "mutation_id": "b2be5ca1-a286-4a13-889f-64c695c684d6",
  "operations": [
    {"op": "add", "parent_id": "sample-root", "index": 1,
     "node": {"data": {"uid": "sample-second", "text": "实现", "expand": true}, "children": []}},
    {"op": "update", "uid": "sample-first", "data": {"note": "先核对现有架构", "tag": ["准备"]}}
  ]
}
```

## 6. 并发、重试与前端一致性

完整文档、节点和元数据写入最终均经 `UPDATE ... WHERE id=:id AND revision=:old AND deleted=false`，检查 rowcount 后才创建快照。不是只在 Python 中比较版本。旧 revision 返回 409，details 包含 reason=revision_conflict、map_id、current_revision；不会静默覆盖新数据。

幂等回执与数据/历史在同一事务提交。相同 scope、相同 mutation_id、相同请求内容重试，返回第一次的原状态码和原结果，即使后续 revision 已增长；同 ID 不同请求返回 409、reason=mutation_reused。相同请求同时到达也只写一次。SQL 冲突/锁竞争可返回 409、reason=concurrent_write、retryable=true，应保留原 mutation_id 和内容重试。参数错误不写成功回执，可修正后重试。

前端本地立即更新画布；默认 900ms 防抖、单个逻辑保存队列，记录 dirty/saving/saved/offline/error/conflict。传输超时保留同一 revision、mutation_id 和请求快照，按 1.5/4/12 秒退避；新编辑等待当前快照确认后再以新 revision 保存。失败保留本地草稿，20 秒超时并不代表服务器没有落库。409 停止自动重试，由用户载入服务端版本、另存副本或处理本地草稿。localStorage 只是未保存修改的恢复副本，服务端数据库是正式持久化。

手动保存、导出与元数据/恢复操作前均先 commit 当前节点输入；手动保存及元数据/恢复操作再 flush 保存队列。服务端 export 代表已确认的 revision；浏览器 JSON 下载包含 commit 后的当前编辑快照，仍有未确认修改时明确提示服务器尚未保存，便于断网时备份。路由退出/异常恢复的草稿含基础 revision，不能静默覆盖服务端的新版本。属性栏尚未失焦的文字在 Ctrl+S、离开/刷新和切换选择前先提交；显式放弃草稿后，卸载不会把它重新写回。

## 7. 校验与安全边界

| 项目 | 规则 |
|---|---|
| 容量 | document 紧凑 UTF-8 JSON ≤10MiB；信封元数据独立≤16KiB（整个envelope≤10MiB+16KiB）；请求封装元数据独立≤16KiB（原始HTTP体≤10MiB+32KiB）；最多10000正式树节点、独立最多1000概要、128层（根算第1层），批次最多500操作 |
| 标识/名称 | 数值 ID/revision 为 1–2147483647；UID 为非空白且≤128 字符、每图唯一；名称去首尾空格后 1–200 字符 |
| 节点 | text 字符串≤100000 字符，可为空；children 数组；expand 布尔；note/link/image 等既定字段校验类型；tag 为字符串或 `{text,style?}`，icon 为字符串 ID 数组 |
| 结构 | 拒绝循环对象、重复 UID、缺少必需字段、不支持的 schema/layout、悬挂或自关联线目标、非有限数值、非法 JSON/UTF-8 |
| 文本 | 拒绝任何层级 richText=true，包括概要；使用基础文本样式；hyperlinkTitle/attachmentName 不允许 `<`/`>`，防上游 SVG title 拼接注入；备注按纯文本展示 |
| URL | hyperlink/attachmentUrl 只允许 http/https/mailto、站内 `/` 与 `#`；拒绝协议相对 URL、反斜杠、控制字符/空白；图片仅 http(s)/站内或 PNG/JPEG/GIF/WebP 标准 base64，拒绝解码后路径 `.svg/.svgz`，忽略 query |
| 插件字段 | theme 背景和 imgMap 映射值同样验证图片 URL，防绕过 image；所有层级拒绝 `__proto__`/`prototype`/`constructor`；合法纯 JSON 样式与业务字段保留 |

三个容量层次分开计算：document 保持完整10MiB容量，不为名称、版本或mutation_id扣减正文；信封与请求的附加字段各有16KiB预算，不允许把扩大后的HTTP额度用来保存更大的document。元数据预算按紧凑JSON的载荷差额计算，HTTP流式限制按实际收到的原始字节计算（含空白）。浏览器标准JSON下载使用紧凑编码，导入文件上限与envelope一致，以保证满容量图导出后仍可导入。超限错误分别指出document、信封元数据、请求封装元数据或HTTP请求体。没有隐藏节点、删减导出内容或关闭必要编辑功能来通过容量测试。Markdown/XMind/SVG/PNG 的转换边界见选型文档，不把有损格式当作备份。

## 8. 验证与当前边界

`backend/tests/mindmap/test_mindmap.py` 当前 **87 例**，使用共享 conftest 的真实临时 SQLite：鉴权覆盖全部入口，CRUD/筛选/分页，5000节点完整存取导出，128层深度，插件完整数据往返，非法导入和批次回滚，历史/恢复，原请求幂等回放、不同内容复用标识拒绝、两类同时写入、Cookie登录与重启持久化、文章/知识库生命周期以及创建导图与删除资源同时发生的竞争。安全测试含富HTML、危险协议/SVG、imgMap绕过、SVG title注入、原型键、非法类型和超限；CORS覆盖默认60101→60100的PATCH预检。容量回归覆盖恰好10MiB文档导出/导入、超1字节拒绝及独立信封/请求预算；概要回归覆盖区间与UID类型、树节点和概要之间的全图UID唯一性、1000个概要边界、无UID旧概要与null区间兼容、非法写入回滚；审计回归覆盖账号改名后ID/slug删除、Cookie优先于旧Basic头时仍记录真实操作者。

```powershell
cd backend
$env:PYTHONUTF8='1'
./venv/Scripts/python.exe -m pytest tests/mindmap -q -n 4
```

本机默认 Temp 无权限时，给 `--basetemp` 一个工作区内全新目录；当前环境 venv 启动器异常时使用 base Python，并在 PYTHONPATH 添加 venv site-packages 与 basekit/src。测试不连接生产数据库。PostgreSQL 行锁/FK分支按共享 ORM 设计，单元测试不冒充真实 PG 并发实测；运行时数据库切换仍遵循全站契约。

后端容量测试不证明浏览器 1000/5000 节点的帧率或布局延迟。完整交互、测试结果和复现命令见[交付验收记录](../mindmap-verification.md)。[正式性能报告](../mindmap-performance.md)记录1000/5000节点未达到全部操作100ms/60FPS：5000节点全展开初始化约17.8s，编辑、展开和拖拽放手仍有明显延迟。
