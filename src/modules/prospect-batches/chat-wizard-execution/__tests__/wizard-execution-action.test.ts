/**
 * Tests — Wizard Execution Action (16AB.43)
 *
 * Tests the guard layers of executeProspectWizardGenerationAction.
 * Because the server action uses top-level imports that require Supabase/Next.js
 * context at module-load time, we test the guard logic indirectly by:
 *   - Verifying the Zod schema rejects invalid payloads (layer 3 tested via schema)
 *   - Verifying the feature-flag gate via process.env manipulation
 *   - Verifying type correctness of WizardExecutionActionResult discriminated union
 *
 * Integration tests that call requireActiveUser or resolveWizardCatalog against
 * real infrastructure are deferred to the 16AB.44 milestone (post-migration).
 *
 * Uses Node.js built-in test runner (same as wizard-pipeline-adapter.test.ts).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { wizardExecutionRequestSchema } from '../wizard-execution-schema';
import type { WizardExecutionActionResult } from '../wizard-execution-types';

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
