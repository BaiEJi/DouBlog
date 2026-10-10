import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 跨能力包引用统一用 @/（包内用相对路径）；必须解析为真实文件系统路径，
    // URL 式 '/src' 会让 @tailwindcss/vite 的模块图扫描漏掉所有 @/ 引用的文件 → utilities 缺失
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 60101,
    host: '0.0.0.0'
  }
})
