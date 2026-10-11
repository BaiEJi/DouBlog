# DouBlog Frontend

React 19 + Vite 8 + Tailwind CSS 4 单页应用，端口 **60101**。

完整的架构说明、渲染管线、页面组件与已知限制见项目根目录 **[../frontend.md](../frontend.md)**；API 契约见 **[../api.md](../api.md)**；仓库整体说明见 **[../README.md](../README.md)**。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（60101，热更新）
npm run build      # 生产构建 → dist/
npm run lint       # ESLint
```

## 快速上手

- 所有后端请求必须走各能力包的 `api.js`（底层 `src/shared/client.js`，项目内唯一的端口定义处；凭据不进前端，会话 Cookie 认证）
- Markdown 渲染统一走 `src/shared/md.js`，勿在页面里自建 markdown-it 实例
- 验收门槛：`npm run build` 零报错 + 首页/详情/新建/编辑四页浏览器走查
