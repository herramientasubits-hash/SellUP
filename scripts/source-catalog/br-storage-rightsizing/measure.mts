/**
 * BR PROD STORAGE RIGHT-SIZING — REAL storage measurement.
 *
 * Boots an EPHEMERAL local PostgreSQL, applies the REAL repository migration chain for the
 * baseline, and inserts the SAME real Receita 2026-07 rows into each candidate physical schema.
 * Sizes come from pg_relation_size / pg_indexes_size AFTER the inserts and a VACUUM ANALYZE.
 *
 * 🔴 NO Production. NO remote database. NO network. NO migration ledger. Nothing is written
 * outside the ephemeral data directory this script creates and deletes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapPlatform,
  REPO_DERIVED_REAL_CHAIN,
  resolveEmbeddedPostgres,
  type PgLikeClient,
} from '../../../src/server/source-catalog/__tests__/support/source-snapshot-identity-real-migration-chain';
import {
  resolveCutERealDataset,
  extractCutERealSample,
  buildCutERealSnapshots,
  CUT_E_DEFAULT_BOUNDS,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/__tests__/support/br-receita-cut-e-real-sample';
import { normalizeBrCompanyLegalName } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-name-normalization';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const NATIONAL_ESTABLISHMENTS = 72_318_975;
const TARGET = Number(process.env.BR_SAMPLE_ROWS ?? '100000');
const MB_PER_PART = Number(process.env.BR_MB_PER_PART ?? '40');
const PORT = Number(process.env.BR_PG_PORT ?? '54873');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD = '2026-07';
const YEAR = 2026;
const SOURCE_KEY = 'br_receita_cnpj_dados_abertos';
const COUNTRY = 'BR';

// Run-level provenance the production import would repeat on every row today.
const SOURCE_FILE_NAME = 'estabelecimentos0.csv';
const SOURCE_DOWNLOADED_AT = '2026-07-12T09:18:00.000Z';
const IMPORT_BATCH_ID = '22222222-2222-4222-8222-222222222222';

const { ctor } = resolveEmbeddedPostgres(import.meta.url);
if (ctor === null) throw new Error('embedded-postgres not installed');

const resolved = await resolveCutERealDataset();
if (resolved.skip !== false) throw new Error(`dataset unavailable: ${resolved.skip}`);

console.error('extracting real sample...');
const sample = await extractCutERealSample(resolved.layout, {
  ...CUT_E_DEFAULT_BOUNDS,
  maxBytesPerEstablishmentPart: MB_PER_PART * 1024 * 1024,
  maxAcceptedEstablishments: TARGET,
  maxBytesPerCompanyWindow: 160 * 1024 * 1024,
  maxKeyBands: 64,
});
const built = buildCutERealSnapshots(sample);
const rows = built.snapshots;
console.error(`built ${rows.length} real rows (offered ${built.offeredRows})`);

const dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-sizing-'));
const pg = new ctor({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
await pg.initialise();
await pg.start();
const db: PgLikeClient = pg.getPgClient();
await db.connect();

const results: Record<string, { heap: number; index: number; total: number; n: number; indexes: Record<string, number> }> = {};

async function measure(label: string, table: string, n: number) {
  await db.query(`VACUUM (ANALYZE) public.${table}`);
  const { rows: r } = await db.query(
    `SELECT pg_relation_size($1::regclass) AS heap,
            pg_indexes_size($1::regclass)  AS idx,
            pg_total_relation_size($1::regclass) AS total`,
    [`public.${table}`],
  );
  const { rows: ix } = await db.query(
    `SELECT indexrelname AS name, pg_relation_size(indexrelid) AS bytes
       FROM pg_stat_user_indexes WHERE relname = $1 ORDER BY 2 DESC`,
    [table],
  );
  const indexes: Record<string, number> = {};
  for (const row of ix) indexes[String(row.name)] = Number(row.bytes);
  results[label] = {
    heap: Number(r[0].heap),
    index: Number(r[0].idx),
    total: Number(r[0].total),
    n,
    indexes,
  };
}

const canon = (s: string | null) => {
  const c = normalizeBrCompanyLegalName(s);
  return c.status === 'valid' ? c.normalized : null;
};

// ═══════════════ BASELINE: today's generic schema, today's writer ═══════════════
console.error('applying real migration chain...');
await bootstrapPlatform(db);
await applyRealChain(db, REPO_ROOT, REPO_DERIVED_REAL_CHAIN);
await db.query(
  `INSERT INTO public.source_snapshot_runs (id, source_key, country_code, source_period, publish_state, status)
   VALUES ($1,$2,$3,$4,'published','completed')`,
  [RUN_ID, SOURCE_KEY, COUNTRY, PERIOD],
);

const BASELINE_COLS = [
  'source_key','country_code','source_year','source_period','snapshot_run_id',
  'normalized_tax_id','legal_name','normalized_legal_name','raw_data',
];

function baselineRawData(r: (typeof rows)[number]) {
  // Production repeats run-level provenance on every row; model it honestly.
  return { ...r.raw_data, source_file_name: SOURCE_FILE_NAME, source_downloaded_at: SOURCE_DOWNLOADED_AT, import_batch_id: IMPORT_BATCH_ID };
}

async function bulkInsert(table: string, cols: readonly string[], bind: (r: (typeof rows)[number]) => unknown[], chunk = 500) {
  const placeholders = (count: number) => {
    const groups: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const p: string[] = [];
      for (let c = 0; c < cols.length; c += 1) p.push(`$${i * cols.length + c + 1}`);
      groups.push(`(${p.join(',')})`);
    }
    return groups.join(',');
  };
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    for (const r of slice) params.push(...bind(r));
    await db.query(`INSERT INTO public.${table} (${cols.join(',')}) VALUES ${placeholders(slice.length)}`, params);
  }
}

async function bulkInsertUpsert(table: string, cols: readonly string[], bind: (r: (typeof rows)[number]) => unknown[], chunk = 500) {
  const placeholders = (count: number) => {
    const groups: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const p: string[] = [];
      for (let c = 0; c < cols.length; c += 1) p.push(`$${i * cols.length + c + 1}`);
      groups.push(`(${p.join(',')})`);
    }
    return groups.join(',');
  };
  const updates = cols
    .filter((c) => c !== 'snapshot_run_id' && c !== 'normalized_tax_id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    for (const r of slice) params.push(...bind(r));
    await db.query(
      `INSERT INTO public.${table} (${cols.join(',')}) VALUES ${placeholders(slice.length)}
       ON CONFLICT (snapshot_run_id, normalized_tax_id) DO UPDATE SET ${updates}`,
      params,
    );
  }
}

console.error('inserting BASELINE...');
await bulkInsert('source_company_snapshots', BASELINE_COLS, (r) => [
  SOURCE_KEY, COUNTRY, YEAR, PERIOD, RUN_ID,
  r.normalized_tax_id, r.legal_name, canon(r.legal_name), JSON.stringify(baselineRawData(r)),
]);
await measure('BASELINE_generic_today', 'source_company_snapshots', rows.length);

// ═══════════════ OPTION A: generic table, compact raw_data ═══════════════
// Same shared table, same shared indexes (they cannot be dropped without touching 10 other
// connectors). Only the row payload is compacted: run-level provenance and constants leave.
console.error('inserting OPTION A (generic compact)...');
await db.query('CREATE TABLE public.opt_a (LIKE public.source_company_snapshots INCLUDING ALL)');
// OPTION A must relax migration 127's BR CHECK: that clause is precisely the raw_data duplication
// of source_period this option removes. Recorded as a migration cost of OPTION A.
await db.query('ALTER TABLE public.opt_a DROP CONSTRAINT source_company_snapshots_br_receita_identity_chk');
await bulkInsert('opt_a', BASELINE_COLS, (r) => [
  SOURCE_KEY, COUNTRY, YEAR, PERIOD, RUN_ID,
  r.normalized_tax_id, r.legal_name, canon(r.legal_name),
  JSON.stringify({
    matrix_branch_flag: r.raw_data.matrix_branch_flag,
    company_size_code: r.raw_data.company_size_code,
    capital_social_value: r.raw_data.capital_social_value,
    registration_status_code: r.raw_data.registration_status_code,
    cnae_main_code: r.raw_data.cnae_main_code,
    cnae_main_label: r.raw_data.cnae_main_label,
    cnae_secondary_codes: r.raw_data.cnae_secondary_codes,
    municipality_code: r.raw_data.municipality_code,
    municipality_name: r.raw_data.municipality_name,
    uf: r.raw_data.uf,
    start_date: r.raw_data.start_date,
  }),
]);
await measure('OPTION_A_generic_compact', 'opt_a', rows.length);

// ═══════════════ OPTION B: dedicated BR table ═══════════════
console.error('inserting OPTION B (dedicated)...');
await db.query(`
  CREATE TABLE public.opt_b (
    snapshot_run_id          uuid NOT NULL,
    source_period            text NOT NULL,
    normalized_tax_id        text NOT NULL,
    legal_name               text,
    normalized_legal_name    text,
    matrix_branch_flag       text,
    company_size_code        text,
    capital_social_value     text,
    registration_status_code text,
    cnae_main_code           text,
    cnae_main_label          text,
    cnae_secondary_codes     text,
    municipality_code        text,
    municipality_name        text,
    uf                       text,
    start_date               text,
    PRIMARY KEY (snapshot_run_id, normalized_tax_id)
  )
`);
await db.query('CREATE INDEX opt_b_name_idx ON public.opt_b (snapshot_run_id, normalized_legal_name)');
const OPT_B_COLS = [
  'snapshot_run_id','source_period','normalized_tax_id','legal_name','normalized_legal_name',
  'matrix_branch_flag','company_size_code','capital_social_value','registration_status_code',
  'cnae_main_code','cnae_main_label','cnae_secondary_codes','municipality_code',
  'municipality_name','uf','start_date',
];
const optBBind = (r: (typeof rows)[number]) => [
  RUN_ID, PERIOD, r.normalized_tax_id, r.legal_name, canon(r.legal_name),
  r.raw_data.matrix_branch_flag, r.raw_data.company_size_code, r.raw_data.capital_social_value,
  r.raw_data.registration_status_code, r.raw_data.cnae_main_code, r.raw_data.cnae_main_label,
  r.raw_data.cnae_secondary_codes.length === 0 ? null : r.raw_data.cnae_secondary_codes.join(','),
  r.raw_data.municipality_code, r.raw_data.municipality_name, r.raw_data.uf, r.raw_data.start_date,
];
await bulkInsert('opt_b', OPT_B_COLS, optBBind);
await measure('OPTION_B_dedicated', 'opt_b', rows.length);

// ═══════════════ OPTION B2: dedicated + CNAE label moved to a per-run lookup ═══════════════
console.error('inserting OPTION B2 (dedicated, cnae label in lookup)...');
await db.query(`CREATE TABLE public.opt_b2 (LIKE public.opt_b INCLUDING ALL)`);
await db.query('ALTER TABLE public.opt_b2 DROP COLUMN cnae_main_label');
const OPT_B2_COLS = OPT_B_COLS.filter((c) => c !== 'cnae_main_label');
await bulkInsert('opt_b2', OPT_B2_COLS, (r) => {
  const v = optBBind(r);
  const i = OPT_B_COLS.indexOf('cnae_main_label');
  return v.filter((_, k) => k !== i);
});
await measure('OPTION_B2_dedicated_label_lookup', 'opt_b2', rows.length);

// ═══════ OPTION B3 / B4: same rows, read-path index BUILT AFTER the bulk load ═══════
// The name index serves only the read path (CUT C). It is not needed while a run is `preparing`,
// so building it once, by sort, after the rows land packs pages ~90% instead of splitting them
// ~50% under random-order inserts. The PK stays during the load: the upsert's ON CONFLICT and the
// one-row-per-identity contract depend on it.
console.error('inserting OPTION B3 (dedicated, name index built after load)...');
await db.query(`
  CREATE TABLE public.opt_b3 (
    snapshot_run_id          uuid NOT NULL,
    source_period            text NOT NULL,
    normalized_tax_id        text NOT NULL,
    legal_name               text,
    normalized_legal_name    text,
    matrix_branch_flag       text,
    company_size_code        text,
    capital_social_value     text,
    registration_status_code text,
    cnae_main_code           text,
    cnae_main_label          text,
    cnae_secondary_codes     text,
    municipality_code        text,
    municipality_name        text,
    uf                       text,
    start_date               text,
    PRIMARY KEY (snapshot_run_id, normalized_tax_id)
  )
`);
await bulkInsert('opt_b3', OPT_B_COLS, optBBind);
await db.query('CREATE INDEX opt_b3_name_idx ON public.opt_b3 (snapshot_run_id, normalized_legal_name)');
await measure('OPTION_B3_dedicated_deferred_name_index', 'opt_b3', rows.length);

console.error('inserting OPTION B4 (dedicated, label lookup, deferred name index)...');
await db.query('CREATE TABLE public.opt_b4 (LIKE public.opt_b3 INCLUDING ALL)');
await db.query('ALTER TABLE public.opt_b4 DROP COLUMN cnae_main_label');
await db.query('DROP INDEX IF EXISTS public.opt_b4_snapshot_run_id_normalized_legal_name_idx');
await bulkInsert('opt_b4', OPT_B2_COLS, (r) => {
  const v = optBBind(r);
  const i = OPT_B_COLS.indexOf('cnae_main_label');
  return v.filter((_, k) => k !== i);
});
await db.query('CREATE INDEX opt_b4_name_idx ON public.opt_b4 (snapshot_run_id, normalized_legal_name)');
await measure('OPTION_B4_dedicated_label_lookup_deferred_index', 'opt_b4', rows.length);

// ═══ OPTION B5: the chosen shape — dedicated, LIST-partitioned by snapshot_run_id ═══
// Loaded exactly as production would: a standalone child with a matching CHECK, bulk-loaded,
// read-path index built by sort, then ATTACHed without a validation scan.
console.error('inserting OPTION B5 (dedicated, partitioned by run)...');
await db.query(`
  CREATE TABLE public.opt_b5 (
    snapshot_run_id          uuid NOT NULL,
    source_period            text NOT NULL,
    normalized_tax_id        text NOT NULL,
    legal_name               text,
    normalized_legal_name    text,
    matrix_branch_flag       text,
    company_size_code        text,
    capital_social_value     text,
    registration_status_code text,
    cnae_main_code           text,
    cnae_main_label          text,
    cnae_secondary_codes     text,
    municipality_code        text,
    municipality_name        text,
    uf                       text,
    start_date               text,
    PRIMARY KEY (snapshot_run_id, normalized_tax_id)
  ) PARTITION BY LIST (snapshot_run_id)
`);
await db.query('CREATE INDEX opt_b5_name_idx ON public.opt_b5 (snapshot_run_id, normalized_legal_name)');
await db.query(`
  CREATE TABLE public.opt_b5_child (
    LIKE public.opt_b5 INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    CONSTRAINT opt_b5_child_run_chk CHECK (snapshot_run_id = '${RUN_ID}'::uuid),
    PRIMARY KEY (snapshot_run_id, normalized_tax_id)
  )
`);
// The PK exists DURING the load: the upsert's ON CONFLICT and the one-row-per-identity contract
// the reader's CARDINALITY_VIOLATION depends on are enforced by it, not by trust in the input.
await bulkInsertUpsert('opt_b5_child', OPT_B_COLS, optBBind);
// Only the read-path index is deferred. It is not needed while the run is `preparing`.
await db.query('CREATE INDEX opt_b5_child_name_idx ON public.opt_b5_child (snapshot_run_id, normalized_legal_name)');
const attachStart = process.hrtime.bigint();
await db.query(`ALTER TABLE public.opt_b5 ATTACH PARTITION public.opt_b5_child FOR VALUES IN ('${RUN_ID}')`);
const attachMs = Number(process.hrtime.bigint() - attachStart) / 1e6;
console.error(`  ATTACH took ${attachMs.toFixed(1)} ms`);
await measure('OPTION_B5_dedicated_partitioned_by_run', 'opt_b5_child', rows.length);

// ═══════════════ Report ═══════════════
const gb = (bytesPerRow: number) => (bytesPerRow * NATIONAL_ESTABLISHMENTS) / 1024 ** 3;
const out: Record<string, unknown> = {
  sample: { rows: rows.length, meters: sample.meters, summary: built.summary },
  nationalEstablishments: NATIONAL_ESTABLISHMENTS,
  variants: {},
};
console.log('\n════════ MEASURED (real PostgreSQL, after VACUUM ANALYZE) ════════');
for (const [label, m] of Object.entries(results)) {
  const heapPer = m.heap / m.n;
  const idxPer = m.index / m.n;
  const totalPer = m.total / m.n;
  (out.variants as Record<string, unknown>)[label] = {
    heapBytesPerRow: +heapPer.toFixed(2),
    indexBytesPerRow: +idxPer.toFixed(2),
    totalBytesPerRow: +totalPer.toFixed(2),
    onePeriodGB: +gb(totalPer).toFixed(2),
    indexes: Object.fromEntries(Object.entries(m.indexes).map(([k, v]) => [k, +(v / m.n).toFixed(2)])),
  };
  console.log(`\n${label}`);
  console.log(`  heap  B/row : ${heapPer.toFixed(2)}`);
  console.log(`  index B/row : ${idxPer.toFixed(2)}`);
  console.log(`  total B/row : ${totalPer.toFixed(2)}   (incl. TOAST + fsm/vm)`);
  console.log(`  ONE_PERIOD_GB (${NATIONAL_ESTABLISHMENTS.toLocaleString('en-US')} rows): ${gb(totalPer).toFixed(2)} GB`);
  for (const [k, v] of Object.entries(m.indexes)) console.log(`      idx ${k.padEnd(58)} ${(v / m.n).toFixed(2)} B/row`);
}
console.log('\n' + JSON.stringify(out, null, 2));

await db.end();
await pg.stop();
rmSync(dataDir, { recursive: true, force: true });
