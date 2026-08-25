/**
 * BR Receita CNPJ — the START-OF-RUN PERIOD RESOLVER.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B1 — frozen period, metadata provenance, Agent 1 binding.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY. One SELECT against `source_snapshot_runs`, projecting ONE column.
 * No Supabase client is created here: one is injected. No CNPJ is involved at
 * any point — this module never sees, accepts or returns tax material.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is NOT the published-snapshot reader ───────────────────────────
 *
 * `readBrReceitaPublishedSnapshot` answers "what does month M say about establishment X?" and it
 * is deliberately incapable of choosing M: a reader that picked its own period could silently mix
 * months across one enrichment. That rule is not being relaxed. This module answers a DIFFERENT
 * question, asked exactly ONCE and at a different moment:
 *
 *     "which month is the current publication, as of the instant this run started?"
 *
 * Choosing a period is a RUN-LEVEL decision. It is made here, before the first candidate is even
 * fetched, and the answer is then frozen and carried explicitly. The reader still never chooses.
 *
 * ── 🔴 Frozen, not fresh ────────────────────────────────────────────────────
 *
 * The caller resolves once and binds the result to the adapter for the whole run. If a NEWER
 * month is published while the run is still processing candidates, the run does NOT move: a batch
 * whose first half was enriched from 2026-08 and second half from 2026-09 is a batch nobody can
 * reason about, and "the newest data available" is worth less than "one coherent publication".
 * The next run picks up the newer month. That is the entire policy.
 *
 * ── 🔴 What this resolver will NOT do ───────────────────────────────────────
 *
 *   · no `latest imported_at`, no `latest created_at` — those order IMPORTS, not publications
 *   · no clock, no "current month" — a period is data, never derived from `Date`
 *   · no fallback to a period whose run is `preparing` / `failed` / `superseded` / `rolled_back`
 *   · no run rows returned to the caller: the caller needs a month, not a publication record
 *
 * "No period is published" is an ANSWER (`NO_PUBLISHED_PERIOD`), and the only correct thing to do
 * with it is to enrich nothing.
 */

import {
  BR_RECEITA_READABLE_PUBLISH_STATE,
} from './br-receita-cnpj-monthly-snapshot-read-contract';
import { pickGreatestCanonicalPeriod } from './br-receita-cnpj-pinned-publication';
import { BR_RECEITA_SNAPSHOT_RUNS_TABLE } from './br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from './br-receita-cnpj-types';

import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';

/**
 * The ONE column projected.
 *
 * 🔴 Not `*`, not `id`, not `imported_at`. The caller's whole need is a canonical `YYYY-MM`, and a
 * projection that carried the run row would invite a second caller to start reasoning about runs
 * from here instead of from the reader that owns that step.
 */
export const BR_RECEITA_PUBLISHED_PERIOD_SELECT_COLUMNS = 'source_period' as const;

/**
 * Bounded probe window.
 *
 * A published period per month means a year of publications is 12 rows; the window is sized so the
 * greatest period is inside it under any realistic retention, while a pathological table can never
 * return an unbounded payload. The maximum is then recomputed IN CODE from the returned periods
 * rather than trusted from the database's sort, so the answer does not depend on the server's
 * collation for a string whose ordering the application already defines.
 */
export const BR_RECEITA_PUBLISHED_PERIOD_PROBE_LIMIT = 12;

export type BrReceitaPublishedPeriodStatus =
  /** A published publication exists; `sourcePeriod` is its canonical `YYYY-MM`. */
  | 'FOUND'
  /** Nothing is published for this source/country. Fail closed; enrich nothing. */
  | 'NO_PUBLISHED_PERIOD';

export interface BrReceitaPublishedPeriodResult {
  readonly status: BrReceitaPublishedPeriodStatus;
  /** A CATEGORY, always safe to log. Never a driver message. */
  readonly reason: string;
  /** Canonical `YYYY-MM` on `FOUND`, `null` otherwise. Log-safe (§ 8). */
  readonly sourcePeriod: string | null;
}

/**
 * Thrown when the injected client reports a transport/PostgREST failure.
 *
 * 🔴 Carries the provider's `code` only, for the same reason the published-run reader does: a
 * PostgREST error body can quote the filter that failed. No filter here contains identity, but the
 * habit of forwarding driver messages is what leaks one on the module next door.
 */
export class BrReceitaPublishedPeriodQueryError extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super(
      `br receita published-period resolution failed${code === null ? '' : ` (${code})`}`,
    );
    this.name = 'BrReceitaPublishedPeriodQueryError';
    this.code = code;
  }
}

function codeOf(error: { code?: string } | null): string | null {
  return error && typeof error.code === 'string' ? error.code : null;
}

export interface BrReceitaPublishedPeriodInput {
  readonly client: SnapshotReadClient<SnapshotIdentityRow>;
}

/**
 * Resolves the CURRENT published month for Brazil — once, at the start of a run.
 *
 * The filter is the same three-plus-one coordinates the published-run reader uses minus the
 * period itself: source, country and `publish_state = 'published'`. Every row it can return is by
 * definition the single published run of some month (migration 127's partial unique index), so
 * "more than one row" is normal here and means "more than one month has a publication" — NOT
 * ambiguity. The ambiguity that matters (two published runs for the SAME month) is impossible by
 * index and is the reader's concern, not this one's.
 */
export async function resolveBrReceitaLatestPublishedPeriod(
  input: BrReceitaPublishedPeriodInput,
): Promise<BrReceitaPublishedPeriodResult> {
  const { data, error } = await input.client
    .from(BR_RECEITA_SNAPSHOT_RUNS_TABLE)
    .select(BR_RECEITA_PUBLISHED_PERIOD_SELECT_COLUMNS)
    .eq('source_key', BR_RECEITA_CNPJ_SOURCE_KEY)
    .eq('country_code', BR_RECEITA_CNPJ_COUNTRY_CODE)
    .eq('publish_state', BR_RECEITA_READABLE_PUBLISH_STATE)
    .order('source_period', { ascending: false })
    .limit(BR_RECEITA_PUBLISHED_PERIOD_PROBE_LIMIT);

  if (error) {
    throw new BrReceitaPublishedPeriodQueryError(codeOf(error));
  }
  if (data === null) {
    // A list query returns an array on success. A null payload with no error is a transport
    // state, not "nothing is published" — never converted into a domain answer.
    throw new BrReceitaPublishedPeriodQueryError(null);
  }

  if (data.length === 0) {
    return {
      status: 'NO_PUBLISHED_PERIOD',
      reason: 'no_published_period_for_source',
      sourcePeriod: null,
    };
  }

  // Re-validate every candidate against the canonical grain and take the maximum in code, through
  // the SAME pure selector the CUT-B2 publication pin uses. One implementation of "which month is
  // the current publication?" — a second copy is how the pin and this resolver would eventually
  // disagree about the answer to the same question.
  const latest = pickGreatestCanonicalPeriod(
    data as unknown as ReadonlyArray<{ readonly source_period?: unknown }>,
  );

  if (latest === null) {
    return {
      status: 'NO_PUBLISHED_PERIOD',
      reason: 'published_rows_carry_no_canonical_period',
      sourcePeriod: null,
    };
  }

  return {
    status: 'FOUND',
    reason: 'latest_published_period',
    sourcePeriod: latest,
  };
}

/**
 * The contract this resolver satisfies, as data — so a test asserts the policy rather than
 * a reviewer re-reading the query every time it changes.
 */
export const BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B1',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  requiredPublishState: BR_RECEITA_READABLE_PUBLISH_STATE,
  resolvedOncePerRun: true,
  frozenForWholeRun: true,
  ordersByImportedAt: false,
  ordersByCreatedAt: false,
  derivesPeriodFromClock: false,
  fallsBackToUnpublishedRun: false,
  returnsRunRowsToCaller: false,
  involvesTaxIdentity: false,
} as const;
