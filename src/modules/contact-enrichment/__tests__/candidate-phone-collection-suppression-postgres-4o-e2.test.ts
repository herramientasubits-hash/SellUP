/**
 * Agente 2A — ATOMICIDAD REAL de la propagación de la supresión a la colección
 * (AGENT2A-PHONE-REVEAL-4O-E2) — PostgreSQL 17 efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las suites hermanas de este hito fijan el CONTRATO: qué se manda, qué se
 * devuelve, qué dice el SQL. Lo que no pueden fijar es la GARANTÍA. «Si la
 * reelección falla, los tombstones se deshacen» es, en un doble de TypeScript, una
 * afirmación que se programa; aquí es una que se mide. Y «un tombstone no puede
 * quedar como principal» no es una regla del código: es una CHECK de PostgreSQL,
 * así que solo PostgreSQL puede demostrarla.
 *
 * Por eso las escrituras ocurren contra un PostgreSQL de verdad, los fallos se
 * INYECTAN con triggers, las MUTACIONES se aplican al SQL real de la migración, y
 * lo que se comprueba después es el contenido de las tablas.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la
 *     plataforma, y `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`, que es lo que
 *     hace que toda tabla nueva de `public` nazca con los 8 privilegios;
 *   * `contact_enrichment_candidates` con las columnas del reveal y sus TIPOS REALES
 *     (tomadas de 068/094/095/097/098/101), más `enrichment_run_id`;
 *   * `phone_reveal_suppression_audit` con las columnas y CHECKs de la 099 que la
 *     112 amplía;
 *   * las migraciones 109, 110 y 112 TAL CUAL están en disco.
 *
 * La reproducción del candidato es mínima y deliberada: aplicar la cadena completa
 * no es viable (arrastra dependencias de plataforma), y los arneses hermanos ya
 * establecieron esta convención — reproducir el punto de partida exacto de lo que se
 * está probando, no el repositorio entero.
 *
 * La 110 se aplica porque el defecto que 4O-E2 cierra vive precisamente en la
 * COSTURA entre las dos: sin ella, «la 110 ya no puede resucitar el número» sería
 * una hipótesis. Con ella se ejecuta.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito; no ejecuta ninguna DSAR real. Todos los
 * números son sintéticos 555.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito:
 * descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio, que no necesita esta suite. Si el módulo no está resuelto, el archivo
 * se SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:phone-suppression-propagation-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete
 * son prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6,
 * la misma de Producción.
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

const FN = 'suppress_candidate_phone_collection';
const MIGRATION_112 = '112_suppress_candidate_phone_collection.sql';

/** Códigos de PostgreSQL que estas pruebas distinguen. */
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const LOCK_NOT_AVAILABLE = '55P03';

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
// Datos de prueba — todos sintéticos 555
// ═══════════════════════════════════════════════════════════════

const RUN_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_RUN_ID = '88888888-8888-4888-8888-888888888888';
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-08-10T10:00:00.000Z';
const LATER = '2026-08-10T12:00:00.000Z';

const MOBILE = '+15550000001';
const WORK = '+15550000003';
const HQ = '+15550000007';

const KEY_MOBILE = `e164:${'a'.repeat(64)}`;
const KEY_WORK = `e164:${'b'.repeat(64)}`;
const KEY_HQ = `e164:${'c'.repeat(64)}`;
const KEY_ABSENT = `e164:${'f'.repeat(64)}`;

interface SeedPhone {
  key: string;
  number: string | null;
  type: string | null;
  status?: string;
  primary?: boolean;
  suppressed?: boolean;
  lastSeenAt?: string;
  /** provider:acquisition_mode de UNA procedencia, o null para no crear ninguna. */
  source?: string | null;
}

describe('4O-E2 — atomicidad real de la propagación de la supresión', { skip: harnessSkipReason }, () => {
  let postgres: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir = '';

  const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

  /**
   * Llama la función con parámetros NOMBRADOS, igual que PostgREST. En AUTOCOMMIT:
   * una sentencia es una transacción, así que un fallo de la función deshace
   * exactamente lo que la función escribió. Que ese deshacer sea COMPLETO es lo que
   * estas pruebas miden.
   */
  async function callRpc(
    args: {
      candidateId?: string | null;
      expectedRunId?: string | null;
      scope?: string | null;
      dedupeKey?: string | null;
      reason?: string | null;
      suppressedBy?: string | null;
      suppressedAt?: string | null;
    } = {},
    fn: string = FN,
    conn: PgLikeClient = client,
  ): Promise<Record<string, unknown>> {
    const { rows } = await conn.query(
      `SELECT public.${fn}(
         p_candidate_id               => $1::uuid,
         p_expected_enrichment_run_id => $2::uuid,
         p_scope                      => $3::text,
         p_dedupe_key                 => $4::text,
         p_suppression_reason         => $5::text,
         p_suppressed_by              => $6::uuid,
         p_suppressed_at              => $7::timestamptz
       ) AS result`,
      [
        // `=== undefined` y NUNCA `??`: estas pruebas mandan `null` A PROPÓSITO para
        // ejercer la validación, y un `??` lo sustituiría por el valor por defecto
        // dejando el test verde sin haber probado nada.
        args.candidateId === undefined ? CANDIDATE_ID : args.candidateId,
        args.expectedRunId === undefined ? RUN_ID : args.expectedRunId,
        args.scope === undefined ? 'all_candidate_phones' : args.scope,
        args.dedupeKey === undefined ? null : args.dedupeKey,
        args.reason === undefined ? 'data_subject_request' : args.reason,
        args.suppressedBy === undefined ? ACTOR_ID : args.suppressedBy,
        args.suppressedAt === undefined ? NOW : args.suppressedAt,
      ],
    );
    return rows[0].result as Record<string, unknown>;
  }

  /** Estado observable: filas de teléfono, procedencias y el candidato. */
  async function snapshot(candidateId = CANDIDATE_ID) {
    const phones = await client.query(
      `SELECT dedupe_key, normalized_phone, display_phone, phone_type, phone_status,
              is_primary, suppressed_at, suppression_reason, suppressed_by
       FROM public.contact_enrichment_candidate_phones
       WHERE candidate_id = $1 ORDER BY dedupe_key`,
      [candidateId],
    );
    const sources = await client.query(
      `SELECT s.source_event_key, s.provider, s.acquisition_mode, s.raw_provider_type,
              p.dedupe_key
       FROM public.contact_enrichment_candidate_phone_sources s
       JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
       WHERE p.candidate_id = $1 ORDER BY s.source_event_key`,
      [candidateId],
    );
    const candidate = await client.query(
      `SELECT phone, enrichment_metadata, phone_reveal_status, phone_reveal_error_code
       FROM public.contact_enrichment_candidates WHERE id = $1`,
      [candidateId],
    );
    return {
      phones: phones.rows,
      sources: sources.rows,
      candidate: (candidate.rows[0] ?? null) as Record<string, unknown> | null,
    };
  }

  /** Vacía la colección del candidato y lo devuelve a un estado conocido. */
  async function seed(
    phones: readonly SeedPhone[],
    candidate: { phone?: string | null; metadata?: Record<string, unknown> } = {},
  ) {
    // El GUC se limpia ANTES de escribir: los inyectores viven en triggers y
    // dispararían sobre el propio montaje.
    await client.query(`SELECT set_config('sellup.inject', '', false)`);
    await client.query(
      'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
      [CANDIDATE_ID],
    );
    await client.query(
      `UPDATE public.contact_enrichment_candidates
          SET phone = $2, enrichment_metadata = $3::jsonb,
              enrichment_run_id = $4, phone_reveal_status = 'revealed',
              phone_reveal_error_code = NULL
        WHERE id = $1`,
      [
        CANDIDATE_ID,
        candidate.phone === undefined ? null : candidate.phone,
        JSON.stringify(
          candidate.metadata ?? {
            relevance: { score: 9 },
            completion: { status: 'complete' },
          },
        ),
        RUN_ID,
      ],
    );

    for (const phone of phones) {
      const { rows } = await client.query(
        `INSERT INTO public.contact_enrichment_candidate_phones (
           candidate_id, normalized_phone, display_phone, dedupe_key, phone_type,
           phone_status, is_primary, first_seen_at, last_seen_at, suppressed_at,
           suppression_reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          CANDIDATE_ID,
          phone.suppressed ? null : phone.number,
          phone.suppressed ? null : phone.number,
          phone.key,
          phone.suppressed ? null : phone.type,
          phone.status ?? 'unknown',
          phone.suppressed ? false : (phone.primary ?? false),
          NOW,
          phone.lastSeenAt ?? NOW,
          phone.suppressed ? NOW : null,
          phone.suppressed ? 'data_subject_request' : null,
        ],
      );
      const phoneId = rows[0].id as string;
      const source = phone.source === undefined ? 'apollo:reveal' : phone.source;
      if (source !== null) {
        const [provider, mode] = source.split(':');
        await client.query(
          `INSERT INTO public.contact_enrichment_candidate_phone_sources (
             candidate_phone_id, provider, acquisition_mode, raw_provider_type,
             raw_provider_status, source_event_key, observed_at
           ) VALUES ($1, $2, $3, $4, 'valid', $5, $6)`,
          [phoneId, provider, mode, phone.type, `v1:${provider}:${mode}:${phone.key}`, NOW],
        );
      }
    }
  }

  /**
   * Aplica una COPIA MUTADA de la función bajo otro nombre. Extrae solo el bloque
   * `CREATE OR REPLACE FUNCTION … END $$;` — el COMMENT y los GRANT del archivo
   * nombran la función original y no se pueden reutilizar.
   */
  async function applyMutatedFunction(
    name: string,
    mutate: (sql: string) => string,
  ): Promise<void> {
    const sql = readMigration(MIGRATION_112);
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
    assert.notEqual(start, -1, 'no se encontró la definición de la función');
    const end = sql.indexOf('END $$;', start);
    assert.notEqual(end, -1, 'no se encontró el final de la función');
    const definition = sql.slice(start, end + 'END $$;'.length);
    const mutated = mutate(definition);
    // Se compara ANTES de renombrar: el renombrado cambia el texto siempre, así que
    // compararlo después haría pasar una mutación que en realidad no tocó nada — y el
    // test quedaría verde probando la función original bajo otro nombre.
    assert.notEqual(mutated, definition, 'la mutación no cambió nada: no probaría nada');
    await client.query(mutated.replaceAll(`public.${FN}(`, `public.${name}(`));
  }

  /** Ejecuta `fn` y devuelve el SQLSTATE si lanzó, o null si no. */
  async function sqlstateOf(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn();
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-4oe2-'));
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

    // ── Las corridas y el candidato, con los TIPOS REALES ────────
    await client.query(`
      CREATE TABLE public.contact_enrichment_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid);

      CREATE TABLE public.contact_enrichment_candidates (
        id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        enrichment_run_id                uuid NOT NULL
          REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
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
      -- NI la 110 NI la 112 escriben en ninguna, que es precisamente lo que se
      -- comprueba más abajo.
      CREATE TABLE public.phone_reveal_waterfall_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.phone_reveal_credit_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.provider_usage_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid());

      -- La auditoría durable, con las columnas y CHECKs de la 099 que la 112 amplía.
      CREATE TABLE public.phone_reveal_suppression_audit (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider                text NOT NULL DEFAULT 'apollo',
        provider_person_id_hash text NOT NULL,
        account_id              uuid,
        country_code            text,
        actor_user_id           uuid,
        reason_code             text NOT NULL,
        candidates_cleared      integer NOT NULL DEFAULT 0
          CONSTRAINT phone_reveal_suppression_audit_candidates_check
          CHECK (candidates_cleared >= 0),
        contacts_cleared        integer NOT NULL DEFAULT 0
          CONSTRAINT phone_reveal_suppression_audit_contacts_check
          CHECK (contacts_cleared >= 0),
        cache_rows_suppressed   integer NOT NULL DEFAULT 0
          CONSTRAINT phone_reveal_suppression_audit_cache_rows_check
          CHECK (cache_rows_suppressed >= 0),
        tombstone_created       boolean NOT NULL DEFAULT false,
        created_at              timestamptz NOT NULL DEFAULT now(),
        metadata                jsonb NOT NULL DEFAULT '{}'::jsonb
      );`);

    await client.query(readMigration('109_contact_enrichment_candidate_phones.sql'));
    await client.query(
      readMigration('110_persist_candidate_apollo_phone_reveal_result.sql'),
    );
    await client.query(readMigration(MIGRATION_112));

    // ── Inyectores de fallo: inertes salvo activación explícita ──
    await client.query(`
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
          RAISE EXCEPTION 'injected failure: candidate scalar update';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER test_inject_candidate_failure
        BEFORE UPDATE ON public.contact_enrichment_candidates
        FOR EACH ROW EXECUTE FUNCTION test_inject_candidate_failure();`);

    await client.query(
      `INSERT INTO public.contact_enrichment_runs (id) VALUES ($1), ($2)`,
      [RUN_ID, OTHER_RUN_ID],
    );
    await client.query(
      `INSERT INTO public.contact_enrichment_candidates (id, enrichment_run_id)
       VALUES ($1, $2)`,
      [CANDIDATE_ID, RUN_ID],
    );
  });

  after(async () => {
    if (client) await client.end().catch(() => {});
    if (postgres) await postgres.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ═════════════════════════════════════════════════════════════
  // § 21.1 — todos los números
  // ═════════════════════════════════════════════════════════════

  describe('§ 21.1 · supresión de TODOS los números', () => {
    it('3 tombstones, 0 vivos, 0 principal, escalar nulo, 3 procedencias intactas', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
          { key: KEY_HQ, number: HQ, type: 'hq', source: 'lusha:reveal' },
        ],
        {
          phone: MOBILE,
          metadata: {
            relevance: { score: 9 },
            phone: { number: MOBILE, type: 'mobile', source: 'apollo_reveal' },
          },
        },
      );

      const result = await callRpc();
      assert.equal(result.status, 'suppressed');
      assert.equal(result.suppressed_count, 3);
      assert.equal(result.already_suppressed_count, 0);
      assert.equal(result.survivor_count, 0);
      assert.equal(result.primary_dedupe_key, null);
      assert.equal(result.primary_changed, true);
      assert.equal(result.candidate_phone_cleared, true);
      assert.equal(result.candidate_updated, true);
      assert.equal(result.candidate_settled, true);

      const state = await snapshot();
      assert.equal(state.phones.length, 3, 'las filas SOBREVIVEN: son el bloqueo');
      for (const row of state.phones) {
        assert.equal(row.normalized_phone, null);
        assert.equal(row.display_phone, null);
        assert.equal(row.phone_type, null);
        assert.equal(row.is_primary, false);
        assert.notEqual(row.suppressed_at, null);
        assert.equal(row.suppression_reason, 'data_subject_request');
        assert.equal(row.suppressed_by, ACTOR_ID);
        // La clave se CONSERVA: es el UNIQUE que impide reinsertar el número.
        assert.match(row.dedupe_key as string, /^e164:[0-9a-f]{64}$/);
      }

      // § 4 — provenance PRESERVADA, las tres filas.
      assert.equal(state.sources.length, 3);

      // Escalar y metadata sincronizados.
      assert.equal(state.candidate!.phone, null);
      const metadata = state.candidate!.enrichment_metadata as Record<string, unknown>;
      assert.equal('phone' in metadata, false, 'el bloque phone debe desaparecer');
      // Y SOLO ese bloque: el resto de la metadata sigue intacto.
      assert.deepEqual(metadata.relevance, { score: 9 });
    });

    it('ninguna fila de la colección contiene el número tras la supresión', async () => {
      // Comprobación directa sobre la tabla, no sobre el sobre de la función.
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n
         FROM public.contact_enrichment_candidate_phones
         WHERE candidate_id = $1
           AND (normalized_phone IS NOT NULL OR display_phone IS NOT NULL)`,
        [CANDIDATE_ID],
      );
      assert.equal(rows[0].n, 0);
    });

    it('las procedencias no contienen ningún número (por eso se conservan)', async () => {
      const { rows } = await client.query(
        `SELECT s.* FROM public.contact_enrichment_candidate_phone_sources s
         JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
         WHERE p.candidate_id = $1`,
        [CANDIDATE_ID],
      );
      assert.equal(rows.length, 3);
      for (const row of rows) {
        const serialized = JSON.stringify(row);
        for (const number of [MOBILE, WORK, HQ]) {
          assert.equal(serialized.includes(number), false);
        }
        // Y la tabla no tiene ninguna columna que pudiera llevarlo.
        assert.equal('normalized_phone' in row, false);
        assert.equal('display_phone' in row, false);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 21.2 — se suprime SOLO el principal
  // ═════════════════════════════════════════════════════════════

  describe('§ 21.2 · se suprime el principal', () => {
    it('mobile → tombstone, work → PRINCIPAL, escalar = work', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );

      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.status, 'suppressed');
      assert.equal(result.suppressed_count, 1);
      assert.equal(result.survivor_count, 1);
      assert.equal(result.primary_dedupe_key, KEY_WORK);
      assert.equal(result.primary_changed, true);
      assert.equal(result.candidate_phone_cleared, false);

      const state = await snapshot();
      const mobile = state.phones.find((r) => r.dedupe_key === KEY_MOBILE)!;
      const work = state.phones.find((r) => r.dedupe_key === KEY_WORK)!;
      assert.equal(mobile.normalized_phone, null);
      assert.equal(mobile.is_primary, false);
      assert.notEqual(mobile.suppressed_at, null);
      assert.equal(work.is_primary, true);
      assert.equal(work.normalized_phone, WORK);

      // El escalar es EL número del superviviente, no el suprimido ni null.
      assert.equal(state.candidate!.phone, WORK);
      const metadata = state.candidate!.enrichment_metadata as Record<string, unknown>;
      assert.deepEqual(metadata.phone, {
        number: WORK,
        type: 'work',
        source: 'apollo_reveal',
        raw_type: 'work',
      });
    });

    it('exactamente UN principal vivo, nunca dos ni cero', async () => {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.contact_enrichment_candidate_phones
         WHERE candidate_id = $1 AND is_primary`,
        [CANDIDATE_ID],
      );
      assert.equal(rows[0].n, 1);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 21.3 — se suprime un NO principal
  // ═════════════════════════════════════════════════════════════

  describe('§ 21.3 · se suprime un teléfono no principal', () => {
    it('el principal existente permanece y el escalar no cambia', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        {
          phone: MOBILE,
          metadata: {
            relevance: { score: 9 },
            phone: { number: MOBILE, type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
          },
        },
      );

      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_WORK });
      assert.equal(result.status, 'suppressed');
      assert.equal(result.suppressed_count, 1);
      assert.equal(result.survivor_count, 1);
      assert.equal(result.primary_dedupe_key, KEY_MOBILE);
      assert.equal(result.primary_changed, false, 'el principal no cambió');
      // Nada que actualizar en el candidato: ya describía al mismo número.
      assert.equal(result.candidate_updated, false);

      const state = await snapshot();
      const mobile = state.phones.find((r) => r.dedupe_key === KEY_MOBILE)!;
      assert.equal(mobile.normalized_phone, MOBILE);
      assert.equal(mobile.is_primary, true);
      assert.equal(mobile.suppressed_at, null);
      assert.equal(state.candidate!.phone, MOBILE);
    });

    it('una clave que no existe no toca NADA: `no_matching_phone_rows`', async () => {
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_ABSENT });
      assert.equal(result.status, 'no_matching_phone_rows');
      assert.equal(result.suppressed_count, 0);
      assert.equal(result.candidate_updated, false);
      assert.equal(result.candidate_settled, false);

      // El escalar NO se borró: borrar «este número» cuando ese número no está no
      // puede degenerar en borrar el teléfono visible de un candidato ajeno.
      const state = await snapshot();
      assert.equal(state.candidate!.phone, MOBILE);
      assert.equal(state.phones[0].normalized_phone, MOBILE);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 21.4 — multi-proveedor
  // ═════════════════════════════════════════════════════════════

  describe('§ 21.4 · superviviente de OTRO proveedor', () => {
    it('suprimido el móvil de Apollo, el work de Lusha pasa a principal', async () => {
      await seed(
        [
          {
            key: KEY_MOBILE,
            number: MOBILE,
            type: 'mobile',
            primary: true,
            status: 'valid',
            source: 'apollo:reveal',
          },
          { key: KEY_WORK, number: WORK, type: 'work', source: 'lusha:reveal' },
        ],
        { phone: MOBILE },
      );

      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, KEY_WORK);

      const state = await snapshot();
      const work = state.phones.find((r) => r.dedupe_key === KEY_WORK)!;
      assert.equal(work.is_primary, true);
      assert.equal(state.candidate!.phone, WORK);

      // La procedencia del superviviente NO se pierde, y la metadata la refleja.
      const lusha = state.sources.filter((s) => s.provider === 'lusha');
      assert.equal(lusha.length, 1);
      const metadata = state.candidate!.enrichment_metadata as Record<string, unknown>;
      assert.deepEqual(metadata.phone, {
        number: WORK,
        type: 'work',
        source: 'lusha_reveal',
        raw_type: 'work',
      });
    });

    it('la procedencia del número SUPRIMIDO también se conserva', async () => {
      const apollo = (await snapshot()).sources.filter((s) => s.provider === 'apollo');
      assert.equal(apollo.length, 1, 'la evidencia de la observación sobrevive');
      assert.equal(apollo[0].dedupe_key, KEY_MOBILE);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 8 — el ranking canónico decide, no el orden de inserción
  // ═════════════════════════════════════════════════════════════

  describe('§ 8 · ranking canónico de la reelección', () => {
    it('el tipo manda: work gana a hq aunque hq se insertara antes', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_HQ, number: HQ, type: 'hq' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, KEY_WORK);
    });

    it('empatado el tipo, `valid` gana a `unknown`', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_HQ, number: HQ, type: 'work', status: 'unknown' },
          { key: KEY_WORK, number: WORK, type: 'work', status: 'valid' },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, KEY_WORK);
    });

    it('empatados tipo y estado, la procedencia MÁS ESPECÍFICA gana', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          // apollo:search es el escalón más débil; lusha:reveal es más específico.
          { key: KEY_HQ, number: HQ, type: 'work', status: 'valid', source: 'apollo:search' },
          { key: KEY_WORK, number: WORK, type: 'work', status: 'valid', source: 'lusha:reveal' },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, KEY_WORK);
    });

    it('empatado todo lo anterior, el `last_seen_at` más reciente gana', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_HQ, number: HQ, type: 'work', status: 'valid', lastSeenAt: NOW },
          { key: KEY_WORK, number: WORK, type: 'work', status: 'valid', lastSeenAt: LATER },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, KEY_WORK);
    });

    it('un número INVÁLIDO nunca es elegido, ni siendo el único que queda', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work', status: 'invalid' },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, null);
      assert.equal(result.survivor_count, 0);
      assert.equal(result.candidate_phone_cleared, true);
      const state = await snapshot();
      assert.equal(state.candidate!.phone, null);
    });

    it('un tombstone previo nunca vuelve a ser elegible', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: null, type: null, suppressed: true },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(result.primary_dedupe_key, null);
      assert.equal(result.already_suppressed_count, 0, 'el tombstone no está en alcance');
      const state = await snapshot();
      const work = state.phones.find((r) => r.dedupe_key === KEY_WORK)!;
      assert.equal(work.normalized_phone, null, 'no resucita');
      assert.equal(work.is_primary, false);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 14 — idempotencia
  // ═════════════════════════════════════════════════════════════

  describe('§ 14 · idempotencia', () => {
    it('repetir la misma DSAR no resucita nada y devuelve `already_suppressed`', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );

      const first = await callRpc();
      assert.equal(first.status, 'suppressed');
      assert.equal(first.suppressed_count, 2);

      const before = await snapshot();
      const second = await callRpc({ suppressedAt: LATER, suppressedBy: null });
      assert.equal(second.status, 'already_suppressed');
      assert.equal(second.suppressed_count, 0);
      assert.equal(second.already_suppressed_count, 2);
      assert.equal(second.candidate_updated, false);
      // Sigue liquidado: una repetición no puede reportarse como fallo.
      assert.equal(second.candidate_settled, true);

      const after = await snapshot();
      // Byte por byte lo mismo: `suppressed_at`, `suppression_reason` y
      // `suppressed_by` de la PRIMERA supresión no se reescriben.
      assert.deepEqual(after.phones, before.phones);
      assert.equal(after.candidate!.phone, null);
      assert.equal(after.sources.length, 2, 'no se duplica ni se borra provenance');
    });

    it('una tercera pasada tampoco introduce un principal arbitrario', async () => {
      const third = await callRpc();
      assert.equal(third.status, 'already_suppressed');
      assert.equal(third.primary_dedupe_key, null);
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.contact_enrichment_candidate_phones
         WHERE candidate_id = $1 AND is_primary`,
        [CANDIDATE_ID],
      );
      assert.equal(rows[0].n, 0);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 21.5 — ROLLBACK
  // ═════════════════════════════════════════════════════════════

  describe('§ 21.5 · rollback total ante un fallo inyectado', () => {
    it('fallo TRAS el tombstone y ANTES de la reelección ⇒ nada escrito', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      const before = await snapshot();

      // El trigger salta en la PROMOCIÓN (`NEW.is_primary`), que ocurre después de
      // que los tombstones ya están escritos en la transacción.
      await client.query(`SELECT set_config('sellup.inject', 'primary', false)`);
      const state = await sqlstateOf(() =>
        callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE }),
      );
      assert.notEqual(state, null, 'la función debía fallar con el trigger activo');
      await client.query(`SELECT set_config('sellup.inject', '', false)`);

      const after = await snapshot();
      // El tombstone del móvil NO quedó: la transacción entera se deshizo.
      assert.deepEqual(after.phones, before.phones);
      assert.equal(after.candidate!.phone, MOBILE);
      assert.equal(after.sources.length, before.sources.length);
    });

    it('fallo TRAS la reelección y ANTES del escalar ⇒ nada escrito', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      const before = await snapshot();

      await client.query(`SELECT set_config('sellup.inject', 'candidate', false)`);
      const state = await sqlstateOf(() => callRpc());
      assert.notEqual(state, null, 'la función debía fallar con el trigger activo');
      await client.query(`SELECT set_config('sellup.inject', '', false)`);

      const after = await snapshot();
      // Ni un tombstone: la supresión es todo o nada.
      assert.deepEqual(after.phones, before.phones);
      assert.equal(after.candidate!.phone, MOBILE);
      for (const row of after.phones) {
        assert.equal(row.suppressed_at, null);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 21.6 — concurrencia
  // ═════════════════════════════════════════════════════════════

  describe('§ 21.6 · dos supresiones concurrentes del mismo candidato', () => {
    it('serializan: sin principal inconsistente, sin resurrección', async () => {
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );

      const second = postgres.getPgClient();
      await second.connect();
      try {
        const results = await Promise.all([
          callRpc({}, FN, client),
          callRpc({ suppressedAt: LATER }, FN, second),
        ]);
        const statuses = results.map((r) => r.status).sort();
        // Una gana y suprime; la otra ve los tombstones ya escritos.
        assert.deepEqual(statuses, ['already_suppressed', 'suppressed']);
        const winner = results.find((r) => r.status === 'suppressed')!;
        assert.equal(winner.suppressed_count, 2);
        const loser = results.find((r) => r.status === 'already_suppressed')!;
        assert.equal(loser.suppressed_count, 0);
        assert.equal(loser.already_suppressed_count, 2);
      } finally {
        await second.end().catch(() => {});
      }

      const state = await snapshot();
      assert.equal(state.phones.length, 2);
      assert.equal(state.phones.filter((r) => r.is_primary).length, 0);
      for (const row of state.phones) {
        assert.equal(row.normalized_phone, null);
        // El instante del GANADOR, no una mezcla de los dos.
        assert.notEqual(row.suppressed_at, null);
      }
      assert.equal(state.candidate!.phone, null);
      assert.equal(state.sources.length, 2);
    });

    it('el lock del candidato es real: una segunda sesión no puede tomarlo', async () => {
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const second = postgres.getPgClient();
      await second.connect();
      try {
        await client.query('BEGIN');
        // Alcance `exact_phone` con clave ausente: la función NO actualiza el
        // candidato, así que el único lock que puede quedar es el FOR UPDATE.
        const result = await callRpc(
          { scope: 'exact_phone', dedupeKey: KEY_ABSENT },
          FN,
          client,
        );
        assert.equal(result.status, 'no_matching_phone_rows');
        const state = await sqlstateOf(() =>
          second.query(
            'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE NOWAIT',
            [CANDIDATE_ID],
          ),
        );
        assert.equal(state, LOCK_NOT_AVAILABLE, 'el FOR UPDATE debe retener la fila');
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        await second.end().catch(() => {});
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 22 — CHECK y constraints REALES
  // ═════════════════════════════════════════════════════════════

  describe('§ 22 · constraints de la migración 109 y 112', () => {
    it('`tombstone_is_empty`: no se puede suprimir conservando el número', async () => {
      await seed([{ key: KEY_MOBILE, number: MOBILE, type: 'mobile' }]);
      const state = await sqlstateOf(() =>
        client.query(
          `UPDATE public.contact_enrichment_candidate_phones
              SET suppressed_at = now(), suppression_reason = 'data_subject_request'
            WHERE candidate_id = $1 AND dedupe_key = $2`,
          [CANDIDATE_ID, KEY_MOBILE],
        ),
      );
      assert.equal(state, CHECK_VIOLATION);
    });

    it('`primary_requires_live_number`: un tombstone no puede ser principal', async () => {
      await seed([{ key: KEY_MOBILE, number: null, type: null, suppressed: true }]);
      const state = await sqlstateOf(() =>
        client.query(
          `UPDATE public.contact_enrichment_candidate_phones
              SET is_primary = true WHERE candidate_id = $1 AND dedupe_key = $2`,
          [CANDIDATE_ID, KEY_MOBILE],
        ),
      );
      assert.equal(state, CHECK_VIOLATION);
    });

    it('índice parcial de UN principal: dos principales no caben', async () => {
      await seed([
        { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true },
        { key: KEY_WORK, number: WORK, type: 'work' },
      ]);
      const state = await sqlstateOf(() =>
        client.query(
          `UPDATE public.contact_enrichment_candidate_phones
              SET is_primary = true WHERE candidate_id = $1 AND dedupe_key = $2`,
          [CANDIDATE_ID, KEY_WORK],
        ),
      );
      assert.equal(state, UNIQUE_VIOLATION);
    });

    it('CHECK de `suppression_reason`: el vocabulario de la CACHÉ es rechazado', async () => {
      // Este es el 23514 que un pass-through produciría en el 100% de las filas.
      await seed([{ key: KEY_MOBILE, number: MOBILE, type: 'mobile' }]);
      const state = await sqlstateOf(() =>
        client.query(
          `UPDATE public.contact_enrichment_candidate_phones
              SET normalized_phone = NULL, display_phone = NULL, phone_type = NULL,
                  is_primary = false, suppressed_at = now(),
                  suppression_reason = 'dsar_erasure_request'
            WHERE candidate_id = $1 AND dedupe_key = $2`,
          [CANDIDATE_ID, KEY_MOBILE],
        ),
      );
      assert.equal(state, CHECK_VIOLATION);
    });

    it('la RPC rechaza ese mismo motivo ANTES de escribir, no con un 23514', async () => {
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const result = await callRpc({ reason: 'dsar_erasure_request' });
      assert.equal(result.status, 'invalid_input');
      assert.equal(result.detail, 'suppression_reason_unknown');
      const state = await snapshot();
      assert.equal(state.phones[0].suppressed_at, null, 'nada escrito');
      assert.equal(state.candidate!.phone, MOBILE);
    });

    it('FK del candidato: no se puede insertar un teléfono huérfano', async () => {
      const state = await sqlstateOf(() =>
        client.query(
          `INSERT INTO public.contact_enrichment_candidate_phones
             (candidate_id, dedupe_key, phone_status)
           VALUES ('00000000-0000-4000-8000-000000000000', $1, 'unknown')`,
          [KEY_ABSENT],
        ),
      );
      assert.equal(state, FK_VIOLATION);
    });

    it('el contador de la auditoría existe, es NOT NULL y rechaza negativos', async () => {
      const { rows } = await client.query(
        `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'phone_reveal_suppression_audit'
           AND column_name = 'candidate_phone_rows_suppressed'`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].is_nullable, 'NO');
      assert.match(String(rows[0].column_default), /^0/);

      const state = await sqlstateOf(() =>
        client.query(
          `INSERT INTO public.phone_reveal_suppression_audit
             (provider_person_id_hash, reason_code, candidate_phone_rows_suppressed)
           VALUES ($1, 'dsar_erasure_request', -1)`,
          ['ab'.repeat(32)],
        ),
      );
      assert.equal(state, CHECK_VIOLATION);
    });

    it('la 112 no escribió ni una fila de auditoría por su cuenta', async () => {
      const { rows } = await client.query(
        'SELECT COUNT(*)::int AS n FROM public.phone_reveal_suppression_audit',
      );
      assert.equal(rows[0].n, 0);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 6 — privilegios
  // ═════════════════════════════════════════════════════════════

  describe('§ 6 · privilegios de ejecución y ceiling de la 109', () => {
    for (const role of ['anon', 'authenticated']) {
      it(`${role} NO puede ejecutar la función`, async () => {
        await client.query('BEGIN');
        try {
          await client.query(`SET LOCAL ROLE ${role}`);
          const state = await sqlstateOf(() => callRpc({}, FN, client));
          assert.equal(state, INSUFFICIENT_PRIVILEGE);
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }

    it('service_role SÍ puede ejecutarla', async () => {
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE service_role');
        const result = await callRpc({}, FN, client);
        assert.equal(result.status, 'suppressed');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('SECURITY INVOKER: ni service_role puede BORRAR una fila de teléfono', async () => {
      // Es el control principal de este hito: borrar un tombstone desbloquearía el
      // número. La 109 no concede DELETE y la función corre bajo ese techo.
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE service_role');
        const state = await sqlstateOf(() =>
          client.query(
            'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
            [CANDIDATE_ID],
          ),
        );
        assert.equal(state, INSUFFICIENT_PRIVILEGE);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('ni service_role puede REESCRIBIR o borrar una procedencia', async () => {
      // Una sentencia por transacción: en PostgreSQL el PRIMER error aborta la
      // transacción, así que un segundo statement en el mismo bloque devolvería
      // 25P02 («transacción abortada») y el test mediría el aborto en vez del
      // privilegio.
      for (const statement of [
        `UPDATE public.contact_enrichment_candidate_phone_sources
            SET raw_provider_type = 'tampered'`,
        'DELETE FROM public.contact_enrichment_candidate_phone_sources',
      ]) {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE service_role');
          const state = await sqlstateOf(() => client.query(statement));
          assert.equal(state, INSUFFICIENT_PRIVILEGE, statement);
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });

    it('la función es SECURITY INVOKER en el catálogo, no DEFINER', async () => {
      const { rows } = await client.query(
        `SELECT prosecdef, proconfig FROM pg_proc WHERE proname = $1`,
        [FN],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].prosecdef, false);
      assert.deepEqual(rows[0].proconfig, ['search_path=pg_catalog, pg_temp']);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 2 — la costura con la 110 queda CERRADA
  // ═════════════════════════════════════════════════════════════

  describe('§ 2 · la RPC 110 ya no puede resucitar el número suprimido', () => {
    it('tras la supresión, un callback de Apollo con el mismo número falla cerrado', async () => {
      // 1. La colección se llena por el camino REAL: la transacción de la 110.
      await client.query(`SELECT set_config('sellup.inject', '', false)`);
      await client.query(
        'DELETE FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1',
        [CANDIDATE_ID],
      );
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone = NULL, enrichment_metadata = '{}'::jsonb,
                phone_reveal_status = 'pending', phone_reveal_request_id = 'req-e2',
                phone_reveal_error_code = NULL
          WHERE id = $1`,
        [CANDIDATE_ID],
      );

      const persist = async () => {
        const { rows } = await client.query(
          `SELECT public.persist_candidate_apollo_phone_reveal_result(
             p_candidate_id                     => $1::uuid,
             p_expected_request_id              => 'req-e2',
             p_reveal_phase                     => 'webhook',
             p_observed_at                      => $2::timestamptz,
             p_phones                           => $3::jsonb,
             p_sources                          => $4::jsonb,
             p_primary_candidates               => $5::jsonb,
             p_legacy_phone                     => $6::text,
             p_legacy_phone_type                => 'mobile',
             p_legacy_raw_type                  => 'mobile',
             p_legacy_dedupe_key                => $7::text,
             p_phone_reveal_status              => 'revealed',
             p_phone_reveal_provider            => 'apollo',
             p_phone_revealed_at                => $2::timestamptz,
             p_phone_reveal_completed_at        => $2::timestamptz,
             p_phone_reveal_webhook_received_at => $2::timestamptz,
             p_phone_reveal_last_checked_at     => NULL,
             p_phone_reveal_cost_credits        => 8,
             p_phone_reveal_cost_source         => 'reported',
             p_phone_reveal_error_code          => NULL,
             p_phone_processing_basis           => NULL,
             p_apollo_person_id                 => NULL
           ) AS result`,
          [
            CANDIDATE_ID,
            NOW,
            JSON.stringify([
              {
                dedupe_key: KEY_MOBILE,
                normalized_phone: MOBILE,
                display_phone: MOBILE,
                phone_type: 'mobile',
                phone_status: 'valid',
                first_seen_at: NOW,
                last_seen_at: NOW,
              },
            ]),
            JSON.stringify([
              {
                dedupe_key: KEY_MOBILE,
                provider: 'apollo',
                acquisition_mode: 'reveal',
                raw_provider_type: 'mobile',
                raw_provider_status: 'valid',
                waterfall_run_id: null,
                reservation_id: null,
                provider_usage_log_id: null,
                source_event_key: 'v1:apollo:reveal:webhook:e2',
                observed_at: NOW,
              },
            ]),
            JSON.stringify([
              { dedupe_key: KEY_MOBILE, phone: MOBILE, phone_type: 'mobile', raw_type: 'mobile' },
            ]),
            MOBILE,
            KEY_MOBILE,
          ],
        );
        return rows[0].result as Record<string, unknown>;
      };

      const first = await persist();
      assert.equal(first.status, 'persisted');
      let state = await snapshot();
      assert.equal(state.candidate!.phone, MOBILE);
      assert.equal(state.phones.filter((r) => r.is_primary).length, 1);

      // 2. La DSAR — que ANTES de 4O-E2 no tocaba esta tabla.
      const suppression = await callRpc();
      assert.equal(suppression.status, 'suppressed');
      assert.equal(suppression.suppressed_count, 1);
      state = await snapshot();
      assert.equal(state.candidate!.phone, null);
      assert.equal(state.phones[0].normalized_phone, null);

      // 3. El mismo callback vuelve (reproceso, o un reveal nuevo del mismo número).
      //    Antes: encontraba la fila VIVA, la elegía principal y devolvía el número
      //    al escalar. Ahora la 110 ve un tombstone y falla CERRADO sin terminalizar.
      await client.query(
        `UPDATE public.contact_enrichment_candidates
            SET phone_reveal_status = 'pending', phone_reveal_request_id = 'req-e2'
          WHERE id = $1`,
        [CANDIDATE_ID],
      );
      const replay = await persist();
      assert.equal(replay.status, 'suppressed', 'la 110 debe fallar cerrado');
      assert.equal(replay.candidate_terminalized, false);

      state = await snapshot();
      assert.equal(state.candidate!.phone, null, 'el número NO vuelve al escalar');
      assert.equal(state.phones[0].normalized_phone, null);
      assert.equal(state.phones[0].is_primary, false);
      assert.equal(
        (state.candidate!.enrichment_metadata as Record<string, unknown>).phone,
        undefined,
      );
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 22 — MUTACIONES sobre el SQL real
  // ═════════════════════════════════════════════════════════════

  describe('§ 22 · mutaciones: cada línea protegida es load-bearing', () => {
    it('quitar `normalized_phone = NULL` rompe: el tombstone conservaría el número', async () => {
      await applyMutatedFunction('mut_no_null_phone', (sql) =>
        sql.replace(
          '     SET normalized_phone   = NULL,\n         display_phone      = NULL,',
          '     SET display_phone      = NULL,',
        ),
      );
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const state = await sqlstateOf(() => callRpc({}, 'mut_no_null_phone'));
      // La CHECK `tombstone_is_empty` lo rechaza: la regla es una REGLA, no una
      // intención del código.
      assert.equal(state, CHECK_VIOLATION);
      // Y el rollback deja el número intacto en vez de a medias.
      const after = await snapshot();
      assert.equal(after.phones[0].normalized_phone, MOBILE);
      assert.equal(after.phones[0].suppressed_at, null);
    });

    it('quitar `is_primary = false` rompe: el tombstone seguiría siendo principal', async () => {
      await applyMutatedFunction('mut_no_demote', (sql) =>
        sql.replace('         is_primary         = false,\n', ''),
      );
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const state = await sqlstateOf(() => callRpc({}, 'mut_no_demote'));
      assert.equal(state, CHECK_VIOLATION);
      const after = await snapshot();
      assert.equal(after.phones[0].is_primary, true, 'rollback completo');
      assert.equal(after.phones[0].suppressed_at, null);
    });

    it('quitar la validación del motivo produce el 23514 en vez de invalid_input', async () => {
      await applyMutatedFunction('mut_no_reason_gate', (sql) =>
        sql.replace(
          /IF p_suppression_reason IS NULL\s*\n\s*OR NOT \(p_suppression_reason = ANY \(c_reasons\)\) THEN[\s\S]*?END IF;/,
          '',
        ),
      );
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const state = await sqlstateOf(() =>
        callRpc({ reason: 'dsar_erasure_request' }, 'mut_no_reason_gate'),
      );
      assert.equal(
        state,
        CHECK_VIOLATION,
        'sin la validación, el pass-through del vocabulario de la caché es un 23514',
      );
    });

    it('quitar la reelección deja el escalar en null habiendo superviviente', async () => {
      await applyMutatedFunction('mut_no_reelection', (sql) =>
        // Se hace inelegible a TODA fila: la elección nunca encuentra nada.
        sql.replace(
          "    AND p.phone_status <> 'invalid'\n  ORDER BY",
          "    AND p.phone_status <> 'invalid'\n    AND false\n  ORDER BY",
        ),
      );
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      const result = await callRpc(
        { scope: 'exact_phone', dedupeKey: KEY_MOBILE },
        'mut_no_reelection',
      );
      // El defecto que la reelección evita, hecho visible: hay un número vivo y
      // elegible y sin embargo el candidato se queda sin teléfono y sin principal.
      assert.equal(result.candidate_phone_cleared, true);
      const after = await snapshot();
      const work = after.phones.find((r) => r.dedupe_key === KEY_WORK)!;
      assert.equal(work.normalized_phone, WORK, 'el superviviente sigue vivo…');
      assert.equal(work.is_primary, false, '…pero huérfano');
      assert.equal(after.candidate!.phone, null);

      // Y con la función REAL, el mismo caso sí promueve.
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      const real = await callRpc({ scope: 'exact_phone', dedupeKey: KEY_MOBILE });
      assert.equal(real.primary_dedupe_key, KEY_WORK);
      assert.equal((await snapshot()).candidate!.phone, WORK);
    });

    it('quitar el `FOR UPDATE` deja de retener la fila del candidato', async () => {
      await applyMutatedFunction('mut_no_lock', (sql) =>
        sql.replace(
          '  WHERE c.id = p_candidate_id\n  FOR UPDATE;',
          '  WHERE c.id = p_candidate_id;',
        ),
      );
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const second = postgres.getPgClient();
      await second.connect();
      try {
        await client.query('BEGIN');
        // Mismo camino que la prueba del lock real: `exact_phone` con clave ausente
        // no actualiza el candidato, así que el ÚNICO lock posible es el FOR UPDATE.
        const result = await callRpc(
          { scope: 'exact_phone', dedupeKey: KEY_ABSENT },
          'mut_no_lock',
          client,
        );
        assert.equal(result.status, 'no_matching_phone_rows');
        const state = await sqlstateOf(() =>
          second.query(
            'SELECT id FROM public.contact_enrichment_candidates WHERE id = $1 FOR UPDATE NOWAIT',
            [CANDIDATE_ID],
          ),
        );
        assert.equal(state, null, 'sin FOR UPDATE la fila queda libre: el lock es real');
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        await second.end().catch(() => {});
      }
    });

    it('quitar el guard de `dedupe_key_not_allowed` ensancharía una petición dirigida', async () => {
      await applyMutatedFunction('mut_no_scope_guard', (sql) =>
        sql.replace(
          /IF p_scope = 'all_candidate_phones' AND p_dedupe_key IS NOT NULL THEN[\s\S]*?END IF;/,
          '',
        ),
      );
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      // Un llamador que cree estar borrando UN número acaba borrando los dos.
      const mutated = await callRpc(
        { scope: 'all_candidate_phones', dedupeKey: KEY_MOBILE },
        'mut_no_scope_guard',
      );
      assert.equal(mutated.suppressed_count, 2, 'sobre-supresión silenciosa');

      // Con la función REAL la misma llamada se rechaza sin escribir.
      await seed(
        [
          { key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' },
          { key: KEY_WORK, number: WORK, type: 'work' },
        ],
        { phone: MOBILE },
      );
      const real = await callRpc({ scope: 'all_candidate_phones', dedupeKey: KEY_MOBILE });
      assert.equal(real.status, 'invalid_input');
      assert.equal(real.detail, 'dedupe_key_not_allowed');
      assert.equal((await snapshot()).phones[0].suppressed_at, null);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // § 7 — validación y alcance
  // ═════════════════════════════════════════════════════════════

  describe('§ 7 · validación fail-closed y alcance por run', () => {
    it('un candidato inexistente no escribe nada', async () => {
      const result = await callRpc({
        candidateId: '00000000-0000-4000-8000-000000000000',
      });
      assert.equal(result.status, 'candidate_not_found');
      assert.equal(result.detail, 'candidate_missing');
    });

    it('un run que no es el del candidato no autoriza tocarlo (FIX M2/M3)', async () => {
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const result = await callRpc({ expectedRunId: OTHER_RUN_ID });
      assert.equal(result.status, 'candidate_not_found');
      assert.equal(result.detail, 'enrichment_run_mismatch');
      const state = await snapshot();
      assert.equal(state.phones[0].suppressed_at, null);
      assert.equal(state.candidate!.phone, MOBILE);
    });

    it('un run null no restringe: la supresión procede', async () => {
      const result = await callRpc({ expectedRunId: null });
      assert.equal(result.status, 'suppressed');
    });

    const INVALID_INPUTS: ReadonlyArray<
      readonly [Parameters<typeof callRpc>[0], string]
    > = [
      [{ candidateId: null }, 'candidate_id_missing'],
      [{ scope: 'everything' }, 'scope_unknown'],
      [{ scope: 'exact_phone', dedupeKey: null }, 'dedupe_key_missing'],
      [{ scope: 'exact_phone', dedupeKey: '   ' }, 'dedupe_key_missing'],
      [{ scope: 'all_candidate_phones', dedupeKey: KEY_MOBILE }, 'dedupe_key_not_allowed'],
      [{ reason: 'operator' }, 'suppression_reason_unknown'],
      [{ reason: null }, 'suppression_reason_unknown'],
      [{ suppressedAt: null }, 'suppressed_at_missing'],
    ];

    for (const [args, detail] of INVALID_INPUTS) {
      it(`entrada inválida ⇒ invalid_input/${detail}, sin escribir`, async () => {
        await seed(
          [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
          { phone: MOBILE },
        );
        const result = await callRpc(args);
        assert.equal(result.status, 'invalid_input');
        assert.equal(result.detail, detail);
        const state = await snapshot();
        assert.equal(state.phones[0].suppressed_at, null);
        assert.equal(state.candidate!.phone, MOBILE);
      });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // § 16 / § 26 — privacidad y alcance de escritura
  // ═════════════════════════════════════════════════════════════

  describe('§ 16 · el sobre no lleva PII y nada más se escribe', () => {
    it('el sobre no contiene ningún número, ni display, ni el motivo crudo', async () => {
      await seed(
        [{ key: KEY_MOBILE, number: MOBILE, type: 'mobile', primary: true, status: 'valid' }],
        { phone: MOBILE },
      );
      const result = await callRpc();
      const serialized = JSON.stringify(result);
      for (const number of [MOBILE, WORK, HQ]) {
        assert.equal(serialized.includes(number), false);
      }
      assert.equal(/\+\d{7,}/.test(serialized), false);
    });

    it('la función no escribió en contabilidad, caché ni contactos', async () => {
      for (const table of [
        'phone_reveal_waterfall_runs',
        'phone_reveal_credit_reservations',
        'provider_usage_logs',
        'phone_reveal_suppression_audit',
      ]) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM public.${table}`);
        assert.equal(rows[0].n, 0, `${table} debería seguir vacía`);
      }
    });
  });
});
