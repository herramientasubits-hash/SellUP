// ============================================================
// budgets — recargas y aprobaciones de una regla (migración 163)
// ============================================================
// Sin 'use server': lo llama sólo el servidor.

import type { getAdminClient } from './queries';
import type { CreditAdjustment } from './credit-balance-core';

type AdminClient = ReturnType<typeof getAdminClient>;

/**
 * Las recargas y aprobaciones de una regla desde `sinceIso`.
 *
 * Si no se pueden leer (por ejemplo, la 163 todavía no está aplicada) se
 * devuelve la lista vacía: el tope queda en el límite de la regla, que es lo
 * que regía antes. Nunca suma créditos que no se pudieron comprobar.
 */
export async function getRuleCreditAdjustments(
  admin: AdminClient,
  ruleId: string,
  sinceIso: string,
): Promise<CreditAdjustment[]> {
  const { data, error } = await admin
    .from('budget_rule_adjustments')
    .select('period_start, kind, credits, beneficiary_user_id')
    .eq('rule_id', ruleId)
    .gte('period_start', sinceIso);

  if (error) {
    console.error('[budget-adjustments] read failed, using the rule limit only:', error.message.slice(0, 200));
    return [];
  }

  return (data ?? []).map((row) => ({
    periodStart: row.period_start as string,
    kind: row.kind as CreditAdjustment['kind'],
    credits: Number(row.credits),
    beneficiaryUserId: (row.beneficiary_user_id as string | null) ?? null,
  }));
}
