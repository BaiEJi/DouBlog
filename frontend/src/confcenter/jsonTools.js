/**
 * JSON 工具函数（非组件，独立文件避免 react-refresh only-export-components）。
 * 错误定位沿用 devtoolbox JsonFormatTool 的 V8 position 约定（第 N 行第 M 列）。
 */

/** JSON.parse 错误 → 中文行列定位（基于 V8 的 position 信息） */
export function jsonErrorDetail(text, err) {
  const posMatch = /position (\d+)/.exec(err.message)
  if (!posMatch) return err.message.replace(/^JSON\.parse:?\s*/i, '')
  const pos = +posMatch[1]
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  const col = pos - before.lastIndexOf('\n')
  return `${err.message.replace(/ in JSON at position \d+.*/i, '')}（第 ${line} 行第 ${col} 列）`
}

/** 便捷校验：null=合法，否则返回定位后的错误文案 */
export function jsonValidate(text) {
  try { JSON.parse(text); return null }
  catch (e) { return jsonErrorDetail(text, e) }
}
