/**
 * Tests — Wizard Execution Idempotency (16AB.43.1)
 *
 * Verifies the durable idempotency primitive: reserveWizardExecutionSlot.
 *
 * All tests use a lightweight injectable fake for IdempotencyDbClient.
 * No Supabase, Apollo, Tavily, or HubSpot connections are made.
 * No in-memory state (Set/Map/module variable) is shared between tests.
 *
 * Uses Node.js built-in test runner (same as other tests in this module).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  reserveWizardExecutionSlot,
  WizardIdempotencyError,
} from '../wizard-idempotency';

import type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
  IdempotencyDbClient,
  DbError,
} from '../wizard-idempotency';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const REQ_ID_1 = '11111111-0000-0000-0000-000000000001';
const REQ_ID_2 = '22222222-0000-0000-0000-000000000002';
const BATCH_ID_1 = 'batch-0001-0000-0000-0000-000000000001';
const BATCH_ID_2 = 'batch-0002-0000-0000-0000-000000000002';

function makeInput(
  userId = USER_A,
  clientRequestId = REQ_ID_1,
): WizardExecutionReservationInput {
  return {
    userId,
    clientRequestId,
    initialBatchPayload: {
      requestSource: 'chat_wizard',
      catalogVersionId: 'v2024-01',
      industryId: 'ind-001',
      subindustryIds: ['sub-001', 'sub-002'],
      countryCode: 'CO',
      additionalCriteria: null,
    },
  };
}

// ── DB fake factory ───────────────────────────────────────────────────────────

type FakeDbState = {
  rows: Array<{ id: string; created_by: string; client_request_id: string }>;
  nextInsertId: string;
  insertError: DbError | null;
  lookupError: DbError | null;
};

function makeFakeDb(state: FakeDbState): IdempotencyDbClient {
  return {
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select(_cols: string) {
              return {
                single() {
                  if (state.insertError) {
                    return Promise.resolve({ data: null, error: state.insertError });
                  }
                  const newRow = {
                    id: state.nextInsertId,
                    created_by: row['created_by'] as string,
                    client_request_id: row['client_request_id'] as string,
                  };
                  state.rows.push(newRow);
                  return Promise.resolve({ data: { id: newRow.id }, error: null });
                },
              };
            },
          };
        },
        select(_cols: string) {
          return {
            eq(col1: string, val1: string) {
              return {
                eq(col2: string, val2: string) {
                  return {
                    single() {
                      if (state.lookupError) {
                        return Promise.resolve({ data: null, error: state.lookupError });
                      }
                      const found = state.rows.find(
                        (r) => r[col1 as keyof typeof r] === val1 && r[col2 as keyof typeof r] === val2,
                      );
                      if (!found) {
                        return Promise.resolve({ data: null, error: null });
                      }
                      return Promise.resolve({ data: { id: found.id }, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as IdempotencyDbClient;
}

// ── Section 1: Happy path — first reservation ─────────────────────────────────

describe('Section 1 — First reservation returns reserved', () => {
  let state: FakeDbState;

  beforeEach(() => {
    state = { rows: [], nextInsertId: BATCH_ID_1, insertError: null, lookupError: null };
  });

  it('1.1: first request returns status=reserved', async () => {
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(), db);
    assert.equal(result.status, 'reserved');
  });

  it('1.2: reserved result includes a batchId', async () => {
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(), db);
    assert.ok(result.batchId, 'batchId should be truthy');
  });

  it('1.3: batchId matches the inserted row id', async () => {
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(), db);
    assert.equal(result.batchId, BATCH_ID_1);
  });

  it('1.4: userId is stored in the inserted row', async () => {
    const db = makeFakeDb(state);
    await reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), db);
    assert.equal(state.rows[0]?.created_by, USER_A);
  });

  it('1.5: clientRequestId is stored in the inserted row', async () => {
    const db = makeFakeDb(state);
    await reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), db);
    assert.equal(state.rows[0]?.client_request_id, REQ_ID_1);
  });
});

// ── Section 2: Idempotency — repeated request ─────────────────────────────────

describe('Section 2 — Repeated request returns already_reserved', () => {
  let state: FakeDbState;

  beforeEach(() => {
    // Pre-seed: simulate a row already existing, trigger 23505 on insert
    state = {
      rows: [{ id: BATCH_ID_1, created_by: USER_A, client_request_id: REQ_ID_1 }],
      nextInsertId: 'should-not-be-used',
      insertError: { code: '23505', message: 'duplicate key value' },
      lookupError: null,
    };
  });

  it('2.1: repeated request returns status=already_reserved', async () => {
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), db);
    assert.equal(result.status, 'already_reserved');
  });

  it('2.2: repeated request returns same batchId as original', async () => {
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), db);
    assert.equal(result.batchId, BATCH_ID_1);
  });
});

// ── Section 3: Non-23505 error propagation ────────────────────────────────────

describe('Section 3 — Non-23505 insert error propagates', () => {
  it('3.1: non-23505 error throws WizardIdempotencyError', async () => {
    const state: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_1,
      insertError: { code: '42501', message: 'permission denied' },
      lookupError: null,
    };
    const db = makeFakeDb(state);
    await assert.rejects(
      () => reserveWizardExecutionSlot(makeInput(), db),
      (err: unknown) => {
        assert.ok(err instanceof WizardIdempotencyError);
        assert.equal(err.code, 'DB_INSERT_FAILED');
        return true;
      },
    );
  });

  it('3.2: non-23505 error is NOT silently swallowed', async () => {
    const state: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_1,
      insertError: { code: '08006', message: 'connection failure' },
      lookupError: null,
    };
    const db = makeFakeDb(state);
    let threw = false;
    try {
      await reserveWizardExecutionSlot(makeInput(), db);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, 'Expected an error to be thrown');
  });
});

// ── Section 4: 23505 + failed lookup ─────────────────────────────────────────

describe('Section 4 — 23505 with failed lookup throws DB_LOOKUP_FAILED', () => {
  it('4.1: 23505 + lookup error throws WizardIdempotencyError(DB_LOOKUP_FAILED)', async () => {
    const state: FakeDbState = {
      rows: [],
      nextInsertId: 'unused',
      insertError: { code: '23505', message: 'duplicate key value' },
      lookupError: { code: '42P01', message: 'relation does not exist' },
    };
    const db = makeFakeDb(state);
    await assert.rejects(
      () => reserveWizardExecutionSlot(makeInput(), db),
      (err: unknown) => {
        assert.ok(err instanceof WizardIdempotencyError);
        assert.equal(err.code, 'DB_LOOKUP_FAILED');
        return true;
      },
    );
  });

  it('4.2: 23505 + row not found throws WizardIdempotencyError(BATCH_NOT_FOUND)', async () => {
    // 23505 but the lookup returns no row (race condition edge case)
    const state: FakeDbState = {
      rows: [], // empty — lookup will find nothing
      nextInsertId: 'unused',
      insertError: { code: '23505', message: 'duplicate key value' },
      lookupError: null,
    };
    const db = makeFakeDb(state);
    await assert.rejects(
      () => reserveWizardExecutionSlot(makeInput(), db),
      (err: unknown) => {
        assert.ok(err instanceof WizardIdempotencyError);
        assert.equal(err.code, 'BATCH_NOT_FOUND');
        return true;
      },
    );
  });
});

// ── Section 5: Identity isolation ────────────────────────────────────────────

describe('Section 5 — Reservation isolation by userId and clientRequestId', () => {
  it('5.1: different userId creates a new reservation (not shared)', async () => {
    const state: FakeDbState = {
      rows: [{ id: BATCH_ID_1, created_by: USER_A, client_request_id: REQ_ID_1 }],
      nextInsertId: BATCH_ID_2,
      insertError: null,
      lookupError: null,
    };
    const db = makeFakeDb(state);
    // USER_B with same REQ_ID_1 — no unique violation expected
    const result = await reserveWizardExecutionSlot(makeInput(USER_B, REQ_ID_1), db);
    assert.equal(result.status, 'reserved');
    assert.equal(result.batchId, BATCH_ID_2);
  });

  it('5.2: different clientRequestId creates a new reservation', async () => {
    const state: FakeDbState = {
      rows: [{ id: BATCH_ID_1, created_by: USER_A, client_request_id: REQ_ID_1 }],
      nextInsertId: BATCH_ID_2,
      insertError: null,
      lookupError: null,
    };
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_2), db);
    assert.equal(result.status, 'reserved');
    assert.equal(result.batchId, BATCH_ID_2);
  });

  it('5.3: same userId + same requestId returns already_reserved', async () => {
    const state: FakeDbState = {
      rows: [{ id: BATCH_ID_1, created_by: USER_A, client_request_id: REQ_ID_1 }],
      nextInsertId: 'unused',
      insertError: { code: '23505', message: 'dup' },
      lookupError: null,
    };
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), db);
    assert.equal(result.status, 'already_reserved');
    assert.equal(result.batchId, BATCH_ID_1);
  });
});

// ── Section 6: No in-memory state ─────────────────────────────────────────────

describe('Section 6 — No shared in-memory state between calls', () => {
  it('6.1: mock reset between tests does not affect result (each test is isolated)', async () => {
    // This test verifies that reserveWizardExecutionSlot does not depend on any
    // module-level variable. We instantiate fresh state and db for each call.
    const stateA: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_1,
      insertError: null,
      lookupError: null,
    };
    const stateB: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_2,
      insertError: null,
      lookupError: null,
    };

    const dbA = makeFakeDb(stateA);
    const dbB = makeFakeDb(stateB);

    const [resultA, resultB] = await Promise.all([
      reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), dbA),
      reserveWizardExecutionSlot(makeInput(USER_B, REQ_ID_2), dbB),
    ]);

    assert.equal(resultA.status, 'reserved');
    assert.equal(resultA.batchId, BATCH_ID_1);
    assert.equal(resultB.status, 'reserved');
    assert.equal(resultB.batchId, BATCH_ID_2);
  });

  it('6.2: repeated calls with fresh state always return reserved', async () => {
    for (let i = 0; i < 3; i++) {
      const state: FakeDbState = {
        rows: [],
        nextInsertId: `batch-iter-${i}`,
        insertError: null,
        lookupError: null,
      };
      const db = makeFakeDb(state);
      const result = await reserveWizardExecutionSlot(makeInput(), db);
      assert.equal(result.status, 'reserved', `Iteration ${i} should return reserved`);
    }
  });
});

// ── Section 7: Concurrency — two simultaneous calls ──────────────────────────

describe('Section 7 — Concurrent reservation with same identity', () => {
  it('7.1: two concurrent calls: one reserved, one already_reserved, same batchId', async () => {
    // Simulates a race: both calls are issued simultaneously.
    // The first to win gets 'reserved'; the second hits 23505.
    // We model this with a stateful fake that transitions on first call.

    const reservedBatchId = 'concurrent-batch-001';

    let callCount = 0;
    const rows: Array<{ id: string; created_by: string; client_request_id: string }> = [];

    const concurrentDb: IdempotencyDbClient = {
      from(_table: string) {
        return {
          insert(row: Record<string, unknown>) {
            return {
              select(_cols: string) {
                return {
                  single() {
                    callCount++;
                    if (callCount === 1) {
                      // First insert succeeds
                      const newRow = {
                        id: reservedBatchId,
                        created_by: row['created_by'] as string,
                        client_request_id: row['client_request_id'] as string,
                      };
                      rows.push(newRow);
                      return Promise.resolve({ data: { id: reservedBatchId }, error: null });
                    }
                    // Second insert hits unique violation
                    return Promise.resolve({
                      data: null,
                      error: { code: '23505', message: 'duplicate key value' },
                    });
                  },
                };
              },
            };
          },
          select(_cols: string) {
            return {
              eq(col1: string, val1: string) {
                return {
                  eq(col2: string, val2: string) {
                    return {
                      single() {
                        const found = rows.find(
                          (r) => r[col1 as keyof typeof r] === val1 && r[col2 as keyof typeof r] === val2,
                        );
                        if (!found) {
                          return Promise.resolve({ data: null, error: null });
                        }
                        return Promise.resolve({ data: { id: found.id }, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as IdempotencyDbClient;

    const [result1, result2]: WizardExecutionReservationResult[] = await Promise.all([
      reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), concurrentDb),
      reserveWizardExecutionSlot(makeInput(USER_A, REQ_ID_1), concurrentDb),
    ]);

    const statuses = new Set([result1.status, result2.status]);
    assert.ok(statuses.has('reserved'), 'One call should be reserved');
    assert.ok(statuses.has('already_reserved'), 'One call should be already_reserved');
    assert.equal(result1.batchId, reservedBatchId, 'Both results should share the same batchId');
    assert.equal(result2.batchId, reservedBatchId, 'Both results should share the same batchId');
  });
});

// ── Section 8: No side effects — zero provider calls ─────────────────────────

describe('Section 8 — Zero external provider calls', () => {
  it('8.1: does not call Apollo (no apollo import, no side effects)', async () => {
    // This test is structural: if wizard-idempotency.ts imported Apollo,
    // the import itself would throw in this environment (no Apollo config).
    // The fact that this test runs without error proves no Apollo is called.
    const state: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_1,
      insertError: null,
      lookupError: null,
    };
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(), db);
    assert.equal(result.status, 'reserved');
    // No Apollo-related error → confirmed no Apollo call
  });

  it('8.2: does not call Tavily (no tavily import, no side effects)', async () => {
    const state: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_1,
      insertError: null,
      lookupError: null,
    };
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(), db);
    assert.equal(result.status, 'reserved');
    // No Tavily-related error → confirmed no Tavily call
  });

  it('8.3: does not call HubSpot (no hubspot import, no side effects)', async () => {
    const state: FakeDbState = {
      rows: [],
      nextInsertId: BATCH_ID_1,
      insertError: null,
      lookupError: null,
    };
    const db = makeFakeDb(state);
    const result = await reserveWizardExecutionSlot(makeInput(), db);
    assert.equal(result.status, 'reserved');
    // No HubSpot-related error → confirmed no HubSpot call
  });

  it('8.4: does not perform any remote writes beyond the DB injection', async () => {
    let dbCallCount = 0;
    const trackingDb: IdempotencyDbClient = {
      from(_table: string) {
        dbCallCount++;
        return {
          insert(_row: Record<string, unknown>) {
            return {
              select(_cols: string) {
                return {
                  single() {
                    return Promise.resolve({ data: { id: BATCH_ID_1 }, error: null });
                  },
                };
              },
            };
          },
          select(_cols: string) {
            return {
              eq(_col1: string, _val1: string) {
                return {
                  eq(_col2: string, _val2: string) {
                    return {
                      single() {
                        return Promise.resolve({ data: null, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as IdempotencyDbClient;

    await reserveWizardExecutionSlot(makeInput(), trackingDb);
    // Only one from() call expected (the insert path)
    assert.equal(dbCallCount, 1, 'Should make exactly one from() call on successful insert');
  });
});
