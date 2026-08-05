/**
 * effective-consumption-resolver.test.ts — AGENT2A-PHONE-REVEAL-4N
 *
 * El CABLEADO del cálculo canónico, con un cliente Supabase falso que registra cada
 * consulta. Lo que se verifica aquí no lo puede verificar el core puro:
 *
 *   * § 3 — las reservas se leen en UNA sola consulta con todos los estados dentro, así que
 *     `reserved → confirmed` no puede devolver crédito a `available` ni por un instante;
 *   * § 4 — la identidad del pozo (proveedor, scope null-safe, período) se filtra tal como
 *     quedó ALMACENADA, sin volver a resolver la jerarquía;
 *   * § 8 — `checkBudget` es el único resolver, y ya no lee solo `provider_usage_logs`.
 *
 * 0 red, 0 Supabase real, 0 proveedores, 0 créditos.
 */

import { test, describe, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Cliente Supabase falso ─────────────────────────────────────

interface RecordedQuery {
  table: string;
  select: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
}

interface TableFixture {
  rows: Record<string, unknown>[];
  error?: { message: string; code?: string } | null;
}

const recorded: RecordedQuery[] = [];
let fixtures: Record<string, TableFixture> = {};
/** Se invoca justo ANTES de resolver la consulta de una tabla (para simular carreras). */
let onQuery: ((query: RecordedQuery) => void) | null = null;

function buildQuery(table: string, select: string) {
  const query: RecordedQuery = { table, select, filters: [] };
  recorded.push(query);

  const chain = {
    eq(column: string, value: unknown) {
      query.filters.push({ op: 'eq', column, value });
      return chain;
    },
    is(column: string, value: unknown) {
      query.filters.push({ op: 'is', column, value });
      return chain;
    },
    in(column: string, value: unknown) {
      query.filters.push({ op: 'in', column, value });
      return chain;
    },
    gte(column: string, value: unknown) {
      query.filters.push({ op: 'gte', column, value });
      return chain;
    },
    lt(column: string, value: unknown) {
      query.filters.push({ op: 'lt', column, value });
      return chain;
    },
    or() {
      return chain;
    },
    limit() {
      return chain;
    },
    order() {
      return chain;
    },
    maybeSingle() {
      onQuery?.(query);
      const fixture = fixtures[table];
      if (fixture?.error) return Promise.resolve({ data: null, error: fixture.error });
      return Promise.resolve({ data: fixture?.rows[0] ?? null, error: null });
    },
    then(
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      onQuery?.(query);
      const fixture = fixtures[table];
      const result = fixture?.error
        ? { data: null, error: fixture.error }
        : { data: fixture?.rows ?? [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return chain;
}

const fakeAdminClient = {
  from: (table: string) => ({ select: (select: string) => buildQuery(table, select) }),
};

/** Se resuelve en `before`: el módulo tiene que cargarse DESPUÉS del mock. */
let checkBudget: typeof import('../budget-resolution').checkBudget;

before(async () => {
  // Se sustituye SOLO la fábrica del cliente: los constructores de consulta reales de
  // `queries.ts` son justamente el sujeto de este archivo (qué tablas, qué filtros, cuántas
  // consultas), así que se conservan tal cual y solo se les da un cliente que graba.
  const realQueries = await import('../queries');
  const patched = { ...realQueries, getAdminClient: () => fakeAdminClient };
  mock.module('@/modules/budgets/queries', { namedExports: patched });

  ({ checkBudget } = await import('../budget-resolution'));
});

// ── Fixtures ───────────────────────────────────────────────────

const USER_ID = '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c';
const APOLLO_RUN_ID = 'cec34235-0dcd-4032-9467-cb37d073ef8a';
const APOLLO_GROUP_ID = '9387bc05-22b9-4bb9-9556-db6c468b8fb4';
const RESERVATIONS_TABLE = 'phone_reveal_credit_reservations';

/** Regla de usuario de Apollo con límite 45, tal como está en Producción. */
function apolloUserRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b5bcc6d7-577d-42b5-839e-4fb860372c5a',
    provider_key: 'apollo',
    scope_type: 'user',
    scope_id: USER_ID,
    period_type: 'monthly',
    limit_credits: 45,
    limit_usd: null,
    on_exceed: 'block',
    is_active: true,
    ...overrides,
  };
}

function baseFixtures(overrides: Record<string, TableFixture> = {}) {
  return {
    budget_rules: { rows: [apolloUserRule()] },
    internal_users: { rows: [{ role_id: null, group_id: null }] },
    organization_groups: { rows: [] },
    provider_usage_logs: { rows: [] },
    [RESERVATIONS_TABLE]: { rows: [] },
    phone_reveal_waterfall_runs: { rows: [] },
    ...overrides,
  } as Record<string, TableFixture>;
}

function usageRow(creditsUsed: number | null, waterfallRunId?: string) {
  return {
    provider_key: 'apollo',
    credits_used: creditsUsed,
    estimated_cost_usd: null,
    metadata: waterfallRunId ? { phone_reveal_waterfall_id: waterfallRunId } : {},
  };
}

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    provider_key: 'apollo',
    status: 'confirmed',
    credits_reserved: 8,
    credits_confirmed: 8,
    cost_truth: 'assumed_cap',
    run_id: APOLLO_RUN_ID,
    reservation_group_id: APOLLO_GROUP_ID,
    ...overrides,
  };
}

beforeEach(() => {
  recorded.length = 0;
  onQuery = null;
  fixtures = baseFixtures();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
});

function reservationQueries() {
  return recorded.filter((q) => q.table === RESERVATIONS_TABLE);
}

// ── § 3 — una sola lectura, sin ventana de doble disponibilidad ─

describe('§3 — las reservas se leen en UN solo snapshot', () => {
  test('hay exactamente UNA consulta a la tabla de reservas, sin filtro de status', async () => {
    fixtures = baseFixtures({
      [RESERVATIONS_TABLE]: { rows: [reservationRow()] },
    });

    await checkBudget('apollo', USER_ID);

    const queries = reservationQueries();
    assert.equal(queries.length, 1, 'dos consultas abrirían la ventana de doble disponibilidad');
    // Ningún filtro por estado: los tres estados llegan juntos y se parten en el core puro.
    assert.equal(
      queries[0].filters.some((f) => f.column === 'status'),
      false,
    );
    // El select tiene que traer las dos cifras, o la partición no sería posible.
    assert.match(queries[0].select, /credits_reserved/);
    assert.match(queries[0].select, /credits_confirmed/);
  });

  test('reserved ⇒ ocupa disponibilidad; confirmed ⇒ es consumo. El total NUNCA sube', async () => {
    // Arrange — el MISMO pozo (límite 45, 0 usage logs) leído en los dos lados de la
    // transición. La fila es la misma; solo cambia su estado.
    fixtures = baseFixtures({
      [RESERVATIONS_TABLE]: {
        rows: [reservationRow({ status: 'reserved', credits_confirmed: null, cost_truth: null })],
      },
    });
    const before = await checkBudget('apollo', USER_ID);

    recorded.length = 0;
    fixtures = baseFixtures({ [RESERVATIONS_TABLE]: { rows: [reservationRow()] } });
    const after = await checkBudget('apollo', USER_ID);

    // Antes: 0 consumido, 8 reservados. Después: 8 consumidos, 0 reservados.
    assert.equal(before.consumedCredits, 0);
    assert.equal(before.reservedCredits, 8);
    assert.equal(after.consumedCredits, 8);
    assert.equal(after.reservedCredits, 0);

    // Lo que NO puede pasar: que `available` suba al liquidar.
    assert.equal(before.remainingCredits, 37);
    assert.equal(after.remainingCredits, 37);
    assert.ok(
      (after.remainingCredits ?? 0) <= (before.remainingCredits ?? 0),
      'la liquidación devolvió disponibilidad: hay una ventana de doble gasto',
    );
  });

  test('una fila que transiciona DURANTE la lectura se cuenta una vez, no cero', async () => {
    // El snapshot único hace imposible el caso patológico: aunque la fila cambie de estado
    // justo cuando se resuelve la consulta, sale UNA sola vez y con UN solo estado.
    fixtures = baseFixtures({
      [RESERVATIONS_TABLE]: {
        rows: [reservationRow({ status: 'reserved', credits_confirmed: null, cost_truth: null })],
      },
    });
    onQuery = (query) => {
      if (query.table !== RESERVATIONS_TABLE) return;
      // La liquidación ocurre en mitad de la lectura.
      fixtures[RESERVATIONS_TABLE] = { rows: [reservationRow()] };
    };

    const result = await checkBudget('apollo', USER_ID);

    // Sea el estado que sea el que se leyó, los 8 créditos siguen ocupados.
    assert.equal(result.consumedCredits + result.reservedCredits, 8);
    assert.equal(result.remainingCredits, 37);
  });
});

// ── § 4 — contrato del pozo ────────────────────────────────────

describe('§4 — la reserva se cuenta contra el pozo ALMACENADO', () => {
  test('pozo de usuario: filtra por scope_type, scope_id y el período de la regla', async () => {
    fixtures = baseFixtures({ [RESERVATIONS_TABLE]: { rows: [reservationRow()] } });

    const result = await checkBudget('apollo', USER_ID);

    const [query] = reservationQueries();
    const byColumn = new Map(query.filters.map((f) => [f.column, f]));
    assert.deepEqual(byColumn.get('scope_type')?.value, 'user');
    assert.deepEqual(byColumn.get('scope_id')?.value, USER_ID);
    assert.equal(byColumn.get('scope_type')?.op, 'eq');
    assert.equal(byColumn.get('period_start')?.value, result.periodStart);
    assert.equal(byColumn.get('period_end')?.value, result.periodEnd);
    // Y solo los proveedores que pueden tener reserva de reveal.
    assert.deepEqual(byColumn.get('provider_key')?.value, ['apollo']);
  });

  test('pozo global: scope_id NULL se filtra con IS NULL, no con eq', async () => {
    // `.eq(col, null)` no empareja NULL en PostgREST: sería un pozo vacío silencioso.
    fixtures = baseFixtures({
      budget_rules: {
        rows: [apolloUserRule({ scope_type: 'global', scope_id: null, limit_credits: 500 })],
      },
      [RESERVATIONS_TABLE]: { rows: [reservationRow({ scope_type: 'global', scope_id: null })] },
    });

    await checkBudget('apollo', USER_ID);

    const [query] = reservationQueries();
    const scopeId = query.filters.find((f) => f.column === 'scope_id');
    assert.equal(scopeId?.op, 'is');
    assert.equal(scopeId?.value, null);
  });

  test('pozo de rol: el filtro es la clave de rol de la regla', async () => {
    fixtures = baseFixtures({
      budget_rules: { rows: [apolloUserRule({ scope_type: 'role', scope_id: 'admin' })] },
      internal_users: { rows: [{ role_id: 'role-1', group_id: null }] },
      roles: { rows: [{ key: 'admin' }] },
    });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.scopeApplied, 'role');
    const byColumn = new Map(reservationQueries()[0].filters.map((f) => [f.column, f]));
    assert.equal(byColumn.get('scope_type')?.value, 'role');
    assert.equal(byColumn.get('scope_id')?.value, 'admin');
  });

  test('pozo de grupo: el filtro es el grupo de la REGLA, no el subárbol', async () => {
    // El consumo de un pozo de grupo agrega el subárbol, pero la reserva guardó el scope de
    // la regla que ganó el match, que es el ancestro con regla. Se empareja exactamente eso,
    // igual que hace `reserve_and_create_phone_reveal_run`.
    const GROUP_ID = '0feef785-1bf7-41ce-b289-bc624f825551';
    fixtures = baseFixtures({
      budget_rules: { rows: [apolloUserRule({ scope_type: 'group', scope_id: GROUP_ID })] },
      internal_users: { rows: [{ role_id: null, group_id: GROUP_ID }] },
      organization_groups: { rows: [{ id: GROUP_ID, name: 'g', parent_group_id: null }] },
    });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.scopeApplied, 'group');
    const byColumn = new Map(reservationQueries()[0].filters.map((f) => [f.column, f]));
    assert.equal(byColumn.get('scope_id')?.value, GROUP_ID);
  });

  test('un cambio posterior de regla NO arrastra la reserva al pozo nuevo', async () => {
    // La regla vigente pasó a ser global; la reserva histórica quedó guardada como `user`.
    // Al filtrar por la identidad del pozo NUEVO, la reserva vieja simplemente no aparece:
    // sigue cargada al pozo contra el que se autorizó.
    fixtures = baseFixtures({
      budget_rules: {
        rows: [apolloUserRule({ scope_type: 'global', scope_id: null, limit_credits: 500 })],
      },
      // El pozo global no devuelve la reserva user-scoped.
      [RESERVATIONS_TABLE]: { rows: [] },
      provider_usage_logs: { rows: [usageRow(37)] },
    });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.scopeApplied, 'global');
    assert.equal(result.consumedCredits, 37);
    assert.equal(result.consumptionBreakdown.confirmedReservationCredits, 0);
  });
});

// ── § 8 — un solo resolver, y ya no lee solo usage logs ────────

describe('§8 — cobertura del resolver', () => {
  test('checkBudget replica las cifras live de Apollo: 37 + 8 = 45, available 0', async () => {
    fixtures = baseFixtures({
      provider_usage_logs: {
        rows: [
          usageRow(37), // Agente 1: search + enrichment
          usageRow(null, APOLLO_RUN_ID), // start del waterfall, sin cifra
          usageRow(null, APOLLO_RUN_ID), // webhook del waterfall, sin cifra
        ],
      },
      [RESERVATIONS_TABLE]: { rows: [reservationRow()] },
      phone_reveal_waterfall_runs: {
        rows: [{ id: APOLLO_RUN_ID, credit_reservation_group_id: APOLLO_GROUP_ID }],
      },
    });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.consumedCredits, 45);
    assert.equal(result.consumptionBreakdown.usageLogCredits, 37);
    assert.equal(result.consumptionBreakdown.confirmedReservationCredits, 8);
    assert.equal(result.consumptionBreakdown.excludedUsageLogCount, 2);
    assert.equal(result.consumptionBreakdown.hasAssumedCapCredits, true);
    assert.equal(result.remainingCredits, 0);
  });

  test('la reserva confirmada de Apollo entra en el consumo aunque el log diga NULL', async () => {
    // Es EL defecto que este hito cierra: antes esos 8 créditos no estaban en ningún cálculo.
    fixtures = baseFixtures({
      provider_usage_logs: { rows: [usageRow(null, APOLLO_RUN_ID)] },
      [RESERVATIONS_TABLE]: { rows: [reservationRow()] },
    });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.consumedCredits, 8);
    assert.notEqual(result.consumedCredits, 0);
  });

  test('un fallo al leer las reservas BLOQUEA: no se reporta un pozo intacto', async () => {
    fixtures = baseFixtures({
      [RESERVATIONS_TABLE]: { rows: [], error: { message: 'connection reset' } },
    });

    await assert.rejects(
      () => checkBudget('apollo', USER_ID),
      /reservation snapshot read failed/,
      'una lectura fallida no puede leerse como "no hay reservas"',
    );
  });

  test('un fallo al leer los usage logs también BLOQUEA en vez de devolver 0 consumido', async () => {
    fixtures = baseFixtures({
      provider_usage_logs: { rows: [], error: { message: 'statement timeout' } },
    });

    await assert.rejects(() => checkBudget('apollo', USER_ID), /usage consumption read failed/);
  });

  test('la tabla de corridas ilegible NO bloquea: degrada sobre-contando', async () => {
    // El mapa grupo → corrida solo AÑADE exclusiones. Sin él se cuenta de más (bloquea),
    // nunca de menos (regalaría créditos), así que el presupuesto no queda rehén de una
    // tabla que no es suya.
    fixtures = baseFixtures({
      provider_usage_logs: { rows: [usageRow(5, APOLLO_RUN_ID)] },
      [RESERVATIONS_TABLE]: {
        rows: [reservationRow({ run_id: null, credits_confirmed: 5, cost_truth: 'reported' })],
      },
      phone_reveal_waterfall_runs: { rows: [], error: { message: 'relation does not exist' } },
    });

    const result = await checkBudget('apollo', USER_ID);

    // 5 del log + 5 de la reserva: sobre-cuenta a propósito.
    assert.equal(result.consumedCredits, 10);
  });

  test('un proveedor que no puede tener reservas no consulta la tabla', async () => {
    fixtures = baseFixtures({
      budget_rules: { rows: [apolloUserRule({ provider_key: 'tavily' })] },
      provider_usage_logs: { rows: [{ provider_key: 'tavily', credits_used: 12, estimated_cost_usd: null, metadata: {} }] },
    });

    const result = await checkBudget('tavily', USER_ID);

    assert.equal(reservationQueries().length, 0);
    assert.equal(result.consumedCredits, 12);
    assert.equal(result.reservedCredits, 0);
  });

  test('sin regla aplicable no se consulta ninguna reserva', async () => {
    fixtures = baseFixtures({ budget_rules: { rows: [] } });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.scopeApplied, 'none');
    assert.equal(reservationQueries().length, 0);
    assert.equal(result.reservedCredits, 0);
  });
});

// ── § 5 — Apollo compartido con el Agente 1 ────────────────────

describe('§5 — compatibilidad con el Agente 1', () => {
  test('search + enrichment del Agente 1 siguen contando enteros junto a la reserva de 2A', async () => {
    fixtures = baseFixtures({
      provider_usage_logs: {
        rows: [
          usageRow(32), // organizations_search
          usageRow(5), // organization_enrichment
          usageRow(null, APOLLO_RUN_ID), // waterfall de 2A
        ],
      },
      [RESERVATIONS_TABLE]: { rows: [reservationRow()] },
    });

    const result = await checkBudget('apollo', USER_ID);

    assert.equal(result.consumptionBreakdown.usageLogCredits, 37);
    assert.equal(result.consumedCredits, 45);
  });

  test('una operación proyectada se compara contra consumido + reservado', async () => {
    // El pozo tiene 45, hay 37 gastados y 8 en vuelo: no cabe nada más.
    fixtures = baseFixtures({
      provider_usage_logs: { rows: [usageRow(37)] },
      [RESERVATIONS_TABLE]: {
        rows: [reservationRow({ status: 'reserved', credits_confirmed: null, cost_truth: null })],
      },
    });

    const result = await checkBudget('apollo', USER_ID, { credits: 1 });

    assert.equal(result.consumedCredits, 37);
    assert.equal(result.reservedCredits, 8);
    assert.equal(result.remainingCredits, 0);
    assert.equal(result.allowed, false, 'una exposición en vuelo tiene que bloquear');
  });
});
