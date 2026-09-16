/**
 * x64-waterfall-gap-accounting.test.ts — X6.4-B y X6.4-C.
 *
 * ── Los dos defectos que cierra ──────────────────────────────────────────────
 *
 * Corrida real `bedebe9b-0e22-4c8d-99e7-2c8d4a95a4c8` (CO × retail, objetivo 5):
 *
 *   B) El `gap: 5` que la pierna recibió NO era un defecto, y esta suite lo fija
 *      para que nadie vuelva a «corregirlo». Apollo MIDIÓ su única empresa
 *      (`complete_valid_candidates: 0`, `review_only_candidates: 1`, caída por
 *      `quality_gate` y `duplicate_status`): la fila existe y se revisará, pero
 *      no cubre el objetivo. `decideLushaWaterfallLeg` decide si se AUTORIZA una
 *      ruta de pago —la misma capa que el gate gratuita→Apollo resuelve con
 *      `acceptedBeforePaidRoute.targetReached`— y su autoridad es CUT-7: el
 *      hueco lo fija lo ACEPTADO, jamás las filas persistidas.
 *
 *   C) `metadata.accepted_for_target` acabó afirmando
 *      `persisted_total_candidates: 8` sobre 1 de Apollo + 8 de Lusha = 9. Las
 *      dos piernas escriben ese bloque en el MISMO lote y la última gana; la
 *      acción de Lusha sólo conoce su mitad.
 *
 * ── La línea que NO se cruza ────────────────────────────────────────────────
 *
 * El hueco gobierna la AUTORIZACIÓN del gasto, jamás la persistencia (X5.1). Con
 * `gap: 5` una pierna que encuentra 8 supervivientes persiste las 8, y el lote
 * termina con 9: el hueco no recorta. Y la aceptación no se finge — 9 filas
 * pueden convivir con 0 aceptadas.
 *
 * 🔴 NO confundir con `resolveLushaRemainingGap`, que es OTRA capa —comprar la
 * página siguiente dentro de una corrida ya pagada—, se cierra con
 * SUPERVIVIENTES y tiene prohibida la aceptación por los trinquetes M9/M10 de
 * X5.1. Dos huecos, dos autoridades, y ninguna invade a la otra.
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Supabase real · 0 Producción ·
 * 0 migraciones · 0 banderas. Todo inyectado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { decideLushaWaterfallLeg, LUSHA_WATERFALL_LEG_METADATA_KEY } from '../wizard-lusha-waterfall';
import { runLushaWaterfallLeg } from '../wizard-lusha-waterfall.server';
import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import { ACCEPTED_FOR_TARGET_METADATA_KEY } from '@/modules/prospect-batches/accepted-for-target';
import type { PersistLushaPendingReviewResult } from '@/server/prospect-batches/lusha-pending-review';
import { runPrePaidNoveltyDiscovery } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type { PrePaidNoveltyDiscoveryDeps } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Arnés: la MISMA forma que la suite de traza durable ──────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES; // 5, el de la corrida real
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
  industry: { id: INDUSTRY_ID, slug: 'retail', name: 'Retail' },
  subindustries: [
    { id: SUBINDUSTRY_ID, slug: 'retail-general', name: 'Retail', applicableCountries: ['CO'] },
  ],
};

function emptyFreeLayer(): PrePaidNoveltyDiscoveryDeps {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'retail',
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

/**
 * La mitad Apollo de la corrida REAL.
 *
 * 🔴 `completeValidCandidates` es lo que el writer MIDIÓ, y en `bedebe9b…` fue
 * **0 con 1 fila persistida**: la empresa cayó por `quality_gate` y
 * `duplicate_status` y quedó como `review_only`. No es una ausencia de medición
 * —es una medición que dio cero—, que es exactamente lo que significa que
 * `needs_review` no cuenta hacia el objetivo.
 */
function apolloOutput(
  apolloPersisted: number,
  completeValidCandidates: number | null = 0,
): IncrementalSearchOutput {
  return {
    batchId: CANONICAL_BATCH_ID,
    candidatesCreated: apolloPersisted,
    targetPersistibleCandidates: TARGET,
    targetReached: false,
    persistenceOutcome: {
      eligibleBeforePersistence: apolloPersisted,
      persistedCandidates: apolloPersisted,
      persistenceFailureCount: 0,
      persistenceFailed: false,
      persistenceErrorCode: null,
      persistenceErrorStage: null,
      persistenceStatus: 'success',
      persistenceAttemptedCount: apolloPersisted,
      persistenceSucceededCount: apolloPersisted,
      persistenceFailedCount: 0,
      persistenceGap: 0,
      completeValidCandidates,
      reviewOnlyCandidates: apolloPersisted - (completeValidCandidates ?? 0),
    },
  } as unknown as IncrementalSearchOutput;
}

/** El resultado de Lusha: `inserted` filas, aceptación NO medible (contrato). */
function lushaResult(inserted: number): PersistLushaPendingReviewResult {
  return {
    ok: true,
    status: 'success',
    batchId: CANONICAL_BATCH_ID,
    createdCandidatesCount: inserted,
    insertedCandidatesCount: inserted,
    pagesRequested: 1,
    // 🔴 `null`: Lusha no puede medir completitud (capacidad del proveedor).
    multiBranch: { acceptedForTargetTotal: null },
  } as unknown as PersistLushaPendingReviewResult;
}

type Publication = { batchId: string; published: Record<string, unknown> };

type Harness = {
  deps: WizardExecutionDeps;
  legInputs: Array<{ target: number; usefulAccumulated: number }>;
  lushaCalls: Array<{ targetGap: number | null }>;
  publications: Publication[];
};

function wiring(opts: {
  apolloPersisted: number;
  lushaInserted: number;
  /** Lo que el writer de Apollo MIDIÓ como completo-válido. Por defecto 0. */
  apolloAccepted?: number | null;
  waterfallEnabled?: boolean;
}): Harness {
  const free = emptyFreeLayer();
  const legInputs: Harness['legInputs'] = [];
  const lushaCalls: Harness['lushaCalls'] = [];
  const publications: Publication[] = [];

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
    runApolloPipeline: async () => apolloOutput(opts.apolloPersisted, opts.apolloAccepted ?? 0),
    markBatchFailed: async () => undefined,
    // 🔴 La pierna REAL, con sus banderas inyectadas: así el hueco lo calcula
    // `decideLushaWaterfallLeg` de verdad y no un doble que lo finja.
    runLushaWaterfallLeg: async (input) => {
      legInputs.push({ target: input.target, usefulAccumulated: input.usefulAccumulated });
      return runLushaWaterfallLeg(input, {
        waterfallEnabled: () => opts.waterfallEnabled ?? true,
        lushaAvailable: () => true,
        runLushaBatch: async (batchInput) => {
          lushaCalls.push({ targetGap: batchInput.waterfall?.targetGap ?? null });
          return lushaResult(opts.lushaInserted);
        },
      });
    },
    publishWaterfallLegTrace: async (input) => {
      publications.push({ batchId: input.batchId, published: input.published });
      return { status: 'published', fenced: true };
    },
  };

  return { deps, legInputs, lushaCalls, publications };
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

async function run(opts: Parameters<typeof wiring>[0]) {
  const harness = wiring(opts);
  const result = await withEnv(async () => {
    const r = await executeProspectWizardGeneration(REQUEST, harness.deps);
    assert.equal(r.ok, true);
    return r as SuccessResult;
  });
  return { ...harness, result };
}

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · el HUECO lo fija la ACEPTACIÓN — `needs_review` no cuenta (CUT-7)
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 1 · autoridad del hueco', () => {
  it('B/6 — Apollo persistió 1 `needs_review`, aceptó 0 ⇒ el hueco sigue siendo 5', async () => {
    // 🔴 La corrida real. `gap: 5` NO era un defecto: la fila existe y se
    // revisará, pero no cubre el objetivo, así que la ruta de pago sigue
    // autorizada a buscar las 5 que faltan.
    const { result, lushaCalls, legInputs } = await run({
      apolloPersisted: 1,
      apolloAccepted: 0,
      lushaInserted: 0,
    });
    assert.equal(legInputs[0].usefulAccumulated, 0, 'una fila de revisión acepta 0');
    assert.equal(result.lushaWaterfallLeg?.gap, 5, '🔴 descontarla sería descontar lo no aceptado');
    assert.equal(lushaCalls[0].targetGap, 5, 'y es el hueco que viaja al proveedor');
  });

  it('D/7 — Apollo persistió 1 y ACEPTÓ 1 ⇒ el hueco baja a 4', async () => {
    // Una aceptación SÍ descuenta. La diferencia con el caso anterior es el
    // único hecho capaz de mover el hueco: que la empresa cuente.
    const { result, legInputs } = await run({
      apolloPersisted: 1,
      apolloAccepted: 1,
      lushaInserted: 0,
    });
    assert.equal(legInputs[0].usefulAccumulated, 1);
    assert.equal(result.lushaWaterfallLeg?.gap, 4);
  });

  it('C/8 — Apollo persistió 5 `needs_review` ⇒ hueco 5 y la pierna SÍ corre', async () => {
    // 🔴 El caso que destapó la incompatibilidad: leyendo el hueco de las filas,
    // la pierna se saltaba con `target_reached` mientras la corrida se reportaba
    // `success_partial`. Dos cosas llamadas `target_reached` diciendo lo
    // contrario sobre la misma corrida.
    const { result, lushaCalls } = await run({
      apolloPersisted: 5,
      apolloAccepted: 0,
      lushaInserted: 0,
    });
    assert.equal(result.lushaWaterfallLeg?.executed, true);
    assert.notEqual(result.lushaWaterfallLeg?.skipReason, 'target_reached');
    assert.equal(result.lushaWaterfallLeg?.gap, 5, '🔴 5 filas de revisión no cierran nada');
    assert.equal(lushaCalls.length, 1);
    // Y las dos autoridades coinciden, que es la propiedad que se defiende.
    assert.equal(result.targetReached, false);
  });

  it('A — lote vacío ⇒ hueco entero, como siempre', async () => {
    const { result } = await run({ apolloPersisted: 0, apolloAccepted: 0, lushaInserted: 0 });
    assert.equal(result.lushaWaterfallLeg?.gap, 5);
  });

  it('el objetivo cubierto por ACEPTACIÓN sí cierra el hueco y no gasta', async () => {
    const { result, lushaCalls } = await run({
      apolloPersisted: 5,
      apolloAccepted: 5,
      lushaInserted: 0,
    });
    assert.equal(result.lushaWaterfallLeg?.executed, false);
    assert.equal(result.lushaWaterfallLeg?.skipReason, 'target_reached');
    assert.equal(lushaCalls.length, 0, '🔴 objetivo cumplido ⇒ ni una llamada, ni un crédito');
    assert.equal(result.targetReached, true, 'y las dos autoridades vuelven a coincidir');
  });

  it('la decisión PURA: sólo la aceptación entra en la aritmética del hueco', () => {
    const base = {
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      target: 5,
      macroIndustryKey: 'retail',
      canonicalBatchId: CANONICAL_BATCH_ID,
    } as const;

    const sinAceptar = decideLushaWaterfallLeg({ ...base, usefulAccumulated: 0 });
    assert.equal(sinAceptar.run && sinAceptar.gap, 5);

    const conUna = decideLushaWaterfallLeg({ ...base, usefulAccumulated: 1 });
    assert.equal(conUna.run && conUna.gap, 4);

    // Excedente: cierra igual que el empate, y nunca negativo.
    assert.deepEqual(decideLushaWaterfallLeg({ ...base, usefulAccumulated: 8 }), {
      run: false,
      reason: 'target_reached',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · el hueco NO es un tope de persistencia (X5.1 intacto)
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 2 · el hueco no recorta', () => {
  it('E/9 — Apollo 1 + hueco 5 + Lusha encuentra 8 ⇒ el lote termina con 9', async () => {
    const { result, lushaCalls } = await run({
      apolloPersisted: 1,
      apolloAccepted: 0,
      lushaInserted: 8,
    });

    assert.equal(lushaCalls[0].targetGap, 5, 'se pidió con el hueco de AUTORIZACIÓN…');
    assert.equal(result.lushaWaterfallLeg?.persistedCandidates, 8, '…y se persistieron las 8');
    // 🔴 Ni 5 (el objetivo) ni 5 (el hueco): 9. El hueco autoriza gasto, no
    // recorta existencia — X5.1 eliminó ese tope y este corte no lo reintroduce.
    assert.equal(result.candidateCount, 9);
    assert.equal(result.batchStatus, 'ready_for_review');
  });

  it('F/9b — ni `target_cap` ni truncamiento aparecen por ninguna parte', async () => {
    const { result } = await run({ apolloPersisted: 1, apolloAccepted: 0, lushaInserted: 8 });
    const serialized = JSON.stringify(result);
    assert.equal(/target_cap/.test(serialized), false);
    assert.equal(/target_overflow/.test(serialized), false);
    assert.equal(/truncat/i.test(serialized), false);
  });

  it('F2 — persistir MÁS que el hueco no reescribe el hueco con el que se pidió', async () => {
    const { result, lushaCalls } = await run({
      apolloPersisted: 1,
      apolloAccepted: 0,
      lushaInserted: 8,
    });
    assert.equal(lushaCalls[0].targetGap, 5);
    assert.equal(result.lushaWaterfallLeg?.gap, 5, 'la traza conserva lo que se AUTORIZÓ');
    assert.equal(result.candidateCount, 9, 'y el universo durable es otra cifra');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 3 · `accepted_for_target` refleja el lote ENTERO, sin fingir aceptación
// ═══════════════════════════════════════════════════════════════════════════

function acceptedBlock(publications: Publication[]): Record<string, unknown> {
  assert.equal(publications.length, 1, 'UNA publicación por corrida');
  const block = publications[0].published[ACCEPTED_FOR_TARGET_METADATA_KEY];
  assert.ok(block !== undefined && block !== null, '🔴 el bloque combinado no se publicó');
  return block as Record<string, unknown>;
}

describe('§ 3 · contabilidad durable del lote', () => {
  it('C — el bloque durable cuenta las 9 filas del lote, no las 8 de Lusha', async () => {
    const { publications } = await run({
      apolloPersisted: 1,
      apolloAccepted: 0,
      lushaInserted: 8,
    });
    const block = acceptedBlock(publications);
    assert.equal(block.persisted_total_candidates, 9, '🔴 8 era la mitad que la última pierna vio');
    assert.equal(block.persisted_paid_candidates, 9);
    assert.equal(block.requested_target, TARGET);
  });

  it('I — la aceptación NO se deriva de las filas persistidas', async () => {
    const { publications, result } = await run({
      apolloPersisted: 1,
      apolloAccepted: 0,
      lushaInserted: 8,
    });
    const block = acceptedBlock(publications);
    // 🔴 9 filas y CERO aceptadas. Apollo MIDIÓ cero (su fila es `review_only`) y
    // Lusha no puede medir. Un 9 aquí sería la mentira exacta que CUT-7 cerró.
    assert.equal(block.accepted_for_target_total, 0);
    assert.equal(block.accepted_paid_for_target, 0);
    assert.notEqual(
      block.accepted_for_target_total,
      block.persisted_total_candidates,
      '🔴 10 · aceptación y filas son cantidades DISTINTAS',
    );
    // Apollo midió (0); Lusha no. Un solo motivo, el suyo.
    assert.equal(block.paid_acceptance_measured, false);
    assert.deepEqual(block.acceptance_unknown_reasons, ['acceptance_not_measured']);
    assert.equal(block.target_reached, false);
    assert.equal(result.targetReached, false);
  });

  it('J — la traza de la pierna publica `acceptedForTarget: null`, nunca 0', async () => {
    const { publications, result } = await run({
      apolloPersisted: 1,
      apolloAccepted: 0,
      lushaInserted: 8,
    });
    const leg = publications[0].published[LUSHA_WATERFALL_LEG_METADATA_KEY] as Record<
      string,
      unknown
    >;
    // `null` = «no se midió». Lusha no puede medir completitud por contrato de
    // capacidad del proveedor; un 0 afirmaría haber medido y haber hallado cero.
    assert.equal(leg.acceptedForTarget, null);
    assert.equal(leg.persistedCandidates, 8);
    assert.notEqual(
      leg.acceptedForTarget,
      leg.persistedCandidates,
      '🔴 10 · la aceptación jamás se deriva de las filas',
    );
    assert.equal(leg.gap, 5);
    assert.equal(leg.executed, true);
    assert.equal(leg.skipReason, null);
    assert.deepEqual(leg, result.lushaWaterfallLeg);
  });

  it('sin pierna ejecutada el bloque combinado NO se reescribe', async () => {
    const { publications } = await run({
      apolloPersisted: 5,
      apolloAccepted: 5,
      lushaInserted: 0,
    });
    assert.equal(publications.length, 1);
    assert.equal(
      publications[0].published[ACCEPTED_FOR_TARGET_METADATA_KEY],
      undefined,
      'sin pierna no hay nada que pisar: el bloque del writer de Apollo se respeta',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · L — trinquetes contra las mutaciones que este corte prohíbe
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 4 · mutaciones muertas', () => {
  const pure = readFileSync(
    path.join(
      process.cwd(),
      'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.ts',
    ),
    'utf8',
  );
  const wizard = readFileSync(
    path.join(
      process.cwd(),
      'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
    ),
    'utf8',
  );
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('L1 — las FILAS persistidas no pueden entrar en la aritmética del hueco', () => {
    const code = strip(pure);
    // 🔴 El contrato de CUT-7, defendido en el código: la decisión de autorizar
    // gasto sólo conoce la aceptación. Un `persistedAccumulated` aquí volvería a
    // hacer que `needs_review` detuviera el waterfall.
    assert.equal(/persisted/i.test(code), false, '🔴 ninguna cuenta de filas en la decisión');
    assert.match(code, /input\.target - Math\.max\(0, input\.usefulAccumulated\)/);
  });

  it('L1b — el hueco tampoco puede ignorar la aceptación', () => {
    const code = strip(pure);
    assert.equal(
      /const gap = Math\.max\(0, input\.target\)/.test(code),
      false,
      '🔴 el hueco no puede volver a ser el objetivo entero',
    );
  });

  it('L1c — la decisión NO importa la autoridad de COMPRA de X5.1', () => {
    const code = strip(pure);
    // `resolveLushaRemainingGap`/`purchaseCredit` viven en la capa de comprar la
    // página siguiente y se cierran con SUPERVIVIENTES. Mezclar las dos capas es
    // exactamente lo que este corte revirtió.
    assert.equal(/resolveLushaRemainingGap|purchaseCredit/.test(code), false);
  });

  it('L1d — el call site del wizard alimenta el hueco con la ACEPTACIÓN', () => {
    const code = strip(wizard);
    assert.match(code, /usefulAccumulated: acceptedAfterApollo\.acceptedForTargetTotal/);
    assert.equal(
      /usefulAccumulated: combinedDurableTotals/.test(code),
      false,
      '🔴 alimentarlo con filas es la incompatibilidad que esta suite fija',
    );
  });

  it('L2 — el hueco NO se usa como tope de persistencia', () => {
    const code = strip(pure);
    // `gap` sólo viaja al resultado de la decisión; ningún `min(...gap)` recorta.
    assert.equal(/Math\.min\([^)]*gap/.test(code), false);
  });

  it('L3 — la pierna Lusha declara su gate de PAÍS', () => {
    const writer = strip(
      readFileSync(
        path.join(process.cwd(), 'src/server/prospect-batches/lusha-pending-review.ts'),
        'utf8',
      ),
    );
    assert.match(writer, /evaluateLushaCountryGate\(/, '🔴 el gate no puede desaparecer');
    assert.match(writer, /countryExcluded/);
  });

  it('L4 — `acceptedForTarget` no se sustituye por `persistedCandidates`', () => {
    const code = strip(wizard);
    assert.equal(
      /acceptedForTarget: .*persistedCandidates/.test(code),
      false,
      '🔴 derivar aceptación de filas es exactamente lo que CUT-7 cerró',
    );
    // El bloque durable se serializa con la autoridad existente, no a mano.
    assert.match(code, /toAcceptedForTargetMetadata\(acceptedForTarget\)/);
  });

  it('L5 — el bloque combinado sale de la resolución POSTERIOR a las dos piernas', () => {
    const code = strip(wizard);
    const publishIdx = code.indexOf('publishWaterfallLegTrace({');
    const resolveIdx = code.indexOf('const acceptedForTarget = resolveRunAcceptance(');
    assert.ok(resolveIdx > 0 && publishIdx > resolveIdx, '🔴 publicar antes sería la mitad Apollo');
  });
});
