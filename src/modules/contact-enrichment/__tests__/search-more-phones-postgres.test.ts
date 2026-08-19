// Agente 2A — LA MIGRACIÓN 122 CONTRA UN PostgreSQL DE VERDAD
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTA SUITE EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Un lexer de SQL escrito en TypeScript mide PARIDAD de comillas, no validez sintáctica:
// el defecto real que hizo fallar la 120 con SQLSTATE 42601 dejaba la paridad INTACTA. La
// única prueba que no se puede falsear es EJECUTAR la migración. Esta suite la aplica
// VERBATIM desde `supabase/migrations` sobre la cadena real, y después ejercita el
// comportamiento que la 122 promete — porque una migración que aplica pero cuya función
// hace lo contrario de lo documentado pasaría igual un test de aplicabilidad.
//
// LA CADENA. `PHONE_REVEAL_REAL_CHAIN` no sirve tal cual: su bootstrap crea
// `phone_reveal_waterfall_runs` como STUB de una sola columna, porque la 120 no la toca.
// La 122 SÍ la toca — ensancha tres CHECKs suyos — así que el stub se descarta y se aplican
// las 102/103 REALES antes de la 109 (que las referencia por FK).
//
// La 104 se queda FUERA y el stub de `phone_reveal_credit_reservations` se conserva: la 122
// no nombra esa tabla ni su función, así que aplicarla sería decorar la cadena en vez de
// reproducirla. La 121 también queda fuera, y por el mismo criterio: opera sobre
// `wizard_budget_reservations`, que no pertenece al subsistema de teléfono ni aparece en
// ninguna sección de la 122.
//
// SIN PII y SIN PROVEEDORES. Los números son sintéticos, no hay red, no hay Supabase
// remoto, no se llama a Apollo ni a Lusha y no se gasta un crédito.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  applyPhoneRevealRealChain,
  bootstrapPlatform,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/phone-reveal-real-migration-chain';
import { normalizeCandidatePhone } from '../phone-collection-core';

/**
 * Lector TIPADO sobre el cliente compartido, cuyo `query` devuelve
 * `Record<string, unknown>[]` a propósito. Se envuelve aquí en vez de ensanchar el tipo de
 * `support/`, del que dependen otras suites: un cambio allí para comodidad de esta suite
 * relajaría el tipo de todas las demás.
 */
async function rowsOf<T>(
  c: PgLikeClient,
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  const { rows } = await c.query(sql, values);
  return rows as T[];
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '../../../..');

/** El hito. Se separa para poder re-aplicarlo y probar idempotencia. */
const MIGRATION_122 = '122_phone_reveal_search_more.sql';

/**
 * La cadena real de la que depende la 122. El orden importa: la 109 declara FKs contra
 * `phone_reveal_waterfall_runs`, así que la 102 va antes.
 */
const SEARCH_MORE_CHAIN = [
  '099_apollo_phone_reveal_cache.sql',
  '107_phone_reveal_cache_and_suppression_grants.sql',
  '102_phone_reveal_waterfall_runs.sql',
  '103_phone_reveal_waterfall_legacy_mode.sql',
  '109_contact_enrichment_candidate_phones.sql',
  '110_persist_candidate_apollo_phone_reveal_result.sql',
  '111_persist_candidate_lusha_phone_reveal_result.sql',
  '112_suppress_candidate_phone_collection.sql',
  '113_phone_reveal_person_suppression_recheck.sql',
  '114_official_contact_phones.sql',
  '115_official_contact_phone_privacy.sql',
  '120_provider_native_phone_suppression.sql',
  MIGRATION_122,
] as const;

const { ctor: EmbeddedPostgresCtor, skip } = resolveEmbeddedPostgres(import.meta.url);

describe('AGENT2A-SEARCH-MORE-PHONES-1 · migración 122 en PostgreSQL real', { skip }, () => {
  let pg: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir: string;
  /** Último candidato sembrado. Lo usa el test de vocabulario cerrado, que no siembra. */
  let seededCandidateId = '';

  before(async () => {
    assert.ok(EmbeddedPostgresCtor, 'el arnés debía estar resuelto');
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-search-more-pg-'));
    pg = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 55_432 + Math.floor(process.pid % 500),
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    client = pg.getPgClient();
    await client.connect();

    await bootstrapPlatform(client);
    // El stub de una sola columna se descarta: la 122 ensancha CHECKs de columnas REALES
    // que sólo existen si la 102/103 se aplican de verdad.
    await client.query('DROP TABLE IF EXISTS public.phone_reveal_waterfall_runs CASCADE');
    await applyPhoneRevealRealChain(client, REPO_ROOT, SEARCH_MORE_CHAIN);
  });

  after(async () => {
    try {
      await client.query('SELECT 1');
      await pg?.stop?.();
    } catch {
      /* el motor ya estaba caído */
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. Aplicabilidad e idempotencia
  // ─────────────────────────────────────────────────────────────────

  it('aplica sobre la cadena real (si no, `before` ya habría fallado con archivo y SQLSTATE)', () => {
    assert.ok(client, 'la cadena completa se aplicó');
  });

  it('es idempotente: re-aplicarla no lanza', async () => {
    const { readMigration } = await import('./support/phone-reveal-real-migration-chain');
    await client.query(readMigration(REPO_ROOT, MIGRATION_122));
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. Los tres vocabularios ensanchados quedan VALIDADOS
  // ─────────────────────────────────────────────────────────────────

  it('los tres CHECKs ensanchados quedan convalidated (sin mantenimiento pendiente)', async () => {
    const rows = await rowsOf<{ conname: string; convalidated: boolean }>(client, 
      `SELECT conname, convalidated FROM pg_constraint
        WHERE conname IN (
          'phone_reveal_waterfall_runs_run_mode_check',
          'phone_reveal_waterfall_runs_lusha_outcome_check',
          'phone_reveal_waterfall_runs_lusha_skipped_reason_check'
        ) ORDER BY conname`,
    );
    assert.equal(rows.length, 3, 'los tres CHECKs existen');
    for (const row of rows) {
      assert.equal(row.convalidated, true, `${row.conname} quedó sin validar`);
    }
  });

  it('acepta run_mode=search_more y sigue aceptando las dos modalidades previas', async () => {
    const runIds: string[] = [];
    for (const mode of ['full_waterfall', 'legacy_lusha_only', 'search_more']) {
      const rows = await rowsOf<{ id: string }>(client, 
        `INSERT INTO public.phone_reveal_waterfall_runs
           (candidate_id, status, authorized_by, max_credits_authorized, run_mode)
         VALUES ($1, 'authorized', gen_random_uuid(), 5, $2) RETURNING id`,
        [await seedCandidate(client), mode],
      );
      runIds.push(rows[0].id);
    }
    assert.equal(runIds.length, 3);
  });

  it('RECHAZA un run_mode inventado (el vocabulario sigue cerrado)', async () => {
    await assert.rejects(
      () =>
        client.query(
          `INSERT INTO public.phone_reveal_waterfall_runs
             (candidate_id, status, authorized_by, max_credits_authorized, run_mode)
           VALUES ($1, 'authorized', gen_random_uuid(), 5, 'buscar_mas')`,
          [seededCandidateId],
        ),
      /run_mode_check/,
    );
  });

  it('acepta lusha_outcome=no_new_distinct_phone y rechaza uno inventado', async () => {
    const candidateId = await seedCandidate(client);
    await client.query(
      `INSERT INTO public.phone_reveal_waterfall_runs
         (candidate_id, status, authorized_by, max_credits_authorized, run_mode, lusha_outcome)
       VALUES ($1, 'exhausted', gen_random_uuid(), 5, 'search_more', 'no_new_distinct_phone')`,
      [candidateId],
    );
    const otherCandidateId = await seedCandidate(client);
    await assert.rejects(
      () =>
        client.query(
          `INSERT INTO public.phone_reveal_waterfall_runs
             (candidate_id, status, authorized_by, max_credits_authorized, run_mode, lusha_outcome)
           VALUES ($1, 'exhausted', gen_random_uuid(), 5, 'search_more', 'sin_numeros_nuevos')`,
          [otherCandidateId],
        ),
      /lusha_outcome_check/,
    );
  });

  it('acepta lusha_skipped_reason=providers_exhausted', async () => {
    await client.query(
      `INSERT INTO public.phone_reveal_waterfall_runs
         (candidate_id, status, authorized_by, max_credits_authorized, run_mode, lusha_skipped_reason)
       VALUES ($1, 'exhausted', gen_random_uuid(), 5, 'search_more', 'providers_exhausted')`,
      [await seedCandidate(client)],
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Privilegios: service_role y nadie más
  // ─────────────────────────────────────────────────────────────────

  it('sólo service_role puede EJECUTAR la función de append', async () => {
    const rows = await rowsOf<{ role: string; allowed: boolean }>(client, 
      `SELECT r.rolname AS role,
              has_function_privilege(
                r.rolname,
                'public.append_candidate_search_more_phones(uuid,timestamptz,jsonb,jsonb,jsonb)',
                'EXECUTE') AS allowed
         FROM pg_roles r
        WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
        ORDER BY r.rolname`,
    );
    const byRole = new Map(rows.map((r) => [r.role, r.allowed]));
    assert.equal(byRole.get('service_role'), true, 'service_role debe poder ejecutar');
    assert.equal(byRole.get('anon'), false, 'anon NO debe poder ejecutar');
    assert.equal(byRole.get('authenticated'), false, 'authenticated NO debe poder ejecutar');
  });

  it('es SECURITY INVOKER, para que el techo de privilegios de la 109 siga aplicando', async () => {
    const rows = await rowsOf<{ prosecdef: boolean }>(client, 
      `SELECT prosecdef FROM pg_proc WHERE proname = 'append_candidate_search_more_phones'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prosecdef, false, 'debe ser SECURITY INVOKER, no DEFINER');
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. EL COMPORTAMIENTO. Es lo que separa «aplica» de «hace lo prometido».
  // ─────────────────────────────────────────────────────────────────

  it('APPEND: un número nuevo de rango INFERIOR se añade y el principal NO cambia', async () => {
    const candidateId = await seedCandidate(client);
    // Incumbente: un móvil de Apollo, ya principal y ya visible.
    await seedApolloPrimary(client, candidateId, '+573001112233', 'mobile');

    const work = '+5716017654321';
    const result = await appendSearchMore(client, candidateId, {
      phones: [phoneRow(work, 'work', 'valid')],
      sources: [sourceRow(work, 'lusha')],
      primaryCandidates: [primaryRow(work, work, 'work')],
    });

    assert.equal(result.status, 'persisted');
    assert.equal(result.inserted_phone_count, 1, 'el número nuevo se insertó');
    assert.equal(result.new_distinct_phone_count, 1);
    assert.equal(
      result.candidate_scalar_updated,
      false,
      'un work NO puede desplazar a un mobile',
    );

    const rows = await rowsOf<{ dedupe_key: string; is_primary: boolean }>(client, 
      `SELECT dedupe_key, is_primary FROM public.contact_enrichment_candidate_phones
        WHERE candidate_id = $1 ORDER BY is_primary DESC`,
      [candidateId],
    );
    assert.equal(rows.length, 2, 'la colección tiene los DOS números');
    assert.equal(rows.filter((r) => r.is_primary).length, 1, 'exactamente un principal');
    assert.equal(
      rows[0].dedupe_key,
      phoneOf('+573001112233'),
      'el principal sigue siendo el móvil de Apollo',
    );

    // El escalar y la procedencia del reveal siguen siendo los de Apollo.
    const candidate = await readCandidate(client, candidateId);
    assert.equal(candidate.phone, '+573001112233');
    assert.equal(candidate.phone_reveal_provider, 'apollo');
    assert.equal(candidate.phone_reveal_cost_credits, 8);
  });

  it('PRIMARY: un número nuevo de rango SUPERIOR sí pasa a principal', async () => {
    const candidateId = await seedCandidate(client);
    await seedApolloPrimary(client, candidateId, '+5716011234567', 'work');

    const mobile = '+573009998877';
    const result = await appendSearchMore(client, candidateId, {
      phones: [phoneRow(mobile, 'mobile', 'valid')],
      sources: [sourceRow(mobile, 'lusha')],
      primaryCandidates: [primaryRow(mobile, mobile, 'mobile')],
    });

    assert.equal(result.status, 'persisted');
    assert.equal(result.candidate_scalar_updated, true, 'un mobile mejora a un work');
    assert.equal(result.primary_dedupe_key, phoneOf(mobile));

    const candidate = await readCandidate(client, candidateId);
    assert.equal(candidate.phone, mobile, 'el escalar sigue al principal');
    // Y AUN ASÍ la procedencia del reveal no se reescribe: el reveal lo cerró Apollo.
    assert.equal(
      candidate.phone_reveal_provider,
      'apollo',
      'search_more NUNCA reescribe phone_reveal_provider',
    );
    assert.equal(
      candidate.phone_reveal_cost_credits,
      8,
      'search_more NUNCA sobrescribe el costo del reveal',
    );
    assert.equal(
      candidate.enrichment_metadata.phone?.source,
      'search_more_reveal',
      'la metadata del número visible sí declara de dónde salió',
    );
  });

  it('DUPLICADO: el mismo número gana procedencia SIN duplicar la fila', async () => {
    const candidateId = await seedCandidate(client);
    await seedApolloPrimary(client, candidateId, '+573004445566', 'mobile');
    const dup = '+573004445566';

    const before = await readCandidate(client, candidateId);

    const result = await appendSearchMore(client, candidateId, {
      phones: [phoneRow(dup, 'mobile', 'unknown')],
      sources: [sourceRow(dup, 'lusha')],
      primaryCandidates: [primaryRow(dup, dup, 'mobile')],
    });

    assert.equal(result.status, 'persisted');
    assert.equal(result.inserted_phone_count, 0, 'no se inserta una segunda fila');
    assert.equal(
      result.new_distinct_phone_count,
      0,
      'CERO números nuevos: esto es no_new_distinct_phone',
    );
    assert.equal(result.updated_phone_count, 1, 'la fila existente se refrescó');
    assert.equal(result.inserted_source_count, 1, 'y ganó UNA procedencia nueva');

    const phones = await rowsOf<{ id: string; phone_status: string }>(client, 
      `SELECT id, phone_status FROM public.contact_enrichment_candidate_phones
        WHERE candidate_id = $1`,
      [candidateId],
    );
    assert.equal(phones.length, 1, 'UNA fila canónica');
    assert.equal(
      phones[0].phone_status,
      'valid',
      'un `unknown` de Lusha no degrada el `valid` de Apollo',
    );

    const sources = await rowsOf<{ provider: string }>(client, 
      `SELECT provider FROM public.contact_enrichment_candidate_phone_sources
        WHERE candidate_phone_id = $1 ORDER BY provider`,
      [phones[0].id],
    );
    assert.deepEqual(
      sources.map((s) => s.provider),
      ['apollo', 'lusha'],
      'DOS procedencias sobre UN número',
    );

    const after = await readCandidate(client, candidateId);
    assert.equal(after.phone, before.phone, 'el número visible no cambió');
    assert.equal(after.phone_reveal_provider, 'apollo');
  });

  it('IDEMPOTENCIA: repetir la MISMA respuesta no añade fila ni procedencia', async () => {
    const candidateId = await seedCandidate(client);
    await seedApolloPrimary(client, candidateId, '+573007778899', 'mobile');
    const extra = '+5716015554433';
    const payload = {
      phones: [phoneRow(extra, 'work', 'valid')],
      sources: [sourceRow(extra, 'lusha')],
      primaryCandidates: [primaryRow(extra, extra, 'work')],
    };

    const first = await appendSearchMore(client, candidateId, payload);
    assert.equal(first.inserted_phone_count, 1);
    assert.equal(first.inserted_source_count, 1);

    const second = await appendSearchMore(client, candidateId, payload);
    assert.equal(second.inserted_phone_count, 0, 'nada nuevo la segunda vez');
    assert.equal(second.new_distinct_phone_count, 0);
    assert.equal(
      second.inserted_source_count,
      0,
      'la MISMA source_event_key no vuelve a insertarse',
    );

    const rows = await rowsOf<{ count: string }>(client, 
      `SELECT COUNT(*) AS count FROM public.contact_enrichment_candidate_phones
        WHERE candidate_id = $1`,
      [candidateId],
    );
    assert.equal(rows[0].count, '2');
  });

  // Las DOS identidades nativas se prueban por separado, y eso es el punto del hito: un
  // candidato de «Buscar más números» lleva las dos en la MISMA fila, así que un tombstone
  // sobre CUALQUIERA de ellas tiene que bloquear. Si sólo se probara la de Lusha —la que
  // este flujo llama— un tombstone de Apollo podría pasar inadvertido y la persona
  // erasada recuperaría un teléfono.

  it('SUPRESIÓN por PERSONA (identidad LUSHA): 0 escrituras y el teléfono existente intacto', async () => {
    const lushaContactId = 'v1.lusha-suppressed-1';
    const candidateId = await seedCandidate(client, { sourceContactId: lushaContactId });
    await seedApolloPrimary(client, candidateId, '+573001010101', 'mobile');

    await client.query(
      `INSERT INTO public.provider_suppressions
         (provider, provider_person_id, suppressed_at, suppression_reason)
       VALUES ('lusha', $1, now(), 'test_synthetic')`,
      [lushaContactId],
    );

    const fresh = '+573002020202';
    const result = await appendSearchMore(client, candidateId, {
      phones: [phoneRow(fresh, 'mobile', 'valid')],
      sources: [sourceRow(fresh, 'lusha')],
      primaryCandidates: [primaryRow(fresh, fresh, 'mobile')],
    });

    assert.equal(result.status, 'suppressed', 'fail-closed bajo el lock');
    assert.equal(result.inserted_phone_count, 0);
    assert.equal(result.new_distinct_phone_count, 0);

    const rows = await rowsOf<{ count: string }>(client, 
      `SELECT COUNT(*) AS count FROM public.contact_enrichment_candidate_phones
        WHERE candidate_id = $1`,
      [candidateId],
    );
    assert.equal(rows[0].count, '1', 'el número nuevo NO se escribió');

    const candidate = await readCandidate(client, candidateId);
    assert.equal(
      candidate.phone,
      '+573001010101',
      'el teléfono que ya existía sigue visible: search_more nunca borra',
    );
  });

  it('SUPRESIÓN por PERSONA (identidad APOLLO del mismo candidato) también bloquea', async () => {
    // 24 hex: `phone_reveal_normalized_apollo_person_id` rechaza cualquier otra forma, así
    // que un id con guiones se normalizaría a NULL y la guarda quedaría sin clave.
    const apolloPersonId = 'a1b2c3d4e5f60718293a4b5c';
    const candidateId = await seedCandidate(client, { apolloPersonId });
    await seedApolloPrimary(client, candidateId, '+573001212121', 'mobile');

    await client.query(
      `INSERT INTO public.provider_suppressions
         (provider, provider_person_id, suppressed_at, suppression_reason)
       VALUES ('apollo', $1, now(), 'test_synthetic')`,
      [apolloPersonId],
    );

    const fresh = '+573002323232';
    const result = await appendSearchMore(client, candidateId, {
      phones: [phoneRow(fresh, 'mobile', 'valid')],
      sources: [sourceRow(fresh, 'lusha')],
      primaryCandidates: [primaryRow(fresh, fresh, 'mobile')],
    });

    assert.equal(
      result.status,
      'suppressed',
      'un tombstone de Apollo bloquea aunque el proveedor consultado sea Lusha',
    );
    assert.equal(result.inserted_phone_count, 0);

    const candidate = await readCandidate(client, candidateId);
    assert.equal(candidate.phone, '+573001212121', 'el teléfono existente sigue intacto');
  });

  it('TOMBSTONE por NÚMERO: un número erasado no revive ni gana procedencia', async () => {
    const candidateId = await seedCandidate(client);
    await seedApolloPrimary(client, candidateId, '+573003030303', 'mobile');

    const erased = '+573004040404';
    // Fila tombstone: existe, sin número, con `suppressed_at`.
    await client.query(
      `INSERT INTO public.contact_enrichment_candidate_phones
         (candidate_id, normalized_phone, display_phone, dedupe_key, phone_type,
          phone_status, is_primary, suppressed_at, first_seen_at, last_seen_at)
       VALUES ($1, NULL, NULL, $2, NULL, 'unknown', false, now(), now(), now())`,
      [candidateId, phoneOf(erased)],
    );

    const result = await appendSearchMore(client, candidateId, {
      phones: [phoneRow(erased, 'mobile', 'valid')],
      sources: [sourceRow(erased, 'lusha')],
      primaryCandidates: [primaryRow(erased, erased, 'mobile')],
    });

    assert.equal(result.status, 'persisted');
    assert.equal(result.suppressed_skipped_count, 1, 'se contó como saltado');
    assert.equal(result.inserted_source_count, 0, 'un tombstone NO gana procedencia');
    assert.equal(result.candidate_scalar_updated, false);

    const rows = await rowsOf<{ normalized_phone: string | null }>(client, 
      `SELECT normalized_phone FROM public.contact_enrichment_candidate_phones
        WHERE candidate_id = $1 AND dedupe_key = $2`,
      [candidateId, phoneOf(erased)],
    );
    assert.equal(rows[0].normalized_phone, null, 'el tombstone sigue vacío');
  });

  it('respuesta VACÍA: `no_incoming_phones`, distinto de «no hay números nuevos»', async () => {
    const candidateId = await seedCandidate(client);
    await seedApolloPrimary(client, candidateId, '+573005050505', 'mobile');

    const result = await appendSearchMore(client, candidateId, {
      phones: [],
      sources: [],
      primaryCandidates: [],
    });

    assert.equal(result.status, 'no_incoming_phones');
    assert.equal(result.new_distinct_phone_count, 0);
    assert.equal(result.candidate_scalar_updated, false);
  });

  it('la función NO puede borrar una fila de teléfono (techo de la 109 intacto)', async () => {
    const rows = await rowsOf<{ allowed: boolean }>(client, 
      `SELECT has_table_privilege(
                'service_role', 'public.contact_enrichment_candidate_phones', 'DELETE'
              ) AS allowed`,
    );
    assert.equal(rows[0].allowed, false, 'borrar una fila borraría un tombstone');
  });

  // ── Utilidades sintéticas ──────────────────────────────────────

  async function seedCandidate(
    c: PgLikeClient,
    opts: { apolloPersonId?: string; sourceContactId?: string } = {},
  ): Promise<string> {
    const runRows = await rowsOf<{ id: string }>(c, 
      `INSERT INTO public.contact_enrichment_runs (id) VALUES (gen_random_uuid()) RETURNING id`,
    );
    const rows = await rowsOf<{ id: string }>(c, 
      `INSERT INTO public.contact_enrichment_candidates
         (enrichment_run_id, source, source_contact_id, apollo_person_id,
          phone_reveal_status, phone_reveal_provider)
       VALUES ($1, 'lusha', $3, $2, 'revealed', 'apollo')
       RETURNING id`,
      [
        runRows[0].id,
        opts.apolloPersonId ?? null,
        // Único por candidato salvo que el test pida uno concreto:
        // `provider_suppressions` es global por (provider, provider_person_id), así que un
        // literal compartido filtraría el tombstone de un test a todos los demás.
        opts.sourceContactId ?? `v1.lusha-${randomUUID()}`,
      ],
    );
    seededCandidateId = rows[0].id;
    return rows[0].id;
  }

  /** El estado del que PARTE «Buscar más números»: un reveal de Apollo ya cerrado. */
  async function seedApolloPrimary(
    c: PgLikeClient,
    candidateId: string,
    phone: string,
    phoneType: string,
  ): Promise<void> {
    const key = phoneOf(phone);
    const rows = await rowsOf<{ id: string }>(c, 
      `INSERT INTO public.contact_enrichment_candidate_phones
         (candidate_id, normalized_phone, display_phone, dedupe_key, phone_type,
          phone_status, is_primary, first_seen_at, last_seen_at)
       VALUES ($1, $2, $2, $3, $4, 'valid', true, now(), now()) RETURNING id`,
      [candidateId, phone, key, phoneType],
    );
    await c.query(
      `INSERT INTO public.contact_enrichment_candidate_phone_sources
         (candidate_phone_id, provider, acquisition_mode, source_event_key, observed_at)
       VALUES ($1, 'apollo', 'reveal', $2, now())`,
      [rows[0].id, `apollo:reveal:${key}`],
    );
    await c.query(
      `UPDATE public.contact_enrichment_candidates
          SET phone = $2::text,
              phone_reveal_cost_credits = 8,
              phone_reveal_cost_source = 'reported',
              enrichment_metadata = jsonb_build_object(
                'phone', jsonb_build_object('number', $2::text, 'source', 'apollo_reveal'))
        WHERE id = $1`,
      [candidateId, phone],
    );
  }

  /**
   * La clave canónica del número, calculada con la MISMA función pura que usa producción.
   * Se reutiliza `normalizeCandidatePhone` en vez de escribir un SHA-256 a mano: una clave
   * calculada de otra forma en el test probaría un acuerdo entre el test y sí mismo.
   */
  function phoneOf(phone: string): string {
    return normalizeCandidatePhone({
      displayPhone: phone,
      sanitizedPhone: phone,
      countryCode: 'CO',
    }).dedupeKey;
  }

  function phoneRow(phone: string, phoneType: string, phoneStatus: string) {
    return {
      dedupe_key: phoneOf(phone),
      normalized_phone: phone,
      display_phone: phone,
      phone_type: phoneType,
      phone_status: phoneStatus,
      first_seen_at: '2026-08-18T10:00:00.000Z',
      last_seen_at: '2026-08-18T10:00:00.000Z',
    };
  }

  function sourceRow(phone: string, provider: string) {
    const dedupeKey = phoneOf(phone);
    return {
      dedupe_key: dedupeKey,
      provider,
      acquisition_mode: 'reveal',
      raw_provider_type: null,
      raw_provider_status: null,
      waterfall_run_id: null,
      reservation_id: null,
      provider_usage_log_id: null,
      source_event_key: `${provider}:reveal:${dedupeKey}`,
      observed_at: '2026-08-18T10:00:00.000Z',
    };
  }

  function primaryRow(phone: string, displayPhone: string, phoneType: string) {
    return {
      dedupe_key: phoneOf(phone),
      phone: displayPhone,
      phone_type: phoneType,
      raw_type: null,
    };
  }

  interface AppendResult {
    status: string;
    inserted_phone_count: number;
    updated_phone_count: number;
    inserted_source_count: number;
    suppressed_skipped_count: number;
    new_distinct_phone_count: number;
    primary_dedupe_key: string | null;
    primary_set: boolean;
    candidate_scalar_updated: boolean;
  }

  async function appendSearchMore(
    c: PgLikeClient,
    candidateId: string,
    payload: { phones: unknown[]; sources: unknown[]; primaryCandidates: unknown[] },
  ): Promise<AppendResult> {
    const rows = await rowsOf<{ result: AppendResult }>(c, 
      `SELECT public.append_candidate_search_more_phones($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) AS result`,
      [
        candidateId,
        '2026-08-18T10:00:00.000Z',
        JSON.stringify(payload.phones),
        JSON.stringify(payload.sources),
        JSON.stringify(payload.primaryCandidates),
      ],
    );
    return rows[0].result;
  }

  async function readCandidate(c: PgLikeClient, candidateId: string) {
    const rows = await rowsOf<{
      phone: string | null;
      phone_reveal_provider: string | null;
      phone_reveal_cost_credits: number | null;
      enrichment_metadata: { phone?: { source?: string } };
    }>(c, 
      `SELECT phone, phone_reveal_provider, phone_reveal_cost_credits, enrichment_metadata
         FROM public.contact_enrichment_candidates WHERE id = $1`,
      [candidateId],
    );
    return rows[0];
  }
});
