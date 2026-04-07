import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const username = ref<string | null>(null)
  const auth = ref<string | null>(localStorage.getItem('auth'))

  const isAuthenticated = computed(() => !!auth.value)

  const login = (user: string, pass: string): boolean => {
    const encoded = btoa(`${user}:${pass}`)
    auth.value = encoded
    username.value = user
    localStorage.setItem('auth', encoded)
    return true
  }

  const logout = () => {
    auth.value = null
    username.value = null
    localStorage.removeItem('auth')
  }

  return {
    username,
    auth,
    isAuthenticated,
    login,
    logout
  }
})
