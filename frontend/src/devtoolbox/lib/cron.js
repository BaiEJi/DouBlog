/**
 * Cron 表达式（标准 5 字段 vixie-cron 子集）：解析、未来运行时间推算、中文描述。
 * 支持：* / 步进、a-b 范围、逗号列表、月份/星期英文名、@aliases。
 * DOW 语义与标准一致：0 和 7 都是周日；DOM/DOW 同时受限时取并集（vixie 行为）。
 */

export const FIELD_DEFS = [
  { name: '分钟', min: 0, max: 59 },
  { name: '小时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12, names: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 } },
  { name: '星期', min: 0, max: 7, names: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } },
]

const ALIASES = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
}

/**
 * 解析表达式 → {fields: [{name, values:Set<int>, raw, constrained}], error?}
 */
export function parseCron(expr) {
  const trimmed = (expr || '').trim().toLowerCase()
  const source = ALIASES[trimmed] || trimmed
  if (!source) return { error: '表达式为空' }
  const parts = source.split(/\s+/)
  if (parts.length !== 5) {
    return { error: `需要 5 个字段（分 时 日 月 星期），当前 ${parts.length} 个${parts.length === 6 ? '——本工具不支持带秒的 6 字段格式' : ''}` }
  }
  const fields = []
  for (let i = 0; i < 5; i++) {
    const def = FIELD_DEFS[i]
    const parsed = parseField(parts[i], def)
    if (parsed.error) return { error: `${def.name}字段「${parts[i]}」：${parsed.error}` }
    fields.push({ name: def.name, values: parsed.values, raw: parts[i], constrained: parsed.constrained })
  }
  // 星期 7 归一为 0（周日）
  const dow = fields[4]
  if (dow.values.has(7)) { dow.values.delete(7); dow.values.add(0) }
  return { fields }
}

function parseField(raw, def) {
  const values = new Set()
  let constrained = false
  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : parseInt(stepPart, 10)
    if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || step < 1)) return { error: `步进「/${stepPart}」无效` }
    let lo, hi
    if (rangePart === '*') { lo = def.min; hi = def.max }
    else if (rangePart.includes('-')) {
      const m = rangePart.split('-')
      lo = resolveValue(m[0], def); hi = resolveValue(m[1], def)
      if (lo === null || hi === null) return { error: '范围值无效' }
    } else {
      const v = resolveValue(rangePart, def)
      if (v === null) return { error: `值「${rangePart}」无效（${def.min}-${def.max}${def.names ? ' 或英文名' : ''}）` }
      lo = hi = v
      if (stepPart !== undefined) hi = def.max     // "5/15" = 从 5 起每 15（cron 惯例）
    }
    if (lo < def.min || hi > def.max || lo > hi) return { error: `超出范围 ${def.min}-${def.max}` }
    if (!(rangePart === '*' && step === 1)) constrained = true
    for (let v = lo; v <= hi; v += step) values.add(v === 7 && def.name === '星期' ? 0 : v)
  }
  return { values, constrained }
}

function resolveValue(token, def) {
  if (/^\d+$/.test(token)) return parseInt(token, 10)
  if (def.names && def.names[token] !== undefined) return def.names[token]
  return null
}

/**
 * 未来运行时间：逐分钟推进（惰性，最多扫 5 年）。返回 {times: Date[], exhausted?}
 */
export function nextRuns(parsed, count = 5, from = new Date()) {
  const times = []
  const start = new Date(from.getTime() + 60000)   // 下一分钟起
  start.setSeconds(0, 0)
  const [minute, hour, dom, mon, dow] = parsed.fields
  const limit = 5 * 366 * 24 * 60                   // 5 年 = 上限
  const t = new Date(start)
  for (let i = 0; i < limit && times.length < count; i++) {
    if (mon.values.has(t.getMonth() + 1)) {
      const domOk = dom.values.has(t.getDate())
      const dowOk = dow.values.has(t.getDay())
      // vixie：DOM 与 DOW 都受限时取并集，否则各自为 "*"-or-受限
      const dayOk = dom.constrained && dow.constrained ? (domOk || dowOk) : (domOk && dowOk)
      if (dayOk && hour.values.has(t.getHours()) && minute.values.has(t.getMinutes())) {
        times.push(new Date(t))
      }
    }
    t.setMinutes(t.getMinutes() + 1)
  }
  return { times, exhausted: times.length < count }
}

/** 单字段中文描述（尽力而为，覆盖常见模式） */
function describeField(field, def, kind) {
  const vs = [...field.values].sort((a, b) => a - b)
  const all = vs.length === def.max - def.min + 1
  if (kind === 'min') {
    if (all) return '每分钟'
    if (vs.length === 1) return `第 ${vs[0]} 分钟`
    if (isStep(vs)) return `每 ${vs[1] - vs[0]} 分钟（从 ${vs[0]} 起）`
    return `分钟 ${vs.join('/')}`
  }
  if (kind === 'hour') {
    if (all) return '每小时'
    if (vs.length === 1) return `${vs[0]} 点`
    if (isStep(vs)) return `每 ${vs[1] - vs[0]} 小时（从 ${vs[0]} 点起）`
    return `${vs[0]}-${vs[vs.length - 1]} 点`
  }
  if (kind === 'dom') {
    if (all) return '每天'
    if (vs.length === 1) return `每月 ${vs[0]} 号`
    return `每月 ${vs.join('/')} 号`
  }
  if (kind === 'mon') {
    if (all) return '每月'
    const names = ['', '1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']
    if (vs.length === 1) return `每年 ${names[vs[0]]}`
    return `每年 ${vs.map(v => names[v]).join('/')}`
  }
  // dow
  if (all) return '每天'
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  if (vs.length === 1) return `每${names[vs[0]]}`
  return vs.map(v => names[v]).join('/')
}

function isStep(vs) {
  if (vs.length < 3) return false
  const d = vs[1] - vs[0]
  return d > 1 && vs.every((v, i) => i === 0 || v - vs[i - 1] === d)
}

/** 整体中文描述（拼字段；不追求覆盖全部语义，字段细节见各字段描述） */
export function describeCron(parsed) {
  const [minute, hour, dom, mon, dow] = parsed.fields
  const m = describeField(minute, FIELD_DEFS[0], 'min')
  const h = describeField(hour, FIELD_DEFS[1], 'hour')
  const d = describeField(dom, FIELD_DEFS[2], 'dom')
  const mo = describeField(mon, FIELD_DEFS[3], 'mon')
  const w = describeField(dow, FIELD_DEFS[4], 'dow')

  const everyMin = m === '每分钟'
  const everyDay = d === '每天' && w === '每天'
  const everyMon = mo === '每月'
  const hourEvery = h === '每小时'

  if (everyMin) return '每分钟执行一次'
  if (m.startsWith('第') && hourEvery) return `每小时${m}`
  if (everyDay && everyMon) {
    if (m.startsWith('第') && h.length <= 3 && /^\d+ 点$/.test(h)) return `每天 ${h.replace(' 点', '')}:${m.replace('第 ', '').replace(' 分钟', '').padStart(2, '0')}`
    return `${h}${m}（每天）`
  }
  const dayPart = d !== '每天' || w !== '每天'
    ? (d !== '每天' ? d : '') + (w !== '每天' ? w : '')
    : ''
  return [dayPart, everyMon ? '' : mo, hourEvery ? '' : h, m === '每分钟' ? '' : m]
    .filter(Boolean).join(' ') + (m === '每分钟' ? '的每分钟' : '')
}
