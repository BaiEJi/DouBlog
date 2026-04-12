<script setup lang="ts">
import { inject } from 'vue'
import PostTree from '@/components/post/PostTree.vue'
import SidebarResizeHandle from '@/components/layout/SidebarResizeHandle.vue'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar'
import { FileText } from 'lucide-vue-next'
import type { Ref } from 'vue'

interface Props {
  collapsed?: boolean
}

withDefaults(defineProps<Props>(), {
  collapsed: false
})

/**
 * 移动端状态
 */
const isMobile = inject<Ref<boolean>>('isMobile')

/**
 * 关闭侧边栏函数
 */
const closeSidebar = inject<() => void>('closeSidebar')
</script>

<template>
  <ShadcnSidebar collapsible="offcanvas" role="navigation" aria-label="文章导航" class="bg-vscode-bg-secondary border-r border-vscode-border">
    <!-- Sidebar Header -->
    <SidebarHeader class="border-b border-vscode-border bg-vscode-bg-primary">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child class="px-vscode-4 py-vscode-3">
            <router-link to="/" class="flex items-center gap-vscode-3" aria-label="返回首页">
              <div class="flex aspect-square size-10 items-center justify-center rounded-vscode-xl bg-vscode-accent-primary text-vscode-text-inverse shadow-sm"
                   aria-hidden="true">
                <FileText class="size-5" />
              </div>
              <div class="flex flex-col gap-0.5 leading-none">
                <span class="font-vscode-bold text-vscode-text-primary text-vscode-lg">DouBlog</span>
                <span class="text-vscode-xs text-vscode-text-muted">Knowledge Base</span>
              </div>
            </router-link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    
    <!-- Sidebar Content -->
    <SidebarContent class="px-vscode-2 py-vscode-3">
      <SidebarGroup>
        <SidebarGroupLabel id="articles-label" class="px-vscode-3 py-vscode-2 text-vscode-text-primary font-vscode-medium">Articles</SidebarGroupLabel>
        <SidebarGroupContent @click="isMobile && closeSidebar && closeSidebar()" aria-labelledby="articles-label">
          <PostTree />
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    
    <!-- Sidebar Resize Handle -->
    <SidebarResizeHandle />
  </ShadcnSidebar>
</template>
