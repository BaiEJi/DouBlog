<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { usePostStore } from '@/stores/post'
import PostTreeItem from './PostTreeItem.vue'
import SidebarSkeleton from '@/components/layout/SidebarSkeleton.vue'
import { SidebarMenu } from '@/components/ui/sidebar'

const postStore = usePostStore()

/**
 * 加载状态
 */
const loading = computed(() => postStore.treeLoading)

/**
 * 组件挂载时加载文章树
 */
onMounted(() => {
  if (postStore.postTree.length === 0) {
    postStore.fetchPostTree()
  }
})
</script>

<template>
  <SidebarMenu>
    <SidebarSkeleton v-if="loading" />
    <template v-else>
      <PostTreeItem
        v-for="node in postStore.postTree"
        :key="node.id"
        :node="node"
      />
      
      <div
        v-if="postStore.postTree.length === 0"
        class="flex flex-col items-center justify-center py-vscode-12 px-vscode-6 text-vscode-text-muted"
      >
        <svg
          class="w-16 h-16 mb-vscode-4 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span class="text-vscode-sm font-vscode-medium">No articles yet</span>
        <span class="text-vscode-xs text-vscode-text-muted mt-vscode-1">Create your first article to get started</span>
      </div>
    </template>
  </SidebarMenu>
</template>
