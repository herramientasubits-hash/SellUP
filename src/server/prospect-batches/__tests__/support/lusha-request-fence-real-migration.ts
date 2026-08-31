// AGENT1-LUSHA-CUT-L3 — LA MIGRACIÓN REAL DE LA VALLA DURABLE (134)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Lo que CUT-L3 afirma no vive en TypeScript. Vive en una PRIMARY KEY, en un
// `ON CONFLICT DO NOTHING` con `GET DIAGNOSTICS`, en tres `UPDATE ... WHERE
// state = ...` y en dos CHECK de coherencia de tupla. «Dos trabajadores
// concurrentes no pueden reclamar la misma petición» es una afirmación sobre una
// tabla, no sobre un archivo de texto: hay que lanzar las dos transacciones y ver
// cuál pierde.
//
// Y hay una mitad que ninguna suite estática alcanza: que la 134 APLIQUE. Lleva
// tres funciones `plpgsql` con dolar-quoting nombrado y un `COMMENT ON TABLE`;
// el precedente del repo es explícito sobre por qué un lexer de comillas no basta
// (la 120 pasaba 20/20 en estático y fallaba con 42601 en PostgreSQL).
//
// ── POR QUÉ LA CADENA ES UN SOLO ARCHIVO ───────────────────────────
//
// Porque lo es. La 134 no referencia ninguna tabla, función, tipo ni constraint
// de ninguna migración anterior: crea una tabla nueva, sus índices y sus tres
// funciones. Sus dos columnas de id (`triggered_by`, `reservation_id`) van SIN
// clave foránea a propósito —un registro de seguridad de gasto tiene que poder
// escribirse aunque la fila de usuario o de reserva se archive—, así que lo único
// ajeno que necesita es el borde de PLATAFORMA: los tres roles de Supabase.
//
// ⚠️ `service_role` se crea con BYPASSRLS como en la plataforma: es justo lo que
// hace que la RLS NO sea la capa que lo protege, y por tanto lo que obliga a
// comprobar los GRANT por separado.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa
// desde `src` fuera de las pruebas, no lee un flag, no llama a ningún proveedor y
// no toca ninguna base remota. Los datos que escriben las suites son sintéticos.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Variable de entorno que convierte el skip del arnés en un FALLO. La pone el check. */
export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';

/** La versión PINCHADA. Toda la serie 17 se publica como prerelease: `@17` da ETARGET. */
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';

/** El archivo del hito. Se lee VERBATIM: lo que se prueba es lo que se despliega. */
export const LUSHA_REQUEST_FENCE_MIGRATION =
  '134_agent1_lusha_prospecting_request_fence.sql';

export const readMigration = (repoRoot: string, file: string): string =>
  readFileSync(join(repoRoot, 'supabase/migrations', file), 'utf8');

/** Los tres roles de Supabase, con `service_role` BYPASSRLS como en la plataforma. */
export const SUPABASE_ROLES_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
  END $$;

  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

  -- La tabla nueva tiene que NACER con los 8 privilegios para los tres roles, o el
  -- REVOKE de la 134 no tendría nada que quitar y «se revocó» pasaría sin revocar nada.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
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
  /** `false` = corre. String = motivo del skip. Nunca es un string si el check lo exige. */
  skip: string | false;
}

/**
 * Resuelve `embedded-postgres` con política FAIL-CLOSED.
 *
 * Si `SELLUP_REQUIRE_POSTGRES_HARNESS` está puesta y el módulo no resuelve, esto
 * LANZA. Es la mitad que importa: un arnés que se salta solo cuando falta una
 * dependencia convierte el paso obligatorio en decorativo.
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

/** Levanta los roles de la plataforma. Todavía no aplica la migración del hito. */
export async function bootstrapPlatform(client: PgLikeClient): Promise<void> {
  await client.query(SUPABASE_ROLES_SQL);
}

/**
 * Aplica la migración REAL, VERBATIM. Si no aplica, el error lleva el nombre del
 * archivo y el SQLSTATE — justo el dato que un lexer de comillas no puede dar.
 */
export async function applyLushaRequestFenceMigration(
  client: PgLikeClient,
  repoRoot: string,
  file: string = LUSHA_REQUEST_FENCE_MIGRATION,
): Promise<void> {
  try {
    await client.query(readMigration(repoRoot, file));
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'sin SQLSTATE';
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`la migración ${file} NO aplica [${code}]: ${message}`);
  }
}
