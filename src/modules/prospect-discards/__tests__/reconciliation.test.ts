// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — reconciliation tests (Test N: "Sin
// clasificar" reconciliation). Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sumExpectedDiscardedDispositions,
  reconcileDiscardedDispositionsAgainstBreakdown,
} from '../reconciliation';

describe('sumExpectedDiscardedDispositions', () => {
  it('sums only the rejection buckets, excluding persisted/review-only', () => {
    const breakdown = {
      provisionally_persisted_pending_writer_final: 9,
      persisted_review_only_final: 2,
      country_rejected_final: 1,
      sector_subindustry_rejected_final: 3,
      ownership_rejected_final: 2,
      enrichment_budget_exhausted_final: 8,
    };
    // 1 + 3 + 2 + 8 = 14 (the 9 persisted + 2 review-only are NOT rejections)
    assert.equal(sumExpectedDiscardedDispositions(breakdown), 14);
  });

  it('returns 0 for an empty or missing breakdown', () => {
    assert.equal(sumExpectedDiscardedDispositions({}), 0);
    assert.equal(sumExpectedDiscardedDispositions(null), 0);
    assert.equal(sumExpectedDiscardedDispositions(undefined), 0);
  });

  it('reproduces the issue example: 17 unique, 8 unclassified become explained', () => {
    // Mirrors the issue's real run: of 17 unique companies, 1 country + 3
    // sector + 2 ownership rejections were the "8 sin clasificar" — this
    // module names each one instead of leaving them unaccounted for.
    const breakdown = {
      country_rejected_final: 1,
      sector_subindustry_rejected_final: 3,
      ownership_rejected_final: 2,
      hubspot_duplicate_final: 2,
      cooldown_final: 1,
      sellup_duplicate_final: 3,
      provisionally_persisted_pending_writer_final: 5,
    };
    assert.equal(sumExpectedDiscardedDispositions(breakdown), 12);
  });
});

describe('reconcileDiscardedDispositionsAgainstBreakdown', () => {
  it('reconciles when persisted count matches expected', () => {
    const r = reconcileDiscardedDispositionsAgainstBreakdown(
      { country_rejected_final: 1, sector_subindustry_rejected_final: 3 },
      4,
    );
    assert.equal(r.expectedDiscardCount, 4);
    assert.equal(r.persistedDispositionCount, 4);
    assert.equal(r.reconciled, true);
    assert.equal(r.gap, 0);
  });

  it('reconciles when persisted count exceeds expected (never over-counts, dedupe absorbs it)', () => {
    const r = reconcileDiscardedDispositionsAgainstBreakdown(
      { country_rejected_final: 1 },
      3,
    );
    assert.equal(r.reconciled, true);
    assert.equal(r.gap, 0);
  });

  it('flags a gap when persisted count falls short of expected', () => {
    const r = reconcileDiscardedDispositionsAgainstBreakdown(
      { country_rejected_final: 1, sector_subindustry_rejected_final: 3 },
      2,
    );
    assert.equal(r.expectedDiscardCount, 4);
    assert.equal(r.persistedDispositionCount, 2);
    assert.equal(r.reconciled, false);
    assert.equal(r.gap, 2);
  });
});
