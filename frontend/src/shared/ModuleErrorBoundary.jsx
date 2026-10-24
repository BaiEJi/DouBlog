import { Component } from 'react'
import { Link } from 'react-router-dom'

// 路由懒加载失败与内容渲染错误的兜底：公共壳与侧栏导航保持可用，
// 错误卡只在内容画布内展示；公共壳自身的错误由更外层的 RouteBoundary 兜底。
// React.lazy 的失败 promise 可能被缓存——“重新加载”执行真实页面重载，
// 不做不可靠的进程内重试。
export default class ModuleErrorBoundary extends Component {
  state = { failed: false, reason: '' }
  static getDerivedStateFromError(error) {
    return { failed: true, reason: error?.message ? String(error.message) : '' }
  }
  componentDidCatch(error) { console.error('模块页面加载失败', error) }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false, reason: '' })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="rounded-2xl border border-red-500/20 dark:border-red-500/25 bg-white dark:bg-white/[0.04] p-6">
        <h1 className="text-base font-semibold mb-2">页面加载失败</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-1">
          页面资源可能已更新或暂时不可用。侧边栏仍可导航到其他页面。
        </p>
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
          如本页有未保存的正文、图谱或导图输入，请先复制或下载后再重新加载。
        </p>
        {this.state.reason && <p className="mb-4 font-mono text-xs text-stone-400 dark:text-stone-500 break-all">{this.state.reason}</p>}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm">重新加载</button>
          <Link to="/" className="px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">返回工作台</Link>
        </div>
      </div>
    )
  }
}
