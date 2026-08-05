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
  /** `createdCandidateIds.length`. La única cifra canónica. */
  persistedCandidates: number;
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
  persisted_candidates: number;
  persistence_gap: number;
  gap_causes: Partial<Record<PersistenceGapCause, number>>;
  /** Parte del hueco que ninguna causa explica. Debe ser 0 en una corrida sana. */
  unexplained_gap: number;
  target_eligible_companies: number;
  /** `persisted >= target`. Sobre filas reales, nunca sobre la proyección. */
  target_reached: boolean;
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

  return {
    canonical_persisted_source: CANONICAL_PERSISTED_SOURCE,
    eligible_before_persistence: eligible,
    persisted_candidates: persisted,
    persistence_gap: gap,
    gap_causes: { ...truth.gapCauses },
    unexplained_gap: Math.max(0, gap - declared),
    target_eligible_companies: truth.targetEligibleCompanies,
    target_reached: truth.targetEligibleCompanies > 0 && persisted >= truth.targetEligibleCompanies,
    credits_per_persisted_company: ratio(totalCredits, persisted),
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
        projected_persistable_candidates:
          readNumber(runMetrics['persisted_candidates']) ?? null,
        eligible_before_persistence: reconciliation.eligible_before_persistence,
        persistence_gap: reconciliation.persistence_gap,
        credits_per_persisted_company: reconciliation.credits_per_persisted_company,
        canonical_persisted_source: CANONICAL_PERSISTED_SOURCE,
      },
      // § 1 — `target_reached` deja de significar «el orquestador acumuló N
      // elegibles» y pasa a significar «hay N candidatos válidos en la base».
      target_reached: reconciliation.target_reached,
      projected_target_reached: observability['target_reached'] ?? null,
      candidates_persisted_count: reconciliation.persisted_candidates,
      persistence_reconciliation: reconciliation,
    },
    reconciliation,
  };
}
