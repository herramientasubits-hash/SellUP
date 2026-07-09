/**
 * Tests — Run Technical Outcome (17B.4X.6C, §24)
 *
 * Technical outcome is derived strictly from attributed provider_usage_logs
 * statuses. contact_enrichment_runs.status is never consulted here — a run
 * can be ready_for_review with a technical_failure underneath.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveRunTechnicalOutcome } from '../aggregators';

describe('deriveRunTechnicalOutcome', () => {
  it('TEST 6 — all usage statuses success → technical_success', () => {
    assert.equal(deriveRunTechnicalOutcome('attributed', ['success', 'success']), 'technical_success');
  });

  it('TEST 7 — success + error → technical_failure', () => {
    assert.equal(deriveRunTechnicalOutcome('attributed', ['success', 'error']), 'technical_failure');
  });

  it('TEST 8 — success + rate_limited → technical_failure', () => {
    assert.equal(deriveRunTechnicalOutcome('attributed', ['success', 'rate_limited']), 'technical_failure');
  });

  it('TEST 9 — quota_exceeded → technical_failure', () => {
    assert.equal(deriveRunTechnicalOutcome('attributed', ['quota_exceeded']), 'technical_failure');
  });

  it('TEST 10 — unattributed → technical_unknown', () => {
    assert.equal(deriveRunTechnicalOutcome('unattributed', []), 'technical_unknown');
  });

  it('TEST 11 — run.status ready_for_review + usage status error → technical_failure (run status never consulted)', () => {
    // The function has no run-status parameter at all — passing only usage
    // statuses proves outcome is independent of contact_enrichment_runs.status.
    assert.equal(deriveRunTechnicalOutcome('attributed', ['error']), 'technical_failure');
  });

  it('ambiguous attribution → technical_unknown', () => {
    assert.equal(deriveRunTechnicalOutcome('ambiguous', ['success', 'success']), 'technical_unknown');
  });
});
