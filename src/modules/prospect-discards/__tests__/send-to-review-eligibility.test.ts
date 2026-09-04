// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pure eligibility tests.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSendToReviewEligibility } from '../send-to-review-eligibility';

describe('evaluateSendToReviewEligibility — happy path (Test G/H)', () => {
  it('sends a discarded item to review', () => {
    const r = evaluateSendToReviewEligibility({ status: 'discarded' });
    assert.deepEqual(r, { decision: 'send' });
  });
});

describe('evaluateSendToReviewEligibility — idempotency (Test C/M)', () => {
  it('treats an already sent_to_review disposition as idempotent', () => {
    const r = evaluateSendToReviewEligibility({ status: 'sent_to_review' });
    assert.deepEqual(r, { decision: 'idempotent' });
  });

  it('treats an already needs_review candidate as idempotent', () => {
    const r = evaluateSendToReviewEligibility({ status: 'needs_review' });
    assert.deepEqual(r, { decision: 'idempotent' });
  });
});

describe('evaluateSendToReviewEligibility — status conflicts', () => {
  for (const status of ['approved', 'converted_to_account', 'duplicate', 'generated', 'normalized', null]) {
    it(`rejects status=${String(status)} as status_conflict`, () => {
      const r = evaluateSendToReviewEligibility({ status });
      assert.deepEqual(r, { decision: 'reject', reason: 'status_conflict' });
    });
  }
});
