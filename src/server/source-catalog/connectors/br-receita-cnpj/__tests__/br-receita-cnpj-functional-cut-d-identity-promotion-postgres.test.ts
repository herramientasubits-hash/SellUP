/**
 * BR-SOURCE-FUNCTIONAL-CUT-D — the fenced identity promotion against a REAL, ephemeral PostgreSQL.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHY THE IN-MEMORY SUITE IS NOT ENOUGH
 * ═══════════════════════════════════════════════════════════════════
 *
 * The companion suite proves the DECISIONS — which outcome the runner reaches, what the
 * orchestrator does with it, what never leaks — against a double that MIRRORS the SQL. A mirror
 * can drift, and four of this cut's claims do not live in TypeScript at all:
 *
 *   · that the migration APPLIES. A `plpgsql` function with nested dollar quoting and a
 *     multi-line `COMMENT ON` is exactly the surface where a quoting analysis passes and
 *     PostgreSQL answers 42601;
 *   · that reapplying it changes no row;
 *   · that the epoch fence is REAL — two SESSIONS, two transactions, one `FOR UPDATE`, and
 *     PostgreSQL under READ COMMITTED re-reading the already updated row when the lock is
 *     released. A double returns `stale` because we asked it to; that proves nothing;
 *   · that `anon` cannot execute it.
 *
 * And CASE 15 itself: TWO concurrent promotions, and the invariant that survives them.
 *
 * The migration chain is applied VERBATIM from `supabase/migrations`, in the repository's own
 * order (`BR_RECEITA_COMPACT_FULL_ORDER_CHAIN`, which already interleaves the `prospect_batches` /
 * `prospect_candidates` chain with the source-snapshot one), followed by this cut's own still
 * unnumbered file. Applying it LAST is also the proof that it depends on migration 126 and on
 * nothing this cut authored.
 *
 * 🔴 NO PROD. NO apply_migration. NO real Receita. NO providers. NO credits. NO HubSpot. NO flags.
 * Every CNPJ is synthetic and DV-valid by construction.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapFullOrderPlatform,
  BR_RECEITA_COMPACT_FULL_ORDER_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../__tests__/support/source-snapshot-identity-real-migration-chain';
import { BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES } from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import { PROMOTE_FISCAL_IDENTITY_RPC } from '@/server/prospect-batches/candidate-fiscal-identity-promotion';
import { buildProspectCandidateIdentityKey } from '@/server/agents/prospecting-toolkit/prospect-candidate-identity-key';
import { sampleFullCnpj, RAIZ_TECNOLOGIA, RAIZ_EDUCACAO } from '../br-receita-cnpj-fixtures';
import { BR_RECEITA_CNPJ_COUNTRY_CODE } from '../br-receita-cnpj-types';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

/** This cut's own migration, applied AFTER the whole repository order. */
// 🔴 BR-PRODUCTION-RELEASE numbered this migration 133 (`origin/main` ceiling was 132;
// nothing in flight claimed 133 or above). It is still applied LAST, after the whole
// repository order, because 133 sorts after every file in that chain — the harness order
// and the deployable order agree. Referenced BY NAME so a rename breaks the test.
const CUT_D_MIGRATION = '133_br_candidate_identity_promotion.sql';

const PROMOTE_FN = `public.${PROMOTE_FISCAL_IDENTITY_RPC}`;
const FENCE_FN = 'public.insert_fenced_prospect_candidates';
const BLOCKING = [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES];

const CNPJ_TEC = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001').replace(/\D/g, '');
const CNPJ_EDU = sampleFullCnpj(RAIZ_EDUCACAO, '0001').replace(/\D/g, '');
const NAME_TEC = 'Synthetic Tecnologia Ltda';

const KEY_TEC = buildProspectCandidateIdentityKey({
  name: NAME_TEC,
  taxIdentifier: CNPJ_TEC,
  countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
}) as string;
const KEY_EDU = buildProspectCandidateIdentityKey({
  name: 'Synthetic Educacao SA',
  taxIdentifier: CNPJ_EDU,
  countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
}) as string;

let dataDir = '';
let postgres: EmbeddedPostgresLike;
/** Session A. */ let a: PgLikeClient;
/** Session B — the one that competes. */ let b: PgLikeClient;
/** Observer, outside both transactions. */ let obs: PgLikeClient;

let batchSeq = 0;

type PromoteOut =
  | { status: 'promoted'; previous_epoch: number; next_epoch: number }
  | { status: 'already_same_identity'; current_epoch: number }
  | { status: 'fiscal_identity_conflict'; conflict: string }
  | { status: 'stale'; current_epoch: number }
  | { status: 'candidate_not_found' }
  | { status: 'batch_not_found' }
  | { status: 'invalid_input' };

async function newBatch(): Promise<string> {
  batchSeq += 1;
  const { rows } = await obs.query(
    `INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id`,
    [`lote-cut-d-${batchSeq}`],
  );
  return String(rows[0].id);
}

/** Creates candidates through migration 126's own fenced insert — interop, not a shortcut. */
async function newCandidates(
  batchId: string,
  expectedEpoch: number,
  rows: Array<Record<string, unknown>>,
): Promise<string[]> {
  const { rows: out } = await obs.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
    batchId,
    expectedEpoch,
    JSON.stringify(rows),
  ]);
  const payload = out[0].out as { status: string; candidate_ids?: string[] };
  assert.equal(payload.status, 'inserted', JSON.stringify(payload));
  return payload.candidate_ids ?? [];
}

async function promote(
  client: PgLikeClient,
  args: {
    batchId: string;
    candidateId: string | null;
    expectedEpoch: number | null;
    taxIdentifier: string | null;
    identityKey: string | null;
  },
): Promise<PromoteOut> {
  const { rows } = await client.query(`SELECT ${PROMOTE_FN}($1, $2, $3, $4, $5, $6) AS out`, [
    args.batchId,
    args.candidateId,
    args.expectedEpoch,
    args.taxIdentifier,
    args.identityKey,
    BLOCKING,
  ]);
  return rows[0].out as PromoteOut;
}

async function epochOf(batchId: string): Promise<number> {
  const { rows } = await obs.query(
    `SELECT identity_epoch FROM public.prospect_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows[0].identity_epoch);
}

async function candidateOf(
  id: string,
): Promise<{ tax_identifier: string | null; identity_key: string | null; updated_at: string }> {
  const { rows } = await obs.query(
    `SELECT tax_identifier, identity_key, updated_at
       FROM public.prospect_candidates WHERE id = $1`,
    [id],
  );
  return rows[0] as never;
}

async function pidOf(client: PgLikeClient): Promise<number> {
  const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
  return Number(rows[0].pid);
}

/** Waits until the given session is BLOCKED on a lock. */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const { rows } = await obs.query(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail('the competing promotion never waited on the lock: there is no race to measure');
}

describe('CUT D — the fenced promotion against real PostgreSQL', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-cut-d-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54423,
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

    await bootstrapFullOrderPlatform(a);
    await applyRealChain(a, repoRoot, [...BR_RECEITA_COMPACT_FULL_ORDER_CHAIN, CUT_D_MIGRATION]);
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
  describe('the migration itself', () => {
    it('applies, and creates exactly one SECURITY INVOKER function', async () => {
      const { rows } = await obs.query(
        `SELECT p.prosecdef, p.proconfig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`,
        [PROMOTE_FISCAL_IDENTITY_RPC],
      );
      assert.equal(rows.length, 1, 'the promotion function does not exist');
      assert.equal(rows[0].prosecdef, false, 'the function must be SECURITY INVOKER');
      // 🔴 `public` must be IN the path and `pg_catalog` must come FIRST — the exact correction
      // CUT-3B5 had to make to migration 126 after Production rejected it with 42P01.
      const config = (rows[0].proconfig as string[] | null) ?? [];
      assert.deepEqual(config, ['search_path=pg_catalog, public, pg_temp']);
    });

    it('reapplying it changes no row', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [{ name: NAME_TEC, country_code: 'BR' }]);
      const out = await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: await epochOf(batchId),
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });
      assert.equal(out.status, 'promoted');

      const before = await candidateOf(id);
      const epochBefore = await epochOf(batchId);
      await applyRealChain(a, repoRoot, [CUT_D_MIGRATION]);
      assert.deepEqual(await candidateOf(id), before);
      assert.equal(await epochOf(batchId), epochBefore);
    });

    it('🔴 `anon` cannot execute it', async () => {
      await assert.rejects(
        async () => {
          await obs.query('SET ROLE anon');
          try {
            await obs.query(`SELECT ${PROMOTE_FN}(NULL, NULL, NULL, NULL, NULL, NULL)`);
          } finally {
            await obs.query('RESET ROLE');
          }
        },
        (err: { code?: string }) => err.code === '42501',
        'anon was able to call the promotion',
      );
    });

    it('creates no index and no unique constraint on prospect_candidates', async () => {
      const { rows } = await obs.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'prospect_candidates'
            AND indexname ILIKE '%promot%'`,
      );
      assert.deepEqual(rows, []);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('CASE 1/2/3/9 — promotion, coherence, epoch, replay', () => {
    it('CASE 1 + CASE 2 — the identifier and the identity_key are written TOGETHER', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR', identity_key: 'name:pre-resolution' },
      ]);

      const out = await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: await epochOf(batchId),
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'promoted');
      const row = await candidateOf(id);
      assert.equal(row.tax_identifier, CNPJ_TEC);
      assert.equal(row.identity_key, KEY_TEC);
      // 🔴 The persisted key no longer describes the pre-resolution candidate.
      assert.notEqual(row.identity_key, 'name:pre-resolution');
    });

    it('CASE 3 — the epoch advances by EXACTLY 1', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [{ name: NAME_TEC, country_code: 'BR' }]);
      const before = await epochOf(batchId);

      const out = await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: before,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'promoted');
      assert.equal(out.status === 'promoted' ? Number(out.next_epoch) : null, before + 1);
      assert.equal(await epochOf(batchId), before + 1);
    });

    it('CASE 9 — a replay is idempotent and does NOT advance the epoch', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [{ name: NAME_TEC, country_code: 'BR' }]);
      await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: await epochOf(batchId),
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      const rowBefore = await candidateOf(id);
      const epochBefore = await epochOf(batchId);

      const replay = await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: epochBefore,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(replay.status, 'already_same_identity');
      assert.equal(await epochOf(batchId), epochBefore, 'a no-op advanced the epoch');
      // 🔴 Not even `updated_at` moved: nothing changed, so nothing was written.
      assert.deepEqual(await candidateOf(id), rowBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('CASE 4/6/7/8/12 — the refusals, and what they leave behind', () => {
    it('CASE 4 — a batch peer already holding the identity refuses the promotion', async () => {
      const batchId = await newBatch();
      const ids = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR' },
        { name: 'Peer', country_code: 'BR', tax_identifier: CNPJ_TEC },
      ]);
      const epochBefore = await epochOf(batchId);

      const out = await promote(a, {
        batchId,
        candidateId: ids[0],
        expectedEpoch: epochBefore,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'fiscal_identity_conflict');
      assert.equal(
        out.status === 'fiscal_identity_conflict' ? out.conflict : null,
        'batch_peer_holds_identity',
      );
      assert.equal((await candidateOf(ids[0])).tax_identifier, null);
      assert.equal(await epochOf(batchId), epochBefore);
    });

    it('CASE 4b — a peer in a NON-occupying status does not refuse it', async () => {
      // 🔴 `discarded` and `duplicate` are review RESULTS on a row that already lost its place.
      // Blocking on them would let a previous discard veto the legitimate candidate — exactly the
      // defect CUT-3A warned about, and the reason the vocabulary travels as a PARAMETER.
      const batchId = await newBatch();
      const ids = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR' },
        { name: 'Discarded peer', country_code: 'BR', tax_identifier: CNPJ_TEC, status: 'discarded' },
      ]);

      const out = await promote(a, {
        batchId,
        candidateId: ids[0],
        expectedEpoch: await epochOf(batchId),
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'promoted');
    });

    it('CASE 6 — a stale epoch writes NOTHING and does not move the epoch', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [{ name: NAME_TEC, country_code: 'BR' }]);
      const current = await epochOf(batchId);

      const out = await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: current + 7,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'stale');
      assert.equal(out.status === 'stale' ? Number(out.current_epoch) : null, current);
      assert.equal((await candidateOf(id)).tax_identifier, null);
      assert.equal(await epochOf(batchId), current);
    });

    it('CASE 7 — 🔴 one batch’s fence cannot reach another batch’s candidate', async () => {
      const mine = await newBatch();
      const other = await newBatch();
      const [foreign] = await newCandidates(other, 0, [{ name: NAME_TEC, country_code: 'BR' }]);

      const out = await promote(a, {
        batchId: mine,
        candidateId: foreign,
        expectedEpoch: await epochOf(mine),
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'candidate_not_found');
      assert.equal((await candidateOf(foreign)).tax_identifier, null);
      assert.equal(await epochOf(mine), 0);
    });

    it('CASE 8 — unusable input writes NOTHING', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [{ name: NAME_TEC, country_code: 'BR' }]);
      const epochBefore = await epochOf(batchId);

      const hostile: Array<{ taxIdentifier: string | null; identityKey: string | null }> = [
        { taxIdentifier: null, identityKey: KEY_TEC },
        { taxIdentifier: '   ', identityKey: KEY_TEC },
        // 🔴 A promotion without a recomputed key is REFUSED, never half-applied.
        { taxIdentifier: CNPJ_TEC, identityKey: null },
        { taxIdentifier: CNPJ_TEC, identityKey: '  ' },
      ];

      for (const args of hostile) {
        const out = await promote(a, {
          batchId,
          candidateId: id,
          expectedEpoch: epochBefore,
          ...args,
        });
        assert.equal(out.status, 'invalid_input', JSON.stringify(args));
      }

      assert.equal((await candidateOf(id)).tax_identifier, null);
      assert.equal(await epochOf(batchId), epochBefore);
    });

    it('CASE 12 — a source-supplied identifier is never overwritten', async () => {
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR', tax_identifier: CNPJ_EDU, identity_key: KEY_EDU },
      ]);
      const epochBefore = await epochOf(batchId);

      const out = await promote(a, {
        batchId,
        candidateId: id,
        expectedEpoch: epochBefore,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(out.status, 'fiscal_identity_conflict');
      assert.equal(
        out.status === 'fiscal_identity_conflict' ? out.conflict : null,
        'candidate_holds_other_identity',
      );
      const row = await candidateOf(id);
      assert.equal(row.tax_identifier, CNPJ_EDU);
      assert.equal(row.identity_key, KEY_EDU);
      assert.equal(await epochOf(batchId), epochBefore);
    });

    it('🔴 no refusal payload carries the identifier', async () => {
      const batchId = await newBatch();
      const ids = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR' },
        { name: 'Peer', country_code: 'BR', tax_identifier: CNPJ_TEC },
      ]);

      const outcomes = [
        await promote(a, {
          batchId,
          candidateId: ids[0],
          expectedEpoch: await epochOf(batchId),
          taxIdentifier: CNPJ_TEC,
          identityKey: KEY_TEC,
        }),
        await promote(a, {
          batchId,
          candidateId: ids[0],
          expectedEpoch: 999,
          taxIdentifier: CNPJ_TEC,
          identityKey: KEY_TEC,
        }),
      ];

      for (const outcome of outcomes) {
        const text = JSON.stringify(outcome);
        assert.ok(!text.includes(CNPJ_TEC), `a refusal leaked the identifier: ${text}`);
        assert.ok(!text.includes(KEY_TEC), `a refusal leaked the identity key: ${text}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 15 — two REAL sessions, and the invariant that survives them
  // ═══════════════════════════════════════════════════════════════════════

  describe('CASE 15 — two concurrent promotions', () => {
    it('🔴 the session that arrives with the old epoch is told `stale` and writes NOTHING', async () => {
      const batchId = await newBatch();
      const ids = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR' },
        { name: 'Segunda', country_code: 'BR' },
      ]);
      const startEpoch = await epochOf(batchId);
      const bPid = await pidOf(b);

      // A opens a transaction and takes the batch lock by promoting under the fence.
      await a.query('BEGIN');
      const aOut = await promote(a, {
        batchId,
        candidateId: ids[0],
        expectedEpoch: startEpoch,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });
      assert.equal(aOut.status, 'promoted');

      // B starts from the SAME epoch — its decision came from the same photograph — and blocks on
      // the lock A holds.
      const bPending = promote(b, {
        batchId,
        candidateId: ids[1],
        expectedEpoch: startEpoch,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });
      await waitUntilBlocked(bPid);

      await a.query('COMMIT');

      const bOut = await bPending;
      assert.equal(bOut.status, 'stale', 'a stale decision was allowed to commit');
      assert.equal(bOut.status === 'stale' ? Number(bOut.current_epoch) : null, startEpoch + 1);

      // 🔴 THE INVARIANT: exactly ONE candidate of this batch carries the identity.
      const { rows } = await obs.query(
        `SELECT count(*)::int AS n FROM public.prospect_candidates
          WHERE batch_id = $1 AND tax_identifier = $2`,
        [batchId, CNPJ_TEC],
      );
      assert.equal(Number(rows[0].n), 1, 'two candidates ended up as the same company');
      assert.equal(await epochOf(batchId), startEpoch + 1);
    });

    it('🔴 the loser, re-deciding against the new state, is REFUSED by the peer backstop', async () => {
      // The full B4 loop: `stale` is not the end. The retry re-reads and re-decides — and the
      // answer this time is a conflict, because the winner took the identity the loser wanted.
      const batchId = await newBatch();
      const ids = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR' },
        { name: 'Segunda', country_code: 'BR' },
      ]);
      const startEpoch = await epochOf(batchId);

      assert.equal(
        (
          await promote(a, {
            batchId,
            candidateId: ids[0],
            expectedEpoch: startEpoch,
            taxIdentifier: CNPJ_TEC,
            identityKey: KEY_TEC,
          })
        ).status,
        'promoted',
      );

      const retry = await promote(b, {
        batchId,
        candidateId: ids[1],
        expectedEpoch: await epochOf(batchId),
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });

      assert.equal(retry.status, 'fiscal_identity_conflict');
      assert.equal((await candidateOf(ids[1])).tax_identifier, null);
    });

    it('🔴 if A rolls back, B stops being stale and legitimately succeeds', async () => {
      // The symmetric case, and it is not cosmetic: if `stale` were decided by anything other
      // than COMMITTED state, an aborted transaction would block the next promotion forever and
      // the batch would lose a legitimate identity.
      const batchId = await newBatch();
      const ids = await newCandidates(batchId, 0, [
        { name: NAME_TEC, country_code: 'BR' },
        { name: 'Segunda', country_code: 'BR' },
      ]);
      const startEpoch = await epochOf(batchId);
      const bPid = await pidOf(b);

      await a.query('BEGIN');
      assert.equal(
        (
          await promote(a, {
            batchId,
            candidateId: ids[0],
            expectedEpoch: startEpoch,
            taxIdentifier: CNPJ_TEC,
            identityKey: KEY_TEC,
          })
        ).status,
        'promoted',
      );

      const bPending = promote(b, {
        batchId,
        candidateId: ids[1],
        expectedEpoch: startEpoch,
        taxIdentifier: CNPJ_TEC,
        identityKey: KEY_TEC,
      });
      await waitUntilBlocked(bPid);

      await a.query('ROLLBACK');

      const bOut = await bPending;
      assert.equal(bOut.status, 'promoted', 'an aborted transaction left B stale');
      assert.equal((await candidateOf(ids[0])).tax_identifier, null);
      assert.equal((await candidateOf(ids[1])).tax_identifier, CNPJ_TEC);
      assert.equal(await epochOf(batchId), startEpoch + 1);
    });

    it('🔴 a promotion and a fenced INSERT of the same batch serialize against each other', async () => {
      // The two fenced operations share ONE epoch, so an insert decided against the
      // pre-promotion photograph has to be refused too. If a promotion did not advance the epoch,
      // this would silently succeed.
      const batchId = await newBatch();
      const [id] = await newCandidates(batchId, 0, [{ name: NAME_TEC, country_code: 'BR' }]);
      const startEpoch = await epochOf(batchId);

      assert.equal(
        (
          await promote(a, {
            batchId,
            candidateId: id,
            expectedEpoch: startEpoch,
            taxIdentifier: CNPJ_TEC,
            identityKey: KEY_TEC,
          })
        ).status,
        'promoted',
      );

      const { rows } = await obs.query(`SELECT ${FENCE_FN}($1, $2, $3) AS out`, [
        batchId,
        startEpoch,
        JSON.stringify([{ name: 'Decidida antes de la promoción', country_code: 'BR' }]),
      ]);
      assert.equal((rows[0].out as { status: string }).status, 'stale');
    });
  });
});
