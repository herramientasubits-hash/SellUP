/**
 * AGENT1-CUT3B4 — la atomicidad, contra PostgreSQL 17 REAL y efímero.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La afirmación central de CUT-3B4 es de CONCURRENCIA:
 *
 *     ningún candidato de Agente 1 puede persistirse desde una decisión de
 *     admisión CADUCA
 *
 * y esa afirmación no vive en TypeScript. Vive en un `SELECT … FOR UPDATE` sobre
 * la fila del lote, en el orden exacto entre la comparación de época, el INSERT y
 * el avance, y en que PostgreSQL —bajo READ COMMITTED— re-lea la fila YA
 * actualizada cuando el cerrojo se libera. Un doble en memoria puede devolver
 * `stale` porque se lo pedimos; eso no prueba NADA sobre la base.
 *
 * Aquí compiten DOS SESIONES DE VERDAD, cada una con su transacción.
 *
 * Y una segunda mitad que ninguna suite de TypeScript alcanza:
 *
 *   · que la 126 APLIQUE — una función `plpgsql` con dolar-quoting anidado y dos
 *     `COMMENT ON` multilínea son justo la superficie donde un análisis de
 *     comillas pasa y PostgreSQL falla con 42601;
 *   · que reaplicarla no cambie una fila;
 *   · que la lista de DEFAULTS que la función pre-rellena cubra EXACTAMENTE las
 *     columnas NOT NULL con DEFAULT que el catálogo declara — el ratchet que
 *     impide que una migración futura añada una y la ruta vallada la pierda en
 *     silencio;
 *   · que `anon` no pueda ejecutar ninguna de las dos funciones.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LO QUE NO HACE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No aplica NADA en Producción. No llama a Apollo, Lusha, Tavily ni HubSpot. No
 * lee un flag. No gasta un crédito. Todos los datos son sintéticos.
 *
 * En local se SALTA con motivo explícito si falta el arnés. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:a1-cut3b4-atomicity:postgres
 *
 * En CI el paso obligatorio pone `SELLUP_REQUIRE_POSTGRES_HARNESS`, que convierte
 * el skip en FALLO: una suite que se auto-excluye cuando falta una dependencia
 * dejaría el check verde sobre una migración que PostgreSQL no puede aplicar.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyCut3b4RealChain,
  bootstrapPlatform,
  CUT3B4_MIGRATION,
  readMigration,
  resolveEmbeddedPostgres,
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

let dataDir: string;
let postgres: EmbeddedPostgresLike;
/** Sesión A. */ let a: PgLikeClient;
/** Sesión B — la que compite. */ let b: PgLikeClient;
/** Observador, fuera de las dos transacciones. */ let obs: PgLikeClient;

let batchSeq = 0;

/** Un lote nuevo por prueba: el ámbito de la época es UN lote y hay que probarlo. */
async function newBatch(): Promise<string> {
  batchSeq += 1;
  const { rows } = await obs.query(
    `INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id`,
    [`lote-b4-${batchSeq}`],
  );
  return String(rows[0].id);
}

type FenceOut =
  | { status: 'inserted'; candidate_ids: string[]; inserted_count: number; previous_epoch: number; next_epoch: number }
  | { status: 'stale'; current_epoch: number }
  | { status: 'batch_not_found' }
  | { status: 'invalid_input' };

async function fence(
  client: PgLikeClient,
  batchId: string,
  expectedEpoch: number,
  candidates: Array<Record<string, unknown>>,
): Promise<FenceOut> {
  const { rows } = await client.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
    batchId,
    expectedEpoch,
    JSON.stringify(candidates),
  ]);
  return rows[0].out as FenceOut;
}

async function epochOf(batchId: string): Promise<number> {
  const { rows } = await obs.query(
    `SELECT identity_epoch FROM public.prospect_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows[0].identity_epoch);
}

async function candidateCount(batchId: string): Promise<number> {
  const { rows } = await obs.query(
    `SELECT count(*)::int AS n FROM public.prospect_candidates WHERE batch_id = $1`,
    [batchId],
  );
  return Number(rows[0].n);
}

/** Espera a que la sesión indicada quede BLOQUEADA esperando un cerrojo. */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const { rows } = await obs.query(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail('la llamada vallada nunca esperó el cerrojo: no hay carrera que medir');
}

async function pidOf(client: PgLikeClient): Promise<number> {
  const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
  return Number(rows[0].pid);
}

describe('CUT-3B4 — atomicidad del vallado contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-cut3b4-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54418,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    a = postgres.getPgClient();
    await a.connect();
    b = postgres.getPgClient();
    await b.connect();
    obs = postgres.getPgClient();
    await obs.connect();

    await bootstrapPlatform(a);
    // La cadena REAL, verbatim, archivo por archivo, hasta la 126.
    await applyCut3b4RealChain(a, repoRoot);
  });

  after(async () => {
    if (!EmbeddedPostgresCtor) return;
    await a.end();
    await b.end();
    await obs.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 6 — la migración APLICA, y es idempotente
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 6 — la migración 126', () => {
    it('crea `identity_epoch` NOT NULL con DEFAULT 0', async () => {
      const { rows } = await obs.query(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prospect_batches'
            AND column_name = 'identity_epoch'`,
      );
      assert.equal(rows.length, 1, 'la columna de época no existe');
      assert.equal(rows[0].data_type, 'bigint');
      assert.equal(rows[0].is_nullable, 'NO');
      assert.match(String(rows[0].column_default), /^0/);
    });

    it('🔴 un lote EXISTENTE arranca en la época 0 sin backfill', async () => {
      const batchId = await newBatch();
      assert.equal(await epochOf(batchId), 0);
    });

    it('reaplicarla no cambia una fila', async () => {
      const batchId = await newBatch();
      await fence(obs, batchId, 0, [{ name: 'Antes de reaplicar' }]);
      const before = await candidateCount(batchId);
      const epochBefore = await epochOf(batchId);

      await obs.query(readMigration(repoRoot, CUT3B4_MIGRATION));

      assert.equal(await candidateCount(batchId), before);
      assert.equal(await epochOf(batchId), epochBefore);
    });

    it('🔴 los DEFAULTS que la función pre-rellena cubren EXACTAMENTE el catálogo', async () => {
      // El ratchet. `jsonb_populate_recordset` sobre un registro base NULL deja en
      // NULL todo lo que el payload no traiga, incluidas las columnas NOT NULL que
      // viven de su DEFAULT. Si una migración futura añade una y no la añade a la
      // lista de la 126, la ruta vallada empezaría a fallar —o peor, a perderla en
      // silencio— y esta prueba es lo único que lo dice a tiempo.
      const { rows } = await obs.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prospect_candidates'
            AND is_nullable = 'NO'
            AND column_default IS NOT NULL
          ORDER BY column_name`,
      );
      const catalogue = rows.map((r) => String(r.column_name)).sort();

      const sql = readMigration(repoRoot, CUT3B4_MIGRATION);
      const defaultsBlock = sql.slice(
        sql.indexOf('c_column_defaults CONSTANT jsonb := jsonb_build_object('),
        sql.indexOf('v_now             timestamptz'),
      );
      // La CLAVE es el primer literal de cada línea; el segundo es su VALOR y no
      // puede colarse en la lista ('duplicate_status' → 'unchecked' son dos cosas).
      const prefilled = defaultsBlock
        .split('\n')
        .map((line) => /^\s*'([a-z_]+)',/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name));

      // Las tres que la función FUERZA, en vez de pre-rellenar: dejar que el
      // llamador fijara el `id` convertiría la valla en una sobrescritura.
      const forced = ['id', 'created_at', 'updated_at'];
      const covered = [...prefilled, ...forced].sort();

      assert.deepEqual(
        covered,
        catalogue,
        'la lista de defaults de la 126 se desincronizó del catálogo real',
      );
    });

    it('`anon` no puede ejecutar ninguna de las dos funciones', async () => {
      for (const fn of [
        `${FENCE_FN}(uuid, bigint, jsonb)`,
        `${SNAPSHOT_FN}(uuid, text[])`,
      ]) {
        const { rows } = await obs.query(
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok`,
          [fn],
        );
        assert.equal(rows[0].ok, false, `anon puede ejecutar ${fn}`);
      }
    });

    it('`authenticated` y `service_role` SÍ pueden: son los roles de los tres escritores', async () => {
      for (const role of ['authenticated', 'service_role']) {
        for (const fn of [
          `${FENCE_FN}(uuid, bigint, jsonb)`,
          `${SNAPSHOT_FN}(uuid, text[])`,
        ]) {
          const { rows } = await obs.query(
            `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
            [role, fn],
          );
          assert.equal(rows[0].ok, true, `${role} no puede ejecutar ${fn}`);
        }
      }
    });

    it('🔴 no existe NINGÚN índice único nuevo sobre `prospect_candidates`', async () => {
      // Un `UNIQUE(domain)` sería exactamente la afirmación que TIER 0 niega: dos
      // NITs distintos comparten dominio de grupo legítimamente.
      const { rows } = await obs.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'prospect_candidates'`,
      );
      for (const row of rows) {
        const def = String(row.indexdef).toLowerCase();
        if (!def.includes('unique')) continue;
        assert.match(
          def,
          /\(id\)/,
          `índice único inesperado sobre prospect_candidates: ${def}`,
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 7 — los invariantes transaccionales
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 7 — el contrato transaccional', () => {
    it('éxito ⇒ la fila existe y la época avanza EXACTAMENTE una vez', async () => {
      const batchId = await newBatch();
      const out = await fence(obs, batchId, 0, [{ name: 'Acme', domain: 'acme.com' }]);
      assert.equal(out.status, 'inserted');
      assert.equal(await candidateCount(batchId), 1);
      assert.equal(await epochOf(batchId), 1);
    });

    it('🔴 un bloque de 5 filas avanza la época UNA vez, no cinco', async () => {
      // La época cuenta CAMBIOS del estado de identidad del lote, no filas.
      const batchId = await newBatch();
      const out = await fence(
        obs,
        batchId,
        0,
        Array.from({ length: 5 }, (_, i) => ({ name: `Empresa ${i}` })),
      );
      assert.equal(out.status, 'inserted');
      assert.equal(out.status === 'inserted' ? out.inserted_count : 0, 5);
      assert.equal(await candidateCount(batchId), 5);
      assert.equal(await epochOf(batchId), 1);
    });

    it('🔴 época caduca ⇒ CERO filas, CERO avance', async () => {
      const batchId = await newBatch();
      await fence(obs, batchId, 0, [{ name: 'Primera' }]);

      const out = await fence(obs, batchId, 0, [{ name: 'Con decisión caduca' }]);
      assert.equal(out.status, 'stale');
      assert.equal(out.status === 'stale' ? out.current_epoch : null, 1);
      assert.equal(await candidateCount(batchId), 1, 'la rama stale escribió');
      assert.equal(await epochOf(batchId), 1, 'la rama stale avanzó la época');
    });

    it('🔴 un INSERT que falla revierte TODO: ni fila, ni avance de época', async () => {
      const batchId = await newBatch();
      await fence(obs, batchId, 0, [{ name: 'Legítima' }]);
      const epochBefore = await epochOf(batchId);
      const countBefore = await candidateCount(batchId);

      // `status` fuera del CHECK de la 040: el INSERT tiene que reventar.
      await assert.rejects(
        () => fence(obs, batchId, epochBefore, [{ name: 'Rota', status: 'estado_inexistente' }]),
        'un estado fuera del CHECK tenía que fallar',
      );

      assert.equal(await candidateCount(batchId), countBefore, 'quedó una fila de un INSERT fallido');
      assert.equal(
        await epochOf(batchId),
        epochBefore,
        '🔴 la época avanzó con un INSERT fallido: el estado prohibido por el contrato',
      );
    });

    it('un lote inexistente NO escribe y se distingue de `stale`', async () => {
      const out = await fence(obs, '00000000-0000-4000-8000-000000000000', 0, [{ name: 'X' }]);
      assert.equal(out.status, 'batch_not_found');
    });

    it('una entrada inutilizable NO escribe', async () => {
      const batchId = await newBatch();
      const hostile = [[], [null], ['texto']] as unknown as Array<Array<Record<string, unknown>>>;
      for (const payload of hostile) {
        const out = await fence(obs, batchId, 0, payload);
        assert.equal(out.status, 'invalid_input', JSON.stringify(payload));
      }
      assert.equal(await candidateCount(batchId), 0);
      assert.equal(await epochOf(batchId), 0);
    });

    it('🔴 `batch_id` se FUERZA al lote vallado: no se puede escribir en otro', async () => {
      const mine = await newBatch();
      const other = await newBatch();
      const out = await fence(obs, mine, 0, [{ name: 'Intruso', batch_id: other }]);
      assert.equal(out.status, 'inserted');
      assert.equal(await candidateCount(mine), 1);
      assert.equal(await candidateCount(other), 0, 'la valla escribió en otro lote');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // §§ 12-19/32 — la carrera REAL, con dos sesiones
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 32 — dos sesiones de verdad compitiendo por el mismo lote', () => {
    it('🔴 la sesión que llega con la época vieja recibe `stale` y NO escribe', async () => {
      const batchId = await newBatch();
      const bPid = await pidOf(b);

      // A abre transacción y toma el cerrojo del lote escribiendo bajo la valla.
      await a.query('BEGIN');
      const aOut = await fence(a, batchId, 0, [{ name: 'Ganadora', domain: 'acme.com' }]);
      assert.equal(aOut.status, 'inserted');

      // B arranca con la MISMA época 0 —su decisión se tomó contra la misma foto—
      // y se queda esperando el cerrojo que A retiene.
      const bPending = fence(b, batchId, 0, [{ name: 'Perdedora', domain: 'acme.com' }]);
      await waitUntilBlocked(bPid);

      // A confirma. B se desbloquea y RE-LEE la fila ya actualizada.
      await a.query('COMMIT');

      const bOut = await bPending;
      assert.equal(bOut.status, 'stale', 'la decisión caduca tenía que rechazarse');
      assert.equal(bOut.status === 'stale' ? bOut.current_epoch : null, 1);

      assert.equal(await candidateCount(batchId), 1, 'se escribieron dos filas desde el mismo estado');
      assert.equal(await epochOf(batchId), 1);
    });

    it('🔴 si A revierte, B deja de estar caduca y SÍ escribe', async () => {
      // La simétrica, y no es cosmética: si `stale` se decidiera por algo que no
      // fuera el estado COMMITEADO, una transacción abortada seguiría bloqueando a
      // la siguiente y el lote perdería un candidato legítimo para siempre.
      const batchId = await newBatch();
      const bPid = await pidOf(b);

      await a.query('BEGIN');
      assert.equal((await fence(a, batchId, 0, [{ name: 'Se revierte' }])).status, 'inserted');

      const bPending = fence(b, batchId, 0, [{ name: 'Legítima' }]);
      await waitUntilBlocked(bPid);

      await a.query('ROLLBACK');

      const bOut = await bPending;
      assert.equal(bOut.status, 'inserted', 'una transacción abortada dejó a B caduca');
      assert.equal(await candidateCount(batchId), 1);
      assert.equal(await epochOf(batchId), 1);
    });

    it('🔴 dos empresas DISTINTAS que compiten: una queda caduca, y al reintentar entran las dos', async () => {
      // La serialización no puede convertir a todo segundo candidato concurrente en
      // duplicado: sólo lo obliga a re-decidir contra el estado nuevo.
      const batchId = await newBatch();
      const bPid = await pidOf(b);

      await a.query('BEGIN');
      await fence(a, batchId, 0, [{ name: 'Uno', domain: 'uno.com' }]);
      const bPending = fence(b, batchId, 0, [{ name: 'Dos', domain: 'dos.com' }]);
      await waitUntilBlocked(bPid);
      await a.query('COMMIT');

      const bOut = await bPending;
      assert.equal(bOut.status, 'stale');

      // B recarga la foto (una sentencia: filas Y época del mismo estado), ve que
      // no hay duplicado y reintenta contra la época nueva.
      const { rows } = await b.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [batchId, BLOCKING]);
      const snap = rows[0].out as { identity_epoch: number; rows: Array<{ domain: string | null }> };
      assert.equal(Number(snap.identity_epoch), 1);
      assert.deepEqual(snap.rows.map((r) => r.domain), ['uno.com']);

      const retry = await fence(b, batchId, Number(snap.identity_epoch), [
        { name: 'Dos', domain: 'dos.com' },
      ]);
      assert.equal(retry.status, 'inserted');
      assert.equal(await candidateCount(batchId), 2, 'las dos empresas distintas tienen que entrar');
      assert.equal(await epochOf(batchId), 2);
    });

    it('🔴 la época es POR LOTE: la actividad del lote A no caduca al lote B', async () => {
      const batchA = await newBatch();
      const batchB = await newBatch();

      assert.equal((await fence(obs, batchA, 0, [{ name: 'En A' }])).status, 'inserted');
      // El lote B sigue en la época 0 y su decisión de época 0 sigue siendo válida.
      assert.equal((await fence(obs, batchB, 0, [{ name: 'En B' }])).status, 'inserted');

      assert.equal(await epochOf(batchA), 1);
      assert.equal(await epochOf(batchB), 1);
      assert.equal(await candidateCount(batchA), 1);
      assert.equal(await candidateCount(batchB), 1);
    });

    it('dos reintentos caducos seguidos y luego éxito ⇒ EXACTAMENTE una fila', async () => {
      const batchId = await newBatch();
      await fence(obs, batchId, 0, [{ name: 'Otro escritor 1' }]);
      await fence(obs, batchId, 1, [{ name: 'Otro escritor 2' }]);

      assert.equal((await fence(obs, batchId, 0, [{ name: 'Mía' }])).status, 'stale');
      assert.equal((await fence(obs, batchId, 1, [{ name: 'Mía' }])).status, 'stale');
      assert.equal((await fence(obs, batchId, 2, [{ name: 'Mía' }])).status, 'inserted');

      const { rows } = await obs.query(
        `SELECT count(*)::int AS n FROM public.prospect_candidates
          WHERE batch_id = $1 AND name = 'Mía'`,
        [batchId],
      );
      assert.equal(Number(rows[0].n), 1, 'los reintentos caducos dejaron filas');
      assert.equal(await epochOf(batchId), 3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // § 9 — la foto es COHERENTE
  // ═══════════════════════════════════════════════════════════════════════

  describe('§ 9 — filas y época del MISMO estado', () => {
    it('la foto devuelve la época y las filas ocupantes en una sola sentencia', async () => {
      const batchId = await newBatch();
      await fence(obs, batchId, 0, [{ name: 'Ocupa', status: 'needs_review' }]);

      const { rows } = await obs.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [batchId, BLOCKING]);
      const snap = rows[0].out as { identity_epoch: number; rows: Array<Record<string, unknown>> };
      assert.equal(Number(snap.identity_epoch), 1);
      assert.equal(snap.rows.length, 1);
      assert.equal(snap.rows[0].name, 'Ocupa');
    });

    it('🔴 los estados que OCUPAN el lote los decide TypeScript, no el SQL', async () => {
      // `discarded` no bloquea: es un RESULTADO de revisión sobre una fila que ya
      // perdió su sitio. Que la lista viaje como parámetro es lo que impide que la
      // base tenga una segunda opinión sobre eso.
      const batchId = await newBatch();
      await fence(obs, batchId, 0, [{ name: 'Descartada', status: 'discarded' }]);

      const { rows } = await obs.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [batchId, BLOCKING]);
      const snap = rows[0].out as { rows: unknown[] };
      assert.equal(snap.rows.length, 0, 'una fila descartada no puede ocupar el lote');

      // Y con OTRA lista, la misma fila sí aparece: la autoridad es el parámetro.
      const { rows: rows2 } = await obs.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [
        batchId,
        ['discarded'],
      ]);
      assert.equal((rows2[0].out as { rows: unknown[] }).rows.length, 1);
    });

    it('un lote inexistente devuelve NULL, que NO es un lote vacío', async () => {
      const { rows } = await obs.query(`SELECT ${SNAPSHOT_FN}($1, $2) AS out`, [
        '00000000-0000-4000-8000-000000000000',
        BLOCKING,
      ]);
      assert.equal(rows[0].out, null);
    });
  });
});
