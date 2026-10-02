import { Suspense } from 'react';
import { Lock } from '@/icons';
import { PageHeader } from '@/components/shared/page-header';
import { MetricCard, type MetricTone } from '@/components/shared/metric-card';
import { InfoHint } from '@/components/shared/info-hint';
import { EmptyState } from '@/components/ui/empty-state';
import { TabsContent } from '@/components/ui/tabs';
import { UrlTabs, type UrlTab } from '@/components/navigation/url-tabs';
import { CostValue } from '@/components/shared/cost-value';
import { FiltersClient } from './filters-client';
import { USAGE_FILTER_KEYS, type UsageFilterValues } from './usage-filters-core';
import { formatCount, formatUsd } from './usage-labels';
import {
  AgentUsageSection,
  ProviderUsageSection,
  RecentActivitySection,
  TeamUsageSection,
} from './usage-tables';
import { AgentUsageCharts, ProviderUsageCharts, TeamUsageCharts } from './usage-charts';
import {
  Agent1EffectivenessPanel,
  Agent1EffectivenessPanelSkeleton,
} from './agent1-effectiveness-panel';
import {
  PhoneSuppressionNotEvaluablePanel,
  PhoneSuppressionNotEvaluablePanelSkeleton,
} from './phone-suppression-monitoring-card';
import type { Agent1EffectivenessFilters } from '@/modules/agent1-effectiveness';
import {
  getAiUsageSummary,
  getAgentStats,
  getProviderStats,
  getRecentProviderLogs,
  getDistinctFilterOptions,
  getUserConsumption,
} from '@/modules/ai-usage/queries';
import type { UsageFilters } from '@/modules/ai-usage/queries';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';

// Q3F-5AY.7B — post-backfill UI parity.
//
// This route reads live admin data (prospect_batches → prospect_candidates →
// provider_usage_logs) whose values change out-of-band from deploys — e.g. the
// Q3F-5AY.7 backfill populated prospect_candidates.record_origin directly in the
// DB with no code change. Dynamic rendering alone (from awaiting searchParams)
// does NOT keep the underlying reads fresh: fetches can still be served from the
// Data Cache, so the "Fuente de clasificación" panel kept showing the stale
// pre-backfill state (Persistido 0 / Derivado 182). `force-dynamic` renders per
// request AND forces every fetch to `no-store` (Next 16 route segment config),
// guaranteeing the persisted classification is reflected. Matches the repo's
// convention for live admin surfaces (see source-catalog). No DB write.
export const dynamic = 'force-dynamic';

const RECENT_LOGS_LIMIT = 25;

// Las pestañas de la página. La primera es la de por defecto y no va en la URL.
const USAGE_TABS: readonly UrlTab[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'agente-1', label: 'Agente 1' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'equipo', label: 'Equipo' },
  { id: 'detalle', label: 'Detalle' },
];

/**
 * Maps the shared /ai-usage period filter to the Agent 1 read-model's dateFrom
 * (prospect_batches.created_at). 'all'/unset → no lower bound. Only the two
 * filters that map cleanly (period → date range, provider → providerKey) are
 * forwarded; user/role/group/agent/status don't apply to the batch model and
 * are intentionally left for a later milestone.
 */
function periodToDateFrom(period: UsageFilters['period']): string | undefined {
  const now = Date.now();
  if (period === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (period === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (period === 'current_month') {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  }
  return undefined;
}

interface SummaryMetric {
  title: string;
  description: string;
  value: React.ReactNode;
  tone: MetricTone;
  hint?: string;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export default async function AIUsagePage({ searchParams }: PageProps) {
  const params = await searchParams;

  const filters: UsageFilters = {
    period: (params.period as UsageFilters['period']) || undefined,
    provider: typeof params.provider === 'string' ? params.provider : undefined,
    agent: typeof params.agent === 'string' ? params.agent : undefined,
    status: typeof params.status === 'string' ? params.status : undefined,
    user: typeof params.user === 'string' ? params.user : undefined,
    role: typeof params.role === 'string' ? params.role : undefined,
    groupId: typeof params.groupId === 'string' ? params.groupId : undefined,
  };

  // Agent 1 effectiveness read model uses a batch-scoped filter shape. Forward
  // only the cleanly-mapping filters (date range + provider).
  const agent1Filters: Agent1EffectivenessFilters = {
    dateFrom: periodToDateFrom(filters.period),
    providerKey: filters.provider,
  };

  const [summary, agentStats, providerStats, recentLogs, filterOptions, userConsumption] =
    await Promise.all([
      getAiUsageSummary(filters),
      getAgentStats(filters),
      getProviderStats(filters),
      getRecentProviderLogs(RECENT_LOGS_LIMIT, filters),
      getDistinctFilterOptions(),
      getUserConsumption(filters),
    ]);

  const header = (
    <PageHeader
      title="Uso de IA, costos y efectividad"
      description="Qué han hecho los agentes, cuánto ha costado y cuántos prospectos terminaron aprobados."
      actions={
        <InfoHint label="Cómo se mide" showLabel>
          Las cifras se registran solas cada vez que un agente trabaja. Los costos son
          estimados con la tarifa configurada de cada proveedor; el valor real sale de la
          factura.
        </InfoHint>
      }
    />
  );

  if (summary === null) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Lock}
          title="No tienes acceso a estas cifras"
          description="El consumo y los costos solo los ve quien administra SellUp. Pide acceso a una persona administradora."
        />
      </div>
    );
  }

  const filterValues = Object.fromEntries(
    USAGE_FILTER_KEYS.map((key) => [key, readParam(params[key])]),
  ) as UsageFilterValues;
  const hasFilters = USAGE_FILTER_KEYS.some((key) => filterValues[key] !== '');
  const hasData = summary.total_executions > 0 || summary.total_provider_calls > 0;
  const errorCount = summary.error_provider_calls + summary.failed_executions;
  const providerNoun = summary.distinct_providers === 1 ? 'proveedor' : 'proveedores';

  const metrics: SummaryMetric[] = [
    {
      title: 'Costo estimado',
      description: 'USD en el periodo',
      tone: 'brand',
      value: (
        <CostValue
          display={resolveCostDisplay({
            valueUsd: summary.total_estimated_cost_usd,
            costTruth: toCostTruth(summary.has_unknown_cost),
            formatUsd: (value) => formatUsd(value),
          })}
        />
      ),
    },
    {
      title: 'Ejecuciones',
      description: 'veces que trabajó un agente',
      tone: 'brand',
      value: formatCount(summary.total_executions),
    },
    {
      title: 'Consultas',
      description: `a ${formatCount(summary.distinct_providers)} ${providerNoun}`,
      tone: 'brand',
      value: formatCount(summary.total_provider_calls),
    },
    {
      title: 'Costo medio',
      description: 'por ejecución',
      tone: 'brand',
      value: summary.avg_cost_per_run !== null ? formatUsd(summary.avg_cost_per_run, 4) : '—',
    },
    {
      title: 'Errores',
      description: errorCount > 0 ? 'consultas y ejecuciones fallidas' : 'todo salió bien',
      tone: errorCount > 0 ? 'negative' : 'positive',
      value: formatCount(errorCount),
      hint: 'Suma las consultas a proveedores que fallaron y las ejecuciones de agentes que no terminaron.',
    },
    {
      title: 'En curso',
      description: summary.running_executions > 0 ? 'agentes trabajando ahora' : 'ningún agente trabajando',
      tone: summary.running_executions > 0 ? 'info' : 'neutral',
      value: formatCount(summary.running_executions),
    },
  ];

  return (
    <div className="space-y-6">
      {header}

      {filterOptions && <FiltersClient options={filterOptions} values={filterValues} />}

      {!hasData && (
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? 'No hay actividad con estos filtros. Quita alguno para ver más.'
            : 'Aún no hay actividad. Las cifras aparecerán solas cuando alguien busque prospectos con IA.'}
        </p>
      )}

      <section aria-label="Indicadores del periodo" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.title}
            compact
            title={metric.title}
            description={metric.description}
            value={metric.value}
            tone={metric.tone}
            hint={metric.hint}
          />
        ))}
      </section>

      <UrlTabs ariaLabel="Secciones de uso de IA" tabs={USAGE_TABS} initialTab={readParam(params.tab)}>
        <TabsContent value="resumen" className="space-y-6">
          <AgentUsageCharts agents={agentStats ?? []} />
          <AgentUsageSection agents={agentStats ?? []} />
        </TabsContent>

        <TabsContent value="agente-1">
          <Suspense fallback={<Agent1EffectivenessPanelSkeleton />}>
            <Agent1EffectivenessPanel filters={agent1Filters} />
          </Suspense>
        </TabsContent>

        <TabsContent value="proveedores" className="space-y-6">
          <ProviderUsageCharts providers={providerStats ?? []} />
          <ProviderUsageSection providers={providerStats ?? []} />
        </TabsContent>

        <TabsContent value="equipo" className="space-y-6">
          <TeamUsageCharts users={userConsumption ?? []} />
          <TeamUsageSection users={userConsumption} />
        </TabsContent>

        <TabsContent value="detalle" className="space-y-6">
          <RecentActivitySection logs={recentLogs ?? []} limit={RECENT_LOGS_LIMIT} />
          <Suspense fallback={<PhoneSuppressionNotEvaluablePanelSkeleton />}>
            <PhoneSuppressionNotEvaluablePanel />
          </Suspense>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
