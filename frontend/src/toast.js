/**
 * Rate limit toast notification
 * Creates a fixed-position toast at the bottom center of the viewport
 */

let toastEl = null
let hideTimer = null

function ensureToast() {
  if (toastEl) return toastEl
  toastEl = document.createElement('div')
  toastEl.className = 'toast-rate-limit'
  toastEl.textContent = '请求过于频繁，请稍后再试'
  document.body.appendChild(toastEl)
  return toastEl
}

export function showRateLimitToast(duration = 2500) {
  const el = ensureToast()
  if (hideTimer) clearTimeout(hideTimer)
  // Force reflow to restart animation
  el.classList.remove('show')
  void el.offsetWidth
  el.classList.add('show')
  hideTimer = setTimeout(() => el.classList.remove('show'), duration)
}

export function isRateLimitResponse(res) {
  return res && res.status === 429
}
