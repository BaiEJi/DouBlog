import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-all duration-200 overflow-hidden cursor-default",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--vscode-accent-primary-subtle)] text-[var(--vscode-accent-primary)] hover:bg-[var(--vscode-accent-primary)] hover:text-[var(--vscode-text-inverse)]",
        primary:
          "border-transparent bg-[var(--vscode-accent-primary)] text-[var(--vscode-text-inverse)] hover:bg-[var(--vscode-accent-primary-hover)]",
        success:
          "border-transparent bg-[var(--vscode-accent-success-subtle)] text-[var(--vscode-accent-success)] hover:bg-[var(--vscode-accent-success)] hover:text-[var(--vscode-text-inverse)]",
        warning:
          "border-transparent bg-[var(--vscode-accent-warning-subtle)] text-[var(--vscode-accent-warning)] hover:bg-[var(--vscode-accent-warning)] hover:text-[var(--vscode-text-inverse)]",
        error:
          "border-transparent bg-[var(--vscode-accent-error-subtle)] text-[var(--vscode-accent-error)] hover:bg-[var(--vscode-accent-error)] hover:text-[var(--vscode-text-inverse)]",
        outline:
          "border-[var(--vscode-border)] text-[var(--vscode-text-primary)] hover:border-[var(--vscode-accent-primary)] hover:text-[var(--vscode-accent-primary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
