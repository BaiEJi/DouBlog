<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Terminal, Loader2 } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

/**
 * 用户名
 */
const username = ref('')

/**
 * 密码
 */
const password = ref('')

/**
 * 加载状态
 */
const loading = ref(false)

/**
 * 错误信息
 */
const error = ref('')

/**
 * 处理登录
 */
const handleLogin = async () => {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }

  loading.value = true
  error.value = ''

  try {
    authStore.login(username.value, password.value)
    router.push('/')
  } catch (e) {
    error.value = '登录失败，请检查用户名和密码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center relative overflow-hidden"
       style="background: var(--vscode-bg-primary);"
       role="main">

    <!-- Modern Vercel/Linear-inspired Background -->
    <div class="absolute inset-0" style="background: var(--vscode-bg-primary);">
      <!-- Gradient Orbs -->
      <div class="absolute top-20 left-20 w-72 h-72 rounded-full opacity-10 blur-3xl"
           style="background: radial-gradient(circle, var(--vscode-accent-primary) 0%, transparent 70%);"></div>
      <div class="absolute top-40 right-40 w-96 h-96 rounded-full opacity-8 blur-3xl"
           style="background: radial-gradient(circle, var(--vscode-accent-primary-subtle) 0%, transparent 70%);"></div>
      <div class="absolute bottom-32 left-32 w-64 h-64 rounded-full opacity-6 blur-3xl"
           style="background: radial-gradient(circle, var(--vscode-accent-primary) 0%, transparent 70%);"></div>
      
      <!-- Subtle Grid Pattern -->
      <div class="absolute inset-0" style="background-image: 
        linear-gradient(var(--vscode-border) 1px, transparent 1px),
        linear-gradient(90deg, var(--vscode-border) 1px, transparent 1px);
        background-size: 60px 60px; opacity: 0.1;"></div>
      
      <!-- Diagonal Gradient Overlay -->
      <div class="absolute inset-0" style="background: linear-gradient(135deg,
        transparent 0%,
        var(--vscode-accent-primary-subtle) 50%,
        transparent 100%); opacity: 0.05;"></div>
    </div>

    <!-- Main Content -->
    <div class="relative z-10 w-full max-w-md px-6" style="animation: fadeIn var(--vscode-duration-normal) var(--vscode-ease-out);">

      <!-- Brand Section -->
      <div class="text-center mb-8 space-y-4">
        <!-- Logo Icon -->
        <div class="flex justify-center mb-6">
          <div class="relative">
            <!-- Glow Effect -->
            <div class="absolute inset-0 blur-3xl rounded-full"
                 style="background: var(--vscode-accent-primary); opacity: 0.15;"></div>
            <!-- Icon Container -->
            <div class="relative flex items-center justify-center rounded-2xl border backdrop-blur-sm"
                 style="width: 5rem; height: 5rem;
                        background: linear-gradient(135deg,
                          var(--vscode-accent-primary-subtle),
                          var(--vscode-bg-elevated));
                        border-color: var(--vscode-border-focus);">
              <Code2 class="w-10 h-10" style="color: var(--vscode-accent-primary);" />
            </div>
          </div>
        </div>

        <!-- Brand Name -->
        <h1 class="font-bold font-display"
            style="font-size: var(--vscode-font-size-4xl);
                   background: linear-gradient(90deg,
                     var(--vscode-text-primary),
                     var(--vscode-accent-primary),
                     var(--vscode-text-primary));
                   -webkit-background-clip: text;
                   -webkit-text-fill-color: transparent;
                   background-clip: text;">
          DouBlog
        </h1>

        <!-- Tagline -->
        <div class="flex items-center justify-center gap-2"
             style="color: var(--vscode-text-secondary); font-size: var(--vscode-font-size-sm); font-weight: var(--vscode-font-weight-medium);">
          <Terminal class="w-4 h-4" />
          <span>VS Code 风格的技术博客</span>
        </div>
      </div>

<!-- Modern Login Card with Enhanced Glassmorphism -->
    <div class="w-full rounded-2xl border border-opacity-20"
         style="background: var(--vscode-bg-elevated);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border-color: var(--vscode-border-light);
                box-shadow: var(--vscode-shadow-xl);
                border-radius: var(--vscode-radius-2xl);">
      <div class="p-8">
        <div class="text-center mb-8 space-y-4">
          <h1 class="font-bold font-display"
              style="font-size: var(--vscode-font-size-3xl);
                     background: linear-gradient(90deg,
                       var(--vscode-text-primary),
                       var(--vscode-accent-primary),
                       var(--vscode-text-primary));
                     -webkit-background-clip: text;
                     -webkit-text-fill-color: transparent;
                     background-clip: text;">
            DouBlog
          </h1>
          
          <div class="flex items-center justify-center gap-2"
               style="color: var(--vscode-text-secondary); font-size: var(--vscode-font-size-sm); font-weight: var(--vscode-font-weight-medium);">
            <Terminal class="w-4 h-4" />
            <span>VS Code 风格的技术博客</span>
          </div>
        </div>

        <div class="space-y-6">
          <form @submit.prevent="handleLogin" aria-label="登录表单">
            <!-- Error Message -->
            <div v-if="error"
                 class="px-4 py-3 rounded-xl border"
                 role="alert"
                 aria-live="assertive"
                 style="background: var(--vscode-accent-error-subtle);
                        border-color: var(--vscode-accent-error);
                        color: var(--vscode-accent-error);
                        font-size: var(--vscode-font-size-sm);">
              {{ error }}
            </div>

            <div class="flex flex-col gap-4">
              <label for="username"
                     style="font-size: var(--vscode-font-size-sm);
                            font-weight: var(--vscode-font-weight-medium);
                            color: var(--vscode-text-primary);">
                用户名
              </label>
              <Input
                id="username"
                v-model="username"
                type="text"
                placeholder="请输入用户名"
                :disabled="loading"
                :aria-invalid="error ? 'true' : 'false'"
                :aria-describedby="error ? 'login-error' : undefined"
                required
                autocomplete="username"
                class="transition-all duration-200 focus:ring-2 focus:ring-opacity-20"
                style="border-color: var(--vscode-border-light);
                       focus:ring-color: var(--vscode-accent-primary);
                       focus:ring-offset-color: var(--vscode-bg-elevated);"
              />
            </div>

            <div class="flex flex-col gap-4">
              <label for="password"
                     style="font-size: var(--vscode-font-size-sm);
                            font-weight: var(--vscode-font-weight-medium);
                            color: var(--vscode-text-primary);">
                密码
              </label>
              <Input
                id="password"
                v-model="password"
                type="password"
                placeholder="请输入密码"
                :disabled="loading"
                :aria-invalid="error ? 'true' : 'false'"
                :aria-describedby="error ? 'login-error' : undefined"
                required
                autocomplete="current-password"
                class="transition-all duration-200 focus:ring-2 focus:ring-opacity-20"
                style="border-color: var(--vscode-border-light);
                       focus:ring-color: var(--vscode-accent-primary);
                       focus:ring-offset-color: var(--vscode-bg-elevated);"
              />
            </div>

            <Button
              type="submit"
              :disabled="loading"
              :aria-busy="loading"
              class="w-full h-11 font-medium mt-6 transition-all duration-200 hover:scale-105"
              size="lg"
              style="font-size: var(--vscode-font-size-base);
                     background: linear-gradient(135deg, var(--vscode-accent-primary), var(--vscode-accent-primary-hover));
                     color: var(--vscode-text-inverse);
                     border-radius: var(--vscode-radius-xl);
                     box-shadow: var(--vscode-shadow-md);">
              <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {{ loading ? '登录中...' : '登录' }}
            </Button>
          </form>
        </div>
      </div>
    </div>

      <!-- Footer Info -->
      <div class="mt-6 text-center">
        <p style="font-size: var(--vscode-font-size-xs); color: var(--vscode-text-muted);">
          Powered by Vue 3 + TypeScript
        </p>
      </div>
    </div>
  </div>
</template>
