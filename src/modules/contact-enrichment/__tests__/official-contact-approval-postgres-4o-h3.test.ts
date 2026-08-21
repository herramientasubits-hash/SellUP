/**
 * Agente 2A — la aprobación ATÓMICA contra PostgreSQL 17 real
 * (AGENT2A-PHONE-REVEAL-4O-H3).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana `…-static-4o-h3` fija el CONTRATO: qué dice el SQL. Lo que no puede fijar es
 * la GARANTÍA. «Un fallo después de crear el contacto no deja NADA escrito», «tres números
 * revelados llegan los tres al contacto», «Apollo y Lusha sobre el mismo número son una fila
 * canónica y dos procedencias», «dos aprobaciones concurrentes no crean dos contactos», «una
 * DSAR que confirma antes bloquea la aprobación entera» y «un tombstone no revive» no son
 * reglas del código: son transacciones, locks, índices únicos parciales, CHECKs y privilegios
 * de PostgreSQL. Sólo PostgreSQL puede demostrarlas.
 *
 * Aquí la cadena de migraciones se APLICA de verdad (099 → 107 → 109 → 112 → 113 → 114 → 115 →
 * 116), las escrituras ocurren contra un servidor real, los roles son los tres de Supabase con
 * sus default privileges, y lo que se comprueba después es el contenido de las tablas y el
 * SQLSTATE que devolvió el servidor.
 *
 * ⚠️ Los parámetros de la RPC salen del MISMO builder puro que usa la server action, en el mismo
 * orden. El SQL de la llamada se DERIVA del builder y no se escribe a mano: si el builder
 * dejara de mandar un parámetro, estas pruebas lo reflejarían en vez de taparlo — la lección de
 * 4O-E4-R1, donde los tests demostraban una propiedad de un escritor FICTICIO.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni ninguna
 * base remota; no gasta un crédito; no ejecuta ninguna DSAR real ni ninguna aprobación real.
 * Todos los números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito. Si el módulo no
 * está resuelto, el archivo se SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:official-contact-phone-approval:postgres
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

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

const MIGRATIONS = [
  '099_apollo_phone_reveal_cache.sql',
  '107_phone_reveal_cache_and_suppression_grants.sql',
  '109_contact_enrichment_candidate_phones.sql',
  '112_suppress_candidate_phone_collection.sql',
  '114_official_contact_phones.sql',
  '115_official_contact_phone_privacy.sql',
];
/** LA MIGRACIÓN BAJO PRUEBA. */
const MIGRATION_116 = '116_approve_candidate_with_official_phones.sql';

const INSUFFICIENT_PRIVILEGE = '42501';

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
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';
const RUN_ID = '40000000-0000-4000-8000-000000000001';
const APOLLO_PERSON_ID = '5f1a2b3c4d5e6f7a8b9c0d1e';

const NOW = '2026-08-12T12:00:00.000Z';

/** Números sintéticos 555, en forma E.164 verificable. */
const P_MOBILE = '+15550000001';
const P_DIRECT = '+15550000002';
const P_WORK = '+15550000003';

const keyOf = (phone: string) =>
  normalizeCandidatePhone({ displayPhone: phone, sanitizedPhone: phone, countryCode: null })
    .dedupeKey;

describe(
  '4O-H3 — aprobación atómica sobre el modelo oficial, en PostgreSQL real',
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
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oh3-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401 lo usan 4O-F y H1, 54402 la suite de H2.
        port: 54403,
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

      // ── Contabilidad y staging ───────────────────────────────────
      // `contact_enrichment_candidates` lleva las columnas que la 113 y la 116 leen bajo el
      // lock, más el estado de revisión que la 116 escribe.
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
          source_contact_id       text);`);

      for (const file of MIGRATIONS) await q(readMigration(file));
      // La 113 instala los dos helpers de supresión por persona que la 116 reutiliza. Se aplica
      // después de la 112 porque reemplaza los cuerpos de 110/111, que aquí no existen: se
      // extraen SOLO las dos funciones que la 116 necesita, que es exactamente lo que la 116
      // depende de que exista.
      const m113 = readMigration('113_phone_reveal_person_suppression_recheck.sql');
      const helpers = m113.slice(
        m113.indexOf('CREATE OR REPLACE FUNCTION public.phone_reveal_normalized_apollo_person_id'),
        m113.indexOf('GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;') +
          'GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;'.length,
      );
      assert.ok(helpers.length > 0, 'no se pudieron extraer los helpers de la 113');
      await q(helpers);

      await q(readMigration(MIGRATION_116));

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
      if (other) await other.end().catch(() => {});
      if (client) await client.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Helpers ────────────────────────────────────────────────────

    let seq = 0;

    /** Inserta un candidato `pending_review` y devuelve su id. */
    async function insertCandidate(args: {
      phone?: string | null;
      metadata?: Record<string, unknown>;
      apolloPersonId?: string | null;
      status?: string;
    } = {}): Promise<string> {
      seq += 1;
      const { rows } = await q(
        `INSERT INTO public.contact_enrichment_candidates
           (enrichment_run_id, status, full_name, phone, enrichment_metadata,
            apollo_person_id, source)
         VALUES ($1,$2,$3,$4,$5,$6,'apollo') RETURNING id`,
        [
          RUN_ID,
          args.status ?? 'pending_review',
          `Candidato Sintetico ${seq}`,
          args.phone ?? null,
          JSON.stringify(args.metadata ?? {}),
          args.apolloPersonId ?? null,
        ],
      );
      return rows[0].id as string;
    }

    /** Inserta un número en la colección del CANDIDATO y devuelve su id. */
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

    /** Inserta una procedencia en la colección del CANDIDATO. */
    async function insertCandidateSource(args: {
      candidatePhoneId: string;
      provider: string;
      acquisitionMode: string;
      phase?: string | null;
      rawType?: string | null;
      observedAt?: string;
    }): Promise<void> {
      // LA clave del generador real, no una escrita a mano.
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

    function contactPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      seq += 1;
      return {
        account_id: ACCOUNT_ID,
        first_name: 'Contacto',
        last_name: `Sintetico ${seq}`,
        full_name: `Contacto Sintetico ${seq}`,
        email: `sintetico${seq}@example.invalid`,
        phone: null,
        linkedin_url: null,
        job_title: 'QA',
        department: null,
        seniority: null,
        source: 'apollo',
        contact_status: 'active',
        phone_type: null,
        phone_source: null,
        phone_raw_type: null,
        phone_revealed_at: null,
        phone_processing_basis: null,
        metadata: { source: 'contact_enrichment_candidate' },
        created_by: ACTOR_ID,
        updated_by: ACTOR_ID,
        ...overrides,
      };
    }

    function reviewPatch(): Record<string, unknown> {
      return {
        status: 'approved',
        duplicate_status: 'no_match',
        review_notes: null,
        reviewed_by: ACTOR_ID,
        reviewed_at: NOW,
        enrichment_metadata: { review: { status: 'approved', reviewed_by: ACTOR_ID } },
      };
    }

    /**
     * Invoca la RPC EXACTAMENTE como lo hace la persistencia: los parámetros salen del MISMO
     * builder puro que usa la server action, en el mismo orden posicional.
     */
    async function approve(
      conn: PgLikeClient,
      args: {
        candidateId: string;
        payload?: Record<string, unknown>;
        patch?: Record<string, unknown>;
        scalarFallback?: ReturnType<typeof buildCandidateScalarFallback>;
      },
    ) {
      const params = buildApproveCandidateWithPhonesParams({
        candidateId: args.candidateId,
        accountId: ACCOUNT_ID,
        contactPayload: args.payload ?? contactPayload(),
        reviewPatch: args.patch ?? reviewPatch(),
        scalarFallback: args.scalarFallback ?? null,
        actorId: ACTOR_ID,
        nowIso: NOW,
      });
      const names = Object.keys(params);
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await conn.query(
        `SELECT public.${APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN}(${placeholders}) AS envelope`,
        names.map((n) => {
          const v = (params as Record<string, unknown>)[n];
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }),
      );
      return parseApproveCandidateWithPhonesEnvelope(rows[0].envelope);
    }

    /**
     * Espera a que `pid` quede bloqueado esperando un lock.
     *
     * Sin esto la carrera es un sorteo: si `COMMIT` gana la salida del `await`, la conexión B
     * ni siquiera ha emitido su consulta y lee el estado YA confirmado, de modo que la prueba
     * pasa sin haber interleaved nada. Un test de concurrencia que puede pasar sin concurrencia
     * no prueba la serialización — prueba el planificador de la máquina que lo corrió.
     */
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
          `SELECT dedupe_key, normalized_phone, display_phone, phone_type, is_primary,
                  suppressed_at
             FROM public.contact_phones
            WHERE contact_id = $1 AND suppressed_at IS NULL
            ORDER BY dedupe_key`,
          [contactId],
        )
      ).rows;

    const sourcesOf = async (contactId: string) =>
      (
        await q(
          `SELECT s.provider, s.acquisition_mode, s.source_event_key, s.candidate_phone_id,
                  p.dedupe_key
             FROM public.contact_phone_sources s
             JOIN public.contact_phones p ON p.id = s.contact_phone_id
            WHERE p.contact_id = $1
            ORDER BY p.dedupe_key, s.provider`,
          [contactId],
        )
      ).rows;

    // ═══════════════════════════════════════════════════════════════
    // A. Contacto nuevo — la propagación completa
    // ═══════════════════════════════════════════════════════════════

    describe('A. contacto nuevo', () => {
      it('A1: un teléfono, una procedencia ⇒ 1 canónico, 1 fuente, 1 principal, escalar sincronizado', async () => {
        const candidateId = await insertCandidate();
        const phoneId = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
          isPrimary: true,
        });
        await insertCandidateSource({
          candidatePhoneId: phoneId,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          rawType: 'mobile',
        });

        const env = await approve(client, { candidateId });

        assert.equal(env.status, 'approved');
        assert.equal(env.contactCreated, true);
        assert.equal(env.phonesSeen, 1);
        assert.equal(env.phonesInserted, 1);
        assert.equal(env.sourcesInserted, 1);
        assert.equal(env.scalarSynced, true, 'el sobre debe reportar la proyección que hizo');
        assert.equal(env.candidateTerminal, true);
        assert.ok(env.contactId);

        const phones = await livePhones(env.contactId!);
        assert.equal(phones.length, 1);
        assert.equal(phones[0].normalized_phone, P_MOBILE);
        assert.equal(phones[0].is_primary, true);
        assert.equal(phones[0].dedupe_key, keyOf(P_MOBILE));

        const sources = await sourcesOf(env.contactId!);
        assert.equal(sources.length, 1);
        assert.equal(sources[0].provider, 'apollo');
        assert.equal(sources[0].acquisition_mode, 'reveal');
        // El puntero de auditoría hacia staging queda escrito.
        assert.equal(sources[0].candidate_phone_id, phoneId);
        // La clave oficial NO es la de staging verbatim: la namespacea.
        assert.ok((sources[0].source_event_key as string).startsWith('v1:promoted:'));

        const { rows: contact } = await q(
          `SELECT phone, phone_type, phone_source, phone_raw_type, mobile_phone, phone_confidence
             FROM public.contacts WHERE id = $1`,
          [env.contactId],
        );
        assert.equal(contact[0].phone, P_MOBILE);
        assert.equal(contact[0].phone_type, 'mobile');
        assert.equal(contact[0].phone_source, 'apollo_reveal');
        assert.equal(contact[0].phone_raw_type, 'mobile');
        // mobile_phone NO se toca (4O-E4.1) y phone_confidence sigue muerta.
        assert.equal(contact[0].mobile_phone, null);
        assert.equal(contact[0].phone_confidence, null);

        const { rows: cand } = await q(
          `SELECT status, matched_contacts_id, enrichment_metadata
             FROM public.contact_enrichment_candidates WHERE id = $1`,
          [candidateId],
        );
        assert.equal(cand[0].status, 'approved');
        assert.equal(cand[0].matched_contacts_id, env.contactId);
        // `review.created_contact_id` es load-bearing: la ruta DSAR descubre contactos por ahí.
        assert.equal(
          (cand[0].enrichment_metadata as { review: { created_contact_id: string } }).review
            .created_contact_id,
          env.contactId,
        );
      });

      it('A2: TRES números y CUATRO procedencias sobreviven a la aprobación', async () => {
        const candidateId = await insertCandidate();
        const p1 = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'personal_mobile',
          isPrimary: true,
        });
        const p2 = await insertCandidatePhone({
          candidateId,
          phone: P_DIRECT,
          phoneType: 'direct_dial',
        });
        const p3 = await insertCandidatePhone({ candidateId, phone: P_WORK, phoneType: 'work' });
        await insertCandidateSource({
          candidatePhoneId: p1,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertCandidateSource({
          candidatePhoneId: p2,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          phase: 'r2',
        });
        await insertCandidateSource({
          candidatePhoneId: p3,
          provider: 'lusha',
          acquisitionMode: 'reveal',
        });
        await insertCandidateSource({
          candidatePhoneId: p3,
          provider: 'apollo',
          acquisitionMode: 'search',
        });

        const env = await approve(client, { candidateId });

        assert.equal(env.status, 'approved');
        assert.equal(env.phonesInserted, 3, 'los TRES números llegan al contacto');
        assert.equal(env.sourcesInserted, 4, 'las CUATRO procedencias llegan al contacto');

        const phones = await livePhones(env.contactId!);
        assert.equal(phones.length, 3);
        assert.deepEqual(
          phones.map((r) => r.normalized_phone).sort(),
          [P_MOBILE, P_DIRECT, P_WORK].sort(),
        );
        assert.equal(phones.filter((r) => r.is_primary).length, 1, 'exactamente UN principal');
      });

      it('A3: Apollo + Lusha sobre el MISMO número ⇒ 1 canónico y 2 procedencias', async () => {
        const candidateId = await insertCandidate();
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
          isPrimary: true,
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'lusha',
          acquisitionMode: 'reveal',
        });

        const env = await approve(client, { candidateId });

        assert.equal(env.phonesInserted, 1, 'UNA fila canónica, no dos');
        assert.equal(env.sourcesInserted, 2, 'DOS procedencias');
        const phones = await livePhones(env.contactId!);
        assert.equal(phones.length, 1);
        const sources = await sourcesOf(env.contactId!);
        assert.equal(sources.length, 2);
        assert.deepEqual(sources.map((r) => r.provider).sort(), ['apollo', 'lusha']);

        // La proyección escalar elige la procedencia MÁS ESPECÍFICA viva: apollo:reveal manda
        // sobre lusha:reveal en el ranking de la 112/115.
        const { rows } = await q(`SELECT phone_source FROM public.contacts WHERE id = $1`, [
          env.contactId,
        ]);
        assert.equal(rows[0].phone_source, 'apollo_reveal');
      });

      it('A4: un teléfono SUPRIMIDO del candidato NO se promueve, y el vivo sí', async () => {
        const candidateId = await insertCandidate();
        const live = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: live,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertCandidatePhone({ candidateId, phone: P_DIRECT, suppressed: true });

        const env = await approve(client, { candidateId });

        assert.equal(env.phonesSeen, 2);
        assert.equal(env.phonesInserted, 1);
        assert.equal(env.phonesSkippedSuppressed, 1);

        const phones = await livePhones(env.contactId!);
        assert.equal(phones.length, 1);
        assert.equal(phones[0].dedupe_key, keyOf(P_MOBILE));
        // El tombstone del candidato NO cruzó: no existe ninguna fila oficial con esa clave.
        const { rows } = await q(
          `SELECT COUNT(*)::int AS n FROM public.contact_phones
            WHERE contact_id = $1 AND dedupe_key = $2`,
          [env.contactId, keyOf(P_DIRECT)],
        );
        assert.equal(rows[0].n, 0);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // B. Principal
    // ═══════════════════════════════════════════════════════════════

    describe('B. elección de principal', () => {
      it('B1: el principal del candidato se preserva aunque otro número rankee mejor', async () => {
        const candidateId = await insertCandidate();
        // `work` marcado principal en staging, `personal_mobile` no.
        const chosen = await insertCandidatePhone({
          candidateId,
          phone: P_WORK,
          phoneType: 'work',
          isPrimary: true,
        });
        const better = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'personal_mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: chosen,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertCandidateSource({
          candidatePhoneId: better,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          phase: 'r2',
        });

        const env = await approve(client, { candidateId });

        assert.equal(
          env.primaryDedupeKey,
          keyOf(P_WORK),
          'la elección hecha en staging no se re-prioriza al aprobar',
        );
      });

      it('B2: sin principal en staging, decide el ranking compartido (personal_mobile > work)', async () => {
        const candidateId = await insertCandidate();
        const w = await insertCandidatePhone({ candidateId, phone: P_WORK, phoneType: 'work' });
        const m = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'personal_mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: w,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await insertCandidateSource({
          candidatePhoneId: m,
          provider: 'apollo',
          acquisitionMode: 'reveal',
          phase: 'r2',
        });

        const env = await approve(client, { candidateId });
        assert.equal(env.primaryDedupeKey, keyOf(P_MOBILE));
      });

      it('B3: procedencia MANUAL gana al ladder de tipos (tier previo, 4O-H0)', async () => {
        const candidateId = await insertCandidate();
        const manual = await insertCandidatePhone({
          candidateId,
          phone: P_WORK,
          phoneType: 'work',
        });
        const provider = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'personal_mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: manual,
          provider: 'manual',
          acquisitionMode: 'manual',
        });
        await insertCandidateSource({
          candidatePhoneId: provider,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const env = await approve(client, { candidateId });
        assert.equal(
          env.primaryDedupeKey,
          keyOf(P_WORK),
          'un `work` manual manda sobre un `personal_mobile` de proveedor',
        );
        const { rows } = await q(`SELECT phone_source FROM public.contacts WHERE id = $1`, [
          env.contactId,
        ]);
        assert.equal(rows[0].phone_source, 'manual');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // C. Escalar-only
    // ═══════════════════════════════════════════════════════════════

    describe('C. candidato escalar-only', () => {
      it('C1: `apollo_search` invierte fielmente ⇒ se promueve con (apollo, search)', async () => {
        const candidateId = await insertCandidate({
          phone: P_MOBILE,
          metadata: { phone: { type: 'mobile', source: 'apollo_search', raw_type: 'mobile' } },
        });
        const fallback = buildCandidateScalarFallback({
          phone: P_MOBILE,
          phoneMetadata: { type: 'mobile', source: 'apollo_search', raw_type: 'mobile' },
        });
        assert.ok(fallback, 'apollo_search debe invertir');

        const env = await approve(client, {
          candidateId,
          payload: contactPayload({ phone: P_MOBILE, phone_source: 'apollo_search' }),
          scalarFallback: fallback,
        });

        assert.equal(env.scalarFallback, 'promoted');
        assert.equal(env.phonesInserted, 1);
        const sources = await sourcesOf(env.contactId!);
        assert.equal(sources.length, 1);
        assert.equal(sources[0].provider, 'apollo');
        assert.equal(sources[0].acquisition_mode, 'search');
        assert.equal(sources[0].candidate_phone_id, null, 'no hay fila de staging que apuntar');
      });

      it('C2: `provider_payload` NO invierte ⇒ nada se promueve y el escalar queda intacto', async () => {
        const fallback = buildCandidateScalarFallback({
          phone: P_DIRECT,
          phoneMetadata: { type: 'mobile', source: 'provider_payload', raw_type: 'x' },
        });
        assert.equal(fallback, null, 'provider_payload no nombra proveedor: no debe invertir');

        const candidateId = await insertCandidate({
          phone: P_DIRECT,
          metadata: { phone: { type: 'mobile', source: 'provider_payload' } },
        });
        const env = await approve(client, {
          candidateId,
          payload: contactPayload({ phone: P_DIRECT, phone_source: 'provider_payload' }),
          scalarFallback: fallback,
        });

        assert.equal(env.scalarFallback, 'unrepresentable');
        assert.equal(env.phonesInserted, 0);
        assert.equal(env.scalarSynced, false);
        assert.equal((await livePhones(env.contactId!)).length, 0);

        // El contacto se crea igual y conserva EXACTAMENTE el escalar de hoy.
        const { rows } = await q(
          `SELECT phone, phone_source FROM public.contacts WHERE id = $1`,
          [env.contactId],
        );
        assert.equal(rows[0].phone, P_DIRECT);
        assert.equal(rows[0].phone_source, 'provider_payload');
      });

      it('C3: `unknown` y procedencia ausente tampoco inventan una fuente', () => {
        assert.equal(
          buildCandidateScalarFallback({
            phone: P_WORK,
            phoneMetadata: { type: 'work', source: 'unknown' },
          }),
          null,
        );
        assert.equal(
          buildCandidateScalarFallback({ phone: P_WORK, phoneMetadata: null }),
          null,
        );
        assert.equal(
          buildCandidateScalarFallback({ phone: null, phoneMetadata: { source: 'manual' } }),
          null,
        );
      });

      it('C4: con colección viva el escalar NO se promueve por separado', async () => {
        const candidateId = await insertCandidate({
          phone: P_WORK,
          metadata: { phone: { type: 'work', source: 'apollo_search' } },
        });
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const env = await approve(client, {
          candidateId,
          scalarFallback: buildCandidateScalarFallback({
            phone: P_WORK,
            phoneMetadata: { type: 'work', source: 'apollo_search' },
          }),
        });

        assert.equal(env.scalarFallback, 'absent');
        assert.equal(env.phonesInserted, 1);
        assert.equal((await livePhones(env.contactId!)).length, 1);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // D. Atomicidad
    // ═══════════════════════════════════════════════════════════════

    describe('D. atomicidad', () => {
      it('D1: un fallo DESPUÉS de crear el contacto no deja NADA escrito', async () => {
        const candidateId = await insertCandidate();
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const { rows: before } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);

        // El fallo se inyecta con un CHECK del propio esquema: un `seniority` fuera del enum
        // hace que el INSERT de `contacts` pase pero el resto de la transacción no llegue.
        // Se ejecuta dentro de una transacción explícita para observar el rollback completo.
        await q('BEGIN');
        let failed = false;
        try {
          // `full_name` es NOT NULL: el INSERT del contacto revienta y arrastra todo.
          await approve(client, {
            candidateId,
            payload: contactPayload({ full_name: null }),
          });
        } catch {
          failed = true;
        }
        await q('ROLLBACK');
        assert.equal(failed, true, 'la transacción debe fallar');

        const { rows: after } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);
        assert.equal(after[0].n, before[0].n, 'ningún contacto sobrevive');

        const { rows: cand } = await q(
          `SELECT status, matched_contacts_id FROM public.contact_enrichment_candidates
            WHERE id = $1`,
          [candidateId],
        );
        assert.equal(cand[0].status, 'pending_review', 'el candidato NO quedó terminalizado');
        assert.equal(cand[0].matched_contacts_id, null);
      });

      it('D2: un patch que no dice `approved` se rechaza ANTES de escribir', async () => {
        const candidateId = await insertCandidate();
        const { rows: before } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);
        const env = await approve(client, {
          candidateId,
          patch: { ...reviewPatch(), status: 'discarded' },
        });
        assert.equal(env.status, 'invalid_input');
        assert.equal(env.detail, 'review_patch_status_not_approved');
        const { rows: after } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);
        assert.equal(after[0].n, before[0].n);
      });

      it('D3: un payload cuya cuenta no coincide con el parámetro se rechaza', async () => {
        const candidateId = await insertCandidate();
        const env = await approve(client, {
          candidateId,
          payload: contactPayload({ account_id: '10000000-0000-4000-8000-0000000000ff' }),
        });
        assert.equal(env.status, 'invalid_input');
        assert.equal(env.detail, 'account_id_mismatch');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // E. Idempotencia y concurrencia
    // ═══════════════════════════════════════════════════════════════

    describe('E. idempotencia y concurrencia', () => {
      it('E1: aprobar dos veces NO crea un segundo contacto', async () => {
        const candidateId = await insertCandidate();
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const first = await approve(client, { candidateId });
        assert.equal(first.status, 'approved');

        const second = await approve(client, { candidateId });
        assert.equal(second.status, 'already_approved');
        assert.equal(second.contactId, first.contactId);
        assert.equal(second.contactCreated, false);
        assert.equal(second.phonesInserted, 0);
        assert.equal(second.sourcesInserted, 0);

        const { rows } = await q(
          `SELECT COUNT(*)::int AS n FROM public.contacts
            WHERE metadata->>'source' = 'contact_enrichment_candidate' AND id = $1`,
          [first.contactId],
        );
        assert.equal(rows[0].n, 1);
        assert.equal((await livePhones(first.contactId!)).length, 1);
        assert.equal((await sourcesOf(first.contactId!)).length, 1);
      });

      it('E2: dos aprobaciones CONCURRENTES del mismo candidato ⇒ un solo contacto', async () => {
        const candidateId = await insertCandidate();
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const { rows: before } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);

        // La conexión A toma el lock del candidato y NO confirma; B queda esperando en él.
        await client.query('BEGIN');
        const a = await approve(client, { candidateId });
        assert.equal(a.status, 'approved');

        const { rows: pidRow } = await other.query('SELECT pg_backend_pid() AS pid');
        const bPromise = approve(other, { candidateId });
        // B DEBE estar bloqueada antes de que A confirme, o la carrera no ocurre.
        await waitUntilBlocked(pidRow[0].pid as number);

        // A confirma: B despierta y lee un candidato que ya no está `pending_review`.
        await client.query('COMMIT');
        const b = await bPromise;

        assert.equal(b.status, 'already_approved');
        assert.equal(b.contactId, a.contactId);
        assert.equal(b.contactCreated, false);

        const { rows } = await q(
          `SELECT COUNT(*)::int AS n FROM public.contact_phones WHERE contact_id = $1`,
          [a.contactId],
        );
        assert.equal(rows[0].n, 1, 'sin números duplicados');
        assert.equal((await sourcesOf(a.contactId!)).length, 1, 'sin procedencias duplicadas');

        const { rows: after } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);
        assert.equal(
          (after[0].n as number) - (before[0].n as number),
          1,
          'la carrera crea UN contacto, no dos: el lock del candidato serializa y la guarda '
            + '`status = pending_review` del paso 10 aborta a la perdedora si el lock faltara',
        );
      });

      it('E3: un candidato ya `discarded` no es aprobable', async () => {
        const candidateId = await insertCandidate({ status: 'discarded' });
        const env = await approve(client, { candidateId });
        assert.equal(env.status, 'candidate_not_approvable');
        assert.equal(env.contactId, null);
      });

      it('E4: un candidato inexistente no crea nada', async () => {
        const env = await approve(client, {
          candidateId: '50000000-0000-4000-8000-0000000000ff',
        });
        assert.equal(env.status, 'candidate_not_found');
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // F. Privacidad
    // ═══════════════════════════════════════════════════════════════

    describe('F. privacidad', () => {
      /** Escribe el tombstone durable de persona que la 113 y la 116 leen. */
      async function suppressPerson(conn: PgLikeClient, personId: string) {
        // El país es NOT NULL en la 099 pero NO forma parte de la clave de supresión: un
        // borrado bloquea a esa persona en esa cuenta aunque el candidato cambie de país.
        await conn.query(
          `INSERT INTO public.phone_reveal_cache
             (provider, provider_person_id, account_id, country_code,
              normalized_phone, original_revealed_at, expires_at,
              suppressed_at, suppression_reason, suppressed_by)
           VALUES ('apollo', $1, $2, 'CO', NULL, $3, $3, $3, 'dsar_erasure_request', $4)`,
          [personId, ACCOUNT_ID, NOW, ACTOR_ID],
        );
      }

      it('F1: una supresión de PERSONA bloquea la aprobación entera — 0 contactos, 0 números', async () => {
        const personId = APOLLO_PERSON_ID;
        const candidateId = await insertCandidate({ apolloPersonId: personId });
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        await suppressPerson(client, personId);

        const { rows: before } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);
        const env = await approve(client, { candidateId });

        assert.equal(env.status, 'person_suppressed');
        assert.equal(env.contactId, null);
        const { rows: after } = await q(`SELECT COUNT(*)::int AS n FROM public.contacts`);
        assert.equal(after[0].n, before[0].n, 'ni siquiera se creó el contacto');

        const { rows: cand } = await q(
          `SELECT status FROM public.contact_enrichment_candidates WHERE id = $1`,
          [candidateId],
        );
        assert.equal(cand[0].status, 'pending_review', 'no se terminaliza');
      });

      it('F2: DSAR que confirma ANTES de que la aprobación tome el lock ⇒ nada resucita', async () => {
        const personId = '5f1a2b3c4d5e6f7a8b9c0d2f';
        const candidateId = await insertCandidate({ apolloPersonId: personId });
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_DIRECT,
          phoneType: 'direct_dial',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        // La conexión B (el operador de privacidad) escribe y CONFIRMA el tombstone primero.
        await other.query('BEGIN');
        await suppressPerson(other, personId);
        await other.query('COMMIT');

        // La aprobación arranca después: lee el tombstone DENTRO de su propia transacción.
        const env = await approve(client, { candidateId });
        assert.equal(env.status, 'person_suppressed');

        // La afirmación se acota a ESTE candidato: otros casos de la suite promueven el mismo
        // número sintético para personas distintas, y contar filas por `dedupe_key` en toda la
        // base mediría eso en vez de la resurrección.
        const { rows: cand } = await q(
          `SELECT status, matched_contacts_id
             FROM public.contact_enrichment_candidates WHERE id = $1`,
          [candidateId],
        );
        assert.equal(cand[0].status, 'pending_review');
        assert.equal(cand[0].matched_contacts_id, null, 'no se creó contacto para esta persona');

        const { rows } = await q(
          `SELECT COUNT(*)::int AS n
             FROM public.contact_phone_sources s
            WHERE s.candidate_phone_id = $1`,
          [p],
        );
        assert.equal(rows[0].n, 0, 'la observación borrada no se promovió a ningún contacto');
      });

      it('F3: la aprobación gana la carrera ⇒ la H2 alcanza después lo que escribió', async () => {
        const personId = '5f1a2b3c4d5e6f7a8b9c0d3a';
        const candidateId = await insertCandidate({ apolloPersonId: personId });
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });

        const env = await approve(client, { candidateId });
        assert.equal(env.status, 'approved');
        assert.equal((await livePhones(env.contactId!)).length, 1);

        // La H2 corre DESPUÉS, sobre el contacto que la H3 acaba de crear. Éste es el orden que
        // la ruta DSAR real ejecuta, y es lo que hace que ninguna de las dos ventanas quede viva.
        const { rows } = await q(
          `SELECT public.suppress_official_contact_phone_sources(
                    $1,'all_suppressible_providers',NULL,NULL,'data_subject_request',$2,$3
                  ) AS envelope`,
          [env.contactId, ACTOR_ID, NOW],
        );
        const h2 = rows[0].envelope as Record<string, unknown>;
        assert.equal(h2.status, 'suppressed');
        assert.equal(h2.phones_tombstoned, 1);

        assert.equal((await livePhones(env.contactId!)).length, 0, 'el número queda tombstone');
        const { rows: contact } = await q(
          `SELECT phone, phone_source FROM public.contacts WHERE id = $1`,
          [env.contactId],
        );
        assert.equal(contact[0].phone, null, 'el escalar deja de afirmar un número borrado');
      });

      it('F4: el sobre NUNCA contiene un número, un nombre ni un email', async () => {
        const candidateId = await insertCandidate();
        const p = await insertCandidatePhone({
          candidateId,
          phone: P_MOBILE,
          phoneType: 'mobile',
        });
        await insertCandidateSource({
          candidatePhoneId: p,
          provider: 'apollo',
          acquisitionMode: 'reveal',
        });
        const payload = contactPayload();
        const env = await approve(client, { candidateId, payload });

        const serialized = JSON.stringify(env);
        assert.equal(serialized.includes(P_MOBILE), false);
        assert.equal(serialized.includes('5550000001'), false);
        assert.equal(serialized.includes(payload.full_name as string), false);
        assert.equal(serialized.includes(payload.email as string), false);
        // La única clave que sale es un SHA-256 por diseño de la 114.
        assert.match(env.primaryDedupeKey ?? '', /^(e164|digits|opaque):[0-9a-f]{64}$/);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // G. Privilegios
    // ═══════════════════════════════════════════════════════════════

    describe('G. privilegios', () => {
      it('G1: `authenticated` y `anon` NO pueden ejecutar la función', async () => {
        for (const role of ['authenticated', 'anon']) {
          await q(`SET LOCAL ROLE ${role}`).catch(() => {});
          await q('BEGIN');
          await q(`SET LOCAL ROLE ${role}`);
          let code: string | undefined;
          try {
            await q(
              `SELECT public.${APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN}(
                 NULL::uuid, NULL::uuid, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::uuid, NULL::timestamptz)`,
            );
          } catch (err) {
            code = (err as { code?: string }).code;
          }
          await q('ROLLBACK');
          assert.equal(
            code,
            INSUFFICIENT_PRIVILEGE,
            `${role} no debe poder invocar la aprobación`,
          );
        }
      });

      it('G2: la función es SECURITY INVOKER y tiene el search_path fijado', async () => {
        const { rows } = await q(
          `SELECT p.prosecdef, p.proconfig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1`,
          [APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].prosecdef, false, 'debe ser SECURITY INVOKER');
        assert.deepEqual(rows[0].proconfig, ['search_path=pg_catalog, pg_temp']);
      });

      it('G3: la 116 no amplía ningún privilegio de la 114', async () => {
        const { rows } = await q(
          `SELECT privilege_type FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'contact_phones'
              AND grantee = 'service_role'
            ORDER BY privilege_type`,
        );
        assert.deepEqual(
          rows.map((r) => r.privilege_type).sort(),
          ['INSERT', 'SELECT', 'UPDATE'],
          'sigue SIN DELETE',
        );

        const { rows: srcCols } = await q(
          `SELECT column_name FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'contact_phone_sources'
              AND grantee = 'service_role' AND privilege_type = 'UPDATE'
            ORDER BY column_name`,
        );
        assert.deepEqual(
          srcCols.map((r) => r.column_name),
          ['suppressed_at', 'suppressed_by', 'suppression_reason'],
          'el UPDATE sobre procedencias sigue limitado a la tríada',
        );
      });
    });
  },
);
