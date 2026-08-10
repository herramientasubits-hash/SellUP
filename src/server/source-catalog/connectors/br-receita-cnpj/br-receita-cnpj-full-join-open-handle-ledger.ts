/**
 * BR Receita CNPJ — GLOBAL OPEN-FILE-HANDLE LEDGER (BR-SOURCE-14B.0F § 3).
 *
 * The gap this module closes was found by 14B.0E, and it is worth stating precisely because the
 * previous accounting was not wrong so much as it was measuring a different thing.
 *
 * 14B.0C's `maxFilesOpened` counts CUMULATIVE source-descriptor opens: how many times the run called
 * `open` on a dataset file over its whole lifetime. That is a useful bound, and it stays. What it
 * cannot express is the number of descriptors held AT ONE INSTANT — and the partition workspace held
 * one append handle per partition file for the entire reference pass, plus a read handle per slice.
 * At `partitionCount = 1024` that is roughly `2 × maxPartitionCount` handles, about 4096 of them,
 * none of which the cumulative counter ever saw. Correctness therefore depended on `ulimit -n` being
 * raised to something like 8192, which is not a correctness argument: it is a request that the
 * operator's shell be configured a particular way, and a run that fails because a descriptor could
 * not be opened is a run that failed for an avoidable reason.
 *
 * This ledger is the CONCURRENT gauge. It counts what is open right now, across every category, and
 * it is consulted BEFORE an `open` rather than after — because a cap enforced after the fact has
 * already been exceeded.
 *
 * ── Two counters, deliberately not merged ───────────────────────────────────────
 *   14B.0C enforcer   — CUMULATIVE source opens. Untouched by this milestone.
 *   this ledger       — CONCURRENT opens, all categories. New.
 *
 * Merging them would break both: routing 1024 partition opens through the cumulative counter would
 * trip `files_opened_cap_exceeded` on a perfectly bounded run, and letting the concurrent gauge reset
 * the cumulative one would erase the bound 14B.0C actually wanted.
 *
 * ── Latching ────────────────────────────────────────────────────────────────────
 * The first breach latches, exactly as the 14B.0C enforcer latches: a caller that ignored a refusal
 * must not be able to obtain a clean answer afterwards, and a second breach reported over the first
 * would rewrite the run's history.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O. It has no `node:fs` import and holds no descriptor: it counts reservations, and
 *     the caller owns the actual handle.
 *   - reads an environment variable, or writes to stdout or stderr.
 *   - sees a path, a file name, a row, a cell or a join key. It is handed a CATEGORY.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

// ─── Version ──────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_OPEN_HANDLE_LEDGER_VERSION = 1 as const;

// ─── Categories ───────────────────────────────────────────────────────────────

/**
 * Every kind of descriptor a full-scan benchmark can hold open, enumerated so the global cap is
 * demonstrably global.
 *
 * § 3 requires the total — source files, partition files, the private metric artifact and control
 * artifacts — to stay at or below `maxFilesOpened`. An enum with four members is how that claim
 * becomes checkable: a future category that is not in this list cannot be reserved at all.
 */
export const BRAZIL_RECEITA_FULL_JOIN_HANDLE_CATEGORIES = [
  'source_file',
  'partition_file',
  'private_metric_artifact',
  'control_artifact',
] as const;

export type BrazilReceitaFullJoinHandleCategory =
  (typeof BRAZIL_RECEITA_FULL_JOIN_HANDLE_CATEGORIES)[number];

export function isBrazilReceitaFullJoinHandleCategory(
  value: unknown,
): value is BrazilReceitaFullJoinHandleCategory {
  return (
    typeof value === 'string' &&
    (BRAZIL_RECEITA_FULL_JOIN_HANDLE_CATEGORIES as readonly string[]).includes(value)
  );
}

// ─── Terminal code ────────────────────────────────────────────────────────────

/**
 * The single abort code a global-cap refusal raises.
 *
 * Deliberately the SAME string 14B.0C uses for its cumulative cap. They are different counters, but
 * they are the same fact from an operator's point of view — the run wanted more descriptors than it
 * was authorized to hold — and inventing a second code would make a report harder to read without
 * making it more precise. The `category` field says which pool ran out.
 */
export const BRAZIL_RECEITA_FULL_JOIN_FILES_OPENED_CAP_CODE = 'files_opened_cap_exceeded' as const;

export interface BrazilReceitaFullJoinHandleReservationBreach {
  readonly code: typeof BRAZIL_RECEITA_FULL_JOIN_FILES_OPENED_CAP_CODE;
  readonly category: BrazilReceitaFullJoinHandleCategory;
  /** What the count WOULD have become. A small integer, never a path or a name. */
  readonly projectedOpenFiles: number;
  readonly maxFilesOpened: number;
}

export type BrazilReceitaFullJoinHandleReservation =
  | { readonly ok: true }
  | { readonly ok: false; readonly breach: BrazilReceitaFullJoinHandleReservationBreach };

// ─── Cap resolution ───────────────────────────────────────────────────────────

export type BrazilReceitaFullJoinHandleCapRejection =
  | 'cap_absent'
  | 'cap_not_a_number'
  | 'cap_not_finite'
  | 'cap_not_an_integer'
  | 'cap_not_positive'
  | 'partition_cap_above_global_cap';

/**
 * Validates the two handle caps together, or refuses.
 *
 * They are validated TOGETHER because the interesting failure is relational: a
 * `maxOpenPartitionFiles` above `maxFilesOpened` is a partition pool that is allowed to exhaust the
 * global budget on its own, leaving no descriptor for the source file the join has to re-read. Each
 * cap in isolation would look fine.
 */
export function resolveBrazilReceitaFullJoinHandleCaps(
  maxFilesOpened: unknown,
  maxOpenPartitionFiles: unknown,
):
  | { readonly ok: true; readonly maxFilesOpened: number; readonly maxOpenPartitionFiles: number }
  | { readonly ok: false; readonly rejections: readonly BrazilReceitaFullJoinHandleCapRejection[] } {
  const rejections: BrazilReceitaFullJoinHandleCapRejection[] = [];

  function check(value: unknown): number | null {
    if (value === undefined || value === null) {
      rejections.push('cap_absent');
      return null;
    }
    if (typeof value !== 'number') {
      rejections.push('cap_not_a_number');
      return null;
    }
    if (!Number.isFinite(value)) {
      // `Infinity` is the dangerous input: syntactically a number, semantically "no cap".
      rejections.push('cap_not_finite');
      return null;
    }
    if (!Number.isInteger(value)) {
      rejections.push('cap_not_an_integer');
      return null;
    }
    if (value <= 0) {
      // Zero is refused here, unlike in the 14B.0C envelope where `0` authorizes nothing at all: a
      // run that may hold zero descriptors cannot read its own input, so zero is a typo.
      rejections.push('cap_not_positive');
      return null;
    }
    return value;
  }

  const global = check(maxFilesOpened);
  const partition = check(maxOpenPartitionFiles);
  if (rejections.length > 0) return { ok: false, rejections };

  if ((partition as number) > (global as number)) {
    rejections.push('partition_cap_above_global_cap');
    return { ok: false, rejections };
  }

  return {
    ok: true,
    maxFilesOpened: global as number,
    maxOpenPartitionFiles: partition as number,
  };
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinOpenHandleLedger {
  /**
   * Reserves ONE slot, or refuses. Must be called BEFORE the `open` it authorizes.
   *
   * The caller is responsible for `release`ing the slot when it closes the handle. A caller that
   * opens without reserving defeats the ledger — which is why every open in this milestone's path
   * goes through a port that reserves first.
   */
  reserve(category: BrazilReceitaFullJoinHandleCategory): BrazilReceitaFullJoinHandleReservation;
  /** Releases one slot. Never goes below zero, and never un-latches a breach. */
  release(category: BrazilReceitaFullJoinHandleCategory): void;
  openNow(): number;
  openNowIn(category: BrazilReceitaFullJoinHandleCategory): number;
  /** The high-water mark across the whole run — the figure § 9 calls `filesOpenedPeak`. */
  peakOpen(): number;
  maxFilesOpened(): number;
  breach(): BrazilReceitaFullJoinHandleReservationBreach | null;
}

/**
 * Wraps any `open`/`close` filesystem port so every descriptor it hands out is reserved from the
 * ledger first and released when it is closed.
 *
 * This decorator is the reason the global cap is actually global. The alternative — asking every
 * caller to remember to reserve — is the kind of discipline that holds until the first new call site,
 * and the streaming reader has its own `open` deep inside a traversal that this milestone has no
 * business rewriting. Wrapping the PORT catches all of them, including paths written later.
 *
 * A refused reservation THROWS rather than returning a failure, because that is the one behaviour the
 * wrapped ports already handle: both the reader and the join stage treat a throwing `open` as an open
 * failure and abort cleanly. The ledger's latched breach survives the throw, so a caller that wants
 * the precise reason reads `breach()` afterwards instead of inferring it.
 */
export function withBrazilReceitaFullJoinLedgerAccounting<
  TPort extends { open(filePath: string): number; close(handle: number): void },
>(
  port: TPort,
  ledger: BrazilReceitaFullJoinOpenHandleLedger,
  category: BrazilReceitaFullJoinHandleCategory,
): TPort {
  return {
    ...port,
    open(filePath: string): number {
      const reservation = ledger.reserve(category);
      if (!reservation.ok) {
        throw new Error(BRAZIL_RECEITA_FULL_JOIN_FILES_OPENED_CAP_CODE);
      }
      try {
        return port.open(filePath);
      } catch (error) {
        // The open failed, so no descriptor exists and the slot must go back. Without this a run
        // would lose budget on every failed open until it could not open anything at all.
        ledger.release(category);
        throw error;
      }
    },
    close(handle: number): void {
      try {
        port.close(handle);
      } finally {
        // Released even when `close` throws: the descriptor is gone from this run's control either
        // way, and holding the slot would shrink the budget for a failure the caller already reports.
        ledger.release(category);
      }
    },
  };
}

export function createBrazilReceitaFullJoinOpenHandleLedger(
  maxFilesOpened: number,
): BrazilReceitaFullJoinOpenHandleLedger {
  const open = new Map<BrazilReceitaFullJoinHandleCategory, number>();
  for (const category of BRAZIL_RECEITA_FULL_JOIN_HANDLE_CATEGORIES) open.set(category, 0);

  let total = 0;
  let peak = 0;
  let latched: BrazilReceitaFullJoinHandleReservationBreach | null = null;

  return {
    reserve(category) {
      if (latched !== null) return { ok: false, breach: latched };

      const projectedOpenFiles = total + 1;
      if (projectedOpenFiles > maxFilesOpened) {
        latched = {
          code: BRAZIL_RECEITA_FULL_JOIN_FILES_OPENED_CAP_CODE,
          category,
          projectedOpenFiles,
          maxFilesOpened,
        };
        return { ok: false, breach: latched };
      }

      open.set(category, (open.get(category) ?? 0) + 1);
      total = projectedOpenFiles;
      if (total > peak) peak = total;
      return { ok: true };
    },

    release(category) {
      const current = open.get(category) ?? 0;
      if (current <= 0) {
        // A release without a matching reservation is a bookkeeping bug in the caller. It is
        // ABSORBED rather than thrown, because throwing here would replace an accurate abort code
        // with an exception raised while the run was already on its way out — and it is clamped
        // rather than allowed to go negative, because a negative count would silently create budget.
        return;
      }
      open.set(category, current - 1);
      total -= 1;
    },

    openNow() {
      return total;
    },

    openNowIn(category) {
      return open.get(category) ?? 0;
    },

    peakOpen() {
      return peak;
    },

    maxFilesOpened() {
      return maxFilesOpened;
    },

    breach() {
      return latched;
    },
  };
}
