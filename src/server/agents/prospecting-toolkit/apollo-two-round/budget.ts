/**
 * budget.ts — Presupuesto de la modalidad de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 10.
 *
 * La estimación considera el PEOR caso permitido por la configuración efectiva,
 * no el caso esperado:
 *
 *   búsqueda ronda 1  ≤ maxResultsPerRound        (5)
 *   búsqueda ronda 2  ≤ maxResultsPerRound        (5)
 *   enrichment        ≤ maxEnrichmentsPerRun      (2)
 *   ───────────────────────────────────────────────
 *   máximo interno registrable                    12
 *
 * Cuatro cantidades que se confunden habitualmente y aquí no comparten campo:
 *
 *   estimatedCredits         — lo que el preflight predijo
 *   reservedCredits          — lo que la reserva sostiene
 *   recordedUsageCredits     — lo que NUESTROS logs registraron
 *   confirmedProviderCredits — lo que el PROVEEDOR confirmó haber facturado
 *
 * `confirmedProviderCredits` permanece `null` sin evidencia externa aislable. El
 * ledger interno cobra 1 crédito por resultado porque es el modelo conservador
 * que el repo eligió; eso NO permite afirmar que Apollo factura por resultado.
 *
 * Los créditos por unidad salen de `apollo-operation-pricing`, la misma tabla con
 * la que se reserva y se registra el consumo. Nada de `5 + 5 + 2` aquí.
 *
 * Puro: sin I/O y sin env.
 */

import {
  creditsForApolloOperation,
  APOLLO_PRICING_SOURCE,
  APOLLO_PRICING_VERSION,
} from '../apollo-operation-pricing';
import type { ApolloTwoRoundDiscoveryConfig } from './config';

// ─── Desglose del peor caso ───────────────────────────────────────────────────

export type ApolloTwoRoundBudgetBreakdown = {
  /** Créditos máximos de búsqueda por ronda, en orden. */
  searchCreditsPerRound: number[];
  searchRound1Maximum: number;
  searchRound2Maximum: number;
  enrichmentMaximum: number;
  /** Suma de todo lo anterior: el techo interno registrable de la corrida. */
  maximumInternalRecordedCredits: number;
  pricingSource: string;
  pricingVersion: string;
  /** Config efectiva que produjo estos números, para reproducir la reserva. */
  config: ApolloTwoRoundDiscoveryConfig;
};

/**
 * Peor caso permitido por la configuración efectiva.
 *
 * Deliberadamente NO descuenta la parada temprana: el preflight tiene que poder
 * cubrir una corrida que use todo su presupuesto autorizado, y una reserva que
 * asuma la parada temprana dejaría a la ronda 2 sin cobertura justo cuando hace
 * falta.
 */
export function estimateApolloTwoRoundBudget(
  config: ApolloTwoRoundDiscoveryConfig,
): ApolloTwoRoundBudgetBreakdown {
  const perRound = creditsForApolloOperation(
    'organizations_search',
    config.maxResultsPerRound,
  );
  const searchCreditsPerRound = Array.from({ length: config.maxRounds }, () => perRound);
  const searchTotal = searchCreditsPerRound.reduce((sum, value) => sum + value, 0);
  const enrichmentMaximum = creditsForApolloOperation(
    'organization_enrichment',
    config.maxEnrichmentsPerRun,
  );

  return {
    searchCreditsPerRound,
    searchRound1Maximum: searchCreditsPerRound[0] ?? 0,
    searchRound2Maximum: searchCreditsPerRound[1] ?? 0,
    enrichmentMaximum,
    maximumInternalRecordedCredits: searchTotal + enrichmentMaximum,
    pricingSource: APOLLO_PRICING_SOURCE,
    pricingVersion: APOLLO_PRICING_VERSION,
    config,
  };
}

// ─── Preflight ────────────────────────────────────────────────────────────────

/** Estado explicativo del § 10 cuando el presupuesto no alcanza. */
export const BUDGET_EXCEEDED_TWO_ROUND_APOLLO = 'BUDGET_EXCEEDED_TWO_ROUND_APOLLO' as const;

export type ApolloTwoRoundBudgetPreflightInput = {
  config: ApolloTwoRoundDiscoveryConfig;
  /** Créditos disponibles en el periodo. */
  availableCredits: number;
  /** Tope por ejecución que la política del piloto impone. */
  maxCreditsPerExecution: number;
};

export type ApolloTwoRoundBudgetPreflight =
  | {
      passed: true;
      breakdown: ApolloTwoRoundBudgetBreakdown;
      /** Lo que hay que reservar antes de la primera llamada. */
      creditsToReserve: number;
      blockReason: null;
    }
  | {
      passed: false;
      breakdown: ApolloTwoRoundBudgetBreakdown;
      creditsToReserve: 0;
      blockReason: typeof BUDGET_EXCEEDED_TWO_ROUND_APOLLO;
      /** Qué límite concreto no alcanzó. Ambos códigos son estáticos. */
      blockDetail: 'exceeds_max_credits_per_execution' | 'insufficient_available_budget';
    };

/**
 * Rechaza la ejecución ANTES de cualquier llamada cuando el presupuesto
 * disponible es inferior al máximo requerido por la configuración efectiva.
 *
 * No existe reserva parcial: una corrida que no puede cubrir su máximo
 * autorizado empezaría gastando y se quedaría sin cobertura a mitad de la ronda
 * 2 — precisamente el descuadre que este hito evita. O cabe entera o no empieza.
 */
export function evaluateApolloTwoRoundBudgetPreflight(
  input: ApolloTwoRoundBudgetPreflightInput,
): ApolloTwoRoundBudgetPreflight {
  const breakdown = estimateApolloTwoRoundBudget(input.config);
  const required = breakdown.maximumInternalRecordedCredits;

  if (required > input.maxCreditsPerExecution) {
    return {
      passed: false,
      breakdown,
      creditsToReserve: 0,
      blockReason: BUDGET_EXCEEDED_TWO_ROUND_APOLLO,
      blockDetail: 'exceeds_max_credits_per_execution',
    };
  }
  if (required > input.availableCredits) {
    return {
      passed: false,
      breakdown,
      creditsToReserve: 0,
      blockReason: BUDGET_EXCEEDED_TWO_ROUND_APOLLO,
      blockDetail: 'insufficient_available_budget',
    };
  }

  return { passed: true, breakdown, creditsToReserve: required, blockReason: null };
}

// ─── Las cuatro cantidades ────────────────────────────────────────────────────

/**
 * Contabilidad de una corrida. Los cuatro campos son independientes por diseño:
 * ninguno se deriva de otro, y `confirmedProviderCredits` nunca se rellena desde
 * `recordedUsageCredits`.
 */
export type ApolloTwoRoundSpendAccounting = {
  estimatedCredits: number;
  reservedCredits: number;
  recordedUsageCredits: number;
  /** null = el proveedor no lo confirmó. NUNCA se infiere del ledger interno. */
  confirmedProviderCredits: number | null;
};

export function buildApolloTwoRoundSpendAccounting(input: {
  estimatedCredits: number;
  reservedCredits: number;
  recordedUsageCredits: number;
  /**
   * Sólo se rellena con evidencia externa aislable (un extracto de Apollo
   * atribuible a esta corrida). Sin ella queda null.
   */
  providerConfirmedEvidence?: { credits: number } | null;
}): ApolloTwoRoundSpendAccounting {
  return {
    estimatedCredits: input.estimatedCredits,
    reservedCredits: input.reservedCredits,
    recordedUsageCredits: input.recordedUsageCredits,
    confirmedProviderCredits: input.providerConfirmedEvidence?.credits ?? null,
  };
}

/** Metadata sanitizada del presupuesto. Sin secretos ni valores crudos de env. */
export function toApolloTwoRoundBudgetMetadata(
  breakdown: ApolloTwoRoundBudgetBreakdown,
): Record<string, unknown> {
  return {
    search_round_1_maximum: breakdown.searchRound1Maximum,
    search_round_2_maximum: breakdown.searchRound2Maximum,
    enrichment_maximum: breakdown.enrichmentMaximum,
    maximum_internal_recorded_credits: breakdown.maximumInternalRecordedCredits,
    pricing_source: breakdown.pricingSource,
    pricing_version: breakdown.pricingVersion,
    target_eligible_companies: breakdown.config.targetEligibleCompanies,
    max_rounds: breakdown.config.maxRounds,
    max_results_per_round: breakdown.config.maxResultsPerRound,
    max_raw_results_per_run: breakdown.config.maxRawResultsPerRun,
    max_enrichments_per_run: breakdown.config.maxEnrichmentsPerRun,
  };
}
