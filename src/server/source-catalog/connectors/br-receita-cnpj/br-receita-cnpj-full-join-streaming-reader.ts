/**
 * BR Receita CNPJ — BOUNDED SEQUENTIAL FILE READER (BR-SOURCE-14B.0D § 5).
 *
 * The single most important difference between Model D and Model A lives in this file.
 *
 * Every real-data reader in the join path before this milestone performed ONE bounded read from
 * byte offset zero into a pre-allocated buffer and never advanced a file position: 11F and 11H stop
 * at a fixed prefix, 11G stops at 64 KiB, 11I stops at 512 KiB. That is not a small reader — it is a
 * reader that cannot, structurally, observe a second byte of a file. This module is the first one in
 * the connector that ADVANCES: it opens a file once, walks it chunk by chunk, preserves a row split
 * across a chunk boundary, and terminates at EOF rather than at a prefix ceiling.
 *
 * The three probes are deliberately left untouched. They remain valid, separately-authorized,
 * narrower carve-outs; this module does not replace them and does not widen them. It is a NEW
 * capability whose bound is memory, not file length.
 *
 * ── Bounded means bounded in MEMORY, not in COVERAGE ────────────────────────────
 * The distinction this module exists to make: a reader may read every byte of a 60 GB file and still
 * be bounded, provided the amount of memory it holds at any instant is capped and independent of the
 * file's length. So the caps here are all per-instant caps —
 *
 *   `maxChunkBytes`      the per-read span of the read buffer, allocated ONCE and reused;
 *   `maxCarryBytes`      the partial row kept across a chunk boundary, held as that same
 *                        buffer's prefix so joining it to the next chunk allocates nothing;
 *   `maxRowBytes`        one row's content;
 *   `maxColumnsPerRow`   one row's field count;
 *
 * — and none of them is a coverage cap. The coverage-shaped caps (`maxBytesRead`, `maxRowsRead`)
 * belong to the 14B.0C resource envelope, which is passed in and is the ONLY authority on them. This
 * module does not define, duplicate, default or widen a single envelope cap.
 *
 * ── Absent is not unlimited ─────────────────────────────────────────────────────
 * All four reader caps are REQUIRED. A missing, null, non-finite, negative, fractional or zero cap
 * is a refusal, and the refusal is reported as `ABORT_BEFORE_FILE_OPEN`: it happens before `open`,
 * so an under-specified read never reaches a descriptor. This mirrors 14B.0C's cap policy exactly,
 * because the failure it prevents is the same one.
 *
 * ── Progress is asserted, not assumed ───────────────────────────────────────────
 * A streaming loop that fails to advance does not read a prefix — it hangs. So EOF is decided
 * against the file's declared size, and a read that returns nothing while bytes remain is
 * `non_progressing_reader`, a terminal abort. There is no retry: a short read that returned nothing
 * once will return nothing again, and 14B.0C's retry count is structurally zero.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - calls `readFile`, `readFileSync` or any equivalent that materializes a whole file. It cannot:
 *     it has no `node:fs` import at all, and every byte it touches arrives through the injected
 *     port, whose read is bounded by the pre-allocated buffer.
 *   - retains a row. A row is decoded, handed to the visitor, and out of scope on the next
 *     iteration. Nothing derived from it survives in this module except counts and offsets.
 *   - emits a row, a cell, a join key or a path. It returns counts, byte offsets and byte lengths.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - spawns a process, reads an environment variable, or writes to stdout or stderr.
 */

import { countBrReceitaCnpjDelimitedColumns } from './br-receita-cnpj-file-reader';

// ─── Version ──────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_STREAMING_READER_VERSION = 1 as const;

/** The official Receita delimiter. Not configurable: the layout is not a preference. */
export const BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER = ';' as const;

/** The abort marker for a refusal raised before any descriptor exists. */
export const BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN =
  'ABORT_BEFORE_FILE_OPEN' as const;

/** The abort marker for a refusal raised once a descriptor was already open. */
export const BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ = 'ABORT_DURING_READ' as const;

export type BrazilReceitaFullJoinReaderAbortStage =
  | typeof BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN
  | typeof BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ;

// ─── Encodings ────────────────────────────────────────────────────────────────

/**
 * The two encodings the official files ship in. `latin1` is the real one; `utf8` exists because
 * synthetic fixtures are written as UTF-8 and a reader that could only decode one of them would be
 * untestable without a real dataset.
 */
export const BRAZIL_RECEITA_FULL_JOIN_READER_ENCODINGS = ['latin1', 'utf8'] as const;

export type BrazilReceitaFullJoinReaderEncoding =
  (typeof BRAZIL_RECEITA_FULL_JOIN_READER_ENCODINGS)[number];

function isSupportedEncoding(value: unknown): value is BrazilReceitaFullJoinReaderEncoding {
  return (
    typeof value === 'string' &&
    (BRAZIL_RECEITA_FULL_JOIN_READER_ENCODINGS as readonly string[]).includes(value)
  );
}

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * The closed set of READER cap keys.
 *
 * These four are deliberately NOT in `BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS`. The resource
 * envelope performs no I/O by design and must stay that way, so a buffer size has no business in
 * it; and a second copy of an envelope cap would be a second authority on the same bound, which is
 * how two caps come to disagree. The split is: the envelope bounds the RUN, this module bounds the
 * BUFFER.
 */
export const BRAZIL_RECEITA_FULL_JOIN_READER_CAP_KEYS = [
  'maxChunkBytes',
  'maxCarryBytes',
  'maxRowBytes',
  'maxColumnsPerRow',
] as const;

export type BrazilReceitaFullJoinReaderCapKey =
  (typeof BRAZIL_RECEITA_FULL_JOIN_READER_CAP_KEYS)[number];

export type BrazilReceitaFullJoinReaderCaps = Readonly<
  Record<BrazilReceitaFullJoinReaderCapKey, number>
>;

export type BrazilReceitaFullJoinReaderCapRejectionReason =
  | 'cap_absent'
  | 'cap_not_a_number'
  | 'cap_not_finite'
  | 'cap_not_an_integer'
  | 'cap_not_positive';

export interface BrazilReceitaFullJoinReaderCapRejection {
  readonly key: BrazilReceitaFullJoinReaderCapKey;
  readonly reason: BrazilReceitaFullJoinReaderCapRejectionReason;
}

export type BrazilReceitaFullJoinReaderCapResolution =
  | { readonly ok: true; readonly caps: BrazilReceitaFullJoinReaderCaps }
  | { readonly ok: false; readonly rejections: readonly BrazilReceitaFullJoinReaderCapRejection[] };

/**
 * Resolves an untrusted reader cap record into a complete, frozen cap set, or refuses.
 *
 * Every key is checked and every rejection reported, so a caller completing a cap set learns about
 * all of them in one refusal. Zero is refused here — unlike in the envelope, where `0` is a
 * meaningful authorization ("you may not use temporary storage at all"). A zero-byte read buffer is
 * not a stricter reader, it is a reader that cannot advance, and `maxColumnsPerRow: 0` would reject
 * every row in a well-formed file.
 */
export function resolveBrazilReceitaFullJoinReaderCaps(
  input: Readonly<Partial<Record<BrazilReceitaFullJoinReaderCapKey, unknown>>> | null | undefined,
): BrazilReceitaFullJoinReaderCapResolution {
  const rejections: BrazilReceitaFullJoinReaderCapRejection[] = [];
  const resolved = {} as Record<BrazilReceitaFullJoinReaderCapKey, number>;

  for (const key of BRAZIL_RECEITA_FULL_JOIN_READER_CAP_KEYS) {
    const raw = input?.[key];
    if (raw === undefined || raw === null) {
      rejections.push({ key, reason: 'cap_absent' });
      continue;
    }
    if (typeof raw !== 'number') {
      rejections.push({ key, reason: 'cap_not_a_number' });
      continue;
    }
    if (!Number.isFinite(raw)) {
      rejections.push({ key, reason: 'cap_not_finite' });
      continue;
    }
    if (!Number.isInteger(raw)) {
      rejections.push({ key, reason: 'cap_not_an_integer' });
      continue;
    }
    if (raw <= 0) {
      rejections.push({ key, reason: 'cap_not_positive' });
      continue;
    }
    resolved[key] = raw;
  }

  if (rejections.length > 0) return { ok: false, rejections };
  return { ok: true, caps: Object.freeze(resolved) };
}

// ─── Abort codes ──────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_CODES = [
  'reader_cap_absent',
  'reader_encoding_not_supported',
  'non_progressing_reader',
  'row_bytes_cap_exceeded',
  'carry_bytes_cap_exceeded',
  'columns_cap_exceeded',
  'file_size_unavailable',
  'file_open_failed',
  'file_read_failed',
  'file_close_failed',
  'resource_envelope_breached',
] as const;

export type BrazilReceitaFullJoinReaderAbortCode =
  (typeof BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_CODES)[number];

// ─── Filesystem port ──────────────────────────────────────────────────────────

/**
 * The four operations a sequential reader needs, injected rather than imported.
 *
 * There is deliberately no `readFile`, no `readdir` and no `stat` beyond a size: the port cannot
 * express "give me the whole file", so no implementation of it can be talked into materializing one.
 * `size` exists because EOF must be a FACT rather than an inference from a zero-length read — see
 * `non_progressing_reader`.
 */
export interface BrazilReceitaFullJoinReaderFileSystem {
  size(filePath: string): number;
  open(filePath: string): number;
  read(
    handle: number,
    buffer: Buffer,
    bufferOffset: number,
    length: number,
    position: number,
  ): number;
  close(handle: number): void;
}

/**
 * The slice of the 14B.0C enforcer this reader is allowed to touch.
 *
 * Narrow on purpose: the reader must not be able to open a phase, evaluate a checkpoint, record a
 * cleanup or read exact observations. It counts what it consumed and asks whether it may still
 * proceed; every decision about the run belongs to the engine above it.
 */
export interface BrazilReceitaFullJoinReaderResourceGuard {
  mayAccessData(): boolean;
  noteFileOpened(): { readonly ok: boolean };
  noteBytesRead(bytes: number): { readonly ok: boolean };
  noteRowsRead(rows: number): { readonly ok: boolean };
}

// ─── Row view ─────────────────────────────────────────────────────────────────

/**
 * One row, handed to the visitor and then discarded.
 *
 * `text` is the decoded row and exists only for the duration of the visitor call — it is the one
 * place in the streaming path where dataset content is materialized at all, and it is bounded by
 * `maxRowBytes`. `byteOffset` / `byteLength` are the OPAQUE REFERENCE a partitioned join records
 * instead of the row: they are enough to find the row again and carry nothing about its content.
 */
export interface BrazilReceitaFullJoinReaderRow {
  readonly text: string;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly columnCount: number;
  /** 1-based index within the file. A count, never an identifier. */
  readonly rowOrdinal: number;
}

/** `stop` ends the traversal cleanly and is reported as `stoppedByVisitor`. */
export type BrazilReceitaFullJoinReaderVisitorDecision = 'continue' | 'stop';

// ─── Request & outcome ────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinReaderRequest {
  readonly filePath: string;
  readonly encoding: unknown;
  readonly caps: Readonly<Partial<Record<BrazilReceitaFullJoinReaderCapKey, unknown>>> | null;
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly resourceGuard: BrazilReceitaFullJoinReaderResourceGuard;
  readonly onRow: (row: BrazilReceitaFullJoinReaderRow) => BrazilReceitaFullJoinReaderVisitorDecision;
}

/**
 * How many chunk offsets are retained for the progress evidence.
 *
 * Bounded because an unbounded list would grow with the file — the very property this reader
 * exists to avoid. A synthetic fixture fits entirely; a real file contributes its first
 * `MAX_RECORDED_OFFSETS` boundaries and then only the counters keep moving.
 */
export const BRAZIL_RECEITA_FULL_JOIN_READER_MAX_RECORDED_OFFSETS = 64 as const;

export interface BrazilReceitaFullJoinReaderTraversal {
  readonly ok: true;
  readonly reachedEndOfFile: boolean;
  readonly stoppedByVisitor: boolean;
  readonly bytesRead: number;
  readonly rowsRead: number;
  readonly chunksRead: number;
  readonly declaredFileBytes: number;
  /** The first N chunk-boundary offsets, in order. Strictly increasing by construction. */
  readonly offsetProgression: readonly number[];
  readonly finalOffset: number;
  readonly peakCarryBytes: number;
}

export interface BrazilReceitaFullJoinReaderRefusal {
  readonly ok: false;
  readonly abortCode: BrazilReceitaFullJoinReaderAbortCode;
  readonly abortStage: BrazilReceitaFullJoinReaderAbortStage;
  readonly capRejections: readonly BrazilReceitaFullJoinReaderCapRejection[];
  /** True when the descriptor this traversal opened was closed. Always true after an open. */
  readonly handleClosed: boolean;
  readonly bytesRead: number;
  readonly rowsRead: number;
}

export type BrazilReceitaFullJoinReaderOutcome =
  | BrazilReceitaFullJoinReaderTraversal
  | BrazilReceitaFullJoinReaderRefusal;

// ─── Field access ─────────────────────────────────────────────────────────────

const QUOTE = '"';

/**
 * Returns the field at `index` of a delimited line, quote-aware, or `null` when the line has fewer
 * fields. Scans rather than splitting, so a 30-column establishment row does not allocate 30 strings
 * to reach column 0.
 */
export function readBrazilReceitaFullJoinFieldAt(
  line: string,
  delimiter: string,
  index: number,
): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  let field = 0;
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i]!;
    if (character === QUOTE) {
      if (inQuotes && line[i + 1] === QUOTE) {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (character === delimiter && !inQuotes) {
      if (field === index) return line.slice(start, i);
      field += 1;
      start = i + 1;
    }
  }
  if (field === index) return line.slice(start);
  return null;
}

// ─── Traversal ────────────────────────────────────────────────────────────────

const NEWLINE_BYTE = 0x0a;
const CARRIAGE_RETURN_BYTE = 0x0d;

function refuse(
  abortCode: BrazilReceitaFullJoinReaderAbortCode,
  abortStage: BrazilReceitaFullJoinReaderAbortStage,
  handleClosed: boolean,
  bytesRead: number,
  rowsRead: number,
  capRejections: readonly BrazilReceitaFullJoinReaderCapRejection[] = [],
): BrazilReceitaFullJoinReaderRefusal {
  return { ok: false, abortCode, abortStage, capRejections, handleClosed, bytesRead, rowsRead };
}

/**
 * Reads a headerless, delimited Receita file from byte zero to EOF, handing every complete row to
 * the visitor exactly once.
 *
 * The loop's shape is the whole point, so it is worth stating plainly:
 *
 *   1. The read buffer is allocated ONCE, before the loop, at `maxCarryBytes + maxChunkBytes`. It
 *      is reused for every chunk, so buffer memory is constant in the file's length AND constant in
 *      the number of chunks — see point 3.
 *   2. EOF is `position >= declaredBytes`, taken from the size the port reported before opening. A
 *      read that returns nothing while bytes remain is `non_progressing_reader` — a hang caught as
 *      a terminal abort instead of a loop that never ends.
 *   3. A row split across a chunk boundary is preserved as a PREFIX of that same buffer
 *      (`window[0 .. carryLength)`), and the next chunk is read in directly behind it. Joining a
 *      partial row to its continuation is therefore a `subarray` VIEW, not a concatenation, and
 *      costs ZERO allocations per chunk. `carryLength` is capped independently and holds a PARTIAL
 *      ROW, never a window over the file.
 *   4. The final row is flushed after the loop, because the official files' last row may have no
 *      trailing newline and dropping it would silently lose a record.
 *   5. The descriptor is closed in `finally`, on success and on every failure path.
 */
export function readBrazilReceitaFullJoinFileSequentially(
  request: BrazilReceitaFullJoinReaderRequest,
): BrazilReceitaFullJoinReaderOutcome {
  const capResolution = resolveBrazilReceitaFullJoinReaderCaps(request.caps);
  if (!capResolution.ok) {
    return refuse(
      'reader_cap_absent',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
      capResolution.rejections,
    );
  }
  const caps = capResolution.caps;

  if (!isSupportedEncoding(request.encoding)) {
    return refuse(
      'reader_encoding_not_supported',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
    );
  }
  const encoding = request.encoding;

  if (!request.resourceGuard.mayAccessData()) {
    return refuse(
      'resource_envelope_breached',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
    );
  }

  let declaredBytes: number;
  try {
    declaredBytes = request.fileSystem.size(request.filePath);
  } catch {
    return refuse(
      'file_size_unavailable',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
    );
  }
  if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
    return refuse(
      'file_size_unavailable',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
    );
  }

  const opened = request.resourceGuard.noteFileOpened();
  if (!opened.ok) {
    return refuse(
      'resource_envelope_breached',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
    );
  }

  let handle: number;
  try {
    handle = request.fileSystem.open(request.filePath);
  } catch {
    return refuse(
      'file_open_failed',
      BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_BEFORE_FILE_OPEN,
      false,
      0,
      0,
    );
  }

  // Allocated once, reused for every chunk, and sized to hold a retained partial row AHEAD of the
  // chunk that row will be joined to. This single line is why memory is independent of file length;
  // the `carryLength` prefix protocol below is why it is also independent of the CHUNK COUNT.
  //
  // ROOT CAUSE this replaces (BR-SOURCE external-memory closure): the previous shape read into a
  // `maxChunkBytes` buffer and rebuilt "carry + chunk" with `Buffer.concat` on every iteration
  // whose predecessor left a partial row — which, at the official row widths, is very nearly EVERY
  // iteration. Each of those concatenations allocated a fresh ~`maxChunkBytes` ArrayBuffer that
  // became garbage immediately, so `process.memoryUsage().external` tracked the GC's lag rather
  // than the reader's working set: a synthetic reproduction of attempt #2 measured 88 MiB of
  // transient concat garbage against a ~12 MiB live set, and breached `maxExternalMemoryBytes`
  // (64 MiB) with room to spare. Reading the chunk in BEHIND the carry makes the join a view.
  const window = Buffer.allocUnsafe(caps.maxCarryBytes + caps.maxChunkBytes);

  let position = 0;
  /** Bytes of a retained partial row, living at `window[0 .. carryLength)`. Capped independently. */
  let carryLength = 0;
  let carryStartOffset = 0;
  let bytesRead = 0;
  let rowsRead = 0;
  let chunksRead = 0;
  let peakCarryBytes = 0;
  let stoppedByVisitor = false;
  const offsetProgression: number[] = [];

  let failure: BrazilReceitaFullJoinReaderRefusal | null = null;

  /** Hands one complete row to the visitor. Returns a refusal, `'stop'`, or `null` to continue. */
  function emitRow(
    content: Buffer,
    byteOffset: number,
  ): BrazilReceitaFullJoinReaderRefusal | 'stop' | null {
    if (content.length > caps.maxRowBytes) {
      return refuse(
        'row_bytes_cap_exceeded',
        BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
        false,
        bytesRead,
        rowsRead,
      );
    }
    // An empty line carries no row. It is skipped rather than counted, so a trailing newline does
    // not inflate the row count by one on every file.
    if (content.length === 0) return null;

    const text = content.toString(encoding);
    const columnCount = countBrReceitaCnpjDelimitedColumns(
      text,
      BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
    );
    if (columnCount > caps.maxColumnsPerRow) {
      return refuse(
        'columns_cap_exceeded',
        BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
        false,
        bytesRead,
        rowsRead,
      );
    }

    rowsRead += 1;
    const counted = request.resourceGuard.noteRowsRead(1);
    if (!counted.ok) {
      return refuse(
        'resource_envelope_breached',
        BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
        false,
        bytesRead,
        rowsRead,
      );
    }

    const decision = request.onRow({
      text,
      byteOffset,
      byteLength: content.length,
      columnCount,
      rowOrdinal: rowsRead,
    });
    return decision === 'stop' ? 'stop' : null;
  }

  try {
    while (position < declaredBytes) {
      const previousOffset = position;
      let chunkBytes: number;
      try {
        // Read in BEHIND the retained partial row, never at offset zero: that is what keeps the
        // two contiguous and makes the join below a view. `carryLength <= maxCarryBytes` is
        // enforced at every assignment, so this can never run past the end of `window`.
        chunkBytes = request.fileSystem.read(
          handle,
          window,
          carryLength,
          caps.maxChunkBytes,
          position,
        );
      } catch {
        failure = refuse(
          'file_read_failed',
          BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
          false,
          bytesRead,
          rowsRead,
        );
        break;
      }

      // Bytes remain and the read produced none: the loop cannot advance. Reported rather than
      // retried — 14B.0C's retry count is structurally zero, and a short read that yielded nothing
      // will yield nothing again.
      if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) {
        failure = refuse(
          'non_progressing_reader',
          BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
          false,
          bytesRead,
          rowsRead,
        );
        break;
      }

      position += chunkBytes;
      if (position <= previousOffset) {
        failure = refuse(
          'non_progressing_reader',
          BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
          false,
          bytesRead,
          rowsRead,
        );
        break;
      }
      chunksRead += 1;
      bytesRead += chunkBytes;
      if (offsetProgression.length < BRAZIL_RECEITA_FULL_JOIN_READER_MAX_RECORDED_OFFSETS) {
        offsetProgression.push(position);
      }

      const accounted = request.resourceGuard.noteBytesRead(chunkBytes);
      if (!accounted.ok) {
        failure = refuse(
          'resource_envelope_breached',
          BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
          false,
          bytesRead,
          rowsRead,
        );
        break;
      }

      // The retained partial row is already at the front of `window` and this chunk was just read
      // in directly behind it, so "carry + chunk" is a VIEW over bytes already in place — no
      // concatenation, no allocation. Bounded by `maxCarryBytes + maxChunkBytes`, never by the file.
      const combined = window.subarray(0, carryLength + chunkBytes);
      const combinedStartOffset = carryLength === 0 ? position - chunkBytes : carryStartOffset;

      let cursor = 0;
      while (cursor < combined.length) {
        const newlineIndex = combined.indexOf(NEWLINE_BYTE, cursor);
        if (newlineIndex === -1) break;
        let end = newlineIndex;
        // CRLF: the terminator is two bytes, and the row content excludes both.
        if (end > cursor && combined[end - 1] === CARRIAGE_RETURN_BYTE) end -= 1;
        const outcome = emitRow(combined.subarray(cursor, end), combinedStartOffset + cursor);
        if (outcome === 'stop') {
          stoppedByVisitor = true;
          break;
        }
        if (outcome !== null) {
          failure = outcome;
          break;
        }
        cursor = newlineIndex + 1;
      }
      if (failure !== null || stoppedByVisitor) break;

      // What remains is a PARTIAL ROW, kept for the next chunk. Its own cap is checked before it is
      // retained, so an unterminated 60 GB "row" fails here rather than growing the buffer.
      const tailLength = combined.length - cursor;
      if (tailLength > caps.maxCarryBytes) {
        failure = refuse(
          'carry_bytes_cap_exceeded',
          BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
          false,
          bytesRead,
          rowsRead,
        );
        break;
      }
      // MOVED to the front of the same buffer rather than copied out into a new one: the next
      // iteration reads its chunk in at `carryLength`, which puts the partial row and its
      // continuation back-to-back without allocating. `copyWithin` is defined for overlapping
      // ranges, which is exactly the case whenever `cursor < tailLength`.
      if (tailLength > 0 && cursor > 0) window.copyWithin(0, cursor, cursor + tailLength);
      carryLength = tailLength;
      carryStartOffset = combinedStartOffset + cursor;
      peakCarryBytes = Math.max(peakCarryBytes, carryLength);
    }

    // The last row of an official file may have no trailing newline. Flushing it here is the
    // difference between reading a file and reading all but its final record.
    if (failure === null && !stoppedByVisitor && carryLength > 0) {
      const outcome = emitRow(window.subarray(0, carryLength), carryStartOffset);
      if (outcome === 'stop') stoppedByVisitor = true;
      else if (outcome !== null) failure = outcome;
      carryLength = 0;
    }
  } finally {
    try {
      request.fileSystem.close(handle);
    } catch {
      if (failure === null) {
        failure = refuse(
          'file_close_failed',
          BRAZIL_RECEITA_FULL_JOIN_READER_ABORT_DURING_READ,
          false,
          bytesRead,
          rowsRead,
        );
      }
    }
  }

  if (failure !== null) {
    // The descriptor was closed in `finally` above, on every failure path. Reported as a fact so a
    // caller does not have to trust the prose.
    return { ...failure, handleClosed: true };
  }

  return {
    ok: true,
    reachedEndOfFile: !stoppedByVisitor && position >= declaredBytes && carryLength === 0,
    stoppedByVisitor,
    bytesRead,
    rowsRead,
    chunksRead,
    declaredFileBytes: declaredBytes,
    offsetProgression,
    finalOffset: position,
    peakCarryBytes,
  };
}

/**
 * Re-reads ONE row by its opaque reference.
 *
 * This is the operation that makes an offset-reference partitioning honest: a partition file holds
 * references, and the row behind a reference is fetched again, one at a time, into a caller-owned
 * bounded buffer. Nothing accumulates.
 */
export interface BrazilReceitaFullJoinRowFetchRequest {
  readonly handle: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly encoding: BrazilReceitaFullJoinReaderEncoding;
  readonly buffer: Buffer;
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly resourceGuard: BrazilReceitaFullJoinReaderResourceGuard;
}

export type BrazilReceitaFullJoinRowFetchOutcome =
  | { readonly ok: true; readonly text: string; readonly bytesRead: number }
  | { readonly ok: false; readonly abortCode: BrazilReceitaFullJoinReaderAbortCode };

export function fetchBrazilReceitaFullJoinRowByReference(
  request: BrazilReceitaFullJoinRowFetchRequest,
): BrazilReceitaFullJoinRowFetchOutcome {
  const { byteLength, byteOffset, buffer } = request;
  if (
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    !Number.isInteger(byteOffset) ||
    byteOffset < 0
  ) {
    return { ok: false, abortCode: 'file_read_failed' };
  }
  if (byteLength > buffer.length) {
    // The caller's buffer is the cap. A row that does not fit is a row cap breach, not a reason to
    // allocate a bigger buffer.
    return { ok: false, abortCode: 'row_bytes_cap_exceeded' };
  }
  if (!request.resourceGuard.mayAccessData()) {
    return { ok: false, abortCode: 'resource_envelope_breached' };
  }

  let read: number;
  try {
    read = request.fileSystem.read(request.handle, buffer, 0, byteLength, byteOffset);
  } catch {
    return { ok: false, abortCode: 'file_read_failed' };
  }
  if (!Number.isFinite(read) || read <= 0) {
    return { ok: false, abortCode: 'non_progressing_reader' };
  }

  const accounted = request.resourceGuard.noteBytesRead(read);
  if (!accounted.ok) return { ok: false, abortCode: 'resource_envelope_breached' };

  return { ok: true, text: buffer.subarray(0, read).toString(request.encoding), bytesRead: read };
}
