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

// ─── Estado de construcción del request efectivo ──────────────────────────────

/**
 * A1-APOLLO-EFFECTIVE-FINGERPRINT-HARDENING-3 § 4 — por qué una ronda tiene (o no
 * tiene) huella efectiva.
 *
 * Existe porque `effectiveProviderFingerprint = null` no dice NADA sobre la causa,
 * y la causa es lo que decide si una segunda llamada pagada puede autorizarse. Un
 * `catch` que devolvía `null` convertía tres situaciones distintas —no hay
 * constructor, el constructor falló, el checkpoint es antiguo— en el mismo silencio.
 *
 *   `success`                   la huella se construyó y es la del body que saldría.
 *   `unavailable_dependency`    no hay constructor inyectado (suites puras).
 *   `build_error`               el constructor lanzó o no devolvió nada.
 *   `legacy_checkpoint_missing` ronda rehidratada de un checkpoint anterior a este
 *                               hito, sin el campo. NUNCA se rellena con la
 *                               huella de hipótesis.
 */
export type ApolloEffectiveRequestBuildStatus =
  | 'success'
  | 'unavailable_dependency'
  | 'build_error'
  | 'legacy_checkpoint_missing';

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
  /**
   * QUERY-QUALITY-2 § 4 y § 10 — organizaciones que esta ronda aportó y que NO
   * se habían visto antes.
   *
   * Antes esta cifra se proyectaba desde `normalizedResults`, que cuenta también
   * los repetidos: por eso la corrida QA `edb6f40c` reportó a la vez
   * `new_unique_results = 3` y `seen_duplicates = 3` sobre tres resultados. Un
   * mismo resultado no puede ser nuevo y repetido.
   *
   * Invariante: `newUniqueResults + seenDuplicates <= normalizedResults`.
   */
  newUniqueResults: number;
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
  /**
   * § 12 — huella de la HIPÓTESIS de esta ronda: los términos antes de la
   * prioridad, la deduplicación y el truncamiento del mapper.
   *
   * Sirve para explicar la intención, NUNCA para decidir si la ronda 2 vale un
   * crédito: dos hipótesis distintas pueden colapsar al mismo body efectivo, y esa
   * es exactamente la segunda búsqueda que la corrida QA `edb6f40c` pagó de más.
   * La decisión usa `effectiveProviderFingerprint`.
   */
  providerRequestFingerprint: string | null;
  /**
   * QUERY-QUALITY-2-FIX § 1 y § 10 — huella del request EFECTIVO que salió al
   * proveedor: body ya priorizado, deduplicado, truncado y con su página.
   *
   * Es la única medida honesta de «esta ronda pidió algo distinto». Null cuando la
   * corrida no pudo construirlo (suites puras sin adaptador): ausencia no es
   * igualdad, y por eso se reporta null en vez de repetir la huella de hipótesis.
   */
  effectiveProviderFingerprint: string | null;
  /**
   * HARDENING-3 § 4 — por qué la huella efectiva está o falta. `null` sin causa
   * declarada dejaba indistinguibles "no hay constructor" y "el constructor falló",
   * y las dos deben impedir una segunda llamada pagada por motivos distintos.
   */
  effectiveRequestBuildStatus: ApolloEffectiveRequestBuildStatus;
  /**
   * HARDENING-3 § 4 — código sanitizado del fallo. Sólo el nombre del error, nunca
   * el mensaje, la traza, el payload ni la API key. Null salvo en `build_error`.
   */
  effectiveRequestBuildErrorCode: string | null;
  /** § 12 — página pedida por esta ronda. */
  page: number | null;
  /** § 10 — `per_page` que el request efectivo llevó. Null si no se construyó. */
  perPage: number | null;
  /** § 12 — términos de la HIPÓTESIS. Ni el texto humano ni una paráfrasis. */
  specificTermsSent: string[];
  /** § 10 — términos que EFECTIVAMENTE viajaron, tras prioridad y truncamiento. */
  effectiveKeywordsSent: string[];
  /** § 12 — `total_pages` que el proveedor declaró en esta ronda. */
  providerTotalPages: number | null;
};

export function buildEmptyRoundMetrics(
  roundNumber: number,
  queryHypothesis: string,
  adaptationReason: string | null = null,
  provider: {
    requestFingerprint?: string | null;
    effectiveRequestFingerprint?: string | null;
    effectiveRequestBuildStatus?: ApolloEffectiveRequestBuildStatus;
    effectiveRequestBuildErrorCode?: string | null;
    page?: number | null;
    perPage?: number | null;
    specificTermsSent?: readonly string[];
    effectiveKeywordsSent?: readonly string[];
  } = {},
): ApolloTwoRoundRoundMetrics {
  return {
    roundNumber,
    queryHypothesis,
    adaptationReason,
    providerRequestCount: 0,
    rawResultsReturned: 0,
    normalizedResults: 0,
    newUniqueResults: 0,
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
    providerRequestFingerprint: provider.requestFingerprint ?? null,
    effectiveProviderFingerprint: provider.effectiveRequestFingerprint ?? null,
    // Sin causa declarada, la ausencia de constructor es la lectura honesta: es lo
    // que hace una suite pura, y es fail-closed para la ronda 2.
    effectiveRequestBuildStatus:
      provider.effectiveRequestBuildStatus ??
      (provider.effectiveRequestFingerprint ? 'success' : 'unavailable_dependency'),
    effectiveRequestBuildErrorCode: provider.effectiveRequestBuildErrorCode ?? null,
    page: provider.page ?? null,
    perPage: provider.perPage ?? null,
    specificTermsSent: [...(provider.specificTermsSent ?? [])],
    effectiveKeywordsSent: [...(provider.effectiveKeywordsSent ?? [])],
    providerTotalPages: null,
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
  /** § 10 — resultados normalizados sumados. Denominador de las invariantes. */
  totalNormalizedResults: number;
  /** § 10 — nuevos, sin repetir. `totalNewUniqueResults + totalSeenDuplicates <= totalNormalizedResults`. */
  totalNewUniqueResults: number;
  /** § 10 — repetidos, dentro de la respuesta o contra rondas anteriores. */
  totalSeenDuplicates: number;
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
  /**
   * HARDENING-3 § 7 — ¿las huellas EFECTIVAS de las dos rondas resultaron
   * distintas?
   *
   * `true`/`false` sólo cuando la comparación se pudo hacer de verdad. `null`
   * cuando no se llegó a comparar —objetivo alcanzado en la ronda 1, `maxRounds=1`—
   * o cuando una de las dos huellas no se pudo construir. Un `false` ahí afirmaría
   * "son iguales" sobre un dato que nadie tiene.
   */
  effectiveFingerprintsAreDistinct: boolean | null;
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
  /** HARDENING-3 § 7 — resultado de la comparación efectiva. Ausente ⇒ null. */
  effectiveFingerprintsAreDistinct?: boolean | null;
}): ApolloTwoRoundRunMetrics {
  const totalRawResults = input.rounds.reduce((sum, r) => sum + r.rawResultsReturned, 0);
  const totalNormalizedResults = input.rounds.reduce((sum, r) => sum + r.normalizedResults, 0);
  const totalNewUniqueResults = input.rounds.reduce((sum, r) => sum + r.newUniqueResults, 0);
  const totalSeenDuplicates = input.rounds.reduce((sum, r) => sum + r.seenDuplicates, 0);
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
    totalNormalizedResults,
    totalNewUniqueResults,
    totalSeenDuplicates,
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
    effectiveFingerprintsAreDistinct: input.effectiveFingerprintsAreDistinct ?? null,
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
    new_unique_results: metrics.newUniqueResults,
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
    // § 12 — lo que el próximo QA necesita para no depender del texto humano.
    provider_request_fingerprint: metrics.providerRequestFingerprint,
    // § 10 — las DOS huellas, nombradas, para que nadie confunda la intención con
    // lo que salió. La decisión económica usa la efectiva.
    hypothesis_fingerprint: metrics.providerRequestFingerprint,
    effective_provider_fingerprint: metrics.effectiveProviderFingerprint,
    // HARDENING-3 § 4 y § 7 — la causa viaja junto al dato: un null con
    // `build_error` no se lee igual que un null con `unavailable_dependency`.
    effective_request_build_status: metrics.effectiveRequestBuildStatus,
    effective_request_build_error_code: metrics.effectiveRequestBuildErrorCode,
    page: metrics.page,
    per_page: metrics.perPage,
    specific_terms_sent: metrics.specificTermsSent,
    effective_keywords_sent: metrics.effectiveKeywordsSent,
    provider_total_pages: metrics.providerTotalPages,
  };
}

export function toRunMetricsMetadata(
  metrics: ApolloTwoRoundRunMetrics,
): Record<string, unknown> {
  return {
    rounds_executed: metrics.roundsExecuted,
    total_raw_results: metrics.totalRawResults,
    total_normalized_results: metrics.totalNormalizedResults,
    total_new_unique_results: metrics.totalNewUniqueResults,
    total_seen_duplicates: metrics.totalSeenDuplicates,
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
    // HARDENING-3 § 7 — null cuando la comparación no se pudo hacer. Nunca false.
    effective_fingerprints_are_distinct: metrics.effectiveFingerprintsAreDistinct,
  };
}
