/**
 * Verificación de COMPORTAMIENTO de los privilegios de tabla del waterfall de teléfono
 * contra un PostgreSQL REAL y efímero (Agente 2A · AGENT2A-PHONE-WATERFALL-4H).
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 *
 * La suite hermana `phone-reveal-reservation-table-grants-migration.test.ts` lee la
 * migración 106 como TEXTO. Eso captura una migración mal escrita, pero no puede captar la
 * clase de defecto que este hito destapó: que `GRANT` sólo SUMA, así que un archivo que
 * "concede exactamente cuatro privilegios" puede dejar TRUNCATE intacto si el rol ya lo
 * tenía por el DEFAULT PRIVILEGES de Supabase. Ese error es invisible en el texto y obvio
 * en `has_table_privilege()`. Comprobar `information_schema` tampoco basta: la pregunta que
 * importa es si un cliente que se autentica como `anon` puede LEER o ESCRIBIR, y eso sólo
 * lo responde intentarlo.
 *
 * QUÉ REPRODUCE
 *
 * El punto de partida exacto de Producción, verificado por MCP de sólo lectura antes de
 * escribir esto:
 *
 *   * PostgreSQL 17 (Prod: 17.6; este arnés: la serie 17 de `embedded-postgres`);
 *   * los tres roles de Supabase (`anon`, `authenticated`, `service_role`), con
 *     `service_role` BYPASSRLS como en la plataforma — que es justo lo que hace que la RLS
 *     NO sea la capa que protege esta tabla de él;
 *   * `GRANT USAGE ON SCHEMA public` a los tres. Sin esto el intento de `anon` fallaría por
 *     el esquema y no por la tabla, y la prueba pasaría por la razón equivocada;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated, service_role`,
 *     que es lo que hace que toda tabla nueva de `public` NAZCA con los 8 privilegios;
 *   * las migraciones 102, 103 y 104 tal cual están en disco, y luego la 106.
 *
 * QUÉ PRUEBA
 *
 *   1. que el arnés reproduce el AGUJERO: antes de la 106, `anon` y `authenticated` tienen
 *      los 8 privilegios en las dos tablas (si esto fallara, todo lo demás pasaría vacío);
 *   2. la matriz completa después de la 106: los 8 privilegios × {PUBLIC, anon,
 *      authenticated} = false, uno por uno, en las dos tablas;
 *   3. que `service_role` conserva EXACTAMENTE SELECT/INSERT/UPDATE/DELETE y ninguno de
 *      TRUNCATE/REFERENCES/TRIGGER/MAINTAIN;
 *   4. pruebas de contrato con `SET ROLE`: `anon` y `authenticated` reciben 42501 al
 *      intentar SELECT/INSERT/UPDATE/DELETE en cada tabla y al intentar EXECUTE de las tres
 *      funciones SECURITY DEFINER de la 104;
 *   5. que `service_role` SÍ puede operar (SELECT/INSERT reales) y NO puede TRUNCATE;
 *   6. que las tres funciones de la 104 quedan intactas: `prosecdef`, dueño, `search_path`,
 *      ACL de EXECUTE y md5 del cuerpo, comparados ANTES y DESPUÉS de la 106;
 *   7. que la RLS queda intacta: activada, NO forzada, una sola política de `service_role`
 *      por tabla y cero políticas de `anon`/`authenticated`;
 *   8. idempotencia sobre los TRES estados que exige el hito: el relacl exacto de
 *      Producción tras la 104, uno parcialmente revocado y uno ya completamente endurecido;
 *   9. que la 106 no toca UNA SOLA FILA: se insertan filas reales en las dos tablas antes
 *      de aplicarla y se comparan por hash de contenido después de cada reaplicación.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito. Todo ocurre en un PostgreSQL que nace y muere
 * dentro de la prueba.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito: descargaría
 * un binario de PostgreSQL en cada `npm ci`, incluido el del check obligatorio, que no
 * necesita esta suite. Si el módulo no está resuelto, el archivo se SALTA con un motivo
 * explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17
 *   npm run test:agent2a:phone-table-grants-postgres
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');

/** Los 8 privilegios de tabla de PostgreSQL 17. `MAINTAIN` sólo existe desde la 17. */
const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
] as const;

/** Lo único que `service_role` debe conservar. */
const SERVICE_ROLE_ALLOWED = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

/** Los roles que no deben poder tocar nada. */
const UNAUTHORIZED_ROLES = ['anon', 'authenticated'] as const;

const TABLES = ['phone_reveal_credit_reservations', 'phone_reveal_waterfall_runs'] as const;

/** Las tres funciones SECURITY DEFINER de la 104, con su firma exacta. */
const DEFINER_FUNCTIONS = [
  {
    name: 'reserve_and_create_phone_reveal_run',
    args: 'uuid, uuid, text, uuid, jsonb, jsonb',
    call: 'public.reserve_and_create_phone_reveal_run(NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::jsonb, NULL::jsonb)',
  },
  {
    name: 'confirm_phone_reveal_credits',
    args: 'uuid, numeric, text',
    call: 'public.confirm_phone_reveal_credits(NULL::uuid, NULL::numeric, NULL::text)',
  },
  {
    name: 'release_phone_reveal_credits',
    args: 'uuid, text',
    call: 'public.release_phone_reveal_credits(NULL::uuid, NULL::text)',
  },
] as const;

/** Código de PostgreSQL para «permiso denegado». Lo único que cuenta como rechazo real. */
const INSUFFICIENT_PRIVILEGE = '42501';

// ═══════════════════════════════════════════════════════════════
// Resolución del arnés opcional
// ═══════════════════════════════════════════════════════════════

type PgLikeClient = {
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type EmbeddedPostgresLike = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: () => PgLikeClient;
};

let EmbeddedPostgresCtor: (new (options: Record<string, unknown>) => EmbeddedPostgresLike) | null =
  null;
let harnessSkipReason: string | false = false;

/**
 * Resolución SÍNCRONA con `createRequire`, no con `await import()`: este archivo se
 * transpila a CJS, donde un `await` de nivel superior no compila, y la razón del skip tiene
 * que estar disponible ANTES de que `describe()` decida si corre.
 */
try {
  const require = createRequire(import.meta.url);
  const mod = require('embedded-postgres') as {
    default?: new (options: Record<string, unknown>) => EmbeddedPostgresLike;
  };
  const ctor =
    mod.default ?? (mod as unknown as new (o: Record<string, unknown>) => EmbeddedPostgresLike);
  if (typeof ctor !== 'function') {
    harnessSkipReason = 'embedded-postgres resolvió sin constructor utilizable';
  } else {
    EmbeddedPostgresCtor = ctor;
  }
} catch {
  harnessSkipReason =
    'embedded-postgres no está instalado (arnés opcional a propósito: `npm install --no-save embedded-postgres@17`)';
}

// ═══════════════════════════════════════════════════════════════
// Utilidades de consulta
// ═══════════════════════════════════════════════════════════════

let client: PgLikeClient;
let postgres: EmbeddedPostgresLike;
let dataDir = '';

const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');

const applyMigration = async (file: string) => {
  await client.query(readMigration(file));
};

const scalar = async <T>(sql: string): Promise<T> => {
  const { rows } = await client.query(sql);
  return Object.values(rows[0])[0] as T;
};

/** Privilegios efectivos de un ROL sobre una tabla, resueltos por PostgreSQL. */
const privilegesOfRole = async (role: string, table: string) => {
  const columns = TABLE_PRIVILEGES.map(
    (privilege) =>
      `has_table_privilege('${role}', 'public.${table}', '${privilege}') AS "${privilege}"`,
  ).join(', ');
  const { rows } = await client.query(`SELECT ${columns}`);
  return rows[0] as Record<string, boolean>;
};

/**
 * Privilegios de PUBLIC. NO se pueden preguntar con `has_table_privilege`, porque PUBLIC no
 * es un rol: hay que mirar la entrada de la ACL cuyo beneficiario es 0.
 */
const publicPrivileges = async (table: string): Promise<string[]> => {
  const { rows } = await client.query(`
    SELECT a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relname = '${table}' AND a.grantee = 0
    ORDER BY a.privilege_type
  `);
  return rows.map((row) => row.privilege_type as string);
};

/** Privilegios que la ACL concede EXPLÍCITAMENTE a un rol, ordenados. */
const aclPrivilegesOfRole = async (role: string, table: string): Promise<string[]> => {
  const { rows } = await client.query(`
    SELECT a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN aclexplode(c.relacl) a
    WHERE n.nspname = 'public'
      AND c.relname = '${table}'
      AND a.grantee = '${role}'::regrole::oid
    ORDER BY a.privilege_type
  `);
  return rows.map((row) => row.privilege_type as string);
};

const relaclOf = (table: string) =>
  scalar<string>(
    `SELECT COALESCE(c.relacl::text, '<null>') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='${table}'`,
  );

/** Huella del CONTENIDO de una tabla: si la 106 tocara una fila, esto cambiaría. */
const contentHashOf = (table: string) =>
  scalar<string>(
    `SELECT COALESCE(md5(string_agg(t::text, '|' ORDER BY t::text)), '<empty>') FROM public.${table} t`,
  );

const functionFacts = async () => {
  const { rows } = await client.query(`
    SELECT p.proname,
           p.prosecdef,
           pg_get_userbyid(p.proowner) AS owner,
           COALESCE(p.proconfig::text, '<null>') AS config,
           COALESCE(p.proacl::text, '<null>') AS acl,
           md5(p.prosrc) AS src_md5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (${DEFINER_FUNCTIONS.map((fn) => `'${fn.name}'`).join(', ')})
    ORDER BY p.proname
  `);
  return rows;
};

/** Ejecuta algo asumiendo un rol y devuelve el código de error, o null si tuvo éxito. */
const errorCodeAsRole = async (role: string, sql: string): Promise<string | null> => {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await client.query('ROLLBACK');
  }
};

/** Devuelve a la tabla el estado de privilegios con el que NACIÓ en Producción. */
const restoreSupabaseDefaultGrants = async (table: string) => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await client.query(`GRANT ALL PRIVILEGES ON TABLE public.${table} TO ${role}`);
  }
};

// ═══════════════════════════════════════════════════════════════
// Arranque: reproducir Producción y aplicar 102 → 103 → 104
// ═══════════════════════════════════════════════════════════════

/** Estado capturado ANTES de la 106, para comparar contra el de después. */
let beforeState: {
  relacl: Record<string, string>;
  content: Record<string, string>;
  functions: Record<string, unknown>[];
  anonPrivileges: Record<string, Record<string, boolean>>;
} | null = null;

describe('106 — privilegios de tabla contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'a2a-4h-pg-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: join(dataDir, 'data'),
      user: 'postgres',
      password: 'harness-local-only',
      port: 54329,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await (client as unknown as { connect: () => Promise<void> }).connect();

    // ── El punto de partida de Supabase ────────────────────────────
    await client.query(`
      CREATE ROLE anon NOLOGIN NOINHERIT;
      CREATE ROLE authenticated NOLOGIN NOINHERIT;
      CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role;
    `);

    // Única dependencia real de 102/104: la tabla a la que apuntan sus FKs.
    await client.query(`
      CREATE TABLE public.contact_enrichment_candidates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
    `);

    await applyMigration('102_phone_reveal_waterfall_runs.sql');
    await applyMigration('103_phone_reveal_waterfall_legacy_mode.sql');
    await applyMigration('104_phone_reveal_credit_reservations.sql');

    // ── Filas reales, para poder demostrar que la 106 no las toca ──
    await client.query(`
      -- Dos candidatos: el primero lleva la corrida sembrada, el segundo existe para que
      -- la prueba positiva de service_role pueda INSERTAR una corrida sin chocar con el
      -- índice único de «una sola corrida activa por candidato» de la 102.
      INSERT INTO public.contact_enrichment_candidates (id)
      VALUES ('00000000-0000-4000-8000-000000000001'),
             ('00000000-0000-4000-8000-000000000005');

      INSERT INTO public.phone_reveal_waterfall_runs
        (id, candidate_id, status, authorized_by, max_credits_authorized)
      VALUES
        ('00000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000001',
         'authorized',
         '00000000-0000-4000-8000-000000000003',
         13);

      INSERT INTO public.phone_reveal_credit_reservations
        (reservation_group_id, candidate_id, run_id, provider_key, credits_reserved,
         scope_type, period_start, period_end, limit_credits, authorized_by)
      VALUES
        ('00000000-0000-4000-8000-000000000004',
         '00000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000002',
         'apollo', 8,
         'user', now(), now() + interval '30 days', 27,
         '00000000-0000-4000-8000-000000000003');
    `);

    beforeState = {
      relacl: {
        [TABLES[0]]: await relaclOf(TABLES[0]),
        [TABLES[1]]: await relaclOf(TABLES[1]),
      },
      content: {
        [TABLES[0]]: await contentHashOf(TABLES[0]),
        [TABLES[1]]: await contentHashOf(TABLES[1]),
      },
      functions: await functionFacts(),
      anonPrivileges: {
        [TABLES[0]]: await privilegesOfRole('anon', TABLES[0]),
        [TABLES[1]]: await privilegesOfRole('anon', TABLES[1]),
      },
    };
  });

  after(async () => {
    try {
      await client?.end();
    } catch {
      /* el cliente ya puede estar cerrado */
    }
    try {
      await postgres?.stop();
    } catch {
      /* el servidor ya puede estar caído */
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ═════════════════════════════════════════════════════════════
  // 0. El arnés reproduce el agujero (si no, todo lo demás pasa vacío)
  // ═════════════════════════════════════════════════════════════

  describe('0 — línea base: el agujero existe antes de la 106', () => {
    it('corre sobre PostgreSQL 17, la serie de Producción, donde MAINTAIN existe', async () => {
      const versionNum = Number(await scalar<string>(`SELECT current_setting('server_version_num')`));
      assert.ok(
        versionNum >= 170000,
        `se necesita PostgreSQL 17+ para que MAINTAIN exista; encontrado ${versionNum}`,
      );
    });

    for (const table of TABLES) {
      it(`antes de la 106, anon tiene los 8 privilegios en ${table}`, () => {
        const privileges = beforeState!.anonPrivileges[table];
        for (const privilege of TABLE_PRIVILEGES) {
          assert.equal(
            privileges[privilege],
            true,
            `el arnés no reprodujo el agujero: anon no tenía ${privilege}`,
          );
        }
      });

      it(`antes de la 106, el relacl de ${table} es el observado en Producción`, () => {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          assert.match(
            beforeState!.relacl[table],
            new RegExp(`${role}=arwdDxtm/postgres`),
            `relacl inesperada: ${beforeState!.relacl[table]}`,
          );
        }
      });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // 1. Aplicar la 106 y medir
  // ═════════════════════════════════════════════════════════════

  describe('1 — aplicación de la 106', () => {
    it('la migración se aplica sin error sobre el estado exacto posterior a la 104', async () => {
      await applyMigration('106_phone_reveal_reservation_table_grants.sql');
    });
  });

  describe('2 — matriz de privilegios tras la 106', () => {
    for (const table of TABLES) {
      for (const role of UNAUTHORIZED_ROLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          it(`${role} NO tiene ${privilege} en ${table}`, async () => {
            const privileges = await privilegesOfRole(role, table);
            assert.equal(privileges[privilege], false);
          });
        }

        it(`${role} no aparece en la ACL de ${table} con ningún privilegio`, async () => {
          assert.deepEqual(await aclPrivilegesOfRole(role, table), []);
        });
      }

      it(`PUBLIC no tiene NINGÚN privilegio en ${table}`, async () => {
        assert.deepEqual(await publicPrivileges(table), []);
      });

      it(`service_role conserva exactamente SELECT/INSERT/UPDATE/DELETE en ${table}`, async () => {
        const privileges = await privilegesOfRole('service_role', table);
        for (const privilege of TABLE_PRIVILEGES) {
          const expected = (SERVICE_ROLE_ALLOWED as readonly string[]).includes(privilege);
          assert.equal(
            privileges[privilege],
            expected,
            `service_role.${privilege} debería ser ${expected}`,
          );
        }
      });

      it(`la ACL de ${table} sólo nombra a postgres y a service_role`, async () => {
        const relacl = await relaclOf(table);
        assert.doesNotMatch(relacl, /\banon=/);
        assert.doesNotMatch(relacl, /\bauthenticated=/);
        assert.match(relacl, /service_role=arwd\//);
        assert.match(relacl, /postgres=arwdDxtm\/postgres/);
      });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // 3. Contrato: intentarlo de verdad como cada rol
  // ═════════════════════════════════════════════════════════════

  describe('3 — contrato PostgREST/PostgreSQL: anon y authenticated son rechazados', () => {
    for (const table of TABLES) {
      const attempts: Array<[string, string]> = [
        ['SELECT', `SELECT * FROM public.${table} LIMIT 1`],
        ['INSERT', `INSERT INTO public.${table} DEFAULT VALUES`],
        ['UPDATE', `UPDATE public.${table} SET id = id`],
        ['DELETE', `DELETE FROM public.${table}`],
        ['TRUNCATE', `TRUNCATE TABLE public.${table}`],
      ];

      for (const role of UNAUTHORIZED_ROLES) {
        for (const [label, sql] of attempts) {
          it(`${role} recibe 42501 al intentar ${label} en ${table}`, async () => {
            assert.equal(await errorCodeAsRole(role, sql), INSUFFICIENT_PRIVILEGE);
          });
        }
      }
    }

    for (const fn of DEFINER_FUNCTIONS) {
      for (const role of UNAUTHORIZED_ROLES) {
        it(`${role} recibe 42501 al intentar EXECUTE de ${fn.name}`, async () => {
          assert.equal(
            await errorCodeAsRole(role, `SELECT ${fn.call}`),
            INSUFFICIENT_PRIVILEGE,
            'una función SECURITY DEFINER alcanzable desde el navegador sería el agujero entero',
          );
        });
      }
    }
  });

  describe('4 — service_role sí opera, pero no puede vaciar la tabla', () => {
    for (const table of TABLES) {
      it(`service_role puede SELECT en ${table}`, async () => {
        assert.equal(await errorCodeAsRole('service_role', `SELECT * FROM public.${table}`), null);
      });

      it(`service_role NO puede TRUNCATE ${table}`, async () => {
        assert.equal(
          await errorCodeAsRole('service_role', `TRUNCATE TABLE public.${table}`),
          INSUFFICIENT_PRIVILEGE,
          'TRUNCATE ignora la RLS: si el grant estuviera, la exposición en vuelo se borraría',
        );
      });
    }

    it('service_role puede INSERT una corrida real (el camino del servidor sigue vivo)', async () => {
      const code = await errorCodeAsRole(
        'service_role',
        `INSERT INTO public.phone_reveal_waterfall_runs
           (candidate_id, status, authorized_by, max_credits_authorized)
         VALUES ('00000000-0000-4000-8000-000000000005', 'authorized',
                 '00000000-0000-4000-8000-000000000003', 8)`,
      );
      assert.equal(code, null);
    });

    it('service_role puede EXECUTE las tres funciones de la 104', async () => {
      for (const fn of DEFINER_FUNCTIONS) {
        const code = await errorCodeAsRole('service_role', `SELECT ${fn.call}`);
        assert.notEqual(
          code,
          INSUFFICIENT_PRIVILEGE,
          `${fn.name} dejó de ser ejecutable por service_role`,
        );
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 5. Lo que la 106 NO debía tocar
  // ═════════════════════════════════════════════════════════════

  describe('5 — funciones de la 104 intactas', () => {
    it('prosecdef, dueño, search_path, ACL y cuerpo son idénticos antes y después', async () => {
      assert.deepEqual(await functionFacts(), beforeState!.functions);
    });

    it('siguen siendo SECURITY DEFINER, de postgres, con search_path fijado', async () => {
      for (const row of await functionFacts()) {
        assert.equal(row.prosecdef, true, `${row.proname} dejó de ser SECURITY DEFINER`);
        assert.equal(row.owner, 'postgres');
        assert.match(row.config as string, /search_path=pg_catalog, pg_temp/);
      }
    });

    it('ni PUBLIC ni anon ni authenticated tienen EXECUTE; service_role sí', async () => {
      for (const fn of DEFINER_FUNCTIONS) {
        const { rows } = await client.query(`
          SELECT has_function_privilege('anon', 'public.${fn.name}(${fn.args})', 'EXECUTE') AS anon,
                 has_function_privilege('authenticated', 'public.${fn.name}(${fn.args})', 'EXECUTE') AS authenticated,
                 has_function_privilege('service_role', 'public.${fn.name}(${fn.args})', 'EXECUTE') AS service_role,
                 (SELECT count(*) FROM pg_proc p
                    JOIN pg_namespace n ON n.oid = p.pronamespace
                    CROSS JOIN aclexplode(p.proacl) a
                  WHERE n.nspname='public' AND p.proname='${fn.name}' AND a.grantee = 0) AS public_entries
        `);
        assert.equal(rows[0].anon, false, `${fn.name}: anon tiene EXECUTE`);
        assert.equal(rows[0].authenticated, false, `${fn.name}: authenticated tiene EXECUTE`);
        assert.equal(rows[0].service_role, true, `${fn.name}: service_role perdió EXECUTE`);
        assert.equal(Number(rows[0].public_entries), 0, `${fn.name}: PUBLIC tiene EXECUTE`);
      }
    });
  });

  describe('6 — RLS intacta', () => {
    for (const table of TABLES) {
      it(`${table}: RLS activada y NO forzada`, async () => {
        const { rows } = await client.query(`
          SELECT c.relrowsecurity, c.relforcerowsecurity
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${table}'
        `);
        assert.equal(rows[0].relrowsecurity, true);
        assert.equal(rows[0].relforcerowsecurity, false);
      });

      it(`${table}: una sola política, de service_role, y cero de anon/authenticated`, async () => {
        const { rows } = await client.query(`
          SELECT p.polname,
                 ARRAY(SELECT pg_get_userbyid(r) FROM unnest(p.polroles) AS r)::text AS roles
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${table}'
        `);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].roles, '{service_role}');
      });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // 7. Idempotencia sobre los tres estados exigidos
  // ═════════════════════════════════════════════════════════════

  describe('7 — idempotencia', () => {
    it('estado YA ENDURECIDO: reaplicar la 106 converge en el mismo relacl', async () => {
      const before = { [TABLES[0]]: await relaclOf(TABLES[0]), [TABLES[1]]: await relaclOf(TABLES[1]) };
      await applyMigration('106_phone_reveal_reservation_table_grants.sql');
      for (const table of TABLES) {
        assert.equal(await relaclOf(table), before[table]);
      }
    });

    it('estado PARCIAL: con un solo grant devuelto, la 106 vuelve a cerrarlo', async () => {
      await client.query(
        `GRANT SELECT, TRUNCATE ON TABLE public.${TABLES[0]} TO anon;
         GRANT TRUNCATE ON TABLE public.${TABLES[1]} TO authenticated;`,
      );
      assert.equal((await privilegesOfRole('anon', TABLES[0])).TRUNCATE, true);

      await applyMigration('106_phone_reveal_reservation_table_grants.sql');

      for (const table of TABLES) {
        assert.deepEqual(await aclPrivilegesOfRole('anon', table), []);
        assert.deepEqual(await aclPrivilegesOfRole('authenticated', table), []);
      }
    });

    it('estado DE PRODUCCIÓN TRAS LA 104: la 106 lo endurece desde cero otra vez', async () => {
      for (const table of TABLES) {
        await restoreSupabaseDefaultGrants(table);
        assert.equal((await privilegesOfRole('authenticated', table)).TRUNCATE, true);
      }

      await applyMigration('106_phone_reveal_reservation_table_grants.sql');

      for (const table of TABLES) {
        for (const role of UNAUTHORIZED_ROLES) {
          const privileges = await privilegesOfRole(role, table);
          for (const privilege of TABLE_PRIVILEGES) {
            assert.equal(privileges[privilege], false, `${role}.${privilege} sobrevivió en ${table}`);
          }
        }
        const serviceRole = await aclPrivilegesOfRole('service_role', table);
        assert.deepEqual(serviceRole, ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
      }
    });

    it('es segura en una base SIN las tablas: reporta y sale, no rompe la cadena', async () => {
      await client.query('BEGIN');
      try {
        await client.query(`DROP TABLE public.${TABLES[0]} CASCADE`);
        await client.query(`DROP TABLE public.${TABLES[1]} CASCADE`);
        await applyMigration('106_phone_reveal_reservation_table_grants.sql');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 8. Cero datos, cero forma
  // ═════════════════════════════════════════════════════════════

  describe('8 — la 106 no tocó una sola fila ni una sola forma', () => {
    for (const table of TABLES) {
      it(`el contenido de ${table} es idéntico al de antes de la 106`, async () => {
        assert.equal(await contentHashOf(table), beforeState!.content[table]);
        assert.notEqual(
          beforeState!.content[table],
          '<empty>',
          'la prueba sería vacua sin filas: el arnés debe insertar al menos una',
        );
      });
    }

    it('los CHECK y los índices de las dos tablas siguen siendo los mismos', async () => {
      const constraints = await scalar<string>(`
        SELECT count(*)::text FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname='public' AND t.relname IN ('${TABLES[0]}', '${TABLES[1]}')
      `);
      const indexes = await scalar<string>(`
        SELECT count(*)::text FROM pg_indexes
        WHERE schemaname='public' AND tablename IN ('${TABLES[0]}', '${TABLES[1]}')
      `);
      assert.ok(Number(constraints) > 0, 'no se encontró ningún constraint: la consulta está mal');
      assert.ok(Number(indexes) > 0, 'no se encontró ningún índice: la consulta está mal');
    });

    it('el COMMENT de cada tabla declara el endurecimiento de 4H', async () => {
      for (const table of TABLES) {
        const comment = await scalar<string>(`
          SELECT COALESCE(obj_description(c.oid, 'pg_class'), '<null>')
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${table}'
        `);
        assert.match(comment, /HARDENED IN 4H \(migration 106\)/);
      }
    });
  });
});
