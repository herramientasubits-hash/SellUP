'use client';

// ── Import Classification Review Table — Hito 16AB.40 ─────────────────────────
// Shows classified rows with status badges and correction actions.

import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Pencil,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  ImportClassificationPreviewRow,
  ClassificationFilterStatus,
  ClassificationSummaryStats,
  CLASSIFICATION_STATUS_MAP as _STATUS_MAP,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { CLASSIFICATION_STATUS_MAP } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Props ─────────────────────────────────────────────────────────────────────

type ImportClassificationTableProps = {
  rows: ImportClassificationPreviewRow[];
  onCorrectRow: (row: ImportClassificationPreviewRow) => void;
  filterStatus: ClassificationFilterStatus;
  onFilterChange: (status: ClassificationFilterStatus) => void;
  summary: ClassificationSummaryStats;
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ImportClassificationPreviewRow['validationStatus'] }) {
  const config = CLASSIFICATION_STATUS_MAP[status];
  const variantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    success: 'secondary',
    warning: 'default',
    destructive: 'destructive',
    default: 'default',
    secondary: 'secondary',
    outline: 'outline',
  };

  const iconMap: Record<string, React.ReactNode> = {
    valid: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
    normalized: <CheckCircle2 className="h-3 w-3 text-su-brand" />,
    warning: <AlertTriangle className="h-3 w-3 text-amber-500" />,
    requires_review: <Pencil className="h-3 w-3 text-destructive" />,
    invalid: <XCircle className="h-3 w-3 text-destructive" />,
  };

  return (
    <Badge
      variant={variantMap[config.variant] ?? 'secondary'}
      className="gap-1 text-[10px] font-medium"
    >
      {iconMap[status]}
      {config.label}
    </Badge>
  );
}

// ── Classification cell ───────────────────────────────────────────────────────

function ClassificationCell({
  canonicalName,
  originalValue,
  matchStatus,
}: {
  canonicalName: string | null;
  originalValue: string | null;
  matchStatus: string;
}) {
  if (!canonicalName && !originalValue) {
    return <span className="text-xs text-muted-foreground italic">Sin valor</span>;
  }

  const isDifferent = canonicalName && originalValue && canonicalName.toLowerCase() !== originalValue.toLowerCase();
  const isNormalized = matchStatus === 'alias_match' || matchStatus === 'normalized_match';

  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-foreground">
        {canonicalName ?? originalValue ?? '—'}
      </p>
      {isDifferent && (
        <p className="text-[10px] text-muted-foreground">
          Original: <span className="italic">{originalValue}</span>
        </p>
      )}
      {isNormalized && isDifferent && (
        <p className="text-[10px] text-su-brand">Normalizado automáticamente</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportClassificationTable({
  rows,
  onCorrectRow,
  filterStatus,
  onFilterChange,
  summary,
}: ImportClassificationTableProps) {
  const [globalFilter, setGlobalFilter] = React.useState('');

  const filteredRows = React.useMemo(() => {
    if (filterStatus === 'all') return rows;
    return rows.filter((r) => r.validationStatus === filterStatus);
  }, [rows, filterStatus]);

  const columns = React.useMemo<ColumnDef<ImportClassificationPreviewRow>[]>(
    () => [
      {
        accessorKey: 'rowNumber',
        header: '#',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">{row.original.rowNumber}</span>
        ),
        size: 40,
      },
      {
        accessorKey: 'companyName',
        header: 'Empresa',
        cell: ({ row }) => (
          <span className="text-xs font-medium text-foreground truncate block max-w-[180px]">
            {row.original.companyName}
          </span>
        ),
      },
      {
        accessorKey: 'industryCanonicalName',
        header: 'Industria',
        cell: ({ row }) => (
          <ClassificationCell
            canonicalName={row.original.industryCanonicalName}
            originalValue={row.original.industryOriginalValue}
            matchStatus={row.original.industryMatchStatus}
          />
        ),
      },
      {
        accessorKey: 'subindustryCanonicalName',
        header: 'Subindustria',
        cell: ({ row }) => {
          const r = row.original;
          if (!r.subindustryCanonicalName && !r.subindustryOriginalValue) {
            return <span className="text-xs text-muted-foreground italic">Sin subindustria</span>;
          }
          return (
            <ClassificationCell
              canonicalName={r.subindustryCanonicalName}
              originalValue={r.subindustryOriginalValue}
              matchStatus={r.subindustryMatchStatus}
            />
          );
        },
      },
      {
        accessorKey: 'validationStatus',
        header: 'Estado',
        cell: ({ row }) => <StatusBadge status={row.original.validationStatus} />,
      },
      {
        id: 'actions',
        header: 'Acciones',
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onCorrectRow(row.original)}
            className="h-7 gap-1 text-[10px] text-su-brand hover:text-su-brand"
            aria-label={`Corregir clasificación de ${row.original.companyName}`}
          >
            <Pencil className="h-3 w-3" />
            Corregir
          </Button>
        ),
        size: 80,
      },
    ],
    [onCorrectRow],
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
  });

  const filterOptions: Array<{ value: ClassificationFilterStatus; label: string; count: number }> = [
    { value: 'all', label: 'Todas', count: summary.total },
    { value: 'valid', label: 'Listas', count: summary.valid },
    { value: 'normalized', label: 'Normalizadas', count: summary.normalized },
    { value: 'warning', label: 'Con advertencias', count: summary.warning },
    { value: 'requires_review', label: 'Requieren revisión', count: summary.requiresReview },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter className="h-3 w-3 text-muted-foreground" />
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onFilterChange(opt.value)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors',
              filterStatus === opt.value
                ? 'bg-su-brand text-white'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {opt.label}
            <span className="ml-1 tabular-nums">({opt.count})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border/40">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border/30 bg-muted/30">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border/20">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  No hay filas que coincidan con el filtro.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'hover:bg-muted/20 transition-colors',
                    row.original.requiresHumanReview && 'bg-destructive/5',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="h-6 w-6 p-0"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="h-6 w-6 p-0"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
