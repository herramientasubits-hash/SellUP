/**
 * Agente 2A — «Ver más números» del contacto OFICIAL contra PostgreSQL 17 real
 * (AGENT2A-PHONE-REVEAL-4O-H4 · R2.1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * H4 llegó con tres suites: el NÚCLEO puro (sobre arrays escritos a mano), las guardas
 * ESTÁTICAS (sobre el texto de los archivos) y la UI. Ninguna de las tres toca una base de
 * datos, y por eso ninguna de las tres puede demostrar lo único que de verdad decide qué ve
 * el operador:
 *
 *   · que `.eq('contact_id', …)`, `.is('suppressed_at', null)` y el `IN (…)` de la
 *     procedencia SELECCIONAN las filas que el núcleo cree recibir — el núcleo puro se
 *     alimenta de arrays, así que una consulta mal filtrada le llegaría igual de limpia;
 *   · que las policies de la 114 son las que esconden la colección de un usuario no activo,
 *     y no un `if` de TypeScript. La lectura de H4 usa el cliente de SESIÓN precisamente
 *     para que filtre PostgreSQL, y esa afirmación sólo la puede firmar PostgreSQL;
 *   · que una erasure REAL —la RPC de la 115, no un `suppressed_at` puesto a mano— deja el
 *     número visible cuando otro proveedor lo sostiene y lo retira cuando cae el último.
 *
 * Este arnés cierra ese hueco: aplica la cadena de migraciones REAL (099 → 107 → 109 → 112
 * → 114 → 115), escribe filas de verdad con los privilegios de `service_role`, y después
 * ejecuta **el código de producción sin sustituir**: `readOfficialContactStoredPhones`, el
 * núcleo puro y las DOS acciones. Lo único que se sustituye es el borde de I/O —
 * `@/lib/supabase/server`— por un traductor a SQL que corre sobre una conexión con
 * `SET ROLE authenticated` y el `sub` del JWT puesto, de modo que cada `SELECT` de la
 * lectura pasa por las policies igual que en Producción.
 *
 * NO se sustituyen las consultas por arrays simulados: si la lectura pide una columna que no
 * existe, si filtra por la columna equivocada o si deja de filtrar un tombstone, aquí falla.
 *
 * ═══════════════════════════════════════════════════════════════════
 * SEGURIDAD
 * ═══════════════════════════════════════════════════════════════════
 *
 * 0 llamadas a proveedor · 0 créditos · 0 reservas · 0 usage logs · 0 HubSpot.
 * No toca Producción, ni Preview, ni ninguna base remota: el servidor es efímero, vive en un
 * directorio temporal y se destruye al terminar. Ninguna migración se aplica a nada que no
 * sea ese servidor. Todos los números son sintéticos 555 y ninguna persona real aparece.
 *
 * ARNÉS OPCIONAL, igual que sus hermanas. `embedded-postgres` NO es dependencia del repo a
 * propósito (descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio). Si el módulo no está resuelto, el archivo se SALTA con un motivo explícito
 * en vez de fallar. Para correrlo:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:official-contact-stored-phones:postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete son
 * prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6, la de
 * Producción.
 *
 * Requiere `--experimental-test-module-mocks`: el borde de I/O se sustituye con
 * `mock.module`, y por eso los módulos bajo prueba se importan DINÁMICAMENTE dentro de
 * `before()` — un `import` estático se resolvería antes de que el mock exista.
 */

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { normalizeCandidatePhone } from '../phone-collection-core';
import type { StoredOfficialPhoneView } from '../official-contact-stored-phones-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → raíz del repo
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_099 = '099_apollo_phone_reveal_cache.sql';
const MIGRATION_107 = '107_phone_reveal_cache_and_suppression_grants.sql';
const MIGRATION_109 = '109_contact_enrichment_candidate_phones.sql';
const MIGRATION_112 = '112_suppress_candidate_phone_collection.sql';
const MIGRATION_114 = '114_official_contact_phones.sql';
const MIGRATION_115 = '115_official_contact_phone_privacy.sql';

// ═══════════════════════════════════════════════════════════════
// Resolución del arnés opcional
// ═══════════════════════════════════════════════════════════════

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
let harnessSkipReason: string | false = false;

/**
 * Resolución SÍNCRONA con `createRequire`, no con `await import()`: este archivo se
 * transpila a CJS, donde un `await` de nivel superior no compila, y la razón del skip tiene
 * que estar disponible ANTES de que `describe()` decida si corre.
 */
try {
  const require = createRequire(import.meta.url);
  const mod = require('embedded-postgres') as {
    default?: new (options: Record<string, unknown>) => EmbeddedPostgresLike;
  };
  const ctor =
    mod.default ?? (mod as unknown as new (o: Record<string, unknown>) => EmbeddedPostgresLike);
  if (typeof ctor !== 'function') {
    harnessSkipReason = 'embedded-postgres resolvió sin constructor utilizable';
  } else {
    EmbeddedPostgresCtor = ctor;
  }
} catch {
  harnessSkipReason =
    'embedded-postgres no está instalado (arnés opcional a propósito: `npm install --no-save embedded-postgres@17.6.0-beta.15`)';
}

// ═══════════════════════════════════════════════════════════════
// El borde de I/O: un traductor de PostgREST a SQL sobre la conexión de SESIÓN
// ═══════════════════════════════════════════════════════════════
//
// Sustituye SÓLO `createClient()`. Todo lo que hay por encima —la acción, la lectura, el
// núcleo— es el código de producción tal cual. Y lo que hay por debajo es PostgreSQL de
// verdad: este objeto no guarda filas, no filtra nada en memoria y no sabe qué es un
// tombstone; se limita a traducir la cadena de llamadas a una consulta y a devolver lo que
// el servidor conteste bajo el rol `authenticated`.

type Filter =
  | { readonly kind: 'eq'; readonly column: string; readonly value: unknown }
  | { readonly kind: 'in'; readonly column: string; readonly value: unknown[] }
  | { readonly kind: 'is'; readonly column: string; readonly value: unknown };

/** Conexión con `SET ROLE authenticated` y el `sub` del JWT puesto. */
let session: PgLikeClient;
/** Quién es el usuario de la sesión, para `auth.getUser()`. */
let sessionAuthUserId: string | null = null;

function quoteIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`identificador no admitido en el arnés: ${identifier}`);
  }
  return `"${identifier}"`;
}

class SessionQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private columns = '*';
  private readonly filters: Filter[] = [];
  private rowMode: 'many' | 'maybeSingle' = 'many';

  constructor(private readonly table: string) {}

  select(columns: string): this {
    this.columns = columns;
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
  maybeSingle(): this {
    this.rowMode = 'maybeSingle';
    return this;
  }

  private async exec(): Promise<{ data: unknown; error: unknown }> {
    const values: unknown[] = [];
    const selectList =
      this.columns.trim() === '*'
        ? '*'
        : this.columns
            .split(',')
            .map((column) => quoteIdent(column.trim()))
            .join(', ');

    const where = this.filters.map((filter) => {
      const column = quoteIdent(filter.column);
      if (filter.kind === 'is') {
        if (filter.value === null) return `${column} IS NULL`;
        return `${column} IS ${filter.value === true ? 'TRUE' : 'FALSE'}`;
      }
      values.push(filter.value);
      return filter.kind === 'in'
        ? `${column} = ANY($${values.length})`
        : `${column} = $${values.length}`;
    });

    const sql =
      `SELECT ${selectList} FROM public.${quoteIdent(this.table)}` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '');

    try {
      const { rows } = await session.query(sql, values);
      if (this.rowMode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    } catch (err) {
      // El cliente de Supabase NO lanza: devuelve `{ error }`. Reproducirlo importa, porque
      // la lectura de H4 distingue «la consulta falló» de «no hay filas» y convierte lo
      // primero —y sólo lo primero— en una excepción.
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

function pgBackedSessionClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: sessionAuthUserId ? { id: sessionAuthUserId } : null },
        error: null,
      }),
    },
    from: (table: string) => new SessionQuery(table),
  };
}

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => pgBackedSessionClient(),
  },
});

// La acción importa `redirect` para el caso «sin sesión». Ninguna prueba de aquí lo
// provoca —todas actúan con un usuario—, pero el módulo se carga entero y `next/navigation`
// no tiene por qué ejecutarse fuera de Next.
mock.module('next/navigation', {
  namedExports: {
    redirect: (destination: string) => {
      throw new Error(`NEXT_REDIRECT:${destination}`);
    },
  },
});

// ═══════════════════════════════════════════════════════════════
// Datos de prueba — todos sintéticos 555
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
/** Usuario interno ACTIVO: el operador que abre la ficha. */
const ACTIVE_USER_ID = '30000000-0000-4000-8000-000000000001';
/** Usuario interno con el acceso REVOCADO: mismo login, ninguna visibilidad. */
const REVOKED_USER_ID = '30000000-0000-4000-8000-000000000002';

const NOW = '2026-08-13T12:00:00.000Z';

/** La MISMA clave que escribe la aprobación: el normalizador de producción, sin copiarlo. */
const phoneKey = (raw: string) =>
  normalizeCandidatePhone({ displayPhone: raw, sanitizedPhone: raw, countryCode: null }).dedupeKey;

describe(
  '4O-H4 — la lectura de teléfonos oficiales contra PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    /** Conexión de escritura: hace de `service_role`, que es quien puebla en Producción. */
    let admin: PgLikeClient;
    let dataDir: string;

    // El código de producción, importado DESPUÉS de los mocks.
    let readOfficialContactStoredPhones: (
      contactId: string,
    ) => Promise<{
      phones: readonly unknown[];
      sources: readonly unknown[];
      visibleScalarPhones: readonly (string | null)[];
    }>;
    let countAdditionalStoredOfficialPhones: (input: never) => number;
    let selectAdditionalStoredOfficialPhones: (
      input: never,
    ) => readonly StoredOfficialPhoneView[];
    let getOfficialContactStoredPhoneSummaryAction: (input: {
      contactId: string;
    }) => Promise<{ additionalCount: number }>;
    let getOfficialContactStoredPhonesAction: (input: {
      contactId: string;
    }) => Promise<
      | { status: 'ok'; phones: readonly StoredOfficialPhoneView[] }
      | { status: 'unavailable' }
    >;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => admin.query(sql, values);

    /**
     * Pone la conexión de SESIÓN a nombre de un usuario. Es lo que hace que las policies de
     * la 114 tengan algo que evaluar: sin `request.jwt.claim.sub`, `auth.uid()` es NULL y
     * `has_active_access` es falso para todo el mundo.
     */
    async function actAs(authUserId: string): Promise<void> {
      await session.query('RESET ROLE');
      await session.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [authUserId]);
      await session.query('SET ROLE authenticated');
      sessionAuthUserId = authUserId;
    }

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oh4-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401 (4O-F/H1), 54402 (H2), 54403 (H3), 54404 (H3-B) y 54407
        // (4O-F-R2) ya están tomados, y las suites deben poder coexistir.
        port: 54405,
        persistent: false,
        onLog: () => {},
        onError: () => {},
      });
      await postgres.initialise();
      await postgres.start();
      admin = postgres.getPgClient();
      await admin.connect();
      session = postgres.getPgClient();
      await session.connect();

      // ── Los tres roles de Supabase y sus default privileges ──────
      await q(`DO $$ BEGIN
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END $$;`);
      await q(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT ALL ON TABLES TO anon, authenticated, service_role;
        CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      // ── set_updated_at (migración 038) ───────────────────────────
      await q(`
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at := now(); RETURN NEW; END $$;`);

      // ── auth.uid(), como la sirve Supabase ───────────────────────
      await q(`
        CREATE SCHEMA IF NOT EXISTS auth;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);

      // ── internal_users + has_active_access (migración 002) ───────
      await q(`
        CREATE TABLE public.internal_users (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          auth_user_id  uuid,
          access_status text NOT NULL DEFAULT 'active');
        CREATE OR REPLACE FUNCTION has_active_access(p_auth_user_id UUID) RETURNS BOOLEAN AS $$
          SELECT EXISTS(
            SELECT 1 FROM internal_users
            WHERE auth_user_id = p_auth_user_id AND access_status = 'active');
        $$ LANGUAGE sql STABLE;`);

      // ── accounts + contacts con los CHECK y la RLS REALES ────────
      // La policy de `contacts` (039) va porque la de la 114 se DERIVA del contacto padre:
      // sin ella, «la procedencia de un número que no puedo ver tampoco se ve» no se estaría
      // midiendo sobre la cadena completa.
      await q(`
        CREATE TABLE public.accounts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);

        CREATE TABLE public.contacts (
          id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id             uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
          full_name              text NOT NULL,
          email                  text NULL,
          phone                  text NULL,
          mobile_phone           text NULL,
          phone_type             text NULL,
          phone_source           text NULL,
          phone_raw_type         text NULL,
          phone_revealed_at      timestamptz NULL,
          phone_processing_basis text NULL,
          phone_confidence       text NULL,
          metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at             timestamptz NOT NULL DEFAULT now(),
          updated_at             timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT contacts_phone_source_check CHECK (
            phone_source IS NULL OR phone_source = ANY (ARRAY[
              'apollo_search','apollo_reveal','apollo_cache','lusha_reveal',
              'provider_payload','manual','unknown'])),
          CONSTRAINT contacts_phone_type_check CHECK (
            phone_type IS NULL OR phone_type = ANY (ARRAY[
              'personal_mobile','mobile','direct_dial','work','hq','other','unknown'])),
          CONSTRAINT contacts_phone_confidence_check CHECK (
            phone_confidence IS NULL OR phone_confidence = ANY (ARRAY[
              'unknown','low','medium','high','verified'])));

        ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "active_users_can_read_contacts" ON public.contacts
          FOR SELECT TO authenticated USING (has_active_access(auth.uid()));`);

      // ── Contabilidad y staging (a las que apunta la procedencia) ──
      await q(`
        CREATE TABLE public.provider_usage_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.phone_reveal_waterfall_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.phone_reveal_credit_reservations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.contact_enrichment_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id uuid);
        CREATE TABLE public.contact_enrichment_candidates (
          id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          enrichment_run_id       uuid NOT NULL
            REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
          phone                   text,
          enrichment_metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
          phone_reveal_error_code text,
          apollo_person_id        text);`);

      // ── La cadena real ───────────────────────────────────────────
      await q(readMigration(MIGRATION_099));
      await q(readMigration(MIGRATION_107));
      await q(readMigration(MIGRATION_109));
      await q(readMigration(MIGRATION_112));
      // LA QUE ESTE HITO LEE.
      await q(readMigration(MIGRATION_114));
      // La erasure REAL: los casos F y G la ejecutan en vez de simular un tombstone.
      await q(readMigration(MIGRATION_115));

      // ── Fixtures base ───────────────────────────────────────────
      await q(`INSERT INTO public.accounts (id, name) VALUES ($1, 'ACME Sintetica')`, [
        ACCOUNT_ID,
      ]);
      await q(
        `INSERT INTO public.internal_users (id, auth_user_id, access_status)
         VALUES ($1, $1, 'active'), ($2, $2, 'revoked')`,
        [ACTIVE_USER_ID, REVOKED_USER_ID],
      );

      // Las escrituras se hacen como `service_role`, que es el único rol que la 114 autoriza
      // a poblar la colección: si un fixture necesitara más privilegio que el que tiene el
      // escritor real, el arnés estaría midiendo una tabla que Producción no puede llenar.
      await q('SET ROLE service_role');

      await actAs(ACTIVE_USER_ID);

      const readModule = await import('../official-contact-stored-phones-read');
      readOfficialContactStoredPhones =
        readModule.readOfficialContactStoredPhones as typeof readOfficialContactStoredPhones;
      const coreModule = await import('../official-contact-stored-phones-core');
      countAdditionalStoredOfficialPhones =
        coreModule.countAdditionalStoredOfficialPhones as typeof countAdditionalStoredOfficialPhones;
      selectAdditionalStoredOfficialPhones =
        coreModule.selectAdditionalStoredOfficialPhones as typeof selectAdditionalStoredOfficialPhones;
      const actionsModule = await import('../official-contact-stored-phones-actions');
      getOfficialContactStoredPhoneSummaryAction =
        actionsModule.getOfficialContactStoredPhoneSummaryAction as typeof getOfficialContactStoredPhoneSummaryAction;
      getOfficialContactStoredPhonesAction =
        actionsModule.getOfficialContactStoredPhonesAction as typeof getOfficialContactStoredPhonesAction;
    });

    after(async () => {
      if (session) await session.end().catch(() => {});
      if (admin) await admin.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Helpers de fixture ─────────────────────────────────────────

    let seq = 0;

    async function insertContact(args: {
      phone?: string | null;
      mobilePhone?: string | null;
      phoneSource?: string | null;
    }): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contacts (
           account_id, full_name, email, phone, mobile_phone, phone_type, phone_source,
           phone_raw_type, phone_revealed_at, phone_processing_basis, phone_confidence)
         VALUES ($1,$2,$3,$4,$5,'mobile',$6,'mobile',$7,'legitimate_interest','high')
         RETURNING id`,
        [
          ACCOUNT_ID,
          `Contacto Sintetico ${seq}`,
          `sintetico${seq}@example.invalid`,
          args.phone ?? null,
          args.mobilePhone ?? null,
          args.phoneSource ?? 'apollo_reveal',
          NOW,
        ],
      );
      return rows[0].id as string;
    }

    async function insertPhone(args: {
      contactId: string;
      number: string;
      phoneType?: string;
      phoneStatus?: string;
      isPrimary?: boolean;
      lastSeenAt?: string;
    }): Promise<string> {
      const { rows } = await q(
        `INSERT INTO public.contact_phones (
           contact_id, normalized_phone, display_phone, dedupe_key,
           phone_type, phone_status, is_primary, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
         RETURNING id`,
        [
          args.contactId,
          args.number.replace(/[^\d+]/g, ''),
          args.number,
          phoneKey(args.number),
          args.phoneType ?? 'mobile',
          args.phoneStatus ?? 'valid',
          args.isPrimary ?? false,
          args.lastSeenAt ?? NOW,
        ],
      );
      return rows[0].id as string;
    }

    async function insertSource(args: {
      phoneId: string;
      provider: string;
      acquisitionMode: string;
      eventKey?: string;
    }): Promise<void> {
      await q(
        `INSERT INTO public.contact_phone_sources (
           contact_phone_id, provider, acquisition_mode, source_event_key, observed_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          args.phoneId,
          args.provider,
          args.acquisitionMode,
          args.eventKey ?? `${args.provider}:${args.acquisitionMode}:${args.phoneId}`,
          NOW,
        ],
      );
    }

    /** La erasure REAL de la 115, ejecutada por el rol que la 114 autoriza. */
    async function suppressProvider(args: {
      contactId: string;
      provider: string;
      dedupeKey: string;
      reason: string;
    }): Promise<Record<string, unknown>> {
      const { rows } = await q(
        `SELECT public.suppress_official_contact_phone_sources(
           $1, 'single_provider', $2, $3, $4, $5, now()) AS result`,
        [args.contactId, args.provider, args.dedupeKey, args.reason, ACTIVE_USER_ID],
      );
      return rows[0].result as Record<string, unknown>;
    }

    /** La cadena entera de producción: lectura real + núcleo real. */
    async function readView(contactId: string): Promise<readonly StoredOfficialPhoneView[]> {
      const read = await readOfficialContactStoredPhones(contactId);
      return selectAdditionalStoredOfficialPhones(read as never);
    }

    async function readCount(contactId: string): Promise<number> {
      const read = await readOfficialContactStoredPhones(contactId);
      return countAdditionalStoredOfficialPhones(read as never);
    }

    // ═════════════════════════════════════════════════════════════
    // Caso A — colección vacía
    // ═════════════════════════════════════════════════════════════

    describe('A · sin filas oficiales', () => {
      it('el conteo es 0 y el CTA no existe', async () => {
        const contactId = await insertContact({ phone: '+573005550100' });

        assert.equal(await readCount(contactId), 0);
        // Lo que decide el CTA es este entero: la ficha lo pinta sólo con `> 0`.
        const summary = await getOfficialContactStoredPhoneSummaryAction({ contactId });
        assert.equal(summary.additionalCount, 0);

        // Y la lista sigue siendo una respuesta legítima, no un fallo: `unavailable` diría
        // «no pudimos leer», que es un hecho distinto de «no hay más números».
        const list = await getOfficialContactStoredPhonesAction({ contactId });
        assert.deepEqual(list, { status: 'ok', phones: [] });
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Caso B — sólo el principal
    // ═════════════════════════════════════════════════════════════

    describe('B · una única fila viva, y es la principal', () => {
      it('no hay adicionales', async () => {
        const number = '+573005550101';
        const contactId = await insertContact({ phone: number });
        const phoneId = await insertPhone({ contactId, number, isPrimary: true });
        await insertSource({ phoneId, provider: 'apollo', acquisitionMode: 'reveal' });

        assert.equal(await readCount(contactId), 0);
        assert.equal(
          (await getOfficialContactStoredPhoneSummaryAction({ contactId })).additionalCount,
          0,
        );
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Caso C — principal + un extra
    // ═════════════════════════════════════════════════════════════

    describe('C · principal + una fila viva no principal', () => {
      it('el conteo es 1 y el DTO lleva exactamente ese número', async () => {
        const primary = '+573005550102';
        const extra = '+573005550103';
        const contactId = await insertContact({ phone: primary });
        const primaryId = await insertPhone({ contactId, number: primary, isPrimary: true });
        await insertSource({ phoneId: primaryId, provider: 'apollo', acquisitionMode: 'reveal' });
        const extraId = await insertPhone({
          contactId,
          number: extra,
          phoneType: 'work',
        });
        await insertSource({ phoneId: extraId, provider: 'lusha', acquisitionMode: 'reveal' });

        assert.equal(await readCount(contactId), 1);

        const view = await readView(contactId);
        assert.equal(view.length, 1);
        assert.equal(view[0].id, extraId);
        assert.equal(view[0].number, extra);
        assert.equal(view[0].type, 'work');
        assert.equal(view[0].isPrimary, false);
        assert.deepEqual([...view[0].sources], ['lusha_reveal']);

        // La proyección es lo ÚNICO que puede llegar al navegador: nada de claves de
        // deduplicación, tombstones ni punteros de auditoría.
        assert.deepEqual(Object.keys(view[0]).sort(), [
          'id',
          'isPrimary',
          'number',
          'sources',
          'type',
        ]);

        const action = await getOfficialContactStoredPhonesAction({ contactId });
        assert.equal(action.status, 'ok');
        assert.equal(action.status === 'ok' ? action.phones.length : -1, 1);
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Caso D — principal + varios extras
    // ═════════════════════════════════════════════════════════════

    describe('D · principal + varios extras vivos', () => {
      it('devuelve todos los extras vivos, cada uno UNA vez', async () => {
        const primary = '+573005550110';
        const extras = ['+573005550111', '+573005550112', '+573005550113'];
        const contactId = await insertContact({ phone: primary });
        const primaryId = await insertPhone({ contactId, number: primary, isPrimary: true });
        await insertSource({ phoneId: primaryId, provider: 'apollo', acquisitionMode: 'reveal' });

        const extraIds: string[] = [];
        for (const [index, number] of extras.entries()) {
          const id = await insertPhone({
            contactId,
            number,
            phoneType: ['mobile', 'work', 'hq'][index],
          });
          // Dos procedencias en uno de ellos, para que «cada número una vez» no pueda
          // pasar por casualidad: un JOIN mal escrito duplicaría la fila.
          await insertSource({ phoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });
          if (index === 1) {
            await insertSource({ phoneId: id, provider: 'lusha', acquisitionMode: 'reveal' });
          }
          extraIds.push(id);
        }

        assert.equal(await readCount(contactId), 3);

        const view = await readView(contactId);
        assert.equal(view.length, 3);
        assert.deepEqual([...view].map((phone) => phone.id).sort(), [...extraIds].sort());
        assert.equal(new Set(view.map((phone) => phone.id)).size, 3);
        // El principal NUNCA está entre los adicionales.
        assert.equal(
          view.some((phone) => phone.id === primaryId),
          false,
        );
        // Orden canónico, no el físico: `mobile` va antes que `work` y `work` antes que `hq`.
        assert.deepEqual(
          view.map((phone) => phone.type),
          ['mobile', 'work', 'hq'],
        );
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Casos E → F → G — el mismo número, dos proveedores, y la erasure REAL
    // ═════════════════════════════════════════════════════════════
    //
    // Los tres comparten contacto A PROPÓSITO: son tres momentos de la misma historia —el
    // número observado por dos proveedores, Apollo retirado, y Lusha retirado después—, y
    // partirlos en tres fixtures independientes probaría tres estados iniciales en vez de
    // la transición entre ellos, que es justo lo que la 115 gobierna.

    describe('E, F, G · misma persona, dos procedencias, erasure por proveedor', () => {
      const primary = '+573005550120';
      const shared = '+573005550121';
      let contactId: string;
      let sharedPhoneId: string;

      before(async () => {
        if (!EmbeddedPostgresCtor) return;
        contactId = await insertContact({ phone: primary, phoneSource: 'apollo_reveal' });
        const primaryId = await insertPhone({ contactId, number: primary, isPrimary: true });
        await insertSource({ phoneId: primaryId, provider: 'apollo', acquisitionMode: 'reveal' });

        sharedPhoneId = await insertPhone({ contactId, number: shared, phoneType: 'direct_dial' });
        await insertSource({
          phoneId: sharedPhoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertSource({
          phoneId: sharedPhoneId,
          provider: 'lusha',
          acquisitionMode: 'reveal',
        });
      });

      it('E · un número, DOS procedencias vivas', async () => {
        const { rows } = await q(
          `SELECT count(*)::int AS n FROM public.contact_phones
           WHERE contact_id = $1 AND dedupe_key = $2`,
          [contactId, phoneKey(shared)],
        );
        assert.equal(rows[0].n, 1, 'la 114 colapsa el mismo número en UNA fila canónica');

        const view = await readView(contactId);
        assert.equal(view.length, 1);
        assert.equal(view[0].id, sharedPhoneId);
        // Lista, no fuente única: aplanarlo inventaría una exclusividad que la base no afirma.
        assert.deepEqual([...view[0].sources], ['apollo_reveal', 'lusha_reveal']);
      });

      it('F · retirar Apollo deja el número visible, rotulado sólo con Lusha', async () => {
        const result = await suppressProvider({
          contactId,
          provider: 'apollo',
          dedupeKey: phoneKey(shared),
          reason: 'provider_retraction',
        });
        // Se retira UNA observación y NO se tombstonea ninguna fila: es exactamente la
        // operación que la 114 existe para poder representar.
        assert.equal(result.status, 'suppressed', JSON.stringify(result));
        assert.equal(result.sources_suppressed, 1, JSON.stringify(result));
        assert.equal(result.phones_tombstoned, 0, JSON.stringify(result));

        const { rows } = await q(
          `SELECT suppressed_at IS NULL AS live FROM public.contact_phones WHERE id = $1`,
          [sharedPhoneId],
        );
        assert.equal(rows[0].live, true, 'Lusha sigue sosteniendo el número');

        const view = await readView(contactId);
        assert.equal(view.length, 1);
        assert.equal(view[0].id, sharedPhoneId);
        assert.equal(view[0].number, shared);
        // La procedencia retirada no se rotula «Apollo (retirado)»: deja de existir para
        // quien mira la pantalla, que es lo que la erasure acaba de romper.
        assert.deepEqual([...view[0].sources], ['lusha_reveal']);
      });

      it('G · al caer la ÚLTIMA procedencia el número deja de exponerse', async () => {
        const result = await suppressProvider({
          contactId,
          provider: 'lusha',
          dedupeKey: phoneKey(shared),
          reason: 'data_subject_request',
        });
        assert.equal(result.status, 'suppressed', JSON.stringify(result));
        assert.equal(result.sources_suppressed, 1, JSON.stringify(result));
        assert.equal(result.phones_tombstoned, 1, JSON.stringify(result));

        const { rows } = await q(
          `SELECT suppressed_at IS NOT NULL AS tombstoned, normalized_phone, display_phone
           FROM public.contact_phones WHERE id = $1`,
          [sharedPhoneId],
        );
        assert.equal(rows[0].tombstoned, true, 'sin procedencia viva, la 115 tombstonea la fila');
        assert.equal(rows[0].normalized_phone, null);
        assert.equal(rows[0].display_phone, null);

        assert.equal(await readCount(contactId), 0);
        assert.deepEqual(await readView(contactId), []);
        const list = await getOfficialContactStoredPhonesAction({ contactId });
        assert.deepEqual(list, { status: 'ok', phones: [] });
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Caso H — el escalar ya visible no se repite como «adicional»
    // ═════════════════════════════════════════════════════════════

    describe('H · una fila oficial repite el escalar que la ficha ya muestra', () => {
      it('no se lista dos veces el mismo número, y el genuinamente distinto sí sale', async () => {
        // El escalar se guarda FORMATEADO y la fila canónica sin espacios: si la exclusión
        // comparase cadenas en vez de `dedupe_key`, este caso se le escaparía.
        const scalar = '+57 300 555 0130';
        const sameNumber = '+573005550130';
        const otherNumber = '+573005550131';

        const contactId = await insertContact({ phone: scalar });
        // Deliberadamente NO marcada `is_primary`: la exclusión por escalar tiene que
        // sostenerse por sí sola, sin apoyarse en la marca.
        const duplicateId = await insertPhone({ contactId, number: sameNumber });
        await insertSource({ phoneId: duplicateId, provider: 'apollo', acquisitionMode: 'reveal' });
        const otherId = await insertPhone({ contactId, number: otherNumber, phoneType: 'work' });
        await insertSource({ phoneId: otherId, provider: 'lusha', acquisitionMode: 'reveal' });

        assert.equal(
          phoneKey(scalar),
          phoneKey(sameNumber),
          'precondición: las dos formas comparten clave canónica',
        );

        const view = await readView(contactId);
        assert.equal(view.length, 1);
        assert.equal(view[0].id, otherId);
        assert.equal(
          view.some((phone) => phone.id === duplicateId),
          false,
          'el número que ya está en pantalla no es un número más',
        );
        assert.equal(await readCount(contactId), 1);
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Caso I — el escalar heredado de móvil
    // ═════════════════════════════════════════════════════════════

    describe('I · `mobile_phone` poblado y colección vacía', () => {
      it('H4 no lo saca a la superficie, ni lo lee', async () => {
        const contactId = await insertContact({
          phone: null,
          mobilePhone: '+573005550140',
        });

        const read = await readOfficialContactStoredPhones(contactId);
        assert.deepEqual([...read.phones], []);
        assert.equal(await readCount(contactId), 0);

        // Y no se consulta: lo que la lectura trae como «ya visible» es SÓLO el escalar
        // principal. 4O-E4.1 fija por prueba estática quién puede nombrar el móvil heredado,
        // y un hito de sólo lectura no gasta esa premisa (la convergencia es de H5).
        assert.deepEqual([...read.visibleScalarPhones], [null]);

        const list = await getOfficialContactStoredPhonesAction({ contactId });
        assert.deepEqual(list, { status: 'ok', phones: [] });
      });
    });

    // ═════════════════════════════════════════════════════════════
    // Caso J — quien no puede ver el contacto no ve sus teléfonos
    // ═════════════════════════════════════════════════════════════

    describe('J · usuario sin acceso activo', () => {
      it('no se filtra ni un número, y quien filtra es PostgreSQL', async () => {
        const primary = '+573005550150';
        const extra = '+573005550151';
        const contactId = await insertContact({ phone: primary });
        const primaryId = await insertPhone({ contactId, number: primary, isPrimary: true });
        await insertSource({ phoneId: primaryId, provider: 'apollo', acquisitionMode: 'reveal' });
        const extraId = await insertPhone({ contactId, number: extra, phoneType: 'work' });
        await insertSource({ phoneId: extraId, provider: 'apollo', acquisitionMode: 'reveal' });

        // CONTROL: con el usuario activo el extra SÍ se ve. Sin esto, un fixture roto se
        // presentaría como un control de acceso que funciona.
        assert.equal(await readCount(contactId), 1);

        try {
          await actAs(REVOKED_USER_ID);

          // 1. La ACCIÓN cierra la puerta: usuario interno no activo ⇒ nada.
          assert.deepEqual(await getOfficialContactStoredPhoneSummaryAction({ contactId }), {
            additionalCount: 0,
          });
          assert.deepEqual(await getOfficialContactStoredPhonesAction({ contactId }), {
            status: 'unavailable',
          });

          // 2. Y aunque alguien saltara la acción y llamara a la lectura con el UUID en la
          //    mano, las policies de la 114 devuelven cero filas: la protección no es el
          //    botón que no se pinta.
          const read = await readOfficialContactStoredPhones(contactId);
          assert.deepEqual([...read.phones], []);
          assert.deepEqual([...read.sources], []);
          assert.deepEqual([...read.visibleScalarPhones], [null]);

          // 3. El hecho crudo, sin pasar por ningún módulo del repo: la MISMA consulta bajo
          //    el rol `authenticated` con un usuario revocado devuelve 0 filas donde
          //    `service_role` ve 2.
          const denied = await session.query(
            `SELECT count(*)::int AS n FROM public.contact_phones WHERE contact_id = $1`,
            [contactId],
          );
          assert.equal(denied.rows[0].n, 0);
          const granted = await q(
            `SELECT count(*)::int AS n FROM public.contact_phones WHERE contact_id = $1`,
            [contactId],
          );
          assert.equal(granted.rows[0].n, 2);
        } finally {
          await actAs(ACTIVE_USER_ID);
        }
      });

      it('el rol de la lectura no puede escribir la colección aunque quisiera', async () => {
        // «Sólo lectura» también es un privilegio, no sólo una intención del código: la 114
        // concede a `authenticated` SELECT y nada más sobre las dos tablas.
        const { rows } = await q(`
          SELECT
            has_table_privilege('authenticated', 'public.contact_phones', 'SELECT') AS can_select,
            has_table_privilege('authenticated', 'public.contact_phones', 'INSERT') AS can_insert,
            has_table_privilege('authenticated', 'public.contact_phones', 'UPDATE') AS can_update,
            has_table_privilege('authenticated', 'public.contact_phones', 'DELETE') AS can_delete,
            has_table_privilege('authenticated', 'public.contact_phone_sources', 'SELECT') AS src_select,
            has_table_privilege('authenticated', 'public.contact_phone_sources', 'INSERT') AS src_insert,
            has_table_privilege('authenticated', 'public.contact_phone_sources', 'UPDATE') AS src_update,
            has_table_privilege('authenticated', 'public.contact_phone_sources', 'DELETE') AS src_delete`);
        assert.deepEqual(rows[0], {
          can_select: true,
          can_insert: false,
          can_update: false,
          can_delete: false,
          src_select: true,
          src_insert: false,
          src_update: false,
          src_delete: false,
        });
      });
    });
  },
);
