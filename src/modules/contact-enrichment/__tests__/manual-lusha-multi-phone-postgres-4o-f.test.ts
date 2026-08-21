/**
 * Agente 2A — El disparo MANUAL de Lusha contra un PostgreSQL de VERDAD
 * (AGENT2A-PHONE-REVEAL-4O-F) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * `manual-lusha-multi-phone-4o-f.test.ts` fija el CONTRATO del camino manual con un
 * doble en memoria: qué colección se construye y qué se envía. Lo que un doble no
 * puede fijar es la GARANTÍA —no tiene transacciones—, así que «atomicidad» ahí sería
 * una afirmación programada, no demostrada. Es la misma distinción que bloqueó el
 * merge de 4O-C y que 4O-C-R1 cerró.
 *
 * 4O-F NO escribe SQL nuevo: reutiliza `persist_candidate_lusha_phone_reveal_result`
 * (migración 111, restatement de la 113) SIN tocar una línea. Las propiedades de esa
 * función ya están probadas por la suite de 4O-D. Lo que este archivo añade es lo
 * único que 4O-D no podía cubrir: que el PAYLOAD QUE CONSTRUYE EL CAMINO MANUAL —el
 * que sale de `runLushaPhoneFallbackReveal` en modo manual, con corrida y reserva
 * nulas— sea aceptado por la función REAL y produzca el resultado correcto.
 *
 * Por eso aquí no se llama a la RPC con parámetros inventados: se ejecuta el CORE, y
 * la dep `persistPhoneCollection` traduce su petición a la llamada SQL con el MISMO
 * mapeo de parámetros que `candidate-lusha-phone-collection-persistence.ts`. Si ese
 * mapeo divergiera, estas pruebas fallarían.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`;
 *   * las migraciones 109, 110, 111, 112 y 113 TAL CUAL están en disco — es decir,
 *     los cuerpos que Producción ejecuta hoy, con la re-comprobación de supresión
 *     por persona dentro de la transacción.
 *
 * NO llama a Lusha, ni a Apollo, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito. Todos los números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito.
 * Si el módulo no está resuelto, el archivo se SALTA con un motivo explícito.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:manual-lusha-multi-phone-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones son prerelease.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import {
  runLushaPhoneFallbackReveal,
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import type {
  CandidateLushaPhoneCollectionWriteRequest,
  CandidateLushaPhoneCollectionWriteResult,
} from '../candidate-lusha-phone-collection-writer';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import {
  extractAllLushaPhones,
  selectPrimaryLushaPhone,
} from '@/server/integrations/lusha-phone-fallback-phones';
import { normalizeCandidatePhone } from '../phone-collection-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const FN = 'persist_candidate_lusha_phone_reveal_result';
const APOLLO_FN = 'persist_candidate_apollo_phone_reveal_result';

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
// Datos
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const RUN_ID = '88888888-8888-4888-8888-888888888888';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-08-10T10:00:00.000Z';
/** El estado que el gate exige antes de autorizar una pata de Lusha. */
const EXPECTED = 'no_phone_found';

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const DIRECT = '+15550000003';

/** Marcador que hace saltar el trigger de la tabla de procedencias. */
const INJECT_SOURCE_FAILURE = '__inject_failure__';

const keyOf = (number: string) =>
  normalizeCandidatePhone({
    displayPhone: number,
    sanitizedPhone: number,
    countryCode: null,
  }).dedupeKey;

function clientResult(
  rawPhones: unknown[],
  overrides: Partial<LushaPhoneFallbackClientResult> = {},
): LushaPhoneFallbackClientResult {
  const phones = extractAllLushaPhones({ results: [{ phones: rawPhones }] });
  const primary = selectPrimaryLushaPhone(phones);
  return {
    ok: true,
    httpStatus: 200,
    phones,
    phoneNumber: primary?.number ?? null,
    phoneType: primary?.phoneType ?? 'unknown',
    phoneRawType: primary?.rawType ?? null,
    creditsCharged: 5,
    candidateStatus: phones.length > 0 ? 'revealed' : 'no_phone_found',
    usageStatus: 'success',
    costSource: 'reported',
    errorCode: null,
    availabilitySource: null,
    phonesReturned: rawPhones.length,
    ...overrides,
  } as LushaPhoneFallbackClientResult;
}

describe(
  '4O-F — el camino manual contra la transacción real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    let client: PgLikeClient;
    /** Segunda conexión: sin ella no hay concurrencia que medir, solo una secuencia. */
    let other: PgLikeClient;
    let dataDir = '';

    const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

    function sliceMigration(file: string, from: string, to: string): string {
      const sql = readMigration(file);
      const start = sql.indexOf(from);
      const end = sql.indexOf(to);
      assert.notEqual(start, -1, `marcador inicial ausente en ${file}`);
      assert.notEqual(end, -1, `marcador final ausente en ${file}`);
      assert.ok(end > start, `marcadores invertidos en ${file}`);
      return sql.slice(start, end);
    }

    // ═══════════════════════════════════════════════════════════
    // La dep REAL en su forma: petición del core → llamada SQL
    // ═══════════════════════════════════════════════════════════

    /**
     * Traduce `CandidateLushaPhoneCollectionWriteRequest` a la llamada con parámetros
     * NOMBRADOS, con el MISMO mapeo que `persistCandidateLushaPhoneCollection` — que es
     * lo único de aquel módulo que no es I/O de Supabase. Lo que se prueba con esto es
     * que el payload que construye el CAMINO MANUAL sea aceptado por la función real.
     */
    function sqlBackedCollectionWriter(conn: () => PgLikeClient) {
      return async (
        request: CandidateLushaPhoneCollectionWriteRequest,
      ): Promise<CandidateLushaPhoneCollectionWriteResult> => {
        const { terminal } = request;
        const phones = request.phones.map((phone) => ({
          dedupe_key: phone.dedupeKey,
          normalized_phone: phone.normalizedPhone,
          display_phone: phone.displayPhone,
          phone_type: phone.phoneType,
          phone_status: phone.phoneStatus,
          first_seen_at: phone.firstSeenAt,
          last_seen_at: phone.lastSeenAt,
        }));
        const sources = request.phones.flatMap((phone) =>
          phone.sources.map((source) => ({
            dedupe_key: phone.dedupeKey,
            provider: source.provider,
            acquisition_mode: source.acquisitionMode,
            raw_provider_type: source.rawProviderType,
            raw_provider_status: source.rawProviderStatus,
            waterfall_run_id: source.waterfallRunId,
            reservation_id: source.reservationId,
            provider_usage_log_id: source.providerUsageLogId,
            source_event_key: source.sourceEventKey,
            observed_at: source.observedAt,
          })),
        );
        const primaryCandidates = request.primaryCandidates.map((candidate) => ({
          dedupe_key: candidate.dedupeKey,
          phone: candidate.phone,
          phone_type: candidate.phoneType,
          raw_type: candidate.rawType,
        }));

        const { rows } = await conn().query(
          `SELECT public.${FN}(
             p_candidate_id                 => $1::uuid,
             p_expected_phone_reveal_status => $2::text,
             p_observed_at                  => $3::timestamptz,
             p_phones                       => $4::jsonb,
             p_sources                      => $5::jsonb,
             p_primary_candidates           => $6::jsonb,
             p_legacy_phone                 => $7::text,
             p_legacy_phone_type            => $8::text,
             p_legacy_raw_type              => $9::text,
             p_legacy_dedupe_key            => $10::text,
             p_phone_reveal_status          => $11::text,
             p_phone_reveal_provider        => $12::text,
             p_phone_reveal_request_id      => $13::text,
             p_phone_revealed_at            => $14::timestamptz,
             p_phone_reveal_completed_at    => $15::timestamptz,
             p_phone_revealed_by            => $16::uuid,
             p_phone_reveal_cost_credits    => $17::integer,
             p_phone_reveal_cost_source     => $18::text,
             p_phone_reveal_error_code      => $19::text,
             p_phone_reveal_attempt_count   => $20::integer
           ) AS result`,
          [
            request.candidateId,
            terminal.expectedPhoneRevealStatus,
            request.observedAt,
            JSON.stringify(phones),
            JSON.stringify(sources),
            JSON.stringify(primaryCandidates),
            terminal.legacyPhone,
            terminal.legacyPhoneType,
            terminal.legacyRawType,
            terminal.legacyDedupeKey,
            'revealed',
            'lusha',
            terminal.requestId,
            terminal.revealedAt,
            terminal.completedAt,
            terminal.revealedBy,
            terminal.costCredits,
            terminal.costSource,
            null,
            terminal.attemptCount,
          ],
        );

        const envelope = rows[0].result as Record<string, unknown>;
        const status = envelope.status as string;
        if (status === 'invalid_input') {
          throw new Error(`payload rechazado: ${String(envelope.detail)}`);
        }
        const count = (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value) ? value : 0;
        return {
          status: status as CandidateLushaPhoneCollectionWriteResult['status'],
          inserted_phone_count: count(envelope.inserted_phone_count),
          updated_phone_count: count(envelope.updated_phone_count),
          inserted_source_count: count(envelope.inserted_source_count),
          suppressed_skipped_count: count(envelope.suppressed_skipped_count),
          primary_dedupe_key:
            typeof envelope.primary_dedupe_key === 'string'
              ? envelope.primary_dedupe_key
              : null,
          primary_persisted: envelope.primary_set === true,
          candidate_scalar_updated: envelope.candidate_scalar_updated === true,
          candidate_terminalized: envelope.candidate_terminalized === true,
        };
      };
    }

    interface RunOutcome {
      result: Awaited<ReturnType<typeof runLushaPhoneFallbackReveal>>;
      logged: LushaPhoneFallbackUsageLogEntry[];
      scalarWrites: number;
    }

    /** Ejecuta el disparo MANUAL completo contra la base real. */
    async function runManualReveal(args: {
      candidateId: string;
      phones: unknown[];
      conn?: () => PgLikeClient;
      attemptCount?: number;
    }): Promise<RunOutcome> {
      const logged: LushaPhoneFallbackUsageLogEntry[] = [];
      let scalarWrites = 0;

      const candidate: LushaPhoneFallbackCandidateRecord = {
        id: args.candidateId,
        status: 'pending_review',
        source: 'lusha',
        sourceContactId: 'v1.abcdef1234567890',
        existingPhone: null,
        phoneRevealStatus: EXPECTED,
        phoneRevealAttemptCount: args.attemptCount ?? 1,
        enrichmentMetadata: {} as never,
      };

      const deps: LushaPhoneFallbackCoreDeps = {
        flagEnabled: true,
        actor: { internalUserId: ACTOR_ID, roleKey: 'admin' },
        nowIso: NOW,
        // Modo MANUAL, exactamente como lo cablea la server action.
        phoneRevealWaterfallId: null,
        phoneCollectionReservationId: null,
        persistPhoneCollection: sqlBackedCollectionWriter(args.conn ?? (() => client)),
        loadCandidate: async () => candidate,
        callLusha: async () => clientResult(args.phones),
        persist: async () => {
          scalarWrites += 1;
        },
        logUsage: async (entry) => {
          logged.push(entry);
        },
      };

      const result = await runLushaPhoneFallbackReveal(
        {
          candidateId: args.candidateId,
          confirmCost: true,
          expectedMaxCredits: LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
        },
        deps,
      );
      return { result, logged, scalarWrites };
    }

    // ── Lecturas ────────────────────────────────────────────────

    async function phoneRows(candidateId: string) {
      const { rows } = await client.query(
        `SELECT dedupe_key, normalized_phone, display_phone, phone_type, phone_status,
                is_primary, suppressed_at
           FROM public.contact_enrichment_candidate_phones
          WHERE candidate_id = $1
          ORDER BY dedupe_key`,
        [candidateId],
      );
      return rows;
    }

    async function sourceRows(candidateId: string) {
      const { rows } = await client.query(
        `SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.waterfall_run_id,
                s.reservation_id, p.dedupe_key
           FROM public.contact_enrichment_candidate_phone_sources s
           JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
          WHERE p.candidate_id = $1
          ORDER BY p.dedupe_key, s.raw_provider_type`,
        [candidateId],
      );
      return rows;
    }

    async function candidateRow(candidateId: string) {
      const { rows } = await client.query(
        `SELECT phone, enrichment_metadata, phone_reveal_status, phone_reveal_provider,
                phone_reveal_cost_credits, phone_reveal_attempt_count, phone_reveal_request_id
           FROM public.contact_enrichment_candidates WHERE id = $1`,
        [candidateId],
      );
      return rows[0];
    }

    /** Siembra una colección del OTRO proveedor llamando a SU función real. */
    async function seedApollo(args: {
      candidateId: string;
      number: string;
      phoneType: string;
      requestId: string;
    }): Promise<void> {
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone_reveal_status = 'in_flight', phone_reveal_request_id = $2
          WHERE id = $1`,
        [args.candidateId, args.requestId],
      );
      const key = keyOf(args.number);
      const { rows } = await client.query(
        `SELECT public.${APOLLO_FN}(
           p_candidate_id                     => $1::uuid,
           p_expected_request_id              => $2::text,
           p_reveal_phase                     => 'webhook'::text,
           p_observed_at                      => $3::timestamptz,
           p_phones                           => $4::jsonb,
           p_sources                          => $5::jsonb,
           p_primary_candidates               => $6::jsonb,
           p_legacy_phone                     => $7::text,
           p_legacy_phone_type                => $8::text,
           p_legacy_raw_type                  => $9::text,
           p_legacy_dedupe_key                => $10::text,
           p_phone_reveal_status              => 'revealed'::text,
           p_phone_reveal_provider            => 'apollo'::text,
           p_phone_revealed_at                => $11::timestamptz,
           p_phone_reveal_completed_at        => $11::timestamptz,
           p_phone_reveal_webhook_received_at => $11::timestamptz,
           p_phone_reveal_last_checked_at     => NULL::timestamptz,
           p_phone_reveal_cost_credits        => 1::integer,
           p_phone_reveal_cost_source         => 'reported'::text,
           p_phone_reveal_error_code          => NULL::text,
           p_phone_processing_basis           => NULL::text,
           p_apollo_person_id                 => NULL::text
         ) AS result`,
        [
          args.candidateId,
          args.requestId,
          NOW,
          JSON.stringify([
            {
              dedupe_key: key,
              normalized_phone: args.number,
              display_phone: args.number,
              phone_type: args.phoneType,
              phone_status: 'unknown',
              first_seen_at: NOW,
              last_seen_at: NOW,
            },
          ]),
          JSON.stringify([
            {
              dedupe_key: key,
              provider: 'apollo',
              acquisition_mode: 'reveal',
              raw_provider_type: args.phoneType,
              raw_provider_status: null,
              waterfall_run_id: null,
              reservation_id: null,
              provider_usage_log_id: null,
              source_event_key: `v1:apollo:reveal:webhook:${args.requestId}`,
              observed_at: NOW,
            },
          ]),
          JSON.stringify([
            {
              dedupe_key: key,
              phone: args.number,
              phone_type: args.phoneType,
              raw_type: args.phoneType,
            },
          ]),
          args.number,
          args.phoneType,
          args.phoneType,
          key,
          // $11 — el mismo instante para revealed/completed/webhook/last_checked.
          NOW,
        ],
      );
      const envelope = rows[0].result as Record<string, unknown>;
      assert.equal(envelope.status, 'persisted', `la siembra del otro proveedor falló: ${JSON.stringify(envelope)}`);
      // Devolver el candidato al estado que autoriza la pata manual de Lusha.
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone_reveal_status = $2, phone_reveal_request_id = NULL
          WHERE id = $1`,
        [args.candidateId, EXPECTED],
      );
    }

    /**
     * Tombstonea con la función REAL de la DSAR (migración 112), no con un UPDATE a mano.
     * Es lo que hace Producción, y es lo único que además limpia el escalar del
     * candidato: tombstonear solo la fila canónica dejaría el número visible y la
     * prueba mediría un estado que el sistema nunca produce.
     */
    async function suppressViaDsar(args: {
      candidateId: string;
      scope: 'all_candidate_phones' | 'exact_phone';
      dedupeKey?: string;
    }): Promise<void> {
      const { rows } = await client.query(
        `SELECT public.suppress_candidate_phone_collection(
           p_candidate_id               => $1::uuid,
           p_expected_enrichment_run_id => $2::uuid,
           p_scope                      => $3::text,
           p_dedupe_key                 => $4::text,
           p_suppression_reason         => 'data_subject_request'::text,
           p_suppressed_by              => $5::uuid,
           p_suppressed_at              => now()
         ) AS result`,
        [args.candidateId, RUN_ID, args.scope, args.dedupeKey ?? null, ACTOR_ID],
      );
      const envelope = rows[0].result as Record<string, unknown>;
      assert.equal(
        envelope.status,
        'suppressed',
        `la DSAR no se aplicó: ${JSON.stringify(envelope)}`,
      );
      // La DSAR deja el candidato fuera del estado que autoriza una pata de Lusha; se
      // devuelve al punto de partida para poder ejercer el reveal manual siguiente.
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone_reveal_status = $2, phone_reveal_request_id = NULL
          WHERE id = $1`,
        [args.candidateId, EXPECTED],
      );
    }

    let nextCandidate = 0;
    async function freshCandidate(): Promise<string> {
      nextCandidate += 1;
      const id = `1111111${nextCandidate % 10}-1111-4111-8111-${String(nextCandidate).padStart(12, '0')}`;
      await client.query(
        `INSERT INTO public.contact_enrichment_candidates
           (id, enrichment_run_id, source, source_contact_id, phone_reveal_status)
         VALUES ($1, $2, 'lusha', 'v1.abcdef1234567890', $3)`,
        [id, RUN_ID, EXPECTED],
      );
      return id;
    }

    // ═══════════════════════════════════════════════════════════
    // Arranque
    // ═══════════════════════════════════════════════════════════

    before(async () => {
      if (!EmbeddedPostgresCtor) return;
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-4of-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54401,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();
      other = postgres.getPgClient();
      await other.connect();

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

        -- Las tres tablas de contabilidad, solo por sus FK. Que sigan VACÍAS es la
        -- prueba de que la transacción no contabiliza: el costo vive fuera.
        CREATE TABLE public.phone_reveal_waterfall_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.phone_reveal_credit_reservations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.provider_usage_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE public.phone_reveal_suppression_audit (
          id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          provider                text NOT NULL DEFAULT 'apollo',
          provider_person_id_hash text NOT NULL,
          account_id              uuid,
          country_code            text,
          actor_user_id           uuid,
          reason_code             text NOT NULL,
          candidates_cleared      integer NOT NULL DEFAULT 0,
          contacts_cleared        integer NOT NULL DEFAULT 0,
          cache_rows_suppressed   integer NOT NULL DEFAULT 0,
          tombstone_created       boolean NOT NULL DEFAULT false,
          created_at              timestamptz NOT NULL DEFAULT now(),
          metadata                jsonb NOT NULL DEFAULT '{}'::jsonb
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
      await client.query(
        readMigration('113_phone_reveal_person_suppression_recheck.sql'),
      );

      // Inyector de fallo, inerte salvo activación explícita por el payload.
      await client.query(`
        CREATE FUNCTION test_inject_source_failure() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.raw_provider_type = '${INJECT_SOURCE_FAILURE}' THEN
            RAISE EXCEPTION 'injected failure: provenance insert';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER test_inject_source_failure
          BEFORE INSERT ON public.contact_enrichment_candidate_phone_sources
          FOR EACH ROW EXECUTE FUNCTION test_inject_source_failure();`);

      await client.query('INSERT INTO public.accounts (id) VALUES ($1)', [ACCOUNT_ID]);
      await client.query('INSERT INTO public.internal_users (id) VALUES ($1)', [ACTOR_ID]);
      await client.query(
        'INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)',
        [RUN_ID, ACCOUNT_ID],
      );
    });

    after(async () => {
      if (!EmbeddedPostgresCtor) return;
      await other?.end().catch(() => {});
      await client?.end().catch(() => {});
      await postgres?.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ═══════════════════════════════════════════════════════════
    // § 25 — commit multi-teléfono desde el camino manual
    // ═══════════════════════════════════════════════════════════

    it('tres teléfonos de UNA respuesta ⇒ 3 filas, 3 procedencias, 1 principal', async () => {
      const id = await freshCandidate();

      const { result, logged, scalarWrites } = await runManualReveal({
        candidateId: id,
        phones: [
          { number: WORK, type: 'work' },
          { number: DIRECT, type: 'direct_dial' },
          { number: MOBILE, type: 'mobile' },
        ],
      });

      assert.equal(result.status, 'revealed');
      assert.equal(scalarWrites, 0, 'el camino manual ya no pasa por el UPDATE suelto');

      const rows = await phoneRows(id);
      assert.equal(rows.length, 3, 'los tres teléfonos pagados están en la base');
      assert.equal(rows.filter((r) => r.is_primary).length, 1, 'un único principal');
      const primary = rows.find((r) => r.is_primary);
      assert.equal(primary?.dedupe_key, keyOf(MOBILE), 'el principal es el móvil');

      const sources = await sourceRows(id);
      assert.equal(sources.length, 3);
      for (const source of sources) {
        assert.equal(source.provider, 'lusha');
        assert.equal(source.acquisition_mode, 'reveal');
        // El disparo manual no pertenece a ninguna corrida ni reserva.
        assert.equal(source.waterfall_run_id, null);
        assert.equal(source.reservation_id, null);
      }

      // § 14 — el escalar y la metadata describen el MISMO principal.
      const candidate = await candidateRow(id);
      assert.equal(candidate.phone, MOBILE);
      const metadata = candidate.enrichment_metadata as Record<string, Record<string, unknown>>;
      assert.equal(metadata.phone.number, MOBILE);
      assert.equal(metadata.phone.source, 'lusha_reveal');
      assert.equal(metadata.phone.type, 'mobile');
      assert.equal(candidate.phone_reveal_status, 'revealed');
      assert.equal(candidate.phone_reveal_provider, 'lusha');
      assert.equal(candidate.phone_reveal_request_id, null, 'null LIMPIA el id anterior');

      // § 17 — el costo es el de la RESPUESTA, escrito UNA vez.
      assert.equal(candidate.phone_reveal_cost_credits, 5);
      assert.equal(logged.length, 1);
      assert.equal(logged[0].creditsUsed, 5);

      // La transacción no contabiliza: esas tablas siguen vacías.
      for (const table of [
        'phone_reveal_waterfall_runs',
        'phone_reveal_credit_reservations',
        'provider_usage_logs',
      ]) {
        const { rows: counted } = await client.query(
          `SELECT COUNT(*)::int AS n FROM public.${table}`,
        );
        assert.equal(counted[0].n, 0, `${table} no la escribe la transacción`);
      }
    });

    // ═══════════════════════════════════════════════════════════
    // § 9 / § 24.4 — cruce REAL entre proveedores
    // ═══════════════════════════════════════════════════════════

    it('mismo número visto por los dos proveedores ⇒ UNA fila, DOS procedencias', async () => {
      const id = await freshCandidate();
      await seedApollo({
        candidateId: id,
        number: MOBILE,
        phoneType: 'mobile',
        requestId: 'apollo-req-shared',
      });

      await runManualReveal({ candidateId: id, phones: [{ number: MOBILE, type: 'mobile' }] });

      const rows = await phoneRows(id);
      assert.equal(rows.length, 1, 'el mismo número no crea una segunda fila');
      const sources = await sourceRows(id);
      assert.equal(sources.length, 2, 'dos procedencias sobre la misma fila');
      assert.deepEqual(
        new Set(sources.map((s) => s.provider)),
        new Set(['apollo', 'lusha']),
      );
    });

    it('§ 24.5 — un móvil del otro proveedor SOBREVIVE a un work de Lusha', async () => {
      const id = await freshCandidate();
      await seedApollo({
        candidateId: id,
        number: MOBILE,
        phoneType: 'mobile',
        requestId: 'apollo-req-better',
      });

      const { result } = await runManualReveal({
        candidateId: id,
        phones: [{ number: WORK, type: 'work' }],
      });

      assert.equal(result.status, 'revealed');
      const rows = await phoneRows(id);
      assert.equal(rows.length, 2, 'el work de Lusha se guarda como secundario');
      const primary = rows.find((r) => r.is_primary);
      assert.equal(primary?.dedupe_key, keyOf(MOBILE), 'el móvil previo sigue siendo principal');

      // Y el escalar sigue describiendo al principal conservado.
      const candidate = await candidateRow(id);
      assert.equal(candidate.phone, MOBILE);
      const metadata = candidate.enrichment_metadata as Record<string, Record<string, unknown>>;
      assert.notEqual(metadata.phone?.source, 'lusha_reveal');
    });

    it('§ 24.6 — un móvil de Lusha PROMUEVE sobre un work del otro proveedor', async () => {
      const id = await freshCandidate();
      await seedApollo({
        candidateId: id,
        number: WORK,
        phoneType: 'work',
        requestId: 'apollo-req-worse',
      });

      await runManualReveal({ candidateId: id, phones: [{ number: MOBILE, type: 'mobile' }] });

      const rows = await phoneRows(id);
      assert.equal(rows.length, 2);
      assert.equal(rows.filter((r) => r.is_primary).length, 1);
      assert.equal(rows.find((r) => r.is_primary)?.dedupe_key, keyOf(MOBILE));

      const candidate = await candidateRow(id);
      assert.equal(candidate.phone, MOBILE, 'el escalar sigue al principal nuevo');
      const metadata = candidate.enrichment_metadata as Record<string, Record<string, unknown>>;
      assert.equal(metadata.phone.source, 'lusha_reveal');
    });

    // ═══════════════════════════════════════════════════════════
    // § 10 / § 24.7 — tombstones
    // ═══════════════════════════════════════════════════════════

    it('un número tombstoneado NO resucita por una observación manual nueva', async () => {
      const id = await freshCandidate();
      await seedApollo({
        candidateId: id,
        number: MOBILE,
        phoneType: 'mobile',
        requestId: 'apollo-req-tomb',
      });
      // Una DSAR real: el valor desaparece, la clave permanece, y el escalar del
      // candidato se limpia con ella.
      await suppressViaDsar({ candidateId: id, scope: 'all_candidate_phones' });

      const { result } = await runManualReveal({
        candidateId: id,
        // Lusha devuelve el MISMO número suprimido, y nada más.
        phones: [{ number: MOBILE, type: 'mobile' }],
      });

      // La transacción se niega y el core NO declara `revealed`.
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE);
      // El cargo REAL se conserva: se retiene el número, nunca el costo.
      assert.equal(result.creditsCharged, 5);

      const rows = await phoneRows(id);
      const tomb = rows.find((r) => r.dedupe_key === keyOf(MOBILE));
      assert.notEqual(tomb?.suppressed_at, null, 'sigue suprimido');
      assert.equal(tomb?.normalized_phone, null, 'el valor NO vuelve');
      assert.equal(tomb?.is_primary, false);

      const candidate = await candidateRow(id);
      assert.equal(candidate.phone, null, 'el campo visible sigue vacío');
      assert.notEqual(candidate.phone_reveal_status, 'revealed');
    });

    it('un tombstone convive con un teléfono nuevo sano sin bloquearlo', async () => {
      const id = await freshCandidate();
      await seedApollo({
        candidateId: id,
        number: MOBILE,
        phoneType: 'mobile',
        requestId: 'apollo-req-mixed',
      });
      await suppressViaDsar({
        candidateId: id,
        scope: 'exact_phone',
        dedupeKey: keyOf(MOBILE),
      });

      const { result } = await runManualReveal({
        candidateId: id,
        phones: [
          { number: MOBILE, type: 'mobile' },
          { number: WORK, type: 'work' },
        ],
      });

      assert.equal(result.status, 'revealed');
      const rows = await phoneRows(id);
      const tomb = rows.find((r) => r.dedupe_key === keyOf(MOBILE));
      assert.equal(tomb?.normalized_phone, null, 'el suprimido no revive');
      const primary = rows.find((r) => r.is_primary);
      assert.equal(primary?.dedupe_key, keyOf(WORK), 'manda el único vivo');
      const candidate = await candidateRow(id);
      assert.equal(candidate.phone, WORK);
    });

    // ═══════════════════════════════════════════════════════════
    // § 26 — ROLLBACK
    // ═══════════════════════════════════════════════════════════

    it('un fallo DESPUÉS de escribir teléfonos deshace la colección ENTERA', async () => {
      const id = await freshCandidate();

      // El trigger revienta al insertar la procedencia, es decir después de que las
      // filas canónicas ya se escribieron dentro de la transacción.
      const outcome = await runManualReveal({
        candidateId: id,
        phones: [
          { number: WORK, type: INJECT_SOURCE_FAILURE },
          { number: MOBILE, type: 'mobile' },
        ],
      }).catch((error: unknown) => error);

      const result = (outcome as RunOutcome).result;
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, 'collection_persistence_unavailable');

      // 0 estado parcial: ni una fila canónica, ni una procedencia, ni terminal.
      assert.equal((await phoneRows(id)).length, 0, 'ROLLBACK total de la colección');
      assert.equal((await sourceRows(id)).length, 0);
      const candidate = await candidateRow(id);
      assert.equal(candidate.phone, null);
      assert.equal(candidate.phone_reveal_status, EXPECTED, 'el candidato NO se cerró');

      // El gasto SÍ se registra: el usage-log vive fuera de la transacción.
      assert.equal((outcome as RunOutcome).logged.length, 1);
      assert.equal((outcome as RunOutcome).logged[0].creditsUsed, 5);
    });

    // ═══════════════════════════════════════════════════════════
    // § 20 / § 27 — idempotencia y concurrencia
    // ═══════════════════════════════════════════════════════════

    it('§ 20 — repetir la MISMA colección no duplica filas ni principales', async () => {
      const id = await freshCandidate();
      const phones = [
        { number: WORK, type: 'work' },
        { number: MOBILE, type: 'mobile' },
      ];

      await runManualReveal({ candidateId: id, phones });
      const afterFirst = await phoneRows(id);

      // El segundo intento parte del estado real: el candidato ya está `revealed`.
      // El core lo rechazaría por el gate, así que se ejerce la RPC directamente con
      // el mismo payload — que es el escenario de un reproceso.
      await runManualReveal({ candidateId: id, phones }).catch(() => undefined);

      const afterSecond = await phoneRows(id);
      assert.equal(afterSecond.length, afterFirst.length, '0 filas canónicas nuevas');
      assert.equal(afterSecond.filter((r) => r.is_primary).length, 1, 'sigue habiendo UN principal');
      assert.equal((await sourceRows(id)).length, 2, '0 procedencias duplicadas');
    });

    it('§ 27 — dos persistencias concurrentes dejan exactamente UN principal', async () => {
      const id = await freshCandidate();

      // Dos conexiones distintas, arrancadas a la vez sobre el MISMO candidato.
      const [a, b] = await Promise.all([
        runManualReveal({
          candidateId: id,
          phones: [{ number: MOBILE, type: 'mobile' }],
          conn: () => client,
        }).catch((error: unknown) => error as RunOutcome),
        runManualReveal({
          candidateId: id,
          phones: [{ number: WORK, type: 'work' }],
          conn: () => other,
        }).catch((error: unknown) => error as RunOutcome),
      ]);

      // El lock las serializa: exactamente una gana el token de pertenencia
      // (`phone_reveal_status = no_phone_found`); la otra encuentra la fila movida.
      // Las dos devuelven `revealed` al llamador, y es correcto: el lock las serializa,
      // la primera escribe y CIERRA el candidato, y la segunda encuentra la fila ya
      // cerrada como reveal de Lusha ⇒ la función responde `idempotent`, que significa
      // «otra transacción hizo exactamente este trabajo» y no reescribe nada.
      const statuses = [a, b].map((outcome) => outcome?.result?.status);
      assert.deepEqual(statuses, ['revealed', 'revealed']);

      // LÍMITE DECLARADO, heredado de la 111 y NO introducido por 4O-F: en ese empate
      // la colección de la perdedora no se persiste. Solo es alcanzable si DOS reveals
      // pagados corren a la vez sobre el mismo candidato, cosa que el gate de
      // elegibilidad (`no_phone_found` como única puerta) hace inalcanzable en el
      // camino manual. Se afirma para que un cambio futuro de esa semántica se vea.

      const rows = await phoneRows(id);
      assert.equal(rows.filter((r) => r.is_primary).length, 1, 'invariante de principal único');
      assert.equal(
        new Set(rows.map((r) => r.dedupe_key)).size,
        rows.length,
        '0 filas canónicas duplicadas',
      );
      assert.equal(rows.length, 1, 'la perdedora no escribió: `idempotent` no reescribe');

      const candidate = await candidateRow(id);
      const primary = rows.find((r) => r.is_primary);
      assert.equal(
        candidate.phone,
        primary?.normalized_phone,
        'el escalar coincide con el principal real',
      );
      // Y una sola procedencia: la ganadora. Ninguna se duplicó por la carrera.
      assert.equal((await sourceRows(id)).length, 1);
    });
  },
);
