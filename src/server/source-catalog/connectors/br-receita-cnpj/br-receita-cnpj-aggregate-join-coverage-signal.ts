/**
 * BR Receita CNPJ — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL (BR-SOURCE-11H-IMPL).
 *
 * The fifth reading port for the full-join runner, and the SECOND module in the series that
 * holds an identifier-derived value on purpose. It exists because the owner authorized exactly
 * one thing, after BR-SOURCE-11H-LAND was merged:
 *
 *     AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL
 *
 * That phrase authorizes opening the two REQUIRED families — Empresas and Estabelecimentos —
 * one file each, under the WIDER 11H window (≤ 512 KB and ≤ 200 rows per file, ≤ 1,024,000
 * bytes and ≤ 400 rows per run), parsing the protected technical join key EPHEMERALLY,
 * comparing keys IN MEMORY, and reporting a coarse, bucketed match SIGNAL.
 *
 * It authorizes nothing else.
 *
 * ── "signal", never "proof" ─────────────────────────────────────────────────────
 * The single most important thing this module does is DECLINE to say more than it knows. A
 * bounded prefix of two independently-sharded files is not a sample of the dataset; it is two
 * arbitrary windows that happen to sit at offset zero. So:
 *
 *   - no exact percentage is computed, and none can be requested;
 *   - no full-dataset denominator is computed, named, or implied;
 *   - the denominator SCOPE is stated explicitly as `bounded_window_only`;
 *   - `coverageClaimed` and `productionInferenceAllowed` are structural falses;
 *   - the outcome is a BUCKET, never a count and never a ratio.
 *
 * A green run may help decide whether to keep investing in Brazil. It is not coverage proof,
 * not a coverage guarantee, not a dataset quality score, and not evidence of readiness for
 * import, runtime, Agent 1 or production.
 *
 * ── Why this module exists next to the 11G join probe ───────────────────────────
 * The 11G probe answered "does the join MECHANISM find anything at all" inside a 20-row / 40-row
 * window. This milestone answers a narrower but different question — "is there a match signal in
 * a materially larger bounded window" — and it does so under a SEPARATE owner phrase, a SEPARATE
 * trust level, SEPARATE flags, SEPARATE caps and a SEPARATE error vocabulary. The 11G
 * authorization does not reach this module, and this one does not reach 11G.
 *
 * Every CONTRACT that can be shared without widening anything is imported from the 11F
 * structural probe rather than restated: the family allowlist, the never-opened families, the
 * extension allow/denylists, the ZIP-staging segments, the layout mode, the file-count caps, the
 * manifest caps, the runtime ceiling, the selection classes and the row-shape shape. The BYTE and
 * ROW caps are NOT shared — they are the one axis this milestone widens, so they are stated here
 * as their own constants with their own buckets. The bounded read loop is deliberately not shared
 * either: see the note above the reader below.
 *
 * ── What happens to a join key, precisely ───────────────────────────────────────
 * For each row of the bounded window, ONE field is parsed: the protected technical root key at
 * the official positional index the two required families share. Then:
 *
 *   - Empresas: the value is added to a Set whose size is capped by
 *     `maxCoverageKeyValuesInMemory`, and the row is discarded.
 *   - Estabelecimentos: the value is TESTED for membership against that Set, counted into a
 *     matched/unmatched tally, and discarded.
 *   - After the comparison the Set is CLEARED, before any aggregate is assembled.
 *
 * No join key value is written to a field, a report, a log, a file, an error message, a
 * template, or a return value. No key is hashed, truncated or fingerprinted — hashing an
 * identifier does not de-identify it, so the only permitted operation is to decline to emit it.
 * No joined row, joined pair, or joined sample is ever constructed: the join is a membership
 * test, not a materialization, which is why `maxCoveragePairsEmitted` and
 * `maxCoverageRowsPrinted` are equalities at zero rather than ceilings.
 *
 * ── `zero` and `not_reported` are both green ────────────────────────────────────
 * Two independently-sharded prefixes need not overlap at all, and a wider window does not make
 * overlap likelier in any way this module may reason about. Zero overlap is NOT a failure, not
 * evidence that the dataset does not join, and not a reason to widen the caps.
 * `matchResultBucket` is `zero` when the comparison ran and found nothing, and `not_reported`
 * when no meaningful statement can be made — a cap consumed before comparison, or a window with
 * no parseable key. Both are `ok`.
 *
 * ── Refusal vs. throw ───────────────────────────────────────────────────────────
 * Identical to the 11F / 11G split, deliberately:
 *
 *   - A CONTRACT breach THROWS `BrazilReceitaAggregateJoinCoverageSignalError`, whose message is
 *     a fixed code and nothing else: an authorization was not declared, a cap was not stated or
 *     exceeds its ceiling, or raw-row / raw-cell / identifier / join-key / joined-row /
 *     join-pair / exact-percentage / denominator / coverage-claim / production-inference output
 *     was requested.
 *
 *   - A MANIFEST-CONTENT or ENVIRONMENT refusal is REPORTED, not thrown: a forbidden family, a
 *     missing required family, a file-count breach, an archive, an unopenable path, an unreadable
 *     window, or the liveness deadline come back as `refusalCode` alongside zeroed aggregates and
 *     a `not_reported` coverage block.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens more than one file per required family, or more than two data files per run.
 *   - opens a catalog file, a Sócios/QSA/CPF file, a ZIP, or a raw-zip staging area.
 *   - reads beyond the stated per-file or total byte and row ceilings, or truncates a row and
 *     counts it as valid.
 *   - parses a second field "for context": exactly one field position per row.
 *   - retains, returns, or logs a row, a cell, a column value, a join key, a CNPJ, a CNPJ
 *     básico, a CPF, a legal name, a trade name, an address, an email, a phone, a filename, a
 *     basename, a filesystem path, a byte offset, a line number tied to a value, or a hash /
 *     fingerprint / truncation of any of them.
 *   - emits a joined row, a joined sample, a join pair, an exact coverage figure, a ratio, a
 *     match rate, or a full-dataset denominator; or claims coverage; or infers production
 *     readiness.
 *   - constructs a `record_identity_key` or a `normalized_tax_id`.
 *   - reads an environment variable, constructs a client, downloads, imports, writes to
 *     Supabase, or touches runtime, Agent 1, a provider, HubSpot, or Slack.
 *   - approves a gate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  countBrReceitaCnpjDelimitedColumns,
  getBrReceitaCnpjOfficialColumnCount,
  type BrReceitaCnpjLayoutFileType,
} from './br-receita-cnpj-file-reader';
import { BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS } from './br-receita-cnpj-real-manifest-metadata-reader';
import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_ALLOWED_EXTENSIONS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_EXTENSIONS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_PER_FAMILY,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_RUNTIME_MS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_NEVER_OPENED_FAMILIES,
  type BrazilReceitaRequiredFamilyProbeDelimiterStatus,
  type BrazilReceitaRequiredFamilyProbeEncodingStatus,
  type BrazilReceitaRequiredFamilyProbeHeaderlessStatus,
  type BrazilReceitaRequiredFamilyProbeRowShape,
  type BrazilReceitaRequiredFamilyProbeSelectionClass,
} from './br-receita-cnpj-required-family-probe';
import { BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX } from './br-receita-cnpj-required-family-join-probe';

// ─── Trust and family vocabulary ──────────────────────────────────────────────

/**
 * The trust level this coverage signal declares. A SIXTH distinct value: the synthetic-temp,
 * metadata-only, structural-probe, join-probe and coverage-signal carve-outs are separate
 * authorizations, and no trust level or flag substitutes for another.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST =
  'real_manifest_aggregate_join_coverage_signal' as const;

/** The one coverage-signal mode this module implements. A class label, not a strategy switch. */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MODE =
  'ultra_bounded_required_family_aggregate_only' as const;

/**
 * The ONLY denominator this module will name: the bounded window it actually read. Stated as a
 * field rather than omitted, so a reader can see that no dataset-scale denominator exists
 * anywhere in the output.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_DENOMINATOR_SCOPE =
  'bounded_window_only' as const;

/**
 * The families a coverage signal may open, in probe order: the key window is built from the
 * FIRST and tested against the SECOND. Imported from the structural probe so the carve-outs
 * cannot drift apart, and so this module adds no file, no glob and no new family.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES: readonly string[] = [
  ...BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES,
];

/**
 * The positional index of the protected technical root key inside the official headerless
 * layout, imported from the 11G probe so the two modules can never read different positions.
 *
 * A layout constant, not data: it names a column position, never a value.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_KEY_COLUMN_INDEX =
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX;

/** The extension the manifest CONTROL DOCUMENT must carry. */
const MANIFEST_EXTENSION = '.json';

/** The delimiter the official Receita headerless layout uses. */
const OFFICIAL_DELIMITER = ';';

/** Declared encodings this module recognizes when classifying `encoding_status`. */
const RECOGNIZED_ENCODINGS: readonly string[] = ['latin1', 'utf8'];

/**
 * Decode-failure markers, assembled from code points so no control character or replacement
 * glyph appears in this source file. Their PRESENCE is reported as a class label; the offending
 * bytes never leave the reader.
 */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const NUL_CHARACTER = String.fromCharCode(0);

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * The file-count, manifest and liveness ceilings are the BR-SOURCE-11F ceilings, imported
 * UNCHANGED. This milestone opens no additional file and reads no additional manifest byte.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_PER_FAMILY =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_PER_FAMILY;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_RUNTIME_MS =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_RUNTIME_MS;

/**
 * The BYTE and ROW ceilings — the ONE axis BR-SOURCE-11H Option C widens, and the reason this
 * module exists rather than a flag on the 11G probe. Stated here as their own constants so no
 * import can silently widen the 11F/11G window, and so a reader can see the whole delta in five
 * lines.
 *
 * These numbers carry no implication whatsoever for real-data ceilings, which are a GATE-2
 * deliverable and are neither proposed nor anticipated here.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE = 512_000 as const;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE = 200 as const;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS = 400 as const;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES = 1_024_000 as const;

/**
 * The four COVERAGE caps.
 *
 * `MAX_COVERAGE_INPUT_ROWS` and `MAX_COVERAGE_KEY_VALUES_IN_MEMORY` bound the weakest guarantee
 * in the record: they make "ephemeral" checkable, because the in-memory window can never exceed
 * the rows the run was allowed to read in the first place.
 *
 * `MAX_COVERAGE_PAIRS_EMITTED` and `MAX_COVERAGE_ROWS_PRINTED` are EQUALITIES at zero, not
 * ceilings. A value above zero is not a wider signal — it is a different, unauthorized
 * capability, so it is refused with its own join-output code rather than as a cap breach.
 */
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS = 400 as const;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY =
  400 as const;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_PAIRS_EMITTED = 0 as const;
export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_ROWS_PRINTED = 0 as const;

// ─── Buckets ──────────────────────────────────────────────────────────────────

/** How much of a file was read, as a BUCKET rather than a byte figure. */
export type BrazilReceitaAggregateJoinCoverageSignalBytesBucket =
  | 'lte_512kb'
  | 'over_limit_blocked';

export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_BYTES_BUCKETS: readonly BrazilReceitaAggregateJoinCoverageSignalBytesBucket[] =
  ['lte_512kb', 'over_limit_blocked'];

/** How many rows were parsed, as a BUCKET rather than a row figure. */
export type BrazilReceitaAggregateJoinCoverageSignalRowsBucket = 'lte_200' | 'over_limit_blocked';

export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_ROWS_BUCKETS: readonly BrazilReceitaAggregateJoinCoverageSignalRowsBucket[] =
  ['lte_200', 'over_limit_blocked'];

/**
 * Whether the mechanism found anything at all. Deliberately coarse: it answers the question
 * without emitting a count that could be divided into a rate.
 *
 * `zero`          — the comparison ran and no key from the second window was present in the first.
 * `one_or_more`   — the comparison ran and at least one key was present.
 * `not_reported`  — no meaningful statement can be made. A green outcome, not an error.
 */
export type BrazilReceitaAggregateJoinCoverageSignalMatchResultBucket =
  | 'zero'
  | 'one_or_more'
  | 'not_reported';

export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MATCH_RESULT_BUCKETS: readonly BrazilReceitaAggregateJoinCoverageSignalMatchResultBucket[] =
  ['zero', 'one_or_more', 'not_reported'];

/** Matched / unmatched rows as a bucket. Bounded by the row cap, so `lte_200` is the widest. */
export type BrazilReceitaAggregateJoinCoverageSignalCoverageRowsBucket =
  | 'zero'
  | 'lte_200'
  | 'not_reported';

export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_COVERAGE_ROWS_BUCKETS: readonly BrazilReceitaAggregateJoinCoverageSignalCoverageRowsBucket[] =
  ['zero', 'lte_200', 'not_reported'];

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Why a coverage signal was refused. Fixed machine codes; never a value, a path, a filename. */
export type BrazilReceitaAggregateJoinCoverageSignalErrorCode =
  | 'aggregate_join_coverage_signal_not_authorized'
  | 'aggregate_join_coverage_signal_cap_required'
  | 'aggregate_join_coverage_signal_cap_exceeded'
  | 'aggregate_join_coverage_signal_missing_required_family'
  | 'aggregate_join_coverage_signal_forbidden_family'
  | 'aggregate_join_coverage_signal_file_count_exceeded'
  | 'aggregate_join_coverage_signal_zip_forbidden'
  | 'aggregate_join_coverage_signal_raw_output_forbidden'
  | 'aggregate_join_coverage_signal_identifier_output_forbidden'
  | 'aggregate_join_coverage_signal_join_output_forbidden'
  | 'aggregate_join_coverage_signal_exact_percentage_forbidden'
  | 'aggregate_join_coverage_signal_denominator_forbidden'
  | 'aggregate_join_coverage_signal_coverage_claim_forbidden'
  | 'aggregate_join_coverage_signal_production_inference_forbidden'
  | 'aggregate_join_coverage_signal_open_failed'
  | 'aggregate_join_coverage_signal_read_failed'
  | 'aggregate_join_coverage_signal_timeout';

export const BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_ERROR_CODES: readonly BrazilReceitaAggregateJoinCoverageSignalErrorCode[] =
  [
    'aggregate_join_coverage_signal_not_authorized',
    'aggregate_join_coverage_signal_cap_required',
    'aggregate_join_coverage_signal_cap_exceeded',
    'aggregate_join_coverage_signal_missing_required_family',
    'aggregate_join_coverage_signal_forbidden_family',
    'aggregate_join_coverage_signal_file_count_exceeded',
    'aggregate_join_coverage_signal_zip_forbidden',
    'aggregate_join_coverage_signal_raw_output_forbidden',
    'aggregate_join_coverage_signal_identifier_output_forbidden',
    'aggregate_join_coverage_signal_join_output_forbidden',
    'aggregate_join_coverage_signal_exact_percentage_forbidden',
    'aggregate_join_coverage_signal_denominator_forbidden',
    'aggregate_join_coverage_signal_coverage_claim_forbidden',
    'aggregate_join_coverage_signal_production_inference_forbidden',
    'aggregate_join_coverage_signal_open_failed',
    'aggregate_join_coverage_signal_read_failed',
    'aggregate_join_coverage_signal_timeout',
  ];

/**
 * A contract breach. The message is the CODE and nothing else.
 *
 * An error path is exactly where naive code interpolates the offending value into a message, and
 * this module's "offending value" is a join key. No constructor, no call site, and no rethrow
 * here passes anything but a fixed code.
 */
export class BrazilReceitaAggregateJoinCoverageSignalError extends Error {
  readonly code: BrazilReceitaAggregateJoinCoverageSignalErrorCode;

  constructor(code: BrazilReceitaAggregateJoinCoverageSignalErrorCode) {
    super(`BRSOURCE11HIMPL_AGGREGATE_JOIN_COVERAGE_SIGNAL: ${code}`);
    this.name = 'BrazilReceitaAggregateJoinCoverageSignalError';
    this.code = code;
  }
}

// ─── Signal contract ──────────────────────────────────────────────────────────

/**
 * The coverage-signal block. Every field is a boolean, a zero, a class label or a bucket. The
 * held-absence assertions are structurally always false — there is no code path that could set
 * them — and they are STATED rather than omitted so a reader of the report can see that they
 * hold.
 */
export interface BrazilReceitaAggregateJoinCoverageSignalBlock {
  /** `true` on a run that actually compared two windows; `false` on a refusal. */
  readonly coverageSignalExecuted: boolean;
  readonly coverageSignalMode: typeof BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MODE;
  readonly joinKeyValuesPrinted: false;
  /** Retention BEYOND the bounded in-memory window; the window is cleared before emit. */
  readonly joinKeyValuesRetained: false;
  readonly joinKeyHashesPrinted: false;
  readonly joinKeyErrorLeak: false;
  readonly joinedRowsPrinted: false;
  readonly joinedSamplesPrinted: false;
  readonly joinedPairsEmitted: 0;
  /** No exact figure is computed anywhere in this module, so this can only ever be false. */
  readonly exactCoveragePercentagePrinted: false;
  /** No dataset-scale denominator exists in this module, so this can only ever be false. */
  readonly fullDatasetDenominatorPrinted: false;
  readonly coverageClaimed: false;
  readonly productionInferenceAllowed: false;
  /** The only denominator this module will name: the window it actually read. */
  readonly denominatorScope: typeof BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_DENOMINATOR_SCOPE;
  readonly matchResultBucket: BrazilReceitaAggregateJoinCoverageSignalMatchResultBucket;
  readonly matchedRowsBucket: BrazilReceitaAggregateJoinCoverageSignalCoverageRowsBucket;
  readonly unmatchedRowsBucket: BrazilReceitaAggregateJoinCoverageSignalCoverageRowsBucket;
}

/**
 * What the coverage signal returns: AGGREGATE structure plus the signal block. Deliberately no
 * path, no filename, no row, no cell, no key, no byte figure, no offset and no hash — so the
 * runner can stay pure and can never be handed content to leak.
 */
export interface BrazilReceitaAggregateJoinCoverageSignalScan {
  readonly manifestTrust: typeof BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST;
  readonly familiesAttempted: readonly string[];
  /** DATA files opened. The manifest control document is not a data file and is not counted. */
  readonly filesOpenedCount: number;
  readonly filesOpenedByFamily: Readonly<Record<string, number>>;
  readonly bytesReadBucket: Readonly<
    Record<string, BrazilReceitaAggregateJoinCoverageSignalBytesBucket>
  >;
  readonly rowsReadBucket: Readonly<
    Record<string, BrazilReceitaAggregateJoinCoverageSignalRowsBucket>
  >;
  readonly rowShape: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeRowShape>>;
  readonly encodingStatus: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus>>;
  readonly delimiterStatus: Readonly<
    Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus>
  >;
  readonly headerlessStatus: Readonly<
    Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus>
  >;
  readonly forbiddenFamilyCount: number;
  readonly neverOpenedFamilyCount: number;
  readonly selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass;
  /** Structural assertions. Always false: there is no code path that could set them. */
  readonly rawRowsRetained: false;
  readonly rawCellsRetained: false;
  readonly identifiersRetained: false;
  readonly fileNamesRetained: false;
  readonly absolutePathsRetained: false;
  readonly hashesComputed: false;
  /** `true` on a run that compared two windows — the behavioural delta of this milestone. */
  readonly joinsExecuted: boolean;
  /** Coverage stays COMPUTED-NEVER, regardless of the outcome. A signal is not a coverage figure. */
  readonly joinCoverageComputed: false;
  readonly coverageSignal: BrazilReceitaAggregateJoinCoverageSignalBlock;
  /** A content / environment refusal, reported rather than thrown. `null` when acceptable. */
  readonly refusalCode: BrazilReceitaAggregateJoinCoverageSignalErrorCode | null;
}

/** What the coverage signal is asked for. Every cap is passed IN and re-enforced at read time. */
export interface BrazilReceitaAggregateJoinCoverageSignalReadRequest {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
  readonly maxFilesOpened: number;
  readonly maxBytesPerFile: number;
  readonly maxRowsPerFile: number;
  readonly maxTotalRows: number;
  readonly maxTotalBytes: number;
  readonly maxCoverageInputRows: number;
  readonly maxCoverageKeyValuesInMemory: number;
  readonly maxCoveragePairsEmitted: number;
  readonly maxCoverageRowsPrinted: number;
}

/** The injected port. Called at most ONCE per run. */
export type BrazilReceitaAggregateJoinCoverageSignalReader = (
  request: BrazilReceitaAggregateJoinCoverageSignalReadRequest,
) => BrazilReceitaAggregateJoinCoverageSignalScan;

export interface BrazilReceitaAggregateJoinCoverageSignalOptions {
  /** The ONE manifest path this module may resolve. Never returned or logged. */
  readonly manifestPath: string;
  /**
   * The owner's 11H Option C phrase, as a declared boolean.
   *
   * It is NOT inferred from `requiredFamilyJoinProbeAuthorized`: the 11G phrase authorized a
   * 20-row window and expired with its milestone. Holding it buys no wider window at all.
   */
  readonly aggregateOnlyJoinCoverageSignalAuthorized?: boolean;
  /**
   * The declaration that THIS run may execute the bounded coverage signal against the operator's
   * own local files. A separate axis from the phrase above, and equally not inferable from the
   * 11G `realLocalJoinDryRunAuthorized` declaration.
   */
  readonly realLocalJoinCoverageSignalAuthorized?: boolean;
  /**
   * The 11G join-probe authorization, still required: a coverage signal parses and compares the
   * same protected technical key, so the authorization that permits doing that at all must be
   * held too. Required IN ADDITION to — never INSTEAD of — the two flags above.
   */
  readonly requiredFamilyJoinProbeAuthorized?: boolean;
  /** The 11G real-local-join declaration, also still required and also not a substitute. */
  readonly realLocalJoinDryRunAuthorized?: boolean;
  /**
   * The 11F structural-probe authorization, still required: a coverage signal opens the same two
   * required-family files, so the authorization that permits opening them must be held too.
   */
  readonly requiredFamilyProbeAuthorized?: boolean;
  /** The metadata-only carve-out: the manifest is read as a CONTROL DOCUMENT. */
  readonly realManifestMetadataOnlyOptionBAuthorized?: boolean;
  /** The BR-SOURCE-11E declaration: this run may name the OPERATOR'S OWN prepared manifest. */
  readonly realManifestMetadataOnlyExecutionAuthorized?: boolean;
  readonly maxManifestBytes?: number;
  readonly maxDeclaredFiles?: number;
  readonly maxFilesOpened?: number;
  readonly maxBytesPerFile?: number;
  readonly maxRowsPerFile?: number;
  readonly maxTotalRows?: number;
  readonly maxTotalBytes?: number;
  readonly maxCoverageInputRows?: number;
  readonly maxCoverageKeyValuesInMemory?: number;
  readonly maxCoveragePairsEmitted?: number;
  readonly maxCoverageRowsPrinted?: number;
  /**
   * Present only so the refusals are STRUCTURAL: raw rows, raw cells, samples, identifiers,
   * declared filenames, hashes, join keys, joined rows, joined samples, join pairs, an exact
   * coverage figure, a full-dataset denominator, a coverage claim and a production inference are
   * all forbidden output. Any truthy value fails closed rather than being ignored — a request
   * that was silently dropped is a request that could be honoured later.
   */
  readonly includeRawRows?: boolean;
  readonly includeRawCells?: boolean;
  readonly includeSampleRows?: boolean;
  readonly includeIdentifiers?: boolean;
  readonly includeDeclaredFileNames?: boolean;
  readonly includeHashes?: boolean;
  readonly includeJoinKeys?: boolean;
  readonly includeJoinedRows?: boolean;
  readonly includeJoinedSamples?: boolean;
  readonly includeJoinPairs?: boolean;
  readonly includeExactCoveragePercentage?: boolean;
  readonly includeFullDatasetDenominator?: boolean;
  readonly claimCoverage?: boolean;
  readonly allowProductionInference?: boolean;
  /** Injectable clock, so the liveness deadline is testable. Defaults to `Date.now`. */
  readonly nowMs?: () => number;
}

// ─── Contract validation ──────────────────────────────────────────────────────

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

/** Refuses a manifest path that is empty, is a URL, or is not a `.json` document. */
function assertManifestPathAllowed(manifestPath: unknown): string {
  if (typeof manifestPath !== 'string' || manifestPath.trim() === '') {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_open_failed',
    );
  }
  if (looksLikeUrl(manifestPath)) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_open_failed',
    );
  }
  if (path.extname(manifestPath).toLowerCase() !== MANIFEST_EXTENSION) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_open_failed',
    );
  }
  return manifestPath;
}

/** True for a stated, non-negative, integral cap. An omitted cap is not a cap. */
function isStatedCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

interface CoverageSignalCaps {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
  readonly maxFilesOpened: number;
  readonly maxBytesPerFile: number;
  readonly maxRowsPerFile: number;
  readonly maxTotalRows: number;
  readonly maxTotalBytes: number;
  readonly maxCoverageInputRows: number;
  readonly maxCoverageKeyValuesInMemory: number;
  readonly maxCoveragePairsEmitted: number;
  readonly maxCoverageRowsPrinted: number;
}

/** Each stated cap paired with the ceiling it may not exceed. */
const CAP_CEILINGS: ReadonlyArray<readonly [keyof CoverageSignalCaps, number]> = [
  ['maxManifestBytes', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_MANIFEST_BYTES],
  ['maxDeclaredFiles', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_DECLARED_FILES],
  ['maxFilesOpened', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_OPENED],
  ['maxBytesPerFile', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE],
  ['maxRowsPerFile', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE],
  ['maxTotalRows', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS],
  ['maxTotalBytes', BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES],
  [
    'maxCoverageInputRows',
    BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS,
  ],
  [
    'maxCoverageKeyValuesInMemory',
    BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY,
  ],
];

/**
 * Every cap must be STATED and within its ceiling, and the two zero-equalities must be exactly
 * zero.
 *
 * The join-output equalities are checked FIRST and with their own code: asking for one join pair
 * is not "a slightly wider signal", it is a request for a capability this milestone does not
 * have, and it should not be reported as a cap breach.
 */
function assertCapsAllowed(caps: Partial<CoverageSignalCaps>): CoverageSignalCaps {
  for (const key of ['maxCoveragePairsEmitted', 'maxCoverageRowsPrinted'] as const) {
    if (!isStatedCap(caps[key])) {
      throw new BrazilReceitaAggregateJoinCoverageSignalError(
        'aggregate_join_coverage_signal_cap_required',
      );
    }
    if ((caps[key] as number) !== 0) {
      throw new BrazilReceitaAggregateJoinCoverageSignalError(
        'aggregate_join_coverage_signal_join_output_forbidden',
      );
    }
  }
  for (const [key] of CAP_CEILINGS) {
    if (!isStatedCap(caps[key])) {
      throw new BrazilReceitaAggregateJoinCoverageSignalError(
        'aggregate_join_coverage_signal_cap_required',
      );
    }
  }
  for (const [key, ceiling] of CAP_CEILINGS) {
    if ((caps[key] as number) > ceiling) {
      throw new BrazilReceitaAggregateJoinCoverageSignalError(
        'aggregate_join_coverage_signal_cap_exceeded',
      );
    }
  }
  return caps as CoverageSignalCaps;
}

/**
 * Refuses every forbidden OUTPUT request before a descriptor exists. Each is a separate
 * declaration so the refusal is structural rather than a matter of what the caller happens to
 * read off the returned scan.
 *
 * The four 11H-specific refusals get their own codes: an exact percentage, a full-dataset
 * denominator, a coverage claim and a production inference are four DIFFERENT overreaches, and a
 * report that lumped them together would tell the reader less than the request did.
 */
function assertOutputRequestsAllowed(
  options: BrazilReceitaAggregateJoinCoverageSignalOptions,
): void {
  if (options.includeRawRows || options.includeRawCells || options.includeSampleRows) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_raw_output_forbidden',
    );
  }
  if (options.includeIdentifiers || options.includeDeclaredFileNames || options.includeHashes) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_identifier_output_forbidden',
    );
  }
  if (
    options.includeJoinKeys ||
    options.includeJoinedRows ||
    options.includeJoinedSamples ||
    options.includeJoinPairs
  ) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_join_output_forbidden',
    );
  }
  // With bounded rows any exact figure is a statement about two prefixes, so the request is
  // DECLINED rather than served and caveated.
  if (options.includeExactCoveragePercentage) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_exact_percentage_forbidden',
    );
  }
  // A full-dataset denominator would require knowing the dataset. This module read two windows.
  if (options.includeFullDatasetDenominator) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_denominator_forbidden',
    );
  }
  // "coverage proof" / "coverage guarantee" are the same request under two names, and both are
  // refused: a signal is not a claim.
  if (options.claimCoverage) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_coverage_claim_forbidden',
    );
  }
  if (options.allowProductionInference) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_production_inference_forbidden',
    );
  }
}

// ─── Manifest read (bounded, control document) ────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads at most `maxManifestBytes` bytes of the manifest, then stops. It requests one byte BEYOND
 * the ceiling: if that byte exists the document is oversized and is refused outright, because a
 * truncated JSON document is not a smaller document — it is a different one. No `stat` is
 * involved: a file size is a fact about the operator's environment.
 */
function readManifestBounded(manifestPath: string, maxManifestBytes: number): string | null {
  const fd = fs.openSync(manifestPath, 'r');
  try {
    const buffer = Buffer.alloc(maxManifestBytes + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, maxManifestBytes + 1, 0);
    if (bytesRead > maxManifestBytes) return null;
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Family classification and selection ──────────────────────────────────────

/** True when a family label carries a forbidden personal-data token. */
function isForbiddenFamily(label: string): boolean {
  const normalized = label.toLowerCase();
  return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS.some((token) =>
    normalized.includes(token),
  );
}

interface SelectedFile {
  readonly family: string;
  readonly resolvedPath: string;
  readonly declaredEncoding: string | null;
  readonly declaredHeaderless: boolean;
}

interface DeclaredEntry {
  readonly family: string;
  readonly declaredPath: string;
  readonly declaredEncoding: string | null;
  readonly declaredLayoutMode: string | null;
}

function readDeclaredEntry(entry: unknown): DeclaredEntry | null {
  if (!isRecord(entry) || typeof entry.fileType !== 'string') return null;
  return {
    family: entry.fileType,
    declaredPath: typeof entry.path === 'string' ? entry.path : '',
    declaredEncoding: typeof entry.encoding === 'string' ? entry.encoding : null,
    declaredLayoutMode: typeof entry.layoutMode === 'string' ? entry.layoutMode : null,
  };
}

/** Resolved target must live inside `baseDir` — blocks `..` traversal by construction. */
function isWithinBaseDir(baseDir: string, resolvedTarget: string): boolean {
  const relative = path.relative(baseDir, resolvedTarget);
  if (relative === '') return false;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

type SelectionOutcome =
  | { readonly ok: true; readonly selected: readonly SelectedFile[] }
  | {
      readonly ok: false;
      readonly code: BrazilReceitaAggregateJoinCoverageSignalErrorCode;
      readonly selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass;
    };

function selectionRefusal(
  code: BrazilReceitaAggregateJoinCoverageSignalErrorCode,
  selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass,
): SelectionOutcome {
  return { ok: false, code, selectionClass };
}

/**
 * Selects at most ONE declared file per required family and refuses everything else, in family
 * order — the first family builds the key window, the second is compared against it.
 *
 * The first declared candidate per family wins: a shard set is a dataset, and picking one member
 * is what "one file each, singular" means. A family with no declaration, an archive extension, an
 * absolute or traversing declared path, or a ZIP-staging segment is refused BEFORE any descriptor
 * is opened.
 */
function selectRequiredFamilyFiles(
  entries: readonly DeclaredEntry[],
  manifestDir: string,
  manifestLayoutMode: string | null,
  maxFilesOpened: number,
): SelectionOutcome {
  if (maxFilesOpened < BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES.length) {
    return selectionRefusal(
      'aggregate_join_coverage_signal_file_count_exceeded',
      'file_count_cap_too_small',
    );
  }

  const selected: SelectedFile[] = [];
  for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
    const candidates = entries.filter((entry) => entry.family === family);
    if (candidates.length === 0) {
      return selectionRefusal(
        'aggregate_join_coverage_signal_missing_required_family',
        'family_not_declared',
      );
    }
    const candidate = candidates[0]!;
    if (candidate.declaredPath.trim() === '') {
      return selectionRefusal(
        'aggregate_join_coverage_signal_open_failed',
        'declared_path_missing',
      );
    }
    if (looksLikeUrl(candidate.declaredPath) || path.isAbsolute(candidate.declaredPath)) {
      return selectionRefusal(
        'aggregate_join_coverage_signal_open_failed',
        'declared_path_absolute_or_url',
      );
    }
    const segments = candidate.declaredPath.toLowerCase().split(/[\\/]+/);
    for (const forbidden of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS) {
      if (segments.includes(forbidden)) {
        return selectionRefusal(
          'aggregate_join_coverage_signal_open_failed',
          'declared_path_zip_staging_segment',
        );
      }
    }
    const extension = path.extname(candidate.declaredPath).toLowerCase();
    if (BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_EXTENSIONS.includes(extension)) {
      return selectionRefusal(
        'aggregate_join_coverage_signal_zip_forbidden',
        'declared_extension_archive',
      );
    }
    if (!BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_ALLOWED_EXTENSIONS.includes(extension)) {
      return selectionRefusal(
        'aggregate_join_coverage_signal_zip_forbidden',
        'declared_extension_not_tabular',
      );
    }
    const resolvedPath = path.resolve(manifestDir, candidate.declaredPath);
    if (!isWithinBaseDir(manifestDir, resolvedPath)) {
      return selectionRefusal(
        'aggregate_join_coverage_signal_open_failed',
        'declared_path_outside_manifest_directory',
      );
    }
    selected.push({
      family,
      resolvedPath,
      declaredEncoding: candidate.declaredEncoding,
      declaredHeaderless:
        (candidate.declaredLayoutMode ?? manifestLayoutMode) ===
        BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
    });
  }

  if (selected.length > maxFilesOpened) {
    return selectionRefusal(
      'aggregate_join_coverage_signal_file_count_exceeded',
      'file_count_cap_too_small',
    );
  }
  return { ok: true, selected };
}

// ─── The one field a row gives up ─────────────────────────────────────────────

/**
 * Returns the raw text of ONE delimited field at `fieldIndex`, quote-aware, or `null` when the
 * line has no such field or the field is blank.
 *
 * Deliberately NOT exported: the only caller is the bounded reader below, and a helper that hands
 * out a field value is a helper that could be used to print one. It reads exactly the requested
 * position and stops — no whole-row array, no second field, no structure.
 *
 * Surrounding quotes are removed and whitespace is trimmed, because the official files quote
 * every field; that is PARSING, not normalization. Nothing else is done to the value: no padding,
 * no digit classification, no checksum, no hashing, no promotion.
 */
function readDelimitedFieldAt(line: string, delimiter: string, fieldIndex: number): string | null {
  let index = 0;
  let start = 0;
  let inQuotes = false;
  const trimmedLine = line.replace(/\r$/, '');
  for (let i = 0; i <= trimmedLine.length; i++) {
    const atEnd = i === trimmedLine.length;
    const character = atEnd ? '' : trimmedLine[i]!;
    if (!atEnd && character === '"') {
      if (inQuotes && trimmedLine[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (atEnd || (character === delimiter && !inQuotes)) {
      if (index === fieldIndex) {
        const field = trimmedLine.slice(start, i).replace(/"/g, '').trim();
        return field === '' ? null : field;
      }
      index += 1;
      start = i + 1;
    }
  }
  return null;
}

// ─── Bounded structural + coverage read of one file ───────────────────────────

/** What the caller does with each parsed key, and whether the reader should keep going. */
type CoverageKeyVisitor = (joinKey: string) => 'continue' | 'stop';

interface FileReadOutcome {
  readonly bytesRead: number;
  readonly rowsCounted: number;
  readonly coverageRowsConsumed: number;
  readonly bytesBucket: BrazilReceitaAggregateJoinCoverageSignalBytesBucket;
  readonly rowsBucket: BrazilReceitaAggregateJoinCoverageSignalRowsBucket;
  readonly encodingStatus: BrazilReceitaRequiredFamilyProbeEncodingStatus;
  readonly delimiterStatus: BrazilReceitaRequiredFamilyProbeDelimiterStatus;
  readonly headerlessStatus: BrazilReceitaRequiredFamilyProbeHeaderlessStatus;
  readonly rowShape: BrazilReceitaRequiredFamilyProbeRowShape;
}

/**
 * Reads a bounded PREFIX of one file, classifies its structure, and hands each row's ONE join key
 * to `visitCoverageKey`.
 *
 * The loop is a near-copy of the 11F / 11G readers, and that is deliberate rather than lazy:
 * their static guards assert facts about THEIR sources — 11F holds no join-key concept at all,
 * and each module owns exactly two `openSync` sites — so hoisting the loop into a shared helper
 * would either break those guards or move regulated-value handling into a module that is audited
 * as not having it. Three small, separately-audited readers are the safer shape than one shared
 * reader with a mode flag; the flag would be the only thing standing between a 20-row structural
 * probe and a 200-row value read.
 *
 * The window is `byteBudget` bytes at most, and a trailing row the window cut in half is DROPPED
 * rather than parsed: a cut row is a different row, not a smaller one.
 *
 * Every decoded line is (a) split to COUNT its fields and (b) asked for exactly one field, which
 * is passed to the visitor and then goes out of scope. No cell, field, or line is retained,
 * returned, logged, or interpolated into a message.
 */
function readOneFileBounded(
  file: SelectedFile,
  byteBudget: number,
  rowBudget: number,
  coverageRowBudget: number,
  deadlineMs: number,
  nowMs: () => number,
  visitCoverageKey: CoverageKeyVisitor,
): FileReadOutcome {
  const fd = fs.openSync(file.resolvedPath, 'r');
  let bytesRead: number;
  let windowText: string;
  try {
    const buffer = Buffer.alloc(byteBudget);
    bytesRead = fs.readSync(fd, buffer, 0, byteBudget, 0);
    const encoding = file.declaredEncoding === 'utf8' ? 'utf8' : 'latin1';
    windowText = buffer.subarray(0, bytesRead).toString(encoding);
  } finally {
    fs.closeSync(fd);
  }

  const declaredEncodingRecognized =
    file.declaredEncoding !== null && RECOGNIZED_ENCODINGS.includes(file.declaredEncoding);
  // A replacement character or a NUL means the window did not decode as declared. Only the CLASS
  // of that outcome is reported; the offending bytes never leave this function.
  const decodedCleanly =
    !windowText.includes(REPLACEMENT_CHARACTER) && !windowText.includes(NUL_CHARACTER);

  const lines = windowText.split(/\r?\n/);
  // The window may have stopped mid-row, so the last fragment is never trusted.
  const completeLines = bytesRead >= byteBudget ? lines.slice(0, -1) : lines;

  const expectedMinColumns = getBrReceitaCnpjOfficialColumnCount(
    file.family as BrReceitaCnpjLayoutFileType,
  );
  const distribution: Record<string, number> = {};
  let rowShapeValidCount = 0;
  let rowShapeInvalidCount = 0;
  let rowsCounted = 0;
  let coverageRowsConsumed = 0;
  let delimiterStatus: BrazilReceitaRequiredFamilyProbeDelimiterStatus = 'unknown_or_invalid';

  for (const line of completeLines) {
    if (rowsCounted >= rowBudget) break;
    if (nowMs() > deadlineMs) {
      throw new BrazilReceitaAggregateJoinCoverageSignalError(
        'aggregate_join_coverage_signal_timeout',
      );
    }
    if (line.trim() === '') continue;
    const columnCount = countBrReceitaCnpjDelimitedColumns(line, OFFICIAL_DELIMITER);
    if (columnCount > 1) delimiterStatus = 'semicolon_detected';
    const bucket = String(columnCount);
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    if (columnCount === expectedMinColumns) rowShapeValidCount += 1;
    else rowShapeInvalidCount += 1;
    rowsCounted += 1;

    // The coverage step. One field position, visited, then out of scope on the next iteration.
    if (coverageRowsConsumed < coverageRowBudget) {
      const joinKey = readDelimitedFieldAt(
        line,
        OFFICIAL_DELIMITER,
        BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_KEY_COLUMN_INDEX,
      );
      if (joinKey !== null) {
        coverageRowsConsumed += 1;
        if (visitCoverageKey(joinKey) === 'stop') break;
      }
    }
    // The line and the field go out of scope here. Nothing derived from them survives except
    // counts and the visitor's own bounded window.
  }

  return {
    bytesRead,
    rowsCounted,
    coverageRowsConsumed,
    bytesBucket:
      bytesRead > BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE
        ? 'over_limit_blocked'
        : 'lte_512kb',
    rowsBucket:
      rowsCounted > BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE
        ? 'over_limit_blocked'
        : 'lte_200',
    encodingStatus: declaredEncodingRecognized && decodedCleanly ? 'ok' : 'unknown_or_invalid',
    delimiterStatus,
    headerlessStatus: file.declaredHeaderless ? 'assumed_headerless' : 'unknown_or_invalid',
    rowShape: {
      expectedMinColumns,
      observedColumnCountDistribution: distribution,
      rowShapeValidCount,
      rowShapeInvalidCount,
    },
  };
}

// ─── Coverage-signal block assembly ───────────────────────────────────────────

/** The block for a run that never got to compare anything. Green, and uninformative. */
const NOT_REPORTED_COVERAGE_BLOCK: BrazilReceitaAggregateJoinCoverageSignalBlock = {
  coverageSignalExecuted: false,
  coverageSignalMode: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MODE,
  joinKeyValuesPrinted: false,
  joinKeyValuesRetained: false,
  joinKeyHashesPrinted: false,
  joinKeyErrorLeak: false,
  joinedRowsPrinted: false,
  joinedSamplesPrinted: false,
  joinedPairsEmitted: 0,
  exactCoveragePercentagePrinted: false,
  fullDatasetDenominatorPrinted: false,
  coverageClaimed: false,
  productionInferenceAllowed: false,
  denominatorScope: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_DENOMINATOR_SCOPE,
  matchResultBucket: 'not_reported',
  matchedRowsBucket: 'not_reported',
  unmatchedRowsBucket: 'not_reported',
};

/**
 * Turns the two tallies into BUCKETS. The counts themselves never leave this function: a matched
 * count plus a row cap is enough for a reader to attempt a ratio, and the contract's answer is
 * that no ratio, no exact figure and no count is emitted at all.
 */
function buildCoverageSignalBlock(
  comparisonRan: boolean,
  matchedRows: number,
  unmatchedRows: number,
): BrazilReceitaAggregateJoinCoverageSignalBlock {
  if (!comparisonRan) {
    return { ...NOT_REPORTED_COVERAGE_BLOCK, coverageSignalExecuted: false };
  }
  return {
    ...NOT_REPORTED_COVERAGE_BLOCK,
    coverageSignalExecuted: true,
    matchResultBucket: matchedRows > 0 ? 'one_or_more' : 'zero',
    matchedRowsBucket: matchedRows > 0 ? 'lte_200' : 'zero',
    unmatchedRowsBucket: unmatchedRows > 0 ? 'lte_200' : 'zero',
  };
}

// ─── Scan assembly ────────────────────────────────────────────────────────────

function emptyRowShape(family: string): BrazilReceitaRequiredFamilyProbeRowShape {
  return {
    expectedMinColumns: getBrReceitaCnpjOfficialColumnCount(family as BrReceitaCnpjLayoutFileType),
    observedColumnCountDistribution: {},
    rowShapeValidCount: 0,
    rowShapeInvalidCount: 0,
  };
}

/**
 * The scan returned when the signal refused. Every count is zero, every status is
 * `unknown_or_invalid`, and the coverage block is `not_reported` with
 * `coverageSignalExecuted = false`: no partial structure and no partial comparison survives a
 * refusal.
 */
function blockedScan(
  refusalCode: BrazilReceitaAggregateJoinCoverageSignalErrorCode,
  forbiddenFamilyCount = 0,
  neverOpenedFamilyCount = 0,
  selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass = 'not_reached',
): BrazilReceitaAggregateJoinCoverageSignalScan {
  const filesOpenedByFamily: Record<string, number> = {};
  const bytesReadBucket: Record<string, BrazilReceitaAggregateJoinCoverageSignalBytesBucket> = {};
  const rowsReadBucket: Record<string, BrazilReceitaAggregateJoinCoverageSignalRowsBucket> = {};
  const rowShape: Record<string, BrazilReceitaRequiredFamilyProbeRowShape> = {};
  const encodingStatus: Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus> = {};
  const delimiterStatus: Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus> = {};
  const headerlessStatus: Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus> = {};
  for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
    filesOpenedByFamily[family] = 0;
    bytesReadBucket[family] = 'over_limit_blocked';
    rowsReadBucket[family] = 'over_limit_blocked';
    rowShape[family] = emptyRowShape(family);
    encodingStatus[family] = 'unknown_or_invalid';
    delimiterStatus[family] = 'unknown_or_invalid';
    headerlessStatus[family] = 'unknown_or_invalid';
  }

  return {
    manifestTrust: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
    familiesAttempted: [...BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES],
    filesOpenedCount: 0,
    filesOpenedByFamily,
    bytesReadBucket,
    rowsReadBucket,
    rowShape,
    encodingStatus,
    delimiterStatus,
    headerlessStatus,
    forbiddenFamilyCount,
    neverOpenedFamilyCount,
    selectionClass,
    rawRowsRetained: false,
    rawCellsRetained: false,
    identifiersRetained: false,
    fileNamesRetained: false,
    absolutePathsRetained: false,
    hashesComputed: false,
    joinsExecuted: false,
    joinCoverageComputed: false,
    coverageSignal: NOT_REPORTED_COVERAGE_BLOCK,
    refusalCode,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Builds the ultra-bounded AGGREGATE-ONLY real join COVERAGE SIGNAL port for ONE local manifest.
 *
 * The contract is validated EAGERLY, before any file descriptor exists: the seven authorizations,
 * the forbidden-output requests, the eleven caps and the manifest path shape are all checked
 * here, so an unauthorized or refused request never reaches the filesystem. The manifest path is
 * captured in the closure and is never returned, logged, or reported.
 *
 * All SEVEN authorizations are required and none substitutes for another:
 *   - the metadata-only carve-out permits reading a manifest at all;
 *   - the BR-SOURCE-11E declaration permits naming the operator's own prepared one;
 *   - the 11F structural-probe authorization permits opening the two required-family files;
 *   - the 11G Option C phrase permits parsing and comparing the protected technical join key;
 *   - the 11G real-local-join declaration permits doing so against local files;
 *   - the 11H Option C phrase permits doing so in the WIDER aggregate-only window;
 *   - the 11H real-local declaration permits executing that wider signal against local files.
 *
 * The last two are NOT inferred from the first five, and the first five do not become the last
 * two: the 11G phrase authorized a 20-row window and expired with its milestone.
 */
export function createBrazilReceitaAggregateJoinCoverageSignal(
  options: BrazilReceitaAggregateJoinCoverageSignalOptions,
): BrazilReceitaAggregateJoinCoverageSignalReader {
  if (
    options.aggregateOnlyJoinCoverageSignalAuthorized !== true ||
    options.realLocalJoinCoverageSignalAuthorized !== true ||
    options.requiredFamilyJoinProbeAuthorized !== true ||
    options.realLocalJoinDryRunAuthorized !== true ||
    options.requiredFamilyProbeAuthorized !== true ||
    options.realManifestMetadataOnlyOptionBAuthorized !== true ||
    options.realManifestMetadataOnlyExecutionAuthorized !== true
  ) {
    throw new BrazilReceitaAggregateJoinCoverageSignalError(
      'aggregate_join_coverage_signal_not_authorized',
    );
  }
  assertOutputRequestsAllowed(options);
  // Caps are validated at construction AND at read time: the port enforces the same bounds it was
  // built with, so a request cannot widen them later.
  const builtCaps = assertCapsAllowed({
    maxManifestBytes: options.maxManifestBytes,
    maxDeclaredFiles: options.maxDeclaredFiles,
    maxFilesOpened: options.maxFilesOpened,
    maxBytesPerFile: options.maxBytesPerFile,
    maxRowsPerFile: options.maxRowsPerFile,
    maxTotalRows: options.maxTotalRows,
    maxTotalBytes: options.maxTotalBytes,
    maxCoverageInputRows: options.maxCoverageInputRows,
    maxCoverageKeyValuesInMemory: options.maxCoverageKeyValuesInMemory,
    maxCoveragePairsEmitted: options.maxCoveragePairsEmitted,
    maxCoverageRowsPrinted: options.maxCoverageRowsPrinted,
  });
  const manifestPath = assertManifestPathAllowed(options.manifestPath);
  const nowMs = options.nowMs ?? Date.now;

  return (request: BrazilReceitaAggregateJoinCoverageSignalReadRequest) => {
    const caps = assertCapsAllowed(request);
    // A read may never ask for more than the port was built with.
    for (const [key] of CAP_CEILINGS) {
      if (caps[key] > builtCaps[key]) {
        throw new BrazilReceitaAggregateJoinCoverageSignalError(
          'aggregate_join_coverage_signal_cap_exceeded',
        );
      }
    }

    const deadlineMs = nowMs() + BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_RUNTIME_MS;

    // 1) The manifest, as a bounded CONTROL DOCUMENT read. Not a data file, not counted against
    //    `maxFilesOpened`, and bounded by its own stated ceiling.
    let manifestText: string | null;
    try {
      manifestText = readManifestBounded(manifestPath, caps.maxManifestBytes);
    } catch {
      // The underlying error is DISCARDED: it quotes a path.
      return blockedScan('aggregate_join_coverage_signal_open_failed');
    }
    if (manifestText === null) return blockedScan('aggregate_join_coverage_signal_cap_exceeded');

    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch {
      // The parse error is DISCARDED: its message quotes the document.
      return blockedScan('aggregate_join_coverage_signal_open_failed');
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
      return blockedScan('aggregate_join_coverage_signal_open_failed');
    }
    if (parsed.files.length > caps.maxDeclaredFiles) {
      return blockedScan('aggregate_join_coverage_signal_cap_exceeded');
    }

    // 2) Classify every declared family BEFORE opening anything. A personal-data family is a
    //    fail-closed refusal reported as a count — never a filename, never followed by a read.
    const declared: DeclaredEntry[] = [];
    let forbiddenFamilyCount = 0;
    let neverOpenedFamilyCount = 0;
    for (const entry of parsed.files) {
      const readEntry = readDeclaredEntry(entry);
      if (readEntry === null) continue;
      if (isForbiddenFamily(readEntry.family)) {
        forbiddenFamilyCount += 1;
        continue;
      }
      if (BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_NEVER_OPENED_FAMILIES.includes(readEntry.family)) {
        neverOpenedFamilyCount += 1;
        continue;
      }
      declared.push(readEntry);
    }
    if (forbiddenFamilyCount > 0) {
      return blockedScan(
        'aggregate_join_coverage_signal_forbidden_family',
        forbiddenFamilyCount,
        neverOpenedFamilyCount,
      );
    }

    // 3) Select exactly one file per required family. Nothing else is a candidate.
    const manifestLayoutMode =
      typeof parsed.layoutMode === 'string' ? (parsed.layoutMode as string) : null;
    const selection = selectRequiredFamilyFiles(
      declared,
      path.dirname(path.resolve(manifestPath)),
      manifestLayoutMode,
      caps.maxFilesOpened,
    );
    if (!selection.ok) {
      return blockedScan(
        selection.code,
        forbiddenFamilyCount,
        neverOpenedFamilyCount,
        selection.selectionClass,
      );
    }

    // 4) The bounded read of both files, with the comparison in between. Per-file AND total
    //    budgets are enforced on every file.
    const filesOpenedByFamily: Record<string, number> = {};
    const bytesReadBucket: Record<string, BrazilReceitaAggregateJoinCoverageSignalBytesBucket> = {};
    const rowsReadBucket: Record<string, BrazilReceitaAggregateJoinCoverageSignalRowsBucket> = {};
    const rowShape: Record<string, BrazilReceitaRequiredFamilyProbeRowShape> = {};
    const encodingStatus: Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus> = {};
    const delimiterStatus: Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus> = {};
    const headerlessStatus: Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus> = {};
    for (const family of BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES) {
      filesOpenedByFamily[family] = 0;
    }

    let filesOpenedCount = 0;
    let totalBytesRead = 0;
    let totalRowsCounted = 0;
    let totalCoverageRowsConsumed = 0;

    // THE bounded in-memory window. It holds at most `maxCoverageKeyValuesInMemory` values, is
    // never written anywhere, is never iterated for output, and is CLEARED below before any
    // aggregate is assembled.
    const firstFamilyKeys = new Set<string>();
    let matchedRows = 0;
    let unmatchedRows = 0;
    let comparedRows = 0;

    const isFirstFamily = (family: string): boolean =>
      family === BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES[0];

    for (const file of selection.selected) {
      if (nowMs() > deadlineMs) return blockedScan('aggregate_join_coverage_signal_timeout');
      if (filesOpenedCount >= caps.maxFilesOpened) {
        return blockedScan('aggregate_join_coverage_signal_file_count_exceeded');
      }
      const byteBudget = Math.min(caps.maxBytesPerFile, caps.maxTotalBytes - totalBytesRead);
      const rowBudget = Math.min(caps.maxRowsPerFile, caps.maxTotalRows - totalRowsCounted);
      const coverageRowBudget = Math.max(
        0,
        caps.maxCoverageInputRows - totalCoverageRowsConsumed,
      );
      if (byteBudget <= 0 || rowBudget <= 0) {
        return blockedScan(
          'aggregate_join_coverage_signal_cap_exceeded',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
          'selected',
        );
      }

      // The visitor is the ONLY thing that ever sees a join key, and it does one of exactly two
      // things with it: add it to the capped window, or test it for membership.
      const visitCoverageKey: CoverageKeyVisitor = isFirstFamily(file.family)
        ? (joinKey) => {
            if (firstFamilyKeys.size >= caps.maxCoverageKeyValuesInMemory) return 'stop';
            firstFamilyKeys.add(joinKey);
            return firstFamilyKeys.size >= caps.maxCoverageKeyValuesInMemory ? 'stop' : 'continue';
          }
        : (joinKey) => {
            comparedRows += 1;
            if (firstFamilyKeys.has(joinKey)) matchedRows += 1;
            else unmatchedRows += 1;
            return 'continue';
          };

      let outcome: FileReadOutcome;
      try {
        outcome = readOneFileBounded(
          file,
          byteBudget,
          rowBudget,
          coverageRowBudget,
          deadlineMs,
          nowMs,
          visitCoverageKey,
        );
      } catch (error) {
        // The underlying error is DISCARDED: it could carry a path, a fragment of a row, or a
        // join key. Only a fixed code survives — which is the `joinKeyErrorLeak = false`
        // obligation expressed as control flow.
        firstFamilyKeys.clear();
        if (
          error instanceof BrazilReceitaAggregateJoinCoverageSignalError &&
          error.code === 'aggregate_join_coverage_signal_timeout'
        ) {
          return blockedScan('aggregate_join_coverage_signal_timeout');
        }
        return blockedScan(
          'aggregate_join_coverage_signal_read_failed',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
          'selected',
        );
      }

      filesOpenedCount += 1;
      filesOpenedByFamily[file.family] = (filesOpenedByFamily[file.family] ?? 0) + 1;
      totalBytesRead += outcome.bytesRead;
      totalRowsCounted += outcome.rowsCounted;
      totalCoverageRowsConsumed += outcome.coverageRowsConsumed;
      bytesReadBucket[file.family] = outcome.bytesBucket;
      rowsReadBucket[file.family] = outcome.rowsBucket;
      rowShape[file.family] = outcome.rowShape;
      encodingStatus[file.family] = outcome.encodingStatus;
      delimiterStatus[file.family] = outcome.delimiterStatus;
      headerlessStatus[file.family] = outcome.headerlessStatus;

      // Belt and braces: the totals are re-checked AFTER each file, so a run that respected two
      // per-file budgets still cannot exceed the run budget.
      if (
        totalBytesRead > caps.maxTotalBytes ||
        totalRowsCounted > caps.maxTotalRows ||
        totalCoverageRowsConsumed > caps.maxCoverageInputRows ||
        firstFamilyKeys.size > caps.maxCoverageKeyValuesInMemory ||
        filesOpenedByFamily[file.family]! >
          BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_MAX_FILES_PER_FAMILY
      ) {
        firstFamilyKeys.clear();
        return blockedScan(
          'aggregate_join_coverage_signal_cap_exceeded',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
        );
      }
    }

    if (filesOpenedCount > caps.maxFilesOpened) {
      firstFamilyKeys.clear();
      return blockedScan('aggregate_join_coverage_signal_file_count_exceeded');
    }

    // A comparison happened only if BOTH windows produced something to compare. Otherwise the
    // outcome is `not_reported` — green, and correctly uninformative.
    const comparisonRan = firstFamilyKeys.size > 0 && comparedRows > 0;
    const coverageSignal = buildCoverageSignalBlock(comparisonRan, matchedRows, unmatchedRows);

    // The window is RELEASED here, before the aggregate is assembled. Nothing below this line can
    // reach a join key, because there is no longer one to reach.
    firstFamilyKeys.clear();

    return {
      manifestTrust: BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
      familiesAttempted: [...BRAZIL_RECEITA_AGGREGATE_JOIN_COVERAGE_SIGNAL_FAMILIES],
      filesOpenedCount,
      filesOpenedByFamily,
      bytesReadBucket,
      rowsReadBucket,
      rowShape,
      encodingStatus,
      delimiterStatus,
      headerlessStatus,
      forbiddenFamilyCount,
      neverOpenedFamilyCount,
      selectionClass: 'selected',
      rawRowsRetained: false,
      rawCellsRetained: false,
      identifiersRetained: false,
      fileNamesRetained: false,
      absolutePathsRetained: false,
      hashesComputed: false,
      joinsExecuted: coverageSignal.coverageSignalExecuted,
      joinCoverageComputed: false,
      coverageSignal,
      refusalCode: null,
    };
  };
}
