<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ThemeToggle from './ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { usePostStore } from '@/stores/post'
import { Button } from '@/components/ui/button'
import { ChevronRight } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const postStore = usePostStore()

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}

interface BreadcrumbItem {
  label: string
  path: string
}

const breadcrumbs = computed<BreadcrumbItem[]>(() => {
  const items: BreadcrumbItem[] = [{ label: 'Home', path: '/' }]
  
  // For post detail or edit pages
  if (route.name === 'PostDetail' || route.name === 'PostEdit') {
    const currentPost = postStore.currentPost
    if (currentPost) {
      // Build parent hierarchy
      const parentChain: BreadcrumbItem[] = []
      let post = currentPost.parent
      
      // Traverse up the parent chain
      while (post) {
        parentChain.unshift({
          label: post.title,
          path: `/post/${post.slug}`
        })
        post = post.parent
      }
      
      items.push(...parentChain)
      
      // Add current post
      if (route.name === 'PostDetail') {
        items.push({
          label: currentPost.title,
          path: `/post/${currentPost.slug}`
        })
      } else {
        // For edit page, show the post title then "Edit"
        items.push({
          label: currentPost.title,
          path: `/post/${currentPost.slug}`
        })
        items.push({
          label: 'Edit',
          path: `/post/${currentPost.slug}/edit`
        })
      }
    }
  } else if (route.name === 'PostNew') {
    items.push({ label: 'New Post', path: '/post/new' })
  }
  
  return items
})

const navigateTo = (path: string) => {
  router.push(path)
}
</script>

<template>
  <header class="flex items-center justify-between h-14 px-6 bg-vscode-bg-tertiary border-b border-vscode-border">
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <!-- Breadcrumbs -->
      <nav class="flex items-center gap-1.5 text-sm overflow-x-auto">
        <template v-for="(item, index) in breadcrumbs" :key="item.path">
          <button
            v-if="index < breadcrumbs.length - 1"
            @click="navigateTo(item.path)"
            class="text-vscode-text-secondary hover:text-vscode-text-primary transition-colors truncate max-w-[200px]"
          >
            {{ item.label }}
          </button>
          <span
            v-else
            class="text-vscode-text-primary font-medium truncate max-w-[200px]"
          >
            {{ item.label }}
          </span>
          <ChevronRight
            v-if="index < breadcrumbs.length - 1"
            class="w-4 h-4 text-vscode-text-muted flex-shrink-0"
          />
        </template>
      </nav>
    </div>

    <div class="flex items-center gap-4">
      <span
        v-if="authStore.username"
        class="text-sm text-vscode-text-secondary"
      >
        {{ authStore.username }}
      </span>

      <ThemeToggle />

      <Button
        variant="outline"
        size="default"
        @click="handleLogout"
      >
        Logout
      </Button>
    </div>
  </header>
</template>
