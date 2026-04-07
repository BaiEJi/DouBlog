<script setup lang="ts">
import type { NavigationMenuLinkEmits, NavigationMenuLinkProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  NavigationMenuLink,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<NavigationMenuLinkProps & { class?: HTMLAttributes["class"] }>()
const emits = defineEmits<NavigationMenuLinkEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <NavigationMenuLink
    data-slot="navigation-menu-link"
    v-bind="forwarded"
    :class="cn(
      'flex flex-col gap-1 rounded-sm p-2 text-sm transition-[color,background-color,box-shadow] focus-visible:ring-4 focus-visible:outline-1',
      '[&_svg:not([class*=\'text-\'])]:text-vscode-text-secondary [&_svg:not([class*=\'size-\'])]:size-4',
      'text-vscode-text-primary hover:bg-vscode-bg-hover hover:text-vscode-text-primary',
      'focus:bg-vscode-bg-hover focus:text-vscode-text-primary',
      'focus-visible:ring-vscode-border-focus/30',
      'data-[active]:bg-vscode-accent-primary-subtle data-[active]:text-vscode-text-primary',
      'data-[active]:hover:bg-vscode-accent-primary-subtle',
      'data-[active]:focus:bg-vscode-accent-primary-subtle',
      props.class,
    )"
  >
    <slot />
  </NavigationMenuLink>
</template>
