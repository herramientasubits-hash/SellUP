/**
 * Tests — Latency (17B.4X.6C, §30, diagnostic only)
 *
 * A run is latency-eligible only when EVERY attributed usage row has a
 * non-null duration_ms. Partial sums are never reported as a complete run
 * latency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveLatencyTruth, median } from '../aggregators';

describe('deriveLatencyTruth', () => {
  it('TEST 50 — 2 usage rows (100ms, 200ms) → run latency 300ms', () => {
    const result = deriveLatencyTruth([{ durationMs: 100 }, { durationMs: 200 }]);
    assert.equal(result.eligible, true);
    assert.equal(result.totalDurationMs, 300);
  });

  it('TEST 51 — (100ms, null) → run latency unknown, not a partial 100ms sum', () => {
    const result = deriveLatencyTruth([{ durationMs: 100 }, { durationMs: null }]);
    assert.equal(result.eligible, false);
    assert.equal(result.totalDurationMs, null);
  });
});

describe('median', () => {
  it('TEST 52 — eligible run latencies [100, 300, 200] → median 200', () => {
    assert.equal(median([100, 300, 200]), 200);
  });

  it('TEST 53 — no latency eligible runs → median null', () => {
    assert.equal(median([]), null);
  });

  it('even-length input averages the two middle values', () => {
    assert.equal(median([100, 200, 300, 400]), 250);
  });
});
