/**
 * AGENT1-AUDIT-WS2 — tiempos de la orquestación, ciclo de vida y concurrencia de
 * corridas, a través de `executeProspectWizardGeneration` con dobles. Sin Supabase,
 * sin proveedores, sin LLM, sin reloj real (se inyecta).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { WizardApolloInput } from '../wizard-apollo-executor';
import { tavilyOwnAcceptedIds } from '../wizard-tavily-first';
import { decideApolloProviderQuotaGate } from '../wizard-provider-quota-gate';
import { decideActiveRunsConflict } from '../wizard-active-runs-guard';
import { decideClaudeSearchLeg } from '../wizard-claude-search-leg';
import { markWizardBatchGenerating, type MarkBatchGeneratingClient } from '../wizard-batch-generating';
import { buildPublicStepNoNewBreakdown, publicLegOf, publicNothingNewLegOf } from '../wizard-supplier-search';
import type { PublicBuyerStepOutcome } from '@/server/prospect-batches/supplier-search/public-buyer-suppliers';

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
});
afterEach(() => {
  if (savedFlag !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = savedFlag;
  else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
});

const BATCH_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';
const OTHER_RUN = '523e4567-e89b-12d3-a456-426614174004';

const REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [SUBINDUSTRY_ID],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [{ id: SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] }],
};

function output(batchId: string, created = 2): IncrementalSearchOutput {
  return {
    input: {} as IncrementalSearchOutput['input'],
    candidates: [],
    candidatesCount: created,
    usefulCandidatesCount: created,
    candidatesCreated: created,
    metadata: {} as IncrementalSearchOutput['metadata'],
    warnings: [],
    batchId,
  };
}

type Calls = { tavily: number; apollo: number; lusha: number; apolloInputs: WizardApolloInput[]; generating: number };
const newCalls = (): Calls => ({ tavily: 0, apollo: 0, lusha: 0, apolloInputs: [], generating: 0 });

/** Reloj de la acción: arrancó en 0 y «ahora» es `elapsedMs`. */
function deps(calls: Calls, opts: { elapsedMs?: number; overrides?: Partial<WizardExecutionDeps> } = {}): WizardExecutionDeps {
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    reserveBudget: async () => ({ status: 'reserved', reservationId: 'res', creditsReserved: 20 }),
    checkApolloProviderQuota: async () => ({ status: 'available', providerCreditsAvailable: 999 }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_ID }),
    runTavilyPipeline: async (input) => {
      calls.tavily++;
      return output(input.reservedBatchId, 2);
    },
    runApolloPipeline: async (input) => {
      calls.apollo++;
      calls.apolloInputs.push(input);
      return output(input.reservedBatchId, 3);
    },
    runLushaWaterfallLeg: async () => {
      calls.lusha++;
      return { executed: false, reason: 'waterfall_flag_disabled' } as never;
    },
    markBatchGenerating: async () => {
      calls.generating++;
      return true;
    },
    resolveProvider: () => 'apollo_organizations',
    markBatchFailed: async () => undefined,
    actionStartedAtMs: 0,
    nowMs: () => opts.elapsedMs ?? 1_000,
    ...opts.overrides,
  };
}

describe('AGENT1-AUDIT-WS2 § 1 — Apollo recibe el inicio de la acción', () => {
  it('el ejecutor de Apollo recibe `invocationStartedAtMs` y el lote pasa a generating (§ 7)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(REQUEST, deps(calls, { overrides: { actionStartedAtMs: 12_345 } }));
    assert.equal(result.ok, true);
    assert.equal(calls.apollo, 1);
    assert.equal(calls.apolloInputs[0]?.invocationStartedAtMs, 12_345);
    assert.equal(calls.generating, 1, 'draft → generating antes de pagar Apollo');
  });
});

describe('AGENT1-AUDIT-WS2 §§ 2, 3 — guardas de tiempo en todo camino', () => {
  it('Tavily-primero sin revisión de Claude y pasados 140 s ⇒ short_no_time, Apollo NO corre', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        elapsedMs: 150_000,
        overrides: {
          resolveTavilyFirst: () => true,
          checkTavilyProviderQuota: async () => ({ status: 'available', providerCreditsAvailable: 1000 }),
          countReviewableCandidates: async () => 2,
        },
      }),
    );
    assert.equal(calls.tavily, 1);
    assert.equal(calls.apollo, 0, '🔴 antes Apollo arrancaba porque Claude no había revisado');
    assert.equal(result.ok && result.tavilyFirst?.outcome, 'short_no_time');
  });

  it('sin Tavily-primero y pasados 140 s ⇒ Apollo no arranca (apolloNotStarted: no_time) y el lote se sella', async () => {
    const calls = newCalls();
    const sealed: string[] = [];
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        elapsedMs: 150_000,
        overrides: { sealFreeOnlyBatchStatus: async ({ status }) => void sealed.push(status) },
      }),
    );
    assert.equal(calls.apollo, 0);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.apolloNotStarted, { reason: 'no_time' });
    assert.deepEqual(sealed, ['completed'], 'el lote no se queda en draft');
  });

  it('pasados 200 s, Lusha no se llama nunca (lusha_no_time), ni siquiera sin Tavily-primero', async () => {
    const calls = newCalls();
    // Apollo sí arranca (el reloj avanza durante la corrida) y Lusha ya no cabe.
    let now = 1_000;
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        overrides: {
          nowMs: () => now,
          runApolloPipeline: async (input) => {
            calls.apollo++;
            now = 210_000;
            return output(input.reservedBatchId, 1);
          },
        },
      }),
    );
    assert.equal(calls.apollo, 1);
    assert.equal(calls.lusha, 0);
    assert.equal(result.ok && result.lushaWaterfallLeg?.skipReason, 'lusha_no_time');
  });
});

describe('AGENT1-AUDIT-WS2 § D — sin cuota de Apollo siguen Tavily, Lusha y Claude', () => {
  it('con Tavily-primero: Tavily corre, Apollo no, y la corrida entrega lo de Tavily', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        overrides: {
          checkApolloProviderQuota: async () => ({ status: 'blocked', providerCreditsAvailable: 0 }),
          resolveTavilyFirst: () => true,
          checkTavilyProviderQuota: async () => ({ status: 'available', providerCreditsAvailable: 1000 }),
          countReviewableCandidates: async () => 2,
        },
      }),
    );
    assert.equal(calls.tavily, 1);
    assert.equal(calls.apollo, 0);
    assert.equal(calls.lusha, 1, 'Lusha no depende de la cuota de Apollo');
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.tavilyFirst?.outcome, 'apollo_unavailable');
    assert.deepEqual(result.ok && result.apolloNotStarted, { reason: 'quota_exhausted' });
  });

  it('sin otra pierna que pueda correr, el bloqueo es el de siempre', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, { overrides: { checkApolloProviderQuota: async () => ({ status: 'blocked', providerCreditsAvailable: 0 }) } }),
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'BUDGET_EXCEEDED');
    assert.equal(calls.apollo + calls.tavily, 0);
  });
});

describe('AGENT1-AUDIT-WS2 § C — la corrida ya existe ⇒ already_started ANTES de la capa gratuita', () => {
  it('no corre la capa gratuita contra el lote viejo', async () => {
    const calls = newCalls();
    let freeLayer = 0;
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        overrides: {
          findExistingRunBatch: async () => ({ batchId: 'old-batch' }),
          runPrePaidNoveltyDiscovery: async () => {
            freeLayer++;
            throw new Error('no debería correr');
          },
        },
      }),
    );
    assert.equal(freeLayer, 0);
    assert.equal(result.ok && result.status, 'already_started');
    assert.equal(result.ok && result.batchId, 'old-batch');
  });

  it('la capa gratuita recibe subindustrias y criterio (§ E)', async () => {
    const calls = newCalls();
    let seen: { subindustries?: readonly string[]; additionalCriteria?: string | null } | null = null;
    await executeProspectWizardGeneration(
      { ...REQUEST, additionalCriteriaRaw: 'con sede en Bogotá' },
      deps(calls, {
        overrides: {
          runPrePaidNoveltyDiscovery: async (input) => {
            seen = input;
            throw new Error('fail-open');
          },
        },
      }),
    );
    assert.deepEqual(seen!.subindustries, ['SaaS']);
    assert.equal(seen!.additionalCriteria, 'con sede en Bogotá');
  });
});

describe('AGENT1-AUDIT-WS2 § 9 — concurrencia también en el servidor', () => {
  it('otra corrida activa del mismo país × industria ⇒ CONCURRENT_EXECUTION_ACTIVE sin gastar', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        overrides: {
          loadActiveRuns: async () => ({
            activeRunIds: [OTHER_RUN, CLIENT_REQUEST_ID],
            activeBatches: [{ clientRequestId: OTHER_RUN, countryCode: 'CO', industryId: INDUSTRY_ID, searchMode: null }],
          }),
        },
      }),
    );
    assert.equal(!result.ok && result.code, 'CONCURRENT_EXECUTION_ACTIVE');
    assert.equal(calls.apollo, 0);
  });

  it('lectura fallida ⇒ no bloquea (regla de coordinación, no de gasto)', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(REQUEST, deps(calls, { overrides: { loadActiveRuns: async () => null } }));
    assert.equal(result.ok, true);
  });

  it('la decisión pura: 3 activas ⇒ max; la propia no cuenta; competidores no chocan por país', () => {
    const base = { currentClientRequestId: 'me', current: { countryCode: 'CO', industryId: 'i', isCriteriaSearch: true } };
    assert.equal(decideActiveRunsConflict({ ...base, activeRunIds: ['a', 'b', 'c'], activeBatches: [] }), 'max_concurrent');
    assert.equal(decideActiveRunsConflict({ ...base, activeRunIds: ['a', 'b', 'me'], activeBatches: [] }), null);
    const sameKey = [{ clientRequestId: 'a', countryCode: 'CO', industryId: 'i', searchMode: null }];
    assert.equal(decideActiveRunsConflict({ ...base, activeRunIds: ['a'], activeBatches: sameKey }), 'same_country_industry');
    assert.equal(
      decideActiveRunsConflict({ ...base, activeRunIds: ['a'], activeBatches: [{ ...sameKey[0], searchMode: 'competitors' }] }),
      null,
    );
    assert.equal(
      decideActiveRunsConflict({ ...base, current: { ...base.current, isCriteriaSearch: false }, activeRunIds: ['a'], activeBatches: sameKey }),
      null,
    );
  });
});

describe('AGENT1-AUDIT-WS2 § 5 — una pausa sin cola no es «en pausa»', () => {
  it('Apollo pausado SIN encolar ⇒ apolloContinuationFailure y Lusha NO se trata como provisional', async () => {
    const calls = newCalls();
    let pendingSeen: boolean | undefined;
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        overrides: {
          runApolloPipeline: async (input) => ({
            ...output(input.reservedBatchId, 1),
            assessmentDeadlineReached: true,
            pendingOrganizationCount: 7,
            continuationEnqueued: false,
            continuationEnqueueFailure: 'boom',
          }) as IncrementalSearchOutput,
          runLushaWaterfallLeg: async (input) => {
            pendingSeen = input.apolloPendingContinuation;
            return { executed: false, reason: 'waterfall_flag_disabled' } as never;
          },
        },
      }),
    );
    assert.equal(result.ok && result.apolloContinuation, undefined);
    assert.deepEqual(result.ok && result.apolloContinuationFailure, { pendingOrganizationCount: 7, reason: 'boom' });
    assert.equal(pendingSeen, false);
  });

  it('Apollo pausado y encolado ⇒ apolloContinuation enqueued', async () => {
    const calls = newCalls();
    const result = await executeProspectWizardGeneration(
      REQUEST,
      deps(calls, {
        overrides: {
          runApolloPipeline: async (input) => ({
            ...output(input.reservedBatchId, 1),
            assessmentDeadlineReached: true,
            pendingOrganizationCount: 7,
            continuationEnqueued: true,
          }) as IncrementalSearchOutput,
        },
      }),
    );
    assert.deepEqual(result.ok && result.apolloContinuation, { enqueued: true, pendingOrganizationCount: 7 });
  });
});

describe('AGENT1-AUDIT-WS2 — piezas puras', () => {
  it('§ B: las aceptadas de Tavily no incluyen las filas que el lote ya tenía', () => {
    assert.deepEqual(tavilyOwnAcceptedIds(['bank-1', 'bank-2', 't-1', 't-2', 't-3'], ['bank-1', 'bank-2']), ['t-1', 't-2', 't-3']);
    assert.deepEqual(tavilyOwnAcceptedIds(['a'], undefined), ['a'], 'sin foto: lo de antes');
    assert.equal(tavilyOwnAcceptedIds(['a'], null), null, 'foto fallida: fail-closed');
    assert.equal(tavilyOwnAcceptedIds(null, []), null);
  });

  it('§ 10: la cuota de Apollo bloquea si no alcanza para el peor caso; sin cuota configurada pasa', () => {
    assert.deepEqual(decideApolloProviderQuotaGate({ allowed: true, providerCreditsAvailable: 5 }, 12), {
      status: 'blocked',
      providerCreditsAvailable: 5,
    });
    assert.equal(decideApolloProviderQuotaGate({ allowed: true, providerCreditsAvailable: 12 }, 12).status, 'available');
    assert.equal(decideApolloProviderQuotaGate({ allowed: true, providerCreditsAvailable: null }, 12).status, 'available');
    assert.deepEqual(decideApolloProviderQuotaGate({ allowed: false, providerCreditsAvailable: null }, 12), {
      status: 'blocked',
      providerCreditsAvailable: 0,
    });
    assert.equal(decideApolloProviderQuotaGate({ allowed: true, providerCreditsAvailable: 1 }, 0).status, 'available');
  });

  it('§ F: Claude no corre si el lote ya está en el tope de entrega', () => {
    const base = { enabled: true, tavilyFirstSatisfied: false, target: 5, acceptedSoFar: 2, elapsedMs: 10_000 };
    assert.equal(decideClaudeSearchLeg(base).run, true);
    assert.deepEqual(decideClaudeSearchLeg({ ...base, lotAtDeliveryCap: true }), { run: false, reason: 'lot_at_delivery_cap' });
  });

  it('§ 7: draft → generating sólo desde draft; error ⇒ false', async () => {
    const filters: Array<[string, string]> = [];
    const client = {
      from: () => ({
        update: () => ({
          eq: (c: string, v: string) => {
            filters.push([c, v]);
            return { eq: (c2: string, v2: string) => (filters.push([c2, v2]), Promise.resolve({ error: null })) };
          },
        }),
      }),
    } as unknown as MarkBatchGeneratingClient;
    assert.equal(await markWizardBatchGenerating(client, 'b'), true);
    assert.deepEqual(filters, [['id', 'b'], ['status', 'draft']]);
    const failing = {
      from: () => ({ update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: { message: 'rls' } }) }) }) }),
    } as unknown as MarkBatchGeneratingClient;
    assert.equal(await markWizardBatchGenerating(failing, 'b'), false);
  });

  it('§ A: compras públicas con proveedores ya reclamados ⇒ ronda sin novedades, con desglose', () => {
    const step = {
      executed: true,
      buyer: { taxId: '1', name: 'Alcaldía', matchedBy: 'exact' },
      sourceKey: 'co_secop',
      tableVersion: 'v1',
      read: 10,
      outsideIndustry: 2,
      publicEntitiesExcluded: 1,
      offered: 6,
      written: 0,
      writeFailed: false,
      recordedWithoutWebsite: 0,
      relationships: [],
    } as PublicBuyerStepOutcome;
    assert.equal(publicLegOf(step), null);
    const leg = publicNothingNewLegOf(step);
    assert.equal(leg?.executed, true);
    assert.equal(leg?.persistedCandidates, 0);
    const breakdown = buildPublicStepNoNewBreakdown(step as Extract<PublicBuyerStepOutcome, { executed: true }>);
    assert.equal(breakdown.sellupDuplicateCount, 6);
    assert.equal(publicNothingNewLegOf({ ...step, written: 2 } as PublicBuyerStepOutcome), null, 'con filas, la ronda normal');
    assert.equal(publicNothingNewLegOf({ ...step, offered: 0 } as PublicBuyerStepOutcome), null);
  });
});
