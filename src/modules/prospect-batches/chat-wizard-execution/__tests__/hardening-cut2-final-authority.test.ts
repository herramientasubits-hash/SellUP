/**
 * hardening-cut2-final-authority.test.ts — UNA autoridad final, resuelta
 * DESPUÉS de las piernas efectivamente ejecutadas.
 *
 * AGENT1-HARDENING-CUT-2.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `candidateCount`, `targetReached`, `executionStatus` y `batchStatus` se
 * resolvían ANTES de ejecutar la pierna Lusha. La pierna sí persiste candidatos
 * —en EL MISMO lote, por el corte 5A—, pero el resultado conservaba los números
 * pre-Lusha. Una corrida con Apollo 0 y Lusha 5 devolvía `candidateCount: 0` y
 * `no_new_candidates` sobre un lote con cinco empresas dentro: invitaba a la
 * persona a repetir —y pagar— una búsqueda que ya le había dejado resultados.
 *
 * ── Qué NO cambia ────────────────────────────────────────────────────────────
 *
 * `stableFinalizableCandidateCount` no se toca y no cambia de significado. Este
 * corte no redefine qué es un candidato finalizable: sólo hace que el resultado
 * de la acción se resuelva cuando ya están todas las piernas.
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

function wiring(options: { apolloPersisted: number; leg: LegBehaviour }): {
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
          completeValidCandidates: admitted,
          reviewOnlyCandidates: 0,
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
  leg: LegBehaviour;
}): Promise<{ result: SuccessResult; observed: Observed }> {
  return withEnv(async () => {
    const wired = wiring(options);
    const result = await executeProspectWizardGeneration(REQUEST, wired.deps);
    assert.equal(result.ok, true, 'los cuatro casos son corridas que terminan bien');
    return { result: result as SuccessResult, observed: wired.observed };
  });
}

// ── § 1 · los cuatro casos del corte ─────────────────────────────────────────

describe('CUT-2 § 1 · CASO A — Apollo 0, Lusha 5 ⇒ la corrida vale 5', () => {
  it('candidateCount = 5 y targetReached = true', async () => {
    const { result } = await run({
      apolloPersisted: 0,
      leg: { kind: 'executed', persisted: TARGET, accepted: TARGET },
    });
    assert.equal(result.candidateCount, TARGET, '🔴 las filas de Lusha son filas del lote');
    assert.equal(result.targetReached, true);
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, TARGET);
  });

  it('el estado deja de decir «no hay nada» sobre un lote con empresas dentro', async () => {
    const { result } = await run({
      apolloPersisted: 0,
      leg: { kind: 'executed', persisted: TARGET, accepted: TARGET },
    });
    assert.equal(result.status, 'success_target_reached');
    assert.equal(result.batchStatus, 'ready_for_review');
    assert.equal(
      result.noNewCandidatesBreakdown,
      undefined,
      '🔴 el desglose de «sin empresas nuevas» no puede acompañar a 5 empresas',
    );
  });

  it('la pierna recibió el hueco ENTERO: Apollo no aportó nada', async () => {
    const { observed } = await run({
      apolloPersisted: 0,
      leg: { kind: 'executed', persisted: TARGET, accepted: TARGET },
    });
    assert.deepEqual(observed.legInputs, [{ target: TARGET, usefulAccumulated: 0 }]);
  });
});

describe('CUT-2 § 2 · CASO B — Apollo 5, Lusha NO corre ⇒ 5, sin doble conteo', () => {
  for (const leg of [
    { label: 'la pierna no está cableada', behaviour: { kind: 'not_wired' } as LegBehaviour },
    { label: 'la pierna se salta', behaviour: { kind: 'skipped' } as LegBehaviour },
  ]) {
    it(`${leg.label} ⇒ candidateCount = 5 exacto`, async () => {
      const { result } = await run({ apolloPersisted: TARGET, leg: leg.behaviour });
      assert.equal(result.candidateCount, TARGET, '🔴 ni una fila de más');
      assert.equal(result.targetReached, true);
      assert.equal(result.status, 'success_target_reached');
      assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, TARGET);
      assert.equal(
        result.acceptedForTarget?.persistedTotalCandidates,
        TARGET,
        '🔴 el universo durable tampoco se infla',
      );
    });
  }

  it('con el objetivo cerrado por Apollo, la traza declara que la pierna no aportó', async () => {
    const { result } = await run({ apolloPersisted: TARGET, leg: { kind: 'skipped' } });
    assert.equal(result.lushaWaterfallLeg?.executed, false);
    assert.equal(result.lushaWaterfallLeg?.persistedCandidates ?? null, null);
    assert.equal(result.lushaWaterfallLeg?.acceptedForTarget ?? null, null);
  });
});

describe('CUT-2 § 3 · CASO C — Apollo 3, Lusha 2 ⇒ 5 y objetivo alcanzado', () => {
  it('candidateCount = 5, targetReached = true', async () => {
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 2, accepted: 2 },
    });
    assert.equal(result.candidateCount, 5);
    assert.equal(result.targetReached, true);
    assert.equal(result.status, 'success_target_reached');
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 5);
  });

  it('la pierna corrió con el hueco RESTANTE, no con el objetivo entero', async () => {
    const { observed } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 2, accepted: 2 },
    });
    assert.deepEqual(observed.legInputs, [{ target: TARGET, usefulAccumulated: 3 }]);
  });

  it('la traza dice lo que la pierna aportó', async () => {
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 2, accepted: 2 },
    });
    assert.equal(result.lushaWaterfallLeg?.executed, true);
    assert.equal(result.lushaWaterfallLeg?.persistedCandidates, 2);
    assert.equal(result.lushaWaterfallLeg?.acceptedForTarget, 2);
  });
});

describe('CUT-2 § 4 · CASO D — Apollo 3, Lusha 1 ⇒ 4 y objetivo NO alcanzado', () => {
  it('candidateCount = 4, targetReached = false', async () => {
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 1, accepted: 1 },
    });
    assert.equal(result.candidateCount, 4);
    assert.equal(result.targetReached, false, '🔴 4 de 5 no es «objetivo alcanzado»');
    assert.equal(result.status, 'success_partial');
    assert.equal(result.batchStatus, 'ready_for_review');
    assert.equal(result.acceptedForTarget?.remainingTarget, 1);
  });
});

// ── § 5 · fail-closed y no-sobreconteo ───────────────────────────────────────

describe('CUT-2 § 5 · una pierna que no MIDIÓ aporta cero, nunca sus filas', () => {
  it('Lusha persiste 2 y no publica su aceptación ⇒ 5 filas, objetivo NO alcanzado', async () => {
    const { result } = await run({
      apolloPersisted: 3,
      leg: { kind: 'executed', persisted: 2, accepted: null },
    });
    assert.equal(result.candidateCount, 5, '🔴 las filas existen y se reportan (§ 10 de CUT-7)');
    assert.equal(result.targetReached, false, '🔴 no medir no es cumplir');
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 3);
    assert.equal(result.acceptedForTarget?.paidAcceptanceMeasured, false);
    assert.deepEqual(result.acceptedForTarget?.acceptanceUnknownReasons, [
      'acceptance_not_measured',
    ]);
  });

  it('una pierna que produce de MÁS no acepta por encima del objetivo', () => {
    const demand = fullTargetResultDemand(TARGET);
    const resolved = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 3,
        persistedCandidates: 3,
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 9,
        persistedCandidates: 9,
      }),
    });
    assert.equal(resolved.acceptedForTargetTotal, TARGET, '🔴 acotado al objetivo');
    assert.equal(resolved.acceptedPaidForTarget, TARGET);
    assert.equal(resolved.remainingTarget, 0);
    assert.equal(
      resolved.persistedTotalCandidates,
      12,
      '🔴 el universo durable NO se recorta para que el aceptado cuadre',
    );
  });

  it('sin segunda pierna el resultado es IDÉNTICO al anterior al corte', () => {
    const demand = fullTargetResultDemand(TARGET);
    const paid = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: 3,
      persistedCandidates: 4,
    });
    const withoutLeg = resolveAcceptedForTarget({ demand, freePersistedCandidates: 2, paid });
    const withNotRunLeg = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 2,
      paid,
      paidWaterfall: CONTRIBUTOR_NOT_RUN,
    });
    assert.deepEqual(withNotRunLeg, withoutLeg, '🔴 campo por campo');
  });
});

// ── § 6 · guarda estática — una sola autoridad, y después de las piernas ─────

const ORCHESTRATOR = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';

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

describe('CUT-2 § 6 · guarda estática — el veredicto se resuelve al final', () => {
  it('la aceptación FINAL se resuelve después de la pierna Lusha', () => {
    const src = code(ORCHESTRATOR);
    const legIndex = src.indexOf('const lushaWaterfall: LushaWaterfallLegOutcome');
    const finalIndex = src.indexOf('const acceptedForTarget = resolveRunAcceptance(');
    assert.ok(legIndex > 0, 'la pierna sigue en el orquestador');
    assert.ok(finalIndex > 0, 'la autoridad final existe');
    assert.ok(
      finalIndex > legIndex,
      '🔴 resolverla antes de la pierna ES el defecto que este corte cierra',
    );
  });

  it('la cifra PRE-Lusha no puede volver a reportarse como final', () => {
    const src = code(ORCHESTRATOR);
    for (const forbidden of [
      'candidateCount: combinedDurableTotals.totalDurableCandidates,',
      'targetReached: acceptedAfterApollo.targetReached',
      'const targetReached = acceptedAfterApollo.targetReached;',
    ]) {
      assert.equal(src.includes(forbidden), false, `cifra pre-Lusha reportada: ${forbidden}`);
    }
  });

  it('no hay una segunda aritmética de aceptación en el orquestador', () => {
    const src = code(ORCHESTRATOR);
    assert.equal(
      (src.match(/resolveAcceptedForTarget\(/g) ?? []).length,
      1,
      '🔴 una sola entrada a la ecuación canónica, dentro de `resolveRunAcceptance`',
    );
    for (const forbidden of [
      /acceptedForTargetTotal\s*\+/,
      />=\s*requestedTarget/,
      /candidateCount:.*\+/,
    ]) {
      assert.equal(forbidden.test(src), false, `aritmética reimplementada: ${forbidden}`);
    }
  });

  it('`stableFinalizableCandidateCount` no cambia de significado en este corte', () => {
    const src = code(ORCHESTRATOR);
    assert.equal(
      /stableFinalizableCandidateCount\s*=/.test(src),
      false,
      '🔴 este corte no redefine qué es un candidato finalizable',
    );
  });
});
