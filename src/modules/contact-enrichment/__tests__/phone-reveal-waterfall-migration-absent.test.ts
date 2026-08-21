/**
 * Tests — el waterfall con la MIGRACIÓN 102 AUSENTE
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2 / 2A)
 *
 * Producción tiene el código del waterfall (PR #195) pero NO la tabla
 * `phone_reveal_waterfall_runs`: la migración máxima aplicada es la 101. Este
 * archivo fija por regresión qué hace exactamente esa combinación, y lo hace
 * atravesando el CABLEADO REAL (el server action `revealCandidatePhoneAction` y
 * `phone-reveal-waterfall-deps.ts`), no solo el core puro: lo que se mockea es el
 * DRIVER de Supabase y los clientes de proveedor, no las decisiones.
 *
 * CONTRATO CORREGIDO (2A). La corrida de auditoría es PRECONDICIÓN de ejecutar
 * proveedores cuando el waterfall está activo. Con el flag encendido el
 * administrador autorizó un waterfall AUDITADO, así que si su corrida no se puede
 * crear NO debe ejecutarse ningún proveedor — ni siquiera Apollo por la ruta
 * legacy. Antes se degradaba a "reveal Apollo sin 2ª pata"; eso no estaba
 * aprobado y es lo que este archivo fija ahora:
 *
 *   1. ORDEN DE LOS GATES: flag → autorización → infraestructura → corrida →
 *      proveedor. Con el flag apagado NO se construye el cliente admin y NO se
 *      consulta la tabla 102: no se puede "consultar primero y descubrir después"
 *      que la feature está off.
 *
 *   2. FLAG ON + admin + TABLA AUSENTE ⇒ `waterfall_infrastructure_unavailable`:
 *      1 intento de crear la corrida, 0 llamadas a Apollo, 0 llamadas a Lusha,
 *      0 usage-logs, 0 corridas parciales, 0 créditos. Ni excepción no controlada
 *      ni `ok: true`.
 *
 *   3. LA GARANTÍA NO DEPENDE DE UN CÓDIGO DE POSTGRES: `42P01`, `PGRST205` y un
 *      `57014` (timeout) producen el mismo cierre.
 *
 *   4. LA CAPA DE DEPS FALLA FUERTE. Las funciones de I/O propagan el error del
 *      driver en vez de degradarlo a "no hay corrida": confundir "no existe la
 *      tabla" con "no hay corrida activa" sería exactamente el bug que dejaría
 *      correr la 2ª pata sin autorización registrada.
 *
 *   5. LO QUE NO CAMBIA: con el flag APAGADO el reveal Apollo legacy queda intacto,
 *      y un rol no autorizado (`commercial_manager`) conserva su flujo Apollo-only
 *      sin tocar la tabla 102 ni poder alcanzar Lusha. Con la tabla DISPONIBLE, la
 *      corrida se crea ANTES de Apollo y el flujo del PR #195 sigue igual.
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
 * `fetch` global sustituido por un stub: NINGUNA petición sale de este proceso.
 * El cliente service-role que el server action construye para persistir el START
 * es el REAL (`@supabase/supabase-js`), y con este stub trabaja offline; a cambio,
 * toda petición queda registrada, así que "0 llamadas a proveedores" se puede
 * afirmar también a nivel de RED y no solo de espía de función.
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
  /** Veces que se construyó el cliente service-role del waterfall. */
  adminClients: number;
  /** Tablas sobre las que se abrió una consulta (cualquier cliente). */
  tables: string[];
  /** Llamadas al START de Apollo (gasto real de créditos). */
  apolloCalls: number;
  /** Llamadas al cliente HTTP de Lusha (gasto real de créditos). */
  lushaCalls: number;
  /** Filas escritas en `provider_usage_logs`. */
  usageLogs: number;
  /** INSERTs emitidos contra la tabla de corridas (con o sin éxito). */
  insertAttempts: number;
  /**
   * Filas del waterfall REALMENTE persistidas. Un INSERT/UPDATE que el driver
   * rechaza no deja fila, así que no cuenta: lo que se quiere medir es "¿quedó una
   * corrida parcial?", no "¿se intentó escribir?".
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

/**
 * Secuencia de efectos observables, en orden. Sirve para demostrar que la corrida
 * se registra ANTES de que Apollo se llame (y que, cuando no se registra, Apollo
 * no aparece nunca).
 */
let events: string[] = [];

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
  events = [];
  httpRequests = [];
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

/** Los TRES fallos deben producir el mismo cierre. */
const ALL_CREATE_RUN_FAILURES = [
  ...TABLE_MISSING_ERRORS,
  { label: '57014 (timeout: código NO reconocido)', error: OTHER_DB_ERROR },
] as const;

type DbError = { code: string; message: string };

/** Error que la tabla 102 devuelve en TODAS sus operaciones. null = tabla sana. */
let waterfallTableError: DbError | null = null;
/**
 * Error que devuelve SOLO el INSERT (la lectura funciona). Modela un entorno
 * parcialmente roto — permiso, timeout en la escritura — en el que la creación de
 * la corrida SÍ se intenta y falla, a diferencia de la tabla ausente, donde la
 * primera lectura ya revienta y el INSERT nunca se emite.
 */
let waterfallInsertError: DbError | null = null;
/** Fila que devuelve el SELECT de corrida (null = no hay corrida). */
let waterfallSelectRow: unknown = null;
/** Id que devuelve el INSERT. null simula "el INSERT no devolvió id". */
let waterfallInsertId: string | null = 'run-waterfall-102';

const RUN_ID = 'run-waterfall-102';
const CANDIDATE_ID = 'cand-waterfall-102-absent';
/**
 * Apollo person id sintético (24 hex), opaco e inventado, y cuenta sintética.
 * AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1: la comprobación de supresión en vuelo
 * necesita AMBOS —clave Y cuenta— resolubles o bloquea (`not_evaluable` ⇒
 * fail-closed). Este archivo prueba el gate de infraestructura de la tabla 102
 * (migración ausente/presente), no la resolución de identidad de la supresión,
 * así que los dos candidatos sintéticos traen ambos valores. Los proveedores
 * simulados devuelven "sin fila" para cualquier tabla de supresión/DNC, así que
 * esto no cambia el resultado "no suprimido" que ya tenían.
 */
const CANDIDATE_ACCOUNT_ID = 'acct-waterfall-102-absent';
const CANDIDATE_APOLLO_PERSON_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';

/**
 * Candidato EXISTENTE y elegible para la 2ª pata (source lusha + id propio). Que
 * exista es deliberado: así el arranque llega hasta la tabla 102 y el único motivo
 * posible de fallo es la migración ausente, no un candidato que no está.
 */
const CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  source: 'lusha',
  source_contact_id: 'v1.abcdef',
  phone: null,
  email: null,
  linkedin_url: null,
  phone_reveal_status: 'no_phone_found',
  apollo_person_id: CANDIDATE_APOLLO_PERSON_ID,
  run: { account_id: CANDIDATE_ACCOUNT_ID },
};

/**
 * Proyección que lee el server action del reveal con el cliente de sesión. Tiene
 * email y nombre para que la identidad sea suficiente y el START pueda llegar a
 * Apollo: así "0 llamadas a Apollo" prueba el gate del waterfall y no un gate de
 * identidad que habría cortado igual. La cuenta y el Apollo person id sintéticos
 * hacen evaluable la supresión (ver nota arriba); el driver simulado sigue
 * devolviendo "sin fila" para `contacts`, así que do-not-contact tampoco bloquea.
 */
const REVEAL_CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  source: 'lusha',
  source_contact_id: 'v1.abcdef',
  email: 'contacto@ejemplo.test',
  linkedin_url: null,
  first_name: 'Nombre',
  last_name: 'Apellido',
  phone: null,
  enrichment_metadata: {},
  phone_reveal_status: null,
  phone_reveal_attempt_count: 0,
  apollo_person_id: CANDIDATE_APOLLO_PERSON_ID,
  country: null,
  run: {
    account_id: CANDIDATE_ACCOUNT_ID,
    company_name: 'Empresa De Prueba',
    company_country_code: null,
  },
};

/**
 * Cadena encadenable y "thenable": replica la forma de `@supabase/supabase-js`
 * usada por los deps y por el action (select/eq/in/gt/is/order/limit/maybeSingle/
 * single/insert/update), y resuelve siempre al mismo `{ data, error }`.
 */
function chain(result: { data: unknown; error: DbError | null }): Record<string, unknown> {
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
  // `await`-able en cualquier punto de la cadena (los UPDATE se esperan directo).
  self.then = (
    resolve: (v: { data: unknown; error: DbError | null }) => unknown,
  ): unknown => resolve(result);
  return self;
}

/** Cliente admin (service-role) del waterfall y de la caché de teléfonos. */
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
              events.push('waterfall_insert');
              return chain({
                data: waterfallInsertId ? { id: waterfallInsertId } : null,
                error: null,
              });
            },
            update: () => {
              if (err) return chain(failure);
              spies.waterfallWrites += 1;
              events.push('waterfall_update');
              return chain({ data: [{ id: RUN_ID }], error: null });
            },
          };
        },
        // Reserva atómica de créditos (AGENT2A-PHONE-WATERFALL-4E, migración 104).
        // Simulada aquí para que este archivo siga midiendo lo que mide —el gate de
        // infraestructura de la tabla 102— y, de paso, para poder afirmar que una
        // corrida que NO se pudo crear libera la exposición que había reservado.
        rpc: (fn: string, params: Record<string, unknown>) => {
          // AGENT2A-PHONE-WATERFALL-4F. La reserva y el INSERT de la corrida son UNA
          // función SQL, así que la salud de la tabla 102 se observa AQUÍ: la función
          // la toca, y si no existe la RPC entera falla. Eso es lo que hace que un
          // rollback deje CERO reservas — ya no hay compensación que pueda no llegar.
          if (fn === 'reserve_and_create_phone_reveal_run') {
            spies.creditReservations += 1;
            spies.insertAttempts += 1;
            events.push('credit_reserve');

            if (waterfallTableError) {
              return chain({ data: null, error: waterfallTableError });
            }
            if (waterfallInsertError) {
              // El 23505 lo captura la propia función y lo devuelve como desenlace,
              // deshaciendo la transacción entera.
              if (waterfallInsertError.code === '23505') {
                return chain({ data: { status: 'create_conflict' }, error: null });
              }
              return chain({ data: null, error: waterfallInsertError });
            }

            const legs =
              (params.p_legs as { provider_key: string; credits: number }[]) ?? [];
            if (!waterfallInsertId) {
              // Anomalía: la función dice haber creado y no devuelve id. No se puede
              // afirmar que la fila exista, así que el wrapper lo trata como indisponible.
              return chain({ data: { status: 'created' }, error: null });
            }
            spies.waterfallWrites += 1;
            events.push('waterfall_insert');
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
            events.push('credit_release');
            return chain({ data: 'released', error: null });
          }
          if (fn === 'confirm_phone_reveal_credits') {
            events.push('credit_confirm');
            return chain({ data: 'confirmed', error: null });
          }
          return chain({ data: null, error: null });
        },
      };
    },
  },
});

/**
 * Presupuesto POR PROVEEDOR resuelto (AGENT2A-PHONE-WATERFALL-4E). Se mockea porque
 * `checkBudget` habla con SU propio cliente admin y con `provider_usage_logs`, que no es
 * el sujeto de este archivo: aquí lo que se prueba es el gate de infraestructura de la
 * tabla 102. Un pozo con límite amplio deja pasar el preflight para que el bloqueo que se
 * observe sea el de la corrida y no el del presupuesto.
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

/** Cliente de SESIÓN del server action: auth + lectura del candidato. */
let sessionRoleKey: string | null = 'admin';

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
      },
      from: (table: string) => {
        spies.tables.push(table);
        if (table === 'internal_users') {
          return chain({
            data: { id: 'user-admin', role_id: 'role-1' },
            error: null,
          });
        }
        if (table === 'roles') {
          return chain({ data: { key: sessionRoleKey }, error: null });
        }
        if (table === 'contact_enrichment_candidates') {
          return chain({ data: REVEAL_CANDIDATE_ROW, error: null });
        }
        // `contacts` (do-not-contact) y cualquier otra: lista vacía.
        return chain({ data: [], error: null });
      },
    }),
  },
});

// El cliente service-role que el action construye (`@supabase/supabase-js`) se
// deja REAL a propósito: con el `fetch` global stubbeado no sale ninguna petición,
// y así el test no depende de mockear un paquete de terceros.

/** Un `redirect` alcanzado sería un fallo de setup, no un caso de prueba. */
mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`BUG: redirect inesperado a ${to}`);
    },
  },
});

// ── Proveedores y usage-log: espiados, jamás reales ───────────────

mock.module('@/server/integrations/apollo-client', {
  namedExports: {
    startApolloPhoneReveal: async () => {
      spies.apolloCalls += 1;
      events.push('apollo_call');
      return {
        success: true,
        requestId: 'apollo-request-id-test',
        noAsyncJobCode: null,
        // `apollo_http_request_id` es obligatorio para que el START pueda quedar
        // `requested` (invariante de recuperabilidad del contrato ASYNC-21C).
        trace: { apollo_http_request_id: 'apollo-http-request-id-test' },
      };
    },
  },
});

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
      events.push('usage_log');
      return true;
    },
  },
});

// ── Módulos bajo prueba: el cableado REAL ─────────────────────────
// Import DINÁMICO dentro de `before`: los mocks de arriba deben estar instalados
// antes de que los módulos reales resuelvan sus imports (mismo patrón que los
// tests de rutas que ya usan mock.module).

type WaterfallDeps = typeof import('../phone-reveal-waterfall-deps');
type WaterfallCore = typeof import('../phone-reveal-waterfall-core');
type RevealActions = typeof import('../phone-reveal-actions');

let deps: WaterfallDeps;
let core: WaterfallCore;
let actions: RevealActions;

before(async () => {
  deps = await import('../phone-reveal-waterfall-deps');
  core = await import('../phone-reveal-waterfall-core');
  actions = await import('../phone-reveal-actions');
});

const WATERFALL_FLAG = 'ENABLE_PHONE_REVEAL_WATERFALL';
const LUSHA_FALLBACK_FLAG = 'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK';
const APOLLO_REVEAL_FLAG = 'ENABLE_APOLLO_PHONE_REVEAL';
const ADMIN = { internalUserId: 'user-admin', roleKey: 'admin' };

function setFlags(waterfall: boolean, lushaFallback: boolean): void {
  if (waterfall) process.env[WATERFALL_FLAG] = 'true';
  else delete process.env[WATERFALL_FLAG];
  if (lushaFallback) process.env[LUSHA_FALLBACK_FLAG] = 'true';
  else delete process.env[LUSHA_FALLBACK_FLAG];
}

/** Payload que la UI envía en un clic real de "Revelar teléfono". */
function revealInput(expectedMaxCredits: number) {
  return {
    candidateId: CANDIDATE_ID,
    confirmCost: true,
    expectedMaxCredits,
    phoneProcessingBasis: 'legitimate_interest_b2b' as const,
    phoneProcessingBasisNote: undefined,
  };
}

/** Cuántas veces se consultó la tabla de la migración 102 (cualquier cliente). */
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
  sessionRoleKey = 'admin';
  setFlags(false, false);
  // El reveal Apollo SÍ está encendido en estos tests: lo que se prueba es que el
  // gate del waterfall lo detiene, no que estuviera apagado de todas formas.
  process.env[APOLLO_REVEAL_FLAG] = 'true';
  process.env.APOLLO_PHONE_REVEAL_WEBHOOK_URL = 'https://sellup.test/api/apollo/webhook';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
  delete process.env.ENABLE_APOLLO_PHONE_CACHE;
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

  it('EL REVEAL LEGACY QUEDA INTACTO: Apollo corre y la tabla 102 no se consulta', async () => {
    setFlags(false, false);
    // La tabla estaría rota si alguien la consultara; con el flag apagado nadie lo
    // hace, así que el reveal Apollo de siempre funciona exactamente igual.
    waterfallTableError = TABLE_MISSING_ERRORS[0].error;

    const result = await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(result.status, 'requested');
    assert.equal(result.ok, true);
    assert.equal(spies.apolloCalls, 1, 'el reveal Apollo legacy sigue ejecutándose');
    assert.equal(waterfallTableQueries(), 0, 'ninguna consulta a la tabla del waterfall');
    assert.equal(spies.insertAttempts, 0, 'no se intenta crear ninguna corrida');
    assert.equal(spies.lushaCalls, 0, 'Lusha nunca participa con el flag apagado');
    assert.equal(spies.waterfallWrites, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Flag ON + admin + LA CORRIDA NO SE PUEDE CREAR
//    ⇒ cierre tipado ANTES de cualquier proveedor
// ═══════════════════════════════════════════════════════════════

describe('102 ausente — flag ON + admin: ningún proveedor sin corrida registrada', () => {
  for (const { label, error } of ALL_CREATE_RUN_FAILURES) {
    it(`${label}: el action devuelve waterfall_infrastructure_unavailable`, async () => {
      setFlags(true, true);
      waterfallTableError = error;

      const result = await actions.revealCandidatePhoneAction(revealInput(13));

      // Resultado TIPADO de infraestructura no disponible. No es un error de
      // Apollo, no es `no_phone_found` y no es un éxito parcial.
      assert.equal(result.status, 'waterfall_infrastructure_unavailable');
      assert.equal(result.ok, false);
      assert.equal(result.requestAccepted, false);
      assert.equal(result.errorCode, 'waterfall_run_unavailable');
      assert.notEqual(result.status, 'no_phone_found');
      assert.equal(result.servedFromCache, undefined);

      // UN SOLO intento de abrir la corrida, sin retry: exactamente una operación
      // contra la tabla 102. Con la tabla ausente el fallo aparece en la primera
      // lectura (la que comprueba si ya hay autorización viva), así que el INSERT
      // ni se emite — y por eso no puede quedar una corrida a medias.
      assert.equal(waterfallTableQueries(), 1, 'un solo intento, sin retry');
      assert.equal(spies.insertAttempts, 0, 'el INSERT no llega a emitirse');
      assertNoSpendAtAll();
      assert.deepEqual(events, [], 'ningún efecto observable');
    });
  }

  for (const { label, error } of ALL_CREATE_RUN_FAILURES) {
    it(`INSERT rechazado con ${label}: 1 intento de crear la corrida y nada más`, async () => {
      setFlags(true, true);
      // La lectura funciona (no hay corrida viva) pero el INSERT falla. Aquí la
      // creación SÍ se intenta, exactamente una vez, y el fallo cierra el paso.
      waterfallInsertError = error;

      const result = await actions.revealCandidatePhoneAction(revealInput(13));

      assert.equal(result.status, 'waterfall_infrastructure_unavailable');
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, 'waterfall_run_unavailable');
      assert.equal(spies.insertAttempts, 1, 'un solo INSERT, sin retry');
      assertNoSpendAtAll();
    });
  }

  it('el fallo NO se convierte en excepción no controlada ni en 5xx genérico', async () => {
    setFlags(true, true);
    waterfallTableError = TABLE_MISSING_ERRORS[0].error;

    // El contrato del action es un ActionResult: debe RESOLVER con el estado
    // tipado, nunca rechazar (un throw se traduciría en un 500 opaco en la UI).
    await assert.doesNotReject(actions.revealCandidatePhoneAction(revealInput(13)));
  });

  it('un INSERT que no devuelve id tampoco deja pasar a Apollo', async () => {
    setFlags(true, true);
    // Sin error del driver, pero sin id: no se puede afirmar que la corrida exista
    // ni que no exista ⇒ no se puede correlacionar ni cerrar ⇒ fail-closed.
    waterfallInsertId = null;

    const result = await actions.revealCandidatePhoneAction(revealInput(13));

    assert.equal(result.status, 'waterfall_infrastructure_unavailable');
    assert.equal(spies.insertAttempts, 1, 'el INSERT sí se emitió');
    assert.equal(spies.apolloCalls, 0, 'Apollo NO puede correr sin corrida correlacionable');
    assert.equal(spies.lushaCalls, 0);
    assert.equal(spies.usageLogs, 0);
  });

  it('reintentar sobre la tabla ausente sigue sin arrancar proveedores', async () => {
    setFlags(true, true);
    waterfallTableError = TABLE_MISSING_ERRORS[1].error;

    for (let i = 0; i < 3; i += 1) {
      const result = await actions.revealCandidatePhoneAction(revealInput(13));
      assert.equal(result.status, 'waterfall_infrastructure_unavailable');
    }
    // Idempotente en el sentido que importa: repetir no acumula gasto.
    assert.equal(waterfallTableQueries(), 3, 'un intento por clic, ninguno de más');
    assertNoSpendAtAll();
  });

  it('con el fallback Lusha APAGADO el resultado es el mismo (manda la corrida)', async () => {
    setFlags(true, false);
    waterfallTableError = OTHER_DB_ERROR;

    const result = await actions.revealCandidatePhoneAction(revealInput(13));

    assert.equal(result.status, 'waterfall_infrastructure_unavailable');
    assertNoSpendAtAll();
  });

  it('la CONTINUACIÓN (webhook / recovery) sigue siendo un noop best-effort', async () => {
    setFlags(true, true);
    waterfallTableError = TABLE_MISSING_ERRORS[0].error;

    const result = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'no_phone_found',
      apolloCostCredits: 8,
    });

    // Aquí el best-effort SÍ es correcto: un throw convertiría un callback válido
    // de Apollo en 5xx y provocaría reintentos que no resuelven nada. Lo que no
    // puede pasar es que abra la pata Lusha.
    assert.equal(result.outcome, 'noop');
    assert.equal(result.reason, 'continuation_failed');
    assert.equal(result.lushaCalled, false);
    assert.ok(waterfallTableQueries() >= 1);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. La capa de deps falla FUERTE (no degrada a "no hay corrida")
// ═══════════════════════════════════════════════════════════════

describe('102 ausente — el acceso a datos propaga, no inventa un estado', () => {
  for (const { label, error } of TABLE_MISSING_ERRORS) {
    it(`findActiveWaterfallRunForCandidate lanza con ${label}`, async () => {
      waterfallTableError = error;
      // Devolver `null` aquí sería el bug de fondo: "no hay corrida activa" es lo
      // que autoriza abrir una nueva, y una tabla ausente NO es esa afirmación.
      await assert.rejects(deps.findActiveWaterfallRunForCandidate(CANDIDATE_ID));
      assertNoSpendAtAll();
    });

    it(`findLatestWaterfallRunForCandidate lanza con ${label}`, async () => {
      waterfallTableError = error;
      await assert.rejects(deps.findLatestWaterfallRunForCandidate(CANDIDATE_ID));
    });

    it(`createWaterfallRun lanza con ${label} (no confunde con 23505)`, async () => {
      waterfallTableError = error;
      // 23505 (índice único) SÍ es un `null` legítimo; una tabla ausente no.
      await assert.rejects(
        deps.createWaterfallRun({
          candidateId: CANDIDATE_ID,
          status: 'apollo_in_flight',
          // Modalidad del waterfall COMPLETO: este bloque cubre el arranque de
          // Apollo, no la ruta legacy (AGENT2A-PHONE-WATERFALL-2).
          runMode: 'full_waterfall',
          authorizedAt: new Date().toISOString(),
          authorizedBy: ADMIN.internalUserId,
          authorizedByRole: 'admin',
          maxCreditsAuthorized: 13,
          apolloAttemptedAt: new Date().toISOString(),
          lushaEligible: true,
          lushaSkippedReason: null,
          // AGENT2A-PHONE-WATERFALL-4E: el draft siempre trae su grupo de reserva.
          creditReservationGroupId: 'group-absent-1',
        }),
      );
    });

    it(`updateWaterfallRun lanza con ${label}`, async () => {
      waterfallTableError = error;
      await assert.rejects(deps.updateWaterfallRun('run-1', { status: 'exhausted' }));
    });

    it(`claimLushaAttempt lanza con ${label} (NUNCA devuelve true)`, async () => {
      waterfallTableError = error;
      // Un `true` aquí sería una autorización inventada para gastar 5 créditos.
      await assert.rejects(deps.claimLushaAttempt('run-1'));
      assertNoSpendAtAll();
    });
  }

  it('createWaterfallRun lanza cuando el INSERT no devuelve id', async () => {
    waterfallInsertId = null;
    // Devolver `null` lo haría indistinguible de un conflicto benigno (23505), que
    // el caller SÍ usa para continuar con el reveal legacy.
    await assert.rejects(
      deps.createWaterfallRun({
        candidateId: CANDIDATE_ID,
        status: 'apollo_in_flight',
        runMode: 'full_waterfall',
        authorizedAt: new Date().toISOString(),
        authorizedBy: ADMIN.internalUserId,
        authorizedByRole: 'admin',
        maxCreditsAuthorized: 13,
        apolloAttemptedAt: new Date().toISOString(),
        lushaEligible: true,
        lushaSkippedReason: null,
        creditReservationGroupId: 'group-absent-2',
      }),
      /no id/,
    );
  });

  it('resolveActiveWaterfallRunId es best-effort: devuelve null y no lanza', async () => {
    waterfallTableError = TABLE_MISSING_ERRORS[0].error;
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
      waterfallTableError = TABLE_MISSING_ERRORS[0].error;

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

  it('commercial_manager conserva Apollo-only: 0 consultas al waterfall, 0 Lusha', async () => {
    setFlags(true, true);
    sessionRoleKey = 'commercial_manager';
    waterfallTableError = TABLE_MISSING_ERRORS[0].error;

    const result = await actions.revealCandidatePhoneAction(revealInput(8));

    // El rol no autorizado se rechaza ANTES de consultar infraestructura, así que
    // una tabla 102 rota no puede quitarle el flujo Apollo que ya tenía.
    assert.equal(result.status, 'requested');
    assert.equal(waterfallTableQueries(), 0, 'no alcanza el waterfall');
    assert.equal(spies.insertAttempts, 0);
    assert.equal(spies.lushaCalls, 0, 'no puede alcanzar Lusha');
    assert.equal(spies.waterfallWrites, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Infraestructura DISPONIBLE — el flujo del PR #195 no cambia
// ═══════════════════════════════════════════════════════════════

describe('102 presente — la corrida se registra ANTES de Apollo', () => {
  it('flag ON + admin + tabla sana: corrida creada y luego 1 llamada a Apollo', async () => {
    setFlags(true, true);
    waterfallTableError = null;

    const result = await actions.revealCandidatePhoneAction(revealInput(13));

    assert.equal(result.status, 'requested');
    assert.equal(result.ok, true);

    // ORDEN: la autorización queda registrada antes de gastar el primer crédito.
    const insertAt = events.indexOf('waterfall_insert');
    const apolloAt = events.indexOf('apollo_call');
    assert.ok(insertAt >= 0, 'la corrida se crea');
    assert.ok(apolloAt >= 0, 'Apollo se llama');
    assert.ok(insertAt < apolloAt, 'la corrida se crea ANTES de Apollo');

    assert.equal(spies.insertAttempts, 1);
    assert.equal(spies.apolloCalls, 1, 'exactamente una llamada a Apollo');
    // El START asíncrono no toca a Lusha: la 2ª pata la decide el webhook/recovery.
    assert.equal(spies.lushaCalls, 0);
  });

  it('una corrida activa preexistente no bloquea el reveal (already_pending es de Apollo)', async () => {
    setFlags(true, true);
    // `findActiveRun` devuelve una corrida viva ⇒ el core NO abre otra. La
    // autorización ya está registrada, así que no es un fallo de infraestructura y
    // el reveal legacy sigue su curso.
    waterfallSelectRow = {
      id: RUN_ID,
      candidate_id: CANDIDATE_ID,
      status: 'apollo_in_flight',
      authorized_at: new Date().toISOString(),
      authorized_by: 'user-admin',
      authorized_by_role: 'admin',
      max_credits_authorized: 13,
      apollo_attempted_at: new Date().toISOString(),
      apollo_outcome: null,
      apollo_cost_credits: null,
      apollo_cost_source: null,
      lusha_eligible: true,
      lusha_skipped_reason: null,
      lusha_attempted_at: null,
      lusha_outcome: null,
      lusha_cost_credits: null,
      lusha_cost_source: null,
      final_provider: null,
      completed_at: null,
      error_code: null,
    };

    const result = await actions.revealCandidatePhoneAction(revealInput(13));

    assert.notEqual(
      result.status,
      'waterfall_infrastructure_unavailable',
      'una corrida existente NO es infraestructura ausente',
    );
    assert.equal(spies.insertAttempts, 0, 'no se abre una segunda autorización');
    assert.equal(spies.lushaCalls, 0);
  });
});
