/**
 * Tests — No-new-candidates execution result (16AB.43.23)
 *
 * Verifies that executeProspectWizardGeneration returns status:'no_new_candidates'
 * (not 'created') when the pipeline persists 0 candidates — whether due to novelty
 * exhaustion, empty results, or any other cause.
 *
 * Also verifies that status:'created' is still returned when candidates ARE created,
 * ensuring the positive path regresses correctly.
 *
 * Uses Node.js built-in test runner. No Tavily, no Supabase, no HubSpot, no LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps, ReserveBudgetDepResult } from '../wizard-execution-actions';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult } from '../wizard-idempotency';
import type { CatalogResolutionInput, CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { WizardTavilyInput } from '../wizard-tavily-executor';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const VALID_SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const VALID_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';
const CATALOG_VERSION = 'v2024-01';
const BATCH_A = 'batch-a-uuid-0001';
const FAKE_USER_ID = 'user-fake-uuid-0002';
const FAKE_RESERVATION_ID = 'reservation-fake-0001';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: VALID_INDUSTRY_ID,
  subindustryIds: [VALID_SUBINDUSTRY_ID],
  additionalCriteriaRaw: 'empresas con filial local',
  catalogVersion: CATALOG_VERSION,
  clientRequestId: VALID_CLIENT_REQUEST_ID,
};

const FAKE_CATALOG_RESOLUTION: CatalogResolutionOutput = {
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: CATALOG_VERSION },
  industry: { id: VALID_INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    { id: VALID_SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] },
  ],
};

function makeBaseMetadata() {
  return {
    rounds_executed: 1,
    stopped_reason: 'max_rounds_reached' as const,
    total_raw_evaluated: 12,
    total_candidates_accumulated: 12,
    useful_candidates_count: 12,
    min_useful_candidates: 7,
    target_internal: 25,
    max_rounds: 2,
    max_total_raw_to_evaluate: 50,
    dry_run: false,
    rounds: [],
  };
}

function makePipelineOutput(batchId: string, candidatesCreated: number, noveltyExhausted?: boolean): IncrementalSearchOutput {
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
    candidatesCount: 12,
    usefulCandidatesCount: 12,
    candidatesCreated,
    metadata: {
      ...makeBaseMetadata(),
      useful_candidates_count: 12,
      ...(noveltyExhausted !== undefined ? { novelty_exhausted: noveltyExhausted } : {}),
      ...(noveltyExhausted ? { estimated_persistable_after_novelty: 0 } : {}),
    },
    warnings: [],
    batchId,
  };
}

function makeDeps(pipelineOutput: IncrementalSearchOutput): WizardExecutionDeps & {
  pipelineCalls: WizardTavilyInput[];
} {
  const pipelineCalls: WizardTavilyInput[] = [];
  return {
    getActiveUserId: async () => FAKE_USER_ID,
    resolveCatalog: async (_input: CatalogResolutionInput) => FAKE_CATALOG_RESOLUTION,
    checkTavilyAvailability: async () => true,
    reserveBudget: async () =>
      ({ status: 'reserved', reservationId: FAKE_RESERVATION_ID, creditsReserved: 10 } satisfies ReserveBudgetDepResult),
    confirmBudget: async () => ({ status: 'confirmed' }),
    releaseBudget: async () => ({ status: 'released' }),
    readConsumedCredits: async () => 10,
    reserveSlot: async (_input: WizardExecutionReservationInput) =>
      ({ status: 'reserved', batchId: BATCH_A } satisfies WizardExecutionReservationResult),
    runTavilyPipeline: async (input: WizardTavilyInput) => {
      pipelineCalls.push(input);
      return pipelineOutput;
    },
    markBatchFailed: async () => {},
    pipelineCalls,
  };
}

function withFlag<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = enabled ? 'true' : 'false';
  return fn().finally(() => {
    if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  });
}

// ── NNC1: 0 candidates persisted → no_new_candidates ─────────────────────────

describe('NNC1 — pipeline.candidatesCreated=0 → status no_new_candidates', () => {

  it('NNC1-a: ok:true with status no_new_candidates', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 0));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 'no_new_candidates');
    }
  });

  it('NNC1-b: batchStatus is nothing_to_write', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 0));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.batchStatus, 'nothing_to_write');
    }
  });

  it('NNC1-c: batchId is the reserved batchId', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 0));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.batchId, BATCH_A);
    }
  });

  it('NNC1-d: candidateCount is 0', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 0));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidateCount, 0);
    }
  });
});

// ── NNC2: novelty_exhausted=true → no_new_candidates ─────────────────────────

describe('NNC2 — novelty_exhausted:true in metadata → status no_new_candidates', () => {

  it('NNC2-a: ok:true with status no_new_candidates when novelty_exhausted', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 0, true));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 'no_new_candidates');
    }
  });

  it('NNC2-b: no_new_candidates without novelty flag also resolves correctly', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 0, false));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 'no_new_candidates');
    }
  });
});

// ── NNC3: positive regression — candidates created → status 'created' ────────

describe('NNC3 — candidatesCreated > 0 still returns status created', () => {

  it('NNC3-a: ok:true with status created when 5 candidates created', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 5));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 'created');
    }
  });

  it('NNC3-b: batchStatus is ready_for_review when candidates created', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 5));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.batchStatus, 'ready_for_review');
    }
  });

  it('NNC3-c: candidateCount matches actual created count', async () => {
    const deps = makeDeps(makePipelineOutput(BATCH_A, 5));
    const result = await withFlag(true, () => executeProspectWizardGeneration(VALID_REQUEST, deps));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidateCount, 5);
    }
  });
});

// ── NNC4: type contract — no_new_candidates is valid status in result type ───

describe('NNC4 — WizardExecutionActionResult type contract includes no_new_candidates', () => {

  it('NNC4-a: constructing ok:true result with status no_new_candidates type-checks', () => {
    // This would fail to compile if 'no_new_candidates' were not in the union.
    const result: import('../wizard-execution-types').WizardExecutionActionResult = {
      ok: true,
      status: 'no_new_candidates',
      batchId: VALID_UUID,
      batchStatus: 'nothing_to_write',
      redirectPath: '/prospect-batches/test',
    };
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.status, 'no_new_candidates');
  });
});
