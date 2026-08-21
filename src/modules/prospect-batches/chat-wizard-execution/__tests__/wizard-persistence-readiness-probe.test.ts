/**
 * A1-APOLLO-PERSISTENCE-READINESS-4-FIX · § 4 — la sonda REAL, no su costura.
 *
 * `wizard-persistence-preflight.test.ts` inyecta `checkPersistenceReadiness` en
 * el nivel superior, así que prueba el ORDEN económico pero no la sonda: con esa
 * cobertura sola, `probeProspectCandidatePersistenceReadiness` podría consultar
 * la tabla equivocada, pedir la columna equivocada, leer sin `limit` o clasificar
 * mal el error de PostgREST, y todo seguiría verde.
 *
 * Aquí se observa la lectura que sale hacia PostgREST:
 *
 *   from('prospect_candidates').select('identity_key').limit(1)
 *
 * Todo con un doble; sin Supabase, sin red, sin proveedores, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  probeProspectCandidatePersistenceReadiness,
  type PersistenceReadinessDbClient,
} from '../wizard-persistence-readiness-deps';
import { QA2_IDENTITY_KEY_POSTGREST_ERROR } from '@/server/agents/prospecting-toolkit/__tests__/qa2-persistence-fixture';

// ─── Doble de PostgREST ───────────────────────────────────────────────────────

type ProbeCall = { table: string; columns: string; limit: number };

/**
 * Cliente falso que REGISTRA la lectura en vez de ejecutarla.
 *
 * Encadena `from → select → limit` igual que `@supabase/supabase-js`, de modo que
 * el registro sólo se completa si la sonda usa las tres, en ese orden.
 *
 * `response` es `unknown` a propósito: la mitad de lo que hay que probar aquí son
 * respuestas MALFORMADAS, y un tipo que las excluyera dejaría esos casos sin poder
 * escribirse. Una función se invoca (para simular una excepción del cliente).
 */
function fakeClient(response: unknown): {
  client: PersistenceReadinessDbClient;
  calls: ProbeCall[];
} {
  const calls: ProbeCall[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: async (limit: number) => {
          calls.push({ table, columns, limit });
          if (typeof response === 'function') return response() as unknown;
          return response;
        },
      }),
    }),
  };
  return { client, calls };
}

const AVAILABLE_ROW = { data: [{ identity_key: null }], error: null };

// ─── La consulta que sale ─────────────────────────────────────────────────────

describe('§ 4 — la sonda lee exactamente la columna que el writer va a escribir', () => {
  it('consulta prospect_candidates.identity_key con limit 1', async () => {
    const { client, calls } = fakeClient(AVAILABLE_ROW);
    await probeProspectCandidatePersistenceReadiness(client);

    assert.deepEqual(calls, [
      { table: 'prospect_candidates', columns: 'identity_key', limit: 1 },
    ]);
  });

  it('la sonda lee una sola vez: no hay reintento silencioso', async () => {
    const { client, calls } = fakeClient(AVAILABLE_ROW);
    await probeProspectCandidatePersistenceReadiness(client);
    assert.equal(calls.length, 1);
  });

  it('no escribe: el doble sólo expone lectura y la sonda no pide más', async () => {
    // Si la sonda intentara insert/update/upsert/delete, el doble no los tiene y
    // la llamada explotaría con TypeError en vez de resolverse.
    const { client } = fakeClient(AVAILABLE_ROW);
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.equal(probe.status, 'available');
  });
});

// ─── Los cuatro resultados ────────────────────────────────────────────────────

describe('§ 4 — tabla con filas', () => {
  it('una fila con identity_key nula sigue siendo disponibilidad', async () => {
    // Lo que se comprueba es el ESQUEMA, no el contenido: `identity_key` es
    // nullable a propósito (la migración 105 no hace backfill), así que una fila
    // con el valor en NULL prueba que la columna existe y es legible.
    const { client } = fakeClient(AVAILABLE_ROW);
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'available' });
  });
});

describe('§ 4 — tabla vacía', () => {
  it('tabla vacía con data=[] y error null es READY, no un fallo', async () => {
    // El defecto que esto previene: tratar «no hay filas» como «no se pudo
    // comprobar» bloquearía toda corrida en una base recién migrada, que es
    // precisamente el estado en el que la corrección debe desbloquear.
    const { client } = fakeClient({ data: [], error: null });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'available' });
  });
});

// ─── Respuestas malformadas: fail-closed ──────────────────────────────────────

describe('§ 1 — una respuesta malformada NO autoriza gasto', () => {
  // El agujero que cierra esta suite: mientras la disponibilidad se decidía sólo
  // con `error == null`, todas estas respuestas declaraban READY. Un doble
  // incompleto, un cliente a medio inicializar o un proxy que recorta el cuerpo
  // habrían dejado pasar la corrida hasta el gasto, que es el fallo exacto que
  // este preflight existe para impedir. Para un guardrail previo al gasto, la
  // única lectura segura de «no reconozco esta respuesta» es bloquear.
  const malformed: { label: string; response: unknown }[] = [
    { label: 'respuesta {}', response: {} },
    { label: 'respuesta sin data ({ error: null })', response: { error: null } },
    { label: 'data null', response: { data: null, error: null } },
    { label: 'data no array (objeto)', response: { data: {}, error: null } },
    { label: 'data no array (fila suelta de .single())', response: { data: { identity_key: null }, error: null } },
    { label: 'data no array (número)', response: { data: 0, error: null } },
    { label: 'respuesta undefined', response: undefined },
    { label: 'respuesta null', response: null },
    { label: 'respuesta con forma inesperada (string)', response: 'ok' },
    { label: 'respuesta con forma inesperada (arreglo)', response: [] },
    { label: 'error presente pero undefined', response: { data: [], error: undefined } },
    { label: 'sólo data, sin la propiedad error', response: { data: [] } },
  ];

  for (const { label, response } of malformed) {
    it(`${label} ⇒ probe_failed, nunca available`, async () => {
      const { client } = fakeClient(response);
      const probe = await probeProspectCandidatePersistenceReadiness(client);
      assert.deepEqual(probe, { status: 'probe_failed' }, `${label} no puede declarar disponibilidad`);
    });
  }

  it('la única forma que declara READY es la que PostgREST devuelve de verdad', async () => {
    // Enunciado al revés que los casos de arriba: en vez de enumerar lo que
    // bloquea, fija lo que autoriza. Si alguien añade un camino permisivo nuevo,
    // esta prueba no lo detecta — pero la de arriba sí, y esta documenta el
    // contrato mínimo: objeto + error null + data arreglo.
    for (const response of [{ data: [], error: null }, AVAILABLE_ROW]) {
      const { client } = fakeClient(response);
      const probe = await probeProspectCandidatePersistenceReadiness(client);
      assert.deepEqual(probe, { status: 'available' });
    }
  });
});

describe('§ 4 — columna ausente: el error EXACTO de LIVE-QA-2', () => {
  it('PGRST204 sobre identity_key ⇒ identity_key_missing', async () => {
    const { client } = fakeClient({ data: null, error: QA2_IDENTITY_KEY_POSTGREST_ERROR });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'identity_key_missing' });
  });

  it('42703 (undefined_column) de Postgres ⇒ identity_key_missing', async () => {
    const { client } = fakeClient({
      data: null,
      error: {
        code: '42703',
        message: 'column prospect_candidates.identity_key does not exist',
      },
    });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'identity_key_missing' });
  });

  it('otra columna ausente NO se absorbe como nuestro diagnóstico', async () => {
    // Un defecto de esquema distinto tiene que seguir siendo ruidoso: si se
    // reportara como `identity_key_missing`, un operador aplicaría la migración
    // 105 y el problema real seguiría ahí.
    const { client } = fakeClient({
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'employee_count' column of 'prospect_candidates'",
      },
    });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'probe_failed' });
  });
});

describe('§ 4 — error de conexión o de sonda', () => {
  it('42501 insufficient_privilege ⇒ probe_failed, no identity_key_missing', async () => {
    // Caso propio y con nombre porque es el fallo MÁS fácil de confundir con la
    // columna ausente: la tabla existe y la columna existe, pero el rol de la
    // sonda no puede leerla. Diagnosticarlo como `identity_key_missing` mandaría
    // al operador a aplicar una migración que no arregla nada. Bloquea igual
    // —nada se gasta— pero el motivo tiene que ser el correcto.
    const { client } = fakeClient({
      data: null,
      error: { code: '42501', message: 'permission denied for table prospect_candidates' },
    });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'probe_failed' });
  });

  it('un error desconocido con datos sensibles ⇒ probe_failed y nada se filtra', async () => {
    const { client } = fakeClient({
      data: null,
      error: {
        code: 'XX000',
        message:
          'insert into prospect_candidates ... apikey=sk-live-4f3a2b1c host=db.internal:5432',
        details: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      },
    });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'probe_failed' });
    const serialized = JSON.stringify(probe);
    assert.doesNotMatch(serialized, /sk-live/);
    assert.doesNotMatch(serialized, /Bearer/);
    assert.doesNotMatch(serialized, /db\.internal/);
    assert.doesNotMatch(serialized, /insert into/i);
  });

  it('un error devuelto que no es de columna ⇒ probe_failed', async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'probe_failed' });
  });

  it('un error sin código ⇒ probe_failed, nunca available', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'fetch failed' } });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'probe_failed' });
  });

  it('una excepción lanzada por el cliente ⇒ probe_failed, no propaga', async () => {
    const { client } = fakeClient(() => {
      throw new Error('getaddrinfo ENOTFOUND db.example.supabase.co');
    });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'probe_failed' });
  });

  it('un cliente roto ⇒ probe_failed: fail-closed, no fail-open', async () => {
    const broken = { from: () => { throw new TypeError('client is not initialised'); } };
    const probe = await probeProspectCandidatePersistenceReadiness(
      broken as unknown as PersistenceReadinessDbClient,
    );
    assert.deepEqual(probe, { status: 'probe_failed' });
  });
});

// ─── Sanitización ─────────────────────────────────────────────────────────────

describe('§ 4 — el mensaje crudo no sale de la sonda', () => {
  const rawErrors = [
    QA2_IDENTITY_KEY_POSTGREST_ERROR,
    { code: '08006', message: 'connection to server at "10.0.0.7", port 5432 failed' },
    { code: '42501', message: 'permission denied for table prospect_candidates' },
  ];

  it('el resultado sólo lleva `status`: ningún campo transporta el error', async () => {
    for (const error of rawErrors) {
      const { client } = fakeClient({ data: null, error });
      const probe = await probeProspectCandidatePersistenceReadiness(client);
      assert.deepEqual(
        Object.keys(probe),
        ['status'],
        'la sonda no puede añadir campos que arrastren detalle del motor',
      );
    }
  });

  it('serializado entero, el resultado no contiene nada del error original', async () => {
    for (const error of rawErrors) {
      const { client } = fakeClient({ data: null, error });
      const probe = await probeProspectCandidatePersistenceReadiness(client);
      const serialized = JSON.stringify(probe);
      assert.doesNotMatch(serialized, /schema cache/i);
      assert.doesNotMatch(serialized, /PGRST/);
      assert.doesNotMatch(serialized, /permission denied/i);
      assert.doesNotMatch(serialized, /5432/);
      assert.doesNotMatch(serialized, /10\.0\.0\.7/);
      assert.doesNotMatch(serialized, /connection to server/i);
    }
  });
});
