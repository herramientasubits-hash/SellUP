/**
 * AGENT1-TARGET-IS-MINIMUM-X6.13 — el objetivo de 5 es un SUELO, nunca un techo.
 *
 * ── La regla de producto que estas pruebas fijan ─────────────────────────────
 *
 *   · cada proveedor activado conserva TODAS las válidas que encuentre dentro
 *     de sus límites (presupuesto, páginas, tiempo, cancelación, universo);
 *   · alcanzar 5 NO detiene su búsqueda;
 *   · al terminar el primero, si tiene menos de 5 válidas, se activa el segundo;
 *   · el segundo TAMPOCO se limita al faltante;
 *   · se cuentan las válidas ÚNICAS realmente persistidas, sin doble conteo
 *     entre proveedores ni al reintentar.
 *
 * ── Lo que el objetivo SÍ sigue decidiendo ───────────────────────────────────
 *
 * La ACTIVACIÓN del segundo proveedor y el veredicto completo/parcial. Esas dos
 * lecturas no son paradas de búsqueda, y este corte no las toca.
 *
 * Sin Supabase, sin Apollo, sin Lusha, sin red. 0 créditos, 0 proveedores reales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { LushaWaterfallLegOutcome } from '../wizard-lusha-waterfall.server';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import {
  resolveAcceptedForTarget,
  paidAcceptedContributionFromWriterTruth,
  CONTRIBUTOR_NOT_RUN,
} from '@/modules/prospect-batches/accepted-for-target';
import { fullTargetResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import { decideLushaWaterfallLeg } from '../wizard-lusha-waterfall';
import { decideLushaProviderRequest } from '@/server/prospect-batches/lusha-multibranch-execution';
import {
  createApolloPaginationBudget,
  evaluateApolloPaginationDecision,
} from '@/server/agents/prospecting-toolkit/apollo-organizations-pagination-budget';
import {
  resolveBatchDurableTotals,
  durableCandidatesFromCount,
} from '@/server/prospect-batches/batch-durable-candidates';


// ── Fixtures ──────────────────────────────────────────────────────────────────

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

/** Capa gratuita que no aporta nada: aísla el reparto Apollo/Lusha. */
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

type LegBehaviour =
  | { kind: 'not_wired' }
  | { kind: 'skipped' }
  | { kind: 'executed'; persisted: number; accepted: number | null };

type Observed = {
  legInputs: { target: number; usefulAccumulated: number }[];
};

function wiring(options: {
  apolloPersisted: number;
  /** Cuántas de las persistidas CUENTAN. Por omisión, todas. */
  apolloAccepted?: number;
  /** 🔴 X6.13 — ids durables que el writer declara aceptados. */
  apolloAcceptedIds?: readonly string[];
  leg: LegBehaviour;
}): {
  deps: WizardExecutionDeps;
  observed: Observed;
} {
  const observed: Observed = { legInputs: [] };
  const free = emptyFreeLayer();
  const behaviour = options.leg;

  const leg: WizardExecutionDeps['runLushaWaterfallLeg'] =
    behaviour.kind === 'not_wired'
      ? undefined
      : async (input) => {
          observed.legInputs.push({
            target: input.target,
            usefulAccumulated: input.usefulAccumulated,
          });
          if (behaviour.kind !== 'executed') {
            return { executed: false, reason: 'target_reached' } as LushaWaterfallLegOutcome;
          }
          const { persisted, accepted } = behaviour;
          return {
            executed: true,
            gap: Math.max(0, input.target - input.usefulAccumulated),
            clientRequestId: 'lusha-leg-request-id',
            result: {
              insertedCandidatesCount: persisted,
              createdCandidatesCount: persisted,
              // 🔴 FIDELIDAD DEL ARNÉS — la acción de Lusha publica su aceptación
              // en `multiBranch.acceptedForTargetTotal`, ya RECONCILIADA contra las
              // filas (`persistedForTarget`). Un doble que la omitiera describiría
              // una ruta que no existe.
              ...(accepted === null ? {} : { multiBranch: { acceptedForTargetTotal: accepted } }),
            },
          } as unknown as LushaWaterfallLegOutcome;
        };

  const deps: WizardExecutionDeps = {
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
    runApolloPipeline: async (input) => {
      const admitted = options.apolloPersisted;
      const accepted = options.apolloAccepted ?? admitted;
      return {
        batchId: input.reservedBatchId,
        candidatesCreated: admitted,
        targetPersistibleCandidates: TARGET,
        targetReached: admitted >= TARGET,
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
          completeValidCandidates: accepted,
          reviewOnlyCandidates: admitted - accepted,
          ...(options.apolloAcceptedIds
            ? { acceptedCandidateIds: options.apolloAcceptedIds }
            : {}),
        },
      } as unknown as IncrementalSearchOutput;
    },
    markBatchFailed: async () => undefined,
    runLushaWaterfallLeg: leg,
  };

  return { deps, observed };
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

async function run(options: {
  apolloPersisted: number;
  apolloAccepted?: number;
  apolloAcceptedIds?: readonly string[];
  leg: LegBehaviour;
}): Promise<{ result: SuccessResult; observed: Observed }> {
  return withEnv(async () => {
    const wired = wiring(options);
    const result = await executeProspectWizardGeneration(REQUEST, wired.deps);
    assert.equal(result.ok, true, 'los cuatro casos son corridas que terminan bien');
    return { result: result as SuccessResult, observed: wired.observed };
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// § A — LOS CASOS DE LA REGLA, DE EXTREMO A EXTREMO
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.13 § A · el objetivo es un mínimo', () => {
  it('🔴 primero 8 válidas ⇒ conserva 8 y NO activa el segundo', async () => {
    const { result, observed } = await run({
      apolloPersisted: 8,
      leg: { kind: 'skipped' },
    });

    assert.equal(result.candidateCount, 8, '🔴 ocho filas, no cinco');
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 8, '🔴 ocho válidas cuentan');
    assert.equal(result.targetReached, true);
    assert.equal(result.status, 'success_target_reached');

    // La pierna recibe la cuenta real y, con ella, la decisión PURA de
    // activación dice que no corre. Es la regla 3, intacta.
    assert.deepEqual(observed.legInputs, [{ target: TARGET, usefulAccumulated: 8 }]);
    assert.deepEqual(
      decideLushaWaterfallLeg({
        waterfallEnabled: true,
        lushaAvailable: true,
        apolloTerminal: true,
        target: TARGET,
        usefulAccumulated: 8,
        macroIndustryKey: 'health_pharma',
        canonicalBatchId: CANONICAL_BATCH_ID,
      }),
      { run: false, reason: 'target_reached' },
      '🔴 con el mínimo cubierto el segundo proveedor no se activa',
    );
  });

  it('🔴 primero 3 + segundo 12 nuevas ⇒ 15', async () => {
    const { result, observed } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 12, accepted: 12 },
    });

    assert.equal(result.candidateCount, 15);
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 15, '🔴 3 + 12');
    assert.equal(result.targetReached, true);
    // 🔴 El segundo NO se limita al faltante: se activa con el hueco como
    // información, y aporta las doce que encontró.
    assert.deepEqual(observed.legInputs, [{ target: TARGET, usefulAccumulated: 3 }]);
  });

  it('🔴 primero 3 + segundo 12 con 2 duplicadas del primero ⇒ 13', async () => {
    // El dedupe físico impide que las dos repetidas se escriban: la pierna
    // persiste diez filas nuevas y su writer acepta esas diez.
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 10, accepted: 10 },
    });

    assert.equal(result.candidateCount, 13, '🔴 las dos repetidas no son filas nuevas');
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 13);
    assert.equal(result.targetReached, true);
  });

  it('🔴 y si el contador dijera 12 con sólo 10 filas nuevas, manda el universo', async () => {
    // 🔴 La garantía NO se apoya sólo en el dedupe físico: aunque la pierna
    // reportara sus doce, el techo de filas ÚNICAS del lote recorta el total.
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 10, accepted: 12 },
    });

    assert.equal(result.candidateCount, 13);
    assert.equal(
      result.acceptedForTarget?.acceptedForTargetTotal,
      13,
      '🔴 nadie puede contar más válidas que filas existen',
    );
  });

  it('🔴 primero 4 + segundo 4 nuevas ⇒ 8 y mínimo cumplido', async () => {
    const { result, observed } = await run({
      apolloPersisted: 4,
      leg: { kind: 'executed', persisted: 4, accepted: 4 },
    });

    assert.equal(result.candidateCount, 8);
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 8);
    assert.equal(result.targetReached, true, '🔴 4 + 4 supera el mínimo de 5');
    assert.equal(result.status, 'success_target_reached');
    assert.deepEqual(observed.legInputs, [{ target: TARGET, usefulAccumulated: 4 }]);
  });

  it('🔴 cuatro únicas válidas entre los dos ⇒ resultado PARCIAL', async () => {
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 1, accepted: 1 },
    });

    assert.equal(result.candidateCount, 4);
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 4);
    assert.equal(result.targetReached, false, '🔴 cuatro no son cinco');
    assert.equal(result.status, 'success_partial');
    assert.equal(result.acceptedForTarget?.remainingTarget, 1);
    assert.equal(result.batchStatus, 'ready_for_review', 'lo encontrado se entrega igual');
  });

  it('las de revisión siguen SIN contar, aunque el objetivo ya no sea techo', async () => {
    // Ocho filas, tres de ellas sólo de revisión: cuentan cinco.
    const { result } = await run({
      apolloPersisted: 8,
      apolloAccepted: 5,
      leg: { kind: 'skipped' },
    });

    assert.equal(result.candidateCount, 8, 'el universo durable no se recorta');
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 5);
    assert.equal(result.targetReached, true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § B — REINTENTO Y REANUDACIÓN: NI FILAS, NI CONTEOS, NI COBROS DE MÁS
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.13 § B · reintentar no infla nada', () => {
  it('🔴 dos resoluciones de la MISMA corrida dan el mismo total', async () => {
    const first = await run({
      apolloPersisted: 4,
      leg: { kind: 'executed', persisted: 4, accepted: 4 },
    });
    const second = await run({
      apolloPersisted: 4,
      leg: { kind: 'executed', persisted: 4, accepted: 4 },
    });

    assert.equal(first.result.candidateCount, second.result.candidateCount);
    assert.equal(
      first.result.acceptedForTarget?.acceptedForTargetTotal,
      second.result.acceptedForTarget?.acceptedForTargetTotal,
    );
  });

  it('🔴 las filas ya existentes del lote no se suman dos veces', () => {
    // `resolveBatchDurableTotals` es la autoridad de CUT-1: lo preexistente y lo
    // insertado AHORA son poblaciones distintas, y un reintento que no inserta
    // nada nuevo no puede mover el universo.
    const afterFirstWrite = resolveBatchDurableTotals({
      preExisting: durableCandidatesFromCount(4),
      insertedNow: 4,
    });
    const afterRetryThatWroteNothing = resolveBatchDurableTotals({
      preExisting: durableCandidatesFromCount(afterFirstWrite.totalDurableCandidates),
      insertedNow: 0,
    });

    assert.equal(afterFirstWrite.totalDurableCandidates, 8);
    assert.equal(afterRetryThatWroteNothing.totalDurableCandidates, 8, '🔴 el reintento no infla');
  });

  it('🔴 el techo de filas únicas corta un total imposible, venga de donde venga', () => {
    const inflated = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 8,
        persistedCandidates: 8,
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 8,
        persistedCandidates: 8,
      }),
      // El lote sólo tiene 8 filas únicas: las dos piernas reportaron las mismas.
      persistedUniqueCeiling: 8,
    });

    assert.equal(inflated.acceptedForTargetTotal, 8, '🔴 no se cuenta dos veces lo mismo');
    assert.equal(
      inflated.acceptedFreeForTarget + inflated.acceptedPaidForTarget,
      inflated.acceptedForTargetTotal,
      'la identidad total = libre + pago se conserva',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § B-bis — EL TECHO DE FILAS NO BASTA: HAY QUE CONTAR IDENTIDADES
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.13 § B-bis · válidas ÚNICAS, no «por debajo del total persistido»', () => {
  /**
   * 🔴 LA LIMITACIÓN CONCRETA DE `persistedUniqueCeiling`.
   *
   * El techo impide superar el número de FILAS, pero no impide contar dos veces
   * a una candidata válida cuando el lote tiene además filas INCOMPLETAS que
   * absorben la inflación: con 8 filas de las que sólo 5 cumplen el contrato,
   * un aporte que vuelva a incluir 3 de esas 5 suma 8 — y 8 ≤ 8, así que el
   * techo no lo ve.
   *
   * Lo que tiene que gobernar es la IDENTIDAD DURABLE de las aceptadas.
   */
  const FIVE_ACCEPTED = ['candidate:a', 'candidate:b', 'candidate:c', 'candidate:d', 'candidate:e'];

  it('🔴 8 filas, 5 válidas, y un replay que repite 3 de esas 5 ⇒ siguen siendo 5', () => {
    const resolved = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 5,
        persistedCandidates: 8,
        acceptedIdentities: FIVE_ACCEPTED,
      }),
      // El replay vuelve a reportar tres de las MISMAS cinco.
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 3,
        persistedCandidates: 3,
        acceptedIdentities: FIVE_ACCEPTED.slice(0, 3),
      }),
      persistedUniqueCeiling: 8,
    });

    assert.equal(
      resolved.acceptedForTargetTotal,
      5,
      '🔴 el agregado cuenta identidades, no sumas: nunca puede subir a 8',
    );
    assert.equal(
      resolved.acceptedFreeForTarget + resolved.acceptedPaidForTarget,
      resolved.acceptedForTargetTotal,
      'total = libre + pago se conserva',
    );
    assert.equal(resolved.persistedTotalCandidates, 11, 'el universo durable se reporta entero');
  });

  it('🔴 y el mismo aporte repetido dos veces es IDEMPOTENTE', () => {
    const once = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 5,
        persistedCandidates: 8,
        acceptedIdentities: FIVE_ACCEPTED,
      }),
      persistedUniqueCeiling: 8,
    });
    const replayed = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 5,
        persistedCandidates: 8,
        acceptedIdentities: FIVE_ACCEPTED,
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 5,
        persistedCandidates: 8,
        acceptedIdentities: FIVE_ACCEPTED,
      }),
      persistedUniqueCeiling: 8,
    });

    assert.equal(once.acceptedForTargetTotal, 5);
    assert.equal(replayed.acceptedForTargetTotal, 5, '🔴 reanudar no infla el conteo');
  });

  it('identidades DISTINTAS sí suman: el corte no esconde candidatas nuevas', () => {
    const resolved = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 3,
        persistedCandidates: 3,
        acceptedIdentities: ['candidate:a', 'candidate:b', 'candidate:c'],
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 2,
        persistedCandidates: 2,
        acceptedIdentities: ['lusha:x', 'lusha:y'],
      }),
      persistedUniqueCeiling: 5,
    });

    assert.equal(resolved.acceptedForTargetTotal, 5, '3 + 2 identidades distintas');
    assert.equal(resolved.targetReached, true);
  });

  it('🔴 las identidades LLEGAN de verdad desde el writer hasta el agregado', async () => {
    // El writer declara 8 filas, 5 aceptadas… y repite dos ids por error de
    // conteo. El agregado cuenta IDENTIDADES, así que siguen siendo 5.
    const { result } = await run({
      apolloPersisted: 8,
      apolloAccepted: 5,
      apolloAcceptedIds: ['a', 'b', 'c', 'a', 'b'],
      leg: { kind: 'skipped' },
    });

    assert.equal(result.candidateCount, 8, 'el universo durable se reporta entero');
    assert.equal(
      result.acceptedForTarget?.acceptedForTargetTotal,
      3,
      '🔴 tres identidades distintas, aunque el contador dijera cinco',
    );
  });

  it('sin identidades declaradas se conserva la suma acotada por el techo', () => {
    // Compatibilidad: todo llamador que no las declare se comporta como antes.
    const resolved = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 4,
        persistedCandidates: 4,
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 4,
        persistedCandidates: 4,
      }),
      persistedUniqueCeiling: 8,
    });
    assert.equal(resolved.acceptedForTargetTotal, 8);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § C — LOS TOPES DE CONSUMO SIGUEN MANDANDO
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.13 § C · lo que sí sigue deteniendo la búsqueda', () => {
  const budget = createApolloPaginationBudget();

  it('el objetivo NO detiene la paginación', () => {
    const decision = evaluateApolloPaginationDecision(budget, {
      pagesFetched: 1,
      creditsUsed: 1,
      candidatesCollected: 100,
      lastPage: 1,
      totalPages: 5,
      lastPageResultCount: 100,
      elapsedMs: 0,
      guardrailTripped: null,
      netNewTarget: 5,
      acceptedForTargetCount: 40,
    });
    assert.equal(decision.shouldContinue, true, '🔴 40 aceptadas con objetivo 5 no paran nada');
  });

  for (const [label, state, expected] of [
    [
      'páginas',
      { pagesFetched: 5, creditsUsed: 1, candidatesCollected: 10, lastPage: 5, totalPages: 99, lastPageResultCount: 10, elapsedMs: 0, guardrailTripped: null },
      'max_pages_reached',
    ],
    [
      'créditos',
      { pagesFetched: 1, creditsUsed: 10, candidatesCollected: 10, lastPage: 1, totalPages: 99, lastPageResultCount: 10, elapsedMs: 0, guardrailTripped: null },
      'max_credits_reached',
    ],
    [
      'tiempo',
      { pagesFetched: 1, creditsUsed: 1, candidatesCollected: 10, lastPage: 1, totalPages: 99, elapsedMs: 60_000, guardrailTripped: null },
      'time_budget_exhausted',
    ],
    [
      'guarda operativa',
      { pagesFetched: 1, creditsUsed: 1, candidatesCollected: 10, lastPage: 1, totalPages: 99, lastPageResultCount: 10, elapsedMs: 0, guardrailTripped: 'rate_limit' },
      'operational_guardrail',
    ],
    [
      'universo agotado',
      { pagesFetched: 1, creditsUsed: 1, candidatesCollected: 10, lastPage: 3, totalPages: 3, lastPageResultCount: 10, elapsedMs: 0, guardrailTripped: null },
      'last_page_reached',
    ],
  ] as const) {
    it(`${label} SÍ detiene la paginación`, () => {
      const decision = evaluateApolloPaginationDecision(budget, state as never);
      assert.equal(decision.shouldContinue, false);
      assert.equal(decision.stopReason, expected);
    });
  }

  it('cancelación SÍ detiene la paginación', () => {
    const decision = evaluateApolloPaginationDecision(budget, {
      pagesFetched: 1,
      creditsUsed: 1,
      candidatesCollected: 10,
      lastPage: 1,
      totalPages: 99,
      lastPageResultCount: 10,
      elapsedMs: 0,
      guardrailTripped: null,
      cancelled: true,
    });
    assert.equal(decision.shouldContinue, false);
    assert.equal(decision.stopReason, 'cancelled');
  });

  it('Lusha: el objetivo no deniega una página; el techo de peticiones sí', () => {
    assert.deepEqual(
      decideLushaProviderRequest({
        remainingGap: 0,
        providerRequestsUsed: 1,
        providerRequestsAllowed: 6,
        rawResultsTotal: 10,
      }),
      { allowed: true },
    );
    assert.deepEqual(
      decideLushaProviderRequest({
        remainingGap: 5,
        providerRequestsUsed: 6,
        providerRequestsAllowed: 6,
        rawResultsTotal: 10,
      }),
      { allowed: false, stopReason: 'request_cap_reached' },
    );
    assert.deepEqual(
      decideLushaProviderRequest({
        remainingGap: 5,
        providerRequestsUsed: 1,
        providerRequestsAllowed: 6,
        rawResultsTotal: 999,
      }),
      { allowed: false, stopReason: 'raw_scan_cap_reached' },
    );
  });
});
