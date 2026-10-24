import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// QA 模式（显式 FRONTEND_QA=1）：启动前硬性校验隔离边界——代理缺失/回落
// 受保护端口(60100/60101)/API 非同源时直接抛错拒绝启动，而不是靠约定。
// 生产（默认）行为保持不变：代理缺省回落 60100。
const QA_MODE = process.env.FRONTEND_QA === '1'
const QA_PROTECTED_PORTS = [60100, 60101]
const QA_ALLOWED_BACKENDS = (process.env.QA_ALLOWED_BACKENDS || 'http://127.0.0.1:20161').split(',')

if (QA_MODE) {
  const base = process.env.VITE_API_BASE
  const proxy = process.env.VITE_API_PROXY
  const fail = (reason) => {
    throw new Error(`[vite.config QA 拒绝启动] ${reason}`)
  }
  if (base !== '/') fail(`VITE_API_BASE 必须为 '/'（当前：${JSON.stringify(base)}）`)
  if (!proxy) fail('QA 模式必须显式提供 VITE_API_PROXY（缺省会回落受保护端口 60100）')
  if (QA_PROTECTED_PORTS.some(port => proxy.includes(`:${port}`))) fail(`VITE_API_PROXY 指向受保护端口：${proxy}`)
  if (!QA_ALLOWED_BACKENDS.includes(proxy)) fail(`VITE_API_PROXY 不在本模块白名单：${proxy}（允许：${QA_ALLOWED_BACKENDS.join(', ')}）`)
  if (!process.env.FRONTEND_QA_PORT) fail('QA 模式必须显式 FRONTEND_QA_PORT（登记端口）')
  console.log(`[vite.config QA] 边界校验通过：API_BASE=/ proxy=${proxy} port=${process.env.FRONTEND_QA_PORT}`)
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 跨能力包引用统一用 @/（包内用相对路径）；必须解析为真实文件系统路径，
    // URL 式 '/src' 会让 @tailwindcss/vite 的模块图扫描漏掉所有 @/ 引用的文件 → utilities 缺失
    alias: { '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src') },
  },
  server: {
    port: 60101,
    host: '0.0.0.0',
    proxy: {
      // 正则键精确匹配路径段：纯前缀 '/api' 会把 /apihub 页面路由也吞进代理（页面 404）
      '^/api(/|$)': process.env.VITE_API_PROXY || 'http://127.0.0.1:60100',
    },
  },
  // 生产 QA（vite preview）：代理与 SPA fallback 行为须与 dev 一致；
  // 同样使用正则键，避免 /apihub 页面路由被 /api 前缀代理吞掉。
  preview: {
    port: Number(process.env.FRONTEND_QA_PORT || 60101),
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '^/api(/|$)': process.env.VITE_API_PROXY || 'http://127.0.0.1:60100',
    },
  },
}))
