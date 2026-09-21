// AGENT1-APOLLO-CONTINUATION-POSTGRES-139 — arnés de la verificación SQL.
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Comprobar objetos y permisos por lectura NO prueba el comportamiento: que un
// `processing` con lease vencido vuelva a reclamarse, que el token impida a un
// dueño antiguo cerrar el trabajo, que el índice único parcial bloquee una
// segunda continuación viva y que `FOR UPDATE SKIP LOCKED` reparta bien entre
// conexiones simultáneas son afirmaciones sobre PostgreSQL, no sobre un texto.
//
// Este arnés levanta un PostgreSQL DESECHABLE (embedded, sin infraestructura de
// pago y sin tocar Producción), aplica la migración 139 VERBATIM y expone un
// cliente con la forma de PostgREST para que las pruebas ejerciten el CUERPO
// REAL del worker —`claimJobs` y `settleJob`— en vez de reimplementar sus
// reglas. Lo único simulado es el TRANSPORTE; las reglas siguen en producción.
//
// No es código de producción: vive bajo `__tests__/support` y nadie lo importa
// desde `src`.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';
export const CONTINUATION_MIGRATION = '139_agent1_apollo_round_continuation_jobs.sql';

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
  createDatabase?: (name: string) => Promise<void>;
};

export type EmbeddedPostgresCtor = new (options: Record<string, unknown>) => EmbeddedPostgresLike;

export function resolveEmbeddedPostgres(resolveFrom: string): {
  ctor: EmbeddedPostgresCtor | null;
  skip: string | false;
} {
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
      skip: `embedded-postgres no está instalado (arnés opcional en local: \`npm install --no-save embedded-postgres@${EMBEDDED_POSTGRES_VERSION}\`)`,
    };
  }
}

/**
 * DEPENDENCIAS MÍNIMAS, y nada más.
 *
 * La 139 necesita exactamente cuatro cosas de fuera: `pgcrypto` para
 * `gen_random_uuid()`, los tres roles de Supabase —`service_role` con BYPASSRLS
 * como en la plataforma, que es justo lo que obliga a comprobar los GRANT por
 * separado de la RLS—, la función `set_updated_at()` (verbatim de la 038) y la
 * tabla `prospect_batches` a la que apunta su FK.
 *
 * `prospect_batches` se crea con lo MÍNIMO que la FK exige. Reproducir la 040
 * entera traería veinte columnas que esta verificación no usa.
 */
export const MINIMAL_DEPENDENCIES_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

  -- Como en la plataforma: toda tabla nueva NACE con privilegios para los tres
  -- roles. Sin esto, el REVOKE de la 139 no tendría nada que quitar y «se
  -- revocó» pasaría sin revocar nada.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

  -- Verbatim de la 038.
  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.updated_at = now();
      RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TABLE IF NOT EXISTS prospect_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  );
`;

export const readMigration = (repoRoot: string, file: string): string =>
  readFileSync(join(repoRoot, 'supabase/migrations', file), 'utf8');

/** Aplica la 139 REAL, VERBATIM. Si no aplica, el error lleva el SQLSTATE. */
export async function applyContinuationMigration(
  client: PgLikeClient,
  repoRoot: string,
): Promise<void> {
  try {
    await client.query(readMigration(repoRoot, CONTINUATION_MIGRATION));
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'sin SQLSTATE';
    throw new Error(
      `la migración ${CONTINUATION_MIGRATION} NO aplica [${code}]: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ─── Cliente con forma de PostgREST sobre `pg` ────────────────────────────────
//
// 🔴 Lo que esto simula es el TRANSPORTE, no las reglas. Qué columnas se
// escriben, con qué filtros y contra qué RPC lo sigue decidiendo
// `continuation-worker.server.ts`; aquí sólo se traduce la cadena `.from().
// update().eq().eq().select()` a SQL. Si la prueba reimplementara las reglas,
// no probaría nada.

type QueryRunner = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function pgError(err: unknown): { message: string; code?: string } {
  const code = (err as { code?: string }).code;
  return { message: err instanceof Error ? err.message : String(err), ...(code ? { code } : {}) };
}

export function postgrestShim(run: QueryRunner) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const keys = Object.keys(args);
      const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      try {
        const { rows } = await run(`SELECT * FROM ${name}(${params})`, keys.map((k) => args[k]));
        return { data: rows, error: null };
      } catch (err) {
        return { data: null, error: pgError(err) };
      }
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        const keys = Object.keys(row);
        const cols = keys.join(', ');
        const placeholders = keys.map((_k, i) => `$${i + 1}`).join(', ');
        try {
          await run(
            `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`,
            keys.map((k) => (typeof row[k] === 'object' && row[k] !== null ? JSON.stringify(row[k]) : row[k])),
          );
          return { error: null };
        } catch (err) {
          return { error: pgError(err) };
        }
      },
      update: (patch: Record<string, unknown>) => {
        const filters: { column: string; value: unknown }[] = [];
        const builder = {
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return builder;
          },
          async select(_columns?: string) {
            const keys = Object.keys(patch);
            const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
            const where = filters
              .map((f, i) => `${f.column} = $${keys.length + i + 1}`)
              .join(' AND ');
            const values = [
              ...keys.map((k) => (typeof patch[k] === 'object' && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k])),
              ...filters.map((f) => f.value),
            ];
            try {
              const { rows } = await run(
                `UPDATE ${table} SET ${sets} WHERE ${where} RETURNING id`,
                values,
              );
              return { data: rows, error: null };
            } catch (err) {
              return { data: null, error: pgError(err) };
            }
          },
        };
        return builder;
      },
    }),
  };
}
