/**
 * apollo-persisted-candidate-truth.ts — Fuente ÚNICA de «cuántos candidatos se
 * persistieron».
 *
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · § 1.
 *
 * El defecto que cierra, medido en la corrida `be181d2d…` / lote `e1622574…`:
 *
 *   run_metrics.persisted_candidates      3
 *   candidate_persistence.persisted_...   2
 *   writer_summary.actual_persisted_count 2
 *   filas en prospect_candidates          2
 *
 * El `3` no venía de contar filas: venía del ranking del orquestador
 * (`ranked.persisted.length`), que se calcula ANTES de que el writer exista. Es
 * una PROYECCIÓN —«estas tres deberían escribirse»—, y la observabilidad la
 * publicaba como un HECHO. Entre la proyección y las filas hay gates que todavía
 * pueden rechazar: en esa corrida, el gate de ownership del writer descartó a una
 * empresa que el orquestador ya había contado.
 *
 * Aquí se fija el vocabulario, y las tres cantidades son distintas por
 * definición:
 *
 *   `eligibleBeforePersistence`  lo que superó TODOS los gates y llegó al writer.
 *   `persistedCandidates`        filas realmente insertadas. Canónico.
 *   `persistenceGap`             la diferencia, con causa explícita.
 *
 * Regla que no se negocia: nunca inferir tres persistidos cuando existen dos
 * filas. La fuente canónica es siempre el resultado del writer
 * (`createdCandidateIds.length`), jamás una proyección previa.
 *
 * Puro: sin I/O, sin reloj. Devuelve objetos nuevos; no muta la metadata que
 * recibe.
 */

// ─── Causas del hueco ─────────────────────────────────────────────────────────

/**
 * Por qué un elegible no llegó a ser fila.
 *
 * `unexplained` existe a propósito y es una señal de alarma, no un relleno: si el
 * hueco no se puede atribuir a un gate concreto, el dato debe decir que nadie
 * sabe por qué, en vez de repartir el hueco entre causas plausibles.
 */
export type PersistenceGapCause =
  | 'ownership_rejected'
  | 'quality_rejected'
  | 'sector_rejected'
  | 'country_rejected'
  | 'duplicate_hubspot'
  | 'duplicate_sellup'
  | 'cooldown_or_prior_suggestion'
  | 'novelty_rejected'
  | 'identity_gate_rejected'
  | 'persistence_failed'
  | 'unexplained';

/** Cifras reales de la escritura, tal como el writer las observó. */
export type ApolloPersistedCandidateTruth = {
  /** Elegibles que el writer recibió. */
  eligibleBeforePersistence: number;
  /** `createdCandidateIds.length`. La única cifra canónica de FILAS. */
  persistedCandidates: number;
  /**
   * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § E — filas persistidas que
   * cumplen el contrato completo de `candidate-completeness-contract.ts`.
   *
   * Es lo ÚNICO que puede compararse con el objetivo. Desde que un candidato
   * ambiguo se persiste como `needs_review` (§ D), `persistedCandidates` incluye
   * filas que existen para que alguien las revise: contarlas hacia el objetivo
   * declararía alcanzada una meta que nadie alcanzó.
   *
   * Fail-closed: `null` significa «el writer no lo midió», y en ese caso el
   * objetivo NO se da por alcanzado. La ausencia nunca se sustituye por las
   * filas totales.
   */
  completeValidCandidates: number | null;
  /** Causas del hueco, contadas. Sólo entradas con recuento > 0. */
  gapCauses: Partial<Record<PersistenceGapCause, number>>;
  /** Objetivo de la corrida. `target_reached` se decide contra él. */
  targetEligibleCompanies: number;
};

/** Etiqueta de la fuente canónica. Viaja al metadata para que sea auditable. */
export const CANONICAL_PERSISTED_SOURCE = 'writer_created_candidate_ids' as const;

// ─── Reconciliación ───────────────────────────────────────────────────────────

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Redondeo a 4 decimales, igual que `observability.ts`. Denominador 0 ⇒ null. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/**
 * Suma de las causas declaradas. Es lo que permite detectar un hueco que nadie
 * explicó, en vez de dar por bueno cualquier desglose.
 */
function sumCauses(causes: Partial<Record<PersistenceGapCause, number>>): number {
  return Object.values(causes).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export type ApolloPersistenceReconciliation = {
  canonical_persisted_source: typeof CANONICAL_PERSISTED_SOURCE;
  eligible_before_persistence: number;
  /**
   * § E — los que pasaron todos los gates PREVIOS al writer. Igual a
   * `eligible_before_persistence` por definición: son la misma lista, nombrada
   * con el vocabulario del contrato.
   */
  projected_persistable_candidates: number;
  persisted_candidates: number;
  /** Filas que cumplen el contrato completo. `null` ⇒ el writer no lo midió. */
  complete_valid_candidates: number | null;
  /** Filas persistidas SÓLO para revisión. `null` ⇒ indeterminado, nunca 0. */
  review_only_candidates: number | null;
  /** Lo único comparable con el objetivo. `null` ⇒ indeterminado. */
  target_count: number | null;
  persistence_gap: number;
  gap_causes: Partial<Record<PersistenceGapCause, number>>;
  /** Parte del hueco que ninguna causa explica. Debe ser 0 en una corrida sana. */
  unexplained_gap: number;
  target_eligible_companies: number;
  /**
   * `complete_valid_candidates >= target`. NUNCA sobre el total de filas: desde
   * el § D hay filas persistidas que existen sólo para revisión.
   */
  target_reached: boolean;
  /** Costo por FILA. Incluye las de revisión: es lo que la corrida escribió. */
  credits_per_persisted_candidate: number | null;
  /** Costo por empresa realmente útil. Es el que mide el rendimiento real. */
  credits_per_complete_valid_candidate: number | null;
  /**
   * Nombre histórico de `credits_per_persisted_candidate`. Se conserva porque
   * `run_metrics` ya lo publicaba y hay auditorías leyéndolo; misma cifra.
   */
  credits_per_persisted_company: number | null;
  total_credits: number;
};

/**
 * Construye el bloque de reconciliación a partir de las cifras del writer.
 *
 * `totalCredits` entra como dato porque el costo por candidato persistido debe
 * recalcularse contra las filas reales: con 25 créditos y 2 filas son 12.5, no
 * los 8.3333 que salían de dividir entre tres persistidos que no existían.
 */
export function buildApolloPersistenceReconciliation(
  truth: ApolloPersistedCandidateTruth,
  totalCredits: number,
): ApolloPersistenceReconciliation {
  const persisted = Math.max(0, Math.trunc(truth.persistedCandidates));
  const eligible = Math.max(persisted, Math.trunc(truth.eligibleBeforePersistence));
  const gap = eligible - persisted;
  const declared = sumCauses(truth.gapCauses);

  // § E — «completo» nunca puede exceder «persistido»: son un subconjunto de la
  // misma lista, y una cifra mayor sólo podría venir de un error de conteo.
  const complete =
    truth.completeValidCandidates === null
      ? null
      : Math.min(persisted, Math.max(0, Math.trunc(truth.completeValidCandidates)));
  const reviewOnly = complete === null ? null : persisted - complete;

  const creditsPerPersisted = ratio(totalCredits, persisted);

  return {
    canonical_persisted_source: CANONICAL_PERSISTED_SOURCE,
    eligible_before_persistence: eligible,
    projected_persistable_candidates: eligible,
    persisted_candidates: persisted,
    complete_valid_candidates: complete,
    review_only_candidates: reviewOnly,
    target_count: complete,
    persistence_gap: gap,
    gap_causes: { ...truth.gapCauses },
    unexplained_gap: Math.max(0, gap - declared),
    target_eligible_companies: truth.targetEligibleCompanies,
    // Fail-closed: sin medición de completitud NO se declara alcanzado el
    // objetivo. Antes bastaba con que hubiera filas, y desde el § D hay filas
    // que sólo existen para revisión.
    target_reached:
      complete !== null &&
      truth.targetEligibleCompanies > 0 &&
      complete >= truth.targetEligibleCompanies,
    credits_per_persisted_candidate: creditsPerPersisted,
    credits_per_complete_valid_candidate: complete === null ? null : ratio(totalCredits, complete),
    credits_per_persisted_company: creditsPerPersisted,
    total_credits: totalCredits,
  };
}

/**
 * Reescribe el bloque `apollo_two_round_discovery` con la verdad del writer.
 *
 * Toca exactamente los campos que afirmaban una cantidad de persistidos:
 * `run_metrics.persisted_candidates`, `run_metrics.credits_per_persisted_company`
 * y `target_reached`. Todo lo demás se conserva byte a byte — las huellas, las
 * rondas, la contabilidad de gasto y la decisión de página no dependen de la
 * escritura y reescribirlas sólo abriría la puerta a perderlas.
 *
 * Devuelve `null` cuando el metadata no es una corrida de dos rondas: un lote de
 * otra modalidad no se toca.
 */
export function reconcileApolloTwoRoundPersistedTruth(
  observability: unknown,
  truth: ApolloPersistedCandidateTruth,
): { observability: Record<string, unknown>; reconciliation: ApolloPersistenceReconciliation } | null {
  if (!isPlainObject(observability)) return null;

  const runMetrics = isPlainObject(observability['run_metrics'])
    ? observability['run_metrics']
    : null;
  if (runMetrics === null) return null;

  const totalCredits =
    (readNumber(runMetrics['total_search_credits']) ?? 0) +
    (readNumber(runMetrics['total_enrichment_credits']) ?? 0);

  const reconciliation = buildApolloPersistenceReconciliation(truth, totalCredits);

  return {
    observability: {
      ...observability,
      run_metrics: {
        ...runMetrics,
        // § 1 — el número que el panel y la auditoría leen pasa a ser el de las
        // filas. La proyección del orquestador se conserva con su propio nombre
        // para poder comparar las dos sin confundirlas.
        persisted_candidates: reconciliation.persisted_candidates,
        // § E — los que superaron los gates PREVIOS al writer. NO es la
        // proyección del ranking del orquestador: esa conserva su propio nombre
        // justo debajo, porque son dos cifras distintas y confundirlas fue el
        // defecto original.
        projected_persistable_candidates: reconciliation.projected_persistable_candidates,
        orchestrator_ranked_persisted_projection:
          readNumber(runMetrics['persisted_candidates']) ?? null,
        complete_valid_candidates: reconciliation.complete_valid_candidates,
        review_only_candidates: reconciliation.review_only_candidates,
        target_count: reconciliation.target_count,
        eligible_before_persistence: reconciliation.eligible_before_persistence,
        persistence_gap: reconciliation.persistence_gap,
        credits_per_persisted_candidate: reconciliation.credits_per_persisted_candidate,
        credits_per_complete_valid_candidate:
          reconciliation.credits_per_complete_valid_candidate,
        credits_per_persisted_company: reconciliation.credits_per_persisted_company,
        canonical_persisted_source: CANONICAL_PERSISTED_SOURCE,
      },
      // § 1 y § E — `target_reached` deja de significar «el orquestador acumuló N
      // elegibles» y pasa a significar «hay N empresas COMPLETAS Y VÁLIDAS en la
      // base». Ni la proyección ni el total de filas deciden esto.
      target_reached: reconciliation.target_reached,
      projected_target_reached: observability['target_reached'] ?? null,
      candidates_persisted_count: reconciliation.persisted_candidates,
      /**
       * AGENT1-APOLLO-FINALIZATION-HARDENING-1 § H — el booleano se REESCRIBE
       * aquí, en la misma pasada que corrige el número.
       *
       * Antes de este hito, `candidates_persisted` llegaba en `false` desde
       * `buildObservabilityMetadata` —calculado ANTES de que el writer corriera,
       * literalmente `input.candidatesPersisted` en ese instante— y esta función
       * sólo tocaba `run_metrics.*`: el `...observability` de más abajo conservaba
       * ese `false` byte a byte incluso en una corrida que escribió filas. La
       * corrida `bdc51c49` lo demostró: `candidates_persisted_count: 3` y
       * `candidates_persisted: false` en el mismo documento.
       *
       * Contrato (§ H): `candidates_persisted = persisted_candidate_ids.length > 0`,
       * y `persisted_candidate_ids.length` es exactamente
       * `reconciliation.persisted_candidates` — la única cifra canónica de filas.
       */
      candidates_persisted: reconciliation.persisted_candidates > 0,
      persistence_reconciliation: reconciliation,
    },
    reconciliation,
  };
}
