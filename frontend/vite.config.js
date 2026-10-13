import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
      '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:60100',
      '/openapi': process.env.VITE_API_PROXY || 'http://127.0.0.1:60100',
    },
  }
})
