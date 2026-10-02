"use client";

import { X } from "@/icons";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { selectionLabel } from "./rail-actions";
import { useRailIsVertical, useRailPopoutSide } from "./rail-preferences";

interface RailSelectionChipProps {
  count: number;
  /** Suelta las marcas sin tocar las filas. */
  onClear: () => void;
  /**
   * Género gramatical de lo que se cuenta, para que el rótulo diga
   * «3 seleccionadas» con empresas y «3 seleccionados» con contactos.
   */
  gender?: "f" | "m";
  className?: string;
}

/**
 * «✕ N seleccionadas» — el recuento que toda barra flotante enseña mientras
 * una tabla tiene filas marcadas.
 *
 * Existe como una sola pieza porque responde dos preguntas que una barra de
 * iconos deja implícitas: a cuántas filas afectará la siguiente acción, y cómo
 * salir de la selección sin buscar la casilla que la empezó.
 *
 * De pie no hay sitio para la frase: el recuento pasa a una insignia y el
 * texto a su tooltip, porque el número es lo que de verdad se lee en la barra.
 *
 * @example
 * <RailSelectionChip count={selected.length} onClear={() => setSelected([])} gender="f" />
 */
export function RailSelectionChip({ count, onClear, gender = "f", className }: RailSelectionChipProps) {
  const isVertical = useRailIsVertical();
  const side = useRailPopoutSide();
  const readout = selectionLabel(count, gender);

  return (
    <div className={cn("flex items-center gap-2", isVertical ? "flex-col px-0 py-1" : "px-1", className)}>
      {isVertical ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="status"
                aria-label={readout}
                className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-nav-foreground/10 px-1.5 text-sm font-bold tabular-nums text-nav-foreground"
              >
                {count}
              </span>
            }
          />
          <TooltipContent side={side}>{readout}</TooltipContent>
        </Tooltip>
      ) : (
        <span role="status" className="whitespace-nowrap text-sm font-semibold tabular-nums text-nav-foreground">
          {readout}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onClear}
              aria-label="Limpiar selección"
              className="su-dock-item relative flex h-8 w-8 items-center justify-center rounded-xl text-nav-foreground/60 hover:bg-nav-foreground/10 hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30"
            >
              <X className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          }
        />
        <TooltipContent side={side}>Limpiar selección</TooltipContent>
      </Tooltip>
    </div>
  );
}
