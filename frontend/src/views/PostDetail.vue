<script setup lang="ts">
import { onMounted, computed, ref, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
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
import { generateHeadingId } from '@/utils/heading'

/**
 * Markdown渲染器组件（异步加载）
 */
const MarkdownRenderer = defineAsyncComponent(() => 
  import('@/components/post/MarkdownRenderer.vue')
)

const route = useRoute()
const router = useRouter()
const postStore = usePostStore()

/**
 * 路由参数：文章ID
 */
const routeParamId = computed(() => route.params.id as string | undefined)

/**
 * 路由参数：文章别名
 */
const routeParamSlug = computed(() => route.params.slug as string | undefined)

/**
 * 当前文章详情
 */
const currentPost = computed(() => postStore.currentPost)

/**
 * 加载状态
 */
const loading = computed(() => postStore.postLoading)

/**
 * 面包屑导航项
 */
const breadcrumbItems = computed(() => {
  if (!currentPost.value) return []
  
  const items = []
  const currentNode = currentPost.value
  
  items.unshift({
    title: currentNode.title,
    id: currentNode.id,
    slug: currentNode.name,
    isCurrent: true
  })
  
  if (currentNode.parent) {
    items.unshift({
      title: currentNode.parent.title,
      id: currentNode.parent.id,
      slug: currentNode.parent.name,
      isCurrent: false
    })
  }
  
  return items
})

/**
 * 目录项列表
 */
const tocItems = ref<Array<{ id: string; text: string; level: number }>>([])

/**
 * 当前激活的目录ID
 */
const activeTocId = ref<string>('')

/**
 * 是否显示目录
 */
const showToc = ref(true)

/**
 * IntersectionObserver实例用于滚动监听
 */
let observer: IntersectionObserver | null = null

/**
 * 删除确认对话框显示状态
 */
const showDeleteDialog = ref(false)

/**
 * 计算阅读时间（分钟）
 * 
 * @returns {number} 阅读时间（分钟）
 */
const readingTime = computed(() => {
  if (!currentPost.value?.content) return 1
  const words = currentPost.value.content.split(/\s+/).length
  const minutes = Math.ceil(words / 200)
  return minutes
})

/**
 * 从Markdown内容中提取目录项
 * 
 * @param {string} content - Markdown内容
 * @returns {Array<{ id: string; text: string; level: number }>} 目录项数组
 */
const extractToc = (content: string) => {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm
  const items: Array<{ id: string; text: string; level: number }> = []
  let match

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length
    const text = match[2].trim()
    const id = generateHeadingId(text)
    
    items.push({ id, text, level })
  }

  return items
}

/**
 * 滚动到指定标题
 * 
 * @param {string} id - 标题元素ID
 */
const scrollToHeading = (id: string) => {
  const element = document.getElementById(id)
  const mainContent = document.querySelector('main')
  if (element && mainContent) {
    const headerOffset = 64
    const mainRect = mainContent.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const offsetPosition = elementRect.top - mainRect.top + mainContent.scrollTop - headerOffset

    mainContent.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    })
  }
}

/**
 * 设置滚动监听，用于高亮当前目录项
 */
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

  tocItems.value.forEach((item) => {
    const element = document.getElementById(item.id)
    if (element && observer) {
      observer.observe(element)
    }
  })

  if (tocItems.value.length > 0 && !activeTocId.value) {
    activeTocId.value = tocItems.value[0].id
  }
}

/**
 * 跳转到编辑页面
 */
const handleEdit = () => {
  if (currentPost.value) {
    router.push(`/post/id/${currentPost.value.id}/edit`)
  }
}

/**
 * 删除当前文章
 */
const handleDelete = async () => {
  if (!currentPost.value) return

  try {
    await postStore.deletePost(currentPost.value.id)
    toast.success('文章已删除')
    router.push('/')
  } catch (error) {
    toast.error('删除失败，请重试')
    console.error('Delete failed:', error)
  } finally {
    showDeleteDialog.value = false
  }
}

/**
 * 复制当前页面链接到剪贴板
 */
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

/**
 * 根据路由参数获取文章数据
 * 
 * @throws {Error} 当路由参数无效时抛出错误
 */
const fetchPostData = async () => {
  if (routeParamId.value) {
    const id = parseInt(routeParamId.value, 10)
    if (!isNaN(id)) {
      await postStore.fetchPostById(id)
      return
    }
  }
  
  if (routeParamSlug.value) {
    await postStore.fetchPostBySlug(routeParamSlug.value)
    return
  }
  
  throw new Error('No valid route parameter')
}

watch(
  () => [route.params.id, route.params.slug],
  async () => {
    try {
      await fetchPostData()
    } catch {
      toast.error('文章不存在或已被移动')
      router.push('/')
    }
  }
)

onMounted(async () => {
  try {
    await fetchPostData()
  } catch {
    toast.error('文章不存在或已被移动')
    router.push('/')
  }
})

watch(
  () => currentPost.value?.content,
  (content) => {
    if (content) {
      tocItems.value = extractToc(content)
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
    <div class="max-w-none mx-auto px-8 py-8">
      <Transition name="fade" mode="out-in">
        <PostDetailSkeleton v-if="loading" key="skeleton" />

        <div v-else-if="currentPost" key="content" class="flex gap-8">
        <div class="flex-1 min-w-0">
          <!-- 面包屑导航 + 元信息 -->
          <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink as-child>
                    <router-link to="/" class="flex items-center gap-1.5 text-vscode-text-secondary hover:text-vscode-text-primary transition-colors">
                      <Home class="w-3.5 h-3.5" />
                      首页
                    </router-link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                
                <BreadcrumbSeparator v-if="breadcrumbItems.length > 0" class="text-vscode-border">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </BreadcrumbSeparator>
                
                <BreadcrumbItem
                  v-for="(item, index) in breadcrumbItems"
                  :key="item.id"
                >
                  <template v-if="!item.isCurrent">
                    <BreadcrumbLink as-child>
                      <router-link :to="`/post/id/${item.id}`" class="text-vscode-text-secondary hover:text-vscode-text-primary transition-colors">
                        {{ item.title }}
                      </router-link>
                    </BreadcrumbLink>
                    <BreadcrumbSeparator v-if="index < breadcrumbItems.length - 1" class="text-vscode-border">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </BreadcrumbSeparator>
                  </template>
                  <template v-else>
                    <BreadcrumbPage class="text-vscode-text-primary font-medium">{{ item.title }}</BreadcrumbPage>
                  </template>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <!-- 元信息放在右侧 -->
            <div class="flex flex-wrap items-center gap-3 text-xs text-vscode-text-muted">
              <div class="flex items-center gap-1.5 bg-vscode-bg-tertiary px-2 py-1 rounded-full">
                <User class="w-3.5 h-3.5" />
                <span>{{ currentPost.author }}</span>
              </div>

              <div class="flex items-center gap-1.5 bg-vscode-bg-tertiary px-2 py-1 rounded-full">
                <Calendar class="w-3.5 h-3.5" />
                <span>{{ formatDate(currentPost.created_at) }}</span>
              </div>

              <div class="flex items-center gap-1.5 bg-vscode-bg-tertiary px-2 py-1 rounded-full">
                <Clock class="w-3.5 h-3.5" />
                <span>{{ readingTime }} 分钟</span>
              </div>

              <div class="flex items-center gap-1.5 bg-vscode-bg-tertiary px-2 py-1 rounded-full">
                <Eye class="w-3.5 h-3.5" />
                <span>{{ currentPost.view_count }}</span>
              </div>
            </div>
          </div>

          <article class="mb-8">
            <h1 class="text-4xl font-bold text-vscode-text-primary mb-4 leading-tight" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;">
              {{ currentPost.title }}
            </h1>
            
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

          <div class="markdown-content prose prose-lg max-w-none" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.8; color: var(--vscode-text-primary);">
            <MarkdownRenderer :content="currentPost.content" />
          </div>

          <footer class="mt-12 pt-8 border-t border-vscode-border">
            <div class="flex items-center gap-3">
              <Button
                @click="handleEdit"
                variant="ghost"
                class="flex items-center gap-2 text-vscode-text-secondary hover:text-vscode-text-primary hover:bg-vscode-bg-hover"
              >
                <Edit class="w-4 h-4" />
                编辑
              </Button>
              
              <Button
                @click="handleShare"
                variant="ghost"
                class="flex items-center gap-2 text-vscode-text-secondary hover:text-vscode-text-primary hover:bg-vscode-bg-hover"
              >
                <Share2 class="w-4 h-4" />
                分享
              </Button>
              
              <Button
                @click="showDeleteDialog = true"
                variant="destructive"
                class="flex items-center gap-2"
              >
                <Trash2 class="w-4 h-4" />
                删除
              </Button>
            </div>
          </footer>
        </div>

        <aside
          v-if="showToc"
          class="hidden md:block w-56 flex-shrink-0 lg:w-64"
        >
          <div class="sticky top-16 overflow-y-auto" style="max-height: calc(100vh - 4rem);">
            <!-- 编辑和分享按钮 -->
            <div class="flex items-center gap-2 mb-3">
              <Button
                @click="handleEdit"
                variant="ghost"
                size="sm"
                class="flex items-center gap-1.5 h-7 text-xs text-vscode-text-secondary hover:text-vscode-text-primary hover:bg-vscode-bg-hover"
              >
                <Edit class="w-3 h-3" />
                编辑
              </Button>

              <Button
                @click="handleShare"
                variant="ghost"
                size="sm"
                class="flex items-center gap-1.5 h-7 text-xs text-vscode-text-secondary hover:text-vscode-text-primary hover:bg-vscode-bg-hover"
              >
                <Share2 class="w-3 h-3" />
                分享
              </Button>
            </div>

            <nav class="bg-vscode-bg-secondary border border-vscode-border rounded-lg p-4 shadow-lg">
              <h3 class="text-xs uppercase tracking-wider font-semibold text-vscode-text-muted mb-3">
                目录
              </h3>
              <template v-if="tocItems.length > 0">
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
              </template>
              <div v-else class="flex flex-col items-center justify-center py-6 text-vscode-text-muted">
                <svg class="w-6 h-6 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 10h16M4 14h10M4 18h7" />
                </svg>
                <span class="text-vscode-xs">暂无目录</span>
              </div>
            </nav>
          </div>
        </aside>
      </div>

      <div v-else key="not-found" class="text-center py-12">
        <p class="text-vscode-text-secondary">文章不存在</p>
      </div>
      </Transition>
    </div>

    <Dialog v-model:open="showDeleteDialog">
      <DialogContent class="bg-vscode-bg-primary border-vscode-border">
        <DialogHeader>
          <DialogTitle class="text-vscode-text-primary text-lg font-semibold">确认删除</DialogTitle>
          <DialogDescription class="text-vscode-text-secondary">
            确定要删除文章「{{ currentPost?.title }}」吗？此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            class="text-vscode-text-secondary hover:text-vscode-text-primary hover:bg-vscode-bg-hover"
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
  scroll-margin-top: 80px;
}

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
  box-shadow: inset 0 0 0 1px var(--vscode-accent-primary);
}

.toc-item-active:hover {
  background-color: var(--vscode-accent-primary-subtle);
}

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

.toc-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  line-height: var(--vscode-line-height-normal);
}

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

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.prose {
  max-width: none;
}

.prose :deep(h1) {
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1.25;
  margin-top: 2rem;
  margin-bottom: 1rem;
}

.prose :deep(h2) {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.25;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}

.prose :deep(h3) {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.25;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}

.prose :deep(p) {
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.prose :deep(ul),
.prose :deep(ol) {
  margin-top: 1rem;
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.prose :deep(li) {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

.prose :deep(blockquote) {
  font-style: italic;
  border-left: 4px solid var(--vscode-accent-primary);
  margin: 1.5rem 0;
  padding-left: 1rem;
  color: var(--vscode-text-secondary);
}

.prose :deep(code) {
  font-family: 'Geist Mono', monospace;
  background-color: var(--vscode-bg-code);
  border-radius: var(--vscode-radius-sm);
  padding: 0.2rem 0.4rem;
  font-size: 0.9em;
}

.prose :deep(pre) {
  font-family: 'Geist Mono', monospace;
  background-color: var(--vscode-bg-code);
  border-radius: var(--vscode-radius-md);
  padding: 1rem;
  overflow-x: auto;
  margin: 1.5rem 0;
}

.prose :deep(pre code) {
  font-family: inherit;
  background: none;
  padding: 0;
  color: inherit;
}

.prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5rem 0;
}

.prose :deep(th),
.prose :deep(td) {
  padding: 0.5rem 1rem;
  text-align: left;
  border: 1px solid var(--vscode-border);
}

.prose :deep(th) {
  background-color: var(--vscode-bg-secondary);
  font-weight: 600;
}

.prose :deep(a) {
  color: var(--vscode-accent-primary);
  text-decoration: none;
  transition: color var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.prose :deep(a:hover) {
  text-decoration: underline;
}

.prose :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--vscode-radius-md);
  margin: 1rem 0;
}

.prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--vscode-border);
  margin: 2rem 0;
}
</style>
