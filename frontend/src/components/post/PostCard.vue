<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Eye, Clock } from 'lucide-vue-next'
import type { Post } from '@/types/post'

interface Props {
  post: Post
}

const props = defineProps<Props>()
const router = useRouter()

/**
 * 点击卡片跳转到文章详情
 */
const handleClick = () => {
  router.push(`/post/id/${props.post.id}`)
}

/**
 * 计算阅读时间（平均每分钟200字）
 */
const readingTime = computed(() => {
  const content = props.post.content || ''
  if (!content) return '< 1 分钟'
  const charCount = content.length
  const minutes = Math.ceil(charCount / 200)
  return minutes < 1 ? '1 分钟' : `${minutes} 分钟`
})

/**
 * 格式化日期为相对时间或格式化日期
 */
const formattedDate = computed(() => {
  if (!props.post.created_at) return ''
  const date = new Date(props.post.created_at)
  if (isNaN(date.getTime())) return ''
  
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
})
</script>

<template>
  <Card
    class="group cursor-pointer overflow-hidden"
    @click="handleClick"
  >
    <CardHeader class="pb-3">
      <div class="flex items-start justify-between gap-3">
        <CardTitle class="text-[var(--vscode-font-size-lg)] font-semibold leading-[var(--vscode-line-height-snug)] text-[var(--vscode-text-primary)] line-clamp-2 transition-colors group-hover:text-[var(--vscode-accent-primary)]">
          {{ post.title }}
        </CardTitle>
        <Badge
          v-if="post.is_top"
          variant="warning"
          class="shrink-0"
        >
          置顶
        </Badge>
      </div>
    </CardHeader>
    
    <CardContent class="pb-4">
      <CardDescription class="text-[var(--vscode-font-size-sm)] leading-[var(--vscode-line-height-relaxed)] text-[var(--vscode-text-secondary)] line-clamp-2 mb-4">
        {{ post.summary || '暂无摘要' }}
      </CardDescription>
      
      <!-- Tags -->
      <div v-if="post.tags && post.tags.length > 0" class="flex flex-wrap gap-2 mb-3">
        <Badge
          v-for="tag in post.tags.slice(0, 3)"
          :key="tag"
          variant="default"
          class="text-[var(--vscode-font-size-xs)]"
        >
          {{ tag }}
        </Badge>
        <span
          v-if="post.tags.length > 3"
          class="text-[var(--vscode-font-size-xs)] text-[var(--vscode-text-muted)]"
        >
          +{{ post.tags.length - 3 }}
        </span>
      </div>
    </CardContent>
    
    <CardFooter class="pt-3 border-t border-[var(--vscode-border-light)]">
      <div class="flex items-center justify-between w-full text-[var(--vscode-font-size-xs)] text-[var(--vscode-text-muted)]">
        <div class="flex items-center gap-4">
          <!-- Author -->
          <span class="flex items-center gap-1.5">
            <span class="font-medium text-[var(--vscode-text-secondary)]">{{ post.author }}</span>
          </span>
          
          <!-- View count -->
          <span class="flex items-center gap-1">
            <Eye class="w-3.5 h-3.5" />
            <span>{{ post.view_count }}</span>
          </span>
          
          <!-- Reading time -->
          <span class="flex items-center gap-1">
            <Clock class="w-3.5 h-3.5" />
            <span>{{ readingTime }}</span>
          </span>
        </div>
        
        <!-- Date -->
        <span>{{ formattedDate }}</span>
      </div>
    </CardFooter>
  </Card>
</template>
