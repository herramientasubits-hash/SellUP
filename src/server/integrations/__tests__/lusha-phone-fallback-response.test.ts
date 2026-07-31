// Tests for lusha-phone-fallback-response.ts (Agente 2A ·
// LUSHA-PHONE-FALLBACK-1S). Pure logic: no network, no DB, no env.
// Node.js built-in test runner.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mapLushaPhoneRevealResponseToInternalStatus } from '../lusha-phone-fallback-response';

describe('mapLushaPhoneRevealResponseToInternalStatus — 200 success shapes', () => {
  test('200 + phones + creditsCharged > 0 → revealed / success / reported', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [{ number: '+000000000' }] }],
      billing: { creditsCharged: 1 },
    });
    assert.deepEqual(result, {
      candidateStatus: 'revealed',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: null,
      phonesReturned: 1,
    });
  });

  test('200 + phones + creditsCharged = 0 → revealed / success / reported / already_available', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [{ number: '+000000000' }] }],
      billing: { creditsCharged: 0 },
    });
    assert.deepEqual(result, {
      candidateStatus: 'revealed',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: 'already_available',
      phonesReturned: 1,
    });
  });

  test('200 + no phones + creditsCharged = 0 → no_phone_found / success / reported', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [] }],
      billing: { creditsCharged: 0 },
    });
    assert.deepEqual(result, {
      candidateStatus: 'no_phone_found',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: null,
      phonesReturned: 0,
    });
  });

  test('200 + missing results array + creditsCharged = 0 → no_phone_found', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      billing: { creditsCharged: 0 },
    });
    assert.equal(result.candidateStatus, 'no_phone_found');
    assert.equal(result.phonesReturned, 0);
  });
});

describe('mapLushaPhoneRevealResponseToInternalStatus — HTTP error statuses', () => {
  test('402 → error / quota_exceeded / insufficient_credits', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(402, {});
    assert.deepEqual(result, {
      candidateStatus: 'error',
      usageStatus: 'quota_exceeded',
      costSource: null,
      errorCode: 'insufficient_credits',
      availabilitySource: null,
      phonesReturned: 0,
    });
  });

  test('429 → error / rate_limited / rate_limited', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(429, {});
    assert.equal(result.candidateStatus, 'error');
    assert.equal(result.usageStatus, 'rate_limited');
    assert.equal(result.errorCode, 'rate_limited');
  });

  test('404 → error / error / invalid_contact_id', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(404, {});
    assert.equal(result.candidateStatus, 'error');
    assert.equal(result.usageStatus, 'error');
    assert.equal(result.errorCode, 'invalid_contact_id');
  });

  test('401 → error / error / provider_auth_error', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(401, {});
    assert.equal(result.candidateStatus, 'error');
    assert.equal(result.usageStatus, 'error');
    assert.equal(result.errorCode, 'provider_auth_error');
  });

  test('500 → error / error / provider_error', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(500, {});
    assert.equal(result.errorCode, 'provider_error');
  });

  test('503 → error / error / provider_error', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(503, {});
    assert.equal(result.errorCode, 'provider_error');
  });
});

describe('mapLushaPhoneRevealResponseToInternalStatus — malformed payloads', () => {
  test('200 + null body → malformed_provider_response', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, null);
    assert.equal(result.candidateStatus, 'error');
    assert.equal(result.errorCode, 'malformed_provider_response');
  });

  test('200 + non-object body → malformed_provider_response', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, 'unexpected string body');
    assert.equal(result.errorCode, 'malformed_provider_response');
  });

  test('200 + missing billing.creditsCharged → malformed_provider_response (never assumes 0)', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [] }],
    });
    assert.equal(result.errorCode, 'malformed_provider_response');
  });

  test('200 + non-numeric creditsCharged → malformed_provider_response', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [] }],
      billing: { creditsCharged: 'free' as unknown as number },
    });
    assert.equal(result.errorCode, 'malformed_provider_response');
  });

  test('200 + negative creditsCharged → malformed_provider_response', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [] }],
      billing: { creditsCharged: -1 },
    });
    assert.equal(result.errorCode, 'malformed_provider_response');
  });

  test('200 + no phones but creditsCharged > 0 (undocumented shape) → malformed_provider_response', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(200, {
      results: [{ phones: [] }],
      billing: { creditsCharged: 1 },
    });
    assert.equal(result.errorCode, 'malformed_provider_response');
  });

  test('unexpected HTTP status (e.g. 418) → malformed_provider_response', () => {
    const result = mapLushaPhoneRevealResponseToInternalStatus(418, {});
    assert.equal(result.errorCode, 'malformed_provider_response');
  });
});
