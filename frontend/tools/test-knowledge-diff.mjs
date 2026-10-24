import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
const base = 'http://127.0.0.1:60111', output = path.resolve('../.ui-qa/optimization/knowledge-browser')
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
await context.route('**/*', route => {
  const u = new URL(route.request().url())
  return ['data:', 'blob:'].includes(u.protocol) || u.hostname === '127.0.0.1' && ['60111','60113','60115'].includes(u.port) ? route.continue() : route.abort()
})
const page = await context.newPage(), report = { checks: [], errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
async function api(method, url, data) {
  const response = await context.request.fetch(base + url, { method, data }), body = await response.json()
  assert.ok(response.ok() && body.success, JSON.stringify(body)); return body.data
}
const mark = value => { report.checks.push(value); console.log('PASS', value) }
async function screenshot(name) { await page.screenshot({ path: path.join(output, name + '.png') }) }
try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('用户名', { exact: true }).fill('mindmap-qa')
  await page.getByPlaceholder('密码', { exact: true }).fill('qa-only-isolated-db')
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await page.waitForURL(base + '/')
  const status = await api('GET', '/api/admin/database')
  assert.ok(status.data_dir.replaceAll('\\','/').endsWith('/DouBlog/.ui-qa/optimization/browser-db-3'))
  const title = '完整差异600行-' + Date.now()
  const lines = Array.from({ length: 600 }, (_, i) => `line ${String(i).padStart(4,'0')} preserved`)
  const item = await api('POST', '/api/assets/items', { kind: 'prompt', title, content: lines.join('\n') })
  lines[599] = 'line 0599 final changed marker'
  await api('PUT', `/api/assets/items/${item.id}`, { content: lines.join('\n') })
  await page.goto(base + '/assets')
  await page.getByRole('heading', { name: title, exact: true }).click()
  await page.getByRole('button', { name: /版本（/ }).click()
  await page.getByRole('button', { name: /^v1/ }).click()
  await page.getByRole('button', { name: '复制完整补丁', exact: true }).waitFor()
  const virtual = page.locator('[data-virtual-total]')
  assert.equal(Number(await virtual.getAttribute('data-virtual-total')), 601)
  assert.ok(await virtual.locator('[data-index]').count() < 100)
  await virtual.evaluate(el => { el.parentElement.scrollTop = el.parentElement.scrollHeight })
  await page.getByText('line 0599 final changed marker', { exact: true }).waitFor()
  await page.getByRole('button', { name: '复制完整补丁', exact: true }).click()
  const patch = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(patch.includes('line 0000 preserved') && patch.includes('line 0599 preserved') && patch.includes('line 0599 final changed marker'))
  await screenshot('assets-worker-history-diff-complete')
  mark('600-line asset diff renders 601 logical rows with bounded DOM; final changed line reachable and full patch copied')
  await page.goto(base + '/assets')
  await page.getByRole('heading', { name: '资产 029', exact: true }).click()
  await page.getByRole('button', { name: /版本（/ }).click()
  await page.getByRole('button', { name: /^v1/ }).click()
  await page.getByText(/超过.*预算|超时|缩小比较范围/).waitFor({ timeout: 12000 })
  report.largeInputStatus = await page.locator('[role="status"]').last().innerText()
  await screenshot('assets-large-diff-budget')
  mark('4000+4000 unrelated fixture lines report explicit compute budget instead of an incomplete result')
  await page.getByRole('button', { name: /^v2/ }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByText('计算已取消', { exact: true }).waitFor()
  await screenshot('assets-large-diff-cancelled')
  mark('large comparison can be cancelled while computing; editor remains interactive')
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.failure = error.stack; console.error(error); process.exitCode = 1
  await screenshot('assets-diff-failure').catch(() => {})
} finally { await fs.writeFile(path.join(output, 'diff-report.json'), JSON.stringify(report,null,2)); await browser.close() }
