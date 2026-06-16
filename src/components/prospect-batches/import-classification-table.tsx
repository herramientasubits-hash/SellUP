'use client';

// ── Import Classification Review Table — Hito 16AB.40.3 ───────────────────────
// Shows classified rows with status badges, inline correction, and row selection.
// Filter tabs are rendered in the parent. Inline editing: clicking Corregir
// activates in-row selects. No side panel. Only one row editable at a time.

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
  Users,
  Check,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  ImportClassificationPreviewRow,
  ClassificationFilterStatus,
  ManualClassificationCorrection,
  CatalogVersionState,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { CLASSIFICATION_STATUS_MAP } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Local catalog types ────────────────────────────────────────────────────────

type CatalogSubindustry = {
  id: string;
  name: string;
  slug: string;
  countries?: string[];
};

type CatalogIndustry = {
  id: string;
  name: string;
  slug: string;
  subindustries: CatalogSubindustry[];
};

// ── Props ─────────────────────────────────────────────────────────────────────

export type ImportClassificationTableProps = {
  rows: ImportClassificationPreviewRow[];
  filterStatus: ClassificationFilterStatus;
  selectedRowIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  catalog?: { industries: CatalogIndustry[] };
  catalogVersion?: CatalogVersionState;
  onSaveCorrection?: (
    correction: ManualClassificationCorrection,
    row: ImportClassificationPreviewRow,
  ) => Promise<void>;
  onBulkCorrection?: (
    rows: ImportClassificationPreviewRow[],
    industryId: string,
    subindustryId: string | null,
  ) => Promise<void>;
};

// ── StatusBadge ───────────────────────────────────────────────────────────────

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
    <Badge variant={variantMap[config.variant] ?? 'secondary'} className="gap-1 text-[10px] font-medium whitespace-nowrap">
      {iconMap[status]}
      {config.label}
    </Badge>
  );
}

// ── ClassificationCell ────────────────────────────────────────────────────────

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
  const isDifferent =
    canonicalName &&
    originalValue &&
    canonicalName.toLowerCase() !== originalValue.toLowerCase();
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-foreground">{canonicalName ?? originalValue ?? '—'}</p>
      {isDifferent && (
        <p className="text-[10px] text-muted-foreground">
          Original: <span className="italic">{originalValue}</span>
        </p>
      )}
      {(matchStatus === 'alias_match' || matchStatus === 'normalized_match') && isDifferent && (
        <p className="text-[10px] text-su-brand">Normalizado automáticamente</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportClassificationTable({
  rows,
  filterStatus,
  selectedRowIds,
  onSelectionChange,
  catalog,
  catalogVersion,
  onSaveCorrection,
  onBulkCorrection,
}: ImportClassificationTableProps) {

  // ── Inline edit state ────────────────────────────────────────────────────────
  const [editingRowNumber, setEditingRowNumber] = React.useState<number | null>(null);
  const [editIndustryId, setEditIndustryId] = React.useState('');
  const [editSubindustryId, setEditSubindustryId] = React.useState('');
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editApplyToEquivalent, setEditApplyToEquivalent] = React.useState(false);

  // ── Escape cancels editing ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (editingRowNumber === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !editSaving) {
        setEditingRowNumber(null);
        setEditError(null);
        setEditApplyToEquivalent(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingRowNumber, editSaving]);

  // ── Equivalent rows for bulk apply ──────────────────────────────────────────
  const equivalentRows = React.useMemo(() => {
    if (editingRowNumber === null) return [];
    const editing = rows.find((r) => r.rowNumber === editingRowNumber);
    if (!editing) return [];
    return rows.filter(
      (r) =>
        r.rowNumber !== editingRowNumber &&
        (r.industryOriginalValue ?? '').toLowerCase().trim() ===
          (editing.industryOriginalValue ?? '').toLowerCase().trim() &&
        (r.subindustryOriginalValue ?? '').toLowerCase().trim() ===
          (editing.subindustryOriginalValue ?? '').toLowerCase().trim() &&
        (r.countryCode ?? '').toUpperCase() === (editing.countryCode ?? '').toUpperCase(),
    );
  }, [editingRowNumber, rows]);

  // ── Catalog selectors for edit mode ─────────────────────────────────────────
  const industryOptions = React.useMemo(
    () => catalog?.industries.map((i) => ({ value: i.id, label: i.name })) ?? [],
    [catalog],
  );

  const subindustryOptions = React.useMemo(() => {
    if (!catalog || !editIndustryId || editingRowNumber === null) return [];
    const editingRow = rows.find((r) => r.rowNumber === editingRowNumber);
    const industry = catalog.industries.find((i) => i.id === editIndustryId);
    if (!industry) return [];
    const filtered = industry.subindustries.filter((s) =>
      !s.countries || s.countries.length === 0 || (editingRow?.countryCode ? s.countries.includes(editingRow.countryCode) : true),
    );
    return [
      { value: '__none__', label: 'Sin subindustria' },
      ...filtered.map((s) => ({ value: s.id, label: s.name })),
    ];
  }, [catalog, editIndustryId, editingRowNumber, rows]);

  // ── Start / cancel editing ───────────────────────────────────────────────────
  function startEditing(row: ImportClassificationPreviewRow) {
    setEditingRowNumber(row.rowNumber);
    setEditIndustryId(row.industryCanonicalId ?? '');
    setEditSubindustryId(row.subindustryCanonicalId ?? '');
    setEditError(null);
    setEditSaving(false);
    setEditApplyToEquivalent(false);
  }

  function cancelEditing() {
    setEditingRowNumber(null);
    setEditError(null);
    setEditApplyToEquivalent(false);
  }

  // ── Save correction ──────────────────────────────────────────────────────────
  const handleSaveEdit = React.useCallback(async () => {
    if (!editIndustryId || !catalogVersion || !onSaveCorrection || editingRowNumber === null) return;
    const editingRow = rows.find((r) => r.rowNumber === editingRowNumber);
    if (!editingRow) return;

    setEditSaving(true);
    setEditError(null);
    try {
      const resolvedSubindustryId =
        editSubindustryId === '__none__' ? null : editSubindustryId || null;

      const correction: ManualClassificationCorrection = {
        rowNumber: editingRowNumber,
        industryId: editIndustryId,
        subindustryId: resolvedSubindustryId,
        catalogVersion: catalogVersion.version,
      };
      await onSaveCorrection(correction, editingRow);

      if (editApplyToEquivalent && equivalentRows.length > 0 && onBulkCorrection) {
        await onBulkCorrection(equivalentRows, editIndustryId, resolvedSubindustryId);
      }

      setEditingRowNumber(null);
      setEditError(null);
      setEditApplyToEquivalent(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setEditSaving(false);
    }
  }, [
    editIndustryId, editSubindustryId, catalogVersion, onSaveCorrection,
    editingRowNumber, rows, editApplyToEquivalent, equivalentRows, onBulkCorrection,
  ]);

  // ── Filtered rows + selection state ─────────────────────────────────────────
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

  // ── Column definitions ───────────────────────────────────────────────────────
  const columns = React.useMemo<ColumnDef<ImportClassificationPreviewRow>[]>(
    () => [
      {
        id: 'select',
        header: () => null,
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
        cell: ({ row }) => {
          const isEditing = editingRowNumber === row.original.rowNumber && !!catalog;
          if (isEditing) {
            return (
              <div className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                <label className="sr-only" htmlFor={`edit-industry-${row.original.rowNumber}`}>
                  Industria
                </label>
                <Select
                  value={editIndustryId}
                  onValueChange={(v) => {
                    setEditIndustryId(v ?? '');
                    setEditSubindustryId('');
                  }}
                >
                  <SelectTrigger
                    id={`edit-industry-${row.original.rowNumber}`}
                    className="h-8 text-xs"
                    autoFocus
                  >
                    <SelectValue placeholder="Seleccionar industria" />
                  </SelectTrigger>
                  <SelectContent>
                    {industryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          return (
            <ClassificationCell
              canonicalName={row.original.industryCanonicalName}
              originalValue={row.original.industryOriginalValue}
              matchStatus={row.original.industryMatchStatus}
            />
          );
        },
      },
      {
        accessorKey: 'subindustryCanonicalName',
        header: 'Subindustria',
        cell: ({ row }) => {
          const isEditing = editingRowNumber === row.original.rowNumber && !!catalog;
          if (isEditing) {
            return (
              <div className="min-w-[160px] space-y-1.5" onClick={(e) => e.stopPropagation()}>
                <label className="sr-only" htmlFor={`edit-subindustry-${row.original.rowNumber}`}>
                  Subindustria
                </label>
                <Select
                  value={editSubindustryId}
                  onValueChange={(v) => setEditSubindustryId(v ?? '')}
                  disabled={!editIndustryId}
                >
                  <SelectTrigger
                    id={`edit-subindustry-${row.original.rowNumber}`}
                    className="h-8 text-xs"
                    disabled={!editIndustryId}
                  >
                    <SelectValue
                      placeholder={
                        editIndustryId ? 'Seleccionar subindustria' : 'Elige industria primero'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {subindustryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {equivalentRows.length > 0 && (
                  <label
                    className="flex items-center gap-1.5 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={editApplyToEquivalent}
                      onCheckedChange={(v) => setEditApplyToEquivalent(!!v)}
                      className="h-3.5 w-3.5 shrink-0"
                      aria-label={`Aplicar también a ${equivalentRows.length} filas equivalentes`}
                    />
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3 shrink-0" />
                      También {equivalentRows.length} equivalente{equivalentRows.length !== 1 ? 's' : ''}
                    </span>
                  </label>
                )}
              </div>
            );
          }
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
        cell: ({ row }) => {
          const isEditing = editingRowNumber === row.original.rowNumber;
          if (isEditing && editError) {
            return (
              <div className="flex items-start gap-1 max-w-[120px]" onClick={(e) => e.stopPropagation()}>
                <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                <span className="text-[10px] text-destructive leading-tight">{editError}</span>
              </div>
            );
          }
          return <StatusBadge status={row.original.validationStatus} />;
        },
      },
      {
        id: 'actions',
        header: 'Acciones',
        cell: ({ row }) => {
          const isEditing = editingRowNumber === row.original.rowNumber;
          if (isEditing) {
            return (
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={editSaving || !editIndustryId}
                  className="h-7 gap-1 text-[10px] bg-su-brand text-white hover:bg-su-brand/90"
                  aria-label="Guardar corrección"
                >
                  {editSaving ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                      Guardando
                    </>
                  ) : (
                    <>
                      <Check className="h-3 w-3" />
                      Guardar
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelEditing}
                  disabled={editSaving}
                  className="h-7 gap-1 text-[10px]"
                  aria-label="Cancelar corrección"
                >
                  <X className="h-3 w-3" />
                  Cancelar
                </Button>
              </div>
            );
          }
          if (!catalog) return null;
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                startEditing(row.original);
              }}
              className="h-7 gap-1 text-[10px] text-su-brand hover:text-su-brand"
              aria-label={`Corregir clasificación de ${row.original.companyName}`}
            >
              <Pencil className="h-3 w-3" />
              Corregir
            </Button>
          );
        },
        size: 140,
      },
    ],
    [
      selectedRowIds, onSelectionChange,
      editingRowNumber, editIndustryId, editSubindustryId,
      editSaving, editError, editApplyToEquivalent,
      catalog, industryOptions, subindustryOptions, equivalentRows,
      handleSaveEdit,
    ],
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
                const isEditing = editingRowNumber === row.original.rowNumber;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors',
                      isEditing && 'bg-su-brand-soft/20 ring-1 ring-inset ring-su-brand/30',
                      !isEditing && isSelected && 'bg-su-brand-soft/30 hover:bg-su-brand-soft/50 cursor-pointer',
                      !isEditing && !isSelected && 'hover:bg-muted/20 opacity-60 cursor-pointer',
                      !isEditing && row.original.requiresHumanReview && isSelected && 'bg-destructive/5 hover:bg-destructive/10',
                    )}
                    onClick={() => {
                      if (isEditing) return;
                      const next = new Set(selectedRowIds);
                      if (isSelected) next.delete(row.original.rowNumber);
                      else next.add(row.original.rowNumber);
                      onSelectionChange(next);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5 align-top">
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
