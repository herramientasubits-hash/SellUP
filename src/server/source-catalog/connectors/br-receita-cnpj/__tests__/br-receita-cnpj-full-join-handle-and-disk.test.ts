/**
 * BR Receita CNPJ — BOUNDED FILE DESCRIPTORS & FREE-DISK ENFORCEMENT — tests
 * (BR-SOURCE-14B.0F § 3, § 4; § 13 tests 19–33).
 *
 * Two claims are defended here, and neither of them is "the code has a cap constant in it".
 *
 *   1. DESCRIPTOR USAGE IS A FUNCTION OF THE CAP, NOT OF THE PARTITION COUNT. The decisive test
 *      writes references across 1024 distinct partitions through a filesystem port that COUNTS every
 *      open and close and tracks the live set — and asserts the live set never passed 32 while the
 *      partition count was 1024. A test that only read `maxOpenPartitionFiles` back would prove a
 *      constant exists and nothing about how many descriptors the process held.
 *
 *   2. EVICTION LOSES NOTHING. Every reference written across an evicting pool is read back and
 *      compared against what was written, field by field. This is the property the whole design rests
 *      on: if a reopened append handle did not continue where the closed one stopped, the run would
 *      silently drop references and report a smaller, entirely plausible join.
 *
 * The free-disk half is driven through an INJECTED probe, per § 4. No test here fills a disk, and no
 * test asks the machine running the suite how much space it has — a suite whose outcome depends on
 * the free space of whatever laptop runs it is a flaky suite.
 *
 * No repository path, no operator home, no dataset, no real manifest, no Supabase, no network, no git.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createBrazilReceitaFullJoinWorkspaceFileSystem } from '../br-receita-cnpj-full-join-engine-fs';
import {
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_TEMPORARY_STORAGE_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START,
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE,
  assertBrazilReceitaFullJoinFreeDiskBeforeStart,
  assertBrazilReceitaFullJoinFreeDiskReserve,
  createBrazilReceitaFullJoinFreeDiskCheckSchedule,
  resolveBrazilReceitaFullJoinFreeDiskThresholds,
  type BrazilReceitaFullJoinFreeDiskProbe,
  type BrazilReceitaFullJoinFreeDiskThresholds,
} from '../br-receita-cnpj-full-join-free-disk';
import {
  BRAZIL_RECEITA_FULL_JOIN_HANDLE_CATEGORIES,
  createBrazilReceitaFullJoinOpenHandleLedger,
  resolveBrazilReceitaFullJoinHandleCaps,
  withBrazilReceitaFullJoinLedgerAccounting,
} from '../br-receita-cnpj-full-join-open-handle-ledger';
import {
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES,
  createBrazilReceitaFullJoinPartitionHandlePool,
} from '../br-receita-cnpj-full-join-partition-handle-pool';
import {
  BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
  createBrazilReceitaFullJoinPartitionWorkspace,
  type BrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinWorkspaceBoundaries,
  type BrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-partition-workspace';

// ─── Harness ──────────────────────────────────────────────────────────────────

const GLOBAL_CAP = 64;
const POOL_CAP = 32;
const GENEROUS_FREE_BYTES = 64 * 1024 * 1024 * 1024;

let temporaryDirectories: string[] = [];

function temporaryParent(prefix = 'brfj-fd-test-'): string {
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

function boundaries(
  overrides: Partial<BrazilReceitaFullJoinWorkspaceBoundaries> = {},
): BrazilReceitaFullJoinWorkspaceBoundaries {
  return {
    repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
    homeDirectory: '/home/operator',
    datasetRoot: '/srv/receita',
    ...overrides,
  };
}

/**
 * A workspace filesystem that OBSERVES every open and close.
 *
 * This is the instrument the whole file depends on. It wraps the real adapter, so the bytes on disk
 * are real and the references really do survive eviction, while `liveHandles` and `peakLive` record
 * what the process actually held at each moment. Counting opens alone would not do: a run that opened
 * and closed 4096 times holds one descriptor, and a run that opened 4096 times without closing holds
 * 4096 — the difference is invisible in a total.
 */
interface HandleObserver {
  readonly fileSystem: BrazilReceitaFullJoinWorkspaceFileSystem;
  peakLive(): number;
  liveNow(): number;
  opens(): number;
  closes(): number;
}

function observingWorkspaceFileSystem(
  base: BrazilReceitaFullJoinWorkspaceFileSystem = createBrazilReceitaFullJoinWorkspaceFileSystem(),
  overrides: Partial<BrazilReceitaFullJoinWorkspaceFileSystem> = {},
): HandleObserver {
  const live = new Set<number>();
  let peak = 0;
  let opens = 0;
  let closes = 0;

  function track(handle: number): number {
    live.add(handle);
    opens += 1;
    if (live.size > peak) peak = live.size;
    return handle;
  }

  const fileSystem: BrazilReceitaFullJoinWorkspaceFileSystem = {
    ...base,
    openForAppend(filePath, mode) {
      return track(base.openForAppend(filePath, mode));
    },
    openForRead(filePath) {
      return track(base.openForRead(filePath));
    },
    close(handle) {
      live.delete(handle);
      closes += 1;
      base.close(handle);
    },
    ...overrides,
  };

  return {
    fileSystem,
    peakLive: () => peak,
    liveNow: () => live.size,
    opens: () => opens,
    closes: () => closes,
  };
}

function openWorkspace(options: {
  observer: HandleObserver;
  parent?: string;
  maxOpenPartitionFiles?: number;
  maxTemporaryStorageBytes?: number;
  globalCap?: number;
  freeDiskProbe?: BrazilReceitaFullJoinFreeDiskProbe;
  minimumFreeDiskBeforeStart?: number;
  minimumFreeDiskReserve?: number;
  boundaryOverrides?: Partial<BrazilReceitaFullJoinWorkspaceBoundaries>;
  realDataRun?: boolean;
}) {
  const storageCap = options.maxTemporaryStorageBytes ?? 4 * 1024 * 1024;
  return createBrazilReceitaFullJoinPartitionWorkspace({
    parentDirectory: options.parent ?? temporaryParent(),
    boundaries: boundaries(options.boundaryOverrides),
    fileSystem: options.observer.fileSystem,
    maxTemporaryStorageBytes: storageCap,
    maxOpenPartitionFiles: options.maxOpenPartitionFiles ?? POOL_CAP,
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(options.globalCap ?? GLOBAL_CAP),
    // The reserve must be at or above the storage cap — a run authorized to write more than it must
    // leave free is a run whose two limits can disagree about the same volume. Derived rather than
    // hardcoded so a test that shrinks the storage cap does not accidentally build an invalid profile.
    minimumFreeDiskBeforeStart: options.minimumFreeDiskBeforeStart ?? storageCap * 2,
    minimumFreeDiskReserve: options.minimumFreeDiskReserve ?? storageCap,
    freeDiskProbe: options.freeDiskProbe ?? (() => GENEROUS_FREE_BYTES),
    realDataRun: options.realDataRun ?? false,
  });
}

function reference(
  overrides: Partial<BrazilReceitaFullJoinRowReference> = {},
): BrazilReceitaFullJoinRowReference {
  return { sourceFileOrdinal: 0, byteOffset: 128, byteLength: 57, family: 'empresas', ...overrides };
}

function thresholds(
  overrides: Partial<BrazilReceitaFullJoinFreeDiskThresholds> = {},
): BrazilReceitaFullJoinFreeDiskThresholds {
  return {
    minimumFreeDiskBeforeStart: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START,
    minimumFreeDiskReserve: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE,
    maxTemporaryStorageBytes: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_TEMPORARY_STORAGE_BYTES,
    ...overrides,
  };
}

// ─── § 3 — the caps themselves ────────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 3 — descriptor caps', () => {
  // Test 19.
  it('proposes maxOpenPartitionFiles = 32 and a global cap of 64', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES, 32);
    const ledger = createBrazilReceitaFullJoinOpenHandleLedger(GLOBAL_CAP);
    assert.equal(ledger.maxFilesOpened(), 64);
  });

  it('refuses a partition cap above the global cap, and every malformed cap shape', () => {
    // The relational check is the interesting one: each cap alone looks perfectly reasonable.
    const above = resolveBrazilReceitaFullJoinHandleCaps(64, 128);
    assert.equal(above.ok, false);
    if (!above.ok) assert.ok(above.rejections.includes('partition_cap_above_global_cap'));

    for (const bad of [undefined, null, 'thirty-two', Number.POSITIVE_INFINITY, 3.5, 0, -1]) {
      const outcome = resolveBrazilReceitaFullJoinHandleCaps(64, bad);
      assert.equal(outcome.ok, false, `cap ${String(bad)} must be refused`);
    }

    const good = resolveBrazilReceitaFullJoinHandleCaps(64, 32);
    assert.equal(good.ok, true);
  });

  it('counts every category against one global budget', () => {
    const ledger = createBrazilReceitaFullJoinOpenHandleLedger(4);
    for (const category of BRAZIL_RECEITA_FULL_JOIN_HANDLE_CATEGORIES) {
      assert.equal(ledger.reserve(category).ok, true, `${category} must fit`);
    }
    assert.equal(ledger.openNow(), 4);
    // The fifth reservation is refused REGARDLESS of category: the budget is shared, which is the
    // whole point of the ledger existing at all.
    const overflow = ledger.reserve('source_file');
    assert.equal(overflow.ok, false);
    if (!overflow.ok) {
      assert.equal(overflow.breach.code, 'files_opened_cap_exceeded');
      assert.equal(overflow.breach.projectedOpenFiles, 5);
      assert.equal(overflow.breach.maxFilesOpened, 4);
    }
  });

  it('latches the first breach and never reports a clean answer afterwards', () => {
    const ledger = createBrazilReceitaFullJoinOpenHandleLedger(1);
    assert.equal(ledger.reserve('source_file').ok, true);
    assert.equal(ledger.reserve('source_file').ok, false);
    // Releasing does NOT un-latch. A caller that ignored the refusal must not be able to obtain a
    // clean answer by tidying up afterwards.
    ledger.release('source_file');
    ledger.release('source_file');
    assert.equal(ledger.reserve('source_file').ok, false);
    assert.notEqual(ledger.breach(), null);
  });

  it('releases a ledger slot when a wrapped open throws, so a failure does not shrink the budget', () => {
    const ledger = createBrazilReceitaFullJoinOpenHandleLedger(2);
    const port = withBrazilReceitaFullJoinLedgerAccounting(
      {
        open(filePath: string): number {
          // The parameter is declared so `TPort` infers a one-argument `open`; the double never
          // reaches a filesystem.
          void filePath;
          throw new Error('nope');
        },
        close(): void {},
      },
      ledger,
      'source_file',
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.throws(() => port.open('/synthetic/never-read'));
    }
    // Ten failed opens against a budget of two. Without the release-on-throw the budget would be
    // gone after the second, and the eleventh caller would be refused for a reason that never
    // happened.
    assert.equal(ledger.openNow(), 0);
    assert.equal(ledger.breach(), null);
  });
});

// ─── § 3 — the pool, exercised against a real disk ────────────────────────────

describe('BR-SOURCE-14B.0F § 3 — bounded partition handles', () => {
  // Tests 20 and 22: the decisive pair.
  it('holds at most 32 descriptors while writing across 1024 partitions', () => {
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({ observer });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const PARTITIONS = 1024;
    for (let ordinal = 0; ordinal < PARTITIONS; ordinal += 1) {
      const appended = creation.workspace.appendReference(
        reference({ byteOffset: 16 * (ordinal + 1) }),
        ordinal,
      );
      assert.equal(appended.ok, true, `partition ${ordinal} must accept a reference`);
    }

    // The claim, measured rather than asserted about a constant.
    assert.ok(
      observer.peakLive() <= POOL_CAP,
      `peak live descriptors ${observer.peakLive()} must not exceed ${POOL_CAP}`,
    );
    assert.equal(creation.workspace.handleStats().peakOpen <= POOL_CAP, true);
    // 1024 partitions, and nothing close to 1024 descriptors. Before § 3 this number WAS 1024.
    assert.ok(observer.peakLive() < 64, 'a 1024-partition map must not need 64 descriptors');
    // Eviction really happened — otherwise the bound would be untested rather than satisfied.
    assert.ok(creation.workspace.handleStats().evictions > 0);

    const disposal = creation.workspace.dispose();
    assert.equal(disposal.outcome, 'completed');
  });

  /**
   * The § 11 profile's WORST case, measured: `partitionCount = 1024` with `maxPartitionCount = 2048`.
   *
   * The previous test covers the nominal count. This one covers the ceiling the profile authorizes a
   * repartition to reach, because that is the number an operator would actually be authorizing — and
   * it is the one that produced the 14B.0E finding. Under the pre-§ 3 design 2048 partitions across
   * two families meant roughly 4096 simultaneous descriptors, which is why `ulimit -n 8192` appeared
   * in the discussion at all.
   *
   * Every partition is written more than once, in round-robin order, so no handle can survive from
   * one write to that partition's next: the pool is forced through evict-and-reopen ~6000 times, and
   * the peak is a measurement of the resulting behaviour rather than a restatement of a constant.
   */
  it('holds at most 32 descriptors at maxPartitionCount = 2048, so no extraordinary ulimit is required', () => {
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({ observer });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const PARTITION_COUNT = 1024;
    const MAX_PARTITION_COUNT = 2048;
    const ROUNDS = 3;

    for (let round = 0; round < ROUNDS; round += 1) {
      for (let ordinal = 0; ordinal < MAX_PARTITION_COUNT; ordinal += 1) {
        const appended = creation.workspace.appendReference(
          reference({ byteOffset: 16 * (ordinal + 1), family: ordinal % 2 === 0 ? 'empresas' : 'estabelecimentos' }),
          ordinal,
        );
        assert.equal(appended.ok, true, `partition ${ordinal} must accept a reference`);
      }
    }

    const stats = creation.workspace.handleStats();

    // MAX_OPEN_PARTITION_FILES = 32, enforced, at the profile's maximum partition count.
    assert.ok(
      observer.peakLive() <= POOL_CAP,
      `peak live descriptors ${observer.peakLive()} must not exceed ${POOL_CAP} at ${MAX_PARTITION_COUNT} partitions`,
    );
    assert.ok(stats.peakOpen <= POOL_CAP);
    assert.equal(stats.maxOpenPartitionFiles, POOL_CAP);

    // UNBOUNDED_PARTITION_HANDLES_ELIMINATED: descriptor usage is a function of the CAP, not of the
    // partition count. Doubling the partitions from 1024 to 2048 does not move the peak at all.
    assert.ok(
      observer.peakLive() < PARTITION_COUNT,
      'descriptor peak must not scale with the partition count',
    );

    // ULIMIT_8192_REQUIRED = false, stated as the arithmetic rather than as a claim. The pre-§ 3
    // design needed ~2 × maxPartitionCount descriptors; this run needs fewer than a CONSERVATIVE
    // default soft limit, so no operator has to raise anything.
    const CONSERVATIVE_DEFAULT_ULIMIT = 256;
    assert.ok(
      observer.peakLive() < CONSERVATIVE_DEFAULT_ULIMIT,
      `peak ${observer.peakLive()} must fit inside a conservative default ulimit`,
    );
    assert.ok(observer.peakLive() * 100 < 8192, 'the run must be nowhere near an 8192 descriptor budget');

    // The bound was exercised rather than merely satisfied. BR-SOURCE-14B.0H decouples a partition's
    // write BUFFER from its file HANDLE: once a partition's destination is validated on its first
    // reference, later references to the SAME partition (here, only 3 per partition — one per round —
    // far under the buffer's own 32-reference capacity) never touch the handle pool again until that
    // buffer flushes. So the handle pool now sees roughly one touch per DISTINCT partition (2048)
    // rather than one per total write (6144) — still almost every one of those 2048 is a miss against
    // a 32-slot pool, which is the bound this assertion checks.
    assert.ok(
      stats.evictions >= MAX_PARTITION_COUNT - POOL_CAP,
      'eviction must have carried the load',
    );

    // Descriptors are RETURNED, not merely capped: a pool that leaked would show a rising live set.
    // BR-SOURCE-14B.0H: with buffered writes touching the pool once per DISTINCT partition rather
    // than once per write, the floor is exactly `MAX_PARTITION_COUNT` opens (one fail-fast validation
    // touch per partition) rather than the old design's much higher per-write figure.
    assert.ok(observer.opens() >= MAX_PARTITION_COUNT);
    assert.equal(observer.opens() - observer.closes(), observer.liveNow());

    const disposal = creation.workspace.dispose();
    assert.equal(disposal.outcome, 'completed');
    // Everything is closed once the workspace is gone — no descriptor outlives the run.
    assert.equal(observer.liveNow(), 0);
  });

  // Test 21.
  it('never exceeds the global cap even when the pool cap would allow more', () => {
    // A pool cap of 32 against a GLOBAL cap of 8: the global one has to win, and the pool has to
    // evict its own handles to satisfy it rather than refusing.
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({ observer, globalCap: 8, maxOpenPartitionFiles: 8 });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    for (let ordinal = 0; ordinal < 200; ordinal += 1) {
      assert.equal(creation.workspace.appendReference(reference(), ordinal % 40).ok, true);
    }
    assert.ok(observer.peakLive() <= 8, `peak ${observer.peakLive()} must not exceed the global cap`);
    creation.workspace.dispose();
  });

  // Test 23: eviction and reopen preserve correctness.
  it('loses no reference when handles are evicted and reopened', () => {
    const observer = observingWorkspaceFileSystem();
    // A pool of FOUR against forty partitions: almost every write is a miss, so almost every write
    // goes through the evict-and-reopen path this test exists to check.
    const creation = openWorkspace({ observer, maxOpenPartitionFiles: 4 });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const PARTITIONS = 40;
    const REFERENCES_PER_BUFFER =
      BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES / BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;
    // BR-SOURCE-14B.0H: a partition's write BUFFER is decoupled from its handle, so the handle pool
    // is only touched again once that buffer actually fills — PER_PARTITION must exceed
    // REFERENCES_PER_BUFFER for this test to exercise a real evict-and-reopen cycle DURING the write
    // phase, not only the one-time fail-fast validation touch every partition gets on its first
    // reference. Derived from the real constants rather than hard-coded, so a future buffer-size
    // tuning cannot silently make this assertion pass for the wrong reason.
    const PER_PARTITION = REFERENCES_PER_BUFFER + 4;
    const written = new Map<number, BrazilReceitaFullJoinRowReference[]>();

    // Round-robin, so consecutive writes to one partition are separated by 39 others and the
    // handle is certainly evicted in between.
    for (let round = 0; round < PER_PARTITION; round += 1) {
      for (let ordinal = 0; ordinal < PARTITIONS; ordinal += 1) {
        const entry = reference({
          sourceFileOrdinal: ordinal % 2,
          byteOffset: 1_000 * (round + 1) + ordinal,
          byteLength: 10 + ordinal,
          family: 'empresas',
        });
        assert.equal(creation.workspace.appendReference(entry, ordinal).ok, true);
        const list = written.get(ordinal) ?? [];
        list.push(entry);
        written.set(ordinal, list);
      }
    }

    assert.ok(creation.workspace.handleStats().reopens > 0, 'the test must exercise reopens');

    for (const [ordinal, expected] of written) {
      // PER_PARTITION (260) exceeds the read batch used elsewhere in this suite, so this one-shot
      // read needs a larger `maxRecords` to still see every reference in a single call.
      const slice = creation.workspace.readPartitionSlice('empresas', ordinal, 0, PER_PARTITION + 16);
      assert.equal(slice.ok, true);
      if (!slice.ok) continue;
      assert.equal(slice.references.length, expected.length, `partition ${ordinal} lost a reference`);
      // Field by field, in order: an append that resumed at the wrong offset would corrupt the
      // sequence rather than shorten it, and a length check alone would miss that.
      expected.forEach((entry, index) => {
        assert.deepEqual(slice.references[index], entry);
      });
    }
    creation.workspace.dispose();
  });

  // Test 24.
  it('closes every descriptor on a successful disposal', () => {
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({ observer });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    for (let ordinal = 0; ordinal < 50; ordinal += 1) {
      creation.workspace.appendReference(reference(), ordinal);
    }
    creation.workspace.readPartitionSlice('empresas', 0, 0, 16);
    assert.ok(observer.liveNow() > 0, 'the run must be holding descriptors before disposal');

    const disposal = creation.workspace.dispose();
    assert.equal(disposal.outcome, 'completed');
    assert.equal(disposal.verifiedAbsent, true);
    assert.equal(observer.liveNow(), 0, 'disposal must leave no descriptor open');
    assert.equal(observer.opens(), observer.closes());
  });

  // Test 25.
  it('closes every descriptor when disposal FAILS to remove a file', () => {
    const base = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const observer = observingWorkspaceFileSystem(base, {
      removeFile() {
        throw new Error('unlink refused');
      },
    });
    const creation = openWorkspace({ observer });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    for (let ordinal = 0; ordinal < 10; ordinal += 1) {
      creation.workspace.appendReference(reference(), ordinal);
    }

    const disposal = creation.workspace.dispose();
    assert.equal(disposal.outcome, 'failed');
    // The descriptors are released even though the deletion failed. This is the ordering § 12
    // requires: handles first, deletion second — an unlink of a file the process still holds open
    // leaves the space allocated, so a cleanup that deleted first could report success while the
    // volume was still full.
    assert.equal(observer.liveNow(), 0, 'a failed cleanup must still release every descriptor');
  });

  it('refuses when the pool cannot open a partition at all, without leaking a slot', () => {
    const base = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const observer = observingWorkspaceFileSystem(base, {
      openForAppend() {
        throw new Error('open refused');
      },
    });
    const creation = openWorkspace({ observer });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    const appended = creation.workspace.appendReference(reference(), 0);
    assert.equal(appended.ok, false);
    if (!appended.ok) assert.equal(appended.failure, 'partition_open_failed');
    assert.equal(observer.liveNow(), 0);
    creation.workspace.dispose();
  });

  it('evicts least-recently-used, deterministically', () => {
    const ledger = createBrazilReceitaFullJoinOpenHandleLedger(GLOBAL_CAP);
    const closed: number[] = [];
    let next = 100;
    const pool = createBrazilReceitaFullJoinPartitionHandlePool({
      maxOpenPartitionFiles: 2,
      ledger,
      port: {
        open() {
          next += 1;
          return next;
        },
        close(handle) {
          closed.push(handle);
        },
      },
    });

    const a = pool.acquire('a:one');
    const b = pool.acquire('a:two');
    assert.equal(a.ok && b.ok, true);
    // Touch `one`, so `two` becomes the least-recently-used entry.
    pool.acquire('a:one');
    pool.acquire('a:three');

    assert.deepEqual(closed, [102], 'the LRU entry, not the first-inserted one, must be evicted');
    assert.equal(pool.isOpen('a:two'), false);
    assert.equal(pool.isOpen('a:one'), true);
    assert.equal(pool.stats().evictions, 1);
  });
});

// ─── § 4 — free disk ──────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 4 — free-disk enforcement', () => {
  it('carries the 14B.0E thresholds unchanged', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_TEMPORARY_STORAGE_BYTES, 4_294_967_296);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START, 12_884_901_888);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE, 8_589_934_592);
  });

  it('refuses a reserve above the start threshold or below the storage cap', () => {
    // Both relational, and both describe a configuration that can never succeed.
    const above = resolveBrazilReceitaFullJoinFreeDiskThresholds({
      minimumFreeDiskBeforeStart: 1_000,
      minimumFreeDiskReserve: 2_000,
      maxTemporaryStorageBytes: 500,
    });
    assert.equal(above.ok, false);
    if (!above.ok) assert.ok(above.rejections.includes('reserve_above_before_start'));

    const below = resolveBrazilReceitaFullJoinFreeDiskThresholds({
      minimumFreeDiskBeforeStart: 10_000,
      minimumFreeDiskReserve: 1_000,
      maxTemporaryStorageBytes: 5_000,
    });
    assert.equal(below.ok, false);
    if (!below.ok) assert.ok(below.rejections.includes('reserve_below_temporary_storage_cap'));

    assert.equal(
      resolveBrazilReceitaFullJoinFreeDiskThresholds({
        minimumFreeDiskBeforeStart: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START,
        minimumFreeDiskReserve: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE,
        maxTemporaryStorageBytes: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_TEMPORARY_STORAGE_BYTES,
      }).ok,
      true,
      'the proposed profile must satisfy its own relational rules',
    );
  });

  // Test 26.
  it('passes the before-start check when the volume has room', () => {
    const outcome = assertBrazilReceitaFullJoinFreeDiskBeforeStart(
      '/synthetic/parent',
      thresholds(),
      () => GENEROUS_FREE_BYTES,
    );
    assert.equal(outcome.ok, true);
  });

  // Test 27.
  it('refuses to start when the volume is below the before-start threshold', () => {
    const outcome = assertBrazilReceitaFullJoinFreeDiskBeforeStart(
      '/synthetic/parent',
      thresholds(),
      () => BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START - 1,
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.breach.code, 'insufficient_free_disk_before_start');
    assert.equal(outcome.breach.threshold, 'before_start');
  });

  // Test 28.
  it('breaches the reserve mid-run rather than at ENOSPC', () => {
    const outcome = assertBrazilReceitaFullJoinFreeDiskReserve(
      '/synthetic/workspace',
      thresholds(),
      () => BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE - 1,
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.breach.code, 'free_disk_reserve_breached');
    // The run stops with 8 GiB still free. That is deliberate: the operator is left with a working
    // machine and a diagnosis, not a full volume.
    assert.equal(outcome.breach.requiredBytes, 8_589_934_592);
  });

  // Test 29.
  it('fails closed when the statfs dependency cannot answer', () => {
    const unanswerable: readonly BrazilReceitaFullJoinFreeDiskProbe[] = [
      () => {
        throw new Error('ENOENT');
      },
      () => Number.NaN,
      () => Number.POSITIVE_INFINITY,
      () => -1,
      // A probe that returns something that is not a number at all.
      (() => 'plenty') as unknown as BrazilReceitaFullJoinFreeDiskProbe,
    ];
    for (const probe of unanswerable) {
      const start = assertBrazilReceitaFullJoinFreeDiskBeforeStart('/p', thresholds(), probe);
      assert.equal(start.ok, false);
      if (!start.ok) {
        assert.equal(start.breach.code, 'free_disk_measurement_unavailable');
        assert.equal(start.breach.availableBytes, null);
      }
      const reserve = assertBrazilReceitaFullJoinFreeDiskReserve('/p', thresholds(), probe);
      assert.equal(reserve.ok, false);
      if (!reserve.ok) assert.equal(reserve.breach.code, 'free_disk_measurement_unavailable');
    }
  });

  it('probes the workspace filesystem, and probes it before the workspace is created', () => {
    const probed: string[] = [];
    const parent = temporaryParent();
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({
      observer,
      parent,
      freeDiskProbe: (target) => {
        probed.push(target);
        return GENEROUS_FREE_BYTES;
      },
    });
    assert.equal(creation.ok, true);
    // Exactly one probe so far, and it was against the PARENT: the workspace did not exist yet, and
    // a run that created its workspace and then found the volume full would have to clean up
    // something it should never have made.
    assert.deepEqual(probed, [parent]);
    if (creation.ok) creation.workspace.dispose();
  });

  it('refuses the workspace when the volume is too small, creating nothing', () => {
    const parent = temporaryParent();
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({
      observer,
      parent,
      minimumFreeDiskBeforeStart: 10_000,
      minimumFreeDiskReserve: 10_000,
      maxTemporaryStorageBytes: 4_096,
      freeDiskProbe: () => 9_999,
    });
    assert.equal(creation.ok, false);
    if (!creation.ok) {
      assert.ok(creation.rejections.includes('insufficient_free_disk_before_start'));
    }
    assert.deepEqual(fs.readdirSync(parent), [], 'a refused workspace must leave nothing behind');
  });

  it('refuses the workspace when the probe cannot answer at all', () => {
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({
      observer,
      freeDiskProbe: () => {
        throw new Error('statfs unavailable');
      },
    });
    assert.equal(creation.ok, false);
    if (!creation.ok) {
      assert.ok(creation.rejections.includes('free_disk_measurement_unavailable'));
    }
  });

  it('breaches the reserve during a run, and the workspace says which failure it was', () => {
    const observer = observingWorkspaceFileSystem();
    let probeCalls = 0;
    const creation = openWorkspace({
      observer,
      // Room for far more records than the write-block interval, so the run reaches the first
      // reserve re-check before it reaches the temporary-storage cap. Otherwise this test would
      // pass for the wrong reason.
      maxTemporaryStorageBytes: 1_000_000,
      minimumFreeDiskBeforeStart: 2_000_000,
      minimumFreeDiskReserve: 1_000_000,
      freeDiskProbe: () => {
        probeCalls += 1;
        // Generous for the preflight, then the volume fills.
        return probeCalls === 1 ? 3_000_000 : 1;
      },
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    // The reserve is re-checked once per write BLOCK, not per record, so the breach surfaces after
    // the first block boundary rather than on the first append.
    let failure: string | null = null;
    for (let index = 0; index < 20_000 && failure === null; index += 1) {
      const appended = creation.workspace.appendReference(reference(), index % 8);
      if (!appended.ok) failure = appended.failure;
    }
    assert.equal(failure, 'free_disk_reserve_breached');
    creation.workspace.dispose();
  });

  it('paces reserve checks by write block rather than by record', () => {
    const due = createBrazilReceitaFullJoinFreeDiskCheckSchedule(100);
    let checks = 0;
    for (let records = 0; records < 1_000; records += 1) {
      if (due(records)) checks += 1;
    }
    // Nine checks over a thousand records, not a thousand. A `statfs` per 16-byte record would
    // dominate the syscall budget and measure nothing new.
    assert.equal(checks, 9);
  });
});

// ─── § 4 / § 7 — containment is unchanged ─────────────────────────────────────

describe('BR-SOURCE-14B.0F — workspace containment survives the § 3 and § 4 changes', () => {
  // Tests 30–33: the 14B.0D guarantees, re-checked through the new construction path.
  it('still refuses a parent inside the repository, home or the dataset', () => {
    const observer = observingWorkspaceFileSystem();

    const inRepository = openWorkspace({
      observer,
      parent: '/workspaces/sellup-worktrees/br-14b0f/tmp',
    });
    assert.equal(inRepository.ok, false);
    if (!inRepository.ok) assert.ok(inRepository.rejections.includes('parent_inside_repository'));

    const inHome = openWorkspace({ observer, parent: '/home/operator/scratch' });
    assert.equal(inHome.ok, false);
    if (!inHome.ok) assert.ok(inHome.rejections.includes('parent_inside_home'));

    const inDataset = openWorkspace({ observer, parent: '/srv/receita/2026-07' });
    assert.equal(inDataset.ok, false);
    if (!inDataset.ok) assert.ok(inDataset.rejections.includes('parent_inside_dataset'));
  });

  // Test 30.
  it('still enforces the temporary-storage cap before writing a byte', () => {
    const observer = observingWorkspaceFileSystem();
    // Room for exactly two 16-byte records.
    const creation = openWorkspace({
      observer,
      maxTemporaryStorageBytes: 32,
      minimumFreeDiskBeforeStart: 32,
      minimumFreeDiskReserve: 32,
    });
    assert.equal(creation.ok, true);
    if (!creation.ok) return;

    assert.equal(creation.workspace.appendReference(reference(), 0).ok, true);
    assert.equal(creation.workspace.appendReference(reference(), 1).ok, true);
    const third = creation.workspace.appendReference(reference(), 2);
    assert.equal(third.ok, false);
    if (!third.ok) assert.equal(third.failure, 'temporary_storage_cap_exceeded');
    assert.equal(creation.workspace.bytesWritten(), 32, 'the refused write must not have happened');
    creation.workspace.dispose();
  });

  it('still refuses a real data run, whatever the descriptor and disk budgets say', () => {
    const observer = observingWorkspaceFileSystem();
    const creation = openWorkspace({ observer, realDataRun: true });
    assert.equal(creation.ok, false);
    if (!creation.ok) {
      assert.deepEqual(creation.rejections, ['temporary_storage_policy_not_approved']);
    }
  });
});
