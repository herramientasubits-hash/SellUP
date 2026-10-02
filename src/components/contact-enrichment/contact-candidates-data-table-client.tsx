'use client';

import { formatInAppZone } from '@/lib/format-date';
import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Link2, Building2, Mail, Sparkles, UserSearch } from "@/icons";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DataTable,
  DataTableColumnHeader,
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
import { EmptyCell, ExternalIconLink, RowTitleButton } from '@/components/shared/table-cells';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { ContactCandidateDetailSheet } from '@/components/contact-enrichment/contact-candidate-detail-sheet';
import type {
  PendingContactCandidate,
  ContactRelevanceStatus,
  ContactSource,
} from '@/modules/contact-enrichment/types';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import type { ContactCandidatesQueue } from './contact-candidates-panel-queue';
import { CONTACT_CANDIDATES_QUEUE_COPY } from './contact-candidates-queue-copy';
import {
  EMPTY_SCOPE_FILTER,
  TeamFilterButton,
  resolveScopeOwnerIds,
  type ScopeFilterState,
} from '@/components/shared/scope-filters-client';
import { isCandidateCreatedToday } from '@/modules/contact-enrichment/candidate-date-utils';

// ── Label & style maps ─────────────────────────────────────────

const SOURCE_LABELS: Record<ContactSource, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  manual: 'Manual',
  mock: 'Mock',
};

const RELEVANCE_LABELS: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'Alta',
  medium_relevance: 'Media',
  low_relevance: 'Baja',
  not_relevant: 'No relevante',
  insufficient_data: 'Datos insuficientes',
};

// Design Refresh v1: la relevancia se muestra como punto de color + texto
// plano (sin badge) — máximo un elemento de color fuerte por fila.
const RELEVANCE_DOTS: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'bg-success',
  medium_relevance: 'bg-primary',
  low_relevance: 'bg-warning',
  not_relevant: 'bg-border',
  insufficient_data: 'bg-border',
};

// ── Indicadores que filtran ─────────────────────────────────────
// Eran tarjetas de métricas en la cabecera. Ahora son botones: pulsar uno deja
// en la tabla solo esos candidatos, y el número es exactamente lo que se ve.
const CANDIDATE_QUICK_FILTERS: readonly QuickFilterDefinition<PendingContactCandidate>[] = [
  {
    id: 'high_relevance',
    label: 'Alta relevancia',
    icon: Sparkles,
    tone: 'brand',
    predicate: (candidate) => candidate.enrichment_metadata?.relevance?.status === 'high_relevance',
  },
  {
    id: 'with_email',
    label: 'Con email',
    icon: Mail,
    tone: 'positive',
    predicate: (candidate) => Boolean(candidate.email),
  },
  {
    id: 'with_linkedin',
    label: 'Con LinkedIn',
    icon: Link2,
    tone: 'neutral',
    predicate: (candidate) => Boolean(candidate.linkedin_url),
  },
];

/** El estado del flujo, en texto: todas las filas de una cola comparten el suyo. */
function workflowStatusLabel(candidate: PendingContactCandidate): string {
  return candidate.status === 'duplicate' ? 'Duplicado' : 'Por revisar';
}

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return formatInAppZone(d, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }, 'es-CO');
}

/** Convierte un score 0–1 en porcentaje legible; null si no hay dato. */
function toPercent(score: number | undefined): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  const normalized = score > 1 ? score : score * 100;
  return `${Math.round(normalized)}%`;
}

// ── Cells ───────────────────────────────────────────────────────

function NameCell({
  candidate,
  onOpen,
}: {
  candidate: PendingContactCandidate;
  onOpen: (candidate: PendingContactCandidate) => void;
}) {
  // Una sola línea: el nombre abre el detalle y a su lado van, como iconos, el
  // correo y LinkedIn. El detalle completo vive en el panel del candidato.
  const name = candidate.full_name || 'Sin nombre';
  const isNew = candidate.created_at ? isCandidateCreatedToday(candidate.created_at) : false;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <RowTitleButton onClick={() => onOpen(candidate)} title={name}>
        {name}
      </RowTitleButton>
      {isNew && (
        <Badge className="border-0 bg-success/10 text-success text-xs font-semibold px-1.5 py-0.5 shrink-0">
          Nuevo
        </Badge>
      )}
      {candidate.email && (
        <a
          href={`mailto:${candidate.email}`}
          aria-label={`Escribir a ${name} (${candidate.email})`}
          title={candidate.email}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-text-muted outline-none transition-colors hover:bg-surface-muted hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <Mail aria-hidden className="size-3.5" />
        </a>
      )}
      {candidate.linkedin_url && (
        <ExternalIconLink
          href={candidate.linkedin_url}
          icon={Link2}
          label={`Abrir el LinkedIn de ${name}`}
        />
      )}
    </div>
  );
}

function RelevanceCell({ candidate }: { candidate: PendingContactCandidate }) {
  const relevance = candidate.enrichment_metadata?.relevance;
  const status = relevance?.status;
  const scoreLabel = toPercent(relevance?.score);

  if (!status) {
    return <EmptyCell label="Sin relevancia calculada" />;
  }

  return (
    <span className="flex w-fit items-center gap-1.5 text-xs text-foreground">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RELEVANCE_DOTS[status]}`} />
      {RELEVANCE_LABELS[status] ?? status}
      {scoreLabel && (
        <span className="tabular-nums text-muted-foreground">· {scoreLabel}</span>
      )}
    </span>
  );
}

function QualityCell({ candidate }: { candidate: PendingContactCandidate }) {
  const qualityLabel = toPercent(candidate.enrichment_metadata?.relevance?.quality_score);
  if (!qualityLabel) {
    return <EmptyCell label="Sin calidad calculada" />;
  }
  return (
    <span className="text-xs text-muted-foreground tabular-nums">{qualityLabel}</span>
  );
}

// ── Main component ──────────────────────────────────────────────

interface ContactCandidatesDataTableClientProps {
  candidates: PendingContactCandidate[];
  /**
   * AGENT2A-P0-R2 — cola que se está renderizando. Gobierna título, descripción y
   * estado vacío. Por defecto `pending`, que es el comportamiento histórico.
   */
  queue?: ContactCandidatesQueue;
  /** owner_id keyed by account_id — used for scope pre-filtering (candidate → account → owner). */
  accountOwners?: Map<string, string>;
  scopeFilterOptions?: ScopeFilterOptions;
  /**
   * ENABLE_APOLLO_PHONE_REVEAL resuelto server-side (PHONE-3D.4). Se propaga tal
   * cual al detalle del candidato para gobernar el botón "Revelar teléfono".
   */
  phoneRevealEnabled?: boolean;
  /** true si el rol del actor autenticado puede revelar (resuelto server-side). */
  phoneRevealAuthorized?: boolean;
  /**
   * ENABLE_LUSHA_PHONE_REVEAL_FALLBACK resuelto server-side
   * (LUSHA-PHONE-FALLBACK-1). Se propaga tal cual al detalle del candidato.
   */
  lushaPhoneFallbackEnabled?: boolean;
  /** true si el rol del actor autenticado (admin) puede usar el fallback Lusha. */
  lushaPhoneFallbackAuthorized?: boolean;
  /**
   * ENABLE_PHONE_REVEAL_WATERFALL resuelto server-side
   * (AGENT2A-PHONE-WATERFALL-1). Se propaga tal cual al detalle del candidato.
   */
  phoneRevealWaterfallEnabled?: boolean;
  /**
   * true si el actor autenticado puede revelar teléfono — MISMA autoridad que
   * `phoneRevealAuthorized` (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1). El
   * waterfall no tiene permiso de rol propio; su interruptor es el flag.
   */
  phoneRevealWaterfallAuthorized?: boolean;
}

export function ContactCandidatesDataTableClient({
  candidates,
  queue = 'pending',
  accountOwners,
  scopeFilterOptions,
  phoneRevealEnabled = false,
  phoneRevealAuthorized = false,
  lushaPhoneFallbackEnabled = false,
  lushaPhoneFallbackAuthorized = false,
  phoneRevealWaterfallEnabled = false,
  phoneRevealWaterfallAuthorized = false,
}: ContactCandidatesDataTableClientProps) {
  // AGENT2A-P0-R2: título, descripción y estado vacío se derivan de la cola. Antes estaban
  // escritos a mano aquí y la tabla se anunciaba como «Candidatos por revisar» incluso bajo
  // la pill «Duplicados».
  const queueCopy = CONTACT_CANDIDATES_QUEUE_COPY[queue];

  // Side panel de detalle (ajuste posterior a 17A.4A): click en fila abre un
  // drawer read-only con el detalle del candidato. Solo lectura — sin acciones.
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const [scopeFilter, setScopeFilter] = React.useState<ScopeFilterState>(EMPTY_SCOPE_FILTER);
  const dataTableRef = React.useRef<DataTableHandle>(null);

  // «Equipo»: los registros cuyas empresas lleva alguien del grupo o la persona elegida.
  const filteredCandidates = React.useMemo(() => {
    const ownerIds = resolveScopeOwnerIds(scopeFilterOptions, scopeFilter);
    if (!ownerIds || !accountOwners) return candidates;
    return candidates.filter((c) => {
      const ownerId = c.account_id ? accountOwners.get(c.account_id) : undefined;
      return ownerId != null && ownerIds.has(ownerId);
    });
  }, [candidates, scopeFilter, scopeFilterOptions, accountOwners]);

  const openDetail = React.useCallback((candidate: PendingContactCandidate) => {
    setDetailId(candidate.id);
    setDetailOpen(true);
  }, []);

  const quick = useQuickFilter(filteredCandidates, CANDIDATE_QUICK_FILTERS);
  const toggleQuickFilter = React.useCallback(
    (id: string) => {
      // Cambiar de indicador cambia la lista: lo marcado deja de tener sentido.
      dataTableRef.current?.clearSelection();
      quick.toggle(id);
    },
    [quick],
  );
  // En pantalla ancha los indicadores van dentro de la barra de la tabla (no
  // gastan un renglón); en estrecha, en su franja encima.
  const isWide = useWideViewport();
  const quickFilterGroup = {
    label: 'Indicadores de candidatos',
    options: quick.options,
    value: quick.activeId,
    onToggle: toggleQuickFilter,
  };

  const bulkActions = React.useMemo<DataTableBulkAction<PendingContactCandidate>[]>(
    () => [
      {
        id: 'view-detail',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Ver detalle',
        icon: UserSearch,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openDetail(rows[0]),
      },
    ],
    [openDetail],
  );

  const columns: ColumnDef<PendingContactCandidate, unknown>[] = React.useMemo(
    () => [
      {
        id: 'full_name',
        accessorKey: 'full_name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
        cell: ({ row }) => <NameCell candidate={row.original} onOpen={openDetail} />,
        size: 220,
        minSize: 180,
        enableHiding: false,
        // Texto libre: se ordena y se busca, no se filtra por valores.
        meta: { label: 'Nombre', popoverTitle: 'Nombre', disableFilter: true },
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cargo" />,
        cell: ({ row }) =>
          row.original.title ? (
            <span className="block truncate text-xs text-muted-foreground" title={row.original.title}>
              {row.original.title}
            </span>
          ) : (
            <EmptyCell label="Sin cargo" />
          ),
        size: 170,
        minSize: 140,
        meta: { label: 'Cargo', popoverTitle: 'Cargo', disableFilter: true },
      },
      {
        id: 'company',
        accessorFn: (row) => row.company_name ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => {
          const c = row.original;
          if (!c.company_name) return <EmptyCell label="Sin empresa" />;
          return (
            <span
              className="flex min-w-0 items-center gap-1.5 text-xs text-foreground"
              title={c.company_domain ? `${c.company_name} · ${c.company_domain}` : c.company_name}
            >
              <Building2 aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{c.company_name}</span>
            </span>
          );
        },
        size: 180,
        minSize: 150,
        // Enumerable: el embudo ofrece las empresas que aparecen en la cola.
        meta: { label: 'Empresa', popoverTitle: 'Empresa' },
      },
      {
        id: 'source',
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fuente" />,
        // Dato de procedencia, no una señal: en texto, sin chip.
        cell: ({ row }) => (
          <span className="block truncate text-xs text-muted-foreground">
            {SOURCE_LABELS[row.original.source] ?? row.original.source}
          </span>
        ),
        size: 90,
        minSize: 80,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Fuente',
          popoverTitle: 'Fuente',
          filterOptions: Object.entries(SOURCE_LABELS).map(([value, label]) => ({
            value,
            label,
          })),
        },
      },
      {
        id: 'relevance',
        accessorFn: (row) => row.enrichment_metadata?.relevance?.status ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Relevancia" />,
        cell: ({ row }) => <RelevanceCell candidate={row.original} />,
        size: 130,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Relevancia',
          popoverTitle: 'Relevancia',
          filterOptions: Object.entries(RELEVANCE_LABELS).map(([value, label]) => ({
            value,
            label,
          })),
        },
      },
      {
        id: 'quality',
        accessorFn: (row) => row.enrichment_metadata?.relevance?.quality_score ?? 0,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Calidad" />,
        cell: ({ row }) => <QualityCell candidate={row.original} />,
        size: 90,
        minSize: 80,
        enableColumnFilter: false,
        meta: { label: 'Calidad', popoverTitle: 'Calidad', disableFilter: true },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => (
          // Todas las filas de una cola comparten estado — texto plano, sin badge
          <span className="text-xs text-muted-foreground">{workflowStatusLabel(row.original)}</span>
        ),
        size: 110,
        minSize: 100,
        enableColumnFilter: false,
        meta: { label: 'Estado', popoverTitle: 'Estado', disableFilter: true },
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Creado" />,
        cell: ({ row }) =>
          row.original.created_at ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(row.original.created_at)}
            </span>
          ) : (
            <EmptyCell label="Sin fecha" />
          ),
        size: 120,
        minSize: 110,
        // Fecha: solo se ordena.
        meta: { label: 'Creado', popoverTitle: 'Fecha de creación', disableFilter: true },
      },
    ],
    [openDetail],
  );

  // ── Vista de lista ────────────────────────────────────────────
  const renderListItem = React.useCallback(
    (row: PendingContactCandidate, state: DataTableListRowState) => {
      const relevance = row.enrichment_metadata?.relevance?.status;
      return (
        <ListItem
          selected={state.selected}
          leading={state.checkbox}
          title={
            <RowTitleButton onClick={() => openDetail(row)}>{row.full_name || 'Sin nombre'}</RowTitleButton>
          }
          description={
            [row.title, row.company_name, row.email ?? row.phone].filter(Boolean).join(' · ') ||
            'Sin cargo, empresa ni datos de contacto'
          }
          meta={
            relevance ? (
              <span className="flex items-center gap-1.5 text-xs text-foreground">
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${RELEVANCE_DOTS[relevance]}`} />
                Relevancia {(RELEVANCE_LABELS[relevance] ?? relevance).toLowerCase()}
              </span>
            ) : (
              workflowStatusLabel(row)
            )
          }
          actions={state.menu}
        />
      );
    },
    [openDetail],
  );

  // ── Vacíos: cada uno dice por qué no hay filas y qué hacer ────
  // Sin `emptyState`, la tabla pone su propio aviso de «nada coincide con
  // estos filtros» junto a los chips, que ya traen «Limpiar todo».
  let emptyState: React.ReactNode;
  if (candidates.length === 0) {
    emptyState = (
      <EmptyState
        icon={UserSearch}
        title={queueCopy.emptyTitle}
        description={queueCopy.emptyBody}
        action={queueCopy.showEnrichmentCta ? <ContactsEnrichmentCTA /> : undefined}
        variant="plain"
      />
    );
  } else if (filteredCandidates.length === 0) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={UserSearch}
        title="Ningún candidato en este equipo"
        description="El grupo o la persona elegidos no tienen candidatos en sus empresas."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setScopeFilter(EMPTY_SCOPE_FILTER)}>
            Quitar filtro de equipo
          </Button>
        }
      />
    );
  } else if (quick.rows.length === 0 && quick.activeLabel) {
    emptyState = (
      <QuickFilterEmptyState
        icon={UserSearch}
        filterLabel={quick.activeLabel}
        noun="candidatos"
        onClear={quick.clear}
      />
    );
  }

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {candidates.length > 0 && !isWide && (
        <QuickFilterStrip
          {...quickFilterGroup}
          icon={UserSearch}
          total={quick.total}
          noun={queue === 'duplicates' ? ['candidato duplicado', 'candidatos duplicados'] : ['candidato por revisar', 'candidatos por revisar']}
          className="shrink-0"
        />
      )}

      <DataTable
        ref={dataTableRef}
        tableId="contact-candidates"
        noun="candidatos"
        getRowLabel={(row) => row.full_name ?? 'candidato'}
        columns={columns}
        data={quick.rows}
        getRowId={(row) => row.id}
        // La descripción de la cola la dice la cabecera de la página: aquí no se repite.
        title={quick.activeLabel ? `${queueCopy.title} · ${quick.activeLabel}` : queueCopy.title}
        count={quick.rows.length}
        actions={
          <>
            {candidates.length > 0 && isWide && <QuickFilterChips {...quickFilterGroup} />}
            {scopeFilterOptions && (
              <TeamFilterButton
                scopeFilterOptions={scopeFilterOptions}
                value={scopeFilter}
                onChange={setScopeFilter}
              />
            )}
          </>
        }
        enableRowSelection
        bulkActions={bulkActions}
        enableColumnReorder
        initialPageSize={20}
        fillHeight
        rowClickable
        onRowClick={openDetail}
        renderListItem={renderListItem}
        emptyState={emptyState}
      />
    </div>
    <ContactCandidateDetailSheet
      candidateId={detailId}
      open={detailOpen}
      onClose={() => setDetailOpen(false)}
      phoneRevealEnabled={phoneRevealEnabled}
      phoneRevealAuthorized={phoneRevealAuthorized}
      lushaPhoneFallbackEnabled={lushaPhoneFallbackEnabled}
      lushaPhoneFallbackAuthorized={lushaPhoneFallbackAuthorized}
      phoneRevealWaterfallEnabled={phoneRevealWaterfallEnabled}
      phoneRevealWaterfallAuthorized={phoneRevealWaterfallAuthorized}
    />
    </>
  );
}
