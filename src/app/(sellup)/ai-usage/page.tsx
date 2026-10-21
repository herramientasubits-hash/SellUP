import { Suspense } from 'react';
import { Lock } from '@/icons';
import { PageHeader } from '@/components/shared/page-header';
import { MetricCard, type MetricTone } from '@/components/shared/metric-card';
import { InfoHint } from '@/components/shared/info-hint';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TabsContent } from '@/components/ui/tabs';
import { UrlTabs, type UrlTab } from '@/components/navigation/url-tabs';
import { CostValue } from '@/components/shared/cost-value';
import { FiltersClient } from './filters-client';
import { USAGE_FILTER_KEYS, toQueryString, type UsageFilterValues } from './usage-filters-core';
import { formatCount, formatUsd } from './usage-labels';
import {
  AgentUsageSection,
  ProviderUsageSection,
  RecentActivitySection,
  TeamUsageSection,
} from './usage-tables';
import { AgentUsageCharts, ProviderUsageCharts, TeamUsageCharts } from './usage-charts';
import {
  BreakdownSkeleton,
  CountryBreakdownSection,
  RoleGroupBreakdownSection,
  SearchBreakdownSection,
} from './breakdown-sections';
import {
  Agent1EffectivenessPanel,
  Agent1EffectivenessPanelSkeleton,
} from './agent1-effectiveness-panel';
import { Agent3ResultsPanel, Agent3ResultsPanelSkeleton } from './agent3-results-panel';
import {
  PhoneSuppressionNotEvaluablePanel,
  PhoneSuppressionNotEvaluablePanelSkeleton,
} from './phone-suppression-monitoring-card';
import type { Agent1EffectivenessFilters } from '@/modules/agent1-effectiveness';
import {
  getAiUsageOverview,
  getDistinctFilterOptions,
  resolveUsagePeopleScope,
} from '@/modules/ai-usage/queries';
import type { FilterOptions, UsageFilters } from '@/modules/ai-usage/queries';
import { getAiUsageBreakdowns } from '@/modules/ai-usage/breakdown-queries';
import { withAgent1CompanyOutcomes } from '@/modules/ai-usage/usage-breakdowns';
import { resolvePeriodStart } from '@/modules/ai-usage/usage-filter-semantics';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import { AgentDrilldown } from './agent-drilldown';

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
// El Agente 1 ya no tiene pestaña propia: vive en «Por agente» (`?agente=agent1`).
const USAGE_TABS: readonly UrlTab[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'por-agente', label: 'Por agente' },
  { id: 'por-pais', label: 'Por país' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'equipo', label: 'Equipo' },
  { id: 'por-rol-grupo', label: 'Por rol y grupo' },
  { id: 'por-busqueda', label: 'Por búsqueda' },
  { id: 'detalle', label: 'Detalle' },
];

/**
 * Filtros del panel del Agente 1 (modelo por lotes: prospect_batches).
 *   - periodo   → dateFrom, calculado en America/Bogota igual que el resto;
 *   - proveedor → providerKey (filas de costo);
 *   - persona / rol / grupo → createdByIds (lotes de esas personas).
 * Agente y estado no aplican a un modelo por lotes del Agente 1.
 */
async function buildAgent1Filters(filters: UsageFilters): Promise<Agent1EffectivenessFilters> {
  const hasPeopleFilter = Boolean(filters.user || filters.role || filters.groupId);
  let createdByIds: string[] | undefined;
  try {
    const people = await resolveUsagePeopleScope(filters);
    createdByIds = Array.isArray(people) ? people : undefined;
  } catch (err) {
    // Sin poder resolver las personas, un filtro de persona no se ignora: no
    // se muestra nada antes que mostrar lotes de otra gente.
    console.error('[ai-usage] people scope for Agent 1 panel failed:', err);
    createdByIds = hasPeopleFilter ? [] : undefined;
  }
  return {
    dateFrom: resolvePeriodStart(filters.period) ?? undefined,
    providerKey: filters.provider,
    countryCode: filters.country,
    createdByIds,
  };
}

async function loadFilterOptions(): Promise<FilterOptions | null | 'error'> {
  try {
    return await getDistinctFilterOptions();
  } catch (err) {
    console.error('[ai-usage] filter options read failed:', err);
    return 'error';
  }
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
  // Enlaces viejos a la pestaña «Agente 1» abren «Por agente» con el Agente 1 elegido.
  const requestedTab = readParam(params.tab);
  const initialTab = requestedTab === 'agente-1' ? 'por-agente' : requestedTab;
  const initialAgent = requestedTab === 'agente-1' ? 'agent1' : readParam(params.agente);

  const filters: UsageFilters = {
    period: (params.period as UsageFilters['period']) || undefined,
    provider: typeof params.provider === 'string' ? params.provider : undefined,
    agent: typeof params.agent === 'string' ? params.agent : undefined,
    status: typeof params.status === 'string' ? params.status : undefined,
    user: typeof params.user === 'string' ? params.user : undefined,
    role: typeof params.role === 'string' ? params.role : undefined,
    groupId: typeof params.groupId === 'string' ? params.groupId : undefined,
    country: typeof params.country === 'string' ? params.country : undefined,
    industry: typeof params.industry === 'string' ? params.industry : undefined,
    step: typeof params.step === 'string' ? params.step : undefined,
    mode: typeof params.mode === 'string' ? params.mode : undefined,
  };

  // Todas las cifras salen de una sola lectura del universo filtrado (KPIs,
  // agentes, proveedores, personas y últimas consultas), así cuadran entre sí.
  const [overview, filterOptionsResult, agent1Filters, breakdowns] = await Promise.all([
    getAiUsageOverview(filters, RECENT_LOGS_LIMIT),
    loadFilterOptions(),
    buildAgent1Filters(filters),
    // En caché por petición: las secciones de abajo reutilizan la misma lectura.
    getAiUsageBreakdowns(filters),
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

  if (overview === null) {
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

  const { summary, providerStats, userConsumption, recentLogs, agentSteps, moneyVisible, dataQuality } = overview;
  const agentStats = withAgent1CompanyOutcomes(
    overview.agentStats,
    breakdowns && !breakdowns.dataQuality.readError ? breakdowns.countryTools : null,
  );
  const filterOptions = filterOptionsResult === 'error' ? null : filterOptionsResult;
  const readError = dataQuality.readError || filterOptionsResult === 'error';

  const filterValues = Object.fromEntries(
    USAGE_FILTER_KEYS.map((key) => [key, readParam(params[key])]),
  ) as UsageFilterValues;
  const hasFilters = USAGE_FILTER_KEYS.some((key) => filterValues[key] !== '');
  const hasData = summary.total_executions > 0 || summary.total_provider_calls > 0;
  const errorCount = summary.error_provider_calls + summary.failed_executions;
  const providerNoun = summary.distinct_providers === 1 ? 'proveedor' : 'proveedores';

  // Quien no ve dólares (vendedores) ve créditos: el servidor ya no le manda importes.
  const knownCredits = providerStats.reduce((total, p) => total + (p.total_credits_used ?? 0), 0);
  const moneyMetric: SummaryMetric = moneyVisible
    ? {
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
      }
    : {
        title: 'Créditos usados',
        description: 'créditos conocidos en el periodo',
        tone: 'brand',
        value: formatCount(knownCredits),
      };

  const metrics: SummaryMetric[] = [
    moneyMetric,
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
    ...(moneyVisible
      ? [
          {
            title: 'Costo medio',
            description: 'por ejecución',
            tone: 'brand' as const,
            value: summary.avg_cost_per_run !== null ? formatUsd(summary.avg_cost_per_run, 4) : '—',
          },
        ]
      : []),
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

      {readError && (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron leer todas las cifras</AlertTitle>
          <AlertDescription>
            Lo que ves puede estar incompleto. Vuelve a cargar la página en unos minutos.
          </AlertDescription>
        </Alert>
      )}

      {dataQuality.truncated && (
        <Alert variant="warning" role="note">
          <AlertTitle>Las cifras pueden quedarse cortas</AlertTitle>
          <AlertDescription>
            Hay más registros de los que se pueden leer de una vez. Elige un periodo más corto o
            añade un filtro para ver cifras completas.
          </AlertDescription>
        </Alert>
      )}

      {!hasData && !readError && (
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

      <UrlTabs ariaLabel="Secciones de uso de IA" tabs={USAGE_TABS} initialTab={initialTab}>
        <TabsContent value="resumen" className="space-y-6">
          {moneyVisible && <AgentUsageCharts agents={agentStats} />}
          <AgentUsageSection agents={agentStats} showMoney={moneyVisible} />
        </TabsContent>

        <TabsContent value="por-agente" className="space-y-6">
          <AgentDrilldown
            agents={agentSteps.agents}
            steps={agentSteps.steps}
            moneyVisible={moneyVisible}
            initialAgent={initialAgent}
            details={{
              agent1: moneyVisible ? (
                <Suspense fallback={<Agent1EffectivenessPanelSkeleton />}>
                  <Agent1EffectivenessPanel filters={agent1Filters} />
                </Suspense>
              ) : (
                <EmptyState
                  icon={Lock}
                  title="El panel del Agente 1 es de costos"
                  description="Las cifras en dólares las ven líderes y administración. Lo que entregó el Agente 1 lo tienes en «Por país» y «Por búsqueda»."
                />
              ),
              // Rumbo: qué se usó y qué pasó (sin dinero, lo ve quien ve la página).
              agent3: (
                <Suspense fallback={<Agent3ResultsPanelSkeleton />}>
                  <Agent3ResultsPanel filters={{ period: filters.period, country: filters.country }} />
                </Suspense>
              ),
            }}
          />
        </TabsContent>

        <TabsContent value="por-pais" className="space-y-6">
          <Suspense fallback={<BreakdownSkeleton />}>
            <CountryBreakdownSection filters={filters} />
          </Suspense>
        </TabsContent>

        <TabsContent value="proveedores" className="space-y-6">
          {moneyVisible && <ProviderUsageCharts providers={providerStats} />}
          <ProviderUsageSection providers={providerStats} showMoney={moneyVisible} />
        </TabsContent>

        <TabsContent value="equipo" className="space-y-6">
          {moneyVisible && <TeamUsageCharts users={userConsumption} />}
          <TeamUsageSection users={userConsumption} showMoney={moneyVisible} />
        </TabsContent>

        <TabsContent value="por-rol-grupo" className="space-y-6">
          <Suspense fallback={<BreakdownSkeleton />}>
            <RoleGroupBreakdownSection filters={filters} currentQuery={toQueryString('', filterValues)} />
          </Suspense>
        </TabsContent>

        <TabsContent value="por-busqueda" className="space-y-6">
          <Suspense fallback={<BreakdownSkeleton />}>
            <SearchBreakdownSection filters={filters} />
          </Suspense>
        </TabsContent>

        <TabsContent value="detalle" className="space-y-6">
          <RecentActivitySection logs={recentLogs} limit={RECENT_LOGS_LIMIT} showMoney={moneyVisible} />
          <Suspense fallback={<PhoneSuppressionNotEvaluablePanelSkeleton />}>
            <PhoneSuppressionNotEvaluablePanel />
          </Suspense>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
