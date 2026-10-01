import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent bg-clip-padding text-sm font-medium transition-all duration-200 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold shadow-card hover:bg-brand-hover",
        // Thema: el destructivo es un tinte, no un bloque rojo. El rojo sólido
        // queda para la confirmación final (variant="destructive-solid").
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        "destructive-solid":
          "bg-destructive text-destructive-foreground font-semibold shadow-card hover:bg-destructive/90 focus-visible:ring-destructive/30",
        // Sólidos de estado, para la acción que confirma algo con significado
        // propio (marcar duplicado, aprobar). Evitan colorear un Button a mano.
        success:
          "bg-success text-white font-semibold shadow-card hover:bg-success/90 focus-visible:ring-success/30",
        warning:
          "bg-warning text-white font-semibold shadow-card hover:bg-warning/90 focus-visible:ring-warning/30",
        outline:
          "border-border bg-card text-foreground hover:bg-surface-muted aria-expanded:bg-surface-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "text-foreground hover:bg-surface-muted aria-expanded:bg-surface-muted dark:hover:bg-muted/60",
        link: "text-primary underline-offset-4 hover:underline font-semibold",
      },
      size: {
        default: "h-10 px-4",
        xs: "h-7 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-6 text-sm font-semibold",
        xl: "h-12 w-full rounded-lg px-8 text-base font-semibold",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
        "icon-xs": "h-7 w-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
