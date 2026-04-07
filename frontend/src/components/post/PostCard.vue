<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Card, CardContent } from '@/components/ui/card'
import type { Post } from '@/types/post'

interface Props {
  post: Post
}

const props = defineProps<Props>()
const router = useRouter()

const handleClick = () => {
  router.push(`/post/${props.post.slug}`)
}
</script>

<template>
  <Card
    class="cursor-pointer hover:border-accent-blue"
    @click="handleClick"
  >
    <CardContent>
      <h3 class="text-lg font-semibold text-vscode-text-primary mb-2">
        {{ post.title }}
      </h3>
      <p class="text-sm text-vscode-text-secondary mb-3 line-clamp-2">
        {{ post.summary }}
      </p>
      <div class="flex items-center justify-between text-xs text-vscode-text-muted">
        <span>{{ post.author }}</span>
        <span>{{ post.created_at }}</span>
      </div>
    </CardContent>
  </Card>
</template>
