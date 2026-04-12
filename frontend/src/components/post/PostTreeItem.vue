<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ChevronRight, ChevronDown, FileText, FolderOpen, Folder } from 'lucide-vue-next'
import { SidebarMenuItem } from '@/components/ui/sidebar'
import { usePostStore } from '@/stores/post'
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
const postStore = usePostStore()

/**
 * 节点是否展开
 */
const isExpanded = computed(() => postStore.isNodeExpanded(props.node.id))

/**
 * 节点是否激活（当前路由）
 */
const isActive = computed(() => {
  const routeId = route.params.id as string
  const routeSlug = route.params.slug as string
  
  if (routeId) {
    return parseInt(routeId, 10) === props.node.id
  }
  
  if (routeSlug) {
    return routeSlug === props.node.name
  }
  
  return false
})

/**
 * 是否有子节点
 */
const hasChildren = computed(() => props.node.children.length > 0)

/**
 * 切换节点展开状态
 * 
 * @param {Event} event - 点击事件
 */
const toggleExpand = (event: Event) => {
  event.stopPropagation()
  if (hasChildren.value) {
    postStore.toggleNodeExpand(props.node.id)
  }
}

/**
 * 导航到文章详情
 */
const navigateToPost = () => {
  router.push(`/post/id/${props.node.id}`)
}

/**
 * 缩进样式
 */
const indentStyle = computed(() => ({
  paddingLeft: `${props.depth * 12 + 8}px`
}))
</script>

<template>
  <SidebarMenuItem>
    <div 
      class="tree-node relative flex items-center py-vscode-2 cursor-pointer group transition-all duration-vscode-normal ease-vscode-in-out w-full"
      :class="{ 
        'is-active': isActive,
      }"
      :style="indentStyle"
      @click="navigateToPost"
    >
      <div 
        class="absolute left-0 top-0 bottom-0 w-1 bg-vscode-accent-primary opacity-0 group-hover:opacity-40 transition-opacity duration-vscode-normal"
        :class="{ 'opacity-100': isActive }"
      />
      
      <button 
        v-if="hasChildren"
        @click="toggleExpand"
        class="expand-btn mr-vscode-2 p-1 rounded-vscode-md flex-shrink-0 transition-all duration-vscode-normal hover:bg-vscode-interactive-hover"
        :class="{ 'text-vscode-accent-primary': isExpanded }"
        :aria-label="isExpanded ? '收起子文章' : '展开子文章'"
        :aria-expanded="isExpanded"
      >
        <ChevronRight 
          v-if="!isExpanded" 
          class="w-5 h-5 text-vscode-text-secondary transition-transform duration-vscode-normal"
        />
        <ChevronDown 
          v-else 
          class="w-5 h-5 text-vscode-text-secondary transition-transform duration-vscode-normal"
        />
      </button>
      
      <component 
        :is="hasChildren ? (isExpanded ? FolderOpen : Folder) : FileText"
        class="w-5 h-5 mr-vscode-2 flex-shrink-0 transition-colors duration-vscode-normal"
        :class="isActive 
          ? 'text-vscode-accent-primary' 
          : 'text-vscode-text-muted group-hover:text-vscode-text-primary'"
      />
      
      <span 
        class="text-vscode-sm truncate transition-colors duration-vscode-normal"
        :class="isActive 
          ? 'text-vscode-accent-primary font-vscode-medium' 
          : 'text-vscode-text-primary group-hover:text-vscode-text-primary'"
      >
        {{ node.title }}
      </span>
      
      <span
        v-if="hasChildren"
        class="ml-auto text-vscode-xs text-vscode-text-muted px-vscode-2 py-0.5 rounded-vscode-sm bg-vscode-bg-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-vscode-normal"
      >
        {{ node.children.length }}
      </span>
    </div>
    
    <Transition name="expand">
      <div v-if="isExpanded && hasChildren" class="overflow-hidden">
        <PostTreeItem
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
        />
      </div>
    </Transition>
  </SidebarMenuItem>
</template>

<style scoped>
.tree-node {
  border-radius: var(--vscode-radius-md);
  transition: all var(--vscode-duration-normal) var(--vscode-ease-in-out);
}

.tree-node:hover {
  background-color: var(--vscode-interactive-hover);
  transform: translateX(var(--vscode-1));
}

.tree-node.is-active {
  background-color: var(--vscode-interactive-selected);
  box-shadow: inset 0 0 0 1px var(--vscode-accent-primary);
}

.tree-node:active {
  transform: scale(0.99);
}

.expand-btn:active {
  transform: scale(0.95);
}

.expand-enter-active,
.expand-leave-active {
  transition: all var(--vscode-duration-normal) var(--vscode-ease-in-out);
  max-height: 2000px;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.expand-btn svg {
  transition: transform var(--vscode-duration-normal) var(--vscode-ease-in-out);
}
</style>
