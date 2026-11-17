/**
 * Migración 167 — candado por búsqueda del rescate con IA, contra PostgreSQL REAL.
 * No aplica NADA en Producción. Datos sintéticos.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   node --import tsx --test src/server/agents/prospecting-toolkit/claude-classifier/rescue/__tests__/rescue-batch-lease-postgres.test.ts
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveEmbeddedPostgres,
  SUPABASE_ROLES_SQL,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../../../prospect-batches/__tests__/support/cut3b4-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const MIGRATION_167 = readFileSync(join(repoRoot, 'supabase', 'migrations', '167_claude_rescue_batch_lease.sql'), 'utf8');
const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(import.meta.url);

const BATCH = '11111111-1111-4111-8111-111111111111';
let postgres: EmbeddedPostgresLike | null = null;
let db: PgLikeClient;
let dataDir = '';

const tryLease = async (ttl = 300) =>
  (await db.query(`SELECT public.agent1_try_claude_rescue_lease($1, $2) AS ok`, [BATCH, ttl])).rows[0].ok as boolean;
const metadata = async () =>
  (await db.query(`SELECT metadata FROM public.prospect_batches WHERE id = $1`, [BATCH])).rows[0].metadata as Record<string, unknown>;

describe('Migración 167 — candado del rescate por búsqueda', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m167-'));
    postgres = new EmbeddedPostgresCtor({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: 54467, persistent: false });
    await postgres.initialise();
    await postgres.start();
    db = postgres.getPgClient();
    await db.connect();
    await db.query(SUPABASE_ROLES_SQL);
    await db.query(`CREATE TABLE public.prospect_batches (id uuid PRIMARY KEY, metadata jsonb)`);
    await db.query(`INSERT INTO public.prospect_batches (id, metadata) VALUES ($1, '{"search_mode":"apollo","waterfall":{"x":1}}')`, [BATCH]);
    await db.query(MIGRATION_167);
  });

  after(async () => {
    await db?.end?.().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('el primero lo toma; el segundo encuentra la búsqueda ocupada', async () => {
    assert.equal(await tryLease(), true);
    assert.equal(await tryLease(), false);
  });

  it('nunca pisa el resto de la metadata', async () => {
    const m = await metadata();
    assert.equal(m.search_mode, 'apollo');
    assert.deepEqual(m.waterfall, { x: 1 });
    assert.equal(typeof m.claude_rescue_lease_until, 'string');
  });

  it('soltarlo lo libera y deja el resto igual; uno vencido se puede volver a tomar', async () => {
    await db.query(`SELECT public.agent1_release_claude_rescue_lease($1)`, [BATCH]);
    const m = await metadata();
    assert.equal('claude_rescue_lease_until' in m, false);
    assert.equal(m.search_mode, 'apollo');
    await db.query(
      `UPDATE public.prospect_batches SET metadata = jsonb_set(metadata, '{claude_rescue_lease_until}', '"2000-01-01T00:00:00.000Z"') WHERE id = $1`,
      [BATCH],
    );
    assert.equal(await tryLease(), true, 'el candado vencido no bloquea');
  });

  it('sólo el cliente de servicio puede usarlo', async () => {
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL ROLE authenticated');
      await assert.rejects(db.query(`SELECT public.agent1_try_claude_rescue_lease($1, 60)`, [BATCH]), /permission denied/);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
