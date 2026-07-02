'use server';

// ============================================================
// budgets — quota sync server actions (Hito L2)
// ============================================================
// Admin-only. Consulta la API del proveedor y actualiza tool_catalog.
// Registra auditoría en tool_quota_sync_logs.
// NO modifica monthly_credits_allowance cuando quota_override_manual=true.
// NO cron. NO sync automático. Solo ejecución manual.

import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminClient } from './queries';
import { fetchTavilyQuota } from '@/server/services/tavily-quota-sync';
import { fetchLushaQuota } from '@/server/services/lusha-quota-sync';
import { fetchApolloQuota } from '@/server/services/apollo-quota-sync';
import { fetchAnthropicCost } from '@/server/services/anthropic-quota-sync';
import type { QuotaSyncObservability } from '@/server/services/tavily-quota-sync';

// Proveedores habilitados para sync manual desde UI
const SYNCABLE_PROVIDERS = ['tavily', 'lusha', 'apollo', 'anthropic'] as const;
type SyncableProvider = (typeof SYNCABLE_PROVIDERS)[number];

export interface QuotaSyncResult {
  success: boolean;
  error?: string;
  /** true = sync ok pero se respetó override manual (no se sobrescribió allowance) */
  skippedAllowance?: boolean;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function isSyncable(key: string): key is SyncableProvider {
  return SYNCABLE_PROVIDERS.includes(key as SyncableProvider);
}

async function readQuotaOverrideManual(
  admin: ReturnType<typeof getAdminClient>,
  providerKey: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('tool_catalog')
    .select('quota_override_manual')
    .eq('provider_key', providerKey)
    .maybeSingle();
  return Boolean((data as { quota_override_manual?: boolean } | null)?.quota_override_manual);
}

function safeDateString(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10); // DATE format YYYY-MM-DD
  } catch {
    return null;
  }
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function applySuccessfulSync(
  admin: ReturnType<typeof getAdminClient>,
  providerKey: string,
  params: {
    creditsRemaining: number;
    creditsUsed: number | null;
    planLimitCredits: number | null;
    billingPeriodEnd: string | null;
    creditsPerUsdRate: number | null;
  },
  obs?: QuotaSyncObservability,
): Promise<QuotaSyncResult> {
  const overrideManual = await readQuotaOverrideManual(admin, providerKey);
  const periodEnd = safeDateString(params.billingPeriodEnd);
  const usdCostMtd =
    params.creditsUsed !== null && params.creditsPerUsdRate !== null
      ? params.creditsUsed * params.creditsPerUsdRate
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseUpdate: Record<string, any> = {
    credits_remaining_external: params.creditsRemaining,
    quota_synced_at: new Date().toISOString(),
    quota_sync_error: null,
  };
  if (params.billingPeriodEnd !== null) baseUpdate['billing_period_end'] = periodEnd;
  if (usdCostMtd !== null) baseUpdate['usd_cost_mtd'] = usdCostMtd;

  let skippedAllowance = false;

  if (overrideManual) {
    // quota_source stays 'manual'; monthly allowances NOT overwritten
    skippedAllowance = true;
  } else {
    baseUpdate['quota_source'] = 'api_synced';
    if (params.planLimitCredits !== null) {
      baseUpdate['monthly_credits_allowance'] = params.planLimitCredits;
    }
    if (params.creditsPerUsdRate !== null && params.planLimitCredits !== null) {
      baseUpdate['monthly_usd_allowance'] = params.planLimitCredits * params.creditsPerUsdRate;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('tool_catalog')
    .update(baseUpdate)
    .eq('provider_key', providerKey);

  // Audit log
  const logRow: Record<string, unknown> = {
    provider_key: providerKey,
    source: 'api_synced',
    sync_status: 'success',
    triggered_by: 'admin',
    credits_remaining_external: params.creditsRemaining,
    synced_at: new Date().toISOString(),
    error_message: null,
  };
  if (usdCostMtd !== null) logRow['usd_cost_mtd'] = usdCostMtd;
  if (periodEnd) logRow['billing_period_end'] = periodEnd;
  if (params.creditsPerUsdRate !== null) logRow['credits_per_usd_rate'] = params.creditsPerUsdRate;
  if (obs) {
    if (obs.httpStatus !== undefined) logRow['http_status'] = obs.httpStatus;
    logRow['endpoint'] = obs.endpoint;
    if (obs.responseShape !== null) logRow['response_shape'] = obs.responseShape;
    if (obs.rawResponseSanitized !== null) logRow['raw_response_sanitized'] = obs.rawResponseSanitized;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('tool_quota_sync_logs').insert(logRow);

  return { success: true, skippedAllowance };
}

async function applyFailedSync(
  admin: ReturnType<typeof getAdminClient>,
  providerKey: string,
  errorMessage: string,
  obs?: QuotaSyncObservability,
): Promise<void> {
  const overrideManual = await readQuotaOverrideManual(admin, providerKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {
    quota_sync_error: errorMessage,
  };
  if (!overrideManual) {
    update['quota_source'] = 'sync_error';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('tool_catalog')
    .update(update)
    .eq('provider_key', providerKey);

  const logRow: Record<string, unknown> = {
    provider_key: providerKey,
    source: 'sync_error',
    sync_status: 'error',
    triggered_by: 'admin',
    error_message: errorMessage,
    synced_at: new Date().toISOString(),
  };
  if (obs) {
    if (obs.httpStatus !== undefined) logRow['http_status'] = obs.httpStatus;
    logRow['endpoint'] = obs.endpoint;
    if (obs.responseShape !== null) logRow['response_shape'] = obs.responseShape;
    if (obs.rawResponseSanitized !== null) logRow['raw_response_sanitized'] = obs.rawResponseSanitized;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('tool_quota_sync_logs').insert(logRow);
}

// ── Tavily sync ───────────────────────────────────────────────────────────────

async function syncTavily(
  admin: ReturnType<typeof getAdminClient>,
): Promise<QuotaSyncResult> {
  const result = await fetchTavilyQuota();

  if (!result.ok) {
    await applyFailedSync(admin, 'tavily', result.error, result.obs);
    return { success: false, error: result.error };
  }

  return applySuccessfulSync(admin, 'tavily', {
    creditsRemaining: result.data.creditsRemaining,
    creditsUsed: result.data.creditsUsed,
    planLimitCredits: result.data.planLimitCredits,
    billingPeriodEnd: result.data.billingPeriodEnd,
    creditsPerUsdRate: 0.008, // Tavily: 1 cr = $0.008
  }, result.obs);
}

// ── Lusha sync ────────────────────────────────────────────────────────────────

async function syncLusha(
  admin: ReturnType<typeof getAdminClient>,
): Promise<QuotaSyncResult> {
  let result: Awaited<ReturnType<typeof fetchLushaQuota>>;
  try {
    result = await fetchLushaQuota();
  } catch {
    // fetchLushaQuota should never throw (returns error objects), but if it does
    // we must still write a log — otherwise the attempt is invisible.
    const errMsg = 'Error inesperado al obtener cuota de Lusha';
    await applyFailedSync(admin, 'lusha', errMsg, undefined).catch(() => {});
    return { success: false, error: errMsg };
  }

  if (!result.ok) {
    await applyFailedSync(admin, 'lusha', result.error, result.obs).catch(() => {});
    return { success: false, error: result.error };
  }

  return applySuccessfulSync(admin, 'lusha', {
    creditsRemaining: result.data.creditsRemaining,
    creditsUsed: result.data.creditsUsed,
    planLimitCredits: result.data.totalCredits,
    billingPeriodEnd: result.data.renewalDate,
    creditsPerUsdRate: null, // Lusha no expone costo unitario por crédito
  }, result.obs);
}

// ── Anthropic sync ────────────────────────────────────────────────────────────
//
// Anthropic se mide en USD, no en créditos.
// Solo actualiza usd_cost_mtd y meta de sync.
// monthly_credits_allowance y credits_remaining_external no aplican.

async function applyAnthropicSuccessfulSync(
  admin: ReturnType<typeof getAdminClient>,
  usdCostMtd: number,
  obs?: QuotaSyncObservability,
): Promise<QuotaSyncResult> {
  const overrideManual = await readQuotaOverrideManual(admin, 'anthropic');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseUpdate: Record<string, any> = {
    usd_cost_mtd: usdCostMtd,
    quota_synced_at: new Date().toISOString(),
    quota_sync_error: null,
  };

  let skippedAllowance = false;
  if (overrideManual) {
    skippedAllowance = true;
  } else {
    baseUpdate['quota_source'] = 'api_synced';
    // monthly_usd_allowance solo se actualiza si el endpoint devuelve un límite explícito.
    // La API de uso de Anthropic devuelve gasto, no límite — no sobrescribir.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('tool_catalog').update(baseUpdate).eq('provider_key', 'anthropic');

  const logRow: Record<string, unknown> = {
    provider_key: 'anthropic',
    source: 'api_synced',
    sync_status: 'success',
    triggered_by: 'admin',
    usd_cost_mtd: usdCostMtd,
    synced_at: new Date().toISOString(),
    error_message: null,
  };
  if (obs) {
    if (obs.httpStatus !== undefined) logRow['http_status'] = obs.httpStatus;
    logRow['endpoint'] = obs.endpoint;
    if (obs.responseShape !== null) logRow['response_shape'] = obs.responseShape;
    if (obs.rawResponseSanitized !== null) logRow['raw_response_sanitized'] = obs.rawResponseSanitized;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('tool_quota_sync_logs').insert(logRow);

  return { success: true, skippedAllowance };
}

async function syncAnthropic(
  admin: ReturnType<typeof getAdminClient>,
): Promise<QuotaSyncResult> {
  let result: Awaited<ReturnType<typeof fetchAnthropicCost>>;
  try {
    result = await fetchAnthropicCost();
  } catch {
    const errMsg = 'Error inesperado al obtener costo de Anthropic';
    await applyFailedSync(admin, 'anthropic', errMsg, undefined).catch(() => {});
    return { success: false, error: errMsg };
  }

  if (!result.ok) {
    await applyFailedSync(admin, 'anthropic', result.error, result.obs).catch(() => {});
    return { success: false, error: result.error };
  }

  return applyAnthropicSuccessfulSync(admin, result.data.usdCostMtd, result.obs);
}

// ── Apollo sync ───────────────────────────────────────────────────────────────

async function syncApollo(
  admin: ReturnType<typeof getAdminClient>,
): Promise<QuotaSyncResult> {
  let result: Awaited<ReturnType<typeof fetchApolloQuota>>;
  try {
    result = await fetchApolloQuota();
  } catch {
    const errMsg = 'Error inesperado al obtener cuota de Apollo';
    await applyFailedSync(admin, 'apollo', errMsg, undefined).catch(() => {});
    return { success: false, error: errMsg };
  }

  if (!result.ok) {
    await applyFailedSync(admin, 'apollo', result.error, result.obs).catch(() => {});
    return { success: false, error: result.error };
  }

  return applySuccessfulSync(admin, 'apollo', {
    creditsRemaining: result.data.creditsRemaining,
    creditsUsed: result.data.creditsUsed,
    planLimitCredits: result.data.planLimitCredits,
    billingPeriodEnd: result.data.billingPeriodEnd,
    creditsPerUsdRate: null, // Apollo no expone costo unitario por crédito en este endpoint
  }, result.obs);
}

// ── Public actions ────────────────────────────────────────────────────────────

/**
 * Sincroniza la cuota de un proveedor con su API.
 * Admin-only. Proveedores habilitados: tavily, lusha.
 * Sin cron. Sin sync automático. Ejecución manual únicamente.
 */
export async function syncProviderQuota(
  providerKey: string,
): Promise<QuotaSyncResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  if (!isSyncable(providerKey)) {
    return { success: false, error: `Proveedor '${providerKey}' no soporta sync de cuota.` };
  }

  const admin = getAdminClient();

  if (providerKey === 'tavily') return syncTavily(admin);
  if (providerKey === 'lusha') return syncLusha(admin);
  if (providerKey === 'apollo') return syncApollo(admin);
  if (providerKey === 'anthropic') return syncAnthropic(admin);

  return { success: false, error: 'Proveedor no reconocido.' };
}

export interface UseApiQuotaResult {
  success: boolean;
  error?: string;
}

/**
 * Cambia la fuente de cuota del proveedor a API synced.
 * Limpia quota_override_manual, ejecuta sync inmediato y deja que la API
 * actualice monthly_credits_allowance.
 * Si el sync falla, restaura quota_override_manual=true y quota_source='manual'
 * para no perder la cuota manual configurada previamente.
 * Admin-only. Sin cron. Sin enforcement. Sin backfill.
 */
export async function useApiQuotaAsPrimary(
  providerKey: string,
): Promise<UseApiQuotaResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  if (!isSyncable(providerKey)) {
    return { success: false, error: `Proveedor '${providerKey}' no soporta sync de cuota.` };
  }

  const admin = getAdminClient();

  // Step 1: Clear manual override so applySuccessfulSync will update allowance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('tool_catalog')
    .update({ quota_override_manual: false })
    .eq('provider_key', providerKey);

  // Step 2: Run sync — with override=false, applySuccessfulSync will write
  // monthly_credits_allowance and quota_source=api_synced
  let syncResult: QuotaSyncResult;
  if (providerKey === 'tavily') syncResult = await syncTavily(admin);
  else if (providerKey === 'lusha') syncResult = await syncLusha(admin);
  else if (providerKey === 'apollo') syncResult = await syncApollo(admin);
  else if (providerKey === 'anthropic') syncResult = await syncAnthropic(admin);
  else {
    // Unknown provider — restore override and bail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('tool_catalog')
      .update({ quota_override_manual: true, quota_source: 'manual' })
      .eq('provider_key', providerKey);
    return { success: false, error: 'Proveedor no reconocido.' };
  }

  if (!syncResult.success) {
    // Restore manual state — applyFailedSync already logged the error and set
    // quota_source='sync_error'; we now put it back to manual so no quota is lost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('tool_catalog')
      .update({ quota_override_manual: true, quota_source: 'manual' })
      .eq('provider_key', providerKey);
    return {
      success: false,
      error: syncResult.error ?? 'No se pudo obtener la cuota del proveedor.',
    };
  }

  return { success: true };
}
