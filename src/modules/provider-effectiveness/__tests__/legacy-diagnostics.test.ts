/**
 * Tests — Legacy Provider-Execution-Without-Usage Diagnostics (17B.4X.6C, §31)
 *
 * These classify unattributed runs against exact persisted content patterns
 * proven live in 17B.4X.6B. They are diagnostics only — matching one never
 * changes a run's ProviderAttributionState away from 'unattributed'.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isCanonicalG7Pattern,
  isLegacyLushaProviderErrorPattern,
  isLegacyApolloZeroUsagePattern,
  isLegacyProviderExecutionWithoutUsage,
  deriveProviderAttribution,
} from '../aggregators';

describe('legacy provider-execution-without-usage diagnostics', () => {
  it('TEST 54 — canonical G7 persisted shape → canonicalG7RunCount+1, legacy+1, remains unattributed', () => {
    const run = {
      summary: { discovery_mode: 'company_first_discovery', search_status: 'no_results' },
      providersUsed: ['lusha'],
      usage: [],
    };
    assert.equal(isCanonicalG7Pattern(run), true);
    assert.equal(isLegacyProviderExecutionWithoutUsage(run), true);
    assert.equal(deriveProviderAttribution(run.usage).state, 'unattributed');
  });

  it('TEST 55 — legacy Lusha provider_error zero-usage shape → legacy+1, canonicalG7 unchanged, remains unattributed', () => {
    const run = {
      summary: { search_status: 'provider_error' },
      providersUsed: ['lusha'],
      usage: [],
    };
    assert.equal(isCanonicalG7Pattern(run), false);
    assert.equal(isLegacyLushaProviderErrorPattern(run), true);
    assert.equal(isLegacyProviderExecutionWithoutUsage(run), true);
    assert.equal(deriveProviderAttribution(run.usage).state, 'unattributed');
  });

  it('TEST 56 — legacy Apollo no-contacts zero-usage shape → legacy+1, remains unattributed', () => {
    const run = {
      summary: { apollo_enrichment: { status: 'success' }, no_contacts_found: true },
      providersUsed: [],
      usage: [],
    };
    assert.equal(isLegacyApolloZeroUsagePattern(run), true);
    assert.equal(isLegacyProviderExecutionWithoutUsage(run), true);
    assert.equal(deriveProviderAttribution(run.usage).state, 'unattributed');
  });

  it('TEST 57 — ready_to_enrich, zero usage, no persisted markers → unattributed, NOT a legacy diagnostic', () => {
    const run = { summary: null, providersUsed: [], usage: [] };
    assert.equal(isLegacyProviderExecutionWithoutUsage(run), false);
    assert.equal(isCanonicalG7Pattern(run), false);
    assert.equal(deriveProviderAttribution(run.usage).state, 'unattributed');
  });

  it('TEST 58 — superseded, zero usage, no provider evidence → NOT a provider-executed diagnostic', () => {
    const run = { summary: { some_unrelated_key: true }, providersUsed: [], usage: [] };
    assert.equal(isLegacyProviderExecutionWithoutUsage(run), false);
  });

  it('canonical G7 requires lusha in providers_used even with matching summary markers', () => {
    const run = {
      summary: { discovery_mode: 'company_first_discovery', search_status: 'no_results' },
      providersUsed: [],
      usage: [],
    };
    assert.equal(isCanonicalG7Pattern(run), false);
  });

  it('legacy patterns never fire when usage rows exist (attribution already resolved)', () => {
    const run = {
      summary: { discovery_mode: 'company_first_discovery', search_status: 'no_results' },
      providersUsed: ['lusha'],
      usage: [{ providerKey: 'lusha' }],
    };
    assert.equal(isLegacyProviderExecutionWithoutUsage(run), false);
  });
});
