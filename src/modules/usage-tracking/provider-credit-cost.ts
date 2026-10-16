/**
 * provider-credit-cost.ts — dólares de una consulta pagada por créditos.
 *
 * AI-USAGE-AUDIT-2 (16-10). Varios escritores de `provider_usage_logs` guardaban
 * los créditos pero no los dólares, y `buildProviderUsageLogInsertPayload`
 * convierte «no enviado» en US$0: los revelados de teléfono salían gratis en
 * /ai-usage. Aquí vive la regla única:
 *
 *   · créditos conocidos × tarifa conocida → dólares;
 *   · 0 créditos → US$0 (no se cobró);
 *   · créditos o tarifa desconocidos → NULL («costo desconocido», nunca 0).
 *
 * La tarifa sale de `provider_pricing_config` (fila activa más reciente).
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

/** Dólares de `credits` créditos a `unitCostUsd` por crédito; NULL si algo no se sabe. */
export function creditCostUsd(
  credits: number | null | undefined,
  unitCostUsd: number | null | undefined,
): number | null {
  if (credits === null || credits === undefined || !Number.isFinite(credits)) return null;
  if (credits === 0) return 0;
  if (unitCostUsd === null || unitCostUsd === undefined || !Number.isFinite(unitCostUsd)) return null;
  return credits * unitCostUsd;
}

function defaultAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

/**
 * Tarifa activa por crédito de `providerKey` / `operationKey`. NULL si no hay
 * fila activa, si el valor no es un número ≥ 0 o si la lectura falla: quien
 * llama guarda entonces «costo desconocido» en vez de inventar US$0.
 */
export async function loadProviderCreditUnitCost(
  providerKey: string,
  operationKey = 'credit',
  client?: ReturnType<typeof createAdminClient>,
): Promise<number | null> {
  try {
    const admin = client ?? defaultAdminClient();
    const { data, error } = await admin
      .from('provider_pricing_config')
      .select('unit_cost_usd')
      .eq('provider_key', providerKey)
      .eq('operation_key', operationKey)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const unit = Number((data as { unit_cost_usd: unknown }).unit_cost_usd);
    return Number.isFinite(unit) && unit >= 0 ? unit : null;
  } catch {
    return null;
  }
}

/** Dólares de una consulta: lee la tarifa sólo cuando hacen falta (créditos > 0). */
export async function estimateProviderCreditCostUsd(
  providerKey: string,
  credits: number | null | undefined,
  operationKey = 'credit',
  loadUnitCost: (provider: string, operation: string) => Promise<number | null> = loadProviderCreditUnitCost,
): Promise<number | null> {
  if (credits === null || credits === undefined || !Number.isFinite(credits)) return null;
  if (credits === 0) return 0;
  return creditCostUsd(credits, await loadUnitCost(providerKey, operationKey));
}
