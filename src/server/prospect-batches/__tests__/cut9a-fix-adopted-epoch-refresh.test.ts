/**
 * CUT9A-FIX-ADOPTED-EPOCH-REFRESH — la época del lote adoptado se RELEE.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `createCanonicalLushaBatchResolver` memoiza el objeto ENTERO de la reserva:
 *
 *     { id, adopted, identityEpoch }
 *
 * En la ruta productiva la capa GRATUITA materializa el lote primero, así que
 * queda memoizado `{ id: X, adopted: false, identityEpoch: 0 }`. Después la capa
 * gratuita escribe sus candidatos por la valla y sube la época del lote X a N.
 * Cuando la mitad de PAGO pide el lote, `resolve()` devuelve la reserva memoizada
 * —sin tocar la base, que es justo su propósito— y con ella el `identityEpoch: 0`
 * ya CADUCO. La derivación anterior:
 *
 *     expectedEpoch = reservation.adopted
 *       ? reservation.identityEpoch
 *       : LUSHA_FRESH_BATCH_IDENTITY_EPOCH
 *
 * producía 0 por las DOS ramas, la valla respondía `stale` —correctamente— y la
 * corrida ENTERA lanzaba DESPUÉS de haber pagado al proveedor.
 *
 * 🔴 `adopted` no es autoridad temporal. `adopted: false` significa «esta llamada
 * creó la fila», NO «la fila sigue en la época 0»: en esta ruta las dos cosas son
 * simultáneamente ciertas, y ahí se rompía el literal fresco.
 *
 * ── El contrato ─────────────────────────────────────────────────────────────
 *
 *     identidad canónica del lote  → PUEDE seguir memoizada
 *     época de identidad           → NO es verdad final memoizada
 *
 * La valla NO se debilita: el `stale` que desaparece es el FALSO. Una carrera REAL
 * —otro escritor legítimo avanza la época entre la relectura y el INSERT— sigue
 * dando `stale` y sigue fallando CERRADO.
 *
 * Cero Supabase, cero proveedor, cero créditos: dobles locales en todo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createCanonicalLushaBatchResolver,
  reserveOrReturnLushaCanonicalBatch,
  type LushaCanonicalBatchDbClient,
  type LushaCanonicalBatchDescription,
  type LushaCanonicalBatchIdentity,
} from '../lusha-canonical-batch';
import {
  LUSHA_FRESH_BATCH_IDENTITY_EPOCH,
  LUSHA_PENDING_REVIEW_BATCH_ADOPTION_SUPPORTED,
  LUSHA_PENDING_REVIEW_BATCH_SOURCE,
  LUSHA_PENDING_REVIEW_BATCH_STATUS,
  type LushaPendingReviewBatchRow,
} from '../lusha-pending-review';
import { LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED } from '../lusha-pending-review-limits';
import {
  isProvenFenceCapabilityAbsent,
  type FenceCapabilityEvidence,
} from '../batch-identity-fenced-persistence';
// 🔴 V9A.1-RUNTIME — el escritor REAL, no una derivación espejo. Ver la cabecera
// de la prueba: sin esto, la línea que este corte cambia no se EJECUTA en ningún
// sitio con una época viva.
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewCandidateRow,
} from '../lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '../lusha-preview';
import type { DuplicateCheckInput, DuplicateCheckResult } from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

const ROOT = process.cwd();
const USER = 'user-1';
const REQ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUESTED_TARGET = 5;

function description(): LushaCanonicalBatchDescription {
  return {
    name: 'Búsqueda con IA · health_pharma · Colombia',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'health_pharma',
    search_depth: 'standard',
    status: LUSHA_PENDING_REVIEW_BATCH_STATUS,
    source: LUSHA_PENDING_REVIEW_BATCH_SOURCE,
    metadata: { provider: 'lusha' },
  };
}

function identity(clientRequestId: string): LushaCanonicalBatchIdentity {
  return {
    createdByUserId: USER,
    clientRequestId,
    requestedTarget: REQUESTED_TARGET,
    defaults: description(),
  };
}

/**
 * Base con índice único REAL sobre `(created_by, client_request_id)` y época
 * MUTABLE — la valla la avanza, igual que la transacción de la 126.
 */
function makeDb() {
  const rows = new Map<string, { id: string; identity_epoch: number }>();
  const inserts: LushaPendingReviewBatchRow[] = [];
  const epochReads: string[] = [];
  let seq = 0;

  const db: LushaCanonicalBatchDbClient = {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const typed = row as unknown as LushaPendingReviewBatchRow;
            inserts.push(typed);
            const key = `${typed.created_by}::${typed.client_request_id}`;
            if (rows.has(key)) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            seq += 1;
            const created = { id: `batch-${seq}`, identity_epoch: 0 };
            rows.set(key, created);
            return { data: { id: created.id }, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_c1: string, createdBy: string) => ({
          eq: (_c2: string, clientRequestId: string) => ({
            single: async () => {
              const found = rows.get(`${createdBy}::${clientRequestId}`);
              return found
                ? { data: found, error: null }
                : { data: null, error: { message: 'not found' } };
            },
          }),
        }),
      }),
    }),
  };

  const find = (batchId: string) => [...rows.values()].find((r) => r.id === batchId) ?? null;

  return {
    db,
    insertAttempts: () => inserts.length,
    batchRowCount: () => rows.size,
    epochReads: () => epochReads,
    epochOf: (batchId: string) => find(batchId)?.identity_epoch ?? null,
    /** La LECTURA ACTUAL que la mitad de pago hace antes de escribir. */
    readEpoch: async (batchId: string): Promise<FenceCapabilityEvidence> => {
      epochReads.push(batchId);
      const row = find(batchId);
      return row === null
        ? { epoch: null, fenceCapabilityAbsent: false, degraded: true }
        : { epoch: row.identity_epoch, fenceCapabilityAbsent: false, degraded: false };
    },
    /** La valla: escribe SÓLO si la época declarada coincide, y la avanza. */
    fence: (batchId: string, expectedEpoch: number, written: number) => {
      const row = find(batchId);
      if (row === null) return { status: 'batch_not_found' as const };
      if (row.identity_epoch !== expectedEpoch) {
        return { status: 'stale' as const, currentEpoch: row.identity_epoch };
      }
      row.identity_epoch += written;
      return { status: 'inserted' as const, insertedCount: written, nextEpoch: row.identity_epoch };
    },
  };
}

type Db = ReturnType<typeof makeDb>;

function makeResolver(clientRequestId: string, fake: Db) {
  return createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(clientRequestId),
  );
}

/**
 * La derivación de época tal como el núcleo la hace ahora: lectura ACTUAL, y un
 * `null` que sólo se tolera cuando la ausencia de la valla está PROBADA.
 */
function deriveExpectedEpoch(evidence: FenceCapabilityEvidence): number {
  if (evidence.epoch === null && !isProvenFenceCapabilityAbsent(evidence)) {
    throw new Error('No se pudieron crear los candidatos: fence_snapshot_unavailable');
  }
  return evidence.epoch ?? LUSHA_FRESH_BATCH_IDENTITY_EPOCH;
}

/** La secuencia PRODUCTIVA: gratuita materializa y escribe, pago adopta y escribe. */
async function runFreeThenPaid(options: { freeWrites: number; paidWrites: number }) {
  const fake = makeDb();
  const resolver = makeResolver(REQ_A, fake);

  // STEP 1/2 — la mitad GRATUITA materializa/adopta el lote canónico.
  const free = await resolver.resolve();
  const initialEpoch = fake.epochOf(free.id);

  // STEP 3 — la mitad GRATUITA escribe sus candidatos por la valla.
  const freeWrite =
    options.freeWrites > 0
      ? fake.fence(free.id, initialEpoch as number, options.freeWrites)
      : { status: 'inserted' as const, insertedCount: 0, nextEpoch: initialEpoch as number };
  const postFreeEpoch = fake.epochOf(free.id);

  // STEP 4 — la mitad de PAGO pide el MISMO lote y RELEE la época.
  const paid = await resolver.resolve(description());
  const evidence = await fake.readEpoch(paid.id);
  const expectedEpoch = deriveExpectedEpoch(evidence);

  // STEP 5 — escritura VALLADA de pago.
  const paidWrite = fake.fence(paid.id, expectedEpoch, options.paidWrites);

  return { fake, free, paid, initialEpoch, freeWrite, postFreeEpoch, evidence, expectedEpoch, paidWrite };
}

// ═══════════════════════════════════════════════════════════════════════════
// V9A.1 — la prueba PRODUCTIVA: gratuita escribe, pago adopta sin `stale` falso
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.1 — FREE escribe y avanza la época; PAID adopta el MISMO lote y NO ve `stale`', async () => {
  const r = await runFreeThenPaid({ freeWrites: 3, paidWrites: 2 });

  // La secuencia es la del defecto, exactamente.
  assert.equal(r.initialEpoch, 0, 'el lote canónico no nació en la época 0');
  assert.equal(r.freeWrite.status, 'inserted');
  assert.equal(r.postFreeEpoch, 3, 'la capa gratuita no avanzó la época al escribir');

  // La IDENTIDAD sigue siendo la misma, y sigue memoizada.
  assert.equal(r.paid.id, r.free.id, 'la mitad de pago se fue a otro lote');
  assert.equal(r.fake.insertAttempts(), 1, 'apareció un segundo INSERT canónico');
  assert.equal(r.fake.batchRowCount(), 1, 'una ejecución dejó más de un lote');

  // 🔴 Lo que el defecto rompía: la época que llega a la mitad de pago.
  assert.equal(
    r.paid.identityEpoch,
    0,
    'la reserva memoizada ya no devuelve la época del nacimiento: la prueba dejó de cubrir el defecto',
  );
  assert.equal(r.evidence.epoch, 3, 'la relectura no devolvió la época ACTUAL del lote');
  assert.equal(r.expectedEpoch, 3, 'la escritura de pago volvió a declarar una época caduca');
  assert.equal(r.expectedEpoch, r.postFreeEpoch);

  // Y por tanto la escritura de pago ENTRA.
  assert.notEqual(r.paidWrite.status, 'stale', 'reapareció el `stale` FALSO de V9A.1');
  assert.equal(r.paidWrite.status, 'inserted', 'la mitad de pago no pudo escribir');
  assert.equal(r.fake.epochOf(r.paid.id), 5, 'la valla no avanzó la época tras la escritura de pago');

  // 🔴 REANCLADO por AGENT1-LOCAL-CUT9 § 17 — antes exigía que el hueco parcial
  // siguiera apagado. Lo que este arreglo promete es la ADOPCIÓN con época fresca,
  // y esa propiedad tiene que sostenerse con la activación de CUT-9 encendida: es
  // precisamente la ruta que la usa.
  assert.equal(typeof LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED, 'boolean');
  assert.equal(LUSHA_PENDING_REVIEW_BATCH_ADOPTION_SUPPORTED, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// V9A.2 — la época pre-gratuita SIGUE siendo `stale`: la valla no se debilita
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.2 — declarar la época 0 sobre un lote en la época 3 SIGUE dando `stale`', async () => {
  const fake = makeDb();
  const resolver = makeResolver(REQ_A, fake);
  const free = await resolver.resolve();
  fake.fence(free.id, 0, 3);
  assert.equal(fake.epochOf(free.id), 3);

  // La época CADUCA —la que el defecto mandaba— tiene que seguir rebotando.
  const stale = fake.fence(free.id, LUSHA_FRESH_BATCH_IDENTITY_EPOCH, 2);
  assert.equal(stale.status, 'stale', 'la valla aceptó una época caduca: el arreglo la debilitó');
  assert.equal(stale.status === 'stale' ? stale.currentEpoch : null, 3);
  // Y no escribió nada.
  assert.equal(fake.epochOf(free.id), 3, 'un `stale` avanzó la época');
});

// ═══════════════════════════════════════════════════════════════════════════
// V9A.3 — época fresca positiva
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.3 — expectedEpoch 3 sobre época real 3: mismo lote, sin `stale`, la época avanza', async () => {
  const r = await runFreeThenPaid({ freeWrites: 3, paidWrites: 2 });
  assert.equal(r.paid.id, r.free.id, 'sameBatch');
  assert.equal(r.expectedEpoch, 3);
  assert.notEqual(r.paidWrite.status, 'stale');
  assert.equal(r.paidWrite.status, 'inserted');
  // Avanza según la semántica de valla EXISTENTE (una por fila escrita); este
  // arreglo no redefine cuánto avanza.
  assert.equal(r.paidWrite.status === 'inserted' ? r.paidWrite.nextEpoch : null, 5);
});

// ═══════════════════════════════════════════════════════════════════════════
// V9A.4 — sin mutación intermedia la época NO se infla
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.4 — sin escritura gratuita, la relectura devuelve 0 y la de pago entra', async () => {
  const r = await runFreeThenPaid({ freeWrites: 0, paidWrites: 2 });
  assert.equal(r.initialEpoch, 0);
  assert.equal(r.postFreeEpoch, 0, 'se avanzó la época sin que nadie escribiera');
  assert.equal(r.evidence.epoch, 0, 'la relectura inventó una época');
  assert.equal(r.expectedEpoch, 0, 'la relectura infló la época de un lote intacto');
  assert.equal(r.paidWrite.status, 'inserted');
  assert.equal(r.fake.insertAttempts(), 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// V9A.5 — la carrera REAL sigue viva
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.5 — un escritor legítimo que avanza la época TRAS la relectura sigue dando `stale`', async () => {
  const fake = makeDb();
  const resolver = makeResolver(REQ_A, fake);
  const free = await resolver.resolve();
  fake.fence(free.id, 0, 3);

  // La mitad de pago relee: 3.
  const paid = await resolver.resolve(description());
  const expectedEpoch = deriveExpectedEpoch(await fake.readEpoch(paid.id));
  assert.equal(expectedEpoch, 3, 'freshReadEpoch');

  // 🔴 Entre la relectura y el INSERT, OTRO escritor legítimo avanza 3 → 4.
  const competing = fake.fence(paid.id, 3, 1);
  assert.equal(competing.status, 'inserted');
  assert.equal(fake.epochOf(paid.id), 4, 'epochAfterCompetingWriter');

  // La escritura de pago llega con la época que leyó, y DEBE rebotar.
  const paidWrite = fake.fence(paid.id, expectedEpoch, 2);
  assert.equal(paidWrite.status, 'stale', 'el arreglo eliminó una carrera REAL');
  assert.equal(paidWrite.status === 'stale' ? paidWrite.currentEpoch : null, 4);
  assert.equal(fake.epochOf(paid.id), 4, 'una escritura caduca entró de todos modos');
});

test('V9A.5b — una lectura AVERIADA no se degrada a la época 0: falla CERRADO', async () => {
  const degraded: FenceCapabilityEvidence = {
    epoch: null,
    fenceCapabilityAbsent: false,
    degraded: true,
  };
  assert.equal(isProvenFenceCapabilityAbsent(degraded), false);
  assert.throws(
    () => deriveExpectedEpoch(degraded),
    /fence_snapshot_unavailable/,
    'un `null` de avería pasó por época 0 y habría escrito sin valla real',
  );

  // Y el único `null` que SÍ puede seguir es el que la BASE prueba.
  const provenAbsent: FenceCapabilityEvidence = {
    epoch: null,
    fenceCapabilityAbsent: true,
    degraded: false,
  };
  assert.equal(isProvenFenceCapabilityAbsent(provenAbsent), true);
  assert.equal(deriveExpectedEpoch(provenAbsent), LUSHA_FRESH_BATCH_IDENTITY_EPOCH);
});

// ═══════════════════════════════════════════════════════════════════════════
// V9A.6 — UNA sola materialización en la ruta normal
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.6 — free resolve + paid resolve ⇒ 1 fila de lote y 1 intento de INSERT', async () => {
  const fake = makeDb();
  const resolver = makeResolver(REQ_A, fake);

  const free = await resolver.resolve();
  fake.fence(free.id, 0, 3);
  const paid = await resolver.resolve(description());

  assert.equal(paid.id, free.id);
  assert.equal(fake.batchRowCount(), 1, 'batch rows ≠ 1');
  assert.equal(
    fake.insertAttempts(),
    1,
    'se usó un SEGUNDO INSERT para refrescar la época: el 23505 no es el protocolo normal',
  );

  // La relectura de época es una LECTURA: no materializa nada.
  await fake.readEpoch(paid.id);
  assert.equal(fake.insertAttempts(), 1, 'la relectura de época provocó un INSERT');
  assert.equal(fake.batchRowCount(), 1);
});

test('V9A.6b — la relectura de época NO desmemoiza la identidad del lote', async () => {
  const fake = makeDb();
  const resolver = makeResolver(REQ_A, fake);
  const first = await resolver.resolve();
  fake.fence(first.id, 0, 3);

  // Varias llamadas más, con y sin contribución: siempre el MISMO lote, un INSERT.
  const again = await resolver.resolve(description());
  const andAgain = await resolver.resolve();
  assert.equal(again.id, first.id);
  assert.equal(andAgain.id, first.id);
  assert.equal(fake.insertAttempts(), 1);
  assert.equal(resolver.isMaterialized(), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// V9A.7 — paid-first, y NADA de adopción entre ejecuciones
// ═══════════════════════════════════════════════════════════════════════════

test('V9A.7 — PAID primero, FREE después: mismo lote, y la época se relee igual', async () => {
  const fake = makeDb();
  const resolver = makeResolver(REQ_A, fake);

  const paid = await resolver.resolve(description());
  const expectedEpoch = deriveExpectedEpoch(await fake.readEpoch(paid.id));
  assert.equal(expectedEpoch, 0, 'un lote recién creado no llegó con la época fresca');
  const paidWrite = fake.fence(paid.id, expectedEpoch, 2);
  assert.equal(paidWrite.status, 'inserted');

  const free = await resolver.resolve();
  assert.equal(free.id, paid.id, 'sameBatch');
  assert.equal(fake.insertAttempts(), 1);
  assert.equal(fake.batchRowCount(), 1);
});

test('V9A.7b · NEGATIVE_P — la época se lee del lote de ESTA ejecución, no de otra', async () => {
  const fake = makeDb();

  // Ejecución A escribe y queda en la época 3.
  const a = makeResolver(REQ_A, fake);
  const batchA = await a.resolve();
  fake.fence(batchA.id, 0, 3);

  // Ejecución B (nuevo clic ⇒ nuevo clientRequestId) estrena lote: OPTION_A.
  const b = makeResolver(REQ_B, fake);
  const batchB = await b.resolve(description());
  assert.notEqual(batchB.id, batchA.id, 'una ejecución adoptó el lote de otra');

  // 🔴 La relectura de B devuelve la época de B, NO la de A.
  const evidenceB = await fake.readEpoch(batchB.id);
  assert.equal(evidenceB.epoch, 0, 'la época se leyó de otro lote');
  assert.notEqual(evidenceB.epoch, fake.epochOf(batchA.id));

  // Y escribir en B con la época de A rebota.
  assert.equal(fake.fence(batchB.id, 3, 1).status, 'stale');
  assert.equal(deriveExpectedEpoch(evidenceB), 0);
  assert.equal(fake.fence(batchB.id, 0, 1).status, 'inserted');
});

// ═══════════════════════════════════════════════════════════════════════════
// Guardas ESTRUCTURALES — las mutaciones negativas no pueden volver en silencio
// ═══════════════════════════════════════════════════════════════════════════

const CORE_PATH = 'src/server/prospect-batches/lusha-pending-review.ts';
const WIRING_PATH = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

/** Sólo el cuerpo EJECUTABLE: las cabeceras NOMBRAN lo prohibido para prohibirlo. */
function executableBody(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('NEGATIVE_K / NEGATIVE_L — `expectedEpoch` NO puede volver a salir de la reserva', () => {
  const body = executableBody(CORE_PATH);
  assert.match(
    body,
    /const epochEvidence = await deps\.readBatchIdentityEpoch\(batchId\)/,
    'desapareció la LECTURA ACTUAL de la época (NEGATIVE_M)',
  );
  assert.match(body, /expectedEpoch: epochEvidence\.epoch \?\? LUSHA_FRESH_BATCH_IDENTITY_EPOCH/);

  // K — la época memoizada de la reserva.
  assert.equal(
    /expectedEpoch:\s*reservation\.identityEpoch/.test(body),
    false,
    'NEGATIVE_K: la época volvió a consumirse de la reserva memoizada',
  );
  // L — el literal fresco gobernado por `adopted`.
  assert.equal(
    /expectedEpoch:\s*reservation\.adopted/.test(body),
    false,
    'NEGATIVE_L: `adopted` volvió a decidir la época',
  );
  // Y `adopted` no puede gobernar la época por ninguna otra vía en el escritor.
  assert.equal(
    /reservation\.adopted\s*\n?\s*\?\s*reservation\.identityEpoch/.test(body),
    false,
    'NEGATIVE_L: reapareció el ternario de `adopted` sobre la época',
  );
});

test('NEGATIVE_M — la dependencia de relectura es OBLIGATORIA: el `?` no puede volver', () => {
  const core = read(CORE_PATH);
  assert.match(
    core,
    /\n\s*readBatchIdentityEpoch: \(batchId: string\) => Promise<FenceCapabilityEvidence>;/,
    'la relectura de época dejó de estar declarada como dependencia obligatoria',
  );
  assert.equal(
    core.includes('readBatchIdentityEpoch?'),
    false,
    'la relectura de época se volvió opcional: su ausencia no puede autorizar nada',
  );
  const body = executableBody(CORE_PATH);
  assert.equal(
    body.includes('deps.readBatchIdentityEpoch?.('),
    false,
    'la relectura se invoca con `?.`: eso la vuelve omitible de hecho',
  );
});

test('NEGATIVE_N — la valla NO se debilita: un `null` de avería falla CERRADO', () => {
  const body = executableBody(CORE_PATH);
  assert.match(
    body,
    /if \(epochEvidence\.epoch === null && !isProvenFenceCapabilityAbsent\(epochEvidence\)\)/,
    'desapareció el fallo CERRADO ante una época que no se pudo establecer',
  );
  assert.match(body, /fence_snapshot_unavailable/);
  // La conjunción se REUTILIZA; no se reescribe una más débil aquí.
  assert.equal(
    /fenceCapabilityAbsent\s*===\s*true/.test(body),
    false,
    'se reescribió la conjunción de ausencia probada en vez de reutilizarla',
  );
  // `stale` sigue LANZANDO, no degradando a una escritura sin valla.
  assert.match(body, /throw new Error\(`No se pudieron crear los candidatos: fence_\$\{fenced\.status\}`\)/);
});

test('NEGATIVE_O — el 23505 NO es el protocolo normal para refrescar la época', () => {
  const resolver = executableBody('src/server/prospect-batches/lusha-canonical-batch.ts');
  // La memoización de IDENTIDAD sigue en pie: sin ella cada `resolve()` intentaría
  // un INSERT y el 23505 pasaría a ser la vía normal de refresco.
  assert.match(
    resolver,
    /if \(settled !== null\) return settled/,
    'se eliminó la memoización de identidad: el segundo INSERT pasaría a ser normal',
  );
  assert.match(resolver, /if \(inFlight !== null\) return inFlight/);

  // Y el escritor no relee la época por la vía del lote, sino por la dependencia.
  const core = executableBody(CORE_PATH);
  assert.equal(
    /from\('prospect_batches'\)/.test(core),
    false,
    'el núcleo abrió una consulta propia a `prospect_batches`',
  );
});

test('NEGATIVE_P — la autoridad de relectura es la foto canónica de CUT-3B4, no una consulta ad-hoc', () => {
  const wiring = read(WIRING_PATH);
  assert.match(
    wiring,
    /readBatchIdentityEpoch: \(batchId: string\) =>\s*\n?\s*loadBatchIdentityRegistry\(supabase, batchId\)/,
    'la relectura de época dejó de usar la autoridad canónica de identidad de lote',
  );
  // 🔴 Sin lectura Lusha ad-hoc de `identity_epoch`.
  const wiringBody = executableBody(WIRING_PATH);
  assert.equal(
    /select\((['"`]).*identity_epoch.*\1\)/.test(wiringBody),
    false,
    'apareció una consulta ad-hoc a `prospect_batches.identity_epoch`',
  );
  // Y la relectura se hace con el batchId resuelto, no con otra identidad.
  const core = executableBody(CORE_PATH);
  assert.match(core, /deps\.readBatchIdentityEpoch\(batchId\)/);
  assert.equal(
    /readBatchIdentityEpoch\((?!batchId\))/.test(core),
    false,
    'la relectura se hizo sobre un lote que no es el canónico de esta ejecución',
  );
});

test('la relectura ocurre ANTES de la escritura vallada, y DESPUÉS de resolver el lote', () => {
  const core = read(CORE_PATH);
  const reserve = core.indexOf('const reservation = await deps.reserveBatch(');
  const readEpoch = core.indexOf('const epochEvidence = await deps.readBatchIdentityEpoch(batchId)');
  const fenced = core.indexOf('const fenced = await deps.insertCandidatesFenced({');
  assert.ok(reserve > 0 && readEpoch > 0 && fenced > 0, 'no se encontraron los tres puntos');
  assert.ok(reserve < readEpoch, 'la época se lee antes de saber cuál es el lote');
  assert.ok(readEpoch < fenced, 'la época se lee DESPUÉS de escribir: no sirve de nada');
});

test('CUT9A-FIX no añade migraciones ni columnas', () => {
  const core = read(CORE_PATH);
  const wiring = read(WIRING_PATH);
  for (const [label, source] of [['core', core], ['wiring', wiring]] as const) {
    assert.equal(
      /alter table|ALTER TABLE|create or replace function/i.test(source),
      false,
      `${label} introdujo DDL`,
    );
  }
  // 🔴 REANCLADO por AGENT1-LOCAL-CUT9 § 17: lo que este caso defiende es la
  // ausencia de DDL, no el valor de una bandera de producto.
  assert.equal(typeof LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED, 'boolean');
});


// ═══════════════════════════════════════════════════════════════════════════
// V9A.1-RUNTIME — el escritor REAL escribe con la época VIVA que releyó
//
// 🔴 Por qué existe, y por qué no bastaba lo de arriba: TODAS las suites que
// ejecutan `persistLushaPendingReviewBatch` le inyectan `preM126BatchEpochSnapshot`
// —la 126 sin aplicar—, así que la rama viva de la línea que este corte cambia
// (`expectedEpoch: epochEvidence.epoch`, con época NO nula) no la ejecutaba nadie:
// quedaba sostenida sólo por guardas estáticas y por la derivación espejo de esta
// misma suite. Una derivación espejo puede quedarse atrás sin que nada se ponga
// rojo; de hecho, bajo la mutación L el espejo seguía en verde.
//
// Aquí el núcleo REAL corre contra una valla que EXIGE la época y una lectura que
// devuelve la que la capa gratuita dejó. Si el escritor volviera a declarar la
// época memoizada, la valla respondería `stale` y esto se pondría rojo por el
// camino productivo, no por el texto del archivo.
// ═══════════════════════════════════════════════════════════════════════════

const RUNTIME_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const RUNTIME_ACTOR = {
  internalUserId: USER,
  clientRequestId: REQ_A,
  requestedTarget: REQUESTED_TARGET,
};

function runtimeCompany(): LushaPreviewCompany {
  return {
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    score: 92,
    passesGate: true,
    issues: [],
    providerCompanyId: 'pc-clinicaandes-com',
    linkedinUrl: 'https://linkedin.com/company/clinicaandes-com',
  };
}

function runtimeSearch(results: LushaPreviewCompany[]): LushaPreviewResult {
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

/** «Comprobado en las dos fuentes, y no hay duplicado» — la forma CANÓNICA. */
function runtimeNoDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

/**
 * El escritor real, con la época del lote VIVA en una base de mentira.
 *
 * `liveEpoch` es lo que la capa gratuita dejó tras escribir sus filas; la reserva,
 * en cambio, devuelve la época del NACIMIENTO (0) tal como hace el resolutor
 * memoizado en producción. Los dos números son distintos A PROPÓSITO: ahí vivía el
 * defecto.
 */
async function runRealWriterWithLiveEpoch(liveEpoch: number) {
  const seen = { fencedEpochs: [] as number[], unfencedWrites: 0, batches: 0 };
  let epochNow = liveEpoch;

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input: LushaPreviewInput & { page?: number }) =>
      (input.page ?? 0) > 0 ? runtimeSearch([]) : runtimeSearch([runtimeCompany()]),
    reserveBatch: async () => {
      seen.batches += 1;
      // 🔴 La reserva memoizada: la época del NACIMIENTO, no la actual.
      return { id: 'batch-canonical', adopted: false, identityEpoch: 0 };
    },
    // La lectura ACTUAL — lo que la capa gratuita dejó.
    readBatchIdentityEpoch: async (): Promise<FenceCapabilityEvidence> => ({
      epoch: epochNow,
      fenceCapabilityAbsent: false,
      degraded: false,
    }),
    // La valla de verdad: sólo escribe si la época declarada es la ACTUAL.
    insertCandidatesFenced: async ({
      expectedEpoch,
      rows,
    }: {
      batchId: string;
      expectedEpoch: number;
      rows: LushaPendingReviewCandidateRow[];
    }) => {
      seen.fencedEpochs.push(expectedEpoch);
      if (expectedEpoch !== epochNow) {
        return { status: 'stale' as const, currentEpoch: epochNow };
      }
      epochNow += rows.length;
      return { status: 'inserted' as const, insertedCount: rows.length };
    },
    insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
      // Si esto corre, la escritura salió SIN valla.
      seen.unfencedWrites += 1;
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input: DuplicateCheckInput) => runtimeNoDuplicate(input),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
  } as unknown as PersistLushaPendingReviewDeps;

  const res = await persistLushaPendingReviewBatch(deps, RUNTIME_INPUT, RUNTIME_ACTOR);
  return { res, seen, epochNow };
}

test('V9A.1-RUNTIME — el escritor REAL declara la época RELEÍDA (3), no la memoizada (0)', async () => {
  const { res, seen, epochNow } = await runRealWriterWithLiveEpoch(3);

  // 🔴 Lo esencial: la época que el núcleo REAL declaró a la valla.
  assert.deepEqual(
    seen.fencedEpochs,
    [3],
    'el escritor real no declaró la época RELEÍDA: volvió la época memoizada del nacimiento',
  );
  assert.equal(res.ok, true, `la corrida de pago falló: ${res.error ?? ''}`);
  assert.equal(res.status, 'success');
  assert.equal(res.createdCandidatesCount, 1);

  // La valla avanzó desde la época viva, y NADIE escribió sin valla.
  assert.equal(epochNow, 4, 'la valla no avanzó desde la época releída');
  assert.equal(seen.unfencedWrites, 0, 'hubo una escritura de candidatos SIN valla');
  assert.equal(seen.batches, 1, 'apareció un segundo lote');
});

test('V9A.5-RUNTIME — el escritor REAL sigue fallando CERRADO ante una carrera de verdad', async () => {
  // La lectura dice 3, pero la valla ya está en 4: otro escritor legítimo se
  // coló entre la relectura y el INSERT. Esto DEBE seguir siendo `stale`.
  const seen = { unfenced: 0 };
  const deps = {
    runSearch: async (input: LushaPreviewInput & { page?: number }) =>
      (input.page ?? 0) > 0 ? runtimeSearch([]) : runtimeSearch([runtimeCompany()]),
    reserveBatch: async () => ({ id: 'batch-canonical', adopted: false, identityEpoch: 0 }),
    readBatchIdentityEpoch: async () => ({ epoch: 3, fenceCapabilityAbsent: false, degraded: false }),
    insertCandidatesFenced: async () => ({ status: 'stale' as const, currentEpoch: 4 }),
    insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
      seen.unfenced += 1;
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input: DuplicateCheckInput) => runtimeNoDuplicate(input),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
  } as unknown as PersistLushaPendingReviewDeps;

  // 🔴 Falla CERRADO LANZANDO, que es el contrato de esta ruta: no hay caída a una
  // escritura sin valla y no se reintenta en bucle. Migrar esto a
  // `runFencedPersistence` con re-evaluación es CUT-9, no este arreglo.
  await assert.rejects(
    () => persistLushaPendingReviewBatch(deps, RUNTIME_INPUT, RUNTIME_ACTOR),
    /fence_stale/,
    'una carrera REAL dejó de fallar: la valla se debilitó',
  );
  assert.equal(seen.unfenced, 0, 'el `stale` cayó a una escritura SIN valla');
});
