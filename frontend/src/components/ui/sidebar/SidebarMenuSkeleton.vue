<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { cn } from "@/lib/utils"
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{
  showIcon?: boolean
  class?: HTMLAttributes["class"]
}>()

const width = computed(() => {
  return `${Math.floor(Math.random() * 40) + 50}%`
})
</script>

<template>
  <div
    data-slot="sidebar-menu-skeleton"
    data-sidebar="menu-skeleton"
    :class="cn('flex h-8 items-center gap-vscode-2 rounded-vscode-md px-vscode-2', props.class)"
  >
    <Skeleton
      v-if="showIcon"
      class="size-4 rounded-vscode-md"
      data-sidebar="menu-skeleton-icon"
    />

    <Skeleton
      class="h-4 max-w-[var(--skeleton-width)] flex-1"
      data-sidebar="menu-skeleton-text"
      :style="{ '--skeleton-width': width }"
    />
  </div>
</template>
