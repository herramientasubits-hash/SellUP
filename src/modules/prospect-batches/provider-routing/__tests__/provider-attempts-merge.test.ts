/**
 * Q3F-5BB.11F.1 — `mergeProviderAttemptsBatchMetadata` (NARROW additive merge).
 *
 * Proves the helper:
 *   1. adds provider_attempts[] additively;
 *   2. NEVER touches provider_routing (or billing / gate_summary /
 *      duplicate_summary / source_enrichment_summary / any other key);
 *   3. returns metadata preserved (no provider_attempts key) when attempts is
 *      empty / undefined;
 *   4. preserves null / unknown counts — never coerces to 0;
 *   5. is immutable (inputs untouched, deep-copied attempts).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeProviderAttemptsBatchMetadata,
  BATCH_PROVIDER_ROUTING_KEY,
  BATCH_PROVIDER_ATTEMPTS_KEY,
} from '../metadata-contract';
import type { ProviderAttemptMetadata } from '../metadata-contract';

function makeAttempt(overrides: Partial<ProviderAttemptMetadata> = {}): ProviderAttemptMetadata {
  return {
    provider: 'apollo',
    role: 'primary',
    status: 'ok',
    raw_count: null,
    normalized_count: null,
    gate_excluded_count: null,
    exact_duplicate_count: null,
    possible_duplicate_count: null,
    persisted_count: null,
    credits_used: null,
    estimated_cost_usd: null,
    pages_requested: null,
    quality_score: null,
    failure_reason: null,
    ...overrides,
  };
}

/** A realistic pre-existing batch metadata with the keys 11F.1 must preserve. */
function makeExistingMetadata(): Record<string, unknown> {
  return {
    [BATCH_PROVIDER_ROUTING_KEY]: {
      contract_version: 'provider_routing_v1',
      selected_provider: 'apollo',
      intended_provider: 'default_ai',
      estimated_cost: { credits_max: 10, usd_max: 0.0875, unknown: false },
    },
    billing: { plan: 'pilot', reserved_credits: 3 },
    gate_summary: { quality_skipped_count: 4 },
    duplicate_summary: { exact: 1, possible: 2 },
    source_enrichment_summary: { enabled: true },
    web_search_provider: 'apollo_organizations',
    request: { country_code: 'CO' },
  };
}

describe('11F.1 mergeProviderAttemptsBatchMetadata — additive attempts only', () => {
  it('adds provider_attempts[] while preserving provider_routing untouched', () => {
    const existing = makeExistingMetadata();
    const routingBefore = existing[BATCH_PROVIDER_ROUTING_KEY];
    const merged = mergeProviderAttemptsBatchMetadata(existing, [makeAttempt()]);

    assert.ok(Array.isArray(merged[BATCH_PROVIDER_ATTEMPTS_KEY]));
    assert.equal((merged[BATCH_PROVIDER_ATTEMPTS_KEY] as unknown[]).length, 1);
    // provider_routing is byte-for-byte the same reference-equal VALUE (never re-derived).
    assert.deepEqual(merged[BATCH_PROVIDER_ROUTING_KEY], routingBefore);
    assert.strictEqual(merged[BATCH_PROVIDER_ROUTING_KEY], existing[BATCH_PROVIDER_ROUTING_KEY]);
  });

  it('preserves billing / gate_summary / duplicate_summary / source_enrichment_summary / request', () => {
    const existing = makeExistingMetadata();
    const merged = mergeProviderAttemptsBatchMetadata(existing, [makeAttempt()]);

    for (const key of [
      'billing',
      'gate_summary',
      'duplicate_summary',
      'source_enrichment_summary',
      'web_search_provider',
      'request',
    ]) {
      assert.deepEqual(merged[key], existing[key], `key ${key} must be preserved`);
    }
  });

  it('does NOT re-touch provider_routing (only provider_attempts is added vs input)', () => {
    const existing = makeExistingMetadata();
    const merged = mergeProviderAttemptsBatchMetadata(existing, [makeAttempt()]);

    const addedKeys = Object.keys(merged).filter((k) => !(k in existing));
    assert.deepEqual(addedKeys, [BATCH_PROVIDER_ATTEMPTS_KEY]);
  });

  it('returns metadata preserved (no provider_attempts key) for empty attempts', () => {
    const existing = makeExistingMetadata();
    const merged = mergeProviderAttemptsBatchMetadata(existing, []);
    assert.equal(BATCH_PROVIDER_ATTEMPTS_KEY in merged, false);
    assert.deepEqual(merged, existing);
  });

  it('returns metadata preserved (no provider_attempts key) for undefined attempts', () => {
    const existing = makeExistingMetadata();
    const merged = mergeProviderAttemptsBatchMetadata(existing, undefined);
    assert.equal(BATCH_PROVIDER_ATTEMPTS_KEY in merged, false);
    assert.deepEqual(merged, existing);
  });

  it('handles null/undefined existing metadata without crashing', () => {
    const mergedNull = mergeProviderAttemptsBatchMetadata(null, [makeAttempt()]);
    const mergedUndef = mergeProviderAttemptsBatchMetadata(undefined, [makeAttempt()]);
    assert.equal((mergedNull[BATCH_PROVIDER_ATTEMPTS_KEY] as unknown[]).length, 1);
    assert.equal((mergedUndef[BATCH_PROVIDER_ATTEMPTS_KEY] as unknown[]).length, 1);
  });

  it('preserves null / unknown counts — never coerces to 0', () => {
    const attempt = makeAttempt({
      raw_count: null,
      normalized_count: null,
      credits_used: null,
      estimated_cost_usd: null,
      persisted_count: 0, // a REAL measured 0 stays 0
    });
    const merged = mergeProviderAttemptsBatchMetadata({}, [attempt]);
    const persisted = (merged[BATCH_PROVIDER_ATTEMPTS_KEY] as ProviderAttemptMetadata[])[0];
    assert.equal(persisted.raw_count, null);
    assert.equal(persisted.normalized_count, null);
    assert.equal(persisted.credits_used, null);
    assert.equal(persisted.estimated_cost_usd, null);
    assert.equal(persisted.persisted_count, 0);
  });

  it('is immutable — inputs are never mutated and attempts are deep-copied', () => {
    const existing = makeExistingMetadata();
    const snapshot = JSON.parse(JSON.stringify(existing));
    const attempt = makeAttempt({ credits_used: 10 });
    const merged = mergeProviderAttemptsBatchMetadata(existing, [attempt]);

    // Existing input untouched.
    assert.deepEqual(existing, snapshot);
    assert.equal(BATCH_PROVIDER_ATTEMPTS_KEY in existing, false);

    // Mutating the persisted attempt does not affect the source attempt.
    const persisted = (merged[BATCH_PROVIDER_ATTEMPTS_KEY] as ProviderAttemptMetadata[])[0];
    persisted.credits_used = 999;
    assert.equal(attempt.credits_used, 10);
  });

  it('preserves attempts order for multiple entries', () => {
    const attempts = [
      makeAttempt({ provider: 'apollo', persisted_count: 1 }),
      makeAttempt({ provider: 'tavily', persisted_count: 2 }),
    ];
    const merged = mergeProviderAttemptsBatchMetadata({}, attempts);
    const persisted = merged[BATCH_PROVIDER_ATTEMPTS_KEY] as ProviderAttemptMetadata[];
    assert.equal(persisted[0].provider, 'apollo');
    assert.equal(persisted[1].provider, 'tavily');
  });
});
