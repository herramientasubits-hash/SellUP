// Agente 1 — LA CADENA REAL DE MIGRACIONES DEL PRESUPUESTO DEL WIZARD
// (AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Lo que la migración 121 afirma no se puede comprobar leyendo SQL. Sus tres
// afirmaciones centrales son de COMPORTAMIENTO:
//
//   1. que una reserva con `credits_consumed > credits_reserved` sea RECHAZADA
//      mientras está viva y ACEPTADA una vez confirmada — eso sólo se demuestra
//      intentando el INSERT/UPDATE y recibiendo (o no) un 23514;
//   2. que el período registre el gasto real COMPLETO y no un recorte a la reserva
//      — que es una resta que hay que ver hecha, no leída;
//   3. que la corrida SIGUIENTE quede bloqueada cuando el período se pasa —lo que
//      exige ejecutar `try_reserve_wizard_credits` de verdad contra el período ya
//      sobregirado, porque el bloqueo lo produce la ARITMÉTICA del paso 10 y no
//      ninguna constraint que un diff pueda mostrar.
//
// Y una cuarta, la que el defecto original demuestra que hace falta: que la 121
// APLIQUE. El lexer de comillas que el repo ya tiene mide PARIDAD, no sintaxis
// (véase `phone-reveal-real-migration-chain.ts`), así que un archivo inaplicable
// puede pasar una suite estática entera.
//
// ── POR QUÉ HAY BOOTSTRAP Y NO SE APLICA 001→121 ───────────────────
//
// Por lo mismo que en la cadena de teléfono, y conviene decirlo con precisión en vez
// de insinuar que se eligió por comodidad: la 002 declara una FK contra `auth.users`,
// una tabla que PERTENECE a la plataforma Supabase y que ninguna migración del repo
// crea. Aplicar la cadena completa sobre un PostgreSQL desnudo falla en la 002.
//
// Lo que se levanta a mano es EXACTAMENTE el borde ajeno al hito: los tres roles de
// Supabase, `set_updated_at()` (038), `internal_users` (002) y `prospect_batches`
// (los únicos objetos que la 064 referencia y que no crea). Todo lo que la 121 TOCA
// —las cuatro tablas del presupuesto y las tres RPC— viene de los archivos REALES,
// leídos verbatim de `supabase/migrations`.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde
// `src` fuera de las pruebas, no lee un flag, no llama a ningún proveedor, no toca
// Producción ni ninguna base remota y no gasta un crédito. Los datos son sintéticos.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Variable que convierte el skip del arnés en FALLO. La pone el check obligatorio. */
export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';

/** Versión PINCHADA. Toda la serie 17 se publica como pre-release: `@17` da ETARGET. */
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';

/**
 * La cadena REAL del presupuesto del wizard, en orden de aplicación.
 *
 *   064 — crea `wizard_pilot_settings`, `wizard_pilot_participants`,
 *         `wizard_monthly_budget_periods` y `wizard_budget_reservations`, con la
 *         constraint `…_consumed_le_reserved` que la 121 reemplaza y con las tres
 *         RPC (`try_reserve_wizard_credits`, `confirm_wizard_credits`,
 *         `release_wizard_credits`). Es la ÚNICA migración del repo que declara
 *         estos objetos: ninguna otra los altera.
 *   121 — el hito.
 *
 * Ninguna migración intermedia entra: entre la 064 y la 121 no hay ni una que
 * nombre estas cuatro tablas (100 y 104 sólo las mencionan en comentarios).
 * Añadirlas sería decorar la cadena, no reproducirla.
 */
export const WIZARD_BUDGET_REAL_CHAIN = [
  '064_wizard_pilot_guardrails.sql',
  '121_wizard_budget_overage_reconciliation.sql',
] as const;

/** El archivo del hito, separado porque la suite lo re-aplica para probar idempotencia. */
export const MIGRATION_121 = '121_wizard_budget_overage_reconciliation.sql';

/** El archivo que la 121 corrige, separado porque la suite lo aplica sin el hito. */
export const MIGRATION_064 = '064_wizard_pilot_guardrails.sql';

export const migrationsDirOf = (repoRoot: string): string =>
  join(repoRoot, 'supabase/migrations');

/** Lee una migración VERBATIM. Nunca se transforma: lo que se prueba es lo que se despliega. */
export const readMigration = (repoRoot: string, file: string): string =>
  readFileSync(join(migrationsDirOf(repoRoot), file), 'utf8');

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

  -- Las funciones nuevas nacen EXECUTE para todos, igual que en Supabase, para que
  -- el REVOKE de la 064 y el de la 121 tengan algo real que quitar.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

/**
 * El borde AJENO a la cadena. Sólo lo que la 064 referencia y no crea:
 * `set_updated_at()` (migración 038), `internal_users` (002) y `prospect_batches`.
 */
export const PLATFORM_BOOTSTRAP_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- El trigger de updated_at que las cuatro tablas de la 064 enganchan (038).
  CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

  CREATE TABLE IF NOT EXISTS public.internal_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id  uuid,
    access_status text NOT NULL DEFAULT 'active'
  );

  -- Sólo se usa como destino de la FK \`wizard_budget_reservations.batch_id\`.
  CREATE TABLE IF NOT EXISTS public.prospect_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
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
 * Con `SELLUP_REQUIRE_POSTGRES_HARNESS` puesta, que el módulo no resuelva LANZA: un
 * arnés que se salta solo cuando falta una dependencia convierte el paso obligatorio
 * en decorativo, y el check se pondría verde con una migración inaplicable.
 *
 * La resolución es SÍNCRONA (`createRequire`, no `await import()`): estos archivos se
 * transpilan a CJS —donde un `await` de nivel superior no compila— y el motivo del
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

/** Levanta roles + borde ajeno. No aplica todavía ninguna migración de la cadena. */
export async function bootstrapPlatform(client: PgLikeClient): Promise<void> {
  await client.query(SUPABASE_ROLES_SQL);
  await client.query(PLATFORM_BOOTSTRAP_SQL);
}

/**
 * Aplica la cadena REAL, archivo por archivo y VERBATIM. Si una migración no aplica,
 * el error lleva el nombre del archivo y el SQLSTATE — que es justo el dato que un
 * lexer de comillas no puede dar.
 */
export async function applyWizardBudgetRealChain(
  client: PgLikeClient,
  repoRoot: string,
  chain: readonly string[] = WIZARD_BUDGET_REAL_CHAIN,
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
