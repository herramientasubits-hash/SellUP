/**
 * Static checks on supabase/migrations/102_phone_reveal_waterfall_runs.sql
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
 *
 * This migration is a LOCAL DRAFT ONLY — it has NOT been applied to any remote
 * Supabase project. These tests only read the SQL file from disk; they never
 * connect to a database.
 *
 * They also pin the migration's vocabularies to the TypeScript ones in
 * phone-reveal-waterfall-core.ts, so a value can never be added on one side only
 * and produce a CHECK violation at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES,
  PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES,
  PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES,
} from '../phone-reveal-waterfall-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const migrationSql = readFileSync(
  join(repoRoot, 'supabase/migrations/102_phone_reveal_waterfall_runs.sql'),
  'utf8',
);

/**
 * Cuerpo del `CREATE TABLE`: solo las declaraciones de columnas, sin comentarios
 * `--`. Es el texto correcto para las aserciones de PII — tanto la cabecera del
 * archivo como los `COMMENT ON` DOCUMENTAN qué datos nunca se guardan ("no phone,
 * email, name, linkedin"), así que buscar esas palabras en el archivo completo
 * daría un falso positivo. Lo que importa es que no exista una COLUMNA capaz de
 * alojarlas.
 */
const createTableBody = (() => {
  const start = migrationSql.indexOf('CREATE TABLE IF NOT EXISTS public.phone_reveal_waterfall_runs');
  assert.notEqual(start, -1, 'el CREATE TABLE debe existir');
  const end = migrationSql.indexOf('\n);', start);
  assert.notEqual(end, -1, 'el CREATE TABLE debe cerrarse');
  return migrationSql
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
})();

describe('102 — la tabla existe con las columnas del contrato', () => {
  it('crea public.phone_reveal_waterfall_runs de forma idempotente', () => {
    assert.ok(
      migrationSql.includes(
        'CREATE TABLE IF NOT EXISTS public.phone_reveal_waterfall_runs',
      ),
    );
  });

  it('declara las columnas de autorización, de cada pata y de resolución', () => {
    const required = [
      'candidate_id',
      'status',
      'authorized_at',
      'authorized_by',
      'authorized_by_role',
      'max_credits_authorized',
      'apollo_attempted_at',
      'apollo_outcome',
      'apollo_cost_credits',
      'apollo_cost_source',
      'lusha_eligible',
      'lusha_skipped_reason',
      'lusha_attempted_at',
      'lusha_outcome',
      'lusha_cost_credits',
      'lusha_cost_source',
      'final_provider',
      'completed_at',
      'error_code',
      'created_at',
      'updated_at',
    ];
    for (const column of required) {
      assert.ok(migrationSql.includes(column), `falta la columna ${column}`);
    }
  });

  it('los costos de Apollo y Lusha son columnas SEPARADAS (nunca un total mezclado)', () => {
    assert.ok(migrationSql.includes('apollo_cost_credits'));
    assert.ok(migrationSql.includes('lusha_cost_credits'));
    assert.equal(
      /total_cost_credits|combined_cost|credits_total/i.test(migrationSql),
      false,
      'no debe existir una columna de costo combinado',
    );
  });
});

describe('102 — vocabularios cerrados, todos NOT VALID', () => {
  it('cada CHECK de vocabulario se añade NOT VALID', () => {
    const checks = migrationSql.match(/CHECK \([\s\S]*?\)\s*NOT VALID/g) ?? [];
    assert.ok(checks.length >= 7, `esperados ≥7 CHECK NOT VALID, hay ${checks.length}`);
    // Cada constraint de vocabulario, por nombre, debe terminar en NOT VALID: es
    // el patrón de las migraciones 095/097/100/101 y lo que permite ampliar un
    // vocabulario después sin revalidar filas históricas.
    for (const constraint of [
      'phone_reveal_waterfall_runs_status_check',
      'phone_reveal_waterfall_runs_apollo_outcome_check',
      'phone_reveal_waterfall_runs_lusha_outcome_check',
      'phone_reveal_waterfall_runs_final_provider_check',
      'phone_reveal_waterfall_runs_apollo_cost_source_check',
      'phone_reveal_waterfall_runs_lusha_cost_source_check',
      'phone_reveal_waterfall_runs_lusha_skipped_reason_check',
    ]) {
      const block = migrationSql.match(
        new RegExp(`ADD CONSTRAINT ${constraint}[\\s\\S]*?NOT VALID`),
      );
      assert.ok(block, `${constraint} debe añadirse con NOT VALID`);
    }
  });

  it('el vocabulario de status del SQL es exactamente el de TypeScript', () => {
    const allStatuses = [
      ...PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES,
      ...PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES,
    ];
    for (const status of allStatuses) {
      assert.ok(migrationSql.includes(`'${status}'`), `falta el status ${status}`);
    }
  });

  it('los desenlaces de Apollo cubren todos los cierres que el core puede emitir', () => {
    for (const outcome of [
      'revealed',
      'revealed_from_cache',
      'no_phone_found',
      'error',
      'blocked_suppressed',
      'do_not_contact',
      'suppression_check_unavailable',
      'cache_unavailable',
    ]) {
      assert.ok(migrationSql.includes(`'${outcome}'`), `falta apollo_outcome ${outcome}`);
    }
  });

  it('final_provider solo admite apollo | lusha | none', () => {
    assert.ok(migrationSql.includes('phone_reveal_waterfall_runs_final_provider_check'));
    assert.ok(migrationSql.includes("'none'"));
  });

  it('cost_source admite reported | assumed_cap | unknown en las DOS patas', () => {
    assert.ok(migrationSql.includes('phone_reveal_waterfall_runs_apollo_cost_source_check'));
    assert.ok(migrationSql.includes('phone_reveal_waterfall_runs_lusha_cost_source_check'));
    for (const source of ['reported', 'assumed_cap', 'unknown']) {
      assert.ok(migrationSql.includes(`'${source}'`), `falta cost_source ${source}`);
    }
  });

  it('lusha_skipped_reason es un vocabulario cerrado con todos los motivos del core', () => {
    for (const reason of [
      'missing_lusha_contact_id',
      'apollo_revealed',
      'suppressed',
      'dnc',
      'authorization_expired',
      'role_not_allowed',
      'feature_disabled',
      'already_attempted',
      'not_needed',
      'provider_error',
    ]) {
      assert.ok(migrationSql.includes(`'${reason}'`), `falta el motivo ${reason}`);
    }
  });
});

describe('102 — índices', () => {
  it('índice único PARCIAL: una sola corrida activa por candidato', () => {
    assert.ok(
      migrationSql.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_waterfall_runs_active_candidate',
      ),
    );
    assert.ok(/ON public\.phone_reveal_waterfall_runs \(candidate_id\)/.test(migrationSql));
    // El filtro del índice debe cubrir exactamente los estados no terminales.
    for (const status of PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES) {
      assert.ok(
        new RegExp(`WHERE status IN \\([^)]*'${status}'`).test(migrationSql),
        `el índice parcial debe incluir ${status}`,
      );
    }
    for (const status of PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES) {
      const whereClause = migrationSql.match(/WHERE status IN \([^)]*\)/)?.[0] ?? '';
      assert.equal(
        whereClause.includes(`'${status}'`),
        false,
        `el índice parcial NO debe incluir el estado terminal ${status}`,
      );
    }
  });

  it('los estados reclamables del claim son un subconjunto de los activos', () => {
    for (const status of PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES) {
      assert.ok(
        (PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES as readonly string[]).includes(status),
        `${status} debe ser un estado activo`,
      );
    }
  });

  it('índice de búsqueda por candidato y fecha de autorización descendente', () => {
    assert.ok(
      migrationSql.includes(
        'idx_phone_reveal_waterfall_runs_candidate_authorized_at',
      ),
    );
    assert.ok(/\(candidate_id, authorized_at DESC\)/.test(migrationSql));
  });
});

describe('102 — RLS: service_role only', () => {
  it('habilita RLS en la tabla nueva', () => {
    assert.ok(
      migrationSql.includes(
        'ALTER TABLE public.phone_reveal_waterfall_runs ENABLE ROW LEVEL SECURITY',
      ),
    );
  });

  it('crea UNA política, solo para service_role, de forma idempotente', () => {
    assert.ok(migrationSql.includes('service_role_all_phone_reveal_waterfall_runs'));
    assert.ok(migrationSql.includes('FOR ALL TO service_role'));
    assert.ok(migrationSql.includes('SELECT 1 FROM pg_policies'));
    const policies = migrationSql.match(/CREATE POLICY/g) ?? [];
    assert.equal(policies.length, 1);
  });

  it('NO crea políticas para authenticated ni anon (el navegador no llega a la tabla)', () => {
    assert.equal(/TO\s+authenticated/i.test(migrationSql), false);
    assert.equal(/TO\s+anon/i.test(migrationSql), false);
  });
});

describe('102 — seguridad: aditiva, sin datos, sin tocar nada existente', () => {
  it('no hace backfill ni UPDATE de ninguna tabla', () => {
    assert.equal(/\bUPDATE\s+public\./i.test(migrationSql), false);
  });

  it('no borra filas ni objetos', () => {
    assert.equal(/\bDELETE\s+FROM/i.test(migrationSql), false);
    assert.equal(/\bTRUNCATE\b/i.test(migrationSql), false);
    assert.equal(/\bDROP\s+TABLE\b/i.test(migrationSql), false);
    assert.equal(/\bDROP\s+COLUMN\b/i.test(migrationSql), false);
    assert.equal(/\bDROP\s+POLICY\b/i.test(migrationSql), false);
  });

  it('no inserta ninguna fila (la tabla arranca vacía)', () => {
    assert.equal(/\bINSERT\s+INTO/i.test(migrationSql), false);
  });

  it('no crea triggers ni funciones', () => {
    assert.equal(/\bCREATE\s+(OR REPLACE\s+)?TRIGGER\b/i.test(migrationSql), false);
    assert.equal(/\bCREATE\s+(OR REPLACE\s+)?FUNCTION\b/i.test(migrationSql), false);
  });

  it('NO toca contact_enrichment_candidates salvo como referencia de FK', () => {
    assert.equal(
      /ALTER TABLE public\.contact_enrichment_candidates/i.test(migrationSql),
      false,
    );
    assert.ok(
      migrationSql.includes('REFERENCES public.contact_enrichment_candidates(id)'),
      'la FK al candidato sí debe existir',
    );
  });

  it('NO toca phone_reveal_cache, phone_reveal_suppression_audit ni provider_usage_logs', () => {
    for (const table of [
      'phone_reveal_cache',
      'phone_reveal_suppression_audit',
      'provider_usage_logs',
      'contacts',
    ]) {
      assert.equal(
        new RegExp(`ALTER TABLE public\\.${table}`, 'i').test(migrationSql),
        false,
        `no debe alterar ${table}`,
      );
    }
  });

  it('la única tabla creada es phone_reveal_waterfall_runs', () => {
    const created = migrationSql.match(/CREATE TABLE[^(]*public\.(\w+)/g) ?? [];
    assert.equal(created.length, 1);
    assert.ok(created[0].includes('phone_reveal_waterfall_runs'));
  });

  it('el CREATE TABLE no declara ninguna columna que pudiera alojar PII', () => {
    // Se busca solo en el cuerpo del CREATE TABLE: la cabecera del archivo y los
    // COMMENT ON documentan explícitamente qué datos nunca se guardan, y esas
    // menciones no deben contar como hallazgos.
    for (const forbidden of [
      'phone_number',
      'normalized_phone',
      'email',
      'linkedin',
      'full_name',
      'first_name',
      'last_name',
      'provider_person_id',
      'lusha_contact_id',
    ]) {
      assert.equal(
        createTableBody.includes(forbidden),
        false,
        `la tabla no debe tener nada parecido a ${forbidden}`,
      );
    }
  });

  it('deja constancia de que NO se aplicó en ningún proyecto remoto', () => {
    assert.ok(migrationSql.includes('LOCAL DRAFT ONLY'));
    assert.ok(migrationSql.includes('ENABLE_PHONE_REVEAL_WATERFALL'));
  });
});
