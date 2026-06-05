import {
  Bot,
  Plug,
  CheckCircle2,
  DollarSign,
  Zap,
  TrendingUp,
  FlaskConical,
  Info,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import {
  MOCK_AGENTS,
  MOCK_PROVIDERS,
  MOCK_ACTIVITY,
  MOCK_SUMMARY,
} from '@/modules/usage-tracking/mock-data';
import type { MockAgentStat, MockProviderStat, MockActivityItem } from '@/modules/usage-tracking/mock-data';

// ============================================================
// Helpers de presentación
// ============================================================

function formatCost(usd: number, decimals = 4): string {
  if (usd === 0) return '—';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function AgentStatusBadge({ status }: { status: MockAgentStat['status'] }) {
  const map = {
    active:  { label: 'Activo',    classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',          dot: 'bg-emerald-500' },
    idle:    { label: 'Inactivo',  classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',             dot: 'bg-muted-foreground/25' },
    planned: { label: 'Planificado', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',             dot: 'bg-amber-500' },
  };
  const cfg = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function ActivityStatusBadge({ status }: { status: MockActivityItem['status'] }) {
  const map = {
    success:      { label: 'OK',         classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', dot: 'bg-emerald-500' },
    error:        { label: 'Error',      classes: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    rate_limited: { label: 'Rate limit', classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',       dot: 'bg-amber-500' },
  };
  const cfg = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function EffectivenessBar({ pct }: { pct: number }) {
  const color =
    pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-su-brand' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted/40">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-medium text-foreground">{formatPct(pct)}</span>
    </div>
  );
}

function TypeChip({ type }: { type: MockActivityItem['type'] }) {
  const map = {
    agent:    { label: 'Agente',    classes: 'bg-su-brand/10 text-su-brand' },
    provider: { label: 'Proveedor', classes: 'bg-muted/40 text-muted-foreground' },
    quality:  { label: 'Calidad',   classes: 'bg-amber-500/10 text-amber-500' },
  };
  const cfg = map[type];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ============================================================
// Sección 1 — Efectividad por agente
// ============================================================

function AgentEffectivenessTable({ agents }: { agents: MockAgentStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Agente', 'Estado', 'Ejec.', 'Costo est.', 'Generados', 'Aprobados', 'Efectividad', 'Costo / aprobado'].map((h) => (
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
          {agents.map((a) => (
            <tr key={a.key} className="group">
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft">
                    <Bot className="h-3.5 w-3.5 text-su-brand" />
                  </div>
                  <span className="font-medium text-foreground">{a.name}</span>
                </div>
              </td>
              <td className="py-3 pr-4 text-right">
                <AgentStatusBadge status={a.status} />
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{a.executions}</td>
              <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                {formatCost(a.estimatedCostUsd, 2)}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{a.resultsGenerated}</td>
              <td className="py-3 pr-4 text-right text-foreground font-medium">{a.resultsApproved}</td>
              <td className="py-3 pr-4">
                <div className="flex justify-end">
                  <EffectivenessBar pct={a.effectivenessRate} />
                </div>
              </td>
              <td className="py-3 text-right font-mono text-muted-foreground">
                {formatCost(a.avgCostPerApproved)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Sección 2 — Efectividad por proveedor
// ============================================================

function ProviderEffectivenessTable({ providers }: { providers: MockProviderStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Proveedor', 'Operación', 'Llamadas', 'Costo est.', 'Devueltos', 'Útiles', 'Efectividad', 'Costo / útil'].map((h) => (
              <th
                key={h}
                className={`pb-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${h === 'Proveedor' || h === 'Operación' ? 'text-left' : 'text-right'} pr-4 last:pr-0`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {providers.map((p) => (
            <tr key={p.key} className="group">
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-foreground">{p.name}</span>
                </div>
              </td>
              <td className="py-3 pr-4 text-muted-foreground">{p.operation}</td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{p.calls}</td>
              <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                {p.estimatedCostUsd === 0 ? (
                  <span className="text-muted-foreground/50 text-[10px]">sin config.</span>
                ) : (
                  formatCost(p.estimatedCostUsd, 2)
                )}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{p.resultsReturned}</td>
              <td className="py-3 pr-4 text-right text-foreground font-medium">{p.usefulResults}</td>
              <td className="py-3 pr-4">
                <div className="flex justify-end">
                  <EffectivenessBar pct={p.effectivenessRate} />
                </div>
              </td>
              <td className="py-3 text-right font-mono text-muted-foreground">
                {p.avgCostPerUsefulResult === 0 ? (
                  <span className="text-muted-foreground/50 text-[10px]">sin config.</span>
                ) : (
                  formatCost(p.avgCostPerUsefulResult)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Sección 3 — Actividad reciente
// ============================================================

function ActivityList({ items }: { items: MockActivityItem[] }) {
  return (
    <div className="divide-y divide-border/20">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-3">
          <span className="w-20 shrink-0 text-[10px] text-muted-foreground">{item.relativeTime}</span>
          <TypeChip type={item.type} />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <span className="font-medium text-foreground">{item.providerOrAgent}</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate text-muted-foreground">{item.operation}</span>
          </div>
          <ActivityStatusBadge status={item.status} />
          <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {item.estimatedCostUsd > 0 ? formatCost(item.estimatedCostUsd) : '—'}
          </span>
          <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
            {item.resultCount > 0 ? `${item.resultCount} res.` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function AIUsagePage() {
  const s = MOCK_SUMMARY;

  const summaryCards = [
    {
      label: 'Costo estimado total',
      value: `$${s.totalCostUsd.toFixed(2)}`,
      sub: 'USD (datos demo)',
      icon: DollarSign,
      accent: 'text-su-brand',
      iconBg: 'bg-su-brand-soft',
    },
    {
      label: 'Ejecuciones de agentes',
      value: String(s.totalExecutions),
      sub: 'en el período',
      icon: Bot,
      accent: 'text-foreground',
      iconBg: 'bg-muted/40',
    },
    {
      label: 'Llamadas a proveedores',
      value: String(s.totalProviderCalls),
      sub: 'Apollo, Lusha, IA…',
      icon: Zap,
      accent: 'text-foreground',
      iconBg: 'bg-muted/40',
    },
    {
      label: 'Prospectos aprobados',
      value: String(s.totalApproved),
      sub: 'de todos los agentes',
      icon: CheckCircle2,
      accent: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
    },
    {
      label: 'Costo por aprobado',
      value: s.avgCostPerApproved > 0 ? `$${s.avgCostPerApproved.toFixed(4)}` : '—',
      sub: 'promedio estimado',
      icon: TrendingUp,
      accent: 'text-foreground',
      iconBg: 'bg-muted/40',
    },
    {
      label: 'Efectividad promedio',
      value: `${s.avgEffectiveness}%`,
      sub: 'entre todos los agentes',
      icon: TrendingUp,
      accent: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Uso de IA, costos y efectividad"
        description="Monitorea consumo, costos estimados y desempeño de agentes y proveedores."
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-500">
              <FlaskConical className="h-3 w-3" />
              Datos demo
            </span>
          </div>
        }
      />

      {/* ── Aviso de datos demo ──────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-su-brand/20 bg-su-brand/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Los datos que ves son <strong className="text-foreground font-medium">ilustrativos</strong>.
          Los valores reales aparecerán automáticamente cuando los agentes comiencen a registrar
          actividad en producción. La foundation de tracking ya está activa.
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
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.iconBg}`}>
                <card.icon className={`h-4 w-4 ${card.accent}`} />
              </div>
            }
          />
        ))}
      </div>

      {/* ── Sección 1: Efectividad por agente ───────────────── */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Efectividad por agente"
          description="Ejecuciones, costo estimado, prospectos aprobados y tasa de efectividad por agente."
          actions={
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
              <Bot className="h-4 w-4 text-su-brand" />
            </div>
          }
        />
        <AgentEffectivenessTable agents={MOCK_AGENTS} />
      </SurfaceCard>

      {/* ── Sección 2: Efectividad por proveedor ────────────── */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Efectividad por proveedor"
          description="Llamadas, resultados devueltos, resultados útiles y costo por resultado por proveedor."
          actions={
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
              <Plug className="h-4 w-4 text-muted-foreground" />
            </div>
          }
        />
        <ProviderEffectivenessTable providers={MOCK_PROVIDERS} />

        {/* Nota sobre metodología de costos */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-su-brand/20 bg-su-brand/5 px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-su-brand" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Los costos de Apollo y Lusha se calculan como{' '}
            <strong className="text-foreground font-medium">estimación por crédito</strong>{' '}
            según los contratos configurados. El costo real puede variar si el proveedor reporta consumo
            exacto por operación.
          </p>
        </div>
      </SurfaceCard>

      {/* ── Sección 3: Actividad reciente ───────────────────── */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Actividad reciente"
          description="Últimas ejecuciones de agentes y llamadas a proveedores."
          actions={
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
              <Zap className="h-4 w-4 text-su-brand" />
            </div>
          }
        />
        <ActivityList items={MOCK_ACTIVITY} />
      </SurfaceCard>

      {/* ── Sección 4: Nota estratégica ─────────────────────── */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft">
            <TrendingUp className="h-4 w-4 text-su-brand" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Criterio de medición por fuente</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Esta vista permite comparar el costo y la efectividad de cada fuente antes de
              escalar agentes.{' '}
              <strong className="text-foreground font-medium">Apollo</strong> se medirá
              principalmente por búsqueda de empresas;{' '}
              <strong className="text-foreground font-medium">Lusha</strong> por enriquecimiento
              de contactos; los modelos de IA por tokens y calidad del resultado generado. La
              tasa de aprobación —no el volumen devuelto— es la métrica de efectividad real.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
