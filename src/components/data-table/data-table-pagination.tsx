"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
  className?: string;
}

/**
 * Bottom-of-table pagination with summary text + numbered page nav.
 *
 * Format: "Mostrando {first} - {last} de {total} resultados"
 *         [« Anterior] 1 2 3 [Siguiente »]
 */
export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 50, 100],
  className,
}: DataTablePaginationProps<TData>) {
  const totalRows = table.getFilteredRowModel().rows.length;
  const pageSize = table.getState().pagination.pageSize;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();

  const first = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(totalRows, (pageIndex + 1) * pageSize);

  // Build compact page list: first, last, current ± 1, with ellipses.
  const pages = React.useMemo(() => {
    const set = new Set<number>([0, pageCount - 1, pageIndex, pageIndex - 1, pageIndex + 1]);
    const arr = Array.from(set)
      .filter((p) => p >= 0 && p < pageCount)
      .sort((a, b) => a - b);
    const result: Array<number | "…"> = [];
    for (let i = 0; i < arr.length; i++) {
      if (i > 0 && arr[i] - arr[i - 1] > 1) result.push("…");
      result.push(arr[i]);
    }
    return result;
  }, [pageIndex, pageCount]);

  if (totalRows === 0) {
    return (
      <div
        className={cn(
          "shrink-0 flex items-center justify-between px-5 py-3 text-xs text-muted-foreground",
          className,
        )}
      >
        <p>0 resultados</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <p className="tabular-nums">
        Mostrando {first} - {last} de {totalRows} resultados
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-medium"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft className="h-3 w-3" />
          Anterior
        </Button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground/60">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => table.setPageIndex(p)}
              className={cn(
                "h-7 w-7 inline-flex items-center justify-center rounded-md text-xs font-medium tabular-nums",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                p === pageIndex
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-current={p === pageIndex ? "page" : undefined}
            >
              {p + 1}
            </button>
          ),
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-medium"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Siguiente
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
