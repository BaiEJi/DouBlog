import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  /**
   * 用户名
   */
  const username = ref<string | null>(null)

  /**
   * Base64编码的认证凭据
   */
  const auth = ref<string | null>(localStorage.getItem('auth'))

  /**
   * 是否已认证
   */
  const isAuthenticated = computed(() => !!auth.value)

  /**
   * 登录
   * 
   * @param {string} user - 用户名
   * @param {string} pass - 密码
   * @returns {boolean} 登录是否成功
   */
  const login = (user: string, pass: string): boolean => {
    const encoded = btoa(`${user}:${pass}`)
    auth.value = encoded
    username.value = user
    localStorage.setItem('auth', encoded)
    return true
  }

  /**
   * 退出登录
   */
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
