'use client';

// ── Import Classification Review Table — Hito 16AB.40.4 ───────────────────────
// Unified preview + classification table.
// Columns: checkbox, #, Empresa, País, Sitio web, LinkedIn, Ciudad, Tamaño,
//          Industria (editable), Subindustria (editable), Estado, Acciones.
// Actions: Ver detalles (expandable row), Corregir (inline edit).
// No side panel. Only one row editable at a time. Only one detail row open at a time.

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
  Pencil,
  ChevronLeft,
  ChevronRight,
  Users,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from "@/icons";
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldLabel } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { cn } from '@/lib/utils';
import type {
  ImportClassificationPreviewRow,
  ClassificationFilterStatus,
  ManualClassificationCorrection,
  CatalogVersionState,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';

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
  /**
   * AGENT1-IMPORT-NO-SUBINDUSTRY-1 — `false` cuando el catálogo no publica
   * subindustrias: se ocultan la columna, su edición y su detalle.
   */
  showSubindustry?: boolean;
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

import {
  ClassificationCell,
  ExpandedDetailRow,
  StatusBadge,
  countryLabel,
  extractDomain,
} from './import-classification-row-detail';

// ── Main component ────────────────────────────────────────────────────────────

export function ImportClassificationTable({
  rows,
  filterStatus,
  selectedRowIds,
  onSelectionChange,
  catalog,
  catalogVersion,
  showSubindustry = true,
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

  // ── Expanded detail state — only one at a time ───────────────────────────────
  const [expandedRowNumber, setExpandedRowNumber] = React.useState<number | null>(null);

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
    // Collapse detail row when editing starts to avoid visual overlap
    setExpandedRowNumber(null);
  }

  function cancelEditing() {
    setEditingRowNumber(null);
    setEditError(null);
    setEditApplyToEquivalent(false);
  }

  function toggleDetail(rowNumber: number) {
    setExpandedRowNumber((prev) => (prev === rowNumber ? null : rowNumber));
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
          <span className="text-xs font-medium text-foreground block max-w-40 truncate" title={row.original.companyName}>
            {row.original.companyName}
          </span>
        ),
      },
      {
        id: 'country',
        header: 'País',
        cell: ({ row }) => (
          <span className="text-xs text-foreground whitespace-nowrap">
            {countryLabel(row.original.countryCode)}
          </span>
        ),
        size: 90,
      },
      {
        id: 'website',
        header: 'Sitio web',
        cell: ({ row }) => {
          const domain = extractDomain(row.original.website);
          if (!domain || !row.original.website) return <span className="text-xs text-muted-foreground">—</span>;
          const href = row.original.website.startsWith('http') ? row.original.website : `https://${row.original.website}`;
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-30 items-center gap-1 truncate rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              title={domain}
              onClick={(e) => e.stopPropagation()}
            >
              {domain}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          );
        },
        size: 130,
      },
      {
        id: 'linkedin',
        header: 'LinkedIn',
        cell: ({ row }) => {
          const domain = extractDomain(row.original.linkedinUrl);
          if (!domain || !row.original.linkedinUrl) return <span className="text-xs text-muted-foreground">—</span>;
          const href = row.original.linkedinUrl.startsWith('http') ? row.original.linkedinUrl : `https://${row.original.linkedinUrl}`;
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-30 items-center gap-1 truncate rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              title={row.original.linkedinUrl}
              onClick={(e) => e.stopPropagation()}
            >
              {domain.replace('linkedin.com/', 'li/')}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          );
        },
        size: 130,
      },
      {
        id: 'city',
        header: 'Ciudad',
        cell: ({ row }) => (
          <span className="text-xs text-foreground whitespace-nowrap">
            {row.original.city ?? '—'}
          </span>
        ),
        size: 90,
      },
      {
        id: 'companySize',
        header: 'Tamaño',
        cell: ({ row }) => (
          <span className="text-xs text-foreground whitespace-nowrap">
            {row.original.companySize ?? '—'}
          </span>
        ),
        size: 90,
      },
      {
        accessorKey: 'industryCanonicalName',
        header: 'Industria',
        cell: ({ row }) => {
          const isEditing = editingRowNumber === row.original.rowNumber && !!catalog;
          if (isEditing) {
            return (
              <div
                role="group"
                aria-label="Industria"
                className="min-w-40"
                onClick={(e) => e.stopPropagation()}
              >
                <SearchableSelect
                  options={industryOptions}
                  value={editIndustryId}
                  onValueChange={(value) => {
                    setEditIndustryId(value);
                    setEditSubindustryId('');
                  }}
                  placeholder="Seleccionar industria"
                  searchPlaceholder="Buscar industria…"
                  emptyMessage="No se encontraron industrias."
                  compact
                  className="h-8 px-2 text-xs"
                />
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
              <div className="min-w-40 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                <div role="group" aria-label="Subindustria">
                  <SearchableSelect
                    options={subindustryOptions}
                    value={editSubindustryId}
                    onValueChange={setEditSubindustryId}
                    placeholder={editIndustryId ? 'Seleccionar subindustria' : 'Elige industria primero'}
                    searchPlaceholder="Buscar subindustria…"
                    emptyMessage="No se encontraron subindustrias."
                    disabled={!editIndustryId}
                    compact
                    className="h-8 px-2 text-xs"
                  />
                </div>
                {equivalentRows.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`edit-equivalent-${row.original.rowNumber}`}
                      checked={editApplyToEquivalent}
                      onCheckedChange={(v) => setEditApplyToEquivalent(!!v)}
                      className="h-3.5 w-3.5 shrink-0"
                      aria-label={`Aplicar también a ${equivalentRows.length} filas equivalentes`}
                    />
                    <FieldLabel
                      htmlFor={`edit-equivalent-${row.original.rowNumber}`}
                      className="flex cursor-pointer items-center gap-1 text-xs font-normal text-muted-foreground"
                    >
                      <Users className="h-3 w-3 shrink-0" />
                      También {equivalentRows.length} equivalente{equivalentRows.length !== 1 ? 's' : ''}
                    </FieldLabel>
                  </div>
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
              <div className="flex items-start gap-1 max-w-30" onClick={(e) => e.stopPropagation()}>
                <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                <span className="text-xs text-destructive leading-tight">{editError}</span>
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
          const isExpanded = expandedRowNumber === row.original.rowNumber;

          if (isEditing) {
            return (
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  type="button"
                  size="xs"
                  onClick={handleSaveEdit}
                  disabled={editSaving || !editIndustryId}
                  aria-label="Guardar corrección"
                >
                  {editSaving ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
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
                  size="xs"
                  onClick={cancelEditing}
                  disabled={editSaving}
                  aria-label="Cancelar corrección"
                >
                  <X className="h-3 w-3" />
                  Cancelar
                </Button>
              </div>
            );
          }

          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => toggleDetail(row.original.rowNumber)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={isExpanded ? `Cerrar detalles de ${row.original.companyName}` : `Ver detalles de ${row.original.companyName}`}
                aria-expanded={isExpanded}
              >
                {isExpanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {isExpanded ? 'Cerrar' : 'Ver detalles'}
              </Button>
              {catalog && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => startEditing(row.original)}
                  className="text-primary hover:text-primary"
                  aria-label={`Corregir clasificación de ${row.original.companyName}`}
                >
                  <Pencil className="h-3 w-3" />
                  Corregir
                </Button>
              )}
            </div>
          );
        },
        size: 200,
      },
    ],
    [
      selectedRowIds, onSelectionChange,
      editingRowNumber, editIndustryId, editSubindustryId,
      editSaving, editError, editApplyToEquivalent,
      catalog, industryOptions, subindustryOptions, equivalentRows,
      expandedRowNumber,
      handleSaveEdit,
    ],
  );

  // AGENT1-IMPORT-NO-SUBINDUSTRY-1 — sin subindustrias en el catálogo, sin columna.
  const visibleColumns = React.useMemo(
    () =>
      showSubindustry
        ? columns
        : columns.filter(
            (c) => (c as { accessorKey?: string }).accessorKey !== 'subindustryCanonicalName',
          ),
    [columns, showSubindustry],
  );

  const table = useReactTable({
    data: filteredRows,
    columns: visibleColumns,
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
        <Table className="text-xs">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, idx) => (
                  <TableHead key={header.id}>
                    {idx === 0 ? (
                      <Checkbox
                        checked={headerCheckState}
                        onCheckedChange={handleHeaderCheckChange}
                        aria-label="Seleccionar todas las filas visibles"
                      />
                    ) : header.isPlaceholder ? null : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumns.length}>
                  <EmptyState variant="plain" title="No hay filas que coincidan con el filtro." />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isSelected = selectedRowIds.has(row.original.rowNumber);
                const isEditing = editingRowNumber === row.original.rowNumber;
                const isExpanded = expandedRowNumber === row.original.rowNumber;
                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      className={cn(
                        isEditing && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
                        !isEditing && isSelected && 'cursor-pointer bg-primary/10',
                        !isEditing && !isSelected && 'cursor-pointer opacity-60',
                        !isEditing && row.original.requiresHumanReview && isSelected && 'bg-destructive/10',
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
                        <TableCell key={cell.id} className="align-top whitespace-normal">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {isExpanded && !isEditing && (
                      <ExpandedDetailRow row={row.original} colSpan={visibleColumns.length} showSubindustry={showSubindustry} />
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
