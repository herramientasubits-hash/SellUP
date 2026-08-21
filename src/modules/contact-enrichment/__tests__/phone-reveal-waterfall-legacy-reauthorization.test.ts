/**
 * Tests — REAUTORIZACIÓN explícita de la ruta legacy solo-Lusha
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2C)
 *
 * Cierra la contradicción del reporte 2B: el gate de historial decía a la vez
 * "cualquier corrida histórica ⇒ rechazo" y "una corrida terminal puede recibir una
 * autorización nueva". El contrato definitivo es que la CLASE de la corrida histórica
 * decide, no su existencia:
 *
 *   corrida activa                          ⇒ rechazo, 0 corridas, 0 Apollo, 0 Lusha
 *   terminal legacy sin teléfono            ⇒ REAUTORIZABLE con autorización nueva
 *   terminal legacy que ya reveló           ⇒ rechazo
 *   terminal `full_waterfall`               ⇒ rechazo (candidato del flujo completo)
 *   candidato con teléfono                  ⇒ rechazo
 *
 * Y una reautorización es una corrida NUEVA de verdad: `id` nuevo, `authorized_at`
 * nuevo, tope 5 otra vez, TODOS los gates revalidados (flag, rol, elegibilidad,
 * candidato, cuenta, supresión, DNC), Apollo en cero, Lusha como máximo una vez, y la
 * corrida anterior INMUTABLE — no se reabre, no se recicla, no se le copia nada y sus
 * costos no se suman con los de la nueva.
 *
 * Qué se ejercita: el CABLEADO REAL. `startLegacyPhoneRevealWaterfallForCandidate`
 * (deps) → `startLegacyPhoneRevealWaterfall` + `continuePhoneRevealWaterfall` (core) →
 * `runLushaPhoneFallbackReveal` (core del fallback, con sus propios gates) → cliente
 * HTTP de Lusha. Solo se sustituyen los BORDES: el driver de Supabase (store en
 * memoria que replica el índice único parcial y el claim atómico condicional), el
 * cliente de Lusha, el usage-log y la API key.
 *
 * Offline por construcción: `fetch` global cortado, sin Supabase real, sin Apollo, sin
 * Lusha, sin HubSpot, 0 créditos. Los identificadores son sintéticos.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════

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

const PROVIDER_HOST_FRAGMENTS = ['apollo.io', 'lusha.com', 'hubapi.com'];

function providerHttpRequests(): string[] {
  return httpRequests.filter((url) =>
    PROVIDER_HOST_FRAGMENTS.some((host) => url.includes(host)),
  );
}

// ═══════════════════════════════════════════════════════════════
// Store en memoria de `phone_reveal_waterfall_runs`
// ═══════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

/**
 * Estados NO terminales. Espejo literal del predicado del índice único parcial de la
 * migración 102; un test estático de más abajo verifica que sigan coincidiendo con la
 * lista del core, en los dos sentidos.
 */
const ACTIVE_STATUSES = [
  'authorized',
  'apollo_in_flight',
  'lusha_pending',
  'lusha_running',
];

/** Estados desde los que el claim atómico es válido (espejo del WHERE del store). */
const CLAIMABLE_STATUSES = ['apollo_in_flight', 'lusha_pending'];

interface Store {
  runs: Row[];
  /**
   * Reservas de crédito (AGENT2A-PHONE-WATERFALL-4E). Se mantienen con estado real para
   * que la reautorización pruebe también que cada autorización nueva ocupa exposición
   * NUEVA y que la de la corrida anterior ya quedó liquidada.
   */
  reservations: Row[];
  /** UPDATEs aplicados a cada corrida, por id. Mide inmutabilidad. */
  updatesById: Map<string, number>;
  /** Secuencia de INSERT: da un `created_at` monótono y determinista. */
  seq: number;
  /** Errores inyectables por tabla. */
  contactsSelectError: DbError | null;
}

type DbError = { code: string; message: string };

const store: Store = {
  runs: [],
  reservations: [],
  updatesById: new Map(),
  seq: 0,
  contactsSelectError: null,
};

const CANDIDATE_ID = 'cand-legacy-reauth';
/**
 * Apollo person id sintético (24 hex), opaco e inventado. CACHE-1a (mig. 098) ya
 * habría poblado esta columna cuando el intento Apollo previo emparejó una
 * persona (aunque no encontrara teléfono), así que el candidato legacy trae este
 * valor por defecto: sin él la puerta de privacidad ahora bloquea por falta de
 * clave (`not_evaluable` ⇒ fail-closed, AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1) y
 * esta suite deja de poder ejercitar la REAUTORIZACIÓN, que es lo que prueba.
 * `source: 'lusha'` y `source_contact_id` siguen intactos: el caso cross-provider
 * a propósito de este archivo.
 */
const CANDIDATE_APOLLO_PERSON_ID = 'ab01cd23ef45ab01cd23ef46';

/** Candidato ELEGIBLE: terna de evidencia completa, sin teléfono, id Lusha propio. */
let candidateRow: Row = {};

function resetCandidateRow(): void {
  candidateRow = {
    id: CANDIDATE_ID,
    status: 'pending_review',
    source: 'lusha',
    source_contact_id: 'v1.token-sintetico',
    phone: null,
    email: 'legacy@ejemplo.test',
    linkedin_url: null,
    enrichment_metadata: {},
    phone_reveal_status: 'no_phone_found',
    phone_reveal_provider: 'apollo',
    phone_reveal_completed_at: '2026-07-01T10:00:00.000Z',
    phone_reveal_attempt_count: 1,
    apollo_person_id: CANDIDATE_APOLLO_PERSON_ID,
    run: { account_id: 'acct-legacy' },
  };
}

/** Filas `contacts` con `contact_status = 'do_not_contact'` para la re-comprobación. */
let dncContacts: Row[] = [];

// ── Espías de gasto ──────────────────────────────────────────────

interface Spies {
  apolloCalls: number;
  lushaCalls: number;
  usageLogs: Array<{ provider: string; waterfallId: unknown; credits: unknown }>;
  insertAttempts: number;
}

const spies: Spies = { apolloCalls: 0, lushaCalls: 0, usageLogs: [], insertAttempts: 0 };

/** Desenlace que devuelve el cliente de Lusha en la PRÓXIMA llamada. */
type LushaScenario = 'no_phone_found' | 'revealed' | 'http_error' | 'network_error';
let lushaScenario: LushaScenario = 'no_phone_found';

function resetAll(): void {
  store.runs = [];
  store.reservations = [];
  store.updatesById = new Map();
  store.seq = 0;
  store.contactsSelectError = null;
  spies.apolloCalls = 0;
  spies.lushaCalls = 0;
  spies.usageLogs = [];
  spies.insertAttempts = 0;
  httpRequests = [];
  dncContacts = [];
  lushaScenario = 'no_phone_found';
  resetCandidateRow();
}

// ═══════════════════════════════════════════════════════════════
// Driver Supabase simulado (con estado)
// ═══════════════════════════════════════════════════════════════

interface QueryResult {
  data: unknown;
  error: DbError | null;
}

type Filter = (row: Row) => boolean;

/**
 * Mini query-builder encadenable y "thenable" con la forma que usan los deps. A
 * diferencia de un doble que devuelve siempre lo mismo, éste EJECUTA los filtros
 * contra el store, así que reproduce las dos garantías que importan aquí:
 *
 *   * el ÍNDICE ÚNICO PARCIAL — un INSERT con status activo sobre un candidato que ya
 *     tiene una corrida activa devuelve `23505`, que es exactamente la señal que el
 *     runtime traduce a `create_conflict` sin llamar a ningún proveedor;
 *   * el CLAIM ATÓMICO — el UPDATE condicional solo afecta filas con
 *     `lusha_attempted_at IS NULL`, status reclamable y `authorized_at` dentro del TTL,
 *     y devuelve las filas afectadas para que "0 filas ⇒ no llames a Lusha" sea real.
 */
function buildQuery(table: string): Record<string, unknown> {
  const filters: Filter[] = [];
  const orders: Array<{ col: string; asc: boolean }> = [];
  let limitN: number | null = null;
  let single = false;
  let mode: 'select' | 'insert' | 'update' = 'select';
  let payload: Row | null = null;

  function rowsForTable(): Row[] {
    if (table === 'phone_reveal_waterfall_runs') return store.runs;
    if (table === 'phone_reveal_credit_reservations') return store.reservations;
    if (table === 'contact_enrichment_candidates') return [candidateRow];
    if (table === 'contacts') return dncContacts;
    return [];
  }

  function matching(): Row[] {
    return rowsForTable().filter((row) => filters.every((f) => f(row)));
  }

  function sorted(rows: Row[]): Row[] {
    if (orders.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const { col, asc } of orders) {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        if (av === bv) continue;
        return asc ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
      }
      return 0;
    });
  }

  function execute(): QueryResult {
    if (table === 'contacts' && store.contactsSelectError) {
      return { data: null, error: store.contactsSelectError };
    }

    if (mode === 'insert') {
      spies.insertAttempts += 1;
      const row = { ...(payload ?? {}) };
      const status = String(row.status ?? '');
      const candidateId = row.candidate_id;
      if (
        ACTIVE_STATUSES.includes(status) &&
        store.runs.some(
          (r) =>
            r.candidate_id === candidateId &&
            ACTIVE_STATUSES.includes(String(r.status ?? '')),
        )
      ) {
        // Índice único parcial `uq_phone_reveal_waterfall_runs_active_candidate`.
        return {
          data: null,
          error: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "uq_phone_reveal_waterfall_runs_active_candidate"',
          },
        };
      }
      store.seq += 1;
      row.id = `run-${store.seq}`;
      // `created_at` es DEFAULT now() en la tabla real; aquí es monótono para que
      // "la corrida más reciente" sea determinista incluso si dos `authorized_at`
      // caen en el mismo milisegundo.
      row.created_at = new Date(Date.parse('2026-08-03T00:00:00.000Z') + store.seq * 1000)
        .toISOString();
      store.runs.push(row);
      return { data: { id: row.id }, error: null };
    }

    if (mode === 'update') {
      const affected = matching();
      for (const row of affected) {
        Object.assign(row, payload ?? {});
        if (table === 'phone_reveal_waterfall_runs') {
          const id = String(row.id);
          store.updatesById.set(id, (store.updatesById.get(id) ?? 0) + 1);
        }
      }
      return { data: affected.map((r) => ({ id: r.id })), error: null };
    }

    const rows = sorted(matching());
    const limited = limitN === null ? rows : rows.slice(0, limitN);
    if (single) return { data: limited[0] ?? null, error: null };
    return { data: limited, error: null };
  }

  const api: Record<string, unknown> = {};
  const self = api as {
    [key: string]: unknown;
  };
  self.select = () => api;
  self.eq = (col: string, val: unknown) => {
    filters.push((row) => row[col] === val);
    return api;
  };
  self.in = (col: string, vals: unknown[]) => {
    filters.push((row) => vals.includes(row[col] as never));
    return api;
  };
  self.is = (col: string, val: unknown) => {
    filters.push((row) => (row[col] ?? null) === val);
    return api;
  };
  self.gt = (col: string, val: unknown) => {
    filters.push((row) => String(row[col] ?? '') > String(val));
    return api;
  };
  self.order = (col: string, opts?: { ascending?: boolean }) => {
    orders.push({ col, asc: opts?.ascending !== false });
    return api;
  };
  self.limit = (n: number) => {
    limitN = n;
    return api;
  };
  self.maybeSingle = () => {
    single = true;
    return api;
  };
  self.single = () => {
    single = true;
    return api;
  };
  self.insert = (row: Row) => {
    mode = 'insert';
    payload = row;
    return api;
  };
  self.update = (patch: Row) => {
    mode = 'update';
    payload = patch;
    return api;
  };
  self.then = (resolve: (value: QueryResult) => unknown): unknown => resolve(execute());
  return api;
}

/**
 * Reserva atómica de créditos (AGENT2A-PHONE-WATERFALL-4E). Se implementa sobre el mismo
 * store con estado que las corridas, así que la reautorización sigue midiendo lo que
 * medía y además demuestra que cada autorización nueva ocupa exposición nueva.
 *
 * El pozo es amplio a propósito: aquí el sujeto es la reautorización, no el presupuesto —
 * ese tiene sus propias suites.
 */
function reservationRpc(fn: string, params: Record<string, unknown>): QueryResult {
  // AGENT2A-PHONE-WATERFALL-4F: la reserva y el INSERT de la corrida son UNA función
  // SQL. Se simula sobre el MISMO store, y el orden reproduce el del SQL —clave
  // idempotente, exposición viva, disponibilidad, y sólo entonces las escrituras— para
  // que un conflicto deshaga también la reserva, igual que el rollback real.
  if (fn === 'reserve_and_create_phone_reveal_run') {
    const candidateId = params.p_candidate_id;
    const authorizationKey = params.p_authorization_key;

    const existing = store.runs.find(
      (r) => r.authorization_key === authorizationKey,
    );
    if (existing) {
      return {
        data: {
          status: 'already_created',
          run_id: existing.id,
          reservation_group_id: existing.credit_reservation_group_id ?? null,
        },
        error: null,
      };
    }

    if (
      store.reservations.some(
        (r) => r.candidate_id === candidateId && r.status === 'reserved',
      )
    ) {
      return { data: { status: 'already_reserved' }, error: null };
    }

    // La transacción llegó a intentar la escritura: se cuenta aquí, tanto si el índice
    // único la deja pasar como si la rechaza.
    spies.insertAttempts += 1;
    const run = { ...((params.p_run as Row) ?? {}) };
    const status = String(run.status ?? '');
    if (
      ACTIVE_STATUSES.includes(status) &&
      store.runs.some(
        (r) =>
          r.candidate_id === candidateId &&
          ACTIVE_STATUSES.includes(String(r.status ?? '')),
      )
    ) {
      // Índice único parcial `uq_phone_reveal_waterfall_runs_active_candidate`. Cae
      // DENTRO de la transacción, así que no se escribe ninguna reserva.
      return { data: { status: 'create_conflict' }, error: null };
    }

    const legs = (params.p_legs as { provider_key: string; credits: number }[]) ?? [];
    store.seq += 1;
    run.id = `run-${store.seq}`;
    run.candidate_id = candidateId;
    run.authorized_by = params.p_authorized_by;
    run.authorization_key = authorizationKey;
    run.credit_reservation_group_id = params.p_reservation_group_id;
    // `created_at` es DEFAULT now() en la tabla real; aquí es monótono para que
    // "la corrida más reciente" sea determinista.
    run.created_at = new Date(
      Date.parse('2026-08-03T00:00:00.000Z') + store.seq * 1000,
    ).toISOString();
    store.runs.push(run);

    const created = legs.map((leg, index) => {
      const id = `res-${store.reservations.length}-${index}-${leg.provider_key}`;
      store.reservations.push({
        id,
        reservation_group_id: params.p_reservation_group_id,
        candidate_id: candidateId,
        provider_key: leg.provider_key,
        credits_reserved: leg.credits,
        status: 'reserved',
        run_id: run.id,
      });
      return { id, provider_key: leg.provider_key, credits_reserved: leg.credits };
    });

    return {
      data: {
        status: 'created',
        run_id: run.id,
        reservation_group_id: params.p_reservation_group_id,
        reservations: created,
      },
      error: null,
    };
  }

  const target = store.reservations.find((r) => r.id === params.p_reservation_id);
  if (!target) return { data: 'not_found', error: null };
  if (target.status !== 'reserved') {
    return { data: `already_${target.status}`, error: null };
  }
  if (fn === 'confirm_phone_reveal_credits') {
    target.status = 'confirmed';
    target.credits_confirmed = params.p_credits_confirmed;
    target.cost_truth = params.p_cost_truth;
    return { data: 'confirmed', error: null };
  }
  target.status = 'released';
  target.release_reason = params.p_reason;
  return { data: 'released', error: null };
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => buildQuery(table),
      rpc: (fn: string, params: Record<string, unknown>) => {
        const result = reservationRpc(fn, params);
        return { then: (resolve: (v: QueryResult) => unknown) => resolve(result) };
      },
    }),
  },
});

/**
 * Presupuesto POR PROVEEDOR resuelto con un pozo amplio: `checkBudget` habla con su
 * propio cliente admin y con `provider_usage_logs`, que no son el sujeto de este archivo.
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

mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`BUG: redirect inesperado a ${to}`);
    },
  },
});

// ── Proveedores: espiados, jamás reales ──────────────────────────

/**
 * Apollo NO se cuenta: REVIENTA. Un futuro cambio que lo reintroduzca en la ruta
 * legacy debe fallar de forma ruidosa, no quedar como un contador que nadie mira.
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
      if (lushaScenario === 'network_error') {
        return { ok: false as const, errorMessage: 'simulated network failure' };
      }
      if (lushaScenario === 'http_error') {
        return {
          ok: true as const,
          httpStatus: 429,
          phones: [],
          phoneNumber: null,
          phoneType: 'unknown' as const,
          phoneRawType: null,
          creditsCharged: null,
          candidateStatus: 'error' as const,
          usageStatus: 'rate_limited' as const,
          costSource: null,
          errorCode: 'rate_limited' as const,
          availabilitySource: null,
          phonesReturned: 0,
        };
      }
      if (lushaScenario === 'revealed') {
        return {
          ok: true as const,
          httpStatus: 200,
          // 4O-D: el cliente publica la lista COMPLETA además del escalar.
          phones: [
            { number: '+57 300 000 0000', rawType: null, phoneType: 'unknown' as const },
          ],
          phoneNumber: '+57 300 000 0000',
          phoneType: 'unknown' as const,
          phoneRawType: null,
          creditsCharged: 1,
          candidateStatus: 'revealed' as const,
          usageStatus: 'success' as const,
          costSource: 'reported' as const,
          availabilitySource: null,
          errorCode: null,
          phonesReturned: 1,
        };
      }
      return {
        ok: true as const,
        httpStatus: 200,
        phones: [],
        phoneNumber: null,
        phoneType: 'unknown' as const,
        phoneRawType: null,
        creditsCharged: 0,
        candidateStatus: 'no_phone_found' as const,
        usageStatus: 'success' as const,
        costSource: 'reported' as const,
        availabilitySource: null,
        errorCode: null,
        phonesReturned: 0,
      };
    },
  },
});

/**
 * AGENT2A-PHONE-REVEAL-4O-D — la pata Lusha persiste ahora su colección con una RPC
 * transaccional. Este archivo no es el que prueba esa transacción (lo hace el arnés
 * de PostgreSQL real): aquí se sustituye por un doble que devuelve el sobre de éxito,
 * para que lo que se siga midiendo sea la REAUTORIZACIÓN y no la infraestructura.
 */
mock.module('@/modules/contact-enrichment/candidate-lusha-phone-collection-persistence', {
  namedExports: {
    PERSIST_CANDIDATE_LUSHA_PHONE_REVEAL_RESULT_FN:
      'persist_candidate_lusha_phone_reveal_result',
    persistCandidateLushaPhoneCollection: async (request: {
      terminal: { legacyPhone: string; attemptCount: number };
    }) => {
      // La transacción real escribe TAMBIÉN el candidato: escalar y estado terminal
      // viajan dentro de ella desde 4O-D. El doble lo reproduce sobre el almacén
      // falso, porque si no este archivo dejaría de ver un efecto que en Producción
      // sí ocurre — y la reautorización, que es lo que aquí se mide, depende de él.
      candidateRow.phone = request.terminal.legacyPhone;
      candidateRow.phone_reveal_status = 'revealed';
      candidateRow.phone_reveal_provider = 'lusha';
      candidateRow.phone_reveal_request_id = null;
      candidateRow.phone_reveal_attempt_count = request.terminal.attemptCount;
      return {
      status: 'persisted' as const,
      inserted_phone_count: 1,
      updated_phone_count: 0,
      inserted_source_count: 1,
      suppressed_skipped_count: 0,
      primary_dedupe_key: 'e164:doble',
      primary_persisted: true,
      candidate_scalar_updated: true,
      candidate_terminalized: true,
      };
    },
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: { getLushaApiKey: async () => 'test-key-never-used' },
});

mock.module('@/modules/usage-tracking/logging', {
  namedExports: {
    logProviderUsage: async (entry: {
      provider_key: string;
      credits_used?: number;
      metadata?: Record<string, unknown>;
    }) => {
      spies.usageLogs.push({
        provider: entry.provider_key,
        waterfallId: entry.metadata?.phone_reveal_waterfall_id,
        credits: entry.credits_used,
      });
      return true;
    },
  },
});

// ── Módulos bajo prueba ──────────────────────────────────────────

type WaterfallDeps = typeof import('../phone-reveal-waterfall-deps');
type WaterfallCore = typeof import('../phone-reveal-waterfall-core');

let deps: WaterfallDeps;
let core: WaterfallCore;

before(async () => {
  deps = await import('../phone-reveal-waterfall-deps');
  core = await import('../phone-reveal-waterfall-core');
});

const ADMIN = { internalUserId: 'user-admin', roleKey: 'admin' };
const LEGACY_MAX_CREDITS = 5;

beforeEach(() => {
  resetAll();
  process.env.ENABLE_PHONE_REVEAL_WATERFALL = 'true';
  process.env.ENABLE_LUSHA_PHONE_REVEAL_FALLBACK = 'true';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
});

// ── Helpers ──────────────────────────────────────────────────────

function authorize() {
  return deps.startLegacyPhoneRevealWaterfallForCandidate(CANDIDATE_ID, ADMIN);
}

/** Espera >1 ms para que dos `authorized_at` del reloj real sean estrictamente distintos. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3));
}

function runsForCandidate(): Row[] {
  return store.runs.filter((r) => r.candidate_id === CANDIDATE_ID);
}

/** Fila cruda pre-sembrada, como la dejaría una corrida ya cerrada. */
function seedRun(overrides: Row = {}): Row {
  store.seq += 1;
  const row: Row = {
    id: `seed-${store.seq}`,
    candidate_id: CANDIDATE_ID,
    status: 'exhausted',
    run_mode: 'legacy_lusha_only',
    authorized_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-08-01T10:00:00.000Z',
    authorized_by: 'user-admin',
    authorized_by_role: 'admin',
    max_credits_authorized: LEGACY_MAX_CREDITS,
    apollo_attempted_at: null,
    apollo_outcome: 'no_phone_found',
    apollo_cost_credits: null,
    apollo_cost_source: 'unknown',
    lusha_eligible: true,
    lusha_skipped_reason: null,
    lusha_attempted_at: '2026-08-01T10:00:05.000Z',
    lusha_outcome: 'no_phone_found',
    lusha_cost_credits: 0,
    lusha_cost_source: 'reported',
    final_provider: 'none',
    completed_at: '2026-08-01T10:00:06.000Z',
    error_code: null,
    ...overrides,
  };
  store.runs.push(row);
  return row;
}

function assertZeroApollo(): void {
  assert.equal(spies.apolloCalls, 0, 'Apollo NUNCA se llama en la ruta legacy');
  assert.deepEqual(
    spies.usageLogs.filter((l) => l.provider === 'apollo'),
    [],
    'ningún usage log de Apollo',
  );
  assert.deepEqual(providerHttpRequests(), [], 'ninguna petición HTTP a proveedores');
}

// ═══════════════════════════════════════════════════════════════
// Matriz del historial (función pura, las 8 clases del contrato)
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C — matriz de corridas históricas (pura)', () => {
  const legacy = (overrides: Partial<Parameters<
    WaterfallCore['classifyPhoneRevealWaterfallLegacyHistory']
  >[0] & object> = {}) => ({
    status: 'exhausted' as const,
    runMode: 'legacy_lusha_only' as const,
    lushaOutcome: 'no_phone_found' as const,
    finalProvider: 'none' as const,
    ...overrides,
  });

  it('sin corrida ⇒ primera autorización', () => {
    assert.deepEqual(core.classifyPhoneRevealWaterfallLegacyHistory(null), {
      reauthorizable: true,
      basis: 'no_previous_run',
    });
  });

  it('corrida ACTIVA (los 4 estados no terminales) ⇒ active_run_exists', () => {
    for (const status of ACTIVE_STATUSES) {
      const verdict = core.classifyPhoneRevealWaterfallLegacyHistory(
        legacy({ status: status as never, lushaOutcome: null, finalProvider: null }),
      );
      assert.deepEqual(verdict, { reauthorizable: false, reason: 'active_run_exists' }, status);
    }
  });

  it('terminal legacy `no_phone_found` ⇒ REAUTORIZABLE', () => {
    assert.deepEqual(core.classifyPhoneRevealWaterfallLegacyHistory(legacy()), {
      reauthorizable: true,
      basis: 'terminal_legacy_run',
    });
  });

  it('terminal legacy con ERROR de Lusha ⇒ REAUTORIZABLE', () => {
    assert.deepEqual(
      core.classifyPhoneRevealWaterfallLegacyHistory(
        legacy({ status: 'error', lushaOutcome: 'error' }),
      ),
      { reauthorizable: true, basis: 'terminal_legacy_run' },
    );
  });

  it('terminal legacy `suppressed` ⇒ REAUTORIZABLE (la comprobación NUEVA decidirá)', () => {
    assert.deepEqual(
      core.classifyPhoneRevealWaterfallLegacyHistory(
        legacy({ status: 'aborted', lushaOutcome: null }),
      ),
      { reauthorizable: true, basis: 'terminal_legacy_run' },
    );
  });

  it('terminal legacy `suppression_check_unavailable` ⇒ REAUTORIZABLE', () => {
    assert.deepEqual(
      core.classifyPhoneRevealWaterfallLegacyHistory(
        legacy({ status: 'error', lushaOutcome: null }),
      ),
      { reauthorizable: true, basis: 'terminal_legacy_run' },
    );
  });

  it('terminal legacy con autorización VENCIDA ⇒ REAUTORIZABLE', () => {
    assert.deepEqual(
      core.classifyPhoneRevealWaterfallLegacyHistory(
        legacy({ status: 'aborted', lushaOutcome: null, finalProvider: 'none' }),
      ),
      { reauthorizable: true, basis: 'terminal_legacy_run' },
    );
  });

  it('terminal FULL_WATERFALL ⇒ incompatible_historical_run', () => {
    for (const status of ['completed_apollo', 'completed_lusha', 'exhausted', 'error', 'aborted']) {
      const verdict = core.classifyPhoneRevealWaterfallLegacyHistory(
        legacy({ status: status as never, runMode: 'full_waterfall' }),
      );
      assert.deepEqual(
        verdict,
        { reauthorizable: false, reason: 'incompatible_historical_run' },
        status,
      );
    }
  });

  it('terminal legacy que YA reveló ⇒ previous_run_revealed_phone (3 señales, basta una)', () => {
    const revealing = [
      legacy({ lushaOutcome: 'revealed' }),
      legacy({ finalProvider: 'lusha' }),
      legacy({ finalProvider: 'apollo' }),
      legacy({ status: 'completed_lusha', lushaOutcome: null }),
      legacy({ status: 'completed_apollo', lushaOutcome: null }),
    ];
    for (const run of revealing) {
      assert.deepEqual(
        core.classifyPhoneRevealWaterfallLegacyHistory(run),
        { reauthorizable: false, reason: 'previous_run_revealed_phone' },
        JSON.stringify(run),
      );
    }
  });

  it('la vista de auditoría de la UI satisface la MISMA proyección que la fila', () => {
    // Si alguien cambiara la forma de la vista, este test deja de compilar/pasar y la
    // UI no puede quedar clasificando con una regla distinta a la del servidor.
    const view = core.buildPhoneRevealWaterfallAuditView({
      id: 'run-x',
      candidateId: CANDIDATE_ID,
      status: 'exhausted',
      runMode: 'legacy_lusha_only',
      authorizedAt: '2026-08-01T10:00:00.000Z',
      authorizedBy: 'user-admin',
      authorizedByRole: 'admin',
      maxCreditsAuthorized: LEGACY_MAX_CREDITS,
      apolloAttemptedAt: null,
      apolloOutcome: 'no_phone_found',
      apolloCostCredits: null,
      apolloCostSource: 'unknown',
      lushaEligible: true,
      lushaSkippedReason: null,
      lushaAttemptedAt: '2026-08-01T10:00:05.000Z',
      lushaOutcome: 'no_phone_found',
      lushaCostCredits: 0,
      lushaCostSource: 'reported',
      finalProvider: 'none',
      completedAt: '2026-08-01T10:00:06.000Z',
      errorCode: null,
      creditReservationGroupId: 'group-legacy-prev',
    });
    assert.deepEqual(core.classifyPhoneRevealWaterfallLegacyHistory(view), {
      reauthorizable: true,
      basis: 'terminal_legacy_run',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// A. Reautorización después de `no_phone_found`
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · A — reautorización tras no_phone_found', () => {
  it('crea una corrida NUEVA: id nuevo, authorized_at nuevo, tope 5, 0 Apollo, 1 Lusha', async () => {
    // 1ª autorización: corre Lusha una vez y cierra sin teléfono.
    const first = await authorize();
    assert.equal(first.outcome, 'lusha_no_phone_found');
    assert.equal(first.maxCreditsAuthorized, LEGACY_MAX_CREDITS);
    assert.equal(spies.lushaCalls, 1);

    const previous = runsForCandidate()[0];
    const previousId = String(previous.id);
    const previousSnapshot = JSON.stringify(previous);
    const previousUpdates = store.updatesById.get(previousId) ?? 0;
    assert.ok(
      core.PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(
        previous.status as never,
      ),
      'la 1ª corrida quedó terminal',
    );
    // El candidato sigue sin teléfono: en modo waterfall un `no_phone_found` de Lusha
    // NO pisa el candidato, así que sigue siendo elegible para la ruta legacy.
    assert.equal(candidateRow.phone, null);

    await tick();

    // 2ª autorización EXPLÍCITA: una llamada nueva a la acción, no un reintento.
    const second = await authorize();
    assert.equal(second.outcome, 'lusha_no_phone_found');
    assert.equal(second.maxCreditsAuthorized, LEGACY_MAX_CREDITS);

    const runs = runsForCandidate();
    assert.equal(runs.length, 2, 'exactamente UNA corrida nueva');
    const created = runs[1];

    // id nuevo, authorized_at nuevo y estrictamente posterior, nada copiado.
    assert.notEqual(String(created.id), previousId);
    assert.notEqual(created.authorized_at, previous.authorized_at);
    assert.ok(
      String(created.authorized_at) > String(previousSnapshot && previous.authorized_at),
      'authorized_at nuevo > anterior',
    );
    assert.notEqual(created.lusha_attempted_at, previous.lusha_attempted_at);
    assert.equal(created.max_credits_authorized, LEGACY_MAX_CREDITS);
    assert.equal(created.run_mode, 'legacy_lusha_only');

    // Apollo intacto en la fila nueva: ni timestamp, ni costo, ni request id.
    assert.equal(created.apollo_attempted_at, null);
    assert.equal(created.apollo_outcome, 'no_phone_found');
    assert.equal(created.apollo_cost_credits ?? null, null);
    assert.equal(created.apollo_cost_source, 'unknown');

    // Lusha: exactamente una llamada por autorización, dos en total.
    assert.equal(spies.lushaCalls, 2);
    assertZeroApollo();

    // La corrida ANTERIOR no se tocó.
    assert.equal(JSON.stringify(previous), previousSnapshot, 'corrida anterior inmutable');
    assert.equal(store.updatesById.get(previousId) ?? 0, previousUpdates);
  });

  it('cada usage log de Lusha se correlaciona con SU corrida, y los costos no se suman', async () => {
    await authorize();
    await tick();
    await authorize();

    const runs = runsForCandidate();
    const lushaLogs = spies.usageLogs.filter((l) => l.provider === 'lusha');
    assert.equal(lushaLogs.length, 2);
    assert.deepEqual(
      lushaLogs.map((l) => l.waterfallId),
      runs.map((r) => r.id),
      'cada log apunta a la corrida que lo autorizó',
    );
    // Cada corrida guarda SU propio costo en SU columna: no hay acumulado.
    for (const run of runs) {
      assert.equal(run.lusha_cost_credits, 0);
      assert.equal(run.lusha_cost_source, 'reported');
      assert.equal(run.apollo_cost_credits ?? null, null);
    }
  });

  it('la reautorización revalida el rol: un rol no admin no crea corrida ni llama a Lusha', async () => {
    seedRun();
    const result = await deps.startLegacyPhoneRevealWaterfallForCandidate(CANDIDATE_ID, {
      internalUserId: 'user-cm',
      roleKey: 'commercial_manager',
    });
    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'role_not_allowed');
    assert.equal(runsForCandidate().length, 1);
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });

  it('la reautorización revalida el flag: con el waterfall apagado no hay corrida nueva', async () => {
    seedRun();
    delete process.env.ENABLE_PHONE_REVEAL_WATERFALL;
    const result = await authorize();
    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'feature_disabled');
    assert.equal(runsForCandidate().length, 1);
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Reautorización después de un error de Lusha
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · B — reautorización tras error de Lusha', () => {
  it('un error HTTP de Lusha deja la corrida terminal y admite autorización nueva', async () => {
    lushaScenario = 'http_error';
    const first = await authorize();
    assert.equal(first.outcome, 'lusha_error');
    assert.equal(spies.lushaCalls, 1);

    const previous = runsForCandidate()[0];
    const previousSnapshot = JSON.stringify(previous);
    assert.equal(previous.status, 'error');
    assert.equal(previous.lusha_outcome, 'error');
    // Un error no reporta costo real: null + unknown, nunca 0.
    assert.equal(previous.lusha_cost_credits, null);
    assert.equal(previous.lusha_cost_source, 'unknown');

    await tick();

    lushaScenario = 'no_phone_found';
    const second = await authorize();
    assert.equal(second.outcome, 'lusha_no_phone_found');
    assert.equal(runsForCandidate().length, 2);
    assert.ok(spies.lushaCalls <= 2, 'como máximo una llamada por autorización');
    assert.equal(spies.lushaCalls, 2);
    assertZeroApollo();
    assert.equal(JSON.stringify(previous), previousSnapshot, 'corrida anterior inmutable');
  });

  it('un fallo de red de Lusha también deja la corrida reautorizable', async () => {
    lushaScenario = 'network_error';
    const first = await authorize();
    assert.equal(first.outcome, 'lusha_error');

    await tick();
    lushaScenario = 'no_phone_found';
    const second = await authorize();
    assert.equal(second.outcome, 'lusha_no_phone_found');
    assert.equal(runsForCandidate().length, 2);
    assert.equal(spies.lushaCalls, 2);
    assertZeroApollo();
  });

  it('sin una autorización NUEVA no ocurre nada: una corrida terminal no se retoma sola', async () => {
    // La corrida anterior es terminal, así que ningún disparador posterior (webhook,
    // cron L2, revisión L3) puede gastar su pata: `findActiveRun` no la devuelve.
    seedRun({ status: 'error', lusha_outcome: 'error', lusha_attempted_at: null });
    const continued = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'no_phone_found',
    });
    assert.equal(continued.outcome, 'noop');
    assert.equal(continued.reason, 'no_active_run');
    assert.equal(continued.lushaCalled, false);
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Corrida activa
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · C — corrida activa', () => {
  it('rechaza con active_run_exists: 0 corridas nuevas, 0 Apollo, 0 Lusha', async () => {
    const active = seedRun({
      status: 'lusha_pending',
      lusha_attempted_at: null,
      lusha_outcome: null,
      lusha_cost_credits: null,
      lusha_cost_source: null,
      completed_at: null,
    });
    const snapshot = JSON.stringify(active);

    const result = await authorize();
    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'active_run_exists');
    assert.equal(result.maxCreditsAuthorized, null);
    assert.equal(runsForCandidate().length, 1, 'ninguna corrida nueva');
    assert.equal(spies.insertAttempts, 0, 'ni se intenta el INSERT');
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
    assert.equal(JSON.stringify(active), snapshot, 'la corrida activa no se toca');
  });

  it('los 4 estados no terminales bloquean igual', async () => {
    for (const status of ACTIVE_STATUSES) {
      resetAll();
      seedRun({ status, lusha_attempted_at: null, completed_at: null });
      const result = await authorize();
      assert.equal(result.reason, 'active_run_exists', status);
      assert.equal(runsForCandidate().length, 1, status);
      assert.equal(spies.lushaCalls, 0, status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// D. Corrida full_waterfall histórica
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · D — corrida full_waterfall histórica', () => {
  it('rechaza con incompatible_historical_run: 0 corridas legacy, 0 Apollo, 0 Lusha', async () => {
    seedRun({
      run_mode: 'full_waterfall',
      status: 'exhausted',
      apollo_attempted_at: '2026-08-01T10:00:01.000Z',
      apollo_cost_credits: 8,
      apollo_cost_source: 'reported',
      max_credits_authorized: 13,
    });

    const result = await authorize();
    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'incompatible_historical_run');
    assert.equal(runsForCandidate().length, 1);
    assert.equal(spies.insertAttempts, 0);
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });

  it('una fila con run_mode ilegible se lee como full_waterfall y también bloquea', async () => {
    // Fail-closed del parser: una fila que no se puede leer NUNCA excusa a Apollo.
    seedRun({ run_mode: 'modalidad-inventada' });
    const result = await authorize();
    assert.equal(result.reason, 'incompatible_historical_run');
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });

  it('un entorno SIN la migración 103 (columna ausente) también bloquea', async () => {
    seedRun({ run_mode: undefined });
    const result = await authorize();
    assert.equal(result.reason, 'incompatible_historical_run');
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });
});

// ═══════════════════════════════════════════════════════════════
// E. El teléfono apareció
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · E — el teléfono apareció', () => {
  it('candidato con teléfono ⇒ 0 corridas nuevas y 0 llamadas a proveedores', async () => {
    seedRun();
    candidateRow.phone = '+57 300 111 2222';
    const result = await authorize();
    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'existing_phone_present');
    assert.equal(runsForCandidate().length, 1);
    assert.equal(spies.insertAttempts, 0);
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });

  it('la corrida anterior que YA reveló bloquea aunque el candidato se leyera sin teléfono', async () => {
    seedRun({
      status: 'completed_lusha',
      lusha_outcome: 'revealed',
      lusha_cost_credits: 1,
      final_provider: 'lusha',
    });
    const result = await authorize();
    assert.equal(result.reason, 'previous_run_revealed_phone');
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });

  it('tras una reautorización que SÍ revela, no se ofrece una tercera', async () => {
    lushaScenario = 'revealed';
    const first = await authorize();
    assert.equal(first.outcome, 'lusha_revealed');
    assert.equal(spies.lushaCalls, 1);
    // El camino `revealed` SÍ persiste el candidato: ya tiene teléfono.
    assert.equal(candidateRow.phone, '+57 300 000 0000');

    await tick();
    const second = await authorize();
    assert.equal(second.outcome, 'not_started');
    // El gate corta en la PRIMERA condición que falla: el camino `revealed` persistió
    // `phone_reveal_status = 'revealed'` en el candidato, así que la terna de evidencia
    // legacy ya no se cumple y se rechaza antes incluso de mirar el teléfono. Las dos
    // razones son bloqueos correctos; lo que importa es que no hay corrida ni llamada.
    assert.equal(second.reason, 'apollo_not_exhausted');
    assert.equal(candidateRow.phone_reveal_status, 'revealed');
    assert.equal(runsForCandidate().length, 1);
    assert.equal(spies.lushaCalls, 1, 'Lusha NO se vuelve a llamar');
    assertZeroApollo();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Inmutabilidad de la corrida anterior
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · F — la corrida anterior es inmutable', () => {
  it('tras la 2ª autorización el primer id, estado, desenlaces, costos y timestamps siguen intactos', async () => {
    await authorize();
    const previous = runsForCandidate()[0];
    const before = { ...previous };
    const previousId = String(previous.id);
    store.updatesById.set(previousId, 0);

    await tick();
    await authorize();

    const after = runsForCandidate()[0];
    assert.equal(String(after.id), previousId, 'el primer id permanece');
    assert.equal(after.status, before.status, 'su estado permanece terminal');
    assert.equal(after.apollo_outcome, before.apollo_outcome);
    assert.equal(after.lusha_outcome, before.lusha_outcome);
    assert.equal(after.apollo_cost_credits ?? null, before.apollo_cost_credits ?? null);
    assert.equal(after.lusha_cost_credits, before.lusha_cost_credits);
    assert.equal(after.lusha_cost_source, before.lusha_cost_source);
    assert.equal(after.authorized_at, before.authorized_at);
    assert.equal(after.lusha_attempted_at, before.lusha_attempted_at);
    assert.equal(after.completed_at, before.completed_at);
    assert.equal(store.updatesById.get(previousId) ?? 0, 0, '0 UPDATEs sobre la anterior');
  });

  it('el usage log de la corrida anterior no cambia al reautorizar', async () => {
    await authorize();
    const firstLogs = JSON.stringify(spies.usageLogs);
    await tick();
    await authorize();
    const allLogs = JSON.stringify(spies.usageLogs);
    assert.ok(allLogs.startsWith(firstLogs.slice(0, firstLogs.length - 1)));
    assert.equal(spies.usageLogs.length, 2, 'un log por autorización, ninguno reescrito');
  });

  it('la reautorización NO recicla el claim anterior: la corrida nueva nace sin claim', async () => {
    await authorize();
    await tick();
    await authorize();
    const runs = runsForCandidate();
    // Cada corrida tiene su propio `lusha_attempted_at`, sellado por su propio claim.
    assert.ok(runs[0].lusha_attempted_at, 'la 1ª reclamó');
    assert.ok(runs[1].lusha_attempted_at, 'la 2ª reclamó por su cuenta');
    assert.notEqual(runs[0].lusha_attempted_at, runs[1].lusha_attempted_at);
  });
});

// ═══════════════════════════════════════════════════════════════
// Supresión / DNC: el veredicto anterior NO es permiso
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C — supresión/DNC se recomprueba en CADA autorización', () => {
  it('una autorización nueva sobre una corrida legacy `suppressed` se bloquea si HOY sigue bloqueado', async () => {
    seedRun({ status: 'aborted', lusha_skipped_reason: 'suppressed', error_code: 'blocked_suppressed' });
    dncContacts = [
      {
        id: 'contact-dnc',
        account_id: 'acct-legacy',
        email: 'legacy@ejemplo.test',
        linkedin_url: null,
        contact_status: 'do_not_contact',
      },
    ];

    const result = await authorize();
    // La corrida NUEVA sí se crea (la autorización es legítima) pero se cierra sin
    // llamar a Lusha: el permiso lo da la comprobación de AHORA, no la de antes.
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(result.reason, 'do_not_contact');
    assert.equal(spies.lushaCalls, 0, 'Lusha NO se llama');
    assert.equal(runsForCandidate().length, 2);
    const created = runsForCandidate()[1];
    assert.equal(created.status, 'aborted');
    assert.equal(created.lusha_skipped_reason, 'dnc');
    assert.equal(created.lusha_cost_credits ?? null, null);
    assertZeroApollo();
  });

  it('si la restricción ya NO existe, la autorización nueva avanza (una sola llamada)', async () => {
    seedRun({ status: 'aborted', lusha_skipped_reason: 'suppressed', error_code: 'blocked_suppressed' });
    dncContacts = [];
    const result = await authorize();
    assert.equal(result.outcome, 'lusha_no_phone_found');
    assert.equal(spies.lushaCalls, 1);
    assertZeroApollo();
  });

  it('comprobación NO verificable ⇒ fail-closed y se registra como no verificada, no como suprimida', async () => {
    seedRun({ status: 'error', lusha_skipped_reason: 'suppression_check_unavailable' });
    store.contactsSelectError = { code: '57014', message: 'statement timeout' };

    const result = await authorize();
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(result.reason, 'suppression_check_unavailable');
    assert.equal(spies.lushaCalls, 0);
    const created = runsForCandidate()[1];
    assert.equal(created.lusha_skipped_reason, 'suppression_check_unavailable');
    assert.notEqual(created.lusha_skipped_reason, 'suppressed');
    assert.equal(created.lusha_cost_credits ?? null, null);
    assert.equal(created.lusha_cost_source, 'unknown');
    assertZeroApollo();
  });
});

// ═══════════════════════════════════════════════════════════════
// H. Índice único parcial
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C · H — índice único parcial', () => {
  it('DOS corridas activas para el mismo candidato son imposibles (23505 ⇒ create_conflict, 0 Lusha)', async () => {
    // El gate de servidor ya rechazaría por `active_run_exists`; aquí se prueba la
    // garantía ESTRUCTURAL: incluso si dos autorizaciones ganaran la carrera de
    // lectura, el INSERT de la segunda lo rechaza el índice y NO se llama a Lusha.
    seedRun({ status: 'lusha_pending', lusha_attempted_at: null, completed_at: null });
    const conflicted = await core.startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID },
      {
        ...deps.buildStartLegacyWaterfallDeps(ADMIN),
        // Se simula la carrera: las dos lecturas ven "sin corrida" y las dos intentan
        // el INSERT. Solo el índice puede desempatar.
        findActiveRun: async () => null,
        findLatestRun: async () => null,
      },
    );
    assert.equal(conflicted.started, false);
    assert.equal(conflicted.started === false && conflicted.reason, 'create_conflict');
    assert.equal(spies.insertAttempts, 1);
    assert.equal(runsForCandidate().length, 1, 'no quedó una segunda corrida activa');
    assert.equal(spies.lushaCalls, 0);
    assertZeroApollo();
  });

  it('con la anterior TERMINAL el INSERT sí procede (el índice solo cubre estados activos)', async () => {
    seedRun({ status: 'exhausted' });
    const result = await authorize();
    assert.equal(result.outcome, 'lusha_no_phone_found');
    assert.equal(runsForCandidate().length, 2);
    assert.equal(spies.lushaCalls, 1);
    assertZeroApollo();
  });

  it('el predicado del índice (migración 102) es EXACTAMENTE la lista de estados activos del core', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/102_phone_reveal_waterfall_runs.sql'),
      'utf8',
    );
    const match = sql.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_waterfall_runs_active_candidate[\s\S]*?WHERE status IN \(([^)]*)\)/,
    );
    assert.ok(match, 'el índice único parcial debe existir en la migración 102');
    const sqlStatuses = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort();
    assert.deepEqual(
      sqlStatuses,
      [...core.PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES].sort(),
      'el índice y el core deben describir los mismos estados activos',
    );
    // Y el doble de este archivo usa la misma lista, así que la simulación de arriba
    // no puede divergir del índice real sin que este test falle.
    assert.deepEqual([...ACTIVE_STATUSES].sort(), sqlStatuses);
    assert.deepEqual(
      [...CLAIMABLE_STATUSES].sort(),
      [...core.PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Una sola llamada a Lusha por autorización, con concurrencia
// ═══════════════════════════════════════════════════════════════

describe('WATERFALL-2C — una autorización, una llamada', () => {
  it('dos autorizaciones SIMULTÁNEAS producen una sola corrida y una sola llamada', async () => {
    const [a, b] = await Promise.all([authorize(), authorize()]);
    const outcomes = [a.outcome, b.outcome];
    assert.equal(
      outcomes.filter((o) => o === 'lusha_no_phone_found').length,
      1,
      'solo una autorización llega a Lusha',
    );
    assert.equal(runsForCandidate().length, 1, 'una sola corrida');
    assert.equal(spies.lushaCalls, 1, 'una sola llamada a Lusha');
    assertZeroApollo();
  });
});
