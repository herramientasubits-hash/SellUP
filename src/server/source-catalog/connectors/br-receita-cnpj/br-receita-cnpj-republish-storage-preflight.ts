/**
 * BR Receita CNPJ — the REPEATED SAME-PERIOD REPUBLISH storage preflight.
 * Milestone: BR-COMPACT-SNAPSHOT-PRODUCTIZATION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The DECISION here is pure. The one impure function takes an injected SQL port
 * and calls a database function; it creates no client, reads no env, knows no
 * network address, and writes nothing at all.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this defends ───────────────────────────────────────────────────────
 *
 * A same-period republish is ALLOWED, and the FIRST one costs nothing this module
 * needs to say anything about: run B republishes period N, run A is demoted to
 * `superseded`, and A's rows stay because a batch pinned to A still reads them.
 *
 * 🔴 The cost is CUMULATIVE. Every further same-period republish leaves another
 * full national partition behind — ~29 GB each — and retention may not reclaim any
 * of them while period N is still a retained generation. Two republishes of one
 * month is three national partitions of that month alone, which is how a 150 GB
 * disk fills without a single thing having gone wrong.
 *
 * So the SECOND same-period republish stops being AUTOMATIC. That is the whole
 * scope of this module: it withholds an automatic start and names the reason.
 *
 * ── 🔴 What it deliberately does NOT do ─────────────────────────────────────
 *
 *   · it does not FORBID the republish. `requires_storage_review` is a hand-off to
 *     a human with the disk numbers in front of them, not a refusal;
 *   · it does not delete a superseded retained run to make room. Retention is the
 *     only thing that removes storage, and it refuses both retained generations;
 *   · it does not infer whether a batch is ACTIVELY pinned to those runs. This
 *     repository holds no authoritative live-pin registry, and inventing one would
 *     be a guess wearing the clothes of a fact.
 *
 * ── Where the count comes from ──────────────────────────────────────────────
 *
 * From the database, over runs whose partition is PHYSICALLY present. A run row
 * whose storage was already dropped occupies no disk, and counting it would
 * withhold a republish over space nobody is using.
 */

/** The database function that counts the period's physically-present publications. */
export const BR_RECEITA_REPUBLISH_STORAGE_CHECK_FUNCTION =
  'br_receita_same_period_republish_storage_check' as const;

/**
 * The code the owner named for this outcome, verbatim.
 *
 * 🔴 One constant, exported, so the operator surface, the gateway failure and the
 * suite are all quoting the SAME string rather than three copies of it.
 */
export const BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE =
  'REPEATED_SAME_PERIOD_REPUBLISH_REQUIRES_STORAGE_REVIEW' as const;

/**
 * The minimal read-only SQL surface this preflight needs.
 *
 * 🔴 Declared HERE rather than imported from the write gateway, so the dependency
 * runs preflight → (nothing) and the gateway may import this module without a
 * cycle. Structurally satisfied by the same `pg`-shaped client everything else in
 * this connector is handed.
 */
export interface BrReceitaPreflightSqlPort {
  query(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type BrReceitaRepublishStorageStatus =
  /** No accumulation yet: at most one physically-present publication of this period. */
  | 'ok'
  /** One published plus at least one superseded partition already on disk. */
  | 'requires_storage_review'
  /** The period was not a canonical `YYYY-MM`. */
  | 'invalid_input'
  /** The database answered something this module does not recognise. */
  | 'unexpected_status';

export interface BrReceitaRepublishStorageCounts {
  /** Physically-present `published` runs of the target period. */
  readonly publishedRuns: number;
  /** Physically-present `superseded` runs of the target period. */
  readonly supersededRuns: number;
}

export interface BrReceitaRepublishStorageVerdict {
  readonly status: BrReceitaRepublishStorageStatus;
  readonly sourcePeriod: string | null;
  readonly counts: BrReceitaRepublishStorageCounts;
  /** The owner's code, present only when the automatic start is withheld. */
  readonly code: typeof BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE | null;
  /** Whether a national load may start WITHOUT a human storage review. */
  readonly mayStartNationalLoadAutomatically: boolean;
}

const CANONICAL_PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * The verdict, from counts alone.
 *
 * 🔴 Fail-closed on anything it cannot read as a number. A count that arrived as
 * `undefined` because a column was renamed must not read as "zero, so go ahead" —
 * zero is the permissive answer here, and the permissive answer is never the one
 * to infer from missing data.
 */
export function decideBrReceitaRepublishStorage(
  sourcePeriod: string,
  counts: { readonly publishedRuns: unknown; readonly supersededRuns: unknown },
): BrReceitaRepublishStorageVerdict {
  const published = toCount(counts.publishedRuns);
  const superseded = toCount(counts.supersededRuns);

  if (!CANONICAL_PERIOD.test(sourcePeriod)) {
    return {
      status: 'invalid_input',
      sourcePeriod: null,
      counts: { publishedRuns: published ?? 0, supersededRuns: superseded ?? 0 },
      code: null,
      mayStartNationalLoadAutomatically: false,
    };
  }

  if (published === null || superseded === null) {
    return {
      status: 'unexpected_status',
      sourcePeriod,
      counts: { publishedRuns: published ?? 0, supersededRuns: superseded ?? 0 },
      code: null,
      mayStartNationalLoadAutomatically: false,
    };
  }

  const accumulating = published >= 1 && superseded >= 1;
  return {
    status: accumulating ? 'requires_storage_review' : 'ok',
    sourcePeriod,
    counts: { publishedRuns: published, supersededRuns: superseded },
    code: accumulating ? BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE : null,
    mayStartNationalLoadAutomatically: !accumulating,
  };
}

function toCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  // `count(*)` comes back from `pg` as a string bigint unless a type parser says otherwise.
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

/**
 * Ask the database whether a national load for this period may start automatically.
 *
 * 🔴 Read-only, and provably so: the statement is a `SELECT` over a `STABLE`
 * function that itself only counts. There is no branch of this call that removes a
 * partition, demotes a run or writes a row.
 */
export async function checkBrReceitaRepublishStorage(
  sql: BrReceitaPreflightSqlPort,
  sourcePeriod: string,
): Promise<BrReceitaRepublishStorageVerdict> {
  const result = await sql.query(
    `SELECT public.${BR_RECEITA_REPUBLISH_STORAGE_CHECK_FUNCTION}($1::text) AS outcome`,
    [sourcePeriod],
  );

  const raw = result.rows[0]?.outcome;
  const outcome: Record<string, unknown> =
    typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : ((raw ?? {}) as Record<string, unknown>);

  if (outcome.status === 'invalid_input') {
    return {
      status: 'invalid_input',
      sourcePeriod: null,
      counts: { publishedRuns: 0, supersededRuns: 0 },
      code: null,
      mayStartNationalLoadAutomatically: false,
    };
  }

  // 🔴 The verdict is RE-DERIVED here from the counts, rather than trusting the
  // database's own `status` string. The two agree today; if they ever stopped
  // agreeing, the safe half is the one that reads the numbers.
  const verdict = decideBrReceitaRepublishStorage(sourcePeriod, {
    publishedRuns: outcome.published_runs,
    supersededRuns: outcome.superseded_runs,
  });

  if (verdict.status === 'ok' && outcome.status !== 'ok') {
    return { ...verdict, status: 'unexpected_status', mayStartNationalLoadAutomatically: false };
  }
  return verdict;
}

export const BR_RECEITA_REPUBLISH_STORAGE_PREFLIGHT_CONTRACT = {
  milestone: 'BR-COMPACT-SNAPSHOT-PRODUCTIZATION',
  code: BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE,
  guardFunction: BR_RECEITA_REPUBLISH_STORAGE_CHECK_FUNCTION,
  triggersWhen: 'one_published_plus_at_least_one_superseded_physically_present_run_of_the_period',
  countsOnlyPhysicallyPresentPartitions: true,
  samePeriodRepublishIsStillAllowed: true,
  forbidsTheRepublish: false,
  withholdsTheAutomaticStart: true,
  deletesASupersededRetainedRunToMakeRoom: false,
  infersActivePins: false,
  writesAnything: false,
  failsClosedOnUnreadableCounts: true,
} as const;
