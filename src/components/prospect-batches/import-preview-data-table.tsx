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
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  DataTableColumnHeader,
  DataTablePagination,
} from '@/components/data-table';
import type { ImportRow, ImportDuplicateResult } from './import-candidates-drawer';

// ── Helpers ────────────────────────────────────────────────────

function DuplicateBadge({ status }: { status?: ImportDuplicateResult['duplicate_status'] }) {
  if (!status || status === 'no_match') return null;
  if (status === 'exact_duplicate') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">
        <GitMerge className="h-2.5 w-2.5" />
        Duplicado exacto
      </span>
    );
  }
  if (status === 'possible_duplicate') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        <GitMerge className="h-2.5 w-2.5" />
        Posible duplicado
      </span>
    );
  }
  return null;
}

function DefaultBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-su-brand-soft px-2 py-0.5 text-[10px] font-medium text-su-brand">
      {label}
    </span>
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
        <span className="tabular-nums text-muted-foreground text-center block">
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
          <div className="flex flex-col gap-0.5 min-w-0 max-w-[200px]">
            <p className="font-semibold text-foreground truncate" title={r.raw.company_name}>
              {r.raw.company_name || <span className="text-muted-foreground/60 italic">Sin nombre</span>}
            </p>
            {r.raw.description && (
              <p className="text-[10px] text-muted-foreground/80 truncate" title={r.raw.description}>
                {r.raw.description}
              </p>
            )}
          </div>
        );
      },
      size: 200,
      minSize: 180,
      meta: { label: 'Empresa', popoverTitle: 'Empresa' },
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
                <span className="text-muted-foreground/60 italic">—</span>
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
            <p className="text-foreground truncate max-w-[120px]" title={r.raw.industry}>
              {r.raw.industry ?? <span className="text-muted-foreground/60 italic">—</span>}
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
        if (!r.raw.website) return <span className="text-muted-foreground/60 italic">—</span>;
        const display = r.raw.website.replace(/^(https?:\/\/)?(www\.)?/, '');
        const href = r.raw.website.startsWith('http') ? r.raw.website : `https://${r.raw.website}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-su-brand hover:underline truncate max-w-[130px] font-medium"
            title={r.raw.website}
            onClick={(e) => e.stopPropagation()}
          >
            {display}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      },
      size: 150,
      meta: { label: 'Website', popoverTitle: 'Website' },
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
          return <span className="text-muted-foreground/60 italic">No encontrado</span>;
        }
        const display = r.raw.linkedin_url.replace(/^(https?:\/\/)?(www\.)?linkedin\.com\//, '');
        const href = r.raw.linkedin_url.startsWith('http') ? r.raw.linkedin_url : `https://${r.raw.linkedin_url}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-su-brand hover:underline truncate max-w-[130px] font-medium"
            title={r.raw.linkedin_url}
            onClick={(e) => e.stopPropagation()}
          >
            {display}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      },
      size: 150,
      meta: { label: 'LinkedIn', popoverTitle: 'LinkedIn' },
    },
    {
      id: 'confidence',
      accessorFn: (row) => row.raw.confidence ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Confianza" />
      ),
      cell: ({ row }) => {
        const r = row.original;
        if (!r.raw.confidence) return <span className="text-muted-foreground/60 italic">—</span>;
        return (
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
            r.raw.confidence.toLowerCase() === 'alta' && "bg-emerald-500/10 text-emerald-500",
            r.raw.confidence.toLowerCase() === 'media' && "bg-amber-500/10 text-amber-500",
            r.raw.confidence.toLowerCase() === 'baja' && "bg-destructive/10 text-destructive",
            !['alta', 'media', 'baja'].includes(r.raw.confidence.toLowerCase()) && "bg-muted text-muted-foreground",
          )}>
            {r.raw.confidence}
          </span>
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
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                <XCircle className="h-2.5 w-2.5" />
                Error
              </span>
            )}
            {r.status === 'warning' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-2.5 w-2.5" />
                Importable con advertencias
              </span>
            )}
            {r.status === 'valid' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Importable
              </span>
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
          <div className="space-y-1 text-[11px] leading-relaxed max-w-[300px]">
            {r.errors.map((e) => (
              <div key={e} className="flex items-start gap-1 text-destructive font-medium">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive" />
                <span>{e}</span>
              </div>
            ))}
            {r.warnings.map((w) => (
              <div key={w} className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span className="truncate max-w-[240px]" title={w}>{w}</span>
              </div>
            ))}
            {r.raw.notes && (
              <div className="text-muted-foreground/80 truncate max-w-[260px]" title={r.raw.notes}>
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
          disabled={row.original.status === 'error'}
          aria-label="Seleccionar fila"
          className="translate-y-[1px]"
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm">
        <div className="flex-1 min-h-0 overflow-auto su-table-scroll">
          <Table className="su-table su-table-sticky">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent border-border/40">
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
                      'border-border/20 last:border-0',
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

        <DataTablePagination table={table} pageSizeOptions={[10, 25, 50, 100]} />
      </div>
    </div>
  );
}
