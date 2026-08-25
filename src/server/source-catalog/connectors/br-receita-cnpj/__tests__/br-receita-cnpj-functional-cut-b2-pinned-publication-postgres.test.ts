/**
 * BR-SOURCE-FUNCTIONAL-CUT-B2 — the pinned publication against a REAL, ephemeral PostgreSQL.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHY THE IN-MEMORY SUITE IS NOT ENOUGH FOR THIS ONE PROPERTY
 * ═══════════════════════════════════════════════════════════════════
 *
 * The companion suite proves the ORDERING — pinned once, before the loop, never re-resolved. It
 * proves it against a double, which is the right tool for ordering and the wrong tool for this:
 *
 *   · that publication A and publication B of the SAME month can coexist physically at all is
 *     decided by `source_company_snapshots_br_period_identity_uidx`, a five-column PARTIAL unique
 *     index. A double says yes because it never had the index;
 *   · that TWO runs cannot both be `published` for one month — and that a republication is
 *     therefore forced to demote A before promoting B — is decided by
 *     `source_snapshot_runs_published_period_uidx`. So the very shape of the race the pin defends
 *     against is arbitrated by PostgreSQL, not by the code;
 *   · that A's rows SURVIVE its demotion, and stay addressable by run id, is what makes reading a
 *     `superseded` run a coherent thing to do at all rather than a read of nothing.
 *
 * So this file republishes a month for real, through the real executor and the real migration
 * chain, and then asks the pinned reader the only question that matters: does the run that pinned A
 * still see A?
 *
 * The migration chain is applied VERBATIM from `supabase/migrations` with the harness CUT A.1 built.
 * No schema is invented and NO migration is authored by this cut.
 *
 * 🔴 NO PROD. NO apply_migration. NO real Receita. NO providers. NO credits. NO HubSpot. NO flags.
 * Every CNPJ is synthetic and DV-valid by construction (`sampleFullCnpj`).
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
  bootstrapPlatform,
  REPO_DERIVED_REAL_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../__tests__/support/source-snapshot-identity-real-migration-chain';
import { createPostgrestShimClient } from './support/br-receita-cut-b-postgrest-shim';

import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import { sampleParserInput, sampleFullCnpj, RAIZ_TECNOLOGIA } from '../br-receita-cnpj-fixtures';
import {
  toBrReceitaPersistedSnapshot,
  type BrReceitaPersistedSnapshot,
} from '../br-receita-cnpj-monthly-snapshot-identity';
import { planBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import { executeBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-executor';
import { pinBrReceitaPublication } from '../br-receita-cnpj-pinned-publication';
import { readBrReceitaPinnedSnapshot } from '../br-receita-cnpj-pinned-snapshot-reader';
import { createBrReceitaCnpjPinnedEnrichmentAdapter } from '../br-receita-cnpj-enrichment-adapter';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } =
  resolveEmbeddedPostgres(import.meta.url);

let postgres: EmbeddedPostgresLike;
let client: PgLikeClient;
let dataDir = '';

const PERIOD = '2026-07';
const CNPJ_MATRIZ = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');

function recordsFor(period: string, legalNameSuffix = ''): BrReceitaPersistedSnapshot[] {
  const parsed = buildBrReceitaCnpjSnapshotRows({ ...sampleParserInput(), sourcePeriod: period });
  return parsed.snapshots
    .map(toBrReceitaPersistedSnapshot)
    .map((snapshot) =>
      legalNameSuffix === ''
        ? snapshot
        : {
            ...snapshot,
            payload: {
              ...snapshot.payload,
              legal_name: `${snapshot.payload.legal_name ?? ''}${legalNameSuffix}`,
            },
          },
    );
}

const sqlExecutor = (): BrReceitaSqlExecutor => ({
  query: (sql, params) => client.query(sql, params ? [...params] : undefined),
});

async function publishPeriod(options: { supersedes?: string; legalNameSuffix?: string } = {}) {
  const planned = planBrReceitaMonthlySnapshotWrite({
    sourcePeriod: PERIOD,
    records: recordsFor(PERIOD, options.legalNameSuffix ?? ''),
    supersedesPublishedRunId: options.supersedes,
  });
  assert.equal(planned.status, 'planned');
  if (planned.status !== 'planned') throw new Error('unreachable');

  const execution = await executeBrReceitaMonthlySnapshotWrite({
    plan: planned.plan,
    gateway: createBrReceitaSqlWriteGateway(sqlExecutor()),
  });
  assert.equal(execution.status, 'published');
  return execution;
}

const publishStateOf = async (runId: string): Promise<string | null> => {
  const { rows } = await client.query(
    'SELECT publish_state FROM public.source_snapshot_runs WHERE id = $1',
    [runId],
  );
  return rows.length === 0 ? null : (rows[0].publish_state as string | null);
};

const readerClient = () => createPostgrestShimClient(client);

// ═══════════════════════════════════════════════════════════════════════════

describe(
  'BR-SOURCE FUNCTIONAL CUT B2 — pinned publication (real PostgreSQL)',
  { skip: harnessSkipReason },
  () => {
    before(async () => {
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-cut-b2-'));
      postgres = new EmbeddedPostgresCtor!({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54331,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();

      client = postgres.getPgClient();
      await client.connect();

      await bootstrapPlatform(client);
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
    });

    after(async () => {
      await client?.end().catch(() => {});
      await postgres?.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    it('a run that pinned A still reads A after a REAL same-month republication', async () => {
      // ── The world: 2026-07 published as run A. ──
      const runA = (await publishPeriod({ legalNameSuffix: ' [RUN A]' })).snapshotRunId!;

      // ── The run starts and pins. ──
      const pinResult = await pinBrReceitaPublication({ client: readerClient() });
      assert.equal(pinResult.status, 'PINNED');
      const pin = pinResult.publication!;
      assert.equal(pin.sourcePeriod, PERIOD);
      assert.equal(pin.snapshotRunId, runA);

      // Candidate 1, before anything changes.
      const first = await readBrReceitaPinnedSnapshot({
        client: readerClient(),
        publication: pin,
        cnpj: CNPJ_MATRIZ,
      });
      assert.equal(first.status, 'FOUND');
      assert.equal(first.snapshotRunId, runA);
      assert.ok((first.snapshot?.legal_name ?? '').includes('[RUN A]'));

      // ── Mid-run: the SAME month is republished, for real. PostgreSQL's partial unique index on
      //    published runs forces the demote-then-promote, so this is the true shape of the race. ──
      const runB = (await publishPeriod({
        supersedes: runA,
        legalNameSuffix: ' [RUN B]',
      })).snapshotRunId!;

      assert.notEqual(runB, runA);
      assert.equal(await publishStateOf(runA), 'superseded');
      assert.equal(await publishStateOf(runB), 'published');

      // ── Candidates 2..N. The pinned reader must still answer from A. ──
      const second = await readBrReceitaPinnedSnapshot({
        client: readerClient(),
        publication: pin,
        cnpj: CNPJ_MATRIZ,
      });
      assert.equal(second.status, 'FOUND');
      assert.equal(second.snapshotRunId, runA, 'the pinned run is still the run being read');
      assert.ok(
        (second.snapshot?.legal_name ?? '').includes('[RUN A]'),
        'and its CONTENT is A — not B wearing A\'s period',
      );

      // The adapter bound to the same pin agrees.
      const adapter = createBrReceitaCnpjPinnedEnrichmentAdapter(pin, { getClient: readerClient });
      const enrichment = await adapter.enrichCandidate({
        candidateName: 'Synthetic Tecnologia Ltda',
        candidateTaxId: CNPJ_MATRIZ,
        countryCode: 'BR',
        capability: 'enrichment_after_discovery',
      } as never);
      assert.equal(enrichment.status, 'matched');
      assert.equal(enrichment.metadata?.['snapshot_run_id'], runA);
      assert.equal(enrichment.metadata?.['source_period'], PERIOD);

      // ── And the NEXT run pins again — and gets B. ──
      const nextPin = await pinBrReceitaPublication({ client: readerClient() });
      assert.equal(nextPin.status, 'PINNED');
      assert.equal(nextPin.publication?.sourcePeriod, PERIOD);
      assert.equal(nextPin.publication?.snapshotRunId, runB);

      const nextRunRead = await readBrReceitaPinnedSnapshot({
        client: readerClient(),
        publication: nextPin.publication!,
        cnpj: CNPJ_MATRIZ,
      });
      assert.equal(nextRunRead.status, 'FOUND');
      assert.ok((nextRunRead.snapshot?.legal_name ?? '').includes('[RUN B]'));

      // 🔴 The identity never comes back out, from either publication.
      const serialized = JSON.stringify([first, second, nextRunRead, enrichment]);
      assert.ok(!serialized.includes(CNPJ_MATRIZ.replace(/\D/g, '')));
    });
  },
);
