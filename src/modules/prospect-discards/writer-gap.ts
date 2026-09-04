// AGENT1-DISCARDED-TRACEABILITY-1 — ¿qué le pasó de verdad a una candidata que
// el orquestador entregó al writer?
//
// EL HUECO QUE CIERRA
// ───────────────────
// `mapApolloFinalDispositionToCode` devuelve `null` para las dos disposiciones
// PRE-writer (`provisionally_persisted_pending_writer_final` y
// `persisted_review_only_final`) con este razonamiento: «no son rechazos — el
// candidato o va al writer o ya es una fila needs_review». Esa premisa deja de
// ser cierta en cuanto el writer NO crea la fila: la empresa se queda sin fila
// de candidato Y sin fila de disposición, y desaparece de toda persistencia.
// En el E2E del 2026-09-04 eso fue exactamente 1 de 17.
//
// Este módulo decide, SIN inventar nada, si una candidata pre-writer acabó
// creada, no creada, o si la información disponible no permite afirmarlo.
//
// POR QUÉ NO SE COMPARAN IDS
// ──────────────────────────
// `CandidateWriterOutput.createdCandidateIds` son UUID de `prospect_candidates`
// generados por la base: no hay forma de volver de un UUID a un `candidateKey`
// del orquestador sin releer la tabla. Lo que el writer SÍ devuelve y sí es
// atable es `skipped[]`, que nombra a las que NO creó y con qué motivo, más el
// recuento `candidatesCreated`. De esos dos hechos —y sólo de esos— salen los
// veredictos de abajo.
//
// Puro: sin I/O, sin reloj, sin dependencias del pipeline de Apollo.

/** Una candidata que el orquestador marcó como pre-writer. */
export interface PreWriterCandidateLike {
  candidateKey: string;
  /**
   * Nombre con el que llegó a la lista que el writer recibió, o `null` si nunca
   * llegó (p. ej. su evidencia no se pudo rehidratar y `resolvePersistableCandidates`
   * la saltó). `null` es información, no ausencia: si no llegó, no pudo crearse.
   */
  reachedWriterAsName: string | null;
}

/** Lo que el writer devolvió. Estructural: no importa de qué módulo venga. */
export interface WriterOutcomeLike {
  /** `createdCandidateIds.length`. La única cifra canónica de FILAS creadas. */
  candidatesCreated: number;
  /** Las que el writer NO creó, con su motivo REAL. */
  skipped: readonly { name: string; reason: string }[];
}

export type WriterGapEvidence =
  /** Nunca llegó a la lista del writer: no pudo crearse. */
  | "never_reached_writer"
  /** El writer la nombró explícitamente entre las que saltó. */
  | "writer_skipped"
  /** El writer creó CERO filas: ninguna de las que llegaron se creó. */
  | "writer_created_none";

export type WriterGapVerdict =
  | {
      kind: "not_created";
      evidence: WriterGapEvidence;
      /** Motivo textual del writer. `null` cuando el writer no lo nombró — y
       *  entonces se persiste `null`, nunca un motivo plausible inventado. */
      reason: string | null;
    }
  /** Hay certeza de que SÍ se creó: jamás debe aparecer en «Descartadas». */
  | { kind: "created" }
  /** No se puede afirmar ninguna de las dos cosas. No se persiste nada. */
  | { kind: "indeterminate" };

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Veredicto por `candidateKey` para TODAS las candidatas pre-writer.
 *
 * Reglas, en orden. Cada una se apoya en un hecho observado; ninguna reparte el
 * hueco entre causas plausibles:
 *
 *   1. No llegó al writer            ⇒ no creada (`never_reached_writer`).
 *   2. El writer la nombró en `skipped` ⇒ no creada (`writer_skipped`), con su
 *      motivo real. El emparejamiento es UNO A UNO: dos candidatas homónimas no
 *      consumen la misma entrada de `skipped`.
 *   3. El writer creó 0 filas        ⇒ no creada (`writer_created_none`).
 *   4. Creó tantas filas como candidatas llegaron ⇒ todas creadas.
 *   5. Cualquier otro caso           ⇒ indeterminado.
 *
 * La regla 5 es deliberada: con `0 < creadas < llegaron` y sin entrada en
 * `skipped` que las distinga, marcar a una concreta como descartada sería
 * inventar el dato que este hito existe para no inventar.
 */
export function classifyPreWriterCandidatesAgainstWriter(
  preWriterCandidates: readonly PreWriterCandidateLike[],
  writerOutcome: WriterOutcomeLike,
): Map<string, WriterGapVerdict> {
  const verdicts = new Map<string, WriterGapVerdict>();

  // Emparejamiento uno a uno por nombre normalizado.
  const skippedByName = new Map<string, { reason: string }[]>();
  for (const entry of writerOutcome.skipped) {
    const key = normalizeName(entry.name);
    const bucket = skippedByName.get(key);
    if (bucket) bucket.push({ reason: entry.reason });
    else skippedByName.set(key, [{ reason: entry.reason }]);
  }

  const created = Math.max(0, Math.trunc(writerOutcome.candidatesCreated));

  // ── Pasada 1 · los hechos que se pueden afirmar por candidata ──────────────
  const undecided: string[] = [];
  for (const candidate of preWriterCandidates) {
    if (candidate.reachedWriterAsName === null) {
      verdicts.set(candidate.candidateKey, {
        kind: "not_created",
        evidence: "never_reached_writer",
        reason: null,
      });
      continue;
    }

    const bucket = skippedByName.get(
      normalizeName(candidate.reachedWriterAsName),
    );
    const match = bucket?.shift();
    if (match) {
      verdicts.set(candidate.candidateKey, {
        kind: "not_created",
        evidence: "writer_skipped",
        reason: match.reason,
      });
      continue;
    }

    undecided.push(candidate.candidateKey);
  }

  // ── Pasada 2 · aritmética sobre las que quedan ────────────────────────────
  //
  // El denominador son SÓLO las que llegaron al writer y que él no nombró en
  // `skipped`: contar también las ya emparejadas declararía creada a una que el
  // writer dijo explícitamente que saltó.
  for (const candidateKey of undecided) {
    if (created === 0) {
      verdicts.set(candidateKey, {
        kind: "not_created",
        evidence: "writer_created_none",
        reason: null,
      });
      continue;
    }
    if (created >= undecided.length) {
      verdicts.set(candidateKey, { kind: "created" });
      continue;
    }
    verdicts.set(candidateKey, { kind: "indeterminate" });
  }

  return verdicts;
}

/**
 * Recuento de los motivos REALES con los que el writer saltó filas — el mismo
 * material del que sale `persistence_reconciliation.gap_causes`, derivado aquí
 * de `skipped[]` para no tener que devolver el agregado desde el writer.
 *
 * Se persiste como contexto de auditoría junto a la fila; el motivo por fila es
 * siempre el suyo propio, nunca este agregado.
 */
export function summarizeWriterGapCauses(
  skipped: readonly { reason: string }[],
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const entry of skipped) {
    // El motivo llega como `bucket` o `bucket:detalle` (p. ej.
    // `persistence_failed:identity_fence_missing_candidate_id`). Se agrega por
    // la cubeta, que es la granularidad de `gap_causes`.
    const bucket = entry.reason.split(":")[0]?.trim() || entry.reason;
    tally[bucket] = (tally[bucket] ?? 0) + 1;
  }
  return tally;
}
