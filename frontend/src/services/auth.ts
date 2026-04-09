import api from './api'

/**
 * 登录接口
 * 
 * @returns {Promise<any>} 登录结果
 */
export const login = () => {
  return api.post('/auth/login')
}

/**
 * 检查认证状态
 * 
 * @returns {Promise<any>} 认证检查结果
 */
export const checkAuth = () => {
  return api.get('/auth/check')
}
