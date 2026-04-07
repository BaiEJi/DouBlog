# DouBlog API 协议文档

> **版本**: v1.0  
> **更新时间**: 2026-04-06  
> **基础路径**: `/api`  
> **认证方式**: HTTP Basic Auth

---

## 目录

- [1. 通用规范](#1-通用规范)
- [2. 认证API](#2-认证api)
- [3. 文章API](#3-文章api)
- [4. 图片API](#4-图片api)
- [5. 错误码定义](#5-错误码定义)
- [6. 数据模型](#6-数据模型)

---

## 1. 通用规范

### 1.1 基础信息

- **协议**: HTTP/HTTPS
- **数据格式**: JSON
- **字符编码**: UTF-8
- **时区**: Asia/Shanghai (UTC+8)
- **基础URL**: `http://localhost:60000/api` (开发环境)

### 1.2 认证方式

使用 **HTTP Basic Authentication**。

所有需要认证的接口，请求头必须包含：

```
Authorization: Basic {base64(username:password)}
```

**示例**：
```bash
# 用户名: admin, 密码: lizy111A
# Base64编码: YWRtaW46bGl6eTExMUE=
curl -H "Authorization: Basic YWRtaW46bGl6eTExMUE=" http://localhost:60000/api/posts
```

### 1.3 通用响应格式

所有API响应均采用统一的JSON格式：

#### 成功响应

```json
{
  "success": true,
  "code": 200,
  "message": "操作成功",
  "data": {
    // 具体数据
  }
}
```

#### 错误响应

```json
{
  "success": false,
  "code": 400,
  "message": "错误描述",
  "data": null
}
```

### 1.4 分页参数

列表查询支持分页：

**请求参数**：
```
?page=1&page_size=20
```

**响应格式**：
```json
{
  "success": true,
  "code": 200,
  "message": "查询成功",
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "page_size": 20,
    "total_pages": 5
  }
}
```

---

## 2. 认证API

### 2.1 登录验证

验证用户名密码是否正确。

**请求**：
```
POST /api/auth/login
```

**请求头**：
```
Authorization: Basic {base64(username:password)}
```

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "登录成功",
  "data": {
    "username": "admin"
  }
}
```

**错误响应** (401):
```json
{
  "success": false,
  "code": 401,
  "message": "用户名或密码错误",
  "data": null
}
```

---

### 2.2 检查认证状态

检查当前请求是否已认证。

**请求**：
```
GET /api/auth/check
```

**请求头**：
```
Authorization: Basic {base64(username:password)}
```

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "已认证",
  "data": {
    "authenticated": true,
    "username": "admin"
  }
}
```

**错误响应** (401):
```json
{
  "success": false,
  "code": 401,
  "message": "未认证",
  "data": null
}
```

---

## 3. 文章API

### 3.1 获取文章列表

获取文章列表，支持分页和筛选。

**请求**：
```
GET /api/posts
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| page | int | 否 | 页码，默认1 |
| page_size | int | 否 | 每页数量，默认20，最大100 |
| parent_id | int | 否 | 父文章ID，筛选某文章的直接子文章 |
| status | string | 否 | 状态筛选：published/archived |
| keyword | string | 否 | 关键词搜索（标题、摘要） |

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "查询成功",
  "data": {
    "items": [
      {
        "id": 1,
        "title": "Java基础",
        "slug": "/java",
        "summary": "Java入门教程",
        "parent_id": null,
        "level": 0,
        "order": 0,
        "author": "admin",
        "status": "published",
        "is_top": false,
        "view_count": 100,
        "created_at": "2026-04-06T10:00:00",
        "updated_at": "2026-04-06T10:00:00",
        "children_count": 2
      }
    ],
    "total": 10,
    "page": 1,
    "page_size": 20,
    "total_pages": 1
  }
}
```

---

### 3.2 获取文章详情

根据slug获取单篇文章的完整信息。

**请求**：
```
GET /api/posts/:slug
```

**路径参数**：
- `slug`: 文章的URL别名（如 `java`, `java/java8`）

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "查询成功",
  "data": {
    "id": 1,
    "title": "Java基础",
    "slug": "/java",
    "content": "# Java基础\n\n这是Java入门教程...",
    "summary": "Java入门教程",
    "parent_id": null,
    "level": 0,
    "order": 0,
    "author": "admin",
    "status": "published",
    "is_top": false,
    "view_count": 100,
    "tags": null,
    "meta_data": null,
    "created_at": "2026-04-06T10:00:00",
    "updated_at": "2026-04-06T10:00:00",
    "parent": null,
    "children": [
      {
        "id": 2,
        "title": "Java8",
        "slug": "/java/java8",
        "level": 1
      },
      {
        "id": 3,
        "title": "Java17",
        "slug": "/java/java17",
        "level": 1
      }
    ]
  }
}
```

**错误响应** (404):
```json
{
  "success": false,
  "code": 404,
  "message": "文章不存在",
  "data": null
}
```

---

### 3.3 获取文章树结构

获取完整的文章树形结构，用于左侧导航。

**请求**：
```
GET /api/posts/tree
```

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "查询成功",
  "data": [
    {
      "id": 1,
      "title": "Java",
      "slug": "/java",
      "level": 0,
      "order": 0,
      "children": [
        {
          "id": 2,
          "title": "Java8",
          "slug": "/java/java8",
          "level": 1,
          "order": 0,
          "children": []
        },
        {
          "id": 3,
          "title": "Java17",
          "slug": "/java/java17",
          "level": 1,
          "order": 1,
          "children": [
            {
              "id": 4,
              "title": "容器",
              "slug": "/java/java17/container",
              "level": 2,
              "order": 0,
              "children": [
                {
                  "id": 5,
                  "title": "Map",
                  "slug": "/java/java17/container/map",
                  "level": 3,
                  "order": 0,
                  "children": []
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

### 3.4 创建文章

创建新文章。

**请求**：
```
POST /api/posts
```

**请求体**：
```json
{
  "title": "Java基础",
  "slug": "java",
  "content": "# Java基础\n\n这是Java入门教程...",
  "summary": "Java入门教程",
  "parent_id": null,
  "order": 0,
  "status": "published",
  "is_top": false,
  "tags": ["Java", "编程"]
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是 | 文章标题，最长200字符 |
| slug | string | 是 | URL别名，唯一，最长200字符 |
| content | string | 是 | Markdown内容 |
| summary | string | 否 | 摘要 |
| parent_id | int | 否 | 父文章ID，null表示根文章 |
| order | int | 否 | 同级排序，默认0 |
| status | string | 否 | 状态：published(默认)/archived |
| is_top | boolean | 否 | 是否置顶，默认false |
| tags | array | 否 | 标签数组 |

**成功响应** (201):
```json
{
  "success": true,
  "code": 201,
  "message": "创建成功",
  "data": {
    "id": 1,
    "title": "Java基础",
    "slug": "/java",
    "level": 0,
    "created_at": "2026-04-06T10:00:00"
  }
}
```

**错误响应** (400):
```json
{
  "success": false,
  "code": 400,
  "message": "标题不能为空",
  "data": null
}
```

**错误响应** (409):
```json
{
  "success": false,
  "code": 409,
  "message": "slug已存在",
  "data": null
}
```

---

### 3.5 更新文章

更新指定文章的内容。

**请求**：
```
PUT /api/posts/:slug
```

**路径参数**：
- `slug`: 文章的URL别名

**请求体**：
```json
{
  "title": "Java基础（更新版）",
  "content": "# Java基础\n\n这是更新后的内容...",
  "summary": "Java入门教程（更新）",
  "status": "published",
  "is_top": true,
  "order": 1,
  "tags": ["Java", "编程", "基础"]
}
```

**注意**：
- `slug` 不能修改
- `parent_id` 不能修改（如需移动文章，需删除重建）
- 未传递的字段保持原值不变

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "更新成功",
  "data": {
    "id": 1,
    "title": "Java基础（更新版）",
    "slug": "/java",
    "updated_at": "2026-04-06T11:00:00"
  }
}
```

---

### 3.6 删除文章

删除指定文章。

**请求**：
```
DELETE /api/posts/:slug
```

**路径参数**：
- `slug`: 文章的URL别名

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "删除成功",
  "data": null
}
```

**注意**：
- 删除父文章时，子文章的 `parent_id` 会被设置为 `null`（变为根文章）
- 不会级联删除子文章

---

## 4. 图片API

### 4.1 上传图片

上传图片到服务器。

**请求**：
```
POST /api/images/upload
Content-Type: multipart/form-data
```

**请求体**：
```
FormData:
  - file: 图片文件
  - post_slug: 文章slug（可选，用于组织目录）
```

**支持格式**：
- image/jpeg
- image/png
- image/gif
- image/webp

**文件大小限制**：最大 10MB

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "上传成功",
  "data": {
    "filename": "screenshot_20260406100000.png",
    "filepath": "/images/java/screenshot_20260406100000.png",
    "url": "http://localhost:60000/api/images/java/screenshot_20260406100000.png",
    "filesize": 102400
  }
}
```

**错误响应** (400):
```json
{
  "success": false,
  "code": 400,
  "message": "不支持的文件格式",
  "data": null
}
```

---

### 4.2 获取图片

获取上传的图片文件。

**请求**：
```
GET /api/images/:filepath
```

**路径参数**：
- `filepath`: 图片路径（如 `java/screenshot_20260406100000.png`）

**响应**：
- 成功：返回图片文件流 (Content-Type: image/*)
- 失败：404 Not Found

**注意**：
- 此接口不需要认证
- 支持浏览器缓存

---

### 4.3 删除图片

删除指定的图片文件。

**请求**：
```
DELETE /api/images/:filepath
```

**路径参数**：
- `filepath`: 图片路径

**成功响应** (200):
```json
{
  "success": true,
  "code": 200,
  "message": "删除成功",
  "data": null
}
```

**错误响应** (404):
```json
{
  "success": false,
  "code": 404,
  "message": "图片不存在",
  "data": null
}
```

---

## 5. 错误码定义

### 5.1 HTTP状态码

| 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证或认证失败 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如slug重复） |
| 413 | 请求体过大 |
| 422 | 参数验证失败 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

### 5.2 业务错误码

业务错误码在响应体的 `code` 字段中返回，与HTTP状态码一致。

常见错误消息：
- `标题不能为空`
- `slug已存在`
- `文章不存在`
- `用户名或密码错误`
- `不支持的文件格式`
- `文件大小超出限制`

---

## 6. 数据模型

### 6.1 Post（文章模型）

```typescript
interface Post {
  id: number;                    // 主键ID
  title: string;                 // 文章标题
  slug: string;                  // URL别名（唯一，格式：/parent/child）
  content: string;               // Markdown内容
  summary?: string;              // 摘要
  
  parent_id?: number;            // 父文章ID（null表示根文章）
  level: number;                 // 层级深度（0=根文章）
  order: number;                 // 同级排序
  
  author: string;                // 作者
  status: 'published' | 'archived';  // 状态
  is_top: boolean;               // 是否置顶
  
  view_count: number;            // 访问次数
  tags?: string[];               // 标签数组
  meta_data?: object;            // 扩展元数据
  
  created_at: string;            // 创建时间（ISO 8601格式）
  updated_at: string;            // 更新时间（ISO 8601格式）
}
```

### 6.2 Image（图片模型）

```typescript
interface Image {
  id: number;                    // 主键ID
  post_id?: number;              // 关联文章ID
  filename: string;              // 文件名
  filepath: string;              // 存储路径
  filesize: number;              // 文件大小（字节）
  created_at: string;            // 创建时间
}
```

### 6.3 响应模型

```typescript
interface ApiResponse<T> {
  success: boolean;              // 是否成功
  code: number;                  // 状态码
  message: string;               // 消息
  data: T | null;                // 数据
}

interface PaginatedResponse<T> {
  items: T[];                    // 数据列表
  total: number;                 // 总数
  page: number;                  // 当前页
  page_size: number;             // 每页数量
  total_pages: number;           // 总页数
}
```

---

## 7. 开发注意事项

### 7.1 API调用示例（前端）

```typescript
// 使用axios调用API
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:60000/api',
  timeout: 10000,
});

// 请求拦截器：添加认证头
api.interceptors.request.use((config) => {
  const auth = localStorage.getItem('auth');
  if (auth) {
    config.headers['Authorization'] = `Basic ${auth}`;
  }
  return config;
});

// 响应拦截器：处理错误
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // 未认证，跳转到登录页
      localStorage.removeItem('auth');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// 使用示例
const getPosts = () => api.get('/posts');
const getPost = (slug: string) => api.get(`/posts/${slug}`);
const createPost = (data: any) => api.post('/posts', data);
const updatePost = (slug: string, data: any) => api.put(`/posts/${slug}`, data);
const deletePost = (slug: string) => api.delete(`/posts/${slug}`);
```

### 7.2 CORS配置

后端需要配置CORS：

```python
from flask_cors import CORS

CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:5173"],  # Vite开发服务器
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})
```

### 7.3 测试账号

- **用户名**: `admin`
- **密码**: `lizy111A`

---

**文档结束**