import * as React from "react";

import { cn } from "@/lib/utils";

export interface AiSparkGlyphProps {
  /** Lado del glifo en píxeles. */
  size?: number;
  className?: string;
}

function pulse(duration: string, delay = "0s"): React.CSSProperties {
  return { "--ai-spark-duration": duration, "--ai-spark-delay": delay } as React.CSSProperties;
}

/**
 * La chispa de la IA (Thema · `AiSparkGlyph`): el destello grande con dos
 * satélites que laten a destiempo. Es la misma marca en dos tamaños —el panel
 * de «Analizando» a 42 px y el aviso de una línea a 18—. El latido escalonado
 * es lo que la hace leerse como trabajo en curso, así que va aquí dentro.
 */
export function AiSparkGlyph({ size = 42, className }: AiSparkGlyphProps) {
  // Cada instancia pinta con su propio degradado: dos glifos a la vez con el
  // mismo id harían que el segundo tomara el del primero.
  const gradientId = `${React.useId()}-ai-spark`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      data-slot="ai-spark-glyph"
      className={cn("relative shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--su-ai-stop-1)" />
          <stop offset="100%" stopColor="var(--su-ai-stop-5)" />
        </linearGradient>
      </defs>
      <path
        d="M12,3 Q12,12 3,12 Q12,12 12,21 Q12,12 21,12 Q12,12 12,3 Z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ai-spark-pulse"
        style={pulse("1.8s")}
      />
      <path
        d="M19,5 Q19,7 17,7 Q19,7 19,9 Q19,7 21,7 Q19,7 19,5 Z"
        fill={`url(#${gradientId})`}
        className="ai-spark-pulse"
        style={pulse("1.3s", "0.3s")}
      />
      <circle
        cx="5.5"
        cy="18.5"
        r="1.75"
        fill={`url(#${gradientId})`}
        className="ai-spark-pulse"
        style={pulse("1.5s", "0.6s")}
      />
    </svg>
  );
}
