/**
 * Static checks on supabase/migrations/104_phone_reveal_credit_reservations.sql
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4E).
 *
 * This migration is a LOCAL DRAFT ONLY — it has NOT been applied to any remote Supabase
 * project. These tests only read SQL files from disk; they never connect to a database,
 * never call a provider and never spend a credit.
 *
 * Lo que fijan, y por qué cada cosa:
 *
 *   * VOCABULARIOS espejados con el core puro, en LOS DOS SENTIDOS: un estado o una
 *     procedencia de costo añadida en un solo lado produciría una violación de CHECK en
 *     runtime, es decir, una reserva que no se puede liquidar.
 *   * LA FÓRMULA de disponibilidad del SQL es la misma que la del core
 *     (`limit - consumed - reservado activo`). Si divergen, el preflight y la reserva
 *     dirían cosas distintas sobre el mismo dinero.
 *   * `limit_credits` es NOT NULL: sin regla de crédito no puede existir una reserva, que
 *     es lo que convierte "no hay presupuesto" en un bloqueo y no en un techo inventado.
 *   * SERIALIZACIÓN: hay lock por pozo y se toma en orden determinista (sin eso, dos
 *     autorizaciones concurrentes vuelven a poder gastar la misma disponibilidad, y dos
 *     multi-pata podrían interbloquearse).
 *   * `confirm` NUNCA acepta un costo nulo y `release` NUNCA toca una fila confirmada.
 *   * la migración es ADITIVA: no borra, no reescribe y no toca datos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS,
  PHONE_REVEAL_CREDIT_RESERVATION_STATUSES,
} from '../phone-reveal-credit-reservation-core';
import { PHONE_REVEAL_CREDIT_PROVIDER_KEYS } from '../phone-reveal-credit-budget-core';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

const MIGRATION_FILE = '104_phone_reveal_credit_reservations.sql';
const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');

/** SQL ejecutable: el archivo sin las líneas de comentario `--`. */
const executableSql = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** Literales del `IN (...)` de un CHECK, leídos del SQL ejecutable. */
function checkValues(constraintName: string): string[] {
  const index = executableSql.indexOf(constraintName);
  assert.notEqual(index, -1, `no se encontró el CHECK ${constraintName}`);
  const tail = executableSql.slice(index);
  const list = tail.match(/IN \(([^)]*)\)/);
  assert.ok(list, `el CHECK ${constraintName} no tiene una lista IN (...)`);
  return [...(list[1].matchAll(/'([^']+)'/g))].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════════════════
// 1. Vocabularios espejo del core (en los dos sentidos)
// ═══════════════════════════════════════════════════════════════

describe('migración 104 — vocabularios espejados con el core puro', () => {
  it('los estados del CHECK son exactamente los del core', () => {
    const sqlValues = checkValues('phone_reveal_credit_reservations_status_check');
    assert.deepEqual(sqlValues.sort(), [...PHONE_REVEAL_CREDIT_RESERVATION_STATUSES].sort());
  });

  it('la procedencia del costo del CHECK es exactamente la del core (sin `unknown`)', () => {
    const sqlValues = checkValues('phone_reveal_credit_reservations_cost_truth_check');
    assert.deepEqual(sqlValues.sort(), [...PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS].sort());
    // `unknown` no puede existir aquí: una confirmación siempre aterriza en una cifra, y
    // cuando el proveedor no reportó ninguna la cifra es el tope (`assumed_cap`).
    assert.equal(sqlValues.includes('unknown'), false);
  });

  it('los proveedores del CHECK son exactamente los del core', () => {
    const sqlValues = checkValues('phone_reveal_credit_reservations_provider_key_check');
    assert.deepEqual(sqlValues.sort(), [...PHONE_REVEAL_CREDIT_PROVIDER_KEYS].sort());
  });

  it('los scopes del CHECK son los cuatro de la resolución de presupuesto', () => {
    const sqlValues = checkValues('phone_reveal_credit_reservations_scope_type_check');
    assert.deepEqual(sqlValues.sort(), ['global', 'group', 'role', 'user']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. La fórmula y el modelo per-provider
// ═══════════════════════════════════════════════════════════════

describe('migración 104 — disponibilidad = limit - consumed - reservado activo', () => {
  it('la resta de la función incluye los TRES términos', () => {
    // El espejo ejecutable de esta fórmula vive en
    // `simulatePhoneRevealCreditReservation`, que es lo que las suites offline prueban.
    assert.ok(/limit_credits'\)::numeric/.test(executableSql));
    assert.ok(/-\s*COALESCE\(\(v_leg->>'consumed_credits'\)::numeric, 0\)/.test(executableSql));
    assert.ok(/-\s*v_reserved_active/.test(executableSql));
  });

  it('la exposición activa se suma SOLO sobre filas `reserved` del MISMO pozo', () => {
    const sumBlock = executableSql.slice(
      executableSql.indexOf('SELECT COALESCE(SUM(r.credits_reserved)'),
      executableSql.indexOf('v_available :='),
    );
    assert.ok(/r\.status = 'reserved'/.test(sumBlock), sumBlock);
    for (const column of ['provider_key', 'scope_type', 'scope_id', 'period_start']) {
      assert.ok(new RegExp(`r\\.${column}`).test(sumBlock), `${column} no participa del pozo`);
    }
    // `scope_id` nulo (regla global) tiene que comparar con IS NOT DISTINCT FROM: con `=`
    // un pozo global nunca se encontraría a sí mismo y la exposición no descontaría.
    assert.ok(/scope_id IS NOT DISTINCT FROM/.test(sumBlock), sumBlock);
  });

  it('sin regla de crédito NO se puede reservar: limit_credits es NOT NULL', () => {
    assert.ok(/limit_credits\s+numeric\s+NOT NULL/.test(executableSql));
    // Y la función lo rechaza explícitamente antes de tocar nada.
    assert.ok(/'budget_not_configured'/.test(executableSql));
  });

  it('ALL-OR-NOTHING: una pata insuficiente rechaza la autorización completa', () => {
    const decision = executableSql.slice(
      executableSql.indexOf('IF jsonb_array_length(v_insufficient) > 0'),
    );
    assert.ok(/RETURN jsonb_build_object\('status', 'insufficient_credits'/.test(decision));
    // El INSERT ocurre DESPUÉS de ese return, así que ninguna pata queda reservada.
    assert.ok(
      decision.indexOf('INSERT INTO public.phone_reveal_credit_reservations') >
        decision.indexOf("'insufficient_credits'"),
    );
  });

  it('la reserva ocupa el TOPE (>0) y no admite una pata de 0 créditos', () => {
    assert.ok(/credits_reserved\s+numeric\s+NOT NULL/.test(executableSql));
    assert.ok(/CHECK \(credits_reserved > 0\)/.test(executableSql));
    assert.ok(/'leg_credits_not_positive'/.test(executableSql));
  });
});

// ═══════════════════════════════════════════════════════════════
// 2b. La función ATÓMICA de 4F comparte la misma aritmética
// ═══════════════════════════════════════════════════════════════
//
// `reserve_and_create_phone_reveal_run` sustituye a la reserva sola en el arranque, así
// que si su fórmula o su orden divergieran, el camino vigente estaría gobernado por
// reglas que ninguna otra prueba mira.

describe('migración 104 — la operación atómica no reimplementa el dinero', () => {
  const atomic = (() => {
    const start = executableSql.indexOf(
      'CREATE OR REPLACE FUNCTION public.reserve_and_create_phone_reveal_run(',
    );
    assert.notEqual(start, -1);
    const end = executableSql.indexOf('END $$;', start);
    return executableSql.slice(start, end);
  })();

  it('usa la MISMA resta de tres términos', () => {
    assert.ok(/limit_credits'\)::numeric/.test(atomic));
    assert.ok(/-\s*COALESCE\(\(v_leg->>'consumed_credits'\)::numeric, 0\)/.test(atomic));
    assert.ok(/-\s*v_reserved_active/.test(atomic));
  });

  it('suma la exposición sobre el MISMO pozo, con IS NOT DISTINCT FROM', () => {
    assert.ok(/r\.status = 'reserved'/.test(atomic));
    assert.ok(/scope_id IS NOT DISTINCT FROM/.test(atomic));
  });

  it('serializa cada pozo con el MISMO lock y en orden determinista', () => {
    assert.ok(/pg_advisory_xact_lock\(hashtext\(v_lock_key\)\)/.test(atomic));
    assert.ok(/ORDER BY 1/.test(atomic));
  });

  it('el cortocircuito idempotente ocurre ANTES del lock y de toda escritura', () => {
    // Si el orden se invirtiera, un reintento tomaría locks y podría reservar de nuevo
    // antes de descubrir que su corrida ya existía.
    const shortCircuit = atomic.indexOf("'already_created'");
    const lock = atomic.indexOf('pg_advisory_xact_lock');
    const insert = atomic.indexOf('INSERT INTO public.phone_reveal_credit_reservations');
    assert.ok(shortCircuit > 0 && lock > 0 && insert > 0);
    assert.ok(shortCircuit < lock, 'la idempotencia va antes del lock');
    assert.ok(shortCircuit < insert, 'y antes de cualquier INSERT');
  });

  it('los DOS INSERT viven en el mismo bloque que atrapa unique_violation', () => {
    // Es lo que garantiza el rollback conjunto: un EXCEPTION a nivel de función dejaría
    // las reservas escritas, que es exactamente la huérfana que 4F elimina.
    const reservationInsert = atomic.indexOf(
      'INSERT INTO public.phone_reveal_credit_reservations',
    );
    const runInsert = atomic.indexOf('INSERT INTO public.phone_reveal_waterfall_runs');
    const handler = atomic.indexOf('WHEN unique_violation THEN');
    assert.ok(reservationInsert > 0 && runInsert > reservationInsert);
    assert.ok(handler > runInsert, 'el handler cierra por debajo de los dos INSERT');
    // Y el bloque interno abre ANTES del primer INSERT.
    const innerBegin = atomic.lastIndexOf('BEGIN', reservationInsert);
    assert.ok(innerBegin > 0 && innerBegin < reservationInsert);
  });

  it('la corrida nace con su grupo de reserva Y su clave, en el propio INSERT', () => {
    const runInsert = atomic.slice(
      atomic.indexOf('INSERT INTO public.phone_reveal_waterfall_runs'),
    );
    assert.ok(/credit_reservation_group_id, authorization_key/.test(runInsert));
    assert.ok(/p_reservation_group_id,\s*\n\s*p_authorization_key/.test(runInsert));
  });

  it('distingue qué índice único falló en vez de colapsarlo todo en un error', () => {
    assert.ok(/GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME/.test(atomic));
    assert.ok(/uq_phone_reveal_waterfall_runs_authorization_key/.test(atomic));
    assert.ok(/uq_phone_reveal_credit_reservations_active_leg/.test(atomic));
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Serialización: el lock que hace la reserva atómica
// ═══════════════════════════════════════════════════════════════

describe('migración 104 — serialización por pozo', () => {
  it('hay un lock de transacción por pozo, con la clave del pozo', () => {
    assert.ok(/pg_advisory_xact_lock\(hashtext\(v_lock_key\)\)/.test(executableSql));
    const lockBlock = executableSql.slice(
      executableSql.indexOf('FOR v_lock_key IN'),
      executableSql.indexOf('pg_advisory_xact_lock'),
    );
    for (const part of ['provider_key', 'scope_type', 'scope_id', 'period_start']) {
      assert.ok(lockBlock.includes(part), `la clave del lock no incluye ${part}`);
    }
  });

  it('los locks se toman en ORDEN determinista (sin eso, dos multi-pata se interbloquean)', () => {
    const lockBlock = executableSql.slice(
      executableSql.indexOf('FOR v_lock_key IN'),
      executableSql.indexOf('pg_advisory_xact_lock'),
    );
    assert.ok(/ORDER BY 1/.test(lockBlock), lockBlock);
  });

  it('la suma de exposición ocurre DESPUÉS de tomar los locks', () => {
    assert.ok(
      executableSql.indexOf('pg_advisory_xact_lock') <
        executableSql.indexOf('SELECT COALESCE(SUM(r.credits_reserved)'),
      'leer la exposición antes del lock reabre la ventana de doble gasto',
    );
  });

  it('el índice único parcial impide dos reservas vivas de la misma pata del candidato', () => {
    assert.ok(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_active_leg[\s\S]*\(candidate_id, provider_key\)[\s\S]*WHERE status = 'reserved'/.test(
        executableSql,
      ),
    );
    // Y la carrera que ese índice gana se traduce a un estado, no a una excepción.
    assert.ok(/WHEN unique_violation THEN/.test(executableSql));
    assert.ok(/'already_reserved'/.test(executableSql));
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Confirmación y liberación
// ═══════════════════════════════════════════════════════════════

describe('migración 104 — confirmar y liberar', () => {
  it('confirm exige una cifra >= 0 y una procedencia válida: NUNCA un costo nulo', () => {
    const fn = executableSql.slice(
      executableSql.indexOf('FUNCTION public.confirm_phone_reveal_credits'),
      executableSql.indexOf('FUNCTION public.release_phone_reveal_credits'),
    );
    assert.ok(/p_credits_confirmed IS NULL/.test(fn));
    assert.ok(/p_credits_confirmed < 0/.test(fn));
    assert.ok(/p_cost_truth NOT IN \('reported', 'assumed_cap'\)/.test(fn));
    assert.ok(/RETURN 'invalid_input'/.test(fn));
  });

  it('ni confirm ni release pisan una fila ya resuelta (idempotencia)', () => {
    for (const [fnName, boundary] of [
      ['confirm_phone_reveal_credits', 'FUNCTION public.release_phone_reveal_credits'],
      ['release_phone_reveal_credits', 'COMMENT ON TABLE'],
    ] as const) {
      const fn = executableSql.slice(
        executableSql.indexOf(`FUNCTION public.${fnName}`),
        executableSql.indexOf(boundary),
      );
      assert.ok(/FOR UPDATE/.test(fn), `${fnName} debe bloquear la fila`);
      assert.ok(/'already_confirmed'/.test(fn), fnName);
      assert.ok(/'already_released'/.test(fn), fnName);
      assert.ok(/'not_found'/.test(fn), fnName);
    }
  });

  it('una fila confirmada guarda cifra y procedencia; una reservada no finge tenerlas', () => {
    assert.ok(
      /status = 'confirmed' AND credits_confirmed IS NOT NULL AND cost_truth IS NOT NULL/.test(
        executableSql,
      ),
    );
    assert.ok(
      /status <> 'confirmed' AND credits_confirmed IS NULL AND cost_truth IS NULL/.test(
        executableSql,
      ),
    );
  });

  it('las huérfanas son consultables: reservada + sin corrida', () => {
    assert.ok(
      /idx_phone_reveal_credit_reservations_orphans[\s\S]*WHERE status = 'reserved' AND run_id IS NULL/.test(
        executableSql,
      ),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Seguridad y carácter aditivo
// ═══════════════════════════════════════════════════════════════

describe('migración 104 — RLS, asociación atómica y nada destructivo', () => {
  it('RLS activa y UNA sola política, para service_role', () => {
    assert.ok(
      /ALTER TABLE public\.phone_reveal_credit_reservations ENABLE ROW LEVEL SECURITY/.test(
        executableSql,
      ),
    );
    assert.ok(/FOR ALL TO service_role/.test(executableSql));
    // Ninguna política para el navegador.
    assert.equal(/TO authenticated/.test(executableSql), false);
    assert.equal(/TO anon/.test(executableSql), false);
  });

  it('la corrida gana la columna de asociación (nullable y aditiva)', () => {
    assert.ok(
      /ALTER TABLE public\.phone_reveal_waterfall_runs\s*\n\s*ADD COLUMN IF NOT EXISTS credit_reservation_group_id uuid NULL/.test(
        executableSql,
      ),
    );
  });

  it('no hay NADA destructivo ni ninguna escritura de datos', () => {
    for (const forbidden of [
      /DROP TABLE/i,
      /DROP COLUMN/i,
      /DROP CONSTRAINT/i,
      /DROP INDEX/i,
      /DROP POLICY/i,
      /TRUNCATE/i,
      /DELETE FROM/i,
      /UPDATE public\.contact_enrichment_candidates/i,
      /INSERT INTO public\.provider_usage_logs/i,
      /INSERT INTO public\.budget_rules/i,
    ]) {
      assert.equal(forbidden.test(executableSql), false, String(forbidden));
    }
  });

  it('es idempotente: tabla, índices, columna y funciones se pueden re-ejecutar', () => {
    assert.ok(/CREATE TABLE IF NOT EXISTS public\.phone_reveal_credit_reservations/.test(executableSql));
    assert.ok(/ADD COLUMN IF NOT EXISTS credit_reservation_group_id/.test(executableSql));
    assert.ok(/ADD COLUMN IF NOT EXISTS authorization_key/.test(executableSql));
    for (const fn of [
      'reserve_and_create_phone_reveal_run',
      'confirm_phone_reveal_credits',
      'release_phone_reveal_credits',
    ]) {
      assert.ok(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`).test(executableSql),
        fn,
      );
    }
    // Los CHECK se crean VALIDADOS: tabla nueva y vacía, sin mantenimiento pendiente.
    assert.equal(/NOT VALID/.test(executableSql), false);
  });

  it('la tabla es PII-free por construcción: la lista de columnas es la esperada', () => {
    // Se comparan NOMBRES DE COLUMNA, no el texto del bloque: la tabla se llama
    // `phone_reveal_credit_reservations`, así que buscar "phone" en el cuerpo daría un
    // falso positivo por el propio nombre.
    const body = executableSql.slice(
      executableSql.indexOf('CREATE TABLE IF NOT EXISTS public.phone_reveal_credit_reservations'),
      executableSql.indexOf('DO $$'),
    );
    const columns = [...body.matchAll(/^\s{2}([a-z_]+)\s{2,}(uuid|text|numeric|timestamptz)/gm)].map(
      (m) => m[1],
    );
    assert.deepEqual(columns.sort(), [
      'authorized_by',
      'candidate_id',
      'confirmed_at',
      'cost_truth',
      'created_at',
      'credits_confirmed',
      'credits_reserved',
      'id',
      'limit_credits',
      'period_end',
      'period_start',
      'provider_key',
      'release_reason',
      'released_at',
      'reservation_group_id',
      'run_id',
      'scope_id',
      'scope_type',
      'status',
    ]);
    // Ninguna columna puede albergar identidad ni un id de contacto de proveedor.
    for (const forbidden of ['phone', 'email', 'linkedin', 'name', 'contact_id', 'person_id']) {
      assert.equal(
        columns.some((column) => column.includes(forbidden)),
        false,
        `no puede existir una columna con "${forbidden}"`,
      );
    }
  });

  it('declara explícitamente que es un borrador local no aplicado', () => {
    assert.ok(/LOCAL DRAFT ONLY/.test(migrationSql));
    assert.ok(/has NOT been applied to any remote/i.test(migrationSql));
  });
});
