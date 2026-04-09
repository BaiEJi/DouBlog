<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Primitive } from "reka-ui"
import { cn } from "@/lib/utils"

const props = withDefaults(defineProps<PrimitiveProps & {
  size?: "sm" | "md"
  isActive?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  as: "a",
  size: "md",
})
</script>

<template>
  <Primitive
    data-slot="sidebar-menu-sub-button"
    data-sidebar="menu-sub-button"
    :as="as"
    :as-child="asChild"
    :data-size="size"
    :data-active="isActive"
    :class="cn(
      'text-vscode-text-secondary ring-vscode-border-focus hover:bg-vscode-interactive-hover hover:text-vscode-text-primary active:bg-vscode-interactive-active active:text-vscode-text-primary [&>svg]:text-vscode-accent-primary flex h-7 min-w-0 -translate-x-px items-center gap-vscode-2 overflow-hidden rounded-vscode-md px-vscode-2 outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
      'data-[active=true]:bg-vscode-interactive-selected data-[active=true]:text-vscode-accent-primary',
      size === 'sm' && 'text-vscode-xs',
      size === 'md' && 'text-vscode-sm',
      'group-data-[collapsible=icon]:hidden',
      props.class,
    )"
  >
    <slot />
  </Primitive>
</template>
