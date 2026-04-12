<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { Button } from '@/components/ui/button'

const themeStore = useThemeStore()

/**
 * 切换主题
 */
const toggleTheme = () => {
  themeStore.toggleTheme()
}
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    @click="toggleTheme"
    :aria-label="themeStore.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    class="theme-toggle-btn"
  >
    <Transition
      name="theme-icon"
      mode="out-in"
    >
      <Sun
        v-if="themeStore.isDark"
        class="size-5 theme-icon-sun"
        key="sun"
      />
      <Moon
        v-else
        class="size-5 theme-icon-moon"
        key="moon"
      />
    </Transition>
  </Button>
</template>

<style scoped>
.theme-toggle-btn {
  position: relative;
  overflow: hidden;
  border-radius: var(--vscode-radius-full);
  width: 36px;
  height: 36px;
  transition: 
    background-color var(--vscode-duration-fast) var(--vscode-ease-in-out),
    color var(--vscode-duration-fast) var(--vscode-ease-in-out),
    transform var(--vscode-duration-fast) var(--vscode-ease-spring),
    box-shadow var(--vscode-duration-normal) var(--vscode-ease-in-out);
}

.theme-toggle-btn:hover {
  background-color: var(--vscode-interactive-hover);
  box-shadow: var(--vscode-shadow-glow-sm);
}

.theme-toggle-btn:active {
  background-color: var(--vscode-interactive-active);
  transform: scale(0.92);
}

.theme-toggle-btn:focus-visible {
  box-shadow: var(--vscode-shadow-glow-md);
}

/* Sun icon - amber/warm tones */
.theme-icon-sun {
  color: var(--vscode-accent-warning);
  transition: color var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.theme-toggle-btn:hover .theme-icon-sun {
  color: var(--vscode-accent-warning-hover);
}

/* Moon icon - cool accent tones */
.theme-icon-moon {
  color: var(--vscode-text-secondary);
  transition: color var(--vscode-duration-fast) var(--vscode-ease-in-out);
}

.theme-toggle-btn:hover .theme-icon-moon {
  color: var(--vscode-accent-primary-hover);
}

/* Icon transition animations - spring physics */
.theme-icon-enter-active,
.theme-icon-leave-active {
  transition: 
    all var(--vscode-duration-normal) var(--vscode-ease-spring);
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
