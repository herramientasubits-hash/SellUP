/**
 * Agente 2A — el CABLEADO real de la supresión oficial en la server action de privacidad
 * (AGENT2A-PHONE-REVEAL-4O-H2).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTA SUITE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las suites `…-core-4o-h2` y `…-static-4o-h2` fijan el contrato, y `…-postgres-4o-h2` fija las
 * garantías. Lo que ninguna de las tres puede fijar es que la server action REALMENTE llame a la
 * RPC oficial, con qué alcance, en qué orden y qué hace cuando falla. Eso se mide aquí,
 * ejecutando `suppressPhoneCacheEntryAction` de verdad contra un driver de Supabase simulado.
 *
 *   * la DSAR alcanza LAS TRES superficies: caché, candidato y colección OFICIAL;
 *   * el alcance oficial es de PERSONA (`all_suppressible_providers`), nunca de un proveedor;
 *   * un contacto con procedencia NO suprimible entra igualmente en el borrado OFICIAL (la
 *     propiedad de privacidad del hito), aunque su escalar quede intacto;
 *   * los contadores de la auditoría son los que devolvió la transacción, no longitudes de plan;
 *   * un fallo oficial NO se reporta como éxito;
 *   * cero llamadas a proveedores y cero movimientos de crédito.
 *
 * Offline por construcción: sin red, sin Supabase real, sin proveedores, 0 créditos, y no toca
 * Producción. Los números son sintéticos 555.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';
const ROLE_ID = '31000000-0000-4000-8000-000000000001';
const RUN_ID = '40000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '50000000-0000-4000-8000-000000000001';
const PERSON_ID = 'a'.repeat(24);

/** Contacto con procedencia SUPRIMIBLE: entra en el escalar y en el oficial. */
const CONTACT_APOLLO = '20000000-0000-4000-8000-000000000001';
/** Contacto con procedencia MANUAL: sólo entra en el oficial. */
const CONTACT_MANUAL = '20000000-0000-4000-8000-000000000002';

// ═══════════════════════════════════════════════════════════════
// Estado del escenario, reconfigurable por prueba
// ═══════════════════════════════════════════════════════════════

interface Scenario {
  contacts: Array<{ id: string; phone_source: string | null }>;
  /** Sobres que la RPC oficial devuelve, por `contactId`. */
  officialOutcomes: Map<string, unknown>;
  /** `contactId`s cuya RPC oficial debe LANZAR. */
  officialThrows: Set<string>;
}

let scenario: Scenario;

/** Llamadas registradas a la RPC oficial. La evidencia del test. */
let officialCalls: Array<Record<string, unknown>>;
/** Llamadas registradas a la RPC del candidato. */
let candidateCalls: Array<Record<string, unknown>>;
/** Filas insertadas en la auditoría. */
let auditRows: Array<Record<string, unknown>>;
/** UPDATEs sobre `contacts`, con los `.eq` que se pidieron. */
let contactUpdates: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }>;
/** Orden global de las operaciones, para poder afirmar la SECUENCIA. */
let timeline: string[];

const defaultOfficialEnvelope = (overrides: Record<string, unknown> = {}) => ({
  status: 'suppressed',
  sources_suppressed: 2,
  phones_tombstoned: 1,
  survivor_count: 0,
  primary_dedupe_key: null,
  primary_changed: true,
  scalar_synced: false,
  scalar_guarded_by_provenance: false,
  contact_settled: true,
  ...overrides,
});

function resetScenario() {
  scenario = {
    contacts: [
      { id: CONTACT_APOLLO, phone_source: 'apollo_reveal' },
      { id: CONTACT_MANUAL, phone_source: 'manual' },
    ],
    officialOutcomes: new Map(),
    officialThrows: new Set(),
  };
  officialCalls = [];
  candidateCalls = [];
  auditRows = [];
  contactUpdates = [];
  timeline = [];
}

resetScenario();

// ═══════════════════════════════════════════════════════════════
// Driver simulado de Supabase
// ═══════════════════════════════════════════════════════════════

/**
 * Cadena PostgREST mínima y UNIFORME para los dos clientes.
 *
 * Acumula los `.eq`/`.in`/`.is`/`.not` que el código pidió —son la evidencia del test— y
 * resuelve cuando se hace `await`, `.select()`, `.single()` o `.maybeSingle()`. Deliberadamente
 * tonta: no simula PostgREST, sólo responde lo que el escenario declara, para que lo que se
 * mide sea el CABLEADO y no una reimplementación del driver.
 */
function query(
  table: string,
  kind: 'select' | 'update' | 'upsert',
  payload: Record<string, unknown> | null,
  resolveRows: (
    table: string,
    kind: string,
    filters: Record<string, unknown>,
    payload: Record<string, unknown> | null,
  ) => unknown[],
) {
  const filters: Record<string, unknown> = {};
  const rows = () => resolveRows(table, kind, filters, payload);
  const result = () => ({ data: rows(), error: null });
  const one = () => {
    const all = rows();
    return { data: all.length > 0 ? all[0] : null, error: null };
  };

  const self: Record<string, unknown> = {};
  for (const op of ['eq', 'in', 'is', 'not', 'order', 'limit']) {
    self[op] = (column: string, value: unknown) => {
      filters[column] = value;
      return self;
    };
  }
  self.select = () => self;
  self.single = async () => one();
  self.maybeSingle = async () => one();
  // Un `await` sobre la cadena resuelve como una lista.
  self.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled);
  return self;
}

/** Las filas que cada tabla devuelve, según el escenario. */
function resolveRows(
  table: string,
  kind: string,
  filters: Record<string, unknown>,
  payload: Record<string, unknown> | null,
): unknown[] {
  if (kind === 'select') {
    if (table === 'internal_users') {
      return [{ id: ACTOR_ID, role_id: ROLE_ID }];
    }
    if (table === 'roles') {
      return [{ key: 'admin' }];
    }
    if (table === 'contact_enrichment_candidates') {
      return [
        {
          id: CANDIDATE_ID,
          enrichment_run_id: RUN_ID,
          enrichment_metadata: { review: { created_contact_id: CONTACT_APOLLO } },
          matched_contacts_id: CONTACT_MANUAL,
          run: { account_id: ACCOUNT_ID },
        },
      ];
    }
    if (table === 'contacts') {
      return scenario.contacts.map((contact) => ({
        id: contact.id,
        account_id: ACCOUNT_ID,
        phone_source: contact.phone_source,
        metadata: { source_candidate_id: CANDIDATE_ID },
      }));
    }
    return [];
  }

  if (table === 'contacts') {
    contactUpdates.push({ payload: payload ?? {}, filters });
    const contact = scenario.contacts.find((row) => row.id === filters.id);
    // El `.eq('phone_source', observado)` REAL: si no coincide, 0 filas.
    if (!contact || contact.phone_source !== filters.phone_source) return [];
    return [{ id: filters.id }];
  }
  if (table === 'phone_reveal_cache') return [{ id: 'cache-row-1' }];
  return [];
}

function makeClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: ACTOR_ID } }, error: null }),
    },
    from: (table: string) => ({
      select: () => {
        timeline.push(`select:${table}`);
        return query(table, 'select', null, resolveRows);
      },
      update: (payload: Record<string, unknown>) => {
        timeline.push(`update:${table}`);
        return query(table, 'update', payload, resolveRows);
      },
      upsert: (payload: Record<string, unknown>) => {
        timeline.push(`upsert:${table}`);
        return query(table, 'upsert', payload, resolveRows);
      },
      insert: async (row: Record<string, unknown>) => {
        timeline.push(`insert:${table}`);
        if (table === 'phone_reveal_suppression_audit') auditRows.push(row);
        return { error: null };
      },
    }),
    rpc: async (fn: string, params: Record<string, unknown>) => {
      timeline.push(`rpc:${fn}`);
      if (fn === 'suppress_official_contact_phone_sources') {
        officialCalls.push(params);
        const contactId = params.p_contact_id as string;
        if (scenario.officialThrows.has(contactId)) {
          // El mensaje lleva un número A PROPÓSITO: así se comprueba que la acción NO lo
          // propaga (PostgreSQL cita valores de la query en sus errores).
          return { data: null, error: { message: 'boom +15550000001' } };
        }
        return {
          data: scenario.officialOutcomes.get(contactId) ?? defaultOfficialEnvelope(),
          error: null,
        };
      }
      if (fn === 'suppress_candidate_phone_collection') {
        candidateCalls.push(params);
        return {
          data: {
            status: 'suppressed',
            suppressed_count: 3,
            already_suppressed_count: 0,
            survivor_count: 0,
            primary_dedupe_key: null,
            primary_changed: true,
            candidate_phone_cleared: true,
            candidate_updated: true,
            candidate_settled: true,
          },
          error: null,
        };
      }
      throw new Error(`BUG: RPC inesperada ${fn}`);
    },
  };
}

mock.module('@/lib/supabase/admin', {
  namedExports: { createSupabaseAdminClient: makeClient },
});

mock.module('@/lib/supabase/server', {
  namedExports: { createClient: async () => makeClient() },
});

mock.module('next/navigation', {
  namedExports: {
    redirect: () => {
      throw new Error('BUG: la acción redirigió en lugar de resolver el actor');
    },
  },
});

// Los proveedores se mockean para que NINGUNA ruta pueda alcanzarlos. Si el camino de
// privacidad llamara a uno, el test explota en vez de gastar.
mock.module('@/server/integrations/apollo-client', {
  namedExports: {
    revealApolloPhone: async () => {
      throw new Error('BUG: Apollo fue llamado en el camino de PRIVACIDAD');
    },
  },
});

mock.module('@/server/integrations/lusha-client', {
  namedExports: {
    revealLushaPhone: async () => {
      throw new Error('BUG: Lusha fue llamado en el camino de PRIVACIDAD');
    },
  },
});

describe('4O-H2 — cableado de la supresión oficial en la server action', () => {
  let suppressPhoneCacheEntryAction: (input: {
    providerPersonId: string;
    accountId: string;
    countryCode: string | null;
    reason: string;
  }) => Promise<Record<string, unknown>>;

  beforeEach(async () => {
    resetScenario();
    if (!suppressPhoneCacheEntryAction) {
      const mod = await import('../phone-cache-suppression-actions');
      suppressPhoneCacheEntryAction =
        mod.suppressPhoneCacheEntryAction as typeof suppressPhoneCacheEntryAction;
    }
  });

  const run = () =>
    suppressPhoneCacheEntryAction({
      providerPersonId: PERSON_ID,
      accountId: ACCOUNT_ID,
      countryCode: 'CO',
      reason: 'dsar_erasure_request',
    });

  it('el arnés está bien montado: el actor resuelve y la acción corre', async () => {
    // Prueba de no-vacuidad. Si el actor no resolviera, todas las demás pasarían por la razón
    // equivocada (0 llamadas porque nunca se llegó al plan).
    const result = await run();
    assert.equal(result.rejection, null, `rechazo inesperado: ${String(result.rejection)}`);
    assert.ok(officialCalls.length > 0, 'la RPC oficial debe haberse llamado');
  });

  it('la DSAR alcanza las TRES superficies', async () => {
    await run();
    assert.ok(timeline.includes('rpc:suppress_candidate_phone_collection'), 'candidato');
    assert.ok(timeline.includes('rpc:suppress_official_contact_phone_sources'), 'oficial');
    assert.ok(timeline.includes('insert:phone_reveal_suppression_audit'), 'auditoría');
  });

  it('el alcance oficial es de PERSONA, y `p_provider` viaja NULL', async () => {
    await run();
    for (const call of officialCalls) {
      assert.equal(call.p_provider_scope, 'all_suppressible_providers');
      assert.equal(call.p_provider, null);
      assert.equal(call.p_dedupe_key, null, 'la DSAR no acota a un número');
      assert.equal(call.p_suppression_reason, 'data_subject_request');
      assert.equal(call.p_suppressed_by, ACTOR_ID);
    }
  });

  it('el motivo se TRADUCE del vocabulario de la 099 al de la 114', async () => {
    // Un pass-through fallaría la CHECK en el 100% de las filas — el 23514 de #238.
    await run();
    assert.ok(officialCalls.length > 0);
    for (const call of officialCalls) {
      assert.notEqual(call.p_suppression_reason, 'dsar_erasure_request');
      assert.equal(call.p_suppression_reason, 'data_subject_request');
    }
  });

  it('LA PROPIEDAD: un contacto MANUAL entra en el borrado OFICIAL', async () => {
    // Su escalar queda intacto (la 115 lo guarda), pero sus filas oficiales de proveedor SÍ se
    // borran. Excluirlo dejaría vivos números pagados sobre el titular de la DSAR sólo porque
    // alguien había teclado además un número a mano.
    await run();
    const targeted = officialCalls.map((call) => call.p_contact_id).sort();
    assert.deepEqual(targeted, [CONTACT_APOLLO, CONTACT_MANUAL].sort());

    // Y el escalar heredado SÓLO se toca en el que tiene procedencia suprimible.
    assert.deepEqual(
      contactUpdates.map((update) => update.filters.id),
      [CONTACT_APOLLO],
    );
  });

  it('el borrado OFICIAL ocurre DESPUÉS del escalar heredado', async () => {
    // Es lo que hace el hito estrictamente aditivo sobre E1–E4.1.
    await run();
    const lastLegacy = timeline.lastIndexOf('update:contacts');
    const firstOfficial = timeline.indexOf('rpc:suppress_official_contact_phone_sources');
    assert.ok(lastLegacy > -1 && firstOfficial > -1);
    assert.ok(lastLegacy < firstOfficial, 'el escalar heredado va primero');
  });

  it('los contadores de la auditoría son los de la TRANSACCIÓN', async () => {
    scenario.officialOutcomes.set(
      CONTACT_APOLLO,
      defaultOfficialEnvelope({ sources_suppressed: 2, phones_tombstoned: 1, survivor_count: 1 }),
    );
    scenario.officialOutcomes.set(
      CONTACT_MANUAL,
      defaultOfficialEnvelope({
        sources_suppressed: 1,
        phones_tombstoned: 0,
        survivor_count: 3,
        scalar_guarded_by_provenance: true,
        primary_changed: false,
      }),
    );

    const result = await run();

    assert.equal(result.officialPhoneSourcesSuppressed, 3, '2 + 1');
    assert.equal(result.officialPhoneRowsTombstoned, 1, '1 + 0');

    assert.equal(auditRows.length, 1);
    const row = auditRows[0];
    assert.equal(row.official_phone_sources_suppressed, 3);
    assert.equal(row.official_phone_rows_tombstoned, 1);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.official_phone_contacts_targeted, 2);
    assert.equal(metadata.official_phone_survivor_count, 4, '1 + 3');
    assert.equal(metadata.official_phone_primary_changed, true);
    assert.equal(metadata.official_phone_scalar_guarded, 1, 'sólo el manual quedó guardado');
  });

  it('supervivencia CRUZADA: 0 tombstones con retiradas > 0 es un resultado VÁLIDO', async () => {
    // Retirar Apollo dejando vivo el número por Lusha no es un fallo, y la auditoría tiene que
    // poder distinguirlo de «no había nada».
    for (const contactId of [CONTACT_APOLLO, CONTACT_MANUAL]) {
      scenario.officialOutcomes.set(
        contactId,
        defaultOfficialEnvelope({ sources_suppressed: 1, phones_tombstoned: 0, survivor_count: 1 }),
      );
    }
    const result = await run();
    assert.equal(result.ok, true);
    assert.equal(result.failureCode, null);
    assert.equal(result.officialPhoneSourcesSuppressed, 2);
    assert.equal(result.officialPhoneRowsTombstoned, 0);
  });

  it('`no_official_collection` es ÉXITO: es la inercia en Producción', async () => {
    for (const contactId of [CONTACT_APOLLO, CONTACT_MANUAL]) {
      scenario.officialOutcomes.set(
        contactId,
        defaultOfficialEnvelope({
          status: 'no_official_collection',
          sources_suppressed: 0,
          phones_tombstoned: 0,
          survivor_count: 0,
          primary_changed: false,
        }),
      );
    }
    const result = await run();
    assert.equal(result.ok, true, 'no había colección oficial: no hay nada a medias');
    assert.equal(result.failureCode, null);
    assert.equal(result.officialPhoneSourcesSuppressed, 0);
    assert.equal(result.officialPhoneRowsTombstoned, 0);
  });

  it('§ 38 — un fallo oficial NO se reporta como éxito', async () => {
    scenario.officialThrows.add(CONTACT_APOLLO);
    const result = await run();
    assert.equal(result.ok, false);
    assert.equal(result.failureCode, 'official_phone_suppression_failed');
    // Y la auditoría se escribe igual: la constancia del intento es parte de la garantía.
    assert.equal(auditRows.length, 1);
  });

  it('un estado que NO liquida tampoco se reporta como éxito', async () => {
    scenario.officialOutcomes.set(
      CONTACT_MANUAL,
      defaultOfficialEnvelope({ status: 'contact_not_found', contact_settled: true }),
    );
    const result = await run();
    assert.equal(result.ok, false);
    assert.equal(result.failureCode, 'official_phone_suppression_failed');
  });

  it('un fallo en UN contacto no impide intentar el otro', async () => {
    scenario.officialThrows.add(CONTACT_APOLLO);
    await run();
    assert.equal(officialCalls.length, 2, 'el bucle continúa tras el fallo');
  });

  it('el fallo oficial NO enmascara un fallo anterior del candidato', async () => {
    // Precedencia `??`: gana el primero, que es el que describe la superficie que falló antes.
    scenario.officialThrows.add(CONTACT_APOLLO);
    const result = await run();
    assert.equal(result.failureCode, 'official_phone_suppression_failed');
    assert.equal(result.rejection, null);
  });

  it('CERO llamadas a proveedores y CERO movimientos de crédito', async () => {
    await run();
    for (const entry of timeline) {
      assert.doesNotMatch(
        entry,
        /reserve|budget|usage_log|waterfall_run|credit/i,
        `el camino de privacidad tocó contabilidad: ${entry}`,
      );
    }
    // Y sólo se invocaron las DOS RPC de supresión.
    const rpcs = [...new Set(timeline.filter((e) => e.startsWith('rpc:')))].sort();
    assert.deepEqual(rpcs, [
      'rpc:suppress_candidate_phone_collection',
      'rpc:suppress_official_contact_phone_sources',
    ]);
  });

  it('nada de lo que sale de la acción contiene PII', async () => {
    scenario.officialThrows.add(CONTACT_APOLLO);
    const result = await run();
    const serialized = JSON.stringify({ result, auditRows });
    assert.doesNotMatch(serialized, /\+1555|5550000|@example/);
  });
});
