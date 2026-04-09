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
