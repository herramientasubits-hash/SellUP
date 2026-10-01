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
  CheckCircle2,
  XCircle,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Users,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

// ── Country code → display name (subset LATAM + common) ───────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  AR: 'Argentina', BO: 'Bolivia', BR: 'Brasil', CL: 'Chile',
  CO: 'Colombia', CR: 'Costa Rica', DO: 'R. Dominicana', EC: 'Ecuador',
  GT: 'Guatemala', HN: 'Honduras', MX: 'México', NI: 'Nicaragua',
  PA: 'Panamá', PE: 'Perú', PY: 'Paraguay', SV: 'El Salvador',
  UY: 'Uruguay', VE: 'Venezuela', US: 'EE.UU.', ES: 'España',
};

function countryLabel(code: string | null): string {
  if (!code) return '—';
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}

// ── Domain extractor ──────────────────────────────────────────────────────────

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

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
    valid: <CheckCircle2 className="h-3 w-3 text-success" />,
    normalized: <CheckCircle2 className="h-3 w-3 text-primary" />,
    warning: <AlertTriangle className="h-3 w-3 text-warning" />,
    requires_review: <Pencil className="h-3 w-3 text-destructive" />,
    invalid: <XCircle className="h-3 w-3 text-destructive" />,
  };
  return (
    <Badge variant={variantMap[config.variant] ?? 'secondary'} className="whitespace-nowrap">
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
        <p className="text-xs text-muted-foreground">
          Original: <span className="italic">{originalValue}</span>
        </p>
      )}
      {(matchStatus === 'alias_match' || matchStatus === 'normalized_match') && isDifferent && (
        <p className="text-xs text-primary">Normalizado automáticamente</p>
      )}
    </div>
  );
}

// ── Warning message translator (classifier emits messages in English) ──────────

function translateWarning(message: string): string {
  if (/^Industry value is empty or not provided/.test(message))
    return 'El valor de industria está vacío o no fue proporcionado.';

  const industryNotFound = message.match(/^Industry not found in catalog: "(.+)"\./);
  if (industryNotFound)
    return `La industria "${industryNotFound[1]}" no existe en el catálogo actual.`;

  const industryAmbiguous = message.match(/^Ambiguous industry name: "(.+)"\./);
  if (industryAmbiguous)
    return `El nombre de industria "${industryAmbiguous[1]}" es ambiguo.`;

  const industryAmbiguousNorm = message.match(/^Ambiguous industry after normalization: "(.+)"\./);
  if (industryAmbiguousNorm)
    return `La industria "${industryAmbiguousNorm[1]}" es ambigua tras la normalización.`;

  if (/^Subindustry value is empty or not provided/.test(message))
    return 'El valor de subindustria está vacío o no fue proporcionado.';

  const subNotFound = message.match(/^Subindustry not found in catalog: "(.+)"\./);
  if (subNotFound)
    return `La subindustria "${subNotFound[1]}" no existe en el catálogo actual.`;

  const subWrongIndustry = message.match(/^Subindustry "(.+)" was found in catalog but does not belong/);
  if (subWrongIndustry)
    return `La subindustria "${subWrongIndustry[1]}" existe en el catálogo pero no pertenece a la industria detectada.`;

  const subAmbiguousWithin = message.match(/^Ambiguous subindustry "(.+)" — multiple matches within/);
  if (subAmbiguousWithin)
    return `La subindustria "${subAmbiguousWithin[1]}" es ambigua — múltiples coincidencias dentro de la industria detectada.`;

  const subAmbiguousAcross = message.match(/^Ambiguous subindustry "(.+)" — multiple matches across/);
  if (subAmbiguousAcross)
    return `La subindustria "${subAmbiguousAcross[1]}" es ambigua — múltiples coincidencias en distintas industrias.`;

  const subRecognized = message.match(/^Subindustry "(.+)" recognized; parent industry suggested/);
  if (subRecognized)
    return `La subindustria "${subRecognized[1]}" fue reconocida; industria sugerida pero no confirmada.`;

  const subCountryRequired = message.match(/^Subindustry "(.+)" has country restrictions but no country code/);
  if (subCountryRequired)
    return `La subindustria "${subCountryRequired[1]}" tiene restricciones por país, pero no se proporcionó código de país.`;

  const subNotApplicable = message.match(/^Subindustry "(.+)" is not applicable to country "(.+)"/);
  if (subNotApplicable)
    return `La subindustria "${subNotApplicable[1]}" no aplica para el país "${subNotApplicable[2]}".`;

  return message;
}

// ── DetailField — labeled field for the expanded detail layout ────────────────

function DetailField({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn('space-y-0.5', fullWidth && 'col-span-full')}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="text-xs text-foreground">{value}</div>
    </div>
  );
}

// ── ExpandedDetailRow ─────────────────────────────────────────────────────────

function ExpandedDetailRow({
  row,
  colSpan,
  showSubindustry,
}: {
  row: ImportClassificationPreviewRow;
  colSpan: number;
  showSubindustry: boolean;
}) {
  const statusConfig = CLASSIFICATION_STATUS_MAP[row.validationStatus];

  const websiteHref = row.website
    ? row.website.startsWith('http') ? row.website : `https://${row.website}`
    : null;
  const linkedinHref = row.linkedinUrl
    ? row.linkedinUrl.startsWith('http') ? row.linkedinUrl : `https://${row.linkedinUrl}`
    : null;
  const sourceHref = row.sourceUrl
    ? row.sourceUrl.startsWith('http') ? row.sourceUrl : `https://${row.sourceUrl}`
    : null;

  const showOriginalValues =
    (row.industryOriginalValue || (showSubindustry && row.subindustryOriginalValue)) &&
    (row.correctionSource === 'manual' ||
      row.industryMatchStatus === 'alias_match' ||
      row.industryMatchStatus === 'normalized_match' ||
      row.subindustryMatchStatus === 'alias_match' ||
      row.subindustryMatchStatus === 'normalized_match');

  const hasInfoBlock =
    row.description ||
    row.countryCode ||
    row.city ||
    row.website ||
    row.linkedinUrl ||
    row.companySize ||
    row.confidence ||
    row.notes;

  const hasEvidenceBlock = row.sourceUrl || row.sourceEvidence;

  const hasClassificationBlock =
    row.industryCanonicalName ||
    (showSubindustry && row.subindustryCanonicalName) ||
    showOriginalValues ||
    (row.warnings && row.warnings.length > 0) ||
    row.requiresHumanReview;

  return (
    <tr>
      <td colSpan={colSpan} className="px-0 pb-0 pt-0">
        <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-border/50 bg-surface-subtle">

          {/* ── Bloque 1: Resumen ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 bg-surface-subtle px-3 py-2">
            <span className="text-xs font-semibold text-foreground">{row.companyName}</span>
            <Badge
              variant={
                row.validationStatus === 'valid' || row.validationStatus === 'normalized'
                  ? 'positive'
                  : row.validationStatus === 'warning'
                    ? 'warning'
                    : 'negative'
              }
            >
              {statusConfig.label}
            </Badge>
            {row.industryCanonicalName && (
              <span className="text-xs text-muted-foreground">
                {row.industryCanonicalName}
                {row.subindustryCanonicalName && (
                  <> · <span className="text-muted-foreground">{row.subindustryCanonicalName}</span></>
                )}
              </span>
            )}
          </div>

          <div className="space-y-4 p-3">

            {/* ── Bloque 2: Información detectada ─────────────────────────────── */}
            {hasInfoBlock && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Información detectada
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {row.description && (
                    <DetailField
                      label="Descripción"
                      fullWidth
                      value={<span className="leading-relaxed">{row.description}</span>}
                    />
                  )}
                  {row.countryCode && (
                    <DetailField label="País" value={countryLabel(row.countryCode)} />
                  )}
                  {row.city && (
                    <DetailField label="Ciudad" value={row.city} />
                  )}
                  {row.companySize && (
                    <DetailField label="Tamaño" value={row.companySize} />
                  )}
                  {row.confidence && (
                    <DetailField label="Confianza" value={row.confidence} />
                  )}
                  {websiteHref && (
                    <DetailField
                      label="Sitio web"
                      value={
                        <a
                          href={websiteHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          title={row.website ?? undefined}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {extractDomain(row.website) ?? row.website}
                        </a>
                      }
                    />
                  )}
                  {linkedinHref && (
                    <DetailField
                      label="LinkedIn"
                      value={
                        <a
                          href={linkedinHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          title={row.linkedinUrl ?? undefined}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {extractDomain(row.linkedinUrl)?.replace('linkedin.com/', 'li/') ?? row.linkedinUrl}
                        </a>
                      }
                    />
                  )}
                  {row.notes && (
                    <DetailField label="Notas" fullWidth value={row.notes} />
                  )}
                  {!hasInfoBlock && (
                    <p className="col-span-full text-xs text-muted-foreground italic">No disponible</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Bloque 3: Evidencia ──────────────────────────────────────────── */}
            {hasEvidenceBlock && (
              <div className="space-y-2 border-t border-border/50 pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Evidencia
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {sourceHref && (
                    <DetailField
                      label="URL de evidencia"
                      value={
                        <a
                          href={sourceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-56 items-center gap-1 truncate rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          title={row.sourceUrl ?? undefined}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {extractDomain(row.sourceUrl) ?? row.sourceUrl}
                        </a>
                      }
                    />
                  )}
                  {row.sourceEvidence && (
                    <DetailField label="Fuente / evidencia" value={row.sourceEvidence} />
                  )}
                </div>
              </div>
            )}

            {/* ── Bloque 4: Clasificación ──────────────────────────────────────── */}
            {hasClassificationBlock && (
              <div className="space-y-2 border-t border-border/50 pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Clasificación
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {row.industryCanonicalName && (
                    <DetailField label="Industria detectada" value={row.industryCanonicalName} />
                  )}
                  {showSubindustry && row.subindustryCanonicalName && (
                    <DetailField label="Subindustria detectada" value={row.subindustryCanonicalName} />
                  )}
                </div>

                {/* Valores originales */}
                {showOriginalValues && (
                  <div className="mt-2 rounded-lg bg-surface-muted px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Valores originales
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      {row.industryOriginalValue && (
                        <span>Industria: <em>{row.industryOriginalValue}</em></span>
                      )}
                      {showSubindustry && row.subindustryOriginalValue && (
                        <span>Subindustria: <em>{row.subindustryOriginalValue}</em></span>
                      )}
                      {row.correctionSource === 'manual' && (
                        <span className="text-primary font-medium">— corregido manualmente</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Advertencias */}
                {row.warnings && row.warnings.length > 0 && (
                  <div className="mt-2 rounded-lg border border-warning/25 bg-warning/15 px-3 py-2 space-y-1.5">
                    <p className="text-xs font-semibold text-warning">
                      Advertencias de clasificación
                    </p>
                    <ul className="space-y-1">
                      {row.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-warning">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span>{translateWarning(w.message)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Motivo de revisión requerida */}
                {row.requiresHumanReview && (
                  <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-destructive">
                      Motivo de revisión requerida
                    </p>
                    <p className="text-xs text-destructive leading-relaxed">
                      Esta fila requiere corrección manual antes de poder importarse.
                      {row.industryCanonicalId === null &&
                        ' La industria no pudo clasificarse automáticamente.'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {!hasInfoBlock && !hasEvidenceBlock && !hasClassificationBlock && (
              <p className="text-xs text-muted-foreground italic">No hay información adicional para esta fila.</p>
            )}
          </div>
        </div>
      </td>
    </tr>
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
              <div className="min-w-40" onClick={(e) => e.stopPropagation()}>
                <label className="sr-only" htmlFor={`edit-industry-${row.original.rowNumber}`}>
                  Industria
                </label>
                <select
                  id={`edit-industry-${row.original.rowNumber}`}
                  className="h-8 w-full rounded-md border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-muted"
                  value={editIndustryId}
                  onChange={(e) => {
                    setEditIndustryId(e.target.value);
                    setEditSubindustryId('');
                  }}
                  autoFocus
                >
                  <option value="">Seleccionar industria</option>
                  {industryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
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
                <label className="sr-only" htmlFor={`edit-subindustry-${row.original.rowNumber}`}>
                  Subindustria
                </label>
                <select
                  id={`edit-subindustry-${row.original.rowNumber}`}
                  className="h-8 w-full rounded-md border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-muted"
                  value={editSubindustryId}
                  onChange={(e) => setEditSubindustryId(e.target.value)}
                  disabled={!editIndustryId}
                >
                  <option value="">
                    {editIndustryId ? 'Seleccionar subindustria' : 'Elige industria primero'}
                  </option>
                  {subindustryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
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
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
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
                      <span className="h-3 w-3 animate-spin rounded-full border border-primary-foreground border-t-transparent" />
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
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border/50 bg-surface-subtle">
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
          <tbody className="divide-y divide-border/50">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-muted-foreground">
                  No hay filas que coincidan con el filtro.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isSelected = selectedRowIds.has(row.original.rowNumber);
                const isEditing = editingRowNumber === row.original.rowNumber;
                const isExpanded = expandedRowNumber === row.original.rowNumber;
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        'transition-colors',
                        isEditing && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
                        !isEditing && isSelected && 'cursor-pointer bg-primary/10',
                        !isEditing && !isSelected && 'cursor-pointer opacity-60 hover:bg-surface-muted',
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
                        <td key={cell.id} className="px-3 py-2.5 align-top">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && !isEditing && (
                      <ExpandedDetailRow row={row.original} colSpan={visibleColumns.length} showSubindustry={showSubindustry} />
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
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
