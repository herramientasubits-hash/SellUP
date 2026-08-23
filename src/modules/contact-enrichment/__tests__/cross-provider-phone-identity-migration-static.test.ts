/**
 * cross-provider-phone-identity-migration-static.test.ts
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1)
 *
 * Lee la migración 124 como TEXTO y comprueba sus garantías de seguridad sin
 * ejecutarla. No hay base de datos, no hay Supabase y NADA se aplica: esta migración
 * se entrega dentro del PR y se aplica en otro momento, por decisión humana.
 *
 * Lo que se fija aquí es lo que hace que aplicarla sea reversible en la práctica:
 * additiva, idempotente, sin backfill destructivo y sin perder ni un valor del
 * vocabulario anterior.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PROVIDER_CONTACT_IDENTITY_RESOLUTION_SOURCES,
  PROVIDER_CONTACT_IDENTITY_PROVIDER_KEYS,
} from '../provider-contact-identity-core';
import { LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES } from '../lusha-identity-resolution-runtime-core';
import { PHONE_REVEAL_CREDIT_OPERATION_KEYS } from '../phone-reveal-credit-budget-core';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const sql = readFileSync(
  join(repoRoot, 'supabase/migrations/124_cross_provider_phone_identity.sql'),
  'utf8',
);

/**
 * El MISMO SQL sin comentarios `--`.
 *
 * Hace falta para leer un `ADD CONSTRAINT ... ;` completo: un comentario del bloque
 * puede contener un punto y coma en prosa (p. ej. «It is persisted; the reveal may
 * run.»), y una expresión perezosa hasta el primer `;` se cortaría ahí y leería un
 * vocabulario truncado — es decir, daría verde comparando media lista.
 */
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** Literales del `IN (...)` de un CHECK, leídos del SQL ya sin comentarios. */
function checkVocabulary(constraintName: string): string[] {
  const statement = executableSql.match(
    new RegExp(`ADD CONSTRAINT ${constraintName}[\\s\\S]*?;`),
  );
  assert.ok(statement, `no se encontró el ADD CONSTRAINT de ${constraintName}`);
  return [...statement[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('124 — seguridad de la migración', () => {
  test('es ADITIVA: no borra datos, no elimina columnas ni tablas', () => {
    for (const forbidden of [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
    ]) {
      assert.equal(
        forbidden.test(sql),
        false,
        `la migración no puede contener ${forbidden}`,
      );
    }
  });

  test('no reescribe filas existentes: el único UPDATE es el de la propia función', () => {
    // Un `UPDATE ... SET` a nivel de migración sería un backfill. Los UPDATE que sí
    // aparecen viven DENTRO de funciones plpgsql y actúan sobre la fila de una
    // operación en curso, no sobre el histórico.
    // Sin indentación = fuera de toda función. Los UPDATE que sí existen viven
    // indentados dentro de plpgsql y actúan sobre la fila de la operación en curso.
    const topLevelUpdates = executableSql
      .split('\n')
      .filter((line) => /^UPDATE\s/i.test(line));
    assert.deepEqual(topLevelUpdates, [], 'ningún UPDATE de nivel superior');
  });

  test('es IDEMPOTENTE en todo lo que crea', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.contact_provider_identities/);
    // Cada ADD COLUMN es condicional.
    const addColumns = [...sql.matchAll(/ADD COLUMN(\s+IF NOT EXISTS)?/g)];
    assert.ok(addColumns.length >= 3, 'debe añadir al menos tres columnas');
    for (const match of addColumns) {
      assert.ok(match[1], 'todo ADD COLUMN debe llevar IF NOT EXISTS');
    }
    // Cada CREATE INDEX es condicional.
    const createIndexes = [...sql.matchAll(/CREATE (UNIQUE )?INDEX(\s+IF NOT EXISTS)?/g)];
    assert.ok(createIndexes.length >= 4);
    for (const match of createIndexes) {
      assert.ok(match[2], 'todo CREATE INDEX debe llevar IF NOT EXISTS');
    }
    // Cada constraint nuevo está guardado por una consulta a pg_constraint.
    assert.ok(
      (sql.match(/FROM pg_constraint/g) ?? []).length >= 5,
      'cada ADD CONSTRAINT nuevo se guarda contra pg_constraint',
    );
  });

  test('el SQL EJECUTABLE no nombra ningún flag ni ninguna herramienta de despliegue', () => {
    // Se comprueba sobre `executableSql` a propósito: la cabecera SÍ menciona
    // `ENABLE_PHONE_REVEAL_WATERFALL` para declarar que sigue APAGADO, y esa mención
    // documental es justamente lo contrario de un cambio de flag.
    for (const forbidden of ['ENABLE_PHONE_REVEAL_WATERFALL', 'vercel', 'db push']) {
      assert.equal(
        executableSql.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `el SQL ejecutable no puede nombrar ${forbidden}`,
      );
    }
  });
});

describe('124 — contact_provider_identities', () => {
  test('clave única (candidate_id, provider_key): una identidad por proveedor', () => {
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_provider_identities_candidate_provider\s*\n\s*ON public\.contact_provider_identities \(candidate_id, provider_key\)/,
    );
  });

  test('el vocabulario de procedencia del SQL es EXACTAMENTE el de TypeScript', () => {
    assert.deepEqual(
      checkVocabulary('contact_provider_identities_resolution_source_check').sort(),
      [...PROVIDER_CONTACT_IDENTITY_RESOLUTION_SOURCES].sort(),
    );
  });

  test('provider_key es un conjunto cerrado y coincide con TypeScript', () => {
    for (const provider of PROVIDER_CONTACT_IDENTITY_PROVIDER_KEYS) {
      assert.ok(sql.includes(`'${provider}'`));
    }
    assert.match(sql, /contact_provider_identities_provider_key_check/);
  });

  test('un id vacío no puede ocupar el hueco único', () => {
    assert.match(sql, /LENGTH\(TRIM\(provider_contact_id\)\) > 0/);
  });

  test('RLS activo y SOLO service_role: el navegador nunca lee un id de proveedor', () => {
    assert.match(
      sql,
      /ALTER TABLE public\.contact_provider_identities ENABLE ROW LEVEL SECURITY/,
    );
    assert.match(sql, /service_role_all_contact_provider_identities/);
    const policyBlock = sql.slice(sql.indexOf('service_role_all_contact_provider_identities'));
    assert.equal(
      /TO (anon|authenticated)/.test(policyBlock.slice(0, 600)),
      false,
      'ninguna policy para anon ni authenticated',
    );
  });

  test('borrar el candidato borra su identidad (CASCADE)', () => {
    assert.match(
      sql,
      /REFERENCES public\.contact_enrichment_candidates\(id\) ON DELETE CASCADE/,
    );
  });

  test('la identidad SOBREVIVE a la corrida que la descubrió (SET NULL)', () => {
    assert.match(
      sql,
      /resolved_run_id[\s\S]{0,120}REFERENCES public\.phone_reveal_waterfall_runs\(id\) ON DELETE SET NULL/,
    );
  });
});

describe('124 — grano de reserva por operación', () => {
  test('operation_key nace NOT NULL con DEFAULT phone_reveal: legacy sin backfill', () => {
    assert.match(
      sql,
      /ADD COLUMN IF NOT EXISTS operation_key text NOT NULL DEFAULT 'phone_reveal'/,
    );
  });

  test('el vocabulario del SQL es el de TypeScript', () => {
    for (const key of PHONE_REVEAL_CREDIT_OPERATION_KEYS) {
      assert.ok(sql.includes(`'${key}'`), `falta operation_key ${key}`);
    }
  });

  test('los dos índices únicos pasan a incluir operation_key', () => {
    assert.match(
      sql,
      /uq_phone_reveal_credit_reservations_active_op\s*\n\s*ON public\.phone_reveal_credit_reservations \(candidate_id, provider_key, operation_key\)\s*\n\s*WHERE status = 'reserved'/,
    );
    assert.match(
      sql,
      /uq_phone_reveal_credit_reservations_group_op\s*\n\s*ON public\.phone_reveal_credit_reservations\s*\n\s*\(reservation_group_id, provider_key, operation_key\)/,
    );
  });

  test('los nuevos se CREAN antes de que los viejos se borren', () => {
    const createNew = sql.indexOf('uq_phone_reveal_credit_reservations_active_op');
    const dropOld = sql.indexOf('DROP INDEX IF EXISTS public.uq_phone_reveal_credit_reservations_active_leg');
    assert.ok(createNew > 0 && dropOld > 0);
    assert.ok(
      createNew < dropOld,
      'nunca puede haber un instante sin protección contra doble cobro',
    );
  });

  test('el pozo NO se segmenta por operación: una bolsa, un saldo', () => {
    // El índice de agregación de disponibilidad sigue siendo (provider, scope, period).
    assert.equal(
      sql.includes('idx_phone_reveal_credit_reservations_active_pool (provider_key, scope_type, scope_id, period_start, operation_key)'),
      false,
    );
  });

  test('la reserva agrega la demanda por POZO antes de comparar', () => {
    // Es el arreglo que impide autorizar 6 sobre un saldo de 5.
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.reserve_and_create_phone_reveal_run'));
    assert.match(fn, /SUM\(\(leg->>'credits'\)::numeric\)\s*AS required_credits/);
    assert.match(fn, /GROUP BY 1, 2, 3, 4/);
  });

  test('un payload legacy sin operation_key produce la fila de siempre', () => {
    assert.match(sql, /COALESCE\(v_leg->>'operation_key', 'phone_reveal'\)/);
  });
});

describe('124 — claim independiente de la búsqueda', () => {
  test('la búsqueda tiene su PROPIA columna, distinta de la del reveal', () => {
    assert.match(
      sql,
      /ADD COLUMN IF NOT EXISTS lusha_identity_search_attempted_at timestamptz NULL/,
    );
    // Y el claim del reveal no se toca en esta migración.
    assert.equal(
      /SET lusha_attempted_at/.test(sql),
      false,
      'la 124 no puede escribir el claim del reveal',
    );
  });

  test('el claim es un UPDATE condicional sobre NULL: solo el primero gana', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.claim_lusha_identity_search'));
    assert.match(fn, /WHERE id = p_run_id\s*\n\s*AND lusha_identity_search_attempted_at IS NULL/);
    assert.match(fn, /RETURN 'already_claimed'/);
  });

  test('el TTL de 24 h se re-comprueba en la base, no solo en la aplicación', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.claim_lusha_identity_search'));
    assert.match(fn, /authorized_at <= now\(\) - interval '24 hours'/);
    assert.match(fn, /RETURN 'authorization_expired'/);
  });

  test('una corrida terminal no puede reclamar una búsqueda', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.claim_lusha_identity_search'));
    assert.match(fn, /status IN \('revealed', 'no_phone_found', 'failed', 'aborted'\)/);
  });

  test('el vocabulario de desenlace coincide con TypeScript', () => {
    assert.deepEqual(
      checkVocabulary('phone_reveal_waterfall_runs_identity_search_outcome_check').sort(),
      [...LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES].sort(),
    );
  });
});

describe('124 — persistencia write-once de la identidad', () => {
  test('nunca sobrescribe: ON CONFLICT DO NOTHING y luego lee al ganador', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.persist_contact_provider_identity'));
    assert.match(fn, /ON CONFLICT \(candidate_id, provider_key\) DO NOTHING/);
    assert.match(fn, /'already_present'/);
    assert.equal(
      /DO UPDATE SET/.test(fn),
      false,
      'reapuntar un candidato a otra persona jamás puede ser un efecto silencioso',
    );
  });

  test('rechaza un id vacío antes de escribir', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.persist_contact_provider_identity'));
    assert.match(fn, /LENGTH\(TRIM\(p_provider_contact_id\)\) = 0/);
    assert.match(fn, /'invalid_input'/);
  });
});

describe('124 — privilegios de las funciones nuevas', () => {
  for (const fn of [
    'claim_lusha_identity_search(uuid)',
    'persist_contact_provider_identity(uuid, text, text, text, uuid)',
  ]) {
    test(`${fn} se revoca de PUBLIC/anon/authenticated`, () => {
      assert.ok(
        sql.includes(`REVOKE ALL ON FUNCTION public.${fn}\n  FROM PUBLIC, anon, authenticated;`),
        `falta el REVOKE de ${fn}`,
      );
      assert.ok(
        sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}\n  TO postgres, service_role;`),
        `falta el GRANT de ${fn}`,
      );
    });
  }

  test('toda función SECURITY DEFINER fija su search_path', () => {
    // Sobre `executableSql`: la cabecera de la sección 7 explica en prosa qué es una
    // SECURITY DEFINER, y contar esa mención convertiría un comentario en un fallo.
    const definers = (executableSql.match(/SECURITY DEFINER/g) ?? []).length;
    const searchPaths = (
      executableSql.match(/SET search_path = pg_catalog, pg_temp/g) ?? []
    ).length;
    assert.equal(definers, searchPaths, 'toda SECURITY DEFINER fija su search_path');
    assert.equal(definers, 3, 'las dos funciones nuevas más la reserva re-declarada');
  });
});

describe('124 — el vocabulario anterior sobrevive entero', () => {
  test('el ensanche de lusha_skipped_reason no pierde ningún motivo previo', () => {
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
      assert.ok(sql.includes(`'${reason}'`), `la 124 pierde el motivo ${reason}`);
    }
  });

  test('el ensanche usa NOT VALID + VALIDATE: no reescanea la tabla al desplegar', () => {
    const block = sql.slice(
      sql.indexOf('DROP CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check'),
    );
    assert.match(block, /NOT VALID/);
    assert.match(block, /VALIDATE CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check/);
  });
});
