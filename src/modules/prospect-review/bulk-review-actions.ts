'use server';

// Prod 24-11 (feedback de líderes) — «no se puede descartar ni aprobar en masa en Por
// revisar, toca una por una». Estas acciones NO escriben nada por su cuenta: repiten, fila
// por fila, las MISMAS acciones de una sola fila (permiso por candidata, elegibilidad, motivo
// validado, auditoría). Lo que la acción de una fila rechaza se devuelve con su motivo: por
// ejemplo, un posible duplicado sigue pidiendo la confirmación de una persona, una por una.

import { approveAndConvertPendingReviewCandidateAction } from './approve-and-convert-actions';
import { discardPendingReviewCandidateAction } from './discard-actions';
import { BULK_APPROVE_MAX_IDS, normalizeBulkReviewIds, summarizeBulkReview, type BulkReviewItem, type BulkReviewResult } from './bulk-review-core';

/**
 * Aprobar crea la empresa (y su paso a HubSpot de siempre): de a UNA, para que dos filas de la
 * misma empresa no creen dos fichas a la vez (revisión 24-11).
 */
const APPROVE_CONCURRENCY = 1;
const DISCARD_CONCURRENCY = 4;

async function runInPool<T>(
  ids: readonly string[],
  concurrency: number,
  run: (id: string) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const index = next;
      next += 1;
      results[index] = await run(ids[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results;
}

/** Aprueba y convierte en empresa cada prospecto marcado (sin confirmar duplicados por ellos). */
export async function bulkApprovePendingReviewCandidatesAction(rawIds: unknown): Promise<BulkReviewResult> {
  const ids = normalizeBulkReviewIds(rawIds, BULK_APPROVE_MAX_IDS);
  if (!ids.ok) return { ok: false, error: ids.error };
  const items = await runInPool(ids.ids, APPROVE_CONCURRENCY, async (id): Promise<BulkReviewItem> => {
    const result = await approveAndConvertPendingReviewCandidateAction(id);
    return result.ok ? { id, ok: true } : { id, ok: false, reason: result.reason };
  });
  return summarizeBulkReview(items);
}

/** Descarta cada prospecto marcado con el MISMO motivo (validado en la acción de una fila). */
export async function bulkDiscardPendingReviewCandidatesAction(rawIds: unknown, reason: unknown): Promise<BulkReviewResult> {
  const ids = normalizeBulkReviewIds(rawIds);
  if (!ids.ok) return { ok: false, error: ids.error };
  if (typeof reason !== 'string') return { ok: false, error: 'invalid_reason' };
  const items = await runInPool(ids.ids, DISCARD_CONCURRENCY, async (id): Promise<BulkReviewItem> => {
    const result = await discardPendingReviewCandidateAction(id, { reason, source: 'prospectos_selection_bar' });
    if (!result.ok && result.reason === 'invalid_reason') return { id, ok: false, reason: 'invalid_reason' };
    return result.ok ? { id, ok: true } : { id, ok: false, reason: result.reason };
  });
  if (items.length > 0 && items.every((i) => !i.ok && i.reason === 'invalid_reason')) {
    return { ok: false, error: 'invalid_reason' };
  }
  return summarizeBulkReview(items);
}
