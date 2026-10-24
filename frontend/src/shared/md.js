import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'  // ~35 常用语言子集,替代全量 190+
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import taskLists from 'markdown-it-task-lists'
import footnote from 'markdown-it-footnote'
import { light as emoji } from 'markdown-it-emoji'
import container from 'markdown-it-container'
import deflist from 'markdown-it-deflist'
import abbr from 'markdown-it-abbr'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import attrs from 'markdown-it-attrs'
import { API_BASE } from '@/shared/client'

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`
      } catch (_) {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})

// ─── 插件 ────────────────────────────────────────────────
md.use(taskLists, { label: true, labelAfter: true })
md.use(footnote)
md.use(emoji)
md.use(deflist)
md.use(abbr)
md.use(sub)
md.use(sup)
md.use(attrs)

// 容器提示框: ::: tip / warning / danger
md.use(container, 'tip', {
  render: function (tokens, idx) {
    if (tokens[idx].nesting === 1) return '<div class="custom-block custom-block-tip">\n'
    return '</div>\n'
  }
})
md.use(container, 'warning', {
  render: function (tokens, idx) {
    if (tokens[idx].nesting === 1) return '<div class="custom-block custom-block-warning">\n'
    return '</div>\n'
  }
})
md.use(container, 'danger', {
  render: function (tokens, idx) {
    if (tokens[idx].nesting === 1) return '<div class="custom-block custom-block-danger">\n'
    return '</div>\n'
  }
})
md.use(container, 'info', {
  render: function (tokens, idx) {
    if (tokens[idx].nesting === 1) return '<div class="custom-block custom-block-info">\n'
    return '</div>\n'
  }
})

// ─── 代码块: 语言标签 + 复制按钮 + 行号 + 行高亮 ──────────
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const raw = token.content.replace(/\n$/, '')

  if (info === 'mermaid') {
    const escaped = md.utils.escapeHtml(raw)
    return `<div class="code-block"><div class="code-block-header"><span class="code-block-lang">mermaid</span><button class="code-block-copy" data-mermaid-source="${escaped.replace(/"/g, '&quot;')}">复制</button></div><div class="mermaid">${raw}</div></div>`
  }

  // 从 token.attrs 解析属性（markdown-it-attrs 处理）
  const attrs = token.attrs || []
  let hasLineNumbers = false
  const highlightLines = new Set()

  for (const [key, value] of attrs) {
    if (key === 'class' && value.includes('line-numbers')) {
      hasLineNumbers = true
    }
    if (key === 'data-highlight') {
      value.split(',').forEach(part => {
        const range = part.trim().split('-')
        if (range.length === 2) {
          for (let i = parseInt(range[0]); i <= parseInt(range[1]); i++) highlightLines.add(i)
        } else if (range[0]) {
          highlightLines.add(parseInt(range[0]))
        }
      })
    }
  }

  // 从 info 中提取语言（去掉可能残留的 {.class}）
  const lang = info.replace(/\s*\{[^}]*\}/, '').trim() || ''
  const langLabel = lang || 'text'

  let highlighted
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(raw, { language: lang }).value
    } catch (_) {
      highlighted = md.utils.escapeHtml(raw)
    }
  } else {
    highlighted = md.utils.escapeHtml(raw)
  }

  const langClass = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : ''

  if (hasLineNumbers || highlightLines.size > 0) {
    const lines = highlighted.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    const numberedLines = lines.map((line, i) => {
      const num = i + 1
      const hlClass = highlightLines.has(num) ? ' line-highlight' : ''
      return `<span class="code-line${hlClass}"><span class="line-num">${num}</span><span class="line-content">${line}</span></span>`
    }).join('')
    return `<div class="code-block"><div class="code-block-header"><span class="code-block-lang">${md.utils.escapeHtml(langLabel)}</span><button class="code-block-copy">复制</button></div><pre class="hljs"><code${langClass}>${numberedLines}</code></pre></div>`
  }

  return `<div class="code-block"><div class="code-block-header"><span class="code-block-lang">${md.utils.escapeHtml(langLabel)}</span><button class="code-block-copy">复制</button></div><pre class="hljs"><code${langClass}>${highlighted}</code></pre></div>`
}

// ─── 数学公式 ─────────────────────────────────────────────
md.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: { throwOnError: false }
})

// ─── GitHub Alert: > [!NOTE] > [!WARNING] > [!TIP] > [!CAUTION] ──
md.renderer.rules.blockquote_open = function (tokens, idx, options, env, self) {
  // 向后查找 inline token
  for (let i = idx + 1; i < tokens.length; i++) {
    if (tokens[i].type === 'inline') {
      const content = tokens[i].content
      const alertMatch = content.match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*/)
      if (alertMatch) {
        const type = alertMatch[1].toLowerCase()
        const icons = { note: '💡', tip: '💡', warning: '⚠️', caution: '🚨', important: '❗' }
        // 渲染走 children 而非 content,需同步剥离首个 text token 中的 [!XXX] 标记
        const first = tokens[i].children && tokens[i].children[0]
        if (first && first.type === 'text') {
          first.content = first.content.replace(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*/, (icons[type] || '') + ' ')
        }
        return `<blockquote class="github-alert github-alert-${type}">\n`
      }
      break
    }
    if (tokens[i].type !== 'paragraph_open') break
  }
  return '<blockquote>\n'
}

// ─── 图片路径转换 ──────────────────────────────────────────
const defaultImageRule = md.renderer.rules.image.bind(md.renderer.rules)
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const src = token.attrGet('src')
  if (src && !src.startsWith('http') && !src.startsWith('blob:') && !src.startsWith('data:')) {
    if (src.startsWith('/api/images/')) {
      // 后端图片接口的规范形式（编辑器上传插入的就是这种）：只补主机名
      token.attrSet('src', `${API_BASE}${src}`)
    } else if (src.startsWith('/')) {
      token.attrSet('src', `${API_BASE}/api/images/?path=${encodeURIComponent(src)}&type=absolute`)
    } else {
      token.attrSet('src', `${API_BASE}/api/images/${src}?type=relative`)
    }
  }

  // 图片标题：如果 token 有 title，包裹 figure + figcaption
  const title = token.attrGet('title')
  const originalHtml = defaultImageRule(tokens, idx, options, env, self)
  if (title) {
    return `<figure class="image-figure">${originalHtml}<figcaption>${md.utils.escapeHtml(title)}</figcaption></figure>`
  }
  return originalHtml
}

// ─── 高亮文本 ==text==（后处理）─────────────────────────────
const originalRender = md.render.bind(md)
md.render = function (src, ...args) {
  let html = originalRender(src, ...args)
  // 保护 code/pre 内容不被替换
  const codes = []
  html = html.replace(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g, (m) => {
    codes.push(m)
    return `\x00CODE${codes.length - 1}\x00`
  })
  html = html.replace(/(?<!=)==([^=\n]+?)==(?!=)/g, '<mark>$1</mark>')
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i) => codes[parseInt(i)])
  return html
}


// ─── 双链 [[wiki link]] ────────────────────────────────────
// 渲染为带占位属性的 <a class="wiki-link" data-wiki-target="目标">文字</a>，
// 由 applyWikiLinks() 按当前知识库的文章映射解析出 href（或标记为未找到）。
// 寻址：[[name]] / [[标题]] / [[name|显示文字]]；代码块/行内代码内不生效。
md.inline.ruler.after('escape', 'wiki_link', (state, silent) => {
  const src = state.src
  const pos = state.pos
  if (src.charCodeAt(pos) !== 0x5B /* [ */ || src.charCodeAt(pos + 1) !== 0x5B) return false
  const end = src.indexOf(']]', pos + 2)
  if (end === -1) return false
  const inner = src.slice(pos + 2, end)
  if (!inner || /[[\]\n]/.test(inner)) return false
  const bar = inner.indexOf('|')
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
  const text = bar === -1 ? target : inner.slice(bar + 1).trim() || target
  if (!target) return false
  if (!silent) {
    const open = state.push('link_open', 'a', 1)
    open.attrs = [['class', 'wiki-link'], ['data-wiki-target', target]]
    const t = state.push('text', '', 0)
    t.content = text
    state.push('link_close', 'a', -1)
  }
  state.pos = end + 2
  return true
})

/**
 * 从文章树构建双链解析映射（name 优先于 title，均精确匹配）
 * @param {Array} nodes 树节点（含 name/title/id/children）
 * @returns {Object} 目标 -> 文章ID
 */
export function buildWikiMap(nodes) {
  const m = Object.create(null)
  const posts = []
  const walk = (arr) => (arr || []).forEach(n => {
    if (n.id !== 0) posts.push(n)
    if (n.children) walk(n.children)
  })
  walk(nodes)
  posts.sort((a, b) => Number(a.id) - Number(b.id))
  posts.forEach(p => { if (p.name && !(p.name in m)) m[p.name] = p.id })
  posts.forEach(p => { if (p.title && !(p.title in m)) m[p.title] = p.id })
  return m
}

const _WIKI_A_RE = /<a class="wiki-link" data-wiki-target="([^"]*)">/g
const _unescapeAttr = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * 把渲染输出里的双链占位解析为真实链接
 * @param {string} html md.render 的输出（含 data-wiki-target 占位）
 * @param {Object} resolveMap 目标(name/标题, 区分大小写) -> 文章ID 的映射
 * @returns {string} 解析后的 html；命中的链接带 href，未命中标记 wiki-link-missing（无 href 不可点击）
 */
export function applyWikiLinks(html, resolveMap) {
  if (!resolveMap || !html || html.indexOf('data-wiki-target') === -1) return html
  return html.replace(_WIKI_A_RE, (m, rawTarget) => {
    const target = _unescapeAttr(rawTarget)
    const id = resolveMap[target]
    if (id != null) {
      return `<a class="wiki-link" href="/post/${id}" data-wiki-id="${id}">`
    }
    return `<a class="wiki-link wiki-link-missing" title="未找到链接目标：${rawTarget}">`
  })
}

// ─── Mermaid 图表渲染（统一入口，三页共用）─────────────────
// mermaid 采用动态 import：不打进文章页首屏关键路径，
// 正文文字先渲染，图表模块在后台加载后补画
const mermaidThemes = {
  dark: {
    primaryColor: '#1e3a5f', primaryBorderColor: '#3b82f6', primaryTextColor: '#e0e7ff',
    secondaryColor: '#422006', tertiaryColor: '#052e16',
    lineColor: '#9ca3af', arrowheadColor: '#9ca3af',
    background: '#0d1117', mainBkg: '#1e3a5f', nodeBkg: '#1e3a5f', nodeBorder: '#3b82f6',
    clusterBkg: '#0c1629', clusterBorder: '#1e40af',
    textColor: '#e5e7eb', titleColor: '#f9fafb', edgeLabelBackground: '#161b22',
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", "Source Code Pro", "Menlo", "Monaco", "Consolas", monospace', fontSize: '14px',
    radius: 8, strokeWidth: 1.5, useGradient: true,
    actorBkg: '#1e3a5f', actorBorder: '#3b82f6', actorTextColor: '#e0e7ff',
    signalColor: '#d1d5db', signalTextColor: '#f9fafb',
    activationBorderColor: '#3b82f6', activationBkgColor: '#172554',
    taskBkgColor: '#1e3a5f', taskBorderColor: '#3b82f6',
    doneTaskBkgColor: '#14532d', doneTaskBorderColor: '#22c55e',
    critBorderColor: '#dc2626', critBkgColor: '#450a0a', todayLineColor: '#3b82f6',
  },
  light: {
    primaryColor: '#dbeafe', primaryBorderColor: '#3b82f6', primaryTextColor: '#1e3a5f',
    secondaryColor: '#fef3c7', tertiaryColor: '#f0fdf4',
    lineColor: '#6b7280', arrowheadColor: '#6b7280',
    background: '#ffffff', mainBkg: '#dbeafe', nodeBkg: '#dbeafe', nodeBorder: '#3b82f6',
    clusterBkg: '#f0f9ff', clusterBorder: '#93c5fd',
    textColor: '#1f2937', titleColor: '#111827', edgeLabelBackground: '#ffffff',
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", "Source Code Pro", "Menlo", "Monaco", "Consolas", monospace', fontSize: '14px',
    radius: 8, strokeWidth: 1.5, useGradient: true,
    actorBkg: '#dbeafe', actorBorder: '#3b82f6', actorTextColor: '#1e3a5f',
    signalColor: '#374151', signalTextColor: '#111827',
    activationBorderColor: '#3b82f6', activationBkgColor: '#eff6ff',
    taskBkgColor: '#dbeafe', taskBorderColor: '#3b82f6',
    doneTaskBkgColor: '#86efac', doneTaskBorderColor: '#22c55e',
    critBorderColor: '#ef4444', critBkgColor: '#fef2f2', todayLineColor: '#3b82f6',
  },
}

// 串行化：避免主题切换/快速切换时并发 run() 互相干扰
let mermaidQueue = Promise.resolve()

/**
 * 渲染当前页面上所有未处理的 mermaid 图表
 * @param {boolean} dark 暗色主题
 */
export function renderMermaidDiagrams(dark) {
  // 整体 try/catch：动态加载失败（如 dev 依赖重优化窗口）只报错一次，
  // 不让队列链 reject 中毒（否则后续所有渲染请求被永久跳过）
  mermaidQueue = mermaidQueue.then(async () => {
    try {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: dark ? mermaidThemes.dark : mermaidThemes.light,
      })
      // 清除旧标记（主题切换/内容更新重渲染路径：元素还在，需强制重画）
      document.querySelectorAll('.mermaid[data-processed]').forEach(el => {
        el.removeAttribute('data-processed')
      })
      await mermaid.run({ querySelector: '.mermaid:not([data-processed])' })
    } catch (e) {
      console.error('Mermaid render error:', e)
    }
  })
  return mermaidQueue
}

export default md
