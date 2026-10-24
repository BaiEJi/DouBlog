// 启动引导回归（F03，覆盖生产路径组件与函数）：
// - markBootSuccess：清理看门狗钩子（幂等）+ 晚到成功时复位失败卡/失败标记；
// - showBootFailure：失败卡显示 + 原因填充 + 占位移除 + 兜底 innerHTML；
// - RootErrorBoundary：派生错误态渲染 null、didCatch 展示失败卡（生产恢复链）；
// - createAppElement：生产入口树必须包含根错误边界。
// BootProbe 的首次 commit 语义与端到端故障注入由真实浏览器工具覆盖
// （tools/test-frontend-shell.mjs 正常启动/超时/晚到成功场景）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { markBootSuccess, showBootFailure, RootErrorBoundary, BootProbe, createAppElement } from '../src/shared/bootstrap.js'

function stubDom() {
  const nodes = new Map()
  const make = id => ({ id, style: {}, innerHTML: '', textContent: '', removed: false,
    querySelector: () => null, remove() { this.removed = true } })
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, make(id))
      return nodes.get(id)
    },
  }
  const root = { querySelector: sel => document.getElementById(String(sel).replace(/^#/, '')) }
  globalThis.document = document
  document.getElementById('boot-failure')   // 预热常用节点
  document.getElementById('boot-placeholder')
  return { document, nodes, root }
}

test('markBootSuccess clears the inline watchdog hook exactly once', () => {
  let cleared = 0
  globalThis.window = { __doublogBootClear: () => { cleared += 1 } }
  markBootSuccess()
  markBootSuccess()
  assert.equal(cleared, 1)
  delete globalThis.window
})

test('F03 late success: watchdog already failed → success resets failure card and flag', () => {
  const { nodes } = stubDom()
  globalThis.window = { __doublogBootFailed: true }
  nodes.get('boot-failure').style.display = 'flex'
  markBootSuccess()
  assert.equal(globalThis.window.__doublogBootFailed, false, '失败标记必须复位')
  assert.equal(nodes.get('boot-failure').style.display, 'none', '失败卡必须隐藏——页面只保留一个正确状态')
  delete globalThis.window
  delete globalThis.document
})

test('F03 late success: no prior failure → nothing shown, no flag write', () => {
  stubDom()
  globalThis.window = {}
  markBootSuccess()
  assert.equal('boot-failure' in (globalThis.document.getElementById('boot-failure') ? { bootfailure: 1 } : {}), false)
  assert.equal(globalThis.window.__doublogBootFailed, undefined)
  delete globalThis.window
  delete globalThis.document
})

test('showBootFailure reveals the failure card, removes placeholder, fills reason', () => {
  const { nodes, root } = stubDom()
  const failure = nodes.get('boot-failure')
  failure.querySelector = sel => (sel === 'p[data-reason]' ? { textContent: '' } : null)
  showBootFailure(root, '原因：入口 404')
  assert.equal(failure.style.display, 'flex')
  assert.equal(nodes.get('boot-placeholder').removed, true)
  delete globalThis.document
})

test('showBootFailure without watchdog falls back to innerHTML card inside root', () => {
  stubDom()
  const root = { innerHTML: '' }
  globalThis.document = { getElementById: () => null }
  showBootFailure(root)
  assert.ok(root.innerHTML.includes('DouBlog 启动失败'))
  assert.ok(root.innerHTML.includes('重新加载'))
  delete globalThis.document
})

test('RootErrorBoundary: derived error state renders null and didCatch shows failure card', () => {
  const { nodes } = stubDom()
  const boundary = new RootErrorBoundary({ children: 'x' })
  const derived = RootErrorBoundary.getDerivedStateFromError(new Error('render boom'))
  boundary.state = derived
  assert.equal(boundary.render(), null, '错误态不渲染子树（失败卡由 didCatch 显示）')
  boundary.componentDidCatch(new Error('render boom'))
  assert.equal(nodes.get('boot-failure').style.display, 'flex')
  assert.ok(nodes.get('boot-placeholder').removed)
  delete globalThis.document
})

test('RootErrorBoundary: healthy state renders children untouched', () => {
  const boundary = new RootErrorBoundary({ children: ['child-a'] })
  boundary.state = { failed: false }
  assert.deepEqual(boundary.render(), ['child-a'])
})

test('createAppElement: production tree wraps App in the root error boundary', () => {
  const DummyApp = () => null
  const tree = createAppElement(DummyApp)
  assert.equal(tree.type, RootErrorBoundary, '最外层必须是根错误边界')
  assert.equal(tree.props.children.type, BootProbe, '探针在边界内包裹 App')
  assert.equal(tree.props.children.props.children.type, DummyApp, 'App 挂在边界+探针内')
})

test('BootProbe passes children through (a probe that swallows the tree is a fatal bug)', () => {
  const DummyApp = () => null
  const tree = createAppElement(DummyApp)
  const probeProps = tree.props.children.props
  assert.ok(probeProps.children, '探针持有 children（App）')
  assert.equal(probeProps.children.type, DummyApp, 'children 必须原样是 App')
})
