/**
 * provider-contract-plan.ts — el plan contratado de un proveedor, listo para
 * mostrar.
 *
 * SETTINGS-PROVIDER-CONTRACT-PLAN-1. Configuración mostraba la cuota que usa el
 * producto (el tope interno o lo que devuelve la API), pero nunca el CONTRATO:
 * cuánto se pagó, por cuántos créditos, a qué precio y cuándo renueva. Y en Lusha
 * rotulaba como «Créditos mensuales» el total ANUAL que devuelve su API.
 *
 * Esta vista junta tres fuentes y dice de dónde sale cada número:
 *
 *   · el contrato (`provider-contract-prices.ts`, confirmado 2026-09-24);
 *   · el precio ACTIVO de `provider_pricing_config`, que es el que usa el
 *     registro de costos. Si difiere del contrato, se marca;
 *   · lo que queda y la renovación, sincronizados en `tool_catalog`.
 *
 * Puro: sin env, sin I/O; el reloj entra por parámetro.
 */

import { APOLLO_CONTRACT, LUSHA_CONTRACT } from '@/modules/usage-tracking/provider-contract-prices';

type ContractTerms = {
  annualCredits: number;
  annualUsd: number;
  usdPerCredit: number;
};

const CONTRACTS: Readonly<Record<string, ContractTerms>> = {
  apollo: APOLLO_CONTRACT,
  lusha: LUSHA_CONTRACT,
};

/** Precio por crédito con tolerancia de redondeo a 8 decimales. */
const PRICE_EPSILON = 5e-9;
const MS_PER_DAY = 86_400_000;

export type ProviderContractPlanInput = {
  providerKey: string;
  /** `unit_cost_usd` de la fila activa `credit · per_credit`; null si no hay. */
  activeUnitCostUsd: number | null;
  /** `effective_from` de esa fila (YYYY-MM-DD). */
  activeUnitCostEffectiveFrom: string | null;
  /** `tool_catalog.credits_remaining_external` (última sincronización). */
  creditsRemaining: number | null;
  /** `tool_catalog.quota_synced_at`. */
  creditsRemainingSyncedAt: string | null;
  /** `tool_catalog.billing_period_end` (YYYY-MM-DD). */
  renewalDate: string | null;
  now: Date;
};

export type ProviderContractPlanView = {
  billing: 'annual';
  annualCredits: number;
  annualUsd: number;
  contractUsdPerCredit: number;
  /** Precio que usa el registro de costos. null ⇒ sin fila activa. */
  activeUsdPerCredit: number | null;
  activeUsdPerCreditEffectiveFrom: string | null;
  /** false ⇒ la tabla de precios no refleja el contrato (o no tiene fila). */
  pricingMatchesContract: boolean;
  creditsRemaining: number | null;
  creditsRemainingSyncedAt: string | null;
  /** Porcentaje del plan anual que queda (0-100), si se conoce lo que queda. */
  remainingPercentOfPlan: number | null;
  renewalDate: string | null;
  /** Días enteros hasta la renovación; negativo si ya pasó. */
  daysToRenewal: number | null;
};

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** null para proveedores sin contrato de créditos conocido. */
export function buildProviderContractPlanView(
  input: ProviderContractPlanInput,
): ProviderContractPlanView | null {
  const contract = CONTRACTS[input.providerKey];
  if (!contract) return null;

  const active = finiteOrNull(input.activeUnitCostUsd);
  const remaining = finiteOrNull(input.creditsRemaining);
  const renewal = parseDay(input.renewalDate);
  const today = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  );

  return {
    billing: 'annual',
    annualCredits: contract.annualCredits,
    annualUsd: contract.annualUsd,
    contractUsdPerCredit: contract.usdPerCredit,
    activeUsdPerCredit: active,
    activeUsdPerCreditEffectiveFrom: active !== null ? input.activeUnitCostEffectiveFrom : null,
    pricingMatchesContract:
      active !== null && Math.abs(active - contract.usdPerCredit) <= PRICE_EPSILON,
    creditsRemaining: remaining,
    creditsRemainingSyncedAt: remaining !== null ? input.creditsRemainingSyncedAt : null,
    remainingPercentOfPlan:
      remaining !== null
        ? Math.max(0, Math.min(100, Math.round((remaining / contract.annualCredits) * 1000) / 10))
        : null,
    renewalDate: renewal ? input.renewalDate : null,
    daysToRenewal: renewal ? Math.round((renewal.getTime() - today) / MS_PER_DAY) : null,
  };
}
