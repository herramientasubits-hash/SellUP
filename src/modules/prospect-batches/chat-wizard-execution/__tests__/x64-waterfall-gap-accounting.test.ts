/**
 * x64-waterfall-gap-accounting.test.ts — X6.4-B y X6.4-C.
 *
 * ── Los dos defectos que cierra ──────────────────────────────────────────────
 *
 * Corrida real `bedebe9b-0e22-4c8d-99e7-2c8d4a95a4c8` (CO × retail, objetivo 5):
 *
 *   B) Apollo persistió 1 empresa y la pierna Lusha recibió `gap: 5`. El hueco
 *      salía sólo de la ACEPTACIÓN, que es fail-closed: Apollo escribió una fila
 *      sin poder medir su completitud (`acceptance_not_measured`), así que la
 *      aceptación quedó en 0 y el lote —que ya no estaba vacío— se trató como si
 *      lo estuviera.
 *
 *   C) `metadata.accepted_for_target` acabó afirmando
 *      `persisted_total_candidates: 8` sobre 1 de Apollo + 8 de Lusha = 9. Las
 *      dos piernas escriben ese bloque en el MISMO lote y la última gana; la
 *      acción de Lusha sólo conoce su mitad.
 *
 * ── La línea que NO se cruza ────────────────────────────────────────────────
 *
 * El hueco gobierna la CONTINUACIÓN, jamás la persistencia (X5.1). Con `gap: 4`
 * una pierna que encuentra 8 supervivientes persiste las 8, y el lote termina
 * con 9. Y la aceptación no se finge: sigue saliendo de la autoridad del writer.
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
 * La mitad Apollo de la corrida REAL: `apolloPersisted` filas escritas, y la
 * completitud SIN MEDIR (`completeValidCandidates: null`) — que es exactamente
 * lo que dejó la aceptación en 0 y el hueco en 5.
 */
function apolloOutput(apolloPersisted: number): IncrementalSearchOutput {
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
      // 🔴 `null` = «no se midió». Es el estado real de la corrida bedebe9b.
      completeValidCandidates: null,
      reviewOnlyCandidates: null,
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
  legInputs: Array<{ target: number; usefulAccumulated: number; persistedAccumulated: number }>;
  lushaCalls: Array<{ targetGap: number | null }>;
  publications: Publication[];
};

function wiring(opts: {
  apolloPersisted: number;
  lushaInserted: number;
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
    runApolloPipeline: async () => apolloOutput(opts.apolloPersisted),
    markBatchFailed: async () => undefined,
    // 🔴 La pierna REAL, con sus banderas inyectadas: así el hueco lo calcula
    // `decideLushaWaterfallLeg` de verdad y no un doble que lo finja.
    runLushaWaterfallLeg: async (input) => {
      legInputs.push({
        target: input.target,
        usefulAccumulated: input.usefulAccumulated,
        persistedAccumulated: input.persistedAccumulated,
      });
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
// § 1 · el HUECO descuenta lo que el lote YA tiene (X6.4-B)
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 1 · contabilidad del hueco', () => {
  it('E — Apollo persistió 1, objetivo 5 ⇒ la pierna Lusha recibe gap 4', async () => {
    const { result, lushaCalls } = await run({ apolloPersisted: 1, lushaInserted: 0 });
    assert.equal(result.lushaWaterfallLeg?.gap, 4, '🔴 con 5 se repite la corrida bedebe9b');
    assert.equal(lushaCalls.length, 1);
    assert.equal(lushaCalls[0].targetGap, 4, 'el hueco que viaja al proveedor es el mismo');
  });

  it('E2 — el hueco descuenta las FILAS aunque la aceptación esté SIN MEDIR', async () => {
    // Éste es el corazón del defecto: la aceptación de Apollo fue 0 porque no se
    // midió, no porque no hubiera empresa.
    const { legInputs, result } = await run({ apolloPersisted: 1, lushaInserted: 0 });
    assert.equal(legInputs[0].usefulAccumulated, 0, 'la aceptación sigue siendo 0: fail-closed');
    assert.equal(legInputs[0].persistedAccumulated, 1, 'y la fila de Apollo sí se cuenta');
    assert.equal(result.lushaWaterfallLeg?.gap, 4);
  });

  it('F — Apollo persistió 5, objetivo 5 ⇒ gap 0 y la pierna NO corre', async () => {
    const { result, lushaCalls } = await run({ apolloPersisted: 5, lushaInserted: 0 });
    assert.equal(result.lushaWaterfallLeg?.executed, false);
    assert.equal(result.lushaWaterfallLeg?.skipReason, 'target_reached');
    assert.equal(result.lushaWaterfallLeg?.gap, null);
    assert.equal(lushaCalls.length, 0, '🔴 hueco cerrado ⇒ ni una llamada, ni un crédito');
  });

  it('K — la decisión PURA cuenta la fila de Apollo aunque no esté aceptada', () => {
    const decision = decideLushaWaterfallLeg({
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      target: 5,
      usefulAccumulated: 0,
      persistedAccumulated: 1,
      macroIndustryKey: 'retail',
      canonicalBatchId: CANONICAL_BATCH_ID,
    });
    assert.equal(decision.run, true);
    assert.equal(decision.run && decision.gap, 4);
  });

  it('K2 — una aceptación declarada NUNCA se pierde, aunque las filas digan menos', () => {
    const decision = decideLushaWaterfallLeg({
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      target: 5,
      usefulAccumulated: 3,
      persistedAccumulated: 0,
      macroIndustryKey: 'retail',
      canonicalBatchId: CANONICAL_BATCH_ID,
    });
    assert.equal(decision.run && decision.gap, 2);
  });

  it('K3 — el excedente cierra igual que el empate: el hueco nunca es negativo', () => {
    const decision = decideLushaWaterfallLeg({
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      target: 5,
      usefulAccumulated: 0,
      persistedAccumulated: 8,
      macroIndustryKey: 'retail',
      canonicalBatchId: CANONICAL_BATCH_ID,
    });
    assert.deepEqual(decision, { run: false, reason: 'target_reached' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · el hueco NO es un tope de persistencia (X5.1 intacto)
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 2 · el hueco no recorta', () => {
  it('G — Apollo 1 + gap 4 + Lusha encuentra 8 ⇒ el lote termina con 9', async () => {
    const { result, lushaCalls } = await run({ apolloPersisted: 1, lushaInserted: 8 });

    assert.equal(lushaCalls[0].targetGap, 4, 'se pidió con el hueco…');
    assert.equal(result.lushaWaterfallLeg?.persistedCandidates, 8, '…y se persistieron las 8');
    assert.equal(result.candidateCount, 9, '🔴 1 de Apollo + 8 de Lusha = 9, sin recorte');
    assert.equal(result.batchStatus, 'ready_for_review');
  });

  it('G2 — ni `target_cap` ni truncamiento aparecen por ninguna parte', async () => {
    const { result } = await run({ apolloPersisted: 1, lushaInserted: 8 });
    const serialized = JSON.stringify(result);
    assert.equal(/target_cap/.test(serialized), false);
    assert.equal(/target_overflow/.test(serialized), false);
    assert.equal(/truncat/i.test(serialized), false);
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
    const { publications } = await run({ apolloPersisted: 1, lushaInserted: 8 });
    const block = acceptedBlock(publications);
    assert.equal(block.persisted_total_candidates, 9, '🔴 8 era la mitad que la última pierna vio');
    assert.equal(block.persisted_paid_candidates, 9);
    assert.equal(block.requested_target, TARGET);
  });

  it('I — la aceptación NO se deriva de las filas persistidas', async () => {
    const { publications, result } = await run({ apolloPersisted: 1, lushaInserted: 8 });
    const block = acceptedBlock(publications);
    // 🔴 9 filas y CERO aceptadas: ninguna de las dos piernas pudo medir
    // completitud. Un 9 aquí sería la mentira exacta que CUT-7 cerró.
    assert.equal(block.accepted_for_target_total, 0);
    assert.equal(block.accepted_paid_for_target, 0);
    assert.equal(block.paid_acceptance_measured, false);
    assert.deepEqual(block.acceptance_unknown_reasons, [
      'acceptance_not_measured',
      'acceptance_not_measured',
    ]);
    assert.equal(block.target_reached, false);
    assert.equal(result.targetReached, false);
  });

  it('J — la traza de la pierna publica `acceptedForTarget: null`, nunca 0', async () => {
    const { publications, result } = await run({ apolloPersisted: 1, lushaInserted: 8 });
    const leg = publications[0].published[LUSHA_WATERFALL_LEG_METADATA_KEY] as Record<
      string,
      unknown
    >;
    // `null` = «no se midió». Lusha no puede medir completitud por contrato de
    // capacidad del proveedor; un 0 afirmaría haber medido y haber hallado cero.
    assert.equal(leg.acceptedForTarget, null);
    assert.equal(leg.persistedCandidates, 8);
    assert.equal(leg.gap, 4);
    assert.equal(leg.executed, true);
    assert.equal(leg.skipReason, null);
    assert.deepEqual(leg, result.lushaWaterfallLeg);
  });

  it('sin pierna ejecutada el bloque combinado NO se reescribe', async () => {
    const { publications } = await run({ apolloPersisted: 5, lushaInserted: 0 });
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

  it('L1 — `gap = target` (ignorando a Apollo) no compila como código vivo', () => {
    const code = strip(pure);
    assert.match(code, /persistedAccumulated/, 'el sumando tiene que estar en la decisión');
    assert.equal(
      /const gap = Math\.max\(0, input\.target\)/.test(code),
      false,
      '🔴 el hueco no puede volver a ser el objetivo entero',
    );
  });

  it('L2 — el hueco NO se usa como tope de persistencia', () => {
    const code = strip(pure);
    // `gap` sólo viaja al resultado de la decisión; ningún `min(...gap)` recorta.
    assert.equal(/Math\.min\([^)]*gap/.test(code), false);
  });

  it('L3 — la pierna Lusha declara su gate de país/ownership', () => {
    const writer = strip(
      readFileSync(
        path.join(process.cwd(), 'src/server/prospect-batches/lusha-pending-review.ts'),
        'utf8',
      ),
    );
    assert.match(writer, /evaluateLushaCountryOwnershipGate\(/, '🔴 el gate no puede desaparecer');
    assert.match(writer, /countryOwnershipExcluded/);
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
