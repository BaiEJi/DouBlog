<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import Layout from '@/components/layout/Layout.vue'
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePostStore } from '@/stores/post'
import { toast } from 'vue-sonner'
import { FileText, X, Loader2 } from 'lucide-vue-next'
import type { PostTreeNode } from '@/types/post'

const router = useRouter()
const postStore = usePostStore()

const title = ref('')
const slug = ref('')
const content = ref('')
const status = ref<'published' | 'archived'>('published')
const parentId = ref<number | null>(null)
const isSubmitting = ref(false)

// Get all posts for parent selector
const allPosts = computed(() => {
  const flattenTree = (nodes: PostTreeNode[], level = 0): Array<{ id: number; title: string; level: number }> => {
    let result: Array<{ id: number; title: string; level: number }> = []
    nodes.forEach(node => {
      result.push({ id: node.id, title: node.title, level })
      if (node.children && node.children.length > 0) {
        result = result.concat(flattenTree(node.children, level + 1))
      }
    })
    return result
  }
  return flattenTree(postStore.postTree)
})

onMounted(() => {
  postStore.fetchPostTree()
})

// Auto-generate slug from title
const handleTitleInput = (value: string | number) => {
  title.value = String(value)
  if (!slug.value && value) {
    // Auto-generate slug: lowercase, replace spaces with hyphens, remove special chars
    slug.value = String(value)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
  }
}

const handleCreate = async () => {
  if (!title.value.trim() || !slug.value.trim() || !content.value.trim()) {
    toast.error('标题、别名和内容不能为空')
    return
  }

  isSubmitting.value = true
  
  try {
    const post = await postStore.createPost({
      title: title.value,
      slug: slug.value,
      content: content.value,
      status: status.value,
      parent_id: parentId.value
    })
    
    toast.success('文章创建成功')
    router.push(`/post/${post.slug}`)
  } catch (error: any) {
    const errorMessage = error?.response?.data?.message || '创建失败，请重试'
    toast.error(errorMessage)
    console.error('Failed to create post:', error)
  } finally {
    isSubmitting.value = false
  }
}

const handleCancel = () => {
  router.push('/')
}
</script>

<template>
  <Layout>
    <div class="flex flex-col h-full">
      <!-- Top Toolbar -->
      <div class="bg-vscode-bg-secondary border-b border-vscode-border px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <FileText class="w-5 h-5 text-vscode-accent-blue" />
          <h1 class="text-lg font-semibold text-vscode-text-primary">新建文章</h1>
        </div>

        <div class="flex items-center gap-3">
          <Button
            variant="outline"
            @click="handleCancel"
            :disabled="isSubmitting"
            class="flex items-center gap-2"
          >
            <X class="w-4 h-4" />
            取消
          </Button>
          <Button
            @click="handleCreate"
            :disabled="isSubmitting || !title.trim() || !slug.trim() || !content.trim()"
            class="flex items-center gap-2"
          >
            <Loader2 v-if="isSubmitting" class="w-4 h-4 animate-spin" />
            <FileText v-else class="w-4 h-4" />
            {{ isSubmitting ? '创建中...' : '创建文章' }}
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
                  :model-value="title"
                  @update:model-value="handleTitleInput"
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
                  别名 (Slug) <span class="text-vscode-text-error">*</span>
                </label>
                <Input
                  v-model="slug"
                  placeholder="输入文章别名（URL 路径）"
                  class="w-full"
                />
                <p class="text-xs text-vscode-text-muted mt-1">用于 URL 路径，只能包含字母、数字、中文和连字符</p>
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
