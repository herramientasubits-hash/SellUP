/**
 * AGENT1-LUSHA-CUT-L3 § 22 — la valla durable contra un PostgreSQL REAL y efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE (y por qué la suite en memoria no basta)
 * ═══════════════════════════════════════════════════════════════════
 *
 * La afirmación central del corte es de CONCURRENCIA y de DURABILIDAD:
 *
 *     dos trabajadores sobre la MISMA petición lógica ⇒ UNO gana el reclamo
 *     y el otro NO puede llamar al proveedor.
 *
 * Eso no lo decide TypeScript: lo decide una PRIMARY KEY con `ON CONFLICT DO
 * NOTHING` y un `GET DIAGNOSTICS ROW_COUNT`. Un doble en memoria puede modelar la
 * regla; sólo PostgreSQL puede demostrar que la migración la implementa. Aquí se
 * lanzan las dos transacciones de verdad y se mira cuál pierde.
 *
 * Y una segunda mitad que ninguna suite estática alcanza: que la 134 APLIQUE
 * —tres funciones `plpgsql` con dolar-quoting nombrado y un `COMMENT ON TABLE`
 * son justo la superficie donde un lexer de comillas pasa y PostgreSQL falla con
 * 42601—, que los GRANT dejen `anon` y `authenticated` sin nada, y que
 * reaplicarla no cambie una sola fila.
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción. No hay teléfono, ni email,
 * ni nombre de empresa: la tabla no tiene dónde ponerlos, y eso es parte de lo
 * que se comprueba.
 *
 * En local se SALTA con motivo explícito si falta el arnés. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:a1-lusha-cut-l3-fence:postgres
 *
 * No llama a Lusha, ni a Apollo, ni a HubSpot; no lee un flag; no toca Producción
 * ni ninguna base remota; no gasta un crédito. MIGRATION 134: APPLIED IN
 * PRODUCTION = NO.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyLushaRequestFenceMigration,
  bootstrapPlatform,
  LUSHA_REQUEST_FENCE_MIGRATION,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/lusha-request-fence-real-migration';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → prospect-batches → server → src → raíz del repo
const repoRoot = join(here, '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

const TABLE = 'public.lusha_prospecting_request_fence';
const OPERATIONS = 'public.lusha_prospecting_operations';
const CLIENT_REQUEST = '11111111-2222-3333-4444-555555555555';
const USER = '00000000-1111-2222-3333-444444444444';
const RESERVATION = '99999999-8888-7777-6666-555555555555';
const ACTOR = `internal_user:${USER}`;
const SIGNATURE = 'a'.repeat(64);

/**
 * 🔴 La identidad DURABLE de la operación, acuñada por la BASE. Se resuelve en el
 * `before` y NO es una constante del archivo: si lo fuera, la suite estaría
 * probando un id inventado en TypeScript en vez del que PostgreSQL genera.
 */
let RUN = '';

const key = (branch: number, page: number) =>
  `lusha_prospecting|v2|${RUN}|b${branch}|p${page}`;

/** Acuña —o reanuda— una operación lógica. Es la puerta económica de la corrida. */
async function claimOperation(
  actor = ACTOR,
  signature = SIGNATURE,
  clientRequestId: string | null = CLIENT_REQUEST,
  conn: PgLikeClient = client,
): Promise<Record<string, unknown>> {
  const { rows } = await conn.query(
    'SELECT public.claim_or_resume_lusha_prospecting_operation($1, $2, $3, $4) AS r',
    [actor, 'v1', signature, clientRequestId],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function completeOperation(
  operationId: string,
  conn: PgLikeClient = client,
): Promise<Record<string, unknown>> {
  const { rows } = await conn.query(
    'SELECT public.complete_lusha_prospecting_operation($1::uuid) AS r',
    [operationId],
  );
  return rows[0]!.r as Record<string, unknown>;
}

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let client: PgLikeClient;

async function claim(
  fenceKey: string,
  branch = 0,
  page = 0,
  conn: PgLikeClient = client,
): Promise<Record<string, unknown>> {
  const { rows } = await conn.query(
    'SELECT public.claim_lusha_prospecting_request($1, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid) AS r',
    [fenceKey, RUN, branch, page, CLIENT_REQUEST, USER, RESERVATION],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function mark(fenceKey: string, conn: PgLikeClient = client) {
  const { rows } = await conn.query(
    'SELECT public.mark_lusha_prospecting_request_dispatched($1) AS r',
    [fenceKey],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function settle(fenceKey: string, state: string, evidence: Record<string, unknown> = {}) {
  const { rows } = await client.query(
    'SELECT public.settle_lusha_prospecting_request($1, $2, $3::jsonb) AS r',
    [fenceKey, state, JSON.stringify(evidence)],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function row(fenceKey: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await client.query(`SELECT * FROM ${TABLE} WHERE fence_key = $1`, [fenceKey]);
  return rows[0];
}

async function reset(): Promise<void> {
  // Lo ejecuta el DUEÑO de las tablas (postgres), no `service_role`, a quien la
  // migración deliberadamente no le concede ni DELETE ni TRUNCATE.
  //
  // La valla se borra ANTES que las operaciones: la FK va en esa dirección y no
  // lleva cascada, justo para que borrar una operación no pueda llevarse por
  // delante la evidencia de gasto de sus peticiones.
  await client.query(`TRUNCATE ${TABLE}`);
  await client.query(`TRUNCATE ${OPERATIONS} CASCADE`);
  // Una valla sólo puede colgar de una operación ABIERTA, así que cada caso
  // arranca con una recién acuñada.
  RUN = (await claimOperation()).operation_id as string;
}

async function expectFailure(sql: string, values?: unknown[]): Promise<string> {
  try {
    await client.query(sql, values);
  } catch (err) {
    return (err as { code?: string }).code ?? 'sin SQLSTATE';
  }
  assert.fail(`se esperaba un fallo y la sentencia pasó: ${sql}`);
}

describe('134 — valla durable de petición Lusha contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pg-lusha-fence-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54730 + Math.floor(process.pid % 100),
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await bootstrapPlatform(client);
    await applyLushaRequestFenceMigration(client, repoRoot);
    // La operación lógica que ampara las vallas de esta suite. La acuña la BASE.
    RUN = (await claimOperation()).operation_id as string;
  });

  after(async () => {
    try {
      await client?.end();
    } finally {
      await postgres?.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // ── § 1. Aplicabilidad e idempotencia ──────────────────────────────────────

  describe('§ 1 — aplicabilidad', () => {
    it('la migración vuelve a aplicar sobre su propio resultado sin tocar filas', async () => {
      await reset();
      await claim(key(0, 0));
      const before = await row(key(0, 0));

      await applyLushaRequestFenceMigration(client, repoRoot, LUSHA_REQUEST_FENCE_MIGRATION);

      const after = await row(key(0, 0));
      assert.equal(after?.state, before?.state, 'no reescribe las filas existentes');
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
      assert.equal(rows[0]!.n, 1, 'no hay backfill: la migración no inventa filas');
    });
  });

  // ── § 2. Reclamo atómico y concurrencia (§ 8, L3-C) ────────────────────────

  describe('§ 2 — reclamo atómico', () => {
    it('L3-B — el primer reclamo gana y deja la fila en `prepared`', async () => {
      await reset();
      const first = await claim(key(0, 0));
      assert.equal(first.status, 'claimed');
      assert.equal((await row(key(0, 0)))?.state, 'prepared');
    });

    it('L3-C — el segundo reclamo de la MISMA petición pierde, con el estado real', async () => {
      await reset();
      await claim(key(0, 0));
      const second = await claim(key(0, 0));
      assert.equal(second.status, 'already_claimed');
      assert.equal(second.state, 'prepared');
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
      assert.equal(rows[0]!.n, 1, 'la unicidad es de la PRIMARY KEY, no de un SELECT previo');
    });

    it('L3-C — dos CONEXIONES concurrentes: exactamente una gana', async () => {
      await reset();
      const other = postgres.getPgClient();
      await other.connect();
      try {
        const [a, b] = await Promise.all([
          claim(key(0, 0), 0, 0, client),
          claim(key(0, 0), 0, 0, other),
        ]);
        const granted = [a, b].filter((r) => r.status === 'claimed');
        const refused = [a, b].filter((r) => r.status === 'already_claimed');
        assert.equal(granted.length, 1, 'sólo un trabajador puede reclamar');
        assert.equal(refused.length, 1);
      } finally {
        await other.end();
      }
    });

    it('L3-L / L3-M — otra página y otra rama son filas DISTINTAS', async () => {
      await reset();
      assert.equal((await claim(key(0, 0), 0, 0)).status, 'claimed');
      assert.equal((await claim(key(0, 1), 0, 1)).status, 'claimed');
      assert.equal((await claim(key(1, 0), 1, 0)).status, 'claimed');
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
      assert.equal(rows[0]!.n, 3);
    });

    it('una entrada inválida no crea fila', async () => {
      await reset();
      const bad = await client.query(
        'SELECT public.claim_lusha_prospecting_request($1, $2, $3, $4) AS r',
        ['', RUN, 0, 0],
      );
      assert.equal((bad.rows[0]!.r as Record<string, unknown>).status, 'invalid_input');
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
      assert.equal(rows[0]!.n, 0);
    });
  });

  // ── § 3. La frontera de despacho (§ 7) ─────────────────────────────────────

  describe('§ 3 — frontera de despacho', () => {
    it('la marca sólo transiciona desde `prepared`, y sella `dispatched_at`', async () => {
      await reset();
      await claim(key(0, 0));
      const marked = await mark(key(0, 0));
      assert.equal(marked.status, 'marked');
      const r = await row(key(0, 0));
      assert.equal(r?.state, 'dispatch_unsafe');
      assert.notEqual(r?.dispatched_at, null);
      assert.equal(r?.settled_at, null);
    });

    it('marcar dos veces la misma petición: la segunda NO puede despachar', async () => {
      await reset();
      await claim(key(0, 0));
      await mark(key(0, 0));
      const again = await mark(key(0, 0));
      assert.equal(again.status, 'not_claimable');
      assert.equal(again.state, 'dispatch_unsafe');
    });

    it('marcar una petición inexistente devuelve `not_claimable`, no crea nada', async () => {
      await reset();
      const ghost = await mark(key(9, 9));
      assert.equal(ghost.status, 'not_claimable');
      assert.equal(ghost.state, null);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
      assert.equal(rows[0]!.n, 0);
    });

    it('marcar una petición YA terminal no la resucita', async () => {
      await reset();
      await claim(key(0, 0));
      await mark(key(0, 0));
      await settle(key(0, 0), 'succeeded');
      const again = await mark(key(0, 0));
      assert.equal(again.status, 'not_claimable');
      assert.equal(again.state, 'succeeded');
    });
  });

  // ── § 4. Liquidación terminal (§ 11) ───────────────────────────────────────

  describe('§ 4 — liquidación', () => {
    it('graba la evidencia de CUT-L2 sin inventar campos', async () => {
      await reset();
      await claim(key(0, 0));
      await mark(key(0, 0));
      const done = await settle(key(0, 0), 'succeeded', {
        outcome_class: 'success',
        billing_certainty: 'settled_from_provider',
        retry_contract: 'do_not_automatically_retry',
        http_status: 200,
        provider_request_id: 'lusha-trace-abc',
        credits_charged: 1,
        results_returned: 25,
        rate_limit_minute_limit: 60,
        rate_limit_minute_remaining: 59,
        rate_limit_daily_limit: 1000,
        rate_limit_daily_remaining: 999,
      });
      assert.equal(done.status, 'settled');
      const r = await row(key(0, 0));
      assert.equal(r?.state, 'succeeded');
      assert.equal(r?.billing_certainty, 'settled_from_provider');
      assert.equal(r?.provider_request_id, 'lusha-trace-abc');
      assert.equal(Number(r?.credits_charged), 1);
      assert.equal(r?.rate_limit_daily_remaining, 999);
      assert.notEqual(r?.settled_at, null);
    });

    it('una clave desconocida en la evidencia se IGNORA: no puede colar payload', async () => {
      await reset();
      await claim(key(0, 0));
      await mark(key(0, 0));
      const done = await settle(key(0, 0), 'indeterminate', {
        company_name: 'Acme SAS',
        raw_response: '{"results":[]}',
        billing_certainty: 'potentially_charged',
      });
      assert.equal(done.status, 'settled');
      const r = await row(key(0, 0));
      assert.equal(r?.billing_certainty, 'potentially_charged');
      assert.equal(Object.prototype.hasOwnProperty.call(r ?? {}, 'company_name'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(r ?? {}, 'raw_response'), false);
    });

    it('una fila YA terminal no se reescribe: la primera liquidación manda', async () => {
      await reset();
      await claim(key(0, 0));
      await mark(key(0, 0));
      await settle(key(0, 0), 'indeterminate', { billing_certainty: 'potentially_charged' });
      const again = await settle(key(0, 0), 'definitely_not_charged', {
        billing_certainty: 'definitely_not_charged',
      });
      assert.equal(again.status, 'already_terminal');
      const r = await row(key(0, 0));
      assert.equal(r?.state, 'indeterminate', 'la incertidumbre NO se degrada a «no cobrado»');
      assert.equal(r?.billing_certainty, 'potentially_charged');
    });

    it('L3-N — desde `prepared` se liquida el rechazo local sin sello de despacho', async () => {
      await reset();
      await claim(key(0, 0));
      const done = await settle(key(0, 0), 'definitely_not_charged', {
        outcome_class: 'local_pre_dispatch_failure',
        billing_certainty: 'definitely_not_charged',
      });
      assert.equal(done.status, 'settled');
      const r = await row(key(0, 0));
      assert.equal(r?.state, 'definitely_not_charged');
      assert.equal(r?.dispatched_at, null, 'nunca se fabrica «pudo salir»');
    });

    it('un ÉXITO sin despacho se RECHAZA: no puede haber respuesta sin envío', async () => {
      await reset();
      await claim(key(0, 0));
      const refused = await settle(key(0, 0), 'succeeded');
      assert.equal(refused.status, 'invalid_transition');
      assert.equal((await row(key(0, 0)))?.state, 'prepared');
    });

    it('un estado desconocido se rechaza en vez de escribirse', async () => {
      await reset();
      await claim(key(0, 0));
      const refused = await settle(key(0, 0), 'probably_fine');
      assert.equal(refused.status, 'invalid_state');
      assert.equal((await row(key(0, 0)))?.state, 'prepared');
    });

    it('liquidar una petición inexistente devuelve `not_found`', async () => {
      await reset();
      assert.equal((await settle(key(7, 7), 'indeterminate')).status, 'not_found');
    });
  });

  // ── § 5. Invariantes del esquema ───────────────────────────────────────────

  describe('§ 5 — invariantes que la tabla defiende por sí sola', () => {
    it('un estado fuera del vocabulario es rechazado por CHECK', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (fence_key, state, operation_id, branch_index, page_index)
         VALUES ($1, 'maybe', $2::uuid, 0, 0)`,
        [key(0, 0), RUN],
      );
      assert.equal(code, '23514');
    });

    it('`succeeded` sin `dispatched_at` es rechazado por CHECK', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (fence_key, state, operation_id, branch_index, page_index, settled_at)
         VALUES ($1, 'succeeded', $2::uuid, 0, 0, now())`,
        [key(0, 0), RUN],
      );
      assert.equal(code, '23514');
    });

    it('`dispatch_unsafe` sin `dispatched_at` es rechazado por CHECK', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (fence_key, state, operation_id, branch_index, page_index)
         VALUES ($1, 'dispatch_unsafe', $2::uuid, 0, 0)`,
        [key(0, 0), RUN],
      );
      assert.equal(code, '23514');
    });

    it('la misma `fence_key` dos veces es rechazada por la PRIMARY KEY', async () => {
      await reset();
      await claim(key(0, 0));
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (fence_key, state, operation_id, branch_index, page_index)
         VALUES ($1, 'prepared', $2::uuid, 0, 0)`,
        [key(0, 0), RUN],
      );
      assert.equal(code, '23505');
    });

    it('un proveedor distinto de `lusha` es rechazado por CHECK', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (fence_key, provider, state, operation_id, branch_index, page_index)
         VALUES ($1, 'apollo', 'prepared', $2::uuid, 0, 0)`,
        [key(0, 0), RUN],
      );
      assert.equal(code, '23514');
    });
  });

  // ── § 6. Privilegios (§ 19, § 20) ──────────────────────────────────────────

  describe('§ 6 — privilegios', () => {
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

    it('`anon` y `authenticated` no tienen NINGÚN privilegio sobre la valla', async () => {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of privileges) {
          const { rows } = await client.query(
            'SELECT has_table_privilege($1, $2, $3) AS ok',
            [role, TABLE, priv],
          );
          assert.equal(rows[0]!.ok, false, `${role} no puede ${priv}`);
        }
      }
    });

    it('`service_role` puede leer, insertar y actualizar — y NO borrar ni truncar', async () => {
      for (const [priv, expected] of [
        ['SELECT', true],
        ['INSERT', true],
        ['UPDATE', true],
        ['DELETE', false],
        ['TRUNCATE', false],
      ] as const) {
        const { rows } = await client.query(
          'SELECT has_table_privilege($1, $2, $3) AS ok',
          ['service_role', TABLE, priv],
        );
        assert.equal(rows[0]!.ok, expected, `service_role / ${priv}`);
      }
    });

    it('`anon` y `authenticated` no tienen NINGÚN privilegio sobre las OPERACIONES', async () => {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of privileges) {
          const { rows } = await client.query(
            'SELECT has_table_privilege($1, $2, $3) AS ok',
            [role, OPERATIONS, priv],
          );
          assert.equal(rows[0]!.ok, false, `${role} no puede ${priv}`);
        }
      }
    });

    it('`service_role` tampoco puede borrar ni truncar las OPERACIONES', async () => {
      for (const [priv, expected] of [
        ['SELECT', true],
        ['INSERT', true],
        ['UPDATE', true],
        ['DELETE', false],
        ['TRUNCATE', false],
      ] as const) {
        const { rows } = await client.query(
          'SELECT has_table_privilege($1, $2, $3) AS ok',
          ['service_role', OPERATIONS, priv],
        );
        assert.equal(rows[0]!.ok, expected, `service_role / ${priv}`);
      }
    });

    it('sólo `service_role` puede EJECUTAR las CINCO funciones', async () => {
      const signatures = [
        // Las dos de la OPERACIÓN lógica: misma postura que la valla, porque quien
        // pudiera acuñarlas o cerrarlas a mano podría desbloquearse el gasto.
        'public.claim_or_resume_lusha_prospecting_operation(text, text, text, text)',
        'public.complete_lusha_prospecting_operation(uuid)',
        'public.claim_lusha_prospecting_request(text, uuid, integer, integer, text, uuid, uuid)',
        'public.mark_lusha_prospecting_request_dispatched(text)',
        'public.settle_lusha_prospecting_request(text, text, jsonb)',
      ];
      for (const signature of signatures) {
        for (const [role, expected] of [
          ['service_role', true],
          ['anon', false],
          ['authenticated', false],
        ] as const) {
          const { rows } = await client.query(
            'SELECT has_function_privilege($1, $2, $3) AS ok',
            [role, signature, 'EXECUTE'],
          );
          assert.equal(rows[0]!.ok, expected, `${role} / ${signature}`);
        }
      }
    });

    it('RLS está activa y sólo hay policy de `service_role`', async () => {
      const { rows: rls } = await client.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [TABLE],
      );
      assert.equal(rls[0]!.relrowsecurity, true);
      const { rows: policies } = await client.query(
        `SELECT polname, pg_get_userbyid(unnest(polroles)) AS role
         FROM pg_policy WHERE polrelid = $1::regclass`,
        [TABLE],
      );
      assert.equal(policies.length, 1);
      assert.equal(policies[0]!.role, 'service_role');
    });

    it('la tabla no tiene NINGUNA columna capaz de guardar payload del proveedor', async () => {
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'lusha_prospecting_request_fence'`,
      );
      const names = rows.map((r) => String(r.column_name));
      for (const forbidden of ['company_name', 'raw_response', 'api_key', 'response_body', 'results']) {
        assert.equal(names.includes(forbidden), false, `la valla no puede tener ${forbidden}`);
      }
      // Y ninguna columna jsonb donde volcar una respuesta entera.
      const { rows: jsonbCols } = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'lusha_prospecting_request_fence'
           AND data_type IN ('jsonb', 'json')`,
      );
      assert.equal(jsonbCols[0]!.n, 0, 'sin columna jsonb: no hay dónde volcar un payload');
    });
  });
  // ── § 7. IDENTIDAD DURABLE DE LA OPERACIÓN LÓGICA ─────────────────────────
  //
  // La corrección del arreglo es una propiedad de la BASE, no de TypeScript:
  //
  //     como máximo UNA operación SIN RESOLVER por (actor, versión, firma)
  //
  // y esa unicidad la arbitra un índice único PARCIAL. Un doble en memoria puede
  // modelar la regla; sólo PostgreSQL demuestra que la migración la implementa —
  // incluida la parte que importa: que dos entradas SIMULTÁNEAS con uuid de
  // navegador DISTINTOS acaben en una sola operación.

  describe('§ 7 — la operación lógica durable', () => {
    it('L3-ID-1/L3-ID-2 — un clientRequestId FRESCO reencuentra la operación abierta', async () => {
      await reset();
      const sig = 'c'.repeat(64);
      const first = await claimOperation(ACTOR, sig, CLIENT_REQUEST);
      assert.equal(first.status, 'created');

      // 🔴 Uuid de navegador NUEVO. Es el caso que la versión anterior no cerraba.
      const fresh = '33333333-3333-3333-3333-333333333333';
      assert.notEqual(fresh, CLIENT_REQUEST);
      const second = await claimOperation(ACTOR, sig, fresh);

      assert.equal(second.status, 'resumed_unresolved');
      assert.equal(second.operation_id, first.operation_id, 'la MISMA operación, no una virgen');
      assert.equal(second.state, 'reconciliation_required');

      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${OPERATIONS} WHERE request_signature_hash = $1`,
        [sig],
      );
      assert.equal(rows[0]!.n, 1, 'CERO operaciones nuevas');
    });

    it('L3-ID-6 — dos CONEXIONES simultáneas, firmas iguales ⇒ UNA sola operación', async () => {
      await reset();
      const sig = 'd'.repeat(64);
      const other = postgres.getPgClient();
      await other.connect();
      try {
        const [a, b] = await Promise.all([
          claimOperation(ACTOR, sig, '44444444-4444-4444-4444-444444444444', client),
          claimOperation(ACTOR, sig, '55555555-5555-5555-5555-555555555555', other),
        ]);
        const created = [a, b].filter((r) => r.status === 'created');
        const resumed = [a, b].filter((r) => r.status === 'resumed_unresolved');
        assert.equal(created.length, 1, 'sólo una entrada acuña operación');
        assert.equal(resumed.length, 1, 'la otra se reencuentra con la ganadora');
        assert.equal(resumed[0]!.operation_id, created[0]!.operation_id);

        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM ${OPERATIONS} WHERE request_signature_hash = $1`,
          [sig],
        );
        assert.equal(rows[0]!.n, 1);
      } finally {
        await other.end();
      }
    });

    it('L3-ID-5 — dos ACTORES con la misma firma no colisionan', async () => {
      await reset();
      const sig = 'e'.repeat(64);
      const a = await claimOperation(`internal_user:${USER}`, sig);
      const b = await claimOperation('internal_user:99999999-9999-9999-9999-999999999999', sig);
      assert.equal(a.status, 'created');
      assert.equal(b.status, 'created', 'un actor no hereda el bloqueo de otro');
      assert.notEqual(a.operation_id, b.operation_id);
    });

    it('L3-ID-4 — firmas distintas acuñan operaciones distintas', async () => {
      await reset();
      // 🔴 Ni 'a'*64 ni nada igual a SIGNATURE: `reset()` ya acuña una operación
      // con ESA firma, y chocar con ella probaría otra cosa (la reanudación).
      const a = await claimOperation(ACTOR, '2'.repeat(64));
      const b = await claimOperation(ACTOR, '3'.repeat(64));
      assert.notEqual('2'.repeat(64), SIGNATURE);
      assert.equal(a.status, 'created');
      assert.equal(b.status, 'created');
      assert.notEqual(a.operation_id, b.operation_id);
    });

    it('L3-ID-10 — no cierra mientras una petición siga sin liquidar', async () => {
      await reset();
      // RUN es una operación recién acuñada con una petición `prepared`.
      await claim(key(0, 0));
      const blocked = await completeOperation(RUN);
      assert.equal(blocked.status, 'blocked_unsettled_requests');
      assert.equal(blocked.unsettled, 1);
      assert.equal(blocked.state, 'reconciliation_required');

      // `dispatch_unsafe` tampoco basta: el proveedor pudo cobrar y nadie liquidó.
      await mark(key(0, 0));
      assert.equal((await completeOperation(RUN)).status, 'blocked_unsettled_requests');

      // Ni `indeterminate`: no dice si se cobró.
      await settle(key(0, 0), 'indeterminate');
      assert.equal((await completeOperation(RUN)).status, 'blocked_unsettled_requests');
    });

    it('L3-ID-3 — liquidada la petición, la operación cierra y permite otra igual', async () => {
      await reset();
      const sig = 'f'.repeat(64);
      const op = await claimOperation(ACTOR, sig);
      const opId = op.operation_id as string;
      const fenceKey = `lusha_prospecting|v2|${opId}|b0|p0`;

      await client.query(
        'SELECT public.claim_lusha_prospecting_request($1, $2::uuid, 0, 0, $3, NULL, NULL)',
        [fenceKey, opId, CLIENT_REQUEST],
      );
      await mark(fenceKey);
      await settle(fenceKey, 'succeeded');

      assert.equal((await completeOperation(opId)).status, 'completed');

      // Y ahora la MISMA búsqueda puede volver a acuñar operación (§ 8).
      const later = await claimOperation(ACTOR, sig, '66666666-6666-6666-6666-666666666666');
      assert.equal(later.status, 'created', 'una búsqueda futura NO puede quedar vetada');
      assert.notEqual(later.operation_id, opId);
    });

    it('§ 9 — cerrar dos veces es idempotente, no un error ni una reapertura', async () => {
      await reset();
      const opId = RUN;
      assert.equal((await completeOperation(opId)).status, 'completed');
      assert.equal((await completeOperation(opId)).status, 'already_completed');
    });

    it('§ 20 — la valla NO puede colgar de una operación ya cerrada', async () => {
      await reset();
      const opId = RUN;
      assert.equal((await completeOperation(opId)).status, 'completed');
      const refused = await claim(`lusha_prospecting|v2|${opId}|b0|p9`, 0, 9);
      assert.equal(refused.status, 'operation_not_open');
    });

    it('§ 20 — una firma que no es SHA-256 hex es rechazada', async () => {
      await reset();
      assert.equal((await claimOperation(ACTOR, 'no-es-un-hash')).status, 'invalid_signature');
      assert.equal((await claimOperation('', 'a'.repeat(64))).status, 'invalid_input');
    });

    it('§ 20 — una operación completada exige `completed_at` (CHECK de tupla)', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${OPERATIONS} (actor_scope, request_signature_version, request_signature_hash, state)
         VALUES ($1, 'v1', $2, 'completed')`,
        [ACTOR, '1'.repeat(64)],
      );
      assert.equal(code, '23514');
    });

    it('§ 20 — la FK de la valla impide una petición huérfana', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (fence_key, state, operation_id, branch_index, page_index)
         VALUES ($1, 'prepared', $2::uuid, 0, 0)`,
        ['lusha_prospecting|v2|orphan|b0|p0', '77777777-7777-7777-7777-777777777777'],
      );
      assert.equal(code, '23503');
    });
  });
});
