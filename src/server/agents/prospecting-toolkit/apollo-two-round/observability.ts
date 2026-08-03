/**
 * observability.ts — Métricas por ronda y totales de la corrida.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 11.
 *
 * El objetivo declarado del hito es reducir a cero el caso observado
 * "`citi.com` enriquecido → deduplicado después". Ese caso tiene aquí un nombre y
 * un contador: `enrichmentWaste`. Sin métrica, "mejoramos la precisión" no es
 * verificable.
 *
 * Todas las tasas se devuelven `null` cuando el denominador es cero. Un `0.0`
 * fabricado se leería como "no hubo desperdicio" cuando el hecho real es "no
 * hubo enrichments que desperdiciar".
 *
 * Puro: sin I/O, sin reloj.
 */

// ─── Ronda ────────────────────────────────────────────────────────────────────

export type ApolloTwoRoundRoundMetrics = {
  roundNumber: number;
  queryHypothesis: string;
  /**
   * Por qué la hipótesis de esta ronda difiere de la anterior. Null en la ronda
   * 1, que no adapta nada. § 4 lo exige en la observabilidad REAL, no sólo en
   * los objetos que ve un test unitario.
   */
  adaptationReason: string | null;
  /** Llamadas de búsqueda emitidas al proveedor en esta ronda. */
  providerRequestCount: number;
  rawResultsReturned: number;
  normalizedResults: number;
  /** Ya vistas en rondas anteriores o repetidas dentro de la misma respuesta. */
  seenDuplicates: number;
  /** Duplicados contra SellUp / HubSpot / sugerencias previas. */
  knownCompanyDuplicates: number;
  countryRejected: number;
  sectorRejected: number;
  ownershipRejected: number;
  eligibleBeforeEnrichment: number;
  /** Candidatos que compitieron por un enrichment. */
  enrichmentCandidates: number;
  enrichmentsExecuted: number;
  eligibleAfterEnrichment: number;
  /** Elegibles NUEVAS que esta ronda añadió al acumulado de la corrida. */
  newEligibleCompaniesAdded: number;
  /** Créditos que NUESTRO ledger registró para esta ronda. */
  internalRecordedCredits: number;
};

export function buildEmptyRoundMetrics(
  roundNumber: number,
  queryHypothesis: string,
  adaptationReason: string | null = null,
): ApolloTwoRoundRoundMetrics {
  return {
    roundNumber,
    queryHypothesis,
    adaptationReason,
    providerRequestCount: 0,
    rawResultsReturned: 0,
    normalizedResults: 0,
    seenDuplicates: 0,
    knownCompanyDuplicates: 0,
    countryRejected: 0,
    sectorRejected: 0,
    ownershipRejected: 0,
    eligibleBeforeEnrichment: 0,
    enrichmentCandidates: 0,
    enrichmentsExecuted: 0,
    eligibleAfterEnrichment: 0,
    newEligibleCompaniesAdded: 0,
    internalRecordedCredits: 0,
  };
}

// ─── Desperdicio de enrichment ────────────────────────────────────────────────

/**
 * § 11: un enrichment desperdiciado es uno que se EJECUTÓ y cuya organización
 * terminó rechazada o duplicada.
 *
 * Requiere ambas condiciones: un enrichment que se ejecutó y cuya empresa quedó
 * elegible no es desperdicio aunque no llegue a persistirse por el tope, y una
 * organización rechazada sin enrichment no gastó nada que desperdiciar.
 */
export type EnrichmentOutcome = {
  candidateKey: string;
  enrichmentExecuted: boolean;
  finallyRejectedOrDuplicated: boolean;
};

export function countEnrichmentWaste(outcomes: readonly EnrichmentOutcome[]): number {
  return outcomes.filter(
    (outcome) => outcome.enrichmentExecuted && outcome.finallyRejectedOrDuplicated,
  ).length;
}

// ─── Totales de la corrida ────────────────────────────────────────────────────

export type ApolloTwoRoundRunMetrics = {
  roundsExecuted: number;
  totalRawResults: number;
  totalUniqueOrganizations: number;
  totalEligibleCompanies: number;
  persistedCandidates: number;
  totalSearchCredits: number;
  totalEnrichmentCredits: number;
  /** null cuando no hubo elegibles: dividir por cero no es "cero créditos". */
  creditsPerEligibleCompany: number | null;
  creditsPerPersistedCompany: number | null;
  /** Duplicados sobre resultados crudos. null sin resultados crudos. */
  duplicateRate: number | null;
  /**
   * Rechazos por sector o ownership sobre las organizaciones únicas: lo que el
   * proveedor devolvió y no pertenecía a lo buscado.
   */
  falsePositiveRate: number | null;
  /** Desperdicio sobre enrichments ejecutados. null sin enrichments. */
  enrichmentWasteRate: number | null;
  enrichmentsExecuted: number;
  enrichmentWaste: number;
};

/** Redondea a 4 decimales para que la métrica sea comparable entre corridas. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function buildRunMetrics(input: {
  rounds: readonly ApolloTwoRoundRoundMetrics[];
  totalUniqueOrganizations: number;
  totalEligibleCompanies: number;
  persistedCandidates: number;
  totalSearchCredits: number;
  totalEnrichmentCredits: number;
  enrichmentOutcomes: readonly EnrichmentOutcome[];
}): ApolloTwoRoundRunMetrics {
  const totalRawResults = input.rounds.reduce((sum, r) => sum + r.rawResultsReturned, 0);
  const duplicates = input.rounds.reduce(
    (sum, r) => sum + r.seenDuplicates + r.knownCompanyDuplicates,
    0,
  );
  const falsePositives = input.rounds.reduce(
    (sum, r) => sum + r.sectorRejected + r.ownershipRejected,
    0,
  );
  const enrichmentsExecuted = input.enrichmentOutcomes.filter((o) => o.enrichmentExecuted).length;
  const enrichmentWaste = countEnrichmentWaste(input.enrichmentOutcomes);
  const totalCredits = input.totalSearchCredits + input.totalEnrichmentCredits;

  return {
    roundsExecuted: input.rounds.length,
    totalRawResults,
    totalUniqueOrganizations: input.totalUniqueOrganizations,
    totalEligibleCompanies: input.totalEligibleCompanies,
    persistedCandidates: input.persistedCandidates,
    totalSearchCredits: input.totalSearchCredits,
    totalEnrichmentCredits: input.totalEnrichmentCredits,
    creditsPerEligibleCompany: ratio(totalCredits, input.totalEligibleCompanies),
    creditsPerPersistedCompany: ratio(totalCredits, input.persistedCandidates),
    duplicateRate: ratio(duplicates, totalRawResults),
    falsePositiveRate: ratio(falsePositives, input.totalUniqueOrganizations),
    enrichmentWasteRate: ratio(enrichmentWaste, enrichmentsExecuted),
    enrichmentsExecuted,
    enrichmentWaste,
  };
}

// ─── Metadata persistible ─────────────────────────────────────────────────────

/** Clave bajo la que la observabilidad de dos rondas aterriza en el metadata. */
export const APOLLO_TWO_ROUND_OBSERVABILITY_KEY = 'apollo_two_round_discovery' as const;

export function toRoundMetricsMetadata(
  metrics: ApolloTwoRoundRoundMetrics,
): Record<string, unknown> {
  return {
    round_number: metrics.roundNumber,
    query_hypothesis: metrics.queryHypothesis,
    adaptation_reason: metrics.adaptationReason,
    provider_request_count: metrics.providerRequestCount,
    raw_results: metrics.rawResultsReturned,
    raw_results_returned: metrics.rawResultsReturned,
    /** Organizaciones que esta ronda aportó y que no se habían visto antes. */
    new_unique_results: metrics.normalizedResults,
    /** Elegibles tras el enrichment: lo que la ronda realmente aportó al objetivo. */
    eligible_results: metrics.eligibleAfterEnrichment,
    /** Créditos internos registrados por esta ronda (búsqueda + enrichment). */
    credits: metrics.internalRecordedCredits,
    normalized_results: metrics.normalizedResults,
    seen_duplicates: metrics.seenDuplicates,
    known_company_duplicates: metrics.knownCompanyDuplicates,
    country_rejected: metrics.countryRejected,
    sector_rejected: metrics.sectorRejected,
    ownership_rejected: metrics.ownershipRejected,
    eligible_before_enrichment: metrics.eligibleBeforeEnrichment,
    enrichment_candidates: metrics.enrichmentCandidates,
    enrichments_executed: metrics.enrichmentsExecuted,
    eligible_after_enrichment: metrics.eligibleAfterEnrichment,
    new_eligible_companies_added: metrics.newEligibleCompaniesAdded,
    internal_recorded_credits: metrics.internalRecordedCredits,
  };
}

export function toRunMetricsMetadata(
  metrics: ApolloTwoRoundRunMetrics,
): Record<string, unknown> {
  return {
    rounds_executed: metrics.roundsExecuted,
    total_raw_results: metrics.totalRawResults,
    total_unique_organizations: metrics.totalUniqueOrganizations,
    total_eligible_companies: metrics.totalEligibleCompanies,
    persisted_candidates: metrics.persistedCandidates,
    total_search_credits: metrics.totalSearchCredits,
    total_enrichment_credits: metrics.totalEnrichmentCredits,
    credits_per_eligible_company: metrics.creditsPerEligibleCompany,
    credits_per_persisted_company: metrics.creditsPerPersistedCompany,
    duplicate_rate: metrics.duplicateRate,
    false_positive_rate: metrics.falsePositiveRate,
    enrichment_waste_rate: metrics.enrichmentWasteRate,
    enrichments_executed: metrics.enrichmentsExecuted,
    enrichment_waste: metrics.enrichmentWaste,
  };
}
