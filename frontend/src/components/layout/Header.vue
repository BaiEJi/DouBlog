<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ThemeToggle from './ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Search } from 'lucide-vue-next'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'

/**
 * 命令面板组件（异步加载）
 */
const CommandPalette = defineAsyncComponent(() => 
  import('@/components/CommandPalette.vue')
)

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

/**
 * 命令面板引用
 */
const commandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)

/**
 * 退出登录
 */
const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}

/**
 * 导航菜单项
 */
const navigationItems = [
  { label: '首页', path: '/' },
  { label: '新建文章', path: '/post/new' },
]

/**
 * 检查导航项是否激活
 * 
 * @param {string} path - 路径
 * @returns {boolean} 是否激活
 */
const isActive = (path: string) => {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(path)
}

/**
 * 导航到指定路径
 * 
 * @param {string} path - 目标路径
 */
const navigateTo = (path: string) => {
  router.push(path)
}

/**
 * 打开命令面板
 */
const openCommandPalette = () => {
  commandPaletteRef.value?.toggleCommandPalette()
}
</script>

<template>
  <header class="header-glass flex items-center justify-between h-vscode-header px-vscode-4 sm:px-vscode-6"
          role="banner">
    <div class="flex items-center gap-vscode-3 flex-1 min-w-0">
      <!-- Sidebar Toggle -->
      <SidebarTrigger 
        class="text-vscode-text-primary hover:bg-vscode-interactive-hover"
        aria-label="切换侧边栏" />
    </div>

    <!-- Center: Navigation Menu (desktop only) -->
    <NavigationMenu class="hidden md:flex" aria-label="主导航">
      <NavigationMenuList>
        <NavigationMenuItem v-for="item in navigationItems" :key="item.path">
          <NavigationMenuLink
            as="a"
            :class="[
              navigationMenuTriggerStyle(),
              isActive(item.path) ? 'bg-vscode-bg-active text-vscode-text-primary' : ''
            ]"
            @click="navigateTo(item.path)"
            :aria-current="isActive(item.path) ? 'page' : undefined"
          >
            {{ item.label }}
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>

    <div class="flex items-center gap-vscode-4">
      <!-- Search Button -->
      <Button
        variant="ghost"
        size="sm"
        @click="openCommandPalette"
        aria-label="搜索 (按 ⌘K)"
        class="hidden sm:flex items-center gap-vscode-2 text-vscode-text-muted hover:text-vscode-text-primary hover:bg-vscode-interactive-hover"
      >
        <Search class="size-4" aria-hidden="true" />
        <span class="text-vscode-size-sm">搜索</span>
        <kbd class="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded-vscode-sm border border-vscode-border bg-vscode-bg-tertiary px-1.5 font-mono text-[10px] font-medium text-vscode-text-muted sm:flex"
             aria-hidden="true">
          <span class="text-vscode-size-xs">⌘</span>K
        </kbd>
      </Button>

      <span
        v-if="authStore.username"
        class="text-vscode-size-sm text-vscode-text-secondary hidden sm:inline"
        aria-label="当前用户"
      >
        {{ authStore.username }}
      </span>

      <ThemeToggle />

      <Button
        variant="outline"
        size="default"
        @click="handleLogout"
        aria-label="退出登录"
      >
        退出登录
      </Button>
    </div>

    <!-- Command Palette -->
    <CommandPalette ref="commandPaletteRef" />
  </header>
</template>

<style scoped>
.header-glass {
  flex-shrink: 0;
  
  /* 淡蓝色毛玻璃效果 - 更透明 */
  background: linear-gradient(
    135deg,
    rgba(210, 235, 255, 0.55) 0%,
    rgba(180, 215, 255, 0.45) 50%,
    rgba(160, 200, 255, 0.50) 100%
  );
  backdrop-filter: blur(20px) saturate(200%);
  -webkit-backdrop-filter: blur(20px) saturate(200%);
  
  /* 淡蓝色底部边框 */
  border-bottom: 1px solid rgba(100, 170, 255, 0.25);
  
  /* 柔和阴影 */
  box-shadow: 
    0 2px 20px rgba(80, 140, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

/* 暗色模式下的深蓝色毛玻璃 */
:global(.dark) .header-glass {
  background: linear-gradient(
    135deg,
    rgba(25, 45, 80, 0.70) 0%,
    rgba(15, 35, 65, 0.65) 50%,
    rgba(20, 40, 75, 0.70) 100%
  );
  backdrop-filter: blur(24px) saturate(220%);
  -webkit-backdrop-filter: blur(24px) saturate(220%);
  
  border-bottom: 1px solid rgba(60, 120, 255, 0.15);
  
  box-shadow: 
    0 2px 20px rgba(0, 40, 120, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
</style>
