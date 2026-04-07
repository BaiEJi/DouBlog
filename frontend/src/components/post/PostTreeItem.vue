<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, ChevronDown } from 'lucide-vue-next'
import type { PostTreeNode } from '@/types/post'

interface Props {
  node: PostTreeNode
  depth?: number
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0
})

const router = useRouter()
const isExpanded = ref(false)

const toggleExpand = () => {
  if (props.node.children.length > 0) {
    isExpanded.value = !isExpanded.value
  }
}

const navigateToPost = () => {
  router.push(`/post/${props.node.slug}`)
}
</script>

<template>
  <div class="post-tree-item">
    <div 
      class="flex items-center py-1 hover:bg-vscode-bg-secondary cursor-pointer"
      :class="`pl-${depth * 4}`"
      @click="navigateToPost"
    >
      <button 
        v-if="node.children.length > 0"
        @click.stop="toggleExpand"
        class="mr-1 p-0.5 hover:bg-vscode-bg-tertiary rounded"
      >
        <ChevronRight 
          v-if="!isExpanded" 
          class="w-4 h-4 text-vscode-text-secondary"
        />
        <ChevronDown 
          v-else 
          class="w-4 h-4 text-vscode-text-secondary"
        />
      </button>
      <span 
        v-else 
        class="w-5 mr-1"
      ></span>
      
      <span class="text-vscode-text-primary text-sm">
        {{ node.title }}
      </span>
    </div>
    
    <div v-if="isExpanded && node.children.length > 0">
      <PostTreeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
