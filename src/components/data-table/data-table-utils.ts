import type * as React from "react";
import type { ColumnDef, FilterFn } from "@tanstack/react-table";

import type { DataTableColumnMeta } from "./data-table-column-meta";

export const DEFAULT_PINNED = ["select", "reorder", "actions"];
export const ROW_MENU_COLUMN_ID = "row-actions";
export const FIXED_COLUMN_LABELS: Record<string, string> = {
  select: "Selección",
  reorder: "Reordenar filas",
  actions: "Acciones",
  [ROW_MENU_COLUMN_ID]: "Acciones",
};

/**
 * Filtro por defecto de las columnas: «el valor de la fila está entre los
 * elegidos en el embudo». Las columnas que declaran su propio `filterFn`
 * (p. ej. `arrIncludesSome`, un rango de fechas) lo conservan.
 */
export const multiValueFilter: FilterFn<unknown> = (row, columnId, filterValue) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  const value = row.getValue(columnId);
  if (Array.isArray(value)) return value.some((item) => filterValue.includes(String(item)));
  return filterValue.includes(String(value));
};

/** El id con el que TanStack conoce una columna, antes de montar la tabla. */
export function resolveColumnId<TData>(column: ColumnDef<TData, unknown>): string | undefined {
  if (column.id) return column.id;
  const accessorKey = (column as { accessorKey?: unknown }).accessorKey;
  if (typeof accessorKey === "string") return accessorKey.replaceAll(".", "_");
  return typeof column.header === "string" ? column.header : undefined;
}

export function columnLabel<TData>(column: ColumnDef<TData, unknown>, id: string): string {
  const meta = column.meta as DataTableColumnMeta | undefined;
  return meta?.label ?? FIXED_COLUMN_LABELS[id] ?? (typeof column.header === "string" ? column.header : id);
}

export function selectionWord(count: number, gender: "f" | "m"): string {
  const base = gender === "f" ? "seleccionada" : "seleccionado";
  return count === 1 ? base : `${base}s`;
}

export function sameOffsets(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Math.abs(a[key] - (b[key] ?? -1)) < 0.5);
}

export function ariaSort<TData>(column: {
  getCanSort: () => boolean;
  getIsSorted: () => false | "asc" | "desc";
  columnDef: ColumnDef<TData, unknown>;
}): React.AriaAttributes["aria-sort"] {
  if (!column.getCanSort() || column.columnDef.meta?.disableSort) return undefined;
  const sorted = column.getIsSorted();
  return sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none";
}
