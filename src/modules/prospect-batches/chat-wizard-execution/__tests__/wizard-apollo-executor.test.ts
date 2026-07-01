/**
 * Tests — Wizard Apollo Executor (v1.16K-Y)
 *
 * Verifica que runWizardApolloSearch configura todos los parámetros requeridos
 * antes de llamar al pipeline incremental. Usa fake runner — sin llamadas reales a Apollo.
 *
 * Garantías clave:
 *   - webSearchProvider es siempre 'apollo_organizations'
 *   - usageInputContext.batchId es el reservedBatchId
 *   - No llama a Tavily
 *   - ENABLE_APOLLO_COMPANY_SEARCH respetado en provider-level (no en executor)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runWizardApolloSearch,
  WIZARD_APOLLO_TARGET_INTERNAL,
  WIZARD_APOLLO_MAX_ROUNDS,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import type { WizardApolloInput } from '../wizard-apollo-executor';
import type { ResolvedWizardExecution } from '../wizard-execution-types';
import type { IncrementalSearchInput, IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-apollo-0001';
const BATCH_ID = 'batch-apollo-0001';

const BASE_RESOLVED: ResolvedWizardExecution = {
  userId: USER_ID,
  clientRequestId: 'req-apollo-0002',
  mode: 'exploratory',
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: 'v2024-01' },
  industry: { id: 'ind-uuid-0003', slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    { id: 'sub-uuid-0004', slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] },
  ],
  additionalCriteria: 'más de 100 empleados',
  systemControls: {
    targetCount: 25,
    minimumEmployees: 100,
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
      candidatesCreated: 3,
      metadata: {
        rounds_executed: 1,
        stopped_reason: 'min_useful_reached',
        total_raw_evaluated: 5,
        total_candidates_accumulated: 3,
        useful_candidates_count: 3,
        min_useful_candidates: 7,
        target_internal: 25,
        max_rounds: 4,
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

function makeInput(overrides?: Partial<WizardApolloInput>): WizardApolloInput {
  return {
    resolved: BASE_RESOLVED,
    reservedBatchId: BATCH_ID,
    ...overrides,
  };
}

// ── A1: webSearchProvider es siempre 'apollo_organizations' ──────────────────

describe('A1: webSearchProvider is fixed to apollo_organizations', () => {
  it('runner receives webSearchProvider: apollo_organizations', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    const captured = getCapture();
    assert.ok(captured, 'runner must have been called');
    assert.equal(captured!.webSearchProvider, 'apollo_organizations');
  });

  it('webSearchProvider is never tavily', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.notEqual(getCapture()!.webSearchProvider, 'tavily');
  });
});

// ── A2: targetInternal equals WIZARD_APOLLO_TARGET_INTERNAL (25) ─────────────

describe('A2: targetInternal is fixed to WIZARD_APOLLO_TARGET_INTERNAL', () => {
  it('runner receives targetInternal: 25', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.targetInternal, WIZARD_APOLLO_TARGET_INTERNAL);
    assert.equal(WIZARD_APOLLO_TARGET_INTERNAL, 25);
  });
});

// ── A3: existingBatchId equals reservedBatchId ───────────────────────────────

describe('A3: existingBatchId forwarded from reservedBatchId', () => {
  it('runner receives existingBatchId equal to input.reservedBatchId', async () => {
    const customBatch = 'custom-apollo-batch';
    const { runner, getCapture } = makeFakeRunner(customBatch);
    await runWizardApolloSearch(makeInput({ reservedBatchId: customBatch }), runner);
    assert.equal(getCapture()!.existingBatchId, customBatch);
  });
});

// ── A4: usageInputContext contains batchId ────────────────────────────────────

describe('A4: usageInputContext carries batchId for Apollo logging', () => {
  it('runner receives usageInputContext.batchId equal to reservedBatchId', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.usageInputContext?.batchId, BATCH_ID);
  });

  it('runner receives usageInputContext.triggeredByUserId equal to userId', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.usageInputContext?.triggeredByUserId, USER_ID);
  });

  it('custom batchId flows into usageInputContext', async () => {
    const customBatch = 'batch-custom-apollo';
    const { runner, getCapture } = makeFakeRunner(customBatch);
    await runWizardApolloSearch(makeInput({ reservedBatchId: customBatch }), runner);
    assert.equal(getCapture()!.usageInputContext?.batchId, customBatch);
  });
});

// ── A5: triggeredByUserId and ownerId come from resolved.userId ───────────────

describe('A5: triggeredByUserId and ownerId from resolved.userId', () => {
  it('triggeredByUserId === resolved.userId', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.triggeredByUserId, USER_ID);
  });

  it('ownerId === resolved.userId', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.ownerId, USER_ID);
  });
});

// ── A6: dryRun is always false ────────────────────────────────────────────────

describe('A6: dryRun is always false', () => {
  it('runner receives dryRun: false', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.dryRun, false);
  });
});

// ── A7: maxRounds and targetPersistibleCandidates ────────────────────────────

describe('A7: maxRounds and targetPersistibleCandidates are fixed', () => {
  it('runner receives maxRounds: 4', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.maxRounds, WIZARD_APOLLO_MAX_ROUNDS);
    assert.equal(WIZARD_APOLLO_MAX_ROUNDS, 4);
  });

  it('runner receives targetPersistibleCandidates: 10', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.equal(getCapture()!.targetPersistibleCandidates, WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES);
    assert.equal(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES, 10);
  });
});

// ── A8: subindustries forwarded ───────────────────────────────────────────────

describe('A8: subindustries forwarded from resolved context', () => {
  it('runner receives subindustries with canonical names', async () => {
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch(makeInput(), runner);
    assert.deepEqual(getCapture()!.subindustries, ['SaaS']);
  });

  it('empty subindustries forwards empty array', async () => {
    const noSubResolved: ResolvedWizardExecution = { ...BASE_RESOLVED, subindustries: [] };
    const { runner, getCapture } = makeFakeRunner();
    await runWizardApolloSearch({ resolved: noSubResolved, reservedBatchId: BATCH_ID }, runner);
    assert.deepEqual(getCapture()!.subindustries, []);
  });
});

// ── A9: runner called exactly once ───────────────────────────────────────────

describe('A9: runner called exactly once per invocation', () => {
  it('runner call count is 1', async () => {
    let callCount = 0;
    const countingRunner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
      callCount++;
      return {
        input, candidates: [], candidatesCount: 0, usefulCandidatesCount: 0, candidatesCreated: 0,
        metadata: {
          rounds_executed: 1, stopped_reason: 'max_rounds_reached', total_raw_evaluated: 0,
          total_candidates_accumulated: 0, useful_candidates_count: 0, min_useful_candidates: 7,
          target_internal: 25, max_rounds: 4, max_total_raw_to_evaluate: 50, dry_run: false, rounds: [],
        },
        warnings: [], batchId: BATCH_ID,
      };
    };
    await runWizardApolloSearch(makeInput(), countingRunner);
    assert.equal(callCount, 1);
  });
});

// ── A10: structural — no Tavily reference ─────────────────────────────────────

describe('A10: structural guardrail — executor does not reference Tavily', () => {
  it('wizard-apollo-executor.ts source does not import Tavily identifiers', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts'),
      'utf-8',
    );
    // Check import statements only — comments may mention Tavily for documentation
    const importLines = source.split('\n').filter((l) => l.trim().startsWith('import'));
    const forbiddenImports = ['runTavilyWebSearch', 'WIZARD_TAVILY', 'wizard-tavily-executor'];
    for (const name of forbiddenImports) {
      assert.ok(
        !importLines.some((l) => l.includes(name)),
        `apollo executor imports must not reference: ${name}`,
      );
    }
  });
});
