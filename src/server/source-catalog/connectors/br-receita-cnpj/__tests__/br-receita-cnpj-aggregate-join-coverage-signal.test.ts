/**
 * BR Receita CNPJ ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL — tests
 * (BR-SOURCE-11H-IMPL).
 *
 * BR-SOURCE-11G-IMPL established that the protected technical join key can be parsed
 * ephemerally, compared in memory and discarded inside a 20-row / 40-row window.
 * BR-SOURCE-11H-IMPL widens that window — and nothing else — under the owner's phrase:
 *
 *     AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL
 *
 * These tests hold the line on what "ultra-bounded aggregate-only coverage SIGNAL" means:
 *   - the file surface is UNCHANGED: one file per required family, two data files, ever;
 *   - the window is 512 KB / 200 rows per file and 1,024,000 bytes / 400 rows per run — no more,
 *     and every one of those ceilings is enforced against a real over-cap input;
 *   - exactly ONE field position per row is parsed, the key window is capped, and it is released
 *     before the aggregate is emitted;
 *   - the outcome is a coarse BUCKET, and both `zero` and `not_reported` are GREEN results;
 *   - no exact percentage, no full-dataset denominator, no coverage proof, no coverage guarantee
 *     and no production inference exists anywhere — in a scan, a report, an error message, a
 *     rendered output, or the module source;
 *   - the 11H authorization is never inferred from the 11G one, in either direction, and the 11G
 *     probe modes keep their tighter window even when the wider caps are declared;
 *   - all eight gates stay `not_approved`, every scope flag stays `false`, and the report passes
 *     output sanitization unchanged.
 *
 * 100% synthetic. Every manifest and every CSV here is written by this suite into a temp
 * workspace it creates and removes. The staging-shaped directory names are LOCAL fixtures named
 * after the denylist entries so the refusals can be measured. No real Receita manifest, no real
 * data file, no operator directory, no dataset, no Supabase, no network, no runtime.
 *
 * Every cell this suite writes is an opaque `SYN…` token, so no identifier-shaped literal (8-,
 * 11- or 14-digit run) exists in this source file or in any fixture it creates. The join keys are
 * opaque `SYN_COV_ROOT_…` tokens that resemble no real root value.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_COVERAGE_ROWS_BUCKETS,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_DENOMINATOR_SCOPE,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_KEY_COLUMN_INDEX,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MATCH_RESULT_BUCKETS,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_PAIRS_EMITTED,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_ROWS_PRINTED,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MODE,
  BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
  BrazilReceitaAggregateJoinCoverageSignalError,
  createBrazilReceitaAggregateJoinCoverageSignal,
  type BrazilReceitaAggregateJoinCoverageSignalOptions,
  type BrazilReceitaAggregateJoinCoverageSignalReadRequest,
  type BrazilReceitaAggregateJoinCoverageSignalScan,
} from '../br-receita-cnpj-aggregate-join-coverage-signal';
import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE,
} from '../br-receita-cnpj-required-family-probe';
import {
  BRAZIL_RECEITA_FULL_JOIN_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunInput,
} from '../br-receita-cnpj-full-join-dry-run-runner';
import { createBrazilReceitaRealManifestMetadataReader } from '../br-receita-cnpj-real-manifest-metadata-reader';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';
import {
  ForbiddenFullJoinRunnerModeError,
  formatReportJson,
  parseFullJoinRunnerArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run';

// ─── Synthetic workspace (written and removed by this suite) ───────────────────

const WORKSPACE_PREFIX = 'br-source-11h-impl-aggregate-join-coverage-signal-test-';

const createdWorkspaces: string[] = [];

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  createdWorkspaces.push(root);
  return root;
}

afterEach(() => {
  while (createdWorkspaces.length > 0) {
    const directory = createdWorkspaces.pop()!;
    // Only ever a directory this suite created, directly under the OS temp root.
    if (path.basename(directory).startsWith(WORKSPACE_PREFIX)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** Opaque synthetic file labels. Never a real Receita filename. */
const SYNTHETIC_FILE_LABELS: Readonly<Record<string, string>> = {
  empresas: 'synthetic-empresas.csv',
  estabelecimentos: 'synthetic-estabelecimentos.csv',
  cnaes: 'synthetic-cnaes.csv',
  municipios: 'synthetic-municipios.csv',
  naturezas: 'synthetic-naturezas.csv',
  socios: 'synthetic-socios.csv',
};

/**
 * The opaque JOIN KEY tokens this suite uses. They occupy the join-key column position and
 * resemble no real root value: no digit run, no checksum, no length that could be mistaken for a
 * CNPJ básico. Overlap between the two windows is therefore fully controlled by the test.
 */
const OVERLAPPING_KEYS: readonly string[] = ['SYN_COV_ROOT_A', 'SYN_COV_ROOT_B'];
const DISJOINT_KEYS: readonly string[] = ['SYN_COV_ROOT_X', 'SYN_COV_ROOT_Y'];

/** An opaque non-key cell token. Small indices only, so no identifier-shaped run appears. */
function syntheticCell(family: string, row: number, column: number): string {
  return ['SYN', family.toUpperCase(), `R${row}`, `C${column}`].join('-');
}

/**
 * One synthetic headerless row with the official positional column count for `family`, whose
 * join-key column carries `joinKey` and whose every other column carries an opaque token.
 */
function syntheticRow(family: string, row: number, joinKey: string): string {
  const columns =
    BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS[
      family as keyof typeof BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS
    ]!;
  return Array.from({ length: columns }, (_unused, index) =>
    index === BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_KEY_COLUMN_INDEX
      ? joinKey
      : syntheticCell(family, row, index),
  ).join(';');
}

/** Writes a synthetic headerless CSV whose rows carry `joinKeys` in the join-key column. */
function writeCsv(
  root: string,
  family: string,
  joinKeys: readonly string[],
  fileName?: string,
): string {
  const relative = fileName ?? SYNTHETIC_FILE_LABELS[family] ?? `synthetic-${family}.csv`;
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = joinKeys.map((joinKey, index) => syntheticRow(family, index, joinKey)).join('\n');
  fs.writeFileSync(target, body === '' ? '' : `${body}\n`, { encoding: 'latin1' });
  return relative;
}

interface DeclaredFileFixture {
  readonly fileType: string;
  readonly path: string;
  readonly encoding?: string;
  readonly layoutMode?: string;
}

function manifestDocument(
  files: readonly DeclaredFileFixture[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
    files,
    ...overrides,
  };
}

function writeManifest(
  root: string,
  document: unknown,
  fileName = 'synthetic-manifest.json',
): string {
  const manifestPath = path.join(root, fileName);
  fs.writeFileSync(manifestPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8' });
  return manifestPath;
}

/**
 * The default workspace: a manifest declaring both required families (each with a real synthetic
 * CSV beside it) plus three catalog families whose files are DELIBERATELY not written. A run that
 * opened a catalog file would fail with a missing-file error, so the "catalogs are counted, never
 * opened" invariant is measured rather than asserted.
 */
function createCoverageWorkspace(
  options: {
    readonly empresasKeys?: readonly string[];
    readonly estabelecimentosKeys?: readonly string[];
    readonly extraFiles?: readonly DeclaredFileFixture[];
    readonly omitFamily?: string;
    readonly includeCatalogs?: boolean;
  } = {},
): { readonly root: string; readonly manifestPath: string } {
  const root = createWorkspace();
  const files: DeclaredFileFixture[] = [];
  for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
    if (options.omitFamily === family) continue;
    const keys =
      family === 'empresas'
        ? (options.empresasKeys ?? OVERLAPPING_KEYS)
        : (options.estabelecimentosKeys ?? OVERLAPPING_KEYS);
    files.push({
      fileType: family,
      path: writeCsv(root, family, keys),
      encoding: 'latin1',
      layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
    });
  }
  if (options.includeCatalogs !== false) {
    // Declared, counted, and NEVER written to disk: proof the signal does not open them.
    for (const family of ['cnaes', 'municipios', 'naturezas']) {
      files.push({ fileType: family, path: SYNTHETIC_FILE_LABELS[family]!, encoding: 'latin1' });
    }
  }
  files.push(...(options.extraFiles ?? []));
  return { root, manifestPath: writeManifest(root, manifestDocument(files)) };
}

/** A key list long enough to exceed the 11G window but stay inside the 11H one. */
function keyRun(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}_${index}`);
}

// ─── Caps and authorizations ──────────────────────────────────────────────────

const AUTHORIZED_CAPS = {
  maxManifestBytes: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES,
  maxFilesOpened: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED,
  maxBytesPerFile: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE,
  maxRowsPerFile: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE,
  maxTotalRows: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS,
  maxTotalBytes: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES,
  maxCoverageInputRows: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS,
  maxCoverageKeyValuesInMemory:
    BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY,
  maxCoveragePairsEmitted: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_PAIRS_EMITTED,
  maxCoverageRowsPrinted: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_ROWS_PRINTED,
} as const;

const READ_REQUEST: BrazilReceitaAggregateJoinCoverageSignalReadRequest = { ...AUTHORIZED_CAPS };

function signalOptions(
  manifestPath: string,
  overrides: Partial<BrazilReceitaAggregateJoinCoverageSignalOptions> = {},
): BrazilReceitaAggregateJoinCoverageSignalOptions {
  return {
    manifestPath,
    aggregateOnlyJoinCoverageSignalAuthorized: true,
    realLocalJoinCoverageSignalAuthorized: true,
    requiredFamilyJoinProbeAuthorized: true,
    realLocalJoinDryRunAuthorized: true,
    requiredFamilyProbeAuthorized: true,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    ...AUTHORIZED_CAPS,
    ...overrides,
  };
}

function runSignal(
  manifestPath: string,
  overrides: Partial<BrazilReceitaAggregateJoinCoverageSignalOptions> = {},
  request: BrazilReceitaAggregateJoinCoverageSignalReadRequest = READ_REQUEST,
): BrazilReceitaAggregateJoinCoverageSignalScan {
  return createBrazilReceitaAggregateJoinCoverageSignal(signalOptions(manifestPath, overrides))(
    request,
  );
}

function signalErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BrazilReceitaAggregateJoinCoverageSignalError);
    return (error as BrazilReceitaAggregateJoinCoverageSignalError).code;
  }
  return assert.fail('expected the coverage signal to refuse');
}

function rowsCounted(
  scan: BrazilReceitaAggregateJoinCoverageSignalScan,
  family: string,
): number {
  const shape = scan.rowShape[family];
  if (shape === undefined) return 0;
  return shape.rowShapeValidCount + shape.rowShapeInvalidCount;
}

// ─── The happy path: two files, two families, one bounded aggregate comparison ──

describe('BR-SOURCE-11H-IMPL coverage signal — bounded happy path', () => {
  it('passes a synthetic coverage signal with AGGREGATE-ONLY output', () => {
    const { manifestPath } = createCoverageWorkspace();
    const scan = runSignal(manifestPath);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.manifestTrust, BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST);
    assert.equal(scan.filesOpenedCount, 2);
    assert.deepEqual(scan.filesOpenedByFamily, { empresas: 1, estabelecimentos: 1 });
    assert.equal(scan.selectionClass, 'selected');
    assert.equal(scan.joinsExecuted, true);
    assert.equal(scan.coverageSignal.coverageSignalExecuted, true);
    assert.equal(
      scan.coverageSignal.coverageSignalMode,
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MODE,
    );
    assert.equal(
      scan.coverageSignal.denominatorScope,
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_DENOMINATOR_SCOPE,
    );
  });

  it('reports one_or_more when the two bounded windows overlap', () => {
    const { manifestPath } = createCoverageWorkspace({
      empresasKeys: OVERLAPPING_KEYS,
      estabelecimentosKeys: OVERLAPPING_KEYS,
    });
    const scan = runSignal(manifestPath);

    assert.equal(scan.coverageSignal.matchResultBucket, 'one_or_more');
    assert.equal(scan.coverageSignal.matchedRowsBucket, 'lte_200');
    assert.equal(scan.coverageSignal.unmatchedRowsBucket, 'zero');
  });

  it('allows a ZERO match bucket without failing — disjoint shards are a green result', () => {
    const { manifestPath } = createCoverageWorkspace({
      empresasKeys: OVERLAPPING_KEYS,
      estabelecimentosKeys: DISJOINT_KEYS,
    });
    const scan = runSignal(manifestPath);

    assert.equal(scan.refusalCode, null, 'zero overlap is not a refusal');
    assert.equal(scan.coverageSignal.coverageSignalExecuted, true);
    assert.equal(scan.coverageSignal.matchResultBucket, 'zero');
    assert.equal(scan.coverageSignal.matchedRowsBucket, 'zero');
    assert.equal(scan.coverageSignal.unmatchedRowsBucket, 'lte_200');
  });

  it('reports not_reported — also green — when one window yields no key', () => {
    const { manifestPath } = createCoverageWorkspace({ estabelecimentosKeys: [] });
    const scan = runSignal(manifestPath);

    assert.equal(scan.refusalCode, null, 'an empty comparison window is not a refusal');
    assert.equal(scan.coverageSignal.coverageSignalExecuted, false);
    assert.equal(scan.coverageSignal.matchResultBucket, 'not_reported');
    assert.equal(scan.coverageSignal.matchedRowsBucket, 'not_reported');
    assert.equal(scan.coverageSignal.unmatchedRowsBucket, 'not_reported');
    assert.equal(scan.joinsExecuted, false);
  });

  it('reads the WIDER window — a row count beyond the 11G ceiling is in bounds here', () => {
    const wide = BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE + 5;
    const keys = keyRun('SYN_COV_ROOT_W', wide);
    const { manifestPath } = createCoverageWorkspace({
      empresasKeys: keys,
      estabelecimentosKeys: keys,
    });
    const scan = runSignal(manifestPath);

    assert.equal(scan.refusalCode, null);
    for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
      assert.equal(rowsCounted(scan, family), wide);
      assert.ok(
        rowsCounted(scan, family) > BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE,
        'the 11H window is strictly wider than the 11G one',
      );
      assert.equal(scan.rowsReadBucket[family], 'lte_200');
      assert.equal(scan.bytesReadBucket[family], 'lte_512kb');
    }
    assert.equal(scan.coverageSignal.matchResultBucket, 'one_or_more');
  });

  it('stops reading at the row ceiling — a file beyond 200 rows is truncated, not refused', () => {
    const keys = keyRun(
      'SYN_COV_ROOT_T',
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE + 25,
    );
    const { manifestPath } = createCoverageWorkspace({
      empresasKeys: keys,
      estabelecimentosKeys: keys,
    });
    const scan = runSignal(manifestPath);

    for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
      assert.equal(
        rowsCounted(scan, family),
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE,
      );
      assert.equal(scan.rowsReadBucket[family], 'lte_200');
    }
  });

  it('classifies structure exactly as the probes did — the file surface is unchanged', () => {
    const { manifestPath } = createCoverageWorkspace();
    const scan = runSignal(manifestPath);

    for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
      assert.equal(scan.encodingStatus[family], 'ok');
      assert.equal(scan.delimiterStatus[family], 'semicolon_detected');
      assert.equal(scan.headerlessStatus[family], 'assumed_headerless');
      assert.equal(scan.rowShape[family]!.rowShapeInvalidCount, 0);
    }
  });

  it('counts catalog families without opening them, and holds every absence assertion', () => {
    const { manifestPath } = createCoverageWorkspace();
    const scan = runSignal(manifestPath);

    // The three catalog files were declared but never written: a run that opened one would have
    // thrown a missing-file read failure.
    assert.equal(scan.neverOpenedFamilyCount, 3);
    assert.equal(scan.forbiddenFamilyCount, 0);
    assert.equal(scan.rawRowsRetained, false);
    assert.equal(scan.rawCellsRetained, false);
    assert.equal(scan.identifiersRetained, false);
    assert.equal(scan.fileNamesRetained, false);
    assert.equal(scan.absolutePathsRetained, false);
    assert.equal(scan.hashesComputed, false);
    assert.equal(scan.joinCoverageComputed, false);
    assert.equal(scan.coverageSignal.joinKeyValuesPrinted, false);
    assert.equal(scan.coverageSignal.joinKeyValuesRetained, false);
    assert.equal(scan.coverageSignal.joinKeyHashesPrinted, false);
    assert.equal(scan.coverageSignal.joinKeyErrorLeak, false);
    assert.equal(scan.coverageSignal.joinedRowsPrinted, false);
    assert.equal(scan.coverageSignal.joinedSamplesPrinted, false);
    assert.equal(scan.coverageSignal.joinedPairsEmitted, 0);
    assert.equal(scan.coverageSignal.exactCoveragePercentagePrinted, false);
    assert.equal(scan.coverageSignal.fullDatasetDenominatorPrinted, false);
    assert.equal(scan.coverageSignal.coverageClaimed, false);
    assert.equal(scan.coverageSignal.productionInferenceAllowed, false);
  });

  it('parses ONE field position per row — a shifted key column produces no match', () => {
    // The same tokens, moved off the join-key column: if the module read any other position it
    // would find them, so a `zero` bucket here is proof that exactly one position is parsed.
    const root = createWorkspace();
    const shiftedRow = ['SYN-EMPRESAS-SHIFTED', ...OVERLAPPING_KEYS].join(';');
    const empresasFile = 'synthetic-empresas.csv';
    fs.writeFileSync(path.join(root, empresasFile), `${shiftedRow}\n`, { encoding: 'latin1' });
    const files: DeclaredFileFixture[] = [
      {
        fileType: 'empresas',
        path: empresasFile,
        encoding: 'latin1',
        layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
      },
      {
        fileType: 'estabelecimentos',
        path: writeCsv(root, 'estabelecimentos', OVERLAPPING_KEYS),
        encoding: 'latin1',
        layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
      },
    ];
    const scan = runSignal(writeManifest(root, manifestDocument(files)));

    assert.equal(scan.coverageSignal.coverageSignalExecuted, true);
    assert.equal(scan.coverageSignal.matchResultBucket, 'zero');
  });
});

// ─── What never leaves the module ─────────────────────────────────────────────

describe('BR-SOURCE-11H-IMPL coverage signal — aggregate-only output', () => {
  it('emits no join key, no raw row, no raw cell and no identifier anywhere in a scan', () => {
    const { manifestPath } = createCoverageWorkspace();
    const serialized = JSON.stringify(runSignal(manifestPath));

    for (const key of [...OVERLAPPING_KEYS, ...DISJOINT_KEYS]) {
      assert.ok(!serialized.includes(key), `a join key must never be emitted (${key})`);
    }
    assert.ok(!serialized.includes('SYN-EMPRESAS-'), 'no raw cell may be emitted');
    assert.ok(!serialized.includes('SYN-ESTABELECIMENTOS-'), 'no raw cell may be emitted');
    // A CNPJ básico, a full CNPJ or a CPF is an 8-, 14- or 11-digit run. None may appear.
    assert.ok(!/(?<!\d)\d{8,}(?!\d)/.test(serialized), 'no identifier-shaped digit run');
  });

  it('emits no filename, no path and no hash', () => {
    const { root, manifestPath } = createCoverageWorkspace();
    const serialized = JSON.stringify(runSignal(manifestPath));

    assert.ok(!serialized.includes(root), 'no absolute path');
    assert.ok(!serialized.includes('synthetic-manifest.json'), 'no manifest filename');
    assert.ok(!serialized.includes('.csv'), 'no data filename');
    assert.ok(!/(?<![a-f0-9])[a-f0-9]{32,}(?![a-f0-9])/i.test(serialized), 'no hash');
  });

  it('emits no exact percentage, no denominator, no proof, no guarantee, no inference', () => {
    const { manifestPath } = createCoverageWorkspace();
    const scan = runSignal(manifestPath);
    const serialized = JSON.stringify(scan);

    for (const forbidden of [
      '%',
      'percent',
      'coverage_proof',
      'coverageProof',
      'coverage_guarantee',
      'coverageGuarantee',
      'production_ready',
      'productionReady',
      'quality_score',
      'full_dataset_denominator_value',
    ]) {
      assert.ok(!serialized.includes(forbidden), `output must not carry "${forbidden}"`);
    }
    // The ONLY denominator named anywhere is the bounded window that was actually read.
    assert.equal(scan.coverageSignal.denominatorScope, 'bounded_window_only');
    // Bucket labels only: no count survives into the block, so no ratio can be reconstructed.
    const block = JSON.stringify(scan.coverageSignal);
    assert.ok(!/[1-9]/.test(block.replace(/lte_200/g, '')));
  });

  it('states buckets from the closed vocabularies, never a computed label', () => {
    const { manifestPath } = createCoverageWorkspace();
    const scan = runSignal(manifestPath);

    assert.ok(
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MATCH_RESULT_BUCKETS.includes(
        scan.coverageSignal.matchResultBucket,
      ),
    );
    for (const bucket of [
      scan.coverageSignal.matchedRowsBucket,
      scan.coverageSignal.unmatchedRowsBucket,
    ]) {
      assert.ok(
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_COVERAGE_ROWS_BUCKETS.includes(bucket),
      );
    }
  });

  it('carries no join key in a refusal message — an error is a fixed code and nothing else', () => {
    const { root } = createCoverageWorkspace();
    const code = signalErrorCode(() =>
      createBrazilReceitaAggregateJoinCoverageSignal(
        signalOptions(path.join(root, 'synthetic-manifest.json'), {
          aggregateOnlyJoinCoverageSignalAuthorized: undefined,
        }),
      ),
    );
    assert.equal(code, 'aggregate_join_coverage_signal_not_authorized');

    try {
      createBrazilReceitaAggregateJoinCoverageSignal(
        signalOptions(path.join(root, 'synthetic-manifest.json'), {
          aggregateOnlyJoinCoverageSignalAuthorized: undefined,
        }),
      );
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(!message.includes(root), 'a refusal never quotes a path');
      for (const key of OVERLAPPING_KEYS) assert.ok(!message.includes(key));
    }
  });
});

// ─── Authorizations: seven axes, none inferable from another ───────────────────

describe('BR-SOURCE-11H-IMPL coverage signal — authorizations', () => {
  it('requires the explicit 11H aggregate coverage authorization', () => {
    const { manifestPath } = createCoverageWorkspace();
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, {
            aggregateOnlyJoinCoverageSignalAuthorized: undefined,
          }),
        ),
      ),
      'aggregate_join_coverage_signal_not_authorized',
    );
  });

  it('requires the explicit real-local coverage authorization', () => {
    const { manifestPath } = createCoverageWorkspace();
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, { realLocalJoinCoverageSignalAuthorized: undefined }),
        ),
      ),
      'aggregate_join_coverage_signal_not_authorized',
    );
  });

  it('never infers the 11H authorization from the 11G one, in either direction', () => {
    const { manifestPath } = createCoverageWorkspace();
    // Holding EVERY 11F/11G declaration and neither 11H one buys no coverage signal.
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, {
            aggregateOnlyJoinCoverageSignalAuthorized: undefined,
            realLocalJoinCoverageSignalAuthorized: undefined,
          }),
        ),
      ),
      'aggregate_join_coverage_signal_not_authorized',
    );
    // And holding both 11H declarations without the 11G ones buys nothing either: the 11H phrase
    // widens a window, it does not authorize parsing a key.
    for (const dropped of [
      'requiredFamilyJoinProbeAuthorized',
      'realLocalJoinDryRunAuthorized',
      'requiredFamilyProbeAuthorized',
      'realManifestMetadataOnlyOptionBAuthorized',
      'realManifestMetadataOnlyExecutionAuthorized',
    ] as const) {
      assert.equal(
        signalErrorCode(() =>
          createBrazilReceitaAggregateJoinCoverageSignal(
            signalOptions(manifestPath, { [dropped]: undefined }),
          ),
        ),
        'aggregate_join_coverage_signal_not_authorized',
        `dropping ${dropped} must fail closed`,
      );
    }
  });
});

// ─── Caps: stated, bounded, and enforced against real inputs ───────────────────

describe('BR-SOURCE-11H-IMPL coverage signal — caps', () => {
  it('fails when any cap is missing', () => {
    const { manifestPath } = createCoverageWorkspace();
    for (const cap of Object.keys(AUTHORIZED_CAPS) as ReadonlyArray<keyof typeof AUTHORIZED_CAPS>) {
      assert.equal(
        signalErrorCode(() =>
          createBrazilReceitaAggregateJoinCoverageSignal(
            signalOptions(manifestPath, { [cap]: undefined }),
          ),
        ),
        'aggregate_join_coverage_signal_cap_required',
        `omitting ${cap} must fail closed`,
      );
    }
  });

  it('fails when any cap exceeds its ceiling — one case per ceiling', () => {
    const { manifestPath } = createCoverageWorkspace();
    const overCap: ReadonlyArray<readonly [keyof typeof AUTHORIZED_CAPS, number]> = [
      ['maxFilesOpened', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED + 1],
      ['maxBytesPerFile', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE + 1],
      ['maxRowsPerFile', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE + 1],
      ['maxTotalRows', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS + 1],
      ['maxTotalBytes', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES + 1],
      [
        'maxCoverageInputRows',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS + 1,
      ],
      [
        'maxCoverageKeyValuesInMemory',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY + 1,
      ],
      ['maxManifestBytes', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES + 1],
      ['maxDeclaredFiles', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES + 1],
    ];
    for (const [cap, value] of overCap) {
      assert.equal(
        signalErrorCode(() =>
          createBrazilReceitaAggregateJoinCoverageSignal(
            signalOptions(manifestPath, { [cap]: value }),
          ),
        ),
        'aggregate_join_coverage_signal_cap_exceeded',
        `${cap} above its ceiling must fail closed`,
      );
    }
  });

  it('treats the two join-output caps as EQUALITIES at zero, not ceilings', () => {
    const { manifestPath } = createCoverageWorkspace();
    for (const cap of ['maxCoveragePairsEmitted', 'maxCoverageRowsPrinted'] as const) {
      assert.equal(
        signalErrorCode(() =>
          createBrazilReceitaAggregateJoinCoverageSignal(
            signalOptions(manifestPath, { [cap]: 1 }),
          ),
        ),
        'aggregate_join_coverage_signal_join_output_forbidden',
        `${cap} above zero is an unauthorized capability, not a wider signal`,
      );
    }
  });

  it('refuses a READ that asks for more than the port was built with', () => {
    const { manifestPath } = createCoverageWorkspace();
    const narrow = createBrazilReceitaAggregateJoinCoverageSignal(
      signalOptions(manifestPath, { maxRowsPerFile: 5 }),
    );
    assert.throws(
      () => narrow({ ...READ_REQUEST }),
      BrazilReceitaAggregateJoinCoverageSignalError,
    );
  });

  it('bounds the in-memory key window, not just the row window', () => {
    const keys = keyRun('SYN_COV_ROOT_M', 40);
    const { manifestPath } = createCoverageWorkspace({
      empresasKeys: keys,
      estabelecimentosKeys: keys,
    });
    // A window of ONE key: only the first Empresas key is ever held, so most Estabelecimentos
    // rows are unmatched. The bucket still says nothing about how many.
    const scan = runSignal(
      manifestPath,
      { maxCoverageKeyValuesInMemory: 1 },
      { ...READ_REQUEST, maxCoverageKeyValuesInMemory: 1 },
    );
    assert.equal(scan.refusalCode, null);
    assert.equal(scan.coverageSignal.matchResultBucket, 'one_or_more');
    assert.equal(scan.coverageSignal.unmatchedRowsBucket, 'lte_200');
  });
});

// ─── Forbidden output requests ────────────────────────────────────────────────

describe('BR-SOURCE-11H-IMPL coverage signal — forbidden output requests', () => {
  it('fails closed on every raw / identifier / join output request', () => {
    const { manifestPath } = createCoverageWorkspace();
    const cases: ReadonlyArray<
      readonly [Partial<BrazilReceitaAggregateJoinCoverageSignalOptions>, string]
    > = [
      [{ includeRawRows: true }, 'aggregate_join_coverage_signal_raw_output_forbidden'],
      [{ includeRawCells: true }, 'aggregate_join_coverage_signal_raw_output_forbidden'],
      [{ includeSampleRows: true }, 'aggregate_join_coverage_signal_raw_output_forbidden'],
      [{ includeIdentifiers: true }, 'aggregate_join_coverage_signal_identifier_output_forbidden'],
      [
        { includeDeclaredFileNames: true },
        'aggregate_join_coverage_signal_identifier_output_forbidden',
      ],
      [{ includeHashes: true }, 'aggregate_join_coverage_signal_identifier_output_forbidden'],
      [{ includeJoinKeys: true }, 'aggregate_join_coverage_signal_join_output_forbidden'],
      [{ includeJoinedRows: true }, 'aggregate_join_coverage_signal_join_output_forbidden'],
      [{ includeJoinedSamples: true }, 'aggregate_join_coverage_signal_join_output_forbidden'],
      [{ includeJoinPairs: true }, 'aggregate_join_coverage_signal_join_output_forbidden'],
    ];
    for (const [overrides, expected] of cases) {
      assert.equal(
        signalErrorCode(() =>
          createBrazilReceitaAggregateJoinCoverageSignal(signalOptions(manifestPath, overrides)),
        ),
        expected,
        JSON.stringify(overrides),
      );
    }
  });

  it('fails closed when an EXACT coverage percentage is requested', () => {
    const { manifestPath } = createCoverageWorkspace();
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, { includeExactCoveragePercentage: true }),
        ),
      ),
      'aggregate_join_coverage_signal_exact_percentage_forbidden',
    );
  });

  it('fails closed when a FULL-DATASET denominator is requested', () => {
    const { manifestPath } = createCoverageWorkspace();
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, { includeFullDatasetDenominator: true }),
        ),
      ),
      'aggregate_join_coverage_signal_denominator_forbidden',
    );
  });

  it('fails closed when coverage PROOF or a coverage GUARANTEE is requested', () => {
    // Both are the same request under two names: a claim that a bounded window cannot support.
    const { manifestPath } = createCoverageWorkspace();
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, { claimCoverage: true }),
        ),
      ),
      'aggregate_join_coverage_signal_coverage_claim_forbidden',
    );
  });

  it('fails closed when a PRODUCTION-READINESS inference is requested', () => {
    const { manifestPath } = createCoverageWorkspace();
    assert.equal(
      signalErrorCode(() =>
        createBrazilReceitaAggregateJoinCoverageSignal(
          signalOptions(manifestPath, { allowProductionInference: true }),
        ),
      ),
      'aggregate_join_coverage_signal_production_inference_forbidden',
    );
  });
});

// ─── Family, archive and path refusals ────────────────────────────────────────

describe('BR-SOURCE-11H-IMPL coverage signal — refusals reported, never thrown', () => {
  it('refuses a Sócios / QSA / CPF / person family before opening anything', () => {
    for (const family of ['socios', 'socio', 'qsa', 'cpf_holders', 'representante']) {
      const { manifestPath } = createCoverageWorkspace({
        extraFiles: [{ fileType: family, path: `synthetic-${family}.csv`, encoding: 'latin1' }],
      });
      const scan = runSignal(manifestPath);
      assert.equal(scan.refusalCode, 'aggregate_join_coverage_signal_forbidden_family', family);
      assert.equal(scan.filesOpenedCount, 0, 'nothing is opened once a person family is declared');
      assert.equal(scan.coverageSignal.coverageSignalExecuted, false);
      assert.ok(!JSON.stringify(scan).includes(`synthetic-${family}.csv`));
    }
  });

  it('never opens a catalog family, even when it is the only extra declared', () => {
    // The catalog files are declared and never written. A green run proves they stayed shut.
    const { manifestPath } = createCoverageWorkspace();
    const scan = runSignal(manifestPath);
    assert.equal(scan.refusalCode, null);
    assert.equal(scan.filesOpenedCount, 2);
    assert.equal(scan.neverOpenedFamilyCount, 3);
    assert.deepEqual(Object.keys(scan.filesOpenedByFamily).sort(), [
      'empresas',
      'estabelecimentos',
    ]);
  });

  it('refuses a ZIP / archive extension for a required family', () => {
    const root = createWorkspace();
    const files: DeclaredFileFixture[] = [
      { fileType: 'empresas', path: 'synthetic-empresas.zip', encoding: 'latin1' },
      {
        fileType: 'estabelecimentos',
        path: writeCsv(root, 'estabelecimentos', OVERLAPPING_KEYS),
        encoding: 'latin1',
      },
    ];
    const scan = runSignal(writeManifest(root, manifestDocument(files)));
    assert.equal(scan.refusalCode, 'aggregate_join_coverage_signal_zip_forbidden');
    assert.equal(scan.selectionClass, 'declared_extension_archive');
    assert.equal(scan.filesOpenedCount, 0);
  });

  it('refuses a raw-zips staging segment in a declared path', () => {
    for (const segment of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS) {
      const root = createWorkspace();
      const files: DeclaredFileFixture[] = [
        { fileType: 'empresas', path: `${segment}/synthetic-empresas.csv`, encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', OVERLAPPING_KEYS),
          encoding: 'latin1',
        },
      ];
      const scan = runSignal(writeManifest(root, manifestDocument(files)));
      assert.equal(scan.refusalCode, 'aggregate_join_coverage_signal_open_failed', segment);
      assert.equal(scan.selectionClass, 'declared_path_zip_staging_segment');
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('refuses a missing required family, an absolute path and a traversing path', () => {
    const missing = runSignal(createCoverageWorkspace({ omitFamily: 'empresas' }).manifestPath);
    assert.equal(missing.refusalCode, 'aggregate_join_coverage_signal_missing_required_family');
    assert.equal(missing.selectionClass, 'family_not_declared');

    const root = createWorkspace();
    const absolute = runSignal(
      writeManifest(
        root,
        manifestDocument([
          { fileType: 'empresas', path: path.join(root, 'synthetic-empresas.csv') },
          {
            fileType: 'estabelecimentos',
            path: writeCsv(root, 'estabelecimentos', OVERLAPPING_KEYS),
          },
        ]),
      ),
    );
    assert.equal(absolute.refusalCode, 'aggregate_join_coverage_signal_open_failed');
    assert.equal(absolute.selectionClass, 'declared_path_absolute_or_url');

    const traversalRoot = createWorkspace();
    const traversal = runSignal(
      writeManifest(
        traversalRoot,
        manifestDocument([
          { fileType: 'empresas', path: '../outside-empresas.csv' },
          {
            fileType: 'estabelecimentos',
            path: writeCsv(traversalRoot, 'estabelecimentos', OVERLAPPING_KEYS),
          },
        ]),
      ),
    );
    assert.equal(traversal.refusalCode, 'aggregate_join_coverage_signal_open_failed');
    assert.equal(traversal.selectionClass, 'declared_path_outside_manifest_directory');
  });

  it('refuses a URL manifest and a non-json manifest at construction', () => {
    for (const badPath of ['https://example.invalid/manifest.json', '/tmp/manifest.csv']) {
      assert.equal(
        signalErrorCode(() =>
          createBrazilReceitaAggregateJoinCoverageSignal(signalOptions(badPath)),
        ),
        'aggregate_join_coverage_signal_open_failed',
        badPath,
      );
    }
  });

  it('reports a liveness deadline as a refusal, never as a partial signal', () => {
    const keys = keyRun('SYN_COV_ROOT_D', 30);
    const { manifestPath } = createCoverageWorkspace({
      empresasKeys: keys,
      estabelecimentosKeys: keys,
    });
    let tick = 0;
    const scan = runSignal(manifestPath, { nowMs: () => (tick += 60_000) });
    assert.equal(scan.refusalCode, 'aggregate_join_coverage_signal_timeout');
    assert.equal(scan.coverageSignal.coverageSignalExecuted, false);
    assert.equal(scan.coverageSignal.matchResultBucket, 'not_reported');
  });
});

// ─── Runner integration ───────────────────────────────────────────────────────

function runnerInput(
  manifestPath: string,
  overrides: Partial<BrazilReceitaFullJoinDryRunInput> = {},
): BrazilReceitaFullJoinDryRunInput {
  return {
    mode: 'local_manifest_dry_run',
    manifest: { declared: true },
    allowLocalManifest: true,
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    requiredFamilyProbeAuthorized: true,
    requiredFamilyJoinProbeAuthorized: true,
    realLocalJoinDryRunAuthorized: true,
    aggregateOnlyJoinCoverageSignalAuthorized: true,
    realLocalJoinCoverageSignalAuthorized: true,
    strict: true,
    outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
    ...AUTHORIZED_CAPS,
    realManifestMetadataReader: createBrazilReceitaRealManifestMetadataReader({
      manifestPath,
      realManifestMetadataOnlyOptionBAuthorized: true,
      realManifestMetadataOnlyExecutionAuthorized: true,
      maxManifestBytes: AUTHORIZED_CAPS.maxManifestBytes,
      maxDeclaredFiles: AUTHORIZED_CAPS.maxDeclaredFiles,
    }),
    aggregateJoinCoverageSignalReader: createBrazilReceitaAggregateJoinCoverageSignal(
      signalOptions(manifestPath),
    ),
    noWriteMode: true,
    runtimeIntegration: false,
    agent1Integration: false,
    supabaseWrite: false,
    providerCalls: false,
    importExecuted: false,
    productionWrites: false,
    ...overrides,
  } as BrazilReceitaFullJoinDryRunInput;
}

describe('BR-SOURCE-11H-IMPL coverage signal — runner integration', () => {
  it('returns an ok, aggregate, sanitized coverage-signal report', () => {
    const { manifestPath } = createCoverageWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.manifest_trust, BRAZIL_RECEITA_FULL_JOIN_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST);
    assert.equal(report.aggregate_join_coverage_signal_authorized, true);
    assert.equal(report.real_local_join_coverage_signal_authorized, true);
    assert.equal(report.required_family_probe, null);
    assert.equal(report.required_family_join_probe, null);
    assert.deepEqual(sanitizeBrazilReceitaFullJoinReport(report), { ok: true, findings: [] });

    const block = report.aggregate_join_coverage_signal!;
    assert.equal(block.authorized, true);
    assert.equal(block.real_local_join_coverage_signal_authorized, true);
    assert.equal(block.files_opened_count, 2);
    assert.deepEqual(block.files_opened_by_family, { empresas: 1, estabelecimentos: 1 });
    assert.equal(block.bytes_read_bucket.empresas, 'lte_512kb');
    assert.equal(block.rows_read_bucket.estabelecimentos, 'lte_200');
    assert.equal(block.selection_class, 'selected');
    assert.equal(block.never_opened_family_declared_count, 3);
    assert.equal(block.joins_executed, true);
    assert.equal(block.join_coverage_computed, false);
    assert.equal(block.full_dataset_processed, false);
  });

  it('reports the coverage block as a SIGNAL: buckets, scope, and no claim', () => {
    const { manifestPath } = createCoverageWorkspace();
    const signal = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath))
      .aggregate_join_coverage_signal!.coverage_signal;

    assert.equal(signal.coverage_signal_executed, true);
    assert.equal(signal.coverage_signal_mode, 'ultra_bounded_required_family_aggregate_only');
    assert.equal(signal.join_key_values_printed, false);
    assert.equal(signal.join_key_values_retained, false);
    assert.equal(signal.join_key_hashes_printed, false);
    assert.equal(signal.join_key_error_leak, false);
    assert.equal(signal.joined_rows_printed, false);
    assert.equal(signal.joined_samples_printed, false);
    assert.equal(signal.joined_pairs_emitted, 0);
    assert.equal(signal.exact_coverage_percentage_printed, false);
    assert.equal(signal.full_dataset_denominator_printed, false);
    assert.equal(signal.coverage_claimed, false);
    assert.equal(signal.production_inference_allowed, false);
    assert.equal(signal.denominator_scope, 'bounded_window_only');
    assert.equal(signal.match_result_bucket, 'one_or_more');
  });

  it('holds all eight gates not_approved, every scope flag false, every count zero', () => {
    const { manifestPath } = createCoverageWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    for (const status of Object.values(report.decision_status)) {
      assert.equal(status, 'not_approved');
    }
    for (const flag of Object.values(report.run_scope)) assert.equal(flag, false);
    for (const flag of Object.values(report.safety)) assert.equal(flag, false);
    for (const value of Object.values(report.aggregate_counts)) assert.equal(value, 0);
    for (const value of Object.values(report.eligibility_counts)) assert.equal(value, 0);
    for (const value of Object.values(report.join_counts)) assert.equal(value, 0);
    assert.equal(report.source_period, null);
  });

  it('refuses when either 11H declaration is absent, with its own code', () => {
    const { manifestPath } = createCoverageWorkspace();
    const cases: ReadonlyArray<readonly [Partial<BrazilReceitaFullJoinDryRunInput>, string]> = [
      [
        { aggregateOnlyJoinCoverageSignalAuthorized: undefined },
        'aggregate_join_coverage_signal_not_authorized',
      ],
      [
        { realLocalJoinCoverageSignalAuthorized: undefined },
        'real_local_join_coverage_signal_not_authorized',
      ],
      [{ requiredFamilyJoinProbeAuthorized: undefined }, 'required_family_join_probe_not_authorized'],
      [{ realLocalJoinDryRunAuthorized: undefined }, 'real_local_join_dry_run_not_authorized'],
      [{ requiredFamilyProbeAuthorized: undefined }, 'required_family_probe_not_authorized'],
    ];
    for (const [overrides, expected] of cases) {
      const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath, overrides));
      assert.equal(report.ok, false);
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'aggregate_join_coverage_signal_gate' },
      ]);
      assert.equal(report.aggregate_join_coverage_signal, null);
    }
  });

  it('fails when strict is missing, and on an unstated sanitizer version', () => {
    const { manifestPath } = createCoverageWorkspace();
    const cases: ReadonlyArray<readonly [Partial<BrazilReceitaFullJoinDryRunInput>, string]> = [
      [{ strict: false }, 'strict_mode_required'],
      [{ allowLocalManifest: false }, 'allow_local_manifest_required'],
      [{ outputSanitizationVersion: undefined }, 'output_sanitization_version_not_approved'],
    ];
    for (const [overrides, expected] of cases) {
      const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath, overrides));
      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some((error) => error.error_code === expected),
        `expected ${expected}, got ${JSON.stringify(report.errors)}`,
      );
    }
  });

  it('fails when a cap is missing, above its ceiling, or a positive join-output cap', () => {
    const { manifestPath } = createCoverageWorkspace();
    for (const cap of [
      'maxFilesOpened',
      'maxBytesPerFile',
      'maxRowsPerFile',
      'maxTotalRows',
      'maxTotalBytes',
      'maxCoverageInputRows',
      'maxCoverageKeyValuesInMemory',
      'maxCoveragePairsEmitted',
      'maxCoverageRowsPrinted',
    ] as const) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, { [cap]: undefined }),
      );
      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some(
          (error) => error.error_code === 'aggregate_join_coverage_signal_caps_required',
        ),
        `omitting ${cap} must fail closed`,
      );
    }

    const overCap: ReadonlyArray<readonly [string, number]> = [
      ['maxRowsPerFile', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE + 1],
      ['maxTotalRows', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS + 1],
      ['maxBytesPerFile', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE + 1],
      ['maxTotalBytes', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES + 1],
      ['maxFilesOpened', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED + 1],
      [
        'maxCoverageInputRows',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS + 1,
      ],
      [
        'maxCoverageKeyValuesInMemory',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY + 1,
      ],
    ];
    for (const [cap, value] of overCap) {
      const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath, { [cap]: value }));
      assert.equal(report.ok, false, cap);
      assert.ok(
        report.errors.some(
          (error) => error.error_code === 'aggregate_join_coverage_signal_cap_exceeded',
        ),
        `${cap}: ${JSON.stringify(report.errors)}`,
      );
    }

    for (const cap of ['maxCoveragePairsEmitted', 'maxCoverageRowsPrinted'] as const) {
      const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath, { [cap]: 1 }));
      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some(
          (error) => error.error_code === 'aggregate_join_coverage_signal_join_output_detected',
        ),
      );
    }

    const withoutReader = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, { aggregateJoinCoverageSignalReader: undefined }),
    );
    assert.equal(withoutReader.ok, false);
    assert.ok(
      withoutReader.errors.some(
        (error) => error.error_code === 'aggregate_join_coverage_signal_reader_required',
      ),
    );
  });

  it('refuses an escalation flag — the no-write guard runs before anything else', () => {
    const { manifestPath } = createCoverageWorkspace();
    for (const escalation of [
      { supabaseWrite: true },
      { runtimeIntegration: true },
      { agent1Integration: true },
      { providerCalls: true },
      { importExecuted: true },
    ]) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, escalation as Partial<BrazilReceitaFullJoinDryRunInput>),
      );
      assert.equal(report.ok, false);
      assert.equal(report.errors[0]!.stage, 'no_write_guard');
      assert.equal(report.aggregate_join_coverage_signal, null);
    }
  });

  it('refuses a port that claims an exact figure, a denominator, a claim or an inference', () => {
    const { manifestPath } = createCoverageWorkspace();
    const honest = runSignal(manifestPath);
    const claims: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [
        { exactCoveragePercentagePrinted: true },
        'aggregate_join_coverage_signal_exact_percentage_detected',
      ],
      [
        { fullDatasetDenominatorPrinted: true },
        'aggregate_join_coverage_signal_denominator_detected',
      ],
      [
        { denominatorScope: 'full_dataset' },
        'aggregate_join_coverage_signal_denominator_detected',
      ],
      [{ coverageClaimed: true }, 'aggregate_join_coverage_signal_coverage_claim_detected'],
      [
        { productionInferenceAllowed: true },
        'aggregate_join_coverage_signal_production_inference_detected',
      ],
      [
        { joinKeyValuesPrinted: true },
        'aggregate_join_coverage_signal_identifier_output_detected',
      ],
      [
        { joinKeyValuesRetained: true },
        'aggregate_join_coverage_signal_identifier_output_detected',
      ],
      [{ joinKeyHashesPrinted: true }, 'aggregate_join_coverage_signal_identifier_output_detected'],
      [{ joinKeyErrorLeak: true }, 'aggregate_join_coverage_signal_identifier_output_detected'],
      [{ joinedRowsPrinted: true }, 'aggregate_join_coverage_signal_join_output_detected'],
      [{ joinedSamplesPrinted: true }, 'aggregate_join_coverage_signal_join_output_detected'],
      [{ joinedPairsEmitted: 1 }, 'aggregate_join_coverage_signal_join_output_detected'],
      [
        { matchResultBucket: 'seventeen_percent' },
        'aggregate_join_coverage_signal_scan_invalid',
      ],
      [{ coverageSignalMode: 'full_join' }, 'aggregate_join_coverage_signal_scan_invalid'],
    ];
    for (const [claim, expected] of claims) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, {
          aggregateJoinCoverageSignalReader: () =>
            ({ ...honest, coverageSignal: { ...honest.coverageSignal, ...claim } }) as never,
        }),
      );
      assert.equal(report.ok, false, JSON.stringify(claim));
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'aggregate_join_coverage_signal_read' },
      ]);
      assert.equal(report.aggregate_join_coverage_signal, null);
    }
  });

  it('refuses a port that claims a row, a cell, a hash or a coverage computation', () => {
    const { manifestPath } = createCoverageWorkspace();
    const honest = runSignal(manifestPath);
    const claims: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ rawRowsRetained: true }, 'aggregate_join_coverage_signal_raw_output_detected'],
      [{ rawCellsRetained: true }, 'aggregate_join_coverage_signal_raw_output_detected'],
      [{ identifiersRetained: true }, 'aggregate_join_coverage_signal_raw_output_detected'],
      [{ fileNamesRetained: true }, 'aggregate_join_coverage_signal_raw_output_detected'],
      [{ absolutePathsRetained: true }, 'aggregate_join_coverage_signal_raw_output_detected'],
      [{ hashesComputed: true }, 'aggregate_join_coverage_signal_identifier_output_detected'],
      [
        { joinCoverageComputed: true },
        'aggregate_join_coverage_signal_coverage_claim_detected',
      ],
      [{ filesOpenedCount: 3 }, 'aggregate_join_coverage_signal_file_count_exceeded'],
      [
        { familiesAttempted: ['empresas', 'socios'] },
        'aggregate_join_coverage_signal_forbidden_family_detected',
      ],
      [
        { manifestTrust: 'real_manifest_required_family_join_probe' },
        'local_manifest_execution_not_authorized',
      ],
      [{ joinsExecuted: false }, 'aggregate_join_coverage_signal_not_executed'],
    ];
    for (const [claim, expected] of claims) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, {
          aggregateJoinCoverageSignalReader: () => ({ ...honest, ...claim }) as never,
        }),
      );
      assert.equal(report.ok, false, JSON.stringify(claim));
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'aggregate_join_coverage_signal_read' },
      ]);
    }
  });

  it('surfaces a not_reported signal as a REFUSAL of the report block, never as a claim', () => {
    const { manifestPath } = createCoverageWorkspace({ estabelecimentosKeys: [] });
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'aggregate_join_coverage_signal_not_executed',
        stage: 'aggregate_join_coverage_signal_read',
      },
    ]);
    assert.equal(report.aggregate_join_coverage_signal, null);
  });

  it('maps a port-reported refusal onto the runner vocabulary', () => {
    const { manifestPath } = createCoverageWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        aggregateJoinCoverageSignalReader: () =>
          ({
            ...runSignal(manifestPath),
            refusalCode: 'aggregate_join_coverage_signal_timeout',
          }) as never,
      }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'aggregate_join_coverage_signal_timeout',
        stage: 'aggregate_join_coverage_signal_read',
      },
    ]);
  });

  it('renders a report that carries no identifier, path, percentage or denominator', () => {
    const { root, manifestPath } = createCoverageWorkspace();
    const rendered = formatReportJson(runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath)));

    assert.ok(!rendered.includes(root));
    assert.ok(!rendered.includes('.csv'));
    assert.ok(!rendered.includes('%'));
    for (const key of OVERLAPPING_KEYS) assert.ok(!rendered.includes(key));
    assert.ok(!/(?<!\d)\d{8,}(?!\d)/.test(rendered), 'no identifier-shaped digit run');
  });

  it('leaves the earlier carve-outs unchanged', () => {
    const { manifestPath } = createCoverageWorkspace();
    const metadataOnly = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        manifestTrust: 'real_manifest_metadata_only',
        requiredFamilyProbeAuthorized: undefined,
        requiredFamilyJoinProbeAuthorized: undefined,
        realLocalJoinDryRunAuthorized: undefined,
        aggregateOnlyJoinCoverageSignalAuthorized: undefined,
        realLocalJoinCoverageSignalAuthorized: undefined,
        aggregateJoinCoverageSignalReader: undefined,
      }),
    );
    assert.equal(metadataOnly.ok, true, JSON.stringify(metadataOnly.errors));
    assert.equal(metadataOnly.aggregate_join_coverage_signal, null);
    assert.equal(metadataOnly.aggregate_join_coverage_signal_authorized, false);
    assert.equal(metadataOnly.real_local_join_coverage_signal_authorized, false);

    const synthetic = runBrazilReceitaFullJoinDryRun({
      noWriteMode: true,
      runtimeIntegration: false,
      agent1Integration: false,
      supabaseWrite: false,
    });
    assert.equal(synthetic.ok, true);
    assert.equal(synthetic.aggregate_join_coverage_signal, null);
    assert.equal(synthetic.aggregate_join_coverage_signal_authorized, false);
    assert.equal(synthetic.real_local_join_coverage_signal_authorized, false);
  });
});

// ─── CLI contract ────────────────────────────────────────────────────────────

const SIGNAL_ARGS: readonly string[] = [
  '--manifest',
  '/tmp/synthetic-coverage-signal-manifest.json',
  '--allow-local-manifest',
  '--real-manifest-metadata-only',
  '--real-manifest-metadata-execution-authorized',
  '--required-family-probe-authorized',
  '--required-family-join-probe-authorized',
  '--real-local-join-dry-run-authorized',
  '--aggregate-join-coverage-signal',
  '--aggregate-join-coverage-signal-authorized',
  '--real-local-join-coverage-signal-authorized',
  '--format',
  'json',
  '--strict',
  '--max-manifest-bytes',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES),
  '--max-declared-files',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES),
  '--max-files-opened',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED),
  '--max-bytes-per-file',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE),
  '--max-rows-per-file',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE),
  '--max-total-rows',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS),
  '--max-total-bytes',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES),
  '--max-coverage-input-rows',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS),
  '--max-coverage-key-values-in-memory',
  String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY),
  '--max-coverage-pairs-emitted',
  '0',
  '--max-coverage-rows-printed',
  '0',
];

function argsWithout(...flags: readonly string[]): string[] {
  const dropped = new Set(flags);
  const kept: string[] = [];
  for (let i = 0; i < SIGNAL_ARGS.length; i++) {
    const token = SIGNAL_ARGS[i]!;
    if (dropped.has(token)) {
      // Drop the flag, and its value when it takes one.
      const next = SIGNAL_ARGS[i + 1];
      if (next !== undefined && !next.startsWith('--')) i += 1;
      continue;
    }
    kept.push(token);
  }
  return kept;
}

describe('BR-SOURCE-11H-IMPL coverage signal — CLI contract', () => {
  it('accepts the fully-declared, fully-capped coverage-signal invocation', () => {
    const options = parseFullJoinRunnerArgs([...SIGNAL_ARGS]);
    assert.equal(options.aggregateJoinCoverageSignal, true);
    assert.equal(options.aggregateJoinCoverageSignalAuthorized, true);
    assert.equal(options.realLocalJoinCoverageSignalAuthorized, true);
    assert.equal(options.requiredFamilyJoinProbeAuthorized, true);
    assert.equal(options.realLocalJoinDryRunAuthorized, true);
    assert.equal(options.requiredFamilyProbeAuthorized, true);
    assert.equal(options.requiredFamilyProbe, false, 'the probe modes stay distinct');
    assert.equal(options.requiredFamilyJoinProbe, false);
    assert.equal(options.strict, true);
    assert.equal(options.runMode, 'local_manifest_dry_run');
    assert.equal(
      options.maxRowsPerFile,
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE,
    );
    assert.equal(
      options.maxCoverageInputRows,
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS,
    );
    assert.equal(options.maxCoveragePairsEmitted, 0);
    assert.equal(options.maxCoverageRowsPrinted, 0);
  });

  it('refuses the coverage-signal mode when any declaration or cap is missing', () => {
    const required = [
      '--aggregate-join-coverage-signal-authorized',
      '--real-local-join-coverage-signal-authorized',
      '--required-family-join-probe-authorized',
      '--real-local-join-dry-run-authorized',
      '--required-family-probe-authorized',
      '--real-manifest-metadata-only',
      '--real-manifest-metadata-execution-authorized',
      '--allow-local-manifest',
      '--strict',
      '--max-files-opened',
      '--max-bytes-per-file',
      '--max-rows-per-file',
      '--max-total-rows',
      '--max-total-bytes',
      '--max-coverage-input-rows',
      '--max-coverage-key-values-in-memory',
      '--max-coverage-pairs-emitted',
      '--max-coverage-rows-printed',
    ];
    for (const flag of required) {
      assert.throws(
        () => parseFullJoinRunnerArgs(argsWithout(flag)),
        ForbiddenFullJoinRunnerModeError,
        `dropping ${flag} should fail closed`,
      );
    }
  });

  it('refuses the 11H declarations without the 11H mode', () => {
    for (const flag of [
      '--aggregate-join-coverage-signal-authorized',
      '--real-local-join-coverage-signal-authorized',
    ]) {
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            '--manifest',
            '/tmp/synthetic-coverage-signal-manifest.json',
            '--allow-local-manifest',
            '--real-manifest-metadata-only',
            '--real-manifest-metadata-execution-authorized',
            '--strict',
            '--max-manifest-bytes',
            String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES),
            '--max-declared-files',
            String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES),
            flag,
          ]),
        ForbiddenFullJoinRunnerModeError,
        flag,
      );
    }
  });

  it('refuses running the coverage signal alongside either probe mode', () => {
    for (const flag of ['--required-family-probe', '--required-family-join-probe']) {
      assert.throws(
        () => parseFullJoinRunnerArgs([...SIGNAL_ARGS, flag]),
        ForbiddenFullJoinRunnerModeError,
        flag,
      );
    }
  });

  it('refuses a cap above its ceiling, and ANY positive coverage-output cap', () => {
    const overCap: ReadonlyArray<readonly [string, number]> = [
      [
        '--max-files-opened',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED + 1,
      ],
      [
        '--max-rows-per-file',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE + 1,
      ],
      ['--max-total-rows', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS + 1],
      ['--max-total-bytes', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES + 1],
      [
        '--max-bytes-per-file',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE + 1,
      ],
      [
        '--max-coverage-input-rows',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS + 1,
      ],
      [
        '--max-coverage-key-values-in-memory',
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY + 1,
      ],
      ['--max-coverage-pairs-emitted', 1],
      ['--max-coverage-rows-printed', 1],
    ];
    for (const [flag, value] of overCap) {
      const args = [...argsWithout(flag), flag, String(value)];
      assert.throws(() => parseFullJoinRunnerArgs(args), ForbiddenFullJoinRunnerModeError, flag);
    }
  });

  it('keeps the 11G probe modes at their TIGHTER window even when 11H caps are declared', () => {
    // The shared row/byte flags now parse against the widest ceiling in the tool. A probe run must
    // still be refused for declaring the 11H window: the 11H authorization is not transferable.
    const probeArgs = [
      '--manifest',
      '/tmp/synthetic-coverage-signal-manifest.json',
      '--allow-local-manifest',
      '--real-manifest-metadata-only',
      '--real-manifest-metadata-execution-authorized',
      '--required-family-probe',
      '--required-family-probe-authorized',
      '--format',
      'json',
      '--strict',
      '--max-manifest-bytes',
      String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES),
      '--max-declared-files',
      String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES),
      '--max-files-opened',
      '2',
      '--max-bytes-per-file',
      String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE),
      '--max-rows-per-file',
      String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE),
      '--max-total-rows',
      String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS),
      '--max-total-bytes',
      String(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES),
    ];
    assert.throws(() => parseFullJoinRunnerArgs(probeArgs), ForbiddenFullJoinRunnerModeError);
  });

  it('exposes no exact-percentage, denominator, proof or guarantee flag at all', () => {
    for (const flag of [
      '--coverage',
      '--coverage-percentage',
      '--exact-coverage-percentage',
      '--full-dataset-denominator',
      '--coverage-proof',
      '--coverage-guarantee',
      '--production-inference',
      '--emit-joined-rows',
      '--emit-join-keys',
    ]) {
      assert.throws(() => parseFullJoinRunnerArgs([...SIGNAL_ARGS, flag]), Error, flag);
    }
  });

  it('still refuses every import / runtime / provider flag on a coverage invocation', () => {
    for (const flag of ['--import', '--execute', '--supabase', '--runtime', '--agent1', '--full']) {
      assert.throws(() => parseFullJoinRunnerArgs([...SIGNAL_ARGS, flag]), Error, flag);
    }
  });

  it('still refuses an --output path inside the repository on a coverage invocation', () => {
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([...SIGNAL_ARGS, '--output', 'scratchpad/coverage-signal.json']),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('leaves the safe synthetic invocations working unchanged', () => {
    const fixture = parseFullJoinRunnerArgs(['--synthetic-fixture', '--format', 'json', '--strict']);
    assert.equal(fixture.runMode, 'synthetic_fixture_only');
    assert.equal(fixture.aggregateJoinCoverageSignal, false);
    assert.equal(fixture.realLocalJoinCoverageSignalAuthorized, false);
  });
});

// ─── Static guards ───────────────────────────────────────────────────────────

const require_ = createRequire(import.meta.url);

/** The module's CODE, with comments stripped: these guards are about what it does. */
function signalSource(): string {
  const raw = fs.readFileSync(
    require_.resolve('../br-receita-cnpj-aggregate-join-coverage-signal'),
    'utf8',
  );
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The module's RAW text, comments included — used for the embedded-path guard. */
function signalRawSource(): string {
  return fs.readFileSync(
    require_.resolve('../br-receita-cnpj-aggregate-join-coverage-signal'),
    'utf8',
  );
}

describe('BR-SOURCE-11H-IMPL coverage signal — static guards', () => {
  it('imports no Supabase, Agent 1, provider, HubSpot or Slack module', () => {
    const source = signalSource();
    for (const forbidden of [
      'supabase',
      'createClient',
      'agent1',
      'apollo',
      'lusha',
      'tavily',
      'hubspot',
      'slack',
      'source_company_snapshots',
      'process.env',
      'fetch(',
    ]) {
      assert.ok(
        !source.toLowerCase().includes(forbidden.toLowerCase()),
        `coverage-signal source must not reference "${forbidden}"`,
      );
    }
  });

  it('computes no hash, no exact figure, no denominator and no identity promotion', () => {
    const source = signalSource();
    for (const forbidden of [
      'createHash',
      'sha256',
      'digest',
      'fingerprint',
      'normalizedTaxId',
      'normalized_tax_id',
      'recordIdentityKey',
      'record_identity_key',
      // The arithmetic a percentage or a ratio would need. None of it exists here.
      '/ total',
      '* 100',
      'toFixed',
      'coverageRatio',
      'coveragePercentageValue',
      'datasetTotal',
    ]) {
      assert.ok(
        !source.includes(forbidden),
        `coverage-signal source must not reference "${forbidden}"`,
      );
    }
    // The two claim-shaped fields exist ONLY as literal `false` assignments.
    for (const field of ['exactCoveragePercentagePrinted', 'fullDatasetDenominatorPrinted']) {
      for (const assignment of source.match(new RegExp(`${field}[^,;\\n]*`, 'g')) ?? []) {
        assert.ok(
          assignment.includes('false') || assignment.includes(': false'),
          `${field} must only ever be false, got ${assignment}`,
        );
      }
    }
  });

  it('writes nothing: no write, append, unlink, mkdir or rm call', () => {
    const source = signalSource();
    for (const forbidden of [
      'writeFile',
      'appendFile',
      'unlink',
      'mkdir',
      'rmSync',
      'rmdir',
      'createWriteStream',
    ]) {
      assert.ok(!source.includes(forbidden), `coverage-signal source must not call "${forbidden}"`);
    }
  });

  it('opens files only through the two bounded readers, and never stats or lists', () => {
    const source = signalSource();
    // Exactly two `openSync` call sites: the manifest control document and one data file.
    assert.equal(source.split('fs.openSync(').length - 1, 2);
    assert.equal(source.split('fs.readSync(').length - 1, 2);
    for (const forbidden of ['statSync', 'readdirSync', 'existsSync', 'globSync', 'realpathSync']) {
      assert.ok(!source.includes(forbidden), `coverage-signal source must not call "${forbidden}"`);
    }
  });

  it('never routes a join key to a log, a template, or a thrown message', () => {
    const source = signalSource();
    for (const forbidden of [
      'console.log',
      'console.error',
      'console.warn',
      'process.stdout',
      'process.stderr',
      'JSON.stringify(joinKey',
      '${joinKey',
      'Error(joinKey',
    ]) {
      assert.ok(
        !source.includes(forbidden),
        `coverage-signal source must not emit via "${forbidden}"`,
      );
    }
    // Every throw carries a fixed CODE: the only constructor argument is a quoted code literal.
    for (const constructed of source.match(
      /new BrazilReceitaAggregateJoinCoverageSignalError\([^)]*\)/g,
    ) ?? []) {
      assert.ok(
        /^new BrazilReceitaAggregateJoinCoverageSignalError\(\s*'aggregate_join_coverage_signal_[a-z_]+',?\s*\)$/.test(
          constructed,
        ),
        `a refusal must carry a fixed code only, got ${constructed}`,
      );
    }
  });

  it('exports no field-reading helper — a join key never leaves the module', () => {
    const source = signalSource();
    assert.ok(source.includes('function readDelimitedFieldAt('));
    assert.ok(
      !source.includes('export function readDelimitedFieldAt('),
      'the field reader must stay module-private',
    );
    // The bounded window is released before the aggregate is assembled.
    assert.ok(source.includes('firstFamilyKeys.clear()'));
  });

  it('embeds no operator path and no real dataset location, in code OR in prose', () => {
    const source = signalRawSource();
    for (const forbidden of [
      '/Users/',
      'Downloads',
      'sellup-source-data',
      'dados_abertos',
      'manifest.headerless.json',
      'manifest.real.json',
    ]) {
      assert.ok(
        !source.includes(forbidden),
        `coverage-signal source must not embed "${forbidden}"`,
      );
    }
  });

  it('holds the caps, buckets and family/key invariants as constants, not conventions', () => {
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED, 2);
    assert.deepEqual(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES, [
      'empresas',
      'estabelecimentos',
    ]);
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE, 512_000);
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE, 200);
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS, 400);
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES, 1_024_000);
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS, 400);
    assert.equal(
      BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY,
      400,
    );
    // Equalities, not ceilings.
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_PAIRS_EMITTED, 0);
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_ROWS_PRINTED, 0);
    // One field position per row, shared with the 11G probe rather than restated.
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_KEY_COLUMN_INDEX, 0);
    // The only denominator vocabulary that exists.
    assert.equal(BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_DENOMINATOR_SCOPE, 'bounded_window_only');
  });
});
