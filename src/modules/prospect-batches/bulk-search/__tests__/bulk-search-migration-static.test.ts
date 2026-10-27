/**
 * Migración 159 (GROWTH-BULK-SEARCH-1) — contrato ESTÁTICO: las búsquedas
 * masivas sólo las toca el servidor, el reclamo es atómico con lease y nadie
 * más puede ejecutarlo, y la base de datos refuerza las cuatro cantidades y una
 * sola búsqueda viva por persona.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const SQL = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '159_growth_bulk_prospect_searches.sql'), 'utf8');
const sql = SQL.replace(/--[^\n]*/g, '');

describe('159 — tablas', () => {
  it('crea las dos tablas', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS prospect_bulk_searches\b/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS prospect_bulk_search_rounds\b/);
  });

  it('solo las cuatro cantidades de la pantalla', () => {
    assert.match(sql, /target_count\s+INTEGER\s+NOT NULL CHECK \(target_count IN \(25, 50, 100, 200\)\)/);
  });

  it('una sola búsqueda viva por persona', () => {
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON prospect_bulk_searches \(created_by\)\s+WHERE status IN \('running', 'paused'\)/);
  });

  it('cada ronda tiene su identidad de corrida, única, y su posición', () => {
    assert.match(sql, /client_request_id\s+UUID\s+NOT NULL UNIQUE/);
    assert.match(sql, /UNIQUE \(bulk_search_id, round_index\)/);
  });

  it('el lote de una ronda puede borrarse sin romper la búsqueda', () => {
    assert.match(sql, /batch_id\s+UUID\s+NULL REFERENCES prospect_batches\(id\) ON DELETE SET NULL/);
  });
});

describe('159 — permisos: sólo el servidor', () => {
  for (const table of ['prospect_bulk_searches', 'prospect_bulk_search_rounds']) {
    it(`${table}: RLS forzado, sin políticas y sin acceso de clientes`, () => {
      assert.ok(sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
      assert.ok(sql.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`));
      assert.ok(sql.includes(`REVOKE ALL ON TABLE ${table} FROM PUBLIC;`));
      assert.ok(sql.includes(`REVOKE ALL ON TABLE ${table} FROM anon, authenticated;`));
      assert.ok(sql.includes(`GRANT SELECT, INSERT, UPDATE ON TABLE ${table} TO service_role;`));
    });
  }

  it('no crea ninguna política (ningún cliente lee el tope ni los criterios)', () => {
    assert.equal(/CREATE POLICY/i.test(sql), false);
  });

  it('no borra datos ni toca tablas de otros', () => {
    assert.equal(/\b(DROP TABLE|DELETE FROM|TRUNCATE)\b/i.test(sql), false);
    assert.equal(/ALTER TABLE (?!prospect_bulk_search)/.test(sql), false);
  });
});

describe('159 — reclamo con lease', () => {
  it('es SECURITY DEFINER con search_path fijo', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION claim_prospect_bulk_search\(\s*p_bulk_search_id UUID,\s*p_user_id UUID,\s*p_lease_seconds INTEGER\s*\)/);
    assert.match(sql, /SECURITY DEFINER\s+SET search_path = public/);
  });

  it('solo reclama lo propio, en curso, y si nadie tiene un lease vigente', () => {
    assert.match(sql, /s\.created_by = p_user_id/);
    assert.match(sql, /s\.status = 'running'/);
    assert.match(sql, /s\.lease_expires_at IS NULL OR s\.lease_expires_at < now\(\)/);
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  });

  it('cada reclamo emite un token nuevo', () => {
    assert.match(sql, /SET lease_token = gen_random_uuid\(\)/);
  });

  it('solo el service_role puede ejecutarlo', () => {
    const signature = 'claim_prospect_bulk_search(UUID, UUID, INTEGER)';
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`));
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM anon, authenticated;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
  });
});
