/**
 * AGENT3-FIRST-CALL-1 — la migración 153 contra PostgreSQL REAL, actuando como
 * `authenticated` (la lección de la 140: la RLS no da error en un UPDATE, filtra).
 *
 *   § 1 · aplica y es reaplicable (IF NOT EXISTS en todo);
 *   § 2 · el servidor (service_role) escribe fichas y paquetes;
 *   § 3 · un usuario ACTIVO lee; uno inactivo no ve nada;
 *   § 4 · un `authenticated` no puede escribir (escritura sólo del servidor);
 *   § 5 · los CHECK de estado y canal rechazan valores desconocidos;
 *   § 6 · borrar la empresa borra sus fichas y paquetes;
 *   § 7 · una sola investigación «running» por empresa (dos clics no pagan dos).
 *
 * No aplica NADA en Producción. 0 proveedores, 0 créditos. Datos sintéticos.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   node --import tsx --test src/server/agents/first-call/__tests__/first-call-migration-postgres.test.ts
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  asAuthenticated,
  bootstrapPlatform,
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../prospect-batches/__tests__/support/cut3b4-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');
const MIGRATION_153 = '153_agent3_first_call_prep.sql';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(import.meta.url);

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let admin: PgLikeClient;
const activeAuthId = randomUUID();
const inactiveAuthId = randomUUID();
let accountId = '';
let userId = '';

async function insertBrief(account: string): Promise<string> {
  const { rows } = await admin.query(
    `INSERT INTO public.account_research_briefs (account_id, status, agent_version, created_by)
     VALUES ($1, 'sufficient', 'agent3-first-call-v1', $2) RETURNING id`,
    [account, userId],
  );
  return (rows[0] as { id: string }).id;
}

describe('Migración 153 contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m153-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54453,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    admin = postgres.getPgClient();
    await admin.connect();
    await bootstrapPlatform(admin);
    // `contacts` vive en la 039; aquí basta su clave para la referencia de la 153.
    await admin.query('CREATE TABLE IF NOT EXISTS public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
    await admin.query(readMigration(repoRoot, MIGRATION_153));

    const users = await admin.query(
      `INSERT INTO public.internal_users (auth_user_id, access_status)
       VALUES ($1, 'active'), ($2, 'suspended') RETURNING id`,
      [activeAuthId, inactiveAuthId],
    );
    userId = (users.rows[0] as { id: string }).id;
    const account = await admin.query('INSERT INTO public.accounts DEFAULT VALUES RETURNING id');
    accountId = (account.rows[0] as { id: string }).id;
  });

  after(async () => {
    if (!EmbeddedPostgresCtor) return;
    await admin.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('§ 1 · se puede volver a aplicar sin error', async () => {
    await admin.query(readMigration(repoRoot, MIGRATION_153));
    const { rows } = await admin.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
         AND tablename IN ('account_research_briefs', 'first_call_packs') ORDER BY tablename`,
    );
    assert.deepEqual(rows.map((r) => (r as { tablename: string }).tablename), ['account_research_briefs', 'first_call_packs']);
  });

  it('§ 2 y § 3 · el servidor escribe; un usuario activo lee y uno inactivo no ve nada', async () => {
    const briefId = await insertBrief(accountId);
    await admin.query(
      `INSERT INTO public.first_call_packs (account_id, brief_id, channel, goal, status, agent_version)
       VALUES ($1, $2, 'whatsapp', 'book_meeting', 'draft', 'agent3-first-call-v1')`,
      [accountId, briefId],
    );

    const active = await asAuthenticated(admin, activeAuthId, async (client) => ({
      briefs: (await client.query('SELECT id FROM public.account_research_briefs')).rows.length,
      packs: (await client.query('SELECT id FROM public.first_call_packs')).rows.length,
    }));
    assert.deepEqual(active, { briefs: 1, packs: 1 });

    const inactive = await asAuthenticated(admin, inactiveAuthId, async (client) => ({
      briefs: (await client.query('SELECT id FROM public.account_research_briefs')).rows.length,
      packs: (await client.query('SELECT id FROM public.first_call_packs')).rows.length,
    }));
    assert.deepEqual(inactive, { briefs: 0, packs: 0 });
  });

  it('§ 4 · un usuario autenticado no puede escribir: ni insertar ni cambiar el estado', async () => {
    await assert.rejects(
      asAuthenticated(admin, activeAuthId, (client) =>
        client.query(
          `INSERT INTO public.account_research_briefs (account_id, status, agent_version) VALUES ($1, 'running', 'x')`,
          [accountId],
        ),
      ),
    );
    const updated = await asAuthenticated(admin, activeAuthId, (client) =>
      client.query(`UPDATE public.first_call_packs SET status = 'used'`),
    ).catch((err: unknown) => err);
    // Sin política de UPDATE la fila no cambia, falle con error o filtre en silencio.
    if (!(updated instanceof Error)) assert.equal((updated as { rowCount: number }).rowCount, 0);
    const { rows } = await admin.query(`SELECT status FROM public.first_call_packs`);
    assert.ok(rows.every((r) => (r as { status: string }).status === 'draft'));
  });

  it('§ 5 · los CHECK rechazan estados y canales desconocidos', async () => {
    await assert.rejects(
      admin.query(
        `INSERT INTO public.account_research_briefs (account_id, status, agent_version) VALUES ($1, 'quizas', 'x')`,
        [accountId],
      ),
      (err: unknown) => (err as { code?: string }).code === '23514',
    );
    await assert.rejects(
      admin.query(
        `INSERT INTO public.first_call_packs (account_id, channel, goal, agent_version) VALUES ($1, 'fax', 'x', 'x')`,
        [accountId],
      ),
      (err: unknown) => (err as { code?: string }).code === '23514',
    );
  });

  it('§ 6 · borrar la empresa borra sus fichas y paquetes', async () => {
    const other = await admin.query('INSERT INTO public.accounts DEFAULT VALUES RETURNING id');
    const otherId = (other.rows[0] as { id: string }).id;
    const briefId = await insertBrief(otherId);
    await admin.query(
      `INSERT INTO public.first_call_packs (account_id, brief_id, channel, goal, agent_version)
       VALUES ($1, $2, 'call', 'book_meeting', 'x')`,
      [otherId, briefId],
    );
    await admin.query('DELETE FROM public.accounts WHERE id = $1', [otherId]);
    const left = await admin.query(
      `SELECT (SELECT count(*) FROM public.account_research_briefs WHERE account_id = $1)::int AS briefs,
              (SELECT count(*) FROM public.first_call_packs WHERE account_id = $1)::int AS packs`,
      [otherId],
    );
    assert.deepEqual(left.rows[0], { briefs: 0, packs: 0 });
  });

  it('§ 7 · una sola investigación en curso por empresa', async () => {
    const other = await admin.query('INSERT INTO public.accounts DEFAULT VALUES RETURNING id');
    const otherId = (other.rows[0] as { id: string }).id;
    const running = `INSERT INTO public.account_research_briefs (account_id, status, agent_version) VALUES ($1, 'running', 'x')`;
    await admin.query(running, [otherId]);
    await assert.rejects(admin.query(running, [otherId]), (err: unknown) => (err as { code?: string }).code === '23505');
    // Terminada la primera, la siguiente puede empezar; y las terminadas no chocan entre sí.
    await admin.query(`UPDATE public.account_research_briefs SET status = 'sufficient' WHERE account_id = $1`, [otherId]);
    await admin.query(running, [otherId]);
    await admin.query(`UPDATE public.account_research_briefs SET status = 'failed' WHERE account_id = $1 AND status = 'running'`, [otherId]);
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.account_research_briefs WHERE account_id = $1`, [otherId]);
    assert.equal((rows[0] as { n: number }).n, 2);
  });
});
