'use client';

/**
 * tab-resumen.tsx — pestaña «Resumen» del panel de un proveedor: qué es, cuánto
 * lleva gastado de su cuota, qué hizo por última vez, si sincroniza bien y qué
 * conviene revisar. Solo lectura; lo único que dispara es cambiar de pestaña.
 */

import { Activity, AlertTriangle, ArrowRight, Database, History, Zap } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DrawerSection } from '@/components/shared/drawer-section';
import { DistributionBar, type DistributionSegment } from '@/components/charts/DistributionBar';
import { Timeline, TimelineItem } from '@/components/data-display';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { parseBudgetCheck } from '@/modules/budgets/budget-check-parser';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import type { MeasurementStatus } from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  OPERATIONAL_TYPE_BADGE,
  OPERATIONAL_TYPE_LABEL,
} from '@/modules/budgets/provider-operational-type';
import type { ProviderSyncLogRow, ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';
import {
  deriveConsumedInfo,
  formatAllowance,
  formatAmount,
  formatDateShort,
  formatLogSpend,
  isFailedLogStatus,
  type SidepanelInitialTab,
} from './detail-format';
import { EmptyBlock, InfoList, InfoRow, LoadingBlock } from './detail-shared';

const RECENT_ACTIVITY_LIMIT = 3;
const QUOTA_WARNING_PERCENT = 70;
const QUOTA_CRITICAL_PERCENT = 90;

type SyncSignal = 'ok' | 'error' | 'none';

interface SuggestedAction {
  label: string;
  tab: SidepanelInitialTab;
  variant: 'warn' | 'info';
}

interface ActivityEntry {
  id: string;
  title: string;
  isError: boolean;
  spend: string;
  time: string;
}

export interface TabResumenProps {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  providerRules: BudgetRuleRow[];
  loadingDetail: boolean;
  onNavigate: (tab: SidepanelInitialTab) => void;
}

function resolveSyncedAt(row: AdminProviderBudgetRow, latestSyncLog: ProviderSyncLogRow | null): string | null {
  if (latestSyncLog) return formatDateShort(latestSyncLog.syncedAt);
  if (row.quotaSyncedAt) return formatDateShort(row.quotaSyncedAt);
  if (row.latestBudgetCheckLog?.createdAt) return formatDateShort(row.latestBudgetCheckLog.createdAt);
  return null;
}

function resolveSyncSignal(row: AdminProviderBudgetRow, latestSyncLog: ProviderSyncLogRow | null): SyncSignal {
  if (latestSyncLog) return latestSyncLog.syncStatus === 'success' ? 'ok' : 'error';
  if (row.quotaSyncedAt) return row.quotaSyncError ? 'error' : 'ok';
  return row.quotaSyncError ? 'error' : 'none';
}

function resolveSuggestedActions(
  row: AdminProviderBudgetRow,
  ms: MeasurementStatus,
  syncSignal: SyncSignal,
  hasQuota: boolean,
  ruleCount: number,
): SuggestedAction[] {
  if (ms === 'not_measured') return [];
  const actions: SuggestedAction[] = [];
  if (syncSignal === 'error' || row.quotaSyncError) {
    actions.push({ label: 'Revisar logs de sync', tab: 'logs', variant: 'warn' });
  }
  if (!hasQuota) {
    actions.push({ label: 'Configurar cuota', tab: 'presupuesto', variant: 'warn' });
  }
  if (ruleCount === 0) {
    actions.push({ label: 'Crear regla de presupuesto', tab: 'presupuesto', variant: 'info' });
  }
  return actions;
}

/** Actividad reciente: los registros de uso primero; si no hay, las evaluaciones de presupuesto. */
function resolveActivity(row: AdminProviderBudgetRow, usageLogs: ProviderUsageLogRow[]): ActivityEntry[] {
  if (usageLogs.length > 0) {
    return usageLogs.slice(0, RECENT_ACTIVITY_LIMIT).map((log) => ({
      id: log.id,
      title: log.operationKey ?? 'operación general',
      isError: isFailedLogStatus(log.status),
      spend: formatLogSpend(log.creditsUsed, log.estimatedCostUsd),
      time: formatDateShort(log.createdAt),
    }));
  }
  return (row.recentBudgetCheckLogs ?? []).slice(0, RECENT_ACTIVITY_LIMIT).map((log) => {
    const outcome = parseBudgetCheck(log.budgetCheck)?.outcome;
    return {
      id: log.id,
      title: log.operationKey ?? 'operación general',
      isError: outcome === 'technical_error' || outcome === 'would_block',
      spend: formatLogSpend(log.creditsUsed, log.estimatedCostUsd),
      time: formatDateShort(log.createdAt),
    };
  });
}

/** Cómo va la cuota de créditos: lo usado, lo reservado en curso y lo que queda. */
function QuotaUsage({ row, percent }: { row: AdminProviderBudgetRow; percent: number }) {
  const allowance = row.providerMonthlyCreditsAllowance ?? 0;
  const reserved = Math.max(0, row.reservedCredits ?? 0);
  const usedTone =
    percent >= QUOTA_CRITICAL_PERCENT ? 'negative' : percent >= QUOTA_WARNING_PERCENT ? 'warning' : 'brand';
  const segments: DistributionSegment[] = [
    { id: 'used', label: 'Usados', value: row.consumedCredits, tone: usedTone },
    ...(reserved > 0
      ? [{ id: 'reserved', label: 'Reservados', hint: 'en curso', value: reserved, tone: 'info' as const }]
      : []),
    {
      id: 'free',
      label: 'Disponibles',
      value: Math.max(0, allowance - row.consumedCredits - reserved),
      tone: 'neutral',
    },
  ];

  return (
    <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Uso de la cuota</span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <DistributionBar
        segments={segments}
        unit="cr"
        formatValue={(value) => value.toLocaleString()}
        ariaLabel={`Uso de la cuota: ${percent}%`}
        emptyLabel="Sin consumo ni cuota disponible"
      />
    </div>
  );
}

function RecentActivity({ entries, successCaption }: { entries: ActivityEntry[]; successCaption: string | null }) {
  return (
    <div className="space-y-3">
      <Timeline>
        {entries.map((entry) => (
          <TimelineItem
            key={entry.id}
            density="compact"
            tone={entry.isError ? 'negative' : 'positive'}
            title={entry.title}
            time={entry.time}
            description={entry.spend || undefined}
          />
        ))}
      </Timeline>
      {successCaption && <p className="text-xs tabular-nums text-muted-foreground">{successCaption}</p>}
    </div>
  );
}

export function TabResumen({
  row,
  ms,
  usageLogs,
  syncLogs,
  providerRules,
  loadingDetail,
  onNavigate,
}: TabResumenProps) {
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  // Sync signal: prefer syncLogs[0] over row fields
  const latestSyncLog = syncLogs[0] ?? null;
  const syncedAt = resolveSyncedAt(row, latestSyncLog);

  // Consumo
  const consumed = (() => {
    if (ms !== 'active') return { label: '—', description: undefined };
    const info = deriveConsumedInfo(row.consumedCredits, row.consumedUsd, row.hasUnknownCost);
    return info.label === '—' ? { label: '0 cr', description: undefined } : info;
  })();

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const hasQuota = row.providerMonthlyCreditsAllowance != null || row.providerMonthlyUsdAllowance != null;

  // Barra de uso: solo cuando hay cuota de créditos
  const progressPct = hasQuota && row.providerMonthlyCreditsAllowance != null && row.consumedCredits != null
    ? Math.min(100, Math.round((row.consumedCredits / row.providerMonthlyCreditsAllowance) * 100))
    : null;

  const activity = resolveActivity(row, usageLogs);
  const totalOps = usageLogs.length;
  const errorCount = usageLogs.filter((l) => isFailedLogStatus(l.status)).length;
  const successRate = totalOps > 0 ? Math.round(((totalOps - errorCount) / totalOps) * 100) : null;
  const successCaption =
    successRate !== null ? `Tasa de éxito: ${successRate}% (${totalOps - errorCount}/${totalOps} ops)` : null;

  // Salud del proveedor
  const syncSignal = resolveSyncSignal(row, latestSyncLog);
  const syncErrorMsg = latestSyncLog?.errorMessage ?? row.quotaSyncError ?? null;
  const syncTone = syncSignal === 'ok' ? 'positive' : syncSignal === 'error' ? 'negative' : 'neutral';

  const actions = resolveSuggestedActions(row, ms, syncSignal, hasQuota, providerRules.length);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Design Refresh v10: sin duplicar Estado (header), Contexto
            (descripción) ni el error de sync (va en 'Salud del proveedor'). */}
        <DrawerSection title="Proveedor" icon={Zap} tone="neutral" className="min-w-0">
          <InfoList>
            <InfoRow
              label="Tipo"
              value={
                <Badge variant="outline" className={opBadge}>
                  {OPERATIONAL_TYPE_LABEL[opType]}
                </Badge>
              }
            />
            {syncedAt && (
              <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />
            )}
          </InfoList>
        </DrawerSection>

        <DrawerSection title="Consumo y cuota" icon={Database} className="min-w-0">
          <InfoList>
            <InfoRow label="Consumo del mes" value={<span title={consumed.description}>{consumed.label}</span>} />
            <InfoRow
              label="Cuota configurada"
              value={hasQuota ? allowance : <span className="text-muted-foreground">Sin cuota configurada</span>}
            />
            {row.activeRules > 0 && (
              <InfoRow label="Reglas activas" value={`${row.activeRules} regla${row.activeRules !== 1 ? 's' : ''}`} />
            )}
            {row.providerCreditsAvailable != null && (
              <InfoRow
                label="Disponible (API)"
                value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
              />
            )}
            {row.usdCostMtd != null && <InfoRow label="Costo MTD" value={`$${row.usdCostMtd.toFixed(4)}`} />}
          </InfoList>
          {progressPct !== null && <QuotaUsage row={row} percent={progressPct} />}
        </DrawerSection>
      </div>

      <DrawerSection title="Actividad reciente" icon={History} tone="neutral">
        {loadingDetail ? (
          <LoadingBlock label="Cargando actividad..." />
        ) : ms === 'not_measured' ? (
          <EmptyBlock message="Este proveedor no genera actividad medida en SellUp." />
        ) : activity.length > 0 ? (
          <RecentActivity entries={activity} successCaption={successCaption} />
        ) : (
          <EmptyBlock
            message="Sin operaciones registradas aún."
            sub="Los datos aparecen después de la primera ejecución."
          />
        )}
      </DrawerSection>

      <DrawerSection title="Salud del proveedor" icon={Activity} tone={syncTone}>
        <InfoList>
          <InfoRow
            label="Estado sync"
            value={
              <Badge variant={syncTone}>
                {syncSignal === 'ok' ? 'OK' : syncSignal === 'error' ? 'Error' : 'Sin registro'}
              </Badge>
            }
          />
          {syncErrorMsg && (
            <InfoRow
              label="Error"
              value={
                <span className="line-clamp-2 text-xs leading-relaxed text-destructive" title={syncErrorMsg}>
                  {syncErrorMsg}
                </span>
              }
            />
          )}
          {latestSyncLog?.creditsRemainingExternal != null && (
            <InfoRow
              label="Créditos externos"
              value={`${latestSyncLog.creditsRemainingExternal.toLocaleString()} cr`}
            />
          )}
        </InfoList>
      </DrawerSection>

      {actions.length > 0 ? (
        <DrawerSection
          title="Acciones sugeridas"
          hint="Lo que conviene revisar para que este proveedor quede bien medido."
          icon={AlertTriangle}
          tone={actions.some((action) => action.variant === 'warn') ? 'warning' : 'brand'}
        >
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.tab + action.label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onNavigate(action.tab)}
              >
                {action.label}
                <ArrowRight aria-hidden="true" />
              </Button>
            ))}
          </div>
        </DrawerSection>
      ) : (
        <p className="px-1 text-xs text-text-muted">Sin acciones críticas por ahora.</p>
      )}
    </div>
  );
}
