'use server';

// ============================================================
// budgets — provider allowance CRUD (Hito J / L1)
// ============================================================
// Admin-only. Updates monthly_credits_allowance and monthly_usd_allowance
// on tool_catalog. These fields represent the external contracted quota —
// not internal enforcement rules.
//
// L1 additions:
//   - Sets quota_source = 'manual' when saving, null when clearing.
//   - Sets quota_override_manual = true when saving, false when clearing.
//   - Writes one audit row to tool_quota_sync_logs after every successful save.

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
 *
 * Clearing (both null): sets quota_source = null, quota_override_manual = false.
 * Saving (any value):   sets quota_source = 'manual', quota_override_manual = true.
 *
 * Always writes a row to tool_quota_sync_logs for audit purposes.
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

  const isClearing = monthlyCreditsAllowance === null && monthlyUsdAllowance === null;
  const quotaSource = isClearing ? null : ('manual' as const);
  const quotaOverrideManual = !isClearing;

  const admin = getAdminClient();

  const { error } = await admin
    .from('tool_catalog')
    .update({
      monthly_credits_allowance: monthlyCreditsAllowance,
      monthly_usd_allowance: monthlyUsdAllowance,
      quota_source: quotaSource,
      quota_override_manual: quotaOverrideManual,
    })
    .eq('provider_key', providerKey);

  if (error) {
    return { success: false, error: `Error al guardar: ${error.message}` };
  }

  // Audit log — non-blocking; failure does not roll back the allowance update.
  await admin.from('tool_quota_sync_logs').insert({
    provider_key: providerKey,
    source: isClearing ? 'manual' : 'manual',
    triggered_by: 'admin',
    error_message: null,
  });

  return { success: true };
}
