/**
 * Agente 2A — TOCTOU TRANSACCIONAL PROVIDER-NATIVE
 * (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La Fase 1 (migración 120) trasladó la privacidad del teléfono a
 * `provider_suppressions`, con clave (provider, provider_person_id) y SIN cuenta. Lo
 * hizo en tres de las cuatro capas: la puerta de aplicación, la re-comprobación previa
 * a la persistencia y —vía el cuerpo de `phone_reveal_person_suppression_exists`— la
 * re-comprobación DENTRO de la transacción de Apollo.
 *
 * Quedaba una capa fuera, y la propia 120 lo declaraba en su §6: los llamadores de
 * 110/111 resuelven `v_person_id` con reglas de APOLLO, así que
 *
 *     un candidato de origen LUSHA sin `apollo_person_id`
 *     ⇒ v_person_id IS NULL
 *     ⇒ el IF entero se salta
 *     ⇒ NINGUNA re-comprobación de supresión ocurre dentro de la transacción final.
 *
 * Es decir: para Lusha la última palabra la tenía una lectura hecha ANTES de la llamada
 * al proveedor y FUERA del lock. Una supresión que commitea en esa ventana —que es
 * larga: incluye la llamada al proveedor entera— era invisible, y el teléfono de una
 * persona borrada acababa escrito.
 *
 * La propiedad que este archivo prueba, para los DOS proveedores:
 *
 *     supresión NATIVA commiteada en cualquier momento antes del commit de la
 *     persistencia ⇒ ningún número queda vivo
 *
 * y su simétrica, que ya era de 4O-E2/E3: si la persistencia gana, la supresión que
 * llega después tombstonea lo escrito. Los dos órdenes terminan suprimidos.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6), los tres roles de Supabase con `service_role`
 *     BYPASSRLS y los default privileges que hacen nacer toda tabla de `public` con los
 *     8 privilegios;
 *   * `contact_enrichment_candidates` con los tipos reales de las columnas del reveal,
 *     más `source` / `source_contact_id`, que son de donde sale la identidad nativa;
 *   * `phone_reveal_cache` TAL CUAL la declara la 099 — el tombstone LEGADO, que sigue
 *     siendo honrado;
 *   * las migraciones 109, 110, 111, 112, 113 y 120 tal cual están en disco.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito; no ejecuta ninguna DSAR real. Todos los
 * números son sintéticos 555 y todos los ids son ficticios.
 *
 * ARNÉS OPCIONAL, por la misma razón que en 4O-E3: `embedded-postgres` no es
 * dependencia del repo para no descargar un binario de PostgreSQL en cada `npm ci`. Si
 * el módulo no resuelve, el archivo se SALTA con motivo explícito. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:provider-native-race-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve (todas las versiones son prerelease).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_113 = '113_phone_reveal_person_suppression_recheck.sql';
const MIGRATION_120 = '120_provider_native_phone_suppression.sql';
const APOLLO_FN = 'persist_candidate_apollo_phone_reveal_result';
const LUSHA_FN = 'persist_candidate_lusha_phone_reveal_result';

const UNDEFINED_TABLE = '42P01';

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
/** Corrida SIN cuenta: el caso de pre-aprobación que la Fase 1 existe para alcanzar. */
const RUN_NO_ACCOUNT_ID = '77777777-7777-4777-8777-7777770000a0';
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '55555555-5555-4555-8555-555555555555';

/** Apollo person id válido: ObjectId de 24 hex. */
const PERSON_ID = 'a1b2c3d4e5f60718293a4b5c';
/** Id nativo de Lusha, con su forma real `v1.*`. */
const LUSHA_ID = 'v1.eyJjIjoiMTIzNCIsInAiOiI1Njc4In0';
/**
 * Un `source_contact_id` que TAMBIÉN es un ObjectId de 24 hex válido. Existe para
 * probar la separación de espacios de nombres: bajo `source = 'lusha'` tiene que
 * evaluarse como identidad de LUSHA, nunca como identidad de Apollo.
 */
const HEXLIKE_LUSHA_ID = '0f1e2d3c4b5a69788796a5b4';

const NOW = '2026-08-18T10:00:00.000Z';
const MOBILE = '+15550000001';
const KEY_MOBILE = `e164:${'a'.repeat(64)}`;
const REQUEST_ID = 'req-p0-identity-4-r1-0001';

describe(
  'P0-IDENTITY-4-R1 — la supresión NATIVA gana la carrera dentro de la transacción, para los dos proveedores',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    let other: PgLikeClient;
    /**
     * Tercera conexión, SOLO para observar. Mientras `client` espera el lock no puede
     * responder a nada más, así que sondear `pg_stat_activity` desde ella se quedaría
     * colgado. Sin observador aparte no hay forma de saber que la carrera se planteó.
     */
    let observer: PgLikeClient;
    let dataDir = '';

    const readMigration = (file: string) =>
      readFileSync(join(migrationsDir, file), 'utf8');

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
      opts: {
        conn?: PgLikeClient;
        phase?: 'webhook' | 'recovery_poll';
        /** El id que el payload del proveedor afirma AHORA. NULL en el recovery. */
        payloadPersonId?: string | null;
        expectedRequestId?: string | null;
      } = {},
    ): Promise<Record<string, unknown>> {
      const conn = opts.conn ?? client;
      const phase = opts.phase ?? 'webhook';
      const isRecovery = phase === 'recovery_poll';
      const { rows } = await conn.query(
        `SELECT public.${APOLLO_FN}(
           p_candidate_id                     => $1::uuid,
           p_expected_request_id              => $2::text,
           p_reveal_phase                     => $10::text,
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
           p_phone_reveal_webhook_received_at => $11::timestamptz,
           p_phone_reveal_last_checked_at     => $12::timestamptz,
           p_phone_reveal_cost_credits        => 1,
           p_phone_reveal_cost_source         => 'reported',
           p_phone_reveal_error_code          => NULL,
           p_phone_processing_basis           => NULL,
           p_apollo_person_id                 => $9::text
         ) AS result`,
        [
          CANDIDATE_ID,
          opts.expectedRequestId === undefined
            ? isRecovery
              ? null
              : REQUEST_ID
            : opts.expectedRequestId,
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
            { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          ]),
          MOBILE,
          KEY_MOBILE,
          opts.payloadPersonId === undefined ? PERSON_ID : opts.payloadPersonId,
          phase,
          isRecovery ? null : NOW,
          isRecovery ? NOW : null,
        ],
      );
      return rows[0].result as Record<string, unknown>;
    }

    /** Llama la RPC de Lusha con parámetros NOMBRADOS. */
    async function callLusha(
      conn: PgLikeClient = client,
    ): Promise<Record<string, unknown>> {
      const { rows } = await conn.query(
        `SELECT public.${LUSHA_FN}(
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
            { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          ]),
          MOBILE,
          KEY_MOBILE,
          ACTOR_ID,
        ],
      );
      return rows[0].result as Record<string, unknown>;
    }

    async function snapshot() {
      const phones = await client.query(
        `SELECT dedupe_key, normalized_phone, is_primary, suppressed_at
           FROM public.contact_enrichment_candidate_phones
          WHERE candidate_id = $1 ORDER BY dedupe_key`,
        [CANDIDATE_ID],
      );
      const candidate = await client.query(
        `SELECT phone, phone_reveal_status FROM public.contact_enrichment_candidates
          WHERE id = $1`,
        [CANDIDATE_ID],
      );
      const accounting = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM public.provider_usage_logs)              AS usage_logs,
           (SELECT COUNT(*) FROM public.phone_reveal_credit_reservations) AS reservations,
           (SELECT COUNT(*) FROM public.phone_reveal_waterfall_runs)      AS runs`,
      );
      return {
        phones: phones.rows,
        candidate: candidate.rows[0] as Record<string, unknown>,
        accounting: accounting.rows[0] as Record<string, unknown>,
      };
    }

    /**
     * Deja el candidato en el estado inicial. A diferencia del reset de 4O-E3, aquí
     * `apolloPersonId` es un parámetro EXPLÍCITO: el caso que importa es precisamente el
     * candidato de origen Lusha que NO tiene id de Apollo.
     */
    async function reset(
      candidate: {
        status?: string;
        source?: string;
        sourceContactId?: string | null;
        apolloPersonId?: string | null;
        runId?: string;
      } = {},
    ) {
      await client.query(
        'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
        [CANDIDATE_ID],
      );
      await client.query('DELETE FROM public.phone_reveal_cache');
      await client.query('DELETE FROM public.provider_suppression_audit');
      await client.query('DELETE FROM public.provider_suppressions');
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone = NULL,
                enrichment_metadata = '{}'::jsonb,
                phone_reveal_status = $2,
                phone_reveal_request_id = $3,
                phone_reveal_error_code = NULL,
                apollo_person_id = $4,
                source = $5,
                source_contact_id = $6,
                enrichment_run_id = $7
          WHERE id = $1`,
        [
          CANDIDATE_ID,
          candidate.status ?? 'pending',
          REQUEST_ID,
          candidate.apolloPersonId === undefined ? PERSON_ID : candidate.apolloPersonId,
          candidate.source ?? 'apollo',
          candidate.sourceContactId === undefined ? null : candidate.sourceContactId,
          candidate.runId ?? RUN_ID,
        ],
      );
    }

    /** Un candidato de origen LUSHA puro: sin id de Apollo por ninguna vía. */
    const resetLushaOrigin = (sourceContactId: string = LUSHA_ID, runId = RUN_ID) =>
      reset({
        status: 'no_phone_found',
        source: 'lusha',
        sourceContactId,
        apolloPersonId: null,
        runId,
      });

    /** La supresión NATIVA que escribe la Fase 1. Sin cuenta, por diseño. */
    async function insertNativeSuppression(
      provider: 'apollo' | 'lusha',
      providerPersonId: string,
      conn: PgLikeClient = client,
    ) {
      await conn.query(
        `INSERT INTO public.provider_suppressions
           (provider, provider_person_id, suppressed_at, suppression_reason, suppressed_by)
         VALUES ($1, $2, $3, 'dsar_erasure_request', $4)
         ON CONFLICT (provider, provider_person_id) DO NOTHING`,
        [provider, providerPersonId, NOW, ACTOR_ID],
      );
    }

    /** El tombstone LEGADO por persona, con cuenta, que una DSAR antigua dejó. */
    async function insertLegacyTombstone(
      personId: string = PERSON_ID,
      conn: PgLikeClient = client,
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
     * Espera a que `client` esté REALMENTE bloqueado esperando un lock. Se observa
     * desde la tercera conexión; sin esto la "carrera" sería una secuencia.
     */
    async function waitUntilBlocked(): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const { rows } = await observer.query(
          `SELECT COUNT(*)::int AS blocked FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND state = 'active'
              AND query ILIKE '%persist_candidate%'`,
        );
        if ((rows[0].blocked as number) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail('la RPC nunca se quedó esperando el lock: no hay carrera que medir');
    }

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-p0id4r1-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54402,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();
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
      await client.query(readMigration(MIGRATION_120));

      await client.query('INSERT INTO public.accounts (id) VALUES ($1)', [ACCOUNT_ID]);
      await client.query('INSERT INTO public.internal_users (id) VALUES ($1)', [ACTOR_ID]);
      await client.query(
        'INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)',
        [RUN_ID, ACCOUNT_ID],
      );
      // La corrida SIN cuenta: `account_id` nulo, que es lo que hacía inevaluable la
      // privacidad antes de la Fase 1.
      await client.query(
        'INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, NULL)',
        [RUN_NO_ACCOUNT_ID],
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
    // F / G — los caminos SIN supresión no cambian
    // ═══════════════════════════════════════════════════════════

    it('G — Apollo sin supresión: persiste igual que antes del hito', async () => {
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

    it('F — Lusha de origen Lusha SIN supresión: persiste con normalidad', async () => {
      await resetLushaOrigin();
      const result = await callLusha();
      assert.equal(result.status, 'persisted');

      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.equal(state.candidate.phone, MOBILE);
      assert.equal(state.candidate.phone_reveal_status, 'revealed');
    });

    it('F — Lusha de origen Lusha SIN cuenta y sin supresión: sigue persistiendo', async () => {
      await resetLushaOrigin(LUSHA_ID, RUN_NO_ACCOUNT_ID);
      const result = await callLusha();
      assert.equal(result.status, 'persisted');
      assert.equal((await snapshot()).candidate.phone, MOBILE);
    });

    // ═══════════════════════════════════════════════════════════
    // A / C / D — Apollo: la supresión NATIVA bloquea en las dos fases
    // ═══════════════════════════════════════════════════════════

    it('A — Apollo: supresión nativa ya commiteada bloquea la persistencia', async () => {
      await reset();
      await insertNativeSuppression('apollo', PERSON_ID);

      const result = await callApollo();
      assert.equal(result.status, 'suppressed');
      assert.equal(result.inserted_phone_count, 0);
      assert.equal(result.primary_set, false);
      assert.equal(result.candidate_terminalized, false);

      const state = await snapshot();
      assert.equal(state.phones.length, 0, 'no puede quedar ninguna fila viva');
      assert.equal(state.candidate.phone, null, 'el escalar no puede recibir número');
      assert.equal(
        state.candidate.phone_reveal_status,
        'pending',
        'la transacción NO terminaliza: eso es política de 4O-E1 en TypeScript',
      );
    });

    it('A — Apollo SIN cuenta: la supresión nativa se evalúa igual (lo que antes era imposible)', async () => {
      await reset({ runId: RUN_NO_ACCOUNT_ID });
      await insertNativeSuppression('apollo', PERSON_ID);

      const result = await callApollo();
      assert.equal(result.status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    it('C — webhook de Apollo: clear → suprimir → persistencia bloqueada', async () => {
      await reset();
      assert.equal((await callApollo({ phase: 'webhook' })).status, 'persisted');

      await reset();
      await insertNativeSuppression('apollo', PERSON_ID);
      const blocked = await callApollo({ phase: 'webhook' });
      assert.equal(blocked.status, 'suppressed');
      assert.equal((await snapshot()).candidate.phone, null);
    });

    it('D — recovery poll de Apollo: clear → suprimir → persistencia bloqueada', async () => {
      await reset();
      assert.equal(
        (await callApollo({ phase: 'recovery_poll', expectedRequestId: null })).status,
        'persisted',
      );

      await reset();
      await insertNativeSuppression('apollo', PERSON_ID);
      const blocked = await callApollo({ phase: 'recovery_poll', expectedRequestId: null });
      assert.equal(blocked.status, 'suppressed');
      assert.equal((await snapshot()).candidate.phone, null);
    });

    it('A — Apollo: el id que el propio payload confirma también alcanza la supresión', async () => {
      // El candidato no lleva id de Apollo; el único id es el que trae el evento.
      await reset({ apolloPersonId: null });
      await insertNativeSuppression('apollo', PERSON_ID);

      const result = await callApollo({ payloadPersonId: PERSON_ID });
      assert.equal(result.status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    // ═══════════════════════════════════════════════════════════
    // B — LUSHA: el hueco que este hito cierra
    // ═══════════════════════════════════════════════════════════

    it('B — Lusha: supresión NATIVA de Lusha ya commiteada bloquea la persistencia', async () => {
      await resetLushaOrigin();
      await insertNativeSuppression('lusha', LUSHA_ID);

      const result = await callLusha();
      assert.equal(
        result.status,
        'suppressed',
        'una supresión nativa de Lusha DEBE bloquear la transacción final de Lusha',
      );
      assert.equal(result.inserted_phone_count, 0);
      assert.equal(result.candidate_scalar_updated, false);
      assert.equal(result.candidate_terminalized, false);

      const state = await snapshot();
      assert.equal(state.phones.length, 0, 'no puede quedar ninguna fila viva');
      assert.equal(state.candidate.phone, null, 'el escalar no puede recibir número');
    });

    it('B — Lusha SIN cuenta: la supresión nativa de Lusha bloquea igual', async () => {
      await resetLushaOrigin(LUSHA_ID, RUN_NO_ACCOUNT_ID);
      await insertNativeSuppression('lusha', LUSHA_ID);

      assert.equal((await callLusha()).status, 'suppressed');
      assert.equal((await snapshot()).candidate.phone, null);
    });

    it('B — la supresión de Lusha también bloquea la RPC de APOLLO cuando el candidato es de origen Lusha', async () => {
      // El mismo registro de candidato declara la identidad de Lusha; el waterfall puede
      // llegar a la RPC de Apollo con ese candidato. La identidad que el candidato lleva
      // es la misma persona, así que la supresión tiene que alcanzarla.
      await reset({
        source: 'lusha',
        sourceContactId: LUSHA_ID,
        apolloPersonId: null,
      });
      await insertNativeSuppression('lusha', LUSHA_ID);

      const result = await callApollo({ payloadPersonId: null });
      assert.equal(result.status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    // ═══════════════════════════════════════════════════════════
    // E — CARRERA REAL: suprimir entre el resultado y la transacción final
    // ═══════════════════════════════════════════════════════════

    it('E — Lusha: la supresión que commitea MIENTRAS la RPC espera el lock la bloquea', async () => {
      await resetLushaOrigin();

      // `other` toma el lock del candidato y lo retiene.
      await other.query('BEGIN');
      await other.query(
        'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE',
        [CANDIDATE_ID],
      );

      // La RPC arranca y se queda esperando ese lock: el "resultado del proveedor" ya
      // está en la mano y la transacción final aún no ha podido leer nada.
      const pending = callLusha();
      await waitUntilBlocked();

      // La DSAR ocurre AHORA, dentro de la ventana, y commitea.
      await insertNativeSuppression('lusha', LUSHA_ID, other);
      await other.query('COMMIT');

      const result = await pending;
      assert.equal(
        result.status,
        'suppressed',
        'la supresión commiteada dentro de la ventana DEBE ganar',
      );

      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.candidate.phone, null);
    });

    it('E — Apollo: la misma carrera, con supresión nativa de Apollo', async () => {
      await reset();

      await other.query('BEGIN');
      await other.query(
        'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE',
        [CANDIDATE_ID],
      );

      const pending = callApollo();
      await waitUntilBlocked();

      await insertNativeSuppression('apollo', PERSON_ID, other);
      await other.query('COMMIT');

      assert.equal((await pending).status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    // ═══════════════════════════════════════════════════════════
    // Separación de espacios de nombres (§10) — sin inferencia
    // ═══════════════════════════════════════════════════════════

    it('una supresión de APOLLO no bloquea a un candidato de LUSHA con el mismo id literal', async () => {
      // `HEXLIKE_LUSHA_ID` es un ObjectId de 24 hex válido, pero bajo `source = 'lusha'`
      // es un id de LUSHA. Que una supresión de Apollo con el MISMO texto no lo alcance
      // es la prueba de que los espacios de nombres no se cruzan — Fase 2, no Fase 1.
      await resetLushaOrigin(HEXLIKE_LUSHA_ID);
      await insertNativeSuppression('apollo', HEXLIKE_LUSHA_ID);

      const result = await callLusha();
      assert.equal(result.status, 'persisted');
      assert.equal((await snapshot()).candidate.phone, MOBILE);
    });

    it('la MISMA cadena suprimida como LUSHA sí bloquea al candidato de Lusha', async () => {
      await resetLushaOrigin(HEXLIKE_LUSHA_ID);
      await insertNativeSuppression('lusha', HEXLIKE_LUSHA_ID);

      assert.equal((await callLusha()).status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    it('un candidato de origen APOLLO no se evalúa nunca contra el espacio de Lusha', async () => {
      await reset({ source: 'apollo', sourceContactId: PERSON_ID });
      await insertNativeSuppression('lusha', PERSON_ID);

      const result = await callApollo();
      assert.equal(result.status, 'persisted');
    });

    // ═══════════════════════════════════════════════════════════
    // Compatibilidad legada (§8)
    // ═══════════════════════════════════════════════════════════

    it('el tombstone LEGADO con su cuenta sigue bloqueando (compat preservada)', async () => {
      await reset();
      await insertLegacyTombstone();

      assert.equal((await callApollo()).status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    it('un legado CLARO no puede anular una supresión nativa', async () => {
      await reset();
      // Fila de caché SIN `suppressed_at`: el legado dice "clear" explícitamente.
      await client.query(
        `INSERT INTO public.phone_reveal_cache (
           provider, provider_person_id, account_id, country_code,
           normalized_phone, phone_type, original_revealed_at, expires_at
         ) VALUES ('apollo', $1, $2, 'CO', $3, 'mobile', $4, $4)`,
        [PERSON_ID, ACCOUNT_ID, MOBILE, NOW],
      );
      await insertNativeSuppression('apollo', PERSON_ID);

      assert.equal((await callApollo()).status, 'suppressed');
      assert.equal((await snapshot()).phones.length, 0);
    });

    // ═══════════════════════════════════════════════════════════
    // H — un FALLO de lectura nunca se convierte en "clear"
    // ═══════════════════════════════════════════════════════════

    it('H — si la tabla de supresiones no se puede leer, la RPC ABORTA y no persiste nada', async () => {
      await resetLushaOrigin();
      await client.query(
        'ALTER TABLE public.provider_suppressions RENAME TO provider_suppressions_broken',
      );
      try {
        let code: string | null = null;
        try {
          await callLusha();
        } catch (error) {
          code = (error as { code?: string }).code ?? 'unknown';
        }
        assert.equal(
          code,
          UNDEFINED_TABLE,
          'una lectura imposible tiene que propagarse como error, no pasar por "no suprimido"',
        );

        const state = await snapshot();
        assert.equal(state.phones.length, 0, 'la transacción abortada no deja teléfono');
        assert.equal(state.candidate.phone, null);
      } finally {
        await client.query(
          'ALTER TABLE public.provider_suppressions_broken RENAME TO provider_suppressions',
        );
      }
    });

    it('H — el mismo fallo en el camino de Apollo tampoco se lee como "clear"', async () => {
      await reset();
      await client.query(
        'ALTER TABLE public.provider_suppressions RENAME TO provider_suppressions_broken',
      );
      try {
        let code: string | null = null;
        try {
          await callApollo();
        } catch (error) {
          code = (error as { code?: string }).code ?? 'unknown';
        }
        assert.equal(code, UNDEFINED_TABLE);
        assert.equal((await snapshot()).candidate.phone, null);
      } finally {
        await client.query(
          'ALTER TABLE public.provider_suppressions_broken RENAME TO provider_suppressions',
        );
      }
    });

    // ═══════════════════════════════════════════════════════════
    // El veredicto de privacidad NO toca la contabilidad
    // ═══════════════════════════════════════════════════════════

    it('bloquear por supresión no escribe usage logs, ni reservas, ni filas de corrida', async () => {
      await resetLushaOrigin();
      await insertNativeSuppression('lusha', LUSHA_ID);
      await callLusha();

      const state = await snapshot();
      assert.equal(Number(state.accounting.usage_logs), 0);
      assert.equal(Number(state.accounting.reservations), 0);
      assert.equal(Number(state.accounting.runs), 0);
    });
  },
);
