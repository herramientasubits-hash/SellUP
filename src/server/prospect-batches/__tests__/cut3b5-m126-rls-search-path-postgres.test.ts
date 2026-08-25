/**
 * AGENT1-CUT3B5 — la 126 bajo un llamador `authenticated` REAL, con RLS puesta.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ DEFECTO MIDE ESTE ARCHIVO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La 126 se fusionó y NUNCA se aplicó. El preflight de Producción la bloqueó antes
 * de la primera aplicación, y el motivo era reproducible contra Producción:
 *
 *     SET search_path = pg_catalog, pg_temp        ← como se publicó
 *
 * Las dos funciones son `SECURITY INVOKER`, así que corren bajo las políticas RLS
 * del llamador. Esas políticas —las de la 040— invocan `has_active_access(auth.uid())`,
 * y esa función, en Producción, es `SECURITY INVOKER`, con `proconfig = NULL`, y su
 * cuerpo dice `FROM internal_users` SIN CUALIFICAR. El `search_path` restringido se
 * propaga a esa ejecución anidada y PostgreSQL responde:
 *
 *     ERROR:  42P01: relation "internal_users" does not exist
 *     CONTEXT:  SQL function "has_active_access" during inlining
 *
 * La ruta de Lusha (revisión pendiente) escribe con el cliente de SESIÓN, esto es,
 * como `authenticated`. La 126 habría fallado CERRADA —sin corromper nada— y habría
 * detenido esa persistencia. Fallar cerrado no es ser correcto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ NO BASTABA UNA ASERCIÓN ESTÁTICA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Comprobar que la cadena `pg_catalog, public, pg_temp` aparece en el archivo mide
 * el archivo, no el comportamiento. El defecto era de EJECUCIÓN ANIDADA: una
 * función invocando a otra, a través de una política, bajo un rol sin BYPASSRLS.
 * Eso sólo lo dice PostgreSQL.
 *
 * La suite de B4 pasaba en verde con el camino defectuoso por DOS motivos, y los
 * dos se corrigen en el arnés compartido:
 *
 *   1. corría entera como `postgres`, superusuario, que no pasa por RLS;
 *   2. su `has_active_access` escribía `public.internal_users` CUALIFICADO, con lo
 *      que el `search_path` de la función vallada daba igual.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LA PRUEBA EN NEGATIVO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 3 reinstala la 126 con el `search_path` DEFECTUOSO y exige que el escenario se
 * ponga en ROJO con 42P01, y después la restaura y exige VERDE. Sin esa mitad,
 * «esta prueba habría atrapado el defecto» sería una intención, no una medición.
 *
 * 0 proveedores. 0 créditos. 0 escrituras remotas. 0 migraciones en Producción.
 * Todos los datos son sintéticos.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyCut3b4RealChain,
  asAuthenticated,
  bootstrapPlatform,
  CORRECTED_SEARCH_PATH,
  CUT3B4_MIGRATION,
  readMigration,
  REGRESSED_SEARCH_PATH,
  resolveEmbeddedPostgres,
  UNDEFINED_TABLE_SQLSTATE,
  withSearchPath,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/cut3b4-real-migration-chain';
import { BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES } from '@/server/agents/prospecting-toolkit/batch-identity-registry';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → prospect-batches → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

const FENCE_FN = 'public.insert_fenced_prospect_candidates';
const SNAPSHOT_FN = 'public.read_batch_identity_snapshot';
const BLOCKING = [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES];

/** Un usuario ACTIVO y otro que no lo está: el predicado tiene que distinguirlos. */
const ACTIVE_AUTH_UID = '11111111-1111-4111-8111-111111111111';
const INACTIVE_AUTH_UID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_AUTH_UID = '33333333-3333-4333-8333-333333333333';

let dataDir: string;
let postgres: EmbeddedPostgresLike;
/** Sesión administrativa: crea lotes y observa. */ let admin: PgLikeClient;
/** Sesión que adopta el rol `authenticated`. */ let session: PgLikeClient;

let batchSeq = 0;

async function newBatch(): Promise<string> {
  batchSeq += 1;
  const { rows } = await admin.query(
    `INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id`,
    [`lote-b5-${batchSeq}`],
  );
  return String(rows[0].id);
}

async function epochOf(batchId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT identity_epoch FROM public.prospect_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows[0].identity_epoch);
}

async function candidateCount(batchId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.prospect_candidates WHERE batch_id = $1`,
    [batchId],
  );
  return Number(rows[0].n);
}

/** Reinstala la 126 con el `search_path` que se le indique. */
async function reinstallMigration(searchPath: string): Promise<void> {
  const sql = readMigration(repoRoot, CUT3B4_MIGRATION);
  await admin.query(
    searchPath === CORRECTED_SEARCH_PATH ? sql : withSearchPath(sql, searchPath),
  );
}

/**
 * Ejercita el camino COMPLETO de un llamador `authenticated`: foto + inserción
 * vallada. Devuelve el error si lo hubo, en vez de lanzarlo, para que § 3 pueda
 * afirmar sobre el SQLSTATE en lugar de sólo sobre «falló».
 */
async function authenticatedRoundTrip(
  authUserId: string,
): Promise<{ ok: true; snapshot: Record<string, unknown>; fence: Record<string, unknown> } | { ok: false; sqlstate: string; message: string }> {
  const batchId = await newBatch();
  try {
    return await asAuthenticated(session, authUserId, async (c) => {
      const snap = await c.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [batchId, BLOCKING]);
      const fenced = await c.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
        batchId,
        0,
        JSON.stringify([{ name: 'Candidata vallada bajo RLS', batch_id: batchId }]),
      ]);
      return {
        ok: true as const,
        snapshot: snap.rows[0].out as Record<string, unknown>,
        fence: fenced.rows[0].out as Record<string, unknown>,
      };
    });
  } catch (err) {
    return {
      ok: false as const,
      sqlstate: (err as { code?: string }).code ?? 'sin SQLSTATE',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe('CUT-3B5 — la 126 bajo RLS y un llamador `authenticated` real', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-cut3b5-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      // Puerto propio: esta suite puede correr junto a la de B4.
      port: 54419,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    admin = postgres.getPgClient();
    await admin.connect();
    session = postgres.getPgClient();
    await session.connect();

    await bootstrapPlatform(admin);
    await applyCut3b4RealChain(admin, repoRoot);

    // Un usuario ACTIVO y uno INACTIVO, con la forma real de `internal_users`.
    await admin.query(
      `INSERT INTO public.internal_users (auth_user_id, access_status)
       VALUES ($1, 'active'), ($2, 'revoked')`,
      [ACTIVE_AUTH_UID, INACTIVE_AUTH_UID],
    );
  });

  after(async () => {
    if (!EmbeddedPostgresCtor) return;
    await admin.end();
    await session.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 1 — el arnés reproduce Producción, no una maqueta cómoda
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 1 — fidelidad del borde', () => {
    it('🔴 `has_active_access` es SECURITY INVOKER, sin `search_path` fijo y con `internal_users` SIN cualificar', async () => {
      // Las tres propiedades juntas son el defecto. Si el arnés pierde cualquiera de
      // ellas, esta suite deja de poder ver el fallo y se vuelve decorativa.
      const { rows } = await admin.query(
        `SELECT p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS def
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'has_active_access'`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].prosecdef, false, 'has_active_access dejó de ser SECURITY INVOKER');
      assert.equal(rows[0].proconfig, null, 'has_active_access fijó un search_path que Producción no tiene');
      const def = String(rows[0].def);
      assert.match(def, /FROM internal_users/, 'el arnés cualificó internal_users y ya no puede ver el defecto');
      assert.doesNotMatch(def, /FROM public\.internal_users/);
    });

    it('RLS está ACTIVA en las dos tablas valladas, con políticas de `authenticated`', async () => {
      const { rows } = await admin.query(
        `SELECT c.relname, c.relrowsecurity, count(p.polname)::int AS policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_policy p ON p.polrelid = c.oid
          WHERE n.nspname = 'public'
            AND c.relname IN ('prospect_batches', 'prospect_candidates')
          GROUP BY c.relname, c.relrowsecurity
          ORDER BY c.relname`,
      );
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.relrowsecurity, true, `RLS apagada en ${row.relname}`);
        assert.ok(Number(row.policies) > 0, `sin políticas en ${row.relname}`);
      }
    });

    it('🔴 el rol `authenticated` NO tiene BYPASSRLS: las políticas se aplican de verdad', async () => {
      const { rows } = await admin.query(
        `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'authenticated'`,
      );
      assert.equal(rows[0].rolbypassrls, false);
      assert.equal(rows[0].rolsuper, false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 2 — el camino corregido FUNCIONA para `authenticated`
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 2 — el llamador `authenticated` activo', () => {
    it('🔴 puede leer la foto de identidad sin 42P01', async () => {
      const batchId = await newBatch();
      const out = await asAuthenticated(session, ACTIVE_AUTH_UID, async (c) => {
        const { rows } = await c.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [batchId, BLOCKING]);
        return rows[0].out as Record<string, unknown>;
      });
      assert.equal(out.batch_id, batchId);
      assert.equal(Number(out.identity_epoch), 0);
      assert.deepEqual(out.rows, []);
    });

    it('🔴 puede insertar por la ruta VALLADA, y la época avanza exactamente 1', async () => {
      const batchId = await newBatch();
      const out = await asAuthenticated(session, ACTIVE_AUTH_UID, async (c) => {
        const { rows } = await c.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
          batchId,
          0,
          JSON.stringify([{ name: 'Vallada bajo RLS' }, { name: 'Segunda vallada' }]),
        ]);
        return rows[0].out as Record<string, unknown>;
      });
      assert.equal(out.status, 'inserted');
      assert.equal(Number(out.inserted_count), 2);
      assert.equal(await candidateCount(batchId), 2);
      assert.equal(await epochOf(batchId), 1, 'la época no avanzó exactamente una vez');
    });

    it('la semántica `stale` sigue viva bajo RLS: cero filas y cero avance', async () => {
      const batchId = await newBatch();
      await asAuthenticated(session, ACTIVE_AUTH_UID, async (c) => {
        await c.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
          batchId,
          0,
          JSON.stringify([{ name: 'Primera' }]),
        ]);
      });
      const countAfterFirst = await candidateCount(batchId);
      const epochAfterFirst = await epochOf(batchId);

      const stale = await asAuthenticated(session, ACTIVE_AUTH_UID, async (c) => {
        const { rows } = await c.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
          batchId,
          0, // época CADUCA a propósito
          JSON.stringify([{ name: 'Decisión caduca' }]),
        ]);
        return rows[0].out as Record<string, unknown>;
      });

      assert.equal(stale.status, 'stale');
      assert.equal(await candidateCount(batchId), countAfterFirst, 'una decisión caduca escribió');
      assert.equal(await epochOf(batchId), epochAfterFirst, 'una decisión caduca movió la época');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 3 — LA PRUEBA EN NEGATIVO: el camino defectuoso pone esto en ROJO
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 3 — mutación: reintroducir el `search_path` que el preflight bloqueó', () => {
    after(async () => {
      // Restaurar SIEMPRE, pase lo que pase: las secciones siguientes miden el
      // artefacto real, no el mutado.
      await reinstallMigration(CORRECTED_SEARCH_PATH);
    });

    it('🔴 con `pg_catalog, pg_temp` el llamador `authenticated` FALLA con 42P01', async () => {
      await reinstallMigration(REGRESSED_SEARCH_PATH);
      const result = await authenticatedRoundTrip(ACTIVE_AUTH_UID);

      assert.equal(result.ok, false, 'el camino defectuoso NO falló: esta suite no vería el defecto');
      if (result.ok) return;
      assert.equal(
        result.sqlstate,
        UNDEFINED_TABLE_SQLSTATE,
        `se esperaba 42P01 y llegó ${result.sqlstate}: ${result.message}`,
      );
      assert.match(result.message, /internal_users/);
    });

    it('🔴 con `pg_catalog, public, pg_temp` el MISMO escenario pasa a VERDE', async () => {
      await reinstallMigration(CORRECTED_SEARCH_PATH);
      const result = await authenticatedRoundTrip(ACTIVE_AUTH_UID);

      assert.equal(
        result.ok,
        true,
        result.ok ? '' : `el camino corregido falló [${result.sqlstate}]: ${result.message}`,
      );
      if (!result.ok) return;
      assert.equal(result.fence.status, 'inserted');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 4 — la corrección NO abre la puerta a nadie más
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 4 — el privilegio no se movió', () => {
    it('🔴 un usuario INACTIVO no gana acceso: RLS lo deja sin lote que vallar', async () => {
      const batchId = await newBatch();
      const out = await asAuthenticated(session, INACTIVE_AUTH_UID, async (c) => {
        const { rows } = await c.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
          batchId,
          0,
          JSON.stringify([{ name: 'No debería existir' }]),
        ]);
        return rows[0].out as Record<string, unknown>;
      });
      // El `SELECT … FOR UPDATE` del lote pasa por la política de lectura: sin
      // acceso activo, la fila NO es visible y la función responde `batch_not_found`.
      assert.equal(out.status, 'batch_not_found');
      assert.equal(await candidateCount(batchId), 0, 'un usuario inactivo escribió');
      assert.equal(await epochOf(batchId), 0);
    });

    it('un `auth.uid()` DESCONOCIDO tampoco pasa', async () => {
      const batchId = await newBatch();
      const out = await asAuthenticated(session, UNKNOWN_AUTH_UID, async (c) => {
        const { rows } = await c.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
          batchId,
          0,
          JSON.stringify([{ name: 'Tampoco' }]),
        ]);
        return rows[0].out as Record<string, unknown>;
      });
      assert.equal(out.status, 'batch_not_found');
      assert.equal(await candidateCount(batchId), 0);
    });

    it('la ruta `service_role` sigue funcionando', async () => {
      const batchId = await newBatch();
      await admin.query('BEGIN');
      try {
        await admin.query('SET LOCAL ROLE service_role');
        const { rows } = await admin.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
          batchId,
          0,
          JSON.stringify([{ name: 'Desde el cliente administrativo' }]),
        ]);
        assert.equal((rows[0].out as Record<string, unknown>).status, 'inserted');
        await admin.query('COMMIT');
      } catch (err) {
        await admin.query('ROLLBACK');
        throw err;
      }
      assert.equal(await candidateCount(batchId), 1);
      assert.equal(await epochOf(batchId), 1);
    });

    it('🔴 `anon` NO puede ejecutar ninguna de las dos funciones', async () => {
      for (const fn of [
        `${FENCE_FN}(uuid, bigint, jsonb)`,
        `${SNAPSHOT_FN}(uuid, text[])`,
      ]) {
        const { rows } = await admin.query(
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok`,
          [fn],
        );
        assert.equal(rows[0].ok, false, `anon puede ejecutar ${fn}`);
      }
    });

    it('🔴 las dos funciones siguen siendo SECURITY INVOKER en `pg_proc`', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, p.prosecdef
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('read_batch_identity_snapshot', 'insert_fenced_prospect_candidates')
          ORDER BY p.proname`,
      );
      assert.equal(rows.length, 2, 'faltan funciones del corte');
      for (const row of rows) {
        assert.equal(row.prosecdef, false, `${row.proname} se volvió SECURITY DEFINER`);
      }
    });

    it('🔴 el `search_path` REAL en el catálogo es exactamente `pg_catalog, public, pg_temp`', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, p.proconfig
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('read_batch_identity_snapshot', 'insert_fenced_prospect_candidates')
          ORDER BY p.proname`,
      );
      assert.equal(rows.length, 2);
      for (const row of rows) {
        const config = (row.proconfig as string[] | null) ?? [];
        assert.deepEqual(
          config,
          [`search_path=${CORRECTED_SEARCH_PATH}`],
          `${row.proname} no declara el search_path corregido`,
        );
        // `pg_catalog` PRIMERO: la precedencia del catálogo no es negociable.
        const path = config[0].slice('search_path='.length).split(',').map((s) => s.trim());
        assert.equal(path[0], 'pg_catalog', `${row.proname}: pg_catalog no va primero`);
        assert.ok(
          path.indexOf('pg_catalog') < path.indexOf('public'),
          `${row.proname}: public precede a pg_catalog`,
        );
      }
    });

    it('🔴 `authenticated` y `anon` NO pueden CREAR en `public`: la siembra queda cerrada', async () => {
      // Ésta es la razón por la que admitir `public` en el camino es aceptable. Si
      // un día alguien concediera CREATE, esta prueba lo dice antes que nadie.
      for (const role of ['authenticated', 'anon']) {
        const { rows } = await admin.query(
          `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
          [role],
        );
        assert.equal(rows[0].can_create, false, `${role} puede CREAR en public`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 5 — la recarga de la caché de esquema de PostgREST
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 5 — NOTIFY pgrst', () => {
    it('🔴 aplicar la 126 emite `reload schema` en el canal `pgrst`', async () => {
      // Prueba de EJECUCIÓN, no de texto: una sesión escucha, la otra aplica.
      // `pg` entrega la notificación por evento; se espera con un plazo acotado y,
      // si no llega, la prueba lo dice en vez de colgarse.
      const listener = postgres.getPgClient();
      await listener.connect();
      try {
        const received: Array<{ channel: string; payload: string }> = [];
        const raw = listener as unknown as {
          on?: (event: string, cb: (msg: { channel: string; payload: string }) => void) => void;
        };
        if (typeof raw.on !== 'function') {
          assert.fail('el cliente del arnés no expone `on`: no se puede probar LISTEN en ejecución');
        }
        raw.on('notification', (msg) => received.push(msg));
        await listener.query('LISTEN pgrst');

        await admin.query(readMigration(repoRoot, CUT3B4_MIGRATION));

        for (let i = 0; i < 100 && received.length === 0; i += 1) {
          // `pg` procesa las notificaciones al hacer I/O; un ping barato basta.
          await listener.query('SELECT 1');
          if (received.length > 0) break;
          await new Promise((r) => setTimeout(r, 25));
        }

        assert.ok(received.length > 0, 'aplicar la 126 no notificó nada en el canal `pgrst`');
        assert.equal(received[0].channel, 'pgrst');
        assert.equal(received[0].payload, 'reload schema');
      } finally {
        await listener.end();
      }
    });
  });
});
