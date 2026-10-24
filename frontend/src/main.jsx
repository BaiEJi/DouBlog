import './index.css'
import App from './app/App'
import { mountApplication, showBootFailure } from './shared/bootstrap.js'

// 不用 StrictMode：gamemap 的 React Flow 画布依赖非受控节点与松手时序，
// 开发期双渲染会破坏拖动（gamemap 源项目同款决策）；生产构建无差异。
// App 为静态导入：入口模块图加载失败时本脚本不执行，由 index.html 的
// 内联看门狗在截止时间后显示失败卡片；挂载前的同步异常走 showBootFailure；
// App 根级渲染错误由 bootstrap 的 RootErrorBoundary 兜底；启动成功以
// BootProbe 首次 commit 为准（不把"安排 render"当作"已显示页面"）。
const rootElement = document.getElementById('root')
try {
  mountApplication(rootElement, App)
} catch (error) {
  console.error('DouBlog 挂载失败', error)
  showBootFailure(rootElement, error?.message ? `原因：${String(error.message)}` : '')
}
