import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright')
const base = process.env.OPTIMIZATION_QA_BASE || 'http://127.0.0.1:60111'
assert.equal(base, 'http://127.0.0.1:60111', 'This mutation suite is confined to the isolated QA proxy')
const output = path.resolve('../.ui-qa/optimization/platform-browser')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = [], checks = [], blocked = [], shots = []
let failure = null, databaseIdentity = null
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (['data:', 'blob:'].includes(url.protocol) || (url.hostname === '127.0.0.1' && ['60111', '60113', '60115'].includes(url.port))) return route.continue()
  blocked.push(`${url.origin}${url.pathname}`)
  return route.abort()
})
const mark = name => { checks.push(name); console.log('PASS', name) }
async function raw(method, url, data) { return context.request.fetch(base + url, { method, data, maxRedirects: 0 }) }
async function api(method, url, data) {
  const response = await raw(method, url, data), body = await response.json()
  assert.ok(response.ok(), `${method} ${url}: ${JSON.stringify(body)}`)
  return body.data
}
async function theme(dark) {
  await page.evaluate(value => { document.documentElement.classList.toggle('dark', value) }, dark)
  await page.waitForTimeout(350)
}
async function shot(name) {
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: false, animations: 'disabled' })
  shots.push(name)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, name + ': no page horizontal overflow')
}
async function editCode(content, index = 0) {
  const editor = page.locator('.cm-content[contenteditable="true"]').nth(index)
  await editor.click(); await editor.press('Control+a'); await editor.press('Backspace')
  if (content.length > 64 * 1024) {
    // Native CDP insertText builds a giant contenteditable DOM before CM can
    // normalize it. A paste event uses CodeMirror's real paste transaction.
    await editor.evaluate((element, text) => {
      const clipboard = new DataTransfer()
      clipboard.setData('text/plain', text)
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
    }, content)
  } else await page.keyboard.insertText(content)
}
async function navigation(label) {
  await page.getByRole('button', { name: label, exact: true }).first().click()
}
try {
  await page.goto(base + '/login')
  assert.equal(await page.evaluate(async () => (await import('/src/shared/client.js')).API_BASE), '')
  await page.getByPlaceholder('用户名', { exact: true }).fill('mindmap-qa')
  await page.getByPlaceholder('密码', { exact: true }).fill('qa-only-isolated-db')
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await page.waitForURL(base + '/')
  const database = await api('GET', '/api/admin/database')
  databaseIdentity = { identity: database.identity, generation: database.generation, data_dir: database.data_dir }
  const directory = database.data_dir.replaceAll(String.fromCharCode(92), '/').replace(/\/+/, '/')
  assert.ok(directory.endsWith('/DouBlog/.ui-qa/optimization/browser-db-3'), directory)
  mark('guard: browser requests and authenticated database point only at isolated QA')

  const snapshot = { sysName: 'benchmark-platform', levelGte: '', exactLevels: [], traceId: '', q: '',
    start: '2026-01-01T00:00', end: '2026-01-02T00:00', kv: [], rangeKey: 'custom' }
  const encoded = Buffer.from(JSON.stringify(snapshot)).toString('base64')
  const logCount = (await api('GET', '/api/v1/logs/count?sys_name=benchmark-platform')).total
  assert.ok(logCount >= 25000)
  await page.goto(base + '/logs?f=' + encodeURIComponent(encoded))
  await page.getByText(`共 ${logCount} 条`, { exact: false }).waitFor()
  const logical = page.locator('[data-virtual-total]').last()
  assert.equal(Number(await logical.getAttribute('data-virtual-total')), 100)
  assert.ok(await page.locator('[data-logrow]').count() < 70)
  await page.getByRole('button', { name: `加载更多（100/${logCount}）`, exact: true }).click()
  await page.getByRole('button', { name: `加载更多（200/${logCount}）`, exact: true }).waitFor()
  assert.equal(Number(await logical.getAttribute('data-virtual-total')), 200)
  mark('logs: complete server count and loaded logical rows remain distinct from bounded DOM')
  await page.getByRole('button', { name: '实时', exact: true }).click()
  const marker = 'platform-qa-' + Date.now()
  for (let offset = 0; offset < 1201; offset += 600) {
    await api('POST', '/api/v1/logs/batch', Array.from({ length: Math.min(600, 1201 - offset) }, (_, index) => ({
      level: 'INFO', timestamp: '2026-01-01T00:00:00Z', sys_name: 'benchmark-platform',
      message: `${marker}-${offset + index}`, trace_id: marker,
    })))
  }
  await page.waitForFunction(() => Number(document.querySelector('[data-virtual-total]')?.getAttribute('data-virtual-total')) >= 1401, null, { timeout: 20000 })
  assert.ok(await page.locator('[data-logrow]').count() < 80)
  await theme(false); await shot('logs-light'); await theme(true); await shot('logs-dark')
  mark('logs: ID tail drains a 1201-row burst with old timestamps across multiple cursor pages')

  const namespace = 'platform-qa-' + Date.now()
  await api('POST', '/api/confcenter/namespaces', { namespace })
  await api('PUT', `/api/confcenter/${namespace}/old`, { type: 'json', data: { source: 'initial' }, if_absent: true })
  await page.goto(base + '/confcenter?namespace=' + namespace)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await editCode('{"source":"editor","中文":"保留输入"}')
  await page.locator('#conf-entry-key').fill('renamed')
  await api('PUT', `/api/confcenter/${namespace}/old`, { type: 'json', data: { source: 'other writer' } })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('保存失败：配置已被修改，请重新载入后保存', { exact: true }).waitFor()
  assert.equal(await page.locator('#conf-entry-key').inputValue(), 'renamed')
  assert.match(await page.locator('.cm-content').first().innerText(), /保留输入/)
  assert.equal((await raw('GET', `/api/confcenter/${namespace}/renamed`)).status(), 404)
  assert.equal((await api('GET', `/api/confcenter/${namespace}/old`)).data.source, 'other writer')
  await theme(true); await shot('conflict-editor-dark')
  mark('confcenter: competing writer yields 409, keeps unsaved input, and creates no partial rename')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await editCode('{"source":"atomic saved","中文":"成功"}')
  await page.locator('#conf-entry-key').fill('renamed')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('#conf-entry-key').waitFor({ state: 'detached' })
  assert.equal((await raw('GET', `/api/confcenter/${namespace}/old`)).status(), 404)
  assert.deepEqual((await api('GET', `/api/confcenter/${namespace}/renamed`)).data, { source: 'atomic saved', 中文: '成功' })
  await theme(false); await shot('confcenter-light'); await theme(true); await shot('confcenter-dark')
  mark('confcenter: rename and edited JSON persist through one atomic API request')

  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const longValue = { rows: Array.from({ length: 4000 }, (_, id) => ({ id, text: `长文档-${id}-中文` })) }
  await editCode(JSON.stringify(longValue, null, 2))
  await page.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(node => node.textContent === '保存')?.disabled)
  assert.ok(await page.locator('.cm-line').count() < 100, 'large JSON only mounts visible CodeMirror lines')
  await page.getByRole('button', { name: '压缩', exact: true }).click()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(node => node.textContent === '保存')?.disabled)
  await page.locator('.cm-content[contenteditable="true"]').press('Control+s')
  await page.locator('#conf-entry-key').waitFor({ state: 'detached' })
  assert.equal((await api('GET', `/api/confcenter/${namespace}/renamed`)).data.rows.length, 4000)
  mark('confcenter: large JSON validates and compresses in workers, bounded editor DOM, Ctrl+S persists')

  await page.goto(base + '/apihub?system=benchmark-platform')
  await page.locator('tr').filter({ hasText: 'Local echo' }).getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('summary').filter({ hasText: '高级' }).click()
  await editCode('{"providers":[}')
  let updates = 0
  const record = request => { if (request.method() === 'PUT' && /\/api\/apihub\/admin\/apis\//.test(request.url())) updates++ }
  page.on('request', record)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('高级配置含无效 JSON，请修正后保存', { exact: true }).waitFor()
  assert.equal(updates, 0)
  assert.ok(await page.locator('.cm-content[contenteditable="true"]').count() >= 4)
  await theme(false); await shot('apihub-editor-light'); await theme(true); await shot('apihub-editor-dark')
  await editCode('{"providers":[{"type":"path_token"}],"credential_fields":[],"credential":{}}')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.cm-content[contenteditable="true"]').first().waitFor({ state: 'detached' })
  assert.equal(updates, 1)
  page.off('request', record)
  mark('apihub: invalid advanced JSON blocks all writes; valid unblurred edits save once')

  await context.route('**/api/clash/controller/connections/events', route => route.abort())
  await page.goto(base + '/clash')
  await navigation('连接')
  await page.getByText('2s REST 回退', { exact: true }).waitFor()
  await page.locator('tbody tr').first().waitFor()
  assert.ok(await page.locator('tbody tr').count() > 0)
  await theme(false); await shot('clash-connections-light'); await theme(true); await shot('clash-connections-dark')
  await context.unroute('**/api/clash/controller/connections/events')
  await page.reload(); await navigation('连接')
  await page.getByText('2s REST 回退', { exact: true }).waitFor()
  mark('clash: interrupted browser event stream falls back to REST; unsupported native WS also remains usable')

  let accountRequests = 0, inFlight = 0, maximum = 0
  const active = new Set()
  const begin = request => {
    if (!request.url().endsWith('/api/steamidler/accounts')) return
    accountRequests++; inFlight++; maximum = Math.max(maximum, inFlight); active.add(request)
  }
  const finish = request => { if (active.delete(request)) inFlight-- }
  page.on('request', begin); page.on('requestfinished', finish); page.on('requestfailed', finish)
  await context.route('**/api/steamidler/accounts', async route => {
    await new Promise(resolve => setTimeout(resolve, 4000))
    try { await route.continue() } catch { /* aborted by navigation or hidden-page cleanup */ }
  })
  await page.goto(base + '/steamidler')
  await page.getByText('fixture-0', { exact: false }).first().waitFor()
  await page.waitForTimeout(5000)
  assert.ok(accountRequests >= 2)
  assert.equal(maximum, 1, '4s responses must not overlap a 3s polling interval')
  await theme(false); await shot('steam-light'); await theme(true); await shot('steam-dark')
  await context.unroute('**/api/steamidler/accounts')
  page.off('request', begin); page.off('requestfinished', finish); page.off('requestfailed', finish)
  mark('steamidler: slow account polling is single-flight, real isolated accounts render in both themes')

  assert.deepEqual(errors, [])
  assert.deepEqual(blocked, [])
} catch (error) {
  failure = error.message
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: false }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.html'), await page.content()).catch(() => {})
  throw error
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: failure === null, failure, database: databaseIdentity, checks, errors, blocked, shots, at: new Date().toISOString() }, null, 2))
  await context.close(); await browser.close()
}
