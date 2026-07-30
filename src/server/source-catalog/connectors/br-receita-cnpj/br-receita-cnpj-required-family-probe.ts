/**
 * BR Receita CNPJ — ULTRA-BOUNDED REQUIRED-FAMILY PROBE (BR-SOURCE-11F-IMPL).
 *
 * The third implementation of a reading port for the full-join runner, and the FIRST
 * module in the series authorized to open a file a manifest REFERENCES. It exists
 * because the owner authorized exactly one thing, after BR-SOURCE-11F-LAND was merged:
 *
 *     AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL DATA-FILE PROBE
 *
 * That phrase authorizes opening the two REQUIRED families — Empresas and
 * Estabelecimentos — one file each, under hard caps, to answer exactly one question
 * (decision record § 3):
 *
 *     Can the minimum required files be opened and parsed STRUCTURALLY under caps,
 *     without exposing any value?
 *
 * It authorizes nothing else. It does not say what companies exist, which identifiers
 * exist, what the dataset covers, whether a join works, or whether any gate may be
 * approved.
 *
 * ── What this module opens, and what it refuses ─────────────────────────────────
 * Per run it resolves at most THREE paths: the manifest (a CONTROL DOCUMENT, as in
 * BR-SOURCE-11D-META), plus at most ONE declared file for `empresas` and at most ONE for
 * `estabelecimentos`. That "one file per required family, two data files total" bound is
 * the load-bearing invariant of the carve-out (decision record § 7.1), and it is asserted
 * by tests rather than left to intent.
 *
 * Categorically refused, on every flag:
 *   - catalog families (`cnaes`, `municipios`, `naturezas`) and `simples` — declared
 *     families are COUNTED, never opened;
 *   - Sócios / QSA / CPF / person families — a declaration is a fail-closed refusal
 *     reported as a count, never a filename, and never followed by a read;
 *   - archives (`.zip`, `.gz`, `.7z`, …): a cap in bytes of compressed input is not a cap
 *     on the decompressed content, so an archive is an unbounded read behind a
 *     bounded-looking call;
 *   - a ZIP staging (`raw-zips`) directory segment, an absolute declared path, and a declared
 *     path resolving outside the manifest's own directory.
 *
 * ── What "structurally" means here ──────────────────────────────────────────────
 * A row is split to COUNT its fields and is then discarded. No field value is retained,
 * compared, normalized, returned, logged, stored beyond the loop iteration, or passed to
 * anything other than a counter (decision record § 7.1). The window is a bounded PREFIX of
 * the file; a trailing row the window cut in half is dropped rather than counted, because a
 * partial row is not a smaller row — it is a different one.
 *
 * ── Refusal vs. throw ───────────────────────────────────────────────────────────
 * Two distinct failure surfaces, deliberately, mirroring the metadata reader:
 *
 *   - A CONTRACT breach THROWS `BrazilReceitaRequiredFamilyProbeError`, whose message is a
 *     fixed code and nothing else: the probe was not authorized, a cap was not stated or
 *     exceeds its ceiling, or raw-row / raw-cell / identifier / join output was requested.
 *
 *   - A MANIFEST-CONTENT or ENVIRONMENT refusal is REPORTED, not thrown: a forbidden
 *     family, a missing required family, a file-count breach, an archive, an unopenable
 *     path, an unreadable window, or the liveness deadline come back on the scan as
 *     `refusalCode` alongside zeroed aggregates, so the runner can fail closed AND still
 *     state why.
 *
 * The error vocabulary is deliberately CLOSED to the codes the milestone brief enumerates.
 * A path that is a URL, is not `.json`, is absolute, traverses out of the manifest
 * directory, sits under a ZIP-staging segment, or cannot be opened all resolve to
 * `required_family_probe_open_failed`: they are all "this path may not be opened", and
 * distinguishing them further in a machine code would describe the operator's filesystem.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens more than one file per required family, or more than two data files per run.
 *   - opens a catalog file, a Sócios/QSA/CPF file, a ZIP, or a raw-zip staging area.
 *   - reads beyond the stated per-file or total byte and row ceilings, or truncates a row
 *     and counts it as valid.
 *   - retains, returns, or logs a row, a cell, a column value, a CNPJ, a CNPJ básico, a
 *     CPF, a legal name, a trade name, an address, an email, a phone, a join key, a
 *     filename, a basename, a filesystem path, a byte offset, a line number tied to a
 *     value, or a hash / fingerprint / truncation of any of them.
 *   - computes a join, a join key, a coverage figure, or a ratio.
 *   - reads an environment variable, constructs a client, downloads, imports, writes to
 *     Supabase, or touches runtime, Agent 1, a provider, HubSpot, or Slack.
 *   - approves a gate, or produces evidence about the real dataset. A green probe says the
 *     two required files parse structurally under caps. It says nothing about coverage,
 *     join rates, or eligibility, and it is not citable as GATE-1 or GATE-2 evidence.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS,
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
} from './br-receita-cnpj-manifest';
import {
  countBrReceitaCnpjDelimitedColumns,
  getBrReceitaCnpjOfficialColumnCount,
  type BrReceitaCnpjLayoutFileType,
} from './br-receita-cnpj-file-reader';
import { BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS } from './br-receita-cnpj-real-manifest-metadata-reader';

// ─── Trust and family vocabulary ──────────────────────────────────────────────

/**
 * The trust level this probe declares. A FOURTH distinct value: the synthetic-temp,
 * metadata-only and probe carve-outs are separate authorizations, and no trust level or
 * flag substitutes for another (decision record § 5.1).
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_TRUST =
  'real_manifest_required_family_probe' as const;

/**
 * The ONLY families a probe may open, in probe order. Identical to the manifest layer's
 * required file types — the probe opens the minimum required set and nothing beyond it.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES: readonly string[] = [
  ...BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
];

/**
 * Families that may be DECLARED and counted but must never be opened. Listed so the
 * refusal is structural: a probe that "just peeks" at a catalog file has left Option C.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_NEVER_OPENED_FAMILIES: readonly string[] = [
  'simples',
  'cnaes',
  'municipios',
  'naturezas',
];

/** Data-file extensions a probe may open. A ZIP is an unbounded read, so it is refused. */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_ALLOWED_EXTENSIONS: readonly string[] = [
  ...BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS,
];

/**
 * Archive extensions refused outright. Denylist LABELS for a fail-closed guard: caps
 * expressed in bytes of compressed input are not caps on decompressed content.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_EXTENSIONS: readonly string[] = [
  '.zip',
  '.gz',
  '.gzip',
  '.tar',
  '.tgz',
  '.7z',
  '.rar',
  '.bz2',
  '.xz',
  '.zst',
];

/**
 * Directory segments a DECLARED DATA path may never sit under. Deliberately much shorter
 * than the metadata reader's manifest denylist, and scoped to exactly one thing: the ZIP
 * STAGING area.
 *
 * Option C authorizes opening the operator's already-EXTRACTED, manifest-declared
 * required-family files, so the operator's staging root and the area their manifest is
 * prepared in are NOT refused here — a directory name says nothing about whether a file is
 * bounded-readable. A ZIP staging area is different in kind: it holds archives, and a cap
 * expressed in bytes of compressed input is not a cap on the decompressed content. That is
 * the prohibition the milestone states ("no ZIPs, no raw-zips"), and it is the one enforced.
 *
 * Denylist labels, never locations. The extension allowlist below is the second, independent
 * guard: an archive is refused by extension wherever it sits.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS: readonly string[] =
  ['raw-zips', 'raw_zips'];

/** The extension the manifest CONTROL DOCUMENT must carry. */
const MANIFEST_EXTENSION = '.json';

/** The delimiter the official Receita headerless layout uses. */
const OFFICIAL_DELIMITER = ';';

/** Declared encodings the probe recognizes when classifying `encoding_status`. */
const RECOGNIZED_ENCODINGS: readonly string[] = ['latin1', 'utf8'];

/**
 * Decode-failure markers, assembled from code points rather than written literally so no
 * control character or replacement glyph appears in this source file. Their PRESENCE in a
 * decoded window is reported as a class label; the offending bytes never leave the probe.
 */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const NUL_CHARACTER = String.fromCharCode(0);

/** The layout mode a probe run expects the manifest to declare. */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE = 'official_headerless' as const;

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * Hard ceilings from decision record § 8. Every one is REQUIRED of the caller — a cap the
 * caller never stated is a cap nobody agreed to, so an omitted cap is a fail-closed error
 * rather than a defaulted one. Two ceilings per axis, deliberately: the per-file caps bound
 * one file, the total caps bound the run, and a probe that respects the per-file caps twice
 * must still respect the totals.
 *
 * These numbers carry no implication whatsoever for real-data ceilings, which are a GATE-2
 * deliverable and are neither proposed nor anticipated here.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED = 2 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_PER_FAMILY = 1 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE = 64_000 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE = 20 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS = 40 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES = 128_000 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES = 1_000_000 as const;
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES = 20 as const;

/**
 * The liveness ceiling (decision record § 8, `maxRuntimeSeconds <= 30`). Deliberately NOT
 * a caller-stated cap: it is a fixed internal deadline that no flag can widen, so a
 * pathological input cannot turn a bounded probe into a long-running process holding
 * regulated bytes in memory.
 */
export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_RUNTIME_MS = 30_000 as const;

/** How much of a file was read, as a BUCKET rather than a byte figure. */
export type BrazilReceitaRequiredFamilyProbeBytesBucket = 'lte_64kb' | 'over_limit_blocked';

/** How many rows were parsed, as a BUCKET rather than a row figure. */
export type BrazilReceitaRequiredFamilyProbeRowsBucket = 'lte_20' | 'over_limit_blocked';

/** Whether the window decoded cleanly under a recognized declared encoding. */
export type BrazilReceitaRequiredFamilyProbeEncodingStatus = 'ok' | 'unknown_or_invalid';

/** Whether the official semicolon delimiter was observed structurally. */
export type BrazilReceitaRequiredFamilyProbeDelimiterStatus =
  | 'semicolon_detected'
  | 'unknown_or_invalid';

/** Whether the manifest declared the official headerless layout for this file. */
export type BrazilReceitaRequiredFamilyProbeHeaderlessStatus =
  | 'assumed_headerless'
  | 'unknown_or_invalid';

/**
 * WHY selection reached the outcome it did, as a CLASS LABEL.
 *
 * The error vocabulary is closed (several distinct path refusals all collapse to
 * `required_family_probe_open_failed`), which is right for a machine code but leaves an
 * operator unable to tell a traversing declaration from a staging one. This label closes that
 * gap without describing the filesystem: it names the RULE that fired, never the path, the
 * filename, the segment, or the extension that tripped it.
 */
export type BrazilReceitaRequiredFamilyProbeSelectionClass =
  | 'selected'
  | 'family_not_declared'
  | 'declared_path_missing'
  | 'declared_path_absolute_or_url'
  | 'declared_path_zip_staging_segment'
  | 'declared_path_outside_manifest_directory'
  | 'declared_extension_archive'
  | 'declared_extension_not_tabular'
  | 'file_count_cap_too_small'
  | 'not_reached';

export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_SELECTION_CLASSES: readonly BrazilReceitaRequiredFamilyProbeSelectionClass[] =
  [
    'selected',
    'family_not_declared',
    'declared_path_missing',
    'declared_path_absolute_or_url',
    'declared_path_zip_staging_segment',
    'declared_path_outside_manifest_directory',
    'declared_extension_archive',
    'declared_extension_not_tabular',
    'file_count_cap_too_small',
    'not_reached',
  ];

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Why a probe was refused. Fixed machine codes; never a value, a path, or a filename. */
export type BrazilReceitaRequiredFamilyProbeErrorCode =
  | 'required_family_probe_not_authorized'
  | 'required_family_probe_cap_required'
  | 'required_family_probe_cap_exceeded'
  | 'required_family_probe_missing_required_family'
  | 'required_family_probe_forbidden_family'
  | 'required_family_probe_file_count_exceeded'
  | 'required_family_probe_zip_forbidden'
  | 'required_family_probe_raw_output_forbidden'
  | 'required_family_probe_identifier_output_forbidden'
  | 'required_family_probe_join_forbidden'
  | 'required_family_probe_open_failed'
  | 'required_family_probe_read_failed'
  | 'required_family_probe_timeout';

export const BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_ERROR_CODES: readonly BrazilReceitaRequiredFamilyProbeErrorCode[] =
  [
    'required_family_probe_not_authorized',
    'required_family_probe_cap_required',
    'required_family_probe_cap_exceeded',
    'required_family_probe_missing_required_family',
    'required_family_probe_forbidden_family',
    'required_family_probe_file_count_exceeded',
    'required_family_probe_zip_forbidden',
    'required_family_probe_raw_output_forbidden',
    'required_family_probe_identifier_output_forbidden',
    'required_family_probe_join_forbidden',
    'required_family_probe_open_failed',
    'required_family_probe_read_failed',
    'required_family_probe_timeout',
  ];

/**
 * A contract breach. The message is the CODE and nothing else — a probe failure could
 * otherwise carry a path, a filename, or a fragment of a row.
 */
export class BrazilReceitaRequiredFamilyProbeError extends Error {
  readonly code: BrazilReceitaRequiredFamilyProbeErrorCode;

  constructor(code: BrazilReceitaRequiredFamilyProbeErrorCode) {
    super(`BRSOURCE11FIMPL_REQUIRED_FAMILY_PROBE: ${code}`);
    this.name = 'BrazilReceitaRequiredFamilyProbeError';
    this.code = code;
  }
}

// ─── Probe contract ───────────────────────────────────────────────────────────

/**
 * The structural shape observed in one family's bounded window. A HISTOGRAM plus two
 * counts: "N rows had K columns" is a shape statement, whereas "row 7 had 30 columns"
 * would be a pointer into regulated content and is forbidden (decision record § 9.1).
 */
export interface BrazilReceitaRequiredFamilyProbeRowShape {
  /** The official positional column count for this family. A layout constant, not data. */
  readonly expectedMinColumns: number;
  /** Keys are observed column COUNTS rendered as strings; values are row counts. */
  readonly observedColumnCountDistribution: Readonly<Record<string, number>>;
  readonly rowShapeValidCount: number;
  readonly rowShapeInvalidCount: number;
}

/**
 * What the probe returns: AGGREGATE structure only. Deliberately no path, no filename, no
 * row, no cell, no byte figure, no offset, and no hash — so the runner can stay pure and
 * can never be handed content to leak.
 */
export interface BrazilReceitaRequiredFamilyProbeScan {
  readonly manifestTrust: typeof BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_TRUST;
  /** The families the probe was asked to open. Always the two required families. */
  readonly familiesAttempted: readonly string[];
  /** DATA files opened. The manifest control document is not a data file and is not counted. */
  readonly filesOpenedCount: number;
  readonly filesOpenedByFamily: Readonly<Record<string, number>>;
  readonly bytesReadBucket: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeBytesBucket>>;
  readonly rowsReadBucket: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeRowsBucket>>;
  readonly rowShape: Readonly<Record<string, BrazilReceitaRequiredFamilyProbeRowShape>>;
  readonly encodingStatus: Readonly<
    Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus>
  >;
  readonly delimiterStatus: Readonly<
    Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus>
  >;
  readonly headerlessStatus: Readonly<
    Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus>
  >;
  /** Personal-data families DECLARED by the manifest. Counted, never opened, never named. */
  readonly forbiddenFamilyCount: number;
  /** Catalog / regime families declared. Counted, never opened. */
  readonly neverOpenedFamilyCount: number;
  /** Which selection rule fired. `selected` on a green probe. Never a path or a filename. */
  readonly selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass;
  /** Structural assertions. Always false: there is no code path that could set them. */
  readonly rawRowsRetained: false;
  readonly rawCellsRetained: false;
  readonly identifiersRetained: false;
  readonly fileNamesRetained: false;
  readonly absolutePathsRetained: false;
  readonly hashesComputed: false;
  readonly joinsExecuted: false;
  /** A content / environment refusal, reported rather than thrown. `null` when acceptable. */
  readonly refusalCode: BrazilReceitaRequiredFamilyProbeErrorCode | null;
}

/** What the probe is asked for. Every cap is passed IN and re-enforced at read time. */
export interface BrazilReceitaRequiredFamilyProbeReadRequest {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
  readonly maxFilesOpened: number;
  readonly maxBytesPerFile: number;
  readonly maxRowsPerFile: number;
  readonly maxTotalRows: number;
  readonly maxTotalBytes: number;
}

/** The injected port. Called at most ONCE per run. */
export type BrazilReceitaRequiredFamilyProbeReader = (
  request: BrazilReceitaRequiredFamilyProbeReadRequest,
) => BrazilReceitaRequiredFamilyProbeScan;

export interface BrazilReceitaRequiredFamilyProbeOptions {
  /** The ONE manifest path this probe may resolve. Never returned or logged. */
  readonly manifestPath: string;
  /** The owner's Option C phrase, as a declared boolean. Absent ⇒ the probe refuses. */
  readonly requiredFamilyProbeAuthorized?: boolean;
  /**
   * The metadata-only carve-out, still required: the probe reads the manifest as a CONTROL
   * DOCUMENT, so the authorization that permits reading a manifest at all must be held too.
   */
  readonly realManifestMetadataOnlyOptionBAuthorized?: boolean;
  /**
   * The BR-SOURCE-11E declaration: this run may name the OPERATOR'S OWN prepared manifest.
   * Required here, because a probe of real required-family files is by definition a probe of
   * an operator-prepared file set.
   */
  readonly realManifestMetadataOnlyExecutionAuthorized?: boolean;
  readonly maxManifestBytes?: number;
  readonly maxDeclaredFiles?: number;
  readonly maxFilesOpened?: number;
  readonly maxBytesPerFile?: number;
  readonly maxRowsPerFile?: number;
  readonly maxTotalRows?: number;
  readonly maxTotalBytes?: number;
  /**
   * Present only so the refusals are structural: raw rows, raw cells, samples, identifiers,
   * declared filenames, hashes and joins are all forbidden output. Any truthy value fails
   * closed rather than being ignored.
   */
  readonly includeRawRows?: boolean;
  readonly includeRawCells?: boolean;
  readonly includeSampleRows?: boolean;
  readonly includeIdentifiers?: boolean;
  readonly includeDeclaredFileNames?: boolean;
  readonly includeHashes?: boolean;
  readonly computeJoin?: boolean;
  /** Injectable clock, so the liveness deadline is testable. Defaults to `Date.now`. */
  readonly nowMs?: () => number;
}

// ─── Contract validation ──────────────────────────────────────────────────────

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

/**
 * Refuses a manifest path that is empty, is a URL, or is not a `.json` document. The
 * offending path is NEVER echoed — only the fixed refusal code survives.
 *
 * Unlike the metadata reader, the operator's staging segments and prepared basenames are
 * NOT refused: naming the operator's own prepared manifest is exactly what the BR-SOURCE-11E
 * declaration authorized, and a required-family probe has no other kind of manifest to read.
 */
function assertManifestPathAllowed(manifestPath: unknown): string {
  if (typeof manifestPath !== 'string' || manifestPath.trim() === '') {
    throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_open_failed');
  }
  if (looksLikeUrl(manifestPath)) {
    throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_open_failed');
  }
  if (path.extname(manifestPath).toLowerCase() !== MANIFEST_EXTENSION) {
    throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_open_failed');
  }
  return manifestPath;
}

/** True for a stated, positive, integral cap. An omitted cap is not a cap. */
function isStatedCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

interface ProbeCaps {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
  readonly maxFilesOpened: number;
  readonly maxBytesPerFile: number;
  readonly maxRowsPerFile: number;
  readonly maxTotalRows: number;
  readonly maxTotalBytes: number;
}

/** Each stated cap paired with the ceiling it may not exceed. */
const CAP_CEILINGS: ReadonlyArray<readonly [keyof ProbeCaps, number]> = [
  ['maxManifestBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_MANIFEST_BYTES],
  ['maxDeclaredFiles', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_DECLARED_FILES],
  ['maxFilesOpened', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_OPENED],
  ['maxBytesPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE],
  ['maxRowsPerFile', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE],
  ['maxTotalRows', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_ROWS],
  ['maxTotalBytes', BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_TOTAL_BYTES],
];

/**
 * Every cap must be STATED and within its ceiling. A missing cap and an oversized cap are
 * distinct codes on purpose: "you did not agree to a bound" and "you agreed to too much"
 * are different mistakes.
 */
function assertCapsAllowed(caps: Partial<ProbeCaps>): ProbeCaps {
  for (const [key] of CAP_CEILINGS) {
    if (!isStatedCap(caps[key])) {
      throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_cap_required');
    }
  }
  for (const [key, ceiling] of CAP_CEILINGS) {
    if ((caps[key] as number) > ceiling) {
      throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_cap_exceeded');
    }
  }
  return caps as ProbeCaps;
}

/**
 * Refuses every forbidden OUTPUT request before a descriptor exists. Each is a separate
 * declaration so the refusal is structural rather than a matter of what the caller happens
 * to read off the returned scan.
 */
function assertOutputRequestsAllowed(options: BrazilReceitaRequiredFamilyProbeOptions): void {
  if (options.includeRawRows || options.includeRawCells || options.includeSampleRows) {
    throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_raw_output_forbidden');
  }
  if (options.includeIdentifiers || options.includeDeclaredFileNames || options.includeHashes) {
    throw new BrazilReceitaRequiredFamilyProbeError(
      'required_family_probe_identifier_output_forbidden',
    );
  }
  if (options.computeJoin) {
    throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_join_forbidden');
  }
}

// ─── Manifest read (bounded, control document) ────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads at most `maxManifestBytes` bytes of the manifest, then stops. It requests one byte
 * BEYOND the ceiling: if that byte exists the document is oversized and is refused
 * outright, because a truncated JSON document is not a smaller document — it is a
 * different one. No `stat` is involved: a file size is a fact about the operator's
 * environment, and the ceiling is applied to the read itself.
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

// ─── Family classification ────────────────────────────────────────────────────

/** True when a family label carries a forbidden personal-data token. */
function isForbiddenFamily(label: string): boolean {
  const normalized = label.toLowerCase();
  return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS.some((token) =>
    normalized.includes(token),
  );
}

/**
 * One SELECTED declared entry: the family it belongs to, the resolved path (held in this
 * module only, never returned), and the declaration the probe classifies against.
 */
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
      readonly code: BrazilReceitaRequiredFamilyProbeErrorCode;
      readonly selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass;
    };

/** The refusal CLASS the selection reached, so the machine code stays closed but explicable. */
function selectionRefusal(
  code: BrazilReceitaRequiredFamilyProbeErrorCode,
  selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass,
): SelectionOutcome {
  return { ok: false, code, selectionClass };
}

/**
 * Selects at most ONE declared file per required family and refuses everything else.
 *
 * The first declared candidate per family wins: a shard set is a dataset, and picking one
 * member is what "one file each, singular" means (decision record § 7.1). A family with no
 * declaration, an archive extension, an absolute or traversing declared path, or a ZIP-staging
 * segment is refused BEFORE any descriptor is opened.
 */
function selectRequiredFamilyFiles(
  entries: readonly DeclaredEntry[],
  manifestDir: string,
  manifestLayoutMode: string | null,
  maxFilesOpened: number,
): SelectionOutcome {
  if (maxFilesOpened < BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES.length) {
    return selectionRefusal('required_family_probe_file_count_exceeded', 'file_count_cap_too_small');
  }

  const selected: SelectedFile[] = [];
  for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
    const candidates = entries.filter((entry) => entry.family === family);
    if (candidates.length === 0) {
      return selectionRefusal(
        'required_family_probe_missing_required_family',
        'family_not_declared',
      );
    }
    const candidate = candidates[0]!;
    if (candidate.declaredPath.trim() === '') {
      return selectionRefusal('required_family_probe_open_failed', 'declared_path_missing');
    }
    if (looksLikeUrl(candidate.declaredPath) || path.isAbsolute(candidate.declaredPath)) {
      return selectionRefusal(
        'required_family_probe_open_failed',
        'declared_path_absolute_or_url',
      );
    }
    const segments = candidate.declaredPath.toLowerCase().split(/[\\/]+/);
    for (const forbidden of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_DATA_PATH_SEGMENTS) {
      if (segments.includes(forbidden)) {
        return selectionRefusal(
          'required_family_probe_open_failed',
          'declared_path_zip_staging_segment',
        );
      }
    }
    const extension = path.extname(candidate.declaredPath).toLowerCase();
    if (BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FORBIDDEN_EXTENSIONS.includes(extension)) {
      return selectionRefusal('required_family_probe_zip_forbidden', 'declared_extension_archive');
    }
    if (!BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_ALLOWED_EXTENSIONS.includes(extension)) {
      return selectionRefusal(
        'required_family_probe_zip_forbidden',
        'declared_extension_not_tabular',
      );
    }
    const resolvedPath = path.resolve(manifestDir, candidate.declaredPath);
    if (!isWithinBaseDir(manifestDir, resolvedPath)) {
      return selectionRefusal(
        'required_family_probe_open_failed',
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
    return selectionRefusal('required_family_probe_file_count_exceeded', 'file_count_cap_too_small');
  }
  return { ok: true, selected };
}

// ─── Bounded structural probe of one file ─────────────────────────────────────

interface FileProbeOutcome {
  readonly bytesRead: number;
  readonly rowsCounted: number;
  readonly bytesBucket: BrazilReceitaRequiredFamilyProbeBytesBucket;
  readonly rowsBucket: BrazilReceitaRequiredFamilyProbeRowsBucket;
  readonly encodingStatus: BrazilReceitaRequiredFamilyProbeEncodingStatus;
  readonly delimiterStatus: BrazilReceitaRequiredFamilyProbeDelimiterStatus;
  readonly headerlessStatus: BrazilReceitaRequiredFamilyProbeHeaderlessStatus;
  readonly rowShape: BrazilReceitaRequiredFamilyProbeRowShape;
}

/**
 * Reads a bounded PREFIX of one file and classifies its structure.
 *
 * The window is `byteBudget` bytes at most. A trailing row the window cut in half is
 * DROPPED rather than parsed: reaching the ceiling mid-row means the probe stops there, it
 * does not count a partial row as valid (decision record § 8.1).
 *
 * Every decoded line is split to COUNT its fields and is then discarded on the next
 * iteration. No cell, field, or line is retained, returned, compared to a value, or passed
 * to anything other than the column counter.
 */
function probeOneFile(
  file: SelectedFile,
  byteBudget: number,
  rowBudget: number,
  deadlineMs: number,
  nowMs: () => number,
): FileProbeOutcome {
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
  let delimiterStatus: BrazilReceitaRequiredFamilyProbeDelimiterStatus = 'unknown_or_invalid';

  for (const line of completeLines) {
    if (rowsCounted >= rowBudget) break;
    if (nowMs() > deadlineMs) {
      throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_timeout');
    }
    if (line.trim() === '') continue;
    const columnCount = countBrReceitaCnpjDelimitedColumns(line, OFFICIAL_DELIMITER);
    if (columnCount > 1) delimiterStatus = 'semicolon_detected';
    const bucket = String(columnCount);
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    if (columnCount === expectedMinColumns) rowShapeValidCount += 1;
    else rowShapeInvalidCount += 1;
    rowsCounted += 1;
    // The line goes out of scope here. Nothing derived from it survives except counts.
  }

  return {
    bytesRead,
    rowsCounted,
    bytesBucket:
      bytesRead > BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_BYTES_PER_FILE
        ? 'over_limit_blocked'
        : 'lte_64kb',
    rowsBucket:
      rowsCounted > BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_ROWS_PER_FILE
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
 * The scan returned when the probe refused. Every count is zero and every status is
 * `unknown_or_invalid`: no partial structure survives a refusal, and a refusal never
 * implies a file was opened.
 */
function blockedScan(
  refusalCode: BrazilReceitaRequiredFamilyProbeErrorCode,
  forbiddenFamilyCount = 0,
  neverOpenedFamilyCount = 0,
  selectionClass: BrazilReceitaRequiredFamilyProbeSelectionClass = 'not_reached',
): BrazilReceitaRequiredFamilyProbeScan {
  const filesOpenedByFamily: Record<string, number> = {};
  const bytesReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeBytesBucket> = {};
  const rowsReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeRowsBucket> = {};
  const rowShape: Record<string, BrazilReceitaRequiredFamilyProbeRowShape> = {};
  const encodingStatus: Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus> = {};
  const delimiterStatus: Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus> = {};
  const headerlessStatus: Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus> = {};
  for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
    filesOpenedByFamily[family] = 0;
    bytesReadBucket[family] = 'over_limit_blocked';
    rowsReadBucket[family] = 'over_limit_blocked';
    rowShape[family] = emptyRowShape(family);
    encodingStatus[family] = 'unknown_or_invalid';
    delimiterStatus[family] = 'unknown_or_invalid';
    headerlessStatus[family] = 'unknown_or_invalid';
  }

  return {
    manifestTrust: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_TRUST,
    familiesAttempted: [...BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES],
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
    refusalCode,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Builds the ultra-bounded required-family probe port for ONE local manifest.
 *
 * The contract is validated EAGERLY, before any file descriptor exists: the three
 * authorizations, the forbidden-output requests, the seven caps, and the manifest path
 * shape are all checked here, so an unauthorized or refused request never reaches the
 * filesystem at all. The manifest path is captured in the closure and is never returned,
 * logged, or reported.
 *
 * All THREE authorizations are required and none substitutes for another: the metadata-only
 * carve-out permits reading a manifest at all, the BR-SOURCE-11E declaration permits naming
 * the operator's own prepared one, and the Option C phrase permits opening the two
 * required-family files the manifest declares.
 */
export function createBrazilReceitaRequiredFamilyProbe(
  options: BrazilReceitaRequiredFamilyProbeOptions,
): BrazilReceitaRequiredFamilyProbeReader {
  if (
    options.requiredFamilyProbeAuthorized !== true ||
    options.realManifestMetadataOnlyOptionBAuthorized !== true ||
    options.realManifestMetadataOnlyExecutionAuthorized !== true
  ) {
    throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_not_authorized');
  }
  assertOutputRequestsAllowed(options);
  // Caps are validated at construction AND at read time: the probe enforces the same
  // bounds it was built with, so a request cannot widen them later.
  const builtCaps = assertCapsAllowed({
    maxManifestBytes: options.maxManifestBytes,
    maxDeclaredFiles: options.maxDeclaredFiles,
    maxFilesOpened: options.maxFilesOpened,
    maxBytesPerFile: options.maxBytesPerFile,
    maxRowsPerFile: options.maxRowsPerFile,
    maxTotalRows: options.maxTotalRows,
    maxTotalBytes: options.maxTotalBytes,
  });
  const manifestPath = assertManifestPathAllowed(options.manifestPath);
  const nowMs = options.nowMs ?? Date.now;

  return (request: BrazilReceitaRequiredFamilyProbeReadRequest) => {
    const caps = assertCapsAllowed(request);
    // A read may never ask for more than the probe was built with.
    for (const [key] of CAP_CEILINGS) {
      if (caps[key] > builtCaps[key]) {
        throw new BrazilReceitaRequiredFamilyProbeError('required_family_probe_cap_exceeded');
      }
    }

    const deadlineMs = nowMs() + BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_RUNTIME_MS;

    // 1) The manifest, as a bounded CONTROL DOCUMENT read. Not a data file, not counted
    //    against `maxFilesOpened`, and bounded by its own stated ceiling.
    let manifestText: string | null;
    try {
      manifestText = readManifestBounded(manifestPath, caps.maxManifestBytes);
    } catch {
      // The underlying error is DISCARDED: it quotes a path.
      return blockedScan('required_family_probe_open_failed');
    }
    if (manifestText === null) return blockedScan('required_family_probe_cap_exceeded');

    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch {
      // The parse error is DISCARDED: its message quotes the document.
      return blockedScan('required_family_probe_open_failed');
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
      return blockedScan('required_family_probe_open_failed');
    }
    if (parsed.files.length > caps.maxDeclaredFiles) {
      return blockedScan('required_family_probe_cap_exceeded');
    }

    // 2) Classify every declared family BEFORE opening anything. A personal-data family is
    //    a fail-closed refusal reported as a count — never a filename, never followed by a
    //    read.
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
      if (
        BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_NEVER_OPENED_FAMILIES.includes(readEntry.family)
      ) {
        neverOpenedFamilyCount += 1;
        continue;
      }
      declared.push(readEntry);
    }
    if (forbiddenFamilyCount > 0) {
      return blockedScan(
        'required_family_probe_forbidden_family',
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

    // 4) The bounded probe itself. Per-file AND total budgets are enforced on every file.
    const filesOpenedByFamily: Record<string, number> = {};
    const bytesReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeBytesBucket> = {};
    const rowsReadBucket: Record<string, BrazilReceitaRequiredFamilyProbeRowsBucket> = {};
    const rowShape: Record<string, BrazilReceitaRequiredFamilyProbeRowShape> = {};
    const encodingStatus: Record<string, BrazilReceitaRequiredFamilyProbeEncodingStatus> = {};
    const delimiterStatus: Record<string, BrazilReceitaRequiredFamilyProbeDelimiterStatus> = {};
    const headerlessStatus: Record<string, BrazilReceitaRequiredFamilyProbeHeaderlessStatus> = {};
    for (const family of BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES) {
      filesOpenedByFamily[family] = 0;
    }

    let filesOpenedCount = 0;
    let totalBytesRead = 0;
    let totalRowsCounted = 0;

    for (const file of selection.selected) {
      if (nowMs() > deadlineMs) return blockedScan('required_family_probe_timeout');
      if (filesOpenedCount >= caps.maxFilesOpened) {
        return blockedScan('required_family_probe_file_count_exceeded');
      }
      const byteBudget = Math.min(caps.maxBytesPerFile, caps.maxTotalBytes - totalBytesRead);
      const rowBudget = Math.min(caps.maxRowsPerFile, caps.maxTotalRows - totalRowsCounted);
      if (byteBudget <= 0 || rowBudget <= 0) {
        return blockedScan(
          'required_family_probe_cap_exceeded',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
          'selected',
        );
      }

      let outcome: FileProbeOutcome;
      try {
        outcome = probeOneFile(file, byteBudget, rowBudget, deadlineMs, nowMs);
      } catch (error) {
        // The underlying error is DISCARDED: it could carry a path or a fragment of a row.
        if (
          error instanceof BrazilReceitaRequiredFamilyProbeError &&
          error.code === 'required_family_probe_timeout'
        ) {
          return blockedScan('required_family_probe_timeout');
        }
        return blockedScan(
          'required_family_probe_read_failed',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
          'selected',
        );
      }

      filesOpenedCount += 1;
      filesOpenedByFamily[file.family] = (filesOpenedByFamily[file.family] ?? 0) + 1;
      totalBytesRead += outcome.bytesRead;
      totalRowsCounted += outcome.rowsCounted;
      bytesReadBucket[file.family] = outcome.bytesBucket;
      rowsReadBucket[file.family] = outcome.rowsBucket;
      rowShape[file.family] = outcome.rowShape;
      encodingStatus[file.family] = outcome.encodingStatus;
      delimiterStatus[file.family] = outcome.delimiterStatus;
      headerlessStatus[file.family] = outcome.headerlessStatus;

      // Belt and braces: the totals are re-checked AFTER each file, so a probe that
      // respected two per-file budgets still cannot exceed the run budget.
      if (
        totalBytesRead > caps.maxTotalBytes ||
        totalRowsCounted > caps.maxTotalRows ||
        filesOpenedByFamily[file.family]! >
          BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_MAX_FILES_PER_FAMILY
      ) {
        return blockedScan(
          'required_family_probe_cap_exceeded',
          forbiddenFamilyCount,
          neverOpenedFamilyCount,
        );
      }
    }

    if (filesOpenedCount > caps.maxFilesOpened) {
      return blockedScan('required_family_probe_file_count_exceeded');
    }

    return {
      manifestTrust: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_TRUST,
      familiesAttempted: [...BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES],
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
      joinsExecuted: false,
      refusalCode: null,
    };
  };
}
