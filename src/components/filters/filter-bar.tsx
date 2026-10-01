"use client";

import * as React from "react";
import { Search, X, RotateCcw } from "@/icons";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type ActiveFilter = {
  id: string;
  label: string;
  value?: string;
  onRemove?: () => void;
};

export type FilterBarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  activeFilters?: ActiveFilter[];
  onClearFilters?: () => void;
  className?: string;
};

/**
 * FilterBar
 *
 * La barra que va encima de una lista: a la izquierda la búsqueda y los
 * filtros, a la derecha las acciones de la lista, todo sobre una sola card.
 * Debajo, fuera de la card, los filtros puestos como etiquetas que se quitan
 * de una en una y un «Limpiar filtros» que solo aparece cuando hay algo que
 * limpiar.
 *
 * No guarda estado: la pantalla es dueña de la búsqueda y de los filtros, y
 * la barra solo los pinta. `filters` y `actions` son ranuras: ahí van los
 * `Select` compactos (`<SelectTrigger size="sm">`) y los botones de la lista.
 *
 * @example
 * <FilterBar
 *   searchValue={query}
 *   onSearchChange={setQuery}
 *   searchPlaceholder="Buscar cuenta…"
 *   filters={<CountrySelect value={country} onChange={setCountry} />}
 *   actions={<Button size="sm">Exportar</Button>}
 *   activeFilters={[{ id: "country", label: "País", value: "Colombia", onRemove: () => setCountry(null) }]}
 *   onClearFilters={clearAll}
 * />
 */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  filters,
  actions,
  activeFilters = [],
  onClearFilters,
  className,
}: FilterBarProps) {
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <div className="flex flex-1 flex-col md:flex-row md:items-center gap-4">
          {onSearchChange && (
            <div className="relative w-full md:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {(hasActiveFilters || onClearFilters) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeFilters.map((filter) => (
            <Badge
              key={filter.id}
              variant="secondary"
              className="h-7 gap-1 pl-2 pr-1"
            >
              <span className="mr-1 text-muted-foreground">{filter.label}:</span>
              <span className="font-medium">{filter.value}</span>
              <button
                type="button"
                aria-label={`Remover filtro ${filter.label}`}
                title={`Remover filtro ${filter.label}`}
                onClick={filter.onRemove}
                className="ml-1 rounded-xs p-0.5 outline-none hover:bg-surface-muted focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {onClearFilters && hasActiveFilters && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onClearFilters}
              className="text-primary hover:text-primary"
            >
              <RotateCcw className="h-3 w-3" />
              Limpiar filtros
            </Button>
          )}
        </div>
      )}
    </div>
  );
}