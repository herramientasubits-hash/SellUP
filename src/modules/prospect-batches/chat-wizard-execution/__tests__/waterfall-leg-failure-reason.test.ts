/**
 * waterfall-leg-failure-reason.test.ts — una pierna Lusha que CORRIÓ y FALLÓ
 * tiene que decir POR QUÉ.
 *
 * AGENT1-WATERFALL-LEG-FAILURE-REASON-1.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `runLushaWaterfallLeg` devolvía `{ executed: true, result }` tal cual, incluso
 * cuando `result.ok === false`. La acción de Lusha NO lanza: un bloqueo de
 * presupuesto, un lote canónico irresoluble o una caída del proveedor vuelven
 * como un resultado con `ok: false`, no como excepción. El punto de publicación
 * del orquestador sólo mira `executed`, así que una pierna que corrió y falló
 * salía publicada como:
 *
 *     { executed: true, skipReason: null, persistedCandidates: 0, acceptedForTarget: null }
 *
 * Indistinguible de una pierna que corrió, no falló y no encontró nada. La causa
 * moría con la corrida y sólo se podía reconstruir volviendo a preguntarle a
 * Lusha — es decir, volviendo a pagar.
 *
 * ── Qué NO cambia ────────────────────────────────────────────────────────────
 *
 * Nada decisorio. `failureCode` es OBSERVACIÓN: no mueve la aceptación, ni el
 * universo durable, ni la liquidación, ni `targetReached`, ni el estado de la
 * corrida, ni convierte un error en éxito (ni al revés). Un SKIP legítimo sigue
 * viajando en `skipReason` y NO recibe `failureCode`: son dos campos porque son
 * dos hechos.
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Supabase · 0 Producción · 0
 * escrituras · 0 migraciones · 0 banderas tocadas. Todo inyectado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  classifyLushaWaterfallLegFailure,
  LUSHA_WATERFALL_LEG_FAILURE_REASON_MAX_LENGTH,
  type LushaWaterfallLegFailureCode,
} from '../wizard-lusha-waterfall';
import { runLushaWaterfallLeg } from '../wizard-lusha-waterfall.server';
import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { LushaWaterfallLegOutcome } from '../wizard-lusha-waterfall.server';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import type { PersistLushaPendingReviewResult } from '@/server/prospect-batches/lusha-pending-review';
import { runPrePaidNoveltyDiscovery } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type { PrePaidNoveltyDiscoveryDeps } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures — los códigos REALES que el resultado ya trae ───────────────────

/** `lusha-budget-gate.ts` → `LUSHA_BUDGET_BLOCKED_ERROR`. */
const BUDGET_BLOCKED_ERROR = 'lusha_budget_blocked';
/** `lusha-budget-gate.ts` → `LUSHA_BUDGET_UNAVAILABLE_ERROR`. */
const BUDGET_UNAVAILABLE_ERROR = 'lusha_budget_unavailable';
/** `lusha-pending-review-actions.ts` → `WATERFALL_BATCH_UNRESOLVED_CODE`. */
const WATERFALL_BATCH_UNRESOLVED_ERROR = 'waterfall_canonical_batch_unresolved';
/** `lusha-prospecting-operation.ts` → `LUSHA_OPERATION_UNAVAILABLE_CODE`. */
const OPERATION_UNAVAILABLE_ERROR = 'lusha_prospecting_operation_unavailable';

/**
 * Resultado de fallo con la forma que `buildLushaPendingReviewFailure` produce:
 * `ok: false`, `status: 'error'`, cero filas y `pagesRequested: 0` salvo que la
 * corrida llegara al proveedor.
 */
function failureResult(
  overrides: Partial<PersistLushaPendingReviewResult> = {},
): PersistLushaPendingReviewResult {
  return {
    ok: false,
    status: 'error',
    batchId: null,
    createdCandidatesCount: 0,
    insertedCandidatesCount: 0,
    pagesRequested: 0,
    ...overrides,
  } as unknown as PersistLushaPendingReviewResult;
}

function successResult(
  overrides: Partial<PersistLushaPendingReviewResult> = {},
): PersistLushaPendingReviewResult {
  return {
    ok: true,
    status: 'success',
    batchId: 'lusha-batch-1',
    createdCandidatesCount: 2,
    insertedCandidatesCount: 2,
    pagesRequested: 1,
    multiBranch: { acceptedForTargetTotal: 2 },
    ...overrides,
  } as unknown as PersistLushaPendingReviewResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · el clasificador PURO — vocabulario cerrado, derivado de lo que ya hay
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 1 · classifyLushaWaterfallLegFailure — vocabulario cerrado', () => {
  it('CASO 1 — fallo por PRESUPUESTO con `budgetExceeded` ⇒ categoría de presupuesto', () => {
    const failure = classifyLushaWaterfallLegFailure(
      failureResult({
        error: BUDGET_BLOCKED_ERROR,
        budgetExceeded: {
          reason: 'insufficient_for_run',
          availableCredits: 1,
          requiredCredits: 2,
        },
      }),
    );
    assert.notEqual(failure, null, '🔴 hubo fallo: no puede salir sin clasificar');
    assert.equal(failure?.code, 'budget');
    assert.equal(failure?.reason, BUDGET_BLOCKED_ERROR);
  });

  it('CASO 1b — presupuesto ILEGIBLE (sin `budgetExceeded`) sigue siendo presupuesto', () => {
    // La lectura del período es best-effort: cuando falla, `budgetExceeded` queda
    // ausente y el único rastro es el código. Clasificar por `budgetExceeded`
    // SOLO habría empujado este caso al cajón de lo no clasificable.
    const failure = classifyLushaWaterfallLegFailure(
      failureResult({ error: BUDGET_UNAVAILABLE_ERROR }),
    );
    assert.equal(failure?.code, 'budget');
  });

  it('CASO 2 — fallo por LOTE canónico ⇒ su propia categoría', () => {
    const failure = classifyLushaWaterfallLegFailure(
      failureResult({ error: WATERFALL_BATCH_UNRESOLVED_ERROR }),
    );
    assert.equal(failure?.code, 'canonical_batch_unresolved');
    assert.equal(failure?.reason, WATERFALL_BATCH_UNRESOLVED_ERROR);
  });

  it('CASO 3 — fallo de PROVEEDOR (la corrida llegó a pedir) ⇒ provider_error', () => {
    const failure = classifyLushaWaterfallLegFailure(
      failureResult({
        error: 'lusha_search_http_502',
        pagesRequested: 1,
        creditsChargedTotal: 1,
      }),
    );
    assert.equal(failure?.code, 'provider_error');
    assert.equal(failure?.reason, 'lusha_search_http_502');
  });

  it('CASO 3b — `stopReason` de proveedor también basta, sin páginas declaradas', () => {
    for (const stopReason of ['provider_failure', 'provider_billing_anomaly'] as const) {
      const failure = classifyLushaWaterfallLegFailure(
        failureResult({ error: 'boom', stopReason }),
      );
      assert.equal(failure?.code, 'provider_error', `stopReason=${stopReason}`);
    }
  });

  it('CASO 4 — ÉXITO (`ok: true`) ⇒ sin clasificación, nada que explicar', () => {
    assert.equal(classifyLushaWaterfallLegFailure(successResult()), null);
  });

  it('CASO 4b — `status: "empty"` con `ok: true` NO es fallo: manda `ok`, no `status`', () => {
    // El núcleo devuelve `{ ok: true, status: 'empty' }` cuando la corrida no
    // encontró nada reutilizable. Es una corrida que funcionó y no halló: guiarse
    // por `status` la habría marcado como fallo y habría inventado una causa.
    const failure = classifyLushaWaterfallLegFailure(
      successResult({ status: 'empty', batchId: null, insertedCandidatesCount: 0 }),
    );
    assert.equal(failure, null);
  });

  it('CASO 6 — `ok: false` NUNCA sale sin código: el cajón es explícito', () => {
    const unclassifiable = [
      failureResult({ error: OPERATION_UNAVAILABLE_ERROR }),
      failureResult({ error: 'invalid_input' }),
      failureResult({ error: 'Error desconocido' }),
      failureResult({ error: undefined }),
      failureResult({ error: '   ' }),
    ];
    for (const result of unclassifiable) {
      const failure = classifyLushaWaterfallLegFailure(result);
      assert.notEqual(failure, null, `🔴 ${String(result.error)} salió sin clasificar`);
      assert.equal(failure?.code, 'unclassified_leg_failure');
    }
  });

  it('el vocabulario es CERRADO: cuatro códigos y ninguno más', () => {
    const seen = new Set<LushaWaterfallLegFailureCode>();
    for (const result of [
      failureResult({ error: BUDGET_BLOCKED_ERROR }),
      failureResult({ error: WATERFALL_BATCH_UNRESOLVED_ERROR }),
      failureResult({ error: 'x', pagesRequested: 2 }),
      failureResult({ error: 'nada reconocible' }),
    ]) {
      const failure = classifyLushaWaterfallLegFailure(result);
      if (failure !== null) seen.add(failure.code);
    }
    assert.deepEqual(
      [...seen].sort(),
      ['budget', 'canonical_batch_unresolved', 'provider_error', 'unclassified_leg_failure'],
    );
  });

  it('`failureReason` no crece sin límite: se acota, no se narra', () => {
    const long = 'e'.repeat(LUSHA_WATERFALL_LEG_FAILURE_REASON_MAX_LENGTH + 250);
    const failure = classifyLushaWaterfallLegFailure(failureResult({ error: long }));
    assert.equal(failure?.reason?.length, LUSHA_WATERFALL_LEG_FAILURE_REASON_MAX_LENGTH);
  });

  it('el orden de precedencia es el de la CAUSA, no el del proveedor', () => {
    // Un bloqueo de presupuesto no despacha ninguna petición; si algún día
    // trajera páginas declaradas, seguiría siendo presupuesto.
    const failure = classifyLushaWaterfallLegFailure(
      failureResult({
        error: BUDGET_BLOCKED_ERROR,
        pagesRequested: 3,
        stopReason: 'provider_failure',
      }),
    );
    assert.equal(failure?.code, 'budget');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · la pierna — `executed: true` con `ok: false` ya no es opaco
// ═══════════════════════════════════════════════════════════════════════════

const WIZARD_CLIENT_REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const LEG_CANONICAL_BATCH_ID = 'b7f1c3d2-0a44-4f9e-9c31-8d6e5a2b1c07';

function legInput(overrides: Record<string, unknown> = {}) {
  return {
    wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
    canonicalBatchId: LEG_CANONICAL_BATCH_ID,
    countryCode: 'CO',
    macroIndustryKey: 'technology',
    subIndustryId: null,
    target: 5,
    usefulAccumulated: 0,
    apolloTerminal: true,
    ...overrides,
  };
}

function legDeps(result: PersistLushaPendingReviewResult, calls: { count: number }) {
  return {
    waterfallEnabled: () => true,
    lushaAvailable: () => true,
    runLushaBatch: async () => {
      calls.count += 1;
      return result;
    },
  };
}

describe('§ 2 · runLushaWaterfallLeg — la causa viaja con el desenlace', () => {
  for (const scenario of [
    {
      label: 'PRESUPUESTO',
      result: failureResult({
        error: BUDGET_BLOCKED_ERROR,
        budgetExceeded: { reason: 'exhausted', availableCredits: 0, requiredCredits: 2 },
      }),
      code: 'budget' as const,
    },
    {
      label: 'LOTE canónico',
      result: failureResult({ error: WATERFALL_BATCH_UNRESOLVED_ERROR }),
      code: 'canonical_batch_unresolved' as const,
    },
    {
      label: 'PROVEEDOR',
      result: failureResult({ error: 'lusha_search_timeout', pagesRequested: 1 }),
      code: 'provider_error' as const,
    },
    {
      label: 'no clasificable',
      result: failureResult({ error: OPERATION_UNAVAILABLE_ERROR }),
      code: 'unclassified_leg_failure' as const,
    },
  ]) {
    it(`fallo de ${scenario.label} ⇒ executed true, failure.code = ${scenario.code}`, async () => {
      const calls = { count: 0 };
      const outcome = await runLushaWaterfallLeg(
        legInput(),
        legDeps(scenario.result, calls),
      );
      assert.equal(calls.count, 1, 'la pierna corrió: eso NO cambia');
      assert.equal(outcome.executed, true, '🔴 un fallo NO se convierte en skip');
      assert.ok(outcome.executed);
      assert.equal(outcome.failure?.code, scenario.code);
      assert.equal(
        outcome.result.ok,
        false,
        '🔴 el resultado del proveedor se conserva intacto',
      );
    });
  }

  it('CASO 4 — con ÉXITO la pierna no publica causa alguna', async () => {
    const calls = { count: 0 };
    const outcome = await runLushaWaterfallLeg(legInput(), legDeps(successResult(), calls));
    assert.ok(outcome.executed);
    assert.equal(outcome.failure, null, '🔴 null/ausente, nunca un código inventado');
    assert.equal(outcome.gap, 5);
  });

  it('CASO 6 — `executed: true` con `ok: false` NUNCA sale con failure null', async () => {
    for (const error of [BUDGET_BLOCKED_ERROR, 'lo que sea', '']) {
      const outcome = await runLushaWaterfallLeg(
        legInput(),
        legDeps(failureResult({ error }), { count: 0 }),
      );
      assert.ok(outcome.executed);
      assert.notEqual(outcome.failure, null, `🔴 error=${JSON.stringify(error)} salió opaco`);
    }
  });

  it('CASO 5 — un SKIP legítimo no se confunde con un fallo', async () => {
    for (const scenario of [
      { label: 'bandera apagada', deps: { waterfallEnabled: () => false }, reason: 'waterfall_flag_disabled' },
      { label: 'Lusha no disponible', deps: { lushaAvailable: () => false }, reason: 'lusha_unavailable' },
    ]) {
      let called = 0;
      const outcome = await runLushaWaterfallLeg(legInput(), {
        waterfallEnabled: () => true,
        lushaAvailable: () => true,
        runLushaBatch: async () => {
          called += 1;
          return successResult();
        },
        ...scenario.deps,
      });
      assert.equal(called, 0, `${scenario.label}: 0 llamadas a Lusha`);
      assert.equal(outcome.executed, false);
      assert.ok(!outcome.executed);
      assert.equal(outcome.reason, scenario.reason, 'el skip conserva SU vocabulario');
      assert.equal(
        (outcome as { failure?: unknown }).failure,
        undefined,
        '🔴 un skip no lleva `failure`: si lo llevara, skip y fallo serían un solo campo',
      );
    }
  });

  it('CASO 5b — objetivo cubierto y macro sin mapear siguen siendo SKIPS', async () => {
    const reached = await runLushaWaterfallLeg(
      legInput({ usefulAccumulated: 5 }),
      legDeps(successResult(), { count: 0 }),
    );
    assert.ok(!reached.executed);
    assert.equal(reached.reason, 'target_reached');

    const unmapped = await runLushaWaterfallLeg(
      legInput({ macroIndustryKey: null }),
      legDeps(successResult(), { count: 0 }),
    );
    assert.ok(!unmapped.executed);
    assert.equal(unmapped.reason, 'macro_industry_unmapped');
  });

  it('una EXCEPCIÓN sigue saliendo por `reason: leg_failed`, sin `failure`', async () => {
    // Ese caso ya era observable por su propia razón, y no cruza a `failureCode`:
    // mezclar los dos canales reabriría la confusión que este corte cierra.
    const outcome = await runLushaWaterfallLeg(legInput(), {
      waterfallEnabled: () => true,
      lushaAvailable: () => true,
      runLushaBatch: async () => {
        throw new Error('lusha_leg_exploded');
      },
    });
    assert.equal(outcome.executed, false);
    assert.ok(!outcome.executed);
    assert.equal(outcome.reason, 'leg_failed');
    assert.equal((outcome as { failure?: unknown }).failure, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 3 · el punto de PUBLICACIÓN — el dato llega al resultado de la corrida
// ═══════════════════════════════════════════════════════════════════════════

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;
const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
const CLIENT = {} as unknown as SupabaseClient;

const REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [SUBINDUSTRY_ID],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG: CatalogResolutionOutput = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'health-pharma', name: 'Salud / Farma' },
  subindustries: [
    { id: SUBINDUSTRY_ID, slug: 'clinicas', name: 'Clínicas', applicableCountries: ['CO'] },
  ],
};

/** Capa gratuita que no aporta nada: aísla la pierna Lusha. */
function emptyFreeLayer(): PrePaidNoveltyDiscoveryDeps {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: 0,
      macroConfirmed: 0,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: 0,
      failed: false,
      failureCode: null,
    },
  });
  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: [],
    telemetry: {},
  };
  return {
    runGate: async () => gateResult,
    persist: async () => ({ batchId: null, writtenCount: 0, skippedCount: 0, failed: true }),
  };
}

function wiring(leg: WizardExecutionDeps['runLushaWaterfallLeg']): WizardExecutionDeps {
  const free = emptyFreeLayer();
  return {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    resolveProvider: () => 'apollo_organizations',
    runPrePaidNoveltyDiscovery: (input) =>
      runPrePaidNoveltyDiscovery(
        CLIENT,
        {
          provider: 'apollo',
          countryCode: input.countryCode,
          countryName: input.countryName,
          macroIndustryKey: input.macroIndustryKey,
          requestedTarget: input.requestedTarget,
          requestedByUserId: input.requestedByUserId,
          resolveBatchId: input.resolveBatchId,
          partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
        },
        free,
      ),
    reserveBudget: async () => ({
      status: 'reserved' as const,
      reservationId: 'res-1',
      creditsReserved: 3,
    }),
    checkApolloProviderQuota: async () => ({
      status: 'available' as const,
      providerCreditsAvailable: 999,
    }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async () => ({ status: 'reserved', batchId: CANONICAL_BATCH_ID }),
    sealFreeOnlyBatchStatus: async () => undefined,
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline: async (input) =>
      ({
        batchId: input.reservedBatchId,
        candidatesCreated: 0,
        targetPersistibleCandidates: TARGET,
        targetReached: false,
        persistenceOutcome: {
          eligibleBeforePersistence: 0,
          persistedCandidates: 0,
          persistenceFailureCount: 0,
          persistenceFailed: false,
          persistenceErrorCode: null,
          persistenceErrorStage: null,
          persistenceStatus: 'success',
          persistenceAttemptedCount: 0,
          persistenceSucceededCount: 0,
          persistenceFailedCount: 0,
          persistenceGap: 0,
          completeValidCandidates: 0,
          reviewOnlyCandidates: 0,
        },
      }) as unknown as IncrementalSearchOutput,
    markBatchFailed: async () => undefined,
    runLushaWaterfallLeg: leg,
  };
}

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    execution: process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION,
    apollo: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
  };
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  try {
    return await fn();
  } finally {
    if (saved.execution === undefined) delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    else process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved.execution;
    if (saved.apollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved.apollo;
  }
}

type SuccessResult = Extract<
  Awaited<ReturnType<typeof executeProspectWizardGeneration>>,
  { ok: true }
>;

async function runWithLeg(outcome: LushaWaterfallLegOutcome): Promise<SuccessResult> {
  return withEnv(async () => {
    const result = await executeProspectWizardGeneration(
      REQUEST,
      wiring(async () => outcome),
    );
    assert.equal(result.ok, true, 'la corrida entera termina bien: la pierna es parcial');
    return result as SuccessResult;
  });
}

/** El desenlace de una pierna que corrió, con la causa ya clasificada. */
function executedOutcome(
  result: PersistLushaPendingReviewResult,
  code: LushaWaterfallLegFailureCode | null,
  reason: string | null,
): LushaWaterfallLegOutcome {
  return {
    executed: true,
    gap: TARGET,
    clientRequestId: 'lusha-leg-request-id',
    result,
    failure: code === null ? null : { code, reason },
  } as unknown as LushaWaterfallLegOutcome;
}

describe('§ 3 · publicación — la traza de la corrida transporta la causa', () => {
  it('CASO 7 — fallo por presupuesto: `failureCode` llega al resultado publicado', async () => {
    const result = await runWithLeg(
      executedOutcome(
        failureResult({ error: BUDGET_BLOCKED_ERROR }),
        'budget',
        BUDGET_BLOCKED_ERROR,
      ),
    );
    assert.equal(result.lushaWaterfallLeg?.executed, true);
    assert.equal(
      result.lushaWaterfallLeg?.failureCode,
      'budget',
      '🔴 sin propagar aquí el dato se queda en el tipo y nunca sale de la pierna',
    );
    assert.equal(result.lushaWaterfallLeg?.failureReason, BUDGET_BLOCKED_ERROR);
  });

  it('CASO 7b — fallo de proveedor y lote canónico también se propagan', async () => {
    const provider = await runWithLeg(
      executedOutcome(
        failureResult({ error: 'lusha_search_http_502', pagesRequested: 1 }),
        'provider_error',
        'lusha_search_http_502',
      ),
    );
    assert.equal(provider.lushaWaterfallLeg?.failureCode, 'provider_error');

    const batch = await runWithLeg(
      executedOutcome(
        failureResult({ error: WATERFALL_BATCH_UNRESOLVED_ERROR }),
        'canonical_batch_unresolved',
        WATERFALL_BATCH_UNRESOLVED_ERROR,
      ),
    );
    assert.equal(batch.lushaWaterfallLeg?.failureCode, 'canonical_batch_unresolved');
  });

  it('CASO 3 — un fallo NO cambia `skipReason`: los dos campos siguen separados', async () => {
    const result = await runWithLeg(
      executedOutcome(failureResult({ error: BUDGET_BLOCKED_ERROR }), 'budget', BUDGET_BLOCKED_ERROR),
    );
    assert.equal(
      result.lushaWaterfallLeg?.skipReason,
      null,
      '🔴 la pierna corrió: no hubo skip que nombrar',
    );
    assert.equal(result.lushaWaterfallLeg?.failureCode, 'budget');
  });

  it('CASO 5 — un SKIP publica `skipReason` y NO publica `failureCode`', async () => {
    const result = await runWithLeg({
      executed: false,
      reason: 'lusha_unavailable',
    } as LushaWaterfallLegOutcome);
    assert.equal(result.lushaWaterfallLeg?.executed, false);
    assert.equal(result.lushaWaterfallLeg?.skipReason, 'lusha_unavailable');
    assert.equal(
      result.lushaWaterfallLeg?.failureCode ?? null,
      null,
      '🔴 rellenarlo en un skip colapsaría los dos hechos en uno',
    );
    assert.equal(result.lushaWaterfallLeg?.failureReason ?? null, null);
  });

  it('CASO 4 — una pierna con ÉXITO publica `failureCode` null', async () => {
    const result = await runWithLeg(
      executedOutcome(successResult({ insertedCandidatesCount: 2 }), null, null),
    );
    assert.equal(result.lushaWaterfallLeg?.executed, true);
    assert.equal(result.lushaWaterfallLeg?.failureCode ?? null, null);
    assert.equal(result.lushaWaterfallLeg?.persistedCandidates, 2);
  });

  it('OBSERVACIÓN PURA — el fallo no mueve la aceptación ni el universo durable', async () => {
    const failed = await runWithLeg(
      executedOutcome(failureResult({ error: BUDGET_BLOCKED_ERROR }), 'budget', BUDGET_BLOCKED_ERROR),
    );
    const opaque = await runWithLeg(
      executedOutcome(failureResult({ error: BUDGET_BLOCKED_ERROR }), null, null),
    );
    // Campo por campo salvo la traza observacional: si el código cambiara un solo
    // número, dejaría de ser observación.
    const strip = (r: SuccessResult) => ({ ...r, lushaWaterfallLeg: undefined });
    assert.deepEqual(strip(failed), strip(opaque));
    assert.equal(failed.targetReached, false);
    assert.equal(failed.candidateCount, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · guardas estáticas — el cableado no puede desaparecer en silencio
// ═══════════════════════════════════════════════════════════════════════════

const ORCHESTRATOR =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const LEG_SERVER =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server.ts';
const RESULT_TYPES =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-types.ts';

/** Código SIN comentarios: nombrar un símbolo en prosa no es cablearlo. */
function code(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('§ 4 · guardas estáticas', () => {
  it('CASO 7 — el punto de publicación propaga `failureCode` y `failureReason`', () => {
    const src = code(ORCHESTRATOR);
    const block = src.slice(src.indexOf('lushaWaterfallLeg: {'));
    assert.ok(block.length > 0, 'el punto de publicación sigue existiendo');
    assert.match(
      block.slice(0, 2000),
      /failureCode:/,
      '🔴 el tipo puede declararlo y el orquestador no publicarlo: ése es el defecto',
    );
    assert.match(block.slice(0, 2000), /failureReason:/);
  });

  it('la pierna CLASIFICA: el desenlace no se devuelve sin mirar `ok`', () => {
    const src = code(LEG_SERVER);
    assert.match(
      src,
      /classifyLushaWaterfallLegFailure/,
      '🔴 devolver `executed: true` sin clasificar ES el defecto original',
    );
    assert.match(
      src,
      /failure:\s*classifyLushaWaterfallLegFailure\(/,
      'la clasificación viaja en el desenlace de la pierna',
    );
  });

  it('el tipo del resultado declara los dos campos como opcionales/nulos', () => {
    const src = code(RESULT_TYPES);
    assert.match(src, /failureCode\?:/);
    assert.match(src, /failureReason\?:/);
  });

  it('`skipReason` y `failureCode` son campos DISTINTOS en el tipo publicado', () => {
    const src = code(RESULT_TYPES);
    const skipIndex = src.indexOf('skipReason');
    const failureIndex = src.indexOf('failureCode');
    assert.ok(skipIndex > 0, 'el skip conserva su campo');
    assert.ok(failureIndex > 0, 'el fallo tiene el suyo');
    assert.notEqual(
      skipIndex,
      failureIndex,
      '🔴 un solo campo para skip y fallo es la confusión que este corte cierra',
    );
  });
});
