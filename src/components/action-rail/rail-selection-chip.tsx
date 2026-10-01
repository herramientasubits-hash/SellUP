"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { selectionLabel } from "./rail-actions";

interface RailSelectionChipProps {
  count: number;
  /** Suelta las marcas sin tocar las filas. */
  onClear: () => void;
  /**
   * Género gramatical de lo que se cuenta, para que el rótulo diga
   * «3 seleccionadas» con cuentas y «3 seleccionados» con prospectos.
   */
  gender?: "f" | "m";
  className?: string;
}

/**
 * «N seleccionadas ✕» — el recuento que toda barra flotante enseña mientras
 * una tabla tiene filas marcadas.
 *
 * Existe como una sola pieza porque responde dos preguntas que una barra de
 * iconos deja implícitas: a cuántas filas afectará la siguiente acción, y cómo
 * salir de la selección sin buscar la casilla que la empezó.
 *
 * @example
 * <RailSelectionChip count={selected.length} onClear={() => setSelected([])} gender="f" />
 */
export function RailSelectionChip({ count, onClear, gender = "f", className }: RailSelectionChipProps) {
  return (
    <div className={cn("flex items-center gap-2 px-1", className)}>
      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-nav-foreground">
        {selectionLabel(count, gender)}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onClear}
              aria-label="Limpiar selección"
              className="relative flex h-8 w-8 items-center justify-center rounded-md text-nav-foreground/70 transition-colors hover:bg-nav-foreground/10 hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/30"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          }
        />
        <TooltipContent side="top">Limpiar selección</TooltipContent>
      </Tooltip>
    </div>
  );
}
