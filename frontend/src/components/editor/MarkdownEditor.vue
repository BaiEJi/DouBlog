<script setup lang="ts">
import { computed, defineAsyncComponent, Suspense } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { uploadImage } from '@/services/image'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const themeStore = useThemeStore()

/**
 * 当前主题
 */
const theme = computed(() => themeStore.isDark ? 'dark' : 'light')

/**
 * 上传图片处理函数
 * 
 * @param {File[]} files - 文件列表
 * @param {(urls: string[]) => void} callback - 回调函数
 */
const onUploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  const urls: string[] = []
  
  for (const file of files) {
    try {
      const response = await uploadImage(file)
      const imageUrl = response.url || `/api/images/${response.filepath}`
      urls.push(imageUrl)
    } catch (error) {
      console.error('Failed to upload image:', error)
    }
  }
  
  callback(urls)
}

/**
 * 延迟加载编辑器组件以减少初始包大小
 */
const MdEditorLazy = defineAsyncComponent(() => 
  import('md-editor-v3').then(module => module.MdEditor)
)
</script>

<template>
  <Suspense>
    <template #default>
      <MdEditorLazy
        v-model="props.modelValue"
        :theme="theme"
        @update:modelValue="emit('update:modelValue', $event)"
        @onUploadImg="onUploadImg"
      />
    </template>
    <template #fallback>
      <div class="editor-loading-skeleton">
        <div class="skeleton-toolbar">
          <div class="skeleton-item" v-for="i in 10" :key="i" />
        </div>
        <div class="skeleton-content">
          <div class="skeleton-line" v-for="i in 5" :key="i" />
        </div>
      </div>
    </template>
  </Suspense>
</template>

<style>
/* Override md-editor-v3 styles to match VS Code theme */
.md-editor {
  font-family: 'Geist Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
  border: 1px solid var(--vscode-border);
  border-radius: var(--vscode-radius-lg);
  background-color: var(--vscode-bg-secondary);
}

.md-editor-toolbar {
  background-color: var(--vscode-bg-tertiary);
  border-bottom: 1px solid var(--vscode-border);
  padding: 8px 12px;
  gap: 8px;
}

.md-editor-toolbar button {
  color: var(--vscode-text-primary);
  background-color: transparent;
  border: none;
  padding: 6px 10px;
  border-radius: var(--vscode-radius-sm);
  font-size: var(--vscode-font-size-sm);
}

.md-editor-toolbar button:hover {
  background-color: var(--vscode-bg-secondary);
}

.md-editor-toolbar button.active {
  background-color: var(--vscode-accent-primary);
  color: white;
}

.md-editor-toolbar .separator {
  width: 1px;
  height: 16px;
  background-color: var(--vscode-border);
  margin: 0 8px;
}

.md-editor-content {
  padding: 16px;
  min-height: 400px;
  background-color: var(--vscode-bg-secondary);
  color: var(--vscode-text-primary);
  font-family: 'Geist Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: var(--vscode-font-size-sm);
}

.md-editor-preview {
  padding: 16px;
  background-color: var(--vscode-bg-secondary);
  color: var(--vscode-text-primary);
  font-family: 'Geist Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: var(--vscode-font-size-sm);
}

/* Preview mode styling to match MarkdownRenderer */
.md-editor-preview h1, .md-editor-preview h2, .md-editor-preview h3, .md-editor-preview h4, .md-editor-preview h5, .md-editor-preview h6 {
  color: var(--vscode-text-primary);
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}

.md-editor-preview p {
  color: var(--vscode-text-primary);
  line-height: 1.6;
  margin-bottom: 1rem;
}

.md-editor-preview a {
  color: var(--vscode-accent-primary);
  text-decoration: none;
}

.md-editor-preview a:hover {
  text-decoration: underline;
}

.md-editor-preview code {
  background-color: var(--vscode-bg-tertiary);
  padding: 2px 4px;
  border-radius: var(--vscode-radius-sm);
  font-family: 'Geist Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}

.md-editor-preview pre {
  background-color: var(--vscode-bg-tertiary);
  padding: 16px;
  border-radius: var(--vscode-radius-sm);
  overflow-x: auto;
  margin: 1rem 0;
}

.md-editor-preview pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
}

.md-editor-preview blockquote {
  border-left: 3px solid var(--vscode-accent-primary);
  padding-left: 16px;
  margin: 1rem 0;
  color: var(--vscode-text-secondary);
}

.md-editor-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.md-editor-preview th, .md-editor-preview td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--vscode-border);
}

.md-editor-preview th {
  background-color: var(--vscode-bg-tertiary);
  color: var(--vscode-text-primary);
  font-weight: 600;
}

.md-editor-preview tr:hover {
  background-color: var(--vscode-bg-tertiary);
}

.md-editor-preview ul, .md-editor-preview ol {
  padding-left: 24px;
  margin: 1rem 0;
}

.md-editor-preview li {
  margin-bottom: 0.5rem;
}

/* Editor resize handle */
.md-editor-resize {
  background-color: var(--vscode-bg-tertiary);
  border-top: 1px solid var(--vscode-border);
}

/* Editor tab styles */
.md-editor-tab {
  background-color: var(--vscode-bg-tertiary);
  border: 1px solid var(--vscode-border);
  border-bottom: none;
  padding: 8px 16px;
  color: var(--vscode-text-primary);
  font-size: var(--vscode-font-size-sm);
}

.md-editor-tab.active {
  background-color: var(--vscode-bg-secondary);
  border-bottom: 2px solid var(--vscode-accent-primary);
}

.md-editor-tab:hover {
  background-color: var(--vscode-bg-secondary);
}
</style>

<style scoped>
.editor-loading-skeleton {
  width: 100%;
  height: 600px;
  background: var(--vscode-bg-secondary);
  border: 1px solid var(--vscode-border);
  border-radius: var(--vscode-radius-lg);
  overflow: hidden;
}

.skeleton-toolbar {
  height: 40px;
  background: var(--vscode-bg-tertiary);
  border-bottom: 1px solid var(--vscode-border);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.skeleton-item {
  width: 28px;
  height: 28px;
  background: var(--vscode-bg-secondary);
  border-radius: var(--vscode-radius-sm);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.skeleton-content {
  padding: 16px;
}

.skeleton-line {
  height: 16px;
  background: var(--vscode-bg-tertiary);
  border-radius: var(--vscode-radius-sm);
  margin-bottom: 12px;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.skeleton-line:nth-child(1) { width: 80%; }
.skeleton-line:nth-child(2) { width: 90%; }
.skeleton-line:nth-child(3) { width: 70%; }
.skeleton-line:nth-child(4) { width: 85%; }
.skeleton-line:nth-child(5) { width: 60%; }

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
