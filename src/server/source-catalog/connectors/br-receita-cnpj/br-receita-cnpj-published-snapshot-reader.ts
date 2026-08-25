/**
 * BR Receita CNPJ — the PUBLISHED-RUN READER. The period-aware primitive CUT A pinned and
 * deliberately did not implement.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B — runtime snapshot → published reader → Agent 1 adapter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY. No INSERT, no UPDATE, no DELETE, no RPC, no transaction.
 * No Supabase client is created here: one is injected.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The rule, restated as code ──────────────────────────────────────────────
 *
 * CUT A's `classifyBrReceitaSnapshotRead` classifies a Brazil read by its COORDINATES and refuses
 * a period-only one. This module is the query that obeys it, and it obeys it in two steps that
 * cannot be collapsed into one:
 *
 *   1. resolve THE single `published` run of (source_key, country_code, source_period)
 *   2. select snapshots scoped by that run's id, plus the exact identity
 *
 * A one-step `WHERE source_key … AND country_code … AND source_period …` matches the published
 * run AND every `preparing` / `failed` / `superseded` run of the same month. It returns their
 * union, every row of that union is individually well-formed, and nothing errors. That is the
 * whole reason the two steps exist, and it is why step 1's verdict is fed through the CUT-A
 * classifier before step 2 runs rather than being trusted implicitly.
 *
 * ── 🔴 What this reader will NOT do ─────────────────────────────────────────
 *
 *   · no `latest imported_at`, no `latest created_at`, no `ORDER BY source_period DESC`
 *   · no fallback to the previous month when the requested one has no publication
 *   · no "the run I found is probably published" — the state is re-checked, never assumed
 *   · no `source_year`-scoped primitive from `snapshot-read/`: all five of those are year-scoped
 *     and Brazil puts twelve periods inside one year, so a year-scoped read of one establishment
 *     legitimately sees up to twelve rows and would report a cardinality violation
 *
 * A period with no published run is `NO_PUBLISHED_RUN`. That is an ANSWER, not a failure to
 * answer, and it is deliberately not repairable by widening the query.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 *
 * The CNPJ enters as a bind value and NEVER comes back out: the projection returned is CUT A's
 * `BrReceitaPublicSnapshotProjection`, which has no identity field at all, and `normalized_tax_id`
 * is absent from the SELECT list so it is not even fetched. Every rejection reason is a category.
 */

import { normalizeBrazilCnpj } from './br-cnpj';
import {
  BR_RECEITA_READABLE_PUBLISH_STATE,
  BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS,
  BR_RECEITA_RUN_SCOPED_READ_COLUMNS,
  classifyBrReceitaSnapshotRead,
} from './br-receita-cnpj-monthly-snapshot-read-contract';
import { BR_RECEITA_SNAPSHOT_TABLE } from './br-receita-cnpj-monthly-snapshot-identity';
import type { BrReceitaPublicSnapshotProjection } from './br-receita-cnpj-monthly-snapshot-identity';
import { parseSnapshotRunId, SNAPSHOT_RUN_ID_COLUMN } from './br-receita-cnpj-monthly-snapshot-run-handle';
import { BR_RECEITA_SNAPSHOT_RUNS_TABLE } from './br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
  type BrReceitaCnpjSnapshotRawData,
} from './br-receita-cnpj-types';
import { parseSourcePeriod } from '../../source-period';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';

/**
 * The columns step 2 projects.
 *
 * 🔴 `normalized_tax_id` is NOT here and neither are `tax_id` or `record_identity_key`. The
 * caller already holds the identity it looked up; handing it back would create a second copy of
 * the exact CNPJ in application memory for no purpose, and the two refused columns are NULL for
 * Brazil by CHECK anyway. `snapshot_run_id` is absent too — the reader resolved it in step 1 and
 * returns it from there.
 */
export const BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS =
  'source_key, country_code, source_period, source_year, legal_name, raw_data' as const;

/** The columns step 1 projects: the run's id and the state that proves it is readable. */
export const BR_RECEITA_PUBLISHED_RUN_SELECT_COLUMNS = 'id, publish_state' as const;

// ─── Result ─────────────────────────────────────────────────────────────────

export type BrReceitaPublishedReadStatus =
  /** The published run exists and holds exactly one row for this establishment. */
  | 'FOUND'
  /** The period has no published run. Never repaired by reading another period. */
  | 'NO_PUBLISHED_RUN'
  /** The published run exists; this establishment is not in it. */
  | 'NOT_IN_PUBLISHED_RUN'
  /** The requested period is not canonical `YYYY-MM`. */
  | 'INVALID_PERIOD'
  /** The supplied CNPJ is missing, malformed or DV-invalid. */
  | 'INVALID_IDENTITY'
  /**
   * More than one run reports `published` for the period, or the resolved run failed CUT A's
   * read classification. Migration 127's partial unique index makes the first impossible — which
   * is exactly why it is reported instead of assumed away.
   */
  | 'AMBIGUOUS_PUBLISHED_RUN'
  /** More than one row for one establishment INSIDE one published run. Index 4b forbids it. */
  | 'CARDINALITY_VIOLATION';

export interface BrReceitaPublishedReadResult {
  readonly status: BrReceitaPublishedReadStatus;
  /** A CATEGORY, always safe to log. Never a CNPJ, never a legal name, never a driver message. */
  readonly reason: string;
  /** The publication run the answer came from. A version id, never identity. */
  readonly snapshotRunId: string | null;
  /** Present only on `FOUND`. Identity-free by construction. */
  readonly snapshot: BrReceitaPublicSnapshotProjection | null;
  /** Present on `CARDINALITY_VIOLATION` / `AMBIGUOUS_PUBLISHED_RUN`: how many were observed. */
  readonly observedCount: number | null;
}

export interface BrReceitaPublishedReadInput {
  readonly client: SnapshotReadClient<SnapshotIdentityRow>;
  /** Canonical `YYYY-MM`, ALWAYS explicit. There is no "current period" default anywhere. */
  readonly sourcePeriod: unknown;
  /** Raw or normalized CNPJ. Normalised and DV-validated here; never echoed back. */
  readonly cnpj: unknown;
}

/**
 * Thrown when the underlying client reports a transport/PostgREST failure.
 *
 * 🔴 Carries the provider's `code` only. A PostgREST error body can quote the filter that
 * failed, and for step 2 that filter contains the CNPJ.
 */
export class BrReceitaPublishedReadQueryError extends Error {
  readonly step: 'resolve_published_run' | 'read_run_scoped_snapshot';
  readonly code: string | null;

  constructor(step: BrReceitaPublishedReadQueryError['step'], code: string | null) {
    super(
      `br receita published-run read failed at step "${step}"${code === null ? '' : ` (${code})`}`,
    );
    this.name = 'BrReceitaPublishedReadQueryError';
    this.step = step;
    this.code = code;
  }
}

function codeOf(error: { code?: string } | null): string | null {
  return error && typeof error.code === 'string' ? error.code : null;
}

function refusal(
  status: BrReceitaPublishedReadStatus,
  reason: string,
  extra: { snapshotRunId?: string | null; observedCount?: number | null } = {},
): BrReceitaPublishedReadResult {
  return {
    status,
    reason,
    snapshotRunId: extra.snapshotRunId ?? null,
    snapshot: null,
    observedCount: extra.observedCount ?? null,
  };
}

// ─── Step 1 ─────────────────────────────────────────────────────────────────

/**
 * Resolves THE published run of a period.
 *
 * Probes with `.limit(2)` and NEVER `.limit(1)`: a second published run for one period would be
 * a breach of `source_snapshot_runs_published_period_uidx`, and `.limit(1)` would hide it behind
 * an arbitrary pick — the same failure mode the year-scoped read contracts were written to
 * avoid.
 */
export async function resolveBrReceitaPublishedRun(args: {
  readonly client: SnapshotReadClient<SnapshotIdentityRow>;
  readonly sourcePeriod: string;
}): Promise<
  | { readonly resolved: true; readonly snapshotRunId: string }
  | { readonly resolved: false; readonly result: BrReceitaPublishedReadResult }
> {
  const { data, error } = await args.client
    .from(BR_RECEITA_SNAPSHOT_RUNS_TABLE)
    .select(BR_RECEITA_PUBLISHED_RUN_SELECT_COLUMNS)
    .eq('source_key', BR_RECEITA_CNPJ_SOURCE_KEY)
    .eq('country_code', BR_RECEITA_CNPJ_COUNTRY_CODE)
    .eq('source_period', args.sourcePeriod)
    .eq('publish_state', BR_RECEITA_READABLE_PUBLISH_STATE)
    .limit(2);

  if (error) {
    throw new BrReceitaPublishedReadQueryError('resolve_published_run', codeOf(error));
  }
  if (data === null) {
    // A list query returns an array on success. A null payload with no error is a transport
    // state, not "the period has no publication" — never converted into a domain answer.
    throw new BrReceitaPublishedReadQueryError('resolve_published_run', null);
  }

  if (data.length === 0) {
    return {
      resolved: false,
      result: refusal('NO_PUBLISHED_RUN', 'period_has_no_published_run'),
    };
  }
  if (data.length > 1) {
    return {
      resolved: false,
      result: refusal('AMBIGUOUS_PUBLISHED_RUN', 'more_than_one_published_run_for_period', {
        observedCount: data.length,
      }),
    };
  }

  const parsed = parseSnapshotRunId(data[0]?.id);
  if (!parsed.valid) {
    return {
      resolved: false,
      result: refusal('AMBIGUOUS_PUBLISHED_RUN', 'published_run_id_malformed'),
    };
  }

  // 🔴 The state is RE-CHECKED against what the row actually says, not against the filter that
  // was sent. Holding a run id proves the run exists, not that it is the published one.
  if (data[0]?.publish_state !== BR_RECEITA_READABLE_PUBLISH_STATE) {
    return {
      resolved: false,
      result: refusal('AMBIGUOUS_PUBLISHED_RUN', 'resolved_run_is_not_published', {
        snapshotRunId: parsed.runId,
      }),
    };
  }

  return { resolved: true, snapshotRunId: parsed.runId };
}

// ─── The reader ─────────────────────────────────────────────────────────────

/**
 * Reads ONE Brazilian establishment out of the published snapshot of ONE period.
 *
 * Guard order is load-bearing: the period and the CNPJ are validated BEFORE any query is sent, so
 * a malformed input never becomes a database round trip — the same discipline the EC SCVS adapter
 * applies to an invalid RUC.
 */
export async function readBrReceitaPublishedSnapshot(
  input: BrReceitaPublishedReadInput,
): Promise<BrReceitaPublishedReadResult> {
  const parsedPeriod = parseSourcePeriod(input.sourcePeriod);
  if (!parsedPeriod.valid) {
    return refusal('INVALID_PERIOD', `source_period_${parsedPeriod.reason}`);
  }
  const sourcePeriod = parsedPeriod.sourcePeriod;

  const normalized = normalizeBrazilCnpj(input.cnpj);
  if (normalized.status !== 'valid' || normalized.normalized === null) {
    // The reason is the normalizer's CATEGORY (`missing` / `invalid_length` / `invalid_charset` /
    // `invalid_dv`). The rejected value is never part of it.
    return refusal('INVALID_IDENTITY', `cnpj_${normalized.reason ?? 'invalid'}`);
  }
  const normalizedTaxId = normalized.normalized;

  // ── Step 1 ──
  const runLookup = await resolveBrReceitaPublishedRun({ client: input.client, sourcePeriod });
  if (!runLookup.resolved) {
    return runLookup.result;
  }
  const snapshotRunId = runLookup.snapshotRunId;

  // ── CUT A's classifier gates step 2 ──
  // Not decoration: it is the recorded contract, and running it here means a future change that
  // dropped the run from the read would be refused by the module that owns that rule rather than
  // by a reviewer.
  const verdict = classifyBrReceitaSnapshotRead({
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: sourcePeriod,
    snapshot_run_id: snapshotRunId,
    resolved_run_publish_state: BR_RECEITA_READABLE_PUBLISH_STATE,
  });
  if (!verdict.isReadable) {
    return refusal('AMBIGUOUS_PUBLISHED_RUN', verdict.reason, { snapshotRunId });
  }

  // ── Step 2 ──
  // Scoped by all five physical key columns. `.limit(2)` for the same reason as step 1: two rows
  // for one establishment inside one run breaches index 4b and must be reported, never collapsed.
  const { data, error } = await input.client
    .from(BR_RECEITA_SNAPSHOT_TABLE)
    .select(BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS)
    .eq('source_key', BR_RECEITA_CNPJ_SOURCE_KEY)
    .eq('country_code', BR_RECEITA_CNPJ_COUNTRY_CODE)
    .eq('source_period', sourcePeriod)
    .eq(SNAPSHOT_RUN_ID_COLUMN, snapshotRunId)
    .eq('normalized_tax_id', normalizedTaxId)
    .limit(2);

  if (error) {
    throw new BrReceitaPublishedReadQueryError('read_run_scoped_snapshot', codeOf(error));
  }
  if (data === null) {
    throw new BrReceitaPublishedReadQueryError('read_run_scoped_snapshot', null);
  }

  if (data.length === 0) {
    return refusal('NOT_IN_PUBLISHED_RUN', 'establishment_absent_from_published_run', {
      snapshotRunId,
    });
  }
  if (data.length > 1) {
    return refusal('CARDINALITY_VIOLATION', 'more_than_one_row_for_identity_in_published_run', {
      snapshotRunId,
      observedCount: data.length,
    });
  }

  const row = data[0] as Record<string, unknown>;

  return {
    status: 'FOUND',
    reason: 'published_run_scoped',
    snapshotRunId,
    snapshot: {
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_period: sourcePeriod,
      legal_name: typeof row.legal_name === 'string' ? row.legal_name : null,
      raw_data: row.raw_data as BrReceitaCnpjSnapshotRawData,
    },
    observedCount: 1,
  };
}

/**
 * The contract this reader satisfies, as data — the executable answer to CUT A's
 * `BR_RECEITA_FUTURE_READER_CONTRACT`, which recorded the same shape while `runtimeRegistered`
 * was still `false`.
 */
export const BR_RECEITA_PUBLISHED_READER_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  implemented: true,
  step1ResolvePublishedRunBy: BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS,
  step1RequiredPublishState: BR_RECEITA_READABLE_PUBLISH_STATE,
  step2SelectSnapshotsScopedBy: BR_RECEITA_RUN_SCOPED_READ_COLUMNS,
  periodOnlyReadIsValid: false,
  fallsBackToAnotherPeriod: false,
  ordersByImportedAt: false,
  ordersBySourcePeriod: false,
  returnsIdentityToCaller: false,
} as const;
