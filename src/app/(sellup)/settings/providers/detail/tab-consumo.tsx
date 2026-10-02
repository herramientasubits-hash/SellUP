'use client';

/**
 * tab-consumo.tsx — pestaña «Consumo» del panel de un proveedor: los filtros,
 * el total del período, en qué operaciones y usuarios se fue, las reglas que
 * lo limitan y las últimas operaciones. Solo lee.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { BarChart2, History, ScrollText, Users, Zap } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable } from '@/components/data-table';
import { BarList } from '@/components/charts/BarList';
import { Timeline, TimelineItem } from '@/components/data-display';
import { Heading } from '@/components/typography';
import { DrawerSection } from '@/components/shared/drawer-section';
import { CostValue, CreditsValue } from '@/components/shared/cost-value';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { MeasurementStatus } from '@/modules/budgets/provider-measurement';
import { getProviderOperationLabel } from '@/modules/budgets/operation-labels';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import { resolveCreditsTotalsDisplay } from '@/modules/usage-tracking/credits-display';
import { loadProviderConsumptionForWorkspace } from '../provider-consumption-actions';
import type {
  ConsumptionErrorStage,
  ProviderConsumptionLogEntry,
  ProviderConsumptionSnapshot,
  ProviderOperationBreakdownRow,
  ProviderUserConsumptionBreakdownRow,
  UsageFilters,
} from '../provider-consumption-types';
import {
  buildOperationRanking,
  buildUserRanking,
  formatRankingValue,
  OPERATION_BREAKDOWN_PAGE_SIZE,
  RANKING_LIMIT,
  USER_CONSUMPTION_PAGE_SIZE,
  useOperationColumns,
  userConsumptionRowId,
  useUserColumns,
  type ConsumptionRanking,
} from './consumption-breakdown';
import { deriveRemainingInfo, formatAmount, formatDateShort, formatLogSpend } from './detail-format';
import { EmptyBlock, InfoList, InfoRow, LoadingBlock, RetryAlert } from './detail-shared';
import { UsageFilterBar, useUsageFilters } from './usage-filter-bar';

const RECENT_OPERATIONS_LIMIT = 5;

const CONSUMPTION_KPI_LABEL: Record<NonNullable<UsageFilters['period']>, string> = {
  current_month: 'Consumo del mes',
  '7d': 'Consumo · últimos 7 días',
  '30d': 'Consumo · últimos 30 días',
  all: 'Consumo acumulado',
};

const STAGE_LABEL: Record<ConsumptionErrorStage, string> = {
  authorization: 'Permisos de administrador',
  provider_stats: 'Métricas de consumo',
  operation_stats: 'Distribución por operación',
  recent_logs: 'Operaciones recientes',
  user_consumption: 'Consumo por usuario',
  filter_options: 'Opciones de filtro',
  mapping: 'Preparación de datos',
};

// Presentation-only signal (Q3F-9G Paso 14): true when the snapshot carries
// any real activity, regardless of which block it shows up in. Deliberately
// ignores per-row hasUnknownCost — an unknown-cost flag with zero underlying
// calls/credits/rows must not read as "there is data".
export function hasProviderConsumptionData(snapshot: ProviderConsumptionSnapshot): boolean {
  return (
    snapshot.totalCalls > 0 ||
    (snapshot.totalCredits ?? 0) > 0 ||
    snapshot.totalCostUsd > 0 ||
    snapshot.successCalls > 0 ||
    snapshot.errorCalls > 0 ||
    snapshot.operationBreakdown.length > 0 ||
    snapshot.userConsumption.length > 0 ||
    snapshot.recentLogs.length > 0
  );
}

// ── Total del período ─────────────────────────────────────────────────────────

function KpiItem({ label, children, valueClassName = 'text-foreground' }: {
  label: string;
  children: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${valueClassName}`}>{children}</dd>
    </div>
  );
}

/** El total del período filtrado: créditos, costo y operaciones. */
export function ConsumptionTotals({ snapshot }: { snapshot: ProviderConsumptionSnapshot | null }) {
  const filteredCredits = snapshot?.totalCredits ?? null;
  const filteredCost = snapshot?.totalCostUsd ?? 0;
  const errorCalls = snapshot?.errorCalls ?? 0;
  const hasUnknownCredits = snapshot?.hasUnknownCredits ?? false;
  const hasUnknownCost = snapshot?.hasUnknownCost ?? false;

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
      <KpiItem label="Créditos consumidos">
        {filteredCredits == null && !hasUnknownCredits ? (
          '—'
        ) : (
          <CreditsValue
            display={resolveCreditsTotalsDisplay({
              totals: {
                knownCreditsTotal: filteredCredits ?? 0,
                unknownCreditOperations: snapshot?.unknownCreditOperations ?? 0,
                hasUnknownCredits,
              },
              formatCredits: (v) => `${v.toLocaleString()} cr`,
            })}
          />
        )}
      </KpiItem>
      <KpiItem label="Costo estimado">
        {filteredCost === 0 && !hasUnknownCost ? (
          '—'
        ) : (
          <CostValue
            display={resolveCostDisplay({
              valueUsd: filteredCost,
              costTruth: toCostTruth(hasUnknownCost),
              formatUsd: (v) => `$${v.toFixed(4)}`,
            })}
          />
        )}
      </KpiItem>
      <KpiItem label="Operaciones">{(snapshot?.totalCalls ?? 0).toLocaleString()}</KpiItem>
      <KpiItem label="Exitosas" valueClassName="text-success">
        {(snapshot?.successCalls ?? 0).toLocaleString()}
      </KpiItem>
      <KpiItem label="Con error" valueClassName={errorCalls > 0 ? 'text-destructive' : 'text-foreground'}>
        {errorCalls.toLocaleString()}
      </KpiItem>
    </dl>
  );
}

// ── Rankings ──────────────────────────────────────────────────────────────────

function RankingSection({ title, hint, icon, ranking }: {
  title: string;
  hint: string;
  icon: typeof Zap;
  ranking: ConsumptionRanking;
}) {
  return (
    <DrawerSection title={title} hint={hint} icon={icon} className="min-w-0">
      <BarList
        items={ranking.items}
        limit={RANKING_LIMIT}
        formatValue={formatRankingValue(ranking.metric)}
      />
    </DrawerSection>
  );
}

/** En qué se fue el consumo: las operaciones y los usuarios que más gastaron. */
export function ConsumptionRankings({ providerKey, operationBreakdown, userConsumption }: {
  providerKey: string;
  operationBreakdown: ProviderOperationBreakdownRow[];
  userConsumption: ProviderUserConsumptionBreakdownRow[];
}) {
  const operationRanking = buildOperationRanking(providerKey, operationBreakdown);
  const userRanking = buildUserRanking(userConsumption);
  if (!operationRanking && !userRanking) return null;
  const unit = (ranking: ConsumptionRanking) => (ranking.metric === 'credits' ? 'créditos' : 'costo estimado');

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {operationRanking && (
        <RankingSection
          title="Operaciones que más consumen"
          hint={`Las ${RANKING_LIMIT} primeras por ${unit(operationRanking)} en este período.`}
          icon={Zap}
          ranking={operationRanking}
        />
      )}
      {userRanking && (
        <RankingSection
          title="Usuarios que más consumen"
          hint={`Los ${RANKING_LIMIT} primeros por ${unit(userRanking)} en este período.`}
          icon={Users}
          ranking={userRanking}
        />
      )}
    </div>
  );
}

// ── Tablas de desglose ────────────────────────────────────────────────────────

function BreakdownHeading({ children }: { children: string }) {
  return (
    <Heading level={6} as="h3" tone="muted" className="px-1 text-xs">
      {children}
    </Heading>
  );
}

function BreakdownTables({ providerKey, isPending, operationBreakdown, userConsumption }: {
  providerKey: string;
  isPending: boolean;
  operationBreakdown: ProviderOperationBreakdownRow[];
  userConsumption: ProviderUserConsumptionBreakdownRow[];
}) {
  const operationColumns = useOperationColumns(providerKey);
  const userColumns = useUserColumns();

  return (
    <>
      {/* Distribución por operación — misma scope que el total de arriba */}
      <div className="space-y-1.5">
        <BreakdownHeading>Distribución por operación</BreakdownHeading>
        {isPending ? (
          <LoadingBlock label="Calculando distribución..." />
        ) : operationBreakdown.length === 0 ? (
          <EmptyState
            title="Sin consumo por operación"
            description="No hay operaciones registradas para los filtros seleccionados."
            className="p-6"
          />
        ) : (
          <DataTable
            tableId="provider-operation-breakdown"
            noun="operaciones"
            nounGender="f"
            // Resumen corto dentro de un panel: se lee por páginas.
            defaultRowsMode="paged"
            columns={operationColumns}
            data={operationBreakdown}
            getRowId={(op) => op.operationKey}
            hideToolbar
            enableColumnReorder={false}
            initialPageSize={OPERATION_BREAKDOWN_PAGE_SIZE}
            className="text-xs"
          />
        )}
      </div>

      {/* Consumo por usuario — misma scope que el total de arriba (Q3F-9) */}
      <div className="space-y-1.5">
        <BreakdownHeading>Consumo por usuario</BreakdownHeading>
        {isPending ? (
          <LoadingBlock label="Calculando consumo por usuario..." />
        ) : userConsumption.length === 0 ? (
          <EmptyState
            title="Sin consumo por usuario"
            description="No hay usuarios con consumo registrado para los filtros seleccionados."
            className="p-6"
          />
        ) : (
          <DataTable
            tableId="provider-user-consumption"
            noun="usuarios"
            defaultRowsMode="paged"
            columns={userColumns}
            data={userConsumption}
            getRowId={userConsumptionRowId}
            hideToolbar
            enableColumnReorder={false}
            initialPageSize={USER_CONSUMPTION_PAGE_SIZE}
            className="text-xs"
          />
        )}
      </div>
    </>
  );
}

// ── Reglas y operaciones recientes ────────────────────────────────────────────

/** Reglas de consumo — estáticas, no cambian con los filtros analíticos. */
function ConsumptionRulesSection({ row }: { row: AdminProviderBudgetRow }) {
  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
  const remaining = deriveRemainingInfo(row.remainingCredits, row.remainingUsd, row.hasUnknownCost);

  return (
    <DrawerSection title="Reglas de consumo" icon={ScrollText} tone="neutral">
      {hasGlobalRule ? (
        <InfoList>
          <InfoRow label="Límite global" value={formatAmount(row.globalLimitCredits, row.globalLimitUsd)} />
          <InfoRow
            label="Disponible por regla"
            value={<span title={remaining.description}>{remaining.label}</span>}
          />
        </InfoList>
      ) : (
        <div>
          <p className="text-sm text-foreground">Sin regla global</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pueden aplicar reglas por rol, grupo o usuario.
          </p>
        </div>
      )}
    </DrawerSection>
  );
}

export function RecentOperationsSection({ providerKey, recentLogs, isPending }: {
  providerKey: string;
  recentLogs: ProviderConsumptionLogEntry[];
  isPending: boolean;
}) {
  const recentOps = recentLogs.slice(0, RECENT_OPERATIONS_LIMIT);
  const visibleCount = Math.min(RECENT_OPERATIONS_LIMIT, recentLogs.length);

  return (
    <DrawerSection
      title="Operaciones recientes"
      hint={recentLogs.length > 0 ? `Últimas ${visibleCount} de ${recentLogs.length} cargadas` : undefined}
      icon={History}
      tone="neutral"
    >
      {isPending ? (
        <LoadingBlock label="Cargando operaciones..." />
      ) : recentOps.length === 0 ? (
        <EmptyBlock
          message="Sin operaciones recientes"
          sub="No hay operaciones registradas para los filtros seleccionados."
        />
      ) : (
        <Timeline>
          {recentOps.map((log) => (
            <TimelineItem
              key={log.id}
              density="compact"
              title={getProviderOperationLabel(providerKey, log.operationKey ?? '')}
              time={formatDateShort(log.createdAt)}
              description={formatLogSpend(log.creditsUsed, log.estimatedCostUsd) || undefined}
            />
          ))}
        </Timeline>
      )}
    </DrawerSection>
  );
}

// ── Pestaña ───────────────────────────────────────────────────────────────────

export interface TabConsumoProps {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  providerKey: string;
  isActive: boolean;
}

export function TabConsumo({ row, ms, providerKey, isActive }: TabConsumoProps) {
  const [snapshot, setSnapshot] = useState<ProviderConsumptionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diagnosticStage, setDiagnosticStage] = useState<ConsumptionErrorStage | null>(null);
  const [isPending, startTransition] = useTransition();
  const seqRef = useRef(0);

  const options = snapshot?.filterOptions;
  const filterState = useUsageFilters({ initial: { period: 'current_month' }, options, keepAllPeriod: true });
  const { filters } = filterState;

  const loadConsumptionSnapshot = useCallback(() => {
    const seq = ++seqRef.current;
    startTransition(async () => {
      try {
        const result = await loadProviderConsumptionForWorkspace(providerKey, filters);
        if (seq !== seqRef.current) return;
        if (result.ok) {
          setSnapshot(result.snapshot);
          setLoadError(null);
          setDiagnosticStage(null);
        } else {
          setLoadError('No fue posible cargar el consumo de este proveedor.');
          setDiagnosticStage(result.errorStage);
        }
      } catch {
        if (seq === seqRef.current) {
          setLoadError('No fue posible cargar el consumo de este proveedor.');
          setDiagnosticStage(null);
        }
      }
    });
  }, [providerKey, filters]);

  useEffect(() => {
    if (!isActive) return;
    loadConsumptionSnapshot();
  }, [isActive, loadConsumptionSnapshot]);

  const period = filters.period ?? 'current_month';
  const operationBreakdown = snapshot?.operationBreakdown ?? [];
  const userConsumption = snapshot?.userConsumption ?? [];

  // Q3F-9G Paso 14/15: one consolidated empty state instead of four separate
  // ones when the filtered snapshot carries no activity at all. Gated behind
  // "snapshot loaded successfully" so it never fires during loading or on a
  // query failure (Paso 18 — failure keeps the error containment above).
  const hasConsumptionData = snapshot ? hasProviderConsumptionData(snapshot) : false;
  const showGlobalEmpty = !isPending && !loadError && !!snapshot && !hasConsumptionData;

  return (
    <div className="space-y-4">
      {/* Error contenido — no tumba el sidepanel */}
      {loadError && (
        <RetryAlert title={loadError} onRetry={() => { if (isActive) loadConsumptionSnapshot(); }}>
          {diagnosticStage && <p>No se pudo cargar: {STAGE_LABEL[diagnosticStage]}</p>}
          <p>Puedes reintentar sin cerrar el workspace.</p>
        </RetryAlert>
      )}

      <UsageFilterBar {...filterState} options={options} defaultPeriod="current_month" />

      {/* Q3F-9G Problema B: one consolidated empty state instead of KPI +
          Distribución + Consumo por usuario each showing their own empty. */}
      {showGlobalEmpty ? (
        <EmptyState
          title="Sin consumo registrado"
          description="No encontramos consumo de este proveedor para los filtros seleccionados. Ajusta los filtros para consultar otro período, usuario o contexto."
          className="p-6"
        />
      ) : (
        <>
          <DrawerSection title={CONSUMPTION_KPI_LABEL[period]} icon={BarChart2}>
            {isPending ? <LoadingBlock label="Calculando..." /> : <ConsumptionTotals snapshot={snapshot} />}
            {row.quotaSyncedAt && (
              <div className="mt-3 border-t border-border/50 pt-3">
                <InfoList>
                  <InfoRow
                    label="Cuota disponible (API)"
                    value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
                  />
                </InfoList>
              </div>
            )}
          </DrawerSection>

          {!isPending && (
            <ConsumptionRankings
              providerKey={providerKey}
              operationBreakdown={operationBreakdown}
              userConsumption={userConsumption}
            />
          )}

          <BreakdownTables
            providerKey={providerKey}
            isPending={isPending}
            operationBreakdown={operationBreakdown}
            userConsumption={userConsumption}
          />
        </>
      )}

      <ConsumptionRulesSection row={row} />

      {/* Operaciones recientes — oculto durante el empty global (Problema B);
          empty parcial propio cuando sí hay consumo pero sin logs recientes
          (Problema C). */}
      {ms === 'active' && !showGlobalEmpty && (
        <RecentOperationsSection
          providerKey={providerKey}
          recentLogs={snapshot?.recentLogs ?? []}
          isPending={isPending}
        />
      )}
    </div>
  );
}
