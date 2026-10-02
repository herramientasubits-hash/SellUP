'use client';

import * as React from 'react';
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  XCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitMerge,
} from "@/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SurfaceCard } from '@/components/shared/surface-card';
import {
  DataTableActiveFilters,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableSelectionHeader,
  multiValueFilter,
} from '@/components/data-table';
import type { FilterFn } from '@tanstack/react-table';
import type { ImportRow } from '@/modules/prospect-batches/import-candidates-parser';
import type { ImportDuplicateResult } from './import-candidates-helpers';

// ── Helpers ────────────────────────────────────────────────────

function DuplicateBadge({ status }: { status?: ImportDuplicateResult['duplicate_status'] }) {
  if (!status || status === 'no_match') return null;
  if (status === 'exact_duplicate') {
    return (
      <Badge variant="warning">
          <GitMerge />
          Duplicado exacto
        </Badge>
    );
  }
  if (status === 'possible_duplicate') {
    return (
      <Badge variant="warning">
          <GitMerge />
          Posible duplicado
        </Badge>
    );
  }
  return null;
}

function DefaultBadge({ label }: { label: string }) {
  return (
    <Badge variant="brand">{label}</Badge>
  );
}

// ── Types ──────────────────────────────────────────────────────

interface ImportPreviewDataTableProps {
  rows: ImportRow[];
  duplicateMap: Map<number, ImportDuplicateResult>;
  onSelectionChange: (selectedRows: ImportRow[]) => void;
}

// ── Component ──────────────────────────────────────────────────

export function ImportPreviewDataTable({
  rows,
  duplicateMap,
  onSelectionChange,
}: ImportPreviewDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  const defaultSelection = React.useMemo<RowSelectionState>(() => {
    const sel: RowSelectionState = {};
    rows.forEach((r) => {
      if (r.status !== 'error') sel[r.index] = true;
    });
    return sel;
  }, [rows]);

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(defaultSelection);

  const notifySelection = React.useCallback(
    (sel: RowSelectionState) => {
      onSelectionChange(rows.filter((r) => sel[r.index]));
    },
    [rows, onSelectionChange],
  );

  const handleRowSelectionChange = React.useCallback(
    (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => {
      setRowSelection((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        notifySelection(next);
        return next;
      });
    },
    [notifySelection],
  );

  React.useEffect(() => {
    notifySelection(rowSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getRowId = React.useCallback((row: ImportRow) => String(row.index), []);

  const columns = React.useMemo<ColumnDef<ImportRow, unknown>[]>(() => [
    {
      id: 'index',
      accessorFn: (row) => row.index + 1,
      header: '#',
      cell: ({ getValue }) => (
        <span className="block text-center tabular-nums text-muted-foreground">
          {getValue() as number}
        </span>
      ),
      size: 50,
      enableSorting: false,
      enableHiding: false,
      enableColumnFilter: false,
      meta: { label: '#', disableFilter: true, disableSort: true },
    },
    {
      id: 'company_name',
      accessorFn: (row) => row.raw.company_name || '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Empresa" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col gap-0.5 min-w-0 max-w-52">
            <p className="font-semibold text-foreground truncate" title={r.raw.company_name}>
              {r.raw.company_name || <span className="text-muted-foreground italic">Sin nombre</span>}
            </p>
            {r.raw.description && (
              <p className="text-xs text-muted-foreground truncate" title={r.raw.description}>
                {r.raw.description}
              </p>
            )}
          </div>
        );
      },
      size: 200,
      minSize: 180,
      // Texto libre: se ordena, no se filtra por valores.
      meta: { label: 'Empresa', popoverTitle: 'Empresa', disableFilter: true },
    },
    {
      id: 'country',
      accessorFn: (row) => row.resolved_country_code ?? row.raw.country_code ?? row.raw.country ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="País" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <p className="text-foreground font-medium">
              {r.resolved_country_code ?? r.raw.country_code ?? r.raw.country ?? (
                <span className="text-muted-foreground italic">—</span>
              )}
            </p>
            {r.country_from_default && <DefaultBadge label="por defecto" />}
          </div>
        );
      },
      size: 110,
      filterFn: 'arrIncludesSome',
      meta: { label: 'País', popoverTitle: 'País' },
    },
    {
      id: 'industry',
      accessorFn: (row) => row.raw.industry ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Sector" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <p className="text-foreground truncate max-w-30" title={r.raw.industry}>
              {r.raw.industry ?? <span className="text-muted-foreground italic">—</span>}
            </p>
            {r.industry_from_default && <DefaultBadge label="por defecto" />}
          </div>
        );
      },
      size: 130,
      filterFn: 'arrIncludesSome',
      meta: { label: 'Sector', popoverTitle: 'Sector' },
    },
    {
      id: 'website',
      accessorFn: (row) => row.raw.website ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Website" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        if (!r.raw.website) return <span className="text-muted-foreground italic">—</span>;
        const display = r.raw.website.replace(/^(https?:\/\/)?(www\.)?/, '');
        const href = r.raw.website.startsWith('http') ? r.raw.website : `https://${r.raw.website}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-32 font-medium"
            title={r.raw.website}
            onClick={(e) => e.stopPropagation()}
          >
            {display}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      },
      size: 150,
      meta: { label: 'Website', popoverTitle: 'Website', disableFilter: true },
    },
    {
      id: 'linkedin_url',
      accessorFn: (row) => row.raw.linkedin_url ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="LinkedIn" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        if (!r.raw.linkedin_url || r.raw.linkedin_url.toLowerCase() === 'no encontrado') {
          return <span className="text-muted-foreground italic">No encontrado</span>;
        }
        const display = r.raw.linkedin_url.replace(/^(https?:\/\/)?(www\.)?linkedin\.com\//, '');
        const href = r.raw.linkedin_url.startsWith('http') ? r.raw.linkedin_url : `https://${r.raw.linkedin_url}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-32 font-medium"
            title={r.raw.linkedin_url}
            onClick={(e) => e.stopPropagation()}
          >
            {display}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      },
      size: 150,
      meta: { label: 'LinkedIn', popoverTitle: 'LinkedIn', disableFilter: true },
    },
    {
      id: 'confidence',
      accessorFn: (row) => row.raw.confidence ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Confianza" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        if (!r.raw.confidence) return <span className="text-muted-foreground italic">—</span>;
        return (
          <Badge
            variant={
              r.raw.confidence.toLowerCase() === 'alta'
                ? 'positive'
                : r.raw.confidence.toLowerCase() === 'media'
                  ? 'warning'
                  : r.raw.confidence.toLowerCase() === 'baja'
                    ? 'negative'
                    : 'neutral'
            }
          >
            {r.raw.confidence}
          </Badge>
        );
      },
      size: 100,
      filterFn: 'arrIncludesSome',
      meta: {
        label: 'Confianza',
        popoverTitle: 'Confianza',
        filterOptions: [
          { value: 'Alta', label: 'Alta' },
          { value: 'Media', label: 'Media' },
          { value: 'Baja', label: 'Baja' },
        ],
      },
    },
    {
      id: 'import_status',
      accessorFn: (row) => row.status,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Estado" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        const dup = duplicateMap.get(r.index);
        return (
          <div className="flex flex-col gap-1 items-start">
            {r.status === 'error' && (
              <Badge variant="negative">
                <XCircle />
                Error
              </Badge>
            )}
            {r.status === 'warning' && (
              <Badge variant="warning" className="h-auto whitespace-normal py-0.5">
                <AlertTriangle />
                Importable con advertencias
              </Badge>
            )}
            {r.status === 'valid' && (
              <Badge variant="positive">
                <CheckCircle2 />
                Importable
              </Badge>
            )}
            {dup && dup.duplicate_status !== 'no_match' && (
              <DuplicateBadge status={dup.duplicate_status} />
            )}
          </div>
        );
      },
      size: 170,
      filterFn: 'arrIncludesSome',
      meta: {
        label: 'Estado',
        popoverTitle: 'Estado',
        filterOptions: [
          { value: 'valid', label: 'Importable' },
          { value: 'warning', label: 'Con advertencias' },
          { value: 'error', label: 'Con errores' },
        ],
      },
    },
    {
      id: 'notes',
      accessorFn: (row) => row.errors.concat(row.warnings).join(' ') + (row.raw.notes ?? ''),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Notas / advertencias" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="space-y-1 text-xs leading-relaxed max-w-75">
            {r.errors.map((e) => (
              <div key={e} className="flex items-start gap-1 text-destructive font-medium">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive" />
                <span>{e}</span>
              </div>
            ))}
            {r.warnings.map((w) => (
              <div key={w} className="flex items-start gap-1 text-warning">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                <span className="truncate max-w-60" title={w}>{w}</span>
              </div>
            ))}
            {r.raw.notes && (
              <div className="text-muted-foreground truncate max-w-64" title={r.raw.notes}>
                <span className="font-semibold">Notas:</span> {r.raw.notes}
              </div>
            )}
          </div>
        );
      },
      size: 220,
      minSize: 200,
      enableColumnFilter: false,
      meta: { label: 'Notas', popoverTitle: 'Notas / advertencias', disableFilter: true },
    },
  ], [duplicateMap]);

  const allColumns = React.useMemo<ColumnDef<ImportRow, unknown>[]>(() => {
    const selectCol: ColumnDef<ImportRow, unknown> = {
      id: 'select',
      // Thema: menú «esta página / todos» en la cabecera de selección.
      header: ({ table }) => <DataTableSelectionHeader table={table} paged />,
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          disabled={row.original.status === 'error'}
          aria-label="Seleccionar fila"
          
        />
      ),
      size: 40,
      enableSorting: false,
      enableHiding: false,
      enableColumnFilter: false,
    };
    return [selectCol, ...columns];
  }, [columns]);

  const table = useReactTable({
    data: rows,
    columns: allColumns,
    defaultColumn: { filterFn: multiValueFilter as FilterFn<ImportRow> },
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: handleRowSelectionChange,
    enableRowSelection: true,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SurfaceCard noPadding className="flex h-full min-h-0 flex-col overflow-hidden">
        <DataTableActiveFilters table={table} globalFilter="" onGlobalFilterChange={() => {}} />
        <div className="flex-1 min-h-0 overflow-auto su-table-scroll">
          <Table className="su-table su-table-sticky">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-border/60 hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={{ width: header.column.columnDef.size }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className={cn(
                      'border-border/50 last:border-0',
                      row.original.status === 'error' && 'opacity-50',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} style={{ width: cell.column.columnDef.size }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={allColumns.length} className="h-32 text-center text-sm text-muted-foreground">
                    Sin resultados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <DataTablePagination table={table} pageSizeOptions={[10, 25, 50, 100]} noun="filas" />
      </SurfaceCard>
    </div>
  );
}
