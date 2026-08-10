/**
 * BR Receita CNPJ — BOUNDED LRU PARTITION-HANDLE POOL (BR-SOURCE-14B.0F § 3).
 *
 * The mechanism that makes `partitionCount = 1024` cost 32 descriptors instead of 1024.
 *
 * ── The problem, stated exactly ─────────────────────────────────────────────────
 * An external hash-partitioned join writes every row's reference into the partition file its key
 * hashes to, in whatever order the rows arrive. Consecutive rows land in unrelated partitions, so the
 * obvious implementation — open each partition file on first use and keep it open until the pass ends
 * — holds one descriptor per partition for the whole pass. That is what 14B.0D did, and at 1024
 * partitions across two families it is roughly 4096 descriptors: bounded in the sense that it has a
 * ceiling, unbounded in the sense that matters, because the ceiling is set by a partitioning
 * parameter rather than by a resource cap.
 *
 * ── The fix, and why LRU rather than open-write-close ───────────────────────────
 * § 3 allows either a bounded LRU pool or a bounded batch of open-write-close cycles, and prefers the
 * pool. It is the right preference: open-write-close pays an `open` and a `close` syscall for EVERY
 * reference — tens of millions of them over a real pass — and the write pattern is not uniformly
 * random. Partitions repeat within a chunk often enough that a small pool absorbs most of the
 * traffic, so the LRU pays a reopen only on a genuine miss. Both are correct; one is correct and
 * fast.
 *
 * ── Eviction cannot lose a byte ─────────────────────────────────────────────────
 * This is the property the whole design rests on, and it holds for a specific reason: partition files
 * are APPEND-ONLY, and every write is a complete fixed-width record. Closing a handle mid-pass and
 * reopening it later in append mode therefore continues exactly where the previous handle stopped —
 * there is no seek position to lose, no partial record to reconcile, and no buffered state in this
 * module (`write` is a direct positional write through the port). A reopened partition file is
 * byte-identical to one that was never closed.
 *
 * ── Reopen is not "open whatever is at that path" ───────────────────────────────
 * The pool refuses to reopen a key it did not create. That is what preserves 14B.0D's guarantee that
 * the engine never appends into a file it did not create: without it, an evicted partition whose file
 * was swapped for a symlink between eviction and reopen would be appended to. The `createdKeys` set
 * is the memory that makes the second open as safe as the first.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`. Opening and closing arrive through an injected port, so eviction, reopen and
 *     cap behaviour are all testable without a disk.
 *   - chooses a path or a file name. It is handed an opaque KEY and hands the same key back to the
 *     port; it cannot construct a destination.
 *   - buffers a write, or holds a row, a cell, a key or a reference. It holds integers.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import {
  type BrazilReceitaFullJoinOpenHandleLedger,
} from './br-receita-cnpj-full-join-open-handle-ledger';

// ─── Version ──────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_PARTITION_HANDLE_POOL_VERSION = 1 as const;

/**
 * The § 3 proposal for the pool's size. Small on purpose.
 *
 * 32 open partition files against a 64-descriptor global cap leaves half the budget for the source
 * files the join re-reads from, the private metric artifact and any control artifact — which is the
 * arithmetic § 3 asks for, written down rather than assumed.
 */
export const BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES = 32 as const;

// ─── Port ─────────────────────────────────────────────────────────────────────

/**
 * How the pool opens and closes. Two functions, no path handling.
 *
 * `open` receives the key and a flag saying whether this is the FIRST open of that key in the run.
 * The flag exists so the implementation can use a create-exclusive open the first time and a plain
 * append-open on a reopen — the distinction 14B.0D encoded with an `existsSync` probe, made explicit
 * here so a reopen cannot be talked into creating a file the pool never created.
 */
export interface BrazilReceitaFullJoinPartitionHandlePort {
  open(key: string, firstOpen: boolean): number;
  close(handle: number): void;
}

// ─── Outcomes ─────────────────────────────────────────────────────────────────

export type BrazilReceitaFullJoinPartitionHandleFailure =
  | 'handle_cap_exceeded'
  | 'partition_open_failed'
  /**
   * A REOPEN failed. Kept distinct from a first open because the two mean different things: a first
   * open failing is an inaccessible destination, while a reopen failing means a file this pool
   * created is no longer openable as it was — a missing partition, or something else now at its path.
   */
  | 'partition_reopen_failed';

export type BrazilReceitaFullJoinPartitionHandleAcquisition =
  | { readonly ok: true; readonly handle: number; readonly reopened: boolean }
  | { readonly ok: false; readonly failure: BrazilReceitaFullJoinPartitionHandleFailure };

export interface BrazilReceitaFullJoinPartitionHandlePoolStats {
  readonly openNow: number;
  readonly peakOpen: number;
  readonly evictions: number;
  readonly reopens: number;
  readonly closeFailures: number;
  readonly maxOpenPartitionFiles: number;
}

export interface BrazilReceitaFullJoinPartitionHandlePool {
  /** Returns an open handle for `key`, evicting the least-recently-used one if the pool is full. */
  acquire(key: string): BrazilReceitaFullJoinPartitionHandleAcquisition;
  /**
   * Closes ONE key if it is open, releasing its ledger slot. Used to flush a partition before it is
   * read back — an append handle may hold bytes a reader would not see.
   *
   * Returns `true` when a handle was actually closed.
   */
  closeKey(key: string): boolean;
  /** Closes every handle. Idempotent, and reports how many closes the port refused. */
  closeAll(): { readonly closed: number; readonly closeFailures: number };
  isOpen(key: string): boolean;
  stats(): BrazilReceitaFullJoinPartitionHandlePoolStats;
}

// ─── Pool ─────────────────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinPartitionHandlePoolRequest {
  readonly maxOpenPartitionFiles: number;
  readonly ledger: BrazilReceitaFullJoinOpenHandleLedger;
  readonly port: BrazilReceitaFullJoinPartitionHandlePort;
}

/**
 * Creates a bounded LRU pool over partition-file handles.
 *
 * Recency is carried by a `Map`'s insertion order rather than by timestamps: `Map` iterates in
 * insertion order, so deleting and re-setting a key moves it to the back, and the first entry of the
 * iterator is always the least-recently-used one. No clock is involved, which keeps the eviction
 * order deterministic — two runs over the same input evict in the same sequence, and a test can
 * assert which key went.
 */
export function createBrazilReceitaFullJoinPartitionHandlePool(
  request: BrazilReceitaFullJoinPartitionHandlePoolRequest,
): BrazilReceitaFullJoinPartitionHandlePool {
  const { ledger, port } = request;
  const maxOpenPartitionFiles = request.maxOpenPartitionFiles;

  /** key → handle, in least-recently-used-first order. */
  const openHandles = new Map<string, number>();
  /** Every key this pool has ever opened. The memory that makes a reopen safe. */
  const createdKeys = new Set<string>();

  let peakOpen = 0;
  let evictions = 0;
  let reopens = 0;
  let closeFailures = 0;

  /** Closes one open key. Always releases the ledger slot, even when the port throws. */
  function closeOne(key: string): boolean {
    const handle = openHandles.get(key);
    if (handle === undefined) return false;
    openHandles.delete(key);
    try {
      port.close(handle);
    } catch {
      // The descriptor is no longer reachable from this pool either way. Counted so cleanup can be
      // honest about it, and the ledger slot is released regardless: refusing to release it would
      // shrink the run's budget on every failed close until nothing could be opened at all.
      closeFailures += 1;
    }
    ledger.release('partition_file');
    return true;
  }

  /** Evicts the least-recently-used handle. Returns false only when the pool is already empty. */
  function evictLeastRecentlyUsed(): boolean {
    const oldest = openHandles.keys().next();
    if (oldest.done === true) return false;
    closeOne(oldest.value);
    evictions += 1;
    return true;
  }

  return {
    acquire(key) {
      const existing = openHandles.get(key);
      if (existing !== undefined) {
        // Touch: delete and re-set moves this key to the back of the LRU order.
        openHandles.delete(key);
        openHandles.set(key, existing);
        return { ok: true, handle: existing, reopened: false };
      }

      // The pool's OWN cap, checked before the global one: it is the tighter of the two, and
      // evicting to satisfy it keeps the global budget available for the other categories.
      if (openHandles.size >= maxOpenPartitionFiles) evictLeastRecentlyUsed();

      let reservation = ledger.reserve('partition_file');
      if (!reservation.ok && openHandles.size > 0) {
        // The GLOBAL budget is exhausted while this pool still holds handles. Giving one back is
        // strictly better than failing: the run needs this partition now, and it demonstrably does
        // not need the least-recently-used one.
        evictLeastRecentlyUsed();
        reservation = ledger.reserve('partition_file');
      }
      if (!reservation.ok) return { ok: false, failure: 'handle_cap_exceeded' };

      const firstOpen = !createdKeys.has(key);
      let handle: number;
      try {
        handle = port.open(key, firstOpen);
      } catch {
        ledger.release('partition_file');
        return {
          ok: false,
          failure: firstOpen ? 'partition_open_failed' : 'partition_reopen_failed',
        };
      }

      createdKeys.add(key);
      openHandles.set(key, handle);
      if (openHandles.size > peakOpen) peakOpen = openHandles.size;
      if (!firstOpen) reopens += 1;
      return { ok: true, handle, reopened: !firstOpen };
    },

    closeKey(key) {
      return closeOne(key);
    },

    closeAll() {
      const before = closeFailures;
      let closed = 0;
      // Snapshotted: `closeOne` mutates the map, and iterating it while deleting would skip entries.
      for (const key of [...openHandles.keys()]) {
        if (closeOne(key)) closed += 1;
      }
      return { closed, closeFailures: closeFailures - before };
    },

    isOpen(key) {
      return openHandles.has(key);
    },

    stats() {
      return {
        openNow: openHandles.size,
        peakOpen,
        evictions,
        reopens,
        closeFailures,
        maxOpenPartitionFiles,
      };
    },
  };
}
