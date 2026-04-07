<p align="center">
  <h1 align="center">DouBlog</h1>
  <p align="center">一款 VS Code 风格的个人博客 / 知识库系统，支持无限层级树形文章结构与 Markdown 编辑</p>
</p>

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [API 接口文档](#api-接口文档)
- [数据库设计](#数据库设计)
- [前端架构](#前端架构)
- [主题系统](#主题系统)
- [部署](#部署)
- [开发指南](#开发指南)
- [测试](#测试)
- [License](#license)

---

## 项目简介

DouBlog 是一个前后端分离的单用户个人博客系统，采用 **VS Code Dark** 风格的 UI 设计。核心特色是支持**无限深度的树形文章结构**，可以像文件目录一样组织文章，非常适合作为知识库、技术笔记或文档系统使用。

文章内容使用 Markdown 编写，内置功能完善的 Markdown 编辑器，支持实时预览、工具栏操作、语法高亮和图片上传。

---

## 功能特性

### 文章管理
- **树形结构**：文章支持无限层级的父子关系，在侧边栏以可折叠树形展示
- **Markdown 编辑**：集成 md-editor-v3 编辑器，支持实时预览、工具栏、语法高亮、快捷键
- **图片上传**：支持 PNG / JPG / JPEG / GIF / WebP 格式，最大 10MB，按文章分类存储
- **文章属性**：标题、别名（slug）、摘要、标签、置顶、排序、状态（发布/归档）
- **浏览计数**：自动统计文章阅读量
- **分页查询**：支持按页码、父级、状态、关键词筛选
- **非级联删除**：删除父文章时，子文章自动提升为顶级文章

### 用户与认证
- **HTTP Basic Auth** 认证机制，每次请求携带认证头
- **路由守卫**：未登录用户自动跳转到登录页
- **认证状态持久化**：凭据存储在 localStorage，刷新不丢失

### UI / UX
- **VS Code Dark 风格**：灵感来自 VS Code 的深色配色方案
- **明暗主题切换**：支持 Dark / Light 主题，自动检测系统偏好
- **响应式布局**：固定宽度侧边栏 + 自适应内容区域
- **自定义滚动条**：与整体风格统一的滚动条样式
- **Toast 通知**：使用 Sonner 组件显示操作反馈

### 开发体验
- **Mock API**：前端内置模拟数据，可脱离后端独立开发
- **API 代理**：Vite 开发服务器自动代理 API 请求到后端
- **Shell 管理脚本**：一键启停后端和前端服务

---

## 技术栈

| 层级 | 技术 | 版本 |
|---|---|---|
| **后端框架** | Flask | 3.0 |
| **数据库** | SQLite (SQLAlchemy ORM) | 2.0 |
| **认证** | Flask-HTTPAuth (Basic Auth) | 4.8 |
| **跨域** | Flask-CORS | 4.0 |
| **图像处理** | Pillow | 10.2 |
| **前端框架** | Vue 3 (Composition API) | 3.5 |
| **编程语言** | TypeScript | 6.0 |
| **构建工具** | Vite | 8 |
| **CSS 框架** | Tailwind CSS | 4.2 |
| **UI 组件库** | shadcn-vue (reka-ui) | — |
| **图标库** | lucide-vue-next | 1.0 |
| **Markdown 编辑器** | md-editor-v3 | 6.4 |
| **状态管理** | Pinia | 3.0 |
| **HTTP 客户端** | Axios | 1.14 |
| **Toast 通知** | vue-sonner | 2.0 |
| **工具库** | @vueuse/core | 14.2 |

---

## 项目结构

```
DouBlog/
├── .gitignore
├── README.md
├── api.md                    # API 协议文档
├── backend.md                # 后端设计文档
├── frontend.md               # 前端设计文档
├── backend-prompt.md         # 后端 AI 开发提示词
├── frontend-prompt.md        # 前端 AI 开发提示词
├── liantiao.md               # 前后端联调测试指南
│
├── backend/                  # 后端 (Flask)
│   ├── run.py                # 启动入口
│   ├── requirements.txt      # Python 依赖
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py           # Flask 应用工厂
│   │   ├── config.py         # 配置类
│   │   ├── database.py       # 数据库初始化
│   │   ├── models/
│   │   │   └── models.py     # 数据模型 (Post, Image)
│   │   ├── api/
│   │   │   ├── __init__.py   # 蓝图注册
│   │   │   ├── auth.py       # 认证接口
│   │   │   ├── posts.py      # 文章接口
│   │   │   └── images.py     # 图片接口
│   │   └── utils/
│   │       └── response.py   # 统一响应格式
│   └── tests/
│       ├── conftest.py       # 测试配置与 Fixtures
│       ├── test_auth.py      # 认证测试 (6 个用例)
│       └── test_posts.py     # 文章测试 (13 个用例)
│
├── frontend/                 # 前端 (Vue 3 + TypeScript)
│   ├── index.html            # HTML 入口
│   ├── package.json          # 依赖配置
│   ├── vite.config.ts        # Vite 配置 (代理/Mock)
│   ├── tailwind.config.js    # Tailwind 自定义主题
│   ├── tsconfig.json         # TypeScript 配置
│   ├── components.json       # shadcn-vue 配置
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── mock/                 # Mock 数据
│   │   ├── index.ts          # Mock 入口
│   │   ├── auth.ts           # 认证 Mock
│   │   ├── post.ts           # 文章 Mock (5 篇示例文章)
│   │   └── image.ts          # 图片 Mock
│   └── src/
│       ├── main.ts           # 应用入口
│       ├── App.vue           # 根组件
│       ├── style.css         # 全局样式
│       ├── router/
│       │   └── index.ts      # 路由配置 + 守卫
│       ├── stores/           # Pinia 状态管理
│       │   ├── auth.ts       #   认证状态
│       │   ├── post.ts       #   文章状态
│       │   └── theme.ts      #   主题状态
│       ├── services/         # API 服务层
│       │   ├── api.ts        #   Axios 实例 + 拦截器
│       │   ├── auth.ts       #   认证 API
│       │   ├── post.ts       #   文章 API
│       │   └── image.ts      #   图片 API
│       ├── types/            # TypeScript 类型定义
│       │   ├── api.ts        #   通用 API 响应类型
│       │   ├── post.ts       #   文章相关类型
│       │   └── user.ts       #   用户类型
│       ├── views/            # 页面组件
│       │   ├── Login.vue     #   登录页
│       │   ├── Home.vue      #   首页
│       │   ├── PostNew.vue   #   新建文章
│       │   ├── PostDetail.vue#   文章详情
│       │   ├── PostEdit.vue  #   编辑文章
│       │   └── NotFound.vue  #   404 页面
│       ├── components/       # 通用组件
│       │   ├── layout/       #   布局组件
│       │   │   ├── Layout.vue        # 主布局
│       │   │   ├── Header.vue        # 顶部栏
│       │   │   ├── Sidebar.vue       # 侧边栏
│       │   │   └── ThemeToggle.vue   # 主题切换
│       │   ├── post/         #   文章组件
│       │   │   ├── PostTree.vue      # 文章树容器
│       │   │   ├── PostTreeItem.vue  # 文章树节点（递归）
│       │   │   ├── PostCard.vue      # 文章卡片
│       │   │   └── MarkdownRenderer.vue # Markdown 渲染
│       │   ├── editor/       #   编辑器组件
│       │   │   └── MarkdownEditor.vue  # Markdown 编辑器
│       │   └── ui/           #   shadcn-vue UI 组件
│       │       ├── button/
│       │       ├── card/
│       │       ├── input/
│       │       ├── select/
│       │       ├── dialog/
│       │       ├── dropdown-menu/
│       │       └── sonner/
│       ├── lib/
│       │   └── utils.ts      # cn() 工具函数
│       ├── utils/
│       │   ├── format.ts     # 格式化工具
│       │   └── storage.ts    # localStorage 封装
│       └── assets/
│           ├── hero.png
│           └── styles/
│               ├── index.css     # 全局样式入口
│               └── variables.css # CSS 变量（VS Code 风格）
│
├── data/                     # 运行时数据（已 gitignore）
│   ├── blog.db               # SQLite 数据库
│   └── images/               # 上传图片存储
│
└── shell/                    # 管理脚本
    ├── backend/
    │   ├── start.sh          # 启动后端
    │   ├── stop.sh           # 停止后端
    │   ├── restart.sh        # 重启后端
    │   └── status.sh         # 查看后端状态
    └── frontend/
        ├── start.sh          # 启动前端
        ├── stop.sh           # 停止前端
        ├── restart.sh        # 重启前端
        └── status.sh         # 查看前端状态
```

---

## 快速开始

### 环境要求

- **Python** 3.10+
- **Node.js** 18+
- **npm** 9+

### 1. 克隆项目

```bash
git clone https://github.com/BaiEJi/DouBlog.git
cd DouBlog
```

### 2. 启动后端

```bash
cd backend

# 安装依赖（建议使用虚拟环境）
python -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows
pip install -r requirements.txt

# 启动服务（端口 60100）
python run.py
```

或使用管理脚本：

```bash
bash shell/backend/start.sh
```

### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（端口 60101）
npm run dev
```

或使用管理脚本：

```bash
bash shell/frontend/start.sh
```

### 4. 访问应用

打开浏览器访问 **http://localhost:60101**

默认登录凭据：
| 字段 | 值 |
|---|---|
| 用户名 | `admin` |
| 密码 | `lizy111A` |

> **提示**：前端 Mock API 默认开启，启动前端后即可使用模拟数据。如需连接真实后端，请确保后端服务已启动。

---

## 配置说明

### 后端配置 (`backend/app/config.py`)

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `host` | `0.0.0.0` | 监听地址 |
| `port` | `60100` | 监听端口 |
| `debug` | `True` | 调试模式（打印 SQL） |
| `secret_key` | `dev-secret-key-change-in-production` | Flask 密钥 |
| `cors_origins` | `*` | CORS 允许来源 |
| `auth_enabled` | `True` | 是否启用认证（测试时可关闭） |
| `auth_username` | `admin` | 登录用户名 |
| `auth_password` | `lizy111A` | 登录密码 |
| `data_dir` | `<项目根目录>/data` | 数据目录 |
| `images_dir` | `<data_dir>/images` | 图片存储目录 |
| `max_page_size` | `100` | 最大分页大小 |
| `default_page_size` | `20` | 默认分页大小 |

### 前端配置 (`frontend/vite.config.ts`)

| 配置项 | 值 | 说明 |
|---|---|---|
| `server.port` | `60101` | 开发服务器端口 |
| `server.proxy./api.target` | `http://localhost:60100` | API 代理目标 |

---

## API 接口文档

### 统一响应格式

所有接口返回统一的 JSON 格式：

```json
{
  "success": true,
  "code": 200,
  "message": "操作成功",
  "data": { ... }
}
```

### 认证接口

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| `POST` | `/api/auth/login` | Basic Auth | 验证凭据，返回用户名 |
| `GET` | `/api/auth/check` | Basic Auth | 检查认证是否有效 |

### 文章接口

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| `GET` | `/api/posts` | Basic Auth | 文章列表（分页） |
| `GET` | `/api/posts/tree` | Basic Auth | 文章树形结构 |
| `GET` | `/api/posts/<slug>` | Basic Auth | 文章详情（自增浏览量） |
| `POST` | `/api/posts` | Basic Auth | 创建文章 |
| `PUT` | `/api/posts/<slug>` | Basic Auth | 更新文章 |
| `DELETE` | `/api/posts/<slug>` | Basic Auth | 删除文章 |

#### 文章列表查询参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `page` | int | 页码（默认 1） |
| `page_size` | int | 每页数量（默认 20，最大 100） |
| `parent_id` | int | 按父级文章筛选 |
| `status` | string | 按状态筛选（published / archived） |
| `keyword` | string | 按关键词搜索 |

#### 排序规则

`is_top` DESC → `order` ASC → `created_at` DESC

#### 创建文章参数

```json
{
  "title": "文章标题",
  "slug": "article-slug",
  "content": "Markdown 内容",
  "summary": "文章摘要",
  "parent_id": null,
  "order": 0,
  "status": "published",
  "is_top": false,
  "tags": ["标签1", "标签2"]
}
```

#### Slug 路径规则

- 顶级文章：slug 直接作为路径（如 `getting-started`）
- 子级文章：自动拼接父级路径（如 `java/java8-features`）

### 图片接口

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| `POST` | `/api/images/upload` | Basic Auth | 上传图片 |
| `GET` | `/api/images/<filepath>` | Basic Auth | 获取图片 |
| `DELETE` | `/api/images/<filepath>` | Basic Auth | 删除图片 |

#### 图片上传规格

- **字段**：`file`（必填），`post_slug`（可选）
- **格式**：PNG, JPG, JPEG, GIF, WebP
- **大小**：最大 10MB
- **命名**：`{时间戳}_{8位UUID}.{扩展名}`
- **存储**：按文章 slug 分目录组织

### 健康检查

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| `GET` | `/` | 无 | 欢迎信息（含版本号） |
| `GET` | `/health` | 无 | 健康检查 |

---

## 数据库设计

### posts 表（文章）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | Integer | PK, 自增 | 主键 |
| `title` | String(200) | NOT NULL | 标题 |
| `slug` | String(200) | UNIQUE, NOT NULL, 索引 | URL 别名 |
| `content` | Text | NOT NULL | Markdown 内容 |
| `summary` | Text | 可空 | 摘要 |
| `parent_id` | Integer | FK → posts.id (SET NULL), 索引 | 父文章 ID |
| `level` | Integer | 默认 0 | 层级深度 |
| `order` | Integer | 默认 0 | 同级排序 |
| `author` | String(50) | 默认 'admin' | 作者 |
| `status` | String(20) | 默认 'published', 索引 | 状态 |
| `is_top` | Boolean | 默认 False | 是否置顶 |
| `view_count` | Integer | 默认 0 | 浏览量 |
| `tags` | Text | 可空 | 标签（JSON 数组） |
| `meta_data` | Text | 可空 | 元数据（JSON） |
| `created_at` | DateTime(tz) | server_default | 创建时间 |
| `updated_at` | DateTime(tz) | server_default, onupdate | 更新时间 |

**自引用关系**：`parent` → `Post`（remote_side=id），反向引用 `children`

### images 表（图片）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | Integer | PK, 自增 | 主键 |
| `post_id` | Integer | FK → posts.id (SET NULL), 可空 | 关联文章 |
| `filename` | String(255) | NOT NULL | 文件名 |
| `filepath` | String(500) | NOT NULL | 存储路径 |
| `filesize` | Integer | 可空 | 文件大小（字节） |
| `created_at` | DateTime(tz) | server_default | 上传时间 |

---

## 前端架构

### 路由

| 路径 | 组件 | 需认证 | 说明 |
|---|---|---|---|
| `/login` | Login.vue | 否 | 登录页 |
| `/` | Home.vue | 是 | 首页 |
| `/post/new` | PostNew.vue | 是 | 新建文章 |
| `/post/:slug` | PostDetail.vue | 是 | 文章详情 |
| `/post/:slug/edit` | PostEdit.vue | 是 | 编辑文章 |

**路由守卫**：`beforeEach` 检查 `authStore.isAuthenticated`，未认证跳转 `/login`，已认证访问 `/login` 自动跳转首页。

### 状态管理（Pinia）

| Store | 状态 | 说明 |
|---|---|---|
| `auth` | `username`, `auth` | Base64 编码凭据，持久化到 localStorage |
| `post` | `posts[]`, `currentPost`, `postTree[]`, `loading` | 文章数据，变更后自动刷新树 |
| `theme` | `isDark` | 主题状态，持久化到 localStorage，监听系统偏好 |

### API 层

- **Axios 实例**：baseURL `/api`，超时 10 秒
- **请求拦截器**：自动添加 `Authorization: Basic {auth}` 头
- **响应拦截器**：解包 `response.data`，401 时清除认证并跳转登录页

---

## 主题系统

采用 CSS 变量实现的 VS Code 风格双主题系统。

### CSS 变量

在 `frontend/src/assets/styles/variables.css` 中定义了完整的颜色体系：

| 变量类别 | 示例 | 用途 |
|---|---|---|
| 背景 | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` | 三级背景色 |
| 文字 | `--text-primary`, `--text-secondary`, `--text-muted` | 三级文字色 |
| 边框 | `--border` | 统一边框色 |
| 强调 | `--accent` | 交互元素高亮 |

### 主题切换

- 点击顶部栏的太阳/月亮图标切换
- 选择持久化到 `localStorage`
- 首次访问自动检测系统 `prefers-color-scheme`
- 通过切换 `<html>` 元素的 `dark` class 实现

---

## 部署

### 生产构建

```bash
cd frontend
npm run build    # 输出到 dist/ 目录
npm run preview  # 预览构建结果
```

### 使用管理脚本

```bash
# 启动服务
bash shell/backend/start.sh
bash shell/frontend/start.sh

# 查看状态（PID、CPU、内存、运行时间）
bash shell/backend/status.sh
bash shell/frontend/status.sh

# 重启服务
bash shell/backend/restart.sh
bash shell/frontend/restart.sh

# 停止服务
bash shell/backend/stop.sh
bash shell/frontend/stop.sh
```

---

## 开发指南

### 前端独立开发（Mock 模式）

前端项目内置了 Mock API（通过 `vite-plugin-mock`），无需启动后端即可开发：

```bash
cd frontend
npm install
npm run dev
```

Mock 数据包含 5 篇示例文章，形成如下树形结构：

```
├── 入门指南
│   ├── 快速开始
│   └── 安装配置
└── 进阶教程
    └── 最佳实践
```

### 添加新的 API 接口

**后端**：

1. 在 `backend/app/api/` 下创建或编辑蓝图文件
2. 在 `backend/app/api/__init__.py` 中注册蓝图
3. 在 `backend/tests/` 中添加对应测试

**前端**：

1. 在 `frontend/src/types/` 中定义 TypeScript 类型
2. 在 `frontend/src/services/` 中添加 API 调用
3. 在 `frontend/src/stores/` 中管理状态
4. 在 `frontend/src/views/` 中创建页面
5. 在 `frontend/src/router/index.ts` 中注册路由
6. （可选）在 `frontend/mock/` 中添加 Mock 数据

### 添加 shadcn-vue 组件

```bash
cd frontend
npx shadcn-vue@latest add <component-name>
```

---

## 测试

### 后端测试

```bash
cd backend
pytest -v
```

共 **19 个测试用例**：

| 测试文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `test_auth.py` | 6 | 登录成功/失败、凭据检查、未授权访问 |
| `test_posts.py` | 13 | 文章 CRUD、分页、树形结构、父子关系、重复 slug、未授权、404 |

### 前端测试

```bash
cd frontend
npm run test
```

---

## License

MIT
