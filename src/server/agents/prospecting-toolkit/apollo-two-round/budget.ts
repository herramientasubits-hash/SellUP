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

// ─── Estado explicativo del bloqueo (§ 10) ────────────────────────────────────

/**
 * Detalle explicativo cuando la reserva bloquea una corrida de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 10: antes existía aquí un
 * `evaluateApolloTwoRoundBudgetPreflight` completo que devolvía este código. No
 * tenía consumidor de producción —el bloqueo real lo decide la reserva atómica
 * (`reserveWizardPilotCredits`), que lee el presupuesto disponible y el tope por
 * ejecución dentro de la propia RPC— y sostenerlo habría exigido duplicar esa
 * lectura sólo para poder volver a decidir lo ya decidido.
 *
 * Así que el evaluador se eliminó y quedó el código, que sí tiene un consumidor
 * real: `executeProspectWizardGeneration` lo adjunta como `blockDetail` cuando la
 * reserva bloquea con la modalidad activa. La autoridad no se movió; lo que se
 * añadió es poder explicar cuál era el techo que no cupo.
 */
export const BUDGET_EXCEEDED_TWO_ROUND_APOLLO = 'BUDGET_EXCEEDED_TWO_ROUND_APOLLO' as const;

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
