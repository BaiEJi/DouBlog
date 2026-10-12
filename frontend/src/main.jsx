import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App'

// 不用 StrictMode：gamemap 的 React Flow 画布依赖非受控节点与松手时序，
// 开发期双渲染会破坏拖动（gamemap 源项目同款决策）；生产构建无差异。
createRoot(document.getElementById('root')).render(<App />)
