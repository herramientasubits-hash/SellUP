// BR-SOURCE CUT A.1 — LA CADENA REAL DE RECONCILIACIÓN DE IDENTIDAD DE `source_company_snapshots`
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Lo que las migraciones 125 y 127 afirman no se puede comprobar leyendo SQL:
//
//   * que 125 detecte, sin tocar una fila, si el modelo genérico de `record_identity_key` YA
//     existe (forma de Producción) o si todavía hay que construirlo (forma derivada del repo) —
//     eso es una rama de un bloque `DO $$ ... $$` que sólo se demuestra ejecutándola dos veces,
//     contra dos esquemas de partida distintos, y viendo que ninguna termina mutando una fila;
//   * que la verificación fail-closed RECHACE de verdad una fila no-BR con `record_identity_key
//     IS NULL` o un duplicado bajo la tupla canónica — eso es un `RAISE EXCEPTION` que hay que
//     provocar, no una cadena que un grep pueda confirmar;
//   * que 127, aplicada DESPUÉS de 125, siga aceptando NULL para Brasil sin que la unicidad
//     genérica de 125 la contradiga — eso es una interacción entre dos migraciones que sólo
//     PostgreSQL puede arbitrar;
//   * que 127 sea estructuralmente INDEPENDIENTE de la 126 (AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY,
//     que reclamó ese número mientras esta reconciliación seguía en revisión): la cadena PATH B
//     aplica 125 y 127 con la 126 intencionalmente AUSENTE, y tiene que aplicar igual de bien.
//
// ── POR QUÉ HAY BOOTSTRAP Y NO SE APLICA 001→127 ───────────────────
//
// La 002 declara una FK contra `auth.users`, que pertenece a la plataforma Supabase y que
// ninguna migración del repo crea. Lo que se levanta a mano es EXACTAMENTE el borde ajeno a esta
// cadena: los tres roles de Supabase y la extensión `pgcrypto` que `gen_random_uuid()` necesita.
// La 065 no referencia ninguna otra tabla ajena. El PATH A (que incluye la 126) reutiliza en su
// lugar el borde ajeno YA levantado por el arnés real de AGENT1-CUT3B4
// (`cut3b4-real-migration-chain.ts`), que declara `prospect_batches`/`prospect_candidates` con
// sus tipos reales — no se reconstruye un segundo borde ajeno para la misma tabla.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde `src` fuera
// de las pruebas, no lee un flag, no llama a ningún proveedor, no toca Producción ni ninguna base
// remota. Los datos son sintéticos.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  bootstrapPlatform as bootstrapCut3b4Platform,
  CUT3B4_MIGRATION,
} from '../../../prospect-batches/__tests__/support/cut3b4-real-migration-chain';

/** Variable que convierte el skip del arnés en FALLO. La pone el check obligatorio. */
export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';

/** Versión PINCHADA. Toda la serie 17 se publica como pre-release: `@17` da ETARGET. */
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';

/**
 * PATH B — la cadena REAL derivada de la historia del repositorio ("Schema B" del owner
 * decision), con AGENT1-CUT3B4 (126) intencionalmente AUSENTE: 065 crea la tabla con la UNIQUE
 * vieja sobre `normalized_tax_id`; 087 añade `record_identity_key` nullable con su CHECK NOT
 * VALID; 125 reconcilia el modelo genérico; 127 añade la identidad mensual de Brasil. Ninguna
 * migración intermedia (088–124, 126) declara ni altera `source_company_snapshots` — el barrido
 * está hecho, no supuesto. Que esta cadena aplique igual de bien SIN la 126 es la prueba de que
 * Brasil no depende de ella.
 */
export const REPO_DERIVED_REAL_CHAIN = [
  '065_create_source_snapshot_tables.sql',
  '087_add_record_identity_key_to_source_company_snapshots.sql',
  '125_reconcile_source_snapshot_record_identity.sql',
  '127_br_receita_monthly_snapshot_identity.sql',
] as const;

/**
 * PATH A — el orden COMPLETO del repositorio, incluida la 126 (AGENT1-CUT3B4). Reutiliza la
 * cadena real de `prospect_batches`/`prospect_candidates` que ese corte ya construyó y verificó
 * (040→108), intercalada en orden numérico con la cadena de snapshots de fuente. Que este orden
 * aplique de principio a fin es la prueba de que la 127 no rompe nada que la 126 ya construyó, y
 * viceversa.
 */
export const FULL_REPO_ORDER_CHAIN = [
  '040_prospect_batches_foundation.sql',
  '045_extend_prospect_candidates_for_structured_sources.sql',
  '048_allow_denue_mexico_source.sql',
  '051_allow_datos_gob_cl_source.sql',
  '052_allow_external_import_source.sql',
  '061_add_import_catalog_classification.sql',
  '065_create_source_snapshot_tables.sql',
  '087_add_record_identity_key_to_source_company_snapshots.sql',
  '092_add_identity_key_to_prospect_candidates.sql',
  '093_add_record_origin_classification_to_prospect_candidates.sql',
  '105_repair_prospect_candidates_identity_key.sql',
  '108_add_prospect_candidates_linkedin_url.sql',
  '125_reconcile_source_snapshot_record_identity.sql',
  CUT3B4_MIGRATION,
  '127_br_receita_monthly_snapshot_identity.sql',
] as const;

export const MIGRATION_065 = '065_create_source_snapshot_tables.sql';
export const MIGRATION_087 = '087_add_record_identity_key_to_source_company_snapshots.sql';
export const MIGRATION_125 = '125_reconcile_source_snapshot_record_identity.sql';
/** AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY. Independent of Brazil; see FULL_REPO_ORDER_CHAIN. */
export const MIGRATION_126_AGENT1 = CUT3B4_MIGRATION;
export const MIGRATION_127 = '127_br_receita_monthly_snapshot_identity.sql';

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
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
`;

/** El único borde ajeno a esta cadena: la extensión que respalda `gen_random_uuid()`. */
export const PLATFORM_BOOTSTRAP_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
 * Resuelve `embedded-postgres` con política FAIL-CLOSED. Ver
 * `wizard-budget-real-migration-chain.ts` — misma técnica, mismo motivo: la resolución es
 * SÍNCRONA (`createRequire`) porque estos archivos se transpilan a CJS y el motivo del skip tiene
 * que existir ANTES de que `describe()` decida si corre.
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

/** Levanta roles + el único borde ajeno. No aplica todavía ninguna migración de la cadena. */
export async function bootstrapPlatform(client: PgLikeClient): Promise<void> {
  await client.query(SUPABASE_ROLES_SQL);
  await client.query(PLATFORM_BOOTSTRAP_SQL);
}

/**
 * Levanta el borde ajeno para PATH A (`FULL_REPO_ORDER_CHAIN`), que incluye la 040 y por tanto
 * necesita el borde que AGENT1-CUT3B4 ya construyó y verificó para `prospect_batches` /
 * `prospect_candidates` — `auth.uid()`, `internal_users`, `accounts`, `agent_runs`, el catálogo de
 * industrias mínimo y `has_active_access()`. Reutiliza esa función en vez de reconstruir un
 * segundo borde ajeno para la misma tabla.
 */
export async function bootstrapFullOrderPlatform(client: PgLikeClient): Promise<void> {
  await bootstrapCut3b4Platform(client);
}

/**
 * Aplica una cadena de migraciones, archivo por archivo y VERBATIM. Si una no aplica, el error
 * lleva el nombre del archivo y el SQLSTATE.
 */
export async function applyRealChain(
  client: PgLikeClient,
  repoRoot: string,
  chain: readonly string[],
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

/**
 * FIXTURE B — la forma SINTÉTICA de Producción ("Schema A" del owner decision), construida
 * DIRECTAMENTE (no por migraciones: esa cadena no existe en el repositorio) para reproducir SÓLO
 * los hechos que el owner confirmó de Producción:
 *
 *   · `record_identity_key` es físicamente NOT NULL (`pg_attribute.attnotnull = true`), no sólo un
 *     CHECK — CUT A.2 descubrió que Producción tiene AMBOS y que la versión anterior de esta
 *     fixture sólo reproducía el CHECK, dejando sin probar el paso que la 125 le debía a la
 *     columna misma;
 *   · la UNIQUE canónica sobre `record_identity_key` YA existe, con el nombre exacto que
 *     Producción usa;
 *   · el CHECK global `record_identity_key IS NOT NULL` YA existe, también con su nombre exacto;
 *   · la UNIQUE vieja sobre `normalized_tax_id` está AUSENTE;
 *   · hay valores duplicados de `normalized_tax_id` bajo la tupla vieja (152 grupos en
 *     Producción; aquí, sintéticamente, dos filas comparten uno);
 *   · los valores de `record_identity_key` son ÚNICOS (la propia UNIQUE canónica ya lo exige);
 *   · algunos `normalized_tax_id` son NULL (18 en Producción; aquí, sintéticamente, una fila);
 *   · CERO filas de Brasil.
 *
 * Ninguna fila viene de Producción: la forma es sintética, los valores son sintéticos.
 */
export async function buildProdShapeFixture(client: PgLikeClient): Promise<void> {
  await client.query(`
    -- Migration 127 alters this table too (source_period, publish_state), so Fixture B needs it
    -- to exist in its pre-127 shape — exactly migration 065's original definition.
    CREATE TABLE public.source_snapshot_runs (
      id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
      source_key       text        NOT NULL,
      country_code     text        NOT NULL,
      status           text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      started_at       timestamptz,
      completed_at     timestamptz,
      source_year      int,
      records_found    int         DEFAULT 0,
      records_upserted int         DEFAULT 0,
      error_message    text,
      metadata         jsonb       DEFAULT '{}'::jsonb,
      created_at       timestamptz DEFAULT now()
    );

    CREATE TABLE public.source_company_snapshots (
      id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
      source_key            text        NOT NULL,
      country_code          text        NOT NULL,
      source_year           int         NOT NULL,
      tax_id                text,
      legal_name            text,
      normalized_tax_id     text,
      normalized_legal_name text,
      sector                text,
      city                  text,
      department            text,
      region                text,
      priority_score        numeric     DEFAULT 0,
      signals               jsonb       DEFAULT '{}'::jsonb,
      financials            jsonb       DEFAULT '{}'::jsonb,
      raw_data              jsonb       DEFAULT '{}'::jsonb,
      imported_at           timestamptz DEFAULT now(),
      record_identity_key   text        NOT NULL
    );

    ALTER TABLE public.source_company_snapshots
      ADD CONSTRAINT source_company_snapshots_cn1_record_identity_key
      UNIQUE (source_key, country_code, source_year, record_identity_key);

    ALTER TABLE public.source_company_snapshots
      ADD CONSTRAINT source_company_snapshots_record_identity_key_not_null_chk
      CHECK (record_identity_key IS NOT NULL);

    -- El índice de lectura no-único de la 065 sí sobrevivió al corte fuera de banda.
    CREATE INDEX idx_source_company_snapshots_normalized_tax_id
      ON public.source_company_snapshots (source_key, normalized_tax_id);
  `);

  // Dos filas no-BR comparten normalized_tax_id bajo la tupla VIEJA (source_key, country_code,
  // source_year, normalized_tax_id) — la UNIQUE canónica nueva las distingue porque sus
  // record_identity_key son distintos.
  await client.query(`
    INSERT INTO public.source_company_snapshots
      (source_key, country_code, source_year, tax_id, normalized_tax_id, record_identity_key)
    VALUES
      ('co_siis', 'CO', 2026, NULL, '900123456', 'co_siis:900123456:est-a'),
      ('co_siis', 'CO', 2026, NULL, '900123456', 'co_siis:900123456:est-b'),
      -- Una fila con normalized_tax_id NULL (18 así en Producción).
      ('ec_scvs', 'EC', 2026, NULL, NULL, 'ec_scvs:root:0001')
  `);
}

/** Cuenta de filas en `source_company_snapshots`, para probar que una migración no mutó ninguna. */
export async function countSnapshotRows(client: PgLikeClient): Promise<number> {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM public.source_company_snapshots');
  return Number(rows[0].n);
}
