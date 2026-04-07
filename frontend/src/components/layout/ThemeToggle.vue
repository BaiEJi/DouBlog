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
    class="relative overflow-hidden transition-colors duration-200 hover:bg-accent/10"
  >
    <Transition
      name="theme-icon"
      mode="out-in"
    >
      <Sun
        v-if="themeStore.isDark"
        class="size-5 text-amber-500"
        key="sun"
      />
      <Moon
        v-else
        class="size-5 text-slate-300"
        key="moon"
      />
    </Transition>
  </Button>
</template>

<style scoped>
.theme-icon-enter-active,
.theme-icon-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.theme-icon-enter-from {
  opacity: 0;
  transform: rotate(-90deg) scale(0.5);
}

.theme-icon-leave-to {
  opacity: 0;
  transform: rotate(90deg) scale(0.5);
}
</style>
