/**
 * Migración 144 contra un PostgreSQL REAL y efímero (AGENT1-PARALLEL-RUNS-PHASE2-1).
 *
 * Lo que la 144 afirma es COMPORTAMIENTO de la base:
 *   * con `max_active_executions_per_user = 1` (el valor de Prod) nada cambia: una
 *     segunda reserva del mismo usuario sigue devolviendo `concurrent_execution_active`;
 *   * subido el ajuste, el usuario puede tener hasta ese número de reservas vivas, y
 *     ni una más;
 *   * el presupuesto del mes sigue mandando sobre TODAS las reservas a la vez;
 *   * dos reservas simultáneas del mismo usuario (dos conexiones) no se cuelan las
 *     dos con el tope en 1: el `FOR UPDATE` del período las serializa;
 *   * la idempotencia por `client_request_id` no cambia.
 *
 * Cadena REAL verbatim: 064 → 121 → 144. DATOS SINTÉTICOS: ni una fila de
 * Producción, ningún proveedor, ningún crédito. En CI corre con
 * `SELLUP_REQUIRE_POSTGRES_HARNESS` (el skip es FALLO); en local se salta sin
 * `embedded-postgres`:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent1:budget-overage-reconciliation:postgres
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyWizardBudgetRealChain,
  bootstrapPlatform,
  readMigration,
  resolveEmbeddedPostgres,
  WIZARD_BUDGET_REAL_CHAIN,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/wizard-budget-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');

const MIGRATION_144 = '144_wizard_budget_concurrent_executions.sql';
const PERIOD = '2026-10-01';
const USER_A = '00000000-0000-4000-8000-0000000001a1';
const USER_B = '00000000-0000-4000-8000-0000000001b2';
const req = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(import.meta.url);

let postgres: EmbeddedPostgresLike;
let client: PgLikeClient;
let dataDir = '';

const scalar = async <T>(sql: string, values?: unknown[]): Promise<T> => {
  const { rows } = await client.query(sql, values);
  return Object.values(rows[0])[0] as T;
};

const reserve = (userId: string, credits: number, clientRequestId: string, c: PgLikeClient = client) =>
  c
    .query(`SELECT public.try_reserve_wizard_credits($1, $2, $3, $4) AS code`, [userId, clientRequestId, credits, PERIOD])
    .then(({ rows }) => (rows[0] as { code: string }).code);

const setMaxActive = (n: number) =>
  client.query(`UPDATE public.wizard_pilot_settings SET max_active_executions_per_user = $1`, [n]);

const resetState = async (budgetCredits = 200) => {
  await client.query(`DELETE FROM public.wizard_budget_reservations`);
  await client.query(`DELETE FROM public.wizard_monthly_budget_periods`);
  await client.query(
    `INSERT INTO public.wizard_monthly_budget_periods (period_start, budget_credits, credits_reserved, credits_consumed)
     VALUES ($1, $2, 0, 0)`,
    [PERIOD, budgetCredits],
  );
  await setMaxActive(1);
};

describe('144 — varias ejecuciones activas por usuario contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pg-wizard-budget-concurrent-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54629 + Math.floor(process.pid % 100),
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await bootstrapPlatform(client);
    await applyWizardBudgetRealChain(client, repoRoot, [...WIZARD_BUDGET_REAL_CHAIN, MIGRATION_144]);
    await client.query(`INSERT INTO public.internal_users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [USER_A, USER_B]);
    await client.query(`UPDATE public.wizard_pilot_settings SET pilot_enabled = true, max_credits_per_execution = 25`);
    await client.query(
      `INSERT INTO public.wizard_pilot_participants (user_id, is_enabled) VALUES ($1, true), ($2, true) ON CONFLICT DO NOTHING`,
      [USER_A, USER_B],
    );
  });

  after(async () => {
    if (client) await client.end().catch(() => undefined);
    if (postgres) await postgres.stop().catch(() => undefined);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => resetState());

  it('aplica, quita el índice ÚNICO y deja uno no único; re-aplicarla es idempotente', async () => {
    await client.query(readMigration(repoRoot, MIGRATION_144));
    const unique = await scalar<string>(
      `SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_wizard_budget_reservations_one_active_per_user'`,
    );
    assert.equal(Number(unique), 0);
    const def = await scalar<string>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_wizard_budget_reservations_active_per_user'`,
    );
    assert.match(def, /WHERE \(status = 'reserved'::text\)/);
    assert.doesNotMatch(def, /UNIQUE/);
  });

  it('con el ajuste en 1 (Prod) NADA cambia: la segunda reserva viva se rechaza', async () => {
    assert.equal(await reserve(USER_A, 5, req(1)), 'reserved');
    assert.equal(await reserve(USER_A, 5, req(2)), 'concurrent_execution_active');
    assert.equal(await reserve(USER_B, 5, req(3)), 'reserved', 'otro usuario no se ve afectado');
  });

  it('con el ajuste en 3: hasta tres reservas vivas, la cuarta no', async () => {
    await setMaxActive(3);
    for (const n of [1, 2, 3]) assert.equal(await reserve(USER_A, 5, req(n)), 'reserved');
    assert.equal(await reserve(USER_A, 5, req(4)), 'concurrent_execution_active');
    assert.equal(Number(await scalar<string>(`SELECT credits_reserved FROM public.wizard_monthly_budget_periods`)), 15);
  });

  it('liberar una reserva devuelve el lugar', async () => {
    await setMaxActive(2);
    assert.equal(await reserve(USER_A, 5, req(1)), 'reserved');
    assert.equal(await reserve(USER_A, 5, req(2)), 'reserved');
    const id = await scalar<string>(`SELECT id FROM public.wizard_budget_reservations WHERE client_request_id = $1`, [req(1)]);
    await client.query(`SELECT public.release_wizard_credits($1, NULL, NULL)`, [id]);
    assert.equal(await reserve(USER_A, 5, req(3)), 'reserved');
  });

  it('el presupuesto del mes manda sobre TODAS las reservas a la vez', async () => {
    await resetState(30);
    await setMaxActive(3);
    assert.equal(await reserve(USER_A, 12, req(1)), 'reserved');
    assert.equal(await reserve(USER_A, 12, req(2)), 'reserved');
    assert.equal(await reserve(USER_A, 12, req(3)), 'insufficient_budget');
    assert.equal(Number(await scalar<string>(`SELECT credits_reserved FROM public.wizard_monthly_budget_periods`)), 24);
  });

  it('la idempotencia no cambia: el mismo client_request_id es la misma reserva', async () => {
    await setMaxActive(3);
    assert.equal(await reserve(USER_A, 5, req(1)), 'reserved');
    assert.equal(await reserve(USER_A, 5, req(1)), 'already_reserved');
    assert.equal(Number(await scalar<string>(`SELECT count(*) FROM public.wizard_budget_reservations`)), 1);
  });

  it('dos reservas SIMULTÁNEAS del mismo usuario con tope 1: sólo entra una', async () => {
    const other = postgres.getPgClient();
    await other.connect();
    try {
      // La primera toma el candado del período y no confirma todavía.
      await client.query('BEGIN');
      assert.equal(await reserve(USER_A, 5, req(1)), 'reserved');
      const racing = reserve(USER_A, 5, req(2), other);
      // Le da tiempo a la segunda para quedarse esperando el candado.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await client.query('COMMIT');
      assert.equal(await racing, 'concurrent_execution_active');
    } finally {
      await other.end().catch(() => undefined);
    }
  });
});
