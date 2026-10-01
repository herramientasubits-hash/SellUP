"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";

import { SelectionHeaderMenu } from "@/components/data-display/table-header-controls";

/**
 * La celda de cabecera de la columna de selección.
 *
 * - **Paginado**: el menú de Thema («Seleccionar esta página (n) / Seleccionar
 *   todos (n) / Deseleccionar esta página / Deseleccionar todos»).
 * - **Scroll infinito**: una casilla que marca todo lo cargado y, pulsada otra
 *   vez, lo suelta.
 */
export function DataTableSelectionHeader<TData>({
  table,
  paged,
}: {
  table: Table<TData>;
  paged: boolean;
}) {
  const pageCount = table.getRowModel().rows.filter((row) => row.getCanSelect()).length;
  const matchCount = table.getFilteredRowModel().rows.length;
  const allPage = pageCount > 0 && table.getIsAllPageRowsSelected();
  const somePage = table.getIsSomePageRowsSelected();
  const all = matchCount > 0 && table.getIsAllRowsSelected();
  const any = all || allPage || somePage || table.getIsSomeRowsSelected();

  const state: boolean | "indeterminate" = (paged ? all || allPage : allPage)
    ? true
    : any
      ? "indeterminate"
      : false;

  return (
    <SelectionHeaderMenu
      state={state}
      paged={paged}
      pageCount={pageCount}
      // En scroll infinito «todos» son los cargados: es lo que marca la casilla.
      matchCount={paged ? matchCount : pageCount}
      showSelectPage={pageCount > 0 && !allPage}
      showSelectAll={paged ? matchCount > 0 && !all : pageCount > 0}
      showDeselectPage={allPage || somePage}
      showDeselectAll={any}
      onSelectPage={() => table.toggleAllPageRowsSelected(true)}
      onSelectAll={() =>
        paged ? table.toggleAllRowsSelected(true) : table.toggleAllPageRowsSelected(true)
      }
      onDeselectPage={() => table.toggleAllPageRowsSelected(false)}
      onDeselectAll={() => table.resetRowSelection(true)}
    />
  );
}
