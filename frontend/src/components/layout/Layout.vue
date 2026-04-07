<script setup lang="ts">
import Sidebar from '@/components/layout/Sidebar.vue'
import Header from '@/components/layout/Header.vue'
</script>

<template>
  <div class="flex h-screen bg-vscode-bg-primary">
    <aside class="w-sidebar bg-vscode-bg-secondary">
      <Sidebar />
    </aside>
    <div class="flex-1 flex flex-col">
      <Header />
      <main class="flex-1 overflow-auto scroll-smooth">
        <slot />
      </main>
    </div>
  </div>
</template>
