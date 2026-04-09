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
          <Skeleton class="h-10 w-4/5 mb-6" />
          
          <!-- Meta Information Skeleton -->
          <div class="flex flex-wrap items-center gap-4 mb-6 pb-6 border-b border-vscode-border">
            <Skeleton class="h-4 w-24" />
            <Skeleton class="h-4 w-32" />
            <Skeleton class="h-4 w-28" />
            <Skeleton class="h-4 w-20" />
          </div>
          
          <!-- Tags Skeleton -->
          <div class="flex flex-wrap gap-2 mb-6">
            <Skeleton class="h-6 w-16 rounded-full" />
            <Skeleton class="h-6 w-20 rounded-full" />
            <Skeleton class="h-6 w-14 rounded-full" />
          </div>
        </article>
        
        <!-- Content Skeleton -->
        <div class="space-y-6">
          <!-- Paragraphs -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-5/6" />
            <Skeleton class="h-4 w-4/5" />
          </div>
          
          <!-- Heading -->
          <Skeleton class="h-8 w-2/3" />
          
          <!-- More paragraphs -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-3/4" />
          </div>
          
          <!-- Code block skeleton -->
          <Skeleton class="h-32 w-full" />
          
          <!-- More content -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-5/6" />
          </div>
          
          <!-- Another heading -->
          <Skeleton class="h-8 w-1/2" />
          
          <!-- More paragraphs -->
          <div class="space-y-3">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-2/3" />
          </div>
        </div>
        
        <!-- Footer Skeleton -->
        <footer class="mt-12 pt-8 border-t border-vscode-border">
          <div class="flex items-center gap-3">
            <Skeleton class="h-10 w-20 rounded-md" />
            <Skeleton class="h-10 w-20 rounded-md" />
            <Skeleton class="h-10 w-20 rounded-md" />
          </div>
        </footer>
      </div>
      
      <!-- TOC Sidebar Skeleton -->
      <aside class="hidden lg:block w-64 flex-shrink-0">
        <div class="sticky top-14">
          <nav class="bg-vscode-bg-secondary border border-vscode-border rounded-vscode p-4">
            <Skeleton class="h-4 w-12 mb-3" />
            <div class="space-y-2">
              <Skeleton class="h-3 w-full" />
              <Skeleton class="h-3 w-4/5" />
              <Skeleton class="h-3 w-5/6 ml-4" />
              <Skeleton class="h-3 w-3/4" />
              <Skeleton class="h-3 w-full ml-4" />
              <Skeleton class="h-3 w-2/3" />
            </div>
          </nav>
        </div>
      </aside>
    </div>
  </div>
</template>
