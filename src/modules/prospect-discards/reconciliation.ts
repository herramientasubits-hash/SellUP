// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — reconciliation between the pipeline's
// own aggregate breakdown (`candidate_final_dispositions.breakdown`, computed
// by `toCandidateFinalDispositionsMetadata`, batch-level, pure, no names) and
// the actual per-company rows this hito now persists.
//
// The breakdown was never wrong — it was always aggregate-only. This module
// answers a different, new question: "of the rejections the breakdown
// counted, how many actually got a durable, reviewable row?" That is the
// accounting issue #389 asks for — not a relabeling of "Sin clasificar".
//
// Pure: no IO, no clock. The caller supplies both counts already read.

import { mapApolloFinalDispositionToCode } from './mapping';

/**
 * Sums the subset of `breakdown` entries that this module persists a row
 * for (i.e. every key `mapApolloFinalDispositionToCode` maps to a code).
 * Entries with no mapping (`provisionally_persisted_pending_writer_final`,
 * `persisted_review_only_final`) are NOT rejections and are correctly
 * excluded — they either got a candidate row already or are pending review.
 */
export function sumExpectedDiscardedDispositions(
  breakdown: Record<string, number> | null | undefined,
): number {
  if (!breakdown) return 0;
  let total = 0;
  for (const [key, count] of Object.entries(breakdown)) {
    if (mapApolloFinalDispositionToCode(key) !== null) {
      total += typeof count === 'number' && Number.isFinite(count) ? count : 0;
    }
  }
  return total;
}

export interface DiscardedDispositionsReconciliationResult {
  expectedDiscardCount: number;
  persistedDispositionCount: number;
  /** true when persisted >= expected (persistence can only under-count on a
   *  transient DB failure, never over-count — the idempotency key forbids
   *  duplicates). false signals a persistence gap worth investigating. */
  reconciled: boolean;
  gap: number;
}

export function reconcileDiscardedDispositionsAgainstBreakdown(
  breakdown: Record<string, number> | null | undefined,
  persistedDispositionCount: number,
): DiscardedDispositionsReconciliationResult {
  const expectedDiscardCount = sumExpectedDiscardedDispositions(breakdown);
  const gap = expectedDiscardCount - persistedDispositionCount;
  return {
    expectedDiscardCount,
    persistedDispositionCount,
    reconciled: gap <= 0,
    gap: Math.max(gap, 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — reconciliación de la pierna LUSHA
// ═══════════════════════════════════════════════════════════════════════════
//
// Pregunta distinta a la de arriba. Apollo publica un `breakdown` agregado y la
// reconciliación compara «lo que el desglose contó» contra «lo que se
// persistió». Lusha no tiene ese desglose: publica CONTADORES por familia. Lo
// que hay que poder afirmar es que esos contadores CIERRAN contra las filas
// crudas del proveedor, sin residuo:
//
//   raw = unusable + intraRunDuplicates + hardExcluded + activeGuard
//       + exactDuplicates + knownSuppressed + precisionRejected
//       + targetOverflow + batchIdentityRejected + accepted
//
// 🔴 Y que de esos diez sumandos, sólo SEIS son disposiciones durables. Los
// otros cuatro son estados transitorios y convertirlos en fila sería inventar
// un descarte:
//
//   · `unusable`             — fila sin nombre: nada que mostrar ni auditar.
//   · `intraRunDuplicates`   — el proveedor repitió una fila suya.
//   · `batchIdentityRejected`— la empresa ya ocupa el lote por otra vía.
//   · `accepted`             — existe en `prospect_candidates`.
//
// `possible_duplicate` no aparece como sumando porque NO es una familia
// aparte: es un subconjunto de `accepted` —ya es un candidato `needs_review`—
// y por eso tampoco es disposición.
//
// Pura: sin IO, sin reloj. El llamador trae los conteos ya leídos.

/** Los diez desenlaces de una corrida de Lusha, tal como la corrida los cuenta. */
export interface LushaRunDiscardCounters {
  /** Filas crudas que el proveedor devolvió en TODA la corrida. */
  raw: number;
  unusable: number;
  intraRunDuplicates: number;
  hardExcluded: number;
  activeGuard: number;
  exactDuplicates: number;
  knownSuppressed: number;
  precisionRejected: number;
  targetOverflow: number;
  batchIdentityRejected: number;
  accepted: number;
}

export interface LushaRunDispositionReconciliationResult {
  /** Suma de los diez desenlaces. Debe igualar `raw`. */
  accountedFor: number;
  /** `raw - accountedFor`. 0 = la corrida cierra sin residuo. */
  residual: number;
  balanced: boolean;
  /** Los seis sumandos que SÍ generan fila durable. */
  expectedDurableDispositions: number;
  /** Los cuatro que NO la generan, más `accepted`. */
  transientOutcomes: number;
  /** Filas durables que el escritor realmente dejó (persistidas + colisiones). */
  observedDurableDispositions: number | null;
  /**
   * `expectedDurableDispositions - observedDurableDispositions`, acotado a 0.
   * `null` cuando no se observó nada (nadie midió), que NO es «cero hueco».
   */
  durableGap: number | null;
  durableReconciled: boolean | null;
}

/**
 * Cuadra una corrida de Lusha contra sus disposiciones durables.
 *
 * `observedDurableDispositions` ausente ⇒ la parte durable queda SIN MEDIR
 * (`null`), nunca reconciliada por defecto.
 */
export function reconcileLushaRunAgainstDispositions(
  counters: LushaRunDiscardCounters,
  observedDurableDispositions?: number | null,
): LushaRunDispositionReconciliationResult {
  const expectedDurableDispositions =
    counters.hardExcluded +
    counters.activeGuard +
    counters.exactDuplicates +
    counters.knownSuppressed +
    counters.precisionRejected +
    counters.targetOverflow;

  const transientOutcomes =
    counters.unusable +
    counters.intraRunDuplicates +
    counters.batchIdentityRejected +
    counters.accepted;

  const accountedFor = expectedDurableDispositions + transientOutcomes;
  const residual = counters.raw - accountedFor;

  const observed =
    typeof observedDurableDispositions === 'number' &&
    Number.isFinite(observedDurableDispositions)
      ? observedDurableDispositions
      : null;

  return {
    accountedFor,
    residual,
    balanced: residual === 0,
    expectedDurableDispositions,
    transientOutcomes,
    observedDurableDispositions: observed,
    // La persistencia sólo puede quedarse CORTA (fallo transitorio de la base);
    // la clave de idempotencia impide que se pase.
    durableGap: observed === null ? null : Math.max(0, expectedDurableDispositions - observed),
    durableReconciled: observed === null ? null : observed >= expectedDurableDispositions,
  };
}
