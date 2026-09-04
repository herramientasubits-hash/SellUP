/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 5, 12, 16 — el hilo COMPLETO,
 * desde la capa gratuita hasta el ejecutor de Apollo, en la ruta real.
 *
 * 🔴 REVIEW-1 §§ 4, 11 — este archivo prueba la CAPACIDAD: el hueco parcial se
 * invoca a propósito (`partialGapSupported: true`) para que la maquinaria residual
 * quede congelada. NO describe el cableado vivo de producción, que sigue en
 * `false`; eso lo prueba `wizard-apollo-partial-gap-activation-deferred.test.ts`.
 *
 * ── Qué invariantes se defienden ─────────────────────────────────────────────
 *
 *   1. § 3/§ 4 — el hueco que la capa gratuita deja abierto LLEGA al ejecutor
 *      de Apollo, y llega recortado, no como el objetivo entero.
 *   2. 🔴 § 5/§ 16 — la RESERVA no se mueve. Con hueco 3 o con hueco 10, el
 *      número de créditos reservados es el MISMO. Ésta es la prueba de que la
 *      demanda de resultados y el techo financiero siguen desacoplados mientras
 *      P0-1 no esté confirmado por Apollo.
 *   3. § 12 — la memoria previa viaja con su desenlace: una lectura con éxito
 *      llega como snapshot, y una fallida como ausencia NOMBRADA, nunca como
 *      memoria vacía.
 *
 * ── 🔴 Por qué la aritmética no se fija a mano ──────────────────────────────
 *
 * `residualGap` y `acceptedBeforeProvider` salen del `runPrePaidNoveltyDiscovery`
 * REAL, compuesto con el `buildPrePaidNoveltyContext` REAL. Los dobles son sólo
 * los dos bordes de I/O de la capa gratuita. Si la aritmética del hueco se
 * rompiera, estas pruebas lo verían.
 *
 * Sin Supabase, sin Apollo, sin red, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
  type WizardApolloInput,
} from '../wizard-apollo-executor';
import { estimateCreditsForProvider } from '../wizard-budget-estimate';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import {
  buildProviderSeenMemory,
  collectProviderSeenObservations,
  EMPTY_PROVIDER_SEEN_MEMORY,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  PROVIDER_SEEN_LOAD_EMPTY,
  PROVIDER_SEEN_LOAD_FAILED,
  type ProviderSeenLoadSummary,
} from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-426614174009';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';
const PAID_BATCH_ID = '523e4567-e89b-12d3-a456-426614174004';
const FREE_BATCH_ID = 'batch-free-source-cut2';

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

const CLIENT = {} as unknown as SupabaseClient;

function company(index: number): CountrySourceCompany {
  return {
    recordIdentityKey: `free-${index}`,
    legalName: `SINTETICA LIBRE ${index}`,
    normalizedLegalName: `sintetica libre ${index}`,
    taxId: `9100000${index}`,
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

/** Dobles SÓLO de los bordes de I/O de la capa gratuita. */
function freeLayerDeps(input: {
  acceptedNovel: number;
  persistedCount: number;
  providerSeen?: ProviderSeenLoadSummary;
  providerSeenIds?: readonly string[];
}): PrePaidNoveltyDiscoveryDeps {
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

  const memory =
    input.providerSeenIds && input.providerSeenIds.length > 0
      ? buildProviderSeenMemory(
          collectProviderSeenObservations(
            'apollo',
            input.providerSeenIds.map((id) => ({ providerEntityId: id, domain: null })),
          ).observations,
        )
      : EMPTY_PROVIDER_SEEN_MEMORY;

  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: input.providerSeen ?? PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: memory,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  return {
    runGate: async () => gateResult,
    persist: async () => ({
      batchId: input.persistedCount > 0 ? FREE_BATCH_ID : null,
      writtenCount: input.persistedCount,
      skippedCount: input.acceptedNovel - input.persistedCount,
      failed: input.persistedCount === 0,
    }),
  };
}

type Observed = {
  apolloCalls: WizardApolloInput[];
  budgetCalls: number[];
};

function apolloOutput(): IncrementalSearchOutput {
  return {
    batchId: PAID_BATCH_ID,
    candidatesCreated: 1,
    targetReached: false,
  } as unknown as IncrementalSearchOutput;
}

function deps(free: PrePaidNoveltyDiscoveryDeps): {
  deps: WizardExecutionDeps;
  observed: Observed;
} {
  const observed: Observed = { apolloCalls: [], budgetCalls: [] };

  return {
    observed,
    deps: {
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
            // 🔴 REVIEW-1 §§ 4, 11 — invocación EXPLÍCITA de la capacidad, NO el
            // valor de producción. El cableado vivo pasa
            // `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` (`false`) y su ratchet vive en
            // `wizard-apollo-partial-gap-activation-deferred.test.ts`. Este archivo
            // prueba que la maquinaria residual funciona cuando alguien la invoca;
            // aquél prueba que producción todavía no la invoca.
            partialGapSupported: true,
          },
          free,
        ),
      reserveBudget: async ({ requestedCredits }) => {
        return { status: 'reserved', reservationId: 'res-1', creditsReserved: requestedCredits };
      },
      // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — este archivo sólo ejercita
      // Apollo, que ya no reserva vía `reserveBudget`. `budgetCalls` sigue
      // registrando el estimado de créditos del preflight, ahora desde su
      // puerta real.
      checkApolloProviderQuota: async ({ estimatedCredits }) => {
        observed.budgetCalls.push(estimatedCredits);
        return { status: 'available' as const, providerCreditsAvailable: 999 };
      },
      confirmBudget: async () => ({ status: 'confirmed' as const }),
      releaseBudget: async () => ({ status: 'released' as const }),
      readConsumedCredits: async () => 0,
      reserveSlot: async () => ({ status: 'reserved', batchId: PAID_BATCH_ID }),
      runTavilyPipeline: async () => {
        throw new Error('esta corrida es de Apollo');
      },
      runApolloPipeline: async (input) => {
        observed.apolloCalls.push(input);
        return apolloOutput();
      },
      markBatchFailed: async () => undefined,
    },
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

// ── §§ 3, 4 · el hueco llega recortado ───────────────────────────────────────

describe('CUT-2 §§ 3, 4 · la demanda residual llega al ejecutor de Apollo', () => {
  it('objetivo 10 con 7 persistidas gratis ⇒ Apollo recibe `remainingTarget: 3`', async () => {
    await withEnv(async () => {
      const wired = deps(freeLayerDeps({ acceptedNovel: 7, persistedCount: 7 }));

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.equal(wired.observed.apolloCalls.length, 1, 'Apollo se ejecutó una vez');
      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.ok(demand, 'la demanda viaja');
      assert.equal(demand.requestedTarget, TARGET);
      assert.equal(demand.acceptedBeforeProvider, 7);
      assert.equal(demand.remainingTarget, 3);
      assert.equal(demand.providerRequired, true);
      assert.equal(demand.source, 'prepaid_novelty_residual_gap');
    });
  });

  it('objetivo 10 con 9 persistidas gratis ⇒ `remainingTarget: 1`', async () => {
    await withEnv(async () => {
      const wired = deps(freeLayerDeps({ acceptedNovel: 9, persistedCount: 9 }));

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(wired.observed.apolloCalls[0]!.resultDemand?.remainingTarget, 1);
    });
  });

  it('objetivo 10 cerrado entero gratis ⇒ Apollo NO se ejecuta y no se reserva nada', async () => {
    await withEnv(async () => {
      const wired = deps(freeLayerDeps({ acceptedNovel: TARGET, persistedCount: TARGET }));

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(result.ok && result.batchId, FREE_BATCH_ID);
      assert.equal(wired.observed.apolloCalls.length, 0, '0 llamadas al proveedor');
      assert.equal(wired.observed.budgetCalls.length, 0, '0 reservas');
    });
  });

  it('sin aporte gratuito, Apollo recibe el objetivo entero — como antes del corte', async () => {
    await withEnv(async () => {
      const wired = deps(freeLayerDeps({ acceptedNovel: 0, persistedCount: 0 }));

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.equal(demand?.remainingTarget, TARGET);
    });
  });

  it('🔴 descubierto pero NO persistido: el hueco se reabre entero', async () => {
    // La escritura gratuita falló. Nada llegó al usuario, así que nada cierra
    // hueco — es la misma regla que `withFreeSourcePersistenceOutcome` aplica, y
    // aquí garantiza además que Apollo nunca reciba una demanda de cero.
    await withEnv(async () => {
      const wired = deps(freeLayerDeps({ acceptedNovel: 7, persistedCount: 0 }));

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.equal(demand?.remainingTarget, TARGET);
      assert.equal(demand?.source, 'prepaid_layer_absent');
    });
  });
});

// ── §§ 5, 16 · el RATCHET de presupuesto ─────────────────────────────────────

describe('CUT-2 §§ 5, 16 · un hueco menor NO reduce la reserva', () => {
  it('🔴 la reserva es IDÉNTICA con hueco 3 y con hueco 10', async () => {
    await withEnv(async () => {
      const conAporte = deps(freeLayerDeps({ acceptedNovel: 7, persistedCount: 7 }));
      await executeProspectWizardGeneration(REQUEST, conAporte.deps);

      const sinAporte = deps(freeLayerDeps({ acceptedNovel: 0, persistedCount: 0 }));
      await executeProspectWizardGeneration(REQUEST, sinAporte.deps);

      assert.equal(conAporte.observed.budgetCalls.length, 1);
      assert.equal(sinAporte.observed.budgetCalls.length, 1);
      assert.equal(
        conAporte.observed.budgetCalls[0],
        sinAporte.observed.budgetCalls[0],
        '🔴 la demanda de resultados NO puede mover el techo financiero',
      );
      // Y ese número es exactamente el que la autoridad canónica produce, que sólo
      // recibe el proveedor: ni objetivo, ni hueco, ni demanda.
      assert.equal(
        conAporte.observed.budgetCalls[0],
        estimateCreditsForProvider('apollo_organizations'),
      );
    });
  });

  it('la reserva tampoco cambia con hueco 1', async () => {
    await withEnv(async () => {
      const wired = deps(freeLayerDeps({ acceptedNovel: 9, persistedCount: 9 }));

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(
        wired.observed.budgetCalls[0],
        estimateCreditsForProvider('apollo_organizations'),
      );
    });
  });
});

// ── § 12 · la memoria previa y su desenlace ──────────────────────────────────

describe('CUT-2 § 12 · el desenlace de la carga de memoria viaja con la memoria', () => {
  it('lectura con ÉXITO y memoria poblada ⇒ snapshot disponible', async () => {
    await withEnv(async () => {
      const wired = deps(
        freeLayerDeps({
          acceptedNovel: 7,
          persistedCount: 7,
          providerSeen: {
            loaded: true,
            unavailableReason: null,
            idsAvailable: 2,
            domainsAvailable: 0,
            readOutcome: 'succeeded',
          },
          providerSeenIds: ['org_previa_1', 'org_previa_2'],
        }),
      );

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      const prior = wired.observed.apolloCalls[0]!.priorProviderSeen;
      assert.equal(prior?.available, true);
      assert.equal(
        prior?.available === true && prior.memory.providerEntityIds.size,
        2,
      );
    });
  });

  it('lectura con ÉXITO y memoria VACÍA ⇒ snapshot disponible y vacío (⇒ 0 aciertos, no null)', async () => {
    await withEnv(async () => {
      const wired = deps(
        freeLayerDeps({ acceptedNovel: 7, persistedCount: 7, providerSeen: PROVIDER_SEEN_LOAD_EMPTY }),
      );

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      const prior = wired.observed.apolloCalls[0]!.priorProviderSeen;
      assert.equal(prior?.available, true);
      assert.equal(prior?.available === true && prior.memory.providerEntityIds.size, 0);
    });
  });

  it('🔴 lectura FALLIDA ⇒ ausencia NOMBRADA, jamás una memoria vacía disfrazada', async () => {
    await withEnv(async () => {
      const wired = deps(
        freeLayerDeps({
          acceptedNovel: 7,
          persistedCount: 7,
          providerSeen: PROVIDER_SEEN_LOAD_FAILED,
        }),
      );

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      const prior = wired.observed.apolloCalls[0]!.priorProviderSeen;
      assert.equal(prior?.available, false);
      assert.equal(
        prior?.available === false && prior.unavailableReason,
        'provider_seen_memory_read_failed',
      );
      // § 12 — y la corrida sigue: un fallo de memoria no bloquea lo ya autorizado.
      assert.equal(result.ok, true);
      assert.equal(wired.observed.apolloCalls.length, 1);
    });
  });
});
