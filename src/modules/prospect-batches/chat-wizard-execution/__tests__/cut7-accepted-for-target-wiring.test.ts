/**
 * cut7-accepted-for-target-wiring.test.ts — el wizard decide «objetivo
 * alcanzado» con lo ACEPTADO, nunca con las filas.
 *
 * AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 4, 5, 6, 9, 10, 11, 12, 13, 15,
 * 16, 17.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 *   objetivo 10 · 4 empresas gratuitas · 6 filas de pago
 *   de esas 6 filas, 2 son de SÓLO REVISIÓN
 *   → el wizard anunciaba `success_target_reached` sobre 8 empresas
 *
 * El writer ya publicaba la cifra correcta —`completeValidCandidates`, que
 * `candidate-completeness-contract.ts` llama `target_count` y describe como «lo
 * único que puede compararse con el target»—. Este archivo congela que el
 * orquestador la USE.
 *
 * ── 🔴 Por qué el doble de pago separa FILAS de ACEPTADAS ────────────────────
 *
 * El doble devuelve `candidatesCreated` y `persistenceOutcome.completeValidCandidates`
 * por separado, exactamente como el writer real. Un doble que las igualara
 * pasaría igual con el hilo cortado: es la diferencia entre las dos cifras lo que
 * distingue este corte de un renombrado.
 *
 * ── 🔴 Los valores VIVOS, no copias ──────────────────────────────────────────
 *
 * El cableado consume `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` y
 * `estimateCreditsForProvider`, las mismas que usa producción. Ningún caso los
 * escribe a mano.
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
import type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
} from '../wizard-idempotency';
import {
  WIZARD_APOLLO_MAX_ROUNDS,
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_INTERNAL,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
  type WizardApolloInput,
} from '../wizard-apollo-executor';
import { estimateCreditsForProvider } from '../wizard-budget-estimate';
import { LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED } from '@/server/prospect-batches/lusha-pending-review-limits';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-426614174071';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174072';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174073';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174074';
const OTHER_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-4266141740a7';

const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174075';
const OTHER_CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-4266141740a7';

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

function company(index: number): CountrySourceCompany {
  return {
    recordIdentityKey: `free-${index}`,
    legalName: `SINTETICA LIBRE ${index}`,
    normalizedLegalName: `sintetica libre ${index}`,
    taxId: `9300000${index}`,
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
  persistedInto: (string | null)[];
  durableIdentities: Map<string, Set<string>>;
};

/**
 * 🔴 `acceptedNovel` y `persistedCount` son parámetros INDEPENDIENTES.
 *
 * La puerta previa al pago acepta `acceptedNovel` empresas por precisión, dedupe
 * y HubSpot; el writer deja `persistedCount` filas. Que se puedan separar es lo
 * que hace representable el CASO B de § 4 —10 filas, 7 aceptadas—, que antes de
 * este corte era literalmente inexpresable porque la aceptación se sobrescribía
 * con el recuento de filas.
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
        // 🔴 Se escriben `persistedCount` filas aunque superen a las aceptadas: es
        // el caso que prueba que persistir no acredita aceptación.
        for (let i = 0; i < input.persistedCount; i += 1) {
          const key = `free-${i}`;
          if (seed.has(key) || existing.has(key)) continue;
          existing.add(key);
          written += 1;
        }
        layer.durableIdentities.set(landed, existing);
        return {
          batchId: written > 0 ? landed : null,
          writtenCount: written,
          skippedCount: Math.max(0, input.persistedCount - written),
          failed: written === 0,
        };
      },
    },
  };

  return layer;
}

// ── Doble de la ruta de pago ─────────────────────────────────────────────────

/**
 * `rows` = filas escritas · `accepted` = filas que cumplen el contrato completo.
 * `measured: false` modela un pipeline que escribió y NO midió completitud.
 */
type PaidBehaviour =
  | { kind: 'returns'; rows: number; accepted?: number; measured?: boolean }
  | { kind: 'not_configured' };

type Observed = {
  apolloCalls: WizardApolloInput[];
  reserveSlotCalls: WizardExecutionReservationInput[];
  reserveBudgetCalls: { requestedCredits: number }[];
  sealed: { batchId: string; status: string }[];
};

type WiringOptions = {
  free?: PrePaidNoveltyDiscoveryDeps;
  paid?: PaidBehaviour;
  slots?: Map<string, string>;
};

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
  };
  const slots = options.slots ?? new Map<string, string>();
  const paid: PaidBehaviour = options.paid ?? { kind: 'returns', rows: TARGET };

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
            // 🔴 EL VALOR VIVO.
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
      return { status: 'reserved' as const, reservationId: 'res-1', creditsReserved: 3 };
    },
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async (input): Promise<WizardExecutionReservationResult> => {
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
            const remaining = input.resultDemand?.remainingTarget ?? TARGET;
            // El writer no escribe más filas que el hueco: es su cupo (Pass 3).
            const rows = Math.min(paid.rows, remaining);
            const accepted = Math.min(paid.accepted ?? rows, rows);
            const measured = paid.measured ?? true;
            return {
              batchId: input.reservedBatchId,
              candidatesCreated: rows,
              targetPersistibleCandidates: remaining,
              // 🔴 El veredicto PROPIO del pipeline sigue contando filas contra su
              // hueco recortado. Se deja tal cual a propósito: CUT-7 prueba que el
              // wizard ya NO lo usa, y para eso tiene que poder discrepar.
              targetReached: rows >= remaining && remaining > 0,
              persistenceOutcome: {
                eligibleBeforePersistence: rows,
                persistedCandidates: rows,
                persistenceFailureCount: 0,
                persistenceFailed: false,
                persistenceErrorCode: null,
                persistenceErrorStage: null,
                persistenceStatus: 'success',
                persistenceAttemptedCount: rows,
                persistenceSucceededCount: rows,
                persistenceFailedCount: 0,
                persistenceGap: 0,
                ...(measured
                  ? { completeValidCandidates: accepted, reviewOnlyCandidates: rows - accepted }
                  : {}),
              },
            } as unknown as IncrementalSearchOutput;
          },
    markBatchFailed: async () => undefined,
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
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved.execution;
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved.apollo;
  }
}

// ── § 9 · la política de completitud, extremo a extremo ──────────────────────

describe('CUT-7 § 9 · el wizard cierra el objetivo con lo ACEPTADO', () => {
  it('CASO A — free acepta el objetivo entero ⇒ 0 preflight, 0 reserva, 0 proveedor', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });
      const wired = wiring({ free: free.deps });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(wired.observed.reserveBudgetCalls.length, 0);
      assert.equal(wired.observed.apolloCalls.length, 0);
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(result.ok && result.targetReached, true);
      assert.equal(result.ok && result.acceptedForTarget?.acceptedFreeForTarget, TARGET);
      assert.equal(result.ok && result.acceptedForTarget?.acceptedPaidForTarget, 0);
      assert.equal(result.ok && result.acceptedForTarget?.remainingTarget, 0);
    });
  });

  it('CASO B — free PERSISTE 10 y ACEPTA 7 ⇒ la ruta de pago CORRE con hueco 3', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 7, persistedCount: 10 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', rows: 3 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(wired.observed.apolloCalls.length, 1, '🔴 NEGATIVO F — 10 filas NO cierran el objetivo');
      assert.equal(wired.observed.apolloCalls[0]!.resultDemand?.remainingTarget, 3);
      assert.equal(result.ok && result.acceptedForTarget?.acceptedFreeForTarget, 7);
      assert.equal(
        result.ok && result.acceptedForTarget?.persistedFreeCandidates,
        10,
        '🔴 § 10 — las 10 filas siguen ahí: no se borra nada para cuadrar',
      );
      assert.equal(result.ok && result.acceptedForTarget?.acceptedForTargetTotal, TARGET);
      assert.equal(result.ok && result.status, 'success_target_reached');
    });
  });

  it('CASO C — free 4 + 6 filas de pago con 2 de SÓLO REVISIÓN ⇒ 8 aceptadas, NUNCA 10', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({
        free: free.deps,
        paid: { kind: 'returns', rows: 6, accepted: 4 },
      });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok && result.candidateCount, TARGET, '§ 10 — 10 filas durables, sí');
      assert.equal(
        result.ok && result.acceptedForTarget?.acceptedForTargetTotal,
        8,
        '🔴 pero sólo 8 cuentan hacia el objetivo',
      );
      assert.equal(result.ok && result.targetReached, false);
      assert.equal(
        result.ok && result.status,
        'success_partial',
        '🔴 § 11 — la corrida terminó corta y el estado tiene que decirlo',
      );
      assert.equal(result.ok && result.acceptedForTarget?.remainingTarget, 2);
    });
  });

  it('CASO D — el proveedor acepta MÁS que el hueco ⇒ se recorta, total exacto', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      // El cupo del writer ya lo acota a 6; aun así el aporte no puede pasar de 6.
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', rows: 9, accepted: 9 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.ok(result.ok && (result.acceptedForTarget?.acceptedPaidForTarget ?? 0) <= 6);
      assert.equal(result.ok && result.acceptedForTarget?.acceptedForTargetTotal, TARGET);
      assert.equal(result.ok && result.targetReached, true);
    });
  });
});

// ── El pipeline dice «alcanzado» y el wizard NO le cree ──────────────────────

describe('CUT-7 §§ 1, 17 · el veredicto del pipeline ya no gobierna', () => {
  it('sin capa gratuita, 10 filas con 6 completas ⇒ success_partial', async () => {
    await withEnv(async () => {
      const wired = wiring({ paid: { kind: 'returns', rows: TARGET, accepted: 6 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok && result.candidateCount, TARGET);
      assert.equal(
        result.ok && result.acceptedForTarget?.acceptedPaidForTarget,
        6,
        '🔴 NEGATIVO H — el consumidor no puede leer las filas como objetivo logrado',
      );
      assert.equal(result.ok && result.targetReached, false);
      assert.equal(result.ok && result.status, 'success_partial');
    });
  });

  it('sin capa gratuita, 10 filas y 10 completas ⇒ success_target_reached', async () => {
    await withEnv(async () => {
      const wired = wiring({ paid: { kind: 'returns', rows: TARGET, accepted: TARGET } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);
      assert.equal(result.ok && result.targetReached, true);
      assert.equal(result.ok && result.status, 'success_target_reached');
    });
  });

  it('un pipeline que escribió y NO midió completitud NO cierra el objetivo', async () => {
    await withEnv(async () => {
      const wired = wiring({
        paid: { kind: 'returns', rows: TARGET, accepted: TARGET, measured: false },
      });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok && result.candidateCount, TARGET, 'las filas existen y se reportan');
      assert.equal(result.ok && result.targetReached, false, '🔴 no medir no es cumplir');
      assert.deepEqual(result.ok ? result.acceptedForTarget?.acceptanceUnknownReasons : null, [
        'acceptance_not_measured',
      ]);
    });
  });
});

// ── § 15 · reintento, concurrencia y aislamiento ─────────────────────────────

describe('CUT-7 § 15 · el conteo aceptado no se duplica', () => {
  it('16.8 / NEGATIVO G — un reintento con el MISMO clientRequestId no cuenta dos veces', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();
      const seed = new Set<string>();
      const paid: PaidBehaviour = { kind: 'returns', rows: 6, accepted: 6 };

      const first = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const runOne = wiring({ free: first.deps, paid, slots });
      const resultOne = await executeProspectWizardGeneration(REQUEST, runOne.deps);
      assert.equal(resultOne.ok && resultOne.acceptedForTarget?.acceptedForTargetTotal, TARGET);

      // El reintento encuentra las identidades gratuitas YA presentes: el writer
      // no las vuelve a escribir, así que no puede volver a acreditarlas.
      for (const key of first.durableIdentities.get(CANONICAL_BATCH_ID) ?? []) seed.add(key);
      const second = freeLayer({ acceptedNovel: 4, persistedCount: 4, alreadyPresent: seed });
      const runTwo = wiring({ free: second.deps, paid, slots });
      const resultTwo = await executeProspectWizardGeneration(REQUEST, runTwo.deps);

      assert.equal(resultTwo.ok && resultTwo.batchId, CANONICAL_BATCH_ID, '§ 15 — mismo lote');
      assert.equal(
        resultTwo.ok && resultTwo.status,
        'already_started',
        '🔴 CUT-5 sigue mandando: la identidad de la ejecución para el reintento en seco',
      );
      assert.equal(
        resultTwo.ok && resultTwo.acceptedForTarget,
        undefined,
        '🔴 un reintento NO vuelve a acreditar: no emite conteo aceptado ninguno',
      );
      assert.equal(
        runTwo.observed.apolloCalls.length,
        0,
        '🔴 y no vuelve a llamar —ni a pagar— al proveedor',
      );
      assert.equal(first.durableIdentities.get(CANONICAL_BATCH_ID)?.size, 4);
      assert.equal(
        second.durableIdentities.get(CANONICAL_BATCH_ID)?.size ?? 0,
        0,
        '🔴 el segundo intento no escribió NI UNA identidad nueva: el lote sigue con 4, no con 8',
      );
    });
  });

  it('16.9 — dos materializaciones concurrentes de la MISMA ejecución no duplican', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({
        free: free.deps,
        paid: { kind: 'returns', rows: 6, accepted: 6 },
        slots,
      });

      const [a, b] = await Promise.all([
        executeProspectWizardGeneration(REQUEST, wired.deps),
        executeProspectWizardGeneration(REQUEST, wired.deps),
      ]);

      for (const result of [a, b]) {
        if (!result.ok) continue;
        assert.ok(
          (result.acceptedForTarget?.acceptedForTargetTotal ?? 0) <= TARGET,
          '🔴 ninguna mitad de la carrera puede sobrellenar el objetivo',
        );
      }
      assert.equal(
        new Set([...free.durableIdentities.keys()]).size,
        1,
        '🔴 § 15 — una ejecución, un lote canónico',
      );
    });
  });

  it('16.10 — dos ejecuciones DISTINTAS siguen aisladas', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();
      const one = wiring({
        free: freeLayer({ acceptedNovel: 4, persistedCount: 4 }).deps,
        paid: { kind: 'returns', rows: 6, accepted: 6 },
        slots,
      });
      const resultOne = await executeProspectWizardGeneration(REQUEST, one.deps);

      const two = wiring({
        free: freeLayer({ acceptedNovel: 2, persistedCount: 2 }).deps,
        paid: { kind: 'returns', rows: 3, accepted: 3 },
        slots,
      });
      const resultTwo = await executeProspectWizardGeneration(
        { ...REQUEST, clientRequestId: OTHER_CLIENT_REQUEST_ID },
        two.deps,
      );

      assert.equal(resultOne.ok && resultOne.batchId, CANONICAL_BATCH_ID);
      assert.equal(resultTwo.ok && resultTwo.batchId, OTHER_CANONICAL_BATCH_ID);
      assert.equal(resultOne.ok && resultOne.acceptedForTarget?.acceptedForTargetTotal, TARGET);
      assert.equal(resultTwo.ok && resultTwo.acceptedForTarget?.acceptedForTargetTotal, 5);
    });
  });
});

// ── § 0 / §§ 12, 13, 19 · lo que CUT-7 NO puede tocar ────────────────────────

describe('CUT-7 §§ 0, 12, 13 · invariantes de entrada preservadas', () => {
  it('16.11/16.12 — amplitud 25 y objetivo persistible 10 intactos', () => {
    assert.equal(WIZARD_APOLLO_TARGET_INTERNAL, 25);
    assert.equal(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES, 10);
    assert.equal(WIZARD_APOLLO_MAX_ROUNDS, 4);
  });

  it('16.13/16.14 — Apollo parcial sigue `true`, Lusha pending-review sigue `false`', () => {
    assert.equal(WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED, true);
    assert.equal(LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED, false);
  });

  it('16.15 — la RESERVA no ve el hueco: el mismo importe con y sin aporte gratuito', async () => {
    await withEnv(async () => {
      const expected = estimateCreditsForProvider('apollo_organizations');

      const withFree = wiring({
        free: freeLayer({ acceptedNovel: 4, persistedCount: 4 }).deps,
        paid: { kind: 'returns', rows: 6, accepted: 6 },
      });
      await executeProspectWizardGeneration(REQUEST, withFree.deps);

      const withoutFree = wiring({ paid: { kind: 'returns', rows: TARGET, accepted: TARGET } });
      await executeProspectWizardGeneration(REQUEST, withoutFree.deps);

      assert.equal(withFree.observed.reserveBudgetCalls[0]?.requestedCredits, expected);
      assert.equal(withoutFree.observed.reserveBudgetCalls[0]?.requestedCredits, expected);
    });
  });

  it('16.16/16.17 — un lote canónico y la traza de procedencia del proveedor intacta', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({ free: free.deps, paid: { kind: 'returns', rows: 6, accepted: 4 } });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.deepEqual(free.persistedInto, [CANONICAL_BATCH_ID]);
      assert.equal(wired.observed.apolloCalls[0]!.reservedBatchId, CANONICAL_BATCH_ID);
      assert.equal(result.ok && result.batchId, CANONICAL_BATCH_ID);
      assert.equal(
        result.ok && result.batchStatus,
        'ready_for_review',
        '🔴 § 10 — un objetivo corto NO degrada el lote ni esconde sus filas',
      );
      assert.equal(result.ok && result.runProvider?.resolved, 'apollo_organizations');
    });
  });
});

// ── § 17 · guardas estáticas ─────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** 🔴 Con los COMENTARIOS FUERA: este corte NOMBRA en prosa lo que prohíbe. */
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

const ORCHESTRATOR = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const AUTHORITY = 'src/modules/prospect-batches/accepted-for-target.ts';

describe('CUT-7 §§ 7, 12, 19 · guardas estáticas', () => {
  it('el orquestador NO compara candidatos durables contra el objetivo', () => {
    const body = stripTsComments(read(ORCHESTRATOR));
    assert.ok(
      !body.includes('totalDurableCandidates >= targetPersistibleCandidates'),
      '🔴 el veredicto de objetivo volvería a contar filas',
    );
    assert.ok(
      !body.includes('pipelineResult.targetReached === true'),
      '🔴 el veredicto del pipeline también cuenta filas',
    );
  });

  it('🔴 EN NEGATIVO — la guarda detectaría el regreso de la comparación por filas', () => {
    const mutated = `${stripTsComments(read(ORCHESTRATOR))}\nconst x = totalDurableCandidates >= targetPersistibleCandidates;\n`;
    assert.ok(mutated.includes('totalDurableCandidates >= targetPersistibleCandidates'));
  });

  it('la autoridad es PURA: sin env, sin Supabase, sin fetch, sin reloj', () => {
    const body = read(AUTHORITY);
    for (const forbidden of ['process.env', 'createClient', 'fetch(', 'Date.now', 'supabase']) {
      assert.ok(!body.includes(forbidden), `🔴 ${forbidden} en la autoridad de aceptación`);
    }
  });

  it('§ 12 — la autoridad NO deriva ninguna teoría de facturación', () => {
    const body = read(AUTHORITY);
    for (const forbidden of ['credit', 'Credit', 'budget', 'Budget', 'reserv']) {
      assert.ok(!body.includes(forbidden), `🔴 ${forbidden} en la autoridad de aceptación`);
    }
  });

  it('§ 8 — el corte no añade migración', () => {
    const body = read(AUTHORITY) + read(ORCHESTRATOR);
    for (const forbidden of ['alter table', 'ALTER TABLE', 'create table', 'CREATE TABLE']) {
      assert.ok(!body.includes(forbidden), `🔴 ${forbidden}: MIGRATION_EXPECTED = NO`);
    }
  });

  it('§ 19 — no se añade CTA «Ver lote» al bloque de éxito', () => {
    const panels = read('src/components/prospect-batches/chat-wizard/wizard-execution-panels.tsx');
    assert.ok(!panels.includes('Ver lote'), '🔴 el CTA es otro hilo');
  });
});
