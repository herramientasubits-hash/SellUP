/**
 * Tests — Operation & Run Cost Truth (17B.4X.6C, §26)
 *
 * Lusha nests cost evidence under metadata.cost.truth_source. Apollo persists
 * flat pricing_source/pricing_basis/unit_cost_usd fields. A legacy zero with
 * no marker is ambiguous, never a free known zero — even when credits were
 * spent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyLushaOperationCostTruth,
  classifyApolloOperationCostTruth,
  deriveRunCostTruth,
} from '../cost-truth';

describe('classifyLushaOperationCostTruth', () => {
  it('TEST 18 — truth_source estimated + positive numeric cost → known', () => {
    assert.equal(classifyLushaOperationCostTruth(0.05, 'estimated'), 'known');
  });

  it('TEST 19 — truth_source estimated + numeric zero → known', () => {
    assert.equal(classifyLushaOperationCostTruth(0, 'estimated'), 'known');
  });

  it('TEST 20 — cost null → unknown', () => {
    assert.equal(classifyLushaOperationCostTruth(null, 'estimated'), 'unknown');
  });

  it('TEST 21 — truth_source unknown → unknown', () => {
    assert.equal(classifyLushaOperationCostTruth(0.05, 'unknown'), 'unknown');
  });

  it('TEST 22 — numeric zero + metadata.cost absent → ambiguous', () => {
    assert.equal(classifyLushaOperationCostTruth(0, null), 'ambiguous');
  });

  it('TEST 23 — legacy: credits > 0, numeric zero, no marker → ambiguous (not free)', () => {
    // classifier does not take credits as input — it only sees cost + marker,
    // which is exactly why a credits>0 legacy zero cannot be told apart from
    // a genuine free zero without the marker, and must be ambiguous.
    assert.equal(classifyLushaOperationCostTruth(0, null), 'ambiguous');
  });
});

describe('classifyApolloOperationCostTruth', () => {
  it('TEST 24 — positive numeric cost + pricing evidence present → known', () => {
    assert.equal(classifyApolloOperationCostTruth(0.02, 1, true), 'known');
  });

  it('TEST 25 — zero cost + zero credits + pricing evidence present → known', () => {
    assert.equal(classifyApolloOperationCostTruth(0, 0, true), 'known');
  });

  it('TEST 26 — zero cost + pricing evidence absent → ambiguous', () => {
    assert.equal(classifyApolloOperationCostTruth(0, 0, false), 'ambiguous');
  });

  it('TEST 27 — null cost → unknown', () => {
    assert.equal(classifyApolloOperationCostTruth(null, 0, true), 'unknown');
  });

  it('positive cost without pricing evidence → ambiguous (cannot prove a valid positive)', () => {
    assert.equal(classifyApolloOperationCostTruth(0.02, 1, false), 'ambiguous');
  });

  it('zero cost + nonzero credits + pricing evidence present → ambiguous (not a valid zero)', () => {
    assert.equal(classifyApolloOperationCostTruth(0, 3, true), 'ambiguous');
  });
});

describe('deriveRunCostTruth', () => {
  it('TEST 28 — run all known operations → run known', () => {
    assert.equal(deriveRunCostTruth(['known', 'known']), 'known');
  });

  it('TEST 29 — run known + ambiguous → run ambiguous', () => {
    assert.equal(deriveRunCostTruth(['known', 'ambiguous']), 'ambiguous');
  });

  it('TEST 30 — run known + unknown → run unknown', () => {
    assert.equal(deriveRunCostTruth(['known', 'unknown']), 'unknown');
  });

  it('unknown beats ambiguous when both present', () => {
    assert.equal(deriveRunCostTruth(['unknown', 'ambiguous']), 'unknown');
  });
});
