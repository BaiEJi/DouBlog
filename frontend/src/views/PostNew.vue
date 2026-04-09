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
import { FileText, X, AlertCircle, Loader2 } from 'lucide-vue-next'
import type { PostTreeNode } from '@/types/post'

const router = useRouter()
const postStore = usePostStore()

/**
 * 文章标题
 */
const title = ref('')

/**
 * 文章英文名（用于URL）
 */
const name = ref('')

/**
 * 文章内容
 */
const content = ref('')

/**
 * 文章状态
 */
const status = ref<'published' | 'archived'>('published')

/**
 * 父文章ID
 */
const parentId = ref<number | null>(null)

/**
 * 提交状态
 */
const isSubmitting = ref(false)

/**
 * 获取所有可选的父文章列表
 * 只允许层级小于2的文章作为父文章
 * 
 * @returns {Array<{ id: number; title: string; level: number }>} 可选的父文章列表
 */
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
  const all = flattenTree(postStore.postTree)
  return all.filter(post => post.level < 2)
})

onMounted(() => {
  postStore.fetchPostTree()
})

/**
 * 验证英文名格式
 * 
 * @param {string} n - 英文名
 * @returns {boolean} 是否有效
 */
const validateName = (n: string): boolean => {
  if (!n || n.length < 3 || n.length > 100) return false
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(n)
}

/**
 * 英文名验证错误信息
 */
const nameError = computed(() => {
  if (!name.value) return '英文名不能为空'
  if (name.value.length < 3) return '英文名长度至少3个字符'
  if (name.value.length > 100) return '英文名长度不能超过100个字符'
  if (!/^[a-zA-Z]/.test(name.value)) return '英文名必须以英文字母开头'
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name.value)) return '英文名只能包含英文字母、数字和连字符'
  return ''
})

/**
 * 处理标题输入，自动生成英文名
 * 
 * @param {string | number} value - 输入的标题值
 */
const handleTitleInput = (value: string | number) => {
  title.value = String(value)
  if (!name.value && value) {
    name.value = String(value)
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^[^a-z]+/, '')
  }
}

/**
 * 创建新文章
 */
const handleCreate = async () => {
  if (!title.value.trim() || !name.value.trim() || !content.value.trim()) {
    toast.error('标题、英文名和内容不能为空')
    return
  }

  if (!validateName(name.value)) {
    toast.error('英文名格式无效：必须以英文字母开头，只允许英文、数字和连字符，长度3-100字符')
    return
  }

  isSubmitting.value = true
  
  try {
    const post = await postStore.createPost({
      title: title.value,
      name: name.value,
      content: content.value,
      status: status.value,
      parent_id: parentId.value
    })
    
    toast.success('文章创建成功')
    router.push(`/post/id/${post.id}`)
  } catch (error: any) {
    const errorMessage = error?.response?.data?.message || '创建失败，请重试'
    toast.error(errorMessage)
    console.error('Failed to create post:', error)
  } finally {
    isSubmitting.value = false
  }
}

/**
 * 取消创建并返回首页
 */
const handleCancel = () => {
  router.push('/')
}
</script>

<template>
  <Layout>
    <div class="flex flex-col h-full">
      <!-- Top Toolbar -->
      <header 
        class="flex items-center justify-between px-6 py-3 border-b"
        style="
          background-color: var(--vscode-bg-secondary);
          border-color: var(--vscode-border);
        "
      >
        <div class="flex items-center gap-3">
          <FileText 
            class="w-5 h-5"
            style="color: var(--vscode-accent-primary);"
          />
          <h1 
            class="font-semibold"
            style="
              font-size: var(--vscode-font-size-lg);
              color: var(--vscode-text-primary);
            "
          >
            新建文章
          </h1>
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
            :disabled="isSubmitting || !title.trim() || !name.trim() || !content.trim()"
            class="flex items-center gap-2"
          >
            <Loader2 v-if="isSubmitting" class="w-4 h-4 animate-spin" />
            <FileText v-else class="w-4 h-4" />
            {{ isSubmitting ? '创建中...' : '创建文章' }}
          </Button>
        </div>
      </header>

      <!-- Main Content Area -->
      <div class="flex-1 overflow-auto">
        <div 
          class="mx-auto p-6 space-y-6"
          style="max-width: var(--vscode-content-max-width);"
        >
          <!-- Metadata Section -->
          <section 
            class="p-5 space-y-4 border rounded-lg"
            style="
              background-color: var(--vscode-bg-secondary);
              border-color: var(--vscode-border);
            "
          >
            <h2 
              class="font-semibold uppercase tracking-wide"
              style="
                font-size: var(--vscode-font-size-xs);
                color: var(--vscode-text-primary);
                letter-spacing: var(--vscode-letter-spacing-wider);
              "
            >
              文章信息
            </h2>
            
            <!-- Title Input -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div class="md:col-span-3">
                <label 
                  class="block font-medium mb-1.5"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-secondary);
                  "
                >
                  标题 <span style="color: var(--vscode-accent-error);">*</span>
                </label>
                <Input
                  :model-value="title"
                  @update:model-value="handleTitleInput"
                  placeholder="输入文章标题"
                  class="w-full"
                  :class="{ 'border-destructive': !title.trim() && title !== '' }"
                />
                <p 
                  v-if="!title.trim() && title !== ''"
                  class="mt-1.5 flex items-center gap-1"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-accent-error);
                  "
                >
                  <AlertCircle class="w-3 h-3" />
                  标题不能为空
                </p>
              </div>

              <!-- Status Selector -->
              <div>
                <label 
                  class="block font-medium mb-1.5"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-secondary);
                  "
                >
                  状态
                </label>
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

            <!-- Name and Parent Row -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label 
                  class="block font-medium mb-1.5"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-secondary);
                  "
                >
                  英文名 (Name) <span style="color: var(--vscode-accent-error);">*</span>
                </label>
                <Input
                  v-model="name"
                  placeholder="输入英文名（URL 路径）"
                  class="w-full"
                  :class="{ 'border-destructive': !name.trim() && name !== '' }"
                />
                <p 
                  v-if="nameError"
                  class="mt-1.5 flex items-center gap-1"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-accent-error);
                  "
                >
                  <AlertCircle class="w-3 h-3" />
                  {{ nameError }}
                </p>
                <p 
                  v-else
                  class="mt-1"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-muted);
                  "
                >
                  英文字母开头，只允许英文字母、数字和连字符，用于URL访问
                </p>
              </div>

              <div>
                <label 
                  class="block font-medium mb-1.5"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-secondary);
                  "
                >
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
                <p 
                  class="mt-1"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-muted);
                  "
                >
                  选择父级文章以创建层级结构（最多3层：父-子-孙）
                </p>
              </div>
            </div>
          </section>

          <!-- Content Editor -->
          <section>
            <label 
              class="block font-medium mb-2"
              style="
                font-size: var(--vscode-font-size-sm);
                color: var(--vscode-text-primary);
              "
            >
              内容 <span style="color: var(--vscode-accent-error);">*</span>
            </label>
            <div 
              v-if="!content.trim() && content !== ''"
              class="mb-2 flex items-center gap-1"
              style="
                font-size: var(--vscode-font-size-xs);
                color: var(--vscode-accent-error);
              "
            >
              <AlertCircle class="w-3 h-3" />
              内容不能为空
            </div>
            <MarkdownEditor v-model="content" />
          </section>
        </div>
      </div>
    </div>
  </Layout>
</template>
