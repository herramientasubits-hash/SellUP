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
import { multiValueFilter } from "./data-table-utils";
import { DateFilterSortHeader, TextFilterSortHeader } from "./data-table-filter-headers";
import {
  EMPTY_FILTER_LABEL,
  EMPTY_FILTER_VALUE,
  isDateFilterValue,
  isTextFilterValue,
  optionKeysOf,
} from "./data-table-filters";

/**
 * Por encima de este número de valores distintos una columna sin
 * `meta.filterOptions` se considera texto libre (nombres, dominios): no es
 * enumerable y no se le ofrece embudo de casillas. `meta.unboundedFacets` lo
 * quita (empresas, departamentos: el embudo trae buscador).
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

/**
 * ¿El filtro de la columna entiende «(Vacío)»? El filtro por defecto sí; uno
 * propio sólo si la columna lo declara con `filterOptions` que ya lo traen.
 */
function usesDefaultFilter<TData, TValue>(column: Column<TData, TValue>): boolean {
  // `defaultColumn` ya viene mezclado en `columnDef`: el por defecto es `multiValueFilter`.
  const fn = column.columnDef.filterFn;
  return fn === undefined || fn === "auto" || fn === multiValueFilter;
}

function useFilterOptions<TData, TValue>(
  column: Column<TData, TValue>,
  enabled: boolean,
): HeaderFilterOption[] {
  const meta = (column.columnDef.meta ?? {}) as DataTableColumnMeta;
  const staticOptions = meta.filterOptions;
  const filterKey = meta.filterKey;
  const unbounded = meta.unboundedFacets === true;
  const emptyAllowed = usesDefaultFilter(column) && !filterKey;
  // TanStack memoiza el mapa de valores únicos: misma referencia si las filas no cambian.
  const facets = enabled ? column.getFacetedUniqueValues() : undefined;

  return React.useMemo(() => {
    if (!enabled) return [];
    // Las claves del mapa son el valor crudo de la celda; las opciones, texto
    // (o la clave calculada con `filterKey`: tramos, «tiene / no tiene»).
    const counts = new Map<string, number>();
    facets?.forEach((count, value) => {
      for (const key of optionKeysOf(value, filterKey)) counts.set(key, (counts.get(key) ?? 0) + count);
    });
    const emptyCount = emptyAllowed ? (counts.get(EMPTY_FILTER_VALUE) ?? 0) : 0;
    const emptyOption = emptyCount > 0 ? [{ value: EMPTY_FILTER_VALUE, label: EMPTY_FILTER_LABEL, count: emptyCount }] : [];

    if (staticOptions) {
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
      // sin filas quedan al final en vez de estorbar arriba. Los tramos y el
      // «tiene / no tiene» guardan su orden.
      const ordered = filterKey
        ? options
        : [...options.filter((option) => (option.count ?? 0) > 0), ...options.filter((option) => !option.count)];
      return [...ordered, ...emptyOption];
    }
    if (!facets || facets.size === 0) return [];
    const values = Array.from(counts.entries()).filter(([value]) => value !== EMPTY_FILTER_VALUE);
    if (!unbounded && values.length > MAX_FACETED_FILTER_OPTIONS) return [];
    return [
      ...values
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
      ...emptyOption,
    ];
  }, [enabled, staticOptions, facets, filterKey, unbounded, emptyAllowed]);
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
 * - Con `meta.filterOptions` (o pocos valores únicos) → orden + embudo de
 *   casillas (con «(Vacío)» si hay filas sin dato).
 * - Con `meta.filterVariant: "text"` → orden + «contiene / con dato / sin dato».
 * - Con `meta.filterVariant: "date"` → orden + rango, atajos y «sin fecha».
 * - Con `meta.disableFilter` / `enableColumnFilter: false` → solo orden.
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

  const variant = meta.filterVariant ?? "options";
  const options = useFilterOptions(column, canFilter && variant === "options");
  const sort: HeaderSort = canSort ? column.getIsSorted() : false;
  const onSort = canSort ? () => cycleColumnSort(column) : undefined;

  if (canFilter && variant === "text") {
    const value = column.getFilterValue();
    return (
      <TextFilterSortHeader
        label={title}
        filterLabel={meta.popoverTitle ?? title}
        value={isTextFilterValue(value) ? value : undefined}
        onChange={(next) => column.setFilterValue(next)}
        sort={sort}
        onSort={onSort}
        align={align}
        className={className}
      />
    );
  }

  if (canFilter && variant === "date") {
    const value = column.getFilterValue();
    return (
      <DateFilterSortHeader
        label={title}
        filterLabel={meta.popoverTitle ?? title}
        value={isDateFilterValue(value) ? value : undefined}
        onChange={(next) => column.setFilterValue(next)}
        presets={meta.datePresets}
        sort={sort}
        onSort={onSort}
        align={align}
        className={className}
      />
    );
  }

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
