/**
 * BR Receita CNPJ — the PINNED READER. Reads one establishment out of ONE already-chosen
 * publication, and is structurally incapable of choosing a different one.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B2 — pin exact publication for the whole Agent 1 run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY. ONE SELECT against the snapshot table. No INSERT, no UPDATE, no
 * DELETE, no RPC, no transaction. No Supabase client is created here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a SECOND reader and not a change to the first ───────────────
 *
 * `readBrReceitaPublishedSnapshot` answers "what does the CURRENTLY published run of month M say
 * about establishment X?" That is a legitimate question with real callers — an operator probe, a
 * one-shot lookup, the PostgreSQL cut's own assertions — and its semantics are NOT being weakened.
 * It resolves the published run itself, every call, on purpose.
 *
 * This reader answers a DIFFERENT question:
 *
 *     "what does THIS publication — the one my run pinned — say about establishment X?"
 *
 * and it answers it without ever asking which run is published. That is the entire point: the
 * two-step reader's step 1 is exactly where a same-month republication changes the answer
 * mid-run, so the pinned path deletes step 1 rather than trying to make it stable.
 *
 * ── 🔴 The run id cannot come from the caller ───────────────────────────────
 *
 * It arrives inside a `BrReceitaPinnedPublication`, whose constructor is private. A caller cannot
 * hand this reader an arbitrary UUID string and have it scope a query by it, so "the run being
 * read was published when the run started" is guaranteed by the type rather than by trust. The
 * `instanceof` re-check exists for the boundary where types are gone.
 *
 * ── 🔴 `publish_state` is deliberately NOT re-checked ───────────────────────
 *
 * A pinned run that has since become `superseded` is still the right answer for the run that
 * pinned it (§ 4). Re-checking the state here would reintroduce the coupling this cut removes and
 * would make a mid-run republication break every remaining candidate — the same defect wearing a
 * different mask.
 *
 * ── Privacy (§ 8) ───────────────────────────────────────────────────────────
 *
 * The CNPJ enters as a bind value and NEVER comes back out: `normalized_tax_id` is absent from the
 * projection so it is not even fetched, and the returned shape is CUT A's identity-free
 * `BrReceitaPublicSnapshotProjection`. Every rejection reason is a category, never a value, never
 * a driver message.
 */

import { normalizeBrazilCnpj } from './br-cnpj';
import {
  BR_RECEITA_READABLE_PUBLISH_STATE,
  classifyBrReceitaSnapshotRead,
} from './br-receita-cnpj-monthly-snapshot-read-contract';
import { BR_RECEITA_SNAPSHOT_TABLE } from './br-receita-cnpj-monthly-snapshot-identity';
import type { BrReceitaPublicSnapshotProjection } from './br-receita-cnpj-monthly-snapshot-identity';
import { SNAPSHOT_RUN_ID_COLUMN } from './br-receita-cnpj-monthly-snapshot-run-handle';
import {
  isBrReceitaPinnedPublication,
  type BrReceitaPinnedPublication,
} from './br-receita-cnpj-pinned-publication';
import { BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS } from './br-receita-cnpj-published-snapshot-reader';
import { brReceitaRuntimeSignalsFromRow } from './br-receita-cnpj-compact-storage';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from './br-receita-cnpj-types';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';

export type BrReceitaPinnedReadStatus =
  /** The pinned publication holds exactly one row for this establishment. */
  | 'FOUND'
  /** The pinned publication exists; this establishment is not in it. */
  | 'NOT_IN_PINNED_PUBLICATION'
  /** The value offered as a pin is not one this process minted. Fail closed; no query is sent. */
  | 'INVALID_PINNED_PUBLICATION'
  /** The supplied CNPJ is missing, malformed or DV-invalid. */
  | 'INVALID_IDENTITY'
  /** More than one row for one establishment INSIDE one publication. Index 4b forbids it. */
  | 'CARDINALITY_VIOLATION';

export interface BrReceitaPinnedReadResult {
  readonly status: BrReceitaPinnedReadStatus;
  /** A CATEGORY, always safe to log. Never a CNPJ, never a legal name, never a driver message. */
  readonly reason: string;
  /** The publication the answer came from. A version id, never identity. */
  readonly snapshotRunId: string | null;
  /** The month the publication publishes. Log-safe. */
  readonly sourcePeriod: string | null;
  /** Present only on `FOUND`. Identity-free by construction. */
  readonly snapshot: BrReceitaPublicSnapshotProjection | null;
  /** Present on `CARDINALITY_VIOLATION`: how many rows were observed. */
  readonly observedCount: number | null;
}

export interface BrReceitaPinnedReadInput {
  readonly client: SnapshotReadClient<SnapshotIdentityRow>;
  /**
   * The pinned publication. NOT a period and NOT a run-id string: the only way a caller obtains
   * one is by pinning a publication that was `published` at that moment.
   */
  readonly publication: BrReceitaPinnedPublication;
  /** Raw or normalized CNPJ. Normalised and DV-validated here; never echoed back. */
  readonly cnpj: unknown;
}

/**
 * Thrown when the underlying client reports a transport/PostgREST failure.
 *
 * 🔴 Carries the provider's `code` only. A PostgREST error body can quote the filter that failed,
 * and this reader's filter contains the CNPJ.
 */
export class BrReceitaPinnedReadQueryError extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super(`br receita pinned read failed${code === null ? '' : ` (${code})`}`);
    this.name = 'BrReceitaPinnedReadQueryError';
    this.code = code;
  }
}

function codeOf(error: { code?: string } | null): string | null {
  return error && typeof error.code === 'string' ? error.code : null;
}

function refusal(
  status: BrReceitaPinnedReadStatus,
  reason: string,
  extra: {
    snapshotRunId?: string | null;
    sourcePeriod?: string | null;
    observedCount?: number | null;
  } = {},
): BrReceitaPinnedReadResult {
  return {
    status,
    reason,
    snapshotRunId: extra.snapshotRunId ?? null,
    sourcePeriod: extra.sourcePeriod ?? null,
    snapshot: null,
    observedCount: extra.observedCount ?? null,
  };
}

/**
 * Reads ONE Brazilian establishment out of ONE pinned publication.
 *
 * Guard order is load-bearing: the pin and the CNPJ are validated BEFORE any query is sent, so a
 * forged pin or a malformed identity never becomes a database round trip.
 */
export async function readBrReceitaPinnedSnapshot(
  input: BrReceitaPinnedReadInput,
): Promise<BrReceitaPinnedReadResult> {
  // ── Guard 1 — the pin must be one this process minted. ──
  if (!isBrReceitaPinnedPublication(input.publication)) {
    return refusal('INVALID_PINNED_PUBLICATION', 'pinned_publication_not_minted_here');
  }
  const { sourcePeriod, snapshotRunId } = input.publication;

  // ── Guard 2 — an exact, DV-valid CNPJ. ──
  const normalized = normalizeBrazilCnpj(input.cnpj);
  if (normalized.status !== 'valid' || normalized.normalized === null) {
    // The reason is the normalizer's CATEGORY. The rejected value is never part of it.
    return refusal('INVALID_IDENTITY', `cnpj_${normalized.reason ?? 'invalid'}`, {
      snapshotRunId,
      sourcePeriod,
    });
  }
  const normalizedTaxId = normalized.normalized;

  // ── CUT A's classifier still gates the read. ──
  // Not decoration: it is the recorded contract for what a Brazilian snapshot read must carry, and
  // running it here means a future change that dropped the run from the scope would be refused by
  // the module that owns that rule rather than by a reviewer. `resolved_run_publish_state` is
  // asserted as `published` because that is what the PIN observed — the state at pin time is the
  // fact this read is entitled to, and it is not re-queried (§ 4).
  const verdict = classifyBrReceitaSnapshotRead({
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: sourcePeriod,
    snapshot_run_id: snapshotRunId,
    resolved_run_publish_state: BR_RECEITA_READABLE_PUBLISH_STATE,
  });
  if (!verdict.isReadable) {
    return refusal('INVALID_PINNED_PUBLICATION', verdict.reason, {
      snapshotRunId,
      sourcePeriod,
    });
  }

  // ── The read. Scoped by every physical key column the dedicated table has, PINNED run first. ──
  // `.limit(2)`: two rows for one establishment inside one publication breaches the primary key and
  // must be reported, never collapsed to an arbitrary pick.
  const { data, error } = await input.client
    .from(BR_RECEITA_SNAPSHOT_TABLE)
    .select(BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS)
    .eq('source_period', sourcePeriod)
    .eq(SNAPSHOT_RUN_ID_COLUMN, snapshotRunId)
    .eq('normalized_tax_id', normalizedTaxId)
    .limit(2);

  if (error) {
    throw new BrReceitaPinnedReadQueryError(codeOf(error));
  }
  if (data === null) {
    // A list query returns an array on success. A null payload with no error is a transport state,
    // not "the establishment is absent" — never converted into a domain answer.
    throw new BrReceitaPinnedReadQueryError(null);
  }

  if (data.length === 0) {
    return refusal('NOT_IN_PINNED_PUBLICATION', 'establishment_absent_from_pinned_publication', {
      snapshotRunId,
      sourcePeriod,
    });
  }
  if (data.length > 1) {
    return refusal('CARDINALITY_VIOLATION', 'more_than_one_row_for_identity_in_pinned_publication', {
      snapshotRunId,
      sourcePeriod,
      observedCount: data.length,
    });
  }

  const row = data[0] as Record<string, unknown>;

  return {
    status: 'FOUND',
    reason: 'pinned_publication_scoped',
    snapshotRunId,
    sourcePeriod,
    snapshot: {
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_period: sourcePeriod,
      legal_name: typeof row.legal_name === 'string' ? row.legal_name : null,
      signals: brReceitaRuntimeSignalsFromRow(row),
    },
    observedCount: 1,
  };
}

/**
 * The contract this reader satisfies, as data.
 */
export const BR_RECEITA_PINNED_READER_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B2',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  /** The whole point: the pinned path never asks which run is published. */
  resolvesPublishedRunItself: false,
  reChecksPublishStateAtReadTime: false,
  acceptsRunIdAsPlainString: false,
  requiresMintedPin: true,
  scopedBySourceKey: true,
  scopedByCountryCode: true,
  scopedBySourcePeriod: true,
  scopedBySnapshotRunId: true,
  scopedByNormalizedTaxId: true,
  projectsNormalizedTaxId: false,
  returnsIdentityToCaller: false,
  detectsCardinalityViolation: true,
  fallsBackToAnotherPeriod: false,
  fallsBackToAnotherRun: false,
} as const;
