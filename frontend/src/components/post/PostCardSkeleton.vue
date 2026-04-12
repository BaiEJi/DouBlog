<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'
import Skeleton from '@/components/ui/skeleton/Skeleton.vue'
</script>

<template>
  <Card class="skeleton-card cursor-pointer overflow-hidden">
    <CardContent class="p-5">
      <!-- Title Skeleton -->
      <Skeleton class="h-6 w-3/4 mb-3 rounded-vscode-md" />
      
      <!-- Summary Skeleton -->
      <div class="space-y-2.5 mb-4">
        <Skeleton class="h-4 w-full rounded-vscode-md" />
        <Skeleton class="h-4 w-5/6 rounded-vscode-md" />
      </div>
      
      <!-- Tags Skeleton -->
      <div class="flex gap-2 mb-4">
        <Skeleton class="h-5 w-14 rounded-vscode-full" />
        <Skeleton class="h-5 w-16 rounded-vscode-full" />
      </div>
      
      <!-- Meta Skeleton -->
      <div class="flex items-center justify-between border-t border-vscode-border-light pt-3">
        <Skeleton class="h-3 w-20 rounded-vscode-md" />
        <Skeleton class="h-3 w-24 rounded-vscode-md" />
      </div>
    </CardContent>
  </Card>
</template>

<style scoped>
.skeleton-card {
  border-color: var(--vscode-border-light);
  box-shadow: var(--vscode-shadow-xs);
}
</style>
