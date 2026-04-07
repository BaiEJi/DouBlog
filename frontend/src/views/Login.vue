<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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
  <div class="h-screen flex items-center justify-center bg-vscode-bg-primary">
    <Card class="w-full max-w-md">
      <CardHeader>
        <CardTitle>DouBlog 登录</CardTitle>
        <CardDescription>请输入您的用户名和密码</CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="handleLogin" class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <label for="username" class="text-sm font-medium">用户名</label>
            <Input
              id="username"
              v-model="username"
              type="text"
              placeholder="请输入用户名"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label for="password" class="text-sm font-medium">密码</label>
            <Input
              id="password"
              v-model="password"
              type="password"
              placeholder="请输入密码"
            />
          </div>
          <Button type="submit" class="w-full">登录</Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
