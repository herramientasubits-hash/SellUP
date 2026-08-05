/**
 * Tests — la ruta LEGACY solo-Lusha con la INFRAESTRUCTURA DE AUDITORÍA AUSENTE
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2B)
 *
 * Compañero de `phone-reveal-waterfall-migration-absent.test.ts`, que fija el mismo
 * contrato para el waterfall COMPLETO (PR #199). Ese archivo prueba el entry point
 * de Apollo; este prueba el entry point NUEVO que introduce la ruta legacy
 * (`startLegacyPhoneRevealWaterfallForCandidate`), porque un segundo camino que
 * puede gastar créditos necesita su propia prueba: heredar el core no demuestra que
 * el cableado nuevo esté cerrado.
 *
 * Producción está en la migración 101: NI la 102 (`phone_reveal_waterfall_runs`) NI
 * la 103 (`run_mode`) están aplicadas. Con `ENABLE_PHONE_REVEAL_WATERFALL` encendido
 * en ese estado, la ruta legacy tiene que cerrarse antes de tocar a Lusha.
 *
 * CONTRATO QUE SE FIJA AQUÍ. La corrida es PRECONDICIÓN de llamar a Lusha, igual que
 * lo es de llamar a Apollo en el waterfall completo. En los CUATRO fallos posibles:
 *
 *   1. la LECTURA de la infraestructura falla (tabla ausente, timeout);
 *   2. el INSERT de la corrida falla (permiso, timeout en la escritura);
 *   3. el INSERT no devuelve `id` (no se sabe si la fila quedó escrita);
 *   4. el índice único parcial rechaza el INSERT (`23505`);
 *
 * el desenlace es el mismo: 0 llamadas a Apollo, 0 llamadas a Lusha, 0 usage-logs,
 * 0 corridas parciales y 0 créditos. La garantía NO depende de reconocer un código
 * de Postgres concreto: `42P01`, `PGRST205` y `57014` producen el mismo cierre.
 *
 * Y lo que NO cambia: con el flag APAGADO la ruta legacy no existe — no se construye
 * el cliente service-role ni se consulta la tabla — y un rol no autorizado
 * (`commercial_manager`) es rechazado en el servidor sin leer nada.
 *
 * Offline por construcción: sin red, sin Supabase real, sin Apollo, sin Lusha,
 * 0 créditos. Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════

/**
 * `fetch` global sustituido por un stub: NINGUNA petición sale de este proceso, y
 * cada intento queda registrado. Así "0 llamadas a proveedores" se afirma también a
 * nivel de RED, no solo con un espía de función.
 */
const originalFetch = globalThis.fetch;
let httpRequests: string[] = [];

globalThis.fetch = (async (input: unknown): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : ((input as { url?: string })?.url ?? String(input));
  httpRequests.push(url);
  return new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

/** Hosts de proveedor que NUNCA pueden aparecer en el tráfico de estos tests. */
const PROVIDER_HOST_FRAGMENTS = ['apollo.io', 'lusha.com', 'hubapi.com'];

function providerHttpRequests(): string[] {
  return httpRequests.filter((url) =>
    PROVIDER_HOST_FRAGMENTS.some((host) => url.includes(host)),
  );
}

// ═══════════════════════════════════════════════════════════════
// Espías globales
// ═══════════════════════════════════════════════════════════════

interface Spies {
  /** Veces que se construyó el cliente service-role. */
  adminClients: number;
  /** Tablas sobre las que se abrió una consulta. */
  tables: string[];
  /** Llamadas al START de Apollo (gasto real). En legacy debe ser SIEMPRE 0. */
  apolloCalls: number;
  /** Llamadas al cliente HTTP de Lusha (gasto real). */
  lushaCalls: number;
  /** Filas escritas en `provider_usage_logs`. */
  usageLogs: number;
  /** INSERTs emitidos contra la tabla de corridas (con o sin éxito). */
  insertAttempts: number;
  /**
   * Filas del waterfall REALMENTE persistidas. Un INSERT que el driver rechaza no
   * deja fila: lo que se mide es "¿quedó una corrida parcial?", no "¿se intentó?".
   */
  waterfallWrites: number;
  /** Reservas de crédito tomadas (AGENT2A-PHONE-WATERFALL-4E). */
  creditReservations: number;
  /** Motivos de liberación de exposición, en orden. */
  creditReleases: string[];
}

const spies: Spies = {
  adminClients: 0,
  tables: [],
  apolloCalls: 0,
  lushaCalls: 0,
  usageLogs: 0,
  insertAttempts: 0,
  waterfallWrites: 0,
  creditReservations: 0,
  creditReleases: [],
};

function resetSpies(): void {
  spies.adminClients = 0;
  spies.tables = [];
  spies.apolloCalls = 0;
  spies.lushaCalls = 0;
  spies.usageLogs = 0;
  spies.insertAttempts = 0;
  spies.waterfallWrites = 0;
  spies.creditReservations = 0;
  spies.creditReleases = [];
  httpRequests = [];
}

// ═══════════════════════════════════════════════════════════════
// Driver Supabase simulado
// ═══════════════════════════════════════════════════════════════

/**
 * Error tal y como lo entrega PostgREST cuando la relación no existe. `42P01` viene
 * de Postgres y `PGRST205` de la caché de esquema de PostgREST.
 */
const TABLE_MISSING_ERRORS = [
  {
    label: '42P01 (Postgres: relation does not exist)',
    error: {
      code: '42P01',
      message: 'relation "public.phone_reveal_waterfall_runs" does not exist',
    },
  },
  {
    label: 'PGRST205 (PostgREST: table not found in schema cache)',
    error: {
      code: 'PGRST205',
      message:
        "Could not find the table 'public.phone_reveal_waterfall_runs' in the schema cache",
    },
  },
] as const;

/** Error de DB que NO es "tabla ausente": el fail-closed no depende del código. */
const OTHER_DB_ERROR = {
  code: '57014',
  message: 'canceling statement due to statement timeout',
};

/** Los TRES fallos deben producir el mismo cierre. */
const ALL_INFRASTRUCTURE_FAILURES = [
  ...TABLE_MISSING_ERRORS,
  { label: '57014 (timeout: código NO reconocido)', error: OTHER_DB_ERROR },
] as const;

type DbError = { code: string; message: string };

/** Error que la tabla 102 devuelve en TODAS sus operaciones. null = tabla sana. */
let waterfallTableError: DbError | null = null;
/**
 * Error que devuelve SOLO el INSERT (la lectura funciona). Modela un entorno
 * parcialmente roto en el que la creación de la corrida SÍ se intenta y falla.
 */
let waterfallInsertError: DbError | null = null;
/** Fila que devuelven los SELECT de corrida (null = el candidato no tiene ninguna). */
let waterfallSelectRow: unknown = null;
/** Id que devuelve el INSERT. null simula "el INSERT no devolvió id". */
let waterfallInsertId: string | null = 'run-legacy-1';

const RUN_ID = 'run-legacy-1';
const CANDIDATE_ID = 'cand-legacy-102-absent';

/**
 * Candidato ELEGIBLE para la ruta legacy: la TERNA de evidencia completa
 * (`no_phone_found` + `provider = apollo` + `completed_at`), sin teléfono, en estado
 * editable y con id Lusha propio. Que sea elegible es deliberado: así el único motivo
 * posible de cierre es la infraestructura, no un gate de elegibilidad que habría
 * cortado igual — que es justo lo que haría un test falso-verde.
 */
const LEGACY_CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  status: 'pending_review',
  source: 'lusha',
  source_contact_id: 'v1.abcdef',
  phone: null,
  phone_reveal_status: 'no_phone_found',
  phone_reveal_provider: 'apollo',
  phone_reveal_completed_at: '2026-07-01T10:00:00.000Z',
  apollo_person_id: null,
  run: { account_id: null },
};

/**
 * Cadena encadenable y "thenable": replica la forma de `@supabase/supabase-js` usada
 * por los deps, y resuelve siempre al mismo `{ data, error }`.
 */
function chain(result: {
  data: unknown;
  error: DbError | null;
}): Record<string, unknown> {
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
  self.then = (
    resolve: (v: { data: unknown; error: DbError | null }) => unknown,
  ): unknown => resolve(result);
  return self;
}

/** Cliente admin (service-role) del waterfall. */
mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => {
      spies.adminClients += 1;
      return {
        from: (table: string) => {
          spies.tables.push(table);
          if (table === 'contact_enrichment_candidates') {
            return chain({ data: LEGACY_CANDIDATE_ROW, error: null });
          }
          if (table !== 'phone_reveal_waterfall_runs') {
            return chain({ data: null, error: null });
          }

          const err = waterfallTableError;
          const failure = { data: null, error: err };
          const base = chain(err ? failure : { data: waterfallSelectRow, error: null });
          return {
            ...base,
            select: () => base,
            insert: () => {
              if (err) return chain(failure);
              if (waterfallInsertError) {
                return chain({ data: null, error: waterfallInsertError });
              }
              spies.waterfallWrites += 1;
              return chain({
                data: waterfallInsertId ? { id: waterfallInsertId } : null,
                error: null,
              });
            },
            update: () => {
              if (err) return chain(failure);
              spies.waterfallWrites += 1;
              return chain({ data: [{ id: RUN_ID }], error: null });
            },
          };
        },
        // Reserva atómica de créditos (AGENT2A-PHONE-WATERFALL-4E, migración 104).
        // Simulada para que este archivo siga midiendo el gate de infraestructura de la
        // corrida; además permite afirmar que una corrida que no se pudo crear LIBERA la
        // exposición que había reservado, en vez de dejarla bloqueada para siempre.
        rpc: (fn: string, params: Record<string, unknown>) => {
          // AGENT2A-PHONE-WATERFALL-4F: reserva + corrida en una sola función SQL. La
          // salud de la tabla 102 se observa aquí, y un fallo deshace ambas escrituras.
          if (fn === 'reserve_and_create_phone_reveal_run') {
            spies.creditReservations += 1;
            spies.insertAttempts += 1;

            if (waterfallTableError) {
              return chain({ data: null, error: waterfallTableError });
            }
            if (waterfallInsertError) {
              if (waterfallInsertError.code === '23505') {
                return chain({ data: { status: 'create_conflict' }, error: null });
              }
              return chain({ data: null, error: waterfallInsertError });
            }

            const legs =
              (params.p_legs as { provider_key: string; credits: number }[]) ?? [];
            if (!waterfallInsertId) {
              return chain({ data: { status: 'created' }, error: null });
            }
            spies.waterfallWrites += 1;
            return chain({
              data: {
                status: 'created',
                run_id: waterfallInsertId,
                reservation_group_id: params.p_reservation_group_id,
                reservations: legs.map((leg, index) => ({
                  id: `reservation-${index}-${leg.provider_key}`,
                  provider_key: leg.provider_key,
                  credits_reserved: leg.credits,
                })),
              },
              error: null,
            });
          }
          if (fn === 'release_phone_reveal_credits') {
            spies.creditReleases.push(String(params.p_reason ?? ''));
            return chain({ data: 'released', error: null });
          }
          if (fn === 'confirm_phone_reveal_credits') {
            return chain({ data: 'confirmed', error: null });
          }
          return chain({ data: null, error: null });
        },
      };
    },
  },
});

/**
 * Presupuesto POR PROVEEDOR resuelto (AGENT2A-PHONE-WATERFALL-4E). `checkBudget` habla
 * con su propio cliente admin y con `provider_usage_logs`, que no son el sujeto de este
 * archivo: aquí se prueba el gate de infraestructura de la corrida. Un pozo con límite
 * amplio deja pasar el preflight para que el bloqueo observado sea el de la corrida.
 */
mock.module('@/modules/budgets/budget-resolution', {
  namedExports: {
    checkBudget: async (providerKey: string) => ({
      allowed: true,
      reason: null,
      providerKey,
      userId: 'user-admin',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T23:59:59.999Z',
      scopeApplied: 'global',
      matchedRule: {
        id: 'rule-1',
        providerKey,
        scopeType: 'global',
        scopeId: null,
        limitCredits: 1_000,
        limitUsd: null,
        periodType: 'monthly',
        onExceed: 'block',
      },
      consumedCredits: 0,
      consumedUsd: 0,
      // AGENT2A-PHONE-REVEAL-4N: el pozo declara explícitamente que NO hay exposición
      // reservada. El preflight lo exige como dato y trata su ausencia como
      // `balance_unavailable`, porque un pozo cuya exposición nadie leyó no autoriza gasto.
      reservedCredits: 0,
      consumptionBreakdown: {
        usageLogCredits: 0,
        confirmedReservationCredits: 0,
        excludedUsageLogCredits: 0,
        excludedUsageLogCount: 0,
        hasAssumedCapCredits: false,
        malformedConfirmedReservationCount: 0,
      },
      projectedCredits: 0,
      projectedUsd: 0,
      remainingCredits: 1_000,
      remainingUsd: null,
      usdCostTruth: 'complete',
    }),
  },
});

/** Cliente de SESIÓN (no se usa en el runtime legacy, pero el módulo se importa). */
mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
      },
      from: (table: string) => {
        spies.tables.push(table);
        return chain({ data: null, error: null });
      },
    }),
  },
});

/** Un `redirect` alcanzado sería un fallo de setup, no un caso de prueba. */
mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`BUG: redirect inesperado a ${to}`);
    },
  },
});

// ── Proveedores y usage-log: espiados, jamás reales ───────────────

/**
 * Apollo NUNCA puede ser llamado por la ruta legacy: su intento ya ocurrió bajo OTRA
 * autorización. No solo se cuenta — se revienta, para que un futuro cambio que lo
 * reintroduzca falle de forma ruidosa y no como un contador desapercibido.
 */
mock.module('@/server/integrations/apollo-client', {
  namedExports: {
    startApolloPhoneReveal: async () => {
      spies.apolloCalls += 1;
      throw new Error('BUG: Apollo fue llamado por la ruta legacy solo-Lusha');
    },
  },
});

mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    enrichLushaContactPhonesForFallback: async () => {
      spies.lushaCalls += 1;
      throw new Error('BUG: Lusha fue llamado sin corrida registrada');
    },
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: {
    getLushaApiKey: async () => 'test-key-never-used',
  },
});

mock.module('@/modules/usage-tracking/logging', {
  namedExports: {
    logProviderUsage: async () => {
      spies.usageLogs += 1;
      return true;
    },
  },
});

// ── Módulos bajo prueba: el cableado REAL ─────────────────────────

type WaterfallDeps = typeof import('../phone-reveal-waterfall-deps');
type WaterfallCore = typeof import('../phone-reveal-waterfall-core');

let deps: WaterfallDeps;
let core: WaterfallCore;

before(async () => {
  deps = await import('../phone-reveal-waterfall-deps');
  core = await import('../phone-reveal-waterfall-core');
});

const WATERFALL_FLAG = 'ENABLE_PHONE_REVEAL_WATERFALL';
const LUSHA_FALLBACK_FLAG = 'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK';
const ADMIN = { internalUserId: 'user-admin', roleKey: 'admin' };
const COMMERCIAL_MANAGER = {
  internalUserId: 'user-cm',
  roleKey: 'commercial_manager',
};

function setFlags(waterfall: boolean, lushaFallback: boolean): void {
  if (waterfall) process.env[WATERFALL_FLAG] = 'true';
  else delete process.env[WATERFALL_FLAG];
  if (lushaFallback) process.env[LUSHA_FALLBACK_FLAG] = 'true';
  else delete process.env[LUSHA_FALLBACK_FLAG];
}

/** Cuántas veces se consultó la tabla de la migración 102. */
function waterfallTableQueries(): number {
  return spies.tables.filter((t) => t === 'phone_reveal_waterfall_runs').length;
}

/** Ninguna llamada de proveedor, ningún log de gasto, ninguna corrida escrita. */
function assertNoSpendAtAll(): void {
  assert.equal(spies.apolloCalls, 0, 'Apollo NO puede ser llamado');
  assert.equal(spies.lushaCalls, 0, 'Lusha NO puede ser llamado');
  assert.equal(spies.usageLogs, 0, 'no se registra gasto de proveedor');
  assert.equal(spies.waterfallWrites, 0, 'no queda ninguna corrida parcial');
  assert.deepEqual(providerHttpRequests(), [], 'ninguna petición HTTP a proveedores');
}

beforeEach(() => {
  resetSpies();
  waterfallTableError = null;
  waterfallInsertError = null;
  waterfallSelectRow = null;
  waterfallInsertId = RUN_ID;
  // Los DOS flags encendidos: lo que se prueba es que la infraestructura ausente
  // detiene el gasto, no que un flag apagado lo detuviera de todas formas.
  setFlags(true, true);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
});

// ═══════════════════════════════════════════════════════════════
// 1. Flag APAGADO — la ruta legacy no existe
// ═══════════════════════════════════════════════════════════════

describe('legacy — flag OFF: no se consulta la infraestructura', () => {
  it('sale en el primer gate: 0 clientes admin, 0 consultas, 0 gasto', async () => {
    setFlags(false, true);

    const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
      CANDIDATE_ID,
      ADMIN,
    );

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'feature_disabled');
    assert.equal(result.lushaCalled, false);
    assert.equal(result.maxCreditsAuthorized, null);
    // El gate es el FLAG: no se construye el cliente service-role, así que las
    // migraciones ausentes son irrelevantes en esta rama.
    assert.equal(spies.adminClients, 0);
    assert.equal(waterfallTableQueries(), 0);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Rol no autorizado — rechazado en el servidor, sin leer nada
// ═══════════════════════════════════════════════════════════════

describe('legacy — commercial_manager: rechazado antes de la infraestructura', () => {
  it('rol no admin ⇒ role_not_allowed sin construir el cliente admin', async () => {
    const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
      CANDIDATE_ID,
      COMMERCIAL_MANAGER,
    );

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'role_not_allowed');
    assert.equal(result.lushaCalled, false);
    // El gate de rol corre ANTES de tocar infraestructura: un rol no autorizado no
    // puede ni descubrir si la tabla existe.
    assert.equal(spies.adminClients, 0);
    assert.equal(waterfallTableQueries(), 0);
    assertNoSpendAtAll();
  });

  it('rol nulo (actor sin rol conocido) ⇒ también rechazado', async () => {
    const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
      CANDIDATE_ID,
      { internalUserId: 'user-x', roleKey: null },
    );

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'role_not_allowed');
    assert.equal(spies.adminClients, 0);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. La LECTURA de la infraestructura falla ⇒ 0 proveedores
// ═══════════════════════════════════════════════════════════════

describe('legacy — infraestructura ilegible: 0 Apollo, 0 Lusha', () => {
  for (const { label, error } of ALL_INFRASTRUCTURE_FAILURES) {
    it(`${label} ⇒ not_started, sin llamar a ningún proveedor`, async () => {
      waterfallTableError = error;

      const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
        CANDIDATE_ID,
        ADMIN,
      );

      assert.equal(result.outcome, 'not_started');
      assert.equal(result.reason, 'legacy_run_creation_failed');
      assert.equal(result.lushaCalled, false);
      assert.equal(result.maxCreditsAuthorized, null);
      // La tabla se CONSULTÓ (el gate de infraestructura sí corre) pero el fallo se
      // propagó en vez de degradarse a "no hay corrida", que es lo que autorizaría
      // abrir una nueva y gastar.
      assert.ok(waterfallTableQueries() > 0, 'la infraestructura sí se consultó');
      assertNoSpendAtAll();
    });
  }

  it('la lectura de la EVIDENCIA sigue siendo previa: el candidato se lee, no se gasta', async () => {
    waterfallTableError = TABLE_MISSING_ERRORS[0].error;

    await deps.startLegacyPhoneRevealWaterfallForCandidate(CANDIDATE_ID, ADMIN);

    // Orden barato→caro: evidencia del candidato primero, infraestructura después,
    // proveedor nunca.
    const firstCandidateRead = spies.tables.indexOf('contact_enrichment_candidates');
    const firstRunRead = spies.tables.indexOf('phone_reveal_waterfall_runs');
    assert.ok(firstCandidateRead >= 0, 'la evidencia del candidato se leyó');
    assert.ok(firstRunRead > firstCandidateRead, 'la infraestructura se leyó después');
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. El INSERT de la corrida falla ⇒ 0 proveedores
// ═══════════════════════════════════════════════════════════════

describe('legacy — el INSERT de la corrida falla: 0 Apollo, 0 Lusha', () => {
  for (const { label, error } of ALL_INFRASTRUCTURE_FAILURES) {
    it(`INSERT rechazado con ${label} ⇒ not_started, 0 gasto`, async () => {
      // La LECTURA funciona (no hay corrida previa) y solo la ESCRITURA falla: el
      // INSERT sí se emite, a diferencia de la tabla ausente.
      waterfallInsertError = error;

      const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
        CANDIDATE_ID,
        ADMIN,
      );

      assert.equal(result.outcome, 'not_started');
      // AGENT2A-PHONE-WATERFALL-4F: la escritura es una RPC, así que el fallo llega
      // como DESENLACE (`run_creation_unavailable`) en vez de como excepción
      // (`legacy_run_creation_failed`). El contrato observable no cambia: not_started,
      // 0 Lusha, 0 Apollo, 0 usage logs, 0 créditos — y la reserva se deshizo con la
      // transacción, así que tampoco queda exposición ocupada.
      assert.equal(result.reason, 'run_creation_unavailable');
      assert.equal(result.lushaCalled, false);
      assert.equal(spies.insertAttempts, 1, 'se intentó crear la corrida UNA vez');
      assertNoSpendAtAll();
    });
  }

  it('el INSERT no devuelve id ⇒ not_started, 0 gasto (no se asume conflicto benigno)', async () => {
    // Un `null` aquí sería indistinguible de un `23505`, que el caller SÍ trata como
    // "otra corrida ganó". No se sabe si la fila quedó escrita, así que fail-closed.
    waterfallInsertId = null;

    const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
      CANDIDATE_ID,
      ADMIN,
    );

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'run_creation_unavailable');
    assert.equal(result.lushaCalled, false);
    assert.equal(result.maxCreditsAuthorized, null);
    assert.equal(spies.insertAttempts, 1);
    assert.equal(spies.lushaCalls, 0, 'Lusha NO puede ser llamado');
    assert.equal(spies.apolloCalls, 0, 'Apollo NO puede ser llamado');
    assert.equal(spies.usageLogs, 0);
    assert.deepEqual(providerHttpRequests(), []);
  });

  it('conflicto 23505 del índice único ⇒ create_conflict, 0 gasto', async () => {
    waterfallInsertError = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "phone_reveal_waterfall_runs_one_active_per_candidate"',
    };

    const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(
      CANDIDATE_ID,
      ADMIN,
    );

    // `23505` NO es un fallo de infraestructura: otra autorización viva ganó la
    // carrera. Se distingue en el motivo, pero el gasto es igualmente cero.
    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'create_conflict');
    assert.equal(result.lushaCalled, false);
    assert.equal(result.maxCreditsAuthorized, null);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. La capa de deps del arranque legacy falla FUERTE
// ═══════════════════════════════════════════════════════════════

describe('legacy — la evidencia que se carga es la TERNA y es PII-free', () => {
  it('devuelve los tres campos canónicos y NUNCA el teléfono ni la identidad', async () => {
    const evidence = await deps.loadLegacyEvidenceForWaterfall(CANDIDATE_ID);
    assert.ok(evidence, 'hay evidencia');
    assert.equal(evidence.phoneRevealStatus, 'no_phone_found');
    assert.equal(evidence.phoneRevealProvider, 'apollo');
    assert.equal(evidence.hasPhone, false);
    // PII-free: la proyección no expone el número ni la identidad.
    assert.equal('phone' in (evidence as unknown as Record<string, unknown>), false);
    assert.equal('fullName' in (evidence as unknown as Record<string, unknown>), false);
    assert.equal('email' in (evidence as unknown as Record<string, unknown>), false);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. El core del arranque legacy no expone nada de Apollo
// ═══════════════════════════════════════════════════════════════

describe('legacy — las deps del arranque NO incluyen ninguna pata Apollo', () => {
  it('buildStartLegacyWaterfallDeps no cablea ningún cliente de proveedor', () => {
    const legacyDeps = deps.buildStartLegacyWaterfallDeps(ADMIN);
    const keys = Object.keys(legacyDeps).sort();

    // Superficie EXACTA: si alguien añade una dep de proveedor, este test cae.
    assert.deepEqual(keys, [
      'actor',
      'findActiveRun',
      'findLatestRun',
      'flagEnabled',
      'loadLegacyEvidence',
      'newAuthorizationKey',
      'newReservationGroupId',
      'nowIso',
      // AGENT2A-PHONE-WATERFALL-4D/4E: resuelve PRESUPUESTO, no proveedores.
      'readCreditPools',
      // AGENT2A-PHONE-WATERFALL-4F: ocupa presupuesto Y escribe la corrida en UNA
      // transacción. No puede llamar a Apollo ni a Lusha.
      'reserveCreditsAndCreateRun',
    ]);
    const serialized = keys.join(' ').toLowerCase();
    assert.equal(serialized.includes('apollo'), false);
    assert.equal(serialized.includes('lusha'), false);
  });

  it('el tope legacy que se autoriza es 5, nunca 13 ni 8', () => {
    assert.equal(core.PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, 5);
    assert.notEqual(
      core.PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      core.PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    );
    assert.notEqual(
      core.PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      core.PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
    );
  });
});
