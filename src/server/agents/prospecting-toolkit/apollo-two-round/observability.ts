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

// ─── Decisión de página de la ronda 2 ─────────────────────────────────────────

/**
 * SCALE-SECOND-ROUND-FIX-1B § 1 — por qué la ronda 2 tuvo que pedir otra página.
 *
 *   `identical_effective_request`     el body efectivo colapsó al de la ronda 1
 *                                    (defecto que cerró HARDENING-3).
 *   `overlapping_effective_keywords`  los términos efectivos NO son idénticos pero
 *                                    se solapan, así que la página 1 devuelve la
 *                                    misma ventana de empresas. Es el defecto de la
 *                                    corrida live `eae6d47f`: 5 créditos, 0 nuevas.
 */
export type ApolloRound2PageEscalationReason =
  | 'identical_effective_request'
  | 'overlapping_effective_keywords';

/**
 * § 1B — la decisión de página de la ronda 2, con su causa y su resultado.
 *
 * `null` en el resultado de la corrida significa que NADIE la tomó en este intento
 * (no hubo ronda 2, o se recuperó de un checkpoint): nunca «se decidió la página 1».
 */
export type ApolloRound2PageDecision = {
  /** Página que la ronda 2 pidió REALMENTE al proveedor. */
  requestedPage: number;
  /**
   * De dónde salió esa página:
   *
   *   `first_page`                    la ronda 2 pidió la 1 porque su ventana ya era
   *                                   otra (términos efectivos disjuntos).
   *   `hypothesis_variant`            la propia hipótesis eligió la página 2 al no
   *                                   tener variante de términos ni de región.
   *   `effective_request_escalation`  la hipótesis pedía la 1 y ESTA decisión la
   *                                   movió a la 2 al comparar los bodies efectivos.
   */
  pageSource: 'first_page' | 'hypothesis_variant' | 'effective_request_escalation';
  /** True sólo cuando esta decisión movió la petición de la página 1 a la 2. */
  escalatedToPage2: boolean;
  /** Causa del salto, o `null` cuando la ronda 2 ya pedía algo genuinamente nuevo. */
  escalationReason: ApolloRound2PageEscalationReason | null;
  /** Términos efectivos compartidos con la ronda 1. Vacío ⇒ ventanas disjuntas. */
  sharedEffectiveKeywords: string[];
  /** `total_pages` que el proveedor declaró en la ronda 1. */
  providerTotalPages: number | null;
  /**
   * Por qué el salto hacía falta y NO se pudo dar. Pedir una página que el
   * proveedor no declara es pagar por una respuesta vacía, así que la corrida
   * sigue en la página 1 y lo deja dicho en vez de esconderlo.
   */
  escalationBlockedReason:
    | 'provider_total_pages_unknown'
    | 'provider_declared_single_page'
    | null;
};

/** § 1B — proyección sanitizada de la decisión. `null` ⇒ nadie la tomó. */
export function toRound2PageDecisionMetadata(
  decision: ApolloRound2PageDecision | null,
): Record<string, unknown> | null {
  if (decision === null) return null;
  return {
    requested_page: decision.requestedPage,
    page_source: decision.pageSource,
    escalated_to_page_2: decision.escalatedToPage2,
    escalation_reason: decision.escalationReason,
    shared_effective_keywords: decision.sharedEffectiveKeywords,
    shared_effective_keyword_count: decision.sharedEffectiveKeywords.length,
    provider_total_pages: decision.providerTotalPages,
    escalation_blocked_reason: decision.escalationBlockedReason,
  };
}

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
  /**
   * Duplicados contra SellUp / HubSpot / sugerencias previas, SUMADOS.
   *
   * SCALE-AND-SECOND-ROUND-FIX-1 § 5 — se conserva como agregado por
   * compatibilidad con consumidores existentes; el desglose real vive en los tres
   * campos siguientes. El copy de "cero candidatos" NUNCA debe leer este campo
   * sumado para elegir causa: mezclar HubSpot, SellUp y cooldown en un solo
   * número es exactamente la conflación que ese hito corrige.
   */
  knownCompanyDuplicates: number;
  /** § 5 — duplicado confirmado en SellUp. */
  duplicateInSellUp: number;
  /** § 5 — duplicado confirmado en HubSpot. */
  duplicateInHubSpot: number;
  /** § 5 — cooldown real o sugerencia previa. NUNCA un duplicado de catálogo. */
  cooldownOrPriorSuggestion: number;
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
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — cobertura de ESTA ronda.
   *
   * Por ronda y no sólo por corrida: el § 3 exige que las dos rondas representen a
   * todas las subindustrias pedidas, y una cifra agregada no distingue «las dos
   * rondas cubrieron A y B» de «la ronda 1 cubrió A y la ronda 2 cubrió B».
   *
   * `null` cuando la ronda no pudo construir su request efectivo: ausencia de dato
   * no es cobertura completa.
   */
  subindustryCoverage: ApolloRoundSubindustryCoverage | null;
};

/** § 6 — cobertura de una ronda, ya sanitizada (sólo términos de catálogo). */
export type ApolloRoundSubindustryCoverage = {
  requestedSubindustries: string[];
  coveredSubindustries: string[];
  uncoveredSubindustries: string[];
  coverageCount: number;
  coverageRatio: number;
  effectiveKeywordsBySubindustry: Record<string, string[]>;
  complete: boolean;
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
    subindustryCoverage?: ApolloRoundSubindustryCoverage | null;
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
    duplicateInSellUp: 0,
    duplicateInHubSpot: 0,
    cooldownOrPriorSuggestion: 0,
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
    subindustryCoverage: provider.subindustryCoverage ?? null,
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
   * SCALE-AND-SECOND-ROUND-FIX-1 § 4 — desenlace de cada enrichment PAGADO, en
   * tres cubetas mutuamente excluyentes, para no leer "cero candidatos" como una
   * sola causa homogénea:
   *
   *   `sectorConfirmedByEnrichment`            — el enrichment confirmó el sector.
   *   `sectorStillUnconfirmedAfterEnrichment`  — se cobró y el sector sigue sin
   *                                               confirmarse (contradictorio, no
   *                                               mapeado, o sigue faltando
   *                                               evidencia).
   *   `enrichmentFailedCount`                  — la llamada no devolvió evidencia
   *                                               utilizable (sin match del
   *                                               proveedor o cobro sin confirmar).
   *
   * Una industria amplia NUNCA se cuenta como `sectorConfirmedByEnrichment`: el
   * gate sectorial sigue siendo el único que decide "confirmado".
   */
  sectorConfirmedByEnrichment: number;
  sectorStillUnconfirmedAfterEnrichment: number;
  /**
   * QUALITY-PERSISTENCE-HARDENING-1 § 5 — el enrichment trajo evidencia que
   * CONTRADICE el sector o la subindustria buscada.
   *
   * Antes caía en `sectorStillUnconfirmedAfterEnrichment`, que dice «sigue sin
   * confirmarse» y sugiere que otro dato podría confirmarlo. Un rechazo es un
   * desenlace distinto: ya no hay nada que confirmar.
   */
  sectorRejectedAfterEnrichment: number;
  enrichmentFailedCount: number;
  /**
   * § 5 — enrichments cuyo desenlace se pudo CLASIFICAR en una de las cuatro
   * cubetas. Es el denominador honesto de la invariante:
   *
   *   confirmados + ambiguos + rechazados + fallidos === enrichmentsClassified
   *
   * Coincide con `enrichmentsExecuted` cuando toda llamada determinada se cobró.
   * Difiere cuando alguna respondió `no_match`: esa llamada se clasifica (cubeta
   * `enrichmentFailedCount`) pero NO se cobró, y contarla como ejecutada
   * inventaría gasto.
   */
  enrichmentsClassified: number;
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
  /**
   * AGENT1-APOLLO-FINALIZATION-HARDENING-1 § D — la cuenta que decidió cada
   * parada de esta corrida, YA resuelta por los gates finales. Coincide con
   * `totalEligibleCompanies`: es el mismo número, nombrado para que quede claro
   * que es la métrica CONSERVADORA del § A, no un sustituto más laxo.
   */
  stableFinalizableCandidateCount: number;
  /**
   * WRITER-ONLY-ADMISSION-PENDING § 8 — la PROYECCIÓN, con nombre propio.
   *
   * Cuenta a los candidatos que serían finalizables si alguien resolviera las
   * admisiones que sólo el writer resuelve. No es la cifra estable y no puede
   * detener gasto; existe para que la distancia entre las dos sea legible en vez
   * de tener que deducirse.
   */
  projectedFinalizableCandidateCount: number;
  /** § 8 — `projected - stable`. Cuántos están bloqueados SÓLO por writer-only. */
  writerOnlyPendingCount: number;
  /** § 8 — qué admisiones writer-only quedaron sin resolver, por nombre. */
  writerOnlyPendingReasons: string[];
  /**
   * § D — `max(0, target - stableFinalizableCandidateCount)`. Cero significa
   * que el objetivo se alcanzó de verdad; con `enrichmentsExecuted` en cero y
   * este campo en positivo, la corrida se quedó corta y NO fue por falta de
   * intentos de enrichment.
   */
  targetGap: number;
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
  /** § 4 — las cubetas del desenlace de enrichment. Ausentes ⇒ 0. */
  sectorConfirmedByEnrichment?: number;
  sectorStillUnconfirmedAfterEnrichment?: number;
  /** HARDENING-1 § 5 — rechazo confirmado por el enrichment. Ausente ⇒ 0. */
  sectorRejectedAfterEnrichment?: number;
  enrichmentFailedCount?: number;
  /** § D — objetivo de la corrida. Ausente ⇒ el hueco se reporta 0, nunca negativo. */
  targetEligibleCompanies?: number;
  /**
   * STABLE-TARGET-WRITER-PARITY § 3 — cuenta ESTABLE, calculada por el
   * orquestador con el contrato canónico.
   *
   * Hasta este hito no existía como entrada: se aliaseaba a
   * `totalEligibleCompanies`, así que la métrica que se llamaba «estable» era la
   * provisional con otro nombre, y `target_gap` heredaba el mismo error.
   *
   * Ausente ⇒ se cae al total de elegibles, para no romper a los llamadores que
   * todavía no la calculan. Producción siempre la pasa.
   */
  stableFinalizableCandidateCount?: number;
  /**
   * WRITER-ONLY-ADMISSION-PENDING § 8 — la proyección y su motivo.
   *
   * Ausentes ⇒ la proyección cae a la cuenta estable y el pendiente a 0. Ese
   * respaldo es el conservador: afirma «no hay proyección aparte», no «hay más de
   * los que se pueden probar».
   */
  projectedFinalizableCandidateCount?: number;
  writerOnlyPendingCount?: number;
  writerOnlyPendingReasons?: readonly string[];
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
    sectorConfirmedByEnrichment: input.sectorConfirmedByEnrichment ?? 0,
    sectorStillUnconfirmedAfterEnrichment: input.sectorStillUnconfirmedAfterEnrichment ?? 0,
    sectorRejectedAfterEnrichment: input.sectorRejectedAfterEnrichment ?? 0,
    enrichmentFailedCount: input.enrichmentFailedCount ?? 0,
    enrichmentsClassified:
      (input.sectorConfirmedByEnrichment ?? 0) +
      (input.sectorStillUnconfirmedAfterEnrichment ?? 0) +
      (input.sectorRejectedAfterEnrichment ?? 0) +
      (input.enrichmentFailedCount ?? 0),
    effectiveFingerprintsAreDistinct: input.effectiveFingerprintsAreDistinct ?? null,
    // STABLE-TARGET-WRITER-PARITY § 3 — la cuenta estable es la que llega, no un
    // alias de `totalEligibleCompanies`. Son cifras distintas siempre que algún
    // elegible no cumpla el contrato completo (employee_count, LinkedIn,
    // subindustria, duplicidad, calidad), que es el caso normal.
    stableFinalizableCandidateCount:
      input.stableFinalizableCandidateCount ?? input.totalEligibleCompanies,
    // § 8 — la proyección nunca puede quedar por DEBAJO de la estable: son la
    // misma lista y la estable es su subconjunto. Un llamador que pase una cifra
    // menor está informando mal, y el máximo evita publicar un imposible.
    projectedFinalizableCandidateCount: Math.max(
      input.stableFinalizableCandidateCount ?? input.totalEligibleCompanies,
      input.projectedFinalizableCandidateCount ??
        input.stableFinalizableCandidateCount ??
        input.totalEligibleCompanies,
    ),
    writerOnlyPendingCount: input.writerOnlyPendingCount ?? 0,
    writerOnlyPendingReasons: [...(input.writerOnlyPendingReasons ?? [])],
    targetGap: Math.max(
      0,
      (input.targetEligibleCompanies ?? 0) -
        (input.stableFinalizableCandidateCount ?? input.totalEligibleCompanies),
    ),
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
    // § 5 — el desglose real. El copy de "cero candidatos" lee estos tres, nunca
    // el agregado de arriba.
    duplicate_in_sellup: metrics.duplicateInSellUp,
    duplicate_in_hubspot: metrics.duplicateInHubSpot,
    cooldown_or_prior_suggestion: metrics.cooldownOrPriorSuggestion,
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
    // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — cobertura POR RONDA. Los
    // campos van planos, con el prefijo `round_`, para que una consulta pueda
    // preguntar «¿esta ronda representó a las dos subindustrias?» sin desanidar.
    round_requested_subindustries: metrics.subindustryCoverage?.requestedSubindustries ?? null,
    round_covered_subindustries: metrics.subindustryCoverage?.coveredSubindustries ?? null,
    round_uncovered_subindustries: metrics.subindustryCoverage?.uncoveredSubindustries ?? null,
    round_coverage_count: metrics.subindustryCoverage?.coverageCount ?? null,
    round_coverage_ratio: metrics.subindustryCoverage?.coverageRatio ?? null,
    round_coverage_complete: metrics.subindustryCoverage?.complete ?? null,
    effective_keywords_by_subindustry:
      metrics.subindustryCoverage?.effectiveKeywordsBySubindustry ?? null,
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
    // § 4 — las cubetas del desenlace de enrichment, separadas.
    sector_confirmed_by_enrichment: metrics.sectorConfirmedByEnrichment,
    sector_still_unconfirmed_after_enrichment: metrics.sectorStillUnconfirmedAfterEnrichment,
    enrichment_failed_count: metrics.enrichmentFailedCount,
    // HARDENING-1 § 5 — los cuatro desenlaces con los nombres del contrato, y su
    // denominador. Los tres de arriba se conservan para no romper lecturas ya
    // escritas contra ellos.
    sector_confirmed_after_enrichment: metrics.sectorConfirmedByEnrichment,
    sector_still_ambiguous_after_enrichment: metrics.sectorStillUnconfirmedAfterEnrichment,
    sector_rejected_after_enrichment: metrics.sectorRejectedAfterEnrichment,
    enrichment_failed: metrics.enrichmentFailedCount,
    enrichment_outcomes_classified: metrics.enrichmentsClassified,
    // HARDENING-3 § 7 — null cuando la comparación no se pudo hacer. Nunca false.
    effective_fingerprints_are_distinct: metrics.effectiveFingerprintsAreDistinct,
    // AGENT1-APOLLO-FINALIZATION-HARDENING-1 § D — la cuenta conservadora y el
    // hueco contra el objetivo, con nombre propio en vez de derivarse a ojo de
    // `total_eligible_companies` y `target_eligible_companies`.
    stable_finalizable_candidate_count: metrics.stableFinalizableCandidateCount,
    target_gap: metrics.targetGap,
    // WRITER-ONLY-ADMISSION-PENDING § 8 — las cuatro cifras PRE-writer se emiten
    // SEPARADAS y con los nombres del addendum. `stable_finalizable_count` es el
    // mismo número que `stable_finalizable_candidate_count`, publicado también con
    // el nombre corto del contrato para que la pareja projected/stable se lea de un
    // golpe; la quinta cifra —`final_persisted_target_count`— no se emite aquí a
    // propósito: sólo existe DESPUÉS del writer y la escribe la reconciliación.
    projected_finalizable_count: metrics.projectedFinalizableCandidateCount,
    stable_finalizable_count: metrics.stableFinalizableCandidateCount,
    writer_only_pending_count: metrics.writerOnlyPendingCount,
    writer_only_pending_reasons: [...metrics.writerOnlyPendingReasons],
  };
}
