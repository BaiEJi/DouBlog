import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
const base = 'http://127.0.0.1:60111'
const output = path.resolve('../.ui-qa/optimization/root-shots')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  return url.hostname === '127.0.0.1' && ['60111', '60113'].includes(url.port)
    ? route.continue() : route.abort()
})
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`${base}/login`)
  const result = await page.evaluate(async () => {
    const { default: md } = await import('/src/shared/md.js')
    const input = String.raw`# 公式与 Markdown 回归

行内公式 $x^2 + \frac{a}{b}$ 与中文混排。

$$\sum_{i=1}^{n}i=\frac{n(n+1)}{2}$$

| 表格 | 数值 |
|---|---|
| 公式 | $\sqrt{2}$ |

` + '\n```javascript\nconst value = "<safe>"\n```\n'
    const host = document.createElement('main')
    host.className = 'qa-markdown prose dark:prose-invert'
    host.style.cssText = 'position:absolute;inset:0;z-index:1000;max-width:none;padding:64px;font-family:Inter,"Microsoft YaHei",sans-serif;font-size:16px;line-height:1.75;background:var(--qa-bg,#fff);color:var(--qa-fg,#111);'
    host.innerHTML = md.render(input)
    document.body.appendChild(host)
    return { math: host.querySelectorAll('.katex').length,
             errors: host.querySelectorAll('.katex-error').length,
             tables: host.querySelectorAll('table').length,
             code: host.querySelectorAll('pre code').length,
             codeText: host.querySelector('pre code')?.textContent,
             svg: host.querySelectorAll('.katex svg').length }
  })
  assert.equal(result.errors, 0)
  assert.equal(result.math, 3)
  assert.equal(result.tables, 1)
  assert.equal(result.code, 1)
  assert.match(result.codeText, /<safe>/)
  for (const dark of [false, true]) {
    await page.evaluate(dark => {
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.setProperty('--qa-bg', dark ? '#111827' : '#fff')
      document.documentElement.style.setProperty('--qa-fg', dark ? '#e5e7eb' : '#111827')
    }, dark)
    await page.screenshot({ path: path.join(output, `markdown-math-${dark ? 'dark' : 'light'}.png`) })
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'math-result.json'), JSON.stringify({ ...result, errors }, null, 2))
  console.log('PASS KaTeX 0.19 through real Markdown pipeline, table/inline/display, light/dark')
} finally { await browser.close() }
