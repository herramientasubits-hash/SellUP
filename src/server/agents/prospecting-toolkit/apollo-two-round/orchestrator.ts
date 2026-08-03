/**
 * orchestrator.ts — Ejecución adaptativa de dos rondas con objetivo de cinco
 * empresas únicas y elegibles.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 4, § 7, § 8, § 9.
 *
 * Orden por ronda, y ninguna operación pagada ocurre antes de terminarlo:
 *
 *   normalización
 *   → dedup dentro de la respuesta
 *   → dedup contra rondas anteriores
 *   → dominio válido
 *   → compatibilidad geográfica
 *   → plataforma externa
 *   → identidad y ownership preliminar
 *   → duplicado en SellUp
 *   → duplicado en HubSpot
 *   → cooldown e historial de sugerencias
 *   → sector mapeado
 *   → evidencia sectorial contradictoria
 *   → ranking para enrichment
 *
 * Parada: en cuanto se acumulan `targetEligibleCompanies` únicas y elegibles, la
 * corrida se detiene. Una segunda ronda presupuestada NO se ejecuta sólo por
 * estar presupuestada.
 *
 * Puro y por inyección de dependencias: el proveedor, los gates y el enrichment
 * entran como funciones. Ninguna línea de este archivo llama a Apollo, lee env,
 * toca Supabase ni mira el reloj — por eso la suite completa corre sin una sola
 * llamada real ni un crédito gastado.
 */

import type { ApolloTwoRoundDiscoveryConfig } from './config';
import {
  createSeenOrganizationRegistry,
  evaluateSeenOrganization,
  registerSeenOrganization,
  countSeenOrganizations,
  type NormalizedOrganizationIdentity,
  type OrganizationIdentityInput,
  type SeenOrganizationRegistry,
} from './seen-registry';
import {
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  type ApolloTwoRoundQueryContext,
  type ApolloTwoRoundQueryHypothesis,
} from './query-hypothesis';
import {
  selectCandidatesForEnrichment,
  rankFinalEligibleCompanies,
  type CandidateSectorEvidenceState,
  type EnrichmentSelection,
  type EnrichmentSkip,
  type FinalRankingSignals,
  type FreeCandidateSignals,
} from './enrichment-ranking';
import {
  buildEmptyRoundMetrics,
  buildRunMetrics,
  type ApolloTwoRoundRoundMetrics,
  type ApolloTwoRoundRunMetrics,
  type EnrichmentOutcome,
} from './observability';
import {
  buildApolloTwoRoundOperationKey,
  ApolloTwoRoundOperationLedger,
  type ApolloTwoRoundRunCorrelation,
} from './idempotency';

// ─── Entrada del proveedor ────────────────────────────────────────────────────

/**
 * Organización cruda tal como llega de la búsqueda, reducida a lo que el
 * orquestador necesita. El adaptador de producción la construye desde la
 * respuesta normalizada de Apollo.
 */
export type RawDiscoveredOrganization = OrganizationIdentityInput & {
  /** Posición en la respuesta del proveedor (1-indexed). Desempate estable. */
  providerRank: number;
  /** Industria que el proveedor DECLARA. Puede faltar. */
  declaredIndustry?: string | null;
};

export type RoundSearchOutcome = {
  organizations: readonly RawDiscoveredOrganization[];
  /** Llamadas emitidas al proveedor. Normalmente 1 por ronda. */
  providerRequestCount: number;
  /** Créditos que NUESTRO ledger registró para esta búsqueda. */
  internalRecordedCredits: number;
};

// ─── Evaluación barata ────────────────────────────────────────────────────────

/**
 * Motivo por el que un candidato se descartó ANTES de cualquier gasto.
 * Todos valen cero llamadas y cero créditos.
 */
export type CheapRejectionReason =
  | 'duplicate_within_response'
  | 'seen_in_previous_round'
  | 'invalid_domain'
  | 'country_incompatible'
  | 'external_platform_domain'
  | 'ownership_mismatch'
  | 'duplicate_in_sellup'
  | 'duplicate_in_hubspot'
  | 'cooldown_or_prior_suggestion'
  | 'sector_not_mapped'
  | 'sector_evidence_contradictory'
  | 'raw_result_cap_reached';

/**
 * Veredicto de los gates baratos sobre un candidato. Lo produce una dependencia
 * inyectada: los gates reales viven en `apollo-enrichment-eligibility-gate` y
 * `apollo-sector-relevance-gate`, y el orquestador no los reimplementa.
 */
export type CheapAssessment = {
  /** null cuando el candidato superó todos los gates baratos. */
  rejection: CheapRejectionReason | null;
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** Señales gratuitas para el ranking. Sin claves: las pone el orquestador. */
  signals: Omit<
    FreeCandidateSignals,
    'candidateKey' | 'roundNumber' | 'providerRank' | 'sectorEvidenceState'
  >;
  /** El candidato no había sido sugerido antes en el mismo contexto. */
  noPriorSuggestion: boolean;
};

/** Resultado de un enrichment ya ejecutado, re-evaluado por los mismos gates. */
export type EnrichmentResult = {
  executed: boolean;
  /** Veredicto sectorial DESPUÉS del enrichment. */
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** Créditos que nuestro ledger registró por esta llamada. */
  internalRecordedCredits: number;
  /** Un rechazo que sólo se pudo ver con el perfil enriquecido. */
  postEnrichmentRejection?: CheapRejectionReason | null;
};

// ─── Dependencias ─────────────────────────────────────────────────────────────

export type ApolloTwoRoundDeps = {
  /** Ejecuta UNA búsqueda de una ronda. Nunca se llama dos veces por ronda. */
  searchRound: (input: {
    roundNumber: number;
    hypothesis: ApolloTwoRoundQueryHypothesis;
    requestedResultLimit: number;
    operationKey: string;
  }) => Promise<RoundSearchOutcome>;

  /** Aplica los gates baratos. No puede llamar al proveedor ni gastar créditos. */
  assessCandidate: (input: {
    organization: RawDiscoveredOrganization;
    identity: NormalizedOrganizationIdentity;
    roundNumber: number;
  }) => Promise<CheapAssessment> | CheapAssessment;

  /** Ejecuta UN Organization Enrichment. Sólo se llama bajo el cap global. */
  enrichCandidate: (input: {
    candidateKey: string;
    roundNumber: number;
    operationKey: string;
    identity: NormalizedOrganizationIdentity;
  }) => Promise<EnrichmentResult>;
};

// ─── Salida ───────────────────────────────────────────────────────────────────

export type ApolloTwoRoundResultStatus =
  | 'target_reached'
  | 'partial_target_not_reached';

/** Por qué no se ejecutó la segunda ronda. Null cuando sí se ejecutó. */
export type SecondRoundSkippedReason =
  | 'target_reached'
  | 'max_rounds_is_one'
  | 'raw_result_cap_reached'
  | 'round2_hypothesis_identical_to_round1';

export type AccumulatedCompany = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  identity: NormalizedOrganizationIdentity;
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** True cuando llegó a elegible sólo después de un enrichment pagado. */
  becameEligibleAfterEnrichment: boolean;
};

export type ApolloTwoRoundRunResult = {
  resultStatus: ApolloTwoRoundResultStatus;
  targetEligibleCompanies: number;
  eligibleCompaniesFound: number;
  persistedCandidates: number;
  roundsExecuted: number;
  targetReached: boolean;
  /** Código estático cuando el objetivo no se alcanzó. Null cuando sí. */
  partialResultReason: 'partial_target_not_reached' | null;
  secondRoundSkippedReason: SecondRoundSkippedReason | null;

  /** Empresas que se persisten, en orden de calidad. */
  persisted: AccumulatedCompany[];
  /** Elegibles que el tope dejó fuera. Sus métricas NO se pierden (§ 9). */
  notPersisted: Array<AccumulatedCompany & { reason: 'eligible_not_persisted_due_to_target_cap' }>;

  rounds: ApolloTwoRoundRoundMetrics[];
  runMetrics: ApolloTwoRoundRunMetrics;

  enrichmentSelections: EnrichmentSelection[];
  enrichmentSkips: EnrichmentSkip[];
  /** Claves de operación completadas. Un reintento las reconoce y no repite. */
  completedOperationKeys: string[];
  /**
   * TODOS los candidatos evaluados —elegibles y rechazados— con su motivo. Es lo
   * que un reintento necesita para no volver a partir de cero (§ 7).
   */
  evaluatedCandidates: ResumedCandidate[];
  /** Motivos de rechazo observados. Alimentan la adaptación de la ronda 2. */
  observedRejectionReasons: CheapRejectionReason[];
};

export type ApolloTwoRoundRunInput = {
  config: ApolloTwoRoundDiscoveryConfig;
  queryContext: ApolloTwoRoundQueryContext;
  correlation: ApolloTwoRoundRunCorrelation;
  /**
   * Claves de operación que un intento anterior ya completó. Permite que un
   * reintento con el mismo `idempotencyKey` salte lo ya hecho en vez de
   * repetirlo (§ 12).
   */
  completedOperationKeys?: readonly string[];
  /**
   * Estado recuperado de un intento anterior (§ 7).
   *
   * Sin él, un reintento que salta la búsqueda de la ronda 1 por clave de
   * operación trataría esa ronda como si hubiera devuelto CERO candidatos, y la
   * corrida terminaría vacía a pesar de haber pagado. Con él, el reintento
   * recupera lo que la ronda ya produjo y sólo ejecuta lo que falta.
   */
  resume?: ApolloTwoRoundResumeState | null;
};

/**
 * Estado de una corrida interrumpida, suficiente para continuarla sin repetir
 * ninguna operación pagada.
 *
 * Lo produce `toApolloTwoRoundResumeState` a partir de un resultado parcial y lo
 * persiste el adaptador de producción; este módulo sólo lo consume.
 */
export type ApolloTwoRoundResumeState = {
  /** Identidades ya vistas: la ronda 2 no puede volver a procesarlas. */
  seenIdentities: readonly NormalizedOrganizationIdentity[];
  /** Candidatos ya evaluados, con su veredicto y su motivo de rechazo. */
  candidates: readonly ResumedCandidate[];
  /** Métricas de las rondas ya completadas. */
  rounds: readonly ApolloTwoRoundRoundMetrics[];
  totalRawResults: number;
  totalSearchCredits: number;
  totalEnrichmentCredits: number;
  /** Enrichments ya PAGADOS. Descuentan del cap global de la corrida. */
  enrichmentsExecuted: number;
  observedRejectionReasons: readonly CheapRejectionReason[];
  secondRoundSkippedReason?: SecondRoundSkippedReason | null;
};

/** Candidato recuperado de un intento anterior, con su estado completo. */
export type ResumedCandidate = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  identity: NormalizedOrganizationIdentity;
  assessment: CheapAssessment;
  sectorEvidenceState: CandidateSectorEvidenceState;
  eligible: boolean;
  becameEligibleAfterEnrichment: boolean;
  enrichmentExecuted: boolean;
  finallyRejectedOrDuplicated: boolean;
};

/**
 * Proyecta un resultado (parcial o completo) al estado que un reintento
 * necesita. Deliberadamente NO incluye nada derivable: las métricas de corrida y
 * el ranking final se recalculan, porque recalcularlos es gratis y guardarlos
 * abre la puerta a que el estado y el resultado discrepen.
 */
export function toApolloTwoRoundResumeState(
  result: ApolloTwoRoundRunResult,
): ApolloTwoRoundResumeState {
  return {
    seenIdentities: result.evaluatedCandidates.map((c) => c.identity),
    candidates: result.evaluatedCandidates,
    rounds: result.rounds,
    totalRawResults: result.runMetrics.totalRawResults,
    totalSearchCredits: result.runMetrics.totalSearchCredits,
    totalEnrichmentCredits: result.runMetrics.totalEnrichmentCredits,
    enrichmentsExecuted: result.runMetrics.enrichmentsExecuted,
    observedRejectionReasons: result.observedRejectionReasons,
    secondRoundSkippedReason: result.secondRoundSkippedReason,
  };
}

// ─── Estado interno de un candidato ───────────────────────────────────────────

type TrackedCandidate = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  identity: NormalizedOrganizationIdentity;
  assessment: CheapAssessment;
  sectorEvidenceState: CandidateSectorEvidenceState;
  eligible: boolean;
  becameEligibleAfterEnrichment: boolean;
  enrichmentExecuted: boolean;
  finallyRejectedOrDuplicated: boolean;
};

/**
 * Clave de un candidato dentro de la corrida.
 *
 * Prefiere el id del proveedor; cae al dominio y luego al nombre canónico. Sin
 * ninguno de los tres, la posición sirve de último recurso — un candidato sin
 * identidad no puede deduplicarse, pero tampoco puede colisionar con otro.
 */
function buildCandidateKey(
  identity: NormalizedOrganizationIdentity,
  roundNumber: number,
  providerRank: number,
): string {
  if (identity.providerOrganizationId) return `apollo:${identity.providerOrganizationId}`;
  if (identity.normalizedDomain) return `domain:${identity.normalizedDomain}`;
  if (identity.canonicalName) return `name:${identity.canonicalName}`;
  return `unidentified:r${roundNumber}:${providerRank}`;
}

/**
 * Una empresa cuenta para el objetivo cuando superó todos los gates baratos y su
 * pertenencia al sector está CONFIRMADA.
 *
 * `sector_evidence_missing_needs_enrichment` no cuenta: aceptar sin evidencia
 * sería exactamente la degradación de calidad que el hito prohíbe. Ese estado es
 * el que puede competir por un enrichment, y sólo si el enrichment lo confirma
 * pasa a elegible.
 */
function isEligible(
  rejection: CheapRejectionReason | null,
  sectorEvidenceState: CandidateSectorEvidenceState,
): boolean {
  return rejection === null && sectorEvidenceState === 'sector_evidence_confirmed';
}

function tallyRejection(
  metrics: ApolloTwoRoundRoundMetrics,
  reason: CheapRejectionReason,
): void {
  switch (reason) {
    case 'duplicate_within_response':
    case 'seen_in_previous_round':
      metrics.seenDuplicates++;
      break;
    case 'duplicate_in_sellup':
    case 'duplicate_in_hubspot':
    case 'cooldown_or_prior_suggestion':
      metrics.knownCompanyDuplicates++;
      break;
    case 'country_incompatible':
      metrics.countryRejected++;
      break;
    case 'sector_not_mapped':
    case 'sector_evidence_contradictory':
      metrics.sectorRejected++;
      break;
    case 'invalid_domain':
    case 'external_platform_domain':
    case 'ownership_mismatch':
      metrics.ownershipRejected++;
      break;
    case 'raw_result_cap_reached':
      // Un tope alcanzado no es un rechazo de calidad del candidato: no se
      // contabiliza como duplicado ni como falso positivo, porque inflaría
      // ambas tasas con un límite nuestro.
      break;
  }
}

// ─── Orquestador ──────────────────────────────────────────────────────────────

/**
 * Ejecuta la corrida completa: ronda 1, parada o adaptación, ronda 2, ranking
 * final y estado del resultado.
 *
 * Nunca ejecuta una tercera ronda, aunque el objetivo no se alcance.
 */
export async function runApolloTwoRoundDiscovery(
  input: ApolloTwoRoundRunInput,
  deps: ApolloTwoRoundDeps,
): Promise<ApolloTwoRoundRunResult> {
  const { config, queryContext, correlation } = input;
  const ledger = ApolloTwoRoundOperationLedger.fromCompletedKeys(
    input.completedOperationKeys ?? [],
  );
  const resume = input.resume ?? null;

  // § 7 — el estado recuperado siembra la corrida. Sin esto, un reintento que
  // salta una ronda ya buscada la trataría como si hubiera devuelto cero.
  let seenRegistry: SeenOrganizationRegistry = createSeenOrganizationRegistry();
  for (const identity of resume?.seenIdentities ?? []) {
    seenRegistry = registerSeenOrganization(seenRegistry, identity);
  }
  const tracked: TrackedCandidate[] = (resume?.candidates ?? []).map((c) => ({ ...c }));
  const roundMetrics: ApolloTwoRoundRoundMetrics[] = (resume?.rounds ?? []).map((r) => ({ ...r }));
  const enrichmentSelections: EnrichmentSelection[] = [];
  const enrichmentSkips: EnrichmentSkip[] = [];
  const observedRejectionReasons = new Set<CheapRejectionReason>(
    resume?.observedRejectionReasons ?? [],
  );

  let totalRawResults = resume?.totalRawResults ?? 0;
  let totalSearchCredits = resume?.totalSearchCredits ?? 0;
  let totalEnrichmentCredits = resume?.totalEnrichmentCredits ?? 0;
  let remainingEnrichmentBudget = Math.max(
    0,
    config.maxEnrichmentsPerRun - (resume?.enrichmentsExecuted ?? 0),
  );
  let secondRoundSkippedReason: SecondRoundSkippedReason | null =
    resume?.secondRoundSkippedReason ?? null;

  const eligibleCount = (): number => tracked.filter((c) => c.eligible).length;

  // ── Bucle de rondas ─────────────────────────────────────────────────────────
  for (let roundNumber = 1; roundNumber <= config.maxRounds; roundNumber++) {
    // § 7: una ronda cuyo estado ya se recuperó no se vuelve a ejecutar NI se
    // vuelve a registrar. Sus métricas y sus candidatos ya están en el estado.
    if (roundMetrics.some((m) => m.roundNumber === roundNumber)) continue;

    // § 7: parada inmediata. La ronda 2 no se ejecuta por estar presupuestada.
    if (roundNumber > 1 && eligibleCount() >= config.targetEligibleCompanies) {
      secondRoundSkippedReason = 'target_reached';
      break;
    }
    if (roundNumber > 1 && totalRawResults >= config.maxRawResultsPerRun) {
      secondRoundSkippedReason = 'raw_result_cap_reached';
      break;
    }

    // § 8: la ronda 2 pide el límite configurado aunque falten menos de cinco.
    // Es el procesamiento local el que detiene la acumulación al llegar al
    // objetivo; recortar la petición no ahorra créditos (Apollo cobra por
    // resultado devuelto) y sí reduce las probabilidades de completar.
    const requestedResultLimit = config.maxResultsPerRound;

    let hypothesis: ApolloTwoRoundQueryHypothesis;
    if (roundNumber === 1) {
      hypothesis = buildRound1Hypothesis(queryContext, requestedResultLimit);
    } else {
      const round2 = buildRound2Hypothesis(
        queryContext,
        {
          remainingTarget: Math.max(0, config.targetEligibleCompanies - eligibleCount()),
          excludedSeenOrganizationCount: countSeenOrganizations(seenRegistry),
          observedRejectionReasons: [...observedRejectionReasons],
        },
        requestedResultLimit,
      );
      // Repetir exactamente la consulta de la ronda 1 no puede traer nada nuevo
      // y sí volvería a cobrar. Se omite la ronda en vez de pagarla.
      if (!round2.differsFromRound1) {
        secondRoundSkippedReason = 'round2_hypothesis_identical_to_round1';
        break;
      }
      hypothesis = round2;
    }

    const searchOperationKey = buildApolloTwoRoundOperationKey({
      correlation,
      roundNumber,
      operation: 'organizations_search',
      subject: JSON.stringify(hypothesis.queryParameters),
    });

    const metrics = buildEmptyRoundMetrics(
      roundNumber,
      hypothesis.queryHypothesis,
      hypothesis.queryAdaptationReason,
    );

    // § 12: una ronda ya completada por un intento anterior no se vuelve a
    // buscar. Se registra la ronda con cero peticiones para que el reintento sea
    // legible, no invisible. Con estado recuperado este caso ya no se alcanza —
    // la ronda se saltó arriba con sus métricas reales—, y queda como segundo
    // candado para un reintento que traiga claves pero no estado.
    if (!ledger.canExecute(searchOperationKey)) {
      roundMetrics.push(metrics);
      continue;
    }

    const outcome = await deps.searchRound({
      roundNumber,
      hypothesis,
      requestedResultLimit,
      operationKey: searchOperationKey,
    });
    ledger.markCompleted(searchOperationKey);

    metrics.providerRequestCount = outcome.providerRequestCount;
    metrics.rawResultsReturned = outcome.organizations.length;
    metrics.internalRecordedCredits = outcome.internalRecordedCredits;
    totalSearchCredits += outcome.internalRecordedCredits;

    // ── Procesamiento barato, en el orden del § 4 ────────────────────────────
    const roundCandidates: TrackedCandidate[] = [];
    const identitiesInThisResponse = createSeenOrganizationRegistry();
    let localIdentities = identitiesInThisResponse;

    for (const organization of outcome.organizations) {
      // Tope de resultados crudos de la corrida. Se cuenta lo que efectivamente
      // se procesa, no lo que el proveedor devolvió de más.
      if (totalRawResults >= config.maxRawResultsPerRun) {
        tallyRejection(metrics, 'raw_result_cap_reached');
        continue;
      }
      totalRawResults++;

      // 1. Dedup dentro de la respuesta.
      const withinResponse = evaluateSeenOrganization(localIdentities, organization);
      if (withinResponse.seen) {
        metrics.normalizedResults++;
        tallyRejection(metrics, 'duplicate_within_response');
        observedRejectionReasons.add('duplicate_within_response');
        continue;
      }
      localIdentities = registerSeenOrganization(localIdentities, withinResponse.identity);

      // 2. Dedup contra rondas anteriores. La ronda 2 no puede procesar ni
      //    facturar de nuevo una organización que la ronda 1 ya vio.
      const acrossRounds = evaluateSeenOrganization(seenRegistry, organization);
      if (acrossRounds.seen) {
        metrics.normalizedResults++;
        tallyRejection(metrics, 'seen_in_previous_round');
        observedRejectionReasons.add('seen_in_previous_round');
        continue;
      }

      const identity = acrossRounds.identity;
      metrics.normalizedResults++;

      // 3-11. Resto de gates baratos, inyectados.
      const assessment = await deps.assessCandidate({ organization, identity, roundNumber });

      seenRegistry = registerSeenOrganization(seenRegistry, identity);

      const candidateKey = buildCandidateKey(identity, roundNumber, organization.providerRank);
      const eligible = isEligible(assessment.rejection, assessment.sectorEvidenceState);

      if (assessment.rejection !== null) {
        tallyRejection(metrics, assessment.rejection);
        observedRejectionReasons.add(assessment.rejection);
      }

      const candidate: TrackedCandidate = {
        candidateKey,
        roundNumber,
        providerRank: organization.providerRank,
        identity,
        assessment,
        sectorEvidenceState: assessment.sectorEvidenceState,
        eligible,
        becameEligibleAfterEnrichment: false,
        enrichmentExecuted: false,
        finallyRejectedOrDuplicated: assessment.rejection !== null,
      };
      roundCandidates.push(candidate);
      tracked.push(candidate);
    }

    metrics.eligibleBeforeEnrichment = roundCandidates.filter((c) => c.eligible).length;
    // La fase de enrichment corre DESPUÉS de todas las rondas (§ 6), así que en
    // este punto lo elegible tras enrichment coincide con lo elegible barato. La
    // fase global lo actualiza cuando un enrichment cambia un veredicto.
    metrics.eligibleAfterEnrichment = metrics.eligibleBeforeEnrichment;
    metrics.newEligibleCompaniesAdded = metrics.eligibleBeforeEnrichment;
    roundMetrics.push(metrics);

    // § 7: alcanzado el objetivo con gates baratos, la corrida no busca más.
    if (eligibleCount() >= config.targetEligibleCompanies) {
      if (roundNumber < config.maxRounds) secondRoundSkippedReason = 'target_reached';
      break;
    }
  }

  if (config.maxRounds === 1 && secondRoundSkippedReason === null) {
    secondRoundSkippedReason = 'max_rounds_is_one';
  }

  // ── Fase global de enrichment (§ 6, opción recomendada) ─────────────────────
  //
  // Las señales GRATUITAS de ambas rondas se procesan primero; sólo entonces se
  // decide a quién se le compra evidencia. Enriquecer al final de la ronda 1
  // gastaba el presupuesto sin conocer todavía a los candidatos de la ronda 2,
  // así que un candidato débil de la primera ronda podía consumir los dos
  // créditos que un candidato fuerte de la segunda merecía más. Aquí compiten
  // todos contra todos, una sola vez.
  //
  // La ronda 2 se decide con gates baratos (`eligibleCount()`), no con
  // enrichment: es exactamente lo que el contrato permite y lo que evita pagar
  // por confirmar antes de saber si hacía falta buscar más.
  const roundMetricsByNumber = new Map(roundMetrics.map((m) => [m.roundNumber, m]));

  const globalFreeSignals: FreeCandidateSignals[] = tracked
    .filter((c) => c.assessment.rejection === null && !c.enrichmentExecuted)
    .map((c) => ({
      ...c.assessment.signals,
      candidateKey: c.candidateKey,
      roundNumber: c.roundNumber,
      providerRank: c.providerRank,
      sectorEvidenceState: c.sectorEvidenceState,
    }));

  const globalSelection = selectCandidatesForEnrichment({
    candidates: globalFreeSignals,
    remainingEnrichmentBudget,
    eligibleCompaniesSoFar: eligibleCount(),
    targetEligibleCompanies: config.targetEligibleCompanies,
  });
  enrichmentSkips.push(...globalSelection.skipped);
  for (const entry of [...globalSelection.selected, ...globalSelection.skipped]) {
    const metricsForRound = roundMetricsByNumber.get(entry.roundNumber);
    if (metricsForRound) metricsForRound.enrichmentCandidates++;
  }

  for (const chosen of globalSelection.selected) {
    // Parada dentro del propio bucle: si una llamada previa ya completó el
    // objetivo, las restantes no se ejecutan (§ 6).
    if (eligibleCount() >= config.targetEligibleCompanies) {
      enrichmentSkips.push({
        candidateKey: chosen.candidateKey,
        roundNumber: chosen.roundNumber,
        skippedReason: 'target_already_reached',
      });
      continue;
    }

    const candidate = tracked.find((c) => c.candidateKey === chosen.candidateKey);
    if (!candidate) continue;
    const metricsForRound = roundMetricsByNumber.get(candidate.roundNumber) ?? null;

    const enrichmentOperationKey = buildApolloTwoRoundOperationKey({
      correlation,
      roundNumber: candidate.roundNumber,
      operation: 'organization_enrichment',
      subject: candidate.identity.normalizedDomain ?? candidate.candidateKey,
    });
    // § 12: un enrichment ya ejecutado por un intento anterior no se repite.
    if (!ledger.canExecute(enrichmentOperationKey)) {
      enrichmentSkips.push({
        candidateKey: chosen.candidateKey,
        roundNumber: chosen.roundNumber,
        skippedReason: 'known_duplicate',
      });
      continue;
    }

    const result = await deps.enrichCandidate({
      candidateKey: candidate.candidateKey,
      roundNumber: candidate.roundNumber,
      operationKey: enrichmentOperationKey,
      identity: candidate.identity,
    });
    ledger.markCompleted(enrichmentOperationKey);

    enrichmentSelections.push(chosen);
    remainingEnrichmentBudget = Math.max(0, remainingEnrichmentBudget - 1);

    if (result.executed) {
      candidate.enrichmentExecuted = true;
      totalEnrichmentCredits += result.internalRecordedCredits;
      if (metricsForRound) {
        metricsForRound.enrichmentsExecuted++;
        metricsForRound.internalRecordedCredits += result.internalRecordedCredits;
      }
    }

    candidate.sectorEvidenceState = result.sectorEvidenceState;
    const postRejection = result.postEnrichmentRejection ?? null;
    if (postRejection !== null) {
      if (metricsForRound) tallyRejection(metricsForRound, postRejection);
      observedRejectionReasons.add(postRejection);
      candidate.finallyRejectedOrDuplicated = true;
      candidate.eligible = false;
      continue;
    }
    const nowEligible = isEligible(candidate.assessment.rejection, result.sectorEvidenceState);
    if (nowEligible && !candidate.eligible) {
      candidate.eligible = true;
      candidate.becameEligibleAfterEnrichment = true;
    }
    if (!nowEligible) {
      // El enrichment se pagó y la empresa sigue sin confirmarse: eso es
      // exactamente `enrichmentWaste`, y así queda contado.
      candidate.finallyRejectedOrDuplicated = true;
    }
  }

  // Las métricas por ronda se recalculan tras la fase global: un enrichment pudo
  // volver elegible a un candidato de cualquiera de las dos rondas.
  for (const metricsForRound of roundMetrics) {
    const ofRound = tracked.filter((c) => c.roundNumber === metricsForRound.roundNumber);
    metricsForRound.eligibleAfterEnrichment = ofRound.filter((c) => c.eligible).length;
    metricsForRound.newEligibleCompaniesAdded = metricsForRound.eligibleAfterEnrichment;
  }

  // ── Acumulación y ranking final (§ 9) ───────────────────────────────────────
  const eligibleCompanies = tracked.filter((c) => c.eligible);
  const finalSignals: FinalRankingSignals[] = eligibleCompanies.map((c) => ({
    ...c.assessment.signals,
    candidateKey: c.candidateKey,
    roundNumber: c.roundNumber,
    providerRank: c.providerRank,
    sectorEvidenceState: c.sectorEvidenceState,
    noPriorSuggestion: c.assessment.noPriorSuggestion,
  }));

  const ranked = rankFinalEligibleCompanies(finalSignals, config.targetEligibleCompanies);
  const byKey = new Map(eligibleCompanies.map((c) => [c.candidateKey, c]));

  const toAccumulated = (candidateKey: string): AccumulatedCompany | null => {
    const candidate = byKey.get(candidateKey);
    if (!candidate) return null;
    return {
      candidateKey: candidate.candidateKey,
      roundNumber: candidate.roundNumber,
      providerRank: candidate.providerRank,
      identity: candidate.identity,
      sectorEvidenceState: candidate.sectorEvidenceState,
      becameEligibleAfterEnrichment: candidate.becameEligibleAfterEnrichment,
    };
  };

  const persisted = ranked.persisted
    .map((entry) => toAccumulated(entry.candidateKey))
    .filter((entry): entry is AccumulatedCompany => entry !== null);
  const notPersisted = ranked.notPersisted
    .map((entry) => {
      const accumulated = toAccumulated(entry.candidateKey);
      return accumulated === null
        ? null
        : { ...accumulated, reason: 'eligible_not_persisted_due_to_target_cap' as const };
    })
    .filter(
      (entry): entry is AccumulatedCompany & {
        reason: 'eligible_not_persisted_due_to_target_cap';
      } => entry !== null,
    );

  const eligibleCompaniesFound = eligibleCompanies.length;
  const targetReached = eligibleCompaniesFound >= config.targetEligibleCompanies;

  const enrichmentOutcomes: EnrichmentOutcome[] = tracked.map((c) => ({
    candidateKey: c.candidateKey,
    enrichmentExecuted: c.enrichmentExecuted,
    finallyRejectedOrDuplicated: c.finallyRejectedOrDuplicated,
  }));

  return {
    resultStatus: targetReached ? 'target_reached' : 'partial_target_not_reached',
    targetEligibleCompanies: config.targetEligibleCompanies,
    eligibleCompaniesFound,
    persistedCandidates: persisted.length,
    roundsExecuted: roundMetrics.length,
    targetReached,
    partialResultReason: targetReached ? null : 'partial_target_not_reached',
    secondRoundSkippedReason,
    persisted,
    notPersisted,
    rounds: roundMetrics,
    runMetrics: buildRunMetrics({
      rounds: roundMetrics,
      totalUniqueOrganizations: tracked.length,
      totalEligibleCompanies: eligibleCompaniesFound,
      persistedCandidates: persisted.length,
      totalSearchCredits,
      totalEnrichmentCredits,
      enrichmentOutcomes,
    }),
    enrichmentSelections,
    enrichmentSkips,
    // Se devuelven para que un reintento con el mismo `idempotencyKey` reconozca
    // lo ya ejecutado y no lo repita (§ 12).
    completedOperationKeys: ledger.completedKeys,
    evaluatedCandidates: tracked.map((c) => ({
      candidateKey: c.candidateKey,
      roundNumber: c.roundNumber,
      providerRank: c.providerRank,
      identity: c.identity,
      assessment: c.assessment,
      sectorEvidenceState: c.sectorEvidenceState,
      eligible: c.eligible,
      becameEligibleAfterEnrichment: c.becameEligibleAfterEnrichment,
      enrichmentExecuted: c.enrichmentExecuted,
      finallyRejectedOrDuplicated: c.finallyRejectedOrDuplicated,
    })),
    observedRejectionReasons: [...observedRejectionReasons],
  };
}
