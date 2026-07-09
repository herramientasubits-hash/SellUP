import {
  Bot,
  Plug,
  DollarSign,
  Zap,
  TrendingUp,
  Info,
  AlertCircle,
  CheckCircle2,
  Activity,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { FiltersClient } from './filters-client';
import {
  getAiUsageSummary,
  getAgentStats,
  getProviderStats,
  getRecentProviderLogs,
  getDistinctFilterOptions,
  getUserConsumption,
} from '@/modules/ai-usage/queries';
import type { UsageFilters } from '@/modules/ai-usage/queries';
import type { AgentStat, ProviderStat, ProviderUsageLog } from '@/modules/usage-tracking/types';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import { CostValue } from '@/components/shared/cost-value';

// ============================================================
// Display helpers
// ============================================================

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  prospect_generation: 'Generación y enriquecimiento de prospectos',
  account_intelligence: 'Inteligencia de cuenta',
  commercial_speech: 'Speech comercial',
  post_meeting_followup: 'Seguimiento post-reunión',
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  tavily: 'Tavily',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  samu_ia: 'Samu IA',
};

function agentDisplayName(stat: AgentStat): string {
  return AGENT_DISPLAY_NAMES[stat.agent_key] ?? stat.agent_name ?? stat.agent_key;
}

function providerDisplayName(providerKey: string): string {
  return PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
}

function formatCost(usd: number, decimals = 4): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;
  return new Date(isoDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================
// Status badge
// ============================================================

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string; dot: string }> = {
    completed:      { label: 'Completado',  classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', dot: 'bg-emerald-500' },
    running:        { label: 'En curso',    classes: 'border-su-brand/30 bg-su-brand/10 text-su-brand',         dot: 'bg-su-brand' },
    failed:         { label: 'Error',       classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    cancelled:      { label: 'Cancelado',   classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',   dot: 'bg-muted-foreground/25' },
    pending:        { label: 'Pendiente',   classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',       dot: 'bg-amber-500' },
    success:        { label: 'OK',          classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', dot: 'bg-emerald-500' },
    error:          { label: 'Error',       classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    rate_limited:   { label: 'Rate limit',  classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',       dot: 'bg-amber-500' },
    quota_exceeded: { label: 'Cuota',       classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    no_new_candidates: { label: 'Sin nuevos', classes: 'border-border/40 bg-muted/30 text-muted-foreground/60', dot: 'bg-muted-foreground/25' },
  };
  const cfg = map[status] ?? {
    label: status,
    classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',
    dot: 'bg-muted-foreground/25',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function EffectivenessBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-su-brand' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted/40">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium text-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ============================================================
// Empty state
// ============================================================

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <Activity className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

// ============================================================
// Sección 1 — Consumo por agente
// ============================================================

function AgentStatsTable({ agents }: { agents: AgentStat[] }) {
  if (agents.length === 0) {
    return <EmptyState message="Aún no hay ejecuciones de agentes registradas." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Agente', 'Ejec.', 'Generados', 'Aprobados', 'Efectividad', 'Costo est.', 'Costo/aprobado'].map((h) => (
              <th
                key={h}
                className={`pb-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${h === 'Agente' ? 'text-left' : 'text-right'} pr-4 last:pr-0`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {agents.map((a) => {
            const effectiveness =
              a.total_results_generated > 0
                ? (a.total_results_approved / a.total_results_generated) * 100
                : null;
            const costPerApproved =
              a.total_results_approved > 0
                ? a.total_estimated_cost_usd / a.total_results_approved
                : null;

            return (
              <tr key={a.agent_key}>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft">
                      <Bot className="h-3.5 w-3.5 text-su-brand" />
                    </div>
                    <span className="font-medium text-foreground">{agentDisplayName(a)}</span>
                  </div>
                </td>
                <td className="py-3 pr-4 text-right text-muted-foreground">{a.total_executions}</td>
                <td className="py-3 pr-4 text-right text-muted-foreground">{a.total_results_generated}</td>
                <td className="py-3 pr-4 text-right font-medium text-foreground">{a.total_results_approved}</td>
                <td className="py-3 pr-4">
                  <div className="flex justify-end">
                    {effectiveness !== null ? (
                      <EffectivenessBar pct={effectiveness} />
                    ) : (
                      <span className="text-muted-foreground/50 text-[10px]">Sin datos</span>
                    )}
                  </div>
                </td>
                <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                  {formatCost(a.total_estimated_cost_usd, 2)}
                </td>
                <td className="py-3 text-right font-mono text-muted-foreground">
                  {costPerApproved !== null
                    ? formatCost(costPerApproved)
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Sección 2 — Consumo por proveedor
// ============================================================

function providerMeasurementLabel(stat: ProviderStat): string {
  const hasCreditBased =
    (stat.total_credits_used ?? 0) > 0 &&
    stat.total_input_tokens === 0 &&
    stat.total_output_tokens === 0;
  const hasTokenBased = stat.total_input_tokens + stat.total_output_tokens > 0;

  if (hasCreditBased) return 'Créditos / consultas';
  if (hasTokenBased) return 'Tokens (in + out)';
  return 'Llamadas';
}

function providerMeasurementValue(stat: ProviderStat): string {
  const hasCreditBased =
    (stat.total_credits_used ?? 0) > 0 &&
    stat.total_input_tokens === 0 &&
    stat.total_output_tokens === 0;
  const hasTokenBased = stat.total_input_tokens + stat.total_output_tokens > 0;

  if (hasCreditBased && stat.total_credits_used !== null) {
    return stat.total_credits_used.toFixed(0);
  }
  if (hasTokenBased) {
    return (stat.total_input_tokens + stat.total_output_tokens).toLocaleString('es-ES');
  }
  return '—';
}

function ProviderStatsTable({ providers }: { providers: ProviderStat[] }) {
  if (providers.length === 0) {
    return <EmptyState message="Aún no hay llamadas a proveedores registradas." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Proveedor', 'Medición', 'Llamadas', 'Cantidad', 'Resultados', 'Costo est.', 'Último uso'].map((h) => (
              <th
                key={h}
                className={`pb-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${h === 'Proveedor' || h === 'Medición' ? 'text-left' : 'text-right'} pr-4 last:pr-0`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {providers.map((p) => (
            <tr key={p.provider_key}>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-foreground">
                    {providerDisplayName(p.provider_key)}
                  </span>
                </div>
              </td>
              <td className="py-3 pr-4 text-muted-foreground text-[11px]">
                {providerMeasurementLabel(p)}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{p.total_calls}</td>
              <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                {providerMeasurementValue(p)}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{p.total_results_returned}</td>
              <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                {p.total_estimated_cost_usd === 0 && !p.has_unknown_cost
                  ? <span className="text-muted-foreground/40">—</span>
                  : (
                    <CostValue
                      display={resolveCostDisplay({
                        valueUsd: p.total_estimated_cost_usd,
                        costTruth: toCostTruth(p.has_unknown_cost),
                        formatUsd: (v) => formatCost(v, 2),
                      })}
                    />
                  )}
              </td>
              <td className="py-3 text-right text-muted-foreground">
                {formatRelativeTime(p.last_used_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Sección 3 — Ejecuciones recientes
// ============================================================

function RecentLogsTable({ logs }: { logs: ProviderUsageLog[] }) {
  if (logs.length === 0) {
    return <EmptyState message="Aún no hay actividad reciente registrada." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Fecha', 'Proveedor', 'Operación', 'Estado', 'Cred./Tokens', 'Costo est.'].map((h) => (
              <th
                key={h}
                className={`pb-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${h === 'Fecha' || h === 'Proveedor' || h === 'Operación' ? 'text-left' : 'text-right'} pr-4 last:pr-0`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {logs.map((log) => {
            const quantity =
              log.credits_used != null && Number(log.credits_used) > 0
                ? `${Number(log.credits_used).toFixed(0)} créd.`
                : log.input_tokens + log.output_tokens > 0
                  ? `${(log.input_tokens + log.output_tokens).toLocaleString('es-ES')} tok.`
                  : '—';

            return (
              <tr key={log.id}>
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                  {formatDate(log.created_at)}
                </td>
                <td className="py-2.5 pr-4 font-medium text-foreground capitalize">
                  {providerDisplayName(log.provider_key)}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground max-w-[180px] truncate">
                  {log.operation_key.replace(/_/g, ' ')}
                </td>
                <td className="py-2.5 pr-4">
                  <div className="flex justify-end">
                    <StatusBadge status={log.status} />
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">
                  {quantity}
                </td>
                <td className="py-2.5 text-right font-mono text-muted-foreground">
                  {Number(log.estimated_cost_usd) > 0
                    ? formatCost(Number(log.estimated_cost_usd))
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Page — accepts searchParams for server-side filtering
// ============================================================

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const [summary, agentStats, providerStats, recentLogs, filterOptions, userConsumption] =
    await Promise.all([
      getAiUsageSummary(filters),
      getAgentStats(filters),
      getProviderStats(filters),
      getRecentProviderLogs(25, filters),
      getDistinctFilterOptions(),
      getUserConsumption(filters),
    ]);

  const isRestricted = summary === null;
  const hasData =
    !isRestricted &&
    (summary.total_executions > 0 || summary.total_provider_calls > 0);

  const activeFiltersCount = [
    filters.period,
    filters.provider,
    filters.agent,
    filters.status,
    filters.user,
    filters.role,
    filters.groupId,
  ].filter(Boolean).length;

  // ── Summary cards ────────────────────────────────────────
  const summaryCards = isRestricted
    ? []
    : [
        {
          label: 'Costo estimado total',
          value: (
            <CostValue
              display={resolveCostDisplay({
                valueUsd: summary.total_estimated_cost_usd,
                costTruth: toCostTruth(summary.has_unknown_cost),
                formatUsd: (v) => formatCost(v, 2),
              })}
            />
          ),
          sub: 'USD acumulado',
          icon: DollarSign,
          accent: 'text-su-brand',
          iconBg: 'bg-su-brand-soft',
        },
        {
          label: 'Ejecuciones de agentes',
          value: String(summary.total_executions),
          sub: 'runs registrados',
          icon: Bot,
          accent: 'text-foreground',
          iconBg: 'bg-muted/40',
        },
        {
          label: 'Llamadas a proveedores',
          value: String(summary.total_provider_calls),
          sub: `${summary.distinct_providers} proveedor${summary.distinct_providers !== 1 ? 'es' : ''} activo${summary.distinct_providers !== 1 ? 's' : ''}`,
          icon: Zap,
          accent: 'text-foreground',
          iconBg: 'bg-muted/40',
        },
        {
          label: 'Errores',
          value: String(summary.error_provider_calls + summary.failed_executions),
          sub: 'llamadas + runs fallidos',
          icon: AlertCircle,
          accent: summary.error_provider_calls + summary.failed_executions > 0
            ? 'text-destructive'
            : 'text-muted-foreground',
          iconBg: summary.error_provider_calls + summary.failed_executions > 0
            ? 'bg-destructive/10'
            : 'bg-muted/40',
        },
        {
          label: 'Costo promedio / run',
          value: summary.avg_cost_per_run !== null
            ? formatCost(summary.avg_cost_per_run, 4)
            : '—',
          sub: 'por ejecución de agente',
          icon: TrendingUp,
          accent: 'text-foreground',
          iconBg: 'bg-muted/40',
        },
        {
          label: 'En curso ahora',
          value: String(summary.running_executions),
          sub: 'agentes activos',
          icon: CheckCircle2,
          accent: summary.running_executions > 0 ? 'text-su-brand' : 'text-muted-foreground',
          iconBg: summary.running_executions > 0 ? 'bg-su-brand-soft' : 'bg-muted/40',
        },
      ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Uso de IA, costos y efectividad"
        description="Consumo real de agentes y proveedores externos. Datos registrados automáticamente por el Agente 1."
        actions={
          hasData ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-500">
              <CheckCircle2 className="h-3 w-3" />
              Datos reales
            </span>
          ) : undefined
        }
      />

      {/* ── Banner contextual ────────────────────────────────── */}
      {isRestricted && (
        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Esta vista requiere permisos de administrador para mostrar datos de consumo.
          </p>
        </div>
      )}

      {!isRestricted && !hasData && (
        <div className="flex items-start gap-3 rounded-xl border border-su-brand/20 bg-su-brand/5 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground font-medium">Aún no hay ejecuciones reales registradas.</strong>{' '}
            Los datos aparecerán automáticamente cuando el Agente 1 comience a registrar
            actividad — búsquedas Tavily y ejecuciones de prospectos.
          </p>
        </div>
      )}

      {hasData && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Mostrando datos reales desde Supabase.{' '}
            <strong className="text-foreground font-medium">Tavily</strong> se mide por créditos/consultas (no tokens).{' '}
            Los costos son estimados basados en la tarifa configurada.
          </p>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────── */}
      {!isRestricted && filterOptions && (
        <SurfaceCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FiltersClient
              options={filterOptions}
              currentPeriod={filters.period ?? ''}
              currentProvider={filters.provider ?? ''}
              currentAgent={filters.agent ?? ''}
              currentStatus={filters.status ?? ''}
              currentUser={filters.user ?? ''}
              currentRole={filters.role ?? ''}
              currentGroupId={filters.groupId ?? ''}
            />
            {activeFiltersCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {activeFiltersCount} filtro{activeFiltersCount !== 1 ? 's' : ''} activo{activeFiltersCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </SurfaceCard>
      )}

      {/* ── Summary cards ────────────────────────────────────── */}
      {!isRestricted && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {summaryCards.map((card) => (
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
      )}

      {/* ── Sección 1: Consumo por agente ───────────────────── */}
      {!isRestricted && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Consumo por agente"
            description="Ejecuciones, prospectos generados y aprobados, y costo estimado por agente."
            actions={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
                <Bot className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <AgentStatsTable agents={agentStats ?? []} />
        </SurfaceCard>
      )}

      {/* ── Sección 2: Consumo por proveedor ────────────────── */}
      {!isRestricted && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Consumo por proveedor"
            description="Llamadas, créditos o tokens consumidos, y costo estimado por proveedor."
            actions={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
                <Plug className="h-4 w-4 text-muted-foreground" />
              </div>
            }
          />
          <ProviderStatsTable providers={providerStats ?? []} />

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-su-brand/20 bg-su-brand/5 px-3 py-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-su-brand" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground font-medium">Tavily</strong> no consume tokens — se cobra por crédito/consulta.{' '}
              <strong className="text-foreground font-medium">Apollo</strong> y{' '}
              <strong className="text-foreground font-medium">Lusha</strong> se medirán por crédito cuando se integren.
              Los costos son estimados; el costo real depende de conciliación de factura.
            </p>
          </div>
        </SurfaceCard>
      )}

      {/* ── Sección 3: Ejecuciones recientes ────────────────── */}
      {!isRestricted && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Ejecuciones recientes"
            description="Últimas 25 llamadas a proveedores registradas por el Agente 1."
            actions={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
                <Zap className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <RecentLogsTable logs={recentLogs ?? []} />
        </SurfaceCard>
      )}

      {/* ── Sección 4: Consumo por usuario ──────────────────── */}
      {!isRestricted && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Consumo por usuario"
            description="Adopción y costo por usuario activo. Los usuarios sin consumo aparecen con cero para visibilizar la no-adopción."
            actions={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
            }
          />
          {userConsumption === null || userConsumption.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {userConsumption === null
                  ? 'Sin permisos para ver consumo por usuario.'
                  : 'No hay usuarios activos que coincidan con los filtros actuales.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    {['Usuario', 'Ejecuciones', 'Llamadas', 'Proveedores', 'Costo est.', 'Último uso'].map((h) => (
                      <th
                        key={h}
                        className={`pb-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${h === 'Usuario' ? 'text-left' : 'text-right'} pr-4 last:pr-0`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {userConsumption.map((u) => {
                    const hasActivity = u.executions + u.provider_calls > 0;
                    return (
                      <tr key={u.triggered_by} className={hasActivity ? '' : 'opacity-60'}>
                        <td className="py-3 pr-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {u.full_name ?? u.email ?? u.triggered_by.slice(0, 8)}
                            </span>
                            {u.full_name && u.email && (
                              <span className="text-[10px] text-muted-foreground">{u.email}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right text-muted-foreground">{u.executions}</td>
                        <td className="py-3 pr-4 text-right text-muted-foreground">{u.provider_calls}</td>
                        <td className="py-3 pr-4 text-right text-muted-foreground">
                          {u.providers.length > 0
                            ? u.providers.map(providerDisplayName).join(', ')
                            : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                          {u.estimated_cost_usd === 0 && !u.has_unknown_cost
                            ? <span className="text-muted-foreground/40">$0.00</span>
                            : (
                              <CostValue
                                display={resolveCostDisplay({
                                  valueUsd: u.estimated_cost_usd,
                                  costTruth: toCostTruth(u.has_unknown_cost),
                                  formatUsd: (v) => formatCost(v, 2),
                                })}
                              />
                            )}
                        </td>
                        <td className="py-3 text-right text-muted-foreground">
                          {formatRelativeTime(u.last_activity_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      )}

      {/* ── Sección 5: Nota de efectividad ──────────────────── */}
      {!isRestricted && (
        <SurfaceCard>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft">
              <TrendingUp className="h-4 w-4 text-su-brand" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Criterio de efectividad</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                La métrica de efectividad real es <strong className="text-foreground font-medium">prospectos aprobados / generados</strong>,
                no el volumen devuelto por el proveedor.{' '}
                {(agentStats ?? []).some((a) => a.total_results_generated > 0) ? (
                  <>
                    El costo por prospecto aprobado y la tasa de persistencia se calculan
                    automáticamente desde los datos de la tabla anterior.
                  </>
                ) : (
                  <>
                    Las métricas de efectividad quedarán disponibles cuando haya
                    ejecuciones con prospectos generados y aprobados.
                  </>
                )}
              </p>
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
