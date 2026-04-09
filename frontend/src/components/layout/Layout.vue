<script setup lang="ts">
import { provide } from 'vue'
import { useMediaQuery } from '@vueuse/core'
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
          <slot />
        </main>
      </SidebarInset>
    </div>
  </SidebarProvider>
</template>
