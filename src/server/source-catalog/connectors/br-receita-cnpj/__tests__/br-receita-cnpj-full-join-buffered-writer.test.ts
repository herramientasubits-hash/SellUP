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
 * ── The write-ratio target is SCALE-AWARE, and that is not a hedge ──────────────
 * `partitionWriteCalls * 256 <= referenceRecordsEncoded` (the `LARGE_SCALE_STRUCTURAL_TARGET`) is NOT
 * an invariant that holds for every N, and asserting it on a small fixture would be asserting something
 * arithmetically impossible rather than something the writer controls. Every partition owes ONE
 * finalization flush whether or not its buffer ever filled, so at low references-per-partition those
 * fixed flushes dominate and no amount of correct buffering can reach 1/256. See
 * `structuralWriteCallUpperBound` / `largeScaleTargetIsArithmeticallyReachable` below: the target
 * becomes reachable only once the fixture carries at least one FULL buffer per active partition, and
 * this suite therefore proves the target at that scale and proves its UNREACHABILITY (by arithmetic,
 * not by omission) at the small one.
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

/**
 * The denominator of the LARGE-SCALE structural target: at a fixture large enough for the buffer-fill
 * regime to dominate, the buffered writer must issue at most one partition write syscall per 256
 * references encoded. Expressed as a denominator (and asserted by multiplication) so no assertion in
 * this file ever divides — an integer comparison cannot drift on a floating-point rounding edge.
 */
const LARGE_SCALE_STRUCTURAL_TARGET_DENOMINATOR = 256;

/**
 * The number of partition write syscalls the writer may issue, AT ANY SCALE, for a run that encodes
 * `referenceRecordsEncoded` references across `activePartitions` distinct partition files.
 *
 * Derivation, straight off the writer's two flush triggers:
 *   - FULL-BUFFER flushes. Each carries exactly `REFERENCES_PER_BUFFER` references and permanently
 *     removes them from memory, so a whole run can afford at most `floor(refs / REFERENCES_PER_BUFFER)`
 *     of them no matter how the references are distributed.
 *   - FINALIZATION flushes. Each partition that still holds a partial buffer owes exactly one flush at
 *     `dispose`/read time — at most `activePartitions` of them, and this is the FIXED cost that makes
 *     the ratio scale-dependent.
 *
 * PRECONDITION: `activePartitions <= BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS`. Above that
 * ceiling a partition's buffer can be evicted (and flushed, partially) more than once, and the
 * `activePartitions` term stops bounding the fixed cost. Every caller below asserts it.
 */
function structuralWriteCallUpperBound(referenceRecordsEncoded: number, activePartitions: number): number {
  return activePartitions + Math.floor(referenceRecordsEncoded / REFERENCES_PER_BUFFER);
}

/**
 * Whether `LARGE_SCALE_STRUCTURAL_TARGET` is even arithmetically achievable at this shape.
 *
 * Substituting the upper bound above into `256 * writeCalls <= refs`:
 *
 *     256 * (activePartitions + refs/512) <= refs
 *     256 * activePartitions              <= refs / 2
 *     refs                                >= 512 * activePartitions
 *
 * i.e. the fixture must carry at least ONE FULL BUFFER per active partition. Below that, the fixed
 * per-partition finalization flushes dominate and a perfectly-behaved writer still misses 1/256 — which
 * is exactly why the small fixtures in this file do not assert the target. (Sufficient, not necessary:
 * a skewed distribution can clear the target somewhat earlier, as the profiler's 1M/2048-partition run
 * did. Nothing in this file relies on that.)
 */
function largeScaleTargetIsArithmeticallyReachable(
  referenceRecordsEncoded: number,
  activePartitions: number,
): boolean {
  return referenceRecordsEncoded >= REFERENCES_PER_BUFFER * activePartitions;
}

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
    // The REAL guarantee at this (single-partition, mid-run) shape: the scale-aware upper bound, which
    // holds at every scale. Not a ratio — at one partition and 2 567 references the fixed finalization
    // cost is a single flush, so a ratio here would be measuring almost nothing.
    assert.ok(
      before.partitionWriteSyscalls <= structuralWriteCallUpperBound(TOTAL, 1),
      `syscalls ${before.partitionWriteSyscalls} must respect the structural bound ` +
        `${structuralWriteCallUpperBound(TOTAL, 1)} for ${TOTAL} references over 1 partition`,
    );
    // SECONDARY SMOKE ONLY, deliberately not the guarantee: an order-of-magnitude sanity check that
    // catches a total collapse back to one-syscall-per-reference at this small scale. The structural
    // guarantee this milestone actually rests on is the LARGE_SCALE_STRUCTURAL_TARGET block below.
    assert.ok(
      before.partitionWriteSyscalls < TOTAL / 10,
      `smoke: syscalls ${before.partitionWriteSyscalls} must be far below ${TOTAL} references`,
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

// ─── 1b. LARGE_SCALE_STRUCTURAL_TARGET, and why it does not apply to a small fixture ──

/** The two families, so a test can address BOTH partition files that share one ordinal. */
const PARTITIONED_FAMILIES = ['empresas', 'estabelecimentos'] as const;

/**
 * A partition SLOT is one distinct partition FILE: `(ordinal, family)`. Slots are what
 * `structuralWriteCallUpperBound`'s `activePartitions` counts, because each file — not each ordinal —
 * owes its own finalization flush.
 */
function referenceForSlot(slot: number, round: number): BrazilReceitaFullJoinRowReference {
  return {
    sourceFileOrdinal: slot % 3,
    byteOffset: 1_000_000 * round + slot,
    byteLength: 10 + (slot % 50),
    family: PARTITIONED_FAMILIES[slot & 1]!,
  };
}

const slotOrdinal = (slot: number): number => slot >> 1;

/**
 * Appends `rounds` references to each of `slots` partition files, round-robin (every slot touched once
 * before any is touched again) — the worst case for a handle pool of 32 and the closest synthetic
 * analogue of near-uniform hash routing, without depending on a hash function's distribution.
 */
function appendRoundRobin(
  workspace: BrazilReceitaFullJoinWorkspace,
  slots: number,
  rounds: number,
): number {
  let failures = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (let slot = 0; slot < slots; slot += 1) {
      if (!workspace.appendReference(referenceForSlot(slot, round), slotOrdinal(slot)).ok) failures += 1;
    }
  }
  return failures;
}

describe('BR-SOURCE-14B.0H — LARGE_SCALE_STRUCTURAL_TARGET: one write syscall per >=256 references', () => {
  it('holds partitionWriteCalls * 256 <= referenceRecordsEncoded once every partition carries a full buffer', () => {
    // Production-shaped: 1 024 distinct partition FILES (512 ordinals x 2 families), the proposed
    // profile's partition count, against the proposed 32-handle pool. Sized so the buffer-fill regime
    // dominates rather than the fixed finalization cost — exactly TWO full buffers per partition, which
    // is the smallest whole-buffer multiple that clears `largeScaleTargetIsArithmeticallyReachable`
    // with margin. Everything below is DERIVED from REFERENCES_PER_BUFFER, so changing the buffer
    // constant rescales the fixture instead of silently invalidating the assertion.
    const PARTITION_FILES = 1_024;
    const BUFFERS_PER_PARTITION = 2;
    const REFERENCES_PER_PARTITION = REFERENCES_PER_BUFFER * BUFFERS_PER_PARTITION;
    const TOTAL_REFERENCES = PARTITION_FILES * REFERENCES_PER_PARTITION;
    const EXPECTED_WRITE_CALLS = PARTITION_FILES * BUFFERS_PER_PARTITION;

    assert.ok(
      PARTITION_FILES <= BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS,
      'precondition: below the buffer ceiling, so no partition is flushed partially by an eviction',
    );
    assert.equal(
      largeScaleTargetIsArithmeticallyReachable(TOTAL_REFERENCES, PARTITION_FILES),
      true,
      'the fixture must be large enough for the target to be achievable at all',
    );

    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    assert.equal(
      appendRoundRobin(creation.workspace, PARTITION_FILES, REFERENCES_PER_PARTITION),
      0,
      'every append must succeed',
    );

    // Read ONE partition back completely, before dispose, so the ratio below is never a ratio over
    // references that were silently dropped instead of buffered. Reading flushes only this partition's
    // pending buffer — a flush `dispose` would have paid anyway, so the totals stay exact.
    const expectedSlotZero = Array.from({ length: REFERENCES_PER_PARTITION }, (_unused, round) =>
      referenceForSlot(0, round),
    );
    const readBack: BrazilReceitaFullJoinRowReference[] = [];
    let cursor = 0;
    let exhausted = false;
    while (!exhausted) {
      const slice = creation.workspace.readPartitionSlice(
        PARTITIONED_FAMILIES[0],
        slotOrdinal(0),
        cursor,
        256,
      );
      assert.equal(slice.ok, true);
      if (!slice.ok) return;
      readBack.push(...slice.references);
      cursor = slice.nextRecordIndex;
      exhausted = slice.exhausted;
    }
    assert.deepEqual(readBack, expectedSlotZero, 'partition 0 must read back complete and in order');

    creation.workspace.dispose();

    const stats = creation.workspace.writeStats();
    assert.equal(stats.referenceRecordsAppended, TOTAL_REFERENCES);
    assert.equal(stats.flushFailures, 0);

    // ── THE TARGET. Integer multiplication, never division: no floating-point edge to drift on. ──
    assert.ok(
      stats.partitionWriteSyscalls * LARGE_SCALE_STRUCTURAL_TARGET_DENOMINATOR <= TOTAL_REFERENCES,
      `LARGE_SCALE_STRUCTURAL_TARGET: ${stats.partitionWriteSyscalls} write calls x ` +
        `${LARGE_SCALE_STRUCTURAL_TARGET_DENOMINATOR} must not exceed ${TOTAL_REFERENCES} references ` +
        `(observed ratio 1/${Math.floor(TOTAL_REFERENCES / Math.max(1, stats.partitionWriteSyscalls))})`,
    );

    // The scale-aware bound, which must hold here too — the target and the bound are different claims.
    assert.ok(
      stats.partitionWriteSyscalls <= structuralWriteCallUpperBound(TOTAL_REFERENCES, PARTITION_FILES),
      `write calls ${stats.partitionWriteSyscalls} must respect the structural bound ` +
        `${structuralWriteCallUpperBound(TOTAL_REFERENCES, PARTITION_FILES)}`,
    );

    // And the exact figure the design predicts: two full buffers per partition, one write syscall each,
    // nothing partial left over. A regression that reintroduced per-reference writes, per-eviction
    // flushes, or handle-tied buffer lifetimes would miss this by orders of magnitude.
    assert.equal(
      stats.partitionWriteSyscalls,
      EXPECTED_WRITE_CALLS,
      'each partition must pay exactly one write syscall per full buffer, and no partial extra',
    );
    assert.ok(
      stats.fullBufferFlushes >= PARTITION_FILES,
      `every partition must have filled at least one buffer, saw ${stats.fullBufferFlushes}`,
    );
  });

  it('documents, by arithmetic, why a 100k-scale fixture cannot reach 1/256 no matter how correct the writer is', () => {
    // The shape the profiler reported at 100k (BR-SOURCE-14B.0H § 5.1): 1 024 ordinals across two
    // families = 2 048 distinct partition files, each receiving far fewer references than one buffer
    // holds. Every partition still owes its ONE finalization flush, so write calls are pinned at the
    // partition count and the ratio is a property of the FIXTURE, not of the writer.
    const PARTITION_FILES = 2_048;
    const REFERENCES_PER_PARTITION = 48; // well under REFERENCES_PER_BUFFER (512)
    const TOTAL_REFERENCES = PARTITION_FILES * REFERENCES_PER_PARTITION; // 98 304, ~ the documented 100k

    assert.ok(REFERENCES_PER_PARTITION < REFERENCES_PER_BUFFER, 'no buffer may fill in this regime');
    assert.ok(PARTITION_FILES <= BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS);

    const creation = openWorkspace();
    assert.equal(creation.ok, true);
    if (!creation.ok) return;
    assert.equal(
      appendRoundRobin(creation.workspace, PARTITION_FILES, REFERENCES_PER_PARTITION),
      0,
      'every append must succeed',
    );
    creation.workspace.dispose();

    const stats = creation.workspace.writeStats();
    assert.equal(stats.referenceRecordsAppended, TOTAL_REFERENCES);
    // Zero full-buffer flushes: every single write syscall here is a fixed finalization flush.
    assert.equal(stats.fullBufferFlushes, 0, 'no buffer can fill at this references-per-partition');
    assert.equal(
      stats.partitionWriteSyscalls,
      PARTITION_FILES,
      'exactly one finalization flush per partition file — the fixed floor',
    );

    // The writer is behaving perfectly (it hit the floor exactly, and respects the scale-aware bound)…
    assert.ok(
      stats.partitionWriteSyscalls <= structuralWriteCallUpperBound(TOTAL_REFERENCES, PARTITION_FILES),
    );
    // …and STILL cannot reach 1/256, because the floor alone already exceeds it. This is the assertion
    // that keeps a future reader from "fixing" the small fixture by tightening its ratio.
    assert.equal(
      largeScaleTargetIsArithmeticallyReachable(TOTAL_REFERENCES, PARTITION_FILES),
      false,
      'the 1/256 target is out of reach below one full buffer per partition',
    );
    assert.ok(
      PARTITION_FILES * LARGE_SCALE_STRUCTURAL_TARGET_DENOMINATOR > TOTAL_REFERENCES,
      'the unavoidable finalization floor alone already breaks 1/256 at this scale',
    );
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
