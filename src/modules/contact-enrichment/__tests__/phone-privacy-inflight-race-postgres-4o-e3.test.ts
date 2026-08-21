/**
 * Agente 2A — CARRERA REAL entre la supresión y la persistencia en vuelo
 * (AGENT2A-PHONE-REVEAL-4O-E3) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * El defecto que 4O-E3 cierra es una CARRERA, y una carrera no se demuestra con
 * dobles: en un fake, «la supresión se commitea entre la lectura del guard y la
 * escritura» es una secuencia que se programa. Aquí son dos conexiones reales
 * compitiendo por el MISMO lock de fila, y lo que se mide después es el contenido de
 * las tablas.
 *
 * La propiedad que se prueba es una sola:
 *
 *     supresión commiteada ANTES del commit de la persistencia
 *     ⇒ ningún número queda vivo
 *
 * y su simétrica: si la persistencia gana, la supresión que llega después la
 * tombstonea (garantía de 4O-E2, que aquí se vuelve a ejecutar para probar que E3 no
 * la rompió). Los DOS órdenes terminan suprimidos; ninguno depende de quién gane.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS y los default
 *     privileges que hacen que toda tabla nueva de `public` nazca con los 8
 *     privilegios — que es lo que hace verificable el REVOKE de los helpers;
 *   * `contact_enrichment_candidates` con los tipos reales de las columnas del reveal
 *     (068/094/095/097/098/101), más `source` / `source_contact_id`, que son parte de
 *     la clave de la supresión;
 *   * la tabla `phone_reveal_cache` TAL CUAL la declara la migración 099 — es donde
 *     vive el tombstone duradero que esta migración lee;
 *   * las migraciones 109, 110, 111, 112 y 113 tal cual están en disco.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito; no ejecuta ninguna DSAR real. Todos los
 * números son sintéticos 555 y todos los ids son ficticios.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito:
 * descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio. Si el módulo no está resuelto, el archivo se SALTA con un motivo
 * explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:phone-privacy-race-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete son
 * prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6, la
 * misma de Producción.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { normalizeApolloPersonId } from '../../../server/integrations/apollo-person-id';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_113 = '113_phone_reveal_person_suppression_recheck.sql';
const APOLLO_FN = 'persist_candidate_apollo_phone_reveal_result';
const LUSHA_FN = 'persist_candidate_lusha_phone_reveal_result';

const INSUFFICIENT_PRIVILEGE = '42501';
const DEADLOCK_DETECTED = '40P01';

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
// Datos de prueba — sintéticos
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const RUN_ID = '77777777-7777-4777-8777-777777777777';
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
/** Apollo person id válido: ObjectId de 24 hex. */
const PERSON_ID = 'a1b2c3d4e5f60718293a4b5c';
const OTHER_PERSON_ID = '0f1e2d3c4b5a69788796a5b4';
const NOW = '2026-08-10T10:00:00.000Z';

const MOBILE = '+15550000001';
const KEY_MOBILE = `e164:${'a'.repeat(64)}`;
const REQUEST_ID = 'req-4o-e3-0001';

describe(
  '4O-E3 — la supresión por persona gana la carrera dentro de la transacción',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    let other: PgLikeClient;
    /**
     * Tercera conexión, SOLO para observar. Es imprescindible: mientras `client`
     * ejecuta la RPC bloqueada esperando el lock, esa conexión no puede responder a
     * nada más, así que sondear `pg_stat_activity` desde ella se quedaría colgado
     * para siempre. Sin un observador aparte no hay forma de saber que la carrera se
     * planteó de verdad.
     */
    let observer: PgLikeClient;
    let dataDir = '';

    const readMigration = (file: string) =>
      readFileSync(join(migrationsDir, file), 'utf8');

    /**
     * Extrae un tramo de una migración por sus marcadores de sección. Se usa para
     * aplicar SOLO la tabla `phone_reveal_cache` de la 099 sin arrastrar su RLS ni el
     * `ALTER TABLE contacts`, que necesitarían medio esquema de plataforma. El texto
     * de la tabla es el REAL: sus CHECKs son los que están en Producción.
     */
    function sliceMigration(file: string, from: string, to: string): string {
      const sql = readMigration(file);
      const start = sql.indexOf(from);
      const end = sql.indexOf(to);
      assert.notEqual(start, -1, `marcador inicial ausente en ${file}`);
      assert.notEqual(end, -1, `marcador final ausente en ${file}`);
      assert.ok(end > start, `marcadores invertidos en ${file}`);
      return sql.slice(start, end);
    }

    /** Llama la RPC de Apollo con parámetros NOMBRADOS, igual que PostgREST. */
    async function callApollo(
      conn: PgLikeClient = client,
      fn: string = APOLLO_FN,
    ): Promise<Record<string, unknown>> {
      const { rows } = await conn.query(
        `SELECT public.${fn}(
           p_candidate_id                     => $1::uuid,
           p_expected_request_id              => $2::text,
           p_reveal_phase                     => 'webhook',
           p_observed_at                      => $3::timestamptz,
           p_phones                           => $4::jsonb,
           p_sources                          => $5::jsonb,
           p_primary_candidates               => $6::jsonb,
           p_legacy_phone                     => $7::text,
           p_legacy_phone_type                => 'mobile',
           p_legacy_raw_type                  => 'mobile',
           p_legacy_dedupe_key                => $8::text,
           p_phone_reveal_status              => 'revealed',
           p_phone_reveal_provider            => 'apollo',
           p_phone_revealed_at                => $3::timestamptz,
           p_phone_reveal_completed_at        => $3::timestamptz,
           p_phone_reveal_webhook_received_at => $3::timestamptz,
           p_phone_reveal_last_checked_at     => NULL,
           p_phone_reveal_cost_credits        => 1,
           p_phone_reveal_cost_source         => 'reported',
           p_phone_reveal_error_code          => NULL,
           p_phone_processing_basis           => NULL,
           p_apollo_person_id                 => $9::text
         ) AS result`,
        [
          CANDIDATE_ID,
          REQUEST_ID,
          NOW,
          JSON.stringify([
            {
              dedupe_key: KEY_MOBILE,
              normalized_phone: MOBILE,
              display_phone: MOBILE,
              phone_type: 'mobile',
              phone_status: 'valid',
              first_seen_at: NOW,
              last_seen_at: NOW,
            },
          ]),
          JSON.stringify([
            {
              dedupe_key: KEY_MOBILE,
              provider: 'apollo',
              acquisition_mode: 'reveal',
              raw_provider_type: 'mobile',
              raw_provider_status: 'valid',
              waterfall_run_id: null,
              reservation_id: null,
              provider_usage_log_id: null,
              source_event_key: `v1:apollo:reveal:${KEY_MOBILE}`,
              observed_at: NOW,
            },
          ]),
          JSON.stringify([
            {
              dedupe_key: KEY_MOBILE,
              phone: MOBILE,
              phone_type: 'mobile',
              raw_type: 'mobile',
            },
          ]),
          MOBILE,
          KEY_MOBILE,
          PERSON_ID,
        ],
      );
      return rows[0].result as Record<string, unknown>;
    }

    /** Llama la RPC de Lusha con parámetros NOMBRADOS. */
    async function callLusha(
      conn: PgLikeClient = client,
      fn: string = LUSHA_FN,
    ): Promise<Record<string, unknown>> {
      const { rows } = await conn.query(
        `SELECT public.${fn}(
           p_candidate_id                 => $1::uuid,
           p_expected_phone_reveal_status => 'no_phone_found',
           p_observed_at                  => $2::timestamptz,
           p_phones                       => $3::jsonb,
           p_sources                      => $4::jsonb,
           p_primary_candidates           => $5::jsonb,
           p_legacy_phone                 => $6::text,
           p_legacy_phone_type            => 'mobile',
           p_legacy_raw_type              => 'mobile',
           p_legacy_dedupe_key            => $7::text,
           p_phone_reveal_status          => 'revealed',
           p_phone_reveal_provider        => 'lusha',
           p_phone_reveal_request_id      => NULL,
           p_phone_revealed_at            => $2::timestamptz,
           p_phone_reveal_completed_at    => $2::timestamptz,
           p_phone_revealed_by            => $8::uuid,
           p_phone_reveal_cost_credits    => 5,
           p_phone_reveal_cost_source     => 'reported',
           p_phone_reveal_error_code      => NULL,
           p_phone_reveal_attempt_count   => 1
         ) AS result`,
        [
          CANDIDATE_ID,
          NOW,
          JSON.stringify([
            {
              dedupe_key: KEY_MOBILE,
              normalized_phone: MOBILE,
              display_phone: MOBILE,
              phone_type: 'mobile',
              phone_status: 'valid',
              first_seen_at: NOW,
              last_seen_at: NOW,
            },
          ]),
          JSON.stringify([
            {
              dedupe_key: KEY_MOBILE,
              provider: 'lusha',
              acquisition_mode: 'reveal',
              raw_provider_type: 'mobile',
              raw_provider_status: 'valid',
              waterfall_run_id: null,
              reservation_id: null,
              provider_usage_log_id: null,
              source_event_key: `v1:lusha:reveal:${KEY_MOBILE}`,
              observed_at: NOW,
            },
          ]),
          JSON.stringify([
            {
              dedupe_key: KEY_MOBILE,
              phone: MOBILE,
              phone_type: 'mobile',
              raw_type: 'mobile',
            },
          ]),
          MOBILE,
          KEY_MOBILE,
          ACTOR_ID,
        ],
      );
      return rows[0].result as Record<string, unknown>;
    }

    /** Estado observable tras la operación. */
    async function snapshot() {
      const phones = await client.query(
        `SELECT dedupe_key, normalized_phone, is_primary, suppressed_at
           FROM public.contact_enrichment_candidate_phones
          WHERE candidate_id = $1 ORDER BY dedupe_key`,
        [CANDIDATE_ID],
      );
      const candidate = await client.query(
        `SELECT phone, enrichment_metadata, phone_reveal_status
           FROM public.contact_enrichment_candidates WHERE id = $1`,
        [CANDIDATE_ID],
      );
      const accounting = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM public.provider_usage_logs)             AS usage_logs,
           (SELECT COUNT(*) FROM public.phone_reveal_credit_reservations) AS reservations,
           (SELECT COUNT(*) FROM public.phone_reveal_waterfall_runs)      AS runs`,
      );
      return {
        phones: phones.rows,
        candidate: candidate.rows[0] as Record<string, unknown>,
        accounting: accounting.rows[0] as Record<string, unknown>,
      };
    }

    /** Deja el candidato en el estado inicial y la colección/caché vacías. */
    async function reset(
      candidate: { status?: string; source?: string; sourceContactId?: string | null } = {},
    ) {
      await client.query(
        'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
        [CANDIDATE_ID],
      );
      await client.query('DELETE FROM public.phone_reveal_cache');
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone = NULL,
                enrichment_metadata = '{}'::jsonb,
                phone_reveal_status = $2,
                phone_reveal_request_id = $3,
                phone_reveal_error_code = NULL,
                apollo_person_id = $4,
                source = $5,
                source_contact_id = $6
          WHERE id = $1`,
        [
          CANDIDATE_ID,
          candidate.status ?? 'pending',
          REQUEST_ID,
          PERSON_ID,
          candidate.source ?? 'apollo',
          candidate.sourceContactId === undefined ? null : candidate.sourceContactId,
        ],
      );
    }

    /** Inserta el tombstone POR PERSONA que una DSAR deja en la caché. */
    async function insertPersonTombstone(
      conn: PgLikeClient = client,
      personId: string = PERSON_ID,
    ) {
      await conn.query(
        `INSERT INTO public.phone_reveal_cache (
           provider, provider_person_id, account_id, country_code,
           normalized_phone, phone_type, original_revealed_at, expires_at,
           suppressed_at, suppression_reason, suppressed_by
         ) VALUES ('apollo', $1, $2, 'CO', NULL, NULL, $3, $3, $3,
                   'dsar_erasure_request', $4)`,
        [personId, ACCOUNT_ID, NOW, ACTOR_ID],
      );
    }

    /**
     * Aplica una COPIA MUTADA de una función bajo otro nombre. Se compara ANTES de
     * renombrar: el renombrado cambia el texto siempre, así que compararlo después
     * dejaría pasar una mutación que no tocó nada.
     */
    async function applyMutatedFunction(
      sourceFn: string,
      name: string,
      mutate: (sql: string) => string,
    ): Promise<void> {
      const sql = readMigration(MIGRATION_113);
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${sourceFn}(`);
      assert.notEqual(start, -1, 'no se encontró la definición de la función');
      const end = sql.indexOf('END $$;', start);
      assert.notEqual(end, -1, 'no se encontró el final de la función');
      const definition = sql.slice(start, end + 'END $$;'.length);
      const mutated = mutate(definition);
      assert.notEqual(
        mutated,
        definition,
        'la mutación no cambió nada: no probaría nada',
      );
      await client.query(mutated.replaceAll(`public.${sourceFn}(`, `public.${name}(`));
    }

    async function sqlstateOf(fn: () => Promise<unknown>): Promise<string | null> {
      try {
        await fn();
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      }
    }

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oe3-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54399,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();
      // Segunda conexión: sin ella no hay carrera que medir, solo una secuencia.
      other = postgres.getPgClient();
      await other.connect();
      observer = postgres.getPgClient();
      await observer.connect();

      await client.query(`DO $$ BEGIN
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END $$;`);
      await client.query(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      await client.query(`
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at := now(); RETURN NEW; END $$;`);

      await client.query(`
        CREATE TABLE public.accounts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());

        CREATE TABLE public.contacts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());

        -- Solo por la FK de phone_reveal_cache.suppressed_by.
        CREATE TABLE public.internal_users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());

        CREATE TABLE public.contact_enrichment_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id uuid REFERENCES public.accounts(id));

        CREATE TABLE public.contact_enrichment_candidates (
          id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          enrichment_run_id                uuid NOT NULL
            REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
          source                           text,
          source_contact_id                text,
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
          apollo_person_id                 text
        );

        -- Las tres tablas de contabilidad, solo por sus FK. Que sigan VACÍAS tras
        -- una supresión es la prueba de que el costo real vive fuera de estas
        -- funciones y sobrevive al veredicto de privacidad.
        CREATE TABLE public.phone_reveal_waterfall_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.phone_reveal_credit_reservations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.provider_usage_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());

        CREATE TABLE public.phone_reveal_suppression_audit (
          id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          provider                       text NOT NULL DEFAULT 'apollo',
          provider_person_id_hash        text NOT NULL,
          account_id                     uuid,
          country_code                   text,
          actor_user_id                  uuid,
          reason_code                    text NOT NULL,
          candidates_cleared             integer NOT NULL DEFAULT 0,
          contacts_cleared               integer NOT NULL DEFAULT 0,
          cache_rows_suppressed          integer NOT NULL DEFAULT 0,
          tombstone_created              boolean NOT NULL DEFAULT false,
          created_at                     timestamptz NOT NULL DEFAULT now(),
          metadata                       jsonb NOT NULL DEFAULT '{}'::jsonb
        );`);

      // La tabla de la caché, TAL CUAL la declara la 099 (secciones 1–3).
      await client.query(
        sliceMigration(
          '099_apollo_phone_reveal_cache.sql',
          '-- ── 1. Cache table',
          '-- ── 4. updated_at trigger',
        ),
      );

      await client.query(readMigration('109_contact_enrichment_candidate_phones.sql'));
      await client.query(
        readMigration('110_persist_candidate_apollo_phone_reveal_result.sql'),
      );
      await client.query(
        readMigration('111_persist_candidate_lusha_phone_reveal_result.sql'),
      );
      await client.query(readMigration('112_suppress_candidate_phone_collection.sql'));
      await client.query(readMigration(MIGRATION_113));

      await client.query('INSERT INTO public.accounts (id) VALUES ($1)', [ACCOUNT_ID]);
      await client.query('INSERT INTO public.internal_users (id) VALUES ($1)', [ACTOR_ID]);
      await client.query(
        'INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)',
        [RUN_ID, ACCOUNT_ID],
      );
      await client.query(
        `INSERT INTO public.contact_enrichment_candidates (id, enrichment_run_id, source)
         VALUES ($1, $2, 'apollo')`,
        [CANDIDATE_ID, RUN_ID],
      );
    });

    after(async () => {
      if (!EmbeddedPostgresCtor) return;
      await observer?.end().catch(() => {});
      await other?.end().catch(() => {});
      await client?.end().catch(() => {});
      await postgres?.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ═══════════════════════════════════════════════════════════
    // 1. Control: sin tombstone, nada cambia
    // ═══════════════════════════════════════════════════════════

    it('sin supresión, el resultado de Apollo se persiste igual que antes del hito', async () => {
      await reset();
      const result = await callApollo();
      assert.equal(result.status, 'persisted');

      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.equal(state.phones[0].normalized_phone, MOBILE);
      assert.equal(state.phones[0].is_primary, true);
      assert.equal(state.candidate.phone, MOBILE);
      assert.equal(state.candidate.phone_reveal_status, 'revealed');
    });

    it('sin supresión, el resultado de Lusha se persiste igual que antes del hito', async () => {
      await reset({ status: 'no_phone_found' });
      const result = await callLusha();
      assert.equal(result.status, 'persisted');

      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.equal(state.candidate.phone, MOBILE);
    });

    // ═══════════════════════════════════════════════════════════
    // 2. La supresión commitea ANTES: nada se escribe
    // ═══════════════════════════════════════════════════════════

    it('Apollo: un tombstone por persona ya commiteado bloquea la persistencia', async () => {
      await reset();
      await insertPersonTombstone();

      const result = await callApollo();
      assert.equal(result.status, 'suppressed');
      assert.equal(result.candidate_terminalized, false);
      assert.equal(result.inserted_phone_count, 0);
      assert.equal(result.primary_set, false);

      const state = await snapshot();
      assert.equal(state.phones.length, 0, 'no puede quedar ninguna fila viva');
      assert.equal(state.candidate.phone, null, 'el escalar no puede recibir número');
      assert.equal(
        state.candidate.phone_reveal_status,
        'pending',
        'la transacción NO terminaliza: eso es política de 4O-E1 en TypeScript',
      );
    });

    it('Lusha: un tombstone por persona ya commiteado bloquea la persistencia', async () => {
      await reset({ status: 'no_phone_found' });
      await insertPersonTombstone();

      const result = await callLusha();
      assert.equal(result.status, 'suppressed');
      assert.equal(result.candidate_terminalized, false);

      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.candidate.phone, null);
    });

    it('el veredicto de privacidad NO toca la contabilidad: el costo real sobrevive', async () => {
      await reset();
      await insertPersonTombstone();
      await callApollo();

      const state = await snapshot();
      // Las tres tablas siguen vacías: la función no escribe usage logs, ni reservas,
      // ni filas de corrida, así que el cargo ya registrado por el proveedor no se
      // puede borrar desde aquí.
      assert.equal(Number(state.accounting.usage_logs), 0);
      assert.equal(Number(state.accounting.reservations), 0);
      assert.equal(Number(state.accounting.runs), 0);
    });

    // ═══════════════════════════════════════════════════════════
    // 3. LA CARRERA: dos conexiones, un solo lock
    // ═══════════════════════════════════════════════════════════

    it('la supresión que commitea mientras la persistencia espera el lock GANA', async () => {
      await reset();

      // La supresión toma el lock del candidato y lo retiene: es exactamente lo que
      // hace la transacción de la migración 112 mientras tombstonea la colección.
      await other.query('BEGIN');
      await other.query(
        'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE',
        [CANDIDATE_ID],
      );

      // La persistencia arranca AHORA y se queda esperando ese lock. Su lectura del
      // tombstone todavía no ha ocurrido: ocurre DESPUÉS de obtener el lock.
      const persistence = callApollo();
      // Se espera a que la RPC esté realmente bloqueada antes de commitear, para que
      // el orden que se prueba sea el que se quiere probar y no una coincidencia.
      await waitForLockWaiter(observer, CANDIDATE_ID);

      // La supresión escribe su tombstone y commitea.
      await insertPersonTombstone(other);
      await other.query('COMMIT');

      const result = await persistence;
      assert.equal(
        result.status,
        'suppressed',
        'la persistencia despierta y VE la supresión que commiteó mientras esperaba',
      );

      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.candidate.phone, null);
    });

    it('si la persistencia gana, la supresión posterior tombstonea lo escrito (4O-E2 intacto)', async () => {
      await reset();

      const persisted = await callApollo();
      assert.equal(persisted.status, 'persisted');

      // La DSAR llega después: primero el tombstone por persona, después la
      // propagación a la colección — el MISMO orden que la acción real.
      await insertPersonTombstone();
      const { rows } = await client.query(
        `SELECT public.suppress_candidate_phone_collection(
           p_candidate_id               => $1::uuid,
           p_expected_enrichment_run_id => $2::uuid,
           p_scope                      => 'all_candidate_phones',
           p_dedupe_key                 => NULL,
           p_suppression_reason         => 'data_subject_request',
           p_suppressed_by              => $3::uuid,
           p_suppressed_at              => $4::timestamptz
         ) AS result`,
        [CANDIDATE_ID, RUN_ID, ACTOR_ID, NOW],
      );
      assert.equal((rows[0].result as Record<string, unknown>).status, 'suppressed');

      const state = await snapshot();
      assert.equal(state.phones.length, 1, 'el tombstone conserva la fila (sin DELETE)');
      assert.equal(state.phones[0].normalized_phone, null);
      assert.equal(state.phones[0].is_primary, false);
      assert.notEqual(state.phones[0].suppressed_at, null);
      assert.equal(state.candidate.phone, null, 'el escalar queda limpio');
    });

    it('el MISMO evento reprocesado tras la supresión no escribe nada nuevo', async () => {
      // Precedencia deliberada: el token de pertenencia (Step 2) se evalúa ANTES que la
      // privacidad (Step 2b). Un evento que YA commiteó devuelve `idempotent` sin tocar
      // una sola fila, así que no hay nada que suprimir en esta llamada — lo que borra
      // lo ya escrito es la propagación de la DSAR (migración 112), no un reproceso.
      await reset();
      assert.equal((await callApollo()).status, 'persisted');
      await insertPersonTombstone();

      const retry = await callApollo();
      assert.equal(retry.status, 'idempotent');
      assert.equal(retry.inserted_phone_count, 0);
      assert.equal(retry.updated_phone_count, 0);
      assert.equal(retry.inserted_source_count, 0);

      const state = await snapshot();
      assert.equal(state.phones.length, 1, 'no se añadió ninguna fila');
      assert.equal(Number(state.accounting.usage_logs), 0);
    });

    it('un evento NUEVO sobre un candidato ya suprimido se bloquea', async () => {
      // El caso que sí importa: el candidato vuelve a estar en vuelo (otro intento) y
      // llega una respuesta del proveedor. La supresión por persona lo para en seco.
      await reset();
      assert.equal((await callApollo()).status, 'persisted');
      await insertPersonTombstone();
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone_reveal_status = 'pending', phone_reveal_request_id = $2
          WHERE id = $1`,
        [CANDIDATE_ID, REQUEST_ID],
      );

      const result = await callApollo();
      assert.equal(result.status, 'suppressed');

      const state = await snapshot();
      assert.equal(state.phones.length, 1, 'no se añadió evidencia nueva');
      assert.equal(
        state.candidate.phone_reveal_status,
        'pending',
        'la transacción no terminaliza: eso es política de 4O-E1',
      );
    });

    it('dos conexiones en órdenes opuestos no producen deadlock', async () => {
      await reset();

      // A: persistencia sobre el candidato. B: supresión sobre el mismo candidato.
      // Ambas toman EL MISMO y ÚNICO lock de fila y en el mismo orden (candidato
      // primero, todo lo demás después), así que no hay ciclo posible.
      await other.query('BEGIN');
      await other.query(
        'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE',
        [CANDIDATE_ID],
      );
      const persistence = callApollo();
      await waitForLockWaiter(observer, CANDIDATE_ID);
      await other.query(
        `UPDATE public.contact_enrichment_candidates SET phone_reveal_attempt_count = 1
          WHERE id = $1`,
        [CANDIDATE_ID],
      );
      await other.query('COMMIT');

      const code = await sqlstateOf(async () => persistence);
      assert.notEqual(code, DEADLOCK_DETECTED, 'no puede haber deadlock');
    });

    // ═══════════════════════════════════════════════════════════
    // 4. Alcance de la clave: ni de más ni de menos
    // ═══════════════════════════════════════════════════════════

    it('un tombstone de OTRA persona no bloquea a este candidato', async () => {
      await reset();
      await insertPersonTombstone(client, OTHER_PERSON_ID);

      const result = await callApollo();
      assert.equal(result.status, 'persisted');
    });

    it('un tombstone de otra CUENTA no bloquea a este candidato', async () => {
      await reset();
      const otherAccount = '12121212-1212-4121-8121-121212121212';
      await client.query('INSERT INTO public.accounts (id) VALUES ($1)', [otherAccount]);
      await client.query(
        `INSERT INTO public.phone_reveal_cache (
           provider, provider_person_id, account_id, country_code,
           original_revealed_at, expires_at, suppressed_at, suppression_reason
         ) VALUES ('apollo', $1, $2, 'CO', $3, $3, $3, 'dsar_erasure_request')`,
        [PERSON_ID, otherAccount, NOW],
      );

      const result = await callApollo();
      assert.equal(result.status, 'persisted');
    });

    it('una entrada VIVA de caché (sin tombstone) no bloquea nada', async () => {
      await reset();
      await client.query(
        `INSERT INTO public.phone_reveal_cache (
           provider, provider_person_id, account_id, country_code,
           normalized_phone, phone_type, original_revealed_at, expires_at
         ) VALUES ('apollo', $1, $2, 'CO', $3, 'mobile', $4, $4)`,
        [PERSON_ID, ACCOUNT_ID, MOBILE, NOW],
      );

      const result = await callApollo();
      assert.equal(
        result.status,
        'persisted',
        'suprimido es `suppressed_at IS NOT NULL`, no «hay fila en la caché»',
      );
    });

    it('sin person id resoluble no se bloquea por inferencia (not_evaluable)', async () => {
      // El candidato pierde su Apollo person id y su origen deja de ser Apollo: no
      // queda clave con la que emparejar un tombstone. La política declarada es NO
      // bloquear — nunca por teléfono, email, nombre ni LinkedIn.
      await reset({ source: 'lusha', sourceContactId: 'v1.token-lusha' });
      await client.query(
        'UPDATE public.contact_enrichment_candidates SET apollo_person_id = NULL WHERE id = $1',
        [CANDIDATE_ID],
      );
      await insertPersonTombstone();

      // La RPC de Lusha no recibe person id por parámetro, así que este es el caso
      // límite real: sin columna y sin origen Apollo, la clave es NULL.
      await client.query(
        `UPDATE public.contact_enrichment_candidates SET phone_reveal_status = 'no_phone_found'
          WHERE id = $1`,
        [CANDIDATE_ID],
      );
      const result = await callLusha();
      assert.equal(result.status, 'persisted');
    });

    it('un id de Lusha en source_contact_id nunca se usa como clave de supresión', async () => {
      // `v1.<token>` pertenece a otro espacio de ids: el validador lo rechaza, así que
      // no puede emparejar por accidente el tombstone de una persona Apollo.
      const { rows } = await client.query(
        `SELECT public.phone_reveal_normalized_apollo_person_id($1::text) AS id`,
        ['v1.abcdefabcdefabcdefabcdef'],
      );
      assert.equal(rows[0].id, null);
    });

    // ═══════════════════════════════════════════════════════════
    // 5. Paridad del validador con TypeScript
    // ═══════════════════════════════════════════════════════════

    it('el validador SQL decide exactamente lo mismo que normalizeApolloPersonId', async () => {
      const cases = [
        PERSON_ID,
        PERSON_ID.toUpperCase(),
        `  ${PERSON_ID}  `,
        'v1.abcdefabcdefabcdefabcdef',
        'V1.ABCDEFABCDEFABCDEFABCDEF',
        '',
        '   ',
        'abc',
        `${PERSON_ID}0`,
        'z1b2c3d4e5f60718293a4b5c',
      ];
      for (const value of cases) {
        const { rows } = await client.query(
          'SELECT public.phone_reveal_normalized_apollo_person_id($1::text) AS id',
          [value],
        );
        assert.equal(
          rows[0].id ?? null,
          normalizeApolloPersonId(value),
          `divergencia SQL/TS para ${JSON.stringify(value)}`,
        );
      }
      const { rows } = await client.query(
        'SELECT public.phone_reveal_normalized_apollo_person_id(NULL::text) AS id',
      );
      assert.equal(rows[0].id, null);
    });

    // ═══════════════════════════════════════════════════════════
    // 6. Privilegios
    // ═══════════════════════════════════════════════════════════

    it('anon y authenticated no pueden ejecutar los helpers nuevos', async () => {
      // Una transacción por comprobación: un 42501 aborta la transacción en curso, así
      // que compartirla haría que la segunda llamada fallara por 25P02 y el test
      // pareciera verde por el motivo equivocado.
      async function asRole(role: string, sql: string, params: unknown[]) {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        const code = await sqlstateOf(() => client.query(sql, params));
        await client.query('ROLLBACK');
        return code;
      }

      for (const role of ['anon', 'authenticated']) {
        assert.equal(
          await asRole(role, 'SELECT public.phone_reveal_normalized_apollo_person_id($1)', ['x']),
          INSUFFICIENT_PRIVILEGE,
          `${role} no debe poder validar ids`,
        );
        assert.equal(
          await asRole(role, 'SELECT public.phone_reveal_person_suppression_exists($1, $2)', [
            PERSON_ID,
            ACCOUNT_ID,
          ]),
          INSUFFICIENT_PRIVILEGE,
          `${role} no debe poder leer tombstones`,
        );
      }
    });

    // ═══════════════════════════════════════════════════════════
    // 7. MUTACIÓN: sin el bloque nuevo, la fuga vuelve
    // ═══════════════════════════════════════════════════════════

    it('quitar la re-comprobación por persona hace que el número suprimido se escriba', async () => {
      await applyMutatedFunction(APOLLO_FN, 'mutated_no_person_recheck', (sql) =>
        // Se neutraliza la condición del bloque: el resto de la función queda intacto,
        // así que lo único que cambia es la propiedad que 4O-E3 añade.
        sql.replace(
          'AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN',
          'AND false THEN',
        ),
      );

      await reset();
      await insertPersonTombstone();
      const result = await callApollo(client, 'mutated_no_person_recheck');

      assert.equal(
        result.status,
        'persisted',
        'la versión mutada SÍ escribe: la prueba de arriba mide una propiedad real',
      );
      const state = await snapshot();
      assert.equal(state.candidate.phone, MOBILE);
    });

    it('leer el tombstone ANTES del lock devuelve la fuga: el orden es la garantía', async () => {
      // El `FOR UPDATE` no es decorativo: es lo que hace que la lectura del tombstone
      // ocurra DESPUÉS de que una supresión concurrente haya podido commitear. Esta
      // mutación mueve esa lectura ANTES del lock —sin quitarla— y la fuga reaparece.
      await applyMutatedFunction(APOLLO_FN, 'mutated_check_before_lock', (sql) =>
        sql
          // (a) la MISMA comprobación, pero resuelta y decidida ANTES del lock;
          .replace(
            '  SELECT c.id,\n         c.enrichment_metadata,',
            [
              '  SELECT c.enrichment_run_id, c.apollo_person_id, c.source, c.source_contact_id',
              '    INTO v_candidate',
              '  FROM public.contact_enrichment_candidates c WHERE c.id = p_candidate_id;',
              '  SELECT r.account_id INTO v_account_id FROM public.contact_enrichment_runs r',
              '   WHERE r.id = v_candidate.enrichment_run_id;',
              '  v_person_id := public.phone_reveal_normalized_apollo_person_id(p_apollo_person_id);',
              '  IF v_person_id IS NOT NULL AND v_account_id IS NOT NULL',
              '     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN',
              "    RETURN jsonb_build_object('status', 'suppressed', 'inserted_phone_count', 0,",
              "      'updated_phone_count', 0, 'inserted_source_count', 0,",
              "      'suppressed_skipped_count', 0, 'primary_dedupe_key', NULL,",
              "      'primary_set', false, 'candidate_terminalized', false);",
              '  END IF;',
              '',
              '  SELECT c.id,\n         c.enrichment_metadata,',
            ].join('\n'),
          )
          // (b) y la que estaba DENTRO de la región serializada se neutraliza, para
          //     que lo único que decida sea la lectura de fuera.
          .replace(
            '     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN\n    -- Fail closed',
            '     AND false THEN\n    -- Fail closed',
          ),
      );

      await reset();

      // La supresión retiene el lock; la persistencia mutada ya leyó la caché limpia.
      await other.query('BEGIN');
      await other.query(
        'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE',
        [CANDIDATE_ID],
      );
      const persistence = callApollo(client, 'mutated_check_before_lock');
      await waitForLockWaiter(observer, CANDIDATE_ID, '%mutated_check_before_lock%');
      await insertPersonTombstone(other);
      await other.query('COMMIT');

      const result = await persistence;
      assert.equal(
        result.status,
        'persisted',
        'con la lectura fuera de la región serializada, la supresión llega tarde',
      );
      const state = await snapshot();
      assert.equal(state.candidate.phone, MOBILE, 'la fuga que 4O-E3 cierra');
    });
  },
);

/**
 * Espera a que exista una transacción bloqueada esperando el lock de ese candidato.
 * Sin esto, el test commitearía la supresión antes de que la persistencia hubiera
 * llegado siquiera al lock, y estaría midiendo una secuencia en vez de una carrera.
 */
async function waitForLockWaiter(
  conn: PgLikeClient,
  candidateId: string,
  queryLike = '%persist_candidate%',
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS waiting
         FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE $1`,
      [queryLike],
    );
    if (Number(rows[0].waiting) > 0) return;
    if (Date.now() > deadline) {
      throw new Error(`ninguna transacción esperando el lock de ${candidateId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
