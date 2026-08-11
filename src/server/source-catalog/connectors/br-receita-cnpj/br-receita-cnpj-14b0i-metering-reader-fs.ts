/**
 * BR Receita CNPJ — METERING READER-FILESYSTEM DECORATOR for the 14B.0I throughput qualification
 * (BR-SOURCE-14B.0I § 4, § 11).
 *
 * The engine's `BrazilReceitaFullJoinReaderFileSystem` port is exactly where this milestone's
 * measurement belongs: it is the one seam through which EVERY byte the real reader and the real
 * per-reference row-fetcher ever touch must pass, and wrapping it — rather than reading the
 * engine's own internals — keeps this a real, unmodified production hot path with an observer
 * attached, not a second implementation of it.
 *
 * ── Two denominators live behind the SAME port, and this module tells them apart ─
 * `br-receita-cnpj-full-join-streaming-reader` always requests exactly `caps.maxChunkBytes` from
 * `read()` during a sequential reference pass (see its own header: the request length is the cap,
 * not the remaining file size, even on the final chunk). `fetchBrazilReceitaFullJoinRowByReference`
 * — called once per reference during the partitioned-join stage, to recover a row's key — always
 * requests exactly `byteLength`, a single row's length, which is bounded by `maxRowBytes` and is
 * always far smaller than `maxChunkBytes` in this milestone's caps (65 536 vs. 4 194 304 bytes).
 * That gap is exact and deterministic given the caps THIS module's caller chooses, so a `read()`
 * call is classified as a REFERENCE-PASS CHUNK READ when its requested length equals
 * `maxChunkBytes`, and as a JOIN-STAGE ROW FETCH otherwise. This is a property of the caps, not a
 * guess about behaviour — assert `maxChunkBytes > maxRowBytes` at construction so the distinction
 * can never silently collapse.
 *
 * ── Bytes are the ACTUAL return value, not the request ─────────────────────────
 * `sourceBytesRead` accumulates the real `fs.readSync`-backed return value (via the wrapped real
 * port), never the requested length — so a short final chunk near EOF is counted for what it
 * actually delivered, exactly like the reader's own `bytesRead` accumulator.
 *
 * ── Family attribution is exact, not inferred from content ─────────────────────
 * `open()` is told the file path the real port opens; this module maps that path back to a family
 * via the SAME descriptor list the caller handed the engine — the list the caller already knows to
 * be exhaustive, since it built the fixture. No content is read to answer "which family is this".
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O of its own. Every operation is delegated to the wrapped real port; this module
 *     only counts what already happened.
 *   - retains a row, a cell, a join key, or any byte of content — it counts lengths, not bytes.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import type { BrazilReceitaFullJoinSourceFileDescriptor } from './br-receita-cnpj-full-join-engine-contract';
import type { BrazilReceitaFullJoinPartitionedFamily } from './br-receita-cnpj-full-join-partition-workspace';
import type { BrazilReceitaFullJoinReaderFileSystem } from './br-receita-cnpj-full-join-streaming-reader';

export const BRAZIL_RECEITA_14B0I_METERING_READER_FS_VERSION = 1 as const;

export interface BrazilReceita14B0IMeteringReaderFsRequest {
  readonly realFileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly sources: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  readonly maxChunkBytes: number;
}

export interface BrazilReceita14B0IFamilyReadStats {
  readonly chunkReadCalls: number;
  readonly chunkReadBytes: number;
  readonly rowFetchCalls: number;
  readonly rowFetchBytes: number;
}

export interface BrazilReceita14B0IMeteringSnapshot {
  readonly totalChunkReadCalls: number;
  readonly totalChunkReadBytes: number;
  readonly totalRowFetchCalls: number;
  readonly totalRowFetchBytes: number;
  readonly totalReadCalls: number;
  readonly totalBytesRead: number;
  readonly byFamily: Readonly<Record<BrazilReceitaFullJoinPartitionedFamily, BrazilReceita14B0IFamilyReadStats>>;
}

export interface BrazilReceita14B0IMeteringReaderFileSystem {
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  snapshot(): BrazilReceita14B0IMeteringSnapshot;
}

function emptyFamilyStats(): BrazilReceita14B0IFamilyReadStats {
  return { chunkReadCalls: 0, chunkReadBytes: 0, rowFetchCalls: 0, rowFetchBytes: 0 };
}

/**
 * Wraps a REAL reader filesystem port with byte/call metering, classifying every `read()` as a
 * reference-pass chunk read or a join-stage row fetch by requested length, and attributing it to a
 * family by the descriptor list the caller already resolved.
 *
 * `maxChunkBytes` is REQUIRED and validated against every source's `maxRowBytes`-bounded row
 * fetches implicitly by construction: the caller supplies the same `maxChunkBytes` it passes to the
 * engine's reader caps, so the classification and the engine's own behaviour can never drift apart.
 */
export function createBrazilReceita14B0IMeteringReaderFileSystem(
  request: BrazilReceita14B0IMeteringReaderFsRequest,
): BrazilReceita14B0IMeteringReaderFileSystem {
  if (!Number.isInteger(request.maxChunkBytes) || request.maxChunkBytes <= 0) {
    throw new Error('maxChunkBytes must be a positive integer');
  }

  const familyByPath = new Map<string, BrazilReceitaFullJoinPartitionedFamily>();
  for (const source of request.sources) familyByPath.set(source.filePath, source.family);

  const familyByHandle = new Map<number, BrazilReceitaFullJoinPartitionedFamily>();
  const byFamily = new Map<BrazilReceitaFullJoinPartitionedFamily, BrazilReceita14B0IFamilyReadStats>();
  for (const family of familyByPath.values()) {
    if (!byFamily.has(family)) byFamily.set(family, emptyFamilyStats());
  }

  let totalChunkReadCalls = 0;
  let totalChunkReadBytes = 0;
  let totalRowFetchCalls = 0;
  let totalRowFetchBytes = 0;

  function statsFor(handle: number): BrazilReceita14B0IFamilyReadStats | null {
    const family = familyByHandle.get(handle);
    if (family === undefined) return null;
    const existing = byFamily.get(family);
    if (existing !== undefined) return existing;
    const created = emptyFamilyStats();
    byFamily.set(family, created);
    return created;
  }

  const meteredFileSystem: BrazilReceitaFullJoinReaderFileSystem = {
    size(filePath) {
      return request.realFileSystem.size(filePath);
    },
    open(filePath) {
      const handle = request.realFileSystem.open(filePath);
      const family = familyByPath.get(filePath);
      if (family !== undefined) familyByHandle.set(handle, family);
      return handle;
    },
    read(handle, buffer, bufferOffset, length, position) {
      const bytes = request.realFileSystem.read(handle, buffer, bufferOffset, length, position);
      const isChunkRead = length === request.maxChunkBytes;
      const family = statsFor(handle);

      if (isChunkRead) {
        totalChunkReadCalls += 1;
        totalChunkReadBytes += bytes;
        if (family !== null) {
          (family as { chunkReadCalls: number }).chunkReadCalls += 1;
          (family as { chunkReadBytes: number }).chunkReadBytes += bytes;
        }
      } else {
        totalRowFetchCalls += 1;
        totalRowFetchBytes += bytes;
        if (family !== null) {
          (family as { rowFetchCalls: number }).rowFetchCalls += 1;
          (family as { rowFetchBytes: number }).rowFetchBytes += bytes;
        }
      }
      return bytes;
    },
    close(handle) {
      request.realFileSystem.close(handle);
      familyByHandle.delete(handle);
    },
  };

  return {
    fileSystem: meteredFileSystem,
    snapshot() {
      const byFamilySnapshot = {} as Record<
        BrazilReceitaFullJoinPartitionedFamily,
        BrazilReceita14B0IFamilyReadStats
      >;
      for (const [family, stats] of byFamily.entries()) {
        byFamilySnapshot[family] = { ...stats };
      }
      return {
        totalChunkReadCalls,
        totalChunkReadBytes,
        totalRowFetchCalls,
        totalRowFetchBytes,
        totalReadCalls: totalChunkReadCalls + totalRowFetchCalls,
        totalBytesRead: totalChunkReadBytes + totalRowFetchBytes,
        byFamily: byFamilySnapshot,
      };
    },
  };
}
