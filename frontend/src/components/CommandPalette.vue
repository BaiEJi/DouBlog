<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePostStore } from '@/stores/post'
import type { PostTreeNode } from '@/types/post'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { FileText, FolderOpen } from 'lucide-vue-next'

const router = useRouter()
const postStore = usePostStore()

const open = ref(false)

// Flatten post tree to array for searching
const flattenPosts = (nodes: PostTreeNode[], result: PostTreeNode[] = []): PostTreeNode[] => {
  for (const node of nodes) {
    result.push(node)
    if (node.children && node.children.length > 0) {
      flattenPosts(node.children, result)
    }
  }
  return result
}

const allPosts = computed(() => {
  return flattenPosts(postStore.postTree)
})

// Toggle command palette
const toggleCommandPalette = () => {
  open.value = !open.value
}

// Keyboard shortcut handler
const handleKeyDown = (event: KeyboardEvent) => {
  // Cmd+K on Mac, Ctrl+K on Windows/Linux
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault()
    toggleCommandPalette()
  }
  
  // Escape to close
  if (event.key === 'Escape' && open.value) {
    open.value = false
  }
}

// Navigate to post
const handleSelect = (slug: string) => {
  open.value = false
  router.push(`/post/${slug}`)
}

// Get post summary for display
const getPostSummary = (post: PostTreeNode): string => {
  if (post.summary) {
    return post.summary.length > 60 ? post.summary.substring(0, 60) + '...' : post.summary
  }
  return ''
}

// Register keyboard listener
onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})

// Expose for parent components
defineExpose({
  toggleCommandPalette
})
</script>

<template>
  <CommandDialog
    v-model:open="open"
    title="Search Posts"
    description="Search and navigate to posts"
  >
    <CommandInput placeholder="Search posts by title or content..." />
    
    <CommandList>
      <CommandEmpty>No posts found.</CommandEmpty>
      
      <CommandGroup heading="Posts">
        <CommandItem
          v-for="post in allPosts"
          :key="post.id"
          :value="post.title"
          @select="handleSelect(post.slug)"
        >
          <div class="flex items-start gap-vscode-3 w-full">
            <component
              :is="post.children && post.children.length > 0 ? FolderOpen : FileText"
              class="size-4 mt-0.5 text-vscode-text-muted flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-vscode-2">
                <span 
                  class="text-vscode-text-primary truncate"
                  :style="{ paddingLeft: `${post.level * 12}px` }"
                >
                  {{ post.title }}
                </span>
                <span 
                  v-if="post.is_top" 
                  class="text-vscode-size-xs px-1.5 py-0.5 rounded-vscode-sm bg-vscode-accent-primary-subtle text-vscode-accent-primary"
                >
                  TOP
                </span>
              </div>
              <p 
                v-if="getPostSummary(post)"
                class="text-vscode-size-xs text-vscode-text-muted truncate mt-0.5"
                :style="{ paddingLeft: `${post.level * 12}px` }"
              >
                {{ getPostSummary(post) }}
              </p>
            </div>
          </div>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
