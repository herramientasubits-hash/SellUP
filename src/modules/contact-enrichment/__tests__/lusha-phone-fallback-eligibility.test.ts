// Tests for lusha-phone-fallback-eligibility.ts (Agente 2A ·
// LUSHA-PHONE-FALLBACK-1S). Pure logic: no network, no DB, no providers, no
// env. Node.js built-in test runner.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateLushaPhoneFallbackEligibility,
  LUSHA_PHONE_FALLBACK_ELIGIBILITY_GATE_ORDER,
  type LushaPhoneFallbackEligibilityInput,
} from '../lusha-phone-fallback-eligibility';

function fullyEligibleInput(): LushaPhoneFallbackEligibilityInput {
  return {
    candidateStatus: 'pending',
    candidateReviewStatus: null,
    candidateArchivedAt: null,
    phoneRevealStatus: 'no_phone_found',
    hasExistingPhone: false,
    hasLushaContactId: true,
    lushaContactIdReuseConfirmed: true,
    lushaPhoneEntitlementConfirmed: true,
    featureFlagEnabled: true,
    actorRole: 'admin',
    hasConfirmedCost: true,
    isBulkAction: false,
  };
}

describe('evaluateLushaPhoneFallbackEligibility — gate order is complete', () => {
  test('gate order lists every blocking reason exactly once, excluding eligible', () => {
    const unique = new Set(LUSHA_PHONE_FALLBACK_ELIGIBILITY_GATE_ORDER);
    assert.equal(unique.size, LUSHA_PHONE_FALLBACK_ELIGIBILITY_GATE_ORDER.length);
    assert.ok(!unique.has('eligible'), 'eligible is a terminal success value, not a gate');
  });
});

describe('evaluateLushaPhoneFallbackEligibility — individual gates', () => {
  test('feature flag OFF blocks with feature_disabled', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      featureFlagEnabled: false,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'feature_disabled');
  });

  test('non-admin role blocks with unauthorized_role', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      actorRole: 'commercial_manager',
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'unauthorized_role');
  });

  test('null role blocks with unauthorized_role', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      actorRole: null,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'unauthorized_role');
  });

  test('bulk action blocks with bulk_not_allowed', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      isBulkAction: true,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'bulk_not_allowed');
  });

  test('archived candidate blocks with candidate_not_editable', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      candidateArchivedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'candidate_not_editable');
  });

  test('approved review status blocks with candidate_not_editable', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      candidateReviewStatus: 'approved',
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'candidate_not_editable');
  });

  test('rejected candidate status blocks with candidate_not_editable', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      candidateStatus: 'rejected',
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'candidate_not_editable');
  });

  test('phone_reveal_status other than no_phone_found blocks with apollo_not_exhausted', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      phoneRevealStatus: 'requested',
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'apollo_not_exhausted');
  });

  test('null phone_reveal_status blocks with apollo_not_exhausted', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      phoneRevealStatus: null,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'apollo_not_exhausted');
  });

  test('phone_reveal_status = no_phone_found lets evaluation continue past this gate', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      phoneRevealStatus: 'no_phone_found',
    });
    assert.notEqual(result.reasonCode, 'apollo_not_exhausted');
  });

  test('existing phone blocks with existing_phone_present', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      hasExistingPhone: true,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'existing_phone_present');
  });

  test('missing Lusha contact id blocks with missing_lusha_contact_id', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      hasLushaContactId: false,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'missing_lusha_contact_id');
  });

  test('both ticket questions unconfirmed blocks with waiting_lusha_ticket', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      lushaContactIdReuseConfirmed: false,
      lushaPhoneEntitlementConfirmed: false,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'waiting_lusha_ticket');
  });

  test('id reuse unconfirmed (entitlement confirmed) blocks with lusha_id_reuse_unconfirmed', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      lushaContactIdReuseConfirmed: false,
      lushaPhoneEntitlementConfirmed: true,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'lusha_id_reuse_unconfirmed');
  });

  test('entitlement unconfirmed (id reuse confirmed) blocks with entitlement_unconfirmed', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      lushaContactIdReuseConfirmed: true,
      lushaPhoneEntitlementConfirmed: false,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'entitlement_unconfirmed');
  });

  test('missing cost confirmation blocks with missing_cost_confirmation', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      hasConfirmedCost: false,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'missing_cost_confirmation');
  });

  test('every gate passing → eligible', () => {
    const result = evaluateLushaPhoneFallbackEligibility(fullyEligibleInput());
    assert.equal(result.eligible, true);
    assert.equal(result.reasonCode, 'eligible');
  });
});

describe('evaluateLushaPhoneFallbackEligibility — precedence', () => {
  test('feature_disabled wins over every other simultaneous violation', () => {
    const result = evaluateLushaPhoneFallbackEligibility({
      ...fullyEligibleInput(),
      featureFlagEnabled: false,
      actorRole: null,
      isBulkAction: true,
      hasExistingPhone: true,
    });
    assert.equal(result.reasonCode, 'feature_disabled');
  });
});
