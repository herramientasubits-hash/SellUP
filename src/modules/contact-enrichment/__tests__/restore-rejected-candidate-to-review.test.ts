// AGENT2A-CONTACTOS-RECHAZADOS — «Enviar a revisar»: un rechazado vuelve a `pending_review`.
// Regla pura: 0 DB, 0 proveedor, 0 HubSpot.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESTORE_TO_REVIEW_MESSAGES,
  buildRestoreToReviewMetadata,
  runRestoreCandidateToReview,
  type CandidateRecord,
  type RestoreToReviewPatch,
} from '../candidate-review-core';

const NOW = '2026-10-07T20:00:00.000Z';

function makeCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'cand-1',
    status: 'discarded',
    enrichment_metadata: {
      relevance: { status: 'high_relevance' },
      review: { status: 'discarded', reason: 'Otro', reviewed_at: '2026-10-01T00:00:00.000Z', reviewed_by: 'u-0' },
    },
    ...overrides,
  } as unknown as CandidateRecord;
}

function deps(candidate: CandidateRecord | null, updateError?: string) {
  const patches: RestoreToReviewPatch[] = [];
  return {
    patches,
    deps: {
      actorId: 'u-1',
      nowIso: NOW,
      loadCandidate: async () => candidate,
      updateCandidate: async (_id: string, patch: RestoreToReviewPatch) => {
        patches.push(patch);
        return { error: updateError };
      },
    },
  };
}

test('un rechazado vuelve a pending_review y se limpia el veredicto', async () => {
  const { patches, deps: d } = deps(makeCandidate());
  const result = await runRestoreCandidateToReview('cand-1', d);
  assert.deepEqual(result, { ok: true, message: RESTORE_TO_REVIEW_MESSAGES.restored });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].status, 'pending_review');
  assert.equal(patches[0].reviewed_at, null);
  assert.equal(patches[0].reviewed_by, null);
  assert.equal(patches[0].review_notes, null);
  assert.equal('review' in patches[0].enrichment_metadata, false);
  // Lo demás de la metadata se conserva.
  assert.deepEqual(patches[0].enrichment_metadata.relevance, { status: 'high_relevance' });
});

test('el rechazo anterior queda archivado en review_history', () => {
  const meta = buildRestoreToReviewMetadata(
    { review: { status: 'discarded', reason: 'Otro' }, review_history: [{ status: 'discarded' }] },
    'u-1',
    NOW,
  );
  const history = meta.review_history as Record<string, unknown>[];
  assert.equal(history.length, 2);
  assert.equal(history[1].reason, 'Otro');
  assert.equal(history[1].restored_to_review_at, NOW);
  assert.equal(history[1].restored_to_review_by, 'u-1');
});

test('sólo los rechazados: aprobado, duplicado o pendiente no se tocan', async () => {
  for (const status of ['approved', 'duplicate', 'pending_review'] as const) {
    const { patches, deps: d } = deps(makeCandidate({ status } as Partial<CandidateRecord>));
    const result = await runRestoreCandidateToReview('cand-1', d);
    assert.deepEqual(result, { ok: false, error: RESTORE_TO_REVIEW_MESSAGES.notRejected });
    assert.equal(patches.length, 0);
  }
});

test('id vacío, inexistente o fallo de escritura → error sin éxito falso', async () => {
  assert.equal((await runRestoreCandidateToReview('  ', deps(makeCandidate()).deps)).ok, false);
  assert.deepEqual(await runRestoreCandidateToReview('x', deps(null).deps), {
    ok: false,
    error: RESTORE_TO_REVIEW_MESSAGES.notFound,
  });
  assert.deepEqual(await runRestoreCandidateToReview('cand-1', deps(makeCandidate(), 'boom').deps), {
    ok: false,
    error: RESTORE_TO_REVIEW_MESSAGES.failed,
  });
});
