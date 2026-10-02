'use client';

/**
 * tab-logs.tsx — pestaña «Logs» del panel de un proveedor: cómo va la
 * sincronización, los registros de uso (con sus filtros), el historial de
 * sincronizaciones y las evaluaciones de presupuesto. Solo lee.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { MeasurementStatus } from '@/modules/budgets/provider-measurement';
import type { ProviderSyncLogRow, ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';
import { loadFilteredProviderUsageLogsForPanel } from '../provider-detail-actions';
import type { FilterOptions } from '../provider-consumption-types';
import { SYNC_CAPABLE_PROVIDERS } from './detail-format';
import { RetryAlert } from './detail-shared';
import {
  BudgetEvaluationsSection,
  SyncHistorySection,
  SyncStatusSection,
  UsageLogsSection,
} from './logs-sections';
import { UsageFilterBar, useUsageFilters } from './usage-filter-bar';

// ── Pestaña ───────────────────────────────────────────────────────────────────

export interface TabLogsProps {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  loading: boolean;
  isActive: boolean;
}

export function TabLogs({ row, ms, usageLogs: initialUsageLogs, syncLogs, loading, isActive }: TabLogsProps) {
  // Q3F-HOTFIX-4A — Logs filter parity with Consumo. Filters trigger their
  // own fetch (reusing the same access-scoped getRecentProviderLogs Consumo
  // already uses) instead of client-filtering `initialUsageLogs` — that prop
  // stays untouched so Resumen/Efectividad keep their own unfiltered window.
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filteredLogs, setFilteredLogs] = useState<ProviderUsageLogRow[] | null>(null);
  const [logsLoadError, setLogsLoadError] = useState<string | null>(null);
  const [isLogsPending, startLogsTransition] = useTransition();
  const logsSeqRef = useRef(0);

  const filterState = useUsageFilters({ initial: {}, options: filterOptions });
  const { filters: logFilters } = filterState;

  const loadFilteredLogs = useCallback(() => {
    const seq = ++logsSeqRef.current;
    startLogsTransition(async () => {
      try {
        const result = await loadFilteredProviderUsageLogsForPanel(row.providerKey, logFilters);
        if (seq !== logsSeqRef.current) return;
        if (result.ok) {
          setFilteredLogs(result.logs);
          setFilterOptions(result.filterOptions);
          setLogsLoadError(null);
        } else {
          setLogsLoadError('No fue posible cargar los logs de este proveedor.');
        }
      } catch {
        if (seq === logsSeqRef.current) {
          setLogsLoadError('No fue posible cargar los logs de este proveedor.');
        }
      }
    });
  }, [row.providerKey, logFilters]);

  useEffect(() => {
    if (!isActive) return;
    loadFilteredLogs();
  }, [isActive, loadFilteredLogs]);

  const isNotMeasured = ms === 'not_measured';
  const hasActiveLogFilters = Object.keys(logFilters).length > 0;
  const effectiveUsageLogs = filteredLogs ?? initialUsageLogs;
  const usageLoading = loading || (filteredLogs === null && isLogsPending);

  return (
    <div className="space-y-4">
      <SyncStatusSection row={row} />

      {/* Actividad reciente (provider_usage_logs) */}
      <div className="space-y-2">
        {logsLoadError && (
          <RetryAlert title={logsLoadError} onRetry={() => { if (isActive) loadFilteredLogs(); }}>
            <p>Puedes reintentar sin cerrar el workspace.</p>
          </RetryAlert>
        )}
        {!isNotMeasured && <UsageFilterBar {...filterState} options={filterOptions} defaultPeriod="all" />}
        <UsageLogsSection
          logs={effectiveUsageLogs}
          loading={usageLoading}
          isNotMeasured={isNotMeasured}
          hasActiveFilters={hasActiveLogFilters}
        />
      </div>

      {/* Historial de sincronización (tool_quota_sync_logs) */}
      {SYNC_CAPABLE_PROVIDERS.has(row.providerKey) && <SyncHistorySection syncLogs={syncLogs} loading={loading} />}

      {/* Evaluaciones de presupuesto (budget check logs) */}
      <BudgetEvaluationsSection budgetLogs={row.recentBudgetCheckLogs ?? []} isNotMeasured={isNotMeasured} />
    </div>
  );
}
