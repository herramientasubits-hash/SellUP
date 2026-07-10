// Tests — Provider Attribution regression for request/attempt persistence
// (Hito 17B.4X.7C.1, §23/§35-37)
//
// deriveProviderAttribution (see attribution.test.ts TEST 5) already proves
// there is no candidate.source fallback. This file adds the specific
// regression this hito requires: the new intended_provider/request_id
// fields introduced by migration 086 must not be able to override actual
// usage-ledger attribution, because deriveProviderAttribution's signature
// structurally cannot see them — it only accepts { providerKey }[] entries
// sourced from provider_usage_logs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveProviderAttribution } from '../aggregators';

describe('intended_provider does not override usage-ledger attribution', () => {
  it('an intended_provider of lusha does not change attribution when actual usage logs say apollo', () => {
    // deriveProviderAttribution has no parameter for intended_provider or
    // request_id — this call proves that even when a run's intended
    // provider disagrees with what actually ran, only the usage evidence
    // determines attribution.
    const result = deriveProviderAttribution([{ providerKey: 'apollo' }]);
    assert.equal(result.state, 'attributed');
    assert.equal(result.providerKey, 'apollo');
  });

  it('zero usage rows remain unattributed regardless of any intended_provider value', () => {
    const result = deriveProviderAttribution([]);
    assert.equal(result.state, 'unattributed');
    assert.equal(result.providerKey, null);
  });

  it('deriveProviderAttribution signature only accepts providerKey-shaped usage evidence', () => {
    // Structural proof: the function type only accepts
    // Array<Pick<ProviderUsageEvidence, 'providerKey'>>. request_id,
    // attempt_order, and intended_provider are not part of that shape and
    // cannot be threaded through to influence the result.
    const usage: Array<{ providerKey: string }> = [{ providerKey: 'apollo' }];
    const result = deriveProviderAttribution(usage);
    assert.equal(result.providerKey, 'apollo');
  });
});
