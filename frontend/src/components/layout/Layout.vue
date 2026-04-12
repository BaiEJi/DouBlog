<script setup lang="ts">
import { provide, ref, onMounted, onUnmounted } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import Lenis from 'lenis'
import Sidebar from '@/components/layout/Sidebar.vue'
import Header from '@/components/layout/Header.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'

/**
 * 移动端状态
 */
const isMobile = useMediaQuery('(max-width: 639px)')

/**
 * 平板状态
 */
const isTablet = useMediaQuery('(min-width: 640px) and (max-width: 1023px)')

/**
 * 桌面端状态
 */
const isDesktop = useMediaQuery('(min-width: 1024px)')

/**
 * 提供响应式状态给子组件
 */
provide('isMobile', isMobile)
provide('isTablet', isTablet)
provide('isDesktop', isDesktop)

/**
 * Lenis smooth scroll — targets <main> container, not window.
 * Respects prefers-reduced-motion by disabling smooth scroll.
 */
const contentRef = ref<HTMLElement | null>(null)
let lenis: Lenis | null = null
let rafId: number | null = null

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

function startLenis() {
  if (lenis) return
  const mainEl = document.getElementById('main-content')
  if (!mainEl || !contentRef.value) return

  lenis = new Lenis({
    wrapper: mainEl,
    content: contentRef.value,
    lerp: 0.1,
    smoothWheel: !prefersReducedMotion.value,
  })

  function raf(time: number) {
    lenis?.raf(time)
    rafId = requestAnimationFrame(raf)
  }
  rafId = requestAnimationFrame(raf)
}

function stopLenis() {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  lenis?.destroy()
  lenis = null
}

onMounted(() => {
  if (!prefersReducedMotion.value) {
    startLenis()
  }
})

onUnmounted(() => {
  stopLenis()
})
</script>

<template>
  <SidebarProvider :default-open="true">
    <a href="#main-content" class="skip-link">
      跳转到主要内容
    </a>
    
    <div class="flex-1 flex h-screen bg-vscode-bg-primary overflow-hidden">
      <Sidebar :collapsed="isTablet" />
      
      <!-- Main Content -->
      <SidebarInset class="flex-1 flex flex-col min-w-0">
        <Header />
        <main id="main-content" class="flex-1 overflow-auto scroll-smooth bg-vscode-bg-primary" role="main">
          <!-- Reading progress bar (CSS scroll-driven) -->
          <div class="reading-progress-bar" aria-hidden="true" />
          <div ref="contentRef">
            <slot />
          </div>
        </main>
      </SidebarInset>
    </div>
  </SidebarProvider>
</template>
