/**
 * Static schema + safety guards — APOLLO-PHONE-CACHE-1a (migración 098)
 *
 * La migración 098 agrega SOLO la columna nullable `apollo_person_id` y un índice
 * PARCIAL (no único) para futuras búsquedas. Este hito NO construye caché, NO
 * sirve teléfonos, NO revela nada, NO llama Apollo, NO activa flags, NO aplica la
 * migración en producción. Estas pruebas leen el archivo en disco. Sin red, sin DB.
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

const MIGRATION_REL =
  'supabase/migrations/098_contact_enrichment_candidate_apollo_person_id.sql';

function stripSqlComments(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('CACHE-1a migration 098 — shape', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('la migración 098 existe con el nombre esperado', () => {
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

  it('agrega SOLO la columna apollo_person_id con ADD COLUMN IF NOT EXISTS', () => {
    const added = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z0-9_]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    assert.deepEqual(added, ['apollo_person_id']);
  });

  it('apollo_person_id es text y nullable (sin NOT NULL)', () => {
    assert.equal(/ADD COLUMN IF NOT EXISTS\s+apollo_person_id\s+text/i.test(sql), true);
    assert.equal(/apollo_person_id\s+text\s+NOT NULL/i.test(sql), false);
  });
});

describe('CACHE-1a migration 098 — índice parcial, no único', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('crea un índice PARCIAL sobre apollo_person_id (solo no-null)', () => {
    assert.equal(/CREATE INDEX IF NOT EXISTS/i.test(sql), true);
    assert.equal(/\(apollo_person_id\)/i.test(sql), true);
    assert.equal(/WHERE apollo_person_id IS NOT NULL/i.test(sql), true);
  });

  it('el índice NO es único (misma persona puede repetirse entre candidatos)', () => {
    assert.equal(/CREATE UNIQUE INDEX/i.test(sql), false);
  });
});

describe('CACHE-1a migration 098 — no destructiva / sin caché / sin backfill', () => {
  const sql = stripSqlComments(readRepo(MIGRATION_REL));

  it('no es destructiva (sin DROP TABLE/COLUMN, DELETE, TRUNCATE)', () => {
    assert.equal(/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  });

  it('no hace backfill (sin UPDATE / INSERT de datos)', () => {
    assert.equal(/\bUPDATE\s+public\.contact_enrichment_candidates\b/i.test(sql), false);
    assert.equal(/\bINSERT\s+INTO\b/i.test(sql), false);
  });

  it('no crea ninguna tabla de caché (phone_reveal_cache)', () => {
    assert.equal(/CREATE TABLE/i.test(sql), false);
    assert.equal(/phone_reveal_cache/i.test(sql), false);
  });

  it('no cambia RLS ni políticas ni triggers', () => {
    assert.equal(/ENABLE ROW LEVEL SECURITY/i.test(sql), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(sql), false);
    assert.equal(/CREATE TRIGGER|DROP TRIGGER/i.test(sql), false);
  });

  it('no activa reveal (sin reveal_phone_number)', () => {
    assert.equal(/reveal_phone_number\s*:\s*true/.test(sql), false);
  });
});

describe('CACHE-1a — tipo actualizado', () => {
  const types = readRepo('src/modules/contact-enrichment/types.ts');

  it('ContactCandidatePhoneRevealAudit declara apollo_person_id?', () => {
    assert.equal(/apollo_person_id\?:/.test(types), true);
  });
});
