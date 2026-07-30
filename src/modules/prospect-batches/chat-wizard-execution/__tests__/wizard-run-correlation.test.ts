/**
 * Tests — wizard-run-correlation.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The QA batch of 2026-07-30 could only be tied to its usage rows by timestamp.
 * These tests pin the properties that replace timestamps as the correlation
 * mechanism, and the ones that keep reconciliation idempotent.
 *
 * A. Determinism and independence of the derived ids
 * B. withResolvedIds — immutability and idempotency-key recomputation
 * C. provider_usage_logs projection
 * D. matchUsageRowToRun — precedence
 * E. matchUsageRowToRun — contradiction (the concurrent-run case)
 * F. Timestamps are never part of the decision
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardRunId,
  buildWizardRequestFingerprint,
  buildWizardReconciliationIdempotencyKey,
  buildWizardRunCorrelation,
  withResolvedIds,
  toProviderUsageCorrelationColumns,
  matchUsageRowToRun,
  type WizardRunCorrelation,
  type WizardRunCorrelationInput,
} from '../wizard-run-correlation';

const BASE_INPUT: WizardRunCorrelationInput = {
  userId: 'user-1',
  clientRequestId: 'req-1',
  batchId: 'batch-1',
  reservationId: 'resv-1',
  providerKey: 'apollo_organizations',
  requestSignature: 'CO|v3|industry-1|sub-1|3',
};

function correlation(
  overrides: Partial<WizardRunCorrelationInput> = {},
): WizardRunCorrelation {
  return buildWizardRunCorrelation({ ...BASE_INPUT, ...overrides });
}

// ── A. Determinism ────────────────────────────────────────────────────────────

describe('A — deterministic derivation', () => {
  it('A1: the same inputs always produce the same correlation', () => {
    assert.deepEqual(correlation(), correlation());
  });

  it('A2: run id depends on user AND client request id', () => {
    const base = buildWizardRunId('user-1', 'req-1');
    assert.notEqual(base, buildWizardRunId('user-2', 'req-1'));
    assert.notEqual(base, buildWizardRunId('user-1', 'req-2'));
    assert.equal(base, buildWizardRunId('user-1', 'req-1'));
  });

  it('A3: the separator makes concatenation unambiguous', () => {
    // Without a separator that cannot occur in the inputs, ('ab','c') and
    // ('a','bc') would hash identically and two distinct runs would collide.
    assert.notEqual(buildWizardRunId('ab', 'c'), buildWizardRunId('a', 'bc'));
  });

  it('A4: ids are fixed-length lowercase hex — safe to log, not PII', () => {
    const c = correlation();
    for (const id of [c.wizardRunId, c.requestFingerprint, c.idempotencyKey]) {
      assert.match(id, /^[0-9a-f]{32}$/);
    }
    // A user id must never be recoverable by reading the log line.
    assert.ok(!c.wizardRunId.includes('user-1'));
  });

  it('A5: request fingerprint changes with provider or parameters', () => {
    const base = buildWizardRequestFingerprint('apollo_organizations', 'CO|3');
    assert.notEqual(base, buildWizardRequestFingerprint('tavily', 'CO|3'));
    assert.notEqual(base, buildWizardRequestFingerprint('apollo_organizations', 'PE|3'));
  });

  it('A6: run id and fingerprint are independent — a replayed id is detectable', () => {
    const first = correlation({ requestSignature: 'CO|3' });
    const replayed = correlation({ requestSignature: 'PE|20' });
    assert.equal(first.wizardRunId, replayed.wizardRunId);
    assert.notEqual(first.requestFingerprint, replayed.requestFingerprint);
  });

  it('A7: a missing reservation gets a distinct, stable idempotency key', () => {
    const withoutReservation = buildWizardReconciliationIdempotencyKey('run-x', null);
    assert.equal(withoutReservation, buildWizardReconciliationIdempotencyKey('run-x', null));
    assert.notEqual(
      withoutReservation,
      buildWizardReconciliationIdempotencyKey('run-x', 'resv-1'),
    );
  });

  it('A8: absent batch and reservation normalize to null, never undefined', () => {
    const c = buildWizardRunCorrelation({
      userId: 'u',
      clientRequestId: 'r',
      providerKey: 'tavily',
      requestSignature: 's',
    });
    assert.equal(c.batchId, null);
    assert.equal(c.reservationId, null);
  });
});

// ── B. withResolvedIds ────────────────────────────────────────────────────────

describe('B — withResolvedIds', () => {
  it('B1: returns a new object and never mutates the input', () => {
    const before = correlation({ batchId: null, reservationId: null });
    const snapshot = { ...before };
    const after = withResolvedIds(before, { batchId: 'batch-9' });

    assert.notEqual(after, before);
    assert.deepEqual(before, snapshot);
    assert.equal(after.batchId, 'batch-9');
  });

  it('B2: a new reservation id recomputes the idempotency key', () => {
    const before = correlation({ reservationId: null });
    const after = withResolvedIds(before, { reservationId: 'resv-7' });

    assert.notEqual(after.idempotencyKey, before.idempotencyKey);
    assert.equal(
      after.idempotencyKey,
      buildWizardReconciliationIdempotencyKey(before.wizardRunId, 'resv-7'),
    );
  });

  it('B3: resolving only the batch id leaves the idempotency key alone', () => {
    // The key is keyed on the reservation, so learning the batch id must not
    // make a second reconciliation of the same reservation look like a new one.
    const before = correlation();
    const after = withResolvedIds(before, { batchId: 'batch-9' });
    assert.equal(after.idempotencyKey, before.idempotencyKey);
  });

  it('B4: omitted fields are preserved; explicit null clears', () => {
    const before = correlation();
    assert.equal(withResolvedIds(before, {}).batchId, 'batch-1');
    assert.equal(withResolvedIds(before, {}).reservationId, 'resv-1');
    assert.equal(withResolvedIds(before, { batchId: null }).batchId, null);
    assert.equal(withResolvedIds(before, { reservationId: null }).reservationId, null);
  });

  it('B5: applying it twice with the same ids is a no-op', () => {
    const once = withResolvedIds(correlation(), { batchId: 'b', reservationId: 'r' });
    const twice = withResolvedIds(once, { batchId: 'b', reservationId: 'r' });
    assert.deepEqual(twice, once);
  });
});

// ── C. Projection ─────────────────────────────────────────────────────────────

describe('C — provider_usage_logs projection', () => {
  it('C1: maps every correlation field to its snake_case column', () => {
    const c = correlation();
    assert.deepEqual(toProviderUsageCorrelationColumns(c, 'recorded'), {
      batch_id: 'batch-1',
      reservation_id: 'resv-1',
      client_request_id: 'req-1',
      wizard_run_id: c.wizardRunId,
      request_fingerprint: c.requestFingerprint,
      idempotency_key: c.idempotencyKey,
      billing_state: 'recorded',
    });
  });

  it('C2: billing_state defaults to null, not to a guessed state', () => {
    assert.equal(toProviderUsageCorrelationColumns(correlation()).billing_state, null);
  });

  it('C3: unresolved ids project as null so the nullable columns accept them', () => {
    const c = correlation({ batchId: null, reservationId: null });
    const columns = toProviderUsageCorrelationColumns(c);
    assert.equal(columns.batch_id, null);
    assert.equal(columns.reservation_id, null);
  });

  it('C4: the projection carries no user id', () => {
    const serialized = JSON.stringify(toProviderUsageCorrelationColumns(correlation()));
    assert.ok(!serialized.includes('user-1'));
  });
});

// ── D. Row matching — precedence ──────────────────────────────────────────────

describe('D — matchUsageRowToRun precedence', () => {
  it('D1: the reservation id is the strongest key', () => {
    const result = matchUsageRowToRun(
      { reservation_id: 'resv-1', client_request_id: 'req-1', batch_id: 'batch-1' },
      correlation(),
    );
    assert.deepEqual(result, { matched: true, matchedOn: 'reservation_id' });
  });

  it('D2: the client request id matches when no reservation was logged', () => {
    const result = matchUsageRowToRun(
      { reservation_id: null, client_request_id: 'req-1' },
      correlation(),
    );
    assert.deepEqual(result, { matched: true, matchedOn: 'client_request_id' });
  });

  it('D3: a legacy row with only batch_id still matches', () => {
    // Rows written before migration 100 have NULL in every new column. They must
    // keep reconciling instead of being dropped.
    const result = matchUsageRowToRun({ batch_id: 'batch-1' }, correlation());
    assert.deepEqual(result, { matched: true, matchedOn: 'batch_id' });
  });

  it('D4: a row sharing nothing does not match', () => {
    assert.deepEqual(matchUsageRowToRun({}, correlation()), {
      matched: false,
      reason: 'no_shared_correlation_key',
    });
  });

  it('D5: batch_id alone cannot match when the run has no batch id yet', () => {
    const result = matchUsageRowToRun(
      { batch_id: 'batch-1' },
      correlation({ batchId: null }),
    );
    assert.equal(result.matched, false);
  });
});

// ── E. Row matching — contradiction ───────────────────────────────────────────

describe('E — contradiction wins over any shared key', () => {
  it('E1: same batch, different reservation ⇒ a concurrent run, not ours', () => {
    // This is exactly the case a timestamp comparison would get wrong.
    const result = matchUsageRowToRun(
      { batch_id: 'batch-1', reservation_id: 'resv-OTHER' },
      correlation(),
    );
    assert.deepEqual(result, { matched: false, reason: 'contradicts_correlation' });
  });

  it('E2: a different client request id contradicts', () => {
    const result = matchUsageRowToRun(
      { batch_id: 'batch-1', client_request_id: 'req-OTHER' },
      correlation(),
    );
    assert.deepEqual(result, { matched: false, reason: 'contradicts_correlation' });
  });

  it('E3: a different wizard run id contradicts', () => {
    const result = matchUsageRowToRun(
      { reservation_id: 'resv-1', wizard_run_id: 'not-our-run' },
      correlation(),
    );
    assert.deepEqual(result, { matched: false, reason: 'contradicts_correlation' });
  });

  it('E4: a different batch id contradicts even with a matching reservation', () => {
    const result = matchUsageRowToRun(
      { batch_id: 'batch-OTHER', reservation_id: 'resv-1' },
      correlation(),
    );
    assert.deepEqual(result, { matched: false, reason: 'contradicts_correlation' });
  });

  it('E5: a null on either side is absence, not contradiction', () => {
    const c = correlation({ reservationId: null });
    const result = matchUsageRowToRun(
      { reservation_id: 'resv-1', client_request_id: 'req-1' },
      c,
    );
    assert.equal(result.matched, true);
  });

  it('E6: the run own wizard_run_id agrees with itself', () => {
    const c = correlation();
    const result = matchUsageRowToRun(
      { reservation_id: 'resv-1', wizard_run_id: c.wizardRunId },
      c,
    );
    assert.deepEqual(result, { matched: true, matchedOn: 'reservation_id' });
  });
});

// ── F. No timestamps ──────────────────────────────────────────────────────────

describe('F — timestamps are not a correlation key', () => {
  it('F1: extra time-like fields on the row change nothing', () => {
    const c = correlation();
    const withTime = matchUsageRowToRun(
      {
        batch_id: 'batch-1',
        reservation_id: 'resv-1',
        // Deliberately shaped like the columns a timestamp-based implementation
        // would reach for. They must be ignored.
        ...({ created_at: '1999-01-01T00:00:00Z', logged_at: 'not-a-date' } as Record<
          string,
          unknown
        >),
      },
      c,
    );
    assert.deepEqual(withTime, { matched: true, matchedOn: 'reservation_id' });
  });

  it('F2: the module exposes no clock-derived value', () => {
    // Two correlations built from identical inputs at different moments are
    // equal — which is what makes repeated reconciliation idempotent.
    const first = correlation();
    const second = correlation();
    assert.equal(first.idempotencyKey, second.idempotencyKey);
  });
});
