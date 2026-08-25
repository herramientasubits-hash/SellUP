/**
 * Agente 2A — la proyección post-aprobación contra PostgreSQL 17 real
 * (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana `post-approval-reveal-static` fija el CONTRATO: qué dice el SQL. Lo que no
 * puede fijar es la GARANTÍA. «La 116 no puede hacer esto», «dos clics no proyectan dos veces»,
 * «un `p_contact_id` que no es el vínculo del servidor se rechaza», «un tombstone no revive»,
 * «el número que alguien tecleó sigue ahí», «una DSAR que confirma antes bloquea la proyección
 * entera» y «el navegador no puede invocar la función» no son reglas del código: son
 * transacciones, locks, índices únicos parciales, CHECKs y privilegios de PostgreSQL. Sólo
 * PostgreSQL puede demostrarlas.
 *
 * Y una en particular es la RAÍZ del hito y sólo se puede demostrar aquí: que
 * `approve_contact_candidate_with_phones` (116), invocada sobre un candidato YA APROBADO,
 * devuelve `already_approved` con CERO escrituras. Ese hecho —no una opinión sobre el diseño— es
 * lo que obliga a una función nueva.
 *
 * Aquí la cadena de migraciones se APLICA de verdad (099 → 107 → 109 → 112 → 113 → 114 → 115 →
 * 116 → 128), las escrituras ocurren contra un servidor real, los roles son los tres de Supabase
 * con sus default privileges, y lo que se comprueba después es el contenido de las tablas y el
 * SQLSTATE que devolvió el servidor.
 *
 * ⚠️ Los parámetros de la RPC salen del MISMO builder puro que usa la server action, en el mismo
 * orden. El SQL de la llamada se DERIVA del builder y no se escribe a mano: si el builder dejara
 * de mandar un parámetro, estas pruebas lo reflejarían en vez de taparlo — la lección de 4O-E4-R1,
 * donde los tests demostraban una propiedad de un escritor FICTICIO.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni ninguna base
 * remota; no gasta un crédito; no ejecuta ninguna DSAR real ni ningún reveal real. Todos los
 * números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito. Si el módulo no
 * está resuelto, el archivo se SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:post-approval-reveal:postgres
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN,
  buildApproveCandidateWithPhonesParams,
  buildCandidateScalarFallback,
  parseApproveCandidateWithPhonesEnvelope,
} from '../official-contact-approval-core';
import {
  buildCandidatePhoneSourceEventKey,
  normalizeCandidatePhone,
} from '../phone-collection-core';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

/** La cadena MÍNIMA REAL de la que depende la 128, en orden de aplicación. */
const MIGRATIONS = [
  '099_apollo_phone_reveal_cache.sql',
  '107_phone_reveal_cache_and_suppression_grants.sql',
  '109_contact_enrichment_candidate_phones.sql',
  '112_suppress_candidate_phone_collection.sql',
  '114_official_contact_phones.sql',
  '115_official_contact_phone_privacy.sql',
];
/** La aprobación: se aplica porque una de las pruebas mide LO QUE NO PUEDE HACER. */
const MIGRATION_116 = '116_approve_candidate_with_official_phones.sql';
/** LA MIGRACIÓN BAJO PRUEBA. */
const MIGRATION_128 = '128_project_approved_candidate_phones_onto_contact.sql';

const INSUFFICIENT_PRIVILEGE = '42501';

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

// ═══════════════════════════════════════════════════════════════
// Datos sintéticos
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT_ID = '10000000-0000-4000-8000-000000000002';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';
const RUN_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_RUN_ID = '40000000-0000-4000-8000-000000000002';
const APOLLO_PERSON_ID = '54a51197746869367665167a';

const NOW = '2026-08-25T12:00:00.000Z';

/** Números sintéticos 555, en forma E.164 verificable. */
const P_MOBILE = '+15550000001';
const P_DIRECT = '+15550000002';
const P_WORK = '+15550000003';
const P_INCUMBENT = '+15550000009';

const keyOf = (phone: string) =>
  normalizeCandidatePhone({ displayPhone: phone, sanitizedPhone: phone, countryCode: null })
    .dedupeKey;

describe(
  'POST-APPROVAL — la proyección candidato → contacto, en PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    /** Segunda conexión: hace de operador concurrente y de rol `authenticated`. */
    let other: PgLikeClient;
    let dataDir: string;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => client.query(sql, values);

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-postapproval-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401-54407 y 54418/54419 ya los usan las suites hermanas.
        port: 54420,
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
          phone_processing_basis  text,
          apollo_person_id        text,
          source                  text,
          source_contact_id       text,
          CONSTRAINT contact_enrichment_candidates_status_check
            CHECK (status IN ('pending_review','approved','discarded','duplicate')));`);

      for (const file of MIGRATIONS) await q(readMigration(file));

      // La 113 instala los dos helpers de supresión por persona que la 116 y la 128 reutilizan.
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
      await q(readMigration(MIGRATION_128));

      await q(`INSERT INTO public.accounts (id, name) VALUES ($1, 'ACME'), ($2, 'OTRA')`, [
        ACCOUNT_ID,
        OTHER_ACCOUNT_ID,
      ]);
      await q(
        `INSERT INTO public.internal_users (id, auth_user_id, access_status)
         VALUES ($1, $1, 'active')`,
        [ACTOR_ID],
      );
      await q(
        `INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2), ($3, $4)`,
        [RUN_ID, ACCOUNT_ID, OTHER_RUN_ID, OTHER_ACCOUNT_ID],
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

    /** El contacto OFICIAL tal como lo deja la aprobación: sin teléfono y con su vínculo. */
    async function insertApprovedContact(
      args: {
        candidateId?: string | null;
        phone?: string | null;
        phoneType?: string | null;
        phoneSource?: string | null;
        accountId?: string;
        archived?: boolean;
      } = {},
    ): Promise<string> {
      seq += 1;
      const metadata: Record<string, unknown> = {
        source: 'contact_enrichment_candidate',
      };
      if (args.candidateId !== null) {
        metadata.source_candidate_id = args.candidateId ?? null;
      }
      const { rows } = await q(
        `INSERT INTO public.contacts
           (account_id, full_name, email, phone, phone_type, phone_source, source, metadata,
            created_by, updated_by, archived_at)
         VALUES ($1,$2,$3,$4,$5,$6,'apollo',$7,$8,$8,$9) RETURNING id`,
        [
          args.accountId ?? ACCOUNT_ID,
          `Contacto Oficial ${seq}`,
          `oficial${seq}@example.invalid`,
          args.phone ?? null,
          args.phoneType ?? null,
          args.phoneSource ?? null,
          JSON.stringify(metadata),
          ACTOR_ID,
          args.archived ? NOW : null,
        ],
      );
      return rows[0].id as string;
    }

    /** Un candidato APROBADO, que es el único estado sobre el que la 128 actúa. */
    async function insertCandidate(args: {
      matchedContactId: string | null;
      status?: string;
      phone?: string | null;
      metadata?: Record<string, unknown>;
      apolloPersonId?: string | null;
      processingBasis?: string | null;
      runId?: string;
    }): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidates
           (enrichment_run_id, status, full_name, phone, enrichment_metadata,
            apollo_person_id, source, source_contact_id, matched_contacts_id,
            phone_processing_basis)
         VALUES ($1,$2,$3,$4,$5,$6,'apollo',$7,$8,$9) RETURNING id`,
        [
          args.runId ?? RUN_ID,
          args.status ?? 'approved',
          `Candidato Sintetico ${seq}`,
          args.phone ?? null,
          JSON.stringify(args.metadata ?? {}),
          args.apolloPersonId ?? null,
          args.apolloPersonId ?? null,
          args.matchedContactId,
          args.processingBasis ?? null,
        ],
      );
      return rows[0].id as string;
    }

    /** Un teléfono en la colección del candidato: lo que deja un reveal ya persistido. */
    async function insertCandidatePhone(args: {
      candidateId: string;
      phone: string;
      phoneType?: string | null;
      isPrimary?: boolean;
      phoneStatus?: string;
      suppressed?: boolean;
    }): Promise<string> {
      const dedupeKey = keyOf(args.phone);
      if (args.suppressed) {
        const { rows } = await q(
          `INSERT INTO public.contact_enrichment_candidate_phones
             (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type,
              phone_status, is_primary, suppressed_at, suppression_reason, suppressed_by)
           VALUES ($1,$2,NULL,NULL,NULL,$3,false,$4,'data_subject_request',$5) RETURNING id`,
          [args.candidateId, dedupeKey, args.phoneStatus ?? 'unknown', NOW, ACTOR_ID],
        );
        return rows[0].id as string;
      }
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidate_phones
           (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type,
            phone_status, is_primary)
         VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`,
        [
          args.candidateId,
          dedupeKey,
          args.phone,
          args.phoneType ?? 'mobile',
          args.phoneStatus ?? 'unknown',
          args.isPrimary ?? false,
        ],
      );
      return rows[0].id as string;
    }

    async function insertCandidatePhoneSource(args: {
      candidatePhoneId: string;
      provider: string;
      acquisitionMode: string;
      rawProviderType?: string | null;
    }): Promise<void> {
      await q(
        `INSERT INTO public.contact_enrichment_candidate_phone_sources
           (candidate_phone_id, provider, acquisition_mode, raw_provider_type,
            source_event_key, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          args.candidatePhoneId,
          args.provider,
          args.acquisitionMode,
          args.rawProviderType ?? null,
          buildCandidatePhoneSourceEventKey({
            provider: args.provider as never,
            acquisitionMode: args.acquisitionMode as never,
            phase: 'apollo' as never,
            waterfallRunId: null,
            reservationId: null,
            providerUsageLogId: null,
          }) + `:${args.provider}:${args.acquisitionMode}`,
          NOW,
        ],
      );
    }

    /**
     * Invoca la RPC EXACTAMENTE como lo hace la persistencia: los parámetros salen del MISMO
     * builder puro que usa la server action, en el mismo orden posicional.
     */
    async function project(
      conn: PgLikeClient,
      args: {
        candidateId: string;
        contactId: string;
        scalarFallback?: Record<string, unknown> | null;
      },
    ): Promise<ProjectApprovedCandidatePhonesOutcome> {
      const params = buildProjectApprovedCandidatePhonesParams({
        candidateId: args.candidateId,
        contactId: args.contactId,
        scalarFallback: args.scalarFallback ?? null,
        actorId: ACTOR_ID,
        nowIso: NOW,
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

    const livePhones = async (contactId: string) =>
      (
        await q(
          `SELECT dedupe_key, normalized_phone, display_phone, phone_type, is_primary
             FROM public.contact_phones
            WHERE contact_id = $1 AND suppressed_at IS NULL
            ORDER BY dedupe_key`,
          [contactId],
        )
      ).rows;

    const contactRow = async (contactId: string) =>
      (
        await q(
          `SELECT phone, phone_type, phone_source, phone_raw_type, phone_revealed_at,
                  phone_processing_basis, mobile_phone, phone_confidence, updated_by
             FROM public.contacts WHERE id = $1`,
          [contactId],
        )
      ).rows[0];

    const sourcesOf = async (contactId: string) =>
      (
        await q(
          `SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.source_event_key,
                  p.dedupe_key
             FROM public.contact_phone_sources s
             JOIN public.contact_phones p ON p.id = s.contact_phone_id
            WHERE p.contact_id = $1
            ORDER BY p.dedupe_key, s.provider`,
          [contactId],
        )
      ).rows;

    const contactCount = async () =>
      Number((await q(`SELECT COUNT(*)::int AS n FROM public.contacts`)).rows[0].n);

    // ═══════════════════════════════════════════════════════════════
    // 0. LA RAÍZ: por qué la 116 no puede hacer esto
    // ═══════════════════════════════════════════════════════════════

    describe('la causa raíz, medida y no argumentada', () => {
      it('la 116 sobre un candidato YA APROBADO no escribe NADA', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        const phoneId = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const params = buildApproveCandidateWithPhonesParams({
          candidateId,
          accountId: ACCOUNT_ID,
          contactPayload: {
            account_id: ACCOUNT_ID,
            full_name: 'No debe crearse',
            source: 'apollo',
            metadata: {},
          },
          reviewPatch: { status: 'approved' },
          scalarFallback: null,
          actorId: ACTOR_ID,
          nowIso: NOW,
        });
        const names = Object.keys(params);
        const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
        const before = await contactCount();
        const { rows } = await q(
          `SELECT public.${APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN}(${placeholders}) AS envelope`,
          names.map((n) => {
            const v = (params as Record<string, unknown>)[n];
            return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
          }),
        );
        const envelope = parseApproveCandidateWithPhonesEnvelope(rows[0].envelope);

        assert.equal(envelope.status, 'already_approved');
        assert.equal(envelope.phonesInserted, 0);
        assert.equal(envelope.contactCreated, false);
        // Y NADA llegó al contacto: es exactamente el hueco que la 128 cierra.
        assert.deepEqual(await livePhones(contactId), []);
        assert.equal((await contactRow(contactId)).phone, null);
        assert.equal(await contactCount(), before, 'la 116 no creó un segundo contacto');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 1. LA REGRESIÓN PRISCILLA
    // ═══════════════════════════════════════════════════════════════

    describe('Priscilla — el teléfono llega a la ficha', () => {
      it('proyecta el número, su procedencia y el escalar heredado', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({
          matchedContactId: contactId,
          apolloPersonId: APOLLO_PERSON_ID,
          processingBasis: 'legitimate_interest_b2b',
        });
        const phoneId = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          rawProviderType: 'mobile',
        });

        const before = await contactCount();
        const envelope = await project(client, { candidateId, contactId });

        assert.equal(envelope.status, 'projected');
        assert.equal(envelope.phonesInserted, 1);
        assert.equal(envelope.sourcesInserted, 1);
        assert.equal(envelope.primaryElectedNow, true);
        assert.equal(envelope.scalarSynced, true);
        assert.equal(envelope.primaryDedupeKey, keyOf(P_MOBILE));

        // DUPLICATE_CONTACT_CREATED = NO
        assert.equal(await contactCount(), before);

        // La colección oficial tiene el número, y es el principal.
        const phones = await livePhones(contactId);
        assert.equal(phones.length, 1);
        assert.equal(phones[0].normalized_phone, P_MOBILE);
        assert.equal(phones[0].is_primary, true);

        // PHONE_SOURCE_PRESERVED: proveedor, modo y tipo crudo, con el namespace de la 116.
        const sources = await sourcesOf(contactId);
        assert.equal(sources.length, 1);
        assert.equal(sources[0].provider, 'apollo');
        assert.equal(sources[0].acquisition_mode, 'reveal');
        assert.equal(sources[0].raw_provider_type, 'mobile');
        assert.match(String(sources[0].source_event_key), /^v1:promoted:/);

        // Y el escalar heredado, con la tupla completa.
        const contact = await contactRow(contactId);
        assert.equal(contact.phone, P_MOBILE);
        assert.equal(contact.phone_type, 'mobile');
        assert.equal(contact.phone_source, 'apollo_reveal');
        assert.equal(contact.phone_raw_type, 'mobile');
        assert.ok(contact.phone_revealed_at);
        assert.equal(contact.phone_processing_basis, 'legitimate_interest_b2b');
        // NUNCA `mobile_phone` (4O-E4.1) ni `phone_confidence`.
        assert.equal(contact.mobile_phone, null);
        assert.equal(contact.phone_confidence, null);
      });

      it('dos clics NO proyectan dos veces (idempotente por índice único)', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        const phoneId = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const first = await project(client, { candidateId, contactId });
        const second = await project(client, { candidateId, contactId });

        assert.equal(first.phonesInserted, 1);
        assert.equal(second.status, 'projected');
        assert.equal(second.phonesInserted, 0, 'la segunda no inserta nada');
        assert.equal(second.phonesReused, 1);
        assert.equal(second.sourcesInserted, 0, 'ni una procedencia duplicada');
        assert.equal((await livePhones(contactId)).length, 1);
        assert.equal((await sourcesOf(contactId)).length, 1);
      });

      it('un segundo número que llega después se AÑADE sin desplazar al principal', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        const first = await insertCandidatePhone({
          candidateId,
          phone: P_WORK,
          phoneType: 'work',
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: first,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await project(client, { candidateId, contactId });
        const scalarAfterFirst = (await contactRow(contactId)).phone;

        // Ahora Lusha trae un `personal_mobile`, que en el ranking va PRIMERO.
        const second = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'personal_mobile',
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: second,
          provider: 'lusha',
          acquisitionMode: 'reveal',
        });
        const envelope = await project(client, { candidateId, contactId });

        assert.equal(envelope.phonesInserted, 1);
        assert.equal(envelope.primaryElectedNow, false, 'el incumbente no se re-prioriza');
        const phones = await livePhones(contactId);
        assert.equal(phones.length, 2);
        const primary = phones.filter((p) => p.is_primary === true);
        assert.equal(primary.length, 1);
        assert.equal(primary[0].normalized_phone, P_WORK, 'el principal sigue siendo el mismo');
        assert.equal(
          (await contactRow(contactId)).phone,
          scalarAfterFirst,
          'y el escalar tampoco cambia',
        );
      });

      it('Apollo y Lusha viendo el MISMO número producen UNA fila y DOS procedencias', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        const phoneId = await insertCandidatePhone({
          candidateId,
          phone: P_DIRECT,
          phoneType: 'direct_dial',
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'lusha',
          acquisitionMode: 'reveal',
        });

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.phonesInserted, 1);
        assert.equal(envelope.sourcesInserted, 2);
        assert.equal((await livePhones(contactId)).length, 1);
        const providers = (await sourcesOf(contactId)).map((s) => s.provider).sort();
        assert.deepEqual(providers, ['apollo', 'lusha']);
      });

      it('EXISTING_PHONE_REUSE: teléfonos anteriores a la aprobación se promueven sin proveedor', async () => {
        // §10 — el candidato ya tenía dos números cuando se aprobó (y el escalar del contacto
        // quedó en NULL porque la aprobación no promovió la colección). Proyectarlos no llama a
        // nadie: esta función no puede, no tiene ninguna vía.
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        for (const [phone, type, primary] of [
          [P_MOBILE, 'mobile', true],
          [P_WORK, 'work', false],
        ] as const) {
          const id = await insertCandidatePhone({
            candidateId,
            phone,
            phoneType: type,
            isPrimary: primary,
          });
          await insertCandidatePhoneSource({
            candidatePhoneId: id,
            provider: 'apollo',
            acquisitionMode: 'search',
          });
        }

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.phonesInserted, 2);
        assert.equal((await livePhones(contactId)).length, 2);
        assert.equal((await contactRow(contactId)).phone, P_MOBILE);
        assert.equal((await contactRow(contactId)).phone_source, 'apollo_search');
      });

      it('el candidato escalar-only se promueve con EL builder compartido', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({
          matchedContactId: contactId,
          phone: P_DIRECT,
          metadata: { phone: { type: 'direct_dial', source: 'apollo_search', raw_type: 'work' } },
        });
        const fallback = buildCandidateScalarFallback({
          phone: P_DIRECT,
          phoneMetadata: { type: 'direct_dial', source: 'apollo_search', raw_type: 'work' },
          countryCode: null,
        });
        assert.ok(fallback, 'el builder compartido debe poder invertir esta procedencia');

        const envelope = await project(client, {
          candidateId,
          contactId,
          scalarFallback: fallback as unknown as Record<string, unknown>,
        });
        assert.equal(envelope.scalarFallback, 'promoted');
        assert.equal(envelope.phonesInserted, 1);
        assert.equal((await contactRow(contactId)).phone_source, 'apollo_search');
      });

      it('una procedencia que NO invierte no promueve nada, y no inventa un proveedor', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({
          matchedContactId: contactId,
          phone: P_DIRECT,
          metadata: { phone: { type: 'direct_dial', source: 'provider_payload' } },
        });
        const fallback = buildCandidateScalarFallback({
          phone: P_DIRECT,
          phoneMetadata: { type: 'direct_dial', source: 'provider_payload' },
          countryCode: null,
        });
        assert.equal(fallback, null, '`provider_payload` no nombra a ningún proveedor');

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.scalarFallback, 'unrepresentable');
        assert.equal(envelope.phonesInserted, 0);
        assert.deepEqual(await livePhones(contactId), []);
        assert.equal((await contactRow(contactId)).phone, null);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 2. LOS RECHAZOS: cero escrituras
    // ═══════════════════════════════════════════════════════════════

    describe('lo que la 128 se niega a hacer', () => {
      it('MISSING_SOURCE_CANDIDATE / vínculo ausente ⇒ contact_link_missing', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: null });
        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.status, 'contact_link_missing');
        assert.deepEqual(await livePhones(contactId), []);
      });

      it('la guarda IDOR: un p_contact_id que NO es el vínculo del servidor se rechaza', async () => {
        const mine = await insertApprovedContact();
        const someoneElse = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: mine });
        const phoneId = await insertCandidatePhone({ candidateId, phone: P_MOBILE, isPrimary: true });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const envelope = await project(client, { candidateId, contactId: someoneElse });
        assert.equal(envelope.status, 'contact_link_mismatch');
        assert.deepEqual(await livePhones(someoneElse), [], 'ni una fila en el contacto ajeno');
        assert.deepEqual(await livePhones(mine), [], 'ni en el propio: la función cortó antes');
      });

      it('un candidato que no está APROBADO no se proyecta', async () => {
        for (const status of ['pending_review', 'discarded', 'duplicate']) {
          const contactId = await insertApprovedContact();
          const candidateId = await insertCandidate({ matchedContactId: contactId, status });
          const phoneId = await insertCandidatePhone({
            candidateId,
            phone: P_MOBILE,
            isPrimary: true,
          });
          await insertCandidatePhoneSource({
            candidatePhoneId: phoneId,
            provider: 'apollo',
            acquisitionMode: 'reveal',
          });
          const envelope = await project(client, { candidateId, contactId });
          assert.equal(envelope.status, 'candidate_not_projectable', status);
          assert.deepEqual(await livePhones(contactId), []);
        }
      });

      it('un contacto de OTRA cuenta se rechaza aunque el vínculo apunte a él', async () => {
        const foreign = await insertApprovedContact({ accountId: OTHER_ACCOUNT_ID });
        const candidateId = await insertCandidate({ matchedContactId: foreign });
        const envelope = await project(client, { candidateId, contactId: foreign });
        assert.equal(envelope.status, 'contact_mismatch');
      });

      it('un contacto ARCHIVADO no recibe números nuevos', async () => {
        const contactId = await insertApprovedContact({ archived: true });
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        const phoneId = await insertCandidatePhone({ candidateId, phone: P_MOBILE, isPrimary: true });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.status, 'contact_not_projectable');
        assert.deepEqual(await livePhones(contactId), []);
      });

      it('escalar heredado + colección VACÍA ⇒ scalar_incumbent_unprojectable, 0 escrituras', async () => {
        // El estado legado que la 117 resuelve con un bootstrap. Aquí se REFUSA en vez de
        // inventar una procedencia para el número que alguien tecleó.
        const contactId = await insertApprovedContact({
          phone: P_INCUMBENT,
          phoneType: 'work',
          phoneSource: 'manual',
        });
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        const phoneId = await insertCandidatePhone({ candidateId, phone: P_MOBILE, isPrimary: true });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.status, 'scalar_incumbent_unprojectable');
        assert.deepEqual(await livePhones(contactId), []);
        const contact = await contactRow(contactId);
        assert.equal(contact.phone, P_INCUMBENT, 'el número que alguien tecleó sigue ahí');
        assert.equal(contact.phone_source, 'manual');
      });

      it('una DSAR que confirma antes bloquea la proyección ENTERA', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({
          matchedContactId: contactId,
          apolloPersonId: APOLLO_PERSON_ID,
        });
        const phoneId = await insertCandidatePhone({ candidateId, phone: P_MOBILE, isPrimary: true });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        // El tombstone POR PERSONA de la 099/113, con la clave (apollo, person, account).
        await q(
          `INSERT INTO public.phone_reveal_cache
             (provider, provider_person_id, account_id, country_code,
              original_revealed_at, expires_at, suppressed_at, suppression_reason, suppressed_by)
           VALUES ('apollo', public.phone_reveal_normalized_apollo_person_id($1), $2, 'US',
                   $3, $3, $3, 'dsar_erasure_request', $4)`,
          [APOLLO_PERSON_ID, ACCOUNT_ID, NOW, ACTOR_ID],
        );

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.status, 'person_suppressed');
        assert.deepEqual(await livePhones(contactId), []);
        assert.equal((await contactRow(contactId)).phone, null);
      });

      it('un teléfono SUPRIMIDO del candidato nunca se promueve', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        await insertCandidatePhone({ candidateId, phone: P_MOBILE, suppressed: true });
        const live = await insertCandidatePhone({
          candidateId,
          phone: P_WORK,
          phoneType: 'work',
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: live,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.phonesSkippedSuppressed, 1);
        assert.equal(envelope.phonesInserted, 1);
        const keys = (await livePhones(contactId)).map((p) => p.dedupe_key);
        assert.deepEqual(keys, [keyOf(P_WORK)]);
      });

      it('un tombstone OFICIAL no revive ni gana procedencia nueva', async () => {
        const contactId = await insertApprovedContact();
        const candidateId = await insertCandidate({ matchedContactId: contactId });
        // El contacto ya tuvo ese número y la 115 lo tombstoneó (fila sin número, con
        // `suppressed_at`), más un número vivo para que la colección no esté vacía.
        await q(
          `INSERT INTO public.contact_phones
             (contact_id, normalized_phone, display_phone, dedupe_key, phone_type,
              phone_status, is_primary, suppressed_at, suppression_reason, suppressed_by)
           VALUES ($1, NULL, NULL, $2, NULL, 'unknown', false, $3, 'data_subject_request', $4)`,
          [contactId, keyOf(P_MOBILE), NOW, ACTOR_ID],
        );
        await q(
          `INSERT INTO public.contact_phones
             (contact_id, normalized_phone, display_phone, dedupe_key, phone_type,
              phone_status, is_primary)
           VALUES ($1, $2, $2, $3, 'work', 'unknown', true)`,
          [contactId, P_WORK, keyOf(P_WORK)],
        );

        const phoneId = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          isPrimary: true,
        });
        await insertCandidatePhoneSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const envelope = await project(client, { candidateId, contactId });
        assert.equal(envelope.phonesInserted, 0, 'el DO NOTHING se lo comió');
        assert.equal(envelope.sourcesInserted, 0, 'y su procedencia no se colgó del tombstone');
        const revived = await q(
          `SELECT normalized_phone, suppressed_at FROM public.contact_phones
            WHERE contact_id = $1 AND dedupe_key = $2`,
          [contactId, keyOf(P_MOBILE)],
        );
        assert.equal(revived.rows[0].normalized_phone, null);
        assert.ok(revived.rows[0].suppressed_at);
      });

      it('parámetros inválidos: fail-closed antes de cualquier escritura', async () => {
        const { rows } = await q(
          `SELECT public.${PROJECT_APPROVED_CANDIDATE_PHONES_FN}(NULL, NULL, NULL, NULL, NULL) AS e`,
        );
        const envelope = parseProjectApprovedCandidatePhonesEnvelope(rows[0].e);
        assert.equal(envelope.status, 'invalid_input');
      });

      it('un candidato que no existe no crea nada', async () => {
        const contactId = await insertApprovedContact();
        const envelope = await project(client, {
          candidateId: '99999999-9999-4999-8999-999999999999',
          contactId,
        });
        assert.equal(envelope.status, 'candidate_not_found');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // 3. PRIVILEGIOS
    // ═══════════════════════════════════════════════════════════════

    describe('privilegios de EXECUTE', () => {
      it('`authenticated` NO puede invocar la función', async () => {
        await other.query(`SET ROLE authenticated`);
        await assert.rejects(
          () =>
            other.query(
              `SELECT public.${PROJECT_APPROVED_CANDIDATE_PHONES_FN}(NULL, NULL, NULL, NULL, NULL)`,
            ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, INSUFFICIENT_PRIVILEGE);
            return true;
          },
        );
        await other.query(`RESET ROLE`);
      });

      it('`anon` tampoco', async () => {
        await other.query(`SET ROLE anon`);
        await assert.rejects(
          () =>
            other.query(
              `SELECT public.${PROJECT_APPROVED_CANDIDATE_PHONES_FN}(NULL, NULL, NULL, NULL, NULL)`,
            ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, INSUFFICIENT_PRIVILEGE);
            return true;
          },
        );
        await other.query(`RESET ROLE`);
      });
    });
  },
);
