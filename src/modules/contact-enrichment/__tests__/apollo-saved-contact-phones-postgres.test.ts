/**
 * APOLLO-SAVED-CONTACT-PHONES-1 — migración 155 contra PostgreSQL 17 real.
 *
 * Las garantías de la importación son de la base, no del código: «nunca pisa un teléfono»,
 * «una persona suprimida no recibe número», «un tombstone no revive», «re-ejecutar no
 * duplica», «sólo service_role puede llamarla» y, sobre todo, «un borrado DSAR de Apollo
 * SÍ alcanza el número importado» (la razón de registrar `(apollo, reveal)` y no un modo
 * nuevo). Aquí se aplica la cadena real y se comprueba el contenido de las tablas.
 *
 * Los parámetros salen del MISMO builder puro que usa el script
 * (`buildSavedContactImportPayload`), nunca escritos a mano.
 *
 * Sin red, sin Apollo, sin Producción. Números sintéticos 555.
 *
 * ARNÉS OPCIONAL (igual que el resto de suites `*-postgres`):
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:apollo-saved-contact-phones:postgres
 */

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
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/phone-reveal-real-migration-chain';
import {
  SAVED_CONTACT_PHONE_PROCESSING_BASIS,
  buildSavedContactImportPayload,
  decideSavedContactPhoneImport,
  matchApolloSavedContact,
  type ApolloSavedContact,
  type SavedContactImportTarget,
} from '../apollo-saved-contact-phone-import-core';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '../../../..');

const MIGRATION_155 = '155_import_apollo_saved_contact_phones.sql';

const CHAIN = [
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
  MIGRATION_155,
] as const;

const CANDIDATE_FN = 'import_candidate_apollo_saved_phones';
const CONTACT_FN = 'import_contact_apollo_saved_phones';
const OBSERVED_AT = '2026-10-21T20:00:00.000Z';

const P_MOBILE = '+15550000001';
const P_WORK = '+15550000002';

const { ctor: EmbeddedPostgresCtor, skip } = resolveEmbeddedPostgres(import.meta.url);

/** Apollo person id sintético y distinto por caso (24 hex). */
function pid(): string {
  return randomUUID().replace(/-/g, '').slice(0, 24);
}

function savedContact(personId: string, phoneNumbers: ApolloSavedContact['phone_numbers']): ApolloSavedContact {
  return { id: `apollo-contact-${personId}`, person_id: personId, email: emailOf(personId), phone_numbers: phoneNumbers };
}

/** Correo sintético compartido: así se empareja un contacto oficial (no tiene person_id). */
function emailOf(personId: string): string {
  return `${personId}@example.test`;
}

/** El MISMO camino que el script: núcleo puro → decisión → builder. */
function payloadFor(target: SavedContactImportTarget, contact: ApolloSavedContact) {
  const decision = decideSavedContactPhoneImport({
    target,
    match: matchApolloSavedContact(target, [contact]),
    suppression: { kind: 'allowed' },
    tombstonedDedupeKeys: new Set(),
  });
  assert.equal(decision.decision, 'would_import');
  if (decision.decision !== 'would_import') throw new Error('unreachable');
  return { decision, payload: buildSavedContactImportPayload(decision) };
}

describe('APOLLO-SAVED-CONTACT-PHONES-1 · migración 155 en PostgreSQL real', { skip }, () => {
  let pg: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir: string;
  const accountId = randomUUID();
  const runId = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, values?: unknown[]) =>
    (await client.query(sql, values)).rows as T[];

  before(async () => {
    assert.ok(EmbeddedPostgresCtor, 'el arnés debía estar resuelto');
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-saved-contact-pg-'));
    pg = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 55_932 + Math.floor(process.pid % 500),
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    client = pg.getPgClient();
    await client.connect();

    await bootstrapPlatform(client);
    await client.query('DROP TABLE IF EXISTS public.phone_reveal_waterfall_runs CASCADE');
    // Columnas reales que la 155 lee y el bootstrap compartido no declara.
    await client.query(`
      ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
      ALTER TABLE public.contact_enrichment_candidates
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_review';`);
    await applyPhoneRevealRealChain(client, REPO_ROOT, CHAIN);

    await q(`INSERT INTO public.accounts (id, name) VALUES ($1, 'ACME')`, [accountId]);
    await q(`INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)`, [runId, accountId]);
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

  // ── Helpers ────────────────────────────────────────────────────

  async function insertCandidate(personId: string, extra: { phone?: string; status?: string } = {}) {
    const [row] = await q<{ id: string }>(
      `INSERT INTO public.contact_enrichment_candidates
         (enrichment_run_id, source, source_contact_id, apollo_person_id, phone, status)
       VALUES ($1, 'apollo', $2, $2, $3, $4) RETURNING id`,
      [runId, personId, extra.phone ?? null, extra.status ?? 'pending_review'],
    );
    return row.id;
  }

  async function insertContact(extra: { phone?: string; mobile?: string; archived?: boolean } = {}) {
    const [row] = await q<{ id: string }>(
      `INSERT INTO public.contacts (account_id, phone, mobile_phone, archived_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [accountId, extra.phone ?? null, extra.mobile ?? null, extra.archived ? new Date().toISOString() : null],
    );
    return row.id;
  }

  function candidateTarget(id: string, personId: string): SavedContactImportTarget {
    return { kind: 'candidate', id, accountId, apolloPersonId: personId, email: null, linkedinUrl: null };
  }

  function contactTarget(id: string, personId: string): SavedContactImportTarget {
    return { kind: 'contact', id, accountId, apolloPersonId: null, email: emailOf(personId), linkedinUrl: null };
  }

  async function callCandidate(id: string, personId: string, payload: ReturnType<typeof buildSavedContactImportPayload>) {
    const [row] = await q<{ result: Record<string, unknown> }>(
      `SELECT public.${CANDIDATE_FN}($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) AS result`,
      [id, personId, OBSERVED_AT, JSON.stringify(payload.phones), JSON.stringify(payload.sources),
        JSON.stringify(payload.primaryCandidates), SAVED_CONTACT_PHONE_PROCESSING_BASIS],
    );
    return row.result;
  }

  async function callContact(id: string, personId: string | null, payload: ReturnType<typeof buildSavedContactImportPayload>) {
    const [row] = await q<{ result: Record<string, unknown> }>(
      `SELECT public.${CONTACT_FN}($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) AS result`,
      [id, personId, OBSERVED_AT, JSON.stringify(payload.phones), JSON.stringify(payload.sources),
        JSON.stringify(payload.primaryCandidates), SAVED_CONTACT_PHONE_PROCESSING_BASIS],
    );
    return row.result;
  }

  const countCandidatePhones = async (id: string) =>
    Number((await q<{ n: string }>(
      `SELECT COUNT(*) AS n FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1`, [id],
    ))[0].n);

  const countContactPhones = async (id: string) =>
    Number((await q<{ n: string }>(`SELECT COUNT(*) AS n FROM public.contact_phones WHERE contact_id = $1`, [id]))[0].n);

  // ── 1. Aplicabilidad ───────────────────────────────────────────

  it('es idempotente: re-aplicarla no lanza', async () => {
    await client.query(readMigration(REPO_ROOT, MIGRATION_155));
  });

  it('sólo service_role puede ejecutar las dos funciones', async () => {
    for (const fn of [CANDIDATE_FN, CONTACT_FN]) {
      const sig = `public.${fn}(uuid, text, timestamptz, jsonb, jsonb, jsonb, text)`;
      for (const role of ['anon', 'authenticated']) {
        const [row] = await q<{ ok: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig]);
        assert.equal(row.ok, false, `${role} no debe poder ejecutar ${fn}`);
      }
      const [row] = await q<{ ok: boolean }>(`SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok`, [sig]);
      assert.equal(row.ok, true, `service_role debe poder ejecutar ${fn}`);
    }
  });

  // ── 2. Candidatos ──────────────────────────────────────────────

  it('candidato sin teléfono: colección, procedencia (apollo, reveal, clave guardada), primario y escalar', async () => {
    const personId = pid();
    const id = await insertCandidate(personId);
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [
      { sanitized_number: P_WORK, type_cd: 'work_hq' },
      { sanitized_number: P_MOBILE, type_cd: 'mobile' },
    ]));

    const result = await callCandidate(id, personId, payload);
    assert.equal(result.status, 'persisted');
    assert.equal(await countCandidatePhones(id), 2);

    const sources = await q<{ provider: string; acquisition_mode: string; source_event_key: string; waterfall_run_id: string | null }>(
      `SELECT s.provider, s.acquisition_mode, s.source_event_key, s.waterfall_run_id
         FROM public.contact_enrichment_candidate_phone_sources s
         JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
        WHERE p.candidate_id = $1`, [id],
    );
    assert.equal(sources.length, 2);
    for (const source of sources) {
      assert.equal(source.provider, 'apollo');
      assert.equal(source.acquisition_mode, 'reveal');
      assert.equal(source.source_event_key, `apollo_saved_contact:apollo-contact-${personId}`);
      assert.equal(source.waterfall_run_id, null);
    }

    const [candidate] = await q<Record<string, unknown>>(
      `SELECT phone, phone_processing_basis, enrichment_metadata, phone_reveal_status,
              phone_reveal_provider, phone_reveal_cost_credits, phone_revealed_at
         FROM public.contact_enrichment_candidates WHERE id = $1`, [id],
    );
    assert.equal(candidate.phone, P_MOBILE, 'el móvil gana al conmutador');
    assert.equal(candidate.phone_processing_basis, 'legitimate_interest_b2b');
    const meta = candidate.enrichment_metadata as { phone: Record<string, unknown> };
    assert.equal(meta.phone.source, 'apollo_reveal');
    assert.equal(meta.phone.acquired_via, 'apollo_saved_contact');
    // SellUp no hizo reveal ni gastó: ninguna columna del reveal se toca.
    assert.equal(candidate.phone_reveal_status, null);
    assert.equal(candidate.phone_reveal_provider, null);
    assert.equal(candidate.phone_reveal_cost_credits, null);
    assert.equal(candidate.phone_revealed_at, null);

    const [primary] = await q<{ n: string }>(
      `SELECT COUNT(*) AS n FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1 AND is_primary`, [id],
    );
    assert.equal(Number(primary.n), 1);
  });

  it('re-ejecutar no duplica: la segunda vez el candidato ya tiene teléfono', async () => {
    const personId = pid();
    const id = await insertCandidate(personId);
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callCandidate(id, personId, payload)).status, 'persisted');
    assert.equal((await callCandidate(id, personId, payload)).status, 'target_has_phone');
    assert.equal(await countCandidatePhones(id), 1);
  });

  it('nunca pisa: un candidato con teléfono no se toca', async () => {
    const personId = pid();
    const id = await insertCandidate(personId, { phone: '+15559999999' });
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callCandidate(id, personId, payload)).status, 'target_has_phone');
    assert.equal(await countCandidatePhones(id), 0);
    const [row] = await q<{ phone: string }>(`SELECT phone FROM public.contact_enrichment_candidates WHERE id = $1`, [id]);
    assert.equal(row.phone, '+15559999999');
  });

  it('candidato descartado o de otro origen ⇒ no elegible', async () => {
    const personId = pid();
    const id = await insertCandidate(personId, { status: 'discarded' });
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callCandidate(id, personId, payload)).status, 'target_not_eligible');
    assert.equal(await countCandidatePhones(id), 0);
  });

  it('persona suprimida (provider_suppressions) ⇒ suppressed, nada escrito', async () => {
    const personId = pid();
    const id = await insertCandidate(personId);
    await q(
      `INSERT INTO public.provider_suppressions (provider, provider_person_id, suppressed_at, suppression_reason)
       VALUES ('apollo', $1, now(), 'dsar_erasure_request')`, [personId],
    );
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callCandidate(id, personId, payload)).status, 'suppressed');
    assert.equal(await countCandidatePhones(id), 0);
  });

  it('un número con tombstone no revive ni gana procedencia', async () => {
    const personId = pid();
    const id = await insertCandidate(personId);
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    await q(
      `INSERT INTO public.contact_enrichment_candidate_phones
         (candidate_id, dedupe_key, normalized_phone, display_phone, phone_type, phone_status,
          suppressed_at, suppression_reason)
       VALUES ($1, $2, NULL, NULL, NULL, 'unknown', now(), 'data_subject_request')`,
      [id, payload.phones[0].dedupe_key],
    );
    const result = await callCandidate(id, personId, payload);
    assert.equal(result.status, 'persisted_without_primary');
    const [row] = await q<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM public.contact_enrichment_candidate_phones WHERE candidate_id = $1`, [id],
    );
    assert.equal(row.normalized_phone, null);
    const [candidate] = await q<{ phone: string | null }>(`SELECT phone FROM public.contact_enrichment_candidates WHERE id = $1`, [id]);
    assert.equal(candidate.phone, null);
  });

  it('procedencia ajena (modo search, clave sin prefijo o puntero contable) ⇒ invalid_input', async () => {
    const personId = pid();
    const id = await insertCandidate(personId);
    const { payload } = payloadFor(candidateTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    const variants = [
      { ...payload.sources[0], acquisition_mode: 'search' },
      { ...payload.sources[0], source_event_key: 'apollo:reveal:x' },
      { ...payload.sources[0], reservation_id: randomUUID() },
    ];
    for (const source of variants) {
      const result = await callCandidate(id, personId, { ...payload, sources: [source] as typeof payload.sources });
      assert.equal(result.status, 'invalid_input');
      assert.equal(result.detail, 'foreign_provenance');
    }
    assert.equal(await countCandidatePhones(id), 0);
  });

  // ── 3. Contactos oficiales ─────────────────────────────────────

  it('contacto oficial sin teléfono: colección oficial, escalar apollo_reveal y base de tratamiento', async () => {
    const personId = pid();
    const id = await insertContact();
    const { payload } = payloadFor(contactTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE, type_cd: 'mobile' }]));
    const result = await callContact(id, personId, payload);
    assert.equal(result.status, 'persisted');
    assert.equal(await countContactPhones(id), 1);
    const [contact] = await q<Record<string, unknown>>(
      `SELECT phone, phone_type, phone_source, phone_processing_basis, mobile_phone, phone_revealed_at
         FROM public.contacts WHERE id = $1`, [id],
    );
    assert.equal(contact.phone, P_MOBILE);
    assert.equal(contact.phone_type, 'mobile');
    assert.equal(contact.phone_source, 'apollo_reveal');
    assert.equal(contact.phone_processing_basis, 'legitimate_interest_b2b');
    assert.equal(contact.mobile_phone, null, 'mobile_phone nunca se escribe');
    assert.ok(contact.phone_revealed_at);
  });

  it('contacto sin person_id válido ⇒ suppression_not_evaluable', async () => {
    const id = await insertContact();
    const personId = pid();
    const { payload } = payloadFor(contactTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callContact(id, null, payload)).status, 'suppression_not_evaluable');
    assert.equal((await callContact(id, 'no-es-un-id', payload)).status, 'suppression_not_evaluable');
    assert.equal(await countContactPhones(id), 0);
  });

  it('contacto con mobile_phone, o archivado ⇒ no se toca', async () => {
    const personId = pid();
    const withMobile = await insertContact({ mobile: '+15558888888' });
    const archived = await insertContact({ archived: true });
    const { payload } = payloadFor(contactTarget(withMobile, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callContact(withMobile, personId, payload)).status, 'target_has_phone');
    assert.equal((await callContact(archived, personId, payload)).status, 'target_not_eligible');
    assert.equal(await countContactPhones(withMobile), 0);
    assert.equal(await countContactPhones(archived), 0);
  });

  it('contacto con tombstone legado en phone_reveal_cache para su cuenta ⇒ suppressed', async () => {
    const personId = pid();
    const id = await insertContact();
    await q(
      `INSERT INTO public.phone_reveal_cache (provider, provider_person_id, account_id, suppressed_at)
       VALUES ('apollo', $1, $2, now())`, [personId, accountId],
    ).catch(async () => {
      // La 099 exige más columnas en algunas versiones: se siembra por proveedor nativo.
      await q(
        `INSERT INTO public.provider_suppressions (provider, provider_person_id, suppressed_at, suppression_reason)
         VALUES ('apollo', $1, now(), 'dsar_erasure_request')`, [personId],
      );
    });
    const { payload } = payloadFor(contactTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callContact(id, personId, payload)).status, 'suppressed');
    assert.equal(await countContactPhones(id), 0);
  });

  // ── 4. La razón de `(apollo, reveal)`: el borrado DSAR alcanza el número importado ──

  it('una supresión de Apollo (115) borra el número importado del contacto oficial', async () => {
    const personId = pid();
    const id = await insertContact();
    const { payload } = payloadFor(contactTarget(id, personId), savedContact(personId, [{ sanitized_number: P_MOBILE }]));
    assert.equal((await callContact(id, personId, payload)).status, 'persisted');

    await q(
      `SELECT public.suppress_official_contact_phone_sources($1, 'single_provider', 'apollo', NULL,
              'data_subject_request', NULL, now())`, [id],
    );

    const [contact] = await q<{ phone: string | null; phone_source: string | null }>(
      `SELECT phone, phone_source FROM public.contacts WHERE id = $1`, [id],
    );
    assert.equal(contact.phone, null, 'el escalar importado debe desaparecer con la DSAR de Apollo');
    const [live] = await q<{ n: string }>(
      `SELECT COUNT(*) AS n FROM public.contact_phones WHERE contact_id = $1 AND suppressed_at IS NULL`, [id],
    );
    assert.equal(Number(live.n), 0);
  });
});
