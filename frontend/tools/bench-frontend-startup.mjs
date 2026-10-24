// 公共前端模块启动性能 A/B（原生 CDP + Edge headless，零新依赖，非 playwright）。
// v1.1.0 F06：baseline（git archive 713744e 导出构建）vs candidate（本 worktree 构建）
// 串行复用登记端口 20160；场景矩阵冷/暖各 3 轮×5 样本；独立 browser profile；
// 每次导航确认新文档（performance.timeOrigin 变化）；失败/缺样非零退出。
//
// 用法（cwd = 本模块 frontend/）：
//   node tools/bench-frontend-startup.mjs --module frontend --registry <r> --prepare-baseline
//   node tools/bench-frontend-startup.mjs --module frontend --registry <r> --mode ab
//   node tools/bench-frontend-startup.mjs --module frontend --registry <r> --mode single  # 仅当前 preview
// 前置：backend（frontend_qa.py serve --seed，默认用户）已在 20161 运行；
// --mode ab 会独占 20160（运行前请停掉常驻 preview；工具不杀占用者，占用即报错）。
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const MODULE = arg('module', 'frontend')
const REGISTRY = arg('registry')
const BROWSER = arg('browser', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
const QA_ROOT = path.resolve('../.qa/frontend')
const EVIDENCE_DIR = path.join(QA_ROOT, 'evidence')
const BASELINE_DIR = path.join(QA_ROOT, 'baseline', 'frontend')
const FRONTEND_DIR = path.resolve('.')
const ROUNDS = Number(arg('rounds', '3'))
const SAMPLES = Number(arg('samples', '5'))
const BASE_COMMIT = arg('base', '713744ea4b0078b08f0fb41f79ed03c76a29e827')
const MODE = arg('mode', 'single')

if (!REGISTRY) { console.error('需要 --registry <collaboration.json>'); process.exit(2) }
const registry = JSON.parse(readFileSync(REGISTRY, 'utf-8'))
const entry = registry.modules[MODULE]
if (!entry) { console.error(`登记表没有 ${MODULE}`); process.exit(2) }
const FRONTEND_PORT = entry.frontend_port
const BACKEND_PORT = entry.backend_port
const FRONTEND = `http://127.0.0.1:${FRONTEND_PORT}`
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`
let CRED = null
try { CRED = JSON.parse(readFileSync(path.join(QA_ROOT, 'qa-credentials.json'), 'utf-8')) } catch {
  console.error('缺少凭据文件（先启动 frontend_qa.py serve）'); process.exit(2)
}
mkdirSync(EVIDENCE_DIR, { recursive: true })

// 场景矩阵：shell/ready 为页面内表达式（两组一致；重页面用真实种子数据锚点）
const SCENARIOS = [
  { key: 'portal', url: '/', shell: `Boolean(document.querySelector('#root')) && document.body.innerText.includes('工作台')`, ready: `document.body.innerText.includes('思维导图') && document.body.innerText.includes('MyTodo')` },
  { key: 'todo', url: '/todo', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.body.innerText.includes('重要且紧急') && document.body.innerText.includes('修复线上白屏问题')` },
  { key: 'todo-calendar', url: '/todo?v=calendar', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.querySelector('.module-content main') && document.querySelector('.module-content main').innerText.length > 30` },
  { key: 'blog', url: '/blog', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.body.innerText.includes('思考，记录，沉淀')` },
  { key: 'post-detail', url: '/post/1', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.body.innerText.includes('DouBlog 前端优化说明') && document.body.innerText.includes('首帧与启动恢复')` },
  { key: 'mindmap-list', url: '/mindmap', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.body.innerText.includes('我的导图')` },
  { key: 'mindmap-editor', url: '/mindmap/1', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.body.innerText.includes('前端优化导图')` },
  { key: 'gamemap', url: '/gamemap', shell: `Boolean(document.querySelector('#module-sidebar'))`, ready: `document.querySelector('.module-content') && document.querySelector('.module-content').innerText.length > 30` },
]

const run = (cmd, args, cwd, env) => new Promise((resolve) => {
  const child = spawn(cmd, args, { cwd, stdio: 'ignore', env: { ...process.env, ...env } })
  child.on('exit', code => resolve(code))
  child.on('error', () => resolve(-1))
})

async function prepareBaseline() {
  const repoRoot = path.resolve('..')  // 本模块 worktree 根（git worktree 支持 archive）
  console.log(`[bench] 准备基线：git archive ${BASE_COMMIT}:frontend → ${BASELINE_DIR}`)
  mkdirSync(path.join(QA_ROOT, 'baseline'), { recursive: true })
  const baselineRoot = path.join(QA_ROOT, 'baseline').replace(/\\/g, '/')
  const repo = repoRoot.replace(/\\/g, '/')
  execSync(`git -C "${repo}" archive ${BASE_COMMIT} frontend | tar -x -C "${baselineRoot}"`, { shell: true, stdio: 'inherit' })
  if (!existsSync(path.join(BASELINE_DIR, 'package.json'))) { console.error('基线导出失败'); process.exit(1) }
  console.log('[bench] 基线 npm ci（独立 node_modules）')
  const ci = await run('cmd.exe', ['/c', 'npm.cmd', 'ci'], BASELINE_DIR, {})
  if (ci !== 0) { console.error(`基线 npm ci 失败 exit=${ci}`); process.exit(1) }
  console.log('[bench] 基线生产构建（VITE_API_BASE=/）')
  const build = await run('cmd.exe', ['/c', 'npm.cmd', 'run', 'build'], BASELINE_DIR, { VITE_API_BASE: '/', MSYS_NO_PATHCONV: '1' })
  if (build !== 0) { console.error(`基线构建失败 exit=${build}`); process.exit(1) }
  console.log('[bench] 基线就绪')
}

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener('message', ev => this.onMessage(ev)) }
  onMessage(ev) {
    const msg = JSON.parse(ev.data)
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else { for (const l of this.listeners) l(msg) }
  }
  on(listener) { this.listeners.push(listener) }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  close() { this.ws.close() }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) { try { return await fn() } catch (e) { lastError = e } await sleep(120) }
  throw new Error(`${label} 超时: ${lastError?.message || ''}`)
}
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null }

async function startPreview(cwd, note) {
  const occupied = await fetch(`http://127.0.0.1:${FRONTEND_PORT}/`).then(() => true).catch(() => false)
  if (occupied) { console.error(`端口 ${FRONTEND_PORT} 已被占用——请先停止常驻 preview（工具不杀占用者）`); process.exit(2) }
  const env = {
    VITE_API_BASE: '/', VITE_API_PROXY: `http://127.0.0.1:${BACKEND_PORT}`,
    FRONTEND_QA_PORT: String(FRONTEND_PORT), FRONTEND_QA: '1', MSYS_NO_PATHCONV: '1',
  }
  const child = spawn('cmd.exe', ['/c', 'npm.cmd', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', String(FRONTEND_PORT), '--strictPort'],
    { cwd, stdio: 'ignore', env: { ...process.env, ...env } })
  await waitFor(async () => { const r = await fetch(`http://127.0.0.1:${FRONTEND_PORT}/`); if (!r.ok) throw new Error(r.status); return true }, 20000, `preview ${note}`)
  return child
}
function stopPreview(child) {
  if (!child) return Promise.resolve()
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', `taskkill /PID ${child.pid} /T /F`], { stdio: 'ignore' }).on('exit', () => setTimeout(resolve, 900))
    } else { child.kill('SIGTERM'); setTimeout(resolve, 900) }
  })
}

async function sampleGroup({ label, rounds, samples }) {
  const profile = path.join(QA_ROOT, `bench-profile-${label}`)
  const cdpPort = 20169
  const browser = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })
  process.on('exit', () => { try { browser.kill() } catch {} })
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json()), 15000, '浏览器')
  await sleep(500)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  // F05 等价围栏：发送前拦截，仅放行本模块前后端
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  const ALLOWED = new Set([FRONTEND, BACKEND])
  let violations = 0
  cdp.on(async msg => {
    if (msg.method !== 'Fetch.requestPaused') return
    const { requestId, request } = msg.params
    let origin = ''; try { origin = new URL(request.url).origin } catch {}
    const ok = ALLOWED.has(origin)
    if (!ok) violations += 1
    try { await cdp.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId } : { requestId, errorReason: 'BlockedByClient' }) } catch {}
  })
  // 组内登录（默认用户）
  await cdp.send('Page.navigate', { url: `${FRONTEND}/login?next=/todo` })
  await sleep(1200)
  await evaluate(cdp, `(() => { const form = document.querySelector('form'); const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); const ins = form.querySelectorAll('input'); d.set.call(ins[0], ${JSON.stringify(CRED.username)}); ins[0].dispatchEvent(new Event('input', { bubbles: true })); d.set.call(ins[1], ${JSON.stringify(CRED.password)}); ins[1].dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit() })()`)
  await waitFor(async () => { const at = await evaluate(cdp, 'location.pathname'); if (at === '/login') throw new Error('pending'); return at }, 15000, '登录')
  console.log(`[bench:${label}] 已登录（默认用户），开始采样（白名单违例=${violations}）`)

  const out = []
  const failures = []
  let lastTimeOrigin = await evaluate(cdp, 'performance.timeOrigin')
  const sampleOnce = async (scenario, kind) => {
    const stamp = Date.now()
    await cdp.send('Page.navigate', { url: `${FRONTEND}${scenario.url}` })
    await waitFor(async () => {
      const t = await evaluate(cdp, 'performance.timeOrigin')
      if (t === lastTimeOrigin) throw new Error('same-document')
      lastTimeOrigin = t
      return t
    }, 15000, `新文档 ${scenario.url}`)
    const shellAt = await waitFor(async () => { if (!(await evaluate(cdp, `Boolean(${scenario.shell})`))) throw new Error('shell'); return Date.now() }, 20000, `shell ${scenario.key}`)
    const readyAt = await waitFor(async () => { if (!(await evaluate(cdp, `Boolean(${scenario.ready})`))) throw new Error('ready'); return Date.now() }, 25000, `ready ${scenario.key}`)
    out.push({ scenario: scenario.key, kind, shellMs: shellAt - stamp, readyMs: readyAt - stamp })
  }
  for (const scenario of SCENARIOS) {
    for (let round = 1; round <= rounds; round++) {
      for (let i = 0; i < samples; i++) {
        try { await sampleOnce(scenario, 'cold') } catch (e) { failures.push({ scenario: scenario.key, kind: 'cold', round, i, error: String(e.message || e) }) }
      }
      for (let i = 0; i < samples; i++) {
        try { await sampleOnce(scenario, 'warm') } catch (e) { failures.push({ scenario: scenario.key, kind: 'warm', round, i, error: String(e.message || e) }) }
      }
    }
    process.stdout.write(`[${label}] ${scenario.key}:${out.filter(s => s.scenario === scenario.key).length} `)
  }
  console.log('')
  cdp.close()
  try { browser.kill() } catch {}
  return { label, samples: out, failures, violations }
}

async function main() {
  if (process.argv.includes('--prepare-baseline')) { await prepareBaseline(); return 0 }

  const groups = []
  if (MODE === 'ab') {
    if (!existsSync(path.join(BASELINE_DIR, 'dist', 'index.html'))) { console.error('基线产物缺失：先运行 --prepare-baseline'); process.exit(2) }
    const basePreview = await startPreview(BASELINE_DIR, 'baseline')
    try { groups.push(await sampleGroup({ label: 'baseline', rounds: ROUNDS, samples: SAMPLES })) } finally { await stopPreview(basePreview) }
  }
  const candPreview = MODE === 'ab' ? await startPreview(FRONTEND_DIR, 'candidate') : null
  try {
    if (MODE === 'ab') await waitFor(async () => { const r = await fetch(`http://127.0.0.1:${FRONTEND_PORT}/`); if (!r.ok) throw new Error(); return true }, 20000, 'candidate preview')
    groups.push(await sampleGroup({ label: 'candidate', rounds: ROUNDS, samples: SAMPLES }))
  } finally { if (candPreview) await stopPreview(candPreview) }

  const report = { mode: MODE, frontend: FRONTEND, backend: BACKEND, defaultUser: CRED.username, rounds: ROUNDS, samples: SAMPLES, scenarios: SCENARIOS.map(s => s.key), groups: {}, finishedAt: new Date().toISOString() }
  let anyFailure = false
  for (const g of groups) {
    if (g.failures.length || g.violations) anyFailure = true
    report.groups[g.label] = { violations: g.violations, failureCount: g.failures.length, failures: g.failures.slice(0, 20), perScenario: {} }
    for (const scenario of SCENARIOS) {
      for (const kind of ['cold', 'warm']) {
        const shell = g.samples.filter(s => s.scenario === scenario.key && s.kind === kind).map(s => s.shellMs).sort((a, b) => a - b)
        const ready = g.samples.filter(s => s.scenario === scenario.key && s.kind === kind).map(s => s.readyMs).sort((a, b) => a - b)
        report.groups[g.label].perScenario[`${scenario.key}:${kind}`] = {
          n: ready.length,
          shellMedian: percentile(shell, 0.5), shellP95: percentile(shell, 0.95),
          readyMedian: percentile(ready, 0.5), readyP95: percentile(ready, 0.95),
        }
      }
    }
  }
  if (MODE === 'ab') {
    report.comparison = {}
    for (const scenario of SCENARIOS) {
      const key = `${scenario.key}:cold`
      const base = report.groups.baseline.perScenario[key].readyMedian
      const cand = report.groups.candidate.perScenario[key].readyMedian
      report.comparison[scenario.key] = {
        baselineReadyMedian: base, candidateReadyMedian: cand,
        deltaMs: cand != null && base != null ? cand - base : null,
        deltaPercent: cand != null && base ? ((cand - base) / base * 100) : null,
      }
      console.log(`[A/B 冷ready中位] ${scenario.key}: baseline=${base}ms candidate=${cand}ms Δ=${cand != null && base != null ? ((cand - base) / base * 100).toFixed(1) : '?'}%`)
    }
  }
  const outPath = path.join(EVIDENCE_DIR, `startup-ab-${Date.now()}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`结果写入 ${outPath}；失败=${anyFailure ? '有（非零退出）' : '0'}`)
  return anyFailure ? 1 : 0
}

main().then(code => process.exit(code)).catch(error => { console.error('A/B 执行失败：', error); process.exit(1) })
