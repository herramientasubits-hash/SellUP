// Tests for lusha-phone-fallback-core.ts (Agente 2A · LUSHA-PHONE-FALLBACK-1).
// Pure logic with injected deps: NO network, NO DB, NO real Lusha calls.
// Node.js built-in test runner.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runLushaPhoneFallbackReveal,
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  type LushaPhoneFallbackActionInput,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';

const NOW_ISO = '2026-07-31T00:00:00.000Z';

function baseCandidate(
  overrides: Partial<LushaPhoneFallbackCandidateRecord> = {},
): LushaPhoneFallbackCandidateRecord {
  return {
    id: 'candidate-1',
    status: 'pending_review',
    source: 'lusha',
    sourceContactId: 'v1.abcdef1234567890',
    existingPhone: null,
    phoneRevealStatus: 'no_phone_found',
    phoneRevealAttemptCount: 0,
    enrichmentMetadata: {},
    ...overrides,
  };
}

function baseInput(overrides: Partial<LushaPhoneFallbackActionInput> = {}): LushaPhoneFallbackActionInput {
  return {
    candidateId: 'candidate-1',
    confirmCost: true,
    ...overrides,
  };
}

interface TestDepsOverrides {
  flagEnabled?: boolean;
  roleKey?: string | null;
  candidate?: LushaPhoneFallbackCandidateRecord | null;
  lushaResult?: LushaPhoneFallbackClientResult;
}

function buildDeps(overrides: TestDepsOverrides = {}): {
  deps: LushaPhoneFallbackCoreDeps;
  persisted: Array<{ candidateId: string; patch: LushaPhoneFallbackPersistencePatch }>;
  logged: LushaPhoneFallbackUsageLogEntry[];
  calledLusha: boolean;
  loadedCandidate: boolean;
} {
  const persisted: Array<{ candidateId: string; patch: LushaPhoneFallbackPersistencePatch }> = [];
  const logged: LushaPhoneFallbackUsageLogEntry[] = [];
  const state = { calledLusha: false, loadedCandidate: false };

  const candidate = overrides.candidate === undefined ? baseCandidate() : overrides.candidate;
  const lushaResult: LushaPhoneFallbackClientResult =
    overrides.lushaResult ??
    ({
      ok: true,
      httpStatus: 200,
      phoneNumber: '+10000000000',
      phoneType: 'unknown',
      phoneRawType: null,
      creditsCharged: 1,
      candidateStatus: 'revealed',
      usageStatus: 'success',
      costSource: 'reported',
      errorCode: null,
      availabilitySource: null,
      phonesReturned: 1,
    } as LushaPhoneFallbackClientResult);

  const deps: LushaPhoneFallbackCoreDeps = {
    flagEnabled: overrides.flagEnabled ?? true,
    actor: { internalUserId: 'user-1', roleKey: overrides.roleKey === undefined ? 'admin' : overrides.roleKey },
    nowIso: NOW_ISO,
    loadCandidate: async () => {
      state.loadedCandidate = true;
      return candidate;
    },
    callLusha: async () => {
      state.calledLusha = true;
      return lushaResult;
    },
    persist: async (candidateId, patch) => {
      persisted.push({ candidateId, patch });
    },
    logUsage: async (entry) => {
      logged.push(entry);
    },
  };

  return {
    deps,
    persisted,
    logged,
    get calledLusha() {
      return state.calledLusha;
    },
    get loadedCandidate() {
      return state.loadedCandidate;
    },
  };
}

describe('runLushaPhoneFallbackReveal — fail-fast gates (no DB, no Lusha call)', () => {
  test('flag OFF → feature_disabled, never loads candidate or calls Lusha', async () => {
    const t = buildDeps({ flagEnabled: false });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'feature_disabled');
    assert.equal(t.loadedCandidate, false);
    assert.equal(t.calledLusha, false);
    assert.equal(t.persisted.length, 0);
    assert.equal(t.logged.length, 0);
  });

  test('non-admin role → unauthorized_role, never loads candidate', async () => {
    const t = buildDeps({ roleKey: 'commercial_manager' });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'unauthorized_role');
    assert.equal(t.loadedCandidate, false);
  });

  test('null role → unauthorized_role', async () => {
    const t = buildDeps({ roleKey: null });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'unauthorized_role');
  });

  test('missing candidateId → invalid_candidate, never loads candidate', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(baseInput({ candidateId: '' }), t.deps);
    assert.equal(result.status, 'invalid_candidate');
    assert.equal(t.loadedCandidate, false);
  });

  test('candidate not found → candidate_not_found, never calls Lusha', async () => {
    const t = buildDeps({ candidate: null });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'candidate_not_found');
    assert.equal(t.calledLusha, false);
  });
});

describe('runLushaPhoneFallbackReveal — eligibility gate (via evaluateLushaPhoneFallbackEligibility)', () => {
  test('candidate not from Lusha (Apollo-sourced) → missing_lusha_contact_id, never calls Lusha', async () => {
    const t = buildDeps({ candidate: baseCandidate({ source: 'apollo', sourceContactId: 'apollo-person-id' }) });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'missing_lusha_contact_id');
    assert.equal(t.calledLusha, false);
  });

  test('missing source_contact_id on a Lusha candidate → missing_lusha_contact_id', async () => {
    const t = buildDeps({ candidate: baseCandidate({ sourceContactId: null }) });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'missing_lusha_contact_id');
  });

  test('phone_reveal_status other than no_phone_found → apollo_not_exhausted', async () => {
    const t = buildDeps({ candidate: baseCandidate({ phoneRevealStatus: 'requested' }) });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'apollo_not_exhausted');
    assert.equal(t.calledLusha, false);
  });

  test('existing phone present → existing_phone_present', async () => {
    const t = buildDeps({ candidate: baseCandidate({ existingPhone: '+10000000000' }) });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'existing_phone_present');
  });

  test('approved candidate (terminal) → candidate_not_editable', async () => {
    const t = buildDeps({ candidate: baseCandidate({ status: 'approved' }) });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'candidate_not_editable');
  });

  test('discarded candidate (terminal) → candidate_not_editable', async () => {
    const t = buildDeps({ candidate: baseCandidate({ status: 'discarded' }) });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.status, 'candidate_not_editable');
  });

  test('confirmCost !== true → missing_cost_confirmation, never calls Lusha', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(baseInput({ confirmCost: false }), t.deps);
    assert.equal(result.status, 'missing_cost_confirmation');
    assert.equal(t.calledLusha, false);
  });

  test('confirmCost !== true is blocked even when the cap is accepted', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: false, expectedMaxCredits: LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS }),
      t.deps,
    );
    assert.equal(result.status, 'missing_cost_confirmation');
    assert.equal(t.calledLusha, false);
  });

  test('expectedMaxCredits below the default cap → missing_cost_confirmation', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ expectedMaxCredits: 0 }),
      t.deps,
    );
    assert.equal(result.status, 'missing_cost_confirmation');
  });
});

/**
 * SPEND-CAP-FIX: Lusha support confirmed a successful phone reveal charges 5
 * credits (previously modelled as 1). The cap is the operator's confirmation
 * threshold — a caller accepting less is blocked, never silently downgraded.
 */
describe('runLushaPhoneFallbackReveal — credit cap is 5 (Lusha support confirmed)', () => {
  test('the default cap is exactly 5 credits', () => {
    assert.equal(LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS, 5);
  });

  for (const belowCap of [1, 2, 4, 4.9, 0, -1]) {
    test(`expectedMaxCredits = ${belowCap} (< 5) → missing_cost_confirmation, never calls Lusha`, async () => {
      const t = buildDeps();
      const result = await runLushaPhoneFallbackReveal(
        baseInput({ confirmCost: true, expectedMaxCredits: belowCap }),
        t.deps,
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, 'missing_cost_confirmation');
      assert.equal(t.calledLusha, false);
      assert.equal(t.persisted.length, 0);
      assert.equal(t.logged.length, 0);
    });
  }

  test('expectedMaxCredits = 5 with confirmCost → proceeds when the other gates pass', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: true, expectedMaxCredits: 5 }),
      t.deps,
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');
    assert.equal(t.calledLusha, true);
  });

  test('expectedMaxCredits above the cap (e.g. 10) is accepted, not clamped down', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: true, expectedMaxCredits: 10 }),
      t.deps,
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');
  });

  test('omitting expectedMaxCredits falls back to the 5-credit cap and proceeds', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');
  });

  test('a non-finite expectedMaxCredits falls back to the cap instead of bypassing it', async () => {
    const t = buildDeps();
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: true, expectedMaxCredits: Number.NaN }),
      t.deps,
    );
    // NaN is not finite → the default 5 applies, so the gate passes on the cap
    // (never because NaN slipped through a comparison).
    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');
  });

  test('the cap never suppresses the flag gate: flag OFF still blocks first', async () => {
    const t = buildDeps({ flagEnabled: false });
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: true, expectedMaxCredits: 5 }),
      t.deps,
    );
    assert.equal(result.status, 'feature_disabled');
    assert.equal(t.loadedCandidate, false);
    assert.equal(t.calledLusha, false);
  });

  test('the cap never suppresses the role gate: non-admin still blocked', async () => {
    const t = buildDeps({ roleKey: 'commercial_manager' });
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: true, expectedMaxCredits: 5 }),
      t.deps,
    );
    assert.equal(result.status, 'unauthorized_role');
    assert.equal(t.calledLusha, false);
  });

  test('the real billed cost still comes from the provider, not from the cap', async () => {
    const t = buildDeps({
      lushaResult: {
        ok: true,
        httpStatus: 200,
        phoneNumber: '+10000000000',
        phoneType: 'unknown',
        phoneRawType: null,
        creditsCharged: 5,
        candidateStatus: 'revealed',
        usageStatus: 'success',
        costSource: 'reported',
        errorCode: null,
        availabilitySource: null,
        phonesReturned: 1,
      } as LushaPhoneFallbackClientResult,
    });
    const result = await runLushaPhoneFallbackReveal(
      baseInput({ confirmCost: true, expectedMaxCredits: 5 }),
      t.deps,
    );
    assert.equal(result.status, 'revealed');
    assert.equal(t.persisted[0].patch.phone_reveal_cost_credits, 5);
    assert.equal(t.persisted[0].patch.phone_reveal_cost_source, 'reported');
    assert.equal(t.logged[0].creditsUsed, 5);
  });
});

describe('runLushaPhoneFallbackReveal — bulk is structurally impossible', () => {
  test('candidateId is always a single scalar id, never an array (compile-time + runtime)', async () => {
    const t = buildDeps();
    // @ts-expect-error — candidateId must be a string, never an array (no bulk).
    const result = await runLushaPhoneFallbackReveal(baseInput({ candidateId: ['a', 'b'] }), t.deps);
    assert.equal(result.ok, false);
  });
});

describe('runLushaPhoneFallbackReveal — success paths persist + log correctly', () => {
  test('revealed: persists phone + lusha_reveal source, logs reported credits', async () => {
    const t = buildDeps({
      lushaResult: {
        ok: true,
        httpStatus: 200,
        phoneNumber: '+10000000000',
        phoneType: 'mobile',
        phoneRawType: 'mobile',
        creditsCharged: 1,
        candidateStatus: 'revealed',
        usageStatus: 'success',
        costSource: 'reported',
        errorCode: null,
        availabilitySource: null,
        phonesReturned: 1,
      } as LushaPhoneFallbackClientResult,
    });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');

    assert.equal(t.persisted.length, 1);
    const patch = t.persisted[0].patch;
    assert.equal(patch.phone, '+10000000000');
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.phone_reveal_provider, 'lusha');
    assert.equal(patch.phone_reveal_cost_credits, 1);
    assert.equal(patch.phone_reveal_cost_source, 'reported');
    assert.equal(patch.phone_reveal_attempt_count, 1);
    assert.equal(patch.enrichment_metadata?.phone?.source, 'lusha_reveal');
    assert.equal(patch.enrichment_metadata?.phone?.type, 'mobile');

    assert.equal(t.logged.length, 1);
    assert.equal(t.logged[0].status, 'success');
    assert.equal(t.logged[0].creditsUsed, 1);
    assert.equal(t.logged[0].provider, 'lusha');
    assert.equal(t.logged[0].operationKey, 'lusha_person_phone_reveal');
    // Metadata is PII-free: no phone/email/linkedin/name in the log entry.
    assert.equal(JSON.stringify(t.logged[0].metadata).includes('+10000000000'), false);
  });

  test('no_phone_found: does not touch phone column, logs 0 credits (reported)', async () => {
    const t = buildDeps({
      lushaResult: {
        ok: true,
        httpStatus: 200,
        phoneNumber: null,
        phoneType: 'unknown',
        phoneRawType: null,
        creditsCharged: 0,
        candidateStatus: 'no_phone_found',
        usageStatus: 'success',
        costSource: 'reported',
        errorCode: null,
        availabilitySource: null,
        phonesReturned: 0,
      } as LushaPhoneFallbackClientResult,
    });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_phone_found');

    const patch = t.persisted[0].patch;
    assert.equal(patch.phone, undefined);
    assert.equal(patch.enrichment_metadata, undefined);
    assert.equal(patch.phone_reveal_status, 'no_phone_found');
    assert.equal(patch.phone_reveal_cost_credits, 0);

    assert.equal(t.logged[0].creditsUsed, 0);
  });

  test('network/timeout failure: error status, never assumes 0 credits', async () => {
    const t = buildDeps({ lushaResult: { ok: false, errorMessage: 'timeout', failureKind: 'timeout' as const } });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'provider_network_error');

    const patch = t.persisted[0].patch;
    assert.equal(patch.phone_reveal_cost_credits, null);
    assert.equal(patch.phone_reveal_cost_source, 'unknown');
    assert.equal(t.logged[0].creditsUsed, null);
  });

  for (const [httpErrorCode, expectedUsageStatus] of [
    ['insufficient_credits', 'quota_exceeded'],
    ['rate_limited', 'rate_limited'],
    ['invalid_contact_id', 'error'],
    ['provider_auth_error', 'error'],
    ['provider_permission_error', 'error'],
    ['provider_error', 'error'],
    ['malformed_provider_response', 'error'],
  ] as const) {
    test(`HTTP error mapping ${httpErrorCode}: persists error, never assumes 0 credits`, async () => {
      const t = buildDeps({
        lushaResult: {
          ok: true,
          httpStatus: 0,
          phoneNumber: null,
          phoneType: 'unknown',
          phoneRawType: null,
          creditsCharged: null,
          candidateStatus: 'error',
          usageStatus: expectedUsageStatus,
          costSource: null,
          errorCode: httpErrorCode,
          availabilitySource: null,
          phonesReturned: 0,
        } as LushaPhoneFallbackClientResult,
      });
      const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
      assert.equal(result.ok, false);
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, httpErrorCode);

      const patch = t.persisted[0].patch;
      assert.equal(patch.phone_reveal_cost_credits, null);
      assert.equal(patch.phone_reveal_cost_source, 'unknown');
      assert.equal(patch.phone_reveal_error_code, httpErrorCode);
      assert.equal(t.logged[0].creditsUsed, null);
    });
  }

  test('revealed without a phone number (defensive) → treated as malformed, not persisted as a phone', async () => {
    const t = buildDeps({
      lushaResult: {
        ok: true,
        httpStatus: 200,
        phoneNumber: null,
        phoneType: 'unknown',
        phoneRawType: null,
        creditsCharged: 1,
        candidateStatus: 'revealed',
        usageStatus: 'success',
        costSource: 'reported',
        errorCode: null,
        availabilitySource: null,
        phonesReturned: 1,
      } as LushaPhoneFallbackClientResult,
    });
    const result = await runLushaPhoneFallbackReveal(baseInput(), t.deps);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'malformed_provider_response');
    assert.equal(t.persisted[0].patch.phone, undefined);
  });
});

describe('runLushaPhoneFallbackReveal — no HubSpot, no Apollo, no waterfall/search', () => {
  test('deps never expose a HubSpot or Apollo call surface', () => {
    const t = buildDeps();
    const depsKeys = Object.keys(t.deps);
    assert.deepEqual(
      depsKeys.sort(),
      ['actor', 'callLusha', 'flagEnabled', 'loadCandidate', 'logUsage', 'nowIso', 'persist'].sort(),
    );
  });
});
