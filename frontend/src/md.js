import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
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
        tokens[i].content = content.slice(alertMatch[0].length)
        const icons = { note: '💡', tip: '💡', warning: '⚠️', caution: '🚨', important: '❗' }
        return `<blockquote class="github-alert github-alert-${type}"><p>${icons[type] || ''} `
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
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    if (src.startsWith('/')) {
      token.attrSet('src', `http://${host}:60100/api/images/?path=${encodeURIComponent(src)}&type=absolute`)
    } else {
      token.attrSet('src', `http://${host}:60100/api/images/${src}?type=relative`)
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

export default md
