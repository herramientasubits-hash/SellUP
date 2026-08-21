/**
 * Agente 2A — el merge humano hacia un contacto EXISTENTE, contra PostgreSQL 17 real
 * (AGENT2A-PHONE-REVEAL-4O-H3-B).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana `…-static-4o-h3b` fija el CONTRATO: qué dice el SQL. Lo que no puede fijar es
 * la GARANTÍA. «El principal del operador sobrevive», «el número que la persona tecleó sigue en
 * `contacts.phone` después de fusionar tres números de Apollo», «un tombstone no revive ni gana
 * procedencia nueva», «dos clics no fusionan dos veces», «una DSAR que confirma antes bloquea el
 * merge entero» y «un merge deja el contacto ALCANZABLE por el borrado» no son reglas del
 * código: son transacciones, locks, índices únicos parciales, CHECKs y privilegios de
 * PostgreSQL. Sólo PostgreSQL puede demostrarlas.
 *
 * Aquí la cadena de migraciones se APLICA de verdad (099 → 107 → 109 → 112 → 113 → 114 → 115 →
 * 116 → 117), las escrituras ocurren contra un servidor real, los roles son los tres de Supabase
 * con sus default privileges, y lo que se comprueba después es el contenido de las tablas y el
 * SQLSTATE que devolvió el servidor.
 *
 * ⚠️ Los parámetros de la RPC salen del MISMO builder puro que usa la server action, en el mismo
 * orden. El SQL de la llamada se DERIVA del builder y no se escribe a mano: si el builder dejara
 * de mandar un parámetro, estas pruebas lo reflejarían en vez de taparlo — la lección de
 * 4O-E4-R1, donde los tests demostraban una propiedad de un escritor FICTICIO.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni ninguna base
 * remota; no gasta un crédito; no ejecuta ninguna DSAR real ni ningún merge real. Todos los
 * números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito. Si el módulo no
 * está resuelto, el archivo se SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:existing-contact-merge:postgres
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
  parseMergeCandidateEnvelope,
} from '../existing-contact-merge-core';
import { buildCandidateScalarFallback } from '../official-contact-approval-core';
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
/** LA MIGRACIÓN BAJO PRUEBA. */
const MIGRATION_117 = '117_merge_candidate_into_existing_contact.sql';

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
const APOLLO_PERSON_ID = '5f1a2b3c4d5e6f7a8b9c0d1e';

const NOW = '2026-08-12T12:00:00.000Z';

/** Números sintéticos 555, en forma E.164 verificable. */
const P_MOBILE = '+15550000001';
const P_DIRECT = '+15550000002';
const P_WORK = '+15550000003';
const P_INCUMBENT = '+15550000009';

const keyOf = (phone: string) =>
  normalizeCandidatePhone({ displayPhone: phone, sanitizedPhone: phone, countryCode: null })
    .dedupeKey;

describe(
  '4O-H3-B — merge humano hacia un contacto existente, en PostgreSQL real',
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
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oh3b-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401 lo usan 4O-F y H1, 54402 la de H2, 54403 la de H3-A.
        port: 54404,
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
      if (other) await other.end().catch(() => {});
      if (client) await client.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Helpers ────────────────────────────────────────────────────

    let seq = 0;

    /** Un contacto EXISTENTE, como los que hay hoy en Producción. */
    async function insertContact(
      args: {
        phone?: string | null;
        phoneType?: string | null;
        phoneSource?: string | null;
        phoneRawType?: string | null;
        phoneRevealedAt?: string | null;
        accountId?: string;
        archived?: boolean;
        metadata?: Record<string, unknown>;
      } = {},
    ): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contacts
           (account_id, full_name, email, phone, phone_type, phone_source, phone_raw_type,
            phone_revealed_at, source, metadata, created_by, updated_by, archived_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$10,$11) RETURNING id`,
        [
          args.accountId ?? ACCOUNT_ID,
          `Contacto Existente ${seq}`,
          `existente${seq}@example.invalid`,
          args.phone ?? null,
          args.phoneType ?? null,
          args.phoneSource ?? null,
          args.phoneRawType ?? null,
          args.phoneRevealedAt ?? null,
          JSON.stringify(args.metadata ?? {}),
          ACTOR_ID,
          args.archived ? NOW : null,
        ],
      );
      return rows[0].id as string;
    }

    /** Un candidato ya terminalizado como `duplicate`, que es donde empieza el merge. */
    async function insertDuplicateCandidate(
      args: {
        matchedContactId: string | null;
        phone?: string | null;
        metadata?: Record<string, unknown>;
        apolloPersonId?: string | null;
        status?: string;
      },
    ): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidates
           (enrichment_run_id, status, full_name, phone, enrichment_metadata,
            apollo_person_id, source, duplicate_status, matched_contacts_id)
         VALUES ($1,$2,$3,$4,$5,$6,'apollo','exact_duplicate',$7) RETURNING id`,
        [
          RUN_ID,
          args.status ?? 'duplicate',
          `Candidato Sintetico ${seq}`,
          args.phone ?? null,
          JSON.stringify(args.metadata ?? {}),
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

    async function insertCandidateSource(args: {
      candidatePhoneId: string;
      provider: string;
      acquisitionMode: string;
      phase?: string | null;
      rawType?: string | null;
      observedAt?: string;
    }): Promise<void> {
      const eventKey = buildCandidatePhoneSourceEventKey({
        provider: args.provider as never,
        acquisitionMode: args.acquisitionMode as never,
        phase: args.phase ?? null,
        waterfallRunId: null,
        reservationId: null,
        providerUsageLogId: null,
      });
      await q(
        `INSERT INTO public.contact_enrichment_candidate_phone_sources
           (candidate_phone_id, provider, acquisition_mode, raw_provider_type,
            source_event_key, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          args.candidatePhoneId,
          args.provider,
          args.acquisitionMode,
          args.rawType ?? null,
          eventKey,
          args.observedAt ?? NOW,
        ],
      );
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

    function reviewPatch(over: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        status: 'duplicate',
        duplicate_status: 'exact_duplicate',
        review_notes: 'Duplicado fusionado con un contacto existente',
        reviewed_by: ACTOR_ID,
        reviewed_at: NOW,
        enrichment_metadata: { review: { status: 'duplicate', reviewed_by: ACTOR_ID } },
        ...over,
      };
    }

    /**
     * Invoca la RPC EXACTAMENTE como lo hace la persistencia: los parámetros salen del MISMO
     * builder puro que usa la server action, en el mismo orden.
     */
    async function merge(
      conn: PgLikeClient,
      args: {
        candidateId: string;
        contactId: string;
        accountId?: string;
        patch?: Record<string, unknown>;
        scalarFallback?: ReturnType<typeof buildCandidateScalarFallback>;
        incumbentBootstrap?: ReturnType<typeof buildIncumbentContactBootstrap>;
      },
    ) {
      const params = buildMergeCandidateIntoExistingContactParams({
        candidateId: args.candidateId,
        contactId: args.contactId,
        accountId: args.accountId ?? ACCOUNT_ID,
        reviewPatch: args.patch ?? reviewPatch(),
        scalarFallback: args.scalarFallback ?? null,
        incumbentBootstrap: args.incumbentBootstrap ?? null,
        actorId: ACTOR_ID,
        nowIso: NOW,
      });
      const names = Object.keys(params);
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await conn.query(
        `SELECT public.${MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN}(${placeholders}) AS envelope`,
        names.map((n) => {
          const v = (params as Record<string, unknown>)[n];
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }),
      );
      return parseMergeCandidateEnvelope(rows[0].envelope);
    }

    /** El bootstrap del incumbente derivado de la fila REAL, como hace la server action. */
    async function bootstrapFor(contactId: string) {
      const { rows } = await q(
        `SELECT phone, phone_type, phone_source, phone_raw_type
           FROM public.contacts WHERE id = $1`,
        [contactId],
      );
      const r = rows[0];
      return buildIncumbentContactBootstrap({
        phone: r.phone as string | null,
        phoneType: r.phone_type as string | null,
        phoneSource: r.phone_source as string | null,
        phoneRawType: r.phone_raw_type as string | null,
      });
    }

    async function waitUntilBlocked(pid: number): Promise<void> {
      for (let i = 0; i < 200; i += 1) {
        const { rows } = await q(
          `SELECT COUNT(*)::int AS n FROM pg_locks WHERE pid = $1 AND NOT granted`,
          [pid],
        );
        if ((rows[0].n as number) > 0) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.fail('la conexión concurrente nunca llegó a bloquearse');
    }

    const livePhones = async (contactId: string) =>
      (
        await q(
          `SELECT dedupe_key, normalized_phone, phone_type, is_primary
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
                  mobile_phone, phone_confidence, metadata
             FROM public.contacts WHERE id = $1`,
          [contactId],
        )
      ).rows[0];

    const candidateRow = async (candidateId: string) =>
      (
        await q(
          `SELECT status, duplicate_status, matched_contacts_id, enrichment_metadata
             FROM public.contact_enrichment_candidates WHERE id = $1`,
          [candidateId],
        )
      ).rows[0];

    // ═══════════════════════════════════════════════════════════
    // 1. El caso central: añadir sin destruir
    // ═══════════════════════════════════════════════════════════

    it('añade los tres números del candidato al contacto existente', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      for (const [phone, type] of [
        [P_MOBILE, 'personal_mobile'],
        [P_DIRECT, 'direct_dial'],
        [P_WORK, 'work'],
      ] as const) {
        const id = await insertCandidatePhone({ candidateId, phone, phoneType: type });
        await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });
      }

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.status, 'merged');
      assert.equal(out.contactCreated, false, 'un merge no crea contactos');
      assert.equal(out.phonesInserted, 3);
      assert.equal(out.sourcesInserted, 3);
      assert.equal((await livePhones(contactId)).length, 3);
    });

    it('un número que el contacto YA tenía gana la procedencia nueva sin duplicar la fila', async () => {
      const contactId = await insertContact();
      await insertOfficialPhone({ contactId, phone: P_MOBILE, provider: 'apollo', acquisitionMode: 'reveal' });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'lusha', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.phonesInserted, 0);
      assert.equal(out.phonesReused, 1, 'la fila canónica existente se reutiliza');
      assert.equal(out.sourcesInserted, 1);
      assert.equal((await livePhones(contactId)).length, 1, 'UNA fila canónica, no dos');

      const { rows } = await q(
        `SELECT s.provider FROM public.contact_phone_sources s
           JOIN public.contact_phones p ON p.id = s.contact_phone_id
          WHERE p.contact_id = $1 ORDER BY s.provider`,
        [contactId],
      );
      assert.deepEqual(rows.map((r) => r.provider), ['apollo', 'lusha']);
    });

    it('Apollo y Lusha sobre el MISMO número son una fila canónica y dos procedencias', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'lusha', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.phonesInserted, 1);
      assert.equal(out.sourcesInserted, 2);
    });

    it('un teléfono SUPRIMIDO del candidato no se promueve y se cuenta aparte', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      await insertCandidatePhone({ candidateId, phone: P_MOBILE, suppressed: true });
      const live = await insertCandidatePhone({ candidateId, phone: P_WORK });
      await insertCandidateSource({ candidatePhoneId: live, provider: 'apollo', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.phonesSkippedSuppressed, 1);
      assert.equal(out.phonesInserted, 1);
      assert.deepEqual(
        (await livePhones(contactId)).map((r) => r.dedupe_key),
        [keyOf(P_WORK)],
      );
    });

    // ═══════════════════════════════════════════════════════════
    // 2. El incumbente
    // ═══════════════════════════════════════════════════════════

    it('un principal MANUAL vivo sobrevive intacto a la fusión', async () => {
      const contactId = await insertContact();
      await insertOfficialPhone({
        contactId,
        phone: P_WORK,
        phoneType: 'work',
        isPrimary: true,
        provider: 'manual',
        acquisitionMode: 'manual',
      });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      // Un `personal_mobile` gana el ranking por tipo… y aun así NO puede destronarlo.
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE, phoneType: 'personal_mobile' });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.primaryPreserved, true);
      assert.equal(out.primaryDedupeKey, keyOf(P_WORK));
      const primaries = (await livePhones(contactId)).filter((r) => r.is_primary);
      assert.equal(primaries.length, 1);
      assert.equal(primaries[0].dedupe_key, keyOf(P_WORK));
    });

    it('un principal de PROVEEDOR vivo tampoco se reprioriza', async () => {
      const contactId = await insertContact();
      await insertOfficialPhone({
        contactId,
        phone: P_WORK,
        phoneType: 'work',
        isPrimary: true,
        provider: 'apollo',
        acquisitionMode: 'search',
      });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE, phoneType: 'personal_mobile', isPrimary: true });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.primaryPreserved, true);
      assert.equal(out.primaryDedupeKey, keyOf(P_WORK));
    });

    it('el escalar heredado MANUAL se bootstrappea, toma el principal y no se altera', async () => {
      // El caso legacy: `contacts.phone` puesto y CERO filas oficiales. Es donde está hoy cada
      // contacto de Producción.
      const contactId = await insertContact({
        phone: P_INCUMBENT,
        phoneType: 'work',
        phoneSource: 'manual',
        phoneRawType: 'work',
      });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE, phoneType: 'personal_mobile' });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const out = await merge(client, {
        candidateId,
        contactId,
        incumbentBootstrap: await bootstrapFor(contactId),
      });
      assert.equal(out.incumbentBootstrap, 'promoted');
      assert.equal(out.primaryDedupeKey, keyOf(P_INCUMBENT), 'el número de siempre manda');
      assert.equal(out.scalarProjection, 'incumbent_preserved');

      const contact = await contactRow(contactId);
      assert.equal(contact.phone, P_INCUMBENT);
      assert.equal(contact.phone_source, 'manual');
      assert.equal(contact.phone_type, 'work');

      const { rows } = await q(
        `SELECT s.provider, s.acquisition_mode, s.source_event_key
           FROM public.contact_phone_sources s
           JOIN public.contact_phones p ON p.id = s.contact_phone_id
          WHERE p.contact_id = $1 AND p.dedupe_key = $2`,
        [contactId, keyOf(P_INCUMBENT)],
      );
      assert.equal(rows[0].provider, 'manual');
      assert.equal(rows[0].acquisition_mode, 'manual');
      assert.match(rows[0].source_event_key as string, /^v1:incumbent:/);
    });

    it('el escalar heredado de PROVEEDOR también se bootstrappea con su par real', async () => {
      const contactId = await insertContact({
        phone: P_INCUMBENT,
        phoneType: 'mobile',
        phoneSource: 'lusha_reveal',
        phoneRawType: 'mobile',
      });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const out = await merge(client, {
        candidateId,
        contactId,
        incumbentBootstrap: await bootstrapFor(contactId),
      });
      assert.equal(out.incumbentBootstrap, 'promoted');
      const { rows } = await q(
        `SELECT s.provider, s.acquisition_mode FROM public.contact_phone_sources s
           JOIN public.contact_phones p ON p.id = s.contact_phone_id
          WHERE p.contact_id = $1 AND p.dedupe_key = $2`,
        [contactId, keyOf(P_INCUMBENT)],
      );
      assert.equal(rows[0].provider, 'lusha');
      assert.equal(rows[0].acquisition_mode, 'reveal');
    });

    it('procedencia DESCONOCIDA: no se bootstrappea nada y el escalar sobrevive intacto', async () => {
      // HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING sigue abierto. Los teléfonos del candidato
      // entran igual como EXTRAS; lo que no ocurre es inventar de dónde salió el que ya estaba.
      for (const source of [null, 'unknown', 'provider_payload']) {
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          phoneType: 'work',
          phoneSource: source,
        });
        const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
        const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE, phoneType: 'personal_mobile' });
        await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

        const bootstrap = await bootstrapFor(contactId);
        assert.equal(bootstrap, null, `${String(source)} no debe invertir`);

        const out = await merge(client, { candidateId, contactId, incumbentBootstrap: bootstrap });
        assert.equal(out.incumbentBootstrap, 'unrepresentable');
        assert.equal(out.scalarProjection, 'incumbent_preserved');

        const contact = await contactRow(contactId);
        assert.equal(contact.phone, P_INCUMBENT, 'el número heredado NO se toca');
        assert.equal(contact.phone_source, source);
        // Y el número del candidato sí está, como extra.
        assert.equal((await livePhones(contactId)).length, 1);
      }
    });

    it('un escalar que CAMBIÓ entre la lectura y el lock no se bootstrappea', async () => {
      const contactId = await insertContact({
        phone: P_INCUMBENT,
        phoneType: 'work',
        phoneSource: 'manual',
      });
      const stale = await bootstrapFor(contactId);
      // Alguien retecleó el número después de que la server action lo leyera.
      await q(`UPDATE public.contacts SET phone = $2 WHERE id = $1`, [contactId, P_WORK]);

      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const out = await merge(client, { candidateId, contactId, incumbentBootstrap: stale });
      assert.equal(out.incumbentBootstrap, 'stale');
      assert.equal((await contactRow(contactId)).phone, P_WORK);
      assert.equal((await livePhones(contactId)).length, 0, 'no se colgó procedencia de un número ausente');
    });

    it('con colección oficial YA presente no se bootstrappea el escalar', async () => {
      const contactId = await insertContact({
        phone: P_INCUMBENT,
        phoneSource: 'manual',
        phoneType: 'work',
      });
      await insertOfficialPhone({ contactId, phone: P_WORK, isPrimary: true, provider: 'apollo' });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });

      const out = await merge(client, {
        candidateId,
        contactId,
        incumbentBootstrap: await bootstrapFor(contactId),
      });
      assert.equal(out.incumbentBootstrap, 'collection_present');
      assert.equal(out.primaryDedupeKey, keyOf(P_WORK));
    });

    it('un contacto SIN teléfono recibe el escalar proyectado del principal elegido', async () => {
      const contactId = await insertContact({ phone: null });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE, phoneType: 'personal_mobile' });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'lusha', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.scalarProjection, 'projected');
      const contact = await contactRow(contactId);
      assert.equal(contact.phone, P_MOBILE);
      assert.equal(contact.phone_source, 'lusha_reveal');
      assert.equal(contact.phone_type, 'personal_mobile');
      assert.equal(contact.mobile_phone, null, 'mobile_phone NUNCA se toca (4O-E4.1)');
      assert.equal(contact.phone_confidence, null, 'phone_confidence sigue muerta');
    });

    it('el candidato escalar-only promueve su número cuando la procedencia invierte', async () => {
      const contactId = await insertContact({ phone: null });
      const candidateId = await insertDuplicateCandidate({
        matchedContactId: contactId,
        phone: P_DIRECT,
        metadata: { phone: { type: 'direct_dial', source: 'apollo_search', raw_type: 'work_direct' } },
      });

      const out = await merge(client, {
        candidateId,
        contactId,
        scalarFallback: buildCandidateScalarFallback({
          phone: P_DIRECT,
          phoneMetadata: { type: 'direct_dial', source: 'apollo_search', raw_type: 'work_direct' },
        }),
      });
      assert.equal(out.scalarFallback, 'promoted');
      assert.equal(out.phonesInserted, 1);
      assert.equal((await contactRow(contactId)).phone_source, 'apollo_search');
    });

    // ═══════════════════════════════════════════════════════════
    // 3. Tombstones
    // ═══════════════════════════════════════════════════════════

    it('un tombstone OFICIAL no revive, no gana procedencia y no recibe el número', async () => {
      const contactId = await insertContact();
      await insertOfficialPhone({ contactId, phone: P_MOBILE, suppressed: true });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.phonesInserted, 0);
      assert.equal((await livePhones(contactId)).length, 0, 'nada vivo: el tombstone manda');

      const { rows } = await q(
        `SELECT p.suppressed_at, p.normalized_phone,
                (SELECT COUNT(*)::int FROM public.contact_phone_sources s
                  WHERE s.contact_phone_id = p.id) AS sources
           FROM public.contact_phones p
          WHERE p.contact_id = $1 AND p.dedupe_key = $2`,
        [contactId, keyOf(P_MOBILE)],
      );
      assert.ok(rows[0].suppressed_at, 'sigue siendo un tombstone');
      assert.equal(rows[0].normalized_phone, null, 'sigue sin número');
      assert.equal(rows[0].sources, 0, 'un tombstone no gana procedencia nueva');
    });

    it('un tombstone que coincide con el escalar heredado tampoco se bootstrappea', async () => {
      const contactId = await insertContact({
        phone: P_INCUMBENT,
        phoneSource: 'manual',
        phoneType: 'work',
      });
      await insertOfficialPhone({ contactId, phone: P_INCUMBENT, suppressed: true });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });

      const out = await merge(client, {
        candidateId,
        contactId,
        incumbentBootstrap: await bootstrapFor(contactId),
      });
      assert.equal(out.incumbentBootstrap, 'unrepresentable');
      assert.equal((await contactRow(contactId)).phone, P_INCUMBENT);
    });

    // ═══════════════════════════════════════════════════════════
    // 4. Estado terminal, enlace durable e idempotencia
    // ═══════════════════════════════════════════════════════════

    it('deja el candidato en `duplicate` distinguible de un descarte, y el enlace en el contacto', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      await merge(client, { candidateId, contactId });

      const candidate = await candidateRow(candidateId);
      assert.equal(candidate.status, 'duplicate', 'sigue siendo un duplicado: fusionarlo no lo cambia');
      assert.equal(candidate.matched_contacts_id, contactId);
      const review = (candidate.enrichment_metadata as Record<string, unknown>).review as Record<
        string,
        unknown
      >;
      assert.equal(review.merged_into_contact_id, contactId, 'ESTO es lo que lo distingue de un descarte');
      assert.ok(review.merged_at);

      const metadata = (await contactRow(contactId)).metadata as Record<string, unknown>;
      assert.deepEqual(metadata.merged_candidate_ids, [candidateId]);
    });

    it('el enlace de borrado es APPEND-ONLY y no pisa `source_candidate_id`', async () => {
      const originalCandidate = '77777777-7777-4777-8777-777777777777';
      const contactId = await insertContact({
        metadata: { source_candidate_id: originalCandidate, relevance: 0.7 },
      });
      const a = await insertDuplicateCandidate({ matchedContactId: contactId });
      const b = await insertDuplicateCandidate({ matchedContactId: contactId });
      await merge(client, { candidateId: a, contactId });
      await merge(client, { candidateId: b, contactId });

      const metadata = (await contactRow(contactId)).metadata as Record<string, unknown>;
      assert.deepEqual(metadata.merged_candidate_ids, [a, b]);
      assert.equal(metadata.source_candidate_id, originalCandidate, 'la creación no se reescribe');
      assert.equal(metadata.relevance, 0.7, 'el resto de la metadata sobrevive');
    });

    it('repetir el merge devuelve `already_merged` sin escribir nada', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const first = await merge(client, { candidateId, contactId });
      assert.equal(first.status, 'merged');
      const before = await livePhones(contactId);

      const second = await merge(client, { candidateId, contactId });
      assert.equal(second.status, 'already_merged');
      assert.equal(second.contactId, contactId);
      assert.equal(second.phonesInserted, 0);
      assert.deepEqual(await livePhones(contactId), before);

      const { rows } = await q(
        `SELECT COUNT(*)::int AS n FROM public.contact_phone_sources s
           JOIN public.contact_phones p ON p.id = s.contact_phone_id
          WHERE p.contact_id = $1`,
        [contactId],
      );
      assert.equal(rows[0].n, 1, 'ni una procedencia duplicada');
    });

    it('dos merges CONCURRENTES del mismo candidato producen UN solo merge lógico', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const { rows: pidRows } = await other.query(`SELECT pg_backend_pid()::int AS pid`);
      const otherPid = pidRows[0].pid as number;

      await q('BEGIN');
      const winner = merge(client, { candidateId, contactId });
      // Se inicia la segunda ANTES de confirmar la primera: se bloqueará en el lock del candidato.
      const loser = merge(other, { candidateId, contactId });
      await waitUntilBlocked(otherPid);
      const winnerOut = await winner;
      await q('COMMIT');
      const loserOut = await loser;

      assert.equal(winnerOut.status, 'merged');
      assert.equal(loserOut.status, 'already_merged');
      assert.equal((await livePhones(contactId)).length, 1);
    });

    // ═══════════════════════════════════════════════════════════
    // 5. Guardias: IDOR, estado, cuenta, archivado
    // ═══════════════════════════════════════════════════════════

    it('rechaza un contacto que NO es el registrado — IDOR, dentro del lock', async () => {
      const registered = await insertContact();
      const attacked = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: registered });

      const out = await merge(client, { candidateId, contactId: attacked });
      assert.equal(out.status, 'contact_mismatch');
      assert.equal((await livePhones(attacked)).length, 0);
      assert.equal((await candidateRow(candidateId)).status, 'duplicate');
    });

    it('rechaza un candidato que no está en `duplicate`', async () => {
      const contactId = await insertContact();
      for (const status of ['pending_review', 'approved', 'discarded']) {
        const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId, status });
        const out = await merge(client, { candidateId, contactId });
        assert.equal(out.status, 'candidate_not_mergeable', status);
      }
    });

    it('rechaza un patch que no reafirme el veredicto duplicado', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      for (const status of ['approved', 'discarded']) {
        const out = await merge(client, {
          candidateId,
          contactId,
          patch: reviewPatch({ status }),
        });
        assert.equal(out.status, 'invalid_input');
        assert.equal(out.detail, 'review_patch_status_not_duplicate');
      }
    });

    it('rechaza un contacto de OTRA cuenta y uno ARCHIVADO', async () => {
      const foreign = await insertContact({ accountId: OTHER_ACCOUNT_ID });
      const c1 = await insertDuplicateCandidate({ matchedContactId: foreign });
      assert.equal((await merge(client, { candidateId: c1, contactId: foreign })).status, 'contact_mismatch');

      const archived = await insertContact({ archived: true });
      const c2 = await insertDuplicateCandidate({ matchedContactId: archived });
      const out = await merge(client, { candidateId: c2, contactId: archived });
      assert.equal(out.status, 'contact_not_mergeable');
      assert.equal(out.detail, 'contact_archived');
    });

    // ═══════════════════════════════════════════════════════════
    // 6. Privacidad
    // ═══════════════════════════════════════════════════════════

    it('una DSAR de PERSONA confirmada ANTES bloquea el merge entero, sin escribir nada', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({
        matchedContactId: contactId,
        apolloPersonId: APOLLO_PERSON_ID,
      });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      await q(
        `INSERT INTO public.phone_reveal_cache
           (provider, provider_person_id, account_id, country_code, normalized_phone,
            original_revealed_at, expires_at, suppressed_at, suppression_reason)
         VALUES ('apollo',$1,$2,'US',NULL,$3,$3,$3,'dsar_erasure_request')`,
        [APOLLO_PERSON_ID, ACCOUNT_ID, NOW],
      );

      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.status, 'person_suppressed');
      assert.equal((await livePhones(contactId)).length, 0);
      const candidate = await candidateRow(candidateId);
      const review = (candidate.enrichment_metadata as Record<string, unknown>).review;
      assert.equal(review, undefined, 'el candidato NO se terminaliza como fusionado');
      const metadata = (await contactRow(contactId)).metadata as Record<string, unknown>;
      assert.equal(metadata.merged_candidate_ids, undefined);
    });

    it('un merge que confirma primero deja el contacto ALCANZABLE por el borrado posterior', async () => {
      // La propiedad que impide que H3-B abra una ruta alrededor de H2: la 115 tiene que poder
      // tumbar lo que la 117 acaba de escribir, y el enlace de la metadata es lo que hace que el
      // plan de borrado llegue siquiera a llamarla.
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      await merge(client, { candidateId, contactId });
      assert.equal((await livePhones(contactId)).length, 1);

      const { rows } = await q(
        `SELECT public.suppress_official_contact_phone_sources(
                  $1, 'single_provider', 'apollo', NULL,
                  'data_subject_request', $2, $3) AS envelope`,
        [contactId, ACTOR_ID, NOW],
      );
      const envelope = rows[0].envelope as Record<string, unknown>;
      assert.equal(envelope.status, 'suppressed');
      assert.equal(
        (await livePhones(contactId)).length,
        0,
        'lo que la 117 escribió, la 115 lo tumba',
      );
    });

    it('el merge y el borrado oficial SERIALIZAN en vez de interbloquearse', async () => {
      const contactId = await insertContact();
      await insertOfficialPhone({ contactId, phone: P_WORK, provider: 'apollo', isPrimary: true });
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      const { rows: pidRows } = await other.query(`SELECT pg_backend_pid()::int AS pid`);
      const otherPid = pidRows[0].pid as number;

      await q('BEGIN');
      const merging = merge(client, { candidateId, contactId });
      const erasing = other.query(
        `SELECT public.suppress_official_contact_phone_sources(
                  $1,'single_provider','apollo',NULL,'data_subject_request',$2,$3) AS envelope`,
        [contactId, ACTOR_ID, NOW],
      );
      await waitUntilBlocked(otherPid);
      const mergedOut = await merging;
      await q('COMMIT');
      const erased = await erasing;

      assert.equal(mergedOut.status, 'merged');
      assert.equal((erased.rows[0].envelope as Record<string, unknown>).status, 'suppressed');
      const survivors = await livePhones(contactId);
      assert.equal(survivors.length, 0, 'el borrado alcanza también a lo recién fusionado');
      // Y nada resucitó: las dos filas siguen siendo tombstones.
      const { rows } = await q(
        `SELECT COUNT(*)::int AS n FROM public.contact_phones
          WHERE contact_id = $1 AND suppressed_at IS NULL`,
        [contactId],
      );
      assert.equal(rows[0].n, 0);
    });

    // ═══════════════════════════════════════════════════════════
    // 7. Atomicidad y privilegios
    // ═══════════════════════════════════════════════════════════

    it('un fallo dentro de la transacción no deja NADA escrito', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      await q('BEGIN');
      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.status, 'merged');
      await q('ROLLBACK');

      assert.equal((await livePhones(contactId)).length, 0);
      const candidate = await candidateRow(candidateId);
      assert.equal(
        ((candidate.enrichment_metadata as Record<string, unknown>).review as
          | Record<string, unknown>
          | undefined)?.merged_into_contact_id,
        undefined,
      );
      const metadata = (await contactRow(contactId)).metadata as Record<string, unknown>;
      assert.equal(metadata.merged_candidate_ids, undefined);
    });

    it('`authenticated` NO puede ejecutar la función', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      await q('BEGIN');
      await q(`SET LOCAL ROLE authenticated`);
      let code: string | undefined;
      try {
        await merge(client, { candidateId, contactId });
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      await q('ROLLBACK');
      assert.equal(code, INSUFFICIENT_PRIVILEGE, 'aprobar/fusionar no es alcanzable desde el navegador');
    });

    it('`service_role` SÍ puede, y bajo el techo de la 114 (sin DELETE)', async () => {
      const contactId = await insertContact();
      const candidateId = await insertDuplicateCandidate({ matchedContactId: contactId });
      const id = await insertCandidatePhone({ candidateId, phone: P_MOBILE });
      await insertCandidateSource({ candidatePhoneId: id, provider: 'apollo', acquisitionMode: 'reveal' });

      await q('BEGIN');
      await q(`SET LOCAL ROLE service_role`);
      const out = await merge(client, { candidateId, contactId });
      assert.equal(out.status, 'merged');

      let deleteCode: string | undefined;
      try {
        await q(`DELETE FROM public.contact_phones WHERE contact_id = $1`, [contactId]);
      } catch (err) {
        deleteCode = (err as { code?: string }).code;
      }
      await q('ROLLBACK');
      assert.equal(deleteCode, INSUFFICIENT_PRIVILEGE, 'nadie puede borrar un tombstone');
    });
  },
);
