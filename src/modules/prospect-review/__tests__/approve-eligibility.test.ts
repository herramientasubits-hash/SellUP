// Q3F-5AZ.2C — Approve eligibility policy tests (pure, non-live).
//
// Exhaustively exercises the decision gate that guards the review-queue approve
// action. No DB, no clients — pure inputs → decisions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateApproveEligibility,
  CLEAN_QUEUE_RECORD_ORIGIN,
  CLEAN_QUEUE_STATUS,
  DUPLICATE_HARD_BLOCK,
} from '../approve-eligibility';

const clean = {
  status: 'needs_review',
  recordOrigin: 'production',
  duplicateStatus: 'no_match',
};

describe('approve-eligibility — criteria constants', () => {
  it('pins the canonical clean-queue criteria', () => {
    assert.equal(CLEAN_QUEUE_RECORD_ORIGIN, 'production');
    assert.equal(CLEAN_QUEUE_STATUS, 'needs_review');
  });

  it('hard-blocks exact_duplicate, unchecked and insufficient_data', () => {
    assert.ok(DUPLICATE_HARD_BLOCK.has('exact_duplicate'));
    assert.ok(DUPLICATE_HARD_BLOCK.has('unchecked'));
    assert.ok(DUPLICATE_HARD_BLOCK.has('insufficient_data'));
    assert.equal(DUPLICATE_HARD_BLOCK.has('possible_duplicate'), false);
    assert.equal(DUPLICATE_HARD_BLOCK.has('no_match'), false);
  });
});

describe('approve-eligibility — happy path', () => {
  it('approves a clean needs_review production candidate (no_match)', () => {
    assert.deepEqual(evaluateApproveEligibility(clean), { decision: 'approve' });
  });

  it('approves when duplicate_status is null', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, duplicateStatus: null }),
      { decision: 'approve' },
    );
  });

  it('approves related_company (not a hard block)', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, duplicateStatus: 'related_company' }),
      { decision: 'approve' },
    );
  });
});

describe('approve-eligibility — record_origin gate', () => {
  it('rejects non-production record_origin', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, recordOrigin: 'smoke_test' }),
      { decision: 'reject', reason: 'not_clean_production' },
    );
  });

  it('rejects null record_origin', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, recordOrigin: null }),
      { decision: 'reject', reason: 'not_clean_production' },
    );
  });
});

describe('approve-eligibility — status gate', () => {
  it('rejects a candidate whose status is not needs_review', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, status: 'discarded' }),
      { decision: 'reject', reason: 'status_conflict' },
    );
  });

  it('rejects null status', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, status: null }),
      { decision: 'reject', reason: 'status_conflict' },
    );
  });

  it('returns idempotent for an already-approved production candidate', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, status: 'approved' }),
      { decision: 'idempotent' },
    );
  });

  it('does NOT return idempotent when record_origin is not production', () => {
    // record_origin is checked first — never a silent idempotent pass off-queue.
    assert.deepEqual(
      evaluateApproveEligibility({ status: 'approved', recordOrigin: 'qa', duplicateStatus: null }),
      { decision: 'reject', reason: 'not_clean_production' },
    );
  });
});

describe('approve-eligibility — duplicate policy', () => {
  for (const dup of ['exact_duplicate', 'unchecked', 'insufficient_data']) {
    it(`hard-blocks ${dup}`, () => {
      assert.deepEqual(
        evaluateApproveEligibility({ ...clean, duplicateStatus: dup }),
        { decision: 'reject', reason: 'duplicate_blocked' },
      );
    });
  }

  it('requires confirmation for possible_duplicate when flag absent', () => {
    assert.deepEqual(
      evaluateApproveEligibility({ ...clean, duplicateStatus: 'possible_duplicate' }),
      { decision: 'reject', reason: 'needs_duplicate_confirmation' },
    );
  });

  it('requires confirmation for possible_duplicate when flag false', () => {
    assert.deepEqual(
      evaluateApproveEligibility(
        { ...clean, duplicateStatus: 'possible_duplicate' },
        { confirmPossibleDuplicate: false },
      ),
      { decision: 'reject', reason: 'needs_duplicate_confirmation' },
    );
  });

  it('approves possible_duplicate with explicit confirmation flag', () => {
    assert.deepEqual(
      evaluateApproveEligibility(
        { ...clean, duplicateStatus: 'possible_duplicate' },
        { confirmPossibleDuplicate: true },
      ),
      { decision: 'approve' },
    );
  });

  it('confirmation flag does NOT override a hard block', () => {
    assert.deepEqual(
      evaluateApproveEligibility(
        { ...clean, duplicateStatus: 'exact_duplicate' },
        { confirmPossibleDuplicate: true },
      ),
      { decision: 'reject', reason: 'duplicate_blocked' },
    );
  });
});
