/**
 * Seguridad estática de supabase/migrations/104_phone_reveal_credit_reservations.sql
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4F).
 *
 * Complementa …-migration-static.test.ts, que fija la SEMÁNTICA (vocabularios, fórmula
 * de disponibilidad, serialización). Este archivo fija la SUPERFICIE DE ATAQUE, que es
 * lo que 4F encontró abierto:
 *
 *   PostgreSQL concede EXECUTE a PUBLIC por DEFECTO al crear una función. Las funciones
 *   de esta migración son SECURITY DEFINER y escriben reservas y corridas saltándose la
 *   RLS que la propia migración acaba de activar. Con el grant por defecto, cualquiera
 *   con la clave anon podía invocarlas por PostgREST. Ese default es la vulnerabilidad;
 *   los REVOKE de la sección 9 son el arreglo, y este archivo impide que se pierdan.
 *
 * Lo que se verifica:
 *   * número de migración único;
 *   * RLS activa, UNA política y sólo para `service_role`; cero para
 *     `authenticated`/`anon`;
 *   * cero grants de EXECUTE a PUBLIC / anon / authenticated, y grant explícito a los
 *     roles que sí lo necesitan;
 *   * la superficie de SECURITY DEFINER es la MÍNIMA: exactamente las tres funciones que
 *     el servidor invoca, ni una inalcanzable de más;
 *   * higiene de cada SECURITY DEFINER: `search_path` fijado con `pg_catalog` PRIMERO,
 *     owner fijado, EXECUTE revocado de PUBLIC, y CERO SQL dinámico;
 *   * constraints mínimos: importe > 0, límite > 0, vocabularios cerrados de proveedor y
 *     estado, período válido, identificadores no ambiguos, FK a la corrida e índices de
 *     reservas activas y de grupo;
 *   * PII-free y sin secretos.
 *
 * Solo lee archivos de disco: no conecta a ninguna base de datos, no llama a ningún
 * proveedor y no gasta un solo crédito.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

/**
 * Las TRES funciones que la migración crea, con su firma para el GRANT.
 *
 * 4F eliminó `try_reserve_phone_reveal_credits`: la operación atómica la sustituyó por
 * completo en el arranque, y dejar una SECURITY DEFINER inalcanzable en producción es
 * superficie de ataque sin contrapartida — está a un grant mal puesto de ser invocable.
 */
const FUNCTIONS = [
  {
    name: 'confirm_phone_reveal_credits',
    signature: 'confirm_phone_reveal_credits(uuid, numeric, text)',
  },
  {
    name: 'release_phone_reveal_credits',
    signature: 'release_phone_reveal_credits(uuid, text)',
  },
  {
    name: 'reserve_and_create_phone_reveal_run',
    signature:
      'reserve_and_create_phone_reveal_run(uuid, uuid, text, uuid, jsonb, jsonb)',
  },
] as const;

/** Cuerpo de una función, desde su CREATE hasta el `END $$;` que la cierra. */
function functionBody(name: string): string {
  const start = executableSql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `no se encontró la función ${name}`);
  const end = executableSql.indexOf('END $$;', start);
  assert.notEqual(end, -1, `la función ${name} no cierra con END $$;`);
  return executableSql.slice(start, end + 'END $$;'.length);
}

// ═══════════════════════════════════════════════════════════════
// 1. Numeración
// ═══════════════════════════════════════════════════════════════

describe('104 — numeración única', () => {
  it('ningún otro archivo de migración empieza por 104', () => {
    const conflicting = readdirSync(migrationsDir).filter(
      (file) => file.startsWith('104') && file !== MIGRATION_FILE,
    );
    assert.deepEqual(conflicting, []);
  });

  it('declara que debe aplicarse DESPUÉS de 102 y 103', () => {
    assert.ok(/Migrations 102 and 103 ARE applied/.test(migrationSql));
    assert.ok(/must be applied AFTER them/.test(migrationSql));
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. RLS y políticas
// ═══════════════════════════════════════════════════════════════

describe('104 — RLS: una política, y sólo para service_role', () => {
  it('la tabla tiene RLS habilitada', () => {
    assert.ok(
      /ALTER TABLE public\.phone_reveal_credit_reservations\s+ENABLE ROW LEVEL SECURITY/.test(
        executableSql,
      ),
    );
  });

  it('hay exactamente UNA política y su TO es service_role', () => {
    const policies = [...executableSql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map(
      (m) => m[0],
    );
    assert.equal(policies.length, 1, 'una sola política');
    assert.ok(/FOR ALL TO service_role/.test(policies[0]));
  });

  it('CERO políticas para `authenticated` y CERO para `anon`', () => {
    // Con RLS activa y sin política, esos roles no ven ni una fila. Es la diferencia
    // entre "el navegador no debería llegar aquí" y "el navegador no puede".
    for (const role of ['authenticated', 'anon']) {
      const policyForRole = new RegExp(`CREATE POLICY[\\s\\S]*?TO ${role}\\b`);
      assert.equal(
        policyForRole.test(executableSql),
        false,
        `no puede haber política para ${role}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Privilegios de ejecución (el default de PostgreSQL es el bug)
// ═══════════════════════════════════════════════════════════════

describe('104 — EXECUTE revocado de PUBLIC/anon/authenticated', () => {
  for (const fn of FUNCTIONS) {
    it(`${fn.name}: REVOKE ALL … FROM PUBLIC, anon, authenticated`, () => {
      const revoke = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\([^)]*\\)\\s*\\n?\\s*FROM PUBLIC, anon, authenticated;`,
      );
      assert.ok(
        revoke.test(executableSql),
        `falta el REVOKE de ${fn.name}: sin él, PostgreSQL deja EXECUTE a PUBLIC`,
      );
    });

    it(`${fn.name}: GRANT EXECUTE sólo a postgres y service_role`, () => {
      const grant = new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn.name}\\([^)]*\\)\\s*\\n?\\s*TO ([^;]+);`,
      );
      const match = executableSql.match(grant);
      assert.ok(match, `falta el GRANT de ${fn.name}`);
      const roles = match[1].split(',').map((r) => r.trim());
      assert.deepEqual(roles.sort(), ['postgres', 'service_role']);
    });
  }

  it('NINGÚN GRANT de esta migración alcanza a PUBLIC, anon o authenticated', () => {
    const grants = [...executableSql.matchAll(/GRANT [\s\S]*?;/g)].map((m) => m[0]);
    assert.ok(grants.length > 0, 'debe haber grants explícitos');
    for (const grant of grants) {
      for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        assert.equal(
          new RegExp(`\\b${role}\\b`).test(grant),
          false,
          `un GRANT alcanza a ${role}: ${grant.slice(0, 120)}`,
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Higiene de cada SECURITY DEFINER
// ═══════════════════════════════════════════════════════════════

describe('104 — higiene de las funciones SECURITY DEFINER', () => {
  it('las tres funciones declaradas son las únicas que crea la migración', () => {
    const created = [
      ...executableSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map((m) => m[1]);
    assert.deepEqual(
      created.sort(),
      FUNCTIONS.map((f) => f.name).sort(),
    );
  });

  for (const fn of FUNCTIONS) {
    it(`${fn.name}: search_path FIJO y con pg_catalog PRIMERO`, () => {
      const body = functionBody(fn.name);
      assert.ok(/SECURITY DEFINER/.test(body), 'es SECURITY DEFINER');
      // `pg_catalog` delante impide que un objeto temporal ensombrezca un tipo o una
      // relación del catálogo. Un `search_path` que empiece por `pg_temp` deja esa
      // puerta entreabierta, y `public` en el path haría el resto del cuerpo dependiente
      // de quién pueda crear ahí.
      assert.ok(
        /SET search_path = pg_catalog, pg_temp\b/.test(body),
        `${fn.name} debe fijar search_path = pg_catalog, pg_temp`,
      );
      assert.equal(
        /SET search_path = public/.test(body),
        false,
        `${fn.name} no puede incluir public en el search_path`,
      );
    });

    it(`${fn.name}: cada referencia a una tabla va esquema-cualificada`, () => {
      const body = functionBody(fn.name);
      for (const clause of ['FROM', 'INTO', 'UPDATE', 'JOIN']) {
        const bare = new RegExp(
          `\\b${clause}\\s+(?!public\\.)(phone_reveal_\\w+)`,
          'g',
        );
        assert.equal(
          bare.test(body),
          false,
          `${fn.name} referencia una tabla sin cualificar tras ${clause}`,
        );
      }
    });

    it(`${fn.name}: CERO SQL dinámico`, () => {
      const body = functionBody(fn.name);
      // `EXECUTE format(...)` / `EXECUTE '…' || …` es donde vive la inyección en
      // plpgsql. Aquí no hay ninguno: todo son sentencias estáticas con parámetros.
      // (`PERFORM` no construye SQL, así que no cuenta.)
      assert.equal(
        /\bEXECUTE\s+(format\s*\(|'|"|\w+\s*\|\|)/.test(body),
        false,
        `${fn.name} usa SQL dinámico`,
      );
      assert.equal(/\bquote_ident\b|\bquote_literal\b/.test(body), false);
    });
  }

  it('el owner de las tres funciones se fija explícitamente', () => {
    // Una SECURITY DEFINER corre con los privilegios de su OWNER, así que el owner es
    // parte del contrato de seguridad y no puede quedar en "el rol que ejecutó la
    // migración, sea cual sea".
    for (const fn of FUNCTIONS) {
      const owner = new RegExp(
        `ALTER FUNCTION public\\.${fn.name}\\([^)]*\\)\\s*\\n?\\s*OWNER TO postgres;`,
      );
      assert.ok(owner.test(executableSql), `falta el OWNER TO de ${fn.name}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Constraints mínimos
// ═══════════════════════════════════════════════════════════════

describe('104 — constraints mínimos de la tabla de reservas', () => {
  it('el importe reservado es ESTRICTAMENTE positivo', () => {
    assert.ok(/CHECK \(credits_reserved > 0\)/.test(executableSql));
  });

  it('el límite del pozo es ESTRICTAMENTE positivo', () => {
    // Un techo de 0 no tiene disponibilidad contra la que reservar; admitirlo dejaría
    // filas que sólo pueden existir por error.
    assert.ok(/CHECK \(limit_credits > 0\)/.test(executableSql));
    assert.equal(/CHECK \(limit_credits >= 0\)/.test(executableSql), false);
  });

  it('un costo confirmado nunca es negativo', () => {
    assert.ok(
      /CHECK \(credits_confirmed IS NULL OR credits_confirmed >= 0\)/.test(executableSql),
    );
  });

  it('el vocabulario de proveedor es CERRADO', () => {
    assert.ok(/CHECK \(provider_key IN \('apollo', 'lusha'\)\)/.test(executableSql));
  });

  it('el vocabulario de estado es CERRADO', () => {
    const check = executableSql.slice(
      executableSql.indexOf('phone_reveal_credit_reservations_status_check'),
    );
    const values = [...check.slice(0, 400).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(values.sort(), ['confirmed', 'released', 'reserved']);
  });

  it('el vocabulario de scope es CERRADO', () => {
    assert.ok(
      /CHECK \(scope_type IN \('user', 'group', 'role', 'global'\)\)/.test(executableSql),
    );
  });

  it('los límites del período son VÁLIDOS (fin > inicio)', () => {
    // La identidad del pozo incluye `period_start`. Una ventana invertida o vacía
    // fabricaría un pozo que ninguna otra fila puede igualar: exposición que no ocupa
    // la disponibilidad de nadie.
    assert.ok(/CHECK \(period_end > period_start\)/.test(executableSql));
  });

  it('una fila confirmada lleva cifra Y procedencia; una reservada no las finge', () => {
    assert.ok(
      /status = 'confirmed' AND credits_confirmed IS NOT NULL AND cost_truth IS NOT NULL/.test(
        executableSql,
      ),
    );
  });
});

describe('104 — identificadores no ambiguos', () => {
  it('AT MOST ONE reserva viva por (candidato, proveedor)', () => {
    assert.ok(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_active_leg[\s\S]*?\(candidate_id, provider_key\)[\s\S]*?WHERE status = 'reserved'/.test(
        executableSql,
      ),
    );
  });

  it('UNA sola pata por proveedor dentro de un grupo de reserva, en TODO estado', () => {
    // Sin esto, un reintento que reusara el group id podría añadir una segunda pata
    // Apollo al mismo grupo, y la liquidación tendría que adivinar cuántas hay.
    const match = executableSql.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_group_leg[\s\S]*?;/,
    );
    assert.ok(match, 'falta el índice de unicidad por grupo+proveedor');
    assert.ok(/\(reservation_group_id, provider_key\)/.test(match[0]));
    assert.equal(
      /WHERE/.test(match[0]),
      false,
      'no puede ser parcial: debe cubrir también las patas ya liquidadas',
    );
  });

  it('la clave de autorización es ÚNICA (idempotencia)', () => {
    assert.ok(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_waterfall_runs_authorization_key[\s\S]*?\(authorization_key\)[\s\S]*?WHERE authorization_key IS NOT NULL/.test(
        executableSql,
      ),
    );
  });

  it('hay FK a la corrida cuando la reserva queda asociada, y al candidato', () => {
    assert.ok(
      /run_id\s+uuid\s+NULL\s*\n\s*REFERENCES public\.phone_reveal_waterfall_runs\(id\) ON DELETE SET NULL/.test(
        executableSql,
      ),
    );
    assert.ok(
      /candidate_id\s+uuid\s+NOT NULL\s*\n\s*REFERENCES public\.contact_enrichment_candidates\(id\) ON DELETE CASCADE/.test(
        executableSql,
      ),
    );
  });

  it('hay índice de reservas ACTIVAS por pozo y de GRUPO', () => {
    assert.ok(
      /idx_phone_reveal_credit_reservations_active_pool[\s\S]*?WHERE status = 'reserved'/.test(
        executableSql,
      ),
    );
    assert.ok(
      /idx_phone_reveal_credit_reservations_group\b[\s\S]*?\(reservation_group_id\)/.test(
        executableSql,
      ),
    );
    assert.ok(
      /idx_phone_reveal_credit_reservations_orphans[\s\S]*?WHERE status = 'reserved' AND run_id IS NULL/.test(
        executableSql,
      ),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. PII y secretos
// ═══════════════════════════════════════════════════════════════

describe('104 — sin PII y sin secretos', () => {
  it('ninguna columna podría alojar datos personales', () => {
    const createTable = executableSql.slice(
      executableSql.indexOf('CREATE TABLE IF NOT EXISTS public.phone_reveal_credit_reservations'),
      executableSql.indexOf('-- ── 2.') >= 0
        ? undefined
        : undefined,
    );
    const table = createTable.slice(0, createTable.indexOf('\n);') + 3);
    for (const forbidden of [
      'phone',
      'email',
      'linkedin',
      'first_name',
      'last_name',
      'full_name',
      'contact_id',
      'person_id',
    ]) {
      assert.equal(
        new RegExp(`^\\s*\\w*${forbidden}\\w*\\s`, 'mi').test(table),
        false,
        `la tabla no puede tener una columna ${forbidden}`,
      );
    }
  });

  it('el archivo no contiene credenciales ni claves', () => {
    for (const secret of [
      /api[_-]?key\s*=\s*'/i,
      /password\s*=\s*'/i,
      /\bsk-[A-Za-z0-9]/,
      /service_role_key/i,
      /Bearer\s+[A-Za-z0-9]/,
    ]) {
      assert.equal(secret.test(migrationSql), false, `posible secreto: ${secret}`);
    }
  });

  it('no hay NADA destructivo ni ninguna escritura de datos', () => {
    for (const destructive of [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bDROP\s+INDEX\b/i,
      /\bTRUNCATE\b/i,
      /\bDELETE\s+FROM\b/i,
    ]) {
      assert.equal(destructive.test(executableSql), false, `destructivo: ${destructive}`);
    }
    // Los únicos INSERT/UPDATE viven DENTRO de las funciones (son su trabajo). A nivel
    // de migración no se escribe ni una fila: no hay backfill.
    const outsideFunctions = FUNCTIONS.reduce(
      (sql, fn) => sql.replace(functionBody(fn.name), ''),
      executableSql,
    );
    assert.equal(/\bINSERT INTO\b/.test(outsideFunctions), false);
    assert.equal(/\bUPDATE\s+public\./.test(outsideFunctions), false);
  });
});
