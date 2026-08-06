/**
 * Tests — readiness de persistencia de prospect_candidates (núcleo PURO).
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 14, casos 1, 2, 3 y 7.
 *
 * Sin red, sin Supabase, sin proveedores, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCandidatePersistenceError,
  classifyPersistenceProbeError,
  decidePersistenceReadiness,
  isMissingProspectCandidateIdentityKeyError,
  noCandidatePersistenceFailures,
  resolveBatchStatusForPersistenceOutcome,
  toCandidatePersistenceOutcomeMetadata,
  toPersistenceReadinessProbeFromResponse,
  CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE,
  IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
  PERSISTENCE_NOT_READY_ADMIN_MESSAGE,
} from '../prospect-candidate-persistence-readiness';
import { QA2_IDENTITY_KEY_POSTGREST_ERROR } from './qa2-persistence-fixture';

describe('§ 14.1 — identity_key disponible', () => {
  it('una lectura correcta está disponible y la decisión autoriza continuar', () => {
    const probe = toPersistenceReadinessProbeFromResponse({
      data: [{ identity_key: null }],
      error: null,
    });
    assert.deepEqual(probe, { status: 'available' });
    assert.deepEqual(decidePersistenceReadiness(probe), { ready: true });
  });

  it('la tabla vacía (data=[]) también autoriza: se comprueba el esquema, no el contenido', () => {
    const probe = toPersistenceReadinessProbeFromResponse({ data: [], error: null });
    assert.deepEqual(probe, { status: 'available' });
    assert.deepEqual(decidePersistenceReadiness(probe), { ready: true });
  });
});

describe('§ 1 — la disponibilidad exige la forma completa de la respuesta', () => {
  // A1-APOLLO-PERSISTENCE-REVIEW-FIX-1. El contrato anterior mirába sólo `error`,
  // así que una respuesta a la que le faltaba TODO menos `error: null` pasaba por
  // «listo» y autorizaba el gasto. Aquí se fija al revés: available sólo con
  // objeto + `error` presente y null + `data` presente y arreglo.
  const notReady: unknown[] = [
    {},
    { error: null },
    { data: null, error: null },
    { data: {}, error: null },
    { data: 'rows', error: null },
    { data: [] },
    { data: [], error: undefined },
    undefined,
    null,
    'ok',
    42,
    [],
  ];

  for (const response of notReady) {
    it(`${JSON.stringify(response) ?? String(response)} ⇒ probe_failed`, () => {
      assert.deepEqual(toPersistenceReadinessProbeFromResponse(response), {
        status: 'probe_failed',
      });
    });
  }

  it('ninguna respuesta malformada llega a `ready: true`', () => {
    for (const response of notReady) {
      const decision = decidePersistenceReadiness(
        toPersistenceReadinessProbeFromResponse(response),
      );
      assert.equal(decision.ready, false, `no puede autorizar: ${String(JSON.stringify(response))}`);
      if (decision.ready) continue;
      assert.equal(decision.reason, 'probe_failed');
      assert.equal(decision.stage, 'schema_preflight');
    }
  });

  it('la columna ausente sigue distinguiéndose dentro de una respuesta con error', () => {
    // Regresión importante del cambio de forma: al pasar la respuesta ENTERA en
    // vez del error, el diagnóstico específico tenía que sobrevivir.
    assert.deepEqual(
      toPersistenceReadinessProbeFromResponse({
        data: null,
        error: QA2_IDENTITY_KEY_POSTGREST_ERROR,
      }),
      { status: 'identity_key_missing' },
    );
  });

  it('el clasificador de errores no puede devolver disponibilidad', () => {
    // Por tipo y por comportamiento: recibir un error ya prueba que la lectura no
    // funcionó, incluso si el error es `null`/`undefined` por un cliente raro.
    for (const error of [null, undefined, {}, 'boom', new Error('x')]) {
      assert.notEqual(classifyPersistenceProbeError(error).status, 'available');
    }
  });
});

describe('§ 14.2 — identity_key ausente (42703, undefined_column de Postgres)', () => {
  const error = {
    code: '42703',
    message: 'column prospect_candidates.identity_key does not exist',
  };

  it('se reconoce como la columna nuestra que falta', () => {
    assert.equal(isMissingProspectCandidateIdentityKeyError(error), true);
  });

  it('la decisión bloquea con el código del repo y la razón correcta', () => {
    const decision = decidePersistenceReadiness(classifyPersistenceProbeError(error));
    assert.equal(decision.ready, false);
    if (decision.ready) return;
    assert.equal(decision.errorCode, IDENTITY_KEY_UNAVAILABLE_ERROR_CODE);
    assert.equal(decision.reason, 'identity_key_missing');
    assert.equal(decision.stage, 'schema_preflight');
  });

  it('el mensaje administrativo NO contiene el error crudo de Postgres', () => {
    const decision = decidePersistenceReadiness(classifyPersistenceProbeError(error));
    assert.equal(decision.ready, false);
    if (decision.ready) return;
    assert.equal(decision.adminMessage, PERSISTENCE_NOT_READY_ADMIN_MESSAGE);
    assert.doesNotMatch(decision.adminMessage, /42703/);
    assert.doesNotMatch(decision.adminMessage, /column/i);
    assert.doesNotMatch(decision.adminMessage, /prospect_candidates/);
    assert.doesNotMatch(decision.adminMessage, /identity_key/);
    // Se corta antes del acento a propósito: el texto puede venir normalizado en
    // NFC o NFD y la afirmación es sobre el contenido, no sobre la forma Unicode.
    assert.match(decision.adminMessage, /ni se consumieron cr/i);
    assert.match(decision.adminMessage, /no se ejecut/i);
  });
});

describe('§ 14.3 — la caché de esquema devuelve la columna como ausente (PGRST204)', () => {
  it('el error EXACTO de LIVE-QA-2 se reconoce', () => {
    assert.equal(
      isMissingProspectCandidateIdentityKeyError(QA2_IDENTITY_KEY_POSTGREST_ERROR),
      true,
    );
    const decision = decidePersistenceReadiness(
      classifyPersistenceProbeError(QA2_IDENTITY_KEY_POSTGREST_ERROR),
    );
    assert.equal(decision.ready, false);
    if (decision.ready) return;
    assert.equal(decision.reason, 'identity_key_missing');
  });
});

describe('§ 6 — fail-closed: lo que NO es la columna ausente tampoco autoriza gastar', () => {
  it('otra columna ausente NO se confunde con la nuestra, y bloquea igual', () => {
    const other = { code: '42703', message: 'column prospect_candidates.foo does not exist' };
    assert.equal(isMissingProspectCandidateIdentityKeyError(other), false);
    const decision = decidePersistenceReadiness(classifyPersistenceProbeError(other));
    assert.equal(decision.ready, false);
    if (decision.ready) return;
    assert.equal(decision.reason, 'probe_failed');
  });

  it('un error de permisos bloquea como sonda fallida, no como columna ausente', () => {
    const denied = { code: '42501', message: 'permission denied for table prospect_candidates' };
    const decision = decidePersistenceReadiness(classifyPersistenceProbeError(denied));
    assert.equal(decision.ready, false);
    if (decision.ready) return;
    assert.equal(decision.reason, 'probe_failed');
  });

  it('un error sin código ni forma esperada sigue bloqueando', () => {
    for (const weird of ['boom', 42, {}, { message: 'identity_key' }, { code: 'PGRST204' }]) {
      const decision = decidePersistenceReadiness(classifyPersistenceProbeError(weird));
      assert.equal(decision.ready, false, `debe bloquear con ${JSON.stringify(weird)}`);
    }
  });

  it('un código de columna ausente que no nombra identity_key no se absorbe', () => {
    assert.equal(
      isMissingProspectCandidateIdentityKeyError({ code: 'PGRST204', message: 'record_origin' }),
      false,
    );
  });
});

describe('§ 14.7 — el fallo del writer produce un error SANITIZADO', () => {
  it('la columna ausente produce el código propio, nunca el mensaje del motor', () => {
    const code = classifyCandidatePersistenceError(QA2_IDENTITY_KEY_POSTGREST_ERROR);
    assert.equal(code, IDENTITY_KEY_UNAVAILABLE_ERROR_CODE);
    assert.doesNotMatch(code, /schema cache/);
    assert.doesNotMatch(code, /PGRST/);
  });

  it('cualquier otro fallo cae en el código genérico, sin filtrar detalle', () => {
    const code = classifyCandidatePersistenceError({
      code: '23514',
      message:
        'new row for relation "prospect_candidates" violates check constraint "x" DETAIL: Failing row contains (...)',
    });
    assert.equal(code, CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE);
    assert.doesNotMatch(code, /DETAIL/);
    assert.doesNotMatch(code, /Failing row/);
  });

  it('sólo existen dos códigos posibles: no hay camino por el que se filtre texto libre', () => {
    const inputs: unknown[] = [
      QA2_IDENTITY_KEY_POSTGREST_ERROR,
      new Error('select * from prospect_candidates where secret = $1'),
      { code: 'PGRST301', message: 'JWT expired' },
      null,
      'raw string',
    ];
    for (const input of inputs) {
      const code = classifyCandidatePersistenceError(input);
      assert.ok(
        code === IDENTITY_KEY_UNAVAILABLE_ERROR_CODE ||
          code === CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE,
        `código inesperado: ${code}`,
      );
    }
  });
});

describe('§ 9 — estado del lote coherente con el resultado de la persistencia', () => {
  it('elegibles con cero guardados y fallo de escritura ⇒ failed', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        persistedCandidates: 0,
        persistenceFailureCount: 1,
      }),
      'failed',
    );
  });

  it('cero guardados sin ningún fallo ⇒ completed (descartes intencionales)', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        persistedCandidates: 0,
        persistenceFailureCount: 0,
      }),
      'completed',
    );
  });

  it('al menos uno guardado ⇒ ready_for_review, incluso con pérdidas parciales', () => {
    assert.equal(
      resolveBatchStatusForPersistenceOutcome({
        persistedCandidates: 1,
        persistenceFailureCount: 2,
      }),
      'ready_for_review',
    );
  });

  it('los tres valores pertenecen al CHECK existente de prospect_batches.status', () => {
    const allowed = new Set([
      'draft',
      'generating',
      'ready_for_review',
      'in_review',
      'completed',
      'cancelled',
      'failed',
    ]);
    for (const persisted of [0, 1]) {
      for (const failures of [0, 1]) {
        const status = resolveBatchStatusForPersistenceOutcome({
          persistedCandidates: persisted,
          persistenceFailureCount: failures,
        });
        assert.ok(allowed.has(status), `${status} no existe en el enum de la base`);
      }
    }
  });
});

describe('§ 7 — metadata sanitizada del resultado', () => {
  it('sólo enteros, booleano y códigos conocidos', () => {
    const metadata = toCandidatePersistenceOutcomeMetadata({
      eligibleBeforePersistence: 1,
      persistedCandidates: 0,
      persistenceFailureCount: 1,
      persistenceFailed: true,
      persistenceErrorCode: IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
      persistenceErrorStage: 'candidate_insert',
      persistenceStatus: 'failed',
      persistenceAttemptedCount: 1,
      persistenceSucceededCount: 0,
      persistenceFailedCount: 1,
      persistenceGap: 1,
    });
    assert.deepEqual(metadata, {
      eligible_before_persistence: 1,
      persisted_candidates: 0,
      persistence_failure_count: 1,
      persistence_failed: true,
      persistence_error_code: IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
      persistence_error_stage: 'candidate_insert',
      persistence_status: 'failed',
      persistence_attempted_count: 1,
      persistence_succeeded_count: 0,
      persistence_failed_count: 1,
      persistence_gap: 1,
    });
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /schema cache/);
    assert.doesNotMatch(serialized, /select /i);
    assert.doesNotMatch(serialized, /at Object\./);
  });

  it('el constructor «nada falló» nunca declara un fallo', () => {
    const outcome = noCandidatePersistenceFailures({
      eligibleBeforePersistence: 3,
      persistedCandidates: 3,
    });
    assert.equal(outcome.persistenceFailed, false);
    assert.equal(outcome.persistenceFailureCount, 0);
    assert.equal(outcome.persistenceErrorCode, null);
    assert.equal(outcome.persistenceErrorStage, null);
  });
});
