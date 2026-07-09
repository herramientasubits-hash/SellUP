// ============================================================
// budgets — Apollo budget alert-only helper (Hito E)
// ============================================================
// Alert-only: consulta presupuesto y devuelve metadata normalizada.
// NUNCA bloquea ejecuciones ni lanza errores que interrumpan Apollo.
// La metadata se guarda en provider_usage_logs.metadata para auditoría.

import { checkBudget } from './budget-resolution';
import type { BudgetOnExceed, BudgetScopeApplied, UsdCostTruth } from './types';

export const APOLLO_BUDGET_PROVIDER_KEY = 'apollo';

// Créditos proyectados conservadores cuando no conocemos el resultado real.
// Apollo cobra ~1 crédito por resultado retornado; usamos 1 como mínimo.
export const APOLLO_PROJECTED_CREDITS_CONSERVATIVE = 1;

export interface ApolloBudgetCheckMeta {
  mode: 'alert_only';
  provider_key: string;
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
   * pasar por evaluateApolloBudgetAlertOnly.
   */
  usd_cost_truth?: UsdCostTruth;
  /** Presente cuando checkBudget falla técnicamente (no interrumpe el flujo). */
  technical_error?: string;
}

/**
 * Evalúa el presupuesto Apollo en modo alert-only.
 *
 * - Nunca lanza excepción.
 * - Si checkBudget falla técnicamente, devuelve metadata con technical_error
 *   y permite continuar.
 * - Si la regla tiene on_exceed=block pero el hito es alert-only,
 *   would_block_in_enforcement=true y el flujo continúa igual.
 */
export async function evaluateApolloBudgetAlertOnly(
  userId: string,
  projectedCredits: number = APOLLO_PROJECTED_CREDITS_CONSERVATIVE,
): Promise<ApolloBudgetCheckMeta> {
  try {
    const result = await checkBudget(APOLLO_BUDGET_PROVIDER_KEY, userId, { credits: projectedCredits });

    const onExceed = result.matchedRule?.onExceed ?? null;
    // En enforcement real: block y require_approval bloquearían. alert no.
    const wouldBlock = onExceed === 'block' || onExceed === 'require_approval';

    if (result.reason) {
      // Presupuesto excedido — loguear advertencia sin interrumpir
      console.warn(
        `[budget-alert] Apollo budget warning for user=${userId}: ${result.reason}` +
        (wouldBlock ? ' [would_block_in_enforcement=true]' : ''),
      );
    }

    return {
      mode: 'alert_only',
      provider_key: APOLLO_BUDGET_PROVIDER_KEY,
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
    console.warn(`[budget-alert] checkBudget failed for Apollo (non-blocking): ${msg}`);
    return {
      mode: 'alert_only',
      provider_key: APOLLO_BUDGET_PROVIDER_KEY,
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
