<script setup lang="ts">
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'
import Sonner from '@/components/ui/sonner/Sonner.vue'

const themeStore = useThemeStore()

onMounted(() => {
  if (themeStore.isDark) {
    document.documentElement.classList.add('dark')
  }
})
</script>

<template>
  <router-view />
  <Sonner position="top-right" :expand="true" rich-colors />
</template>
