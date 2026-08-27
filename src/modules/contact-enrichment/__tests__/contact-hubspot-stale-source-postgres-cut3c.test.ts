/**
 * AGENT2-CONTACT-HUBSPOT-AUTO-PHONE-UPDATE-CUT3C — la PROCEDENCIA del pendiente, escrita dentro
 * de la transacción, contra PostgreSQL 17 real.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * CUT-3C decide si un cambio de teléfono puede viajar solo a HubSpot leyendo UN campo durable:
 * `stale_source`. Toda la protección de privacidad del corte descansa en que ese campo diga
 * `privacy` cuando —y sólo cuando— el pendiente lo causó una erasure.
 *
 * Eso no es una regla del código TypeScript: es una propiedad de dos funciones PL/pgSQL. Una
 * suite estática puede demostrar que el cuarto argumento está escrito; sólo un servidor real
 * puede demostrar que la 115 escribe `privacy` y la 117 escribe `merge` sobre la fila, que la
 * firma de TRES argumentos ya no existe, y que un valor fuera del vocabulario se rechaza sin
 * escribir nada.
 *
 * Aquí se aplican de verdad las migraciones (099 → 107 → 109 → 112 → 113 → 114 → 115 → 117 →
 * CUT-3A → CUT-3C), en ese orden, y lo que se comprueba después es el CONTENIDO de
 * `contacts.metadata`.
 *
 * ⚠️ El orden CUT-3A → CUT-3C es el mismo que produce el sistema de ficheros al ordenar los
 * nombres, y hay una prueba explícita de esa propiedad más abajo: si un renombrado futuro lo
 * invirtiera, CUT-3A restauraría la autoridad de tres argumentos y las dos RPC quedarían
 * llamando a una firma inexistente.
 *
 * NO llama a HubSpot, ni a Apollo, ni a Lusha. No hay `fetch` en este archivo y `fetch` global
 * queda envenenado: cualquier salida a la red rompe la prueba. No toca Producción ni ninguna
 * base remota. No gasta un crédito. Todos los números son sintéticos 555.
 *
 * ARNÉS OPCIONAL, igual que sus hermanas: si `embedded-postgres` no resuelve, el archivo se
 * SALTA con un motivo explícito en vez de fallar.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import {
  MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN,
  buildIncumbentContactBootstrap,
  buildMergeCandidateIntoExistingContactParams,
} from '../existing-contact-merge-core';
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
const MIGRATION_117 = '117_merge_candidate_into_existing_contact.sql';
/** LA MIGRACIÓN BAJO PRUEBA. Sin número a propósito: ver su propia cabecera. */
const MIGRATION_CUT3A = '129_agent2_contact_hubspot_stale_completeness.sql';
/** LA MIGRACIÓN BAJO PRUEBA. Se aplica DESPUÉS de CUT-3A y reemplaza su autoridad. */
const MIGRATION_CUT3C = '130_agent2_contact_hubspot_stale_source.sql';

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

// ── Prueba 17 — ninguna red real ────────────────────────────────

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
const OTHER_ACCOUNT_ID = '10000000-0000-4000-8000-000000000002';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';
const RUN_ID = '40000000-0000-4000-8000-000000000001';

const NOW = '2026-08-12T12:00:00.000Z';
const EARLIER = '2026-08-01T09:00:00.000Z';

const P_NEW = '+15550000001';
const P_OTHER = '+15550000002';
const P_INCUMBENT = '+15550000009';

const HS_ID = 'hs-contact-001';

const keyOf = (phone: string) =>
  normalizeCandidatePhone({ displayPhone: phone, sanitizedPhone: phone, countryCode: null })
    .dedupeKey;

/** El bloque durable tal como lo escribe CUT-1/CUT-2, con los extras de auditoría de 17A.4C. */
function syncBlock(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'synced',
    method: 'manual',
    attempted_at: EARLIER,
    last_error: null,
    hubspot_contact_id: HS_ID,
    stale_since: null,
    stale_reason: null,
    // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
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
  'CUT-3C — la procedencia del pendiente, escrita en la transacción, en PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    let dataDir: string;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => client.query(sql, values);

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-cut3c-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401–54405 los usan 4O-F, H1, H2, H3-A, H3-B y CUT-3A.
        port: 54406,
        persistent: false,
        onLog: () => {},
        onError: () => {},
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

      // ── accounts + contacts con los CHECK REALES de Producción ───
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
          CONSTRAINT contacts_seniority_check CHECK (
            seniority IS NULL OR seniority = ANY (ARRAY[
              'c_level','vp','director','manager','individual_contributor','unknown'])),
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
          apollo_person_id        text,
          source                  text,
          source_contact_id       text,
          CONSTRAINT contact_enrichment_candidates_status_check
            CHECK (status IN ('pending_review','approved','discarded','duplicate')));`);

      for (const file of MIGRATIONS) await q(readMigration(file));

      // La 113 instala los dos helpers de supresión por persona que la 117 reutiliza.
      const m113 = readMigration('113_phone_reveal_person_suppression_recheck.sql');
      const marker =
        'GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;';
      const helpers = m113.slice(
        m113.indexOf('CREATE OR REPLACE FUNCTION public.phone_reveal_normalized_apollo_person_id'),
        m113.indexOf(marker) + marker.length,
      );
      assert.ok(helpers.length > 0, 'no se pudieron extraer los helpers de la 113');
      await q(helpers);

      await q(readMigration(MIGRATION_117));
      // CUT-3A primero: crea `hubspot_outbound_phone` y la autoridad de TRES argumentos.
      await q(readMigration(MIGRATION_CUT3A));
      // CUT-3C después: reemplaza la autoridad por la de CUATRO, re-emite 115 y 117 con el
      // splice de procedencia y DESTRUYE la firma de tres. Este orden es el que el sistema de
      // ficheros produce por sí solo, y hay una prueba de esa propiedad más abajo.
      await q(readMigration(MIGRATION_CUT3C));

      await q(`INSERT INTO public.accounts (id, name) VALUES ($1, 'ACME'), ($2, 'OTRA')`, [
        ACCOUNT_ID,
        OTHER_ACCOUNT_ID,
      ]);
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

    async function insertContact(
      args: {
        phone?: string | null;
        mobilePhone?: string | null;
        phoneSource?: string | null;
        phoneType?: string | null;
        hubspotContactId?: string | null;
        metadata?: Record<string, unknown>;
      } = {},
    ): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contacts
           (account_id, full_name, email, phone, mobile_phone, phone_type, phone_source,
            source, metadata, hubspot_contact_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$10,$10) RETURNING id`,
        [
          ACCOUNT_ID,
          `Contacto Existente ${seq}`,
          `existente${seq}@example.invalid`,
          args.phone ?? null,
          args.mobilePhone ?? null,
          args.phoneType ?? null,
          args.phoneSource ?? null,
          JSON.stringify(args.metadata ?? {}),
          args.hubspotContactId === undefined ? HS_ID : args.hubspotContactId,
          ACTOR_ID,
        ],
      );
      return rows[0].id as string;
    }

    async function insertDuplicateCandidate(args: {
      matchedContactId: string;
      phone?: string | null;
    }): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidates
           (enrichment_run_id, status, full_name, phone, enrichment_metadata,
            source, duplicate_status, matched_contacts_id)
         VALUES ($1,'duplicate',$2,$3,'{}'::jsonb,'apollo','exact_duplicate',$4) RETURNING id`,
        [RUN_ID, `Candidato Sintetico ${seq}`, args.phone ?? null, args.matchedContactId],
      );
      return rows[0].id as string;
    }

    async function insertCandidatePhone(args: {
      candidateId: string;
      phone: string;
      isPrimary?: boolean;
    }): Promise<string> {
      const dedupeKey = keyOf(args.phone);
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidate_phones
           (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type,
            phone_status, is_primary)
         VALUES ($1,$2,$3,$3,'mobile','unknown',$4) RETURNING id`,
        [args.candidateId, dedupeKey, args.phone, args.isPrimary ?? true],
      );
      const phoneId = rows[0].id as string;
      await q(
        `INSERT INTO public.contact_enrichment_candidate_phone_sources
           (candidate_phone_id, provider, acquisition_mode, source_event_key, observed_at)
         VALUES ($1,'apollo','reveal',$2,$3)`,
        [
          phoneId,
          buildCandidatePhoneSourceEventKey({
            provider: 'apollo' as never,
            acquisitionMode: 'reveal' as never,
            phase: null,
            waterfallRunId: null,
            reservationId: null,
            providerUsageLogId: null,
          }),
          NOW,
        ],
      );
      return phoneId;
    }

    /** Un número OFICIAL ya presente en el contacto existente. */
    async function insertOfficialPhone(args: {
      contactId: string;
      phone: string;
      phoneType?: string | null;
      isPrimary?: boolean;
      provider?: string;
      acquisitionMode?: string;
      suppressed?: boolean;
    }): Promise<string> {
      const dedupeKey = keyOf(args.phone);
      if (args.suppressed) {
        const { rows } = await q(
          `INSERT INTO public.contact_phones
             (contact_id, dedupe_key, normalized_phone, display_phone, phone_type,
              phone_status, is_primary, suppressed_at, suppression_reason, suppressed_by)
           VALUES ($1,$2,NULL,NULL,NULL,'unknown',false,$3,'data_subject_request',$4)
           RETURNING id`,
          [args.contactId, dedupeKey, NOW, ACTOR_ID],
        );
        return rows[0].id as string;
      }
      const { rows } = await q(
        `INSERT INTO public.contact_phones
           (contact_id, dedupe_key, normalized_phone, display_phone, phone_type,
            phone_status, is_primary)
         VALUES ($1,$2,$3,$3,$4,'unknown',$5) RETURNING id`,
        [args.contactId, dedupeKey, args.phone, args.phoneType ?? 'work', args.isPrimary ?? false],
      );
      const phoneId = rows[0].id as string;
      if (args.provider) {
        await q(
          `INSERT INTO public.contact_phone_sources
             (contact_phone_id, provider, acquisition_mode, source_event_key, observed_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            phoneId,
            args.provider,
            args.acquisitionMode ?? 'reveal',
            `v1:preexisting:${args.provider}:${dedupeKey}`,
            NOW,
          ],
        );
      }
      return phoneId;
    }


    function reviewPatch(): Record<string, unknown> {
      return {
        status: 'duplicate',
        duplicate_status: 'exact_duplicate',
        review_notes: 'Duplicado fusionado con un contacto existente',
        reviewed_by: ACTOR_ID,
        reviewed_at: NOW,
        enrichment_metadata: { review: { status: 'duplicate', reviewed_by: ACTOR_ID } },
      };
    }

    /** Invoca la 117 con los parámetros del MISMO builder puro que usa la server action. */
    async function merge(args: {
      candidateId: string;
      contactId: string;
      incumbentBootstrap?: ReturnType<typeof buildIncumbentContactBootstrap>;
    }): Promise<Record<string, unknown>> {
      const params = buildMergeCandidateIntoExistingContactParams({
        candidateId: args.candidateId,
        contactId: args.contactId,
        accountId: ACCOUNT_ID,
        reviewPatch: reviewPatch(),
        scalarFallback: null,
        incumbentBootstrap: args.incumbentBootstrap ?? null,
        actorId: ACTOR_ID,
        nowIso: NOW,
      });
      const names = Object.keys(params);
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await q(
        `SELECT public.${MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN}(${placeholders}) AS envelope`,
        names.map((n) => {
          const v = (params as Record<string, unknown>)[n];
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }),
      );
      return rows[0].envelope as Record<string, unknown>;
    }

    /** El bloque durable tal como quedó en la fila. */
    async function syncStateOf(contactId: string): Promise<Record<string, unknown> | null> {
      const { rows } = await q(
        `SELECT metadata -> 'hubspot_sync' AS block, phone, mobile_phone
           FROM public.contacts WHERE id = $1`,
        [contactId],
      );
      return (rows[0].block as Record<string, unknown> | null) ?? null;
    }

    async function scalarOf(contactId: string): Promise<string | null> {
      const { rows } = await q(`SELECT phone FROM public.contacts WHERE id = $1`, [contactId]);
      return (rows[0].phone as string | null) ?? null;
    }

    /** Un merge completo: contacto + candidato duplicado con un número vivo. */
    async function mergeOnto(
      contactId: string,
      phone: string,
    ): Promise<Record<string, unknown>> {
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId, phone });
      await insertCandidatePhone({ candidateId, phone });
      return merge({ candidateId, contactId });
    }

    /**
     * La autoridad, invocada con los CUATRO argumentos. Es la única forma que queda: la firma de
     * tres está destruida, y hay una prueba de eso justo abajo.
     */
    async function markStale(
      contactId: string,
      previousOutbound: string | null,
      source: string,
    ): Promise<string> {
      const { rows } = await q(
        `SELECT public.mark_contact_hubspot_sync_stale_for_phone(
           $1, $2, $3::timestamptz, $4) AS d`,
        [contactId, previousOutbound, NOW, source],
      );
      return rows[0].d as string;
    }

    /** Suprime TODA la procedencia suprimible del contacto, como hace el paso 2e del DSAR. */
    async function suppress(contactId: string): Promise<Record<string, unknown>> {
      const { rows } = await q(
        `SELECT public.suppress_official_contact_phone_sources(
           $1, 'all_suppressible_providers', NULL, NULL, 'data_subject_request', $2, $3::timestamptz
         ) AS envelope`,
        [contactId, ACTOR_ID, NOW],
      );
      return rows[0].envelope as Record<string, unknown>;
    }

    // ═══════════════════════════════════════════════════════════
    // 1 · LA firma de tres argumentos ya NO EXISTE
    // ═══════════════════════════════════════════════════════════

    describe('1. la firma sin procedencia está destruida, no deprecada', () => {
      it('invocarla con tres argumentos falla con 42883', async () => {
        const contactId = await insertContact({ metadata: { hubspot_sync: syncBlock() } });
        let code: string | null = null;
        try {
          await q(
            `SELECT public.mark_contact_hubspot_sync_stale_for_phone($1, $2, $3::timestamptz)`,
            [contactId, P_INCUMBENT, NOW],
          );
        } catch (err) {
          code = (err as { code?: string }).code ?? null;
        }
        // Fail-closed y RUIDOSO. Conservar la firma dejaría viva una forma de marcar sin
        // procedencia, y un pendiente sin procedencia es —para el ejecutor— indistinguible de
        // una erasure: se quedaría sin enviar para siempre y en silencio.
        assert.equal(code, '42883', 'la firma de tres argumentos debe estar destruida');
      });

      it('sólo existe UNA función con ese nombre, y tiene cuatro argumentos', async () => {
        const { rows } = await q(
          `SELECT pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'mark_contact_hubspot_sync_stale_for_phone'`,
        );
        assert.deepEqual(
          rows.map((r) => r.args),
          [
            'p_contact_id uuid, p_previous_outbound text, p_now timestamp with time zone, ' +
              'p_stale_source text',
          ],
        );
      });
    });

    // ═══════════════════════════════════════════════════════════
    // 20 · El vocabulario está CERRADO en SQL
    // ═══════════════════════════════════════════════════════════

    describe('20. una procedencia fuera del vocabulario se rechaza SIN escribir', () => {
      it('`invalid_source` y la fila intacta', async () => {
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: { hubspot_sync: syncBlock() },
        });

        assert.equal(await markStale(contactId, P_INCUMBENT, 'porque_si'), 'invalid_source');
        // Ni una escritura: el estado sigue diciendo `synced` y no hay procedencia inventada.
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_source, null);
      });

      it('`NULL` tampoco pasa: no hay procedencia por omisión', async () => {
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: { hubspot_sync: syncBlock() },
        });
        const { rows } = await q(
          `SELECT public.mark_contact_hubspot_sync_stale_for_phone(
             $1, $2, $3::timestamptz, NULL) AS d`,
          [contactId, P_INCUMBENT, NOW],
        );
        assert.equal(rows[0].d, 'invalid_source');
        assert.equal((await syncStateOf(contactId))?.status, 'synced');
      });

      it('los cuatro miembros declarados SÍ pasan', async () => {
        for (const source of ['user_edit', 'merge', 'reveal', 'privacy']) {
          const contactId = await insertContact({
            phone: P_NEW,
            metadata: { hubspot_sync: syncBlock() },
          });
          assert.equal(await markStale(contactId, P_INCUMBENT, source), 'marked');
          const state = await syncStateOf(contactId);
          assert.equal(state?.stale_source, source, source);
          assert.equal(state?.stale_reason, 'phone_changed');
        }
      });
    });

    // ═══════════════════════════════════════════════════════════
    // 6 · EL MERGE (117) escribe `merge`
    // ═══════════════════════════════════════════════════════════

    describe('6. el merge de un candidato duplicado registra `merge`', () => {
      it('un `synced` cuyo saliente cambia queda `stale`/`phone_changed`/`merge`', async () => {
        // Sin escalar previo: la 117 NUNCA degrada un incumbente vivo, así que es este el caso
        // en el que de verdad proyecta y por tanto el que puede dejar el estado desactualizado.
        const contactId = await insertContact({ metadata: { hubspot_sync: syncBlock() } });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.status, 'merged');
        assert.equal(envelope.hubspot_sync_transition, 'marked');
        assert.equal(await scalarOf(contactId), P_NEW);

        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_changed');
        // La procedencia la escribe la 117, DENTRO de la transacción que proyecta el teléfono.
        assert.equal(state?.stale_source, 'merge');
        assert.equal(state?.stale_since, NOW);
        // Y no toca nada de lo que no es suyo.
        assert.equal(state?.hubspot_contact_id, HS_ID);
        assert.equal(state?.method, 'manual');
        assert.equal(state?.attempted_at, EARLIER);
      });

      it('la atomicidad se conserva: un ROLLBACK se lleva teléfono y procedencia juntos', async () => {
        const contactId = await insertContact({ metadata: { hubspot_sync: syncBlock() } });
        const candidateId = await insertDuplicateCandidate({
          matchedContactId: contactId,
          phone: P_NEW,
        });
        await insertCandidatePhone({ candidateId, phone: P_NEW });

        await q('BEGIN');
        await merge({ candidateId, contactId });
        // Dentro de la transacción las DOS cosas ya son verdad a la vez.
        assert.equal(await scalarOf(contactId), P_NEW);
        assert.equal((await syncStateOf(contactId))?.stale_source, 'merge');
        await q('ROLLBACK');

        // Y fuera, NINGUNA de las dos lo es. No existe un instante con el teléfono guardado y
        // la procedencia ausente: es la propiedad que impide que el PATCH automático se apoye
        // en un pendiente que nadie sabe quién causó.
        assert.equal(await scalarOf(contactId), null);
        assert.equal((await syncStateOf(contactId))?.stale_source, null);
        assert.equal((await syncStateOf(contactId))?.status, 'synced');
      });

      it('cuando el saliente no cambia, el merge no inventa una procedencia', async () => {
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          mobilePhone: P_OTHER,
          metadata: { hubspot_sync: syncBlock() },
        });

        // El móvil TAPA al fijo: proyectar sobre `phone` no cambia lo que HubSpot recibiría.
        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.hubspot_sync_transition, 'no_outbound_change');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_source, null);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // 5 · LA PRIVACIDAD (115) escribe `privacy` — el corazón del corte
    // ═══════════════════════════════════════════════════════════

    describe('5. la supresión de privacidad registra `privacy`, y nada más', () => {
      it('borrar el último número deja `stale`/`phone_removed`/`privacy`', async () => {
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          phoneSource: 'apollo_reveal',
          phoneType: 'mobile',
          metadata: { hubspot_sync: syncBlock() },
        });
        await insertOfficialPhone({
          contactId,
          phone: P_INCUMBENT,
          phoneType: 'mobile',
          isPrimary: true,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const envelope = await suppress(contactId);

        assert.equal(envelope.status, 'suppressed');
        assert.equal(await scalarOf(contactId), null);
        assert.equal(envelope.hubspot_sync_transition, 'marked');

        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_removed');
        // ESTE es el campo del que depende toda la protección: sin él, este pendiente sería
        // indistinguible de un borrado manual y una bandera genérica lo exportaría.
        assert.equal(state?.stale_source, 'privacy');
        assert.equal(state?.hubspot_contact_id, HS_ID);
      });

      it('la erasure sigue sin exportar nada, y el envelope sigue sin citar el número', async () => {
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          phoneSource: 'apollo_reveal',
          phoneType: 'mobile',
          metadata: { hubspot_sync: syncBlock() },
        });
        await insertOfficialPhone({
          contactId,
          phone: P_INCUMBENT,
          phoneType: 'mobile',
          isPrimary: true,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        // `fetch` está envenenado en este archivo: si algo saliera a la red, esto rompería.
        const envelope = await suppress(contactId);
        const serialized = JSON.stringify(envelope);
        assert.equal(serialized.includes(P_INCUMBENT), false, 'el envelope cita un teléfono');
        assert.equal(serialized.includes('5550000'), false, 'el envelope cita un teléfono');
        assert.equal(envelope.hubspot_sync_transition, 'marked');
      });

      it('un escalar GUARDADO por procedencia no se marca ni adquiere causante', async () => {
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          phoneSource: 'manual',
          phoneType: 'work',
          metadata: { hubspot_sync: syncBlock() },
        });
        await insertOfficialPhone({
          contactId,
          phone: P_INCUMBENT,
          phoneType: 'work',
          isPrimary: true,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const envelope = await suppress(contactId);

        assert.equal(envelope.scalar_guarded_by_provenance, true);
        assert.equal(envelope.hubspot_sync_transition, 'no_outbound_change');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_source, null);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // 21 · La procedencia se REDERIVA; la hora no
    // ═══════════════════════════════════════════════════════════

    describe('21. la procedencia instruye, no recuerda', () => {
      it('un pendiente de PRIVACIDAD sobre el que alguien teclea un número pasa a `user_edit`', async () => {
        // La dirección benigna. Si `privacy` sobreviviera, ese número quedaría atrapado: nunca
        // se auto-enviaría y nadie sabría por qué.
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'phone_removed',
              stale_source: 'privacy',
            }),
          },
        });

        assert.equal(await markStale(contactId, null, 'user_edit'), 'reason_corrected');
        const state = await syncStateOf(contactId);
        assert.equal(state?.stale_reason, 'phone_changed');
        assert.equal(state?.stale_source, 'user_edit');
        // Desde CUÁNDO HubSpot está desactualizado NO lo pone al día un segundo cambio.
        assert.equal(state?.stale_since, EARLIER);
      });

      it('un pendiente de EDICIÓN que una erasure vuelve a tocar pasa a `privacy`', async () => {
        // La dirección PELIGROSA, y la razón por la que el par se compara entero: aquí la RAZÓN
        // no cambia si el saliente ya era `null`… pero la autorización sí tiene que cambiar.
        const contactId = await insertContact({
          phone: null,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'phone_removed',
              stale_source: 'user_edit',
            }),
          },
        });

        // Misma razón, causante distinto ⇒ se escribe, y el veredicto lo dice sin disfrazarlo
        // de corrección de razón.
        assert.equal(await markStale(contactId, P_INCUMBENT, 'privacy'), 'source_corrected');
        const state = await syncStateOf(contactId);
        assert.equal(state?.stale_reason, 'phone_removed');
        assert.equal(state?.stale_source, 'privacy');
        assert.equal(state?.stale_since, EARLIER);
      });

      it('cuando el PAR ya es correcto no se escribe nada', async () => {
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
              stale_source: 'user_edit',
            }),
          },
        });
        assert.equal(await markStale(contactId, P_INCUMBENT, 'user_edit'), 'already_pending');
        assert.equal((await syncStateOf(contactId))?.stale_since, EARLIER);
      });

      it('un pendiente LEGADO sin procedencia la ADQUIERE al volver a tocarse', async () => {
        // Este archivo no hace backfill: adivinar `user_edit` sobre una erasure histórica sería
        // exactamente el fallo que el corte previene. Lo que sí ocurre es que el primer escritor
        // que vuelva a tocar el pendiente lo deja atribuido.
        const legacyBlock = syncBlock({
          status: 'stale',
          stale_since: EARLIER,
          stale_reason: 'phone_changed',
        });
        // La clave se BORRA, no se pone a `null`: un bloque anterior a este contrato no la tiene
        // en absoluto, y probar sobre un `null` explícito no probaría el caso legado.
        delete legacyBlock.stale_source;
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: { hubspot_sync: legacyBlock },
        });
        assert.equal((await syncStateOf(contactId))?.stale_source, undefined);
        assert.equal(await markStale(contactId, P_INCUMBENT, 'merge'), 'source_corrected');
        assert.equal((await syncStateOf(contactId))?.stale_source, 'merge');
      });

      it('un `failed` con pendiente NO se degrada a `stale` al corregir la procedencia', async () => {
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'failed',
              last_error: 'hubspot_update_failed',
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
              stale_source: 'user_edit',
            }),
          },
        });
        assert.equal(await markStale(contactId, P_INCUMBENT, 'merge'), 'source_corrected');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'failed');
        assert.equal(state?.last_error, 'hubspot_update_failed');
        assert.equal(state?.stale_source, 'merge');
      });

      it('una procedencia ILEGIBLE en la fila se trata como ausente, no como su valor crudo', async () => {
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
              stale_source: 'privacidad',
            }),
          },
        });
        // Se corrige a un valor del vocabulario en vez de dejar vivo uno que ningún lector
        // reconoce. Un `privacy` mal escrito que sobreviviera parecería exportable.
        assert.equal(await markStale(contactId, P_INCUMBENT, 'privacy'), 'source_corrected');
        assert.equal((await syncStateOf(contactId))?.stale_source, 'privacy');
      });
    });

    // ═══════════════════════════════════════════════════════════
    // 19 · Nada de red, nada de proveedores, nada de gasto
    // ═══════════════════════════════════════════════════════════

    describe('19. la migración no puede llamar a nadie', () => {
      it('la autoridad no toca contabilidad ni proveedores, y no escribe `mobile_phone`', async () => {
        const sql = readMigration(MIGRATION_CUT3C);
        for (const forbidden of [
          /provider_usage_logs\s*\(/i,
          /phone_reveal_credit_reservations\s*\(/i,
          /wizard_budget_reservations/i,
          /\bhttp_post\b/i,
          /\bpg_net\b/i,
          /\bnet\.http/i,
          /api\.hubapi\.com/i,
          /CREATE\s+EXTENSION/i,
        ]) {
          assert.equal(forbidden.test(sql), false, `CUT-3C no puede tocar ${forbidden}`);
        }
        // 4O-E4.1 intacta: se LEE y jamás se escribe.
        assert.equal(/mobile_phone\s*=\s*(NULL|v_|p_|')/i.test(sql), false);
        // En negativo, para que la guarda no sea decorativa.
        assert.equal(/mobile_phone\s*=\s*(NULL|v_|p_|')/i.test('SET mobile_phone = NULL'), true);
      });

      it('declara su estado de aplicación sin ambigüedad', () => {
        const sql = readMigration(MIGRATION_CUT3C);
        assert.match(sql, /APPLIED IN PRODUCTION:\s*NO/);
        assert.match(sql, /APPLIED REMOTE:\s*NO/);
        assert.match(sql, /LOCAL ONLY:\s*YES/);
      });

      it('CUT-3A se ordena ANTES que CUT-3C, y no por convención', () => {
        // Propiedad de los NOMBRES, comprobada como la comprueba el sistema de ficheros. Si un
        // renombrado la invirtiera, CUT-3A restauraría la autoridad de tres argumentos y las dos
        // RPC quedarían llamando a una firma inexistente.
        assert.deepEqual([MIGRATION_CUT3C, MIGRATION_CUT3A].sort(), [
          MIGRATION_CUT3A,
          MIGRATION_CUT3C,
        ]);
      });
    });

    describe('la autoridad sigue sin poder ser invocada por un cliente', () => {
      it('`authenticated` y `anon` no tienen EXECUTE sobre la firma de CUATRO argumentos', async () => {
        const { rows } = await q(
          `SELECT has_function_privilege('authenticated',
                    'public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz, text)',
                    'EXECUTE') AS mark,
                  has_function_privilege('anon',
                    'public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz, text)',
                    'EXECUTE') AS anon_mark,
                  has_function_privilege('authenticated',
                    'public.hubspot_outbound_phone(text, text)', 'EXECUTE') AS outbound`,
        );
        // Y ahora hay una razón MÁS: un cliente que pudiera invocarla podría ATRIBUIR un
        // pendiente de privacidad a `user_edit`, convirtiéndose él mismo en la puerta por la
        // que la erasure sale exportada.
        assert.equal(rows[0].mark, false);
        assert.equal(rows[0].anon_mark, false);
        assert.equal(rows[0].outbound, false);
      });
    });
  },
);
