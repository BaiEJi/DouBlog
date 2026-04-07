# DouBlog 前端详细设计文档

> **版本**: v1.0  
> **更新时间**: 2026-04-06  
> **技术栈**: Vue 3 + Vite + Tailwind CSS v4 + shadcn-vue

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 技术栈详情](#2-技术栈详情)
- [3. 目录结构](#3-目录结构)
- [4. 核心功能设计](#4-核心功能设计)
- [5. 路由设计](#5-路由设计)
- [6. 状态管理](#6-状态管理)
- [7. 组件设计](#7-组件设计)
- [8. 页面设计](#8-页面设计)
- [9. 样式设计](#9-样式设计)
- [10. API集成](#10-api集成)
- [11. 配置文件](#11-配置文件)

---

## 1. 项目概述

### 1.1 项目定位

DouBlog是一个现代化的个人博客系统，采用前后端分离架构，具有以下特点：
- 树形文章结构（无限层级）
- Markdown实时编辑
- VS Code Dark风格UI
- 简单密码认证
- 暗色/亮色模式切换

### 1.2 开发环境

- **Node.js**: v18+
- **包管理器**: npm 或 pnpm
- **开发服务器**: Vite (端口 5173)
- **后端API**: http://localhost:60000/api

---

## 2. 技术栈详情

### 2.1 核心框架

| 技术 | 版本 | 用途 |
|---|---|---|
| Vue 3 | 3.4+ | 前端框架 |
| TypeScript | 5.0+ | 类型安全 |
| Vite | 5.0+ | 构建工具 |

### 2.2 核心库

| 技术 | 版本 | 用途 |
|---|---|---|
| Vue Router | 4.x | 路由管理 |
| Pinia | 2.x | 状态管理 |
| axios | 1.x | HTTP请求 |
| md-editor-v3 | 6.4+ | Markdown编辑器 |

### 2.3 UI相关

| 技术 | 版本 | 用途 |
|---|---|---|
| Tailwind CSS | v4 | CSS框架 |
| shadcn-vue | 最新 | 组件库 |
| lucide-vue-next | 最新 | 图标库 |

### 2.4 开发工具

| 工具 | 用途 |
|---|---|
| ESLint | 代码检查 |
| Prettier | 代码格式化 |
| TypeScript | 类型检查 |

---

## 3. 目录结构

```
frontend/
├── public/                          # 静态资源
│   └── favicon.ico
│
├── src/
│   ├── main.ts                      # 应用入口
│   ├── App.vue                      # 根组件
│   │
│   ├── assets/                      # 静态资源
│   │   ├── images/
│   │   └── styles/
│   │       ├── index.css            # 全局样式
│   │       └── variables.css        # CSS变量
│   │
│   ├── components/                  # 组件
│   │   ├── ui/                      # shadcn-vue组件（自动生成）
│   │   │   ├── button/
│   │   │   ├── card/
│   │   │   ├── input/
│   │   │   └── ...
│   │   │
│   │   ├── layout/                  # 布局组件
│   │   │   ├── Layout.vue           # 主布局
│   │   │   ├── Sidebar.vue          # 侧边栏
│   │   │   ├── Header.vue           # 顶部栏
│   │   │   └── ThemeToggle.vue      # 主题切换按钮
│   │   │
│   │   ├── post/                    # 文章相关组件
│   │   │   ├── PostTree.vue         # 文章树组件
│   │   │   ├── PostTreeItem.vue     # 文章树节点
│   │   │   ├── PostCard.vue         # 文章卡片
│   │   │   └── MarkdownRenderer.vue # Markdown渲染器
│   │   │
│   │   └── editor/                  # 编辑器组件
│   │       └── MarkdownEditor.vue   # Markdown编辑器
│   │
│   ├── views/                       # 页面视图
│   │   ├── Login.vue                # 登录页
│   │   ├── Home.vue                 # 首页
│   │   ├── PostDetail.vue           # 文章详情页
│   │   ├── PostEdit.vue             # 编辑文章页
│   │   └── PostNew.vue              # 新建文章页
│   │
│   ├── router/                      # 路由配置
│   │   └── index.ts
│   │
│   ├── stores/                      # 状态管理
│   │   ├── index.ts                 # Store入口
│   │   ├── auth.ts                  # 认证状态
│   │   ├── post.ts                  # 文章状态
│   │   └── theme.ts                 # 主题状态
│   │
│   ├── services/                    # API服务
│   │   ├── api.ts                   # axios实例配置
│   │   ├── auth.ts                  # 认证API
│   │   ├── post.ts                  # 文章API
│   │   └── image.ts                 # 图片API
│   │
│   ├── types/                       # TypeScript类型
│   │   ├── api.ts                   # API响应类型
│   │   ├── post.ts                  # 文章类型
│   │   └── user.ts                  # 用户类型
│   │
│   ├── utils/                       # 工具函数
│   │   ├── request.ts               # 请求工具
│   │   ├── storage.ts               # 本地存储
│   │   └── format.ts                # 格式化工具
│   │
│   └── composables/                 # 组合式函数
│       ├── useAuth.ts               # 认证逻辑
│       └── usePost.ts               # 文章逻辑
│
├── index.html                       # HTML入口
├── vite.config.ts                   # Vite配置
├── tailwind.config.js               # Tailwind配置
├── tsconfig.json                    # TypeScript配置
├── package.json                     # 项目依赖
└── README.md                        # 项目说明
```

---

## 4. 核心功能设计

### 4.1 认证功能

**流程**：
1. 用户访问任意页面
2. 前端检查localStorage中的auth字段
3. 若无auth，跳转到/login
4. 用户输入用户名密码
5. 前端将`username:password`进行Base64编码
6. 调用`POST /api/auth/login`验证
7. 验证成功后，将Base64字符串存储到localStorage
8. 后续所有请求都在header中携带`Authorization: Basic {auth}`

**关键代码位置**：
- `src/stores/auth.ts` - 认证状态管理
- `src/services/auth.ts` - 认证API调用
- `src/router/index.ts` - 路由守卫
- `src/views/Login.vue` - 登录页面

### 4.2 文章树形结构

**展示方式**：
- 左侧固定侧边栏，宽度280px
- 树形结构，支持展开/折叠
- 点击节点，右侧显示文章内容
- 当前访问的文章高亮显示

**数据结构**：
```typescript
interface PostTreeNode {
  id: number;
  title: string;
  slug: string;
  level: number;
  order: number;
  children: PostTreeNode[];
}
```

**关键代码位置**：
- `src/components/post/PostTree.vue` - 树组件
- `src/components/post/PostTreeItem.vue` - 树节点
- `src/stores/post.ts` - 文章树状态

### 4.3 Markdown编辑器

**功能要求**：
- 实时预览
- 工具栏（粗体、斜体、标题、链接、图片、代码块）
- 语法高亮
- 图片上传（调用`POST /api/images/upload`）
- 暗色模式支持

**使用md-editor-v3**：
```vue
<template>
  <MdEditor 
    v-model="content" 
    :theme="theme"
    @onUploadImg="handleUploadImg"
  />
</template>

<script setup lang="ts">
import MdEditor from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

const content = ref('');
const theme = ref<'light' | 'dark'>('dark');

const handleUploadImg = async (files: File[]) => {
  // 调用图片上传API
};
</script>
```

### 4.4 主题切换

**实现方式**：
- 在`<html>`标签上添加`class="dark"`
- Tailwind自动应用dark变体
- 使用localStorage持久化用户选择

**关键代码位置**：
- `src/stores/theme.ts` - 主题状态
- `src/components/layout/ThemeToggle.vue` - 切换按钮

---

## 5. 路由设计

### 5.1 路由表

```typescript
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/new',
    name: 'PostNew',
    component: () => import('@/views/PostNew.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/:slug',
    name: 'PostDetail',
    component: () => import('@/views/PostDetail.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/:slug/edit',
    name: 'PostEdit',
    component: () => import('@/views/PostEdit.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// 路由守卫
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login');
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/');
  } else {
    next();
  }
});

export default router;
```

### 5.2 路由说明

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | Login.vue | 登录页 |
| `/` | Home.vue | 首页，显示文章树 |
| `/post/new` | PostNew.vue | 新建文章 |
| `/post/:slug` | PostDetail.vue | 文章详情（:slug为文章路径） |
| `/post/:slug/edit` | PostEdit.vue | 编辑文章 |

---

## 6. 状态管理

### 6.1 Auth Store

```typescript
// src/stores/auth.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const username = ref<string | null>(null);
  const auth = ref<string | null>(localStorage.getItem('auth'));

  const isAuthenticated = computed(() => !!auth.value);

  const login = (user: string, pass: string): boolean => {
    const encoded = btoa(`${user}:${pass}`);
    auth.value = encoded;
    username.value = user;
    localStorage.setItem('auth', encoded);
    return true;
  };

  const logout = () => {
    auth.value = null;
    username.value = null;
    localStorage.removeItem('auth');
  };

  const checkAuth = (): boolean => {
    return !!auth.value;
  };

  return {
    username,
    auth,
    isAuthenticated,
    login,
    logout,
    checkAuth
  };
});
```

### 6.2 Post Store

```typescript
// src/stores/post.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Post, PostTreeNode } from '@/types/post';
import * as postApi from '@/services/post';

export const usePostStore = defineStore('post', () => {
  const posts = ref<Post[]>([]);
  const currentPost = ref<Post | null>(null);
  const postTree = ref<PostTreeNode[]>([]);
  const loading = ref(false);

  const fetchPostTree = async () => {
    loading.value = true;
    try {
      const res = await postApi.getPostTree();
      postTree.value = res.data;
    } finally {
      loading.value = false;
    }
  };

  const fetchPost = async (slug: string) => {
    loading.value = true;
    try {
      const res = await postApi.getPost(slug);
      currentPost.value = res.data;
    } finally {
      loading.value = false;
    }
  };

  const createPost = async (data: Partial<Post>) => {
    const res = await postApi.createPost(data);
    await fetchPostTree();
    return res.data;
  };

  const updatePost = async (slug: string, data: Partial<Post>) => {
    const res = await postApi.updatePost(slug, data);
    await fetchPostTree();
    return res.data;
  };

  const deletePost = async (slug: string) => {
    await postApi.deletePost(slug);
    await fetchPostTree();
  };

  return {
    posts,
    currentPost,
    postTree,
    loading,
    fetchPostTree,
    fetchPost,
    createPost,
    updatePost,
    deletePost
  };
});
```

### 6.3 Theme Store

```typescript
// src/stores/theme.ts
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useThemeStore = defineStore('theme', () => {
  const isDark = ref(
    localStorage.getItem('theme') === 'dark' ||
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  );

  watch(isDark, (value) => {
    if (value) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, { immediate: true });

  const toggleTheme = () => {
    isDark.value = !isDark.value;
  };

  return {
    isDark,
    toggleTheme
  };
});
```

---

## 7. 组件设计

### 7.1 Layout组件

**文件**: `src/components/layout/Layout.vue`

**功能**：
- 主布局框架
- 左侧侧边栏 + 右侧内容区
- 顶部Header（主题切换、用户信息）

**模板结构**：
```vue
<template>
  <div class="flex h-screen bg-vscode-bg-primary">
    <!-- 左侧侧边栏 -->
    <Sidebar class="w-70 flex-shrink-0" />
    
    <!-- 右侧内容区 -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <Header />
      <main class="flex-1 overflow-auto p-6">
        <router-view />
      </main>
    </div>
  </div>
</template>
```

### 7.2 Sidebar组件

**文件**: `src/components/layout/Sidebar.vue`

**功能**：
- 展示文章树形结构
- 新建文章按钮
- 折叠/展开功能

**模板结构**：
```vue
<template>
  <aside class="h-full bg-vscode-bg-secondary border-r border-vscode-border">
    <!-- 顶部标题和新建按钮 -->
    <div class="p-4 border-b border-vscode-border">
      <h1 class="text-lg font-semibold text-vscode-text-primary">DouBlog</h1>
      <Button @click="goToNewPost" class="w-full mt-2">
        <Plus class="w-4 h-4 mr-2" />
        新建文章
      </Button>
    </div>
    
    <!-- 文章树 -->
    <div class="overflow-auto h-[calc(100%-80px)]">
      <PostTree :tree="postStore.postTree" />
    </div>
  </aside>
</template>
```

### 7.3 PostTree组件

**文件**: `src/components/post/PostTree.vue`

**Props**:
```typescript
interface Props {
  tree: PostTreeNode[];
}
```

**功能**：
- 递归渲染树形结构
- 点击节点导航到文章详情
- 当前访问的文章高亮

**模板结构**：
```vue
<template>
  <div class="py-2">
    <PostTreeItem 
      v-for="node in tree" 
      :key="node.id"
      :node="node"
    />
  </div>
</template>
```

### 7.4 PostTreeItem组件

**文件**: `src/components/post/PostTreeItem.vue`

**Props**:
```typescript
interface Props {
  node: PostTreeNode;
}
```

**功能**：
- 单个树节点
- 展开/折叠子节点
- 点击跳转

**模板结构**：
```vue
<template>
  <div>
    <div 
      class="flex items-center px-4 py-2 cursor-pointer hover:bg-vscode-bg-tertiary"
      :class="{ 'bg-vscode-bg-tertiary': isActive }"
      :style="{ paddingLeft: `${node.level * 16 + 16}px` }"
      @click="handleClick"
    >
      <!-- 展开/折叠图标 -->
      <ChevronRight 
        v-if="node.children.length > 0"
        class="w-4 h-4 mr-1 transition-transform"
        :class="{ 'rotate-90': expanded }"
        @click.stop="toggleExpand"
      />
      <span v-else class="w-5" />
      
      <!-- 标题 -->
      <span class="text-vscode-text-primary">{{ node.title }}</span>
    </div>
    
    <!-- 子节点 -->
    <div v-if="expanded && node.children.length > 0">
      <PostTreeItem 
        v-for="child in node.children"
        :key="child.id"
        :node="child"
      />
    </div>
  </div>
</template>
```

### 7.5 MarkdownEditor组件

**文件**: `src/components/editor/MarkdownEditor.vue`

**Props**:
```typescript
interface Props {
  modelValue: string;
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'update:modelValue', value: string): void;
}
```

**功能**：
- 封装md-editor-v3
- 图片上传处理
- 主题适配

**模板结构**：
```vue
<template>
  <MdEditor
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :theme="themeStore.isDark ? 'dark' : 'light'"
    @onUploadImg="handleUploadImg"
    class="h-full"
  />
</template>
```

---

## 8. 页面设计

### 8.1 Login页面

**文件**: `src/views/Login.vue`

**布局**：
- 居中卡片
- 用户名输入框
- 密码输入框
- 登录按钮
- VS Code Dark背景

**模板结构**：
```vue
<template>
  <div class="h-screen flex items-center justify-center bg-vscode-bg-primary">
    <Card class="w-96">
      <CardHeader>
        <CardTitle>DouBlog 登录</CardTitle>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleLogin">
          <div class="space-y-4">
            <Input 
              v-model="username"
              placeholder="用户名"
            />
            <Input 
              v-model="password"
              type="password"
              placeholder="密码"
            />
            <Button type="submit" class="w-full">登录</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
```

### 8.2 Home页面

**文件**: `src/views/Home.vue`

**布局**：
- 使用Layout组件包裹
- 显示欢迎信息
- 快捷操作按钮

**模板结构**：
```vue
<template>
  <Layout>
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold text-vscode-text-primary mb-4">
        欢迎使用 DouBlog
      </h1>
      <p class="text-vscode-text-secondary mb-8">
        这是一个现代化的个人博客系统
      </p>
      
      <div class="grid grid-cols-2 gap-4">
        <Card @click="goToNewPost" class="cursor-pointer hover:border-accent-blue">
          <CardContent class="pt-6">
            <FilePlus class="w-8 h-8 mb-2 text-accent-blue" />
            <h3 class="text-lg font-semibold">新建文章</h3>
          </CardContent>
        </Card>
        
        <!-- 更多快捷操作 -->
      </div>
    </div>
  </Layout>
</template>
```

### 8.3 PostDetail页面

**文件**: `src/views/PostDetail.vue`

**布局**：
- 文章标题
- 文章元信息（作者、时间、分类）
- Markdown渲染内容
- 编辑/删除按钮
- GitHub评论（Giscus）

**模板结构**：
```vue
<template>
  <Layout>
    <div v-if="post" class="max-w-4xl mx-auto">
      <!-- 标题和操作 -->
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-vscode-text-primary">
          {{ post.title }}
        </h1>
        <div class="flex gap-2">
          <Button @click="goToEdit">编辑</Button>
          <Button variant="destructive" @click="handleDelete">删除</Button>
        </div>
      </div>
      
      <!-- 元信息 -->
      <div class="flex gap-4 text-vscode-text-secondary mb-6">
        <span>作者: {{ post.author }}</span>
        <span>发布: {{ formatDate(post.created_at) }}</span>
      </div>
      
      <!-- 内容 -->
      <MarkdownRenderer :content="post.content" class="mb-8" />
      
      <!-- GitHub评论 -->
      <div class="mt-8">
        <Giscus />
      </div>
    </div>
  </Layout>
</template>
```

### 8.4 PostEdit页面

**文件**: `src/views/PostEdit.vue`

**布局**：
- 标题输入框
- Markdown编辑器
- 保存/取消按钮

**模板结构**：
```vue
<template>
  <Layout>
    <div class="h-full flex flex-col">
      <div class="mb-4 flex gap-4">
        <Input v-model="title" placeholder="文章标题" class="flex-1" />
        <Button @click="handleSave">保存</Button>
        <Button variant="outline" @click="handleCancel">取消</Button>
      </div>
      
      <div class="flex-1">
        <MarkdownEditor v-model="content" />
      </div>
    </div>
  </Layout>
</template>
```

### 8.5 PostNew页面

**文件**: `src/views/PostNew.vue`

**布局**：
- 标题输入框
- Slug输入框
- 父文章选择器（可选）
- Markdown编辑器
- 发布按钮

**模板结构**：
```vue
<template>
  <Layout>
    <div class="h-full flex flex-col">
      <div class="mb-4 flex gap-4">
        <Input v-model="title" placeholder="文章标题" class="flex-1" />
        <Input v-model="slug" placeholder="URL别名" class="w-64" />
        <Select v-model="parentId" placeholder="父文章">
          <SelectItem :value="null">无</SelectItem>
          <SelectItem v-for="p in allPosts" :value="p.id">
            {{ p.title }}
          </SelectItem>
        </Select>
        <Button @click="handlePublish">发布</Button>
      </div>
      
      <div class="flex-1">
        <MarkdownEditor v-model="content" />
      </div>
    </div>
  </Layout>
</template>
```

---

## 9. 样式设计

### 9.1 CSS变量

**文件**: `src/assets/styles/variables.css`

```css
:root {
  /* 亮色模式 */
  --bg-primary: #ffffff;
  --bg-secondary: #f3f3f3;
  --bg-tertiary: #e8e8e8;
  
  --text-primary: #1e1e1e;
  --text-secondary: #6e6e6e;
  --text-muted: #9d9d9d;
  
  --border: #d4d4d4;
  --border-hover: #c4c4c4;
  
  --accent-blue: #0066b8;
  --accent-green: #008000;
}

.dark {
  /* 暗色模式 - VS Code Dark */
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d2d;
  
  --text-primary: #d4d4d4;
  --text-secondary: #9cdcfe;
  --text-muted: #808080;
  
  --border: #3c3c3c;
  --border-hover: #6fc3df;
  
  --accent-blue: #569cd6;
  --accent-green: #6a9955;
  --accent-purple: #c586c0;
  --accent-orange: #ce9178;
}
```

### 9.2 Tailwind配置

**文件**: `tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        vscode: {
          'bg-primary': 'var(--bg-primary)',
          'bg-secondary': 'var(--bg-secondary)',
          'bg-tertiary': 'var(--bg-tertiary)',
          'text-primary': 'var(--text-primary)',
          'text-secondary': 'var(--text-secondary)',
          'text-muted': 'var(--text-muted)',
          'border': 'var(--border)',
        },
        accent: {
          'blue': 'var(--accent-blue)',
          'green': 'var(--accent-green)',
          'purple': 'var(--accent-purple)',
          'orange': 'var(--accent-orange)',
        }
      },
      width: {
        '70': '280px',
      }
    }
  },
  plugins: [],
}
```

### 9.3 全局样式

**文件**: `src/assets/styles/index.css`

```css
@import './variables.css';
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 全局样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-hover);
}

/* Markdown样式 */
.markdown-body {
  color: var(--text-primary);
  line-height: 1.7;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.markdown-body h1 {
  font-size: 2em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}

.markdown-body h2 {
  font-size: 1.5em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}

.markdown-body h3 {
  font-size: 1.25em;
}

.markdown-body p {
  margin: 1em 0;
}

.markdown-body code {
  background: var(--bg-tertiary);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
}

.markdown-body pre {
  background: var(--bg-tertiary);
  padding: 1em;
  border-radius: 6px;
  overflow-x: auto;
}

.markdown-body pre code {
  background: none;
  padding: 0;
}

.markdown-body blockquote {
  border-left: 4px solid var(--accent-blue);
  padding-left: 1em;
  color: var(--text-secondary);
  margin: 1em 0;
}

.markdown-body a {
  color: var(--accent-blue);
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body img {
  max-width: 100%;
  height: auto;
}
```

---

## 10. API集成

### 10.1 Axios实例配置

**文件**: `src/services/api.ts`

```typescript
import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

const api: AxiosInstance = axios.create({
  baseURL: 'http://localhost:60000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config: AxiosRequestConfig) => {
    const auth = localStorage.getItem('auth');
    if (auth) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Basic ${auth}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

### 10.2 认证API

**文件**: `src/services/auth.ts`

```typescript
import api from './api';

export const login = async () => {
  return api.post('/auth/login');
};

export const checkAuth = async () => {
  return api.get('/auth/check');
};
```

### 10.3 文章API

**文件**: `src/services/post.ts`

```typescript
import api from './api';
import type { Post, PostTreeNode } from '@/types/post';

export const getPosts = async (params?: {
  page?: number;
  page_size?: number;
  parent_id?: number;
  status?: string;
  keyword?: string;
}) => {
  return api.get('/posts', { params });
};

export const getPost = async (slug: string) => {
  return api.get(`/posts/${slug}`);
};

export const getPostTree = async () => {
  return api.get('/posts/tree');
};

export const createPost = async (data: Partial<Post>) => {
  return api.post('/posts', data);
};

export const updatePost = async (slug: string, data: Partial<Post>) => {
  return api.put(`/posts/${slug}`, data);
};

export const deletePost = async (slug: string) => {
  return api.delete(`/posts/${slug}`);
};
```

### 10.4 图片API

**文件**: `src/services/image.ts`

```typescript
import api from './api';

export const uploadImage = async (file: File, postSlug?: string) => {
  const formData = new FormData();
  formData.append('file', file);
  if (postSlug) {
    formData.append('post_slug', postSlug);
  }
  return api.post('/images/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const deleteImage = async (filepath: string) => {
  return api.delete(`/images/${filepath}`);
};
```

---

## 11. 配置文件

### 11.1 package.json

```json
{
  "name": "doublog-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts --fix"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "vue-router": "^4.2.0",
    "pinia": "^2.1.0",
    "axios": "^1.6.0",
    "md-editor-v3": "^6.4.0",
    "lucide-vue-next": "^0.300.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "vue-tsc": "^1.8.0",
    "tailwindcss": "^4.0.0",
    "@types/node": "^20.10.0",
    "eslint": "^8.55.0",
    "eslint-plugin-vue": "^9.19.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "prettier": "^3.1.0"
  }
}
```

### 11.2 vite.config.ts

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:60000',
        changeOrigin: true,
      },
    },
  },
});
```

### 11.3 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

## 12. 开发注意事项

### 12.1 路径别名

所有import使用`@`别名：
```typescript
import { useAuthStore } from '@/stores/auth';
import PostTree from '@/components/post/PostTree.vue';
```

### 12.2 类型定义

在`src/types/`目录下定义所有TypeScript接口：
- `api.ts` - API响应类型
- `post.ts` - 文章相关类型
- `user.ts` - 用户类型

### 12.3 shadcn-vue组件

使用shadcn-vue CLI添加组件：
```bash
npx shadcn-vue@latest add button
npx shadcn-vue@latest add card
npx shadcn-vue@latest add input
```

组件会自动生成到`src/components/ui/`目录。

### 12.4 图片处理

编辑器上传图片时：
1. 调用`POST /api/images/upload`
2. 获取返回的URL
3. 插入Markdown: `![alt](url)`

### 12.5 GitHub评论（Giscus）

在`PostDetail.vue`中集成Giscus：

```vue
<script setup>
const giscusConfig = {
  src: 'https://giscus.app/client.js',
  'data-repo': 'your-username/your-repo',
  'data-repo-id': 'your-repo-id',
  'data-category': 'Announcements',
  'data-category-id': 'your-category-id',
  'data-mapping': 'pathname',
  'data-theme': 'preferred_color_scheme',
  'data-lang': 'zh-CN',
};
</script>

<template>
  <div class="giscus">
    <script :src="giscusConfig.src" 
      :data-repo="giscusConfig['data-repo']"
      ... />
  </div>
</template>
```

---

**文档结束**