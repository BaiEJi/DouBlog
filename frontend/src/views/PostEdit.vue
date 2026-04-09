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

/**
 * 路由参数：文章ID
 */
const routeParamId = computed(() => {
  const id = route.params.id
  return id ? Number(id) : null
})

/**
 * 路由参数：文章别名
 */
const routeParamSlug = computed(() => route.params.slug as string | undefined)

/**
 * 文章内容
 */
const content = ref('')

/**
 * 文章标题
 */
const title = ref('')

/**
 * 文章别名（name字段）
 */
const postName = ref('')

/**
 * 原始别名（用于检测是否修改）
 */
const originalName = ref('')

/**
 * 文章状态
 */
const status = ref<'published' | 'archived'>('published')

/**
 * 父文章ID
 */
const parentId = ref<number | null>(null)

/**
 * 保存状态
 */
const saveStatus = ref<'saved' | 'saving' | 'unsaved' | 'error'>('saved')

/**
 * 最后保存时间
 */
const lastSavedAt = ref<Date | null>(null)

/**
 * 获取所有可选的父文章列表
 * 只允许层级小于2的文章作为父文章，并排除当前文章
 * 
 * @returns {Array<{ id: number; title: string; level: number }>} 可选的父文章列表
 */
const allPosts = computed(() => {
  const currentId = postStore.currentPost?.id
  const flattenTree = (nodes: PostTreeNode[], level = 0): Array<{ id: number; title: string; level: number }> => {
    let result: Array<{ id: number; title: string; level: number }> = []
    nodes.forEach(node => {
      if (node.id !== currentId) {
        result.push({ id: node.id, title: node.title, level })
        if (node.children && node.children.length > 0) {
          result = result.concat(flattenTree(node.children, level + 1))
        }
      }
    })
    return result
  }
  const all = flattenTree(postStore.postTree)
  return all.filter(post => post.level < 2)
})

/**
 * 当前文章ID
 */
const currentPostId = computed(() => postStore.currentPost?.id || null)

/**
 * 根据ID或别名加载文章数据
 */
const loadPostData = async () => {
  if (routeParamId.value) {
    await postStore.fetchPostById(routeParamId.value)
  } else if (routeParamSlug.value) {
    await postStore.fetchPostBySlug(routeParamSlug.value)
  }
}

onMounted(async () => {
  await postStore.fetchPostTree()
  try {
    await loadPostData()
    if (postStore.currentPost) {
      content.value = postStore.currentPost.content
      title.value = postStore.currentPost.title
      postName.value = postStore.currentPost.name || ''
      originalName.value = postStore.currentPost.name || ''
      status.value = postStore.currentPost.status
      parentId.value = postStore.currentPost.parent_id
      lastSavedAt.value = new Date(postStore.currentPost.updated_at)
    } else {
      toast.error('文章不存在或已被移动')
      router.push('/')
    }
  } catch {
    toast.error('文章不存在或已被移动')
    router.push('/')
  }
})

/**
 * 监听内容变化，标记为未保存
 */
watch([content, title, postName, status, parentId], () => {
  if (postStore.currentPost) {
    const hasChanges = 
      content.value !== postStore.currentPost.content ||
      title.value !== postStore.currentPost.title ||
      postName.value !== postStore.currentPost.name ||
      status.value !== postStore.currentPost.status ||
      parentId.value !== postStore.currentPost.parent_id
    
    if (hasChanges) {
      saveStatus.value = 'unsaved'
    }
  }
})

/**
 * 验证别名格式
 * 
 * @param {string} name - 别名
 * @returns {boolean} 是否有效
 */
const validateName = (name: string): boolean => {
  if (!name || name.length < 3 || name.length > 100) return false
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)
}

/**
 * 别名验证错误信息
 */
const nameError = computed(() => {
  if (!postName.value) return '别名不能为空'
  if (postName.value.length < 3) return '别名长度至少3个字符'
  if (postName.value.length > 100) return '别名长度不能超过100个字符'
  if (!/^[a-zA-Z]/.test(postName.value)) return '别名必须以英文字母开头'
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(postName.value)) return '别名只能包含英文字母、数字和连字符'
  return ''
})

/**
 * 保存文章
 */
const handleSave = async () => {
  if (!title.value.trim() || !content.value.trim()) {
    toast.error('标题和内容不能为空')
    return
  }

  if (!postName.value.trim()) {
    toast.error('别名不能为空')
    return
  }

  if (!validateName(postName.value)) {
    toast.error('别名格式无效：必须以英文字母开头，只允许英文、数字和连字符，长度3-100字符')
    return
  }

  if (!currentPostId.value) {
    toast.error('文章ID不存在')
    return
  }

  saveStatus.value = 'saving'
  
  try {
    const updatedPost = await postStore.updatePostById(currentPostId.value, {
      title: title.value,
      name: postName.value,
      content: content.value,
      status: status.value,
      parent_id: parentId.value
    })
    
    saveStatus.value = 'saved'
    lastSavedAt.value = new Date()
    originalName.value = updatedPost.name
    toast.success('文章已保存')
    
    // 如果别名被修改，更新URL到新的slug
    if (routeParamSlug.value && updatedPost.name !== routeParamSlug.value) {
      router.push(`/post/slug/${updatedPost.name}`)
    } else {
      router.push(`/post/id/${updatedPost.id}`)
    }
  } catch (error) {
    saveStatus.value = 'error'
    toast.error('保存失败，请重试')
    console.error('Failed to save post:', error)
  }
}

/**
 * 取消编辑并返回详情页
 */
const handleCancel = () => {
  if (saveStatus.value === 'unsaved') {
    if (!confirm('有未保存的更改，确定要离开吗？')) {
      return
    }
  }
  if (currentPostId.value) {
    router.push(`/post/id/${currentPostId.value}`)
  } else {
    router.push('/')
  }
}

/**
 * 格式化最后保存时间
 * 
 * @param {Date | null} date - 日期对象
 * @returns {string} 格式化的时间字符串
 */
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
      <header 
        class="flex items-center justify-between px-6 py-3 border-b"
        style="
          background-color: var(--vscode-bg-secondary);
          border-color: var(--vscode-border);
        "
      >
        <div class="flex items-center gap-4">
          <h1 
            class="font-semibold"
            style="
              font-size: var(--vscode-font-size-lg);
              color: var(--vscode-text-primary);
            "
          >
            {{ postStore.currentPost?.title || '编辑文章' }}
          </h1>
          
          <!-- Save Status Indicator -->
          <div 
            class="flex items-center gap-2 px-3 py-1.5 rounded-md"
            :style="{
              fontSize: 'var(--vscode-font-size-sm)',
              backgroundColor: saveStatus === 'unsaved' 
                ? 'var(--vscode-accent-warning-subtle)' 
                : saveStatus === 'error' 
                  ? 'var(--vscode-accent-error-subtle)'
                  : 'transparent'
            }"
          >
            <template v-if="saveStatus === 'saved'">
              <Check 
                class="w-4 h-4"
                style="color: var(--vscode-accent-success);"
              />
              <span style="color: var(--vscode-text-secondary);">{{ formatLastSaved(lastSavedAt) }}</span>
            </template>
            <template v-else-if="saveStatus === 'saving'">
              <Loader2 
                class="w-4 h-4 animate-spin"
                style="color: var(--vscode-accent-primary);"
              />
              <span style="color: var(--vscode-text-secondary);">保存中...</span>
            </template>
            <template v-else-if="saveStatus === 'unsaved'">
              <AlertCircle 
                class="w-4 h-4"
                style="color: var(--vscode-accent-warning);"
              />
              <span style="color: var(--vscode-accent-warning);">未保存</span>
            </template>
            <template v-else-if="saveStatus === 'error'">
              <AlertCircle 
                class="w-4 h-4"
                style="color: var(--vscode-accent-error);"
              />
              <span style="color: var(--vscode-accent-error);">保存失败</span>
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
                  v-model="title"
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

            <!-- Slug and Parent Row -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label 
                  class="block font-medium mb-1.5"
                  style="
                    font-size: var(--vscode-font-size-xs);
                    color: var(--vscode-text-secondary);
                  "
                >
                  别名 (Slug) <span style="color: var(--vscode-accent-error);">*</span>
                </label>
                <Input
                  v-model="postName"
                  placeholder="例如: my-article-title"
                  class="w-full"
                  :class="{ 'border-destructive': !!nameError }"
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
                  英文字母开头，只允许英文字母、数字和连字符
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
