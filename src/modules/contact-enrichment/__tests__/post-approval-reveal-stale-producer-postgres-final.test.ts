/**
 * AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — la proyección post-aprobación como
 * PRODUCTORA del estado durable de HubSpot, contra PostgreSQL 17 real.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La 128 escribe `contacts.phone`. No contiene las palabras `stale`, `hubspot_sync` ni
 * `stale_source` ni una sola vez. Así que un contacto VINCULADO y `synced` al que se le revela un
 * teléfono DESPUÉS de su aprobación acababa con el número aquí, con HubSpot conservando el
 * anterior, y con su propia ficha afirmando estar al día.
 *
 * Que eso ya no pueda pasar no es una regla de TypeScript: es una propiedad de una función
 * PL/pgSQL y de la transacción que la contiene. Una suite estática puede demostrar que la llamada
 * está escrita; sólo un servidor real puede demostrar que la fila queda `stale` con
 * `stale_source = 'reveal'`, que un ROLLBACK se lleva el número y el veredicto JUNTOS, que un
 * `mobile_phone` que tapa el escalar NO produce un falso pendiente, y que una segunda proyección
 * con el mismo teléfono no re-sella la hora.
 *
 * La cadena se aplica de verdad y EN ORDEN:
 *
 *   099 → 107 → 109 → 112 → 113 → 114 → 115 → 116 → 128
 *       → LOCAL_…cut3a → LOCAL_…cut3c → LOCAL_…post_approval_reveal_stale_producer_final
 *
 * Ese orden es el que produce el sistema de ficheros al ordenar los nombres, y hay una prueba
 * explícita de esa propiedad: si un renombrado futuro lo invirtiera, la 128 original volvería a
 * pisar el paso 10b, o CUT-3A restauraría la autoridad de TRES argumentos y esta migración
 * quedaría llamando a una firma inexistente.
 *
 * NO llama a HubSpot, ni a Apollo, ni a Lusha. No hay `fetch` en este archivo y `fetch` global
 * queda envenenado. No toca Producción ni ninguna base remota. No gasta un crédito. Todos los
 * números son sintéticos 555.
 *
 * ARNÉS OPCIONAL: si `embedded-postgres` no resuelve, el archivo se SALTA con un motivo explícito.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import {
  PROJECT_APPROVED_CANDIDATE_PHONES_FN,
  buildProjectApprovedCandidatePhonesParams,
  parseProjectApprovedCandidatePhonesEnvelope,
  type ProjectApprovedCandidatePhonesOutcome,
} from '../post-approval-reveal-core';
import {
  buildCandidatePhoneSourceEventKey,
  normalizeCandidatePhone,
} from '../phone-collection-core';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATIONS = [
  '099_apollo_phone_reveal_cache.sql',
  '107_phone_reveal_cache_and_suppression_grants.sql',
  '109_contact_enrichment_candidate_phones.sql',
  '112_suppress_candidate_phone_collection.sql',
  '114_official_contact_phones.sql',
  '115_official_contact_phone_privacy.sql',
];
const MIGRATION_116 = '116_approve_candidate_with_official_phones.sql';
const MIGRATION_128 = '128_project_approved_candidate_phones_onto_contact.sql';
const MIGRATION_CUT3A = '129_agent2_contact_hubspot_stale_completeness.sql';
const MIGRATION_CUT3C = '130_agent2_contact_hubspot_stale_source.sql';
/** LA MIGRACIÓN BAJO PRUEBA. */
const MIGRATION_FINAL = '131_agent2_post_approval_reveal_stale_producer.sql';

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

// ── Ninguna red real ────────────────────────────────────────────

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('NETWORK_FORBIDDEN_IN_TEST');
  }) as typeof globalThis.fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════════
// Datos sintéticos
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';
const RUN_ID = '40000000-0000-4000-8000-000000000001';
const APOLLO_PERSON_ID = '54a51197746869367665167a';

const NOW = '2026-08-26T12:00:00.000Z';
const LATER = '2026-08-27T15:30:00.000Z';
const EARLIER = '2026-08-01T09:00:00.000Z';
/** La MISMA marca ISO-8601 UTC que la autoridad construye a mano. */
const NOW_STAMP = '2026-08-26T12:00:00.000Z';

const P_MOBILE = '+15550000001';
const P_SECOND = '+15550000002';
const P_SHADOW = '+15550000007';
const HS_ID = 'hs-contact-001';

const keyOf = (phone: string) =>
  normalizeCandidatePhone({ displayPhone: phone, sanitizedPhone: phone, countryCode: null })
    .dedupeKey;

/** El bloque durable tal como lo dejan CUT-1/CUT-2, con los extras de auditoría de 17A.4C. */
function syncBlock(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'synced',
    method: 'manual',
    attempted_at: EARLIER,
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
    synced_at: EARLIER,
    synced_by: ACTOR_ID,
    mode: 'created',
    hubspot_company_id: 'hs-company-1',
    company_association: 'associated',
    ...over,
  };
}

describe(
  'FINAL CUT — la proyección post-aprobación produce el `stale` de HubSpot, en PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    let dataDir: string;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => client.query(sql, values);

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-final-reveal-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401–54407, 54418–54420 los usan las suites hermanas.
        port: 54421,
        persistent: false,
        onLog: () => {},
        onError: () => {},
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();

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

      await q(`
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at := now(); RETURN NEW; END $$;`);

      await q(`
        CREATE SCHEMA IF NOT EXISTS auth;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);

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

      await q(`
        CREATE TABLE public.accounts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);

        CREATE TABLE public.contacts (
          id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id             uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
          first_name             text NULL,
          last_name              text NULL,
          full_name              text NOT NULL,
          email                  text NULL,
          phone                  text NULL,
          mobile_phone           text NULL,
          linkedin_url           text NULL,
          job_title              text NULL,
          department             text NULL,
          seniority              text NULL,
          contact_status         text NOT NULL DEFAULT 'active',
          source                 text NOT NULL DEFAULT 'manual',
          phone_type             text NULL,
          phone_source           text NULL,
          phone_raw_type         text NULL,
          phone_revealed_at      timestamptz NULL,
          phone_processing_basis text NULL,
          phone_confidence       text NULL,
          -- Columna REAL de Producción (039, línea 53). Sin ella este arnés probaría una
          -- propiedad sobre una tabla que no existe — la lección de 4O-E4-R1.
          hubspot_contact_id     text NULL,
          metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_by             uuid NULL REFERENCES public.internal_users(id),
          updated_by             uuid NULL REFERENCES public.internal_users(id),
          created_at             timestamptz NOT NULL DEFAULT now(),
          updated_at             timestamptz NOT NULL DEFAULT now(),
          archived_at            timestamptz NULL,
          CONSTRAINT contacts_source_check CHECK (source = ANY (ARRAY[
            'manual','hubspot','apollo','lusha','agent_1','imported','other'])),
          CONSTRAINT contacts_contact_status_check CHECK (contact_status = ANY (ARRAY[
            'active','inactive','left_company','do_not_contact','archived'])),
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
          status                  text NOT NULL DEFAULT 'pending_review',
          full_name               text,
          phone                   text,
          enrichment_metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
          duplicate_status        text,
          matched_contacts_id     uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
          review_notes            text,
          reviewed_by             uuid,
          reviewed_at             timestamptz,
          phone_reveal_status     text,
          phone_reveal_request_id text,
          phone_reveal_error_code text,
          phone_processing_basis  text,
          apollo_person_id        text,
          source                  text,
          source_contact_id       text,
          CONSTRAINT contact_enrichment_candidates_status_check
            CHECK (status IN ('pending_review','approved','discarded','duplicate')));`);

      for (const file of MIGRATIONS) await q(readMigration(file));

      const m113 = readMigration('113_phone_reveal_person_suppression_recheck.sql');
      const marker =
        'GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;';
      const helpers = m113.slice(
        m113.indexOf('CREATE OR REPLACE FUNCTION public.phone_reveal_normalized_apollo_person_id'),
        m113.indexOf(marker) + marker.length,
      );
      assert.ok(helpers.length > 0, 'no se pudieron extraer los helpers de la 113');
      await q(helpers);

      await q(readMigration(MIGRATION_116));
      // La 128 ORIGINAL primero: es la base que este corte reemplaza, y aplicarla demuestra que
      // el reemplazo funciona sobre una base donde ya estaba.
      await q(readMigration(MIGRATION_128));
      await q(readMigration(MIGRATION_CUT3A));
      await q(readMigration(MIGRATION_CUT3C));
      await q(readMigration(MIGRATION_FINAL));

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
    });

    after(async () => {
      if (client) await client.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Helpers ────────────────────────────────────────────────────

    let seq = 0;

    async function insertApprovedContact(
      args: {
        candidateId?: string | null;
        phone?: string | null;
        mobilePhone?: string | null;
        hubspotContactId?: string | null;
        sync?: Record<string, unknown> | null;
      } = {},
    ): Promise<string> {
      seq += 1;
      const metadata: Record<string, unknown> = { source: 'contact_enrichment_candidate' };
      if (args.candidateId !== null) metadata.source_candidate_id = args.candidateId ?? null;
      if (args.sync !== null) metadata.hubspot_sync = args.sync ?? syncBlock();
      const { rows } = await q(
        `INSERT INTO public.contacts
           (account_id, full_name, email, phone, mobile_phone, source, metadata,
            hubspot_contact_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'apollo',$6,$7,$8,$8) RETURNING id`,
        [
          ACCOUNT_ID,
          `Contacto Oficial ${seq}`,
          `oficial${seq}@example.invalid`,
          args.phone ?? null,
          args.mobilePhone ?? null,
          JSON.stringify(metadata),
          args.hubspotContactId === undefined ? HS_ID : args.hubspotContactId,
          ACTOR_ID,
        ],
      );
      return rows[0].id as string;
    }

    async function insertCandidate(args: {
      matchedContactId: string | null;
      status?: string;
      apolloPersonId?: string | null;
    }): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidates
           (enrichment_run_id, status, full_name, source, source_contact_id,
            apollo_person_id, matched_contacts_id)
         VALUES ($1,$2,$3,'apollo',$4,$4,$5) RETURNING id`,
        [
          RUN_ID,
          args.status ?? 'approved',
          `Candidato Sintetico ${seq}`,
          args.apolloPersonId ?? null,
          args.matchedContactId,
        ],
      );
      return rows[0].id as string;
    }

    async function insertCandidatePhone(args: {
      candidateId: string;
      phone: string;
      phoneType?: string | null;
      isPrimary?: boolean;
    }): Promise<string> {
      const dedupeKey = keyOf(args.phone);
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidate_phones
           (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type,
            phone_status, is_primary)
         VALUES ($1,$2,$3,$3,$4,'unknown',$5) RETURNING id`,
        [args.candidateId, dedupeKey, args.phone, args.phoneType ?? 'mobile', args.isPrimary ?? false],
      );
      const phoneId = rows[0].id as string;
      await q(
        `INSERT INTO public.contact_enrichment_candidate_phone_sources
           (candidate_phone_id, provider, acquisition_mode, raw_provider_type,
            source_event_key, observed_at)
         VALUES ($1,'apollo','reveal',NULL,$2,$3)`,
        [
          phoneId,
          buildCandidatePhoneSourceEventKey({
            provider: 'apollo' as never,
            acquisitionMode: 'reveal' as never,
            phase: 'apollo' as never,
            waterfallRunId: null,
            reservationId: null,
            providerUsageLogId: null,
          }) + `:${phoneId}`,
          NOW,
        ],
      );
      return phoneId;
    }

    /** Invoca la RPC con los parámetros del MISMO builder puro que usa la server action. */
    async function project(
      args: { candidateId: string; contactId: string; nowIso?: string },
      conn: PgLikeClient = client,
    ): Promise<ProjectApprovedCandidatePhonesOutcome> {
      const params = buildProjectApprovedCandidatePhonesParams({
        candidateId: args.candidateId,
        contactId: args.contactId,
        scalarFallback: null,
        actorId: ACTOR_ID,
        nowIso: args.nowIso ?? NOW,
      });
      const names = Object.keys(params);
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await conn.query(
        `SELECT public.${PROJECT_APPROVED_CANDIDATE_PHONES_FN}(${placeholders}) AS envelope`,
        names.map((n) => {
          const v = (params as Record<string, unknown>)[n];
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }),
      );
      return parseProjectApprovedCandidatePhonesEnvelope(rows[0].envelope);
    }

    const syncOf = async (contactId: string): Promise<Record<string, unknown> | null> => {
      const { rows } = await q(
        `SELECT metadata -> 'hubspot_sync' AS block FROM public.contacts WHERE id = $1`,
        [contactId],
      );
      return (rows[0]?.block as Record<string, unknown> | null) ?? null;
    };

    const phoneOf = async (contactId: string): Promise<string | null> =>
      ((await q(`SELECT phone FROM public.contacts WHERE id = $1`, [contactId])).rows[0]
        ?.phone as string | null) ?? null;

    /** Un contacto aprobado + candidato + un teléfono revelado listo para proyectar. */
    async function scenario(
      over: Parameters<typeof insertApprovedContact>[0] = {},
      phone: string = P_MOBILE,
    ): Promise<{ contactId: string; candidateId: string }> {
      const contactId = await insertApprovedContact(over);
      const candidateId = await insertCandidate({
        matchedContactId: contactId,
        apolloPersonId: `${APOLLO_PERSON_ID}${seq}`,
      });
      await q(
        `UPDATE public.contacts
            SET metadata = metadata || jsonb_build_object('source_candidate_id', $2::text)
          WHERE id = $1`,
        [contactId, candidateId],
      );
      await insertCandidatePhone({ candidateId, phone, isPrimary: true });
      return { contactId, candidateId };
    }

    // ═══════════════════════════════════════════════════════════════
    // 0 · el orden de aplicación no es una casualidad
    // ═══════════════════════════════════════════════════════════════

    describe('0. la cadena se aplica en el orden que impone su dependencia', () => {
      it('el orden NUMÉRICO del directorio YA es el orden de dependencia', () => {
        // OLD_ASSERTION: los cuatro archivos nacieron con prefijo `LOCAL_` y el orden que esta
        // cadena necesita lo daba el alfabeto (`contact_hubspot_stale_completeness` <
        // `contact_hubspot_stale_source` < `post_approval_…`).
        //
        // NEW_INVARIANT: AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 los canonicalizó a
        // 129/130/131/132, así que el orden lo impone el PREFIJO — la misma secuencia que ya
        // gobierna las 128 migraciones anteriores, y una garantía más fuerte que una propiedad
        // accidental del alfabeto.
        //
        // BACKFILL LEGACY (132) NO participa en esta cadena: no llama a `hubspot_outbound_phone`,
        // no reemplaza la autoridad de `stale` y no toca la 128. Se le excluye explícitamente
        // —en vez de aflojar la afirmación— y hay una prueba en SU suite que verifica esa
        // independencia leyendo su SQL.
        const LEGACY_BACKFILL = '132_agent2_hubspot_legacy_sync_state_backfill.sql';
        const chain = readdirSync(migrationsDir)
          .filter((f) =>
            [MIGRATION_CUT3A, MIGRATION_CUT3C, MIGRATION_FINAL, LEGACY_BACKFILL].includes(f),
          )
          .sort();
        assert.ok(chain.includes(LEGACY_BACKFILL), 'falta el backfill legado');
        assert.deepEqual(
          chain.filter((f) => f !== LEGACY_BACKFILL),
          [MIGRATION_CUT3A, MIGRATION_CUT3C, MIGRATION_FINAL],
        );
      });

      it('la autoridad de TRES argumentos ya no existe: sólo la de CUATRO', async () => {
        const { rows } = await q(
          `SELECT pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'mark_contact_hubspot_sync_stale_for_phone'
            ORDER BY 1`,
        );
        assert.deepEqual(
          rows.map((r) => r.args),
          ['p_contact_id uuid, p_previous_outbound text, p_now timestamp with time zone, p_stale_source text'],
        );
      });

      it('la proyección viva es la del FINAL CUT, no la 128 original', async () => {
        const { rows } = await q(
          `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [PROJECT_APPROVED_CANDIDATE_PHONES_FN],
        );
        assert.equal(rows.length, 1, 'una sola definición');
        assert.match(String(rows[0].prosrc), /mark_contact_hubspot_sync_stale_for_phone/);
        assert.match(String(rows[0].prosrc), /'reveal'/);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 1 · el caso que este corte existe para cerrar
    // ═══════════════════════════════════════════════════════════════

    describe('1. contacto vinculado y `synced` + teléfono nuevo ⇒ stale/phone_changed/reveal', () => {
      it('la fila queda pendiente, con su hora en UTC canónico', async () => {
        const { contactId, candidateId } = await scenario();

        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'projected');
        assert.equal(out.phonesInserted, 1);
        assert.equal(out.scalarSynced, true);
        assert.equal(out.hubspotSyncTransition, 'marked');

        const block = await syncOf(contactId);
        assert.equal(block?.status, 'stale');
        assert.equal(block?.stale_reason, 'phone_changed');
        assert.equal(block?.stale_source, 'reveal');
        // 10 · la marca es una CADENA ISO-8601 en UTC, construida a mano por la autoridad, y no
        // depende de la zona horaria de la sesión.
        assert.equal(block?.stale_since, NOW_STAMP);
        assert.equal(block?.last_error, null);
        // El vínculo y la auditoría anterior sobreviven intactos.
        assert.equal(block?.hubspot_contact_id, HS_ID);
        assert.equal(block?.method, 'manual');
        assert.equal(block?.attempted_at, EARLIER);
        assert.equal(block?.synced_by, ACTOR_ID);
        assert.equal(block?.hubspot_company_id, 'hs-company-1');
        // Y el teléfono está.
        assert.equal(await phoneOf(contactId), P_MOBILE);
      });

      it('la marca no depende de la zona horaria de la sesión', async () => {
        const { contactId, candidateId } = await scenario();
        await q(`SET TIME ZONE 'America/Bogota'`);
        try {
          await project({ candidateId, contactId });
        } finally {
          await q(`SET TIME ZONE 'UTC'`);
        }
        const block = await syncOf(contactId);
        assert.equal(block?.stale_since, NOW_STAMP, 'el mismo instante, la misma representación');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 2-5 · cuándo NO se marca
    // ═══════════════════════════════════════════════════════════════

    describe('2-5. los cuatro casos en los que NO puede haber pendiente', () => {
      it('2. sin vínculo HubSpot ⇒ el teléfono se proyecta y NO se marca nada', async () => {
        const { contactId, candidateId } = await scenario({ hubspotContactId: null });
        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'projected');
        assert.equal(out.hubspotSyncTransition, 'not_linked');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'synced', 'el bloque no se toca');
        assert.equal(block?.stale_reason, null);
        assert.equal(block?.stale_source, null);
        assert.equal(await phoneOf(contactId), P_MOBILE, 'el teléfono SÍ se proyecta');
      });

      it('3. sin estado durable ⇒ NO se inventa uno (queda para el backfill)', async () => {
        const { contactId, candidateId } = await scenario({ sync: null });
        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'projected');
        assert.equal(out.hubspotSyncTransition, 'no_durable_state');
        assert.equal(await syncOf(contactId), null, 'el bloque sigue sin existir');
        assert.equal(await phoneOf(contactId), P_MOBILE);
      });

      it('3b. un `status` fuera del vocabulario tampoco se disfraza de conocido', async () => {
        const { contactId, candidateId } = await scenario({
          sync: syncBlock({ status: 'sincronizado' }),
        });
        const out = await project({ candidateId, contactId });
        assert.equal(out.hubspotSyncTransition, 'no_durable_state');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'sincronizado', 'no se reescribe lo que no se entiende');
        assert.equal(block?.stale_reason, null);
      });

      it('4. el mismo saliente ⇒ `no_outbound_change` y cero escrituras', async () => {
        // El contacto YA tiene el escalar: el paso 10 no escribe, y el saliente no se mueve.
        const { contactId, candidateId } = await scenario({ phone: P_MOBILE });
        await q(`INSERT INTO public.contact_phones
                   (contact_id, dedupe_key, normalized_phone, display_phone, phone_type,
                    phone_status, is_primary)
                 VALUES ($1,$2,$3,$3,'mobile','unknown',true)`,
          [contactId, keyOf(P_MOBILE), P_MOBILE]);
        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'projected');
        assert.equal(out.scalarSynced, false);
        assert.equal(out.hubspotSyncTransition, 'no_outbound_change');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'synced');
        assert.equal(block?.stale_since, null);
      });

      it('5. `mobile_phone` tapa el escalar ⇒ ningún falso pendiente', async () => {
        // El escalar pasa de NULL a un número —el paso 10 SÍ escribe— pero el SALIENTE es
        // `mobile_phone ?? phone`, y el móvil no se toca: HubSpot recibiría exactamente lo mismo.
        const { contactId, candidateId } = await scenario({ mobilePhone: P_SHADOW });
        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'projected');
        assert.equal(out.scalarSynced, true, 'el escalar SÍ se escribió');
        assert.equal(out.hubspotSyncTransition, 'no_outbound_change');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'synced');
        assert.equal(block?.stale_reason, null);
        assert.equal(await phoneOf(contactId), P_MOBILE);
      });

      it('5b. `never_attempted` no puede quedar «desactualizado»', async () => {
        const { contactId, candidateId } = await scenario({
          sync: syncBlock({ status: 'never_attempted', synced_at: null, attempted_at: null }),
        });
        const out = await project({ candidateId, contactId });
        assert.equal(out.hubspotSyncTransition, 'not_previously_synced');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'never_attempted');
        assert.equal(block?.stale_reason, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 6-8 · lo que un pendiente PREVIO conserva y lo que rederiva
    // ═══════════════════════════════════════════════════════════════

    describe('6-8. un pendiente previo: la hora se conserva, la procedencia se rederiva', () => {
      it('6+7. `user_edit` pendiente + reveal ⇒ `reveal`, con la hora ORIGINAL', async () => {
        const { contactId, candidateId } = await scenario({
          sync: syncBlock({
            status: 'stale',
            stale_since: EARLIER,
            stale_reason: 'phone_changed',
            stale_source: 'user_edit',
          }),
        });
        const out = await project({ candidateId, contactId, nowIso: LATER });
        assert.equal(out.status, 'projected');
        // La razón no cambia (sigue habiendo número que enviar) pero el causante SÍ.
        assert.equal(out.hubspotSyncTransition, 'source_corrected');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'stale');
        assert.equal(block?.stale_reason, 'phone_changed');
        assert.equal(block?.stale_source, 'reveal', 'la procedencia describe la operación de AHORA');
        assert.equal(
          block?.stale_since,
          EARLIER,
          'desde cuándo HubSpot está desactualizado no lo pone al día un segundo cambio',
        );
      });

      it('8. `failed` + pendiente ⇒ sigue `failed`, y la procedencia se rederiva', async () => {
        const { contactId, candidateId } = await scenario({
          sync: syncBlock({
            status: 'failed',
            method: 'auto',
            last_error: 'HUBSPOT_ERROR',
            stale_since: EARLIER,
            stale_reason: 'phone_changed',
            stale_source: 'user_edit',
          }),
        });
        const out = await project({ candidateId, contactId, nowIso: LATER });
        assert.equal(out.hubspotSyncTransition, 'source_corrected');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'failed', 'un `failed` NO se degrada a `stale`');
        assert.equal(block?.last_error, 'HUBSPOT_ERROR', 'el error del último intento sobrevive');
        assert.equal(block?.stale_since, EARLIER);
        assert.equal(block?.stale_source, 'reveal');
      });

      it('un pendiente `privacy` que el reveal reabre pasa a `reveal` — y eso es correcto', async () => {
        // El sentido peligroso es el CONTRARIO (un `user_edit` sobreviviendo a una erasure). Aquí
        // la erasure YA no describe la operación pendiente: el número que hay que enviar es el
        // que este reveal acaba de traer, no el que se borró.
        const { contactId, candidateId } = await scenario({
          sync: syncBlock({
            status: 'stale',
            stale_since: EARLIER,
            stale_reason: 'phone_removed',
            stale_source: 'privacy',
          }),
        });
        const out = await project({ candidateId, contactId, nowIso: LATER });
        assert.equal(out.hubspotSyncTransition, 'reason_corrected');
        const block = await syncOf(contactId);
        assert.equal(block?.stale_reason, 'phone_changed');
        assert.equal(block?.stale_source, 'reveal');
        assert.equal(block?.stale_since, EARLIER);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // Idempotencia — el caso 2 y el 3 del contrato
    // ═══════════════════════════════════════════════════════════════

    describe('idempotencia: proyectar dos veces no produce un segundo pendiente', () => {
      it('la segunda proyección no re-sella la hora ni vuelve a marcar', async () => {
        const { contactId, candidateId } = await scenario();
        const first = await project({ candidateId, contactId });
        assert.equal(first.hubspotSyncTransition, 'marked');

        const second = await project({ candidateId, contactId, nowIso: LATER });
        assert.equal(second.status, 'projected');
        assert.equal(second.phonesInserted, 0, 'nada nuevo que insertar');
        assert.equal(
          second.hubspotSyncTransition,
          'no_outbound_change',
          'el saliente no se movió: no hay transición que reportar',
        );
        const block = await syncOf(contactId);
        assert.equal(block?.stale_since, NOW_STAMP, 'la hora original sobrevive');
        assert.equal(block?.stale_source, 'reveal');
      });

      it('un segundo teléfono que NO cambia el saliente tampoco marca otra vez', async () => {
        const { contactId, candidateId } = await scenario();
        await project({ candidateId, contactId });
        // Llega otro número al candidato: se promueve, pero el escalar ya está y no se mueve.
        await insertCandidatePhone({ candidateId, phone: P_SECOND });
        const out = await project({ candidateId, contactId, nowIso: LATER });
        assert.equal(out.phonesInserted, 1, 'el segundo número SÍ se promueve');
        assert.equal(out.hubspotSyncTransition, 'no_outbound_change');
        const block = await syncOf(contactId);
        assert.equal(block?.stale_since, NOW_STAMP);
      });

      it('un pendiente `reveal` idéntico se reporta `already_pending`, sin escribir', async () => {
        const { contactId, candidateId } = await scenario({
          sync: syncBlock({
            status: 'stale',
            stale_since: EARLIER,
            stale_reason: 'phone_changed',
            stale_source: 'reveal',
          }),
        });
        const out = await project({ candidateId, contactId, nowIso: LATER });
        assert.equal(out.hubspotSyncTransition, 'already_pending');
        const block = await syncOf(contactId);
        assert.equal(block?.stale_since, EARLIER);
        assert.equal(block?.stale_reason, 'phone_changed');
        assert.equal(block?.stale_source, 'reveal');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 9 · ATOMICIDAD
    // ═══════════════════════════════════════════════════════════════

    describe('9. el número y el veredicto sobre él viajan juntos', () => {
      it('un ROLLBACK se lleva el teléfono Y el `stale`', async () => {
        const { contactId, candidateId } = await scenario();
        await q('BEGIN');
        const out = await project({ candidateId, contactId });
        assert.equal(out.hubspotSyncTransition, 'marked');
        // Dentro de la transacción, los DOS hechos están escritos.
        assert.equal(await phoneOf(contactId), P_MOBILE);
        assert.equal((await syncOf(contactId))?.status, 'stale');
        await q('ROLLBACK');

        // Y fuera, NINGUNO. Si la marca viviera en una segunda escritura de la aplicación, aquí
        // quedaría un contacto con teléfono y una ficha diciendo `synced` — o al revés.
        assert.equal(await phoneOf(contactId), null, 'el teléfono se deshizo');
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'synced', 'el veredicto se deshizo con él');
        assert.equal(block?.stale_since, null);
        assert.equal(
          (await q(
            `SELECT COUNT(*)::int AS n FROM public.contact_phones WHERE contact_id = $1`,
            [contactId],
          )).rows[0].n,
          0,
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 15 · privacidad
    // ═══════════════════════════════════════════════════════════════

    describe('15. la privacidad sigue mandando por encima de todo', () => {
      it('una supresión POR PERSONA bloquea la proyección ENTERA: cero teléfono, cero marca', async () => {
        const personId = 'a1b2c3d4e5f60718293a4b5c';
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({
          matchedContactId: contactId,
          apolloPersonId: personId,
        });
        await q(
          `UPDATE public.contacts
              SET metadata = metadata || jsonb_build_object('source_candidate_id', $2::text)
            WHERE id = $1`,
          [contactId, candidateId],
        );
        await insertCandidatePhone({ candidateId, phone: P_MOBILE, isPrimary: true });
        // El tombstone POR PERSONA de la 099/113, con su clave real (apollo, person, account).
        await q(
          `INSERT INTO public.phone_reveal_cache
             (provider, provider_person_id, account_id, country_code,
              original_revealed_at, expires_at, suppressed_at, suppression_reason, suppressed_by)
           VALUES ('apollo', public.phone_reveal_normalized_apollo_person_id($1), $2, 'US',
                   $3, $3, $3, 'dsar_erasure_request', $4)`,
          [personId, ACCOUNT_ID, NOW, ACTOR_ID],
        );

        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'person_suppressed');
        assert.equal(
          out.hubspotSyncTransition,
          'not_evaluated',
          'un camino que devolvió antes del paso 10 no evaluó nada',
        );
        assert.equal(await phoneOf(contactId), null);
        const block = await syncOf(contactId);
        assert.equal(block?.status, 'synced', 'nada que enviar, porque nada se escribió');
        assert.equal(block?.stale_reason, null);
      });

      it('la 128 no puede escribir `privacy`: sólo la 115 lo hace', async () => {
        const { rows } = await q(
          `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [PROJECT_APPROVED_CANDIDATE_PHONES_FN],
        );
        assert.equal(/'privacy'/.test(String(rows[0].prosrc)), false);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // `phone_removed` es INALCANZABLE — probado en negativo
    // ═══════════════════════════════════════════════════════════════

    describe('la razón que esta función NO puede producir', () => {
      it('la autoridad SÍ sabe derivar `phone_removed` — no es que no exista', async () => {
        // Control POSITIVO: se llama a la autoridad directamente con un contacto cuyo saliente
        // cayó a NULL. Si esto no marcara, la prueba de abajo pasaría por el motivo equivocado.
        const contactId = await insertApprovedContact({ phone: null });
        const { rows } = await q(
          `SELECT public.mark_contact_hubspot_sync_stale_for_phone($1, $2, $3, 'user_edit') AS v`,
          [contactId, '+15550000123', NOW],
        );
        assert.equal(rows[0].v, 'marked');
        assert.equal((await syncOf(contactId))?.stale_reason, 'phone_removed');
      });

      it('y la proyección no puede llegar ahí: sólo escribe sobre un escalar NULL', async () => {
        // El paso 10 exige `phone` NULL bajo el lock, y el valor que escribe viene de una fila
        // con `normalized_phone` NO NULO. VALOR→VALOR y VALOR→NULL son las dos inalcanzables.
        const { rows } = await q(
          `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [PROJECT_APPROVED_CANDIDATE_PHONES_FN],
        );
        const src = String(rows[0].prosrc);
        assert.match(src, /IF v_primary_new AND NULLIF\(BTRIM\(COALESCE\(v_contact\.phone, ''\)\), ''\) IS NULL THEN/);
        assert.equal(/SET\s+phone\s*=\s*NULL/i.test(src), false, 'no hay ningún `SET phone = NULL`');
        assert.equal(/mobile_phone\s*=/.test(src), false, '`mobile_phone` NO se escribe (4O-E4.1)');
      });

      it('y un reveal sobre un contacto que YA tenía escalar no toca el escalar', async () => {
        // El corolario práctico: con `phone` puesto, el paso 10 no entra, así que el saliente no
        // puede caer y `phone_removed` no puede derivarse desde aquí.
        const { contactId, candidateId } = await scenario({ phone: P_SHADOW }, P_MOBILE);
        await q(`INSERT INTO public.contact_phones
                   (contact_id, dedupe_key, normalized_phone, display_phone, phone_type,
                    phone_status, is_primary)
                 VALUES ($1,$2,$3,$3,'work','unknown',true)`,
          [contactId, keyOf(P_SHADOW), P_SHADOW]);
        const out = await project({ candidateId, contactId });
        assert.equal(out.status, 'projected');
        assert.equal(out.scalarSynced, false);
        assert.equal(await phoneOf(contactId), P_SHADOW, 'el escalar incumbente sobrevive');
        assert.equal(out.hubspotSyncTransition, 'no_outbound_change');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 24 · cero red, y el techo de privilegios
    // ═══════════════════════════════════════════════════════════════

    describe('24. la función no puede alcanzar ninguna red ni ser invocada por el navegador', () => {
      it('`authenticated` no puede ejecutarla', async () => {
        await q(`SET ROLE authenticated`);
        try {
          await q(
            `SELECT public.${PROJECT_APPROVED_CANDIDATE_PHONES_FN}(NULL,NULL,NULL,NULL,NULL)`,
          );
          assert.fail('el rol del navegador NO puede ejecutar la proyección');
        } catch (err) {
          assert.equal((err as { code?: string }).code, '42501');
        } finally {
          await q(`RESET ROLE`);
        }
      });

      it('no hay extensión de red instalada, así que SQL no pudo llamar a HubSpot', async () => {
        const { rows } = await q(
          `SELECT extname FROM pg_extension WHERE extname IN ('http','pg_net','dblink')`,
        );
        assert.deepEqual(rows, []);
      });
    });
  },
);
