"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** El destello de cuatro puntas con su satélite, en una caja de 24. */
const SPARK = "M12,3 Q12,12 3,12 Q12,12 12,21 Q12,12 21,12 Q12,12 12,3 Z";
const SPARK_SMALL = "M19,5 Q19,7 17,7 Q19,7 19,9 Q19,7 21,7 Q19,7 19,5 Z";

/**
 * Marca de procedencia: esto lo escribió la IA (Thema · `AiGeneratedBadge`).
 *
 * Solo la chispa, con el degradado de la IA. No es un estado ni una acción —
 * no se puede pulsar y no cambia con la edición: dice de dónde salió el
 * contenido. Va en la línea del rótulo y no junto al título, para que se lea
 * como metadato. Sin pastilla ni letra: el tooltip guarda la palabra para
 * quien la necesite.
 */
export function AiGeneratedBadge({ className }: { className?: string }) {
  // Cada instancia pinta con su propio degradado: dos iconos a la vez con el
  // mismo id harían que el segundo tomara el del primero.
  const gradientId = `${React.useId()}-ai-badge`;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex shrink-0 items-center", className)} />}>
        <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden data-slot="ai-generated-badge">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--su-ai-stop-1)" />
              <stop offset="100%" stopColor="var(--su-ai-stop-5)" />
            </linearGradient>
          </defs>
          <path
            d={SPARK}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={SPARK_SMALL} fill={`url(#${gradientId})`} />
        </svg>
        <span className="sr-only">Generado con IA</span>
      </TooltipTrigger>
      <TooltipContent side="top">Generado con IA</TooltipContent>
    </Tooltip>
  );
}
