/**
 * BR-SOURCE-FUNCTIONAL-CUT-B — el corte funcional completo contra un PostgreSQL REAL y efímero.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA SUITE NO PUEDE SER UN DOBLE EN MEMORIA
 * ═══════════════════════════════════════════════════════════════════
 *
 * Lo que CUT B afirma son propiedades que ARBITRA PostgreSQL, no el código:
 *
 *   · que la corrida B en `preparing` y la corrida A `published` del MISMO periodo coexistan
 *     FÍSICAMENTE — eso lo decide `source_company_snapshots_br_period_identity_uidx`, un índice
 *     único PARCIAL de cinco columnas, y un doble en memoria diría que sí porque nunca lo tuvo;
 *   · que el relevo sea ATÓMICO — que un lector vea A hasta el COMMIT y B después, jamás una
 *     mezcla — eso exige DOS conexiones reales y una transacción abierta de verdad;
 *   · que `source_snapshot_runs_published_period_uidx` impida dos publicadas a la vez y por tanto
 *     OBLIGUE a degradar antes de promover;
 *   · que el CHECK de Brasil rechace de verdad `tax_id` o `record_identity_key` no nulos;
 *   · que un replay de la MISMA corrida sea idempotente por el ON CONFLICT parcial — y que sin el
 *     predicado el statement falle con 42P10 en vez de duplicar en silencio;
 *   · que la FK `ON DELETE RESTRICT` impida borrar una corrida con filas vivas.
 *
 * La cadena de migraciones se aplica VERBATIM desde `supabase/migrations` (065 → 087 → 125 → 127)
 * con el arnés que BR-SOURCE CUT A.1 ya construyó y verificó. No se inventa esquema.
 *
 * ARNÉS OBLIGATORIO EN CI: `SELLUP_REQUIRE_POSTGRES_HARNESS` convierte el skip en FALLO. En local,
 * sin la variable, el archivo se SALTA con un motivo explícito.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:br-source:functional-cut-b:postgres
 *
 * 🔴 NO PROD. NO apply_migration. NO Receita real. NO proveedores. NO créditos. NO HubSpot.
 * NO flags. Todo CNPJ es sintético y DV-válido por construcción (`sampleFullCnpj`).
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
  sampleBrReceitaRunProvenance,
  RAIZ_EDUCACAO,
  RAIZ_TECNOLOGIA,
} from '../br-receita-cnpj-fixtures';
import {
  toBrReceitaPersistedSnapshot,
  BR_RECEITA_SNAPSHOT_TABLE,
  type BrReceitaPersistedSnapshot,
} from '../br-receita-cnpj-monthly-snapshot-identity';
import {
  planBrReceitaMonthlySnapshotWrite,
  BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
  BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
  BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS,
  brReceitaRunProvenanceMetadata,
  type BrReceitaRunProvenance,
} from '../br-receita-cnpj-compact-storage';
import { executeBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-executor';
import { readBrReceitaPublishedSnapshot } from '../br-receita-cnpj-published-snapshot-reader';
import { createBrReceitaCnpjEnrichmentAdapter } from '../br-receita-cnpj-enrichment-adapter';
import { BR_RECEITA_CNPJ_SOURCE_KEY } from '../br-receita-cnpj-types';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

const FOREIGN_KEY_VIOLATION = '23503';
const UNDEFINED_COLUMN = '42703';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } =
  resolveEmbeddedPostgres(import.meta.url);

let postgres: EmbeddedPostgresLike;
let client: PgLikeClient;
let observer: PgLikeClient | null = null;
let dataDir = '';

// ─── Synthetic material ─────────────────────────────────────────────────────

const CNPJ_TECNOLOGIA_MATRIZ = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
/** Alphanumeric establishment: positions 1–12 carry letters, DV stays numeric. */
const CNPJ_EDUCACAO_MATRIZ = sampleFullCnpj(RAIZ_EDUCACAO, '0001');

function recordsFor(period: string, legalNameSuffix = ''): BrReceitaPersistedSnapshot[] {
  const parsed = buildBrReceitaCnpjSnapshotRows({
    ...sampleParserInput(),
    sourcePeriod: period,
  });
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

/** The executor's SQL port, backed by the ephemeral instance. Nothing else reaches a database. */
const sqlExecutor = (): BrReceitaSqlExecutor => ({
  query: (sql, params) => client.query(sql, params ? [...params] : undefined),
});

async function publishPeriod(
  period: string,
  options: { supersedes?: string; legalNameSuffix?: string; batchSize?: number } = {},
) {
  const planned = planBrReceitaMonthlySnapshotWrite({
    sourcePeriod: period,
    records: recordsFor(period, options.legalNameSuffix ?? ''),
    runProvenance: sampleBrReceitaRunProvenance(),
    supersedesPublishedRunId: options.supersedes,
    batchSize: options.batchSize,
  });
  assert.equal(planned.status, 'planned');
  if (planned.status !== 'planned') throw new Error('unreachable');

  return executeBrReceitaMonthlySnapshotWrite({
    plan: planned.plan,
    gateway: createBrReceitaSqlWriteGateway(sqlExecutor()),
  });
}

/** Stages a run WITHOUT publishing it: begin + one batch, left `preparing`. */
async function stagePreparingRun(period: string, legalNameSuffix: string): Promise<string> {
  const gateway = createBrReceitaSqlWriteGateway(sqlExecutor());
  const started = await gateway.beginPeriodRun({
    kind: 'begin_period',
    table: 'source_snapshot_runs',
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: 'BR',
    source_period: period,
    publish_state: 'preparing',
    runProvenance: sampleBrReceitaRunProvenance(),
    returnsRunId: true,
    resolvesRunHandle: true,
  });

  const rows = recordsFor(period, legalNameSuffix).map((record) => ({
    identity: record.identity,
    snapshot_run_id: started.snapshotRunId,
    payload: record.payload,
  }));

  await gateway.upsertBatch({
    kind: 'upsert_batch',
    table: BR_RECEITA_SNAPSHOT_TABLE,
    batchIndex: 0,
    snapshot_run_id: started.snapshotRunId,
    rows,
    conflictColumns: BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
    conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
    conflictTargetIsPartial: BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
    collapsedInBatchCount: 0,
  });

  return started.snapshotRunId;
}

const rowsOf = async (sql: string, values?: unknown[]) => (await client.query(sql, values)).rows;

const errorCodeOf = async (sql: string, values?: unknown[]): Promise<string | null> => {
  try {
    await client.query(sql, values);
    return null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return (err as { code?: string }).code ?? 'unknown';
  }
};

/**
 * The run's PHYSICAL rows, counted in its own partition.
 *
 * 🔴 Through the partition and not through the parent, because those are now two different facts.
 * A `preparing` run's child is DETACHED, so its rows are real and simultaneously unreachable from
 * `br_receita_snapshots` — which is exactly the coexistence CASE 2 is about, made structural.
 */
const countRowsInRun = async (runId: string): Promise<number> => {
  const named = await rowsOf('SELECT public.br_receita_run_partition_name($1::uuid) AS name', [runId]);
  const partition = String(named[0].name);
  const exists = await rowsOf('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${partition}`]);
  if (exists[0].present !== true) {
    return 0;
  }
  const rows = await rowsOf(`SELECT count(*)::int AS n FROM public.${partition}`);
  return Number(rows[0].n);
};

/** The run's rows as a READER sees them: through the partitioned parent. */
const countRowsVisibleInRun = async (runId: string): Promise<number> => {
  const rows = await rowsOf(
    'SELECT count(*)::int AS n FROM public.br_receita_snapshots WHERE snapshot_run_id = $1',
    [runId],
  );
  return Number(rows[0].n);
};

const publishStateOf = async (runId: string): Promise<string | null> => {
  const rows = await rowsOf('SELECT publish_state FROM public.source_snapshot_runs WHERE id = $1', [
    runId,
  ]);
  return rows.length === 0 ? null : (rows[0].publish_state as string | null);
};

const readerClient = () => createPostgrestShimClient(client);

const readPublished = (period: string, cnpj: string) =>
  readBrReceitaPublishedSnapshot({ client: readerClient(), sourcePeriod: period, cnpj });

// ═══════════════════════════════════════════════════════════════════════════

describe('BR-SOURCE FUNCTIONAL CUT B — snapshot runtime end to end (real PostgreSQL)', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-cut-b-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54329,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();

    client = postgres.getPgClient();
    await client.connect();

    await bootstrapPlatform(client);
    await applyRealChain(client, repoRoot, BR_RECEITA_COMPACT_CHAIN);

    // A SECOND connection. Without it, "a reader sees A until the COMMIT" is unobservable: one
    // connection always sees its own uncommitted work.
    try {
      const second = postgres.getPgClient();
      await second.connect();
      observer = second;
    } catch {
      observer = null;
    }
  });

  after(async () => {
    await observer?.end().catch(() => {});
    await client?.end().catch(() => {});
    await postgres?.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ── CASE 1 ────────────────────────────────────────────────────────────────
  it('CASE 1 — first publication: builder → writer → publish → reader → BR adapter', async () => {
    const period = '2026-07';
    const execution = await publishPeriod(period);

    assert.equal(execution.status, 'published');
    assert.equal(execution.supersededRunId, null);
    assert.equal(execution.rowsWritten, 3, 'the three accepted fixture establishments');
    assert.equal(await publishStateOf(execution.snapshotRunId!), 'published');

    const read = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(read.status, 'FOUND');
    assert.equal(read.snapshotRunId, execution.snapshotRunId);
    assert.equal(read.snapshot?.source_period, period);

    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: period,
      getClient: readerClient,
    });
    const enrichment = await adapter.enrichCandidate({
      candidateName: 'Synthetic Tecnologia Ltda',
      candidateTaxId: CNPJ_TECNOLOGIA_MATRIZ,
      countryCode: 'BR',
      capability: 'enrichment_after_discovery',
    });

    assert.equal(enrichment.status, 'matched');
    assert.equal(enrichment.matchedBy, 'tax_id');
    assert.equal(enrichment.sourceYear, 2026);
    assert.equal(enrichment.signals?.cnae_main_code, '6201501');
    assert.equal(enrichment.signals?.uf, 'SP');
    assert.equal(enrichment.signals?.municipality_name, 'Synthetic City');
    assert.equal(enrichment.metadata?.source_period, period);
    // 🔴 The identity never comes back out of the pipeline.
    assert.ok(!JSON.stringify(enrichment).includes(CNPJ_TECNOLOGIA_MATRIZ));
  });

  // ── CASE 8 ────────────────────────────────────────────────────────────────
  it('CASE 8 — exactly ONE persisted representation: normalized_tax_id set, the other two NULL', async () => {
    // 🔴 The refusal is no longer "the column is NULL" but "the column does not exist". On the
    // dedicated table a second representation is UNREPRESENTABLE, which is a stronger claim than
    // an unenforced convention and a stronger one than a CHECK.
    const columns = (
      await rowsOf(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'br_receita_snapshots'`,
      )
    ).map((row) => String(row.column_name));

    assert.ok(columns.includes('normalized_tax_id'), 'the ONE permitted representation must exist');
    assert.equal(columns.includes('tax_id'), false, 'the raw CNPJ has nowhere to land');
    assert.equal(columns.includes('record_identity_key'), false, 'tax:<cnpj> has nowhere to land');
    assert.equal(columns.includes('raw_data'), false, 'no jsonb can smuggle CNPJ material');
    assert.equal(
      columns.filter((name) => /cnpj|tax/i.test(name)).length,
      1,
      'exactly ONE column may name a tax identifier',
    );

    const rows = await rowsOf(
      `SELECT normalized_tax_id, source_period, snapshot_run_id FROM public.br_receita_snapshots`,
    );
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(row.normalized_tax_id !== null);
      assert.ok(row.source_period !== null);
      assert.ok(row.snapshot_run_id !== null);
    }
  });

  it('the database itself refuses a second representation on a Brazil row', async () => {
    const runRows = await rowsOf(
      `SELECT id FROM public.source_snapshot_runs WHERE source_key = $1 AND publish_state = 'published' LIMIT 1`,
      [BR_RECEITA_CNPJ_SOURCE_KEY],
    );
    const runId = runRows[0].id as string;
    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0009');

    // 42703 = undefined_column. The table has no `tax_id`, so the statement cannot even parse.
    const code = await errorCodeOf(
      `INSERT INTO public.br_receita_snapshots
         (snapshot_run_id, source_period, normalized_tax_id, tax_id)
       VALUES ($1, '2026-07', $2, $2)`,
      [runId, cnpj],
    );
    assert.equal(code, UNDEFINED_COLUMN, 'tax_id must have nowhere to land on a Brazil row');
  });

  // ── CASE 7 ────────────────────────────────────────────────────────────────
  it('CASE 7 — an ALPHANUMERIC CNPJ round-trips: written, constrained and found', async () => {
    assert.match(CNPJ_EDUCACAO_MATRIZ, /^[A-Z0-9]{12}[0-9]{2}$/);
    assert.match(CNPJ_EDUCACAO_MATRIZ.slice(0, 12), /[A-Z]/, 'the fixture must exercise letters');

    const read = await readPublished('2026-07', CNPJ_EDUCACAO_MATRIZ);
    assert.equal(read.status, 'FOUND');
    assert.equal(read.snapshot?.signals.cnae_main_code, '8599604');

    // And a digits-only reading of the same identity is NOT the same identity.
    const digitsOnly = await readPublished('2026-07', CNPJ_EDUCACAO_MATRIZ.replace(/[A-Z]/g, '0'));
    assert.notEqual(digitsOnly.status, 'FOUND');
  });

  // ── CASE 2 + CASE 9 ───────────────────────────────────────────────────────
  it('CASE 2 / CASE 9 — a preparing run coexists physically and is INVISIBLE to the reader', async () => {
    const period = '2026-07';
    const publishedRow = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(publishedRow.status, 'FOUND');
    const publishedRunId = publishedRow.snapshotRunId!;
    const publishedLegalName = publishedRow.snapshot?.legal_name;

    const preparingRunId = await stagePreparingRun(period, ' [STAGING]');

    // Both row sets exist at once — that is the point of the run dimension.
    assert.equal(await countRowsInRun(publishedRunId), 3);
    assert.equal(await countRowsInRun(preparingRunId), 3);
    assert.equal(await publishStateOf(preparingRunId), 'preparing');

    // 🔴 And the staging rows are invisible through the PARENT, not merely filtered out by a
    // reader that remembered to check `publish_state`. They are physically not part of the table.
    assert.equal(await countRowsVisibleInRun(publishedRunId), 3);
    assert.equal(
      await countRowsVisibleInRun(preparingRunId),
      0,
      'a preparing run is DETACHED: even a reader that forgot publish_state cannot reach it',
    );

    // CASE 9 — no cross-run leakage: the reader still answers from run A, unchanged.
    const afterStaging = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(afterStaging.status, 'FOUND');
    assert.equal(afterStaging.snapshotRunId, publishedRunId);
    assert.equal(afterStaging.snapshot?.legal_name, publishedLegalName);
    assert.ok(!(afterStaging.snapshot?.legal_name ?? '').includes('[STAGING]'));

    // Run isolation: B's upserts never touched A's rows.
    const untouched = await rowsOf(
      `SELECT legal_name FROM public.br_receita_snapshots
        WHERE snapshot_run_id = $1 AND normalized_tax_id = $2`,
      [publishedRunId, CNPJ_TECNOLOGIA_MATRIZ],
    );
    assert.equal(untouched.length, 1);
    assert.ok(!String(untouched[0].legal_name).includes('[STAGING]'));

    // Clean the staging run away, run-scoped.
    const gateway = createBrReceitaSqlWriteGateway(sqlExecutor());
    const cleaned = await gateway.failPeriod(
      {
        kind: 'fail_period',
        table: 'source_snapshot_runs',
        source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
        country_code: 'BR',
        source_period: period,
        to: 'failed',
        leavesPreviousPublishedRunIntact: true,
        cleanupIsRunScoped: true,
      },
      preparingRunId,
    );
    assert.equal(cleaned.deletedRows, 3);
    assert.equal(await countRowsInRun(preparingRunId), 0);
    // 🔴 The published run is untouched by that cleanup.
    assert.equal(await countRowsInRun(publishedRunId), 3);
    assert.equal(await publishStateOf(publishedRunId), 'published');
  });

  it('a run-scoped delete aimed at a PUBLISHED run removes nothing', async () => {
    const period = '2026-07';
    const published = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    const publishedRunId = published.snapshotRunId!;

    const gateway = createBrReceitaSqlWriteGateway(sqlExecutor());
    const attempted = await gateway.discardRunRows({
      kind: 'discard_run_rows',
      table: BR_RECEITA_SNAPSHOT_TABLE,
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_period: period,
      snapshot_run_id: publishedRunId,
      onlyWhenRunPublishStateIn: ['preparing', 'failed', 'rolled_back'],
      canDeletePublishedRun: false,
      canDeleteByPeriodAlone: false,
    });

    assert.equal(attempted.deletedRows, 0);
    assert.equal(await countRowsInRun(publishedRunId), 3);
  });

  it('the FK is ON DELETE RESTRICT: a run with live rows cannot be deleted', async () => {
    const published = await readPublished('2026-07', CNPJ_TECNOLOGIA_MATRIZ);
    const code = await errorCodeOf('DELETE FROM public.source_snapshot_runs WHERE id = $1', [
      published.snapshotRunId,
    ]);
    assert.equal(code, FOREIGN_KEY_VIOLATION);
  });

  // ── CASE 5 ────────────────────────────────────────────────────────────────
  it('CASE 5 — replaying the SAME rows into the SAME run is idempotent', async () => {
    const period = '2026-09';
    const runId = await stagePreparingRun(period, ' [REPLAY]');
    assert.equal(await countRowsInRun(runId), 3);

    // The same batch, again. The run-scoped partial unique index makes it an UPDATE, not an INSERT.
    const replayRunId = await (async () => {
      const gateway = createBrReceitaSqlWriteGateway(sqlExecutor());
      const rows = recordsFor(period, ' [REPLAY]').map((record) => ({
        identity: record.identity,
        snapshot_run_id: runId,
        payload: record.payload,
      }));
      await gateway.upsertBatch({
        kind: 'upsert_batch',
        table: BR_RECEITA_SNAPSHOT_TABLE,
        batchIndex: 1,
        snapshot_run_id: runId,
        rows,
        conflictColumns: BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
        conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
        conflictTargetIsPartial: BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
        collapsedInBatchCount: 0,
      });
      return runId;
    })();

    assert.equal(await countRowsInRun(replayRunId), 3, 'a replay must not duplicate rows');
  });

  it('an upsert naming the OLD five-column arbiter fails loudly rather than duplicating', async () => {
    // Proving the conflict target is load-bearing, not decoration. The dedicated table's arbiter is
    // its PRIMARY KEY; the generic table's five-column partial index does not exist here, and
    // three of its columns do not either. Either way the statement STOPS — 42703
    // (undefined_column) or 42P10 (no matching unique constraint) — rather than inserting a second
    // row for one establishment inside one run.
    const code = await errorCodeOf(
      `INSERT INTO public.br_receita_snapshots (snapshot_run_id, source_period, normalized_tax_id)
       SELECT snapshot_run_id, source_period, normalized_tax_id
         FROM public.br_receita_snapshots
        LIMIT 1
       ON CONFLICT (source_key, country_code, source_period, snapshot_run_id, normalized_tax_id)
       DO NOTHING`,
    );
    assert.ok(code === UNDEFINED_COLUMN || code === '42P10', `unexpected SQLSTATE ${String(code)}`);

    // And the arbiter that DOES exist is accepted, and is a no-op on a replay.
    const accepted = await errorCodeOf(
      `INSERT INTO public.br_receita_snapshots (snapshot_run_id, source_period, normalized_tax_id)
       SELECT snapshot_run_id, source_period, normalized_tax_id
         FROM public.br_receita_snapshots
        LIMIT 1
       ON CONFLICT (snapshot_run_id, normalized_tax_id) DO NOTHING`,
    );
    assert.equal(accepted, null);
  });

  // ── CASE 6 ────────────────────────────────────────────────────────────────
  it('CASE 6 — the same CNPJ in the next period is a DISTINCT snapshot', async () => {
    const execution = await publishPeriod('2026-08', { legalNameSuffix: ' [AUG]' });
    assert.equal(execution.status, 'published');

    const july = await readPublished('2026-07', CNPJ_TECNOLOGIA_MATRIZ);
    const august = await readPublished('2026-08', CNPJ_TECNOLOGIA_MATRIZ);

    assert.equal(july.status, 'FOUND');
    assert.equal(august.status, 'FOUND');
    assert.notEqual(july.snapshotRunId, august.snapshotRunId);
    assert.equal(july.snapshot?.source_period, '2026-07');
    assert.equal(august.snapshot?.source_period, '2026-08');
    // July was NOT overwritten by August.
    assert.ok(!(july.snapshot?.legal_name ?? '').includes('[AUG]'));
    assert.ok((august.snapshot?.legal_name ?? '').includes('[AUG]'));

    // Both months are published simultaneously — the uniqueness is per PERIOD, not per source.
    const published = await rowsOf(
      `SELECT source_period FROM public.source_snapshot_runs
        WHERE source_key = $1 AND publish_state = 'published' ORDER BY source_period`,
      [BR_RECEITA_CNPJ_SOURCE_KEY],
    );
    assert.deepEqual(
      published.map((row) => row.source_period),
      ['2026-07', '2026-08'],
    );
  });

  // ── CASE 10 ───────────────────────────────────────────────────────────────
  it('CASE 10 — a period with no publication is answered, never invented', async () => {
    const read = await readPublished('2026-10', CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(read.status, 'NO_PUBLISHED_RUN');
    assert.equal(read.snapshot, null);

    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: '2026-10',
      getClient: readerClient,
    });
    const enrichment = await adapter.enrichCandidate({
      candidateName: 'Synthetic Tecnologia Ltda',
      candidateTaxId: CNPJ_TECNOLOGIA_MATRIZ,
      countryCode: 'BR',
      capability: 'enrichment_after_discovery',
    });
    assert.equal(enrichment.status, 'no_match');
    assert.equal(enrichment.reason, 'br_period_has_no_published_run');
  });

  // ── CASE 4 ────────────────────────────────────────────────────────────────
  it('CASE 4 — a failed rebuild leaves the published month completely untouched', async () => {
    const period = '2026-07';
    const before = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(before.status, 'FOUND');
    const publishedRunId = before.snapshotRunId!;

    // A rebuild whose second record belongs to another month. The PLAN refuses it mid-stream, so
    // `publish_period` is never reached — and the demotion of run A lives inside that publish.
    const poisoned = recordsFor(period, ' [FAILED REBUILD]').map((record, index) =>
      index === 1
        ? { ...record, identity: { ...record.identity, source_period: '2026-08' } }
        : record,
    );
    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: period,
      records: poisoned,
      runProvenance: sampleBrReceitaRunProvenance(),
      supersedesPublishedRunId: publishedRunId,
      batchSize: 1,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');

    const execution = await executeBrReceitaMonthlySnapshotWrite({
      plan: planned.plan,
      gateway: createBrReceitaSqlWriteGateway(sqlExecutor()),
    });

    assert.equal(execution.status, 'failed');
    assert.equal(execution.failure?.reason, 'record_period_mismatch');
    assert.equal(execution.failure?.recordIndex, 1);
    assert.equal(execution.supersededRunId, null);

    // The failed run is unpublishable and its rows are gone.
    assert.equal(await publishStateOf(execution.snapshotRunId!), 'failed');
    assert.equal(await countRowsInRun(execution.snapshotRunId!), 0);

    // 🔴 And run A is exactly as it was.
    assert.equal(await publishStateOf(publishedRunId), 'published');
    assert.equal(await countRowsInRun(publishedRunId), 3);
    const after = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(after.status, 'FOUND');
    assert.equal(after.snapshotRunId, publishedRunId);
    assert.equal(after.snapshot?.legal_name, before.snapshot?.legal_name);
  });

  // ── CASE 3 ────────────────────────────────────────────────────────────────
  it('CASE 3 — the cutover is ATOMIC: a concurrent reader sees A until the COMMIT, then B', async () => {
    const period = '2026-07';
    const before = await readPublished(period, CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(before.status, 'FOUND');
    const runA = before.snapshotRunId!;

    assert.ok(observer, 'a second connection is required to observe the cutover');
    const observerClient = createPostgrestShimClient(observer!);
    const observedMidTransaction: string[] = [];

    // A SQL port that, right before the COMMIT of the publish transaction, asks a DIFFERENT
    // connection what it can see. That is the only honest way to test "never a mixture".
    //
    // 🔴 `beginPeriodRun` now opens and commits its OWN transaction (PR #368 correction B, so a
    // partition-creation failure cannot leave an orphan run row), so `sql === 'COMMIT'` alone no
    // longer identifies the publish transaction's commit — it fires there too. The attach call
    // happens ONLY inside `commitFinalBatchAndPublish`, never inside `beginPeriodRun`, so it is
    // what actually distinguishes the two.
    let attachedForPublish = false;
    const spyingSql: BrReceitaSqlExecutor = {
      async query(sql, params) {
        if (sql.includes('br_receita_attach_run_partition')) {
          attachedForPublish = true;
        }
        if (sql === 'COMMIT' && attachedForPublish) {
          const midFlight = await readBrReceitaPublishedSnapshot({
            client: observerClient,
            sourcePeriod: period,
            cnpj: CNPJ_TECNOLOGIA_MATRIZ,
          });
          observedMidTransaction.push(`${midFlight.status}:${midFlight.snapshotRunId ?? 'none'}`);
        }
        return client.query(sql, params ? [...params] : undefined);
      },
    };

    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: period,
      records: recordsFor(period, ' [RUN B]'),
      runProvenance: sampleBrReceitaRunProvenance(),
      supersedesPublishedRunId: runA,
      batchSize: 2,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');

    const execution = await executeBrReceitaMonthlySnapshotWrite({
      plan: planned.plan,
      gateway: createBrReceitaSqlWriteGateway(spyingSql),
    });

    assert.equal(execution.status, 'published');
    const runB = execution.snapshotRunId!;
    assert.notEqual(runB, runA);
    assert.equal(execution.supersededRunId, runA);

    // 🔴 BEFORE the commit, the outside world still saw run A — complete, never a mixture.
    assert.deepEqual(observedMidTransaction, [`FOUND:${runA}`]);

    // AFTER the commit, it sees run B, and A is `superseded` rather than deleted.
    const after = await readBrReceitaPublishedSnapshot({
      client: observerClient,
      sourcePeriod: period,
      cnpj: CNPJ_TECNOLOGIA_MATRIZ,
    });
    assert.equal(after.status, 'FOUND');
    assert.equal(after.snapshotRunId, runB);
    assert.ok((after.snapshot?.legal_name ?? '').includes('[RUN B]'));

    assert.equal(await publishStateOf(runA), 'superseded');
    assert.equal(await publishStateOf(runB), 'published');
    // A's rows survive the demotion: they are addressable, auditable, and discarded explicitly.
    assert.equal(await countRowsInRun(runA), 3);

    // Exactly ONE published run for the period, at every instant that is observable.
    const published = await rowsOf(
      `SELECT count(*)::int AS n FROM public.source_snapshot_runs
        WHERE source_key = $1 AND source_period = $2 AND publish_state = 'published'`,
      [BR_RECEITA_CNPJ_SOURCE_KEY, period],
    );
    assert.equal(Number(published[0].n), 1);
  });

  it('promoting before demoting is refused by the immediate unique index', async () => {
    const period = '2026-07';
    const runs = await rowsOf(
      `SELECT id, publish_state FROM public.source_snapshot_runs
        WHERE source_key = $1 AND source_period = $2`,
      [BR_RECEITA_CNPJ_SOURCE_KEY, period],
    );
    const superseded = runs.find((row) => row.publish_state === 'superseded');
    assert.ok(superseded, 'the cutover test must have left a superseded run');

    // Promoting it back while the current one is still published is the WRONG order, and the
    // index rejects it at the statement — which is why the gateway demotes first.
    const code = await errorCodeOf(
      `UPDATE public.source_snapshot_runs SET publish_state = 'published' WHERE id = $1`,
      [superseded!.id],
    );
    assert.equal(code, '23505');
  });

  // ── PR #368 pre-merge correction A ──────────────────────────────────────
  it('run-level provenance persists on source_snapshot_runs.metadata, never per-row', async () => {
    const period = '2026-11';
    const provenance: BrReceitaRunProvenance = {
      parser_version: 'br-receita-cnpj-provenance-proof@1',
      source_downloaded_at: '2026-11-01T00:00:00.000Z',
      import_batch_id: 'provenance-proof-batch',
    };

    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: period,
      records: recordsFor(period, ' [PROVENANCE]'),
      runProvenance: provenance,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');

    const execution = await executeBrReceitaMonthlySnapshotWrite({
      plan: planned.plan,
      gateway: createBrReceitaSqlWriteGateway(sqlExecutor()),
    });
    assert.equal(execution.status, 'published', execution.failure?.reason);
    const runId = execution.snapshotRunId!;

    // 🔴 It survived on THE RUN, exactly as `brReceitaRunProvenanceMetadata` built it — no second
    // mapper, no silent drop.
    const runRow = await rowsOf(
      'SELECT metadata FROM public.source_snapshot_runs WHERE id = $1',
      [runId],
    );
    assert.deepEqual(runRow[0].metadata, brReceitaRunProvenanceMetadata(provenance));

    // 🔴 And it did NOT move to a per-row column. `br_receita_snapshots` carries no column named
    // after a single one of the run-level provenance keys.
    const columns = await rowsOf(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'br_receita_snapshots'`,
    );
    const columnNames = columns.map((row) => String(row.column_name));
    for (const key of BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS) {
      assert.equal(columnNames.includes(key), false, `${key} must not be a br_receita_snapshots column`);
    }
  });

  // ── PR #368 pre-merge correction B ──────────────────────────────────────
  it('a partition-creation failure rolls back the run INSERT — no orphan preparing run', async () => {
    const period = '2026-12';

    // 🔴 A baseline to prove nothing ELSE moved: an already-published run and the total count of
    // partition relations, taken BEFORE the forced failure.
    const publishedBefore = await readPublished('2026-07', CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(publishedBefore.status, 'FOUND');
    const runsBefore = await rowsOf(
      `SELECT count(*)::int AS n FROM public.source_snapshot_runs
        WHERE source_key = $1 AND source_period = $2`,
      [BR_RECEITA_CNPJ_SOURCE_KEY, period],
    );
    assert.equal(Number(runsBefore[0].n), 0, 'nothing must exist for this period yet');
    const partitionsBefore = await rowsOf(
      `SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'br_receita_snapshots_p%'`,
    );

    // A SQL port that lets BEGIN and the run INSERT reach the REAL database, then fails the very
    // next statement — the call to `br_receita_begin_run_partition` — before it ever executes.
    // Everything else (BEGIN, the INSERT, and the ROLLBACK the gateway issues in response) is real
    // PostgreSQL, on the same connection CASE 1 through CASE 8 already used.
    const poisonedSql: BrReceitaSqlExecutor = {
      async query(sql, params) {
        if (sql.includes('br_receita_begin_run_partition')) {
          throw new Error('SIMULATED_PARTITION_CREATE_FAILURE');
        }
        return client.query(sql, params ? [...params] : undefined);
      },
    };
    const gateway = createBrReceitaSqlWriteGateway(poisonedSql);

    await assert.rejects(
      () =>
        gateway.beginPeriodRun({
          kind: 'begin_period',
          table: 'source_snapshot_runs',
          source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
          country_code: 'BR',
          source_period: period,
          publish_state: 'preparing',
          runProvenance: sampleBrReceitaRunProvenance(),
          returnsRunId: true,
          resolvesRunHandle: true,
        }),
      (error: unknown) => (error as { reason?: string }).reason === 'begin_period_partition_failed',
    );

    // 🔴 ORPHAN_PREPARING_RUNS_AFTER_FAILURE = 0. The INSERT reached PostgreSQL for real, and the
    // ROLLBACK the gateway issued on the SAME transaction undid it — there is no run row at all,
    // published, preparing, or otherwise, for this period.
    const runsAfter = await rowsOf(
      `SELECT count(*)::int AS n FROM public.source_snapshot_runs
        WHERE source_key = $1 AND source_period = $2`,
      [BR_RECEITA_CNPJ_SOURCE_KEY, period],
    );
    assert.equal(Number(runsAfter[0].n), 0, 'ORPHAN_PREPARING_RUNS_AFTER_FAILURE must be 0');

    // 🔴 ORPHAN_PARTITIONS_AFTER_FAILURE = 0. `br_receita_begin_run_partition` never ran — the
    // fault fired on the call that would have invoked it — but the count is asserted directly
    // rather than merely inferred from the interception point.
    const partitionsAfter = await rowsOf(
      `SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'br_receita_snapshots_p%'`,
    );
    assert.equal(Number(partitionsAfter[0].n), Number(partitionsBefore[0].n));

    // 🔴 Published runs unchanged; the previous publication unchanged.
    const publishedAfter = await readPublished('2026-07', CNPJ_TECNOLOGIA_MATRIZ);
    assert.equal(publishedAfter.status, 'FOUND');
    assert.equal(publishedAfter.snapshotRunId, publishedBefore.snapshotRunId);
    assert.equal(publishedAfter.snapshot?.legal_name, publishedBefore.snapshot?.legal_name);
  });
});
