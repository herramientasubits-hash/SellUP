/**
 * BR-PROD-STORAGE-RIGHT-SIZING — the compact projection and publication-generation retention.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The measurement that motivated this work lives in
 * `scripts/source-catalog/br-storage-rightsizing/`. This suite defends the two claims a
 * measurement cannot make:
 *
 *   1. the compact row is LOSSLESS for every runtime consumer — the twelve business signals an
 *      Agent1 enrichment receives come back from typed columns exactly as they came out of the
 *      jsonb, key for key and value for value;
 *   2. retention cannot delete a publication a live run may still be reading — and that this is
 *      enforced in the DATABASE, under a row lock, rather than by a caller who remembers to check.
 *
 * 🔴 NO Production. NO remote database. NO apply_migration. NO providers. NO credits. NO flags.
 * Every CNPJ here is synthetic and DV-valid by construction.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapPlatform,
  BR_RECEITA_COMPACT_CHAIN,
  BR_RECEITA_COMPACT_MIGRATION,
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
  RAIZ_TECNOLOGIA,
} from '../br-receita-cnpj-fixtures';
import {
  BR_RECEITA_COMPACT_CONFLICT_COLUMNS,
  BR_RECEITA_COMPACT_PERSISTED_COLUMNS,
  BR_RECEITA_COMPACT_READ_COLUMNS,
  BR_RECEITA_COMPACT_STORAGE_CONTRACT,
  BR_RECEITA_COMPACT_TABLE,
  BR_RECEITA_CONSTANT_SIGNALS,
  BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS,
  brReceitaCompactRowBindings,
  brReceitaRunProvenanceMetadata,
  brReceitaRuntimeSignalsFromRawData,
  brReceitaRuntimeSignalsFromRow,
} from '../br-receita-cnpj-compact-storage';
import {
  BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE,
  BR_RECEITA_REPUBLISH_STORAGE_PREFLIGHT_CONTRACT,
  checkBrReceitaRepublishStorage,
  decideBrReceitaRepublishStorage,
} from '../br-receita-cnpj-republish-storage-preflight';
import {
  BR_RECEITA_RETAINED_PUBLICATION_GENERATIONS,
  BR_RECEITA_RETENTION_CONTRACT,
  brReceitaRetainedPeriods,
  decideBrReceitaRetention,
  retireBrReceitaSnapshotRun,
} from '../br-receita-cnpj-snapshot-retention';
import { toBrReceitaPersistedSnapshot } from '../br-receita-cnpj-monthly-snapshot-identity';
import { planBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import { executeBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-executor';
import { pinBrReceitaPublication } from '../br-receita-cnpj-pinned-publication';
import { readBrReceitaPinnedSnapshot } from '../br-receita-cnpj-pinned-snapshot-reader';
import { enrichBrReceitaCnpjCandidate } from '../br-receita-cnpj-enrichment-adapter';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { ctor: EmbeddedPostgresCtor, skip: harnessSkip } = resolveEmbeddedPostgres(import.meta.url);

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-PROD-STORAGE-RIGHT-SIZING — the compact row is lossless for every consumer', () => {
  const parsed = buildBrReceitaCnpjSnapshotRows(sampleParserInput());

  it('every persisted signal column round-trips through the physical shape', () => {
    for (const row of parsed.snapshots) {
      const before = brReceitaRuntimeSignalsFromRawData(row.raw_data);
      const bindings = brReceitaCompactRowBindings({
        snapshot_run_id: '11111111-1111-4111-8111-111111111111',
        source_period: row.source_period,
        normalized_tax_id: row.normalized_tax_id,
        legal_name: row.legal_name,
        normalized_legal_name: null,
        signals: before,
      });

      // Rebuild the row the way a driver hands it back: column name → bound value.
      const asRow: Record<string, unknown> = {};
      BR_RECEITA_COMPACT_PERSISTED_COLUMNS.forEach((column, index) => {
        asRow[column] = bindings[index];
      });

      assert.deepEqual(brReceitaRuntimeSignalsFromRow(asRow), before);
    }
  });

  it('the bindings are positionally aligned with the column list, one per column', () => {
    const bindings = brReceitaCompactRowBindings({
      snapshot_run_id: '11111111-1111-4111-8111-111111111111',
      source_period: '2026-07',
      normalized_tax_id: parsed.snapshots[0].normalized_tax_id,
      legal_name: 'X',
      normalized_legal_name: 'X',
      signals: brReceitaRuntimeSignalsFromRawData(parsed.snapshots[0].raw_data),
    });
    assert.equal(bindings.length, BR_RECEITA_COMPACT_PERSISTED_COLUMNS.length);
    assert.equal(bindings[BR_RECEITA_COMPACT_PERSISTED_COLUMNS.indexOf('normalized_tax_id')],
      parsed.snapshots[0].normalized_tax_id);
  });

  it('a multi-code CNAE list survives being one text column', () => {
    const signals = {
      ...brReceitaRuntimeSignalsFromRawData(parsed.snapshots[0].raw_data),
      cnae_secondary_codes: ['6202300', '6204000', '6209100'],
    };
    const bindings = brReceitaCompactRowBindings({
      snapshot_run_id: '11111111-1111-4111-8111-111111111111',
      source_period: '2026-07',
      normalized_tax_id: parsed.snapshots[0].normalized_tax_id,
      legal_name: null,
      normalized_legal_name: null,
      signals,
    });
    const column = bindings[BR_RECEITA_COMPACT_PERSISTED_COLUMNS.indexOf('cnae_secondary_codes')];
    assert.equal(column, '6202300,6204000,6209100');
    assert.deepEqual(
      brReceitaRuntimeSignalsFromRow({ cnae_secondary_codes: column }).cnae_secondary_codes,
      ['6202300', '6204000', '6209100'],
    );
    // 🔴 The separator is safe because the parser splits on `[^A-Za-z0-9]+`: no element can hold a
    // comma. An element that somehow did would come back SPLIT, so the property is asserted rather
    // than assumed.
    for (const code of signals.cnae_secondary_codes) {
      assert.equal(code.includes(','), false);
    }
  });

  it('an empty CNAE list is NULL on the way in and an empty array on the way out', () => {
    const bindings = brReceitaCompactRowBindings({
      snapshot_run_id: '11111111-1111-4111-8111-111111111111',
      source_period: '2026-07',
      normalized_tax_id: parsed.snapshots[0].normalized_tax_id,
      legal_name: null,
      normalized_legal_name: null,
      signals: {
        ...brReceitaRuntimeSignalsFromRawData(parsed.snapshots[0].raw_data),
        cnae_secondary_codes: [],
      },
    });
    assert.equal(bindings[BR_RECEITA_COMPACT_PERSISTED_COLUMNS.indexOf('cnae_secondary_codes')], null);
    assert.deepEqual(brReceitaRuntimeSignalsFromRow({}).cnae_secondary_codes, []);
  });

  it('the two constants are RECONSTRUCTED, never read off the row', () => {
    const signals = brReceitaRuntimeSignalsFromRow({});
    assert.equal(signals.source_type, 'official_registry');
    assert.equal(signals.human_review_required, true);
    // And they are not persistable at all: there is no column for either.
    assert.equal(BR_RECEITA_COMPACT_PERSISTED_COLUMNS.includes('source_type'), false);
    assert.equal(BR_RECEITA_COMPACT_PERSISTED_COLUMNS.includes('human_review_required'), false);
    assert.deepEqual(Object.keys(BR_RECEITA_CONSTANT_SIGNALS).sort(), [
      'human_review_required',
      'source_type',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-PROD-STORAGE-RIGHT-SIZING — what LEFT the row, and where it went', () => {
  it('no import provenance is persisted per row', () => {
    for (const key of BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS) {
      assert.equal(
        BR_RECEITA_COMPACT_PERSISTED_COLUMNS.includes(key),
        false,
        `${key} describes the import, not the company`,
      );
      assert.equal(BR_RECEITA_COMPACT_READ_COLUMNS.includes(key), false);
    }
  });

  it('run-level provenance is built for the run row, once, and keeps every field', () => {
    assert.deepEqual(
      brReceitaRunProvenanceMetadata({
        parser_version: 'br-receita-cnpj-local-sample@1',
        source_file_name: 'estabelecimentos0.csv',
        source_downloaded_at: '2026-07-12T09:18:00.000Z',
        import_batch_id: '22222222-2222-4222-8222-222222222222',
      }),
      {
        parser_version: 'br-receita-cnpj-local-sample@1',
        source_file_name: 'estabelecimentos0.csv',
        source_downloaded_at: '2026-07-12T09:18:00.000Z',
        import_batch_id: '22222222-2222-4222-8222-222222222222',
      },
    );
    // Optional fields stay optional: an absent one is absent, never an empty string.
    assert.deepEqual(brReceitaRunProvenanceMetadata({ parser_version: 'v1' }), {
      parser_version: 'v1',
    });
    assert.equal(
      BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceLivesOn,
      'source_snapshot_runs.metadata',
    );
  });

  it('the redundant and never-read columns are gone', () => {
    for (const column of [
      'source_key',
      'country_code',
      'source_year',
      'id',
      'imported_at',
      'priority_score',
      'signals',
      'financials',
      'raw_data',
      'source_row_index',
      'sector',
      'city',
      'department',
      'region',
    ]) {
      assert.equal(
        BR_RECEITA_COMPACT_PERSISTED_COLUMNS.includes(column),
        false,
        `${column} must not be persisted per row`,
      );
    }
  });

  it('privacy: exactly ONE persisted representation of the CNPJ, and nowhere for a second', () => {
    const taxColumns = BR_RECEITA_COMPACT_PERSISTED_COLUMNS.filter((c) => /tax|cnpj/i.test(c));
    assert.deepEqual(taxColumns, ['normalized_tax_id']);
    // Exact names first: `tax_id` is a COLUMN NAME, not a substring — `normalized_tax_id` is the
    // one representation GATE-4A permits and legitimately contains those characters.
    for (const exact of ['tax_id', 'record_identity_key', 'raw_data']) {
      assert.equal(
        BR_RECEITA_COMPACT_PERSISTED_COLUMNS.includes(exact),
        false,
        `${exact} must not be a column`,
      );
    }
    for (const forbidden of [
      'socio',
      'qsa',
      'cpf',
      'telefone',
      'correio',
      'logradouro',
      'numero',
      'complemento',
      'bairro',
      'cep',
      'fax',
      'ddd',
      'nome_fantasia',
    ]) {
      assert.equal(
        BR_RECEITA_COMPACT_PERSISTED_COLUMNS.some((c) => c.includes(forbidden)),
        false,
        `${forbidden} has no column to land in`,
      );
    }
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.identityRepresentationCount, 1);
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.persistsJsonb, false);
  });

  it('the index list is justified by the runtime queries, and indexes no NULL placeholder', () => {
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.indexes.length, 2);
    assert.deepEqual(
      [...BR_RECEITA_COMPACT_STORAGE_CONTRACT.indexes[0].columns],
      ['snapshot_run_id', 'normalized_tax_id'],
    );
    assert.deepEqual(
      [...BR_RECEITA_COMPACT_STORAGE_CONTRACT.indexes[1].columns],
      ['snapshot_run_id', 'normalized_legal_name'],
    );
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.indexesNullPlaceholderColumns, false);
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.copiesGenericSnapshotIndexes, false);
    // The write arbiter is the primary key, which is the first index.
    assert.deepEqual(
      [...BR_RECEITA_COMPACT_CONFLICT_COLUMNS],
      [...BR_RECEITA_COMPACT_STORAGE_CONTRACT.indexes[0].columns],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-PROD-STORAGE-RIGHT-SIZING — retention decides by GENERATION, never by a clock', () => {
  const RUN = '33333333-3333-4333-8333-333333333333';
  const published = ['2026-05', '2026-06', '2026-07'];

  it('keeps exactly two generations, newest first', () => {
    assert.equal(BR_RECEITA_RETAINED_PUBLICATION_GENERATIONS, 2);
    assert.deepEqual(brReceitaRetainedPeriods(published), ['2026-07', '2026-06']);
    // Lexicographic order IS chronological order for the canonical fixed-width grain.
    assert.deepEqual(brReceitaRetainedPeriods(['2026-01', '2026-10', '2026-09']), ['2026-10', '2026-09']);
    // Malformed periods are dropped rather than sorted into the answer.
    assert.deepEqual(brReceitaRetainedPeriods(['2026-13', 'nonsense', '2026-07']), ['2026-07']);
  });

  it('the CURRENT published period is never retirable', () => {
    const decision = decideBrReceitaRetention(
      { snapshotRunId: RUN, sourcePeriod: '2026-07', publishState: 'published' },
      published,
    );
    assert.equal(decision.verdict, 'keep_current_generation');
    assert.equal(decision.mayDrop, false);
  });

  it('the PREVIOUS published period is never retirable — a live run may be pinned to it', () => {
    const decision = decideBrReceitaRetention(
      { snapshotRunId: RUN, sourcePeriod: '2026-06', publishState: 'published' },
      published,
    );
    assert.equal(decision.verdict, 'keep_previous_generation');
    assert.equal(decision.mayDrop, false);
    assert.match(decision.reason, /may_still_be_pinned/);
  });

  it('a SUPERSEDED run of a retained period is protected on the same terms', () => {
    // 🔴 The sharp edge. A same-period republish demotes run A, and the pinned reader does NOT
    // re-check publish_state — so a batch pinned to A still reads A. "Superseded means nobody
    // needs it" would delete exactly what a live run is reading.
    for (const period of ['2026-07', '2026-06']) {
      const decision = decideBrReceitaRetention(
        { snapshotRunId: RUN, sourcePeriod: period, publishState: 'superseded' },
        published,
      );
      assert.equal(decision.mayDrop, false, `superseded run of ${period} must survive`);
    }
    // …and a superseded run of an OLDER period is retirable, like its period.
    assert.equal(
      decideBrReceitaRetention(
        { snapshotRunId: RUN, sourcePeriod: '2026-05', publishState: 'superseded' },
        published,
      ).mayDrop,
      true,
    );
  });

  it('a run that never reached publication is always retirable — no pin can name it', () => {
    for (const state of ['preparing', 'failed', 'rolled_back']) {
      const decision = decideBrReceitaRetention(
        { snapshotRunId: RUN, sourcePeriod: '2026-07', publishState: state },
        published,
      );
      assert.equal(decision.verdict, 'retire_never_published');
      assert.equal(decision.mayDrop, true);
    }
  });

  it('an unrecognised period FAILS CLOSED rather than reading as "old"', () => {
    // "I was not given that period" is not the same fact as "that period is old".
    assert.equal(
      decideBrReceitaRetention(
        { snapshotRunId: RUN, sourcePeriod: '2026-04', publishState: 'published' },
        published,
      ).mayDrop,
      false,
    );
    assert.equal(
      decideBrReceitaRetention(
        { snapshotRunId: RUN, sourcePeriod: '2026-07', publishState: 'published' },
        [],
      ).mayDrop,
      false,
    );
    assert.equal(
      decideBrReceitaRetention(
        { snapshotRunId: RUN, sourcePeriod: 'not-a-period', publishState: 'published' },
        published,
      ).verdict,
      'keep_unknown_period',
    );
  });

  it('🔴 every status the SQL can return is a status the TypeScript union knows', () => {
    // This exact drift already happened once: the migration grew
    // `refused_indeterminate_retention` and `retireBrReceitaSnapshotRun` still mapped it to
    // `unexpected_status` — safe, but INDISTINGUISHABLE from a real refusal, so a caller could not
    // tell "the database protected this run" from "something went wrong". The guard is derived
    // from the SQL rather than hand-listed, so the next status cannot slip through either.
    const sql = readFileSync(
      join(repoRoot, 'supabase/migrations', BR_RECEITA_COMPACT_MIGRATION),
      'utf8',
    );
    const dropFn = sql.slice(
      sql.indexOf('FUNCTION public.br_receita_drop_run_partition'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.br_receita_same_period_republish_storage_check'),
    );
    assert.ok(dropFn.length > 200, 'the drop function body must have been located');

    const emitted = [
      ...dropFn.matchAll(/'status',\s*'([a-z_]+)'/g),
      ...dropFn.matchAll(/jsonb_build_object\('status',\s*'([a-z_]+)'\)/g),
    ].map((m) => m[1]);
    assert.ok(emitted.length >= 5, `expected several statuses, saw ${emitted.length}`);

    const known: readonly string[] = [
      'dropped',
      'already_absent',
      'refused_retained_generation',
      'refused_indeterminate_retention',
      'run_not_found',
      'invalid_input',
    ];
    for (const status of new Set(emitted)) {
      assert.ok(known.includes(status), `SQL emits '${status}' but the reader does not know it`);
    }

    // And the reverse: a status the reader claims to know but the SQL never emits is dead weight
    // that would make the union look more defensive than it is.
    for (const status of known) {
      assert.ok(emitted.includes(status), `the reader knows '${status}' but the SQL never emits it`);
    }
  });

  it('no time TTL is invented, and the contract says why', () => {
    assert.equal(BR_RECEITA_RETENTION_CONTRACT.usesATimeTtl, false);
    assert.equal(BR_RECEITA_RETENTION_CONTRACT.authoritativeRunLifetimeExistsInRepository, false);
    assert.equal(BR_RECEITA_RETENTION_CONTRACT.acceptsAPeriodArgument, false);
    assert.equal(BR_RECEITA_RETENTION_CONTRACT.hasAPeriodWideVariant, false);
    assert.equal(BR_RECEITA_RETENTION_CONTRACT.guardEnforcedIn, 'database_function');
    // The signature is what forbids "delete the month": there is no period parameter to pass.
    assert.equal(retireBrReceitaSnapshotRun.length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-PROD-STORAGE-RIGHT-SIZING — against a REAL PostgreSQL', () => {
  let postgres: EmbeddedPostgresLike | null = null;
  let client: PgLikeClient;
  let dataDir = '';

  const sql = (): BrReceitaSqlExecutor => ({
    query: (statement, params) => client.query(statement, params ? [...params] : undefined),
  });

  const publish = async (period: string, marker: string, supersedes?: string) => {
    const snapshots = buildBrReceitaCnpjSnapshotRows({
      ...sampleParserInput(),
      sourceYear: Number.parseInt(period.slice(0, 4), 10),
      sourcePeriod: period,
    })
      .snapshots.map(toBrReceitaPersistedSnapshot)
      .map((snapshot) => ({
        ...snapshot,
        payload: {
          ...snapshot.payload,
          signals: { ...snapshot.payload.signals, cnae_main_label: `Software (${marker})` },
        },
      }));

    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: period,
      records: snapshots,
      runProvenance: sampleBrReceitaRunProvenance(),
      supersedesPublishedRunId: supersedes,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');

    const execution = await executeBrReceitaMonthlySnapshotWrite({
      plan: planned.plan,
      gateway: createBrReceitaSqlWriteGateway(sql()),
    });
    assert.equal(execution.status, 'published', execution.failure?.reason);
    return execution.snapshotRunId!;
  };

  const partitionOf = async (runId: string): Promise<string> => {
    const { rows } = await client.query(
      'SELECT public.br_receita_run_partition_name($1::uuid) AS name',
      [runId],
    );
    return String(rows[0].name);
  };

  const partitionExists = async (runId: string): Promise<boolean> => {
    const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [
      `public.${await partitionOf(runId)}`,
    ]);
    return rows[0].present === true;
  };

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-compact-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54931,
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

  const maybe = harnessSkip === false ? it : it.skip;

  maybe('the compact migration is NUMBERED 134 and creates a partitioned table', async () => {
    // 🔴 BR-COMPACT-SNAPSHOT-PRODUCTIZATION: the migration is NUMBERED now, against a ceiling the
    // owner verified independently (origin/main tops out at 133, no open PR claims 134). The
    // assertion flips from "deliberately unnumbered" to "numbered 134 and nothing else", which is
    // the stricter of the two: an accidental renumber breaks it.
    assert.equal(BR_RECEITA_COMPACT_MIGRATION, '134_br_receita_compact_snapshot.sql');
    assert.equal(/^\d{3}_/.test(BR_RECEITA_COMPACT_MIGRATION), true);
    const { rows } = await client.query(
      `SELECT relkind FROM pg_class WHERE oid = 'public.br_receita_snapshots'::regclass`,
    );
    // 'p' = partitioned table.
    assert.equal(rows[0].relkind, 'p');
  });

  maybe('the table carries the two justified indexes and no jsonb column', async () => {
    const { rows: columns } = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [BR_RECEITA_COMPACT_TABLE],
    );
    const names = columns.map((c) => String(c.column_name)).sort();
    assert.deepEqual(names, [...BR_RECEITA_COMPACT_PERSISTED_COLUMNS].sort());
    assert.equal(
      columns.some((c) => String(c.data_type).includes('json')),
      false,
      'a jsonb column is where a forbidden field would hide',
    );

    const { rows: indexes } = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,
      [BR_RECEITA_COMPACT_TABLE],
    );
    assert.equal(indexes.length, 2, 'exactly the primary key and the name index');
  });

  maybe('a PREPARING run is physically present and structurally unreachable', async () => {
    const gateway = createBrReceitaSqlWriteGateway(sql());
    const started = await gateway.beginPeriodRun({
      kind: 'begin_period',
      table: 'source_snapshot_runs',
      source_key: 'br_receita_cnpj_dados_abertos',
      country_code: 'BR',
      source_period: '2026-09',
      publish_state: 'preparing',
      runProvenance: sampleBrReceitaRunProvenance(),
      returnsRunId: true,
      resolvesRunHandle: true,
    });

    assert.match(started.partitionTable, /^br_receita_snapshots_p[0-9a-f]{32}$/);

    const attached = await client.query(
      `SELECT count(*)::int AS n FROM pg_inherits
        WHERE inhrelid = ('public.' || $1)::regclass
          AND inhparent = 'public.br_receita_snapshots'::regclass`,
      [started.partitionTable],
    );
    assert.equal(Number(attached.rows[0].n), 0, 'a preparing run is DETACHED');

    // Clean it away so the retention cases start from a known set of periods.
    const dropped = await client.query('SELECT public.br_receita_drop_run_partition($1::uuid) AS o', [
      started.snapshotRunId,
    ]);
    const outcome = dropped.rows[0].o as Record<string, unknown>;
    assert.equal(outcome.status, 'dropped');
  });

  maybe('publishing ATTACHES the month, and the adapter reads the same signals as before', async () => {
    const runJune = await publish('2026-06', 'JUN');

    const attached = await client.query(
      `SELECT count(*)::int AS n FROM pg_inherits
        WHERE inhrelid = ('public.' || $1)::regclass
          AND inhparent = 'public.br_receita_snapshots'::regclass`,
      [await partitionOf(runJune)],
    );
    assert.equal(Number(attached.rows[0].n), 1, 'a published run is ATTACHED');

    const reader = createPostgrestShimClient(client);
    const pinned = (await pinBrReceitaPublication({ client: reader })).publication;
    assert.ok(pinned);

    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const read = await readBrReceitaPinnedSnapshot({ client: reader, publication: pinned, cnpj });
    assert.equal(read.status, 'FOUND');
    assert.equal(read.snapshot?.signals.cnae_main_label, 'Software (JUN)');

    // And the ADAPTER's emitted signal set is unchanged: the same twelve keys Agent1 receives.
    const enriched = await enrichBrReceitaCnpjCandidate(
      { countryCode: 'BR', candidateTaxId: cnpj } as never,
      { publication: pinned, getClient: () => reader },
    );
    assert.equal(enriched.status, 'matched');
    assert.deepEqual(Object.keys(enriched.signals ?? {}).sort(), [
      'capital_social_value',
      'cnae_main_code',
      'cnae_main_label',
      'cnae_secondary_codes',
      'company_size_code',
      'matrix_branch_flag',
      'municipality_code',
      'municipality_name',
      'registration_status_code',
      'registration_status_label',
      'start_date',
      'uf',
    ]);
    assert.equal(enriched.metadata?.human_review_required, true);
    assert.equal(enriched.metadata?.source_type, 'official_registry');
  });

  maybe('the PREVIOUS publication stays readable while a NEW period is published', async () => {
    const reader = createPostgrestShimClient(client);

    // A run pins June, and only then does July publish.
    const pinnedToJune = (await pinBrReceitaPublication({ client: reader })).publication;
    assert.ok(pinnedToJune);
    assert.equal(pinnedToJune.sourcePeriod, '2026-06');

    await publish('2026-07', 'JUL');

    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const stillJune = await readBrReceitaPinnedSnapshot({
      client: reader,
      publication: pinnedToJune,
      cnpj,
    });
    assert.equal(stillJune.status, 'FOUND');
    assert.equal(stillJune.snapshot?.signals.cnae_main_label, 'Software (JUN)');

    // A fresh pin sees July.
    const pinnedToJuly = (await pinBrReceitaPublication({ client: reader })).publication;
    assert.equal(pinnedToJuly?.sourcePeriod, '2026-07');
    const july = await readBrReceitaPinnedSnapshot({
      client: reader,
      publication: pinnedToJuly!,
      cnpj,
    });
    assert.equal(july.snapshot?.signals.cnae_main_label, 'Software (JUL)');
  });

  maybe('retention REFUSES the current and the previous published periods', async () => {
    const runs = await client.query(
      `SELECT id, source_period FROM public.source_snapshot_runs
        WHERE source_key = 'br_receita_cnpj_dados_abertos' AND publish_state = 'published'
        ORDER BY source_period DESC`,
    );
    assert.deepEqual(
      runs.rows.map((r) => r.source_period),
      ['2026-07', '2026-06'],
    );

    for (const row of runs.rows) {
      const outcome = await retireBrReceitaSnapshotRun(sql(), String(row.id));
      assert.equal(
        outcome.status,
        'refused_retained_generation',
        `${String(row.source_period)} is a retained generation`,
      );
      assert.equal(await partitionExists(String(row.id)), true, 'nothing was dropped');
    }
  });

  maybe('a same-period republish keeps the SUPERSEDED run readable through its pin', async () => {
    const reader = createPostgrestShimClient(client);
    const pinnedToJulA = (await pinBrReceitaPublication({ client: reader })).publication;
    assert.ok(pinnedToJulA);
    const runJulA = pinnedToJulA.snapshotRunId;

    await publish('2026-07', 'JUL-B', runJulA);

    const state = await client.query('SELECT publish_state FROM public.source_snapshot_runs WHERE id = $1', [
      runJulA,
    ]);
    assert.equal(state.rows[0].publish_state, 'superseded');

    // 🔴 The pinned run's ROWS survive the demotion, and the pin still resolves against them.
    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const stillA = await readBrReceitaPinnedSnapshot({
      client: reader,
      publication: pinnedToJulA,
      cnpj,
    });
    assert.equal(stillA.status, 'FOUND');
    assert.equal(stillA.snapshot?.signals.cnae_main_label, 'Software (JUL)');

    // And retention refuses to drop it, because its PERIOD is still retained.
    const outcome = await retireBrReceitaSnapshotRun(sql(), runJulA);
    assert.equal(outcome.status, 'refused_retained_generation');
    assert.equal(outcome.publishState, 'superseded');
    assert.equal(await partitionExists(runJulA), true);
  });

  maybe('retention DROPS a publication older than the retained generations', async () => {
    await publish('2026-08', 'AUG');

    // Published now: 2026-08 (current), 2026-07 (previous), 2026-06 (older) — and June is the one
    // that becomes retirable, WITHOUT any period argument having been passed anywhere.
    const june = await client.query(
      `SELECT id FROM public.source_snapshot_runs
        WHERE source_key = 'br_receita_cnpj_dados_abertos' AND source_period = '2026-06'
          AND publish_state = 'published'`,
    );
    const runJune = String(june.rows[0].id);
    assert.equal(await partitionExists(runJune), true);

    const rowsBefore = await client.query(
      'SELECT count(*)::int AS n FROM public.br_receita_snapshots WHERE snapshot_run_id = $1',
      [runJune],
    );
    assert.ok(Number(rowsBefore.rows[0].n) > 0);

    const outcome = await retireBrReceitaSnapshotRun(sql(), runJune);
    assert.equal(outcome.status, 'dropped');
    assert.equal(outcome.sourcePeriod, '2026-06');
    assert.equal(await partitionExists(runJune), false);

    // The retained generations are untouched.
    for (const period of ['2026-08', '2026-07']) {
      const kept = await client.query(
        `SELECT count(*)::int AS n FROM public.br_receita_snapshots s
           JOIN public.source_snapshot_runs r ON r.id = s.snapshot_run_id
          WHERE r.source_period = $1`,
        [period],
      );
      assert.ok(Number(kept.rows[0].n) > 0, `${period} must survive`);
    }

    // A second call is idempotent, not an error.
    const again = await retireBrReceitaSnapshotRun(sql(), runJune);
    assert.ok(again.status === 'already_absent' || again.status === 'dropped');
  });

  maybe('retention refuses an unknown run and a NULL run rather than guessing', async () => {
    const unknown = await retireBrReceitaSnapshotRun(
      sql(),
      '99999999-9999-4999-8999-999999999999',
    );
    assert.equal(unknown.status, 'run_not_found');

    const { rows } = await client.query(
      'SELECT public.br_receita_drop_run_partition(NULL::uuid) AS o',
    );
    const outcome = rows[0].o as Record<string, unknown>;
    assert.equal(outcome.status, 'invalid_input');
  });

  // ── The repeated same-period republish storage guard, end to end ──────────

  maybe('🔴 the SECOND same-period republish will not start a national load on its own', async () => {
    // Two publications of ONE period leave two physical partitions of that period: the published
    // one and the superseded one that a pinned batch may still be reading. A THIRD would be a
    // third national partition — ~29 GB — that retention may not reclaim while the period is a
    // retained generation. So the load stops being automatic here, and says why.
    const first = await publish('2026-11', 'guard-first');
    const second = await publish('2026-11', 'guard-second', first);

    // Both partitions are PHYSICALLY present: that is what the guard counts.
    assert.equal(await partitionExists(first), true, 'superseded storage is retained');
    assert.equal(await partitionExists(second), true, 'published storage is present');

    const verdict = await checkBrReceitaRepublishStorage(sql(), '2026-11');
    assert.equal(verdict.status, 'requires_storage_review');
    assert.equal(verdict.code, BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE);
    assert.equal(verdict.mayStartNationalLoadAutomatically, false);
    assert.deepEqual(verdict.counts, { publishedRuns: 1, supersededRuns: 1 });

    // And it is not advice a caller may ignore: `beginPeriodRun` refuses.
    const gateway = createBrReceitaSqlWriteGateway(sql());
    await assert.rejects(
      () =>
        gateway.beginPeriodRun({
          kind: 'begin_period',
          table: 'source_snapshot_runs',
          source_key: 'br_receita_cnpj_dados_abertos',
          country_code: 'BR',
          source_period: '2026-11',
          publish_state: 'preparing',
          runProvenance: sampleBrReceitaRunProvenance(),
          returnsRunId: true,
          resolvesRunHandle: true,
        }),
      (error: unknown) =>
        (error as { reason?: string }).reason ===
        'repeated_same_period_republish_requires_storage_review',
    );

    // 🔴 The refusal WROTE NOTHING. No `preparing` run row was left behind for an operator to
    // wonder about, which is why the check runs before the INSERT rather than after it.
    const runs = await client.query(
      `SELECT count(*)::int AS n FROM public.source_snapshot_runs
        WHERE source_period = $1 AND publish_state = 'preparing'`,
      ['2026-11'],
    );
    assert.equal(Number(runs.rows[0].n), 0, 'a refused start leaves no staging run');

    // 🔴 And it removed nothing: both retained partitions are still there. The owner forbade
    // making room by deleting a superseded retained run, and nothing here does.
    assert.equal(await partitionExists(first), true);
    assert.equal(await partitionExists(second), true);
  });

  maybe('a human storage review, named per PERIOD, lets the load proceed', async () => {
    // The guard withholds the AUTOMATIC start; it does not forbid the republish. Naming the period
    // IS the review, recorded as an argument rather than as a flag somebody flipped.
    const gateway = createBrReceitaSqlWriteGateway(sql(), {
      repeatedSamePeriodRepublishStorageReviewedFor: ['2026-11'],
    });
    const started = await gateway.beginPeriodRun({
      kind: 'begin_period',
      table: 'source_snapshot_runs',
      source_key: 'br_receita_cnpj_dados_abertos',
      country_code: 'BR',
      source_period: '2026-11',
      publish_state: 'preparing',
      runProvenance: sampleBrReceitaRunProvenance(),
      returnsRunId: true,
      resolvesRunHandle: true,
    });
    assert.match(started.partitionTable, /^br_receita_snapshots_p[0-9a-f]{32}$/);

    // 🔴 The acknowledgment is scoped to the PERIOD it names and carries over to no other. A
    // blanket boolean would have authorized next month, which is the month nobody reviewed.
    const reviewedElsewhere = createBrReceitaSqlWriteGateway(sql(), {
      repeatedSamePeriodRepublishStorageReviewedFor: ['2026-12'],
    });
    await assert.rejects(
      () =>
        reviewedElsewhere.beginPeriodRun({
          kind: 'begin_period',
          table: 'source_snapshot_runs',
          source_key: 'br_receita_cnpj_dados_abertos',
          country_code: 'BR',
          source_period: '2026-11',
          publish_state: 'preparing',
          runProvenance: sampleBrReceitaRunProvenance(),
          returnsRunId: true,
          resolvesRunHandle: true,
        }),
      (error: unknown) =>
        (error as { reason?: string }).reason ===
        'repeated_same_period_republish_requires_storage_review',
    );

    // Clean up the staging run this test created so later assertions see a tidy period.
    await client.query(
      `DELETE FROM public.source_snapshot_runs WHERE id = $1`,
      [started.snapshotRunId],
    ).catch(() => undefined);
  });

  maybe('a period with ONE publication still starts automatically', async () => {
    // The guard must not fire on the ordinary case, or every first republish needs a human.
    const verdict = await checkBrReceitaRepublishStorage(sql(), '2026-09');
    assert.equal(verdict.status, 'ok');
    assert.equal(verdict.mayStartNationalLoadAutomatically, true);
    assert.equal(verdict.counts.supersededRuns, 0);
  });

  maybe('a malformed period is refused by the DATABASE too, not just by the caller', async () => {
    const { rows } = await client.query(
      'SELECT public.br_receita_same_period_republish_storage_check($1::text) AS o',
      ['2026-13'],
    );
    const outcome = rows[0].o as Record<string, unknown>;
    assert.equal(outcome.status, 'invalid_input');
  });

  maybe('🔴 a run whose storage is already GONE is not counted against a republish', async () => {
    // "Physically present" is the whole point of the count. A run row whose partition was dropped
    // occupies no disk, and counting it would withhold a republish over space nobody is using.
    const older = await publish('2026-05', 'phys-old');
    const newer = await publish('2026-05', 'phys-new', older);
    assert.equal(
      (await checkBrReceitaRepublishStorage(sql(), '2026-05')).status,
      'requires_storage_review',
    );

    // Age 2026-05 out of the retained generations, then retire the superseded run's storage.
    await publish('2027-01', 'phys-n1');
    await publish('2027-02', 'phys-n2');
    const retired = await retireBrReceitaSnapshotRun(sql(), older);
    assert.equal(retired.status, 'dropped');
    assert.equal(await partitionExists(older), false);
    assert.equal(await partitionExists(newer), true);

    // One physically-present publication left ⇒ the guard stands down.
    const after = await checkBrReceitaRepublishStorage(sql(), '2026-05');
    assert.equal(after.status, 'ok');
    assert.deepEqual(after.counts, { publishedRuns: 1, supersededRuns: 0 });
  });


  // ── Owner § 7 — what a reader does with a pin whose storage is gone ───────

  maybe('🔴 an OLD DROPPED pin FAILS CLOSED and is never re-resolved to another run', async () => {
    // Owner contract: periods older than PREVIOUS are outside the guaranteed pin-retention
    // window. A batch that still holds such a pin must NOT be quietly answered from whatever is
    // published now — that is a wrong answer wearing a correct answer's clothes.
    const reader = createPostgrestShimClient(client);
    const cnpj = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');

    const doomed = await publish('2027-03', 'DOOMED');
    const pinned = (await pinBrReceitaPublication({ client: reader })).publication;
    assert.ok(pinned);
    assert.equal(pinned.snapshotRunId, doomed, 'the pin must name the run we are about to drop');

    // It reads fine while its storage is present.
    const before = await readBrReceitaPinnedSnapshot({ client: reader, publication: pinned, cnpj });
    assert.equal(before.status, 'FOUND');

    // Age it out of the retained generations, then drop its storage.
    await publish('2027-04', 'NEXT-1');
    await publish('2027-05', 'NEXT-2');
    const dropped = await retireBrReceitaSnapshotRun(sql(), doomed);
    assert.equal(dropped.status, 'dropped');
    assert.equal(await partitionExists(doomed), false);

    // 🔴 FAIL CLOSED. Not FOUND, and the answer still names the run the batch pinned — so a
    // caller sees "your publication is gone", never "here is a different month's data".
    const after = await readBrReceitaPinnedSnapshot({ client: reader, publication: pinned, cnpj });
    assert.equal(after.status, 'NOT_IN_PINNED_PUBLICATION');
    assert.equal(after.snapshot, null);
    assert.equal(after.snapshotRunId, doomed);
    assert.equal(after.sourcePeriod, '2027-03');

    // The current publication DOES hold this establishment — which is exactly why answering from
    // it would have looked like success. The pinned reader never reaches for it.
    const current = (await pinBrReceitaPublication({ client: reader })).publication;
    assert.ok(current);
    assert.notEqual(current.snapshotRunId, doomed);
    const fresh = await readBrReceitaPinnedSnapshot({
      client: reader,
      publication: current,
      cnpj,
    });
    assert.equal(fresh.status, 'FOUND', 'the data exists elsewhere; the pin still refused it');
  });

  maybe('🔴 retention FAILS CLOSED when the retained generations cannot be computed', async () => {
    // A run that reached publication while the source has NO published period at all is a state
    // this system cannot explain. The nearest real cause is a `superseded` run whose successor was
    // rolled back — and a batch pinned to that run still reads its rows. "I cannot compute the
    // retained generations" must not be spent as "this run is old".
    const { rows: published } = await client.query(
      `SELECT id FROM public.source_snapshot_runs
        WHERE source_key = 'br_receita_cnpj_dados_abertos' AND publish_state = 'published'`,
    );
    const ids = published.map((r) => String(r.id));
    assert.ok(ids.length > 0, 'the fixture must have something published to take away');

    const victim = await publish('2027-06', 'INDET');
    await client.query(
      `UPDATE public.source_snapshot_runs SET publish_state = 'superseded' WHERE id = ANY($1::uuid[])`,
      [[...ids, victim]],
    );

    try {
      const { rows: retained } = await client.query(
        'SELECT count(*)::int AS n FROM public.br_receita_retained_periods()',
      );
      assert.equal(Number(retained[0].n), 0, 'the retained set must really be empty');

      const outcome = await retireBrReceitaSnapshotRun(sql(), victim);
      assert.equal(outcome.status, 'refused_indeterminate_retention');
      assert.equal(await partitionExists(victim), true, 'nothing was dropped');
    } finally {
      // Restore, so this deliberately-malformed state does not leak into another assertion.
      await client.query(
        `UPDATE public.source_snapshot_runs SET publish_state = 'published' WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    }
  });

});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-COMPACT-SNAPSHOT-PRODUCTIZATION — the repeated same-period republish storage guard', () => {
  const P = '2026-07';

  it('the FIRST same-period republish is untouched: one published, nothing superseded yet', () => {
    const verdict = decideBrReceitaRepublishStorage(P, { publishedRuns: 1, supersededRuns: 0 });
    assert.equal(verdict.status, 'ok');
    assert.equal(verdict.code, null);
    assert.equal(verdict.mayStartNationalLoadAutomatically, true);
  });

  it('a period with nothing published at all starts automatically', () => {
    const verdict = decideBrReceitaRepublishStorage(P, { publishedRuns: 0, supersededRuns: 0 });
    assert.equal(verdict.status, 'ok');
    assert.equal(verdict.mayStartNationalLoadAutomatically, true);
  });

  it('one published PLUS one superseded withholds the automatic start, with the owner code', () => {
    const verdict = decideBrReceitaRepublishStorage(P, { publishedRuns: 1, supersededRuns: 1 });
    assert.equal(verdict.status, 'requires_storage_review');
    assert.equal(verdict.code, 'REPEATED_SAME_PERIOD_REPUBLISH_REQUIRES_STORAGE_REVIEW');
    assert.equal(verdict.code, BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE);
    assert.equal(verdict.mayStartNationalLoadAutomatically, false);
    assert.deepEqual(verdict.counts, { publishedRuns: 1, supersededRuns: 1 });
  });

  it('more accumulation keeps withholding it — the guard does not expire after one refusal', () => {
    for (const superseded of [1, 2, 5]) {
      const verdict = decideBrReceitaRepublishStorage(P, {
        publishedRuns: 1,
        supersededRuns: superseded,
      });
      assert.equal(verdict.mayStartNationalLoadAutomatically, false, `superseded=${superseded}`);
    }
  });

  it('a malformed period is refused rather than counted', () => {
    for (const bad of ['2026-13', '2026-7', '202607', '', 'julio']) {
      const verdict = decideBrReceitaRepublishStorage(bad, {
        publishedRuns: 0,
        supersededRuns: 0,
      });
      assert.equal(verdict.status, 'invalid_input', bad);
      assert.equal(verdict.mayStartNationalLoadAutomatically, false, bad);
    }
  });

  it('🔴 unreadable counts FAIL CLOSED — a missing number is never read as zero', () => {
    // Zero is the PERMISSIVE answer here. If a column were renamed and the count arrived as
    // `undefined`, a lenient parse would silently authorize the very load this guard exists to
    // withhold. So an unreadable count is `unexpected_status`, not `ok`.
    for (const broken of [undefined, null, 'many', -1, 1.5, {}]) {
      const verdict = decideBrReceitaRepublishStorage(P, {
        publishedRuns: broken,
        supersededRuns: 1,
      });
      assert.equal(verdict.status, 'unexpected_status', String(broken));
      assert.equal(verdict.mayStartNationalLoadAutomatically, false, String(broken));
    }
  });

  it('a bigint count arriving as a STRING is read, not rejected', () => {
    // `pg` returns `count(*)` as a string unless a type parser says otherwise.
    const verdict = decideBrReceitaRepublishStorage(P, {
      publishedRuns: '1',
      supersededRuns: '2',
    });
    assert.equal(verdict.status, 'requires_storage_review');
    assert.deepEqual(verdict.counts, { publishedRuns: 1, supersededRuns: 2 });
  });

  it('the contract states the bounds the owner drew, as data', () => {
    const c = BR_RECEITA_REPUBLISH_STORAGE_PREFLIGHT_CONTRACT;
    assert.equal(c.code, 'REPEATED_SAME_PERIOD_REPUBLISH_REQUIRES_STORAGE_REVIEW');
    // Allowed, not forbidden: only the AUTOMATIC start is withheld.
    assert.equal(c.samePeriodRepublishIsStillAllowed, true);
    assert.equal(c.forbidsTheRepublish, false);
    assert.equal(c.withholdsTheAutomaticStart, true);
    // The two things the owner explicitly ruled out.
    assert.equal(c.deletesASupersededRetainedRunToMakeRoom, false);
    assert.equal(c.infersActivePins, false);
    // A preflight that wrote something would not be a preflight.
    assert.equal(c.writesAnything, false);
  });
});
