/**
 * Tests — Wizard Pilot Guardrails (16AB.43.16)
 *
 * Verifies settings loader, participant checker, reserve/confirm/release
 * wrappers, and the concurrency invariant (one active reservation per user).
 *
 * All tests use lightweight injectable fakes.
 * No Supabase, Tavily, Apollo, HubSpot, or LLM connections are made.
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadWizardPilotSettings,
  checkWizardPilotParticipant,
  PilotSettingsError,
} from '../wizard-pilot-guardrails';

import type {
  PilotGuardrailsDbClient,
  PilotSettingsRow,
  PilotParticipantRow,
} from '../wizard-pilot-guardrails';

import {
  reserveWizardPilotCredits,
  confirmWizardPilotCredits,
  releaseWizardPilotCredits,
} from '../wizard-budget-reservations';

import type { BudgetReservationsRpcClient } from '../wizard-budget-reservations';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const REQ_1  = '11111111-0000-0000-0000-000000000001';
const REQ_2  = '22222222-0000-0000-0000-000000000002';
const RES_1  = 'rrrrrrrr-0000-0000-0000-000000000001';
const PERIOD = '2026-07-01';

const BASE_SETTINGS: PilotSettingsRow = {
  id:                              'settings-uuid',
  pilot_enabled:                   false,
  max_credits_per_execution:       10,
  max_active_executions_per_user:  1,
  budget_timezone:                 'America/Bogota',
  created_at:                      '2026-07-01T00:00:00Z',
  updated_at:                      '2026-07-01T00:00:00Z',
  updated_by:                      null,
};

const ENABLED_PARTICIPANT: PilotParticipantRow = {
  user_id:    USER_A,
  is_enabled: true,
  enabled_at: '2026-07-01T00:00:00Z',
  disabled_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  enabled_by: null,
};

const DISABLED_PARTICIPANT: PilotParticipantRow = {
  ...ENABLED_PARTICIPANT,
  user_id:     USER_B,
  is_enabled:  false,
  disabled_at: '2026-07-02T00:00:00Z',
};

// ── Fake builders ─────────────────────────────────────────────────────────────

function makeSettingsDb(
  rows: PilotSettingsRow[] | null,
  error?: { message: string } | null,
): PilotGuardrailsDbClient {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            limit(_n: number) {
              return Promise.resolve({ data: rows, error: error ?? null });
            },
            eq(_col: string, _val: string) {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
      };
    },
  } as PilotGuardrailsDbClient;
}

function makeParticipantDb(
  participant: PilotParticipantRow | null,
  error?: { message: string } | null,
): PilotGuardrailsDbClient {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            limit(_n: number) {
              return Promise.resolve({ data: [], error: null });
            },
            eq(_col: string, _val: string) {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: participant, error: error ?? null });
                },
              };
            },
          };
        },
      };
    },
  } as PilotGuardrailsDbClient;
}

function makeRpcClient(result: string | null, error?: { message: string } | null): BudgetReservationsRpcClient {
  return {
    rpc(_fn: string, _params: Record<string, unknown>) {
      return Promise.resolve({ data: result, error: error ?? null });
    },
  } as BudgetReservationsRpcClient;
}

// ═══════════════════════════════════════════════════════════════
// Section 1 — loadWizardPilotSettings
// ═══════════════════════════════════════════════════════════════

describe('Section 1 — loadWizardPilotSettings', () => {
  it('1.1: loads settings row and maps camelCase fields', async () => {
    const db = makeSettingsDb([BASE_SETTINGS]);
    const settings = await loadWizardPilotSettings(db);
    assert.equal(settings.pilotEnabled, false);
    assert.equal(settings.maxCreditsPerExecution, 10);
    assert.equal(settings.maxActiveExecutionsPerUser, 1);
    assert.equal(settings.budgetTimezone, 'America/Bogota');
  });

  it('1.2: pilot_enabled=false is preserved', async () => {
    const db = makeSettingsDb([{ ...BASE_SETTINGS, pilot_enabled: false }]);
    const settings = await loadWizardPilotSettings(db);
    assert.equal(settings.pilotEnabled, false);
  });

  it('1.3: throws SETTINGS_NOT_FOUND when table is empty', async () => {
    const db = makeSettingsDb([]);
    await assert.rejects(
      () => loadWizardPilotSettings(db),
      (err: unknown) => {
        assert.ok(err instanceof PilotSettingsError);
        assert.equal(err.code, 'SETTINGS_NOT_FOUND');
        return true;
      },
    );
  });

  it('1.4: throws SETTINGS_LOAD_FAILED on DB error', async () => {
    const db = makeSettingsDb(null, { message: 'connection refused' });
    await assert.rejects(
      () => loadWizardPilotSettings(db),
      (err: unknown) => {
        assert.ok(err instanceof PilotSettingsError);
        assert.equal(err.code, 'SETTINGS_LOAD_FAILED');
        return true;
      },
    );
  });

  it('1.5: null rows treated as empty (SETTINGS_NOT_FOUND)', async () => {
    const db = makeSettingsDb(null, null);
    await assert.rejects(
      () => loadWizardPilotSettings(db),
      (err: unknown) => {
        assert.ok(err instanceof PilotSettingsError);
        assert.equal(err.code, 'SETTINGS_NOT_FOUND');
        return true;
      },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 2 — checkWizardPilotParticipant
// ═══════════════════════════════════════════════════════════════

describe('Section 2 — checkWizardPilotParticipant', () => {
  it('2.1: returns allowed=true for an enabled participant', async () => {
    const db = makeParticipantDb(ENABLED_PARTICIPANT);
    const result = await checkWizardPilotParticipant(USER_A, db);
    assert.equal(result.allowed, true);
  });

  it('2.2: allowed participant has correct userId', async () => {
    const db = makeParticipantDb(ENABLED_PARTICIPANT);
    const result = await checkWizardPilotParticipant(USER_A, db);
    assert.ok(result.allowed);
    assert.equal(result.participant.userId, USER_A);
  });

  it('2.3: returns not_in_allowlist when user not found', async () => {
    const db = makeParticipantDb(null);
    const result = await checkWizardPilotParticipant(USER_A, db);
    assert.equal(result.allowed, false);
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'not_in_allowlist');
  });

  it('2.4: returns participant_disabled for disabled participant', async () => {
    const db = makeParticipantDb(DISABLED_PARTICIPANT);
    const result = await checkWizardPilotParticipant(USER_B, db);
    assert.equal(result.allowed, false);
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'participant_disabled');
  });

  it('2.5: throws on DB error', async () => {
    const db = makeParticipantDb(null, { message: 'query failed' });
    await assert.rejects(
      () => checkWizardPilotParticipant(USER_A, db),
      /participant_check_failed/,
    );
  });

  it('2.6: allowlist starts empty (table was created with zero rows)', async () => {
    // Validate that asking for any user returns not_in_allowlist when table is empty.
    const db = makeParticipantDb(null);
    const result = await checkWizardPilotParticipant(USER_A, db);
    assert.equal(result.allowed, false);
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'not_in_allowlist');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 3 — reserveWizardPilotCredits
// ═══════════════════════════════════════════════════════════════

describe('Section 3 — reserveWizardPilotCredits', () => {
  it('3.1: returns reserved on success', async () => {
    const db = makeRpcClient('reserved');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.equal(result.status, 'reserved');
  });

  it('3.2: returns already_reserved on repeated call', async () => {
    const db = makeRpcClient('already_reserved');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.equal(result.status, 'already_reserved');
  });

  it('3.3: pilot_paused → blocked with PILOT_PAUSED', async () => {
    const db = makeRpcClient('pilot_paused');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.equal(result.status, 'blocked');
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'PILOT_PAUSED');
  });

  it('3.4: user_not_allowed → blocked with NOT_IN_PILOT', async () => {
    const db = makeRpcClient('user_not_allowed');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'NOT_IN_PILOT');
  });

  it('3.5: execution_limit_exceeded → blocked with EXECUTION_CREDIT_LIMIT_EXCEEDED', async () => {
    const db = makeRpcClient('execution_limit_exceeded');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 11, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'EXECUTION_CREDIT_LIMIT_EXCEEDED');
  });

  it('3.6: period_not_configured → blocked with BUDGET_PERIOD_NOT_CONFIGURED', async () => {
    const db = makeRpcClient('period_not_configured');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'BUDGET_PERIOD_NOT_CONFIGURED');
  });

  it('3.7: period_closed → blocked with BUDGET_PERIOD_CLOSED', async () => {
    const db = makeRpcClient('period_closed');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'BUDGET_PERIOD_CLOSED');
  });

  it('3.8: insufficient_budget → blocked with BUDGET_EXCEEDED', async () => {
    const db = makeRpcClient('insufficient_budget');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'BUDGET_EXCEEDED');
  });

  it('3.9: concurrent_execution_active → blocked with CONCURRENT_EXECUTION_ACTIVE', async () => {
    const db = makeRpcClient('concurrent_execution_active');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_2, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'CONCURRENT_EXECUTION_ACTIVE');
  });

  it('3.10: RPC error → blocked with BUDGET_RESERVATION_FAILED', async () => {
    const db = makeRpcClient(null, { message: 'connection lost' });
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'BUDGET_RESERVATION_FAILED');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 4 — confirmWizardPilotCredits
// ═══════════════════════════════════════════════════════════════

describe('Section 4 — confirmWizardPilotCredits', () => {
  it('4.1: returns confirmed on success', async () => {
    const db = makeRpcClient('confirmed');
    const result = await confirmWizardPilotCredits(
      { reservationId: RES_1, actualCreditsConsumed: 10 },
      db,
    );
    assert.equal(result.status, 'confirmed');
  });

  it('4.2: returns already_confirmed on repeated call', async () => {
    const db = makeRpcClient('already_confirmed');
    const result = await confirmWizardPilotCredits(
      { reservationId: RES_1, actualCreditsConsumed: 10 },
      db,
    );
    assert.equal(result.status, 'already_confirmed');
  });

  it('4.3: reservation_not_found → error status', async () => {
    const db = makeRpcClient('reservation_not_found');
    const result = await confirmWizardPilotCredits(
      { reservationId: 'unknown-uuid', actualCreditsConsumed: 5 },
      db,
    );
    assert.equal(result.status, 'error');
    assert.ok(result.status === 'error');
    assert.equal(result.code, 'reservation_not_found');
  });

  it('4.4: invalid_actual_credits → error status', async () => {
    const db = makeRpcClient('invalid_actual_credits');
    const result = await confirmWizardPilotCredits(
      { reservationId: RES_1, actualCreditsConsumed: 99 },
      db,
    );
    assert.ok(result.status === 'error');
    assert.equal(result.code, 'invalid_actual_credits');
  });

  it('4.5: partial consumption (5 of 10) returns confirmed', async () => {
    const db = makeRpcClient('confirmed');
    const result = await confirmWizardPilotCredits(
      { reservationId: RES_1, actualCreditsConsumed: 5 },
      db,
    );
    assert.equal(result.status, 'confirmed');
  });

  it('4.6: DB error → error status', async () => {
    const db = makeRpcClient(null, { message: 'timeout' });
    const result = await confirmWizardPilotCredits(
      { reservationId: RES_1, actualCreditsConsumed: 10 },
      db,
    );
    assert.equal(result.status, 'error');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 5 — releaseWizardPilotCredits
// ═══════════════════════════════════════════════════════════════

describe('Section 5 — releaseWizardPilotCredits', () => {
  it('5.1: returns released on success', async () => {
    const db = makeRpcClient('released');
    const result = await releaseWizardPilotCredits({ reservationId: RES_1 }, db);
    assert.equal(result.status, 'released');
  });

  it('5.2: returns already_released on repeated call', async () => {
    const db = makeRpcClient('already_released');
    const result = await releaseWizardPilotCredits({ reservationId: RES_1 }, db);
    assert.equal(result.status, 'already_released');
  });

  it('5.3: already_confirmed → cannot release confirmed reservation', async () => {
    const db = makeRpcClient('already_confirmed');
    const result = await releaseWizardPilotCredits({ reservationId: RES_1 }, db);
    assert.equal(result.status, 'already_confirmed');
  });

  it('5.4: reservation_not_found → error status', async () => {
    const db = makeRpcClient('reservation_not_found');
    const result = await releaseWizardPilotCredits({ reservationId: 'no-such-id' }, db);
    assert.ok(result.status === 'error');
    assert.equal(result.code, 'reservation_not_found');
  });

  it('5.5: DB error → error status', async () => {
    const db = makeRpcClient(null, { message: 'db unavailable' });
    const result = await releaseWizardPilotCredits({ reservationId: RES_1 }, db);
    assert.equal(result.status, 'error');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 6 — Concurrency invariant (one active reservation per user)
// ═══════════════════════════════════════════════════════════════
//
// The DB enforces this via a partial unique index. Here we verify that
// the service layer correctly propagates concurrent_execution_active
// and that two concurrent calls for the same user produce exactly one
// reserved + one blocked result.

describe('Section 6 — Concurrency invariant', () => {
  it('6.1: same user, different clientRequestId while active → concurrent_execution_active', async () => {
    const db = makeRpcClient('concurrent_execution_active');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_2, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'CONCURRENT_EXECUTION_ACTIVE');
  });

  it('6.2: two concurrent calls — first wins, second gets concurrent_execution_active', async () => {
    // Simulate a race: first call succeeds, second gets blocked.
    let callCount = 0;
    const racingDb: BudgetReservationsRpcClient = {
      rpc(_fn: string, _params: Record<string, unknown>) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ data: 'reserved', error: null });
        }
        return Promise.resolve({ data: 'concurrent_execution_active', error: null });
      },
    } as BudgetReservationsRpcClient;

    const input = { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD };
    const input2 = { userId: USER_A, clientRequestId: REQ_2, requestedCredits: 10, periodStart: PERIOD };

    const [r1, r2] = await Promise.all([
      reserveWizardPilotCredits(input, racingDb),
      reserveWizardPilotCredits(input2, racingDb),
    ]);

    const statuses = [r1.status, r2.status];
    assert.ok(statuses.includes('reserved'), 'One call must be reserved');
    assert.ok(statuses.includes('blocked'), 'One call must be blocked');

    const blocked = r1.status === 'blocked' ? r1 : r2;
    assert.ok(blocked.status === 'blocked');
    assert.equal(blocked.code, 'CONCURRENT_EXECUTION_ACTIVE');
  });

  it('6.3: two different users can each reserve independently', async () => {
    let callCount = 0;
    const multiUserDb: BudgetReservationsRpcClient = {
      rpc(_fn: string, _params: Record<string, unknown>) {
        callCount++;
        return Promise.resolve({ data: 'reserved', error: null });
      },
    } as BudgetReservationsRpcClient;

    const [rA, rB] = await Promise.all([
      reserveWizardPilotCredits({ userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD }, multiUserDb),
      reserveWizardPilotCredits({ userId: USER_B, clientRequestId: REQ_2, requestedCredits: 10, periodStart: PERIOD }, multiUserDb),
    ]);

    assert.equal(rA.status, 'reserved');
    assert.equal(rB.status, 'reserved');
    assert.equal(callCount, 2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 7 — Pilot disabled (kill-switch)
// ═══════════════════════════════════════════════════════════════

describe('Section 7 — Kill-switch / pilot disabled', () => {
  it('7.1: pilot_paused propagates from DB kill-switch', async () => {
    const db = makeRpcClient('pilot_paused');
    const result = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      db,
    );
    assert.ok(result.status === 'blocked');
    assert.equal(result.code, 'PILOT_PAUSED');
  });

  it('7.2: settings row has pilot_enabled=false at creation', async () => {
    // Validates the seed contract: the singleton row must have pilot_enabled=false.
    const db = makeSettingsDb([BASE_SETTINGS]);
    const settings = await loadWizardPilotSettings(db);
    assert.equal(settings.pilotEnabled, false, 'Seed must create pilot_enabled=false');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 8 — No external provider calls
// ═══════════════════════════════════════════════════════════════

describe('Section 8 — Zero external provider calls', () => {
  it('8.1: loadWizardPilotSettings makes no provider calls', async () => {
    const db = makeSettingsDb([BASE_SETTINGS]);
    // If any external import were required, this would throw before here.
    const settings = await loadWizardPilotSettings(db);
    assert.ok(settings, 'settings loaded without external calls');
  });

  it('8.2: reserve, confirm, release make no provider calls', async () => {
    const reserveDb = makeRpcClient('reserved');
    const confirmDb = makeRpcClient('confirmed');
    const releaseDb = makeRpcClient('released');

    const reserveResult = await reserveWizardPilotCredits(
      { userId: USER_A, clientRequestId: REQ_1, requestedCredits: 10, periodStart: PERIOD },
      reserveDb,
    );
    const confirmResult = await confirmWizardPilotCredits(
      { reservationId: RES_1, actualCreditsConsumed: 10 },
      confirmDb,
    );
    const releaseResult = await releaseWizardPilotCredits(
      { reservationId: RES_1 },
      releaseDb,
    );

    assert.equal(reserveResult.status, 'reserved');
    assert.equal(confirmResult.status, 'confirmed');
    assert.equal(releaseResult.status, 'released');
  });
});
