<script setup lang="ts">
import { MdPreview } from 'md-editor-v3'
import { useThemeStore } from '@/stores/theme'

defineProps<{
  content: string
}>()

const themeStore = useThemeStore()
</script>

<template>
  <MdPreview
    :modelValue="content"
    :theme="themeStore.isDark ? 'dark' : 'light'"
  />
</template>
