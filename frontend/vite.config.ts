import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteMockServe } from 'vite-plugin-mock'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), viteMockServe({ mockPath: './mock', enable: true })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 60101,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:60100',
        changeOrigin: true,
      },
    },
  },
})
