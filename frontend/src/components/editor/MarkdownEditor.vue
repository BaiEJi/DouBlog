<script setup lang="ts">
import { computed } from 'vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useThemeStore } from '@/stores/theme'
import { uploadImage } from '@/services/image'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const themeStore = useThemeStore()

const theme = computed(() => themeStore.isDark ? 'dark' : 'light')

const onUploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  const urls: string[] = []
  
  for (const file of files) {
    try {
      const response = await uploadImage(file)
      const imageUrl = `/api/images/${response.filepath}`
      urls.push(imageUrl)
    } catch (error) {
      console.error('Failed to upload image:', error)
    }
  }
  
  callback(urls)
}
</script>

<template>
  <MdEditor
    v-model="props.modelValue"
    :theme="theme"
    @update:modelValue="emit('update:modelValue', $event)"
    @onUploadImg="onUploadImg"
  />
</template>
