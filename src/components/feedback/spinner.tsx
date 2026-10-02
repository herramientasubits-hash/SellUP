import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const DEFAULT_LABEL = "Cargando…";

const spinnerVariants = cva("inline-flex shrink-0 items-center justify-center", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-4",
      md: "size-6",
      lg: "size-8",
    },
    tone: {
      default: "text-muted-foreground",
      primary: "text-primary",
      /** Sobre una superficie primaria (`bg-primary`). */
      inverse: "text-primary-foreground",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

export interface SpinnerProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof spinnerVariants> {
  /** Texto para lectores de pantalla. Por defecto, «Cargando…». */
  label?: string;
  /**
   * Solo el dibujo, sin `role="status"` ni texto oculto: para un bloque que ya
   * anuncia su propio estado (un aviso «Validando…», una fila que carga).
   */
  decorative?: boolean;
}

/**
 * Spinner
 *
 * Indicador de carga indeterminado: un arco que gira sobre una pista tenue,
 * en el color del texto (`currentColor`). Con `prefers-reduced-motion` el arco
 * se queda quieto y el estado sigue anunciándose por `role="status"`.
 *
 * Es para una espera suelta (un panel, una sección que carga). Dentro de un
 * `Button` se sigue usando el icono que ya gira con el botón.
 *
 * @example
 * <Spinner size="sm" label="Cargando contactos" />
 * <Spinner tone="primary" />
 */
export function Spinner({
  size,
  tone,
  label = DEFAULT_LABEL,
  decorative = false,
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-live={decorative ? undefined : "polite"}
      aria-hidden={decorative ? true : undefined}
      data-slot="spinner"
      className={cn(spinnerVariants({ size, tone }), className)}
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="size-full animate-spin motion-reduce:animate-none"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {!decorative && <span className="sr-only">{label}</span>}
    </span>
  );
}

export { spinnerVariants };
