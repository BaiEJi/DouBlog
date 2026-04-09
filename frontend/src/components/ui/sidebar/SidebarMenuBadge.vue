<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-menu-badge"
    data-sidebar="menu-badge"
    :class="cn(
      'text-vscode-text-secondary pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-vscode-md px-vscode-1 text-vscode-xs font-vscode-medium tabular-nums select-none',
      'peer-hover/menu-button:text-vscode-accent-primary peer-data-[active=true]/menu-button:text-vscode-accent-primary',
      'peer-data-[size=sm]/menu-button:top-1',
      'peer-data-[size=default]/menu-button:top-1.5',
      'peer-data-[size=lg]/menu-button:top-2.5',
      'group-data-[collapsible=icon]:hidden',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
