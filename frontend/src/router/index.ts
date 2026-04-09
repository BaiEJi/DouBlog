import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * 路由配置
 */
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
    path: '/post/id/:id',
    name: 'PostDetailById',
    component: () => import('@/views/PostDetail.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/slug/:slug',
    name: 'PostDetailBySlug',
    component: () => import('@/views/PostDetail.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/id/:id/edit',
    name: 'PostEditById',
    component: () => import('@/views/PostEdit.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/slug/:slug/edit',
    name: 'PostEditBySlug',
    component: () => import('@/views/PostEdit.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/post/path/:slug(.*)',
    name: 'PostDetailByPath',
    component: () => import('@/views/PostDetail.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

/**
 * 路由实例
 */
const router = createRouter({
  history: createWebHistory(),
  routes
})

/**
 * 路由守卫
 * 检查认证状态，未认证用户跳转到登录页
 */
router.beforeEach((to, _from, next) => {
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
