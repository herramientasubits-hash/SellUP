// ============================================================
// budgets — plan contratado de un proveedor (SETTINGS-PROVIDER-CONTRACT-PLAN-1)
// ============================================================
// Sólo lectura. Junta la fila de precio ACTIVA (`provider_pricing_config`,
// `credit · per_credit`) y lo sincronizado en `tool_catalog` (lo que queda y la
// renovación). La vista se arma en `provider-contract-plan.ts`, puro.
//
// Un fallo de lectura devuelve el plan sin esos datos (`null` en cada campo), no
// un error: el contrato se puede mostrar igual.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildProviderContractPlanView,
  type ProviderContractPlanView,
} from './provider-contract-plan';

export async function getProviderContractPlan(
  providerKey: string,
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<ProviderContractPlanView | null> {
  const key = providerKey.toLowerCase();
  // Sin contrato conocido no se consulta nada.
  if (buildProviderContractPlanView({ ...EMPTY, providerKey: key, now }) === null) return null;

  const [pricing, catalog] = await Promise.all([
    client
      .from('provider_pricing_config')
      .select('unit_cost_usd, effective_from')
      .eq('provider_key', key)
      .eq('operation_key', 'credit')
      .eq('unit', 'per_credit')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('tool_catalog')
      .select('credits_remaining_external, quota_synced_at, billing_period_end')
      .eq('provider_key', key)
      .maybeSingle(),
  ]);

  const price = pricing.error ? null : (pricing.data as PricingRow | null);
  const tool = catalog.error ? null : (catalog.data as CatalogRow | null);

  return buildProviderContractPlanView({
    providerKey: key,
    activeUnitCostUsd: price?.unit_cost_usd != null ? Number(price.unit_cost_usd) : null,
    activeUnitCostEffectiveFrom: price?.effective_from ?? null,
    creditsRemaining:
      tool?.credits_remaining_external != null ? Number(tool.credits_remaining_external) : null,
    creditsRemainingSyncedAt: tool?.quota_synced_at ?? null,
    renewalDate: tool?.billing_period_end ?? null,
    now,
  });
}

type PricingRow = { unit_cost_usd: number | string | null; effective_from: string | null };
type CatalogRow = {
  credits_remaining_external: number | string | null;
  quota_synced_at: string | null;
  billing_period_end: string | null;
};

const EMPTY = {
  activeUnitCostUsd: null,
  activeUnitCostEffectiveFrom: null,
  creditsRemaining: null,
  creditsRemainingSyncedAt: null,
  renewalDate: null,
};
