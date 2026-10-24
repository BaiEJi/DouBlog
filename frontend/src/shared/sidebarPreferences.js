// 公共侧栏宽度/折叠偏好（全站共享，非业务数据）。
// 存储约定：localStorage key doublog_sidebar_layout_v1，值为 JSON
//   { "version": 1, "width": 220, "collapsed": false }
// 解析规则：version!==1 / 坏 JSON / 结构错误 → 整体回退默认；
// width 缺失或非有限数字 → 默认宽度；合法但超界 → 截到上下限；
// collapsed 必须按布尔类型解析，其余视为 false。
// 所有读写都捕获存储异常：失败时以内存状态继续，不阻止应用挂载。

export const SIDEBAR_DEFAULT_WIDTH = 220
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 420
export const SIDEBAR_COLLAPSED_WIDTH = 56
export const SIDEBAR_STORAGE_KEY = 'doublog_sidebar_layout_v1'

export function clampSidebarWidth(value) {
  // 契约：仅接受有限数字；错误类型（null/字符串/undefined…）回退默认，
  // 防 Number(null)=0 这类隐式转换把非法输入截断成边界宽度。
  if (typeof value !== 'number' || !Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

export function defaultSidebarPreferences() {
  return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false }
}

/** 解析已 JSON.parse 的任意值（也接受外部传入的普通对象）为合法偏好。
 * 整链严格类型：width 仅接受有限 number（合法才截断到 180–420 并取整），
 * 字符串/null/布尔/数组/对象/NaN/Infinity 等一切非法类型整体回退默认——
 * 不允许任何隐式 Number() 转换绕过 clampSidebarWidth 的类型检查。 */
export function normalizeSidebarPreferences(raw) {
  const defaults = defaultSidebarPreferences()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  if (raw.version !== 1) return defaults
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width)
    ? clampSidebarWidth(raw.width)
    : defaults.width
  return {
    width,
    collapsed: typeof raw.collapsed === 'boolean' ? raw.collapsed : false,
  }
}

/** 安全获取 localStorage：属性 getter 本身可能抛 SecurityError（禁用存储/
 * 隐私模式），必须在受保护的 try/catch 内访问并探测；失败返回 null 稳定引用，
 * 由 load/save 的可选链继续以内存状态工作。 */
export function getSafeSidebarStorage() {
  try {
    const storage = typeof localStorage === 'undefined' ? null : localStorage
    storage?.getItem?.(SIDEBAR_STORAGE_KEY)
    return storage ?? null
  } catch {
    return null
  }
}

export function loadSidebarPreferences(storage) {
  try {
    const raw = storage?.getItem(SIDEBAR_STORAGE_KEY)
    if (raw == null) return defaultSidebarPreferences()
    return normalizeSidebarPreferences(JSON.parse(raw))
  } catch {
    return defaultSidebarPreferences()
  }
}

/** 序列化偏好；存储异常静默（调用方持有内存态）。 */
export function serializeSidebarPreferences(prefs) {
  return JSON.stringify({ version: 1, ...prefs })
}

export function saveSidebarPreferences(storage, prefs) {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, serializeSidebarPreferences(prefs))
  } catch {
    // 配额/隐私模式下保留内存状态即可，不刷日志
  }
}
