/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 · REVIEW-1 §§ 2, 3, 4, 5, 8, 11 — el
 * RATCHET DE CABLEADO VIVO: la capacidad de hueco parcial existe y está probada,
 * y producción NO la usa todavía.
 *
 * ── 🔴 Por qué hacen falta DOS afirmaciones y no una ────────────────────────
 *
 * El corte 2 entregó la maquinaria residual completa: `resultDemand` llega al
 * `per_page` real, las dos rondas comparten UN hueco, `boundByRemainingTarget` es
 * la única cota. Esa maquinaria se congela en
 * `wizard-apollo-residual-demand-threading.test.ts`, que la invoca a propósito con
 * `partialGapSupported: true`.
 *
 * Lo que ESTE archivo defiende es lo contrario y es igual de importante:
 *
 *   apollo_partial_gap_capability = implemented      ← el otro archivo
 *   apollo_partial_gap_activation = deferred_single_batch   ← este archivo
 *
 * Sin este ratchet, «la capacidad está probada» se lee como «el comportamiento
 * está vivo», que es exactamente la confusión que REVIEW-1 bloqueó: con `true`,
 * objetivo 10 y 7 empresas gratis, UNA búsqueda del usuario termina en DOS lotes
 * —la capa gratuita persiste en el suyo antes de reservar, Apollo en el reservado—
 * y la redirección apunta al segundo. La invariante de sistema se cumple
 * (7 + 3 <= 10); el resultado único del producto no.
 *
 * 🔴 Y es alcanzable de verdad, no teórica: la persistencia de la fuente gratuita
 * quedó arreglada por #316 —lote `source = agent_1`, candidato
 * `source_primary = public_source`— y la QA-B real en Producción la vio escribir.
 * Lo que falta no es un CHECK de base de datos, es el diseño del resultado único:
 * `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1`.
 *
 * ── Cómo se prueba, para que la mutación duela ───────────────────────────────
 *
 * El cableado de estas pruebas consume `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`, la
 * MISMA constante que pasa el llamador de producción — no una copia escrita a mano.
 * Voltearla a `true` pone en rojo las pruebas de comportamiento de aquí. Y una
 * guarda estática cubre la otra forma de la mutación: volver a escribir el literal
 * `true` en el sitio de la llamada sin tocar la constante.
 *
 * Sin Supabase, sin Apollo, sin red, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
  type WizardApolloInput,
} from '../wizard-apollo-executor';
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

const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const PAID_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
const FREE_BATCH_ID = 'batch-free-source-activation-deferred';

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

type FreeLayer = {
  deps: PrePaidNoveltyDiscoveryDeps;
  /** 🔴 Cuántas veces la capa gratuita intentó ESCRIBIR su propio lote. */
  persistCalls: number;
};

/** Dobles SÓLO de los bordes de I/O de la capa gratuita. */
function freeLayer(input: {
  acceptedNovel: number;
  persistedCount: number;
  providerSeen?: ProviderSeenLoadSummary;
  providerSeenIds?: readonly string[];
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
    exclusionPlan: { available: 0, sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: input.providerSeen ?? PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: memory,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  const layer: FreeLayer = {
    persistCalls: 0,
    deps: {
      runGate: async () => gateResult,
      persist: async () => {
        layer.persistCalls++;
        return {
          batchId: input.persistedCount > 0 ? FREE_BATCH_ID : null,
          writtenCount: input.persistedCount,
          skippedCount: input.acceptedNovel - input.persistedCount,
          failed: input.persistedCount === 0,
        };
      },
    },
  };

  return layer;
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

/**
 * 🔴 El cableado que se prueba pasa `partialGapSupported` desde la constante de
 * producción, no desde un literal local. Es lo que convierte «voltear la constante»
 * en una mutación DETECTABLE por comportamiento y no sólo por grep.
 */
function deps(
  free: PrePaidNoveltyDiscoveryDeps,
  partialGapSupported: boolean = WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
): { deps: WizardExecutionDeps; observed: Observed } {
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
            partialGapSupported,
          },
          free,
        ),
      reserveBudget: async ({ requestedCredits }) => {
        observed.budgetCalls.push(requestedCredits);
        return { status: 'reserved', reservationId: 'res-1', creditsReserved: requestedCredits };
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

// ── REVIEW-1 § 11 · el valor VIVO ────────────────────────────────────────────

describe('REVIEW-1 § 11 · la activación de hueco parcial en producción está APAGADA', () => {
  it('🔴 `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` es `false`', () => {
    assert.equal(
      WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
      false,
      '🔴 encender esto activa el resultado en DOS lotes; es el hito ' +
        'AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1, no este corte',
    );
  });
});

// ── REVIEW-1 §§ 3, 5 · el flujo mixto NO se activa ───────────────────────────

describe('REVIEW-1 §§ 3, 5 · con aporte gratuito PARCIAL no hay flujo mixto', () => {
  it('🔴 7 de 10 gratis + Apollo requerido ⇒ NI lote gratuito NI demanda recortada', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 7, persistedCount: 7 });
      const wired = deps(free.deps);

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      // 1. La capa gratuita ni siquiera intentó escribir su lote: el descarte
      //    ocurre ANTES de persistir, así que no hay un segundo lote que el
      //    usuario tendría que ir a buscar.
      assert.equal(free.persistCalls, 0, '🔴 0 escrituras de la capa gratuita');

      // 2. Apollo corre con el objetivo ENTERO, como antes del corte.
      assert.equal(wired.observed.apolloCalls.length, 1);
      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.equal(demand?.remainingTarget, TARGET);
      assert.equal(demand?.acceptedBeforeProvider, 0);
      assert.equal(
        demand?.source,
        'prepaid_layer_absent',
        'la capa gratuita se reporta como «no aportó», que es lo que hizo',
      );

      // 3. Un solo lote, y es el de pago.
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.batchId, PAID_BATCH_ID);
      assert.notEqual(result.ok && result.batchId, FREE_BATCH_ID);
    });
  });

  it('9 de 10 gratis tampoco activan el hueco parcial', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 9, persistedCount: 9 });
      const wired = deps(free.deps);

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.persistCalls, 0);
      assert.equal(wired.observed.apolloCalls[0]!.resultDemand?.remainingTarget, TARGET);
    });
  });

  it('🔴 CONTRASTE — la capacidad SÍ existe: invocada a propósito, el hueco es 3', async () => {
    // La misma capa gratuita, el mismo ejecutor, y `partialGapSupported: true`
    // pasado EXPLÍCITAMENTE. Esto es lo que producción hará cuando el hito de lote
    // único lo autorice, y es la prueba de que aquí no se ha borrado nada.
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 7, persistedCount: 7 });
      const wired = deps(free.deps, true);

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.persistCalls, 1, 'con la capacidad activa el lote gratuito SÍ se escribe');
      const demand = wired.observed.apolloCalls[0]!.resultDemand;
      assert.equal(demand?.remainingTarget, 3);
      assert.equal(demand?.acceptedBeforeProvider, 7);
      assert.equal(demand?.source, 'prepaid_novelty_residual_gap');
    });
  });
});

// ── REVIEW-1 § 3 · CASO A · lo gratuito que cierra el objetivo sigue vivo ────

describe('REVIEW-1 § 3 CASO A · la fuente gratuita que cierra el objetivo persiste', () => {
  it('10 de 10 gratis ⇒ lote gratuito, 0 llamadas a Apollo, 0 reservas', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });
      const wired = deps(free.deps);

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.persistCalls, 1);
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(result.ok && result.batchId, FREE_BATCH_ID);
      assert.equal(wired.observed.apolloCalls.length, 0, '0 llamadas al proveedor');
      assert.equal(wired.observed.budgetCalls.length, 0, '0 reservas');
    });
  });
});

// ── REVIEW-1 § 8 · la telemetría de memoria previa NO se apaga con `false` ───

describe('REVIEW-1 § 8 · con la activación apagada, la memoria previa sigue midiendo', () => {
  it('🔴 lectura con ÉXITO ⇒ snapshot disponible aunque el aporte gratuito se descarte', async () => {
    // Es la única forma de que `provider_seen_hit` pueda ser un entero medido en
    // producción: con todo-o-nada, TODA corrida en la que Apollo ejecuta pasó por
    // el descarte. Si el descarte se llevara también la lectura, el embudo del
    // corte 1 quedaría en null para siempre.
    await withEnv(async () => {
      const free = freeLayer({
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
      });
      const wired = deps(free.deps);

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      const prior = wired.observed.apolloCalls[0]!.priorProviderSeen;
      assert.equal(prior?.available, true, '🔴 la medición sobrevive al descarte');
      assert.equal(prior?.available === true && prior.memory.providerEntityIds.size, 2);
      // Y el descarte del APORTE sigue intacto: son dos hechos distintos.
      assert.equal(free.persistCalls, 0);
      assert.equal(wired.observed.apolloCalls[0]!.resultDemand?.remainingTarget, TARGET);
    });
  });

  it('lectura con ÉXITO y memoria VACÍA ⇒ snapshot vacío (⇒ 0 aciertos, no null)', async () => {
    await withEnv(async () => {
      const free = freeLayer({
        acceptedNovel: 7,
        persistedCount: 7,
        providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
      });
      const wired = deps(free.deps);

      await executeProspectWizardGeneration(REQUEST, wired.deps);

      const prior = wired.observed.apolloCalls[0]!.priorProviderSeen;
      assert.equal(prior?.available, true);
      assert.equal(prior?.available === true && prior.memory.providerEntityIds.size, 0);
    });
  });

  it('🔴 lectura FALLIDA ⇒ ausencia NOMBRADA, jamás una memoria vacía disfrazada', async () => {
    await withEnv(async () => {
      const free = freeLayer({
        acceptedNovel: 7,
        persistedCount: 7,
        providerSeen: PROVIDER_SEEN_LOAD_FAILED,
      });
      const wired = deps(free.deps);

      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      const prior = wired.observed.apolloCalls[0]!.priorProviderSeen;
      assert.equal(prior?.available, false);
      assert.equal(
        prior?.available === false && prior.unavailableReason,
        'provider_seen_memory_read_failed',
      );
      assert.equal(result.ok, true, 'un fallo de memoria no bloquea lo ya autorizado');
    });
  });
});

// ── REVIEW-1 § 11 · la otra forma de la mutación: el literal en el sitio ─────

const ROOT = path.resolve(__dirname, '../../../../..');
const WIZARD_ACTIONS =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const WIZARD_APOLLO = 'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 🔴 Con los COMENTARIOS FUERA. Este archivo NOMBRA `partialGapSupported: true` en
 * su prosa y en la del llamador, y una guarda que leyera el cuerpo crudo
 * confundiría «citarlo» con «usarlo» — el falso positivo exacto de
 * AGENT2A-SEARCH-MORE-PHONES-1G.
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

describe('REVIEW-1 § 11 · el sitio de la llamada no puede recuperar el literal', () => {
  it('el llamador vivo pasa la CONSTANTE, no un booleano escrito a mano', () => {
    const code = stripTsComments(read(WIZARD_ACTIONS));

    assert.ok(
      code.includes('partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,'),
      'el valor vivo se decide en un solo sitio',
    );
    for (const forbidden of ['partialGapSupported: true', 'partialGapSupported: !']) {
      assert.ok(
        !code.includes(forbidden),
        `🔴 la activación no puede volver por el sitio de la llamada (${forbidden})`,
      );
    }
  });

  it('la constante se declara `false` en su único dueño', () => {
    const code = stripTsComments(read(WIZARD_APOLLO));
    assert.ok(
      code.includes('export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = false;'),
      'la declaración es literal y grep-able',
    );
  });

  /** 🔴 EN NEGATIVO — la guarda detecta la mutación en el sitio de la llamada. */
  it('mutación: reescribir el literal en el llamador pone la guarda en rojo', () => {
    const mutated = stripTsComments(read(WIZARD_ACTIONS)).replace(
      'partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,',
      'partialGapSupported: true,',
    );
    assert.ok(
      !mutated.includes('partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,'),
      'la copia mutada perdió el anclaje',
    );
    assert.ok(mutated.includes('partialGapSupported: true'), 'y gana el literal prohibido');
  });

  /** 🔴 EN NEGATIVO — y también la mutación de la constante. */
  it('mutación: voltear la constante pone su guarda en rojo', () => {
    const mutated = stripTsComments(read(WIZARD_APOLLO)).replace(
      'export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = false;',
      'export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = true;',
    );
    assert.ok(!mutated.includes('export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = false;'));
  });
});
