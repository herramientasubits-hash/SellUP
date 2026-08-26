/**
 * cut6-partial-activation.test.ts — el aporte gratuito PARCIAL sobrevive y la
 * ruta de pago completa sólo lo que falta.
 *
 * AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION §§ 3, 5, 6, 7, 10, 11, 13, 14, 17, 18, 19.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 *   objetivo 10, la fuente gratuita cierra 4
 *   → las 4 se DESCARTABAN enteras
 *   → Apollo corría con objetivo 10
 *
 * La contención existía por un motivo REAL —la capa gratuita persistía en su
 * propio lote, así que una búsqueda terminaba en dos— y CUT-5 la eliminó dándole
 * el lote canónico de la ejecución. Lo que este archivo congela es la activación:
 * 4 gratis + 6 de pago = 10 candidatos durables en UN lote.
 *
 * ── 🔴 Por qué el doble de pago HONRA la demanda y el dedupe ─────────────────
 *
 * Un doble que devolviera un número fijo pasaría igual con el hilo cortado. El de
 * aquí lee `resultDemand.remainingTarget` para acotar lo que admite y descuenta
 * las identidades que la capa gratuita ya dejó en el lote —que es lo que hace el
 * dedupe de CUT-3 dentro del writer—. Así, si el orquestador dejara de recortar el
 * hueco o empezara a contar duplicados como hueco cerrado, estas pruebas se ponen
 * rojas por el motivo real y no por su decorado.
 *
 * ── 🔴 El valor VIVO, no una copia ──────────────────────────────────────────
 *
 * El cableado consume `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`, la MISMA constante
 * que pasa el llamador de producción. Ningún caso pasa `true` a mano: volver a
 * ponerla en `false` pone en rojo el comportamiento, no sólo una guarda estática.
 *
 * Sin Supabase, sin Apollo, sin Tavily, sin red, 0 créditos, 0 proveedores reales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import { createCanonicalWizardBatchResolver } from '../wizard-canonical-batch';
import type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
} from '../wizard-idempotency';
import {
  runWizardApolloSearch,
  WIZARD_APOLLO_MAX_ROUNDS,
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_INTERNAL,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
  type WizardApolloInput,
} from '../wizard-apollo-executor';
import { LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED } from '@/server/prospect-batches/lusha-pending-review-limits';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import { resolveBatchDurableTotals } from '@/server/prospect-batches/batch-durable-candidates';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const OTHER_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-4266141740ff';

const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
const OTHER_CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-4266141740ff';

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

/** Identidad estable: es la que el dedupe de CUT-3 compara entre capas. */
function company(index: number): CountrySourceCompany {
  return {
    recordIdentityKey: `free-${index}`,
    legalName: `SINTETICA LIBRE ${index}`,
    normalizedLegalName: `sintetica libre ${index}`,
    taxId: `9200000${index}`,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: 'Fabricación de productos farmacéuticos',
    industryCode: '2100',
    coarseSector: 'MANUFACTURA',
  };
}

// ── Doble de la capa gratuita ────────────────────────────────────────────────

type FreeLayer = {
  deps: PrePaidNoveltyDiscoveryDeps;
  /** Los `batchId` con los que la capa gratuita llamó al writer, en orden. */
  persistedInto: (string | null)[];
  /** Identidades que quedaron REALMENTE guardadas, por lote. */
  durableIdentities: Map<string, Set<string>>;
};

/**
 * 🔴 `persist` devuelve el `batchId` que RECIBE y registra las identidades que
 * dejó dentro. Con `null` (sin lote canónico) reproduce al writer creando el
 * suyo, que es el defecto que CUT-5 cerró y que este archivo no puede reabrir.
 *
 * `alreadyPresent` modela un reintento: las identidades que ya estaban no se
 * vuelven a escribir (dedupe durable), así que `writtenCount` baja.
 */
function freeLayer(input: {
  acceptedNovel: number;
  persistedCount: number;
  alreadyPresent?: Set<string>;
}): FreeLayer {
  const accepted = Array.from({ length: input.acceptedNovel }, (_unused, i) => company(i));
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: input.acceptedNovel,
      macroConfirmed: input.acceptedNovel,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: input.acceptedNovel,
      failed: false,
      failureCode: null,
    },
  });

  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  const layer: FreeLayer = {
    persistedInto: [],
    durableIdentities: new Map(),
    deps: {
      runGate: async () => gateResult,
      persist: async (_client, persistInput) => {
        layer.persistedInto.push(persistInput.batchId ?? null);
        const landed = persistInput.batchId ?? 'shadow-batch-created-by-writer';
        const existing = layer.durableIdentities.get(landed) ?? new Set<string>();
        const seed = input.alreadyPresent ?? new Set<string>();
        let written = 0;
        for (const c of accepted.slice(0, input.persistedCount)) {
          const key = c.recordIdentityKey;
          if (seed.has(key) || existing.has(key)) continue;
          existing.add(key);
          written += 1;
        }
        layer.durableIdentities.set(landed, existing);
        return {
          batchId: written > 0 ? landed : null,
          writtenCount: written,
          skippedCount: input.acceptedNovel - written,
          failed: written === 0,
        };
      },
    },
  };

  return layer;
}

// ── Doble de la ruta de pago ─────────────────────────────────────────────────

type PaidBehaviour =
  | { kind: 'returns'; raw: number; duplicatesOfFree?: number }
  | { kind: 'throws' }
  | { kind: 'not_configured' };

type Observed = {
  apolloCalls: WizardApolloInput[];
  reserveSlotCalls: WizardExecutionReservationInput[];
  reserveBudgetCalls: { requestedCredits: number }[];
  sealed: { batchId: string; status: string }[];
  markedFailed: { batchId: string; reason: string }[];
};

type WiringOptions = {
  free?: PrePaidNoveltyDiscoveryDeps;
  paid?: PaidBehaviour;
  slots?: Map<string, string>;
  budgetBlocked?: boolean;
};

/**
 * 🔴 La reserva se modela con un Map indexado por `(userId, clientRequestId)`, la
 * MISMA identidad durable que el índice único de la base.
 */
function wiring(options: WiringOptions = {}): {
  deps: WizardExecutionDeps;
  observed: Observed;
  slots: Map<string, string>;
} {
  const observed: Observed = {
    apolloCalls: [],
    reserveSlotCalls: [],
    reserveBudgetCalls: [],
    sealed: [],
    markedFailed: [],
  };
  const slots = options.slots ?? new Map<string, string>();
  const paid: PaidBehaviour = options.paid ?? { kind: 'returns', raw: TARGET };

  const free = options.free;
  const runFree: WizardExecutionDeps['runPrePaidNoveltyDiscovery'] = free
    ? (input) =>
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
            // 🔴 EL VALOR VIVO. Ningún caso lo sobreescribe.
            partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
          },
          free,
        )
    : undefined;

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    resolveProvider: () => 'apollo_organizations',
    runPrePaidNoveltyDiscovery: runFree,
    reserveBudget: async (input) => {
      observed.reserveBudgetCalls.push({ requestedCredits: input.requestedCredits });
      return options.budgetBlocked
        ? {
            status: 'blocked' as const,
            code: 'BUDGET_EXCEEDED' as const,
            message: 'Presupuesto agotado para el período.',
          }
        : { status: 'reserved' as const, reservationId: 'res-1', creditsReserved: 3 };
    },
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async (input) => {
      observed.reserveSlotCalls.push(input);
      const key = `${input.userId}::${input.clientRequestId}`;
      const existing = slots.get(key);
      if (existing) return { status: 'already_reserved', batchId: existing };
      const fresh =
        input.clientRequestId === CLIENT_REQUEST_ID
          ? CANONICAL_BATCH_ID
          : OTHER_CANONICAL_BATCH_ID;
      slots.set(key, fresh);
      return { status: 'reserved', batchId: fresh };
    },
    sealFreeOnlyBatchStatus: async ({ batchId, status }) => {
      observed.sealed.push({ batchId, status });
    },
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline:
      paid.kind === 'not_configured'
        ? undefined
        : async (input) => {
            observed.apolloCalls.push(input);
            if (paid.kind === 'throws') throw new Error('provider_unavailable_at_runtime');
            // 🔴 El hueco manda: el writer no admite más de lo que falta…
            const remaining = input.resultDemand?.remainingTarget ?? TARGET;
            // …y el dedupe de CUT-3 rechaza lo que la capa gratuita ya dejó.
            const novel = Math.max(0, paid.raw - (paid.duplicatesOfFree ?? 0));
            const admitted = Math.min(novel, remaining);
            return {
              batchId: input.reservedBatchId,
              candidatesCreated: admitted,
              targetPersistibleCandidates: remaining,
              targetReached: admitted >= remaining && remaining > 0,
              // 🔴 AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET § 18 — FIDELIDAD DEL
              // ARNÉS. El writer real publica SIEMPRE `completeValidCandidates`
              // junto a las filas (`candidate-writer.ts` → `persistenceOutcome`),
              // y desde CUT-7 esa cifra es la que decide si el objetivo se cerró.
              // Un doble que la omitiera describiría un pipeline que no existe y
              // haría fallar el corte por falta de instrumentación, no por
              // comportamiento. Aquí lo admitido ES lo aceptado: este doble no
              // modela filas de sólo revisión — eso lo modela la suite de CUT-7.
              persistenceOutcome: {
                eligibleBeforePersistence: admitted,
                persistedCandidates: admitted,
                persistenceFailureCount: 0,
                persistenceFailed: false,
                persistenceErrorCode: null,
                persistenceErrorStage: null,
                persistenceStatus: 'success',
                persistenceAttemptedCount: admitted,
                persistenceSucceededCount: admitted,
                persistenceFailedCount: 0,
                persistenceGap: 0,
                completeValidCandidates: admitted,
                reviewOnlyCandidates: 0,
              },
            } as unknown as IncrementalSearchOutput;
          },
    markBatchFailed: async (batchId, reason) => {
      observed.markedFailed.push({ batchId, reason });
    },
  };

  return { deps, observed, slots };
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

function distinctBatches(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

// ── § 3 · el valor VIVO ──────────────────────────────────────────────────────

describe('CUT-6 §§ 3, 15 · la activación parcial de Apollo está ENCENDIDA', () => {
  it('🔴 `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` es `true`', () => {
    assert.equal(
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      true,
      '🔴 apagarlo devuelve el todo-o-nada: el aporte parcial gratuito se descarta',
    );
  });

  it('🔴 § 15 · Lusha pending-review sigue APAGADA, y la asimetría es el contrato', () => {
    assert.equal(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      false,
      'esa superficie no recibe lote canónico (CUT-5 § 9): allí el parcial aún partiría el resultado',
    );
    assert.notEqual(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      '🔴 las dos rutas ya NO comparten postura, y eso es deliberado',
    );
  });
});

// ── CASOS 1, 2, 3 · el hueco ─────────────────────────────────────────────────

describe('CUT-6 § 3 · F = 0, 0 < F < T, F >= T', () => {
  it('CASO 1 — F=0 ⇒ la ruta de pago mantiene el objetivo ENTERO', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 0, persistedCount: 0 });
      const wired = wiring({ free: free.deps });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(wired.observed.apolloCalls.length, 1);
      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.equal(demand?.remainingTarget, TARGET, '🔴 el hueco es el objetivo entero');
      assert.equal(demand?.acceptedBeforeProvider, 0);
      assert.equal(demand?.source, 'prepaid_layer_absent');
      assert.equal(result.ok && result.candidateCount, TARGET);
    });
  });

  it('CASO 2 — F = T ⇒ NI preflight de presupuesto, NI reserva, NI proveedor', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });
      const wired = wiring({ free: free.deps });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(wired.observed.reserveBudgetCalls.length, 0, '🔴 0 preflight de presupuesto');
      assert.equal(wired.observed.apolloCalls.length, 0, '🔴 0 ejecuciones del proveedor');
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(result.ok && result.candidateCount, TARGET);
    });
  });

  it('CASO 3 — 0 < F < T ⇒ las filas gratuitas VIVEN y el hueco es T − F', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', raw: 6 } });
      await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.deepEqual(free.persistedInto, [CANONICAL_BATCH_ID], '🔴 el aporte parcial SE ESCRIBE');
      assert.equal(free.durableIdentities.get(CANONICAL_BATCH_ID)?.size, 4);

      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.equal(demand?.acceptedBeforeProvider, 4);
      assert.equal(demand?.remainingTarget, TARGET - 4, '🔴 el hueco es 6, no 10');
      assert.equal(demand?.requestedTarget, TARGET, 'el objetivo del usuario NO se reescribe');
      assert.equal(demand?.source, 'prepaid_novelty_residual_gap');
    });
  });
});

// ── CASOS 4, 5, 6 · el resultado combinado ───────────────────────────────────

describe('CUT-6 §§ 10, 11, 14 · el resultado combinado', () => {
  it('CASO 4 — free 4 + paid 6 ⇒ 10 durables en UN lote', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', raw: 6 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.candidateCount, 10, '🔴 4 + 6, no 6');
      assert.equal(result.ok && result.targetReached, true);
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(
        result.ok && result.targetPersistibleCandidates,
        TARGET,
        '🔴 se reporta el objetivo del USUARIO (10), no el hueco (6)',
      );
      assert.deepEqual(
        distinctBatches([
          ...free.persistedInto,
          ...wired.observed.apolloCalls.map((c) => c.reservedBatchId),
          result.ok ? result.batchId : null,
        ]),
        [CANONICAL_BATCH_ID],
        '🔴 un ÚNICO lote canónico',
      );
    });
  });

  it('CASO 5 — paid devuelve MENOS que el hueco ⇒ sin completitud fingida', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', raw: 3 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok && result.candidateCount, 7, '4 gratis + 3 de pago');
      assert.equal(result.ok && result.targetReached, false, '🔴 7 de 10 no es alcanzado');
      assert.equal(result.ok && result.status, 'success_partial');
    });
  });

  it('CASO 6 — paid devuelve DUPLICADOS de lo gratuito ⇒ CUT-3 los rechaza y el hueco NO se da por cerrado', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      // 6 crudos, 2 son identidades que la capa gratuita ya dejó en el lote.
      const wired = wiring({
        free: free.deps,
        paid: { kind: 'returns', raw: 6, duplicatesOfFree: 2 },
      });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok && result.candidateCount, 8, '🔴 4 + 4 admitidas, NUNCA 10');
      assert.equal(result.ok && result.targetReached, false, '🔴 un duplicado no cierra hueco');
      assert.equal(result.ok && result.status, 'success_partial');
    });
  });
});

// ── CASOS 7, 8, 9 · el aporte gratuito SOBREVIVE al fallo de la parte pagada ──

describe('CUT-6 §§ 5, 7, 13 · lo gratuito sobrevive al fallo de lo pagado', () => {
  it('CASO 7 — presupuesto DENEGADO ⇒ las filas gratuitas viven, el lote se sella y el fallo lo dice', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, budgetBlocked: true });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.durableIdentities.get(CANONICAL_BATCH_ID)?.size, 4, '🔴 no se revierte nada');
      assert.equal(wired.observed.apolloCalls.length, 0, '🔴 0 ejecuciones del proveedor');
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.code, 'BUDGET_EXCEEDED');
      assert.deepEqual(
        wired.observed.sealed,
        [{ batchId: CANONICAL_BATCH_ID, status: 'ready_for_review' }],
        '🔴 el lote no se queda en `draft` con 4 empresas dentro',
      );
      assert.deepEqual(!result.ok ? result.freeContribution : null, {
        batchId: CANONICAL_BATCH_ID,
        persistedCandidates: 4,
        redirectPath: `/prospect-batches/${CANONICAL_BATCH_ID}`,
      });
    });
  });

  it('CASO 8 — proveedor NO configurado en runtime ⇒ lo gratuito vive y el estado lo decide CUT-1', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'not_configured' } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.durableIdentities.get(CANONICAL_BATCH_ID)?.size, 4);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.code, 'GENERATION_FAILED');
      assert.equal(!result.ok && result.freeContribution?.persistedCandidates, 4);
      // 🔴 El cierre por fallo NO lo sella este corte: lo resuelve `markBatchFailed`
      // con su sonda durable de CUT-1, que es la única autoridad sobre esa fila.
      assert.deepEqual(wired.observed.sealed, [], 'sin segunda autoridad sobre el estado');
      assert.deepEqual(wired.observed.markedFailed, [
        { batchId: CANONICAL_BATCH_ID, reason: 'pipeline_error' },
      ]);
    });
  });

  it('CASO 8b — proveedor no disponible en el PREFLIGHT ⇒ la capa gratuita ni corre (0 escrituras, 0 lote)', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps });
      wired.deps.checkApolloAvailability = async () =>
        ({ available: false, skipReason: 'flag_disabled' }) as never;

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.code, 'PROVIDER_UNAVAILABLE');
      assert.deepEqual(free.persistedInto, [], '🔴 sin proveedor no se descubre nada que guardar');
      assert.equal(wired.observed.reserveSlotCalls.length, 0, '🔴 y no queda lote huérfano');
      assert.equal(!result.ok && result.freeContribution, undefined, 'no hay aporte que declarar');
    });
  });

  it('CASO 9 — el proveedor LANZA ⇒ 0 rollback de lo gratuito', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'throws' } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.durableIdentities.get(CANONICAL_BATCH_ID)?.size, 4, '🔴 las 4 siguen ahí');
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.freeContribution?.persistedCandidates, 4);
      assert.equal(
        !result.ok && result.freeContribution?.redirectPath,
        `/prospect-batches/${CANONICAL_BATCH_ID}`,
        '🔴 y el usuario recibe dónde verlas',
      );
    });
  });
});

// ── CASOS 10, 11 · orden económico y lote único ──────────────────────────────

describe('CUT-6 §§ 7, 10 · el orden económico y el lote único', () => {
  it('CASO 10 — F = T ⇒ reservas de presupuesto = 0', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });
      const wired = wiring({ free: free.deps });
      await executeProspectWizardGeneration(REQUEST, wired.deps);
      assert.equal(wired.observed.reserveBudgetCalls.length, 0);
    });
  });

  it('CASO 10b — la reserva ocurre DESPUÉS de que lo gratuito se resuelva', async () => {
    await withEnv(async () => {
      const order: string[] = [];
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const innerPersist = free.deps.persist;
      free.deps.persist = async (client, input) => {
        order.push('free_persist');
        return innerPersist(client, input);
      };
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', raw: 6 } });
      const innerReserve = wired.deps.reserveBudget;
      wired.deps.reserveBudget = async (input) => {
        order.push('budget_reserve');
        return innerReserve(input);
      };

      await executeProspectWizardGeneration(REQUEST, wired.deps);
      assert.deepEqual(order, ['free_persist', 'budget_reserve'], '🔴 FREE FIRST');
    });
  });

  it('CASO 10c — la reserva NO se deriva del hueco: es el techo del proveedor', async () => {
    await withEnv(async () => {
      const withoutFree = wiring({ paid: { kind: 'returns', raw: TARGET } });
      await executeProspectWizardGeneration(REQUEST, withoutFree.deps);

      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const withFree = wiring({ free: free.deps, paid: { kind: 'returns', raw: 6 } });
      await executeProspectWizardGeneration(REQUEST, withFree.deps);

      assert.equal(
        withFree.observed.reserveBudgetCalls[0]!.requestedCredits,
        withoutFree.observed.reserveBudgetCalls[0]!.requestedCredits,
        '🔴 § 8 — el hueco decide RESULTADOS, jamás créditos',
      );
    });
  });

  it('CASO 11 — la ruta parcial deja exactamente UN lote canónico', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', raw: 6 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal([...free.durableIdentities.keys()].length, 1);
      assert.equal(free.durableIdentities.has('shadow-batch-created-by-writer'), false, '🔴 sin lote sombra');
      assert.deepEqual(
        distinctBatches([
          ...free.persistedInto,
          ...wired.observed.apolloCalls.map((c) => c.reservedBatchId),
          result.ok ? result.batchId : null,
        ]),
        [CANONICAL_BATCH_ID],
      );
    });
  });
});

// ── CASOS 12, 13, 14 · idempotencia, carrera y aislamiento ───────────────────

describe('CUT-6 §§ 16, 17, 18 · idempotencia, carrera y aislamiento', () => {
  it('CASO 12 — reintento de la MISMA ejecución ⇒ ni segundo lote, ni doble persistencia, ni doble reserva', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();

      const first = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired1 = wiring({ free: first.deps, paid: { kind: 'returns', raw: 6 }, slots });
      await executeProspectWizardGeneration(REQUEST, wired1.deps);

      // El reintento encuentra las MISMAS identidades ya durables.
      const already = first.durableIdentities.get(CANONICAL_BATCH_ID) ?? new Set<string>();
      const retry = freeLayer({ acceptedNovel: 4, persistedCount: 4, alreadyPresent: already });
      const wired2 = wiring({ free: retry.deps, paid: { kind: 'returns', raw: 6 }, slots });
      const result = await executeProspectWizardGeneration(REQUEST, wired2.deps);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.status, 'already_started');
      assert.equal(result.ok && result.batchId, CANONICAL_BATCH_ID, '🔴 el mismo lote');
      assert.equal(retry.durableIdentities.get(CANONICAL_BATCH_ID)?.size, 0, '🔴 0 filas gratuitas nuevas');
      assert.equal(wired2.observed.apolloCalls.length, 0, '🔴 la parte pagada no se ejecuta dos veces');
      assert.equal(slots.size, 1, '🔴 un solo slot para la ejecución');
    });
  });

  it('CASO 13 — dos materializaciones CONCURRENTES de la misma ejecución convergen al MISMO lote', async () => {
    // 🔴 La regresión pendiente del review de CUT-5. El índice único
    // `(created_by, client_request_id)` hace que uno de los dos reciba conflicto;
    // resolverlo es RELEER al ganador, nunca devolver un error de violación única
    // a una de las dos mitades de la MISMA ejecución lógica.
    const rows = new Map<string, string>();
    let inserts = 0;

    const reserveSlot = async (
      input: WizardExecutionReservationInput,
    ): Promise<WizardExecutionReservationResult> => {
      const key = `${input.userId}::${input.clientRequestId}`;
      // Punto de entrelazado: los dos llegan a la vez con la fila aún ausente.
      await Promise.resolve();
      const existing = rows.get(key);
      if (existing) return { status: 'already_reserved', batchId: existing };
      inserts += 1;
      rows.set(key, CANONICAL_BATCH_ID);
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    };

    const input = {
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    } as unknown as WizardExecutionReservationInput;

    // (a) dos ramas de la MISMA ejecución comparten resolutor ⇒ una sola reserva.
    const shared = createCanonicalWizardBatchResolver(reserveSlot, input);
    const [left, right] = await Promise.all([shared.resolve(), shared.resolve()]);
    assert.equal(left.batchId, right.batchId, '🔴 el mismo lote canónico');
    assert.equal(inserts, 1, '🔴 la promesa en vuelo se comparte: una sola reserva efectiva');

    // (b) dos invocaciones CONCURRENTES del servidor para la misma ejecución
    //     lógica: resolutores distintos, misma identidad durable.
    rows.clear();
    inserts = 0;
    const a = createCanonicalWizardBatchResolver(reserveSlot, input);
    const b = createCanonicalWizardBatchResolver(reserveSlot, input);
    const settled = await Promise.allSettled([a.resolve(), b.resolve()]);

    for (const outcome of settled) {
      assert.equal(outcome.status, 'fulfilled', '🔴 ninguna mitad termina en error de unicidad');
    }
    const batchIds = settled.map((o) => (o.status === 'fulfilled' ? o.value.batchId : null));
    assert.deepEqual(distinctBatches(batchIds), [CANONICAL_BATCH_ID], '🔴 convergen al ganador');
    assert.equal(inserts, 1, '🔴 el conflicto se RELEE, no se reintenta como inserción');
  });

  it('CASO 14 — dos ejecuciones DISTINTAS quedan aisladas', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();

      const freeX = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const x = wiring({ free: freeX.deps, paid: { kind: 'returns', raw: 6 }, slots });
      const rx = await executeProspectWizardGeneration(REQUEST, x.deps);

      const freeY = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const y = wiring({ free: freeY.deps, paid: { kind: 'returns', raw: 6 }, slots });
      const ry = await executeProspectWizardGeneration(
        { ...REQUEST, clientRequestId: OTHER_CLIENT_REQUEST_ID },
        y.deps,
      );

      assert.equal(rx.ok && rx.batchId, CANONICAL_BATCH_ID);
      assert.equal(ry.ok && ry.batchId, OTHER_CANONICAL_BATCH_ID);
      assert.notEqual(rx.ok && rx.batchId, ry.ok && ry.batchId, '🔴 sin adopción del «último lote»');
      assert.deepEqual(freeY.persistedInto, [OTHER_CANONICAL_BATCH_ID]);
    });
  });
});

// ── CASOS 15, 16, 17, 18 · trazas, conteo durable y respuesta ────────────────

describe('CUT-6 §§ 11, 14 · trazas distinguibles y verdad durable', () => {
  it('CASO 15 — la traza distingue el aporte gratuito del pagado', async () => {
    await withEnv(async () => {
      const freeMixed = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const mixed = wiring({ free: freeMixed.deps, paid: { kind: 'returns', raw: 6 } });
      await executeProspectWizardGeneration(REQUEST, mixed.deps);

      const onlyPaid = wiring({ paid: { kind: 'returns', raw: TARGET } });
      await executeProspectWizardGeneration(REQUEST, onlyPaid.deps);

      assert.equal(
        mixed.observed.apolloCalls[0]!.resultDemand?.source,
        'prepaid_novelty_residual_gap',
        '🔴 la corrida mixta declara que hubo capa gratuita',
      );
      assert.equal(
        onlyPaid.observed.apolloCalls[0]!.resultDemand?.source,
        'prepaid_layer_absent',
        '🔴 y la corrida sólo-pagada declara que no la hubo',
      );
      assert.equal(mixed.observed.apolloCalls[0]!.resultDemand?.acceptedBeforeProvider, 4);
      assert.equal(onlyPaid.observed.apolloCalls[0]!.resultDemand?.acceptedBeforeProvider, 0);
    });
  });

  it('CASO 16 — el conteo durable de CUT-4 suma las dos contribuciones sin contarlas dos veces', () => {
    // 🔴 La MISMA autoridad aritmética que usan los escritores (CUT-1): el aporte
    // gratuito entra como `preExisting` porque se persistió ANTES.
    const totals = resolveBatchDurableTotals({
      preExisting: { known: true, count: 4 },
      insertedNow: 6,
    });
    assert.equal(totals.totalDurableCandidates, 10);
    assert.equal(totals.preExistingDurableCandidates, 4);
    assert.equal(totals.insertedByThisContributor, 6);
  });

  it('CASO 17 — la visibilidad de CUT-4 ve el lote: no se queda en `draft`', async () => {
    await withEnv(async () => {
      // La única salida donde ningún writer de proveedor sella.
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, budgetBlocked: true });
      await executeProspectWizardGeneration(REQUEST, wired.deps);
      assert.deepEqual(wired.observed.sealed, [
        { batchId: CANONICAL_BATCH_ID, status: 'ready_for_review' },
      ]);
    });
  });

  it('CASO 18 — la respuesta del wizard reporta la verdad durable COMBINADA', async () => {
    await withEnv(async () => {
      // 🔴 El caso que más dolía: el proveedor devuelve 0 y la respuesta decía
      // «0 encontrados» sobre un lote con 4 empresas dentro.
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', raw: 0 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.notEqual(result.ok && result.status, 'no_new_candidates', '🔴 no es un vacío');
      assert.equal(result.ok && result.status, 'success_partial');
      assert.equal(result.ok && result.candidateCount, 4);
      assert.equal(result.ok && result.batchStatus, 'ready_for_review');
    });
  });
});

// ── CASO 19 · amplitud de búsqueda ≠ objetivo persistible ────────────────────

describe('CUT-6 § 4 · la amplitud de búsqueda NO se mezcla con el objetivo', () => {
  it('CASO 19 — con hueco 6, `targetInternal` sigue en 25 y sólo baja la ACEPTACIÓN', async () => {
    const seen: { targetInternal: number; targetPersistibleCandidates: number }[] = [];
    const resolved = {
      country: { name: 'Colombia', code: 'CO' },
      industry: { name: 'Salud / Farma' },
      subindustries: [{ name: 'Clínicas' }],
      additionalCriteria: null,
      userId: USER_ID,
      catalog: { version: 'v2024-01' },
    } as unknown as WizardApolloInput['resolved'];

    await runWizardApolloSearch(
      {
        resolved,
        reservedBatchId: CANONICAL_BATCH_ID,
        loadCatalogSearchTerms: async () =>
          ({ resolution: { terms: [] } }) as never,
        resultDemand: {
          requestedTarget: TARGET,
          acceptedBeforeProvider: 4,
          remainingTarget: 6,
          providerRequired: true,
          source: 'prepaid_novelty_residual_gap',
        },
      },
      (async (input: {
        targetInternal: number;
        targetPersistibleCandidates: number;
      }) => {
        seen.push({
          targetInternal: input.targetInternal,
          targetPersistibleCandidates: input.targetPersistibleCandidates,
        });
        return { batchId: CANONICAL_BATCH_ID } as unknown as IncrementalSearchOutput;
      }) as never,
    );

    assert.equal(seen.length, 1);
    assert.equal(
      seen[0]!.targetInternal,
      WIZARD_APOLLO_TARGET_INTERNAL,
      '🔴 la AMPLITUD (25) no se recorta con el hueco',
    );
    assert.equal(seen[0]!.targetPersistibleCandidates, 6, 'la ACEPTACIÓN sí');
    assert.notEqual(WIZARD_APOLLO_TARGET_INTERNAL, WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES);
    assert.equal(WIZARD_APOLLO_MAX_ROUNDS, 4, 'las rondas tampoco dependen del hueco');
  });
});

// ── CASO 20 · CUT-7 no se cuela ──────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * 🔴 Con los COMENTARIOS FUERA. Este archivo NOMBRA `accepted_for_target` y
 * `partialGapSupported: true` en su prosa, y una guarda que leyera el cuerpo crudo
 * confundiría «citarlo» con «usarlo».
 */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const CUT6_FILES = [
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts',
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-types.ts',
  'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts',
] as const;

/**
 * 🔴 AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET § 17 — este bloque SUSTITUYE al
 * anterior, que se llamaba «CUT-7 no existe todavía» y prohibía literalmente el
 * identificador `accepted_for_target` en los archivos del corte.
 *
 * Era un trinquete que FIJABA EL DIFERIMIENTO, no una promesa de CUT-6: mientras
 * viviera, escribir CUT-7 rompía CUT-6 por definición, y un trinquete que fija el
 * valor defectuoso bloquea su corrección. Se retira por el mismo motivo por el
 * que CUT-6 retiró `wizard-apollo-partial-gap-activation-deferred.test.ts`.
 *
 * Lo que CUT-6 SÍ promete sobre este punto —y lo que este bloque pasa a
 * anclar— es que la decisión de aceptación no se re-implemente dentro de sus
 * archivos: cuando exista, tiene que venir de UNA autoridad compartida (§ 7). Un
 * `>= objetivo` escrito a mano en el orquestador es exactamente el defecto que
 * CUT-7 cierra, y volvería a abrirlo sin que nada lo dijera.
 */
describe('CUT-6 §§ 4, 12, 20 · la aceptación no se re-implementa aquí', () => {
  it('CASO 20 — ningún archivo del corte DEFINE su propia autoridad de aceptación', () => {
    for (const file of CUT6_FILES) {
      const body = stripTsComments(read(file));
      for (const forbidden of [
        'function resolveAcceptedForTarget',
        'function paidAcceptedContributionFromWriterTruth',
        'type AcceptedForTargetResult',
        'type AcceptedContribution',
      ]) {
        assert.ok(!body.includes(forbidden), `🔴 segunda definición de aceptación (${file})`);
      }
    }
  });

  it('CASO 20b — el orquestador la IMPORTA del módulo canónico', () => {
    const body = stripTsComments(read(CUT6_FILES[0]));
    assert.ok(
      body.includes("from '@/modules/prospect-batches/accepted-for-target'"),
      '🔴 la autoridad viaja por import, no por copia',
    );
  });

  it('🔴 EN NEGATIVO — la guarda detectaría una segunda definición', () => {
    const mutated = `${stripTsComments(read(CUT6_FILES[0]))}\nexport function resolveAcceptedForTarget() {}\n`;
    assert.ok(mutated.includes('function resolveAcceptedForTarget'), 'la copia mutada sí la trae');
  });
});
