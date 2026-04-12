<script setup lang="ts">
import { ref, onMounted } from 'vue'

const MIN_WIDTH = 180
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 272
const STORAGE_KEY = 'sidebar-width'

const isResizing = ref(false)
const currentWidth = ref(DEFAULT_WIDTH)

const setWidth = (width: number) => {
  currentWidth.value = width
  const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]')
  if (wrapper) {
    ;(wrapper as HTMLElement).style.setProperty('--sidebar-width', `${width}px`)
  }
}

const startResize = (e: MouseEvent) => {
  e.preventDefault()
  isResizing.value = true

  const startX = e.clientX
  const startWidth = currentWidth.value

  document.documentElement.classList.add('sidebar-resizing')
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const onMouseMove = (e: MouseEvent) => {
    const delta = e.clientX - startX
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
    setWidth(newWidth)
  }

  const onMouseUp = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)

    document.documentElement.classList.remove('sidebar-resizing')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // Persist: update the root variable so it survives route changes
    document.documentElement.style.setProperty('--vscode-sidebar-width', `${currentWidth.value}px`)
    localStorage.setItem(STORAGE_KEY, String(currentWidth.value))
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

onMounted(() => {
  const savedWidth = localStorage.getItem(STORAGE_KEY)
  if (savedWidth) {
    const width = Number(savedWidth)
    if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
      currentWidth.value = width
      document.documentElement.style.setProperty('--vscode-sidebar-width', `${width}px`)
    }
  }
})
</script>

<template>
  <div
    class="sidebar-resize-handle"
    :class="{ resizing: isResizing }"
    @mousedown="startResize"
    role="separator"
    aria-orientation="vertical"
    aria-label="调整侧边栏宽度"
    :aria-valuenow="currentWidth"
    :aria-valuemin="MIN_WIDTH"
    :aria-valuemax="MAX_WIDTH"
    tabindex="0"
  />
</template>

<style scoped>
.sidebar-resize-handle {
  position: absolute;
  right: -1px;
  top: 0;
  bottom: 0;
  width: 3px;
  cursor: col-resize;
  z-index: 50;
  background-color: transparent;
  transition: all var(--vscode-duration-normal) var(--vscode-ease-in-out);
}

.sidebar-resize-handle:hover {
  background-color: var(--vscode-accent-primary);
  opacity: 0.3;
  width: 4px;
  box-shadow: 0 0 0 1px var(--vscode-accent-primary);
}

.sidebar-resize-handle.resizing {
  background-color: var(--vscode-accent-primary);
  opacity: 0.5;
  width: 4px;
  box-shadow: 0 0 0 2px var(--vscode-accent-primary);
}
</style>

<!-- Disable ALL transitions during drag for instant response -->
<style>
html.sidebar-resizing,
html.sidebar-resizing *,
html.sidebar-resizing *::before,
html.sidebar-resizing *::after {
  transition: none !important;
  animation: none !important;
}
</style>
