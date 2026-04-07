<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { Button } from '@/components/ui/button'

const themeStore = useThemeStore()
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    @click="themeStore.toggleTheme()"
    :aria-label="themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
  >
    <Sun
      v-if="themeStore.isDark"
      class="size-5"
    />
    <Moon
      v-else
      class="size-5"
    />
  </Button>
</template>
