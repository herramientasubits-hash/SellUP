"use client";

import * as React from "react";
import { ChevronDown, ListFilter } from "@/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface CheckboxFilterOption {
  value: string;
  label: string;
  /** Cuántos registros caen en esta opción (sobre el total, no sobre lo filtrado). */
  count?: number;
}

export interface CheckboxFilterButtonProps {
  /** Lo que se filtra: «Etapa». El botón dice «Etapa · 2» con dos elegidas. */
  label: string;
  options: readonly CheckboxFilterOption[];
  /** Los valores elegidos. Vacío = sin filtro. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  className?: string;
}

const COUNT_FORMAT = new Intl.NumberFormat("es");

export interface CheckboxFilterListProps {
  /** Cómo se anuncia la lista: «Filtrar por País». */
  ariaLabel: string;
  options: readonly CheckboxFilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  className?: string;
}

/**
 * CheckboxFilterList
 *
 * La lista de casillas de un filtro, con el recuento de cada opción: lo que hay
 * dentro del menú de `CheckboxFilterButton`, suelto, para un panel con varios
 * grupos de filtros. Las opciones con 0 se ven apagadas pero siguen siendo
 * elegibles. Sin estado: quien la usa decide qué significa marcar (varias a la
 * vez, o una sola).
 */
export function CheckboxFilterList({ ariaLabel, options, selected, onToggle, className }: CheckboxFilterListProps) {
  return (
    <ul aria-label={ariaLabel} className={className}>
      {options.map((option) => {
        const isEmpty = option.count === 0;
        return (
          <li key={option.value}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-muted">
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={() => onToggle(option.value)}
                aria-label={option.label}
              />
              <span className={cn("min-w-0 flex-1 truncate", isEmpty ? "text-text-muted" : "text-foreground")}>
                {option.label}
              </span>
              {typeof option.count === "number" && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {COUNT_FORMAT.format(option.count)}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * CheckboxFilterButton
 *
 * Un solo botón que abre la lista de opciones de un filtro con casillas, para
 * marcar varias a la vez (la selección múltiple es una unión). Dice cuántas hay
 * elegidas, trae el recuento de cada opción y «Limpiar» cuando hay alguna. Las
 * opciones con 0 se ven apagadas pero siguen siendo elegibles: el vocabulario
 * del filtro no cambia según los datos de hoy.
 *
 * Es el menú del embudo de las cabeceras de tabla (`FilterSortHeader`) con un
 * disparador propio, para filtros que no viven en una columna.
 *
 * @example
 * <CheckboxFilterButton
 *   label="Etapa"
 *   options={[{ value: "inteligencia", label: "Inteligencia", count: 3 }]}
 *   selected={stages}
 *   onChange={setStages}
 * />
 */
export function CheckboxFilterButton({ label, options, selected, onChange, className }: CheckboxFilterButtonProps) {
  const selectedSet = new Set(selected);
  const activeCount = selected.length;

  function toggle(value: string) {
    // El orden del resultado es el de las opciones, no el de los clics.
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-active={activeCount > 0 || undefined}
            className={cn(activeCount > 0 && "border-primary/30 bg-primary/10 text-primary", className)}
          />
        }
      >
        <ListFilter aria-hidden />
        {activeCount > 0 ? `${label} · ${activeCount}` : label}
        <ChevronDown aria-hidden className="text-text-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 max-w-[calc(100vw-2rem)] p-0">
        {activeCount > 0 && (
          <div className="border-b border-border/60 p-1.5">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Limpiar
            </button>
          </div>
        )}
        <CheckboxFilterList
          ariaLabel={`Filtrar por ${label}`}
          options={options}
          selected={selected}
          onToggle={toggle}
          className="max-h-72 overflow-y-auto p-1.5"
        />
      </PopoverContent>
    </Popover>
  );
}
