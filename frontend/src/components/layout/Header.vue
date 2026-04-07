<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ThemeToggle from './ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { usePostStore } from '@/stores/post'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ChevronRight, Search } from 'lucide-vue-next'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'

const CommandPalette = defineAsyncComponent(() => 
  import('@/components/CommandPalette.vue')
)

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const postStore = usePostStore()

const commandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}

interface BreadcrumbItem {
  label: string
  path: string
}

const breadcrumbs = computed<BreadcrumbItem[]>(() => {
  const items: BreadcrumbItem[] = [{ label: 'Home', path: '/' }]
  
  // For post detail or edit pages
  if (route.name === 'PostDetail' || route.name === 'PostEdit') {
    const currentPost = postStore.currentPost
    if (currentPost) {
      // Build parent hierarchy
      const parentChain: BreadcrumbItem[] = []
      let post = currentPost.parent
      
      // Traverse up the parent chain
      while (post) {
        parentChain.unshift({
          label: post.title,
          path: `/post/${post.slug}`
        })
        post = post.parent
      }
      
      items.push(...parentChain)
      
      // Add current post
      if (route.name === 'PostDetail') {
        items.push({
          label: currentPost.title,
          path: `/post/${currentPost.slug}`
        })
      } else {
        // For edit page, show the post title then "Edit"
        items.push({
          label: currentPost.title,
          path: `/post/${currentPost.slug}`
        })
        items.push({
          label: 'Edit',
          path: `/post/${currentPost.slug}/edit`
        })
      }
    }
  } else if (route.name === 'PostNew') {
    items.push({ label: 'New Post', path: '/post/new' })
  }
  
  return items
})

const navigateTo = (path: string) => {
  router.push(path)
}

// Navigation items for the main menu
const navigationItems = [
  { label: 'Home', path: '/' },
  { label: 'New Post', path: '/post/new' },
]

// Check if a navigation item is active
const isActive = (path: string) => {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(path)
}

// Open command palette
const openCommandPalette = () => {
  commandPaletteRef.value?.toggleCommandPalette()
}
</script>

<template>
  <header class="flex items-center justify-between h-[var(--vscode-header-height)] px-vscode-4 sm:px-vscode-6 bg-vscode-bg-tertiary border-b border-vscode-border"
          role="banner">
    <div class="flex items-center gap-vscode-3 flex-1 min-w-0">
      <!-- Sidebar Toggle -->
      <SidebarTrigger 
        class="text-vscode-text-primary hover:bg-vscode-interactive-hover"
        aria-label="切换侧边栏" />
      
      <!-- Breadcrumbs (hidden on mobile) -->
      <nav class="hidden sm:flex items-center gap-1.5 text-vscode-size-sm overflow-x-auto"
           role="navigation"
           aria-label="面包屑导航">
        <template v-for="(item, index) in breadcrumbs" :key="item.path">
          <button
            v-if="index < breadcrumbs.length - 1"
            @click="navigateTo(item.path)"
            class="text-vscode-text-secondary hover:text-vscode-text-primary transition-colors truncate max-w-[200px]"
            :aria-label="`导航到 ${item.label}`"
          >
            {{ item.label }}
          </button>
          <span
            v-else
            class="text-vscode-text-primary font-vscode-medium truncate max-w-[200px]"
            aria-current="page"
          >
            {{ item.label }}
          </span>
          <ChevronRight
            v-if="index < breadcrumbs.length - 1"
            class="w-4 h-4 text-vscode-text-muted flex-shrink-0"
            aria-hidden="true"
          />
        </template>
      </nav>
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
        <span class="text-vscode-size-sm">Search</span>
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
        Logout
      </Button>
    </div>

    <!-- Command Palette -->
    <CommandPalette ref="commandPaletteRef" />
  </header>
</template>
