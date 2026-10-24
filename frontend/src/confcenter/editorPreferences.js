/**
 * 配置中心编辑器偏好（当前只有字号）——浏览器 localStorage 持久化，
 * 新建/编辑、str/json 共用同一配置中心偏好。不同 origin 自然隔离；
 * 只存字号整数，不存 KV 内容、Cookie 或密码。
 */
export const FONT_STORAGE_KEY = 'doublog.confcenter.editor.fontSize.v1'
export const FONT_DEFAULT = 15
export const FONT_MIN = 12
export const FONT_MAX = 24

/** 读取字号：缺失/非数值/非整数/越界/存储被禁用 → 默认 15。 */
export function loadFontSize() {
  try {
    const raw = window.localStorage.getItem(FONT_STORAGE_KEY)
    if (raw == null) return FONT_DEFAULT
    const value = Number(raw)
    if (!Number.isInteger(value) || value < FONT_MIN || value > FONT_MAX) return FONT_DEFAULT
    return value
  } catch {
    return FONT_DEFAULT
  }
}

/** 写入字号；存储被禁用/超限时静默失败（本次会话仍生效）。 */
export function saveFontSize(value) {
  if (!Number.isInteger(value) || value < FONT_MIN || value > FONT_MAX) return false
  try {
    window.localStorage.setItem(FONT_STORAGE_KEY, String(value))
    return true
  } catch {
    return false
  }
}

/** 步进到边界内整数；无 localStorage 也可用（纯函数）。 */
export function clampFontSize(value) {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(value)))
}
