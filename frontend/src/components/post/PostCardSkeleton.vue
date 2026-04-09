<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'
import Skeleton from '@/components/ui/skeleton/Skeleton.vue'
</script>

<template>
  <Card class="cursor-pointer">
    <CardContent>
      <!-- Title Skeleton -->
      <Skeleton class="h-6 w-3/4 mb-3" />
      
      <!-- Summary Skeleton -->
      <div class="space-y-2 mb-3">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-5/6" />
      </div>
      
      <!-- Meta Skeleton -->
      <div class="flex items-center justify-between">
        <Skeleton class="h-3 w-20" />
        <Skeleton class="h-3 w-24" />
      </div>
    </CardContent>
  </Card>
</template>
