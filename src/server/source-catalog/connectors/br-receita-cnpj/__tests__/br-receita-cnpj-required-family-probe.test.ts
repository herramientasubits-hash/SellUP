/**
 * BR Receita CNPJ ULTRA-BOUNDED REQUIRED-FAMILY PROBE — tests (BR-SOURCE-11F-IMPL).
 *
 * BR-SOURCE-11D-META-IMPL / 11E established that a manifest may be read as a CONTROL
 * DOCUMENT while nothing it references is ever opened. BR-SOURCE-11F-IMPL is the first
 * milestone that opens a referenced file at all, under the owner's phrase:
 *
 *     AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL DATA-FILE PROBE
 *
 * These tests hold the line on what "ultra-bounded required-family" means:
 *   - exactly ONE file per required family and at most TWO data files per run;
 *   - catalog families, Sócios/QSA/CPF families, archives, ZIP-staging segments, absolute
 *     declared paths and traversing declared paths are all refused, and a refused family is
 *     never opened — asserted by declaring files that do not exist on disk, so a probe that
 *     tried to open one would fail the test;
 *   - every cap is REQUIRED, every cap is enforced against a real over-cap input, and a
 *     window that stops mid-row drops that row instead of counting it;
 *   - the returned scan and the projected report carry counts, buckets, class labels and a
 *     column-count HISTOGRAM only: no row, cell, column value, identifier, filename,
 *     basename, path, offset or hash, asserted by scanning the serialized output;
 *   - no join is computed, all eight gates stay `not_approved`, every scope flag stays
 *     `false`, and the report passes output sanitization unchanged.
 *
 * 100% synthetic. Every manifest and every CSV here is written by this suite into a temp
 * workspace it creates and removes. The staging-shaped directory names are LOCAL fixtures
 * named after the denylist entries so the refusals can be measured. No real Receita
 * manifest, no real data file, no operator directory, no dataset, no Supabase, no network,
 * no runtime.
 *
 * Every cell this suite writes is an opaque `SYN-…` token, so no identifier-shaped literal
 * (8-, 11- or 14-digit run) exists in this source file or in any fixture it creates.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_SELECTION_CLASSES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_TRUST,
  BrazilReceitaRequiredFamilyProbeError,
  createBrazilReceitaRequiredFamilyProbe,
  type BrazilReceitaRequiredFamilyProbeOptions,
  type BrazilReceitaRequiredFamilyProbeReadRequest,
  type BrazilReceitaRequiredFamilyProbeScan,
} from '../br-receita-cnpj-required-family-probe';
import {
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_PROBE_TRUST,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunInput,
} from '../br-receita-cnpj-full-join-dry-run-runner';
import { createBrazilReceitaRealManifestMetadataReader } from '../br-receita-cnpj-real-manifest-metadata-reader';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';
import {
  ForbiddenFullJoinRunnerModeError,
  parseFullJoinRunnerArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run';

// ─── Synthetic workspace (written and removed by this suite) ───────────────────

const WORKSPACE_PREFIX = 'br-source-11f-impl-required-family-probe-test-';

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

/** An opaque cell token. Small indices only, so no identifier-shaped digit run appears. */
function syntheticCell(family: string, row: number, column: number): string {
  return ['SYN', family.toUpperCase(), `R${row}`, `C${column}`].join('-');
}

/** One synthetic headerless row with the official positional column count for `family`. */
function syntheticRow(family: string, row: number): string {
  const columns = BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS[
    family as keyof typeof BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS
  ]!;
  return Array.from({ length: columns }, (_unused, index) =>
    syntheticCell(family, row, index),
  ).join(';');
}

/** Writes a synthetic headerless CSV with `rows` well-formed rows. */
function writeCsv(root: string, family: string, rows: number, fileName?: string): string {
  const relative = fileName ?? SYNTHETIC_FILE_LABELS[family] ?? `synthetic-${family}.csv`;
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = Array.from({ length: rows }, (_unused, index) => syntheticRow(family, index)).join(
    '\n',
  );
  fs.writeFileSync(target, `${body}\n`, { encoding: 'latin1' });
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

function writeManifest(root: string, document: unknown, fileName = 'synthetic-manifest.json'): string {
  const manifestPath = path.join(root, fileName);
  fs.writeFileSync(manifestPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8' });
  return manifestPath;
}

/**
 * The default happy-path workspace: a manifest declaring both required families (each with a
 * real synthetic CSV beside it) plus three catalog families whose files are DELIBERATELY not
 * written. A probe that opened a catalog file would fail with a missing-file error, so the
 * "catalogs are counted, never opened" invariant is measured rather than asserted.
 */
function createProbeWorkspace(
  options: {
    readonly empresasRows?: number;
    readonly estabelecimentosRows?: number;
    readonly extraFiles?: readonly DeclaredFileFixture[];
    readonly omitFamily?: string;
    readonly includeCatalogs?: boolean;
  } = {},
): { readonly root: string; readonly manifestPath: string } {
  const root = createWorkspace();
  const files: DeclaredFileFixture[] = [];
  for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
    if (options.omitFamily === family) continue;
    const rows =
      family === 'empresas' ? (options.empresasRows ?? 3) : (options.estabelecimentosRows ?? 3);
    files.push({
      fileType: family,
      path: writeCsv(root, family, rows),
      encoding: 'latin1',
      layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
    });
  }
  if (options.includeCatalogs !== false) {
    // Declared, counted, and NEVER written to disk: proof the probe does not open them.
    for (const family of ['cnaes', 'municipios', 'naturezas']) {
      files.push({ fileType: family, path: SYNTHETIC_FILE_LABELS[family]!, encoding: 'latin1' });
    }
  }
  files.push(...(options.extraFiles ?? []));
  return { root, manifestPath: writeManifest(root, manifestDocument(files)) };
}

// ─── Caps and authorizations ──────────────────────────────────────────────────

const AUTHORIZED_CAPS = {
  maxManifestBytes: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES,
  maxFilesOpened: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED,
  maxBytesPerFile: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE,
  maxRowsPerFile: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE,
  maxTotalRows: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS,
  maxTotalBytes: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES,
} as const;

const READ_REQUEST: BrazilReceitaRequiredFamilyProbeReadRequest = { ...AUTHORIZED_CAPS };

function probeOptions(
  manifestPath: string,
  overrides: Partial<BrazilReceitaRequiredFamilyProbeOptions> = {},
): BrazilReceitaRequiredFamilyProbeOptions {
  return {
    manifestPath,
    requiredFamilyProbeAuthorized: true,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    ...AUTHORIZED_CAPS,
    ...overrides,
  };
}

function runProbe(
  manifestPath: string,
  overrides: Partial<BrazilReceitaRequiredFamilyProbeOptions> = {},
  request: BrazilReceitaRequiredFamilyProbeReadRequest = READ_REQUEST,
): BrazilReceitaRequiredFamilyProbeScan {
  return createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, overrides))(request);
}

function probeErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BrazilReceitaRequiredFamilyProbeError);
    return (error as BrazilReceitaRequiredFamilyProbeError).code;
  }
  return assert.fail('expected the probe to refuse');
}

function rowsCounted(scan: BrazilReceitaRequiredFamilyProbeScan, family: string): number {
  const shape = scan.rowShape[family];
  if (shape === undefined) return 0;
  return shape.rowShapeValidCount + shape.rowShapeInvalidCount;
}

// ─── The happy path: two files, two families, bounded ─────────────────────────

describe('BR-SOURCE-11F-IMPL required-family probe — bounded happy path', () => {
  it('opens exactly two files, one per required family', () => {
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.manifestTrust, BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_TRUST);
    assert.equal(scan.filesOpenedCount, 2);
    assert.deepEqual(scan.filesOpenedByFamily, { empresas: 1, estabelecimentos: 1 });
    assert.deepEqual(scan.familiesAttempted, ['empresas', 'estabelecimentos']);
  });

  it('never exceeds the two-file ceiling even when a family declares several shards', () => {
    // The second and third `empresas` declarations point at files that were never written:
    // opening either would throw, so a green run proves only the FIRST was opened.
    const { manifestPath } = createProbeWorkspace({
      extraFiles: [
        { fileType: 'empresas', path: 'synthetic-empresas-shard-b.csv', encoding: 'latin1' },
        { fileType: 'empresas', path: 'synthetic-empresas-shard-c.csv', encoding: 'latin1' },
      ],
    });
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.filesOpenedCount, 2);
    assert.equal(scan.filesOpenedByFamily.empresas, 1);
  });

  it('counts catalog families without opening them', () => {
    // The catalog CSVs are declared but never written to disk by `createProbeWorkspace`.
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.neverOpenedFamilyCount, 3);
    assert.equal(scan.filesOpenedCount, 2);
    for (const family of ['cnaes', 'municipios', 'naturezas']) {
      assert.equal(scan.filesOpenedByFamily[family], undefined);
      assert.equal(scan.rowShape[family], undefined);
    }
  });

  it('reports row shape as an aggregate histogram against the official column count', () => {
    const { manifestPath } = createProbeWorkspace({ empresasRows: 4, estabelecimentosRows: 5 });
    const scan = runProbe(manifestPath);

    const empresas = scan.rowShape.empresas!;
    assert.equal(
      empresas.expectedMinColumns,
      BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas,
    );
    assert.equal(empresas.rowShapeValidCount, 4);
    assert.equal(empresas.rowShapeInvalidCount, 0);
    assert.deepEqual(empresas.observedColumnCountDistribution, {
      [String(BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas)]: 4,
    });

    const estabelecimentos = scan.rowShape.estabelecimentos!;
    assert.equal(estabelecimentos.rowShapeValidCount, 5);
    assert.equal(
      estabelecimentos.expectedMinColumns,
      BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.estabelecimentos,
    );
  });

  it('classifies encoding, delimiter and headerless status as class labels', () => {
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath);

    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
      assert.equal(scan.encodingStatus[family], 'ok');
      assert.equal(scan.delimiterStatus[family], 'semicolon_detected');
      assert.equal(scan.headerlessStatus[family], 'assumed_headerless');
      assert.equal(scan.bytesReadBucket[family], 'lte_64kb');
      assert.equal(scan.rowsReadBucket[family], 'lte_20');
    }
  });

  it('reports a shape mismatch as an aggregate count, never as the offending row', () => {
    const root = createWorkspace();
    const shortRow = ['SYN-A', 'SYN-B'].join(';');
    fs.writeFileSync(path.join(root, SYNTHETIC_FILE_LABELS.empresas!), `${shortRow}\n`, {
      encoding: 'latin1',
    });
    const manifestPath = writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: SYNTHETIC_FILE_LABELS.empresas!, encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', 2),
          encoding: 'latin1',
        },
      ]),
    );

    const scan = runProbe(manifestPath);
    assert.equal(scan.refusalCode, null);
    assert.equal(scan.rowShape.empresas!.rowShapeValidCount, 0);
    assert.equal(scan.rowShape.empresas!.rowShapeInvalidCount, 1);
    assert.deepEqual(scan.rowShape.empresas!.observedColumnCountDistribution, { '2': 1 });
  });

  it('reports the selection class as `selected` on a green probe', () => {
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath);
    assert.equal(scan.selectionClass, 'selected');
    assert.ok(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_SELECTION_CLASSES.includes(scan.selectionClass));
  });

  it('holds every structural absence assertion', () => {
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath);

    assert.equal(scan.rawRowsRetained, false);
    assert.equal(scan.rawCellsRetained, false);
    assert.equal(scan.identifiersRetained, false);
    assert.equal(scan.fileNamesRetained, false);
    assert.equal(scan.absolutePathsRetained, false);
    assert.equal(scan.hashesComputed, false);
    assert.equal(scan.joinsExecuted, false);
  });
});

// ─── Caps: enforced, and asserted against real over-cap input ─────────────────

describe('BR-SOURCE-11F-IMPL required-family probe — caps', () => {
  it('refuses a missing cap rather than defaulting it', () => {
    const { manifestPath } = createProbeWorkspace();
    for (const cap of [
      'maxManifestBytes',
      'maxDeclaredFiles',
      'maxFilesOpened',
      'maxBytesPerFile',
      'maxRowsPerFile',
      'maxTotalRows',
      'maxTotalBytes',
    ] as const) {
      const code = probeErrorCode(() =>
        createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, { [cap]: undefined })),
      );
      assert.equal(code, 'required_family_probe_cap_required');
    }
  });

  it('refuses a cap above its ceiling', () => {
    const { manifestPath } = createProbeWorkspace();
    const overCap: ReadonlyArray<readonly [string, number]> = [
      ['maxFilesOpened', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED + 1],
      ['maxBytesPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE + 1],
      ['maxRowsPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE + 1],
      ['maxTotalRows', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS + 1],
      ['maxTotalBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES + 1],
      ['maxManifestBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES + 1],
      ['maxDeclaredFiles', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES + 1],
    ];
    for (const [cap, value] of overCap) {
      const code = probeErrorCode(() =>
        createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, { [cap]: value })),
      );
      assert.equal(code, 'required_family_probe_cap_exceeded');
    }
  });

  it('refuses a READ that asks for more than the probe was built with', () => {
    const { manifestPath } = createProbeWorkspace();
    const probe = createBrazilReceitaRequiredFamilyProbe(
      probeOptions(manifestPath, { maxRowsPerFile: 2 }),
    );
    const code = probeErrorCode(() => probe({ ...READ_REQUEST, maxRowsPerFile: 5 }));
    assert.equal(code, 'required_family_probe_cap_exceeded');
  });

  it('stops at the per-file row ceiling on a file with more rows than the cap', () => {
    const { manifestPath } = createProbeWorkspace({
      empresasRows: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE + 30,
      estabelecimentosRows: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE + 30,
    });
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null);
    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
      assert.equal(rowsCounted(scan, family), BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE);
      assert.equal(scan.rowsReadBucket[family], 'lte_20');
    }
  });

  it('respects the TOTAL row ceiling across both files', () => {
    const { manifestPath } = createProbeWorkspace({ empresasRows: 30, estabelecimentosRows: 30 });
    const scan = runProbe(manifestPath, {}, { ...READ_REQUEST, maxTotalRows: 5, maxRowsPerFile: 4 });

    assert.equal(scan.refusalCode, null);
    const total = rowsCounted(scan, 'empresas') + rowsCounted(scan, 'estabelecimentos');
    assert.ok(total <= 5, `expected at most 5 total rows, counted ${total}`);
    assert.ok(rowsCounted(scan, 'empresas') <= 4);
  });

  it('reads a bounded PREFIX of a file far larger than the byte ceiling, dropping the cut row', () => {
    const root = createWorkspace();
    // ~40 KB of well-formed rows: comfortably beyond a small per-file byte budget, so the
    // window necessarily stops inside a row.
    const empresas = writeCsv(root, 'empresas', 900);
    const estabelecimentos = writeCsv(root, 'estabelecimentos', 5);
    const manifestPath = writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: empresas, encoding: 'latin1' },
        { fileType: 'estabelecimentos', path: estabelecimentos, encoding: 'latin1' },
      ]),
    );

    const byteBudget = 200;
    const scan = runProbe(manifestPath, {}, { ...READ_REQUEST, maxBytesPerFile: byteBudget });
    assert.equal(scan.refusalCode, null);
    assert.equal(scan.bytesReadBucket.empresas, 'lte_64kb');

    // Every counted row is COMPLETE: the trailing fragment the window cut is dropped, so no
    // short row appears in the histogram even though the file's rows are uniform.
    const empresasShape = scan.rowShape.empresas!;
    assert.deepEqual(Object.keys(empresasShape.observedColumnCountDistribution), [
      String(BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas),
    ]);
    assert.equal(empresasShape.rowShapeInvalidCount, 0);
    assert.ok(empresasShape.rowShapeValidCount > 0);
    assert.ok(
      empresasShape.rowShapeValidCount <= BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE,
    );
  });

  it('refuses when the liveness deadline has passed', () => {
    const { manifestPath } = createProbeWorkspace({ empresasRows: 5 });
    let call = 0;
    // First call sets the deadline; every later call is far beyond it.
    const nowMs = () => (call++ === 0 ? 0 : Number.MAX_SAFE_INTEGER);
    const scan = runProbe(manifestPath, { nowMs });
    assert.equal(scan.refusalCode, 'required_family_probe_timeout');
    assert.equal(scan.filesOpenedCount, 0);
  });
});

// ─── Refusals: families, archives, paths, authorizations ─────────────────────

describe('BR-SOURCE-11F-IMPL required-family probe — refusals', () => {
  it('refuses a declared Sócios/QSA/CPF family and opens nothing', () => {
    const root = createWorkspace();
    const manifestPath = writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: writeCsv(root, 'empresas', 2), encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', 2),
          encoding: 'latin1',
        },
        // Declared only. The file is never written, so a probe that opened it would throw.
        { fileType: 'socios', path: SYNTHETIC_FILE_LABELS.socios!, encoding: 'latin1' },
      ]),
    );

    const scan = runProbe(manifestPath);
    assert.equal(scan.refusalCode, 'required_family_probe_forbidden_family');
    assert.equal(scan.forbiddenFamilyCount, 1);
    assert.equal(scan.filesOpenedCount, 0);
  });

  it('refuses a missing required family, either one', () => {
    for (const omitFamily of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
      const { manifestPath } = createProbeWorkspace({ omitFamily });
      const scan = runProbe(manifestPath);
      assert.equal(scan.refusalCode, 'required_family_probe_missing_required_family');
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('refuses an archive extension for a required family', () => {
    for (const extension of ['.zip', '.gz', '.7z', '.tar']) {
      const root = createWorkspace();
      const manifestPath = writeManifest(
        root,
        manifestDocument([
          { fileType: 'empresas', path: `synthetic-empresas${extension}`, encoding: 'latin1' },
          {
            fileType: 'estabelecimentos',
            path: writeCsv(root, 'estabelecimentos', 2),
            encoding: 'latin1',
          },
        ]),
      );
      const scan = runProbe(manifestPath);
      assert.equal(scan.refusalCode, 'required_family_probe_zip_forbidden');
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('refuses an unrecognized (non-CSV/TXT) extension', () => {
    const root = createWorkspace();
    const manifestPath = writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: 'synthetic-empresas.parquet', encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', 2),
          encoding: 'latin1',
        },
      ]),
    );
    assert.equal(runProbe(manifestPath).refusalCode, 'required_family_probe_zip_forbidden');
  });

  /**
   * Builds a workspace whose `empresas` declaration sits under `segment`, as a LOCAL fixture
   * named after a directory label. The file really exists, so the outcome measures the
   * denylist itself rather than a missing file.
   */
  function workspaceWithSegment(segment: string): string {
    const root = createWorkspace();
    const staged = writeCsv(root, 'empresas', 2, path.join(segment, 'synthetic-empresas.csv'));
    return writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: staged, encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', 2),
          encoding: 'latin1',
        },
      ]),
    );
  }

  it('refuses a declared path under the ZIP-staging segment', () => {
    for (const segment of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS) {
      const scan = runProbe(workspaceWithSegment(segment));
      assert.equal(scan.refusalCode, 'required_family_probe_open_failed');
      assert.equal(scan.selectionClass, 'declared_path_zip_staging_segment');
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('keeps the data denylist scoped to the ZIP staging area only', () => {
    // Option C authorizes opening the operator's already-EXTRACTED, manifest-declared files.
    // A directory NAME says nothing about whether a file is bounded-readable, so only the ZIP
    // staging area is denylisted — an extracted file under a preparation directory is opened
    // normally, and an archive stays refused by extension wherever it sits.
    assert.deepEqual(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS, [
      'raw-zips',
      'raw_zips',
    ]);
    for (const segment of ['manifest-input', 'manifest_input', 'extracted', 'prepared']) {
      const scan = runProbe(workspaceWithSegment(segment));
      assert.equal(scan.refusalCode, null, `${segment} holds extracted files and must open`);
      assert.equal(scan.selectionClass, 'selected');
      assert.equal(scan.filesOpenedCount, 2);
    }
    // An archive under a preparation directory is STILL refused, by extension.
    const root = createWorkspace();
    const manifestPath = writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: 'manifest-input/synthetic-empresas.zip', encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', 2),
          encoding: 'latin1',
        },
      ]),
    );
    assert.equal(runProbe(manifestPath).refusalCode, 'required_family_probe_zip_forbidden');
  });

  it('refuses an absolute declared path and a traversing declared path', () => {
    const outside = createWorkspace();
    const escapee = writeCsv(outside, 'empresas', 2);
    for (const declaredPath of [
      path.join(outside, escapee),
      path.join('..', path.basename(outside), escapee),
    ]) {
      const root = createWorkspace();
      const manifestPath = writeManifest(
        root,
        manifestDocument([
          { fileType: 'empresas', path: declaredPath, encoding: 'latin1' },
          {
            fileType: 'estabelecimentos',
            path: writeCsv(root, 'estabelecimentos', 2),
            encoding: 'latin1',
          },
        ]),
      );
      assert.equal(runProbe(manifestPath).refusalCode, 'required_family_probe_open_failed');
    }
  });

  it('refuses a file that is declared but absent, without naming it', () => {
    const root = createWorkspace();
    const manifestPath = writeManifest(
      root,
      manifestDocument([
        { fileType: 'empresas', path: 'synthetic-empresas.csv', encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', 2),
          encoding: 'latin1',
        },
      ]),
    );
    const scan = runProbe(manifestPath);
    assert.equal(scan.refusalCode, 'required_family_probe_read_failed');
    assert.ok(!JSON.stringify(scan).includes('synthetic-empresas'));
  });

  it('refuses when any of the three authorizations is absent', () => {
    const { manifestPath } = createProbeWorkspace();
    for (const flag of [
      'requiredFamilyProbeAuthorized',
      'realManifestMetadataOnlyOptionBAuthorized',
      'realManifestMetadataOnlyExecutionAuthorized',
    ] as const) {
      const code = probeErrorCode(() =>
        createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, { [flag]: undefined })),
      );
      assert.equal(code, 'required_family_probe_not_authorized');
    }
  });

  it('refuses raw-row, raw-cell, sample, identifier, filename, hash and join requests', () => {
    const { manifestPath } = createProbeWorkspace();
    const rawOutput = ['includeRawRows', 'includeRawCells', 'includeSampleRows'] as const;
    for (const flag of rawOutput) {
      assert.equal(
        probeErrorCode(() =>
          createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, { [flag]: true })),
        ),
        'required_family_probe_raw_output_forbidden',
      );
    }
    for (const flag of ['includeIdentifiers', 'includeDeclaredFileNames', 'includeHashes'] as const) {
      assert.equal(
        probeErrorCode(() =>
          createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, { [flag]: true })),
        ),
        'required_family_probe_identifier_output_forbidden',
      );
    }
    assert.equal(
      probeErrorCode(() =>
        createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath, { computeJoin: true })),
      ),
      'required_family_probe_join_forbidden',
    );
  });

  it('refuses a URL manifest and a non-JSON manifest', () => {
    for (const manifestPath of ['https://example.invalid/manifest.json', '/tmp/manifest.csv', '']) {
      assert.equal(
        probeErrorCode(() =>
          createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath)),
        ),
        'required_family_probe_open_failed',
      );
    }
  });

  it('refuses a manifest declaring more files than the declared-file cap', () => {
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath, { maxDeclaredFiles: 2 }, { ...READ_REQUEST, maxDeclaredFiles: 2 });
    assert.equal(scan.refusalCode, 'required_family_probe_cap_exceeded');
  });

  it('refuses a file-count cap that cannot cover both required families', () => {
    const { manifestPath } = createProbeWorkspace();
    const scan = runProbe(manifestPath, { maxFilesOpened: 1 }, { ...READ_REQUEST, maxFilesOpened: 1 });
    assert.equal(scan.refusalCode, 'required_family_probe_file_count_exceeded');
    assert.equal(scan.filesOpenedCount, 0);
  });
});

// ─── Output safety: nothing regulated leaves the probe ───────────────────────

describe('BR-SOURCE-11F-IMPL required-family probe — output safety', () => {
  it('returns no cell, no path, no filename and no basename', () => {
    const { root, manifestPath } = createProbeWorkspace({ empresasRows: 4 });
    const serialized = JSON.stringify(runProbe(manifestPath));

    assert.ok(!serialized.includes(root));
    assert.ok(!serialized.includes(path.basename(manifestPath)));
    for (const label of Object.values(SYNTHETIC_FILE_LABELS)) {
      assert.ok(!serialized.includes(label), `scan leaked a declared filename`);
    }
    assert.ok(!serialized.includes('SYN-EMPRESAS'));
    assert.ok(!serialized.includes('SYN-ESTABELECIMENTOS'));
    // No hex digest, and no byte figure: buckets only.
    assert.ok(!/[a-f0-9]{32,}/i.test(serialized));
    assert.ok(!serialized.includes('bytesRead"'));
  });

  it('passes the output sanitizer once projected onto a report', () => {
    const { manifestPath } = createProbeWorkspace({ empresasRows: 4 });
    const scan = runProbe(manifestPath);
    const result = sanitizeBrazilReceitaFullJoinReport({ required_family_probe_scan: scan });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });
});

// ─── Runner integration ──────────────────────────────────────────────────────

function runnerInput(
  manifestPath: string,
  overrides: Partial<BrazilReceitaFullJoinDryRunInput> = {},
): BrazilReceitaFullJoinDryRunInput {
  return {
    mode: 'local_manifest_dry_run',
    manifest: { declared: true },
    allowLocalManifest: true,
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_PROBE_TRUST,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    requiredFamilyProbeAuthorized: true,
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
    requiredFamilyProbeReader: createBrazilReceitaRequiredFamilyProbe(probeOptions(manifestPath)),
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

describe('BR-SOURCE-11F-IMPL required-family probe — runner integration', () => {
  it('returns an ok, aggregate, sanitized probe report', () => {
    const { manifestPath } = createProbeWorkspace({ empresasRows: 3, estabelecimentosRows: 3 });
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.manifest_trust, BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_PROBE_TRUST);
    assert.equal(report.required_family_probe_authorized, true);
    assert.notEqual(report.manifest_metadata, null);
    assert.notEqual(report.required_family_probe, null);
    assert.equal(report.required_family_probe!.files_opened_count, 2);
    assert.deepEqual(report.required_family_probe!.files_opened_by_family, {
      empresas: 1,
      estabelecimentos: 1,
    });
    assert.equal(report.guardrail_counts.required_family_probe_files_opened, 2);
    assert.equal(sanitizeBrazilReceitaFullJoinReport(report).ok, true);
  });

  it('holds all eight gates not_approved and every scope flag false', () => {
    const { manifestPath } = createProbeWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    for (const status of Object.values(report.decision_status)) {
      assert.equal(status, 'not_approved');
    }
    for (const flag of Object.values(report.run_scope)) assert.equal(flag, false);
    for (const flag of Object.values(report.safety)) assert.equal(flag, false);
    assert.equal(report.required_family_probe!.joins_executed, false);
    assert.equal(report.required_family_probe!.join_coverage_computed, false);
    assert.equal(report.required_family_probe!.full_dataset_processed, false);
  });

  it('reports zero row, eligibility and join figures — a probe computes no join', () => {
    const { manifestPath } = createProbeWorkspace({ empresasRows: 6, estabelecimentosRows: 6 });
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    for (const value of Object.values(report.aggregate_counts)) assert.equal(value, 0);
    for (const value of Object.values(report.eligibility_counts)) assert.equal(value, 0);
    for (const value of Object.values(report.join_counts)) assert.equal(value, 0);
    assert.equal(report.source_period, null);
  });

  it('refuses when the Option C authorization is absent', () => {
    const { manifestPath } = createProbeWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, { requiredFamilyProbeAuthorized: undefined }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      { error_code: 'required_family_probe_not_authorized', stage: 'required_family_probe_gate' },
    ]);
    assert.equal(report.required_family_probe, null);
  });

  it('refuses without strict, without allowLocalManifest, and on production writes', () => {
    const { manifestPath } = createProbeWorkspace();
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

  it('refuses a missing probe cap and a missing probe reader', () => {
    const { manifestPath } = createProbeWorkspace();
    for (const cap of [
      'maxFilesOpened',
      'maxBytesPerFile',
      'maxRowsPerFile',
      'maxTotalRows',
      'maxTotalBytes',
    ] as const) {
      const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath, { [cap]: undefined }));
      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some((error) => error.error_code === 'required_family_probe_caps_required'),
      );
    }
    const withoutReader = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, { requiredFamilyProbeReader: undefined }),
    );
    assert.equal(withoutReader.ok, false);
    assert.ok(
      withoutReader.errors.some(
        (error) => error.error_code === 'required_family_probe_reader_required',
      ),
    );
  });

  it('refuses an escalation flag — the no-write guard runs before anything else', () => {
    const { manifestPath } = createProbeWorkspace();
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
      assert.equal(report.required_family_probe, null);
    }
  });

  it('refuses a probe that claims it retained a row, a cell, a hash or a join', () => {
    const { manifestPath } = createProbeWorkspace();
    const honest = runProbe(manifestPath);
    const claims: ReadonlyArray<readonly [Partial<BrazilReceitaRequiredFamilyProbeScan>, string]> = [
      [{ rawRowsRetained: true } as never, 'required_family_probe_raw_output_detected'],
      [{ rawCellsRetained: true } as never, 'required_family_probe_raw_output_detected'],
      [{ identifiersRetained: true } as never, 'required_family_probe_raw_output_detected'],
      [{ fileNamesRetained: true } as never, 'required_family_probe_raw_output_detected'],
      [{ absolutePathsRetained: true } as never, 'required_family_probe_raw_output_detected'],
      [{ hashesComputed: true } as never, 'required_family_probe_identifier_output_detected'],
      [{ joinsExecuted: true } as never, 'required_family_probe_join_detected'],
    ];
    for (const [claim, expected] of claims) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, {
          requiredFamilyProbeReader: () => ({ ...honest, ...claim }) as never,
        }),
      );
      assert.equal(report.ok, false);
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'required_family_probe_read' },
      ]);
      assert.equal(report.required_family_probe, null);
    }
  });

  it('refuses a probe that reports a family the report never agreed to carry', () => {
    const { manifestPath } = createProbeWorkspace();
    const honest = runProbe(manifestPath);
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        requiredFamilyProbeReader: () =>
          ({ ...honest, familiesAttempted: ['empresas', 'socios'] }) as never,
      }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'required_family_probe_forbidden_family_detected',
        stage: 'required_family_probe_read',
      },
    ]);
  });

  it('refuses a probe that opened more files than the cap allows', () => {
    const { manifestPath } = createProbeWorkspace();
    const honest = runProbe(manifestPath);
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        requiredFamilyProbeReader: () => ({ ...honest, filesOpenedCount: 3 }) as never,
      }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'required_family_probe_file_count_exceeded',
        stage: 'required_family_probe_read',
      },
    ]);
  });

  it('refuses a probe that declares the wrong trust level', () => {
    const { manifestPath } = createProbeWorkspace();
    const honest = runProbe(manifestPath);
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        requiredFamilyProbeReader: () =>
          ({ ...honest, manifestTrust: 'real_manifest_metadata_only' }) as never,
      }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'local_manifest_execution_not_authorized',
        stage: 'required_family_probe_read',
      },
    ]);
  });

  it('maps a probe refusal onto the runner vocabulary and reports no probe block', () => {
    const { manifestPath } = createProbeWorkspace({ omitFamily: 'estabelecimentos' });
    // The metadata gate refuses a manifest missing a required family FIRST — a probe never
    // gets to open anything when its control document is already unacceptable.
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'real_manifest_metadata_missing_required_family',
        stage: 'real_manifest_metadata_read',
      },
    ]);
    assert.equal(report.required_family_probe, null);
  });

  it('surfaces a probe-reported refusal when the manifest itself is acceptable', () => {
    const { manifestPath } = createProbeWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        requiredFamilyProbeReader: () =>
          ({
            ...runProbe(manifestPath),
            refusalCode: 'required_family_probe_timeout',
          }) as never,
      }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      { error_code: 'required_family_probe_timeout', stage: 'required_family_probe_read' },
    ]);
  });

  it('leaves the metadata-only and synthetic paths byte-for-byte unchanged', () => {
    const { manifestPath } = createProbeWorkspace();
    const metadataOnly = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        manifestTrust: 'real_manifest_metadata_only',
        requiredFamilyProbeAuthorized: undefined,
        requiredFamilyProbeReader: undefined,
      }),
    );
    assert.equal(metadataOnly.ok, true, JSON.stringify(metadataOnly.errors));
    assert.equal(metadataOnly.required_family_probe, null);
    assert.equal(metadataOnly.required_family_probe_authorized, false);

    const synthetic = runBrazilReceitaFullJoinDryRun({
      noWriteMode: true,
      runtimeIntegration: false,
      agent1Integration: false,
      supabaseWrite: false,
    });
    assert.equal(synthetic.ok, true);
    assert.equal(synthetic.required_family_probe, null);
    assert.equal(synthetic.required_family_probe_authorized, false);
  });
});

// ─── CLI contract ────────────────────────────────────────────────────────────

const PROBE_ARGS: readonly string[] = [
  '--manifest',
  '/tmp/synthetic-probe-manifest.json',
  '--allow-local-manifest',
  '--real-manifest-metadata-only',
  '--real-manifest-metadata-execution-authorized',
  '--required-family-probe',
  '--required-family-probe-authorized',
  '--format',
  'json',
  '--strict',
  '--max-manifest-bytes',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES),
  '--max-declared-files',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES),
  '--max-files-opened',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED),
  '--max-bytes-per-file',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE),
  '--max-rows-per-file',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE),
  '--max-total-rows',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS),
  '--max-total-bytes',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES),
];

function argsWithout(...flags: readonly string[]): string[] {
  const dropped = new Set(flags);
  const kept: string[] = [];
  for (let i = 0; i < PROBE_ARGS.length; i++) {
    const token = PROBE_ARGS[i]!;
    if (dropped.has(token)) {
      // Drop the flag, and its value when it takes one.
      const next = PROBE_ARGS[i + 1];
      if (next !== undefined && !next.startsWith('--')) i += 1;
      continue;
    }
    kept.push(token);
  }
  return kept;
}

describe('BR-SOURCE-11F-IMPL required-family probe — CLI contract', () => {
  it('accepts the fully-declared, fully-capped probe invocation', () => {
    const options = parseFullJoinRunnerArgs([...PROBE_ARGS]);
    assert.equal(options.requiredFamilyProbe, true);
    assert.equal(options.requiredFamilyProbeAuthorized, true);
    assert.equal(options.realManifestMetadataOnly, true);
    assert.equal(options.realManifestMetadataExecution, true);
    assert.equal(options.strict, true);
    assert.equal(options.runMode, 'local_manifest_dry_run');
    assert.equal(options.maxFilesOpened, BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED);
    assert.equal(options.maxRowsPerFile, BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE);
    assert.equal(options.maxTotalRows, BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS);
    assert.equal(options.maxTotalBytes, BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES);
  });

  it('refuses the probe mode when any declaration or cap is missing', () => {
    const required = [
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
    ];
    for (const flag of required) {
      assert.throws(
        () => parseFullJoinRunnerArgs(argsWithout(flag)),
        ForbiddenFullJoinRunnerModeError,
        `dropping ${flag} should fail closed`,
      );
    }
  });

  it('refuses the Option C declaration without the Option C mode', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs(argsWithout('--required-family-probe')),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('refuses a cap above its Option C ceiling', () => {
    const overCap: ReadonlyArray<readonly [string, number]> = [
      ['--max-files-opened', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED + 1],
      ['--max-rows-per-file', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE + 1],
      ['--max-total-rows', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS + 1],
      ['--max-total-bytes', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES + 1],
      // Shared with Option B, whose ceiling is far wider — the probe re-checks it.
      ['--max-bytes-per-file', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE + 1],
    ];
    for (const [flag, value] of overCap) {
      const args = [...argsWithout(flag), flag, String(value)];
      assert.throws(() => parseFullJoinRunnerArgs(args), ForbiddenFullJoinRunnerModeError, flag);
    }
  });

  it('still refuses every import / runtime / provider flag on a probe invocation', () => {
    for (const flag of ['--import', '--execute', '--supabase', '--runtime', '--agent1', '--full']) {
      assert.throws(
        () => parseFullJoinRunnerArgs([...PROBE_ARGS, flag]),
        ForbiddenFullJoinRunnerModeError,
        flag,
      );
    }
  });

  it('still refuses an --output path inside the repository on a probe invocation', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs([...PROBE_ARGS, '--output', 'scratchpad/probe-report.json']),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('leaves the safe synthetic invocations working unchanged', () => {
    const fixture = parseFullJoinRunnerArgs(['--synthetic-fixture', '--format', 'json', '--strict']);
    assert.equal(fixture.runMode, 'synthetic_fixture_only');
    assert.equal(fixture.requiredFamilyProbe, false);

    const temp = parseFullJoinRunnerArgs([
      '--synthetic-temp-manifest',
      '--format',
      'json',
      '--strict',
      '--max-company-rows',
      '20',
      '--max-establishment-rows',
      '20',
      '--max-company-scan-rows',
      '1000',
      '--max-bytes-per-file',
      '1000000',
    ]);
    assert.equal(temp.runMode, 'local_manifest_dry_run');
    assert.equal(temp.requiredFamilyProbe, false);
  });
});

// ─── Static guards ───────────────────────────────────────────────────────────

const require_ = createRequire(import.meta.url);

/** The module's CODE, with comments stripped: these guards are about what it does. */
function probeSource(): string {
  const raw = fs.readFileSync(require_.resolve('../br-receita-cnpj-required-family-probe'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The module's RAW text, comments included — used for the embedded-path guard. */
function probeRawSource(): string {
  return fs.readFileSync(require_.resolve('../br-receita-cnpj-required-family-probe'), 'utf8');
}

describe('BR-SOURCE-11F-IMPL required-family probe — static guards', () => {
  it('imports no Supabase, Agent 1, provider, HubSpot or Slack module', () => {
    const source = probeSource();
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
        `probe source must not reference "${forbidden}"`,
      );
    }
  });

  it('computes no hash and no join', () => {
    const source = probeSource();
    for (const forbidden of ['createHash', 'sha256', 'digest', 'joinKey', 'normalizedTaxId']) {
      assert.ok(!source.includes(forbidden), `probe source must not reference "${forbidden}"`);
    }
  });

  it('writes nothing: no write, append, unlink, mkdir or rm call', () => {
    const source = probeSource();
    for (const forbidden of [
      'writeFile',
      'appendFile',
      'unlink',
      'mkdir',
      'rmSync',
      'rmdir',
      'createWriteStream',
    ]) {
      assert.ok(!source.includes(forbidden), `probe source must not call "${forbidden}"`);
    }
  });

  it('opens files only through the two bounded readers, and never stats or lists', () => {
    const source = probeSource();
    // Exactly two `openSync` call sites: the manifest control document and one data file.
    assert.equal(source.split('fs.openSync(').length - 1, 2);
    assert.equal(source.split('fs.readSync(').length - 1, 2);
    for (const forbidden of ['statSync', 'readdirSync', 'existsSync', 'globSync', 'realpathSync']) {
      assert.ok(!source.includes(forbidden), `probe source must not call "${forbidden}"`);
    }
  });

  it('embeds no operator path and no real dataset location, in code OR in prose', () => {
    const source = probeRawSource();
    for (const forbidden of [
      '/Users/',
      'Downloads',
      'sellup-source-data',
      'dados_abertos',
      'manifest.headerless.json',
      'manifest.real.json',
    ]) {
      assert.ok(!source.includes(forbidden), `probe source must not embed "${forbidden}"`);
    }
  });

  it('holds the two-file / one-per-family invariant as a constant, not a convention', () => {
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED, 2);
    assert.deepEqual(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES, [
      'empresas',
      'estabelecimentos',
    ]);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE, 64_000);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE, 20);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS, 40);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES, 128_000);
  });
});
