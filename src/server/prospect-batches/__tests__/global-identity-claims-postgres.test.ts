/**
 * AGENT1-CLAIMS-RELEASE-TRIGGER-DEFINER-1 — la migración 140 contra PostgreSQL
 * REAL, con los roles de Supabase.
 *
 * Qué fija:
 *
 *   § 1 · 🔴 un vendedor que DESCARTA con su sesión (`authenticated`) libera los
 *         reclamos de esa empresa. Con el disparador en SECURITY INVOKER, la RLS
 *         (política sólo para `service_role`) dejaba el UPDATE en 0 filas SIN
 *         error y la empresa quedaba bloqueada para siempre;
 *   § 2 · lo mismo con `duplicate`, y con el cliente administrativo;
 *   § 3 · la carrera: la segunda en reclamar la misma señal queda `duplicate`,
 *         sin reclamos propios, y la ganadora conserva los suyos;
 *   § 4 · liberada, la empresa vuelve a poder reclamarse;
 *   § 5 · la sesión de un vendedor no LEE ni ESCRIBE reclamos directamente;
 *   § 6 · reaplicar la migración no cambia ninguna fila.
 *
 * No aplica NADA en Producción. 0 proveedores, 0 créditos. Datos sintéticos.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:a1-global-identity-claims:postgres
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  applyCut3b4RealChain,
  bootstrapPlatform,
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/cut3b4-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

const MIGRATION_140 = '140_agent1_global_company_identity_claims.sql';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let admin: PgLikeClient;
const repAuthId = randomUUID();
let seq = 0;

async function newBatch(): Promise<string> {
  seq += 1;
  const { rows } = await admin.query(
    `INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id`,
    [`lote-140-${seq}`],
  );
  return String(rows[0].id);
}

async function newCandidate(batchId: string, status = 'needs_review'): Promise<string> {
  seq += 1;
  const { rows } = await admin.query(
    `INSERT INTO public.prospect_candidates (batch_id, name, status) VALUES ($1, $2, $3) RETURNING id`,
    [batchId, `Empresa ${seq}`, status],
  );
  return String(rows[0].id);
}

type ClaimOut = {
  status: string;
  claimed_candidate_ids: string[];
  claimed_elsewhere_candidate_ids: string[];
};

async function claim(
  batchId: string,
  candidateId: string,
  claims: Array<{ type: string; key: string }>,
): Promise<ClaimOut> {
  const { rows } = await admin.query(
    `SELECT public.claim_company_identities($1::jsonb) AS out`,
    [JSON.stringify([{ candidateId, batchId, claims }])],
  );
  return rows[0].out as ClaimOut;
}

async function activeClaims(candidateId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.agent1_company_identity_claims
      WHERE candidate_id = $1 AND released_at IS NULL`,
    [candidateId],
  );
  return Number(rows[0].n);
}

/** Corre `sql` como un VENDEDOR con sesión (`authenticated` + su jwt). */
async function asRep<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE authenticated');
    await admin.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [repAuthId]);
    const { rows } = await admin.query(sql, values);
    await admin.query('COMMIT');
    return rows as T[];
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

describe('Migración 140 contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m140-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54431,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    admin = postgres.getPgClient();
    await admin.connect();
    await bootstrapPlatform(admin);
    await applyCut3b4RealChain(admin, repoRoot);
    await admin.query(readMigration(repoRoot, MIGRATION_140));
    await admin.query(
      `INSERT INTO public.internal_users (auth_user_id, access_status) VALUES ($1, 'active')`,
      [repAuthId],
    );
  });

  after(async () => {
    if (!EmbeddedPostgresCtor) return;
    await admin.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('§ 1 — descartar con la sesión del vendedor libera la empresa', () => {
    it('🔴 authenticated pasa a discarded ⇒ los reclamos quedan liberados', async () => {
      const batchId = await newBatch();
      const candidateId = await newCandidate(batchId);
      const out = await claim(batchId, candidateId, [
        { type: 'domain', key: `s1-${seq}.com` },
        { type: 'linkedin', key: `linkedin.com/company/s1-${seq}` },
      ]);
      assert.deepEqual(out.claimed_candidate_ids, [candidateId]);
      assert.equal(await activeClaims(candidateId), 2);

      const updated = await asRep(
        `UPDATE public.prospect_candidates SET status = 'discarded' WHERE id = $1 RETURNING id`,
        [candidateId],
      );
      assert.equal(updated.length, 1, 'la sesión del vendedor sí puede descartar su candidato');
      assert.equal(await activeClaims(candidateId), 0, 'el descarte tiene que liberar los reclamos');
    });
  });

  describe('§ 2 — duplicate y cliente administrativo', () => {
    it('authenticated pasa a duplicate ⇒ liberados', async () => {
      const batchId = await newBatch();
      const candidateId = await newCandidate(batchId);
      await claim(batchId, candidateId, [{ type: 'domain', key: `s2a-${seq}.com` }]);
      await asRep(`UPDATE public.prospect_candidates SET status = 'duplicate' WHERE id = $1`, [
        candidateId,
      ]);
      assert.equal(await activeClaims(candidateId), 0);
    });

    it('el cliente administrativo también libera', async () => {
      const batchId = await newBatch();
      const candidateId = await newCandidate(batchId);
      await claim(batchId, candidateId, [{ type: 'domain', key: `s2b-${seq}.com` }]);
      await admin.query(`UPDATE public.prospect_candidates SET status = 'discarded' WHERE id = $1`, [
        candidateId,
      ]);
      assert.equal(await activeClaims(candidateId), 0);
    });

    it('un cambio a un estado VIVO no libera nada', async () => {
      const batchId = await newBatch();
      const candidateId = await newCandidate(batchId);
      await claim(batchId, candidateId, [{ type: 'domain', key: `s2c-${seq}.com` }]);
      await asRep(`UPDATE public.prospect_candidates SET status = 'approved' WHERE id = $1`, [
        candidateId,
      ]);
      assert.equal(await activeClaims(candidateId), 1);
    });
  });

  describe('§ 3 — la carrera', () => {
    it('🔴 la segunda en reclamar queda duplicate, sin reclamos, y la primera conserva los suyos', async () => {
      const key = `carrera-${seq}.com`;
      const batchA = await newBatch();
      const batchB = await newBatch();
      const first = await newCandidate(batchA);
      const second = await newCandidate(batchB);

      const a = await claim(batchA, first, [{ type: 'domain', key }]);
      const b = await claim(batchB, second, [
        { type: 'linkedin', key: `linkedin.com/company/${key}` },
        { type: 'domain', key },
      ]);

      assert.deepEqual(a.claimed_candidate_ids, [first]);
      assert.deepEqual(b.claimed_elsewhere_candidate_ids, [second]);
      assert.equal(await activeClaims(second), 0, 'el SAVEPOINT revierte también su LinkedIn');
      assert.equal(await activeClaims(first), 1, 'marcar a la perdedora no toca a la ganadora');

      const { rows } = await admin.query(
        `SELECT status, duplicate_status, metadata->'global_identity_claim_conflict'->>'held_by_candidate_id' AS holder
           FROM public.prospect_candidates WHERE id = $1`,
        [second],
      );
      assert.equal(rows[0].status, 'duplicate');
      assert.equal(rows[0].duplicate_status, 'exact_duplicate');
      assert.equal(rows[0].holder, first);
    });
  });

  describe('§ 4 — liberada, se puede volver a reclamar', () => {
    it('otro vendedor la reclama después del descarte', async () => {
      const key = `vuelve-${seq}.com`;
      const batchA = await newBatch();
      const batchB = await newBatch();
      const first = await newCandidate(batchA);
      await claim(batchA, first, [{ type: 'domain', key }]);
      await asRep(`UPDATE public.prospect_candidates SET status = 'discarded' WHERE id = $1`, [first]);

      const second = await newCandidate(batchB);
      const out = await claim(batchB, second, [{ type: 'domain', key }]);
      assert.deepEqual(out.claimed_candidate_ids, [second]);
    });
  });

  describe('§ 5 — la sesión de un vendedor no toca la tabla', () => {
    it('no lee los reclamos de nadie', async () => {
      const batchId = await newBatch();
      const candidateId = await newCandidate(batchId);
      await claim(batchId, candidateId, [{ type: 'domain', key: `s5-${seq}.com` }]);
      const rows = await asRep(`SELECT id FROM public.agent1_company_identity_claims`);
      assert.equal(rows.length, 0);
    });

    it('no inserta reclamos por su cuenta', async () => {
      const batchId = await newBatch();
      const candidateId = await newCandidate(batchId);
      await assert.rejects(
        asRep(
          `INSERT INTO public.agent1_company_identity_claims (claim_type, claim_key, candidate_id, batch_id)
           VALUES ('domain', 'colado.com', $1, $2)`,
          [candidateId, batchId],
        ),
        /row-level security/,
      );
    });
  });

  describe('§ 5b — la función del disparador', () => {
    it('🔴 es SECURITY DEFINER con search_path fijado', async () => {
      const { rows } = await admin.query(
        `SELECT prosecdef, proconfig FROM pg_proc
          WHERE oid = 'public.agent1_release_company_identity_claims()'::regprocedure`,
      );
      assert.equal(rows[0].prosecdef, true);
      assert.ok(
        (rows[0].proconfig as string[]).some((c) => c.startsWith('search_path=')),
        'una función SECURITY DEFINER sin search_path fijado es una puerta',
      );
    });

    it('nadie puede invocarla a mano', async () => {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await admin.query(
          `SELECT has_function_privilege($1, 'public.agent1_release_company_identity_claims()', 'EXECUTE') AS can`,
          [role],
        );
        assert.equal(rows[0].can, false, `${role} no debe poder ejecutarla`);
      }
    });
  });

  describe('§ 6 — reaplicar la migración', () => {
    it('no cambia ninguna fila', async () => {
      const before = await admin.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE released_at IS NULL)::int AS active
           FROM public.agent1_company_identity_claims`,
      );
      await admin.query(readMigration(repoRoot, MIGRATION_140));
      const afterRows = await admin.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE released_at IS NULL)::int AS active
           FROM public.agent1_company_identity_claims`,
      );
      assert.deepEqual(afterRows.rows[0], before.rows[0]);
    });
  });
});
