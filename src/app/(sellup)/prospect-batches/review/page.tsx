import {
  ClipboardList,
  Globe2,
  Layers,
  Copy,
  CalendarClock,
  Info,
  Building2,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { getPendingReviewQueue } from '@/modules/prospect-review';
import type { PendingReviewFilters, ConfidenceBand } from '@/modules/prospect-review';
import { ReviewFiltersClient } from './review-filters-client';
import { ReviewQueueClient } from './review-queue-client';

// Q3F-5AZ.2A — Pending Review Queue (read-only).
//
// Reads live admin data (prospect_candidates → prospect_batches) whose values
// change out-of-band from deploys (e.g. the Q3F-5AY.7 classification backfill
// wrote record_origin directly in the DB). `force-dynamic` renders per request
// AND forces every fetch to `no-store` (Next 16 route segment config), so the
// queue always reflects the current DB. Matches the /ai-usage convention. This
// surface is READ-ONLY: no approve/discard/convert/enrich. No DB writes.
export const dynamic = 'force-dynamic';

const CONFIDENCE_BANDS: ConfidenceBand[] = ['high', 'medium', 'low'];

function parseConfidence(value: string | undefined): ConfidenceBand | undefined {
  return value && (CONFIDENCE_BANDS as string[]).includes(value)
    ? (value as ConfidenceBand)
    : undefined;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function PendingReviewQueuePage({ searchParams }: PageProps) {
  const params = await searchParams;

  const filters: PendingReviewFilters = {
    countryCode: str(params.country),
    industry: str(params.industry),
    batchId: str(params.batch),
    confidenceBand: parseConfidence(str(params.confidence)),
    duplicateStatus: str(params.duplicate),
  };

  const result = await getPendingReviewQueue(filters);
  const nowISO = new Date().toISOString();

  const header = (
    <PageHeader
      title="Revisión de prospectos pendientes"
      description="Candidatos limpios generados por Agente 1 que requieren decisión humana."
      actions={
        result.status === 'ok' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-500">
            <ClipboardList className="h-3 w-3" />
            {result.data.summary.totalPending} pendiente
            {result.data.summary.totalPending !== 1 ? 's' : ''}
          </span>
        ) : undefined
      }
    />
  );

  // ── Restricted (non-admin) ──────────────────────────────────────────────
  if (result.status === 'restricted') {
    return (
      <div className="space-y-8">
        {header}
        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Esta vista requiere permisos de administrador para mostrar la cola de revisión.
          </p>
        </div>
      </div>
    );
  }

  // ── Error (safe fallback) ───────────────────────────────────────────────
  if (result.status === 'error') {
    return (
      <div className="space-y-8">
        {header}
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            No se pudo cargar la cola de revisión en este momento. Inténtalo de nuevo más tarde.
          </p>
        </div>
      </div>
    );
  }

  const { summary, options, candidates, batchesById } = result.data;

  const ageSub =
    summary.oldestAgeDays != null && summary.newestAgeDays != null
      ? `Rango ${summary.newestAgeDays}–${summary.oldestAgeDays} días`
      : 'Sin datos de fecha';

  const kpis = [
    {
      label: 'Pendientes limpios',
      value: String(summary.totalPending),
      sub: `${summary.reviewed} revisados`,
      icon: ClipboardList,
      iconBg: 'bg-su-brand-soft',
      accent: 'text-foreground',
    },
    {
      label: 'Países',
      value: String(summary.countries),
      sub: `${summary.batches} lote${summary.batches !== 1 ? 's' : ''}`,
      icon: Globe2,
      iconBg: 'bg-muted/40',
      accent: 'text-foreground',
    },
    {
      label: 'Industrias',
      value: String(summary.industries),
      sub: 'sectores distintos',
      icon: Layers,
      iconBg: 'bg-muted/40',
      accent: 'text-foreground',
    },
    {
      label: 'Posibles duplicados',
      value: String(summary.possibleDuplicates),
      sub: `${summary.hubspotMatches} match HubSpot`,
      icon: Copy,
      iconBg: summary.possibleDuplicates > 0 ? 'bg-amber-500/10' : 'bg-muted/40',
      accent: summary.possibleDuplicates > 0 ? 'text-amber-500' : 'text-foreground',
    },
    {
      label: 'Edad promedio',
      value: summary.avgAgeDays != null ? `${summary.avgAgeDays}d` : '—',
      sub: ageSub,
      icon: CalendarClock,
      iconBg: 'bg-muted/40',
      accent: 'text-foreground',
    },
  ];

  const activeFiltersCount = [
    filters.countryCode,
    filters.industry,
    filters.batchId,
    filters.confidenceBand,
    filters.duplicateStatus,
  ].filter(Boolean).length;

  return (
    <div className="space-y-8">
      {header}

      {/* Contextual banner */}
      <div className="flex items-start gap-3 rounded-xl border border-su-brand/20 bg-su-brand/5 px-4 py-3">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Cola de revisión de candidatos de producción del Agente 1 en estado{' '}
          <strong className="font-medium text-foreground">por revisar</strong>. Ya puedes{' '}
          <strong className="font-medium text-foreground">aprobar</strong> un candidato (sin
          convertir a cuenta ni enviar a HubSpot). Descarte, duplicado y enriquecimiento se
          habilitarán en el siguiente hito.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map((card) => (
          <MetricCard
            key={card.label}
            title={card.label}
            description={card.sub}
            value={card.value}
            valueClassName={`font-mono ${card.accent}`}
            iconPosition="top"
            icon={
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.iconBg}`}>
                <card.icon className={`h-4 w-4 ${card.accent}`} />
              </div>
            }
          />
        ))}
      </div>

      {/* Filters */}
      <SurfaceCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReviewFiltersClient
            options={options}
            currentCountry={filters.countryCode ?? ''}
            currentIndustry={filters.industry ?? ''}
            currentBatch={filters.batchId ?? ''}
            currentConfidence={filters.confidenceBand ?? ''}
            currentDuplicate={filters.duplicateStatus ?? ''}
          />
          <span className="text-[10px] text-muted-foreground">
            {candidates.length} de {summary.totalPending} candidato
            {summary.totalPending !== 1 ? 's' : ''}
            {activeFiltersCount > 0
              ? ` · ${activeFiltersCount} filtro${activeFiltersCount !== 1 ? 's' : ''} activo${
                  activeFiltersCount !== 1 ? 's' : ''
                }`
              : ''}
          </span>
        </div>
      </SurfaceCard>

      {/* Queue */}
      <ReviewQueueClient
        candidates={candidates}
        batchesById={batchesById}
        totalPending={summary.totalPending}
        nowISO={nowISO}
      />
    </div>
  );
}
