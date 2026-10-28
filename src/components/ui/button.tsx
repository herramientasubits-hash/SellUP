import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent bg-clip-padding text-sm font-medium transition-all duration-200 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Como flux-ui (estilo vega): sólido en medium, que se aclara al 80% al pasar.
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80",
        // Thema: el destructivo es un tinte, no un bloque rojo. El rojo sólido
        // queda para la confirmación final (variant="destructive-solid").
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        "destructive-solid":
          "bg-destructive text-destructive-foreground font-semibold shadow-card hover:bg-destructive/90 focus-visible:ring-destructive/30",
        // Sólidos de estado, para la acción que confirma algo con significado
        // propio (marcar duplicado, aprobar). Evitan colorear un Button a mano.
        success:
          "bg-success text-primary-foreground font-semibold shadow-card hover:bg-success/90 focus-visible:ring-success/30",
        warning:
          "bg-warning text-primary-foreground font-semibold shadow-card hover:bg-warning/90 focus-visible:ring-warning/30",
        outline:
          "border-border bg-background text-foreground shadow-xs hover:bg-muted aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary",
        ghost:
          "text-foreground hover:bg-foreground/4 aria-expanded:bg-foreground/4",
        link: "text-primary underline-offset-4 hover:underline font-semibold",
        // Acciones de IA, como «Piezas de IA» de UBITS: las tres en pastilla.
        // Primario = relleno degradado, sin borde ni ícono, que se invierte al pasar
        // el cursor; secundario = el contorno normal con el orbe al inicio (sin borde
        // en degradado); terciario = sin borde, ícono en el color de IA.
        ai: "su-ai-gradient rounded-full border-0",
        "ai-outline":
          "su-ai-icons rounded-full border-border bg-background text-foreground shadow-xs hover:bg-muted aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        "ai-ghost": "su-ai-ghost su-ai-icons text-foreground",
      },
      // Alturas de flux-ui: xs 24 · sm 32 · default 36 · lg 40 (xl queda para el login).
      size: {
        default: "h-9 gap-1.5 px-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-sm px-2.5",
        lg: "h-10 gap-1.5 px-2.5",
        xl: "h-12 w-full rounded-lg px-8 text-base font-semibold",
        icon: "size-9",
        "icon-lg": "size-10",
        "icon-sm": "size-8 rounded-sm",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
      },
    },
    // El primario de IA lleva más aire a los lados que un botón normal (UBITS: 20px y 16px en sm).
    compoundVariants: [
      { variant: "ai", size: ["default", "lg"], className: "rounded-full px-5" },
      { variant: "ai", size: "sm", className: "rounded-full px-4" },
      { variant: "ai-outline", size: ["sm", "xs"], className: "rounded-full" },
    ],
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
