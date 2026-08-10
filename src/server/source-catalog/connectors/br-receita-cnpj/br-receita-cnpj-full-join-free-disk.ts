/**
 * BR Receita CNPJ — FREE-DISK ENFORCEMENT (BR-SOURCE-14B.0F § 4).
 *
 * The third gap 14B.0E found: `maxTemporaryStorageBytes` bounds how much the run may WRITE, and says
 * nothing about whether the disk can accept it. Those are different questions, and only the second
 * one predicts the failure that actually hurts — a volume filling up mid-pass, on a machine whose
 * home directory, dataset and workspace may all live on the same filesystem.
 *
 * ── Two thresholds, not one ─────────────────────────────────────────────────────
 *   `minimumFreeDiskBeforeStart` (12 GiB) — checked once, before the workspace exists. Generous
 *      relative to the 4 GiB storage cap on purpose: starting a six-hour run on a volume with barely
 *      more headroom than the run needs is how an unrelated process's log file ends a benchmark.
 *   `minimumFreeDiskReserve` (8 GiB)      — re-checked before each relevant write block, and it is a
 *      RESERVE rather than a floor of zero. The run stops while the volume is still usable, so the
 *      operator is left with a machine that works and a `free_disk_reserve_breached` code, instead of
 *      a full disk and a process that died somewhere unspecified.
 *
 * ── The measurement must be about the RIGHT filesystem ──────────────────────────
 * § 4 is explicit: the probe answers for the filesystem that contains the workspace, not for some
 * other volume. That is why the probe takes a PATH — the workspace parent before creation, the
 * workspace itself afterwards — rather than being a process-wide "free space" reading. On a machine
 * where `/` has 400 GB and the external volume holding the dataset has 3 GB, a process-wide answer
 * would be confidently wrong.
 *
 * ── An unmeasurable disk is a stopped run ───────────────────────────────────────
 * Same asymmetry 14B.0C draws for memory, for the same reason: a cap you cannot measure is not a cap.
 * A probe that throws, returns a non-number, returns a negative, or returns a non-finite value is
 * `free_disk_measurement_unavailable`, and that is terminal. It is NOT treated as "probably fine" —
 * the whole point of the check is that the alternative to knowing is a filled volume.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs` or `node:child_process`. § 4 forbids shelling out to `df`, and the way that
 *     is guaranteed rather than promised is that this module cannot spawn anything: the measurement
 *     arrives through an injected probe, whose real implementation lives in the engine's filesystem
 *     adapter and uses `statfs`.
 *   - reads an environment variable, or writes to stdout or stderr.
 *   - reports a path. A refusal names a THRESHOLD and a shortfall in bytes, never a destination.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

// ─── Version & proposed thresholds ────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_FREE_DISK_POLICY_VERSION = 1 as const;

/**
 * The § 4 thresholds, carried forward from the 14B.0E profile unchanged.
 *
 * PROPOSED, not approved. They are the numbers an owner would be authorizing, written down so the
 * authorization is about a concrete thing.
 */
export const BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_TEMPORARY_STORAGE_BYTES = 4_294_967_296 as const;
export const BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START = 12_884_901_888 as const;
export const BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE = 8_589_934_592 as const;

// ─── Terminal codes ───────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_FREE_DISK_ABORT_CODES = [
  'insufficient_free_disk_before_start',
  'free_disk_reserve_breached',
  'free_disk_measurement_unavailable',
] as const;

export type BrazilReceitaFullJoinFreeDiskAbortCode =
  (typeof BRAZIL_RECEITA_FULL_JOIN_FREE_DISK_ABORT_CODES)[number];

/** Which of the two thresholds was being evaluated. Never a path. */
export type BrazilReceitaFullJoinFreeDiskThreshold = 'before_start' | 'reserve';

export interface BrazilReceitaFullJoinFreeDiskBreach {
  readonly code: BrazilReceitaFullJoinFreeDiskAbortCode;
  readonly threshold: BrazilReceitaFullJoinFreeDiskThreshold;
  /** `null` when the probe could not answer at all. */
  readonly availableBytes: number | null;
  readonly requiredBytes: number;
}

export type BrazilReceitaFullJoinFreeDiskOutcome =
  | { readonly ok: true; readonly availableBytes: number }
  | { readonly ok: false; readonly breach: BrazilReceitaFullJoinFreeDiskBreach };

// ─── Probe port ───────────────────────────────────────────────────────────────

/**
 * The one measurement this module needs: how many bytes are available to THIS user on the filesystem
 * containing `targetPath`.
 *
 * "Available to this user" rather than "free", because those differ: most filesystems reserve a slice
 * for the superuser, and a run that treats the reserved slice as usable will hit `ENOSPC` while its
 * own arithmetic still says there is room. The real adapter therefore uses the available-blocks
 * figure, not the free-blocks one.
 */
export type BrazilReceitaFullJoinFreeDiskProbe = (targetPath: string) => number;

// ─── Threshold resolution ─────────────────────────────────────────────────────

export type BrazilReceitaFullJoinFreeDiskThresholdRejection =
  | 'threshold_absent'
  | 'threshold_not_a_number'
  | 'threshold_not_finite'
  | 'threshold_not_an_integer'
  | 'threshold_not_positive'
  | 'reserve_above_before_start'
  | 'reserve_below_temporary_storage_cap';

export interface BrazilReceitaFullJoinFreeDiskThresholds {
  readonly minimumFreeDiskBeforeStart: number;
  readonly minimumFreeDiskReserve: number;
  readonly maxTemporaryStorageBytes: number;
}

export type BrazilReceitaFullJoinFreeDiskThresholdResolution =
  | { readonly ok: true; readonly thresholds: BrazilReceitaFullJoinFreeDiskThresholds }
  | {
      readonly ok: false;
      readonly rejections: readonly BrazilReceitaFullJoinFreeDiskThresholdRejection[];
    };

/**
 * Validates the three related figures together, or refuses.
 *
 * Together, because two of the three constraints are RELATIONAL and each figure looks fine alone:
 *
 *   - a reserve above the before-start threshold describes a run that is refused the moment it
 *     starts writing even though its preflight passed, which is a configuration that can never
 *     succeed;
 *   - a reserve below the temporary-storage cap describes a run authorized to write more than it is
 *     required to leave free — so the storage cap and the disk reserve would be able to disagree
 *     about the same volume, and the run would discover which one was right by filling it.
 */
export function resolveBrazilReceitaFullJoinFreeDiskThresholds(
  input: Readonly<{
    minimumFreeDiskBeforeStart?: unknown;
    minimumFreeDiskReserve?: unknown;
    maxTemporaryStorageBytes?: unknown;
  }> | null | undefined,
): BrazilReceitaFullJoinFreeDiskThresholdResolution {
  const rejections: BrazilReceitaFullJoinFreeDiskThresholdRejection[] = [];

  function check(value: unknown): number | null {
    if (value === undefined || value === null) {
      rejections.push('threshold_absent');
      return null;
    }
    if (typeof value !== 'number') {
      rejections.push('threshold_not_a_number');
      return null;
    }
    if (!Number.isFinite(value)) {
      rejections.push('threshold_not_finite');
      return null;
    }
    if (!Number.isInteger(value)) {
      rejections.push('threshold_not_an_integer');
      return null;
    }
    if (value <= 0) {
      rejections.push('threshold_not_positive');
      return null;
    }
    return value;
  }

  const beforeStart = check(input?.minimumFreeDiskBeforeStart);
  const reserve = check(input?.minimumFreeDiskReserve);
  const storageCap = check(input?.maxTemporaryStorageBytes);
  if (rejections.length > 0) return { ok: false, rejections };

  if ((reserve as number) > (beforeStart as number)) rejections.push('reserve_above_before_start');
  if ((reserve as number) < (storageCap as number)) {
    rejections.push('reserve_below_temporary_storage_cap');
  }
  if (rejections.length > 0) return { ok: false, rejections };

  return {
    ok: true,
    thresholds: Object.freeze({
      minimumFreeDiskBeforeStart: beforeStart as number,
      minimumFreeDiskReserve: reserve as number,
      maxTemporaryStorageBytes: storageCap as number,
    }),
  };
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Reads the probe and validates the reading, or reports it unavailable.
 *
 * Every failure shape is folded into one code because they are one fact: the run cannot prove there
 * is room. A thrown probe, a `NaN`, a string and a negative are all "no measurement", and giving each
 * its own terminal code would suggest a caller might treat them differently. None may continue.
 */
function measure(
  probe: BrazilReceitaFullJoinFreeDiskProbe,
  targetPath: string,
): number | null {
  let available: unknown;
  try {
    available = probe(targetPath);
  } catch {
    return null;
  }
  if (typeof available !== 'number') return null;
  if (!Number.isFinite(available)) return null;
  if (available < 0) return null;
  return available;
}

function evaluate(
  probe: BrazilReceitaFullJoinFreeDiskProbe,
  targetPath: string,
  requiredBytes: number,
  threshold: BrazilReceitaFullJoinFreeDiskThreshold,
): BrazilReceitaFullJoinFreeDiskOutcome {
  const availableBytes = measure(probe, targetPath);
  if (availableBytes === null) {
    return {
      ok: false,
      breach: {
        code: 'free_disk_measurement_unavailable',
        threshold,
        availableBytes: null,
        requiredBytes,
      },
    };
  }
  if (availableBytes < requiredBytes) {
    return {
      ok: false,
      breach: {
        code:
          threshold === 'before_start'
            ? 'insufficient_free_disk_before_start'
            : 'free_disk_reserve_breached',
        threshold,
        availableBytes,
        requiredBytes,
      },
    };
  }
  return { ok: true, availableBytes };
}

/**
 * The PREFLIGHT check: run once, against the workspace PARENT, before the workspace is created.
 *
 * Against the parent rather than the workspace because the workspace does not exist yet — and that
 * ordering is the point. A run that created its workspace and then discovered the volume was full
 * would have to clean up something it should never have made.
 */
export function assertBrazilReceitaFullJoinFreeDiskBeforeStart(
  workspaceParentDirectory: string,
  thresholds: BrazilReceitaFullJoinFreeDiskThresholds,
  probe: BrazilReceitaFullJoinFreeDiskProbe,
): BrazilReceitaFullJoinFreeDiskOutcome {
  return evaluate(
    probe,
    workspaceParentDirectory,
    thresholds.minimumFreeDiskBeforeStart,
    'before_start',
  );
}

/**
 * The IN-RUN check: run before each relevant write block, against the live workspace directory.
 *
 * The path differs from the preflight's on purpose. `mkdtemp` cannot cross a filesystem boundary, so
 * in practice the two land on the same volume — but "in practice" is not a guarantee, and probing the
 * directory that is actually being written to removes the assumption entirely.
 */
export function assertBrazilReceitaFullJoinFreeDiskReserve(
  workspaceDirectory: string,
  thresholds: BrazilReceitaFullJoinFreeDiskThresholds,
  probe: BrazilReceitaFullJoinFreeDiskProbe,
): BrazilReceitaFullJoinFreeDiskOutcome {
  return evaluate(probe, workspaceDirectory, thresholds.minimumFreeDiskReserve, 'reserve');
}

// ─── Write-block pacing ───────────────────────────────────────────────────────

/**
 * How many reference records one "write block" holds for reserve-check purposes.
 *
 * A `statfs` per 16-byte record would dominate the run's syscall budget and measure nothing new: the
 * volume cannot lose 8 GiB between two consecutive records. A block of 4096 records is 64 KiB of
 * writes between checks — far below any plausible free-space swing, and cheap enough to be checked
 * for the whole pass.
 */
export const BRAZIL_RECEITA_FULL_JOIN_FREE_DISK_CHECK_RECORD_INTERVAL = 4_096 as const;

/**
 * Returns a predicate that answers "is a reserve re-check due?".
 *
 * Stateful, and deliberately a FIXED interval rather than the widening schedule the resource
 * checkpoints use. The two are pacing different risks: a resource checkpoint appends to a list, so
 * its cost grows with the number of checks, while a free-disk probe retains nothing. There is no
 * memory reason to check the disk less often as the run goes on, and a run that has been writing for
 * five hours is exactly when the volume is most likely to have filled.
 */
export function createBrazilReceitaFullJoinFreeDiskCheckSchedule(
  recordInterval: number = BRAZIL_RECEITA_FULL_JOIN_FREE_DISK_CHECK_RECORD_INTERVAL,
): (recordsWritten: number) => boolean {
  const interval =
    Number.isInteger(recordInterval) && recordInterval > 0
      ? recordInterval
      : BRAZIL_RECEITA_FULL_JOIN_FREE_DISK_CHECK_RECORD_INTERVAL;
  let nextAt = interval;
  return (recordsWritten: number): boolean => {
    if (recordsWritten < nextAt) return false;
    nextAt = recordsWritten + interval;
    return true;
  };
}
