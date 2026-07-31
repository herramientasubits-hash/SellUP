/**
 * Tests — apollo-spend-observability.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * Pagination and quota headers used to reach provider_usage_logs only on the
 * terminal-error path, so the runs that actually spent money were the ones we
 * could say least about. The contract these tests pin: one shape for both
 * paths, and an absent header recorded as null — never as 0.
 *
 * Pure module: no network, no header reading of its own.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ApolloRateLimitSnapshot } from '@/server/integrations/apollo-rate-limit-headers';
import {
  APOLLO_SPEND_OBSERVABILITY_KEY,
  buildApolloSpendObservabilityRecord,
  toApolloSpendObservabilityMetadata,
} from '../apollo-spend-observability';

function snapshot(over: Partial<ApolloRateLimitSnapshot> = {}): ApolloRateLimitSnapshot {
  return {
    minute: { window: 'minute', used: 5, remaining: 195, limit: 200 },
    hourly: { window: 'hourly', used: 10, remaining: 5990, limit: 6000 },
    daily: { window: 'daily', used: 20, remaining: 49980, limit: 50000 },
    retryAfterSeconds: null,
    anyHeaderPresent: true,
    ...over,
  };
}

describe('A. Success path persists pagination and quota', () => {
  it('captures every pagination field', () => {
    const record = buildApolloSpendObservabilityRecord({
      page: 1,
      perPage: 3,
      paginationPage: 1,
      paginationTotalPages: 4,
      paginationTotalEntries: 37,
      resultsReturned: 3,
      latencyMs: 412,
    });

    assert.equal(record.page, 1);
    assert.equal(record.perPage, 3);
    assert.equal(record.paginationPage, 1);
    assert.equal(record.paginationTotalPages, 4);
    assert.equal(record.paginationTotalEntries, 37);
    assert.equal(record.resultsReturned, 3);
    assert.equal(record.latencyMs, 412);
  });

  it('captures every rate-limit window', () => {
    const record = buildApolloSpendObservabilityRecord({ rateLimit: snapshot() });

    assert.equal(record.rateLimitMinute, 200);
    assert.equal(record.rateLimitMinuteRemaining, 195);
    assert.equal(record.rateLimitHourly, 6000);
    assert.equal(record.rateLimitHourlyRemaining, 5990);
    assert.equal(record.rateLimit24Hour, 50000);
    assert.equal(record.rateLimit24HourRemaining, 49980);
  });

  it('both paths produce the identical field set', () => {
    const success = buildApolloSpendObservabilityRecord({ resultsReturned: 3, recordedUsageCredits: 3 });
    const terminalError = buildApolloSpendObservabilityRecord({ resultsReturned: 0, recordedUsageCredits: 0 });

    assert.deepEqual(Object.keys(success).sort(), Object.keys(terminalError).sort());
  });
});

describe('B. Absent values are null, never zero', () => {
  it('an empty input yields all-null, not all-zero', () => {
    const record = buildApolloSpendObservabilityRecord({});

    for (const [field, value] of Object.entries(record)) {
      assert.equal(value, null, `${field} must be null when unknown`);
    }
  });

  it('a missing quota header is null while an exhausted quota is 0', () => {
    // These are different facts and must stay distinguishable.
    const absent = buildApolloSpendObservabilityRecord({ rateLimit: null });
    assert.equal(absent.rateLimitMinuteRemaining, null, 'header not received');

    const exhausted = buildApolloSpendObservabilityRecord({
      rateLimit: snapshot({ minute: { window: 'minute', used: 200, remaining: 0, limit: 200 } }),
    });
    assert.equal(exhausted.rateLimitMinuteRemaining, 0, 'quota really is exhausted');
  });

  it('non-finite numbers become null rather than NaN', () => {
    const record = buildApolloSpendObservabilityRecord({
      latencyMs: Number.NaN,
      paginationTotalPages: Number.POSITIVE_INFINITY,
    });

    assert.equal(record.latencyMs, null);
    assert.equal(record.paginationTotalPages, null);
    assert.equal(JSON.parse(JSON.stringify(record)).latency_ms ?? null, null);
  });
});

describe('C. Retry-After', () => {
  it('is captured when the provider sends it', () => {
    const record = buildApolloSpendObservabilityRecord({
      rateLimit: snapshot({ retryAfterSeconds: 30 }),
    });
    assert.equal(record.retryAfter, 30);
  });

  it('is null when absent', () => {
    assert.equal(buildApolloSpendObservabilityRecord({ rateLimit: snapshot() }).retryAfter, null);
    assert.equal(buildApolloSpendObservabilityRecord({}).retryAfter, null);
  });
});

describe('D. Billing state and credits', () => {
  it('records an unknown billing state rather than assuming one', () => {
    assert.equal(buildApolloSpendObservabilityRecord({}).billingState, null);
    assert.equal(
      buildApolloSpendObservabilityRecord({ billingState: 'unknown' }).billingState,
      'unknown',
    );
  });

  it('keeps estimated and recorded credits separate', () => {
    const record = buildApolloSpendObservabilityRecord({
      estimatedCredits: 3,
      recordedUsageCredits: 4,
    });
    assert.equal(record.estimatedCredits, 3);
    assert.equal(record.recordedUsageCredits, 4);
  });
});

describe('E. No secrets are persisted', () => {
  it('the metadata projection contains no credential-shaped keys or values', () => {
    const meta = toApolloSpendObservabilityMetadata(
      buildApolloSpendObservabilityRecord({
        rateLimit: snapshot({ retryAfterSeconds: 12 }),
        page: 1,
        perPage: 3,
        resultsReturned: 3,
        billingState: 'recorded',
        estimatedCredits: 3,
        recordedUsageCredits: 3,
      }),
    );

    const serialized = JSON.stringify(meta).toLowerCase();
    for (const forbidden of [
      'api_key', 'apikey', 'x-api-key', 'authorization', 'bearer',
      'token', 'secret', 'password', 'cookie',
    ]) {
      assert.ok(!serialized.includes(forbidden), `must not contain ${forbidden}`);
    }
  });

  it('every metadata value is a number or null — no free-form strings to leak into', () => {
    const meta = toApolloSpendObservabilityMetadata(
      buildApolloSpendObservabilityRecord({ page: 1, rateLimit: snapshot() }),
    );

    for (const [field, value] of Object.entries(meta)) {
      if (field === 'billing_state') continue; // constrained enum or null
      assert.ok(
        value === null || typeof value === 'number',
        `${field} must be a number or null, got ${typeof value}`,
      );
    }
  });

  it('exposes a stable metadata key', () => {
    assert.equal(APOLLO_SPEND_OBSERVABILITY_KEY, 'spend_observability');
  });
});
