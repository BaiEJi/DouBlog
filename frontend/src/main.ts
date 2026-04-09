import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/styles/index.css'
import 'md-editor-v3/lib/style.css'
import { performanceMonitor } from './utils/performance'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

if (import.meta.env.DEV) {
  performanceMonitor.measurePageLoad()
  window.addEventListener('load', () => {
    setTimeout(() => {
      performanceMonitor.logReport()
    }, 1000)
  })
}

app.mount('#app')
