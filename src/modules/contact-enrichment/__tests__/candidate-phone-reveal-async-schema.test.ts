/**
 * Static schema + safety guards — APOLLO-PHONE-ASYNC-1 (migración 097)
 *
 * La migración 097 agrega SOLO las columnas de correlación del reveal async
 * (request_id + timestamps + attempt_count) y extiende el vocabulario de
 * phone_reveal_status con `requested`/`pending`. Este hito NO revela nada, NO
 * llama Apollo, NO activa el flag, NO gasta créditos, NO aplica la migración en
 * producción. Estas pruebas leen los archivos en disco. Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

const MIGRATION_REL = 'supabase/migrations/097_apollo_phone_reveal_async.sql';

const ASYNC_COLUMNS: readonly string[] = [
  'phone_reveal_request_id',
  'phone_reveal_requested_at',
  'phone_reveal_completed_at',
  'phone_reveal_webhook_received_at',
  'phone_reveal_attempt_count',
  'phone_reveal_last_checked_at',
];

const STATUS_VOCAB: readonly string[] = [
  'not_requested',
  'requested',
  'pending',
  'revealed',
  'no_phone_found',
  'error',
];

function stripSqlComments(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('ASYNC-1 migration 097 — shape', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('la migración 097 existe con el nombre esperado', () => {
    assert.equal(existsSync(join(REPO_ROOT, MIGRATION_REL)), true);
  });

  it('solo altera contact_enrichment_candidates', () => {
    const altered = [...sql.matchAll(/ALTER TABLE\s+([a-z0-9_.]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    );
    for (const t of altered) {
      assert.equal(t, 'public.contact_enrichment_candidates', `ALTER inesperado: ${t}`);
    }
  });

  it('agrega SOLO las columnas async con ADD COLUMN IF NOT EXISTS', () => {
    const added = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z0-9_]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    assert.deepEqual([...added].sort(), [...ASYNC_COLUMNS].sort());
  });

  it('phone_reveal_request_id es text', () => {
    assert.equal(
      /ADD COLUMN IF NOT EXISTS\s+phone_reveal_request_id\s+text/i.test(sql),
      true,
    );
  });

  it('attempt_count default 0 (único NOT NULL admitido, seguro para legacy)', () => {
    assert.equal(
      /phone_reveal_attempt_count\s+integer\s+NOT NULL\s+DEFAULT\s+0/i.test(sql),
      true,
    );
  });
});

describe('ASYNC-1 migration 097 — no destructiva / sin backfill', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('no es destructiva de datos (sin DROP TABLE/COLUMN, DELETE, TRUNCATE)', () => {
    assert.equal(/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  });

  it('no hace backfill (sin UPDATE / INSERT de datos)', () => {
    assert.equal(/\bUPDATE\s+public\.contact_enrichment_candidates\b/i.test(sql), false);
    assert.equal(/\bINSERT\s+INTO\b/i.test(sql), false);
  });

  it('no cambia RLS ni políticas', () => {
    assert.equal(/ENABLE ROW LEVEL SECURITY/i.test(sql), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(sql), false);
  });

  it('no crea ni altera triggers', () => {
    assert.equal(/CREATE TRIGGER|DROP TRIGGER/i.test(sql), false);
  });

  it('no activa reveal (sin reveal_phone_number)', () => {
    assert.equal(/reveal_phone_number\s*:\s*true/.test(sql), false);
  });
});

describe('ASYNC-1 migration 097 — status vocab + índice único parcial', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('recrea el check de status con requested + pending añadidos', () => {
    assert.equal(
      /DROP CONSTRAINT[\s\S]*contact_enrichment_candidates_phone_reveal_status_check/i.test(
        sql,
      ),
      true,
    );
    for (const v of STATUS_VOCAB) {
      assert.equal(sql.includes(`'${v}'`), true, `falta estado ${v}`);
    }
    // El check nuevo sigue siendo NOT VALID (no re-valida legacy).
    const statusBlock = sql.slice(sql.indexOf('phone_reveal_status IN')).slice(0, 300);
    const found = [...statusBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const f of found) {
      assert.equal(STATUS_VOCAB.includes(f), true, `estado inesperado: ${f}`);
    }
    assert.equal(/NOT VALID/i.test(sql), true);
  });

  it('crea un índice único PARCIAL sobre request_id (solo no-null)', () => {
    assert.equal(/CREATE UNIQUE INDEX IF NOT EXISTS/i.test(sql), true);
    assert.equal(/\(phone_reveal_request_id\)/i.test(sql), true);
    assert.equal(/WHERE phone_reveal_request_id IS NOT NULL/i.test(sql), true);
  });
});

describe('ASYNC-1 — tipos actualizados', () => {
  const types = readRepo('src/modules/contact-enrichment/types.ts');

  it('PhoneRevealStatus incluye requested + pending', () => {
    assert.equal(/'requested'/.test(types), true);
    assert.equal(/'pending'/.test(types), true);
  });

  it('ContactCandidatePhoneRevealAudit declara los campos async', () => {
    for (const col of ASYNC_COLUMNS) {
      assert.equal(new RegExp(`${col}\\?:`).test(types), true, `falta ${col}? en el tipo`);
    }
  });
});
