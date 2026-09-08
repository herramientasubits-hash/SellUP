/**
 * waterfall-cut5c-free-source-skip.test.ts — la capa gratuita corre UNA vez por
 * corrida, y la pierna Lusha conserva su recuperación.
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 5C.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * Con el waterfall encendido, la acción de Lusha volvía a ejecutar
 * `runPrePaidNoveltyDiscovery` sobre el MISMO lote después de Apollo. Esa segunda
 * pasada no puede aportar nada:
 *
 *   · lee el snapshot con orden estable y un objetivo MENOR ⇒ prefijo estricto de
 *     lo que la primera pasada ya leyó;
 *   · el dedupe previo al pago consulta `accounts`, NO `prospect_candidates`, así
 *     que no ve las filas que esta misma corrida acaba de escribir y vuelve a
 *     ofrecer la cabeza de la lista;
 *   · el writer las descarta enteras (novedad fiscal + valla de identidad de lote).
 *
 * Lo que sí costaba: una consulta al snapshot, N llamadas a HubSpot EN SERIE por
 * empresa examinada, y un ciclo de escritura completo que no escribe nada.
 *
 * ── La condición, y por qué es ÉSTA ─────────────────────────────────────────
 *
 *   skip ⟺ freeSourceAttempted === true && freeSourceFailed === false
 *
 * 🔴 `persistedCount` NO participa. Una capa gratuita que corrió entera y aceptó
 * CERO empresas es un ÉXITO: repetirla tampoco devolvería nada. Derivar el estado
 * del conteo de filas convertiría un éxito legítimo en un falso fallo y volvería a
 * pagar las llamadas a HubSpot.
 *
 * ── Lo que NO se toca ───────────────────────────────────────────────────────
 *
 * Umbral 5, Apollo R1/R2, `per_page`, páginas, núcleo pagado de Lusha,
 * presupuesto, RPC, `provider_usage_logs`, `provider_seen`, dedupe, migraciones,
 * banderas y —sobre todo— Lusha STANDALONE, que no manda bloque `waterfall` y por
 * tanto nunca entra en esta rama.
 *
 * Sin Supabase, sin HubSpot, sin Apollo, sin Lusha, sin red. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { WizardExecutionReservationResult } from '../wizard-idempotency';
import { WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES } from '../wizard-apollo-executor';
import { runLushaWaterfallLeg } from '../wizard-lusha-waterfall.server';
import type { LushaWaterfallLegInput } from '../wizard-lusha-waterfall.server';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryOutcome,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import {
  runPrePaidNoveltyGate,
  type PrePaidNoveltyGateDeps,
  type PrePaidNoveltyGateInput,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { PrePaidFreeSourceOutcome } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
} from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { ProviderSeenStore } from '@/server/prospect-batches/provider-seen/provider-seen-store';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-4266141740c1';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-4266141740c2';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-4266141740c3';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-4266141740c4';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-4266141740c5';
const WIZARD_CLIENT_REQUEST_ID = '623e4567-e89b-12d3-a456-4266141740c6';

const CLIENT = {} as unknown as SupabaseClient;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const LUSHA_ACTION = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const WIZARD_ACTION = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const LEG_SERVER = 'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server.ts';

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

/**
 * Los CUATRO desenlaces que `PrePaidFreeSourceOutcome` sabe representar, escritos
 * con sus dos campos reales y no con un estado inventado.
 */
function freeSourceOutcome(input: {
  attempted: boolean;
  failed: boolean;
  failureCode: PrePaidFreeSourceOutcome['failureCode'];
  acceptedNovel?: number;
}): PrePaidFreeSourceOutcome {
  return {
    sourceKey: input.attempted ? 'co_siis_discovery' : null,
    attempted: input.attempted,
    rawReturned: input.attempted ? 40 : 0,
    macroConfirmed: 0,
    ambiguous: 0,
    rejected: 0,
    sellupKnown: 0,
    hubspotKnown: 0,
    acceptedNovel: input.acceptedNovel ?? 0,
    failed: input.failed,
    failureCode: input.failureCode,
  };
}

const FREE_OK_ZERO_PERSISTED = freeSourceOutcome({
  attempted: true,
  failed: false,
  failureCode: null,
});
const FREE_OK_WITH_CANDIDATES = freeSourceOutcome({
  attempted: true,
  failed: false,
  failureCode: null,
  acceptedNovel: 2,
});
const FREE_SOURCE_UNAVAILABLE = freeSourceOutcome({
  attempted: true,
  failed: true,
  failureCode: 'source_unavailable',
});
const FREE_COUNTRY_WITHOUT_SOURCE = freeSourceOutcome({
  attempted: false,
  failed: true,
  failureCode: 'country_without_source',
});

/** Un desenlace del runner con el `freeSource` que la prueba quiera declarar. */
function prePaidOutcome(input: {
  freeSource: PrePaidFreeSourceOutcome;
  persistedCount: number;
}): PrePaidNoveltyDiscoveryOutcome {
  const persisted = input.persistedCount;
  return {
    requestedTarget: TARGET,
    residualGap: Math.max(0, TARGET - persisted),
    acceptedBeforeProvider: persisted,
    providerRequired: persisted < TARGET,
    batchId: persisted > 0 ? CANONICAL_BATCH_ID : null,
    persistedCount: persisted,
    knownSuppressionDomains: [],
    providerSeenMemory: { ids: new Set<string>(), domains: new Set<string>() },
    providerSeenLoad: {
      loaded: false,
      unavailableReason: 'no_authority',
      idsAvailable: 0,
      domainsAvailable: 0,
    },
    providerExclusionPlan: {
      ids: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0, unsupportedReason: null },
      domains: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0, unsupportedReason: null },
    },
    freeSource: input.freeSource,
    telemetry: {},
  } as unknown as PrePaidNoveltyDiscoveryOutcome;
}

type LegCall = { freeSourceAttempted: boolean; freeSourceFailed: boolean; usefulAccumulated: number };

/**
 * El wizard entero, con la capa gratuita y la pierna Lusha como costuras
 * inyectadas. Ni Apollo ni Lusha reales: lo que se observa es QUÉ recibe la
 * pierna, no qué hace un proveedor.
 */
function wiring(options: {
  /** `null` ⇒ la dep de la capa gratuita NO se cablea (⇒ `prePaidNovelty === null`). */
  prePaid: PrePaidNoveltyDiscoveryOutcome | null;
  /** Cuántas empresas útiles devuelve la ruta de pago. */
  paidRows: number;
}): { deps: WizardExecutionDeps; legCalls: LegCall[] } {
  const legCalls: LegCall[] = [];

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    // Apollo cobra contra su PROPIA cuota (Providers & Consumption), no contra el
    // pool del piloto: sin esta costura la ejecución falla CERRADA antes de la
    // pierna. No se toca ninguna cuota real: es una lectura falsa que devuelve
    // «hay».
    checkApolloProviderQuota: async () => ({
      status: 'available' as const,
      providerCreditsAvailable: 1000,
    }),
    resolveProvider: () => 'apollo_organizations',
    ...(options.prePaid !== null
      ? { runPrePaidNoveltyDiscovery: async () => options.prePaid as PrePaidNoveltyDiscoveryOutcome }
      : {}),
    reserveBudget: async () => ({
      status: 'reserved' as const,
      reservationId: 'res-1',
      creditsReserved: 3,
    }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async (): Promise<WizardExecutionReservationResult> => ({
      status: 'reserved',
      batchId: CANONICAL_BATCH_ID,
    }),
    sealFreeOnlyBatchStatus: async () => undefined,
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline: async (input) => {
      const remaining = input.resultDemand?.remainingTarget ?? TARGET;
      const rows = Math.min(options.paidRows, remaining);
      return {
        batchId: input.reservedBatchId,
        candidatesCreated: rows,
        targetPersistibleCandidates: remaining,
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
          completeValidCandidates: rows,
          reviewOnlyCandidates: 0,
        },
      } as unknown as IncrementalSearchOutput;
    },
    runLushaWaterfallLeg: async (input) => {
      legCalls.push({
        freeSourceAttempted: input.freeSourceAttempted,
        freeSourceFailed: input.freeSourceFailed,
        usefulAccumulated: input.usefulAccumulated,
      });
      return { executed: false, reason: 'waterfall_flag_disabled' };
    },
    markBatchFailed: async () => undefined,
  };

  return { deps, legCalls };
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

// ══ A · el wizard PUBLICA el veredicto de su capa gratuita ═══════════════════

describe('CORTE 5C § A — el estado free-source de Apollo llega a la pierna', () => {
  it('CASO 1 — attempted, sin fallo y con 0 persistidas ⇒ (true, false)', async () => {
    // 🔴 EL caso del corte. `persistedCount = 0` es un ÉXITO de la capa gratuita:
    // corrió entera y no había nada nuevo. Si esto publicara «falló», la pierna
    // Lusha repetiría la lectura y las llamadas a HubSpot para nada.
    const { deps, legCalls } = wiring({
      prePaid: prePaidOutcome({ freeSource: FREE_OK_ZERO_PERSISTED, persistedCount: 0 }),
      paidRows: 1,
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));

    assert.equal(legCalls.length, 1);
    assert.equal(legCalls[0].freeSourceAttempted, true);
    assert.equal(legCalls[0].freeSourceFailed, false);
  });

  it('CASO 2 — attempted, sin fallo y con persistidas > 0 ⇒ (true, false)', async () => {
    const { deps, legCalls } = wiring({
      prePaid: prePaidOutcome({ freeSource: FREE_OK_WITH_CANDIDATES, persistedCount: 2 }),
      paidRows: 1,
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));

    assert.equal(legCalls.length, 1);
    assert.equal(legCalls[0].freeSourceAttempted, true);
    assert.equal(legCalls[0].freeSourceFailed, false);
  });

  it('CASO 3 — source_unavailable ⇒ (true, true): la recuperación queda viva', async () => {
    const { deps, legCalls } = wiring({
      prePaid: prePaidOutcome({ freeSource: FREE_SOURCE_UNAVAILABLE, persistedCount: 0 }),
      paidRows: 1,
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));

    assert.equal(legCalls[0].freeSourceAttempted, true);
    assert.equal(legCalls[0].freeSourceFailed, true);
  });

  it('CASO 4 — country_without_source ⇒ (false, true): comportamiento de hoy', async () => {
    const { deps, legCalls } = wiring({
      prePaid: prePaidOutcome({ freeSource: FREE_COUNTRY_WITHOUT_SOURCE, persistedCount: 0 }),
      paidRows: 1,
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));

    assert.equal(legCalls[0].freeSourceAttempted, false);
    assert.equal(legCalls[0].freeSourceFailed, true);
  });

  it('CASO 5 — sin capa gratuita cableada ⇒ (false, true), nunca salta nada', async () => {
    // 🔴 `prePaidNovelty === null` también cubre el `.catch(() => null)` de la
    // capa: una capa que lanzó no puede autorizar a saltarse la de nadie.
    const { deps, legCalls } = wiring({ prePaid: null, paidRows: 1 });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));

    assert.equal(legCalls[0].freeSourceAttempted, false);
    assert.equal(legCalls[0].freeSourceFailed, true);
  });

  it('NEGATIVO R — el veredicto NO se deriva del conteo de filas', () => {
    // Los CASOS 1 y 2 comparten `(true, false)` con `persistedCount` 0 y 2. Una
    // implementación que mirase las filas no podría satisfacer los dos.
    const code = read(WIZARD_ACTION);
    const at = code.indexOf('freeSourceAttempted:');
    assert.ok(at > 0, 'el wizard debe publicar el veredicto');
    const window = code.slice(at, at + 220);
    assert.ok(
      window.includes('prePaidNovelty?.freeSource.attempted'),
      'sale de freeSource.attempted',
    );
    assert.ok(window.includes('prePaidNovelty?.freeSource.failed'), 'sale de freeSource.failed');
    assert.ok(
      !window.includes('persistedCount'),
      '🔴 `persistedCount` NO puede aparecer: 0 persistidas no es un fallo',
    );
  });
});

// ══ B · la pierna TRANSPORTA, no interpreta ══════════════════════════════════

function legInput(overrides: Partial<LushaWaterfallLegInput> = {}): LushaWaterfallLegInput {
  return {
    wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
    canonicalBatchId: CANONICAL_BATCH_ID,
    countryCode: 'CO',
    macroIndustryKey: 'technology',
    subIndustryId: null,
    target: TARGET,
    usefulAccumulated: 2,
    apolloTerminal: true,
    freeSourceAttempted: true,
    freeSourceFailed: false,
    ...overrides,
  };
}

describe('CORTE 5C § B — la pierna copia los dos booleanos al bloque waterfall', () => {
  for (const [label, attempted, failed] of [
    ['corrió bien', true, false],
    ['source_unavailable', true, true],
    ['ausencia estructural', false, true],
  ] as const) {
    it(`${label} ⇒ viaja tal cual (${attempted}, ${failed})`, async () => {
      const calls: Array<Record<string, unknown>> = [];
      const outcome = await runLushaWaterfallLeg(
        legInput({ freeSourceAttempted: attempted, freeSourceFailed: failed }),
        {
          waterfallEnabled: () => true,
          lushaAvailable: () => true,
          runLushaBatch: async (input) => {
            calls.push(input as unknown as Record<string, unknown>);
            return { status: 'success', batchId: CANONICAL_BATCH_ID } as never;
          },
        },
      );

      assert.equal(outcome.executed, true);
      assert.equal(calls.length, 1);
      const waterfall = calls[0].waterfall as Record<string, unknown>;
      assert.equal(waterfall.freeSourceAttempted, attempted);
      assert.equal(waterfall.freeSourceFailed, failed);
      // 🔴 Y el resto de la correlación de CUT-5A sigue intacta.
      assert.equal(waterfall.canonicalBatchId, CANONICAL_BATCH_ID);
      assert.equal(waterfall.targetGap, TARGET - 2);
    });
  }

  it('NEGATIVO S — la pierna no combina ni invierte el par', () => {
    const code = read(LEG_SERVER);
    assert.match(code, /freeSourceAttempted: input\.freeSourceAttempted,/);
    assert.match(code, /freeSourceFailed: input\.freeSourceFailed,/);
    assert.ok(
      !/freeSourceAttempted:\s*!/.test(code) && !/freeSourceFailed:\s*!/.test(code),
      'se copian, no se niegan',
    );
  });

  it('CASO 9 — con el objetivo ya cubierto no sale NI UNA llamada, ni free ni paid', async () => {
    const calls: unknown[] = [];
    const outcome = await runLushaWaterfallLeg(legInput({ usefulAccumulated: TARGET }), {
      waterfallEnabled: () => true,
      lushaAvailable: () => true,
      runLushaBatch: async (input) => {
        calls.push(input);
        throw new Error('no debería llamarse');
      },
    });
    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'target_reached');
  });
});

// ══ C · el núcleo: qué se salta y qué NO ═════════════════════════════════════

function company(index: number): CountrySourceCompany {
  return {
    recordIdentityKey: `free-${index}`,
    legalName: `SINTETICA ${index}`,
    normalizedLegalName: `sintetica ${index}`,
    taxId: `9500000${index}`,
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

type GateProbe = {
  deps: PrePaidNoveltyGateDeps;
  counts: {
    adapter: number;
    duplicateCheck: number;
    providerSeenLoad: number;
    knownDomains: number;
  };
};

function gateProbe(): GateProbe {
  const counts = { adapter: 0, duplicateCheck: 0, providerSeenLoad: 0, knownDomains: 0 };

  const adapter: CountrySourceAdapter = async () => {
    counts.adapter++;
    return {
      sourceKey: 'co_siis_discovery',
      companies: [company(0), company(1)],
      recordsRead: 2,
    };
  };

  const providerSeenStore: ProviderSeenStore = {
    load: async () => {
      counts.providerSeenLoad++;
      return [
        {
          provider: 'lusha',
          entityType: 'company',
          providerEntityId: 'lusha-1',
          normalizedDomain: 'vista.example',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
          firstSeenCorrelation: null,
          lastSeenCorrelation: null,
        },
      ];
    },
    record: async () => ({
      written: false,
      skippedReason: 'test',
      newIdsRecorded: 0,
      newDomainsRecorded: 0,
      refreshedCount: 0,
    }),
  };

  return {
    counts,
    deps: {
      countrySourceAdapter: adapter,
      checkCompanyDuplicate: async () => {
        counts.duplicateCheck++;
        return { status: 'new_candidate', matches: [] } as never;
      },
      listKnownExclusionDomains: async () => {
        counts.knownDomains++;
        return ['conocida.example'];
      },
      providerSeenStore,
    },
  };
}

const GATE_INPUT: PrePaidNoveltyGateInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  requestedTarget: 3,
  provider: 'lusha',
};

describe('CORTE 5C § C — con el skip, se salta el DESCUBRIMIENTO y sólo eso', () => {
  it('CASO 8 — 0 llamadas al adapter y 0 al detector de duplicados', async () => {
    const probe = gateProbe();
    await runPrePaidNoveltyGate({ ...GATE_INPUT, freeSourceAlreadyRun: true }, probe.deps);

    assert.equal(probe.counts.adapter, 0, '🔴 ni una lectura del snapshot');
    assert.equal(probe.counts.duplicateCheck, 0, '🔴 ni una llamada a HubSpot/accounts');
  });

  it('CASO 7 — la MITAD B sí corre: provider_seen, dominios conocidos y plan', async () => {
    const probe = gateProbe();
    const result = await runPrePaidNoveltyGate(
      { ...GATE_INPUT, freeSourceAlreadyRun: true },
      probe.deps,
    );

    assert.equal(probe.counts.providerSeenLoad, 1, 'la memoria del proveedor SÍ se carga');
    assert.equal(probe.counts.knownDomains, 1, 'los dominios conocidos SÍ se leen');
    assert.equal(result.providerSeen.loaded, true);
    // 🔴 Es lo que el ejecutor Lusha consume. Sin esta mitad, saltarse la capa
    // gratuita habría dejado la corrida pagada sin memoria y sin supresión.
    assert.ok(result.providerExclusionPlan.domains.available > 0, 'el plan llega poblado');
    assert.ok(
      result.providerSeenMemory.providerEntityIds.size > 0,
      'la memoria llega consultable',
    );
  });

  it('el motivo se declara, y el hueco queda ENTERO para la ruta de pago', async () => {
    const probe = gateProbe();
    const result = await runPrePaidNoveltyGate(
      { ...GATE_INPUT, freeSourceAlreadyRun: true },
      probe.deps,
    );

    assert.equal(result.context.freeSource.failureCode, 'free_source_already_run_in_run');
    assert.equal(result.context.freeSource.attempted, false);
    assert.equal(result.context.acceptedBeforeProvider, 0);
    assert.equal(result.context.residualGap, GATE_INPUT.requestedTarget);
    assert.equal(result.context.providerRequired, true);
    assert.equal(result.acceptedCompanies.length, 0);
  });

  it('CASO 6 — sin el flag, la cadena de capacidad es la de siempre', async () => {
    for (const input of [
      { ...GATE_INPUT },
      { ...GATE_INPUT, freeSourceAlreadyRun: false },
    ]) {
      const probe = gateProbe();
      const result = await runPrePaidNoveltyGate(input, probe.deps);
      assert.equal(probe.counts.adapter, 1, 'la fuente SÍ se lee');
      assert.ok(probe.counts.duplicateCheck > 0, 'el dedupe SÍ corre');
      assert.equal(result.context.freeSource.attempted, true);
      assert.equal(result.context.freeSource.failureCode, null);
    }
  });

  it('CASO 8b — con el skip el runner ni intenta persistir', async () => {
    const probe = gateProbe();
    let persistCalls = 0;
    const outcome = await runPrePaidNoveltyDiscovery(
      CLIENT,
      {
        provider: 'lusha',
        countryCode: 'CO',
        countryName: 'Colombia',
        macroIndustryKey: 'health_pharma',
        requestedTarget: 3,
        requestedByUserId: USER_ID,
        partialGapSupported: true,
        freeSourceAlreadyRun: true,
      },
      {
        // El núcleo REAL, con las lecturas falsas: la composición es la que se prueba.
        runGate: async (gateInput) => runPrePaidNoveltyGate(gateInput, probe.deps),
        persist: async () => {
          persistCalls++;
          return { batchId: CANONICAL_BATCH_ID, writtenCount: 0, skippedCount: 0, failed: false };
        },
      },
    );

    assert.equal(persistCalls, 0, '🔴 0 escrituras de fuente gratuita');
    assert.equal(probe.counts.adapter, 0);
    assert.equal(outcome.persistedCount, 0);
    assert.equal(outcome.batchId, null);
    assert.equal(outcome.residualGap, 3, 'el hueco entero viaja a la ruta de pago');
    assert.equal(outcome.providerRequired, true);
  });
});

// ══ D · la acción Lusha: la condición y el standalone ════════════════════════

describe('CORTE 5C § D — la condición vive en UN sitio y standalone no la ve', () => {
  it('la conjunción es EXACTAMENTE la acordada', () => {
    const code = read(LUSHA_ACTION);
    assert.match(
      code,
      /const freeSourceAlreadyRun =\s*\n?\s*waterfall !== null && waterfall\.freeSourceAttempted && !waterfall\.freeSourceFailed;/,
    );
  });

  it('NEGATIVO T — la derivación no toca `persistedCount`', () => {
    const code = read(LUSHA_ACTION);
    const at = code.indexOf('const freeSourceAlreadyRun =');
    assert.ok(at > 0);
    assert.ok(
      !code.slice(at, at + 200).includes('persistedCount'),
      '🔴 0 persistidas NO es fallo: el conteo no puede entrar en la condición',
    );
  });

  it('el valor llega al runner previo al pago', () => {
    const code = read(LUSHA_ACTION);
    const runnerAt = code.indexOf('runPrePaidNoveltyDiscovery(await createClient()');
    assert.ok(runnerAt > 0);
    assert.ok(code.slice(runnerAt, runnerAt + 900).includes('freeSourceAlreadyRun,'));
  });

  it('STANDALONE — sin bloque `waterfall` la condición es false por construcción', () => {
    const code = read(LUSHA_ACTION);
    const at = code.indexOf('const freeSourceAlreadyRun =');
    // La conjunción EMPIEZA por la guarda de standalone: sin bloque, ni siquiera
    // se leen los booleanos. Es lo que hace que el clic de siempre no cambie.
    assert.match(code.slice(at, at + 120), /waterfall !== null &&/);
  });

  it('el bloque `waterfall` EXIGE los dos booleanos', () => {
    const code = read(LUSHA_ACTION);
    assert.match(code, /freeSourceAttempted: z\.boolean\(\),/);
    assert.match(code, /freeSourceFailed: z\.boolean\(\),/);
    // Sin `.optional()`: un bloque a medias es un cableado roto, no un defecto.
    assert.ok(
      !/freeSourceAttempted: z\.boolean\(\)\.optional\(\)/.test(code),
      'requerido dentro del bloque',
    );
  });

  it('RATCHET — el bloque entero sigue siendo OPCIONAL (CUT-5A)', () => {
    const code = read(LUSHA_ACTION);
    // 🔴 Se reafirma aquí a propósito: los campos nuevos son PLANOS justamente
    // para que este regex —el ratchet vivo de CUT-5A— siga describiendo la forma
    // real. Un sub-objeto lo habría roto sin que el comportamiento cambiara.
    assert.match(code, /waterfall: z\s*\n?\s*\.object\(\{[\s\S]*?\}\)\s*\n?\s*\.optional\(\),/);
  });
});
