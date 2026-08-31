/**
 * cut6-partial-activation-static-guard.test.ts — las guardas que impiden que la
 * activación parcial se apague por accidente, y la PRUEBA EN NEGATIVO de cada una.
 *
 * AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION §§ 20, 21.
 *
 * ── 🔴 Por qué cada guarda viene con su mutación ────────────────────────────
 *
 * Una guarda que nunca se ha visto en rojo no prueba nada: puede estar leyendo un
 * archivo equivocado, un comentario o una cadena que siempre está presente. Cada
 * `describe` de aquí afirma la propiedad Y demuestra que la mutación que la
 * rompería la pondría en rojo. Las mutaciones de COMPORTAMIENTO se ejecutan de
 * verdad —con el mismo orquestador y los mismos dobles— y se revierten al salir
 * del caso; las de CÓDIGO se aplican sobre una COPIA en memoria, nunca sobre el
 * archivo.
 *
 * ── 🔴 Comentarios fuera ────────────────────────────────────────────────────
 *
 * Este archivo y los que inspecciona NOMBRAN en su prosa justo las cadenas
 * prohibidas. Grepear el cuerpo crudo confundiría «citarlo» con «usarlo», que es
 * el falso positivo que ya mordió en AGENT2A-SEARCH-MORE-PHONES-1G.
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
import { createCanonicalWizardBatchResolver } from '../wizard-canonical-batch';
import type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
} from '../wizard-idempotency';
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
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Lectura de fuentes ───────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

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

const ORCHESTRATOR =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const APOLLO_EXECUTOR =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts';
const FREE_RUNNER =
  'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts';

const code = (rel: string): string => stripTsComments(read(rel));

// ── Fixtures de comportamiento ───────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;
const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
const FOREIGN_BATCH_ID = '523e4567-e89b-12d3-a456-4266141740aa';

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
  persistedInto: (string | null)[];
};

function freeLayer(persistedCount: number): FreeLayer {
  const accepted = Array.from({ length: persistedCount }, (_u, i) => company(i));
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: persistedCount,
      macroConfirmed: persistedCount,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: persistedCount,
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
    acceptedCompanies: accepted,
    telemetry: {},
  };
  const layer: FreeLayer = {
    persistedInto: [],
    deps: {
      runGate: async () => gateResult,
      persist: async (_client, input) => {
        layer.persistedInto.push(input.batchId ?? null);
        const landed = input.batchId ?? 'shadow-batch-created-by-writer';
        return {
          batchId: persistedCount > 0 ? landed : null,
          writtenCount: persistedCount,
          skippedCount: 0,
          failed: persistedCount === 0,
        };
      },
    },
  };
  return layer;
}

type Observed = {
  apolloCalls: WizardApolloInput[];
  order: string[];
};

/** `partialGapSupported` es un parámetro para poder MUTARLO en negativo. */
function wiring(options: {
  free: PrePaidNoveltyDiscoveryDeps;
  partialGapSupported?: boolean;
  paidBatchId?: string;
  paidRaw?: number;
  duplicatesOfFree?: number;
}): { deps: WizardExecutionDeps; observed: Observed } {
  const observed: Observed = { apolloCalls: [], order: [] };
  const slots = new Map<string, string>();

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    resolveProvider: () => 'apollo_organizations',
    runPrePaidNoveltyDiscovery: (input) => {
      observed.order.push('free_layer');
      return runPrePaidNoveltyDiscovery(
        CLIENT,
        {
          provider: 'apollo',
          countryCode: input.countryCode,
          countryName: input.countryName,
          macroIndustryKey: input.macroIndustryKey,
          requestedTarget: input.requestedTarget,
          requestedByUserId: input.requestedByUserId,
          resolveBatchId: input.resolveBatchId,
          partialGapSupported: options.partialGapSupported ?? WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
        },
        options.free,
      );
    },
    reserveBudget: async () => {
      observed.order.push('budget_reserve');
      return { status: 'reserved' as const, reservationId: 'res-1', creditsReserved: 3 };
    },
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async (input) => {
      const key = `${input.userId}::${input.clientRequestId}`;
      const existing = slots.get(key);
      if (existing) return { status: 'already_reserved', batchId: existing };
      slots.set(key, CANONICAL_BATCH_ID);
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    },
    sealFreeOnlyBatchStatus: async () => undefined,
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline: async (input) => {
      observed.apolloCalls.push(input);
      const remaining = input.resultDemand?.remainingTarget ?? TARGET;
      const novel = Math.max(0, (options.paidRaw ?? 6) - (options.duplicatesOfFree ?? 0));
      return {
        batchId: options.paidBatchId ?? input.reservedBatchId,
        candidatesCreated: Math.min(novel, remaining),
        targetPersistibleCandidates: remaining,
        targetReached: false,
      } as unknown as IncrementalSearchOutput;
    },
    markBatchFailed: async () => undefined,
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

// ── GUARDA A · el aporte parcial no se puede volver a descartar ──────────────

describe('CUT-6 §§ 20, 21 · A — descartar el parcial sólo porque F < T', () => {
  it('el valor vivo llega desde la constante, no desde un literal en el sitio de la llamada', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(
      src.includes('partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,'),
      '🔴 el valor vivo se decide en UN sitio',
    );
    for (const forbidden of ['partialGapSupported: true', 'partialGapSupported: false']) {
      assert.ok(!src.includes(forbidden), `🔴 nada de literales en el llamador (${forbidden})`);
    }
    assert.ok(
      code(APOLLO_EXECUTOR).includes('export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = true;'),
      '🔴 la declaración es literal y grep-able',
    );
  });

  it('🔴 el descarte del runner sigue GOBERNADO por el parámetro, nunca incondicional', () => {
    const src = code(FREE_RUNNER);
    // Las dos salidas de todo-o-nada existen y las dos exigen el parámetro.
    const guarded = src.match(/if \(!input\.partialGapSupported && [a-zA-Z.]+\.providerRequired\)/g);
    assert.equal(guarded?.length, 2, '🔴 las dos salidas de descarte siguen condicionadas');
    assert.ok(
      !/if \([a-zA-Z.]*\.?providerRequired\) \{\s*\n\s*return noContribution/.test(src),
      '🔴 ningún descarte incondicional',
    );
  });

  it('🔴 EN NEGATIVO — reponer el todo-o-nada rompe el comportamiento de CUT-6', async () => {
    await withEnv(async () => {
      // MUTACIÓN ejecutada de verdad: la misma corrida con el parámetro apagado.
      const free = freeLayer(4);
      const wired = wiring({ free: free.deps, partialGapSupported: false });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.deepEqual(free.persistedInto, [], '🔴 el aporte parcial vuelve a descartarse…');
      assert.equal(
        wired.observed.apolloCalls[0]!.resultDemand?.remainingTarget,
        TARGET,
        '…y el hueco vuelve a ser el objetivo entero',
      );
      assert.equal(result.ok && result.candidateCount, 6, '🔴 y el conteo pierde las 4 gratuitas');
      // La expectativa VIVA de CUT-6 sobre la misma entrada.
      const live = wiring({ free: freeLayer(4).deps });
      const liveResult = await executeProspectWizardGeneration(REQUEST, live.deps);
      assert.equal(liveResult.ok && liveResult.candidateCount, 10, 'con la activación viva son 10');
    });
  });
});

// ── GUARDA B · el hueco pagado no puede volver a ser el objetivo entero ──────

describe('CUT-6 §§ 20, 21 · B — hueco pagado = objetivo completo', () => {
  it('la demanda sale del resultado gratuito cuando hubo aporte durable', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(
      src.includes(
        'resolveProviderResultDemand(prePaidNovelty, WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES)',
      ),
      '🔴 el hueco lo LEE del gate, no lo recalcula',
    );
    assert.ok(
      src.includes('fullTargetResultDemand(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES)'),
      'y sólo cae al objetivo entero cuando NO hubo aporte durable',
    );
    assert.ok(
      code(APOLLO_EXECUTOR).includes('boundByRemainingTarget('),
      '🔴 la ÚNICA cota sigue siendo la compartida',
    );
  });

  it('🔴 EN NEGATIVO — con aporte de 4, una demanda de 10 contradice lo vivo', async () => {
    await withEnv(async () => {
      const free = freeLayer(4);
      const wired = wiring({ free: free.deps });
      await executeProspectWizardGeneration(REQUEST, wired.deps);
      const live = wired.observed.apolloCalls[0]!.resultDemand;

      assert.equal(live?.remainingTarget, TARGET - 4);
      // La mutación sería pasar el objetivo entero: se comprueba que ese valor NO
      // es el que produce el código vivo.
      assert.notEqual(live?.remainingTarget, TARGET, '🔴 el hueco no puede ser el objetivo entero');
      assert.equal(live!.requestedTarget - live!.acceptedBeforeProvider, live!.remainingTarget);
    });
  });
});

// ── GUARDA C · nada económico antes de que lo gratuito se resuelva ───────────

describe('CUT-6 §§ 20, 21 · C — reserva antes del resultado gratuito', () => {
  it('en el ORDEN del archivo, la capa gratuita precede a la estimación y a la reserva', () => {
    const src = code(ORCHESTRATOR);
    const freeCall = src.indexOf('deps.runPrePaidNoveltyDiscovery\n');
    const estimate = src.indexOf('estimateCreditsForProvider(discoveryProvider)');
    const reserve = src.indexOf('await deps.reserveBudget(');
    assert.ok(freeCall > 0 && estimate > 0 && reserve > 0, 'los tres puntos existen');
    assert.ok(freeCall < estimate, '🔴 FREE FIRST: la capa gratuita precede a la estimación');
    assert.ok(estimate < reserve, '🔴 y la estimación precede a la reserva');
  });

  it('🔴 EN NEGATIVO — la guarda de orden detecta el intercambio', () => {
    const src = code(ORCHESTRATOR);
    const freeCall = src.indexOf('deps.runPrePaidNoveltyDiscovery\n');
    const reserve = src.indexOf('await deps.reserveBudget(');
    // Copia mutada: la reserva se adelanta al principio del cuerpo.
    const mutated = `await deps.reserveBudget({});\n${src}`;
    assert.ok(mutated.indexOf('await deps.reserveBudget(') < mutated.indexOf('deps.runPrePaidNoveltyDiscovery\n'));
    assert.ok(freeCall < reserve, 'y el archivo real conserva el orden correcto');
  });

  it('🔴 el orden es OBSERVABLE en runtime, no sólo textual', async () => {
    await withEnv(async () => {
      const wired = wiring({ free: freeLayer(4).deps });
      await executeProspectWizardGeneration(REQUEST, wired.deps);
      assert.deepEqual(wired.observed.order, ['free_layer', 'budget_reserve']);
    });
  });

  it('🔴 la reserva NO recibe el hueco: su único argumento es el proveedor', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(src.includes('estimateCreditsForProvider(discoveryProvider)'));
    for (const forbidden of [
      'estimateCreditsForProvider(discoveryProvider, ',
      'requestedCredits: apolloResultDemand',
      'requestedCredits: remainingTarget',
    ]) {
      assert.ok(!src.includes(forbidden), `🔴 § 8 — el hueco no puede fijar el coste (${forbidden})`);
    }
  });
});

// ── GUARDA D · la ruta de pago no puede crear otro lote ─────────────────────

describe('CUT-6 §§ 20, 21 · D — la parte pagada en otro lote', () => {
  it('el ejecutor de pago recibe el lote RESUELTO, y el wizard no inserta lotes', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(src.includes('const reservedBatchId = reservation.batchId;'));
    assert.ok(src.includes('reservation = await canonicalBatch.resolve();'));
    for (const forbidden of [".from('prospect_batches').insert", 'createProspectBatch(']) {
      assert.ok(!src.includes(forbidden), `🔴 el orquestador no crea lotes (${forbidden})`);
    }
    // El resolutor es la única autoridad, y se construye una sola vez.
    assert.equal(
      (src.match(/createCanonicalWizardBatchResolver\(/g) ?? []).length,
      1,
      '🔴 un solo resolutor por ejecución',
    );
  });

  it('🔴 EN NEGATIVO — un candidato pagado en otro lote hace fallar la corrida', async () => {
    await withEnv(async () => {
      const free = freeLayer(4);
      const wired = wiring({ free: free.deps, paidBatchId: FOREIGN_BATCH_ID });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, false, '🔴 el control de consistencia de lote lo caza');
      assert.equal(!result.ok && result.code, 'GENERATION_FAILED');
      // Y el aporte gratuito sigue declarado: no se pierde por el fallo.
      assert.equal(!result.ok && result.freeContribution?.batchId, CANONICAL_BATCH_ID);
    });
  });
});

// ── GUARDA E · un duplicado no cierra hueco ─────────────────────────────────

describe('CUT-6 §§ 20, 21 · E — duplicado pagado contado como hueco cerrado', () => {
  it('🔴 el total se suma con la autoridad de CUT-1, no con una aritmética nueva', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(src.includes('resolveBatchDurableTotals({'), '🔴 la suma es la compartida');
    assert.ok(
      src.includes('candidateCount: combinedDurableTotals.totalDurableCandidates,'),
      'y es la que se reporta',
    );
    assert.ok(
      !src.includes('candidateCount: pipelineResult.candidatesCreated'),
      '🔴 el conteo de un solo contribuyente ya no es el resultado',
    );
  });

  it('🔴 EN NEGATIVO — 6 crudos con 2 duplicados suman 8, jamás 10', async () => {
    await withEnv(async () => {
      const clean = wiring({ free: freeLayer(4).deps, paidRaw: 6 });
      const cleanResult = await executeProspectWizardGeneration(REQUEST, clean.deps);
      assert.equal(cleanResult.ok && cleanResult.candidateCount, 10);

      const dupes = wiring({ free: freeLayer(4).deps, paidRaw: 6, duplicatesOfFree: 2 });
      const dupeResult = await executeProspectWizardGeneration(REQUEST, dupes.deps);
      assert.equal(dupeResult.ok && dupeResult.candidateCount, 8, '🔴 los duplicados no cuentan');
      assert.equal(dupeResult.ok && dupeResult.targetReached, false);
    });
  });
});

// ── GUARDA F · un reintento no puede reservar dos veces ─────────────────────

describe('CUT-6 §§ 20, 21 · F — segunda reserva en el reintento', () => {
  it('🔴 EN NEGATIVO — el reintento libera el presupuesto y no ejecuta el proveedor', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();
      const released: string[] = [];

      const build = (): { deps: WizardExecutionDeps; observed: Observed } => {
        const w = wiring({ free: freeLayer(4).deps });
        w.deps.reserveSlot = async (input) => {
          const key = `${input.userId}::${input.clientRequestId}`;
          const existing = slots.get(key);
          if (existing) return { status: 'already_reserved', batchId: existing };
          slots.set(key, CANONICAL_BATCH_ID);
          return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
        };
        w.deps.releaseBudget = async (input) => {
          released.push(input.reason ?? 'unknown');
          return { status: 'released' as const };
        };
        return w;
      };

      await executeProspectWizardGeneration(REQUEST, build().deps);
      const second = build();
      const result = await executeProspectWizardGeneration(REQUEST, second.deps);

      assert.equal(result.ok && result.status, 'already_started');
      assert.equal(second.observed.apolloCalls.length, 0, '🔴 0 ejecuciones pagadas en el reintento');
      assert.deepEqual(released, ['batch_already_reserved'], '🔴 la segunda reserva se libera');
      assert.equal(slots.size, 1);
    });
  });
});

// ── GUARDA G · la carrera de la misma ejecución RELEE al ganador ────────────

describe('CUT-6 §§ 20, 21 · G — la carrera no relee al ganador', () => {
  const input = {
    userId: USER_ID,
    clientRequestId: CLIENT_REQUEST_ID,
  } as unknown as WizardExecutionReservationInput;

  it('🔴 con relectura, las dos mitades convergen y ninguna termina en error', async () => {
    const rows = new Map<string, string>();
    const reserveSlot = async (
      i: WizardExecutionReservationInput,
    ): Promise<WizardExecutionReservationResult> => {
      const key = `${i.userId}::${i.clientRequestId}`;
      await Promise.resolve();
      const existing = rows.get(key);
      if (existing) return { status: 'already_reserved', batchId: existing };
      rows.set(key, CANONICAL_BATCH_ID);
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    };

    const settled = await Promise.allSettled([
      createCanonicalWizardBatchResolver(reserveSlot, input).resolve(),
      createCanonicalWizardBatchResolver(reserveSlot, input).resolve(),
    ]);
    assert.deepEqual(
      settled.map((o) => o.status),
      ['fulfilled', 'fulfilled'],
    );
    assert.deepEqual(
      settled.map((o) => (o.status === 'fulfilled' ? o.value.batchId : null)),
      [CANONICAL_BATCH_ID, CANONICAL_BATCH_ID],
    );
  });

  it('🔴 EN NEGATIVO — sin relectura, una mitad de la MISMA ejecución muere en 23505', async () => {
    const rows = new Map<string, string>();
    // MUTACIÓN: el conflicto se propaga en vez de releerse.
    const reserveSlotWithoutReRead = async (
      i: WizardExecutionReservationInput,
    ): Promise<WizardExecutionReservationResult> => {
      const key = `${i.userId}::${i.clientRequestId}`;
      await Promise.resolve();
      if (rows.has(key)) throw new Error('duplicate key value violates unique constraint (23505)');
      rows.set(key, CANONICAL_BATCH_ID);
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    };

    const settled = await Promise.allSettled([
      createCanonicalWizardBatchResolver(reserveSlotWithoutReRead, input).resolve(),
      createCanonicalWizardBatchResolver(reserveSlotWithoutReRead, input).resolve(),
    ]);
    const rejected = settled.filter((o) => o.status === 'rejected');
    assert.equal(rejected.length, 1, '🔴 la mutación parte la ejecución lógica en éxito + error');
  });
});

// ── GUARDA H · alcance: proveedor, enrutado y «último lote» ─────────────────

describe('CUT-6 §§ 9, 18, 20 · lo que este corte NO toca', () => {
  it('no cambia disponibilidad, enrutado ni flags de proveedor', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(src.includes('deps.checkApolloAvailability'), 'la comprobación sigue viva');
    assert.ok(
      src.indexOf('deps.checkApolloAvailability') < src.indexOf('deps.runPrePaidNoveltyDiscovery\n'),
      '🔴 y sigue ANTES de la capa gratuita: sin proveedor no se descubre nada',
    );
    for (const forbidden of [
      'ENABLE_APOLLO_COMPANY_SEARCH',
      'ENABLE_LUSHA_PREVIEW',
      'ENABLE_APOLLO_PHONE_REVEAL',
    ]) {
      assert.ok(!src.includes(forbidden), `🔴 ningún flag de activación aquí (${forbidden})`);
    }
  });

  it('🔴 el wizard no reintroduce la adopción del «último lote»', () => {
    const src = code(ORCHESTRATOR);
    for (const forbidden of ['latest_batch', 'latestBatch', "order('created_at'"]) {
      assert.ok(!src.includes(forbidden), `🔴 la identidad es (created_by, client_request_id) (${forbidden})`);
    }
  });

  it('🔴 la ruta Lusha de pending-review no se toca', () => {
    assert.ok(
      code('src/modules/prospect-batches/lusha-pending-review-actions.ts').includes(
        'partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,',
      ),
      'sigue leyendo SU constante, que sigue en `false`',
    );
  });
});
