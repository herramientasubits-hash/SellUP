import * as React from "react";

import { cn } from "@/lib/utils";

export interface MovingBorderBeamProps {
  /** Lo que tarda la luz en dar la vuelta, en milisegundos. */
  duration?: number;
  /** Grosor del borde que recorre, en píxeles. */
  borderWidth?: number;
  className?: string;
}

/**
 * El borde que recorre (Thema · `MovingBorderBeam`).
 *
 * Thema mueve un punto de luz con framer-motion; aquí es un cono que gira sobre
 * una propiedad registrada (`--su-beam-angle`) y se recorta al anillo del borde
 * con una máscara. El color sale de los tokens de IA del tema (`.su-border-beam`
 * en `globals.css`), el radio se hereda del contenedor, y con
 * `prefers-reduced-motion` no se pinta.
 */
export function MovingBorderBeam({ duration = 6000, borderWidth = 1.5, className }: MovingBorderBeamProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="moving-border-beam"
      className={cn("su-border-beam", className)}
      style={
        {
          "--su-beam-duration": `${duration}ms`,
          "--su-beam-width": `${borderWidth}px`,
        } as React.CSSProperties
      }
    />
  );
}
