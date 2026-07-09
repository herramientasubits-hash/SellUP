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

/**
 * Provider-neutral shape for a resolved per_credit pricing row, carrying the
 * config id snapshot alongside the unit cost. Used where the caller needs
 * to trace the exact pricing_config_id used (17B.4X.5).
 */
export interface ActiveProviderCreditPricingV1 {
  pricingConfigId: string;
  providerKey: string;
  operationKey: string;
  unit: 'per_credit';
  unitCostUsd: number;
}

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

/**
 * Carga la configuración activa de pricing per_credit para Lusha
 * (Agente 2A · 17B.4X.5). Misma disciplina null-safe que
 * loadActiveTavilyPerCreditPricing: nunca inventa un fallback 0. Un
 * unit_cost_usd configurado en 0 sigue siendo representable como pricing
 * válido — solo se retorna null cuando no hay fila activa, la fila no es
 * per_credit, el costo no es un número finito no negativo, o la query falla.
 */
async function loadActiveLushaPerCreditPricing(
  operationKey: string,
): Promise<ActiveProviderCreditPricingV1 | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('provider_pricing_config')
      .select('id, provider_key, operation_key, unit, unit_cost_usd')
      .eq('provider_key', 'lusha')
      .eq('operation_key', operationKey)
      .eq('unit', 'per_credit')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const unitCostUsd = Number(data.unit_cost_usd);
    if (!Number.isFinite(unitCostUsd) || unitCostUsd < 0) return null;

    return {
      pricingConfigId: data.id as string,
      providerKey: data.provider_key as string,
      operationKey: data.operation_key as string,
      unit: 'per_credit',
      unitCostUsd,
    };
  } catch {
    return null;
  }
}

/**
 * Carga la configuración activa de pricing Lusha para operation_key='credit'
 * (contrato final 17B.4X.4A: lusha/credit/per_credit, unit_cost_usd
 * 0.08823529 en producción). Retorna null si no hay pricing activo —
 * el caller trata null como costo desconocido, nunca como costo 0.
 */
export async function loadActiveLushaCreditPricing(): Promise<ActiveProviderCreditPricingV1 | null> {
  return loadActiveLushaPerCreditPricing('credit');
}
