"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Tag } from "@/components/ui/tag";
import type { DataTableColumnMeta } from "./data-table-column-meta";

interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Un filtro que no es una lista de valores, dicho en una línea. */
function describeFilterValue(value: unknown): string {
  if (value && typeof value === "object" && ("from" in value || "to" in value)) {
    const { from, to } = value as { from?: string; to?: string };
    if (from && to) return `${from} a ${to}`;
    if (from) return `desde ${from}`;
    if (to) return `hasta ${to}`;
  }
  return String(value);
}

interface DataTableActiveFiltersProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (next: string) => void;
  className?: string;
}

/**
 * Los filtros activos, a la vista bajo la barra de la tabla: un chip
 * «Columna: valor ×» por cada valor elegido (y otro por la búsqueda), con
 * «Limpiar todo». Sin filtros la fila no existe.
 */
export function DataTableActiveFilters<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  className,
}: DataTableActiveFiltersProps<TData>) {
  const columnFilters = table.getState().columnFilters;
  const search = globalFilter.trim();

  const chips: ActiveFilterChip[] = [];

  if (search) {
    chips.push({
      key: "__search",
      label: `Búsqueda: ${search}`,
      onRemove: () => onGlobalFilterChange(""),
    });
  }

  for (const filter of columnFilters) {
    const column = table.getColumn(filter.id);
    if (!column) continue;
    const meta = (column.columnDef.meta ?? {}) as DataTableColumnMeta;
    const columnLabel = meta.label ?? filter.id;

    if (Array.isArray(filter.value)) {
      const values = filter.value.map(String);
      for (const value of values) {
        const optionLabel = meta.filterOptions?.find((option) => option.value === value)?.label ?? value;
        chips.push({
          key: `${filter.id}:${value}`,
          label: `${columnLabel}: ${optionLabel}`,
          onRemove: () => {
            const next = values.filter((other) => other !== value);
            column.setFilterValue(next.length > 0 ? next : undefined);
          },
        });
      }
      continue;
    }

    if (filter.value === undefined || filter.value === null || filter.value === "") continue;
    chips.push({
      key: filter.id,
      label: `${columnLabel}: ${meta.filterChipLabel?.(filter.value) ?? describeFilterValue(filter.value)}`,
      onRemove: () => column.setFilterValue(undefined),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Filtros activos"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-surface-subtle px-4 py-2 sm:px-5",
        className,
      )}
    >
      <span className="text-xs text-muted-foreground">Filtros:</span>
      {chips.map((chip) => (
        <Tag key={chip.key} label={chip.label} removable onRemove={chip.onRemove} className="border-border/60 bg-card text-foreground" />
      ))}
      <button
        type="button"
        onClick={() => {
          table.resetColumnFilters(true);
          onGlobalFilterChange("");
        }}
        className="ml-1 rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        Limpiar todo
      </button>
    </div>
  );
}
