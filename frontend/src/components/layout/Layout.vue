<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted } from 'vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import Header from '@/components/layout/Header.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'

// Responsive state
const isMobile = ref(false)
const isTablet = ref(false)
const isDesktop = ref(true)
const isSidebarOpen = ref(true)

// Breakpoints (matching design tokens)
const MOBILE_BREAKPOINT = 640
const TABLET_BREAKPOINT = 1024

const checkViewport = () => {
  const width = window.innerWidth
  isMobile.value = width < MOBILE_BREAKPOINT
  isTablet.value = width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT
  isDesktop.value = width >= TABLET_BREAKPOINT
  
  // Auto-close sidebar on mobile
  if (isMobile.value) {
    isSidebarOpen.value = false
  } else {
    isSidebarOpen.value = true
  }
}

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const closeSidebar = () => {
  if (isMobile.value) {
    isSidebarOpen.value = false
  }
}

// Provide responsive state to children
provide('isMobile', isMobile)
provide('isTablet', isTablet)
provide('isDesktop', isDesktop)
provide('isSidebarOpen', isSidebarOpen)
provide('toggleSidebar', toggleSidebar)
provide('closeSidebar', closeSidebar)

onMounted(() => {
  checkViewport()
  window.addEventListener('resize', checkViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkViewport)
})
</script>

<template>
  <SidebarProvider :default-open="true">
    <a href="#main-content" class="skip-link">
      跳转到主要内容
    </a>
    
    <div class="flex h-screen bg-vscode-bg-primary overflow-hidden">
      <Sidebar :collapsed="isTablet" />
      
      <!-- Main Content -->
      <SidebarInset class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header @toggle-sidebar="toggleSidebar" />
        <main id="main-content" class="flex-1 overflow-auto scroll-smooth bg-vscode-bg-primary" role="main">
          <slot />
        </main>
      </SidebarInset>
    </div>
  </SidebarProvider>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--vscode-duration-normal) var(--vscode-ease-in-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
