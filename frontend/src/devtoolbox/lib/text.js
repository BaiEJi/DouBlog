/**
 * 文本处理：命名风格转换（词边界切分）、CSV 解析/序列化（RFC 4180 引号规则）、
 * 文本统计（CJK 计数与 diary 后端口径一致）、行级批处理、占位文本生成。
 */

// ─── 命名转换 ─────────────────────────────────────────────

/** 切词：分隔符（非字母数字）、驼峰边界（小写→大写、连续大写末尾接小写） */
export function splitWords(input) {
  return input
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

const cap = w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w

export function caseConversions(input) {
  const words = splitWords(input)
  const lower = words.map(w => w.toLowerCase())
  const joined = lower.join(' ')
  const pascal = lower.map(cap).join('')
  return [
    { label: 'camelCase 小驼峰', value: lower.length ? lower[0] + pascal.slice(lower[0].length) : '' },
    { label: 'PascalCase 大驼峰', value: pascal },
    { label: 'snake_case 下划线', value: lower.join('_') },
    { label: 'CONSTANT_CASE 常量', value: lower.join('_').toUpperCase() },
    { label: 'kebab-case 短横线', value: lower.join('-') },
    { label: 'dot.case 点分', value: lower.join('.') },
    { label: 'path/case 路径', value: lower.join('/') },
    { label: 'Space case 空格', value: joined },
    { label: 'Sentence case 首词大写', value: joined ? cap(lower[0]) + (lower.length > 1 ? ' ' + lower.slice(1).join(' ') : '') : '' },
    { label: 'Title Case 每词大写', value: lower.map(cap).join(' ') },
    { label: 'UPPER CASE 全大写', value: joined.toUpperCase() },
    { label: 'lower case 全小写', value: joined },
    { label: '反转大小写', value: [...input].map(c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()).join('') },
  ]
}

// ─── CSV（RFC 4180：引号包裹、双引号转义、字段内换行）────────

export function csvParse(text, delim = ',') {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

export function csvEscape(field, delim) {
  const s = String(field ?? '')
  return /["\n\r]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function csvStringify(rows, delim = ',') {
  return rows.map(r => r.map(f => csvEscape(f, delim)).join(delim)).join('\n')
}

/** 扁平化嵌套对象为点路径键（数组下标 [] 形式） */
export function flatten(obj, prefix = '', out = {}) {
  if (obj !== null && typeof obj === 'object') {
    if (Array.isArray(obj)) obj.forEach(v => flatten(v, `${prefix}[]`, out))
    else Object.entries(obj).forEach(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k, out))
  } else out[prefix] = obj
  return out
}

/** JSON 数组 → CSV（表头 = 全部对象键的并集；可选点路径扁平化嵌套） */
export function jsonToCsv(data, { flattenNested = true } = {}) {
  const rows = data.map(item => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return flattenNested ? flatten(item) : item
    }
    return { value: item }
  })
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const table = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]
  return table
}

/** CSV（含表头行）→ JSON 对象数组 */
export function csvToJson(rows) {
  if (rows.length < 1) return []
  const [headers, ...body] = rows
  return body.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])))
}

// ─── 文本统计 ─────────────────────────────────────────────

export function textStats(text) {
  const lines = text === '' ? [] : text.split(/\r\n|\r|\n/)
  const cjk = (text.match(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu) || []).length
  const wordRe = /[A-Za-z0-9][A-Za-z0-9'’-]*/g
  const words = (text.match(wordRe) || []).length
  return {
    chars: [...text].length,
    charsNoWs: [...text.replace(/\s/g, '')].length,
    cjk,
    words,
    lines: lines.length,
    nonEmptyLines: lines.filter(l => l.trim()).length,
    paragraphs: text.split(/\n\s*\n/).filter(p => p.trim()).length,
    bytes: new TextEncoder().encode(text).length,
    maxLineLen: lines.reduce((m, l) => Math.max(m, [...l].length), 0),
  }
}

/** 词频 TOP N（CJK 逐字 + 西文按词，与统计口径一致） */
export function wordFrequency(text, topN = 10) {
  const freq = new Map()
  const bump = w => freq.set(w, (freq.get(w) || 0) + 1)
  for (const ch of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) bump(ch)
  }
  for (const w of text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []) bump(w)
  return [...freq.entries()].sort((x, y) => y[1] - x[1]).slice(0, topN)
}

// ─── 行级批处理 ───────────────────────────────────────────

export function lineTransform(text, opts) {
  let lines = text.split(/\r\n|\r|\n/)
  if (opts.trim) lines = lines.map(l => l.trim())
  if (opts.dropEmpty) lines = lines.filter(l => l !== '')
  if (opts.dedupe) lines = [...new Set(lines)]
  switch (opts.sort) {
    case 'asc': lines.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', 'numeric')); break
    case 'desc': lines.sort((a, b) => b.localeCompare(a, 'zh-Hans-CN', 'numeric')); break
    case 'len': lines.sort((a, b) => a.length - b.length); break
    case 'shuffle': for (let i = lines.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [lines[i], lines[j]] = [lines[j], lines[i]] } break
    case 'reverse': lines.reverse(); break
    default: break
  }
  if (opts.number) lines = lines.map((l, i) => `${i + 1}. ${l}`)
  if (opts.prefix || opts.suffix) lines = lines.map(l => `${opts.prefix || ''}${l}${opts.suffix || ''}`)
  return lines.join(opts.join !== undefined && opts.join !== '' ? opts.join : '\n')
}

// ─── 占位文本 ─────────────────────────────────────────────

const EN_WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ')

const ZH_WORDS = ('天地 玄黄 宇宙 洪荒 日月 盈昃 辰宿 列张 寒来 暑往 秋收 冬藏 闰余 成岁 律吕 调阳 云腾 致雨 露结 为霜 金生 玉出 剑号 珠阙 果珍 李柰 菜重 芥姜 海咸 河淡 鳞潜 羽翔 龙师 火帝 鸟官 人皇 始制 文字 乃服 衣裳 推位 让国 有虞 陶唐 吊民 伐罪 周发 殷汤 坐朝 问道 垂拱 平章 爱育 黎首 臣伏 戎羌').split(' ')

const pick = arr => arr[Math.random() * arr.length | 0]

function enSentence(minW = 6, maxW = 18) {
  const n = minW + Math.random() * (maxW - minW) | 0
  const ws = Array.from({ length: n }, () => pick(EN_WORDS))
  const s = ws.join(' ')
  return s[0].toUpperCase() + s.slice(1) + '.'
}

function zhSentence(minW = 8, maxW = 20) {
  const n = minW + Math.random() * (maxW - minW) | 0
  return Array.from({ length: n }, () => pick(ZH_WORDS)).join('') + '。'
}

export function lorem({ lang = 'en', paragraphs = 3, sentencesPerPara = 4 }) {
  const gen = lang === 'zh' ? zhSentence : enSentence
  const paras = Array.from({ length: paragraphs },
    () => Array.from({ length: sentencesPerPara }, () => gen()).join(' '))
  return paras.join('\n\n')
}
