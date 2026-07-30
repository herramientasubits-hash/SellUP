/**
 * Tests — apollo-spend-observability.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * Pagination and quota headers used to reach provider_usage_logs only on the
 * terminal-error path, so the runs that actually spent money were the ones we
 * could explain least. The invariant these tests defend is the one that makes
 * the record trustworthy: an absent header is recorded as absent (null), never
 * as 0 — "we did not receive it" and "the quota is exhausted" are different
 * facts.
 *
 * A. Full record
 * B. Absent inputs stay null
 * C. Zero is preserved as a real value
 * D. Non-finite values degrade to null
 * E. Rate-limit snapshot mapping
 * F. Metadata projection and safety
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_SPEND_OBSERVABILITY_KEY,
  buildApolloSpendObservabilityRecord,
  toApolloSpendObservabilityMetadata,
} from '../apollo-spend-observability';
import type { ApolloRateLimitSnapshot } from '@/server/integrations/apollo-rate-limit-headers';

function rateLimit(
  overrides: Partial<ApolloRateLimitSnapshot> = {},
): ApolloRateLimitSnapshot {
  return {
    minute: { window: 'minute', used: 5, remaining: 45, limit: 50 },
    hourly: { window: 'hourly', used: 100, remaining: 100, limit: 200 },
    daily: { window: 'daily', used: 500, remaining: 500, limit: 1000 },
    retryAfterSeconds: null,
    anyHeaderPresent: true,
    ...overrides,
  };
}

// ── A. Full record ────────────────────────────────────────────────────────────

describe('A — a fully populated record', () => {
  it('A1: every supplied value is carried through', () => {
    const record = buildApolloSpendObservabilityRecord({
      httpStatus: 200,
      latencyMs: 812,
      page: 1,
      perPage: 10,
      paginationPage: 1,
      paginationTotalPages: 4,
      paginationTotalEntries: 37,
      resultsReturned: 10,
      rateLimit: rateLimit({ retryAfterSeconds: 30 }),
      billingState: 'recorded',
      estimatedCredits: 3,
      recordedUsageCredits: 4,
    });

    assert.deepEqual(record, {
      httpStatus: 200,
      latencyMs: 812,
      page: 1,
      perPage: 10,
      paginationPage: 1,
      paginationTotalPages: 4,
      paginationTotalEntries: 37,
      resultsReturned: 10,
      rateLimitMinute: 50,
      rateLimitMinuteRemaining: 45,
      rateLimitHourly: 200,
      rateLimitHourlyRemaining: 100,
      rateLimit24Hour: 1000,
      rateLimit24HourRemaining: 500,
      retryAfter: 30,
      billingState: 'recorded',
      estimatedCredits: 3,
      recordedUsageCredits: 4,
    });
  });

  it('A2: the builder is pure — same input, same record', () => {
    const input = { httpStatus: 200, latencyMs: 10 };
    assert.deepEqual(
      buildApolloSpendObservabilityRecord(input),
      buildApolloSpendObservabilityRecord(input),
    );
  });
});

// ── B. Absent inputs ──────────────────────────────────────────────────────────

describe('B — absent inputs stay null', () => {
  it('B1: an empty input yields a fully null record', () => {
    const record = buildApolloSpendObservabilityRecord({});
    for (const [field, value] of Object.entries(record)) {
      assert.equal(value, null, `${field} must be null when absent`);
    }
  });

  it('B2: an absent quota is null, not 0 — the distinction is the whole point', () => {
    const record = buildApolloSpendObservabilityRecord({ httpStatus: 200 });
    assert.equal(record.rateLimitMinuteRemaining, null);
    assert.notEqual(record.rateLimitMinuteRemaining, 0);
  });

  it('B3: undefined and null inputs behave identically', () => {
    assert.deepEqual(
      buildApolloSpendObservabilityRecord({ latencyMs: undefined, page: undefined }),
      buildApolloSpendObservabilityRecord({ latencyMs: null, page: null }),
    );
  });

  it('B4: an absent billing state is null, never guessed as `recorded`', () => {
    assert.equal(buildApolloSpendObservabilityRecord({}).billingState, null);
  });

  it('B5: a null rate-limit snapshot leaves all six quota fields null', () => {
    const record = buildApolloSpendObservabilityRecord({ rateLimit: null });
    for (const field of [
      'rateLimitMinute',
      'rateLimitMinuteRemaining',
      'rateLimitHourly',
      'rateLimitHourlyRemaining',
      'rateLimit24Hour',
      'rateLimit24HourRemaining',
      'retryAfter',
    ] as const) {
      assert.equal(record[field], null, field);
    }
  });
});

// ── C. Zero is a real value ───────────────────────────────────────────────────

describe('C — a real zero is preserved', () => {
  it('C1: an exhausted quota records 0, not null', () => {
    const record = buildApolloSpendObservabilityRecord({
      rateLimit: rateLimit({
        minute: { window: 'minute', used: 50, remaining: 0, limit: 50 },
      }),
    });
    assert.equal(record.rateLimitMinuteRemaining, 0);
  });

  it('C2: zero results and zero credits are recorded as zero', () => {
    const record = buildApolloSpendObservabilityRecord({
      resultsReturned: 0,
      estimatedCredits: 0,
      recordedUsageCredits: 0,
    });
    assert.equal(record.resultsReturned, 0);
    assert.equal(record.estimatedCredits, 0);
    assert.equal(record.recordedUsageCredits, 0);
  });
});

// ── D. Non-finite values ──────────────────────────────────────────────────────

describe('D — non-finite values degrade to null', () => {
  it('D1: NaN and Infinity become null rather than corrupting the record', () => {
    // JSON has no NaN, so persisting one would produce an unreadable row.
    const record = buildApolloSpendObservabilityRecord({
      latencyMs: Number.NaN,
      paginationTotalEntries: Number.POSITIVE_INFINITY,
      estimatedCredits: Number.NEGATIVE_INFINITY,
    });
    assert.equal(record.latencyMs, null);
    assert.equal(record.paginationTotalEntries, null);
    assert.equal(record.estimatedCredits, null);
  });

  it('D2: the record is always JSON round-trippable', () => {
    const record = buildApolloSpendObservabilityRecord({ latencyMs: Number.NaN });
    assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
  });
});

// ── E. Rate-limit mapping ─────────────────────────────────────────────────────

describe('E — rate-limit snapshot mapping', () => {
  it('E1: each window maps to its own pair of fields', () => {
    const record = buildApolloSpendObservabilityRecord({ rateLimit: rateLimit() });
    assert.equal(record.rateLimitMinute, 50);
    assert.equal(record.rateLimitHourly, 200);
    assert.equal(record.rateLimit24Hour, 1000);
  });

  it('E2: a partially populated snapshot keeps the missing windows null', () => {
    const record = buildApolloSpendObservabilityRecord({
      rateLimit: rateLimit({
        hourly: { window: 'hourly', used: null, remaining: null, limit: null },
      }),
    });
    assert.equal(record.rateLimitMinute, 50);
    assert.equal(record.rateLimitHourly, null);
    assert.equal(record.rateLimitHourlyRemaining, null);
  });

  it('E3: retryAfter is read from the snapshot, not invented', () => {
    assert.equal(
      buildApolloSpendObservabilityRecord({ rateLimit: rateLimit() }).retryAfter,
      null,
    );
    assert.equal(
      buildApolloSpendObservabilityRecord({
        rateLimit: rateLimit({ retryAfterSeconds: 120 }),
      }).retryAfter,
      120,
    );
  });
});

// ── F. Metadata projection ────────────────────────────────────────────────────

describe('F — metadata projection', () => {
  it('F1: projects every field to snake_case, preserving nulls', () => {
    const record = buildApolloSpendObservabilityRecord({
      httpStatus: 429,
      perPage: 10,
      rateLimit: rateLimit({ retryAfterSeconds: 60 }),
      billingState: 'unknown',
    });
    const metadata = toApolloSpendObservabilityMetadata(record);

    assert.equal(metadata.http_status, 429);
    assert.equal(metadata.per_page, 10);
    assert.equal(metadata.rate_limit_minute_remaining, 45);
    assert.equal(metadata.rate_limit_24_hour, 1000);
    assert.equal(metadata.retry_after, 60);
    assert.equal(metadata.billing_state, 'unknown');
    assert.equal(metadata.latency_ms, null);
  });

  it('F2: the projection has one key per record field', () => {
    const record = buildApolloSpendObservabilityRecord({});
    const metadata = toApolloSpendObservabilityMetadata(record);
    assert.equal(Object.keys(metadata).length, Object.keys(record).length);
  });

  it('F3: every key is snake_case — no camelCase leaks into the DB shape', () => {
    for (const key of Object.keys(
      toApolloSpendObservabilityMetadata(buildApolloSpendObservabilityRecord({})),
    )) {
      assert.match(key, /^[a-z0-9_]+$/, key);
    }
  });

  it('F4: the record carries no secret, header value or query text', () => {
    const metadata = toApolloSpendObservabilityMetadata(
      buildApolloSpendObservabilityRecord({ httpStatus: 401, rateLimit: rateLimit() }),
    );
    const keys = Object.keys(metadata).join(' ');
    for (const forbidden of ['api_key', 'authorization', 'token', 'query', 'error_body']) {
      assert.ok(!keys.includes(forbidden), `metadata must not carry ${forbidden}`);
    }
    // Numbers and one enum only — no free-form strings that could carry a payload.
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null) continue;
      if (key === 'billing_state') {
        assert.ok(
          (['unknown', 'estimated', 'recorded', 'provider_confirmed'] as unknown[]).includes(
            value,
          ),
        );
        continue;
      }
      assert.equal(typeof value, 'number', key);
    }
  });

  it('F5: the metadata key is stable', () => {
    assert.equal(APOLLO_SPEND_OBSERVABILITY_KEY, 'apollo_spend_observability');
  });
});
