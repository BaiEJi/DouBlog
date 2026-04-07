<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { usePostStore } from '@/stores/post'
import { 
  FilePlus, 
  BookOpen, 
  Settings, 
  FileText, 
  Tag, 
  Clock,
  Sparkles
} from 'lucide-vue-next'

const router = useRouter()
const postStore = usePostStore()

// Fetch post tree on mount
onMounted(() => {
  if (postStore.postTree.length === 0) {
    postStore.fetchPostTree()
  }
})

// Calculate statistics from post tree
const statistics = computed(() => {
  const tree = postStore.postTree
  let totalPosts = 0
  let totalTags = new Set<string>()
  let lastUpdate: Date | null = null

  const traverseTree = (nodes: typeof tree) => {
    nodes.forEach(node => {
      totalPosts++
      node.tags?.forEach(tag => totalTags.add(tag))
      
      const updatedAt = new Date(node.updated_at)
      if (!lastUpdate || updatedAt > lastUpdate) {
        lastUpdate = updatedAt
      }
      
      if (node.children && node.children.length > 0) {
        traverseTree(node.children)
      }
    })
  }

  traverseTree(tree)

  return {
    totalPosts,
    totalTags: totalTags.size,
    lastUpdate: lastUpdate ? formatDate(lastUpdate) : '暂无文章'
  }
})

const formatDate = (date: Date): string => {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  
  return date.toLocaleDateString('zh-CN', { 
    month: '2-digit', 
    day: '2-digit' 
  })
}

const handleNewPost = () => {
  router.push('/post/new')
}

const handleBrowsePosts = () => {
  router.push('/post/tree')
}

const handleSettings = () => {
  // Placeholder - settings page not implemented yet
  console.log('Settings page coming soon')
}
</script>

<template>
  <Layout>
    <div class="max-w-6xl mx-auto p-6 space-y-8">
      
      <!-- Hero Section -->
      <section class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-vscode-accent-blue/10 via-vscode-bg-secondary to-vscode-bg-tertiary border border-vscode-border p-8 md:p-12">
        <div class="relative z-10 max-w-2xl">
          <div class="flex items-center gap-3 mb-4">
            <Sparkles class="w-8 h-8 text-vscode-accent-blue animate-pulse" />
            <h1 class="text-4xl md:text-5xl font-bold text-vscode-text-primary tracking-tight">
              DouBlog
            </h1>
          </div>
          
          <p class="text-xl md:text-2xl text-vscode-text-secondary mb-3 font-medium">
            VS Code 风格的技术博客与知识库
          </p>
          
          <p class="text-base text-vscode-text-muted mb-8 leading-relaxed">
            支持无限层级树形结构，Markdown 实时预览编辑，优雅地组织您的知识与想法
          </p>
          
          <div class="flex flex-wrap gap-3">
            <Button 
              size="lg" 
              class="gap-2 shadow-vscode-md hover:shadow-vscode-lg transition-all"
              @click="handleNewPost"
            >
              <FilePlus class="w-5 h-5" />
              快速开始
            </Button>
            
            <Button 
              size="lg" 
              variant="outline"
              class="gap-2"
              @click="handleBrowsePosts"
            >
              <BookOpen class="w-5 h-5" />
              浏览文章
            </Button>
          </div>
        </div>
        
        <!-- Decorative background elements -->
        <div class="absolute top-0 right-0 w-64 h-64 bg-vscode-accent-blue/5 rounded-full blur-3xl"></div>
        <div class="absolute bottom-0 left-1/2 w-48 h-48 bg-vscode-accent-green/5 rounded-full blur-2xl"></div>
      </section>

      <!-- Statistics Section -->
      <section>
        <h2 class="text-xl font-semibold text-vscode-text-primary mb-4 flex items-center gap-2">
          <span class="w-1 h-6 bg-vscode-accent-blue rounded-full"></span>
          数据概览
        </h2>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Total Posts -->
          <Card class="group">
            <CardContent class="flex items-center gap-4 py-6">
              <div class="flex-shrink-0 w-12 h-12 rounded-lg bg-vscode-accent-blue/10 flex items-center justify-center group-hover:bg-vscode-accent-blue/20 transition-colors">
                <FileText class="w-6 h-6 text-vscode-accent-blue" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-vscode-text-secondary mb-1">文章总数</p>
                <p class="text-2xl font-bold text-vscode-text-primary">
                  {{ statistics.totalPosts }}
                </p>
              </div>
            </CardContent>
          </Card>

          <!-- Tags Count -->
          <Card class="group">
            <CardContent class="flex items-center gap-4 py-6">
              <div class="flex-shrink-0 w-12 h-12 rounded-lg bg-vscode-accent-green/10 flex items-center justify-center group-hover:bg-vscode-accent-green/20 transition-colors">
                <Tag class="w-6 h-6 text-vscode-accent-green" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-vscode-text-secondary mb-1">标签数量</p>
                <p class="text-2xl font-bold text-vscode-text-primary">
                  {{ statistics.totalTags }}
                </p>
              </div>
            </CardContent>
          </Card>

          <!-- Last Update -->
          <Card class="group">
            <CardContent class="flex items-center gap-4 py-6">
              <div class="flex-shrink-0 w-12 h-12 rounded-lg bg-vscode-accent-yellow/10 flex items-center justify-center group-hover:bg-vscode-accent-yellow/20 transition-colors">
                <Clock class="w-6 h-6 text-vscode-accent-yellow" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-vscode-text-secondary mb-1">最近更新</p>
                <p class="text-2xl font-bold text-vscode-text-primary truncate">
                  {{ statistics.lastUpdate }}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <!-- Quick Actions Section -->
      <section>
        <h2 class="text-xl font-semibold text-vscode-text-primary mb-4 flex items-center gap-2">
          <span class="w-1 h-6 bg-vscode-accent-green rounded-full"></span>
          快捷操作
        </h2>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- New Post -->
          <Card 
            class="cursor-pointer group"
            @click="handleNewPost"
          >
            <CardContent class="flex flex-col items-center text-center py-8">
              <div class="w-16 h-16 rounded-xl bg-vscode-accent-blue/10 flex items-center justify-center mb-4 group-hover:bg-vscode-accent-blue/20 group-hover:scale-110 transition-all duration-300">
                <FilePlus class="w-8 h-8 text-vscode-accent-blue" />
              </div>
              <h3 class="text-lg font-semibold text-vscode-text-primary mb-2">
                新建文章
              </h3>
              <p class="text-sm text-vscode-text-secondary">
                创建一篇新的博客文章
              </p>
            </CardContent>
          </Card>

          <!-- Browse Posts -->
          <Card 
            class="cursor-pointer group"
            @click="handleBrowsePosts"
          >
            <CardContent class="flex flex-col items-center text-center py-8">
              <div class="w-16 h-16 rounded-xl bg-vscode-accent-green/10 flex items-center justify-center mb-4 group-hover:bg-vscode-accent-green/20 group-hover:scale-110 transition-all duration-300">
                <BookOpen class="w-8 h-8 text-vscode-accent-green" />
              </div>
              <h3 class="text-lg font-semibold text-vscode-text-primary mb-2">
                浏览文章
              </h3>
              <p class="text-sm text-vscode-text-secondary">
                查看所有文章和知识库
              </p>
            </CardContent>
          </Card>

          <!-- Settings -->
          <Card 
            class="cursor-pointer group relative overflow-hidden"
            @click="handleSettings"
          >
            <CardContent class="flex flex-col items-center text-center py-8">
              <div class="w-16 h-16 rounded-xl bg-vscode-bg-tertiary flex items-center justify-center mb-4 group-hover:bg-vscode-border transition-colors">
                <Settings class="w-8 h-8 text-vscode-text-secondary group-hover:text-vscode-text-primary transition-colors" />
              </div>
              <h3 class="text-lg font-semibold text-vscode-text-primary mb-2">
                设置
              </h3>
              <p class="text-sm text-vscode-text-secondary">
                应用设置与偏好
              </p>
              
              <!-- Coming soon badge -->
              <div class="absolute top-3 right-3 px-2 py-1 text-xs font-medium bg-vscode-accent-yellow/20 text-vscode-accent-yellow rounded-full border border-vscode-accent-yellow/30">
                即将推出
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

    </div>
  </Layout>
</template>
