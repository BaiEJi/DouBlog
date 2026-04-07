<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { useThemeStore } from '@/stores/theme'

defineProps<{
  content: string
}>()

const themeStore = useThemeStore()
const theme = computed(() => themeStore.isDark ? 'dark' : 'light')

const copyToClipboard = async (text: string, button: HTMLButtonElement): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    const originalText = button.textContent
    button.textContent = 'Copied!'
    button.classList.add('copied')
    setTimeout(() => {
      button.textContent = originalText
      button.classList.remove('copied')
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const addCopyButtons = () => {
  setTimeout(() => {
    const codeBlocks = document.querySelectorAll('.md-preview pre')
    codeBlocks.forEach((pre) => {
      const preElement = pre as HTMLElement
      // Skip if button already exists
      if (preElement.querySelector('.copy-button')) return

      const code = preElement.querySelector('code')
      if (!code) return

      const button = document.createElement('button') as HTMLButtonElement
      button.className = 'copy-button'
      button.textContent = 'Copy'
      button.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        padding: 4px 12px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 12px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s, background-color 0.2s;
        z-index: 10;
      `
      
      button.addEventListener('click', () => {
        copyToClipboard(code.textContent || '', button)
      })
      
      button.addEventListener('mouseenter', () => {
        button.style.background = 'var(--accent-blue)'
        button.style.color = '#ffffff'
      })
      
      button.addEventListener('mouseleave', () => {
        if (!button.classList.contains('copied')) {
          button.style.background = 'var(--bg-tertiary)'
          button.style.color = 'var(--text-primary)'
        }
      })
      
      // Make pre position relative for button positioning
      preElement.style.position = 'relative'

      // Show button on hover
      preElement.addEventListener('mouseenter', () => {
        button.style.opacity = '1'
      })

      preElement.addEventListener('mouseleave', () => {
        button.style.opacity = '0'
      })

      preElement.appendChild(button)
    })
  }, 100)
}

onMounted(() => {
  addCopyButtons()
})

const handleHtmlChanged = () => {
  addCopyButtons()
}

</script>

<template>
  <div class="markdown-renderer">
    <MdPreview
      :modelValue="content"
      :theme="theme"
      @onHtmlChanged="handleHtmlChanged"
    />
  </div>
</template>

<style scoped>
.markdown-renderer {
  @apply w-full;
}

/* Override md-editor-v3 styles with VS Code theme */
.markdown-renderer :deep(.md-preview) {
  @apply w-full;
  background: transparent !important;
  color: var(--text-primary) !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
}

/* Code blocks - VS Code Dark+ style */
.markdown-renderer :deep(pre) {
  background: var(--bg-tertiary) !important;
  border: 1px solid var(--border) !important;
  border-radius: 6px !important;
  padding: 16px !important;
  margin: 16px 0 !important;
  overflow-x: auto !important;
  position: relative;
}

.markdown-renderer :deep(pre code) {
  background: transparent !important;
  color: var(--text-primary) !important;
  font-family: 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace !important;
  font-size: 14px !important;
  line-height: 1.6 !important;
}

/* Inline code */
.markdown-renderer :deep(code:not(pre code)) {
  background: var(--bg-secondary) !important;
  color: var(--accent-blue) !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  font-family: 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace !important;
  font-size: 0.9em !important;
  border: 1px solid var(--border) !important;
}

/* Blockquotes - VS Code panel style */
.markdown-renderer :deep(blockquote) {
  border-left: 4px solid var(--accent-blue) !important;
  background: var(--bg-secondary) !important;
  padding: 12px 16px !important;
  margin: 16px 0 !important;
  border-radius: 0 6px 6px 0 !important;
  color: var(--text-secondary) !important;
}

.markdown-renderer :deep(blockquote p) {
  margin: 0 !important;
}

/* Tables - zebra stripes and horizontal scroll */
.markdown-renderer :deep(table) {
  width: 100% !important;
  border-collapse: collapse !important;
  margin: 16px 0 !important;
  display: block !important;
  overflow-x: auto !important;
  border: 1px solid var(--border) !important;
  border-radius: 6px !important;
}

.markdown-renderer :deep(thead) {
  background: var(--bg-secondary) !important;
  border-bottom: 2px solid var(--accent-blue) !important;
}

.markdown-renderer :deep(th) {
  padding: 12px 16px !important;
  text-align: left !important;
  font-weight: 600 !important;
  color: var(--text-primary) !important;
  border-bottom: 2px solid var(--accent-blue) !important;
}

.markdown-renderer :deep(td) {
  padding: 10px 16px !important;
  border-bottom: 1px solid var(--border) !important;
}

/* Zebra stripes */
.markdown-renderer :deep(tbody tr:nth-child(odd)) {
  background: transparent !important;
}

.markdown-renderer :deep(tbody tr:nth-child(even)) {
  background: var(--bg-secondary) !important;
}

.markdown-renderer :deep(tbody tr:hover) {
  background: var(--bg-tertiary) !important;
}

/* Images - rounded corners and shadow */
.markdown-renderer :deep(img) {
  max-width: 100% !important;
  height: auto !important;
  border-radius: 8px !important;
  box-shadow: var(--vscode-shadow-lg) !important;
  margin: 16px 0 !important;
  transition: transform 0.2s ease, box-shadow 0.2s ease !important;
}

.markdown-renderer :deep(img:hover) {
  transform: scale(1.02) !important;
  box-shadow: var(--vscode-shadow-xl) !important;
}

/* Headings */
.markdown-renderer :deep(h1) {
  @apply text-3xl font-bold;
  color: var(--text-primary) !important;
  margin: 24px 0 16px 0 !important;
  padding-bottom: 8px !important;
  border-bottom: 2px solid var(--border) !important;
}

.markdown-renderer :deep(h2) {
  @apply text-2xl font-semibold;
  color: var(--text-primary) !important;
  margin: 20px 0 12px 0 !important;
  padding-bottom: 6px !important;
  border-bottom: 1px solid var(--border) !important;
}

.markdown-renderer :deep(h3) {
  @apply text-xl font-semibold;
  color: var(--text-primary) !important;
  margin: 16px 0 8px 0 !important;
}

.markdown-renderer :deep(h4) {
  @apply text-lg font-semibold;
  color: var(--text-primary) !important;
  margin: 14px 0 6px 0 !important;
}

.markdown-renderer :deep(h5) {
  @apply text-base font-semibold;
  color: var(--text-primary) !important;
  margin: 12px 0 4px 0 !important;
}

.markdown-renderer :deep(h6) {
  @apply text-sm font-semibold;
  color: var(--text-secondary) !important;
  margin: 10px 0 4px 0 !important;
}

/* Paragraphs and lists */
.markdown-renderer :deep(p) {
  color: var(--text-primary) !important;
  line-height: 1.7 !important;
  margin: 12px 0 !important;
}

.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol) {
  margin: 12px 0 !important;
  padding-left: 24px !important;
  color: var(--text-primary) !important;
}

.markdown-renderer :deep(li) {
  margin: 6px 0 !important;
  line-height: 1.6 !important;
}

/* Links */
.markdown-renderer :deep(a) {
  color: var(--accent-blue) !important;
  text-decoration: none !important;
  border-bottom: 1px solid transparent !important;
  transition: border-color 0.2s ease !important;
}

.markdown-renderer :deep(a:hover) {
  border-bottom-color: var(--accent-blue) !important;
}

/* Horizontal rule */
.markdown-renderer :deep(hr) {
  border: none !important;
  border-top: 2px solid var(--border) !important;
  margin: 24px 0 !important;
}

/* Copy button styles */
.copy-button.copied {
  background: var(--accent-green) !important;
  color: #ffffff !important;
}
</style>
