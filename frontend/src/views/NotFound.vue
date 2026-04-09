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
    <div class="flex flex-col items-center gap-8 max-w-md text-center">
      <!-- 404 Illustration using Lucide icons -->
      <div class="relative">
        <!-- Main 404 text with icon -->
        <div class="flex items-center justify-center gap-2">
          <span class="text-[120px] sm:text-[160px] font-bold leading-none text-vscode-text-primary/10 select-none">
            4
          </span>
          <div class="relative flex items-center justify-center">
            <!-- Large SearchX icon as the "0" -->
            <SearchX 
              class="w-24 h-24 sm:w-32 sm:h-32 text-vscode-accent-error opacity-80 animate-pulse" 
              strokeWidth="1.5"
            />
          </div>
          <span class="text-[120px] sm:text-[160px] font-bold leading-none text-vscode-text-primary/10 select-none">
            4
          </span>
        </div>
        
        <!-- Decorative circles -->
        <div class="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-vscode-accent-primary-subtle opacity-50"></div>
        <div class="absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-vscode-accent-warning-subtle opacity-50"></div>
      </div>

      <!-- Error Title -->
      <div class="space-y-2">
        <h1 class="text-3xl sm:text-4xl font-semibold text-vscode-text-primary tracking-tight">
          页面未找到
        </h1>
        <p class="text-vscode-text-secondary text-base sm:text-lg">
          抱歉，您访问的页面不存在或已被移除
        </p>
      </div>

      <!-- Friendly suggestion -->
      <div class="flex items-center gap-2 px-4 py-3 rounded-lg bg-vscode-bg-secondary border border-vscode-border-light">
        <SearchX class="w-4 h-4 text-vscode-text-muted flex-shrink-0" />
        <p class="text-sm text-vscode-text-muted">
          请检查网址是否正确，或返回首页继续浏览
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
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
      <p class="text-xs text-vscode-text-muted mt-4">
        如果您认为这是一个错误，请联系管理员
      </p>
    </div>
  </div>
</template>
