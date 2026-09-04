/**
 * cut5-single-batch-plumbing.test.ts — UNA ejecución del wizard, UN lote canónico.
 *
 * AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING §§ 1, 4, 5, 8, 12, 13, 14, 18.
 *
 * ── El defecto que congela ───────────────────────────────────────────────────
 *
 * La capa gratuita (paso 5d) persistía ANTES de que existiera el slot del wizard
 * (paso 9), así que creaba lote propio. Una sola búsqueda podía terminar en DOS
 * lotes: lo gratuito en uno, lo de pago en otro, y la redirección apuntando sólo
 * al segundo.
 *
 * ── 🔴 Por qué el doble de persistencia HONRA `batchId` ──────────────────────
 *
 * Es la diferencia entre probar el cableado y decorarlo. El doble de
 * `wizard-apollo-partial-gap-activation-deferred` devuelve un id FIJO pase lo que
 * pase, que es correcto para lo que ese archivo mide (cuántas veces se escribe),
 * pero aquí sería teatro: pasaría igual con el hilo cortado. El doble de este
 * archivo devuelve el id que RECIBE, así que si el orquestador deja de pasarlo,
 * el lote gratuito vuelve a ser distinto del de pago y estas pruebas se ponen
 * rojas por el motivo real.
 *
 * ── Lo que este archivo NO afirma ────────────────────────────────────────────
 *
 * No enciende el hueco parcial. `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` sigue en
 * `false` y su ratchet sigue vivo en su propio archivo: CUT-5 es FONTANERÍA. Lo
 * que cambia es que el motivo de PRODUCTO para diferirlo —«una búsqueda acabaría
 * en dos lotes»— deja de existir; la activación se decide en CUT-6.
 *
 * Sin Supabase, sin Apollo, sin Tavily, sin red, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import { createCanonicalWizardBatchResolver } from '../wizard-canonical-batch';
import type { WizardExecutionReservationInput } from '../wizard-idempotency';
import {
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const OTHER_CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-4266141740ff';

/** El lote que la reserva canónica entrega para ESTA ejecución. */
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
/** El lote de una ejecución DISTINTA. Nunca debe cruzarse con el de arriba. */
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
  /** Los `batchId` con los que la capa gratuita llamó al writer, en orden. */
  persistedInto: (string | null)[];
};

/**
 * Dobles SÓLO de los bordes de I/O de la capa gratuita.
 *
 * 🔴 `persist` devuelve el `batchId` que RECIBE — ver la cabecera. Con `null`
 * (sin lote canónico) reproduce al writer creando el suyo.
 */
function freeLayer(input: { acceptedNovel: number; persistedCount: number }): FreeLayer {
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
      persist: async (_client, persistInput) => {
        layer.persistedInto.push(persistInput.batchId ?? null);
        // Sin lote canónico el writer crearía uno propio: se modela con un id
        // distinto, que es exactamente el defecto que este corte cierra.
        const landed = persistInput.batchId ?? 'shadow-batch-created-by-writer';
        return {
          batchId: input.persistedCount > 0 ? landed : null,
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
  tavilyBatchIds: string[];
  reserveSlotCalls: WizardExecutionReservationInput[];
  sealed: { batchId: string; status: string }[];
};

function pipelineOutput(batchId: string): IncrementalSearchOutput {
  return {
    batchId,
    candidatesCreated: 1,
    targetReached: false,
  } as unknown as IncrementalSearchOutput;
}

type WiringOptions = {
  free?: PrePaidNoveltyDiscoveryDeps;
  partialGapSupported?: boolean;
  provider?: 'apollo_organizations' | 'tavily';
  /**
   * Reserva compartida entre ejecuciones — modela el índice único
   * `(created_by, client_request_id)` de la base (§ 12/§ 14).
   */
  slots?: Map<string, string>;
  budgetBlocked?: boolean;
};

/**
 * 🔴 La reserva se modela con un Map indexado por `(userId, clientRequestId)`,
 * que es la MISMA identidad durable que el índice único de la base. Así un
 * reintento de la misma ejecución recupera su lote (`already_reserved`) y dos
 * ejecuciones distintas no pueden adoptarse la una a la otra.
 */
function wiring(options: WiringOptions = {}): {
  deps: WizardExecutionDeps;
  observed: Observed;
  slots: Map<string, string>;
} {
  const observed: Observed = {
    apolloCalls: [],
    tavilyBatchIds: [],
    reserveSlotCalls: [],
    sealed: [],
  };
  const slots = options.slots ?? new Map<string, string>();
  const provider = options.provider ?? 'apollo_organizations';

  const free = options.free;
  // Tipado explícito en vez de un `as unknown as WizardExecutionDeps` al final:
  // el cast borraba el tipado contextual del literal entero y dejaba pasar
  // parámetros implícitamente `any` — justo lo que el typecheck tiene que ver.
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
            partialGapSupported: options.partialGapSupported ?? false,
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
    resolveProvider: () => provider,
    runPrePaidNoveltyDiscovery: runFree,
    reserveBudget: async () =>
      options.budgetBlocked
        ? {
            status: 'blocked' as const,
            code: 'BUDGET_EXCEEDED' as const,
            message: 'Presupuesto agotado para el período.',
          }
        : { status: 'reserved' as const, reservationId: 'res-1', creditsReserved: 3 },
    // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — Apollo ya no pasa por
    // `reserveBudget`; `options.budgetBlocked` sigue bloqueando la ruta Apollo,
    // ahora vía su propia cuota.
    checkApolloProviderQuota: async () =>
      options.budgetBlocked
        ? { status: 'blocked' as const, providerCreditsAvailable: 0 }
        : { status: 'available' as const, providerCreditsAvailable: 999 },
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
    runTavilyPipeline: async ({ reservedBatchId }) => {
      observed.tavilyBatchIds.push(reservedBatchId);
      return pipelineOutput(reservedBatchId);
    },
    runApolloPipeline: async (input) => {
      observed.apolloCalls.push(input);
      return pipelineOutput(input.reservedBatchId);
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
    if (saved.execution === undefined) delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    else process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved.execution;
    if (saved.apollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved.apollo;
  }
}

/** Todos los lotes que una corrida dejó tocados, sin repetir. */
function distinctBatches(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

// ── CASOS 1, 2, 9 · una ejecución, un lote ───────────────────────────────────

describe('CUT-5 §§ 1, 4 · una ejecución del wizard = un lote canónico', () => {
  it('CASO 1 — una ejecución + un proveedor ⇒ exactamente 1 lote', async () => {
    await withEnv(async () => {
      const wired = wiring();
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.batchId, CANONICAL_BATCH_ID);
      assert.equal(
        distinctBatches([
          result.ok ? result.batchId : null,
          ...wired.observed.apolloCalls.map((c) => c.reservedBatchId),
        ]).length,
        1,
        '🔴 un solo lote en toda la ejecución',
      );
    });
  });

  it('CASO 2 — capa gratuita + rama de pago en la MISMA ejecución ⇒ 1 lote', async () => {
    await withEnv(async () => {
      // Hueco parcial invocado a propósito (capacidad, no activación): es la única
      // forma de que las DOS ramas escriban en la misma corrida.
      const free = freeLayer({ acceptedNovel: 7, persistedCount: 7 });
      const wired = wiring({ free: free.deps, partialGapSupported: true });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      const touched = distinctBatches([
        ...free.persistedInto,
        ...wired.observed.apolloCalls.map((c) => c.reservedBatchId),
        result.ok ? result.batchId : null,
      ]);
      assert.deepEqual(touched, [CANONICAL_BATCH_ID], '🔴 un único lote entre las dos ramas');
    });
  });

  it('CASO 3 — lo gratuito y lo de pago aterrizan en el MISMO batch_id', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 6, persistedCount: 6 });
      const wired = wiring({ free: free.deps, partialGapSupported: true });
      await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.persistedInto.length, 1, 'la capa gratuita escribió una vez');
      assert.equal(
        free.persistedInto[0],
        CANONICAL_BATCH_ID,
        '🔴 recibió el lote canónico, no `null`',
      );
      assert.equal(wired.observed.apolloCalls[0]!.reservedBatchId, CANONICAL_BATCH_ID);
    });
  });

  it('CASO 4 — la capa gratuita aporta 0 ⇒ el proveedor usa el canónico, sin lote sombra', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 0, persistedCount: 0 });
      const wired = wiring({ free: free.deps, partialGapSupported: true });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(free.persistedInto.length, 0, 'sin empresas no se escribe nada');
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.batchId, CANONICAL_BATCH_ID);
      assert.equal(wired.observed.apolloCalls[0]!.reservedBatchId, CANONICAL_BATCH_ID);
    });
  });

  it('CASO 5 — la rama country-source cierra el objetivo ⇒ ese lote ES el canónico', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });
      const wired = wiring({ free: free.deps });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.status, 'success_target_reached');
      assert.equal(
        result.ok && result.batchId,
        CANONICAL_BATCH_ID,
        '🔴 antes de CUT-5 esto era un lote propio del writer',
      );
      assert.equal(free.persistedInto[0], CANONICAL_BATCH_ID);
      assert.equal(wired.observed.apolloCalls.length, 0, 'el proveedor no corre');
    });
  });

  it('CASO 5b — § 11: el lote que la capa gratuita cerró sola queda SELLADO, no en `draft`', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET });
      const wired = wiring({ free: free.deps });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.deepEqual(
        wired.observed.sealed,
        [{ batchId: CANONICAL_BATCH_ID, status: 'ready_for_review' }],
        '🔴 el slot nace en `draft` y ningún escritor de proveedor lo va a sellar',
      );
      assert.equal(
        result.ok && result.batchStatus,
        'ready_for_review',
        'la respuesta y la fila dicen lo mismo',
      );
    });
  });

  it('CASO 8 — proveedor Tavily: el mismo hilo, sin regla nueva de enrutado', async () => {
    await withEnv(async () => {
      const free = freeLayer({ acceptedNovel: 4, persistedCount: 4 });
      const wired = wiring({
        free: free.deps,
        partialGapSupported: true,
        provider: 'tavily',
      });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, true);
      assert.deepEqual(
        distinctBatches([...free.persistedInto, ...wired.observed.tavilyBatchIds]),
        [CANONICAL_BATCH_ID],
        '🔴 el corte es agnóstico del proveedor (§ 8)',
      );
    });
  });
});

// ── CASOS 6, 7, 14 · identidad de ejecución ──────────────────────────────────

describe('CUT-5 §§ 12, 14 · reintentos y concurrencia', () => {
  it('CASO 6 — reintentar la MISMA ejecución no crea un segundo lote', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();

      const first = wiring({ free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }).deps, slots });
      const a = await executeProspectWizardGeneration(REQUEST, first.deps);

      const second = wiring({ free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }).deps, slots });
      const b = await executeProspectWizardGeneration(REQUEST, second.deps);

      assert.equal(a.ok && a.batchId, CANONICAL_BATCH_ID);
      assert.equal(b.ok && b.batchId, CANONICAL_BATCH_ID);
      assert.equal(slots.size, 1, '🔴 una sola reserva durable para las dos pasadas');
    });
  });

  it('CASO 7 — dos ejecuciones DISTINTAS ⇒ lotes distintos', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();

      const x = wiring({ slots });
      const rx = await executeProspectWizardGeneration(REQUEST, x.deps);

      const y = wiring({ slots });
      const ry = await executeProspectWizardGeneration(
        { ...REQUEST, clientRequestId: OTHER_CLIENT_REQUEST_ID },
        y.deps,
      );

      assert.equal(rx.ok && rx.batchId, CANONICAL_BATCH_ID);
      assert.equal(ry.ok && ry.batchId, OTHER_CANONICAL_BATCH_ID);
      assert.notEqual(rx.ok && rx.batchId, ry.ok && ry.batchId);
      assert.equal(slots.size, 2);
    });
  });

  it('CASO 8b — mismo usuario, país y proveedor, a la vez ⇒ 0 adopción cruzada', async () => {
    await withEnv(async () => {
      const slots = new Map<string, string>();
      const x = wiring({ slots });
      const y = wiring({ slots });

      // Concurrentes de verdad: se lanzan sin esperar la una a la otra.
      const [rx, ry] = await Promise.all([
        executeProspectWizardGeneration(REQUEST, x.deps),
        executeProspectWizardGeneration(
          { ...REQUEST, clientRequestId: OTHER_CLIENT_REQUEST_ID },
          y.deps,
        ),
      ]);

      assert.equal(rx.ok && rx.batchId, CANONICAL_BATCH_ID);
      assert.equal(ry.ok && ry.batchId, OTHER_CANONICAL_BATCH_ID);
      assert.equal(
        x.observed.apolloCalls[0]!.reservedBatchId,
        CANONICAL_BATCH_ID,
        '🔴 ninguna heurística temporal puede cruzarlas',
      );
      assert.equal(y.observed.apolloCalls[0]!.reservedBatchId, OTHER_CANONICAL_BATCH_ID);
    });
  });
});

// ── § 5 · el resolutor perezoso, aislado ─────────────────────────────────────

describe('CUT-5 §§ 4, 5, 14 · el resolutor canónico', () => {
  const payload = (clientRequestId: string): WizardExecutionReservationInput => ({
    userId: USER_ID,
    clientRequestId,
    initialBatchPayload: {
      requestSource: 'chat_wizard',
      catalogVersionId: 'v2024-01',
      industryId: INDUSTRY_ID,
      subindustryIds: [SUBINDUSTRY_ID],
      countryCode: 'CO',
      additionalCriteria: null,
      targetCount: TARGET,
      country: 'Colombia',
      industry: 'Salud / Farma',
      searchDepth: 'standard',
    },
  });

  it('resuelve UNA vez aunque lo llamen muchas ramas', async () => {
    let calls = 0;
    const resolver = createCanonicalWizardBatchResolver(async () => {
      calls++;
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    }, payload(CLIENT_REQUEST_ID));

    const a = await resolver.resolve();
    const b = await resolver.resolve();
    const c = await resolver.resolve();

    assert.equal(calls, 1, '🔴 una sola reserva efectiva');
    assert.equal(a.batchId, CANONICAL_BATCH_ID);
    assert.equal(b.batchId, CANONICAL_BATCH_ID);
    assert.equal(c.batchId, CANONICAL_BATCH_ID);
  });

  it('🔴 dos ramas que resuelven A LA VEZ comparten la promesa en vuelo', async () => {
    let calls = 0;
    const resolver = createCanonicalWizardBatchResolver(async () => {
      calls++;
      // Cede el turno: sin promesa compartida, la segunda rama entraría aquí.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    }, payload(CLIENT_REQUEST_ID));

    const [a, b] = await Promise.all([resolver.resolve(), resolver.resolve()]);

    assert.equal(calls, 1, '🔴 una reserva, no dos');
    assert.equal(a.batchId, b.batchId);
  });

  it('perezoso: sin resolver a nadie, no se reserva NADA', async () => {
    let calls = 0;
    const resolver = createCanonicalWizardBatchResolver(async () => {
      calls++;
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    }, payload(CLIENT_REQUEST_ID));

    assert.equal(calls, 0);
    assert.equal(resolver.isMaterialized(), false);
  });

  it('un fallo NO se memoriza — la capa gratuita falla ABIERTO y no puede envenenar el pago', async () => {
    let calls = 0;
    const resolver = createCanonicalWizardBatchResolver(async () => {
      calls++;
      if (calls === 1) throw new Error('blip transitorio');
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    }, payload(CLIENT_REQUEST_ID));

    await assert.rejects(() => resolver.resolve());
    const recovered = await resolver.resolve();

    assert.equal(recovered.batchId, CANONICAL_BATCH_ID, '🔴 la ruta de pago se recupera');
    assert.equal(calls, 2);
  });
});

// ── § 22 · el presupuesto bloqueado no fabrica lotes ─────────────────────────

describe('CUT-5 § 22 · lo que NO cambia', () => {
  it('presupuesto bloqueado y sin aporte gratuito ⇒ 0 lotes creados, igual que antes', async () => {
    await withEnv(async () => {
      const wired = wiring({ budgetBlocked: true });
      const result = await executeProspectWizardGeneration(REQUEST, wired.deps);

      assert.equal(result.ok, false);
      assert.equal(
        wired.observed.reserveSlotCalls.length,
        0,
        '🔴 la pereza es el punto: un clic sin cupo no deja lote vacío en `draft`',
      );
    });
  });
});
