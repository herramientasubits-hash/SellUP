/**
 * Agente 2A — el esquema OFICIAL de múltiples teléfonos contra PostgreSQL 17 real
 * (AGENT2A-PHONE-REVEAL-4O-H1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana `…-static-4o-h1` fija el CONTRATO: qué dice el SQL. Lo que no puede fijar
 * es la GARANTÍA. «Un tombstone no puede conservar el número», «no puede haber dos
 * principales», «el navegador no puede declarar procedencia» y «la procedencia no se puede
 * reescribir» no son reglas del código: son CHECKs, índices parciales, políticas RLS y
 * privilegios de PostgreSQL. Sólo PostgreSQL puede demostrarlas.
 *
 * Así que aquí la migración se APLICA de verdad, las escrituras ocurren contra un servidor
 * real, los roles son los tres de Supabase con sus default privileges, y lo que se comprueba
 * después es el contenido de las tablas y el código SQLSTATE que devolvió el servidor.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la plataforma, y
 *     `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`, que es lo que hace que toda tabla
 *     nueva de `public` nazca con los ocho privilegios — el agujero que 106/107 tuvieron que
 *     volver a cerrar y que esta migración cierra al nacer;
 *   * `auth.uid()` y `has_active_access()` (002) con `internal_users`, porque la política de
 *     `authenticated` se DERIVA de ellas;
 *   * `contacts` con la RLS REAL de la 039, para poder medir que el alcance del teléfono
 *     sigue al del contacto en vez de duplicarlo;
 *   * las tres tablas de contabilidad y la 109 completa, sólo por sus FK.
 *
 * La reproducción es mínima y deliberada: aplicar la cadena entera arrastra dependencias de
 * plataforma, y los arneses hermanos ya establecieron esta convención — reproducir el punto
 * de partida exacto de lo que se prueba, no el repositorio entero.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni ninguna
 * base remota; no gasta un crédito; no ejecuta ninguna DSAR real. Todos los números son
 * sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito: descargaría un
 * binario de PostgreSQL en cada `npm ci`, incluido el del check obligatorio, que no necesita
 * esta suite. Si el módulo no está resuelto, el archivo se SALTA con un motivo explícito en
 * lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:official-contact-phone-schema:postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete son
 * prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6, la misma de
 * Producción.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contacts → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_114 = '114_official_contact_phones.sql';
const MIGRATION_109 = '109_contact_enrichment_candidate_phones.sql';

/** Códigos de PostgreSQL que estas pruebas distinguen. */
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';

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
  }
} catch {
  harnessSkipReason =
    'embedded-postgres no está instalado (arnés opcional a propósito: `npm install --no-save embedded-postgres@17.6.0-beta.15`)';
}

// ═══════════════════════════════════════════════════════════════
// Datos de prueba — todos sintéticos 555
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const CONTACT_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_CONTACT_ID = '20000000-0000-4000-8000-000000000002';
const HIDDEN_CONTACT_ID = '20000000-0000-4000-8000-000000000003';
const ACTIVE_UID = '30000000-0000-4000-8000-000000000001';
const INACTIVE_UID = '30000000-0000-4000-8000-000000000002';
const UNKNOWN_UID = '39999999-9999-4999-8999-999999999999';
const RUN_ID = '40000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '50000000-0000-4000-8000-000000000001';

const KEY_A = `e164:${'a'.repeat(64)}`;
const KEY_B = `e164:${'b'.repeat(64)}`;
const KEY_C = `e164:${'c'.repeat(64)}`;

const PHONE_A = '+15550000001';
const PHONE_B = '+15550000002';
const PHONE_C = '+15550000003';

describe('4O-H1 — esquema oficial de múltiples teléfonos en PostgreSQL real', { skip: harnessSkipReason }, () => {
  let postgres: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir = '';

  const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
  const q = (sql: string, values?: unknown[]) => client.query(sql, values);

  /**
   * Ejecuta algo dentro de un SAVEPOINT y devuelve el SQLSTATE, o null si tuvo éxito. El
   * savepoint es load-bearing: sin él, el primer error aborta la transacción y todas las
   * sondas siguientes devolverían 25P02 — el test quedaría verde sin haber probado nada.
   */
  let savepoint = 0;
  async function sqlstateOf(fn: () => Promise<unknown>): Promise<string | null> {
    const name = `probe_${savepoint++}`;
    // El bloque de mutaciones corre en AUTOCOMMIT (cada sentencia es su propia
    // transacción, que es justo lo que se quiere para aplicar DDL), y ahí `SAVEPOINT`
    // es un error 25P01. Se detecta en vez de asumirse: sin esto, la sonda fallaría por
    // no poder abrir el savepoint y el fallo se leería como si la guarda hubiera cedido.
    const inTransaction = await q(`SAVEPOINT ${name}`).then(
      () => true,
      () => false,
    );
    try {
      await fn();
      if (inTransaction) await q(`RELEASE SAVEPOINT ${name}`);
      return null;
    } catch (error) {
      if (inTransaction) await q(`ROLLBACK TO SAVEPOINT ${name}`);
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  /** Ejecuta `sql` asumiendo un rol, y devuelve el SQLSTATE o null. */
  async function sqlstateAsRole(role: string, sql: string, uid?: string): Promise<string | null> {
    await q('BEGIN');
    try {
      if (uid !== undefined) {
        await q(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      }
      await q(`SET LOCAL ROLE ${role}`);
      await q(sql);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    } finally {
      await q('ROLLBACK');
    }
  }

  /** Cuenta filas visibles para un rol/uid concreto. */
  async function visibleAs(role: string, uid: string, table: string): Promise<number> {
    await q('BEGIN');
    try {
      await q(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      await q(`SET LOCAL ROLE ${role}`);
      const { rows } = await q(`SELECT count(*)::int AS n FROM public.${table}`);
      return rows[0].n as number;
    } finally {
      await q('ROLLBACK');
    }
  }

  const insertPhone = (
    contactId: string,
    dedupeKey: string,
    phone: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    const columns = ['contact_id', 'dedupe_key', 'normalized_phone', 'display_phone', 'phone_type'];
    const values: unknown[] = [contactId, dedupeKey, phone, phone, 'mobile'];
    for (const [key, value] of Object.entries(extra)) {
      columns.push(key);
      values.push(value);
    }
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    return q(
      `INSERT INTO public.contact_phones (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  };

  const insertSource = (
    phoneId: string,
    provider: string,
    mode: string,
    eventKey: string,
    extra: Record<string, unknown> = {},
  ) => {
    const columns = ['contact_phone_id', 'provider', 'acquisition_mode', 'source_event_key'];
    const values: unknown[] = [phoneId, provider, mode, eventKey];
    for (const [key, value] of Object.entries(extra)) {
      columns.push(key);
      values.push(value);
    }
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    return q(
      `INSERT INTO public.contact_phone_sources (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  };

  /** Devuelve la colección a un estado conocido. */
  async function reset() {
    await q('DELETE FROM public.contact_phones');
  }

  /**
   * Aplica una COPIA MUTADA de la migración sobre tablas RENOMBRADAS, para comprobar que
   * cada guarda es load-bearing. Devuelve el sufijo con el que se crearon.
   */
  async function applyMutated(suffix: string, mutate: (sql: string) => string): Promise<void> {
    const original = readMigration(MIGRATION_114);
    const mutated = mutate(original);
    // Se compara ANTES de renombrar: el renombrado cambia el texto siempre, así que
    // compararlo después haría pasar una mutación que en realidad no tocó nada.
    assert.notEqual(mutated, original, 'la mutación no cambió nada: no probaría nada');
    const renamed = mutated
      .replaceAll('contact_phone_sources', `contact_phone_sources_${suffix}`)
      .replaceAll('contact_phones', `contact_phones_${suffix}`);
    await q(renamed);
  }

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oh1-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54401,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();

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

    // ── set_updated_at (migración 038), que la 114 reutiliza ─────
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
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_user_id uuid,
        access_status text NOT NULL DEFAULT 'active');
      CREATE OR REPLACE FUNCTION has_active_access(p_auth_user_id UUID) RETURNS BOOLEAN AS $$
        SELECT EXISTS(
          SELECT 1 FROM internal_users
          WHERE auth_user_id = p_auth_user_id AND access_status = 'active');
      $$ LANGUAGE sql STABLE;`);

    // ── accounts + contacts con la RLS REAL de la 039 ────────────
    await q(`
      CREATE TABLE public.accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);

      CREATE TABLE public.contacts (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        full_name    text NOT NULL,
        phone        text,
        mobile_phone text,
        phone_type   text,
        phone_source text,
        phone_raw_type text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now());

      ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "active_users_can_read_contacts" ON public.contacts
        FOR SELECT TO authenticated USING (has_active_access(auth.uid()));`);

    // ── Contabilidad y staging, sólo por sus FK ──────────────────
    await q(`
      CREATE TABLE public.phone_reveal_waterfall_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.phone_reveal_credit_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.provider_usage_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.contact_enrichment_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.contact_enrichment_candidates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        enrichment_run_id uuid NOT NULL
          REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
        phone text,
        enrichment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb);`);

    // La 109 TAL CUAL: la 114 apunta a su tabla canónica.
    await q(readMigration(MIGRATION_109));

    // ── LA MIGRACIÓN BAJO PRUEBA ─────────────────────────────────
    await q(readMigration(MIGRATION_114));

    // ── Fixtures ────────────────────────────────────────────────
    await q(`INSERT INTO public.accounts (id, name) VALUES ($1, 'ACME')`, [ACCOUNT_ID]);
    await q(
      `INSERT INTO public.contacts (id, account_id, full_name)
       VALUES ($1, $4, 'Visible'), ($2, $4, 'Other'), ($3, $4, 'Hidden')`,
      [CONTACT_ID, OTHER_CONTACT_ID, HIDDEN_CONTACT_ID, ACCOUNT_ID],
    );
    await q(
      `INSERT INTO public.internal_users (auth_user_id, access_status)
       VALUES ($1, 'active'), ($2, 'revoked')`,
      [ACTIVE_UID, INACTIVE_UID],
    );
    await q(`INSERT INTO public.contact_enrichment_runs (id) VALUES ($1)`, [RUN_ID]);
    await q(
      `INSERT INTO public.contact_enrichment_candidates (id, enrichment_run_id) VALUES ($1, $2)`,
      [CANDIDATE_ID, RUN_ID],
    );
  });

  after(async () => {
    if (client) await client.end().catch(() => {});
    if (postgres) await postgres.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // Existencia y aplicabilidad
  // ═══════════════════════════════════════════════════════════════

  describe('aplicación', () => {
    it('la migración aplica limpia sobre la cadena actual', async () => {
      // Ya ocurrió en `before`; si hubiera fallado, la suite entera no habría arrancado.
      const { rows } = await q(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('contact_phones', 'contact_phone_sources')
        ORDER BY table_name`);
      assert.deepEqual(
        rows.map((row) => row.table_name),
        ['contact_phone_sources', 'contact_phones'],
      );
    });

    it('es idempotente: reaplicarla no falla ni cambia los privilegios', async () => {
      const before = await q(`
        SELECT relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'contact_phone_sources'`);
      await q(readMigration(MIGRATION_114));
      const after = await q(`
        SELECT relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'contact_phone_sources'`);
      assert.equal(after.rows[0].acl, before.rows[0].acl);
    });

    it('no inserta NI UNA fila: las dos tablas nacen vacías', async () => {
      // Se mide antes de cualquier fixture de fila, así que la cuenta es la de la migración.
      const phones = await q(`SELECT count(*)::int AS n FROM public.contact_phones`);
      const sources = await q(`SELECT count(*)::int AS n FROM public.contact_phone_sources`);
      assert.equal(phones.rows[0].n, 0);
      assert.equal(sources.rows[0].n, 0);
    });

    it('las columnas son exactamente las esperadas', async () => {
      const columnsOf = async (table: string) => {
        const { rows } = await q(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 ORDER BY column_name`,
          [table],
        );
        return rows.map((row) => row.column_name);
      };
      assert.deepEqual(await columnsOf('contact_phones'), [
        'contact_id',
        'created_at',
        'dedupe_key',
        'display_phone',
        'first_seen_at',
        'id',
        'is_primary',
        'last_seen_at',
        'normalized_phone',
        'phone_status',
        'phone_type',
        'suppressed_at',
        'suppressed_by',
        'suppression_reason',
        'updated_at',
      ]);
      assert.deepEqual(await columnsOf('contact_phone_sources'), [
        'acquisition_mode',
        'candidate_phone_id',
        'contact_phone_id',
        'created_at',
        'id',
        'observed_at',
        'provider',
        'provider_usage_log_id',
        'raw_provider_status',
        'raw_provider_type',
        'reservation_id',
        'source_event_key',
        'suppressed_at',
        'suppressed_by',
        'suppression_reason',
        'waterfall_run_id',
      ]);
    });

    it('NO existe una columna account_id', async () => {
      const { rows } = await q(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='account_id'
           AND table_name IN ('contact_phones','contact_phone_sources')`,
      );
      assert.deepEqual(rows, []);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Integridad referencial
  // ═══════════════════════════════════════════════════════════════

  describe('claves ajenas', () => {
    before(() => q('BEGIN'));
    after(() => q('ROLLBACK'));

    it('un teléfono sin contacto es rechazado', async () => {
      assert.equal(
        await sqlstateOf(() =>
          insertPhone('99999999-9999-4999-8999-999999999999', KEY_A, PHONE_A),
        ),
        FK_VIOLATION,
      );
    });

    it('una procedencia sin teléfono es rechazada', async () => {
      assert.equal(
        await sqlstateOf(() =>
          insertSource('99999999-9999-4999-8999-999999999999', 'apollo', 'reveal', 'v1:x'),
        ),
        FK_VIOLATION,
      );
    });

    it('borrar el CONTACTO cascada a teléfonos y a sus procedencias', async () => {
      const { rows } = await insertPhone(OTHER_CONTACT_ID, KEY_C, PHONE_C);
      await insertSource(rows[0].id as string, 'apollo', 'reveal', 'v1:cascade');
      await q('DELETE FROM public.contacts WHERE id = $1', [OTHER_CONTACT_ID]);
      const phones = await q('SELECT count(*)::int AS n FROM public.contact_phones WHERE contact_id = $1', [
        OTHER_CONTACT_ID,
      ]);
      const sources = await q(
        'SELECT count(*)::int AS n FROM public.contact_phone_sources WHERE source_event_key = $1',
        ['v1:cascade'],
      );
      assert.equal(phones.rows[0].n, 0);
      assert.equal(sources.rows[0].n, 0);
    });

    it('borrar la fila de STAGING deja NULL el puntero y NO borra la oficial', async () => {
      // Ésta es la propiedad por la que 4O-H0 rechazó staging-como-almacén: la fila oficial
      // debe sobrevivir a que el candidato desaparezca. Con CASCADE, purgar staging borraría
      // la procedencia de un número ya pagado.
      const candidatePhone = await q(
        `INSERT INTO public.contact_enrichment_candidate_phones (candidate_id, dedupe_key)
         VALUES ($1, $2) RETURNING id`,
        [CANDIDATE_ID, KEY_A],
      );
      const official = await insertPhone(CONTACT_ID, KEY_B, PHONE_B);
      await insertSource(official.rows[0].id as string, 'apollo', 'reveal', 'v1:promoted', {
        candidate_phone_id: candidatePhone.rows[0].id,
      });

      await q('DELETE FROM public.contact_enrichment_candidate_phones WHERE id = $1', [
        candidatePhone.rows[0].id,
      ]);

      const { rows } = await q(
        `SELECT candidate_phone_id FROM public.contact_phone_sources WHERE source_event_key = $1`,
        ['v1:promoted'],
      );
      assert.equal(rows.length, 1, 'la procedencia oficial no sobrevivió a la purga de staging');
      assert.equal(rows[0].candidate_phone_id, null);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Identidad canónica
  // ═══════════════════════════════════════════════════════════════

  describe('deduplicación canónica', () => {
    before(() => q('BEGIN'));
    after(() => q('ROLLBACK'));

    it('el mismo contacto no admite dos filas con la misma dedupe_key', async () => {
      await insertPhone(CONTACT_ID, KEY_A, PHONE_A);
      assert.equal(
        await sqlstateOf(() => insertPhone(CONTACT_ID, KEY_A, PHONE_A)),
        UNIQUE_VIOLATION,
      );
    });

    it('DOS contactos SÍ pueden tener el mismo número', async () => {
      // Dos personas comparten el conmutador de su empresa: es un hecho, no un duplicado.
      assert.equal(await sqlstateOf(() => insertPhone(HIDDEN_CONTACT_ID, KEY_A, PHONE_A)), null);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Un solo principal, y vivo
  // ═══════════════════════════════════════════════════════════════

  describe('principal', () => {
    before(() => q('BEGIN'));
    after(() => q('ROLLBACK'));

    it('no puede haber DOS principales en el mismo contacto', async () => {
      await insertPhone(CONTACT_ID, KEY_A, PHONE_A, { is_primary: true });
      assert.equal(
        await sqlstateOf(() => insertPhone(CONTACT_ID, KEY_B, PHONE_B, { is_primary: true })),
        UNIQUE_VIOLATION,
      );
    });

    it('DOS contactos SÍ pueden tener cada uno su principal', async () => {
      assert.equal(
        await sqlstateOf(() => insertPhone(HIDDEN_CONTACT_ID, KEY_C, PHONE_C, { is_primary: true })),
        null,
      );
    });

    it('un principal SIN número es rechazado', async () => {
      assert.equal(
        await sqlstateOf(() =>
          q(
            `INSERT INTO public.contact_phones (contact_id, dedupe_key, is_primary)
             VALUES ($1, $2, true)`,
            [OTHER_CONTACT_ID, `e164:${'d'.repeat(64)}`],
          ),
        ),
        CHECK_VIOLATION,
      );
    });

    it('un principal declarado INVÁLIDO es rechazado', async () => {
      assert.equal(
        await sqlstateOf(() =>
          insertPhone(OTHER_CONTACT_ID, `e164:${'e'.repeat(64)}`, PHONE_B, {
            is_primary: true,
            phone_status: 'invalid',
          }),
        ),
        CHECK_VIOLATION,
      );
    });

    it('un principal TOMBSTONEADO es rechazado', async () => {
      assert.equal(
        await sqlstateOf(() =>
          q(
            `UPDATE public.contact_phones
                SET suppressed_at = now(), suppression_reason = 'data_subject_request',
                    normalized_phone = NULL, display_phone = NULL, phone_type = NULL
              WHERE contact_id = $1 AND is_primary`,
            [CONTACT_ID],
          ),
        ),
        CHECK_VIOLATION,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Tombstone
  // ═══════════════════════════════════════════════════════════════

  describe('tombstone', () => {
    before(() => q('BEGIN'));
    after(() => q('ROLLBACK'));

    it('un tombstone NO puede conservar el número, el display, el tipo ni el principal', async () => {
      const { rows } = await insertPhone(CONTACT_ID, KEY_A, PHONE_A);
      const id = rows[0].id as string;
      const partial = [
        ['normalized_phone', `display_phone = NULL, phone_type = NULL, is_primary = false`],
        ['display_phone', `normalized_phone = NULL, phone_type = NULL, is_primary = false`],
        ['phone_type', `normalized_phone = NULL, display_phone = NULL, is_primary = false`],
      ] as const;
      for (const [kept, cleared] of partial) {
        assert.equal(
          await sqlstateOf(() =>
            q(
              `UPDATE public.contact_phones
                  SET suppressed_at = now(), suppression_reason = 'data_subject_request', ${cleared}
                WHERE id = $1`,
              [id],
            ),
          ),
          CHECK_VIOLATION,
          `un tombstone conservó ${kept}`,
        );
      }
    });

    it('la tríada de supresión debe ser coherente', async () => {
      const { rows } = await insertPhone(CONTACT_ID, KEY_B, PHONE_B);
      const id = rows[0].id as string;

      assert.equal(
        await sqlstateOf(() =>
          q(`UPDATE public.contact_phones SET suppressed_by = $2 WHERE id = $1`, [id, ACTIVE_UID]),
        ),
        CHECK_VIOLATION,
        'un actor sin supresión pasó',
      );

      assert.equal(
        await sqlstateOf(() =>
          q(
            `UPDATE public.contact_phones
                SET suppressed_at = now(), normalized_phone = NULL, display_phone = NULL,
                    phone_type = NULL, is_primary = false
              WHERE id = $1`,
            [id],
          ),
        ),
        CHECK_VIOLATION,
        'una supresión sin motivo pasó',
      );
    });

    it('un tombstone completo es aceptado y CONSERVA la dedupe_key', async () => {
      const { rows } = await insertPhone(CONTACT_ID, KEY_C, PHONE_C);
      const id = rows[0].id as string;
      assert.equal(
        await sqlstateOf(() =>
          q(
            `UPDATE public.contact_phones
                SET suppressed_at = now(), suppression_reason = 'data_subject_request',
                    suppressed_by = $2, normalized_phone = NULL, display_phone = NULL,
                    phone_type = NULL, is_primary = false
              WHERE id = $1`,
            [id, ACTIVE_UID],
          ),
        ),
        null,
      );
      const { rows: after } = await q(
        `SELECT dedupe_key, normalized_phone FROM public.contact_phones WHERE id = $1`,
        [id],
      );
      assert.equal(after[0].dedupe_key, KEY_C);
      assert.equal(after[0].normalized_phone, null);
    });

    it('un número tombstoneado NO puede volver a insertarse (§ 30)', async () => {
      // El tombstone conserva la identidad, y la identidad es el bloqueo. Si esto pasara,
      // una supresión ejecutada hoy quedaría deshecha por la siguiente observación.
      assert.equal(
        await sqlstateOf(() => insertPhone(CONTACT_ID, KEY_C, PHONE_C)),
        UNIQUE_VIOLATION,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Procedencia cruzada e idempotencia
  // ═══════════════════════════════════════════════════════════════

  describe('procedencia', () => {
    let phoneId = '';
    let otherPhoneId = '';

    before(async () => {
      await q('BEGIN');
      const a = await insertPhone(CONTACT_ID, KEY_A, PHONE_A);
      const b = await insertPhone(CONTACT_ID, KEY_B, PHONE_B);
      phoneId = a.rows[0].id as string;
      otherPhoneId = b.rows[0].id as string;
    });
    after(() => q('ROLLBACK'));

    it('el MISMO número admite procedencias de Apollo Y de Lusha a la vez (§ 23)', async () => {
      assert.equal(
        await sqlstateOf(() => insertSource(phoneId, 'apollo', 'reveal', 'v1:apollo:reveal:a')),
        null,
      );
      assert.equal(
        await sqlstateOf(() => insertSource(phoneId, 'lusha', 'reveal', 'v1:lusha:reveal:a')),
        null,
      );
      const { rows } = await q(
        `SELECT provider FROM public.contact_phone_sources
         WHERE contact_phone_id = $1 ORDER BY provider`,
        [phoneId],
      );
      assert.deepEqual(
        rows.map((row) => row.provider),
        ['apollo', 'lusha'],
      );
      // Y sigue siendo UNA sola fila canónica: es el punto del modelo.
      const canonical = await q(
        `SELECT count(*)::int AS n FROM public.contact_phones WHERE dedupe_key = $1 AND contact_id = $2`,
        [KEY_A, CONTACT_ID],
      );
      assert.equal(canonical.rows[0].n, 1);
    });

    it('la MISMA observación registrada dos veces es UNA fila (§ 24)', async () => {
      assert.equal(
        await sqlstateOf(() => insertSource(phoneId, 'apollo', 'reveal', 'v1:apollo:reveal:a')),
        UNIQUE_VIOLATION,
      );
    });

    it('la misma clave de evento en OTRO número sí es otra observación', async () => {
      assert.equal(
        await sqlstateOf(() => insertSource(otherPhoneId, 'apollo', 'reveal', 'v1:apollo:reveal:a')),
        null,
      );
    });

    it('admite provider = manual, para H5, sin insertarlo H1', async () => {
      assert.equal(
        await sqlstateOf(() => insertSource(otherPhoneId, 'manual', 'manual', 'v1:manual:x')),
        null,
      );
    });

    it('rechaza un proveedor del vocabulario escalar heredado', async () => {
      for (const fused of ['apollo_reveal', 'lusha_reveal', 'provider_payload']) {
        assert.equal(
          await sqlstateOf(() => insertSource(otherPhoneId, fused, 'reveal', `v1:${fused}`)),
          CHECK_VIOLATION,
          `provider admitió el fusionado ${fused}`,
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // La ADAPTACIÓN: retirada por proveedor sin DELETE (§ 27–§ 29)
  // ═══════════════════════════════════════════════════════════════

  describe('retirada de una procedencia', () => {
    let phoneId = '';

    before(async () => {
      await q('BEGIN');
      const phone = await insertPhone(CONTACT_ID, KEY_A, PHONE_A);
      phoneId = phone.rows[0].id as string;
      await insertSource(phoneId, 'apollo', 'reveal', 'v1:apollo', { raw_provider_type: 'mobile' });
      await insertSource(phoneId, 'lusha', 'reveal', 'v1:lusha', { raw_provider_type: 'mobile' });
    });
    after(() => q('ROLLBACK'));

    it('se puede retirar SÓLO la observación de un proveedor', async () => {
      assert.equal(
        await sqlstateOf(() =>
          q(
            `UPDATE public.contact_phone_sources
                SET suppressed_at = now(), suppression_reason = 'provider_retraction',
                    suppressed_by = $2
              WHERE contact_phone_id = $1 AND provider = 'apollo'`,
            [phoneId, ACTIVE_UID],
          ),
        ),
        null,
      );
      const { rows } = await q(
        `SELECT provider, suppressed_at IS NOT NULL AS withdrawn
         FROM public.contact_phone_sources WHERE contact_phone_id = $1 ORDER BY provider`,
        [phoneId],
      );
      assert.deepEqual(rows, [
        { provider: 'apollo', withdrawn: true },
        { provider: 'lusha', withdrawn: false },
      ]);
    });

    it('la fila retirada CONSERVA todos los hechos de procedencia', async () => {
      // Retirar no es borrar: la fila es la evidencia de que la observación ocurrió y de qué
      // operación la pagó, que es justo el registro que una operación de privacidad tiene que
      // poder mostrar después.
      const { rows } = await q(
        `SELECT provider, acquisition_mode, raw_provider_type, source_event_key
         FROM public.contact_phone_sources
         WHERE contact_phone_id = $1 AND provider = 'apollo'`,
        [phoneId],
      );
      assert.deepEqual(rows[0], {
        provider: 'apollo',
        acquisition_mode: 'reveal',
        raw_provider_type: 'mobile',
        source_event_key: 'v1:apollo',
      });
    });

    it('«queda alguna fuente viva» es una consulta que H2 puede hacer sin columnas nuevas', async () => {
      const liveSources = await q(
        `SELECT count(*)::int AS n FROM public.contact_phone_sources
         WHERE contact_phone_id = $1 AND suppressed_at IS NULL`,
        [phoneId],
      );
      assert.equal(liveSources.rows[0].n, 1, 'Lusha debería seguir justificando el número');

      // Retirada la última, el número deja de estar justificado y H2 lo tombstonea. Que la
      // secuencia completa sea posible con este esquema es la condición de cierre del hito.
      await q(
        `UPDATE public.contact_phone_sources
            SET suppressed_at = now(), suppression_reason = 'data_subject_request'
          WHERE contact_phone_id = $1 AND suppressed_at IS NULL`,
        [phoneId],
      );
      const remaining = await q(
        `SELECT count(*)::int AS n FROM public.contact_phone_sources
         WHERE contact_phone_id = $1 AND suppressed_at IS NULL`,
        [phoneId],
      );
      assert.equal(remaining.rows[0].n, 0);

      assert.equal(
        await sqlstateOf(() =>
          q(
            `UPDATE public.contact_phones
                SET suppressed_at = now(), suppression_reason = 'data_subject_request',
                    normalized_phone = NULL, display_phone = NULL, phone_type = NULL,
                    is_primary = false
              WHERE id = $1`,
            [phoneId],
          ),
        ),
        null,
        'H2 no pudo tombstonear el número tras retirarse la última fuente',
      );
    });

    it('la tríada de la procedencia también debe ser coherente', async () => {
      // Fuente NUEVA y viva a propósito: las de los tests anteriores ya están retiradas, y
      // sobre una fila ya retirada añadir `suppressed_by` SÍ es coherente. Reutilizarlas
      // dejaría el test verde sin haber ejercido la guarda.
      const fresh = await insertSource(phoneId, 'apollo_cache', 'cache', 'v1:fresh');
      assert.equal(
        await sqlstateOf(() =>
          q(
            `UPDATE public.contact_phone_sources SET suppressed_by = $2 WHERE id = $1`,
            [fresh.rows[0].id, ACTIVE_UID],
          ),
        ),
        CHECK_VIOLATION,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Privilegios reales
  // ═══════════════════════════════════════════════════════════════

  describe('privilegios de tabla', () => {
    it('el catálogo de GRANTs está congelado', async () => {
      for (const [table, expected] of [
        ['contact_phones', { authenticated: 'SELECT', service_role: 'INSERT,SELECT,UPDATE' }],
        ['contact_phone_sources', { authenticated: 'SELECT', service_role: 'INSERT,SELECT' }],
      ] as const) {
        const { rows } = await q(
          `SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS g
           FROM information_schema.role_table_grants
           WHERE table_schema='public' AND table_name=$1 AND grantee <> 'postgres'
           GROUP BY grantee ORDER BY grantee`,
          [table],
        );
        const actual = Object.fromEntries(rows.map((row) => [row.grantee, row.g]));
        assert.deepEqual(actual, expected, `los GRANTs de ${table} cambiaron`);
      }
    });

    it('anon y PUBLIC no tienen NADA en ninguna de las dos tablas', async () => {
      const { rows } = await q(`
        SELECT table_name, grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema='public'
          AND table_name IN ('contact_phones','contact_phone_sources')
          AND grantee IN ('anon','PUBLIC')`);
      assert.deepEqual(rows, []);
    });

    it('la tercera vía: has_table_privilege coincide', async () => {
      for (const table of ['contact_phones', 'contact_phone_sources']) {
        for (const [role, privilege, expected] of [
          ['anon', 'SELECT', false],
          ['authenticated', 'SELECT', true],
          ['authenticated', 'INSERT', false],
          ['authenticated', 'UPDATE', false],
          ['authenticated', 'DELETE', false],
          ['service_role', 'SELECT', true],
          ['service_role', 'INSERT', true],
          ['service_role', 'DELETE', false],
          ['service_role', 'TRUNCATE', false],
          ['service_role', 'REFERENCES', false],
          ['service_role', 'TRIGGER', false],
        ] as const) {
          const { rows } = await q(
            `SELECT has_table_privilege($1, $2, $3) AS ok`,
            [role, `public.${table}`, privilege],
          );
          assert.equal(
            rows[0].ok,
            expected,
            `${role} / ${privilege} / ${table} debía ser ${expected}`,
          );
        }
      }
    });

    it('service_role tiene UPDATE de tabla en la canónica y NO en las procedencias', async () => {
      const canonical = await q(
        `SELECT has_table_privilege('service_role', 'public.contact_phones', 'UPDATE') AS ok`,
      );
      assert.equal(canonical.rows[0].ok, true);
      const sources = await q(
        `SELECT has_table_privilege('service_role', 'public.contact_phone_sources', 'UPDATE') AS ok`,
      );
      assert.equal(
        sources.rows[0].ok,
        false,
        'un UPDATE de TABLA en las procedencias haría reescribible la procedencia',
      );
    });

    it('el UPDATE por COLUMNA en procedencias es exactamente la tríada', async () => {
      const { rows } = await q(`
        SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema='public' AND table_name='contact_phone_sources'
          AND grantee='service_role' AND privilege_type='UPDATE'
        ORDER BY column_name`);
      assert.deepEqual(
        rows.map((row) => row.column_name),
        ['suppressed_at', 'suppressed_by', 'suppression_reason'],
      );
    });
  });

  describe('privilegios en ejecución', () => {
    let phoneId = '';

    before(async () => {
      await reset();
      const phone = await insertPhone(CONTACT_ID, KEY_A, PHONE_A);
      phoneId = phone.rows[0].id as string;
      await insertSource(phoneId, 'apollo', 'reveal', 'v1:runtime');
    });
    after(() => reset());

    it('anon no puede hacer NADA', async () => {
      for (const [label, sql] of [
        ['select', `SELECT * FROM public.contact_phones`],
        ['insert', `INSERT INTO public.contact_phones (contact_id, dedupe_key) VALUES ('${CONTACT_ID}', 'e164:zz')`],
        ['update', `UPDATE public.contact_phones SET last_seen_at = now()`],
        ['delete', `DELETE FROM public.contact_phones`],
        ['truncate', `TRUNCATE public.contact_phones`],
        ['select sources', `SELECT * FROM public.contact_phone_sources`],
      ] as const) {
        assert.equal(
          await sqlstateAsRole('anon', sql),
          INSUFFICIENT_PRIVILEGE,
          `anon pudo ${label}`,
        );
      }
    });

    it('authenticated puede LEER y nada más', async () => {
      assert.equal(
        await sqlstateAsRole('authenticated', `SELECT * FROM public.contact_phones`, ACTIVE_UID),
        null,
      );
      for (const [label, sql] of [
        ['insert', `INSERT INTO public.contact_phones (contact_id, dedupe_key) VALUES ('${CONTACT_ID}', 'e164:zz')`],
        ['update', `UPDATE public.contact_phones SET last_seen_at = now()`],
        ['delete', `DELETE FROM public.contact_phones`],
        ['truncate', `TRUNCATE public.contact_phones`],
        ['insert source', `INSERT INTO public.contact_phone_sources (contact_phone_id, provider, acquisition_mode, source_event_key) VALUES ('${phoneId}', 'manual', 'manual', 'v1:browser')`],
        ['update source', `UPDATE public.contact_phone_sources SET suppressed_at = now()`],
      ] as const) {
        assert.equal(
          await sqlstateAsRole('authenticated', sql, ACTIVE_UID),
          INSUFFICIENT_PRIVILEGE,
          `authenticated pudo ${label}: el navegador no puede declarar procedencia`,
        );
      }
    });

    it('service_role NO puede borrar filas ni reescribir procedencia', async () => {
      assert.equal(
        await sqlstateAsRole('service_role', `DELETE FROM public.contact_phones`),
        INSUFFICIENT_PRIVILEGE,
        'borrar un tombstone desbloquearía el número suprimido',
      );
      assert.equal(
        await sqlstateAsRole('service_role', `DELETE FROM public.contact_phone_sources`),
        INSUFFICIENT_PRIVILEGE,
      );
      for (const column of [
        `provider = 'lusha'`,
        `acquisition_mode = 'search'`,
        `raw_provider_type = 'x'`,
        `source_event_key = 'v1:rewritten'`,
        `observed_at = now()`,
        `candidate_phone_id = NULL`,
        `waterfall_run_id = NULL`,
      ]) {
        assert.equal(
          await sqlstateAsRole(
            'service_role',
            `UPDATE public.contact_phone_sources SET ${column}`,
          ),
          INSUFFICIENT_PRIVILEGE,
          `service_role pudo reescribir ${column}`,
        );
      }
    });

    it('service_role SÍ puede retirar una procedencia (la tríada)', async () => {
      assert.equal(
        await sqlstateAsRole(
          'service_role',
          `UPDATE public.contact_phone_sources
             SET suppressed_at = now(), suppression_reason = 'provider_retraction'`,
        ),
        null,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RLS — nunca más ancha que `contacts`
  // ═══════════════════════════════════════════════════════════════

  describe('RLS', () => {
    before(async () => {
      await reset();
      const visible = await insertPhone(CONTACT_ID, KEY_A, PHONE_A);
      const hidden = await insertPhone(HIDDEN_CONTACT_ID, KEY_B, PHONE_B);
      await insertSource(visible.rows[0].id as string, 'apollo', 'reveal', 'v1:visible');
      await insertSource(hidden.rows[0].id as string, 'apollo', 'reveal', 'v1:hidden');
    });
    after(() => reset());

    it('RLS está habilitada en las dos tablas', async () => {
      const { rows } = await q(`
        SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND relname IN ('contact_phones','contact_phone_sources')
        ORDER BY relname`);
      assert.deepEqual(rows, [
        { relname: 'contact_phone_sources', relrowsecurity: true },
        { relname: 'contact_phones', relrowsecurity: true },
      ]);
    });

    it('las políticas son las cuatro esperadas y ninguna más', async () => {
      const { rows } = await q(`
        SELECT tablename, policyname, cmd, roles::text AS roles
        FROM pg_policies
        WHERE schemaname='public' AND tablename IN ('contact_phones','contact_phone_sources')
        ORDER BY tablename, policyname`);
      assert.deepEqual(rows, [
        {
          tablename: 'contact_phone_sources',
          policyname: 'active_users_can_read_contact_phone_sources',
          cmd: 'SELECT',
          roles: '{authenticated}',
        },
        {
          tablename: 'contact_phone_sources',
          policyname: 'contact_phone_sources_service_role',
          cmd: 'ALL',
          roles: '{service_role}',
        },
        {
          tablename: 'contact_phones',
          policyname: 'active_users_can_read_contact_phones',
          cmd: 'SELECT',
          roles: '{authenticated}',
        },
        {
          tablename: 'contact_phones',
          policyname: 'contact_phones_service_role',
          cmd: 'ALL',
          roles: '{service_role}',
        },
      ]);
    });

    it('un usuario ACTIVO ve la colección y su procedencia', async () => {
      assert.equal(await visibleAs('authenticated', ACTIVE_UID, 'contact_phones'), 2);
      assert.equal(await visibleAs('authenticated', ACTIVE_UID, 'contact_phone_sources'), 2);
    });

    it('un usuario REVOCADO no ve nada', async () => {
      assert.equal(await visibleAs('authenticated', INACTIVE_UID, 'contact_phones'), 0);
      assert.equal(await visibleAs('authenticated', INACTIVE_UID, 'contact_phone_sources'), 0);
    });

    it('un uid DESCONOCIDO no ve nada', async () => {
      assert.equal(await visibleAs('authenticated', UNKNOWN_UID, 'contact_phones'), 0);
      assert.equal(await visibleAs('authenticated', UNKNOWN_UID, 'contact_phone_sources'), 0);
    });

    it('si el CONTACTO deja de ser visible, su teléfono y su procedencia también (§ 32)', async () => {
      // Ésta es la prueba de que el alcance se DERIVA del padre en vez de duplicar
      // `has_active_access`. Se estrecha la política de `contacts` —y sólo ésa— y se mide si
      // el teléfono la sigue. Si alguien sustituyera el EXISTS por un `has_active_access`
      // suelto, este test seguiría viendo 2 y fallaría.
      await q(`DROP POLICY "active_users_can_read_contacts" ON public.contacts`);
      await q(`CREATE POLICY "active_users_can_read_contacts" ON public.contacts
        FOR SELECT TO authenticated
        USING (has_active_access(auth.uid()) AND full_name <> 'Hidden')`);
      try {
        assert.equal(await visibleAs('authenticated', ACTIVE_UID, 'contacts'), 2);
        assert.equal(
          await visibleAs('authenticated', ACTIVE_UID, 'contact_phones'),
          1,
          'el teléfono de un contacto invisible siguió siendo legible',
        );
        assert.equal(
          await visibleAs('authenticated', ACTIVE_UID, 'contact_phone_sources'),
          1,
          'la procedencia de un teléfono invisible siguió siendo legible',
        );
      } finally {
        await q(`DROP POLICY "active_users_can_read_contacts" ON public.contacts`);
        await q(`CREATE POLICY "active_users_can_read_contacts" ON public.contacts
          FOR SELECT TO authenticated USING (has_active_access(auth.uid()))`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Sensibilidad a mutaciones — cada guarda es load-bearing
  // ═══════════════════════════════════════════════════════════════

  describe('mutaciones', () => {
    it('sin la UNIQUE canónica, el mismo número se duplica', async () => {
      await applyMutated('m1', (sql) =>
        sql.replace(
          'CONSTRAINT contact_phones_contact_dedupe_key_unique\n    UNIQUE (contact_id, dedupe_key),',
          '',
        ),
      );
      await q(
        `INSERT INTO public.contact_phones_m1 (contact_id, dedupe_key, normalized_phone)
         VALUES ($1, $2, $3), ($1, $2, $3)`,
        [CONTACT_ID, KEY_A, PHONE_A],
      );
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM public.contact_phones_m1 WHERE dedupe_key = $1`,
        [KEY_A],
      );
      assert.equal(rows[0].n, 2, 'la mutación no cambió el comportamiento: la guarda no era load-bearing');
    });

    it('sin el índice de un solo principal, hay dos principales', async () => {
      await applyMutated('m2', (sql) =>
        sql.replace(/CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_one_primary_idx[\s\S]*?WHERE is_primary;/, ''),
      );
      await q(
        `INSERT INTO public.contact_phones_m2 (contact_id, dedupe_key, normalized_phone, is_primary)
         VALUES ($1, $2, $4, true), ($1, $3, $4, true)`,
        [CONTACT_ID, KEY_A, KEY_B, PHONE_A],
      );
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM public.contact_phones_m2 WHERE is_primary`,
      );
      assert.equal(rows[0].n, 2);
    });

    it('sin el CHECK de principal vivo, un tombstone puede ser principal', async () => {
      await applyMutated('m3', (sql) =>
        sql.replace(/CONSTRAINT contact_phones_primary_requires_live_number[\s\S]*?\n    \),\n/, ''),
      );
      const code = await sqlstateOf(() =>
        q(
          `INSERT INTO public.contact_phones_m3
             (contact_id, dedupe_key, suppressed_at, suppression_reason, is_primary)
           VALUES ($1, $2, now(), 'data_subject_request', true)`,
          [CONTACT_ID, KEY_A],
        ),
      );
      // El otro CHECK (tombstone_is_empty) sigue vivo y exige is_primary = false, así que la
      // mutación se detecta por el CAMBIO de código: sin ella habría sido 23514 por el CHECK
      // de principal. Que siga siendo rechazada demuestra que las dos guardas son distintas.
      assert.equal(code, CHECK_VIOLATION);
      const stillGuarded = await sqlstateOf(() =>
        q(
          `INSERT INTO public.contact_phones_m3 (contact_id, dedupe_key, phone_status, normalized_phone, is_primary)
           VALUES ($1, $2, 'invalid', $3, true)`,
          [CONTACT_ID, KEY_B, PHONE_B],
        ),
      );
      assert.equal(
        stillGuarded,
        null,
        'sin el CHECK, un principal declarado inválido pasa — la guarda era load-bearing',
      );
    });

    it('sin el CHECK de tombstone vacío, un suprimido conserva el número', async () => {
      await applyMutated('m4', (sql) =>
        sql.replace(/CONSTRAINT contact_phones_tombstone_is_empty[\s\S]*?\n    \),\n/, ''),
      );
      const code = await sqlstateOf(() =>
        q(
          `INSERT INTO public.contact_phones_m4
             (contact_id, dedupe_key, normalized_phone, display_phone, phone_type,
              suppressed_at, suppression_reason)
           VALUES ($1, $2, $3, $3, 'mobile', now(), 'data_subject_request')`,
          [CONTACT_ID, KEY_A, PHONE_A],
        ),
      );
      assert.equal(code, null);
      const { rows } = await q(
        `SELECT normalized_phone FROM public.contact_phones_m4 WHERE dedupe_key = $1`,
        [KEY_A],
      );
      assert.equal(
        rows[0].normalized_phone,
        PHONE_A,
        'sin el CHECK, "suprimido" es una bandera que deja el número en su sitio',
      );
    });

    it('sin la UNIQUE de procedencia, la misma observación se duplica', async () => {
      await applyMutated('m5', (sql) =>
        sql.replace(
          'CONSTRAINT contact_phone_sources_event_key_unique\n    UNIQUE (contact_phone_id, source_event_key)',
          'CONSTRAINT contact_phone_sources_event_key_placeholder CHECK (source_event_key IS NOT NULL)',
        ),
      );
      const { rows: phone } = await q(
        `INSERT INTO public.contact_phones_m5 (contact_id, dedupe_key, normalized_phone)
         VALUES ($1, $2, $3) RETURNING id`,
        [CONTACT_ID, KEY_A, PHONE_A],
      );
      await q(
        `INSERT INTO public.contact_phone_sources_m5
           (contact_phone_id, provider, acquisition_mode, source_event_key)
         VALUES ($1, 'apollo', 'reveal', 'v1:dup'), ($1, 'apollo', 'reveal', 'v1:dup')`,
        [phone[0].id],
      );
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM public.contact_phone_sources_m5 WHERE source_event_key = 'v1:dup'`,
      );
      assert.equal(rows[0].n, 2);
    });

    it('con GRANT a authenticated, el navegador escribiría procedencia', async () => {
      await applyMutated('m6', (sql) =>
        sql.replace(
          "EXECUTE 'GRANT SELECT ON TABLE public.contact_phone_sources TO authenticated';",
          "EXECUTE 'GRANT SELECT, INSERT ON TABLE public.contact_phone_sources TO authenticated';",
        ),
      );
      const { rows } = await q(`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='contact_phone_sources_m6'
          AND grantee='authenticated' ORDER BY privilege_type`);
      assert.deepEqual(
        rows.map((row) => row.privilege_type),
        ['INSERT', 'SELECT'],
        'la mutación no cambió los privilegios: la guarda no era load-bearing',
      );
    });

    it('con GRANT a anon, la tabla queda expuesta', async () => {
      await applyMutated('m7', (sql) =>
        sql.replace(
          "EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phones FROM anon';",
          '',
        ),
      );
      const { rows } = await q(`
        SELECT count(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='contact_phones_m7' AND grantee='anon'`);
      assert.ok(
        rows[0].n as number > 0,
        'sin el REVOKE, los default privileges de Supabase dejan la tabla abierta a anon',
      );
    });

    it('sin el UPDATE por columna, la procedencia sería reescribible', async () => {
      await applyMutated('m8', (sql) =>
        sql.replace(
          /EXECUTE 'GRANT UPDATE \(suppressed_at, suppression_reason, suppressed_by\) '\s*\|\| 'ON TABLE public\.contact_phone_sources TO service_role';/,
          "EXECUTE 'GRANT UPDATE ON TABLE public.contact_phone_sources TO service_role';",
        ),
      );
      const { rows } = await q(
        `SELECT has_table_privilege('service_role', 'public.contact_phone_sources_m8', 'UPDATE') AS ok`,
      );
      assert.equal(
        rows[0].ok,
        true,
        'con UPDATE de tabla, provider y source_event_key dejan de ser inmutables',
      );
    });

    it('sin la condición del contacto padre, la RLS deja de seguir a contacts', async () => {
      // Reemplazo LITERAL y no una regex: el cuerpo de la política está lleno de paréntesis
      // anidados (`has_active_access(auth.uid())`), y una regex perezosa cierra en el primer
      // `))` que encuentra, dejando el `USING` desbalanceado. La mutación fallaría entonces
      // por SQL inválido en vez de por lo que se quiere medir.
      const PARENT_SCOPED_USING = `USING (
          has_active_access(auth.uid())
          AND EXISTS (
            SELECT 1 FROM public.contacts c
            WHERE c.id = public.contact_phones.contact_id
              AND has_active_access(auth.uid())
          )
        )`;
      await applyMutated('m9', (sql) => {
        assert.ok(
          sql.includes(PARENT_SCOPED_USING),
          'el cuerpo de la política cambió: actualiza PARENT_SCOPED_USING',
        );
        return sql.replace(PARENT_SCOPED_USING, 'USING (has_active_access(auth.uid()))');
      });
      // Se busca por tabla + comando + rol, NO por nombre: el renombrado de `applyMutated`
      // sustituye la subcadena `contact_phones` en TODO el archivo, y el nombre de la
      // política la contiene, así que en la copia mutada se llama
      // `active_users_can_read_contact_phones_m9`.
      const { rows } = await q(`
        SELECT qual FROM pg_policies
        WHERE schemaname='public' AND tablename='contact_phones_m9'
          AND cmd='SELECT' AND roles::text = '{authenticated}'`);
      assert.ok(rows[0], 'no se encontró la política mutada');
      assert.equal(
        /contacts/.test(rows[0].qual as string),
        false,
        'la mutación no quitó el EXISTS: la guarda no era load-bearing',
      );
    });

    it('con una columna de coste, aparecería una segunda contabilidad', async () => {
      await applyMutated('m10', (sql) =>
        sql.replace(
          'observed_at           timestamptz NOT NULL DEFAULT now(),',
          'observed_at           timestamptz NOT NULL DEFAULT now(),\n  cost_credits          integer     NULL,',
        ),
      );
      const { rows } = await q(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='contact_phone_sources_m10'
          AND column_name='cost_credits'`);
      assert.equal(rows.length, 1, 'la mutación no añadió la columna: no probaría nada');
    });

    it('con account_id, existiría una propiedad que puede contradecir al contacto', async () => {
      await applyMutated('m11', (sql) =>
        sql.replace(
          '  normalized_phone   text        NULL,',
          '  account_id         uuid        NULL,\n  normalized_phone   text        NULL,',
        ),
      );
      const { rows } = await q(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='contact_phones_m11'
          AND column_name='account_id'`);
      assert.equal(rows.length, 1);
    });
  });
});
