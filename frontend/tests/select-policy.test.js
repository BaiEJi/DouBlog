import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../../', import.meta.url))

// ESLint 检查 JSX。这里也检查 HTML 页面、脚本模板和浏览器扩展。
function browserFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) return browserFiles(file)
    return /\.(?:html?|[cm]?[jt]sx?)$/i.test(entry.name) ? [file] : []
  })
}

test('browser entry points use the shared dropdown instead of native pickers', () => {
  const files = [
    join(project, 'frontend/index.html'),
    ...browserFiles(join(project, 'frontend/src')),
    ...browserFiles(join(project, 'frontend/public')),
    ...browserFiles(join(project, 'extensions/todo/chrome-extension')),
  ]
  const failures = files.filter(file => {
    const source = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const markup = /^\.html?$/i.test(extname(file)) ? /<\s*(select|datalist)(?=[\s/>])/i : /<\s*(select|datalist)(?=[\s/>])/
    return markup.test(source)
      || /\bcreateElement\(\s*['"`](?:select|datalist)['"`]/i.test(source)
      || /\bcreateElementNS\(\s*[^,]+,\s*['"`](?:select|datalist)['"`]/i.test(source)
  })
  assert.deepEqual(failures.map(file => relative(project, file)), [])
})
