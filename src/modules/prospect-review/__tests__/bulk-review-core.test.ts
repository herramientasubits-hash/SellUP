// Prod 24-11 — aprobar y descartar en masa en «Por revisar».
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BULK_APPROVE_MAX_IDS,
  BULK_REVIEW_MAX_IDS,
  bulkReviewMaxIds,
  bulkReviewFailureSummary,
  normalizeBulkReviewIds,
  summarizeBulkReview,
} from '../bulk-review-core';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('normalizeBulkReviewIds', () => {
  it('quita repetidas', () => {
    assert.deepEqual(normalizeBulkReviewIds([id(1), id(1), id(2)]), { ok: true, ids: [id(1), id(2)] });
  });
  it('rechaza lo que no es una lista de ids', () => {
    assert.deepEqual(normalizeBulkReviewIds('x'), { ok: false, error: 'invalid_ids' });
    assert.deepEqual(normalizeBulkReviewIds([id(1), "1' or 1=1"]), { ok: false, error: 'invalid_ids' });
    assert.deepEqual(normalizeBulkReviewIds([]), { ok: false, error: 'empty' });
  });
  it('tiene tope (menor para aprobar)', () => {
    const many = Array.from({ length: BULK_REVIEW_MAX_IDS + 1 }, (_, i) => id(i));
    assert.deepEqual(normalizeBulkReviewIds(many), { ok: false, error: 'too_many' });
    const approve = Array.from({ length: BULK_APPROVE_MAX_IDS + 1 }, (_, i) => id(i));
    assert.deepEqual(normalizeBulkReviewIds(approve, bulkReviewMaxIds('approve')), { ok: false, error: 'too_many' });
    assert.equal(normalizeBulkReviewIds(approve, bulkReviewMaxIds('discard')).ok, true);
  });
});

describe('resumen', () => {
  it('cuenta hechas y agrupa las que no se pudieron por motivo', () => {
    const r = summarizeBulkReview([
      { id: id(1), ok: true },
      { id: id(2), ok: false, reason: 'needs_growth_review' },
      { id: id(3), ok: false, reason: 'needs_growth_review' },
      { id: id(4), ok: false, reason: 'status_conflict' },
    ]);
    assert.ok(r.ok);
    assert.equal(r.ok && r.done, 1);
    assert.equal(
      bulkReviewFailureSummary(r.ok ? r.failed : []),
      '2 las decide Growth (posible duplicado o ya en HubSpot); 1 ya no estaban por revisar',
    );
  });
});

describe('las acciones en masa repiten la acción de una fila (no escriben por su cuenta)', () => {
  const source = readFileSync(join(__dirname, '../bulk-review-actions.ts'), 'utf8');
  it('aprueba de a una y con su propio tope', () => {
    assert.match(source, /const APPROVE_CONCURRENCY = 1;/);
    assert.match(source, /normalizeBulkReviewIds\(rawIds, BULK_APPROVE_MAX_IDS\)/);
  });
  it('la página donde corre tiene tiempo para aprobar en masa', () => {
    const page = readFileSync(join(__dirname, '../../../app/(sellup)/accounts/page.tsx'), 'utf8');
    assert.match(page, /export const maxDuration = 300;/);
  });
  it('usa las acciones de una fila', () => {
    assert.match(source, /approveAndConvertPendingReviewCandidateAction\(id\)/);
    assert.match(source, /discardPendingReviewCandidateAction\(id, \{ reason, source: 'prospectos_selection_bar' \}\)/);
  });
  it('no confirma duplicados por la persona ni escribe directo', () => {
    assert.doesNotMatch(source, /confirmPossibleDuplicate|confirmHubSpotMatch/);
    assert.doesNotMatch(source, /supabase|\.update\(|\.insert\(/);
  });
});
