// ─── 剪贴板（N 秒自动覆写清理；绝不写 console）──────────
let clipboardClearTimer = 0
let clipboardGeneration = 0, ownedClipboard = null
async function clearMatchingClipboard(text) {
  if (!text) return
  try { if (await navigator.clipboard.readText() === text) await navigator.clipboard.writeText('') } catch { /* permission denied */ }
}
export function clearVaultClipboard() {
  clipboardGeneration += 1; clearTimeout(clipboardClearTimer)
  const text = ownedClipboard; ownedClipboard = null
  return clearMatchingClipboard(text)
}
export const CLIPBOARD_OPTIONS = [
  { key: '10s', label: '10 秒', ms: 10000 },
  { key: '30s', label: '30 秒', ms: 30000 },
  { key: '60s', label: '60 秒', ms: 60000 },
  { key: 'never', label: '永不', ms: 0 },
]

export function makeClipboardCopier(clearMs) {
  return async (text) => {
    const generation = clipboardGeneration
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    if (generation !== clipboardGeneration) { await clearMatchingClipboard(text); return false }
    ownedClipboard = text
    clearTimeout(clipboardClearTimer)
    if (clearMs > 0) {
      clipboardClearTimer = setTimeout(async () => {
        try {
          if (ownedClipboard === text) ownedClipboard = null
          await clearMatchingClipboard(text)
        } catch { /* 忽略：权限/不可用 */ }
      }, clearMs)
    }
    return true
  }
}
