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

type PostgrestResponse = { data?: unknown; error: unknown };

/**
 * Cliente falso que REGISTRA la lectura en vez de ejecutarla.
 *
 * Encadena `from → select → limit` igual que `@supabase/supabase-js`, de modo que
 * el registro sólo se completa si la sonda usa las tres, en ese orden.
 */
function fakeClient(response: PostgrestResponse | (() => never)): {
  client: PersistenceReadinessDbClient;
  calls: ProbeCall[];
} {
  const calls: ProbeCall[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: async (limit: number) => {
          calls.push({ table, columns, limit });
          if (typeof response === 'function') response();
          return response as { error: unknown };
        },
      }),
    }),
  };
  return { client, calls };
}

const AVAILABLE_ROW = { data: [{ identity_key: null }], error: null } satisfies PostgrestResponse;

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
  it('data = [] con error null es READY, no un fallo', async () => {
    // El defecto que esto previene: tratar «no hay filas» como «no se pudo
    // comprobar» bloquearía toda corrida en una base recién migrada, que es
    // precisamente el estado en el que la corrección debe desbloquear.
    const { client } = fakeClient({ data: [], error: null });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'available' });
  });

  it('data ausente con error null también es READY', async () => {
    const { client } = fakeClient({ error: null });
    const probe = await probeProspectCandidatePersistenceReadiness(client);
    assert.deepEqual(probe, { status: 'available' });
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
