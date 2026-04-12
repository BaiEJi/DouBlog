<script setup lang="ts">
import Skeleton from '@/components/ui/skeleton/Skeleton.vue'
</script>

<template>
  <div class="max-w-7xl mx-auto px-6 py-8">
    <div class="flex gap-8">
      <!-- Main Content -->
      <div class="flex-1 min-w-0">
        <!-- Article Header -->
        <article class="mb-8">
          <!-- Title Skeleton -->
          <Skeleton class="h-10 w-4/5 mb-6 rounded-vscode-md" />
          
          <!-- Meta Information Skeleton -->
          <div class="flex flex-wrap items-center gap-4 mb-6 pb-6 border-b" style="border-color: var(--vscode-border-light);">
            <Skeleton class="h-4 w-24 rounded-vscode-md" />
            <Skeleton class="h-4 w-32 rounded-vscode-md" />
            <Skeleton class="h-4 w-28 rounded-vscode-md" />
            <Skeleton class="h-4 w-20 rounded-vscode-md" />
          </div>
          
          <!-- Tags Skeleton -->
          <div class="flex flex-wrap gap-2 mb-6">
            <Skeleton class="h-6 w-16 rounded-vscode-full" />
            <Skeleton class="h-6 w-20 rounded-vscode-full" />
            <Skeleton class="h-6 w-14 rounded-vscode-full" />
          </div>
        </article>
        
        <!-- Content Skeleton -->
        <div class="space-y-6">
          <!-- Paragraphs -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full rounded-vscode-md" />
            <Skeleton class="h-4 w-5/6 rounded-vscode-md" />
            <Skeleton class="h-4 w-4/5 rounded-vscode-md" />
          </div>
          
          <!-- Heading -->
          <Skeleton class="h-8 w-2/3 rounded-vscode-md" />
          
          <!-- More paragraphs -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full rounded-vscode-md" />
            <Skeleton class="h-4 w-full rounded-vscode-md" />
            <Skeleton class="h-4 w-3/4 rounded-vscode-md" />
          </div>
          
          <!-- Code block skeleton -->
          <Skeleton class="h-32 w-full rounded-vscode-lg" style="background-color: var(--vscode-code-background);" />
          
          <!-- More content -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full rounded-vscode-md" />
            <Skeleton class="h-4 w-5/6 rounded-vscode-md" />
          </div>
          
          <!-- Another heading -->
          <Skeleton class="h-8 w-1/2 rounded-vscode-md" />
          
          <!-- More paragraphs -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full rounded-vscode-md" />
            <Skeleton class="h-4 w-full rounded-vscode-md" />
            <Skeleton class="h-4 w-2/3 rounded-vscode-md" />
          </div>
        </div>
        
        <!-- Footer Skeleton -->
        <footer class="mt-12 pt-8 border-t" style="border-color: var(--vscode-border-light);">
          <div class="flex items-center gap-3">
            <Skeleton class="h-10 w-20 rounded-vscode-md" />
            <Skeleton class="h-10 w-20 rounded-vscode-md" />
            <Skeleton class="h-10 w-20 rounded-vscode-md" />
          </div>
        </footer>
      </div>
      
      <!-- TOC Sidebar Skeleton -->
      <aside class="hidden lg:block w-64 flex-shrink-0">
        <div class="sticky top-14">
          <nav class="toc-skeleton rounded-vscode-lg p-4">
            <Skeleton class="h-4 w-12 mb-3 rounded-vscode-md" />
            <div class="space-y-2">
              <Skeleton class="h-3 w-full rounded-vscode-md" />
              <Skeleton class="h-3 w-4/5 rounded-vscode-md" />
              <Skeleton class="h-3 w-5/6 ml-4 rounded-vscode-md" />
              <Skeleton class="h-3 w-3/4 rounded-vscode-md" />
              <Skeleton class="h-3 w-full ml-4 rounded-vscode-md" />
              <Skeleton class="h-3 w-2/3 rounded-vscode-md" />
            </div>
          </nav>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.toc-skeleton {
  background-color: var(--vscode-bg-secondary);
  border: 1px solid var(--vscode-border-light);
}
</style>
