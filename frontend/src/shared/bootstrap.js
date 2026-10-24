// 启动引导（生产路径）：main.jsx 直接调用 mountApplication，测试也覆盖同一函数。
// 职责链：
// 1. App 静态导入失败 → 整个入口脚本不执行 → index.html 内联看门狗 20s 后显示失败卡；
// 2. 挂载前的同步异常 → main.jsx try/catch → showBootFailure；
// 3. App 根级渲染错误 → RootErrorBoundary 捕获（不依赖 Router/业务模块）→ showBootFailure；
// 4. App 首次有效 commit → BootProbe 的 passive effect → markBootSuccess
//    （不把"安排 render"当作"已显示页面"；若看门狗已显示失败卡，复位失败态，
//    保证页面只有一个正确状态——资源晚到且应用成功时不残留失败卡）。
import { Component, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

export function markBootSuccess() {
  if (typeof window === 'undefined') return
  if (typeof window.__doublogBootClear === 'function') {
    try { window.__doublogBootClear() } finally {
      // 幂等由引导侧保证：即使看门狗函数未自删也不会二次触发
      window.__doublogBootClear = undefined
    }
  }
  // 看门狗已触发（资源晚到但应用 commit 成功）：复位失败标记并隐藏失败卡
  if (window.__doublogBootFailed) {
    window.__doublogBootFailed = false
    if (typeof document !== 'undefined') {
      const failure = document.getElementById('boot-failure')
      if (failure) failure.style.display = 'none'
      const placeholder = document.getElementById('boot-placeholder')
      if (placeholder) placeholder.remove()
    }
  }
}

export function showBootFailure(rootElement, message) {
  markBootSuccess()
  const placeholder = rootElement?.querySelector?.('#boot-placeholder')
    ?? (typeof document !== 'undefined' ? document.getElementById('boot-placeholder') : null)
  placeholder?.remove?.()
  const failure = typeof document !== 'undefined' ? document.getElementById('boot-failure') : null
  if (failure) {
    if (message) {
      const reason = failure.querySelector('p[data-reason]')
      if (reason) reason.textContent = String(message)
    }
    failure.style.display = 'flex'
    return
  }
  // 看门狗脚本缺失（异常环境）时退化为 root 内的错误卡片
  if (rootElement) {
    rootElement.innerHTML = `
<div>
  <h1>DouBlog 启动失败</h1>
  <p>页面程序加载失败，可能是网络问题或版本已更新。</p>
  <p>请重新加载；若持续失败，请检查服务是否已启动。</p>
  <button type="button" onclick="window.location.reload()">重新加载</button>
  <a href="/">返回工作台</a>
</div>`
  }
}

/** 根级错误边界：App 整树渲染失败时的最后防线（在 Router/业务边界之外），
 * 不依赖任何尚未加载的模块；错误落到启动失败卡（含手动重载，不自动刷新）。 */
export class RootErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) {
    console.error('DouBlog 根级渲染失败', error)
    const root = typeof document !== 'undefined' ? document.getElementById('root') : null
    showBootFailure(root, error?.message ? `原因：${String(error.message)}` : '')
  }
  render() { return this.state.failed ? null : this.props.children }
}

/** 启动探针：挂进 App 树，passive effect 只在首次有效 commit 后执行一次——
 * 保证"启动成功"以真实 commit 为准，而不是 render() 被调用。
 * 必须透传 children（探针包住 App，绝不能吞掉应用树）。 */
export function BootProbe({ children }) {
  useEffect(() => { markBootSuccess() }, [])
  return children
}

/** 生产入口：组合 根错误边界 + 启动探针 + App（App 由 main.jsx 注入，
 * 保持本模块为纯 .js、可被 Node 测试直接加载并覆盖同一组合逻辑）。 */
export function createAppElement(App) {
  return createElement(RootErrorBoundary, null,
    createElement(BootProbe, null, createElement(App)))
}

export function mountApplication(rootElement, App) {
  const root = createRoot(rootElement)
  root.render(createAppElement(App))
  return root
}
