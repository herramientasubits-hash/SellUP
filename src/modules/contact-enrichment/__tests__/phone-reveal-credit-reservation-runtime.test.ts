/**
 * Tests — RECONCILIACIÓN de la reserva en el cableado REAL
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4E)
 *
 * Los otros dos archivos de 4E prueban decisiones puras. Este prueba el ENGANCHE: que la
 * liquidación se dispare por sí sola en el único paso por el que pasan TODOS los cierres
 * de una corrida (`updateWaterfallRun`), sin que webhook, cron L2, revisión manual L3 ni
 * el cierre tras el START tengan que acordarse de invocarla.
 *
 * Lo que se fija:
 *   * un patch TERMINAL liquida; un patch NO terminal no toca nada (la exposición se
 *     mantiene ENTERA mientras la corrida pueda gastar);
 *   * la liquidación usa los HECHOS DE LA FILA, no el patch: se relee la corrida;
 *   * costo reportado ⇒ se confirma esa cifra; costo desconocido ⇒ se confirma el TOPE
 *     con `assumed_cap`; pata nunca intentada ⇒ se libera;
 *   * una corrida sin grupo de reserva (anterior a la migración 104) no rompe nada;
 *   * un fallo de la liquidación NO propaga: dejaría la fila `reserved`, que es el estado
 *     conservador, y jamás convierte un webhook correcto en un 5xx.
 *
 * Offline por construcción: sin red, sin Supabase real, sin proveedores, 0 créditos.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// Estado observable del driver simulado
// ═══════════════════════════════════════════════════════════════

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

let rpcCalls: RpcCall[] = [];
/** Filas `reserved` que devuelve la tabla de reservas para el grupo consultado. */
let reservedRows: Record<string, unknown>[] = [];
/** Fila de la corrida que devuelve el SELECT por id. */
let runRow: Record<string, unknown> | null = null;
/** Error que devuelve la LECTURA de la corrida (para el caso "la liquidación falla"). */
let runReadError: { code: string; message: string } | null = null;
/** Error que devuelve el UPDATE de la corrida. */
let runUpdateError: { code: string; message: string } | null = null;

const RUN_ID = 'run-4e';
const GROUP_ID = 'group-4e';

function chain(result: { data: unknown; error: unknown }): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'gt',
    'is',
    'order',
    'limit',
    'maybeSingle',
    'single',
    'insert',
    'update',
    'upsert',
  ]) {
    self[method] = () => self;
  }
  self.then = (resolve: (v: unknown) => unknown): unknown => resolve(result);
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'phone_reveal_waterfall_runs') {
          return {
            ...chain({ data: runRow, error: runReadError }),
            select: () => chain({ data: runRow, error: runReadError }),
            update: () => chain({ data: [{ id: RUN_ID }], error: runUpdateError }),
          };
        }
        if (table === 'phone_reveal_credit_reservations') {
          return chain({ data: reservedRows, error: null });
        }
        return chain({ data: null, error: null });
      },
      rpc: (fn: string, params: Record<string, unknown>) => {
        rpcCalls.push({ fn, params });
        return chain({
          data: fn === 'confirm_phone_reveal_credits' ? 'confirmed' : 'released',
          error: null,
        });
      },
    }),
  },
});

// Los proveedores se mockean para que un error de import no los alcance nunca. Ninguna
// de estas funciones puede ejecutarse en este archivo.
mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    enrichLushaContactPhonesForFallback: async () => {
      throw new Error('BUG: Lusha fue llamado en la reconciliación');
    },
  },
});
mock.module('@/server/services/lusha-connection', {
  namedExports: { getLushaApiKey: async () => 'never-used' },
});
mock.module('@/modules/usage-tracking/logging', {
  namedExports: { logProviderUsage: async () => true },
});

type WaterfallDeps = typeof import('../phone-reveal-waterfall-deps');
let deps: WaterfallDeps;

before(async () => {
  deps = await import('../phone-reveal-waterfall-deps');
});

/** Fila de corrida con los hechos terminales que decidan la liquidación. */
function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN_ID,
    candidate_id: 'cand-4e',
    status: 'exhausted',
    run_mode: 'full_waterfall',
    authorized_at: '2026-08-04T11:00:00.000Z',
    authorized_by: 'user-admin',
    authorized_by_role: 'admin',
    max_credits_authorized: 13,
    apollo_attempted_at: '2026-08-04T11:00:00.000Z',
    apollo_outcome: 'no_phone_found',
    apollo_cost_credits: null,
    apollo_cost_source: null,
    lusha_eligible: true,
    lusha_skipped_reason: null,
    lusha_attempted_at: null,
    lusha_outcome: null,
    lusha_cost_credits: null,
    lusha_cost_source: null,
    final_provider: 'none',
    completed_at: '2026-08-04T11:05:00.000Z',
    error_code: null,
    credit_reservation_group_id: GROUP_ID,
    ...overrides,
  };
}

const APOLLO_RESERVED = {
  id: 'res-apollo',
  provider_key: 'apollo',
  credits_reserved: 8,
  status: 'reserved',
};
const LUSHA_RESERVED = {
  id: 'res-lusha',
  provider_key: 'lusha',
  credits_reserved: 5,
  status: 'reserved',
};

beforeEach(() => {
  rpcCalls = [];
  reservedRows = [APOLLO_RESERVED, LUSHA_RESERVED];
  runRow = run();
  runReadError = null;
  runUpdateError = null;
});

function callsFor(fn: string): RpcCall[] {
  return rpcCalls.filter((c) => c.fn === fn);
}

// ═══════════════════════════════════════════════════════════════
// 1. El enganche: solo los cierres liquidan
// ═══════════════════════════════════════════════════════════════

describe('4E — la liquidación se dispara en los cierres, no antes', () => {
  it('un patch NO terminal no liquida nada: la exposición se mantiene ENTERA', async () => {
    await deps.updateWaterfallRun(RUN_ID, { apolloOutcome: 'no_phone_found' });
    assert.deepEqual(rpcCalls, [], 'ninguna confirmación ni liberación');
  });

  it('un patch que solo mueve a `lusha_running` tampoco liquida', async () => {
    await deps.updateWaterfallRun(RUN_ID, { status: 'lusha_running' });
    assert.deepEqual(rpcCalls, []);
  });

  it('cada estado TERMINAL liquida', async () => {
    for (const status of [
      'completed_apollo',
      'completed_lusha',
      'exhausted',
      'error',
      'aborted',
    ] as const) {
      rpcCalls = [];
      runRow = run({ status });
      await deps.updateWaterfallRun(RUN_ID, { status });
      assert.ok(rpcCalls.length > 0, `${status} debería liquidar`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Qué se confirma y qué se libera
// ═══════════════════════════════════════════════════════════════

describe('4E — reconciliación contra el costo real de cada pata', () => {
  it('Apollo con costo REPORTADO se confirma con esa cifra, no con el tope', async () => {
    runRow = run({
      status: 'completed_apollo',
      apollo_cost_credits: 3,
      apollo_cost_source: 'reported',
      final_provider: 'apollo',
    });
    await deps.updateWaterfallRun(RUN_ID, { status: 'completed_apollo' });

    const confirms = callsFor('confirm_phone_reveal_credits');
    const apollo = confirms.find((c) => c.params.p_reservation_id === 'res-apollo');
    assert.equal(apollo?.params.p_credits_confirmed, 3);
    assert.equal(apollo?.params.p_cost_truth, 'reported');
  });

  it('Apollo con costo DESCONOCIDO se confirma con el TOPE (8) y `assumed_cap`', async () => {
    // Nunca 0 y nunca un release: no reportar no es no cobrar.
    runRow = run({ apollo_cost_credits: null, apollo_cost_source: 'unknown' });
    await deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' });

    const apollo = callsFor('confirm_phone_reveal_credits').find(
      (c) => c.params.p_reservation_id === 'res-apollo',
    );
    assert.equal(apollo?.params.p_credits_confirmed, 8);
    assert.equal(apollo?.params.p_cost_truth, 'assumed_cap');
    assert.equal(
      callsFor('release_phone_reveal_credits').some(
        (c) => c.params.p_reservation_id === 'res-apollo',
      ),
      false,
      'una pata intentada con costo desconocido NO se libera',
    );
  });

  it('la pata Lusha nunca intentada se LIBERA con `leg_never_attempted`', async () => {
    await deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' });
    const releases = callsFor('release_phone_reveal_credits');
    assert.equal(releases.length, 1);
    assert.equal(releases[0].params.p_reservation_id, 'res-lusha');
    assert.equal(releases[0].params.p_reason, 'leg_never_attempted');
  });

  it('la pata Lusha intentada con costo reportado se confirma con ese costo', async () => {
    runRow = run({
      status: 'completed_lusha',
      lusha_attempted_at: '2026-08-04T11:02:00.000Z',
      lusha_cost_credits: 5,
      lusha_cost_source: 'reported',
      final_provider: 'lusha',
    });
    await deps.updateWaterfallRun(RUN_ID, { status: 'completed_lusha' });

    const lusha = callsFor('confirm_phone_reveal_credits').find(
      (c) => c.params.p_reservation_id === 'res-lusha',
    );
    assert.equal(lusha?.params.p_credits_confirmed, 5);
    assert.equal(lusha?.params.p_cost_truth, 'reported');
    assert.deepEqual(callsFor('release_phone_reveal_credits'), []);
  });

  it('modalidad legacy: Apollo no corrió aquí ⇒ su pata se libera, la de Lusha se liquida', async () => {
    runRow = run({
      run_mode: 'legacy_lusha_only',
      status: 'exhausted',
      apollo_attempted_at: null,
      apollo_cost_source: 'unknown',
      lusha_attempted_at: '2026-08-04T11:02:00.000Z',
      lusha_outcome: 'no_phone_found',
      lusha_cost_credits: null,
      lusha_cost_source: null,
    });
    await deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' });

    const releases = callsFor('release_phone_reveal_credits');
    assert.equal(releases[0].params.p_reservation_id, 'res-apollo');
    // Lusha SÍ corrió y su costo no se reportó ⇒ tope, no 0.
    const lusha = callsFor('confirm_phone_reveal_credits').find(
      (c) => c.params.p_reservation_id === 'res-lusha',
    );
    assert.equal(lusha?.params.p_credits_confirmed, 5);
    assert.equal(lusha?.params.p_cost_truth, 'assumed_cap');
  });

  it('las patas ya confirmadas o liberadas no se retocan (la lectura filtra `reserved`)', async () => {
    reservedRows = [];
    await deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' });
    assert.deepEqual(rpcCalls, []);
  });

  it('una corrida sin grupo de reserva (anterior a la 104) no liquida ni rompe', async () => {
    runRow = run({ credit_reservation_group_id: null });
    await deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' });
    assert.deepEqual(rpcCalls, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Un fallo de liquidación no puede romper el cierre
// ═══════════════════════════════════════════════════════════════

describe('4E — la liquidación es best-effort y conserva la exposición ante un fallo', () => {
  it('si la corrida no se puede releer, no se libera nada y NO se propaga', async () => {
    runReadError = { code: '57014', message: 'canceling statement due to statement timeout' };
    // No lanza: un fallo aquí no puede convertir un webhook correcto en 5xx.
    await deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' });
    assert.deepEqual(
      callsFor('release_phone_reveal_credits'),
      [],
      'no se libera exposición a ciegas',
    );
  });

  it('el UPDATE de la corrida SÍ propaga: ese error no es cosmético', async () => {
    runUpdateError = { code: '42P01', message: 'relation does not exist' };
    await assert.rejects(() => deps.updateWaterfallRun(RUN_ID, { status: 'exhausted' }));
    // Y no se liquidó: la corrida no llegó a cerrarse.
    assert.deepEqual(rpcCalls, []);
  });
});
