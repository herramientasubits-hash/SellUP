'use server';

// ============================================================
// budgets — recargar el mes de una regla y ver su saldo (dueña 10-11)
// Sólo administradores. Aprobar créditos vive en `@/modules/credit-approvals`:
// lo hacen los aprobadores, que no tienen por qué ser administradores.
// ============================================================

import { revalidatePath } from 'next/cache';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminClient, getAllOrgGroups } from './queries';
import { getPeriodBounds } from './periods';
import { readRulePoolConsumption, resolveRuleCreditBalance } from './budget-resolution';
import type { BudgetRule, RuleCreditBalance } from './types';

export interface ActionResult {
  success: boolean;
  error?: string;
}

/** Créditos válidos para una recarga o una aprobación: entero positivo con tope sano. */
const MAX_CREDITS_PER_ACTION = 1_000_000;

function parseCredits(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_CREDITS_PER_ACTION ? rounded : null;
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

// ─── Recargar el período actual de una regla ─────────────────────────────────

export async function topUpBudgetRule(input: {
  ruleId: string;
  credits: number;
  note?: string | null;
}): Promise<ActionResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { success: false, error: 'No autorizado.' };
  const credits = parseCredits(input.credits);
  if (credits === null) return { success: false, error: 'Escribe cuántos créditos agregar (un número entero mayor a 0).' };

  const admin = getAdminClient();
  const { data: rule } = await admin
    .from('budget_rules')
    .select('id, period_type, limit_credits, is_active')
    .eq('id', input.ruleId)
    .maybeSingle();
  if (!rule) return { success: false, error: 'No encontramos la regla.' };
  if (rule.limit_credits === null) {
    return { success: false, error: 'Esta regla sólo tiene límite en USD: la recarga es en créditos.' };
  }

  const me = await getCurrentUser();
  const { error } = await admin.from('budget_rule_adjustments').insert({
    rule_id: rule.id,
    period_start: getPeriodBounds(rule.period_type as BudgetRule['period_type']).start.toISOString(),
    kind: 'top_up',
    credits,
    note: cleanNote(input.note),
    created_by: me?.id ?? null,
  });
  if (error) {
    console.error('[topUpBudgetRule]', error.message.slice(0, 200));
    return { success: false, error: 'No pudimos guardar la recarga.' };
  }

  revalidatePath('/settings/providers', 'layout');
  return { success: true };
}

// ─── Saldo del período de cada regla (vista del administrador) ───────────────

export interface RulePeriodBalance {
  ruleId: string;
  balance: RuleCreditBalance;
  /** Aprobaciones dadas a personas este período (suman sólo a cada una). */
  grantsTotal: number;
  consumedCredits: number;
  /** effective − consumido, nunca negativo. */
  remainingCredits: number;
  pendingRequests: number;
}

export async function getRulePeriodBalances(providerKey: string): Promise<RulePeriodBalance[]> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return [];
  const admin = getAdminClient();

  const [{ data: rules }, allGroups] = await Promise.all([
    admin.from('budget_rules').select('*').eq('provider_key', providerKey).eq('is_active', true),
    getAllOrgGroups(admin),
  ]);

  const withCredits = ((rules ?? []) as BudgetRule[]).filter((rule) => rule.limit_credits !== null);
  return Promise.all(
    withCredits.map(async (rule) => {
      const bounds = getPeriodBounds(rule.period_type);
      const startIso = bounds.start.toISOString();
      const [balance, consumed, grants, pending] = await Promise.all([
        resolveRuleCreditBalance(admin, rule, allGroups, null),
        readRulePoolConsumption(admin, rule, allGroups, startIso, bounds.end.toISOString()),
        admin.from('budget_rule_adjustments').select('credits').eq('rule_id', rule.id).eq('kind', 'grant').eq('period_start', startIso),
        admin
          .from('budget_approval_requests')
          .select('id', { count: 'exact', head: true })
          .eq('rule_id', rule.id)
          .eq('status', 'pending'),
      ]);
      const grantsTotal = ((grants.data ?? []) as Array<{ credits: number | string }>).reduce(
        (sum, row) => sum + Number(row.credits),
        0,
      );
      const effective = balance!.effective;
      const consumedCredits = consumed.credits + consumed.reservedCredits;
      return {
        ruleId: rule.id,
        balance: balance!,
        grantsTotal,
        consumedCredits,
        remainingCredits: Math.max(0, effective + grantsTotal - consumedCredits),
        pendingRequests: pending.count ?? 0,
      };
    }),
  );
}
