/**
 * Verificación de la migración 120 contra un PostgreSQL REAL y efímero
 * (Agente 2A · AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4, Fase 1)
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE (y por qué la suite estática no basta)
 * ═══════════════════════════════════════════════════════════════════
 *
 * La afirmación central de este hito es que una supresión SOBREVIVE al borrado de la
 * cuenta. Eso no se puede demostrar leyendo el SQL: hay que crear la cuenta, crear la
 * supresión, BORRAR la cuenta y volver a mirar. La razón por la que hay que hacerlo de
 * verdad es que el modelo ANTERIOR fallaba exactamente ahí y nadie lo vio en un diff —
 * `phone_reveal_cache.account_id` y `phone_reveal_suppression_audit.account_id` son
 * ambos `REFERENCES accounts(id) ON DELETE CASCADE`, así que borrar una cuenta ERASABA
 * la erasura, tombstone y auditoría juntos.
 *
 * Lo mismo vale para el resto:
 *
 *   * que la clave única sea (provider, provider_person_id) y NO incluya cuenta sólo se
 *     comprueba de verdad intentando insertar el duplicado y recibiendo un 23505;
 *   * que los CHECK rechacen un proveedor fuera de la allowlist, un id en blanco o un
 *     motivo inventado, igual;
 *   * que `GRANT` haya dejado el estado esperado se responde con `has_table_privilege`,
 *     no con `information_schema`: Supabase concede los 8 privilegios por DEFAULT
 *     PRIVILEGES y `GRANT` sólo SUMA, así que un archivo que «concede tres privilegios»
 *     puede dejar DELETE intacto sin que se note en el texto;
 *   * y el backfill idempotente exige aplicar la migración DOS veces y comparar filas.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6; este arnés: `embedded-postgres@17.6.0-beta.15`);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la plataforma —
 *     que es justo lo que hace que la RLS NO sea la capa que protege estas tablas de él;
 *   * `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES`, para que las tablas nuevas
 *     NAZCAN con los 8 privilegios y el REVOKE de la 120 tenga algo que quitar;
 *   * un esqueleto MÍNIMO de `accounts` e `internal_users` (sólo lo que las FK de la 120
 *     y de la 099 necesitan) más la parte de `phone_reveal_cache` que el backfill lee.
 *     No se aplica la cadena completa de migraciones porque la 099 arrastra media docena
 *     de tablas ajenas al hito; lo que se reproduce con exactitud es lo que la 120 TOCA.
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción: no se leyó, ni se copió, ni se
 * inspeccionó un teléfono real para construir estos fixtures. La 120 no tiene columna de
 * teléfono, así que aquí no hay ningún número que escribir — y eso es parte de lo que se
 * comprueba.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito:
 * descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio, que no necesita esta suite. Si el módulo no está resuelto, el archivo se
 * SALTA con un motivo explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:provider-native-suppression:postgres
 *
 * ⚠️ La versión va PINCHADA y con `-beta`: TODA la serie 17 de `embedded-postgres` se
 * publica como pre-release, así que `embedded-postgres@17` NO resuelve (`ETARGET`).
 * 17.6.0-beta.15 coincide además con el PostgreSQL 17.6 de Producción.
 *
 * No llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase/migrations');
const MIGRATION_FILE = '120_provider_native_phone_suppression.sql';

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

const UNAUTHORIZED_ROLES = ['anon', 'authenticated'] as const;

/**
 * Las dos tablas de la 120 con la lista EXACTA que `service_role` debe conservar.
 * La asimetría es el contenido del hito:
 *   * la supresión necesita INSERT y UPDATE (el upsert reafirma) y NO DELETE — borrar la
 *     fila borraría el bloqueo, la única operación que este subsistema nunca debe poder
 *     hacer;
 *   * la auditoría es append-and-read: un log que su propio escritor puede reescribir o
 *     borrar no es evidencia.
 */
const TABLES = [
  { name: 'provider_suppressions', aclExpected: ['INSERT', 'SELECT', 'UPDATE'] },
  { name: 'provider_suppression_audit', aclExpected: ['INSERT', 'SELECT'] },
] as const;

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

const ACCOUNT_A = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT_B = '00000000-0000-4000-8000-0000000000a2';
const USER_A = '00000000-0000-4000-8000-0000000000b1';

const APOLLO_ID = '0123456789abcdef01234567';
const LUSHA_ID = 'v1.eyJhIjoiYiIsImMiOiJkIn0';

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

let EmbeddedPostgresCtor:
  | (new (options: Record<string, unknown>) => EmbeddedPostgresLike)
  | null = null;
let harnessSkipReason: string | false = false;

/**
 * Resolución SÍNCRONA con `createRequire`, no con `await import()`: este archivo se
 * transpila a CJS, donde un `await` de nivel superior no compila, y la razón del skip
 * tiene que estar disponible ANTES de que `describe()` decida si corre.
 */
try {
  const require = createRequire(import.meta.url);
  const mod = require('embedded-postgres') as {
    default?: new (options: Record<string, unknown>) => EmbeddedPostgresLike;
  };
  const ctor =
    mod.default ??
    (mod as unknown as new (o: Record<string, unknown>) => EmbeddedPostgresLike);
  if (typeof ctor !== 'function') {
    harnessSkipReason = 'embedded-postgres resolvió sin constructor utilizable';
  } else {
    EmbeddedPostgresCtor = ctor;
  }
} catch {
  harnessSkipReason =
    'embedded-postgres no está instalado (arnés opcional a propósito: `npm install --no-save embedded-postgres@17.6.0-beta.15`)';
}

let client: PgLikeClient;
let postgres: EmbeddedPostgresLike;
let dataDir = '';

const readMigration = (file: string) => readFileSync(join(migrationsDir, file), 'utf8');
const applyMigration = async (file: string) => {
  await client.query(readMigration(file));
};
const apply120 = () => applyMigration(MIGRATION_FILE);

const scalar = async <T>(sql: string): Promise<T> => {
  const { rows } = await client.query(sql);
  return Object.values(rows[0])[0] as T;
};

const rows = async (sql: string) => (await client.query(sql)).rows;

/** Ejecuta y devuelve el SQLSTATE si falla, o null si tuvo éxito. */
const errorCodeOf = async (sql: string): Promise<string | null> => {
  try {
    await client.query(sql);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
};

const privilegesOfRole = async (role: string, table: string) => {
  const columns = TABLE_PRIVILEGES.map(
    (privilege) =>
      `has_table_privilege('${role}', 'public.${table}', '${privilege}') AS "${privilege}"`,
  ).join(', ');
  const { rows: r } = await client.query(`SELECT ${columns}`);
  return r[0] as Record<string, boolean>;
};

/**
 * Esqueleto mínimo: sólo lo que las FK de la 120 exigen y lo que su backfill LEE. No es
 * la cadena completa de migraciones a propósito — la 099 arrastra tablas ajenas al hito y
 * lo que aquí importa es exactamente lo que la 120 toca.
 */
const BOOTSTRAP_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- El trigger de updated_at que la 120 engancha (definido en 038 en el repo real).
  CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END $$;

  CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );

  CREATE TABLE IF NOT EXISTS public.internal_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );

  -- Sólo las columnas de la 099 que el backfill de la 120 lee, con la MISMA
  -- unicidad (provider, provider_person_id, account_id) y la MISMA cascada
  -- ON DELETE CASCADE desde accounts — que es justo lo que hacía que el modelo
  -- legado no sobreviviera al borrado de la cuenta.
  CREATE TABLE IF NOT EXISTS public.phone_reveal_cache (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           text NOT NULL DEFAULT 'apollo'
      CONSTRAINT phone_reveal_cache_provider_check CHECK (provider IN ('apollo')),
    provider_person_id text NOT NULL,
    account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    suppressed_at      timestamptz NULL,
    suppression_reason text NULL,
    suppressed_by      uuid NULL REFERENCES public.internal_users(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS phone_reveal_cache_provider_person_account_key
    ON public.phone_reveal_cache (provider, provider_person_id, account_id);
`;

/** Roles y DEFAULT PRIVILEGES de Supabase, para que el REVOKE de la 120 tenga qué quitar. */
const SUPABASE_ROLES_SQL = `
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

const seedFixtures = async () => {
  await client.query(`
    INSERT INTO public.accounts (id) VALUES ('${ACCOUNT_A}'), ('${ACCOUNT_B}')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.internal_users (id) VALUES ('${USER_A}')
      ON CONFLICT DO NOTHING;
  `);
};

describe('120 — supresión nativa del proveedor contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pg-provider-suppression-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54329 + Math.floor(process.pid % 100),
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await (client as unknown as { connect: () => Promise<void> }).connect();
    await client.query(SUPABASE_ROLES_SQL);
    await client.query(BOOTSTRAP_SQL);
    await seedFixtures();
  });

  after(async () => {
    try {
      await client?.end();
    } catch {
      /* el cliente puede haber muerto con el servidor */
    }
    try {
      await postgres?.stop();
    } finally {
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // § 1. La migración aplica, y aplica dos veces
  // ═══════════════════════════════════════════════════════════════

  describe('§1 — aplicación e idempotencia', () => {
    it('la 120 aplica limpiamente sobre el esqueleto', async () => {
      await apply120();
      assert.equal(
        await scalar<string>(
          `SELECT to_regclass('public.provider_suppressions')::text`,
        ),
        'provider_suppressions',
      );
      assert.equal(
        await scalar<string>(
          `SELECT to_regclass('public.provider_suppression_audit')::text`,
        ),
        'provider_suppression_audit',
      );
    });

    it('re-aplicarla NO falla y NO cambia ninguna fila (idempotencia)', async () => {
      await client.query(`
        INSERT INTO public.provider_suppressions
          (provider, provider_person_id, suppressed_at, suppression_reason, suppressed_by)
        VALUES ('apollo', '${APOLLO_ID}', now(), 'dsar_erasure_request', '${USER_A}')
        ON CONFLICT DO NOTHING;
      `);
      const before = await scalar<string>(
        `SELECT md5(string_agg(t::text, '|' ORDER BY t.id::text))
           FROM public.provider_suppressions t`,
      );
      const auditBefore = await scalar<string>(
        `SELECT count(*)::text FROM public.provider_suppression_audit`,
      );

      await apply120();
      await apply120();

      assert.equal(
        await scalar<string>(
          `SELECT md5(string_agg(t::text, '|' ORDER BY t.id::text))
             FROM public.provider_suppressions t`,
        ),
        before,
        'la re-aplicación no puede tocar una fila',
      );
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppression_audit`,
        ),
        auditBefore,
      );
    });

    it('el trigger de updated_at está enganchado', async () => {
      assert.equal(
        await scalar<string>(`
          SELECT count(*)::text FROM pg_trigger
          WHERE tgrelid = 'public.provider_suppressions'::regclass
            AND tgname = 'provider_suppressions_set_updated_at'
        `),
        '1',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // § 2. La clave única — y la ausencia de cuenta en ella
  // ═══════════════════════════════════════════════════════════════

  describe('§2 — clave única (provider, provider_person_id), SIN cuenta', () => {
    it('la tabla NO tiene columna account_id', async () => {
      assert.equal(
        await scalar<string>(`
          SELECT count(*)::text FROM information_schema.columns
          WHERE table_schema='public' AND table_name='provider_suppressions'
            AND column_name LIKE '%account%'
        `),
        '0',
      );
    });

    it('no hay NINGUNA FK desde provider_suppressions hacia accounts', async () => {
      assert.equal(
        await scalar<string>(`
          SELECT count(*)::text
          FROM pg_constraint c
          WHERE c.conrelid = 'public.provider_suppressions'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'public.accounts'::regclass
        `),
        '0',
      );
    });

    it('no hay NINGUNA FK desde provider_suppression_audit hacia accounts', async () => {
      assert.equal(
        await scalar<string>(`
          SELECT count(*)::text
          FROM pg_constraint c
          WHERE c.conrelid = 'public.provider_suppression_audit'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'public.accounts'::regclass
        `),
        '0',
      );
    });

    it('la única FK de cada tabla es a internal_users, y es SET NULL', async () => {
      for (const table of ['provider_suppressions', 'provider_suppression_audit']) {
        const fks = await rows(`
          SELECT c.confrelid::regclass::text AS target, c.confdeltype AS del
          FROM pg_constraint c
          WHERE c.conrelid = 'public.${table}'::regclass AND c.contype = 'f'
        `);
        assert.equal(fks.length, 1, `${table} debe tener exactamente una FK`);
        assert.equal(fks[0].target, 'internal_users');
        // 'n' = SET NULL, 'c' = CASCADE. Tiene que ser 'n'.
        assert.equal(fks[0].del, 'n', `${table}: la FK no puede cascadear`);
      }
    });

    it('el duplicado de (provider, person) es 23505 — la cuenta no lo desambigua', async () => {
      assert.equal(
        await errorCodeOf(`
          INSERT INTO public.provider_suppressions
            (provider, provider_person_id, suppressed_at, suppression_reason)
          VALUES ('apollo', '${APOLLO_ID}', now(), 'legal_privacy_request')
        `),
        UNIQUE_VIOLATION,
      );
    });

    it('la MISMA persona en OTRO proveedor sí es otra fila (espacios de nombres distintos)', async () => {
      assert.equal(
        await errorCodeOf(`
          INSERT INTO public.provider_suppressions
            (provider, provider_person_id, suppressed_at, suppression_reason)
          VALUES ('lusha', '${APOLLO_ID}', now(), 'legal_privacy_request')
        `),
        null,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // § 3. Los CHECK
  // ═══════════════════════════════════════════════════════════════

  describe('§3 — CHECK: allowlist de proveedor, id no vacío, motivo cerrado', () => {
    it('un proveedor fuera de la allowlist se rechaza', async () => {
      for (const provider of ['hubspot', 'APOLLO', 'zoominfo', '']) {
        assert.equal(
          await errorCodeOf(`
            INSERT INTO public.provider_suppressions
              (provider, provider_person_id, suppressed_at, suppression_reason)
            VALUES ('${provider}', 'x-${provider}', now(), 'legal_privacy_request')
          `),
          CHECK_VIOLATION,
          `'${provider}' no debería admitirse`,
        );
      }
    });

    it('un provider_person_id vacío o en blanco se rechaza', async () => {
      for (const id of ['', '   ']) {
        assert.equal(
          await errorCodeOf(`
            INSERT INTO public.provider_suppressions
              (provider, provider_person_id, suppressed_at, suppression_reason)
            VALUES ('apollo', '${id}', now(), 'legal_privacy_request')
          `),
          CHECK_VIOLATION,
        );
      }
    });

    it('un motivo fuera del vocabulario cerrado se rechaza (nunca texto libre)', async () => {
      assert.equal(
        await errorCodeOf(`
          INSERT INTO public.provider_suppressions
            (provider, provider_person_id, suppressed_at, suppression_reason)
          VALUES ('apollo', 'motivo-libre', now(), 'porque lo pidió Juan por teléfono')
        `),
        CHECK_VIOLATION,
      );
    });

    it('los cinco motivos de la allowlist se admiten', async () => {
      const reasons = [
        'dsar_erasure_request',
        'do_not_contact_request',
        'legal_privacy_request',
        'admin_privacy_correction',
        'test_synthetic',
      ];
      for (const reason of reasons) {
        assert.equal(
          await errorCodeOf(`
            INSERT INTO public.provider_suppressions
              (provider, provider_person_id, suppressed_at, suppression_reason)
            VALUES ('apollo', 'reason-${reason}', now(), '${reason}')
          `),
          null,
          `${reason} debería admitirse`,
        );
      }
    });

    it('la auditoría exige un hash SHA-256 hex de 64 y rechaza cualquier otra cosa', async () => {
      assert.equal(
        await errorCodeOf(`
          INSERT INTO public.provider_suppression_audit
            (provider, provider_person_id_hash, operation, result, reason_code, origin)
          VALUES ('apollo', '${APOLLO_ID}', 'suppression_created', 'applied',
                  'dsar_erasure_request', 'dsar_action')
        `),
        CHECK_VIOLATION,
        'un id crudo no puede pasar por hash',
      );
      assert.equal(
        await errorCodeOf(`
          INSERT INTO public.provider_suppression_audit
            (provider, provider_person_id_hash, operation, result, reason_code, origin)
          VALUES ('apollo', encode(sha256(convert_to('${APOLLO_ID}','UTF8')),'hex'),
                  'suppression_created', 'applied', 'dsar_erasure_request', 'dsar_action')
        `),
        null,
      );
    });

    it('la auditoría cierra también operation, result y origin', async () => {
      const hash = `encode(sha256(convert_to('x','UTF8')),'hex')`;
      const cases: [string, string][] = [
        ['operation', `('apollo', ${hash}, 'inventada', 'applied', 'dsar_erasure_request', 'dsar_action')`],
        ['result', `('apollo', ${hash}, 'suppression_created', 'quizas', 'dsar_erasure_request', 'dsar_action')`],
        ['origin', `('apollo', ${hash}, 'suppression_created', 'applied', 'dsar_erasure_request', 'a_mano')`],
      ];
      for (const [label, values] of cases) {
        assert.equal(
          await errorCodeOf(`
            INSERT INTO public.provider_suppression_audit
              (provider, provider_person_id_hash, operation, result, reason_code, origin)
            VALUES ${values}
          `),
          CHECK_VIOLATION,
          `${label} debe estar cerrado`,
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // § 4. LA prueba del hito: sobrevivir al borrado de la cuenta
  // ═══════════════════════════════════════════════════════════════

  describe('§4 — la supresión y su auditoría SOBREVIVEN al borrado de la cuenta', () => {
    const SURVIVOR = 'aaaabbbbccccddddeeeeffff';

    it('crear cuenta → crear supresión + auditoría → BORRAR cuenta → ambas siguen ahí', async () => {
      // 1. Una cuenta que va a desaparecer, con una fila LEGADA que la referencia.
      await client.query(`
        INSERT INTO public.phone_reveal_cache
          (provider, provider_person_id, account_id, suppressed_at, suppression_reason, suppressed_by)
        VALUES ('apollo', '${SURVIVOR}', '${ACCOUNT_B}', now(), 'dsar_erasure_request', '${USER_A}');
      `);

      // 2. La supresión NUEVA para la misma persona, sin cuenta en ninguna parte.
      await client.query(`
        INSERT INTO public.provider_suppressions
          (provider, provider_person_id, suppressed_at, suppression_reason, suppressed_by)
        VALUES ('apollo', '${SURVIVOR}', now(), 'dsar_erasure_request', '${USER_A}');
        INSERT INTO public.provider_suppression_audit
          (provider, provider_person_id_hash, operation, result, reason_code, origin, actor_user_id)
        VALUES ('apollo', encode(sha256(convert_to('${SURVIVOR}','UTF8')),'hex'),
                'suppression_created', 'applied', 'dsar_erasure_request', 'dsar_action', '${USER_A}');
      `);

      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.phone_reveal_cache
             WHERE provider_person_id = '${SURVIVOR}'`,
        ),
        '1',
      );

      // 3. Se borra la cuenta.
      await client.query(`DELETE FROM public.accounts WHERE id = '${ACCOUNT_B}'`);

      // 4. El modelo LEGADO desapareció con ella — ése era el defecto.
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.phone_reveal_cache
             WHERE provider_person_id = '${SURVIVOR}'`,
        ),
        '0',
        'la cascada legada borra el tombstone: es exactamente el riesgo que la 120 cierra',
      );

      // 5. Y el modelo NUEVO sigue en pie, con su evidencia.
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppressions
             WHERE provider = 'apollo' AND provider_person_id = '${SURVIVOR}'`,
        ),
        '1',
        'la supresión nativa DEBE sobrevivir al borrado de la cuenta',
      );
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppression_audit
             WHERE provider_person_id_hash =
                   encode(sha256(convert_to('${SURVIVOR}','UTF8')),'hex')`,
        ),
        '1',
        'la auditoría nativa DEBE sobrevivir al borrado de la cuenta',
      );

      // 6. Y el helper SQL sigue diciendo «suprimida» sin cuenta que ofrecerle.
      assert.equal(
        await scalar<boolean>(
          `SELECT public.provider_suppression_exists('apollo', '${SURVIVOR}')`,
        ),
        true,
      );
    });

    it('borrar el usuario actor no borra la supresión: pone el actor a NULL', async () => {
      await client.query(`DELETE FROM public.internal_users WHERE id = '${USER_A}'`);
      const r = await rows(`
        SELECT suppressed_by FROM public.provider_suppressions
        WHERE provider_person_id = '${SURVIVOR}'
      `);
      assert.equal(r.length, 1, 'la supresión sigue existiendo');
      assert.equal(r[0].suppressed_by, null);
      // Y la evidencia igual.
      const a = await rows(`
        SELECT actor_user_id FROM public.provider_suppression_audit
        WHERE provider_person_id_hash =
              encode(sha256(convert_to('${SURVIVOR}','UTF8')),'hex')
      `);
      assert.equal(a.length, 1);
      assert.equal(a[0].actor_user_id, null);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // § 5. El helper transaccional aprende el modelo nuevo
  // ═══════════════════════════════════════════════════════════════

  describe('§5 — phone_reveal_person_suppression_exists: OR de los dos modelos', () => {
    const ONLY_NEW = '1111111111111111aaaaaaaa';
    const ONLY_LEGACY = '2222222222222222bbbbbbbb';
    const NEITHER = '3333333333333333cccccccc';

    before(async () => {
      await client.query(`
        INSERT INTO public.provider_suppressions
          (provider, provider_person_id, suppressed_at, suppression_reason)
        VALUES ('apollo', '${ONLY_NEW}', now(), 'dsar_erasure_request')
        ON CONFLICT DO NOTHING;
        INSERT INTO public.phone_reveal_cache
          (provider, provider_person_id, account_id, suppressed_at, suppression_reason)
        VALUES ('apollo', '${ONLY_LEGACY}', '${ACCOUNT_A}', now(), 'dsar_erasure_request')
        ON CONFLICT DO NOTHING;
      `);
    });

    it('sólo el modelo NUEVO ⇒ true, y con la cuenta NULA (lo que antes era imposible)', async () => {
      assert.equal(
        await scalar<boolean>(
          `SELECT public.phone_reveal_person_suppression_exists('${ONLY_NEW}', NULL)`,
        ),
        true,
      );
      // Y también con una cuenta que nada tiene que ver.
      assert.equal(
        await scalar<boolean>(
          `SELECT public.phone_reveal_person_suppression_exists('${ONLY_NEW}', '${ACCOUNT_A}')`,
        ),
        true,
      );
    });

    it('sólo el modelo LEGADO ⇒ true cuando se aporta SU cuenta (compat preservada)', async () => {
      assert.equal(
        await scalar<boolean>(
          `SELECT public.phone_reveal_person_suppression_exists('${ONLY_LEGACY}', '${ACCOUNT_A}')`,
        ),
        true,
        'un clear del nuevo no puede sobrescribir un suppressed del legado',
      );
    });

    it('el legado NO se puede evaluar sin cuenta, y su ausencia NO bloquea por sí sola', async () => {
      assert.equal(
        await scalar<boolean>(
          `SELECT public.phone_reveal_person_suppression_exists('${ONLY_LEGACY}', NULL)`,
        ),
        false,
        'sin cuenta el legado se OMITE: no se convierte en bloqueo ni en error',
      );
    });

    it('ninguno de los dos ⇒ false', async () => {
      for (const account of ['NULL', `'${ACCOUNT_A}'`]) {
        assert.equal(
          await scalar<boolean>(
            `SELECT public.phone_reveal_person_suppression_exists('${NEITHER}', ${account})`,
          ),
          false,
        );
      }
    });

    // R1 restató 110/111 para cablear el re-chequeo nativo de Lusha en el call site. La
    // FIRMA de este helper sigue siendo la misma a propósito: #289 la nombra, y cambiarla
    // volvería a hacer de "sin cuenta" un "sin privacidad".
    it('la firma sigue siendo (text, uuid), que es de lo que depende #289', async () => {
      assert.equal(
        await scalar<string>(`
          SELECT pg_get_function_identity_arguments(p.oid)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname='phone_reveal_person_suppression_exists'
        `),
        'p_provider_person_id text, p_account_id uuid',
      );
    });

    it('el helper nuevo toma (text, text) y NO acepta cuenta', async () => {
      assert.equal(
        await scalar<string>(`
          SELECT pg_get_function_identity_arguments(p.oid)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname='provider_suppression_exists'
        `),
        'p_provider text, p_provider_person_id text',
      );
    });

    it('un id de LUSHA se resuelve en su propio espacio de nombres', async () => {
      await client.query(`
        INSERT INTO public.provider_suppressions
          (provider, provider_person_id, suppressed_at, suppression_reason)
        VALUES ('lusha', '${LUSHA_ID}', now(), 'dsar_erasure_request')
        ON CONFLICT DO NOTHING;
      `);
      assert.equal(
        await scalar<boolean>(
          `SELECT public.provider_suppression_exists('lusha', '${LUSHA_ID}')`,
        ),
        true,
      );
      // Y NO se filtra al espacio de Apollo: ése es el límite declarado de la Fase 1.
      assert.equal(
        await scalar<boolean>(
          `SELECT public.provider_suppression_exists('apollo', '${LUSHA_ID}')`,
        ),
        false,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // § 6. Backfill del tombstone legado
  // ═══════════════════════════════════════════════════════════════

  describe('§6 — backfill legado: real, idempotente y no destructivo', () => {
    const BF_1 = '4444444444444444dddddddd';
    const BF_2 = '5555555555555555eeeeeeee';

    it('copia los tombstones legados que aún no estaban en el modelo nuevo', async () => {
      // Dos cuentas, MISMA persona: el legado tiene dos filas, el nuevo debe tener UNA.
      const accountC = '00000000-0000-4000-8000-0000000000a3';
      await client.query(`
        INSERT INTO public.accounts (id) VALUES ('${accountC}') ON CONFLICT DO NOTHING;
        INSERT INTO public.phone_reveal_cache
          (provider, provider_person_id, account_id, suppressed_at, suppression_reason)
        VALUES
          ('apollo', '${BF_1}', '${ACCOUNT_A}', '2026-01-02T00:00:00Z', 'legal_privacy_request'),
          ('apollo', '${BF_1}', '${accountC}',  '2026-01-01T00:00:00Z', 'legal_privacy_request'),
          -- Una fila ACTIVA (sin tombstone): NO debe copiarse.
          ('apollo', '${BF_2}', '${ACCOUNT_A}', NULL, NULL);
      `);

      const auditBefore = Number(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppression_audit
             WHERE origin = 'legacy_backfill'`,
        ),
      );

      await apply120();

      const copied = await rows(`
        SELECT provider, provider_person_id, suppressed_at, suppression_reason
        FROM public.provider_suppressions WHERE provider_person_id = '${BF_1}'
      `);
      assert.equal(copied.length, 1, 'N tombstones por cuenta colapsan en UNA supresión');
      assert.equal(copied[0].provider, 'apollo');
      assert.equal(
        new Date(copied[0].suppressed_at as string).toISOString(),
        '2026-01-01T00:00:00.000Z',
        'gana el suppressed_at MÁS ANTIGUO: el derecho se ejerció entonces',
      );

      // La fila activa NO se copió: no era una supresión.
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppressions
             WHERE provider_person_id = '${BF_2}'`,
        ),
        '0',
      );

      // Y quedó evidencia marcada como backfill.
      const auditAfter = Number(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppression_audit
             WHERE origin = 'legacy_backfill'`,
        ),
      );
      assert.ok(
        auditAfter > auditBefore,
        'el backfill tiene que dejar su propia evidencia durable',
      );
    });

    it('el backfill es IDEMPOTENTE: la segunda pasada copia 0 y audita 0', async () => {
      const suppressions = await scalar<string>(
        `SELECT count(*)::text FROM public.provider_suppressions`,
      );
      const audits = await scalar<string>(
        `SELECT count(*)::text FROM public.provider_suppression_audit
           WHERE origin = 'legacy_backfill'`,
      );

      await apply120();
      await apply120();

      assert.equal(
        await scalar<string>(`SELECT count(*)::text FROM public.provider_suppressions`),
        suppressions,
      );
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.provider_suppression_audit
             WHERE origin = 'legacy_backfill'`,
        ),
        audits,
        'una auditoría movida por un SELECT sobre el legado se duplicaría en cada pasada',
      );
    });

    it('NO borra ni modifica el tombstone legado (aditivo primero)', async () => {
      assert.equal(
        await scalar<string>(
          `SELECT count(*)::text FROM public.phone_reveal_cache
             WHERE provider_person_id = '${BF_1}' AND suppressed_at IS NOT NULL`,
        ),
        '2',
        'las dos filas legadas siguen intactas',
      );
      // Y las columnas del tombstone legado siguen existiendo.
      for (const column of ['suppressed_at', 'suppression_reason', 'suppressed_by']) {
        assert.equal(
          await scalar<string>(`
            SELECT count(*)::text FROM information_schema.columns
            WHERE table_schema='public' AND table_name='phone_reveal_cache'
              AND column_name='${column}'
          `),
          '1',
          `la 120 no puede soltar ${column}`,
        );
      }
    });

    it('el hash de la auditoría del backfill coincide con el que escribe TypeScript', async () => {
      // `hashProviderPersonId` en phone-cache-store.ts es SHA-256 hex del id. La 120 usa
      // el `sha256()` built-in en vez de `pgcrypto.digest()` — que en Supabase vive en el
      // esquema `extensions` y no resolvería sin más. Los dos tienen que dar lo mismo.
      const { createHash } = await import('node:crypto');
      const expected = createHash('sha256').update(BF_1).digest('hex');
      assert.equal(
        await scalar<string>(`
          SELECT provider_person_id_hash FROM public.provider_suppression_audit
          WHERE origin = 'legacy_backfill'
            AND provider_person_id_hash =
                encode(sha256(convert_to('${BF_1}','UTF8')),'hex')
        `),
        expected,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // § 7. GRANTS y RLS
  // ═══════════════════════════════════════════════════════════════

  describe('§7 — privilegios: el estado final es el que la 120 declara', () => {
    it('anon y authenticated no conservan NI UNO de los 8 privilegios', async () => {
      for (const { name } of TABLES) {
        for (const role of UNAUTHORIZED_ROLES) {
          const privileges = await privilegesOfRole(role, name);
          for (const privilege of TABLE_PRIVILEGES) {
            assert.equal(
              privileges[privilege],
              false,
              `${role} conserva ${privilege} sobre ${name}`,
            );
          }
        }
      }
    });

    it('PUBLIC tampoco conserva ninguno', async () => {
      for (const { name } of TABLES) {
        const privileges = await privilegesOfRole('public', name);
        for (const privilege of TABLE_PRIVILEGES) {
          assert.equal(privileges[privilege], false, `PUBLIC conserva ${privilege}`);
        }
      }
    });

    it('service_role conserva EXACTAMENTE la lista de cada tabla', async () => {
      for (const { name, aclExpected } of TABLES) {
        const privileges = await privilegesOfRole('service_role', name);
        const granted = TABLE_PRIVILEGES.filter((p) => privileges[p]).sort();
        assert.deepEqual([...granted], [...aclExpected].sort(), `${name}`);
      }
    });

    it('service_role NO puede borrar una supresión (el bloqueo no se puede desbloquear)', async () => {
      const privileges = await privilegesOfRole('service_role', 'provider_suppressions');
      assert.equal(privileges.DELETE, false);
      assert.equal(privileges.TRUNCATE, false);
    });

    it('service_role NO puede reescribir ni borrar la auditoría (append-and-read)', async () => {
      const privileges = await privilegesOfRole(
        'service_role',
        'provider_suppression_audit',
      );
      assert.equal(privileges.UPDATE, false);
      assert.equal(privileges.DELETE, false);
      assert.equal(privileges.TRUNCATE, false);
    });

    it('CONTRATO REAL con SET ROLE: anon/authenticated reciben 42501', async () => {
      for (const { name } of TABLES) {
        for (const role of UNAUTHORIZED_ROLES) {
          for (const statement of [
            `SELECT 1 FROM public.${name} LIMIT 1`,
            `DELETE FROM public.${name}`,
            `TRUNCATE public.${name}`,
          ]) {
            await client.query(`SET ROLE ${role}`);
            const code = await errorCodeOf(statement);
            await client.query('RESET ROLE');
            assert.equal(
              code,
              INSUFFICIENT_PRIVILEGE,
              `${role} debería recibir 42501 en: ${statement}`,
            );
          }
        }
      }
    });

    it('CONTRATO REAL: service_role puede lo concedido y NO lo negado', async () => {
      await client.query('SET ROLE service_role');
      const canSelect = await errorCodeOf(
        `SELECT 1 FROM public.provider_suppressions LIMIT 1`,
      );
      const canInsertAudit = await errorCodeOf(`
        INSERT INTO public.provider_suppression_audit
          (provider, provider_person_id_hash, operation, result, reason_code, origin)
        VALUES ('lusha', encode(sha256(convert_to('svc','UTF8')),'hex'),
                'suppression_created', 'applied', 'test_synthetic', 'dsar_action')
      `);
      const cannotDelete = await errorCodeOf(`DELETE FROM public.provider_suppressions`);
      const cannotUpdateAudit = await errorCodeOf(
        `UPDATE public.provider_suppression_audit SET result = 'failed'`,
      );
      await client.query('RESET ROLE');

      assert.equal(canSelect, null);
      assert.equal(canInsertAudit, null);
      assert.equal(cannotDelete, INSUFFICIENT_PRIVILEGE);
      assert.equal(cannotUpdateAudit, INSUFFICIENT_PRIVILEGE);
    });

    it('la RLS queda activada, NO forzada, con una sola política de service_role', async () => {
      for (const { name } of TABLES) {
        const r = await rows(`
          SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname='public' AND c.relname='${name}'
        `);
        assert.equal(r[0].enabled, true, `${name}: RLS debe estar activada`);
        assert.equal(r[0].forced, false, `${name}: RLS no debe estar forzada`);

        const policies = await rows(`
          SELECT policyname, roles::text AS roles FROM pg_policies
          WHERE schemaname='public' AND tablename='${name}'
        `);
        assert.equal(policies.length, 1, `${name}: una sola política`);
        assert.match(String(policies[0].roles), /service_role/);
      }
    });
  });
});
