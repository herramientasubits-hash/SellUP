// Q3F-5AX.4 — Agent 1 Effectiveness panel for /ai-usage.
//
// Read-only display surface wired to the agent1-effectiveness read model
// (prospect_batches → prospect_candidates → provider_usage_logs, joined by
// batch_id; NOT agent_runs). No provider calls, no writes, no client state.
// Streams independently via <Suspense> so its loading/error states never block
// the rest of the page.

import {
  TrendingUp,
  Info,
  AlertTriangle,
  CheckCircle2,
  Plug,
} from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getAgent1EffectivenessPanel } from '@/modules/agent1-effectiveness';
import type {
  Agent1EffectivenessFilters,
  Agent1EffectivenessSummary,
  Agent1CostCompletenessFlag,
} from '@/modules/agent1-effectiveness';

// ============================================================
// Format helpers (local — mirror the /ai-usage conventions)
// ============================================================

const UNAVAILABLE = 'No disponible';

function formatUsd(usd: number, decimals = 2): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(decimals)}`;
}

/** Per-outcome cost: null → "No disponible" (never fake a divide-by-zero). */
function formatNullableUsd(usd: number | null, decimals = 4): string {
  return usd === null ? UNAVAILABLE : formatUsd(usd, decimals);
}

/** Rate is a 0..1 fraction; render as a percentage with 1 decimal. */
function formatRate(rate: number | null): string {
  return rate === null ? UNAVAILABLE : `${(rate * 100).toFixed(1)}%`;
}

function formatInt(n: number | null): string {
  return n === null ? UNAVAILABLE : n.toLocaleString('es-ES');
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  tavily: 'Tavily',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  samu_ia: 'Samu IA',
};

function providerDisplayName(providerKey: string): string {
  return PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
}

// ============================================================
// Completeness flag → badge config (non-alarmist)
// ============================================================

const COMPLETENESS_CONFIG: Record<
  Agent1CostCompletenessFlag,
  { label: string; classes: string; Icon: typeof CheckCircle2 }
> = {
  complete: {
    label: 'Costo completo',
    classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
    Icon: CheckCircle2,
  },
  partial_missing_llm_cost: {
    label: 'Costo parcial · falta LLM',
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    Icon: AlertTriangle,
  },
  partial_missing_provider_pricing: {
    label: 'Costo parcial · falta pricing',
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    Icon: AlertTriangle,
  },
  partial_missing_candidate_outcomes: {
    label: 'Funnel parcial',
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    Icon: AlertTriangle,
  },
  unknown: {
    label: 'Datos insuficientes',
    classes: 'border-border/40 bg-muted/30 text-muted-foreground/70',
    Icon: Info,
  },
};

function CompletenessBadge({ flag }: { flag: Agent1CostCompletenessFlag }) {
  const cfg = COMPLETENESS_CONFIG[flag] ?? COMPLETENESS_CONFIG.unknown;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${cfg.classes}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ============================================================
// Small building blocks
// ============================================================

function StatCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

// ============================================================
// Shell wrapper (shared chrome across all states)
// ============================================================

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Efectividad Agente 1"
        description="Lotes de prospectos, tasas de conversión y costo por resultado. Fuente: prospect_batches → prospect_candidates → provider_usage_logs (no agent_runs)."
        actions={
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft">
            <TrendingUp className="h-4 w-4 text-su-brand" />
          </div>
        }
      />
      {children}
    </SurfaceCard>
  );
}

// ============================================================
// States
// ============================================================

function PanelMessage({
  tone,
  children,
}: {
  tone: 'info' | 'error';
  children: React.ReactNode;
}) {
  const classes =
    tone === 'error'
      ? 'border-destructive/20 bg-destructive/5'
      : 'border-border/40 bg-muted/20';
  const Icon = tone === 'error' ? AlertTriangle : Info;
  const iconColor = tone === 'error' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${classes}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

export function Agent1EffectivenessPanelSkeleton() {
  return (
    <PanelShell>
      <div className="animate-pulse space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg border border-border/40 bg-muted/20" />
          ))}
        </div>
        <div className="h-24 rounded-lg border border-border/40 bg-muted/10" />
      </div>
    </PanelShell>
  );
}

// ============================================================
// Provider breakdown table
// ============================================================

function ProviderBreakdownTable({
  rows,
}: {
  rows: Agent1EffectivenessSummary['providerBreakdown'];
}) {
  if (rows.length === 0) {
    return (
      <PanelMessage tone="info">
        No hay registros de uso de proveedores atribuibles a los lotes del Agente 1 en este alcance.
      </PanelMessage>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            {['Proveedor', 'Operación', 'Logs', 'Créditos', 'Resultados', 'Costo est.', 'Sin costo', 'Costo 0'].map(
              (h) => (
                <th
                  key={h}
                  className={`pb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
                    h === 'Proveedor' || h === 'Operación' ? 'text-left' : 'text-right'
                  } pr-4 last:pr-0`}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((r) => (
            <tr key={`${r.providerKey}::${r.operationKey}`}>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-foreground">
                    {providerDisplayName(r.providerKey)}
                  </span>
                </div>
              </td>
              <td className="py-3 pr-4 text-muted-foreground max-w-[180px] truncate">
                {r.operationKey.replace(/_/g, ' ')}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{r.usageLogsCount}</td>
              <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                {r.credits.toLocaleString('es-ES')}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{r.resultsReturned}</td>
              <td className="py-3 pr-4 text-right font-mono text-muted-foreground">
                {r.estimatedCostUsd === 0 && r.missingCostRows === 0 ? (
                  <span className="text-muted-foreground/40">—</span>
                ) : (
                  formatUsd(r.estimatedCostUsd, 2)
                )}
              </td>
              <td className="py-3 pr-4 text-right">
                {r.missingCostRows > 0 ? (
                  <span className="font-mono text-amber-500">{r.missingCostRows}</span>
                ) : (
                  <span className="text-muted-foreground/40">0</span>
                )}
              </td>
              <td className="py-3 text-right">
                {r.zeroCostRows > 0 ? (
                  <span className="font-mono text-muted-foreground">{r.zeroCostRows}</span>
                ) : (
                  <span className="text-muted-foreground/40">0</span>
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
// Summary body (funnel + rates + cost + provider breakdown)
// ============================================================

function SummaryBody({ summary }: { summary: Agent1EffectivenessSummary }) {
  const { funnel, rates, cost, warnings, costCompletenessFlag, providerBreakdown } = summary;

  return (
    <div className="space-y-6">
      {/* Completeness + warnings */}
      <div className="flex flex-wrap items-center gap-2">
        <CompletenessBadge flag={costCompletenessFlag} />
        {funnel.generatedCandidatesCount !== null && (
          <span className="text-[11px] text-muted-foreground">
            {formatInt(funnel.generatedCandidatesCount)} candidatos generados (best-effort)
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Funnel */}
      <div>
        <SectionLabel>Funnel</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCell label="Lotes" value={formatInt(funnel.batchesCount)} mono />
          <StatCell label="Persistidos" value={formatInt(funnel.persistedCandidatesCount)} mono />
          <StatCell label="Pendientes" value={formatInt(funnel.pendingCandidatesCount)} mono />
          <StatCell label="Aprobados" value={formatInt(funnel.approvedCandidatesCount)} mono />
          <StatCell label="Rechazados" value={formatInt(funnel.rejectedCandidatesCount)} mono />
          <StatCell label="Convertidos" value={formatInt(funnel.convertedAccountsCount)} mono />
        </div>
      </div>

      {/* Rates */}
      <div>
        <SectionLabel>Tasas (sobre candidatos persistidos)</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCell label="Aprobación" value={formatRate(rates.approvalRate)} mono />
          <StatCell label="Rechazo" value={formatRate(rates.rejectionRate)} mono />
          <StatCell label="Conversión" value={formatRate(rates.conversionRate)} mono />
          <StatCell label="Pendientes" value={formatRate(rates.pendingRate)} mono />
        </div>
      </div>

      {/* Cost */}
      <div>
        <SectionLabel>Costo (USD)</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatCell label="Costo total" value={formatUsd(cost.totalProviderCostUsd, 2)} mono />
          <StatCell label="Créditos" value={formatInt(cost.totalProviderCredits)} mono />
          <StatCell
            label="Costo / persistido"
            value={formatNullableUsd(cost.costPerPersistedCandidate)}
            mono
          />
          <StatCell
            label="Costo / aprobado"
            value={formatNullableUsd(cost.costPerApprovedCandidate)}
            mono
          />
          <StatCell
            label="Costo / cuenta"
            value={formatNullableUsd(cost.costPerConvertedAccount)}
            mono
          />
        </div>
      </div>

      {/* Provider breakdown */}
      <div>
        <SectionLabel>Desglose por proveedor</SectionLabel>
        <ProviderBreakdownTable rows={providerBreakdown} />
      </div>
    </div>
  );
}

// ============================================================
// Async server component — fetches + renders every state
// ============================================================

export async function Agent1EffectivenessPanel({
  filters,
}: {
  filters: Agent1EffectivenessFilters;
}) {
  const result = await getAgent1EffectivenessPanel(filters);

  if (result.status === 'restricted') {
    return (
      <PanelShell>
        <PanelMessage tone="info">
          Esta vista requiere permisos de administrador para mostrar la efectividad del Agente 1.
        </PanelMessage>
      </PanelShell>
    );
  }

  if (result.status === 'error') {
    return (
      <PanelShell>
        <PanelMessage tone="error">
          No se pudo calcular la efectividad del Agente 1 en este momento. Inténtalo de nuevo más tarde.
        </PanelMessage>
      </PanelShell>
    );
  }

  const { summary } = result;
  const hasData = summary.funnel.batchesCount > 0;

  return (
    <PanelShell>
      {hasData ? (
        <SummaryBody summary={summary} />
      ) : (
        <PanelMessage tone="info">
          No hay datos suficientes para calcular efectividad del Agente 1 en este rango.
        </PanelMessage>
      )}
    </PanelShell>
  );
}
