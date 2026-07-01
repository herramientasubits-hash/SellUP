/**
 * Tests — Wizard Execution Routing (v1.16K-Y)
 *
 * Verifica que executeProspectWizardGeneration enruta correctamente
 * entre Tavily y Apollo según el provider resuelto.
 *
 * Garantías clave:
 *   - provider=tavily → llama runTavilyPipeline, NO runApolloPipeline
 *   - provider=apollo_organizations → llama runApolloPipeline, NO runTavilyPipeline
 *   - Sin ambos providers configurados + Apollo flag off → fallback a Tavily
 *   - Doble ejecución (Tavily + Apollo en misma corrida) es imposible
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { ResolvedWizardExecution } from '../wizard-execution-types';

// ── Feature flag setup ────────────────────────────────────────────────────────
// executeProspectWizardGeneration checks ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION first.
// Enable it for all tests in this file.

let savedExecutionFlag: string | undefined;
beforeEach(() => {
  savedExecutionFlag = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
});
afterEach(() => {
  if (savedExecutionFlag !== undefined) {
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = savedExecutionFlag;
  } else {
    delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BATCH_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';

const VALID_REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [SUBINDUSTRY_ID],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG_RESULT = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [{ id: SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] }],
};

function makePipelineOutput(batchId: string): IncrementalSearchOutput {
  const fakeResolved = {} as ResolvedWizardExecution;
  return {
    input: {
      country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', subindustries: ['SaaS'],
      additionalCriteria: null, webSearchProvider: 'tavily', targetInternal: 25, maxRounds: 4,
      targetPersistibleCandidates: 10, existingBatchId: batchId, triggeredByUserId: USER_ID,
      ownerId: USER_ID, dryRun: false,
    },
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: 0,
    candidatesCreated: 5,
    metadata: {
      rounds_executed: 1, stopped_reason: 'min_useful_reached', total_raw_evaluated: 10,
      total_candidates_accumulated: 5, useful_candidates_count: 5, min_useful_candidates: 7,
      target_internal: 25, max_rounds: 4, max_total_raw_to_evaluate: 50, dry_run: false, rounds: [],
    },
    warnings: [],
    batchId,
  };
}

function makeBaseDeps(overrides: Partial<WizardExecutionDeps> = {}): WizardExecutionDeps {
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG_RESULT,
    checkTavilyAvailability: async () => true,
    reserveBudget: async () => ({ status: 'reserved', reservationId: 'res-001', creditsReserved: 20 }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 5,
    reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_ID }),
    runTavilyPipeline: async () => { throw new Error('Tavily should not be called'); },
    runApolloPipeline: async () => { throw new Error('Apollo should not be called'); },
    resolveProvider: () => 'tavily',
    markBatchFailed: async () => undefined,
    ...overrides,
  };
}

// ── R1: Tavily route ──────────────────────────────────────────────────────────

describe('R1: provider=tavily routes to runTavilyPipeline only', () => {
  it('calls runTavilyPipeline and does not call runApolloPipeline', async () => {
    let tavilyCalled = false;
    let apolloCalled = false;

    const deps = makeBaseDeps({
      resolveProvider: () => 'tavily',
      runTavilyPipeline: async ({ reservedBatchId }) => {
        tavilyCalled = true;
        return makePipelineOutput(reservedBatchId);
      },
      runApolloPipeline: async () => {
        apolloCalled = true;
        return makePipelineOutput(BATCH_ID);
      },
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.ok(result.ok, `Expected ok result, got: ${JSON.stringify(result)}`);
    assert.equal(tavilyCalled, true, 'runTavilyPipeline must have been called');
    assert.equal(apolloCalled, false, 'runApolloPipeline must NOT have been called');
  });

  it('checkTavilyAvailability is called for Tavily provider', async () => {
    let availabilityChecked = false;

    const deps = makeBaseDeps({
      resolveProvider: () => 'tavily',
      checkTavilyAvailability: async () => { availabilityChecked = true; return true; },
      runTavilyPipeline: async ({ reservedBatchId }) => makePipelineOutput(reservedBatchId),
    });

    await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.equal(availabilityChecked, true, 'Tavily availability must be checked');
  });
});

// ── R2: Apollo route ──────────────────────────────────────────────────────────

describe('R2: provider=apollo_organizations routes to runApolloPipeline only', () => {
  it('calls runApolloPipeline and does not call runTavilyPipeline', async () => {
    let tavilyCalled = false;
    let apolloCalled = false;

    const deps = makeBaseDeps({
      resolveProvider: () => 'apollo_organizations',
      runTavilyPipeline: async () => {
        tavilyCalled = true;
        return makePipelineOutput(BATCH_ID);
      },
      runApolloPipeline: async ({ reservedBatchId }) => {
        apolloCalled = true;
        return makePipelineOutput(reservedBatchId);
      },
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.ok(result.ok, `Expected ok result, got: ${JSON.stringify(result)}`);
    assert.equal(apolloCalled, true, 'runApolloPipeline must have been called');
    assert.equal(tavilyCalled, false, 'runTavilyPipeline must NOT have been called');
  });

  it('checkTavilyAvailability is NOT called for Apollo provider', async () => {
    let availabilityChecked = false;

    const deps = makeBaseDeps({
      resolveProvider: () => 'apollo_organizations',
      checkTavilyAvailability: async () => { availabilityChecked = true; return true; },
      runApolloPipeline: async ({ reservedBatchId }) => makePipelineOutput(reservedBatchId),
    });

    await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.equal(availabilityChecked, false, 'Tavily availability must NOT be checked for Apollo');
  });
});

// ── R3: No doble ejecución ────────────────────────────────────────────────────

describe('R3: no double execution — only one provider runs per invocation', () => {
  it('Tavily route: total pipeline calls = 1', async () => {
    let totalCalls = 0;

    const deps = makeBaseDeps({
      resolveProvider: () => 'tavily',
      runTavilyPipeline: async ({ reservedBatchId }) => { totalCalls++; return makePipelineOutput(reservedBatchId); },
      runApolloPipeline: async ({ reservedBatchId }) => { totalCalls++; return makePipelineOutput(reservedBatchId); },
    });

    await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.equal(totalCalls, 1, 'Exactly one pipeline must run');
  });

  it('Apollo route: total pipeline calls = 1', async () => {
    let totalCalls = 0;

    const deps = makeBaseDeps({
      resolveProvider: () => 'apollo_organizations',
      runTavilyPipeline: async ({ reservedBatchId }) => { totalCalls++; return makePipelineOutput(reservedBatchId); },
      runApolloPipeline: async ({ reservedBatchId }) => { totalCalls++; return makePipelineOutput(reservedBatchId); },
    });

    await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.equal(totalCalls, 1, 'Exactly one pipeline must run');
  });
});

// ── R4: Apollo sin pipeline configurado → falla controlada ───────────────────

describe('R4: Apollo route with missing runApolloPipeline → controlled failure', () => {
  it('returns GENERATION_FAILED when Apollo selected but pipeline not configured', async () => {
    const deps = makeBaseDeps({
      resolveProvider: () => 'apollo_organizations',
      runApolloPipeline: undefined,
    });

    const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
    assert.equal(result.ok, false);
    assert.ok('code' in result);
    assert.equal((result as { code: string }).code, 'GENERATION_FAILED');
  });
});

// ── R5: Default (sin resolveProvider) → Tavily ────────────────────────────────

describe('R5: no resolveProvider dep → default is Tavily', () => {
  it('Tavily pipeline runs when resolveProvider is not injected (env default)', async () => {
    // Sin env AGENT1_WIZARD_DISCOVERY_PROVIDER, el resolver devuelve 'tavily'
    let tavilyCalled = false;
    const prevEnv = process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;
    delete process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;

    try {
      const deps = makeBaseDeps({
        resolveProvider: undefined, // no override — usa resolveWizardDiscoveryProvider()
        runTavilyPipeline: async ({ reservedBatchId }) => { tavilyCalled = true; return makePipelineOutput(reservedBatchId); },
        runApolloPipeline: async () => { throw new Error('Apollo must not run'); },
      });

      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.ok(result.ok, `Expected ok result, got: ${JSON.stringify(result)}`);
      assert.equal(tavilyCalled, true, 'Tavily must run when no provider override');
    } finally {
      if (prevEnv !== undefined) process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = prevEnv;
    }
  });
});
