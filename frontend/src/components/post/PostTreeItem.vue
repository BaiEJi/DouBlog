<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
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
const route = useRoute()
const isExpanded = ref(false)

const isActive = computed(() => {
  return route.params.slug === props.node.slug
})

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
      class="tree-node flex items-center py-1.5 px-2 cursor-pointer group relative transition-all duration-200 ease-smooth"
      :class="{ 
        'is-active': isActive,
        'has-children': node.children.length > 0 
      }"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="navigateToPost"
    >
      <!-- Active indicator (left border) -->
      <div 
        class="absolute left-0 top-0 bottom-0 w-0.5 bg-vscode-accent-blue opacity-0 group-hover:opacity-50 transition-opacity duration-150"
        :class="{ 'opacity-100': isActive }"
      />
      
      <!-- Expand/collapse button -->
      <button 
        v-if="node.children.length > 0"
        @click.stop="toggleExpand"
        class="expand-btn mr-1 p-0.5 rounded transition-all duration-200 hover:bg-vscode-bg-tertiary flex-shrink-0"
      >
        <ChevronRight 
          v-if="!isExpanded" 
          class="w-4 h-4 text-vscode-text-secondary transition-transform duration-200"
        />
        <ChevronDown 
          v-else 
          class="w-4 h-4 text-vscode-text-secondary transition-transform duration-200"
        />
      </button>
      <span 
        v-else 
        class="w-5 mr-1 flex-shrink-0"
      ></span>
      
      <!-- Node title -->
      <span class="text-sm truncate transition-colors duration-150"
        :class="isActive 
          ? 'text-vscode-accent-blue font-medium' 
          : 'text-vscode-text-primary group-hover:text-vscode-text-primary'"
      >
        {{ node.title }}
      </span>
    </div>
    
    <!-- Children with expand/collapse animation -->
    <Transition name="expand">
      <div v-if="isExpanded && node.children.length > 0" class="overflow-hidden">
        <PostTreeItem
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tree-node {
  position: relative;
  border-radius: 4px;
}

.tree-node:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.tree-node.is-active {
  background-color: rgba(0, 122, 204, 0.1);
}

.tree-node:active {
  transform: scale(0.98);
}

.expand-btn:active {
  transform: scale(0.9);
}

/* Expand/collapse animation */
.expand-enter-active,
.expand-leave-active {
  transition: all var(--duration-normal) var(--ease-smooth);
  max-height: 2000px;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

/* Chevron rotation animation */
.expand-btn svg {
  transition: transform var(--duration-fast) var(--ease-smooth);
}

/* Text color enhancement */
.tree-node.is-active span {
  color: var(--accent-blue);
}
</style>
