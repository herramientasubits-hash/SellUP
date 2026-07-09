// ============================================================
// budgets — Tavily budget alert-only helper (Hito F)
// ============================================================
// Alert-only: consulta presupuesto y devuelve metadata normalizada.
// NUNCA bloquea ejecuciones ni lanza errores que interrumpan Tavily.
// La metadata se guarda en provider_usage_logs.metadata para auditoría.

import { checkBudget } from './budget-resolution';
import type { BudgetOnExceed, BudgetScopeApplied, UsdCostTruth } from './types';

export const TAVILY_BUDGET_PROVIDER_KEY = 'tavily';

export interface TavilyBudgetCheckMeta {
  mode: 'alert_only';
  provider_key: string;
  operation_key: string;
  allowed: boolean;
  /** true cuando la regla tiene on_exceed=block/require_approval (enforcement futuro bloqueará). */
  would_block_in_enforcement: boolean;
  scope_applied: BudgetScopeApplied | 'unknown';
  matched_rule_id: string | null;
  on_exceed: BudgetOnExceed | null;
  reason: string | null;
  consumed_credits: number;
  projected_credits: number;
  remaining_credits: number | null;
  /**
   * 'unknown' cuando el subtotal USD del budget check no cubre todas las filas
   * de costo. Ausente en callers preexistentes que construyen este shape sin
   * pasar por evaluateTavilyBudgetAlertOnly.
   */
  usd_cost_truth?: UsdCostTruth;
  /** Presente cuando userId faltante. */
  missing_user?: true;
  /** Presente cuando checkBudget falla técnicamente (no interrumpe el flujo). */
  technical_error?: string;
}

/**
 * Evalúa el presupuesto Tavily en modo alert-only.
 *
 * - Nunca lanza excepción.
 * - Si userId es null/undefined, devuelve metadata segura con missing_user=true.
 * - Si checkBudget falla técnicamente, devuelve metadata con technical_error.
 * - Si la regla tiene on_exceed=block pero el hito es alert-only,
 *   would_block_in_enforcement=true y el flujo continúa igual.
 */
export async function evaluateTavilyBudgetAlertOnly(
  userId: string | null | undefined,
  projectedCredits: number,
  operationKey: string,
): Promise<TavilyBudgetCheckMeta> {
  if (!userId) {
    return {
      mode: 'alert_only',
      provider_key: TAVILY_BUDGET_PROVIDER_KEY,
      operation_key: operationKey,
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'unknown',
      matched_rule_id: null,
      on_exceed: null,
      reason: 'missing_user_id',
      consumed_credits: 0,
      projected_credits: projectedCredits,
      remaining_credits: null,
      usd_cost_truth: 'unknown',
      missing_user: true,
    };
  }

  try {
    const result = await checkBudget(TAVILY_BUDGET_PROVIDER_KEY, userId, { credits: projectedCredits });

    const onExceed = result.matchedRule?.onExceed ?? null;
    const wouldBlock = onExceed === 'block' || onExceed === 'require_approval';

    if (result.reason) {
      console.warn(
        `[budget-alert] Tavily budget warning for user=${userId} op=${operationKey}: ${result.reason}` +
        (wouldBlock ? ' [would_block_in_enforcement=true]' : ''),
      );
    }

    return {
      mode: 'alert_only',
      provider_key: TAVILY_BUDGET_PROVIDER_KEY,
      operation_key: operationKey,
      allowed: result.allowed,
      would_block_in_enforcement: !result.allowed || wouldBlock,
      scope_applied: result.scopeApplied,
      matched_rule_id: result.matchedRule?.id ?? null,
      on_exceed: onExceed,
      reason: result.reason,
      consumed_credits: result.consumedCredits,
      projected_credits: projectedCredits,
      remaining_credits: result.remainingCredits,
      usd_cost_truth: result.usdCostTruth,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[budget-alert] checkBudget failed for Tavily op=${operationKey} (non-blocking): ${msg}`);
    return {
      mode: 'alert_only',
      provider_key: TAVILY_BUDGET_PROVIDER_KEY,
      operation_key: operationKey,
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'unknown',
      matched_rule_id: null,
      on_exceed: null,
      reason: null,
      consumed_credits: 0,
      projected_credits: projectedCredits,
      remaining_credits: null,
      usd_cost_truth: 'unknown',
      technical_error: msg,
    };
  }
}
