/**
 * AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 § 5 — REGRESIÓN PERMANENTE del
 * orden entre lo GRATUITO y el presupuesto de PAGO.
 *
 * ── Qué invariante se defiende ───────────────────────────────────────────────
 *
 *     presupuesto del proveedor de pago DISPONIBLE = 0
 *   + la fuente gratuita cierra el objetivo
 *   + la persistencia gratuita tiene éxito
 *   ⇒ ÉXITO, sin pasar por la puerta de presupuesto
 *
 * y por tanto: 0 reservas, 0 llamadas al proveedor.
 *
 * ── 🔴 Por qué esta prueba vive AQUÍ y no en el runner gratuito ─────────────
 *
 * `runPrePaidNoveltyDiscovery` NO conoce el presupuesto: sus dependencias son un
 * adapter de lectura y un escritor. Afirmar «0 reservas» ahí sería tautológico —
 * no existe la capacidad de reservar. La capa que de verdad POSEE el orden es
 * `executeProspectWizardGeneration`: ella corre lo gratuito (paso 5d), decide si
 * puede volver antes, y sólo después estima (paso 6) y reserva (paso 7).
 *
 * `prepaid-novelty-static-safety.test.ts` ya comprueba ese orden de forma
 * ESTÁTICA (posición textual de `deps.runPrePaidNoveltyDiscovery` antes de
 * `deps.reserveBudget`). Un índice de texto no demuestra que en EJECUCIÓN no se
 * reserve: un `if` mal puesto, una rama que cae al paso 7 o un retorno temprano
 * que se pierda dejarían el orden textual intacto y la reserva viva. Esta prueba
 * es la contraparte de tiempo de ejecución.
 *
 * ── 🔴 Los números que importan se CALCULAN, no se fijan ────────────────────
 *
 * `residualGap`, `acceptedBeforeProvider`, `providerRequired` y `persistedCount`
 * salen del `runPrePaidNoveltyDiscovery` REAL, compuesto con el
 * `buildPrePaidNoveltyContext` REAL y el `withFreeSourcePersistenceOutcome`
 * REAL. Los dobles son sólo los dos bordes de I/O: la lectura de la fuente
 * (`runGate`) y la escritura (`persist`). Si la aritmética del hueco se rompiera,
 * esta prueba lo vería.
 *
 * Sin Supabase, sin Tavily, sin Apollo, sin red. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { ReserveBudgetDepResult, WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { WizardExecutionReservationInput } from '../wizard-idempotency';
import type { WizardTavilyInput } from '../wizard-tavily-executor';
import { WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES } from '../wizard-apollo-executor';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
  type PrePaidNoveltyDiscoveryOutcome,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_UNAVAILABLE } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const FAKE_USER_ID = 'user-prepaid-budget-zero-0001';
const VALID_INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const VALID_SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const VALID_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174003';
const CATALOG_VERSION = 'v2024-01';
const FREE_BATCH_ID = 'batch-free-source-0001';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: VALID_INDUSTRY_ID,
  subindustryIds: [VALID_SUBINDUSTRY_ID],
  additionalCriteriaRaw: null,
  catalogVersion: CATALOG_VERSION,
  clientRequestId: VALID_CLIENT_REQUEST_ID,
};

// `health-pharma` es el slug publicado de la macro `health_pharma`, así que
// `getMacroIndustryBySlug(...)?.key` resuelve de verdad y la capa gratuita
// recibe una macro canónica — no `null`.
const FAKE_CATALOG: CatalogResolutionOutput = {
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: CATALOG_VERSION },
  industry: { id: VALID_INDUSTRY_ID, slug: 'health-pharma', name: 'Salud / Farma' },
  subindustries: [
    { id: VALID_SUBINDUSTRY_ID, slug: 'clinicas', name: 'Clínicas', applicableCountries: ['CO'] },
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

/**
 * Dobles SÓLO de los dos bordes de I/O del runner gratuito. Todo lo que decide
 * (contexto, hueco, reapertura por persistencia) es código real.
 */
function makeFreeLayerDeps(input: {
  acceptedNovel: number;
  persistedCount: number;
}): { deps: PrePaidNoveltyDiscoveryDeps; persistCalls: () => number } {
  let persistCalls = 0;
  const accepted = Array.from({ length: input.acceptedNovel }, (_, i) => company(i));

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
    providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  return {
    deps: {
      runGate: async () => gateResult,
      persist: async () => {
        persistCalls++;
        return {
          batchId: input.persistedCount > 0 ? FREE_BATCH_ID : null,
          writtenCount: input.persistedCount,
          skippedCount: input.acceptedNovel - input.persistedCount,
          failed: input.persistedCount === 0,
        };
      },
    },
    persistCalls: () => persistCalls,
  };
}

// ── Deps del wizard, con contadores en todo lo que cuesta dinero ─────────────

type BudgetCall = { userId: string; clientRequestId: string; requestedCredits: number };

type TrackedDeps = WizardExecutionDeps & {
  budgetCalls: BudgetCall[];
  confirmCalls: unknown[];
  releaseCalls: unknown[];
  slotCalls: WizardExecutionReservationInput[];
  tavilyCalls: WizardTavilyInput[];
};

/**
 * `reserveBudget` devuelve BLOQUEADO con 0 disponibles: si el orden se rompiera
 * y el paso 7 llegara a ejecutarse, la corrida no sólo contaría una reserva —
 * fallaría, y la aserción de `ok: true` también lo delataría.
 */
function makeDeps(overrides: Partial<WizardExecutionDeps> = {}): TrackedDeps {
  const budgetCalls: BudgetCall[] = [];
  const confirmCalls: unknown[] = [];
  const releaseCalls: unknown[] = [];
  const slotCalls: WizardExecutionReservationInput[] = [];
  const tavilyCalls: WizardTavilyInput[] = [];

  const base: WizardExecutionDeps = {
    getActiveUserId: async () => FAKE_USER_ID,
    resolveCatalog: async () => FAKE_CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    reserveBudget: async (input) => {
      budgetCalls.push(input);
      return {
        status: 'blocked',
        code: 'BUDGET_EXCEEDED',
        message: 'presupuesto agotado',
        budgetSnapshot: {
          budgetCredits: 295,
          creditsConsumed: 295,
          creditsReserved: 0,
          availableCredits: 0,
        },
      } satisfies ReserveBudgetDepResult;
    },
    confirmBudget: async (input) => {
      confirmCalls.push(input);
      return { status: 'confirmed' };
    },
    releaseBudget: async (input) => {
      releaseCalls.push(input);
      return { status: 'released' };
    },
    readConsumedCredits: async () => null,
    reserveSlot: async (input) => {
      slotCalls.push(input);
      return { status: 'reserved', batchId: 'batch-paid-should-never-exist' };
    },
    runTavilyPipeline: async (input) => {
      tavilyCalls.push(input);
      throw new Error('el proveedor de pago NO debe ejecutarse en esta corrida');
    },
    markBatchFailed: async () => { /* no-op */ },
  };

  return {
    ...base,
    ...overrides,
    budgetCalls,
    confirmCalls,
    releaseCalls,
    slotCalls,
    tavilyCalls,
  };
}

async function withExecutionFlag<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  }
}

// ── La regresión ─────────────────────────────────────────────────────────────

describe('§ 5 — presupuesto de pago en 0 y objetivo cerrado gratis', () => {
  it('la corrida TERMINA EN ÉXITO sin reservar ni un crédito ni llamar al proveedor', async () => {
    await withExecutionFlag(async () => {
      const free = makeFreeLayerDeps({ acceptedNovel: TARGET, persistedCount: TARGET });

      // El desenlace de la capa gratuita, calculado por el runner REAL, con el
      // MISMO cableado que producción usa en la ruta Apollo/Tavily:
      // `partialGapSupported: false`, `provider: 'apollo'`.
      const observed: PrePaidNoveltyDiscoveryOutcome[] = [];

      const deps = makeDeps({
        runPrePaidNoveltyDiscovery: async (input) => {
          const result = await runPrePaidNoveltyDiscovery(
            CLIENT,
            {
              provider: 'apollo',
              countryCode: input.countryCode,
              countryName: input.countryName,
              macroIndustryKey: input.macroIndustryKey,
              requestedTarget: input.requestedTarget,
              requestedByUserId: input.requestedByUserId,
              partialGapSupported: false,
            },
            free.deps,
          );
          observed.push(result);
          return result;
        },
      });

      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

      // ── Lo que la capa gratuita CALCULÓ ────────────────────────────────────
      assert.equal(observed.length, 1, 'la capa gratuita debe haberse ejecutado una vez');
      const outcome = observed[0]!;
      assert.equal(free.persistCalls(), 1, 'se persistió exactamente una vez');
      assert.ok(
        outcome.acceptedBeforeProvider >= TARGET,
        `acceptedBeforeProvider (${outcome.acceptedBeforeProvider}) debe alcanzar el objetivo ${TARGET}`,
      );
      assert.ok(
        outcome.persistedCount >= TARGET,
        `persistedCount (${outcome.persistedCount}) debe alcanzar el objetivo ${TARGET}`,
      );
      assert.equal(outcome.residualGap, 0, 'el hueco queda cerrado');
      assert.equal(outcome.providerRequired, false, 'no hace falta proveedor de pago');
      assert.equal(outcome.batchId, FREE_BATCH_ID);

      // ── Lo que el wizard DEVOLVIÓ ─────────────────────────────────────────
      assert.equal(result.ok, true, 'la corrida debe terminar en éxito');
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(result.ok && result.batchId, FREE_BATCH_ID);
      assert.equal(result.ok && result.candidateCount, TARGET);
      assert.equal(result.ok && result.targetReached, true);

      // ── Lo que NO ocurrió: el gasto ───────────────────────────────────────
      assert.equal(deps.budgetCalls.length, 0, '0 reservas de presupuesto');
      assert.equal(deps.confirmCalls.length, 0, '0 confirmaciones');
      assert.equal(deps.releaseCalls.length, 0, '0 liberaciones');
      assert.equal(deps.slotCalls.length, 0, '0 lotes de pago');
      assert.equal(deps.tavilyCalls.length, 0, '0 llamadas al proveedor');
    });
  });

  /**
   * Contraprueba: la MISMA prueba con la fuente gratuita aportando de menos.
   * Sin ella, «0 reservas» podría pasar por un cableado roto que nunca reserva
   * nada, y la regresión no distinguiría el arreglo del apagado.
   */
  it('contraprueba — si lo gratuito NO cierra el objetivo, la puerta de presupuesto SÍ se cruza', async () => {
    await withExecutionFlag(async () => {
      const free = makeFreeLayerDeps({ acceptedNovel: TARGET - 1, persistedCount: TARGET - 1 });

      const deps = makeDeps({
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
              partialGapSupported: false,
            },
            free.deps,
          ),
      });

      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

      // Todo-o-nada en esta ruta: un hueco parcial se descarta y no se persiste.
      assert.equal(free.persistCalls(), 0, 'con hueco parcial ni se intenta persistir');
      assert.equal(deps.budgetCalls.length, 1, 'la reserva SÍ se intenta');
      assert.equal(deps.budgetCalls[0]!.userId, FAKE_USER_ID);
      // Y con 0 disponibles, la corrida se bloquea ahí — sin llamar al proveedor.
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.code, 'BUDGET_EXCEEDED');
      assert.equal(deps.tavilyCalls.length, 0);
    });
  });

  /**
   * El caso que el contrato de § 12 exige y que el histórico confundió: la
   * fuente descubrió, pero la ESCRITURA falló. El hueco se reabre y el proveedor
   * vuelve a ser necesario — no se anuncia un objetivo cerrado con 0 filas.
   */
  it('la escritura gratuita que falla NO produce éxito: el hueco se reabre y el presupuesto vuelve a decidir', async () => {
    await withExecutionFlag(async () => {
      const free = makeFreeLayerDeps({ acceptedNovel: TARGET, persistedCount: 0 });

      const deps = makeDeps({
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
              partialGapSupported: false,
            },
            free.deps,
          ),
      });

      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);

      assert.equal(free.persistCalls(), 1, 'la escritura sí se intentó');
      assert.equal(deps.budgetCalls.length, 1, 'con 0 persistidos el proveedor sigue siendo necesario');
      assert.equal(result.ok, false);
      assert.equal(deps.tavilyCalls.length, 0);
    });
  });
});
