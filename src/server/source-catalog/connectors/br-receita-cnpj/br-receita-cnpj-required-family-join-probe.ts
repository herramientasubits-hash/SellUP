/**
 * BR Receita CNPJ — ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE (BR-SOURCE-11G-IMPL).
 *
 * The fourth reading port for the full-join runner, and the FIRST module in the series that
 * holds an identifier-derived value on purpose. It exists because the owner authorized
 * exactly one thing, after BR-SOURCE-11G-LAND was merged:
 *
 *     AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE
 *
 * That phrase authorizes opening the two REQUIRED families — Empresas and Estabelecimentos —
 * one file each, under the BR-SOURCE-11F caps unchanged, parsing the protected technical join
 * key EPHEMERALLY, comparing keys IN MEMORY, and reporting a coarse match bucket
 * (11G decision record § 6 Option C, § 8, § 9).
 *
 * It authorizes nothing else. It does not say what companies exist, which identifiers exist,
 * what the dataset covers, what the join RATE is, or whether any gate may be approved.
 *
 * ── Why this module exists next to the 11F probe, rather than inside it ──────────
 * The 11F probe is a STRUCTURAL probe: it splits a row to count fields and retains nothing.
 * Its own static guards assert that shape (two `openSync` sites, no `joinKey` token in its
 * source), and its runner validator refuses any scan claiming `joinsExecuted`. A join is a
 * materially weaker class of guarantee — "the value held is unreportable by construction"
 * rather than "no value is ever held" (§ 5.1) — so it gets its own module, its own trust
 * level, its own flag, its own caps and its own error vocabulary. Nothing here relaxes 11F,
 * and 11F's authorization does not reach this module.
 *
 * Every CONTRACT that can be shared is imported from the 11F probe rather than restated:
 * the family allowlist, the never-opened families, the extension allow/denylists, the
 * ZIP-staging segments, the layout mode, the file/byte/row caps, the buckets, the selection
 * classes and the row-shape shape. The bounded read loop is deliberately NOT shared — see
 * the note above the reader below.
 *
 * ── What happens to a join key, precisely ───────────────────────────────────────
 * For each row of the bounded window, ONE field is parsed: the protected technical root key
 * at the official positional index the two required families share. Then:
 *
 *   - Empresas: the value is added to a Set whose size is capped by
 *     `maxJoinKeyValuesInMemory`, and the row is discarded.
 *   - Estabelecimentos: the value is TESTED for membership against that Set, counted into a
 *     matched/unmatched tally, and discarded.
 *   - After the comparison the Set is CLEARED, before any aggregate is assembled.
 *
 * No join key value is written to a field, a report, a log, a file, an error message, a
 * template, or a return value. No key is hashed, truncated or fingerprinted — hashing an
 * identifier does not de-identify it (§ 5.1), so the only permitted operation is to decline
 * to emit it. No joined row, joined pair, or joined sample is ever constructed: the join is a
 * membership test, not a materialization (§ 8.1), which is why `maxJoinPairsEmitted` and
 * `maxJoinedRowsPrinted` are equalities at zero rather than ceilings.
 *
 * ── `not_reported` is a green result ────────────────────────────────────────────
 * Two independently-sharded 20-row prefixes need not overlap at all. Zero overlap is the
 * MOST LIKELY outcome and it is not a failure, not evidence that the dataset does not join,
 * and not a reason to widen the caps (§ 7.1). `match_result_bucket` is `zero` when the
 * comparison ran and found nothing, and `not_reported` when no meaningful statement can be
 * made — a cap consumed before comparison, or a window with no parseable key. Both are `ok`.
 *
 * ── Refusal vs. throw ───────────────────────────────────────────────────────────
 * Identical to the 11F split, deliberately:
 *
 *   - A CONTRACT breach THROWS `BrazilReceitaRequiredFamilyJoinProbeError`, whose message is
 *     a fixed code and nothing else: an authorization was not declared, a cap was not stated
 *     or exceeds its ceiling, or raw-row / raw-cell / identifier / join-key / joined-row /
 *     join-pair / coverage output was requested.
 *
 *   - A MANIFEST-CONTENT or ENVIRONMENT refusal is REPORTED, not thrown: a forbidden family,
 *     a missing required family, a file-count breach, an archive, an unopenable path, an
 *     unreadable window, or the liveness deadline come back as `refusalCode` alongside zeroed
 *     aggregates and a `not_reported` join block.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens more than one file per required family, or more than two data files per run.
 *   - opens a catalog file, a Sócios/QSA/CPF file, a ZIP, or a raw-zip staging area.
 *   - reads beyond the stated per-file or total byte and row ceilings, or truncates a row and
 *     counts it as valid.
 *   - parses a second field "for context": exactly one field position per row (§ 8.1).
 *   - retains, returns, or logs a row, a cell, a column value, a join key, a CNPJ, a CNPJ
 *     básico, a CPF, a legal name, a trade name, an address, an email, a phone, a filename, a
 *     basename, a filesystem path, a byte offset, a line number tied to a value, or a hash /
 *     fingerprint / truncation of any of them.
 *   - emits a joined row, a joined sample, a join pair, a coverage percentage, a ratio, or a
 *     match rate; or claims coverage.
 *   - constructs a `record_identity_key` or a `normalized_tax_id`.
 *   - reads an environment variable, constructs a client, downloads, imports, writes to
 *     Supabase, or touches runtime, Agent 1, a provider, HubSpot, or Slack.
 *   - approves a gate. A green probe says a join MECHANISM works on real input under caps. It
 *     is not evidence about coverage, join rates, quality, eligibility, GATE-1 or GATE-2, and
 *     `not_reported` is not evidence of anything at all.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  BrazilReceitaCalibrationPhase,
  BrazilReceitaCalibrationRecorder,
  BrazilReceitaCalibrationSamplePoint,
} from './br-receita-cnpj-calibration-instrumentation';
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
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_PER_FAMILY,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_RUNTIME_MS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_NEVER_OPENED_FAMILIES,
  type BrazilReceitaRequiredFamilyProbeBytesBucket,
  type BrazilReceitaRequiredFamilyProbeDelimiterStatus,
  type BrazilReceitaRequiredFamilyProbeEncodingStatus,
  type BrazilReceitaRequiredFamilyProbeHeaderlessStatus,
  type BrazilReceitaRequiredFamilyProbeRowShape,
  type BrazilReceitaRequiredFamilyProbeRowsBucket,
  type BrazilReceitaRequiredFamilyProbeSelectionClass,
} from './br-receita-cnpj-required-family-probe';

// ─── Trust and family vocabulary ──────────────────────────────────────────────

/**
 * The trust level this join probe declares. A FIFTH distinct value: the synthetic-temp,
 * metadata-only, structural-probe and join-probe carve-outs are separate authorizations, and
 * no trust level or flag substitutes for another (11G decision record § 1).
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_TRUST =
  'real_manifest_required_family_join_probe' as const;

/** The one join mode this module implements. A class label, not a strategy switch. */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MODE =
  'ultra_bounded_required_family_in_memory' as const;

/**
 * The families a join probe may open, in probe order: the key window is built from the FIRST
 * and tested against the SECOND. Imported from the structural probe so the two carve-outs
 * cannot drift apart, and so this module adds no file, no glob and no new family.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES: readonly string[] = [
  ...BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES,
];

/**
 * The positional index of the protected technical root key inside the official headerless
 * layout. It is the same position in both required families, which is what makes a positional
 * join possible without a header row — and reading exactly this ONE position per row is the
 * whole of "parse only the protected technical join key" (§ 8.1).
 *
 * A layout constant, not data: it names a column position, never a value.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX = 0 as const;

/**
 * Which BR-SOURCE-14B.0A calibration phase each required family's bounded read belongs to.
 *
 * A LOOKUP, not a strategy: the probe still iterates the families in probe order and still reads
 * each one exactly as before. This map only tells the optional recorder which phase boundary a
 * given iteration corresponds to, so the two reads can be timed separately without the loop
 * having to know anything about measurement.
 *
 * The second family's phase deliberately absorbs the join: the membership tests happen inside
 * that read, so no separable join phase exists to name (see the instrumentation module's
 * non-separable-phase declaration).
 */
const CALIBRATION_PHASE_BY_FAMILY: Readonly<
  Record<
    string,
    { readonly phase: BrazilReceitaCalibrationPhase; readonly point: BrazilReceitaCalibrationSamplePoint }
  >
> = {
  empresas: { phase: 'empresas_read', point: 'after_empresas_read' },
  estabelecimentos: { phase: 'estabelecimentos_read', point: 'after_estabelecimentos_read' },
};

/** The extension the manifest CONTROL DOCUMENT must carry. */
const MANIFEST_EXTENSION = '.json';

/** The delimiter the official Receita headerless layout uses. */
const OFFICIAL_DELIMITER = ';';

/** Declared encodings the probe recognizes when classifying `encoding_status`. */
const RECOGNIZED_ENCODINGS: readonly string[] = ['latin1', 'utf8'];

/**
 * Decode-failure markers, assembled from code points so no control character or replacement
 * glyph appears in this source file. Their PRESENCE is reported as a class label; the
 * offending bytes never leave the reader.
 */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const NUL_CHARACTER = String.fromCharCode(0);

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * The file / byte / row ceilings are the BR-SOURCE-11F ceilings, imported UNCHANGED
 * (§ 9: "The file/byte/row caps are the BR-SOURCE-11F caps, unchanged"). This milestone opens
 * no additional file and reads no additional byte; the only delta is what happens to one
 * parsed field between being read and being discarded.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_PER_FAMILY =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_PER_FAMILY;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES;

/** The liveness ceiling, also unchanged: a fixed internal deadline no flag can widen. */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_RUNTIME_MS =
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_RUNTIME_MS;

/**
 * The four NEW caps of § 9 — the join caps.
 *
 * `MAX_JOIN_INPUT_ROWS` and `MAX_JOIN_KEY_VALUES_IN_MEMORY` bound the weakest guarantee in
 * the record: they make "ephemeral" checkable, because the in-memory window can never exceed
 * the rows the run was allowed to read in the first place.
 *
 * `MAX_JOIN_PAIRS_EMITTED` and `MAX_JOINED_ROWS_PRINTED` are EQUALITIES at zero, not
 * ceilings. A value above zero is not a wider probe — it is a different, unauthorized
 * capability, so it is refused with its own join-output code rather than as a cap breach.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS = 40 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY = 40 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED = 0 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED = 0 as const;

// ─── Buckets ──────────────────────────────────────────────────────────────────

/**
 * Whether the mechanism found anything at all. Deliberately coarse (§ 10.1): it answers the
 * question without emitting a count that could be divided into a rate.
 *
 * `zero`          — the comparison ran and no key from the second window was present in the first.
 * `one_or_more`   — the comparison ran and at least one key was present.
 * `not_reported`  — no meaningful statement can be made. A green outcome, not an error (§ 7.1).
 */
export type BrazilReceitaRequiredFamilyJoinProbeMatchResultBucket =
  | 'zero'
  | 'one_or_more'
  | 'not_reported';

export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MATCH_RESULT_BUCKETS: readonly BrazilReceitaRequiredFamilyJoinProbeMatchResultBucket[] =
  ['zero', 'one_or_more', 'not_reported'];

/** Matched / unmatched rows as a bucket. Bounded by the row cap, so `lte_20` is the widest. */
export type BrazilReceitaRequiredFamilyJoinProbeRowsBucket = 'zero' | 'lte_20' | 'not_reported';

export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_ROWS_BUCKETS: readonly BrazilReceitaRequiredFamilyJoinProbeRowsBucket[] =
  ['zero', 'lte_20', 'not_reported'];

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Why a join probe was refused. Fixed machine codes; never a value, a path, or a filename. */
export type BrazilReceitaRequiredFamilyJoinProbeErrorCode =
  | 'required_family_join_probe_not_authorized'
  | 'required_family_join_probe_cap_required'
  | 'required_family_join_probe_cap_exceeded'
  | 'required_family_join_probe_missing_required_family'
  | 'required_family_join_probe_forbidden_family'
  | 'required_family_join_probe_file_count_exceeded'
  | 'required_family_join_probe_zip_forbidden'
  | 'required_family_join_probe_raw_output_forbidden'
  | 'required_family_join_probe_identifier_output_forbidden'
  | 'required_family_join_probe_join_output_forbidden'
  | 'required_family_join_probe_coverage_forbidden'
  | 'required_family_join_probe_open_failed'
  | 'required_family_join_probe_read_failed'
  | 'required_family_join_probe_timeout';

export const BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_ERROR_CODES: readonly BrazilReceitaRequiredFamilyJoinProbeErrorCode[] =
  [
    'required_family_join_probe_not_authorized',
    'required_family_join_probe_cap_required',
    'required_family_join_probe_cap_exceeded',
    'required_family_join_probe_missing_required_family',
    'required_family_join_probe_forbidden_family',
    'required_family_join_probe_file_count_exceeded',
    'required_family_join_probe_zip_forbidden',
    'required_family_join_probe_raw_output_forbidden',
    'required_family_join_probe_identifier_output_forbidden',
    'required_family_join_probe_join_output_forbidden',
    'required_family_join_probe_coverage_forbidden',
    'required_family_join_probe_open_failed',
    'required_family_join_probe_read_failed',
    'required_family_join_probe_timeout',
  ];

/**
 * A contract breach. The message is the CODE and nothing else.
 *
 * This matters more here than anywhere earlier in the series: an error path is exactly where
 * naive code interpolates the offending value into a message, and a join probe's "offending
 * value" is a join key (§ 5.1). No constructor, no call site, and no rethrow in this module
 * passes anything but a fixed code.
 */
export class BrazilReceitaRequiredFamilyJoinProbeError extends Error {
  readonly code: BrazilReceitaRequiredFamilyJoinProbeErrorCode;

  constructor(code: BrazilReceitaRequiredFamilyJoinProbeErrorCode) {
    super(`BRSOURCE11GIMPL_REQUIRED_FAMILY_JOIN_PROBE: ${code}`);
    this.name = 'BrazilReceitaRequiredFamilyJoinProbeError';
    this.code = code;
  }
}

// ─── Probe contract ───────────────────────────────────────────────────────────

/**
 * The join block (§ 10). Every field is a boolean, a zero, a class label or a bucket. The
 * held-absence assertions are structurally always false — there is no code path that could
 * set them — and they are STATED rather than omitted so a reader of the report can see that
 * they hold, which is the § 5 proof obligation expressed as output.
 */
export interface BrazilReceitaRequiredFamilyJoinProbeJoinBlock {
  /** `true` on a run that actually compared two windows; `false` on a refusal. */
  readonly joinExecuted: boolean;
  readonly joinMode: typeof BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MODE;
  readonly joinKeyValuesPrinted: false;
  /** Retention BEYOND the bounded in-memory window; the window is cleared before emit (§ 5.1). */
  readonly joinKeyValuesRetained: false;
  readonly joinKeyHashesPrinted: false;
  readonly joinKeyErrorLeak: false;
  readonly joinedRowsPrinted: false;
  readonly joinedSamplesPrinted: false;
  readonly joinedPairsEmitted: 0;
  readonly coveragePercentagePrinted: false;
  readonly coverageClaimed: false;
  readonly matchResultBucket: BrazilReceitaRequiredFamilyJoinProbeMatchResultBucket;
  readonly matchedRowsBucket: BrazilReceitaRequiredFamilyJoinProbeRowsBucket;
  readonly unmatchedRowsBucket: BrazilReceitaRequiredFamilyJoinProbeRowsBucket;
}

/**
 * What the join probe returns: AGGREGATE structure plus the join block. Deliberately no path,
 * no filename, no row, no cell, no key, no byte figure, no offset and no hash — so the runner
 * can stay pure and can never be handed content to leak.
 */
export interface BrazilReceitaRequiredFamilyJoinProbeScan {
  readonly manifestTrust: typeof BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_TRUST;
  readonly familiesAttempted: readonly string[];
  /** DATA files opened. The manifest control document is not a data file and is not counted. */
  readonly filesOpenedCount: number;
  readonly filesOpenedByFamily: Readonly<Record<string, number>>;
  readonly bytesReadBucket: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeBytesBucket>>;
  readonly rowsReadBucket: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeRowsBucket>>;
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
  /**
   * The ONE assertion that flips relative to 11F (§ 10.1). `true` on a run that compared two
   * windows — and it is the entire behavioural delta of this milestone.
   */
  readonly joinsExecuted: boolean;
  /** Coverage stays computed-never, regardless of the join outcome. */
  readonly joinCoverageComputed: false;
  readonly joinProbe: BrazilReceitaRequiredFamilyJoinProbeJoinBlock;
  /** A content / environment refusal, reported rather than thrown. `null` when acceptable. */
  readonly refusalCode: BrazilReceitaRequiredFamilyJoinProbeErrorCode | null;
}

/** What the join probe is asked for. Every cap is passed IN and re-enforced at read time. */
export interface BrazilReceitaRequiredFamilyJoinProbeReadRequest {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
  readonly maxFilesOpened: number;
  readonly maxBytesPerFile: number;
  readonly maxRowsPerFile: number;
  readonly maxTotalRows: number;
  readonly maxTotalBytes: number;
  readonly maxJoinInputRows: number;
  readonly maxJoinKeyValuesInMemory: number;
  readonly maxJoinPairsEmitted: number;
  readonly maxJoinedRowsPrinted: number;
}

/** The injected port. Called at most ONCE per run. */
export type BrazilReceitaRequiredFamilyJoinProbeReader = (
  request: BrazilReceitaRequiredFamilyJoinProbeReadRequest,
) => BrazilReceitaRequiredFamilyJoinProbeScan;

export interface BrazilReceitaRequiredFamilyJoinProbeOptions {
  /** The ONE manifest path this probe may resolve. Never returned or logged. */
  readonly manifestPath: string;
  /**
   * The owner's 11G Option C phrase, as a declared boolean.
   *
   * It is NOT inferred from `requiredFamilyProbeAuthorized`: the 11F phrase authorized opening
   * two files to count columns and expired with its milestone (11G § 1). Holding it buys no
   * join at all.
   */
  readonly requiredFamilyJoinProbeAuthorized?: boolean;
  /**
   * The declaration that THIS run may execute the bounded join against the operator's own
   * local files. A separate axis from the phrase above, and equally not inferable from the
   * 11F `realManifestMetadataOnlyExecutionAuthorized` / data-file declarations.
   */
  readonly realLocalJoinDryRunAuthorized?: boolean;
  /**
   * The 11F structural-probe authorization, still required: a join probe opens the same two
   * required-family files, so the authorization that permits opening them at all must be held
   * too. Required IN ADDITION to — never INSTEAD of — the two flags above.
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
  readonly maxJoinInputRows?: number;
  readonly maxJoinKeyValuesInMemory?: number;
  readonly maxJoinPairsEmitted?: number;
  readonly maxJoinedRowsPrinted?: number;
  /**
   * Present only so the refusals are STRUCTURAL: raw rows, raw cells, samples, identifiers,
   * declared filenames, hashes, join keys, joined rows, joined samples, join pairs and any
   * coverage figure are all forbidden output. Any truthy value fails closed rather than being
   * ignored — a request that was silently dropped is a request that could be honoured later.
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
  readonly computeCoverage?: boolean;
  readonly includeCoveragePercentage?: boolean;
  /** Injectable clock, so the liveness deadline is testable. Defaults to `Date.now`. */
  readonly nowMs?: () => number;
  /**
   * The optional BR-SOURCE-14B.0A calibration recorder. An OBSERVER: it is handed phase
   * boundaries and sample points, and it is never read back into a decision.
   *
   * Omitted by default, which is what keeps this milestone behaviour-preserving — every existing
   * caller and every existing test constructs a probe with no recorder and gets byte-identical
   * behaviour, because the instrumented call sites collapse to optional-call no-ops.
   *
   * It is deliberately NOT the same clock as `nowMs`. `nowMs` is a WALL clock enforcing the
   * liveness deadline; the recorder carries its own MONOTONIC clock for durations, and the two
   * are never combined into one figure.
   */
  readonly calibrationRecorder?: BrazilReceitaCalibrationRecorder;
}

// ─── Contract validation ──────────────────────────────────────────────────────

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

/** Refuses a manifest path that is empty, is a URL, or is not a `.json` document. */
function assertManifestPathAllowed(manifestPath: unknown): string {
  if (typeof manifestPath !== 'string' || manifestPath.trim() === '') {
    throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_open_failed');
  }
  if (looksLikeUrl(manifestPath)) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_open_failed');
  }
  if (path.extname(manifestPath).toLowerCase() !== MANIFEST_EXTENSION) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_open_failed');
  }
  return manifestPath;
}

/** True for a stated, non-negative, integral cap. An omitted cap is not a cap. */
function isStatedCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

interface JoinProbeCaps {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
  readonly maxFilesOpened: number;
  readonly maxBytesPerFile: number;
  readonly maxRowsPerFile: number;
  readonly maxTotalRows: number;
  readonly maxTotalBytes: number;
  readonly maxJoinInputRows: number;
  readonly maxJoinKeyValuesInMemory: number;
  readonly maxJoinPairsEmitted: number;
  readonly maxJoinedRowsPrinted: number;
}

/** Each stated cap paired with the ceiling it may not exceed. */
const CAP_CEILINGS: ReadonlyArray<readonly [keyof JoinProbeCaps, number]> = [
  ['maxManifestBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES],
  ['maxDeclaredFiles', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES],
  ['maxFilesOpened', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED],
  ['maxBytesPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE],
  ['maxRowsPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE],
  ['maxTotalRows', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS],
  ['maxTotalBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES],
  ['maxJoinInputRows', BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS],
  [
    'maxJoinKeyValuesInMemory',
    BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
  ],
];

/**
 * Every cap must be STATED and within its ceiling, and the two zero-equalities must be
 * exactly zero.
 *
 * The join-output equalities are checked FIRST and with their own code: asking for one join
 * pair is not "a slightly wider probe", it is a request for a capability this milestone does
 * not have, and it should not be reported as a cap breach.
 */
function assertCapsAllowed(caps: Partial<JoinProbeCaps>): JoinProbeCaps {
  for (const key of ['maxJoinPairsEmitted', 'maxJoinedRowsPrinted'] as const) {
    if (!isStatedCap(caps[key])) {
      throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_cap_required');
    }
    if ((caps[key] as number) !== 0) {
      throw new BrazilReceitaRequiredFamilyJoinProbeError(
        'required_family_join_probe_join_output_forbidden',
      );
    }
  }
  for (const [key] of CAP_CEILINGS) {
    if (!isStatedCap(caps[key])) {
      throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_cap_required');
    }
  }
  for (const [key, ceiling] of CAP_CEILINGS) {
    if ((caps[key] as number) > ceiling) {
      throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_cap_exceeded');
    }
  }
  return caps as JoinProbeCaps;
}

/**
 * Refuses every forbidden OUTPUT request before a descriptor exists. Each is a separate
 * declaration so the refusal is structural rather than a matter of what the caller happens to
 * read off the returned scan.
 */
function assertOutputRequestsAllowed(
  options: BrazilReceitaRequiredFamilyJoinProbeOptions,
): void {
  if (options.includeRawRows || options.includeRawCells || options.includeSampleRows) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError(
      'required_family_join_probe_raw_output_forbidden',
    );
  }
  if (options.includeIdentifiers || options.includeDeclaredFileNames || options.includeHashes) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError(
      'required_family_join_probe_identifier_output_forbidden',
    );
  }
  if (
    options.includeJoinKeys ||
    options.includeJoinedRows ||
    options.includeJoinedSamples ||
    options.includeJoinPairs
  ) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError(
      'required_family_join_probe_join_output_forbidden',
    );
  }
  // `coverageAllowed = false` is a REFUSAL, not a labelling rule (§ 9.1): with bounded rows
  // any ratio is a statement about two prefixes, so the request is declined rather than
  // served and caveated.
  if (options.computeCoverage || options.includeCoveragePercentage) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError(
      'required_family_join_probe_coverage_forbidden',
    );
  }
}

// ─── Manifest read (bounded, control document) ────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads at most `maxManifestBytes` bytes of the manifest, then stops. It requests one byte
 * BEYOND the ceiling: if that byte exists the document is oversized and is refused outright,
 * because a truncated JSON document is not a smaller document — it is a different one. No
 * `stat` is involved: a file size is a fact about the operator's environment.
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
      readonly code: BrazilReceitaRequiredFamilyJoinProbeErrorCode;
      readonly selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass;
    };

function selectionRefusal(
  code: BrazilReceitaRequiredFamilyJoinProbeErrorCode,
  selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass,
): SelectionOutcome {
  return { ok: false, code, selectionClass };
}

/**
 * Selects at most ONE declared file per required family and refuses everything else, in
 * family order — the first family builds the key window, the second is compared against it.
 *
 * The first declared candidate per family wins: a shard set is a dataset, and picking one
 * member is what "one file each, singular" means. A family with no declaration, an archive
 * extension, an absolute or traversing declared path, or a ZIP-staging segment is refused
 * BEFORE any descriptor is opened.
 */
function selectRequiredFamilyFiles(
  entries: readonly DeclaredEntry[],
  manifestDir: string,
  manifestLayoutMode: string | null,
  maxFilesOpened: number,
): SelectionOutcome {
  if (maxFilesOpened < BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES.length) {
    return selectionRefusal(
      'required_family_join_probe_file_count_exceeded',
      'file_count_cap_too_small',
    );
  }

  const selected: SelectedFile[] = [];
  for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
    const candidates = entries.filter((entry) => entry.family === family);
    if (candidates.length === 0) {
      return selectionRefusal(
        'required_family_join_probe_missing_required_family',
        'family_not_declared',
      );
    }
    const candidate = candidates[0]!;
    if (candidate.declaredPath.trim() === '') {
      return selectionRefusal('required_family_join_probe_open_failed', 'declared_path_missing');
    }
    if (looksLikeUrl(candidate.declaredPath) || path.isAbsolute(candidate.declaredPath)) {
      return selectionRefusal(
        'required_family_join_probe_open_failed',
        'declared_path_absolute_or_url',
      );
    }
    const segments = candidate.declaredPath.toLowerCase().split(/[\\/]+/);
    for (const forbidden of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS) {
      if (segments.includes(forbidden)) {
        return selectionRefusal(
          'required_family_join_probe_open_failed',
          'declared_path_zip_staging_segment',
        );
      }
    }
    const extension = path.extname(candidate.declaredPath).toLowerCase();
    if (BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_EXTENSIONS.includes(extension)) {
      return selectionRefusal(
        'required_family_join_probe_zip_forbidden',
        'declared_extension_archive',
      );
    }
    if (!BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_ALLOWED_EXTENSIONS.includes(extension)) {
      return selectionRefusal(
        'required_family_join_probe_zip_forbidden',
        'declared_extension_not_tabular',
      );
    }
    const resolvedPath = path.resolve(manifestDir, candidate.declaredPath);
    if (!isWithinBaseDir(manifestDir, resolvedPath)) {
      return selectionRefusal(
        'required_family_join_probe_open_failed',
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
      'required_family_join_probe_file_count_exceeded',
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
 * Deliberately NOT exported: the only caller is the bounded reader below, and a helper that
 * hands out a field value is a helper that could be used to print one. It reads exactly the
 * requested position and stops — no whole-row array, no second field, no structure (§ 8.1).
 *
 * Surrounding quotes are removed and whitespace is trimmed, because the official files quote
 * every field; that is PARSING, not normalization. Nothing else is done to the value: no
 * padding, no digit classification, no checksum, no hashing, no promotion.
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

// ─── Bounded structural + join read of one file ───────────────────────────────

/** What the caller does with each parsed key, and whether the reader should keep going. */
type JoinKeyVisitor = (joinKey: string) => 'continue' | 'stop';

interface FileReadOutcome {
  readonly bytesRead: number;
  readonly rowsCounted: number;
  readonly joinRowsConsumed: number;
  readonly bytesBucket: BrazilReceitaRequiredFamilyProbeBytesBucket;
  readonly rowsBucket: BrazilReceitaRequiredFamilyProbeRowsBucket;
  readonly encodingStatus: BrazilReceitaRequiredFamilyProbeEncodingStatus;
  readonly delimiterStatus: BrazilReceitaRequiredFamilyProbeDelimiterStatus;
  readonly headerlessStatus: BrazilReceitaRequiredFamilyProbeHeaderlessStatus;
  readonly rowShape: BrazilReceitaRequiredFamilyProbeRowShape;
}

/**
 * Reads a bounded PREFIX of one file, classifies its structure, and hands each row's ONE join
 * key to `visitJoinKey`.
 *
 * The loop is a near-copy of the 11F structural reader, and that is deliberate rather than
 * lazy: 11F's static guards assert that ITS source contains exactly two `openSync` sites and
 * no join-key concept at all, so hoisting the loop into a shared helper would either break
 * those guards or move regulated-value handling into a module 11F is audited as not having.
 * Two small, separately-audited readers are the safer shape than one shared reader with a
 * mode flag — the flag would be the only thing standing between a structural probe and a
 * join.
 *
 * The window is `byteBudget` bytes at most, and a trailing row the window cut in half is
 * DROPPED rather than parsed: a cut row is a different row, not a smaller one (§ 9.1).
 *
 * Every decoded line is (a) split to COUNT its fields and (b) asked for exactly one field,
 * which is passed to the visitor and then goes out of scope. No cell, field, or line is
 * retained, returned, logged, or interpolated into a message.
 */
function readOneFileBounded(
  file: SelectedFile,
  byteBudget: number,
  rowBudget: number,
  joinRowBudget: number,
  deadlineMs: number,
  nowMs: () => number,
  visitJoinKey: JoinKeyVisitor,
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
  // A replacement character or a NUL means the window did not decode as declared. Only the
  // CLASS of that outcome is reported; the offending bytes never leave this function.
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
  let joinRowsConsumed = 0;
  let delimiterStatus: BrazilReceitaRequiredFamilyProbeDelimiterStatus = 'unknown_or_invalid';

  for (const line of completeLines) {
    if (rowsCounted >= rowBudget) break;
    if (nowMs() > deadlineMs) {
      throw new BrazilReceitaRequiredFamilyJoinProbeError('required_family_join_probe_timeout');
    }
    if (line.trim() === '') continue;
    const columnCount = countBrReceitaCnpjDelimitedColumns(line, OFFICIAL_DELIMITER);
    if (columnCount > 1) delimiterStatus = 'semicolon_detected';
    const bucket = String(columnCount);
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    if (columnCount === expectedMinColumns) rowShapeValidCount += 1;
    else rowShapeInvalidCount += 1;
    rowsCounted += 1;

    // The join step. One field position, visited, then out of scope on the next iteration.
    if (joinRowsConsumed < joinRowBudget) {
      const joinKey = readDelimitedFieldAt(
        line,
        OFFICIAL_DELIMITER,
        BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX,
      );
      if (joinKey !== null) {
        joinRowsConsumed += 1;
        if (visitJoinKey(joinKey) === 'stop') break;
      }
    }
    // The line and the field go out of scope here. Nothing derived from them survives except
    // counts and the visitor's own bounded window.
  }

  return {
    bytesRead,
    rowsCounted,
    joinRowsConsumed,
    bytesBucket:
      bytesRead > BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE
        ? 'over_limit_blocked'
        : 'lte_64kb',
    rowsBucket:
      rowsCounted > BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE
        ? 'over_limit_blocked'
        : 'lte_20',
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

// ─── Join block assembly ──────────────────────────────────────────────────────

/** The join block for a run that never got to compare anything. Green, and uninformative. */
const NOT_REPORTED_JOIN_BLOCK: BrazilReceitaRequiredFamilyJoinProbeJoinBlock = {
  joinExecuted: false,
  joinMode: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MODE,
  joinKeyValuesPrinted: false,
  joinKeyValuesRetained: false,
  joinKeyHashesPrinted: false,
  joinKeyErrorLeak: false,
  joinedRowsPrinted: false,
  joinedSamplesPrinted: false,
  joinedPairsEmitted: 0,
  coveragePercentagePrinted: false,
  coverageClaimed: false,
  matchResultBucket: 'not_reported',
  matchedRowsBucket: 'not_reported',
  unmatchedRowsBucket: 'not_reported',
};

/**
 * Turns the two tallies into BUCKETS. The counts themselves never leave this function: a
 * matched count plus a row cap is enough for a reader to attempt a ratio, and the contract's
 * answer is that no ratio and no count is emitted at all (§ 10.1).
 */
function buildJoinBlock(
  comparisonRan: boolean,
  matchedRows: number,
  unmatchedRows: number,
): BrazilReceitaRequiredFamilyJoinProbeJoinBlock {
  if (!comparisonRan) return { ...NOT_REPORTED_JOIN_BLOCK, joinExecuted: false };
  return {
    ...NOT_REPORTED_JOIN_BLOCK,
    joinExecuted: true,
    matchResultBucket: matchedRows > 0 ? 'one_or_more' : 'zero',
    matchedRowsBucket: matchedRows > 0 ? 'lte_20' : 'zero',
    unmatchedRowsBucket: unmatchedRows > 0 ? 'lte_20' : 'zero',
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
 * The scan returned when the probe refused. Every count is zero, every status is
 * `unknown_or_invalid`, and the join block is `not_reported` with `joinExecuted = false`: no
 * partial structure and no partial join survives a refusal.
 */
function blockedScan(
  refusalCode: BrazilReceitaRequiredFamilyJoinProbeErrorCode,
  forbiddenFamilyCount = 0,
  neverOpenedFamilyCount = 0,
  selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass = 'not_reached',
): BrazilReceitaRequiredFamilyJoinProbeScan {
  const filesOpenedByFamily: Record<string, number> = {};
  const bytesReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeBytesBucket> = {};
  const rowsReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeRowsBucket> = {};
  const rowShape: Record<string, BrazilReceitaRequiredFamilyProbeRowShape> = {};
  const encodingStatus: Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus> = {};
  const delimiterStatus: Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus> = {};
  const headerlessStatus: Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus> = {};
  for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
    filesOpenedByFamily[family] = 0;
    bytesReadBucket[family] = 'over_limit_blocked';
    rowsReadBucket[family] = 'over_limit_blocked';
    rowShape[family] = emptyRowShape(family);
    encodingStatus[family] = 'unknown_or_invalid';
    delimiterStatus[family] = 'unknown_or_invalid';
    headerlessStatus[family] = 'unknown_or_invalid';
  }

  return {
    manifestTrust: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
    familiesAttempted: [...BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES],
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
    joinProbe: NOT_REPORTED_JOIN_BLOCK,
    refusalCode,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Builds the ultra-bounded required-family JOIN probe port for ONE local manifest.
 *
 * The contract is validated EAGERLY, before any file descriptor exists: the five
 * authorizations, the forbidden-output requests, the eleven caps and the manifest path shape
 * are all checked here, so an unauthorized or refused request never reaches the filesystem.
 * The manifest path is captured in the closure and is never returned, logged, or reported.
 *
 * All FIVE authorizations are required and none substitutes for another:
 *   - the metadata-only carve-out permits reading a manifest at all;
 *   - the BR-SOURCE-11E declaration permits naming the operator's own prepared one;
 *   - the 11F structural-probe authorization permits opening the two required-family files;
 *   - the 11G Option C phrase permits parsing and comparing the protected technical join key;
 *   - the real-local-join declaration permits doing so against the operator's local files.
 *
 * The last two are NOT inferred from the first three, and the first three do not become the
 * last two: the 11F phrase authorized counting columns and expired with its milestone.
 */
export function createBrazilReceitaRequiredFamilyJoinProbe(
  options: BrazilReceitaRequiredFamilyJoinProbeOptions,
): BrazilReceitaRequiredFamilyJoinProbeReader {
  if (
    options.requiredFamilyJoinProbeAuthorized !== true ||
    options.realLocalJoinDryRunAuthorized !== true ||
    options.requiredFamilyProbeAuthorized !== true ||
    options.realManifestMetadataOnlyOptionBAuthorized !== true ||
    options.realManifestMetadataOnlyExecutionAuthorized !== true
  ) {
    throw new BrazilReceitaRequiredFamilyJoinProbeError(
      'required_family_join_probe_not_authorized',
    );
  }
  assertOutputRequestsAllowed(options);
  // Caps are validated at construction AND at read time: the probe enforces the same bounds
  // it was built with, so a request cannot widen them later.
  const builtCaps = assertCapsAllowed({
    maxManifestBytes: options.maxManifestBytes,
    maxDeclaredFiles: options.maxDeclaredFiles,
    maxFilesOpened: options.maxFilesOpened,
    maxBytesPerFile: options.maxBytesPerFile,
    maxRowsPerFile: options.maxRowsPerFile,
    maxTotalRows: options.maxTotalRows,
    maxTotalBytes: options.maxTotalBytes,
    maxJoinInputRows: options.maxJoinInputRows,
    maxJoinKeyValuesInMemory: options.maxJoinKeyValuesInMemory,
    maxJoinPairsEmitted: options.maxJoinPairsEmitted,
    maxJoinedRowsPrinted: options.maxJoinedRowsPrinted,
  });
  const manifestPath = assertManifestPathAllowed(options.manifestPath);
  const nowMs = options.nowMs ?? Date.now;
  const recorder = options.calibrationRecorder;

  return (request: BrazilReceitaRequiredFamilyJoinProbeReadRequest) => {
    // The probe-owned phases open here. Every one of them closes only on the path that actually
    // completed the work: a refusal below leaves its phase open, and an open phase is reported as
    // `not_measured` rather than as a fabricated duration.
    recorder?.beginPhase('manifest_validation');
    const caps = assertCapsAllowed(request);
    // A read may never ask for more than the probe was built with.
    for (const [key] of CAP_CEILINGS) {
      if (caps[key] > builtCaps[key]) {
        throw new BrazilReceitaRequiredFamilyJoinProbeError(
          'required_family_join_probe_cap_exceeded',
        );
      }
    }

    const deadlineMs = nowMs() + BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_RUNTIME_MS;

    // 1) The manifest, as a bounded CONTROL DOCUMENT read. Not a data file, not counted
    //    against `maxFilesOpened`, and bounded by its own stated ceiling.
    let manifestText: string | null;
    try {
      manifestText = readManifestBounded(manifestPath, caps.maxManifestBytes);
    } catch {
      // The underlying error is DISCARDED: it quotes a path.
      return blockedScan('required_family_join_probe_open_failed');
    }
    if (manifestText === null) return blockedScan('required_family_join_probe_cap_exceeded');

    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch {
      // The parse error is DISCARDED: its message quotes the document.
      return blockedScan('required_family_join_probe_open_failed');
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
      return blockedScan('required_family_join_probe_open_failed');
    }
    if (parsed.files.length > caps.maxDeclaredFiles) {
      return blockedScan('required_family_join_probe_cap_exceeded');
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
        'required_family_join_probe_forbidden_family',
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
    // Validation is complete and no data descriptor exists yet: the honest boundary between
    // "deciding what may be opened" and "opening it".
    recorder?.endPhase('manifest_validation');
    recorder?.sample('after_manifest_validation');

    // 4) The bounded read of both files, with the join in between. Per-file AND total budgets
    //    are enforced on every file, exactly as the structural probe enforces them.
    const filesOpenedByFamily: Record<string, number> = {};
    const bytesReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeBytesBucket> = {};
    const rowsReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeRowsBucket> = {};
    const rowShape: Record<string, BrazilReceitaRequiredFamilyProbeRowShape> = {};
    const encodingStatus: Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus> = {};
    const delimiterStatus: Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus> = {};
    const headerlessStatus: Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus> = {};
    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES) {
      filesOpenedByFamily[family] = 0;
    }

    let filesOpenedCount = 0;
    let totalBytesRead = 0;
    let totalRowsCounted = 0;
    let totalJoinRowsConsumed = 0;

    // THE bounded in-memory window. It holds at most `maxJoinKeyValuesInMemory` values, is
    // never written anywhere, is never iterated for output, and is CLEARED below before any
    // aggregate is assembled (§ 5.1).
    const firstFamilyKeys = new Set<string>();
    let matchedRows = 0;
    let unmatchedRows = 0;
    let comparedRows = 0;

    const isFirstFamily = (family: string): boolean =>
      family === BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES[0];

    for (const file of selection.selected) {
      if (nowMs() > deadlineMs) return blockedScan('required_family_join_probe_timeout');
      if (filesOpenedCount >= caps.maxFilesOpened) {
        return blockedScan('required_family_join_probe_file_count_exceeded');
      }
      const byteBudget = Math.min(caps.maxBytesPerFile, caps.maxTotalBytes - totalBytesRead);
      const rowBudget = Math.min(caps.maxRowsPerFile, caps.maxTotalRows - totalRowsCounted);
      const joinRowBudget = Math.max(0, caps.maxJoinInputRows - totalJoinRowsConsumed);
      if (byteBudget <= 0 || rowBudget <= 0) {
        return blockedScan(
          'required_family_join_probe_cap_exceeded',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
          'selected',
        );
      }

      // The visitor is the ONLY thing that ever sees a join key, and it does one of exactly
      // two things with it: add it to the capped window, or test it for membership.
      const visitJoinKey: JoinKeyVisitor = isFirstFamily(file.family)
        ? (joinKey) => {
            if (firstFamilyKeys.size >= caps.maxJoinKeyValuesInMemory) return 'stop';
            firstFamilyKeys.add(joinKey);
            return firstFamilyKeys.size >= caps.maxJoinKeyValuesInMemory ? 'stop' : 'continue';
          }
        : (joinKey) => {
            comparedRows += 1;
            if (firstFamilyKeys.has(joinKey)) matchedRows += 1;
            else unmatchedRows += 1;
            return 'continue';
          };

      // The calibration boundary for THIS family's bounded read. Opened before the descriptor and
      // closed only after the read returns, so a read that refused or threw leaves the phase open
      // and therefore `not_measured`.
      const calibration = CALIBRATION_PHASE_BY_FAMILY[file.family];
      if (calibration !== undefined) recorder?.beginPhase(calibration.phase);

      let outcome: FileReadOutcome;
      try {
        outcome = readOneFileBounded(
          file,
          byteBudget,
          rowBudget,
          joinRowBudget,
          deadlineMs,
          nowMs,
          visitJoinKey,
        );
      } catch (error) {
        // The underlying error is DISCARDED: it could carry a path, a fragment of a row, or a
        // join key. Only a fixed code survives — which is the `join_key_error_leak = false`
        // obligation of § 5.1 expressed as control flow.
        firstFamilyKeys.clear();
        if (
          error instanceof BrazilReceitaRequiredFamilyJoinProbeError &&
          error.code === 'required_family_join_probe_timeout'
        ) {
          return blockedScan('required_family_join_probe_timeout');
        }
        return blockedScan(
          'required_family_join_probe_read_failed',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
          'selected',
        );
      }

      if (calibration !== undefined) {
        recorder?.endPhase(calibration.phase);
        recorder?.sample(calibration.point);
      }

      filesOpenedCount += 1;
      filesOpenedByFamily[file.family] = (filesOpenedByFamily[file.family] ?? 0) + 1;
      totalBytesRead += outcome.bytesRead;
      totalRowsCounted += outcome.rowsCounted;
      totalJoinRowsConsumed += outcome.joinRowsConsumed;
      bytesReadBucket[file.family] = outcome.bytesBucket;
      rowsReadBucket[file.family] = outcome.rowsBucket;
      rowShape[file.family] = outcome.rowShape;
      encodingStatus[file.family] = outcome.encodingStatus;
      delimiterStatus[file.family] = outcome.delimiterStatus;
      headerlessStatus[file.family] = outcome.headerlessStatus;

      // Belt and braces: the totals are re-checked AFTER each file, so a probe that respected
      // two per-file budgets still cannot exceed the run budget.
      if (
        totalBytesRead > caps.maxTotalBytes ||
        totalRowsCounted > caps.maxTotalRows ||
        totalJoinRowsConsumed > caps.maxJoinInputRows ||
        firstFamilyKeys.size > caps.maxJoinKeyValuesInMemory ||
        filesOpenedByFamily[file.family]! >
          BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_PER_FAMILY
      ) {
        firstFamilyKeys.clear();
        return blockedScan(
          'required_family_join_probe_cap_exceeded',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
        );
      }
    }

    if (filesOpenedCount > caps.maxFilesOpened) {
      firstFamilyKeys.clear();
      return blockedScan('required_family_join_probe_file_count_exceeded');
    }

    // A comparison happened only if BOTH windows produced something to compare. Otherwise the
    // outcome is `not_reported` — green, and correctly uninformative (§ 7.1).
    const comparisonRan = firstFamilyKeys.size > 0 && comparedRows > 0;
    const joinProbe = buildJoinBlock(comparisonRan, matchedRows, unmatchedRows);

    // The window is RELEASED here, before the aggregate is assembled. Nothing below this line
    // can reach a join key, because there is no longer one to reach.
    firstFamilyKeys.clear();

    // The join is complete and the window is gone. There is no `join` PHASE to close: the
    // membership tests ran inside the second family's read, which is why the instrumentation
    // declares `join` non-separable instead of timing this remnant and calling it the join.
    recorder?.sample('after_join');

    return {
      manifestTrust: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
      familiesAttempted: [...BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_FAMILIES],
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
      joinsExecuted: joinProbe.joinExecuted,
      joinCoverageComputed: false,
      joinProbe,
      refusalCode: null,
    };
  };
}
