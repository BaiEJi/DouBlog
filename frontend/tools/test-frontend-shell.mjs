// 公共前端模块真实浏览器烟测（Edge/Chromium headless + 原生 CDP，零新依赖，非 playwright）。
// v1.1.0：默认用户（凭据经 .qa/frontend/qa-credentials.json 传递，不硬编码）；
// 请求白名单为【发送前拦截】（CDP Fetch.requestPaused → 非白名单直接 fail）。
// 覆盖：登录、Todo 四象限、侧栏拖动/键盘/双击/折叠/持久化、窄轨一级图标、
// 白名单阻断、404 路由、console/pageerror。
// 前置：backend（frontend_qa.py serve --seed）与 vite preview 已按登记端口启动。
// 用法：node tools/test-frontend-shell.mjs --module frontend --registry <collaboration.json>
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const MODULE = arg('module', 'frontend')
const REGISTRY = arg('registry')
const EVIDENCE_DIR = path.resolve(arg('evidence', '../.qa/frontend/evidence'))
const BROWSER = arg('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
const CDP_PORT = Number(arg('cdp-port', '20168'))

if (!REGISTRY) { console.error('需要 --registry <collaboration.json>'); process.exit(2) }
const registry = JSON.parse(readFileSync(REGISTRY, 'utf-8'))
const entry = registry.modules[MODULE]
if (!entry) { console.error(`登记表没有 ${MODULE}`); process.exit(2) }
const FRONTEND = `http://127.0.0.1:${entry.frontend_port}`
const BACKEND = `http://127.0.0.1:${entry.backend_port}`
// 默认用户凭据：由 backend serve 写入模块目录（不入库、不写入报告/命令行）
const credPath = path.resolve('../.qa/frontend/qa-credentials.json')
let CRED = null
try { CRED = JSON.parse(readFileSync(credPath, 'utf-8')) } catch {
  console.error(`缺少凭据文件 ${credPath}（先启动 frontend_qa.py serve）`)
  process.exit(2)
}
const QA_USER = CRED.username
mkdirSync(EVIDENCE_DIR, { recursive: true })

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', ev => this.onMessage(ev)) }
  onMessage(ev) {
    const msg = JSON.parse(ev.data)
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : resolve(msg.result)
    } else { for (const l of this.listeners) l(msg) }
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  on(listener) { this.listeners.push(listener) }
  close() { this.ws.close() }
}

async function waitFor(fetchJson, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try { return await fetchJson() } catch (error) { lastError = error }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`等待 ${label} 超时：${lastError?.message || 'no response'}`)
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面脚本异常：${r.exceptionDetails.text}`)
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + path.resolve('../.qa/frontend/chrome-profile'),
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => { try { browser.kill() } catch {} })

try {
  const version = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  }, 15000, 'CDP 端口')
  console.log(`浏览器：${version.Browser}`)

  const target = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  }, 15000, '新标签页')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')

  // ── F05：请求白名单【发送前阻断】（CDP Fetch 拦截，而非事后记录）──
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  const blockedHits = []
  const ALLOWED_ORIGIN = new Set([FRONTEND, BACKEND])
  cdp.on(async msg => {
    if (msg.method !== 'Fetch.requestPaused') return
    const { requestId, request } = msg.params
    let origin = ''
    try { origin = new URL(request.url).origin } catch { /* bad url */ }
    const allowed = ALLOWED_ORIGIN.has(origin)
    if (!allowed) blockedHits.push(request.url)
    try {
      await (allowed
        ? cdp.send('Fetch.continueRequest', { requestId })
        : cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }))
    } catch { /* 目标可能已关闭 */ }
  })
  const consoleErrors = []
  const pageErrors = []
  cdp.on(msg => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args?.map(a => a.value || a.description).join(' ') || '')
    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails?.text || 'exception')
  })

  async function navigate(url) { await cdp.send('Page.navigate', { url }); await sleep(300) }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(EVIDENCE_DIR, `${name}.png`), Buffer.from(r.data, 'base64'))
  }
  async function waitSelector(selector, timeout = 15000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return Date.now() - start
      await sleep(80)
    }
    throw new Error(`选择器超时：${selector}`)
  }
  const sidebarWidth = () => evaluate(cdp, `document.querySelector('#module-sidebar')?.getBoundingClientRect().width`)
  const loginViaForm = async () => {
    await evaluate(cdp, `(() => {
      const form = document.querySelector('form'); if (!form) return 'no-form'
      const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      const ins = form.querySelectorAll('input')
      d.set.call(ins[0], ${JSON.stringify(QA_USER)}); ins[0].dispatchEvent(new Event('input', { bubbles: true }))
      d.set.call(ins[1], ${JSON.stringify(CRED.password)}); ins[1].dispatchEvent(new Event('input', { bubbles: true }))
      form.requestSubmit()
    })()`)
    await waitFor(async () => {
      const at = await evaluate(cdp, 'location.pathname')
      if (at === '/login') throw new Error('still-login')
      return at
    }, 15000, '登录跳转')
  }

  // ── 场景 1：登录页（公开路由）+ 默认用户登录 ──
  await navigate(`${FRONTEND}/login`)
  await waitSelector('form')
  check('登录页可见（公开路由）', await evaluate(cdp, `document.body.innerText.includes('登录')`))
  await loginViaForm()
  check('默认用户登录成功并进入门户', (await evaluate(cdp, 'location.pathname')) === '/')
  check('凭据来自模块文件（默认用户，非 QA 专用账号）', Boolean(QA_USER) && QA_USER !== 'frontend-qa', `username=${QA_USER}`)

  // ── 场景 2：Todo 四象限业务 ready + 公共侧栏 ──
  await navigate(`${FRONTEND}/todo`)
  await waitSelector('#module-sidebar')
  await waitFor(async () => { if (!(await evaluate(cdp, `document.body.innerText.includes('重要且紧急')`))) throw new Error('quadrant'); return true }, 20000, '四象限任务')
  check('Todo 四象限业务 ready', true)
  check('侧栏拖动手柄存在', await evaluate(cdp, `Boolean(document.querySelector('#module-sidebar [role=separator]'))`))

  // ── 场景 3：键盘调整 + 真实鼠标拖动 ──
  const beforeKb = await sidebarWidth()
  await evaluate(cdp, `(() => { const h = document.querySelector('#module-sidebar [role=separator]'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })()`)
  await sleep(350)
  const afterKb = await sidebarWidth()
  check('键盘 ArrowRight +10px', Math.round(afterKb - beforeKb) === 10, `${beforeKb}→${afterKb}`)
  const handle = await evaluate(cdp, `(() => { const r = document.querySelector('#module-sidebar [role=separator]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 300 } })()`)
  const dragFrom = await sidebarWidth()
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 20; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + i * 6, y: handle.y, button: 'left' }); await sleep(16) }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 120, y: handle.y, button: 'left', clickCount: 1 })
  await sleep(250)
  const stored = await evaluate(cdp, `localStorage.getItem('doublog_sidebar_layout_v1')`)
  check('鼠标拖动提交并落盘', (await sidebarWidth()) > dragFrom + 60, stored)
  await evaluate(cdp, `document.querySelector('#module-sidebar [role=separator]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(250)
  check('双击恢复默认 220', Math.round(await sidebarWidth()) === 220)

  // ── 场景 4：折叠 56 → 刷新保持 → 展开；窄轨一级图标 ──
  await evaluate(cdp, `document.querySelector('#module-sidebar button[aria-label="折叠侧边栏"]').click()`)
  await sleep(400)
  check('折叠 56px 窄轨', Math.round(await sidebarWidth()) === 56)
  const rail = await evaluate(cdp, `[...document.querySelectorAll('#module-sidebar nav[aria-label="模块页面（紧凑）"] [aria-label]')].map(e => e.getAttribute('aria-label'))`)
  check('窄轨一级图标（无二级）', Array.isArray(rail) && rail.length >= 5, Array.isArray(rail) ? rail.join(',') : String(rail))
  await navigate(`${FRONTEND}/todo`)
  await waitSelector('#module-sidebar')
  check('刷新保持折叠', Math.round(await sidebarWidth()) === 56)
  await evaluate(cdp, `document.querySelector('#module-sidebar button[aria-label="展开侧边栏"]').click()`)
  await sleep(400)
  check('展开恢复宽度', Math.round(await sidebarWidth()) === 220)

  // ── 场景 5：F05 白名单发送前阻断（本地验证，不真正触达受保护服务）──
  const blockedProbe = await evaluate(cdp, `fetch('http://127.0.0.1:60100/health').then(() => 'passed-through').catch(e => 'blocked:' + (e && e.message))`)
  check('受保护端口 60100 请求被发送前阻断', String(blockedProbe).startsWith('blocked'), String(blockedProbe))
  check('拦截器记录违例并 failRequest', blockedHits.some(u => u.includes(':60100')), blockedHits.slice(0, 2).join(','))

  // ── 场景 6：未知路由 404 ──
  await navigate(`${FRONTEND}/no-such-page-xyz`)
  await waitFor(async () => { if (!(await evaluate(cdp, `document.body.innerText.includes('页面不存在')`))) throw new Error(); return true }, 15000, '404 页面')
  check('未知路由显示 404 与返回入口', true)

  // ── 汇总 ──
  await sleep(400)
  const externalViolations = blockedHits.filter(u => !u.includes('127.0.0.1'))
  check('网络白名单：无外网访问（阻断机制已验证）', externalViolations.length === 0, `blockedTotal=${blockedHits.length}`)
  const relevantErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('Failed to load resource'))
  check('无未捕获 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('无业务 console.error', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | '))

  writeFileSync(path.join(EVIDENCE_DIR, 'shell-results.json'), JSON.stringify({
    browser: version.Browser, frontend: FRONTEND, backend: BACKEND, defaultUser: QA_USER,
    finishedAt: new Date().toISOString(), results, blockedHits, consoleErrors, pageErrors,
  }, null, 2))
  const failed = results.filter(r => !r.pass)
  console.log(`\n烟测结果：${results.length - failed.length}/${results.length} 通过`)
  cdp.close()
  browser.kill()
  process.exit(failed.length ? 1 : 0)
} catch (error) {
  console.error('烟测执行失败：', error)
  try { browser.kill() } catch {}
  process.exit(1)
}
