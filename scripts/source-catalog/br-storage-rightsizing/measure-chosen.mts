/**
 * BR PROD STORAGE RIGHT-SIZING — the AUTHORITATIVE measurement of the CHOSEN design.
 *
 * Applies the REAL migration chain plus `134_br_receita_compact_snapshot.sql`, then loads REAL
 * Receita 2026-07 rows through the REAL writer (plan → executor → gateway), including the real
 * partition lifecycle: detached child, bulk upsert, sorted read-path index, attach-on-publish.
 * Sizes come from pg_relation_size / pg_indexes_size after a VACUUM ANALYZE.
 *
 * 🔴 There is no hand-written schema here and no hand-written INSERT. What is measured is what the
 * product would actually write.
 *
 * 🔴 NO Production. NO remote database. NO network. NO migration ledger. Everything lives in an
 * ephemeral data directory this script creates and deletes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapPlatform,
  BR_RECEITA_COMPACT_CHAIN,
  resolveEmbeddedPostgres,
  type PgLikeClient,
} from '../../../src/server/source-catalog/__tests__/support/source-snapshot-identity-real-migration-chain';
import {
  resolveCutERealDataset,
  extractCutERealSample,
  buildCutERealSnapshots,
  CUT_E_DEFAULT_BOUNDS,
  CUT_E_REAL_PERIOD,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/__tests__/support/br-receita-cut-e-real-sample';
import { toBrReceitaPersistedSnapshot } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-identity';
import { planBrReceitaMonthlySnapshotWrite } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-write-plan';
import { sampleBrReceitaRunProvenance } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-fixtures';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-write-gateway';
import { executeBrReceitaMonthlySnapshotWrite } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-executor';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Receita 2026-07's national ESTABELECIMENTOS count, as the owner measured it. */
const NATIONAL_ESTABLISHMENTS = 72_318_975;

const TARGET = Number(process.env.BR_SAMPLE_ROWS ?? '120000');
const MB_PER_PART = Number(process.env.BR_MB_PER_PART ?? '48');
const PORT = Number(process.env.BR_PG_PORT ?? '54941');
const COMPANY_WINDOW_MB = Number(process.env.BR_COMPANY_WINDOW_MB ?? '160');
const KEY_BANDS = Number(process.env.BR_KEY_BANDS ?? '64');
const GB = 1024 ** 3;

const { ctor } = resolveEmbeddedPostgres(import.meta.url);
if (ctor === null) throw new Error('embedded-postgres not installed');

const resolved = await resolveCutERealDataset();
if (resolved.skip !== false) throw new Error(`dataset unavailable: ${resolved.skip}`);

console.error('extracting the real bounded sample...');
const sample = await extractCutERealSample(resolved.layout, {
  ...CUT_E_DEFAULT_BOUNDS,
  maxBytesPerEstablishmentPart: MB_PER_PART * 1024 * 1024,
  maxAcceptedEstablishments: TARGET,
  maxBytesPerCompanyWindow: COMPANY_WINDOW_MB * 1024 * 1024,
  maxKeyBands: KEY_BANDS,
});
const built = buildCutERealSnapshots(sample);
console.error(`the real builder accepted ${built.snapshots.length} of ${built.offeredRows} rows`);

const dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-chosen-'));
const pg = new ctor({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
});
await pg.initialise();
await pg.start();
const db: PgLikeClient = pg.getPgClient();
await db.connect();

console.error('applying the real chain + the LOCAL compact migration...');
await bootstrapPlatform(db);
await applyRealChain(db, REPO_ROOT, BR_RECEITA_COMPACT_CHAIN);

const sqlPort: BrReceitaSqlExecutor = {
  query: (statement, params) => db.query(statement, params ? [...params] : undefined),
};

console.error('publishing through the REAL writer...');
const planned = planBrReceitaMonthlySnapshotWrite({
  sourcePeriod: CUT_E_REAL_PERIOD,
  records: built.snapshots.map(toBrReceitaPersistedSnapshot),
  runProvenance: sampleBrReceitaRunProvenance(),
  batchSize: 500,
});
if (planned.status !== 'planned') throw new Error(`plan refused: ${JSON.stringify(planned)}`);

const execution = await executeBrReceitaMonthlySnapshotWrite({
  plan: planned.plan,
  gateway: createBrReceitaSqlWriteGateway(sqlPort),
});
if (execution.status !== 'published') {
  throw new Error(`publish failed: ${JSON.stringify(execution.failure)}`);
}
const runId = execution.snapshotRunId!;

const { rows: named } = await db.query(
  'SELECT public.br_receita_run_partition_name($1::uuid) AS name',
  [runId],
);
const partition = String(named[0].name);

await db.query(`VACUUM (ANALYZE) public.${partition}`);

const { rows: counted } = await db.query(
  `SELECT count(*)::bigint AS n FROM public.br_receita_snapshots WHERE snapshot_run_id = $1`,
  [runId],
);
const rowCount = Number(counted[0].n);
if (rowCount !== built.snapshots.length) {
  throw new Error(`published ${rowCount} rows, builder accepted ${built.snapshots.length}`);
}

const { rows: sizes } = await db.query(
  `SELECT pg_relation_size($1::regclass)       AS heap,
          pg_indexes_size($1::regclass)        AS idx,
          pg_total_relation_size($1::regclass) AS total`,
  [`public.${partition}`],
);
const { rows: perIndex } = await db.query(
  `SELECT indexrelname AS name, pg_relation_size(indexrelid) AS bytes
     FROM pg_stat_user_indexes WHERE relname = $1 ORDER BY 2 DESC`,
  [partition],
);

const heapPerRow = Number(sizes[0].heap) / rowCount;
const indexPerRow = Number(sizes[0].idx) / rowCount;
const totalPerRow = Number(sizes[0].total) / rowCount;

// A run that is still `preparing` has no read-path index yet: it carries the heap, the primary key
// and the free-space/visibility maps only. That is what the third concurrent copy costs during a
// monthly refresh.
const pkBytes = Number(
  perIndex.find((row) => String(row.name).endsWith('_pkey'))?.bytes ?? 0,
);
const nameIdxBytes = Number(sizes[0].idx) - pkBytes;
const mapsPerRow = totalPerRow - heapPerRow - indexPerRow;
const preparingPerRow = heapPerRow + pkBytes / rowCount + mapsPerRow;

const gbFor = (bytesPerRow: number) => (bytesPerRow * NATIONAL_ESTABLISHMENTS) / GB;

const onePeriodGB = gbFor(totalPerRow);
const twoPeriodsGB = onePeriodGB * 2;
const refreshPeakGB = onePeriodGB * 2 + gbFor(preparingPerRow);

console.log('\n════════ CHOSEN DESIGN — measured on real Receita 2026-07 ════════');
console.log(`sample rows published through the real writer : ${rowCount.toLocaleString('en-US')}`);
console.log(`partition                                     : ${partition}`);
console.log('');
console.log(`COMPACT_HEAP_BYTES_PER_ROW                    : ${heapPerRow.toFixed(2)}`);
console.log(`COMPACT_INDEX_BYTES_PER_ROW                   : ${indexPerRow.toFixed(2)}`);
console.log(`COMPACT_TOTAL_BYTES_PER_ROW                   : ${totalPerRow.toFixed(2)}`);
console.log(`  · fsm/vm maps                               : ${mapsPerRow.toFixed(2)}`);
for (const row of perIndex) {
  console.log(
    `  · index ${String(row.name).padEnd(56)}: ${(Number(row.bytes) / rowCount).toFixed(2)} B/row`,
  );
}
console.log('');
console.log(`national establishments                       : ${NATIONAL_ESTABLISHMENTS.toLocaleString('en-US')}`);
console.log(`ONE_PERIOD_GB                                 : ${onePeriodGB.toFixed(2)}`);
console.log(`TWO_PERIODS_GB                                : ${twoPeriodsGB.toFixed(2)}`);
console.log(`REFRESH_PEAK_GB (current + previous + preparing): ${refreshPeakGB.toFixed(2)}`);
console.log(`  · a preparing run costs                     : ${preparingPerRow.toFixed(2)} B/row  (${gbFor(preparingPerRow).toFixed(2)} GB)`);
console.log(`  · because its read-path index is deferred   : ${(nameIdxBytes / rowCount).toFixed(2)} B/row not yet built`);

console.log(
  '\n' +
    JSON.stringify(
      {
        sampleRows: rowCount,
        nationalEstablishments: NATIONAL_ESTABLISHMENTS,
        compactHeapBytesPerRow: +heapPerRow.toFixed(2),
        compactIndexBytesPerRow: +indexPerRow.toFixed(2),
        compactTotalBytesPerRow: +totalPerRow.toFixed(2),
        preparingBytesPerRow: +preparingPerRow.toFixed(2),
        onePeriodGB: +onePeriodGB.toFixed(2),
        twoPeriodsGB: +twoPeriodsGB.toFixed(2),
        refreshPeakGB: +refreshPeakGB.toFixed(2),
        indexes: Object.fromEntries(
          perIndex.map((row) => [String(row.name), +(Number(row.bytes) / rowCount).toFixed(2)]),
        ),
        meters: sample.meters,
        builderSummary: built.summary,
      },
      null,
      2,
    ),
);

await db.end();
await pg.stop();
rmSync(dataDir, { recursive: true, force: true });
