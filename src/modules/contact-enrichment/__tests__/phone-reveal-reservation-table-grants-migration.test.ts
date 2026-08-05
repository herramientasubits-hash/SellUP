/**
 * Seguridad estática de supabase/migrations/105_phone_reveal_reservation_table_grants.sql
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4H).
 *
 * QUÉ CIERRA LA MIGRACIÓN QUE ESTE ARCHIVO PROTEGE
 *
 * La 104 activó RLS en `phone_reveal_credit_reservations` y le dejó UNA política, de
 * `service_role`. Ese es el control que todo el mundo audita, y sí sostiene peso. Lo que
 * NO es es la única capa: la RLS decide QUÉ FILAS puede tocar un rol, y el GRANT de tabla
 * decide si el rol puede tocar la tabla EN ABSOLUTO. La 104 sólo cerró una de las dos.
 *
 * Supabase aplica `ALTER DEFAULT PRIVILEGES … IN SCHEMA public GRANT ALL ON TABLES TO
 * anon, authenticated, service_role`, así que la tabla NACIÓ con el juego completo
 * (`arwdDxtm`) para los dos roles alcanzables desde el navegador — verificado en
 * Producción antes de escribir la migración. Consecuencias concretas:
 *
 *   * cualquier `CREATE POLICY … TO authenticated` futuro se convierte en camino de
 *     escritura al instante, porque el grant nunca fue la restricción;
 *   * `TRUNCATE` NO lo filtra la RLS: es una operación de tabla. En esta tabla vaciarla
 *     no es una pérdida de datos cualquiera — cada fila `reserved` es exposición ocupando
 *     disponibilidad del proveedor, así que borrarlas devuelve TODO el presupuesto en
 *     vuelo de golpe y reabre el doble gasto que la 104 existe para cerrar;
 *   * `TRIGGER` permite colgar código que corre con el alcance del dueño de la tabla.
 *
 * Lo que se verifica aquí:
 *   * numeración única del archivo;
 *   * REVOKE explícito a PUBLIC, anon y authenticated — y TAMBIÉN a `service_role`, que
 *     es el hallazgo que una corrida en PostgreSQL efímero destapó: el GRANT sólo SUMA,
 *     así que sin ese REVOKE el `arwdDxtm` heredado dejaba TRUNCATE/REFERENCES/TRIGGER
 *     intactos justo en el rol con el que se autentica el servidor;
 *   * el GRANT enumera SELECT/INSERT/UPDATE/DELETE y NUNCA usa `ALL`;
 *   * TRUNCATE, REFERENCES y TRIGGER no se conceden a nadie;
 *   * no se toca la RLS: ni CREATE/DROP/ALTER POLICY, ni `FORCE ROW LEVEL SECURITY`;
 *   * no se toca ninguna tabla adyacente ni el DEFAULT PRIVILEGES del esquema;
 *   * cero escrituras de datos y cero DDL de forma (sin CREATE/DROP/ALTER TABLE);
 *   * el COMMENT va DENTRO de la guarda `to_regclass`, porque suelto levantaría 42P01 en
 *     una base sin la 104 y anularía la guarda;
 *   * PII-free y sin secretos.
 *
 * Sólo lee archivos de disco: no conecta a ninguna base, no llama a ningún proveedor y no
 * gasta un solo crédito.
 *
 * La validación de COMPORTAMIENTO (matriz de privilegios real, intentos por rol,
 * funciones SECURITY DEFINER, reaplicación) corre contra un PostgreSQL efímero y está
 * documentada en el PR: 65/65. No se puede hacer aquí porque este archivo no abre
 * conexiones.
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

const MIGRATION_FILE = '105_phone_reveal_reservation_table_grants.sql';
const migrationSql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');

const TABLE = 'public.phone_reveal_credit_reservations';

/** SQL ejecutable: el archivo sin las líneas de comentario `--`. */
const executableSql = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/**
 * El texto del COMMENT es prosa: menciona TRUNCATE, anon y demás por su nombre. Buscar
 * palabras clave sobre el SQL completo daría falsos positivos y falsos negativos, así que
 * las aserciones de privilegios se hacen sobre el SQL SIN ese literal.
 */
const sqlWithoutCommentLiteral = executableSql.replace(
  /\$comment\$[\s\S]*?\$comment\$/g,
  "'<comment>'",
);

// ═══════════════════════════════════════════════════════════════
// 1. Numeración
// ═══════════════════════════════════════════════════════════════

describe('105 — numeración única', () => {
  it('ningún otro archivo de migración empieza por 105', () => {
    const conflicting = readdirSync(migrationsDir).filter(
      (file) => file.startsWith('105') && file !== MIGRATION_FILE,
    );
    assert.deepEqual(conflicting, []);
  });

  it('declara que debe aplicarse DESPUÉS de la 104', () => {
    assert.match(migrationSql, /Must be applied AFTER 104/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. REVOKE: los cuatro sujetos, ninguno olvidado
// ═══════════════════════════════════════════════════════════════

describe('105 — REVOKE ALL PRIVILEGES', () => {
  for (const grantee of ['PUBLIC', 'anon', 'authenticated']) {
    it(`revoca todo a ${grantee}`, () => {
      assert.match(
        sqlWithoutCommentLiteral,
        new RegExp(
          `REVOKE ALL PRIVILEGES ON TABLE ${TABLE.replace('.', '\\.')} FROM ${grantee}\\b`,
        ),
      );
    });
  }

  /**
   * EL HALLAZGO DE 4H. La primera versión de esta migración revocaba sólo a
   * PUBLIC/anon/authenticated y concedía los cuatro privilegios a `service_role`. Un
   * PostgreSQL efímero demostró que eso NO quitaba nada: `service_role` ya tenía
   * `arwdDxtm` por el DEFAULT PRIVILEGES de Supabase, y `GRANT` sólo suma. TRUNCATE
   * seguía ahí — en el rol con el que se autentica el servidor, que es exactamente el
   * que no debe poder vaciar la tabla de exposición en vuelo.
   */
  it('revoca todo a service_role ANTES de volver a concederle la lista corta', () => {
    const revokeAt = sqlWithoutCommentLiteral.indexOf(
      `REVOKE ALL PRIVILEGES ON TABLE ${TABLE} FROM service_role`,
    );
    const grantAt = sqlWithoutCommentLiteral.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE');
    assert.notEqual(revokeAt, -1, 'falta el REVOKE a service_role');
    assert.notEqual(grantAt, -1, 'falta el GRANT a service_role');
    assert.ok(
      revokeAt < grantAt,
      'el REVOKE a service_role debe preceder al GRANT, o el GRANT no quita nada',
    );
  });

  it('no revoca a postgres, que es el dueño y parte del contrato de la 104', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /REVOKE[^;]*FROM[^;]*\bpostgres\b/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. GRANT: enumerado, nunca ALL
// ═══════════════════════════════════════════════════════════════

describe('105 — GRANT mínimo a service_role', () => {
  it('concede exactamente SELECT, INSERT, UPDATE, DELETE', () => {
    assert.match(
      sqlWithoutCommentLiteral,
      new RegExp(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${TABLE.replace('.', '\\.')} TO service_role`,
      ),
    );
  });

  it('no usa GRANT ALL en ninguna forma', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /GRANT\s+ALL\b/i);
  });

  it('hay UN solo GRANT de tabla en todo el archivo', () => {
    const grants = [...sqlWithoutCommentLiteral.matchAll(/GRANT\s+[A-Z, ]+ON TABLE/gi)];
    assert.equal(grants.length, 1);
  });

  for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
    it(`no concede ${privilege} a nadie`, () => {
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
    assert.deepEqual(grantees, ['service_role']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. La RLS no se toca
// ═══════════════════════════════════════════════════════════════

describe('105 — RLS intacta', () => {
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
    assert.match(migrationSql, /FORCE ROW LEVEL SECURITY` is deliberately NOT enabled/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Alcance: una sola tabla, cero datos, cero forma
// ═══════════════════════════════════════════════════════════════

describe('105 — alcance mínimo', () => {
  const ADJACENT = [
    'phone_reveal_waterfall_runs',
    'phone_reveal_cache',
    'phone_reveal_suppression_audit',
    'budget_rules',
    'provider_usage_logs',
    'contact_enrichment_candidates',
  ];

  for (const table of ADJACENT) {
    it(`no ejecuta nada contra ${table}`, () => {
      assert.doesNotMatch(sqlWithoutCommentLiteral, new RegExp(`\\b${table}\\b`));
    });
  }

  it('no escribe ni borra una sola fila', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/i);
  });

  it('no cambia la forma de nada: sin CREATE/DROP/ALTER TABLE, INDEX ni FUNCTION', () => {
    assert.doesNotMatch(
      sqlWithoutCommentLiteral,
      /\b(CREATE|DROP|ALTER)\s+(TABLE|INDEX|FUNCTION|CONSTRAINT|TYPE|VIEW)\b/i,
    );
  });

  it('no toca el DEFAULT PRIVILEGES del esquema', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /ALTER\s+DEFAULT\s+PRIVILEGES/i);
  });

  it('no crea ni altera un rol', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /\b(CREATE|ALTER|DROP)\s+ROLE\b/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Guarda e idempotencia
// ═══════════════════════════════════════════════════════════════

describe('105 — reaplicable y segura sin la 104', () => {
  it('comprueba la existencia de la tabla con to_regclass antes de tocar privilegios', () => {
    const guardAt = sqlWithoutCommentLiteral.indexOf('to_regclass');
    const firstRevokeAt = sqlWithoutCommentLiteral.indexOf('REVOKE');
    assert.notEqual(guardAt, -1, 'falta la guarda to_regclass');
    assert.ok(guardAt < firstRevokeAt, 'la guarda debe preceder al primer REVOKE');
  });

  /**
   * Un `COMMENT ON TABLE` suelto al final del archivo levantaría 42P01 en una base sin la
   * 104 y rompería la cadena justo donde la guarda pretendía protegerla. Lo destapó la
   * corrida en PostgreSQL efímero, no la lectura.
   */
  it('el COMMENT va DENTRO del bloque guardado, no suelto al final', () => {
    assert.doesNotMatch(
      sqlWithoutCommentLiteral,
      /^\s*COMMENT ON TABLE/m,
      'el COMMENT no puede estar en el nivel superior del archivo',
    );
    assert.match(sqlWithoutCommentLiteral, /EXECUTE format\(\s*'COMMENT ON TABLE/);
  });

  it('todo el trabajo vive en UN bloque DO guardado', () => {
    const blocks = [...sqlWithoutCommentLiteral.matchAll(/DO \$\$/g)];
    assert.equal(blocks.length, 1);
  });

  it('no usa CREATE OR REPLACE ni IF NOT EXISTS: REVOKE/GRANT ya son declarativos', () => {
    assert.doesNotMatch(sqlWithoutCommentLiteral, /CREATE OR REPLACE/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Privacidad y secretos
// ═══════════════════════════════════════════════════════════════

describe('105 — PII-free y sin secretos', () => {
  /**
   * Sobre el SQL EJECUTABLE, no sobre el archivo completo: la cabecera declara en prosa
   * «no phone, email, name, LinkedIn URL», y esa frase es documentación del contrato, no
   * una violación. Lo que no puede aparecer es una columna de PII en algo que se ejecuta.
   */
  it('el SQL ejecutable no nombra ninguna columna de datos personales', () => {
    for (const forbidden of [
      'phone_number',
      'normalized_phone',
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
    assert.doesNotMatch(migrationSql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    assert.doesNotMatch(migrationSql, /\b(api[_-]?key|secret|bearer|password)\s*[:=]/i);
  });

  it('no menciona a un usuario concreto: el hardening es estructural, no por persona', () => {
    assert.doesNotMatch(migrationSql, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
