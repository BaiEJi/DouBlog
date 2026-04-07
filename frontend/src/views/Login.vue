<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Code2, Terminal, Loader2 } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

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

    <!-- Background Gradient Mesh -->
    <div class="absolute inset-0" style="background: linear-gradient(135deg,
      var(--vscode-bg-primary) 0%,
      var(--vscode-bg-secondary) 50%,
      var(--vscode-bg-tertiary) 100%);"></div>

    <!-- Floating Code Decorations -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <!-- Top Left -->
      <div class="absolute top-20 left-20 font-mono animate-pulse opacity-5"
           style="font-size: 6rem; animation-delay: 0s; color: var(--vscode-accent-primary);">
        { }
      </div>

      <!-- Top Right -->
      <div class="absolute top-32 right-32 font-mono animate-pulse opacity-5"
           style="font-size: 5rem; animation-delay: 1s; color: var(--vscode-accent-success);">
        &lt;/&gt;
      </div>

      <!-- Bottom Left -->
      <div class="absolute bottom-40 left-40 font-mono animate-pulse opacity-5"
           style="font-size: 4rem; animation-delay: 2s; color: var(--vscode-accent-warning);">
        [ ]
      </div>

      <!-- Bottom Right -->
      <div class="absolute bottom-24 right-20 font-mono animate-pulse opacity-5"
           style="font-size: 5rem; animation-delay: 1.5s; color: var(--vscode-accent-error);">
        #
      </div>

      <!-- Grid Pattern Overlay -->
      <div class="absolute inset-0" style="background-image: radial-gradient(circle at 1px 1px,
        var(--vscode-border) 1px, transparent 0);
        background-size: 40px 40px; opacity: 0.2;"></div>
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

      <!-- Login Card with Glassmorphism -->
      <Card class="w-full backdrop-blur-lg border"
            style="background: var(--vscode-bg-elevated);
                   border-color: var(--vscode-border-light);
                   box-shadow: var(--vscode-shadow-xl);"
            role="form"
            aria-labelledby="login-title">
        <CardHeader>
          <CardTitle id="login-title" style="font-size: var(--vscode-font-size-2xl); color: var(--vscode-text-primary);">
            登录
          </CardTitle>
          <CardDescription style="color: var(--vscode-text-secondary);">
            请输入您的用户名和密码
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form @submit.prevent="handleLogin" class="flex flex-col gap-5" aria-label="登录表单">
            <!-- Error Message -->
            <div v-if="error"
                 class="px-4 py-3 rounded-lg border"
                 role="alert"
                 aria-live="assertive"
                 style="background: var(--vscode-accent-error-subtle);
                        border-color: var(--vscode-accent-error);
                        color: var(--vscode-accent-error);
                        font-size: var(--vscode-font-size-sm);">
              {{ error }}
            </div>

            <div class="flex flex-col gap-2.5">
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
                class="transition-all duration-200"
              />
            </div>

            <div class="flex flex-col gap-2.5">
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
                class="transition-all duration-200"
              />
            </div>

            <Button
              type="submit"
              :disabled="loading"
              :aria-busy="loading"
              class="w-full h-10 font-medium mt-2"
              size="lg"
              style="font-size: var(--vscode-font-size-base);">
              <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {{ loading ? '登录中...' : '登录' }}
            </Button>
          </form>
        </CardContent>
      </Card>

      <!-- Footer Info -->
      <div class="mt-6 text-center">
        <p style="font-size: var(--vscode-font-size-xs); color: var(--vscode-text-muted);">
          Powered by Vue 3 + TypeScript
        </p>
      </div>
    </div>
  </div>
</template>
