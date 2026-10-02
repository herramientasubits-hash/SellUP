/**
 * AGENT1-TAVILY-FIRST-1 — Tavily primero; Apollo → Lusha sólo si Tavily no trae
 * suficientes empresas para revisar.
 *
 * Decisión de la dueña (01-10): Tavily es gratis (1.000 créditos al mes), así
 * que va primero en toda corrida; Apollo y Lusha completan lo que falte. Opción
 * C: la corrida termina con Tavily si deja al menos tantas empresas para revisar
 * (no duplicadas ni descartadas) como el objetivo; si no, Apollo completa en la
 * misma corrida. Cualquier tropiezo de Tavily (cuota en Proveedores, error) ⇒
 * Apollo como siempre: la corrida nunca falla por Tavily.
 * Sin Supabase real. Sin proveedores. Sin LLM.
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

// ── Tavily primero ───────────────────────────────────────────────────────────

type Calls = { tavily: number; apollo: number; lusha: number; reserve: number; confirm: number; tavilyMaxRounds: Array<number | undefined> };

function tavilyFirstDeps(opts: {
  reviewable: number | null;
  calls: Calls;
  overrides?: Partial<WizardExecutionDeps>;
}): WizardExecutionDeps {
  const { calls } = opts;
  return makeBaseDeps({
    // El modo automático resuelve Apollo; Tavily-first entra antes.
    resolveProvider: () => 'apollo_organizations',
    resolveTavilyFirst: () => true,
    checkTavilyProviderQuota: async () => ({ status: 'available', providerCreditsAvailable: 1000 }),
    countReviewableCandidates: async () => opts.reviewable,
    reserveBudget: async () => { calls.reserve++; return { status: 'reserved', reservationId: 'res-tf', creditsReserved: 20 }; },
    confirmBudget: async () => { calls.confirm++; return { status: 'confirmed' as const }; },
    runTavilyPipeline: async (input) => {
      calls.tavily++;
      calls.tavilyMaxRounds.push((input as { maxRounds?: number }).maxRounds);
      return makePipelineOutput(input.reservedBatchId);
    },
    runApolloPipeline: async ({ reservedBatchId }) => { calls.apollo++; return makePipelineOutput(reservedBatchId); },
    runLushaWaterfallLeg: async () => { calls.lusha++; return { executed: false, reason: 'waterfall_flag_disabled' } as never; },
    ...opts.overrides,
  });
}

function newCalls(): Calls {
  return { tavily: 0, apollo: 0, lusha: 0, reserve: 0, confirm: 0, tavilyMaxRounds: [] };
}

describe('Tavily primero (AGENT1-TAVILY-FIRST-1)', () => {
  it('bandera apagada: la corrida es Apollo como siempre, Tavily no se llama', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      tavilyFirstDeps({ reviewable: 9, calls, overrides: { resolveTavilyFirst: () => false } }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.tavily, 0);
    assert.equal(calls.apollo, 1);
  });

  it('Tavily deja ≥ objetivo para revisar ⇒ Apollo y Lusha NO se llaman', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({ reviewable: 7, calls }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.tavily, 1);
    assert.equal(calls.apollo, 0, 'Apollo no se paga si Tavily ya dejó suficientes para revisar');
    assert.equal(calls.lusha, 0, 'Lusha tampoco');
    assert.equal(calls.reserve, 0, 'Tavily se rige por Proveedores: no usa el pool del piloto');
    assert.equal(calls.confirm, 0);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'satisfied');
  });

  it('el tramo de Tavily corre con 3 rondas (cabe: Tavily tarda < 1 min)', async () => {
    const calls = newCalls();
    await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({ reviewable: 1, calls }));
    assert.deepEqual(calls.tavilyMaxRounds, [3]);
  });

  it('Tavily deja pocas para revisar ⇒ Apollo completa en la misma corrida', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({ reviewable: 2, calls }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.tavily, 1);
    assert.equal(calls.apollo, 1);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'apollo_completed');
  });

  it('cuota de Tavily en Proveedores agotada ⇒ Apollo directo, sin error', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 9, calls,
      overrides: { checkTavilyProviderQuota: async () => ({ status: 'blocked', providerCreditsAvailable: 0 }) },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.tavily, 0);
    assert.equal(calls.apollo, 1);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'skipped' && result.tavilyFirst.skipReason === 'provider_quota_exhausted');
  });

  it('Tavily falla ⇒ Apollo sigue; la corrida no falla', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 9, calls,
      overrides: { runTavilyPipeline: async () => { calls.tavily++; throw new Error('tavily down'); } },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.apollo, 1);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'failed');
  });

  it('no se puede contar lo revisable ⇒ Apollo completa (fail-closed hacia buscar más)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({ reviewable: null, calls }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.apollo, 1);
  });

  it('si el proveedor resuelto ya es Tavily, no hay doble tramo', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls, overrides: { resolveProvider: () => 'tavily' },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.tavily, 1);
    assert.equal(calls.apollo, 0);
  });
});

describe('Tavily + Apollo en la misma corrida: las cifras se suman, medidas', () => {
  function withTruth(batchId: string, created: number, complete: number): IncrementalSearchOutput {
    return {
      ...makePipelineOutput(batchId),
      candidatesCreated: created,
      persistenceOutcome: { completeValidCandidates: complete } as IncrementalSearchOutput['persistenceOutcome'],
    };
  }

  it('candidateCount y aceptadas juntan los dos tramos; el lote publica el bloque combinado', async () => {
    const calls = newCalls();
    const published: Array<Record<string, unknown>> = [];
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 2, calls,
      overrides: {
        runTavilyPipeline: async ({ reservedBatchId }) => { calls.tavily++; return withTruth(reservedBatchId, 3, 1); },
        runApolloPipeline: async ({ reservedBatchId }) => { calls.apollo++; return withTruth(reservedBatchId, 4, 2); },
        publishWaterfallLegTrace: async ({ published: p }) => { published.push(p); return { status: 'published' } as never; },
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.candidateCount, 7, '3 de Tavily + 4 de Apollo');
    assert.equal(result.ok && result.acceptedForTarget?.acceptedPaidForTarget, 3, '1 de Tavily + 2 de Apollo');
    assert.equal(published.length, 1);
    assert.ok(published[0].accepted_for_target, 'se republica el bloque combinado');
    assert.deepEqual((published[0].tavily_first_leg as { outcome: string }).outcome, 'apollo_completed');
  });

  it('si Tavily basta, el total es sólo Tavily y Lusha queda registrada como saltada', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 6, calls,
      overrides: { runTavilyPipeline: async ({ reservedBatchId }) => { calls.tavily++; return withTruth(reservedBatchId, 8, 0); } },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.ok && result.candidateCount, 8);
    assert.equal(calls.apollo, 0);
  });
});

// ── AGENT1-TAVILY-FIRST-2 — Claude revisa DENTRO de la corrida antes de decidir ─
//
// Prod 01-10 (CL×Salud, 34eeac5a): Tavily dejó 9 para revisar, la corrida
// terminó sin Apollo, y después Claude descartó 5 ⇒ el vendedor recibió 4.

function sequence(values: Array<number | null>): () => Promise<number | null> {
  let i = 0;
  return async () => values[Math.min(i++, values.length - 1)];
}

function clock(startMs: number, stepsMs: number[]): { nowMs: () => number } {
  let i = 0;
  return { nowMs: () => startMs + (stepsMs[Math.min(i++, stepsMs.length - 1)] ?? 0) };
}

describe('Claude dentro de la corrida (AGENT1-TAVILY-FIRST-2)', () => {
  const START = 1_000_000;

  it('Tavily deja 9, Claude limpia y quedan 6 ⇒ basta; Apollo no corre', async () => {
    const calls = newCalls();
    let rescued = 0;
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 6]),
        rescueBatchInline: async () => { rescued++; return true; },
        actionStartedAtMs: START, ...clock(START, [50_000]),
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(rescued, 1);
    assert.equal(calls.apollo, 0);
    assert.deepEqual(result.ok && result.tavilyFirst, {
      outcome: 'satisfied', reviewable: 6, reviewableBeforeClaude: 9, claudeReviewed: true, target: 5,
    });
  });

  it('Tavily deja 9, Claude deja 4 ⇒ Apollo completa (hay tiempo)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 4]),
        rescueBatchInline: async () => true,
        actionStartedAtMs: START, ...clock(START, [50_000, 110_000]),
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.apollo, 1);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'apollo_completed');
  });

  it('Claude deja 4 pero ya no hay tiempo para Apollo ⇒ termina con lo que hay (no arriesga el corte de 300 s)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 4]),
        rescueBatchInline: async () => true,
        actionStartedAtMs: START, ...clock(START, [60_000, 170_000]),
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.apollo, 0);
    assert.equal(calls.lusha, 0);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'short_no_time');
  });

  it('Tavily deja menos que el objetivo ⇒ Apollo enseguida, sin esperar a Claude', async () => {
    const calls = newCalls();
    let rescued = 0;
    await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([3]),
        rescueBatchInline: async () => { rescued++; return true; },
        actionStartedAtMs: START, ...clock(START, [50_000]),
      },
    }));
    assert.equal(rescued, 0);
    assert.equal(calls.apollo, 1);
  });

  it('si Claude falla dentro de la corrida, decide con lo de Tavily (y el rescate posterior sigue)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 9]),
        rescueBatchInline: async () => { throw new Error('anthropic down'); },
        actionStartedAtMs: START, ...clock(START, [50_000]),
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls.apollo, 0);
    assert.ok(result.ok && result.tavilyFirst?.outcome === 'satisfied' && result.tavilyFirst.claudeReviewed === false);
  });

  it('sin tiempo para que Claude empiece, decide con lo de Tavily', async () => {
    const calls = newCalls();
    let rescued = 0;
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9]),
        rescueBatchInline: async () => { rescued++; return true; },
        actionStartedAtMs: START, ...clock(START, [135_000]),
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(rescued, 0);
    assert.equal(calls.apollo, 0);
  });

  it('Claude recibe una ventana acotada para empezar empresas nuevas', async () => {
    const calls = newCalls();
    let windowMs: number | null = null;
    await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 9]),
        rescueBatchInline: async (input) => { windowMs = input.windowMs; return true; },
        actionStartedAtMs: START, ...clock(START, [50_000]),
      },
    }));
    assert.ok(windowMs !== null && windowMs > 0 && windowMs <= 60_000, String(windowMs));
  });
});

// ── AGENT1-TAVILY-FIRST-3 — las aceptadas se recuentan DESPUÉS de Claude ──────
//
// Prod 02-10 (PE×Energía, 97c86cf7): el lote decía «0 aceptadas» porque el bloque
// se publicaba con lo que midió el writer, ANTES de que Claude completara tamaños.

describe('aceptadas recontadas tras la revisión de Claude (AGENT1-TAVILY-FIRST-3)', () => {
  const START = 2_000_000;

  it('Tavily basta y Claude revisó ⇒ las aceptadas son las que cuentan en la base, y se republican', async () => {
    const calls = newCalls();
    const published: Array<Record<string, unknown>> = [];
    let asked: string | null = null;
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 7]),
        rescueBatchInline: async () => true,
        listAcceptedCandidateIds: async (batchId) => { asked = batchId; return ['c1', 'c2']; },
        publishWaterfallLegTrace: async ({ published: p }) => { published.push(p); return { status: 'published' } as never; },
        actionStartedAtMs: START, nowMs: () => START + 50_000,
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(asked, 'se recuentan las aceptadas del lote');
    assert.equal(result.ok && result.acceptedForTarget?.acceptedPaidForTarget, 2);
    assert.equal(published.length, 1);
    assert.equal(
      (published[0].accepted_for_target as { accepted_paid_for_target?: number }).accepted_paid_for_target,
      2,
    );
  });

  it('sin revisión de Claude no se recuenta (queda lo que midió el writer)', async () => {
    const calls = newCalls();
    let asked = false;
    await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9]),
        listAcceptedCandidateIds: async () => { asked = true; return ['x']; },
      },
    }));
    assert.equal(asked, false);
  });

  it('si el recuento falla, se queda lo del writer (nunca inventa)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(VALID_REQUEST, tavilyFirstDeps({
      reviewable: 0, calls,
      overrides: {
        countReviewableCandidates: sequence([9, 7]),
        rescueBatchInline: async () => true,
        listAcceptedCandidateIds: async () => { throw new Error('db'); },
        actionStartedAtMs: START, nowMs: () => START + 50_000,
      },
    }));
    assert.ok(result.ok, JSON.stringify(result));
  });
});
