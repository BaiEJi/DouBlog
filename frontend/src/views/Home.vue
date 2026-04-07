<script setup lang="ts">
import { useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import { Card, CardContent } from '@/components/ui/card'
import { FilePlus } from 'lucide-vue-next'

const router = useRouter()

const handleNewPost = () => {
  router.push('/post/new')
}
</script>

<template>
  <Layout>
    <div class="max-w-4xl mx-auto p-6">
      <h1 class="text-3xl font-semibold mb-2">欢迎使用 DouBlog</h1>
      <p class="text-vscode-text-secondary mb-8">开始记录您的想法和知识</p>
      
      <div class="grid grid-cols-1 gap-4">
        <Card 
          class="cursor-pointer hover:shadow-md transition-shadow"
          @click="handleNewPost"
        >
          <CardContent class="flex items-center gap-4 py-6">
            <FilePlus class="w-8 h-8 text-vscode-accent-blue" />
            <div>
              <h3 class="text-lg font-semibold">新建文章</h3>
              <p class="text-sm text-vscode-text-secondary">创建一篇新的博客文章</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </Layout>
</template>
