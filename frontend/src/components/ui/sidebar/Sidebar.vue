<script setup lang="ts">
import type { SidebarProps } from "."
import { cn } from "@/lib/utils"
import { Sheet, SheetContent } from '@/components/ui/sheet'
import SheetDescription from '@/components/ui/sheet/SheetDescription.vue'
import SheetHeader from '@/components/ui/sheet/SheetHeader.vue'
import SheetTitle from '@/components/ui/sheet/SheetTitle.vue'
import { SIDEBAR_WIDTH_MOBILE, useSidebar } from "./utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SidebarProps>(), {
  side: "left",
  variant: "sidebar",
  collapsible: "offcanvas",
})

const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
</script>

<template>
  <div
    v-if="collapsible === 'none'"
    data-slot="sidebar"
    :class="cn('bg-vscode-bg-secondary text-vscode-text-primary flex h-full w-[var(--sidebar-width)] flex-col border-r border-vscode-border', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </div>

  <Sheet v-else-if="isMobile" :open="openMobile" v-bind="$attrs" @update:open="setOpenMobile">
    <SheetContent
      data-sidebar="sidebar"
      data-slot="sidebar"
      data-mobile="true"
      :side="side"
      class="bg-vscode-bg-secondary text-vscode-text-primary w-[var(--sidebar-width)] p-0 [&>button]:hidden border-r border-vscode-border"
      :style="{
        '--sidebar-width': SIDEBAR_WIDTH_MOBILE,
      }"
    >
      <SheetHeader class="sr-only">
        <SheetTitle>Sidebar</SheetTitle>
        <SheetDescription>Displays the mobile sidebar.</SheetDescription>
      </SheetHeader>
      <div class="flex h-full w-full flex-col">
        <slot />
      </div>
    </SheetContent>
  </Sheet>

  <div
    v-else
    class="group peer text-vscode-text-primary hidden md:block"
    data-slot="sidebar"
    :data-state="state"
    :data-collapsible="state === 'collapsed' ? collapsible : ''"
    :data-variant="variant"
    :data-side="side"
  >
    <div
      :class="cn(
        'w-0 bg-transparent',
        'group-data-[collapsible=offcanvas]:w-0',
        'group-data-[side=right]:rotate-180',
        variant === 'floating' || variant === 'inset'
          ? 'group-data-[collapsible=icon]:w-0'
          : 'group-data-[collapsible=icon]:w-0',
      )"
    />
    <div
      :class="cn(
        'fixed inset-y-0 z-vscode-fixed hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-vscode-normal ease-vscode-in-out md:flex',
        side === 'left'
          ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--vscode-sidebar-width)*-1)]'
          : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--vscode-sidebar-width)*-1)]',
        variant === 'floating' || variant === 'inset'
          ? 'p-vscode-2 group-data-[collapsible=icon]:w-[calc(var(--vscode-sidebar-width-collapsed)+(--spacing(4))+2px)]'
          : 'group-data-[collapsible=icon]:w-[var(--vscode-sidebar-width-collapsed)] group-data-[side=left]:border-r group-data-[side=right]:border-l border-vscode-border',
        props.class,
      )"
      v-bind="$attrs"
    >
      <div
        data-sidebar="sidebar"
        class="bg-vscode-bg-secondary group-data-[variant=floating]:border-vscode-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-vscode-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-vscode-sm"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
