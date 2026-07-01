'use server';

// ============================================================
// budgets — provider allowance CRUD (Hito J)
// ============================================================
// Admin-only. Updates monthly_credits_allowance and monthly_usd_allowance
// on tool_catalog. These fields represent the external contracted quota —
// not internal enforcement rules.

import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminClient } from './queries';

export interface UpdateProviderAllowanceResult {
  success: boolean;
  error?: string;
}

/**
 * Updates the external monthly allowances for a provider in tool_catalog.
 * Values are nullable — passing null clears the configuration.
 * Values must be >= 0 when provided.
 * Admin-only.
 */
export async function updateProviderAllowance(
  providerKey: string,
  monthlyCreditsAllowance: number | null,
  monthlyUsdAllowance: number | null,
): Promise<UpdateProviderAllowanceResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  if (monthlyCreditsAllowance !== null && monthlyCreditsAllowance < 0) {
    return { success: false, error: 'Los créditos mensuales no pueden ser negativos.' };
  }
  if (monthlyUsdAllowance !== null && monthlyUsdAllowance < 0) {
    return { success: false, error: 'El presupuesto mensual USD no puede ser negativo.' };
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from('tool_catalog')
    .update({
      monthly_credits_allowance: monthlyCreditsAllowance,
      monthly_usd_allowance: monthlyUsdAllowance,
    })
    .eq('provider_key', providerKey);

  if (error) {
    return { success: false, error: `Error al guardar: ${error.message}` };
  }

  return { success: true };
}
