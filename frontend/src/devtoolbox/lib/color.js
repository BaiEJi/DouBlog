/**
 * 颜色：HEX/RGB/HSL 互转、相对亮度、WCAG 对比度分级、明暗色阶生成。
 * 全部纯函数，输入输出均为 {r,g,b}/{h,s,l} 0-255/0-360/0-100。
 */

export function parseColor(input) {
  const s = (input || '').trim().toLowerCase()
  let m
  if ((m = s.match(/^#?([0-9a-f]{3})$/))) {
    const [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16))
    return { r, g, b }
  }
  if ((m = s.match(/^#?([0-9a-f]{6})$/))) {
    const n = parseInt(m[1], 16)
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 }
  }
  if ((m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/))) {
    return { r: +m[1], g: +m[2], b: +m[3] }
  }
  if ((m = s.match(/^hsla?\(\s*(\d{1,3}(?:\.\d+)?)\s*[,°\s]+(\d{1,3}(?:\.\d+)?)%\s*[,°\s]+(\d{1,3}(?:\.\d+)?)%/))) {
    return hslToRgb({ h: +m[1], s: +m[2], l: +m[3] })
  }
  return null
}

const hex2 = n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

export const rgbToHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
export const hexToRgb = hex => parseColor(hex)

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

/** WCAG 相对亮度 */
export function relLuminance({ r, g, b }) {
  const f = v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(rgb1, rgb2) {
  const l1 = relLuminance(rgb1), l2 = relLuminance(rgb2)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG 分级：普通文本 4.5 / 大字 3.0（AA），7.0 / 4.5（AAA） */
export function wcagGrade(ratio) {
  if (ratio >= 7) return { label: 'AAA', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
  if (ratio >= 4.5) return { label: 'AA', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
  if (ratio >= 3) return { label: 'AA 大字', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
  return { label: '不达标', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' }
}

/** 与黑/白文本的对比度（判断该底色适合什么字色） */
export function bestTextOn(rgb) {
  const onWhite = contrastRatio(rgb, { r: 255, g: 255, b: 255 })
  const onBlack = contrastRatio(rgb, { r: 0, g: 0, b: 0 })
  return {
    white: { ratio: onWhite, grade: wcagGrade(onWhite) },
    black: { ratio: onBlack, grade: wcagGrade(onBlack) },
    prefer: onBlack >= onWhite ? 'black' : 'white',
  }
}

/** 色阶：与白/黑混合，各 steps/2 档（不含端点） */
export function shades(rgb, steps = 10) {
  const lighter = [], darker = []
  for (let i = 1; i <= steps / 2; i++) {
    const f = i / (steps / 2 + 1)
    lighter.push({
      hex: rgbToHex(lerp(rgb, { r: 255, g: 255, b: 255 }, f)),
      label: `+${i}`,
    })
    darker.push({
      hex: rgbToHex(lerp(rgb, { r: 0, g: 0, b: 0 }, f)),
      label: `-${i}`,
    })
  }
  return { lighter, darker }
}

function lerp(c1, c2, f) {
  return {
    r: c1.r + (c2.r - c1.r) * f,
    g: c1.g + (c2.g - c1.g) * f,
    b: c1.b + (c2.b - c1.b) * f,
  }
}
