// Q3F-5AZ.2G-2 — Mark-duplicate eligibility (pure decision layer) exhaustive tests.
//
// evaluateDuplicateEligibility is pure (no IO), so every branch of the Prospectos
// mark-duplicate policy is asserted directly. The policy must stay in lock-step
// with the canonical markCandidateDuplicate and the clean-queue definition:
//   - record_origin MUST be 'production'
//   - already 'duplicate'  → idempotent (safe no-op)
//   - status MUST be 'needs_review'
//   - marking a duplicate NEVER creates an account and NEVER merges records

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDuplicateEligibility,
  DUPLICATE_QUEUE_RECORD_ORIGIN,
  DUPLICATE_QUEUE_STATUS,
} from '../duplicate-eligibility';

describe('evaluateDuplicateEligibility — canonical constants', () => {
  it('targets clean production needs_review', () => {
    assert.equal(DUPLICATE_QUEUE_RECORD_ORIGIN, 'production');
    assert.equal(DUPLICATE_QUEUE_STATUS, 'needs_review');
  });
});

describe('evaluateDuplicateEligibility — happy path', () => {
  it('marks a clean-production needs_review candidate as a duplicate', () => {
    const r = evaluateDuplicateEligibility({ status: 'needs_review', recordOrigin: 'production' });
    assert.deepEqual(r, { decision: 'mark_duplicate' });
  });
});

describe('evaluateDuplicateEligibility — record_origin gate', () => {
  for (const recordOrigin of ['sandbox', 'qa', 'test', null]) {
    it(`rejects record_origin=${String(recordOrigin)} as not_clean_production`, () => {
      const r = evaluateDuplicateEligibility({ status: 'needs_review', recordOrigin });
      assert.deepEqual(r, { decision: 'reject', reason: 'not_clean_production' });
    });
  }
});

describe('evaluateDuplicateEligibility — idempotency', () => {
  it('treats an already-duplicate production row as idempotent (safe no-op)', () => {
    const r = evaluateDuplicateEligibility({ status: 'duplicate', recordOrigin: 'production' });
    assert.deepEqual(r, { decision: 'idempotent' });
  });
});

describe('evaluateDuplicateEligibility — status conflicts', () => {
  for (const status of ['approved', 'converted_to_account', 'discarded', 'generated', 'normalized']) {
    it(`rejects status=${status} as status_conflict`, () => {
      const r = evaluateDuplicateEligibility({ status, recordOrigin: 'production' });
      assert.deepEqual(r, { decision: 'reject', reason: 'status_conflict' });
    });
  }

  it('rejects a null status as status_conflict', () => {
    const r = evaluateDuplicateEligibility({ status: null, recordOrigin: 'production' });
    assert.deepEqual(r, { decision: 'reject', reason: 'status_conflict' });
  });
});
