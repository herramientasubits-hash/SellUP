'use client';

import { formatInAppZone } from '@/lib/format-date';
import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Link2, Building2, Globe, Mail, Phone, PhoneCall, RotateCcw, Sparkles, UserSearch } from "@/icons";

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
import {
  EmptyCell,
  ExternalIconLink,
  ExternalLinkCell,
  RowTitleButton,
} from '@/components/shared/table-cells';
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
import { hubspotCompanyUrl } from './hubspot-company-url';
import { SEND_TO_REVIEW_LABEL, useSendRejectedToReview } from './contact-candidate-rejected-actions';
export { rejectionInfo } from './contact-candidate-rejection-info';
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
  if (candidate.status === 'duplicate') return 'Duplicado';
  if (candidate.status === 'discarded') return 'Rechazado';
  return 'Por revisar';
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

// ── Columnas por objeto (Contacto / Empresa) ───────────────────
// Salen ocultas y se piden desde «Configurar tabla», agrupadas por el objeto al
// que pertenece el dato. La empresa es la asociada al candidato EN ESTE MOMENTO
// (reasignación incluida), completada con la cuenta SellUp.

const CONTACT_GROUP = 'Contacto';
const COMPANY_GROUP = 'Empresa';

/** Quita protocolo, `www.` y barra final: lo que se lee de una página web. */
function displayWebsite(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

function EmailCell({ candidate }: { candidate: PendingContactCandidate }) {
  if (!candidate.email) return <EmptyCell label="Sin correo" />;
  return (
    <a
      href={`mailto:${candidate.email}`}
      title={candidate.email}
      onClick={(e) => e.stopPropagation()}
      className="block truncate rounded-sm text-xs text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      {candidate.email}
    </a>
  );
}

function PhoneCell({ candidate }: { candidate: PendingContactCandidate }) {
  if (!candidate.phone) return <EmptyCell label="Sin teléfono" />;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground" title={candidate.phone}>
      <Phone aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate tabular-nums">{candidate.phone}</span>
    </span>
  );
}

const PHONE_REVEAL_STATUS_LABELS: Partial<Record<NonNullable<PendingContactCandidate['phone_reveal_status']>, string>> = {
  requested: 'En proceso',
  pending: 'En proceso',
  revealed: 'Revelado',
  no_phone_found: 'Sin teléfono',
};

/**
 * «Revelar teléfono» desde la tabla. Revelar gasta créditos y tiene su propio gobierno
 * (flag, rol, identidad, waterfall, confirmación): todo eso vive en el detalle del
 * candidato. Por eso el botón de la celda abre ese detalle, donde está el botón real.
 */
function PhoneRevealCell({
  candidate,
  canReveal,
  onOpen,
}: {
  candidate: PendingContactCandidate;
  canReveal: boolean;
  onOpen: (candidate: PendingContactCandidate) => void;
}) {
  const status = candidate.phone_reveal_status;
  const label = status ? PHONE_REVEAL_STATUS_LABELS[status] : undefined;
  if (label) {
    return <span className="block truncate text-xs text-muted-foreground">{label}</span>;
  }
  if (!canReveal) return <EmptyCell label="Revelar teléfono no disponible" />;
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      title={status === 'error' ? 'El intento anterior falló: abre el detalle para reintentar' : 'Abre el detalle para revelar el teléfono'}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(candidate);
      }}
    >
      <PhoneCall aria-hidden />
      {status === 'error' ? 'Reintentar' : 'Revelar'}
    </Button>
  );
}

/** LinkedIn: sólo se indica que existe; el enlace no se muestra, se abre en otra pestaña. */
function LinkedinCell({ candidate }: { candidate: PendingContactCandidate }) {
  if (!candidate.linkedin_url) return <EmptyCell label="Sin LinkedIn" />;
  const name = candidate.full_name || 'este contacto';
  return (
    <ExternalLinkCell
      href={candidate.linkedin_url}
      icon={Link2}
      label={`Abrir el LinkedIn de ${name}`}
    >
      Ver perfil
    </ExternalLinkCell>
  );
}

function CompanyDomainCell({ candidate }: { candidate: PendingContactCandidate }) {
  if (!candidate.company_domain) return <EmptyCell label="Sin dominio" />;
  return (
    <span className="block truncate text-xs text-muted-foreground" title={candidate.company_domain}>
      {candidate.company_domain}
    </span>
  );
}

function CompanyWebsiteCell({ candidate }: { candidate: PendingContactCandidate }) {
  const website = candidate.company_website;
  if (!website) return <EmptyCell label="Sin página web" />;
  return (
    <ExternalLinkCell
      href={website}
      icon={Globe}
      label={`Abrir la página web de ${candidate.company_name ?? 'la empresa'}`}
    >
      {displayWebsite(website)}
    </ExternalLinkCell>
  );
}

/** Sólo el número; al pulsarlo abre la empresa en HubSpot en otra pestaña. */
function HubspotCompanyIdCell({
  candidate,
  portalId,
}: {
  candidate: PendingContactCandidate;
  portalId: string | null | undefined;
}) {
  const companyId = candidate.hubspot_company_id?.trim();
  if (!companyId) return <EmptyCell label="No existe en HubSpot" />;
  return (
    <ExternalLinkCell
      href={hubspotCompanyUrl(companyId, portalId)}
      label={`Abrir ${candidate.company_name ?? 'la empresa'} en HubSpot`}
      className="tabular-nums"
    >
      {companyId}
    </ExternalLinkCell>
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
  /**
   * Hub ID de la cuenta HubSpot conectada, resuelto server-side. Arma el enlace de la
   * columna «HubSpot ID empresa»; `null` si no se conoce.
   */
  hubspotPortalId?: string | null;
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
  hubspotPortalId = null,
}: ContactCandidatesDataTableClientProps) {
  // AGENT2A-P0-R2: título, descripción y estado vacío se derivan de la cola. Antes estaban
  // escritos a mano aquí y la tabla se anunciaba como «Candidatos por revisar» incluso bajo
  // la pill «Duplicados».
  const queueCopy = CONTACT_CANDIDATES_QUEUE_COPY[queue];
  // AGENT2A-CONTACTOS-RECHAZADOS: «Contactos rechazados» ES esta misma tabla —mismas columnas,
  // filtros y panel—; cualquier cambio visual de «Por revisar» le llega igual. Lo único que
  // cambia son las acciones: la barra sólo ofrece «Enviar a revisar».
  const isRejectedQueue = queue === 'rejected';

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

  const { send: sendToReview } = useSendRejectedToReview(() =>
    dataTableRef.current?.clearSelection(),
  );

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
    () => isRejectedQueue ? [
      {
        id: 'send-to-review',
        label: SEND_TO_REVIEW_LABEL,
        icon: RotateCcw,
        onClick: (rows) => sendToReview(rows.map((row) => row.id)),
      },
    ] : [
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
    [openDetail, isRejectedQueue, sendToReview],
  );

  // Mismo gobierno que el detalle: sin flag o sin rol, la columna no ofrece el botón.
  const canRevealPhone = phoneRevealEnabled && phoneRevealAuthorized;

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
      // ── Contacto ──
      {
        id: 'contact_email',
        accessorFn: (row) => row.email ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Correo" />,
        cell: ({ row }) => <EmailCell candidate={row.original} />,
        size: 200,
        minSize: 150,
        meta: { label: 'Correo', popoverTitle: 'Correo', group: CONTACT_GROUP, hiddenByDefault: true, disableFilter: true },
      },
      {
        id: 'contact_phone',
        accessorFn: (row) => row.phone ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Teléfono" />,
        cell: ({ row }) => <PhoneCell candidate={row.original} />,
        size: 150,
        minSize: 120,
        meta: { label: 'Teléfono', popoverTitle: 'Teléfono', group: CONTACT_GROUP, hiddenByDefault: true, disableFilter: true },
      },
      {
        id: 'contact_phone_reveal',
        accessorFn: (row) => row.phone_reveal_status ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Revelar teléfono" />,
        cell: ({ row }) => (
          <PhoneRevealCell candidate={row.original} canReveal={canRevealPhone} onOpen={openDetail} />
        ),
        size: 140,
        minSize: 120,
        meta: {
          label: 'Revelar teléfono',
          popoverTitle: 'Revelar teléfono',
          group: CONTACT_GROUP,
          hiddenByDefault: true,
          disableFilter: true,
        },
      },
      {
        id: 'contact_linkedin',
        accessorFn: (row) => (row.linkedin_url ? 1 : 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LinkedIn" />,
        cell: ({ row }) => <LinkedinCell candidate={row.original} />,
        size: 110,
        minSize: 100,
        meta: { label: 'LinkedIn', popoverTitle: 'LinkedIn', group: CONTACT_GROUP, hiddenByDefault: true, disableFilter: true },
      },
      // ── Empresa ──
      {
        id: 'company_domain',
        accessorFn: (row) => row.company_domain ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dominio de la empresa" />,
        cell: ({ row }) => <CompanyDomainCell candidate={row.original} />,
        size: 170,
        minSize: 130,
        meta: {
          label: 'Dominio de la empresa',
          popoverTitle: 'Dominio de la empresa',
          group: COMPANY_GROUP,
          hiddenByDefault: true,
          disableFilter: true,
        },
      },
      {
        id: 'company_website',
        accessorFn: (row) => row.company_website ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Página web de la empresa" />,
        cell: ({ row }) => <CompanyWebsiteCell candidate={row.original} />,
        size: 190,
        minSize: 140,
        meta: {
          label: 'Página web de la empresa',
          popoverTitle: 'Página web de la empresa',
          group: COMPANY_GROUP,
          hiddenByDefault: true,
          disableFilter: true,
        },
      },
      {
        id: 'company_hubspot_id',
        accessorFn: (row) => row.hubspot_company_id ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="HubSpot ID empresa" />,
        cell: ({ row }) => <HubspotCompanyIdCell candidate={row.original} portalId={hubspotPortalId} />,
        size: 150,
        minSize: 120,
        meta: {
          label: 'HubSpot ID empresa',
          popoverTitle: 'HubSpot ID empresa',
          group: COMPANY_GROUP,
          hiddenByDefault: true,
          disableFilter: true,
        },
      },
    ],
    [openDetail, canRevealPhone, hubspotPortalId],
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
          noun={
            queue === 'duplicates'
              ? ['candidato duplicado', 'candidatos duplicados']
              : queue === 'rejected'
                ? ['contacto rechazado', 'contactos rechazados']
                : ['candidato por revisar', 'candidatos por revisar']
          }
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
      variant={isRejectedQueue ? 'rejected' : 'review'}
    />
    </>
  );
}
