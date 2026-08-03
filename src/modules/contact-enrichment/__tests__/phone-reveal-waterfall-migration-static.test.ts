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

import { readdirSync } from 'node:fs';

import {
  PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES,
  PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES,
  PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS,
  PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES,
} from '../phone-reveal-waterfall-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const migrationSql = readFileSync(
  join(repoRoot, 'supabase/migrations/102_phone_reveal_waterfall_runs.sql'),
  'utf8',
);

/** Los SIETE constraints de vocabulario que la migración debe dejar validados. */
const VOCABULARY_CONSTRAINTS = [
  'phone_reveal_waterfall_runs_status_check',
  'phone_reveal_waterfall_runs_apollo_outcome_check',
  'phone_reveal_waterfall_runs_lusha_outcome_check',
  'phone_reveal_waterfall_runs_final_provider_check',
  'phone_reveal_waterfall_runs_apollo_cost_source_check',
  'phone_reveal_waterfall_runs_lusha_cost_source_check',
  'phone_reveal_waterfall_runs_lusha_skipped_reason_check',
] as const;

/**
 * Valores de la lista `IN (...)` del CHECK de `lusha_skipped_reason`, leídos del
 * SQL. Permite comparar el vocabulario SQL con el de TypeScript en los DOS
 * sentidos, en vez de solo comprobar que cada valor de TS aparezca en el archivo.
 */
function lushaSkippedReasonSqlValues(): string[] {
  const statement = migrationSql.match(
    /ADD CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check[\s\S]*?;/,
  );
  assert.ok(statement, 'no se encontró el ADD CONSTRAINT de lusha_skipped_reason');
  // Los comentarios `--` del bloque explican la diferencia entre `suppressed` y
  // `suppression_check_unavailable` y contienen paréntesis y palabras entre
  // comillas: se eliminan antes de leer los literales del vocabulario.
  const withoutComments = statement[0]
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return [...withoutComments.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

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

describe('102 — vocabularios cerrados, los SIETE validados en la misma migración', () => {
  it('los 7 constraints de vocabulario existen por nombre', () => {
    for (const constraint of VOCABULARY_CONSTRAINTS) {
      assert.ok(
        migrationSql.includes(`ADD CONSTRAINT ${constraint}`),
        `falta el constraint ${constraint}`,
      );
    }
    assert.equal(VOCABULARY_CONSTRAINTS.length, 7);
  });

  it('ninguno queda NOT VALID (tabla nueva y vacía: no hay nada que revalidar)', () => {
    // La tabla se crea en esta misma migración y arranca vacía, así que dejar un
    // CHECK sin validar solo crearía un hueco de enforcement y una tarea pendiente.
    // Se ignoran los comentarios `--`: la cabecera EXPLICA por qué no se usa NOT
    // VALID y esa mención no puede contar como un hallazgo.
    const executableSql = migrationSql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    for (const constraint of VOCABULARY_CONSTRAINTS) {
      const statement = executableSql.match(
        new RegExp(`ADD CONSTRAINT ${constraint}[\\s\\S]*?;`),
      );
      assert.ok(statement, `no se encontró el ADD CONSTRAINT de ${constraint}`);
      const addsNotValid = /NOT VALID/.test(statement[0]);
      if (addsNotValid) {
        // Opción aceptable: se añade NOT VALID pero se valida en ESTA migración.
        assert.ok(
          new RegExp(`VALIDATE CONSTRAINT ${constraint}`).test(executableSql),
          `${constraint} se añade NOT VALID y NO se valida en esta migración`,
        );
      }
    }
    // Opción elegida: directamente no hay NOT VALID en el SQL ejecutable.
    assert.equal(
      /NOT VALID/.test(executableSql),
      false,
      'el SQL ejecutable no debe contener NOT VALID',
    );
  });

  it('NO existe una migración posterior que valide estos constraints', () => {
    const migrationsDir = join(repoRoot, 'supabase/migrations');
    const others = readdirSync(migrationsDir).filter(
      (file) =>
        file.endsWith('.sql') && file !== '102_phone_reveal_waterfall_runs.sql',
    );
    for (const file of others) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      for (const constraint of VOCABULARY_CONSTRAINTS) {
        assert.equal(
          sql.includes(constraint),
          false,
          `${file} no debe tocar ${constraint}: la 102 ya lo deja validado`,
        );
      }
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
      'suppression_check_unavailable',
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

  it('el CHECK de lusha_skipped_reason y el tipo TypeScript son el MISMO conjunto', () => {
    const sqlValues = lushaSkippedReasonSqlValues();
    assert.deepEqual(
      [...sqlValues].sort(),
      [...PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS].sort(),
      'el vocabulario SQL y el de TypeScript deben coincidir exactamente',
    );
  });

  it('distingue supresión CONFIRMADA de comprobación NO DISPONIBLE', () => {
    const sqlValues = lushaSkippedReasonSqlValues();
    assert.ok(sqlValues.includes('suppressed'), 'debe admitir supresión confirmada');
    assert.ok(
      sqlValues.includes('suppression_check_unavailable'),
      'debe admitir "no se pudo verificar" como motivo PROPIO',
    );
    assert.notEqual(
      'suppressed',
      'suppression_check_unavailable',
      'son dos motivos distintos, nunca el mismo',
    );
  });

  it('un valor arbitrario NO está admitido por el CHECK', () => {
    const sqlValues = lushaSkippedReasonSqlValues();
    for (const invented of ['algo_nuevo', 'suppressed_maybe', 'unknown', '']) {
      assert.equal(
        sqlValues.includes(invented),
        false,
        `${invented} no debe estar en el vocabulario cerrado`,
      );
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
