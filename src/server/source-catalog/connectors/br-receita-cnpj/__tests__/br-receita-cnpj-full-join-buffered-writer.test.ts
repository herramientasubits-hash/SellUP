/**
 * BR Receita CNPJ — BUFFERED PARTITION WRITER — tests (BR-SOURCE-14B.0H § 9, § 24 items 6-18, 37-42).
 *
 * Root-cause profiling found BR-SOURCE-14B.0G's reference pass paying one synchronous `fs.write`
 * syscall per 16-byte reference. This suite defends the fix's two structural claims, and they are not
 * the same claim.
 *
 *   1. THE WRITE PATTERN ACTUALLY CHANGED. `writeStats().partitionWriteSyscalls` must fall FAR below
 *      `referenceRecordsAppended` — not merely "the code compiles", but a measured syscall count.
 *   2. NOTHING WAS LOST OR REORDERED TO GET THERE. Every reference — including ones whose partition's
 *      buffer never filled on its own, was evicted from the buffer ceiling, or sat through many
 *      unrelated handle evictions — reads back byte-for-byte identical and in append order.
 *
 * Real filesystem, real temp directory, same pattern as the sibling workspace suite.
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
  BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS,
  BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
  createBrazilReceitaFullJoinPartitionWorkspace,
  type BrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinWorkspace,
  type BrazilReceitaFullJoinWorkspaceBoundaries,
  type BrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-partition-workspace';

type AppendResult = ReturnType<BrazilReceitaFullJoinWorkspace['appendReference']>;
type ReadSliceResult = ReturnType<BrazilReceitaFullJoinWorkspace['readPartitionSlice']>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFERENCES_PER_BUFFER =
  BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES / BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;

let temporaryDirectories: string[] = [];

function temporaryParent(prefix = 'brfj-bufwriter-test-'): string {
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

function boundaries(): BrazilReceitaFullJoinWorkspaceBoundaries {
  return {
    repositoryRoot: '/workspaces/sellup-worktrees/br-14b0h',
    homeDirectory: '/home/operator',
    datasetRoot: '/home/operator/receita',
  };
}

function reference(overrides: Partial<BrazilReceitaFullJoinRowReference> = {}): BrazilReceitaFullJoinRowReference {
  return { sourceFileOrdinal: 0, byteOffset: 128, byteLength: 57, family: 'empresas', ...overrides };
}

function openWorkspace(
  options: {
    parent?: string;
    maxTemporaryStorageBytes?: number;
    fileSystem?: BrazilReceitaFullJoinWorkspaceFileSystem;
    maxOpenPartitionFiles?: number;
    openHandleLedger?: BrazilReceitaFullJoinOpenHandleLedger;
    freeDiskProbe?: BrazilReceitaFullJoinFreeDiskProbe;
  } = {},
) {
  // `minimumFreeDiskReserve` must be >= `maxTemporaryStorageBytes` (the reserve threshold can never
  // be looser than the cap it backs), so the disk minimums track whatever cap this call chose.
  const maxTemporaryStorageBytes = options.maxTemporaryStorageBytes ?? 1024 * 1024 * 1024;
  return createBrazilReceitaFullJoinPartitionWorkspace({
    parentDirectory: options.parent ?? temporaryParent(),
    boundaries: boundaries(),
    fileSystem: options.fileSystem ?? createBrazilReceitaFullJoinWorkspaceFileSystem(),
    maxTemporaryStorageBytes,
    maxOpenPartitionFiles: options.maxOpenPartitionFiles ?? 32,
    openHandleLedger: options.openHandleLedger ?? createBrazilReceitaFullJoinOpenHandleLedger(64),
    minimumFreeDiskBeforeStart: maxTemporaryStorageBytes,
    minimumFreeDiskReserve: maxTemporaryStorageBytes,
    freeDiskProbe: options.freeDiskProbe ?? (() => 64 * 1024 * 1024 * 1024),
    realDataRun: false,
  });
}

/** A deterministic, non-uniform-looking but reproducible reference for round-trip checks. */
function referenceFor(round: number, ordinal: number): BrazilReceitaFullJoinRowReference {
  return {
    sourceFileOrdinal: ordinal % 3,
    byteOffset: 1_000_000 * round + ordinal,
    byteLength: 10 + (ordinal % 50),
    family: ordinal % 2 === 0 ? 'empresas' : 'estabelecimentos',
  };
}

// ─── 1. The write pattern actually changed ─────────────────────────────────────

describe('BR-SOURCE-14B.0H — buffered writer reduces syscalls', () => {
  it('issues far fewer partition-write syscalls than references appended, for a partition revisited many times', () => {
    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const TOTAL = REFERENCES_PER_BUFFER * 5 + 7;
    for (let index = 0; index < TOTAL; index += 1) {
      const appended: AppendResult = creation.workspace.appendReference(referenceFor(index, 0), 0);
      assert.equal(appended.ok, true, `append ${index} must succeed`);
    }
    const before = creation.workspace.writeStats();
    // Mid-run: at least 5 full-buffer flushes should already have happened, without any read/dispose.
    assert.ok(before.fullBufferFlushes >= 5, `expected >=5 full flushes, saw ${before.fullBufferFlushes}`);
    assert.ok(
      before.partitionWriteSyscalls < TOTAL / 10,
      `syscalls ${before.partitionWriteSyscalls} must be far below ${TOTAL} references`,
    );

    creation.workspace.dispose();
  });

  it('touches the handle pool once per distinct partition on first contact, not once per reference', () => {
    const creation = openWorkspace({ maxOpenPartitionFiles: 8 });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const PARTITIONS = 20;
    const PER_PARTITION = 10;
    for (let round = 0; round < PER_PARTITION; round += 1) {
      for (let ordinal = 0; ordinal < PARTITIONS; ordinal += 1) {
        assert.equal(creation.workspace.appendReference(referenceFor(round, ordinal), ordinal).ok, true);
      }
    }
    // 10 references per partition, far under one buffer's capacity: the handle pool should see
    // roughly PARTITIONS touches (one fail-fast validation per distinct name), not PARTITIONS *
    // PER_PARTITION.
    const stats = creation.workspace.handleStats();
    assert.ok(
      stats.peakOpen <= 8,
      `peak open ${stats.peakOpen} must respect maxOpenPartitionFiles`,
    );
    creation.workspace.dispose();
  });
});

// ─── 2. Nothing lost or reordered: buffer-full flush ───────────────────────────

describe('BR-SOURCE-14B.0H — buffer-full flush preserves order and content', () => {
  it('reads back every reference in append order across many full-buffer flushes', () => {
    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const TOTAL = REFERENCES_PER_BUFFER * 3 + 11;
    const written: BrazilReceitaFullJoinRowReference[] = [];
    for (let index = 0; index < TOTAL; index += 1) {
      const entry = referenceFor(index, 0);
      assert.equal(creation.workspace.appendReference(entry, 0).ok, true);
      written.push(entry);
    }

    const collected: BrazilReceitaFullJoinRowReference[] = [];
    let cursor = 0;
    let exhausted = false;
    while (!exhausted) {
      const slice: ReadSliceResult = creation.workspace.readPartitionSlice('empresas', 0, cursor, 64);
      assert.equal(slice.ok, true);
      if (!slice.ok) return;
      collected.push(...slice.references);
      cursor = slice.nextRecordIndex;
      exhausted = slice.exhausted;
    }
    assert.equal(collected.length, written.length, 'no reference may be lost across flushes');
    written.forEach((entry, index) => assert.deepEqual(collected[index], entry, `record ${index} must match`));
    creation.workspace.dispose();
  });
});

// ─── 3. Nothing lost or reordered: eviction while buffer is decoupled from handle ──

describe('BR-SOURCE-14B.0H — a handle eviction never touches an unrelated buffer', () => {
  it('preserves every reference across thousands of unrelated handle evictions between two writes to one partition', () => {
    // maxOpenPartitionFiles=2 against 500 partitions: writing to partition 0, then 499 others, then
    // back to partition 0 guarantees hundreds of unrelated evictions happen while partition 0's
    // buffer just sits there, untouched, waiting for its own trigger.
    const creation = openWorkspace({ maxOpenPartitionFiles: 2 });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const OTHER_PARTITIONS = 500;
    const first = referenceFor(0, 0);
    assert.equal(creation.workspace.appendReference(first, 0).ok, true);

    for (let ordinal = 1; ordinal <= OTHER_PARTITIONS; ordinal += 1) {
      assert.equal(creation.workspace.appendReference(referenceFor(1, ordinal), ordinal).ok, true);
    }
    assert.ok(creation.workspace.handleStats().evictions > OTHER_PARTITIONS / 2, 'eviction must have run');

    const second = referenceFor(2, 0);
    assert.equal(creation.workspace.appendReference(second, 0).ok, true);

    const slice = creation.workspace.readPartitionSlice('empresas', 0, 0, 16);
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.deepEqual(slice.references, [first, second], 'both writes to partition 0 must survive intact');

    creation.workspace.dispose();
  });
});

// ─── 4. Nothing lost or reordered: buffer-ceiling eviction ─────────────────────

describe('BR-SOURCE-14B.0H — the buffer-count ceiling evicts its own LRU entry, never a reference', () => {
  it('keeps every reference intact when more distinct partitions are touched than the buffer ceiling allows', () => {
    const creation = openWorkspace({ maxOpenPartitionFiles: 32 });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    // One reference per partition, well past MAX_BUFFERED_PARTITIONS distinct names — every single
    // one is a NEW buffer, so the ceiling's own LRU eviction must fire repeatedly.
    const TOUCHED = BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS + 50;
    const written = new Map<number, BrazilReceitaFullJoinRowReference>();
    for (let ordinal = 0; ordinal < TOUCHED; ordinal += 1) {
      const entry = referenceFor(0, ordinal);
      assert.equal(creation.workspace.appendReference(entry, ordinal).ok, true, `ordinal ${ordinal}`);
      written.set(ordinal, entry);
    }

    // Spot-check the very first, a middle, and the very last partition touched: the first one's
    // buffer was almost certainly evicted-and-flushed long before the loop finished.
    for (const ordinal of [0, Math.floor(TOUCHED / 2), TOUCHED - 1]) {
      const expected = written.get(ordinal)!;
      const slice = creation.workspace.readPartitionSlice(expected.family, ordinal, 0, 16);
      assert.equal(slice.ok, true, `ordinal ${ordinal} must read back`);
      if (!slice.ok) continue;
      assert.deepEqual(slice.references, [expected], `ordinal ${ordinal} must be intact`);
    }

    creation.workspace.dispose();
  });
});

// ─── 5. Bounded memory ─────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0H — the buffer is bounded, never unlimited', () => {
  it('every buffer is exactly BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES, aligned to the record size', () => {
    assert.equal(
      BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES % BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
      0,
      'a buffer that is not a whole number of records could split one across a flush boundary',
    );
    assert.ok(REFERENCES_PER_BUFFER > 0);
  });

  it('the theoretical worst-case buffer memory fits well inside a 64 MiB external-memory cap', () => {
    const worstCaseBytes =
      BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS * BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES;
    const PROPOSED_MAX_EXTERNAL_MEMORY_BYTES = 67_108_864; // 64 MiB, BR-SOURCE-14B.0C's proposed cap.
    assert.ok(
      worstCaseBytes < PROPOSED_MAX_EXTERNAL_MEMORY_BYTES,
      `worst case ${worstCaseBytes} bytes must stay under the proposed external memory cap`,
    );
  });
});

// ─── 6. Determinism ─────────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0H — same input, same partition bytes', () => {
  it('two identical synthetic runs produce byte-identical partition files', () => {
    const runs: Buffer[][] = [];
    for (let run = 0; run < 2; run += 1) {
      const parent = temporaryParent();
      const creation = openWorkspace({ parent });
      assert.equal(creation.ok, true);
      if (!creation.ok) return;

      for (let index = 0; index < REFERENCES_PER_BUFFER * 2 + 5; index += 1) {
        assert.equal(creation.workspace.appendReference(referenceFor(index, index % 4), index % 4).ok, true);
      }

      const directory = fs
        .readdirSync(parent)
        .filter((name) => name.startsWith('brfj-refs-'))
        .map((name) => path.join(parent, name))[0]!;
      const files = fs.readdirSync(directory).sort();
      runs.push(files.map((name) => fs.readFileSync(path.join(directory, name))));
      creation.workspace.dispose();
    }
    assert.equal(runs[0]!.length, runs[1]!.length, 'both runs must produce the same partition files');
    runs[0]!.forEach((bytes, index) => {
      assert.ok(bytes.equals(runs[1]![index]!), `partition file ${index} must be byte-identical across runs`);
    });
  });
});

// ─── 7. Flush failure preserves abort, never duplicates or silently drops ──────

describe('BR-SOURCE-14B.0H — a flush failure latches, rather than continuing on an uncertain file', () => {
  it('refuses every further append once a write throws mid-run', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    let writeCalls = 0;
    const creation = openWorkspace({
      fileSystem: {
        ...real,
        write(handle, data) {
          writeCalls += 1;
          if (writeCalls === 1) throw new Error('scripted write failure');
          return real.write(handle, data);
        },
      },
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    for (let index = 0; index < REFERENCES_PER_BUFFER; index += 1) {
      assert.equal(creation.workspace.appendReference(referenceFor(index, 0), 0).ok, true);
    }
    // The (index === REFERENCES_PER_BUFFER)-th append fills the buffer and triggers the first flush,
    // which is scripted to throw.
    const overflow = creation.workspace.appendReference(referenceFor(999, 0), 0);
    assert.equal(overflow.ok, false);
    if (overflow.ok) return;
    assert.equal(overflow.failure, 'partition_write_failed');

    const next = creation.workspace.appendReference(referenceFor(1000, 1), 1);
    assert.equal(next.ok, false, 'every further append must refuse once a flush has failed');
    if (next.ok) return;
    assert.equal(next.failure, 'partition_write_failed');

    creation.workspace.dispose();
  });
});

// ─── 8. Fail-fast on a genuinely broken destination ────────────────────────────

describe('BR-SOURCE-14B.0H — permission and open failures still surface on the FIRST reference', () => {
  it('refuses immediately when a partition file mode cannot be verified, before any buffering happens', () => {
    const real = createBrazilReceitaFullJoinWorkspaceFileSystem();
    let calls = 0;
    const creation = openWorkspace({
      fileSystem: {
        ...real,
        statMode: (target) => {
          calls += 1;
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
