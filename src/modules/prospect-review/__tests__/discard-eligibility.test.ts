// Q3F-5AZ.2G-1 — Discard eligibility (pure decision layer) exhaustive tests.
//
// evaluateDiscardEligibility is pure (no IO), so every branch of the Prospectos
// discard policy is asserted directly. The policy must stay in lock-step with
// the canonical discardCandidate and the clean-queue definition:
//   - record_origin MUST be 'production'
//   - already 'discarded'  → idempotent (safe no-op)
//   - status MUST be 'needs_review'
//   - duplicate signal is IRRELEVANT to discard (never blocks, never marks dup)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDiscardEligibility,
  DISCARD_QUEUE_RECORD_ORIGIN,
  DISCARD_QUEUE_STATUS,
} from '../discard-eligibility';

describe('evaluateDiscardEligibility — canonical constants', () => {
  it('targets clean production needs_review', () => {
    assert.equal(DISCARD_QUEUE_RECORD_ORIGIN, 'production');
    assert.equal(DISCARD_QUEUE_STATUS, 'needs_review');
  });
});

describe('evaluateDiscardEligibility — happy path', () => {
  it('discards a clean-production needs_review candidate', () => {
    const r = evaluateDiscardEligibility({ status: 'needs_review', recordOrigin: 'production' });
    assert.deepEqual(r, { decision: 'discard' });
  });

  it('still discards regardless of a blocking duplicate signal (duplicate is irrelevant)', () => {
    // The snapshot deliberately has no duplicate field — discard never consults it.
    const r = evaluateDiscardEligibility({ status: 'needs_review', recordOrigin: 'production' });
    assert.equal(r.decision, 'discard');
  });
});

describe('evaluateDiscardEligibility — record_origin gate', () => {
  for (const recordOrigin of ['sandbox', 'qa', 'test', null]) {
    it(`rejects record_origin=${String(recordOrigin)} as not_clean_production`, () => {
      const r = evaluateDiscardEligibility({ status: 'needs_review', recordOrigin });
      assert.deepEqual(r, { decision: 'reject', reason: 'not_clean_production' });
    });
  }
});

describe('evaluateDiscardEligibility — idempotency', () => {
  it('treats an already-discarded production row as idempotent (safe no-op)', () => {
    const r = evaluateDiscardEligibility({ status: 'discarded', recordOrigin: 'production' });
    assert.deepEqual(r, { decision: 'idempotent' });
  });
});

describe('evaluateDiscardEligibility — status conflicts', () => {
  for (const status of ['approved', 'converted_to_account', 'duplicate', 'generated', 'normalized']) {
    it(`rejects status=${status} as status_conflict`, () => {
      const r = evaluateDiscardEligibility({ status, recordOrigin: 'production' });
      assert.deepEqual(r, { decision: 'reject', reason: 'status_conflict' });
    });
  }

  it('rejects a null status as status_conflict', () => {
    const r = evaluateDiscardEligibility({ status: null, recordOrigin: 'production' });
    assert.deepEqual(r, { decision: 'reject', reason: 'status_conflict' });
  });
});
