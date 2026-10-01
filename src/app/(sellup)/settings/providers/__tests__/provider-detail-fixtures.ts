/**
 * Datos de prueba del panel de un proveedor: una fila de presupuesto completa
 * y registros mínimos. Sin red ni Supabase.
 */

import type { AdminProviderBudgetRow, BudgetCheckLogEntry } from '@/modules/budgets';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import type { ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';

export function makeRow(overrides: Partial<AdminProviderBudgetRow> = {}): AdminProviderBudgetRow {
  return {
    providerKey: 'apollo',
    displayName: 'Apollo',
    activeRules: 1,
    globalLimitCredits: 500,
    globalLimitUsd: null,
    consumedCredits: 68,
    consumedUsd: 0,
    hasUnknownCost: false,
    reservedCredits: 12,
    consumptionBreakdown: {} as AdminProviderBudgetRow['consumptionBreakdown'],
    remainingCredits: 420,
    remainingUsd: null,
    periodType: 'monthly',
    periodStart: '2026-10-01T00:00:00Z',
    periodEnd: '2026-10-31T23:59:59Z',
    onExceed: 'alert',
    latestBudgetCheckLog: null,
    recentBudgetCheckLogs: [],
    isConnected: true,
    measurementStatus: 'active',
    providerMonthlyCreditsAllowance: 400,
    providerMonthlyUsdAllowance: null,
    providerCreditsAvailable: 332,
    providerUsdAvailable: null,
    quotaSource: 'manual',
    quotaSyncedAt: '2026-10-01T12:00:00Z',
    quotaSyncError: null,
    quotaOverrideManual: false,
    creditsRemainingExternal: null,
    usdCostMtd: null,
    ...overrides,
  };
}

export function makeUsageLog(id: string, overrides: Partial<ProviderUsageLogRow> = {}): ProviderUsageLogRow {
  return {
    id,
    operationKey: 'people_search',
    creditsUsed: 4,
    estimatedCostUsd: 0.0347,
    status: 'success',
    triggeredBy: null,
    createdAt: '2026-10-01T15:00:00Z',
    ...overrides,
  };
}

/** `budgetCheck` es el JSON crudo del registro: `{}` ⇒ permitido, `{ allowed: false }` ⇒ habría bloqueado. */
export function makeBudgetLog(id: string, budgetCheck: Record<string, unknown> = {}): BudgetCheckLogEntry {
  return {
    id,
    providerKey: 'apollo',
    operationKey: `op-${id}`,
    creditsUsed: 2,
    estimatedCostUsd: null,
    status: 'success',
    createdAt: '2026-10-01T15:00:00Z',
    budgetCheck: { scope_applied: 'global', ...budgetCheck },
  };
}

export function makeRule(id: string, overrides: Partial<BudgetRuleRow> = {}): BudgetRuleRow {
  return {
    id,
    provider_key: 'apollo',
    scope_type: 'global',
    scope_id: null,
    period_type: 'monthly',
    limit_credits: 500,
    limit_usd: null,
    on_exceed: 'block',
    is_active: true,
    notes: null,
    providerDisplayName: 'Apollo',
    scopeLabel: 'Toda la organización',
    ...overrides,
  } as BudgetRuleRow;
}
