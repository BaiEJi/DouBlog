<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-inset"
    :class="cn(
      'bg-vscode-bg-primary relative flex flex-1 flex-col',
      'transition-[margin,width] duration-vscode-normal ease-vscode-in-out',
      'peer-data-[variant=sidebar]:w-[calc(100%-var(--sidebar-width))] peer-data-[variant=sidebar]:ml-[var(--sidebar-width)]',
      'peer-data-[state=collapsed]:peer-data-[variant=sidebar]:w-[calc(100%-var(--sidebar-width-icon))] peer-data-[state=collapsed]:peer-data-[variant=sidebar]:ml-[var(--sidebar-width-icon)]',
      'peer-data-[variant=sidebar]:peer-data-[collapsible=offcanvas]:peer-data-[state=collapsed]:w-full peer-data-[variant=sidebar]:peer-data-[collapsible=offcanvas]:peer-data-[state=collapsed]:ml-0',
      'md:peer-data-[variant=inset]:m-vscode-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-vscode-xl md:peer-data-[variant=inset]:shadow-vscode-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-vscode-2',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
