/**
 * BR Receita CNPJ — THE FIRST REAL SOURCE READ (BR-SOURCE-ATTEMPT2-FINAL § 7–§ 10, § 14).
 *
 * BR-SOURCE-14B.0J § 11 defines the attempt accounting in one sentence: an attempt is spent by CROSSING
 * the real-data boundary, not by finishing well. A run that crosses and then breaches a cap at one per
 * cent has spent it; a run that refuses before crossing has spent nothing.
 *
 * The accounting was right and the placement was not. `commitCrossing()` fired immediately BEFORE the
 * engine call, on the reasoning that the engine is the first thing that opens a source row. It is — but
 * only if it gets that far. The engine runs eleven pre-read validations of its own (caps, descriptors,
 * duplicate policy, resource arming, and the temporary-storage wall), every one of which returns
 * `before_first_read`. An attempt that died at one of them had already been recorded as crossed:
 *
 *     commitCrossing()  →  engine pre-read abort  →  bytesRead = 0, rowsRead = 0
 *
 * Zero bytes, zero rows, and a spent attempt. That is precisely the accounting § 11 forbids, inverted.
 *
 * ── What this module does ───────────────────────────────────────────────────────
 * It decorates the READER PORT — the one injected object through which every source byte travels — and
 * fires a callback immediately before the first `read`, exactly once, whatever the run does afterwards.
 * The crossing therefore coincides with the first access to source CONTENT, which is the only event that
 * costs the operator anything: the hours and the data access, not the verdict.
 *
 * ── `read`, and not `open` or `size` ────────────────────────────────────────────
 * The port has four operations and only one of them transfers content. `size` is a stat, which § 8 names
 * explicitly as NOT a crossing. `open` acquires a descriptor and moves no bytes; a run that opened a file
 * and failed before reading it has learned nothing about the dataset. `close` is obvious. So the hook
 * hangs on `read`, and manifest metadata, SHA validation, workspace creation, partition-workspace policy
 * validation and the engine invocation itself all pass beneath it untouched — none of them goes through
 * this port at all.
 *
 * ── Exactly once, and marked BEFORE the delegation ──────────────────────────────
 * Twenty source parts must not produce twenty crossings, so the notification latches. It latches BEFORE
 * the callback is invoked and before the underlying read: a callback that throws leaves the boundary
 * crossed, which is the conservative reading — the run was about to pull bytes and the accounting should
 * not depend on the notifier's own reliability.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`. It wraps a port it is handed and performs no I/O of its own.
 *   - reads, buffers, inspects, counts or reports a byte, a row, a path or a file name. It observes THAT
 *     a read is about to happen, never what the read returns.
 *   - swallows an error from the port or from the callback.
 *   - un-crosses a boundary. There is no reset, for the same reason the attempt ledger has none.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import type { BrazilReceitaFullJoinReaderFileSystem } from './br-receita-cnpj-full-join-streaming-reader';

/** The port operation that constitutes a real source read. One, and it is not `open`. */
export const BRAZIL_RECEITA_FULL_JOIN_REAL_SOURCE_READ_OPERATION = 'read' as const;

/**
 * Port operations that explicitly do NOT cross the boundary (§ 8).
 *
 * Exported as data so a test can assert the exclusion list mechanically rather than by reading prose.
 */
export const BRAZIL_RECEITA_FULL_JOIN_NON_CROSSING_READER_OPERATIONS: readonly string[] = Object.freeze([
  'size',
  'open',
  'close',
]);

/** The most crossings one run may record. One, and there is no configuration that raises it. */
export const BRAZIL_RECEITA_FULL_JOIN_MAX_BOUNDARY_CROSSINGS = 1 as const;

export interface BrazilReceitaFullJoinFirstSourceReadBoundary {
  /** The decorated port. Hand this to the engine in place of the one that was wrapped. */
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  /** How many times the callback was invoked. Never above one. */
  notificationCount(): number;
  /** Whether a real source read has begun. Monotonic; there is no path back to `false`. */
  crossed(): boolean;
}

/**
 * Wraps a reader port so `onBeforeFirstRealSourceRead` fires once, immediately before the first read.
 *
 * The wrapper is a spread of the original plus one overridden operation, matching
 * `withBrazilReceitaFullJoinLedgerAccounting`: decorating the PORT rather than the call sites is what
 * makes the guarantee hold for read paths written after this milestone — the reference passes and the
 * join stage's row fetches both travel through the same object, and neither had to be told about it.
 */
export function withBrazilReceitaFullJoinFirstSourceReadBoundary(
  port: BrazilReceitaFullJoinReaderFileSystem,
  onBeforeFirstRealSourceRead: () => void,
): BrazilReceitaFullJoinFirstSourceReadBoundary {
  let notifications = 0;

  const fileSystem: BrazilReceitaFullJoinReaderFileSystem = {
    ...port,
    read(handle: number, buffer: Buffer, bufferOffset: number, length: number, position: number): number {
      if (notifications === 0) {
        // Latched FIRST. A notifier that throws still leaves the boundary crossed — see the header.
        notifications += 1;
        onBeforeFirstRealSourceRead();
      }
      return port.read(handle, buffer, bufferOffset, length, position);
    },
  };

  return {
    fileSystem,
    notificationCount: () => notifications,
    crossed: () => notifications > 0,
  };
}
