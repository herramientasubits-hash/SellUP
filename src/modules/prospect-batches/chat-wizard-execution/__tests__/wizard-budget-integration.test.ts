/**
 * Tests — Wizard Budget Guardrails Integration (16AB.43.17)
 *
 * Covers spec sections 24–33 plus reconciliation edge cases:
 *   §24: Flag off → EXECUTION_DISABLED → reserveBudget = 0
 *   §25: Identity — userId in reserveBudget = userId from getActiveUserId
 *   §26: Period calculation — injectable clock, Bogota timezone
 *   §27: Happy path ordering — budget→slot→tavily→confirm(10)
 *   §28: Partial consumption — consumed=5 → confirmBudget(5)
 *   §29: Unverifiable (readConsumedCredits=null) → confirmBudget(10)
 *   §30: Pre-Tavily slot throws → releaseBudget called, Tavily=0
 *   §31: slot=already_reserved + budget=new → releaseBudget, already_started
 *   §32: Idempotency — budget=already_reserved + slot=already_reserved → no Tavily, no confirm
 *   §33: Recovery — budget=already_reserved + slot=reserved → Tavily executes once
 *        Reconciliation failure after success → ok=true + reconciliationWarning
 *        Post-Tavily error + verifiable → confirmBudget(consumed)
 *        Post-Tavily error + unverifiable → confirmBudget(creditsReserved)
 *        Post-Tavily error + confirm fails → GENERATION_FAILED preserved
 *        Guardrail codes each map to ok:false with the correct code
 *        requestedCredits is always the server constant (10), never client-supplied
 *
 * Uses Node.js built-in test runner. No Supabase, Tavily, or real I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps, ReserveBudgetDepResult } from '../wizard-execution-actions';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult } from '../wizard-idempotency';
import type { CatalogResolutionInput, CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { WizardTavilyInput } from '../wizard-tavily-executor';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { PilotGuardrailCode } from '../wizard-pilot-types';
import {
  estimateWizardTavilyMaxCredits,
  estimateWizardAdaptiveMaxCredits,
  getPilotBudgetPeriodStart,
} from '../wizard-budget-reconciliation';
import { wizardExecutionRequestSchema } from '../wizard-execution-schema';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_USER_ID = 'user-budget-integration-0001';
const VALID_INDUSTRY_ID  = '223e4567-e89b-12d3-a456-426614174001';
const VALID_SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const VALID_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';
const CATALOG_VERSION = 'v2024-01';
const BATCH_A = 'batch-budget-integration-0001';
const RESERVATION_A = 'reservation-budget-integration-0001';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: VALID_INDUSTRY_ID,
  subindustryIds: [VALID_SUBINDUSTRY_ID],
  additionalCriteriaRaw: null,
  catalogVersion: CATALOG_VERSION,
  clientRequestId: VALID_CLIENT_REQUEST_ID,
};

const FAKE_CATALOG: CatalogResolutionOutput = {
  country:     { code: 'CO', name: 'Colombia' },
  catalog:     { version: CATALOG_VERSION },
  industry:    { id: VALID_INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    { id: VALID_SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] },
  ],
};

function makePipelineOutput(batchId: string, candidatesCreated = 5): IncrementalSearchOutput {
  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'tavily',
      targetInternal: 25,
      existingBatchId: batchId,
      triggeredByUserId: FAKE_USER_ID,
      ownerId: FAKE_USER_ID,
      dryRun: false,
    },
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: candidatesCreated,
    candidatesCreated,
    metadata: {
      rounds_executed: 1,
      stopped_reason: 'min_useful_reached',
      total_raw_evaluated: 10,
      total_candidates_accumulated: candidatesCreated,
      useful_candidates_count: candidatesCreated,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
    },
    warnings: [],
    batchId,
  };
}

// ── Dep factory with call trackers ────────────────────────────────────────────

type BudgetCall  = { userId: string; clientRequestId: string; requestedCredits: number };
type ConfirmCall = { reservationId: string; actualCreditsConsumed: number; batchId?: string | null };
type ReleaseCall = { reservationId: string; batchId?: string | null; reason?: string | null };

type TrackedDeps = WizardExecutionDeps & {
  budgetCalls:   BudgetCall[];
  confirmCalls:  ConfirmCall[];
  releaseCalls:  ReleaseCall[];
  slotCalls:     WizardExecutionReservationInput[];
  tavilyCalls:   WizardTavilyInput[];
  consumedCalls: string[];
};

function makeDeps(overrides: Partial<WizardExecutionDeps> = {}): TrackedDeps {
  const budgetCalls:   BudgetCall[]  = [];
  const confirmCalls:  ConfirmCall[] = [];
  const releaseCalls:  ReleaseCall[] = [];
  const slotCalls:     WizardExecutionReservationInput[] = [];
  const tavilyCalls:   WizardTavilyInput[] = [];
  const consumedCalls: string[] = [];

  const base: WizardExecutionDeps = {
    getActiveUserId: async () => FAKE_USER_ID,
    resolveCatalog:  async (_input: CatalogResolutionInput) => FAKE_CATALOG,
    checkTavilyAvailability: async () => true,
    reserveBudget: async (input) => {
      budgetCalls.push(input);
      return { status: 'reserved', reservationId: RESERVATION_A, creditsReserved: 10 } satisfies ReserveBudgetDepResult;
    },
    confirmBudget: async (input) => {
      confirmCalls.push(input);
      return { status: 'confirmed' };
    },
    releaseBudget: async (input) => {
      releaseCalls.push(input);
      return { status: 'released' };
    },
    readConsumedCredits: async (batchId) => {
      consumedCalls.push(batchId);
      return 10;
    },
    reserveSlot: async (input) => {
      slotCalls.push(input);
      return { status: 'reserved', batchId: BATCH_A } satisfies WizardExecutionReservationResult;
    },
    runTavilyPipeline: async (input) => {
      tavilyCalls.push(input);
      return makePipelineOutput(BATCH_A);
    },
    markBatchFailed: async () => { /* no-op */ },
  };

  return {
    ...base,
    ...overrides,
    budgetCalls,
    confirmCalls,
    releaseCalls,
    slotCalls,
    tavilyCalls,
    consumedCalls,
  };
}

async function withFlagAsync<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = enabled ? 'true' : 'false';
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  }
}

// ── §24: Credit estimation (pure) ────────────────────────────────────────────

describe('§24 — Credit estimation (pure helpers)', () => {
  it('basic depth → 1 credit per query → 10 total (legacy 2-round)', () => {
    assert.equal(estimateWizardTavilyMaxCredits({ searchDepth: 'basic' }), 10);
  });

  it('standard depth → 1 credit per query → 10 total (legacy 2-round)', () => {
    assert.equal(estimateWizardTavilyMaxCredits({ searchDepth: 'standard' }), 10);
  });

  it('deep depth → 2 credits per query → 20 total (legacy 2-round)', () => {
    assert.equal(estimateWizardTavilyMaxCredits({ searchDepth: 'deep' }), 20);
  });

  it('legacy default (no args) → current pipeline config → 10', () => {
    assert.equal(estimateWizardTavilyMaxCredits(), 10);
  });

  it('adaptive standard → 4 rounds × 5 queries × 1 credit = 20', () => {
    assert.equal(estimateWizardAdaptiveMaxCredits({ searchDepth: 'standard' }), 20);
  });

  it('adaptive deep → uncapped=40, capped at 20', () => {
    assert.equal(estimateWizardAdaptiveMaxCredits({ searchDepth: 'deep' }), 20);
  });

  it('adaptive default (no args) → 20', () => {
    assert.equal(estimateWizardAdaptiveMaxCredits(), 20);
  });

  it('requestedCredits in action is always server constant (20), never from client', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps();
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.budgetCalls.length, 1);
      assert.equal(deps.budgetCalls[0]!.requestedCredits, 20);
    });
  });
});

// ── §26: Period calculation (pure, injectable clock) ─────────────────────────

describe('§26 — Period calculation (injectable clock)', () => {
  it('2026-06-17 Bogotá → period start = 2026-06-01', () => {
    const clock = () => new Date('2026-06-17T12:00:00Z');
    assert.equal(getPilotBudgetPeriodStart('America/Bogota', clock), '2026-06-01');
  });

  it('2026-07-01T04:30Z = 2026-06-30 in Bogotá (UTC-5) → 2026-06-01', () => {
    // 04:30 UTC = 23:30 the previous day in Bogotá (UTC-5)
    const clock = () => new Date('2026-07-01T04:30:00Z');
    assert.equal(getPilotBudgetPeriodStart('America/Bogota', clock), '2026-06-01');
  });

  it('2026-07-01T05:30Z = 2026-07-01 in Bogotá (UTC-5) → 2026-07-01', () => {
    // 05:30 UTC = 00:30 the same day in Bogotá (UTC-5)
    const clock = () => new Date('2026-07-01T05:30:00Z');
    assert.equal(getPilotBudgetPeriodStart('America/Bogota', clock), '2026-07-01');
  });

  it('new year eve in Bogotá → 2026-12-01', () => {
    const clock = () => new Date('2026-12-31T10:00:00Z');
    assert.equal(getPilotBudgetPeriodStart('America/Bogota', clock), '2026-12-01');
  });

  it('always returns DD=01 regardless of day', () => {
    for (const day of [1, 15, 28, 31]) {
      const clock = () => new Date(`2026-08-${String(day).padStart(2, '0')}T12:00:00Z`);
      const period = getPilotBudgetPeriodStart('America/Bogota', clock);
      assert.ok(period.endsWith('-01'), `period for day ${day} must end with -01, got ${period}`);
    }
  });
});

// ── §25: Identity anti-spoofing ───────────────────────────────────────────────

describe('§25 — Identity: userId in reserveBudget = userId from getActiveUserId', () => {
  it('userId sent to reserveBudget equals server-session userId', async () => {
    await withFlagAsync(true, async () => {
      const SESSION_USER = 'user-session-abc123';
      const deps = makeDeps({
        getActiveUserId: async () => SESSION_USER,
      });
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.budgetCalls.length, 1);
      assert.equal(deps.budgetCalls[0]!.userId, SESSION_USER, 'userId must come from session');
    });
  });

  it('client payload userId field is blocked by schema (.strict)', () => {
    const result = wizardExecutionRequestSchema.safeParse({ ...VALID_REQUEST, userId: 'injected' });
    assert.equal(result.success, false, 'schema must reject userId from client');
  });
});

// ── §27: Happy path — ordering and call counts ────────────────────────────────

describe('§27 — Happy path: budget → slot → tavily → confirm(10 actual consumed)', () => {
  it('call order: budget, slot, tavily, confirm; releaseBudget = 0', async () => {
    await withFlagAsync(true, async () => {
      const order: string[] = [];
      const deps = makeDeps({
        reserveBudget: async (input) => {
          deps.budgetCalls.push(input);
          order.push('budget');
          return { status: 'reserved', reservationId: RESERVATION_A, creditsReserved: 10 };
        },
        reserveSlot: async (input) => {
          deps.slotCalls.push(input);
          order.push('slot');
          return { status: 'reserved', batchId: BATCH_A };
        },
        runTavilyPipeline: async (input) => {
          deps.tavilyCalls.push(input);
          order.push('tavily');
          return makePipelineOutput(BATCH_A);
        },
        confirmBudget: async (input) => {
          deps.confirmCalls.push(input);
          order.push('confirm');
          return { status: 'confirmed' };
        },
      });

      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

      assert.equal(result.ok, true);
      if (result.ok) assert.ok(
        ['success_partial', 'success_target_reached', 'created'].includes(result.status),
        `Expected a success status, got: ${result.status}`,
      );
      assert.deepEqual(order, ['budget', 'slot', 'tavily', 'confirm']);
      assert.equal(deps.tavilyCalls.length, 1);
      assert.equal(deps.confirmCalls.length, 1);
      assert.equal(deps.releaseCalls.length, 0);
    });
  });

  it('confirmBudget receives the reservation ID, 10 credits, and batchId', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps();
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.confirmCalls.length, 1);
      const c = deps.confirmCalls[0]!;
      assert.equal(c.reservationId, RESERVATION_A);
      assert.equal(c.actualCreditsConsumed, 10);
      assert.equal(c.batchId, BATCH_A);
    });
  });
});

// ── §28: Partial consumption ───────────────────────────────────────────────────

describe('§28 — Partial consumption: consumed=5 → confirmBudget(5)', () => {
  it('when readConsumedCredits returns 5, confirmBudget receives 5', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        readConsumedCredits: async (batchId) => {
          deps.consumedCalls.push(batchId);
          return 5;
        },
      });
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.confirmCalls.length, 1);
      assert.equal(deps.confirmCalls[0]!.actualCreditsConsumed, 5);
    });
  });
});

// ── §29: Unverifiable consumption ─────────────────────────────────────────────

describe('§29 — Unverifiable consumption (readConsumedCredits=null) → confirmBudget(creditsReserved=10)', () => {
  it('null consumed → confirm with full reserved credits (10)', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        readConsumedCredits: async (batchId) => {
          deps.consumedCalls.push(batchId);
          return null;
        },
      });
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.confirmCalls.length, 1);
      assert.equal(deps.confirmCalls[0]!.actualCreditsConsumed, 10);
    });
  });

  it('zero consumed (usage_logging_failed simulation) → confirm with 10 (not 0)', async () => {
    // Zero rows → readConsumedCreditsFromDb returns null; action treats as unverifiable.
    // This test simulates the dep returning null when provider_usage_logs had 0 rows.
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        readConsumedCredits: async (batchId) => {
          deps.consumedCalls.push(batchId);
          return null; // 0 rows in DB → null from readWizardConsumedCreditsFromDb
        },
      });
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.confirmCalls[0]!.actualCreditsConsumed, 10);
    });
  });
});

// ── §30: Pre-Tavily failure (slot throws) ─────────────────────────────────────

describe('§30 — Pre-Tavily failure: slot throws → releaseBudget, Tavily=0', () => {
  it('slot reservation throws + budget was new → releaseBudget called, Tavily=0, GENERATION_FAILED', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        reserveSlot: async (input) => {
          deps.slotCalls.push(input);
          throw new Error('DB unavailable');
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
      assert.equal(deps.tavilyCalls.length, 0, 'Tavily must not be called');
      assert.equal(deps.releaseCalls.length, 1, 'budget must be released');
      assert.equal(deps.releaseCalls[0]!.reservationId, RESERVATION_A);
    });
  });

  it('slot throws + budget was already_reserved → releaseBudget NOT called (not ours)', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        reserveBudget: async (input) => {
          deps.budgetCalls.push(input);
          // already_reserved → not ours; budgetWasNew = false
          return { status: 'already_reserved', reservationId: RESERVATION_A, creditsReserved: 10 };
        },
        reserveSlot: async (input) => {
          deps.slotCalls.push(input);
          throw new Error('DB unavailable');
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
      assert.equal(deps.releaseCalls.length, 0, 'must not release a budget we did not create');
    });
  });
});

// ── §31: slot=already_reserved + budget=new ──────────────────────────────────

describe('§31 — slot=already_reserved + budget=new → releaseBudget, already_started', () => {
  it('budget newly reserved but batch already exists → release budget, return already_started', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        reserveSlot: async (input) => {
          deps.slotCalls.push(input);
          return { status: 'already_reserved', batchId: BATCH_A };
        },
      });
      // Default reserveBudget returns status:'reserved' (new budget)
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.status, 'already_started');
      assert.equal(deps.tavilyCalls.length, 0, 'Tavily must not be called');
      assert.equal(deps.releaseCalls.length, 1, 'newly reserved budget must be released');
      assert.equal(deps.releaseCalls[0]!.reservationId, RESERVATION_A);
      assert.equal(deps.confirmCalls.length, 0, 'must not confirm budget that was released');
    });
  });
});

// ── §32: Full idempotency ─────────────────────────────────────────────────────

describe('§32 — Idempotency: budget=already_reserved + slot=already_reserved → no Tavily, no confirm, no release', () => {
  it('both already_reserved → already_started; Tavily=0, confirm=0, release=0', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        reserveBudget: async (input) => {
          deps.budgetCalls.push(input);
          return { status: 'already_reserved', reservationId: RESERVATION_A, creditsReserved: 10 };
        },
        reserveSlot: async (input) => {
          deps.slotCalls.push(input);
          return { status: 'already_reserved', batchId: BATCH_A };
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.status, 'already_started');
      assert.equal(deps.tavilyCalls.length, 0);
      assert.equal(deps.confirmCalls.length, 0);
      assert.equal(deps.releaseCalls.length, 0);
    });
  });
});

// ── §33: Recovery ─────────────────────────────────────────────────────────────

describe('§33 — Recovery: budget=already_reserved + slot=reserved → Tavily executes once', () => {
  it('prior budget + fresh slot → Tavily runs, confirmBudget called once', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        reserveBudget: async (input) => {
          deps.budgetCalls.push(input);
          // Budget already exists from a prior attempt that never reached Tavily
          return { status: 'already_reserved', reservationId: RESERVATION_A, creditsReserved: 10 };
        },
        // Slot is new (fresh batch created)
        reserveSlot: async (input) => {
          deps.slotCalls.push(input);
          return { status: 'reserved', batchId: BATCH_A };
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true);
      if (result.ok) assert.ok(
        ['success_partial', 'success_target_reached', 'created'].includes(result.status),
        `Expected a success status, got: ${result.status}`,
      );
      assert.equal(deps.tavilyCalls.length, 1, 'Tavily must run exactly once');
      assert.equal(deps.confirmCalls.length, 1, 'confirmBudget must be called');
      assert.equal(deps.releaseCalls.length, 0);
    });
  });
});

// ── Reconciliation failure after success ──────────────────────────────────────

describe('Reconciliation failure after success → ok=true + reconciliationWarning', () => {
  it('confirmBudget throws after successful Tavily → ok=true with BUDGET_RECONCILIATION_FAILED', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        confirmBudget: async (input) => {
          deps.confirmCalls.push(input);
          throw new Error('RPC connection lost');
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true, 'must not convert success to failure on reconciliation error');
      if (result.ok) {
        assert.ok(
          ['success_partial', 'success_target_reached', 'created'].includes(result.status),
          `Expected a success status, got: ${result.status}`,
        );
        assert.equal(result.reconciliationWarning, 'BUDGET_RECONCILIATION_FAILED');
      }
      assert.equal(deps.tavilyCalls.length, 1, 'Tavily ran once');
    });
  });

  it('confirmBudget returns error status after success → ok=true (error result does not throw)', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        confirmBudget: async (input) => {
          deps.confirmCalls.push(input);
          return { status: 'error', code: 'reservation_not_found', message: 'not found' };
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      // Non-throwing confirm error → reconciliation still succeeds (no throw path)
      assert.equal(result.ok, true);
    });
  });
});

// ── Post-Tavily error reconciliation ─────────────────────────────────────────

describe('Post-Tavily error reconciliation', () => {
  it('pipeline throws + verifiable credits=5 → confirmBudget(5), GENERATION_FAILED', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        runTavilyPipeline: async (input) => {
          deps.tavilyCalls.push(input);
          throw new Error('Tavily 500');
        },
        readConsumedCredits: async (batchId) => {
          deps.consumedCalls.push(batchId);
          return 5;
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
      assert.equal(deps.confirmCalls.length, 1);
      assert.equal(deps.confirmCalls[0]!.actualCreditsConsumed, 5);
    });
  });

  it('pipeline throws + unverifiable (readConsumedCredits=null) → confirmBudget(10), GENERATION_FAILED', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        runTavilyPipeline: async (input) => {
          deps.tavilyCalls.push(input);
          throw new Error('Tavily 500');
        },
        readConsumedCredits: async (batchId) => {
          deps.consumedCalls.push(batchId);
          return null;
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
      assert.equal(deps.confirmCalls[0]!.actualCreditsConsumed, 10);
    });
  });

  it('pipeline throws + confirmBudget also throws → GENERATION_FAILED preserved', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        runTavilyPipeline: async () => { throw new Error('Tavily 500'); },
        confirmBudget:     async () => { throw new Error('DB unavailable'); },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
    });
  });
});

// ── Guardrail blocking codes ──────────────────────────────────────────────────

describe('Guardrail blocking codes — each propagates as ok:false with correct code', () => {
  const guardrailCodes: PilotGuardrailCode[] = [
    'PILOT_PAUSED',
    'NOT_IN_PILOT',
    'BUDGET_PERIOD_NOT_CONFIGURED',
    'BUDGET_PERIOD_CLOSED',
    'EXECUTION_CREDIT_LIMIT_EXCEEDED',
    'BUDGET_EXCEEDED',
    'CONCURRENT_EXECUTION_ACTIVE',
    'BUDGET_RESERVATION_FAILED',
  ];

  for (const code of guardrailCodes) {
    it(`${code} → ok:false with code=${code}, Tavily=0, slot=0`, async () => {
      await withFlagAsync(true, async () => {
        const deps = makeDeps({
          reserveBudget: async (input) => {
            deps.budgetCalls.push(input);
            return { status: 'blocked', code, message: `test: ${code}` };
          },
        });
        const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, code);
        assert.equal(deps.slotCalls.length, 0, 'slot must not be called on budget block');
        assert.equal(deps.tavilyCalls.length, 0, 'Tavily must not be called on budget block');
      });
    });
  }
});

// ── v1.16K-AG — Provider-aware budget: Apollo reserves only what it will spend ──

describe('v1.16K-AG — Apollo provider uses provider-aware credit estimate', () => {
  function withApolloProviderEnv(
    overrides: { queries?: string; results?: string },
    fn: () => Promise<void>,
  ): Promise<void> {
    const savedQ = process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    const savedR = process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;

    if (overrides.queries !== undefined) {
      process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = overrides.queries;
    } else {
      delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    }

    if (overrides.results !== undefined) {
      process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = overrides.results;
    } else {
      delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
    }

    return fn().finally(() => {
      if (savedQ !== undefined) process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = savedQ;
      else delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
      if (savedR !== undefined) process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = savedR;
      else delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
    });
  }

  function makeApolloDeps(overrides: Partial<WizardExecutionDeps> = {}): TrackedDeps {
    const pipelineOutput = makePipelineOutput(BATCH_A);
    return makeDeps({
      resolveProvider: () => 'apollo_organizations',
      checkTavilyAvailability: async () => false, // not used when Apollo
      runApolloPipeline: async () => pipelineOutput,
      ...overrides,
    });
  }

  it('AG-1: Apollo provider → requestedCredits = 3 (1 query × 3 results, defaults)', async () => {
    await withFlagAsync(true, async () => {
      await withApolloProviderEnv({}, async () => {
        const deps = makeApolloDeps();
        await executeProspectWizardGeneration(VALID_REQUEST, deps);
        assert.equal(deps.budgetCalls.length, 1);
        assert.equal(deps.budgetCalls[0]!.requestedCredits, 3);
      });
    });
  });

  it('AG-2: Tavily provider → requestedCredits = 20 (unchanged regression)', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps();
      // Default resolveProvider returns tavily
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.budgetCalls[0]!.requestedCredits, 20);
    });
  });

  it('AG-3: Apollo available=12, max=25, estimate=3 → reserveBudget called with 3, not blocked', async () => {
    await withFlagAsync(true, async () => {
      await withApolloProviderEnv({}, async () => {
        let receivedCredits: number | undefined;
        const deps = makeApolloDeps({
          reserveBudget: async (input) => {
            deps.budgetCalls.push(input);
            receivedCredits = input.requestedCredits;
            return { status: 'reserved', reservationId: RESERVATION_A, creditsReserved: 3 };
          },
        });
        const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
        assert.equal(result.ok, true);
        assert.equal(receivedCredits, 3);
      });
    });
  });

  it('AG-4: Apollo with env 99/99 → hard caps apply → requestedCredits = 15', async () => {
    await withFlagAsync(true, async () => {
      await withApolloProviderEnv({ queries: '99', results: '99' }, async () => {
        const deps = makeApolloDeps();
        await executeProspectWizardGeneration(VALID_REQUEST, deps);
        // Hard cap: queries ≤ 3, results ≤ 5 → 15
        assert.equal(deps.budgetCalls[0]!.requestedCredits, 15);
      });
    });
  });
});

// ── §16AB.43.19 — Anti-regression: service_role client, identity, no residuos ─

describe('§16AB.43.19 — Anti-regression: identity, periodStart, no residuos', () => {
  // Root cause of the production bug: executeProspectWizardGenerationAction was using
  // the user-session client (publishable key / authenticated role) for budget operations.
  // try_reserve_wizard_credits and wizard_budget_reservations REVOKE ALL from authenticated.
  // Fix: budget deps now use a service_role client (createWizardBudgetClient).
  //
  // This test suite verifies the observable consequences of the fix at the dep-injection level.

  it('16AB.43.19.1: reserveBudget receives internal_users.id, not auth_user_id', async () => {
    await withFlagAsync(true, async () => {
      // These are the real production IDs from the incident report.
      const INTERNAL_USER_ID = '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c'; // internal_users.id
      const AUTH_USER_ID     = '5b4a6a23-ec4d-4ca3-8587-24b09775acba'; // auth.users.id — must NOT be used

      const deps = makeDeps({
        getActiveUserId: async () => INTERNAL_USER_ID,
      });
      await executeProspectWizardGeneration(VALID_REQUEST, deps);

      assert.equal(deps.budgetCalls.length, 1);
      const userId = deps.budgetCalls[0]!.userId;
      assert.equal(userId, INTERNAL_USER_ID, 'budget must use internal_users.id');
      assert.notEqual(userId, AUTH_USER_ID,  'budget must never use auth_user_id');
    });
  });

  it('16AB.43.19.2: periodStart for 2026-06-18 America/Bogota → 2026-06-01 (production date)', () => {
    // 2026-06-18 in Bogotá (UTC-5): 2026-06-18T05:00:00Z is 2026-06-18T00:00:00 local.
    const clock = () => new Date('2026-06-18T12:00:00Z');
    assert.equal(getPilotBudgetPeriodStart('America/Bogota', clock), '2026-06-01');
  });

  it('16AB.43.19.3: requestedCredits is always 20 (server constant = 4 rounds × 5 queries, never from client)', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps();
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(deps.budgetCalls[0]!.requestedCredits, 20);
    });
  });

  it('16AB.43.19.4: budget blocked → slot=0, Tavily=0, candidates=0 (no residuos)', async () => {
    await withFlagAsync(true, async () => {
      const deps = makeDeps({
        reserveBudget: async (input) => {
          deps.budgetCalls.push(input);
          return { status: 'blocked', code: 'BUDGET_RESERVATION_FAILED', message: 'permission denied for function try_reserve_wizard_credits' };
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'BUDGET_RESERVATION_FAILED');
      assert.equal(deps.slotCalls.length, 0,  'slot must not be called when budget blocked');
      assert.equal(deps.tavilyCalls.length, 0, 'Tavily must not be called when budget blocked');
      assert.equal(deps.confirmCalls.length, 0, 'confirm must not be called when budget blocked');
      assert.equal(deps.releaseCalls.length, 0, 'release must not be called when budget blocked');
    });
  });

  it('16AB.43.19.5: happy path with production participant → reserved and proceeds to slot', async () => {
    await withFlagAsync(true, async () => {
      const INTERNAL_USER_ID = '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c';

      const deps = makeDeps({
        getActiveUserId: async () => INTERNAL_USER_ID,
        reserveBudget: async (input) => {
          deps.budgetCalls.push(input);
          return { status: 'reserved', reservationId: RESERVATION_A, creditsReserved: 20 };
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

      assert.equal(result.ok, true);
      assert.equal(deps.budgetCalls[0]!.userId, INTERNAL_USER_ID);
      assert.equal(deps.budgetCalls[0]!.requestedCredits, 20);
      assert.equal(deps.slotCalls.length, 1,  'slot must be called after successful reservation');
      assert.equal(deps.tavilyCalls.length, 1, 'Tavily must execute after slot');
    });
  });
});
