/**
 * Seguridad estática de supabase/migrations/107_phone_reveal_cache_and_suppression_grants.sql
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4J).
 *
 * QUÉ CIERRA LA MIGRACIÓN QUE ESTE ARCHIVO PROTEGE
 *
 * La 099 activó RLS en `phone_reveal_cache` y en `phone_reveal_suppression_audit` y le dejó
 * a cada una UNA política de `service_role`. Ese control sostiene peso, pero no es la única
 * capa: la RLS decide QUÉ FILAS puede tocar un rol y el GRANT de tabla decide si el rol
 * puede tocar la tabla EN ABSOLUTO. La 099 sólo cerró la primera.
 *
 * Supabase aplica `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated,
 * service_role`, así que las dos nacieron con los 8 privilegios (`arwdDxtm`) para los dos
 * roles alcanzables desde el navegador — según la auditoría de sólo lectura del hito 4H, que
 * recorrió las cuatro tablas del subsistema y registró relacl idéntica en estas dos (ver la
 * cabecera de la 107 sobre la procedencia del dato). Lo que lo hace peor aquí que en las
 * tablas del
 * waterfall (hito 4H, migración 106) es QUÉ guardan estas dos:
 *
 *   * `phone_reveal_cache` es la ÚNICA tabla del subsistema que guarda un teléfono revelado
 *     en claro, y la única de las cuatro con filas en Producción;
 *   * `phone_reveal_cache` es ADEMÁS el almacén de tombstones. `TRUNCATE` no lo filtra la
 *     RLS — es una operación de tabla —, así que vaciarla no pierde una caché: BORRA TODOS
 *     LOS TOMBSTONES DE DSAR. Las personas que pidieron ser olvidadas vuelven a ser
 *     revelables en silencio, y el siguiente reveal sobre ellas es una llamada pagada;
 *   * `phone_reveal_suppression_audit` es la prueba durable de que una supresión ocurrió:
 *     UPDATE, DELETE o TRUNCATE sobre ella es la capacidad de reescribir el historial de
 *     cumplimiento;
 *   * `TRIGGER` sobre la caché es colgar código con el alcance del dueño justo al lado de los
 *     números de teléfono.
 *
 * DIFERENCIA DELIBERADA CON LA 106
 *
 * La 106 le dio a `service_role` un sobre uniforme de cuatro privilegios en sus dos tablas.
 * La 107 NO: concede por tabla exactamente lo que demuestran las llamadas reales, así que
 * este archivo verifica DOS listas distintas y comprueba que la que falta en cada una siga
 * faltando —
 *
 *   * `phone_reveal_cache` → SELECT, INSERT, UPDATE. Sin DELETE: borrar una fila borra un
 *     tombstone, y no hay ni un `.delete()` contra esa tabla en `src/`.
 *   * `phone_reveal_suppression_audit` → SELECT, INSERT. Sin UPDATE ni DELETE: un registro
 *     de auditoría que su propio escritor puede reescribir no es evidencia.
 *
 * Lo que se verifica aquí:
 *   * numeración única del archivo y orden declarado respecto a la 099;
 *   * REVOKE explícito a PUBLIC, anon, authenticated — y TAMBIÉN a `service_role`, porque el
 *     GRANT sólo SUMA y sin ese REVOKE el `arwdDxtm` heredado dejaría
 *     TRUNCATE/REFERENCES/TRIGGER intactos en el rol con el que se autentica el servidor;
 *   * el GRANT de cada tabla enumera SU lista exacta y nunca usa `ALL`;
 *   * TRUNCATE, REFERENCES, TRIGGER y MAINTAIN no se conceden a nadie;
 *   * DELETE no se concede en ninguna de las dos, y UPDATE tampoco en la de auditoría;
 *   * bloque `DO` con guarda `to_regclass` INDEPENDIENTE por tabla;
 *   * el COMMENT va DENTRO de la guarda (suelto levantaría 42P01 en una base sin la tabla);
 *   * no se toca la RLS: ni CREATE/DROP/ALTER POLICY, ni `FORCE ROW LEVEL SECURITY`;
 *   * no se tocan las tablas de la 106, ni el DEFAULT PRIVILEGES del esquema, ni el trigger
 *     `set_updated_at` de la 099;
 *   * cero escrituras de datos y cero DDL de forma;
 *   * PII-free y sin secretos.
 *
 * Sólo lee archivos de disco: no conecta a ninguna base, no llama a ningún proveedor y no
 * gasta un solo crédito.
 *
 * La validación de COMPORTAMIENTO (matriz real de 8 privilegios × 3 roles, intentos por rol
 * con `SET ROLE`, la cascada de `account_id` sin DELETE, y reaplicación sobre los cuatro
 * estados) corre contra un PostgreSQL efímero y vive en
 * `phone-reveal-cache-grants-postgres.test.ts`.
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

const MIGRATION_FILE = '107_phone_reveal_cache_and_suppression_grants.sql';
const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');

/**
 * Las DOS tablas de la 099, cada una con su lista propia. La asimetría es el contenido de
 * este hito: la 106 concedió un sobre uniforme, la 107 concede lo demostrado.
 */
const TABLES = [
  {
    name: 'public.phone_reveal_cache',
    granted: 'SELECT, INSERT, UPDATE',
    /** Privilegios que NO deben aparecer en el GRANT de esta tabla. */
    withheld: ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'],
  },
  {
    name: 'public.phone_reveal_suppression_audit',
    granted: 'SELECT, INSERT',
    withheld: ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'],
  },
] as const;

/** Los cuatro que este hito le quita a TODO el mundo, `service_role` incluido. */
const FORBIDDEN_FOR_EVERYONE = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;

/** SQL ejecutable: el archivo sin las líneas de comentario `--`. */
const executableSql = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/**
 * El texto de los COMMENT es prosa: nombra TRUNCATE, anon, DELETE y demás. Buscar palabras
 * clave sobre el SQL completo daría falsos positivos, así que las aserciones de privilegios
 * se hacen sobre el SQL SIN esos literales.
 */
const sqlWithoutCommentLiteral = executableSql.replace(
  /\$comment\$[\s\S]*?\$comment\$/g,
  "'<comment>'",
);

const escaped = (table: string) => table.replace(/\./g, '\\.');

// ═══════════════════════════════════════════════════════════════
// 1. Numeración y orden
// ═══════════════════════════════════════════════════════════════

describe('107 — numeración única', () => {
  it('ningún otro archivo de migración empieza por 107', () => {
    const conflicting = readdirSync(migrationsDir).filter(
      (file) => file.startsWith('107') && file !== MIGRATION_FILE,
    );
    assert.deepEqual(conflicting, []);
  });

  /**
   * Lo que importa del número es el ORDEN RELATIVO, no ser el máximo global. Afirmar
   * `max === 107` sería el mismo antipatrón que este repositorio ya retiró de la prueba de
   * la 105 en `92d49dd`: no sostiene ningún invariante real y convierte cada hito futuro en
   * una edición obligada de este archivo. Lo que sí hay que garantizar es que la 107 se
   * aplica DESPUÉS de la 099, que crea las dos tablas que endurece.
   */
  it('lleva un número posterior al de la 099, que crea las tablas que endurece', () => {
    const numbered = readdirSync(migrationsDir)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file))
      .map((file) => ({ file, number: Number(file.slice(0, 3)) }));

    const cacheMigration = numbered.find((entry) => entry.file.startsWith('099'));
    assert.ok(cacheMigration, 'no se encontró la migración 099, que crea las dos tablas');
    assert.ok(Number(MIGRATION_FILE.slice(0, 3)) > cacheMigration.number);
  });

  it('declara que debe aplicarse DESPUÉS de la 099, que crea las dos tablas', () => {
    assert.match(migrationSql, /Must be applied AFTER 099/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. REVOKE: los cuatro sujetos, en las dos tablas, ninguno olvidado
// ═══════════════════════════════════════════════════════════════

describe('107 — REVOKE ALL PRIVILEGES', () => {
  for (const { name, granted } of TABLES) {
    for (const grantee of ['PUBLIC', 'anon', 'authenticated']) {
      it(`revoca todo a ${grantee} en ${name}`, () => {
        assert.match(
          sqlWithoutCommentLiteral,
          new RegExp(`REVOKE ALL PRIVILEGES ON TABLE ${escaped(name)} FROM ${grantee}\\b`),
        );
      });
    }

    /**
     * EL HALLAZGO QUE 4H PAGÓ EN UN POSTGRESQL EFÍMERO y que esta migración hereda: revocar
     * sólo a PUBLIC/anon/authenticated y conceder a `service_role` NO quita nada, porque
     * `service_role` ya tenía `arwdDxtm` por el DEFAULT PRIVILEGES y `GRANT` sólo suma.
     * TRUNCATE seguiría ahí — en el rol con el que se autentica el servidor, que es
     * exactamente el que no debe poder vaciar el almacén de tombstones.
     */
    it(`revoca todo a service_role ANTES de volver a concederle su lista en ${name}`, () => {
      const revokeAt = sqlWithoutCommentLiteral.indexOf(
        `REVOKE ALL PRIVILEGES ON TABLE ${name} FROM service_role`,
      );
      const grantAt = sqlWithoutCommentLiteral.indexOf(
        `GRANT ${granted} ON TABLE ${name} TO service_role`,
      );
      assert.notEqual(revokeAt, -1, 'falta el REVOKE a service_role');
      assert.notEqual(grantAt, -1, 'falta el GRANT a service_role');
      assert.ok(
        revokeAt < grantAt,
        'el REVOKE a service_role debe preceder al GRANT, o el GRANT no quita nada',
      );
    });
  }

  it('no revoca a postgres, que es el dueño de las tablas y del trigger de la 099', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /REVOKE[^;]*FROM[^;]*\bpostgres\b/);
  });

  it('hay exactamente 4 REVOKE por tabla y ninguno de más', () => {
    const revokes = [...sqlWithoutCommentLiteral.matchAll(/REVOKE ALL PRIVILEGES ON TABLE/g)];
    assert.equal(revokes.length, TABLES.length * 4);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. GRANT: dos listas distintas, enumeradas, nunca ALL
// ═══════════════════════════════════════════════════════════════

describe('107 — GRANT mínimo y por tabla', () => {
  for (const { name, granted, withheld } of TABLES) {
    it(`concede exactamente «${granted}» en ${name}`, () => {
      assert.match(
        sqlWithoutCommentLiteral,
        new RegExp(`GRANT ${granted} ON TABLE ${escaped(name)} TO service_role`),
      );
    });

    for (const privilege of withheld) {
      it(`no concede ${privilege} en ${name}`, () => {
        const grantsForTable = [
          ...sqlWithoutCommentLiteral.matchAll(
            new RegExp(`GRANT\\s+([^;]*?)\\s+ON TABLE ${escaped(name)}\\b`, 'gi'),
          ),
        ].map((match) => match[1].toUpperCase());
        assert.notEqual(grantsForTable.length, 0, `no se encontró ningún GRANT para ${name}`);
        for (const list of grantsForTable) {
          assert.ok(
            !list.includes(privilege),
            `${name} recibe ${privilege}, que este hito le niega: «${list}»`,
          );
        }
      });
    }
  }

  /**
   * La asimetría entre las dos listas no es un descuido de redacción: es el contenido del
   * hito. Si alguien "normalizara" las dos tablas al sobre uniforme de la 106, esta
   * aserción es la que lo detiene.
   */
  it('las dos listas son DISTINTAS: la auditoría no recibe UPDATE y la caché sí', () => {
    const [cache, audit] = TABLES;
    assert.notEqual(cache.granted, audit.granted);
    assert.ok(cache.granted.includes('UPDATE'));
    assert.ok(!audit.granted.includes('UPDATE'));
  });

  it('ninguna de las dos recibe DELETE: la 106 sí lo concedía, la 107 no', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /GRANT[^;]*\bDELETE\b[^;]*ON TABLE/i);
  });

  it('no usa GRANT ALL en ninguna forma', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /GRANT\s+ALL\b/i);
  });

  it('hay UN solo GRANT de tabla por tabla, y ninguno de más', () => {
    const grants = [...sqlWithoutCommentLiteral.matchAll(/GRANT\s+[A-Z, ]+ON TABLE/gi)];
    assert.equal(grants.length, TABLES.length);
  });

  for (const privilege of FORBIDDEN_FOR_EVERYONE) {
    it(`no concede ${privilege} a nadie, en ninguna tabla`, () => {
      const granted = [...sqlWithoutCommentLiteral.matchAll(/GRANT\s+([^;]*?)\s+ON TABLE/gi)]
        .map((match) => match[1].toUpperCase())
        .filter((list) => list.includes(privilege));
      assert.deepEqual(granted, []);
    });
  }

  it('sólo `service_role` recibe algo', () => {
    const grantees = [...sqlWithoutCommentLiteral.matchAll(/ON TABLE\s+\S+\s+TO\s+([^';]+)/gi)].map(
      (match) => match[1].trim(),
    );
    assert.deepEqual(
      grantees,
      TABLES.map(() => 'service_role'),
    );
  });

  it('no concede EXECUTE ni toca el ACL de ninguna función', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /ON FUNCTION/i);
    assert.doesNotMatch(sqlWithoutCommentLiteral, /GRANT\s+EXECUTE/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. La RLS no se toca
// ═══════════════════════════════════════════════════════════════

describe('107 — RLS intacta', () => {
  it('no crea, borra ni altera ninguna política', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /\b(CREATE|DROP|ALTER)\s+POLICY\b/i);
  });

  it('no activa FORCE ROW LEVEL SECURITY', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('no desactiva la RLS', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('declara explícitamente por qué FORCE queda fuera de este bloque', () => {
    assert.match(migrationSql, /`FORCE ROW LEVEL SECURITY` is deliberately NOT/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Alcance: dos tablas, cero datos, cero forma
// ═══════════════════════════════════════════════════════════════

describe('107 — alcance mínimo', () => {
  /**
   * Las tablas del waterfall ya las endureció la 106; repetir ese trabajo aquí haría que
   * dos migraciones fueran dueñas del mismo estado final. Las vecinas tampoco se rozan.
   */
  const OUT_OF_SCOPE = [
    'phone_reveal_waterfall_runs',
    'phone_reveal_credit_reservations',
    'contact_enrichment_candidates',
    'provider_usage_logs',
    'budget_rules',
    'contacts',
    'accounts',
    'internal_users',
  ];

  for (const table of OUT_OF_SCOPE) {
    it(`no ejecuta nada contra ${table}`, () => {
      assert.doesNotMatch(sqlWithoutCommentLiteral, new RegExp(`\\b${table}\\b`));
    });
  }

  it('no toca el trigger `set_updated_at` de la 099', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /set_updated_at/i);
    assert.doesNotMatch(sqlWithoutCommentLiteral, /\b(CREATE|DROP|ALTER)\s+TRIGGER\b/i);
  });

  it('no escribe ni borra una sola fila', () => {
    assert.doesNotMatch(
      sqlWithoutCommentLiteral,
      /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i,
    );
  });

  it('no purga entradas expiradas ni caduca nada: la TTL es de la aplicación', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /expires_at/i);
  });

  it('no cambia la forma de nada: sin CREATE/DROP/ALTER TABLE, INDEX ni FUNCTION', () => {
    assert.doesNotMatch(
      sqlWithoutCommentLiteral,
      /\b(CREATE|DROP|ALTER)\s+(TABLE|INDEX|FUNCTION|CONSTRAINT|TYPE|VIEW)\b/i,
    );
  });

  it('no toca el DEFAULT PRIVILEGES del esquema: la causa raíz global queda documentada', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /ALTER\s+DEFAULT\s+PRIVILEGES/i);
    assert.match(migrationSql, /does NOT change the default privileges of schema `public`/);
  });

  it('no crea ni altera un rol', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /\b(CREATE|ALTER|DROP)\s+ROLE\b/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Guarda e idempotencia
// ═══════════════════════════════════════════════════════════════

describe('107 — reaplicable y segura sin las tablas', () => {
  it('cada tabla tiene su propio bloque DO guardado', () => {
    const blocks = [...sqlWithoutCommentLiteral.matchAll(/DO \$\$/g)];
    assert.equal(blocks.length, TABLES.length);
  });

  for (const { name } of TABLES) {
    it(`comprueba ${name} con to_regclass antes de tocar sus privilegios`, () => {
      const guardAt = sqlWithoutCommentLiteral.indexOf(`to_regclass('${name}')`);
      const firstRevokeAt = sqlWithoutCommentLiteral.indexOf(
        `REVOKE ALL PRIVILEGES ON TABLE ${name} FROM PUBLIC`,
      );
      assert.notEqual(guardAt, -1, `falta la guarda to_regclass de ${name}`);
      assert.notEqual(firstRevokeAt, -1, `falta el primer REVOKE de ${name}`);
      assert.ok(guardAt < firstRevokeAt, 'la guarda debe preceder al primer REVOKE de su tabla');
    });
  }

  it('hay una guarda to_regclass por tabla: una compartida se saltaría las dos', () => {
    const guards = [...sqlWithoutCommentLiteral.matchAll(/to_regclass\(/g)];
    assert.equal(guards.length, TABLES.length);
  });

  it('los COMMENT van DENTRO de los bloques guardados, no sueltos al final', () => {
    assert.doesNotMatch(
      sqlWithoutCommentLiteral,
      /^\s*COMMENT ON TABLE/m,
      'ningún COMMENT puede estar en el nivel superior del archivo',
    );
    const wrapped = [...sqlWithoutCommentLiteral.matchAll(/EXECUTE format\(\s*'COMMENT ON TABLE/g)];
    assert.equal(wrapped.length, TABLES.length);
  });

  it('no usa CREATE OR REPLACE ni IF NOT EXISTS: REVOKE/GRANT ya son declarativos', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /CREATE OR REPLACE/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Privacidad y secretos
// ═══════════════════════════════════════════════════════════════

describe('107 — PII-free y sin secretos', () => {
  /**
   * Sobre el SQL EJECUTABLE, no sobre el archivo completo: la cabecera declara en prosa que
   * la caché guarda `normalized_phone`, y eso es documentación del riesgo que la migración
   * cierra, no una violación. Lo que no puede aparecer es una columna de PII en algo que se
   * ejecuta — y no tiene por qué: el endurecimiento es de TABLA.
   */
  it('el SQL ejecutable no nombra ninguna columna de datos personales', () => {
    for (const forbidden of [
      'normalized_phone',
      'phone_number',
      'phone_type',
      'email',
      'linkedin',
      'first_name',
      'last_name',
      'full_name',
      'provider_person_id',
    ]) {
      assert.doesNotMatch(
        sqlWithoutCommentLiteral,
        new RegExp(forbidden, 'i'),
        `el SQL ejecutable menciona ${forbidden}`,
      );
    }
  });

  it('no contiene un teléfono, un UUID literal ni una clave', () => {
    assert.doesNotMatch(migrationSql, /\+\d{7,}/);
    assert.doesNotMatch(
      migrationSql,
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    assert.doesNotMatch(migrationSql, /\b(api[_-]?key|secret|bearer|password)\s*[:=]/i);
  });

  it('no menciona a un usuario concreto: el hardening es estructural, no por persona', () => {
    assert.doesNotMatch(migrationSql, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
