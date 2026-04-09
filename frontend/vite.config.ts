import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    vue(),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
      filename: 'dist/stats.html'
    })
  ],
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
  build: {
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('pinia') || id.includes('vue-router')) {
              return 'vue-vendor'
            }
            if (id.includes('md-editor-v3')) {
              return 'markdown-editor'
            }
            if (id.includes('reka-ui') || id.includes('lucide-vue-next') || 
                id.includes('class-variance-authority') || id.includes('clsx') || 
                id.includes('tailwind-merge')) {
              return 'ui-vendor'
            }
            if (id.includes('axios') || id.includes('@vueuse/core') || id.includes('vue-sonner')) {
              return 'utils'
            }
          }
        },
        chunkFileNames(chunkInfo) {
          const facadeModuleId = chunkInfo.facadeModuleId 
            ? chunkInfo.facadeModuleId.split('/').pop() 
            : 'chunk'
          return `assets/${chunkInfo.name || facadeModuleId}-[hash].js`
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    cssCodeSplit: true,
  },
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      'axios',
      '@vueuse/core',
      'md-editor-v3',
    ],
  },
})
