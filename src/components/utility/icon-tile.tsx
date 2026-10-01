import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const iconTileVariants = cva(
  "inline-flex shrink-0 items-center justify-center [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        primary: "bg-primary/10 text-primary",
        neutral: "bg-muted text-muted-foreground",
        positive: "bg-success/10 text-success",
        negative: "bg-destructive/10 text-destructive",
        warning: "bg-warning/15 text-warning",
        info: "bg-info/10 text-info",
        /** La identidad de IA del sistema: el degradado con el glifo en claro. */
        ai: "bg-ai-gradient text-primary-foreground",
      },
      size: {
        sm: "size-7 [&>svg]:size-3.5",
        md: "size-9 [&>svg]:size-4.5",
        lg: "size-12 [&>svg]:size-6",
      },
      shape: {
        rounded: "",
        circle: "rounded-full",
      },
    },
    compoundVariants: [
      { shape: "rounded", size: "sm", className: "rounded-md" },
      { shape: "rounded", size: "md", className: "rounded-xl" },
      { shape: "rounded", size: "lg", className: "rounded-xl" },
    ],
    defaultVariants: { tone: "primary", size: "md", shape: "rounded" },
  },
);

export type IconTileTone = NonNullable<VariantProps<typeof iconTileVariants>["tone"]>;

export interface IconTileProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof iconTileVariants> {
  /** El icono (p. ej. `<Sparkles />`). Su tamaño lo fija la baldosa. */
  icon: React.ReactNode;
}

/**
 * IconTile — port de Thema `utility/IconTile.tsx`.
 *
 * Un icono sobre una baldosa tintada: el tinte suave del tono y el glifo en el
 * color pleno. Es el chip de icono del sistema (cabeceras de diálogo y de
 * página, filas de menú, tarjetas): no se vuelve a armar a mano con
 * `flex size-9 items-center justify-center rounded-xl bg-primary/10`.
 *
 * @example
 * <IconTile icon={<Trash2 />} tone="negative" />
 * <IconTile icon={<Sparkles />} tone="ai" size="lg" shape="circle" />
 */
export function IconTile({ icon, tone, size, shape, className, ...props }: IconTileProps) {
  return (
    <span
      aria-hidden
      data-slot="icon-tile"
      data-tone={tone ?? "primary"}
      className={cn(iconTileVariants({ tone, size, shape }), className)}
      {...props}
    >
      {icon}
    </span>
  );
}
