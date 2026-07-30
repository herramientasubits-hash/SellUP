/**
 * BR Receita CNPJ real-manifest METADATA-ONLY reader — tests (BR-SOURCE-11D-META-IMPL).
 *
 * Proves the reader is the metadata-only carve-out the milestone claims:
 *   - a well-formed SYNTHETIC metadata manifest parses to aggregate metadata only;
 *   - it opens exactly ONE file — the manifest — and no file the manifest references;
 *   - it never stats, lists, or resolves a second path (asserted by INSTRUMENTING
 *     `node:fs`, so the claim is measured rather than reviewed);
 *   - it returns no path, no filename, no declared period value, and no raw document;
 *   - `official_headerless` is required, and any other layout mode is refused;
 *   - a forbidden Sócios / QSA / CPF family is refused as an aggregate count;
 *   - a missing `empresas` or `estabelecimentos` family is refused;
 *   - both caps are REQUIRED, and each one is refused when exceeded;
 *   - the carve-out authorization is required, and raw-manifest output is refused;
 *   - a URL path, a non-`.json` path, a dataset-staging path, and a real prepared
 *     manifest basename are all refused before a descriptor exists;
 *   - invalid JSON is refused without echoing the path, the document, or a raw stack.
 *
 * 100% synthetic. Every manifest here is written by this suite into a temp workspace it
 * creates and removes. No real Receita manifest, no real data file, no operator
 * directory, no Downloads path, no dataset, no Supabase, no network, no runtime.
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
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ERROR_CODES,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_TRUST,
  BrazilReceitaRealManifestMetadataError,
  createBrazilReceitaRealManifestMetadataReader,
} from '../br-receita-cnpj-real-manifest-metadata-reader';

// ─── Synthetic manifest workspace (written and removed by this suite) ─────────

const WORKSPACE_PREFIX = 'br-source-11d-meta-impl-metadata-reader-test-';

const createdWorkspaces: string[] = [];

/**
 * Writes a synthetic metadata manifest into a fresh temp workspace and returns its
 * path. Deliberately NOT named like a real prepared file set: the real basenames stay
 * refused, so the code path is proven with a synthetic document instead.
 */
function writeSyntheticManifest(
  document: unknown,
  fileName = 'synthetic-metadata-manifest.json',
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  createdWorkspaces.push(directory);
  const manifestPath = path.join(directory, fileName);
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

function manifestDocument(
  families: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    layoutMode: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE,
    files: families.map((family) => ({
      fileType: family,
      path: SYNTHETIC_FILE_LABELS[family] ?? `synthetic-${family}.csv`,
      delimiter: ';',
      encoding: 'utf8',
    })),
    ...overrides,
  };
}

const FULL_FAMILIES = ['empresas', 'estabelecimentos', 'cnaes', 'municipios', 'naturezas'];

const CAPS = {
  maxManifestBytes: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
} as const;

function readerFor(
  manifestPath: string,
  overrides: Record<string, unknown> = {},
): ReturnType<typeof createBrazilReceitaRealManifestMetadataReader> {
  return createBrazilReceitaRealManifestMetadataReader({
    manifestPath,
    realManifestMetadataOnlyOptionBAuthorized: true,
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
 * properties, so instrumentation has to go through the module record that the reader's
 * own import resolves to — the same object, patchable.
 */
const mutableFs = createRequire(__filename)('node:fs') as typeof fs;

/**
 * Wraps every `node:fs` entry point a reader could use to touch a second file, so the
 * "resolves exactly one path" invariant is asserted from OBSERVED calls rather than from
 * reading the source. The wrappers delegate to the real implementations.
 */
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

  /** Replaces one entry point with a recording wrapper that delegates to the original. */
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

// ─── An authorized metadata-only read ─────────────────────────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — an authorized metadata-only read', () => {
  it('parses a well-formed synthetic manifest into aggregate metadata', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.manifestTrust, BRAZIL_RECEITA_REAL_MANIFEST_METADATA_TRUST);
    assert.equal(scan.layoutMode, BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE);
    assert.equal(scan.refusalCode, null);
    assert.equal(scan.declaredFileCount, FULL_FAMILIES.length);
    assert.equal(scan.requiredFamilyCount, 2);
    assert.equal(scan.missingRequiredFamilyCount, 0);
    assert.equal(scan.forbiddenFamilyCount, 0);
    assert.equal(scan.schemaVersionPresent, true);
    assert.equal(scan.sourcePeriodPresent, true);
    assert.equal(scan.manifestBytesReadBucket, 'lte_1mb');
    assert.equal(scan.referencedDataFilesOpened, false);
    assert.equal(scan.referencedDataFilesStatted, false);
  });

  it('counts declared families under allowlisted keys only', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.declaredFamilyCounts.empresas, 1);
    assert.equal(scan.declaredFamilyCounts.estabelecimentos, 1);
    assert.equal(scan.declaredFamilyCounts.cnaes, 1);
    assert.equal(scan.declaredFamilyCounts.other, 0);
    for (const key of Object.keys(scan.declaredFamilyCounts)) {
      assert.ok(
        ['empresas', 'estabelecimentos', 'simples', 'cnaes', 'municipios', 'naturezas', 'other'].includes(
          key,
        ),
        `unexpected family key ${key}`,
      );
    }
  });

  it('buckets an unrecognized family label under "other" without naming it', () => {
    const manifestPath = writeSyntheticManifest(
      manifestDocument(['empresas', 'estabelecimentos', 'synthetic_unknown_family']),
    );
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.declaredFamilyCounts.other, 1);
    assert.ok(!Object.keys(scan.declaredFamilyCounts).includes('synthetic_unknown_family'));
  });

  it('emits no path, no filename, no declared period value and no raw document', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    const scan = readerFor(manifestPath)(CAPS);
    const serialized = JSON.stringify(scan);

    assert.ok(!serialized.includes(manifestPath), 'the manifest path must never be returned');
    assert.ok(!serialized.includes(path.basename(manifestPath)), 'no manifest basename');
    for (const label of Object.values(SYNTHETIC_FILE_LABELS)) {
      assert.ok(!serialized.includes(label), `declared filename ${label} must not be returned`);
    }
    assert.ok(!serialized.includes('2026-07'), 'the declared period VALUE must not be returned');
    assert.ok(!serialized.includes(os.tmpdir()), 'no temp root');
    assert.ok(!/\/Users\//.test(serialized) && !/\/home\//.test(serialized), 'no absolute path');
    assert.ok(!serialized.includes('sourceKey'), 'no raw manifest document');
    assert.ok(!serialized.includes('files'), 'no raw declared-file array');
  });
});

// ─── The second-file invariant, measured against instrumented fs ──────────────

describe('BR-SOURCE-11D-META-IMPL reader — opens exactly one file', () => {
  it('opens the manifest and nothing else, and never stats or lists', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    // Build the reader BEFORE instrumenting, so eager path validation is not counted.
    const read = readerFor(manifestPath);

    const log = instrumentFs();
    try {
      const scan = read(CAPS);
      assert.equal(scan.refusalCode, null);
    } finally {
      log.restore();
    }

    assert.deepEqual(log.opened, [manifestPath], 'exactly ONE descriptor, on the manifest');
    assert.deepEqual(log.statted, [], 'no stat / lstat / existsSync of any path');
    assert.deepEqual(log.listed, [], 'no directory listing');
    assert.deepEqual(log.readWhole, [], 'no whole-file read and no read stream');
  });

  it('does not open a declared data file even when one exists on disk beside it', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    // Materialize the referenced files so "it did not open them" is a real observation
    // rather than an artefact of their absence. Contents are opaque synthetic labels.
    const directory = path.dirname(manifestPath);
    const referenced: string[] = [];
    for (const label of Object.values(SYNTHETIC_FILE_LABELS)) {
      const filePath = path.join(directory, label);
      fs.writeFileSync(filePath, 'SYN_CELL_A;SYN_CELL_B\n', { encoding: 'utf8' });
      referenced.push(filePath);
    }
    const read = readerFor(manifestPath);

    const log = instrumentFs();
    try {
      read(CAPS);
    } finally {
      log.restore();
    }

    const touched = [...log.opened, ...log.statted, ...log.listed, ...log.readWhole];
    for (const filePath of referenced) {
      assert.ok(!touched.includes(filePath), 'no referenced data file may be touched');
    }
    assert.deepEqual(log.opened, [manifestPath]);
  });
});

// ─── Content refusals: reported as aggregates, not thrown ─────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — content refusals', () => {
  it('refuses a forbidden Socios/QSA/CPF family as an aggregate count', () => {
    for (const forbidden of ['socios', 'qsa', 'cpf', 'representante', 'partner_shareholders']) {
      const manifestPath = writeSyntheticManifest(
        manifestDocument(['empresas', 'estabelecimentos', forbidden]),
      );
      const scan = readerFor(manifestPath)(CAPS);

      assert.equal(scan.refusalCode, 'manifest_forbidden_family_detected', forbidden);
      assert.equal(scan.forbiddenFamilyCount, 1, forbidden);
      // Reported as a COUNT, never as a label.
      assert.ok(!Object.keys(scan.declaredFamilyCounts).includes(forbidden));
      assert.ok(!JSON.stringify(scan).includes(forbidden));
    }
  });

  it('refuses a manifest missing empresas', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(['estabelecimentos', 'cnaes']));
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, 'manifest_missing_required_family');
    assert.equal(scan.missingRequiredFamilyCount, 1);
    assert.equal(scan.requiredFamilyCount, 1);
  });

  it('refuses a manifest missing estabelecimentos', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(['empresas', 'cnaes']));
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, 'manifest_missing_required_family');
    assert.equal(scan.missingRequiredFamilyCount, 1);
  });

  it('refuses a manifest declaring no file at all', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument([]));
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, 'manifest_missing_required_family');
    assert.equal(scan.missingRequiredFamilyCount, 2);
    assert.equal(scan.declaredFileCount, 0);
  });

  it('requires the official headerless layout mode', () => {
    const manifestPath = writeSyntheticManifest(
      manifestDocument(['empresas', 'estabelecimentos'], { layoutMode: 'header' }),
    );
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.layoutMode, 'invalid_or_unsupported');
    assert.equal(scan.refusalCode, 'manifest_layout_unsupported');
  });

  it('classifies an absent layout mode as unknown and refuses it', () => {
    const document = manifestDocument(['empresas', 'estabelecimentos']);
    delete document.layoutMode;
    const manifestPath = writeSyntheticManifest(document);
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.layoutMode, 'unknown');
    assert.equal(scan.refusalCode, 'manifest_layout_unsupported');
  });

  it('reports a forbidden family ahead of a missing required family', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(['cnaes', 'socios']));
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, 'manifest_forbidden_family_detected');
    assert.equal(scan.forbiddenFamilyCount, 1);
    assert.equal(scan.missingRequiredFamilyCount, 2);
  });
});

// ─── Caps ─────────────────────────────────────────────────────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — caps are required and enforced', () => {
  it('refuses a missing maxManifestBytes', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    assertReaderCode(
      () =>
        createBrazilReceitaRealManifestMetadataReader({
          manifestPath,
          realManifestMetadataOnlyOptionBAuthorized: true,
          maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
        }),
      'manifest_metadata_cap_required',
    );
  });

  it('refuses a missing maxDeclaredFiles', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    assertReaderCode(
      () =>
        createBrazilReceitaRealManifestMetadataReader({
          manifestPath,
          realManifestMetadataOnlyOptionBAuthorized: true,
          maxManifestBytes: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES,
        }),
      'manifest_metadata_cap_required',
    );
  });

  it('refuses a maxManifestBytes above its ceiling', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    assertReaderCode(
      () =>
        readerFor(manifestPath, {
          maxManifestBytes: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES + 1,
        }),
      'manifest_metadata_cap_exceeded',
    );
  });

  it('refuses a maxDeclaredFiles above its ceiling', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    assertReaderCode(
      () =>
        readerFor(manifestPath, {
          maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES + 1,
        }),
      'manifest_metadata_cap_exceeded',
    );
  });

  it('refuses a read request that tries to widen the caps it was built with', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    const read = readerFor(manifestPath, { maxManifestBytes: 4_096, maxDeclaredFiles: 5 });

    assertReaderCode(() => read({ maxManifestBytes: 8_192, maxDeclaredFiles: 5 }), 'manifest_metadata_cap_exceeded');
    assertReaderCode(() => read({ maxManifestBytes: 4_096, maxDeclaredFiles: 9 }), 'manifest_metadata_cap_exceeded');
  });

  it('refuses a manifest larger than the byte ceiling instead of parsing it truncated', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    // A ceiling far below the document: the read stops, and no partial parse happens.
    const scan = readerFor(manifestPath, { maxManifestBytes: 16 })({
      maxManifestBytes: 16,
      maxDeclaredFiles: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES,
    });

    assert.equal(scan.manifestBytesReadBucket, 'over_limit_blocked');
    assert.equal(scan.refusalCode, 'manifest_metadata_cap_exceeded');
    assert.equal(scan.declaredFileCount, 0);
    assert.equal(scan.layoutMode, 'unknown');
    // No partial metadata survives the refusal.
    assert.equal(scan.requiredFamilyCount, 0);
    assert.equal(scan.forbiddenFamilyCount, 0);
  });

  it('refuses a manifest declaring more files than the parse cap allows', () => {
    const families = ['empresas', 'estabelecimentos', 'cnaes', 'municipios', 'naturezas', 'simples'];
    const manifestPath = writeSyntheticManifest(manifestDocument(families));
    const read = readerFor(manifestPath, { maxDeclaredFiles: 3 });

    assertReaderCode(
      () =>
        read({
          maxManifestBytes: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES,
          maxDeclaredFiles: 3,
        }),
      'manifest_metadata_cap_exceeded',
    );
  });
});

// ─── Authorization and raw-output refusals ────────────────────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — authorization', () => {
  it('refuses construction without the metadata-only authorization', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    for (const authorized of [undefined, false, 'yes', 1]) {
      assertReaderCode(
        () =>
          createBrazilReceitaRealManifestMetadataReader({
            manifestPath,
            ...CAPS,
            realManifestMetadataOnlyOptionBAuthorized: authorized as never,
          }),
        'manifest_metadata_not_authorized',
      );
    }
  });

  it('refuses a request for raw manifest output', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    assertReaderCode(
      () => readerFor(manifestPath, { includeRawManifest: true }),
      'manifest_raw_output_forbidden',
    );
  });

  it('opens no descriptor at all when the contract is refused', () => {
    const manifestPath = writeSyntheticManifest(manifestDocument(FULL_FAMILIES));
    const log = instrumentFs();
    try {
      assert.throws(() =>
        createBrazilReceitaRealManifestMetadataReader({ manifestPath, ...CAPS }),
      );
    } finally {
      log.restore();
    }
    assert.deepEqual(log.opened, [], 'an unauthorized request never reaches the filesystem');
    assert.deepEqual(log.statted, []);
  });
});

// ─── Path refusals ────────────────────────────────────────────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — path refusals', () => {
  it('refuses a URL', () => {
    for (const candidate of [
      'https://example.invalid/manifest.json',
      'file:///manifest.json',
      '//example.invalid/manifest.json',
    ]) {
      assertReaderCode(() => readerFor(candidate), 'manifest_path_forbidden');
    }
  });

  it('refuses a non-.json path', () => {
    for (const candidate of ['manifest.csv', 'manifest.txt', 'manifest.zip', 'manifest']) {
      assertReaderCode(() => readerFor(candidate), 'manifest_path_forbidden');
    }
  });

  it('refuses a path inside an operator dataset staging directory', () => {
    // Relative denylist probes only. No real, absolute, or complete operator path here.
    for (const segment of [
      'downloads',
      'descargas',
      'dados_abertos',
      'sellup-source-data',
      'raw-zips',
      'extracted',
      'manifest-input',
    ]) {
      assertReaderCode(
        () => readerFor(path.join('synthetic-root', segment, 'manifest.json')),
        'manifest_path_forbidden',
      );
    }
  });

  it('refuses a real prepared manifest basename whatever directory it sits in', () => {
    for (const basename of ['manifest.headerless.json', 'manifest.real.json']) {
      assertReaderCode(
        () => readerFor(path.join('synthetic-root', basename)),
        'manifest_path_forbidden',
      );
    }
  });

  it('refuses an empty or non-string path', () => {
    for (const candidate of ['', '   ', undefined, null, 42]) {
      assertReaderCode(() => readerFor(candidate as never), 'manifest_path_forbidden');
    }
  });
});

// ─── Malformed documents ──────────────────────────────────────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — malformed documents', () => {
  it('refuses invalid JSON without echoing the path, the document or a stack', () => {
    const manifestPath = writeSyntheticManifest('{ "sourceKey": "br_receita', 'broken.json');
    try {
      readerFor(manifestPath)(CAPS);
      assert.fail('expected manifest_json_invalid');
    } catch (err) {
      assert.ok(err instanceof BrazilReceitaRealManifestMetadataError);
      assert.equal(err.code, 'manifest_json_invalid');
      assert.ok(!err.message.includes(manifestPath), 'the message must not carry the path');
      assert.ok(!err.message.includes('sourceKey'), 'the message must not quote the document');
      assert.ok(!err.message.includes(os.tmpdir()));
      assert.equal(err.message, 'BRSOURCE11DMETA_REAL_MANIFEST_METADATA: manifest_json_invalid');
    }
  });

  it('refuses a JSON document that is not an object', () => {
    for (const body of ['[]', '"a string"', '42', 'null']) {
      const manifestPath = writeSyntheticManifest(body, 'not-an-object.json');
      assertReaderCode(() => readerFor(manifestPath)(CAPS), 'manifest_json_invalid');
    }
  });

  it('refuses a manifest with no declared-files array', () => {
    const document = manifestDocument(['empresas', 'estabelecimentos']);
    delete document.files;
    const manifestPath = writeSyntheticManifest(document);
    assertReaderCode(() => readerFor(manifestPath)(CAPS), 'manifest_json_invalid');
  });

  it('tolerates a malformed entry by counting it under "other", never by naming it', () => {
    const manifestPath = writeSyntheticManifest({
      ...manifestDocument(['empresas', 'estabelecimentos']),
      files: [
        { fileType: 'empresas', path: SYNTHETIC_FILE_LABELS.empresas },
        { fileType: 'estabelecimentos', path: SYNTHETIC_FILE_LABELS.estabelecimentos },
        { path: 'synthetic-no-file-type.csv' },
        'not-an-object',
      ],
    });
    const scan = readerFor(manifestPath)(CAPS);

    assert.equal(scan.refusalCode, null);
    assert.equal(scan.declaredFileCount, 4);
    assert.equal(scan.declaredFamilyCounts.other, 2);
    assert.ok(!JSON.stringify(scan).includes('synthetic-no-file-type.csv'));
  });
});

// ─── Error-code surface ───────────────────────────────────────────────────────

describe('BR-SOURCE-11D-META-IMPL reader — error-code surface', () => {
  it('exposes exactly the nine documented codes', () => {
    assert.deepEqual([...BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ERROR_CODES].sort(), [
      'manifest_forbidden_family_detected',
      'manifest_json_invalid',
      'manifest_layout_unsupported',
      'manifest_metadata_cap_exceeded',
      'manifest_metadata_cap_required',
      'manifest_metadata_not_authorized',
      'manifest_missing_required_family',
      'manifest_path_forbidden',
      'manifest_raw_output_forbidden',
    ]);
  });

  it('caps match the decision record', () => {
    assert.equal(BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES, 1_000_000);
    assert.equal(BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES, 20);
  });
});

// ─── Static guards over the metadata reader source ────────────────────────────

const CONNECTOR_DIR = path.resolve(__dirname, '..');
const READER_SOURCE = path.join(CONNECTOR_DIR, 'br-receita-cnpj-real-manifest-metadata-reader.ts');

/** Strips comments so the guards assert on CODE, not on prose describing refusals. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importLinesOf(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /\brequire\s*\(/.test(line));
}

describe('BR-SOURCE-11D-META-IMPL reader — static guards', () => {
  it('imports no Supabase, Agent 1, provider, HubSpot or Slack module', () => {
    for (const line of importLinesOf(fs.readFileSync(READER_SOURCE, 'utf8'))) {
      assert.ok(!/supabase/i.test(line), 'must not import Supabase');
      assert.ok(
        !/agent1|agents\/|hubspot|slack|apollo|lusha|tavily/i.test(line),
        'must not import a runtime/provider module',
      );
      assert.ok(!/node:https?|node:net|\bfetch\b/.test(line), 'must not import a network module');
    }
  });

  it('contains no snapshot write, no credential use and no client construction', () => {
    const source = codeOf(fs.readFileSync(READER_SOURCE, 'utf8'));
    assert.ok(!/source_company_snapshots/.test(source), 'snapshot table');
    assert.ok(!/\.insert\(|\.upsert\(|\.delete\(/.test(source), 'db write');
    assert.ok(!/createSupabaseAdminClient|createClient\(/.test(source), 'client');
    assert.ok(!/process\.env/.test(source), 'env read');
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY\b/.test(source), 'env name');
  });

  it('embeds no real operator path, dataset path or real manifest name', () => {
    const source = codeOf(fs.readFileSync(READER_SOURCE, 'utf8'));
    assert.ok(!/\/Users\//.test(source), 'absolute user path');
    assert.ok(!/\/home\/[a-z]/.test(source), 'absolute home path');
    // A denylist ENTRY (a bare segment) is legitimate — that is how the reader refuses
    // one. A real PATH literal (a segment between separators) is not.
    const realPathShape =
      /['"`][^'"`]*\/(?:downloads|descargas|dados[_-]abertos|sellup[_-]source[_-]data|raw[_-]zips|extracted|manifest[_-]input)\//i;
    assert.ok(!realPathShape.test(source), 'embedded real dataset path');
    const opensRealManifest = /(?:readFileSync|openSync|createReadStream)\([^)]*headerless/i;
    assert.ok(!opensRealManifest.test(source), 'opens a real prepared manifest');
  });

  it('resolves exactly ONE path: one openSync, on the captured manifest path', () => {
    const source = codeOf(fs.readFileSync(READER_SOURCE, 'utf8'));
    const opens = source.match(/openSync\s*\(/g) ?? [];
    assert.equal(opens.length, 1, 'exactly one open call may exist');
    assert.ok(
      /fs\.openSync\(\s*manifestPath\s*,/.test(source),
      'the one open must target the captured manifest path',
    );
  });

  it('never stats, lists, globs or whole-file-reads anything', () => {
    const source = codeOf(fs.readFileSync(READER_SOURCE, 'utf8'));
    for (const forbidden of [
      'statSync',
      'lstatSync',
      'existsSync',
      'realpathSync',
      'readdirSync',
      'opendirSync',
      'globSync',
      'readFileSync',
      'createReadStream',
      'writeFileSync',
      'mkdirSync',
      'rmSync',
      'unlinkSync',
    ]) {
      assert.ok(!source.includes(forbidden), `the reader must not use ${forbidden}`);
    }
  });

  it('never joins or resolves a declared entry path into a filesystem call', () => {
    const source = codeOf(fs.readFileSync(READER_SOURCE, 'utf8'));
    // The reader reads only the `fileType` LABEL of a declared entry. It must never
    // build a path from one, which is what keeps the second-file case unreachable.
    assert.ok(!/path\.join\(/.test(source), 'no path join — there is no second path to build');
    assert.ok(!/path\.resolve\(/.test(source), 'no path resolve');
    assert.ok(!/entry\.path|\.files\[[^\]]*\]\.path/.test(source), 'no declared entry path use');
  });
});
