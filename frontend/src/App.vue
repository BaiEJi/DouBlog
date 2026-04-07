<script setup lang="ts">
import { onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

onMounted(() => {
  if (themeStore.isDark) {
    document.documentElement.classList.add('dark')
  }
})
</script>

<template>
  <router-view />
</template>
