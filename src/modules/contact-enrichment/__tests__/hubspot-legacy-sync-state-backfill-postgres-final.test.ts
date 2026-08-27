/**
 * AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL — la línea base durable de los contactos que
 * ya estaban vinculados a HubSpot antes de que existiera el estado, contra PostgreSQL 17 real.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * El backfill es una migración de DATOS. Lo que hay que demostrar de él no es que el SQL
 * compile: es QUÉ FILAS TOCA y QUÉ FILAS NO, y eso sólo lo puede decir un servidor con filas
 * dentro. Una suite estática podría afirmar que la condición está escrita; sólo ésta puede
 * afirmar que un `stale` ajeno sobrevivió intacto, que un conflicto de ids se saltó, y que la
 * segunda pasada no cambió una sola fila.
 *
 * Y hay una propiedad que sólo se puede demostrar AQUÍ, porque es el motivo de todo el corte:
 * un contacto histórico —vinculado, sin estado— es INVISIBLE para la maquinaria de `stale`, y
 * después del backfill deja de serlo. Eso se prueba corriendo los caminos REALES sobre la misma
 * fila: la 117 (merge), la 115 (supresión de privacidad) y la 128 re-emitida (reveal).
 *
 * Se aplican de verdad las migraciones 099 → 107 → 109 → 112 → 113 → 114 → 115 → 116 → 128 →
 * CUT-3A → CUT-3C → FINAL → BACKFILL, en ese orden, y lo que se comprueba después es el
 * CONTENIDO de `contacts.metadata`.
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
import {
  MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN,
  buildMergeCandidateIntoExistingContactParams,
} from '../existing-contact-merge-core';

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
/** LA MIGRACIÓN BAJO PRUEBA. */
const MIGRATION_BACKFILL = '132_agent2_hubspot_legacy_sync_state_backfill.sql';

/**
 * El orden de aplicación DECLARADO del tramo, que desde
 * AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 coincide con el NUMÉRICO: 129 → 130 → 131 → 132.
 * Antes no coincidía —los cuatro archivos nacieron sin número y `hubspot_…` ordenaba antes que
 * `post_approval_…`, así que el backfill caía TERCERO por nombre y CUARTO por declaración— y esa
 * discrepancia se decía en voz alta en vez de disimularse. El número la elimina. Lo que sigue
 * importando, y lo que una prueba de abajo demuestra leyendo su SQL, es que el backfill no
 * depende de ninguno de los otros tres: la INDEPENDENCIA no era una consecuencia del orden.
 */
const DECLARED_NUMERIC_ORDER = [
  MIGRATION_CUT3A,
  MIGRATION_CUT3C,
  MIGRATION_FINAL,
  MIGRATION_BACKFILL,
] as const;

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
  'BACKFILL LEGACY — la línea base durable de los contactos vinculados, en PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    let dataDir: string;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => client.query(sql, values);

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-legacy-backfill-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401–54407, 54418–54421 los usan las suites hermanas.
        port: 54422,
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
      for (const file of DECLARED_NUMERIC_ORDER) await q(readMigration(file));

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

    /**
     * Inserta un contacto CRUDO: la metadata se pasa entera, sin que este helper añada un bloque
     * `hubspot_sync` por su cuenta. Es lo contrario de lo que hacen las suites hermanas, y a
     * propósito: aquí el caso central es justamente el contacto que NO tiene bloque.
     */
    async function insertContact(args: {
      metadata?: Record<string, unknown>;
      hubspotContactId?: string | null;
      phone?: string | null;
      mobilePhone?: string | null;
      archivedAt?: string | null;
    } = {}): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contacts
           (account_id, full_name, email, phone, mobile_phone, source, metadata,
            hubspot_contact_id, archived_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'apollo',$6,$7,$8::timestamptz,$9,$9) RETURNING id`,
        [
          ACCOUNT_ID,
          `Contacto Legado ${seq}`,
          `legado${seq}@example.invalid`,
          args.phone ?? null,
          args.mobilePhone ?? null,
          JSON.stringify(args.metadata ?? { source: 'contact_enrichment_candidate' }),
          args.hubspotContactId === undefined ? HS_ID : args.hubspotContactId,
          args.archivedAt ?? null,
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
        [RUN_ID, `Duplicado Sintetico ${seq}`, args.phone ?? null, args.matchedContactId],
      );
      return rows[0].id as string;
    }

    /** Invoca la 117 con los parámetros del MISMO builder puro que usa la server action. */
    async function mergeOnto(contactId: string, phone: string): Promise<Record<string, unknown>> {
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId, phone });
      await insertCandidatePhone({ candidateId, phone, isPrimary: true });
      const params = buildMergeCandidateIntoExistingContactParams({
        candidateId,
        contactId,
        accountId: ACCOUNT_ID,
        reviewPatch: {
          status: 'duplicate',
          duplicate_status: 'exact_duplicate',
          review_notes: 'Duplicado fusionado con un contacto existente',
          reviewed_by: ACTOR_ID,
          reviewed_at: NOW,
          enrichment_metadata: { review: { status: 'duplicate', reviewed_by: ACTOR_ID } },
        },
        scalarFallback: null,
        incumbentBootstrap: null,
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

    /** Suprime TODA la procedencia suprimible del contacto, como hace el paso 2e del DSAR. */
    async function suppress(contactId: string): Promise<Record<string, unknown>> {
      const { rows } = await q(
        `SELECT public.suppress_official_contact_phone_sources(
           $1, 'all_suppressible_providers', NULL, NULL, 'data_subject_request', $2, $3::timestamptz
         ) AS envelope`,
        [contactId, ACTOR_ID, LATER],
      );
      return rows[0].envelope as Record<string, unknown>;
    }

    /** La autoridad de CUT-3C, invocada con sus CUATRO argumentos. */
    async function markStale(
      contactId: string,
      previousOutbound: string | null,
      source: string,
    ): Promise<string> {
      const { rows } = await q(
        `SELECT public.mark_contact_hubspot_sync_stale_for_phone(
           $1, $2, $3::timestamptz, $4) AS d`,
        [contactId, previousOutbound, LATER, source],
      );
      return rows[0].d as string;
    }

    const classOf = async (contactId: string): Promise<string> =>
      (
        await q(
          `SELECT public.hubspot_legacy_sync_backfill_class(
             c.hubspot_contact_id, c.archived_at, c.metadata) AS k
             FROM public.contacts c WHERE c.id = $1`,
          [contactId],
        )
      ).rows[0].k as string;

    const metadataOf = async (contactId: string): Promise<Record<string, unknown>> =>
      (await q(`SELECT metadata FROM public.contacts WHERE id = $1`, [contactId])).rows[0]
        .metadata as Record<string, unknown>;

    async function runBackfill(nowIso = NOW): Promise<Record<string, unknown>> {
      const { rows } = await q(
        `SELECT public.backfill_legacy_hubspot_sync_state($1::timestamptz) AS report`,
        [nowIso],
      );
      return rows[0].report as Record<string, unknown>;
    }

    /** El bloque legado EXACTO que escribía el hito 17A.4C, con su `status` original. */
    function legacyAuditBlock(over: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        synced_at: EARLIER,
        synced_by: ACTOR_ID,
        hubspot_contact_id: HS_ID,
        mode: 'created',
        hubspot_company_id: 'hs-company-1',
        company_association: 'associated',
        ...over,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // 0 · el orden de aplicación, declarado y no deducido del nombre
    // ═══════════════════════════════════════════════════════════════

    describe('0. el orden declarado, que ahora ES el del directorio', () => {
      it('el backfill cae CUARTO por número y CUARTO por declaración: ya no hay discrepancia', () => {
        // OLD_ASSERTION: los cuatro archivos ordenados por nombre daban CUT3A, CUT3C, BACKFILL,
        // FINAL —el backfill tercero— y el orden declarado lo ponía cuarto. La discrepancia se
        // afirmaba tal cual, sin disimularla con un nombre retorcido.
        //
        // NEW_INVARIANT: canonicalizados a 129/130/131/132, el orden del directorio y el
        // declarado son el MISMO, y eso se comprueba sobre el directorio real en vez de
        // declararse. La lista se filtra por los cuatro nombres exactos —no por un prefijo
        // compartido— para que una migración ajena que entrara por encima no la contamine.
        const chain = readdirSync(migrationsDir)
          .filter((f) => (DECLARED_NUMERIC_ORDER as readonly string[]).includes(f))
          .sort();
        assert.deepEqual(chain, [...DECLARED_NUMERIC_ORDER]);
        assert.equal(chain[chain.length - 1], MIGRATION_BACKFILL);
        // Y la cadena que SÍ depende del orden lo sigue teniendo, ahora por número.
        assert.deepEqual(
          chain.filter((f) => f !== MIGRATION_BACKFILL),
          [MIGRATION_CUT3A, MIGRATION_CUT3C, MIGRATION_FINAL],
        );
      });

      it('la discrepancia es inofensiva: el backfill no INVOCA nada de los otros tres', () => {
        // Se mira el SQL EJECUTABLE, no la prosa: la cabecera SÍ nombra esas funciones —para
        // explicar precisamente que no las usa— y una comprobación sobre el archivo entero
        // convertiría esa explicación en el fallo. Se quitan los comentarios de línea antes.
        const sql = readMigration(MIGRATION_BACKFILL)
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n');
        // Las tres autoridades que la cadena 129 → 131 crea. Si el backfill llamara a cualquiera
        // de ellas dejaría de ser independiente del orden — y aunque hoy se aplique el último por
        // número, esa independencia es lo que hace que aplicarlo antes o después no cambie nada.
        for (const fn of [
          'hubspot_outbound_phone',
          'mark_contact_hubspot_sync_stale_for_phone',
          'merge_contact_candidate_into_existing_contact',
          'suppress_official_contact_phone_sources',
          'project_approved_candidate_phones_onto_contact',
          'approve_contact_enrichment_candidate',
        ]) {
          assert.equal(
            sql.includes(fn),
            false,
            `el backfill nombra ${fn}: dejaría de ser independiente del orden`,
          );
        }
        // Su única dependencia declarada.
        assert.match(sql, /public\.contacts/);
      });

      it('la migración se aplicó entera: las tres funciones existen', async () => {
        const { rows } = await q(
          `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('hubspot_legacy_sync_backfill_class',
                                'hubspot_legacy_sync_backfill_census',
                                'backfill_legacy_hubspot_sync_state')
            ORDER BY p.proname`,
        );
        assert.deepEqual(
          rows.map((r) => r.proname),
          [
            'backfill_legacy_hubspot_sync_state',
            'hubspot_legacy_sync_backfill_census',
            'hubspot_legacy_sync_backfill_class',
          ],
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 1 · el caso central: vinculado y SIN estado
    // ═══════════════════════════════════════════════════════════════

    describe('1. contacto vinculado sin estado durable → línea base', () => {
      it('antes del backfill la autoridad de `stale` lo IGNORA: `no_durable_state`', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        assert.equal(await classOf(id), 'eligible');
        await q(`UPDATE public.contacts SET phone = $2 WHERE id = $1`, [id, P_SECOND]);
        // Éste es el defecto que el corte cierra: hay vínculo, el teléfono cambió, y el sistema
        // no marca nada. HubSpot conserva el número viejo para siempre.
        assert.equal(await markStale(id, P_MOBILE, 'user_edit'), 'no_durable_state');
      });

      it('el backfill escribe `synced` con procedencia de LÍNEA BASE y sin inventar horas', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        const report = await runBackfill();
        assert.equal(report.status, 'ok');

        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        assert.equal(block.status, 'synced');
        assert.equal(block.hubspot_contact_id, HS_ID);
        // Prueba 14 — NADA de horas inventadas. `attempted_at` es NULL porque no consta ningún
        // intento, y `synced_at` NO se crea: el bloque ni siquiera tiene la clave.
        assert.equal(block.method, null);
        assert.equal(block.attempted_at, null);
        assert.equal(block.last_error, null);
        assert.equal(block.stale_since, null);
        assert.equal(block.stale_reason, null);
        assert.equal(block.stale_source, null);
        assert.equal(Object.hasOwn(block, 'synced_at'), false);
        assert.equal(Object.hasOwn(block, 'synced_by'), false);
        // La procedencia, explícita. `baseline_at` es la hora OBSERVADA por el backfill —el
        // reloj que se le pasó—, no una hora de sincronización que nadie estampó.
        assert.equal(block.baseline_source, 'legacy_link_backfill');
        assert.equal(block.baseline_at, NOW);
      });

      it('el resto de la metadata sobrevive: el backfill no es dueño de nada más', async () => {
        const id = await insertContact({
          phone: P_MOBILE,
          metadata: {
            source: 'contact_enrichment_candidate',
            source_candidate_id: 'cand-legado',
            normalization: { status: 'normalized', fields: ['email'] },
          },
        });
        await runBackfill();
        const meta = await metadataOf(id);
        assert.equal(meta.source_candidate_id, 'cand-legado');
        assert.deepEqual(meta.normalization, { status: 'normalized', fields: ['email'] });
      });

      it('un bloque que NO es un objeto (array) se trata como ausente, no como bloque', async () => {
        const id = await insertContact({
          phone: P_MOBILE,
          metadata: { hubspot_sync: ['no', 'soy', 'un', 'objeto'] },
        });
        assert.equal(await classOf(id), 'eligible');
        await runBackfill();
        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        assert.equal(Array.isArray(block), false);
        assert.equal(block.status, 'synced');
        assert.equal(block.baseline_source, 'legacy_link_backfill');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 2 · la auditoría legada se conserva; el `mode` NO se mapea
    // ═══════════════════════════════════════════════════════════════

    describe('2. el bloque legado del hito 17A.4C', () => {
      it('un `status` fuera del vocabulario hace la fila elegible, y su auditoría SOBREVIVE', async () => {
        const id = await insertContact({
          phone: P_MOBILE,
          // Vocabulario viejo: `status: 'ok'` no está en los seis del contrato.
          metadata: { hubspot_sync: legacyAuditBlock({ status: 'ok' }) },
        });
        assert.equal(await classOf(id), 'eligible');
        await runBackfill();

        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        // Prueba 7 — los cinco campos de auditoría del hito 17A.4C, intactos.
        assert.equal(block.synced_at, EARLIER);
        assert.equal(block.synced_by, ACTOR_ID);
        assert.equal(block.mode, 'created');
        assert.equal(block.hubspot_company_id, 'hs-company-1');
        assert.equal(block.company_association, 'associated');
        // Y el estado, ya legible.
        assert.equal(block.status, 'synced');
        assert.equal(block.baseline_source, 'legacy_link_backfill');
      });

      it('`mode` NO se mapea a `method`: son ejes distintos y el mapeo sería una invención', async () => {
        for (const mode of ['created', 'linked_existing']) {
          const id = await insertContact({
            phone: P_MOBILE,
            metadata: { hubspot_sync: legacyAuditBlock({ status: 'ok', mode }) },
          });
          await runBackfill();
          const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
          // Prueba 8 — `mode` describe CÓMO se obtuvo el vínculo; `method`, QUIÉN disparó el
          // intento. No hay función total del uno al otro, así que `method` queda NULL.
          assert.equal(block.mode, mode);
          assert.equal(block.method, null);
        }
      });

      it('un `method` escrito en un bloque ILEGIBLE tampoco se hereda', async () => {
        const id = await insertContact({
          phone: P_MOBILE,
          metadata: { hubspot_sync: legacyAuditBlock({ status: 'ok', method: 'manual' }) },
        });
        await runBackfill();
        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        // La fila es elegible precisamente porque ningún escritor conocido escribió su `status`.
        // Heredar de ahí un `method` atribuiría a una persona un intento que nadie registró.
        assert.equal(block.method, null);
      });

      it('marcadores de pendiente heredados de un bloque ilegible se LIMPIAN', async () => {
        const id = await insertContact({
          phone: P_MOBILE,
          metadata: {
            hubspot_sync: legacyAuditBlock({
              status: 'sincronizado',
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
              stale_source: 'user_edit',
            }),
          },
        });
        await runBackfill();
        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        // La línea base declara que NO consta nada pendiente. Dejar los marcadores puestos
        // instruiría al ejecutor automático sobre una operación que nadie pidió — y con la
        // procedencia `user_edit` heredada, además sería EXPORTABLE.
        assert.equal(block.stale_since, null);
        assert.equal(block.stale_reason, null);
        assert.equal(block.stale_source, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 3 · a quién NO toca
    // ═══════════════════════════════════════════════════════════════

    describe('3. las filas que el backfill no toca', () => {
      it('sin vínculo en la columna: NO se inventa uno (pruebas 2 y 12)', async () => {
        const sinNada = await insertContact({ hubspotContactId: null });
        assert.equal(await classOf(sinNada), 'unlinked');

        // CASO D — la metadata afirma un vínculo que la fila no tiene.
        const afirmaVinculo = await insertContact({
          hubspotContactId: null,
          metadata: { hubspot_sync: legacyAuditBlock({ status: 'synced' }) },
        });
        assert.equal(await classOf(afirmaVinculo), 'unlinked_state_claims_link');

        await runBackfill();

        for (const id of [sinNada, afirmaVinculo]) {
          const { rows } = await q(
            `SELECT hubspot_contact_id, metadata -> 'hubspot_sync' AS block
               FROM public.contacts WHERE id = $1`,
            [id],
          );
          assert.equal(rows[0].hubspot_contact_id, null);
          const block = rows[0].block as Record<string, unknown> | null;
          if (block) assert.equal(Object.hasOwn(block, 'baseline_source'), false);
        }
      });

      it('estado durable legible: los SEIS del vocabulario quedan intactos (pruebas 3–6)', async () => {
        const cases: Array<[string, Record<string, unknown>]> = [
          ['synced', syncBlock()],
          ['stale', syncBlock({ status: 'stale', stale_since: EARLIER, stale_reason: 'phone_changed', stale_source: 'merge' })],
          ['failed', syncBlock({ status: 'failed', last_error: 'hubspot_update_failed' })],
          ['never_attempted', syncBlock({ status: 'never_attempted', method: null, attempted_at: null, hubspot_contact_id: null })],
          ['blocked_no_email', syncBlock({ status: 'blocked_no_email' })],
          ['blocked_no_hubspot_company', syncBlock({ status: 'blocked_no_hubspot_company' })],
        ];
        const ids: Array<[string, string, Record<string, unknown>]> = [];
        for (const [name, block] of cases) {
          const id = await insertContact({ phone: P_MOBILE, metadata: { hubspot_sync: block } });
          assert.equal(await classOf(id), 'valid_state', `clase de ${name}`);
          ids.push([name, id, (await metadataOf(id)).hubspot_sync as Record<string, unknown>]);
        }

        await runBackfill();

        for (const [name, id, before] of ids) {
          const after = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
          assert.deepEqual(after, before, `el bloque ${name} cambió`);
          assert.equal(Object.hasOwn(after, 'baseline_source'), false, `${name} recibió línea base`);
        }
      });

      it('id embebido DISTINTO del de la columna: conflicto, y no se elige ganador (prueba 11)', async () => {
        const id = await insertContact({
          phone: P_MOBILE,
          metadata: { hubspot_sync: legacyAuditBlock({ status: 'ok', hubspot_contact_id: 'hs-OTRO' }) },
        });
        assert.equal(await classOf(id), 'conflict_embedded_id');
        const before = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;

        await runBackfill();

        const after = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        assert.deepEqual(after, before);
        // Sigue siendo conflicto: el backfill no lo resuelve, lo DENUNCIA.
        assert.equal(await classOf(id), 'conflict_embedded_id');
      });

      it('id embebido IGUAL al de la columna: elegible y preservado (pruebas 9 y 10)', async () => {
        const sinEmbebido = await insertContact({
          phone: P_MOBILE,
          metadata: { hubspot_sync: { mode: 'created', synced_at: EARLIER } },
        });
        const conEmbebidoIgual = await insertContact({
          phone: P_MOBILE,
          metadata: { hubspot_sync: legacyAuditBlock({ status: 'ok' }) },
        });
        assert.equal(await classOf(sinEmbebido), 'eligible');
        assert.equal(await classOf(conEmbebidoIgual), 'eligible');

        await runBackfill();

        for (const id of [sinEmbebido, conEmbebidoIgual]) {
          const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
          // Prueba 9 — el id de la COLUMNA es el que entra en el estado, siempre.
          assert.equal(block.hubspot_contact_id, HS_ID);
          assert.equal(block.status, 'synced');
        }
      });

      it('contacto ARCHIVADO: fuera, porque toda la sincronización filtra `archived_at IS NULL`', async () => {
        const id = await insertContact({ phone: P_MOBILE, archivedAt: EARLIER });
        assert.equal(await classOf(id), 'archived_linked');
        await runBackfill();
        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown> | undefined;
        assert.equal(block === undefined || !Object.hasOwn(block, 'baseline_source'), true);
      });

      it('un `hubspot_contact_id` en blanco no es un vínculo', async () => {
        const id = await insertContact({ phone: P_MOBILE, hubspotContactId: '   ' });
        assert.equal(await classOf(id), 'unlinked');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 4 · recuentos e idempotencia
    // ═══════════════════════════════════════════════════════════════

    describe('4. observabilidad e idempotencia', () => {
      it('el informe cuenta lo que había ANTES y deja `after.eligible` en cero (prueba 16)', async () => {
        await insertContact({ phone: P_MOBILE });
        await insertContact({ phone: P_SECOND });
        await insertContact({ phone: P_MOBILE, metadata: { hubspot_sync: syncBlock() } });
        await insertContact({
          phone: P_MOBILE,
          metadata: { hubspot_sync: legacyAuditBlock({ status: 'ok', hubspot_contact_id: 'hs-OTRO' }) },
        });
        await insertContact({ hubspotContactId: null });

        const before = (await q(`SELECT public.hubspot_legacy_sync_backfill_census() AS c`)).rows[0]
          .c as Record<string, number>;
        assert.ok(before.eligible >= 2);

        const report = await runBackfill();
        assert.equal(report.eligible_count, before.eligible);
        assert.equal(Number(report.updated_count), before.eligible);
        assert.equal(report.conflict_count, before.conflict_embedded_id);
        assert.equal(report.skipped_valid_state_count, before.valid_state);
        // La condición del UPDATE y la del censo son LA MISMA función. Si divergieran, aquí
        // quedarían filas elegibles sin tocar.
        assert.equal((report.after as Record<string, number>).eligible, 0);
      });

      it('la segunda pasada cambia CERO filas y CERO bytes (pruebas 13 y 24)', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        await runBackfill();
        const afterFirst = await metadataOf(id);

        // Reloj DISTINTO a propósito: si la segunda pasada escribiera, `baseline_at` cambiaría y
        // la comparación lo delataría. Un «no cambió nada» que sólo fuera cierto con el mismo
        // reloj no probaría idempotencia, probaría una coincidencia.
        const second = await runBackfill(LATER);
        assert.equal(Number(second.updated_count), 0);
        assert.equal(second.eligible_count, 0);
        assert.deepEqual(await metadataOf(id), afterFirst);
      });

      it('el censo y el informe no llevan un solo id ni un solo teléfono', async () => {
        await insertContact({ phone: P_MOBILE });
        const report = JSON.stringify(await runBackfill());
        assert.equal(report.includes(HS_ID), false);
        assert.equal(report.includes(P_MOBILE), false);
        assert.equal(report.includes(ACCOUNT_ID), false);
      });

      it('es REVERSIBLE: un ROLLBACK devuelve las filas a elegibles (prueba 24)', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        const before = await metadataOf(id);

        // La migración entera va dentro de un BEGIN/COMMIT, así que un fallo en cualquier punto
        // deshace también el UPDATE de datos. Se demuestra ejerciéndolo: nada de lo que escribe
        // sobrevive a un ROLLBACK, y no queda ni un rastro fuera de la transacción.
        await q('BEGIN');
        const report = await runBackfill();
        assert.ok(Number(report.updated_count) >= 1);
        assert.equal(await classOf(id), 'valid_state');
        await q('ROLLBACK');

        assert.equal(await classOf(id), 'eligible');
        assert.deepEqual(await metadataOf(id), before);
      });

      it('un reloj nulo se rechaza sin escribir', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        const { rows } = await q(
          `SELECT public.backfill_legacy_hubspot_sync_state(NULL::timestamptz) AS report`,
        );
        assert.equal((rows[0].report as Record<string, unknown>).status, 'invalid_input');
        assert.equal(await classOf(id), 'eligible');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 5 · el permiso: esto no es una operación de cliente
    // ═══════════════════════════════════════════════════════════════

    describe('5. `anon` y `authenticated` no pueden ejecutar nada de esto', () => {
      for (const fn of [
        'hubspot_legacy_sync_backfill_class(text, timestamptz, jsonb)',
        'hubspot_legacy_sync_backfill_census()',
        'backfill_legacy_hubspot_sync_state(timestamptz)',
      ]) {
        it(`ni anon ni authenticated tienen EXECUTE sobre ${fn}`, async () => {
          for (const role of ['anon', 'authenticated']) {
            const { rows } = await q(
              `SELECT has_function_privilege($1, $2, 'EXECUTE') AS can`,
              [role, `public.${fn}`],
            );
            assert.equal(rows[0].can, false, `${role} puede ejecutar ${fn}`);
          }
          const { rows } = await q(
            `SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS can`,
            [`public.${fn}`],
          );
          assert.equal(rows[0].can, true, `service_role NO puede ejecutar ${fn}`);
        });
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // 6 · LO QUE EL BACKFILL DESBLOQUEA: los caminos REALES
    // ═══════════════════════════════════════════════════════════════

    describe('6. después de la línea base, los caminos reales SÍ marcan', () => {
      it('edición manual futura → `stale` / `phone_changed` / `user_edit` (prueba 16)', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        await runBackfill();
        await q(`UPDATE public.contacts SET phone = $2 WHERE id = $1`, [id, P_SECOND]);

        assert.equal(await markStale(id, P_MOBILE, 'user_edit'), 'marked');
        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        assert.equal(block.status, 'stale');
        assert.equal(block.stale_reason, 'phone_changed');
        assert.equal(block.stale_source, 'user_edit');
        assert.equal(block.stale_since, '2026-08-27T15:30:00.000Z');
        // La línea base SOBREVIVE al `stale`: marcar no es sincronizar, así que el `synced`
        // deducido de la que se partió sigue siendo deducido.
        assert.equal(block.baseline_source, 'legacy_link_backfill');
      });

      it('MERGE real (117) futuro → `stale` / `phone_changed` / `merge` (prueba 17)', async () => {
        // Sin escalar: la 117 sólo escribe `contacts.phone` cuando estaba NULL, así que éste es
        // el caso en que el merge SÍ cambia el saliente.
        const id = await insertContact({ phone: null });
        await runBackfill();
        assert.equal(
          ((await metadataOf(id)).hubspot_sync as Record<string, unknown>).status,
          'synced',
        );

        const envelope = await mergeOnto(id, P_MOBILE);
        assert.equal(envelope.status, 'merged');

        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        assert.equal(block.status, 'stale');
        assert.equal(block.stale_reason, 'phone_changed');
        assert.equal(block.stale_source, 'merge');
      });

      it('REVEAL real (128 re-emitida) futuro → `stale` / `phone_changed` / `reveal` (prueba 18)', async () => {
        const contactId = await insertContact({ phone: null });
        await runBackfill();

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
        await insertCandidatePhone({ candidateId, phone: P_SHADOW, isPrimary: true });

        const outcome = await project({ candidateId, contactId });
        assert.equal(outcome.status, 'projected');

        const block = (await metadataOf(contactId)).hubspot_sync as Record<string, unknown>;
        assert.equal(block.status, 'stale');
        assert.equal(block.stale_reason, 'phone_changed');
        assert.equal(block.stale_source, 'reveal');
      });

      it('SUPRESIÓN de privacidad (115) futura → `phone_removed` / `privacy`, jamás exportable (prueba 19)', async () => {
        const id = await insertContact({ phone: null });
        await runBackfill();
        // El merge deja el número y su procedencia de proveedor, que es lo que la erasure borra.
        await mergeOnto(id, P_MOBILE);

        const envelope = await suppress(id);
        assert.equal(envelope.status, 'suppressed');

        const { rows } = await q(
          `SELECT phone, metadata -> 'hubspot_sync' AS block FROM public.contacts WHERE id = $1`,
          [id],
        );
        assert.equal(rows[0].phone, null);
        const block = rows[0].block as Record<string, unknown>;
        assert.equal(block.status, 'stale');
        assert.equal(block.stale_reason, 'phone_removed');
        // EL campo del que depende toda la protección: una erasure NO se auto-exporta.
        assert.equal(block.stale_source, 'privacy');
      });

      it('el backfill por sí solo NO deja nada pendiente: cero PATCH automático (pruebas 20 y 15)', async () => {
        const id = await insertContact({ phone: P_MOBILE });
        await runBackfill();
        const block = (await metadataOf(id)).hubspot_sync as Record<string, unknown>;
        // `hasPendingHubSpotPhoneChange` exige razón + (`stale` | `failed`). La línea base no
        // tiene ninguna de las dos, así que el portero del PATCH automático sale por
        // `skipped_no_pending_change` sin tocar la red. El backfill no es una escritura de
        // teléfono y no tiene camino hacia ese ejecutor.
        assert.equal(block.status, 'synced');
        assert.equal(block.stale_reason, null);
        assert.equal(block.stale_source, null);
        // Y el teléfono no se tocó: el backfill sólo escribe `metadata`.
        const { rows } = await q(
          `SELECT phone, mobile_phone FROM public.contacts WHERE id = $1`,
          [id],
        );
        assert.equal(rows[0].phone, P_MOBILE);
        assert.equal(rows[0].mobile_phone, null);
      });
    });
  },
);
