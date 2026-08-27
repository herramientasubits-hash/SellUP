/**
 * AGENT2-CONTACT-HUBSPOT-STALE-COMPLETENESS-CUT3A — la transición a `stale` DENTRO de la
 * transacción, contra PostgreSQL 17 real.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La afirmación central de CUT-3A —«el estado deja de decir `synced` EN LA MISMA TRANSACCIÓN que
 * proyecta el teléfono»— no es una regla del código: es una propiedad de PostgreSQL. Una suite
 * estática puede demostrar que la llamada está escrita; sólo un servidor real puede demostrar
 * que un ROLLBACK se lleva el número y el veredicto sobre él a la vez, y que no existe un
 * instante en el que el teléfono esté guardado y la ficha siga diciendo que HubSpot está al día.
 *
 * Aquí se aplican de verdad las migraciones (099 → 107 → 109 → 112 → 113 → 114 → 115 → 117 →
 * CUT-3A), y lo que se comprueba después es el CONTENIDO de `contacts.metadata`.
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
  'CUT-3A — el estado HubSpot deja de mentir dentro de la transacción, en PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    let dataDir: string;

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
    const q = (sql: string, values?: unknown[]) => client.query(sql, values);

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-cut3a-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: join(dataDir, 'data'),
        user: 'postgres',
        password: 'postgres',
        // Puerto propio: 54401/54402/54403/54404 los usan las suites 4O-F, H1, H2, H3-A y H3-B.
        port: 54405,
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
      // LA migración bajo prueba, aplicada DESPUÉS: reemplaza las dos funciones vivas.
      await q(readMigration(MIGRATION_CUT3A));

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

    // ═══════════════════════════════════════════════════════════
    // PARTE A — el merge (117)
    // ═══════════════════════════════════════════════════════════

    describe('1. un contacto `synced` cuyo saliente cambia por el merge', () => {
      it('queda `stale` con `phone_changed`, sellado en la MISMA transacción', async () => {
        const contactId = await insertContact({ metadata: { hubspot_sync: syncBlock() } });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.status, 'merged');
        assert.equal(envelope.scalar_projection, 'projected');
        assert.equal(envelope.hubspot_sync_transition, 'marked');

        // El número Y el veredicto sobre él, en la misma fila y tras el mismo COMMIT.
        assert.equal(await scalarOf(contactId), P_NEW);
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_changed');
        assert.equal(state?.stale_since, NOW);
        assert.equal(state?.last_error, null);
      });

      it('conserva el vínculo y la auditoría del intento que lo creó', async () => {
        const contactId = await insertContact({ metadata: { hubspot_sync: syncBlock() } });
        await mergeOnto(contactId, P_NEW);

        const state = await syncStateOf(contactId);
        // El vínculo NO se toca: `stale` describe los DATOS, no la existencia del contacto.
        assert.equal(state?.hubspot_contact_id, HS_ID);
        // Esto no fue un intento de sincronización: no estampa una hora nueva.
        assert.equal(state?.attempted_at, EARLIER);
        assert.equal(state?.method, 'manual');
        // Y la auditoría de 17A.4C que la UI sigue leyendo sobrevive entera.
        assert.equal(state?.synced_at, EARLIER);
        assert.equal(state?.mode, 'created');
        assert.equal(state?.company_association, 'associated');
      });
    });

    describe('2 · 6 · 7. el saliente NO cambia', () => {
      it('un número secundario que no mueve el escalar saliente deja `synced` intacto', async () => {
        // El contacto YA tenía un número: la 117 nunca pisa un escalar incumbente, así que el
        // merge añade a la colección y el saliente se queda donde estaba.
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          phoneSource: 'manual',
          phoneType: 'work',
          metadata: { hubspot_sync: syncBlock() },
        });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.status, 'merged');
        assert.equal(envelope.scalar_projection, 'incumbent_preserved');
        assert.equal(envelope.hubspot_sync_transition, 'no_outbound_change');
        assert.equal(await scalarOf(contactId), P_INCUMBENT);
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_reason, null);
        assert.equal(state?.stale_since, null);
      });

      it('7. `mobile_phone` TAPA a `phone`: proyectar el escalar no marca nada', async () => {
        // El saliente es `mobile_phone ?? phone`. La 117 escribe `phone` (estaba NULL) y NO
        // toca `mobile_phone`, así que lo que HubSpot recibiría no se mueve ni un dígito.
        // Marcar aquí prometería una actualización que sería un no-op.
        const contactId = await insertContact({
          phone: null,
          mobilePhone: P_INCUMBENT,
          metadata: { hubspot_sync: syncBlock() },
        });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.scalar_projection, 'projected');
        assert.equal(await scalarOf(contactId), P_NEW);
        assert.equal(envelope.hubspot_sync_transition, 'no_outbound_change');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_since, null);
      });
    });

    describe('3. ya estaba `stale` y el merge vuelve a cambiar el teléfono', () => {
      it('el `stale_since` ORIGINAL se conserva: no se re-sella la hora', async () => {
        const contactId = await insertContact({
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
            }),
          },
        });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.hubspot_sync_transition, 'already_pending');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_changed');
        // Desde CUÁNDO HubSpot está desactualizado no lo pone al día un segundo cambio.
        assert.equal(state?.stale_since, EARLIER);
      });
    });

    describe('4. había un intento FALLIDO con un teléfono pendiente', () => {
      it('el fallo NO se degrada a `stale` y su contexto sobrevive entero', async () => {
        const contactId = await insertContact({
          metadata: {
            hubspot_sync: syncBlock({
              status: 'failed',
              last_error: 'hubspot_update_failed',
              attempted_at: NOW,
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
            }),
          },
        });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.hubspot_sync_transition, 'already_pending');
        const state = await syncStateOf(contactId);
        // «El último intento falló» y «queda algo por enviar» son DOS hechos. Perder el
        // primero borraría que alguien ya lo intentó y por qué no entró.
        assert.equal(state?.status, 'failed');
        assert.equal(state?.last_error, 'hubspot_update_failed');
        assert.equal(state?.stale_since, EARLIER);
        assert.equal(state?.stale_reason, 'phone_changed');
      });
    });

    describe('5. el contacto no está vinculado a HubSpot', () => {
      it('no hay nada que pueda estar desactualizado: no se marca', async () => {
        const contactId = await insertContact({
          hubspotContactId: null,
          metadata: { hubspot_sync: syncBlock({ hubspot_contact_id: null }) },
        });

        const envelope = await mergeOnto(contactId, P_NEW);

        assert.equal(envelope.scalar_projection, 'projected');
        assert.equal(envelope.hubspot_sync_transition, 'not_linked');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_since, null);
      });

      it('el vínculo se lee de la FILA, no del bloque que alguien recordó', async () => {
        // Bloque que AFIRMA un id; columna vacía. La columna manda: el bloque recuerda el id
        // que un intento guardó, la fila dice si el vínculo existe hoy.
        const contactId = await insertContact({
          hubspotContactId: null,
          metadata: { hubspot_sync: syncBlock() },
        });
        const envelope = await mergeOnto(contactId, P_NEW);
        assert.equal(envelope.hubspot_sync_transition, 'not_linked');
      });
    });

    describe('estados que NO autorizan a marcar', () => {
      it('sin bloque durable legible es territorio de REPARACIÓN, no de `stale`', async () => {
        const contactId = await insertContact({ metadata: {} });
        const envelope = await mergeOnto(contactId, P_NEW);
        assert.equal(envelope.hubspot_sync_transition, 'no_durable_state');
        assert.equal(await syncStateOf(contactId), null);
      });

      it('un `status` fuera del vocabulario NO se disfraza de conocido', async () => {
        const contactId = await insertContact({
          metadata: { hubspot_sync: syncBlock({ status: 'en_curso' }) },
        });
        const envelope = await mergeOnto(contactId, P_NEW);
        assert.equal(envelope.hubspot_sync_transition, 'no_durable_state');
        assert.equal((await syncStateOf(contactId))?.status, 'en_curso');
      });

      it('un contacto que nunca llegó a estar `synced` no puede quedar desactualizado', async () => {
        const contactId = await insertContact({
          metadata: { hubspot_sync: syncBlock({ status: 'never_attempted' }) },
        });
        const envelope = await mergeOnto(contactId, P_NEW);
        assert.equal(envelope.hubspot_sync_transition, 'not_previously_synced');
        assert.equal((await syncStateOf(contactId))?.status, 'never_attempted');
      });
    });

    describe('14. la atomicidad', () => {
      it('un ROLLBACK se lleva el teléfono Y el veredicto sobre él, juntos', async () => {
        const contactId = await insertContact({ metadata: { hubspot_sync: syncBlock() } });
        const candidateId = await insertDuplicateCandidate({
          matchedContactId: contactId,
          phone: P_NEW,
        });
        await insertCandidatePhone({ candidateId, phone: P_NEW });

        const params = buildMergeCandidateIntoExistingContactParams({
          candidateId,
          contactId,
          accountId: ACCOUNT_ID,
          reviewPatch: reviewPatch(),
          scalarFallback: null,
          incumbentBootstrap: null,
          actorId: ACTOR_ID,
          nowIso: NOW,
        });
        const names = Object.keys(params);
        const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');

        await q('BEGIN');
        const { rows } = await q(
          `SELECT public.${MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN}(${placeholders}) AS envelope`,
          names.map((n) => {
            const v = (params as Record<string, unknown>)[n];
            return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
          }),
        );
        // DENTRO de la transacción los dos hechos ya son coherentes entre sí.
        assert.equal((rows[0].envelope as Record<string, unknown>).hubspot_sync_transition, 'marked');
        assert.equal(await scalarOf(contactId), P_NEW);
        assert.equal((await syncStateOf(contactId))?.status, 'stale');
        await q('ROLLBACK');

        // Y fuera, NINGUNO de los dos ocurrió. No existe el estado intermedio en el que el
        // teléfono está guardado y la ficha sigue diciendo `synced`: es el mismo COMMIT.
        assert.equal(await scalarOf(contactId), null);
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'synced');
        assert.equal(state?.stale_since, null);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // PARTE B — borrar el saliente, y la privacidad (115)
    // ═══════════════════════════════════════════════════════════

    /** Llama a la autoridad directamente, como hacen la 115 y la 117 desde dentro. */
    async function markStale(contactId: string, previousOutbound: string | null): Promise<string> {
      const { rows } = await q(
        `SELECT public.mark_contact_hubspot_sync_stale_for_phone($1, $2, $3::timestamptz) AS d`,
        [contactId, previousOutbound, NOW],
      );
      return rows[0].d as string;
    }

    describe('9. el saliente pasa de VALOR a NULL', () => {
      it('se marca `stale` con `phone_removed`: HubSpot conserva lo que SellUp ya no tiene', async () => {
        const contactId = await insertContact({
          phone: null,
          metadata: { hubspot_sync: syncBlock() },
        });

        assert.equal(await markStale(contactId, P_INCUMBENT), 'marked');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_removed');
        assert.equal(state?.stale_since, NOW);
      });

      it('8. vaciar `mobile_phone` deja al descubierto un `phone` DISTINTO ⇒ `phone_changed`', async () => {
        // El saliente era el celular; ahora es el fijo, que no es el mismo número. HubSpot
        // recibiría otra cosa, así que hay algo que enviar — y lo que hay que enviar es un
        // número, no un borrado.
        const contactId = await insertContact({
          phone: P_OTHER,
          mobilePhone: null,
          metadata: { hubspot_sync: syncBlock() },
        });

        assert.equal(await markStale(contactId, P_INCUMBENT), 'marked');
        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_changed');
      });
    });

    describe('la razón se REDERIVA; la hora y el estado no', () => {
      it('un `phone_changed` pendiente cuyo teléfono se vacía pasa a `phone_removed`', async () => {
        // Si la razón sobreviviera, el siguiente clic enviaría un número que SellUp ya no
        // tiene. La razón no recuerda: instruye al PATCH.
        const contactId = await insertContact({
          phone: null,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'phone_changed',
            }),
          },
        });

        assert.equal(await markStale(contactId, P_INCUMBENT), 'reason_corrected');
        const state = await syncStateOf(contactId);
        assert.equal(state?.stale_reason, 'phone_removed');
        // La hora original y el estado se conservan.
        assert.equal(state?.stale_since, EARLIER);
        assert.equal(state?.status, 'stale');
      });

      it('un `phone_removed` FALLIDO que recupera número pasa a `phone_changed` sin degradarse', async () => {
        // Al revés y peor: un `phone_removed` que sobreviviera a un número nuevo haría que el
        // siguiente clic lo BORRARA en HubSpot.
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'failed',
              last_error: 'hubspot_update_failed',
              stale_since: EARLIER,
              stale_reason: 'phone_removed',
            }),
          },
        });

        assert.equal(await markStale(contactId, null), 'reason_corrected');
        const state = await syncStateOf(contactId);
        assert.equal(state?.stale_reason, 'phone_changed');
        assert.equal(state?.status, 'failed');
        assert.equal(state?.last_error, 'hubspot_update_failed');
        assert.equal(state?.stale_since, EARLIER);
      });

      it('una razón fuera del vocabulario no cuenta como pendiente', async () => {
        const contactId = await insertContact({
          phone: P_NEW,
          metadata: {
            hubspot_sync: syncBlock({
              status: 'stale',
              stale_since: EARLIER,
              stale_reason: 'porque_si',
            }),
          },
        });
        // No se trata como pendiente y el estado no es `synced` ⇒ no se marca nada.
        assert.equal(await markStale(contactId, null), 'not_previously_synced');
        assert.equal((await syncStateOf(contactId))?.stale_reason, 'porque_si');
      });
    });

    describe('13. la supresión de privacidad (115)', () => {
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

      it('borrar el último número deja `stale` + `phone_removed`, nunca un `synced` falso', async () => {
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
        assert.equal(envelope.scalar_synced, true);
        assert.equal(await scalarOf(contactId), null);
        assert.equal(envelope.hubspot_sync_transition, 'marked');

        const state = await syncStateOf(contactId);
        assert.equal(state?.status, 'stale');
        assert.equal(state?.stale_reason, 'phone_removed');
        assert.equal(state?.stale_since, NOW);
        // El vínculo sobrevive: la erasure retira un dato, no desvincula el contacto.
        assert.equal(state?.hubspot_contact_id, HS_ID);
      });

      it('la erasure NO exporta nada: cero red, y el envelope no lleva el número', async () => {
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
        // El veredicto es MECÁNICO y dice qué se REGISTRÓ, nunca qué se envió.
        assert.equal(envelope.hubspot_sync_transition, 'marked');
      });

      it('un escalar GUARDADO por procedencia no se toca, y por tanto no se marca', async () => {
        // `phone_source = manual` está fuera de la allowlist: la 115 deja la tupla entera en
        // paz (FIX M1), el saliente no cambia y la autoridad lo dice sin necesitar un caso
        // especial.
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
        assert.equal(await scalarOf(contactId), P_INCUMBENT);
        assert.equal(envelope.hubspot_sync_transition, 'no_outbound_change');
        assert.equal((await syncStateOf(contactId))?.status, 'synced');
      });

      it('sin colección oficial la 115 no evalúa nada y no inventa un veredicto', async () => {
        const contactId = await insertContact({
          phone: P_INCUMBENT,
          phoneSource: 'apollo_reveal',
          metadata: { hubspot_sync: syncBlock() },
        });
        const envelope = await suppress(contactId);
        assert.equal(envelope.status, 'no_official_collection');
        assert.equal(envelope.hubspot_sync_transition, 'not_evaluated');
        assert.equal((await syncStateOf(contactId))?.status, 'synced');
      });
    });

    describe('la autoridad no puede ser invocada por un cliente', () => {
      it('`authenticated` no tiene EXECUTE sobre ninguna de las dos funciones', async () => {
        const { rows } = await q(
          `SELECT has_function_privilege('authenticated',
                    'public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz)',
                    'EXECUTE') AS mark,
                  has_function_privilege('authenticated',
                    'public.hubspot_outbound_phone(text, text)', 'EXECUTE') AS outbound,
                  has_function_privilege('anon',
                    'public.mark_contact_hubspot_sync_stale_for_phone(uuid, text, timestamptz)',
                    'EXECUTE') AS anon_mark`,
        );
        // Marcar es la CONSECUENCIA de una operación autorizada, nunca una operación en sí:
        // un cliente que pudiera invocarla declararía desactualizada la ficha de cualquier
        // contacto sin haber tocado un solo teléfono.
        assert.equal(rows[0].mark, false);
        assert.equal(rows[0].outbound, false);
        assert.equal(rows[0].anon_mark, false);
      });
    });
  },
);
