<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Code2, Terminal } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')

const handleLogin = () => {
  if (!username.value || !password.value) {
    return
  }
  
  authStore.login(username.value, password.value)
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-vscode-bg-primary relative overflow-hidden">
    <!-- Background Gradient Mesh -->
    <div class="absolute inset-0 bg-gradient-to-br from-vscode-bg-primary via-vscode-bg-secondary to-vscode-bg-tertiary"></div>
    
    <!-- Floating Code Decorations -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <!-- Top Left -->
      <div class="absolute top-20 left-20 text-accent-blue/10 text-9xl font-mono animate-pulse" style="animation-delay: 0s;">{ }</div>
      
      <!-- Top Right -->
      <div class="absolute top-32 right-32 text-accent-green/10 text-8xl font-mono animate-pulse" style="animation-delay: 1s;">&lt;/&gt;</div>
      
      <!-- Bottom Left -->
      <div class="absolute bottom-40 left-40 text-accent-yellow/10 text-7xl font-mono animate-pulse" style="animation-delay: 2s;">[ ]</div>
      
      <!-- Bottom Right -->
      <div class="absolute bottom-24 right-20 text-accent-red/10 text-8xl font-mono animate-pulse" style="animation-delay: 1.5s;">#</div>
      
      <!-- Additional Decorative Elements -->
      <div class="absolute top-1/3 left-1/4 text-syntax-keyword/5 text-6xl font-mono">function</div>
      <div class="absolute top-2/3 right-1/4 text-syntax-string/5 text-6xl font-mono">const</div>
      <div class="absolute bottom-1/3 left-1/3 text-syntax-function/5 text-5xl font-mono">=&gt;</div>
      
      <!-- Grid Pattern Overlay -->
      <div class="absolute inset-0" style="background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0); background-size: 40px 40px; opacity: 0.3;"></div>
    </div>
    
    <!-- Main Content -->
    <div class="relative z-10 w-full max-w-md px-6 animate-fade-in">
      <!-- Brand Section -->
      <div class="text-center mb-8 space-y-4">
        <!-- Logo Icon -->
        <div class="flex justify-center mb-6">
          <div class="relative">
            <!-- Glow Effect -->
            <div class="absolute inset-0 bg-accent-blue/20 blur-3xl rounded-full"></div>
            <!-- Icon Container -->
            <div class="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-blue/20 to-accent-blue/5 border border-accent-blue/30 backdrop-blur-sm">
              <Code2 class="w-10 h-10 text-accent-blue" />
            </div>
          </div>
        </div>
        
        <!-- Brand Name -->
        <h1 class="text-4xl font-bold bg-gradient-to-r from-text-primary via-accent-blue to-text-primary bg-clip-text text-transparent">
          DouBlog
        </h1>
        
        <!-- Tagline -->
        <div class="flex items-center justify-center gap-2 text-text-secondary">
          <Terminal class="w-4 h-4" />
          <span class="text-sm font-medium">VS Code 风格的技术博客</span>
        </div>
      </div>
      
      <!-- Login Card with Glassmorphism -->
      <Card class="w-full backdrop-blur-lg bg-card/80 border-border/50 shadow-vscode-xl">
        <CardHeader>
          <CardTitle class="text-2xl">登录</CardTitle>
          <CardDescription>请输入您的用户名和密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form @submit.prevent="handleLogin" class="flex flex-col gap-5">
            <div class="flex flex-col gap-2.5">
              <label for="username" class="text-sm font-medium text-text-primary">用户名</label>
              <Input
                id="username"
                v-model="username"
                type="text"
                placeholder="请输入用户名"
                class="transition-all duration-200"
              />
            </div>
            <div class="flex flex-col gap-2.5">
              <label for="password" class="text-sm font-medium text-text-primary">密码</label>
              <Input
                id="password"
                v-model="password"
                type="password"
                placeholder="请输入密码"
                class="transition-all duration-200"
              />
            </div>
            <Button type="submit" class="w-full h-10 text-base font-medium mt-2" size="lg">
              登录
            </Button>
          </form>
        </CardContent>
      </Card>
      
      <!-- Footer Info -->
      <div class="mt-6 text-center">
        <p class="text-xs text-text-muted">
          Powered by Vue 3 + TypeScript
        </p>
      </div>
    </div>
  </div>
</template>
