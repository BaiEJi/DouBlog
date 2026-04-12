<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { AnimatePresence, Motion, useReducedMotion } from 'motion-v'
import Sonner from '@/components/ui/sonner/Sonner.vue'

const themeStore = useThemeStore()
const route = useRoute()
const prefersReducedMotion = useReducedMotion()

const pageTransition = computed(() =>
  prefersReducedMotion.value
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }
)

onMounted(() => {
  if (themeStore.isDark) {
    document.documentElement.classList.add('dark')
  }
})
</script>

<template>
  <AnimatePresence mode="wait">
    <Motion
      :key="route.path"
      :initial="{ opacity: 0, y: 8 }"
      :animate="{ opacity: 1, y: 0 }"
      :exit="{ opacity: 0, y: -8 }"
      :transition="pageTransition"
    >
      <router-view />
    </Motion>
  </AnimatePresence>
  <Sonner position="top-right" :expand="true" rich-colors />
</template>
