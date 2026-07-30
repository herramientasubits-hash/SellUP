/**
 * BR Receita CNPJ real-manifest metadata-only EXECUTION — tests (BR-SOURCE-11E).
 *
 * BR-SOURCE-11D-META-IMPL built the metadata-only reader but kept an operator's prepared
 * manifest refused by staging-directory segment and by basename, so the carve-out was only
 * ever exercised against documents the test suite wrote itself. BR-SOURCE-11E adds one
 * separate declaration that relaxes exactly those two path checks.
 *
 * These tests hold the line on what "exactly those two" means:
 *   - the declaration relaxes the staging-segment list and the prepared-basename list;
 *   - it relaxes NOTHING else: a URL, a non-`.json` document, an empty path, a missing or
 *     oversized cap, and a raw-manifest request stay refused on the new flag as well;
 *   - it does NOT satisfy the metadata-only authorization — both are required, and neither
 *     substitutes for the other;
 *   - a waived read still opens exactly ONE descriptor, still stats and lists nothing, and
 *     still does not touch a declared file that EXISTS on disk beside the manifest;
 *   - the runner refuses a reader that relaxed its path checks on a run that never declared
 *     the execution authorization, and reports no metadata block for it;
 *   - a waived run reports zero rows, zero eligibility and zero join figures, holds all
 *     eight gates at `not_approved`, and passes output sanitization unchanged.
 *
 * 100% synthetic. Every manifest here is written by this suite into a temp workspace it
 * creates and removes; the staging-shaped directory names are LOCAL fixtures named after
 * the denylist entries so the waiver can be measured. No real Receita manifest, no real
 * data file, no operator directory, no dataset, no Supabase, no network, no runtime.
 *
 * Every identifier-shaped token is assembled by CONCATENATION, so no 8-/11-/14-digit
 * literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_BASENAMES,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_PATH_SEGMENTS,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES,
  BrazilReceitaRealManifestMetadataError,
  createBrazilReceitaRealManifestMetadataReader,
} from '../br-receita-cnpj-real-manifest-metadata-reader';
import {
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunInput,
  type BrazilReceitaFullJoinRealManifestMetadataScan,
} from '../br-receita-cnpj-full-join-dry-run-runner';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  ForbiddenFullJoinRunnerModeError,
  parseFullJoinRunnerArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run';

// ─── Synthetic workspace (written and removed by this suite) ───────────────────

const WORKSPACE_PREFIX = 'br-source-11e-metadata-execution-test-';

const createdWorkspaces: string[] = [];

/**
 * Writes a synthetic manifest into a fresh temp workspace, optionally under a
 * staging-SHAPED subdirectory and under a prepared-SHAPED basename, so the waiver can be
 * measured against the very shapes the denylists refuse. Everything here is created by
 * this suite inside the OS temp root.
 */
function writeManifest(
  document: unknown,
  options: { readonly segment?: string; readonly fileName?: string } = {},
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  createdWorkspaces.push(root);
  const directory = options.segment === undefined ? root : path.join(root, options.segment);
  if (directory !== root) fs.mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, options.fileName ?? 'synthetic-metadata-manifest.json');
  const body = typeof document === 'string' ? document : `${JSON.stringify(document, null, 2)}\n`;
  fs.writeFileSync(manifestPath, body, { encoding: 'utf8' });
  return manifestPath;
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
};

const FULL_FAMILIES = ['empresas', 'estabelecimentos', 'cnaes', 'municipios', 'naturezas'];

function manifestDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    layoutMode: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE,
    files: FULL_FAMILIES.map((family) => ({
      fileType: family,
      path: SYNTHETIC_FILE_LABELS[family] ?? `synthetic-${family}.csv`,
      delimiter: ';',
      encoding: 'utf8',
    })),
    ...overrides,
  };
}

const CAPS = {
  maxManifestBytes: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
} as const;

/** A reader carrying BOTH declarations: metadata-only, plus the 11E execution waiver. */
function executionReaderFor(
  manifestPath: string,
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createBrazilReceitaRealManifestMetadataReader> {
  return createBrazilReceitaRealManifestMetadataReader({
    manifestPath,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    ...CAPS,
    ...overrides,
  });
}

/** Asserts a thrown reader error carries the expected fixed code and nothing else. */
function assertReaderCode(fn: () => unknown, code: string): void {
  try {
    fn();
    assert.fail(`expected ${code}`);
  } catch (err) {
    assert.ok(err instanceof BrazilReceitaRealManifestMetadataError, 'expected a reader error');
    assert.equal(err.code, code);
  }
}

// ─── Instrumented filesystem: the second-file invariant, MEASURED ─────────────

interface FsCallLog {
  readonly opened: string[];
  readonly statted: string[];
  readonly listed: string[];
  readonly readWhole: string[];
  restore: () => void;
}

/**
 * The MUTABLE `node:fs` module object. An `import * as fs` namespace exposes getter-only
 * properties, so instrumentation has to go through the module record the reader's own
 * import resolves to — the same object, patchable.
 */
const mutableFs = createRequire(__filename)('node:fs') as typeof fs;

function instrumentFs(): FsCallLog {
  const opened: string[] = [];
  const statted: string[] = [];
  const listed: string[] = [];
  const readWhole: string[] = [];

  const original = {
    openSync: mutableFs.openSync,
    statSync: mutableFs.statSync,
    lstatSync: mutableFs.lstatSync,
    existsSync: mutableFs.existsSync,
    readdirSync: mutableFs.readdirSync,
    readFileSync: mutableFs.readFileSync,
    createReadStream: mutableFs.createReadStream,
  };

  const patch = (name: keyof typeof original, bucket: string[]): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mutableFs as any)[name] = function (this: unknown, target: unknown, ...rest: unknown[]) {
      bucket.push(String(target));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original[name] as any).call(mutableFs, target, ...rest);
    };
  };

  patch('openSync', opened);
  patch('statSync', statted);
  patch('lstatSync', statted);
  patch('existsSync', statted);
  patch('readdirSync', listed);
  patch('readFileSync', readWhole);
  patch('createReadStream', readWhole);

  return {
    opened,
    statted,
    listed,
    readWhole,
    restore: () => {
      for (const name of Object.keys(original) as Array<keyof typeof original>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mutableFs as any)[name] = original[name];
      }
    },
  };
}

// ─── What the waiver relaxes ──────────────────────────────────────────────────

describe('BR-SOURCE-11E reader — the execution declaration relaxes two path checks', () => {
  it('accepts a manifest under each staging-directory segment the denylist names', () => {
    for (const segment of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_PATH_SEGMENTS) {
      // Construction validates the path only — no descriptor is opened here.
      assert.doesNotThrow(
        () => executionReaderFor(path.join('synthetic-root', segment, 'manifest.json')),
        `the waiver must accept a "${segment}" segment`,
      );
    }
  });

  it('accepts each prepared manifest basename the denylist names', () => {
    for (const basename of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_BASENAMES) {
      assert.doesNotThrow(
        () => executionReaderFor(path.join('synthetic-root', basename)),
        `the waiver must accept the "${basename}" basename`,
      );
    }
  });

  it('leaves both refusals in force when the declaration is absent', () => {
    const withoutWaiver = (candidate: string): void => {
      assertReaderCode(
        () =>
          createBrazilReceitaRealManifestMetadataReader({
            manifestPath: candidate,
            realManifestMetadataOnlyOptionBAuthorized: true,
            ...CAPS,
          }),
        'manifest_path_forbidden',
      );
    };
    for (const segment of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_PATH_SEGMENTS) {
      withoutWaiver(path.join('synthetic-root', segment, 'manifest.json'));
    }
    for (const basename of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_BASENAMES) {
      withoutWaiver(path.join('synthetic-root', basename));
    }
  });

  it('treats an explicitly false declaration exactly like an absent one', () => {
    assertReaderCode(
      () =>
        createBrazilReceitaRealManifestMetadataReader({
          manifestPath: path.join('synthetic-root', 'manifest.real.json'),
          realManifestMetadataOnlyOptionBAuthorized: true,
          realManifestMetadataOnlyExecutionAuthorized: false,
          ...CAPS,
        }),
      'manifest_path_forbidden',
    );
  });
});

// ─── What the waiver does NOT relax ───────────────────────────────────────────

describe('BR-SOURCE-11E reader — the execution declaration relaxes nothing else', () => {
  it('still refuses a URL', () => {
    for (const candidate of [
      'https://example.invalid/manifest.json',
      'file:///manifest.json',
      '//example.invalid/manifest.json',
    ]) {
      assertReaderCode(() => executionReaderFor(candidate), 'manifest_path_forbidden');
    }
  });

  it('still refuses a non-.json document, including a prepared-looking one', () => {
    for (const candidate of ['manifest.csv', 'manifest.txt', 'manifest.zip', 'manifest']) {
      assertReaderCode(() => executionReaderFor(candidate), 'manifest_path_forbidden');
    }
  });

  it('still refuses an empty or non-string path', () => {
    for (const candidate of ['', '   ', undefined, null, 42]) {
      assertReaderCode(() => executionReaderFor(candidate as never), 'manifest_path_forbidden');
    }
  });

  it('does not substitute for the metadata-only authorization', () => {
    assertReaderCode(
      () =>
        createBrazilReceitaRealManifestMetadataReader({
          manifestPath: path.join('synthetic-root', 'manifest.real.json'),
          realManifestMetadataOnlyExecutionAuthorized: true,
          ...CAPS,
        }),
      'manifest_metadata_not_authorized',
    );
  });

  it('still requires both caps, and still refuses one above its ceiling', () => {
    const candidate = path.join('synthetic-root', 'manifest.real.json');
    assertReaderCode(
      () => executionReaderFor(candidate, { maxManifestBytes: undefined }),
      'manifest_metadata_cap_required',
    );
    assertReaderCode(
      () => executionReaderFor(candidate, { maxDeclaredFiles: undefined }),
      'manifest_metadata_cap_required',
    );
    assertReaderCode(
      () =>
        executionReaderFor(candidate, {
          maxManifestBytes: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES + 1,
        }),
      'manifest_metadata_cap_exceeded',
    );
    assertReaderCode(
      () =>
        executionReaderFor(candidate, {
          maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES + 1,
        }),
      'manifest_metadata_cap_exceeded',
    );
  });

  it('still refuses a request for raw manifest output', () => {
    assertReaderCode(
      () =>
        executionReaderFor(path.join('synthetic-root', 'manifest.real.json'), {
          includeRawManifest: true,
        }),
      'manifest_raw_output_forbidden',
    );
  });
});

// ─── A waived read: still exactly one descriptor ──────────────────────────────

describe('BR-SOURCE-11E reader — a waived read stays metadata-only', () => {
  it('parses a staging-shaped, prepared-named manifest into aggregate metadata', () => {
    const manifestPath = writeManifest(manifestDocument(), {
      segment: 'sellup-source-data',
      fileName: 'manifest.headerless.json',
    });
    const scan = executionReaderFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.manifestTrust, 'real_manifest_metadata_only');
    assert.equal(scan.layoutMode, BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE);
    assert.equal(scan.operatorPreparedManifestAuthorized, true);
    assert.equal(scan.declaredFileCount, FULL_FAMILIES.length);
    assert.equal(scan.missingRequiredFamilyCount, 0);
    assert.equal(scan.forbiddenFamilyCount, 0);
    assert.equal(scan.manifestBytesReadBucket, 'lte_1mb');
    assert.equal(scan.referencedDataFilesOpened, false);
    assert.equal(scan.referencedDataFilesStatted, false);
  });

  it('reports the waiver as false when it was not declared', () => {
    const manifestPath = writeManifest(manifestDocument());
    const scan = createBrazilReceitaRealManifestMetadataReader({
      manifestPath,
      realManifestMetadataOnlyOptionBAuthorized: true,
      ...CAPS,
    })(CAPS);
    assert.equal(scan.operatorPreparedManifestAuthorized, false);
    assert.equal(scan.refusalCode, null);
  });

  it('emits no path, no filename and no declared period value', () => {
    const manifestPath = writeManifest(manifestDocument(), {
      segment: 'downloads',
      fileName: 'manifest.headerless.json',
    });
    const serialized = JSON.stringify(executionReaderFor(manifestPath)(CAPS));

    assert.ok(!serialized.includes(manifestPath), 'the scan must not carry the manifest path');
    assert.ok(!serialized.includes(os.tmpdir()), 'the scan must not carry a filesystem root');
    assert.ok(!serialized.includes('manifest.headerless'), 'no manifest filename');
    assert.ok(!serialized.includes('sellup-source-data'), 'no staging directory name');
    assert.ok(!serialized.includes('2026-07'), 'no declared period value');
    for (const label of Object.values(SYNTHETIC_FILE_LABELS)) {
      assert.ok(!serialized.includes(label), 'no declared filename');
    }
  });

  it('opens ONE descriptor and touches no declared file that exists beside it', () => {
    const manifestPath = writeManifest(manifestDocument(), {
      segment: 'extracted',
      fileName: 'manifest.real.json',
    });
    // Materialize the referenced files so "it did not open them" is an observation rather
    // than an artefact of their absence. Contents are opaque synthetic labels.
    const directory = path.dirname(manifestPath);
    const referenced: string[] = [];
    for (const label of Object.values(SYNTHETIC_FILE_LABELS)) {
      const filePath = path.join(directory, label);
      fs.writeFileSync(filePath, 'SYN_CELL_A;SYN_CELL_B\n', { encoding: 'utf8' });
      referenced.push(filePath);
    }
    // Build the reader BEFORE instrumenting, so eager path validation is not counted.
    const read = executionReaderFor(manifestPath);

    const log = instrumentFs();
    try {
      const scan = read(CAPS);
      assert.equal(scan.refusalCode, null);
      assert.equal(scan.operatorPreparedManifestAuthorized, true);
    } finally {
      log.restore();
    }

    assert.deepEqual(log.opened, [manifestPath], 'exactly ONE descriptor, on the manifest');
    assert.deepEqual(log.statted, [], 'no stat / lstat / existsSync of any path');
    assert.deepEqual(log.listed, [], 'no directory listing');
    assert.deepEqual(log.readWhole, [], 'no whole-file read and no read stream');
    const touched = [...log.opened, ...log.statted, ...log.listed, ...log.readWhole];
    for (const filePath of referenced) {
      assert.ok(!touched.includes(filePath), 'no referenced data file may be touched');
    }
  });

  it('still refuses a forbidden family on a waived read, as an aggregate count', () => {
    const manifestPath = writeManifest(
      manifestDocument({
        files: [
          ...FULL_FAMILIES.map((family) => ({ fileType: family, delimiter: ';' })),
          { fileType: 'socios', delimiter: ';' },
        ],
      }),
      { segment: 'downloads', fileName: 'manifest.headerless.json' },
    );
    const scan = executionReaderFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, 'manifest_forbidden_family_detected');
    assert.equal(scan.forbiddenFamilyCount, 1);
    assert.ok(!Object.keys(scan.declaredFamilyCounts).includes('socios'), 'never keyed by label');
    assert.equal(scan.operatorPreparedManifestAuthorized, true);
  });

  it('carries the waiver through an over-limit refusal', () => {
    const manifestPath = writeManifest(manifestDocument(), {
      segment: 'raw-zips',
      fileName: 'manifest.real.json',
    });
    const scan = executionReaderFor(manifestPath, { maxManifestBytes: 8 })({
      maxManifestBytes: 8,
      maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
    });

    assert.equal(scan.refusalCode, 'manifest_metadata_cap_exceeded');
    assert.equal(scan.manifestBytesReadBucket, 'over_limit_blocked');
    assert.equal(scan.declaredFileCount, 0);
    assert.equal(scan.operatorPreparedManifestAuthorized, true);
  });
});

// ─── The runner: two declarations that have to agree ──────────────────────────

const SAFE_INPUT: BrazilReceitaFullJoinDryRunInput = {
  noWriteMode: true,
  runtimeIntegration: false,
  agent1Integration: false,
  supabaseWrite: false,
  providerCalls: false,
  importExecuted: false,
};

function scanClaiming(
  operatorPreparedManifestAuthorized: boolean,
): BrazilReceitaFullJoinRealManifestMetadataScan {
  return {
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
    layoutMode: 'official_headerless',
    schemaVersionPresent: true,
    sourcePeriodPresent: true,
    declaredFileCount: 5,
    declaredFamilyCounts: {
      empresas: 1,
      estabelecimentos: 1,
      simples: 0,
      cnaes: 1,
      municipios: 1,
      naturezas: 1,
      other: 0,
    },
    requiredFamilyCount: 2,
    missingRequiredFamilyCount: 0,
    forbiddenFamilyCount: 0,
    manifestBytesReadBucket: 'lte_1mb',
    operatorPreparedManifestAuthorized,
    referencedDataFilesOpened: false,
    referencedDataFilesStatted: false,
    refusalCode: null,
  };
}

function executionInput(overrides: Record<string, unknown> = {}): BrazilReceitaFullJoinDryRunInput {
  const merged: Record<string, unknown> = {
    ...SAFE_INPUT,
    mode: 'local_manifest_dry_run',
    allowLocalManifest: true,
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    strict: true,
    productionWrites: false,
    outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
    maxManifestBytes: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
    maxDeclaredFiles: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
    realManifestMetadataReader: () => scanClaiming(true),
    ...overrides,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
  }
  return merged as unknown as BrazilReceitaFullJoinDryRunInput;
}

describe('BR-SOURCE-11E runner — the declarations must agree', () => {
  it('refuses a reader that spent the waiver on a run that never declared it', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      executionInput({ realManifestMetadataOnlyExecutionAuthorized: undefined }),
    );

    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'real_manifest_metadata_execution_not_authorized',
        stage: 'real_manifest_metadata_read',
      },
    ]);
    // An unauthorized scan carries NO reportable metadata, not a partial block.
    assert.equal(report.manifest_metadata, null);
    assert.equal(report.real_manifest_metadata_only_execution_authorized, false);
    for (const [key, value] of Object.entries(report.aggregate_counts)) {
      assert.equal(value, 0, `aggregate_counts.${key} must be zero`);
    }
    assert.equal(report.cleanup.cleanup_required, true);
  });

  it('refuses it on an explicitly false declaration too', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      executionInput({ realManifestMetadataOnlyExecutionAuthorized: false }),
    );
    assert.equal(report.ok, false);
    assert.equal(
      report.errors[0]?.error_code,
      'real_manifest_metadata_execution_not_authorized',
    );
  });

  it('accepts a waived scan when the run declared the authorization', () => {
    const report = runBrazilReceitaFullJoinDryRun(executionInput());

    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.equal(report.manifest_trust, 'real_manifest_metadata_only');
    assert.equal(report.real_manifest_metadata_only_option_b_authorized, true);
    assert.equal(report.real_manifest_metadata_only_execution_authorized, true);
    // The synthetic temp-manifest carve-out was NOT declared, and is not implied.
    assert.equal(report.option_b_carveout_authorized, false);
    assert.equal(report.manifest_metadata?.operator_prepared_manifest_authorized, true);
  });

  it('reports a declared-but-unspent waiver honestly on both fields', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      executionInput({ realManifestMetadataReader: () => scanClaiming(false) }),
    );

    assert.equal(report.ok, true);
    // Declared by the run…
    assert.equal(report.real_manifest_metadata_only_execution_authorized, true);
    // …but not spent by the reader. The metadata block reports what actually happened.
    assert.equal(report.manifest_metadata?.operator_prepared_manifest_authorized, false);
  });

  it('does not satisfy the metadata-only gate', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      executionInput({ realManifestMetadataOnlyOptionBAuthorized: undefined }),
    );
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      {
        error_code: 'real_manifest_metadata_only_not_authorized',
        stage: 'real_manifest_metadata_gate',
      },
    ]);
    assert.equal(report.manifest_metadata, null);
  });

  it('does not relax the caps, strict mode, or the sanitization declaration', () => {
    for (const [overrides, code] of [
      [{ maxManifestBytes: undefined }, 'real_manifest_metadata_caps_required'],
      [{ maxDeclaredFiles: undefined }, 'real_manifest_metadata_caps_required'],
      [
        { maxManifestBytes: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES + 1 },
        'real_manifest_metadata_cap_exceeded',
      ],
      [{ strict: undefined }, 'strict_mode_required'],
      [{ allowLocalManifest: undefined }, 'allow_local_manifest_required'],
      [{ realManifestMetadataReader: undefined }, 'real_manifest_metadata_reader_required'],
    ] as ReadonlyArray<[Record<string, unknown>, string]>) {
      const report = runBrazilReceitaFullJoinDryRun(executionInput(overrides));
      assert.equal(report.ok, false);
      assert.equal(report.errors[0]?.error_code, code);
    }
  });

  it('buys nothing on the synthetic temp-manifest path', () => {
    // Declaring the 11E waiver does not authorize the Option B carve-out it is not for.
    const report = runBrazilReceitaFullJoinDryRun(
      executionInput({
        manifestTrust: BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
        realManifestMetadataReader: undefined,
      }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'option_b_carveout_not_authorized');
    assert.equal(report.manifest_metadata, null);
  });

  it('is absent from every non-metadata report', () => {
    const report = runBrazilReceitaFullJoinDryRun({ ...SAFE_INPUT, strict: true });
    assert.equal(report.real_manifest_metadata_only_execution_authorized, false);
    assert.equal(report.manifest_metadata, null);
  });
});

// ─── A waived run reports nothing about the dataset ───────────────────────────

describe('BR-SOURCE-11E runner — a waived run is still evidence about nothing', () => {
  it('holds every gate at not_approved and every scope/safety flag at false', () => {
    const report = runBrazilReceitaFullJoinDryRun(executionInput());
    const gates = Object.values(report.decision_status);
    assert.equal(gates.length, 8);
    for (const gate of gates) assert.equal(gate, 'not_approved');
    for (const [key, value] of Object.entries(report.run_scope)) {
      assert.equal(value, false, `run_scope.${key} must be false`);
    }
    for (const [key, value] of Object.entries(report.safety)) {
      assert.equal(value, false, `safety.${key} must be false`);
    }
  });

  it('reports zero rows, zero eligibility and zero join figures', () => {
    const report = runBrazilReceitaFullJoinDryRun(executionInput());
    for (const counts of [
      report.aggregate_counts,
      report.eligibility_counts,
      report.join_counts,
    ]) {
      for (const [key, value] of Object.entries(counts)) {
        assert.equal(value, 0, `${key} must be zero on a metadata-only run`);
      }
    }
    assert.equal(report.source_period, null);
  });

  it('passes output sanitization with the new fields present', () => {
    const report = runBrazilReceitaFullJoinDryRun(executionInput());
    const sanitized = sanitizeBrazilReceitaFullJoinReport(report);
    assert.equal(sanitized.ok, true);
    assert.deepEqual(sanitized.findings, []);

    const serialized = JSON.stringify(report);
    assert.ok(serialized.includes('real_manifest_metadata_only_execution_authorized'));
    assert.ok(serialized.includes('operator_prepared_manifest_authorized'));
  });

  it('trips no dangerous-indicator guard by declaring the waiver', () => {
    const report = runBrazilReceitaFullJoinDryRun(executionInput());
    assert.equal(report.guardrail_counts.no_write_guard_violations, 0);
    assert.equal(report.guardrail_counts.forbidden_output_findings, 0);
  });
});

// ─── CLI argument surface ─────────────────────────────────────────────────────

/** The metadata-only caps every 11D-META / 11E CLI invocation must state. */
const CLI_METADATA_CAPS = [
  '--max-manifest-bytes',
  '1000000',
  '--max-declared-files',
  '20',
];

/** A relative, synthetic probe path shaped like an operator's prepared location. */
const PREPARED_PROBE = path.join('synthetic-root', 'Downloads', 'sellup-source-data', 'manifest.headerless.json');

function metadataArgv(extra: readonly string[] = [], manifest = PREPARED_PROBE): string[] {
  return [
    '--manifest',
    manifest,
    '--allow-local-manifest',
    '--real-manifest-metadata-only',
    ...extra,
    '--format',
    'json',
    '--strict',
    ...CLI_METADATA_CAPS,
  ];
}

describe('BR-SOURCE-11E CLI — the execution declaration', () => {
  it('accepts an operator-prepared manifest path only with the declaration', () => {
    const options = parseFullJoinRunnerArgs(metadataArgv(['--real-manifest-metadata-execution']));
    assert.equal(options.realManifestMetadataOnly, true);
    assert.equal(options.realManifestMetadataExecution, true);
    assert.equal(options.runMode, 'local_manifest_dry_run');
    assert.equal(options.allowLocalManifest, true);
    assert.equal(options.strict, true);
    assert.equal(options.maxManifestBytes, 1_000_000);
    assert.equal(options.maxDeclaredFiles, 20);
  });

  it('still refuses the same path without the declaration', () => {
    assert.throws(() => parseFullJoinRunnerArgs(metadataArgv()), ForbiddenFullJoinRunnerModeError);
  });

  it('defaults the declaration to false on every other accepted invocation', () => {
    const fixture = parseFullJoinRunnerArgs(['--synthetic-fixture', '--format', 'json', '--strict']);
    assert.equal(fixture.realManifestMetadataExecution, false);
  });

  it('refuses the declaration without --real-manifest-metadata-only', () => {
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([
          '--synthetic-fixture',
          '--real-manifest-metadata-execution',
          '--format',
          'json',
          '--strict',
        ]),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('does not relax the URL or non-.json refusals', () => {
    for (const candidate of ['https://example.test/manifest.json', 'manifest.csv', 'manifest']) {
      assert.throws(
        () => parseFullJoinRunnerArgs(metadataArgv(['--real-manifest-metadata-execution'], candidate)),
        ForbiddenFullJoinRunnerModeError,
      );
    }
  });

  it('does not relax --strict or either metadata cap', () => {
    const base = [
      '--manifest',
      PREPARED_PROBE,
      '--allow-local-manifest',
      '--real-manifest-metadata-only',
      '--real-manifest-metadata-execution',
      '--format',
      'json',
    ];
    assert.throws(
      () => parseFullJoinRunnerArgs([...base, ...CLI_METADATA_CAPS]),
      ForbiddenFullJoinRunnerModeError,
    );
    assert.throws(
      () => parseFullJoinRunnerArgs([...base, '--strict', '--max-manifest-bytes', '1000000']),
      ForbiddenFullJoinRunnerModeError,
    );
    assert.throws(
      () => parseFullJoinRunnerArgs([...base, '--strict', '--max-declared-files', '20']),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('does not relax the --output refusals', () => {
    for (const output of [
      path.join('synthetic-root', 'Downloads', 'report.json'),
      path.join('synthetic-root', 'extracted', 'report.json'),
    ]) {
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            ...metadataArgv(['--real-manifest-metadata-execution']),
            '--output',
            output,
          ]),
        ForbiddenFullJoinRunnerModeError,
      );
    }
  });

  it('never echoes the refused path', () => {
    const marker = 'SYNTHETIC' + '_OPERATOR_DIR';
    try {
      parseFullJoinRunnerArgs(
        metadataArgv([], path.join(marker, 'Downloads', 'manifest.headerless.json')),
      );
      assert.fail('expected a refusal');
    } catch (err) {
      assert.ok(err instanceof ForbiddenFullJoinRunnerModeError);
      assert.ok(!err.message.includes(marker), 'the refused path must never be echoed');
    }
  });

  it('leaves every forbidden ingestion flag refused under the declaration', () => {
    for (const forbidden of ['--import', '--execute', '--download', '--supabase', '--full']) {
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            ...metadataArgv(['--real-manifest-metadata-execution']),
            forbidden,
          ]),
        ForbiddenFullJoinRunnerModeError,
      );
    }
  });
});
