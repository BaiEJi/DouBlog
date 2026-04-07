<script setup lang="ts">
import { useRouter } from 'vue-router'
import ThemeToggle from './ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'

const router = useRouter()
const authStore = useAuthStore()

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <header class="flex items-center justify-between h-14 px-6 bg-vscode-bg-tertiary border-b border-vscode-border">
    <div class="flex items-center">
      <h1 class="text-xl font-semibold text-vscode-text-primary">
        DouBlog
      </h1>
    </div>

    <div class="flex items-center gap-4">
      <span
        v-if="authStore.username"
        class="text-sm text-vscode-text-secondary"
      >
        {{ authStore.username }}
      </span>

      <ThemeToggle />

      <Button
        variant="outline"
        size="default"
        @click="handleLogout"
      >
        Logout
      </Button>
    </div>
  </header>
</template>
