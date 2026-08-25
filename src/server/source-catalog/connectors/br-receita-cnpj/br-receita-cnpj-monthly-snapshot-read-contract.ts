/**
 * BR Receita CNPJ — the FUTURE reader contract for monthly snapshots.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE IS A CLASSIFIER, NOT A READER. It executes no query, holds no
 * client, and Brazil is still ABSENT from `SOURCE_FAMILY_BY_SOURCE_KEY`.
 * CUT B implements the period-aware primitive; CUT A pins what it must do.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the reader rule has to be pinned NOW ─────────────────────────────────
 *
 * Once `snapshot_run_id` exists, a Brazilian period can hold MORE THAN ONE physical row set: the
 * published one readers see, and a staging one being rebuilt beside it. The moment that is true,
 * the obvious query becomes wrong:
 *
 *   ❌  WHERE source_key = … AND country_code = 'BR' AND source_period = '2026-07'
 *
 * That predicate matches the published run AND every preparing/failed run for the same month. It
 * returns a mixture — duplicated establishments, half-loaded months, rows from a build that was
 * abandoned — and it does so silently, because every row it returns is individually well-formed.
 * There is no error to notice.
 *
 * The rule is therefore two steps, never one:
 *
 *   1. resolve the single `published` run for (source_key, country_code, source_period)
 *   2. select snapshots WHERE snapshot_run_id = that run's id
 *
 * Step 1 is unambiguous because migration 126's `source_snapshot_runs_published_period_uidx`
 * (renamed from 125 by BR-SOURCE CUT A.1 — its SQL body is unchanged) permits at most ONE
 * published run per period. Step 2 is what makes the read a read OF a publication rather than a
 * read of a month's accumulated debris.
 *
 * 🔴 A period-only Brazil read is classified INVALID here, fail-closed, rather than being
 * "discouraged". CUT B has to fail to compile or fail to classify, not merely be reviewed carefully.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 *
 * Nothing in this module accepts, holds or returns tax material. A read request is described by its
 * COORDINATES — source, country, period, run — and a classification is a category plus a reason
 * code. `normalized_tax_id` appears nowhere.
 */

import { BR_RECEITA_CNPJ_SOURCE_KEY, BR_RECEITA_CNPJ_COUNTRY_CODE } from './br-receita-cnpj-types';
import { parseSnapshotRunId, SNAPSHOT_RUN_ID_COLUMN } from './br-receita-cnpj-monthly-snapshot-run-handle';
import { parseSourcePeriod } from '../../source-period';

/**
 * The columns that resolve THE published run of a period. Mirrors migration 126's
 * `source_snapshot_runs_published_period_uidx`, which is what makes the result single-valued.
 */
export const BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS: readonly string[] = [
  'source_key',
  'country_code',
  'source_period',
] as const;

/** The publish state a run must be in for its rows to be readable. Exactly one value. */
export const BR_RECEITA_READABLE_PUBLISH_STATE = 'published' as const;

/**
 * The columns a Brazil snapshot SELECT must be scoped by. The run is not optional and it is not
 * last-resort disambiguation — it is the scope.
 */
export const BR_RECEITA_RUN_SCOPED_READ_COLUMNS: readonly string[] = [
  'source_key',
  'country_code',
  'source_period',
  SNAPSHOT_RUN_ID_COLUMN,
] as const;

export type BrReceitaSnapshotReadClassification =
  /** Two-step, run-scoped, resolved from the published run. The only valid shape. */
  | 'valid_published_run_scoped'
  /** 🔴 Period-only. Would mix published rows with staging/failed rows. Structurally refused. */
  | 'invalid_period_only'
  /** A run was named, but not the published one — a staging run is not readable. */
  | 'invalid_unpublished_run'
  /** Malformed or missing coordinates. */
  | 'invalid_coordinates';

export interface BrReceitaSnapshotReadRequest {
  readonly source_key: string;
  readonly country_code: string;
  readonly source_period: unknown;
  /** The run resolved in step 1. `null`/absent means the caller intends a period-only read. */
  readonly snapshot_run_id?: unknown;
  /**
   * The publish state of the run named above, as resolved from `source_snapshot_runs`.
   *
   * 🔴 Required alongside the id and never assumed: holding a run id proves the run EXISTS, not
   * that it is the published one. A caller that supplied an id it had not checked would otherwise
   * read a preparing run and believe it was reading the month.
   */
  readonly resolved_run_publish_state?: unknown;
}

export interface BrReceitaSnapshotReadVerdict {
  readonly classification: BrReceitaSnapshotReadClassification;
  readonly isReadable: boolean;
  /** A CATEGORY, never a value. Safe to log. */
  readonly reason: string;
}

/**
 * Classifies an intended Brazil snapshot read. PURE, never throws, fail-closed.
 *
 * Non-Brazil sources are out of scope and are reported as such rather than silently approved: this
 * classifier speaks only for `br_receita_cnpj_dados_abertos`, whose rows are the only run-versioned
 * ones migration 126 creates.
 */
export function classifyBrReceitaSnapshotRead(
  request: BrReceitaSnapshotReadRequest,
): BrReceitaSnapshotReadVerdict {
  if (
    request.source_key !== BR_RECEITA_CNPJ_SOURCE_KEY ||
    request.country_code !== BR_RECEITA_CNPJ_COUNTRY_CODE
  ) {
    return {
      classification: 'invalid_coordinates',
      isReadable: false,
      reason: 'not_a_brazil_receita_read',
    };
  }

  if (!parseSourcePeriod(request.source_period).valid) {
    return {
      classification: 'invalid_coordinates',
      isReadable: false,
      reason: 'source_period_missing_or_malformed',
    };
  }

  const parsedRunId = parseSnapshotRunId(request.snapshot_run_id);
  if (!parsedRunId.valid) {
    // The whole point of the classifier: a well-formed period with no run is the query that looks
    // right and returns a mixture. It is refused, not warned about.
    return {
      classification: 'invalid_period_only',
      isReadable: false,
      reason: 'brazil_snapshot_read_requires_published_snapshot_run_id',
    };
  }

  if (request.resolved_run_publish_state !== BR_RECEITA_READABLE_PUBLISH_STATE) {
    return {
      classification: 'invalid_unpublished_run',
      isReadable: false,
      reason: 'named_run_is_not_the_published_run',
    };
  }

  return {
    classification: 'valid_published_run_scoped',
    isReadable: true,
    reason: 'published_run_scoped',
  };
}

/**
 * The recorded contract CUT B has to satisfy, as data — so the obligation survives in the
 * repository rather than in a review comment.
 */
export const BR_RECEITA_FUTURE_READER_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-A',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  runtimeRegistered: false,
  step1ResolvePublishedRunBy: BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS,
  step1RequiredPublishState: BR_RECEITA_READABLE_PUBLISH_STATE,
  step2SelectSnapshotsScopedBy: BR_RECEITA_RUN_SCOPED_READ_COLUMNS,
  periodOnlyReadIsValid: false,
  periodOnlyReadClassification: 'invalid_period_only',
  reasonPeriodOnlyIsRefused:
    'a period can hold a published run and one or more preparing/failed runs simultaneously; a period-only predicate returns their union, and every row in that union is individually well-formed so nothing errors',
  identityRepresentationCount: 1,
  identityRepresentationColumn: 'normalized_tax_id',
  snapshotRunIdIsAnIdentityRepresentation: false,
} as const;
