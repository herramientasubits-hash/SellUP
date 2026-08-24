/**
 * AGENT1-CUT3B4 — el vallado optimista y su bucle, en TypeScript.
 *
 * Qué prueba este archivo, y qué NO.
 *
 * Prueba el CONTRATO del lado del cliente: que `stale` no sea un error, que la
 * decisión caduca se RE-EVALÚE con la autoridad de B23 y no con un segundo
 * evaluador, que el tope de reintentos falle CERRADO sin escribir, que la
 * telemetría no lleve PII y que la ausencia de la migración 126 lleve —y sólo
 * ella— a la ruta anterior a B4.
 *
 * 🔴 NO prueba la atomicidad de la base. Un doble en memoria puede devolver
 * `stale` porque se lo pedimos; que PostgreSQL lo devuelva de verdad cuando dos
 * sesiones compiten es otra afirmación, y vive en la suite de PostgreSQL real
 * (`cut3b4-batch-identity-atomicity-postgres.test.ts`). Llamar «prueba de
 * atomicidad» a un mock sería exactamente el error que ese archivo existe para no
 * cometer.
 *
 * Offline y determinista: sin Supabase, sin red, sin credenciales, 0 proveedores,
 * 0 créditos, 0 migraciones aplicadas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isMissingFenceCapabilityError,
  parseFencedInsertPayload,
  MAX_IDENTITY_EPOCH_RETRIES,
  type FencedCandidateInsertResult,
} from '../batch-identity-fence';
import {
  initialFencedPersistenceTelemetry,
  isProvenFenceCapabilityAbsent,
  runFencedPersistence,
  toFencedPersistenceMetadata,
  type FencedAdmissionPlan,
} from '../batch-identity-fenced-persistence';
import { loadBatchIdentityRegistry } from '../batch-identity-registry-store';
import type { BatchIdentitySeedOutcome } from '../batch-identity-registry-store';
import {
  acceptIdentity,
  createBatchIdentityRegistry,
  evaluateCandidateIdentity,
  isBatchIdentityHardDuplicate,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import { buildCompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';

const BATCH = 'batch-b4';
const FAKE_CLIENT = {} as SupabaseClient;

function snapshot(epoch: number | null, entries: BatchIdentitySeedOutcome['registry']['entries'] = []): BatchIdentitySeedOutcome {
  return {
    registry: { batchId: BATCH, entries },
    seededCount: entries.length,
    degraded: false,
    epoch,
    fenceCapabilityAbsent: epoch === null,
  };
}

/**
 * Foto con las TRES señales puestas a mano.
 *
 * La corrección de este corte se decide con la conjunción `epoch` /
 * `fenceCapabilityAbsent` / `degraded`, así que las pruebas negativas necesitan
 * poder construir cada combinación por separado: `snapshot()` las ata entre sí y
 * eso es justo lo que aquí no puede darse por bueno.
 */
function rawSnapshot(fields: {
  epoch: number | null;
  degraded: boolean;
  fenceCapabilityAbsent: boolean;
}): BatchIdentitySeedOutcome {
  return {
    registry: { batchId: BATCH, entries: [] },
    seededCount: 0,
    degraded: fields.degraded,
    epoch: fields.epoch,
    fenceCapabilityAbsent: fields.fenceCapabilityAbsent,
  };
}

const ACME = buildCompanyIdentityEvidence({
  countryCode: 'CO',
  domain: 'acme.com',
  website: 'https://acme.com',
  name: 'Acme SAS',
});

function persistPlan(): FencedAdmissionPlan {
  return {
    kind: 'persist',
    rows: [{ name: 'Acme SAS', domain: 'acme.com' }],
    decisions: [evaluateCandidateIdentity(createBatchIdentityRegistry(BATCH), ACME)],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// § 8 — el resultado es TIPADO: `stale` nunca es una excepción
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 8 — el desenlace vallado es un valor, no una excepción', () => {
  it('`inserted` trae ids, época previa y época siguiente', () => {
    const parsed = parseFencedInsertPayload({
      status: 'inserted',
      candidate_ids: ['c-1'],
      inserted_count: 1,
      previous_epoch: 4,
      next_epoch: 5,
    });
    assert.equal(parsed.status, 'inserted');
    assert.deepEqual(parsed.status === 'inserted' ? [...parsed.candidateIds] : null, ['c-1']);
    assert.equal(parsed.status === 'inserted' ? parsed.previousEpoch : null, 4);
    assert.equal(parsed.status === 'inserted' ? parsed.nextEpoch : null, 5);
  });

  it('🔴 la época serializada como CADENA se lee igual: `bigint` viaja así por PostgREST', () => {
    // Sin esto, cada inserción con éxito devolvía una época ilegible y el vallado
    // se apagaba en silencio en la siguiente vuelta.
    const parsed = parseFencedInsertPayload({
      status: 'inserted',
      candidate_ids: ['c-1'],
      previous_epoch: '9007199254740',
      next_epoch: '9007199254741',
    });
    assert.equal(parsed.status, 'inserted');
    assert.equal(parsed.status === 'inserted' ? parsed.nextEpoch : null, 9007199254741);
  });

  it('`stale` es un desenlace normal y trae la época vigente', () => {
    const parsed = parseFencedInsertPayload({ status: 'stale', current_epoch: 7 });
    assert.equal(parsed.status, 'stale');
    assert.equal(parsed.status === 'stale' ? parsed.currentEpoch : null, 7);
  });

  it('una carga útil ilegible NO se confunde con `stale` ni con éxito', () => {
    for (const payload of [null, 'nope', 42, { status: 'whatever' }, { status: 'inserted' }]) {
      assert.equal(parseFencedInsertPayload(payload).status, 'insert_failed');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 26/I — la migración SIN aplicar se reconoce, y sólo ella
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 26 — «la 126 no está aplicada» se reconoce de forma ESTRECHA', () => {
  it('reconoce el 42883 de PostgreSQL y el PGRST202 de PostgREST', () => {
    assert.equal(isMissingFenceCapabilityError({ code: '42883' }), true);
    assert.equal(isMissingFenceCapabilityError({ code: 'PGRST202' }), true);
  });

  it('reconoce el mensaje que NOMBRA la función ausente', () => {
    assert.equal(
      isMissingFenceCapabilityError({
        message: "Could not find the function public.insert_fenced_prospect_candidates in the schema cache",
      }),
      true,
    );
  });

  it('🔴 NO degrada un fallo REAL a «todavía no está aplicada»', () => {
    // Ésta es la mitad que importa: si un error de permisos, una violación de
    // CHECK o una conexión caída se leyeran como «la función no existe», el
    // escritor caería a la ruta sin valla ante cualquier avería.
    for (const real of [
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      { code: '42501', message: 'permission denied for function insert_fenced_prospect_candidates' },
      { code: '08006', message: 'connection failure' },
      { message: 'algo se rompió' },
      null,
      undefined,
      'texto suelto',
    ]) {
      assert.equal(isMissingFenceCapabilityError(real), false, JSON.stringify(real));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 10/16/17 — el bucle: stale, re-evaluación, tope, fallo cerrado
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 10 — el bucle de reintento optimista', () => {
  it('época coincidente ⇒ se persiste, y la foto avanza a la época siguiente', async () => {
    const calls: number[] = [];
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(3),
      plan: () => persistPlan(),
      fencedInsert: async (_c, a) => {
        calls.push(a.expectedEpoch);
        return {
          status: 'inserted',
          candidateIds: ['c-1'],
          insertedCount: 1,
          previousEpoch: a.expectedEpoch,
          nextEpoch: a.expectedEpoch + 1,
        };
      },
    });

    assert.equal(result.status, 'persisted');
    assert.deepEqual(calls, [3], 'la escritura declaró la época de la foto');
    assert.equal(result.snapshot.epoch, 4);
    assert.equal(result.telemetry.identityEpochStaleRetries, 0);
    assert.equal(result.telemetry.identityEpochRetryExhausted, false);
  });

  it('🔴 `stale` RECARGA la foto y RE-EVALÚA: no reutiliza la decisión vieja', async () => {
    const reloads: number[] = [];
    const planCalls: Array<number | null> = [];
    let inserted = false;

    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(0),
      plan: (snap) => {
        planCalls.push(snap.epoch);
        return persistPlan();
      },
      reloadSnapshot: async () => {
        reloads.push(1);
        return snapshot(1);
      },
      fencedInsert: async (_c, a) => {
        if (!inserted && a.expectedEpoch === 0) return { status: 'stale', currentEpoch: 1 };
        inserted = true;
        return {
          status: 'inserted',
          candidateIds: ['c-2'],
          insertedCount: 1,
          previousEpoch: a.expectedEpoch,
          nextEpoch: a.expectedEpoch + 1,
        };
      },
    });

    assert.equal(result.status, 'persisted');
    assert.equal(reloads.length, 1, 'tiene que recargar la foto exactamente una vez');
    assert.deepEqual(planCalls, [0, 1], 'la re-evaluación corrió contra la foto NUEVA');
    assert.equal(result.telemetry.identityEpochStaleRetries, 1);
  });

  it('🔴 tras recargar, el candidato puede resultar DUPLICADO — y eso no es un error', async () => {
    // El caso que todo el corte existe para atrapar: la decisión era válida contra
    // la foto vieja y deja de serlo contra la nueva.
    const winner = { batchId: BATCH, entries: [{ candidateId: 'ganador', evidence: ACME }] };

    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(0),
      plan: (snap) => {
        // La MISMA autoridad de B23, siempre. No hay un segundo evaluador.
        const decision = evaluateCandidateIdentity(snap.registry, ACME);
        return isBatchIdentityHardDuplicate(decision)
          ? { kind: 'duplicate', decision }
          : { kind: 'persist', rows: [{ name: 'Acme SAS' }], decisions: [decision] };
      },
      reloadSnapshot: async () => ({ ...snapshot(1), registry: winner, seededCount: 1 }),
      fencedInsert: async () => ({ status: 'stale', currentEpoch: 1 }),
    });

    assert.equal(result.status, 'duplicate');
    assert.equal(result.status === 'duplicate' ? result.decision.matchedTier : null, 2);
    assert.equal(result.telemetry.identityDuplicateAfterStaleRetry, true);
    assert.equal(result.telemetry.identityEpochRetryExhausted, false);
  });

  it('🔴 tras recargar, un conflicto fiscal TIER 0 deja SEGUIR: el ganador no lo suprime', async () => {
    // Mismo dominio, NITs contradictorios ⇒ dos personas jurídicas distintas. La
    // carrera no puede convertir eso en un duplicado.
    const otherLegalEntity = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      taxIdentifier: '800111222',
      domain: 'group.com',
      name: 'Grupo Uno',
    });
    const mine = buildCompanyIdentityEvidence({
      countryCode: 'CO',
      taxIdentifier: '900333444',
      domain: 'group.com',
      name: 'Grupo Dos',
    });

    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(0),
      plan: (snap) => {
        const decision = evaluateCandidateIdentity(snap.registry, mine);
        return isBatchIdentityHardDuplicate(decision)
          ? { kind: 'duplicate', decision }
          : { kind: 'persist', rows: [{ name: 'Grupo Dos' }], decisions: [decision] };
      },
      reloadSnapshot: async () => ({
        ...snapshot(1),
        registry: acceptIdentity(createBatchIdentityRegistry(BATCH), otherLegalEntity, 'ganador'),
        seededCount: 1,
      }),
      fencedInsert: async (_c, a) =>
        a.expectedEpoch === 0
          ? { status: 'stale', currentEpoch: 1 }
          : {
              status: 'inserted',
              candidateIds: ['c-3'],
              insertedCount: 1,
              previousEpoch: a.expectedEpoch,
              nextEpoch: a.expectedEpoch + 1,
            },
    });

    assert.equal(result.status, 'persisted', 'TIER 0 tiene que dejar convivir las dos');
  });

  it('🔴 agotar el tope falla CERRADO: CERO escrituras, ninguna sin valla', async () => {
    let attempts = 0;
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(0),
      plan: () => persistPlan(),
      reloadSnapshot: async () => snapshot(0),
      fencedInsert: async () => {
        attempts += 1;
        return { status: 'stale', currentEpoch: 99 };
      },
    });

    assert.equal(result.status, 'retry_exhausted');
    assert.equal(result.telemetry.identityEpochRetryExhausted, true);
    assert.equal(result.telemetry.identityEpochStaleRetries, MAX_IDENTITY_EPOCH_RETRIES + 1);
    assert.equal(
      attempts,
      MAX_IDENTITY_EPOCH_RETRIES + 1,
      'el tope tiene que ACOTAR: no puede reintentar sin fin',
    );
  });

  it('un fallo REAL de escritura NO se reintenta y NO avanza nada', async () => {
    let attempts = 0;
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(2),
      plan: () => persistPlan(),
      fencedInsert: async () => {
        attempts += 1;
        return { status: 'insert_failed', code: '23514', raw: { code: '23514' } };
      },
    });

    assert.equal(result.status, 'insert_failed');
    assert.equal(attempts, 1, 'un CHECK violado no es contención: no se reintenta');
    assert.equal(result.snapshot.epoch, 2, 'la época no puede moverse tras un fallo');
  });

  it('un duplicado detectado en la PRIMERA evaluación no llega a escribir', async () => {
    let attempts = 0;
    const decision = evaluateCandidateIdentity(
      acceptIdentity(createBatchIdentityRegistry(BATCH), ACME, 'ganador'),
      ACME,
    );
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(0),
      plan: () => ({ kind: 'duplicate', decision }),
      fencedInsert: async () => {
        attempts += 1;
        return { status: 'stale', currentEpoch: 1 };
      },
    });

    assert.equal(result.status, 'duplicate');
    assert.equal(attempts, 0, 'un duplicado no puede llegar a la base');
    assert.equal(
      result.telemetry.identityDuplicateAfterStaleRetry,
      false,
      'sin carrera previa no es «duplicado tras carrera»',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 12/26 — la 126 sin aplicar lleva a la ruta anterior a B4, y sólo ella
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 12 — compatibilidad con la migración SIN aplicar', () => {
  it('sin época (la 126 no está aplicada) se devuelve el plan al escritor, sin escribir', async () => {
    let attempts = 0;
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(null),
      plan: () => persistPlan(),
      fencedInsert: async () => {
        attempts += 1;
        return { status: 'stale', currentEpoch: 0 };
      },
    });

    assert.equal(result.status, 'capability_absent');
    assert.equal(attempts, 0, 'sin época no se puede llamar a la valla');
    assert.equal(result.telemetry.identityFenceCapabilityAbsent, true);
  });

  it('🔴 «no sé la época» NUNCA se trata como la época 0', async () => {
    // Colapsar `null` a 0 habría hecho pasar por vallada una escritura que no lo
    // está — y peor: contra un lote cuya época real ya hubiera avanzado.
    const seen: number[] = [];
    await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(null),
      plan: () => persistPlan(),
      fencedInsert: async (_c, a) => {
        seen.push(a.expectedEpoch);
        return { status: 'stale', currentEpoch: 0 };
      },
    });
    assert.deepEqual(seen, [], 'no puede haberse llamado con una época inventada');
  });

  it('🔴 la RPC que responde «no existe» TRAS observar la valla NO degrada: falla CERRADO', async () => {
    // CASO E de la corrección. Antes esto devolvía `capability_absent` y el
    // escritor hacía un insert DIRECTO: la valla podía desvanecerse a mitad de la
    // admisión. Habiendo visto una época, la capacidad está OBSERVADA activa y una
    // caché de esquema incoherente es una avería, no una prueba de esquema.
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: snapshot(0),
      plan: () => persistPlan(),
      fencedInsert: async (): Promise<FencedCandidateInsertResult> => ({
        status: 'capability_absent',
      }),
    });
    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal(
      result.status === 'snapshot_unavailable' ? result.reason : null,
      'fence_capability_lost',
    );
    assert.equal(result.telemetry.identityFenceCapabilityAbsent, false);
    assert.equal(result.telemetry.identityFenceCapabilityLost, true);
    assert.equal('plan' in result, false, 'no puede devolver un plan que el escritor insertaría directo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 24 — telemetría sin PII
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 24 — la telemetría de concurrencia no puede llevar PII', () => {
  it('sólo conteos, booleanos y `null`: nunca una cadena', () => {
    const metadata = toFencedPersistenceMetadata({
      identityEpochInitial: 0,
      identityEpochFinal: 3,
      identityEpochStaleRetries: 2,
      identityEpochRetryExhausted: false,
      identityDuplicateAfterStaleRetry: true,
      identityFenceCapabilityAbsent: false,
      identitySnapshotUnavailable: false,
      identityFenceCapabilityLost: false,
    });

    for (const [key, value] of Object.entries(metadata)) {
      assert.ok(
        typeof value === 'number' || typeof value === 'boolean' || value === null,
        `${key} tiene que ser número, booleano o null`,
      );
    }
    // Y las CLAVES no nombran nada identificable. Se comparan por SEGMENTO y no
    // por subcadena: «nit» vive dentro de «initial», y una guarda que confunde las
    // dos cosas falla por una palabra en español, no por una fuga.
    for (const key of Object.keys(metadata)) {
      const segments = key.split('_');
      for (const forbidden of ['tax', 'nit', 'domain', 'linkedin', 'name', 'phone', 'email']) {
        assert.equal(
          segments.includes(forbidden),
          false,
          `${key} nombra ${forbidden}`,
        );
      }
    }
  });

  it('la telemetría existe entera: una guarda de formas no basta si el bloque desaparece', () => {
    const metadata = toFencedPersistenceMetadata({
      identityEpochInitial: null,
      identityEpochFinal: null,
      identityEpochStaleRetries: 0,
      identityEpochRetryExhausted: false,
      identityDuplicateAfterStaleRetry: false,
      identityFenceCapabilityAbsent: true,
      identitySnapshotUnavailable: false,
      identityFenceCapabilityLost: false,
    });
    assert.deepEqual(Object.keys(metadata).sort(), [
      'identity_duplicate_after_stale_retry',
      'identity_epoch_final',
      'identity_epoch_initial',
      'identity_epoch_retry_exhausted',
      'identity_epoch_stale_retries',
      'identity_fence_capability_absent',
      'identity_fence_capability_lost',
      'identity_snapshot_unavailable',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CUT-3B4-CORRECCIÓN — «sin época» NO es «sin migración»
//
// El defecto: el bucle decidía la ruta anterior a B4 con `epoch === null` a
// secas, así que una lectura caída, un lote invisible o un cliente no soportado
// —todos ellos AVERÍAS— habilitaban una escritura SIN valla. La autorización
// exige ahora las tres condiciones juntas, y todo lo demás falla CERRADO.
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4-CORRECCIÓN — la ruta legada exige ausencia PROBADA', () => {
  it('🔴 el predicado exige las TRES condiciones: la tabla de verdad entera', () => {
    // 8 combinaciones; exactamente UNA autoriza. Escrita como tabla porque el
    // defecto era precisamente aceptar una de las otras siete.
    for (const epoch of [null, 4] as const) {
      for (const degraded of [false, true]) {
        for (const fenceCapabilityAbsent of [false, true]) {
          const expected =
            epoch === null && fenceCapabilityAbsent === true && degraded === false;
          assert.equal(
            isProvenFenceCapabilityAbsent(rawSnapshot({ epoch, degraded, fenceCapabilityAbsent })),
            expected,
            `epoch=${epoch} degraded=${degraded} absent=${fenceCapabilityAbsent}`,
          );
        }
      }
    }
  });

  it('🔴 `epoch === null` por sí solo NO autoriza nada', () => {
    // La forma exacta del defecto, dicha en una línea.
    assert.equal(
      isProvenFenceCapabilityAbsent(
        rawSnapshot({ epoch: null, degraded: true, fenceCapabilityAbsent: false }),
      ),
      false,
    );
    assert.equal(
      isProvenFenceCapabilityAbsent(
        rawSnapshot({ epoch: null, degraded: false, fenceCapabilityAbsent: false }),
      ),
      false,
    );
  });

  // ── Casos A–D: la foto INICIAL, cuatro combinaciones con época nula ────────
  for (const [label, fields, expected] of [
    [
      'A · lectura degradada SIN prueba de esquema',
      { epoch: null, degraded: true, fenceCapabilityAbsent: false },
      'snapshot_unavailable',
    ],
    [
      'B · lectura degradada CON bandera de esquema (la bandera no basta)',
      { epoch: null, degraded: true, fenceCapabilityAbsent: true },
      'snapshot_unavailable',
    ],
    [
      'C · sin degradar y sin prueba de esquema (lote invisible)',
      { epoch: null, degraded: false, fenceCapabilityAbsent: false },
      'snapshot_unavailable',
    ],
    [
      'D · ausencia PROBADA: la 126 no está aplicada',
      { epoch: null, degraded: false, fenceCapabilityAbsent: true },
      'capability_absent',
    ],
  ] as const) {
    it(`${label} ⇒ ${expected}`, async () => {
      let fenceCalls = 0;
      const result = await runFencedPersistence({
        client: FAKE_CLIENT,
        batchId: BATCH,
        snapshot: rawSnapshot(fields),
        plan: () => persistPlan(),
        fencedInsert: async (): Promise<FencedCandidateInsertResult> => {
          fenceCalls += 1;
          return { status: 'inserted', candidateIds: ['x'], insertedCount: 1, previousEpoch: 0, nextEpoch: 1 };
        },
      });

      assert.equal(result.status, expected);
      assert.equal(fenceCalls, 0, 'sin época no se puede llamar a la valla');

      if (expected === 'snapshot_unavailable') {
        // 🔴 Lo que prueba que el escritor NO puede insertar directo: no recibe
        // plan. La rama legada de los tres escritores se alimenta del `plan` que
        // viaja con `capability_absent`, y aquí no viaja ninguno.
        assert.equal('plan' in result, false, 'la avería devolvió un plan insertable sin valla');
        assert.equal(result.telemetry.identitySnapshotUnavailable, true);
        assert.equal(result.telemetry.identityFenceCapabilityAbsent, false);
      } else {
        assert.equal('plan' in result, true, 'la compatibilidad probada sí devuelve el plan');
        assert.equal(result.telemetry.identityFenceCapabilityAbsent, true);
        assert.equal(result.telemetry.identitySnapshotUnavailable, false);
      }
    });
  }

  // ── Caso F: la capacidad es MONÓTONA dentro de la tentativa ────────────────
  it('🔴 F · vista la valla activa, una recarga que degrada a `null` falla CERRADO', async () => {
    let reloads = 0;
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      // Época 4 observada: la capacidad está PROBADA presente.
      snapshot: rawSnapshot({ epoch: 4, degraded: false, fenceCapabilityAbsent: false }),
      plan: () => persistPlan(),
      fencedInsert: async (): Promise<FencedCandidateInsertResult> => ({
        status: 'stale',
        currentEpoch: 5,
      }),
      reloadSnapshot: async () => {
        reloads += 1;
        // La recarga se cae: sin época y, encima, con la bandera puesta. Ni así.
        return rawSnapshot({ epoch: null, degraded: true, fenceCapabilityAbsent: true });
      },
    });

    assert.equal(reloads, 1);
    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal(
      result.status === 'snapshot_unavailable' ? result.reason : null,
      'snapshot_degraded',
    );
    assert.equal('plan' in result, false, 'la recarga degradada devolvió un plan insertable');
    assert.equal(result.telemetry.identityFenceCapabilityAbsent, false);
  });

  it('🔴 la ausencia PROBADA que llega DESPUÉS tampoco reabre la ruta legada', async () => {
    // Misma monotonía, con la recarga trayendo la conjunción «legítima». Da
    // igual: la prueba de ausencia se toma sobre la foto INICIAL y no se
    // re-descubre a mitad de la tentativa.
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: rawSnapshot({ epoch: 4, degraded: false, fenceCapabilityAbsent: false }),
      plan: () => persistPlan(),
      fencedInsert: async (): Promise<FencedCandidateInsertResult> => ({
        status: 'stale',
        currentEpoch: 5,
      }),
      reloadSnapshot: async () =>
        rawSnapshot({ epoch: null, degraded: false, fenceCapabilityAbsent: true }),
    });

    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal('plan' in result, false);
  });

  it('una recarga con época NUEVA sigue reintentando vallada: la corrección no rompe `stale`', async () => {
    const epochs: number[] = [];
    const result = await runFencedPersistence({
      client: FAKE_CLIENT,
      batchId: BATCH,
      snapshot: rawSnapshot({ epoch: 4, degraded: false, fenceCapabilityAbsent: false }),
      plan: () => persistPlan(),
      fencedInsert: async (_c, a): Promise<FencedCandidateInsertResult> => {
        epochs.push(a.expectedEpoch);
        return a.expectedEpoch === 4
          ? { status: 'stale', currentEpoch: 5 }
          : { status: 'inserted', candidateIds: ['c1'], insertedCount: 1, previousEpoch: 5, nextEpoch: 6 };
      },
      reloadSnapshot: async () =>
        rawSnapshot({ epoch: 5, degraded: false, fenceCapabilityAbsent: false }),
    });

    assert.deepEqual(epochs, [4, 5]);
    assert.equal(result.status, 'persisted');
    assert.equal(result.telemetry.identityEpochStaleRetries, 1);
    assert.equal(result.telemetry.identitySnapshotUnavailable, false);
    assert.equal(result.telemetry.identityFenceCapabilityLost, false);
  });

  it('la telemetría inicial NO afirma compatibilidad cuando la lectura sólo degradó', () => {
    const degraded = initialFencedPersistenceTelemetry(
      rawSnapshot({ epoch: null, degraded: true, fenceCapabilityAbsent: true }),
    );
    assert.equal(degraded.identityFenceCapabilityAbsent, false);

    const proven = initialFencedPersistenceTelemetry(
      rawSnapshot({ epoch: null, degraded: false, fenceCapabilityAbsent: true }),
    );
    assert.equal(proven.identityFenceCapabilityAbsent, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CUT-3B4-CORRECCIÓN — CASO G: un cliente sin `.rpc` no es prueba de esquema
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4-CORRECCIÓN — la FORMA del cliente no decide el esquema', () => {
  it('🔴 G · un cliente sin método `rpc` NO cuenta como «la 126 no está aplicada»', async () => {
    let fromCalls = 0;
    const clientWithoutRpc = {
      from() {
        fromCalls += 1;
        throw new Error('la ruta legada no debería alcanzarse');
      },
    } as unknown as SupabaseClient;

    const outcome = await loadBatchIdentityRegistry(clientWithoutRpc, BATCH);

    assert.equal(outcome.epoch, null);
    assert.equal(outcome.degraded, true, 'un cliente no soportado es una degradación');
    assert.equal(
      outcome.fenceCapabilityAbsent,
      false,
      'la forma de un objeto de JavaScript pasó por prueba de esquema',
    );
    assert.equal(fromCalls, 0, 'no puede caer a la lectura anterior a B4');
    assert.equal(isProvenFenceCapabilityAbsent(outcome), false);
  });

  it('🔴 G · esa foto, en el bucle, falla CERRADO y no devuelve plan', async () => {
    const clientWithoutRpc = { from: () => { throw new Error('nunca'); } } as unknown as SupabaseClient;
    const outcome = await loadBatchIdentityRegistry(clientWithoutRpc, BATCH);

    let fenceCalls = 0;
    const result = await runFencedPersistence({
      client: clientWithoutRpc,
      batchId: BATCH,
      snapshot: outcome,
      plan: () => persistPlan(),
      fencedInsert: async (): Promise<FencedCandidateInsertResult> => {
        fenceCalls += 1;
        return { status: 'capability_absent' };
      },
    });

    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal(fenceCalls, 0);
    assert.equal('plan' in result, false);
  });

  it('un `rpc` que responde 42883 SÍ es prueba de esquema, y conserva la ruta legada', async () => {
    // La contrapartida: el camino legítimo sigue existiendo, pero lo abre la BASE.
    let fromCalls = 0;
    const rows: unknown[] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: async () => ({ data: rows, error: null }),
    };
    const client = {
      rpc: async () => ({ data: null, error: { code: '42883', message: 'function does not exist' } }),
      from: () => {
        fromCalls += 1;
        return builder;
      },
    } as unknown as SupabaseClient;

    const outcome = await loadBatchIdentityRegistry(client, BATCH);
    assert.equal(fromCalls, 1, 'la ruta anterior a B4 tiene que ejecutarse');
    assert.equal(outcome.epoch, null);
    assert.equal(outcome.degraded, false);
    assert.equal(outcome.fenceCapabilityAbsent, true);
    assert.equal(isProvenFenceCapabilityAbsent(outcome), true);
  });

  it('🔴 con la 126 ausente, una lectura legada que se CAE ya no autoriza escribir', async () => {
    // Caso B end-to-end desde el almacén: la bandera de esquema está puesta, pero
    // la cobertura no se leyó. Admitir aquí sería decidir identidad contra una
    // siembra vacía por avería, y encima escribir sin valla.
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: async () => ({ data: null, error: { message: 'query failed' } }),
    };
    const client = {
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
      from: () => builder,
    } as unknown as SupabaseClient;

    const outcome = await loadBatchIdentityRegistry(client, BATCH);
    assert.equal(outcome.degraded, true);
    assert.equal(outcome.fenceCapabilityAbsent, true);
    assert.equal(isProvenFenceCapabilityAbsent(outcome), false);

    const result = await runFencedPersistence({
      client,
      batchId: BATCH,
      snapshot: outcome,
      plan: () => persistPlan(),
      fencedInsert: async (): Promise<FencedCandidateInsertResult> => ({ status: 'capability_absent' }),
    });
    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal('plan' in result, false);
  });
});
