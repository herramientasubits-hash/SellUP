/**
 * AGENT1-CLAUDE-COMPANY-SEARCH-AUTO-1 — Claude busca empresas como ÚLTIMO paso de la
 * corrida (decisión de la dueña 02-10: automático). Sólo si falta para la meta y queda
 * tiempo; escribe en el mismo lote y suma a la misma cuenta de aceptadas.
 * Sin Supabase real. Sin proveedores. Sin LLM.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { ResolvedWizardExecution } from '../wizard-execution-types';
import {
  decideClaudeSearchLeg,
  CLAUDE_SEARCH_LEG_MIN_REMAINING_MS,
  type ClaudeSearchLegOutcome,
} from '../wizard-claude-search-leg';

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
    // A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — el esquema está listo: este doble
    // no ejercita el preflight de persistencia.
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    // A1-APOLLO-WIZARD-1: el preflight de Apollo falla cerrado, así que las
    // pruebas que ejercitan la ruta Apollo deben declararlo disponible.
    checkApolloAvailability: async () => ({ available: true } as const),
    reserveBudget: async () => ({ status: 'reserved', reservationId: 'res-001', creditsReserved: 20 }),
    // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — puerta real de Apollo.
    checkApolloProviderQuota: async () => ({ status: 'available', providerCreditsAvailable: 999 }),
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


function withTruth(batchId: string, created: number, complete: number): IncrementalSearchOutput {
  return {
    ...makePipelineOutput(batchId),
    candidatesCreated: created,
    persistenceOutcome: { completeValidCandidates: complete } as IncrementalSearchOutput['persistenceOutcome'],
  };
}

const CLAUDE_EXECUTED: ClaudeSearchLegOutcome = {
  executed: true,
  persistedCandidates: 3,
  completeValidCandidates: 2,
  acceptedIdentities: ['candidate:c1', 'candidate:c2'],
  estimatedCostUsd: 0.24,
  proposed: 10,
  passedPreFilter: 4,
};

function legDeps(opts: {
  apolloCreated: number;
  apolloComplete: number;
  calls: Array<{ batchId: string; phaseMs: number }>;
  overrides?: Partial<WizardExecutionDeps>;
}): WizardExecutionDeps {
  const now = Date.now();
  return makeBaseDeps({
    resolveProvider: () => 'apollo_organizations',
    resolveTavilyFirst: () => false,
    runApolloPipeline: async ({ reservedBatchId }) => withTruth(reservedBatchId, opts.apolloCreated, opts.apolloComplete),
    runLushaWaterfallLeg: async () => ({ executed: false, reason: 'waterfall_flag_disabled' }) as never,
    resolveClaudeSearchLeg: () => true,
    runClaudeCompanySearchLeg: async (input) => {
      opts.calls.push(input);
      return CLAUDE_EXECUTED;
    },
    actionStartedAtMs: now,
    nowMs: () => now + 60_000,
    ...opts.overrides,
  });
}

describe('Claude como último paso de la corrida', () => {
  it('falta para la meta y hay tiempo ⇒ Claude corre en el MISMO lote y suma a las cifras', async () => {
    const calls: Array<{ batchId: string; phaseMs: number }> = [];
    const published: Array<Record<string, unknown>> = [];
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      legDeps({
        apolloCreated: 4,
        apolloComplete: 2,
        calls,
        overrides: { publishWaterfallLegTrace: async ({ published: p }) => (published.push(p), { status: 'published' }) as never },
      }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].batchId, BATCH_ID);
    assert.equal(result.ok && result.candidateCount, 7, '4 de Apollo + 3 de Claude');
    assert.equal(result.ok && result.acceptedForTarget?.acceptedPaidForTarget, 4, '2 de Apollo + 2 de Claude');
    assert.equal(result.ok && (result as { claudeSearchLeg?: { executed: boolean } }).claudeSearchLeg?.executed, true);
    assert.ok(published.some((p) => p.claude_search_leg && p.accepted_for_target), 'la traza y el bloque combinado quedan en el lote');
  });

  it('bandera apagada ⇒ Claude no se llama y las cifras son las de siempre', async () => {
    const calls: Array<{ batchId: string; phaseMs: number }> = [];
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      legDeps({ apolloCreated: 4, apolloComplete: 2, calls, overrides: { resolveClaudeSearchLeg: () => false } }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.length, 0);
    assert.equal(result.ok && result.candidateCount, 4);
  });

  it('la meta ya está cubierta ⇒ Claude no se paga', async () => {
    const calls: Array<{ batchId: string; phaseMs: number }> = [];
    const result = await executeProspectWizardGeneration(VALID_REQUEST, legDeps({ apolloCreated: 12, apolloComplete: 12, calls }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.length, 0);
  });

  it('no queda tiempo ⇒ Claude no empieza', async () => {
    const calls: Array<{ batchId: string; phaseMs: number }> = [];
    const now = Date.now();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      legDeps({ apolloCreated: 1, apolloComplete: 0, calls, overrides: { actionStartedAtMs: now, nowMs: () => now + 200_000 } }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.length, 0);
  });

  it('si el paso de Claude falla, la corrida termina igual', async () => {
    const calls: Array<{ batchId: string; phaseMs: number }> = [];
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      legDeps({
        apolloCreated: 4,
        apolloComplete: 2,
        calls,
        overrides: {
          runClaudeCompanySearchLeg: async () => {
            throw new Error('claude down');
          },
        },
      }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.candidateCount, 4);
  });
});

describe('traza de Lusha sin las filas de Claude', () => {
  it('con Lusha y Claude en la misma corrida, la traza de Lusha cuenta sólo lo suyo', async () => {
    const calls: Array<{ batchId: string; phaseMs: number }> = [];
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      legDeps({
        apolloCreated: 1,
        apolloComplete: 0,
        calls,
        overrides: {
          runLushaWaterfallLeg: async () =>
            ({
              executed: true,
              gap: 5,
              clientRequestId: 'lusha-1',
              result: { insertedCandidatesCount: 2, multiBranch: { acceptedForTargetTotal: null } },
            }) as never,
        },
      }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.length, 1);
    const trace = (result as { lushaWaterfallLeg?: { persistedCandidates: number | null } }).lushaWaterfallLeg;
    assert.equal(trace?.persistedCandidates, 2, 'sólo las 2 de Lusha, no las 3 de Claude');
    assert.equal(result.ok && result.candidateCount, 6, '1 Apollo + 2 Lusha + 3 Claude');
  });
});

describe('decideClaudeSearchLeg', () => {
  const base = { enabled: true, tavilyFirstSatisfied: false, target: 10, acceptedSoFar: 4, elapsedMs: 60_000 };
  it('corre con el tiempo acotado y dice cuántas faltan', () => {
    const d = decideClaudeSearchLeg(base);
    assert.equal(d.run, true);
    if (d.run) {
      assert.equal(d.missing, 6);
      assert.ok(d.phaseMs > 0 && d.phaseMs <= 120_000);
    }
  });
  it('motivos para no correr', () => {
    assert.deepEqual(decideClaudeSearchLeg({ ...base, enabled: false }), { run: false, reason: 'flag_disabled' });
    assert.deepEqual(decideClaudeSearchLeg({ ...base, tavilyFirstSatisfied: true }), { run: false, reason: 'tavily_first_reviewable_met' });
    assert.deepEqual(decideClaudeSearchLeg({ ...base, acceptedSoFar: 10 }), { run: false, reason: 'target_met' });
    assert.deepEqual(decideClaudeSearchLeg({ ...base, elapsedMs: null }), { run: false, reason: 'run_start_unknown' });
    assert.deepEqual(
      decideClaudeSearchLeg({ ...base, elapsedMs: 300_000 - CLAUDE_SEARCH_LEG_MIN_REMAINING_MS + 1 }),
      { run: false, reason: 'not_enough_time' },
    );
  });
});
