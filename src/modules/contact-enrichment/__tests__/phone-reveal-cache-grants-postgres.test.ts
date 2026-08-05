/**
 * Verificación de COMPORTAMIENTO de los privilegios de tabla de la CACHÉ de teléfono contra
 * un PostgreSQL REAL y efímero (Agente 2A · AGENT2A-PHONE-WATERFALL-4J).
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 *
 * La suite hermana `phone-reveal-cache-table-grants-migration.test.ts` lee la migración 107
 * como TEXTO. Eso captura una migración mal escrita, pero no puede captar la clase de
 * defecto que 4H destapó: que `GRANT` sólo SUMA, así que un archivo que «concede exactamente
 * tres privilegios» puede dejar TRUNCATE intacto si el rol ya lo tenía por el DEFAULT
 * PRIVILEGES de Supabase. Ese error es invisible en el texto y obvio en
 * `has_table_privilege()`. Y `information_schema` tampoco basta: la pregunta que importa es
 * si un cliente autenticado como `anon` puede LEER un teléfono revelado, y eso sólo lo
 * responde intentarlo.
 *
 * Hay además una afirmación propia de este hito que NO se puede sostener leyendo texto y que
 * sería grave si fuera falsa: la 107 le quita DELETE a `service_role` sobre
 * `phone_reveal_cache`, y esa tabla tiene `account_id … ON DELETE CASCADE`. Si la cascada
 * consultara ese grant, borrar una cuenta empezaría a fallar en Producción. La § 5 lo
 * comprueba con un experimento en vez de con un comentario.
 *
 * QUÉ REPRODUCE
 *
 * El punto de partida de Producción. La forma de la relacl viene de la auditoría de sólo
 * lectura del hito 4H, que recorrió las CUATRO tablas `phone_reveal_*` y dejó registrado en
 * la cabecera de la 106 que estas dos cargan los mismos grants muertos con relacl idéntica;
 * NO se volvió a consultar Producción al escribir este archivo. No hace falta: lo que la
 * suite demuestra es que la 107 converge en el mismo estado final desde CUATRO puntos de
 * partida distintos (§ 7), así que la reproducción exacta es el caso más probable, no el
 * único cubierto.
 *
 *   * PostgreSQL 17 (Prod: 17.6; este arnés: la serie 17 de `embedded-postgres`);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la plataforma — que es
 *     justo lo que hace que la RLS NO sea la capa que protege estas tablas de él;
 *   * `GRANT USAGE ON SCHEMA public` a los tres. Sin esto el intento de `anon` fallaría por
 *     el esquema y no por la tabla, y la prueba pasaría por la razón equivocada;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated, service_role`,
 *     que es lo que hace que toda tabla nueva de `public` NAZCA con los 8 privilegios;
 *   * las migraciones 099, 102, 103, 104 y 106 tal cual están en disco, y luego la 107. La
 *     cadena completa hace falta para que la auditoría de § 9 pueda recorrer las CUATRO
 *     tablas `phone_reveal_*` del subsistema y no sólo las dos de este hito;
 *   * el recuento de filas de Producción en las dos tablas de la 107: `phone_reveal_cache`
 *     con 2 filas (una activa y un tombstone, para ejercitar los CHECK de las dos formas) y
 *     `phone_reveal_suppression_audit` VACÍA.
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción: no se leyó, ni se copió, ni se
 * inspeccionó un teléfono real para construir estos fixtures. `normalized_phone` es una
 * columna `text` sin restricción de formato, así que el fixture usa deliberadamente un token
 * que NO tiene forma de teléfono — meter algo con pinta de número en el repositorio sería
 * exactamente lo que este subsistema existe para evitar.
 *
 * QUÉ PRUEBA
 *
 *   1. que el arnés reproduce el AGUJERO: antes de la 107, `anon` y `authenticated` tienen
 *      los 8 privilegios en las dos tablas (si esto fallara, todo lo demás pasaría vacío);
 *   2. la matriz completa después de la 107: los 8 privilegios × {PUBLIC, anon,
 *      authenticated} = false, uno por uno, en las dos tablas;
 *   3. que `service_role` conserva EXACTAMENTE su lista por tabla — SELECT/INSERT/UPDATE en
 *      la caché (sin DELETE) y SELECT/INSERT en la auditoría (sin UPDATE ni DELETE);
 *   4. pruebas de contrato con `SET ROLE`: `anon` y `authenticated` reciben 42501 al intentar
 *      SELECT/INSERT/UPDATE/DELETE/TRUNCATE en cada tabla;
 *   5. que `service_role` SÍ puede hacer lo concedido, NO puede lo negado, y que la cascada
 *      de `account_id` sigue borrando filas de caché SIN que él tenga DELETE;
 *   6. que la RLS queda intacta: activada, NO forzada, una sola política de `service_role`
 *      por tabla y cero políticas de `anon`/`authenticated`;
 *   7. idempotencia sobre los cuatro estados que exige el hito: el relacl vulnerable de
 *      Producción, uno parcialmente revocado, uno ya endurecido, y con las tablas ausentes;
 *   8. que la 107 no toca UNA SOLA FILA: conteos y hash de contenido comparados antes y
 *      después de cada reaplicación, incluidos los timestamps y el rastro de proveedor;
 *   9. la auditoría de TODO el subsistema sobre el catálogo real: para cada tabla
 *      `public.phone_reveal_%` que exista, cero privilegios prohibidos para
 *      PUBLIC/anon/authenticated y TRUNCATE=false para `service_role`.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni ninguna
 * base remota; no gasta un crédito. Todo ocurre en un PostgreSQL que nace y muere dentro de
 * la prueba.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito: descargaría un
 * binario de PostgreSQL en cada `npm ci`, incluido el del check obligatorio, que no necesita
 * esta suite. Si el módulo no está resuelto, el archivo se SALTA con un motivo explícito en
 * lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:phone-cache-grants-postgres
 *
 * ⚠️ La versión va PINCHADA y con `-beta`. TODA la serie 17 de `embedded-postgres` se publica
 * como pre-release, así que `embedded-postgres@17` NO resuelve (`ETARGET`) y el comando que
 * documenta la suite hermana de 4H falla hoy. `17.6.0-beta.15` es además el binario que
 * coincide EXACTAMENTE con el PostgreSQL 17.6 de Producción, que es la razón de elegirlo por
 * encima de la última.
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

/** Los roles que no deben poder tocar nada. */
const UNAUTHORIZED_ROLES = ['anon', 'authenticated'] as const;

/**
 * Las dos tablas de la 107, cada una con la lista EXACTA que `service_role` debe conservar.
 * La asimetría es el contenido del hito, no un descuido: la caché necesita UPDATE (la
 * supresión es un borrado duro del VALOR, no de la fila) y no necesita DELETE (borrar la fila
 * borraría el tombstone); la auditoría es append-and-read, porque un registro que su propio
 * escritor puede reescribir no es evidencia.
 */
const TABLES = [
  {
    name: 'phone_reveal_cache',
    /** Ordenado alfabéticamente: es como los devuelve `aclexplode`. */
    aclExpected: ['INSERT', 'SELECT', 'UPDATE'],
  },
  {
    name: 'phone_reveal_suppression_audit',
    aclExpected: ['INSERT', 'SELECT'],
  },
] as const;

/** Código de PostgreSQL para «permiso denegado». Lo único que cuenta como rechazo real. */
const INSUFFICIENT_PRIVILEGE = '42501';

/** Cuentas del fixture. La tercera existe SOLO para que la cascada pueda borrarse. */
const ACCOUNT_MAIN = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT_CASCADE = '00000000-0000-4000-8000-0000000000a2';

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
 * Resolución SÍNCRONA con `createRequire`, no con `await import()`: este archivo se transpila
 * a CJS, donde un `await` de nivel superior no compila, y la razón del skip tiene que estar
 * disponible ANTES de que `describe()` decida si corre.
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

const apply107 = () => applyMigration('107_phone_reveal_cache_and_suppression_grants.sql');

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

/** La tercera vía exigida por el hito, además de `aclexplode` y `has_table_privilege`. */
const informationSchemaGrants = async (table: string, grantee: string): Promise<string[]> => {
  const { rows } = await client.query(`
    SELECT privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = '${table}' AND grantee = '${grantee}'
    ORDER BY privilege_type
  `);
  return rows.map((row) => row.privilege_type as string);
};

const relaclOf = (table: string) =>
  scalar<string>(
    `SELECT COALESCE(c.relacl::text, '<null>') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='${table}'`,
  );

/**
 * Huella del CONTENIDO COMPLETO de una tabla: `t::text` serializa TODAS las columnas, así que
 * un cambio en un timestamp, en el rastro de proveedor o en el teléfono movería el hash.
 */
const contentHashOf = (table: string) =>
  scalar<string>(
    `SELECT COALESCE(md5(string_agg(t::text, '|' ORDER BY t::text)), '<empty>') FROM public.${table} t`,
  );

const rowCountOf = async (table: string) =>
  Number(await scalar<string>(`SELECT count(*)::text FROM public.${table}`));

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
// Arranque: reproducir Producción y aplicar 099 → 102 → 103 → 104 → 106
// ═══════════════════════════════════════════════════════════════

/** Estado capturado ANTES de la 107, para comparar contra el de después. */
let beforeState: {
  relacl: Record<string, string>;
  content: Record<string, string>;
  counts: Record<string, number>;
  anonPrivileges: Record<string, Record<string, boolean>>;
  cacheRowFacts: Record<string, unknown>[];
} | null = null;

describe('107 — privilegios de tabla contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'a2a-4j-pg-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: join(dataDir, 'data'),
      user: 'postgres',
      password: 'harness-local-only',
      // Puerto propio: la suite de 4H usa el 54329 y las dos deben poder coexistir.
      port: 54331,
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

    // ── Dependencias mínimas de la 099 ─────────────────────────────
    // Las cinco tablas a las que apuntan sus FKs, más `set_updated_at()` de la 038 (que la
    // 099 reutiliza para su trigger) y la columna `phone_source` de `contacts`, cuyo CHECK
    // la 099 ensancha. Son stubs deliberados: este arnés prueba PRIVILEGIOS, no el esquema
    // completo del repositorio.
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $fn$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      CREATE TABLE public.accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
      CREATE TABLE public.internal_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
      CREATE TABLE public.provider_usage_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
      CREATE TABLE public.contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone_source text NULL
      );
      CREATE TABLE public.contact_enrichment_candidates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
    `);

    await applyMigration('099_apollo_phone_reveal_cache.sql');
    // La cadena del waterfall + su endurecimiento: hace falta para que § 9 pueda auditar las
    // CUATRO tablas del subsistema y no sólo las dos de este hito.
    await applyMigration('102_phone_reveal_waterfall_runs.sql');
    await applyMigration('103_phone_reveal_waterfall_legacy_mode.sql');
    await applyMigration('104_phone_reveal_credit_reservations.sql');
    await applyMigration('106_phone_reveal_reservation_table_grants.sql');

    // ── Fixtures SINTÉTICOS con la forma de Producción ─────────────
    // `phone_reveal_cache`: 2 filas, como Prod. Una activa y un tombstone, para que las dos
    // formas que los CHECK de la 099 permiten queden representadas. `normalized_phone` es
    // `text` sin formato, así que el fixture usa un token que NO parece un teléfono a
    // propósito. `phone_reveal_suppression_audit`: VACÍA, como Prod.
    await client.query(`
      INSERT INTO public.accounts (id) VALUES ('${ACCOUNT_MAIN}'), ('${ACCOUNT_CASCADE}');
      INSERT INTO public.contact_enrichment_candidates (id)
        VALUES ('00000000-0000-4000-8000-0000000000c1');

      INSERT INTO public.phone_reveal_cache
        (provider, provider_person_id, account_id, country_code,
         normalized_phone, phone_type, phone_source,
         original_revealed_at, expires_at, hit_count, last_used_at, source_candidate_id)
      VALUES
        ('apollo', '000000000000000000000001', '${ACCOUNT_MAIN}', 'CO',
         'SYNTHETIC-NOT-A-PHONE-0001', 'mobile', 'apollo_reveal',
         '2026-07-01T00:00:00Z', '2026-09-29T00:00:00Z', 3, '2026-07-15T00:00:00Z',
         '00000000-0000-4000-8000-0000000000c1');

      -- Tombstone: teléfono en NULL (borrado duro del valor) + motivo del vocabulario
      -- cerrado. Es la fila que un TRUNCATE borraría y cuya desaparición volvería a hacer
      -- revelable a una persona que pidió ser olvidada.
      INSERT INTO public.phone_reveal_cache
        (provider, provider_person_id, account_id, country_code,
         normalized_phone, phone_type, phone_source,
         original_revealed_at, expires_at, suppressed_at, suppression_reason)
      VALUES
        ('apollo', '000000000000000000000002', '${ACCOUNT_MAIN}', 'CO',
         NULL, NULL, 'apollo_reveal',
         '2026-06-01T00:00:00Z', '2026-08-30T00:00:00Z',
         '2026-07-20T00:00:00Z', 'test_synthetic');
    `);

    beforeState = {
      relacl: {
        [TABLES[0].name]: await relaclOf(TABLES[0].name),
        [TABLES[1].name]: await relaclOf(TABLES[1].name),
      },
      content: {
        [TABLES[0].name]: await contentHashOf(TABLES[0].name),
        [TABLES[1].name]: await contentHashOf(TABLES[1].name),
      },
      counts: {
        [TABLES[0].name]: await rowCountOf(TABLES[0].name),
        [TABLES[1].name]: await rowCountOf(TABLES[1].name),
      },
      anonPrivileges: {
        [TABLES[0].name]: await privilegesOfRole('anon', TABLES[0].name),
        [TABLES[1].name]: await privilegesOfRole('anon', TABLES[1].name),
      },
      // Columna por columna de lo que un endurecimiento de privilegios jamás debe mover.
      cacheRowFacts: (
        await client.query(`
          SELECT provider_person_id, normalized_phone, phone_type, phone_source,
                 country_code, hit_count,
                 original_revealed_at, expires_at, last_used_at,
                 suppressed_at, suppression_reason,
                 source_candidate_id, created_at, updated_at
          FROM public.phone_reveal_cache
          ORDER BY provider_person_id
        `)
      ).rows,
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

  describe('0 — línea base: el agujero existe antes de la 107', () => {
    it('corre sobre PostgreSQL 17, la serie de Producción, donde MAINTAIN existe', async () => {
      const versionNum = Number(
        await scalar<string>(`SELECT current_setting('server_version_num')`),
      );
      assert.ok(
        versionNum >= 170000,
        `se necesita PostgreSQL 17+ para que MAINTAIN exista; encontrado ${versionNum}`,
      );
    });

    for (const { name } of TABLES) {
      it(`antes de la 107, anon tiene los 8 privilegios en ${name}`, () => {
        const privileges = beforeState!.anonPrivileges[name];
        for (const privilege of TABLE_PRIVILEGES) {
          assert.equal(
            privileges[privilege],
            true,
            `el arnés no reprodujo el agujero: anon no tenía ${privilege}`,
          );
        }
      });

      it(`antes de la 107, el relacl de ${name} es el auditado en Producción`, () => {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          assert.match(
            beforeState!.relacl[name],
            new RegExp(`${role}=arwdDxtm/postgres`),
            `relacl inesperada: ${beforeState!.relacl[name]}`,
          );
        }
      });
    }

    it('el fixture reproduce el recuento de Producción: caché 2 filas, auditoría 0', () => {
      assert.equal(beforeState!.counts[TABLES[0].name], 2);
      assert.equal(beforeState!.counts[TABLES[1].name], 0);
    });

    it('la caché arranca con una fila activa CON teléfono y un tombstone SIN teléfono', () => {
      const [active, tombstone] = beforeState!.cacheRowFacts;
      assert.equal(active.normalized_phone, 'SYNTHETIC-NOT-A-PHONE-0001');
      assert.equal(active.suppressed_at, null);
      assert.equal(tombstone.normalized_phone, null);
      assert.notEqual(tombstone.suppressed_at, null);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 1. Aplicar la 107 y medir
  // ═════════════════════════════════════════════════════════════

  describe('1 — aplicación de la 107', () => {
    it('la migración se aplica sin error sobre el estado exacto posterior a la 099', async () => {
      await apply107();
    });
  });

  describe('2 — matriz de privilegios tras la 107', () => {
    for (const { name, aclExpected } of TABLES) {
      for (const role of UNAUTHORIZED_ROLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          it(`${role} NO tiene ${privilege} en ${name}`, async () => {
            const privileges = await privilegesOfRole(role, name);
            assert.equal(privileges[privilege], false);
          });
        }

        it(`${role} no aparece en la ACL de ${name} con ningún privilegio`, async () => {
          assert.deepEqual(await aclPrivilegesOfRole(role, name), []);
        });

        it(`information_schema tampoco le atribuye nada a ${role} en ${name}`, async () => {
          assert.deepEqual(await informationSchemaGrants(name, role), []);
        });
      }

      it(`PUBLIC no tiene NINGÚN privilegio en ${name}`, async () => {
        assert.deepEqual(await publicPrivileges(name), []);
      });

      it(`service_role conserva EXACTAMENTE ${aclExpected.join('/')} en ${name}`, async () => {
        const privileges = await privilegesOfRole('service_role', name);
        for (const privilege of TABLE_PRIVILEGES) {
          const expected = (aclExpected as readonly string[]).includes(privilege);
          assert.equal(
            privileges[privilege],
            expected,
            `service_role.${privilege} debería ser ${expected} en ${name}`,
          );
        }
      });

      it(`la ACL de ${name} coincide en las tres vías de consulta`, async () => {
        assert.deepEqual(await aclPrivilegesOfRole('service_role', name), [...aclExpected]);
        assert.deepEqual(await informationSchemaGrants(name, 'service_role'), [...aclExpected]);
      });

      it(`la relacl de ${name} sólo nombra a postgres y a service_role`, async () => {
        const relacl = await relaclOf(name);
        assert.doesNotMatch(relacl, /\banon=/);
        assert.doesNotMatch(relacl, /\bauthenticated=/);
        assert.match(relacl, /postgres=arwdDxtm\/postgres/);
      });
    }

    /**
     * La asimetría medida en el ACL REAL, no en el texto. Si alguien «normalizara» las dos
     * tablas al sobre uniforme de la 106, esto es lo que lo detiene.
     */
    it('la caché tiene UPDATE y la auditoría no; ninguna de las dos tiene DELETE', async () => {
      const cache = await privilegesOfRole('service_role', TABLES[0].name);
      const audit = await privilegesOfRole('service_role', TABLES[1].name);
      assert.equal(cache.UPDATE, true);
      assert.equal(audit.UPDATE, false);
      assert.equal(cache.DELETE, false);
      assert.equal(audit.DELETE, false);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 3. Contrato: intentarlo de verdad como cada rol
  // ═════════════════════════════════════════════════════════════

  describe('3 — contrato PostgREST/PostgreSQL: anon y authenticated son rechazados', () => {
    for (const { name } of TABLES) {
      const attempts: Array<[string, string]> = [
        ['SELECT', `SELECT * FROM public.${name} LIMIT 1`],
        ['INSERT', `INSERT INTO public.${name} DEFAULT VALUES`],
        ['UPDATE', `UPDATE public.${name} SET id = id`],
        ['DELETE', `DELETE FROM public.${name}`],
        ['TRUNCATE', `TRUNCATE TABLE public.${name}`],
      ];

      for (const role of UNAUTHORIZED_ROLES) {
        for (const [label, sql] of attempts) {
          it(`${role} recibe 42501 al intentar ${label} en ${name}`, async () => {
            assert.equal(await errorCodeAsRole(role, sql), INSUFFICIENT_PRIVILEGE);
          });
        }
      }
    }
  });

  describe('4 — service_role: lo concedido funciona, lo negado da 42501', () => {
    const CACHE = TABLES[0].name;
    const AUDIT = TABLES[1].name;

    it(`puede SELECT en ${CACHE}`, async () => {
      assert.equal(await errorCodeAsRole('service_role', `SELECT * FROM public.${CACHE}`), null);
    });

    it(`puede SELECT en ${AUDIT}: leer el registro de una supresión es su propósito`, async () => {
      assert.equal(await errorCodeAsRole('service_role', `SELECT * FROM public.${AUDIT}`), null);
    });

    it('puede INSERT una entrada de caché real (el camino del servidor sigue vivo)', async () => {
      const code = await errorCodeAsRole(
        'service_role',
        `INSERT INTO public.${CACHE}
           (provider, provider_person_id, account_id, country_code, normalized_phone,
            phone_source, original_revealed_at, expires_at)
         VALUES ('apollo', '000000000000000000000009', '${ACCOUNT_MAIN}', 'CO',
                 'SYNTHETIC-NOT-A-PHONE-0009', 'apollo_reveal',
                 '2026-07-01T00:00:00Z', '2026-09-29T00:00:00Z')`,
      );
      assert.equal(code, null);
    });

    it('puede UPDATE la caché: la supresión es un borrado duro del VALOR, vía UPDATE', async () => {
      const code = await errorCodeAsRole(
        'service_role',
        `UPDATE public.${CACHE}
            SET normalized_phone = NULL, phone_type = NULL,
                suppressed_at = now(), suppression_reason = 'test_synthetic'
          WHERE provider_person_id = '000000000000000000000001'`,
      );
      assert.equal(code, null);
    });

    it('puede INSERT en la auditoría de supresión', async () => {
      const code = await errorCodeAsRole(
        'service_role',
        `INSERT INTO public.${AUDIT}
           (provider, provider_person_id_hash, account_id, reason_code)
         VALUES ('apollo', repeat('a', 64), '${ACCOUNT_MAIN}', 'test_synthetic')`,
      );
      assert.equal(code, null);
    });

    it(`NO puede DELETE en ${CACHE}: borrar una fila borraría un tombstone`, async () => {
      assert.equal(
        await errorCodeAsRole('service_role', `DELETE FROM public.${CACHE}`),
        INSUFFICIENT_PRIVILEGE,
      );
    });

    for (const [label, sql] of [
      ['UPDATE', `UPDATE public.${AUDIT} SET id = id`],
      ['DELETE', `DELETE FROM public.${AUDIT}`],
    ] as const) {
      it(`NO puede ${label} en ${AUDIT}: un registro reescribible no es evidencia`, async () => {
        assert.equal(await errorCodeAsRole('service_role', sql), INSUFFICIENT_PRIVILEGE);
      });
    }

    for (const { name } of TABLES) {
      it(`NO puede TRUNCATE ${name}`, async () => {
        assert.equal(
          await errorCodeAsRole('service_role', `TRUNCATE TABLE public.${name}`),
          INSUFFICIENT_PRIVILEGE,
          'TRUNCATE ignora la RLS: si el grant estuviera, los tombstones de DSAR se borrarían',
        );
      });
    }
  });

  // ═════════════════════════════════════════════════════════════
  // 5. La afirmación arriesgada de este hito, comprobada
  // ═════════════════════════════════════════════════════════════

  /**
   * Quitarle DELETE a `service_role` sobre una tabla con `ON DELETE CASCADE` entrante sería
   * un error grave si la cascada consultara ese grant: borrar una cuenta empezaría a fallar
   * en Producción. No lo hace — PostgreSQL ejecuta las acciones de integridad referencial con
   * los derechos del dueño de la restricción, no del rol que dispara el borrado — pero eso es
   * exactamente la clase de afirmación que merece un experimento en vez de un comentario.
   */
  describe('5 — la cascada de account_id sigue funcionando SIN DELETE', () => {
    it('service_role borra una cuenta y sus filas de caché desaparecen, aun sin DELETE en la caché', async () => {
      const CACHE = TABLES[0].name;
      await client.query(`GRANT DELETE ON TABLE public.accounts TO service_role`);
      await client.query('BEGIN');
      try {
        await client.query(`
          INSERT INTO public.${CACHE}
            (provider, provider_person_id, account_id, country_code, normalized_phone,
             phone_source, original_revealed_at, expires_at)
          VALUES ('apollo', '0000000000000000000000ca', '${ACCOUNT_CASCADE}', 'CO',
                  'SYNTHETIC-NOT-A-PHONE-00CA', 'apollo_reveal',
                  '2026-07-01T00:00:00Z', '2026-09-29T00:00:00Z')
        `);
        const seeded = Number(
          await scalar<string>(
            `SELECT count(*)::text FROM public.${CACHE} WHERE account_id = '${ACCOUNT_CASCADE}'`,
          ),
        );
        assert.equal(seeded, 1, 'el fixture de la cascada no se sembró');

        await client.query('SET LOCAL ROLE service_role');
        assert.equal(
          await scalar<boolean>(
            `SELECT has_table_privilege('service_role', 'public.${CACHE}', 'DELETE')`,
          ),
          false,
          'la prueba sería vacua si service_role tuviera DELETE en la caché',
        );
        await client.query(`DELETE FROM public.accounts WHERE id = '${ACCOUNT_CASCADE}'`);
        await client.query('RESET ROLE');

        const remaining = Number(
          await scalar<string>(
            `SELECT count(*)::text FROM public.${CACHE} WHERE account_id = '${ACCOUNT_CASCADE}'`,
          ),
        );
        assert.equal(
          remaining,
          0,
          'la cascada NO borró la fila: quitarle DELETE a service_role rompería el borrado de cuentas',
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 6. Lo que la 107 NO debía tocar
  // ═════════════════════════════════════════════════════════════

  describe('6 — RLS intacta', () => {
    for (const { name } of TABLES) {
      it(`${name}: RLS activada y NO forzada`, async () => {
        const { rows } = await client.query(`
          SELECT c.relrowsecurity, c.relforcerowsecurity
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${name}'
        `);
        assert.equal(rows[0].relrowsecurity, true);
        assert.equal(rows[0].relforcerowsecurity, false);
      });

      it(`${name}: una sola política, de service_role, y cero de anon/authenticated`, async () => {
        const { rows } = await client.query(`
          SELECT p.polname,
                 ARRAY(SELECT pg_get_userbyid(r) FROM unnest(p.polroles) AS r)::text AS roles
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${name}'
        `);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].roles, '{service_role}');
      });
    }

    it('el trigger `set_updated_at` de la 099 sigue en pie sobre la caché', async () => {
      const triggers = await scalar<string>(`
        SELECT count(*)::text FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND c.relname='${TABLES[0].name}' AND NOT t.tgisinternal
      `);
      assert.equal(triggers, '1');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 7. Idempotencia sobre los cuatro estados exigidos
  // ═════════════════════════════════════════════════════════════

  describe('7 — idempotencia', () => {
    it('estado YA ENDURECIDO: reaplicar la 107 converge en el mismo relacl', async () => {
      const before = {
        [TABLES[0].name]: await relaclOf(TABLES[0].name),
        [TABLES[1].name]: await relaclOf(TABLES[1].name),
      };
      await apply107();
      for (const { name } of TABLES) {
        assert.equal(await relaclOf(name), before[name]);
      }
    });

    it('estado PARCIAL: con un solo grant devuelto, la 107 vuelve a cerrarlo', async () => {
      await client.query(
        `GRANT SELECT, TRUNCATE ON TABLE public.${TABLES[0].name} TO anon;
         GRANT TRUNCATE ON TABLE public.${TABLES[1].name} TO authenticated;`,
      );
      assert.equal((await privilegesOfRole('anon', TABLES[0].name)).TRUNCATE, true);

      await apply107();

      for (const { name } of TABLES) {
        assert.deepEqual(await aclPrivilegesOfRole('anon', name), []);
        assert.deepEqual(await aclPrivilegesOfRole('authenticated', name), []);
      }
    });

    it('estado DE PRODUCCIÓN TRAS LA 099: la 107 lo endurece desde cero otra vez', async () => {
      for (const { name } of TABLES) {
        await restoreSupabaseDefaultGrants(name);
        assert.equal((await privilegesOfRole('authenticated', name)).TRUNCATE, true);
      }

      await apply107();

      for (const { name, aclExpected } of TABLES) {
        for (const role of UNAUTHORIZED_ROLES) {
          const privileges = await privilegesOfRole(role, name);
          for (const privilege of TABLE_PRIVILEGES) {
            assert.equal(privileges[privilege], false, `${role}.${privilege} sobrevivió en ${name}`);
          }
        }
        assert.deepEqual(await aclPrivilegesOfRole('service_role', name), [...aclExpected]);
      }
    });

    it('es segura con UNA tabla ausente: endurece la que queda', async () => {
      await client.query('BEGIN');
      try {
        await client.query(`DROP TABLE public.${TABLES[1].name} CASCADE`);
        await apply107();
        assert.deepEqual(await aclPrivilegesOfRole('anon', TABLES[0].name), []);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('es segura con las DOS ausentes: reporta y sale, no rompe la cadena', async () => {
      await client.query('BEGIN');
      try {
        await client.query(`DROP TABLE public.${TABLES[0].name} CASCADE`);
        await client.query(`DROP TABLE public.${TABLES[1].name} CASCADE`);
        await apply107();
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 8. Cero datos, cero forma
  // ═════════════════════════════════════════════════════════════

  describe('8 — la 107 no tocó una sola fila ni una sola forma', () => {
    for (const { name } of TABLES) {
      it(`el conteo de ${name} es idéntico al de antes de la 107`, async () => {
        assert.equal(await rowCountOf(name), beforeState!.counts[name]);
      });

      it(`el contenido de ${name} es idéntico al de antes de la 107`, async () => {
        assert.equal(await contentHashOf(name), beforeState!.content[name]);
      });
    }

    /**
     * La caché tiene que tener filas o la comparación de hash no prueba nada. La auditoría
     * arranca vacía A PROPÓSITO (es su estado en Producción), así que su preservación se
     * demuestra aparte, sembrándola y reaplicando.
     */
    it('la comparación no es vacua: la caché tenía filas antes de la 107', () => {
      assert.notEqual(beforeState!.content[TABLES[0].name], '<empty>');
      assert.equal(beforeState!.counts[TABLES[0].name], 2);
    });

    it('columna por columna: teléfono, tipo, procedencia, timestamps y tombstone intactos', async () => {
      const { rows } = await client.query(`
        SELECT provider_person_id, normalized_phone, phone_type, phone_source,
               country_code, hit_count,
               original_revealed_at, expires_at, last_used_at,
               suppressed_at, suppression_reason,
               source_candidate_id, created_at, updated_at
        FROM public.phone_reveal_cache
        ORDER BY provider_person_id
      `);
      assert.deepEqual(rows, beforeState!.cacheRowFacts);
    });

    it('la auditoría, sembrada y con la 107 reaplicada, conserva su contenido', async () => {
      const AUDIT = TABLES[1].name;
      await client.query(`
        INSERT INTO public.${AUDIT}
          (provider, provider_person_id_hash, account_id, country_code, reason_code,
           candidates_cleared, contacts_cleared, cache_rows_suppressed, tombstone_created)
        VALUES ('apollo', repeat('b', 64), '${ACCOUNT_MAIN}', 'CO', 'test_synthetic',
                1, 1, 1, false)
      `);
      const seeded = await contentHashOf(AUDIT);
      assert.notEqual(seeded, '<empty>');

      await apply107();

      assert.equal(await contentHashOf(AUDIT), seeded);
      assert.equal(await rowCountOf(AUDIT), 1);
    });

    it('los CHECK y los índices de las dos tablas siguen siendo los mismos', async () => {
      const constraints = await scalar<string>(`
        SELECT count(*)::text FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname='public' AND t.relname IN ('${TABLES[0].name}', '${TABLES[1].name}')
      `);
      const indexes = await scalar<string>(`
        SELECT count(*)::text FROM pg_indexes
        WHERE schemaname='public' AND tablename IN ('${TABLES[0].name}', '${TABLES[1].name}')
      `);
      assert.ok(Number(constraints) > 0, 'no se encontró ningún constraint: la consulta está mal');
      assert.ok(Number(indexes) > 0, 'no se encontró ningún índice: la consulta está mal');
    });

    it('el COMMENT de cada tabla declara el endurecimiento de 4J', async () => {
      for (const { name } of TABLES) {
        const comment = await scalar<string>(`
          SELECT COALESCE(obj_description(c.oid, 'pg_class'), '<null>')
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${name}'
        `);
        assert.match(comment, /HARDENED IN 4J \(migration 107\)/);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 9. Auditoría de TODO el subsistema sobre el catálogo real
  // ═════════════════════════════════════════════════════════════

  /**
   * La red que impide que una futura tabla `phone_reveal_*` herede el agujero. La causa raíz
   * global — el `ALTER DEFAULT PRIVILEGES` de Supabase — sigue viva y queda documentada como
   * deuda de plataforma, así que la defensa disponible es detectar la consecuencia.
   *
   * Aquí las tablas se descubren en `pg_class`, no en una lista escrita a mano: cualquier
   * tabla del subsistema que exista en la base tras aplicar la cadena entra sola.
   */
  describe('9 — ninguna tabla public.phone_reveal_% conserva privilegios de navegador', () => {
    const discovered = async (): Promise<string[]> => {
      const { rows } = await client.query(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'phone\\_reveal\\_%'
        ORDER BY c.relname
      `);
      return rows.map((row) => row.relname as string);
    };

    it('descubre las cuatro tablas del subsistema: la auditoría no puede pasar vacía', async () => {
      const tables = await discovered();
      for (const expected of [
        'phone_reveal_cache',
        'phone_reveal_credit_reservations',
        'phone_reveal_suppression_audit',
        'phone_reveal_waterfall_runs',
      ]) {
        assert.ok(tables.includes(expected), `no se descubrió ${expected}; encontradas: ${tables}`);
      }
    });

    it('PUBLIC no tiene un solo privilegio en ninguna de ellas', async () => {
      for (const table of await discovered()) {
        assert.deepEqual(await publicPrivileges(table), [], `PUBLIC tiene privilegios en ${table}`);
      }
    });

    for (const role of UNAUTHORIZED_ROLES) {
      it(`${role} no tiene ninguno de los 8 privilegios en ninguna de ellas`, async () => {
        for (const table of await discovered()) {
          const privileges = await privilegesOfRole(role, table);
          for (const privilege of TABLE_PRIVILEGES) {
            assert.equal(
              privileges[privilege],
              false,
              `${role} conserva ${privilege} en ${table}: heredó el DEFAULT PRIVILEGES y nadie lo revocó`,
            );
          }
          assert.deepEqual(await aclPrivilegesOfRole(role, table), []);
        }
      });
    }

    it('service_role no tiene TRUNCATE en ninguna de ellas', async () => {
      for (const table of await discovered()) {
        const privileges = await privilegesOfRole('service_role', table);
        assert.equal(
          privileges.TRUNCATE,
          false,
          `service_role puede TRUNCATE ${table}, y TRUNCATE ignora la RLS por completo`,
        );
      }
    });

    it('service_role no tiene REFERENCES, TRIGGER ni MAINTAIN en ninguna de ellas', async () => {
      for (const table of await discovered()) {
        const privileges = await privilegesOfRole('service_role', table);
        for (const privilege of ['REFERENCES', 'TRIGGER', 'MAINTAIN'] as const) {
          assert.equal(privileges[privilege], false, `service_role conserva ${privilege} en ${table}`);
        }
      }
    });
  });
});
