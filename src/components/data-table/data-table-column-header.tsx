"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, ListFilter, Pin } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DataTableColumnPopover,
  type DataTableColumnMeta,
} from "./data-table-column-popover";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
  /** Disable sort controls (also removes the popover sort section). */
  disableSort?: boolean;
  /** Disable filter controls (also removes the popover filter section). */
  disableFilter?: boolean;
  /** Hide the popover entirely and render a plain label. */
  noPopover?: boolean;
  /** Callback to pin the column. When provided, adds a pin button to the popover. */
  onPin?: (side: "left" | "right" | false) => void;
  /** Whether the column is currently pinned (and to which side). */
  pinned?: "left" | "right" | false;
}

/**
 * Sortable + filterable column header. Renders a clickable button that opens
 * a popover with sort / search / filter controls (matching the reference
 * template's per-column popover UX).
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  disableSort = false,
  disableFilter = false,
  noPopover = false,
  onPin,
  pinned = false,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const meta = (column.columnDef.meta ?? {}) as DataTableColumnMeta;
  const popoverTitle = meta.popoverTitle ?? title;
  const canSort = column.getCanSort() && !disableSort;
  const canFilter = column.getCanFilter() && !disableFilter;
  const isFiltered = canFilter && column.getIsFiltered();

  if (noPopover || (!canSort && !canFilter && !onPin)) {
    return (
      <span
        className={cn(
          "text-[11px] font-semibold tracking-wider uppercase text-muted-foreground",
          className,
        )}
      >
        {title}
      </span>
    );
  }

  const sorted = column.getIsSorted();

  return (
    <DataTableColumnPopover
      column={column}
      sortable={canSort}
      filterable={canFilter}
    >
      <button
        type="button"
        className={cn(
          "group inline-flex items-center gap-1.5 -mx-1.5 px-1.5 py-1 rounded-md",
          "hover:bg-muted/40 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className,
        )}
        aria-label={`Opciones de columna ${popoverTitle}`}
      >
        <span className="text-[11px] font-semibold tracking-wider uppercase text-foreground">
          {title}
        </span>
        {canSort && sorted === "asc" && (
          <ArrowUp className="h-3 w-3 text-foreground" strokeWidth={2.5} />
        )}
        {canSort && sorted === "desc" && (
          <ArrowDown className="h-3 w-3 text-foreground" strokeWidth={2.5} />
        )}
        {canSort && sorted === false && !isFiltered && (
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
        )}
        {isFiltered && (
          <ListFilter
            className="h-3 w-3 text-primary"
            strokeWidth={2.5}
            aria-label={`Filtros activos en ${popoverTitle}`}
          />
        )}
        {pinned && (
          <Pin className="h-3 w-3 text-primary" strokeWidth={2.5} aria-label={`Fijada ${pinned === "left" ? "izquierda" : "derecha"}`} />
        )}
      </button>
    </DataTableColumnPopover>
  );
}

/**
 * Re-exported as a convenience so consumers can use either name.
 */
export { Button as DataTableColumnHeaderButton };
