"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type PaginationState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
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
import { Checkbox } from "@/components/ui/checkbox";
import { ListItemGroup } from "@/components/data-display/list-item";
import { TableConfigButton } from "@/components/data-display/table-config-button";
import {
  useTableConfig,
  type TableColumnSpec,
  type TableConfig,
} from "@/components/data-display/use-table-config";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    title?: React.ReactNode;
    description?: React.ReactNode;
    count?: React.ReactNode;
  }
}

import { DataTableColumnReorder, SortableTableHead } from "./data-table-column-reorder";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTableActiveFilters } from "./data-table-active-filters";
import { DataTablePagination } from "./data-table-pagination";
import {
  DataTableLazyListSentinel,
  DataTableLazySentinel,
  DataTableLoadMore,
} from "./data-table-load-more";
import { DataListActionRail, useActionsPlacement, useRailSelectionReporter } from "@/components/action-rail";
import { DataTableInlineBulkActions, useBulkRailActions } from "./data-table-bulk-actions";
import { DataTableRowReorder } from "./data-table-row-reorder";
import { DataTableRowActions } from "./data-table-row-actions";

import { DataTableRow } from "./data-table-row";
import { useColumnAutoFit } from "./use-column-auto-fit";
import {
  DEFAULT_PINNED,
  FIXED_COLUMN_LABELS,
  ROW_MENU_COLUMN_ID,
  ariaSort,
  columnLabel,
  multiValueFilter,
  resolveColumnId,
  selectionWord,
} from "./data-table-utils";
import { DataTableSelectionHeader } from "./data-table-selection-header";
import type { DataTableBulkAction, DataTableHandle, DataTableProps } from "./data-table-types";

/** Constantes estables: un `[]` nuevo en cada render volvería a pintar la barra. */
const NO_BULK_ACTIONS: DataTableBulkAction<never>[] = [];
const NO_ROWS: never[] = [];

export type {
  DataTableBulkAction,
  DataTableContextMenuConfig,
  DataTableHandle,
  DataTableListRowState,
} from "./data-table-types";

function DataTableInner<TData>(
  {
    columns,
    data,
    getRowId,
    tableId,
    noun = "resultados",
    nounGender = "m",
    defaultRowsMode,
    getRowLabel,
    renderListItem,
    title,
    description,
    actions,
    count,
    enableRowSelection = false,
    bulkActions = NO_BULK_ACTIONS as DataTableBulkAction<TData>[],
    onSelectionCountChange,
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
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [pageIndex, setPageIndex] = React.useState(0);
  const [lazyVisibleCount, setLazyVisibleCount] = React.useState(initialPageSize);

  // ── Configuración de quien mira (Thema · useTableConfig) ───────────────
  const hasOwnActionsColumn = React.useMemo(
    () => columns.some((column) => resolveColumnId(column) === "actions"),
    [columns],
  );
  const columnSpecs: TableColumnSpec[] = React.useMemo(() => {
    const specs: TableColumnSpec[] = [];
    if (enableRowReorder) specs.push({ id: "reorder", label: FIXED_COLUMN_LABELS.reorder, fixed: true });
    if (enableRowSelection) specs.push({ id: "select", label: FIXED_COLUMN_LABELS.select, fixed: true });
    for (const column of columns) {
      const id = resolveColumnId(column);
      if (!id) continue;
      specs.push({
        id,
        label: columnLabel(column, id),
        fixed: pinnedColumnIds.includes(id),
        hideable: column.enableHiding !== false,
      });
    }
    return specs;
  }, [columns, enableRowReorder, enableRowSelection, pinnedColumnIds]);

  const storedConfig = useTableConfig(tableId, columnSpecs, {
    defaultMode: defaultRowsMode,
    defaultPageSize: initialPageSize,
  });

  const isLazy = storedConfig.isLazy;
  // «Menú en cada fila» solo existe donde hay selección y acciones por fila.
  const canUseRowMenu = enableRowSelection && Boolean(contextMenu);
  const usesRowMenu = canUseRowMenu && storedConfig.rowControl === "menu";
  const usesCheckbox = enableRowSelection && !usesRowMenu;
  // Dónde van las acciones es una preferencia de la persona, la misma en
  // todas las tablas («Personalización» / ajustes de la barra): con «En la
  // pantalla» las de la selección van en la cabecera de la lista y la barra
  // flotante no se monta. Una tabla sin cabecera no tiene dónde ponerlas y
  // conserva la barra.
  const [actionsPlacement] = useActionsPlacement();
  const canPlaceActions = usesCheckbox && bulkActions.length > 0 && !hideToolbar;
  const actionsInline = canPlaceActions && actionsPlacement === "inline";
  const asList = storedConfig.view === "list" && Boolean(renderListItem);

  // Cambiar a «menú en cada fila» suelta lo marcado: en ese modo no hay lote.
  const config: TableConfig = {
    ...storedConfig,
    setRowControl: (rowControl) => {
      if (rowControl === "menu") setRowSelection({});
      storedConfig.setRowControl(rowControl);
    },
  };

  // Cuando cambia lo que se lista —filtros, orden, búsqueda, modo— la carga
  // vuelve al primer tramo. Se ajusta durante el render y no en un efecto: un
  // efecto pintaría primero las filas de la lista anterior.
  const lazyResetKey = JSON.stringify([isLazy, initialPageSize, globalFilter, columnFilters, sorting]);
  const [seenLazyResetKey, setSeenLazyResetKey] = React.useState(lazyResetKey);
  if (seenLazyResetKey !== lazyResetKey) {
    setSeenLazyResetKey(lazyResetKey);
    setLazyVisibleCount(initialPageSize);
  }

  // Build the effective column set with the optional reorder / selection
  // columns prepended and the per-row menu appended.
  const allColumns: ColumnDef<TData, unknown>[] = React.useMemo(() => {
    const leading: ColumnDef<TData, unknown>[] = [];
    const trailing: ColumnDef<TData, unknown>[] = [];
    if (enableRowReorder) {
      leading.push({
        id: "reorder",
        header: () => <span className="sr-only">Reordenar</span>,
        cell: () => null,
        size: 32,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
      });
    }
    if (usesCheckbox) {
      leading.push({
        id: "select",
        header: ({ table }) => <DataTableSelectionHeader table={table} paged={!isLazy} />,
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={
              getRowLabel ? `Seleccionar ${getRowLabel(row.original)}` : "Seleccionar fila"
            }
            className="translate-y-px"
          />
        ),
        size: 40,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
      });
    }
    if (usesRowMenu && contextMenu && !hasOwnActionsColumn) {
      trailing.push({
        id: ROW_MENU_COLUMN_ID,
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <DataTableRowActions
            items={contextMenu.items(row.original)}
            rowLabel={getRowLabel?.(row.original)}
          />
        ),
        size: 52,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
      });
    }
    return [...leading, ...columns, ...trailing];
  }, [
    columns,
    contextMenu,
    enableRowReorder,
    getRowLabel,
    hasOwnActionsColumn,
    isLazy,
    usesCheckbox,
    usesRowMenu,
  ]);

  // ── Orden, visibilidad y fijado: salen de la configuración ──────────────
  const fixedIds = React.useMemo(() => [...pinnedColumnIds, ROW_MENU_COLUMN_ID], [pinnedColumnIds]);
  const { columnOrder, stickyIds } = React.useMemo(() => {
    const ids = allColumns.map(resolveColumnId).filter((id): id is string => Boolean(id));
    const movable = new Set(storedConfig.order);
    const firstMovable = ids.findIndex((id) => movable.has(id));
    const leadFixed = ids.filter((id, index) => !movable.has(id) && (firstMovable === -1 || index < firstMovable));
    const trailFixed = ids.filter((id) => !movable.has(id) && !leadFixed.includes(id));
    const pinned = storedConfig.pinnedOrder;
    return {
      // Las fijadas van primero: una columna quieta en mitad de la tabla
      // taparía a las que pasan por debajo.
      columnOrder: [
        ...leadFixed,
        ...pinned,
        ...storedConfig.order.filter((id) => !pinned.includes(id)),
        ...trailFixed,
      ],
      // Con alguna fijada, las de servicio (selección, reordenar) se quedan
      // quietas también: si no, pasarían por debajo de ella.
      stickyIds: pinned.length > 0 ? [...leadFixed, ...pinned] : [],
    };
  }, [allColumns, storedConfig.order, storedConfig.pinnedOrder]);

  const columnVisibility = React.useMemo(
    () => Object.fromEntries(Array.from(storedConfig.hidden, (id) => [id, false])),
    [storedConfig.hidden],
  );

  // Row reorder implies manual order: the parent owns the data array and
  // the table must not re-sort it WHILE the user has not expressed an
  // explicit sort preference. As soon as the user clicks a sort header we
  // release control and let TanStack sort, so the column sort actually
  // re-orders rows instead of only toggling the arrow icon.
  const effectiveManualSorting =
    manualSorting || (enableRowReorder && sorting.length === 0);

  // Scroll infinito = una sola «página» que crece: así el tramo visible se
  // corta DESPUÉS de filtrar y ordenar, y los filtros ven todas las filas.
  const pagination: PaginationState = isLazy
    ? { pageIndex: 0, pageSize: lazyVisibleCount }
    : { pageIndex, pageSize: storedConfig.pageSize };

  const handlePaginationChange = (updater: Updater<PaginationState>) => {
    if (isLazy) return;
    const next = typeof updater === "function" ? updater(pagination) : updater;
    setPageIndex(next.pageIndex);
    if (next.pageSize !== storedConfig.pageSize) storedConfig.setPageSize(next.pageSize);
  };

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    defaultColumn: { filterFn: multiValueFilter as FilterFn<TData> },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
      columnOrder,
      pagination,
    },
    enableRowSelection: usesCheckbox,
    getRowId: (row) => getRowId(row as TData),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    manualSorting: effectiveManualSorting,
    manualFiltering,
    meta: {
      title: title ?? null,
      description: description ?? null,
      count: count ?? null,
    },
  });

  const rows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;
  const shownRows = rows.length;
  const hasActiveFilters = columnFilters.length > 0 || globalFilter.trim().length > 0;
  // Con filtros puestos el total del título es el de lo que se está viendo.
  const displayCount = count === undefined ? null : hasActiveFilters ? totalRows : count;

  const selectedRowModel = usesCheckbox ? table.getFilteredSelectedRowModel().rows : (NO_ROWS as Row<TData>[]);
  const selectedRows = React.useMemo(() => selectedRowModel.map((r) => r.original), [selectedRowModel]);
  const selectedCount = selectedRows.length;
  const reportedSelectionCount = actionsInline ? 0 : selectedCount;

  React.useEffect(() => {
    onSelectionCountChange?.(reportedSelectionCount);
  }, [onSelectionCountChange, reportedSelectionCount]);

  const clearSelection = React.useCallback(() => table.resetRowSelection(), [table]);

  // ── La selección va a LA barra de la pantalla (una sola por pantalla) ────
  // Con filas marcadas, las acciones masivas sustituyen a las de pantalla en
  // la barra flotante. Dentro de un `ListActionRailProvider` la tabla solo
  // informa; fuera de él monta la barra ella misma. Con las acciones «En la
  // pantalla» no informa nada: van en la cabecera de la lista.
  const { railActions, confirmDialog } = useBulkRailActions(bulkActions, selectedRows);
  const reportSelection = useRailSelectionReporter();
  const railSelection = React.useMemo(
    () =>
      reportedSelectionCount > 0
        ? { count: reportedSelectionCount, actions: railActions, onClear: clearSelection, gender: nounGender }
        : null,
    [reportedSelectionCount, railActions, clearSelection, nounGender],
  );

  React.useEffect(() => {
    reportSelection?.(railSelection);
  }, [reportSelection, railSelection]);

  React.useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

  const loadMore = React.useCallback(
    () => setLazyVisibleCount((current) => current + initialPageSize),
    [initialPageSize],
  );

  const stickyOffsets = useColumnAutoFit(tableWrapperRef, table, stickyIds, [
    columnVisibility,
    columnOrder,
    asList,
  ]);

  const lastStickyId = stickyIds[stickyIds.length - 1];
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const sortedRowOriginals = React.useMemo(() => rows.map((row) => row.original), [rows]);

  // Soltar una fila reordena solo el tramo que se ve: lo recoloca en las
  // mismas posiciones que ocupaba dentro de la lista completa.
  const handleRowReorder = (nextVisible: TData[]) => {
    if (!onRowReorder) return;
    const positions = rows.map((row) => row.index).sort((a, b) => a - b);
    const next = [...data];
    nextVisible.forEach((row, i) => {
      next[positions[i]] = row;
    });
    onRowReorder(next);
  };

  const rowMenuFor = (row: Row<TData>) =>
    usesRowMenu && contextMenu ? (
      <DataTableRowActions
        items={contextMenu.items(row.original)}
        rowLabel={getRowLabel?.(row.original)}
      />
    ) : null;

  const configButton = (
    <TableConfigButton
      config={config}
      noun={noun}
      showView={Boolean(renderListItem)}
      showRowControl={canUseRowMenu}
      extraSections={settingsExtraSections}
    />
  );

  const emptyContent = emptyState ?? (hasActiveFilters ? "Nada coincide con estos filtros." : "Sin resultados.");

  // ── Render ─────────────────────────────────────────────────────────────
  // When fillHeight is true, the card uses h-full + flex-col and the table
  // wrapper becomes the scroll container with the thead sticky inside it.
  // This lets the page keep PageHeader + metrics fixed at the top while only
  // the table rows scroll.
  return (
    <div
      className={cn(
        "flex flex-col",
        fillHeight && "h-full min-h-0 flex-1",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-2xl border border-border/60 bg-card shadow-card",
          fillHeight
            ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
            : "overflow-hidden",
        )}
      >
        {!hideToolbar && (
          <DataTableToolbar
            table={table}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            actions={actions}
            configButton={configButton}
            count={displayCount}
            noun={noun}
            takeOver={
              actionsInline && selectedCount > 0
                ? {
                    label: `${selectedCount} ${selectionWord(selectedCount, nounGender)}`,
                    onClear: clearSelection,
                    actions: (
                      <DataTableInlineBulkActions selectedRows={selectedRows} actions={bulkActions} />
                    ),
                  }
                : null
            }
          />
        )}

        <DataTableActiveFilters
          table={table}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
        />

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
          {asList ? (
            rows.length > 0 ? (
              <ListItemGroup className="p-3">
                {rows.map((row) => (
                  <React.Fragment key={row.id}>
                    {renderListItem?.(row.original, {
                      selected: row.getIsSelected(),
                      toggle: () => row.toggleSelected(),
                      checkbox: usesCheckbox ? (
                        <Checkbox
                          checked={row.getIsSelected()}
                          onCheckedChange={(value) => row.toggleSelected(!!value)}
                          aria-label={
                            getRowLabel ? `Seleccionar ${getRowLabel(row.original)}` : "Seleccionar fila"
                          }
                        />
                      ) : null,
                      menu: rowMenuFor(row),
                    })}
                  </React.Fragment>
                ))}
                {isLazy && (
                  <DataTableLazyListSentinel
                    key={shownRows}
                    remaining={totalRows - shownRows}
                    noun={noun}
                    onLoadMore={loadMore}
                  />
                )}
              </ListItemGroup>
            ) : (
              <div className="flex min-h-32 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {emptyContent}
              </div>
            )
          ) : (
          <Table
            className={cn(
              "su-table",
              (stickyHeader || fillHeight) && "su-table-sticky",
            )}
            containerClassName={fillHeight ? undefined : "overflow-x-auto"}
          >
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent border-border/60">
                  {enableColumnReorder ? (
                    <DataTableColumnReorder
                      columnOrder={headerGroup.headers.map((h) => h.column.id)}
                      disabledColumns={fixedIds}
                      onMove={config.moveColumn}
                    >
                      {(columnId) => {
                        const header = headerGroup.headers.find((h) => h.column.id === columnId);
                        if (!header) return null;
                        return (
                          <SortableTableHead
                            key={header.id}
                            id={columnId}
                            disabled={fixedIds.includes(columnId)}
                            style={{ width: header.column.columnDef.size }}
                            stickyLeft={stickyOffsets[columnId]}
                            aria-sort={ariaSort(header.column)}
                            data-column-id={columnId}
                            data-pinned={stickyOffsets[columnId] !== undefined || undefined}
                            className={cn(columnId === lastStickyId && "border-r border-border/60")}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </SortableTableHead>
                        );
                      }}
                    </DataTableColumnReorder>
                  ) : (
                    headerGroup.headers.map((header) => {
                      const stickyLeft = stickyOffsets[header.column.id];
                      const isSticky = stickyLeft !== undefined;
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={ariaSort(header.column)}
                          data-column-id={header.column.id}
                          data-pinned={isSticky || undefined}
                          className={cn(header.column.id === lastStickyId && "border-r border-border/60")}
                          style={{
                            width: header.column.columnDef.size,
                            ...(fillHeight || isSticky
                              ? {
                                  position: "sticky",
                                  top: fillHeight ? 0 : undefined,
                                  left: stickyLeft,
                                  zIndex: isSticky ? 20 : 10,
                                  backgroundColor: "var(--card)",
                                }
                              : {}),
                          }}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      );
                    })
                  )}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                    {table.getVisibleLeafColumns().map((col) => (
                      <TableCell key={col.id}>
                        <div className="su-skeleton h-3.5 w-full rounded-md" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length ? (
                <>
                  {enableRowReorder && onRowReorder ? (
                    <DataTableRowReorder<TData>
                      data={sortedRowOriginals}
                      getRowId={(row, i) => getRowId(row) || String(i)}
                      onRowReorder={handleRowReorder}
                    >
                      {(row, index, handleProps) => {
                        const tableRow = rows[index];
                        if (!tableRow) return null;
                        return (
                          <DataTableRow
                            key={tableRow.id}
                            row={tableRow}
                            rowClickable={rowClickable}
                            onRowClick={onRowClick}
                            selectOnClick={usesCheckbox}
                            contextMenu={contextMenu}
                            stickyOffsets={stickyOffsets}
                            lastStickyId={lastStickyId}
                            reorderHandleProps={handleProps}
                          />
                        );
                      }}
                    </DataTableRowReorder>
                  ) : (
                    rows.map((row) => (
                      <DataTableRow
                        key={row.id}
                        row={row}
                        rowClickable={rowClickable}
                        onRowClick={onRowClick}
                        selectOnClick={usesCheckbox}
                        contextMenu={contextMenu}
                        stickyOffsets={stickyOffsets}
                        lastStickyId={lastStickyId}
                      />
                    ))
                  )}
                  {isLazy && (
                    <DataTableLazySentinel
                      shownRows={shownRows}
                      remaining={totalRows - shownRows}
                      colSpan={visibleColumnCount}
                      noun={noun}
                      onLoadMore={loadMore}
                    />
                  )}
                </>
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={visibleColumnCount}
                    className="h-32 text-center text-sm text-muted-foreground whitespace-normal"
                  >
                    {emptyContent}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          )}
        </div>

        {isLazy ? (
          <DataTableLoadMore totalRows={totalRows} shownRows={shownRows} noun={noun} />
        ) : (
          <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} noun={noun} />
        )}
      </div>

      {!reportSelection && railSelection && (
        <DataListActionRail
          actions={railSelection.actions}
          selectedCount={railSelection.count}
          onClearSelection={railSelection.onClear}
          gender={railSelection.gender}
        />
      )}
      {!actionsInline && confirmDialog}
    </div>
  );
}

/**
 * DataTable<T> — la tabla operable de SellUp: motor TanStack Table v8 con la
 * experiencia de Thema (cabeceras con orden y embudo a la vista, filtros
 * activos en chips, panel «Configurar tabla», menú de selección, scroll
 * infinito o paginación).
 *
 * @see /docs/DESIGN_SYSTEM_FOUNDATION.md § 10 — DataTable system
 */
export const DataTable = React.forwardRef(DataTableInner) as <TData>(
  props: DataTableProps<TData> & { ref?: React.ForwardedRef<DataTableHandle> },
) => ReturnType<typeof DataTableInner>;

// Re-exports for consumers
export { DataTableColumnHeader } from "./data-table-column-header";
export type { DataTableColumnFilterOption, DataTableColumnMeta } from "./data-table-column-meta";
