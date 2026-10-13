import { Component } from 'react'

// Lazy route failures and render errors must leave navigation usable.
export default class ModuleErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { console.error('模块页面加载失败', error) }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    if (this.state.failed) return <div role="alert" className="rounded-2xl border border-red-500/20 bg-white dark:bg-white/[0.04] p-6"><h1 className="text-base font-semibold mb-2">页面加载失败</h1><p className="text-sm text-stone-500 dark:text-stone-400 mb-4">页面资源可能已更新。重新加载后再试。</p><button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm">重新加载</button></div>
    return this.props.children
  }
}
