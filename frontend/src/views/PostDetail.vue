<script setup lang="ts">
import { onMounted, computed, ref, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import MarkdownRenderer from '@/components/post/MarkdownRenderer.vue'
import PostDetailSkeleton from '@/components/post/PostDetailSkeleton.vue'
import { usePostStore } from '@/stores/post'
import { formatDate } from '@/utils/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { toast } from 'vue-sonner'
import { Clock, User, Calendar, Tag, Edit, Trash2, Share2, Home, Eye } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import type { Post } from '@/types/post'

const route = useRoute()
const router = useRouter()
const postStore = usePostStore()

const slug = computed(() => route.params.slug as string)
const currentPost = computed(() => postStore.currentPost)
const loading = computed(() => postStore.loading)

// Build breadcrumb items from post hierarchy
const breadcrumbItems = computed(() => {
  if (!currentPost.value) return []
  
  const items = []
  let post: Post | null = currentPost.value
  
  // Build path from current post to root
  while (post) {
    items.unshift({
      title: post.title,
      slug: post.slug,
      isCurrent: post === currentPost.value
    })
    post = post.parent
  }
  
  return items
})

// TOC state
const tocItems = ref<Array<{ id: string; text: string; level: number }>>([])
const activeTocId = ref<string>('')
const showToc = ref(true)

// IntersectionObserver for scroll spy
let observer: IntersectionObserver | null = null

// Delete dialog state
const showDeleteDialog = ref(false)

// Calculate reading time (200 words per minute)
const readingTime = computed(() => {
  if (!currentPost.value?.content) return 1
  const words = currentPost.value.content.split(/\s+/).length
  const minutes = Math.ceil(words / 200)
  return minutes
})

// Extract TOC from markdown content
const extractToc = (content: string) => {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm
  const items: Array<{ id: string; text: string; level: number }> = []
  let match

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length
    const text = match[2].trim()
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
    
    items.push({ id, text, level })
  }

  return items
}

// Scroll to heading with smooth behavior
const scrollToHeading = (id: string) => {
  const element = document.getElementById(id)
  if (element) {
    const headerOffset = 64 // Header height (h-16)
    const elementPosition = element.getBoundingClientRect().top
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    })
  }
}

// Setup IntersectionObserver for scroll spy
const setupScrollSpy = () => {
  if (observer) {
    observer.disconnect()
  }

  const headerHeight = 64
  const options: IntersectionObserverInit = {
    root: null,
    rootMargin: `-${headerHeight}px 0px -70% 0px`,
    threshold: 0
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        activeTocId.value = entry.target.id
      }
    })
  }, options)

  // Observe all heading elements
  tocItems.value.forEach((item) => {
    const element = document.getElementById(item.id)
    if (element && observer) {
      observer.observe(element)
    }
  })

  // Set initial active item
  if (tocItems.value.length > 0 && !activeTocId.value) {
    activeTocId.value = tocItems.value[0].id
  }
}

// Handle edit
const handleEdit = () => {
  if (currentPost.value) {
    router.push(`/post/${currentPost.value.slug}/edit`)
  }
}

// Handle delete
const handleDelete = async () => {
  if (!currentPost.value) return

  try {
    await postStore.deletePost(currentPost.value.slug)
    toast.success('文章已删除')
    router.push('/')
  } catch (error) {
    toast.error('删除失败，请重试')
    console.error('Delete failed:', error)
  } finally {
    showDeleteDialog.value = false
  }
}

// Handle share
const handleShare = async () => {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    toast.success('链接已复制到剪贴板')
  } catch (error) {
    toast.error('复制失败，请手动复制链接')
    console.error('Copy failed:', error)
  }
}

onMounted(() => {
  if (slug.value) {
    postStore.fetchPost(slug.value)
  }
})

// Watch for post content changes
watch(
  () => currentPost.value?.content,
  (content) => {
    if (content) {
      tocItems.value = extractToc(content)
      // Wait for DOM to update before setting up observer
      nextTick(() => {
        setupScrollSpy()
      })
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
})
</script>

<template>
  <Layout>
    <div class="max-w-7xl mx-auto px-6 py-8">
      <!-- Loading State -->
      <PostDetailSkeleton v-if="loading" />

      <!-- Content -->
      <div v-else-if="currentPost" class="flex gap-8">
        <!-- Main Content -->
        <div class="flex-1 min-w-0">
          <!-- Breadcrumb Navigation -->
          <Breadcrumb class="mb-6">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink as-child>
                  <router-link to="/" class="flex items-center gap-1.5">
                    <Home class="w-3.5 h-3.5" />
                    首页
                  </router-link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              
              <BreadcrumbSeparator v-if="breadcrumbItems.length > 0" />
              
              <BreadcrumbItem
                v-for="(item, index) in breadcrumbItems"
                :key="item.slug"
              >
                <template v-if="!item.isCurrent">
                  <BreadcrumbLink as-child>
                    <router-link :to="`/post/${item.slug}`">
                      {{ item.title }}
                    </router-link>
                  </BreadcrumbLink>
                  <BreadcrumbSeparator v-if="index < breadcrumbItems.length - 1" />
                </template>
                <template v-else>
                  <BreadcrumbPage>{{ item.title }}</BreadcrumbPage>
                </template>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <!-- Article Header -->
          <article class="mb-8">
            <!-- Title -->
            <h1 class="text-3xl md:text-4xl font-bold mb-6 text-vscode-text-primary leading-tight tracking-tight">
              {{ currentPost.title }}
            </h1>

            <!-- Meta Information -->
            <div class="flex flex-wrap items-center gap-4 text-sm text-vscode-text-secondary mb-6 pb-6 border-b border-vscode-border">
              <!-- Author -->
              <div class="flex items-center gap-2">
                <User class="w-4 h-4" />
                <span>{{ currentPost.author }}</span>
              </div>

              <!-- Created Date -->
              <div class="flex items-center gap-2">
                <Calendar class="w-4 h-4" />
                <span>{{ formatDate(currentPost.created_at) }}</span>
              </div>

              <!-- Reading Time -->
              <div class="flex items-center gap-2">
                <Clock class="w-4 h-4" />
                <span>{{ readingTime }} 分钟阅读</span>
              </div>

               <!-- View Count -->
               <div class="flex items-center gap-2">
                <Eye class="w-4 h-4" />
                <span>{{ currentPost.view_count }} 次浏览</span>
              </div>
            </div>

            <!-- Tags -->
            <div v-if="currentPost.tags && currentPost.tags.length > 0" class="flex flex-wrap gap-2 mb-6">
              <Badge
                v-for="tag in currentPost.tags"
                :key="tag"
                variant="outline"
                class="gap-1.5"
              >
                <Tag class="w-3 h-3" />
                {{ tag }}
              </Badge>
            </div>
          </article>

          <!-- Markdown Content -->
          <div class="markdown-content">
            <MarkdownRenderer :content="currentPost.content" />
          </div>

          <!-- Article Footer Actions -->
          <footer class="mt-12 pt-8 border-t border-vscode-border">
            <div class="flex items-center gap-3">
              <Button
                @click="handleEdit"
                variant="default"
                class="flex items-center gap-2"
              >
                <Edit class="w-4 h-4" />
                编辑
              </Button>

              <Button
                @click="showDeleteDialog = true"
                variant="destructive"
                class="flex items-center gap-2"
              >
                <Trash2 class="w-4 h-4" />
                删除
              </Button>

              <Button
                @click="handleShare"
                variant="outline"
                class="flex items-center gap-2"
              >
                <Share2 class="w-4 h-4" />
                分享
              </Button>
            </div>
          </footer>
        </div>

        <!-- TOC Sidebar -->
        <aside
          v-if="showToc && tocItems.length > 0"
          class="hidden md:block w-56 flex-shrink-0 lg:w-64"
        >
          <div class="sticky top-16 overflow-y-auto" style="max-height: calc(100vh - 4rem);">
            <nav class="bg-vscode-bg-secondary border border-vscode-border rounded-lg p-4">
              <h3 class="text-xs uppercase tracking-wider font-semibold text-vscode-text-muted mb-3">
                目录
              </h3>
              <ul class="flex flex-col gap-1">
                <li
                  v-for="item in tocItems"
                  :key="item.id"
                  :style="{ paddingLeft: item.level === 3 ? 'var(--vscode-spacing-4)' : '0' }"
                >
                  <button
                    @click="scrollToHeading(item.id)"
                    class="toc-item"
                    :class="{ 'toc-item-active': activeTocId === item.id }"
                    :title="item.text"
                  >
                    <span 
                      v-if="activeTocId === item.id"
                      class="toc-indicator"
                    ></span>
                    <span class="toc-text">{{ item.text }}</span>
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </aside>
      </div>

      <!-- Not Found -->
      <div v-else class="text-center py-12">
        <p class="text-vscode-text-secondary">文章不存在</p>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <Dialog v-model:open="showDeleteDialog">
      <DialogContent class="bg-vscode-bg-primary border-vscode-border">
        <DialogHeader>
          <DialogTitle class="text-vscode-text-primary">确认删除</DialogTitle>
          <DialogDescription class="text-vscode-text-secondary">
            确定要删除文章「{{ currentPost?.title }}」吗？此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            @click="showDeleteDialog = false"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            @click="handleDelete"
          >
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Layout>
</template>

<style scoped>
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  scroll-margin-top: 64px;
}

/* TOC Item Styles */
.toc-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-2);
  padding: var(--vscode-spacing-1-5) var(--vscode-spacing-2);
  border-radius: var(--vscode-radius-md);
  font-size: var(--vscode-font-size-sm);
  color: var(--vscode-text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: 
    color var(--vscode-duration-fast) var(--vscode-ease-in-out),
    background-color var(--vscode-duration-fast) var(--vscode-ease-in-out);
  text-align: left;
}

.toc-item:hover {
  color: var(--vscode-text-primary);
  background-color: var(--vscode-interactive-hover);
}

.toc-item-active {
  color: var(--vscode-accent-primary);
  background-color: var(--vscode-accent-primary-subtle);
  font-weight: var(--vscode-font-weight-medium);
}

.toc-item-active:hover {
  background-color: var(--vscode-accent-primary-subtle);
}

/* TOC Active Indicator */
.toc-indicator {
  width: 3px;
  height: calc(100% - 4px);
  min-height: 12px;
  background-color: var(--vscode-accent-primary);
  border-radius: var(--vscode-radius-full);
  flex-shrink: 0;
  position: absolute;
  left: 0;
  transition: 
    background-color var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.toc-item {
  position: relative;
}

/* TOC Text with truncation */
.toc-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  line-height: var(--vscode-line-height-normal);
}

/* Scrollbar styling for TOC container */
aside::-webkit-scrollbar {
  width: 4px;
}

aside::-webkit-scrollbar-track {
  background: transparent;
}

aside::-webkit-scrollbar-thumb {
  background: var(--vscode-border);
  border-radius: var(--vscode-radius-full);
}

aside::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-text-muted);
}
</style>
