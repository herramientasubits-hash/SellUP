/**
 * REGRESIÓN DE TODO EL SUBSISTEMA TELEFÓNICO: ninguna tabla `public.phone_reveal_*` puede
 * conservar privilegios para `anon`, `authenticated` o `PUBLIC`
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4J).
 *
 * POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ NO ES UNA COPIA DE LOS OTROS DOS
 *
 * Las suites hermanas verifican UNA migración cada una: la 106 (`phone-reveal-reservation-
 * table-grants-migration.test.ts`) y la 107 (`phone-reveal-cache-table-grants-migration.
 * test.ts`). Las dos son necesarias y las dos comparten un punto ciego: sólo miran los
 * archivos que ya sabían que existían.
 *
 * La causa raíz de este agujero NO se arregla en ninguno de los dos hitos. Sigue viva:
 *
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
 *     TO anon, authenticated, service_role;
 *
 * Es una decisión de plataforma con radio de impacto en todo el repositorio, y cambiarla es
 * su propio bloque de trabajo (queda documentada como deuda en la cabecera de la 107). Su
 * consecuencia, mientras siga ahí, es exacta y mecánica: **toda tabla nueva de `public` nace
 * con los 8 privilegios para los dos roles alcanzables desde el navegador**. Una futura
 * `phone_reveal_dnc_list`, `phone_reveal_provider_quota` o lo que venga heredaría el agujero
 * completo, y lo heredaría en silencio — porque «RLS activada + una política de service_role»
 * se lee como cerrado, y `TRUNCATE` ignora la RLS por completo.
 *
 * Este archivo es la red que atrapa eso. No verifica una migración: verifica una INVARIANTE
 * del subsistema, sobre el conjunto de tablas `phone_reveal_%` DESCUBIERTO en el disco. Una
 * tabla nueva no tiene que acordarse de añadirse a una lista — aparece sola en cuanto su
 * `CREATE TABLE` entra al repositorio, y si nadie la endureció, esta suite falla.
 *
 * QUÉ COMPRUEBA, para CADA tabla `public.phone_reveal_%` creada por CUALQUIER migración
 *
 *   1. que alguna migración le revoca TODOS los privilegios a PUBLIC, a `anon` y a
 *      `authenticated`;
 *   2. que alguna migración le revoca TODOS los privilegios a `service_role` ANTES de
 *      concederle su lista corta (sin ese REVOKE el GRANT no quita nada: sólo SUMA);
 *   3. que su GRANT existe, enumera privilegios uno a uno y NUNCA usa `ALL`;
 *   4. que nadie recibe TRUNCATE, REFERENCES, TRIGGER ni MAINTAIN;
 *   5. que sólo `service_role` recibe algo — ninguna tabla del subsistema concede nada a un
 *      rol del navegador;
 *   6. que ninguna migración crea una política para `anon` o `authenticated` sobre ellas.
 *
 * Y como red de la red: comprueba que el descubrimiento encontró AL MENOS las cuatro tablas
 * conocidas del subsistema, para que la suite no pueda pasar vacía si el patrón de búsqueda
 * se rompe.
 *
 * Sólo lee archivos de disco. La comprobación equivalente contra los ACL REALES de un
 * PostgreSQL efímero (recorriendo `pg_class` en vez del disco) vive en
 * `phone-reveal-cache-grants-postgres.test.ts` § 9. Las dos hacen falta: el disco cubre
 * siempre y sin binarios; el catálogo cubre lo que el SQL de verdad produjo.
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

/** Los cuatro privilegios que ninguna tabla del subsistema concede a nadie. */
const FORBIDDEN_FOR_EVERYONE = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;

/** Los roles alcanzables desde el navegador, más el pseudo-rol que alcanza a todos. */
const BROWSER_REACHABLE = ['PUBLIC', 'anon', 'authenticated'] as const;

/**
 * Las cuatro que existen hoy. NO es la lista contra la que se verifica — la verificación es
 * sobre lo DESCUBIERTO — sino el suelo mínimo que el descubrimiento tiene que alcanzar, para
 * que un patrón roto se note en vez de convertir la suite en un no-op silencioso.
 */
const KNOWN_TABLES = [
  'phone_reveal_waterfall_runs',
  'phone_reveal_credit_reservations',
  'phone_reveal_cache',
  'phone_reveal_suppression_audit',
] as const;

// ═══════════════════════════════════════════════════════════════
// Descubrimiento sobre el disco
// ═══════════════════════════════════════════════════════════════

type Migration = { file: string; sql: string; executable: string };

const migrations: Migration[] = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    /**
     * Sin las líneas de comentario `--` y sin los literales `$comment$…$comment$`: las
     * cabeceras de la 106 y la 107 nombran en prosa `TRUNCATE`, `anon` y las tablas que
     * DEJAN fuera, y contarlas como SQL daría falsos positivos en las dos direcciones.
     */
    const executable = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .replace(/\$comment\$[\s\S]*?\$comment\$/g, "'<comment>'");
    return { file, sql, executable };
  });

const allExecutableSql = migrations.map((m) => m.executable).join('\n');

/**
 * Tablas `phone_reveal_*` creadas por alguna migración. Se descubren por su `CREATE TABLE`,
 * que es el momento exacto en el que una tabla hereda el DEFAULT PRIVILEGES del esquema.
 */
const discoveredTables = [
  ...new Set(
    [
      ...allExecutableSql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(phone_reveal_\w+)/gi,
      ),
    ].map((match) => match[1].toLowerCase()),
  ),
].sort();

/** Todos los GRANT `… ON TABLE public.<tabla> TO <rol>` del repositorio, por tabla. */
const grantsFor = (table: string) =>
  [
    ...allExecutableSql.matchAll(
      new RegExp(`GRANT\\s+([^;]*?)\\s+ON TABLE\\s+public\\.${table}\\s+TO\\s+([^';]+)`, 'gi'),
    ),
  ].map((match) => ({
    privileges: match[1].toUpperCase().trim(),
    grantee: match[2].trim(),
  }));

// ═══════════════════════════════════════════════════════════════
// 0. El descubrimiento funciona
// ═══════════════════════════════════════════════════════════════

describe('subsistema phone_reveal_* — el descubrimiento no pasa vacío', () => {
  it('encuentra al menos las cuatro tablas conocidas del subsistema', () => {
    for (const table of KNOWN_TABLES) {
      assert.ok(
        discoveredTables.includes(table),
        `el descubrimiento no encontró ${table}; el patrón de CREATE TABLE está roto y esta suite estaría pasando vacía. Encontradas: ${discoveredTables.join(', ') || '<ninguna>'}`,
      );
    }
  });

  /**
   * Deliberadamente NO se afirma que el conjunto descubierto sea EXACTAMENTE `KNOWN_TABLES`.
   * Una tabla `phone_reveal_*` nueva y correctamente endurecida debe poder entrar SIN editar
   * este archivo: si la obligara, sería el mismo antipatrón que este repositorio ya retiró de
   * la prueba de la 105 en `92d49dd` — una aserción que no sostiene ningún invariante y
   * convierte cada hito futuro en una edición forzada. El trabajo real lo hace la § 1, que
   * recorre lo descubierto: una tabla nueva SIN endurecer falla ahí, con el nombre del
   * privilegio que heredó. `KNOWN_TABLES` es sólo el suelo mínimo, para que un patrón de
   * búsqueda roto se note en vez de vaciar la suite.
   */
  it('cubre al menos tantas tablas como las conocidas', () => {
    assert.ok(
      discoveredTables.length >= KNOWN_TABLES.length,
      `descubiertas ${discoveredTables.length}, esperadas al menos ${KNOWN_TABLES.length}`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 1. La invariante, tabla por tabla
// ═══════════════════════════════════════════════════════════════

describe('subsistema phone_reveal_* — ACL sin roles de navegador', () => {
  for (const table of discoveredTables) {
    describe(`public.${table}`, () => {
      for (const grantee of BROWSER_REACHABLE) {
        it(`alguna migración le revoca TODOS los privilegios a ${grantee}`, () => {
          assert.match(
            allExecutableSql,
            new RegExp(
              `REVOKE ALL PRIVILEGES ON TABLE public\\.${table} FROM ${grantee}\\b`,
            ),
            `public.${table} nunca revoca a ${grantee}: nació con los 8 privilegios por el DEFAULT PRIVILEGES de Supabase y los conserva`,
          );
        });

        it(`ninguna migración le concede nada a ${grantee}`, () => {
          const toGrantee = grantsFor(table).filter((grant) => grant.grantee === grantee);
          assert.deepEqual(
            toGrantee,
            [],
            `public.${table} concede privilegios a ${grantee}`,
          );
        });
      }

      /**
       * El REVOKE a `service_role` no es simetría decorativa: sin él, el `arwdDxtm` heredado
       * sobrevive intacto, porque `GRANT` sólo SUMA. Es el defecto que 4H destapó en un
       * PostgreSQL efímero y que ninguna lectura del texto habría encontrado.
       */
      it('le revoca todo a service_role ANTES de concederle su lista corta', () => {
        const revokeAt = allExecutableSql.indexOf(
          `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM service_role`,
        );
        assert.notEqual(
          revokeAt,
          -1,
          `public.${table} no revoca a service_role: el GRANT posterior no le quitaría TRUNCATE`,
        );
        const grantAt = allExecutableSql.search(
          new RegExp(`GRANT\\s+[^;]*?\\s+ON TABLE\\s+public\\.${table}\\s+TO\\s+service_role`),
        );
        assert.notEqual(grantAt, -1, `public.${table} no tiene GRANT para service_role`);
        assert.ok(revokeAt < grantAt, 'el REVOKE debe preceder al GRANT');
      });

      it('tiene un GRANT enumerado para service_role y nunca usa ALL', () => {
        const grants = grantsFor(table);
        assert.notEqual(grants.length, 0, `public.${table} no tiene ningún GRANT`);
        for (const { privileges, grantee } of grants) {
          assert.equal(grantee, 'service_role');
          assert.ok(
            !/\bALL\b/.test(privileges),
            `public.${table} usa GRANT ALL: re-concedería TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`,
          );
        }
      });

      for (const privilege of FORBIDDEN_FOR_EVERYONE) {
        it(`no concede ${privilege} a nadie`, () => {
          const offenders = grantsFor(table).filter((grant) =>
            grant.privileges.includes(privilege),
          );
          assert.deepEqual(
            offenders,
            [],
            `public.${table} concede ${privilege}${privilege === 'TRUNCATE' ? ' — y TRUNCATE ignora la RLS por completo' : ''}`,
          );
        });
      }

      it('ninguna migración crea una política para anon ni authenticated', () => {
        for (const { file, executable } of migrations) {
          const policies = [
            ...executable.matchAll(
              /CREATE\s+POLICY[\s\S]{0,400}?ON\s+public\.(\w+)[\s\S]{0,200}?TO\s+([a-z_]+)/gi,
            ),
          ];
          for (const [, policyTable, role] of policies) {
            if (policyTable.toLowerCase() !== table) continue;
            assert.ok(
              !['anon', 'authenticated', 'public'].includes(role.toLowerCase()),
              `${file} crea una política TO ${role} sobre public.${table}`,
            );
          }
        }
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. La causa raíz sigue siendo deuda declarada, no un cambio silencioso
// ═══════════════════════════════════════════════════════════════

describe('subsistema phone_reveal_* — la causa raíz global no se toca aquí', () => {
  it('ninguna migración del repositorio altera el DEFAULT PRIVILEGES del esquema', () => {
    for (const { file, executable } of migrations) {
      assert.doesNotMatch(
        executable,
        /ALTER\s+DEFAULT\s+PRIVILEGES/i,
        `${file} cambia el DEFAULT PRIVILEGES: es una decisión de plataforma con radio de impacto en todo el repositorio y necesita su propio bloque de trabajo`,
      );
    }
  });
});
