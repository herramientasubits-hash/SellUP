"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { ActiveFilterChips, type ActiveFilterChip } from "@/components/filters/active-filter-chips";
import type { DataTableColumnMeta } from "./data-table-column-meta";

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
    <ActiveFilterChips
      chips={chips}
      onClearAll={() => {
        table.resetColumnFilters(true);
        onGlobalFilterChange("");
      }}
      className={cn("border-b border-border/60 bg-surface-subtle px-4 py-2 sm:px-5", className)}
    />
  );
}
