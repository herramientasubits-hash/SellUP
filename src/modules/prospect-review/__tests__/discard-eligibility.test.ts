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

// Q3F-5BB.11K-FIX — the traceable-reason fix must NOT move the policy. The
// policy is a pure function of (status, record_origin): country, tax_identifier
// and source_primary are not inputs and can never change the outcome. This is
// what makes the two CO-without-NIT candidates found in Q3F-5BB.11K-EXECUTE
// (INC, SYNLAB — omitted from the useful list, yet production + needs_review)
// discardable with a motive rather than stuck in the queue.
describe('evaluateDiscardEligibility — policy is unchanged by the reason fix', () => {
  it('allows discard for production + needs_review (the general defect case)', () => {
    assert.deepEqual(
      evaluateDiscardEligibility({
        status: DISCARD_QUEUE_STATUS,
        recordOrigin: DISCARD_QUEUE_RECORD_ORIGIN,
      }),
      { decision: 'discard' },
    );
  });

  it('takes only status + recordOrigin as input (country / NIT / provider are not part of the snapshot)', () => {
    // Extra fields are structurally ignored — proving the policy cannot branch
    // on country_code, tax_identifier or source_primary.
    const withNoise = {
      status: 'needs_review',
      recordOrigin: 'production',
      countryCode: 'CO',
      taxIdentifier: null,
      sourcePrimary: 'lusha',
    } as unknown as Parameters<typeof evaluateDiscardEligibility>[0];
    assert.deepEqual(evaluateDiscardEligibility(withNoise), { decision: 'discard' });
  });

  it('is idempotent for an already-discarded row (safe double submit)', () => {
    assert.deepEqual(
      evaluateDiscardEligibility({ status: 'discarded', recordOrigin: 'production' }),
      { decision: 'idempotent' },
    );
  });

  it('rejects approved / converted_to_account (never re-routed through discard)', () => {
    for (const status of ['approved', 'converted_to_account']) {
      assert.deepEqual(evaluateDiscardEligibility({ status, recordOrigin: 'production' }), {
        decision: 'reject',
        reason: 'status_conflict',
      });
    }
  });

  it('rejects every non-production record_origin (unauthorized origins)', () => {
    for (const recordOrigin of ['sandbox', 'qa', 'test', 'seed', 'demo', '', null]) {
      assert.deepEqual(
        evaluateDiscardEligibility({ status: 'needs_review', recordOrigin }),
        { decision: 'reject', reason: 'not_clean_production' },
        `origin=${String(recordOrigin)}`,
      );
    }
  });
});
