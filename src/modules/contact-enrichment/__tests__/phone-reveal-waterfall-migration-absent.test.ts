/**
 * Tests — el waterfall con la MIGRACIÓN 102 AUSENTE
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2)
 *
 * Producción tiene el código del waterfall (PR #195) pero NO la tabla
 * `phone_reveal_waterfall_runs`: la migración máxima aplicada es la 101. Este
 * archivo fija por regresión que esa combinación es inofensiva, y lo hace
 * atravesando el CABLEADO REAL (`phone-reveal-waterfall-deps.ts`), no solo el core
 * puro: lo que se mockea es el DRIVER de Supabase y los clientes de proveedor, no
 * las decisiones.
 *
 * Contrato que se verifica:
 *
 *   1. ORDEN DE LOS GATES. Primero el flag, luego la autorización, luego la
 *      infraestructura, luego la corrida, y solo al final el proveedor. Con el flag
 *      apagado NO se construye el cliente admin y NO se consulta la tabla 102: no
 *      se puede "consultar primero y descubrir después" que la feature está off.
 *
 *   2. TABLA AUSENTE = FAIL-CLOSED. Con el flag encendido y un admin, un
 *      `42P01` / `PGRST205` sobre la tabla 102 cierra el camino ANTES de cualquier
 *      proveedor: 0 llamadas a Lusha, 0 usage-logs, 0 escrituras de corrida y
 *      ninguna corrida parcial.
 *
 *   3. LA CAPA DE DEPS FALLA FUERTE. Las funciones de I/O propagan el error del
 *      driver en vez de degradarlo a "no hay corrida": quien decide qué hacer con
 *      un fallo de infraestructura es el caller, no el acceso a datos. Confundir
 *      "no existe la tabla" con "no hay corrida activa" sería exactamente el bug
 *      que dejaría correr la 2ª pata sin autorización registrada.
 *
 *   4. UN ERROR DE DB QUE NO ES "TABLA AUSENTE" tampoco abre la pata Lusha: el
 *      fail-closed no depende de reconocer un código concreto de Postgres.
 *
 * Offline por construcción: sin red, sin Supabase real, sin Apollo, sin Lusha,
 * 0 créditos. Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// Espías globales — deben quedar en CERO en todos los casos de este archivo
// ═══════════════════════════════════════════════════════════════

interface Spies {
  /** Veces que se construyó el cliente service-role. */
  adminClients: number;
  /** Tablas sobre las que se abrió una consulta. */
  tables: string[];
  /** Llamadas al cliente HTTP de Lusha (gasto real de créditos). */
  lushaCalls: number;
  /** Filas escritas en `provider_usage_logs`. */
  usageLogs: number;
  /**
   * Filas del waterfall REALMENTE persistidas. Un INSERT/UPDATE que el driver
   * rechaza no deja fila, así que no cuenta: lo que se quiere medir es "¿quedó una
   * corrida parcial?", no "¿se intentó escribir?".
   */
  waterfallWrites: number;
}

const spies: Spies = {
  adminClients: 0,
  tables: [],
  lushaCalls: 0,
  usageLogs: 0,
  waterfallWrites: 0,
};

function resetSpies(): void {
  spies.adminClients = 0;
  spies.tables = [];
  spies.lushaCalls = 0;
  spies.usageLogs = 0;
  spies.waterfallWrites = 0;
}

// ═══════════════════════════════════════════════════════════════
// Driver Supabase simulado
// ═══════════════════════════════════════════════════════════════

/**
 * Error tal y como lo entrega PostgREST cuando la relación no existe. Los dos
 * códigos son los que puede producir esta pila: `42P01` viene de Postgres y
 * `PGRST205` de la caché de esquema de PostgREST cuando la tabla no está en ella.
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

/** Error de DB que NO es "tabla ausente": el fail-closed no debe depender del código. */
const OTHER_DB_ERROR = {
  code: '57014',
  message: 'canceling statement due to statement timeout',
};

type DbError = { code: string; message: string };

/** Resultado que el driver simulado devolverá para la tabla del waterfall. */
let waterfallResult: { data: unknown; error: DbError | null } = {
  data: null,
  error: null,
};

/**
 * Candidato EXISTENTE y elegible para la 2ª pata (source lusha + id propio). Que
 * exista es deliberado: así el arranque llega hasta la tabla 102 y el único motivo
 * posible de fallo es la migración ausente, no un candidato que no está.
 */
const CANDIDATE_ROW = {
  id: 'cand-waterfall-102-absent',
  source: 'lusha',
  source_contact_id: 'v1.abcdef',
  phone: null,
  email: null,
  linkedin_url: null,
  phone_reveal_status: 'no_phone_found',
  apollo_person_id: null,
  run: { account_id: null },
};

/**
 * Cadena encadenable y "thenable": replica la forma de `@supabase/supabase-js`
 * usada por los deps (select/eq/in/gt/is/order/limit/maybeSingle/insert/update),
 * y resuelve siempre al mismo `{ data, error }`.
 */
function chain(result: { data: unknown; error: DbError | null }): unknown {
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
  ]) {
    self[method] = () => self;
  }
  // `await`-able en cualquier punto de la cadena (los UPDATE se esperan directo).
  self.then = (
    resolve: (v: { data: unknown; error: DbError | null }) => unknown,
  ): unknown => resolve(result);
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => {
      spies.adminClients += 1;
      return {
        from: (table: string) => {
          spies.tables.push(table);
          if (table === 'contact_enrichment_candidates') {
            return chain({ data: CANDIDATE_ROW, error: null });
          }
          if (table !== 'phone_reveal_waterfall_runs') {
            return chain({ data: null, error: null });
          }
          const base = chain(waterfallResult) as Record<string, unknown>;
          return {
            ...base,
            select: () => base,
            insert: () => {
              if (!waterfallResult.error) spies.waterfallWrites += 1;
              return base;
            },
            update: () => {
              if (!waterfallResult.error) spies.waterfallWrites += 1;
              return base;
            },
          };
        },
      };
    },
  },
});

// ── Proveedores y usage-log: espiados, jamás reales ───────────────

mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    enrichLushaContactPhonesForFallback: async () => {
      spies.lushaCalls += 1;
      throw new Error('BUG: Lusha fue llamado con la tabla 102 ausente');
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

// ── Módulo bajo prueba: el cableado REAL ──────────────────────────
// Import DINÁMICO dentro de `before`: los mocks de arriba deben estar instalados
// antes de que el módulo real resuelva sus imports (mismo patrón que los tests de
// rutas que ya usan mock.module).

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
const CANDIDATE_ID = 'cand-waterfall-102-absent';
const ADMIN = { internalUserId: 'user-admin', roleKey: 'admin' };

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
  assert.equal(spies.lushaCalls, 0, 'Lusha NO puede ser llamado');
  assert.equal(spies.usageLogs, 0, 'no se registra gasto de proveedor');
  assert.equal(spies.waterfallWrites, 0, 'no queda ninguna corrida parcial');
}

beforeEach(() => {
  resetSpies();
  waterfallResult = { data: null, error: null };
  setFlags(false, false);
});

// ═══════════════════════════════════════════════════════════════
// 1. Flag APAGADO — la tabla 102 no se consulta nunca
// ═══════════════════════════════════════════════════════════════

describe('102 ausente — flag OFF: la tabla no se consulta', () => {
  it('la continuación sale en el primer gate: 0 clientes admin, 0 consultas', async () => {
    setFlags(false, false);

    const result = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'no_phone_found',
      apolloCostCredits: 8,
    });

    assert.equal(result.outcome, 'noop');
    assert.equal(result.reason, 'feature_disabled');
    assert.equal(result.lushaCalled, false);
    // El gate es el FLAG, no un fallo de la tabla: no se llega a construir el
    // cliente service-role, así que la migración ausente es irrelevante aquí.
    assert.equal(spies.adminClients, 0);
    assert.equal(waterfallTableQueries(), 0);
    assertNoSpendAtAll();
  });

  it('el arranque de la corrida no lee candidato ni toca la tabla', async () => {
    setFlags(false, false);

    const started = await core.startPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID },
      deps.buildStartWaterfallDeps(ADMIN),
    );

    assert.equal(started.started, false);
    assert.equal(started.started === false && started.reason, 'feature_disabled');
    assert.equal(spies.adminClients, 0);
    assert.equal(waterfallTableQueries(), 0);
    assertNoSpendAtAll();
  });

  it('los builders resuelven el flag como OFF (no lo cachean de otro test)', () => {
    setFlags(false, false);
    assert.equal(deps.buildStartWaterfallDeps(ADMIN).flagEnabled, false);
    assert.equal(deps.buildContinueWaterfallDeps().flagEnabled, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Flag ON + admin + TABLA AUSENTE — fallo controlado ANTES del proveedor
// ═══════════════════════════════════════════════════════════════

describe('102 ausente — flag ON + admin: fail-closed antes de cualquier proveedor', () => {
  for (const { label, error } of TABLE_MISSING_ERRORS) {
    it(`continuación con ${label}: noop controlado, sin Lusha`, async () => {
      setFlags(true, true);
      waterfallResult = { data: null, error };

      const result = await deps.continuePhoneRevealWaterfallForCandidate({
        candidateId: CANDIDATE_ID,
        apolloOutcome: 'no_phone_found',
        apolloCostCredits: 8,
      });

      // Contrato A: la corrida se declara no disponible. Nunca una excepción que
      // suba al webhook (un 5xx haría a Apollo reintentar sin resolver nada).
      assert.equal(result.outcome, 'noop');
      assert.equal(result.reason, 'continuation_failed');
      assert.equal(result.lushaCalled, false);
      // Se intentó leer la tabla (el flag estaba ON) y el fallo cortó ahí mismo.
      assert.ok(waterfallTableQueries() >= 1);
      assertNoSpendAtAll();
    });

    it(`arranque con ${label}: no crea corrida y no revienta el reveal Apollo`, async () => {
      setFlags(true, true);
      waterfallResult = { data: null, error };

      // El arranque real propaga; el wrapper del server action lo degrada a
      // "sin waterfall" y el reveal Apollo que el operador autorizó sigue solo.
      await assert.rejects(
        core.startPhoneRevealWaterfall(
          { candidateId: CANDIDATE_ID },
          deps.buildStartWaterfallDeps(ADMIN),
        ),
        /phone_reveal_waterfall_runs/,
      );
      assert.equal(spies.waterfallWrites, 0, 'no se insertó ninguna corrida');
      assertNoSpendAtAll();
    });
  }

  it('un error de DB que NO es "tabla ausente" tampoco abre la pata Lusha', async () => {
    setFlags(true, true);
    waterfallResult = { data: null, error: OTHER_DB_ERROR };

    const result = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'no_phone_found',
      apolloCostCredits: 8,
    });

    // El fail-closed NO depende de reconocer un código concreto de Postgres.
    assert.equal(result.outcome, 'noop');
    assert.equal(result.lushaCalled, false);
    assertNoSpendAtAll();
  });

  it('un reintento sobre la tabla ausente sigue sin arrancar proveedores', async () => {
    setFlags(true, true);
    waterfallResult = { data: null, error: TABLE_MISSING_ERRORS[0].error };

    for (let i = 0; i < 3; i += 1) {
      const result = await deps.continuePhoneRevealWaterfallForCandidate({
        candidateId: CANDIDATE_ID,
        apolloOutcome: 'no_phone_found',
        apolloCostCredits: 8,
      });
      assert.equal(result.lushaCalled, false);
    }
    // Idempotente en el sentido que importa: repetir no acumula gasto.
    assertNoSpendAtAll();
  });

  it('con el fallback Lusha ENCENDIDO el resultado no cambia (la tabla manda)', async () => {
    setFlags(true, true);
    waterfallResult = { data: null, error: TABLE_MISSING_ERRORS[1].error };

    const result = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'no_phone_found',
      apolloCostCredits: 8,
    });

    assert.equal(result.lushaCalled, false);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. La capa de deps falla FUERTE (no degrada a "no hay corrida")
// ═══════════════════════════════════════════════════════════════

describe('102 ausente — el acceso a datos propaga, no inventa un estado', () => {
  for (const { label, error } of TABLE_MISSING_ERRORS) {
    it(`findActiveWaterfallRunForCandidate lanza con ${label}`, async () => {
      waterfallResult = { data: null, error };
      // Devolver `null` aquí sería el bug de fondo: "no hay corrida activa" es lo
      // que autoriza abrir una nueva, y una tabla ausente NO es esa afirmación.
      await assert.rejects(deps.findActiveWaterfallRunForCandidate(CANDIDATE_ID));
      assertNoSpendAtAll();
    });

    it(`findLatestWaterfallRunForCandidate lanza con ${label}`, async () => {
      waterfallResult = { data: null, error };
      await assert.rejects(deps.findLatestWaterfallRunForCandidate(CANDIDATE_ID));
    });

    it(`createWaterfallRun lanza con ${label} (no confunde con 23505)`, async () => {
      waterfallResult = { data: null, error };
      // 23505 (índice único) SÍ es un `null` legítimo; una tabla ausente no.
      await assert.rejects(
        deps.createWaterfallRun({
          candidateId: CANDIDATE_ID,
          status: 'apollo_in_flight',
          authorizedAt: new Date().toISOString(),
          authorizedBy: ADMIN.internalUserId,
          authorizedByRole: 'admin',
          maxCreditsAuthorized: 13,
          apolloAttemptedAt: new Date().toISOString(),
          lushaEligible: true,
          lushaSkippedReason: null,
        }),
      );
    });

    it(`updateWaterfallRun lanza con ${label}`, async () => {
      waterfallResult = { data: null, error };
      await assert.rejects(deps.updateWaterfallRun('run-1', { status: 'exhausted' }));
    });

    it(`claimLushaAttempt lanza con ${label} (NUNCA devuelve true)`, async () => {
      waterfallResult = { data: null, error };
      // Un `true` aquí sería una autorización inventada para gastar 5 créditos.
      await assert.rejects(deps.claimLushaAttempt('run-1'));
      assertNoSpendAtAll();
    });
  }

  it('resolveActiveWaterfallRunId es best-effort: devuelve null y no lanza', async () => {
    waterfallResult = { data: null, error: TABLE_MISSING_ERRORS[0].error };
    // Solo correlaciona un usage-log: perder la correlación es aceptable, y no
    // autoriza nada por sí mismo.
    assert.equal(await deps.resolveActiveWaterfallRunId(CANDIDATE_ID), null);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Rol — la tabla ausente no relaja el gate de autorización
// ═══════════════════════════════════════════════════════════════

describe('102 ausente — el gate de rol se evalúa antes que la infraestructura', () => {
  for (const roleKey of ['commercial_manager', 'seller_bd', 'lead', null]) {
    it(`${roleKey ?? 'sin rol'}: no consulta la tabla ni crea corrida`, async () => {
      setFlags(true, true);
      waterfallResult = { data: null, error: TABLE_MISSING_ERRORS[0].error };

      const started = await core.startPhoneRevealWaterfall(
        { candidateId: CANDIDATE_ID },
        deps.buildStartWaterfallDeps({ internalUserId: 'user-x', roleKey }),
      );

      assert.equal(started.started, false);
      assert.equal(started.started === false && started.reason, 'role_not_allowed');
      // El rol corta ANTES de tocar infraestructura: por eso un rol no autorizado
      // ni siquiera puede provocar el error de tabla ausente.
      assert.equal(waterfallTableQueries(), 0);
      assertNoSpendAtAll();
    });
  }
});
