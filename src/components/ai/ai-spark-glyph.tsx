import * as React from "react";

import { cn } from "@/lib/utils";
import { RUMBO_NEEDLE_PATH, RUMBO_TAIL_PATH } from "@/icons";

export interface AiSparkGlyphProps {
  /** Lado del glifo en píxeles. */
  size?: number;
  className?: string;
}

/**
 * La marca de la IA mientras trabaja: la brújula de Rumbo (dueña 19-10: «donde esté lo
 * de IA debe estar el logo de Rumbo, no el antiguo»), con el degradado de IA y la aguja
 * girando en continuo, sin saltos. Antes era la chispa de Thema. Es la misma marca en
 * dos tamaños: el panel de «Analizando» a 42 px y el aviso de una línea a 18.
 */
export function AiSparkGlyph({ size = 42, className }: AiSparkGlyphProps) {
  // Cada instancia pinta con su propio degradado: dos glifos a la vez con el
  // mismo id harían que el segundo tomara el del primero.
  const gradientId = `${React.useId()}-ai-rumbo`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      data-slot="ai-spark-glyph"
      data-icon="rumbo"
      className={cn("ai-rumbo-thinking relative shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--su-ai-stop-1)" />
          <stop offset="55%" stopColor="var(--su-ai-stop-3)" />
          <stop offset="100%" stopColor="var(--su-ai-stop-5)" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9.6" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.9" />
      <g className="chat-mark-needle" fill={`url(#${gradientId})`}>
        <g transform="rotate(32 12 12)">
          <path d={RUMBO_NEEDLE_PATH} />
          <path d={RUMBO_TAIL_PATH} opacity={0.55} />
        </g>
      </g>
      <circle cx="12" cy="12" r="1.2" fill={`url(#${gradientId})`} />
    </svg>
  );
}
