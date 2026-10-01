// Q3F-5AX.4 — Agent 1 Effectiveness panel for /ai-usage.
//
// Read-only display surface wired to the agent1-effectiveness read model
// (prospect_batches → prospect_candidates → provider_usage_logs, joined by
// batch_id; NOT agent_runs). No provider calls, no writes, no client state.
// Streams independently via <Suspense> so its loading/error states never block
// the rest of the page.
//
// Presentación: una pila de secciones (resumen, embudo, prospectos reales,
// costo por proveedor), cada una en su propia tarjeta. Las cifras van en listas
// de definiciones sin marco: nunca una caja dentro de otra.

import type { ReactNode } from 'react';
import { TrendingUp, Lock, Plug } from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { InfoHint } from '@/components/shared/info-hint';
import { StatusBadge, TableShell, type StatusType } from '@/components/data-display';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCount, formatUsd, humanizeKey, providerLabel } from './usage-labels';

// ============================================================
// Format helpers
// ============================================================

const UNAVAILABLE = 'Sin dato';

/** Per-outcome cost: null → "Sin dato" (never fake a divide-by-zero). */
function formatNullableUsd(usd: number | null, decimals = 4): string {
  return usd === null ? UNAVAILABLE : formatUsd(usd, decimals);
}

/** Rate is a 0..1 fraction; render as a percentage with 1 decimal. */
function formatRate(rate: number | null): string {
  return rate === null ? UNAVAILABLE : `${(rate * 100).toFixed(1)}%`;
}

function formatInt(n: number | null): string {
  return n === null ? UNAVAILABLE : formatCount(n);
}

// ============================================================
// Label maps — lenguaje de negocio, no de base de datos
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
  production: 'Búsquedas reales',
  smoke_test: 'Pruebas rápidas',
  qa: 'Pruebas internas',
  historical_cleanup: 'Limpieza de datos',
  import: 'Importación',
  synthetic: 'Datos de ejemplo',
  unknown: 'Sin identificar',
};

const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  test_record: 'Registro de prueba',
  cleanup_record: 'Limpieza de datos',
  duplicate: 'Duplicado',
  unknown: 'Sin motivo',
  outside_icp: 'Fuera del perfil de cliente',
  existing_account: 'Ya era cuenta',
  insufficient_data: 'Datos insuficientes',
  invalid_company: 'Empresa no válida',
  provider_noise: 'Resultado irrelevante',
  marketplace_or_directory: 'Marketplace o directorio',
  geographic_mismatch: 'Otro país o región',
  industry_mismatch: 'Otra industria',
  do_not_use: 'No usar',
  no_longer_relevant: 'Ya no es relevante',
  other: 'Otro',
};

/** Human-readable text for each clean-production warning code (never hidden data). */
const CLEAN_PRODUCTION_WARNING_LABELS: Record<CleanProductionWarning, string> = {
  unknown_origin_present:
    'Hay candidatos sin origen identificado; no se cuentan como prospectos reales.',
  high_unknown_discarded_share:
    'Muchos candidatos no tienen origen identificado: estas cifras pueden quedarse cortas.',
  clean_cost_attribution_is_batch_level:
    'El costo se registra por lote completo, así que no se puede separar el de los prospectos reales.',
};

// ============================================================
// Completeness flag → status (non-alarmist)
// ============================================================

const COMPLETENESS_CONFIG: Record<Agent1CostCompletenessFlag, { label: string; status: StatusType }> = {
  complete: { label: 'Costo completo', status: 'completed' },
  partial_missing_llm_cost: {
    label: 'Costo parcial · falta el del modelo de IA',
    status: 'warning',
  },
  partial_missing_provider_pricing: {
    label: 'Costo parcial · falta la tarifa de un proveedor',
    status: 'warning',
  },
  partial_missing_candidate_outcomes: { label: 'Embudo incompleto', status: 'warning' },
  unknown: { label: 'Datos insuficientes', status: 'neutral' },
};

function CompletenessBadge({ flag }: { flag: Agent1CostCompletenessFlag }) {
  const cfg = COMPLETENESS_CONFIG[flag] ?? COMPLETENESS_CONFIG.unknown;
  return <StatusBadge status={cfg.status} label={cfg.label} />;
}

// ============================================================
// Building blocks
// ============================================================

type StatColumns = 3 | 4 | 5 | 6;

const STAT_COLUMNS: Record<StatColumns, string> = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

/** Un grupo de cifras con su título: lista de definiciones, sin marco propio. */
function StatGroup({
  title,
  columns,
  children,
}: {
  title: string;
  columns: StatColumns;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 ${STAT_COLUMNS[columns]}`}>{children}</dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function ChipGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function NoteList({ title, notes }: { title: string; notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <Alert variant="warning" role="note">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function Agent1EffectivenessPanelSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}

// ============================================================
// Provider breakdown table
// ============================================================

const PROVIDER_BREAKDOWN_COLUMNS: ReadonlyArray<{ label: string; align: 'left' | 'right' }> = [
  { label: 'Proveedor', align: 'left' },
  { label: 'Qué se pidió', align: 'left' },
  { label: 'Consultas', align: 'right' },
  { label: 'Créditos', align: 'right' },
  { label: 'Resultados', align: 'right' },
  { label: 'Costo estimado', align: 'right' },
  { label: 'Sin tarifa', align: 'right' },
  { label: 'Gratis', align: 'right' },
];

function ProviderBreakdownSection({
  rows,
}: {
  rows: Agent1EffectivenessSummary['providerBreakdown'];
}) {
  return (
    <TableShell
      title="Costo por proveedor"
      description="Lo que consumieron las búsquedas del Agente 1, por proveedor y tipo de consulta."
      actions={
        <InfoHint showLabel>
          «Sin tarifa» son consultas cuyo costo aún no se conoce; «Gratis», consultas que el
          proveedor no cobró.
        </InfoHint>
      }
      empty={rows.length === 0}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Plug}
          title="Sin consumo de proveedores en este periodo"
          description="Aparecerá cuando el Agente 1 busque empresas. Prueba con otro periodo o quita el filtro de proveedor."
        />
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            {PROVIDER_BREAKDOWN_COLUMNS.map((column) => (
              <TableHead
                key={column.label}
                scope="col"
                className={column.align === 'left' ? 'text-left' : 'text-right'}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.providerKey}::${r.operationKey}`}>
              <TableCell className="font-medium text-foreground">{providerLabel(r.providerKey)}</TableCell>
              <TableCell className="max-w-44 truncate text-muted-foreground" title={humanizeKey(r.operationKey)}>
                {humanizeKey(r.operationKey)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCount(r.usageLogsCount)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCount(r.credits)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCount(r.resultsReturned)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.estimatedCostUsd === 0 && r.missingCostRows === 0 ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  formatUsd(r.estimatedCostUsd, 2)
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.missingCostRows > 0 ? (
                  <span className="font-medium text-warning">{formatCount(r.missingCostRows)}</span>
                ) : (
                  <span className="text-text-muted">0</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.zeroCostRows > 0 ? (
                  <span className="text-muted-foreground">{formatCount(r.zeroCostRows)}</span>
                ) : (
                  <span className="text-text-muted">0</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
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
      <span className="font-semibold tabular-nums">{formatCount(count)}</span>
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

  return (
    <>
      {visible.map(({ origin, count }) => (
        <BreakdownChip
          key={origin}
          label={RECORD_ORIGIN_LABELS[origin]}
          count={count}
          tone={origin === 'production' ? 'brand' : origin === 'unknown' ? 'warn' : 'neutral'}
        />
      ))}
    </>
  );
}

function RejectionBreakdownChips({ breakdown }: { breakdown: RejectionReasonBreakdown }) {
  const entries = (Object.entries(breakdown) as Array<[RejectionReason, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nadie ha rechazado candidatos con motivo en este periodo.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([reason, count]) => (
        <BreakdownChip
          key={reason}
          label={REJECTION_REASON_LABELS[reason] ?? humanizeKey(reason)}
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
    <SurfaceCard>
      <SurfaceCardHeader
        title="Solo prospectos reales"
        description="Las mismas cifras sin pruebas, importaciones ni limpiezas de datos: lo que de verdad buscó tu equipo."
        actions={
          <InfoHint label="Cómo se separan">
            Cada candidato lleva anotado de dónde salió. En {formatCount(classificationSourceBreakdown.persisted)}{' '}
            ese origen quedó guardado al crearlo y en{' '}
            {formatCount(classificationSourceBreakdown.derived_runtime)} se dedujo al consultar.
          </InfoHint>
        }
      />

      <div className="space-y-4">
        <StatGroup title="Candidatos" columns={6}>
          <Stat label="Reales" value={formatInt(funnel.persistedCandidatesCount)} />
          <Stat label="Por revisar" value={formatInt(funnel.pendingCandidatesCount)} />
          <Stat label="Aprobados" value={formatInt(funnel.approvedCandidatesCount)} />
          <Stat label="Rechazados" value={formatInt(funnel.rejectedCandidatesCount)} />
          <Stat label="Ya son cuenta" value={formatInt(funnel.convertedAccountsCount)} />
          <Stat label="Dejados fuera" value={formatInt(excludedFromCleanProductionCount)} />
        </StatGroup>

        <StatGroup title="Qué pasó con ellos" columns={4}>
          <Stat label="Se aprobó" value={formatRate(rates.approvalRate)} />
          <Stat label="Se rechazó" value={formatRate(rates.rejectionRate)} />
          <Stat label="Pasó a cuenta" value={formatRate(rates.conversionRate)} />
          {cleanCostUsd !== null && <Stat label="Costo estimado" value={formatUsd(cleanCostUsd, 2)} />}
        </StatGroup>

        <ChipGroup title="De dónde salieron los candidatos">
          <div className="flex flex-wrap gap-2">
            <OriginBreakdownChips breakdown={originBreakdown} />
            {unknownOriginCount > 0 && originBreakdown.unknown === 0 && (
              <BreakdownChip label={RECORD_ORIGIN_LABELS.unknown} count={unknownOriginCount} tone="warn" />
            )}
          </div>
        </ChipGroup>

        <ChipGroup title="Por qué se rechazaron">
          <RejectionBreakdownChips breakdown={rejectionReasonBreakdown} />
        </ChipGroup>

        <NoteList
          title="Ten en cuenta"
          notes={[
            ...(cleanCostUsd === null && !classificationWarnings.includes('clean_cost_attribution_is_batch_level')
              ? [CLEAN_PRODUCTION_WARNING_LABELS.clean_cost_attribution_is_batch_level]
              : []),
            ...classificationWarnings.map((code) => CLEAN_PRODUCTION_WARNING_LABELS[code] ?? code),
          ]}
        />
      </div>
    </SurfaceCard>
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
      <NoteList title="Ten en cuenta" notes={warnings} />

      <SurfaceCard>
        <SurfaceCardHeader
          title="Embudo de prospectos"
          description="Todo lo que generó el Agente 1 en el periodo, de candidato a cuenta."
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <CompletenessBadge flag={costCompletenessFlag} />
              <InfoHint>
                Se cuentan los lotes de prospectos del periodo, qué pasó con cada candidato y lo
                que costaron sus consultas. Aquí solo aplican los filtros de periodo y proveedor.
              </InfoHint>
            </div>
          }
        />

        <div className="space-y-4">
          <StatGroup title="Candidatos" columns={6}>
            <Stat label="Lotes" value={formatInt(funnel.batchesCount)} />
            <Stat label="Guardados" value={formatInt(funnel.persistedCandidatesCount)} />
            <Stat label="Por revisar" value={formatInt(funnel.pendingCandidatesCount)} />
            <Stat label="Aprobados" value={formatInt(funnel.approvedCandidatesCount)} />
            <Stat label="Rechazados" value={formatInt(funnel.rejectedCandidatesCount)} />
            <Stat label="Ya son cuenta" value={formatInt(funnel.convertedAccountsCount)} />
          </StatGroup>
          {funnel.generatedCandidatesCount !== null && (
            <p className="text-xs text-muted-foreground">
              Los proveedores devolvieron cerca de{' '}
              <span className="font-medium tabular-nums text-foreground">
                {formatInt(funnel.generatedCandidatesCount)}
              </span>{' '}
              candidatos en total (cifra aproximada).
            </p>
          )}

          <StatGroup title="Qué pasó con los guardados" columns={4}>
            <Stat label="Se aprobó" value={formatRate(rates.approvalRate)} />
            <Stat label="Se rechazó" value={formatRate(rates.rejectionRate)} />
            <Stat label="Pasó a cuenta" value={formatRate(rates.conversionRate)} />
            <Stat label="Sigue por revisar" value={formatRate(rates.pendingRate)} />
          </StatGroup>

          <StatGroup title="Costo estimado (USD)" columns={5}>
            <Stat label="Total" value={formatUsd(cost.totalProviderCostUsd, 2)} />
            <Stat label="Créditos" value={formatInt(cost.totalProviderCredits)} />
            <Stat label="Por guardado" value={formatNullableUsd(cost.costPerPersistedCandidate)} />
            <Stat label="Por aprobado" value={formatNullableUsd(cost.costPerApprovedCandidate)} />
            <Stat label="Por cuenta" value={formatNullableUsd(cost.costPerConvertedAccount)} />
          </StatGroup>
        </div>
      </SurfaceCard>

      {/* Clean production (Q3F-5AY.5) */}
      <CleanProductionSection
        cleanProduction={cleanProduction}
        originBreakdown={originBreakdown}
        rejectionReasonBreakdown={rejectionReasonBreakdown}
        classificationSourceBreakdown={classificationSourceBreakdown}
        classificationWarnings={classificationWarnings}
      />

      <ProviderBreakdownSection rows={providerBreakdown} />
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
      <EmptyState
        icon={Lock}
        title="No tienes acceso a la efectividad del Agente 1"
        description="Estas cifras solo las ve quien administra SellUp."
      />
    );
  }

  if (result.status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>No se pudo calcular la efectividad del Agente 1</AlertTitle>
        <AlertDescription>Vuelve a cargar la página en unos minutos.</AlertDescription>
      </Alert>
    );
  }

  const { summary } = result;
  if (summary.funnel.batchesCount === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="El Agente 1 no generó prospectos en este periodo"
        description="Elige un periodo más amplio o quita el filtro de proveedor. Las cifras aparecen en cuanto se cree un lote de prospectos."
      />
    );
  }

  return <SummaryBody summary={summary} />;
}
