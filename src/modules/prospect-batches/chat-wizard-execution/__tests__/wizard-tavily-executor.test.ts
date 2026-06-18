/**
 * Tests — Wizard Tavily Executor (16AB.43.5)
 *
 * Verifies runWizardTavilySearch sets all required parameters before passing
 * to the incremental search pipeline. Uses a fake runner — no real Tavily calls.
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runWizardTavilySearch,
  WIZARD_TAVILY_TARGET_INTERNAL,
  WIZARD_ADAPTIVE_MAX_ROUNDS,
  WIZARD_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-tavily-executor';
import type { WizardTavilyInput } from '../wizard-tavily-executor';
import type { ResolvedWizardExecution } from '../wizard-execution-types';
import type { IncrementalSearchInput, IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-0001';
const BATCH_ID = 'batch-uuid-0001';
const SUBINDUSTRY_ID = 'sub-uuid-0002';

const BASE_RESOLVED: ResolvedWizardExecution = {
  userId: USER_ID,
  clientRequestId: 'req-uuid-0003',
  mode: 'exploratory',
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: 'v2024-01' },
  industry: { id: 'ind-uuid-0004', slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    {
      id: SUBINDUSTRY_ID,
      slug: 'saas',
      name: 'SaaS',
      applicableCountries: ['CO'],
    },
  ],
  additionalCriteria: 'empresas con más de 200 empleados',
  systemControls: {
    targetCount: 25,
    minimumEmployees: 200,
    employeeThresholdMode: 'hard_filter',
  },
};

function makeFakeRunner(overrideBatchId?: string) {
  let capturedInput: IncrementalSearchInput | null = null;
  const runner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
    capturedInput = input;
    return {
      input,
      candidates: [],
      candidatesCount: 0,
      usefulCandidatesCount: 0,
      candidatesCreated: 5,
      metadata: {
        rounds_executed: 1,
        stopped_reason: 'min_useful_reached',
        total_raw_evaluated: 10,
        total_candidates_accumulated: 5,
        useful_candidates_count: 5,
        min_useful_candidates: 7,
        target_internal: 25,
        max_rounds: 2,
        max_total_raw_to_evaluate: 50,
        dry_run: false,
        rounds: [],
      },
      warnings: [],
      batchId: overrideBatchId ?? BATCH_ID,
    };
  };
  return { runner, getCapture: () => capturedInput };
}

function makeInput(overrides?: Partial<WizardTavilyInput>): WizardTavilyInput {
  return {
    resolved: BASE_RESOLVED,
    reservedBatchId: BATCH_ID,
    ...overrides,
  };
}

// ── E1: webSearchProvider is always 'tavily' ──────────────────────────────────

describe('E1: webSearchProvider is fixed to tavily', () => {
  it('runner receives webSearchProvider: tavily', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    const captured = getCapture();
    assert.ok(captured, 'runner must have been called');
    assert.equal(captured!.webSearchProvider, 'tavily');
  });
});

// ── E2: targetInternal equals WIZARD_TAVILY_TARGET_INTERNAL (25) ──────────────

describe('E2: targetInternal is fixed to WIZARD_TAVILY_TARGET_INTERNAL', () => {
  it('runner receives targetInternal: 25', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    const captured = getCapture();
    assert.ok(captured);
    assert.equal(captured!.targetInternal, WIZARD_TAVILY_TARGET_INTERNAL);
    assert.equal(WIZARD_TAVILY_TARGET_INTERNAL, 25);
  });
});

// ── E3: existingBatchId equals reservedBatchId ───────────────────────────────

describe('E3: existingBatchId is forwarded from reservedBatchId', () => {
  it('runner receives existingBatchId equal to input.reservedBatchId', async () => {
    const customBatchId = 'custom-batch-uuid';
    const { runner, getCapture } = makeFakeRunner(customBatchId);
    await runWizardTavilySearch(makeInput({ reservedBatchId: customBatchId }), runner);
    const captured = getCapture();
    assert.ok(captured);
    assert.equal(captured!.existingBatchId, customBatchId);
  });

  it('existingBatchId matches exactly — no fallback or transformation', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.existingBatchId, BATCH_ID);
  });
});

// ── E4: triggeredByUserId and ownerId equal userId from resolved ─────────────

describe('E4: triggeredByUserId and ownerId come from resolved.userId', () => {
  it('triggeredByUserId === resolved.userId', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.triggeredByUserId, USER_ID);
  });

  it('ownerId === resolved.userId', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.ownerId, USER_ID);
  });

  it('different userId propagates to both triggeredByUserId and ownerId', async () => {
    const otherUser = 'other-user-uuid';
    const modifiedResolved: ResolvedWizardExecution = { ...BASE_RESOLVED, userId: otherUser };
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch({ resolved: modifiedResolved, reservedBatchId: BATCH_ID }, runner);
    const captured = getCapture();
    assert.equal(captured!.triggeredByUserId, otherUser);
    assert.equal(captured!.ownerId, otherUser);
  });
});

// ── E5: dryRun is always false ────────────────────────────────────────────────

describe('E5: dryRun is always false', () => {
  it('runner receives dryRun: false', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.dryRun, false);
  });
});

// ── E6: country and industry from resolved context ───────────────────────────

describe('E6: country and industry are forwarded from resolved', () => {
  it('country name is resolved.country.name', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.country, 'Colombia');
  });

  it('countryCode is resolved.country.code', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.countryCode, 'CO');
  });

  it('industry is resolved.industry.name (canonical name only)', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.industry, 'Tecnología');
  });

  it('industry reflects canonical name from catalog, not subindustry', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    const captured = getCapture()!;
    assert.notEqual(captured.industry, 'SaaS');
    assert.equal(captured.industry, 'Tecnología');
  });
});

// ── E7: runner is called exactly once ────────────────────────────────────────

describe('E7: runner is called exactly once per invocation', () => {
  it('runner call count is 1', async () => {
    let callCount = 0;
    const countingRunner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
      callCount++;
      return {
        input,
        candidates: [],
        candidatesCount: 0,
        usefulCandidatesCount: 0,
        candidatesCreated: 0,
        metadata: {
          rounds_executed: 1,
          stopped_reason: 'max_rounds_reached',
          total_raw_evaluated: 0,
          total_candidates_accumulated: 0,
          useful_candidates_count: 0,
          min_useful_candidates: 7,
          target_internal: 25,
          max_rounds: 2,
          max_total_raw_to_evaluate: 50,
          dry_run: false,
          rounds: [],
        },
        warnings: [],
        batchId: BATCH_ID,
      };
    };
    await runWizardTavilySearch(makeInput(), countingRunner);
    assert.equal(callCount, 1);
  });
});

// ── E9: subindustries forwarded from resolved context ────────────────────────

describe('E9: subindustries are forwarded to the incremental search runner', () => {
  it('runner receives subindustries array with canonical names', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    const captured = getCapture();
    assert.ok(captured);
    assert.ok(Array.isArray(captured!.subindustries), 'subindustries must be an array');
    assert.deepEqual(captured!.subindustries, ['SaaS']);
  });

  it('subindustries array has one entry matching the resolved subindustry name', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    assert.equal(getCapture()!.subindustries?.length, 1);
    assert.equal(getCapture()!.subindustries?.[0], 'SaaS');
  });

  it('multiple subindustries all forwarded', async () => {
    const multiSubResolved: ResolvedWizardExecution = {
      ...BASE_RESOLVED,
      subindustries: [
        { id: 'sub-1', slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] },
        { id: 'sub-2', slug: 'edtech', name: 'EdTech', applicableCountries: ['CO'] },
      ],
    };
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch({ resolved: multiSubResolved, reservedBatchId: BATCH_ID }, runner);
    assert.deepEqual(getCapture()!.subindustries, ['SaaS', 'EdTech']);
  });

  it('empty subindustries forwards empty array', async () => {
    const noSubResolved: ResolvedWizardExecution = {
      ...BASE_RESOLVED,
      subindustries: [],
    };
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch({ resolved: noSubResolved, reservedBatchId: BATCH_ID }, runner);
    assert.deepEqual(getCapture()!.subindustries, []);
  });
});

// ── E10: maxRounds equals WIZARD_ADAPTIVE_MAX_ROUNDS (4) ─────────────────────

describe('E10: maxRounds is fixed to WIZARD_ADAPTIVE_MAX_ROUNDS (4)', () => {
  it('runner receives maxRounds: 4', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    const captured = getCapture();
    assert.ok(captured, 'runner must have been called');
    assert.equal(captured!.maxRounds, WIZARD_ADAPTIVE_MAX_ROUNDS);
    assert.equal(WIZARD_ADAPTIVE_MAX_ROUNDS, 4);
  });
});

// ── E11: targetPersistibleCandidates equals WIZARD_TARGET_PERSISTIBLE_CANDIDATES (10) ──

describe('E11: targetPersistibleCandidates is fixed to WIZARD_TARGET_PERSISTIBLE_CANDIDATES (10)', () => {
  it('runner receives targetPersistibleCandidates: 10', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(), runner);
    const captured = getCapture();
    assert.ok(captured, 'runner must have been called');
    assert.equal(captured!.targetPersistibleCandidates, WIZARD_TARGET_PERSISTIBLE_CANDIDATES);
    assert.equal(WIZARD_TARGET_PERSISTIBLE_CANDIDATES, 10);
  });
});

// ── E8: Apollo paths are not reachable from this module ──────────────────────

describe('E8: structural guardrail — executor does not reference Apollo', () => {
  it('wizard-tavily-executor.ts source does not import Apollo-related identifiers', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor.ts'),
      'utf-8',
    );
    const forbidden = [
      'generateAIProspectBatch',
      'runProspectGenerationAgent',
      'searchApolloOrganizations',
      'generateTavilyProspectBatch',
    ];
    for (const name of forbidden) {
      assert.ok(!source.includes(name), `executor must not reference: ${name}`);
    }
  });
});
