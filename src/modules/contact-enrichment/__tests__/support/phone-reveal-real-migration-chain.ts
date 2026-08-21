// Agente 2A — LA CADENA REAL DE MIGRACIONES DEL SUBSISTEMA DE TELÉFONO
// (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R2)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Una migración que PostgreSQL no puede aplicar tiene que romper el check obligatorio.
// Antes de R2 no lo rompía: la única barrera dentro del check era un lexer de SQL escrito
// en TypeScript, y ese lexer mide PARIDAD de comillas, no validez sintáctica. El defecto
// real —un apóstrofo sin escapar dentro de un `COMMENT ON TABLE`, que en el head previo
// hacía fallar la 120 con SQLSTATE 42601— deja la paridad INTACTA, porque las comillas
// posteriores del archivo la reequilibran. El lexer pasaba; la migración no aplicaba.
//
// La única prueba que no se puede falsear es ejecutar la migración contra un PostgreSQL
// de verdad. Este módulo es lo que hace que esa prueba sea barata de escribir y, sobre
// todo, IMPOSIBLE de dejar en silencio:
//
//   * publica la cadena MÍNIMA REAL de la que depende la 120, por nombre de archivo, y
//     la aplica leyendo los archivos VERBATIM de `supabase/migrations` — sin recortes,
//     sin slices y sin copiar un solo cuerpo de SQL a un test, que es exactamente la
//     forma en que un arnés deja de medir lo que se despliega;
//   * resuelve el arnés opcional `embedded-postgres` con una política FAIL-CLOSED: en el
//     runner del check obligatorio, que el módulo no resuelva es un FALLO, nunca un skip.
//
// ── POR QUÉ HAY BOOTSTRAP Y NO SE APLICA 001→120 ───────────────────
//
// Porque no se puede, y conviene decirlo con precisión en vez de insinuar que se eligió
// por comodidad: la 002 declara una FK contra `auth.users`, una tabla que PERTENECE a la
// plataforma Supabase y que ninguna migración del repo crea. Aplicar la cadena completa
// sobre un PostgreSQL desnudo falla en la 002 y arrastra el resto por dependencia. Lo
// que este módulo levanta a mano es, por tanto, exactamente el borde AJENO al hito —los
// objetos que la plataforma o migraciones muy anteriores ya garantizan— y nada más. Todo
// lo que la 120 TOCA viene del archivo real.
//
// `contacts_phone_source_check` nace aquí SIN `'apollo_cache'` a propósito: la sección 7
// de la 099 ensancha esa constraint, y un bootstrap que ya la trajera ensanchada dejaría
// ese trozo de migración sin nada que hacer y sin nada que probar.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde `src`
// fuera de las pruebas, no lee un flag, no llama a ningún proveedor y no toca ninguna
// base remota. Los datos que escriben las suites son sintéticos.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Variable de entorno que convierte el skip del arnés en un FALLO. La pone el paso del
 * check obligatorio; en local sigue sin estar, así que quien no tenga el binario de
 * PostgreSQL instalado ve un skip explicado en vez de un test roto.
 */
export const REQUIRE_HARNESS_ENV = 'SELLUP_REQUIRE_POSTGRES_HARNESS';

/** La versión PINCHADA. Toda la serie 17 se publica como pre-release: `@17` da ETARGET. */
export const EMBEDDED_POSTGRES_VERSION = '17.6.0-beta.15';

/**
 * La cadena MÍNIMA REAL de la que depende la 120, en orden de aplicación.
 *
 *   099 — `phone_reveal_cache` y `phone_reveal_suppression_audit`: el modelo LEGADO cuyos
 *         tombstones la 120 respalda, y cuyo `account_id … ON DELETE CASCADE` es la causa
 *         raíz que este hito corrige.
 *   107 — los GRANT/REVOKE del legado. La 120 declara su estado final «espejando» este
 *         archivo, así que compararse contra él sólo significa algo si está aplicado.
 *   109 — `contact_enrichment_candidate_phones` y `…_phone_sources`, la colección que las
 *         funciones restatement de la sección 8 escriben.
 *   110 — `persist_candidate_apollo_phone_reveal_result`.
 *   111 — `persist_candidate_lusha_phone_reveal_result`. La sección 8 de la 120 RE-DECLARA
 *         estas dos enteras: sin ellas aplicadas antes, «restatement» no se está midiendo.
 *   112 — `suppress_candidate_phone_collection`, el camino DSAR sobre la colección.
 *   113 — define `phone_reveal_person_suppression_exists`, la función cuyo CUERPO cambia la
 *         120 conservando nombre y firma (de eso depende #289).
 *   114 — los teléfonos oficiales del contacto y su RLS.
 *   115 — la erasura de esos teléfonos oficiales.
 *   120 — el hito.
 *
 * 116 y 117 quedan FUERA porque la 120 no las nombra ni las re-declara: añadirlas sería
 * decorar la cadena, no reproducirla.
 */
export const PHONE_REVEAL_REAL_CHAIN = [
  '099_apollo_phone_reveal_cache.sql',
  '107_phone_reveal_cache_and_suppression_grants.sql',
  '109_contact_enrichment_candidate_phones.sql',
  '110_persist_candidate_apollo_phone_reveal_result.sql',
  '111_persist_candidate_lusha_phone_reveal_result.sql',
  '112_suppress_candidate_phone_collection.sql',
  '113_phone_reveal_person_suppression_recheck.sql',
  '114_official_contact_phones.sql',
  '115_official_contact_phone_privacy.sql',
  '120_provider_native_phone_suppression.sql',
] as const;

/** El archivo del hito, separado porque las suites lo re-aplican para probar idempotencia. */
export const MIGRATION_120 = '120_provider_native_phone_suppression.sql';

/**
 * `<repo>/supabase/migrations`. El `repoRoot` lo aporta quien llama, como ya hace
 * `phone-person-suppression-recheck-migration.ts`: un módulo de soporte que adivina su
 * propia profundidad se rompe en silencio en cuanto el archivo se mueve de carpeta.
 */
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

  -- Las tablas nuevas tienen que NACER con los 8 privilegios, o el REVOKE de la 107 y de
  -- la 120 no tendría nada que quitar y «se revocó» pasaría sin revocar nada.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

/**
 * El borde AJENO a la cadena: extensiones, `auth.uid()`, `set_updated_at()` (038),
 * `internal_users` + `has_active_access` (002), `accounts` (038), `contacts` (039), la
 * contabilidad del waterfall y el staging de enriquecimiento. Nada de esto lo crea
 * ninguna migración de la cadena bajo prueba.
 */
export const PLATFORM_BOOTSTRAP_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  -- El trigger de updated_at que 099 y 120 enganchan (definido en la 038).
  CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

  CREATE TABLE IF NOT EXISTS public.internal_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id  uuid,
    access_status text NOT NULL DEFAULT 'active'
  );

  CREATE OR REPLACE FUNCTION has_active_access(p_auth_user_id UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS(
      SELECT 1 FROM internal_users
      WHERE auth_user_id = p_auth_user_id AND access_status = 'active');
  $$ LANGUAGE sql STABLE;

  CREATE TABLE IF NOT EXISTS public.accounts (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text
  );

  -- SIN 'apollo_cache' a propósito: la sección 7 de la 099 lo añade, y ese ensanche
  -- tiene que tener algo real que ensanchar.
  CREATE TABLE IF NOT EXISTS public.contacts (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id             uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    full_name              text NOT NULL DEFAULT 'Contacto Sintetico',
    email                  text NULL,
    phone                  text NULL,
    mobile_phone           text NULL,
    phone_type             text NULL,
    phone_source           text NULL,
    phone_raw_type         text NULL,
    phone_revealed_at      timestamptz NULL,
    phone_processing_basis text NULL,
    phone_confidence       text NULL,
    metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contacts_phone_source_check CHECK (
      phone_source IS NULL OR phone_source = ANY (ARRAY[
        'apollo_search','apollo_reveal','lusha_reveal',
        'provider_payload','manual','unknown'])),
    CONSTRAINT contacts_phone_type_check CHECK (
      phone_type IS NULL OR phone_type = ANY (ARRAY[
        'personal_mobile','mobile','direct_dial','work','hq','other','unknown'])),
    CONSTRAINT contacts_phone_confidence_check CHECK (
      phone_confidence IS NULL OR phone_confidence = ANY (ARRAY[
        'unknown','low','medium','high','verified']))
  );

  ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'contacts'
        AND policyname = 'active_users_can_read_contacts'
    ) THEN
      CREATE POLICY "active_users_can_read_contacts" ON public.contacts
        FOR SELECT TO authenticated USING (has_active_access(auth.uid()));
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS public.provider_usage_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE IF NOT EXISTS public.phone_reveal_waterfall_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE IF NOT EXISTS public.phone_reveal_credit_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid());

  CREATE TABLE IF NOT EXISTS public.contact_enrichment_runs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid REFERENCES public.accounts(id)
  );

  CREATE TABLE IF NOT EXISTS public.contact_enrichment_candidates (
    id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrichment_run_id                uuid NOT NULL
      REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
    source                           text,
    source_contact_id                text,
    phone                            text,
    enrichment_metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    phone_reveal_status              text,
    phone_revealed_at                timestamptz,
    phone_revealed_by                uuid,
    phone_reveal_provider            text,
    phone_reveal_error_code          text,
    phone_reveal_cost_credits        integer,
    phone_reveal_cost_source         text,
    phone_processing_basis           text,
    phone_reveal_request_id          text,
    phone_reveal_completed_at        timestamptz,
    phone_reveal_webhook_received_at timestamptz,
    phone_reveal_attempt_count       integer NOT NULL DEFAULT 0,
    phone_reveal_last_checked_at     timestamptz,
    apollo_person_id                 text
  );
`;

/**
 * Cliente mínimo que las suites comparten (el `pg.Client` de `embedded-postgres`).
 * `connect()` está en el tipo porque `getPgClient()` devuelve un cliente SIN conectar:
 * omitirlo obligaba a cada suite a hacer un cast para llamarlo.
 */
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
 * Resuelve `embedded-postgres`.
 *
 * FAIL-CLOSED: si `SELLUP_REQUIRE_POSTGRES_HARNESS` está puesta y el módulo no resuelve,
 * esto LANZA. Es la mitad que faltaba — un arnés que se salta solo cuando falta una
 * dependencia convierte el paso obligatorio en decorativo, y el check se pondría verde
 * con una migración que PostgreSQL no puede aplicar.
 *
 * `resolveFrom` es el `import.meta.url` de la suite que llama, para que `node_modules` se
 * busque desde el árbol del repo y no desde la ubicación de este módulo de soporte.
 *
 * La resolución es SÍNCRONA (`createRequire`, no `await import()`): estos archivos se
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

/** Levanta roles + borde ajeno. No aplica todavía ninguna migración de la cadena. */
export async function bootstrapPlatform(client: PgLikeClient): Promise<void> {
  await client.query(SUPABASE_ROLES_SQL);
  await client.query(PLATFORM_BOOTSTRAP_SQL);
}

/**
 * Aplica la cadena REAL, archivo por archivo y VERBATIM. Si una migración no aplica, el
 * error lleva el nombre del archivo y el SQLSTATE — que es justo el dato que un lexer no
 * puede dar.
 */
export async function applyPhoneRevealRealChain(
  client: PgLikeClient,
  repoRoot: string,
  chain: readonly string[] = PHONE_REVEAL_REAL_CHAIN,
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
