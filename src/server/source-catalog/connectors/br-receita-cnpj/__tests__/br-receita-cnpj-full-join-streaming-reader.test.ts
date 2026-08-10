/**
 * BR Receita CNPJ BOUNDED SEQUENTIAL READER — tests (BR-SOURCE-14B.0D § 5, § 14 tests 1–10).
 *
 * The claim under test is the one that separates Model A from Model D: this reader ADVANCES. Before
 * 14B.0D every real-data reader in the join path performed one read from offset zero and stopped, so
 * the assertions that matter most here are the boring-looking ones — more than one chunk, strictly
 * increasing offsets, EOF reached, and every row recovered including one that straddles a chunk
 * boundary and one that has no trailing newline.
 *
 * Files are REAL files on a real disk under the OS temp root, because chunk boundaries, carry-over,
 * CRLF and a missing final terminator are properties of bytes rather than of strings. The failure
 * paths use an injected port instead, so a short read and a throwing read can be produced on demand.
 *
 * 100% synthetic and offline: no repository path, no operator home, no dataset, no real manifest, no
 * Supabase, no network, no git. Byte magnitudes are written as arithmetic so this file contains no
 * identifier-shaped digit run.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  createBrazilReceitaFullJoinFixture,
  brazilReceitaFullJoinSyntheticKey,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import { createBrazilReceitaFullJoinReaderFileSystem } from '../br-receita-cnpj-full-join-engine-fs';
import {
  BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
  BRAZIL_RECEITA_FULL_JOIN_READER_CAP_KEYS,
  fetchBrazilReceitaFullJoinRowByReference,
  readBrazilReceitaFullJoinFieldAt,
  readBrazilReceitaFullJoinFileSequentially,
  resolveBrazilReceitaFullJoinReaderCaps,
  type BrazilReceitaFullJoinReaderFileSystem,
  type BrazilReceitaFullJoinReaderResourceGuard,
} from '../br-receita-cnpj-full-join-streaming-reader';

// ─── Fixtures & helpers ───────────────────────────────────────────────────────

const OK = { ok: true } as const;

/** A guard that always permits. The envelope's own behaviour is 14B.0C's suite, not this one's. */
function permissiveGuard(): BrazilReceitaFullJoinReaderResourceGuard {
  return {
    mayAccessData: () => true,
    noteFileOpened: () => OK,
    noteBytesRead: () => OK,
    noteRowsRead: () => OK,
  };
}

function readerCaps(overrides: Record<string, number> = {}) {
  return {
    maxChunkBytes: 32,
    maxCarryBytes: 4 * 1024,
    maxRowBytes: 4 * 1024,
    maxColumnsPerRow: 64,
    ...overrides,
  };
}

let handles: BrazilReceitaFullJoinFixtureHandle[] = [];

function fixture(scenario: BrazilReceitaFullJoinFixtureScenario): BrazilReceitaFullJoinFixtureHandle {
  const handle = createBrazilReceitaFullJoinFixture(scenario);
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles) handle.dispose();
  handles = [];
});

function companyRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: brazilReceitaFullJoinSyntheticKey(index + 1),
  }));
}

/** Runs the reader over one fixture file and collects the join key of every row it yielded. */
function traverse(
  handle: BrazilReceitaFullJoinFixtureHandle,
  caps: Record<string, number> = readerCaps(),
) {
  const keys: string[] = [];
  const lengths: number[] = [];
  const outcome = readBrazilReceitaFullJoinFileSequentially({
    filePath: handle.sources[0]!.filePath,
    encoding: handle.sources[0]!.encoding,
    caps,
    fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    resourceGuard: permissiveGuard(),
    onRow: (row) => {
      keys.push(
        readBrazilReceitaFullJoinFieldAt(row.text, BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER, 0) ??
          '',
      );
      lengths.push(row.byteLength);
      return 'continue';
    },
  });
  return { outcome, keys, lengths };
}

// ─── 1. Cap resolution (test 40's before-open half) ───────────────────────────

describe('BR-SOURCE-14B.0D — reader caps', () => {
  it('names exactly the four buffer caps it owns, and none of the envelope caps', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_READER_CAP_KEYS, [
      'maxChunkBytes',
      'maxCarryBytes',
      'maxRowBytes',
      'maxColumnsPerRow',
    ]);
  });

  it('refuses an absent cap, reporting every missing key at once', () => {
    const resolution = resolveBrazilReceitaFullJoinReaderCaps(null);
    assert.equal(resolution.ok, false);
    if (resolution.ok) return;
    assert.equal(resolution.rejections.length, BRAZIL_RECEITA_FULL_JOIN_READER_CAP_KEYS.length);
    for (const rejection of resolution.rejections) assert.equal(rejection.reason, 'cap_absent');
  });

  it('refuses a non-finite, fractional, negative or zero cap', () => {
    for (const [value, reason] of [
      [Number.POSITIVE_INFINITY, 'cap_not_finite'],
      [1.5, 'cap_not_an_integer'],
      [-1, 'cap_not_positive'],
      [0, 'cap_not_positive'],
    ] as const) {
      const resolution = resolveBrazilReceitaFullJoinReaderCaps(
        readerCaps({ maxChunkBytes: value as number }),
      );
      assert.equal(resolution.ok, false);
      if (resolution.ok) return;
      assert.equal(resolution.rejections[0]?.key, 'maxChunkBytes');
      assert.equal(resolution.rejections[0]?.reason, reason);
    }
  });

  it('freezes the resolved cap set so nothing downstream can widen it', () => {
    const resolution = resolveBrazilReceitaFullJoinReaderCaps(readerCaps());
    assert.equal(resolution.ok, true);
    if (!resolution.ok) return;
    assert.ok(Object.isFrozen(resolution.caps));
  });

  // Test 40 (before-open half): a missing cap refuses BEFORE a descriptor could exist.
  it('refuses a missing cap before it opens anything', () => {
    let opened = 0;
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: 'irrelevant-because-nothing-opens',
      encoding: 'utf8',
      caps: { maxChunkBytes: 32 },
      fileSystem: {
        size: () => 1,
        open: () => {
          opened += 1;
          return 1;
        },
        read: () => 0,
        close: () => undefined,
      },
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'reader_cap_absent');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_FILE_OPEN');
    assert.equal(opened, 0, 'nothing may be opened when a cap is missing');
  });
});

// ─── 2. Traversal (tests 1–6) ─────────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — sequential traversal to EOF', () => {
  // Test 1 + test 2 + test 3.
  it('traverses multiple chunks, advances the offset, and terminates at EOF', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(12) }] });
    const { outcome, keys } = traverse(handle);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.ok(outcome.chunksRead > 1, `expected several chunks, got ${outcome.chunksRead}`);
    assert.ok(outcome.offsetProgression.length > 1);
    for (let index = 1; index < outcome.offsetProgression.length; index += 1) {
      assert.ok(
        outcome.offsetProgression[index]! > outcome.offsetProgression[index - 1]!,
        'every chunk boundary must be strictly beyond the previous one',
      );
    }
    assert.equal(outcome.reachedEndOfFile, true);
    assert.equal(outcome.finalOffset, outcome.declaredFileBytes);
    assert.equal(outcome.bytesRead, outcome.declaredFileBytes);
    assert.equal(outcome.rowsRead, 12);
    assert.deepEqual(keys, companyRows(12).map((row) => row.key));
  });

  // Test 4: a row wider than the chunk must survive the boundary intact.
  it('reassembles a row split across chunks', () => {
    const handle = fixture({
      files: [
        {
          family: 'empresas',
          rows: companyRows(6).map((row) => ({ ...row, padWidth: 40 })),
        },
      ],
    });
    const { outcome, keys } = traverse(handle, readerCaps({ maxChunkBytes: 16 }));
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.ok(outcome.peakCarryBytes > 0, 'a split row must have been carried');
    assert.equal(outcome.rowsRead, 6);
    assert.deepEqual(keys, companyRows(6).map((row) => row.key));
    assert.equal(outcome.reachedEndOfFile, true);
  });

  // Test 5.
  it('handles CRLF terminators without keeping the carriage return in the row', () => {
    const handle = fixture({
      files: [{ family: 'empresas', rows: companyRows(5), lineEnding: 'crlf' }],
    });
    const lf = fixture({ files: [{ family: 'empresas', rows: companyRows(5) }] });

    const crlfRun = traverse(handle);
    const lfRun = traverse(lf);
    assert.equal(crlfRun.outcome.ok, true);
    assert.deepEqual(crlfRun.keys, lfRun.keys);
    assert.deepEqual(
      crlfRun.lengths,
      lfRun.lengths,
      'a CRLF row and an LF row have the same CONTENT length',
    );
  });

  // Test 6: the official files' last row may have no terminator.
  it('reads a final row that has no trailing newline', () => {
    const withNewline = fixture({ files: [{ family: 'empresas', rows: companyRows(4) }] });
    const withoutNewline = fixture({
      files: [{ family: 'empresas', rows: companyRows(4), trailingNewline: false }],
    });

    const complete = traverse(withNewline);
    const truncated = traverse(withoutNewline);
    assert.equal(truncated.outcome.ok, true);
    if (!truncated.outcome.ok) return;
    assert.equal(truncated.outcome.rowsRead, 4, 'the last row must not be dropped');
    assert.deepEqual(truncated.keys, complete.keys);
    assert.equal(truncated.outcome.reachedEndOfFile, true);
  });

  it('reads latin1 and utf8 through the same path', () => {
    for (const encoding of ['latin1', 'utf8'] as const) {
      const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(3), encoding }] });
      const { outcome, keys } = traverse(handle);
      assert.equal(outcome.ok, true);
      assert.deepEqual(keys, companyRows(3).map((row) => row.key));
    }
  });

  it('refuses an encoding it cannot decode, before opening anything', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(2) }] });
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: handle.sources[0]!.filePath,
      encoding: 'utf16le',
      caps: readerCaps(),
      fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'reader_encoding_not_supported');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_FILE_OPEN');
  });

  it('stops cleanly when the visitor asks it to, without claiming EOF', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(10) }] });
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: handle.sources[0]!.filePath,
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      resourceGuard: permissiveGuard(),
      onRow: (row) => (row.rowOrdinal >= 3 ? 'stop' : 'continue'),
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.stoppedByVisitor, true);
    assert.equal(outcome.reachedEndOfFile, false, 'a visitor stop is not an EOF');
    assert.equal(outcome.rowsRead, 3);
  });
});

// ─── 3. Failure paths (tests 7–10) ────────────────────────────────────────────

/** A scripted port, so a short read, a throwing read and a throwing close are all producible. */
function scriptedPort(script: {
  size: number;
  reads: ReadonlyArray<number | 'throw'>;
  closeThrows?: boolean;
  content?: Buffer;
}): { port: BrazilReceitaFullJoinReaderFileSystem; closes: () => number } {
  let index = 0;
  let closes = 0;
  return {
    port: {
      size: () => script.size,
      open: () => 7,
      read: (_handle, buffer, bufferOffset, length, position) => {
        const step = script.reads[index] ?? 0;
        index += 1;
        if (step === 'throw') throw new Error('scripted read failure');
        if (script.content !== undefined) {
          const slice = script.content.subarray(position, position + Math.min(length, step));
          slice.copy(buffer, bufferOffset);
          return slice.length;
        }
        return step;
      },
      close: () => {
        closes += 1;
        if (script.closeThrows === true) throw new Error('scripted close failure');
      },
    },
    closes: () => closes,
  };
}

describe('BR-SOURCE-14B.0D — reader failure paths', () => {
  // Test 7.
  it('rejects an oversized row', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(3) }] });
    const { outcome } = traverse(handle, readerCaps({ maxChunkBytes: 512, maxRowBytes: 8 }));
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'row_bytes_cap_exceeded');
    assert.equal(outcome.handleClosed, true);
  });

  // Test 8: the carry cap is independent of the row cap, and fires on the partial tail.
  it('rejects an oversized carry', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(3) }] });
    // A chunk narrower than one row means the first chunk contains no terminator at all, so the
    // whole chunk becomes carry — and the carry cap, not the row cap, is what must fire.
    const { outcome } = traverse(
      handle,
      readerCaps({ maxChunkBytes: 32, maxCarryBytes: 4, maxRowBytes: 4 * 1024 }),
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'carry_bytes_cap_exceeded');
    assert.equal(outcome.handleClosed, true);
  });

  it('rejects a row with more columns than the cap allows', () => {
    const handle = fixture({ files: [{ family: 'estabelecimentos', rows: companyRows(2) }] });
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: handle.sources[0]!.filePath,
      encoding: 'utf8',
      caps: readerCaps({ maxChunkBytes: 1024, maxColumnsPerRow: 4 }),
      fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'columns_cap_exceeded');
  });

  // Test 9: the hang, caught. Bytes remain and the read produced none.
  it('rejects a non-progressing read instead of looping forever', () => {
    const scripted = scriptedPort({ size: 1024, reads: [0] });
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: 'scripted',
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: scripted.port,
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'non_progressing_reader');
    assert.equal(outcome.handleClosed, true);
    assert.equal(scripted.closes(), 1);
  });

  it('performs no retry after a non-progressing read', () => {
    let reads = 0;
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: 'scripted',
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: {
        size: () => 1024,
        open: () => 7,
        read: () => {
          reads += 1;
          return 0;
        },
        close: () => undefined,
      },
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    assert.equal(reads, 1, 'a short read is terminal; a second attempt would spend the same bytes');
  });

  // Test 10.
  it('closes the handle when the read throws', () => {
    const scripted = scriptedPort({ size: 1024, reads: ['throw'] });
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: 'scripted',
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: scripted.port,
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'file_read_failed');
    assert.equal(outcome.handleClosed, true);
    assert.equal(scripted.closes(), 1, 'the descriptor must be released on the failure path');
  });

  it('reports a failing close rather than swallowing it', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(2) }] });
    const real = createBrazilReceitaFullJoinReaderFileSystem();
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: handle.sources[0]!.filePath,
      encoding: 'utf8',
      caps: readerCaps({ maxChunkBytes: 1024 }),
      fileSystem: {
        ...real,
        close: () => {
          throw new Error('scripted close failure');
        },
      },
      resourceGuard: permissiveGuard(),
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'file_close_failed');
  });

  it('refuses to read when the resource envelope already refuses access', () => {
    let opened = 0;
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: 'scripted',
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: {
        size: () => 32,
        open: () => {
          opened += 1;
          return 7;
        },
        read: () => 0,
        close: () => undefined,
      },
      resourceGuard: { ...permissiveGuard(), mayAccessData: () => false },
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'resource_envelope_breached');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_FILE_OPEN');
    assert.equal(opened, 0);
  });

  it('stops when a counter refuses mid-file, and closes the handle', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(20) }] });
    let rows = 0;
    const outcome = readBrazilReceitaFullJoinFileSequentially({
      filePath: handle.sources[0]!.filePath,
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      resourceGuard: {
        ...permissiveGuard(),
        noteRowsRead: () => {
          rows += 1;
          return rows > 3 ? { ok: false } : OK;
        },
      },
      onRow: () => 'continue',
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'resource_envelope_breached');
    assert.equal(outcome.handleClosed, true);
  });
});

// ─── 4. Reference re-read ─────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — re-reading a row by opaque reference', () => {
  it('recovers exactly the row a traversal recorded', () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(8) }] });
    const references: Array<{ byteOffset: number; byteLength: number; key: string }> = [];
    const traversal = readBrazilReceitaFullJoinFileSequentially({
      filePath: handle.sources[0]!.filePath,
      encoding: 'utf8',
      caps: readerCaps(),
      fileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      resourceGuard: permissiveGuard(),
      onRow: (row) => {
        references.push({
          byteOffset: row.byteOffset,
          byteLength: row.byteLength,
          key:
            readBrazilReceitaFullJoinFieldAt(
              row.text,
              BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
              0,
            ) ?? '',
        });
        return 'continue';
      },
    });
    assert.equal(traversal.ok, true);

    const port = createBrazilReceitaFullJoinReaderFileSystem();
    const openHandle = port.open(handle.sources[0]!.filePath);
    const buffer = Buffer.alloc(4 * 1024);
    try {
      for (const reference of references) {
        const fetched = fetchBrazilReceitaFullJoinRowByReference({
          handle: openHandle,
          byteOffset: reference.byteOffset,
          byteLength: reference.byteLength,
          encoding: 'utf8',
          buffer,
          fileSystem: port,
          resourceGuard: permissiveGuard(),
        });
        assert.equal(fetched.ok, true);
        if (!fetched.ok) return;
        assert.equal(
          readBrazilReceitaFullJoinFieldAt(
            fetched.text,
            BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
            0,
          ),
          reference.key,
        );
      }
    } finally {
      port.close(openHandle);
    }
  });

  it('treats a row that does not fit the caller buffer as a row-cap breach', () => {
    const port = createBrazilReceitaFullJoinReaderFileSystem();
    const outcome = fetchBrazilReceitaFullJoinRowByReference({
      handle: 7,
      byteOffset: 0,
      byteLength: 64,
      encoding: 'utf8',
      buffer: Buffer.alloc(8),
      fileSystem: { ...port, read: () => 64 },
      resourceGuard: permissiveGuard(),
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'row_bytes_cap_exceeded');
  });
});

// ─── 5. Field access ──────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — quote-aware field access', () => {
  it('returns the requested field and null past the end', () => {
    const line = 'A;B;C';
    assert.equal(readBrazilReceitaFullJoinFieldAt(line, ';', 0), 'A');
    assert.equal(readBrazilReceitaFullJoinFieldAt(line, ';', 2), 'C');
    assert.equal(readBrazilReceitaFullJoinFieldAt(line, ';', 3), null);
    assert.equal(readBrazilReceitaFullJoinFieldAt(line, ';', -1), null);
  });

  it('does not treat a delimiter inside a quoted field as a separator', () => {
    assert.equal(readBrazilReceitaFullJoinFieldAt('"A;B";C', ';', 0), '"A;B"');
    assert.equal(readBrazilReceitaFullJoinFieldAt('"A;B";C', ';', 1), 'C');
  });
});
