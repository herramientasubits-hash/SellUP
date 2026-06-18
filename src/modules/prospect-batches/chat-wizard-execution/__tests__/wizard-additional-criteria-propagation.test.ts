/**
 * Tests — Additional criteria propagation through the wizard pipeline (16AB.43.23)
 *
 * Verifies that:
 *   a) runWizardTavilySearch forwards additionalCriteria from resolved context
 *      to the incremental search runner.
 *   b) additionalCriteria=null is forwarded (not silently dropped).
 *   c) additionalCriteria with content arrives intact.
 *
 * Uses Node.js built-in test runner. No Tavily, no Supabase, no LLM calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runWizardTavilySearch } from '../wizard-tavily-executor';
import type { WizardTavilyInput } from '../wizard-tavily-executor';
import type { ResolvedWizardExecution } from '../wizard-execution-types';
import type { IncrementalSearchInput, IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-0001';
const BATCH_ID = 'batch-uuid-0001';

const BASE_RESOLVED: ResolvedWizardExecution = {
  userId: USER_ID,
  clientRequestId: 'req-uuid-0003',
  mode: 'exploratory',
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: 'v2024-01' },
  industry: { id: 'ind-uuid-0004', slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    { id: 'sub-uuid-0005', slug: 'edtech', name: 'EdTech', applicableCountries: ['CO'] },
  ],
  additionalCriteria: null,
  systemControls: {
    targetCount: 25,
    minimumEmployees: 200,
    employeeThresholdMode: 'hard_filter',
  },
};

function makeFakeRunner() {
  let capturedInput: IncrementalSearchInput | null = null;
  const runner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
    capturedInput = input;
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
  return { runner, getCapture: () => capturedInput };
}

function makeInput(additionalCriteria: string | null): WizardTavilyInput {
  return {
    resolved: { ...BASE_RESOLVED, additionalCriteria },
    reservedBatchId: BATCH_ID,
  };
}

// ── AC1: null criteria forwarded explicitly ────────────────────────────────────

describe('AC1 — additionalCriteria null is forwarded to runner', () => {

  it('AC1-a: runner receives additionalCriteria: null', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(null), runner);
    const captured = getCapture();
    assert.ok(captured, 'runner must have been called');
    assert.strictEqual(captured!.additionalCriteria, null);
  });

  it('AC1-b: additionalCriteria field is present in captured input', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(null), runner);
    const captured = getCapture();
    assert.ok(captured);
    assert.ok('additionalCriteria' in captured!, 'additionalCriteria key must be present in input');
  });
});

// ── AC2: non-null criteria forwarded intact ────────────────────────────────────

describe('AC2 — additionalCriteria with content is forwarded intact', () => {
  const CRITERIA = 'empresas con sede en Bogotá y más de 100 empleados, sector tecnología';

  it('AC2-a: runner receives the exact criteria string', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(CRITERIA), runner);
    assert.equal(getCapture()!.additionalCriteria, CRITERIA);
  });

  it('AC2-b: criteria not truncated or transformed', async () => {
    const longCriteria = 'A'.repeat(500);
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(longCriteria), runner);
    assert.equal(getCapture()!.additionalCriteria, longCriteria);
  });

  it('AC2-c: changing criteria produces different runner input', async () => {
    const { runner: r1, getCapture: gc1 } = makeFakeRunner();
    const { runner: r2, getCapture: gc2 } = makeFakeRunner();
    await runWizardTavilySearch(makeInput(null), r1);
    await runWizardTavilySearch(makeInput('criterio específico'), r2);
    assert.notEqual(gc1()!.additionalCriteria, gc2()!.additionalCriteria);
  });
});

// ── AC3: criteria propagation is independent of subindustry content ───────────

describe('AC3 — additionalCriteria propagation is independent of subindustry', () => {

  it('AC3-a: EdTech subindustry + non-null criteria both forwarded', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(makeInput('empresas con campus virtual'), runner);
    const captured = getCapture();
    assert.equal(captured!.additionalCriteria, 'empresas con campus virtual');
    assert.deepEqual(captured!.subindustries, ['EdTech']);
  });

  it('AC3-b: empty subindustries + non-null criteria both forwarded', async () => {
    const inputNoSubs: WizardTavilyInput = {
      resolved: { ...BASE_RESOLVED, subindustries: [], additionalCriteria: 'min 50 empleados' },
      reservedBatchId: BATCH_ID,
    };
    const { runner, getCapture } = makeFakeRunner();
    await runWizardTavilySearch(inputNoSubs, runner);
    assert.equal(getCapture()!.additionalCriteria, 'min 50 empleados');
  });
});
