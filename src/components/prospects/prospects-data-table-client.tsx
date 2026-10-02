'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Building2,
  Globe,
  Link2,
  ShieldCheck,
  ExternalLink,
  X,
  Info,
  CheckCircle2,
} from "@/icons";
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/feedback/spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

import { Progress } from '@/components/ui/progress';
import { formatProspectDate, isProspectCreatedToday, isProspectCreatedWithinDateRange } from '@/modules/prospect-batches/prospect-date-utils';
import {
  DateRangeColumnHeader,
  type DateRangeFilterValue,
} from '@/components/prospects/prospect-date-range-column-header';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
  type DataTableHandle,
  type DataTableListRowState,
} from '@/components/data-table';
import { ListItem } from '@/components/data-display/list-item';
import {
  QuickFilterChips,
  QuickFilterEmptyState,
  QuickFilterStrip,
  useQuickFilter,
  useWideViewport,
  type QuickFilterDefinition,
} from '@/components/filters/quick-filter-strip';
import {
  CountryCell,
  EmptyCell,
  ExternalIconLink,
  RowTitleButton,
  countryName,
} from '@/components/shared/table-cells';
import {
  ProspectStatusBadge,
  QualityCell,
  StatusCell,
  getDisplayStatusKey,
  getFitEvaluation,
  type ProspectRow,
} from '@/components/prospects/prospect-table-cells';
import { buildProspectQuickFilters } from '@/components/prospects/prospect-quick-filters';
import { CandidateRowActions } from '@/components/prospect-batches/candidate-row-actions';
import { CandidateDetailSheet } from '@/components/prospect-batches/candidate-detail-sheet';
import { getCandidateLinkedInUrl } from '@/modules/prospect-batches/candidate-linkedin-url';
import {
  isTerminalApprovalStatus,
  resolveRowActionAvailability,
} from '@/components/prospects/prospect-review-decision-utils';
import {
  FUTURE_ACTION_HINT,
  DISCARD_ACTION,
  MARK_DUPLICATE_ACTION,
  FUTURE_MORE_ACTIONS,
} from '@/components/prospects/prospect-review-actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  VENDOR_STRUCTURED_SOURCE_LABELS,
  isStructuredCandidate,
  type ProspectCandidateWithReviewer,
} from '@/modules/prospect-batches/types';
import { createClient } from '@/lib/supabase/client';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import { TeamFilterUrlButton } from '@/components/shared/scope-filters-client';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

// ── Derived types ──────────────────────────────────────────────

type Row = ProspectRow;

// ── Constants ──────────────────────────────────────────────────

const NO_QUICK_FILTERS: QuickFilterDefinition<Row>[] = [];

// ── Helpers ────────────────────────────────────────────────────

function extractDomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function getSectorDescription(candidate: Row): string | null {
  return (
    candidate.industry ??
    ((candidate.metadata?.enrichment as Record<string, unknown> | undefined)?.sector_description as
      | string
      | undefined) ??
    null
  );
}

/** El nombre de la fuente oficial de la que viene el candidato, si viene de una. */
function getOfficialSourceLabel(candidate: Row): string | null {
  const isChileOfficialCandidate =
    candidate.source_primary === 'datos_gob_cl' ||
    candidate.country_code === 'CL' ||
    (candidate.source_primary as string) === 'cl_res';
  if (isChileOfficialCandidate) return 'Fuente oficial Chile';
  if (isStructuredCandidate(candidate)) {
    return VENDOR_STRUCTURED_SOURCE_LABELS[candidate.source_primary ?? ''] ?? 'Fuente oficial';
  }
  return null;
}

// AGENT1-CUT4-C — la política de entradas de fila vive AHORA en
// `prospect-review-decision-utils` (`isTerminalApprovalStatus` /
// `resolveRowActionAvailability`), para que la ficha del lote importe
// literalmente la misma y no pueda divergir de esta cola. Estas dos funciones
// son adaptadores de la fila local a esa autoridad: no deciden nada por su
// cuenta.
//
// Q3F-5AZ.2G-1 — una fila es descartable sólo si es un candidato de producción
// limpia todavía en needs_review. Q3F-5AZ.2G-2 — marcar duplicado lo espeja.
// El drawer reevalúa la misma política antes de armar su confirmación.
function isDiscardEligible(candidate: Row): boolean {
  return resolveRowActionAvailability({
    status: candidate.status,
    recordOrigin: candidate.record_origin ?? null,
  }).canOfferDiscard;
}

function isMarkDuplicateEligible(candidate: Row): boolean {
  return resolveRowActionAvailability({
    status: candidate.status,
    recordOrigin: candidate.record_origin ?? null,
  }).canOfferMarkDuplicate;
}

// ── Date range filter ──────────────────────────────────────────
// AGENT1-DISCARDED-TAB-PARITY-1 — <DateRangeColumnHeader> y su tipo de filtro
// vivían aquí como privados de este archivo. Se movieron sin cambios a
// `prospect-date-range-column-header.tsx` para que la tabla de "Descartadas"
// renderice EXACTAMENTE el mismo encabezado de "Fecha".

// ── Sub-components ─────────────────────────────────────────────
// Las celdas de calidad, duplicidad y estado viven en `prospect-table-cells.tsx`.

function getSourceBanner(sourceBatchType: string | undefined): string {
  if (!sourceBatchType) return 'Mostrando prospectos de la operación reciente';
  if (sourceBatchType === 'external_import') return 'Mostrando prospectos de la importación reciente';
  if (sourceBatchType === 'agent_1' || sourceBatchType === 'apollo') return 'Mostrando prospectos generados con IA';
  if (sourceBatchType === 'socrata_colombia') return 'Mostrando prospectos encontrados en RUES Colombia';
  if (sourceBatchType === 'datos_gob_cl') return 'Mostrando prospectos encontrados en fuente oficial Chile';
  if (sourceBatchType === 'denue_mexico') return 'Mostrando prospectos encontrados en DENUE México';
  if (sourceBatchType === 'manual') return 'Mostrando prospectos creados recientemente';
  return 'Mostrando prospectos de la operación reciente';
}

// ── Main Component ─────────────────────────────────────────────

interface ProspectsDataTableClientProps {
  candidates: ProspectCandidateWithReviewer[];
  sourceId?: string;
  sourceBatchType?: string;
  scopeFilterOptions?: ScopeFilterOptions;
  currentUserId?: string;
  currentGroupId?: string;
  /**
   * Lo que se ofrece cuando no hay nada por revisar (generar con IA, importar,
   * crear a mano). Lo arma el panel de servidor, que es el que tiene los drawers.
   */
  emptyActions?: React.ReactNode;
  /**
   * Cierto si la lista llega ya filtrada por la URL (búsqueda, país, sector,
   * origen, estado o alcance): un vacío así no es «no hay prospectos», es «no
   * hay prospectos con estos filtros».
   */
  hasUrlFilters?: boolean;
}

export function ProspectsDataTableClient({
  candidates,
  sourceId,
  sourceBatchType,
  scopeFilterOptions,
  currentUserId = '',
  currentGroupId = '',
  emptyActions,
  hasUrlFilters = false,
}: ProspectsDataTableClientProps) {
  const router = useRouter();

  // Attach batch data from the original fetch
  const rows: Row[] = React.useMemo(
    () => candidates as Row[],
    [candidates],
  );

  const [detailCandidate, setDetailCandidate] = React.useState<Row | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  // Q3F-5AZ.2D-1-UX1 — row menu / context menu / selection bar "Aprobar"
  // opens the drawer with the inline confirmation armed instead of a normal
  // detail view. Cleared once the drawer applies it (or on any normal open).
  const [approveIntent, setApproveIntent] = React.useState(false);
  // Q3F-5AZ.2G-1 — the same entry points can open the drawer with the inline
  // DISCARD confirmation armed. Approve and discard intents are mutually
  // exclusive per open.
  const [discardIntent, setDiscardIntent] = React.useState(false);
  // Q3F-5AZ.2G-2 — the same entry points can open the drawer with the inline
  // MARK-DUPLICATE confirmation armed. Approve / discard / duplicate intents are
  // mutually exclusive per open.
  const [duplicateIntent, setDuplicateIntent] = React.useState(false);

  // Q3F-5AZ.2E-1-UX1 — the side panel and the selection action bar must never
  // both be visible: opening the detail (from a row click, the row menu, the
  // context menu, or the selection bar itself) always clears the active table
  // selection first, which hides the bar (DataTable renders it only while
  // selectedCount > 0). Because selection is cleared on OPEN rather than on
  // close, it also never reappears once the drawer is dismissed.
  const dataTableRef = React.useRef<DataTableHandle>(null);

  // Los indicadores no aplican a la vista de una operación concreta
  // (`sourceId`): ahí manda el aviso de la operación. El «ahora» se fija al
  // montar para que el recuento no cambie de un render a otro.
  const [mountedAt] = React.useState(() => Date.now());
  const quickFilterDefinitions = React.useMemo(
    () => (sourceId ? NO_QUICK_FILTERS : buildProspectQuickFilters(mountedAt)),
    [sourceId, mountedAt],
  );
  const quick = useQuickFilter(rows, quickFilterDefinitions);
  const toggleQuickFilter = React.useCallback(
    (id: string) => {
      // Cambiar de indicador cambia la lista: lo marcado deja de tener sentido.
      dataTableRef.current?.clearSelection();
      quick.toggle(id);
    },
    [quick],
  );

  const openCandidateDetail = React.useCallback(
    (
      row: Row,
      options?: { approveIntent?: boolean; discardIntent?: boolean; duplicateIntent?: boolean },
    ) => {
      dataTableRef.current?.clearSelection();
      setDetailCandidate(row);
      setApproveIntent(options?.approveIntent ?? false);
      setDiscardIntent(options?.discardIntent ?? false);
      setDuplicateIntent(options?.duplicateIntent ?? false);
      setDetailOpen(true);
    },
    [],
  );

  // ── Orchestrator polling (sourceId batch enrichment) ──────────
  const [batchStats, setBatchStats] = React.useState<{
    total: number;
    pending: number;
    enriching: number;
    completed: number;
    failed: number;
    skipped: number;
    possibleDuplicates: number;
  } | null>(null);

  const syncBatchStatus = React.useCallback(async () => {
    if (!sourceId) return;
    const supabase = createClient();
    const { data: batchCandidates, error } = await supabase
      .from('prospect_candidates')
      .select('id, metadata, duplicate_status, status')
      .eq('batch_id', sourceId);

    if (error || !batchCandidates) return;

    let pendingCount = 0;
    let enrichingCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let possibleDuplicateCount = 0;

    const pendingIds: string[] = [];

    for (const cand of batchCandidates) {
      const enrichment = cand.metadata?.enrichment || {};
      const estatus = enrichment.status;

      if (estatus === 'pending') {
        pendingCount++;
        pendingIds.push(cand.id);
      } else if (estatus === 'enriching' || estatus === 'processing') {
        enrichingCount++;
      } else if (estatus === 'completed') {
        completedCount++;
      } else if (estatus === 'failed') {
        failedCount++;
      } else if (
        estatus === 'skipped' ||
        estatus === 'skipped_duplicate' ||
        estatus === 'skipped_already_complete' ||
        estatus === 'no_required'
      ) {
        skippedCount++;
      }

      if (cand.duplicate_status === 'possible_duplicate') {
        possibleDuplicateCount++;
      }
    }

    setBatchStats({
      total: batchCandidates.length,
      pending: pendingCount,
      enriching: enrichingCount,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      possibleDuplicates: possibleDuplicateCount,
    });

    return { pendingIds, enrichingCount };
  }, [sourceId]);

  React.useEffect(() => {
    if (!sourceId) return;

    const initialTimer = setTimeout(() => {
      syncBatchStatus();
    }, 0);

    const interval = setInterval(async () => {
      const stats = await syncBatchStatus();
      if (!stats) return;
      router.refresh();
      if (stats.pendingIds.length === 0 && stats.enrichingCount === 0) {
        clearInterval(interval);
      }
    }, 5000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [sourceId, syncBatchStatus, router]);

  // ── Column definitions ────────────────────────────────────────
  const columns: ColumnDef<Row, unknown>[] = React.useMemo(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Empresa" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          // Una sola línea: el nombre abre el detalle y a su lado van, como
          // iconos, la fuente oficial y los enlaces que salen de SellUp. La
          // ciudad y el dominio escrito se leen en el detalle y en la vista de
          // lista.
          const domain = c.website ? extractDomainFromUrl(c.website) : null;
          // Q3F-5BB.7D: surface the corporate LinkedIn (incl. Lusha's flat
          // metadata.linkedin_url) when present, from the canonical helper.
          const companyLinkedInUrl = getCandidateLinkedInUrl(c.metadata);
          const officialSource = getOfficialSourceLabel(c);

          return (
            <div className="flex min-w-0 items-center gap-1">
              <RowTitleButton onClick={() => openCandidateDetail(c)} title={c.name}>
                {c.name}
              </RowTitleButton>
              {officialSource && (
                <span
                  role="img"
                  aria-label={officialSource}
                  title={officialSource}
                  className="flex size-5 shrink-0 items-center justify-center text-primary"
                >
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                </span>
              )}
              {c.website && (
                <ExternalIconLink
                  href={c.website}
                  icon={Globe}
                  label={`Abrir el sitio web de ${c.name}${domain ? ` (${domain})` : ''}`}
                />
              )}
              {companyLinkedInUrl && (
                <ExternalIconLink
                  href={companyLinkedInUrl}
                  icon={Link2}
                  label={`Abrir el LinkedIn de ${c.name}`}
                />
              )}
            </div>
          );
        },
        size: 220,
        minSize: 180,
        enableHiding: false,
        // Texto libre: se ordena y se busca, no se filtra por valores.
        meta: { label: 'Empresa', popoverTitle: 'Empresa', disableFilter: true },
      },
      {
        id: 'country_code',
        accessorKey: 'country_code',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="País" />
        ),
        cell: ({ row }) => <CountryCell code={row.original.country_code} />,
        size: 130,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'País',
          popoverTitle: 'País',
          filterOptions: LATAM_COUNTRIES.map((c) => ({
            label: c.name,
            value: c.code,
          })),
        },
      },
      {
        id: 'industry',
        accessorKey: 'industry',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Sector" />
        ),
        cell: ({ row }) => {
          const sectorDescription = getSectorDescription(row.original);
          return sectorDescription ? (
            <span className="block truncate text-xs text-muted-foreground" title={sectorDescription}>
              {sectorDescription}
            </span>
          ) : (
            <EmptyCell label="Sin sector" />
          );
        },
        size: 140,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Sector',
          popoverTitle: 'Sector',
          filterOptions: INDUSTRIES.map((ind) => ({
            label: ind,
            value: ind,
          })),
        },
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: ({ column }) => (
          <DateRangeColumnHeader column={column} title="Fecha" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          const isNew = c.created_at ? isProspectCreatedToday(c.created_at) : false;
          return (
            <div className="flex items-center gap-1.5">
              {c.created_at ? (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatProspectDate(c.created_at)}
                </span>
              ) : (
                <EmptyCell label="Sin fecha" />
              )}
              {isNew && (
                <Badge className="border-0 bg-success/10 text-success text-xs font-semibold px-1.5 py-0.5 shrink-0">
                  Nuevo
                </Badge>
              )}
            </div>
          );
        },
        filterFn: (row, _columnId, filterValue: DateRangeFilterValue) => {
          const { from, to } = (filterValue ?? {}) as DateRangeFilterValue;
          if (!from && !to) return true;
          const createdAt = row.original.created_at;
          if (!createdAt) return true;
          return isProspectCreatedWithinDateRange(createdAt, from, to);
        },
        size: 150,
        minSize: 120,
        meta: {
          label: 'Fecha',
          popoverTitle: 'Fecha de creación',
          disableFilter: true,
        },
      },
      {
        id: 'quality',
        accessorFn: () => 'quality',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Calidad" />
        ),
        cell: ({ row }) => <QualityCell candidate={row.original} />,
        size: 150,
        minSize: 130,
        enableColumnFilter: false,
        meta: {
          label: 'Calidad',
          popoverTitle: 'Calidad',
          disableFilter: true,
          // La celda resume varias señales: no hay un valor por el que ordenar.
          disableSort: true,
        },
      },
      {
        id: 'display_status',
        accessorFn: (row) => getDisplayStatusKey(row),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => <StatusCell candidate={row.original} />,
        size: 180,
        minSize: 150,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Estado',
          popoverTitle: 'Estado',
          filterOptions: [
            { value: 'needs_review', label: 'Necesita revisión' },
            { value: 'generated', label: 'Generado' },
            { value: 'normalized', label: 'Normalizado' },
            { value: 'validated', label: 'Validado para revisión' },
            { value: 'approved', label: 'Aprobado' },
            { value: 'discarded', label: 'Descartado' },
            { value: 'duplicate', label: 'Duplicado' },
            { value: 'converted_to_account', label: 'Convertido' },
            { value: 'enrichment_pending', label: 'Enriquecimiento pendiente' },
            { value: 'enriching', label: 'Enriqueciendo…' },
            { value: 'enrichment_failed', label: 'Enriquecimiento fallido' },
          ],
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        // Q3F-5AZ.2D-1-HF1 — the row menu "Aprobar" must never trigger the
        // shared legacy convert-and-approve directly. onApproveOverride redirects
        // it to the same safe drawer confirmation used by the context menu /
        // selection bar. Q3F-5AZ.2E-1: that confirmation now approves AND creates
        // the empresa through the SAFE server wrapper (admin gate + eligibility,
        // then delegation) — never the legacy action straight from a menu.
        cell: ({ row }) => (
          <CandidateRowActions
            candidate={row.original}
            onApproveOverride={() => openCandidateDetail(row.original, { approveIntent: true })}
            // Q3F-5AZ.2G-1 — three-dot "Descartar" must never call the legacy
            // discardCandidate directly on the Prospectos surface. It opens the
            // safe drawer confirmation (admin gate + eligibility, then delegation).
            onDiscardOverride={() => openCandidateDetail(row.original, { discardIntent: true })}
            // Q3F-5AZ.2G-2 — three-dot "Marcar como duplicado" must never call the
            // legacy markCandidateDuplicate directly on the Prospectos surface. It
            // opens the safe drawer confirmation (admin gate + eligibility, then
            // delegation).
            onMarkDuplicateOverride={() =>
              openCandidateDetail(row.original, { duplicateIntent: true })
            }
          />
        ),
        size: 48,
        minSize: 48,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
        meta: { label: 'Acciones', disableFilter: true, disableSort: true },
      },
    ],
    [openCandidateDetail],
  );

  // ── Context menu ──────────────────────────────────────────────
  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => [
        {
          id: 'view',
          label: 'Ver detalle',
          icon: Info,
          onClick: () => openCandidateDetail(row),
        },
        // "Aprobar" never approves directly from the menu — it opens the
        // drawer with the inline confirmation armed; real eligibility is
        // evaluated there. Hidden only for unambiguous terminal states.
        ...(!isTerminalApprovalStatus(row.status)
          ? [
              {
                id: 'approve',
                label: 'Aprobar',
                icon: CheckCircle2,
                onClick: () => openCandidateDetail(row, { approveIntent: true }),
              },
            ]
          : []),
        // Q3F-5AZ.2G-1 — "Descartar" opens the drawer with the inline discard
        // confirmation armed (never discards directly). Offered only when the
        // row is genuinely discardable (needs_review, clean-production).
        ...(isDiscardEligible(row)
          ? [
              {
                id: 'discard',
                label: DISCARD_ACTION.label,
                icon: DISCARD_ACTION.icon,
                variant: 'destructive' as const,
                onClick: () => openCandidateDetail(row, { discardIntent: true }),
              },
            ]
          : []),
        // Q3F-5AZ.2G-2 — "Marcar duplicado" opens the drawer with the inline
        // duplicate confirmation armed (never marks directly). Offered only when
        // the row is genuinely markable (needs_review, clean-production).
        ...(isMarkDuplicateEligible(row)
          ? [
              {
                id: 'mark-duplicate',
                label: MARK_DUPLICATE_ACTION.label,
                icon: MARK_DUPLICATE_ACTION.icon,
                onClick: () => openCandidateDetail(row, { duplicateIntent: true }),
              },
            ]
          : []),
        ...(row.website
          ? [
              {
                id: 'open-website',
                label: 'Abrir sitio web',
                icon: ExternalLink,
                separator: true as const,
                onClick: () => {
                  window.open(
                    row.website!.startsWith('http') ? row.website! : `https://${row.website}`,
                    '_blank',
                    'noopener,noreferrer',
                  );
                },
              },
            ]
          : []),
      ],
    }),
    [openCandidateDetail],
  );

  // ── Bulk actions ──────────────────────────────────────────────
  // Q3F-5AZ.2E-1-UX1 — the selection action bar mirrors the side panel
  // footer's hierarchy exactly (same copy/icons via prospect-review-actions.tsx):
  //   Ver detalle → Aprobar (primary) → Descartar → Más acciones (dropdown,
  //   all disabled) → Abrir sitios web.
  // Q3F-5AZ.2G-1 — Descartar is now enabled for exactly one eligible row (opens
  // the drawer's discard confirmation); 2+ selected or an ineligible row keeps
  // it disabled. Every "Más acciones" entry stays disabled (no new action).
  const bulkActions = React.useMemo<DataTableBulkAction<Row>[]>(
    () => [
      {
        id: 'view-detail',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Ver detalle',
        icon: Info,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openCandidateDetail(rows[0]),
      },
      {
        id: 'approve',
        label: 'Aprobar',
        icon: CheckCircle2,
        // Bulk approve is explicitly out of scope: exactly one selected row
        // opens the drawer with the confirmation armed; 2+ stays disabled.
        disabled: (rows) => rows.length !== 1,
        disabledLabel: (rows) =>
          rows.length > 1 ? 'Aprobación masiva pendiente' : undefined,
        onClick: (rows) => openCandidateDetail(rows[0], { approveIntent: true }),
      },
      {
        // Q3F-5AZ.2G-1 — single-selection discard: exactly one eligible row
        // opens the drawer with the discard confirmation armed. Bulk discard is
        // explicitly out of scope, so 2+ selected rows keep it disabled; a
        // single ineligible row is disabled too.
        id: 'discard',
        label: DISCARD_ACTION.label,
        icon: DISCARD_ACTION.icon,
        variant: 'destructive',
        disabled: (rows) => rows.length !== 1 || !isDiscardEligible(rows[0]),
        disabledLabel: (rows) =>
          rows.length > 1 ? 'Descarte masivo pendiente' : undefined,
        onClick: (rows) => {
          if (rows.length === 1 && isDiscardEligible(rows[0])) {
            openCandidateDetail(rows[0], { discardIntent: true });
          }
        },
      },
      {
        id: 'more-actions',
        label: 'Más acciones',
        items: [
          {
            // Q3F-5AZ.2G-2 — single-selection mark-duplicate: exactly one eligible
            // row opens the drawer with the duplicate confirmation armed. Bulk
            // duplicate is explicitly out of scope, so 2+ selected rows keep it
            // disabled; a single ineligible row is disabled too.
            id: 'mark-duplicate',
            label: MARK_DUPLICATE_ACTION.label,
            icon: MARK_DUPLICATE_ACTION.icon,
            disabled: (rows) => rows.length !== 1 || !isMarkDuplicateEligible(rows[0]),
            disabledLabel: (rows) =>
              rows.length > 1 ? 'Marcar duplicado masivo pendiente' : FUTURE_ACTION_HINT,
            onClick: (rows) => {
              if (rows.length === 1 && isMarkDuplicateEligible(rows[0])) {
                openCandidateDetail(rows[0], { duplicateIntent: true });
              }
            },
          },
          ...FUTURE_MORE_ACTIONS.map((action, index) => ({
            id: `more-action-${index}`,
            label: action.label,
            icon: action.icon,
            disabled: () => true,
            disabledLabel: () => FUTURE_ACTION_HINT,
            onClick: () => {},
          })),
        ],
      },
      {
        id: 'open-websites',
        label: 'Abrir sitios web',
        icon: ExternalLink,
        disabled: (rows) => !rows.some((r) => r.website),
        onClick: (rows) => {
          rows.forEach((r) => {
            if (r.website) {
              window.open(
                r.website.startsWith('http') ? r.website : `https://${r.website}`,
                '_blank',
                'noopener,noreferrer',
              );
            }
          });
        },
      },
    ],
    [openCandidateDetail],
  );

  const isSourceFiltered = !!sourceId;

  // En pantalla ancha los indicadores van dentro de la barra de la tabla (no
  // gastan un renglón); en estrecha, en su franja encima.
  const isWide = useWideViewport();
  const showQuickFilters = !isSourceFiltered && rows.length > 0;
  const quickFilterGroup = {
    label: 'Indicadores de prospectos',
    options: quick.options,
    value: quick.activeId,
    onToggle: toggleQuickFilter,
  };

  // ── Vista de lista ────────────────────────────────────────────
  const renderListItem = React.useCallback(
    (row: Row, state: DataTableListRowState) => {
      const domain = row.website ? extractDomainFromUrl(row.website) : null;
      const evaluation = getFitEvaluation(row);
      return (
        <ListItem
          selected={state.selected}
          leading={state.checkbox}
          title={
            <RowTitleButton onClick={() => openCandidateDetail(row)} title={row.name}>
              {row.name}
            </RowTitleButton>
          }
          description={
            [
              [row.city, countryName(row.country_code)].filter(Boolean).join(', '),
              getSectorDescription(row),
              domain,
              evaluation.score !== null ? evaluation.text : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Sin país, sector ni sitio web'
          }
          meta={<ProspectStatusBadge candidate={row} />}
          actions={
            // Con «menú en cada fila» la tabla trae el suyo; si no, el de siempre.
            state.menu ?? (
              <CandidateRowActions
                candidate={row}
                onApproveOverride={() => openCandidateDetail(row, { approveIntent: true })}
                onDiscardOverride={() => openCandidateDetail(row, { discardIntent: true })}
                onMarkDuplicateOverride={() => openCandidateDetail(row, { duplicateIntent: true })}
              />
            )
          }
        />
      );
    },
    [openCandidateDetail],
  );

  // ── Vacíos: cada uno dice por qué no hay filas y qué hacer ────
  // Sin `emptyState`, la tabla pone su propio aviso de «nada coincide con
  // estos filtros» junto a los chips, que ya traen «Limpiar todo».
  let emptyState: React.ReactNode;
  if (rows.length === 0 && isSourceFiltered) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="Esta operación no dejó prospectos nuevos"
        description="Puede que todos se omitieran por estar duplicados, por calidad o por falta de datos."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => router.push(PROSPECTOS_TAB_ROUTE)}>
            Ver todos los prospectos
          </Button>
        }
      />
    );
  } else if (rows.length === 0 && hasUrlFilters) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="Ningún prospecto con estos filtros"
        description="El enlace por el que llegaste trae filtros que dejan la lista vacía."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => router.push(PROSPECTOS_TAB_ROUTE)}>
            Limpiar filtros
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="No hay prospectos por revisar"
        description="Genera prospectos con IA, importa un archivo o crea uno a mano. Aparecerán aquí para que decidas."
        action={emptyActions}
      />
    );
  } else if (quick.rows.length === 0 && quick.activeLabel) {
    emptyState = (
      <QuickFilterEmptyState
        icon={Building2}
        filterLabel={quick.activeLabel}
        noun="prospectos"
        onClear={quick.clear}
      />
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Banner de operación reciente (sourceId activo) */}
        {isSourceFiltered && (
          <Alert variant="info" role="status" aria-live="polite" className="shrink-0 [&>div]:gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-center gap-2.5">
                {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) && (
                  <Spinner size="sm" tone="primary" decorative />
                )}
                <AlertTitle className="min-w-0 text-sm font-medium">
                  {batchStats ? (
                    (batchStats.pending > 0 || batchStats.enriching > 0) ? (
                      `Importación completada. Estamos completando la información de ${batchStats.pending + batchStats.enriching} prospecto${batchStats.pending + batchStats.enriching !== 1 ? 's' : ''}…`
                    ) : (
                      `Importación completada. Se enriquecieron ${batchStats.completed} prospecto${batchStats.completed !== 1 ? 's' : ''} y ${batchStats.failed + batchStats.possibleDuplicates} requiere${batchStats.failed + batchStats.possibleDuplicates !== 1 ? 'n' : ''} revisión.`
                    )
                  ) : (
                    getSourceBanner(sourceBatchType)
                  )}
                </AlertTitle>
              </div>
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => router.push(PROSPECTOS_TAB_ROUTE)}
                className="shrink-0"
              >
                <X aria-hidden="true" />
                Ver todos los prospectos
              </Button>
            </div>
            {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) && (
              <div className="space-y-1.5">
                <Progress
                  value={batchStats.total > 0 ? ((batchStats.completed + batchStats.failed) / batchStats.total) * 100 : 0}
                  className="h-1.5"
                />
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {batchStats.completed + batchStats.failed} de {batchStats.total} procesados
                  </span>
                  <span className="tabular-nums font-medium text-primary">
                    {batchStats.total > 0 ? Math.round(((batchStats.completed + batchStats.failed) / batchStats.total) * 100) : 0}%
                  </span>
                </div>
              </div>
            )}
          </Alert>
        )}

        {showQuickFilters && !isWide && (
          <QuickFilterStrip
            {...quickFilterGroup}
            icon={Building2}
            total={quick.total}
            noun={['prospecto por revisar', 'prospectos por revisar']}
            className="shrink-0"
          />
        )}

        <DataTable
          tableId="prospects"
          noun="prospectos"
          getRowLabel={(row) => row.name}
          ref={dataTableRef}
          columns={columns}
          data={quick.rows}
          getRowId={(row) => row.id}
          title={quick.activeLabel ? `Por revisar · ${quick.activeLabel}` : 'Prospectos por revisar'}
          count={quick.rows.length}
          actions={
            <>
              {showQuickFilters && isWide && <QuickFilterChips {...quickFilterGroup} />}
              {scopeFilterOptions && !sourceId && (
                <TeamFilterUrlButton
                  scopeFilterOptions={scopeFilterOptions}
                  currentUserId={currentUserId}
                  currentGroupId={currentGroupId}
                />
              )}
            </>
          }
          enableRowSelection
          contextMenu={contextMenu}
          bulkActions={bulkActions}
          enableColumnReorder
          initialPageSize={20}
          fillHeight
          onRowClick={(row) => openCandidateDetail(row)}
          rowClickable
          renderListItem={renderListItem}
          emptyState={emptyState}
        />
      </div>

      <CandidateDetailSheet
        key={detailCandidate?.id ?? 'empty'}
        candidate={detailCandidate ? (rows.find((c) => c.id === detailCandidate.id) ?? detailCandidate) : null}
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCandidate(null);
            setApproveIntent(false);
            setDiscardIntent(false);
            setDuplicateIntent(false);
          }
        }}
        onCandidateUpdated={(updated) => {
          setDetailCandidate(updated);
        }}
        initialApproveIntent={approveIntent}
        onApproveIntentConsumed={() => setApproveIntent(false)}
        initialDiscardIntent={discardIntent}
        onDiscardIntentConsumed={() => setDiscardIntent(false)}
        initialDuplicateIntent={duplicateIntent}
        onDuplicateIntentConsumed={() => setDuplicateIntent(false)}
      />
    </>
  );
}
