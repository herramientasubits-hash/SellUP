/**
 * Agente 2A — ATOMICIDAD REAL de la persistencia del reveal de Lusha
 * (AGENT2A-PHONE-REVEAL-4O-D) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Los dobles en TypeScript fijan el CONTRATO: qué se escribe, qué se devuelve,
 * cuándo se salta un tombstone. Lo que no pueden fijar es la GARANTÍA, porque no
 * tienen transacciones: en un simulador, «si el paso 3 falla el paso 1 se deshace»
 * es una afirmación que se programa, no una que se demuestra.
 *
 * Es la misma distinción que bloqueó el merge de 4O-C y que 4O-C-R1 cerró para el
 * otro proveedor. Afirmar «TRANSACCIÓN VERIFICADA» sobre mocks sería repetir el
 * error un nivel más abajo. Así que aquí la escritura ocurre contra un PostgreSQL
 * de verdad, los fallos se INYECTAN con triggers, y lo que se comprueba después es
 * el contenido real de las tablas.
 *
 * Además es el único sitio donde el MERGE ENTRE PROVEEDORES se puede demostrar de
 * verdad: la colección del otro proveedor se siembra llamando a SU función real
 * (migración 110), no insertando filas a mano, así que lo que se mide es cómo
 * conviven las dos funciones sobre las mismas tablas.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la plataforma;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`, que es lo que hace que toda
 *     tabla nueva de `public` nazca con los 8 privilegios;
 *   * `contact_enrichment_candidates` con las columnas del reveal y sus TIPOS REALES,
 *     tomados de las migraciones 068/094/095/097/098/101;
 *   * las migraciones 109, 110 y 111 TAL CUAL están en disco.
 *
 * La reproducción del candidato es mínima y deliberada: aplicar las 111 migraciones
 * desde cero no es viable (la cadena arrastra dependencias de plataforma), y los
 * arneses hermanos ya establecieron esta convención — reproducir el punto de partida
 * exacto de lo que se está probando, no el repositorio entero.
 *
 * NO llama a Lusha, ni a Apollo, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito. Todos los números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito:
 * descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio, que no necesita esta suite. Si el módulo no está resuelto, el archivo
 * se SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:lusha-phone-persistence-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete son
 * prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6, la
 * misma de Producción.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const FN = 'persist_candidate_lusha_phone_reveal_result';
const APOLLO_FN = 'persist_candidate_apollo_phone_reveal_result';
/** Código de PostgreSQL para «permiso denegado». Lo único que cuenta como rechazo. */
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
// Datos de prueba
// ═══════════════════════════════════════════════════════════════

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-08-06T10:00:00.000Z';
/** El estado que el gate exige antes de autorizar una pata de Lusha. */
const EXPECTED = 'no_phone_found';

const MOBILE = '+15550000001';
const WORK = '+15550000002';
const HQ = '+15550000004';

/** Claves de deduplicación: hashes opacos, como los produce la capa pura. */
const KEY_MOBILE = `e164:${'a'.repeat(64)}`;
const KEY_WORK = `e164:${'b'.repeat(64)}`;
const KEY_HQ = `e164:${'c'.repeat(64)}`;

/** Marcador que hace saltar el trigger de la tabla de procedencias. */
const INJECT_SOURCE_FAILURE = '__inject_failure__';

interface PhoneInput {
  dedupe_key: string;
  normalized_phone: string | null;
  display_phone: string | null;
  phone_type: string | null;
  phone_status: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface SourceInput {
  dedupe_key: string;
  provider: string;
  acquisition_mode: string;
  raw_provider_type: string | null;
  raw_provider_status: string | null;
  waterfall_run_id: string | null;
  reservation_id: string | null;
  provider_usage_log_id: string | null;
  source_event_key: string;
  observed_at: string;
}

const phone = (
  key: string,
  number: string | null,
  type: string,
  status = 'unknown',
): PhoneInput => ({
  dedupe_key: key,
  normalized_phone: number,
  display_phone: number,
  phone_type: type,
  phone_status: status,
  first_seen_at: NOW,
  last_seen_at: NOW,
});

const source = (
  key: string,
  eventKey: string,
  overrides: Partial<SourceInput> = {},
): SourceInput => ({
  dedupe_key: key,
  provider: 'lusha',
  acquisition_mode: 'reveal',
  raw_provider_type: 'mobile',
  raw_provider_status: null,
  waterfall_run_id: null,
  reservation_id: null,
  provider_usage_log_id: null,
  source_event_key: eventKey,
  observed_at: NOW,
  ...overrides,
});

interface RpcArgs {
  candidateId?: string;
  expectedStatus?: string | null;
  observedAt?: string;
  phones?: PhoneInput[];
  sources?: SourceInput[];
  primaryCandidates?: Array<{
    dedupe_key: string;
    phone: string;
    phone_type: string;
    raw_type: string | null;
  }>;
  legacyPhone?: string;
  legacyPhoneType?: string;
  legacyRawType?: string | null;
  legacyDedupeKey?: string;
  status?: string;
  provider?: string;
  requestId?: string | null;
  revealedAt?: string | null;
  completedAt?: string | null;
  revealedBy?: string | null;
  costCredits?: number | null;
  costSource?: string;
  errorCode?: string | null;
  attemptCount?: number | null;
}

describe('4O-D — atomicidad real de la persistencia del reveal de Lusha', { skip: harnessSkipReason }, () => {
  let postgres: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir = '';

  const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

  /**
   * Llama la función con notación de parámetros NOMBRADOS, igual que PostgREST. En
   * AUTOCOMMIT: una sentencia es una transacción, así que un fallo de la función
   * deshace exactamente lo que la función escribió.
   */
  async function callRpc(
    args: RpcArgs = {},
    conn: PgLikeClient = client,
  ): Promise<Record<string, unknown>> {
    const { rows } = await conn.query(
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
        args.candidateId ?? CANDIDATE_ID,
        args.expectedStatus === undefined ? EXPECTED : args.expectedStatus,
        args.observedAt ?? NOW,
        JSON.stringify(args.phones ?? [phone(KEY_MOBILE, MOBILE, 'mobile')]),
        JSON.stringify(args.sources ?? [source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:m')]),
        JSON.stringify(
          args.primaryCandidates ?? [
            { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          ],
        ),
        args.legacyPhone ?? MOBILE,
        args.legacyPhoneType ?? 'mobile',
        args.legacyRawType === undefined ? 'mobile' : args.legacyRawType,
        args.legacyDedupeKey ?? KEY_MOBILE,
        args.status ?? 'revealed',
        args.provider ?? 'lusha',
        args.requestId === undefined ? null : args.requestId,
        args.revealedAt === undefined ? NOW : args.revealedAt,
        args.completedAt === undefined ? NOW : args.completedAt,
        args.revealedBy === undefined ? ACTOR_ID : args.revealedBy,
        args.costCredits === undefined ? 5 : args.costCredits,
        args.costSource ?? 'reported',
        args.errorCode === undefined ? null : args.errorCode,
        args.attemptCount === undefined ? 2 : args.attemptCount,
      ],
    );
    return rows[0].result as Record<string, unknown>;
  }

  /**
   * Siembra una colección del OTRO proveedor llamando a SU función real. Es lo que
   * convierte «merge entre proveedores» en algo medido y no supuesto.
   */
  async function seedApollo(args: {
    phones: PhoneInput[];
    primary: { dedupe_key: string; phone: string; phone_type: string; raw_type: string | null };
    sourceKey: string;
  }): Promise<Record<string, unknown>> {
    const { rows } = await client.query(
      `SELECT public.${APOLLO_FN}(
         p_candidate_id                     => $1::uuid,
         p_expected_request_id              => NULL,
         p_reveal_phase                     => 'recovery_poll',
         p_observed_at                      => $2::timestamptz,
         p_phones                           => $3::jsonb,
         p_sources                          => $4::jsonb,
         p_primary_candidates               => $5::jsonb,
         p_legacy_phone                     => $6::text,
         p_legacy_phone_type                => $7::text,
         p_legacy_raw_type                  => $8::text,
         p_legacy_dedupe_key                => $9::text,
         p_phone_reveal_status              => 'revealed',
         p_phone_reveal_provider            => 'apollo',
         p_phone_revealed_at                => $2::timestamptz,
         p_phone_reveal_completed_at        => $2::timestamptz,
         p_phone_reveal_webhook_received_at => NULL,
         p_phone_reveal_last_checked_at     => $2::timestamptz,
         p_phone_reveal_cost_credits        => 8,
         p_phone_reveal_cost_source         => 'reported',
         p_phone_reveal_error_code          => NULL,
         p_phone_processing_basis           => NULL,
         p_apollo_person_id                 => NULL
       ) AS result`,
      [
        CANDIDATE_ID,
        NOW,
        JSON.stringify(args.phones),
        JSON.stringify([
          source(args.primary.dedupe_key, args.sourceKey, {
            provider: 'apollo',
            raw_provider_type: args.primary.raw_type,
            raw_provider_status: 'valid',
          }),
        ]),
        JSON.stringify([args.primary]),
        args.primary.phone,
        args.primary.phone_type,
        args.primary.raw_type,
        args.primary.dedupe_key,
      ],
    );
    return rows[0].result as Record<string, unknown>;
  }

  /** Estado observable: filas de teléfono, procedencias y el candidato. */
  async function snapshot(candidateId = CANDIDATE_ID) {
    const phones = await client.query(
      `SELECT dedupe_key, normalized_phone, display_phone, phone_type, phone_status,
              is_primary, suppressed_at, last_seen_at
       FROM public.contact_enrichment_candidate_phones
       WHERE candidate_id = $1 ORDER BY dedupe_key`,
      [candidateId],
    );
    const sources = await client.query(
      `SELECT s.source_event_key, s.provider, s.raw_provider_type, p.dedupe_key
       FROM public.contact_enrichment_candidate_phone_sources s
       JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
       WHERE p.candidate_id = $1 ORDER BY s.source_event_key`,
      [candidateId],
    );
    const candidate = await client.query(
      `SELECT phone, enrichment_metadata, phone_reveal_status, phone_reveal_provider,
              phone_reveal_request_id, phone_revealed_at, phone_reveal_completed_at,
              phone_revealed_by, phone_reveal_cost_credits, phone_reveal_cost_source,
              phone_reveal_error_code, phone_reveal_attempt_count
       FROM public.contact_enrichment_candidates WHERE id = $1`,
      [candidateId],
    );
    return {
      phones: phones.rows,
      sources: sources.rows,
      candidate: (candidate.rows[0] ?? null) as Record<string, unknown> | null,
    };
  }

  /** Devuelve el candidato a su estado de partida y vacía su colección. */
  async function reset(options: { status?: string; provider?: string | null } = {}) {
    await client.query(
      'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
      [CANDIDATE_ID],
    );
    await client.query(`SELECT set_config('sellup.inject', '', false)`);
    await client.query(
      `UPDATE public.contact_enrichment_candidates
          SET phone = NULL, enrichment_metadata = '{}'::jsonb,
              phone_reveal_status = $2, phone_reveal_provider = $3,
              phone_reveal_request_id = 'apollo-orphan-id',
              phone_revealed_at = NULL, phone_reveal_completed_at = NULL,
              phone_revealed_by = NULL, phone_reveal_cost_credits = NULL,
              phone_reveal_cost_source = NULL, phone_reveal_error_code = NULL,
              phone_reveal_attempt_count = 1
        WHERE id = $1`,
      [
        CANDIDATE_ID,
        options.status ?? EXPECTED,
        options.provider === undefined ? 'apollo' : options.provider,
      ],
    );
  }

  /** Inserta un tombstone para una clave, como lo dejaría una supresión. */
  async function tombstone(key: string) {
    await client.query(
      `INSERT INTO public.contact_enrichment_candidate_phones
         (candidate_id, normalized_phone, display_phone, dedupe_key, phone_type,
          phone_status, is_primary, suppressed_at, suppression_reason)
       VALUES ($1, NULL, NULL, $2, NULL, 'unknown', false, now(), 'data_subject_request')
       ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
         SET normalized_phone = NULL, display_phone = NULL, phone_type = NULL,
             is_primary = false, suppressed_at = now(),
             suppression_reason = 'data_subject_request'`,
      [CANDIDATE_ID, key],
    );
  }

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-4od-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54398,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();

    // ── Los tres roles de Supabase y sus default privileges ──────
    await client.query(`DO $$ BEGIN
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END $$;`);
    await client.query(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // ── set_updated_at (migración 038), que la 109 reutiliza ─────
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at := now(); RETURN NEW; END $$;`);

    // ── El candidato, con los TIPOS REALES de sus columnas ───────
    await client.query(`
      CREATE TABLE public.contact_enrichment_candidates (
        id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
      -- Las tres tablas de contabilidad, solo por sus FK: la 109 apunta a ellas y ni la
      -- 110 ni la 111 escriben en ninguna, que es precisamente lo que se comprueba.
      CREATE TABLE public.phone_reveal_waterfall_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.phone_reveal_credit_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.provider_usage_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);

    await client.query(readMigration('109_contact_enrichment_candidate_phones.sql'));
    await client.query(
      readMigration('110_persist_candidate_apollo_phone_reveal_result.sql'),
    );
    await client.query(
      readMigration('111_persist_candidate_lusha_phone_reveal_result.sql'),
    );

    // ── Inyectores de fallo: inertes salvo activación explícita ──
    await client.query(`
      CREATE FUNCTION test_inject_source_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.raw_provider_status = '${INJECT_SOURCE_FAILURE}' THEN
          RAISE EXCEPTION 'injected failure: provenance insert';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER test_inject_source_failure
        BEFORE INSERT ON public.contact_enrichment_candidate_phone_sources
        FOR EACH ROW EXECUTE FUNCTION test_inject_source_failure();

      CREATE FUNCTION test_inject_primary_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('sellup.inject', true) = 'primary' AND NEW.is_primary THEN
          RAISE EXCEPTION 'injected failure: primary promotion';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER test_inject_primary_failure
        BEFORE UPDATE ON public.contact_enrichment_candidate_phones
        FOR EACH ROW EXECUTE FUNCTION test_inject_primary_failure();

      CREATE FUNCTION test_inject_candidate_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('sellup.inject', true) = 'candidate' THEN
          RAISE EXCEPTION 'injected failure: candidate terminal update';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER test_inject_candidate_failure
        BEFORE UPDATE ON public.contact_enrichment_candidates
        FOR EACH ROW EXECUTE FUNCTION test_inject_candidate_failure();`);

    await client.query(
      `INSERT INTO public.contact_enrichment_candidates
         (id, phone_reveal_status, phone_reveal_provider, phone_reveal_request_id)
       VALUES ($1, $2, 'apollo', 'apollo-orphan-id')`,
      [CANDIDATE_ID, EXPECTED],
    );
  });

  after(async () => {
    if (client) await client.end().catch(() => {});
    if (postgres) await postgres.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ═════════════════════════════════════════════════════════════
  // 1. Camino feliz
  // ═════════════════════════════════════════════════════════════

  describe('persistencia completa', () => {
    it('N teléfonos: colección, procedencias, principal y estado terminal', async () => {
      await reset();
      const result = await callRpc({
        phones: [
          phone(KEY_WORK, WORK, 'work'),
          phone(KEY_MOBILE, MOBILE, 'mobile'),
          phone(KEY_HQ, HQ, 'hq'),
        ],
        sources: [
          source(KEY_WORK, 'v1:lusha:reveal:direct_enrich:-:-:-:t=work', {
            raw_provider_type: 'work',
          }),
          source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:-:-:-:t=mobile'),
          source(KEY_HQ, 'v1:lusha:reveal:direct_enrich:-:-:-:t=hq', {
            raw_provider_type: 'hq',
          }),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
          { dedupe_key: KEY_HQ, phone: HQ, phone_type: 'hq', raw_type: 'hq' },
        ],
      });

      assert.equal(result.status, 'persisted');
      assert.equal(result.inserted_phone_count, 3);
      assert.equal(result.inserted_source_count, 3);
      assert.equal(result.primary_dedupe_key, KEY_MOBILE);
      assert.equal(result.primary_set, true);
      assert.equal(result.candidate_scalar_updated, true);
      assert.equal(result.candidate_terminalized, true);

      const state = await snapshot();
      assert.equal(state.phones.length, 3);
      assert.equal(state.sources.length, 3);
      const primaries = state.phones.filter((row) => row.is_primary);
      assert.equal(primaries.length, 1);
      assert.equal(primaries[0].dedupe_key, KEY_MOBILE);

      assert.equal(state.candidate!.phone, MOBILE);
      assert.deepEqual(
        (state.candidate!.enrichment_metadata as Record<string, unknown>).phone,
        { number: MOBILE, type: 'mobile', source: 'lusha_reveal', raw_type: 'mobile' },
      );
      assert.equal(state.candidate!.phone_reveal_status, 'revealed');
      assert.equal(state.candidate!.phone_reveal_provider, 'lusha');
      assert.equal(state.candidate!.phone_reveal_cost_credits, 5);
      assert.equal(state.candidate!.phone_revealed_by, ACTOR_ID);
      assert.equal(state.candidate!.phone_reveal_attempt_count, 2);
      assert.equal(state.candidate!.phone_reveal_error_code, null);
    });

    it('el request id del intento anterior queda LIMPIO, no conviviendo con lusha', async () => {
      await reset();
      await callRpc();
      const state = await snapshot();
      assert.equal(state.candidate!.phone_reveal_request_id, null);
      assert.equal(state.candidate!.phone_reveal_provider, 'lusha');
    });

    it('el mismo número con dos tipos: 1 fila canónica y 2 procedencias', async () => {
      await reset();
      const result = await callRpc({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile')],
        sources: [
          source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:-:-:-:t=mobile'),
          source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:-:-:-:t=work', {
            raw_provider_type: 'work',
          }),
        ],
      });
      assert.equal(result.inserted_phone_count, 1);
      assert.equal(result.inserted_source_count, 2);

      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.deepEqual(
        state.sources.map((s) => s.raw_provider_type).sort(),
        ['mobile', 'work'],
      );
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 2. Rollback: los tres puntos de fallo
  // ═════════════════════════════════════════════════════════════

  describe('rollback total ante un fallo inyectado', () => {
    it('fallo insertando una procedencia ⇒ 0 teléfonos, 0 fuentes, candidato intacto', async () => {
      await reset();
      await assert.rejects(
        callRpc({
          phones: [phone(KEY_WORK, WORK, 'work'), phone(KEY_MOBILE, MOBILE, 'mobile')],
          sources: [
            source(KEY_WORK, 'v1:lusha:reveal:direct_enrich:w', { raw_provider_type: 'work' }),
            source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:m', {
              raw_provider_status: INJECT_SOURCE_FAILURE,
            }),
          ],
        }),
        /injected failure: provenance insert/,
      );

      const state = await snapshot();
      assert.equal(state.phones.length, 0, 'ninguna fila canónica debe sobrevivir');
      assert.equal(state.sources.length, 0);
      assert.equal(state.candidate!.phone, null);
      assert.equal(state.candidate!.phone_reveal_status, EXPECTED);
      assert.equal(state.candidate!.phone_reveal_provider, 'apollo');
    });

    it('fallo promoviendo el principal ⇒ rollback total', async () => {
      await reset();
      await client.query(`SELECT set_config('sellup.inject', 'primary', false)`);
      await assert.rejects(callRpc(), /injected failure: primary promotion/);

      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.sources.length, 0);
      assert.equal(state.candidate!.phone_reveal_status, EXPECTED);
    });

    it('fallo actualizando el candidato ⇒ rollback total', async () => {
      await reset();
      await client.query(`SELECT set_config('sellup.inject', 'candidate', false)`);
      await assert.rejects(callRpc(), /injected failure: candidate terminal update/);

      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.sources.length, 0);
      assert.equal(state.candidate!.phone, null);
      assert.equal(state.candidate!.phone_reveal_status, EXPECTED);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 3. Tombstones
  // ═════════════════════════════════════════════════════════════

  describe('tombstones', () => {
    it('un número suprimido no resucita: sin fila, sin procedencia, sin principal', async () => {
      await reset();
      await tombstone(KEY_MOBILE);
      const result = await callRpc({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile'), phone(KEY_WORK, WORK, 'work')],
        sources: [
          source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:m'),
          source(KEY_WORK, 'v1:lusha:reveal:direct_enrich:w', { raw_provider_type: 'work' }),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
        ],
        legacyPhone: WORK,
        legacyPhoneType: 'work',
        legacyRawType: 'work',
        legacyDedupeKey: KEY_WORK,
      });

      assert.equal(result.status, 'persisted');
      assert.equal(result.suppressed_skipped_count, 1);
      assert.equal(result.primary_dedupe_key, KEY_WORK);

      const state = await snapshot();
      const suppressed = state.phones.find((row) => row.dedupe_key === KEY_MOBILE);
      assert.ok(suppressed);
      assert.equal(suppressed!.normalized_phone, null, 'el tombstone no recupera el número');
      assert.equal(suppressed!.is_primary, false);
      assert.equal(
        state.sources.filter((s) => s.dedupe_key === KEY_MOBILE).length,
        0,
        'un tombstone no gana procedencia',
      );
      assert.equal(state.candidate!.phone, WORK);
    });

    it('todo suprimido y sin principal vivo ⇒ suppressed, sin terminalizar', async () => {
      await reset();
      await tombstone(KEY_MOBILE);
      const result = await callRpc({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile')],
        sources: [source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:m')],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
        ],
      });

      assert.equal(result.status, 'suppressed');
      assert.equal(result.candidate_terminalized, false);
      assert.equal(result.candidate_scalar_updated, false);

      const state = await snapshot();
      assert.equal(state.candidate!.phone, null);
      assert.equal(state.candidate!.phone_reveal_status, EXPECTED);
      assert.equal(state.sources.length, 0);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 4. Merge entre proveedores — sembrado con la función REAL del otro
  // ═════════════════════════════════════════════════════════════

  describe('merge entre proveedores', () => {
    // La colección del otro proveedor se siembra con SU función real, y por tanto
    // desde un candidato EN VUELO: la migración 110 rechaza, correctamente, un
    // candidato que ya está en un estado terminal. Tras sembrar, el candidato queda
    // `revealed`, y ese es el token de pertenencia que la pata de Lusha declara.
    //
    // ALCANCE HONESTO: el gate de elegibilidad de hoy exige `no_phone_found` y
    // ningún teléfono previo, así que esta secuencia no es alcanzable por las dos
    // rutas cableadas. Se prueba igualmente porque es el invariante que el modelo de
    // datos debe: un gate es un gate, no una garantía sobre lo que hay en la tabla.
    it('mismo número en los dos proveedores ⇒ 1 fila canónica y 2 procedencias', async () => {
      await reset({ status: 'in_flight' });
      const seeded = await seedApollo({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile', 'valid')],
        primary: {
          dedupe_key: KEY_MOBILE,
          phone: MOBILE,
          phone_type: 'mobile',
          raw_type: 'mobile',
        },
        sourceKey: 'apollo:reveal:recovery:m',
      });
      assert.equal(seeded.status, 'persisted');

      const result = await callRpc({ expectedStatus: 'revealed' });
      assert.equal(result.status, 'persisted');
      assert.equal(result.inserted_phone_count, 0);
      assert.equal(result.updated_phone_count, 1);
      assert.equal(result.inserted_source_count, 1);

      const state = await snapshot();
      assert.equal(state.phones.length, 1, 'un solo teléfono canónico');
      assert.equal(state.sources.length, 2, 'dos procedencias, una por proveedor');
      assert.deepEqual(state.sources.map((s) => s.provider).sort(), ['apollo', 'lusha']);
      // El estado `valid` que afirmó el otro proveedor NO se degrada a `unknown`.
      assert.equal(state.phones[0].phone_status, 'valid');
    });

    it('el móvil ya existente GANA a un work nuevo de Lusha', async () => {
      await reset({ status: 'in_flight' });
      await seedApollo({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile', 'valid')],
        primary: {
          dedupe_key: KEY_MOBILE,
          phone: MOBILE,
          phone_type: 'mobile',
          raw_type: 'mobile',
        },
        sourceKey: 'apollo:reveal:recovery:m',
      });

      const result = await callRpc({
        expectedStatus: 'revealed',
        phones: [phone(KEY_WORK, WORK, 'work')],
        sources: [
          source(KEY_WORK, 'v1:lusha:reveal:direct_enrich:w', { raw_provider_type: 'work' }),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
        ],
        legacyPhone: WORK,
        legacyPhoneType: 'work',
        legacyRawType: 'work',
        legacyDedupeKey: KEY_WORK,
      });

      assert.equal(result.status, 'persisted');
      assert.equal(result.primary_dedupe_key, KEY_MOBILE, 'el móvil conserva el principal');
      assert.equal(result.candidate_scalar_updated, false);

      const state = await snapshot();
      assert.equal(state.phones.length, 2, 'el work SÍ se guarda, aunque no sea principal');
      assert.equal(
        state.phones.filter((row) => row.is_primary)[0].dedupe_key,
        KEY_MOBILE,
      );
      // El teléfono visible NO empeora, y su procedencia no se relabela.
      assert.equal(state.candidate!.phone, MOBILE);
      assert.equal(
        (state.candidate!.enrichment_metadata as Record<string, { source?: string }>).phone
          ?.source,
        'apollo_reveal',
      );
      // La operación SÍ queda registrada como de Lusha: es lo que ocurrió.
      assert.equal(state.candidate!.phone_reveal_provider, 'lusha');
      assert.equal(state.candidate!.phone_reveal_cost_credits, 5);
    });

    it('un móvil nuevo de Lusha GANA a un work ya existente', async () => {
      await reset({ status: 'in_flight' });
      await seedApollo({
        phones: [phone(KEY_WORK, WORK, 'work', 'valid')],
        primary: { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
        sourceKey: 'apollo:reveal:recovery:w',
      });

      const result = await callRpc({ expectedStatus: 'revealed' });

      assert.equal(result.primary_dedupe_key, KEY_MOBILE);
      assert.equal(result.candidate_scalar_updated, true);

      const state = await snapshot();
      assert.equal(state.phones.filter((row) => row.is_primary).length, 1);
      assert.equal(state.candidate!.phone, MOBILE);
      assert.equal(
        (state.candidate!.enrichment_metadata as Record<string, { source?: string }>).phone
          ?.source,
        'lusha_reveal',
      );
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 5. Idempotencia, pertenencia y concurrencia
  // ═════════════════════════════════════════════════════════════

  describe('idempotencia y pertenencia', () => {
    it('repetir la misma respuesta no duplica filas ni procedencias', async () => {
      await reset();
      await callRpc();
      const first = await snapshot();

      const second = await callRpc({ expectedStatus: 'revealed' });
      assert.equal(second.status, 'idempotent');
      assert.equal(second.inserted_phone_count, 0);
      assert.equal(second.inserted_source_count, 0);
      assert.equal(second.candidate_terminalized, true);

      const after = await snapshot();
      assert.equal(after.phones.length, first.phones.length);
      assert.equal(after.sources.length, first.sources.length);
    });

    it('el candidato ya no está en el estado que autorizó la pata ⇒ stale_event', async () => {
      await reset({ status: 'in_flight', provider: 'apollo' });
      const result = await callRpc();
      assert.equal(result.status, 'stale_event');

      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.candidate!.phone_reveal_status, 'in_flight');
    });

    it('candidato inexistente ⇒ candidate_not_eligible y 0 escrituras', async () => {
      const result = await callRpc({
        candidateId: '99999999-9999-4999-8999-999999999999',
      });
      assert.equal(result.status, 'candidate_not_eligible');
    });

    it('dos conexiones concurrentes ⇒ un solo principal y un estado coherente', async () => {
      await reset();
      const other = postgres.getPgClient();
      await other.connect();
      try {
        const [a, b] = await Promise.all([
          callRpc({}, client),
          callRpc({ expectedStatus: EXPECTED }, other),
        ]);
        const statuses = [a.status, b.status].sort();
        // Una escribe y la otra reconoce que el trabajo ya está hecho, o la pierde por
        // estado: lo que NO puede pasar es que las dos escriban.
        assert.ok(
          statuses.includes('persisted'),
          `alguna debe persistir, fueron ${statuses.join(',')}`,
        );
        assert.ok(
          statuses.includes('idempotent') || statuses.includes('stale_event'),
          `la otra no debe volver a escribir, fueron ${statuses.join(',')}`,
        );

        const state = await snapshot();
        assert.equal(state.phones.filter((row) => row.is_primary).length, 1);
        assert.equal(state.phones.length, 1);
        assert.equal(state.sources.length, 1, 'la procedencia no se duplica');
        assert.equal(state.candidate!.phone_reveal_status, 'revealed');
      } finally {
        await other.end().catch(() => {});
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 6. Validación de entrada y contabilidad
  // ═════════════════════════════════════════════════════════════

  describe('validación fail-closed', () => {
    const REJECTIONS: ReadonlyArray<[string, RpcArgs, string]> = [
      ['status distinto de revealed', { status: 'no_phone_found' }, 'status_not_revealed'],
      ['proveedor distinto de lusha', { provider: 'apollo' }, 'provider_not_lusha'],
      ['código de error junto al éxito', { errorCode: 'boom' }, 'error_code_not_null'],
      ['cost_source fuera del vocabulario', { costSource: 'guessed' }, 'cost_source_unknown'],
      ['sin token de pertenencia', { expectedStatus: null }, 'expected_status_missing'],
      ['sin actor', { revealedBy: null }, 'revealed_by_missing'],
      ['intento por debajo de 1', { attemptCount: 0 }, 'attempt_count_invalid'],
      ['sin escalar heredado', { legacyPhone: '  ' }, 'legacy_phone_missing'],
      ['sin clave heredada', { legacyDedupeKey: '' }, 'legacy_dedupe_key_missing'],
      ['colección vacía', { phones: [] }, 'phones_empty'],
    ];

    for (const [label, args, detail] of REJECTIONS) {
      it(`${label} ⇒ invalid_input (${detail}), sin escribir nada`, async () => {
        await reset();
        const result = await callRpc(args);
        assert.equal(result.status, 'invalid_input');
        assert.equal(result.detail, detail);
        const state = await snapshot();
        assert.equal(state.phones.length, 0);
        assert.equal(state.candidate!.phone_reveal_status, EXPECTED);
      });
    }

    it('procedencia de otro proveedor ⇒ rechazada: esta función es la de Lusha', async () => {
      await reset();
      const result = await callRpc({
        sources: [source(KEY_MOBILE, 'x', { provider: 'apollo' })],
      });
      assert.equal(result.status, 'invalid_input');
      assert.equal(result.detail, 'source_row_invalid');
    });

    it('una clave preferida que no está en la colección ⇒ rechazada', async () => {
      await reset();
      const result = await callRpc({
        primaryCandidates: [
          { dedupe_key: KEY_HQ, phone: HQ, phone_type: 'hq', raw_type: 'hq' },
        ],
      });
      assert.equal(result.status, 'invalid_input');
      assert.equal(result.detail, 'primary_candidate_orphan');
    });

    it('una clave duplicada en la colección ⇒ rechazada', async () => {
      await reset();
      const result = await callRpc({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile'), phone(KEY_MOBILE, MOBILE, 'work')],
      });
      assert.equal(result.status, 'invalid_input');
      assert.equal(result.detail, 'phone_key_duplicated');
    });
  });

  describe('contabilidad', () => {
    it('3 teléfonos con billing 5 ⇒ 5 créditos, no 15', async () => {
      await reset();
      await callRpc({
        phones: [
          phone(KEY_MOBILE, MOBILE, 'mobile'),
          phone(KEY_WORK, WORK, 'work'),
          phone(KEY_HQ, HQ, 'hq'),
        ],
        sources: [
          source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:m'),
          source(KEY_WORK, 'v1:lusha:reveal:direct_enrich:w', { raw_provider_type: 'work' }),
          source(KEY_HQ, 'v1:lusha:reveal:direct_enrich:h', { raw_provider_type: 'hq' }),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
        ],
        costCredits: 5,
      });
      const state = await snapshot();
      assert.equal(state.candidate!.phone_reveal_cost_credits, 5);
    });

    it('la función NO escribe usage log, reserva ni corrida', async () => {
      await reset();
      await callRpc();
      for (const table of [
        'provider_usage_logs',
        'phone_reveal_credit_reservations',
        'phone_reveal_waterfall_runs',
      ]) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM public.${table}`);
        assert.equal(rows[0].n, 0, `${table} debe seguir vacía`);
      }
    });

    it('ninguna fila canónica tiene columna de costo', async () => {
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'contact_enrichment_candidate_phones'`,
      );
      const names = rows.map((row) => row.column_name as string);
      assert.equal(names.some((name) => /credit|cost/i.test(name)), false);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 7. Privacidad y privilegios
  // ═════════════════════════════════════════════════════════════

  describe('privacidad y privilegios', () => {
    it('la respuesta nunca contiene un número', async () => {
      await reset();
      const result = await callRpc({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile'), phone(KEY_WORK, WORK, 'work')],
        sources: [
          source(KEY_MOBILE, 'v1:lusha:reveal:direct_enrich:m'),
          source(KEY_WORK, 'v1:lusha:reveal:direct_enrich:w', { raw_provider_type: 'work' }),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
        ],
      });
      const serialized = JSON.stringify(result);
      for (const secret of [MOBILE, WORK, '5550000001', '5550000002']) {
        assert.equal(serialized.includes(secret), false, `filtró ${secret}`);
      }
    });

    it('anon y authenticated no pueden ejecutarla', async () => {
      for (const role of ['anon', 'authenticated']) {
        await client.query(`SET ROLE ${role}`);
        try {
          await callRpc();
          assert.fail(`${role} no debería poder ejecutar ${FN}`);
        } catch (error) {
          const code = (error as { code?: string }).code;
          assert.equal(code, INSUFFICIENT_PRIVILEGE, `${role} debe recibir 42501`);
        } finally {
          await client.query('RESET ROLE');
        }
      }
    });

    it('service_role sí puede ejecutarla', async () => {
      await reset();
      await client.query('SET ROLE service_role');
      try {
        const result = await callRpc();
        assert.equal(result.status, 'persisted');
      } finally {
        await client.query('RESET ROLE');
      }
    });

    it('es SECURITY INVOKER y con search_path fijado, según el catálogo', async () => {
      const { rows } = await client.query(
        `SELECT p.prosecdef, p.proconfig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`,
        [FN],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].prosecdef, false, 'debe ser INVOKER');
      assert.deepEqual(rows[0].proconfig, ['search_path=pg_catalog, pg_temp']);
    });
  });
});
