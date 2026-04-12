<script setup lang="ts">
import { SidebarMenuItem } from '@/components/ui/sidebar'
</script>

<template>
  <!-- Tree Items Skeleton -->
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" style="padding-left: 24px;" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" style="padding-left: 24px;" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" style="padding-left: 24px;" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" style="padding-left: 40px;" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" />
  </SidebarMenuItem>
  <SidebarMenuItem>
    <div class="skeleton-item h-9 rounded-vscode-md" />
  </SidebarMenuItem>
</template>

<style scoped>
.skeleton-item {
  background-color: var(--vscode-bg-tertiary);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
