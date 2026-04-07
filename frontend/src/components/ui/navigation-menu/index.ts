import { cva } from "class-variance-authority"

export { default as NavigationMenu } from "./NavigationMenu.vue"
export { default as NavigationMenuContent } from "./NavigationMenuContent.vue"
export { default as NavigationMenuIndicator } from "./NavigationMenuIndicator.vue"
export { default as NavigationMenuItem } from "./NavigationMenuItem.vue"
export { default as NavigationMenuLink } from "./NavigationMenuLink.vue"
export { default as NavigationMenuList } from "./NavigationMenuList.vue"
export { default as NavigationMenuTrigger } from "./NavigationMenuTrigger.vue"
export { default as NavigationMenuViewport } from "./NavigationMenuViewport.vue"

export const navigationMenuTriggerStyle = cva(
  "group inline-flex h-9 w-max items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: [
          "bg-vscode-bg-primary text-vscode-text-primary",
          "hover:bg-vscode-bg-hover hover:text-vscode-text-primary",
          "focus:bg-vscode-bg-hover focus:text-vscode-text-primary",
          "focus-visible:ring-vscode-border-focus",
          "data-[state=open]:bg-vscode-bg-active data-[state=open]:text-vscode-text-primary",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
