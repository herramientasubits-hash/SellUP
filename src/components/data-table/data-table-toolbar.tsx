"use client";

import * as React from "react";
import { type Table } from "@tanstack/react-table";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type DataTableBulkAction, type DataTableDensity } from "./data-table";
import { DataTableViewOptions } from "./data-table-view-options";
import { DataTableDensityToggle } from "./data-table-density-toggle";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  bulkActions?: DataTableBulkAction<TData>[];
  selectedCount: number;
  selectedRows: TData[];
  density: DataTableDensity;
}

export function DataTableToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  bulkActions,
  selectedCount,
  selectedRows,
  density,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0 || globalFilter !== "";
  const hasFacetedFilters = table
    .getAllColumns()
    .some((col) => col.columnDef.enableColumnFilter && (col.columnDef as any).meta?.facetedFilterOptions);

  if (selectedCount > 0) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-su-brand/30 bg-su-brand-soft px-3 py-2 animate-su-fade-in">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-su-brand">
            {selectedCount} seleccionado{selectedCount > 1 ? "s" : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => table.resetRowSelection()}
          >
            <X className="h-3 w-3" />
            Limpiar
          </Button>
        </div>
        {bulkActions && bulkActions.length > 0 && (
          <div className="flex items-center gap-1.5">
            {bulkActions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant ?? "outline"}
                size="sm"
                disabled={action.loading}
                onClick={() => action.onClick(selectedRows)}
                className="h-7 text-xs"
              >
                {action.icon && <action.icon className="h-3.5 w-3.5" />}
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar…"
            value={globalFilter}
            onChange={(e) => onGlobalFilterChange(e.target.value)}
            className="h-9 w-[180px] pl-8 lg:w-[260px]"
          />
        </div>

        {table
          .getAllColumns()
          .filter((col) => {
            const meta = (col.columnDef as any).meta;
            return col.getCanFilter() && meta?.facetedFilterOptions;
          })
          .map((column) => {
            const meta = (column.columnDef as any).meta;
            return (
              <DataTableFacetedFilter
                key={column.id}
                column={column}
                title={meta.facetedFilterTitle ?? column.id}
                options={meta.facetedFilterOptions}
              />
            );
          })}

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              table.resetColumnFilters();
              onGlobalFilterChange("");
            }}
            className="h-9 px-2 text-xs"
          >
            Reiniciar
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DataTableDensityToggle density={density} />
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}
