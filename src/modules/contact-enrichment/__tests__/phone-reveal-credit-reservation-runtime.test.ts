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

/** Guion de la operación atómica: una entrada por invocación, en orden. */
interface ReserveAndCreateStep {
  data?: unknown;
  error?: { code: string; message: string } | null;
  throws?: Error;
}
let reserveAndCreateScript: ReserveAndCreateStep[] = [];

// ── Camino UNBOUNDED (AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1) ──
//
// Una autorización cuyos pozos son TODOS `not_configured` llega aquí sin patas, y ese
// borde no puede pasar por la RPC: `reserve_and_create_phone_reveal_run` exige
// `jsonb_array_length(p_legs) > 0`. Se escribe la corrida con un INSERT directo, así que
// el driver simulado necesita su propio guion para el INSERT y para la RELECTURA por
// `authorization_key` que clasifica un 23505.

/** Guion del INSERT de la corrida UNBOUNDED: una entrada por invocación, en orden. */
interface RunInsertStep {
  data?: unknown;
  error?: { code: string; message: string } | null;
  throws?: Error;
}
let runInsertScript: RunInsertStep[] = [];
/** Filas realmente enviadas al INSERT. Prueba QUÉ columnas viajan. */
let runInserts: Record<string, unknown>[] = [];
/** Resultado de la relectura `.eq('authorization_key', …)`. `undefined` ⇒ sin fila. */
let runByAuthorizationKeyRow: Record<string, unknown> | null = null;
let runByAuthorizationKeyError: { code: string; message: string } | null = null;

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

/**
 * Cadena de SELECT de la tabla de corridas que RECUERDA por qué columna se filtró. Sin
 * esto, la relectura por `authorization_key` devolvería la fila de la liquidación y un
 * conflicto se leería como golpe idempotente de otra corrida.
 */
function runsSelectChain(): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  let byAuthorizationKey = false;
  for (const method of [
    'select',
    'in',
    'gt',
    'is',
    'order',
    'limit',
    'maybeSingle',
    'single',
  ]) {
    self[method] = () => self;
  }
  self.eq = (column: string) => {
    if (column === 'authorization_key') byAuthorizationKey = true;
    return self;
  };
  self.then = (resolve: (v: unknown) => unknown): unknown =>
    resolve(
      byAuthorizationKey
        ? { data: runByAuthorizationKeyRow, error: runByAuthorizationKeyError }
        : { data: runRow, error: runReadError },
    );
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'phone_reveal_waterfall_runs') {
          return {
            ...chain({ data: runRow, error: runReadError }),
            // El SELECT resuelve por la COLUMNA filtrada: la liquidación lee por `id` y
            // la clasificación del 23505 lee por `authorization_key`. Distinguirlas aquí
            // es lo que permite que las dos lecturas coexistan sin pisarse.
            select: () => runsSelectChain(),
            update: () => chain({ data: [{ id: RUN_ID }], error: runUpdateError }),
            insert: (row: Record<string, unknown>) => {
              runInserts.push(row);
              const step = runInsertScript.shift();
              if (step?.throws) throw step.throws;
              return chain({ data: step?.data ?? null, error: step?.error ?? null });
            },
          };
        }
        if (table === 'phone_reveal_credit_reservations') {
          return chain({ data: reservedRows, error: null });
        }
        return chain({ data: null, error: null });
      },
      rpc: (fn: string, params: Record<string, unknown>) => {
        rpcCalls.push({ fn, params });
        // AGENT2A-PHONE-WATERFALL-4F: la operación atómica tiene su propio guion, para
        // poder modelar la RESPUESTA PERDIDA (una excepción de transporte con la
        // transacción ya comprometida) y el reintento que la resuelve.
        if (fn === 'reserve_and_create_phone_reveal_run') {
          const step = reserveAndCreateScript.shift();
          if (!step) return chain({ data: null, error: null });
          if (step.throws) throw step.throws;
          return chain({ data: step.data ?? null, error: step.error ?? null });
        }
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
type ReservationDeps = typeof import('../phone-reveal-credit-reservation-deps');
let deps2: ReservationDeps;

before(async () => {
  deps = await import('../phone-reveal-waterfall-deps');
  deps2 = await import('../phone-reveal-credit-reservation-deps');
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
  reserveAndCreateScript = [];
  runInsertScript = [];
  runInserts = [];
  runByAuthorizationKeyRow = null;
  runByAuthorizationKeyError = null;
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


// ═══════════════════════════════════════════════════════════════
// 4. La operación atómica en el cableado real (4F)
// ═══════════════════════════════════════════════════════════════
//
// El wrapper es el único punto que puede distinguir "no se ejecutó nada" de "se ejecutó
// y no me enteré" — y no puede: por eso reintenta con la MISMA clave. Estos tests fijan
// que ese reintento exista, que reuse la clave y que se detenga.

describe('4F — reservePhoneRevealCreditsAndCreateRun: reintento con la misma clave', () => {
  const REQUEST = {
    candidateId: 'cand-4f',
    authorizedBy: 'user-admin',
    reservationGroupId: 'group-4f',
    authorizationKey: 'key-4f',
    legs: [
      {
        providerKey: 'apollo' as const,
        credits: 8,
        limitCredits: 100,
        consumedCredits: 0,
        scopeType: 'global' as const,
        scopeId: null,
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-31T23:59:59.999Z',
      },
    ],
  };
  const RUN_PAYLOAD = { status: 'apollo_in_flight', run_mode: 'full_waterfall' };

  function reserveCalls() {
    return rpcCalls.filter((c) => c.fn === 'reserve_and_create_phone_reveal_run');
  }

  it('camino feliz: UNA invocación y el envelope se traduce entero', async () => {
    reserveAndCreateScript = [
      {
        data: {
          status: 'created',
          run_id: 'run-nuevo',
          reservation_group_id: 'group-4f',
          reservations: [
            { id: 'res-1', provider_key: 'apollo', credits_reserved: 8 },
          ],
        },
      },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'created',
      runId: 'run-nuevo',
      reservationGroupId: 'group-4f',
      reservations: [{ id: 'res-1', providerKey: 'apollo', creditsReserved: 8 }],
    });
    assert.equal(reserveCalls().length, 1, 'sin reintento cuando no hace falta');
  });

  it('RESPUESTA PERDIDA: reintenta UNA vez con la MISMA clave y encuentra la corrida', async () => {
    // Primer intento: la transacción hizo COMMIT y el driver lanzó igualmente.
    reserveAndCreateScript = [
      { throws: new Error('socket hang up') },
      {
        data: {
          status: 'already_created',
          run_id: 'run-commitida',
          reservation_group_id: 'group-4f',
        },
      },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'already_created',
      runId: 'run-commitida',
      reservationGroupId: 'group-4f',
    });
    const calls = reserveCalls();
    assert.equal(calls.length, 2, 'exactamente un reintento');
    assert.equal(
      calls[0].params.p_authorization_key,
      calls[1].params.p_authorization_key,
      'el reintento DEBE reusar la clave: sin eso sería una segunda autorización',
    );
    assert.equal(calls[1].params.p_authorization_key, 'key-4f');
  });

  it('dos fallos de transporte ⇒ unavailable, y NO un tercer intento', async () => {
    reserveAndCreateScript = [
      { throws: new Error('socket hang up') },
      { throws: new Error('socket hang up') },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'reserve_and_create_threw',
    });
    assert.equal(reserveCalls().length, 2, 'un solo reintento, no un bucle');
  });

  it('un error REPORTADO por el servidor no se reintenta: la transacción ya se deshizo', async () => {
    reserveAndCreateScript = [
      { error: { code: '42883', message: 'function does not exist' } },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'reserve_and_create_rpc_error',
    });
    assert.equal(reserveCalls().length, 1);
  });

  it('`created` sin run_id se lee como INDISPONIBLE, nunca como éxito', async () => {
    // Sin id no hay corrida a la que atribuir el gasto ni exposición que liquidar.
    reserveAndCreateScript = [{ data: { status: 'created' } }];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'created_without_rows',
    });
  });

  it('`already_created` sin run_id tampoco se acepta', async () => {
    reserveAndCreateScript = [{ data: { status: 'already_created' } }];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'already_created_without_run',
    });
  });

  it('`create_conflict` y `already_reserved` viajan tal cual', async () => {
    for (const status of ['create_conflict', 'already_reserved'] as const) {
      reserveAndCreateScript = [{ data: { status } }];
      const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
        reservation: REQUEST,
        run: RUN_PAYLOAD,
      });
      assert.deepEqual(outcome, { status });
    }
  });

  it('un status DESCONOCIDO se lee como indisponible, nunca como autorización', async () => {
    reserveAndCreateScript = [{ data: { status: 'algo_nuevo' } }];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, { status: 'unavailable', detail: 'unknown_status' });
  });
});


// ═══════════════════════════════════════════════════════════════
// 5. UNBOUNDED: sin regla de crédito, corrida SIN reserva
// ═══════════════════════════════════════════════════════════════
//
// AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1.
//
// Cuando NINGÚN proveedor exigido tiene regla de crédito, el constructor de patas
// devuelve `[]` y este borde deja de llamar a la RPC: `reserve_and_create_phone_reveal_run`
// exige `jsonb_array_length(p_legs) > 0` y rechazaría con `invalid_input` exactamente el
// caso que el hito autoriza. Se escribe la corrida directamente, porque no hay saldo que
// serializar ni fila de reserva que pueda quedar huérfana.
//
// Lo que estos tests fijan:
//   * 0 llamadas a la RPC y 1 INSERT, con la identidad de la autorización dentro;
//   * `created` con `reservations: []` — el dato honesto, no un error;
//   * 23505 con la MISMA clave ⇒ `already_created` (idempotencia intacta);
//   * 23505 con la clave libre ⇒ `create_conflict`, sin afirmar corrida viva;
//   * cualquier fallo ⇒ `unavailable`, y por lo tanto 0 proveedores y 0 créditos.

describe('UNBOUNDED — patas vacías crean la corrida sin pasar por la RPC', () => {
  const UNBOUNDED_REQUEST = {
    candidateId: 'cand-unbounded',
    authorizedBy: 'user-admin',
    reservationGroupId: 'group-unbounded',
    authorizationKey: 'key-unbounded',
    legs: [] as const,
  };
  const RUN_PAYLOAD = {
    status: 'apollo_in_flight',
    run_mode: 'full_waterfall',
    max_credits_authorized: 14,
  };

  function reserveCalls() {
    return rpcCalls.filter((c) => c.fn === 'reserve_and_create_phone_reveal_run');
  }

  it('created con reservations: [] — 0 RPC, 1 INSERT y la identidad completa en la fila', async () => {
    runInsertScript = [
      { data: { id: 'run-unbounded', credit_reservation_group_id: 'group-unbounded' } },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });

    assert.deepEqual(outcome, {
      status: 'created',
      runId: 'run-unbounded',
      reservationGroupId: 'group-unbounded',
      // NO es un error: esta autorización no ocupó exposición porque no había pozo.
      reservations: [],
    });
    assert.deepEqual(reserveCalls(), [], 'la RPC no se llama con 0 patas');
    assert.equal(runInserts.length, 1);
    // Las cuatro columnas que en el camino con patas escribe la RPC desde sus propios
    // parámetros viajan aquí explícitamente: sin ellas la corrida no sería atribuible.
    assert.equal(runInserts[0].candidate_id, 'cand-unbounded');
    assert.equal(runInserts[0].authorized_by, 'user-admin');
    assert.equal(runInserts[0].credit_reservation_group_id, 'group-unbounded');
    assert.equal(runInserts[0].authorization_key, 'key-unbounded');
    // Y el borrador de la corrida sigue viajando entero.
    assert.equal(runInserts[0].status, 'apollo_in_flight');
    assert.equal(runInserts[0].max_credits_authorized, 14);
  });

  it('con patas configuradas NADA cambia: se llama a la RPC y NO se inserta', async () => {
    // Regresión de no-cambio. El desvío es exclusivo de `legs: []`.
    reserveAndCreateScript = [
      {
        data: {
          status: 'created',
          run_id: 'run-con-patas',
          reservation_group_id: 'group-con-patas',
          reservations: [{ id: 'res-1', provider_key: 'lusha', credits_reserved: 5 }],
        },
      },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: {
        ...UNBOUNDED_REQUEST,
        reservationGroupId: 'group-con-patas',
        legs: [
          {
            providerKey: 'lusha' as const,
            operationKey: 'phone_reveal' as const,
            credits: 5,
            limitCredits: 500,
            consumedCredits: 0,
            scopeType: 'role' as const,
            scopeId: 'admin',
            periodStart: '2026-08-01T00:00:00.000Z',
            periodEnd: '2026-08-31T23:59:59.999Z',
          },
        ],
      },
      run: RUN_PAYLOAD,
    });
    assert.equal(outcome.status, 'created');
    assert.equal(reserveCalls().length, 1);
    assert.deepEqual(runInserts, [], 'el camino con presupuesto no inserta desde aquí');
  });

  it('23505 con la MISMA clave ⇒ already_created: la idempotencia sobrevive', async () => {
    runInsertScript = [
      { error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    ];
    runByAuthorizationKeyRow = {
      id: 'run-ya-escrita',
      candidate_id: 'cand-unbounded',
      credit_reservation_group_id: 'group-original',
    };
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'already_created',
      runId: 'run-ya-escrita',
      reservationGroupId: 'group-original',
    });
  });

  it('23505 con la clave LIBRE ⇒ create_conflict, y NO se afirma corrida viva', async () => {
    // Reventó el OTRO índice único: una corrida activa del candidato. Este borde NO lo
    // traduce a `active_run_exists` — la relectura que lo comprueba vive aguas arriba
    // (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1).
    runInsertScript = [{ error: { code: '23505', message: 'duplicate key' } }];
    runByAuthorizationKeyRow = null;
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, { status: 'create_conflict' });
  });

  it('23505 cuya clave pertenece a OTRO candidato ⇒ unavailable, nunca su corrida', async () => {
    // Devolver la corrida de otro candidato le atribuiría a él este gasto.
    runInsertScript = [{ error: { code: '23505', message: 'duplicate key' } }];
    runByAuthorizationKeyRow = {
      id: 'run-de-otro',
      candidate_id: 'cand-ajeno',
      credit_reservation_group_id: null,
    };
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'authorization_key_candidate_mismatch',
    });
  });

  it('23505 con la relectura CAÍDA ⇒ unavailable: un conflicto sin clasificar no afirma nada', async () => {
    runInsertScript = [{ error: { code: '23505', message: 'duplicate key' } }];
    runByAuthorizationKeyError = { code: '42P01', message: 'relation does not exist' };
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'unbudgeted_run_conflict_unverifiable',
    });
  });

  it('un error REPORTADO del INSERT ⇒ unavailable, y 0 llamadas a la RPC', async () => {
    runInsertScript = [{ error: { code: '42501', message: 'permission denied' } }];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'unbudgeted_run_insert_error',
    });
    assert.deepEqual(reserveCalls(), []);
  });

  it('el INSERT sin id ⇒ unavailable: sin corrida no hay a qué atribuir un gasto', async () => {
    runInsertScript = [{ data: null }];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'unbudgeted_run_without_id',
    });
  });

  it('RESPUESTA PERDIDA: reintenta UNA vez con la misma clave y encuentra su corrida', async () => {
    // El INSERT pudo hacer COMMIT y la respuesta perderse. El reintento reusa la MISMA
    // `authorization_key`, así que choca con su propio índice y sale idempotente en vez
    // de crear una segunda corrida.
    runInsertScript = [
      { throws: new Error('socket hang up') },
      { error: { code: '23505', message: 'duplicate key' } },
    ];
    runByAuthorizationKeyRow = {
      id: 'run-commitida',
      candidate_id: 'cand-unbounded',
      credit_reservation_group_id: 'group-unbounded',
    };
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'already_created',
      runId: 'run-commitida',
      reservationGroupId: 'group-unbounded',
    });
    assert.equal(runInserts.length, 2, 'exactamente un reintento');
    assert.equal(
      runInserts[0].authorization_key,
      runInserts[1].authorization_key,
      'sin reusar la clave el reintento sería una segunda autorización',
    );
  });

  it('dos fallos de transporte ⇒ unavailable, y NO un tercer intento', async () => {
    runInsertScript = [
      { throws: new Error('socket hang up') },
      { throws: new Error('socket hang up') },
    ];
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: RUN_PAYLOAD,
    });
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'unbudgeted_run_insert_threw',
    });
    assert.equal(runInserts.length, 2, 'un solo reintento, no un bucle');
  });

  it('sin clave de autorización no se escribe nada: 0 INSERT', async () => {
    const outcome = await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: { ...UNBOUNDED_REQUEST, authorizationKey: '   ' },
      run: RUN_PAYLOAD,
    });
    assert.equal(outcome.status, 'unavailable');
    assert.deepEqual(runInserts, []);
    assert.deepEqual(reserveCalls(), []);
  });

  it('el payload de la corrida NO puede sobrescribir la identidad de la autorización', async () => {
    // La identidad sale de la RESERVA, que es la autoridad. Hoy ningún llamador manda
    // estas claves en el borrador; el orden del spread es la garantía de que si alguna
    // vez lo hiciera, no podría reatribuir la corrida a otro candidato ni a otro actor.
    runInsertScript = [{ data: { id: 'run-x' } }];
    await deps2.reservePhoneRevealCreditsAndCreateRun({
      reservation: UNBOUNDED_REQUEST,
      run: {
        ...RUN_PAYLOAD,
        candidate_id: 'cand-suplantado',
        authorized_by: 'user-suplantado',
        authorization_key: 'clave-suplantada',
      },
    });
    assert.equal(runInserts[0].candidate_id, 'cand-unbounded');
    assert.equal(runInserts[0].authorized_by, 'user-admin');
    assert.equal(runInserts[0].authorization_key, 'key-unbounded');
  });
});
