'use server';

/**
 * provider-pricing.ts — Loader de configuración activa de pricing desde Supabase.
 *
 * Server-only. No expone credenciales ni valores de tarifa al cliente.
 * No modifica la tarifa durante la ejecución.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ActivePricingConfig = {
  unitCostUsd: number;
  unit: 'per_credit';
};

// ─── Admin client ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Carga la configuración activa de pricing per_credit para un operation_key dado.
 *
 * Retorna null si:
 * - No existe configuración activa
 * - La unidad no es per_credit
 * - El costo no es un número finito no negativo
 * - Supabase no está configurado
 */
async function loadActiveTavilyPerCreditPricing(
  operationKey: string,
): Promise<ActivePricingConfig | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('provider_pricing_config')
      .select('unit, unit_cost_usd')
      .eq('provider_key', 'tavily')
      .eq('operation_key', operationKey)
      .eq('unit', 'per_credit')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const unitCostUsd = Number(data.unit_cost_usd);
    if (!Number.isFinite(unitCostUsd) || unitCostUsd < 0) return null;

    return { unitCostUsd, unit: 'per_credit' };
  } catch {
    return null;
  }
}

/**
 * Carga la configuración activa de pricing para Tavily multi_query_web_search.
 */
export async function loadActiveTavilyMultiQueryPricing(): Promise<ActivePricingConfig | null> {
  return loadActiveTavilyPerCreditPricing('multi_query_web_search');
}

/**
 * Carga la configuración activa de pricing para Tavily linkedin_company_search
 * (Agent 1 · v1.16K-R-B). Misma estructura per_credit que multi_query_web_search.
 *
 * Resuelve el unit_cost_usd inyectado en el usage logging del controlled LinkedIn
 * search. Retorna null bajo las mismas condiciones que el loader genérico; el
 * caller trata null como "pricing faltante" (no como costo 0) y bloquea de forma
 * visible las llamadas reales a Tavily.
 */
export async function loadActiveTavilyLinkedInCompanySearchPricing(): Promise<ActivePricingConfig | null> {
  return loadActiveTavilyPerCreditPricing('linkedin_company_search');
}
