/**
 * BR Receita CNPJ — publication-generation RETENTION.
 * Milestone: BR-PROD-STORAGE-RIGHT-SIZING.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The DECISION here is pure. The one impure function takes an injected SQL port
 * and calls a database function; it creates no client, reads no env and knows no
 * network address.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The policy ──────────────────────────────────────────────────────────────
 *
 * Keep the CURRENT published period and the PREVIOUS published period. Retire
 * everything older, one run at a time.
 *
 * 🔴 No time TTL is invented. This repository records no authoritative maximum
 * lifetime for an Agent1 run — the only TTLs it has are a provider phone-reveal
 * cache and `provider_seen`, neither of which bounds how long a batch may hold a
 * pin. So the safety boundary is a GENERATION COUNT, which is a fact this system
 * owns, rather than a duration, which would be a number somebody made up.
 *
 * ── Why "previous" is not sentimentality ────────────────────────────────────
 *
 * An Agent1 run pins `{sourcePeriod, snapshotRunId}` once and reads that exact
 * publication until it finishes. Month N+1 can publish while such a run is still
 * mid-flight against month N. Deleting N the moment N+1 appears would turn a
 * live run's reads into `NOT_IN_PINNED_PUBLICATION` — a silent wrong answer, not
 * an error, because the pinned reader does not re-resolve.
 *
 * ── 🔴 Why a same-period republish is the sharp edge ────────────────────────
 *
 * When run B republishes period N, run A is demoted to `superseded` — and A's
 * ROWS stay. That is deliberate: `readBrReceitaPinnedSnapshot` does NOT re-check
 * `publish_state` (`reChecksPublishStateAtReadTime: false`), so a batch pinned to
 * A keeps reading A. A retention rule that reasoned "superseded means nobody
 * needs it" would delete exactly the publication a live run is reading. So a
 * `superseded` run is protected on the same terms as a `published` one: by its
 * PERIOD's generation, not by its own state.
 *
 * ── Where the guard actually lives ──────────────────────────────────────────
 *
 * In the database, in `br_receita_drop_run_partition`. This module can compute
 * the same verdict — and does, so a caller can see what would happen before
 * anything happens — but the decision that matters is taken inside the function
 * that does the dropping, under `FOR UPDATE` on the run row. A caller-side check
 * protects only the callers that remember it.
 */

import {
  BR_RECEITA_DROP_PARTITION_FUNCTION,
  type BrReceitaSqlExecutor,
} from './br-receita-cnpj-monthly-snapshot-write-gateway';
import { BR_RECEITA_CNPJ_COUNTRY_CODE, BR_RECEITA_CNPJ_SOURCE_KEY } from './br-receita-cnpj-types';
import { parseSourcePeriod } from '../../source-period';

/** How many published periods survive: the current one and the one before it. */
export const BR_RECEITA_RETAINED_PUBLICATION_GENERATIONS = 2 as const;

/** The publish states a run can be in and still be pinnable by a live batch. */
export const BR_RECEITA_PINNABLE_PUBLISH_STATES: readonly string[] = [
  'published',
  'superseded',
] as const;

export type BrReceitaRetentionVerdict =
  | 'retire'
  | 'keep_current_generation'
  | 'keep_previous_generation'
  | 'keep_unknown_period'
  | 'retire_never_published';

export interface BrReceitaRetentionCandidate {
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly publishState: string;
}

export interface BrReceitaRetentionDecision {
  readonly snapshotRunId: string;
  readonly verdict: BrReceitaRetentionVerdict;
  readonly mayDrop: boolean;
  readonly reason: string;
}

/**
 * The published periods that must survive, newest first.
 *
 * Sorted lexicographically, which for the canonical `YYYY-MM` grain is the same
 * as chronologically — the format is fixed-width and zero-padded, and
 * `parseSourcePeriod` is what guarantees that before a value reaches here.
 */
export function brReceitaRetainedPeriods(
  publishedPeriods: readonly string[],
): readonly string[] {
  const canonical = publishedPeriods
    .map((period) => parseSourcePeriod(period))
    .flatMap((parsed) => (parsed.valid ? [parsed.sourcePeriod] : []));

  return [...new Set(canonical)]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, BR_RECEITA_RETAINED_PUBLICATION_GENERATIONS);
}

/**
 * What retention would do to one run, and why.
 *
 * 🔴 Fail-closed on an unrecognised period. A candidate whose period is not in
 * the published set at all could be a period whose publication this caller
 * simply did not fetch, and "I did not see it" is not the same fact as "it is
 * old". Refuse, and let a caller that really holds the whole published set say
 * so by including it.
 */
export function decideBrReceitaRetention(
  candidate: BrReceitaRetentionCandidate,
  publishedPeriods: readonly string[],
): BrReceitaRetentionDecision {
  const base = { snapshotRunId: candidate.snapshotRunId };

  if (!BR_RECEITA_PINNABLE_PUBLISH_STATES.includes(candidate.publishState)) {
    // `preparing` / `failed` / `rolled_back` were never published: the publish
    // transition and the fail path both refuse to move a `published` run, so no
    // pin can name them. Staging debris, always retirable.
    return {
      ...base,
      verdict: 'retire_never_published',
      mayDrop: true,
      reason: `run_never_reached_publication:${candidate.publishState}`,
    };
  }

  const retained = brReceitaRetainedPeriods(publishedPeriods);
  const parsed = parseSourcePeriod(candidate.sourcePeriod);

  if (!parsed.valid) {
    return {
      ...base,
      verdict: 'keep_unknown_period',
      mayDrop: false,
      reason: `candidate_period_${parsed.reason}`,
    };
  }

  if (retained.length === 0 || !publishedPeriods.includes(parsed.sourcePeriod)) {
    return {
      ...base,
      verdict: 'keep_unknown_period',
      mayDrop: false,
      reason: 'candidate_period_absent_from_supplied_published_set',
    };
  }

  const generation = retained.indexOf(parsed.sourcePeriod);
  if (generation === 0) {
    return {
      ...base,
      verdict: 'keep_current_generation',
      mayDrop: false,
      reason: 'period_is_the_current_publication',
    };
  }
  if (generation > 0) {
    return {
      ...base,
      verdict: 'keep_previous_generation',
      mayDrop: false,
      reason: 'period_is_the_previous_publication_and_may_still_be_pinned',
    };
  }

  return {
    ...base,
    verdict: 'retire',
    mayDrop: true,
    reason: 'period_is_older_than_the_retained_generations',
  };
}

// ─── Execution ──────────────────────────────────────────────────────────────

export type BrReceitaRetentionStatus =
  | 'dropped'
  | 'already_absent'
  | 'refused_retained_generation'
  /**
   * 🔴 The database could not compute the retained generations at all — no BR period is
   * `published` — while the run in hand HAD reached publication. It refuses rather than guessing;
   * see the fail-closed branch in `br_receita_drop_run_partition`.
   */
  | 'refused_indeterminate_retention'
  | 'run_not_found'
  | 'invalid_input'
  | 'unexpected_status';

export interface BrReceitaRetentionOutcome {
  readonly status: BrReceitaRetentionStatus;
  readonly snapshotRunId: string;
  readonly partition: string | null;
  readonly sourcePeriod: string | null;
  readonly publishState: string | null;
}

/**
 * Retire ONE run's storage.
 *
 * 🔴 One run id, and no period argument at all. There is no period-wide variant
 * of this call and none can be written against this signature — the shape is
 * what forbids "delete the month", not a rule in a comment.
 *
 * The verdict is the DATABASE's. This function does not pre-check, because a
 * pre-check performed here and a decision taken there is two decisions that can
 * disagree; `br_receita_drop_run_partition` takes `FOR UPDATE` on the run row and
 * decides once. `decideBrReceitaRetention` exists to let a caller PREVIEW that
 * verdict, never to substitute for it.
 */
export async function retireBrReceitaSnapshotRun(
  sql: BrReceitaSqlExecutor,
  snapshotRunId: string,
): Promise<BrReceitaRetentionOutcome> {
  const result = await sql.query(
    `SELECT public.${BR_RECEITA_DROP_PARTITION_FUNCTION}($1::uuid) AS outcome`,
    [snapshotRunId],
  );

  const raw = result.rows[0]?.outcome;
  const outcome: Record<string, unknown> =
    typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : ((raw ?? {}) as Record<string, unknown>);

  const status = typeof outcome.status === 'string' ? outcome.status : 'unexpected_status';
  // 🔴 Every status the database function can return, enumerated. A status missing from this list
  // is reported as `unexpected_status`, which is safe but INDISTINGUISHABLE from a real refusal —
  // so the list drifting behind the SQL is a defect, and the suite asserts against it directly.
  const known: readonly BrReceitaRetentionStatus[] = [
    'dropped',
    'already_absent',
    'refused_retained_generation',
    'refused_indeterminate_retention',
    'run_not_found',
    'invalid_input',
  ];

  return {
    status: (known as readonly string[]).includes(status)
      ? (status as BrReceitaRetentionStatus)
      : 'unexpected_status',
    snapshotRunId,
    partition: typeof outcome.partition === 'string' ? outcome.partition : null,
    sourcePeriod: typeof outcome.source_period === 'string' ? outcome.source_period : null,
    publishState: typeof outcome.publish_state === 'string' ? outcome.publish_state : null,
  };
}

export const BR_RECEITA_RETENTION_CONTRACT = {
  milestone: 'BR-PROD-STORAGE-RIGHT-SIZING',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
  policy: 'current_published_period_plus_previous_published_period',
  retainedGenerations: BR_RECEITA_RETAINED_PUBLICATION_GENERATIONS,
  usesATimeTtl: false,
  invents_a_run_lifetime: false,
  authoritativeRunLifetimeExistsInRepository: false,
  scope: 'exactly_one_snapshot_run_id',
  acceptsAPeriodArgument: false,
  hasAPeriodWideVariant: false,
  deletesNewestPublishedPeriod: false,
  deletesPreviousPublishedPeriod: false,
  protectsSupersededRunsOfRetainedPeriods: true,
  reasonSupersededIsProtected:
    'the pinned reader does not re-check publish_state, so a batch pinned to a run demoted by a same-period republish still reads that run rows',
  guardEnforcedIn: 'database_function',
  guardFunction: BR_RECEITA_DROP_PARTITION_FUNCTION,
  failsClosedOnUnknownPeriod: true,
  mechanism: 'drop_run_partition',
  reasonNotADelete:
    'a 72M-row DELETE is tens of GB of WAL, a long transaction on a small compute, and 27 GB of dead tuples; the partition drop is a catalog operation',
} as const;
