<script setup lang="ts">
import { inject } from 'vue'
import PostTree from '@/components/post/PostTree.vue'
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
  SidebarRail,
} from '@/components/ui/sidebar'
import { FileText } from 'lucide-vue-next'
import type { Ref } from 'vue'

interface Props {
  collapsed?: boolean
}

withDefaults(defineProps<Props>(), {
  collapsed: false
})

const isMobile = inject<Ref<boolean>>('isMobile')
const closeSidebar = inject<() => void>('closeSidebar')
</script>

<template>
  <ShadcnSidebar collapsible="icon" role="navigation" aria-label="文章导航">
    <!-- Sidebar Header -->
    <SidebarHeader class="border-b border-vscode-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child>
            <router-link to="/" class="flex items-center gap-vscode-3" aria-label="返回首页">
              <div class="flex aspect-square size-8 items-center justify-center rounded-vscode-lg bg-vscode-accent-primary text-vscode-text-inverse"
                   aria-hidden="true">
                <FileText class="size-4" />
              </div>
              <div class="flex flex-col gap-0.5 leading-none">
                <span class="font-vscode-semibold text-vscode-text-primary">DouBlog</span>
                <span class="text-vscode-xs text-vscode-text-muted">Knowledge Base</span>
              </div>
            </router-link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    
    <!-- Sidebar Content -->
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel id="articles-label">Articles</SidebarGroupLabel>
        <SidebarGroupContent @click="isMobile && closeSidebar && closeSidebar()" aria-labelledby="articles-label">
          <PostTree />
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    
    <!-- Sidebar Rail (for collapsing) -->
    <SidebarRail aria-label="侧边栏折叠控制" />
  </ShadcnSidebar>
</template>
