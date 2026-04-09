import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  /**
   * 是否为暗色主题
   * 优先使用localStorage存储的值，否则使用系统偏好
   */
  const isDark = ref<boolean>(
    localStorage.getItem('theme') === 'dark' || 
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )

  /**
   * 启用主题切换过渡动画
   */
  const enableTransitions = () => {
    const root = document.documentElement
    root.style.transition = `
      background-color var(--vscode-duration-normal) var(--vscode-ease-in-out),
      color var(--vscode-duration-normal) var(--vscode-ease-in-out),
      border-color var(--vscode-duration-normal) var(--vscode-ease-in-out)
    `
  }

  /**
   * 禁用主题切换过渡动画（在动画完成后）
   */
  const disableTransitions = () => {
    setTimeout(() => {
      const root = document.documentElement
      root.style.transition = ''
    }, 350)
  }

  /**
   * 监听主题变化，更新DOM和localStorage
   */
  watch(isDark, (newValue) => {
    enableTransitions()
    
    if (newValue) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }

    disableTransitions()
  }, { immediate: true })

  /**
   * 切换主题
   */
  function toggleTheme() {
    isDark.value = !isDark.value
  }

  return {
    isDark,
    toggleTheme
  }
})
