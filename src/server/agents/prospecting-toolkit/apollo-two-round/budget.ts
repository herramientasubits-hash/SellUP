/**
 * budget.ts — Presupuesto de la modalidad de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 10.
 *
 * La estimación considera el PEOR caso permitido por la configuración efectiva,
 * no el caso esperado:
 *
 *   búsqueda ronda 1  ≤ WIZARD_APOLLO_MAX_PAGES_HARD_CAP  (5 páginas)
 *   búsqueda ronda 2  ≤ WIZARD_APOLLO_MAX_PAGES_HARD_CAP  (5 páginas)
 *   enrichment        ≤ maxEnrichmentsPerRun              (2)
 *   ───────────────────────────────────────────────────────
 *   máximo interno registrable                            12
 *
 * AGENT1-APOLLO-NET-NEW-PAGINATION-LIVE-WIRING — la reserva de Search es POR
 * PÁGINA, no por organización pedida. Apollo cobra 1 crédito por página de
 * Organization Search NO VACÍA, sin importar cuántos resultados traiga esa
 * página (hasta 100) — el settlement real ya factura así
 * (`apollo-organizations-paginated-search.ts`). Con la paginación net-new
 * conectada en vivo (`production-runner.server.ts`), una ronda puede pedir
 * varias páginas dentro de UNA sola invocación de búsqueda, y el único techo
 * real de esa invocación es `WIZARD_APOLLO_MAX_PAGES_HARD_CAP` — el tope de
 * páginas que `createApolloPaginationBudget` aplica sin excepción — NUNCA
 * `config.maxResultsPerRound`: pedir 100 organizaciones en una página cuesta
 * exactamente lo mismo que pedir 5. Reservar por `maxResultsPerRound` (el
 * formato anterior) sobre-reservaba cuando ese valor superaba el tope de
 * páginas (p. ej. 10 resultados pedidos reservaba 10 créditos por una
 * invocación que como mucho cuesta 5) y, al revés, sub-declaraba el gasto real
 * posible cuando el objetivo restante obligaba a agotar el tope de páginas
 * pidiendo pocos resultados por ronda.
 *
 * Cuatro cantidades que se confunden habitualmente y aquí no comparten campo:
 *
 *   estimatedCredits         — lo que el preflight predijo
 *   reservedCredits          — lo que la reserva sostiene
 *   recordedUsageCredits     — lo que NUESTROS logs registraron
 *   confirmedProviderCredits — lo que el PROVEEDOR confirmó haber facturado
 *
 * `confirmedProviderCredits` permanece `null` sin evidencia externa aislable.
 *
 * Los créditos de enrichment salen de `apollo-operation-pricing`, la misma
 * tabla con la que se reserva y se registra ese consumo — esa mitad NO cambió.
 * Nada de `5 + 5 + 2` sobre números sueltos aquí.
 *
 * Puro: sin I/O y sin env.
 */

import {
  creditsForApolloOperation,
  APOLLO_PRICING_SOURCE,
  APOLLO_PRICING_VERSION,
} from '../apollo-operation-pricing';
import { WIZARD_APOLLO_MAX_PAGES_HARD_CAP } from '../apollo-organizations-pagination-budget';
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
  // § arriba — el techo de UNA invocación de búsqueda de ronda es el de
  // páginas, no el de organizaciones pedidas: `config.maxResultsPerRound` ya
  // no participa en esta cuenta.
  const perRound = WIZARD_APOLLO_MAX_PAGES_HARD_CAP;
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
