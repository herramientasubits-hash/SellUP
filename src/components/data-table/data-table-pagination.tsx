"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COUNT_FORMAT = new Intl.NumberFormat("es-CO");

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
  /** Sustantivo en plural: «empresas», «contactos». */
  noun?: string;
  /** Avisa del tamaño elegido (para recordarlo); la tabla ya se actualiza sola. */
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}

/**
 * El pie de una tabla paginada (Thema): «Página x de y · N <sustantivo>», el
 * tamaño de página y Anterior / Siguiente.
 */
export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 50, 100],
  noun = "resultados",
  onPageSizeChange,
  className,
}: DataTablePaginationProps<TData>) {
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageSize, pageIndex } = table.getState().pagination;
  const pageCount = Math.max(1, table.getPageCount());
  const sizes = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground sm:px-5",
        className,
      )}
    >
      <p className="tabular-nums" aria-live="polite">
        {totalRows === 0
          ? `0 ${noun}`
          : `Página ${pageIndex + 1} de ${pageCount} · ${COUNT_FORMAT.format(totalRows)} ${noun}`}
      </p>

      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">
          Filas por página
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            const next = Number(value);
            if (!Number.isFinite(next) || next <= 0) return;
            table.setPageSize(next);
            onPageSizeChange?.(next);
          }}
        >
          <SelectTrigger size="sm" aria-label="Filas por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizes.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
