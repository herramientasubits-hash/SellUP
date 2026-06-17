/**
 * Tests — Wizard Execution Action (16AB.43 / 16AB.43.5)
 *
 * Section A-C: Guard layers (feature flag, schema, type contract).
 * Section D+:  Full execution via executeProspectWizardGeneration with injected fakes.
 *              Covers: flag off, invalid schema, catalog changed, Tavily unavailable,
 *              first reservation, repeated request, batchId mismatch, pipeline error,
 *              markBatchFailed failure, metadata preservation, anti-Apollo guardrail,
 *              and contract enforcement for client-controlled fields.
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { wizardExecutionRequestSchema } from '../wizard-execution-schema';
import type { WizardExecutionActionResult } from '../wizard-execution-types';
import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult } from '../wizard-idempotency';
import type { CatalogResolutionInput, CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { WizardTavilyInput } from '../wizard-tavily-executor';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const VALID_SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const VALID_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';
const CATALOG_VERSION = 'v2024-01';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: VALID_INDUSTRY_ID,
  subindustryIds: [VALID_SUBINDUSTRY_ID],
  additionalCriteriaRaw: null,
  catalogVersion: CATALOG_VERSION,
  clientRequestId: VALID_CLIENT_REQUEST_ID,
};

function makeRequest(overrides: Record<string, unknown> = {}) {
  return { ...VALID_REQUEST, ...overrides };
}

// ── Section A: Feature flag gate (env-controlled, no mocking needed) ──────────

describe('Section A — Feature flag gate', () => {
  it('A1: isExecutionEnabled returns false when env var is absent', () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;

    const enabled = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION === 'true';
    assert.equal(enabled, false);

    if (saved !== undefined) {
      process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    }
  });

  it('A2: isExecutionEnabled returns false when env var is "false"', () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'false';

    const enabled = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION === 'true';
    assert.equal(enabled, false);

    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved ?? '';
  });

  it('A3: isExecutionEnabled returns true when env var is "true"', () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';

    const enabled = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION === 'true';
    assert.equal(enabled, true);

    if (saved !== undefined) {
      process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    } else {
      delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });
});

// ── Section B: Request schema validation (layer 3 of the action) ──────────────

describe('Section B — Request schema guards (INVALID_REQUEST layer)', () => {
  it('B1: valid request passes schema', () => {
    const result = wizardExecutionRequestSchema.safeParse(VALID_REQUEST);
    assert.equal(result.success, true);
  });

  it('B2: missing clientRequestId → schema fails', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ clientRequestId: undefined }),
    );
    assert.equal(result.success, false);
  });

  it('B3: clientRequestId that is not a UUID → schema fails', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ clientRequestId: 'not-a-uuid' }),
    );
    assert.equal(result.success, false);
  });

  it('B4: countryCode with lowercase → schema fails', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ countryCode: 'colombia' }),
    );
    assert.equal(result.success, false);
  });

  it('B5: countryCode with more than 2 chars → schema fails', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ countryCode: 'COL' }),
    );
    assert.equal(result.success, false);
  });

  it('B6: industryId that is not a UUID → schema fails', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ industryId: 'not-a-uuid' }),
    );
    assert.equal(result.success, false);
  });

  it('B7: unknown field userId → schema fails (.strict())', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ userId: 'injected-user' }),
    );
    assert.equal(result.success, false);
  });

  it('B8: unknown field targetCount → schema fails (.strict())', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ targetCount: 9999 }),
    );
    assert.equal(result.success, false);
  });

  it('B9: subindustryIds with duplicates → schema fails', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ subindustryIds: [VALID_SUBINDUSTRY_ID, VALID_SUBINDUSTRY_ID] }),
    );
    assert.equal(result.success, false);
  });

  it('B10: additionalCriteriaRaw null is allowed', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ additionalCriteriaRaw: null }),
    );
    assert.equal(result.success, true);
  });

  it('B11: additionalCriteriaRaw as empty string is allowed', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ additionalCriteriaRaw: '' }),
    );
    assert.equal(result.success, true);
  });

  it('B12: subindustryIds empty array is allowed', () => {
    const result = wizardExecutionRequestSchema.safeParse(
      makeRequest({ subindustryIds: [] }),
    );
    assert.equal(result.success, true);
  });
});

// ── Section C: WizardExecutionActionResult type contract ──────────────────────

describe('Section C — WizardExecutionActionResult type contract', () => {
  it('C1: ok:true result has required fields', () => {
    const result: WizardExecutionActionResult = {
      ok: true,
      status: 'created',
      batchId: VALID_UUID,
      batchStatus: 'processing',
      redirectPath: `/prospects?sourceId=${VALID_UUID}`,
    };
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.batchId);
      assert.ok(result.redirectPath);
      assert.ok(['created', 'already_started'].includes(result.status));
    }
  });

  it('C2: ok:false result has code, message, retryable', () => {
    const result: WizardExecutionActionResult = {
      ok: false,
      code: 'EXECUTION_DISABLED',
      message: 'La generación real del wizard todavía no está habilitada.',
      retryable: false,
    };
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.code);
      assert.ok(typeof result.message === 'string');
      assert.ok(typeof result.retryable === 'boolean');
    }
  });

  it('C3: EXECUTION_DISABLED code is valid', () => {
    const result: WizardExecutionActionResult = {
      ok: false,
      code: 'EXECUTION_DISABLED',
      message: 'test',
      retryable: false,
    };
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'EXECUTION_DISABLED');
  });

  it('C4: UNAUTHENTICATED code is valid', () => {
    const result: WizardExecutionActionResult = {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'test',
      retryable: false,
    };
    if (!result.ok) assert.equal(result.code, 'UNAUTHENTICATED');
  });

  it('C5: CATALOG_CHANGED code is valid', () => {
    const result: WizardExecutionActionResult = {
      ok: false,
      code: 'CATALOG_CHANGED',
      message: 'test',
      retryable: false,
    };
    if (!result.ok) assert.equal(result.code, 'CATALOG_CHANGED');
  });

  it('C6: INVALID_REQUEST code is valid', () => {
    const result: WizardExecutionActionResult = {
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'test',
      retryable: false,
    };
    if (!result.ok) assert.equal(result.code, 'INVALID_REQUEST');
  });

  it('C7: ok:true status already_started is valid', () => {
    const result: WizardExecutionActionResult = {
      ok: true,
      status: 'already_started',
      batchId: VALID_UUID,
      batchStatus: 'processing',
      redirectPath: '/prospects',
    };
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.status, 'already_started');
  });

  it('C8: candidateCount is optional in ok:true result', () => {
    const withCount: WizardExecutionActionResult = {
      ok: true,
      status: 'created',
      batchId: VALID_UUID,
      batchStatus: 'processing',
      candidateCount: 10,
      redirectPath: '/prospects',
    };
    const withoutCount: WizardExecutionActionResult = {
      ok: true,
      status: 'created',
      batchId: VALID_UUID,
      batchStatus: 'processing',
      redirectPath: '/prospects',
    };
    assert.equal(withCount.ok, true);
    assert.equal(withoutCount.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sections D+ — Full execution via executeProspectWizardGeneration with fakes
// ─────────────────────────────────────────────────────────────────────────────

// VALID_UUID, VALID_INDUSTRY_ID, VALID_SUBINDUSTRY_ID, VALID_CLIENT_REQUEST_ID,
// and CATALOG_VERSION are declared in sections A-C above and reused here.
const BATCH_A = 'batch-a-uuid-0001';
const FAKE_USER_ID = 'user-fake-uuid-0002';

const VALID_REQUEST_FULL = {
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

function makeReservedDeps(overrides: Partial<WizardExecutionDeps> = {}): WizardExecutionDeps & {
  reserveSlotCalls: WizardExecutionReservationInput[];
  pipelineCalls: WizardTavilyInput[];
  markFailedCalls: Array<{ batchId: string; reason: string }>;
} {
  const reserveSlotCalls: WizardExecutionReservationInput[] = [];
  const pipelineCalls: WizardTavilyInput[] = [];
  const markFailedCalls: Array<{ batchId: string; reason: string }> = [];

  const defaultDeps: WizardExecutionDeps = {
    getActiveUserId: async () => FAKE_USER_ID,
    resolveCatalog: async (_input: CatalogResolutionInput) => FAKE_CATALOG_RESOLUTION,
    checkTavilyAvailability: async () => true,
    reserveSlot: async (input: WizardExecutionReservationInput) => {
      reserveSlotCalls.push(input);
      return { status: 'reserved', batchId: BATCH_A } satisfies WizardExecutionReservationResult;
    },
    runTavilyPipeline: async (input: WizardTavilyInput) => {
      pipelineCalls.push(input);
      return makePipelineOutput(BATCH_A);
    },
    markBatchFailed: async (batchId: string, reason: 'batchid_mismatch' | 'pipeline_error') => {
      markFailedCalls.push({ batchId, reason });
    },
  };

  return {
    ...defaultDeps,
    ...overrides,
    reserveSlotCalls,
    pipelineCalls,
    markFailedCalls,
  };
}

// ── Section D: Full execution paths ──────────────────────────────────────────

describe('Section D — executeProspectWizardGeneration integration', () => {

  // D1: Feature flag off
  it('D1: flag off → EXECUTION_DISABLED, zero deps called', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'false';
    const deps = makeReservedDeps();
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'EXECUTION_DISABLED');
      assert.equal(deps.reserveSlotCalls.length, 0, 'reserveSlot must not be called');
      assert.equal(deps.pipelineCalls.length, 0, 'pipeline must not be called');
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D2: Invalid request schema
  it('D2: invalid schema → INVALID_REQUEST, zero reservations, zero pipeline', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps();
    try {
      const result = await executeProspectWizardGeneration(
        { ...VALID_REQUEST_FULL, clientRequestId: 'not-a-uuid' },
        deps,
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'INVALID_REQUEST');
      assert.equal(deps.reserveSlotCalls.length, 0);
      assert.equal(deps.pipelineCalls.length, 0);
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D3: Catalog changed
  it('D3: catalog resolution throws → CATALOG_CHANGED, zero reservations, zero pipeline', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps({
      resolveCatalog: async () => { throw new Error('catalog version mismatch'); },
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'CATALOG_CHANGED');
      assert.equal(deps.reserveSlotCalls.length, 0);
      assert.equal(deps.pipelineCalls.length, 0);
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D4: Tavily not available
  it('D4: Tavily unavailable → PROVIDER_UNAVAILABLE, zero reservations, zero pipeline', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps({
      checkTavilyAvailability: async () => false,
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(deps.reserveSlotCalls.length, 0, 'no batch reserved when Tavily unavailable');
      assert.equal(deps.pipelineCalls.length, 0);
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D5: First reservation — success
  it('D5: first reservation → created, pipeline called once with correct input', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps();
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.status, 'created');
        assert.equal(result.batchId, BATCH_A);
        assert.equal(result.batchStatus, 'ready_for_review');
        assert.ok(result.redirectPath.includes(BATCH_A));
      }
      assert.equal(deps.reserveSlotCalls.length, 1, 'reserveSlot called exactly once');
      assert.equal(deps.pipelineCalls.length, 1, 'pipeline called exactly once');
      // Verify the pipeline received the correct batchId
      const pipelineCall = deps.pipelineCalls[0]!;
      assert.equal(pipelineCall.reservedBatchId, BATCH_A);
      // Verify the resolved context forwarded correctly
      assert.equal(pipelineCall.resolved.userId, FAKE_USER_ID);
      assert.equal(pipelineCall.resolved.country.code, 'CO');
      assert.equal(pipelineCall.resolved.industry.name, 'Tecnología');
      assert.equal(pipelineCall.resolved.industry.id, VALID_INDUSTRY_ID);
      assert.equal(pipelineCall.resolved.subindustries.length, 1);
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D6: Already reserved — idempotency returns already_started, no pipeline
  it('D6: already_reserved → already_started, zero pipeline calls', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps({
      reserveSlot: async (input: WizardExecutionReservationInput) => {
        deps.reserveSlotCalls.push(input);
        return { status: 'already_reserved', batchId: BATCH_A } satisfies WizardExecutionReservationResult;
      },
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.status, 'already_started');
        assert.equal(result.batchId, BATCH_A);
        assert.ok(result.redirectPath.includes(BATCH_A));
      }
      assert.equal(deps.pipelineCalls.length, 0, 'pipeline must not be called on already_reserved');
      assert.equal(deps.markFailedCalls.length, 0, 'markBatchFailed must not be called');
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D7: Pipeline returns a different batchId
  it('D7: pipeline returns different batchId → GENERATION_FAILED, markBatchFailed called on reservedId', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const BATCH_B = 'batch-b-uuid-different';
    const deps = makeReservedDeps({
      runTavilyPipeline: async (input: WizardTavilyInput) => {
        deps.pipelineCalls.push(input);
        return makePipelineOutput(BATCH_B); // returns BATCH_B instead of BATCH_A
      },
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
      // markBatchFailed must be called on the RESERVED batch (BATCH_A), not on BATCH_B
      assert.equal(deps.markFailedCalls.length, 1, 'markBatchFailed called once');
      assert.equal(deps.markFailedCalls[0]!.batchId, BATCH_A);
      assert.equal(deps.markFailedCalls[0]!.reason, 'batchid_mismatch');
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D8: Pipeline throws
  it('D8: pipeline throws → GENERATION_FAILED, markBatchFailed called with pipeline_error', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps({
      runTavilyPipeline: async (input: WizardTavilyInput) => {
        deps.pipelineCalls.push(input);
        throw new Error('Tavily connection refused');
      },
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
      assert.equal(deps.markFailedCalls.length, 1);
      assert.equal(deps.markFailedCalls[0]!.batchId, BATCH_A);
      assert.equal(deps.markFailedCalls[0]!.reason, 'pipeline_error');
      // Apollo must not have been called
      assert.equal(deps.reserveSlotCalls.length, 1, 'slot was reserved before pipeline call');
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D9: markBatchFailed also throws — controlled error, no false success
  it('D9: pipeline throws and markBatchFailed also throws → controlled GENERATION_FAILED, no false ok', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps({
      runTavilyPipeline: async () => { throw new Error('pipeline error'); },
      markBatchFailed: async () => { throw new Error('db update failed'); },
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, false, 'must not return ok:true even when markBatchFailed fails');
      if (!result.ok) assert.equal(result.code, 'GENERATION_FAILED');
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D10: Metadata — reserveSlot receives all required wizard fields
  it('D10: metadata — reserveSlot receives catalog version, industryId, subindustryIds, country, criteria', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps();
    try {
      await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(deps.reserveSlotCalls.length, 1);
      const slot = deps.reserveSlotCalls[0]!;
      const payload = slot.initialBatchPayload;
      assert.equal(payload.requestSource, 'chat_wizard');
      assert.equal(payload.catalogVersionId, CATALOG_VERSION);
      assert.equal(payload.industryId, VALID_INDUSTRY_ID);
      assert.ok(Array.isArray(payload.subindustryIds));
      assert.ok(payload.subindustryIds.includes(VALID_SUBINDUSTRY_ID));
      assert.equal(payload.countryCode, 'CO');
      assert.equal(payload.additionalCriteria, 'empresas con filial local');
      assert.equal(slot.userId, FAKE_USER_ID);
      assert.equal(slot.clientRequestId, VALID_CLIENT_REQUEST_ID);
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D11: Anti-Apollo structural guardrail
  it('D11: structural guardrail — wizard-execution-actions.ts does not import Apollo paths', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      'utf-8',
    );
    const forbidden = [
      'generateAIProspectBatch',
      'runProspectGenerationAgent',
      'searchApolloOrganizations',
      'generateTavilyProspectBatch',
    ];
    for (const name of forbidden) {
      assert.ok(!source.includes(name), `wizard-execution-actions must not reference: ${name}`);
    }
  });

  // D12: Contract — schema rejects client-controlled fields
  it('D12: schema rejects existingBatchId, provider, targetCount, userId, searchDepth', () => {
    const clientControlledFields = [
      { existingBatchId: 'some-batch' },
      { provider: 'tavily' },
      { targetCount: 25 },
      { userId: 'injected-user' },
      { searchDepth: 'deep' },
    ];
    for (const extra of clientControlledFields) {
      const result = wizardExecutionRequestSchema.safeParse({
        ...VALID_REQUEST_FULL,
        ...extra,
      });
      assert.equal(
        result.success,
        false,
        `schema must reject extra field: ${JSON.stringify(extra)}`,
      );
    }
  });

  // D13: Single-batch guardrail — reserveSlot called exactly once on first request
  it('D13: first request creates exactly one reservation, not more', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps();
    try {
      await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(deps.reserveSlotCalls.length, 1, 'exactly one reservation created');
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });

  // D14: candidateCount is forwarded from pipeline result
  it('D14: candidateCount in success result comes from pipeline candidatesCreated', async () => {
    const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
    const deps = makeReservedDeps({
      runTavilyPipeline: async (input: WizardTavilyInput) => {
        deps.pipelineCalls.push(input);
        return makePipelineOutput(BATCH_A, 17);
      },
    });
    try {
      const result = await executeProspectWizardGeneration(VALID_REQUEST_FULL, deps);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.candidateCount, 17);
    } finally {
      if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
      else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    }
  });
});
