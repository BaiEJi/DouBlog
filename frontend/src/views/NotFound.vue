<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'

const router = useRouter()

const goHome = () => {
  router.push('/')
}
</script>

<template>
  <div class="h-screen flex items-center justify-center bg-vscode-bg-primary">
    <div class="flex flex-col items-center gap-6">
      <h1 class="text-6xl font-bold text-vscode-text-primary">404</h1>
      <p class="text-xl text-vscode-text-secondary">页面未找到</p>
      <Button @click="goHome">返回首页</Button>
    </div>
  </div>
</template>
