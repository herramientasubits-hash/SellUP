/**
 * Tests — wizard-run-correlation.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The QA batch of 2026-07-30 could only be tied to its usage rows by timestamp.
 * These tests pin the properties that replace timestamps as the correlation
 * mechanism, and the ones that keep reconciliation idempotent.
 *
 * Pure module: no network, no DB, no clock, no randomness.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardReconciliationIdempotencyKey,
  buildWizardRequestFingerprint,
  buildWizardRunCorrelation,
  buildWizardRunId,
  matchUsageRowToRun,
  readRowCorrelationKeys,
  RUN_CORRELATION_METADATA_KEY,
  toProviderUsageCorrelationColumns,
  toRunCorrelationMetadata,
  withResolvedIds,
} from '../wizard-run-correlation';

const BASE = {
  userId: 'user-1',
  clientRequestId: 'req-abc',
  providerKey: 'apollo_organizations',
  requestSignature: 'CO|v1|ind-1|sub-1|4',
};

function makeCorrelation(overrides: Partial<Parameters<typeof buildWizardRunCorrelation>[0]> = {}) {
  return buildWizardRunCorrelation({ ...BASE, ...overrides });
}

describe('A. Derived ids are deterministic and independent', () => {
  it('the same user + clientRequestId always yields the same run id', () => {
    assert.equal(buildWizardRunId('u', 'r'), buildWizardRunId('u', 'r'));
  });

  it('different users or requests yield different run ids', () => {
    assert.notEqual(buildWizardRunId('u1', 'r'), buildWizardRunId('u2', 'r'));
    assert.notEqual(buildWizardRunId('u', 'r1'), buildWizardRunId('u', 'r2'));
  });

  it('the id encoding is injective across the field boundary', () => {
    // A naive separator-joined hash would collide these two.
    assert.notEqual(buildWizardRunId('ab', 'c'), buildWizardRunId('a', 'bc'));
  });

  it('a different request signature changes the fingerprint but not the run id', () => {
    const a = makeCorrelation();
    const b = makeCorrelation({ requestSignature: 'MX|v1|ind-9|sub-9|20' });

    assert.equal(a.wizardRunId, b.wizardRunId, 'same press, same run');
    assert.notEqual(a.requestFingerprint, b.requestFingerprint, 'different parameters');
  });

  it('produces no PII — ids are opaque hex digests', () => {
    const c = makeCorrelation();
    assert.match(c.wizardRunId, /^[0-9a-f]+$/);
    assert.match(c.requestFingerprint, /^[0-9a-f]+$/);
    assert.ok(!c.wizardRunId.includes(BASE.userId));
  });
});

describe('B. withResolvedIds is immutable and recomputes the idempotency key', () => {
  it('does not mutate the input', () => {
    const original = makeCorrelation({ reservationId: 'res-1' });
    const snapshot = { ...original };

    withResolvedIds(original, { batchId: 'batch-1' });

    assert.deepEqual(original, snapshot, 'input must not be mutated');
  });

  it('recomputes the idempotency key when the reservation changes', () => {
    const c = makeCorrelation({ reservationId: 'res-1' });
    const retried = withResolvedIds(c, { reservationId: 'res-2' });

    assert.notEqual(retried.idempotencyKey, c.idempotencyKey, 'a new reservation reconciles separately');
    assert.equal(
      retried.idempotencyKey,
      buildWizardReconciliationIdempotencyKey(c.wizardRunId, 'res-2'),
    );
  });

  it('keeps the idempotency key stable when only the batch id is resolved', () => {
    const c = makeCorrelation({ reservationId: 'res-1' });
    const withBatch = withResolvedIds(c, { batchId: 'batch-1' });

    assert.equal(withBatch.idempotencyKey, c.idempotencyKey, 'same reservation, same key');
    assert.equal(withBatch.batchId, 'batch-1');
  });

  it('agent_run_id stays nullable and is not required for correlation', () => {
    const c = makeCorrelation({ reservationId: 'res-1' });
    assert.equal(c.agentRunId, null);

    const row = { batch_id: 'b1', reservation_id: 'res-1' };
    assert.equal(matchUsageRowToRun(row, withResolvedIds(c, { batchId: 'b1' })).matched, true);
  });
});

describe('C. Projections', () => {
  it('metadata transport carries every correlation field', () => {
    const c = withResolvedIds(makeCorrelation({ reservationId: 'res-1' }), { batchId: 'b1' });
    const meta = toRunCorrelationMetadata(c, 'recorded');

    assert.equal(meta.wizard_run_id, c.wizardRunId);
    assert.equal(meta.reservation_id, 'res-1');
    assert.equal(meta.client_request_id, 'req-abc');
    assert.equal(meta.batch_id, 'b1');
    assert.equal(meta.idempotency_key, c.idempotencyKey);
    assert.equal(meta.billing_state, 'recorded');
  });

  it('column projection does NOT duplicate batch_id', () => {
    const columns = toProviderUsageCorrelationColumns(makeCorrelation({ reservationId: 'r' }));
    assert.ok(!('batch_id' in columns), 'batch_id already exists as its own column');
    assert.ok('reservation_id' in columns);
    assert.ok('client_request_id' in columns);
  });

  it('billing_state defaults to null rather than a fabricated state', () => {
    const columns = toProviderUsageCorrelationColumns(makeCorrelation());
    assert.equal(columns.billing_state, null);
  });
});

describe('D. Reading correlation keys from columns or metadata', () => {
  it('reads from columns when they are present', () => {
    const keys = readRowCorrelationKeys({
      batch_id: 'b1',
      reservation_id: 'res-1',
      client_request_id: 'req-abc',
      wizard_run_id: 'run-1',
    });
    assert.deepEqual(keys, {
      batchId: 'b1',
      reservationId: 'res-1',
      clientRequestId: 'req-abc',
      wizardRunId: 'run-1',
      // COND-3: the reader also reports which source answered, so an operator
      // can tell live columns from a metadata fallback without reading the flag.
      correlationSource: 'columns',
      columnMetadataMismatch: false,
    });
  });

  it('falls back to metadata when the columns do not exist yet', () => {
    // This is the state the feature ships in: migration 100 unapplied, flag OFF.
    const c = withResolvedIds(makeCorrelation({ reservationId: 'res-1' }), { batchId: 'b1' });
    const keys = readRowCorrelationKeys({
      batch_id: 'b1',
      metadata: { [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(c) },
    });

    assert.equal(keys.reservationId, 'res-1', 'correlation works with no schema change');
    assert.equal(keys.clientRequestId, 'req-abc');
    assert.equal(keys.wizardRunId, c.wizardRunId);
  });

  it('prefers columns over metadata once both exist', () => {
    const keys = readRowCorrelationKeys({
      reservation_id: 'from-column',
      metadata: { [RUN_CORRELATION_METADATA_KEY]: { reservation_id: 'from-metadata' } },
    });
    assert.equal(keys.reservationId, 'from-column');
  });

  it('tolerates malformed or absent metadata without throwing', () => {
    for (const metadata of [undefined, null, 'text', 42, {}, { run_correlation: 'nope' }]) {
      const keys = readRowCorrelationKeys({ batch_id: 'b1', metadata });
      assert.equal(keys.batchId, 'b1');
      assert.equal(keys.reservationId, null);
    }
  });
});

describe('E. matchUsageRowToRun — precedence', () => {
  const correlation = withResolvedIds(makeCorrelation({ reservationId: 'res-1' }), {
    batchId: 'batch-1',
  });

  it('matches on reservation_id first', () => {
    const m = matchUsageRowToRun({ batch_id: 'batch-1', reservation_id: 'res-1' }, correlation);
    assert.deepEqual(m, { matched: true, matchedOn: 'reservation_id' });
  });

  it('falls back to client_request_id', () => {
    const m = matchUsageRowToRun({ client_request_id: 'req-abc' }, correlation);
    assert.deepEqual(m, { matched: true, matchedOn: 'client_request_id' });
  });

  it('falls back to batch_id for rows written before the correlation existed', () => {
    const m = matchUsageRowToRun({ batch_id: 'batch-1' }, correlation);
    assert.deepEqual(m, { matched: true, matchedOn: 'batch_id' });
  });

  it('does not match a row with no shared key', () => {
    const m = matchUsageRowToRun({ batch_id: 'other-batch' }, correlation);
    assert.equal(m.matched, false);
  });

  it('never consults a timestamp', () => {
    // A row carrying only time information cannot be claimed.
    const m = matchUsageRowToRun(
      { metadata: { created_at: '2026-07-30T22:00:00Z' } } as never,
      correlation,
    );
    assert.equal(m.matched, false);
  });
});

describe('F. matchUsageRowToRun — contradiction is the concurrent-run case', () => {
  const correlation = withResolvedIds(makeCorrelation({ reservationId: 'res-1' }), {
    batchId: 'batch-1',
  });

  it('rejects a row sharing the batch but paid by another reservation', () => {
    const m = matchUsageRowToRun(
      { batch_id: 'batch-1', reservation_id: 'res-2' },
      correlation,
    );
    assert.deepEqual(m, { matched: false, reason: 'contradicts_correlation' });
  });

  it('rejects a row from another client request', () => {
    const m = matchUsageRowToRun(
      { batch_id: 'batch-1', client_request_id: 'req-other' },
      correlation,
    );
    assert.equal(m.matched, false);
  });

  it('rejects a row from another wizard run', () => {
    const m = matchUsageRowToRun({ batch_id: 'batch-1', wizard_run_id: 'other' }, correlation);
    assert.equal(m.matched, false);
  });

  it('two concurrent runs never claim each other rows', () => {
    const runA = withResolvedIds(
      buildWizardRunCorrelation({ ...BASE, clientRequestId: 'req-A', reservationId: 'res-A' }),
      { batchId: 'shared-batch' },
    );
    const runB = withResolvedIds(
      buildWizardRunCorrelation({ ...BASE, clientRequestId: 'req-B', reservationId: 'res-B' }),
      { batchId: 'shared-batch' },
    );

    const rowOfA = { batch_id: 'shared-batch', reservation_id: 'res-A', client_request_id: 'req-A' };

    assert.equal(matchUsageRowToRun(rowOfA, runA).matched, true);
    assert.equal(matchUsageRowToRun(rowOfA, runB).matched, false);
  });
});

describe('G. Fingerprint detects a replayed id with different parameters', () => {
  it('same run id + different fingerprint is detectable', () => {
    const original = makeCorrelation({ reservationId: 'res-1' });
    const replayed = makeCorrelation({
      reservationId: 'res-1',
      requestSignature: 'MX|v2|ind-2|sub-2|20',
    });

    assert.equal(original.wizardRunId, replayed.wizardRunId);
    assert.notEqual(original.requestFingerprint, replayed.requestFingerprint);
    assert.equal(
      replayed.requestFingerprint,
      buildWizardRequestFingerprint(BASE.providerKey, 'MX|v2|ind-2|sub-2|20'),
    );
  });
});
