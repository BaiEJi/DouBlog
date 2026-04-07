# DouBlog 前端开发 Prompt

> **目标**: 使用此文档指导AI大模型完成DouBlog前端开发  
> **技术栈**: Vue 3 + Vite + Tailwind CSS v4 + shadcn-vue + md-editor-v3  
> **端口**: 5173  
> **后端API**: http://localhost:60000/api

---

## 📋 项目初始化

### 步骤1: 创建项目目录

```bash
# 在 /home/lizy/projects/DouBlog 目录下创建 frontend 文件夹
cd /home/lizy/projects/DouBlog
mkdir -p frontend
cd frontend
```

### 步骤2: 初始化Vue 3项目

使用Vite创建Vue 3 + TypeScript项目：

```bash
npm create vite@latest . -- --template vue-ts
```

### 步骤3: 安装依赖

```bash
# 核心依赖
npm install vue-router@4 pinia axios

# Markdown编辑器
npm install md-editor-v3

# 图标库
npm install lucide-vue-next

# 开发依赖
npm install -D tailwindcss@latest postcss autoprefixer
npm install -D @types/node
```

### 步骤4: 初始化Tailwind CSS v4

```bash
npx tailwindcss init -p
```

### 步骤5: 安装shadcn-vue

```bash
# 初始化shadcn-vue
npx shadcn-vue@latest init

# 安装需要的组件
npx shadcn-vue@latest add button
npx shadcn-vue@latest add card
npx shadcn-vue@latest add input
npx shadcn-vue@latest add select
npx shadcn-vue@latest add dropdown-menu
npx shadcn-vue@latest add dialog
npx shadcn-vue@latest add toast
```

---

## 🗂️ 创建目录结构

创建以下目录结构：

```
frontend/
├── src/
│   ├── assets/
│   │   └── styles/
│   │       ├── index.css
│   │       └── variables.css
│   ├── components/
│   │   ├── layout/
│   │   ├── post/
│   │   └── editor/
│   ├── views/
│   ├── router/
│   ├── stores/
│   ├── services/
│   ├── types/
│   ├── utils/
│   └── composables/
```

创建命令：

```bash
mkdir -p src/assets/styles
mkdir -p src/components/layout
mkdir -p src/components/post
mkdir -p src/components/editor
mkdir -p src/views
mkdir -p src/router
mkdir -p src/stores
mkdir -p src/services
mkdir -p src/types
mkdir -p src/utils
mkdir -p src/composables
```

---

## 📝 代码实现清单

按照以下顺序实现代码文件：

### 第1批: 配置文件

1. **vite.config.ts** - Vite配置
2. **tailwind.config.js** - Tailwind配置
3. **tsconfig.json** - TypeScript配置
4. **src/assets/styles/variables.css** - CSS变量
5. **src/assets/styles/index.css** - 全局样式

### 第2批: 类型定义

6. **src/types/api.ts** - API响应类型
7. **src/types/post.ts** - 文章类型
8. **src/types/user.ts** - 用户类型

### 第3批: 工具和服务

9. **src/services/api.ts** - Axios实例
10. **src/services/auth.ts** - 认证API
11. **src/services/post.ts** - 文章API
12. **src/services/image.ts** - 图片API
13. **src/utils/storage.ts** - 本地存储工具
14. **src/utils/format.ts** - 格式化工具

### 第4批: 状态管理

15. **src/stores/auth.ts** - 认证状态
16. **src/stores/post.ts** - 文章状态
17. **src/stores/theme.ts** - 主题状态

### 第5批: 路由配置

18. **src/router/index.ts** - 路由配置

### 第6批: 布局组件

19. **src/components/layout/Layout.vue** - 主布局
20. **src/components/layout/Sidebar.vue** - 侧边栏
21. **src/components/layout/Header.vue** - 顶部栏
22. **src/components/layout/ThemeToggle.vue** - 主题切换

### 第7批: 文章组件

23. **src/components/post/PostTree.vue** - 文章树
24. **src/components/post/PostTreeItem.vue** - 文章树节点
25. **src/components/post/PostCard.vue** - 文章卡片
26. **src/components/post/MarkdownRenderer.vue** - Markdown渲染器

### 第8批: 编辑器组件

27. **src/components/editor/MarkdownEditor.vue** - Markdown编辑器

### 第9批: 页面视图

28. **src/views/Login.vue** - 登录页
29. **src/views/Home.vue** - 首页
30. **src/views/PostDetail.vue** - 文章详情
31. **src/views/PostEdit.vue** - 编辑文章
32. **src/views/PostNew.vue** - 新建文章

### 第10批: 应用入口

33. **src/main.ts** - 应用入口
34. **src/App.vue** - 根组件

---

## 📄 详细代码实现

### 文件1: vite.config.ts

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:60000',
        changeOrigin: true
      }
    }
  }
})
```

### 文件2: tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}'
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
          'border': 'var(--border)'
        },
        accent: {
          blue: 'var(--accent-blue)',
          green: 'var(--accent-green)',
          purple: 'var(--accent-purple)',
          orange: 'var(--accent-orange)'
        }
      },
      width: {
        '70': '280px'
      }
    }
  },
  plugins: []
}
```

### 文件3: src/assets/styles/variables.css

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

### 文件4: src/assets/styles/index.css

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
```

### 文件5: src/types/post.ts

```typescript
export interface Post {
  id: number
  title: string
  slug: string
  content: string
  summary?: string
  parent_id?: number
  level: number
  order: number
  author: string
  status: 'published' | 'archived'
  is_top: boolean
  view_count: number
  tags?: string[]
  meta_data?: Record<string, any>
  created_at: string
  updated_at: string
  parent?: {
    id: number
    title: string
    slug: string
  }
  children?: PostTreeNode[]
}

export interface PostTreeNode {
  id: number
  title: string
  slug: string
  level: number
  order: number
  children: PostTreeNode[]
}

export interface CreatePostRequest {
  title: string
  slug: string
  content: string
  summary?: string
  parent_id?: number
  order?: number
  status?: 'published' | 'archived'
  is_top?: boolean
  tags?: string[]
}

export interface UpdatePostRequest {
  title?: string
  content?: string
  summary?: string
  status?: 'published' | 'archived'
  is_top?: boolean
  order?: number
  tags?: string[]
}
```

### 文件6: src/types/api.ts

```typescript
export interface ApiResponse<T = any> {
  success: boolean
  code: number
  message: string
  data: T
}

export interface PaginatedResponse<T = any> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}
```

### 文件7: src/services/api.ts

```typescript
import axios from 'axios'
import type { AxiosInstance } from 'axios'

const api: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    const auth = localStorage.getItem('auth')
    if (auth) {
      config.headers.Authorization = `Basic ${auth}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
```

### 文件8: src/services/auth.ts

```typescript
import api from './api'

export const login = () => {
  return api.post('/auth/login')
}

export const checkAuth = () => {
  return api.get('/auth/check')
}
```

### 文件9: src/services/post.ts

```typescript
import api from './api'
import type { Post, PostTreeNode, CreatePostRequest, UpdatePostRequest } from '@/types/post'
import type { PaginatedResponse } from '@/types/api'

export const getPosts = (params?: {
  page?: number
  page_size?: number
  parent_id?: number
  status?: string
  keyword?: string
}) => {
  return api.get<any, PaginatedResponse<Post>>('/posts', { params })
}

export const getPost = (slug: string) => {
  return api.get<any, Post>(`/posts/${slug}`)
}

export const getPostTree = () => {
  return api.get<any, PostTreeNode[]>('/posts/tree')
}

export const createPost = (data: CreatePostRequest) => {
  return api.post<any, Post>('/posts', data)
}

export const updatePost = (slug: string, data: UpdatePostRequest) => {
  return api.put<any, Post>(`/posts/${slug}`, data)
}

export const deletePost = (slug: string) => {
  return api.delete(`/posts/${slug}`)
}
```

### 文件10: src/services/image.ts

```typescript
import api from './api'

export const uploadImage = async (file: File, postSlug?: string) => {
  const formData = new FormData()
  formData.append('file', file)
  if (postSlug) {
    formData.append('post_slug', postSlug)
  }
  return api.post('/images/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  })
}

export const getImageUrl = (filepath: string) => {
  return `/api/images/${filepath}`
}
```

### 文件11: src/stores/auth.ts

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const username = ref<string | null>(null)
  const auth = ref<string | null>(localStorage.getItem('auth'))

  const isAuthenticated = computed(() => !!auth.value)

  const login = (user: string, pass: string): boolean => {
    const encoded = btoa(`${user}:${pass}`)
    auth.value = encoded
    username.value = user
    localStorage.setItem('auth', encoded)
    return true
  }

  const logout = () => {
    auth.value = null
    username.value = null
    localStorage.removeItem('auth')
  }

  return {
    username,
    auth,
    isAuthenticated,
    login,
    logout
  }
})
```

### 文件12: src/stores/post.ts

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Post, PostTreeNode } from '@/types/post'
import * as postApi from '@/services/post'

export const usePostStore = defineStore('post', () => {
  const posts = ref<Post[]>([])
  const currentPost = ref<Post | null>(null)
  const postTree = ref<PostTreeNode[]>([])
  const loading = ref(false)

  const fetchPostTree = async () => {
    loading.value = true
    try {
      const res = await postApi.getPostTree()
      postTree.value = res
    } finally {
      loading.value = false
    }
  }

  const fetchPost = async (slug: string) => {
    loading.value = true
    try {
      const res = await postApi.getPost(slug)
      currentPost.value = res
    } finally {
      loading.value = false
    }
  }

  const createPost = async (data: any) => {
    const res = await postApi.createPost(data)
    await fetchPostTree()
    return res
  }

  const updatePost = async (slug: string, data: any) => {
    const res = await postApi.updatePost(slug, data)
    await fetchPostTree()
    return res
  }

  const deletePost = async (slug: string) => {
    await postApi.deletePost(slug)
    await fetchPostTree()
  }

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
  }
})
```

### 文件13: src/stores/theme.ts

```typescript
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const isDark = ref(
    localStorage.getItem('theme') === 'dark' ||
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )

  watch(isDark, (value) => {
    if (value) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, { immediate: true })

  const toggleTheme = () => {
    isDark.value = !isDark.value
  }

  return {
    isDark,
    toggleTheme
  }
})
```

### 文件14: src/router/index.ts

```typescript
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/')
  } else {
    next()
  }
})

export default router
```

### 文件15: src/views/Login.vue

```vue
<template>
  <div class="h-screen flex items-center justify-center bg-vscode-bg-primary">
    <Card class="w-96">
      <CardHeader>
        <CardTitle>DouBlog 登录</CardTitle>
        <CardDescription>请输入用户名和密码</CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleLogin">
          <div class="space-y-4">
            <div>
              <Input 
                v-model="username"
                placeholder="用户名"
                class="w-full"
              />
            </div>
            <div>
              <Input 
                v-model="password"
                type="password"
                placeholder="密码"
                class="w-full"
              />
            </div>
            <Button type="submit" class="w-full">登录</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')

const handleLogin = async () => {
  if (!username.value || !password.value) {
    alert('请输入用户名和密码')
    return
  }

  try {
    authStore.login(username.value, password.value)
    router.push('/')
  } catch (error) {
    alert('登录失败，请检查用户名和密码')
  }
}
</script>
```

### 文件16: src/views/Home.vue

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
        <Card @click="goToNewPost" class="cursor-pointer hover:border-accent-blue transition-colors">
          <CardContent class="pt-6">
            <FilePlus class="w-8 h-8 mb-2 text-accent-blue" />
            <h3 class="text-lg font-semibold text-vscode-text-primary">新建文章</h3>
            <p class="text-vscode-text-secondary text-sm">创建一篇新文章</p>
          </CardContent>
        </Card>
      </div>
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { FilePlus } from 'lucide-vue-next'
import Layout from '@/components/layout/Layout.vue'
import { Card, CardContent } from '@/components/ui/card'

const router = useRouter()

const goToNewPost = () => {
  router.push('/post/new')
}
</script>
```

### 文件17: src/main.ts

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/styles/index.css'
import 'md-editor-v3/lib/style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

app.mount('#app')
```

### 文件18: src/App.vue

```vue
<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

onMounted(() => {
  // 初始化主题
  if (themeStore.isDark) {
    document.documentElement.classList.add('dark')
  }
})
</script>
```

---

## 🎨 组件实现说明

由于组件数量较多，以下是关键组件的实现要点：

### Layout组件

- 固定布局：左侧280px侧边栏，右侧flex-1内容区
- 使用Flex布局
- 背景色使用CSS变量

### PostTree组件

- 递归渲染树形结构
- 使用`PostTreeItem`组件
- 点击节点更新路由

### MarkdownEditor组件

- 使用`md-editor-v3`
- 封装图片上传逻辑
- 支持暗色模式

---

## ✅ 完成检查清单

完成后检查以下项目：

- [ ] 依赖全部安装成功
- [ ] TypeScript编译无错误
- [ ] 所有页面路由正常
- [ ] 登录认证流程正常
- [ ] 文章树正常显示
- [ ] Markdown编辑器正常工作
- [ ] 暗色/亮色模式切换正常
- [ ] API请求携带认证Header

---

## 🚀 启动命令

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build
```

访问：http://localhost:5173

---

## 📝 注意事项

1. **所有import使用`@`别名**
2. **shadcn-vue组件已自动安装，直接导入使用**
3. **API请求通过Vite代理转发到后端**
4. **认证信息存储在localStorage**
5. **主题选择持久化到localStorage**

---

**Prompt文档结束**