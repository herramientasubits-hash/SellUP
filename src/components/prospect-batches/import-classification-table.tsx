'use client';

// ── Import Classification Review Table — Hito 16AB.40.2 ───────────────────────
// Shows classified rows with status badges, correction actions, and row selection.
// Filter tabs have been removed from this component — the parent renders them.

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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type {
  ImportClassificationPreviewRow,
  ClassificationFilterStatus,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { CLASSIFICATION_STATUS_MAP } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Props ─────────────────────────────────────────────────────────────────────

type ImportClassificationTableProps = {
  rows: ImportClassificationPreviewRow[];
  onCorrectRow: (row: ImportClassificationPreviewRow) => void;
  filterStatus: ClassificationFilterStatus;
  selectedRowIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
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
  selectedRowIds,
  onSelectionChange,
}: ImportClassificationTableProps) {
  const filteredRows = React.useMemo(() => {
    if (filterStatus === 'all') return rows;
    return rows.filter((r) => r.validationStatus === filterStatus);
  }, [rows, filterStatus]);

  const visibleRowNums = React.useMemo(
    () => filteredRows.map((r) => r.rowNumber),
    [filteredRows],
  );

  const allVisibleSelected =
    visibleRowNums.length > 0 && visibleRowNums.every((n) => selectedRowIds.has(n));
  const someVisibleSelected = visibleRowNums.some((n) => selectedRowIds.has(n));
  const headerCheckState: boolean | 'indeterminate' = allVisibleSelected
    ? true
    : someVisibleSelected
      ? 'indeterminate'
      : false;

  const columns = React.useMemo<ColumnDef<ImportClassificationPreviewRow>[]>(
    () => [
      {
        id: 'select',
        header: () => null, // rendered manually below for checkbox state access
        cell: ({ row }) => (
          <Checkbox
            checked={selectedRowIds.has(row.original.rowNumber)}
            onCheckedChange={(v) => {
              const next = new Set(selectedRowIds);
              if (v) next.add(row.original.rowNumber);
              else next.delete(row.original.rowNumber);
              onSelectionChange(next);
            }}
            aria-label={`Seleccionar fila ${row.original.rowNumber}`}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 40,
      },
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
    [onCorrectRow, selectedRowIds, onSelectionChange],
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  function handleHeaderCheckChange(v: boolean | 'indeterminate') {
    const next = new Set(selectedRowIds);
    if (v) visibleRowNums.forEach((n) => next.add(n));
    else visibleRowNums.forEach((n) => next.delete(n));
    onSelectionChange(next);
  }

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border/30 bg-muted/30">
                {headerGroup.headers.map((header, idx) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap"
                  >
                    {idx === 0 ? (
                      <Checkbox
                        checked={headerCheckState}
                        onCheckedChange={handleHeaderCheckChange}
                        aria-label="Seleccionar todas las filas visibles"
                      />
                    ) : header.isPlaceholder ? null : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
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
              table.getRowModel().rows.map((row) => {
                const isSelected = selectedRowIds.has(row.original.rowNumber);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-su-brand-soft/30 hover:bg-su-brand-soft/50'
                        : 'hover:bg-muted/20',
                      !isSelected && 'opacity-60',
                      row.original.requiresHumanReview && isSelected && 'bg-destructive/5 hover:bg-destructive/10',
                    )}
                    onClick={() => {
                      const next = new Set(selectedRowIds);
                      if (isSelected) next.delete(row.original.rowNumber);
                      else next.add(row.original.rowNumber);
                      onSelectionChange(next);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/20 text-[10px] text-muted-foreground">
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
