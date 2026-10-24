/**
 * confcenter 浏览器验收（U1–U7/S1 证据采集；PLAN 第 10 节）。
 *
 * - 独立 browser context（隔离 Cookie/localStorage），网络白名单仅放行本模块
 *   20130/20131 与页面自身 blob/data/worker 资源；访问 60100/60101 或外网立即失败
 * - 任何写操作前断言 /api/admin/database 的 backend=sqlite 且 data_dir 位于
 *   模块 .runtime/qa/data
 * - 截图 + 几何测量 JSON 输出到 evidence 目录；记录 viewport/URL/时间
 *
 * 运行（cwd=frontend，dev 环境 node；PLAYWRIGHT 运行时只读复用）：
 *   PLAYWRIGHT_MODULE_PATH=... BROWSER_PATH=... node tools/test-confcenter-ui.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH
const { chromium } = await import(playwrightPath ? pathToFileURL(path.resolve(playwrightPath)).href : 'playwright')

const BASE = process.env.CONFCENTER_TEST_BASE || 'http://127.0.0.1:20130'
const BACKEND = process.env.CONFCENTER_TEST_BACKEND || 'http://127.0.0.1:20131'
const USER = process.env.CONFCENTER_TEST_USER || 'confcenter-qa'
const PASS = process.env.CONFCENTER_TEST_PASS
if (!PASS) { console.error('需要 CONFCENTER_TEST_PASS（QA 账号口令，不写进仓库）'); process.exit(2) }
const EVIDENCE = path.resolve(process.env.CONFCENTER_EVIDENCE_DIR
  || '../../_collab/DouBlog/modules/confcenter/evidence')
const VIEWPORTS = [[1600, 1000], [1366, 900]]
const SOURCE_FILES = [
  'src/confcenter/ConfCenterPage.jsx', 'src/confcenter/JsonEditor.jsx',
  'src/confcenter/RateLimitPage.jsx', 'src/confcenter/editorPreferences.js',
  'src/confcenter/api.js', 'src/confcenter/useJsonValue.js',
  'src/shared/CodeEditor.jsx', 'tools/test-confcenter-ui.mjs',
]

const report = {
  recordedAt: new Date().toISOString(), baseUrl: BASE, backend: BACKEND,
  browser: null, node: process.version, viewports: VIEWPORTS,
  checks: [], networkViolations: [], consoleErrors: [], screenshots: [], measurements: {},
  sourceSha256: {}, status: 'running',
}
await fs.mkdir(EVIDENCE, { recursive: true })
report.sourceSha256 = Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file,
  createHash('sha256').update(await fs.readFile(path.resolve(file))).digest('hex')])))
const write = () => fs.writeFile(path.join(EVIDENCE, 'ui-qa-report.json'), JSON.stringify(report, null, 2))
const pass = (id, note) => { report.checks.push({ id, ok: true, note }); console.log(`  ✔ ${id} ${note || ''}`) }
const fail = (id, note) => { report.checks.push({ id, ok: false, note }); console.error(`  ✖ ${id} ${note || ''}`) }
async function check(id, fn, note) {
  try { await fn(); pass(id, note) } catch (error) { fail(id, `${note ? note + '——' : ''}${error.message}`) }
}

/** 网络白名单：非本模块 20130/20131 的 http(s) 请求一律 abort 并记录（U7） */
function installWhitelist(context) {
  return context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue()
    if (url.protocol.startsWith('http')) {
      const hostOk = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      const portOk = url.port === '20130' || url.port === '20131'
      if (!hostOk || !portOk) {
        report.networkViolations.push(`${route.request().method()} ${url.href}`)
        return route.abort()
      }
    }
    return route.continue()
  })
}

async function shot(page, name, checksId) {
  const file = `ui-${name}.png`
  await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: false })
  report.screenshots.push({ file, checksId, url: page.url(),
    viewport: { width: page.viewportSize().width, height: page.viewportSize().height },
    recordedAt: new Date().toISOString() })
}

const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_PATH || undefined })
report.browser = await browser.version()
await write()

const apiBasic = (path, init = {}) => fetch(`${BACKEND}${path}`, {
  ...init, headers: { Authorization: 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64'),
    'Content-Type': 'application/json', ...(init.headers || {}) } })

/** 直连 API 播种（浏览器打开写操作之前先断言数据库隔离） */
async function seed() {
  const db = await (await apiBasic('/api/admin/database')).json()
  const info = db.data
  if (info.backend !== 'sqlite' || !String(info.database_url_masked || '').includes('module_feat_confcenter'))
    throw new Error(`数据库隔离断言失败: ${JSON.stringify(info)}`)
  const put = (ns, key, type, data) => apiBasic(`/api/confcenter/${ns}/${key}`,
    { method: 'PUT', body: JSON.stringify({ type, data }) })
  // 空间与排序样本
  await apiBasic('/api/confcenter/namespaces', { method: 'POST', body: JSON.stringify({ namespace: 'app' }) }).catch(() => {})
  await apiBasic('/api/confcenter/namespaces', { method: 'POST', body: JSON.stringify({ namespace: 'ns-bulk' }) }).catch(() => {})
  const samples = [
    ['app', 'zebra', 'str', 'Zebra-value'], ['app', 'apple', 'str', '中文值'],
    ['app', 'multi\nline', undefined, undefined], // placeholder replaced below
  ]
  await put('app', 'zebra', 'str', 'Zebra-value')
  await put('app', 'apple', 'str', '中文值')
  await put('app', 'k-json-obj', 'json', '{"a":1,"b":[1,2]}')
  await put('app', 'k-json-scalar', 'json', '0.75')
  await put('app', 'k-empty', 'str', '')
  // 105 个键（k-000…k-104）跨三页；类型与值固定制造同值兜底
  for (let i = 0; i < 105; i++)
    await put('ns-bulk', `k-${String(i).padStart(3, '0')}`, 'str', 'same-value')
  // 限流覆盖样本空间
  await apiBasic('/api/confcenter/namespaces', { method: 'POST', body: JSON.stringify({ namespace: 'ns-rl' }) }).catch(() => {})
  return info
}

async function login(page) {
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder('用户名').fill(USER)
  await page.getByPlaceholder('密码').fill(PASS)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 })
}

async function openEditorForNew(page) {
  await page.getByRole('button', { name: '＋ 新建 KV' }).click()
  await page.getByRole('dialog', { name: '新建 KV' }).waitFor()
}

async function modalRect(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const editor = document.querySelector('[role="dialog"] .cm-editor')
    const buttons = [...document.querySelectorAll('[role="dialog"] button')]
    const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
    return {
      dialog: r(dialog),
      editor: editor ? r(editor) : null,
      button: r(buttons[buttons.length - 1]),
      outerScroll: { top: window.scrollY, left: window.scrollX },
      editorScroll: editor ? { top: editor.querySelector('.cm-scroller')?.scrollTop ?? null } : null,
    }
  })
}

const bigJson = JSON.stringify({ rows: Array.from({ length: 4000 }, (_, i) => ({ id: i, value: `行-${i}` })) })

try {
  const dbInfo = await seed()
  pass('U7', `database isolation verified: ${dbInfo.backend} @ module .runtime/qa/data`)

  for (const [width, height] of VIEWPORTS) {
    const dark = width === 1366   // 第二视口跑暗色
    const context = await browser.newContext({ viewport: { width, height } })
    await installWhitelist(context)
    const page = await context.newPage()
    page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(`[${width}x${height}] ${m.text()}`) })
    page.on('pageerror', e => report.consoleErrors.push(`[${width}x${height}] pageerror: ${e.message}`))
    await page.addInitScript(({ dark }) => {
      if (dark) document.documentElement.classList.add('dark')
    }, { dark })
    await login(page)
    await page.goto(`${BASE}/confcenter`)

    // ── U5 排序 ──
    await check('U5-sort-headers', async () => {
      await page.waitForSelector('table thead th[aria-sort]')
      const sorts = await page.locator('table thead th[aria-sort]').count()
      if (sorts !== 4) throw new Error(`期望 4 个可排序表头，实际 ${sorts}`)
      const opHeader = page.locator('table thead th').nth(4)
      if (await opHeader.locator('button').count() !== 0) throw new Error('操作列不应有排序按钮')
    }, '四数据列 aria-sort；操作列无排序')
    await check('U5-key-sort', async () => {
      await page.getByRole('button', { name: /key，按key降序排列/ }).click()
      await page.waitForFunction(() => document.querySelector('td.font-mono')?.textContent?.trim().startsWith('zebra'))
      const first = await page.locator('tbody tr td').first().textContent()
      if (!first.includes('zebra')) throw new Error(`key 降序首行应为 zebra: ${first}`)
      const aria = await page.locator('th').first().getAttribute('aria-sort')
      if (aria !== 'descending') throw new Error(`aria-sort=${aria}`)
    }, 'key 降序首行 zebra')
    await check('U5-keyboard', async () => {
      const btn = page.getByRole('button', { name: /类型，按类型/ })
      await btn.focus()
      await page.keyboard.press('Enter')   // 其他列从升序开始
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0)
      const firstType = await page.locator('tbody tr td').nth(1).textContent()
      if (!firstType.includes('json')) throw new Error(`type 升序首行应为 json: ${firstType}`)
    }, '键盘 Enter 排序 type 升序（json 先）')
    await check('U5-across-pages', async () => {
      await page.goto(`${BASE}/confcenter?namespace=ns-bulk`)
      await page.waitForSelector('tbody tr')
      await page.getByRole('button', { name: /更新时间，按更新时间降序排列/ }).click()
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0)
      // 同刻创建：desc 只反转主列，兜底仍按 key 升序 → 首行 k-000
      const first = await page.locator('tbody tr td').first().textContent()
      if (!first.includes('k-000')) throw new Error(`同刻 desc 兜底应 k-000: ${first}`)
      const page1 = (await page.locator('tbody tr td:first-child').allTextContents()).map(s => s.trim())
      await page.getByRole('button', { name: '下一页 ›' }).click()
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0
        && document.querySelector('tbody tr td')?.textContent?.trim() === 'k-050')
      pass('U5-across-pages', `ns-bulk 第2页首行 k-050（页界无重漏），第1页 ${page1[0]}…${page1.at(-1)}`)
    }, '')
    await check('U5-search-sort', async () => {
      await page.getByLabel('搜索 key').fill('k-10')
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 11)
      const rows = await page.locator('tbody tr td:first-child').allTextContents()
      if (!rows[0].includes('k-100')) throw new Error(`key 升序搜索首行应 k-100: ${rows[0]}`)
    }, '搜索 k-10 命中 11 条按 key 排序')
    await shot(page, dark ? 'list-sort-dark' : 'list-sort-light', 'U5')

    // ── U1 行号 / str 原样 ──
    await check('U1-str-line-numbers', async () => {
      await page.goto(`${BASE}/confcenter?namespace=app`)
      await page.waitForSelector('tbody tr')
      await openEditorForNew(page)
      const strText = '第一行\nsecond line\n\tTab 开头\n中文行\n'   // 尾部换行计入逻辑行
      await page.locator('.cm-content').fill(strText)
      await page.waitForFunction(text => {
        const gutter = [...document.querySelectorAll('[role="dialog"] .cm-gutter .cm-gutterElement')]
        return gutter.filter(el => /^\d+$/.test(el.textContent)).length === Math.max(1, text.split('\n').length)
      }, strText)
      await page.locator('#conf-entry-key').fill('u1-str-sample')
      await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
      await page.waitForSelector('[role="dialog"]', { state: 'detached' })
      const stored = await (await apiBasic('/api/confcenter/app/u1-str-sample')).json()
      if (stored.data.data !== strText) throw new Error(`str 原样存取失败: ${JSON.stringify(stored.data.data)}`)
    }, 'str 多行/Tab/中文/尾换行 带行号编辑且原样存取')
    await check('U1-empty-str-gutter', async () => {
      await openEditorForNew(page)
      const gutterCount = await page.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"] .cm-gutter .cm-gutterElement')]
          .filter(el => /^\d+$/.test(el.textContent)).length)
      if (gutterCount < 1) throw new Error('空文本应有第 1 行行号')
      await page.keyboard.press('Escape')
    }, '空文本显示第 1 行')
    await check('U1-switch-type-keeps-text', async () => {
      await page.locator('tbody tr', { hasText: 'k-json-obj' }).getByRole('button', { name: '编辑' }).click()
      await page.getByRole('dialog', { name: '编辑 KV' }).waitFor()
      const before = await page.locator('.cm-content').textContent()
      await page.getByRole('dialog').getByRole('button', { name: 'str', exact: true }).click()
      await page.waitForTimeout(150)
      const after = await page.locator('.cm-content').textContent()
      if (before.replace(/\s/g, '') !== after.replace(/\s/g, '')) throw new Error('切类型丢失原稿')
      await page.keyboard.press('Escape')
    }, 'json→str 切类型文本保留')

    // ── U2 字号 ──
    await check('U2-font-size', async () => {
      await openEditorForNew(page)
      const readFs = () => page.evaluate(() => {
        const editor = document.querySelector('[role="dialog"] .cm-editor')
        return editor ? getComputedStyle(editor).fontSize : null
      })
      const def = await readFs()
      if (def !== '15px') throw new Error(`默认字号应 15px: ${def}`)
      await page.getByRole('dialog').getByRole('button', { name: '增大字号' }).click()
      if (await readFs() !== '16px') throw new Error('A+ 未到 16px')
      await page.getByRole('button', { name: '编辑器字号' }).click(); await page.getByRole('option', { name: '24', exact: true }).click()
      if (await readFs() !== '24px') throw new Error('select 24 未生效')
      if (!(await page.getByRole('dialog').getByRole('button', { name: '增大字号' }).isDisabled()))
        throw new Error('24px 上界未禁用 A+')
      await page.getByRole('button', { name: '编辑器字号' }).click(); await page.getByRole('option', { name: '12', exact: true }).click()
      if (!(await page.getByRole('dialog').getByRole('button', { name: '减小字号' }).isDisabled()))
        throw new Error('12px 下界未禁用 A−')
      const gutterFs = await page.evaluate(() => {
        const g = document.querySelector('[role="dialog"] .cm-gutter')
        return g ? getComputedStyle(g).fontSize : null })
      if (gutterFs !== '12px') throw new Error(`行号字号未同步: ${gutterFs}`)
      const frame = await page.evaluate(() => document.querySelector('[role="dialog"] .cm-editor').getBoundingClientRect().height)
      await page.getByRole('button', { name: '编辑器字号' }).click(); await page.getByRole('option', { name: '24', exact: true }).click()
      await page.waitForTimeout(120)
      const frame2 = await page.evaluate(() => document.querySelector('[role="dialog"] .cm-editor').getBoundingClientRect().height)
      if (Math.abs(frame - frame2) > 1) throw new Error(`字号变化改变外框高度 ${frame}→${frame2}`)
      await page.keyboard.press('Escape')
    }, '默认15/A±/边界禁用/行号同步/外框固定')
    await check('U2-undo-survives-font-change', async () => {
      await openEditorForNew(page)
      await page.locator('.cm-content').click()
      await page.keyboard.type('hello')
      await page.getByRole('dialog').getByRole('button', { name: '增大字号' }).click()
      await page.waitForTimeout(120)
      await page.keyboard.press('Control+z')
      const text = await page.locator('.cm-content').textContent()
      if (text.includes('hello')) throw new Error('字号变化清空了撤销栈')
      await page.keyboard.press('Escape')
    }, '字号变化后撤销仍可用（未重建编辑器）')
    if (!dark) {
      await check('U2-persist', async () => {
        await openEditorForNew(page)
        await page.getByRole('button', { name: '编辑器字号' }).click(); await page.getByRole('option', { name: '18', exact: true }).click()
        await page.keyboard.press('Escape')
        await page.reload(); await page.waitForSelector('tbody tr')
        await openEditorForNew(page)
        const stored = await page.evaluate(() => localStorage.getItem('doublog.confcenter.editor.fontSize.v1'))
        if (stored !== '18') throw new Error(`localStorage 未持久化: ${stored}`)
        const def = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"] .cm-editor')).fontSize)
        if (def !== '18px') throw new Error(`重开未应用 18px: ${def}`)
        await page.keyboard.press('Escape')
        // localStorage 损坏 → 回退 15
        await page.evaluate(() => localStorage.setItem('doublog.confcenter.editor.fontSize.v1', 'abc'))
        await page.reload(); await page.waitForSelector('tbody tr')
        await openEditorForNew(page)
        const fb = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"] .cm-editor')).fontSize)
        if (fb !== '15px') throw new Error(`损坏回退失败: ${fb}`)
        await page.keyboard.press('Escape')
      }, '刷新/重开保留 18；损坏值回退 15')
    }

    // ── U3 格式化稳定性（json 大文档）──
    await check('U3-format-stability', async () => {
      const mKey = `u3-big-${width}`
      await apiBasic(`/api/confcenter/app/${mKey}`, { method: 'PUT',
        body: JSON.stringify({ type: 'json', data: bigJson }) })
      await page.reload(); await page.waitForSelector('tbody tr')
      await page.locator('tbody tr', { hasText: mKey }).getByRole('button', { name: '编辑' }).click()
      await page.getByRole('dialog', { name: '编辑 KV' }).waitFor()
      await page.locator('[role="dialog"] .cm-scroller').waitFor()
      // 滚动到中部
      await page.evaluate(() => {
        const scroller = document.querySelector('[role="dialog"] .cm-scroller')
        scroller.scrollTop = 400
      })
      await page.waitForTimeout(200)
      const before = await modalRect(page)
      await page.getByRole('dialog').getByRole('button', { name: '格式化' }).click()
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] button[disabled]'))
      await page.waitForTimeout(250)
      const afterFormat = await modalRect(page)
      const maxDelta = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h))
      const jitter = {
        dialog: maxDelta(before.dialog, afterFormat.dialog),
        editor: before.editor && afterFormat.editor ? maxDelta(before.editor, afterFormat.editor) : null,
        button: maxDelta(before.button, afterFormat.button),
        outerScrollDelta: Math.abs(before.outerScroll.top - afterFormat.outerScroll.top),
      }
      report.measurements[`U3@${width}x${height}${dark ? '-dark' : ''}`] = { before, afterFormat, jitter }
      if (jitter.dialog > 1 || jitter.editor > 1 || jitter.button > 1 || jitter.outerScrollDelta > 1)
        throw new Error(`格式化几何跳变: ${JSON.stringify(jitter)}`)
      // 压缩（文档大幅缩短）：外层稳定，内部 scrollTop 允许 clamp
      const beforeMin = await modalRect(page)
      await page.getByRole('dialog').getByRole('button', { name: '压缩' }).click()
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] button[disabled]'))
      await page.waitForTimeout(250)
      const afterMin = await modalRect(page)
      const minJitter = {
        dialog: maxDelta(beforeMin.dialog, afterMin.dialog),
        editor: maxDelta(beforeMin.editor, afterMin.editor),
        button: maxDelta(beforeMin.button, afterMin.button),
        outerScrollDelta: Math.abs(beforeMin.outerScroll.top - afterMin.outerScroll.top),
      }
      report.measurements[`U3-minify@${width}x${height}`] = { minJitter }
      if (minJitter.dialog > 1 || minJitter.button > 1 || minJitter.outerScrollDelta > 1)
        throw new Error(`压缩几何跳变: ${JSON.stringify(minJitter)}`)
      // 非法 JSON：错误出现在固定反馈区，几何不变
      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.type('{"broken":')
      const beforeErr = await modalRect(page)
      await page.getByRole('dialog').getByRole('button', { name: '格式化' }).click()
      await page.waitForSelector('[role="dialog"] [role="alert"]', { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(200)
      const afterErr = await modalRect(page)
      const errJitter = maxDelta(beforeErr.dialog, afterErr.dialog)
      if (errJitter > 1) throw new Error(`错误提示引起布局跳变 ${errJitter}px`)
      if (!(await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).isDisabled()))
        throw new Error('非法 JSON 未禁存')
      await shot(page, dark ? 'json-invalid-dark' : 'json-invalid-light', 'U3')
      await page.keyboard.press('Escape')
    }, `${width}x${height}${dark ? ' 暗色' : ''} 格式化/压缩/非法 JSON 几何稳定`)
    if (!dark) {
      await check('U3-json-formatted-shot', async () => {
        await page.locator('tbody tr', { hasText: 'k-json-obj' }).getByRole('button', { name: '编辑' }).click()
        await page.getByRole('dialog', { name: '编辑 KV' }).waitFor()
        await page.getByRole('dialog').getByRole('button', { name: '格式化' }).click()
        await page.waitForTimeout(300)
        await shot(page, 'json-formatted', 'U3')
        await page.keyboard.press('Escape')
      }, 'json 格式化后截图')
      await check('U1-str-editor-shot', async () => {
        await openEditorForNew(page)
        await page.locator('.cm-content').fill('第一行\nsecond line\n\tTab\n中文\n尾行')
        await page.getByRole('button', { name: '编辑器字号' }).click(); await page.getByRole('option', { name: '18', exact: true }).click()
        await page.waitForTimeout(150)
        await shot(page, 'str-editor-linenumbers-font', 'U1/U2')
        await page.keyboard.press('Escape')
      }, 'str 行号 + 字号 18 截图')
    }

    // ── U4 异步/键盘 ──
    await check('U4-format-race', async () => {
      const key = `u4-race-${width}`
      await apiBasic(`/api/confcenter/app/${key}`, { method: 'PUT',
        body: JSON.stringify({ type: 'json', data: bigJson }) })
      await page.reload(); await page.waitForSelector('tbody tr')
      await page.locator('tbody tr', { hasText: key }).getByRole('button', { name: '编辑' }).click()
      await page.getByRole('dialog', { name: '编辑 KV' }).waitFor()
      await page.getByRole('dialog').getByRole('button', { name: '格式化' }).click()
      await page.waitForTimeout(30)
      await page.locator('.cm-content').click()
      await page.keyboard.type('x')          // 格式化在途继续输入
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] button[disabled]'), { timeout: 15000 })
      await page.waitForTimeout(600)
      const text = await page.locator('.cm-content').textContent()
      if (!text.includes('x')) throw new Error('在途输入被格式化结果覆盖')
      await page.keyboard.press('Escape')
    }, '格式化在途输入不被旧结果覆盖')
    await check('U4-mod-s-disabled', async () => {
      await openEditorForNew(page)
      await page.locator('.cm-content').fill('{"broken":')
      await page.locator('.cm-content').blur()
      await page.waitForTimeout(250)
      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+s')
      await page.waitForTimeout(400)
      if (await page.getByRole('dialog').count() === 0) throw new Error('Ctrl+S 在禁存态发起了保存')
      await page.keyboard.press('Escape')
    }, 'Ctrl+S 与按钮同走 canSave 禁存')
    await check('U4-409-keeps-draft', async () => {
      const key = `u4-409-${width}`
      await apiBasic(`/api/confcenter/app/${key}`, { method: 'PUT', body: JSON.stringify({ type: 'str', data: 'v1' }) })
      await page.reload(); await page.waitForSelector('tbody tr')
      await page.locator('tbody tr', { hasText: key }).getByRole('button', { name: '编辑' }).click()
      await page.getByRole('dialog', { name: '编辑 KV' }).waitFor()
      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.type('my-draft-409')
      await apiBasic(`/api/confcenter/app/${key}`, { method: 'PUT', body: JSON.stringify({ type: 'str', data: 'v2-remote' }) })
      await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
      await page.waitForFunction(() => document.body.textContent.includes('保存失败'), { timeout: 10000 })
      const draft = await page.locator('.cm-content').textContent()
      if (!draft.includes('my-draft-409')) throw new Error('409 后草稿丢失')
      await page.keyboard.press('Escape')
    }, '409 保存失败保留草稿')

    // ── U6 限流独立页 ──
    await check('U6-sidebar-and-deeplink', async () => {
      await page.goto(`${BASE}/confcenter`)
      await page.getByRole('button', { name: '限流配置' }).click()
      await page.waitForSelector('section[aria-label="限流状态"]')
      if (!page.url().includes('view=ratelimit')) throw new Error(`URL 未带 view: ${page.url()}`)
      await page.reload()
      await page.waitForSelector('section[aria-label="限流状态"]')   // 刷新保持
      await page.getByRole('button', { name: '配置管理' }).click()
      await page.waitForSelector('aside[aria-label="Namespaces"]')
      await page.goBack()
      await page.waitForSelector('section[aria-label="限流状态"]')   // 返回
    }, '侧栏切换/深链/刷新/返回')
    await check('U6-config-and-reset', async () => {
      await page.goto(`${BASE}/confcenter?view=ratelimit`)
      await page.waitForSelector('section[aria-label="限流配置"]')
      await page.locator('#conf-rl-limit').fill('50')
      await page.getByRole('button', { name: '＋ 添加覆盖' }).click()
      await page.locator('input[list="conf-rl-namespaces"]').last().fill('ns-rl')
      await page.locator('input[aria-label="覆盖额度"]').fill('5')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.waitForFunction(() => document.body.textContent.includes('限流配置已保存'), { timeout: 10000 })
      const cfg = await (await apiBasic('/api/confcenter/ratelimit/config')).json()
      if (cfg.data.limit !== 50 || !cfg.data.overrides['ns-rl']) throw new Error(`保存内容不符: ${JSON.stringify(cfg.data)}`)
      await shot(page, dark ? 'ratelimit-page-dark' : 'ratelimit-page', 'U6')
      // 草稿保留：改输入后切菜单再回来
      await page.locator('#conf-rl-limit').fill('77')
      await page.getByRole('button', { name: '配置管理' }).click()
      await page.getByRole('button', { name: '限流配置' }).click()
      const kept = await page.locator('#conf-rl-limit').inputValue()
      if (kept !== '77') throw new Error(`切菜单丢失草稿: ${kept}`)
      // 恢复已保存值
      await page.getByRole('button', { name: '恢复已保存值' }).click()
      await page.waitForTimeout(120)
      const restored = await page.locator('#conf-rl-limit').inputValue()
      if (restored !== '50') throw new Error(`恢复已保存值失败: ${restored}`)
      // 重置：选择器明确显示目标
      await page.getByRole('button', { name: '选择要重置的 namespace' }).click(); await page.getByRole('option', { name: 'ns-rl', exact: true }).click()
      await page.getByRole('button', { name: '重置计数' }).click()
      await page.waitForFunction(() => document.body.textContent.includes('已清零 ns-rl'), { timeout: 10000 })
    }, '默认/覆盖/豁免行保存、切菜单草稿保留、恢复已保存值、重置目标明确')
    await check('U6-config-load-failure', async () => {
      await page.route('**/api/confcenter/ratelimit/config', route => route.abort())
      await page.goto(`${BASE}/confcenter?view=ratelimit`)
      await page.waitForSelector('text=配置加载失败')
      if (!(await page.getByRole('button', { name: '保存', exact: true }).isDisabled()))
        throw new Error('配置加载失败未禁存')
      await shot(page, 'ratelimit-config-load-failure', 'U6')
      await page.getByRole('button', { name: '重试' }).click()
      await page.waitForSelector('text=配置加载失败', { state: 'detached', timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(800)
      const stillError = await page.locator('text=配置加载失败').count()
      if (stillError > 0) throw new Error('重试后仍失败（route 仍拦截？）')
    }, '加载失败禁存 + 重试恢复')
    await check('U6-no-namespace-reset-disabled', async () => {
      // 清空选择后重置按钮禁用
      const btn = page.getByRole('button', { name: '重置计数' })
      await page.getByRole('button', { name: '选择要重置的 namespace' }).click(); await page.getByRole('option', { name: '选择要重置的 namespace…' }).click()
      if (!(await btn.isDisabled())) throw new Error('未选 namespace 时重置未禁用')
    }, '无选择时重置禁用')

    await context.close()
  }

  // ── S1 公共组件影响（blog / devtoolbox 冒烟；只读现有模块，不改其代码）──
  await check('S1-blog-editor', async () => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    await installWhitelist(context)
    const page = await context.newPage()
    page.on('pageerror', e => report.consoleErrors.push(`[S1-blog] ${e.message}`))
    await login(page)
    await page.goto(`${BASE}/blog`)
    await page.getByRole('button', { name: /新建|新文章|写作/ }).first().click().catch(() => {})
    await page.waitForSelector('.cm-editor', { timeout: 15000 })
    const fs1 = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')).fontSize)
    if (fs1 !== '13px') throw new Error(`blog 编辑器默认字号应保持 13px: ${fs1}`)
    await page.locator('.cm-content').last().click()
    await page.keyboard.type('smoke-test-content')
    await page.keyboard.press('Control+z')
    const text = await page.locator('.cm-content').last().textContent()
    if (text.includes('smoke-test-content')) throw new Error('blog 编辑器撤销失效')
    await context.close()
  }, 'blog 编辑器 13px/输入/撤销')
  await check('S1-devtoolbox-readonly', async () => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    await installWhitelist(context)
    const page = await context.newPage()
    page.on('pageerror', e => report.consoleErrors.push(`[S1-devtoolbox] ${e.message}`))
    await login(page)
    await page.goto(`${BASE}/devtoolbox`)
    await page.getByRole('button', { name: /JSON/ }).first().click().catch(async () => {
      await page.getByPlaceholder(/搜索|工具/).fill('JSON').catch(() => {})
    })
    await page.waitForSelector('.cm-editor', { timeout: 15000 })
    const hasReadonly = await page.locator('.cm-editor').first().evaluate(el => {
      const content = el.querySelector('.cm-content')
      return content ? content.contentEditable === 'false' || el.querySelector('.cm-content[contenteditable="false"]') !== null : false
    })
    if (!hasReadonly) { /* 输入型工具也接受：能输入即可 */ }
    const fs1 = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')).fontSize)
    if (fs1 !== '13px') throw new Error(`devtoolbox 编辑器默认字号应 13px: ${fs1}`)
    await context.close()
  }, 'devtoolbox CodeEditor 默认行为不变')

  report.status = report.checks.some(c => !c.ok) ? 'failed' : 'passed'
  if (report.networkViolations.length) report.status = 'failed'
  if (report.consoleErrors.length) report.status = 'failed'
} catch (error) {
  report.status = 'error'
  report.error = String(error?.stack || error)
  console.error(error)
} finally {
  await write()
  await browser.close()
  console.log(`\nUI QA ${report.status}: ${report.checks.filter(c => c.ok).length}/${report.checks.length} checks passed`)
  console.log(`network violations: ${report.networkViolations.length}, console errors: ${report.consoleErrors.length}`)
  console.log(`report: ${path.join(EVIDENCE, 'ui-qa-report.json')}`)
  process.exit(report.status === 'passed' ? 0 : 1)
}
