import { formatInAppZone } from '@/lib/format-date';
import { Suspense } from 'react';
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
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { MetricCard } from '@/components/shared/metric-card';
import { EmptyState as EmptyStateBase } from '@/components/ui/empty-state';
import { TableShell } from '@/components/data-display';
import { FiltersClient } from './filters-client';
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
import type { AgentStat, ProviderStat, ProviderUsageLog } from '@/modules/usage-tracking/types';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import {
  resolveUsageCredits,
  readUsageBillingState,
  resolveCreditsDisplay,
  resolveCreditsTotalsDisplay,
  type CreditsDisplayValue,
} from '@/modules/usage-tracking/credits-display';
import { CostValue, CreditsValue } from '@/components/shared/cost-value';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
// convention for live admin surfaces (see settings/source-catalog). No DB write.
export const dynamic = 'force-dynamic';

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
  return formatInAppZone(isoDate, { day: 'numeric', month: 'short' }, 'es-ES');
}

function formatDate(isoDate: string): string {
  return formatInAppZone(isoDate, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }, 'es-ES');
}

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

// ============================================================
// Status badge
// ============================================================

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; variant: 'positive' | 'brand' | 'negative' | 'warning' | 'neutral'; dot: string }
  > = {
    completed:      { label: 'Completado',  variant: 'positive', dot: 'bg-success' },
    running:        { label: 'En curso',    variant: 'brand',    dot: 'bg-primary' },
    failed:         { label: 'Error',       variant: 'negative', dot: 'bg-destructive' },
    cancelled:      { label: 'Cancelado',   variant: 'neutral',  dot: 'bg-muted-foreground/25' },
    pending:        { label: 'Pendiente',   variant: 'warning',  dot: 'bg-warning' },
    success:        { label: 'OK',          variant: 'positive', dot: 'bg-success' },
    error:          { label: 'Error',       variant: 'negative', dot: 'bg-destructive' },
    rate_limited:   { label: 'Rate limit',  variant: 'warning',  dot: 'bg-warning' },
    quota_exceeded: { label: 'Cuota',       variant: 'negative', dot: 'bg-destructive' },
    no_new_candidates: { label: 'Sin nuevos', variant: 'neutral', dot: 'bg-muted-foreground/25' },
  };
  const cfg = map[status] ?? {
    label: status,
    variant: 'neutral' as const,
    dot: 'bg-muted-foreground/25',
  };
  return (
    <Badge variant={cfg.variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {cfg.label}
    </Badge>
  );
}

function EffectivenessBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-success' : pct >= 50 ? 'bg-primary' : 'bg-warning';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-subtle">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ============================================================
// Empty state
// ============================================================

function EmptyState({ message }: { message: string }) {
  return (
    <EmptyStateBase variant="plain" icon={Activity} title={message} />
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
    <Table>
        <TableHeader>
          <TableRow>
            {['Agente', 'Ejec.', 'Generados', 'Aprobados', 'Efectividad', 'Costo est.', 'Costo/aprobado'].map((h) => (
              <TableHead key={h} scope="col" className={h === 'Agente' ? 'text-left' : 'text-right'}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
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
              <TableRow key={a.agent_key}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="font-medium text-foreground">{agentDisplayName(a)}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{a.total_executions}</TableCell>
                <TableCell className="text-right text-muted-foreground">{a.total_results_generated}</TableCell>
                <TableCell className="text-right font-medium text-foreground">{a.total_results_approved}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    {effectiveness !== null ? (
                      <EffectivenessBar pct={effectiveness} />
                    ) : (
                      <span className="text-muted-foreground text-xs">Sin datos</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatCost(a.total_estimated_cost_usd, 2)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {costPerApproved !== null
                    ? formatCost(costPerApproved)
                    : <span className="text-text-muted">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
    </Table>
  );
}

// ============================================================
// Sección 2 — Consumo por proveedor
// ============================================================

// A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 4/§ 5 — la medición de un proveedor es
// "por créditos" también cuando lo único que hay son operaciones con consumo
// indeterminado: un proveedor con 25 operaciones sin crédito determinado no es
// un proveedor "por llamadas", es uno con la contabilidad pendiente. Un
// proveedor facturado por tokens conserva su medición en tokens.
function isCreditMeasured(stat: ProviderStat): boolean {
  const hasTokenBased = stat.total_input_tokens + stat.total_output_tokens > 0;
  if (hasTokenBased) return false;
  return (stat.total_credits_used ?? 0) > 0 || stat.has_unknown_credits;
}

function providerMeasurementLabel(stat: ProviderStat): string {
  if (isCreditMeasured(stat)) return 'Créditos / consultas';
  if (stat.total_input_tokens + stat.total_output_tokens > 0) return 'Tokens (in + out)';
  return 'Llamadas';
}

/**
 * `null` significa "no hay medición que mostrar" (un guion), no "cero".
 * Cuando hay créditos, se devuelve el display resuelto: un total con
 * operaciones pendientes se marca como parcial en vez de presentarse cerrado.
 */
function providerMeasurementCredits(stat: ProviderStat): CreditsDisplayValue | null {
  if (!isCreditMeasured(stat)) return null;
  return resolveCreditsTotalsDisplay({
    totals: {
      knownCreditsTotal: stat.total_credits_used ?? 0,
      unknownCreditOperations: stat.unknown_credit_operations,
      hasUnknownCredits: stat.has_unknown_credits,
    },
  });
}

function providerMeasurementTokens(stat: ProviderStat): string | null {
  const tokens = stat.total_input_tokens + stat.total_output_tokens;
  return tokens > 0 ? tokens.toLocaleString('es-ES') : null;
}

function ProviderStatsTable({ providers }: { providers: ProviderStat[] }) {
  if (providers.length === 0) {
    return <EmptyState message="Aún no hay llamadas a proveedores registradas." />;
  }

  return (
    <Table>
        <TableHeader>
          <TableRow>
            {['Proveedor', 'Medición', 'Llamadas', 'Cantidad', 'Resultados', 'Costo est.', 'Último uso'].map((h) => (
              <TableHead key={h} scope="col" className={h === 'Proveedor' || h === 'Medición' ? 'text-left' : 'text-right'}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers.map((p) => (
            <TableRow key={p.provider_key}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-surface-subtle">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-foreground">
                    {providerDisplayName(p.provider_key)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {providerMeasurementLabel(p)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">{p.total_calls}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                {(() => {
                  const credits = providerMeasurementCredits(p);
                  if (credits) {
                    return <div className="flex justify-end"><CreditsValue display={credits} /></div>;
                  }
                  const tokens = providerMeasurementTokens(p);
                  return tokens ?? <span className="text-text-muted">—</span>;
                })()}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">{p.total_results_returned}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                {p.total_estimated_cost_usd === 0 && !p.has_unknown_cost
                  ? <span className="text-text-muted">—</span>
                  : (
                    <CostValue
                      display={resolveCostDisplay({
                        valueUsd: p.total_estimated_cost_usd,
                        costTruth: toCostTruth(p.has_unknown_cost),
                        formatUsd: (v) => formatCost(v, 2),
                      })}
                    />
                  )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatRelativeTime(p.last_used_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
    </Table>
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
    <Table>
        <TableHeader>
          <TableRow>
            {['Fecha', 'Proveedor', 'Operación', 'Estado', 'Cred./Tokens', 'Costo est.'].map((h) => (
              <TableHead key={h} scope="col" className={h === 'Fecha' || h === 'Proveedor' || h === 'Operación' ? 'text-left' : 'text-right'}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => {
            // § 3 — el estado del crédito se resuelve explícitamente: un NULL (o
            // un billing_state indeterminado) NO se muestra como "0 créditos"
            // ni como "sin consumo". Los tokens siguen ganando cuando el
            // proveedor factura por tokens.
            const credits = resolveUsageCredits(log.credits_used, readUsageBillingState(log));
            const tokens = log.input_tokens + log.output_tokens;

            const quantity: React.ReactNode =
              credits.state === 'known' && credits.credits > 0
                ? `${credits.credits.toFixed(0)} créd.`
                : tokens > 0
                  ? `${tokens.toLocaleString('es-ES')} tok.`
                  : credits.state === 'unknown'
                    ? (
                      <div className="flex justify-end">
                        <CreditsValue display={resolveCreditsDisplay(credits)} />
                      </div>
                    )
                    : '0 créd.';

            return (
              <TableRow key={log.id}>
                <TableCell className="text-muted-foreground">
                  {formatDate(log.created_at)}
                </TableCell>
                <TableCell className="font-medium text-foreground capitalize">
                  {providerDisplayName(log.provider_key)}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-44 truncate" title={log.operation_key}>
                  {log.operation_key.replace(/_/g, ' ')}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <StatusBadge status={log.status} />
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {quantity}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {Number(log.estimated_cost_usd) > 0
                    ? formatCost(Number(log.estimated_cost_usd))
                    : <span className="text-text-muted">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
    </Table>
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
          // Design Refresh v9: valor neutro. El color en un número se reserva
          // para señal semántica real (errores) — el chip de icono ya da contexto.
          accent: 'text-foreground',
        },
        {
          label: 'Ejecuciones de agentes',
          value: String(summary.total_executions),
          sub: 'runs registrados',
          icon: Bot,
          accent: 'text-foreground',
        },
        {
          label: 'Llamadas a proveedores',
          value: String(summary.total_provider_calls),
          sub: `${summary.distinct_providers} proveedor${summary.distinct_providers !== 1 ? 'es' : ''} activo${summary.distinct_providers !== 1 ? 's' : ''}`,
          icon: Zap,
          accent: 'text-foreground',
        },
        {
          label: 'Errores',
          value: String(summary.error_provider_calls + summary.failed_executions),
          sub: 'llamadas + runs fallidos',
          icon: AlertCircle,
          accent: summary.error_provider_calls + summary.failed_executions > 0
            ? 'text-destructive'
            : 'text-muted-foreground',
        },
        {
          label: 'Costo promedio / run',
          value: summary.avg_cost_per_run !== null
            ? formatCost(summary.avg_cost_per_run, 4)
            : '—',
          sub: 'por ejecución de agente',
          icon: TrendingUp,
          accent: 'text-foreground',
        },
        {
          label: 'En curso ahora',
          value: String(summary.running_executions),
          sub: 'agentes activos',
          icon: CheckCircle2,
          accent: 'text-foreground',
        },
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uso de IA, costos y efectividad"
        description="Consumo real de agentes y proveedores externos. Datos registrados automáticamente por el Agente 1."
        actions={
          hasData ? (
            <Badge variant="positive">
              <CheckCircle2 aria-hidden="true" />
              Datos reales
            </Badge>
          ) : undefined
        }
      />

      {/* ── Banner contextual ────────────────────────────────── */}
      {isRestricted && (
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Esta vista requiere permisos de administrador para mostrar datos de consumo.
          </p>
        </div>
      )}

      {!isRestricted && !hasData && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground font-medium">Aún no hay ejecuciones reales registradas.</strong>{' '}
            Los datos aparecerán automáticamente cuando el Agente 1 comience a registrar
            actividad — búsquedas Tavily y ejecuciones de prospectos.
          </p>
        </div>
      )}

      {hasData && (
        <div className="flex items-start gap-3 rounded-xl border border-success/20 bg-success/5 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-sm leading-relaxed text-muted-foreground">
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
              <span className="text-xs text-muted-foreground">
                {activeFiltersCount} filtro{activeFiltersCount !== 1 ? 's' : ''} activo{activeFiltersCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </SurfaceCard>
      )}

      {/* ── Summary cards ────────────────────────────────────── */}
      {!isRestricted && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {summaryCards.map((card) => (
            <MetricCard
              key={card.label}
              title={card.label}
              description={card.sub}
              value={card.value}
              icon={<card.icon className={card.accent} aria-hidden="true" />}
            />
          ))}
        </div>
      )}

      {/* ── Efectividad Agente 1 (read model) ───────────────── */}
      {!isRestricted && (
        <Suspense fallback={<Agent1EffectivenessPanelSkeleton />}>
          <Agent1EffectivenessPanel filters={agent1Filters} />
        </Suspense>
      )}

      {/* ── Supresiones no evaluables (APOLLO-PHONE-CACHE-1b) ─ */}
      {!isRestricted && (
        <Suspense fallback={<PhoneSuppressionNotEvaluablePanelSkeleton />}>
          <PhoneSuppressionNotEvaluablePanel />
        </Suspense>
      )}

      {/* ── Sección 1: Consumo por agente ───────────────────── */}
      {!isRestricted && (
        <TableShell
          title="Consumo por agente"
          description="Ejecuciones, prospectos generados y aprobados, y costo estimado por agente."
        >
          <AgentStatsTable agents={agentStats ?? []} />
        </TableShell>
      )}

      {/* ── Sección 2: Consumo por proveedor ────────────────── */}
      {!isRestricted && (
        <TableShell
          title="Consumo por proveedor"
          description="Llamadas, créditos o tokens consumidos, y costo estimado por proveedor."
          footer={
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-muted-foreground">
                <strong className="text-foreground font-medium">Tavily</strong> no consume tokens — se cobra por crédito/consulta.{' '}
                <strong className="text-foreground font-medium">Apollo</strong> y{' '}
                <strong className="text-foreground font-medium">Lusha</strong> se medirán por crédito cuando se integren.
                Los costos son estimados; el costo real depende de conciliación de factura.
              </p>
            </div>
          }
        >
          <ProviderStatsTable providers={providerStats ?? []} />
        </TableShell>
      )}

      {/* ── Sección 3: Ejecuciones recientes ────────────────── */}
      {!isRestricted && (
        <TableShell
          title="Ejecuciones recientes"
          description="Últimas 25 llamadas a proveedores registradas por el Agente 1."
        >
          <RecentLogsTable logs={recentLogs ?? []} />
        </TableShell>
      )}

      {/* ── Sección 4: Consumo por usuario ──────────────────── */}
      {!isRestricted && (
        <TableShell
          title="Consumo por usuario"
          description="Adopción y costo por usuario activo. Los usuarios sin consumo aparecen con cero para visibilizar la no-adopción."
          empty={userConsumption === null || userConsumption.length === 0}
          emptyState={
            <EmptyStateBase
              variant="plain"
              icon={Users}
              title={
                userConsumption === null
                  ? 'Sin permisos para ver consumo por usuario.'
                  : 'No hay usuarios activos que coincidan con los filtros actuales.'
              }
            />
          }
        >
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Usuario', 'Ejecuciones', 'Llamadas', 'Proveedores', 'Costo est.', 'Último uso'].map((h) => (
                      <TableHead key={h} scope="col" className={h === 'Usuario' ? 'text-left' : 'text-right'}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(userConsumption ?? []).map((u) => {
                    const hasActivity = u.executions + u.provider_calls > 0;
                    return (
                      <TableRow key={u.triggered_by} className={hasActivity ? undefined : 'opacity-60'}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {u.full_name ?? u.email ?? u.triggered_by.slice(0, 8)}
                            </span>
                            {u.full_name && u.email && (
                              <span className="text-xs text-muted-foreground">{u.email}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{u.executions}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{u.provider_calls}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {u.providers.length > 0
                            ? u.providers.map(providerDisplayName).join(', ')
                            : <span className="text-text-muted">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {u.estimated_cost_usd === 0 && !u.has_unknown_cost
                            ? <span className="text-text-muted">$0.00</span>
                            : (
                              <CostValue
                                display={resolveCostDisplay({
                                  valueUsd: u.estimated_cost_usd,
                                  costTruth: toCostTruth(u.has_unknown_cost),
                                  formatUsd: (v) => formatCost(v, 2),
                                })}
                              />
                            )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatRelativeTime(u.last_activity_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
        </TableShell>
      )}

      {/* ── Sección 5: Nota de efectividad ──────────────────── */}
      {!isRestricted && (
        <SurfaceCard>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Criterio de efectividad</p>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
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
