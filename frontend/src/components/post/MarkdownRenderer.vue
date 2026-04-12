<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { useThemeStore } from '@/stores/theme'
import { generateHeadingId } from '@/utils/heading'

defineProps<{
  content: string
}>()

const themeStore = useThemeStore()
const theme = computed(() => themeStore.isDark ? 'dark' : 'light')
const showLineNumbers = ref(true)

interface MdHeadingIdOptions {
  text: string
  level: number
  index: number
  currentToken?: unknown
  nextToken?: unknown
}

const mdHeadingId = (options: MdHeadingIdOptions) => {
  return generateHeadingId(options.text)
}

const copyToClipboard = async (text: string, button: HTMLButtonElement): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    const originalText = button.innerHTML
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Copied!
    `
    button.classList.add('copied')
    setTimeout(() => {
      button.innerHTML = originalText
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
      if (preElement.querySelector('.code-copy-btn')) return

      const code = preElement.querySelector('code')
      if (!code) return

      // Create wrapper for code block actions
      const header = document.createElement('div')
      header.className = 'code-block-header'
      
      // Get language from class
      const langMatch = code.className.match(/language-(\w+)/)
      const lang = langMatch ? langMatch[1] : ''
      
      // Language badge
      if (lang) {
        const langBadge = document.createElement('span')
        langBadge.className = 'code-lang-badge'
        langBadge.textContent = lang.toUpperCase()
        header.appendChild(langBadge)
      }
      
      // Copy button
      const button = document.createElement('button') as HTMLButtonElement
      button.className = 'code-copy-btn'
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      `
      
      button.addEventListener('click', () => {
        copyToClipboard(code.textContent || '', button)
      })
      
      header.appendChild(button)
      preElement.insertBefore(header, preElement.firstChild)
    })
  }, 100)
}

const addLineNumbers = () => {
  if (!showLineNumbers.value) return
  
  setTimeout(() => {
    const codeBlocks = document.querySelectorAll('.md-preview pre code')
    codeBlocks.forEach((code) => {
      const codeElement = code as HTMLElement
      // Skip if already has line numbers
      if (codeElement.classList.contains('line-numbers-processed')) return
      
      const lines = codeElement.textContent?.split('\n') || []
      const lineCount = lines.length
      const lineCountStr = lineCount.toString()
      const padding = lineCountStr.length + 1
      
      // Add line numbers via CSS counter
      codeElement.style.setProperty('--line-count', `"${lineCount}"`)
      codeElement.style.setProperty('--line-padding', `${padding}ch`)
      codeElement.classList.add('line-numbers', 'line-numbers-processed')
    })
  }, 100)
}

const handleHtmlChanged = () => {
  addCopyButtons()
  addLineNumbers()
  addHeadingIds()
}

// Add IDs to headings for TOC navigation
const addHeadingIds = () => {
  setTimeout(() => {
    const preview = document.querySelector('.md-editor-preview')
    if (!preview) return
    
    const headings = preview.querySelectorAll('h2, h3')
    headings.forEach((heading) => {
      const h = heading as HTMLElement
      if (!h.id) {
        h.id = generateHeadingId(h.textContent || '')
      }
    })
  }, 100)
}

// Watch for content changes
watch(() => showLineNumbers.value, () => {
  nextTick(() => {
    addLineNumbers()
    // Toggle line numbers class on code blocks
    const codeBlocks = document.querySelectorAll('.md-preview pre code')
    codeBlocks.forEach((code) => {
      if (showLineNumbers.value) {
        code.classList.add('line-numbers')
      } else {
        code.classList.remove('line-numbers')
      }
    })
  })
})

onMounted(() => {
  addCopyButtons()
  addLineNumbers()
  addHeadingIds()
})
</script>

<template>
  <div class="markdown-content">
    <!-- Line Numbers Toggle -->
    <div class="markdown-options" v-if="content?.includes('```')">
      <label class="line-numbers-toggle">
        <input type="checkbox" v-model="showLineNumbers" />
        <span class="toggle-label">Show Line Numbers</span>
      </label>
    </div>
    
    <MdPreview
      :modelValue="content"
      :theme="theme"
      :mdHeadingId="mdHeadingId"
      @onHtmlChanged="handleHtmlChanged"
    />
  </div>
</template>

<style scoped>
.markdown-content {
  width: 100%;
}

/* Line numbers toggle */
.markdown-options {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--vscode-spacing-3);
}

.line-numbers-toggle {
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-2);
  font-size: var(--vscode-font-size-sm);
  color: var(--vscode-text-secondary);
  cursor: pointer;
  padding: var(--vscode-spacing-1-5) var(--vscode-spacing-3);
  border-radius: var(--vscode-radius-md);
  transition: all var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.line-numbers-toggle:hover {
  background: var(--vscode-bg-hover);
  color: var(--vscode-text-primary);
}

.line-numbers-toggle input {
  accent-color: var(--vscode-accent-primary);
  cursor: pointer;
}

.toggle-label {
  user-select: none;
}

/* Override md-editor-v3 base styles */
.markdown-content :deep(.md-preview) {
  width: 100%;
  background: transparent !important;
  font-family: inherit;
}

/* Code block container with copy button header */
.markdown-content :deep(pre) {
  position: relative;
  overflow: hidden;
  font-family: var(--vscode-font-mono);
}

/* Code block header */
.markdown-content :deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--vscode-spacing-2) var(--vscode-spacing-3);
  background: var(--vscode-bg-secondary);
  border-bottom: 1px solid var(--vscode-border);
  min-height: 36px;
}

.markdown-content :deep(pre code) {
  font-family: inherit;
}

/* Language badge */
.markdown-content :deep(.code-lang-badge) {
  font-size: var(--vscode-font-size-xs);
  font-weight: 600;
  color: var(--vscode-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px var(--vscode-spacing-2);
  background: var(--vscode-bg-tertiary);
  border-radius: var(--vscode-radius-sm);
}

/* Copy button */
.markdown-content :deep(.code-copy-btn) {
  display: flex;
  align-items: center;
  gap: var(--vscode-spacing-1);
  padding: var(--vscode-spacing-1) var(--vscode-spacing-2-5);
  background: transparent;
  border: 1px solid var(--vscode-border);
  border-radius: var(--vscode-radius-md);
  color: var(--vscode-text-secondary);
  font-size: var(--vscode-font-size-xs);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.markdown-content :deep(.code-copy-btn:hover) {
  background: var(--vscode-accent-primary);
  border-color: var(--vscode-accent-primary);
  color: var(--vscode-text-primary);
}

.markdown-content :deep(.code-copy-btn.copied) {
  background: var(--vscode-success);
  border-color: var(--vscode-success);
  color: var(--vscode-text-primary);
}

/* Dark mode code header */
.dark .markdown-content :deep(.code-block-header) {
  background: var(--vscode-bg-primary);
  border-bottom-color: var(--vscode-border);
}

.dark .markdown-content :deep(.code-lang-badge) {
  background: var(--vscode-bg-tertiary);
}

.dark .markdown-content :deep(.code-copy-btn) {
  border-color: var(--vscode-border);
}

.dark .markdown-content :deep(.code-copy-btn:hover) {
  background: var(--vscode-accent-primary);
  border-color: var(--vscode-accent-primary);
}
</style>
