/**
 * Tests — Routing Observation Policy Validation (17B.4X.7A, § 22)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateRoutingObservationPolicyV1 } from '../policy-evaluator';
import type { RoutingObservationPolicyDraftV1 } from '../types';

function draft(overrides: Partial<RoutingObservationPolicyDraftV1> = {}): RoutingObservationPolicyDraftV1 {
  return {
    mode: 'observe_only',
    policyVersion: 1,
    candidatePrimaryProvider: 'apollo',
    fallbackProvider: 'lusha',
    enabledFallbackReasons: ['provider_error', 'zero_reviewable_candidates'],
    maxProviderAttempts: 2,
    ...overrides,
  };
}

describe('validateRoutingObservationPolicyV1', () => {
  it('TEST 1 — Apollo primary, Lusha fallback → valid policy', () => {
    const result = validateRoutingObservationPolicyV1(draft());
    assert.equal(result.valid, true);
  });

  it('TEST 2 — same provider as primary and fallback → rejected', () => {
    const result = validateRoutingObservationPolicyV1(
      draft({ candidatePrimaryProvider: 'apollo', fallbackProvider: 'apollo' }),
    );
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'primary_equals_fallback'));
  });

  it('TEST 3 — policyVersion 0 → rejected', () => {
    const result = validateRoutingObservationPolicyV1(draft({ policyVersion: 0 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_policy_version'));
  });

  it('TEST 4 — policyVersion decimal → rejected', () => {
    const result = validateRoutingObservationPolicyV1(draft({ policyVersion: 1.5 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_policy_version'));
  });

  it('TEST 5 — maxProviderAttempts != 2 → rejected', () => {
    const result = validateRoutingObservationPolicyV1(draft({ maxProviderAttempts: 3 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_max_provider_attempts'));
  });

  it('TEST 6 — duplicate fallback reasons → deterministically rejected', () => {
    const result = validateRoutingObservationPolicyV1(
      draft({ enabledFallbackReasons: ['provider_error', 'provider_error'] }),
    );
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'duplicate_fallback_reason'));
  });

  it('TEST 7 — invalid primary provider string → rejected', () => {
    const result = validateRoutingObservationPolicyV1(draft({ candidatePrimaryProvider: 'hunter' }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_primary_provider'));
  });

  it('TEST 8 — invalid fallback provider string → rejected', () => {
    const result = validateRoutingObservationPolicyV1(draft({ fallbackProvider: 'hunter' }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_fallback_provider'));
  });

  it('TEST 9 — unknown fallback reason string → rejected', () => {
    const result = validateRoutingObservationPolicyV1(
      draft({ enabledFallbackReasons: ['rate_limited' as never] }),
    );
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_fallback_reason'));
  });

  it('TEST 10 — NaN policyVersion → rejected, not silently coerced', () => {
    const result = validateRoutingObservationPolicyV1(draft({ policyVersion: NaN }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_policy_version'));
  });

  it('TEST 25 — candidate primary Apollo → accepted', () => {
    const result = validateRoutingObservationPolicyV1(
      draft({ candidatePrimaryProvider: 'apollo', fallbackProvider: 'lusha' }),
    );
    assert.equal(result.valid, true);
  });

  it('TEST 26 — candidate primary Lusha → accepted (no hardcoded provider winner)', () => {
    const result = validateRoutingObservationPolicyV1(
      draft({ candidatePrimaryProvider: 'lusha', fallbackProvider: 'apollo' }),
    );
    assert.equal(result.valid, true);
  });

  it('empty enabledFallbackReasons is a valid policy (no reasons enabled)', () => {
    const result = validateRoutingObservationPolicyV1(draft({ enabledFallbackReasons: [] }));
    assert.equal(result.valid, true);
  });

  it('TEST 23 — enabledFallbackReasons order differs but semantic set identical → same validity', () => {
    const a = validateRoutingObservationPolicyV1(
      draft({ enabledFallbackReasons: ['provider_error', 'zero_reviewable_candidates'] }),
    );
    const b = validateRoutingObservationPolicyV1(
      draft({ enabledFallbackReasons: ['zero_reviewable_candidates', 'provider_error'] }),
    );
    assert.equal(a.valid, true);
    assert.equal(b.valid, true);
  });
});
