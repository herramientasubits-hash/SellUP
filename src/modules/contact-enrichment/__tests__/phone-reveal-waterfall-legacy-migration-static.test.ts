/**
 * Static checks on supabase/migrations/103_phone_reveal_waterfall_legacy_mode.sql
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2).
 *
 * This migration is a LOCAL DRAFT ONLY — it has NOT been applied to any remote
 * Supabase project (Production's latest applied migration is 101). These tests only
 * read SQL files from disk; they never connect to a database.
 *
 * They also pin the migration's vocabulary to the TypeScript one in
 * phone-reveal-waterfall-core.ts, in BOTH directions, so a modality can never be
 * added on one side only and produce a CHECK violation at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PHONE_REVEAL_WATERFALL_RUN_MODES } from '../phone-reveal-waterfall-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_FILE = '103_phone_reveal_waterfall_legacy_mode.sql';
const RUN_MODE_CONSTRAINT = 'phone_reveal_waterfall_runs_run_mode_check';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');

/** SQL ejecutable: el archivo sin las líneas de comentario `--`. */
const executableSql = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/**
 * Las migraciones autorizadas a DECLARAR el CHECK de `run_mode`, en orden de aplicación.
 * La última de la lista es la que fija el vocabulario VIGENTE.
 *
 * AGENT2A-SEARCH-MORE-PHONES-1 — la 122 entra aquí porque «Buscar más números» es una
 * modalidad REAL y nueva (`search_more`), no un reetiquetado: `legacy_lusha_only` exige que
 * el candidato NO tenga teléfono y `search_more` exige que SÍ lo tenga, así que reusar ese
 * valor haría que una auditoría de «¿se agotó Apollo?» respondiera al revés.
 *
 * Esta lista es la parte que hay que ampliar a propósito para ensanchar el vocabulario. El
 * ratchet de abajo sigue prohibiendo que CUALQUIER otra migración toque el constraint, que
 * es la garantía que importaba: lo que se impide es un ensanche SILENCIOSO, no un ensanche.
 */
const RUN_MODE_DECLARING_MIGRATIONS = [
  MIGRATION_FILE,
  '122_phone_reveal_search_more.sql',
] as const;

/** Literales del `IN (...)` del CHECK de run_mode, leídos del SQL de UNA migración. */
function runModeSqlValuesOf(sql: string): string[] {
  const statement = sql.match(
    new RegExp(`ADD CONSTRAINT ${RUN_MODE_CONSTRAINT}[\\s\\S]*?;`),
  );
  assert.ok(statement, `no se encontró el ADD CONSTRAINT de ${RUN_MODE_CONSTRAINT}`);
  const withoutComments = statement[0]
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return [...withoutComments.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** El vocabulario VIGENTE: el que declara la última migración autorizada. */
function effectiveRunModeSqlValues(): string[] {
  const last = RUN_MODE_DECLARING_MIGRATIONS[RUN_MODE_DECLARING_MIGRATIONS.length - 1];
  return runModeSqlValuesOf(readFileSync(join(migrationsDir, last), 'utf8'));
}

function runModeSqlValues(): string[] {
  return runModeSqlValuesOf(migrationSql);
}

describe('103 — numeración y orden', () => {
  it('el número 103 es único en supabase/migrations', () => {
    const numbered = readdirSync(migrationsDir).filter(
      (file) => file.endsWith('.sql') && /^103[_-]/.test(file),
    );
    assert.deepEqual(numbered, [MIGRATION_FILE]);
  });

  it('la migración 102 existe y NO se ha reescrito para incluir run_mode', () => {
    const sql102 = readFileSync(
      join(migrationsDir, '102_phone_reveal_waterfall_runs.sql'),
      'utf8',
    );
    // 102 sigue mergeada tal cual: la modalidad se añade en 103, no editando 102.
    assert.equal(sql102.includes('run_mode'), false);
    assert.equal(sql102.includes(RUN_MODE_CONSTRAINT), false);
  });

  it('103 declara explícitamente que debe aplicarse DESPUÉS de 102', () => {
    assert.ok(/102/.test(migrationSql));
    assert.ok(/102 then 103|102 y luego 103|AFTER it/i.test(migrationSql));
  });

  it('ninguna migración FUERA de la lista autorizada toca el constraint de run_mode', () => {
    const others = readdirSync(migrationsDir).filter(
      (file) =>
        file.endsWith('.sql') &&
        !(RUN_MODE_DECLARING_MIGRATIONS as readonly string[]).includes(file),
    );
    for (const file of others) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      assert.equal(
        sql.includes(RUN_MODE_CONSTRAINT),
        false,
        `${file} no debe tocar ${RUN_MODE_CONSTRAINT}: ensancharlo exige entrar en ` +
          'RUN_MODE_DECLARING_MIGRATIONS, que es lo que hace el ensanche revisable',
      );
    }
  });

  it('todas las migraciones autorizadas existen y declaran de verdad el constraint', () => {
    for (const file of RUN_MODE_DECLARING_MIGRATIONS) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      assert.ok(
        sql.includes(`ADD CONSTRAINT ${RUN_MODE_CONSTRAINT}`),
        `${file} está en la lista pero no declara el constraint`,
      );
    }
  });
});

describe('103 — campo explícito de modalidad', () => {
  it('añade la columna run_mode NOT NULL con default compatible', () => {
    assert.ok(
      /ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'full_waterfall'/.test(
        executableSql,
      ),
    );
  });

  it('el default es full_waterfall: las corridas normales no cambian de significado', () => {
    assert.ok(executableSql.includes("DEFAULT 'full_waterfall'"));
    assert.equal(executableSql.includes("DEFAULT 'legacy_lusha_only'"), false);
  });

  it('es idempotente (IF NOT EXISTS en la columna, guardia pg_constraint en el CHECK)', () => {
    assert.ok(executableSql.includes('ADD COLUMN IF NOT EXISTS run_mode'));
    assert.ok(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/.test(executableSql),
    );
  });
});

describe('103 — vocabulario SQL ↔ TypeScript', () => {
  it('el vocabulario VIGENTE es exactamente el de TypeScript (ambos sentidos)', () => {
    // Se compara contra el vocabulario EFECTIVO —el de la última migración autorizada— y no
    // contra el de la 103, porque es el efectivo el que la base de datos impone. Comparar
    // contra la 103 dejaría pasar una modalidad de TypeScript que ninguna migración acepta,
    // que es precisamente el `CHECK` violado en runtime que este test existe para impedir.
    const sqlValues = effectiveRunModeSqlValues().sort();
    const tsValues = [...PHONE_REVEAL_WATERFALL_RUN_MODES].sort();
    assert.deepEqual(sqlValues, tsValues);
  });

  it('cada modalidad de TypeScript aparece en el CHECK vigente', () => {
    const effective = effectiveRunModeSqlValues();
    for (const mode of PHONE_REVEAL_WATERFALL_RUN_MODES) {
      assert.ok(effective.includes(mode), mode);
    }
  });

  it('la 103 sigue declarando SU vocabulario histórico, sin reescribirse', () => {
    // La 103 está mergeada y aplicada: ensancharla editándola sería reescribir historia. El
    // valor nuevo vive en la 122.
    assert.deepEqual(runModeSqlValues().sort(), ['full_waterfall', 'legacy_lusha_only']);
    assert.equal(migrationSql.includes('search_more'), false);
  });
});

describe('103 — constraint validado, sin NOT VALID', () => {
  it('el CHECK se crea VALIDADO: no hay NOT VALID en el SQL ejecutable', () => {
    assert.equal(
      /NOT VALID/.test(executableSql),
      false,
      'el SQL ejecutable no debe contener NOT VALID',
    );
  });

  it('el CHECK se llama exactamente phone_reveal_waterfall_runs_run_mode_check', () => {
    assert.ok(executableSql.includes(`ADD CONSTRAINT ${RUN_MODE_CONSTRAINT}`));
  });
});

describe('103 — seguridad: aditiva, sin datos, sin permisos nuevos', () => {
  it('no hace backfill ni UPDATE/INSERT/DELETE de ninguna tabla', () => {
    for (const forbidden of [/\bUPDATE\s+public\./i, /\bINSERT\s+INTO\b/i, /\bDELETE\s+FROM\b/i]) {
      assert.equal(forbidden.test(executableSql), false, String(forbidden));
    }
  });

  it('no borra tablas, columnas, constraints ni índices', () => {
    for (const forbidden of [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bDROP\s+CONSTRAINT\b/i,
      /\bDROP\s+INDEX\b/i,
      /\bDROP\s+POLICY\b/i,
      /\bTRUNCATE\b/i,
    ]) {
      assert.equal(forbidden.test(executableSql), false, String(forbidden));
    }
  });

  it('no crea triggers ni funciones SQL', () => {
    for (const forbidden of [/CREATE\s+TRIGGER/i, /CREATE\s+(OR REPLACE\s+)?FUNCTION/i]) {
      assert.equal(forbidden.test(executableSql), false, String(forbidden));
    }
  });

  it('no toca RLS ni políticas: 102 sigue siendo la autoridad', () => {
    assert.equal(/ROW LEVEL SECURITY/i.test(executableSql), false);
    assert.equal(/CREATE\s+POLICY/i.test(executableSql), false);
    assert.equal(/ALTER\s+POLICY/i.test(executableSql), false);
  });

  it('no concede ningún permiso a authenticated ni a anon', () => {
    assert.equal(/\bGRANT\b/i.test(executableSql), false);
    assert.equal(/\bauthenticated\b/.test(executableSql), false);
    assert.equal(/\banon\b/.test(executableSql), false);
  });

  it('la ÚNICA tabla alterada es phone_reveal_waterfall_runs', () => {
    const altered = [
      ...executableSql.matchAll(/ALTER TABLE\s+(?:public\.)?([a-z_]+)/gi),
    ].map((m) => m[1]);
    assert.ok(altered.length > 0);
    for (const table of altered) {
      assert.equal(table, 'phone_reveal_waterfall_runs', table);
    }
  });

  it('no declara ninguna columna que pudiera alojar PII', () => {
    for (const forbidden of ['phone', 'email', 'linkedin', 'full_name', 'person_id']) {
      assert.equal(
        new RegExp(`ADD COLUMN[^;]*${forbidden}`, 'i').test(executableSql),
        false,
        forbidden,
      );
    }
  });

  it('deja constancia de que NO se aplicó en ningún proyecto remoto', () => {
    assert.ok(/LOCAL DRAFT ONLY/i.test(migrationSql));
    assert.ok(/NOT been applied to any remote/i.test(migrationSql));
  });

  it('deja constancia de que no crea ni activa el flag', () => {
    assert.ok(migrationSql.includes('ENABLE_PHONE_REVEAL_WATERFALL'));
    assert.ok(/remains\s+unset|unset in every environment/i.test(migrationSql));
  });
});
