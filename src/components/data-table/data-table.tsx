"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type ColumnPinningState,
  type ColumnOrderState,
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
import {} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    title?: React.ReactNode;
    description?: React.ReactNode;
    count?: React.ReactNode;
  }
}

import type { RowData } from "@tanstack/react-table";

import { DataTableContextMenu, type DataTableContextMenuItem } from "./data-table-context-menu";
import { DataTableColumnReorder, SortableTableHead } from "./data-table-column-reorder";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableLoadMore } from "./data-table-load-more";
import { DataTableBulkActionBar } from "./data-table-bulk-action-bar";
import { DataTableRowReorder, RowDragHandle } from "./data-table-row-reorder";
import {
  DataTableSettingsDrawer,
  DataTableSettingsTrigger,
  type DataTableSettings,
} from "./data-table-settings-drawer";

export interface DataTableBulkAction<TData> {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: "default" | "destructive";
  /** Ignored when `items` is set — a grouped action has no direct click target. */
  onClick?: (rows: TData[]) => void | Promise<void>;
  loading?: boolean;
  /**
   * Optional predicate evaluated with the currently selected rows. Return
   * `true` to disable the button (e.g. "Ver detalle" only valid with exactly
   * one selected row, "Abrir URLs" only when at least one row has a URL).
   */
  disabled?: (rows: TData[]) => boolean;
  /**
   * Optional tooltip copy shown while the button is disabled (e.g. "Aprobación
   * masiva pendiente" when more than one row is selected). Returning
   * `undefined` renders no tooltip.
   */
  disabledLabel?: (rows: TData[]) => string | undefined;
  confirm?: {
    title: string;
    description: (rows: TData[]) => string;
    confirmLabel?: string;
  };
  /**
   * When set, renders this action as a dropdown trigger instead of a button —
   * each entry is its own mini bulk action (own disabled/disabledLabel/onClick).
   * Used to group not-yet-available actions under a single "Más acciones"
   * menu, matching the side panel footer hierarchy.
   */
  items?: DataTableBulkAction<TData>[];
}

export interface DataTableHandle {
  /** Clears the current row selection (and, with it, hides the bulk action bar). */
  clearSelection: () => void;
}

export interface DataTableContextMenuConfig<TData> {
  items: (row: TData) => DataTableContextMenuItem[];
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];

  /** Required for stable selection / context menu keys. */
  getRowId: (row: TData) => string;

  /** Title shown in the toolbar (e.g. "Listado de Cursos de Formación"). */
  title?: React.ReactNode;
  /** Description shown below the title. */
  description?: React.ReactNode;
  /** Right-aligned action buttons in the toolbar (CSV, New, etc). */
  actions?: React.ReactNode;
  /** Optional count badge next to the title. */
  count?: number;

  /** Selection: enable checkbox column + floating bulk action bar. */
  enableRowSelection?: boolean;
  bulkActions?: DataTableBulkAction<TData>[];

  /** Right-click context menu per row. */
  contextMenu?: DataTableContextMenuConfig<TData>;

  /** Sticky header inside a scrollable container. */
  stickyHeader?: boolean;

  /** Initial pagination size. Default: 20. */
  initialPageSize?: number;
  pageSizeOptions?: number[];

  /** Enable column reordering via drag-and-drop on header cells. */
  enableColumnReorder?: boolean;
  /** Column ids that cannot be reordered (e.g. selection, actions). */
  pinnedColumnIds?: string[];

  /**
   * Enable row drag-and-drop. Adds a pinned "reorder" column on the left
   * with a grip handle; drag rows to reorder them. When enabled, the
   * table's internal sort is bypassed and the data is rendered in the
   * exact order provided — the parent is responsible for reordering the
   * data via `onRowReorder`.
   */
  enableRowReorder?: boolean;
  /** Called with the new data array after a successful row drop. */
  onRowReorder?: (newData: TData[]) => void;

  /** Server-side or external state control for sorting. */
  manualSorting?: boolean;
  manualFiltering?: boolean;

  /** Custom row click handler. */
  onRowClick?: (row: TData) => void;
  rowClickable?: boolean;

  /** Custom className for the wrapper. */
  className?: string;

  /** Optional empty state override. */
  emptyState?: React.ReactNode;

  /** Optional loading state (skeleton overlay). */
  loading?: boolean;

  /** Hide the toolbar entirely. */
  hideToolbar?: boolean;

  /**
   * Extra sections rendered inside the settings drawer, before column
   * visibility. Use to inject module-specific filters (e.g. scope filters).
   */
  settingsExtraSections?: React.ReactNode;

  /**
   * Fill the parent's height and scroll the table internally (sticky thead
   * inside the scroll container). The parent must be a flex container with
   * a defined height (e.g. <DataTablePage>).
   *
   * When true, this overrides the default `stickyHeader` max-height with a
   * flex layout that grows to fill the available space.
   */
  fillHeight?: boolean;
}

const DEFAULT_SETTINGS: DataTableSettings = {
  globalSearch: true,
  loadMode: "pagination",
};

const DEFAULT_PINNED = ["select", "reorder", "actions"];

function DataTableInner<TData>(
  {
    columns,
    data,
    getRowId,
    title,
    description,
    actions,
    count,
    enableRowSelection = false,
    bulkActions = [],
    contextMenu,
    stickyHeader = false,
    initialPageSize = 20,
    pageSizeOptions = [10, 20, 50, 100],
    enableColumnReorder = true,
    pinnedColumnIds = DEFAULT_PINNED,
    enableRowReorder = false,
    onRowReorder,
    manualSorting = false,
    manualFiltering = false,
    onRowClick,
    rowClickable = false,
    className,
    emptyState,
    loading = false,
    hideToolbar = false,
    settingsExtraSections,
    fillHeight = false,
  }: DataTableProps<TData>,
  ref: React.ForwardedRef<DataTableHandle>,
) {
  const tableWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>({ left: [], right: [] });
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);
  const [settings, setSettings] = React.useState<DataTableSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [lazyVisibleCount, setLazyVisibleCount] = React.useState(initialPageSize);
  const isLazy = settings.loadMode === "lazy";
  const lazyStep = initialPageSize;

  const showGlobalSearch = settings.globalSearch;

  // When switching modes or filters, reset the lazy window to its initial size.
  React.useEffect(() => {
    setLazyVisibleCount(initialPageSize);
  }, [isLazy, initialPageSize, globalFilter, columnFilters, sorting]);

  // Build the effective column set with optional selection column prepended
  // and actions column appended (handled by user via meta; here we only add
  // the selection column).
  const allColumns: ColumnDef<TData, unknown>[] = React.useMemo(() => {
    const extras: ColumnDef<TData, unknown>[] = [];
    if (enableRowReorder) {
      extras.push({
        id: "reorder",
        header: () => <span className="sr-only">Reordenar</span>,
        cell: () => null,
        size: 32,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
      });
    }
    if (enableRowSelection) {
      extras.push({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Seleccionar todas las filas"
            className="translate-y-[1px]"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Seleccionar fila"
            className="translate-y-[1px]"
          />
        ),
        size: 36,
        enableSorting: false,
        enableHiding: false,
      });
    }
    return [...extras, ...columns];
  }, [columns, enableRowSelection, enableRowReorder]);

  // Row reorder implies manual order: the parent owns the data array and
  // the table must not re-sort it WHILE the user has not expressed an
  // explicit sort preference. As soon as the user clicks a sort header we
  // release control and let TanStack sort, so the column sort actually
  // re-orders rows instead of only toggling the arrow icon.
  const effectiveManualSorting =
    manualSorting || (enableRowReorder && sorting.length === 0);

  // In lazy mode we slice the data the user can see; pagination is disabled
  // and a "Cargar más" button is shown instead. In pagination mode the
  // full dataset is paginated normally.
  const effectiveData = React.useMemo(
    () => (isLazy ? data.slice(0, lazyVisibleCount) : data),
    [data, isLazy, lazyVisibleCount],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: effectiveData,
    columns: allColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
      columnPinning,
      columnOrder: columnOrder.length > 0 ? columnOrder : undefined,
    },
    enableRowSelection,
    getRowId: (row) => getRowId(row as TData),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onColumnPinningChange: setColumnPinning,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    manualSorting: effectiveManualSorting,
    manualFiltering,
    initialState: {
      pagination: { pageSize: isLazy ? Number.MAX_SAFE_INTEGER : initialPageSize },
    },
    meta: {
      title: title ?? null,
      description: description ?? null,
      count: count ?? null,
    },
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows.map((r) => r.original);
  const selectedCount = selectedRows.length;

  const clearSelection = React.useCallback(() => table.resetRowSelection(), [table]);

  React.useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

  // ── Auto-fit columns to wrapper width ──────────────────────────────────
  // `table-layout: fixed` + explicit pixel widths leaves the extra space as
  // a blank gap on the right when the sum of visible column `size` values is
  // less than the wrapper. This effect distributes that extra space
  // proportionally across visible columns so the table always fills its
  // container, and re-runs when the wrapper resizes or columns toggle.
  //
  // We defer the first measurement with `requestAnimationFrame` because the
  // wrapper sits inside a flex column that may not have laid out yet when
  // useLayoutEffect runs synchronously, so `clientWidth` would be 0/wrong.
  React.useLayoutEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;

    const apply = () => {
      const visible = table.getVisibleLeafColumns();
      if (visible.length === 0) return;

      // Use the rendered wrapper width (excluding scrollbar).
      const wrapperWidth = wrapper.clientWidth;
      if (wrapperWidth <= 0) return;

      // Sum the requested min widths; fall back to 150 per missing value.
      const sizes = visible.map((c) => {
        const s = c.columnDef.size;
        return typeof s === "number" && s > 0 ? s : 150;
      });
      const totalRequested = sizes.reduce((a, b) => a + b, 0);
      const extra = Math.max(0, wrapperWidth - totalRequested);

      visible.forEach((col, i) => {
        const proportion = sizes[i] / totalRequested;
        const width = sizes[i] + extra * proportion;
        const th = wrapper.querySelector<HTMLElement>(
          `[data-column-id="${col.id}"]`,
        );
        if (th) th.style.width = `${width}px`;
      });
    };

    const rafId = requestAnimationFrame(apply);
    const ro = new ResizeObserver(apply);
    ro.observe(wrapper);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [table, columnVisibility, columnOrder]);

  // ── Render ─────────────────────────────────────────────────────────────
  // When fillHeight is true, the card uses h-full + flex-col and the table
  // wrapper becomes the scroll container with the thead sticky inside it.
  // This lets the page keep PageHeader + metrics fixed at the top while only
  // the table rows scroll.
  return (
    <div
      className={cn(
        "flex",
        fillHeight ? "h-full min-h-0 flex-col" : "flex-col",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-xl border border-border/40 bg-card shadow-sm",
          fillHeight
            ? "flex h-full min-h-0 flex-col overflow-hidden"
            : "overflow-hidden",
        )}
      >
        {!hideToolbar && (
          <DataTableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            showGlobalSearch={showGlobalSearch}
            actions={actions}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {count !== undefined && title !== undefined && (
          <div className="sr-only">
            {count} {typeof title === "string" ? title : ""}
          </div>
        )}

        <div
          ref={tableWrapperRef}
          className={cn(
            fillHeight
              ? "su-table-scroll"
              : cn(
                  "su-table-wrapper relative w-full",
                  stickyHeader && "max-h-[60vh]",
                ),
          )}
        >
          <Table
            className={cn(
              "su-table",
              (stickyHeader || fillHeight) && "su-table-sticky",
            )}
            containerClassName={fillHeight ? undefined : "overflow-x-auto"}
          >
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent border-border/40">
                  {enableColumnReorder ? (
                    <DataTableColumnReorder
                      columnOrder={
                        table.getState().columnOrder && table.getState().columnOrder.length > 0
                          ? table.getState().columnOrder!
                          : headerGroup.headers.map((h) => h.column.id)
                      }
                      disabledColumns={pinnedColumnIds}
                      onOrderChange={(next) => setColumnOrder(next)}
                    >
                      {(columnId) => {
                        const header = headerGroup.headers.find((h) => h.column.id === columnId);
                        if (!header) return null;
                        return (
                          <SortableTableHead
                            key={header.id}
                            id={columnId}
                            disabled={pinnedColumnIds.includes(columnId)}
                            style={{ width: header.column.columnDef.size }}
                            data-column-id={columnId}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </SortableTableHead>
                        );
                      }}
                    </DataTableColumnReorder>
                  ) : (
                    headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{
                          width: header.column.columnDef.size,
                          ...(fillHeight ? { position: "sticky", top: 0, zIndex: 10, backgroundColor: "var(--card)" } : {}),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))
                  )}
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
                enableRowReorder && onRowReorder ? (
                  <DataTableRowReorder<TData>
                    data={effectiveData}
                    getRowId={(row, i) => getRowId(row) || String(i)}
                    onRowReorder={onRowReorder}
                  >
                    {(row, index, handleProps) => {
                      const tableRow = table.getRowModel().rows[index];
                      if (!tableRow) return null;
                      return (
                        <DataTableRow
                          key={tableRow.id}
                          row={tableRow}
                          rowClickable={rowClickable}
                          onRowClick={onRowClick}
                          contextMenu={contextMenu}
                          reorderHandleProps={handleProps}
                        />
                      );
                    }}
                  </DataTableRowReorder>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <DataTableRow
                      key={row.id}
                      row={row}
                      rowClickable={rowClickable}
                      onRowClick={onRowClick}
                      contextMenu={contextMenu}
                    />
                  ))
                )
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={allColumns.length}
                    className="h-32 text-center text-sm text-muted-foreground whitespace-normal"
                  >
                    {emptyState ?? "Sin resultados."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {isLazy ? (
          <DataTableLoadMore
            totalRows={data.length}
            shownRows={Math.min(effectiveData.length, data.length)}
            onLoadMore={() =>
              setLazyVisibleCount((prev) => Math.min(prev + lazyStep, data.length))
            }
          />
        ) : (
          <DataTablePagination
            table={table}
            pageSizeOptions={pageSizeOptions}
          />
        )}
      </div>

      {enableRowSelection && (selectedCount > 0 || bulkActions.length > 0) && (
        <DataTableBulkActionBar
          selectedCount={selectedCount}
          selectedRows={selectedRows}
          actions={bulkActions}
          onClear={clearSelection}
        />
      )}

      <DataTableSettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onChange={setSettings}
        table={table}
        extraSections={settingsExtraSections}
      />
    </div>
  );
}

/**
 * DataTable<T> — composable data table built on TanStack Table v8.
 * Designed to consolidate the 15+ bespoke tables in the SellUp app.
 *
 * @see /docs/DESIGN_SYSTEM_FOUNDATION.md § 10 — DataTable system
 */
export const DataTable = React.forwardRef(DataTableInner) as <TData>(
  props: DataTableProps<TData> & { ref?: React.ForwardedRef<DataTableHandle> },
) => ReturnType<typeof DataTableInner>;

interface DataTableRowProps<TData> {
  row: Row<TData>;
  rowClickable: boolean;
  onRowClick?: (row: TData) => void;
  contextMenu?: DataTableContextMenuConfig<TData>;
  /**
   * When row reorder is enabled, the parent `DataTableRowReorder` passes
   * the dnd-kit handle props here so the grip cell is rendered as the
   * first cell. The row is already wrapped in a `<SortableTableRow>` in
   * that case, so we don't render the `<TableRow>` ourselves.
   */
  reorderHandleProps?: React.HTMLAttributes<HTMLButtonElement> & {
    isDragging: boolean;
  };
}

function DataTableRow<TData>({
  row,
  rowClickable,
  onRowClick,
  contextMenu,
  reorderHandleProps,
}: DataTableRowProps<TData>) {
  const isSelected = row.getIsSelected();
  const handleClick = rowClickable && onRowClick
    ? (e: React.MouseEvent<HTMLTableRowElement>) => {
        const target = e.target as HTMLElement;
        if (
          target.closest('[data-table-select]') ||
          target.closest('[role="checkbox"]') ||
          target.closest('button') ||
          target.closest('a')
        ) {
          return;
        }
        onRowClick(row.original);
      }
    : undefined;

  const cells = (
    <>
      {reorderHandleProps && (
        <RowDragHandle {...reorderHandleProps} />
      )}
      {row
        .getVisibleCells()
        // The `reorder` column lives in `allColumns` so the thead has a
        // matching header (and the auto-fit effect can size it), but its
        // cell renders `null`. When row reorder is enabled we replace it
        // with the grip handle above, so filter it out here to avoid a
        // phantom empty cell next to the grip.
        .filter((cell) => (reorderHandleProps ? cell.column.id !== "reorder" : true))
        .map((cell) => (
          <TableCell
            key={cell.id}
            style={{ width: cell.column.columnDef.size }}
            data-table-select={cell.column.id === "select" || undefined}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
    </>
  );

  const cellContent = reorderHandleProps ? (
    cells
  ) : (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      className={cn(
        "border-border/40 group",
        handleClick && "cursor-pointer",
        isSelected && "bg-primary/5",
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

// Re-exports for consumers
export { DataTableColumnHeader } from "./data-table-column-header";
export {
  DataTableColumnPopover,
  type DataTableColumnFilterOption,
  type DataTableColumnMeta,
} from "./data-table-column-popover";
export { DataTableSettingsDrawer, DataTableSettingsTrigger, type DataTableSettings };
