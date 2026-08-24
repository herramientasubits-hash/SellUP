/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 — BATCH SURVIVAL.
 *
 * P0 G2: un lote que ya contiene filas durables no puede degradarse a `failed`
 * ni a `completed` porque un contribuyente POSTERIOR inserte 0 o falle.
 *
 * Esta suite cubre los DOS caminos de estado del defecto:
 *   A. `resolveBatchStatusForPersistenceOutcome` (escritor que sí recorrió el
 *      bucle de inserción);
 *   B. `markWizardBatchFailed` (proveedor/pipeline que murió antes de escribir).
 *
 * Offline y determinista: sin Supabase, sin red, sin proveedores, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DURABLE_PROSPECT_CANDIDATE_STATUSES,
  NO_PRE_EXISTING_DURABLE_CANDIDATES,
  DURABLE_CANDIDATES_NOT_PROBED,
  durableCandidatesFromCount,
  isDurableProspectCandidateStatus,
  resolveBatchDurableTotals,
  resolveBatchTerminalStatusDecision,
  type DurableCandidateKnowledge,
} from '../batch-durable-candidates';
import { resolveBatchStatusForPersistenceOutcome } from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import {
  markWizardBatchFailed,
  WizardBatchFailureError,
  type BatchUpdateFn,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-batch-failure';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const BATCH_ID = 'batch-cut1-0000-0000-0000-000000000001';

function known(count: number): DurableCandidateKnowledge {
  return { known: true, count };
}

/** Sonda de prueba que registra a quién se le preguntó. */
function makeProbe(result: DurableCandidateKnowledge, calls: string[] = []) {
  return async (batchId: string) => {
    calls.push(batchId);
    return result;
  };
}

/** Actualizador de prueba que registra el estado escrito. */
function makeUpdate(
  writes: { id: string; status: string }[],
  error: { message?: string } | null = null,
): BatchUpdateFn {
  return async (id, status) => {
    writes.push({ id, status });
    return { error };
  };
}

// ─── § 6 — matriz del resolutor ───────────────────────────────────────────────

describe('CUT-1 § 6 — matriz de estado terminal del lote', () => {
  it('CASO A: 7 previas + 0 nuevas + 0 fallos ⇒ ready_for_review (NO completed)', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 7,
        persistedCandidates: 0,
        persistenceFailureCount: 0,
      }),
      'ready_for_review',
    );
  });

  it('CASO B: 7 previas + 0 nuevas + fallos ⇒ ready_for_review (NO failed)', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 7,
        persistedCandidates: 0,
        persistenceFailureCount: 3,
      }),
      'ready_for_review',
    );
  });

  it('CASO C: 7 previas + 3 nuevas ⇒ ready_for_review', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 7,
        persistedCandidates: 3,
        persistenceFailureCount: 0,
      }),
      'ready_for_review',
    );
  });

  it('CASO D: 0 previas + pago exitoso ⇒ ready_for_review (comportamiento previo)', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 0,
        persistedCandidates: 4,
        persistenceFailureCount: 0,
      }),
      'ready_for_review',
    );
  });

  it('CASO E: 0 previas + 0 nuevas + fallo de escritura ⇒ failed (comportamiento previo)', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 0,
        persistedCandidates: 0,
        persistenceFailureCount: 1,
      }),
      'failed',
    );
  });

  it('CASO F: 0 previas + cero limpio ⇒ completed (comportamiento previo)', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 0,
        persistedCandidates: 0,
        persistenceFailureCount: 0,
      }),
      'completed',
    );
  });

  it('los tres valores siguen perteneciendo al CHECK existente de prospect_batches.status', () => {
    const allowed = new Set([
      'draft', 'generating', 'ready_for_review',
      'in_review', 'completed', 'cancelled', 'failed',
    ]);
    for (const pre of [0, 7]) {
      for (const persisted of [0, 3]) {
        for (const failures of [0, 2]) {
          const status = resolveBatchStatusForPersistenceOutcome({
            preExistingDurableCandidates: pre,
            persistedCandidates: persisted,
            persistenceFailureCount: failures,
          });
          assert.ok(allowed.has(status), `${status} no existe en el enum de la base`);
        }
      }
    }
  });

  it('el CHECK real de la migración 040 no ha crecido un estado nuevo por detrás', () => {
    const sql = read('supabase/migrations/040_prospect_batches_foundation.sql');
    const block = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS prospect_batches'));
    const statusCheck = block.slice(block.indexOf('status'), block.indexOf('source'));
    for (const value of ['draft', 'generating', 'ready_for_review', 'in_review', 'completed', 'cancelled', 'failed']) {
      assert.ok(statusCheck.includes(`'${value}'`), `falta ${value} en el CHECK`);
    }
  });
});

// ─── § 5 — el contrato distingue las tres cantidades ──────────────────────────

describe('CUT-1 § 5 — el resolutor puede distinguir previas / nuevas / fallos', () => {
  it('`persistedCandidates` NO se reinterpretó: sigue siendo lo que insertó ESTE contribuyente', () => {
    // Si `persistedCandidates` hubiese pasado a significar «total del lote»,
    // este caso —7 previas declaradas aparte y 0 propias— no podría existir.
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 7,
        persistedCandidates: 0,
        persistenceFailureCount: 0,
      }),
      'ready_for_review',
    );
    // Y el caso inverso —lote vacío, 7 propias— resuelve igual por la otra vía.
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: 0,
        persistedCandidates: 7,
        persistenceFailureCount: 0,
      }),
      'ready_for_review',
    );
  });

  it('un valor previo ausente o basura NO fabrica supervivencia: degrada al comportamiento previo', () => {
    for (const bogus of [undefined, null, Number.NaN, -3, 'siete']) {
      const status = resolveBatchStatusForPersistenceOutcome({
        preExistingDurableCandidates: bogus as unknown as number,
        persistedCandidates: 0,
        persistenceFailureCount: 1,
      });
      assert.equal(status, 'failed', `${String(bogus)} no puede acreditar filas`);
    }
  });
});

// ─── § 8 — sin doble conteo ───────────────────────────────────────────────────

describe('CUT-1 § 8 — aritmética honesta, sin doble conteo', () => {
  it('total = previas + insertadas ahora, exactamente', () => {
    const totals = resolveBatchDurableTotals({
      preExisting: known(7),
      insertedNow: 3,
    });
    assert.deepEqual(totals, {
      preExistingDurableCandidates: 7,
      insertedByThisContributor: 3,
      totalDurableCandidates: 10,
      preExistingKnown: true,
    });
    // La aserción que revienta con doble conteo: 13 sería contar dos veces las
    // 3 filas nuevas dentro de la lectura previa.
    assert.notEqual(totals.totalDurableCandidates, 13);
    assert.equal(
      totals.totalDurableCandidates,
      totals.preExistingDurableCandidates + totals.insertedByThisContributor,
    );
  });

  it('un conteo previo desconocido no suma nada y queda declarado como desconocido', () => {
    const totals = resolveBatchDurableTotals({
      preExisting: DURABLE_CANDIDATES_NOT_PROBED,
      insertedNow: 3,
    });
    assert.equal(totals.preExistingDurableCandidates, 0);
    assert.equal(totals.totalDurableCandidates, 3);
    assert.equal(totals.preExistingKnown, false);
  });

  it('un lote nuevo declara cero CONOCIDO, no cero desconocido', () => {
    assert.deepEqual(NO_PRE_EXISTING_DURABLE_CANDIDATES, { known: true, count: 0 });
  });
});

// ─── § 3 / § 10 — criterio de fila durable y lectura imposible ────────────────

describe('CUT-1 § 3 — criterio de fila durable', () => {
  it('los siete estados del CHECK de prospect_candidates cuentan como durables', () => {
    const sql = read('supabase/migrations/040_prospect_batches_foundation.sql');
    const block = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS prospect_candidates'));
    const statusCheck = block.slice(block.indexOf("status  "), block.indexOf('review_notes'));
    for (const status of DURABLE_PROSPECT_CANDIDATE_STATUSES) {
      assert.ok(statusCheck.includes(`'${status}'`), `${status} no está en el CHECK real`);
      assert.ok(isDurableProspectCandidateStatus(status));
    }
    assert.equal(DURABLE_PROSPECT_CANDIDATE_STATUSES.length, 7);
  });

  it('la tabla no tiene ninguna columna de borrado que pudiera erasar una fila', () => {
    const sql = read('supabase/migrations/040_prospect_batches_foundation.sql');
    const block = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS prospect_candidates'),
      sql.indexOf('CREATE TABLE IF NOT EXISTS prospect_candidate_audit'),
    );
    assert.ok(!block.includes('deleted_at'));
    assert.ok(!block.includes('archived_at'));
  });

  it('un estado desconocido NO acredita contenido durable (fail-closed)', () => {
    for (const bogus of ['erased', 'purged', '', null, undefined, 7]) {
      assert.equal(isDurableProspectCandidateStatus(bogus), false, String(bogus));
    }
  });

  it('el criterio NO depende de isUsefulReviewCandidate ni de reglas de UI', () => {
    const src = read('src/server/prospect-batches/batch-durable-candidates.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['isUsefulReviewCandidate', 'tax_identifier', 'taxIdentifier', 'domain']) {
      assert.ok(!code.includes(forbidden), `el criterio no puede depender de ${forbidden}`);
    }
  });

  it('«no se pudo determinar» NO se convierte en «hay cero»', () => {
    assert.deepEqual(durableCandidatesFromCount(null), {
      known: false,
      reason: 'count_unavailable',
    });
    assert.deepEqual(durableCandidatesFromCount(undefined), {
      known: false,
      reason: 'count_unavailable',
    });
    assert.deepEqual(durableCandidatesFromCount(0), { known: true, count: 0 });
    assert.deepEqual(durableCandidatesFromCount(7), { known: true, count: 7 });
  });

  it('con el conteo previo ilegible y 0 filas propias NO se escribe estado terminal', () => {
    assert.deepEqual(
      resolveBatchTerminalStatusDecision({
        preExisting: { known: false, reason: 'read_failed' },
        persistedCandidates: 0,
        persistenceFailureCount: 2,
      }),
      { action: 'preserve', reason: 'durable_candidate_count_unavailable' },
    );
  });

  it('con el conteo previo ilegible pero filas propias, la verdad del llamador basta', () => {
    assert.deepEqual(
      resolveBatchTerminalStatusDecision({
        preExisting: { known: false, reason: 'read_failed' },
        persistedCandidates: 2,
        persistenceFailureCount: 0,
      }),
      { action: 'write', status: 'ready_for_review' },
    );
  });
});

// ─── § 9 — markWizardBatchFailed ──────────────────────────────────────────────

describe('CUT-1 § 9 — el fallo del proveedor no borra un lote con contenido', () => {
  it('proveedor falla con el lote YA con candidatos ⇒ ready_for_review, no failed', async () => {
    const writes: { id: string; status: string }[] = [];
    const outcome = await markWizardBatchFailed(
      BATCH_ID,
      'pipeline_error',
      makeUpdate(writes),
      makeProbe(known(7)),
    );
    assert.deepEqual(writes, [{ id: BATCH_ID, status: 'ready_for_review' }]);
    assert.deepEqual(outcome, { action: 'preserved_for_review', durableCandidates: 7 });
  });

  it('proveedor falla con el lote VACÍO ⇒ failed (comportamiento previo, intacto)', async () => {
    const writes: { id: string; status: string }[] = [];
    const outcome = await markWizardBatchFailed(
      BATCH_ID,
      'pipeline_error',
      makeUpdate(writes),
      makeProbe(known(0)),
    );
    assert.deepEqual(writes, [{ id: BATCH_ID, status: 'failed' }]);
    assert.deepEqual(outcome, { action: 'marked_failed' });
  });

  it('batchid_mismatch conserva su razón y sigue cerrando un lote vacío', async () => {
    const writes: { id: string; status: string }[] = [];
    await markWizardBatchFailed(
      BATCH_ID,
      'batchid_mismatch',
      makeUpdate(writes),
      makeProbe(known(0)),
    );
    assert.deepEqual(writes, [{ id: BATCH_ID, status: 'failed' }]);
  });

  it('sonda ilegible ⇒ no se escribe NINGÚN estado (§ 10)', async () => {
    const writes: { id: string; status: string }[] = [];
    const outcome = await markWizardBatchFailed(
      BATCH_ID,
      'pipeline_error',
      makeUpdate(writes),
      makeProbe({ known: false, reason: 'read_failed' }),
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(outcome, {
      action: 'left_untouched',
      reason: 'durable_candidate_count_unavailable',
    });
  });

  it('un fallo de la escritura sigue lanzando WizardBatchFailureError sin enmascarar nada', async () => {
    await assert.rejects(
      () =>
        markWizardBatchFailed(
          BATCH_ID,
          'pipeline_error',
          makeUpdate([], { message: 'boom' }),
          makeProbe(known(0)),
        ),
      (err: unknown) => {
        assert.ok(err instanceof WizardBatchFailureError);
        assert.equal(err.batchId, BATCH_ID);
        assert.equal(err.reason, 'pipeline_error');
        return true;
      },
    );
  });

  it('el estado viaja como argumento: el llamador ya no puede cablear `failed`', async () => {
    const src = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    assert.ok(
      !src.includes("update({ status: 'failed' })"),
      'el cierre por fallo no puede volver a cablear `failed` en el closure',
    );
    assert.ok(src.includes('update({ status })'));
  });
});

// ─── § 11 / § 12 — idempotencia y monotonicidad ───────────────────────────────

describe('CUT-1 § 11/§ 12 — idempotencia y monotonicidad', () => {
  it('reintento del manejador de fallo sobre un lote con 7 filas: converge en ready_for_review', async () => {
    const writes: { id: string; status: string }[] = [];
    const probe = makeProbe(known(7));
    await markWizardBatchFailed(BATCH_ID, 'pipeline_error', makeUpdate(writes), probe);
    await markWizardBatchFailed(BATCH_ID, 'pipeline_error', makeUpdate(writes), probe);
    assert.deepEqual(writes, [
      { id: BATCH_ID, status: 'ready_for_review' },
      { id: BATCH_ID, status: 'ready_for_review' },
    ]);
  });

  it('reintento sobre un lote vacío: converge en failed', async () => {
    const writes: { id: string; status: string }[] = [];
    const probe = makeProbe(known(0));
    await markWizardBatchFailed(BATCH_ID, 'pipeline_error', makeUpdate(writes), probe);
    await markWizardBatchFailed(BATCH_ID, 'pipeline_error', makeUpdate(writes), probe);
    assert.deepEqual(writes.map((w) => w.status), ['failed', 'failed']);
  });

  it('un reintento con CERO inserciones nuevas no puede degradar un lote ya superviviente', () => {
    // Primera pasada: la pata gratuita dejó 7 filas y la de pago escribió 3.
    const first = resolveBatchTerminalStatusDecision({
      preExisting: known(7),
      persistedCandidates: 3,
      persistenceFailureCount: 0,
    });
    // Reintento: ahora el lote contiene 10 y el reintento no añade nada.
    const retry = resolveBatchTerminalStatusDecision({
      preExisting: known(10),
      persistedCandidates: 0,
      persistenceFailureCount: 4,
    });
    assert.deepEqual(first, { action: 'write', status: 'ready_for_review' });
    assert.deepEqual(retry, { action: 'write', status: 'ready_for_review' });
    assert.notEqual(retry.action === 'write' ? retry.status : null, 'failed');
  });

  it('DATO DURABLE SOBREVIVE AL FALLO DE UN CONTRIBUYENTE — barrido exhaustivo', () => {
    for (const pre of [1, 2, 7, 50]) {
      for (const nuevas of [0, 1, 9]) {
        for (const fallos of [0, 1, 12]) {
          const decision = resolveBatchTerminalStatusDecision({
            preExisting: known(pre),
            persistedCandidates: nuevas,
            persistenceFailureCount: fallos,
          });
          assert.deepEqual(
            decision,
            { action: 'write', status: 'ready_for_review' },
            `pre=${pre} nuevas=${nuevas} fallos=${fallos}`,
          );
        }
      }
    }
  });

  it('el fallo del proveedor sigue siendo observable: la decisión no lo reescribe', () => {
    const src = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    // El resultado de la acción sigue reportando el fallo del pipeline tal cual.
    assert.ok(src.includes("code: 'GENERATION_FAILED'"));
    assert.ok(src.includes('El pipeline de búsqueda falló durante la ejecución.'));
  });
});

// ─── § 7 — el escritor de candidatos usa la verdad del LOTE ───────────────────

describe('CUT-1 § 7 — el escritor obtiene la verdad del lote antes de decidir', () => {
  const writerSrc = read('src/server/agents/prospecting-toolkit/candidate-writer.ts');

  it('la sonda es un conteo ACOTADO: head:true, sin payload y sin PII', () => {
    const probe = writerSrc.slice(
      writerSrc.indexOf('async function probePreExistingDurableCandidates'),
      writerSrc.indexOf('/** Resultado de persistencia de un camino que no escribió candidatos. */'),
    );
    assert.ok(probe.includes("count: \"exact\", head: true"));
    assert.ok(probe.includes('.eq("batch_id", batchId)'));
    assert.ok(probe.includes('DURABLE_PROSPECT_CANDIDATE_STATUSES'));
    // Nada de traerse filas ni columnas de negocio.
    for (const forbidden of ['name', 'tax_identifier', 'website']) {
      assert.ok(!probe.includes(`"${forbidden}"`), `la sonda no puede pedir ${forbidden}`);
    }
  });

  it('la lectura ocurre ANTES del bucle de inserción (§ 8, no hay doble conteo)', () => {
    const probeCall = writerSrc.indexOf('preExistingDurableCandidates = await probePreExistingDurableCandidates');
    const insertLoopCounter = writerSrc.indexOf('const candidatesCreated = createdCandidateIds.length;');
    assert.ok(probeCall > 0, 'la sonda tiene que invocarse');
    assert.ok(
      probeCall < insertLoopCounter,
      'la sonda tiene que leerse antes de que el escritor cuente sus propias inserciones',
    );
  });

  it('la decisión de estado ya no se toma sólo con candidatesCreated', () => {
    const decision = writerSrc.slice(
      writerSrc.indexOf('const batchStatusDecision = resolveBatchTerminalStatusDecision({'),
      writerSrc.indexOf('const batchStatusForOutcome ='),
    );
    assert.ok(decision.includes('preExisting: preExistingDurableCandidates'));
    assert.ok(decision.includes('persistedCandidates: candidatesCreated'));
  });

  it('un lote NUEVO no paga una lectura: cero conocido por construcción', () => {
    assert.ok(writerSrc.includes('NO_PRE_EXISTING_DURABLE_CANDIDATES'));
    const probeCalls = writerSrc.split('await probePreExistingDurableCandidates').length - 1;
    assert.equal(probeCalls, 1, 'la sonda sólo corre en el camino de adopción');
  });

  it('con `preserve` el escritor no escribe estado ni sella fecha de cierre', () => {
    // CUT-1 CORRECTION § 8 — este trinquete afirmaba antes la CONDICIÓN LITERAL
    // `batchStatusForOutcome !== null && batchStatusForOutcome !== "ready_for_review"`,
    // es decir, pinnaba exactamente la exclusión que hacía que `ready_for_review`
    // NO se escribiera nunca en la finalización y se heredara de la escritura
    // prematura de la adopción. Un trinquete que fija el defecto lo protege.
    //
    // Lo que se fija ahora es el contrato: las DOS escrituras de estado del
    // escritor están guardadas por `batchStatusForOutcome !== null` a secas, sin
    // excluir ningún estado terminal, y el sellado de fecha cuelga de la misma
    // condición.
    const statusGuards = writerSrc.split('if (batchStatusForOutcome !== null) {').length - 1;
    assert.equal(statusGuards, 2, 'las dos escrituras de estado se guardan por la MISMA condición');
    assert.ok(
      !writerSrc.includes('batchStatusForOutcome !== "ready_for_review"'),
      'ningún estado terminal puede quedar excluido de la escritura de estado',
    );
    assert.ok(writerSrc.includes('batchStatusForOutcome !== null\n        ? decideBatchCompletionSeal({'));
  });

  it('§ 8 — la verdad del lote se conoce ANTES de que se escriba el estado terminal', () => {
    // Trinquete de ORDEN EN LA FUENTE, complementario al de orden de escritura
    // real que vive en la suite del escritor. Ninguno de los dos depende de un
    // comentario.
    // CUT-2 re-ancla este trinquete SIN debilitarlo: la UPDATE de adopción ya no
    // es un objeto literal en línea (ahora la construye `resolveAdoptedBatchPatch`,
    // que es justo el punto de CUT-2), así que el ancla es el punto donde se
    // construye el PATCH. Las tres afirmaciones que importan —existe, precede a
    // la sonda, y no lleva `status`— se comprueban igual sobre la forma nueva.
    const adoptionUpdate = writerSrc.indexOf(
      'const adoptedBatchTruth = resolveAdoptedBatchPatch({',
    );
    const probeCall = writerSrc.indexOf(
      'preExistingDurableCandidates = await probePreExistingDurableCandidates',
    );
    const decision = writerSrc.indexOf(
      'const batchStatusDecision = resolveBatchTerminalStatusDecision({',
    );
    const firstStatusWrite = writerSrc.indexOf('if (batchStatusForOutcome !== null) {');

    assert.ok(adoptionUpdate > 0, 'la UPDATE de adopción tiene que existir');
    assert.ok(
      writerSrc.includes('.update(adoptedBatchTruth.patch)'),
      'la adopción tiene que escribir EXACTAMENTE el patch resuelto, sin campos sueltos',
    );
    assert.ok(probeCall > adoptionUpdate, 'la sonda corre con el lote ya adoptado');
    assert.ok(decision > probeCall, 'la decisión se toma después de sondear');
    assert.ok(
      firstStatusWrite > decision,
      'ninguna escritura de estado puede preceder a la decisión',
    );

    // Y la adopción, que es lo único que corre ANTES de la sonda, no puede
    // llevar la columna de estado en su payload.
    //
    // El corte es el OBJETO de la UPDATE, no todo lo que hay hasta la sonda:
    // entre medias está el `return` de error del escritor, que lleva un
    // `status: "failed"` propio del RESULTADO y no de la fila del lote. Cortar
    // ancho daría un falso positivo sobre un campo que no es una columna.
    const adoptionPayloadEnd = writerSrc.indexOf('.eq("id", existingBatchId);', adoptionUpdate);
    assert.ok(
      adoptionPayloadEnd > adoptionUpdate && adoptionPayloadEnd < probeCall,
      'el payload de adopción tiene que cerrarse antes de la sonda',
    );
    const adoptionPayload = writerSrc.slice(adoptionUpdate, adoptionPayloadEnd);
    assert.ok(
      !/\bstatus:/.test(adoptionPayload),
      `la UPDATE de adopción no puede escribir \`status\`; payload: ${adoptionPayload}`,
    );
  });

  it('la telemetría publica las dos cifras por separado y si el previo se pudo leer', () => {
    assert.ok(writerSrc.includes('pre_existing_durable_candidates: batchDurableTotals.preExistingDurableCandidates'));
    assert.ok(writerSrc.includes('pre_existing_durable_candidates_known: batchDurableTotals.preExistingKnown'));
    assert.ok(writerSrc.includes('total_durable_candidates: batchDurableTotals.totalDurableCandidates'));
  });
});

// ─── § 14 / § 18 — trinquetes de alcance ──────────────────────────────────────

describe('CUT-1 § 14/§ 18 — este PR no enciende ni redefine nada fuera de su alcance', () => {
  it('PARTIAL GAP sigue apagado en Apollo y en Lusha', () => {
    const apollo = read('src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts');
    assert.ok(/WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED\s*(:[^=]*)?=\s*false/.test(apollo));
    const lusha = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    assert.ok(/LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED\s*(:[^=]*)?=\s*false/.test(lusha));
  });

  it('no se toca isUsefulReviewCandidate (CUT-4)', () => {
    for (const file of [
      'src/server/prospect-batches/batch-durable-candidates.ts',
      'src/modules/prospect-batches/chat-wizard-execution/wizard-batch-failure.ts',
    ]) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!src.includes('isUsefulReviewCandidate'), file);
    }
  });

  it('no se toca target_count, ni el dedupe cruzado, ni las capacidades de exclusión (CUT-2/3)', () => {
    const src = read('src/server/prospect-batches/batch-durable-candidates.ts');
    for (const forbidden of [
      'target_count',
      'identity_key',
      'APOLLO_EXCLUSION_CAPABILITY',
      'provider_seen',
      'accepted_for_target',
    ]) {
      assert.ok(!src.includes(forbidden), `${forbidden} está fuera de alcance`);
    }
  });

  it('frontera económica intacta: ni proveedores, ni créditos, ni presupuesto en el módulo nuevo', () => {
    // Se mira el CÓDIGO, no la prosa: los comentarios en castellano contienen
    // palabras como «acredita», que no son un token de gasto.
    const code = read('src/server/prospect-batches/batch-durable-candidates.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'apollo', 'lusha', 'tavily', 'fetch', 'credits', 'budget', 'reservation',
      'provider_usage_logs', 'estimated_cost_usd',
    ]) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\b`, 'i').test(code),
        `${forbidden} no pertenece a CUT-1`,
      );
    }
  });

  it('CUT-1 no añade migraciones', () => {
    const sql = read('supabase/migrations/040_prospect_batches_foundation.sql');
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS prospect_candidates'));
    // El criterio se apoya en el esquema EXISTENTE; ninguna columna nueva.
    const survivalModule = read('src/server/prospect-batches/batch-durable-candidates.ts');
    assert.ok(!survivalModule.includes('ALTER TABLE'));
  });
});
