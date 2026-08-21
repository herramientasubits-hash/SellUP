/**
 * BR Receita CNPJ FULL JOIN — EXTERNAL-MEMORY ENVELOPE (BR-SOURCE external-memory closure).
 *
 * Attempt #2 died on ONE cap: `maxExternalMemoryBytes`, 67,725,759 observed against 67,108,864
 * allowed, 9.7 s into `empresas_reference_pass` — having read 0.92 % of the volume, so it produced
 * no throughput evidence and spent the attempt anyway. Root-cause profiling over a SYNTHETIC
 * reproduction of that failure found the peak was NOT the working set. It was garbage:
 *
 *   - the reader rebuilt "carry + chunk" with `Buffer.concat` on every iteration whose predecessor
 *     left a partial row (at official row widths, nearly every iteration), allocating a fresh
 *     ~4 MiB ArrayBuffer per chunk — 88 MiB of transient bytes against a ~12 MiB live set;
 *   - the append path allocated a 16-byte record per reference only to copy it into a partition
 *     buffer and drop it;
 *   - every flush retired an 8 KiB partition buffer that the next append immediately re-allocated;
 *   - the join stage allocated a read-back buffer per partition slice.
 *
 * `process.memoryUsage().external` counts bytes the GC has not yet reclaimed, so those four sites
 * made the cap a race against collection rather than a statement about the engine's footprint.
 *
 * These tests pin the fix at the level the bug lived at — ALLOCATION COUNT, not just peak bytes —
 * because a peak-only assertion passes on a slower machine that happens to collect in time. The
 * invariant is that per-chunk and per-reference work allocates NOTHING.
 *
 * 100 % synthetic and offline: no real Receita file, no manifest, no dataset root, no Supabase, no
 * provider, no network. Executes no real benchmark and authorizes none.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../br-receita-cnpj-full-join-open-handle-ledger';
import {
  createBrazilReceitaFullJoinPartitionWorkspace,
  decodeBrazilReceitaFullJoinRowReference,
  encodeBrazilReceitaFullJoinRowReference,
  encodeBrazilReceitaFullJoinRowReferenceInto,
  validateBrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinRowReference,
} from '../br-receita-cnpj-full-join-partition-workspace';
import {
  readBrazilReceitaFullJoinFileSequentially,
  type BrazilReceitaFullJoinReaderResourceGuard,
} from '../br-receita-cnpj-full-join-streaming-reader';

// ─── Allocation instrumentation ───────────────────────────────────────────────

interface AllocationTally {
  count: number;
  bytes: number;
}

/**
 * Counts every Buffer allocation made while `body` runs.
 *
 * Wrapping the constructors is the only way to observe the thing that actually broke: `external` is
 * a sampled aggregate that depends on when the GC last ran, whereas an allocation COUNT is exact
 * and machine-independent. Restored in `finally` so one test can never leak instrumentation into
 * the next.
 */
function tallyAllocations<T>(body: () => T): { readonly result: T; readonly tally: AllocationTally } {
  const tally: AllocationTally = { count: 0, bytes: 0 };
  const realAlloc = Buffer.alloc;
  const realAllocUnsafe = Buffer.allocUnsafe;
  const realConcat = Buffer.concat;
  const realFrom = Buffer.from;

  const note = (bytes: number): void => {
    if (Number.isFinite(bytes) && bytes > 0) {
      tally.count += 1;
      tally.bytes += bytes;
    }
  };

  try {
    Buffer.alloc = ((size: number, ...rest: unknown[]) => {
      note(size);
      return (realAlloc as (...args: unknown[]) => Buffer)(size, ...rest);
    }) as typeof Buffer.alloc;
    Buffer.allocUnsafe = ((size: number) => {
      note(size);
      return realAllocUnsafe(size);
    }) as typeof Buffer.allocUnsafe;
    Buffer.concat = ((list: readonly Uint8Array[], total?: number) => {
      let bytes = total;
      if (bytes === undefined) {
        bytes = 0;
        for (const item of list) bytes += item.length;
      }
      note(bytes);
      return realConcat(list as Uint8Array[], total);
    }) as typeof Buffer.concat;
    Buffer.from = ((...args: unknown[]) => {
      const value = args[0];
      if (typeof value === 'string') note(Buffer.byteLength(value, args[1] as BufferEncoding));
      else if (value != null && typeof (value as { length?: unknown }).length === 'number') {
        note((value as { length: number }).length);
      }
      return (realFrom as (...a: unknown[]) => Buffer)(...args);
    }) as typeof Buffer.from;

    return { result: body(), tally };
  } finally {
    Buffer.alloc = realAlloc;
    Buffer.allocUnsafe = realAllocUnsafe;
    Buffer.concat = realConcat;
    Buffer.from = realFrom;
  }
}

// ─── Synthetic source files ───────────────────────────────────────────────────

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'brfj-extmem-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) fs.rmSync(directory, { recursive: true, force: true });
  }
});

const OK = { ok: true } as const;

function permissiveGuard(): BrazilReceitaFullJoinReaderResourceGuard {
  return {
    mayAccessData: () => true,
    noteFileOpened: () => OK,
    noteBytesRead: () => OK,
    noteRowsRead: () => OK,
  };
}

function readerCaps(maxChunkBytes: number) {
  return {
    maxChunkBytes,
    maxCarryBytes: 4 * 1024,
    maxRowBytes: 4 * 1024,
    maxColumnsPerRow: 64,
  };
}

/**
 * Writes `rowCount` rows of a width that does NOT divide the chunk size, so nearly every chunk
 * boundary lands mid-row and the carry path is exercised on essentially every iteration — which is
 * precisely the condition under which the old reader allocated per chunk.
 */
function writeStraddlingRows(rowCount: number, columns: number): { filePath: string; rows: string[] } {
  const directory = makeTemporaryDirectory();
  const filePath = path.join(directory, 'source.csv');
  const rows: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    // A width that varies with the row keeps boundaries from ever synchronising with the chunk size.
    const filler = 'x'.repeat(7 + (index % 11));
    const fields = [`k${index}`, filler];
    while (fields.length < columns) fields.push(String(index % 97));
    rows.push(fields.join(';'));
  }
  fs.writeFileSync(filePath, `${rows.join('\n')}\n`, 'utf8');
  return { filePath, rows };
}

function readAllRows(filePath: string, maxChunkBytes: number) {
  const seen: string[] = [];
  const outcome = readBrazilReceitaFullJoinFileSequentially({
    filePath,
    encoding: 'utf8',
    caps: readerCaps(maxChunkBytes),
    fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    resourceGuard: permissiveGuard(),
    onRow: (row) => {
      seen.push(row.text);
      return 'continue';
    },
  });
  return { outcome, seen };
}

// ─── 1. The reader allocates nothing per chunk ────────────────────────────────

describe('BR-SOURCE external-memory — the reader allocates nothing per chunk', () => {
  it('allocates the same bytes whether it reads few chunks or many', () => {
    // The SAME chunk cap for both, so the only thing that differs is how many times the loop runs:
    // the larger file is ~16x the rows and therefore ~16x the chunks. Holding `maxChunkBytes` fixed
    // is what makes this a statement about chunk COUNT rather than about buffer SIZE.
    const chunk = 512;
    const small = writeStraddlingRows(250, 8);
    const large = writeStraddlingRows(4_000, 8);
    assert.ok(
      fs.statSync(large.filePath).size > fs.statSync(small.filePath).size * 8,
      'the two files must differ enough for the chunk counts to differ',
    );

    const fewChunks = tallyAllocations(() => readAllRows(small.filePath, chunk)).tally;
    const manyChunks = tallyAllocations(() => readAllRows(large.filePath, chunk)).tally;

    assert.equal(fewChunks.bytes, manyChunks.bytes, 'allocation must not scale with the chunk count');
    assert.equal(fewChunks.count, manyChunks.count, 'no allocation may happen per chunk');
  });

  it('allocates exactly one buffer for a whole file, sized from the caps', () => {
    const { filePath } = writeStraddlingRows(4_000, 8);
    const chunk = 512;
    const { tally } = tallyAllocations(() => readAllRows(filePath, chunk));

    assert.equal(tally.count, 1, 'the read buffer is the only allocation the reader makes');
    assert.equal(
      tally.bytes,
      readerCaps(chunk).maxCarryBytes + chunk,
      'and it is sized from the caps, never from the file',
    );
  });

  it('recovers every row identically no matter where the chunk boundaries fall', () => {
    const { filePath, rows } = writeStraddlingRows(500, 8);
    const size = fs.statSync(filePath).size;
    const whole = readAllRows(filePath, size);
    assert.equal(whole.outcome.ok, true);
    assert.deepEqual(whole.seen, rows);

    // Every one of these puts the boundaries somewhere different relative to the row widths.
    for (const chunk of [17, 31, 64, 100, 511, 1_024, 4_096]) {
      const partial = readAllRows(filePath, chunk);
      assert.equal(partial.outcome.ok, true, `chunk ${chunk} must succeed`);
      assert.deepEqual(partial.seen, rows, `chunk ${chunk} must recover identical rows`);
    }
  });

  it('still recovers a final row that has no trailing newline', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'source.csv');
    const rows = ['a;1;2', 'b;3;4', 'c;5;6'];
    fs.writeFileSync(filePath, rows.join('\n'), 'utf8');

    for (const chunk of [3, 7, 16, 4_096]) {
      const { outcome, seen } = readAllRows(filePath, chunk);
      assert.equal(outcome.ok, true);
      assert.deepEqual(seen, rows, `chunk ${chunk} must keep the unterminated final row`);
    }
  });

  it('still strips CRLF when the terminator itself straddles a boundary', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'source.csv');
    const rows = ['a;1', 'bb;22', 'ccc;333'];
    fs.writeFileSync(filePath, `${rows.join('\r\n')}\r\n`, 'utf8');

    for (const chunk of [2, 3, 5, 8, 4_096]) {
      const { outcome, seen } = readAllRows(filePath, chunk);
      assert.equal(outcome.ok, true);
      assert.deepEqual(seen, rows, `chunk ${chunk} must exclude both CR and LF`);
    }
  });

  it('still refuses a partial row larger than the carry cap', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'source.csv');
    // One unterminated row far wider than the carry cap below.
    fs.writeFileSync(filePath, `${'y'.repeat(8_192)}\n`, 'utf8');

    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath,
      encoding: 'utf8',
      caps: { maxChunkBytes: 64, maxCarryBytes: 128, maxRowBytes: 4 * 1024, maxColumnsPerRow: 64 },
      fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.abortCode, 'carry_bytes_cap_exceeded');
  });
});

// ─── 2. The append path allocates nothing per reference ───────────────────────

function reference(
  overrides: Partial<BrazilReceitaFullJoinRowReference> = {},
): BrazilReceitaFullJoinRowReference {
  return { sourceFileOrdinal: 1, byteOffset: 64, byteLength: 32, family: 'empresas', ...overrides };
}

function openWorkspace() {
  const parent = makeTemporaryDirectory();
  const creation = createBrazilReceitaFullJoinPartitionWorkspace({
    parentDirectory: parent,
    boundaries: {
      repositoryRoot: path.join(parent, 'never-a-real-repository'),
      homeDirectory: path.join(parent, 'never-a-real-home'),
      datasetRoot: null,
    },
    fileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    // The resolver's own relations: `reserve <= beforeStart` and `reserve >= storageCap`.
    maxTemporaryStorageBytes: 1024 * 1024,
    maxOpenPartitionFiles: 32,
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(64),
    minimumFreeDiskBeforeStart: 4 * 1024 * 1024,
    minimumFreeDiskReserve: 2 * 1024 * 1024,
    freeDiskProbe: () => 64 * 1024 * 1024 * 1024,
    realDataRun: false,
  });
  assert.equal(creation.ok, true, `workspace must open: ${JSON.stringify(creation)}`);
  if (!creation.ok) throw new Error('unreachable');
  return creation.workspace;
}

describe('BR-SOURCE external-memory — the append path allocates nothing per reference', () => {
  it('allocates per PARTITION, not per reference', () => {
    const partitions = 8;
    const workspace = openWorkspace();
    try {
      // Warm every partition first, so the tally below sees only steady-state appends.
      for (let ordinal = 0; ordinal < partitions; ordinal += 1) {
        assert.equal(workspace.appendReference(reference({ byteOffset: 16 }), ordinal).ok, true);
      }

      const appends = 20_000;
      const { tally } = tallyAllocations(() => {
        for (let index = 0; index < appends; index += 1) {
          const appended = workspace.appendReference(
            reference({ byteOffset: 16 + index * 8 }),
            index % partitions,
          );
          assert.equal(appended.ok, true);
        }
      });

      // Recycling means a flush hands its buffer to the next partition that needs one, so the
      // steady state allocates nothing at all. The bound is stated in terms of PARTITIONS so the
      // assertion says what it means: allocation is bounded by the map's width, never by traffic.
      assert.ok(
        tally.count <= partitions,
        `expected at most ${partitions} allocations for ${appends} appends, saw ${tally.count}`,
      );
    } finally {
      workspace.dispose();
    }
  });

  it('round-trips every reference exactly, so buffer reuse cannot corrupt a record', () => {
    const partitions = 4;
    const workspace = openWorkspace();
    try {
      // Enough references per partition to force many buffer fills, flushes and recycles.
      const perPartition = 900;
      const expected = new Map<number, BrazilReceitaFullJoinRowReference[]>();
      for (let ordinal = 0; ordinal < partitions; ordinal += 1) expected.set(ordinal, []);

      for (let index = 0; index < perPartition * partitions; index += 1) {
        const ordinal = index % partitions;
        const written = reference({
          sourceFileOrdinal: (index % 5) + 1,
          byteOffset: 16 + index * 13,
          byteLength: 1 + (index % 251),
          family: 'empresas',
        });
        assert.equal(workspace.appendReference(written, ordinal).ok, true);
        expected.get(ordinal)?.push(written);
      }

      for (let ordinal = 0; ordinal < partitions; ordinal += 1) {
        const wanted = expected.get(ordinal) ?? [];
        const seen: BrazilReceitaFullJoinRowReference[] = [];
        let cursor = 0;
        for (;;) {
          const slice = workspace.readPartitionSlice('empresas', ordinal, cursor, 128);
          assert.equal(slice.ok, true);
          if (!slice.ok) break;
          seen.push(...slice.references);
          cursor = slice.nextRecordIndex;
          if (slice.exhausted) break;
        }
        assert.deepEqual(seen, wanted, `partition ${ordinal} must read back exactly what it stored`);
      }
    } finally {
      workspace.dispose();
    }
  });

  it('reads partition slices back without allocating per slice', () => {
    const workspace = openWorkspace();
    try {
      for (let index = 0; index < 4_000; index += 1) {
        assert.equal(workspace.appendReference(reference({ byteOffset: 16 + index * 8 }), 0).ok, true);
      }
      // First slice may size the reusable buffer; everything after it must allocate nothing.
      const first = workspace.readPartitionSlice('empresas', 0, 0, 128);
      assert.equal(first.ok, true);

      const { tally } = tallyAllocations(() => {
        let cursor = 0;
        for (;;) {
          const slice = workspace.readPartitionSlice('empresas', 0, cursor, 128);
          assert.equal(slice.ok, true);
          if (!slice.ok || slice.exhausted) break;
          cursor = slice.nextRecordIndex;
        }
      });
      assert.equal(tally.count, 0, 'the read-back buffer must be reused across slices');
    } finally {
      workspace.dispose();
    }
  });
});

// ─── 3. The in-place codec is the allocating codec, byte for byte ─────────────

describe('BR-SOURCE external-memory — in-place encoding is byte-identical', () => {
  const cases: BrazilReceitaFullJoinRowReference[] = [
    reference(),
    reference({ family: 'estabelecimentos' }),
    reference({ sourceFileOrdinal: 0, byteOffset: 0 + 1, byteLength: 1 }),
    reference({ sourceFileOrdinal: 4_294_967_295, byteOffset: 281_474_976_710_655, byteLength: 4_294_967_295 }),
  ];

  it('writes the same sixteen bytes the allocating encoder produces', () => {
    for (const candidate of cases) {
      const allocated = encodeBrazilReceitaFullJoinRowReference(candidate);
      assert.equal(allocated.ok, true);
      if (!allocated.ok) continue;

      // Pre-dirtied, so a codec that left a byte untouched would differ from the zeroed original.
      const target = Buffer.alloc(64, 0xab);
      const written = encodeBrazilReceitaFullJoinRowReferenceInto(target, 16, candidate);
      assert.equal(written.ok, true);
      assert.deepEqual(target.subarray(16, 32), allocated.record);
    }
  });

  it('decodes back to the reference it was given', () => {
    for (const candidate of cases) {
      const target = Buffer.alloc(32, 0xcd);
      assert.equal(encodeBrazilReceitaFullJoinRowReferenceInto(target, 8, candidate).ok, true);
      const decoded = decodeBrazilReceitaFullJoinRowReference(target, 8);
      assert.equal(decoded.ok, true);
      if (decoded.ok) assert.deepEqual(decoded.reference, candidate);
    }
  });

  it('refuses a write that would run past the end of the target', () => {
    const target = Buffer.alloc(16);
    const written = encodeBrazilReceitaFullJoinRowReferenceInto(target, 1, reference());
    assert.equal(written.ok, false);
    if (!written.ok) assert.equal(written.failure, 'record_truncated');
  });

  it('rejects exactly what the allocating encoder rejects', () => {
    const rejected: readonly [BrazilReceitaFullJoinRowReference, string][] = [
      [reference({ sourceFileOrdinal: -1 }), 'ordinal_out_of_range'],
      [reference({ byteOffset: -1 }), 'offset_out_of_range'],
      [reference({ byteLength: 0 }), 'length_out_of_range'],
      [reference({ family: 'socios' as never }), 'family_unknown'],
    ];
    for (const [candidate, failure] of rejected) {
      const allocated = encodeBrazilReceitaFullJoinRowReference(candidate);
      const inPlace = encodeBrazilReceitaFullJoinRowReferenceInto(Buffer.alloc(16), 0, candidate);
      const validated = validateBrazilReceitaFullJoinRowReference(candidate);
      assert.equal(allocated.ok, false);
      assert.equal(inPlace.ok, false);
      assert.equal(validated.ok, false);
      if (!allocated.ok) assert.equal(allocated.failure, failure);
      if (!inPlace.ok) assert.equal(inPlace.failure, failure);
      if (!validated.ok) assert.equal(validated.failure, failure);
    }
  });

  it('leaves the bytes around the record untouched', () => {
    const target = Buffer.alloc(48, 0x5a);
    assert.equal(encodeBrazilReceitaFullJoinRowReferenceInto(target, 16, reference()).ok, true);
    assert.ok(target.subarray(0, 16).every((byte) => byte === 0x5a), 'bytes before must be intact');
    assert.ok(target.subarray(32).every((byte) => byte === 0x5a), 'bytes after must be intact');
  });
});
