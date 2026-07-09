/**
 * Tests — Outcome Maturity vs Approval Comparison Eligibility (17B.4X.6C, §25)
 *
 * OUTCOME_MATURE and APPROVAL_COMPARISON_ELIGIBLE are distinct booleans.
 * Failed/superseded runs are mature but never approval-comparison-eligible.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveOutcomeMaturity } from '../aggregators';

describe('deriveOutcomeMaturity', () => {
  it('TEST 12 — ready_for_review + 0 pending → mature + approval eligible', () => {
    const result = deriveOutcomeMaturity('ready_for_review', 0, 'attributed');
    assert.equal(result.outcomeMature, true);
    assert.equal(result.approvalComparisonEligible, true);
  });

  it('TEST 13 — ready_for_review + 1 pending → not mature, not approval eligible', () => {
    const result = deriveOutcomeMaturity('ready_for_review', 1, 'attributed');
    assert.equal(result.outcomeMature, false);
    assert.equal(result.approvalComparisonEligible, false);
  });

  it('TEST 14 — completed + 0 pending → mature + approval eligible', () => {
    const result = deriveOutcomeMaturity('completed', 0, 'attributed');
    assert.equal(result.outcomeMature, true);
    assert.equal(result.approvalComparisonEligible, true);
  });

  it('TEST 15 — failed + 0 pending → mature but NOT approval eligible', () => {
    const result = deriveOutcomeMaturity('failed', 0, 'attributed');
    assert.equal(result.outcomeMature, true);
    assert.equal(result.approvalComparisonEligible, false);
  });

  it('TEST 16 — superseded + 0 pending → mature but NOT approval eligible', () => {
    const result = deriveOutcomeMaturity('superseded', 0, 'attributed');
    assert.equal(result.outcomeMature, true);
    assert.equal(result.approvalComparisonEligible, false);
  });

  it('TEST 17 — ready_to_enrich + 0 candidates → NOT mature', () => {
    const result = deriveOutcomeMaturity('ready_to_enrich', 0, 'attributed');
    assert.equal(result.outcomeMature, false);
    assert.equal(result.approvalComparisonEligible, false);
  });

  it('mature + attributed but ambiguous provider → not approval eligible', () => {
    const result = deriveOutcomeMaturity('ready_for_review', 0, 'ambiguous');
    assert.equal(result.outcomeMature, true);
    assert.equal(result.approvalComparisonEligible, false);
  });
});
