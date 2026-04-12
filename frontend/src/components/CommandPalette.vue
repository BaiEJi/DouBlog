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
    class="cmd-palette-dialog"
  >
    <div class="cmd-search-area">
      <div class="cmd-search-inner">
        <svg class="cmd-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <CommandInput placeholder="Search posts..." class="cmd-input" />
        <kbd class="cmd-kbd-hint">ESC</kbd>
      </div>
    </div>

    <CommandList class="cmd-list">
      <CommandEmpty>
        <div class="cmd-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="cmd-empty-icon">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M8 11h6" />
          </svg>
          <p class="cmd-empty-text">No results found</p>
          <p class="cmd-empty-sub">Try a different search term</p>
        </div>
      </CommandEmpty>
      
      <CommandGroup heading="Posts" class="cmd-group">
        <CommandItem
          v-for="post in allPosts"
          :key="post.id"
          :value="post.title"
          @select="handleSelect(post.slug)"
          class="cmd-item"
        >
          <div class="cmd-item-content">
            <div class="cmd-item-icon-wrap">
              <component
                :is="post.children && post.children.length > 0 ? FolderOpen : FileText"
                class="cmd-item-icon"
              />
            </div>
            <div class="cmd-item-body">
              <div class="cmd-item-header">
                <span 
                  class="cmd-item-title"
                  :style="{ paddingLeft: `${post.level * 16}px` }"
                >
                  {{ post.title }}
                </span>
                <span 
                  v-if="post.is_top" 
                  class="cmd-item-badge"
                >
                  TOP
                </span>
              </div>
              <p 
                v-if="getPostSummary(post)"
                class="cmd-item-summary"
                :style="{ paddingLeft: `${post.level * 16}px` }"
              >
                {{ getPostSummary(post) }}
              </p>
            </div>
            <svg class="cmd-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </div>
        </CommandItem>
      </CommandGroup>
    </CommandList>

    <div class="cmd-footer">
      <div class="cmd-footer-group">
        <span class="cmd-footer-hint">
          <kbd>↑</kbd><kbd>↓</kbd> navigate
        </span>
        <span class="cmd-footer-hint">
          <kbd>↵</kbd> open
        </span>
        <span class="cmd-footer-hint">
          <kbd>esc</kbd> close
        </span>
      </div>
    </div>
  </CommandDialog>
</template>

<style scoped>
/* ========================================
   Command Palette — Vercel/Linear Aesthetic
   Clean, minimal, precise.
   ======================================== */

/* Dialog shell overrides */
.cmd-palette-dialog {
  border-radius: var(--vscode-radius-xl) !important;
  border: 1px solid var(--vscode-border) !important;
  box-shadow:
    var(--vscode-shadow-2xl),
    0 0 0 1px var(--vscode-border) !important;
  background: var(--vscode-bg-elevated) !important;
  overflow: hidden !important;
  animation: cmdPaletteIn var(--vscode-duration-fast) var(--vscode-ease-out) forwards;
}

@keyframes cmdPaletteIn {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(-8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Override overlay for backdrop blur */
:deep(.fixed.inset-0) {
  backdrop-filter: blur(8px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(8px) saturate(180%) !important;
}

/* Search area */
.cmd-search-area {
  border-bottom: 1px solid var(--vscode-border);
}

.cmd-search-inner {
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-3);
  padding: var(--vscode-spacing-4) var(--vscode-spacing-4);
}

.cmd-search-icon {
  flex-shrink: 0;
  color: var(--vscode-text-muted);
}

.cmd-input {
  flex: 1;
  height: 44px !important;
  font-size: var(--vscode-font-size-base) !important;
  font-weight: var(--vscode-font-weight-medium) !important;
  color: var(--vscode-text-primary) !important;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  letter-spacing: var(--vscode-letter-spacing-tight);
}

.cmd-input::placeholder {
  color: var(--vscode-text-muted) !important;
  font-weight: var(--vscode-font-weight-normal) !important;
}

.cmd-kbd-hint {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 24px;
  padding: 0 var(--vscode-spacing-2);
  border-radius: var(--vscode-radius-md);
  border: 1px solid var(--vscode-border);
  background: var(--vscode-bg-tertiary);
  color: var(--vscode-text-muted);
  font-family: var(--vscode-font-sans);
  font-size: var(--vscode-font-size-xs);
  font-weight: var(--vscode-font-weight-medium);
  line-height: 1;
  letter-spacing: 0.02em;
}

/* List area */
.cmd-list {
  max-height: 420px !important;
  padding: var(--vscode-spacing-2) 0 !important;
}

/* Group heading */
.cmd-group :deep([data-slot="command-group-heading"]) {
  padding: var(--vscode-spacing-2) var(--vscode-spacing-4) !important;
  font-size: var(--vscode-font-size-xs) !important;
  font-weight: var(--vscode-font-weight-semibold) !important;
  text-transform: uppercase !important;
  letter-spacing: var(--vscode-letter-spacing-wider) !important;
  color: var(--vscode-text-muted) !important;
}

/* Item */
.cmd-item {
  margin: 1px var(--vscode-spacing-2) !important;
  border-radius: var(--vscode-radius-lg) !important;
  transition:
    background-color var(--vscode-duration-fast) var(--vscode-ease-in-out),
    color var(--vscode-duration-fast) var(--vscode-ease-in-out) !important;
}

.cmd-item :deep(.cmd-item-content) {
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-3);
  width: 100%;
  padding: var(--vscode-spacing-2) var(--vscode-spacing-3);
}

.cmd-item-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--vscode-radius-md);
  background: var(--vscode-bg-tertiary);
  border: 1px solid var(--vscode-border-light);
  flex-shrink: 0;
  transition:
    background-color var(--vscode-duration-fast) var(--vscode-ease-in-out),
    border-color var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.cmd-item[data-highlighted="true"] .cmd-item-icon-wrap,
.cmd-item :deep([data-highlighted]) .cmd-item-icon-wrap {
  background: var(--vscode-accent-primary-subtle);
  border-color: var(--vscode-accent-primary);
}

.cmd-item-icon {
  width: 14px !important;
  height: 14px !important;
  color: var(--vscode-text-muted);
}

.cmd-item[data-highlighted="true"] .cmd-item-icon,
.cmd-item :deep([data-highlighted]) .cmd-item-icon {
  color: var(--vscode-accent-primary);
}

.cmd-item-body {
  flex: 1;
  min-width: 0;
}

.cmd-item-header {
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-2);
}

.cmd-item-title {
  font-size: var(--vscode-font-size-sm);
  font-weight: var(--vscode-font-weight-medium);
  color: var(--vscode-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-item-summary {
  font-size: var(--vscode-font-size-xs);
  color: var(--vscode-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.cmd-item-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 var(--vscode-spacing-1-5);
  border-radius: var(--vscode-radius-full);
  background: var(--vscode-accent-primary-subtle);
  color: var(--vscode-accent-primary);
  font-size: 10px;
  font-weight: var(--vscode-font-weight-semibold);
  letter-spacing: var(--vscode-letter-spacing-wide);
  text-transform: uppercase;
  flex-shrink: 0;
}

.cmd-item-arrow {
  flex-shrink: 0;
  color: var(--vscode-text-disabled);
  opacity: 0;
  transition: opacity var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.cmd-item :deep([data-highlighted]) .cmd-item-arrow,
.cmd-item[data-highlighted="true"] .cmd-item-arrow {
  opacity: 1;
  color: var(--vscode-text-muted);
}

/* Highlighted state override — Vercel-style subtle highlight */
.cmd-item :deep([data-highlighted]),
.cmd-item[data-highlighted="true"] {
  background: var(--vscode-interactive-hover) !important;
}

.cmd-item :deep([data-highlighted]) .cmd-item-title,
.cmd-item[data-highlighted="true"] .cmd-item-title {
  color: var(--vscode-text-primary);
}

/* Empty state */
.cmd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--vscode-spacing-10) var(--vscode-spacing-4);
  gap: var(--vscode-spacing-2);
}

.cmd-empty-icon {
  color: var(--vscode-text-disabled);
  margin-bottom: var(--vscode-spacing-2);
}

.cmd-empty-text {
  font-size: var(--vscode-font-size-sm);
  font-weight: var(--vscode-font-weight-medium);
  color: var(--vscode-text-secondary);
}

.cmd-empty-sub {
  font-size: var(--vscode-font-size-xs);
  color: var(--vscode-text-muted);
}

/* Footer with keyboard hints */
.cmd-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--vscode-spacing-2) var(--vscode-spacing-4);
  border-top: 1px solid var(--vscode-border);
  background: var(--vscode-bg-tertiary);
}

.cmd-footer-group {
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-4);
}

.cmd-footer-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-text-disabled);
}

.cmd-footer-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--vscode-radius-sm);
  border: 1px solid var(--vscode-border);
  background: var(--vscode-bg-secondary);
  color: var(--vscode-text-muted);
  font-family: var(--vscode-font-sans);
  font-size: 10px;
  font-weight: var(--vscode-font-weight-medium);
  line-height: 1;
}

/* Custom scrollbar for the results list */
.cmd-list :deep(::-webkit-scrollbar) {
  width: 6px;
}

.cmd-list :deep(::-webkit-scrollbar-track) {
  background: transparent;
}

.cmd-list :deep(::-webkit-scrollbar-thumb) {
  background: var(--vscode-border);
  border-radius: var(--vscode-radius-full);
}

.cmd-list :deep(::-webkit-scrollbar-thumb:hover) {
  background: var(--vscode-text-muted);
}
</style>
