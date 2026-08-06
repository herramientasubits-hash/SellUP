/**
 * Static checks on supabase/migrations/109_contact_enrichment_candidate_phones.sql
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-B)
 *
 * This migration is a REPO-ONLY DRAFT — it has NOT been applied to any remote
 * Supabase project. These tests only read files from disk; they never connect to
 * a database, never call a provider and never spend a credit.
 *
 * They also pin the SQL vocabularies to the TypeScript ones in
 * phone-collection-core.ts in BOTH directions, so a value can never be added on
 * one side only and produce a CHECK violation at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CANDIDATE_PHONE_ACQUISITION_MODES,
  CANDIDATE_PHONE_PROVIDERS,
  CANDIDATE_PHONE_STATUSES,
  CANDIDATE_PHONE_TYPE_RANKING,
} from '../phone-collection-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_FILE = '109_contact_enrichment_candidate_phones.sql';
const PHONES_TABLE = 'public.contact_enrichment_candidate_phones';
const SOURCES_TABLE = 'public.contact_enrichment_candidate_phone_sources';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');

/** SQL ejecutable: el archivo sin las líneas de comentario `--`. */
const executableSql = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** Literales de un `CHECK (... IN (...))` leídos del SQL ejecutable. */
function checkVocabulary(constraintName: string): string[] {
  const statement = executableSql.match(
    new RegExp(`CONSTRAINT ${constraintName}[\\s\\S]*?\\)\\s*,`),
  );
  assert.ok(statement, `no se encontró el CHECK ${constraintName}`);
  return [...statement[0].matchAll(/'([a-z_0-9]+)'/g)].map((match) => match[1]);
}

// ═══════════════════════════════════════════════════════════════════
// Numeración y aislamiento
// ═══════════════════════════════════════════════════════════════════

describe('109 — numeración', () => {
  it('el número 109 es único en supabase/migrations', () => {
    const numbered = readdirSync(migrationsDir).filter(
      (file) => file.endsWith('.sql') && /^109[_-]/.test(file),
    );
    assert.deepEqual(numbered, [MIGRATION_FILE]);
  });

  it('ninguna OTRA migración define la FORMA de las dos tablas nuevas', () => {
    // La 109 es la única dueña del ESQUEMA: quién crea las tablas, sus índices, sus
    // CHECK, su RLS y sus privilegios. Eso es lo que esta guarda protege, y por eso
    // mira DDL y GRANT, no cualquier mención.
    //
    // Desde 4O-C-R1 la 110 sí NOMBRA las dos tablas —lee y escribe FILAS en ellas
    // desde una función—, que es exactamente para lo que la 109 las creó. Prohibir
    // la mención habría dejado el modelo permanentemente sin escritor, o habría
    // forzado a que el escritor fuera SQL suelto en TypeScript, que es de donde
    // venimos.
    const DDL = [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'DROP INDEX',
      'CREATE TRIGGER',
      'CREATE POLICY',
      'GRANT',
      'REVOKE',
      'TRUNCATE',
    ];
    const others = readdirSync(migrationsDir).filter(
      (file) => file.endsWith('.sql') && file !== MIGRATION_FILE,
    );
    for (const file of others) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      for (const table of [
        'contact_enrichment_candidate_phones',
        'contact_enrichment_candidate_phone_sources',
      ]) {
        for (const keyword of DDL) {
          // El DDL y la tabla en la MISMA sentencia (hasta el `;`).
          const pattern = new RegExp(`${keyword}\\b[^;]{0,400}?${table}\\b`, 'i');
          assert.equal(
            pattern.test(sql),
            false,
            `${file} no debe ejecutar ${keyword} sobre ${table}: el esquema es de la 109`,
          );
        }
      }
    }
  });

  it('declara explícitamente que NO ha sido aplicada', () => {
    assert.match(migrationSql, /NOT APPLIED/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Estructura de las tablas
// ═══════════════════════════════════════════════════════════════════

describe('109 — tablas', () => {
  it('crea las DOS tablas del modelo, de forma idempotente', () => {
    assert.match(
      executableSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${PHONES_TABLE}\\b`),
    );
    assert.match(
      executableSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${SOURCES_TABLE}\\b`),
    );
  });

  it('NO crea una tabla `contact_phones`', () => {
    // Fuera de alcance en 4O-B y explícitamente prohibido: los contactos oficiales
    // no se tocan en este hito.
    assert.equal(/CREATE TABLE[^;]*\bcontact_phones\b/i.test(executableSql), false);
  });

  it('la tabla canónica declara las columnas del contrato', () => {
    for (const column of [
      'candidate_id',
      'normalized_phone',
      'display_phone',
      'dedupe_key',
      'phone_type',
      'phone_status',
      'is_primary',
      'first_seen_at',
      'last_seen_at',
      'suppressed_at',
      'suppression_reason',
      'suppressed_by',
      'created_at',
      'updated_at',
    ]) {
      assert.ok(
        new RegExp(`^\\s*${column}\\s`, 'm').test(executableSql),
        `falta la columna ${column}`,
      );
    }
  });

  it('la tabla de procedencias declara las columnas del contrato', () => {
    for (const column of [
      'candidate_phone_id',
      'provider',
      'acquisition_mode',
      'raw_provider_type',
      'raw_provider_status',
      'waterfall_run_id',
      'reservation_id',
      'provider_usage_log_id',
      'source_event_key',
      'observed_at',
    ]) {
      assert.ok(
        new RegExp(`^\\s*${column}\\s`, 'm').test(executableSql),
        `falta la columna ${column}`,
      );
    }
  });

  it('reutiliza el trigger `set_updated_at()` existente en vez de crear uno nuevo', () => {
    assert.match(executableSql, /EXECUTE FUNCTION set_updated_at\(\)/);
    assert.equal(
      /CREATE (OR REPLACE )?FUNCTION/i.test(executableSql),
      false,
      'no debe declarar funciones nuevas',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Claves foráneas
// ═══════════════════════════════════════════════════════════════════

describe('109 — claves foráneas', () => {
  it('candidate_id → contact_enrichment_candidates ON DELETE CASCADE', () => {
    assert.match(
      executableSql,
      /candidate_id[\s\S]{0,120}REFERENCES public\.contact_enrichment_candidates\(id\) ON DELETE CASCADE/,
    );
  });

  it('candidate_phone_id → la tabla canónica ON DELETE CASCADE', () => {
    assert.match(
      executableSql,
      new RegExp(
        `candidate_phone_id[\\s\\S]{0,120}REFERENCES ${PHONES_TABLE}\\(id\\) ON DELETE CASCADE`,
      ),
    );
  });

  it('los punteros contables son ON DELETE SET NULL, nunca CASCADE', () => {
    for (const [column, table] of [
      ['waterfall_run_id', 'public.phone_reveal_waterfall_runs'],
      ['reservation_id', 'public.phone_reveal_credit_reservations'],
      ['provider_usage_log_id', 'public.provider_usage_logs'],
    ] as const) {
      assert.match(
        executableSql,
        new RegExp(
          `${column}[\\s\\S]{0,120}REFERENCES ${table.replace('.', '\\.')}\\(id\\) ON DELETE SET NULL`,
        ),
        `${column} debe apuntar a ${table} con SET NULL`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vocabularios — fijados contra TypeScript en AMBAS direcciones
// ═══════════════════════════════════════════════════════════════════

describe('109 — vocabularios', () => {
  it('phone_type coincide EXACTAMENTE con el ranking de TypeScript', () => {
    const sqlValues = checkVocabulary(
      'contact_enrichment_candidate_phones_phone_type_check',
    );
    assert.deepEqual(
      [...sqlValues].sort(),
      [...CANDIDATE_PHONE_TYPE_RANKING].sort(),
    );
  });

  it('phone_type NO incluye `home` (se mapea a `other`, según el contrato vigente)', () => {
    const sqlValues = checkVocabulary(
      'contact_enrichment_candidate_phones_phone_type_check',
    );
    assert.equal(sqlValues.includes('home'), false);
  });

  it('phone_status coincide EXACTAMENTE con el vocabulario de TypeScript', () => {
    const sqlValues = checkVocabulary(
      'contact_enrichment_candidate_phones_phone_status_check',
    );
    assert.deepEqual([...sqlValues].sort(), [...CANDIDATE_PHONE_STATUSES].sort());
  });

  it('provider coincide EXACTAMENTE con el vocabulario de TypeScript', () => {
    const sqlValues = checkVocabulary(
      'contact_enrichment_candidate_phone_sources_provider_check',
    );
    assert.deepEqual([...sqlValues].sort(), [...CANDIDATE_PHONE_PROVIDERS].sort());
  });

  it('acquisition_mode coincide EXACTAMENTE con el vocabulario de TypeScript', () => {
    const sqlValues = checkVocabulary(
      'contact_enrichment_candidate_phone_sources_acquisition_mode_check',
    );
    assert.deepEqual(
      [...sqlValues].sort(),
      [...CANDIDATE_PHONE_ACQUISITION_MODES].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Constraints estructurales
// ═══════════════════════════════════════════════════════════════════

describe('109 — constraints', () => {
  it('UNIQUE (candidate_id, dedupe_key)', () => {
    assert.match(
      executableSql,
      /CONSTRAINT contact_enrichment_candidate_phones_candidate_dedupe_key_unique\s*\n?\s*UNIQUE \(candidate_id, dedupe_key\)/,
    );
  });

  it('UNIQUE (candidate_phone_id, source_event_key) — idempotencia de la procedencia', () => {
    assert.match(
      executableSql,
      /CONSTRAINT contact_enrichment_candidate_phone_sources_event_key_unique\s*\n?\s*UNIQUE \(candidate_phone_id, source_event_key\)/,
    );
  });

  it('un solo principal por candidato, vía índice PARCIAL', () => {
    assert.match(
      executableSql,
      new RegExp(
        `CREATE UNIQUE INDEX IF NOT EXISTS contact_enrichment_candidate_phones_one_primary_idx\\s*\\n?\\s*ON ${PHONES_TABLE} \\(candidate_id\\)\\s*\\n?\\s*WHERE is_primary`,
      ),
    );
  });

  it('el principal exige estar vivo, con número y no inválido', () => {
    const constraint = executableSql.match(
      /CONSTRAINT contact_enrichment_candidate_phones_primary_requires_live_number[\s\S]*?\n\s*\),/,
    );
    assert.ok(constraint, 'falta el CHECK del principal');
    assert.match(constraint[0], /is_primary = false/);
    assert.match(constraint[0], /suppressed_at IS NULL/);
    assert.match(constraint[0], /normalized_phone IS NOT NULL/);
    assert.match(constraint[0], /phone_status <> 'invalid'/);
  });

  it('el tombstone no conserva el número, ni el display, ni el tipo, ni el principal', () => {
    const constraint = executableSql.match(
      /CONSTRAINT contact_enrichment_candidate_phones_tombstone_is_empty[\s\S]*?\n\s*\)\n\);/,
    );
    assert.ok(constraint, 'falta el CHECK del tombstone');
    assert.match(constraint[0], /suppressed_at IS NULL/);
    assert.match(constraint[0], /normalized_phone IS NULL/);
    assert.match(constraint[0], /display_phone IS NULL/);
    assert.match(constraint[0], /phone_type IS NULL/);
    assert.match(constraint[0], /is_primary = false/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Seguridad
// ═══════════════════════════════════════════════════════════════════

describe('109 — seguridad', () => {
  it('RLS habilitada en LAS DOS tablas', () => {
    assert.match(
      executableSql,
      new RegExp(`ALTER TABLE ${PHONES_TABLE}\\s+ENABLE ROW LEVEL SECURITY`),
    );
    assert.match(
      executableSql,
      new RegExp(`ALTER TABLE ${SOURCES_TABLE}\\s+ENABLE ROW LEVEL SECURITY`),
    );
  });

  it('REVOKE explícito a PUBLIC, anon, authenticated Y service_role en ambas tablas', () => {
    for (const table of [PHONES_TABLE, SOURCES_TABLE]) {
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        assert.match(
          executableSql,
          new RegExp(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM ${role}`),
          `falta el REVOKE de ${role} sobre ${table}`,
        );
      }
    }
  });

  it('GRANTS mínimos: la canónica sin DELETE', () => {
    assert.match(
      executableSql,
      new RegExp(`GRANT SELECT, INSERT, UPDATE ON TABLE ${PHONES_TABLE} TO service_role`),
    );
    assert.equal(
      new RegExp(`GRANT[^;']*DELETE[^;']*ON TABLE ${PHONES_TABLE}`).test(executableSql),
      false,
      'la tabla canónica no debe recibir DELETE: borrar una fila borra un tombstone',
    );
  });

  it('GRANTS mínimos: la de procedencias es APPEND-AND-READ ONLY', () => {
    assert.match(
      executableSql,
      new RegExp(`GRANT SELECT, INSERT ON TABLE ${SOURCES_TABLE} TO service_role`),
    );
    for (const privilege of ['UPDATE', 'DELETE']) {
      assert.equal(
        new RegExp(`GRANT[^;']*${privilege}[^;']*ON TABLE ${SOURCES_TABLE}`).test(
          executableSql,
        ),
        false,
        `la tabla de procedencias no debe recibir ${privilege}`,
      );
    }
  });

  it('NADIE recibe TRUNCATE, REFERENCES, TRIGGER ni MAINTAIN', () => {
    for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      assert.equal(
        new RegExp(`GRANT[^;']*\\b${privilege}\\b`).test(executableSql),
        false,
        `${privilege} no debe concederse a nadie`,
      );
    }
  });

  it('no se concede NADA a anon ni a authenticated', () => {
    assert.equal(
      /GRANT[^;']*\bTO (anon|authenticated)\b/.test(executableSql),
      false,
    );
  });

  it('no se crea ninguna política para anon ni authenticated', () => {
    assert.equal(
      /CREATE POLICY[\s\S]{0,300}?TO (anon|authenticated)\b/.test(executableSql),
      false,
    );
    assert.match(executableSql, /FOR ALL TO service_role/);
  });

  it('no usa `GRANT ALL`, que volvería a conceder lo que el REVOKE quita', () => {
    assert.equal(/GRANT ALL/.test(executableSql), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Lo que la migración NO hace
// ═══════════════════════════════════════════════════════════════════

describe('109 — lo que NO hace', () => {
  it('sin backfill: ni INSERT, ni UPDATE, ni SELECT ... INTO de datos', () => {
    assert.equal(/^\s*INSERT INTO/im.test(executableSql), false);
    assert.equal(/^\s*UPDATE\s+public\./im.test(executableSql), false);
    assert.equal(/^\s*DELETE FROM/im.test(executableSql), false);
  });

  it('sin trigger que sincronice la colección con el escalar del candidato', () => {
    // El único trigger permitido es el de `updated_at`.
    const triggers = [...executableSql.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(triggers, ['contact_enrichment_candidate_phones_set_updated_at']);
  });

  it('no toca `contact_enrichment_candidates.phone` ni la tabla de contactos', () => {
    assert.equal(
      /ALTER TABLE[^;]*contact_enrichment_candidates/i.test(executableSql),
      false,
    );
    assert.equal(/\bpublic\.contacts\b/.test(executableSql), false);
    assert.equal(/mobile_phone/.test(executableSql), false);
  });

  it('no crea ni cambia un feature flag, ni toca presupuestos o reservas', () => {
    assert.equal(/ENABLE_[A-Z_]+/.test(executableSql), false);
    assert.equal(/budget_rules/.test(executableSql), false);
    assert.equal(
      /ALTER TABLE[^;]*phone_reveal_credit_reservations/i.test(executableSql),
      false,
    );
  });

  it('no contiene PII: ni teléfono, ni correo, ni nombre, ni LinkedIn', () => {
    assert.equal(/@[a-z0-9.-]+\.[a-z]{2,}/i.test(executableSql), false, 'sin correo');
    assert.equal(/linkedin\.com/i.test(executableSql), false, 'sin LinkedIn');
    // Ninguna secuencia que parezca un número de teléfono literal.
    assert.equal(/'\+?\d{7,}'/.test(executableSql), false, 'sin teléfono literal');
  });
});
