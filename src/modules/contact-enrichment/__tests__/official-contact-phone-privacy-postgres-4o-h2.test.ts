/**
 * Agente 2A — la privacidad del modelo OFICIAL contra PostgreSQL 17 real
 * (AGENT2A-PHONE-REVEAL-4O-H2).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana `…-static-4o-h2` fija el CONTRATO: qué dice el SQL. Lo que no puede fijar es
 * la GARANTÍA. «Retirar Apollo deja vivo el número si Lusha lo sostiene», «cuando cae la última
 * procedencia el número pasa a tombstone», «el titular no se mueve si sigue vivo», «dos
 * borrados concurrentes no dejan dos principales» y «el navegador no puede invocar el borrado»
 * no son reglas del código: son transacciones, locks, CHECKs, índices parciales y privilegios
 * de PostgreSQL. Sólo PostgreSQL puede demostrarlas.
 *
 * Así que aquí la cadena de migraciones se APLICA de verdad (099 → 109 → 112 → 114 → 115), las
 * escrituras ocurren contra un servidor real, los roles son los tres de Supabase con sus
 * default privileges, y lo que se comprueba después es el contenido de las tablas y el
 * SQLSTATE que devolvió el servidor.
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
 *   npm run test:agent2a:official-contact-phone-privacy:postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete son
 * prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6, la de Producción.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { buildPhoneCacheSuppressionAuditRow } from '../phone-cache-suppression-core';
import { buildOfficialPhoneSuppressionParams } from '../official-contact-phone-suppression-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_099 = '099_apollo_phone_reveal_cache.sql';
const MIGRATION_107 = '107_phone_reveal_cache_and_suppression_grants.sql';
const MIGRATION_109 = '109_contact_enrichment_candidate_phones.sql';
const MIGRATION_112 = '112_suppress_candidate_phone_collection.sql';
const MIGRATION_114 = '114_official_contact_phones.sql';
const MIGRATION_115 = '115_official_contact_phone_privacy.sql';

const FN = 'suppress_official_contact_phone_sources';

/** Códigos de PostgreSQL que estas pruebas distinguen. */
const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';

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
 * Resolución SÍNCRONA con `createRequire`, no con `await import()`: este archivo se transpila a
 * CJS, donde un `await` de nivel superior no compila, y la razón del skip tiene que estar
 * disponible ANTES de que `describe()` decida si corre.
 */
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
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';
const RUN_ID = '40000000-0000-4000-8000-000000000001';
const CANDIDATE_ID = '50000000-0000-4000-8000-000000000001';

const NOW = '2026-08-11T12:00:00.000Z';
const LATER = '2026-08-11T13:00:00.000Z';

const key = (letter: string) => `e164:${letter.repeat(64)}`;

describe(
  '4O-H2 — privacidad del modelo oficial en PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    /** Segunda conexión: hace de operador concurrente en las carreras. */
    let other: PgLikeClient;
    let dataDir: string;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => client.query(sql, values);

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oh2-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401 lo usan 4O-F y H1, y las suites deben poder coexistir.
        port: 54402,
        persistent: false,
        onLog: () => {},
        onError: () => {},
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();
      other = postgres.getPgClient();
      await other.connect();

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

      // ── accounts + contacts con los CHECK REALES de Producción ───
      // Tier 3 (el de la suite de 4O-E4): las tres CHECK son lo que impide que un patch
      // escriba un vocabulario inventado, así que son parte de lo que se está probando. La RLS
      // real de la 039 va también, porque la política de la 114 se DERIVA del contacto padre.
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

      // ── Contabilidad y staging ───────────────────────────────────
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

      // ── La cadena real: 099 (caché + auditoría) → 109 → 112 → 114 ─
      await q(readMigration(MIGRATION_099));
      // La 107 es indispensable aquí: sin ella la tabla de auditoría conserva los ocho
      // privilegios con los que nace toda tabla de `public` en Supabase, y medir «sigue siendo
      // append-only» contra ese estado mediría el agujero en vez del techo.
      await q(readMigration(MIGRATION_107));
      await q(readMigration(MIGRATION_109));
      await q(readMigration(MIGRATION_112));
      await q(readMigration(MIGRATION_114));

      // ── LA MIGRACIÓN BAJO PRUEBA ─────────────────────────────────
      await q(readMigration(MIGRATION_115));

      // ── Fixtures base ───────────────────────────────────────────
      await q(`INSERT INTO public.accounts (id, name) VALUES ($1, 'ACME')`, [ACCOUNT_ID]);
      await q(
        `INSERT INTO public.internal_users (id, auth_user_id, access_status)
         VALUES ($1, $1, 'active')`,
        [ACTOR_ID],
      );
      await q(`INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)`, [
        RUN_ID,
        ACCOUNT_ID,
      ]);
      await q(
        `INSERT INTO public.contact_enrichment_candidates (id, enrichment_run_id) VALUES ($1, $2)`,
        [CANDIDATE_ID, RUN_ID],
      );
    });

    after(async () => {
      if (other) await other.end().catch(() => {});
      if (client) await client.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Helpers ────────────────────────────────────────────────────

    let seq = 0;

    /** Inserta un contacto y devuelve su id. */
    async function insertContact(args: {
      phone?: string | null;
      phoneSource?: string | null;
      phoneType?: string | null;
      mobilePhone?: string | null;
      rawType?: string | null;
    }): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contacts (
           account_id, full_name, email, phone, mobile_phone, phone_type,
           phone_source, phone_raw_type, phone_revealed_at,
           phone_processing_basis, phone_confidence, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'legitimate_interest','high',$10)
         RETURNING id`,
        [
          ACCOUNT_ID,
          `Contacto Sintetico ${seq}`,
          `sintetico${seq}@example.invalid`,
          args.phone ?? null,
          args.mobilePhone ?? null,
          args.phoneType ?? 'mobile',
          args.phoneSource ?? null,
          args.rawType ?? 'mobile',
          NOW,
          JSON.stringify({ source_candidate_id: CANDIDATE_ID }),
        ],
      );
      return rows[0].id as string;
    }

    /** Inserta un número canónico oficial y devuelve su id. */
    async function insertPhone(args: {
      contactId: string;
      dedupeKey: string;
      phone: string | null;
      phoneType?: string | null;
      isPrimary?: boolean;
      phoneStatus?: string;
      lastSeenAt?: string;
    }): Promise<string> {
      const { rows } = await q(
        `INSERT INTO public.contact_phones
           (contact_id, dedupe_key, normalized_phone, display_phone, phone_type,
            phone_status, is_primary, last_seen_at)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7) RETURNING id`,
        [
          args.contactId,
          args.dedupeKey,
          args.phone,
          args.phoneType ?? 'mobile',
          args.phoneStatus ?? 'unknown',
          args.isPrimary ?? false,
          args.lastSeenAt ?? NOW,
        ],
      );
      return rows[0].id as string;
    }

    /** Inserta una procedencia. */
    async function insertSource(args: {
      phoneId: string;
      provider: string;
      acquisitionMode: string;
      eventKey: string;
      rawType?: string | null;
      observedAt?: string;
    }): Promise<string> {
      const { rows } = await q(
        `INSERT INTO public.contact_phone_sources
           (contact_phone_id, provider, acquisition_mode, source_event_key,
            raw_provider_type, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          args.phoneId,
          args.provider,
          args.acquisitionMode,
          args.eventKey,
          args.rawType ?? null,
          args.observedAt ?? NOW,
        ],
      );
      return rows[0].id as string;
    }

    /**
     * Invoca la RPC EXACTAMENTE como lo hace la persistencia: los parámetros salen del MISMO
     * builder puro que usa la server action, en el mismo orden posicional.
     *
     * ⚠️ El SQL se DERIVA del builder y no se escribe a mano. Si el builder dejara de mandar un
     * parámetro, estas pruebas lo reflejarían en vez de taparlo — la lección de 4O-E4-R1, donde
     * los tests demostraban una propiedad de un escritor FICTICIO.
     */
    async function suppress(args: {
      conn?: PgLikeClient;
      contactId: string;
      scope?: 'all_suppressible_providers' | 'single_provider';
      provider?: 'apollo' | 'lusha' | 'apollo_cache' | 'manual' | 'unknown' | null;
      dedupeKey?: string | null;
      reason?: 'data_subject_request' | 'operator_request' | 'provider_retraction';
      suppressedAt?: string;
    }): Promise<Record<string, unknown>> {
      const conn = args.conn ?? client;
      const params = buildOfficialPhoneSuppressionParams({
        contactId: args.contactId,
        scope: args.scope ?? 'all_suppressible_providers',
        provider: args.provider ?? null,
        dedupeKey: args.dedupeKey ?? null,
        suppressionReason: args.reason ?? 'data_subject_request',
        suppressedBy: ACTOR_ID,
        suppressedAt: args.suppressedAt ?? NOW,
      });
      const ordered = [
        params.p_contact_id,
        params.p_provider_scope,
        params.p_provider,
        params.p_dedupe_key,
        params.p_suppression_reason,
        params.p_suppressed_by,
        params.p_suppressed_at,
      ];
      const placeholders = ordered.map((_, index) => `$${index + 1}`).join(', ');
      const { rows } = await conn.query(
        `SELECT public.${FN}(${placeholders}) AS envelope`,
        ordered,
      );
      return rows[0].envelope as Record<string, unknown>;
    }

    const phoneRow = async (id: string) => {
      const { rows } = await q(
        `SELECT normalized_phone, display_phone, phone_type, is_primary, suppressed_at,
                suppression_reason, suppressed_by, dedupe_key, contact_id, created_at
           FROM public.contact_phones WHERE id = $1`,
        [id],
      );
      return rows[0];
    };

    const sourceRow = async (id: string) => {
      const { rows } = await q(
        `SELECT provider, acquisition_mode, raw_provider_type, source_event_key, observed_at,
                suppressed_at, suppression_reason, suppressed_by
           FROM public.contact_phone_sources WHERE id = $1`,
        [id],
      );
      return rows[0];
    };

    const contactRow = async (id: string) => {
      const { rows } = await q(
        `SELECT phone, mobile_phone, phone_type, phone_source, phone_raw_type,
                phone_revealed_at, phone_processing_basis, phone_confidence
           FROM public.contacts WHERE id = $1`,
        [id],
      );
      return rows[0];
    };

    /**
     * Escenario canónico de §12: un número, principal, justificado por Apollo Y por Lusha.
     */
    async function dualSourced(phoneSource = 'apollo_reveal') {
      const contactId = await insertContact({
        phone: '+15550000001',
        phoneSource,
        rawType: 'work_hq',
      });
      const phoneId = await insertPhone({
        contactId,
        dedupeKey: key('a'),
        phone: '+15550000001',
        isPrimary: true,
      });
      const apolloId = await insertSource({
        phoneId,
        provider: 'apollo',
        acquisitionMode: 'reveal',
        eventKey: 'ev-apollo-1',
        rawType: 'work_hq',
        observedAt: NOW,
      });
      const lushaId = await insertSource({
        phoneId,
        provider: 'lusha',
        acquisitionMode: 'reveal',
        eventKey: 'ev-lusha-1',
        rawType: 'mobile',
        observedAt: LATER,
      });
      return { contactId, phoneId, apolloId, lushaId };
    }

    // ═══════════════════════════════════════════════════════════════
    // Aplicación
    // ═══════════════════════════════════════════════════════════════

    describe('aplicación', () => {
      it('la 115 se aplicó y la función existe con su firma', async () => {
        const { rows } = await q(
          `SELECT pg_get_function_identity_arguments(p.oid) AS args,
                  p.prosecdef AS is_definer,
                  p.proconfig::text AS config
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [FN],
        );
        assert.equal(rows.length, 1, 'debe existir EXACTAMENTE una sobrecarga');
        assert.equal(
          rows[0].args,
          'p_contact_id uuid, p_provider_scope text, p_provider text, p_dedupe_key text, ' +
            'p_suppression_reason text, p_suppressed_by uuid, p_suppressed_at timestamp with time zone',
        );
        assert.equal(rows[0].is_definer, false, 'SECURITY DEFINER se regalaría el DELETE');
        assert.match(String(rows[0].config), /search_path=pg_catalog, pg_temp/);
      });

      it('es reaplicable (idempotencia de la migración)', async () => {
        await q(readMigration(MIGRATION_115));
        const { rows } = await q(
          `SELECT count(*)::int AS n FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname=$1`,
          [FN],
        );
        assert.equal(rows[0].n, 1);
      });

      it('los dos contadores de auditoría existen con NOT NULL y default 0', async () => {
        const { rows } = await q(
          `SELECT column_name, is_nullable, column_default, data_type
             FROM information_schema.columns
            WHERE table_schema='public' AND table_name='phone_reveal_suppression_audit'
              AND column_name IN ('official_phone_sources_suppressed','official_phone_rows_tombstoned')
            ORDER BY column_name`,
        );
        assert.equal(rows.length, 2);
        for (const row of rows) {
          assert.equal(row.is_nullable, 'NO');
          assert.equal(row.column_default, '0');
          assert.equal(row.data_type, 'integer');
        }
      });

      it('las CHECK `>= 0` de los contadores están activas', async () => {
        const attempt = await q(
          `INSERT INTO public.phone_reveal_suppression_audit
             (provider_person_id_hash, account_id, reason_code, official_phone_sources_suppressed)
           VALUES ($1, $2, 'dsar_erasure_request', -1)`,
          ['a'.repeat(64), ACCOUNT_ID],
        ).then(
          () => null,
          (error: { code?: string }) => error.code,
        );
        assert.equal(attempt, '23514', 'un contador negativo debe violar la CHECK');
      });

      it('la fila de auditoría que construye el core INSERTA sin fricción', async () => {
        // El SQL se DERIVA de la fila del core: si el core añadiera una columna que la 115 no
        // creó, esto falla en vez de descubrirse en Producción.
        const row = buildPhoneCacheSuppressionAuditRow({
          plan: {
            providerPersonId: 'a'.repeat(24),
            accountId: ACCOUNT_ID,
            countryCode: 'CO',
            reasonCode: 'dsar_erasure_request',
            actorUserId: ACTOR_ID,
            cacheEntryPatch: {} as never,
            tombstoneInsertRow: {} as never,
            candidatePatches: [],
            contactPatches: [],
            officialContactTargets: [{ contactId: 'x', linkStrength: 'provenance_proven' }],
          } as never,
          providerPersonIdHash: 'b'.repeat(64),
          cacheRowsSuppressed: 1,
          tombstoneCreated: false,
          candidatesCleared: 1,
          candidatePhoneRowsSuppressed: 2,
          candidatePhoneSurvivorCount: 0,
          candidatePhonePrimaryChanged: true,
          contactsCleared: 1,
          officialPhoneSourcesSuppressed: 3,
          officialPhoneRowsTombstoned: 2,
          officialPhoneContactsTargeted: 1,
          officialPhoneSurvivorCount: 1,
          officialPhonePrimaryChanged: true,
          officialPhoneScalarGuarded: 1,
        });
        const columns = Object.keys(row);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const values = columns.map((column) => {
          const value = (row as unknown as Record<string, unknown>)[column];
          return column === 'metadata' ? JSON.stringify(value) : value;
        });
        const { rows } = await q(
          `INSERT INTO public.phone_reveal_suppression_audit (${columns.join(', ')})
           VALUES (${placeholders})
           RETURNING official_phone_sources_suppressed, official_phone_rows_tombstoned, metadata`,
          values,
        );
        assert.equal(rows[0].official_phone_sources_suppressed, 3);
        assert.equal(rows[0].official_phone_rows_tombstoned, 2);
        const metadata = rows[0].metadata as Record<string, unknown>;
        assert.equal(metadata.official_phone_scalar_guarded, 1);
        assert.equal(metadata.official_phone_primary_changed, true);
        assert.equal(metadata.official_phone_contacts_targeted, 1);
        // Sin PII: ni un número, ni un email, ni un nombre, ni una `dedupe_key`.
        const serialized = JSON.stringify(rows[0]);
        assert.doesNotMatch(serialized, /\+1555|example\.invalid|Sintetico|e164:/);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 43 — inercia en Producción
    // ═══════════════════════════════════════════════════════════════

    describe('sin colección oficial (Producción hoy)', () => {
      it('un contacto sin `contact_phones` NO se toca en absoluto', async () => {
        // Es la propiedad que hace que este hito sea un no-op demostrable en Producción, donde
        // `contact_phones` tiene 0 filas.
        const contactId = await insertContact({
          phone: '+15550000099',
          phoneSource: 'apollo_reveal',
        });
        const before = await contactRow(contactId);
        const envelope = await suppress({ contactId });
        assert.equal(envelope.status, 'no_official_collection');
        assert.equal(envelope.contact_settled, true);
        assert.equal(envelope.sources_suppressed, 0);
        assert.equal(envelope.phones_tombstoned, 0);
        assert.equal(envelope.scalar_synced, false);
        assert.deepEqual(await contactRow(contactId), before);
      });

      it('un contacto inexistente devuelve `contact_not_found` y no liquida', async () => {
        const envelope = await suppress({
          contactId: '99999999-9999-4999-8999-999999999999',
        });
        assert.equal(envelope.status, 'contact_not_found');
      });

      it('un contacto con SÓLO tombstones tampoco reproyecta el escalar', async () => {
        // `v_official_rows` cuenta también los tombstones a propósito: la colección EXISTE,
        // simplemente está vacía de números vivos, y ese caso sí es del modelo oficial.
        const contactId = await insertContact({ phone: null, phoneSource: null });
        await q(
          `INSERT INTO public.contact_phones
             (contact_id, dedupe_key, suppressed_at, suppression_reason, suppressed_by)
           VALUES ($1, $2, $3, 'data_subject_request', $4)`,
          [contactId, key('z'), NOW, ACTOR_ID],
        );
        const envelope = await suppress({ contactId });
        assert.notEqual(envelope.status, 'no_official_collection');
        assert.equal(envelope.status, 'already_suppressed');
        assert.equal(envelope.survivor_count, 0);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 45 / § 12 — borrado parcial con dos procedencias
    // ═══════════════════════════════════════════════════════════════

    describe('§ 12 — supervivencia CRUZADA: Apollo se retira, Lusha sostiene', () => {
      it('retirar Apollo deja la procedencia de Lusha VIVA y el número vivo y principal', async () => {
        const { contactId, phoneId, apolloId, lushaId } = await dualSourced();

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });

        assert.equal(envelope.status, 'suppressed');
        assert.equal(envelope.sources_suppressed, 1);
        assert.equal(envelope.phones_tombstoned, 0, 'Lusha sostiene el número: 0 tombstones');
        assert.equal(envelope.survivor_count, 1);
        assert.equal(envelope.primary_changed, false);

        const apollo = await sourceRow(apolloId);
        assert.notEqual(apollo.suppressed_at, null);
        assert.equal(apollo.suppression_reason, 'data_subject_request');
        assert.equal(apollo.suppressed_by, ACTOR_ID);

        const lusha = await sourceRow(lushaId);
        assert.equal(lusha.suppressed_at, null, 'la procedencia de Lusha sigue viva');

        const phone = await phoneRow(phoneId);
        assert.equal(phone.suppressed_at, null, 'el número canónico sigue vivo');
        assert.equal(phone.normalized_phone, '+15550000001');
        assert.equal(phone.is_primary, true, 'sigue siendo el principal');
      });

      it('la procedencia retirada CONSERVA toda su evidencia', async () => {
        // Una fuente retirada deja de justificar un número vivo, pero sigue siendo la prueba de
        // que la observación ocurrió y de qué operación la pagó.
        const { contactId, apolloId } = await dualSourced();
        const before = await sourceRow(apolloId);
        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });
        const after = await sourceRow(apolloId);
        assert.equal(after.provider, before.provider);
        assert.equal(after.acquisition_mode, before.acquisition_mode);
        assert.equal(after.raw_provider_type, before.raw_provider_type);
        assert.equal(after.source_event_key, before.source_event_key);
        assert.deepEqual(after.observed_at, before.observed_at);
      });

      it('NADA se borra: las filas siguen ahí', async () => {
        const { contactId, phoneId } = await dualSourced();
        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });
        const { rows } = await q(
          `SELECT count(*)::int AS n FROM public.contact_phone_sources WHERE contact_phone_id = $1`,
          [phoneId],
        );
        assert.equal(rows[0].n, 2, 'las dos procedencias siguen existiendo');
      });

      it('§ 23 — el escalar deja de afirmar la procedencia RETIRADA (Apollo → Lusha)', async () => {
        // Un escalar que siguiera diciendo `apollo_reveal` estaría afirmando una procedencia ya
        // suprimida. La proyección mira SÓLO fuentes vivas, así que pasa a Lusha.
        const { contactId } = await dualSourced('apollo_reveal');
        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });
        assert.equal(envelope.scalar_synced, true);
        assert.equal(envelope.scalar_guarded_by_provenance, false);

        const contact = await contactRow(contactId);
        assert.equal(contact.phone_source, 'lusha_reveal');
        assert.equal(contact.phone, '+15550000001', 'el número no cambia: sigue vivo');
      });

      it('§ 24 — la metadata de Apollo NO se conserva junto a una procedencia de Lusha', async () => {
        const { contactId } = await dualSourced('apollo_reveal');
        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });
        const contact = await contactRow(contactId);
        // `raw_provider_type` se re-deriva de la fuente SUPERVIVIENTE (Lusha: 'mobile'), no se
        // arrastra el 'work_hq' que declaró Apollo.
        assert.equal(contact.phone_raw_type, 'mobile');
        assert.notEqual(contact.phone_raw_type, 'work_hq');
        // Y la base legal, que la 115 no puede justificar, se limpia en vez de fabricarse.
        assert.equal(contact.phone_processing_basis, null);
      });

      it('§ 25 — `phone_confidence` no se puebla: sigue muerta', async () => {
        const { contactId } = await dualSourced('apollo_reveal');
        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });
        assert.equal((await contactRow(contactId)).phone_confidence, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 46 / § 13 — la última procedencia
    // ═══════════════════════════════════════════════════════════════

    describe('§ 13 — la ÚLTIMA procedencia: tombstone', () => {
      it('retirar Lusha después deja el canónico en TOMBSTONE', async () => {
        const { contactId, phoneId, lushaId } = await dualSourced('apollo_reveal');
        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'lusha',
          suppressedAt: LATER,
        });

        assert.equal(envelope.status, 'suppressed');
        assert.equal(envelope.sources_suppressed, 1);
        assert.equal(envelope.phones_tombstoned, 1);
        assert.equal(envelope.survivor_count, 0);

        assert.notEqual((await sourceRow(lushaId)).suppressed_at, null);

        const phone = await phoneRow(phoneId);
        assert.equal(phone.normalized_phone, null);
        assert.equal(phone.display_phone, null);
        assert.equal(phone.phone_type, null);
        assert.equal(phone.is_primary, false);
        assert.notEqual(phone.suppressed_at, null);
        assert.equal(phone.suppression_reason, 'data_subject_request');
        assert.equal(phone.suppressed_by, ACTOR_ID);
      });

      it('el tombstone CONSERVA `dedupe_key`, `contact_id` y `created_at`', async () => {
        const { contactId, phoneId } = await dualSourced('apollo_reveal');
        const before = await phoneRow(phoneId);
        await suppress({ contactId });
        const after = await phoneRow(phoneId);
        assert.equal(after.dedupe_key, before.dedupe_key);
        assert.equal(after.contact_id, before.contact_id);
        assert.deepEqual(after.created_at, before.created_at);
      });

      it('§ 52 — sin alternativas, `contacts.phone` queda NULL y la tupla limpia', async () => {
        const { contactId } = await dualSourced('apollo_reveal');
        const envelope = await suppress({ contactId });
        assert.equal(envelope.phones_tombstoned, 1);

        const contact = await contactRow(contactId);
        assert.equal(contact.phone, null);
        assert.equal(contact.phone_type, null);
        assert.equal(contact.phone_source, null);
        assert.equal(contact.phone_raw_type, null);
        assert.equal(contact.phone_revealed_at, null);
        assert.equal(contact.phone_processing_basis, null);
        assert.equal(contact.phone_confidence, null);
      });

      it('§ 26 — `mobile_phone` NO se toca (MOBILE_PHONE_PROVENANCE_PENDING)', async () => {
        // No tiene columna de procedencia (4O-E4.1): un borrado por proveedor no puede saber si
        // el número lo puso el proveedor que borra o una persona.
        const contactId = await insertContact({
          phone: '+15550000001',
          phoneSource: 'apollo_reveal',
          mobilePhone: '+15559999999',
        });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000001',
          isPrimary: true,
        });
        await insertSource({
          phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-mob-1',
        });
        await suppress({ contactId });
        const contact = await contactRow(contactId);
        assert.equal(contact.phone, null);
        assert.equal(contact.mobile_phone, '+15559999999', 'mobile_phone SOBREVIVE');
      });

      it('el alcance de PERSONA retira Apollo y Lusha de una vez', async () => {
        // Es lo que la DSAR cableada hace: cablearla a un solo proveedor habría dejado el número
        // vivo por la otra procedencia.
        const { contactId, phoneId, apolloId, lushaId } = await dualSourced('apollo_reveal');
        const envelope = await suppress({ contactId, scope: 'all_suppressible_providers' });
        assert.equal(envelope.sources_suppressed, 2);
        assert.equal(envelope.phones_tombstoned, 1);
        assert.notEqual((await sourceRow(apolloId)).suppressed_at, null);
        assert.notEqual((await sourceRow(lushaId)).suppressed_at, null);
        assert.notEqual((await phoneRow(phoneId)).suppressed_at, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 47 / § 48 — procedencias PROTEGIDAS
    // ═══════════════════════════════════════════════════════════════

    describe('§ 47 / § 48 — `manual` y `unknown` sobreviven', () => {
      it('§ 47 — `manual` sobrevive a una supresión de Apollo, y el número con ella', async () => {
        const contactId = await insertContact({
          phone: '+15550000002',
          phoneSource: 'manual',
        });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('b'),
          phone: '+15550000002',
          isPrimary: true,
        });
        const manualId = await insertSource({
          phoneId,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-manual-1',
        });
        const apolloId = await insertSource({
          phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-apollo-2',
        });

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });

        assert.equal(envelope.sources_suppressed, 1);
        assert.equal(envelope.phones_tombstoned, 0);
        assert.notEqual((await sourceRow(apolloId)).suppressed_at, null);
        assert.equal((await sourceRow(manualId)).suppressed_at, null, 'manual sigue viva');
        assert.equal((await phoneRow(phoneId)).suppressed_at, null);
      });

      it('§ 47 — el alcance de PERSONA tampoco puede retirar `manual`', async () => {
        // Una DSAR dirigida a proveedores no tiene autoridad sobre evidencia que escribió una
        // persona, ni cuando pide «todos».
        const contactId = await insertContact({ phone: '+15550000003', phoneSource: 'manual' });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('c'),
          phone: '+15550000003',
          isPrimary: true,
        });
        const manualId = await insertSource({
          phoneId,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-manual-2',
        });
        const envelope = await suppress({ contactId, scope: 'all_suppressible_providers' });
        assert.equal(envelope.sources_suppressed, 0);
        assert.equal(envelope.phones_tombstoned, 0);
        assert.equal((await sourceRow(manualId)).suppressed_at, null);
        assert.equal((await phoneRow(phoneId)).suppressed_at, null);
      });

      it('§ 48 — `unknown` sobrevive: nadie AFIRMA que era de Apollo', async () => {
        const contactId = await insertContact({
          phone: '+15550000004',
          phoneSource: 'apollo_reveal',
        });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('d'),
          phone: '+15550000004',
          isPrimary: true,
        });
        const unknownId = await insertSource({
          phoneId,
          provider: 'unknown',
          acquisitionMode: 'search',
          eventKey: 'ev-unknown-1',
        });
        const apolloId = await insertSource({
          phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-apollo-3',
        });

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });

        assert.equal(envelope.sources_suppressed, 1);
        assert.equal(envelope.phones_tombstoned, 0, 'el canónico sobrevive por `unknown`');
        assert.equal((await sourceRow(unknownId)).suppressed_at, null);
        assert.notEqual((await sourceRow(apolloId)).suppressed_at, null);
      });

      it('`(apollo, search)` sobrevive a una supresión de Apollo — DECLARADO', () => {
        return (async () => {
          // El contrato heredado nunca autorizó destruir un escalar `apollo_search`, y
          // ensanchar el radio de la DSAR de camino al modelo oficial sería inventarse una
          // autoridad que nadie concedió.
          const contactId = await insertContact({
            phone: '+15550000005',
            phoneSource: 'apollo_search',
          });
          const phoneId = await insertPhone({
            contactId,
            dedupeKey: key('e'),
            phone: '+15550000005',
            isPrimary: true,
          });
          const searchId = await insertSource({
            phoneId,
            provider: 'apollo',
            acquisitionMode: 'search',
            eventKey: 'ev-search-1',
          });
          const envelope = await suppress({
            contactId,
            scope: 'single_provider',
            provider: 'apollo',
          });
          assert.equal(envelope.sources_suppressed, 0);
          assert.equal((await sourceRow(searchId)).suppressed_at, null);
          assert.equal((await phoneRow(phoneId)).suppressed_at, null);
        })();
      });

      it('§ 27 — un escalar `manual` NO se borra ni se sobrescribe', async () => {
        // El escalar queda ENTERAMENTE intacto: ni limpiado, ni reemplazado por el número del
        // proveedor. Sobrescribirlo lo destruiría igual de bien que nularlo.
        const contactId = await insertContact({
          phone: '+15558888888',
          phoneSource: 'manual',
          phoneType: 'work',
        });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('f'),
          phone: '+15550000006',
          isPrimary: true,
        });
        await insertSource({
          phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-apollo-4',
        });
        const before = await contactRow(contactId);

        const envelope = await suppress({ contactId });

        assert.equal(envelope.scalar_guarded_by_provenance, true);
        assert.equal(envelope.scalar_synced, false);
        assert.equal(envelope.phones_tombstoned, 1, 'la colección oficial SÍ se borró');
        assert.deepEqual(await contactRow(contactId), before, 'el escalar quedó intacto');
      });

      it('lo mismo con `unknown`, `apollo_search`, `provider_payload` y NULL', async () => {
        for (const phoneSource of [
          'unknown',
          'apollo_search',
          'provider_payload',
          null,
        ] as const) {
          const contactId = await insertContact({
            phone: '+15557777777',
            phoneSource,
          });
          const phoneId = await insertPhone({
            contactId,
            dedupeKey: key('g'),
            phone: '+15550000007',
            isPrimary: true,
          });
          await insertSource({
            phoneId,
            provider: 'lusha',
            acquisitionMode: 'reveal',
            eventKey: `ev-lusha-guard-${phoneSource ?? 'null'}`,
          });
          const before = await contactRow(contactId);
          const envelope = await suppress({ contactId });
          assert.equal(
            envelope.scalar_guarded_by_provenance,
            true,
            `${phoneSource} debe guardar el escalar`,
          );
          assert.equal(envelope.phones_tombstoned, 1);
          assert.deepEqual(await contactRow(contactId), before);
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 49 / § 50 / § 51 — reelección del principal
    // ═══════════════════════════════════════════════════════════════

    describe('§ 14 / § 49 / § 50 / § 51 — reelección del principal', () => {
      it('§ 51 — el titular VIVO no se mueve, aunque otro puntúe más alto', async () => {
        // ESTABILIDAD DEL TITULAR: reordenar en cada borrado movería el número que el producto
        // entero muestra por razones ajenas a la petición.
        const contactId = await insertContact({
          phone: '+15550000010',
          phoneSource: 'apollo_reveal',
        });
        // Titular: `work` (peor tipo), sostenido por Lusha.
        const incumbent = await insertPhone({
          contactId,
          dedupeKey: key('h'),
          phone: '+15550000010',
          phoneType: 'work',
          isPrimary: true,
        });
        await insertSource({
          phoneId: incumbent,
          provider: 'lusha',
          acquisitionMode: 'reveal',
          eventKey: 'ev-inc-1',
        });
        // Rival mejor: `personal_mobile`, y con procedencia protegida para que sobreviva.
        const better = await insertPhone({
          contactId,
          dedupeKey: key('i'),
          phone: '+15550000011',
          phoneType: 'personal_mobile',
        });
        await insertSource({
          phoneId: better,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-better-1',
        });

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });

        assert.equal(envelope.sources_suppressed, 0, 'no había nada de Apollo que retirar');
        assert.equal(envelope.primary_changed, false);
        assert.equal((await phoneRow(incumbent)).is_primary, true, 'el titular NO se movió');
        assert.equal((await phoneRow(better)).is_primary, false);
      });

      it('§ 49 — precedencia MANUAL: gana un `work` manual a un `personal_mobile` de proveedor', async () => {
        // `manual` es un TIER previo a la escalera de tipo, no una rung de ella: ninguna
        // reordenación de una sola escalera puede expresar esto.
        const contactId = await insertContact({
          phone: '+15550000020',
          phoneSource: 'apollo_reveal',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('j'),
          phone: '+15550000020',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-dying-1',
        });
        const manualWork = await insertPhone({
          contactId,
          dedupeKey: key('k'),
          phone: '+15550000021',
          phoneType: 'work',
        });
        await insertSource({
          phoneId: manualWork,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-mw-1',
        });
        const providerMobile = await insertPhone({
          contactId,
          dedupeKey: key('l'),
          phone: '+15550000022',
          phoneType: 'personal_mobile',
        });
        await insertSource({
          phoneId: providerMobile,
          provider: 'lusha',
          acquisitionMode: 'reveal',
          eventKey: 'ev-pm-1',
        });

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });

        assert.equal(envelope.phones_tombstoned, 1);
        assert.equal(envelope.primary_changed, true);
        assert.equal(
          (await phoneRow(manualWork)).is_primary,
          true,
          'el tier manual gana a un mejor PhoneType de proveedor',
        );
        assert.equal((await phoneRow(providerMobile)).is_primary, false);
        assert.equal((await phoneRow(dying)).is_primary, false);
      });

      it('el tier manual sólo cuenta si la procedencia manual está VIVA', async () => {
        const contactId = await insertContact({
          phone: '+15550000030',
          phoneSource: 'apollo_reveal',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('m'),
          phone: '+15550000030',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-d2',
        });
        // Un `work` cuya única procedencia manual está YA retirada: no puede ganar el tier.
        const staleManual = await insertPhone({
          contactId,
          dedupeKey: key('n'),
          phone: '+15550000031',
          phoneType: 'work',
        });
        const staleSource = await insertSource({
          phoneId: staleManual,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-stale-1',
        });
        await q(
          `UPDATE public.contact_phone_sources
              SET suppressed_at=$2, suppression_reason='operator_request', suppressed_by=$3
            WHERE id=$1`,
          [staleSource, NOW, ACTOR_ID],
        );
        const providerMobile = await insertPhone({
          contactId,
          dedupeKey: key('o'),
          phone: '+15550000032',
          phoneType: 'personal_mobile',
        });
        await insertSource({
          phoneId: providerMobile,
          provider: 'lusha',
          acquisitionMode: 'reveal',
          eventKey: 'ev-pm-2',
        });

        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });

        // `staleManual` se tombstonea (perdió su última fuente viva) y gana el `personal_mobile`.
        assert.notEqual((await phoneRow(staleManual)).suppressed_at, null);
        assert.equal((await phoneRow(providerMobile)).is_primary, true);
      });

      it('§ 50 — sin manuales gana el mejor PhoneType (`mobile` > `direct_dial` > `work`)', async () => {
        const contactId = await insertContact({
          phone: '+15550000040',
          phoneSource: 'apollo_reveal',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('p'),
          phone: '+15550000040',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-d3',
        });
        const byType: Record<string, string> = {};
        for (const [letter, phoneType] of [
          ['q', 'work'],
          ['r', 'direct_dial'],
          ['s', 'mobile'],
        ] as const) {
          const id = await insertPhone({
            contactId,
            dedupeKey: key(letter),
            phone: `+1555000004${letter.charCodeAt(0) % 10}`,
            phoneType,
          });
          await insertSource({
            phoneId: id,
            provider: 'unknown',
            acquisitionMode: 'search',
            eventKey: `ev-type-${phoneType}`,
          });
          byType[phoneType] = id;
        }

        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });

        assert.equal((await phoneRow(byType.mobile)).is_primary, true);
        assert.equal((await phoneRow(byType.direct_dial)).is_primary, false);
        assert.equal((await phoneRow(byType.work)).is_primary, false);
      });

      it('§ 17 — el desempate NO depende del orden físico de las filas', async () => {
        // Dos filas idénticas en tier, tipo, estado y procedencia: decide `dedupe_key ASC`, que
        // es NOT NULL y única por contacto, así que el comparador es TOTAL.
        const contactId = await insertContact({
          phone: '+15550000050',
          phoneSource: 'apollo_reveal',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('z'),
          phone: '+15550000050',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-d4',
        });
        // Se insertan en orden INVERSO al alfabético para que el orden físico contradiga al
        // esperado: si el ORDER BY no fuera total, ganaría el insertado primero.
        const high = await insertPhone({
          contactId,
          dedupeKey: key('u'),
          phone: '+15550000052',
          phoneType: 'mobile',
        });
        await insertSource({
          phoneId: high,
          provider: 'unknown',
          acquisitionMode: 'search',
          eventKey: 'ev-tie-u',
        });
        const low = await insertPhone({
          contactId,
          dedupeKey: key('t'),
          phone: '+15550000051',
          phoneType: 'mobile',
        });
        await insertSource({
          phoneId: low,
          provider: 'unknown',
          acquisitionMode: 'search',
          eventKey: 'ev-tie-t',
        });

        await suppress({ contactId, scope: 'single_provider', provider: 'apollo' });

        assert.equal(
          (await phoneRow(low)).is_primary,
          true,
          'gana la `dedupe_key` menor, no la insertada antes',
        );
        assert.equal((await phoneRow(high)).is_primary, false);
      });

      it('§ 19 — cuando el principal cambia, `contacts.phone` se sincroniza', async () => {
        const contactId = await insertContact({
          phone: '+15550000060',
          phoneSource: 'apollo_reveal',
          phoneType: 'mobile',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('v'),
          phone: '+15550000060',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-d5',
        });
        const survivor = await insertPhone({
          contactId,
          dedupeKey: key('w'),
          phone: '+15550000061',
          phoneType: 'direct_dial',
        });
        await insertSource({
          phoneId: survivor,
          provider: 'lusha',
          acquisitionMode: 'reveal',
          eventKey: 'ev-surv-1',
          rawType: 'direct',
          observedAt: LATER,
        });

        const envelope = await suppress({
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });

        assert.equal(envelope.primary_changed, true);
        assert.equal(envelope.scalar_synced, true);
        const contact = await contactRow(contactId);
        assert.equal(contact.phone, '+15550000061');
        assert.equal(contact.phone_type, 'direct_dial');
        assert.equal(contact.phone_source, 'lusha_reveal');
        assert.equal(contact.phone_raw_type, 'direct');
      });

      it('nunca quedan dos principales, ni cero con supervivientes elegibles', async () => {
        const { rows } = await q(`
          SELECT contact_id, count(*)::int AS n
            FROM public.contact_phones
           WHERE is_primary
           GROUP BY contact_id HAVING count(*) > 1`);
        assert.deepEqual(rows, [], 'el índice único parcial no admite dos principales');

        const orphans = await q(`
          SELECT p.contact_id
            FROM public.contact_phones p
           WHERE p.suppressed_at IS NULL
             AND p.normalized_phone IS NOT NULL
             AND p.phone_status <> 'invalid'
             AND NOT EXISTS (
               SELECT 1 FROM public.contact_phones q
                WHERE q.contact_id = p.contact_id AND q.is_primary)
           GROUP BY p.contact_id`);
        assert.deepEqual(
          orphans.rows,
          [],
          'un contacto con números elegibles debe tener principal',
        );
      });

      it('ninguna fila viva se queda sin procedencia viva', async () => {
        // La invariante que la regla del último origen existe para mantener: un número que el
        // modelo declara borrado y la base sigue sirviendo.
        const { rows } = await q(`
          SELECT p.id FROM public.contact_phones p
           WHERE p.suppressed_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM public.contact_phone_sources s
                WHERE s.contact_phone_id = p.id AND s.suppressed_at IS NULL)`);
        assert.deepEqual(rows, []);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 54 — idempotencia
    // ═══════════════════════════════════════════════════════════════

    describe('§ 30 / § 54 — idempotencia', () => {
      it('la segunda llamada no retira nada, no tombstonea nada y no oscila', async () => {
        const { contactId, phoneId } = await dualSourced('apollo_reveal');
        const first = await suppress({ contactId });
        assert.equal(first.status, 'suppressed');

        const contactAfterFirst = await contactRow(contactId);
        const phoneAfterFirst = await phoneRow(phoneId);

        const second = await suppress({ contactId, suppressedAt: LATER });

        assert.equal(second.status, 'already_suppressed');
        assert.equal(second.sources_suppressed, 0);
        assert.equal(second.phones_tombstoned, 0);
        assert.equal(second.primary_changed, false);
        assert.equal(second.contact_settled, true, 'repetir NO es un error');
        assert.deepEqual(await contactRow(contactId), contactAfterFirst);
        assert.deepEqual(await phoneRow(phoneId), phoneAfterFirst);
      });

      it('la segunda llamada NO re-sella el tombstone con la fecha nueva', async () => {
        // Re-sellarlo reescribiría el actor y el momento de la erradicación, que es justo lo
        // que una auditoría de privacidad necesita estable.
        const { contactId, phoneId, apolloId } = await dualSourced('apollo_reveal');
        await suppress({ contactId });
        const phoneFirst = await phoneRow(phoneId);
        const sourceFirst = await sourceRow(apolloId);
        await suppress({ contactId, suppressedAt: LATER, reason: 'operator_request' });
        assert.deepEqual((await phoneRow(phoneId)).suppressed_at, phoneFirst.suppressed_at);
        assert.equal((await phoneRow(phoneId)).suppression_reason, 'data_subject_request');
        assert.deepEqual((await sourceRow(apolloId)).suppressed_at, sourceFirst.suppressed_at);
      });

      it('un `dedupe_key` que no existe no borra nada', async () => {
        const { contactId, phoneId } = await dualSourced('apollo_reveal');
        const envelope = await suppress({ contactId, dedupeKey: key('y') });
        assert.equal(envelope.sources_suppressed, 0);
        assert.equal(envelope.phones_tombstoned, 0);
        assert.equal((await phoneRow(phoneId)).suppressed_at, null);
      });

      it('un `dedupe_key` concreto acota el borrado a UN número', async () => {
        const contactId = await insertContact({
          phone: '+15550000070',
          phoneSource: 'apollo_reveal',
        });
        const target = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000070',
          isPrimary: true,
        });
        await insertSource({
          phoneId: target,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-t1',
        });
        const spared = await insertPhone({
          contactId,
          dedupeKey: key('b'),
          phone: '+15550000071',
        });
        await insertSource({
          phoneId: spared,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-t2',
        });

        const envelope = await suppress({ contactId, dedupeKey: key('a') });

        assert.equal(envelope.sources_suppressed, 1);
        assert.equal(envelope.phones_tombstoned, 1);
        assert.notEqual((await phoneRow(target)).suppressed_at, null);
        assert.equal((await phoneRow(spared)).suppressed_at, null, 'el otro número se salva');
        assert.equal((await phoneRow(spared)).is_primary, true, 'y hereda el principal');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 0 — validación fail-closed
    // ═══════════════════════════════════════════════════════════════

    describe('validación fail-closed', () => {
      const raw = async (args: unknown[]) => {
        const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
        const { rows } = await client.query(
          `SELECT public.${FN}(${placeholders}) AS envelope`,
          args,
        );
        return rows[0].envelope as Record<string, unknown>;
      };

      it('un alcance desconocido es `invalid_input`, no una coincidencia vacía', async () => {
        const envelope = await raw([
          null,
          'todos_los_proveedores',
          null,
          null,
          'data_subject_request',
          ACTOR_ID,
          NOW,
        ]);
        assert.equal(envelope.status, 'invalid_input');
        assert.equal(envelope.detail, 'contact_id_missing');
      });

      it('cada arma de validación rechaza SIN escribir', async () => {
        const { contactId, phoneId } = await dualSourced('apollo_reveal');
        const cases: Array<[unknown[], string]> = [
          [[null, 'single_provider', 'apollo', null, 'data_subject_request', ACTOR_ID, NOW], 'contact_id_missing'],
          [[contactId, 'nope', null, null, 'data_subject_request', ACTOR_ID, NOW], 'provider_scope_unknown'],
          [[contactId, 'single_provider', null, null, 'data_subject_request', ACTOR_ID, NOW], 'provider_unknown'],
          [[contactId, 'single_provider', 'salesforce', null, 'data_subject_request', ACTOR_ID, NOW], 'provider_unknown'],
          [[contactId, 'all_suppressible_providers', 'apollo', null, 'data_subject_request', ACTOR_ID, NOW], 'provider_not_allowed'],
          [[contactId, 'all_suppressible_providers', null, '   ', 'data_subject_request', ACTOR_ID, NOW], 'dedupe_key_blank'],
          [[contactId, 'all_suppressible_providers', null, null, 'dsar_erasure_request', ACTOR_ID, NOW], 'suppression_reason_unknown'],
          [[contactId, 'all_suppressible_providers', null, null, null, ACTOR_ID, NOW], 'suppression_reason_unknown'],
          [[contactId, 'all_suppressible_providers', null, null, 'data_subject_request', ACTOR_ID, null], 'suppressed_at_missing'],
        ];
        for (const [args, detail] of cases) {
          const envelope = await raw(args);
          assert.equal(envelope.status, 'invalid_input', `${detail} debía rechazar`);
          assert.equal(envelope.detail, detail);
        }
        // Nada se escribió en ninguno de los nueve rechazos.
        assert.equal((await phoneRow(phoneId)).suppressed_at, null);
        assert.deepEqual((await contactRow(contactId)).phone, '+15550000001');
      });

      it('el vocabulario de la caché/auditoría (099) NO es aceptable como motivo', async () => {
        // Los dos conjuntos comparten CERO valores: un pass-through fallaría la CHECK en el
        // 100% de las filas — el 23514 de #238.
        const { contactId } = await dualSourced('apollo_reveal');
        for (const reason of [
          'dsar_erasure_request',
          'do_not_contact_request',
          'legal_privacy_request',
          'admin_privacy_correction',
          'test_synthetic',
        ]) {
          const envelope = await raw([
            contactId,
            'all_suppressible_providers',
            null,
            null,
            reason,
            ACTOR_ID,
            NOW,
          ]);
          assert.equal(envelope.status, 'invalid_input');
          assert.equal(envelope.detail, 'suppression_reason_unknown');
        }
      });

      it('los tres motivos de la 114 SÍ se aceptan', async () => {
        for (const reason of [
          'data_subject_request',
          'operator_request',
          'provider_retraction',
        ] as const) {
          const { contactId } = await dualSourced('apollo_reveal');
          const envelope = await suppress({ contactId, reason });
          assert.equal(envelope.status, 'suppressed', `${reason} debía aceptarse`);
        }
      });

      it('el sobre NUNCA contiene un número de teléfono', async () => {
        const { contactId } = await dualSourced('apollo_reveal');
        const envelope = await suppress({ contactId });
        assert.doesNotMatch(JSON.stringify(envelope), /\+1555|5550000/);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 56 — el tombstone bloquea la reinserción
    // ═══════════════════════════════════════════════════════════════

    describe('§ 56 — el tombstone BLOQUEA la reinserción', () => {
      it('reinsertar el mismo `(contact_id, dedupe_key)` viola la UNIQUE', async () => {
        // Es la razón de que la supresión no borre la fila: la fila ES el bloqueo. Si se
        // borrara, la siguiente observación reinsertaría el número como si nada.
        const { contactId, phoneId } = await dualSourced('apollo_reveal');
        await suppress({ contactId });
        assert.notEqual((await phoneRow(phoneId)).suppressed_at, null);

        const code = await q(
          `INSERT INTO public.contact_phones
             (contact_id, dedupe_key, normalized_phone, display_phone, phone_type)
           VALUES ($1, $2, $3, $3, 'mobile')`,
          [contactId, key('a'), '+15550000001'],
        ).then(
          () => null,
          (error: { code?: string }) => error.code,
        );
        assert.equal(code, UNIQUE_VIOLATION);
      });

      it('nadie tiene DELETE sobre la canónica ni sobre las procedencias', async () => {
        for (const table of ['contact_phones', 'contact_phone_sources']) {
          for (const role of ['anon', 'authenticated', 'service_role']) {
            const { rows } = await q(`SELECT has_table_privilege($1, $2, 'DELETE') AS ok`, [
              role,
              `public.${table}`,
            ]);
            assert.equal(rows[0].ok, false, `${role} no puede tener DELETE en ${table}`);
          }
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 57 / § 58 — privilegios
    // ═══════════════════════════════════════════════════════════════

    describe('§ 57 — la 115 NO ensancha el techo de la 114', () => {
      it('el catálogo de GRANTs de las dos tablas sigue congelado', async () => {
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
          assert.deepEqual(
            Object.fromEntries(rows.map((row) => [row.grantee, row.g])),
            expected,
            `los GRANTs de ${table} cambiaron con la 115`,
          );
        }
      });

      it('el UPDATE de tabla en procedencias sigue siendo FALSE', async () => {
        const { rows } = await q(
          `SELECT has_table_privilege('service_role','public.contact_phone_sources','UPDATE') AS ok`,
        );
        assert.equal(
          rows[0].ok,
          false,
          'un UPDATE de TABLA haría reescribible la procedencia',
        );
      });

      it('el UPDATE por COLUMNA sigue siendo EXACTAMENTE la tríada', async () => {
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

      it('anon y PUBLIC siguen sin NADA en las dos tablas', async () => {
        const { rows } = await q(`
          SELECT table_name, grantee, privilege_type
            FROM information_schema.role_table_grants
           WHERE table_schema='public'
             AND table_name IN ('contact_phones','contact_phone_sources')
             AND grantee IN ('anon','PUBLIC')`);
        assert.deepEqual(rows, []);
      });

      it('la auditoría sigue siendo append-only (SELECT + INSERT, sin UPDATE ni DELETE)', async () => {
        const { rows } = await q(
          `SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS g
             FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='phone_reveal_suppression_audit'
              AND grantee <> 'postgres'
            GROUP BY grantee ORDER BY grantee`,
        );
        assert.deepEqual(Object.fromEntries(rows.map((r) => [r.grantee, r.g])), {
          service_role: 'INSERT,SELECT',
        });
      });
    });

    describe('§ 58 — quién puede INVOCAR el borrado', () => {
      const executeAs = async (role: string) => {
        await q('BEGIN');
        try {
          await q(`SET LOCAL ROLE ${role}`);
          await q(
            `SELECT public.${FN}(NULL::uuid, 'single_provider', 'apollo', NULL,
                                 'data_subject_request', NULL::uuid, now())`,
          );
          return null;
        } catch (error) {
          return (error as { code?: string }).code ?? 'unknown';
        } finally {
          await q('ROLLBACK');
        }
      };

      it('anon NO puede invocarla', async () => {
        assert.equal(await executeAs('anon'), INSUFFICIENT_PRIVILEGE);
      });

      it('authenticated NO puede invocarla', async () => {
        // Un navegador no puede iniciar un borrado: la autorización es de la server action, que
        // es sólo ADMIN.
        assert.equal(await executeAs('authenticated'), INSUFFICIENT_PRIVILEGE);
      });

      it('service_role SÍ puede invocarla', async () => {
        assert.equal(await executeAs('service_role'), null);
      });

      it('el catálogo confirma que sólo postgres y service_role tienen EXECUTE', async () => {
        const { rows } = await q(
          `SELECT coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC') AS grantee
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            CROSS JOIN aclexplode(p.proacl) a
            WHERE n.nspname='public' AND p.proname=$1 AND a.privilege_type='EXECUTE'
            ORDER BY grantee`,
          [FN],
        );
        assert.deepEqual(
          rows.map((row) => row.grantee).sort(),
          ['postgres', 'service_role'],
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 55 / § 31 — concurrencia real
    // ═══════════════════════════════════════════════════════════════

    describe('§ 31 / § 55 — dos borrados CONCURRENTES sobre el mismo número', () => {
      it('Apollo y Lusha en paralelo: ambas se retiran y el canónico queda tombstone', async () => {
        // Sin el lock del contacto, cada transacción podría ver la procedencia de la otra como
        // viva, ambas concluir que queda una fuente y ninguna tombstonear un número cuyas dos
        // últimas fuentes acaban de retirarse.
        const { contactId, phoneId, apolloId, lushaId } = await dualSourced('apollo_reveal');

        await client.query('BEGIN');
        await other.query('BEGIN');

        const apolloPromise = suppress({
          conn: client,
          contactId,
          scope: 'single_provider',
          provider: 'apollo',
        });
        // La primera toma el lock del contacto; la segunda espera en él.
        const first = await apolloPromise;
        assert.equal(first.status, 'suppressed');
        assert.equal(first.phones_tombstoned, 0, 'Lusha aún sostiene el número');

        const lushaPromise = suppress({
          conn: other,
          contactId,
          scope: 'single_provider',
          provider: 'lusha',
          suppressedAt: LATER,
        });

        await client.query('COMMIT');
        const second = await lushaPromise;
        await other.query('COMMIT');

        assert.equal(second.status, 'suppressed');
        assert.equal(
          second.phones_tombstoned,
          1,
          'la segunda ve la retirada de la primera y tombstonea',
        );

        assert.notEqual((await sourceRow(apolloId)).suppressed_at, null);
        assert.notEqual((await sourceRow(lushaId)).suppressed_at, null);
        const phone = await phoneRow(phoneId);
        assert.notEqual(phone.suppressed_at, null);
        assert.equal(phone.normalized_phone, null);
        assert.equal(phone.is_primary, false);
      });

      it('dos borrados IDÉNTICOS en paralelo no duplican conteos ni dejan dos principales', async () => {
        const contactId = await insertContact({
          phone: '+15550000080',
          phoneSource: 'apollo_reveal',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000080',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-cc-1',
        });
        const survivor = await insertPhone({
          contactId,
          dedupeKey: key('b'),
          phone: '+15550000081',
          phoneType: 'mobile',
        });
        await insertSource({
          phoneId: survivor,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-cc-2',
        });

        await client.query('BEGIN');
        const firstEnvelope = await suppress({ conn: client, contactId });
        await other.query('BEGIN');
        const secondPromise = suppress({ conn: other, contactId, suppressedAt: LATER });
        await client.query('COMMIT');
        const secondEnvelope = await secondPromise;
        await other.query('COMMIT');

        // Exactamente UNA retira; la otra observa el estado ya liquidado.
        const suppressedCounts = [
          Number(firstEnvelope.sources_suppressed),
          Number(secondEnvelope.sources_suppressed),
        ].sort();
        assert.deepEqual(suppressedCounts, [0, 1], 'la retirada no puede contarse dos veces');
        const tombstoned = [
          Number(firstEnvelope.phones_tombstoned),
          Number(secondEnvelope.phones_tombstoned),
        ].sort();
        assert.deepEqual(tombstoned, [0, 1]);

        const { rows } = await q(
          `SELECT count(*)::int AS n FROM public.contact_phones
            WHERE contact_id = $1 AND is_primary`,
          [contactId],
        );
        assert.equal(rows[0].n, 1, 'exactamente un principal');
        assert.equal((await phoneRow(survivor)).is_primary, true);
      });

      it('no hay deadlock sin manejar: el orden de locks es determinista', async () => {
        // Dos contactos, dos transacciones, órdenes cruzados. Los locks se toman por
        // `contacts.id` y luego por `contact_phones.id` ASC, así que no puede haber ciclo.
        const a = await dualSourced('apollo_reveal');
        const b = await dualSourced('lusha_reveal');

        await client.query('BEGIN');
        await other.query('BEGIN');
        const first = suppress({ conn: client, contactId: a.contactId });
        const second = suppress({ conn: other, contactId: b.contactId });
        const [envelopeA, envelopeB] = await Promise.all([first, second]);
        await client.query('COMMIT');
        await other.query('COMMIT');

        assert.equal(envelopeA.status, 'suppressed');
        assert.equal(envelopeB.status, 'suppressed');
        assert.notEqual((await phoneRow(a.phoneId)).suppressed_at, null);
        assert.notEqual((await phoneRow(b.phoneId)).suppressed_at, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 68 — sensibilidad a mutaciones
    // ═══════════════════════════════════════════════════════════════

    describe('§ 68 — las guardas son LOAD-BEARING', () => {
      /**
       * Aplica una COPIA MUTADA de la 115 (la función pasa a llamarse con un sufijo) y devuelve
       * un invocador. Comprueba que la mutación cambió algo ANTES de renombrar: el renombrado
       * cambia el texto siempre, así que compararlo después haría pasar una mutación vacía.
       */
      async function applyMutated(
        suffix: string,
        mutate: (sql: string) => string,
      ): Promise<(args: unknown[]) => Promise<Record<string, unknown>>> {
        const original = readMigration(MIGRATION_115);
        const mutated = mutate(original);
        assert.notEqual(mutated, original, 'la mutación no cambió nada: no probaría nada');
        // Sólo la FUNCIÓN se renombra; los ALTER TABLE de la auditoría son idempotentes.
        const renamed = mutated.replaceAll(FN, `${FN}_${suffix}`);
        await q(renamed);
        return async (args: unknown[]) => {
          const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
          const { rows } = await client.query(
            `SELECT public.${FN}_${suffix}(${placeholders}) AS envelope`,
            args,
          );
          return rows[0].envelope as Record<string, unknown>;
        };
      }

      const call = (contactId: string, provider: string | null = null) => [
        contactId,
        provider ? 'single_provider' : 'all_suppressible_providers',
        provider,
        null,
        'data_subject_request',
        ACTOR_ID,
        NOW,
      ];

      it('MUTANTE: si la retirada no filtra `suppressed_at IS NULL`, la idempotencia cae', async () => {
        const invoke = await applyMutated('m1', (sql) =>
          sql.replace('WHERE s.suppressed_at IS NULL\n     AND s.contact_phone_id IN (', 'WHERE s.contact_phone_id IN ('),
        );
        const { contactId, apolloId } = await dualSourced('apollo_reveal');
        await invoke(call(contactId));
        const firstStamp = (await sourceRow(apolloId)).suppressed_at;
        const second = await invoke([
          contactId,
          'all_suppressible_providers',
          null,
          null,
          'operator_request',
          ACTOR_ID,
          LATER,
        ]);
        // El mutante re-sella: la segunda llamada reporta retiradas y cambia el motivo.
        assert.notEqual(second.sources_suppressed, 0);
        assert.notDeepEqual((await sourceRow(apolloId)).suppressed_at, firstStamp);
      });

      it('MUTANTE: si `manual` entra en el predicado, la evidencia humana se destruye', async () => {
        const invoke = await applyMutated('m2', (sql) =>
          sql.replace(
            "       s.provider = 'apollo_cache'\n       OR s.provider = 'lusha'",
            "       s.provider = 'apollo_cache'\n       OR s.provider = 'manual'\n       OR s.provider = 'lusha'",
          ),
        );
        const contactId = await insertContact({ phone: '+15550000090', phoneSource: 'manual' });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000090',
          isPrimary: true,
        });
        const manualId = await insertSource({
          phoneId,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-mut-manual',
        });
        await invoke(call(contactId));
        // El mutante retira la procedencia manual y tombstonea el número. La 115 real no.
        assert.notEqual((await sourceRow(manualId)).suppressed_at, null);
        assert.notEqual((await phoneRow(phoneId)).suppressed_at, null);
      });

      it('MUTANTE: sin el `NOT EXISTS`, un número vivo pierde su última procedencia sin tombstone', async () => {
        const invoke = await applyMutated('m3', (sql) =>
          sql.replace(
            `     AND NOT EXISTS (
       SELECT 1 FROM public.contact_phone_sources s
       WHERE s.contact_phone_id = p.id
         AND s.suppressed_at IS NULL
     );`,
            '     AND false;',
          ),
        );
        const { contactId, phoneId } = await dualSourced('apollo_reveal');
        await invoke(call(contactId));
        // Todas las procedencias retiradas y el número SIGUE VIVO: exactamente el defecto.
        const { rows } = await q(
          `SELECT count(*)::int AS n FROM public.contact_phone_sources
            WHERE contact_phone_id = $1 AND suppressed_at IS NULL`,
          [phoneId],
        );
        assert.equal(rows[0].n, 0, 'el mutante retiró todo');
        assert.equal(
          (await phoneRow(phoneId)).suppressed_at,
          null,
          'y dejó vivo un número sin procedencia: el fallo que el NOT EXISTS evita',
        );
      });

      it('MUTANTE: sin la guarda de colección vacía, el escalar heredado se DESTRUYE', async () => {
        // El mutante que convierte privacidad en pérdida de datos: reproyecta desde un conjunto
        // vacío y nula un `contacts.phone` sobre el que el modelo oficial no tiene opinión.
        const invoke = await applyMutated('m4', (sql) =>
          sql.replace('IF v_official_rows = 0 THEN', 'IF false THEN'),
        );
        const contactId = await insertContact({
          phone: '+15550000091',
          phoneSource: 'apollo_reveal',
        });
        await invoke(call(contactId));
        assert.equal(
          (await contactRow(contactId)).phone,
          null,
          'el mutante borró un escalar sin colección oficial',
        );
      });

      it('MUTANTE: sin la guarda de procedencia, un escalar `manual` se borra', async () => {
        const invoke = await applyMutated('m5', (sql) =>
          sql.replace(
            "IF NOT (COALESCE(BTRIM(v_contact.phone_source), '') = ANY (c_suppressible_legacy_sources)) THEN",
            'IF false THEN',
          ),
        );
        const contactId = await insertContact({
          phone: '+15558888881',
          phoneSource: 'manual',
        });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000092',
          isPrimary: true,
        });
        await insertSource({
          phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-mut-guard',
        });
        await invoke(call(contactId));
        assert.equal(
          (await contactRow(contactId)).phone,
          null,
          'el mutante destruyó un teléfono manual: es «FIX M1» de 4O-E4 cayendo',
        );
      });

      it('MUTANTE: sin estabilidad del titular, el principal se mueve sin motivo', async () => {
        const invoke = await applyMutated('m6', (sql) =>
          sql.replace('IF v_incumbent_live THEN', 'IF false THEN'),
        );
        const contactId = await insertContact({
          phone: '+15550000093',
          phoneSource: 'apollo_reveal',
        });
        const incumbent = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000093',
          phoneType: 'work',
          isPrimary: true,
        });
        await insertSource({
          phoneId: incumbent,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-mut-inc',
        });
        const better = await insertPhone({
          contactId,
          dedupeKey: key('b'),
          phone: '+15550000094',
          phoneType: 'personal_mobile',
        });
        await insertSource({
          phoneId: better,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-mut-better',
        });
        await invoke(call(contactId, 'lusha'));
        assert.equal(
          (await phoneRow(better)).is_primary,
          true,
          'el mutante reordenó una colección que no borró',
        );
        assert.equal((await phoneRow(incumbent)).is_primary, false);
      });

      it('MUTANTE: sin `AND s.suppressed_at IS NULL` en la proyección, el escalar miente', async () => {
        // §23 cayendo: el escalar afirmaría `apollo_reveal` con la procedencia de Apollo ya
        // retirada.
        const invoke = await applyMutated('m7', (sql) =>
          sql.replace(
            `      WHERE s.contact_phone_id = v_primary_id
        AND s.suppressed_at IS NULL
      ORDER BY`,
            `      WHERE s.contact_phone_id = v_primary_id
      ORDER BY`,
          ),
        );
        const { contactId } = await dualSourced('apollo_reveal');
        await invoke(call(contactId, 'apollo'));
        assert.equal(
          (await contactRow(contactId)).phone_source,
          'apollo_reveal',
          'el mutante deja el escalar afirmando una procedencia SUPRIMIDA',
        );
      });

      it('MUTANTE: sin el tier manual, un `personal_mobile` de proveedor gana', async () => {
        const invoke = await applyMutated('m8', (sql) =>
          sql.replace(
            `      CASE WHEN EXISTS (
        SELECT 1 FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
          AND s.provider = 'manual'
      ) THEN 0 ELSE 1 END,
`,
            '',
          ),
        );
        const contactId = await insertContact({
          phone: '+15550000095',
          phoneSource: 'apollo_reveal',
        });
        const dying = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000095',
          isPrimary: true,
        });
        await insertSource({
          phoneId: dying,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-mut-t1',
        });
        const manualWork = await insertPhone({
          contactId,
          dedupeKey: key('b'),
          phone: '+15550000096',
          phoneType: 'work',
        });
        await insertSource({
          phoneId: manualWork,
          provider: 'manual',
          acquisitionMode: 'manual',
          eventKey: 'ev-mut-t2',
        });
        const providerMobile = await insertPhone({
          contactId,
          dedupeKey: key('c'),
          phone: '+15550000097',
          phoneType: 'personal_mobile',
        });
        await insertSource({
          phoneId: providerMobile,
          provider: 'lusha',
          acquisitionMode: 'reveal',
          eventKey: 'ev-mut-t3',
        });
        await invoke(call(contactId, 'apollo'));
        assert.equal(
          (await phoneRow(providerMobile)).is_primary,
          true,
          'sin el tier, la precedencia manual de 4O-H0 desaparece',
        );
        assert.equal((await phoneRow(manualWork)).is_primary, false);
      });

      it('MUTANTE: sin los locks, dos concurrentes dejan un número VIVO sin procedencia', async () => {
        // ⚠️ Este mutante quita LOS DOS `FOR UPDATE`, y esa es una conclusión sobre el diseño que
        // merece quedar escrita: los dos locks son REDUNDANTES entre sí para esta fuga. Quitando
        // sólo el del contacto, la segunda transacción se bloquea en el lock de fila de
        // `contact_phones`; quitando sólo el de `contact_phones`, se bloquea en el del contacto.
        // O sea que cada uno la evita por su cuenta, y sólo desapareciendo AMBOS aparece el
        // defecto. Un mutante de un solo lock habría pasado en verde y habría demostrado que la
        // guarda «no hace falta», que es justo la conclusión equivocada.
        //
        // Que sean redundantes no los hace superfluos: el del contacto serializa además la
        // reproyección del escalar y cubre el camino sin colección oficial, donde no hay ninguna
        // fila canónica que bloquear.
        await applyMutated('m9', (sql) => {
          const withoutContactLock = sql.replace(
            `  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;`,
            `  FROM public.contacts c
  WHERE c.id = p_contact_id;`,
          );
          assert.notEqual(withoutContactLock, sql, 'no se encontró el lock del contacto');
          const withoutPhoneLock = withoutContactLock.replace(
            `  WHERE p.contact_id = p_contact_id
  ORDER BY p.id
  FOR UPDATE;`,
            `  WHERE p.contact_id = p_contact_id
  ORDER BY p.id;`,
          );
          assert.notEqual(
            withoutPhoneLock,
            withoutContactLock,
            'no se encontró el lock de las filas canónicas',
          );
          return withoutPhoneLock;
        });

        // El contacto lleva procedencia `manual` A PROPÓSITO: así la guarda del escalar salta en
        // las dos transacciones y ninguna toca `public.contacts`. Sin ese detalle, las dos se
        // serializarían en el lock de fila del UPDATE del escalar y el mutante parecería seguro
        // por una razón que no tiene nada que ver con los locks que se están probando.
        const contactId = await insertContact({
          phone: '+15558888882',
          phoneSource: 'manual',
        });
        const phoneId = await insertPhone({
          contactId,
          dedupeKey: key('a'),
          phone: '+15550000098',
          isPrimary: true,
        });
        const apolloId = await insertSource({
          phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          eventKey: 'ev-m9-apollo',
        });
        const lushaId = await insertSource({
          phoneId,
          provider: 'lusha',
          acquisitionMode: 'reveal',
          eventKey: 'ev-m9-lusha',
        });

        const mutantOn = async (conn: PgLikeClient, provider: string) => {
          const args = call(contactId, provider);
          const placeholders = args.map((_, index) => `$${index + 1}`).join(', ');
          const { rows } = await conn.query(
            `SELECT public.${FN}_m9(${placeholders}) AS envelope`,
            args,
          );
          return rows[0].envelope as Record<string, unknown>;
        };

        // A retira Apollo y NO commitea. B retira Lusha en paralelo.
        await client.query('BEGIN');
        const a = await mutantOn(client, 'apollo');
        assert.equal(a.sources_suppressed, 1);
        assert.equal(a.phones_tombstoned, 0, 'A ve la de Lusha viva, y con razón');

        await other.query('BEGIN');
        // Sin NINGÚN lock esto no se bloquea: es el defecto en acción.
        const b = await mutantOn(other, 'lusha');
        assert.equal(b.sources_suppressed, 1);
        assert.equal(
          b.phones_tombstoned,
          0,
          'B no ve la retirada NO COMMITEADA de A, así que cree que queda una fuente viva',
        );

        await other.query('COMMIT');
        await client.query('COMMIT');

        // Estado final: CERO procedencias vivas y el número SIGUE VIVO. Un número que el modelo
        // declara borrado y la base de datos sigue sirviendo — exactamente lo que el lock evita.
        const live = await q(
          `SELECT count(*)::int AS n FROM public.contact_phone_sources
            WHERE contact_phone_id = $1 AND suppressed_at IS NULL`,
          [phoneId],
        );
        assert.equal(live.rows[0].n, 0, 'las dos procedencias quedaron retiradas');
        const phone = await phoneRow(phoneId);
        assert.equal(
          phone.suppressed_at,
          null,
          'y el canónico quedó VIVO sin ninguna procedencia que lo justifique',
        );
        assert.equal(phone.normalized_phone, '+15550000098');

        // La función REAL, sobre el mismo estado, repara el destrozo del mutante: la regla del
        // último origen se reevalúa y el número pasa a tombstone.
        const repaired = await suppress({ contactId, suppressedAt: LATER });
        assert.equal(repaired.phones_tombstoned, 1);
        assert.notEqual((await phoneRow(phoneId)).suppressed_at, null);
        assert.notEqual((await sourceRow(apolloId)).suppressed_at, null);
        assert.notEqual((await sourceRow(lushaId)).suppressed_at, null);
      });
    });
  },
);
