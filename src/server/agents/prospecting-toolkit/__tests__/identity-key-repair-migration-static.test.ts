/**
 * Pruebas estáticas de la migración de reparación de `identity_key`.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 5.
 *
 * La migración no se aplica en este hito, así que lo único que se puede sostener
 * automáticamente es su CONTENIDO. Es donde vive el riesgo real:
 *
 *   - un UNIQUE colado fallaría al crearse (la simulación read-only del backfill
 *     encontró 19 grupos de clave repetida en las 253 filas actuales);
 *   - un NOT NULL colado fallaría también (las 253 filas quedan NULL);
 *   - un backfill colado escribiría datos que nadie autorizó;
 *   - tocar cualquier cosa que no sea `identity_key` sale del alcance;
 *   - marcar la 092 como aplicada mentiría sobre lo que se ejecutó.
 *
 * Sin red, sin base de datos.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const REPAIR_FILE = '105_repair_prospect_candidates_identity_key.sql';
const ORIGINAL_FILE = '092_add_identity_key_to_prospect_candidates.sql';

const repair = readFileSync(join(MIGRATIONS_DIR, REPAIR_FILE), 'utf8');
const original = readFileSync(join(MIGRATIONS_DIR, ORIGINAL_FILE), 'utf8');

/** SQL sin comentarios: las prohibiciones se afirman sobre sentencias, no prosa. */
function statementsOnly(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/**
 * SQL sin comentarios y sin la sentencia `COMMENT ON`.
 *
 * El texto del COMMENT documenta a propósito lo que la migración NO hace («sin
 * UNIQUE», «sin backfill»), así que buscar esas palabras dentro de él daría un
 * falso positivo. Las prohibiciones se afirman sobre DDL ejecutable.
 */
function ddlOnly(sql: string): string {
  return statementsOnly(sql).replace(/COMMENT ON[\s\S]*?;/gi, '');
}

const repairSql = statementsOnly(repair);
const repairDdl = ddlOnly(repair);

describe('§ 5 — la reparación va hacia adelante, no reescribe la historia', () => {
  it('es posterior al máximo local y no renombra ni edita la 092', () => {
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => Number.parseInt(f.slice(0, 3), 10));
    const max = Math.max(...numbers);
    assert.equal(max, 105, 'la reparación debe ser la migración de número más alto');
    // La 092 sigue existiendo y sigue siendo la de siempre.
    assert.match(original, /ADD COLUMN IF NOT EXISTS identity_key text/);
  });

  it('no marca la 092 como aplicada ni toca la tabla de historial', () => {
    assert.doesNotMatch(repairSql, /schema_migrations/i);
    assert.doesNotMatch(repairSql, /supabase_migrations/i);
  });
});

describe('§ 5 — reproduce la semántica válida de la 092 y nada más', () => {
  it('añade la columna de forma idempotente', () => {
    assert.match(repairSql, /ALTER TABLE public\.prospect_candidates\s+ADD COLUMN IF NOT EXISTS identity_key text;/);
  });

  it('recrea el MISMO CHECK, con el mismo nombre y NOT VALID', () => {
    assert.match(repairSql, /prospect_candidates_identity_key_non_empty/);
    assert.match(repairSql, /identity_key IS NULL/);
    assert.match(repairSql, /length\(btrim\(identity_key\)\) > 0/);
    assert.match(repairSql, /NOT VALID/);
    // El nombre tiene que coincidir con el de la 092: si no, un entorno donde la
    // 092 sí corrió terminaría con dos restricciones equivalentes.
    assert.match(original, /prospect_candidates_identity_key_non_empty/);
  });

  it('guarda el ADD CONSTRAINT contra pg_constraint (la 092 no lo hacía)', () => {
    assert.match(repairSql, /pg_constraint/);
    assert.match(repairSql, /IF NOT EXISTS \(/);
  });
});

describe('§ 5 — prohibiciones: nada de unicidad, NOT NULL ni backfill', () => {
  it('no crea ningún índice ni restricción única', () => {
    assert.doesNotMatch(repairDdl, /CREATE\s+(UNIQUE\s+)?INDEX/i);
    assert.doesNotMatch(repairDdl, /UNIQUE/i);
  });

  it('no impone NOT NULL ni un default', () => {
    assert.doesNotMatch(repairDdl, /SET NOT NULL/i);
    assert.doesNotMatch(repairDdl, /NOT NULL/i);
    assert.doesNotMatch(repairDdl, /SET DEFAULT/i);
  });

  it('no escribe datos: sin UPDATE, INSERT, DELETE ni VALIDATE', () => {
    assert.doesNotMatch(repairDdl, /\bUPDATE\b/i);
    assert.doesNotMatch(repairDdl, /\bINSERT\b/i);
    assert.doesNotMatch(repairDdl, /\bDELETE\b/i);
    assert.doesNotMatch(repairDdl, /VALIDATE CONSTRAINT/i);
  });

  it('no crea funciones ni disparadores', () => {
    assert.doesNotMatch(repairDdl, /CREATE (OR REPLACE )?FUNCTION/i);
    assert.doesNotMatch(repairDdl, /CREATE TRIGGER/i);
  });
});

describe('§ 5 — alcance: sólo identity_key de prospect_candidates', () => {
  it('la única tabla alterada es public.prospect_candidates', () => {
    const altered = [...repairDdl.matchAll(/ALTER TABLE\s+([a-z_.]+)/gi)].map((m) => m[1]);
    assert.ok(altered.length > 0);
    for (const table of altered) {
      assert.equal(table, 'public.prospect_candidates');
    }
  });

  it('no menciona las columnas de la 093 ni otras tablas del dominio', () => {
    for (const forbidden of [
      'record_origin',
      'rejection_reason',
      'classification_source',
      'classification_confidence',
      'prospect_batches',
      'provider_usage_logs',
      'accounts',
    ]) {
      assert.ok(
        !repairSql.includes(forbidden),
        `la migración no debe mencionar ${forbidden}`,
      );
    }
  });

  it('recarga la caché de esquema de PostgREST, que es la que falló en LIVE-QA-2', () => {
    assert.match(repairSql, /NOTIFY pgrst, 'reload schema'/);
  });
});
