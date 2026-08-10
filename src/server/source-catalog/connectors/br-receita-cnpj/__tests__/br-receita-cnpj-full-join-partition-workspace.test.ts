/**
 * BR Receita CNPJ BOUNDED PARTITION WORKSPACE — tests
 * (BR-SOURCE-14B.0D § 6, § 7; § 14 tests 12–14, 19, 20, 47–54, 56).
 *
 * Two claims are defended here, and they are not the same claim.
 *
 *   1. A PARTITION FILE CONTAINS NO DATASET CONTENT. Not "we do not put keys in it" — the bytes on
 *      disk are read back and searched for the fixture's own key markers and filler. A test that only
 *      checked the decoder would prove the decoder consistent with the encoder and nothing about what
 *      is on the disk.
 *   2. THE WORKSPACE IS CONTAINED AND ITS DELETION IS VERIFIED. Outside the repository, outside home,
 *      outside the dataset, not reached through a symlink, owner-only, capped, and gone afterwards —
 *      with `unverified` kept distinct from `failed`, because those are different facts.
 *
 * The workspace under test writes to a real directory under the OS temp root and removes it. Failure
 * paths use an injected port, so a failing chmod, an unverifiable mode and a failing unlink are
 * producible without breaking a real filesystem.
 *
 * No repository path, no operator home, no dataset, no real manifest, no Supabase, no network, no git.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createBrazilReceitaFullJoinWorkspaceFileSystem } from '../br-receita-cnpj-full-join-engine-fs';
import type { BrazilReceitaFullJoinFreeDiskProbe } from '../br-receita-cnpj-full-join-free-disk';
import {
  createBrazilReceitaFullJoinOpenHandleLedger,
  type BrazilReceitaFullJoinOpenHandleLedger,
} from '../br-receita-cnpj-full-join-open-handle-ledger';
import {
  BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN,
  BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED,
  BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_MODE,
  BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE,
  brazilReceitaFullJoinPartitionFileName,
  createBrazilReceitaFullJoinPartitionWorkspace,
  decodeBrazilReceitaFullJoinRowReference,
  encodeBrazilReceitaFullJoinRowReference,
  validateBrazilReceitaFullJoinWorkspaceParent,
  type BrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinWorkspaceBoundaries,
  type BrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-partition-workspace';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEY_MARKER = 'SYN_K0001';
const FILLER_MARKER = 'SYN_PAD';

let temporaryDirectories: string[] = [];

function temporaryParent(prefix = 'brfj-test-parent-'): string {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.reverse()) {
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories = [];
});

/** Boundaries that are all far away from the OS temp root, so a clean parent stays clean. */
function boundaries(
  overrides: Partial<BrazilReceitaFullJoinWorkspaceBoundaries> = {},
): BrazilReceitaFullJoinWorkspaceBoundaries {
  return {
    repositoryRoot: '/workspaces/sellup-worktrees/br-14b0d',
    homeDirectory: '/home/operator',
    datasetRoot: '/home/operator/receita',
    ...overrides,
  };
}

function reference(
  overrides: Partial<BrazilReceitaFullJoinRowReference> = {},
): BrazilReceitaFullJoinRowReference {
  return { sourceFileOrdinal: 0, byteOffset: 128, byteLength: 57, family: 'empresas', ...overrides };
}

function openWorkspace(
  options: {
    parent?: string;
    maxTemporaryStorageBytes?: number;
    fileSystem?: BrazilReceitaFullJoinWorkspaceFileSystem;
    realDataRun?: boolean;
    boundaryOverrides?: Partial<BrazilReceitaFullJoinWorkspaceBoundaries>;
    maxOpenPartitionFiles?: number;
    openHandleLedger?: BrazilReceitaFullJoinOpenHandleLedger;
    minimumFreeDiskBeforeStart?: number;
    minimumFreeDiskReserve?: number;
    freeDiskProbe?: BrazilReceitaFullJoinFreeDiskProbe;
  } = {},
) {
  return createBrazilReceitaFullJoinPartitionWorkspace({
    parentDirectory: options.parent ?? temporaryParent(),
    boundaries: boundaries(options.boundaryOverrides),
    fileSystem: options.fileSystem ?? createBrazilReceitaFullJoinWorkspaceFileSystem(),
    maxTemporaryStorageBytes: options.maxTemporaryStorageBytes ?? 64 * 1024,
    maxOpenPartitionFiles: options.maxOpenPartitionFiles ?? 32,
    openHandleLedger: options.openHandleLedger ?? createBrazilReceitaFullJoinOpenHandleLedger(64),
    minimumFreeDiskBeforeStart: options.minimumFreeDiskBeforeStart ?? 1024 * 1024,
    minimumFreeDiskReserve: options.minimumFreeDiskReserve ?? 1024 * 1024,
    freeDiskProbe: options.freeDiskProbe ?? (() => 64 * 1024 * 1024 * 1024),
    realDataRun: options.realDataRun ?? false,
  });
}

/** Finds the workspace directory the module created inside a parent. */
function workspaceDirectoryIn(parent: string): string {
  const entries = fs.readdirSync(parent).filter((name) => name.startsWith('brfj-refs-'));
  assert.equal(entries.length, 1, 'exactly one workspace directory must exist');
  return path.join(parent, entries[0]!);
}

// ─── 1. Reference record codec (tests 12–14) ──────────────────────────────────

describe('BR-SOURCE-14B.0D — reference record', () => {
  it('is a fixed-width record of four technical integers', () => {
    const encoded = encodeBrazilReceitaFullJoinRowReference(reference());
    assert.equal(encoded.ok, true);
    if (!encoded.ok) return;
    assert.equal(encoded.record.length, BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES);
  });

  it('round-trips every field', () => {
    for (const family of ['empresas', 'estabelecimentos'] as const) {
      const original = reference({ family, sourceFileOrdinal: 3, byteOffset: 4096, byteLength: 30 });
      const encoded = encodeBrazilReceitaFullJoinRowReference(original);
      assert.equal(encoded.ok, true);
      if (!encoded.ok) return;
      const decoded = decodeBrazilReceitaFullJoinRowReference(encoded.record, 0);
      assert.equal(decoded.ok, true);
      if (!decoded.ok) return;
      assert.deepEqual(decoded.reference, original);
    }
  });

  it('refuses an out-of-range or unknown value rather than truncating it', () => {
    const cases = [
      [reference({ byteOffset: -1 }), 'offset_out_of_range'],
      [reference({ byteLength: 0 }), 'length_out_of_range'],
      [reference({ sourceFileOrdinal: -1 }), 'ordinal_out_of_range'],
      [reference({ family: 'simples' as unknown as 'empresas' }), 'family_unknown'],
    ] as const;
    for (const [candidate, failure] of cases) {
      const encoded = encodeBrazilReceitaFullJoinRowReference(candidate);
      assert.equal(encoded.ok, false);
      if (encoded.ok) return;
      assert.equal(encoded.failure, failure);
    }
  });

  it('refuses a truncated record on decode', () => {
    const decoded = decodeBrazilReceitaFullJoinRowReference(Buffer.alloc(4), 0);
    assert.equal(decoded.ok, false);
    if (decoded.ok) return;
    assert.equal(decoded.failure, 'record_truncated');
  });

  it('names partition files with technical, sequential names only', () => {
    assert.equal(brazilReceitaFullJoinPartitionFileName('empresas', 0), 'empresas-part-00001.refs');
    assert.equal(
      brazilReceitaFullJoinPartitionFileName('estabelecimentos', 41),
      'estabelecimentos-part-00042.refs',
    );
    assert.equal(brazilReceitaFullJoinPartitionFileName('empresas', -1), null);
    assert.equal(brazilReceitaFullJoinPartitionFileName('simples' as 'empresas', 0), null);
    assert.ok(BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test('empresas-part-00001.refs'));
    assert.ok(!BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test('empresas-SYN_K0001.refs'));
  });
});

// ─── 2. What reaches the disk (tests 12–14) ───────────────────────────────────

describe('BR-SOURCE-14B.0D — partition files hold references, not data', () => {
  it('writes only fixed-width records, and no key or row byte, to the real disk', () => {
    const parent = temporaryParent();
    const creation = openWorkspace({ parent });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    for (let index = 0; index < 5; index += 1) {
      assert.equal(
        creation.workspace.appendReference(reference({ byteOffset: 100 + index * 60 }), index % 2).ok,
        true,
      );
    }

    const directory = workspaceDirectoryIn(parent);
    const names = fs.readdirSync(directory);
    assert.ok(names.length > 0);
    for (const name of names) {
      assert.ok(
        BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test(name),
        `"${name}" must be a technical partition name`,
      );
      const bytes = fs.readFileSync(path.join(directory, name));
      assert.equal(
        bytes.length % BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
        0,
        'a partition file is a whole number of fixed-width records',
      );
      const asText = bytes.toString('latin1');
      // Tests 13 and 14: the key and the row filler must be absent from the bytes themselves.
      assert.ok(!asText.includes(KEY_MARKER), 'no join key may reach a partition file');
      assert.ok(!asText.includes(FILLER_MARKER), 'no raw row content may reach a partition file');
    }
    creation.workspace.dispose();
  });

  it('reads back exactly what it wrote, in bounded slices', () => {
    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const written: BrazilReceitaFullJoinRowReference[] = [];
    for (let index = 0; index < 7; index += 1) {
      const candidate = reference({ byteOffset: 64 * (index + 1), byteLength: 40 + index });
      written.push(candidate);
      assert.equal(creation.workspace.appendReference(candidate, 0).ok, true);
    }
    assert.equal(creation.workspace.referenceCount('empresas', 0), 7);

    const collected: BrazilReceitaFullJoinRowReference[] = [];
    let cursor = 0;
    let exhausted = false;
    while (!exhausted) {
      const slice = creation.workspace.readPartitionSlice('empresas', 0, cursor, 3);
      if (!slice.ok) {
        assert.fail(`reading a slice must not fail: ${slice.failure}`);
        return;
      }
      collected.push(...slice.references);
      cursor = slice.nextRecordIndex;
      exhausted = slice.exhausted;
    }
    assert.deepEqual(collected, written);
    creation.workspace.dispose();
  });

  it('reports an empty partition as exhausted rather than failing', () => {
    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    const slice = creation.workspace.readPartitionSlice('empresas', 3, 0, 16);
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.deepEqual(slice.references, []);
    assert.equal(slice.exhausted, true);
    creation.workspace.dispose();
  });
});

// ─── 3. Storage cap (test 20) ─────────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — temporary storage cap', () => {
  it('refuses the write that would cross the cap, and writes no part of it', () => {
    const parent = temporaryParent();
    const creation = openWorkspace({
      parent,
      maxTemporaryStorageBytes: BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES * 2,
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    assert.equal(creation.workspace.appendReference(reference(), 0).ok, true);
    assert.equal(creation.workspace.appendReference(reference(), 0).ok, true);
    const third = creation.workspace.appendReference(reference(), 0);
    assert.equal(third.ok, false);
    if (third.ok) return;
    assert.equal(third.failure, 'temporary_storage_cap_exceeded');

    const directory = workspaceDirectoryIn(parent);
    const bytes = fs.readFileSync(path.join(directory, 'empresas-part-00001.refs'));
    assert.equal(
      bytes.length,
      BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES * 2,
      'the refused record must leave no partial bytes behind',
    );
    assert.equal(creation.workspace.bytesWritten(), bytes.length);
    creation.workspace.dispose();
  });

  it('refuses a cap that cannot hold one record', () => {
    const creation = openWorkspace({ maxTemporaryStorageBytes: 1 });
    assert.equal(creation.ok, false);
    if (creation.ok) return;
    assert.deepEqual(creation.rejections, ['storage_cap_invalid']);
  });

  it('refuses a REAL run outright, because GATE-2 is not approved', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);
    const parent = temporaryParent();
    const creation = openWorkspace({ parent, realDataRun: true });
    assert.equal(creation.ok, false);
    if (creation.ok) return;
    assert.deepEqual(creation.rejections, ['temporary_storage_policy_not_approved']);
    assert.deepEqual(
      fs.readdirSync(parent),
      [],
      'a refused real run must not have created a workspace',
    );
  });
});

// ─── 4. Destination safety (tests 49–53) ──────────────────────────────────────

describe('BR-SOURCE-14B.0D — workspace destination safety', () => {
  const realFileSystem = createBrazilReceitaFullJoinWorkspaceFileSystem();

  it('accepts a clean parent under the OS temp root', () => {
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      temporaryParent(),
      boundaries(),
      realFileSystem,
    );
    assert.deepEqual(rejections, []);
  });

  // Test 49.
  it('refuses a parent inside the repository', () => {
    const parent = temporaryParent();
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      parent,
      boundaries({ repositoryRoot: parent }),
      realFileSystem,
    );
    assert.ok(rejections.includes('parent_inside_repository'));
  });

  // Test 50: home is refused wholesale, because the operator's $HOME is itself a git repository.
  it('refuses a parent inside the operator home', () => {
    const parent = temporaryParent();
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      parent,
      boundaries({ homeDirectory: parent }),
      realFileSystem,
    );
    assert.ok(rejections.includes('parent_inside_home'));
  });

  // Test 51.
  it('refuses a parent inside the dataset root', () => {
    const parent = temporaryParent();
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      parent,
      boundaries({ datasetRoot: parent }),
      realFileSystem,
    );
    assert.ok(rejections.includes('parent_inside_dataset'));
  });

  // Test 52: a real symlink on a real disk.
  it('refuses a parent that is a symlink', () => {
    const target = temporaryParent();
    const linkHome = temporaryParent();
    const link = path.join(linkHome, 'link-to-target');
    fs.symlinkSync(target, link);
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(link, boundaries(), realFileSystem);
    assert.ok(rejections.includes('parent_is_symlink'));
  });

  it('refuses a parent that resolves somewhere other than where it was declared', () => {
    // A symlinked ANCESTOR: the leaf is not a link, so `isSymbolicLink` passes and only the realpath
    // comparison catches it. That is the case a naive lstat-only check would miss.
    const target = temporaryParent();
    const inner = path.join(target, 'inner');
    fs.mkdirSync(inner);
    const linkHome = temporaryParent();
    const link = path.join(linkHome, 'ancestor-link');
    fs.symlinkSync(target, link);
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      path.join(link, 'inner'),
      boundaries(),
      realFileSystem,
    );
    assert.ok(rejections.includes('parent_realpath_escapes_declared_parent'));
  });

  it('refuses a parent that resolves INTO the dataset even when the declared string looked clean', () => {
    const dataset = temporaryParent();
    const linkHome = temporaryParent();
    const link = path.join(linkHome, 'looks-clean');
    fs.symlinkSync(dataset, link);
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      link,
      boundaries({ datasetRoot: dataset }),
      realFileSystem,
    );
    assert.ok(rejections.includes('parent_inside_dataset'));
  });

  // Test 53.
  it('refuses a traversal segment instead of normalizing it away', () => {
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      '/var/tmp/somewhere/../elsewhere',
      boundaries(),
      realFileSystem,
    );
    assert.deepEqual(rejections, ['parent_path_traversal']);
  });

  it('refuses a relative parent alone, because nothing else can be decided', () => {
    const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
      'relative/path',
      boundaries(),
      realFileSystem,
    );
    assert.deepEqual(rejections, ['parent_not_absolute']);
  });
});

// ─── 5. Permissions (tests 47, 48) ────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — owner-only permissions', () => {
  // Test 47.
  it('creates the workspace directory owner-only and verifies the mode on disk', () => {
    const parent = temporaryParent();
    const creation = openWorkspace({ parent });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    const directory = workspaceDirectoryIn(parent);
    assert.equal(
      fs.lstatSync(directory).mode & 0o777,
      BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_MODE,
    );
    creation.workspace.dispose();
  });

  // Test 48.
  it('creates each partition file owner-only and verifies the mode on disk', () => {
    const parent = temporaryParent();
    const creation = openWorkspace({ parent });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    assert.equal(creation.workspace.appendReference(reference(), 0).ok, true);
    const directory = workspaceDirectoryIn(parent);
    assert.equal(
      fs.lstatSync(path.join(directory, 'empresas-part-00001.refs')).mode & 0o777,
      BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE,
    );
    creation.workspace.dispose();
  });

  it('refuses when the directory mode cannot be verified', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const creation = openWorkspace({
      fileSystem: { ...real, statMode: () => 0o777 },
    });
    assert.equal(creation.ok, false);
    if (creation.ok) return;
    assert.equal(creation.failure, 'workspace_permission_verification_failed');
  });

  it('refuses when hardening the directory mode fails', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const creation = openWorkspace({
      fileSystem: {
        ...real,
        chmod: () => {
          throw new Error('scripted chmod failure');
        },
      },
    });
    assert.equal(creation.ok, false);
    if (creation.ok) return;
    assert.equal(creation.failure, 'workspace_permission_hardening_failed');
  });

  it('refuses when a partition file mode cannot be verified', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    let calls = 0;
    const creation = openWorkspace({
      fileSystem: {
        ...real,
        statMode: (target) => {
          calls += 1;
          // The directory check (first call) passes; the file check does not.
          return calls === 1 ? real.statMode(target) : 0o644;
        },
      },
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    const appended = creation.workspace.appendReference(reference(), 0);
    assert.equal(appended.ok, false);
    if (appended.ok) return;
    assert.equal(appended.failure, 'partition_file_permission_verification_failed');
    creation.workspace.dispose();
  });
});

// ─── 6. Cleanup (tests 54, 56) ────────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — verified cleanup', () => {
  // Test 54.
  it('deletes every file it created, then the directory, and verifies absence', () => {
    const parent = temporaryParent();
    const creation = openWorkspace({ parent });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    creation.workspace.appendReference(reference(), 0);
    creation.workspace.appendReference(reference({ family: 'estabelecimentos' }), 1);
    const directory = workspaceDirectoryIn(parent);

    const result = creation.workspace.dispose();
    assert.equal(result.outcome, 'completed');
    assert.equal(result.filesReleased, 2);
    assert.equal(result.verifiedAbsent, true);
    assert.equal(fs.existsSync(directory), false);
    assert.deepEqual(fs.readdirSync(parent), [], 'nothing of this run may survive in the parent');
  });

  it('reports `not_needed` when it created no reference file', () => {
    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    const result = creation.workspace.dispose();
    assert.equal(result.outcome, 'not_needed');
    assert.equal(result.verifiedAbsent, true);
  });

  it('is idempotent: a second dispose does not claim a second deletion', () => {
    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    creation.workspace.appendReference(reference(), 0);
    assert.equal(creation.workspace.dispose().outcome, 'completed');
    const second = creation.workspace.dispose();
    assert.equal(second.outcome, 'unverified');
    assert.equal(second.filesReleased, 0);
  });

  // Test 56 (workspace half): a failed deletion is `failed`, never `completed`.
  it('reports `failed` when a file cannot be removed', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const creation = openWorkspace({
      fileSystem: {
        ...real,
        removeFile: () => {
          throw new Error('scripted unlink failure');
        },
      },
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    creation.workspace.appendReference(reference(), 0);
    const result = creation.workspace.dispose();
    assert.equal(result.outcome, 'failed');
    assert.equal(result.verifiedAbsent, false);
  });

  it('reports `unverified` — not `failed` — when the workspace cannot be inspected', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const creation = openWorkspace({
      fileSystem: {
        ...real,
        listNames: () => {
          throw new Error('scripted readdir failure');
        },
      },
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    const result = creation.workspace.dispose();
    assert.equal(result.outcome, 'unverified', 'nobody can say what is left, which is not a failure');
    assert.equal(result.verifiedAbsent, false);
  });

  it('reports `unverified` when the directory still exists after removal', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const creation = openWorkspace({
      fileSystem: { ...real, removeDirectory: () => undefined, exists: () => true },
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    creation.workspace.appendReference(reference(), 0);
    const result = creation.workspace.dispose();
    assert.equal(result.outcome, 'unverified');
    assert.equal(result.verifiedAbsent, false);
  });

  it('leaves an entry it did not create in place, and says so', () => {
    const parent = temporaryParent();
    const creation = openWorkspace({ parent });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    creation.workspace.appendReference(reference(), 0);
    const directory = workspaceDirectoryIn(parent);
    fs.writeFileSync(path.join(directory, 'not-mine.txt'), 'x');

    const result = creation.workspace.dispose();
    assert.equal(result.outcome, 'failed');
    assert.equal(result.foreignEntriesLeftInPlace, 1);
    assert.equal(
      fs.existsSync(path.join(directory, 'not-mine.txt')),
      true,
      'a cleanup that removed unknown entries could remove someone else’s data',
    );
  });
});
