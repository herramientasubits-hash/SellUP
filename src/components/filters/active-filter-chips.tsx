"use client";

import { cn } from "@/lib/utils";
import { Tag } from "@/components/ui/tag";

export interface ActiveFilterChip {
  key: string;
  /** Lo que dice el chip: «Etapa: Inteligencia». */
  label: string;
  onRemove: () => void;
}

export interface ActiveFilterChipsProps {
  chips: readonly ActiveFilterChip[];
  /** Con valor, la fila cierra con «Limpiar todo». */
  onClearAll?: () => void;
  clearLabel?: string;
  /** Cómo se anuncia el grupo a un lector de pantalla. */
  ariaLabel?: string;
  className?: string;
}

/**
 * ActiveFilterChips
 *
 * Los filtros puestos, a la vista: un chip «Columna: valor ×» por cada valor
 * elegido, que se quita de uno en uno, y «Limpiar todo». Es la fila que sale
 * bajo la barra de una tabla (`DataTableActiveFilters`) y bajo el buscador de
 * una lista con filtros (Pipeline). Sin chips la fila no existe.
 *
 * No guarda estado: quien la usa es dueño de los filtros y de cómo se quitan.
 */
export function ActiveFilterChips({
  chips,
  onClearAll,
  clearLabel = "Limpiar todo",
  ariaLabel = "Filtros activos",
  className,
}: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex shrink-0 flex-wrap items-center gap-1.5", className)}
    >
      <span className="text-xs text-muted-foreground">Filtros:</span>
      {chips.map((chip) => (
        <Tag
          key={chip.key}
          label={chip.label}
          removable
          onRemove={chip.onRemove}
          className="border-border/60 bg-card text-foreground"
        />
      ))}
      {onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
