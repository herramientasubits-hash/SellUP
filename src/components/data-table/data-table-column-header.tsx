"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import {
  FilterSortHeader,
  SortOnlyHeader,
  type HeaderFilterOption,
  type HeaderSort,
} from "@/components/data-display/table-header-controls";
import type { DataTableColumnMeta } from "./data-table-column-meta";

/**
 * Por encima de este número de valores distintos una columna sin
 * `meta.filterOptions` se considera texto libre (nombres, dominios): no es
 * enumerable y no se le ofrece embudo.
 */
const MAX_FACETED_FILTER_OPTIONS = 50;

/** Sin orden → ascendente → descendente → sin orden. */
export function cycleColumnSort<TData, TValue>(column: Column<TData, TValue>): void {
  const sorted = column.getIsSorted();
  if (sorted === false) column.toggleSorting(false);
  else if (sorted === "asc") column.toggleSorting(true);
  else column.clearSorting();
}

/** Los valores elegidos en el embudo de una columna (vacío si no hay o no es una lista). */
export function getColumnFilterValues<TData, TValue>(column: Column<TData, TValue>): string[] {
  const value = column.getFilterValue();
  return Array.isArray(value) ? value.map(String) : [];
}

function useFilterOptions<TData, TValue>(
  column: Column<TData, TValue>,
  enabled: boolean,
): HeaderFilterOption[] {
  const meta = (column.columnDef.meta ?? {}) as DataTableColumnMeta;
  const staticOptions = meta.filterOptions;
  // TanStack memoiza el mapa de valores únicos: misma referencia si las filas no cambian.
  const facets = enabled ? column.getFacetedUniqueValues() : undefined;

  return React.useMemo(() => {
    if (!enabled) return [];
    if (staticOptions) {
      // Las claves del mapa son el valor crudo de la celda; las opciones, texto.
      const counts = new Map<string, number>();
      facets?.forEach((count, value) => {
        const key = String(value);
        counts.set(key, (counts.get(key) ?? 0) + count);
      });
      // Si ninguna opción casa con los valores de la columna, el recuento no
      // dice nada (la celda guarda otra cosa): mejor sin cifras que con ceros.
      const countable = staticOptions.some((option) => counts.has(option.value));
      const options = staticOptions.map((option) => ({
        value: option.value,
        label: option.label,
        icon: option.icon,
        count: countable ? (counts.get(option.value) ?? 0) : undefined,
      }));
      if (!countable) return options;
      // Primero lo que hay: en una lista larga (países, sectores) las opciones
      // sin filas quedan al final en vez de estorbar arriba.
      return [...options.filter((option) => (option.count ?? 0) > 0), ...options.filter((option) => !option.count)];
    }
    if (!facets || facets.size === 0 || facets.size > MAX_FACETED_FILTER_OPTIONS) return [];
    return Array.from(facets.entries())
      .filter(([value]) => value !== null && value !== undefined && value !== "")
      .map(([value, count]) => ({ value: String(value), label: String(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [enabled, staticOptions, facets]);
}

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  title: string;
  /** Quita el orden: la etiqueta pasa a ser texto. */
  disableSort?: boolean;
  /** Quita el embudo. */
  disableFilter?: boolean;
  /** Etiqueta sola, sin orden ni embudo. */
  noPopover?: boolean;
  /** @deprecated Fijar una columna vive ahora en «Configurar tabla». Sin efecto. */
  onPin?: (side: "left" | "right" | false) => void;
  /** @deprecated Ver `onPin`. */
  pinned?: "left" | "right" | false;
  align?: "left" | "right";
  className?: string;
}

/**
 * Cabecera de columna de `DataTable` con la anatomía de Thema: dos controles a
 * la vista. La etiqueta con su flecha ordena (sin orden → asc → desc → sin
 * orden) y, en las columnas enumerables, un embudo aparte abre el filtro por
 * valores con su recuento.
 *
 * - Con `meta.filterOptions` (o pocos valores únicos) → orden + embudo.
 * - Con `meta.disableFilter` / `enableColumnFilter: false` → solo orden
 *   (números, fechas, texto libre).
 * - Con `enableSorting: false` y sin filtro → etiqueta.
 *
 * Fijar y ocultar la columna se hace desde «Configurar tabla».
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  disableSort = false,
  disableFilter = false,
  noPopover = false,
  align = "left",
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const meta = (column.columnDef.meta ?? {}) as DataTableColumnMeta;
  const canSort = !noPopover && column.getCanSort() && !disableSort && meta.disableSort !== true;
  const canFilter =
    !noPopover && column.getCanFilter() && !disableFilter && meta.disableFilter !== true;

  const options = useFilterOptions(column, canFilter);
  const sort: HeaderSort = canSort ? column.getIsSorted() : false;
  const onSort = canSort ? () => cycleColumnSort(column) : undefined;

  if (canFilter && options.length > 0) {
    const current = getColumnFilterValues(column);
    return (
      <FilterSortHeader
        label={title}
        filterLabel={meta.popoverTitle ?? title}
        options={options}
        selected={new Set(current)}
        onToggleFilter={(value) => {
          const next = current.includes(value)
            ? current.filter((other) => other !== value)
            : [...current, value];
          column.setFilterValue(next.length > 0 ? next : undefined);
        }}
        onClearFilter={() => column.setFilterValue(undefined)}
        sort={sort}
        onSort={onSort}
        align={align}
        className={className}
      />
    );
  }

  if (onSort) {
    return <SortOnlyHeader label={title} sort={sort} onSort={onSort} align={align} className={className} />;
  }

  return (
    <span className={cn("block truncate text-xs font-semibold text-muted-foreground", className)}>
      {title}
    </span>
  );
}
