// 多模块可视化取证采集（原生 CDP + Edge headless，非 playwright）。
// 默认用户登录后 SPA 依次导航，每页等待业务锚点、双拍取第二张（稳定帧），
// 保存前用页面内断言确认状态；截图交 zcode image 子代理审查（F08）。
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f }
const REGISTRY = arg('registry')
const OUT = path.resolve('../.qa/frontend/evidence-visual')
const BROWSER = arg('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
if (!REGISTRY) { console.error('需要 --registry'); process.exit(2) }
const entry = JSON.parse(readFileSync(REGISTRY, 'utf-8')).modules.frontend
const FRONTEND = `http://127.0.0.1:${entry.frontend_port}`
const CRED = JSON.parse(readFileSync('../.qa/frontend/qa-credentials.json', 'utf-8'))
mkdirSync(OUT, { recursive: true })

const PAGES = [
  { name: 'v2-01-login', path: '/login', anchor: `document.body.innerText.includes('登录')`, note: '登录页（公开外壳）' },
  { name: 'v2-02-todo-light', path: '/todo', anchor: `document.body.innerText.includes('重要且紧急') && Boolean(document.querySelector('#module-sidebar'))`, note: 'Todo 明色展开 220' },
  { name: 'v2-03-todo-dark', path: '/todo', theme: 'dark', base: `document.body.innerText.includes('重要且紧急')`, anchor: `document.documentElement.classList.contains('dark') && document.body.innerText.includes('重要且紧急')`, note: 'Todo 暗色展开' },
  { name: 'v2-04-todo-collapsed-dark', path: '/todo', theme: 'dark', collapsed: true, base: `document.body.innerText.includes('重要且紧急')`, anchor: `Math.round(document.querySelector('#module-sidebar').getBoundingClientRect().width) === 56 && document.documentElement.classList.contains('dark')`, note: 'Todo 暗色折叠 56（一级图标窄轨）' },
  { name: 'v2-05-todo-calendar-light', path: '/todo?v=calendar', theme: 'light', anchor: `document.querySelector('.module-content main') && document.querySelector('.module-content main').innerText.length > 30`, note: 'Todo 日历视图（长菜单）' },
  { name: 'v2-06-blog-light', path: '/blog?ws=2', theme: 'light', anchor: `document.body.innerText.includes('前端优化验收库') && document.body.innerText.includes('DouBlog 前端优化说明')`, note: 'Blog 种子库文章卡片' },
  { name: 'v2-07-post-detail', path: '/post/1', theme: 'light', anchor: `document.body.innerText.includes('首帧与启动恢复')`, note: '文章详情三栏' },
  { name: 'v2-08-create-post', path: '/create', theme: 'light', anchor: `Boolean(document.querySelector('#module-sidebar')) && document.body.innerText.includes('新建')`, note: '新建文章' },
  { name: 'v2-09-vault-lock', path: '/vault', theme: 'light', anchor: `document.querySelector('#module-sidebar') && document.body.innerText.length > 100`, note: '密码库锁态' },
  { name: 'v2-10-gamemap', path: '/gamemap', theme: 'light', anchor: `document.querySelector('#module-sidebar') && document.body.innerText.includes('剧情图谱')`, note: '剧情图谱（30 人物种子）' },
  { name: 'v2-11-mindmap-editor', path: '/mindmap/1', theme: 'light', anchor: `document.body.innerText.includes('前端优化导图')`, note: '导图编辑器（3 节点种子）' },
  { name: 'v2-12-notfound', path: '/no-such-visual', theme: 'light', anchor: `document.body.innerText.includes('页面不存在')`, note: '404 页' },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const browser = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=20168', '--user-data-dir=' + path.resolve('../.qa/frontend/chrome-profile-visual'),
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => { try { browser.kill() } catch {} })

async function main() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { try { const r = await fetch('http://127.0.0.1:20168/json/version'); if (r.ok) break } catch {} await sleep(300) }
  const target = await (await fetch('http://127.0.0.1:20168/json/new?about:blank', { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let seq = 0; const pending = new Map(); const listeners = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
    else listeners.forEach(l => l(m))
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 超时`)) }, 25000)
    pending.set(id, { res: v => { clearTimeout(timer); res(v) }, rej: e => { clearTimeout(timer); rej(e) } })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  const waitUntil = async (expr, timeout, label) => {
    const dl = Date.now() + timeout
    while (Date.now() < dl) { try { if (await evaluate(expr)) return true } catch {} await sleep(250) }
    throw new Error(`${label} 超时`)
  }

  // 登录（默认用户）
  await send('Page.navigate', { url: `${FRONTEND}/login?next=/todo` })
  await sleep(1500)
  await evaluate(`(() => { const form = document.querySelector('form'); const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); const ins = form.querySelectorAll('input'); d.set.call(ins[0], ${JSON.stringify(CRED.username)}); ins[0].dispatchEvent(new Event('input', { bubbles: true })); d.set.call(ins[1], ${JSON.stringify(CRED.password)}); ins[1].dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit() })()`)
  await waitUntil(`location.pathname !== '/login'`, 15000, '登录')

  const index = []
  for (const page of PAGES) {
    // 恢复展开态（上一页的折叠偏好持久化在 localStorage，非折叠页需展开）
    if (!page.collapsed) {
      try { await evaluate(`document.querySelector('#module-sidebar button[aria-label=\"展开侧边栏\"]')?.click()`) ; await sleep(400) } catch { /* 页面未就绪忽略 */ }
    }
    await send('Page.navigate', { url: `${FRONTEND}${page.path}` })
    // 基础锚点（不含主题/折叠条件）
    const baseAnchor = page.base || page.anchor
    await waitUntil(baseAnchor, 20000, page.name)
    // 主题在页面内切换（SPA 状态更新，无整页重载）
    const wantDark = page.theme === 'dark'
    const isDark = await evaluate(`document.documentElement.classList.contains('dark')`)
    if (isDark !== wantDark) {
      await evaluate(`document.querySelector('#module-sidebar button[aria-label="切换主题"]')?.click()`)
      await waitUntil(`document.documentElement.classList.contains('dark') === ${wantDark}`, 8000, `${page.name}:theme`)
    }
    // 折叠态
    if (page.collapsed) {
      await evaluate(`document.querySelector('#module-sidebar button[aria-label="折叠侧边栏"]')?.click()`)
      await waitUntil(`Math.round(document.querySelector('#module-sidebar').getBoundingClientRect().width) === 56`, 8000, `${page.name}:collapsed`)
    }
    await sleep(700)
    await send('Page.captureScreenshot', { format: 'png' })   // 第一拍（触发 paint，丢弃）
    await sleep(450)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${page.name}.png`
    writeFileSync(path.join(OUT, file), Buffer.from(shot.data, 'base64'))
    const meta = await evaluate(`({ url: location.pathname + location.search, dark: document.documentElement.classList.contains('dark'), width: Math.round(document.querySelector('#module-sidebar')?.getBoundingClientRect().width || 0), viewport: innerWidth + 'x' + innerHeight, user: ${JSON.stringify(CRED.username)} })`)
    index.push({ file, note: page.note, ...meta, at: new Date().toISOString() })
    console.log(`shot ${file} ${JSON.stringify(meta)}`)
  }
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ frontend: FRONTEND, browser: 'Edge headless CDP', pages: index, finishedAt: new Date().toISOString() }, null, 2))
  console.log(`\n采集完成 ${index.length}/${PAGES.length} → ${OUT}`)
  try { browser.kill() } catch {}
}
main().then(() => process.exit(0)).catch(e => { console.error('采集失败：', e); try { browser.kill() } catch {}; process.exit(1) })
