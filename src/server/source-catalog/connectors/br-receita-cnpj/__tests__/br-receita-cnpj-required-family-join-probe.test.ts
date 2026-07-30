/**
 * BR Receita CNPJ ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE — tests (BR-SOURCE-11G-IMPL).
 *
 * BR-SOURCE-11F-IMPL established that the two required-family files a manifest declares can be
 * opened and parsed STRUCTURALLY under caps, retaining nothing. BR-SOURCE-11G-IMPL is the first
 * milestone that reads a VALUE out of them, under the owner's phrase:
 *
 *     AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE
 *
 * These tests hold the line on what "ultra-bounded required-family real join" means:
 *   - the file surface is UNCHANGED from 11F: one file per required family, two data files;
 *   - exactly ONE field position per row is parsed, the key window is capped, and it is
 *     released before the aggregate is emitted;
 *   - the outcome is a coarse BUCKET — `zero`, `one_or_more`, or `not_reported` — and
 *     `not_reported` is a GREEN result rather than a failure (decision record § 7.1);
 *   - no join key, joined row, joined sample, join pair, hash, coverage percentage or coverage
 *     claim appears anywhere in a scan, a report, an error message, or a rendered output,
 *     asserted by scanning the serialized output and by reading the module source;
 *   - every cap is REQUIRED, every cap is enforced against a real over-cap input, and the two
 *     join-output caps are EQUALITIES at zero rather than ceilings;
 *   - the 11G authorization is never inferred from the 11F one, in either direction;
 *   - all eight gates stay `not_approved`, every scope flag stays `false`, and the report
 *     passes output sanitization unchanged.
 *
 * 100% synthetic. Every manifest and every CSV here is written by this suite into a temp
 * workspace it creates and removes. The staging-shaped directory names are LOCAL fixtures named
 * after the denylist entries so the refusals can be measured. No real Receita manifest, no real
 * data file, no operator directory, no dataset, no Supabase, no network, no runtime.
 *
 * Every cell this suite writes is an opaque `SYN-…` token, so no identifier-shaped literal
 * (8-, 11- or 14-digit run) exists in this source file or in any fixture it creates. The join
 * keys are opaque `SYN-JOIN-ROOT-…` tokens that resemble no real root value.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MATCH_RESULT_BUCKETS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MODE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_ROWS_BUCKETS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
  BrazilReceitaRequiredFamilyJoinProbeError,
  createBrazilReceitaRequiredFamilyJoinProbe,
  type BrazilReceitaRequiredFamilyJoinProbeOptions,
  type BrazilReceitaRequiredFamilyJoinProbeReadRequest,
  type BrazilReceitaRequiredFamilyJoinProbeScan,
} from '../br-receita-cnpj-required-family-join-probe';
import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
} from '../br-receita-cnpj-required-family-probe';
import {
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
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

const WORKSPACE_PREFIX = 'br-source-11g-impl-required-family-join-probe-test-';

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
 * resemble no real root value: no digit run, no checksum, no length that could be mistaken for
 * a CNPJ básico. Overlap between the two windows is therefore fully controlled by the test.
 */
const OVERLAPPING_KEYS: readonly string[] = ['SYN-JOIN-ROOT-A', 'SYN-JOIN-ROOT-B'];
const DISJOINT_KEYS: readonly string[] = ['SYN-JOIN-ROOT-X', 'SYN-JOIN-ROOT-Y'];

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
    index === BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX
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
 * The default workspace: a manifest declaring both required families (each with a real
 * synthetic CSV beside it) plus three catalog families whose files are DELIBERATELY not
 * written. A probe that opened a catalog file would fail with a missing-file error, so the
 * "catalogs are counted, never opened" invariant is measured rather than asserted.
 */
function createJoinWorkspace(
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
  for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
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
  maxManifestBytes: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES,
  maxFilesOpened: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED,
  maxBytesPerFile: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE,
  maxRowsPerFile: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE,
  maxTotalRows: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS,
  maxTotalBytes: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES,
  maxJoinInputRows: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
  maxJoinKeyValuesInMemory:
    BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
  maxJoinPairsEmitted: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED,
  maxJoinedRowsPrinted: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED,
} as const;

const READ_REQUEST: BrazilReceitaRequiredFamilyJoinProbeReadRequest = { ...AUTHORIZED_CAPS };

function probeOptions(
  manifestPath: string,
  overrides: Partial<BrazilReceitaRequiredFamilyJoinProbeOptions> = {},
): BrazilReceitaRequiredFamilyJoinProbeOptions {
  return {
    manifestPath,
    requiredFamilyJoinProbeAuthorized: true,
    realLocalJoinDryRunAuthorized: true,
    requiredFamilyProbeAuthorized: true,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    ...AUTHORIZED_CAPS,
    ...overrides,
  };
}

function runProbe(
  manifestPath: string,
  overrides: Partial<BrazilReceitaRequiredFamilyJoinProbeOptions> = {},
  request: BrazilReceitaRequiredFamilyJoinProbeReadRequest = READ_REQUEST,
): BrazilReceitaRequiredFamilyJoinProbeScan {
  return createBrazilReceitaRequiredFamilyJoinProbe(probeOptions(manifestPath, overrides))(request);
}

function probeErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BrazilReceitaRequiredFamilyJoinProbeError);
    return (error as BrazilReceitaRequiredFamilyJoinProbeError).code;
  }
  return assert.fail('expected the join probe to refuse');
}

function rowsCounted(scan: BrazilReceitaRequiredFamilyJoinProbeScan, family: string): number {
  const shape = scan.rowShape[family];
  if (shape === undefined) return 0;
  return shape.rowShapeValidCount + shape.rowShapeInvalidCount;
}

// ─── The happy path: two files, two families, one bounded join ─────────────────

describe('BR-SOURCE-11G-IMPL join probe — bounded happy path', () => {
  it('opens exactly two files, one per required family, and executes the join', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.manifestTrust, BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_TRUST);
    assert.equal(scan.filesOpenedCount, 2);
    assert.deepEqual(scan.filesOpenedByFamily, { empresas: 1, estabelecimentos: 1 });
    assert.equal(scan.selectionClass, 'selected');
    assert.equal(scan.joinsExecuted, true);
    assert.equal(scan.joinProbe.joinExecuted, true);
    assert.equal(scan.joinProbe.joinMode, BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MODE);
  });

  it('reports one_or_more when the two bounded windows overlap', () => {
    const { manifestPath } = createJoinWorkspace({
      empresasKeys: OVERLAPPING_KEYS,
      estabelecimentosKeys: OVERLAPPING_KEYS,
    });
    const scan = runProbe(manifestPath);

    assert.equal(scan.joinProbe.matchResultBucket, 'one_or_more');
    assert.equal(scan.joinProbe.matchedRowsBucket, 'lte_20');
    assert.equal(scan.joinProbe.unmatchedRowsBucket, 'zero');
  });

  it('reports zero — a green result — when the windows are disjoint by shard', () => {
    const { manifestPath } = createJoinWorkspace({
      empresasKeys: OVERLAPPING_KEYS,
      estabelecimentosKeys: DISJOINT_KEYS,
    });
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null, 'zero overlap is not a refusal');
    assert.equal(scan.joinProbe.joinExecuted, true);
    assert.equal(scan.joinProbe.matchResultBucket, 'zero');
    assert.equal(scan.joinProbe.matchedRowsBucket, 'zero');
    assert.equal(scan.joinProbe.unmatchedRowsBucket, 'lte_20');
  });

  it('reports a partial overlap as one_or_more plus unmatched, never as a count', () => {
    const { manifestPath } = createJoinWorkspace({
      empresasKeys: OVERLAPPING_KEYS,
      estabelecimentosKeys: [...OVERLAPPING_KEYS.slice(0, 1), ...DISJOINT_KEYS],
    });
    const scan = runProbe(manifestPath);

    assert.equal(scan.joinProbe.matchResultBucket, 'one_or_more');
    assert.equal(scan.joinProbe.matchedRowsBucket, 'lte_20');
    assert.equal(scan.joinProbe.unmatchedRowsBucket, 'lte_20');
    // No count, no ratio: the serialized block carries only bucket labels and zeros.
    const serialized = JSON.stringify(scan.joinProbe);
    assert.ok(!/[1-9]/.test(serialized.replace(/lte_20/g, '')));
  });

  it('reports not_reported — also green — when one window yields no key', () => {
    const { manifestPath } = createJoinWorkspace({ estabelecimentosKeys: [] });
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, null, 'an empty comparison window is not a refusal');
    assert.equal(scan.joinProbe.joinExecuted, false);
    assert.equal(scan.joinProbe.matchResultBucket, 'not_reported');
    assert.equal(scan.joinProbe.matchedRowsBucket, 'not_reported');
    assert.equal(scan.joinProbe.unmatchedRowsBucket, 'not_reported');
    assert.equal(scan.joinsExecuted, false);
  });

  it('classifies structure exactly as the 11F probe did — the file surface is unchanged', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(manifestPath);

    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
      assert.equal(scan.bytesReadBucket[family], 'lte_64kb');
      assert.equal(scan.rowsReadBucket[family], 'lte_20');
      assert.equal(scan.encodingStatus[family], 'ok');
      assert.equal(scan.delimiterStatus[family], 'semicolon_detected');
      assert.equal(scan.headerlessStatus[family], 'assumed_headerless');
      assert.equal(rowsCounted(scan, family), OVERLAPPING_KEYS.length);
      assert.equal(scan.rowShape[family]!.rowShapeInvalidCount, 0);
    }
  });

  it('counts catalog families without opening them, and holds every absence assertion', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(manifestPath);

    // The three catalog files were declared but never written: a probe that opened one would
    // have thrown a missing-file read failure.
    assert.equal(scan.neverOpenedFamilyCount, 3);
    assert.equal(scan.forbiddenFamilyCount, 0);
    assert.equal(scan.rawRowsRetained, false);
    assert.equal(scan.rawCellsRetained, false);
    assert.equal(scan.identifiersRetained, false);
    assert.equal(scan.fileNamesRetained, false);
    assert.equal(scan.absolutePathsRetained, false);
    assert.equal(scan.hashesComputed, false);
    assert.equal(scan.joinCoverageComputed, false);
    assert.equal(scan.joinProbe.joinKeyValuesPrinted, false);
    assert.equal(scan.joinProbe.joinKeyValuesRetained, false);
    assert.equal(scan.joinProbe.joinKeyHashesPrinted, false);
    assert.equal(scan.joinProbe.joinKeyErrorLeak, false);
    assert.equal(scan.joinProbe.joinedRowsPrinted, false);
    assert.equal(scan.joinProbe.joinedSamplesPrinted, false);
    assert.equal(scan.joinProbe.joinedPairsEmitted, 0);
    assert.equal(scan.joinProbe.coveragePercentagePrinted, false);
    assert.equal(scan.joinProbe.coverageClaimed, false);
  });

  it('parses ONE field position per row — a shifted key column produces no match', () => {
    // The same tokens, moved off the join-key column: if the probe read any other position it
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
    const scan = runProbe(writeManifest(root, manifestDocument(files)));

    assert.equal(scan.joinProbe.joinExecuted, true);
    assert.equal(scan.joinProbe.matchResultBucket, 'zero');
  });

  it('parses a QUOTED join key — the official files quote every field', () => {
    const root = createWorkspace();
    const quoted = (family: string, key: string): string =>
      syntheticRow(family, 0, key)
        .split(';')
        .map((cell) => `"${cell}"`)
        .join(';');
    const files: DeclaredFileFixture[] = [];
    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
      const relative = SYNTHETIC_FILE_LABELS[family]!;
      fs.writeFileSync(path.join(root, relative), `${quoted(family, OVERLAPPING_KEYS[0]!)}\n`, {
        encoding: 'latin1',
      });
      files.push({
        fileType: family,
        path: relative,
        encoding: 'latin1',
        layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
      });
    }
    const scan = runProbe(writeManifest(root, manifestDocument(files)));

    assert.equal(scan.joinProbe.matchResultBucket, 'one_or_more');
  });
});

// ─── Authorizations ───────────────────────────────────────────────────────────

describe('BR-SOURCE-11G-IMPL join probe — authorizations', () => {
  it('refuses without the 11G Option C phrase', () => {
    const { manifestPath } = createJoinWorkspace();
    assert.equal(
      probeErrorCode(() => runProbe(manifestPath, { requiredFamilyJoinProbeAuthorized: undefined })),
      'required_family_join_probe_not_authorized',
    );
  });

  it('refuses without the real-local join dry-run declaration', () => {
    const { manifestPath } = createJoinWorkspace();
    assert.equal(
      probeErrorCode(() => runProbe(manifestPath, { realLocalJoinDryRunAuthorized: undefined })),
      'required_family_join_probe_not_authorized',
    );
  });

  it('does NOT infer the 11G authorization from the 11F one', () => {
    const { manifestPath } = createJoinWorkspace();
    // Everything the 11F structural probe needed, and nothing 11G added: refused.
    assert.equal(
      probeErrorCode(() =>
        createBrazilReceitaRequiredFamilyJoinProbe({
          manifestPath,
          requiredFamilyProbeAuthorized: true,
          realManifestMetadataOnlyOptionBAuthorized: true,
          realManifestMetadataOnlyExecutionAuthorized: true,
          ...AUTHORIZED_CAPS,
        })(READ_REQUEST),
      ),
      'required_family_join_probe_not_authorized',
    );
  });

  it('does NOT accept the 11G authorization INSTEAD of the 11F one', () => {
    const { manifestPath } = createJoinWorkspace();
    // The 11G phrase permits parsing a value; it says nothing about opening the files.
    assert.equal(
      probeErrorCode(() => runProbe(manifestPath, { requiredFamilyProbeAuthorized: undefined })),
      'required_family_join_probe_not_authorized',
    );
  });

  it('refuses without the metadata-only and 11E manifest declarations', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const missing of [
      { realManifestMetadataOnlyOptionBAuthorized: undefined },
      { realManifestMetadataOnlyExecutionAuthorized: undefined },
    ] as ReadonlyArray<Partial<BrazilReceitaRequiredFamilyJoinProbeOptions>>) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, missing)),
        'required_family_join_probe_not_authorized',
      );
    }
  });
});

// ─── Caps ─────────────────────────────────────────────────────────────────────

describe('BR-SOURCE-11G-IMPL join probe — caps', () => {
  it('refuses when ANY cap is not stated', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const cap of Object.keys(AUTHORIZED_CAPS) as ReadonlyArray<keyof typeof AUTHORIZED_CAPS>) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, { [cap]: undefined })),
        'required_family_join_probe_cap_required',
        `omitting ${cap} must fail closed`,
      );
    }
  });

  it('refuses a cap above its ceiling', () => {
    const { manifestPath } = createJoinWorkspace();
    const overCap: ReadonlyArray<readonly [keyof typeof AUTHORIZED_CAPS, number]> = [
      ['maxManifestBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES + 1],
      ['maxDeclaredFiles', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES + 1],
      ['maxFilesOpened', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED + 1],
      ['maxBytesPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE + 1],
      ['maxRowsPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE + 1],
      ['maxTotalRows', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS + 1],
      ['maxTotalBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES + 1],
      ['maxJoinInputRows', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS + 1],
      [
        'maxJoinKeyValuesInMemory',
        BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY + 1,
      ],
    ];
    for (const [cap, value] of overCap) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, { [cap]: value })),
        'required_family_join_probe_cap_exceeded',
        `${cap} above its ceiling must fail closed`,
      );
    }
  });

  it('refuses a join-output cap above ZERO with its own code, not as a cap breach', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const cap of ['maxJoinPairsEmitted', 'maxJoinedRowsPrinted'] as const) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, { [cap]: 1 })),
        'required_family_join_probe_join_output_forbidden',
        `${cap} above zero is an unauthorized capability`,
      );
    }
  });

  it('refuses a READ that asks for more than the probe was built with', () => {
    const { manifestPath } = createJoinWorkspace();
    const narrow = probeOptions(manifestPath, { maxRowsPerFile: 1, maxJoinInputRows: 1 });
    assert.equal(
      probeErrorCode(() => createBrazilReceitaRequiredFamilyJoinProbe(narrow)(READ_REQUEST)),
      'required_family_join_probe_cap_exceeded',
    );
  });

  it('enforces the per-file row cap on real over-cap input', () => {
    const manyKeys = Array.from({ length: 6 }, (_unused, index) => `SYN-JOIN-ROOT-${index}`);
    const { manifestPath } = createJoinWorkspace({
      empresasKeys: manyKeys,
      estabelecimentosKeys: manyKeys,
    });
    const scan = runProbe(
      manifestPath,
      { maxRowsPerFile: 2, maxTotalRows: 4 },
      { ...READ_REQUEST, maxRowsPerFile: 2, maxTotalRows: 4 },
    );

    assert.equal(scan.refusalCode, null);
    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
      assert.equal(rowsCounted(scan, family), 2, `${family} must stop at the row cap`);
    }
  });

  it('bounds the in-memory key window, and a zero window yields not_reported', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(
      manifestPath,
      { maxJoinKeyValuesInMemory: 0 },
      { ...READ_REQUEST, maxJoinKeyValuesInMemory: 0 },
    );

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.joinProbe.matchResultBucket, 'not_reported');
    assert.equal(scan.joinsExecuted, false);
  });

  it('bounds the rows fed to the join independently of the rows counted', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(
      manifestPath,
      { maxJoinInputRows: 1 },
      { ...READ_REQUEST, maxJoinInputRows: 1 },
    );

    // One row of `empresas` fed the window; the second file's join budget is exhausted, so no
    // comparison happens and the outcome is `not_reported` rather than a partial claim.
    assert.equal(scan.refusalCode, null);
    assert.equal(scan.joinProbe.matchResultBucket, 'not_reported');
    assert.equal(rowsCounted(scan, 'estabelecimentos'), OVERLAPPING_KEYS.length);
  });

  it('refuses when the file cap cannot cover both required families', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(
      manifestPath,
      { maxFilesOpened: 1 },
      { ...READ_REQUEST, maxFilesOpened: 1 },
    );

    assert.equal(scan.refusalCode, 'required_family_join_probe_file_count_exceeded');
    assert.equal(scan.selectionClass, 'file_count_cap_too_small');
    assert.equal(scan.filesOpenedCount, 0);
    assert.equal(scan.joinProbe.joinExecuted, false);
  });

  it('refuses an oversized manifest rather than reading a truncated document', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(
      manifestPath,
      { maxManifestBytes: 8 },
      { ...READ_REQUEST, maxManifestBytes: 8 },
    );
    assert.equal(scan.refusalCode, 'required_family_join_probe_cap_exceeded');
    assert.equal(scan.filesOpenedCount, 0);
  });

  it('honours the liveness deadline without leaking anything', () => {
    const { manifestPath } = createJoinWorkspace();
    let calls = 0;
    const scan = runProbe(manifestPath, {
      // The first call sets the deadline; every later call is far beyond it.
      nowMs: () => (calls++ === 0 ? 0 : Number.MAX_SAFE_INTEGER),
    });
    assert.equal(scan.refusalCode, 'required_family_join_probe_timeout');
    assert.equal(scan.filesOpenedCount, 0);
    assert.equal(scan.joinProbe.matchResultBucket, 'not_reported');
  });
});

// ─── Forbidden output requests ────────────────────────────────────────────────

describe('BR-SOURCE-11G-IMPL join probe — forbidden output requests', () => {
  it('refuses a raw-row, raw-cell or sample request', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const request of [
      { includeRawRows: true },
      { includeRawCells: true },
      { includeSampleRows: true },
    ]) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, request)),
        'required_family_join_probe_raw_output_forbidden',
      );
    }
  });

  it('refuses an identifier, filename or hash request', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const request of [
      { includeIdentifiers: true },
      { includeDeclaredFileNames: true },
      { includeHashes: true },
    ]) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, request)),
        'required_family_join_probe_identifier_output_forbidden',
      );
    }
  });

  it('refuses a join-key, joined-row, joined-sample or join-pair request', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const request of [
      { includeJoinKeys: true },
      { includeJoinedRows: true },
      { includeJoinedSamples: true },
      { includeJoinPairs: true },
    ]) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, request)),
        'required_family_join_probe_join_output_forbidden',
      );
    }
  });

  it('refuses a COVERAGE request rather than serving it with a caveat', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const request of [{ computeCoverage: true }, { includeCoveragePercentage: true }]) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath, request)),
        'required_family_join_probe_coverage_forbidden',
      );
    }
  });
});

// ─── Refusals: families, archives, paths ──────────────────────────────────────

describe('BR-SOURCE-11G-IMPL join probe — refusals', () => {
  it('refuses a manifest declaring a Sócios/QSA/CPF/person family, and opens nothing', () => {
    for (const label of ['socios', 'qsa', 'socios_cpf', 'representante_legal']) {
      const { manifestPath } = createJoinWorkspace({
        // The file is never written: a probe that tried to open it would fail differently.
        extraFiles: [{ fileType: label, path: SYNTHETIC_FILE_LABELS.socios!, encoding: 'latin1' }],
      });
      const scan = runProbe(manifestPath);
      assert.equal(scan.refusalCode, 'required_family_join_probe_forbidden_family', label);
      assert.equal(scan.filesOpenedCount, 0);
      assert.equal(scan.forbiddenFamilyCount, 1);
      assert.equal(scan.joinProbe.joinExecuted, false);
      assert.ok(!JSON.stringify(scan).includes(SYNTHETIC_FILE_LABELS.socios!));
    }
  });

  it('refuses a missing required family', () => {
    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
      const { manifestPath } = createJoinWorkspace({ omitFamily: family });
      const scan = runProbe(manifestPath);
      assert.equal(scan.refusalCode, 'required_family_join_probe_missing_required_family', family);
      assert.equal(scan.selectionClass, 'family_not_declared');
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('refuses an ARCHIVE and a non-tabular extension', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['synthetic-empresas.zip', 'declared_extension_archive'],
      ['synthetic-empresas.gz', 'declared_extension_archive'],
      ['synthetic-empresas.json', 'declared_extension_not_tabular'],
    ];
    for (const [fileName, selectionClass] of cases) {
      const root = createWorkspace();
      const files: DeclaredFileFixture[] = [
        { fileType: 'empresas', path: fileName, encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', OVERLAPPING_KEYS),
          encoding: 'latin1',
        },
      ];
      const scan = runProbe(writeManifest(root, manifestDocument(files)));
      assert.equal(scan.refusalCode, 'required_family_join_probe_zip_forbidden', fileName);
      assert.equal(scan.selectionClass, selectionClass);
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('refuses a ZIP-STAGING declared path, an absolute one, and a traversing one', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      [
        `${BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS[0]!}/synthetic-empresas.csv`,
        'declared_path_zip_staging_segment',
      ],
      [`${path.sep}synthetic-empresas.csv`, 'declared_path_absolute_or_url'],
      ['../synthetic-empresas.csv', 'declared_path_outside_manifest_directory'],
      ['', 'declared_path_missing'],
    ];
    for (const [declaredPath, selectionClass] of cases) {
      const root = createWorkspace();
      const files: DeclaredFileFixture[] = [
        { fileType: 'empresas', path: declaredPath, encoding: 'latin1' },
        {
          fileType: 'estabelecimentos',
          path: writeCsv(root, 'estabelecimentos', OVERLAPPING_KEYS),
          encoding: 'latin1',
        },
      ];
      const scan = runProbe(writeManifest(root, manifestDocument(files)));
      assert.equal(scan.refusalCode, 'required_family_join_probe_open_failed', selectionClass);
      assert.equal(scan.selectionClass, selectionClass);
      assert.equal(scan.filesOpenedCount, 0);
    }
  });

  it('refuses a manifest path that is a URL or not a .json document', () => {
    for (const manifestPath of ['https://example.invalid/manifest.json', '/tmp/manifest.csv', '']) {
      assert.equal(
        probeErrorCode(() => runProbe(manifestPath)),
        'required_family_join_probe_open_failed',
      );
    }
  });

  it('reports a read failure without a path when a declared file is absent', () => {
    const root = createWorkspace();
    const files: DeclaredFileFixture[] = BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES.map(
      (family) => ({
        fileType: family,
        path: SYNTHETIC_FILE_LABELS[family]!,
        encoding: 'latin1',
        layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
      }),
    );
    const manifestPath = writeManifest(root, manifestDocument(files));
    const scan = runProbe(manifestPath);

    assert.equal(scan.refusalCode, 'required_family_join_probe_read_failed');
    assert.equal(scan.joinProbe.joinExecuted, false);
    const serialized = JSON.stringify(scan);
    assert.ok(!serialized.includes(root));
    assert.ok(!serialized.includes(SYNTHETIC_FILE_LABELS.empresas!));
  });
});

// ─── Output safety ───────────────────────────────────────────────────────────

describe('BR-SOURCE-11G-IMPL join probe — output safety', () => {
  it('returns no join key, no cell, no path, no filename and no basename', () => {
    const { root, manifestPath } = createJoinWorkspace();
    const serialized = JSON.stringify(runProbe(manifestPath));

    for (const joinKey of [...OVERLAPPING_KEYS, ...DISJOINT_KEYS]) {
      assert.ok(!serialized.includes(joinKey), 'scan leaked a join key');
    }
    assert.ok(!serialized.includes('SYN-JOIN-ROOT'));
    assert.ok(!serialized.includes(root));
    assert.ok(!serialized.includes(path.basename(manifestPath)));
    for (const label of Object.values(SYNTHETIC_FILE_LABELS)) {
      assert.ok(!serialized.includes(label), 'scan leaked a declared filename');
    }
    assert.ok(!serialized.includes('SYN-EMPRESAS'));
    assert.ok(!serialized.includes('SYN-ESTABELECIMENTOS'));
    // No hex digest, and no byte figure: buckets only.
    assert.ok(!/[a-f0-9]{32,}/i.test(serialized));
    assert.ok(!serialized.includes('bytesRead"'));
  });

  it('leaks no join key through a REFUSAL message or a thrown error', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const overrides of [
      { requiredFamilyJoinProbeAuthorized: undefined },
      { maxJoinPairsEmitted: 1 },
      { computeCoverage: true },
    ] as ReadonlyArray<Partial<BrazilReceitaRequiredFamilyJoinProbeOptions>>) {
      try {
        runProbe(manifestPath, overrides);
        assert.fail('expected the join probe to refuse');
      } catch (error) {
        const message = (error as Error).message;
        assert.ok(message.startsWith('BRSOURCE11GIMPL_REQUIRED_FAMILY_JOIN_PROBE: '));
        for (const joinKey of OVERLAPPING_KEYS) assert.ok(!message.includes(joinKey));
        assert.ok(!message.includes(manifestPath));
        assert.ok(!message.includes(os.tmpdir()));
      }
    }
  });

  it('states only bucket labels from the declared vocabularies', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(manifestPath);
    assert.ok(
      BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MATCH_RESULT_BUCKETS.includes(
        scan.joinProbe.matchResultBucket,
      ),
    );
    for (const bucket of [scan.joinProbe.matchedRowsBucket, scan.joinProbe.unmatchedRowsBucket]) {
      assert.ok(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_ROWS_BUCKETS.includes(bucket));
    }
  });

  it('passes the output sanitizer once projected onto a report', () => {
    const { manifestPath } = createJoinWorkspace();
    const scan = runProbe(manifestPath);
    const result = sanitizeBrazilReceitaFullJoinReport({
      required_family_join_probe_scan: scan,
    });
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
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    requiredFamilyProbeAuthorized: true,
    requiredFamilyJoinProbeAuthorized: true,
    realLocalJoinDryRunAuthorized: true,
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
    requiredFamilyJoinProbeReader: createBrazilReceitaRequiredFamilyJoinProbe(
      probeOptions(manifestPath),
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

describe('BR-SOURCE-11G-IMPL join probe — runner integration', () => {
  it('returns an ok, aggregate, sanitized join-probe report', () => {
    const { manifestPath } = createJoinWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.manifest_trust, BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST);
    assert.equal(report.required_family_join_probe_authorized, true);
    assert.equal(report.real_local_join_dry_run_authorized, true);
    assert.equal(report.required_family_probe, null, 'the structural block belongs to 11F');
    assert.notEqual(report.manifest_metadata, null);
    assert.notEqual(report.required_family_join_probe, null);
    assert.equal(report.required_family_join_probe!.files_opened_count, 2);
    assert.deepEqual(report.required_family_join_probe!.files_opened_by_family, {
      empresas: 1,
      estabelecimentos: 1,
    });
    assert.equal(report.guardrail_counts.required_family_join_probe_files_opened, 2);
    assert.equal(sanitizeBrazilReceitaFullJoinReport(report).ok, true);
  });

  it('reports join_executed true, coverage false, and a bucket rather than a count', () => {
    const { manifestPath } = createJoinWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));
    const block = report.required_family_join_probe!;

    assert.equal(block.joins_executed, true);
    assert.equal(block.join_coverage_computed, false);
    assert.equal(block.full_dataset_processed, false);
    assert.equal(block.join_probe.join_executed, true);
    assert.equal(block.join_probe.join_mode, 'ultra_bounded_required_family_in_memory');
    assert.equal(block.join_probe.join_key_values_printed, false);
    assert.equal(block.join_probe.join_key_values_retained, false);
    assert.equal(block.join_probe.join_key_hashes_printed, false);
    assert.equal(block.join_probe.join_key_error_leak, false);
    assert.equal(block.join_probe.joined_rows_printed, false);
    assert.equal(block.join_probe.joined_samples_printed, false);
    assert.equal(block.join_probe.joined_pairs_emitted, 0);
    assert.equal(block.join_probe.coverage_percentage_printed, false);
    assert.equal(block.join_probe.coverage_claimed, false);
    assert.equal(block.join_probe.match_result_bucket, 'one_or_more');
  });

  it('holds all eight gates not_approved and every scope flag false', () => {
    const { manifestPath } = createJoinWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    for (const status of Object.values(report.decision_status)) {
      assert.equal(status, 'not_approved');
    }
    for (const flag of Object.values(report.run_scope)) assert.equal(flag, false);
    for (const flag of Object.values(report.safety)) assert.equal(flag, false);
  });

  it('reports zero row, eligibility and join COUNTS — the outcome is a bucket', () => {
    const { manifestPath } = createJoinWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    for (const value of Object.values(report.aggregate_counts)) assert.equal(value, 0);
    for (const value of Object.values(report.eligibility_counts)) assert.equal(value, 0);
    for (const value of Object.values(report.join_counts)) assert.equal(value, 0);
    assert.equal(report.source_period, null);
  });

  it('refuses when either 11G declaration is absent, with its own code', () => {
    const { manifestPath } = createJoinWorkspace();
    const cases: ReadonlyArray<readonly [Partial<BrazilReceitaFullJoinDryRunInput>, string]> = [
      [
        { requiredFamilyJoinProbeAuthorized: undefined },
        'required_family_join_probe_not_authorized',
      ],
      [{ realLocalJoinDryRunAuthorized: undefined }, 'real_local_join_dry_run_not_authorized'],
      [{ requiredFamilyProbeAuthorized: undefined }, 'required_family_probe_not_authorized'],
    ];
    for (const [overrides, expected] of cases) {
      const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath, overrides));
      assert.equal(report.ok, false);
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'required_family_join_probe_gate' },
      ]);
      assert.equal(report.required_family_join_probe, null);
    }
  });

  it('refuses without strict, without allowLocalManifest, and on an unstated sanitizer version', () => {
    const { manifestPath } = createJoinWorkspace();
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

  it('refuses a missing join cap, an over-cap join cap, and a missing reader', () => {
    const { manifestPath } = createJoinWorkspace();
    for (const cap of [
      'maxFilesOpened',
      'maxBytesPerFile',
      'maxRowsPerFile',
      'maxTotalRows',
      'maxTotalBytes',
      'maxJoinInputRows',
      'maxJoinKeyValuesInMemory',
      'maxJoinPairsEmitted',
      'maxJoinedRowsPrinted',
    ] as const) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, { [cap]: undefined }),
      );
      assert.equal(report.ok, false);
      assert.ok(
        report.errors.some(
          (error) => error.error_code === 'required_family_join_probe_caps_required',
        ),
        `omitting ${cap} must fail closed`,
      );
    }

    const overCap = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        maxJoinInputRows: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS + 1,
      }),
    );
    assert.equal(overCap.ok, false);
    assert.ok(
      overCap.errors.some(
        (error) => error.error_code === 'required_family_join_probe_cap_exceeded',
      ),
    );

    const pairs = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, { maxJoinPairsEmitted: 1 }),
    );
    assert.equal(pairs.ok, false);
    assert.ok(
      pairs.errors.some(
        (error) => error.error_code === 'required_family_join_probe_join_output_detected',
      ),
    );

    const withoutReader = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, { requiredFamilyJoinProbeReader: undefined }),
    );
    assert.equal(withoutReader.ok, false);
    assert.ok(
      withoutReader.errors.some(
        (error) => error.error_code === 'required_family_join_probe_reader_required',
      ),
    );
  });

  it('refuses an escalation flag — the no-write guard runs before anything else', () => {
    const { manifestPath } = createJoinWorkspace();
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
      assert.equal(report.required_family_join_probe, null);
    }
  });

  it('refuses a probe that claims it printed, retained, hashed or leaked a join key', () => {
    const { manifestPath } = createJoinWorkspace();
    const honest = runProbe(manifestPath);
    const claims: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ joinKeyValuesPrinted: true }, 'required_family_join_probe_identifier_output_detected'],
      [{ joinKeyValuesRetained: true }, 'required_family_join_probe_identifier_output_detected'],
      [{ joinKeyHashesPrinted: true }, 'required_family_join_probe_identifier_output_detected'],
      [{ joinKeyErrorLeak: true }, 'required_family_join_probe_identifier_output_detected'],
      [{ joinedRowsPrinted: true }, 'required_family_join_probe_join_output_detected'],
      [{ joinedSamplesPrinted: true }, 'required_family_join_probe_join_output_detected'],
      [{ joinedPairsEmitted: 1 }, 'required_family_join_probe_join_output_detected'],
      [{ coveragePercentagePrinted: true }, 'required_family_join_probe_coverage_detected'],
      [{ coverageClaimed: true }, 'required_family_join_probe_coverage_detected'],
      [{ matchResultBucket: 'seventeen_percent' }, 'required_family_join_probe_scan_invalid'],
      [{ joinMode: 'full_join' }, 'required_family_join_probe_scan_invalid'],
    ];
    for (const [claim, expected] of claims) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, {
          requiredFamilyJoinProbeReader: () =>
            ({ ...honest, joinProbe: { ...honest.joinProbe, ...claim } }) as never,
        }),
      );
      assert.equal(report.ok, false, JSON.stringify(claim));
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'required_family_join_probe_read' },
      ]);
      assert.equal(report.required_family_join_probe, null);
    }
  });

  it('refuses a probe that claims a row, a cell, a hash or a coverage computation', () => {
    const { manifestPath } = createJoinWorkspace();
    const honest = runProbe(manifestPath);
    const claims: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ rawRowsRetained: true }, 'required_family_join_probe_raw_output_detected'],
      [{ rawCellsRetained: true }, 'required_family_join_probe_raw_output_detected'],
      [{ identifiersRetained: true }, 'required_family_join_probe_raw_output_detected'],
      [{ fileNamesRetained: true }, 'required_family_join_probe_raw_output_detected'],
      [{ absolutePathsRetained: true }, 'required_family_join_probe_raw_output_detected'],
      [{ hashesComputed: true }, 'required_family_join_probe_identifier_output_detected'],
      [{ joinCoverageComputed: true }, 'required_family_join_probe_coverage_detected'],
      [{ filesOpenedCount: 3 }, 'required_family_join_probe_file_count_exceeded'],
      [
        { familiesAttempted: ['empresas', 'socios'] },
        'required_family_join_probe_forbidden_family_detected',
      ],
      [{ manifestTrust: 'real_manifest_required_family_probe' }, 'local_manifest_execution_not_authorized'],
      [{ joinsExecuted: false }, 'required_family_join_probe_not_executed'],
    ];
    for (const [claim, expected] of claims) {
      const report = runBrazilReceitaFullJoinDryRun(
        runnerInput(manifestPath, {
          requiredFamilyJoinProbeReader: () => ({ ...honest, ...claim }) as never,
        }),
      );
      assert.equal(report.ok, false, JSON.stringify(claim));
      assert.deepEqual(report.errors, [
        { error_code: expected, stage: 'required_family_join_probe_read' },
      ]);
    }
  });

  it('surfaces a not_reported probe as a REFUSAL of the report block, never as a claim', () => {
    // `not_reported` is green at the probe layer, but there is no join REPORT to project from a
    // run that never compared anything — so the runner says so with its own code rather than
    // emitting a block implying a comparison happened.
    const { manifestPath } = createJoinWorkspace({ estabelecimentosKeys: [] });
    const report = runBrazilReceitaFullJoinDryRun(runnerInput(manifestPath));

    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'required_family_join_probe_not_executed',
        stage: 'required_family_join_probe_read',
      },
    ]);
    assert.equal(report.required_family_join_probe, null);
  });

  it('maps a probe-reported refusal onto the runner vocabulary', () => {
    const { manifestPath } = createJoinWorkspace();
    const report = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        requiredFamilyJoinProbeReader: () =>
          ({
            ...runProbe(manifestPath),
            refusalCode: 'required_family_join_probe_timeout',
          }) as never,
      }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      { error_code: 'required_family_join_probe_timeout', stage: 'required_family_join_probe_read' },
    ]);
  });

  it('leaves the earlier carve-outs byte-for-byte unchanged', () => {
    const { manifestPath } = createJoinWorkspace();
    const metadataOnly = runBrazilReceitaFullJoinDryRun(
      runnerInput(manifestPath, {
        manifestTrust: 'real_manifest_metadata_only',
        requiredFamilyProbeAuthorized: undefined,
        requiredFamilyJoinProbeAuthorized: undefined,
        realLocalJoinDryRunAuthorized: undefined,
        requiredFamilyJoinProbeReader: undefined,
      }),
    );
    assert.equal(metadataOnly.ok, true, JSON.stringify(metadataOnly.errors));
    assert.equal(metadataOnly.required_family_join_probe, null);
    assert.equal(metadataOnly.required_family_join_probe_authorized, false);
    assert.equal(metadataOnly.real_local_join_dry_run_authorized, false);

    const synthetic = runBrazilReceitaFullJoinDryRun({
      noWriteMode: true,
      runtimeIntegration: false,
      agent1Integration: false,
      supabaseWrite: false,
    });
    assert.equal(synthetic.ok, true);
    assert.equal(synthetic.required_family_join_probe, null);
    assert.equal(synthetic.required_family_join_probe_authorized, false);
    assert.equal(synthetic.real_local_join_dry_run_authorized, false);
  });
});

// ─── CLI contract ────────────────────────────────────────────────────────────

const JOIN_ARGS: readonly string[] = [
  '--manifest',
  '/tmp/synthetic-join-probe-manifest.json',
  '--allow-local-manifest',
  '--real-manifest-metadata-only',
  '--real-manifest-metadata-execution-authorized',
  '--required-family-probe-authorized',
  '--required-family-join-probe',
  '--required-family-join-probe-authorized',
  '--real-local-join-dry-run-authorized',
  '--format',
  'json',
  '--strict',
  '--max-manifest-bytes',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES),
  '--max-declared-files',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES),
  '--max-files-opened',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED),
  '--max-bytes-per-file',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE),
  '--max-rows-per-file',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE),
  '--max-total-rows',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS),
  '--max-total-bytes',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES),
  '--max-join-input-rows',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS),
  '--max-join-key-values-in-memory',
  String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY),
  '--max-join-pairs-emitted',
  '0',
  '--max-joined-rows-printed',
  '0',
];

function argsWithout(...flags: readonly string[]): string[] {
  const dropped = new Set(flags);
  const kept: string[] = [];
  for (let i = 0; i < JOIN_ARGS.length; i++) {
    const token = JOIN_ARGS[i]!;
    if (dropped.has(token)) {
      // Drop the flag, and its value when it takes one.
      const next = JOIN_ARGS[i + 1];
      if (next !== undefined && !next.startsWith('--')) i += 1;
      continue;
    }
    kept.push(token);
  }
  return kept;
}

describe('BR-SOURCE-11G-IMPL join probe — CLI contract', () => {
  it('accepts the fully-declared, fully-capped join-probe invocation', () => {
    const options = parseFullJoinRunnerArgs([...JOIN_ARGS]);
    assert.equal(options.requiredFamilyJoinProbe, true);
    assert.equal(options.requiredFamilyJoinProbeAuthorized, true);
    assert.equal(options.realLocalJoinDryRunAuthorized, true);
    assert.equal(options.requiredFamilyProbeAuthorized, true);
    assert.equal(options.requiredFamilyProbe, false, 'the two probe modes are distinct');
    assert.equal(options.strict, true);
    assert.equal(options.runMode, 'local_manifest_dry_run');
    assert.equal(
      options.maxJoinInputRows,
      BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
    );
    assert.equal(
      options.maxJoinKeyValuesInMemory,
      BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
    );
    assert.equal(options.maxJoinPairsEmitted, 0);
    assert.equal(options.maxJoinedRowsPrinted, 0);
  });

  it('refuses the join-probe mode when any declaration or cap is missing', () => {
    const required = [
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
      '--max-join-input-rows',
      '--max-join-key-values-in-memory',
      '--max-join-pairs-emitted',
      '--max-joined-rows-printed',
    ];
    for (const flag of required) {
      assert.throws(
        () => parseFullJoinRunnerArgs(argsWithout(flag)),
        ForbiddenFullJoinRunnerModeError,
        `dropping ${flag} should fail closed`,
      );
    }
  });

  it('refuses the 11G declarations without the 11G mode', () => {
    for (const flag of [
      '--required-family-join-probe-authorized',
      '--real-local-join-dry-run-authorized',
    ]) {
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            '--manifest',
            '/tmp/synthetic-join-probe-manifest.json',
            '--allow-local-manifest',
            '--real-manifest-metadata-only',
            '--real-manifest-metadata-execution-authorized',
            '--strict',
            '--max-manifest-bytes',
            String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES),
            '--max-declared-files',
            String(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES),
            flag,
          ]),
        ForbiddenFullJoinRunnerModeError,
        flag,
      );
    }
  });

  it('refuses running both probe modes at once — that would open four data files', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs([...JOIN_ARGS, '--required-family-probe']),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('refuses a cap above its ceiling, and ANY positive join-output cap', () => {
    const overCap: ReadonlyArray<readonly [string, number]> = [
      ['--max-files-opened', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED + 1],
      ['--max-rows-per-file', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE + 1],
      ['--max-total-rows', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS + 1],
      ['--max-total-bytes', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES + 1],
      ['--max-bytes-per-file', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE + 1],
      [
        '--max-join-input-rows',
        BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS + 1,
      ],
      [
        '--max-join-key-values-in-memory',
        BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY + 1,
      ],
      ['--max-join-pairs-emitted', 1],
      ['--max-joined-rows-printed', 1],
    ];
    for (const [flag, value] of overCap) {
      const args = [...argsWithout(flag), flag, String(value)];
      assert.throws(() => parseFullJoinRunnerArgs(args), ForbiddenFullJoinRunnerModeError, flag);
    }
  });

  it('exposes no coverage flag at all', () => {
    for (const flag of [
      '--coverage',
      '--join-coverage',
      '--coverage-percentage',
      '--emit-joined-rows',
      '--emit-join-keys',
    ]) {
      assert.throws(() => parseFullJoinRunnerArgs([...JOIN_ARGS, flag]), Error, flag);
    }
  });

  it('still refuses every import / runtime / provider flag on a join invocation', () => {
    for (const flag of ['--import', '--execute', '--supabase', '--runtime', '--agent1', '--full']) {
      assert.throws(
        () => parseFullJoinRunnerArgs([...JOIN_ARGS, flag]),
        ForbiddenFullJoinRunnerModeError,
        flag,
      );
    }
  });

  it('still refuses an --output path inside the repository on a join invocation', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs([...JOIN_ARGS, '--output', 'scratchpad/join-probe-report.json']),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('leaves the safe synthetic invocations working unchanged', () => {
    const fixture = parseFullJoinRunnerArgs(['--synthetic-fixture', '--format', 'json', '--strict']);
    assert.equal(fixture.runMode, 'synthetic_fixture_only');
    assert.equal(fixture.requiredFamilyJoinProbe, false);
    assert.equal(fixture.realLocalJoinDryRunAuthorized, false);
  });
});

// ─── Static guards ───────────────────────────────────────────────────────────

const require_ = createRequire(import.meta.url);

/** The module's CODE, with comments stripped: these guards are about what it does. */
function probeSource(): string {
  const raw = fs.readFileSync(
    require_.resolve('../br-receita-cnpj-required-family-join-probe'),
    'utf8',
  );
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The module's RAW text, comments included — used for the embedded-path guard. */
function probeRawSource(): string {
  return fs.readFileSync(
    require_.resolve('../br-receita-cnpj-required-family-join-probe'),
    'utf8',
  );
}

describe('BR-SOURCE-11G-IMPL join probe — static guards', () => {
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
        `join probe source must not reference "${forbidden}"`,
      );
    }
  });

  it('computes no hash, no coverage and no identity promotion', () => {
    const source = probeSource();
    for (const forbidden of [
      'createHash',
      'sha256',
      'digest',
      'fingerprint',
      'normalizedTaxId',
      'normalized_tax_id',
      'recordIdentityKey',
      'record_identity_key',
      'coverage_percentage',
      'coverageRatio',
      'percentage',
      '/ total',
    ]) {
      assert.ok(!source.includes(forbidden), `join probe source must not reference "${forbidden}"`);
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
      assert.ok(!source.includes(forbidden), `join probe source must not call "${forbidden}"`);
    }
  });

  it('opens files only through the two bounded readers, and never stats or lists', () => {
    const source = probeSource();
    // Exactly two `openSync` call sites: the manifest control document and one data file.
    assert.equal(source.split('fs.openSync(').length - 1, 2);
    assert.equal(source.split('fs.readSync(').length - 1, 2);
    for (const forbidden of ['statSync', 'readdirSync', 'existsSync', 'globSync', 'realpathSync']) {
      assert.ok(!source.includes(forbidden), `join probe source must not call "${forbidden}"`);
    }
  });

  it('never routes a join key to a log, a template, or a thrown message', () => {
    const source = probeSource();
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
      assert.ok(!source.includes(forbidden), `join probe source must not emit via "${forbidden}"`);
    }
    // Every throw carries a fixed CODE: the only constructor argument is a quoted code literal.
    for (const constructed of source.match(/new BrazilReceitaRequiredFamilyJoinProbeError\([^)]*\)/g) ??
      []) {
      assert.ok(
        /^new BrazilReceitaRequiredFamilyJoinProbeError\(\s*'required_family_join_probe_[a-z_]+',?\s*\)$/.test(
          constructed,
        ),
        `a refusal must carry a fixed code only, got ${constructed}`,
      );
    }
  });

  it('exports no field-reading helper — a join key never leaves the module', () => {
    const source = probeSource();
    assert.ok(source.includes('function readDelimitedFieldAt('));
    assert.ok(
      !source.includes('export function readDelimitedFieldAt('),
      'the field reader must stay module-private',
    );
    // The bounded window is released before the aggregate is assembled.
    assert.ok(source.includes('firstFamilyKeys.clear()'));
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
      assert.ok(!source.includes(forbidden), `join probe source must not embed "${forbidden}"`);
    }
  });

  it('holds the caps and the family/key invariants as constants, not conventions', () => {
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED, 2);
    assert.deepEqual(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES, [
      'empresas',
      'estabelecimentos',
    ]);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE, 64_000);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE, 20);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS, 40);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES, 128_000);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS, 40);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY, 40);
    // Equalities, not ceilings.
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED, 0);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED, 0);
    // One field position per row, shared by both required families.
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX, 0);
  });
});
