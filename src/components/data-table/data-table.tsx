"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type Row,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DataTableContextMenu, type DataTableContextMenuItem } from "./data-table-context-menu";

export type DataTableDensity = "comfortable" | "compact";

export interface DataTableBulkAction<TData> {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: "default" | "destructive" | "outline";
  onClick: (rows: TData[]) => void | Promise<void>;
  /** When true, the action button is disabled (e.g., loading state). */
  loading?: boolean;
  /** Optional confirmation before executing. */
  confirm?: {
    title: string;
    description: (rows: TData[]) => string;
    confirmLabel?: string;
  };
}

export interface DataTableContextMenuConfig<TData> {
  items: (row: TData) => DataTableContextMenuItem[];
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];

  /** Row identity for selection state. Defaults to row.id when available. */
  getRowId?: (row: TData) => string;

  /** Selection: enable checkbox column + bulk actions. */
  enableRowSelection?: boolean;
  bulkActions?: DataTableBulkAction<TData>[];

  /** Right-click context menu per row. */
  contextMenu?: DataTableContextMenuConfig<TData>;

  /** Sticky header inside a scrollable container. */
  stickyHeader?: boolean;

  /** Density variant. Default: "comfortable". */
  density?: DataTableDensity;

  /** Initial pagination size. Default: 20. */
  initialPageSize?: number;
  pageSizeOptions?: number[];

  /** Server-side or external state control for sorting. */
  manualSorting?: boolean;
  manualFiltering?: boolean;

  /** When true, hides the toolbar entirely. */
  hideToolbar?: boolean;

  /** Custom row click handler. */
  onRowClick?: (row: TData) => void;

  /** Click anywhere on the row vs. only on the action cell. */
  rowClickable?: boolean;

  /** Custom className for the wrapper. */
  className?: string;

  /** Optional empty state override. */
  emptyState?: React.ReactNode;

  /** Optional loading state (skeleton overlay). */
  loading?: boolean;
}

/**
 * DataTable<T> — composable data table built on TanStack Table v8.
 * Designed to consolidate the 15+ bespoke tables in the SellUp app.
 *
 * Feature flags driven by props:
 *   - Sorting: always on (per column, controlled via column.enableSorting)
 *   - Filtering: always on (per column, controlled via column.enableColumnFilter)
 *   - Selection: enableRowSelection
 *   - Right-click context menu: contextMenu
 *   - Sticky header: stickyHeader
 *   - Density: density
 *   - Pagination: always on (controlled via initialPageSize)
 *
 * @see /docs/DESIGN_SYSTEM_FOUNDATION.md § "DataTable system"
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  enableRowSelection = false,
  bulkActions,
  contextMenu,
  stickyHeader = false,
  density = "comfortable",
  initialPageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  manualSorting = false,
  manualFiltering = false,
  hideToolbar = false,
  onRowClick,
  rowClickable = false,
  className,
  emptyState,
  loading = false,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
    enableRowSelection,
    getRowId: getRowId ? (row) => getRowId(row as TData) : undefined,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    manualSorting,
    manualFiltering,
    initialState: {
      pagination: { pageSize: initialPageSize },
    },
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows.map((r) => r.original);
  const totalRows = table.getFilteredRowModel().rows.length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {!hideToolbar && (
        <DataTableToolbar
          table={table}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
          bulkActions={bulkActions}
          selectedCount={selectedRows.length}
          selectedRows={selectedRows}
          density={density}
        />
      )}

      <div
        className={cn(
          "su-table-wrapper rounded-xl border border-border/10 bg-card",
          density === "compact" && "su-table-compact",
        )}
      >
        <Table className={cn("su-table", stickyHeader && "su-table-sticky")}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: header.column.columnDef.size }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                  {table.getAllColumns().map((col) => (
                    <TableCell key={col.id}>
                      <div className="su-skeleton h-3.5 w-full rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <DataTableRow
                  key={row.id}
                  row={row}
                  rowClickable={rowClickable}
                  onRowClick={onRowClick}
                  contextMenu={contextMenu}
                />
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyState ?? "Sin resultados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        pageSizeOptions={pageSizeOptions}
        totalRows={totalRows}
      />
    </div>
  );
}

interface DataTableRowProps<TData> {
  row: Row<TData>;
  rowClickable: boolean;
  onRowClick?: (row: TData) => void;
  contextMenu?: DataTableContextMenuConfig<TData>;
}

function DataTableRow<TData>({
  row,
  rowClickable,
  onRowClick,
  contextMenu,
}: DataTableRowProps<TData>) {
  const isSelected = row.getIsSelected();
  const handleClick = rowClickable && onRowClick ? () => onRowClick(row.original) : undefined;

  const cellContent = (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      className={cn(
        handleClick && "cursor-pointer",
      )}
      onClick={handleClick}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          style={{ width: cell.column.columnDef.size }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );

  if (!contextMenu) return cellContent;

  return (
    <DataTableContextMenu items={contextMenu.items(row.original)}>
      {cellContent}
    </DataTableContextMenu>
  );
}

// Re-export for type usage in consumers.
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
export type { DataTableFacetedFilterOption } from "./data-table-faceted-filter";
export { DataTableFacetedFilter } from "./data-table-faceted-filter";
export { DataTableViewOptions } from "./data-table-view-options";
export { DataTableColumnHeader } from "./data-table-column-header";
export { DataTableBulkActions } from "./data-table-bulk-actions";
export { DataTableDensityToggle } from "./data-table-density-toggle";
