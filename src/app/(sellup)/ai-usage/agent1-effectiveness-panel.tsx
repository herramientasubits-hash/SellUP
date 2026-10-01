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
  Sparkles,
  Filter,
} from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getAgent1EffectivenessPanel } from '@/modules/agent1-effectiveness';
import type {
  Agent1EffectivenessFilters,
  Agent1EffectivenessSummary,
  Agent1CostCompletenessFlag,
  CleanProductionSummary,
  CleanProductionWarning,
  OriginBreakdown,
  RejectionReasonBreakdown,
  ClassificationSourceBreakdown,
  RecordOrigin,
  RejectionReason,
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
// Clean-production label maps (Q3F-5AY.5)
// ============================================================

/** Origins EXCLUDED from clean production (everything except 'production'). */
const NON_PRODUCTION_ORIGINS: ReadonlyArray<Exclude<RecordOrigin, 'production'>> = [
  'smoke_test',
  'qa',
  'historical_cleanup',
  'import',
  'synthetic',
  'unknown',
];

const RECORD_ORIGIN_LABELS: Record<RecordOrigin, string> = {
  production: 'Producción',
  smoke_test: 'Smoke test',
  qa: 'QA',
  historical_cleanup: 'Limpieza histórica',
  import: 'Importación',
  synthetic: 'Sintético',
  unknown: 'Desconocido',
};

const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  test_record: 'Registro de prueba',
  cleanup_record: 'Registro de limpieza',
  duplicate: 'Duplicado',
  unknown: 'Desconocido',
  outside_icp: 'Fuera de ICP',
  existing_account: 'Cuenta existente',
  insufficient_data: 'Datos insuficientes',
  invalid_company: 'Empresa inválida',
  provider_noise: 'Ruido de proveedor',
  marketplace_or_directory: 'Marketplace o directorio',
  geographic_mismatch: 'Desajuste geográfico',
  industry_mismatch: 'Desajuste de industria',
  do_not_use: 'No usar',
  no_longer_relevant: 'Ya no relevante',
  other: 'Otro',
};

/** Human-readable text for each clean-production warning code (never hidden data). */
const CLEAN_PRODUCTION_WARNING_LABELS: Record<CleanProductionWarning, string> = {
  unknown_origin_present:
    'Hay candidatos con origen desconocido; se excluyen de producción limpia por defecto.',
  high_unknown_discarded_share:
    'Proporción alta de candidatos con origen desconocido: la producción limpia puede subrepresentar el corpus real.',
  clean_cost_attribution_is_batch_level:
    'Costo limpio no disponible: la atribución actual de costo es a nivel de lote.',
};

// ============================================================
// Completeness flag → badge config (non-alarmist)
// ============================================================

const COMPLETENESS_CONFIG: Record<
  Agent1CostCompletenessFlag,
  { label: string; variant: 'positive' | 'warning' | 'neutral'; Icon: typeof CheckCircle2 }
> = {
  complete: {
    label: 'Costo completo',
    variant: 'positive',
    Icon: CheckCircle2,
  },
  partial_missing_llm_cost: {
    label: 'Costo parcial · falta LLM',
    variant: 'warning',
    Icon: AlertTriangle,
  },
  partial_missing_provider_pricing: {
    label: 'Costo parcial · falta pricing',
    variant: 'warning',
    Icon: AlertTriangle,
  },
  partial_missing_candidate_outcomes: {
    label: 'Funnel parcial',
    variant: 'warning',
    Icon: AlertTriangle,
  },
  unknown: {
    label: 'Datos insuficientes',
    variant: 'neutral',
    Icon: Info,
  },
};

function CompletenessBadge({ flag }: { flag: Agent1CostCompletenessFlag }) {
  const cfg = COMPLETENESS_CONFIG[flag] ?? COMPLETENESS_CONFIG.unknown;
  const { Icon } = cfg;
  return (
    <Badge variant={cfg.variant}>
      <Icon aria-hidden="true" />
      {cfg.label}
    </Badge>
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
    <div className="rounded-lg border border-border/60 bg-surface-subtle px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">
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
    <p className="mb-2 text-xs font-semibold text-muted-foreground">
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
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
            <TrendingUp className="h-4 w-4 text-primary" />
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
      : 'border-border/60 bg-surface-subtle';
  const Icon = tone === 'error' ? AlertTriangle : Info;
  const iconColor = tone === 'error' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${classes}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

export function Agent1EffectivenessPanelSkeleton() {
  return (
    <PanelShell>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-24 rounded-lg" />
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60">
            {['Proveedor', 'Operación', 'Logs', 'Créditos', 'Resultados', 'Costo est.', 'Sin costo', 'Costo 0'].map(
              (h) => (
                <th
                  key={h}
                  className={`pb-2.5 text-xs font-semibold text-muted-foreground ${
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
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-surface-subtle">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-foreground">
                    {providerDisplayName(r.providerKey)}
                  </span>
                </div>
              </td>
              <td className="py-3 pr-4 text-muted-foreground max-w-44 truncate" title={r.operationKey}>
                {r.operationKey.replace(/_/g, ' ')}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{r.usageLogsCount}</td>
              <td className="py-3 pr-4 text-right font-mono tabular-nums text-muted-foreground">
                {r.credits.toLocaleString('es-ES')}
              </td>
              <td className="py-3 pr-4 text-right text-muted-foreground">{r.resultsReturned}</td>
              <td className="py-3 pr-4 text-right font-mono tabular-nums text-muted-foreground">
                {r.estimatedCostUsd === 0 && r.missingCostRows === 0 ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  formatUsd(r.estimatedCostUsd, 2)
                )}
              </td>
              <td className="py-3 pr-4 text-right">
                {r.missingCostRows > 0 ? (
                  <span className="font-mono text-warning">{r.missingCostRows}</span>
                ) : (
                  <span className="text-text-muted">0</span>
                )}
              </td>
              <td className="py-3 text-right">
                {r.zeroCostRows > 0 ? (
                  <span className="font-mono tabular-nums text-muted-foreground">{r.zeroCostRows}</span>
                ) : (
                  <span className="text-text-muted">0</span>
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
// Clean-production section (Q3F-5AY.5)
// ============================================================

/** Small count chip for origin / rejection breakdowns. */
function BreakdownChip({
  label,
  count,
  tone = 'neutral',
}: {
  label: string;
  count: number;
  tone?: 'neutral' | 'brand' | 'warn';
}) {
  const variant = tone === 'brand' ? 'brand' : tone === 'warn' ? 'warning' : 'neutral';
  return (
    <Badge variant={variant}>
      {label}
      <span className="font-mono font-semibold tabular-nums">{count.toLocaleString('es-ES')}</span>
    </Badge>
  );
}

function OriginBreakdownChips({ breakdown }: { breakdown: OriginBreakdown }) {
  // Production first (brand), then non-production origins with any count.
  const entries: Array<{ origin: RecordOrigin; count: number }> = [
    { origin: 'production', count: breakdown.production },
    ...NON_PRODUCTION_ORIGINS.map((origin) => ({ origin, count: breakdown[origin] })),
  ];
  const visible = entries.filter((e) => e.origin === 'production' || e.count > 0);

  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin candidatos clasificados en este alcance.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {visible.map(({ origin, count }) => (
        <BreakdownChip
          key={origin}
          label={RECORD_ORIGIN_LABELS[origin]}
          count={count}
          tone={origin === 'production' ? 'brand' : origin === 'unknown' ? 'warn' : 'neutral'}
        />
      ))}
    </div>
  );
}

function RejectionBreakdownChips({ breakdown }: { breakdown: RejectionReasonBreakdown }) {
  const entries = (Object.entries(breakdown) as Array<[RejectionReason, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin motivos de rechazo clasificados en este alcance.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([reason, count]) => (
        <BreakdownChip
          key={reason}
          label={REJECTION_REASON_LABELS[reason] ?? reason}
          count={count}
        />
      ))}
    </div>
  );
}

function CleanProductionSection({
  cleanProduction,
  originBreakdown,
  rejectionReasonBreakdown,
  classificationSourceBreakdown,
  classificationWarnings,
}: {
  cleanProduction: CleanProductionSummary;
  originBreakdown: OriginBreakdown;
  rejectionReasonBreakdown: RejectionReasonBreakdown;
  classificationSourceBreakdown: ClassificationSourceBreakdown;
  classificationWarnings: CleanProductionWarning[];
}) {
  const { funnel, rates, excludedFromCleanProductionCount, unknownOriginCount, cleanCostUsd } =
    cleanProduction;

  return (
    <div className="space-y-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
      {/* Header + scope badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Producción limpia</p>
            <p className="text-xs text-muted-foreground">
              Solo candidatos de origen productivo real.
            </p>
          </div>
        </div>
        <Badge variant="neutral">
          <Filter aria-hidden="true" />
          Excluye QA, smoke, cleanup e import
        </Badge>
      </div>

      {/* Clean funnel */}
      <div>
        <SectionLabel>Funnel limpio</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCell label="Candidatos limpios" value={formatInt(funnel.persistedCandidatesCount)} mono />
          <StatCell label="Pendientes" value={formatInt(funnel.pendingCandidatesCount)} mono />
          <StatCell label="Aprobados" value={formatInt(funnel.approvedCandidatesCount)} mono />
          <StatCell label="Rechazados" value={formatInt(funnel.rejectedCandidatesCount)} mono />
          <StatCell label="Convertidos" value={formatInt(funnel.convertedAccountsCount)} mono />
          <StatCell label="Excluidos" value={formatInt(excludedFromCleanProductionCount)} mono />
        </div>
      </div>

      {/* Clean rates */}
      <div>
        <SectionLabel>Tasas limpias (sobre candidatos limpios)</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCell label="Aprobación limpia" value={formatRate(rates.approvalRate)} mono />
          <StatCell label="Rechazo limpio" value={formatRate(rates.rejectionRate)} mono />
          <StatCell label="Conversión limpia" value={formatRate(rates.conversionRate)} mono />
        </div>
      </div>

      {/* Clean cost caveat */}
      <div>
        <SectionLabel>Costo limpio (USD)</SectionLabel>
        {cleanCostUsd === null ? (
          <PanelMessage tone="info">
            Costo limpio no disponible: la atribución actual de costo es a nivel de lote.
          </PanelMessage>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCell label="Costo limpio" value={formatUsd(cleanCostUsd, 2)} mono />
          </div>
        )}
      </div>

      {/* Origin breakdown */}
      <div>
        <SectionLabel>Desglose por origen</SectionLabel>
        <OriginBreakdownChips breakdown={originBreakdown} />
      </div>

      {/* Rejection reason breakdown */}
      <div>
        <SectionLabel>Motivos de rechazo</SectionLabel>
        <RejectionBreakdownChips breakdown={rejectionReasonBreakdown} />
      </div>

      {/* Classification source breakdown */}
      <div>
        <SectionLabel>Fuente de clasificación</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <BreakdownChip label="Persistido" count={classificationSourceBreakdown.persisted} />
          <BreakdownChip
            label="Derivado en runtime"
            count={classificationSourceBreakdown.derived_runtime}
          />
          {unknownOriginCount > 0 && (
            <BreakdownChip label="Origen desconocido" count={unknownOriginCount} tone="warn" />
          )}
        </div>
      </div>

      {/* Classification warnings */}
      {classificationWarnings.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3">
          {classificationWarnings.map((code) => (
            <div key={code} className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {CLEAN_PRODUCTION_WARNING_LABELS[code] ?? code}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Summary body (funnel + rates + cost + provider breakdown)
// ============================================================

function SummaryBody({ summary }: { summary: Agent1EffectivenessSummary }) {
  const {
    funnel,
    rates,
    cost,
    warnings,
    costCompletenessFlag,
    providerBreakdown,
    cleanProduction,
    originBreakdown,
    rejectionReasonBreakdown,
    classificationSourceBreakdown,
    classificationWarnings,
  } = summary;

  return (
    <div className="space-y-6">
      {/* Completeness + warnings */}
      <div className="flex flex-wrap items-center gap-2">
        <CompletenessBadge flag={costCompletenessFlag} />
        {funnel.generatedCandidatesCount !== null && (
          <span className="text-xs text-muted-foreground">
            {formatInt(funnel.generatedCandidatesCount)} candidatos generados (best-effort)
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-xs leading-relaxed text-muted-foreground">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Funnel */}
      <div>
        <SectionLabel>Funnel · histórico total</SectionLabel>
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
        <SectionLabel>Costo histórico total (USD)</SectionLabel>
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

      {/* Clean production (Q3F-5AY.5) */}
      <CleanProductionSection
        cleanProduction={cleanProduction}
        originBreakdown={originBreakdown}
        rejectionReasonBreakdown={rejectionReasonBreakdown}
        classificationSourceBreakdown={classificationSourceBreakdown}
        classificationWarnings={classificationWarnings}
      />

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
