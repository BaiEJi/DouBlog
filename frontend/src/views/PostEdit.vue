<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePostStore } from '@/stores/post'
import { toast } from 'vue-sonner'
import { Save, X, Check, AlertCircle, Loader2 } from 'lucide-vue-next'
import type { PostTreeNode } from '@/types/post'

const route = useRoute()
const router = useRouter()
const postStore = usePostStore()

const slug = route.params.slug as string
const content = ref('')
const title = ref('')
const postSlug = ref('')
const status = ref<'published' | 'archived'>('published')
const parentId = ref<number | null>(null)

// Save status tracking
const saveStatus = ref<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
const lastSavedAt = ref<Date | null>(null)

// Get all posts for parent selector
const allPosts = computed(() => {
  const flattenTree = (nodes: PostTreeNode[], level = 0): Array<{ id: number; title: string; level: number }> => {
    let result: Array<{ id: number; title: string; level: number }> = []
    nodes.forEach(node => {
      if (node.slug !== slug) { // Exclude current post from parent options
        result.push({ id: node.id, title: node.title, level })
        if (node.children && node.children.length > 0) {
          result = result.concat(flattenTree(node.children, level + 1))
        }
      }
    })
    return result
  }
  return flattenTree(postStore.postTree)
})

onMounted(async () => {
  await Promise.all([
    postStore.fetchPost(slug),
    postStore.fetchPostTree()
  ])
  if (postStore.currentPost) {
    content.value = postStore.currentPost.content
    title.value = postStore.currentPost.title
    postSlug.value = postStore.currentPost.slug
    status.value = postStore.currentPost.status
    parentId.value = postStore.currentPost.parent_id
    lastSavedAt.value = new Date(postStore.currentPost.updated_at)
  }
})

// Track unsaved changes
watch([content, title, status, parentId], () => {
  if (postStore.currentPost) {
    const hasChanges = 
      content.value !== postStore.currentPost.content ||
      title.value !== postStore.currentPost.title ||
      status.value !== postStore.currentPost.status ||
      parentId.value !== postStore.currentPost.parent_id
    
    if (hasChanges) {
      saveStatus.value = 'unsaved'
    }
  }
})

const handleSave = async () => {
  if (!title.value.trim() || !content.value.trim()) {
    toast.error('标题和内容不能为空')
    return
  }

  saveStatus.value = 'saving'
  
  try {
    await postStore.updatePost(slug, {
      title: title.value,
      content: content.value,
      status: status.value,
      parent_id: parentId.value
    })
    
    saveStatus.value = 'saved'
    lastSavedAt.value = new Date()
    toast.success('文章已保存')
  } catch (error) {
    saveStatus.value = 'error'
    toast.error('保存失败，请重试')
    console.error('Failed to save post:', error)
  }
}

const handleCancel = () => {
  if (saveStatus.value === 'unsaved') {
    if (!confirm('有未保存的更改，确定要离开吗？')) {
      return
    }
  }
  router.push(`/post/${slug}`)
}

const formatLastSaved = (date: Date | null): string => {
  if (!date) return '未保存'
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  
  if (diff < 60) return '刚刚保存'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前保存`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前保存`
  return date.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <Layout>
    <div class="flex flex-col h-full">
      <!-- Top Toolbar -->
      <div class="bg-vscode-bg-secondary border-b border-vscode-border px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold text-vscode-text-primary">
            {{ postStore.currentPost?.title || '编辑文章' }}
          </h1>
          
          <!-- Save Status Indicator -->
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm">
            <template v-if="saveStatus === 'saved'">
              <Check class="w-4 h-4 text-vscode-text-success" />
              <span class="text-vscode-text-secondary">{{ formatLastSaved(lastSavedAt) }}</span>
            </template>
            <template v-else-if="saveStatus === 'saving'">
              <Loader2 class="w-4 h-4 animate-spin text-vscode-accent-blue" />
              <span class="text-vscode-text-secondary">保存中...</span>
            </template>
            <template v-else-if="saveStatus === 'unsaved'">
              <AlertCircle class="w-4 h-4 text-vscode-text-warning" />
              <span class="text-vscode-text-warning">未保存</span>
            </template>
            <template v-else-if="saveStatus === 'error'">
              <AlertCircle class="w-4 h-4 text-vscode-text-error" />
              <span class="text-vscode-text-error">保存失败</span>
            </template>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <Button
            variant="outline"
            @click="handleCancel"
            class="flex items-center gap-2"
          >
            <X class="w-4 h-4" />
            取消
          </Button>
          <Button
            @click="handleSave"
            :disabled="saveStatus === 'saving' || !title.trim() || !content.trim()"
            class="flex items-center gap-2"
          >
            <Save class="w-4 h-4" />
            {{ saveStatus === 'saving' ? '保存中...' : '保存' }}
          </Button>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="flex-1 overflow-auto">
        <div class="max-w-4xl mx-auto p-6 space-y-6">
          <!-- Metadata Section -->
          <div class="bg-vscode-bg-secondary border border-vscode-border rounded-vscode p-5 space-y-4">
            <h2 class="text-sm font-semibold text-vscode-text-primary uppercase tracking-wide">文章信息</h2>
            
            <!-- Title Input -->
            <div class="grid grid-cols-4 gap-4">
              <div class="col-span-3">
                <label class="block text-xs font-medium mb-1.5 text-vscode-text-secondary">
                  标题 <span class="text-vscode-text-error">*</span>
                </label>
                <Input
                  v-model="title"
                  placeholder="输入文章标题"
                  class="w-full"
                />
              </div>

              <!-- Status Selector -->
              <div>
                <label class="block text-xs font-medium mb-1.5 text-vscode-text-secondary">状态</label>
                <Select v-model="status">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published">已发布</SelectItem>
                    <SelectItem value="archived">已归档</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <!-- Slug and Parent Row -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium mb-1.5 text-vscode-text-secondary">
                  别名 (Slug)
                </label>
                <Input
                  :model-value="postSlug"
                  disabled
                  class="w-full bg-vscode-bg-tertiary cursor-not-allowed"
                />
                <p class="text-xs text-vscode-text-muted mt-1">别名不可修改</p>
              </div>

              <div>
                <label class="block text-xs font-medium mb-1.5 text-vscode-text-secondary">
                  父级文章
                </label>
                <Select v-model="parentId">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="无父级" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="null">无父级</SelectItem>
                    <SelectItem
                      v-for="post in allPosts"
                      :key="post.id"
                      :value="post.id"
                    >
                      {{ '　'.repeat(post.level) }}{{ post.title }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-xs text-vscode-text-muted mt-1">选择父级文章以创建层级结构</p>
              </div>
            </div>
          </div>

          <!-- Content Editor -->
          <div>
            <label class="block text-sm font-medium mb-2 text-vscode-text-primary">
              内容 <span class="text-vscode-text-error">*</span>
            </label>
            <MarkdownEditor v-model="content" />
          </div>
        </div>
      </div>
    </div>
  </Layout>
</template>
