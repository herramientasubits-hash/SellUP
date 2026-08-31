/**
 * BR-SOURCE-FUNCTIONAL-CUT-C — candidate → Receita identity resolution against a REAL, ephemeral
 * PostgreSQL.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHY THE IN-MEMORY SUITE IS NOT ENOUGH FOR THESE PROPERTIES
 * ═══════════════════════════════════════════════════════════════════
 *
 * The companion suite proves the DECISIONS — closed statuses, fail-closed ambiguity, bounded
 * window, zero leakage — against a double, which is the right tool for decisions and the wrong tool
 * for these four:
 *
 *   · that `normalized_legal_name` is a real, writable column with a real index, and that the real
 *     gateway statement actually lands a value in it. A double accepts any column name; PostgreSQL
 *     does not, and migration 127's Brazil CHECK is what would reject a row the writer got wrong.
 *   · that the writer's value and the resolver's filter agree ACROSS the database — the round trip
 *     through a `text` column and a real `=` comparison, not through a JavaScript `===`.
 *   · that TWO establishments of one company can coexist in one publication at all, which is
 *     decided by `source_company_snapshots_br_period_identity_uidx`. A double says yes because it
 *     never had the index; the real ambiguity CASE 4 defends against is arbitrated by Postgres.
 *   · that a same-month republication (CASE 9) is forced to demote A before promoting B by
 *     `source_snapshot_runs_published_period_uidx`, and that A's rows SURVIVE that demotion — which
 *     is what makes "the run that pinned A still resolves against A" a coherent claim rather than a
 *     read of nothing. And that the NEXT run pins B and resolves against B (CASE 10).
 *
 * The migration chain is applied VERBATIM from `supabase/migrations`. No schema is invented and NO
 * migration is authored by this cut: `normalized_legal_name` and its
 * `(source_key, normalized_legal_name)` index have existed since migration 065.
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
  BR_RECEITA_COMPACT_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../__tests__/support/source-snapshot-identity-real-migration-chain';
import { createPostgrestShimClient } from './support/br-receita-cut-b-postgrest-shim';

import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import {
  sampleParserInput,
  sampleFullCnpj,
  RAIZ_TECNOLOGIA,
  RAIZ_EDUCACAO,
} from '../br-receita-cnpj-fixtures';
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
import { createBrReceitaCnpjPinnedEnrichmentAdapter } from '../br-receita-cnpj-enrichment-adapter';
import { resolveBrReceitaCandidateIdentity } from '../br-receita-cnpj-candidate-identity-resolver';
import { normalizeBrCompanyLegalName } from '../br-receita-cnpj-name-normalization';

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
const CNPJ_FILIAL = sampleFullCnpj(RAIZ_TECNOLOGIA, '0002');
const CNPJ_EDUCACAO = sampleFullCnpj(RAIZ_EDUCACAO, '0001');

/** Both RAIZ_TECNOLOGIA establishments share one razão social — that IS the difficulty. */
const TECNOLOGIA_NAME = 'Synthetic Tecnologia Ltda';
const EDUCACAO_NAME = 'Synthetic Educação S.A.';

interface RecordOptions {
  /** Appended to every `legal_name`, so run A's content is distinguishable from run B's. */
  legalNameSuffix?: string;
  /** Overrides `raw_data.municipality_name` for ONE establishment, by CNPJ. */
  municipalityByTaxId?: Record<string, string>;
}

function recordsFor(period: string, options: RecordOptions = {}): BrReceitaPersistedSnapshot[] {
  const parsed = buildBrReceitaCnpjSnapshotRows({ ...sampleParserInput(), sourcePeriod: period });
  return parsed.snapshots.map(toBrReceitaPersistedSnapshot).map((snapshot) => {
    const suffix = options.legalNameSuffix ?? '';
    const municipality = options.municipalityByTaxId?.[snapshot.identity.normalized_tax_id];
    if (suffix === '' && municipality === undefined) return snapshot;
    return {
      ...snapshot,
      payload: {
        ...snapshot.payload,
        legal_name:
          suffix === '' ? snapshot.payload.legal_name : `${snapshot.payload.legal_name ?? ''}${suffix}`,
        signals:
          municipality === undefined
            ? snapshot.payload.signals
            : { ...snapshot.payload.signals, municipality_name: municipality },
      },
    };
  });
}

const sqlExecutor = (): BrReceitaSqlExecutor => ({
  query: (sql, params) => client.query(sql, params ? [...params] : undefined),
});

const readerClient = () => createPostgrestShimClient(client);

async function publishPeriod(
  options: RecordOptions & { supersedes?: string } = {},
): Promise<string> {
  const planned = planBrReceitaMonthlySnapshotWrite({
    sourcePeriod: PERIOD,
    records: recordsFor(PERIOD, options),
    supersedesPublishedRunId: options.supersedes,
  });
  assert.equal(planned.status, 'planned');
  if (planned.status !== 'planned') throw new Error('unreachable');

  const execution = await executeBrReceitaMonthlySnapshotWrite({
    plan: planned.plan,
    gateway: createBrReceitaSqlWriteGateway(sqlExecutor()),
  });
  assert.equal(execution.status, 'published');
  return execution.snapshotRunId!;
}

const publishStateOf = async (runId: string): Promise<string | null> => {
  const { rows } = await client.query(
    'SELECT publish_state FROM public.source_snapshot_runs WHERE id = $1',
    [runId],
  );
  return rows.length === 0 ? null : (rows[0].publish_state as string | null);
};

async function pin() {
  const result = await pinBrReceitaPublication({ client: readerClient() });
  assert.equal(result.status, 'PINNED', result.reason);
  assert.ok(result.publication !== null);
  return result.publication!;
}

// ═══════════════════════════════════════════════════════════════════════════

describe(
  'BR-SOURCE FUNCTIONAL CUT C — candidate identity resolution (real PostgreSQL)',
  { skip: harnessSkipReason },
  () => {
    before(async () => {
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-cut-c-'));
      postgres = new EmbeddedPostgresCtor!({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54337,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();

      client = postgres.getPgClient();
      await client.connect();

      await bootstrapPlatform(client);
      await applyRealChain(client, repoRoot, BR_RECEITA_COMPACT_CHAIN);
    });

    after(async () => {
      await client?.end().catch(() => {});
      await postgres?.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    it('CASE 11 — the real writer lands a canonical name in the real column, and its index exists', async () => {
      const runA = await publishPeriod({
        municipalityByTaxId: { [CNPJ_FILIAL]: 'Rio de Janeiro' },
      });

      // The column is real, it is populated, and its value is the canonical form of the
      // `legal_name` in the SAME row — read back out of PostgreSQL, not out of a JS object.
      const { rows } = await client.query(
        `SELECT normalized_tax_id, legal_name, normalized_legal_name
           FROM public.br_receita_snapshots
          WHERE snapshot_run_id = $1
          ORDER BY normalized_tax_id`,
        [runA],
      );
      assert.equal(rows.length, 3);
      for (const row of rows) {
        const expected = normalizeBrCompanyLegalName(row.legal_name as string);
        assert.equal(expected.status, 'valid');
        assert.equal(row.normalized_legal_name, expected.normalized);
      }

      // Two establishments of ONE company really do share ONE canonical name in ONE publication.
      const tecnologia = rows.filter(
        (r) => r.normalized_legal_name === normalizeBrCompanyLegalName(TECNOLOGIA_NAME).normalized,
      );
      assert.equal(tecnologia.length, 2);

      // 🔴 The index this lookup rides is declared on the PARTITIONED PARENT, so every partition
      // is guaranteed to carry it, and it leads with `snapshot_run_id` — the probe is bounded to
      // ONE publication by the index itself, not only by the WHERE clause.
      const { rows: parentIndexes } = await client.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'br_receita_snapshots'
            AND indexname = 'br_receita_snapshots_name_idx'`,
      );
      assert.equal(parentIndexes.length, 1);
      assert.match(
        parentIndexes[0].indexdef as string,
        /\(snapshot_run_id, normalized_legal_name\)/,
      );

      // …and the run's own partition really carries a matching physical index, attached to it.
      const { rows: childIndexes } = await client.query(
        `SELECT i.indexrelid::regclass::text AS name
           FROM pg_index i
          WHERE i.indrelid = ('public.' || public.br_receita_run_partition_name($1::uuid))::regclass
            AND i.indisvalid`,
        [runA],
      );
      assert.equal(childIndexes.length, 2, 'the primary key and the name index');
    });

    it('CASE 12 / CASE 2 — a DIFFERENTLY-SPELLED candidate name resolves to one establishment', async () => {
      const publication = await pin();

      const resolution = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication,
        // Different case, different accent, different punctuation, different spacing than the
        // persisted `legal_name`. The symmetry has to survive the database round trip.
        candidateName: '  synthetic   educacao,  s.a.  ',
      });

      assert.equal(resolution.status, 'RESOLVED_UNIQUE');
      assert.equal(resolution.resolvedNormalizedTaxId, CNPJ_EDUCACAO);
      assert.equal(resolution.sourcePeriod, PERIOD);
      assert.equal(resolution.snapshotRunId, publication.snapshotRunId);

      // …and the resolved identity feeds the EXISTING exact-CNPJ adapter, unchanged.
      const adapter = createBrReceitaCnpjPinnedEnrichmentAdapter(publication, {
        getClient: readerClient,
      });
      const enrichment = await adapter.enrichCandidate({
        candidateName: 'Synthetic Educacao SA',
        candidateTaxId: resolution.resolvedNormalizedTaxId,
        countryCode: 'BR',
        capability: 'enrichment_after_discovery',
      } as never);
      assert.equal(enrichment.status, 'matched');
      assert.equal(enrichment.matchedBy, 'tax_id');
      assert.equal(enrichment.confidence, 1);
      assert.equal(enrichment.metadata?.['snapshot_run_id'], publication.snapshotRunId);

      // 🔴 The identity never comes back out of the enrichment.
      assert.ok(!JSON.stringify(enrichment).includes(CNPJ_EDUCACAO));
    });

    it('CASE 4 — two REAL establishments sharing a name are AMBIGUOUS, with no CNPJ chosen', async () => {
      const publication = await pin();

      const resolution = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication,
        candidateName: TECNOLOGIA_NAME,
      });

      assert.equal(resolution.status, 'AMBIGUOUS');
      assert.equal(resolution.observedCount, 2);
      assert.equal(resolution.resolvedNormalizedTaxId, null);
      assert.ok(!JSON.stringify(resolution).includes(CNPJ_MATRIZ));
      assert.ok(!JSON.stringify(resolution).includes(CNPJ_FILIAL));
    });

    it('CASE 5 — the candidate city picks one of the two real establishments', async () => {
      const publication = await pin();

      const rio = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication,
        candidateName: TECNOLOGIA_NAME,
        candidateCity: 'rio de janeiro',
      });
      assert.equal(rio.status, 'RESOLVED_UNIQUE');
      assert.equal(rio.disambiguatedByCity, true);
      assert.equal(rio.resolvedNormalizedTaxId, CNPJ_FILIAL);

      const sp = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication,
        candidateName: TECNOLOGIA_NAME,
        candidateCity: 'Synthetic City',
      });
      assert.equal(sp.status, 'RESOLVED_UNIQUE');
      assert.equal(sp.resolvedNormalizedTaxId, CNPJ_MATRIZ);

      // A city that matches NEITHER is NO_MATCH — never a fall back to the pair.
      const elsewhere = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication,
        candidateName: TECNOLOGIA_NAME,
        candidateCity: 'Curitiba',
      });
      assert.equal(elsewhere.status, 'NO_MATCH');
      assert.equal(elsewhere.reason, 'insufficient_location_match');
      assert.equal(elsewhere.resolvedNormalizedTaxId, null);
    });

    it('CASE 9 / CASE 7 — a run that pinned A keeps resolving against A after a REAL republication', async () => {
      // ── The world so far: 2026-07 published once, as run A. ──
      const { rows: before } = await client.query(
        `SELECT id FROM public.source_snapshot_runs
          WHERE publish_state = 'published' AND source_period = $1`,
        [PERIOD],
      );
      assert.equal(before.length, 1);
      const runA = before[0].id as string;

      // ── The run starts and pins A. ──
      const pinnedOnA = await pin();
      assert.equal(pinnedOnA.snapshotRunId, runA);

      // Candidate 1, before anything changes. Run A's names carry no suffix.
      const first = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication: pinnedOnA,
        candidateName: EDUCACAO_NAME,
      });
      assert.equal(first.status, 'RESOLVED_UNIQUE');
      assert.equal(first.resolvedNormalizedTaxId, CNPJ_EDUCACAO);

      // ── Mid-run: the SAME month is republished for real, with DIFFERENT names. PostgreSQL's
      //    partial unique index forces demote-then-promote, so this is the true shape of the race.
      const runB = await publishPeriod({
        supersedes: runA,
        legalNameSuffix: ' RUNB',
        municipalityByTaxId: { [CNPJ_FILIAL]: 'Rio de Janeiro' },
      });
      assert.notEqual(runB, runA);
      assert.equal(await publishStateOf(runA), 'superseded');
      assert.equal(await publishStateOf(runB), 'published');

      // ── Candidates 2..N. The A-pinned resolver must STILL answer from A. ──
      const second = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication: pinnedOnA,
        candidateName: EDUCACAO_NAME,
      });
      assert.equal(second.status, 'RESOLVED_UNIQUE');
      assert.equal(second.snapshotRunId, runA, 'the pinned run is still the run being searched');
      assert.equal(second.resolvedNormalizedTaxId, CNPJ_EDUCACAO);

      // CASE 7 — and a name that exists ONLY in run B is invisible to the A-pinned resolver,
      // even though both runs publish the same month and B is the published one.
      const onlyInB = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication: pinnedOnA,
        candidateName: `${EDUCACAO_NAME} RUNB`,
      });
      assert.equal(onlyInB.status, 'NO_MATCH');
      assert.equal(onlyInB.snapshotRunId, runA);

      // ── CASE 10 — the NEXT run pins again, gets B, and resolves against B. ──
      const pinnedOnB = await pin();
      assert.equal(pinnedOnB.snapshotRunId, runB);

      const inB = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication: pinnedOnB,
        candidateName: `${EDUCACAO_NAME} RUNB`,
      });
      assert.equal(inB.status, 'RESOLVED_UNIQUE');
      assert.equal(inB.snapshotRunId, runB);
      assert.equal(inB.resolvedNormalizedTaxId, CNPJ_EDUCACAO);

      // …and A's own spelling is now the one that is absent from the newly pinned publication.
      const oldSpelling = await resolveBrReceitaCandidateIdentity({
        client: readerClient(),
        publication: pinnedOnB,
        candidateName: EDUCACAO_NAME,
      });
      assert.equal(oldSpelling.status, 'NO_MATCH');

      // 🔴 Nothing leaked across any of it.
      const serialized = JSON.stringify([first, second, onlyInB, inB, oldSpelling]);
      for (const cnpj of [CNPJ_MATRIZ, CNPJ_FILIAL]) {
        assert.ok(!serialized.includes(cnpj));
      }
    });
  },
);
