// Agente 1 — LA MIGRACIÓN REAL DE LA MEMORIA PROVIDER-SEEN
// (AGENT1-PROVIDER-SEEN-MEMORY-2)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Una migración que PostgreSQL no puede aplicar tiene que romper el check obligatorio.
// El precedente del repo es explícito sobre por qué una suite estática no basta: el
// defecto real de la 120 —un apóstrofo sin escapar dentro de un `COMMENT ON TABLE`—
// dejaba la PARIDAD de comillas intacta, así que el lexer de TypeScript pasaba 20/20 y
// sólo PostgreSQL fallaba con 42601. Esta migración lleva cinco `COMMENT ON` y una
// función `plpgsql` con dolar-quoting anidado: exactamente la superficie que un lexer
// no puede juzgar.
//
// Y hay una segunda mitad que NINGUNA prueba de TypeScript puede cubrir, que es la
// razón de fondo de este hito: la semántica de identidad vive en DOS índices únicos
// PARCIALES y en un `ON CONFLICT ... DO UPDATE` con mezcla ordenada. Si esa semántica no
// se ejercita contra un PostgreSQL de verdad, «dos ids nativos distintos pueden
// compartir dominio» es una afirmación sobre un archivo de texto, no sobre una tabla.
//
// ── POR QUÉ LA CADENA ES UN SOLO ARCHIVO ───────────────────────────
//
// Porque lo es. La 123 no referencia ninguna tabla, función, tipo ni constraint de
// ninguna migración anterior: crea una tabla nueva, sus índices, su trigger y su
// función. Lo único ajeno que necesita es el borde de PLATAFORMA —`pgcrypto` para
// `gen_random_uuid()` y los tres roles de Supabase—, que ninguna migración del repo
// crea. Declarar aquí una cadena más larga sería decorarla, no reproducirla.
//
// ⚠️ `service_role` se crea con BYPASSRLS como en la plataforma: es justo lo que hace
// que la RLS NO sea la capa que protege esta tabla de él, y por tanto lo que obliga a
// comprobar los GRANT por separado.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde
// `src` fuera de las pruebas, no lee un flag, no llama a ningún proveedor y no toca
// ninguna base remota. Los datos que escriben las suites son sintéticos.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Variable de entorno que convierte el skip del arnés en un FALLO. La pone el check. */
export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';

/** La versión PINCHADA. Toda la serie 17 se publica como prerelease: `@17` da ETARGET. */
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';

/** El archivo del hito. Se lee VERBATIM: lo que se prueba es lo que se despliega. */
export const PROVIDER_SEEN_MIGRATION = '123_provider_seen_entities.sql';

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
  -- REVOKE de la 123 no tendría nada que quitar y «se revocó» pasaría sin revocar nada.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

/** El borde AJENO a la migración. `pgcrypto` es lo único que la 123 necesita de fuera. */
export const PLATFORM_BOOTSTRAP_SQL = `CREATE EXTENSION IF NOT EXISTS pgcrypto;`;

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
 * Si `SELLUP_REQUIRE_POSTGRES_HARNESS` está puesta y el módulo no resuelve, esto LANZA.
 * Es la mitad que importa: un arnés que se salta solo cuando falta una dependencia
 * convierte el paso obligatorio en decorativo, y bastaría con que el `npm install` del
 * workflow fallara para que el check se pusiera verde con una migración inaplicable.
 *
 * La resolución es SÍNCRONA (`createRequire`, no `await import()`): estas suites se
 * transpilan a CJS —donde un `await` de nivel superior no compila— y el motivo del skip
 * tiene que existir ANTES de que `describe()` decida si corre.
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

/** Levanta roles + borde ajeno. Todavía no aplica la migración del hito. */
export async function bootstrapPlatform(client: PgLikeClient): Promise<void> {
  await client.query(SUPABASE_ROLES_SQL);
  await client.query(PLATFORM_BOOTSTRAP_SQL);
}

/**
 * Aplica la migración REAL, VERBATIM. Si no aplica, el error lleva el nombre del archivo
 * y el SQLSTATE — que es justo el dato que un lexer de comillas no puede dar.
 */
export async function applyProviderSeenMigration(
  client: PgLikeClient,
  repoRoot: string,
  file: string = PROVIDER_SEEN_MIGRATION,
): Promise<void> {
  try {
    await client.query(readMigration(repoRoot, file));
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'sin SQLSTATE';
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`la migración ${file} NO aplica [${code}]: ${message}`);
  }
}
