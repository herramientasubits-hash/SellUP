/**
 * BR Receita CNPJ — local real-file dry-run report (BR-SOURCE-7).
 *
 * The next controlled step after the BR-SOURCE-6 manifest validator: given a
 * LOCAL manifest that already validates, this module reads a BOUNDED sample of
 * rows from each described real file and produces a sanitized *dry-run report*
 * of operational-structure validation. It NEVER imports, writes, or processes
 * the full dataset — it exists to answer "would this file set parse cleanly?"
 * without touching a database or the whole file.
 *
 * ── This dry-run NEVER (fail-closed by construction) ────────────────────────
 *   - accepts anything but a LOCAL manifest JSON (no CSV/ZIP/URL direct input).
 *   - downloads, unzips, imports, or executes an ingestion.
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - processes the FULL dataset: it reads ONLY a bounded header + at most
 *     `maxSampleRowsPerFile` (≤ 20) rows per file, never more.
 *   - returns or prints a full CNPJ, a CPF, a full local path, or row content.
 *   - creates a persistable snapshot.
 *
 * Reading real local files is gated on BOTH `allowLocalManifest` AND `dryRunOnly`
 * being true (the runner supplies them for the trusted synthetic fixture and
 * requires the operator to pass them for an external manifest). The manifest
 * validator (`validateBrReceitaCnpjLocalManifest`) remains the single authority
 * on identity, layout, and header safety; this module only adds bounded sampling.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS,
  BR_RECEITA_CNPJ_ALLOWED_FILE_TYPES,
  BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
  BR_RECEITA_CNPJ_MANIFEST_MODE,
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  type BrReceitaCnpjManifestEncoding,
  type BrReceitaCnpjManifestFileReport,
  type BrReceitaCnpjManifestFileType,
} from './br-receita-cnpj-manifest';
import { validateBrReceitaCnpjLocalManifest } from './br-receita-cnpj-manifest-validator';

// ─── Public constants ────────────────────────────────────────────────────────

export const BR_RECEITA_CNPJ_DRY_RUN_MODE = 'local_real_file_dry_run' as const;

/** Default rows sampled per file when the caller does not specify. */
export const BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS = 5 as const;
/** Absolute ceiling on rows sampled per file (a bounded-read guarantee). */
export const BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT = 20 as const;
/** Default cap on bytes read while locating a file's header line. */
export const BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_HEADER_BYTES = 64 * 1024;
/**
 * Hard ceiling on TOTAL bytes read per file while collecting the sample. Bounds a
 * pathological single-line / huge real file: we never read past this, even if we
 * have not yet gathered `maxSampleRowsPerFile` complete rows.
 */
export const BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_BYTES = 1 * 1024 * 1024;

/**
 * Contiguous-digit run that must never appear in a sampled cell: 11 digits is a
 * CPF, 14 a full CNPJ. Both live only in categorically-excluded / concatenated
 * forms, so a run this long in a structural sample is a defensive red flag.
 */
const FORBIDDEN_DIGIT_RUN = /\d{11,}/;

// ─── Reason codes ────────────────────────────────────────────────────────────

export type BrReceitaCnpjLocalDryRunReasonCode =
  | 'dry_run_mode_required'
  | 'allow_local_manifest_required'
  | 'sample_row_limit_exceeded'
  | 'sample_row_column_mismatch'
  | 'sample_row_forbidden_value_detected'
  | 'sample_read_failed'
  | 'full_dataset_processing_not_allowed';

// ─── Result shapes ─────────────────────────────────────────────────────────────

export type BrReceitaCnpjDryRunLayoutValidation = 'passed' | 'failed' | 'skipped';
export type BrReceitaCnpjDryRunSampleValidation = 'passed' | 'failed' | 'skipped';
export type BrReceitaCnpjDryRunFileStatus = 'accepted' | 'rejected';

/** A sanitized per-file dry-run report. NO full path, NO CNPJ, NO row content. */
export interface BrReceitaCnpjDryRunFileReport {
  fileType: BrReceitaCnpjManifestFileType | 'unknown';
  /** Sanitized basename only — never a full local path. */
  safeFileLabel: string;
  extension: string;
  sizeBytes?: number;
  /** Non-reversible SHA-256 truncated to 12 hex chars. */
  sha256Hash12?: string;
  layoutValidation: BrReceitaCnpjDryRunLayoutValidation;
  sampleRowsRead: number;
  sampleValidation: BrReceitaCnpjDryRunSampleValidation;
  status: BrReceitaCnpjDryRunFileStatus;
  reasonCode?: string;
}

/** All-false safety block asserted on every dry-run result. */
export interface BrReceitaCnpjDryRunSafety {
  datasetDownload: false;
  fullDatasetProcessed: false;
  importExecuted: false;
  supabaseWrite: false;
  productionImport: false;
  runtimeIntegration: false;
  agent1Integration: false;
  hubspot: false;
  slack: false;
  liveProspectGeneration: false;
}

export interface BrReceitaCnpjLocalDryRunResult {
  ok: boolean;
  mode: typeof BR_RECEITA_CNPJ_DRY_RUN_MODE;
  sourceKey: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  countryCode: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  sourceYear: number;
  sourcePeriod: string;
  manifestValidation: 'passed' | 'failed';
  filesSeen: number;
  filesAccepted: number;
  filesRejected: number;
  sampleRowsRead: number;
  sampleRowsAcceptedForStructure: number;
  sampleRowsRejectedForStructure: number;
  fullDatasetProcessed: false;
  importExecuted: false;
  supabaseWrite: false;
  fileReports: BrReceitaCnpjDryRunFileReport[];
  rejectionReasons: string[];
  safety: BrReceitaCnpjDryRunSafety;
}

// ─── Options ───────────────────────────────────────────────────────────────────

export interface BrReceitaCnpjLocalDryRunOptions {
  /** Local path to the manifest JSON (never a URL, never a CSV/ZIP). */
  manifestPath: string;
  /** MUST be true to read the described local files (fail-closed otherwise). */
  allowLocalManifest: boolean;
  /** MUST be true — asserts caller intent is a dry-run, never an import. */
  dryRunOnly: boolean;
  /** Treat unknown, non-sensitive headers as errors (default false). */
  strict?: boolean;
  /** Rows sampled per file (default 5, hard max 20). */
  maxSampleRowsPerFile?: number;
  /** Ceiling on bytes read to locate each file's header line. */
  maxHeaderBytes?: number;
}

// ─── Error ─────────────────────────────────────────────────────────────────────

/** Raised when the dry-run safety contract is violated (missing gate flag, bad limit). */
export class BrReceitaCnpjLocalDryRunError extends Error {
  readonly reasonCode: BrReceitaCnpjLocalDryRunReasonCode;
  constructor(reasonCode: BrReceitaCnpjLocalDryRunReasonCode, detail: string) {
    super(`BRSOURCE7_FORBIDDEN_DRY_RUN_MODE: ${reasonCode} — ${detail}`);
    this.name = 'BrReceitaCnpjLocalDryRunError';
    this.reasonCode = reasonCode;
  }
}

const SAFETY_ALL_FALSE: BrReceitaCnpjDryRunSafety = {
  datasetDownload: false,
  fullDatasetProcessed: false,
  importExecuted: false,
  supabaseWrite: false,
  productionImport: false,
  runtimeIntegration: false,
  agent1Integration: false,
  hubspot: false,
  slack: false,
  liveProspectGeneration: false,
};

// ─── Option validation (fail-closed gates) ────────────────────────────────────

function assertDryRunGatesOrThrow(options: BrReceitaCnpjLocalDryRunOptions): number {
  if (!options.allowLocalManifest) {
    throw new BrReceitaCnpjLocalDryRunError(
      'allow_local_manifest_required',
      'reading local files requires allowLocalManifest: true',
    );
  }
  if (!options.dryRunOnly) {
    throw new BrReceitaCnpjLocalDryRunError(
      'dry_run_mode_required',
      'the dry-run requires dryRunOnly: true (it never imports)',
    );
  }

  const requested = options.maxSampleRowsPerFile ?? BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS;
  if (!Number.isFinite(requested)) {
    throw new BrReceitaCnpjLocalDryRunError(
      'full_dataset_processing_not_allowed',
      'maxSampleRowsPerFile must be a finite, bounded integer',
    );
  }
  if (!Number.isInteger(requested) || requested < 0) {
    throw new BrReceitaCnpjLocalDryRunError(
      'sample_row_limit_exceeded',
      `maxSampleRowsPerFile must be a non-negative integer, got "${requested}"`,
    );
  }
  if (requested > BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT) {
    throw new BrReceitaCnpjLocalDryRunError(
      'sample_row_limit_exceeded',
      `maxSampleRowsPerFile (${requested}) exceeds the hard limit of ${BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT}`,
    );
  }
  return requested;
}

// ─── Manifest descriptor re-read (paths only; NEVER header validation) ─────────

interface DryRunFileDescriptor {
  readonly fileType: BrReceitaCnpjManifestFileType;
  readonly resolvedPath: string;
  readonly delimiter: string;
  readonly encoding: BrReceitaCnpjManifestEncoding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

function isWithinBaseDir(baseDir: string, resolvedTarget: string): boolean {
  const rel = path.relative(baseDir, resolvedTarget);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Re-reads ONLY the file paths / delimiters / encodings from an already-validated
 * manifest so the sampler knows what to open. This is NOT a re-validation: the
 * authoritative identity + layout + header + forbidden-token checks live in
 * `validateBrReceitaCnpjLocalManifest`, which must have returned ok before this
 * runs. Every path is defensively re-guarded (absolute / traversal / URL) here.
 */
async function readValidatedManifestDescriptors(
  manifestPath: string,
): Promise<DryRunFileDescriptor[]> {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(resolvedManifestPath);
  const raw = await fsp.readFile(resolvedManifestPath, 'utf8');
  const doc: unknown = JSON.parse(raw);
  if (
    !isRecord(doc) ||
    doc.mode !== BR_RECEITA_CNPJ_MANIFEST_MODE ||
    doc.sourceKey !== BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY ||
    doc.countryCode !== BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE ||
    !Array.isArray(doc.files)
  ) {
    return [];
  }

  const allowedTypes = new Set<string>(BR_RECEITA_CNPJ_ALLOWED_FILE_TYPES);
  const allowedExtensions = new Set<string>(BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS);
  const descriptors: DryRunFileDescriptor[] = [];

  for (const entry of doc.files) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.fileType !== 'string') {
      continue;
    }
    if (!allowedTypes.has(entry.fileType)) continue;
    if (looksLikeUrl(entry.path) || path.isAbsolute(entry.path)) continue;
    const resolvedPath = path.resolve(manifestDir, entry.path);
    if (!isWithinBaseDir(manifestDir, resolvedPath)) continue;
    if (!allowedExtensions.has(path.extname(resolvedPath).toLowerCase())) continue;

    descriptors.push({
      fileType: entry.fileType as BrReceitaCnpjManifestFileType,
      resolvedPath,
      delimiter: entry.delimiter === ';' ? ';' : ',',
      encoding: entry.encoding === 'latin1' ? 'latin1' : 'utf8',
    });
  }
  return descriptors;
}

// ─── Bounded sample reading (never loads the whole file) ──────────────────────

interface BoundedSampleOutcome {
  readonly lines: string[];
  readonly limitExceeded: boolean;
}

/**
 * Reads AT MOST `maxLines` complete lines (header + sample rows) from a file,
 * capped by a hard byte budget so a pathological huge / single-line file can
 * never be fully read. Returns raw lines for structural splitting only — the
 * caller must never surface their content.
 */
async function readBoundedSampleLines(
  filePath: string,
  encoding: BrReceitaCnpjManifestEncoding,
  maxLines: number,
  maxHeaderBytes: number,
): Promise<BoundedSampleOutcome> {
  const bufferEncoding: BufferEncoding = encoding === 'latin1' ? 'latin1' : 'utf8';
  const chunkSize = Math.min(maxHeaderBytes, 64 * 1024);
  const fh = await fsp.open(filePath, 'r');
  try {
    let text = '';
    let bytesRead = 0;
    let position = 0;
    const buffer = Buffer.alloc(chunkSize);

    while (bytesRead < BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_BYTES) {
      const { bytesRead: n } = await fh.read(buffer, 0, chunkSize, position);
      if (n === 0) {
        // EOF: whatever we have is the whole (small) file.
        return { lines: splitCompleteLines(text, maxLines, true), limitExceeded: false };
      }
      bytesRead += n;
      position += n;
      text += buffer.subarray(0, n).toString(bufferEncoding);

      const complete = countNewlines(text);
      if (complete >= maxLines) {
        return { lines: splitCompleteLines(text, maxLines, false), limitExceeded: false };
      }
    }
    // Byte budget hit without enough newlines: refuse to read further.
    if (countNewlines(text) === 0) {
      return { lines: [], limitExceeded: true };
    }
    return { lines: splitCompleteLines(text, maxLines, false), limitExceeded: false };
  } finally {
    await fh.close();
  }
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) count += 1;
  }
  return count;
}

/** Splits accumulated text into up to `maxLines` lines, stripping trailing CR. */
function splitCompleteLines(text: string, maxLines: number, includeTrailing: boolean): string[] {
  const rawLines = text.split('\n');
  // The final element after a split is an incomplete line unless the text ended
  // exactly on a newline; only include it when we know we hit EOF.
  const usable = includeTrailing ? rawLines : rawLines.slice(0, rawLines.length - 1);
  return usable.slice(0, maxLines).map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// ─── Sample structural validation ─────────────────────────────────────────────

interface SampleValidationOutcome {
  readonly sampleRowsRead: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly sampleValidation: BrReceitaCnpjDryRunSampleValidation;
  readonly reasonCode?: BrReceitaCnpjLocalDryRunReasonCode;
}

/**
 * Validates the STRUCTURE of the sampled rows without ever retaining a value:
 *   - column count matches the header;
 *   - no cell carries an 11+/14 contiguous-digit run (CPF / full-CNPJ red flag).
 * Empty lines are ignored. Returns only counts + a safe reason code.
 */
function validateSampleStructure(
  lines: string[],
  delimiter: string,
  maxSampleRows: number,
): SampleValidationOutcome {
  if (lines.length === 0) {
    return { sampleRowsRead: 0, accepted: 0, rejected: 0, sampleValidation: 'skipped' };
  }
  const headerCols = lines[0]!.split(delimiter).length;
  const dataLines = lines.slice(1, 1 + maxSampleRows);

  let read = 0;
  let accepted = 0;
  let rejected = 0;
  let reasonCode: BrReceitaCnpjLocalDryRunReasonCode | undefined;

  for (const line of dataLines) {
    if (line.trim() === '') continue; // ignore empty rows, never counted
    read += 1;
    const cells = line.split(delimiter);
    if (cells.some((cell) => FORBIDDEN_DIGIT_RUN.test(cell))) {
      rejected += 1;
      reasonCode = 'sample_row_forbidden_value_detected';
      continue;
    }
    if (cells.length !== headerCols) {
      rejected += 1;
      if (reasonCode === undefined) reasonCode = 'sample_row_column_mismatch';
      continue;
    }
    accepted += 1;
  }

  const sampleValidation: BrReceitaCnpjDryRunSampleValidation =
    read === 0 ? 'skipped' : rejected === 0 ? 'passed' : 'failed';
  return { sampleRowsRead: read, accepted, rejected, sampleValidation, reasonCode };
}

// ─── Report assembly ───────────────────────────────────────────────────────────

function baseFileReport(v: BrReceitaCnpjManifestFileReport): BrReceitaCnpjDryRunFileReport {
  const report: BrReceitaCnpjDryRunFileReport = {
    fileType: v.fileType,
    safeFileLabel: v.safeFileLabel,
    extension: v.extension,
    layoutValidation: v.layoutValidation,
    sampleRowsRead: 0,
    sampleValidation: 'skipped',
    status: v.status,
  };
  if (v.sizeBytes !== undefined) report.sizeBytes = v.sizeBytes;
  if (v.sha256Hash12 !== undefined) report.sha256Hash12 = v.sha256Hash12;
  if (v.reasonCode !== undefined) report.reasonCode = v.reasonCode;
  return report;
}

/**
 * Runs a controlled, local, sanitized dry-run over a Receita CNPJ manifest.
 * Validates the manifest first (authoritative), then reads a bounded sample of
 * rows per accepted file for structural validation. NEVER imports, writes,
 * processes the full dataset, or returns row content.
 */
export async function runBrReceitaCnpjLocalDryRun(
  options: BrReceitaCnpjLocalDryRunOptions,
): Promise<BrReceitaCnpjLocalDryRunResult> {
  const maxSampleRows = assertDryRunGatesOrThrow(options);
  const strict = options.strict ?? false;
  const maxHeaderBytes =
    options.maxHeaderBytes && options.maxHeaderBytes > 0
      ? options.maxHeaderBytes
      : BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_HEADER_BYTES;

  const validation = await validateBrReceitaCnpjLocalManifest({
    manifestPath: options.manifestPath,
    strict,
    allowRealLocalFiles: true,
    maxHeaderBytes,
  });

  const base: Omit<BrReceitaCnpjLocalDryRunResult, 'ok' | 'manifestValidation' | 'fileReports' | 'sampleRowsRead' | 'sampleRowsAcceptedForStructure' | 'sampleRowsRejectedForStructure' | 'rejectionReasons'> = {
    mode: BR_RECEITA_CNPJ_DRY_RUN_MODE,
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear: validation.sourceYear,
    sourcePeriod: validation.sourcePeriod,
    filesSeen: validation.filesSeen,
    filesAccepted: validation.filesAccepted,
    filesRejected: validation.filesRejected,
    fullDatasetProcessed: false,
    importExecuted: false,
    supabaseWrite: false,
    safety: SAFETY_ALL_FALSE,
  };

  // Manifest validation failed → dry-run fails safely, no sampling.
  if (!validation.ok) {
    const rejectionReasons: string[] = [];
    if (validation.reasonCode) rejectionReasons.push(validation.reasonCode);
    for (const r of validation.fileReports) {
      if (r.status === 'rejected' && r.reasonCode) rejectionReasons.push(`${r.fileType}:${r.reasonCode}`);
    }
    return {
      ...base,
      ok: false,
      manifestValidation: 'failed',
      sampleRowsRead: 0,
      sampleRowsAcceptedForStructure: 0,
      sampleRowsRejectedForStructure: 0,
      fileReports: validation.fileReports.map(baseFileReport),
      rejectionReasons,
    };
  }

  // Manifest valid → read a bounded sample per accepted file.
  const descriptors = await readValidatedManifestDescriptors(options.manifestPath);
  const descriptorByType = new Map<string, DryRunFileDescriptor>();
  for (const d of descriptors) descriptorByType.set(d.fileType, d);

  const fileReports: BrReceitaCnpjDryRunFileReport[] = [];
  const rejectionReasons: string[] = [];
  let totalRead = 0;
  let totalAccepted = 0;
  let totalRejected = 0;

  for (const v of validation.fileReports) {
    const report = baseFileReport(v);
    const descriptor = v.fileType !== 'unknown' ? descriptorByType.get(v.fileType) : undefined;

    if (descriptor === undefined) {
      fileReports.push(report);
      continue;
    }

    let outcome: SampleValidationOutcome;
    try {
      const { lines, limitExceeded } = await readBoundedSampleLines(
        descriptor.resolvedPath,
        descriptor.encoding,
        maxSampleRows + 1,
        maxHeaderBytes,
      );
      if (limitExceeded) {
        report.sampleValidation = 'failed';
        report.status = 'rejected';
        report.reasonCode = 'sample_read_failed';
        rejectionReasons.push(`${v.fileType}:sample_read_failed`);
        fileReports.push(report);
        continue;
      }
      outcome = validateSampleStructure(lines, descriptor.delimiter, maxSampleRows);
    } catch {
      report.sampleValidation = 'failed';
      report.status = 'rejected';
      report.reasonCode = 'sample_read_failed';
      rejectionReasons.push(`${v.fileType}:sample_read_failed`);
      fileReports.push(report);
      continue;
    }

    report.sampleRowsRead = outcome.sampleRowsRead;
    report.sampleValidation = outcome.sampleValidation;
    totalRead += outcome.sampleRowsRead;
    totalAccepted += outcome.accepted;
    totalRejected += outcome.rejected;

    if (outcome.sampleValidation === 'failed' && outcome.reasonCode) {
      report.status = 'rejected';
      report.reasonCode = outcome.reasonCode;
      rejectionReasons.push(`${v.fileType}:${outcome.reasonCode}`);
    }
    fileReports.push(report);
  }

  const ok = rejectionReasons.length === 0;
  return {
    ...base,
    ok,
    manifestValidation: 'passed',
    sampleRowsRead: totalRead,
    sampleRowsAcceptedForStructure: totalAccepted,
    sampleRowsRejectedForStructure: totalRejected,
    fileReports,
    rejectionReasons,
  };
}
