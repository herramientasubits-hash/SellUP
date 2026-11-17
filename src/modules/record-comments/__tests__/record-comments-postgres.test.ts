/**
 * Migración 168 — comentarios y alertas, contra PostgreSQL REAL.
 * No aplica NADA en Producción. Datos sintéticos.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   node --import tsx --test src/modules/record-comments/__tests__/record-comments-postgres.test.ts
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
} from '../../../server/prospect-batches/__tests__/support/cut3b4-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATION_168 = readFileSync(join(repoRoot, 'supabase', 'migrations', '168_record_comments.sql'), 'utf8');
const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(import.meta.url);

const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_OF_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SELLER = '11111111-1111-4111-8111-111111111111';
const LEADER = '22222222-2222-4222-8222-222222222222';

let postgres: EmbeddedPostgresLike | null = null;
let db: PgLikeClient;
let dataDir = '';

async function insertComment(values: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(values);
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO public.record_comments (${keys.join(', ')}) VALUES (${params}) RETURNING id`,
    keys.map((k) => values[k]),
  );
  return rows[0].id as string;
}

async function expectError(sql: string, params: unknown[], pattern: RegExp) {
  await assert.rejects(db.query(sql, params), (err: Error) => pattern.test(err.message));
}

describe('Migración 168 — comentarios y alertas', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m168-'));
    postgres = new EmbeddedPostgresCtor({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: 54468, persistent: false });
    await postgres.initialise();
    await postgres.start();
    db = postgres.getPgClient();
    await db.connect();
    await db.query(SUPABASE_ROLES_SQL);
    await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await db.query(`CREATE TABLE public.internal_users (id uuid PRIMARY KEY)`);
    await db.query(`CREATE TABLE public.accounts (id uuid PRIMARY KEY)`);
    await db.query(`CREATE TABLE public.contacts (id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE)`);
    await db.query(`INSERT INTO public.internal_users (id) VALUES ($1), ($2)`, [SELLER, LEADER]);
    await db.query(`INSERT INTO public.accounts (id) VALUES ($1), ($2)`, [ACCOUNT_A, ACCOUNT_B]);
    await db.query(`INSERT INTO public.contacts (id, account_id) VALUES ($1, $2)`, [CONTACT_OF_A, ACCOUNT_A]);
    await db.query(MIGRATION_168);
  });

  after(async () => {
    await db?.end?.().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('el comentario de un contacto va con la empresa de ESE contacto, aunque llegue otra', async () => {
    const id = await insertComment({
      account_id: ACCOUNT_B,
      contact_id: CONTACT_OF_A,
      field_key: 'phone',
      field_value: '+57 300 000 0000',
      kind: 'alert',
      reason: 'phone_not_exists',
      body: '  El número no existe  ',
      author_id: SELLER,
    });
    const { rows } = await db.query(`SELECT account_id, body FROM public.record_comments WHERE id = $1`, [id]);
    assert.equal(rows[0].account_id, ACCOUNT_A);
    assert.equal(rows[0].body, 'El número no existe', 'el texto se guarda sin espacios sobrantes');
  });

  it('rechaza dato, tipo y motivo fuera del vocabulario, y un texto vacío', async () => {
    const base = `INSERT INTO public.record_comments (account_id, field_key, kind, reason, body, author_id) VALUES ($1, $2, $3, $4, $5, $6)`;
    await expectError(base, [ACCOUNT_A, 'salary', 'note', null, 'x', SELLER], /field_key_check/);
    await expectError(base, [ACCOUNT_A, 'general', 'task', null, 'x', SELLER], /kind_check/);
    await expectError(base, [ACCOUNT_A, 'phone', 'alert', 'spam', 'x', SELLER], /reason_check/);
    await expectError(base, [ACCOUNT_A, 'general', 'note', null, '   ', SELLER], /body_len/);
  });

  it('una nota no se puede «resolver»; una alerta resuelta lleva quién y cuándo', async () => {
    const note = await insertComment({ account_id: ACCOUNT_A, kind: 'note', body: 'Constancia', author_id: SELLER });
    await expectError(
      `UPDATE public.record_comments SET resolved_at = now(), resolved_by = $2 WHERE id = $1`,
      [note, LEADER],
      /resolution_shape/,
    );
    const alert = await insertComment({ account_id: ACCOUNT_A, kind: 'alert', body: 'LinkedIn equivocado', field_key: 'linkedin', author_id: SELLER });
    await expectError(`UPDATE public.record_comments SET resolved_at = now() WHERE id = $1`, [alert], /resolution_shape/);
    await db.query(
      `UPDATE public.record_comments SET resolved_at = now(), resolved_by = $2, resolution_note = 'Corregido' WHERE id = $1`,
      [alert, LEADER],
    );
    const { rows } = await db.query(`SELECT resolved_by, resolution_note FROM public.record_comments WHERE id = $1`, [alert]);
    assert.equal(rows[0].resolved_by, LEADER);
    assert.equal(rows[0].resolution_note, 'Corregido');
  });

  it('trazabilidad: el texto, el autor y el dato no se editan después', async () => {
    const id = await insertComment({ account_id: ACCOUNT_A, kind: 'note', body: 'Original', author_id: SELLER });
    await expectError(`UPDATE public.record_comments SET body = 'Cambiado' WHERE id = $1`, [id], /no se edita/);
    await expectError(`UPDATE public.record_comments SET author_id = $2 WHERE id = $1`, [id, LEADER], /no se edita/);
    await expectError(`UPDATE public.record_comments SET field_key = 'email' WHERE id = $1`, [id], /no se edita/);
  });

  it('un contacto que no existe no se puede comentar', async () => {
    await expectError(
      `INSERT INTO public.record_comments (account_id, contact_id, body, author_id) VALUES ($1, $2, 'x', $3)`,
      [ACCOUNT_A, '99999999-9999-4999-8999-999999999999', SELLER],
      /no existe/,
    );
  });

  it('sólo el servidor: anon y authenticated no leen ni escriben', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.query(`SET ROLE ${role}`);
      try {
        await assert.rejects(db.query(`SELECT 1 FROM public.record_comments`), /permission denied/);
        await assert.rejects(
          db.query(`INSERT INTO public.record_comments (account_id, body, author_id) VALUES ($1, 'x', $2)`, [ACCOUNT_A, SELLER]),
          /permission denied/,
        );
      } finally {
        await db.query(`RESET ROLE`);
      }
    }
    const { rows } = await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.record_comments'::regclass`);
    assert.equal(rows[0].relrowsecurity, true);
  });

  it('borrar la empresa borra sus comentarios (no quedan huérfanos)', async () => {
    await insertComment({ account_id: ACCOUNT_B, kind: 'note', body: 'De B', author_id: SELLER });
    await db.query(`DELETE FROM public.accounts WHERE id = $1`, [ACCOUNT_B]);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.record_comments WHERE account_id = $1`, [ACCOUNT_B]);
    assert.equal(rows[0].n, 0);
  });
});
