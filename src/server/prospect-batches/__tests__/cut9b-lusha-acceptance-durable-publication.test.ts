/**
 * AGENT1-LOCAL-CUT9B-LUSHA-ACCEPTANCE-DURABLE-PUBLICATION.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 *     LUSHA MIXED (free + paid)
 *         → resolveAcceptedForTarget()  ✅ correcto
 *         → action return               ✅
 *         → UI                          ✅
 *         → prospect_batches.metadata.accepted_for_target   ❌ AUSENTE
 *
 * CUT-8 resolvió esto para la ruta Apollo con una costura que sólo existe en el
 * writer GENÉRICO: ése publica su metadata DESPUÉS de escribir los candidatos. El
 * núcleo de Lusha tiene el orden contrario —la metadata viaja en el INSERT de la
 * reserva, antes de que exista una sola fila— así que no había ninguna escritura
 * en la que esparcir un bloque que depende del resultado.
 *
 * ── Qué prueba esta suite, y con qué ─────────────────────────────────────────
 *
 * El núcleo REAL (`persistLushaPendingReviewBatch`), el escritor REAL
 * (`publishFencedBatchMetadata`), la decisión de régimen REAL
 * (`decideBatchMetadataFencePlan`) y el proyector REAL (`resolveAcceptedForTarget`
 * → `toAcceptedForTargetMetadata`) contra una base de mentira que sostiene fila,
 * metadata y `identity_epoch` de verdad.
 *
 * 🔴 Nada de esto se demuestra con derivaciones espejo: una derivación espejo se
 * queda atrás sin ponerse roja, y CUT9A ya pagó ese precio (V9A.1 pasó en verde
 * mientras el defecto estaba vivo). Lo que aquí se afirma se afirma sobre la fila
 * que el camino productivo deja escrita.
 *
 * Cero Supabase, cero proveedor, cero créditos, cero HubSpot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewCandidateRow,
} from '../lusha-pending-review';
import {
  composeFencedBatchMetadata,
  decideBatchMetadataFencePlan,
  publishFencedBatchMetadata,
  type BatchMetadataPublicationDbClient,
} from '../batch-metadata-fenced-publication';
import type { FenceCapabilityEvidence } from '../batch-identity-fenced-persistence';
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  toAcceptedForTargetMetadata,
} from '@/modules/prospect-batches/accepted-for-target';
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import type { ResolveExtraBatchMetadata } from '@/server/agents/prospecting-toolkit/writer-metadata-resolution';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '../lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

const ROOT = process.cwd();
const CORE_FILE = join(ROOT, 'src/server/prospect-batches/lusha-pending-review.ts');
const ACTION_FILE = join(ROOT, 'src/modules/prospect-batches/lusha-pending-review-actions.ts');
const PUBLICATION_FILE = join(
  ROOT,
  'src/server/prospect-batches/batch-metadata-fenced-publication.ts',
);
const CORE = readFileSync(CORE_FILE, 'utf8');
const ACTION = readFileSync(ACTION_FILE, 'utf8');
const PUBLICATION = readFileSync(PUBLICATION_FILE, 'utf8');

/**
 * 🔴 Las guardas que prohíben una FORMA de escribir tienen que mirar CÓDIGO. Estos
 * archivos documentan en prosa lo que NO hacen —«no hay ORDER BY created_at DESC»,
 * «no hay una clave lusha_accepted_for_target»— y una guarda que lea el archivo
 * entero se pondría roja justamente por la frase que promete la propiedad.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const CORE_CODE = code(CORE);
const ACTION_CODE = code(ACTION);
const PUBLICATION_CODE = code(PUBLICATION);

const BATCH_ID = 'batch-canonical';
const OTHER_BATCH_ID = 'batch-someone-else';

// ═══════════════════════════════════════════════════════════════════════════
// Base de mentira: fila con metadata y época REALES
// ═══════════════════════════════════════════════════════════════════════════

type FakeRow = { id: string; metadata: unknown; identity_epoch: number };

/**
 * Sostiene lo mismo que la fila real: metadata y época. El UPDATE con el segundo
 * `eq` es el CAS — si la época no coincide devuelve CERO filas, que es
 * literalmente lo que hace Postgres con `WHERE identity_epoch = :expected`.
 */
function makeDb(seed: FakeRow[]) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  const writes: { id: string; expectedEpoch: number | null; metadata: unknown }[] = [];
  const reads: string[] = [];

  const terminal = (id: string, expectedEpoch: number | null, metadata: unknown) => {
    writes.push({ id, expectedEpoch, metadata });
    const row = rows.get(id);
    if (!row) return { data: [] as { id: string }[], error: null };
    if (expectedEpoch !== null && row.identity_epoch !== expectedEpoch) {
      // 🔴 CERO filas, y la metadata NO se toca. Ésa es la propiedad entera.
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
            reads.push(id);
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
    metadataOf: (id: string) => rows.get(id)?.metadata ?? null,
    epochOf: (id: string) => rows.get(id)?.identity_epoch ?? null,
    advanceEpoch: (id: string, by: number) => {
      const row = rows.get(id);
      if (row) row.identity_epoch += by;
    },
    writes: () => writes,
    reads: () => reads,
  };
}

const LIVE_EVIDENCE = (epoch: number): FenceCapabilityEvidence => ({
  epoch,
  fenceCapabilityAbsent: false,
  degraded: false,
});
const PROVEN_ABSENT: FenceCapabilityEvidence = {
  epoch: null,
  fenceCapabilityAbsent: true,
  degraded: false,
};
const BROKEN_READ: FenceCapabilityEvidence = {
  epoch: null,
  fenceCapabilityAbsent: false,
  degraded: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// El proyector CANÓNICO, construido como lo construye la acción
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La corrida: objetivo, aporte gratuito y demanda, exactamente como la acción los
 * captura. Devuelve el helper único (`resolveRunAcceptance`) y el proyector
 * derivado de él, que es lo que se inyecta al núcleo.
 */
function makeRun(options: {
  requestedTarget: number;
  freePersisted: number;
  freeAccepted: number;
}) {
  const { requestedTarget, freePersisted, freeAccepted } = options;
  const demand =
    freePersisted > 0
      ? resolveProviderResultDemand(
          {
            requestedTarget,
            acceptedBeforeProvider: freeAccepted,
            residualGap: requestedTarget - freeAccepted,
            providerRequired: requestedTarget - freeAccepted > 0,
          },
          requestedTarget,
        )
      : fullTargetResultDemand(requestedTarget);

  const resolveRunAcceptance = (paidWriterTruth: {
    completeValidCandidates: number | null | undefined;
    persistedCandidates: number;
  }) =>
    resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: freePersisted,
      paid: paidAcceptedContributionFromWriterTruth(paidWriterTruth),
    });

  const project: ResolveExtraBatchMetadata = (writerOutcome) => ({
    [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(
      resolveRunAcceptance({
        completeValidCandidates: writerOutcome.completeValidCandidates,
        persistedCandidates: writerOutcome.persistedCandidates,
      }),
    ),
  });

  return { demand, resolveRunAcceptance, project };
}

function acceptedBlock(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const block = (metadata as Record<string, unknown>)[ACCEPTED_FOR_TARGET_METADATA_KEY];
  return typeof block === 'object' && block !== null && !Array.isArray(block)
    ? (block as Record<string, unknown>)
    : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Núcleo REAL: entradas mínimas
// ═══════════════════════════════════════════════════════════════════════════

const RUNTIME_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

function company(n: number): LushaPreviewCompany {
  return {
    name: `Clínica ${n}`,
    domain: `clinica${n}.com`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    score: 92,
    passesGate: true,
    issues: [],
    providerCompanyId: `pc-clinica${n}`,
    linkedinUrl: `https://linkedin.com/company/clinica${n}`,
  };
}

function search(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

const noDuplicate = (input: DuplicateCheckInput): DuplicateCheckResult => ({
  status: 'new_candidate',
  confidence: 85,
  input,
  matches: [],
  summary: 'nuevo',
  checkedSources: ['sellup', 'hubspot'],
});

/**
 * El núcleo REAL, con la costura de CUT9B cableada como la cablea la acción.
 *
 * `insertedOverride` permite que la base confirme MENOS filas de las que el
 * núcleo intentó escribir — el caso en el que `persistedForTarget` y
 * `useful.length` dejan de coincidir.
 */
async function runCore(options: {
  requestedTarget: number;
  freePersisted: number;
  freeAccepted: number;
  paidCompanies: number;
  liveEpoch?: number;
  insertedOverride?: number;
  capabilityAbsent?: boolean;
  db: ReturnType<typeof makeDb>;
  competingWriteBeforePublish?: number;
}) {
  const run = makeRun(options);
  let epochNow = options.liveEpoch ?? options.freePersisted;
  const seen = { unfenced: 0, projected: [] as unknown[] };

  const deps = {
    runSearch: async (input: LushaPreviewInput & { page?: number }) =>
      (input.page ?? 0) > 0
        ? search([])
        : search(Array.from({ length: options.paidCompanies }, (_, i) => company(i + 1))),
    reserveBatch: async () => ({ id: BATCH_ID, adopted: true, identityEpoch: 0 }),
    readBatchIdentityEpoch: async (): Promise<FenceCapabilityEvidence> =>
      options.capabilityAbsent ? PROVEN_ABSENT : LIVE_EVIDENCE(epochNow),
    insertCandidatesFenced: async ({
      expectedEpoch,
      rows,
    }: {
      batchId: string;
      expectedEpoch: number;
      rows: LushaPendingReviewCandidateRow[];
    }) => {
      if (options.capabilityAbsent) return { status: 'capability_absent' as const };
      if (expectedEpoch !== epochNow) return { status: 'stale' as const, currentEpoch: epochNow };
      const previousEpoch = epochNow;
      const inserted = options.insertedOverride ?? rows.length;
      epochNow += rows.length;
      options.db.advanceEpoch(BATCH_ID, rows.length);
      return {
        status: 'inserted' as const,
        candidateIds: [],
        insertedCount: inserted,
        previousEpoch,
        nextEpoch: epochNow,
      };
    },
    insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
      seen.unfenced += 1;
      return { insertedCount: options.insertedOverride ?? rows.length };
    },
    acceptedForTargetPublication: {
      resolve: (outcome: Parameters<ResolveExtraBatchMetadata>[0]) => {
        seen.projected.push(outcome);
        return run.project(outcome);
      },
      publish: async (args: {
        batchId: string;
        epochAfterWrite: number | null;
        evidence: FenceCapabilityEvidence;
        published: Record<string, unknown> | null;
      }) => {
        // 🔴 La carrera REAL: otro escritor legítimo avanza el lote ENTRE la
        // escritura de candidatos y la publicación.
        if (options.competingWriteBeforePublish) {
          options.db.advanceEpoch(BATCH_ID, options.competingWriteBeforePublish);
        }
        return publishFencedBatchMetadata(options.db.client, {
          batchId: args.batchId,
          plan: decideBatchMetadataFencePlan({
            epochAfterWrite: args.epochAfterWrite,
            evidence: args.evidence,
          }),
          published: args.published,
        });
      },
    },
    checkCompanyDuplicate: async (input: DuplicateCheckInput) => noDuplicate(input),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
  } as unknown as PersistLushaPendingReviewDeps;

  const result = await persistLushaPendingReviewBatch(
    deps,
    RUNTIME_INPUT,
    {
      internalUserId: 'user-1',
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestedTarget: options.requestedTarget,
    },
    undefined,
    // 🔴 El hueco RESIDUAL que la capa gratuita dejó abierto, igual que en
    // producción (`targetGap: prePaid.residualGap`). Sin él la mitad de pago se
    // acota al objetivo de producto y el caso § I no se puede montar.
    { targetGap: options.requestedTarget - options.freeAccepted },
  );

  // La aceptación que la ACCIÓN devuelve, resuelta exactamente como ella lo hace.
  const returned = run.resolveRunAcceptance({
    completeValidCandidates: result.multiBranch?.acceptedForTargetTotal ?? null,
    persistedCandidates: result.insertedCandidatesCount,
  });

  return { result, returned, seen, run };
}

// ═══════════════════════════════════════════════════════════════════════════
// § I — EL CASO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 EL TECHO DE PRODUCTO DE LUSHA, dicho antes de leer los números.
 *
 * `resolveLushaTargetGap` recorta el hueco al objetivo de producto de esta
 * superficie, que es `LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES = 5`. Un
 * objetivo de 10 NO es alcanzable de extremo a extremo por la ruta Lusha, y
 * CUT9B no lo cambia (§ V: no se toca partial-gap, ni dedupe, ni demanda de
 * proveedor). Por eso el caso principal se afirma DOS veces y ninguna es un
 * espejo:
 *
 *   § I-A — el núcleo REAL, con los números que esta superficie SÍ produce.
 *           Prueba la costura entera: proyección, valla, escritura y fila.
 *   § I-B — los números EXACTOS del § I del encargo (10 / 4 / 6), sobre el
 *           proyector REAL y el escritor REAL. Prueba la ARITMÉTICA publicada,
 *           que es donde viven esos números.
 */
test('§ I-A — el núcleo REAL deja el bloque DURABLE en el lote canónico (objetivo 5: 2 gratis + 3 de pago)', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: { A: 1 }, identity_epoch: 2 }]);
  const { result, returned } = await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    liveEpoch: 2,
    db,
  });

  assert.equal(result.ok, true, `la corrida falló: ${result.error ?? ''}`);
  assert.equal(result.status, 'success');
  assert.equal(result.insertedCandidatesCount, 3);

  // 🔴 La publicación ENTRÓ, y entró VALLADA.
  assert.deepEqual(result.acceptedForTargetPublication, { status: 'published', fenced: true });

  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.ok(block, 'metadata.accepted_for_target AUSENTE: el defecto de CUT9B sigue vivo');
  assert.deepEqual(block, {
    requested_target: 5,
    accepted_free_for_target: 2,
    accepted_paid_for_target: 3,
    accepted_for_target_total: 5,
    remaining_target: 0,
    target_reached: true,
    persisted_free_candidates: 2,
    persisted_paid_candidates: 3,
    persisted_total_candidates: 5,
    paid_acceptance_measured: true,
    acceptance_unknown_reasons: [],
  });

  // El lote durable es el CANÓNICO, y es el ÚNICO que se toca.
  assert.equal(result.batchId, BATCH_ID);
  assert.deepEqual(db.writes().map((w) => w.id), [BATCH_ID]);

  // Y coincide, campo a campo, con lo que la acción devuelve al mago.
  assert.deepEqual(block, toAcceptedForTargetMetadata(returned));
});

test('§ I-B — los números del encargo (10 = 4 gratis + 6 de pago) se publican EXACTAMENTE', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 10 }]);
  const run = makeRun({ requestedTarget: 10, freePersisted: 4, freeAccepted: 4 });

  const outcome = await publishFencedBatchMetadata(db.client, {
    batchId: BATCH_ID,
    plan: decideBatchMetadataFencePlan({ epochAfterWrite: 10, evidence: LIVE_EVIDENCE(4) }),
    published: run.project({
      persistedCandidates: 6,
      completeValidCandidates: 6,
      reviewOnlyCandidates: null,
    }),
  });
  assert.deepEqual(outcome, { status: 'published', fenced: true });

  assert.deepEqual(acceptedBlock(db.metadataOf(BATCH_ID)), {
    requested_target: 10,
    accepted_free_for_target: 4,
    accepted_paid_for_target: 6,
    accepted_for_target_total: 10,
    remaining_target: 0,
    target_reached: true,
    persisted_free_candidates: 4,
    persisted_paid_candidates: 6,
    persisted_total_candidates: 10,
    paid_acceptance_measured: true,
    acceptance_unknown_reasons: [],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § N — la metadata previa SOBREVIVE
// ═══════════════════════════════════════════════════════════════════════════

test('§ N — la publicación AÑADE su clave; A, B y C siguen ahí', async () => {
  const before = { A: 1, B: { nested: true }, C: ['x'] };
  const db = makeDb([{ id: BATCH_ID, metadata: before, identity_epoch: 2 }]);
  await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    liveEpoch: 2,
    db,
  });

  const after = db.metadataOf(BATCH_ID) as Record<string, unknown>;
  assert.deepEqual(Object.keys(after).sort(), ['A', 'B', 'C', ACCEPTED_FOR_TARGET_METADATA_KEY].sort());
  assert.deepEqual(after.A, before.A);
  assert.deepEqual(after.B, before.B);
  assert.deepEqual(after.C, before.C);
  assert.ok(acceptedBlock(after));
});

test('§ N — la composición es SUSTITUCIÓN de claves, jamás un reemplazo total', () => {
  const composed = composeFencedBatchMetadata(
    { routing: { p: 1 }, adaptive_discovery: { d: 2 }, [ACCEPTED_FOR_TARGET_METADATA_KEY]: { old: true } },
    { [ACCEPTED_FOR_TARGET_METADATA_KEY]: { fresh: true } },
  );
  assert.deepEqual(composed, {
    routing: { p: 1 },
    adaptive_discovery: { d: 2 },
    [ACCEPTED_FOR_TARGET_METADATA_KEY]: { fresh: true },
  });
  // Una metadata ilegible se trata como AUSENCIA, no como error.
  assert.deepEqual(composeFencedBatchMetadata(null, { k: 1 }), { k: 1 });
  assert.deepEqual(composeFencedBatchMetadata([1, 2], { k: 1 }), { k: 1 });
  assert.deepEqual(composeFencedBatchMetadata('nope', { k: 1 }), { k: 1 });
  // Sin bloque que publicar, la metadata previa se conserva ENTERA.
  assert.deepEqual(composeFencedBatchMetadata({ a: 1 }, null), { a: 1 });
});

// ═══════════════════════════════════════════════════════════════════════════
// § J — duplicados CRUZADOS: 4 + 6 crudos NO son 10
// ═══════════════════════════════════════════════════════════════════════════

test('§ J — freeAccepted 4 + paid útil crudo 6 con 2 duplicados cruzados ⇒ total 8, NUNCA 10', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 4 }]);
  const run = makeRun({ requestedTarget: 10, freePersisted: 4, freeAccepted: 4 });

  // Lo que el núcleo entrega tras la admisión por identidad de lote: de 6 crudos,
  // 2 ya estaban en el lote ⇒ 4 aceptados. `persistedCandidates` sigue siendo lo
  // que la base confirmó.
  const published = run.project({
    persistedCandidates: 4,
    completeValidCandidates: 4,
    reviewOnlyCandidates: null,
  });

  const outcome = await publishFencedBatchMetadata(db.client, {
    batchId: BATCH_ID,
    plan: decideBatchMetadataFencePlan({ epochAfterWrite: 4, evidence: LIVE_EVIDENCE(4) }),
    published,
  });
  assert.deepEqual(outcome, { status: 'published', fenced: true });

  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.equal(block?.accepted_free_for_target, 4);
  assert.equal(block?.accepted_paid_for_target, 4);
  assert.equal(block?.accepted_for_target_total, 8);
  assert.equal(block?.remaining_target, 2);
  assert.equal(block?.target_reached, false);
  // 🔴 La afirmación prohibida, dicha al revés.
  assert.notEqual(block?.accepted_for_target_total, 10);
});

// ═══════════════════════════════════════════════════════════════════════════
// § K — persistidas > aceptadas: NO se igualan
// ═══════════════════════════════════════════════════════════════════════════

test('§ K — 6 persistidas y 4 aceptadas se publican como 6 y 4, no como 6 y 6', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 4 }]);
  const run = makeRun({ requestedTarget: 10, freePersisted: 4, freeAccepted: 4 });
  await publishFencedBatchMetadata(db.client, {
    batchId: BATCH_ID,
    plan: decideBatchMetadataFencePlan({ epochAfterWrite: 4, evidence: LIVE_EVIDENCE(4) }),
    published: run.project({
      persistedCandidates: 6,
      completeValidCandidates: 4,
      reviewOnlyCandidates: null,
    }),
  });

  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.equal(block?.persisted_paid_candidates, 6, 'las filas persistidas se recortaron a la aceptación');
  assert.equal(block?.accepted_paid_for_target, 4, 'la aceptación se infló hasta las filas');
  assert.equal(block?.persisted_total_candidates, 10);
  assert.equal(block?.accepted_for_target_total, 8);
});

// ═══════════════════════════════════════════════════════════════════════════
// § L — aceptación de pago SIN MEDIR ≠ cero medido
// ═══════════════════════════════════════════════════════════════════════════

test('§ L — `completeValidCandidates: null` se publica como NO medido, no como cero ni como las filas', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 4 }]);
  const run = makeRun({ requestedTarget: 10, freePersisted: 4, freeAccepted: 4 });
  await publishFencedBatchMetadata(db.client, {
    batchId: BATCH_ID,
    plan: decideBatchMetadataFencePlan({ epochAfterWrite: 4, evidence: LIVE_EVIDENCE(4) }),
    published: run.project({
      persistedCandidates: 6,
      completeValidCandidates: null,
      reviewOnlyCandidates: null,
    }),
  });

  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.equal(block?.paid_acceptance_measured, false, 'un «no medido» se publicó como medido');
  assert.equal(block?.accepted_paid_for_target, 0);
  assert.notEqual(block?.accepted_paid_for_target, 6, 'aceptado := persistido, la mentira de CUT-7');
  assert.equal(block?.persisted_paid_candidates, 6, 'las filas desaparecieron con la medición');
  assert.ok(
    Array.isArray(block?.acceptance_unknown_reasons) &&
      (block?.acceptance_unknown_reasons as unknown[]).length > 0,
    'no se declaró el motivo de la no-medición',
  );
});

test('§ L — la ruta de pago que NO corrió es cero CONOCIDO, con la MISMA clave y forma', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 4 }]);
  const run = makeRun({ requestedTarget: 10, freePersisted: 4, freeAccepted: 4 });
  await publishFencedBatchMetadata(db.client, {
    batchId: BATCH_ID,
    plan: decideBatchMetadataFencePlan({ epochAfterWrite: 4, evidence: LIVE_EVIDENCE(4) }),
    published: run.project(PAID_ROUTE_NOT_RUN_WRITER_TRUTH),
  });
  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.equal(block?.paid_acceptance_measured, true, '«no corrió» se publicó como «no medido»');
  assert.equal(block?.accepted_paid_for_target, 0);
  assert.equal(block?.accepted_for_target_total, 4);
});

// ═══════════════════════════════════════════════════════════════════════════
// § O — CONCURRENCIA
// ═══════════════════════════════════════════════════════════════════════════

test('§ O — otro escritor avanza el lote tras la escritura: `stale`, y CERO sobrescritura', async () => {
  const before = { A: 1, adaptive_discovery: { kept: true } };
  const db = makeDb([{ id: BATCH_ID, metadata: before, identity_epoch: 2 }]);
  const { result } = await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    liveEpoch: 2,
    db,
    // La época pasa de 5 a 6 entre la escritura de candidatos y el CAS.
    competingWriteBeforePublish: 1,
  });

  assert.deepEqual(result.acceptedForTargetPublication, { status: 'stale' });
  // 🔴 La fila NO se tocó: ni el bloque nuevo, ni la pérdida de lo previo.
  assert.deepEqual(db.metadataOf(BATCH_ID), before);
  assert.equal(acceptedBlock(db.metadataOf(BATCH_ID)), null);
  // Y la corrida NO se convirtió en un error: las filas ya son durables.
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.insertedCandidatesCount, 3);
});

test('§ O — el CAS declara la época POSTERIOR a la escritura, no la de antes', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 2 }]);
  const { result } = await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    liveEpoch: 2,
    db,
  });
  assert.equal(result.acceptedForTargetPublication?.status, 'published');
  // 2 (lo gratuito) + 3 (lo de pago) = 5. Declarar 2 —la época de ANTES— habría
  // dado `stale` contra la escritura de esta misma corrida.
  assert.deepEqual(
    db.writes().map((w) => w.expectedEpoch),
    [5],
  );
});

test('§ O — una lectura AVERIADA no autoriza escribir: sin época y sin prueba, no se escribe', async () => {
  assert.deepEqual(
    decideBatchMetadataFencePlan({ epochAfterWrite: null, evidence: BROKEN_READ }),
    { mode: 'unavailable' },
  );
  const db = makeDb([{ id: BATCH_ID, metadata: { A: 1 }, identity_epoch: 4 }]);
  const outcome = await publishFencedBatchMetadata(db.client, {
    batchId: BATCH_ID,
    plan: { mode: 'unavailable' },
    published: { [ACCEPTED_FOR_TARGET_METADATA_KEY]: { x: 1 } },
  });
  assert.deepEqual(outcome, { status: 'skipped_unavailable' });
  assert.deepEqual(db.writes(), [], 'una avería produjo una escritura');
  assert.deepEqual(db.metadataOf(BATCH_ID), { A: 1 });
});

test('§ O — el régimen lo decide el ESQUEMA: época real ⇒ vallado; ausencia PROBADA ⇒ ruta anterior a B4', () => {
  assert.deepEqual(
    decideBatchMetadataFencePlan({ epochAfterWrite: 7, evidence: LIVE_EVIDENCE(4) }),
    { mode: 'fenced', expectedEpoch: 7 },
  );
  assert.deepEqual(
    decideBatchMetadataFencePlan({ epochAfterWrite: null, evidence: PROVEN_ABSENT }),
    { mode: 'legacy_unfenced' },
  );
  // 🔴 «Sin época» NO es «sin migración»: la conjunción es la de CUT-3B4.
  assert.deepEqual(
    decideBatchMetadataFencePlan({
      epochAfterWrite: null,
      evidence: { epoch: null, fenceCapabilityAbsent: true, degraded: true },
    }),
    { mode: 'unavailable' },
  );
  assert.deepEqual(
    decideBatchMetadataFencePlan({
      epochAfterWrite: null,
      evidence: { epoch: 3, fenceCapabilityAbsent: true, degraded: false },
    }),
    { mode: 'unavailable' },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// § F — la M126 SIN aplicar: la publicación sigue funcionando
// ═══════════════════════════════════════════════════════════════════════════

test('§ F — con la 126 sin aplicar, el bloque se publica igual (ruta anterior a B4)', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: { A: 1 }, identity_epoch: 0 }]);
  const { result } = await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    capabilityAbsent: true,
    db,
  });

  assert.equal(result.ok, true, `la corrida falló: ${result.error ?? ''}`);
  assert.deepEqual(result.acceptedForTargetPublication, { status: 'published', fenced: false });
  // Sin valla no se declara época: la columna no existe en ese esquema.
  assert.deepEqual(db.writes().map((w) => w.expectedEpoch), [null]);
  const after = db.metadataOf(BATCH_ID) as Record<string, unknown>;
  assert.equal(after.A, 1, 'la ruta anterior a B4 borró la metadata previa');
  assert.equal(acceptedBlock(after)?.accepted_for_target_total, 5);
});

test('§ F — un lote invisible para la RLS NO se compone sobre `{}`', async () => {
  const db = makeDb([{ id: BATCH_ID, metadata: { A: 1 }, identity_epoch: 4 }]);
  const outcome = await publishFencedBatchMetadata(db.client, {
    batchId: OTHER_BATCH_ID,
    plan: { mode: 'fenced', expectedEpoch: 4 },
    published: { [ACCEPTED_FOR_TARGET_METADATA_KEY]: { x: 1 } },
  });
  assert.deepEqual(outcome, { status: 'batch_not_found' });
  assert.deepEqual(db.writes(), [], 'se escribió sobre un lote que no se pudo leer');
  assert.deepEqual(db.metadataOf(BATCH_ID), { A: 1 });
});

// ═══════════════════════════════════════════════════════════════════════════
// § G — el núcleo entrega VERDAD DE WRITER, no una segunda aritmética
// ═══════════════════════════════════════════════════════════════════════════

test('§ G — el núcleo proyecta `persistedForTarget` RECONCILIADO, no `useful.length`', async () => {
  // La base confirma 4 de las 6 filas que el núcleo intentó escribir.
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 2 }]);
  const { result, seen, returned } = await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    liveEpoch: 2,
    insertedOverride: 2,
    db,
  });

  assert.equal(seen.projected.length, 1, 'el proyector se invocó más de una vez por corrida');
  assert.deepEqual(seen.projected[0], {
    persistedCandidates: 2,
    completeValidCandidates: 2,
    reviewOnlyCandidates: null,
  });
  // La misma cifra que la telemetría publica, y la misma que la acción consume.
  assert.equal(result.multiBranch?.acceptedForTargetTotal, 2);
  assert.equal(result.insertedCandidatesCount, 2);

  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.equal(block?.accepted_paid_for_target, 2);
  assert.equal(block?.persisted_paid_candidates, 2);
  // 🔴 PARIDAD: lo durable y lo que la acción devuelve son el MISMO objeto de
  // aceptación. Si alguna vez divergieran, habría dos autoridades.
  assert.deepEqual(block, toAcceptedForTargetMetadata(returned));
});

test('§ G — si la base confirmara MÁS filas que útiles, la aceptación NO las sigue', async () => {
  // 🔴 `persistedForTarget = min(insertedCount, useful.length)` existe justo para
  // esto. Con 2 empresas útiles y una base que reporta 4 filas, lo que cuenta
  // hacia el objetivo son 2: una fila de más no fabrica una empresa aceptada.
  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 0 }]);
  const { result, seen } = await runCore({
    requestedTarget: 5,
    freePersisted: 0,
    freeAccepted: 0,
    paidCompanies: 2,
    liveEpoch: 0,
    insertedOverride: 4,
    db,
  });

  assert.equal(result.insertedCandidatesCount, 4, 'la corrida no reprodujo el desajuste');
  assert.deepEqual(seen.projected[0], {
    persistedCandidates: 4,
    // 🔴 2, no 4. Sustituirlo por `insertedCount` publicaría empresas aceptadas
    // que nunca existieron.
    completeValidCandidates: 2,
    reviewOnlyCandidates: null,
  });

  const block = acceptedBlock(db.metadataOf(BATCH_ID));
  assert.equal(block?.accepted_paid_for_target, 2, 'la aceptación siguió a las filas');
  assert.equal(block?.accepted_for_target_total, 2);
  assert.equal(block?.persisted_paid_candidates, 4, 'las filas se recortaron a la aceptación');
  assert.equal(block?.target_reached, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// § H / § S — CLAVE y FORMA: paridad con Apollo/CUT-8
// ═══════════════════════════════════════════════════════════════════════════

test('§ H — la clave es la CANÓNICA, no una variante Lusha', () => {
  assert.equal(ACCEPTED_FOR_TARGET_METADATA_KEY, 'accepted_for_target');
  assert.ok(
    !ACTION_CODE.includes('lusha_accepted_for_target'),
    'apareció una segunda clave de aceptación en la ruta Lusha',
  );
  assert.ok(!CORE_CODE.includes('lusha_accepted_for_target'));
  assert.ok(!PUBLICATION_CODE.includes('lusha_accepted_for_target'));
});

test('§ S — LUSHA_ACCEPTED_METADATA_SHAPE == CANONICAL_ACCEPTED_METADATA_SHAPE', async () => {
  const CANONICAL_ACCEPTED_METADATA_SHAPE = [
    'requested_target',
    'accepted_free_for_target',
    'accepted_paid_for_target',
    'accepted_for_target_total',
    'remaining_target',
    'target_reached',
    'persisted_free_candidates',
    'persisted_paid_candidates',
    'persisted_total_candidates',
    'paid_acceptance_measured',
    'acceptance_unknown_reasons',
  ].sort();

  const db = makeDb([{ id: BATCH_ID, metadata: {}, identity_epoch: 2 }]);
  await runCore({
    requestedTarget: 5,
    freePersisted: 2,
    freeAccepted: 2,
    paidCompanies: 3,
    liveEpoch: 2,
    db,
  });
  const lushaShape = Object.keys(acceptedBlock(db.metadataOf(BATCH_ID)) ?? {}).sort();
  assert.deepEqual(lushaShape, CANONICAL_ACCEPTED_METADATA_SHAPE);

  // El proyector canónico (el que Apollo usa) produce EXACTAMENTE esa forma.
  const apolloShape = Object.keys(
    toAcceptedForTargetMetadata(
      resolveAcceptedForTarget({
        demand: fullTargetResultDemand(10),
        freePersistedCandidates: 0,
        paid: paidAcceptedContributionFromWriterTruth({
          completeValidCandidates: 6,
          persistedCandidates: 6,
        }),
      }),
    ),
  ).sort();
  assert.deepEqual(lushaShape, apolloShape, 'la forma de Lusha se separó de la canónica');
});

// ═══════════════════════════════════════════════════════════════════════════
// GUARDAS ESTRUCTURALES — el cableado y las prohibiciones
// ═══════════════════════════════════════════════════════════════════════════

test('el cableado productivo EXISTE: la acción inyecta la costura al núcleo', () => {
  assert.ok(
    /acceptedForTargetPublication:\s*\{/.test(ACTION),
    'la acción dejó de cablear la publicación durable',
  );
  assert.ok(
    ACTION.includes('resolve: resolveAcceptedForTargetBatchMetadata'),
    'la costura se cableó sin el proyector canónico',
  );
  assert.ok(
    ACTION_CODE.includes('publishFencedBatchMetadata('),
    'la acción dejó de usar el escritor vallado',
  );
  // 🔴 El régimen lo DECIDE la evidencia, no un literal. Un `plan` escrito a mano
  // en la acción es exactamente cómo se cuela una escritura sin valla sin que el
  // esquema tenga nada que ver.
  assert.ok(
    /plan: decideBatchMetadataFencePlan\(\{ epochAfterWrite, evidence \}\)/.test(ACTION_CODE),
    'el régimen de la publicación dejó de derivarse de la evidencia',
  );
  assert.ok(
    !/plan: \{/.test(ACTION_CODE),
    'la acción pasa un régimen de escritura literal en vez de decidirlo',
  );
  assert.ok(
    CORE.includes('deps.acceptedForTargetPublication'),
    'el núcleo dejó de invocar la publicación durable',
  );
});

test('el proyector sale del helper ÚNICO de aceptación, no de una segunda llamada', () => {
  // Una sola construcción del proyector, y por dentro `resolveRunAcceptance`.
  const declarations = ACTION.match(/const resolveAcceptedForTargetBatchMetadata/g) ?? [];
  assert.equal(declarations.length, 1, 'apareció una segunda construcción del proyector');
  const body = ACTION_CODE.slice(
    ACTION_CODE.indexOf('const resolveAcceptedForTargetBatchMetadata'),
  );
  // El proyector termina en su propio `});`: cortar en cualquier otra cosa
  // arrastraría el código siguiente y la guarda dejaría de decir nada.
  const projector = body.slice(0, body.indexOf('\n  });') + '\n  });'.length);
  assert.ok(
    projector.includes('resolveRunAcceptance('),
    'el proyector dejó de consumir el helper único de la corrida',
  );
  assert.ok(
    projector.includes('toAcceptedForTargetMetadata('),
    'el proyector dejó de usar el serializador canónico',
  );
  // 🔴 Nada de aritmética en el sitio de la escritura.
  assert.ok(
    !/Math\.min|Math\.max|>=|<=|\+ *accepted|accepted[A-Za-z]* *\+/.test(projector),
    'apareció aritmética de aceptación en el sitio de la publicación',
  );
  // 🔴 UNA clave, y es la canónica. El proyector de la acción es el que de verdad
  // corre en producción, así que la propiedad «una sola clave» tiene que afirmarse
  // SOBRE ÉL y no sólo sobre una construcción equivalente de la prueba.
  const emittedKeys = projector.match(/^\s{4}[[A-Za-z_'][^:\n]*:/gm) ?? [];
  assert.deepEqual(
    emittedKeys.map((k) => k.trim()),
    ['[ACCEPTED_FOR_TARGET_METADATA_KEY]:'],
    'el proyector de la acción emite una clave que no es la canónica',
  );
  // 🔴 § L — el `null` de «no medido» viaja TAL CUAL. Un `??` o un `||` aquí lo
  // sustituiría por las filas, que es la mentira exacta que CUT-7 cerró: afirmaría
  // que todo lo escrito cuenta hacia el objetivo sin que nadie lo haya medido.
  assert.ok(
    projector.includes('completeValidCandidates: writerOutcome.completeValidCandidates,'),
    'el proyector dejó de pasar la medición TAL CUAL',
  );
  assert.ok(
    !/completeValidCandidates:[^,\n]*(\?\?|\|\|)/.test(projector),
    'el proyector sustituye un «no medido» por las filas persistidas',
  );
  for (const forbidden of ['adaptive_discovery', 'result_status', 'remaining_to_target']) {
    assert.ok(
      !projector.includes(forbidden),
      `el proyector recuperó \`${forbidden}\`: CUT-8 separó esas dos verdades`,
    );
  }
});

test('NO hay escritura CIEGA de metadata en la ruta Lusha', () => {
  // Ninguna de las dos capas de Lusha escribe `metadata` por su cuenta.
  assert.ok(
    !/\.from\('prospect_batches'\)[\s\S]{0,200}?\.update\(/.test(ACTION),
    'la acción abrió una escritura propia sobre prospect_batches',
  );
  // El núcleo sigue sin I/O.
  assert.ok(
    !CORE.includes(".from('prospect_batches')"),
    'el núcleo de Lusha adquirió I/O propio sobre prospect_batches',
  );
  // El único escritor pasa por el plan, y el plan es el que decide la valla.
  assert.ok(
    PUBLICATION.includes("input.plan.mode === 'fenced'"),
    'el escritor dejó de distinguir el régimen vallado',
  );
  assert.ok(
    PUBLICATION.includes('BATCH_IDENTITY_EPOCH_COLUMN, input.plan.expectedEpoch'),
    'el CAS sobre identity_epoch desapareció',
  );
});

test('NO se busca lote por recencia ni por heurística', () => {
  for (const [name, src] of [
    ['publication', PUBLICATION_CODE],
    ['action', ACTION_CODE],
    ['core', CORE_CODE],
  ] as const) {
    assert.ok(!/created_at.*desc/i.test(src), `${name}: apareció una adopción por recencia`);
    assert.ok(!/order\(/i.test(src) || name !== 'publication', `${name}: el escritor ordena filas`);
    assert.ok(!/\blimit\(1\)/.test(src), `${name}: apareció un «último lote»`);
  }
  // El escritor sólo sabe escribir donde le dicen.
  assert.ok(PUBLICATION.includes("eq('id', input.batchId)"));
});

test('CUT9B no añade migraciones y no toca el estado de migración', () => {
  assert.ok(!PUBLICATION.includes('CREATE '), 'el módulo de publicación trae DDL');
  assert.ok(
    !/supabase\/migrations/.test(PUBLICATION + ACTION + CORE),
    'alguna capa empezó a referirse a archivos de migración',
  );
});

test('la publicación NO puede tumbar una corrida pagada', () => {
  // El núcleo la envuelve, y el desenlace es un valor, no una excepción.
  const idx = CORE.indexOf('let acceptedForTargetPublication');
  assert.ok(idx > 0, 'desapareció la publicación del núcleo');
  const region = CORE.slice(idx, idx + 2200);
  assert.ok(region.includes('try {') && region.includes('} catch {'), 'la publicación puede lanzar');
  assert.ok(
    region.includes("status: 'failed'"),
    'un fallo de publicación dejó de tener nombre',
  );
  assert.ok(!/throw /.test(region), 'la publicación lanza');
});

test('la costura viaja ENTERA: no existe proyector sin escritor ni escritor sin proyector', () => {
  // Un único campo opcional con las dos mitades dentro.
  assert.ok(
    /acceptedForTargetPublication\?: \{\s*\n\s*resolve: ResolveExtraBatchMetadata;/.test(CORE),
    'las dos mitades de la costura dejaron de viajar juntas',
  );
  assert.ok(
    !/resolveExtraBatchMetadata\?:/.test(CORE),
    'apareció un proyector suelto, separable de su escritor',
  );
});

test('§ M — la publicación durable añade UNA clave y sólo una', () => {
  const run = makeRun({ requestedTarget: 5, freePersisted: 2, freeAccepted: 2 });
  const published = run.project({
    persistedCandidates: 3,
    completeValidCandidates: 3,
    reviewOnlyCandidates: null,
  });
  // 🔴 Ni una segunda clave de aceptación, ni un veredicto de descubrimiento
  // reconstruido desde las filas. CUT-8 separó las dos verdades y CUT9B no las
  // vuelve a mezclar.
  assert.deepEqual(Object.keys(published ?? {}), [ACCEPTED_FOR_TARGET_METADATA_KEY]);
});

test('§ M — adaptive_discovery NO recupera un veredicto por filas', () => {
  assert.ok(!PUBLICATION_CODE.includes('adaptive_discovery'));
  const idx = CORE_CODE.indexOf('let acceptedForTargetPublication');
  const region = CORE_CODE.slice(idx, idx + 2200);
  assert.ok(!region.includes('adaptive_discovery'));
  assert.ok(!region.includes('result_status'));
  assert.ok(!region.includes('remaining_to_target'));
});
