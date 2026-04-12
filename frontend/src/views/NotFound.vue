<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Home, SearchX, ArrowLeft } from 'lucide-vue-next'

const router = useRouter()

/**
 * 返回首页
 */
const goHome = () => {
  router.push('/')
}

/**
 * 返回上一页
 */
const goBack = () => {
  router.back()
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 bg-vscode-bg-primary">
    <div class="flex flex-col items-center gap-12 max-w-md text-center">
      <!-- 404 Illustration with modern design -->
      <div class="relative mb-8">
        <div class="text-9xl sm:text-12xl font-bold leading-none text-vscode-text-primary/10 select-none">
          404
        </div>
        <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <SearchX 
            class="w-32 h-32 sm:w-40 sm:h-40 text-vscode-accent-error opacity-80 animate-pulse" 
            strokeWidth="1.5"
          />
        </div>
      </div>

      <!-- Error Title -->
      <div class="space-y-4">
        <h1 class="text-4xl sm:text-5xl font-bold text-vscode-text-primary tracking-tight">
          页面未找到
        </h1>
        <p class="text-vscode-text-secondary text-lg sm:text-xl">
          抱歉，您访问的页面不存在或已被移除
        </p>
      </div>

      <!-- Decorative elements -->
      <div class="flex gap-2 mb-8">
        <div class="w-2 h-2 rounded-full bg-vscode-accent-primary-subtle"></div>
        <div class="w-2 h-2 rounded-full bg-vscode-accent-warning-subtle"></div>
        <div class="w-2 h-2 rounded-full bg-vscode-accent-error-subtle"></div>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
        <Button
          @click="goBack"
          variant="outline"
          class="flex items-center justify-center gap-2 px-6 h-11 border-vscode-border hover:bg-vscode-bg-hover"
        >
          <ArrowLeft class="w-4 h-4" />
          <span>返回上一页</span>
        </Button>
        <Button
          @click="goHome"
          class="flex items-center justify-center gap-2 px-6 h-11 bg-vscode-accent-primary hover:bg-vscode-accent-primary-hover"
        >
          <Home class="w-4 h-4" />
          <span>返回首页</span>
        </Button>
      </div>

      <!-- Help text -->
      <p class="text-sm text-vscode-text-muted mt-6">
        如果您认为这是一个错误，请联系管理员
      </p>
    </div>
  </div>
</template>
