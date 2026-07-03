import { redirect } from 'next/navigation';
import { Bot, Plug, Star, Info, FlaskConical, DollarSign, Zap, CheckCircle2, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { LegacyCompatBanner } from '../legacy-compat-banner';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getUsageSummary, getRecentUsageActivity } from '@/modules/usage-tracking/actions';
import type { AgentRun, ProviderUsageLog, ResultQualityEvent } from '@/modules/usage-tracking/types';
import {
  MOCK_SUMMARY,
  MOCK_AGENTS,
  MOCK_PROVIDERS,
  MOCK_ACTIVITY,
} from '@/modules/usage-tracking/mock-data';
import type { MockAgentStat, MockProviderStat, MockActivityItem } from '@/modules/usage-tracking/mock-data';

// ============================================================
// Helpers
// ============================================================

function formatRelativeTime(isoDate: string): string {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;
  return new Date(isoDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function formatCost(usd: number, decimals = 4): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

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
    active:         { label: 'Activo',      classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', dot: 'bg-emerald-500' },
    idle:           { label: 'Inactivo',    classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',   dot: 'bg-muted-foreground/25' },
    planned:        { label: 'Planificado', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',       dot: 'bg-amber-500' },
  };
  const config = map[status] ?? {
    label: status,
    classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',
    dot: 'bg-muted-foreground/25',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${config.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    generated:            'bg-su-brand/10 text-su-brand',
    normalized:           'bg-muted/40 text-muted-foreground',
    duplicate_detected:   'bg-amber-500/10 text-amber-500',
    discarded:            'bg-destructive/10 text-destructive',
    approved:             'bg-emerald-500/10 text-emerald-500',
    converted_to_account: 'bg-emerald-500/10 text-emerald-600',
    sent_to_hubspot:      'bg-su-brand/10 text-su-brand',
    contact_useful:       'bg-emerald-500/10 text-emerald-500',
    contact_invalid:      'bg-destructive/10 text-destructive',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${map[type] ?? 'bg-muted/40 text-muted-foreground'}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

// ============================================================
// Tablas — datos reales
// ============================================================

function AgentRunsTable({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Sin ejecuciones de agentes todavía.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Agente', 'Estado', 'Generados', 'Aprobados', 'Costo est.', 'Hace'].map((h, i) => (
              <th key={h} className={`pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${i < 2 ? 'text-left' : 'text-right'} pr-4 last:pr-0`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="py-2.5 pr-4 font-medium text-foreground">{run.agent_name ?? run.agent_key}</td>
              <td className="py-2.5 pr-4"><StatusBadge status={run.status} /></td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{run.results_generated}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{run.results_approved}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">{formatCost(Number(run.estimated_cost_usd), 2)}</td>
              <td className="py-2.5 text-right text-muted-foreground">{run.created_at ? formatRelativeTime(run.created_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderLogsTable({ logs }: { logs: ProviderUsageLog[] }) {
  if (logs.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Sin llamadas a proveedores todavía.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Proveedor', 'Operación', 'Estado', 'Resultados', 'Costo est.', 'Hace'].map((h, i) => (
              <th key={h} className={`pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${i < 3 ? 'text-left' : 'text-right'} pr-4 last:pr-0`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="py-2.5 pr-4 font-medium text-foreground capitalize">{log.provider_key}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{log.operation_key.replace(/_/g, ' ')}</td>
              <td className="py-2.5 pr-4"><StatusBadge status={log.status} /></td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{log.results_returned}</td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">{formatCost(Number(log.estimated_cost_usd), 2)}</td>
              <td className="py-2.5 text-right text-muted-foreground">{formatRelativeTime(log.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityEventsTable({ events }: { events: ResultQualityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Sin eventos de calidad todavía.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Tipo', 'Evento', 'Fuente', 'Notas', 'Hace'].map((h, i) => (
              <th key={h} className={`pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${i < 4 ? 'text-left' : 'text-right'} pr-4 last:pr-0`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {events.map((ev) => (
            <tr key={ev.id}>
              <td className="py-2.5 pr-4 text-muted-foreground capitalize">{ev.result_type}</td>
              <td className="py-2.5 pr-4"><EventTypeBadge type={ev.event_type} /></td>
              <td className="py-2.5 pr-4 text-muted-foreground">{ev.source_key ?? '—'}</td>
              <td className="py-2.5 pr-4 text-muted-foreground max-w-[200px] truncate">{ev.notes ?? '—'}</td>
              <td className="py-2.5 text-right text-muted-foreground">{formatRelativeTime(ev.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Tablas — datos demo (mock)
// ============================================================

function MockAgentsTable({ agents }: { agents: MockAgentStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Agente', 'Estado', 'Ejec.', 'Generados', 'Aprobados', 'Efectividad', 'Costo est.', 'Costo / aprobado'].map((h, i) => (
              <th key={h} className={`pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${i < 2 ? 'text-left' : 'text-right'} pr-4 last:pr-0`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {agents.map((a) => (
            <tr key={a.key}>
              <td className="py-2.5 pr-4 font-medium text-foreground">{a.name}</td>
              <td className="py-2.5 pr-4"><StatusBadge status={a.status} /></td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{a.executions}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{a.resultsGenerated}</td>
              <td className="py-2.5 pr-4 text-right text-foreground font-medium">{a.resultsApproved}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{a.effectivenessRate.toFixed(1)}%</td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">{formatCost(a.estimatedCostUsd, 2)}</td>
              <td className="py-2.5 text-right font-mono text-muted-foreground">{formatCost(a.avgCostPerApproved)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MockProvidersTable({ providers }: { providers: MockProviderStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Proveedor', 'Operación', 'Llamadas', 'Devueltos', 'Útiles', 'Efectividad', 'Costo est.', 'Costo / útil'].map((h, i) => (
              <th key={h} className={`pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${i < 2 ? 'text-left' : 'text-right'} pr-4 last:pr-0`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {providers.map((p) => (
            <tr key={p.key}>
              <td className="py-2.5 pr-4 font-medium text-foreground">{p.name}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{p.operation}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{p.calls}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{p.resultsReturned}</td>
              <td className="py-2.5 pr-4 text-right text-foreground font-medium">{p.usefulResults}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground">{p.effectivenessRate.toFixed(1)}%</td>
              <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">
                {p.estimatedCostUsd === 0 ? <span className="text-muted-foreground/40">—</span> : formatCost(p.estimatedCostUsd, 2)}
              </td>
              <td className="py-2.5 text-right font-mono text-muted-foreground">
                {p.avgCostPerUsefulResult === 0 ? <span className="text-muted-foreground/40">—</span> : formatCost(p.avgCostPerUsefulResult)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MockActivityTable({ items }: { items: MockActivityItem[] }) {
  const typeLabel: Record<MockActivityItem['type'], string> = {
    agent: 'Agente', provider: 'Proveedor', quality: 'Calidad',
  };
  return (
    <div className="divide-y divide-border/20">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-2.5">
          <span className="w-20 shrink-0 text-[10px] text-muted-foreground">{item.relativeTime}</span>
          <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {typeLabel[item.type]}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <span className="font-medium text-foreground">{item.providerOrAgent}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="truncate text-muted-foreground">{item.operation}</span>
          </div>
          <StatusBadge status={item.status} />
          <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {item.estimatedCostUsd > 0 ? formatCost(item.estimatedCostUsd, 2) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default async function UsagePage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [summary, activity] = await Promise.all([
    getUsageSummary(),
    getRecentUsageActivity(15),
  ]);

  const isEmpty =
    activity.agent_runs.length === 0 &&
    activity.provider_logs.length === 0 &&
    activity.quality_events.length === 0;

  const summaryCards = [
    { label: 'Ejecuciones',  value: isEmpty ? String(MOCK_SUMMARY.totalExecutions)   : String(summary.total_agent_runs),      sub: 'de agentes',           icon: Bot,          accent: 'text-foreground',   bg: 'bg-muted/40' },
    { label: 'En curso',     value: isEmpty ? '0'                                     : String(summary.running_agent_runs),    sub: 'agentes activos',      icon: Zap,          accent: summary.running_agent_runs > 0 ? 'text-su-brand' : 'text-muted-foreground', bg: 'bg-muted/40' },
    { label: 'Fallidas',     value: isEmpty ? '0'                                     : String(summary.failed_agent_runs),     sub: 'con error',            icon: Bot,          accent: summary.failed_agent_runs > 0 ? 'text-destructive' : 'text-muted-foreground', bg: 'bg-muted/40' },
    { label: 'Llamadas API', value: isEmpty ? String(MOCK_SUMMARY.totalProviderCalls) : String(summary.total_provider_calls), sub: 'a proveedores',        icon: Plug,         accent: 'text-foreground',   bg: 'bg-muted/40' },
    { label: 'Aprobados',    value: isEmpty ? String(MOCK_SUMMARY.totalApproved)      : '—',                                  sub: 'resultados aprobados', icon: CheckCircle2, accent: 'text-emerald-500',  bg: 'bg-emerald-500/10' },
    { label: 'Costo est.',   value: isEmpty ? `$${MOCK_SUMMARY.totalCostUsd.toFixed(2)}` : formatCost(summary.total_estimated_cost_usd, 2), sub: 'USD estimados', icon: DollarSign, accent: 'text-su-brand', bg: 'bg-su-brand-soft' },
  ];

  return (
    <div className="space-y-8">
      <LegacyCompatBanner
        message="Esta vista sigue disponible como base interna. La lectura operativa principal de proveedores y consumo vive en Proveedores y consumo."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers?tab=consumo"
      />
      <PageHeader
        title="Uso, costos y efectividad"
        description="Foundation operativa para monitorear ejecuciones de agentes, llamadas a proveedores y calidad de resultados."
        backHref="/settings"
        actions={isEmpty ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-500">
            <FlaskConical className="h-3 w-3" />
            Datos demo
          </span>
        ) : undefined}
      />

      {/* ── Aviso contextual ─────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-su-brand/20 bg-su-brand/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isEmpty ? (
            <>
              La BD aún no tiene ejecuciones registradas.{' '}
              <strong className="text-foreground font-medium">Los datos que ves son ilustrativos</strong>{' '}
              y desaparecerán automáticamente cuando los agentes comiencen a registrar actividad en producción.
            </>
          ) : (
            <>
              Esta vista es la <strong className="text-foreground font-medium">foundation operativa</strong>.
              Los dashboards avanzados se construirán cuando existan datos históricos suficientes.
            </>
          )}
        </p>
      </div>

      {/* ── Summary cards ────────────────────────────────────── */}
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
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.accent}`} />
              </div>
            }
          />
        ))}
      </div>

      {/* ── Tablas demo (cuando BD vacía) ───────────────────── */}
      {isEmpty && (
        <div className="space-y-6">
          <SurfaceCard>
            <SurfaceCardHeader
              title="Efectividad por agente"
              description="Ejecuciones, costo y tasa de aprobación por agente — datos ilustrativos."
              actions={<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft"><Bot className="h-4 w-4 text-su-brand" /></div>}
            />
            <MockAgentsTable agents={MOCK_AGENTS} />
          </SurfaceCard>

          <SurfaceCard>
            <SurfaceCardHeader
              title="Efectividad por proveedor"
              description="Llamadas, resultados útiles y costo por proveedor — datos ilustrativos."
              actions={<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40"><Plug className="h-4 w-4 text-muted-foreground" /></div>}
            />
            <MockProvidersTable providers={MOCK_PROVIDERS} />
          </SurfaceCard>

          <SurfaceCard>
            <SurfaceCardHeader
              title="Actividad reciente"
              description="Últimas ejecuciones de agentes y llamadas a proveedores — datos ilustrativos."
              actions={<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft"><TrendingUp className="h-4 w-4 text-su-brand" /></div>}
            />
            <MockActivityTable items={MOCK_ACTIVITY} />
          </SurfaceCard>
        </div>
      )}

      {/* ── Tablas reales (cuando hay datos) ────────────────── */}
      {!isEmpty && (
        <div className="space-y-6">
          {activity.agent_runs.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Ejecuciones de agentes"
                description={`Últimas ${activity.agent_runs.length} ejecuciones`}
                actions={<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft"><Bot className="h-4 w-4 text-su-brand" /></div>}
              />
              <AgentRunsTable runs={activity.agent_runs} />
            </SurfaceCard>
          )}
          {activity.provider_logs.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Llamadas a proveedores"
                description={`Últimas ${activity.provider_logs.length} llamadas`}
                actions={<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft"><Plug className="h-4 w-4 text-su-brand" /></div>}
              />
              <ProviderLogsTable logs={activity.provider_logs} />
            </SurfaceCard>
          )}
          {activity.quality_events.length > 0 && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Eventos de calidad de resultados"
                description={`Últimos ${activity.quality_events.length} eventos`}
                actions={<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft"><Star className="h-4 w-4 text-su-brand" /></div>}
              />
              <QualityEventsTable events={activity.quality_events} />
            </SurfaceCard>
          )}
        </div>
      )}

      {/* ── Estado de configuración de precios ──────────────── */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Configuración de costos por proveedor</p>
            <p className="text-xs text-muted-foreground">
              Los costos dependen de{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">provider_pricing_config</code>.{' '}
              Apollo y Lusha ya cuentan con costo estimado por crédito según los contratos vigentes.
              Otros proveedores (Anthropic, OpenAI) pueden requerir configuración adicional según el modelo activo.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
