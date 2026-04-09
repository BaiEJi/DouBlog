<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import PostCard from '@/components/post/PostCard.vue'
import PostCardSkeleton from '@/components/post/PostCardSkeleton.vue'
import { Button } from '@/components/ui/button'
import { usePostStore } from '@/stores/post'
import { 
  Sparkles, 
  FilePlus, 
  BookOpen,
  FolderOpen
} from 'lucide-vue-next'
import type { Post } from '@/types/post'

const router = useRouter()
const postStore = usePostStore()

/**
 * 加载状态
 */
const isLoading = ref(true)

/**
 * 组件挂载时加载文章树
 */
onMounted(async () => {
  if (postStore.postTree.length === 0) {
    await postStore.fetchPostTree()
  }
  isLoading.value = false
})

/**
 * 获取所有文章（扁平化）
 * 
 * @returns {Post[]} 文章列表，按置顶和时间排序
 */
const allPosts = computed(() => {
  const posts: Post[] = []
  const traverseTree = (nodes: typeof postStore.postTree) => {
    nodes.forEach(node => {
      posts.push(node)
      if (node.children && node.children.length > 0) {
        traverseTree(node.children)
      }
    })
  }
  traverseTree(postStore.postTree)
  
  return posts.sort((a, b) => {
    if (a.is_top !== b.is_top) return b.is_top ? 1 : -1
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
    return dateB - dateA
  })
})

/**
 * 最新文章列表（前6篇）
 */
const recentPosts = computed(() => allPosts.value.slice(0, 6))

/**
 * 统计信息
 */
const statistics = computed(() => {
  const posts = allPosts.value
  const totalTags = new Set<string>()
  
  posts.forEach(post => {
    post.tags?.forEach(tag => totalTags.add(tag))
  })
  
  const lastUpdate = posts.length > 0 && posts[0].created_at
    ? formatDate(new Date(posts[0].created_at))
    : '暂无文章'
  
  return {
    totalPosts: posts.length,
    totalTags: totalTags.size,
    lastUpdate
  }
})

/**
 * 格式化日期为相对时间
 * 
 * @param {Date} date - 日期对象
 * @returns {string} 格式化的相对时间字符串
 */
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

/**
 * 跳转到新建文章页
 */
const handleNewPost = () => {
  router.push('/post/new')
}

/**
 * 浏览第一篇文章
 */
const handleBrowsePosts = () => {
  const firstPost = allPosts.value[0]
  if (firstPost) {
    router.push(`/post/id/${firstPost.id}`)
  }
}
</script>

<template>
  <Layout>
    <div class="min-h-screen">
      <!-- Hero Section -->
      <section class="relative overflow-hidden">
        <!-- Gradient Background -->
        <div class="absolute inset-0 bg-gradient-to-br from-[var(--vscode-accent-primary-subtle)] via-[var(--vscode-bg-secondary)] to-[var(--vscode-bg-tertiary)]" />
        
        <!-- Decorative Elements -->
        <div class="absolute top-0 right-0 w-96 h-96 bg-[var(--vscode-accent-primary)] opacity-5 rounded-full blur-3xl" />
        <div class="absolute bottom-0 left-1/4 w-64 h-64 bg-[var(--vscode-accent-success)] opacity-5 rounded-full blur-2xl" />
        
        <!-- Content -->
        <div class="relative z-10 max-w-6xl mx-auto px-[var(--vscode-spacing-6)] py-[var(--vscode-spacing-12)] md:py-[var(--vscode-spacing-16)]">
          <div class="max-w-3xl">
            <!-- Icon & Title -->
            <div class="flex items-center gap-[var(--vscode-spacing-3)] mb-[var(--vscode-spacing-4)]">
              <Sparkles class="w-10 h-10 md:w-12 md:h-12 text-[var(--vscode-accent-primary)] animate-pulse" />
              <h1 class="text-[var(--vscode-font-size-4xl)] md:text-[var(--vscode-font-size-h1)] font-bold text-[var(--vscode-text-primary)] tracking-[var(--vscode-letter-spacing-tight)] leading-[var(--vscode-line-height-h1)]">
                DouBlog
              </h1>
            </div>
            
            <!-- Subtitle -->
            <p class="text-[var(--vscode-font-size-2xl)] md:text-[var(--vscode-font-size-3xl)] text-[var(--vscode-text-secondary)] mb-[var(--vscode-spacing-3)] font-medium leading-[var(--vscode-line-height-snug)]">
              VS Code 风格的技术博客与知识库
            </p>
            
            <!-- Description -->
            <p class="text-[var(--vscode-font-size-lg)] text-[var(--vscode-text-muted)] mb-[var(--vscode-spacing-8)] leading-[var(--vscode-line-height-relaxed)] max-w-2xl">
              支持无限层级树形结构，Markdown 实时预览编辑，优雅地组织您的知识与想法
            </p>
            
            <!-- Statistics -->
            <div class="flex flex-wrap gap-[var(--vscode-spacing-6)] md:gap-[var(--vscode-spacing-8)] mb-[var(--vscode-spacing-8)]">
              <div class="flex flex-col">
                <span class="text-[var(--vscode-font-size-3xl)] font-bold text-[var(--vscode-accent-primary)] leading-none">
                  {{ statistics.totalPosts }}
                </span>
                <span class="text-[var(--vscode-font-size-sm)] text-[var(--vscode-text-muted)] mt-1">文章</span>
              </div>
              <div class="w-px h-12 bg-[var(--vscode-border)]" />
              <div class="flex flex-col">
                <span class="text-[var(--vscode-font-size-3xl)] font-bold text-[var(--vscode-accent-success)] leading-none">
                  {{ statistics.totalTags }}
                </span>
                <span class="text-[var(--vscode-font-size-sm)] text-[var(--vscode-text-muted)] mt-1">标签</span>
              </div>
              <div class="w-px h-12 bg-[var(--vscode-border)]" />
              <div class="flex flex-col">
                <span class="text-[var(--vscode-font-size-sm)] text-[var(--vscode-text-secondary)] font-medium">
                  最近更新
                </span>
                <span class="text-[var(--vscode-font-size-sm)] text-[var(--vscode-text-muted)] mt-1">
                  {{ statistics.lastUpdate }}
                </span>
              </div>
            </div>
            
            <!-- Action Buttons -->
            <div class="flex flex-wrap gap-[var(--vscode-spacing-3)]">
              <Button 
                size="lg" 
                class="gap-2 shadow-[var(--vscode-shadow-md)] hover:shadow-[var(--vscode-shadow-lg)] transition-all"
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
        </div>
      </section>

      <!-- Recent Posts Section -->
      <section class="max-w-6xl mx-auto px-[var(--vscode-spacing-6)] py-[var(--vscode-spacing-10)]">
        <div class="flex items-center justify-between mb-[var(--vscode-spacing-6)]">
          <h2 class="text-[var(--vscode-font-size-2xl)] font-semibold text-[var(--vscode-text-primary)] flex items-center gap-[var(--vscode-spacing-2)]">
            <span class="w-1 h-6 bg-[var(--vscode-accent-primary)] rounded-full" />
            最新文章
          </h2>
          
          <Button
            v-if="allPosts.length > 6"
            variant="ghost"
            size="sm"
            class="text-[var(--vscode-text-secondary)] hover:text-[var(--vscode-text-primary)]"
            @click="handleBrowsePosts"
          >
            查看全部
          </Button>
        </div>

        <!-- Loading State -->
        <div v-if="isLoading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[var(--vscode-spacing-6)]">
          <PostCardSkeleton v-for="i in 6" :key="i" />
        </div>

        <!-- Empty State -->
        <div 
          v-else-if="allPosts.length === 0"
          class="flex flex-col items-center justify-center py-[var(--vscode-spacing-16)] text-center"
        >
          <div class="w-24 h-24 mb-[var(--vscode-spacing-6)] rounded-full bg-[var(--vscode-bg-tertiary)] flex items-center justify-center">
            <FolderOpen class="w-12 h-12 text-[var(--vscode-text-muted)]" />
          </div>
          <h3 class="text-[var(--vscode-font-size-xl)] font-semibold text-[var(--vscode-text-primary)] mb-[var(--vscode-spacing-2)]">
            还没有文章
          </h3>
          <p class="text-[var(--vscode-font-size-base)] text-[var(--vscode-text-muted)] mb-[var(--vscode-spacing-6)] max-w-md">
            开始创建您的第一篇文章，记录您的想法和知识
          </p>
          <Button @click="handleNewPost" class="gap-2">
            <FilePlus class="w-4 h-4" />
            创建第一篇文章
          </Button>
        </div>

        <!-- Posts Grid -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[var(--vscode-spacing-6)]">
          <PostCard 
            v-for="post in recentPosts" 
            :key="post.id" 
            :post="post" 
          />
        </div>
      </section>
    </div>
  </Layout>
</template>
