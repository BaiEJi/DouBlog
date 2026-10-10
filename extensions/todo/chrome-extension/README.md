# MyTodo 四象限 - Chrome 扩展

为本地运行的 MyTodo 四象限待办系统提供的浏览器快捷面板（Manifest V3，纯原生 HTML/CSS/JS，无构建步骤、无第三方依赖）。

## 功能一览

- **网页悬浮机器人**（content script，所有网页生效）：
  - 任意网页右下角出现 🤖 圆形悬浮按钮（Shadow DOM 隔离，不受页面样式影响）
  - **点击机器人** → 在当前页面内弹出四象限待办面板（iframe 加载 popup.html，即上方 popup 的完整功能）
  - 机器人可拖拽换位（位置自动记忆）；面板支持 ✕ 与 Esc 关闭
  - 面板尺寸自适应（默认上限 800×1280，视口不足自动收缩，窗口缩放实时跟随）
  - 面板左上角有缩放手柄：拖动调整大小（**宽高比锁定**，不会拉变形），双击手柄恢复默认
  - 在 options 设置页可整体关闭（「网页悬浮机器人」开关，保存后刷新网页生效）
- **popup 面板**（点击扩展图标，380×560）：
  - 顶部：今天日期（M月D日 周X）+ 昨日小结 + 连续活跃 streak 徽标
  - 2×2 四象限网格，排列顺序 `[Q2, Q1, Q4, Q3]`（Q2 左上、Q1 右上最重要、Q4 左下、Q3 右下）
  - 每象限：3px 彩色顶条 + 象限名 + 待办数徽章（超软限制变红）+ 内部滚动任务列表
  - 任务行：圆形勾选框（点击完成/重开）+ 标题（完成后划线半透明）+ 类别色点/名称 + 迁移标记（⟲ 原始日期·拖N天）
  - 底部快捷添加栏：输入框 + Q1-Q4 四个色块按钮（默认 Q2）+ 回车或 ➕ 提交
  - 待迁移入口：有待迁移任务时顶部显示橙色徽标，点击进入待迁移视图（单个「迁到今天」/「一键全部迁移」，一键迁移会跳过 `intervention_required` 的任务）
  - 最底部「打开完整版」链接 → `{服务器地址}/`
- **options 设置页**：服务器地址 + 访问 token（默认预填 lizy 的永久 token）+ 悬浮机器人开关，popup 与 background 均从这里读取；附「测试连接」按钮
- **background service worker**：`chrome.alarms` 每 30 分钟查询 `/migrations/pending`，将数量写入扩展图标 badge（橙色），出错静默
- **深色模式**：跟随系统 `prefers-color-scheme`，CSS 变量双主题

## 如何加载扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录 `chrome-extension/`（含 manifest.json 的那层）
4. 工具栏出现「MyTodo 四象限」图标；建议点击图钉固定到工具栏
5. 确保后端正在运行（默认 `http://127.0.0.1:8070`），点击图标即可使用

## 如何修改服务器地址 / Token

- 扩展管理页 → MyTodo 四象限 → 「扩展程序选项」；或 popup 内右键 → 选项
- **服务器地址**：不含 `/api/v1` 的根地址，默认 `http://127.0.0.1:8070`
- **访问令牌（Token）**：以 `Authorization: Bearer <token>` 发送；默认预填 lizy 的永久 token（永不过期）
- 保存后立即生效；可点「测试连接」验证

注意：若把服务器改到其它域名/端口，需同时在 `manifest.json` 的 `host_permissions` 中追加对应 `http(s)://<host>/*` 并重新加载扩展（后端本身已开 CORS `allow_origins *`，通常不追加也能通）。

## 文件结构

```
chrome-extension/
├── manifest.json        # MV3 清单：permissions=[storage,alarms]，popup/options/icons
├── background.js        # service worker：30 分钟定时查待迁移数，写橙色 badge（importScripts 共用层）
├── popup.html           # 弹窗结构（主视图 + 待迁移视图）
├── popup.css            # 弹窗布局样式
├── popup.js             # 弹窗逻辑（不直接调用 chrome.*，可脱离扩展运行）
├── options.html         # 设置页
├── options.css          # 设置页样式
├── options.js           # 设置页逻辑（读/存配置、测试连接）
├── theme.css            # 共用 CSS 变量双主题（浅色/深色，跟随系统）
├── js/
│   ├── config.js        # 常量：配置键名、默认地址/token、四象限语义配色、排列顺序
│   ├── storage.js       # 存储包装层：有 chrome.storage 用之，否则降级 localStorage
│   └── api.js           # API 客户端：/today、/tasks、complete/reopen、/migrations/*、/categories
├── icons/
│   ├── icon16.png       # PIL 生成：圆角方块 + 四象限四色分区
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 可测试性说明

所有持久化读写都走 `js/storage.js` 包装层：扩展环境用 `chrome.storage.local`，作为普通网页打开时自动降级 `localStorage`。`popup.js` / `options.js` 不在顶层直接调用任何 `chrome.*` API，因此可以直接双击（或用任意静态服务器）打开 `popup.html` 调试——后端已开 CORS，`fetch` 可直接调用。

## 后端接口约定（本扩展所用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/today` | 今日聚合：quadrants[].tasks、pending_migrations、streak、yesterday |
| POST | `/api/v1/tasks` | `{title, is_important, is_urgent, task_date:"today"}` → 201 Task |
| POST | `/api/v1/tasks/{id}/complete` | Task.status → done |
| POST | `/api/v1/tasks/{id}/reopen` | Task.status → pending |
| GET | `/api/v1/migrations/pending` | 待迁移数组（含 intervention_required） |
| POST | `/api/v1/migrations/bulk` | `{task_ids:[...], to_date:"today"}` → `{migrated:n}` |
| GET | `/api/v1/categories` | 分类列表（含颜色） |

认证：请求头 `Authorization: Bearer <token>`（后端亦支持 `?token=` URL 参数）。
