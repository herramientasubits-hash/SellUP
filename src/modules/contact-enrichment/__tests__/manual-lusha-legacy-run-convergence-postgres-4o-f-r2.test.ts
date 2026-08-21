/**
 * Agente 2A — La convergencia del disparo MANUAL de Lusha sobre la infraestructura
 * `legacy_lusha_only`, contra un PostgreSQL de VERDAD
 * (AGENT2A-PHONE-REVEAL-4O-F-R2 · § 48) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * `manual-lusha-legacy-run-convergence-4o-f-r2.test.ts` fija el CONTRATO de R2 con un
 * ledger simulado: qué gates corren, en qué orden y con qué desenlace. Ese arnés
 * REPRODUCE los invariantes del SQL (unicidad de pata activa, unicidad de corrida
 * activa), pero reproducir un invariante no es demostrarlo: un doble en memoria no
 * tiene transacciones, ni bloqueos de aviso, ni índices únicos parciales, así que
 * «single-flight» y «reserva atómica» ahí son afirmaciones PROGRAMADAS.
 *
 * Es exactamente la distinción que bloqueó el merge de 4O-C y que 4O-C-R1 cerró, y la
 * razón por la que 4O-F trajo su propia suite de PostgreSQL. Pero aquella suite valida
 * el PAYLOAD del camino manual contra la transacción de la migración 111 — el camino
 * ANTERIOR a R2, con corrida y reserva nulas. R2 cambió el LLAMADOR: el disparo manual
 * ya no llama a Lusha por su cuenta, sino a través de `reserve_and_create_phone_reveal_run`
 * (migración 104), y eso es una integración NUEVA que ninguna suite existente ejecuta.
 *
 * Lo que se demuestra aquí, y sólo se puede demostrar contra una base real:
 *
 *   * la RPC 104 crea para el disparo manual una corrida `legacy_lusha_only` con UNA
 *     sola pata reservada (Lusha), y ese `run_id` existe en la tabla;
 *   * con disponibilidad 0 el proveedor no se llama NI UNA vez, y no queda escrita ni
 *     una corrida ni una reserva;
 *   * tres invocaciones REALMENTE concurrentes (tres conexiones distintas del pool)
 *     sobre el MISMO candidato con presupuesto abundante producen UNA sola llamada
 *     pagada — y se reporta QUÉ mecanismo de PostgreSQL lo impidió, en vez de
 *     atribuirle al guard de JavaScript una garantía que da la base;
 *   * el usage-log y la reserva confirmada comparten identidad de corrida, así que la
 *     lógica REAL de consumo efectivo (`computeEffectiveConsumption`, alimentada con
 *     filas leídas del PostgreSQL efímero) devuelve 5 y no 10.
 *
 * ═══════════════════════════════════════════════════════════════════
 * CÓMO CORRE EL CÓDIGO REAL
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las tres fábricas de cliente de servicio del repo —`@/lib/supabase/admin`,
 * `@/modules/budgets/queries` y `@/modules/usage-tracking/logging`— terminan todas en
 * `createClient` de `@supabase/supabase-js`. Ese es el ÚNICO punto que se sustituye:
 * por un cliente con la forma de PostgREST que traduce cada consulta a SQL real sobre
 * la base efímera. Todo lo demás —el motor, el core del waterfall, el core del
 * fallback, la puerta de privacidad, el preflight de presupuesto, la reserva atómica,
 * el claim, la persistencia multi-teléfono y la liquidación— es el código de
 * Producción, sin sustituir.
 *
 * Sólo se simulan además: los dos flags (valores, no lógica), la clave de Lusha y el
 * CLIENTE HTTP de Lusha, que es el proveedor y cuyas invocaciones se CUENTAN: esa
 * cifra es la que mide el gasto.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`;
 *   * las migraciones 102, 103, 104, 109, 110, 111, 112 y 113 TAL CUAL están en disco.
 *
 * NO llama a Lusha, ni a Apollo, ni a HubSpot; no toca Producción ni ninguna base
 * remota; no gasta un crédito. Todos los números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito. Si el
 * módulo no está resuelto, el archivo se SALTA con un motivo explícito.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:manual-lusha-legacy-convergence-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones son prerelease.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

import { normalizeCandidatePhone } from '../phone-collection-core';
import {
  extractAllLushaPhones,
  selectPrimaryLushaPhone,
} from '@/server/integrations/lusha-phone-fallback-phones';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;
let httpRequests: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : String((input as { url?: string })?.url ?? '');
  httpRequests.push(url);
  throw new Error(`red bloqueada en test: ${url}`);
}) as typeof globalThis.fetch;

// ═══════════════════════════════════════════════════════════════
// Resolución del arnés opcional
// ═══════════════════════════════════════════════════════════════

interface PgPoolLike {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
}

type PgLikeClient = {
  connect: () => Promise<void>;
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type EmbeddedPostgresLike = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: () => PgLikeClient;
};

let EmbeddedPostgresCtor:
  | (new (options: Record<string, unknown>) => EmbeddedPostgresLike)
  | null = null;
interface PgModuleLike {
  Pool: new (options: Record<string, unknown>) => PgPoolLike;
  types: { setTypeParser: (oid: number, fn: (v: string) => unknown) => void };
}

let PgModule: PgModuleLike | null = null;
let harnessSkipReason: string | false = false;

try {
  const require = createRequire(import.meta.url);
  const mod = require('embedded-postgres') as {
    default?: new (options: Record<string, unknown>) => EmbeddedPostgresLike;
  };
  const ctor =
    mod.default ??
    (mod as unknown as new (o: Record<string, unknown>) => EmbeddedPostgresLike);
  if (typeof ctor !== 'function') {
    harnessSkipReason = 'embedded-postgres resolvió sin constructor utilizable';
  } else {
    EmbeddedPostgresCtor = ctor;
    // El pool propio es lo que da CONCURRENCIA REAL: `getPgClient()` entrega una
    // conexión, y tres promesas sobre una sola conexión se serializan en el protocolo.
    // Sin pool, el test de single-flight mediría una secuencia y pasaría por el motivo
    // equivocado.
    PgModule = require('pg') as PgModuleLike;
  }
} catch {
  harnessSkipReason =
    'embedded-postgres/pg no están instalados (arnés opcional a propósito: `npm install --no-save embedded-postgres@17.6.0-beta.15`)';
}

// PostgREST devuelve las marcas de tiempo como cadenas ISO; `pg` las devuelve como
// `Date`. El código bajo prueba lee esas columnas como cadenas, así que el arnés
// reproduce la forma de PostgREST en vez de introducir una diferencia que no existe en
// Producción.
if (PgModule) {
  const toIso = (value: string) => new Date(value).toISOString();
  PgModule.types.setTypeParser(1114, toIso); // timestamp
  PgModule.types.setTypeParser(1184, toIso); // timestamptz
}

// ═══════════════════════════════════════════════════════════════
// Cliente con forma de PostgREST sobre SQL real
// ═══════════════════════════════════════════════════════════════

let pool: PgPoolLike | null = null;

/** Tablas embebidas con `alias:tabla ( cols )`. Sólo hay una en este camino. */
const EMBEDDED_FOREIGN_KEY: Record<string, string> = {
  contact_enrichment_runs: 'enrichment_run_id',
};

interface QueryFilter {
  kind: 'eq' | 'in' | 'is' | 'gt' | 'gte' | 'lt' | 'lte';
  column: string;
  value: unknown;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Traduce la cadena `select` de PostgREST a una lista de columnas SQL. Un recurso
 * embebido (`run:contact_enrichment_runs ( account_id )`) se traduce a una subconsulta
 * correlacionada que devuelve `jsonb`, que es la forma en la que el mapeo del repo ya
 * lee esa clave (acepta objeto o array).
 */
function buildSelectList(table: string, select: string): string {
  const embedded: string[] = [];
  const flat = select
    .replace(
      /(\w+)\s*:\s*(\w+)\s*\(([^)]*)\)/g,
      (_match, alias: string, embeddedTable: string, columns: string) => {
        const fk = EMBEDDED_FOREIGN_KEY[embeddedTable];
        if (!fk) {
          throw new Error(`recurso embebido no soportado por el arnés: ${embeddedTable}`);
        }
        const cols = columns
          .split(',')
          .map((c) => quoteIdent(c.trim()))
          .join(', ');
        embedded.push(
          `(SELECT to_jsonb(e) FROM (SELECT ${cols} FROM public.${quoteIdent(
            embeddedTable,
          )} WHERE id = t.${quoteIdent(fk)}) e) AS ${quoteIdent(alias)}`,
        );
        return '';
      },
    )
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const flatSql =
    flat.length === 0
      ? embedded.length === 0
        ? 't.*'
        : ''
      : flat.includes('*')
        ? 't.*'
        : flat.map((c) => `t.${quoteIdent(c)}`).join(', ');

  void table;
  return [flatSql, ...embedded].filter((part) => part.length > 0).join(', ');
}

/**
 * Un valor compuesto viaja como jsonb; el resto deja que PostgreSQL infiera el tipo de la
 * columna destino. Los ARRAYS también se serializan: `p_legs` de la migración 104 es un
 * `jsonb` de tipo array, y dejar que el driver lo mandara como array de PostgreSQL hacía
 * que la RPC fallara con `invalid input syntax for type json` — un fallo de transporte
 * que el motor traduce, correctamente, en `run_creation_unavailable`.
 *
 * Los filtros `.in(...)` NO pasan por aquí: siguen siendo arrays de verdad para `= ANY`.
 */
function bindValue(value: unknown, index: number): { placeholder: string; value: unknown } {
  if (value !== null && typeof value === 'object') {
    return { placeholder: `$${index}::jsonb`, value: JSON.stringify(value) };
  }
  return { placeholder: `$${index}`, value };
}

class PostgrestLikeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private selectString = '*';
  private readonly filters: QueryFilter[] = [];
  private readonly orders: { column: string; ascending: boolean }[] = [];
  private limitRows: number | null = null;
  private rowMode: 'many' | 'maybeSingle' | 'single' = 'many';
  private mode: 'select' | 'update' | 'insert' = 'select';
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private returning: string | null = null;

  constructor(private readonly table: string) {}

  select(columns?: string): this {
    if (this.mode === 'select') this.selectString = columns ?? '*';
    else this.returning = columns ?? '*';
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.mode = 'update';
    this.payload = patch;
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = 'insert';
    this.payload = rows;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: 'in', column, value: values });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ kind: 'is', column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push({ kind: 'gt', column, value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push({ kind: 'gte', column, value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push({ kind: 'lt', column, value });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push({ kind: 'lte', column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number): this {
    this.limitRows = count;
    return this;
  }
  maybeSingle(): this {
    this.rowMode = 'maybeSingle';
    return this;
  }
  single(): this {
    this.rowMode = 'single';
    return this;
  }

  private whereClause(values: unknown[], alias = ''): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((filter) => {
      const column = `${alias}${quoteIdent(filter.column)}`;
      if (filter.kind === 'is') {
        if (filter.value === null) return `${column} IS NULL`;
        return `${column} IS ${filter.value === true ? 'TRUE' : 'FALSE'}`;
      }
      if (filter.kind === 'in') {
        values.push(filter.value);
        return `${column} = ANY($${values.length})`;
      }
      const operator =
        filter.kind === 'eq'
          ? '='
          : filter.kind === 'gt'
            ? '>'
            : filter.kind === 'gte'
              ? '>='
              : filter.kind === 'lt'
                ? '<'
                : '<=';
      values.push(filter.value);
      return `${column} ${operator} $${values.length}`;
    });
    return ` WHERE ${parts.join(' AND ')}`;
  }

  private async exec(): Promise<{ data: unknown; error: unknown }> {
    if (!pool) return { data: null, error: { message: 'pool no inicializado' } };
    const values: unknown[] = [];
    let sql: string;

    try {
      if (this.mode === 'select') {
        const selectList = buildSelectList(this.table, this.selectString);
        sql = `SELECT ${selectList} FROM public.${quoteIdent(this.table)} t`;
        // Los filtros del SELECT se cualifican con el alias `t`, porque el recurso
        // embebido introduce una subconsulta que también tiene una columna `id`.
        sql += this.whereClause(values, 't.');
        if (this.orders.length > 0) {
          sql += ` ORDER BY ${this.orders
            .map((o) => `t.${quoteIdent(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`)
            .join(', ')}`;
        }
        if (this.limitRows !== null) sql += ` LIMIT ${this.limitRows}`;
      } else if (this.mode === 'update') {
        const patch = this.payload as Record<string, unknown>;
        const assignments = Object.entries(patch).map(([column, value]) => {
          const bound = bindValue(value, values.length + 1);
          values.push(bound.value);
          return `${quoteIdent(column)} = ${bound.placeholder}`;
        });
        sql = `UPDATE public.${quoteIdent(this.table)} SET ${assignments.join(', ')}`;
        sql += this.whereClause(values);
        sql += ` RETURNING ${
          this.returning && this.returning !== '*'
            ? this.returning
                .split(',')
                .map((c) => quoteIdent(c.trim()))
                .join(', ')
            : '*'
        }`;
      } else {
        const rows = Array.isArray(this.payload)
          ? this.payload
          : [this.payload as Record<string, unknown>];
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        const tuples = rows.map(
          (row) =>
            `(${columns
              .map((column) => {
                const bound = bindValue(row[column] ?? null, values.length + 1);
                values.push(bound.value);
                return bound.placeholder;
              })
              .join(', ')})`,
        );
        sql =
          `INSERT INTO public.${quoteIdent(this.table)} ` +
          `(${columns.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')} RETURNING *`;
      }

      const result = await pool.query(sql, values);
      const rows = result.rows ?? [];
      if (this.rowMode === 'maybeSingle') {
        return { data: rows[0] ?? null, error: null };
      }
      if (this.rowMode === 'single') {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'no single row returned' } };
      }
      return { data: rows, error: null };
    } catch (err) {
      // El cliente de Supabase NO lanza: devuelve `{ error }`. Reproducirlo importa,
      // porque varios caminos del repo distinguen «error de lectura» de «excepción».
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : 'unknown pg error' },
      };
    }
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

/** Llama a una función SQL con parámetros NOMBRADOS, igual que PostgREST. */
async function rpcCall(fn: string, params: Record<string, unknown> | undefined) {
  if (!pool) return { data: null, error: { message: 'pool no inicializado' } };
  const entries = Object.entries(params ?? {});
  const values: unknown[] = [];
  const args = entries
    .map(([name, value]) => {
      const bound = bindValue(value, values.length + 1);
      values.push(bound.value);
      return `${name} => ${bound.placeholder}`;
    })
    .join(', ');
  try {
    const { rows } = await pool.query(
      `SELECT public.${fn}(${args}) AS result`,
      values,
    );
    return { data: rows[0]?.result ?? null, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : 'unknown pg error' },
    };
  }
}

function pgBackedAdminClient() {
  return {
    from: (table: string) => new PostgrestLikeQuery(table),
    rpc: (fn: string, params?: Record<string, unknown>) => rpcCall(fn, params),
  };
}

// ═══════════════════════════════════════════════════════════════
// Mocks: SÓLO el borde de I/O y el proveedor
// ═══════════════════════════════════════════════════════════════

// `@/modules/budgets/queries` exige credenciales ANTES de construir el cliente y lanza
// si faltan — un fallo que el preflight traduce, correctamente, en
// `credit_balance_unavailable`. Valores inertes: el cliente que se construye con ellos
// está sustituido por el traductor a SQL, así que nunca se abre una conexión remota.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:0/embedded-postgres-harness';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'embedded-postgres-harness';

mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: () => pgBackedAdminClient(),
  },
});

// `@supabase/supabase-js` es un paquete DUAL: los módulos del proyecto, cargados por
// tsx, resuelven su condición `require` (dist/index.cjs), y esa copia NO pasa por el
// registro de mocks del loader ESM. Sin este parche, `@/modules/budgets/queries` y
// `@/modules/usage-tracking/logging` construirían un cliente HTTP real —comprobado: el
// preflight caía en `credit_balance_unavailable` por una petición de red bloqueada— y el
// arnés mediría un fallo de transporte en vez del gate que cada test afirma.
{
  const requireCjs = createRequire(import.meta.url);
  try {
    const cjs = requireCjs('@supabase/supabase-js') as Record<string, unknown>;
    Object.defineProperty(cjs, 'createClient', {
      configurable: true,
      writable: true,
      value: () => pgBackedAdminClient(),
    });
  } catch {
    // Sin el paquete no hay nada que parchear: el arnés ya se salta por completo.
  }
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => pgBackedAdminClient(),
  },
});

/** Flag del waterfall APAGADO: es su estado en Producción. */
let waterfallFlag = false;
let manualFallbackFlag = true;

mock.module('@/lib/feature-flags.server', {
  namedExports: {
    isPhoneRevealWaterfallEnabled: () => waterfallFlag,
    isLushaPhoneRevealFallbackEnabled: () => manualFallbackFlag,
    resolveLushaSearchTimeoutMs: () => 10_000,
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: {
    getLushaApiKey: async () => 'test-key',
  },
});

// ── Proveedor simulado: sus invocaciones son la cifra que mide el gasto ──

interface ProviderPhone {
  number: string;
  rawType?: string | null;
  phoneType?: string;
}

interface ProviderScript {
  phones: ProviderPhone[];
  creditsCharged: number | null;
  fails: boolean;
  noPhone: boolean;
  /** Se ejecuta DESPUÉS de que el proveedor "cobre" y ANTES de que responda. */
  onCall?: (contactId: string) => Promise<void> | void;
}

let provider: ProviderScript;
let providerCalls: string[] = [];

mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    enrichLushaContactPhonesForFallback: async ({ contactId }: { contactId: string }) => {
      providerCalls.push(contactId);
      if (provider.onCall) await provider.onCall(contactId);
      if (provider.fails) return { ok: false, errorMessage: 'lusha upstream 500' };
      if (provider.noPhone) {
        return {
          ok: true,
          httpStatus: 200,
          phones: [],
          phoneNumber: null,
          phoneType: 'unknown',
          phoneRawType: null,
          creditsCharged: provider.creditsCharged,
          candidateStatus: 'no_phone_found',
          usageStatus: 'success',
          costSource: provider.creditsCharged === null ? null : 'reported',
          errorCode: null,
          availabilitySource: 'provider',
          phonesReturned: 0,
        };
      }
      // La clasificación y la elección de principal las hacen las funciones REALES del
      // cliente, no una copia aproximada del arnés: si el tipo se dedujera aquí a mano,
      // «el principal es el MÓVIL» pasaría a ser una afirmación del test.
      const phones = extractAllLushaPhones({
        results: [
          {
            phones: provider.phones.map((phone) => ({
              number: phone.number,
              type: phone.rawType ?? null,
            })),
          },
        ],
      });
      const primary = selectPrimaryLushaPhone(phones);
      return {
        ok: true,
        httpStatus: 200,
        phones,
        phoneNumber: primary?.number ?? null,
        phoneType: primary?.phoneType ?? 'unknown',
        phoneRawType: primary?.rawType ?? null,
        // Facturación por RESPUESTA. Nunca por número de teléfonos.
        creditsCharged: provider.creditsCharged,
        candidateStatus: 'revealed',
        usageStatus: 'success',
        costSource: provider.creditsCharged === null ? null : 'reported',
        errorCode: null,
        availabilitySource: 'provider',
        phonesReturned: phones.length,
      };
    },
  },
});

// ═══════════════════════════════════════════════════════════════
// Datos
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const ENRICHMENT_RUN_ID = '88888888-8888-4888-8888-888888888888';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';
const ROLE_ID = '55555555-5555-4555-8555-555555555555';
const CANDIDATE_A = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_B = '22222222-2222-4222-8222-222222222222';

const ADMIN = { internalUserId: ADMIN_ID, roleKey: 'admin' };

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const DIRECT = '+15550000003';

const LUSHA_LEG_CREDITS = 5;

const PHONES_TABLE = 'contact_enrichment_candidate_phones';
const SOURCES_TABLE = 'contact_enrichment_candidate_phone_sources';

/**
 * Clave de deduplicación REAL: SHA-256 de la forma canónica, no el número. Se calcula con
 * la misma función que usa el escritor, porque un tombstone sembrado con una clave
 * inventada no bloquearía nada y el test pasaría por el motivo equivocado.
 */
const keyOf = (number: string) =>
  normalizeCandidatePhone({
    displayPhone: number,
    sanitizedPhone: number,
    countryCode: null,
  }).dedupeKey;

// ═══════════════════════════════════════════════════════════════
// Import del motor DESPUÉS de los mocks
// ═══════════════════════════════════════════════════════════════

let executeLegacyLushaOnlyPhoneReveal: (typeof import('../legacy-lusha-only-reveal-engine'))['executeLegacyLushaOnlyPhoneReveal'];
let computeEffectiveConsumption: (typeof import('@/modules/budgets/effective-consumption-core'))['computeEffectiveConsumption'];

describe(
  'R2 § 48 — la convergencia del disparo manual contra PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let bootstrap: PgLikeClient;
    let dataDir = '';
    let pgVersion = '';

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

    function sliceMigration(file: string, from: string, to: string): string {
      const sql = readMigration(file);
      const start = sql.indexOf(from);
      const end = sql.indexOf(to);
      assert.notEqual(start, -1, `marcador inicial ausente en ${file}`);
      assert.notEqual(end, -1, `marcador final ausente en ${file}`);
      assert.ok(end > start, `marcadores invertidos en ${file}`);
      return sql.slice(start, end);
    }

    // ── Lecturas de comprobación (SQL directo, sin pasar por el traductor) ──

    const sql = async (text: string, values: unknown[] = []) => {
      const { rows } = await bootstrap.query(text, values);
      return rows;
    };

    const countRows = async (table: string, where = '', values: unknown[] = []) => {
      const rows = await sql(
        `SELECT COUNT(*)::int AS n FROM public.${table} ${where}`,
        values,
      );
      return rows[0].n as number;
    };

    const activeReservations = () =>
      countRows('phone_reveal_credit_reservations', `WHERE status = 'reserved'`);

    /**
     * Teléfonos VIVOS tal como los define la migración 109: un tombstone conserva la fila
     * y pierde el número, así que «vivo» es `suppressed_at IS NULL` con número presente.
     * `phone_status` es otra cosa (`valid`/`invalid`/`unknown`) y confundirlos haría que
     * un número resucitado contara como suprimido.
     */
    const livePhones = async (candidateId: string) =>
      sql(
        `SELECT dedupe_key, normalized_phone, display_phone, phone_type, phone_status, is_primary
           FROM public.${PHONES_TABLE}
          WHERE candidate_id = $1
            AND suppressed_at IS NULL
            AND normalized_phone IS NOT NULL
          ORDER BY normalized_phone`,
        [candidateId],
      );

    const candidateRow = async (candidateId: string) =>
      (
        await sql(
          `SELECT phone, phone_reveal_status, phone_reveal_provider, phone_reveal_cost_credits,
                  phone_reveal_cost_source, phone_reveal_error_code, enrichment_metadata
             FROM public.contact_enrichment_candidates WHERE id = $1`,
          [candidateId],
        )
      )[0];

    const runsOf = async (candidateId: string) =>
      sql(
        `SELECT id, status, run_mode, lusha_attempted_at, lusha_outcome, lusha_cost_credits,
                lusha_cost_source, final_provider, completed_at, error_code,
                credit_reservation_group_id, max_credits_authorized
           FROM public.phone_reveal_waterfall_runs
          WHERE candidate_id = $1 ORDER BY authorized_at`,
        [candidateId],
      );

    const reservationsOf = async (candidateId: string) =>
      sql(
        `SELECT id, provider_key, credits_reserved, credits_confirmed, cost_truth, status,
                run_id, reservation_group_id, release_reason
           FROM public.phone_reveal_credit_reservations
          WHERE candidate_id = $1 ORDER BY created_at`,
        [candidateId],
      );

    const usageLogs = async () =>
      sql(
        `SELECT provider_key, operation_key, credits_used, status, error_code, metadata
           FROM public.provider_usage_logs ORDER BY created_at`,
      );

    /**
     * Consumo efectivo con la lógica REAL, alimentada con filas leídas del PostgreSQL
     * efímero. Es la comprobación de § 8: el arnés no recalcula la regla, la EJECUTA.
     */
    async function effectiveConsumption() {
      const logs = await usageLogs();
      const reservations = await sql(
        `SELECT provider_key, status, credits_reserved, credits_confirmed, cost_truth,
                run_id, reservation_group_id
           FROM public.phone_reveal_credit_reservations`,
      );
      const runs = await sql(
        `SELECT id, credit_reservation_group_id FROM public.phone_reveal_waterfall_runs
          WHERE credit_reservation_group_id IS NOT NULL`,
      );
      const runIdByReservationGroupId = new Map<string, string>(
        runs.map((row) => [
          String(row.credit_reservation_group_id),
          String(row.id),
        ]),
      );
      return computeEffectiveConsumption({
        usageLogs: logs.map((row) => {
          const metadata = (row.metadata ?? {}) as Record<string, unknown>;
          const correlated = metadata['phone_reveal_waterfall_id'];
          return {
            providerKey: String(row.provider_key),
            creditsUsed: row.credits_used == null ? null : Number(row.credits_used),
            estimatedCostUsd:
              row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
            waterfallRunId:
              typeof correlated === 'string' && correlated.length > 0 ? correlated : null,
          };
        }),
        reservations: reservations.map((row) => ({
          providerKey: String(row.provider_key),
          status: row.status as 'reserved' | 'confirmed' | 'released',
          creditsReserved:
            row.credits_reserved == null ? null : Number(row.credits_reserved),
          creditsConfirmed:
            row.credits_confirmed == null ? null : Number(row.credits_confirmed),
          costTruth: (row.cost_truth as 'reported' | 'assumed_cap' | null) ?? null,
          runId: typeof row.run_id === 'string' ? row.run_id : null,
          reservationGroupId:
            typeof row.reservation_group_id === 'string'
              ? row.reservation_group_id
              : null,
        })),
        runIdByReservationGroupId,
      });
    }

    // ── Sembrado ────────────────────────────────────────────────

    /** Techo del pozo de Lusha. `null` ⇒ regla ausente (`budget_not_configured`). */
    async function setBudget(limitCredits: number | null) {
      await sql(`DELETE FROM public.budget_rules WHERE provider_key = 'lusha'`);
      if (limitCredits === null) return;
      await sql(
        `INSERT INTO public.budget_rules
           (provider_key, scope_type, scope_id, period_type, limit_credits, on_exceed, is_active)
         VALUES ('lusha', 'global', NULL, 'monthly', $1, 'block', true)`,
        [limitCredits],
      );
    }

    /**
     * Consumo ya agregado del período, como usage-log SIN correlación de corrida: es la
     * forma en la que el gasto histórico existe realmente en la tabla.
     */
    async function seedConsumed(credits: number) {
      if (credits <= 0) return;
      await sql(
        `INSERT INTO public.provider_usage_logs
           (provider_key, operation_key, credits_used, status, estimated_cost_usd, metadata, created_at)
         VALUES ('lusha', 'contact_phone_reveal_history', $1, 'success', 0, '{}'::jsonb, now())`,
        [credits],
      );
    }

    /**
     * Candidato ELEGIBLE: terna de evidencia completa (`no_phone_found` + `apollo` +
     * `completed_at`), sin teléfono, editable y con id Lusha propio. Que sea elegible es
     * deliberado: el único motivo de cierre posible en cada test es el que ese test mide.
     */
    async function seedCandidate(
      id: string,
      overrides: Record<string, unknown> = {},
    ) {
      const row = {
        status: 'pending_review',
        source: 'lusha',
        source_contact_id: `v1.contact.${id}`,
        phone: null,
        phone_reveal_status: 'no_phone_found',
        phone_reveal_provider: 'apollo',
        phone_reveal_completed_at: '2026-07-01T10:00:00.000Z',
        phone_reveal_attempt_count: 1,
        email: null,
        linkedin_url: null,
        apollo_person_id: null,
        ...overrides,
      };
      await sql(
        `INSERT INTO public.contact_enrichment_candidates
           (id, enrichment_run_id, status, source, source_contact_id, phone,
            phone_reveal_status, phone_reveal_provider, phone_reveal_completed_at,
            phone_reveal_attempt_count, email, linkedin_url, apollo_person_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          ENRICHMENT_RUN_ID,
          row.status,
          row.source,
          row.source_contact_id,
          row.phone,
          row.phone_reveal_status,
          row.phone_reveal_provider,
          row.phone_reveal_completed_at,
          row.phone_reveal_attempt_count,
          row.email,
          row.linkedin_url,
          row.apollo_person_id,
        ],
      );
    }

    const reveal = (candidateId = CANDIDATE_A, actor = ADMIN) =>
      executeLegacyLushaOnlyPhoneReveal({ candidateId, actor });

    // ═══════════════════════════════════════════════════════════
    // Arranque
    // ═══════════════════════════════════════════════════════════

    before(async () => {
      if (!EmbeddedPostgresCtor || !PgModule) return;

      ({ executeLegacyLushaOnlyPhoneReveal } = await import(
        '../legacy-lusha-only-reveal-engine'
      ));
      ({ computeEffectiveConsumption } = await import(
        '@/modules/budgets/effective-consumption-core'
      ));

      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4ofr2-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54407,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      bootstrap = postgres.getPgClient();
      await bootstrap.connect();

      pgVersion = String((await sql('SHOW server_version'))[0].server_version);

      await bootstrap.query(`DO $$ BEGIN
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END $$;`);
      await bootstrap.query(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      await bootstrap.query(`
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at := now(); RETURN NEW; END $$;`);

      // Tablas de apoyo. Sólo las columnas que los lectores REALES consultan: lo que
      // este archivo valida es el SQL de las migraciones 102/103/104/109/111/113, no el
      // esquema de la contabilidad general.
      await bootstrap.query(`
        CREATE TABLE public.accounts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.roles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          key text NOT NULL);
        CREATE TABLE public.organization_groups (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text,
          parent_group_id uuid);
        CREATE TABLE public.internal_users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          role_id uuid REFERENCES public.roles(id),
          group_id uuid REFERENCES public.organization_groups(id));
        CREATE TABLE public.contacts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id uuid REFERENCES public.accounts(id),
          email text,
          linkedin_url text,
          contact_status text);
        CREATE TABLE public.contact_enrichment_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id uuid REFERENCES public.accounts(id));

        CREATE TABLE public.contact_enrichment_candidates (
          id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          enrichment_run_id                uuid NOT NULL
            REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
          status                           text,
          source                           text,
          source_contact_id                text,
          email                            text,
          linkedin_url                     text,
          phone                            text,
          enrichment_metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
          phone_reveal_status              text,
          phone_revealed_at                timestamptz,
          phone_revealed_by                uuid,
          phone_reveal_provider            text,
          phone_reveal_error_code          text,
          phone_reveal_cost_credits        integer,
          phone_reveal_cost_source         text,
          phone_processing_basis           text,
          phone_reveal_request_id          text,
          phone_reveal_completed_at        timestamptz,
          phone_reveal_webhook_received_at timestamptz,
          phone_reveal_attempt_count       integer NOT NULL DEFAULT 0,
          phone_reveal_last_checked_at     timestamptz,
          apollo_person_id                 text,
          updated_at                       timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE public.budget_rules (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          provider_key  text NOT NULL,
          scope_type    text NOT NULL,
          scope_id      text,
          period_type   text NOT NULL DEFAULT 'monthly',
          limit_credits numeric(14,4),
          limit_usd     numeric(12,6),
          on_exceed     text NOT NULL DEFAULT 'alert',
          is_active     boolean NOT NULL DEFAULT true,
          created_at    timestamptz NOT NULL DEFAULT now(),
          updated_at    timestamptz NOT NULL DEFAULT now());

        CREATE TABLE public.provider_usage_logs (
          id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_run_id           uuid,
          agent_run_step_id      uuid,
          batch_id               uuid,
          usage_key              text,
          provider_key           text NOT NULL,
          operation_key          text NOT NULL,
          model                  text,
          input_tokens           integer NOT NULL DEFAULT 0,
          output_tokens          integer NOT NULL DEFAULT 0,
          credits_used           numeric,
          results_returned       integer NOT NULL DEFAULT 0,
          estimated_cost_usd     numeric,
          real_cost_usd          numeric,
          status                 text NOT NULL DEFAULT 'success',
          error_code             text,
          error_message          text,
          duration_ms            integer,
          triggered_by           uuid,
          triggered_by_role_key  text,
          triggered_by_group_id  uuid,
          metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at             timestamptz NOT NULL DEFAULT now());

        CREATE TABLE public.phone_reveal_suppression_audit (
          id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          provider                text NOT NULL DEFAULT 'apollo',
          provider_person_id_hash text NOT NULL,
          account_id              uuid,
          country_code            text,
          actor_user_id           uuid,
          reason_code             text NOT NULL,
          candidates_cleared      integer NOT NULL DEFAULT 0,
          contacts_cleared        integer NOT NULL DEFAULT 0,
          cache_rows_suppressed   integer NOT NULL DEFAULT 0,
          tombstone_created       boolean NOT NULL DEFAULT false,
          created_at              timestamptz NOT NULL DEFAULT now(),
          metadata                jsonb NOT NULL DEFAULT '{}'::jsonb
        );`);

      // La caché de reveals, TAL CUAL la declara la 099 (secciones 1–3): es la tabla
      // sobre la que la puerta de privacidad lee la supresión POR PERSONA.
      await bootstrap.query(
        sliceMigration(
          '099_apollo_phone_reveal_cache.sql',
          '-- ── 1. Cache table',
          '-- ── 4. updated_at trigger',
        ),
      );

      // ── Migraciones REALES bajo prueba ──
      await bootstrap.query(readMigration('102_phone_reveal_waterfall_runs.sql'));
      await bootstrap.query(readMigration('103_phone_reveal_waterfall_legacy_mode.sql'));
      await bootstrap.query(readMigration('104_phone_reveal_credit_reservations.sql'));
      await bootstrap.query(readMigration('109_contact_enrichment_candidate_phones.sql'));
      await bootstrap.query(
        readMigration('110_persist_candidate_apollo_phone_reveal_result.sql'),
      );
      await bootstrap.query(
        readMigration('111_persist_candidate_lusha_phone_reveal_result.sql'),
      );
      await bootstrap.query(readMigration('112_suppress_candidate_phone_collection.sql'));
      await bootstrap.query(
        readMigration('113_phone_reveal_person_suppression_recheck.sql'),
      );

      // Inyector de fallo de persistencia (§ 22). INERTE salvo activación explícita.
      await bootstrap.query(`
        CREATE TABLE public.test_injection (persist_fails boolean NOT NULL);
        INSERT INTO public.test_injection VALUES (false);
        CREATE FUNCTION test_inject_persist_failure() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF (SELECT persist_fails FROM public.test_injection LIMIT 1) THEN
            RAISE EXCEPTION 'injected failure: phone source insert';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER test_inject_persist_failure
          BEFORE INSERT ON public.${SOURCES_TABLE}
          FOR EACH ROW EXECUTE FUNCTION test_inject_persist_failure();`);

      await sql('INSERT INTO public.accounts (id) VALUES ($1)', [ACCOUNT_ID]);
      await sql(`INSERT INTO public.roles (id, key) VALUES ($1, 'admin')`, [ROLE_ID]);
      await sql('INSERT INTO public.internal_users (id, role_id) VALUES ($1, $2)', [
        ADMIN_ID,
        ROLE_ID,
      ]);
      await sql(
        'INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)',
        [ENRICHMENT_RUN_ID, ACCOUNT_ID],
      );

      pool = new PgModule.Pool({
        // 127.0.0.1 explícito: `localhost` resuelve primero a ::1, donde el servidor
        // embebido no escucha, y cada consulta pagaría el reintento.
        host: '127.0.0.1',
        port: 54407,
        user: 'postgres',
        password: 'postgres',
        database: 'postgres',
        max: 10,
      });
    });

    after(async () => {
      if (pool) await pool.end();
      if (bootstrap) await bootstrap.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
      globalThis.fetch = originalFetch;
    });

    beforeEach(async () => {
      if (!EmbeddedPostgresCtor) return;
      await sql(`UPDATE public.test_injection SET persist_fails = false`);
      await sql(`DELETE FROM public.${SOURCES_TABLE}`);
      await sql(`DELETE FROM public.${PHONES_TABLE}`);
      await sql('DELETE FROM public.phone_reveal_credit_reservations');
      await sql('DELETE FROM public.phone_reveal_waterfall_runs');
      await sql('DELETE FROM public.provider_usage_logs');
      await sql('DELETE FROM public.contact_enrichment_candidates');
      await sql('DELETE FROM public.phone_reveal_cache');
      await sql('DELETE FROM public.contacts');
      await setBudget(100);
      await seedCandidate(CANDIDATE_A);
      await seedCandidate(CANDIDATE_B);
      provider = {
        phones: [{ number: MOBILE, rawType: 'mobile' }],
        creditsCharged: LUSHA_LEG_CREDITS,
        fails: false,
        noPhone: false,
      };
      providerCalls = [];
      httpRequests = [];
      waterfallFlag = false;
      manualFallbackFlag = true;
    });

    // ═══════════════════════════════════════════════════════════
    // § 4 — la RPC 104 REAL crea la corrida legacy con UNA pata
    // ═══════════════════════════════════════════════════════════

    describe('§ 4 — migración 104 real', () => {
      it('el arnés corre sobre PostgreSQL 17, la serie de Producción (17.6)', () => {
        assert.match(
          pgVersion,
          /^17\./,
          `versión del servidor inesperada: ${pgVersion}`,
        );
      });

      it('el disparo manual crea una corrida `legacy_lusha_only` con reserva SÓLO de Lusha', async () => {
        const result = await reveal();
        assert.equal(result.outcome, 'lusha_revealed', JSON.stringify(result));

        const runs = await runsOf(CANDIDATE_A);
        assert.equal(runs.length, 1, 'exactamente una corrida');
        assert.equal(runs[0].run_mode, 'legacy_lusha_only');
        assert.equal(Number(runs[0].max_credits_authorized), LUSHA_LEG_CREDITS);

        const reservations = await reservationsOf(CANDIDATE_A);
        assert.equal(reservations.length, 1, 'una sola pata reservada');
        assert.equal(reservations[0].provider_key, 'lusha');
        assert.equal(Number(reservations[0].credits_reserved), LUSHA_LEG_CREDITS);
        assert.equal(
          await countRows(
            'phone_reveal_credit_reservations',
            `WHERE provider_key = 'apollo'`,
          ),
          0,
          'Apollo no reserva: no se ejecuta bajo esta autorización',
        );
      });

      it('el `waterfall_run_id` es REAL: la fila existe y la reserva la referencia', async () => {
        await reveal();
        const runs = await runsOf(CANDIDATE_A);
        const reservations = await reservationsOf(CANDIDATE_A);
        assert.equal(reservations[0].run_id, runs[0].id);
        assert.equal(
          reservations[0].reservation_group_id,
          runs[0].credit_reservation_group_id,
        );
        const logs = await usageLogs();
        assert.equal(
          (logs[0].metadata as Record<string, unknown>)['phone_reveal_waterfall_id'],
          runs[0].id,
          'el usage-log lleva el id de la corrida REAL, no uno fabricado',
        );
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 5 / § 6 / § 7 — el presupuesto en la frontera de la base
    // ═══════════════════════════════════════════════════════════

    describe('§ 5-7 — presupuesto contra la base real', () => {
      it('§ 5 — disponible 0 ⇒ 0 corridas, 0 reservas, 0 llamadas, 0 usage-logs', async () => {
        await setBudget(5);
        await seedConsumed(5);
        const before = await usageLogs();

        const result = await reveal();

        assert.equal(result.outcome, 'not_started');
        assert.equal(result.reason, 'insufficient_credits');
        assert.equal(providerCalls.length, 0, 'el proveedor no se llamó');
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 0);
        assert.equal(await countRows('phone_reveal_credit_reservations'), 0);
        assert.equal(await activeReservations(), 0);
        assert.equal((await usageLogs()).length, before.length, '0 usage-logs nuevos');
      });

      it('§ 6 — disponible 4 frente a 5 requeridos ⇒ 0 llamadas y 0 reserva activa', async () => {
        await setBudget(5);
        await seedConsumed(1);

        const result = await reveal();

        assert.equal(result.reason, 'insufficient_credits');
        assert.equal(providerCalls.length, 0);
        assert.equal(await activeReservations(), 0);
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 0);
      });

      it('§ 7 — disponible EXACTAMENTE 5 ⇒ 1 corrida, 1 reserva, 1 llamada, 1 usage-log', async () => {
        await setBudget(5);

        const result = await reveal();

        assert.equal(result.outcome, 'lusha_revealed');
        assert.equal(providerCalls.length, 1);

        const runs = await runsOf(CANDIDATE_A);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].run_mode, 'legacy_lusha_only');
        assert.equal(runs[0].status, 'completed_lusha');
        assert.notEqual(runs[0].completed_at, null, 'la corrida quedó TERMINAL');

        const reservations = await reservationsOf(CANDIDATE_A);
        assert.equal(reservations.length, 1);
        assert.equal(reservations[0].status, 'confirmed');
        assert.equal(Number(reservations[0].credits_confirmed), LUSHA_LEG_CREDITS);
        assert.equal(await activeReservations(), 0, '0 exposición viva');

        const logs = await usageLogs();
        assert.equal(logs.length, 1);
        assert.equal(logs[0].provider_key, 'lusha');
        assert.equal(Number(logs[0].credits_used), LUSHA_LEG_CREDITS);
      });

      it('regla de crédito ausente ⇒ `budget_not_configured`, 0 llamadas', async () => {
        await setBudget(null);

        const result = await reveal();

        assert.equal(result.reason, 'budget_not_configured');
        assert.equal(providerCalls.length, 0);
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 0);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 8 — el ledger REAL alimenta la lógica REAL
    // ═══════════════════════════════════════════════════════════

    describe('§ 8 — consumo efectivo con filas reales', () => {
      it('usage-log 5 + reserva confirmada 5 sobre la MISMA corrida ⇒ consumo efectivo 5, no 10', async () => {
        await setBudget(100);
        await reveal();

        const consumption = await effectiveConsumption();

        assert.equal(consumption.credits, 5, 'una llamada de 5 créditos consume 5');
        assert.notEqual(consumption.credits, 10, 'doble conteo CERRADO');
        assert.equal(consumption.breakdown.excludedUsageLogCount, 1);
        assert.equal(consumption.breakdown.excludedUsageLogCredits, 5);
        assert.equal(consumption.breakdown.confirmedReservationCredits, 5);
        assert.equal(consumption.breakdown.usageLogCredits, 0);
        assert.equal(consumption.reservedCredits, 0);
      });

      it('la exclusión se apoya en la identidad de corrida, no en el orden de las filas', async () => {
        await setBudget(100);
        await reveal();
        const runs = await runsOf(CANDIDATE_A);
        const logs = await usageLogs();
        assert.equal(
          (logs[0].metadata as Record<string, unknown>)['phone_reveal_waterfall_id'],
          runs[0].id,
        );
        const reservations = await reservationsOf(CANDIDATE_A);
        assert.equal(reservations[0].run_id, runs[0].id);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 9 / § 10 / § 11 / § 12 — concurrencia REAL
    // ═══════════════════════════════════════════════════════════

    describe('§ 9-12 — single-flight sobre conexiones concurrentes', () => {
      it('§ 9 — 3 invocaciones concurrentes con presupuesto 100 ⇒ 1 sola llamada pagada', async () => {
        await setBudget(100);

        const results = await Promise.all([reveal(), reveal(), reveal()]);

        assert.equal(providerCalls.length, 1, 'UNA sola llamada al proveedor');
        assert.equal(
          await countRows('phone_reveal_waterfall_runs'),
          1,
          'una sola corrida pagada',
        );
        assert.equal((await usageLogs()).length, 1);
        assert.equal(await activeReservations(), 0);

        const paid = results.filter((r) => r.outcome === 'lusha_revealed');
        assert.equal(paid.length, 1);
        for (const other of results.filter((r) => r.outcome !== 'lusha_revealed')) {
          assert.ok(
            ['active_run_exists', 'create_conflict', 'already_reserved'].includes(
              String(other.reason),
            ),
            `motivo esperado de single-flight, recibido: ${String(other.reason)}`,
          );
        }
        const consumption = await effectiveConsumption();
        assert.equal(consumption.credits, 5, 'presupuesto abundante y aun así 5');
      });

      it('§ 11 — 3 concurrentes con presupuesto EXACTO 5 ⇒ 1 llamada y consumo ≤ 5', async () => {
        await setBudget(5);

        await Promise.all([reveal(), reveal(), reveal()]);

        assert.equal(providerCalls.length, 1);
        const consumption = await effectiveConsumption();
        assert.ok(
          consumption.credits <= 5,
          `consumo ${consumption.credits} debe ser ≤ 5 (sin sobrecompromiso)`,
        );
        assert.equal(await activeReservations(), 0);
      });

      it('§ 10 — el mecanismo que impide el duplicado es de PostgreSQL, no del guard JS', async () => {
        // Se invoca la RPC REAL dos veces con claves de autorización DISTINTAS, saltando
        // por completo el guard barato del core: si el bloqueo viviera en JavaScript,
        // aquí habría dos reservas vivas.
        const groupA = randomUUID();
        const groupB = randomUUID();
        const legs = JSON.stringify([
          {
            provider_key: 'lusha',
            credits: 5,
            scope_type: 'global',
            scope_id: null,
            period_start: '2026-08-01T00:00:00.000Z',
            period_end: '2026-09-01T00:00:00.000Z',
            limit_credits: 100,
            consumed_credits: 0,
          },
        ]);
        const run = JSON.stringify({
          status: 'lusha_pending',
          run_mode: 'legacy_lusha_only',
          max_credits_authorized: 5,
          authorized_by_role: 'admin',
          lusha_eligible: true,
        });

        const call = (group: string) =>
          bootstrap.query(
            `SELECT public.reserve_and_create_phone_reveal_run(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::jsonb, $6::jsonb) AS r`,
            [CANDIDATE_A, ADMIN_ID, randomUUID(), group, legs, run],
          );

        const first = (await call(groupA)).rows[0].r as Record<string, unknown>;
        const second = (await call(groupB)).rows[0].r as Record<string, unknown>;

        assert.equal(first.status, 'created');
        assert.equal(
          second.status,
          'already_reserved',
          'la SEGUNDA autorización la rechaza la propia transacción',
        );
        assert.equal(await activeReservations(), 1);

        // Y el índice único parcial es la garantía ESTRUCTURAL, comprobada aparte: un
        // INSERT directo de una segunda pata activa del mismo candidato+proveedor falla.
        await assert.rejects(
          () =>
            bootstrap.query(
              `INSERT INTO public.phone_reveal_credit_reservations
                 (reservation_group_id, candidate_id, provider_key, credits_reserved,
                  status, scope_type, scope_id, period_start, period_end, limit_credits,
                  authorized_by)
               VALUES ($1, $2, 'lusha', 5, 'reserved', 'global', NULL,
                       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 100, $3)`,
              [randomUUID(), CANDIDATE_A, ADMIN_ID],
            ),
          /uq_phone_reveal_credit_reservations_active_leg/,
          'el índice único parcial de la migración 104 es la autoridad',
        );
      });

      it('§ 12 — candidatos DISTINTOS no se serializan entre sí', async () => {
        await setBudget(100);

        const [a, b] = await Promise.all([reveal(CANDIDATE_A), reveal(CANDIDATE_B)]);

        assert.equal(a.outcome, 'lusha_revealed');
        assert.equal(b.outcome, 'lusha_revealed');
        assert.equal(providerCalls.length, 2, 'no hay lock global por proveedor');
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 2);

        const consumption = await effectiveConsumption();
        assert.equal(consumption.credits, 10, 'dos operaciones de 5 consumen 10');
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 13 — elegibilidad: un `no_phone_found` de LUSHA no se repaga
    // ═══════════════════════════════════════════════════════════

    describe('§ 13 — elegibilidad sobre evidencia persistida', () => {
      it('un `no_phone_found` de origen APOLLO sí es elegible', async () => {
        const result = await reveal();
        assert.equal(result.outcome, 'lusha_revealed');
        assert.equal(providerCalls.length, 1);
      });

      it('un `no_phone_found` de origen LUSHA NO es elegible: 0 llamadas, 0 corridas', async () => {
        await sql(
          `UPDATE public.contact_enrichment_candidates
              SET phone_reveal_provider = 'lusha' WHERE id = $1`,
          [CANDIDATE_A],
        );

        const result = await reveal();

        assert.equal(result.outcome, 'not_started');
        assert.equal(providerCalls.length, 0, 'no se vuelve a comprar la misma respuesta');
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 0);
        assert.equal(await countRows('phone_reveal_credit_reservations'), 0);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 14 / § 15 / § 16 — multi-teléfono por la transacción real
    // ═══════════════════════════════════════════════════════════

    describe('§ 14-16 — persistencia multi-teléfono transaccional', () => {
      it('§ 14 — WORK + MOBILE + DIRECT ⇒ 3 filas vivas, 1 principal MÓVIL, escalar sincronizado', async () => {
        provider.phones = [
          { number: WORK, rawType: 'work' },
          { number: MOBILE, rawType: 'mobile' },
          { number: DIRECT, rawType: 'direct_dial' },
        ];

        const result = await reveal();
        assert.equal(result.outcome, 'lusha_revealed');

        const phones = await livePhones(CANDIDATE_A);
        assert.equal(phones.length, 3, 'los TRES números pagados se persisten');
        const primaries = phones.filter((p) => p.is_primary === true);
        assert.equal(primaries.length, 1, 'exactamente un principal');
        assert.equal(primaries[0].phone_type, 'mobile');
        assert.equal(primaries[0].normalized_phone, MOBILE);

        const candidate = await candidateRow(CANDIDATE_A);
        assert.equal(candidate.phone, MOBILE, 'el escalar describe al principal');
        assert.equal(candidate.phone_reveal_status, 'revealed');
        assert.equal(candidate.phone_reveal_provider, 'lusha');

        // Facturación por RESPUESTA: 5, jamás 5 × 3.
        assert.equal(Number(candidate.phone_reveal_cost_credits), LUSHA_LEG_CREDITS);
        const logs = await usageLogs();
        assert.equal(logs.length, 1);
        assert.equal(Number(logs[0].credits_used), LUSHA_LEG_CREDITS);
        assert.equal(providerCalls.length, 1);
      });

      it('§ 15 — el MISMO número repetido en la respuesta ⇒ 1 sola fila canónica', async () => {
        provider.phones = [
          { number: MOBILE, rawType: 'mobile' },
          { number: MOBILE, rawType: 'mobile' },
        ];

        await reveal();

        const phones = await livePhones(CANDIDATE_A);
        assert.equal(phones.length, 1, 'deduplicado por número normalizado');
        assert.equal(phones[0].is_primary, true);
      });

      it('§ 16 — Apollo principal MÓVIL + Lusha WORK ⇒ Apollo SIGUE siendo principal', async () => {
        // Preexistencia canónica de Apollo. Se siembra con INSERT y no con la RPC de la
        // 110 a propósito: lo que este test mide es a quién ELIGE como principal la
        // transacción de LUSHA ante una colección que ya tiene un móvil de otro
        // proveedor; el escritor de Apollo tiene su propia suite.
        await sql(
          `INSERT INTO public.${PHONES_TABLE}
             (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type,
              phone_status, is_primary)
           VALUES ($1, $2, $3, $3, 'mobile', 'valid', true)`,
          [CANDIDATE_A, keyOf(MOBILE), MOBILE],
        );
        // La procedencia cuelga de la FILA del teléfono (`candidate_phone_id`), no del
        // candidato: es lo que permite que un número compartido por dos proveedores tenga
        // UNA fila canónica y DOS procedencias.
        await sql(
          `INSERT INTO public.${SOURCES_TABLE}
             (candidate_phone_id, provider, acquisition_mode, raw_provider_type,
              source_event_key, observed_at)
           SELECT id, 'apollo', 'reveal', 'mobile', 'apollo-seed', now()
             FROM public.${PHONES_TABLE}
            WHERE candidate_id = $1 AND dedupe_key = $2`,
          [CANDIDATE_A, keyOf(MOBILE)],
        );
        await sql(
          `UPDATE public.contact_enrichment_candidates SET phone = $2 WHERE id = $1`,
          [CANDIDATE_A, MOBILE],
        );

        // El candidato vuelve a ser elegible para la pata legacy: el escalar se vacía
        // porque `existing_phone_present` cortaría antes de llegar al proveedor.
        await sql(
          `UPDATE public.contact_enrichment_candidates
              SET phone_reveal_status = 'no_phone_found', phone_reveal_provider = 'apollo',
                  phone = NULL
            WHERE id = $1`,
          [CANDIDATE_A],
        );

        provider.phones = [{ number: WORK, rawType: 'work', phoneType: 'work' }];
        await reveal();

        const phones = await livePhones(CANDIDATE_A);
        assert.equal(phones.length, 2);
        const primary = phones.find((p) => p.is_primary === true);
        assert.equal(
          primary?.normalized_phone,
          MOBILE,
          'un WORK de Lusha no destrona a un MÓVIL de Apollo',
        );

        // Cuando el incumbente CONSERVA la designación, la migración 111 deja los campos
        // visibles EXACTAMENTE como estaban (`v_scalar_updated := false`): reetiquetarlos
        // como el reveal de este proveedor sería atribuirle un número que no consiguió.
        // Por eso lo que se afirma es lo que importa —el escalar NO pasa a ser el WORK de
        // Lusha—, y no un valor concreto: este candidato llega con el escalar vacío
        // porque, con teléfono presente, `existing_phone_present` habría cortado antes de
        // llegar al proveedor.
        const candidate = await candidateRow(CANDIDATE_A);
        assert.notEqual(
          candidate.phone,
          WORK,
          'el escalar NO adopta el número peor del segundo proveedor',
        );
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 17 a § 21 — privacidad
    // ═══════════════════════════════════════════════════════════

    describe('§ 17-21 — privacidad contra el esquema real', () => {
      /**
       * Supresión POR PERSONA real: fila de la caché con `suppressed_at`, que es
       * EXACTAMENTE lo que lee `readPhoneCacheSuppression`. La 099 exige país, ventana y
       * motivo, así que la fila se siembra completa en vez de mínima.
       */
      /**
       * Identidad de persona para la supresión. En un candidato de origen LUSHA,
       * `resolvePhoneCachePersonId` SÓLO acepta `apollo_person_id` — el id de contacto de
       * Lusha no es una clave de la caché de Apollo. Se siembran las dos: el id de Lusha
       * conserva la ELEGIBILIDAD y el de Apollo hace evaluable la privacidad, que es la
       * combinación que se da en un candidato real que ya pasó por Apollo.
       */
      // Forma de ObjectId de Apollo (24 hex). `normalizeApolloPersonId` RECHAZA cualquier
      // otra cosa, así que un id inventado tipo `apollo-person-1` haría que la puerta
      // resolviera «no evaluable» y el test pasara por no comprobar nada.
      const SUPPRESSED_PERSON = '5f1a2b3c4d5e6f708192a3b4';

      async function withApolloIdentity(candidateId: string) {
        await sql(
          `UPDATE public.contact_enrichment_candidates
              SET apollo_person_id = $2 WHERE id = $1`,
          [candidateId, SUPPRESSED_PERSON],
        );
      }

      async function suppressPerson(personId: string, suppressed: boolean) {
        await sql(
          `INSERT INTO public.phone_reveal_cache
             (provider, provider_person_id, account_id, country_code,
              original_revealed_at, expires_at, suppressed_at, suppression_reason)
           VALUES ('apollo', $1, $2, 'US', now(), now() + interval '90 days',
                   CASE WHEN $3 THEN now() ELSE NULL END,
                   CASE WHEN $3 THEN 'dsar_erasure_request' ELSE NULL END)`,
          [personId, ACCOUNT_ID, suppressed],
        );
      }

      /**
       * Tombstone POR NÚMERO: la fila SOBREVIVE sin el número, que es la forma en la que
       * la 109 impide que una respuesta pagada lo resucite. La clave es la real.
       */
      async function tombstoneNumber(candidateId: string, number: string) {
        await sql(
          `INSERT INTO public.${PHONES_TABLE}
             (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type,
              phone_status, is_primary, suppressed_at, suppression_reason, suppressed_by)
           VALUES ($1, $2, NULL, NULL, NULL, 'unknown', false, now(),
                   'data_subject_request', $3)`,
          [candidateId, keyOf(number), ADMIN_ID],
        );
      }

      it('§ 18 — `do_not_contact` ANTES de reservar ⇒ 0 corridas, 0 reservas, 0 llamadas, 0 usage-logs', async () => {
        await sql(
          `UPDATE public.contact_enrichment_candidates
              SET email = 'dnc@example.com' WHERE id = $1`,
          [CANDIDATE_A],
        );
        await sql(
          `INSERT INTO public.contacts (account_id, email, contact_status)
           VALUES ($1, 'dnc@example.com', 'do_not_contact')`,
          [ACCOUNT_ID],
        );

        const result = await reveal();

        assert.equal(result.outcome, 'not_started');
        assert.equal(result.reason, 'do_not_contact');
        assert.equal(providerCalls.length, 0);
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 0);
        assert.equal(await countRows('phone_reveal_credit_reservations'), 0);
        assert.equal((await usageLogs()).length, 0);
      });

      it('§ 17 — supresión POR PERSONA previa ⇒ mismas garantías de cero efectos', async () => {
        // El candidato conserva su id de contacto Lusha: así el ÚNICO motivo de cierre
        // posible es la privacidad, y no la falta de identidad.
        await withApolloIdentity(CANDIDATE_A);
        await suppressPerson(SUPPRESSED_PERSON, true);

        const result = await reveal();

        assert.equal(result.reason, 'blocked_suppressed');
        assert.equal(providerCalls.length, 0);
        assert.equal(await countRows('phone_reveal_waterfall_runs'), 0);
        assert.equal(await activeReservations(), 0);
      });

      it('§ 19 — `do_not_contact` EN VUELO ⇒ 1 llamada pagada, 0 teléfono persistido, reserva liquidada', async () => {
        await sql(
          `UPDATE public.contact_enrichment_candidates
              SET email = 'inflight@example.com' WHERE id = $1`,
          [CANDIDATE_A],
        );
        // El bloqueo aparece DESPUÉS de que el proveedor cobre.
        provider.onCall = async () => {
          await sql(
            `INSERT INTO public.contacts (account_id, email, contact_status)
             VALUES ($1, 'inflight@example.com', 'do_not_contact')`,
            [ACCOUNT_ID],
          );
        };

        await reveal();

        assert.equal(providerCalls.length, 1, 'el proveedor SÍ cobró');
        assert.equal(
          (await livePhones(CANDIDATE_A)).length,
          0,
          '0 teléfonos vivos: el número no se persiste',
        );

        const logs = await usageLogs();
        assert.equal(logs.length, 1);
        assert.equal(Number(logs[0].credits_used), LUSHA_LEG_CREDITS);

        const reservations = await reservationsOf(CANDIDATE_A);
        assert.equal(reservations.length, 1);
        assert.notEqual(
          reservations[0].status,
          'reserved',
          'la reserva NO queda viva: la corrida terminal la liquida',
        );
        assert.equal(await activeReservations(), 0, '0 fuga de exposición');

        const consumption = await effectiveConsumption();
        assert.equal(consumption.credits, 5, 'el costo real se conserva');
      });

      it('§ 20-21 — supresión por persona EN VUELO ⇒ 0 resurrección y costo intacto', async () => {
        // La fila de caché existe SIN supresión, así que la puerta previa deja pasar; la
        // supresión aparece durante la llamada, que es la ventana que 4O-E3 protege.
        await withApolloIdentity(CANDIDATE_A);
        await suppressPerson(SUPPRESSED_PERSON, false);
        provider.onCall = async () => {
          await sql(
            `UPDATE public.phone_reveal_cache
                SET suppressed_at = now(), suppression_reason = 'dsar_erasure_request'`,
          );
        };

        await reveal();

        assert.equal(providerCalls.length, 1);
        assert.equal(
          (await livePhones(CANDIDATE_A)).length,
          0,
          '0 resurrección del número suprimido',
        );
        assert.equal(await activeReservations(), 0);
        const consumption = await effectiveConsumption();
        assert.equal(consumption.credits, 5, 'el costo real se preserva');
      });

      it('§ 21 — un tombstone POR NÚMERO impide la resurrección dentro de la transacción', async () => {
        // La 111 revisa tombstones por número BAJO EL LOCK: el número se tombstonea antes
        // de que la respuesta pagada intente escribirlo.
        await tombstoneNumber(CANDIDATE_A, MOBILE);

        await reveal();

        assert.equal(providerCalls.length, 1, 'el proveedor cobró');
        const live = await livePhones(CANDIDATE_A);
        assert.equal(
          live.length,
          0,
          'el número tombstoneado NO revive por una respuesta pagada',
        );
        assert.equal(await activeReservations(), 0);
      });

      it('§ 23 — resultado suprimido y PAGADO: costo contado, y el reintento NO vuelve a pagar', async () => {
        await tombstoneNumber(CANDIDATE_A, MOBILE);

        await reveal();
        const firstCalls = providerCalls.length;
        const consumption = await effectiveConsumption();
        assert.equal(firstCalls, 1);
        assert.equal(consumption.credits, 5, 'el costo pagado queda contado');
        assert.equal((await livePhones(CANDIDATE_A)).length, 0);
        assert.equal(await activeReservations(), 0, '0 fuga de reserva');

        // Reintento: el candidato quedó TERMINAL, así que no vuelve a ser elegible.
        await reveal();
        assert.equal(
          providerCalls.length,
          firstCalls,
          'el reintento NO produce una segunda llamada pagada',
        );
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 22 / § 24 / § 25 — fallo de persistencia y costo desconocido
    // ═══════════════════════════════════════════════════════════

    describe('§ 22-25 — fallo, rollback y costo no reportado', () => {
      it('§ 22 + § 25 — la persistencia falla DESPUÉS de pagar ⇒ rollback total y reserva liquidada', async () => {
        await sql(`UPDATE public.test_injection SET persist_fails = true`);

        const result = await reveal();

        assert.equal(providerCalls.length, 1, 'el proveedor cobró');
        assert.notEqual(result.outcome, 'lusha_revealed');

        // Rollback: ni fila canónica, ni procedencia, ni un segundo principal.
        assert.equal(await countRows(PHONES_TABLE), 0, 'sin estado parcial');
        assert.equal(await countRows(SOURCES_TABLE), 0);
        const candidate = await candidateRow(CANDIDATE_A);
        assert.equal(candidate.phone, null, 'el escalar sigue coherente');

        // El costo se preserva y la exposición NO queda viva.
        const logs = await usageLogs();
        assert.equal(logs.length, 1);
        assert.equal(Number(logs[0].credits_used), LUSHA_LEG_CREDITS);
        assert.equal(await activeReservations(), 0, '0 reserva huérfana');
        const consumption = await effectiveConsumption();
        assert.equal(consumption.credits, 5);
      });

      it('§ 24 — el proveedor NO reporta costo ⇒ se confirma con el TOPE, nunca 0 y nunca release', async () => {
        provider.creditsCharged = null;

        await reveal();

        const reservations = await reservationsOf(CANDIDATE_A);
        assert.equal(reservations.length, 1);
        assert.equal(reservations[0].status, 'confirmed', 'confirmada, NO liberada');
        assert.equal(reservations[0].cost_truth, 'assumed_cap');
        assert.equal(
          Number(reservations[0].credits_confirmed),
          LUSHA_LEG_CREDITS,
          'el tope, no 0',
        );
        const consumption = await effectiveConsumption();
        assert.equal(consumption.breakdown.hasAssumedCapCredits, true);
        assert.equal(consumption.credits, 5);
      });

      it('`no_phone_found` pagado ⇒ costo contado, corrida terminal, 0 exposición viva', async () => {
        provider.noPhone = true;

        const result = await reveal();

        assert.equal(result.outcome, 'lusha_no_phone_found');
        assert.equal(providerCalls.length, 1);
        const runs = await runsOf(CANDIDATE_A);
        assert.notEqual(runs[0].completed_at, null);
        assert.equal(await activeReservations(), 0);
        const consumption = await effectiveConsumption();
        assert.equal(consumption.credits, 5);
      });

      it('error del proveedor ⇒ 0 teléfono, 0 exposición viva', async () => {
        provider.fails = true;

        await reveal();

        assert.equal(providerCalls.length, 1);
        assert.equal((await livePhones(CANDIDATE_A)).length, 0);
        assert.equal(await activeReservations(), 0);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 26 — invariantes globales tras todo lo anterior
    // ═══════════════════════════════════════════════════════════

    describe('§ 26 — invariantes de concurrencia', () => {
      it('tras 3 concurrentes: ≤ 1 principal por candidato, ≤ 1 reserva activa, escalar = principal vivo', async () => {
        await setBudget(100);
        provider.phones = [
          { number: WORK, rawType: 'work' },
          { number: MOBILE, rawType: 'mobile' },
        ];

        await Promise.all([reveal(), reveal(), reveal()]);

        const primaries = await sql(
          `SELECT candidate_id, COUNT(*)::int AS n FROM public.${PHONES_TABLE}
            WHERE is_primary = true GROUP BY candidate_id`,
          [],
        );
        for (const row of primaries) {
          assert.equal(row.n, 1, 'como mucho un principal por candidato');
        }

        const activeLegs = await sql(
          `SELECT candidate_id, COUNT(*)::int AS n FROM public.phone_reveal_credit_reservations
            WHERE status = 'reserved' GROUP BY candidate_id`,
          [],
        );
        for (const row of activeLegs) {
          assert.equal(row.n, 1, 'como mucho una pata activa por candidato');
        }

        const candidate = await candidateRow(CANDIDATE_A);
        const live = await livePhones(CANDIDATE_A);
        const primary = live.find((p) => p.is_primary === true);
        assert.equal(candidate.phone, primary?.normalized_phone ?? null);
      });

      it('no se abrió NINGUNA conexión de red: el proveedor y Supabase son locales', () => {
        assert.deepEqual(httpRequests, []);
      });
    });
  },
);
