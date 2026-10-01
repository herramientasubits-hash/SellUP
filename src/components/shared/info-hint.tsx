"use client";

import type { ReactNode } from "react";

import { Info } from "@/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface InfoHintProps {
  /** Qué explica: es el nombre accesible del botón y, con `showLabel`, su texto. */
  label?: string;
  /** Pinta el nombre junto al icono. Sin él queda solo el icono. */
  showLabel?: boolean;
  /** La explicación, en lenguaje de quien usa la pantalla. */
  children: ReactNode;
  className?: string;
}

/**
 * InfoHint — la explicación que no merece ocupar la pantalla: un icono de
 * información (con su rótulo opcional) que abre un tooltip.
 *
 * Sustituye a los avisos fijos que cuentan cómo se calcula una cifra o de dónde
 * sale un dato: quien lo necesita lo abre, y el resto no lo lee cada vez.
 *
 * @example
 * <InfoHint label="Cómo se calcula" showLabel>
 *   Prospectos aprobados sobre prospectos generados.
 * </InfoHint>
 */
export function InfoHint({
  label = "Cómo se calcula",
  showLabel = false,
  children,
  className,
}: InfoHintProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-sm text-xs font-medium text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              className,
            )}
          >
            <Info aria-hidden className="size-3.5" />
            {showLabel && <span>{label}</span>}
          </button>
        }
      />
      <TooltipContent className="max-w-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}
