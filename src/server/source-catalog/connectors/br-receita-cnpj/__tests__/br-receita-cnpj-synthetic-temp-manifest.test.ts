/**
 * BR Receita CNPJ SYNTHETIC TEMP MANIFEST workspace — tests (BR-SOURCE-11C Option B).
 *
 * Proves the workspace generator is the narrow carve-out the milestone authorized:
 *   - it GENERATES its workspace under the OS temp root and never accepts a path;
 *   - every generated file is headerless and matches the OFFICIAL positional layout;
 *   - the bounded read ceiling is enforced, and an oversized file fails closed;
 *   - a SOCIOS / QSA / CPF family request fails closed BEFORE anything is written;
 *   - the scan it returns carries no path, no filename, no line, and no cell;
 *   - no generated cell contains a CNPJ, a CNPJ básico, a CPF, an email, a phone, a
 *     LinkedIn URL, or any identifier-length digit run;
 *   - cleanup removes the workspace it created and REFUSES every other path.
 *
 * 100% synthetic. No dataset, no real manifest, no Supabase, no network, no runtime.
 * Every identifier-shaped token is assembled by CONCATENATION so no 8-/11-/14-digit
 * literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DIR_PREFIX,
  BrazilReceitaSyntheticTempManifestForbiddenFamilyError,
  BrazilReceitaSyntheticTempManifestUnsafeCleanupError,
  createBrazilReceitaSyntheticTempManifest,
  isBrazilReceitaSyntheticTempWorkspace,
  removeBrazilReceitaSyntheticTempWorkspace,
} from '../br-receita-cnpj-synthetic-temp-manifest';
import {
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_COMPANY_SCAN_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_ESTABLISHMENT_ROWS,
} from '../br-receita-cnpj-full-join-dry-run-runner';
import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';

// ─── Shared read request ──────────────────────────────────────────────────────

const READ_REQUEST = {
  maxBytesPerFile: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
  maxCompanyRows: 20,
  maxEstablishmentRows: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_ESTABLISHMENT_ROWS,
  maxCompanyScanRows: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_COMPANY_SCAN_ROWS,
} as const;

/** Runs a body against a fresh workspace and always disposes it. */
function withWorkspace<T>(
  options: Parameters<typeof createBrazilReceitaSyntheticTempManifest>[0],
  body: (handle: ReturnType<typeof createBrazilReceitaSyntheticTempManifest>) => T,
): T {
  const handle = createBrazilReceitaSyntheticTempManifest(options);
  try {
    return body(handle);
  } finally {
    handle.dispose();
  }
}

// ─── Generation ───────────────────────────────────────────────────────────────

describe('BR-SOURCE-11C synthetic temp manifest — generation', () => {
  it('declares synthetic-temp trust and the official headerless layout', () => {
    withWorkspace(undefined, (handle) => {
      assert.equal(handle.manifestTrust, 'synthetic_temp_manifest_only');
      assert.equal(handle.declaredLayoutMode, 'official_headerless');
    });
  });

  it('generates the five default families', () => {
    withWorkspace(undefined, (handle) => {
      assert.deepEqual(
        [...handle.familiesDeclared].sort(),
        ['cnaes', 'empresas', 'estabelecimentos', 'municipios', 'naturezas'],
      );
    });
  });

  it('produces a scan whose fixture exercises every join outcome', () => {
    withWorkspace(undefined, (handle) => {
      const scan = handle.read(READ_REQUEST);
      assert.equal(scan.manifestTrust, 'synthetic_temp_manifest_only');
      assert.equal(scan.layoutMode, 'official_headerless');
      assert.equal(scan.bytesCapExceeded, false);
      assert.equal(scan.bytesCapApplied, true);
      assert.equal(scan.fixture.companies.length, 4);
      assert.equal(scan.fixture.establishments.length, 7);
      const eligibilities = scan.fixture.companies.map((row) => row.eligibility).sort();
      assert.deepEqual(eligibilities, [
        'eligible_for_future_import',
        'excluded_legal_nature',
        'excluded_privacy_signal',
        'needs_legal_review',
      ]);
      // A null ref (no company context) and a privacy-signalled row are both present.
      assert.ok(scan.fixture.establishments.some((row) => row.companyRef === null));
      assert.ok(scan.fixture.establishments.some((row) => row.privacySignal));
    });
  });

  it('bounds the derived rows by the requested caps', () => {
    withWorkspace(undefined, (handle) => {
      const scan = handle.read({ ...READ_REQUEST, maxCompanyScanRows: 2, maxEstablishmentRows: 3 });
      assert.equal(scan.fixture.companies.length, 2);
      assert.equal(scan.fixture.establishments.length, 3);
    });
  });

  it('refuses a non-integer or negative cap', () => {
    withWorkspace(undefined, (handle) => {
      assert.throws(() => handle.read({ ...READ_REQUEST, maxBytesPerFile: -1 }));
      assert.throws(() => handle.read({ ...READ_REQUEST, maxBytesPerFile: 1.5 }));
    });
  });
});

// ─── Layout authority ─────────────────────────────────────────────────────────

describe('BR-SOURCE-11C synthetic temp manifest — layout authority', () => {
  it('writes HEADERLESS files whose first line matches the official column count', () => {
    // The generator's own read layout-validates every first line via the file reader's
    // official positional counts; a width drift would throw here.
    withWorkspace(undefined, (handle) => {
      assert.doesNotThrow(() => handle.read(READ_REQUEST));
    });
  });

  it('keeps the official widths it validates against non-trivial', () => {
    assert.equal(BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas, 7);
    assert.equal(BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.estabelecimentos, 30);
  });

  it('carries a mis-declared layout mode through so the runner can refuse it', () => {
    withWorkspace({ declaredLayoutMode: 'header' }, (handle) => {
      assert.equal(handle.read(READ_REQUEST).layoutMode, 'header');
    });
  });

  it('carries a mis-declared trust level through so the runner can refuse it', () => {
    withWorkspace({ declaredManifestTrust: 'real_manifest_not_authorized' }, (handle) => {
      assert.equal(handle.read(READ_REQUEST).manifestTrust, 'real_manifest_not_authorized');
    });
  });
});

// ─── Forbidden families ───────────────────────────────────────────────────────

describe('BR-SOURCE-11C synthetic temp manifest — forbidden families', () => {
  const forbidden = ['socios', 'socio', 'qsa', 'cpf' + '_holders', 'representante'];

  for (const family of forbidden) {
    it(`refuses a "${family}" family before writing anything`, () => {
      assert.throws(
        () => createBrazilReceitaSyntheticTempManifest({ families: [family] }),
        BrazilReceitaSyntheticTempManifestForbiddenFamilyError,
      );
    });
  }

  it('refuses an unrecognized family (no official layout exists for it)', () => {
    assert.throws(() =>
      createBrazilReceitaSyntheticTempManifest({ families: ['not_a_receita_family'] }),
    );
  });

  it('leaves no workspace behind when a family request is refused', () => {
    const before = countWorkspaces();
    assert.throws(() => createBrazilReceitaSyntheticTempManifest({ families: ['socios'] }));
    assert.equal(countWorkspaces(), before);
  });
});

/** Counts this module's workspaces currently present under the OS temp root. */
function countWorkspaces(): number {
  return listWorkspaces().length;
}

// ─── Bounded reading ──────────────────────────────────────────────────────────

describe('BR-SOURCE-11C synthetic temp manifest — bounded reading', () => {
  it('flags bytesCapExceeded when a generated file is larger than the ceiling', () => {
    withWorkspace(undefined, (handle) => {
      const scan = handle.read({ ...READ_REQUEST, maxBytesPerFile: 4 });
      assert.equal(scan.bytesCapExceeded, true);
      // A cap breach never yields partially-scored structure.
      assert.equal(scan.filesScanned, 0);
    });
  });

  it('reports the ceiling as applied on every read', () => {
    withWorkspace(undefined, (handle) => {
      assert.equal(handle.read(READ_REQUEST).bytesCapApplied, true);
    });
  });
});

// ─── Scan output safety ───────────────────────────────────────────────────────

const FORBIDDEN_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['cnpj_completo', /(?<!\d)\d{14}(?!\d)/],
  ['cnpj_formatted', /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/],
  ['cpf', /(?<!\d)\d{11}(?!\d)/],
  ['cnpj_basico', /(?<!\d)\d{8}(?!\d)/],
  ['long_digit_run', /(?<!\d)\d{8,}(?!\d)/],
  ['email', new RegExp(`[A-Za-z0-9._%+-]+${String.fromCharCode(64)}[A-Za-z0-9.-]+\\.[A-Za-z]{2,}`)],
  ['phone', /\+\d[\d\s().-]{7,}/],
  ['linkedin', /linkedin\./i],
];

describe('BR-SOURCE-11C synthetic temp manifest — scan output safety', () => {
  it('returns no path, no filename, and no absolute location', () => {
    withWorkspace(undefined, (handle) => {
      const serialized = JSON.stringify(handle.read(READ_REQUEST));
      assert.ok(!serialized.includes(os.tmpdir()), 'the workspace path must never be returned');
      assert.ok(!/\.csv/i.test(serialized), 'a generated filename must never be returned');
      assert.ok(!/\.json/i.test(serialized), 'the manifest filename must never be returned');
      assert.ok(!serialized.includes('/'), 'no path separator may appear anywhere in a scan');
    });
  });

  it('returns no forbidden identifier pattern', () => {
    withWorkspace(undefined, (handle) => {
      const serialized = JSON.stringify(handle.read(READ_REQUEST));
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        assert.ok(!pattern.test(serialized), `scan must not contain a ${label} pattern`);
      }
    });
  });

  it('generates only opaque, non-numeric refs', () => {
    withWorkspace(undefined, (handle) => {
      const scan = handle.read(READ_REQUEST);
      for (const row of scan.fixture.companies) {
        assert.ok(/^SYN_[A-Z_]+$/.test(row.companyRef), 'a company ref must stay opaque');
      }
    });
  });

  it('never writes an identifier-shaped cell into the generated files', () => {
    // Reads the generated files directly — the only place in these tests that looks at
    // the workspace content — to prove the SOURCE data is synthetic, not just the scan.
    const existing = listWorkspaces();
    const handle = createBrazilReceitaSyntheticTempManifest();
    try {
      const directory = newWorkspaceSince(existing);
      for (const entry of fs.readdirSync(directory)) {
        const content = fs.readFileSync(path.join(directory, entry), 'utf8');
        for (const [label, pattern] of FORBIDDEN_PATTERNS) {
          assert.ok(!pattern.test(content), `${entry} must not contain a ${label} pattern`);
        }
      }
    } finally {
      handle.dispose();
    }
  });
});

/** Every workspace of this module currently present under the OS temp root. */
function listWorkspaces(): string[] {
  return fs
    .readdirSync(os.tmpdir())
    .filter((entry) => entry.startsWith(BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DIR_PREFIX))
    .map((entry) => path.join(os.tmpdir(), entry));
}

/**
 * Locates the workspace created since `before`, WITHOUT the handle exposing it: the
 * directory is deliberately private, so a test that needs it has to diff the temp root.
 * That the lookup has to work this way is the point.
 */
function newWorkspaceSince(before: readonly string[]): string {
  const created = listWorkspaces().filter((entry) => !before.includes(entry));
  assert.equal(created.length, 1, 'exactly one new workspace must have been created');
  return created[0]!;
}

// ─── Cleanup containment ──────────────────────────────────────────────────────

describe('BR-SOURCE-11C synthetic temp manifest — cleanup containment', () => {
  it('removes the workspace it created', () => {
    const existing = listWorkspaces();
    const handle = createBrazilReceitaSyntheticTempManifest();
    const directory = newWorkspaceSince(existing);
    assert.ok(fs.existsSync(directory));
    const result = handle.dispose();
    assert.equal(result.workspaceRemoved, true);
    assert.ok(result.filesReleased > 0);
    assert.equal(fs.existsSync(directory), false);
  });

  it('is idempotent — a second dispose is a no-op, not an error', () => {
    const handle = createBrazilReceitaSyntheticTempManifest();
    handle.dispose();
    const again = handle.dispose();
    assert.equal(again.workspaceRemoved, false);
    assert.equal(again.filesReleased, 0);
  });

  it('refuses to remove an arbitrary path', () => {
    const arbitrary = [
      path.resolve(__dirname),
      path.resolve(__dirname, '..'),
      os.tmpdir(),
      path.join(os.tmpdir(), 'some-unrelated-directory'),
      path.join(os.homedir(), 'Documents'),
      '/',
    ];
    for (const candidate of arbitrary) {
      assert.equal(
        isBrazilReceitaSyntheticTempWorkspace(candidate),
        false,
        'an arbitrary path must never look like a workspace',
      );
      assert.throws(
        () => removeBrazilReceitaSyntheticTempWorkspace(candidate),
        BrazilReceitaSyntheticTempManifestUnsafeCleanupError,
      );
    }
  });

  it('refuses a prefixed directory that is NOT directly under the temp root', () => {
    const nested = path.join(
      os.tmpdir(),
      'unrelated-parent',
      `${BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DIR_PREFIX}spoofed`,
    );
    assert.equal(isBrazilReceitaSyntheticTempWorkspace(nested), false);
    assert.throws(
      () => removeBrazilReceitaSyntheticTempWorkspace(nested),
      BrazilReceitaSyntheticTempManifestUnsafeCleanupError,
    );
  });

  it('never leaves a workspace behind after a normal run', () => {
    const before = countWorkspaces();
    withWorkspace(undefined, (handle) => handle.read(READ_REQUEST));
    assert.equal(countWorkspaces(), before);
  });
});

// ─── Static guards ────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '..', 'br-receita-cnpj-synthetic-temp-manifest.ts');

/** Strips comments so the guards assert on CODE, not on prose describing refusals. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('BR-SOURCE-11C synthetic temp manifest — static guards', () => {
  it('roots every path it touches in the OS temp directory', () => {
    const source = codeOf(fs.readFileSync(MODULE_PATH, 'utf8'));
    assert.ok(source.includes('os.tmpdir()'), 'the workspace root must be the OS temp directory');
    assert.ok(source.includes('mkdtempSync'), 'the workspace must be created by the module itself');
  });

  it('embeds no operator path and no real dataset location', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(!/\/Users\//.test(source));
    assert.ok(!/\/home\/[a-z]/.test(source));
    assert.ok(!/manifest\.headerless\.json/.test(source));
    assert.ok(!/sellup-source-data|raw-zips|manifest-input/i.test(source));
    assert.ok(!/Downloads/.test(source));
  });

  it('imports no Supabase, Agent 1, provider, HubSpot or Slack module', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');
    for (const line of source.split('\n')) {
      if (!/^\s*import\b/.test(line) && !/\brequire\s*\(/.test(line)) continue;
      assert.ok(!/supabase/i.test(line), 'must not import Supabase');
      assert.ok(!/agent1|agents\/|hubspot|slack|apollo|lusha|tavily/i.test(line));
      assert.ok(!/node:https?|node:net|node:dns/.test(line), 'must not import a network module');
    }
  });

  it('performs no database write, no env read, and no network call', () => {
    const source = codeOf(fs.readFileSync(MODULE_PATH, 'utf8'));
    assert.ok(!/source_company_snapshots/.test(source));
    assert.ok(!/\.insert\(|\.upsert\(|\.delete\(/.test(source));
    assert.ok(!/createSupabaseAdminClient|createClient\(/.test(source));
    assert.ok(!/process\.env/.test(source));
    assert.ok(!/\bfetch\(|https?:\/\//.test(source));
  });

  it('deletes only through the contained removal helper', () => {
    const source = codeOf(fs.readFileSync(MODULE_PATH, 'utf8'));
    const removals = source.match(/fs\.rmSync|fs\.rmdirSync|fs\.unlinkSync/g) ?? [];
    assert.equal(removals.length, 1, 'exactly ONE deletion site may exist');
    assert.ok(/force: false/.test(source), 'deletion must never be forced');
  });
});
