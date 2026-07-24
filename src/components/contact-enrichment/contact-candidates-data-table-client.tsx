'use client';

import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Link2, Building2, Globe, UserSearch } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { DataTable, DataTableColumnHeader, type DataTableBulkAction } from '@/components/data-table';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { ContactCandidateDetailSheet } from '@/components/contact-enrichment/contact-candidate-detail-sheet';
import type {
  PendingContactCandidate,
  ContactRelevanceStatus,
  ContactSource,
} from '@/modules/contact-enrichment/types';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import {
  ScopeFilterDrawerSection,
  type ScopeFilterState,
} from '@/components/shared/scope-filters-client';

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
  high_relevance: 'bg-emerald-500',
  medium_relevance: 'bg-su-brand',
  low_relevance: 'bg-amber-500',
  not_relevant: 'bg-border',
  insufficient_data: 'bg-border',
};

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Convierte un score 0–1 en porcentaje legible; null si no hay dato. */
function toPercent(score: number | undefined): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  const normalized = score > 1 ? score : score * 100;
  return `${Math.round(normalized)}%`;
}

// ── Cells ───────────────────────────────────────────────────────

function NameCell({ candidate }: { candidate: PendingContactCandidate }) {
  // Design Refresh v1: 2 líneas máximo. LinkedIn pasa a icono junto al nombre;
  // el canal secundario (email > teléfono) va en una sola línea legible.
  // El detalle completo vive en el side panel del candidato.
  const secondary = candidate.email ?? candidate.phone ?? null;
  return (
    <div className="min-w-0 max-w-[260px] space-y-0.5">
      <div className="flex items-center gap-1.5">
        <p className="truncate text-sm font-semibold text-foreground">
          {candidate.full_name || 'Sin nombre'}
        </p>
        {candidate.linkedin_url && (
          <a
            href={
              candidate.linkedin_url.startsWith('http')
                ? candidate.linkedin_url
                : `https://${candidate.linkedin_url}`
            }
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Perfil de LinkedIn"
            className="shrink-0 text-su-brand transition-colors hover:text-su-brand/70"
            onClick={(e) => e.stopPropagation()}
          >
            <Link2 className="h-3 w-3" />
          </a>
        )}
      </div>
      {secondary && (
        <p className="truncate text-[11px] text-muted-foreground">{secondary}</p>
      )}
    </div>
  );
}

function RelevanceCell({ candidate }: { candidate: PendingContactCandidate }) {
  const relevance = candidate.enrichment_metadata?.relevance;
  const status = relevance?.status;
  const scoreLabel = toPercent(relevance?.score);

  if (!status) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }

  return (
    <span className="flex w-fit items-center gap-1.5 text-xs text-foreground/85">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RELEVANCE_DOTS[status]}`} />
      {RELEVANCE_LABELS[status] ?? status}
      {scoreLabel && (
        <span className="tabular-nums text-muted-foreground/80">· {scoreLabel}</span>
      )}
    </span>
  );
}

function QualityCell({ candidate }: { candidate: PendingContactCandidate }) {
  const qualityLabel = toPercent(candidate.enrichment_metadata?.relevance?.quality_score);
  if (!qualityLabel) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  return (
    <span className="text-xs text-muted-foreground tabular-nums">{qualityLabel}</span>
  );
}

// ── Main component ──────────────────────────────────────────────

interface ContactCandidatesDataTableClientProps {
  candidates: PendingContactCandidate[];
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
}

export function ContactCandidatesDataTableClient({
  candidates,
  accountOwners,
  scopeFilterOptions,
  phoneRevealEnabled = false,
  phoneRevealAuthorized = false,
}: ContactCandidatesDataTableClientProps) {
  // Side panel de detalle (ajuste posterior a 17A.4A): click en fila abre un
  // drawer read-only con el detalle del candidato. Solo lectura — sin acciones.
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const [scopeFilter, setScopeFilter] = React.useState<ScopeFilterState>({
    userId: '',
    groupId: '',
    roleKey: '',
  });

  const filteredCandidates = React.useMemo(() => {
    if (!scopeFilterOptions?.showScopeFilters || !accountOwners) return candidates;
    const { userId, groupId, roleKey } = scopeFilter;
    if (!userId && !groupId && !roleKey) return candidates;
    const allowedUserIds = new Set(
      scopeFilterOptions.users
        .filter((u) => {
          if (roleKey && u.role_key !== roleKey) return false;
          if (groupId) {
            if (!u.group_id) return false;
            const inSubtree = (gid: string): boolean => {
              if (gid === groupId) return true;
              const g = scopeFilterOptions.groups.find((x) => x.id === gid);
              return g?.parent_group_id ? inSubtree(g.parent_group_id) : false;
            };
            if (!inSubtree(u.group_id)) return false;
          }
          return true;
        })
        .map((u) => u.id),
    );
    return candidates.filter((c) => {
      const ownerId = c.account_id ? accountOwners.get(c.account_id) : undefined;
      if (!ownerId) return false;
      if (userId) return ownerId === userId;
      return allowedUserIds.has(ownerId);
    });
  }, [candidates, scopeFilter, scopeFilterOptions, accountOwners]);

  const openDetail = React.useCallback((candidate: PendingContactCandidate) => {
    setDetailId(candidate.id);
    setDetailOpen(true);
  }, []);

  const bulkActions = React.useMemo<DataTableBulkAction<PendingContactCandidate>[]>(
    () => [
      {
        id: 'view-detail',
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
        cell: ({ row }) => <NameCell candidate={row.original} />,
        size: 260,
        minSize: 200,
        enableHiding: false,
        meta: { label: 'Nombre', popoverTitle: 'Nombre' },
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cargo" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground line-clamp-2 max-w-[200px]">
            {row.original.title ?? 'Sin cargo'}
          </span>
        ),
        size: 180,
        minSize: 140,
        meta: { label: 'Cargo', popoverTitle: 'Cargo' },
      },
      {
        id: 'company',
        accessorFn: (row) => row.company_name ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="min-w-0 max-w-[200px] space-y-0.5">
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                <Building2 className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="truncate">{c.company_name ?? 'Sin empresa'}</span>
              </span>
              {c.company_domain && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                  <Globe className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate max-w-[160px]">{c.company_domain}</span>
                </span>
              )}
            </div>
          );
        },
        size: 200,
        minSize: 150,
        meta: { label: 'Empresa', popoverTitle: 'Empresa' },
      },
      {
        id: 'source',
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fuente" />,
        cell: ({ row }) => (
          <Badge className="border-0 bg-muted text-muted-foreground text-[10px] font-semibold py-0.5">
            {SOURCE_LABELS[row.original.source] ?? row.original.source}
          </Badge>
        ),
        size: 100,
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
        size: 100,
        minSize: 80,
        enableColumnFilter: false,
        meta: { label: 'Calidad', popoverTitle: 'Calidad', disableFilter: true },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: () => (
          // Todas las filas de este tab comparten estado — texto plano, sin badge
          <span className="text-xs text-muted-foreground">Por revisar</span>
        ),
        size: 120,
        minSize: 100,
        enableColumnFilter: false,
        meta: { label: 'Estado', popoverTitle: 'Estado', disableFilter: true },
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Creado" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {row.original.created_at ? formatDate(row.original.created_at) : '—'}
          </span>
        ),
        size: 130,
        minSize: 110,
        meta: { label: 'Creado', popoverTitle: 'Fecha de creación' },
      },
    ],
    [],
  );

  return (
    <>
    <DataTable
      columns={columns}
      data={filteredCandidates}
      getRowId={(row) => row.id}
      title="Candidatos por revisar"
      description="Perfiles encontrados por el Agente de contactos que pasaron el filtro de relevancia y esperan revisión humana."
      count={filteredCandidates.length}
      settingsExtraSections={
        scopeFilterOptions?.showScopeFilters ? (
          <ScopeFilterDrawerSection
            scopeFilterOptions={scopeFilterOptions}
            value={scopeFilter}
            onChange={setScopeFilter}
          />
        ) : undefined
      }
      enableRowSelection
      bulkActions={bulkActions}
      enableColumnReorder
      initialPageSize={20}
      fillHeight
      rowClickable
      onRowClick={openDetail}
      emptyState={
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 rounded-full bg-muted/60 p-3">
            <UserSearch className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-foreground">No hay candidatos por revisar.</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Cuando el Agente de contactos encuentre perfiles relevantes, aparecerán aquí.
          </p>
          <div className="mt-4">
            <ContactsEnrichmentCTA />
          </div>
        </div>
      }
    />
    <ContactCandidateDetailSheet
      candidateId={detailId}
      open={detailOpen}
      onClose={() => setDetailOpen(false)}
      phoneRevealEnabled={phoneRevealEnabled}
      phoneRevealAuthorized={phoneRevealAuthorized}
    />
    </>
  );
}
