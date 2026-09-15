/**
 * waterfall-leg-durable-trace.test.ts — la traza de la pierna Lusha tiene que
 * SOBREVIVIR a la sesión.
 *
 * AGENT1-WATERFALL-LEG-DURABLE-TRACE.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `lushaWaterfallLeg` se calculaba, se devolvía y llegaba al navegador. Ahí
 * moría: `prospect_batches.metadata->'lusha_waterfall_leg'` quedaba NULL incluso
 * en una corrida histórica en la que Lusha SÍ corrió y SÍ consumió créditos. Al
 * cerrar la sesión ya no se podía auditar si la pierna corrió, por qué se saltó,
 * por qué falló, con qué hueco, qué candidatos produjo ni qué aceptación
 * reportó — y reconstruirlo significaba volver a preguntarle a Lusha, es decir,
 * volver a pagar.
 *
 * ── Qué NO cambia ────────────────────────────────────────────────────────────
 *
 * Nada decisorio. La publicación es ADITIVA y muda: ocurre DESPUÉS de que la
 * corrida quedó resuelta, su desenlace no viaja al resultado y no toca
 * supervivencia, persistencia, objetivo, hueco, aceptación, presupuesto,
 * reserva, liquidación, selección de proveedor, Apollo, Lusha, enrichment,
 * ownership, sector, evidencia de país, dedupe, banderas ni migraciones.
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Supabase real · 0 Producción ·
 * 0 migraciones · 0 banderas tocadas. Todo inyectado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { LUSHA_WATERFALL_LEG_METADATA_KEY } from '../wizard-lusha-waterfall';
import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { LushaWaterfallLegOutcome } from '../wizard-lusha-waterfall.server';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import {
  decideBatchMetadataFencePlan,
  publishFencedBatchMetadata,
  type BatchMetadataPublicationDbClient,
  type BatchMetadataPublicationResult,
} from '@/server/prospect-batches/batch-metadata-fenced-publication';
import type { FenceCapabilityEvidence } from '@/server/prospect-batches/batch-identity-fenced-persistence';
import type { PersistLushaPendingReviewResult } from '@/server/prospect-batches/lusha-pending-review';
import { runPrePaidNoveltyDiscovery } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type { PrePaidNoveltyDiscoveryDeps } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Arnés: la MISMA forma que la suite de CORTE 4 / FAILURE-REASON ya usa ────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;
const USER_ID = '123e4567-e89b-12d3-a456-426614174019';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174011';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174012';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174013';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174014';
const LEG_REQUEST_ID = 'lusha-leg-request-id';
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

function successResult(
  overrides: Partial<PersistLushaPendingReviewResult> = {},
): PersistLushaPendingReviewResult {
  return {
    ok: true,
    status: 'success',
    batchId: CANONICAL_BATCH_ID,
    createdCandidatesCount: 2,
    insertedCandidatesCount: 2,
    pagesRequested: 1,
    multiBranch: { acceptedForTargetTotal: 2 },
    ...overrides,
  } as unknown as PersistLushaPendingReviewResult;
}

function failureResult(
  overrides: Partial<PersistLushaPendingReviewResult> = {},
): PersistLushaPendingReviewResult {
  return {
    ok: false,
    status: 'error',
    batchId: null,
    createdCandidatesCount: 0,
    insertedCandidatesCount: 0,
    pagesRequested: 0,
    ...overrides,
  } as unknown as PersistLushaPendingReviewResult;
}

/** Capa gratuita que no aporta nada: aísla la pierna Lusha. */
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

type TracePublication = { batchId: string; published: Record<string, unknown> };

function wiring(
  leg: WizardExecutionDeps['runLushaWaterfallLeg'],
  publish?: WizardExecutionDeps['publishWaterfallLegTrace'],
): WizardExecutionDeps {
  const free = emptyFreeLayer();
  return {
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
    runApolloPipeline: async (input) =>
      ({
        batchId: input.reservedBatchId,
        candidatesCreated: 0,
        targetPersistibleCandidates: TARGET,
        targetReached: false,
        persistenceOutcome: {
          eligibleBeforePersistence: 0,
          persistedCandidates: 0,
          persistenceFailureCount: 0,
          persistenceFailed: false,
          persistenceErrorCode: null,
          persistenceErrorStage: null,
          persistenceStatus: 'success',
          persistenceAttemptedCount: 0,
          persistenceSucceededCount: 0,
          persistenceFailedCount: 0,
          persistenceGap: 0,
          completeValidCandidates: 0,
          reviewOnlyCandidates: 0,
        },
      }) as unknown as IncrementalSearchOutput,
    markBatchFailed: async () => undefined,
    runLushaWaterfallLeg: leg,
    ...(publish ? { publishWaterfallLegTrace: publish } : {}),
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

type SuccessResult = Extract<
  Awaited<ReturnType<typeof executeProspectWizardGeneration>>,
  { ok: true }
>;

/** Corre el orquestador capturando lo que la costura durable recibió. */
async function runCapturing(
  outcome: LushaWaterfallLegOutcome,
): Promise<{ result: SuccessResult; calls: TracePublication[] }> {
  const calls: TracePublication[] = [];
  const result = await withEnv(async () => {
    const r = await executeProspectWizardGeneration(
      REQUEST,
      wiring(
        async () => outcome,
        async (input) => {
          calls.push({ batchId: input.batchId, published: input.published });
          return { status: 'published', fenced: true };
        },
      ),
    );
    assert.equal(r.ok, true, 'la corrida entera termina bien: la pierna es parcial');
    return r as SuccessResult;
  });
  return { result, calls };
}

/** Lo que quedó bajo `metadata.lusha_waterfall_leg` en la única publicación. */
function publishedBlock(calls: TracePublication[]): Record<string, unknown> {
  assert.equal(calls.length, 1, 'UNA publicación por corrida, ni cero ni dos');
  const block = calls[0].published[LUSHA_WATERFALL_LEG_METADATA_KEY];
  assert.ok(
    block !== undefined && block !== null,
    '🔴 la clave durable AUSENTE: ése es exactamente el defecto que este corte cierra',
  );
  return block as Record<string, unknown>;
}

function executedOutcome(
  result: PersistLushaPendingReviewResult,
  failure: { code: string; reason: string | null } | null = null,
  gap = 3,
): LushaWaterfallLegOutcome {
  return {
    executed: true,
    gap,
    clientRequestId: LEG_REQUEST_ID,
    result,
    failure,
  } as unknown as LushaWaterfallLegOutcome;
}

function skippedOutcome(reason: string): LushaWaterfallLegOutcome {
  return { executed: false, reason } as unknown as LushaWaterfallLegOutcome;
}

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · la traza queda DURABLE, entera y sin reinterpretar
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 1 · publicación durable de `lusha_waterfall_leg`', () => {
  it('CASO 1 — una pierna que CORRIÓ queda persistida bajo la clave durable', async () => {
    const { calls } = await runCapturing(executedOutcome(successResult()));
    const block = publishedBlock(calls);

    // El objeto COMPLETO, campo por campo. Ningún subconjunto: un bloque a
    // medias es la misma ceguera con otra forma.
    assert.deepEqual(block, {
      executed: true,
      skipReason: null,
      gap: 3,
      clientRequestId: LEG_REQUEST_ID,
      persistedCandidates: 2,
      acceptedForTarget: 2,
      failureCode: null,
      failureReason: null,
    });
  });

  it('CASO 2 — se escribe sobre el lote CANÓNICO de la corrida, no sobre otro', async () => {
    const { result, calls } = await runCapturing(executedOutcome(successResult()));
    assert.equal(calls[0].batchId, CANONICAL_BATCH_ID);
    assert.equal(result.batchId, CANONICAL_BATCH_ID);
  });

  it('CASO 3 — lo durable y lo que ve el navegador son EL MISMO objeto', async () => {
    const { result, calls } = await runCapturing(executedOutcome(successResult()));
    // 🔴 Dos copias de un mismo hecho es como dos capas empiezan a discrepar.
    assert.deepEqual(publishedBlock(calls), result.lushaWaterfallLeg);
  });

  it('CASO 4 — una pierna SALTADA conserva `executed:false`, `skipReason` y `gap`', async () => {
    const { calls } = await runCapturing(skippedOutcome('waterfall_flag_disabled'));
    assert.deepEqual(publishedBlock(calls), {
      executed: false,
      skipReason: 'waterfall_flag_disabled',
      // 🔴 `null`, NO `0`: la pierna no corrió con hueco cero, es que no corrió.
      gap: null,
      clientRequestId: null,
      persistedCandidates: null,
      acceptedForTarget: null,
      failureCode: null,
      failureReason: null,
    });
  });

  it('CASO 4b — un SKIP por objetivo cubierto se distingue de uno por bandera', async () => {
    const { calls } = await runCapturing(skippedOutcome('target_reached'));
    assert.equal(publishedBlock(calls).skipReason, 'target_reached');
  });

  it('CASO 5 — una pierna que corrió y FALLÓ conserva código y causa', async () => {
    const { calls } = await runCapturing(
      executedOutcome(failureResult({ error: 'lusha_budget_blocked' }), {
        code: 'budget',
        reason: 'lusha_budget_blocked',
      }),
    );
    const block = publishedBlock(calls);
    // 🔴 `executed` conserva el contrato ACTUAL: corrió y falló sigue siendo
    // `true`, y `skipReason` sigue `null`. Convertir un fallo en un skip sería
    // reinterpretar, que es justo lo que esta publicación no puede hacer.
    assert.equal(block.executed, true);
    assert.equal(block.skipReason, null);
    assert.equal(block.failureCode, 'budget');
    assert.equal(block.failureReason, 'lusha_budget_blocked');
    assert.equal(block.persistedCandidates, 0);
  });

  it('CASO 5b — `leg_failed` (excepción) viaja como SKIP, tal como hoy', async () => {
    const { calls } = await runCapturing(skippedOutcome('leg_failed'));
    const block = publishedBlock(calls);
    assert.equal(block.executed, false);
    assert.equal(block.skipReason, 'leg_failed');
    assert.equal(block.failureCode, null);
  });

  it('CASO 6 — `acceptedForTarget` NO MEDIDO se persiste como `null`, nunca como 0', async () => {
    const { calls } = await runCapturing(
      executedOutcome(
        successResult({ multiBranch: undefined } as Partial<PersistLushaPendingReviewResult>),
      ),
    );
    const block = publishedBlock(calls);
    // 🔴 Un `0` afirmaría haber medido cero. No medimos: la distinción es el
    // contrato entero de CUT-2 y este corte no puede borrarla al escribirla.
    assert.equal(block.acceptedForTarget, null);
    assert.equal(block.persistedCandidates, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · la publicación NO manda: el resultado de la corrida no se mueve
// ═══════════════════════════════════════════════════════════════════════════

describe('§ 2 · aditiva y muda', () => {
  it('CASO 7 — sin la costura cableada, el resultado es el de hoy campo por campo', async () => {
    const outcome = executedOutcome(successResult());
    const conTraza = await runCapturing(outcome);
    const sinTraza = await withEnv(async () => {
      const r = await executeProspectWizardGeneration(REQUEST, wiring(async () => outcome));
      assert.equal(r.ok, true);
      return r as SuccessResult;
    });
    // 🔴 El comportamiento EXISTENTE sobrevive a la ausencia del dep: es lo que
    // hace que este corte se pueda desplegar sin coordinar nada.
    assert.deepEqual(sinTraza, conTraza.result);
  });

  it('CASO 8 — una publicación que LANZA no tumba una corrida ya pagada', async () => {
    const outcome = executedOutcome(successResult());
    const result = await withEnv(async () => {
      const r = await executeProspectWizardGeneration(
        REQUEST,
        wiring(
          async () => outcome,
          async () => {
            throw new Error('metadata_publication_exploded');
          },
        ),
      );
      assert.equal(r.ok, true, '🔴 una escritura de OBSERVACIÓN no puede tumbar la corrida');
      return r as SuccessResult;
    });
    assert.equal(result.lushaWaterfallLeg?.executed, true);
    assert.equal(result.candidateCount, 2);
  });

  it('CASO 9 — un desenlace `stale` tampoco cambia nada de lo que se devuelve', async () => {
    const outcome = executedOutcome(successResult());
    const stale = await withEnv(async () => {
      const r = await executeProspectWizardGeneration(
        REQUEST,
        wiring(
          async () => outcome,
          async () => ({ status: 'stale' }) as BatchMetadataPublicationResult,
        ),
      );
      return r as SuccessResult;
    });
    const publicada = (await runCapturing(outcome)).result;
    assert.deepEqual(stale, publicada);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 3 · el MISMO fence que `accepted_for_target`, con el cliente REAL del par
// ═══════════════════════════════════════════════════════════════════════════

type FakeRow = { id: string; metadata: unknown; identity_epoch: number };

function makeDb(seed: FakeRow[]) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  const writes: { id: string; expectedEpoch: number | null }[] = [];

  const terminal = (id: string, expectedEpoch: number | null, metadata: unknown) => {
    writes.push({ id, expectedEpoch });
    const row = rows.get(id);
    if (!row) return { data: [] as { id: string }[], error: null };
    if (expectedEpoch !== null && row.identity_epoch !== expectedEpoch) {
      // 🔴 CERO filas y la metadata INTACTA: ésa es la propiedad entera.
      return { data: [] as { id: string }[], error: null };
    }
    row.metadata = metadata;
    return { data: [{ id }], error: null };
  };

  const client: BatchMetadataPublicationDbClient = {
    from: () => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            const row = rows.get(id);
            return { data: row ? { metadata: row.metadata } : null, error: null };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({
          eq: (_c2: string, epoch: number) => ({
            select: async () => terminal(id, epoch, patch.metadata),
          }),
          select: async () => terminal(id, null, patch.metadata),
        }),
      }),
    }),
  };

  return {
    client,
    metadataOf: (id: string) => rows.get(id)?.metadata as Record<string, unknown> | undefined,
    advanceEpoch: (id: string, by: number) => {
      const row = rows.get(id);
      if (row) row.identity_epoch += by;
    },
    writes: () => writes,
  };
}

const LIVE_EVIDENCE = (epoch: number): FenceCapabilityEvidence => ({
  epoch,
  fenceCapabilityAbsent: false,
  degraded: false,
});

const TRACE_BLOCK = {
  executed: true,
  skipReason: null,
  gap: 3,
  clientRequestId: LEG_REQUEST_ID,
  persistedCandidates: 2,
  acceptedForTarget: 2,
  failureCode: null,
  failureReason: null,
};

describe('§ 3 · la escritura pasa por el fence de CUT-9B, no por un mecanismo nuevo', () => {
  it('CASO 10 — con época REAL la escritura va VALLADA y el bloque queda en la fila', async () => {
    const db = makeDb([{ id: CANONICAL_BATCH_ID, metadata: {}, identity_epoch: 7 }]);
    const outcome = await publishFencedBatchMetadata(db.client, {
      batchId: CANONICAL_BATCH_ID,
      plan: decideBatchMetadataFencePlan({ epochAfterWrite: 7, evidence: LIVE_EVIDENCE(7) }),
      published: { [LUSHA_WATERFALL_LEG_METADATA_KEY]: TRACE_BLOCK },
    });
    assert.deepEqual(outcome, { status: 'published', fenced: true });
    assert.deepEqual(db.writes(), [{ id: CANONICAL_BATCH_ID, expectedEpoch: 7 }]);
    assert.deepEqual(db.metadataOf(CANONICAL_BATCH_ID), {
      [LUSHA_WATERFALL_LEG_METADATA_KEY]: TRACE_BLOCK,
    });
  });

  it('CASO 11 — NO pisa las demás claves de la metadata del lote', async () => {
    const previa = {
      accepted_for_target: { requested_target: 5, target_reached: false },
      provider_routing: { resolved: 'apollo' },
    };
    const db = makeDb([
      { id: CANONICAL_BATCH_ID, metadata: { ...previa }, identity_epoch: 4 },
    ]);
    await publishFencedBatchMetadata(db.client, {
      batchId: CANONICAL_BATCH_ID,
      plan: decideBatchMetadataFencePlan({ epochAfterWrite: 4, evidence: LIVE_EVIDENCE(4) }),
      published: { [LUSHA_WATERFALL_LEG_METADATA_KEY]: TRACE_BLOCK },
    });
    // 🔴 `accepted_for_target` es la clave que este lote ya tenía, y sigue
    // EXACTAMENTE igual: la traza convive, no sustituye.
    assert.deepEqual(db.metadataOf(CANONICAL_BATCH_ID), {
      ...previa,
      [LUSHA_WATERFALL_LEG_METADATA_KEY]: TRACE_BLOCK,
    });
  });

  it('CASO 12 — si otro escritor avanzó el lote, `stale` y CERO sobrescritura', async () => {
    const db = makeDb([
      { id: CANONICAL_BATCH_ID, metadata: { accepted_for_target: { target_reached: true } }, identity_epoch: 9 },
    ]);
    db.advanceEpoch(CANONICAL_BATCH_ID, 1);
    const outcome = await publishFencedBatchMetadata(db.client, {
      batchId: CANONICAL_BATCH_ID,
      plan: decideBatchMetadataFencePlan({ epochAfterWrite: 9, evidence: LIVE_EVIDENCE(9) }),
      published: { [LUSHA_WATERFALL_LEG_METADATA_KEY]: TRACE_BLOCK },
    });
    assert.deepEqual(outcome, { status: 'stale' });
    assert.deepEqual(db.metadataOf(CANONICAL_BATCH_ID), {
      accepted_for_target: { target_reached: true },
    });
  });

  it('CASO 13 — sin época y sin prueba de ausencia de la valla NO se escribe', async () => {
    const db = makeDb([{ id: CANONICAL_BATCH_ID, metadata: {}, identity_epoch: 2 }]);
    const outcome = await publishFencedBatchMetadata(db.client, {
      batchId: CANONICAL_BATCH_ID,
      plan: decideBatchMetadataFencePlan({
        epochAfterWrite: null,
        // Lectura CAÍDA: no es prueba de que la 126 no esté aplicada.
        evidence: { epoch: null, fenceCapabilityAbsent: false, degraded: true },
      }),
      published: { [LUSHA_WATERFALL_LEG_METADATA_KEY]: TRACE_BLOCK },
    });
    assert.deepEqual(outcome, { status: 'skipped_unavailable' });
    assert.deepEqual(db.writes(), []);
    assert.deepEqual(db.metadataOf(CANONICAL_BATCH_ID), {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · guardas estáticas — la publicación durable no puede desaparecer
// ═══════════════════════════════════════════════════════════════════════════

const ORCHESTRATOR =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const WATERFALL_PURE =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.ts';

/** Código SIN comentarios: nombrar un símbolo en prosa no es cablearlo. */
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

describe('§ 4 · guardas estáticas', () => {
  it('CASO 14 — el orquestador PUBLICA la traza bajo la clave durable', () => {
    const src = code(ORCHESTRATOR);
    assert.match(
      src,
      /publishWaterfallLegTrace\(\{/,
      '🔴 borrar la llamada devuelve el defecto entero: la traza vuelve a morir con la sesión',
    );
    assert.match(
      src,
      /\[LUSHA_WATERFALL_LEG_METADATA_KEY\]:\s*waterfallLegTrace\.lushaWaterfallLeg/,
      '🔴 lo que se publica es el bloque YA calculado, no una reconstrucción',
    );
  });

  it('CASO 15 — el cableado real usa el fence de CUT-9B y NO un segundo mecanismo', () => {
    const src = code(ORCHESTRATOR);
    assert.match(src, /publishWaterfallLegTrace:\s*async/, 'la costura está cableada');
    assert.match(
      src,
      /publishFencedBatchMetadata\(/,
      '🔴 un `.update({ metadata })` propio sería la actualización perdida de manual',
    );
    assert.match(src, /plan:\s*decideBatchMetadataFencePlan\(\{/);
    assert.match(
      src,
      /epochAfterWrite:\s*snapshot\.epoch/,
      '🔴 el token del CAS es la época POSTERIOR a la escritura de la pierna',
    );
  });

  it('CASO 16 — la clave durable vive en el módulo PURO, no como literal suelto', () => {
    assert.match(
      code(WATERFALL_PURE),
      /export const LUSHA_WATERFALL_LEG_METADATA_KEY = 'lusha_waterfall_leg'/,
    );
    // 🔴 El orquestador la IMPORTA. Un literal repetido es como el escritor y
    // quien audita acaban mirando dos sitios distintos.
    assert.match(code(ORCHESTRATOR), /LUSHA_WATERFALL_LEG_METADATA_KEY/);
  });

  it('CASO 17 — la traza se nombra UNA vez y de ahí salen las dos copias', () => {
    const src = code(ORCHESTRATOR);
    assert.match(src, /const waterfallLegTrace = \{/);
    assert.match(
      src,
      /\.\.\.waterfallLegTrace,/,
      '🔴 construir el bloque durable aparte abriría una segunda versión del mismo hecho',
    );
    assert.equal(
      (src.match(/lushaWaterfallLeg: \{/g) ?? []).length,
      1,
      '🔴 dos literales del bloque es exactamente cómo empiezan a discrepar',
    );
  });
});
