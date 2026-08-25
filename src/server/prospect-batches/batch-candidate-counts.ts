/**
 * batch-candidate-counts.ts — cuántos candidatos contiene REALMENTE un lote.
 *
 * AGENT1-CUT4-A1 (BATCH COUNT TRUTHFULNESS).
 *
 * El defecto que cierra: la capa de lotes contaba sus candidatos filtrando por
 * `isUsefulReviewCandidate`, un clasificador de CALIDAD DE UI. Ese helper
 * devuelve `false`, entre otros casos, para un candidato colombiano sin
 * `tax_identifier` que no venga de `external_import`. Apollo, Lusha y web_ai
 * persisten candidatos CO sin NIT de forma legítima, así que en Producción
 * (Gate 0) 100 candidatos durables repartidos en 24 lotes —aprobables desde
 * Prospectos— se contaban como CERO en la ficha del lote, que es justo la
 * pantalla donde aterriza el operador tras una corrida de pago.
 *
 * La invariante que se defiende:
 *
 *   EXISTENCIA DURABLE != CLASIFICACIÓN DE CALIDAD DE UI.
 *
 * Contar es responder «¿esta fila está persistida y no está borrada?». Esa
 * pregunta ya tiene una autoridad —el contrato durable de CUT-1— y es la que se
 * reutiliza aquí. NO se crea una segunda lista de estados durables, y este
 * módulo NO importa ni menciona `isUsefulReviewCandidate`: si volviera a
 * entrar, volvería la mentira.
 *
 * Lo que este módulo NO hace (fuera de alcance de CUT4-A1):
 *  - no redefine `isUsefulReviewCandidate` (un candidato contado puede seguir
 *    clasificado como no útil, y eso es correcto);
 *  - no toca `usefulCount` de la generación ni la aritmética de objetivo;
 *  - no decide elegibilidad de revisión, aprobación ni duplicado;
 *  - no abre la superficie de acciones heredada del lote (eso es CUT4-C).
 *
 * Puro: sin I/O, sin Supabase, sin env, sin React, sin reloj.
 */

import { isDurableProspectCandidateStatus } from './batch-durable-candidates';

/**
 * Lo MÍNIMO que hay que leer de una fila para contarla. Deliberadamente NO
 * incluye `country_code`, `tax_identifier`, `name` ni `source_primary`: si el
 * conteo no puede verlos, no puede volver a depender de la calidad.
 */
export type BatchCandidateCountRow = {
  status?: string | null;
  duplicate_status?: string | null;
};

export type BatchCandidateCounts = {
  /** Filas durables persistidas en el lote. La verdad de existencia. */
  total: number;
  needsReview: number;
  approved: number;
  discarded: number;
  converted: number;
  duplicates: number;
};

/** Estados del ciclo de revisión que la ficha agrupa como «pendiente». */
export const BATCH_PENDING_REVIEW_STATUSES = [
  'needs_review',
  'generated',
  'normalized',
] as const;

const PENDING_REVIEW_SET: ReadonlySet<string> = new Set(BATCH_PENDING_REVIEW_STATUSES);

const DUPLICATE_SIGNAL_STATUSES: ReadonlySet<string> = new Set([
  'possible_duplicate',
  'exact_duplicate',
]);

export const EMPTY_BATCH_CANDIDATE_COUNTS: BatchCandidateCounts = {
  total: 0,
  needsReview: 0,
  approved: 0,
  discarded: 0,
  converted: 0,
  duplicates: 0,
};

/**
 * Conteo honesto de un conjunto de filas ya acotado a UN lote.
 *
 * Fail-closed: un `status` que no pertenezca al contrato durable de CUT-1 (o
 * que no sea siquiera un string) NO cuenta para nada —ni para el total ni para
 * ningún cubo—. Un estado desconocido nunca fabrica existencia.
 */
export function computeBatchCandidateCounts(
  rows: readonly BatchCandidateCountRow[] | null | undefined,
): BatchCandidateCounts {
  const counts = { ...EMPTY_BATCH_CANDIDATE_COUNTS };
  for (const row of rows ?? []) {
    const status = row?.status;
    if (!isDurableProspectCandidateStatus(status)) continue;

    counts.total += 1;
    if (PENDING_REVIEW_SET.has(status)) counts.needsReview += 1;
    if (status === 'approved') counts.approved += 1;
    if (status === 'discarded') counts.discarded += 1;
    if (status === 'converted_to_account') counts.converted += 1;

    const duplicateStatus = row?.duplicate_status;
    const flaggedDuplicate =
      (typeof duplicateStatus === 'string' && DUPLICATE_SIGNAL_STATUSES.has(duplicateStatus)) ||
      status === 'duplicate';
    if (flaggedDuplicate) counts.duplicates += 1;
  }
  return counts;
}

/** Igual que el anterior, pero repartiendo por `batch_id` en una sola pasada. */
export function computeCountsByBatch(
  rows: readonly (BatchCandidateCountRow & { batch_id?: string | null })[] | null | undefined,
): Map<string, BatchCandidateCounts> {
  const grouped = new Map<string, BatchCandidateCountRow[]>();
  for (const row of rows ?? []) {
    const batchId = row?.batch_id;
    if (typeof batchId !== 'string' || batchId === '') continue;
    const bucket = grouped.get(batchId);
    if (bucket) bucket.push(row);
    else grouped.set(batchId, [row]);
  }

  const out = new Map<string, BatchCandidateCounts>();
  for (const [batchId, bucket] of grouped) {
    out.set(batchId, computeBatchCandidateCounts(bucket));
  }
  return out;
}
