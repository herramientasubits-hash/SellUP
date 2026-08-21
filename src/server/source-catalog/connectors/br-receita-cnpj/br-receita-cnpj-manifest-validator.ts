/**
 * BR Receita CNPJ — local manifest validator (BR-SOURCE-6).
 *
 * Validates a LOCAL manifest JSON that describes a set of Receita CNPJ files:
 * their identity (source key / country / year / period), allowed file types,
 * names, extensions, sizes, hashes, and header layout. It is the safe boundary
 * for a future controlled real-file dry-run.
 *
 * ── This validator NEVER (fail-closed by construction) ──────────────────────
 *   - accepts anything but a LOCAL manifest JSON path (no CSV/ZIP/URL input).
 *   - fetches a URL, downloads, or unzips.
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - imports data, runs a production import, or performs runtime enrichment.
 *   - processes the full dataset: it reads ONLY a bounded header prefix per file
 *     (plus a streamed byte-digest for the hash) and NEVER parses/returns rows.
 *   - prints or returns a full CNPJ, a CPF, a full local path, or row content.
 *
 * Every outcome is a sanitized result object. Structural problems set a manifest
 * `reasonCode`; per-file problems are recorded against the file's report.
 */

import { createHash, type BinaryToTextEncoding } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_FORBIDDEN_TOKENS,
  BrReceitaCnpjEmptyFileError,
  BrReceitaCnpjForbiddenColumnError,
  BrReceitaCnpjHeaderlessColumnCountError,
  BrReceitaCnpjMissingHeaderError,
  BrReceitaCnpjUnknownColumnError,
  validateBrReceitaCnpjHeaderCells,
  validateBrReceitaCnpjHeaderlessFirstLine,
  type BrReceitaCnpjLayoutFileType,
} from './br-receita-cnpj-file-reader';
import {
  BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS,
  BR_RECEITA_CNPJ_ALLOWED_FILE_TYPES,
  BR_RECEITA_CNPJ_DEFAULT_INPUT_SCOPE,
  BR_RECEITA_CNPJ_DEFAULT_LAYOUT_MODE,
  BR_RECEITA_CNPJ_INPUT_SCOPES,
  BR_RECEITA_CNPJ_LAYOUT_MODES,
  BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
  BR_RECEITA_CNPJ_MANIFEST_MODE,
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  BR_RECEITA_CNPJ_NATIONAL_PART_COUNT,
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
  type BrReceitaCnpjManifestEncoding,
  type BrReceitaCnpjManifestFileReport,
  type BrReceitaCnpjManifestInputScope,
  type BrReceitaCnpjManifestLayoutMode,
  type BrReceitaCnpjManifestReasonCode,
  type BrReceitaCnpjManifestSafety,
  type BrReceitaCnpjManifestValidationResult,
} from './br-receita-cnpj-manifest';

// ─── Hard limits / defaults ──────────────────────────────────────────────────

/**
 * Absolute ceiling on the accepted `maxFiles` option — a runaway-list DoS
 * backstop. Only 6 file types are recognized, and (since BR-SOURCE-14B.0M) each
 * required file type may be declared once per national part (up to 10), so a
 * well-formed `full_national` manifest can legitimately approach this (10
 * Empresas + 10 Estabelecimentos = 20); the per-entry duplicate/forbidden checks
 * still catch anything real long before the count alone would.
 */
export const BR_RECEITA_CNPJ_MANIFEST_MAX_FILES_LIMIT = 24 as const;
/** Default ceiling on file count (equals the hard limit — see the note above). */
export const BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_FILES = BR_RECEITA_CNPJ_MANIFEST_MAX_FILES_LIMIT;
/** Default cap on bytes read while locating a file's header line. */
export const BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_HEADER_BYTES = 64 * 1024;

const SAFETY_ALL_FALSE: BrReceitaCnpjManifestSafety = {
  datasetDownload: false,
  supabaseWrite: false,
  productionImport: false,
  runtimeIntegration: false,
  agent1Integration: false,
  hubspot: false,
  slack: false,
  liveProspectGeneration: false,
};

// ─── Options ───────────────────────────────────────────────────────────────────

export interface BrReceitaCnpjManifestValidationOptions {
  /** Local path to the manifest JSON (never a URL, never a CSV/ZIP). */
  manifestPath: string;
  /** Treat unknown, non-sensitive headers as errors (default false). */
  strict?: boolean;
  /** Ceiling on the number of files a manifest may list. */
  maxFiles?: number;
  /** Ceiling on bytes read to locate each file's header line. */
  maxHeaderBytes?: number;
  /**
   * When true, the validator stats/hashes/header-reads the listed LOCAL files.
   * When false, it validates manifest STRUCTURE only (no filesystem touch on the
   * data files) and marks each file's layout as `skipped`.
   */
  allowRealLocalFiles?: boolean;
}

// ─── Internal control-flow error (never escapes this module) ─────────────────

class ManifestStructuralError extends Error {
  readonly reasonCode: BrReceitaCnpjManifestReasonCode;
  constructor(reasonCode: BrReceitaCnpjManifestReasonCode) {
    super(`BRSOURCE6_MANIFEST_REJECTED: ${reasonCode}`);
    this.name = 'ManifestStructuralError';
    this.reasonCode = reasonCode;
  }
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True for anything carrying a URL scheme or a protocol-relative prefix. */
function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

function hasForbiddenToken(value: string): boolean {
  const lower = value.toLowerCase();
  return BR_RECEITA_CNPJ_FORBIDDEN_TOKENS.some((t) => lower.includes(t));
}

function isValidSourceYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function isValidSourcePeriod(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** Resolved target must live inside `baseDir` (blocks `..` traversal). */
function isWithinBaseDir(baseDir: string, resolvedTarget: string): boolean {
  const rel = path.relative(baseDir, resolvedTarget);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveMaxFiles(maxFiles: number | undefined): number {
  const value = maxFiles ?? BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_FILES;
  if (!Number.isInteger(value) || value < 1) return BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_FILES;
  return Math.min(value, BR_RECEITA_CNPJ_MANIFEST_MAX_FILES_LIMIT);
}

/** Streams a file through SHA-256 without ever loading rows into memory. */
function sha256HexOfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex' as BinaryToTextEncoding)));
  });
}

type HeaderReadOutcome =
  | { readonly kind: 'line'; readonly cells: string[]; readonly raw: string }
  | { readonly kind: 'limit_exceeded' };

/**
 * Reads ONLY the first (bounded) line of a file. Returns both the naive
 * delimiter-split cells (used by header-name validation) and the raw line string
 * (used by headerless, quote-aware column counting). Never reads past the header
 * byte cap.
 */
async function readHeaderCells(
  filePath: string,
  encoding: BrReceitaCnpjManifestEncoding,
  delimiter: string,
  maxHeaderBytes: number,
): Promise<HeaderReadOutcome> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxHeaderBytes);
    const { bytesRead } = await fh.read(buffer, 0, maxHeaderBytes, 0);
    const slice = buffer.subarray(0, bytesRead);
    const bufferEncoding: BufferEncoding = encoding === 'latin1' ? 'latin1' : 'utf8';

    const newlineIndex = slice.indexOf(0x0a); // '\n'
    if (newlineIndex === -1) {
      // No newline within the read window: either the whole (single-line) file was
      // read, or the header is longer than the allowed prefix.
      if (bytesRead < maxHeaderBytes) {
        const line = slice.toString(bufferEncoding).replace(/\r$/, '');
        return { kind: 'line', cells: line.split(delimiter), raw: line };
      }
      return { kind: 'limit_exceeded' };
    }

    let end = newlineIndex;
    if (end > 0 && slice[end - 1] === 0x0d) end -= 1; // strip trailing '\r'
    const line = slice.subarray(0, end).toString(bufferEncoding);
    return { kind: 'line', cells: line.split(delimiter), raw: line };
  } finally {
    await fh.close();
  }
}

// ─── Structural manifest validation ──────────────────────────────────────────

interface ResolvedManifestFile {
  readonly fileType: BrReceitaCnpjLayoutFileType;
  readonly rawPath: string;
  readonly safeFileLabel: string;
  readonly extension: string;
  readonly expectedSha256?: string;
  readonly expectedSizeBytes?: number;
  readonly encoding: BrReceitaCnpjManifestEncoding;
  readonly delimiter: string;
  readonly layoutMode: BrReceitaCnpjManifestLayoutMode;
  /** Resolved part ordinal (0..9). Defaults to 0 when the entry omitted it. */
  readonly partOrdinal: number;
}

/**
 * Resolves + validates an EXPLICIT `partOrdinal`. `undefined` defaults to `0` (the single-part
 * meaning every manifest before BR-SOURCE-14B.0M had). Any other non-integer or out-of-range
 * value is a fail-closed rejection — never silently clamped or coerced.
 */
function resolvePartOrdinal(value: unknown): number {
  if (value === undefined) return 0;
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BR_RECEITA_CNPJ_NATIONAL_PART_COUNT
  ) {
    return value;
  }
  throw new ManifestStructuralError('part_ordinal_invalid');
}

/**
 * Resolves + validates an EXPLICIT `inputScope`. `undefined` falls back to the staged-subset
 * default; any other non-scope value is a fail-closed rejection.
 */
function resolveInputScope(value: unknown): BrReceitaCnpjManifestInputScope {
  if (value === undefined) return BR_RECEITA_CNPJ_DEFAULT_INPUT_SCOPE;
  if (
    typeof value === 'string' &&
    (BR_RECEITA_CNPJ_INPUT_SCOPES as readonly string[]).includes(value)
  ) {
    return value as BrReceitaCnpjManifestInputScope;
  }
  throw new ManifestStructuralError('input_scope_invalid');
}

/**
 * Resolves + validates an EXPLICIT layout mode value. `undefined` falls back to
 * the provided default; any other non-mode value is a fail-closed rejection
 * (never silently coerced).
 */
function resolveLayoutMode(
  value: unknown,
  fallback: BrReceitaCnpjManifestLayoutMode,
): BrReceitaCnpjManifestLayoutMode {
  if (value === undefined) return fallback;
  if (
    typeof value === 'string' &&
    (BR_RECEITA_CNPJ_LAYOUT_MODES as readonly string[]).includes(value)
  ) {
    return value as BrReceitaCnpjManifestLayoutMode;
  }
  throw new ManifestStructuralError('layout_mode_invalid');
}

interface ParsedManifest {
  readonly sourceYear: number;
  readonly sourcePeriod: string;
  readonly inputScope: BrReceitaCnpjManifestInputScope;
  readonly files: readonly ResolvedManifestFile[];
}

function assertManifestPathAllowed(manifestPath: string): void {
  if (typeof manifestPath !== 'string' || manifestPath.trim().length === 0) {
    throw new ManifestStructuralError('manifest_path_not_allowed');
  }
  if (looksLikeUrl(manifestPath)) {
    throw new ManifestStructuralError('manifest_url_not_allowed');
  }
  if (path.extname(manifestPath).toLowerCase() !== '.json') {
    throw new ManifestStructuralError('manifest_not_json');
  }
}

function parseManifestDocument(raw: string, maxFiles: number): ParsedManifest {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new ManifestStructuralError('manifest_not_json');
  }
  if (!isRecord(doc)) throw new ManifestStructuralError('manifest_not_json');

  if (doc.mode !== BR_RECEITA_CNPJ_MANIFEST_MODE) {
    throw new ManifestStructuralError('manifest_mode_invalid');
  }
  if (doc.sourceKey !== BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY) {
    throw new ManifestStructuralError('manifest_source_key_invalid');
  }
  if (doc.countryCode !== BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE) {
    throw new ManifestStructuralError('manifest_country_invalid');
  }
  if (!isValidSourceYear(doc.sourceYear)) {
    throw new ManifestStructuralError('source_year_invalid');
  }
  if (!isValidSourcePeriod(doc.sourcePeriod)) {
    throw new ManifestStructuralError('source_period_invalid');
  }
  if (!Array.isArray(doc.files) || doc.files.length === 0) {
    throw new ManifestStructuralError('required_file_missing');
  }
  if (doc.files.length > maxFiles) {
    throw new ManifestStructuralError('too_many_files');
  }

  // Manifest-level layout mode (optional) becomes the per-file default.
  const manifestLayoutMode = resolveLayoutMode(doc.layoutMode, BR_RECEITA_CNPJ_DEFAULT_LAYOUT_MODE);
  const inputScope = resolveInputScope(doc.inputScope);

  const allowedTypes = new Set<string>(BR_RECEITA_CNPJ_ALLOWED_FILE_TYPES);
  // Identity is (fileType, partOrdinal), not fileType alone — a national manifest declares the
  // SAME fileType up to 10 times, once per distinct part. A true repeat (same fileType AND the
  // same partOrdinal, including two entries that both omit it) is still `duplicate_file_type`.
  const seenPartIdentities = new Set<string>();
  const seenFileTypes = new Set<string>();
  const partOrdinalsByFileType = new Map<string, Set<number>>();
  const files: ResolvedManifestFile[] = [];

  for (const entry of doc.files) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path.trim().length === 0) {
      throw new ManifestStructuralError('manifest_not_json');
    }
    const safeFileLabel = path.basename(entry.path);
    // A forbidden personal-data token in the file NAME is a hard rejection,
    // regardless of the declared file type.
    if (hasForbiddenToken(safeFileLabel) || hasForbiddenToken(entry.path)) {
      throw new ManifestStructuralError('forbidden_file_name');
    }
    if (typeof entry.fileType !== 'string' || !allowedTypes.has(entry.fileType)) {
      throw new ManifestStructuralError('forbidden_file_type');
    }
    const partOrdinal = resolvePartOrdinal(entry.partOrdinal);
    const partIdentity = `${entry.fileType}:${partOrdinal}`;
    if (seenPartIdentities.has(partIdentity)) {
      throw new ManifestStructuralError('duplicate_file_type');
    }
    seenPartIdentities.add(partIdentity);
    seenFileTypes.add(entry.fileType);
    const ordinalsForType = partOrdinalsByFileType.get(entry.fileType) ?? new Set<number>();
    ordinalsForType.add(partOrdinal);
    partOrdinalsByFileType.set(entry.fileType, ordinalsForType);

    files.push({
      fileType: entry.fileType as BrReceitaCnpjLayoutFileType,
      rawPath: entry.path,
      safeFileLabel,
      extension: path.extname(safeFileLabel).toLowerCase(),
      expectedSha256: typeof entry.expectedSha256 === 'string' ? entry.expectedSha256 : undefined,
      expectedSizeBytes:
        typeof entry.expectedSizeBytes === 'number' ? entry.expectedSizeBytes : undefined,
      encoding: entry.encoding === 'latin1' ? 'latin1' : 'utf8',
      delimiter: entry.delimiter === ';' ? ';' : ',',
      layoutMode: resolveLayoutMode(entry.layoutMode, manifestLayoutMode),
      partOrdinal,
    });
  }

  for (const required of BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES) {
    if (!seenFileTypes.has(required)) {
      throw new ManifestStructuralError('required_file_missing');
    }
  }

  // `full_national` is an explicit assertion, checked against exact part identities (§ 5, § 8):
  // every required family must carry all 10 ordinals (0..9). A shortfall is refused outright —
  // never silently downgraded to `staged_subset`, because that would let an incomplete national
  // manifest pass as if it had asserted nothing.
  if (inputScope === 'full_national') {
    for (const required of BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES) {
      const ordinals = partOrdinalsByFileType.get(required) ?? new Set<number>();
      if (ordinals.size !== BR_RECEITA_CNPJ_NATIONAL_PART_COUNT) {
        throw new ManifestStructuralError('missing_national_part');
      }
    }
  }

  return { sourceYear: doc.sourceYear, sourcePeriod: doc.sourcePeriod, inputScope, files };
}

// ─── Per-file validation ─────────────────────────────────────────────────────

function mapHeaderError(err: unknown): BrReceitaCnpjManifestReasonCode {
  if (err instanceof BrReceitaCnpjForbiddenColumnError) return 'forbidden_header';
  if (err instanceof BrReceitaCnpjUnknownColumnError) return 'dangerous_unknown_header';
  if (err instanceof BrReceitaCnpjMissingHeaderError) return 'header_validation_failed';
  return 'header_validation_failed';
}

function mapHeaderlessError(err: unknown): BrReceitaCnpjManifestReasonCode {
  if (err instanceof BrReceitaCnpjEmptyFileError) return 'headerless_empty_file';
  if (err instanceof BrReceitaCnpjHeaderlessColumnCountError) return 'headerless_column_count_mismatch';
  return 'header_validation_failed';
}

async function validateManifestFile(
  file: ResolvedManifestFile,
  manifestDir: string,
  options: Required<
    Pick<BrReceitaCnpjManifestValidationOptions, 'strict' | 'maxHeaderBytes' | 'allowRealLocalFiles'>
  >,
): Promise<BrReceitaCnpjManifestFileReport> {
  const report: BrReceitaCnpjManifestFileReport = {
    fileType: file.fileType,
    safeFileLabel: file.safeFileLabel,
    extension: file.extension,
    partOrdinal: file.partOrdinal,
    layoutValidation: 'skipped',
    layoutMode: file.layoutMode,
    status: 'accepted',
  };
  const reject = (reasonCode: BrReceitaCnpjManifestReasonCode): BrReceitaCnpjManifestFileReport => ({
    ...report,
    status: 'rejected',
    layoutValidation: report.layoutValidation === 'skipped' ? 'skipped' : 'failed',
    reasonCode,
  });

  // 1) Extension gate — ZIP is called out explicitly.
  if (file.extension === '.zip') return reject('zip_not_allowed');
  if (!(BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS as readonly string[]).includes(file.extension)) {
    return reject('unsupported_extension');
  }

  // 2) Path safety — absolute paths and `..` traversal are blocked.
  if (path.isAbsolute(file.rawPath)) return reject('path_traversal_blocked');
  const resolved = path.resolve(manifestDir, file.rawPath);
  if (!isWithinBaseDir(manifestDir, resolved)) return reject('path_traversal_blocked');

  // Structure-only mode: never touch the data files.
  if (!options.allowRealLocalFiles) {
    return { ...report, layoutValidation: 'skipped', status: 'accepted' };
  }

  // 3) Existence + size.
  let sizeBytes: number;
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) return reject('file_not_found');
    sizeBytes = stat.size;
  } catch {
    return reject('file_not_found');
  }
  report.sizeBytes = sizeBytes;
  if (file.expectedSizeBytes !== undefined && file.expectedSizeBytes !== sizeBytes) {
    return reject('file_size_mismatch');
  }

  // 4) Hash (streamed; store only the non-reversible hash12).
  const fullHash = await sha256HexOfFile(resolved);
  report.sha256Hash12 = fullHash.slice(0, 12);
  if (
    file.expectedSha256 !== undefined &&
    file.expectedSha256.trim().toLowerCase() !== fullHash.toLowerCase()
  ) {
    return reject('file_hash_mismatch');
  }

  // 5) Header / layout — bounded read of ONLY the first line.
  let outcome: HeaderReadOutcome;
  try {
    outcome = await readHeaderCells(resolved, file.encoding, file.delimiter, options.maxHeaderBytes);
  } catch {
    return { ...report, layoutValidation: 'failed', status: 'rejected', reasonCode: 'header_validation_failed' };
  }
  if (outcome.kind === 'limit_exceeded') {
    return { ...report, layoutValidation: 'failed', status: 'rejected', reasonCode: 'header_read_limit_exceeded' };
  }

  // Headerless official files: validate the first (data) line by positional
  // column COUNT — never treat it as headers.
  if (file.layoutMode === 'official_headerless') {
    try {
      validateBrReceitaCnpjHeaderlessFirstLine(file.fileType, outcome.raw, file.delimiter, {
        fileLabel: file.safeFileLabel,
      });
    } catch (err) {
      return {
        ...report,
        layoutValidation: 'failed',
        status: 'rejected',
        reasonCode: mapHeaderlessError(err),
      };
    }
    return { ...report, layoutValidation: 'passed_headerless', status: 'accepted' };
  }

  // Header mode (default): validate the first line by column NAMES.
  try {
    validateBrReceitaCnpjHeaderCells(file.fileType, outcome.cells, {
      strict: options.strict,
      fileLabel: file.safeFileLabel,
    });
  } catch (err) {
    return {
      ...report,
      layoutValidation: 'failed',
      status: 'rejected',
      reasonCode: mapHeaderError(err),
    };
  }

  return { ...report, layoutValidation: 'passed', status: 'accepted' };
}

// ─── Result assembly ─────────────────────────────────────────────────────────

function structuralRejection(
  reasonCode: BrReceitaCnpjManifestReasonCode,
  sourceYear: number,
  sourcePeriod: string,
  inputScope: BrReceitaCnpjManifestInputScope = BR_RECEITA_CNPJ_DEFAULT_INPUT_SCOPE,
): BrReceitaCnpjManifestValidationResult {
  return {
    ok: false,
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear,
    sourcePeriod,
    inputScope,
    filesSeen: 0,
    filesAccepted: 0,
    filesRejected: 0,
    fileReports: [],
    reasonCode,
    safety: SAFETY_ALL_FALSE,
  };
}

/**
 * Validates a local Receita CNPJ manifest and returns a sanitized result. Never
 * throws for validation failures — every problem becomes a `reasonCode` (manifest
 * level) or a rejected file report. Only genuinely unexpected internal faults are
 * caught and mapped to `unexpected_error`.
 */
export async function validateBrReceitaCnpjLocalManifest(
  options: BrReceitaCnpjManifestValidationOptions,
): Promise<BrReceitaCnpjManifestValidationResult> {
  const strict = options.strict ?? false;
  const allowRealLocalFiles = options.allowRealLocalFiles ?? false;
  const maxHeaderBytes =
    options.maxHeaderBytes && options.maxHeaderBytes > 0
      ? options.maxHeaderBytes
      : BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_HEADER_BYTES;
  const maxFiles = resolveMaxFiles(options.maxFiles);

  let sourceYear = 0;
  let sourcePeriod = '';
  let inputScope: BrReceitaCnpjManifestInputScope = BR_RECEITA_CNPJ_DEFAULT_INPUT_SCOPE;

  try {
    assertManifestPathAllowed(options.manifestPath);

    const manifestPath = path.resolve(options.manifestPath);
    const manifestDir = path.dirname(manifestPath);

    let raw: string;
    try {
      raw = await fsp.readFile(manifestPath, 'utf8');
    } catch {
      throw new ManifestStructuralError('manifest_path_not_allowed');
    }

    const manifest = parseManifestDocument(raw, maxFiles);
    sourceYear = manifest.sourceYear;
    sourcePeriod = manifest.sourcePeriod;
    inputScope = manifest.inputScope;

    const fileReports: BrReceitaCnpjManifestFileReport[] = [];
    for (const file of manifest.files) {
      fileReports.push(
        await validateManifestFile(file, manifestDir, { strict, maxHeaderBytes, allowRealLocalFiles }),
      );
    }

    const filesRejected = fileReports.filter((r) => r.status === 'rejected').length;
    const filesAccepted = fileReports.length - filesRejected;

    return {
      ok: filesRejected === 0,
      sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
      countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
      sourceYear,
      sourcePeriod,
      inputScope,
      filesSeen: fileReports.length,
      filesAccepted,
      filesRejected,
      fileReports,
      safety: SAFETY_ALL_FALSE,
    };
  } catch (err) {
    if (err instanceof ManifestStructuralError) {
      return structuralRejection(err.reasonCode, sourceYear, sourcePeriod, inputScope);
    }
    return structuralRejection('unexpected_error', sourceYear, sourcePeriod, inputScope);
  }
}
