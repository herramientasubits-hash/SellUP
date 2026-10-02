"use client";

import * as React from "react";
import { type Row, flexRender } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTableContextMenu } from "./data-table-context-menu";
import { RowDragHandle, type SortableRowProps } from "./data-table-row-reorder";
import type { DataTableContextMenuConfig } from "./data-table-types";

/** Un clic que nace en un control de la fila es suyo: no abre el detalle ni marca la fila. */
const ROW_CONTROL_SELECTOR =
  "[data-table-select],button,a,input,label,[role=checkbox],[role=menu],[role=menuitem]";

interface DataTableRowProps<TData> {
  row: Row<TData>;
  rowClickable: boolean;
  onRowClick?: (row: TData) => void;
  /** Sin `onRowClick`, picar en la fila la marca (atajo de ratón de la casilla). */
  selectOnClick?: boolean;
  contextMenu?: DataTableContextMenuConfig<TData>;
  /** A cuántos píxeles del borde izquierdo se queda cada columna fijada. */
  stickyOffsets?: Record<string, number>;
  /** La última columna fijada: lleva la línea que la separa del resto. */
  lastStickyId?: string;
  /**
   * When row reorder is enabled, the parent `DataTableRowReorder` passes
   * the dnd-kit handle props here so the grip cell is rendered as the
   * first cell.
   */
  reorderHandleProps?: React.HTMLAttributes<HTMLButtonElement> & {
    isDragging: boolean;
  };
  /**
   * La ref y el desplazamiento de dnd-kit para el `<tr>` de una fila
   * arrastrable. La fila la pinta SIEMPRE este componente: así el menú
   * contextual se engancha al propio `<tr>` también con arrastre, y no queda
   * un `<div>` entre `<tr>` y `<td>`.
   */
  sortableRowProps?: SortableRowProps;
}

export function DataTableRow<TData>({
  row,
  rowClickable,
  onRowClick,
  selectOnClick = false,
  contextMenu,
  stickyOffsets,
  lastStickyId,
  reorderHandleProps,
  sortableRowProps,
}: DataTableRowProps<TData>) {
  const isSelected = row.getIsSelected();
  const opensDetail = rowClickable && Boolean(onRowClick);
  const togglesSelection = !onRowClick && selectOnClick && row.getCanSelect();

  const handleClick =
    opensDetail || togglesSelection
      ? (e: React.MouseEvent<HTMLTableRowElement>) => {
          if ((e.target as HTMLElement).closest(ROW_CONTROL_SELECTOR)) return;
          if (opensDetail) onRowClick?.(row.original);
          else row.toggleSelected();
        }
      : undefined;

  const cells = (
    <>
      {reorderHandleProps && <RowDragHandle {...reorderHandleProps} />}
      {row
        .getVisibleCells()
        // The `reorder` column lives in `allColumns` so the thead has a
        // matching header (and the auto-fit effect can size it), but its
        // cell renders `null`. When row reorder is enabled we replace it
        // with the grip handle above, so filter it out here to avoid a
        // phantom empty cell next to the grip.
        .filter((cell) => (reorderHandleProps ? cell.column.id !== "reorder" : true))
        .map((cell) => {
          const stickyLeft = stickyOffsets?.[cell.column.id];
          const isSticky = stickyLeft !== undefined;
          return (
            <TableCell
              key={cell.id}
              style={{
                width: cell.column.columnDef.size,
                ...(isSticky ? { position: "sticky", left: stickyLeft, zIndex: 5 } : {}),
              }}
              data-table-select={cell.column.id === "select" || undefined}
              data-pinned={isSticky || undefined}
              className={cn(
                isSticky && "bg-card",
                isSticky && cell.column.id === lastStickyId && "border-r border-border/60",
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          );
        })}
    </>
  );

  const isDragging = Boolean(sortableRowProps?.isDragging);

  const cellContent = (
    <TableRow
      ref={sortableRowProps?.ref}
      style={sortableRowProps?.style}
      data-state={isDragging ? "dragging" : isSelected ? "selected" : undefined}
      className={cn(
        "border-border/60 group",
        handleClick && "cursor-pointer",
        isSelected && "bg-primary/[0.07]",
        isDragging && "opacity-60 shadow-card",
      )}
      onClick={handleClick}
    >
      {cells}
    </TableRow>
  );

  if (!contextMenu) return cellContent;

  return (
    <DataTableContextMenu items={contextMenu.items(row.original)}>
      {cellContent}
    </DataTableContextMenu>
  );
}
