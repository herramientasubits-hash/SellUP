/**
 * Tests — Provider Attribution (17B.4X.6C, §23)
 *
 * Attribution comes ONLY from distinct provider_usage_logs.provider_key
 * joined via agent_run_id. No fallback to candidate.source, providers_used,
 * or summary.discovery_mode.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveProviderAttribution } from '../aggregators';

function usage(providerKey: string) {
  return { providerKey };
}

describe('deriveProviderAttribution', () => {
  it('TEST 1 — one Apollo usage row → attributed apollo', () => {
    const result = deriveProviderAttribution([usage('apollo')]);
    assert.equal(result.state, 'attributed');
    assert.equal(result.providerKey, 'apollo');
  });

  it('TEST 2 — Apollo people_search + Apollo person_match → still one attributed Apollo run', () => {
    const result = deriveProviderAttribution([usage('apollo'), usage('apollo')]);
    assert.equal(result.state, 'attributed');
    assert.equal(result.providerKey, 'apollo');
  });

  it('TEST 3 — Apollo + Lusha usage rows on same run → ambiguous', () => {
    const result = deriveProviderAttribution([usage('apollo'), usage('lusha')]);
    assert.equal(result.state, 'ambiguous');
    assert.equal(result.providerKey, null);
  });

  it('TEST 4 — zero usage rows → unattributed', () => {
    const result = deriveProviderAttribution([]);
    assert.equal(result.state, 'unattributed');
    assert.equal(result.providerKey, null);
  });

  it('TEST 5 — candidate.source = lusha but zero usage rows → remains unattributed (no fallback)', () => {
    // deriveProviderAttribution never sees candidate.source at all — this
    // test documents that the function signature has no such input.
    const result = deriveProviderAttribution([]);
    assert.equal(result.state, 'unattributed');
  });
});
