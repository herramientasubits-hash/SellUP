/**
 * AGENT1-CUT3B4 — arnés de PostgreSQL REAL para el vallado de identidad de lote.
 *
 * Levanta el borde AJENO a la cadena (los roles de Supabase, `has_active_access`,
 * `set_updated_at` y las tablas referenciadas por claves ajenas) y después aplica,
 * VERBATIM y archivo por archivo, la cadena real que define
 * `prospect_batches` / `prospect_candidates` hasta la 126.
 *
 * Nada de esto reescribe SQL: si una migración no aplica, el error lleva el nombre
 * del archivo y el SQLSTATE, que es exactamente el dato que ningún lexer de
 * comillas puede dar. La 126 declara una función `plpgsql` con dolar-quoting
 * anidado y dos `COMMENT ON` multilínea — la superficie donde un análisis estático
 * pasa y PostgreSQL falla con 42601.
 *
 * 0 proveedores, 0 créditos, 0 escrituras remotas, 0 migraciones en Producción.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';

/** La migración de este corte. */
export const CUT3B4_MIGRATION = '126_agent1_batch_identity_atomicity.sql';

/**
 * La cadena REAL que define las dos tablas del vallado, en orden.
 *
 * Se aplica entera y no un recorte: las columnas NOT NULL con DEFAULT que la 126
 * tiene que pre-rellenar nacen repartidas entre la 040 y la 045, y medir el
 * esquema sobre media cadena habría dejado el ratchet del catálogo midiendo una
 * tabla que Producción no tiene.
 */
export const CUT3B4_REAL_CHAIN = [
  '040_prospect_batches_foundation.sql',
  '045_extend_prospect_candidates_for_structured_sources.sql',
  '048_allow_denue_mexico_source.sql',
  '051_allow_datos_gob_cl_source.sql',
  '052_allow_external_import_source.sql',
  '061_add_import_catalog_classification.sql',
  '092_add_identity_key_to_prospect_candidates.sql',
  '093_add_record_origin_classification_to_prospect_candidates.sql',
  '105_repair_prospect_candidates_identity_key.sql',
  '108_add_prospect_candidates_linkedin_url.sql',
  CUT3B4_MIGRATION,
] as const;

export const readMigration = (repoRoot: string, file: string): string =>
  readFileSync(join(repoRoot, 'supabase', 'migrations', file), 'utf8');

/**
 * Los tres roles de Supabase. `service_role` con BYPASSRLS, como en Producción:
 * sin eso, una política ausente pasaría desapercibida por el lado equivocado.
 */
export const SUPABASE_ROLES_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- Supabase concede los 8 privilegios a toda tabla nueva de public por DEFAULT
-- PRIVILEGES. Reproducirlo importa: un REVOKE que no se ejecute no se nota si la
-- tabla nunca tuvo el privilegio.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

/**
 * El borde AJENO a la cadena: lo que la 040 y la 061 referencian y que otras
 * migraciones (fuera del alcance de este corte) crean.
 *
 * Se declara con los tipos REALES de las columnas que las claves ajenas tocan, y
 * nada más: este arnés mide el vallado, no reconstruye el esquema entero.
 */
export const PLATFORM_BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- CUT-3B5. La forma REAL de Producción, no una maqueta: \`has_active_access\` mira
-- \`auth_user_id\` y \`access_status\`, no la clave primaria. Sin estas dos columnas la
-- regresión de RLS mediría un predicado que Producción no tiene.
CREATE TABLE IF NOT EXISTS public.internal_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE,
  access_status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE IF NOT EXISTS public.industry_catalog_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
-- Las claves candidatas COMPUESTAS que la 061 referencia desde
-- prospect_candidates existen aqui con su forma real: sin ellas la 061 no aplica
-- y la cadena se quedaria corta justo en la tabla que este corte mide.
CREATE TABLE IF NOT EXISTS public.industries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_version_id uuid NOT NULL REFERENCES public.industry_catalog_versions(id),
  UNIQUE (id, catalog_version_id)
);
CREATE TABLE IF NOT EXISTS public.subindustries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id        uuid NOT NULL REFERENCES public.industries(id),
  catalog_version_id uuid NOT NULL REFERENCES public.industry_catalog_versions(id)
);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- El predicado de acceso REAL es independiente de la fila; aqui se conserva esa
-- propiedad (mira sólo el actor), que es de lo que depende que un INSERT en bloque
-- sea todo-o-nada.
--
-- 🔴 CUT-3B5 — \`internal_users\` va SIN CUALIFICAR, y la función NO fija
-- \`search_path\`. Las dos cosas son deliberadas y las dos son COPIA de lo que
-- \`pg_get_functiondef\` devuelve HOY en Producción (\`prosecdef = false\`,
-- \`proconfig = NULL\`, \`FROM internal_users\` a secas).
--
-- La versión anterior de este arnés escribía \`public.internal_users\`. Esa única
-- cualificación es la razón por la que la suite pasaba en verde mientras la 126
-- era INAPLICABLE para un llamador \`authenticated\`: con el nombre cualificado, el
-- \`search_path\` restringido de la función vallada daba igual. Cualificarlo aquí
-- era medir un esquema que Producción no tiene.
CREATE OR REPLACE FUNCTION public.has_active_access(p_auth_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM internal_users
     WHERE auth_user_id = p_auth_user_id
       AND access_status = 'active'
  );
$$;
`;

export type PgLikeClient = {
  connect: () => Promise<void>;
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

export type EmbeddedPostgresLike = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: () => PgLikeClient;
};

export type EmbeddedPostgresCtor = new (
  options: Record<string, unknown>,
) => EmbeddedPostgresLike;

export interface HarnessResolution {
  ctor: EmbeddedPostgresCtor | null;
  /** `false` = corre. String = motivo del skip. Nunca es string si el check lo exige. */
  skip: string | false;
}

/**
 * Resuelve `embedded-postgres` con política FAIL-CLOSED.
 *
 * Con `SELLUP_REQUIRE_POSTGRES_HARNESS` puesta —la pone el paso obligatorio del
 * workflow—, que el módulo no resuelva LANZA en vez de saltarse. Una suite que se
 * auto-excluye cuando falta una dependencia deja el check verde sobre una
 * migración que PostgreSQL no puede aplicar, que es justo lo que este archivo
 * existe para descartar.
 *
 * La resolución es SÍNCRONA (`createRequire`, no `await import()`): estas suites se
 * transpilan a CJS, donde un `await` de nivel superior no compila, y el motivo del
 * skip tiene que existir ANTES de que `describe()` decida si corre.
 */
export function resolveEmbeddedPostgres(resolveFrom: string): HarnessResolution {
  const required = Boolean(process.env[REQUIRE_HARNESS_ENV]);
  try {
    const require = createRequire(resolveFrom);
    const mod = require('embedded-postgres') as { default?: EmbeddedPostgresCtor };
    const ctor = mod.default ?? (mod as unknown as EmbeddedPostgresCtor);
    if (typeof ctor !== 'function') {
      const detail = 'embedded-postgres resolvió sin constructor utilizable';
      if (required) throw new Error(`${REQUIRE_HARNESS_ENV} está activa y ${detail}`);
      return { ctor: null, skip: detail };
    }
    return { ctor, skip: false };
  } catch (err) {
    if (required) {
      throw new Error(
        `${REQUIRE_HARNESS_ENV} está activa: esta suite NO puede saltarse. ` +
          `Instala el arnés con \`npm install --no-save embedded-postgres@${EMBEDDED_POSTGRES_VERSION}\`. ` +
          `Causa original: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      ctor: null,
      skip:
        'embedded-postgres no está instalado (arnés opcional en local: ' +
        `\`npm install --no-save embedded-postgres@${EMBEDDED_POSTGRES_VERSION}\`)`,
    };
  }
}

/**
 * Roles + borde ajeno + endurecimiento de privilegios. Todavía no aplica ninguna
 * migración de la cadena.
 *
 * CUT-3B5 añade el tercer paso: sin quitarle CREATE sobre `public` a
 * `authenticated`, el arnés no podría afirmar nada sobre el riesgo de secuestro del
 * `search_path` que este corte acepta a cambio de que RLS funcione.
 */
export async function bootstrapPlatform(client: PgLikeClient): Promise<void> {
  await client.query(SUPABASE_ROLES_SQL);
  await client.query(PLATFORM_BOOTSTRAP_SQL);
  await client.query(AUTHENTICATED_HARDENING_SQL);
}

/** Aplica la cadena REAL, archivo por archivo y verbatim. */
export async function applyCut3b4RealChain(
  client: PgLikeClient,
  repoRoot: string,
  chain: readonly string[] = CUT3B4_REAL_CHAIN,
): Promise<void> {
  for (const file of chain) {
    try {
      await client.query(readMigration(repoRoot, file));
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'sin SQLSTATE';
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`la migración ${file} NO aplica [${code}]: ${message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CUT-3B5 — el borde de RLS que la primera versión de este arnés no tenía
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El `search_path` con el que la 126 se publicó y que el preflight de Producción
 * BLOQUEÓ. Vive aquí para que la prueba en NEGATIVO pueda reintroducirlo sin que
 * nadie tenga que teclearlo de memoria.
 */
export const REGRESSED_SEARCH_PATH = 'pg_catalog, pg_temp';

/** El `search_path` corregido por este corte. `pg_catalog` PRIMERO, siempre. */
export const CORRECTED_SEARCH_PATH = 'pg_catalog, public, pg_temp';

/**
 * Devuelve el SQL de la 126 con el `search_path` sustituido.
 *
 * Es el mecanismo de la prueba de MUTACIÓN: sin poder volver a poner el camino
 * defectuoso y ver la suite en ROJO, afirmar «esta prueba habría atrapado el
 * defecto» sería una declaración de intenciones, no una medición.
 *
 * Lanza si no encuentra EXACTAMENTE las dos declaraciones esperadas: una
 * sustitución silenciosa de cero ocurrencias dejaría la mutación sin aplicar y la
 * prueba en verde por el motivo equivocado.
 */
export function withSearchPath(migrationSql: string, searchPath: string): string {
  const needle = `SET search_path = ${CORRECTED_SEARCH_PATH}`;
  const occurrences = migrationSql.split(needle).length - 1;
  if (occurrences !== 2) {
    throw new Error(
      `se esperaban 2 declaraciones \`${needle}\` en la 126 y se encontraron ${occurrences}: ` +
        'la mutación no se aplicó y la prueba mediría otra cosa',
    );
  }
  return migrationSql.split(needle).join(`SET search_path = ${searchPath}`);
}

/**
 * Cierra la superficie de secuestro por siembra en `public`, igual que Producción.
 *
 * No es decorado: `public` entra en el `search_path` de las dos funciones, y lo
 * único que impide que un rol plante ahí un objeto que suplante a otro es NO tener
 * CREATE. Producción ya lo demuestra para `authenticated` y `anon`; el arnés lo
 * reproduce y después lo RATCHEA.
 */
export const AUTHENTICATED_HARDENING_SQL = `
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;

/**
 * Ejecuta `body` con la identidad de un llamador `authenticated` REAL.
 *
 * `SET LOCAL ROLE` cambia `current_user`, y PostgreSQL decide RLS por los atributos
 * del rol ACTUAL: como `authenticated` no tiene BYPASSRLS y no es dueño de las
 * tablas, las políticas de la 040 se APLICAN de verdad. `request.jwt.claim.sub` es
 * lo que `auth.uid()` lee, igual que en Supabase.
 *
 * Todo va dentro de una transacción para que `SET LOCAL` revierta pase lo que pase:
 * una sesión que se quedara con el rol puesto contaminaría la prueba siguiente.
 */
export async function asAuthenticated<T>(
  client: PgLikeClient,
  authUserId: string,
  body: (client: PgLikeClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [authUserId]);
    await client.query('SET LOCAL ROLE authenticated');
    const out = await body(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** El SQLSTATE que el preflight de Producción devolvió: relación inexistente. */
export const UNDEFINED_TABLE_SQLSTATE = '42P01';
