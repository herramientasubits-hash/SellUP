/**
 * Agente 2A — ATOMICIDAD REAL de la persistencia del reveal Apollo
 * (AGENT2A-PHONE-REVEAL-4O-C-R1) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * `candidate-phone-collection-fake-store.ts` fija el CONTRATO: qué se escribe, qué
 * se devuelve, cuándo se salta un tombstone. Lo que no puede fijar es la
 * GARANTÍA, porque es un simulador en TypeScript y no tiene transacciones: en un
 * doble, «si el paso 3 falla el paso 1 se deshace» es una afirmación que se
 * programa, no una que se demuestra.
 *
 * Esa distinción es justo la que este hito tenía que cerrar. 4O-C escribía en
 * secuencia y argumentaba que el retry convergía; el bloqueo de merge fue que
 * convergencia no es atomicidad. Afirmar «TRANSACCIÓN VERIFICADA» sobre mocks
 * sería repetir el mismo error un nivel más abajo. Así que aquí la escritura
 * ocurre contra un PostgreSQL de verdad, los fallos se INYECTAN con triggers, y
 * lo que se comprueba después es el contenido real de las tablas.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la
 *     plataforma;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`, que es lo que hace que
 *     toda tabla nueva de `public` nazca con los 8 privilegios;
 *   * `contact_enrichment_candidates` con las columnas del reveal y sus TIPOS
 *     REALES (`phone_reveal_cost_credits integer`, `enrichment_metadata jsonb NOT
 *     NULL DEFAULT '{}'`, …), tomados de las migraciones 068/094/095/097/098/101;
 *   * las migraciones 109 y 110 TAL CUAL están en disco.
 *
 * La reproducción del candidato es mínima y deliberada: aplicar las 110
 * migraciones desde cero no es viable (la cadena arrastra dependencias de
 * plataforma), y el arnés hermano `phone-reveal-table-grants-postgres.test.ts` ya
 * estableció esta convención — reproducir el punto de partida exacto de lo que se
 * está probando, no el repositorio entero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * INYECCIÓN DE FALLOS
 * ═══════════════════════════════════════════════════════════════════
 *
 * Tres triggers, creados una vez y INERTES salvo que la prueba los active (por un
 * marcador en el payload o por un GUC de sesión). No modifican la migración: son
 * el equivalente a desenchufar un cable para comprobar que el fusible salta.
 *
 * Cada llamada a la RPC se hace en AUTOCOMMIT, es decir una sentencia = una
 * transacción, que es exactamente cómo PostgREST la ejecuta en Producción. Si la
 * función lanza, PostgreSQL deshace la transacción entera; que ese deshacer sea
 * completo es lo que estas pruebas miden.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción
 * ni ninguna base remota; no gasta un crédito. Todos los números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito:
 * descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio, que no necesita esta suite. Si el módulo no está resuelto, el
 * archivo se SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:phone-reveal-persistence-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` que documentan las suites anteriores NO
 * resuelve: todas las versiones del paquete son prerelease y semver no las casa.
 * La versión exacta de arriba es la serie 17.6, la misma de Producción.
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

const FN = 'persist_candidate_apollo_phone_reveal_result';
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

/**
 * Resolución SÍNCRONA con `createRequire`: este archivo se transpila a CJS, donde
 * un `await` de nivel superior no compila, y la razón del skip tiene que estar
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
// Datos de prueba
// ═══════════════════════════════════════════════════════════════

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CANDIDATE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = 'apollo-req-4ocr1';
const NOW = '2026-08-06T10:00:00.000Z';

const MOBILE = '+15550000001';
const WORK = '+15550000003';
/** Claves de deduplicación: hashes opacos, como los produce la 4O-B. */
const KEY_MOBILE = `e164:${'a'.repeat(64)}`;
const KEY_WORK = `e164:${'b'.repeat(64)}`;

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
  number: string,
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
  provider: 'apollo',
  acquisition_mode: 'reveal',
  raw_provider_type: 'mobile',
  raw_provider_status: 'valid',
  waterfall_run_id: null,
  reservation_id: null,
  provider_usage_log_id: null,
  source_event_key: eventKey,
  observed_at: NOW,
  ...overrides,
});

interface RpcArgs {
  candidateId?: string;
  expectedRequestId?: string | null;
  phase?: string;
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
  revealedAt?: string | null;
  completedAt?: string | null;
  webhookReceivedAt?: string | null;
  lastCheckedAt?: string | null;
  costCredits?: number | null;
  costSource?: string;
  errorCode?: string | null;
  processingBasis?: string | null;
  apolloPersonId?: string | null;
}

describe('4O-C-R1 — atomicidad real de la persistencia del reveal', { skip: harnessSkipReason }, () => {
  let postgres: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir = '';

  const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

  /**
   * Llama la función con notación de parámetros NOMBRADOS, igual que PostgREST.
   * En AUTOCOMMIT: una sentencia es una transacción, así que un fallo de la
   * función deshace exactamente lo que la función escribió.
   */
  async function callRpc(
    args: RpcArgs = {},
    conn: PgLikeClient = client,
  ): Promise<Record<string, unknown>> {
    const { rows } = await conn.query(
      `SELECT public.${FN}(
         p_candidate_id                     => $1::uuid,
         p_expected_request_id              => $2::text,
         p_reveal_phase                     => $3::text,
         p_observed_at                      => $4::timestamptz,
         p_phones                           => $5::jsonb,
         p_sources                          => $6::jsonb,
         p_primary_candidates               => $7::jsonb,
         p_legacy_phone                     => $8::text,
         p_legacy_phone_type                => $9::text,
         p_legacy_raw_type                  => $10::text,
         p_legacy_dedupe_key                => $11::text,
         p_phone_reveal_status              => $12::text,
         p_phone_reveal_provider            => $13::text,
         p_phone_revealed_at                => $14::timestamptz,
         p_phone_reveal_completed_at        => $15::timestamptz,
         p_phone_reveal_webhook_received_at => $16::timestamptz,
         p_phone_reveal_last_checked_at     => $17::timestamptz,
         p_phone_reveal_cost_credits        => $18::integer,
         p_phone_reveal_cost_source         => $19::text,
         p_phone_reveal_error_code          => $20::text,
         p_phone_processing_basis           => $21::text,
         p_apollo_person_id                 => $22::text
       ) AS result`,
      [
        args.candidateId ?? CANDIDATE_ID,
        args.expectedRequestId === undefined ? REQUEST_ID : args.expectedRequestId,
        args.phase ?? 'webhook',
        args.observedAt ?? NOW,
        JSON.stringify(args.phones ?? [phone(KEY_MOBILE, MOBILE, 'mobile')]),
        JSON.stringify(args.sources ?? [source(KEY_MOBILE, 'apollo:reveal:webhook:1')]),
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
        args.provider ?? 'apollo',
        args.revealedAt === undefined ? NOW : args.revealedAt,
        args.completedAt === undefined ? NOW : args.completedAt,
        args.webhookReceivedAt === undefined ? NOW : args.webhookReceivedAt,
        args.lastCheckedAt === undefined ? null : args.lastCheckedAt,
        args.costCredits === undefined ? 8 : args.costCredits,
        args.costSource ?? 'reported',
        args.errorCode === undefined ? null : args.errorCode,
        args.processingBasis === undefined ? null : args.processingBasis,
        args.apolloPersonId === undefined ? null : args.apolloPersonId,
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
      `SELECT s.source_event_key, s.raw_provider_type, p.dedupe_key
       FROM public.contact_enrichment_candidate_phone_sources s
       JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
       WHERE p.candidate_id = $1 ORDER BY s.source_event_key`,
      [candidateId],
    );
    const candidate = await client.query(
      `SELECT phone, enrichment_metadata, phone_reveal_status, phone_reveal_provider,
              phone_revealed_at, phone_reveal_completed_at,
              phone_reveal_webhook_received_at, phone_reveal_last_checked_at,
              phone_reveal_cost_credits, phone_reveal_cost_source,
              phone_reveal_error_code, phone_processing_basis, apollo_person_id,
              phone_reveal_attempt_count
       FROM public.contact_enrichment_candidates WHERE id = $1`,
      [candidateId],
    );
    return {
      phones: phones.rows,
      sources: sources.rows,
      candidate: (candidate.rows[0] ?? null) as Record<string, unknown> | null,
    };
  }

  /** Devuelve el candidato bajo prueba a «en vuelo» y vacía su colección. */
  async function reset(options: { status?: string; requestId?: string | null } = {}) {
    await client.query(
      'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
      [CANDIDATE_ID],
    );
    await client.query(`SELECT set_config('sellup.inject', '', false)`);
    await client.query(
      `UPDATE public.contact_enrichment_candidates
          SET phone = NULL, enrichment_metadata = '{}'::jsonb,
              phone_reveal_status = $2, phone_reveal_request_id = $3,
              phone_reveal_provider = NULL, phone_revealed_at = NULL,
              phone_reveal_completed_at = NULL, phone_reveal_webhook_received_at = NULL,
              phone_reveal_last_checked_at = NULL, phone_reveal_cost_credits = NULL,
              phone_reveal_cost_source = NULL, phone_reveal_error_code = NULL,
              phone_processing_basis = NULL, apollo_person_id = NULL
        WHERE id = $1`,
      [
        CANDIDATE_ID,
        options.status ?? 'pending',
        options.requestId === undefined ? REQUEST_ID : options.requestId,
      ],
    );
  }

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-4ocr1-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54397,
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
      -- Las tres tablas de contabilidad, solo por sus FK: la 109 apunta a ellas y
      -- la 110 NO escribe en ninguna, que es precisamente lo que se comprueba.
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
      `INSERT INTO public.contact_enrichment_candidates (id, phone_reveal_status, phone_reveal_request_id)
       VALUES ($1, 'pending', $2), ($3, 'pending', $2)`,
      [CANDIDATE_ID, REQUEST_ID, OTHER_CANDIDATE_ID],
    );
  });

  after(async () => {
    if (client) await client.end().catch(() => {});
    if (postgres) await postgres.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ═════════════════════════════════════════════════════════════
  // 1. Camino feliz: las cuatro escrituras, en una transacción
  // ═════════════════════════════════════════════════════════════

  describe('persistencia completa', () => {
    it('webhook: colección, procedencias, principal y estado terminal', async () => {
      await reset();
      const result = await callRpc({
        phones: [
          phone(KEY_WORK, WORK, 'work'),
          phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'),
        ],
        sources: [
          source(KEY_WORK, 'apollo:reveal:webhook:w', { raw_provider_type: 'work' }),
          source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
        ],
        apolloPersonId: '0123456789abcdef01234567',
      });

      assert.equal(result.status, 'persisted');
      assert.equal(result.inserted_phone_count, 2);
      assert.equal(result.updated_phone_count, 0);
      assert.equal(result.inserted_source_count, 2);
      assert.equal(result.suppressed_skipped_count, 0);
      assert.equal(result.primary_dedupe_key, KEY_MOBILE);
      assert.equal(result.primary_set, true);
      assert.equal(result.candidate_terminalized, true);

      const state = await snapshot();
      assert.equal(state.phones.length, 2);
      assert.equal(state.sources.length, 2);
      // Exactamente UN principal, y es el móvil.
      const primaries = state.phones.filter((row) => row.is_primary);
      assert.equal(primaries.length, 1);
      assert.equal(primaries[0].dedupe_key, KEY_MOBILE);

      // El escalar es EL número del principal, no otro.
      assert.equal(state.candidate!.phone, MOBILE);
      assert.deepEqual(
        (state.candidate!.enrichment_metadata as Record<string, unknown>).phone,
        { number: MOBILE, type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
      );
      assert.equal(state.candidate!.phone_reveal_status, 'revealed');
      assert.equal(state.candidate!.phone_reveal_provider, 'apollo');
      assert.equal(state.candidate!.phone_reveal_cost_credits, 8);
      assert.equal(state.candidate!.phone_reveal_cost_source, 'reported');
      assert.equal(state.candidate!.phone_reveal_error_code, null);
      assert.equal(state.candidate!.apollo_person_id, '0123456789abcdef01234567');
      // Fase webhook: sella el callback y NO el poll.
      assert.notEqual(state.candidate!.phone_reveal_webhook_received_at, null);
      assert.equal(state.candidate!.phone_reveal_last_checked_at, null);
      // Campos que el camino `revealed` NUNCA ha escrito siguen intactos.
      assert.equal(state.candidate!.phone_reveal_attempt_count, 0);
    });

    it('recovery: sella el poll y NO el callback, y conserva la base de tratamiento', async () => {
      await reset();
      const result = await callRpc({
        phase: 'recovery_poll',
        // El id de recuperación no vive en el candidato: la guarda es el estado.
        expectedRequestId: null,
        webhookReceivedAt: null,
        lastCheckedAt: NOW,
        processingBasis: 'legitimate_interest_b2b',
        costCredits: null,
        costSource: 'unknown',
      });
      assert.equal(result.status, 'persisted');

      const state = await snapshot();
      assert.equal(state.candidate!.phone_reveal_webhook_received_at, null);
      assert.notEqual(state.candidate!.phone_reveal_last_checked_at, null);
      assert.equal(state.candidate!.phone_processing_basis, 'legitimate_interest_b2b');
      // null NO es «no reportado sin más»: la procedencia lo declara.
      assert.equal(state.candidate!.phone_reveal_cost_credits, null);
      assert.equal(state.candidate!.phone_reveal_cost_source, 'unknown');
    });

    it('el candidato de al lado NO se toca', async () => {
      await reset();
      await callRpc();
      const other = await snapshot(OTHER_CANDIDATE_ID);
      assert.equal(other.phones.length, 0);
      assert.equal(other.candidate!.phone, null);
      assert.equal(other.candidate!.phone_reveal_status, 'pending');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 2. ROLLBACK: lo que este hito tenía que demostrar
  // ═════════════════════════════════════════════════════════════

  describe('rollback: o se escribe todo, o no se escribe nada', () => {
    /** El estado prohibido, comprobado como una sola afirmación reutilizable. */
    async function assertNothingWritten() {
      const state = await snapshot();
      assert.equal(state.phones.length, 0, '0 filas canónicas');
      assert.equal(state.sources.length, 0, '0 procedencias');
      assert.equal(state.candidate!.phone, null, 'sin escalar');
      assert.equal(state.candidate!.phone_reveal_status, 'pending', 'sin terminalizar');
      assert.equal(state.candidate!.phone_revealed_at, null);
      assert.deepEqual(state.candidate!.enrichment_metadata, {});
    }

    it('falla la SEGUNDA procedencia ⇒ se deshace la primera, los teléfonos y el candidato', async () => {
      await reset();
      await assert.rejects(
        callRpc({
          phones: [
            phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'),
            phone(KEY_WORK, WORK, 'work'),
          ],
          sources: [
            // La primera entra sin problema…
            source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
            // …y la segunda hace saltar el trigger.
            source(KEY_WORK, 'apollo:reveal:webhook:w', {
              raw_provider_status: INJECT_SOURCE_FAILURE,
            }),
          ],
        }),
        /injected failure: provenance insert/,
      );
      // Sin la transacción, aquí quedaría 1 teléfono con 1 procedencia y ningún
      // estado terminal: exactamente la persistencia parcial de 4O-C.
      await assertNothingWritten();
    });

    it('falla el UPDATE del candidato ⇒ se deshacen colección y procedencias', async () => {
      await reset();
      await client.query(`SELECT set_config('sellup.inject', 'candidate', false)`);
      await assert.rejects(
        callRpc({
          phones: [
            phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'),
            phone(KEY_WORK, WORK, 'work'),
          ],
          sources: [
            source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
            source(KEY_WORK, 'apollo:reveal:webhook:w'),
          ],
        }),
        /injected failure: candidate terminal update/,
      );
      await client.query(`SELECT set_config('sellup.inject', '', false)`);
      await assertNothingWritten();
    });

    it('falla la promoción del PRINCIPAL ⇒ rollback completo', async () => {
      await reset();
      await client.query(`SELECT set_config('sellup.inject', 'primary', false)`);
      await assert.rejects(
        callRpc({ phones: [phone(KEY_MOBILE, MOBILE, 'mobile', 'valid')] }),
        /injected failure: primary promotion/,
      );
      await client.query(`SELECT set_config('sellup.inject', '', false)`);
      await assertNothingWritten();
    });

    it('un rollback NO deja al candidato peor que antes: la corrida siguiente lo completa', async () => {
      await reset();
      await client.query(`SELECT set_config('sellup.inject', 'candidate', false)`);
      await assert.rejects(callRpc(), /injected failure/);
      await client.query(`SELECT set_config('sellup.inject', '', false)`);
      // Mismo payload, sin el fallo: converge y termina. 0 créditos nuevos, porque
      // el payload es el mismo que Apollo YA entregó.
      const result = await callRpc();
      assert.equal(result.status, 'persisted');
      assert.equal(result.inserted_phone_count, 1);
      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.equal(state.sources.length, 1);
      assert.equal(state.candidate!.phone_reveal_status, 'revealed');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 3. Idempotencia
  // ═════════════════════════════════════════════════════════════

  describe('idempotencia', () => {
    it('el MISMO webhook dos veces ⇒ `idempotent`, sin duplicar nada', async () => {
      await reset();
      const first = await callRpc();
      assert.equal(first.status, 'persisted');
      const second = await callRpc();
      assert.equal(second.status, 'idempotent');
      assert.equal(second.inserted_phone_count, 0);
      assert.equal(second.inserted_source_count, 0);
      assert.equal(second.candidate_terminalized, true);

      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.equal(state.sources.length, 1);
      assert.equal(state.phones.filter((row) => row.is_primary).length, 1);
    });

    it('la MISMA recuperación dos veces ⇒ la segunda es `stale_event`, sin escribir', async () => {
      await reset();
      await callRpc({ phase: 'recovery_poll', expectedRequestId: null, webhookReceivedAt: null, lastCheckedAt: NOW });
      const second = await callRpc({ phase: 'recovery_poll', expectedRequestId: null, webhookReceivedAt: null, lastCheckedAt: NOW });
      // Sin request id contra el que comparar, un candidato ya terminal solo puede
      // leerse como «este resultado no me pertenece». Nada se reescribe.
      assert.equal(second.status, 'stale_event');
      const state = await snapshot();
      assert.equal(state.phones.length, 1);
      assert.equal(state.sources.length, 1);
    });

    it('webhook y luego recuperación del MISMO resultado en vuelo ⇒ una colección', async () => {
      await reset();
      await callRpc({
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'), phone(KEY_WORK, WORK, 'work')],
        sources: [
          source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
          source(KEY_WORK, 'apollo:reveal:webhook:w'),
        ],
      });
      // El cron encuentra el candidato todavía en vuelo (el callback no lo cerró en
      // este escenario) y reprocesa el mismo payload con la fase del poll.
      await client.query(
        `UPDATE public.contact_enrichment_candidates SET phone_reveal_status = 'pending' WHERE id = $1`,
        [CANDIDATE_ID],
      );
      const second = await callRpc({
        phase: 'recovery_poll',
        expectedRequestId: null,
        webhookReceivedAt: null,
        lastCheckedAt: NOW,
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'), phone(KEY_WORK, WORK, 'work')],
        sources: [
          source(KEY_MOBILE, 'apollo:reveal:recovery_poll:m'),
          source(KEY_WORK, 'apollo:reveal:recovery_poll:w'),
        ],
      });
      assert.equal(second.status, 'persisted');
      // Las FILAS no se duplican: la clave es (candidate_id, dedupe_key).
      assert.equal(second.inserted_phone_count, 0);
      assert.equal(second.updated_phone_count, 2);
      // Las procedencias SÍ se añaden: son observaciones distintas, y eso es el
      // punto de la tabla — dos caminos vieron el número, y ambos quedan.
      assert.equal(second.inserted_source_count, 2);

      const state = await snapshot();
      assert.equal(state.phones.length, 2);
      assert.equal(state.sources.length, 4);
      assert.equal(state.phones.filter((row) => row.is_primary).length, 1);
    });

    it('la MISMA procedencia repetida no añade una segunda fila', async () => {
      await reset();
      await callRpc();
      await client.query(
        `UPDATE public.contact_enrichment_candidates SET phone_reveal_status = 'pending' WHERE id = $1`,
        [CANDIDATE_ID],
      );
      // Mismo `source_event_key` ⇒ ON CONFLICT DO NOTHING.
      const again = await callRpc();
      assert.equal(again.status, 'persisted');
      assert.equal(again.inserted_source_count, 0);
      const state = await snapshot();
      assert.equal(state.sources.length, 1);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 4. Concurrencia webhook / recovery
  // ═════════════════════════════════════════════════════════════

  describe('concurrencia', () => {
    it('dos llamadas simultáneas sobre el mismo candidato SE SERIALIZAN', async () => {
      await reset();
      const other = postgres.getPgClient();
      await other.connect();
      try {
        // Sesión A abre una transacción explícita y escribe SIN cerrarla.
        await client.query('BEGIN');
        const a = await callRpc({}, client);
        assert.equal(a.status, 'persisted');

        // Sesión B lanza la misma llamada: el `SELECT … FOR UPDATE` de la función
        // la bloquea sobre la fila del candidato. Sin ese bloqueo, B leería «en
        // vuelo» y ambas elegirían un principal.
        const pending = callRpc({}, other);
        let settled = false;
        void pending.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        // Tiempo real, no solo microtasks: la consulta de B tiene que llegar al
        // servidor y quedarse esperando el bloqueo. Si no estuviera bloqueada, en
        // 300 ms ya habría resuelto de sobra.
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(settled, false, 'B debe quedar bloqueada mientras A no cierra');

        await client.query('COMMIT');
        const b = await pending;

        // B despierta y encuentra el trabajo hecho por A. No lo repite.
        assert.equal(b.status, 'idempotent');
        assert.equal(b.inserted_phone_count, 0);
        assert.equal(b.inserted_source_count, 0);

        const state = await snapshot();
        assert.equal(state.phones.length, 1, 'una sola fila canónica');
        assert.equal(state.sources.length, 1, 'una sola procedencia');
        assert.equal(
          state.phones.filter((row) => row.is_primary).length,
          1,
          'un solo principal',
        );
        assert.equal(state.candidate!.phone, MOBILE);
        assert.equal(state.candidate!.phone_reveal_status, 'revealed');
      } finally {
        await other.end().catch(() => {});
      }
    });

    it('si la transacción que va delante se DESHACE, la de atrás escribe limpio', async () => {
      await reset();
      const other = postgres.getPgClient();
      await other.connect();
      try {
        await client.query('BEGIN');
        await callRpc({}, client);
        const pending = callRpc({}, other);
        // A se deshace: para B es como si nunca hubiera pasado.
        await client.query('ROLLBACK');
        const b = await pending;
        assert.equal(b.status, 'persisted');
        assert.equal(b.inserted_phone_count, 1);

        const state = await snapshot();
        assert.equal(state.phones.length, 1);
        assert.equal(state.sources.length, 1);
        assert.equal(state.phones.filter((row) => row.is_primary).length, 1);
      } finally {
        await other.end().catch(() => {});
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 5. Tombstones
  // ═════════════════════════════════════════════════════════════

  describe('tombstones', () => {
    /** Convierte una fila en tombstone, como haría el cumplimiento de una DSAR. */
    async function suppress(key: string) {
      await client.query(
        `UPDATE public.contact_enrichment_candidate_phones
            SET suppressed_at = now(), suppression_reason = 'data_subject_request',
                normalized_phone = NULL, display_phone = NULL, phone_type = NULL,
                is_primary = false
          WHERE candidate_id = $1 AND dedupe_key = $2`,
        [CANDIDATE_ID, key],
      );
    }

    it('un número suprimido NO se reescribe, NO gana procedencia y NO es principal', async () => {
      await reset();
      const both = {
        phones: [phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'), phone(KEY_WORK, WORK, 'work')],
        sources: [
          source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
          source(KEY_WORK, 'apollo:reveal:webhook:w'),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
        ],
      };
      await callRpc(both);
      await suppress(KEY_MOBILE);
      await client.query(
        `UPDATE public.contact_enrichment_candidates SET phone_reveal_status = 'pending' WHERE id = $1`,
        [CANDIDATE_ID],
      );

      // El mismo número vuelve a llegar, con otro `source_event_key`.
      const result = await callRpc({
        ...both,
        sources: [
          source(KEY_MOBILE, 'apollo:reveal:webhook:m2'),
          source(KEY_WORK, 'apollo:reveal:webhook:w2'),
        ],
      });
      assert.equal(result.status, 'persisted');
      assert.equal(result.suppressed_skipped_count, 1);
      // El principal pasa al superviviente…
      assert.equal(result.primary_dedupe_key, KEY_WORK);

      const state = await snapshot();
      const tombstone = state.phones.find((row) => row.dedupe_key === KEY_MOBILE)!;
      assert.notEqual(tombstone.suppressed_at, null, 'sigue siendo tombstone');
      assert.equal(tombstone.normalized_phone, null, 'el número NO vuelve');
      assert.equal(tombstone.display_phone, null);
      assert.equal(tombstone.phone_type, null);
      assert.equal(tombstone.is_primary, false);
      // …y NO se registró que se volviera a ver a esa persona.
      const tombstoneSources = state.sources.filter((row) => row.dedupe_key === KEY_MOBILE);
      assert.equal(tombstoneSources.length, 1, 'sin procedencia nueva sobre el tombstone');
      assert.equal(tombstoneSources[0].source_event_key, 'apollo:reveal:webhook:m');
      // El escalar sigue al principal superviviente.
      assert.equal(state.candidate!.phone, WORK);
      assert.equal(state.candidate!.phone_reveal_status, 'revealed');
    });

    it('el heredado es tombstone y NINGUNA candidata sobrevive ⇒ `suppressed`, sin resucitar', async () => {
      // El hueco que este caso cierra: 2 números, el heredado suprimido y el otro
      // AFIRMADO INVÁLIDO. El inválido no puede ser principal (CHECK de la 109), así
      // que la lógica pura no lo pone en la preferencia; la única candidata es el
      // suprimido. Con la condición ingenua «¿están TODOS suprimidos?» la respuesta
      // era «no» (el inválido no lo está), se seguía adelante, no se elegía principal
      // y el escalar caía al heredado — el número borrado, de vuelta a la vista.
      //
      // La condición correcta es la que se comprueba: el fallback es un tombstone Y
      // no sobrevive ninguna candidata.
      await reset();
      await client.query(
        `INSERT INTO public.contact_enrichment_candidate_phones
           (candidate_id, dedupe_key, phone_status, suppressed_at, suppression_reason)
         VALUES ($1, $2, 'unknown', now(), 'data_subject_request')`,
        [CANDIDATE_ID, KEY_MOBILE],
      );

      const result = await callRpc({
        phones: [
          phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'),
          phone(KEY_WORK, WORK, 'work', 'invalid'),
        ],
        sources: [
          source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
          source(KEY_WORK, 'apollo:reveal:webhook:w'),
        ],
        // Solo el móvil es candidata: el otro es inválido y la 109 lo rechazaría.
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
        ],
        legacyPhone: MOBILE,
        legacyDedupeKey: KEY_MOBILE,
      });

      assert.equal(result.status, 'suppressed');
      assert.equal(result.candidate_terminalized, false);
      const state = await snapshot();
      // NADA escrito: ni siquiera la fila del número inválido, que sí era escribible.
      // Fail-closed es fail-closed.
      assert.equal(state.phones.length, 1, 'solo sigue el tombstone que ya estaba');
      assert.equal(state.sources.length, 0);
      assert.equal(state.candidate!.phone, null, 'el número borrado NO vuelve a la vista');
      assert.notEqual(state.candidate!.phone_reveal_status, 'revealed');
    });

    it('el heredado es tombstone pero OTRA candidata sobrevive ⇒ se escribe con esa', async () => {
      await reset();
      await client.query(
        `INSERT INTO public.contact_enrichment_candidate_phones
           (candidate_id, dedupe_key, phone_status, suppressed_at, suppression_reason)
         VALUES ($1, $2, 'unknown', now(), 'data_subject_request')`,
        [CANDIDATE_ID, KEY_MOBILE],
      );
      const result = await callRpc({
        phones: [
          phone(KEY_MOBILE, MOBILE, 'mobile', 'valid'),
          phone(KEY_WORK, WORK, 'work'),
        ],
        sources: [
          source(KEY_MOBILE, 'apollo:reveal:webhook:m'),
          source(KEY_WORK, 'apollo:reveal:webhook:w'),
        ],
        primaryCandidates: [
          { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
          { dedupe_key: KEY_WORK, phone: WORK, phone_type: 'work', raw_type: 'work' },
        ],
        legacyPhone: MOBILE,
        legacyDedupeKey: KEY_MOBILE,
      });
      // El fallback no se necesita, así que que sea tombstone no bloquea nada.
      assert.equal(result.status, 'persisted');
      assert.equal(result.primary_dedupe_key, KEY_WORK);
      const state = await snapshot();
      assert.equal(state.candidate!.phone, WORK);
      assert.equal(state.candidate!.phone_reveal_status, 'revealed');
    });

    it('TODOS los números suprimidos ⇒ `suppressed`, 0 escrituras y SIN terminalizar', async () => {
      await reset();
      // Un tombstone preexistente para el ÚNICO número que el payload trae.
      await client.query(
        `INSERT INTO public.contact_enrichment_candidate_phones
           (candidate_id, dedupe_key, phone_status, suppressed_at, suppression_reason)
         VALUES ($1, $2, 'unknown', now(), 'data_subject_request')`,
        [CANDIDATE_ID, KEY_MOBILE],
      );

      const result = await callRpc();
      assert.equal(result.status, 'suppressed');
      assert.equal(result.suppressed_skipped_count, 1);
      assert.equal(result.inserted_phone_count, 0);
      assert.equal(result.inserted_source_count, 0);
      assert.equal(result.candidate_terminalized, false);

      const state = await snapshot();
      assert.equal(state.sources.length, 0);
      // Lo que esto protege: el escalar habría caído al número heredado, que ES el
      // número suprimido. Un tombstone que devuelve el número al campo visible no
      // está bloqueando nada.
      assert.equal(state.candidate!.phone, null);
      assert.notEqual(state.candidate!.phone_reveal_status, 'revealed');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 6. Eventos que no le pertenecen al candidato
  // ═════════════════════════════════════════════════════════════

  describe('guarda de evento', () => {
    it('otro request id ⇒ `stale_event` y 0 escrituras', async () => {
      await reset({ requestId: 'otro-request-id' });
      const result = await callRpc();
      assert.equal(result.status, 'stale_event');
      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.candidate!.phone, null);
      assert.equal(state.candidate!.phone_reveal_status, 'pending');
    });

    it('candidato ya cerrado como no_phone_found ⇒ `stale_event`, no se sobreescribe', async () => {
      await reset({ status: 'no_phone_found' });
      const result = await callRpc();
      assert.equal(result.status, 'stale_event');
      const state = await snapshot();
      assert.equal(state.phones.length, 0);
      assert.equal(state.candidate!.phone_reveal_status, 'no_phone_found');
    });

    it('candidato inexistente ⇒ `candidate_not_eligible`', async () => {
      const result = await callRpc({
        candidateId: '33333333-3333-4333-8333-333333333333',
      });
      assert.equal(result.status, 'candidate_not_eligible');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 7. Validación: rechaza antes de escribir
  // ═════════════════════════════════════════════════════════════

  describe('validación fail-closed', () => {
    const cases: Array<[string, RpcArgs, string]> = [
      ['un estado que no es revealed', { status: 'no_phone_found' }, 'status_not_revealed'],
      ['un código de error junto al éxito', { errorCode: 'blocked_suppressed' }, 'error_code_not_null'],
      ['otro proveedor', { provider: 'lusha' }, 'provider_not_apollo'],
      ['una procedencia de costo inventada', { costSource: 'assumed_cap' }, 'cost_source_unknown'],
      ['una colección vacía', { phones: [] }, 'phones_empty'],
      ['una fase desconocida', { phase: 'search' }, 'reveal_phase_unknown'],
      ['las dos fechas de fase a la vez', { lastCheckedAt: NOW }, 'phase_timestamps_inconsistent'],
      ['ninguna fecha de fase', { webhookReceivedAt: null }, 'phase_timestamps_inconsistent'],
      ['sin teléfono heredado', { legacyPhone: '   ' }, 'legacy_phone_missing'],
      [
        'un estado de teléfono fuera del vocabulario',
        { phones: [{ ...phone(KEY_MOBILE, MOBILE, 'mobile'), phone_status: 'probably' }] },
        'phone_row_invalid',
      ],
      [
        'dos filas con la misma clave',
        {
          phones: [phone(KEY_MOBILE, MOBILE, 'mobile'), phone(KEY_MOBILE, MOBILE, 'work')],
          sources: [],
        },
        'phone_key_duplicated',
      ],
      [
        'una procedencia huérfana',
        { sources: [source(KEY_WORK, 'apollo:reveal:webhook:w')] },
        'source_key_orphan',
      ],
    ];

    for (const [label, args, detail] of cases) {
      it(`rechaza ${label} con ${detail} y sin escribir`, async () => {
        await reset();
        const result = await callRpc(args);
        assert.equal(result.status, 'invalid_input');
        assert.equal(result.detail, detail);
        const state = await snapshot();
        assert.equal(state.phones.length, 0);
        assert.equal(state.candidate!.phone, null);
        assert.equal(state.candidate!.phone_reveal_status, 'pending');
      });
    }

    it('ningún mensaje de rechazo contiene un número', async () => {
      await reset();
      for (const [, args] of cases) {
        const result = await callRpc(args);
        const serialized = JSON.stringify(result);
        for (const value of [MOBILE, WORK, '5550000001', '5550000003']) {
          assert.equal(serialized.includes(value), false, `no debe aparecer ${value}`);
        }
        assert.equal(serialized.includes(KEY_MOBILE), false, 'sin dedupe_key');
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 8. Privilegios de ejecución
  // ═════════════════════════════════════════════════════════════

  describe('privilegios', () => {
    /** Ejecuta algo asumiendo un rol y devuelve el código de error, o null. */
    async function errorCodeAsRole(role: string, sql: string): Promise<string | null> {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query(sql);
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
      } finally {
        await client.query('ROLLBACK');
      }
    }

    const nullCall = `SELECT public.${FN}(
      NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::jsonb, NULL::jsonb,
      NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
      NULL::integer, NULL::text, NULL::text, NULL::text, NULL::text)`;

    for (const role of ['anon', 'authenticated'] as const) {
      it(`${role} recibe 42501 al intentar ejecutarla`, async () => {
        assert.equal(await errorCodeAsRole(role, nullCall), INSUFFICIENT_PRIVILEGE);
      });
    }

    it('service_role SÍ puede ejecutarla', async () => {
      assert.equal(await errorCodeAsRole('service_role', nullCall), null);
    });

    it('PUBLIC no tiene EXECUTE, y la ACL es exactamente postgres + service_role', async () => {
      // PUBLIC no se puede preguntar con `has_function_privilege`, porque no es un
      // rol: hay que mirar la entrada de la ACL cuyo beneficiario es 0. Buscar
      // `'=X/'` en el texto NO sirve — `postgres=X/postgres` también lo contiene.
      const { rows: publicRows } = await client.query(
        `SELECT a.privilege_type
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN aclexplode(p.proacl) a
         WHERE n.nspname = 'public' AND p.proname = $1 AND a.grantee = 0`,
        [FN],
      );
      assert.deepEqual(publicRows, [], 'PUBLIC no debe tener ningún privilegio');

      const { rows: granteeRows } = await client.query(
        `SELECT pg_get_userbyid(a.grantee) AS role, a.privilege_type
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN aclexplode(p.proacl) a
         WHERE n.nspname = 'public' AND p.proname = $1
         ORDER BY 1, 2`,
        [FN],
      );
      assert.deepEqual(granteeRows, [
        { role: 'postgres', privilege_type: 'EXECUTE' },
        { role: 'service_role', privilege_type: 'EXECUTE' },
      ]);
    });

    it('es SECURITY INVOKER con search_path fijo', async () => {
      const { rows } = await client.query(
        `SELECT p.prosecdef, COALESCE(p.proconfig::text, '<null>') AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = $1`,
        [FN],
      );
      // INVOKER mantiene en pie el techo de privilegios de la 109: la función no
      // puede borrar una fila de teléfono ni reescribir una procedencia.
      assert.equal(rows[0].prosecdef, false);
      assert.match(rows[0].config as string, /search_path=pg_catalog, pg_temp/);
    });
  });
});
