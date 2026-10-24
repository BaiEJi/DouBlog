// 真实生产故障注入（原生 CDP + Edge headless，非 playwright）。
// v2：不用 CDP Fetch 伪造响应（导航主文档语义不可靠），改用真实故障源：
//  A 入口 404：重命名 dist 入口 JS（文件系统级真实 404）→ 看门狗 20s 失败卡
//  B 路由 chunk 404：重命名 TodoPage chunk → ModuleErrorBoundary 错误卡 + 侧栏可用
//  C 认证服务不可达：停本模块 QA 后端（20161）→ unavailable，不跳登录
//  D 真实 401：清浏览器 Cookie → /todo?v=calendar → /login?next=完整保留
//  E localStorage getter 抛 SecurityError → 应用挂载、侧栏全功能（F01）
// A/B 用完立即恢复文件名；C 完成后重启后端。截图供 image 子代理审查。
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f }
const REGISTRY = arg('registry')
const EVIDENCE = path.resolve('../.qa/frontend/evidence-faults')
const BROWSER = arg('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
if (!REGISTRY) { console.error('需要 --registry'); process.exit(2) }
const entry = JSON.parse(readFileSync(REGISTRY, 'utf-8')).modules.frontend
const FRONTEND = `http://127.0.0.1:${entry.frontend_port}`
const BACKEND = `http://127.0.0.1:${entry.backend_port}`
const CRED = JSON.parse(readFileSync('../.qa/frontend/qa-credentials.json', 'utf-8'))
mkdirSync(EVIDENCE, { recursive: true })
const DIST_ASSETS = path.resolve('dist/assets')

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const listJs = (prefix) => readdirFiles().filter(f => f.startsWith(prefix) && f.endsWith('.js'))
import { readdirSync } from 'node:fs'
function readdirFiles() { return readdirSync(DIST_ASSETS) }

const browser = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=20168', '--user-data-dir=' + path.resolve('../.qa/frontend/chrome-profile-faults'),
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => { try { browser.kill() } catch {} })

async function waitCdp() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { try { const r = await fetch('http://127.0.0.1:20168/json/version'); if (r.ok) return } catch {} await sleep(300) }
  throw new Error('CDP 未就绪')
}
async function newTab() {
  await waitCdp()
  const target = await (await fetch('http://127.0.0.1:20168/json/new?about:blank', { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let seq = 0; const pending = new Map(); const listeners = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
    else listeners.forEach(l => l(m))
  })
  const cdp = {
    send: (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} 超时`)) }, 20000)
      pending.set(id, { res: v => { clearTimeout(timer); res(v) }, rej: e => { clearTimeout(timer); rej(e) } })
      ws.send(JSON.stringify({ id, method, params }))
    }),
    on: l => listeners.push(l), close: () => ws.close(),
  }
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  return cdp
}
const evaluate = async (cdp, expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value
const waitUntil = async (cdp, expression, timeout, label) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { const v = await evaluate(cdp, expression); if (v) return v } catch { /* nav race */ }
    await sleep(250)
  }
  throw new Error(`${label} 超时`)
}
const shot = async (cdp, name) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(EVIDENCE, `${name}.png`), Buffer.from(r.data, 'base64'))
}
async function loginAndGoto(cdp, targetPath) {
  await cdp.send('Page.navigate', { url: `${FRONTEND}/login?next=${encodeURIComponent(targetPath)}` })
  await sleep(1800)
  await evaluate(cdp, `(() => { const form = document.querySelector('form'); const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); const ins = form.querySelectorAll('input'); d.set.call(ins[0], ${JSON.stringify(CRED.username)}); ins[0].dispatchEvent(new Event('input', { bubbles: true })); d.set.call(ins[1], ${JSON.stringify(CRED.password)}); ins[1].dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit() })()`)
  await sleep(2500)
}
function withRenamed(names, fn) {
  const renamed = names.map(f => [path.join(DIST_ASSETS, f), path.join(DIST_ASSETS, f + '.hidden')])
  renamed.forEach(([a, b]) => renameSync(a, b))
  return fn().finally(() => renamed.forEach(([a, b]) => { try { renameSync(b, a) } catch { /* already restored */ } }))
}
async function backendAlive() { return fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false) }

try {
  // A 入口 404（文件系统级真实 404）
  {
    const entryFile = listJs('index-')[0]
    const cdp = await newTab()
    await withRenamed([entryFile], async () => {
      await cdp.send('Page.navigate', { url: `${FRONTEND}/login` })
      const shown = await waitUntil(cdp, `document.getElementById('boot-failure')?.style?.display === 'flex'`, 26000, '看门狗失败卡').then(() => true).catch(() => false)
      const diag = await evaluate(cdp, `({ bootFailed: String(window.__doublogBootFailed), hasReload: Boolean(document.querySelector('#boot-failure button')), hasPortal: document.getElementById('boot-failure')?.innerText.includes('返回工作台') })`).catch(e => ({ error: String(e) }))
      check('A 入口 404：看门狗 20s 失败卡（重载+返回工作台，无自动刷新）', shown && diag.hasReload && diag.hasPortal, JSON.stringify(diag))
      try { await shot(cdp, 'A-entry-404-watchdog') } catch { check('A 截图', false, 'captureScreenshot 失败') }
    })
    cdp.close()
  }

  // B 路由 chunk 404（TodoPage 真实 404）
  {
    const chunk = listJs('TodoPage-')[0]
    const cdp = await newTab()
    await loginAndGoto(cdp, '/blog')
    await withRenamed([chunk], async () => {
      await cdp.send('Page.navigate', { url: `${FRONTEND}/todo` })
      const ok = await waitUntil(cdp, `document.body.innerText.includes('页面加载失败')`, 15000, '错误卡').then(() => true).catch(() => false)
      const state = await evaluate(cdp, `({ hasSidebar: Boolean(document.querySelector('#module-sidebar')), unsavedHint: document.body.innerText.includes('未保存'), backHome: document.body.innerText.includes('返回工作台') })`).catch(() => ({}))
      check('B chunk 404：内容区错误卡 + 未保存提示 + 返回工作台，侧栏保持', ok && state.hasSidebar && state.unsavedHint && state.backHome, JSON.stringify(state))
      try { await shot(cdp, 'B-chunk-404-error-card') } catch { check('B 截图', false, 'captureScreenshot 失败') }
    })
    cdp.close()
  }

  // D 真实 401（清 Cookie → auth/check 401 → next 完整保留）
  {
    const cdp = await newTab()
    await cdp.send('Network.clearBrowserCookies')
    await cdp.send('Page.navigate', { url: `${FRONTEND}/todo?v=calendar` })
    const next = await waitUntil(cdp, `location.pathname === '/login' ? location.pathname + location.search : ''`, 15000, '登录跳转').catch(() => '(timeout)')
    check('D 未登录 401：跳登录且 next 保留完整 query', String(next).startsWith('/login') && decodeURIComponent(String(next)).includes('/todo?v=calendar'), String(next))
    await waitUntil(cdp, `Boolean(document.querySelector('form'))`, 10000, 'D 登录表单渲染').catch(() => {})
    await sleep(800)
    await cdp.send('Page.captureScreenshot', { format: 'png' })
    try { await shot(cdp, 'D-auth-401-next-preserved') } catch { check('D 截图', false, 'captureScreenshot 失败') }
    cdp.close()
  }

  // E localStorage getter 抛 SecurityError（F01）
  {
    const cdp = await newTab()
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })` })
    await cdp.send('Page.navigate', { url: `${FRONTEND}/login?next=%2Ftodo` })
    await sleep(2000)
    await evaluate(cdp, `(() => { const form = document.querySelector('form'); const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); const ins = form.querySelectorAll('input'); d.set.call(ins[0], ${JSON.stringify(CRED.username)}); ins[0].dispatchEvent(new Event('input', { bubbles: true })); d.set.call(ins[1], ${JSON.stringify(CRED.password)}); ins[1].dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit() })()`)
    await sleep(2500)
    const state = await evaluate(cdp, `(() => {
      const aside = document.querySelector('#module-sidebar')
      return { mounted: Boolean(aside), ready: document.body.innerText.includes('重要且紧急'), hasHandle: Boolean(aside?.querySelector('[role=separator]')), themeBtn: Boolean(aside?.querySelector('button[aria-label="切换主题"]')), collapseBtn: Boolean(aside?.querySelector('button[aria-label="折叠侧边栏"]')) }
    })()`)
    await evaluate(cdp, `document.querySelector('#module-sidebar button[aria-label="折叠侧边栏"]')?.click()`)
    await sleep(400)
    const collapsedWidth = await evaluate(cdp, `document.querySelector('#module-sidebar')?.getBoundingClientRect().width`)
    check('E 存储禁用：应用挂载、业务 ready、侧栏全功能（折叠 56）', state.mounted && state.ready && state.hasHandle && state.themeBtn && state.collapseBtn && Math.round(collapsedWidth) === 56, JSON.stringify({ ...state, collapsedWidth }))
    try { await shot(cdp, 'E-storage-denied-app-alive') } catch { check('E 截图', false, 'captureScreenshot 失败') }
    cdp.close()
  }

  // C 认证服务不可达（停本模块 QA 后端 → 网络失败 → unavailable）
  {
    const wasAlive = await backendAlive()
    if (!wasAlive) { check('C 前置：后端应在线', false, '20161 无响应') } else {
      // 停后端：杀 20161 监听进程（本模块 QA 自己的进程，允许）
      const { execSync } = await import('node:child_process')
      let pid = ''
      try { const out = execSync('netstat -ano | findstr :20161 | findstr LISTENING', { shell: 'cmd.exe' }).toString(); pid = out.trim().split(/\s+/).pop() } catch {}
      if (pid) { try { execSync(`taskkill /PID ${pid} /T /F`, { shell: 'cmd.exe' }) } catch {} }
      await sleep(1500)
      const cdp = await newTab()
      await cdp.send('Page.navigate', { url: `${FRONTEND}/todo` })
      await sleep(3000)
      const state = await evaluate(cdp, `({ url: location.pathname, unavailable: document.body.innerText.includes('暂时无法确认服务状态') || document.body.innerText.includes('服务状态暂不可确认') || document.body.innerText.includes('正在确认登录状态'), onLogin: location.pathname === '/login' })`).catch(() => ({}))
      check('C 后端不可达：可见等待/服务状态提示，不跳登录、不清会话', !state.onLogin && state.unavailable, JSON.stringify(state))
      try { await shot(cdp, 'C-backend-down-unavailable') } catch { check('C 截图', false, 'captureScreenshot 失败') }
      cdp.close()
    }
  }

  // 确保后端复活（供后续 A/B 与审核）
  if (!(await backendAlive())) {
    console.log('[fault] 重启本模块后端（C 场景曾停止它）')
    const { spawn: sp } = await import('node:child_process')
    sp('cmd.exe', ['/c', 'powershell', '-NoProfile', '-Command',
      "$env:PYTHONUTF8='1'; $env:PYTHONNOUSERSITE='1'; Start-Process -FilePath 'D:\\ProgramData\\miniconda3\\Scripts\\conda.exe' -ArgumentList 'run','--no-capture-output','-n','dev','python','tools/frontend_qa.py','serve','--module','frontend','--registry','" + REGISTRY + "' -WorkingDirectory '" + path.resolve('../backend') + "' -WindowStyle Hidden -RedirectStandardOutput '..\\.qa\\frontend\\backend-serve.log' -RedirectStandardError '..\\.qa\\frontend\\backend-serve.err.log'"], { stdio: 'ignore', detached: true }).unref()
    const ok = await (async () => { for (let i = 0; i < 30; i++) { if (await backendAlive()) return true; await sleep(1000) } return false })()
    check('C 后置：QA 后端已恢复', ok)
  } else { check('C 后置：QA 后端在线（未受影响）', true) }

  writeFileSync(path.join(EVIDENCE, 'fault-results.json'), JSON.stringify({ frontend: FRONTEND, finishedAt: new Date().toISOString(), results }, null, 2))
  const failed = results.filter(r => !r.pass)
  console.log(`\n故障注入结果：${results.length - failed.length}/${results.length} 通过`)
  browser.kill()
  process.exit(failed.length ? 1 : 0)
} catch (error) {
  console.error('故障注入执行失败：', error)
  try { browser.kill() } catch {}
  process.exit(1)
}
