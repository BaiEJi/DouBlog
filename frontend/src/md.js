import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import 'katex/dist/katex.min.css'

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

// Override fence rule: mermaid blocks + code blocks with language label & copy button
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const info = token.info ? token.info.trim() : ''
  const raw = token.content

  if (info === 'mermaid') {
    return `<div class="mermaid">${raw}</div>`
  }

  const lang = info.split(/\s+/)[0] || ''
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

  return `<div class="code-block"><div class="code-block-header"><span class="code-block-lang">${md.utils.escapeHtml(langLabel)}</span><button class="code-block-copy">复制</button></div><pre class="hljs"><code${langClass}>${highlighted}</code></pre></div>`
}

md.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: { throwOnError: false }
})

export default md
