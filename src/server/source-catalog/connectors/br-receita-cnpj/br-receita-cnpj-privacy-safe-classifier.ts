/**
 * BR Receita CNPJ — privacy-safe bounded dry-run CLASSIFIER (BR-SOURCE-10E).
 *
 * A SEPARATE, EXPLICIT mode that layers on top of the merged manifest validator
 * and headerless real-file support. Where the BR-SOURCE-7 local dry-run
 * (`br-receita-cnpj-local-dry-run.ts`) HARD-BLOCKS the whole run the moment a
 * sampled cell trips the anti-PII digit-run guard, this classifier instead turns
 * that same finding into a per-record *eligibility verdict* and reports ONLY
 * sanitized, aggregated counts — never a row, a value, a full CNPJ, or a CPF.
 *
 * It exists because BR-SOURCE-10C's real-file dry-run was (correctly) blocked by
 * `empresas:sample_row_forbidden_value_detected`: a CPF-length token inside real
 * company data. BR-SOURCE-10D turned that stop condition into the privacy-safe
 * eligibility contract (docs § 3–§ 9). This module is the first bounded, offline
 * classifier that scores a sample against that contract.
 *
 * ── This classifier NEVER (fail-closed by construction) ──────────────────────
 *   - replaces or weakens the BR-SOURCE-7 hard-block dry-run — it is additive and
 *     explicitly separate (a caller chooses one or the other).
 *   - imports, downloads, unzips, or processes the FULL dataset.
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - integrates runtime, Agent 1, providers, HubSpot, or Slack.
 *   - returns or prints a real row, a cell value, a full CNPJ, a CPF, an email,
 *     a telephone, or a fine-grained address — output is aggregate counts only.
 *   - marks a record eligible unless it AFFIRMATIVELY passes every check
 *     (allowlist-first: absence of a positive signal is NOT a pass — docs § 3).
 *
 * Reading real local files is gated on `allowLocalManifest: true` and on every
 * accepted file resolving to the `official_headerless` layout mode (this is the
 * REAL-file classifier). The manifest validator remains the single authority on
 * identity, layout, header safety, and the SOCIOS/QSA/CPF family denylist.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  getBrReceitaCnpjOfficialColumnCount,
  type BrReceitaCnpjLayoutFileType,
} from './br-receita-cnpj-file-reader';
import {
  BR_RECEITA_COMPANY_FAMILIES,
  BR_RECEITA_REFERENCE_FAMILIES,
  classifyLegalNatureRiskClass,
  emptyLegalNatureClassificationCounts,
  emptyPositiveCompanySignalCounts,
  type BrReceitaCnpjLegalNaturePolicy,
  type BrReceitaLegalNatureClassificationCounts,
  type BrReceitaLegalNatureRiskClass,
  type BrReceitaPositiveCompanySignal,
  type BrReceitaPositiveCompanySignalCounts,
} from './br-receita-cnpj-eligibility-rules';
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

export const BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_MODE = 'privacy_safe_bounded_dry_run' as const;
export const BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_LAYOUT_MODE = 'official_headerless' as const;

/** Default rows sampled per file when the caller does not specify. */
export const BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS = 5 as const;
/** Absolute ceiling on rows sampled per file (a bounded-read guarantee). */
export const BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT = 20 as const;
/** Default cap on bytes read while collecting a file's bounded sample. */
export const BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_HEADER_BYTES = 64 * 1024;
/** Hard ceiling on TOTAL bytes read per file while collecting the sample. */
export const BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_BYTES = 1 * 1024 * 1024;
/**
 * Hard ceiling on TOTAL bytes read per file for a BOUNDED COVERAGE SCAN
 * (BR-SOURCE-10H). A coverage probe scans more company ROWS than the 20-row sample
 * (to test whether an establishment's company appears a little deeper in the file),
 * so it needs a larger — but still HARD-CAPPED — byte budget. This can NEVER read
 * the full dataset: the row cap (`BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT`)
 * and this byte cap both bound the read to a tiny prefix of a multi-GB file.
 */
export const BR_RECEITA_CNPJ_PRIVACY_MAX_COVERAGE_SCAN_BYTES = 8 * 1024 * 1024;

/**
 * Minimum contiguous-digit run treated as a CPF-shaped natural-person token
 * (11 = CPF length). Kept consistent with the BR-SOURCE-7 hard-block guard so the
 * two modes agree on what a red flag is; this classifier merely counts instead of
 * aborting. A run this long only appears in categorically-excluded or concatenated
 * forms, so it is a defensive red flag inside a candidate-persistible field.
 */
const CPF_LIKE_MIN_DIGIT_RUN = 11;
/** Contiguous-digit run at/above this length is CNPJ-shaped (14 = full CNPJ). */
const CNPJ_LIKE_MIN_DIGIT_RUN = 14;
/** The at-sign marks an email — a personal-contact signal. Placeholder token only. */
const EMAIL_MARKER = String.fromCharCode(64);

// ─── Family classification (families live in the shared eligibility-rules module) ─

/**
 * ESTABELECIMENTOS official positional layout (30 columns). Contact and
 * fine-grained-address columns are stripped by the reader (docs § 5–§ 6) and are
 * therefore NOT candidate-persistible; the eligibility scan runs only on the
 * persistible positions (§ 8 "candidate-persistible-field scanner"). Indices below
 * are the contact/address positions EXCLUDED from the persistible scan. Order per
 * the official Receita layout documented in `br-receita-cnpj-data-contract.md`:
 * 13 tipo_logradouro, 14 logradouro, 15 numero, 16 complemento, 17 bairro,
 * 18 cep, 21 ddd_1, 22 telefone_1, 23 ddd_2, 24 telefone_2, 25 ddd_fax, 26 fax,
 * 27 correio_eletronico.
 */
const ESTABELECIMENTOS_CONTACT_ADDRESS_INDICES: ReadonlySet<number> = new Set([
  13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27,
]);

/** EMPRESAS positional index of razão social (company name — presence signal only). */
const EMPRESAS_RAZAO_SOCIAL_INDEX = 1;
/** EMPRESAS positional index of natureza jurídica (legal nature code). */
const EMPRESAS_NATUREZA_JURIDICA_INDEX = 2;

// ─── Statuses & reasons ─────────────────────────────────────────────────────────

/**
 * The eligibility statuses (docs § 7, calibrated by BR-SOURCE-10F). Exactly one is
 * assigned per record. Only `eligible_for_future_import` may ever reach a future,
 * separately-approved writer; every other status is non-importable. BR-SOURCE-10F
 * adds two NON-importable holds so that structurally-non-company rows no longer
 * inflate `needs_legal_review` (which stays reserved for a genuine open legal
 * question): `not_applicable_lookup` (reference/regime catalog rows) and
 * `pending_company_join_context` (an establishment awaiting its empresas join).
 */
export type BrReceitaPrivacyEligibilityStatus =
  | 'eligible_for_future_import'
  | 'excluded_person_or_pii_risk'
  | 'excluded_forbidden_file_family'
  | 'excluded_forbidden_token'
  | 'excluded_unsupported_legal_nature'
  | 'excluded_guard_triggered'
  | 'needs_legal_review'
  | 'not_applicable_lookup'
  | 'pending_company_join_context';

export const BR_RECEITA_PRIVACY_ELIGIBILITY_STATUSES: readonly BrReceitaPrivacyEligibilityStatus[] = [
  'eligible_for_future_import',
  'excluded_person_or_pii_risk',
  'excluded_forbidden_file_family',
  'excluded_forbidden_token',
  'excluded_unsupported_legal_nature',
  'excluded_guard_triggered',
  'needs_legal_review',
  'not_applicable_lookup',
  'pending_company_join_context',
];

/**
 * Machine reason codes (no personal value is ever embedded). BR-SOURCE-10F adds
 * `establishment_requires_company_join_context` — the honest reason an
 * establishment sampled in isolation is held (it carries no natureza jurídica, so
 * its eligibility cannot be affirmed without the empresas join). The legacy
 * `insufficient_positive_company_signal` is retained for back-compat but is no
 * longer emitted (establishments now use the join-context reason).
 */
export type BrReceitaPrivacyEligibilityReason =
  | 'forbidden_file_family'
  | 'cpf_like_token_detected'
  | 'contact_or_address_personal_data_signal'
  | 'cnpj_like_token_detected_outside_identity'
  | 'unsupported_or_risky_legal_nature'
  | 'mei_or_individual_entrepreneur_signal'
  | 'sample_structure_guard_triggered'
  | 'structure_only_non_company_lookup'
  | 'establishment_requires_company_join_context'
  | 'insufficient_positive_company_signal'
  | 'unknown_requires_legal_review'
  | 'passed_all_eligibility_checks';

export const BR_RECEITA_PRIVACY_ELIGIBILITY_REASONS: readonly BrReceitaPrivacyEligibilityReason[] = [
  'forbidden_file_family',
  'cpf_like_token_detected',
  'contact_or_address_personal_data_signal',
  'cnpj_like_token_detected_outside_identity',
  'unsupported_or_risky_legal_nature',
  'mei_or_individual_entrepreneur_signal',
  'sample_structure_guard_triggered',
  'structure_only_non_company_lookup',
  'establishment_requires_company_join_context',
  'insufficient_positive_company_signal',
  'unknown_requires_legal_review',
  'passed_all_eligibility_checks',
];

type ClassificationCounts = Record<BrReceitaPrivacyEligibilityStatus, number>;
type ExclusionReasonCounts = Record<BrReceitaPrivacyEligibilityReason, number>;

function emptyClassificationCounts(): ClassificationCounts {
  const counts = {} as ClassificationCounts;
  for (const status of BR_RECEITA_PRIVACY_ELIGIBILITY_STATUSES) counts[status] = 0;
  return counts;
}

function emptyExclusionReasonCounts(): ExclusionReasonCounts {
  const counts = {} as ExclusionReasonCounts;
  for (const reason of BR_RECEITA_PRIVACY_ELIGIBILITY_REASONS) counts[reason] = 0;
  return counts;
}

/**
 * Reason → status map. `passed_all_eligibility_checks` is the only eligible
 * verdict. BR-SOURCE-10F calibration (all changes strictly more conservative or
 * import-neutral):
 *   - `mei_or_individual_entrepreneur_signal` now EXCLUDES (`excluded_person_or_pii_risk`)
 *     instead of holding — MEI / empresário individual are natural-person-equivalent
 *     and excluded by default (docs § 4); a legal GO may later re-admit them.
 *   - `structure_only_non_company_lookup` now maps to `not_applicable_lookup` — a
 *     catalog row is structurally not a company candidate, not an open legal question.
 *   - `establishment_requires_company_join_context` maps to `pending_company_join_context`.
 * `needs_legal_review` stays reserved for a genuine undecided legal nature.
 */
const REASON_TO_STATUS: Record<BrReceitaPrivacyEligibilityReason, BrReceitaPrivacyEligibilityStatus> = {
  forbidden_file_family: 'excluded_forbidden_file_family',
  cpf_like_token_detected: 'excluded_person_or_pii_risk',
  contact_or_address_personal_data_signal: 'excluded_person_or_pii_risk',
  cnpj_like_token_detected_outside_identity: 'excluded_forbidden_token',
  unsupported_or_risky_legal_nature: 'excluded_unsupported_legal_nature',
  mei_or_individual_entrepreneur_signal: 'excluded_person_or_pii_risk',
  sample_structure_guard_triggered: 'excluded_guard_triggered',
  structure_only_non_company_lookup: 'not_applicable_lookup',
  establishment_requires_company_join_context: 'pending_company_join_context',
  insufficient_positive_company_signal: 'needs_legal_review',
  unknown_requires_legal_review: 'needs_legal_review',
  passed_all_eligibility_checks: 'eligible_for_future_import',
};

/** Legal-nature risk class → the classifier's per-record reason code. */
const RISK_CLASS_TO_REASON: Record<BrReceitaLegalNatureRiskClass, BrReceitaPrivacyEligibilityReason> = {
  allowed_commercial_organization: 'passed_all_eligibility_checks',
  blocked_person_or_individual: 'mei_or_individual_entrepreneur_signal',
  blocked_risky_or_unsupported: 'unsupported_or_risky_legal_nature',
  needs_legal_review: 'unknown_requires_legal_review',
  not_applicable_lookup: 'structure_only_non_company_lookup',
};

// ─── Eligibility policy (dependency-injected; UNSET by default = fail-closed) ──

/**
 * Optional legal-nature policy. When ABSENT (the default, and what the runner
 * uses), NO record can be marked eligible — every clean company row falls to
 * `needs_legal_review`, because docs § 11 leaves the eligible-natureza allowlist,
 * MEI policy, and full-CNPJ persistence UNDECIDED. A test may inject a synthetic
 * policy to exercise the eligible branch; the policy authorizes nothing at runtime.
 *
 * BR-SOURCE-10F: the code-set shape now lives in the shared eligibility-rules
 * module; this alias preserves the public classifier name.
 */
export type BrReceitaCnpjPrivacyEligibilityPolicy = BrReceitaCnpjLegalNaturePolicy;

// ─── Options / result shapes ─────────────────────────────────────────────────

export interface BrReceitaCnpjPrivacyClassifierOptions {
  /** Local path to the manifest JSON (never a URL, never a CSV/ZIP). */
  manifestPath: string;
  /** MUST be true to read the described local files (fail-closed otherwise). */
  allowLocalManifest: boolean;
  /** Treat unknown, non-sensitive headers as errors (default false). */
  strict?: boolean;
  /** Rows sampled per file (default 5, hard max 20). */
  maxSampleRowsPerFile?: number;
  /** Ceiling on bytes read to collect each file's bounded sample. */
  maxHeaderBytes?: number;
  /** Optional legal-nature policy (unset = nothing eligible; see interface). */
  eligibilityPolicy?: BrReceitaCnpjPrivacyEligibilityPolicy;
  /** When true, `ok` is false if ANY record was excluded (default false). */
  failOnAnyExcluded?: boolean;
}

/** All-false safety block asserted on every classifier result. */
export interface BrReceitaCnpjPrivacySafety {
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
  rawRowsPrinted: false;
  personalValuesPrinted: false;
}

const SAFETY_ALL_FALSE: BrReceitaCnpjPrivacySafety = {
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
  rawRowsPrinted: false,
  personalValuesPrinted: false,
};

export type BrReceitaCnpjPrivacyFileFamily = 'company' | 'reference' | 'forbidden' | 'unknown';

/** A sanitized per-file classification report. NO path, NO CNPJ, NO row content. */
export interface BrReceitaCnpjPrivacyFileReport {
  fileType: BrReceitaCnpjManifestFileType | 'unknown';
  safeFileLabel: string;
  family: BrReceitaCnpjPrivacyFileFamily;
  layoutValidation: BrReceitaCnpjManifestFileReport['layoutValidation'];
  sampleRowsSeen: number;
  classificationCounts: ClassificationCounts;
  exclusionCountsByReason: ExclusionReasonCounts;
  legalNatureClassificationCounts: BrReceitaLegalNatureClassificationCounts;
  positiveCompanySignalCounts: BrReceitaPositiveCompanySignalCounts;
  sha256Hash12?: string;
}

export interface BrReceitaCnpjPrivacyClassificationResult {
  ok: boolean;
  mode: typeof BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_MODE;
  sourceKey: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  countryCode: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  sourceYear: number;
  sourcePeriod: string;
  manifestValidation: 'passed' | 'failed';
  layoutMode: typeof BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_LAYOUT_MODE;
  maxSampleRows: number;
  filesSeen: number;
  filesAccepted: number;
  filesRejected: number;
  sampleRowsSeen: number;
  classificationCounts: ClassificationCounts;
  exclusionCountsByReason: ExclusionReasonCounts;
  legalNatureClassificationCounts: BrReceitaLegalNatureClassificationCounts;
  positiveCompanySignalCounts: BrReceitaPositiveCompanySignalCounts;
  fileReports: BrReceitaCnpjPrivacyFileReport[];
  fullDatasetProcessed: false;
  importExecuted: false;
  supabaseWrite: false;
  runtimeIntegration: false;
  agent1Integration: false;
  rejectionReasons: string[];
  safety: BrReceitaCnpjPrivacySafety;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type BrReceitaCnpjPrivacyClassifierErrorCode =
  | 'allow_local_manifest_required'
  | 'sample_row_limit_exceeded'
  | 'full_dataset_processing_not_allowed';

/** Raised when the classifier's safety contract is violated (bad gate / limit). */
export class BrReceitaCnpjPrivacyClassifierError extends Error {
  readonly reasonCode: BrReceitaCnpjPrivacyClassifierErrorCode;
  constructor(reasonCode: BrReceitaCnpjPrivacyClassifierErrorCode, detail: string) {
    super(`BRSOURCE10E_FORBIDDEN_PRIVACY_CLASSIFIER_MODE: ${reasonCode} — ${detail}`);
    this.name = 'BrReceitaCnpjPrivacyClassifierError';
    this.reasonCode = reasonCode;
  }
}

// ─── Option validation (fail-closed gates) ────────────────────────────────────

function assertClassifierGatesOrThrow(options: BrReceitaCnpjPrivacyClassifierOptions): number {
  if (!options.allowLocalManifest) {
    throw new BrReceitaCnpjPrivacyClassifierError(
      'allow_local_manifest_required',
      'reading local files requires allowLocalManifest: true',
    );
  }
  const requested =
    options.maxSampleRowsPerFile ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS;
  if (!Number.isFinite(requested)) {
    throw new BrReceitaCnpjPrivacyClassifierError(
      'full_dataset_processing_not_allowed',
      'maxSampleRowsPerFile must be a finite, bounded integer',
    );
  }
  if (!Number.isInteger(requested) || requested < 0) {
    throw new BrReceitaCnpjPrivacyClassifierError(
      'sample_row_limit_exceeded',
      `maxSampleRowsPerFile must be a non-negative integer, got "${requested}"`,
    );
  }
  if (requested > BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT) {
    throw new BrReceitaCnpjPrivacyClassifierError(
      'sample_row_limit_exceeded',
      `maxSampleRowsPerFile (${requested}) exceeds the hard limit of ${BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT}`,
    );
  }
  return requested;
}

// ─── Manifest descriptor re-read (paths only; NEVER header validation) ─────────

export interface ClassifierFileDescriptor {
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
 * Re-reads ONLY paths / delimiters / encodings from an already-validated manifest
 * so the sampler knows what to open. NOT a re-validation: identity + layout +
 * header + forbidden-token checks live in `validateBrReceitaCnpjLocalManifest`.
 * Every path is defensively re-guarded (absolute / traversal / URL) here.
 */
export async function readValidatedManifestDescriptors(
  manifestPath: string,
): Promise<ClassifierFileDescriptor[]> {
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
  const descriptors: ClassifierFileDescriptor[] = [];

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
 * Reads AT MOST `maxLines` complete lines from a headerless file (every line is a
 * DATA row), capped by a hard byte budget so a pathological huge / single-line
 * file can never be fully read. Returns raw lines for structural splitting only —
 * the caller must never surface their content.
 */
export async function readBoundedSampleLines(
  filePath: string,
  encoding: BrReceitaCnpjManifestEncoding,
  maxLines: number,
  maxHeaderBytes: number,
  maxTotalBytes: number = BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_BYTES,
): Promise<BoundedSampleOutcome> {
  if (maxLines <= 0) return { lines: [], limitExceeded: false };
  const bufferEncoding: BufferEncoding = encoding === 'latin1' ? 'latin1' : 'utf8';
  const chunkSize = Math.min(maxHeaderBytes, 64 * 1024);
  const fh = await fsp.open(filePath, 'r');
  try {
    let text = '';
    let bytesRead = 0;
    let position = 0;
    const buffer = Buffer.alloc(chunkSize);

    while (bytesRead < maxTotalBytes) {
      const { bytesRead: n } = await fh.read(buffer, 0, chunkSize, position);
      if (n === 0) {
        return { lines: splitCompleteLines(text, maxLines, true), limitExceeded: false };
      }
      bytesRead += n;
      position += n;
      text += buffer.subarray(0, n).toString(bufferEncoding);

      if (countNewlines(text) >= maxLines) {
        return { lines: splitCompleteLines(text, maxLines, false), limitExceeded: false };
      }
    }
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

function splitCompleteLines(text: string, maxLines: number, includeTrailing: boolean): string[] {
  const rawLines = text.split('\n');
  const usable = includeTrailing ? rawLines : rawLines.slice(0, rawLines.length - 1);
  return usable.slice(0, maxLines).map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// ─── Cell splitting & scanning (values used in-memory only; never surfaced) ────

/**
 * Splits a delimited line into cells, quote-aware (`""` escapes), mirroring the
 * counting logic in `countBrReceitaCnpjDelimitedColumns`. Returns cell STRINGS
 * that are scanned in memory and then discarded — they never leave this module.
 */
export function splitDelimitedCells(line: string, delimiter: string): string[] {
  const trimmed = line.replace(/\r$/, '');
  const cells: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (c === '"') {
      if (inQuotes && trimmed[i + 1] === '"') {
        field += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (c === delimiter && !inQuotes) {
      cells.push(field);
      field = '';
      continue;
    }
    field += c;
  }
  cells.push(field);
  return cells;
}

/** Longest contiguous run of ASCII digits in a value (structural, no value kept). */
function maxDigitRun(value: string): number {
  let best = 0;
  let current = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x30 && code <= 0x39) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

/** True when index `i` is a candidate-persistible column for the given family. */
function isPersistibleIndex(fileType: BrReceitaCnpjLayoutFileType, index: number): boolean {
  if (fileType === 'estabelecimentos') {
    return !ESTABELECIMENTOS_CONTACT_ADDRESS_INDICES.has(index);
  }
  // Every column of empresas / reference families is treated as persistible-scope.
  return true;
}

export function familyOf(fileType: BrReceitaCnpjManifestFileType | 'unknown'): BrReceitaCnpjPrivacyFileFamily {
  if (BR_RECEITA_COMPANY_FAMILIES.has(fileType)) return 'company';
  if (BR_RECEITA_REFERENCE_FAMILIES.has(fileType)) return 'reference';
  return 'unknown';
}

// ─── Per-row classification ─────────────────────────────────────────────────────

/**
 * The full per-row verdict: a reason (→ status), the legal-nature risk class where
 * a determination is meaningful, and any positive company signals observed. All
 * three are machine values — a row, cell value, full CNPJ, or CPF is NEVER carried.
 */
export interface RowClassification {
  readonly reason: BrReceitaPrivacyEligibilityReason;
  readonly legalNatureRiskClass?: BrReceitaLegalNatureRiskClass;
  readonly positiveSignals: readonly BrReceitaPositiveCompanySignal[];
}

/**
 * Maps a per-row eligibility reason to its single canonical status. Exposed so a
 * layered dry-run (e.g. the company↔establishment join) can reuse the exact same
 * reason→status contract instead of re-deriving it. Pure lookup; no value read.
 */
export function eligibilityStatusForReason(
  reason: BrReceitaPrivacyEligibilityReason,
): BrReceitaPrivacyEligibilityStatus {
  return REASON_TO_STATUS[reason];
}

/**
 * Classifies a single sampled row. Allowlist-first and most-sensitive-first:
 * person/PII outranks token, which outranks legal-nature/structure. A legal-nature
 * risk class is attached only where it is meaningful (an `empresas` row that
 * reaches the legal-nature stage, or a reference lookup); positive signals are
 * recorded only on rows not pre-empted by a PII/token/guard exclusion. NEVER
 * returns a value — only machine codes.
 */
export function classifyRow(
  fileType: BrReceitaCnpjLayoutFileType,
  family: BrReceitaCnpjPrivacyFileFamily,
  cells: readonly string[],
  expectedColumns: number,
  policy: BrReceitaCnpjPrivacyEligibilityPolicy | undefined,
): RowClassification {
  // 1) Structural anomaly (a sampled row that does not match the official layout).
  if (cells.length !== expectedColumns) {
    return { reason: 'sample_structure_guard_triggered', positiveSignals: [] };
  }

  // 2) Persistible-field PII scan (most sensitive first).
  let hasForbiddenToken = false;
  for (let i = 0; i < cells.length; i++) {
    if (!isPersistibleIndex(fileType, i)) continue;
    const cell = cells[i]!;
    if (cell.includes(EMAIL_MARKER)) {
      return { reason: 'contact_or_address_personal_data_signal', positiveSignals: [] };
    }
    const run = maxDigitRun(cell);
    if (run >= CPF_LIKE_MIN_DIGIT_RUN && run < CNPJ_LIKE_MIN_DIGIT_RUN) {
      return { reason: 'cpf_like_token_detected', positiveSignals: [] };
    }
    if (run >= CNPJ_LIKE_MIN_DIGIT_RUN) {
      hasForbiddenToken = true;
    }
  }
  if (hasForbiddenToken) {
    return { reason: 'cnpj_like_token_detected_outside_identity', positiveSignals: [] };
  }

  // 3) Reference / regime families are catalog rows, never a company candidate.
  if (family !== 'company') {
    return {
      reason: 'structure_only_non_company_lookup',
      legalNatureRiskClass: 'not_applicable_lookup',
      positiveSignals: [],
    };
  }

  // 4) Legal-nature assessment (empresas only — natureza jurídica lives there).
  if (fileType === 'empresas') {
    const razao = (cells[EMPRESAS_RAZAO_SOCIAL_INDEX] ?? '').trim();
    const natureza = (cells[EMPRESAS_NATUREZA_JURIDICA_INDEX] ?? '').trim();
    const riskClass = classifyLegalNatureRiskClass(natureza, policy);
    const positiveSignals: BrReceitaPositiveCompanySignal[] = [];
    if (razao.length > 0) positiveSignals.push('company_name_present');
    if (riskClass === 'allowed_commercial_organization') positiveSignals.push('commercial_legal_nature');
    return {
      reason: RISK_CLASS_TO_REASON[riskClass],
      legalNatureRiskClass: riskClass,
      positiveSignals,
    };
  }

  // 5) estabelecimentos in isolation carries no natureza jurídica — eligibility
  // cannot be affirmed without the empresas join, so it is held (allowlist-first).
  // This is a data-completeness hold, NOT an open legal question.
  return {
    reason: 'establishment_requires_company_join_context',
    positiveSignals: ['establishment_requires_join_context'],
  };
}

// ─── File report assembly ───────────────────────────────────────────────────────

function baseFileReport(v: BrReceitaCnpjManifestFileReport): BrReceitaCnpjPrivacyFileReport {
  const report: BrReceitaCnpjPrivacyFileReport = {
    fileType: v.fileType,
    safeFileLabel: v.safeFileLabel,
    family: familyOf(v.fileType),
    layoutValidation: v.layoutValidation,
    sampleRowsSeen: 0,
    classificationCounts: emptyClassificationCounts(),
    exclusionCountsByReason: emptyExclusionReasonCounts(),
    legalNatureClassificationCounts: emptyLegalNatureClassificationCounts(),
    positiveCompanySignalCounts: emptyPositiveCompanySignalCounts(),
  };
  if (v.sha256Hash12 !== undefined) report.sha256Hash12 = v.sha256Hash12;
  return report;
}

interface ClassifierTotals {
  counts: ClassificationCounts;
  reasons: ExclusionReasonCounts;
  legalNature: BrReceitaLegalNatureClassificationCounts;
  signals: BrReceitaPositiveCompanySignalCounts;
}

function record(
  report: BrReceitaCnpjPrivacyFileReport,
  totals: ClassifierTotals,
  rc: RowClassification,
): void {
  const status = REASON_TO_STATUS[rc.reason];
  report.classificationCounts[status] += 1;
  report.exclusionCountsByReason[rc.reason] += 1;
  totals.counts[status] += 1;
  totals.reasons[rc.reason] += 1;

  if (rc.legalNatureRiskClass !== undefined) {
    report.legalNatureClassificationCounts[rc.legalNatureRiskClass] += 1;
    totals.legalNature[rc.legalNatureRiskClass] += 1;
  }
  for (const signal of rc.positiveSignals) {
    report.positiveCompanySignalCounts[signal] += 1;
    totals.signals[signal] += 1;
  }
}

// ─── Public entry point ─────────────────────────────────────────────────────────

/**
 * Runs a bounded, sanitized, PRIVACY-SAFE classifier over a Receita CNPJ manifest.
 * Validates the manifest (authoritative), requires every accepted file to be
 * `official_headerless`, then reads a bounded sample per file and scores each row
 * against the docs § 3–§ 8 eligibility contract. Emits ONLY aggregate counts —
 * never a row, a value, a full CNPJ, a CPF, an email, a phone, or an address.
 */
export async function runBrReceitaCnpjPrivacySafeClassifier(
  options: BrReceitaCnpjPrivacyClassifierOptions,
): Promise<BrReceitaCnpjPrivacyClassificationResult> {
  const maxSampleRows = assertClassifierGatesOrThrow(options);
  const strict = options.strict ?? false;
  const maxHeaderBytes =
    options.maxHeaderBytes && options.maxHeaderBytes > 0
      ? options.maxHeaderBytes
      : BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_HEADER_BYTES;

  const validation = await validateBrReceitaCnpjLocalManifest({
    manifestPath: options.manifestPath,
    strict,
    allowRealLocalFiles: true,
    maxHeaderBytes,
  });

  const base = {
    mode: BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_MODE,
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear: validation.sourceYear,
    sourcePeriod: validation.sourcePeriod,
    layoutMode: BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_LAYOUT_MODE,
    maxSampleRows,
    filesSeen: validation.filesSeen,
    filesAccepted: validation.filesAccepted,
    filesRejected: validation.filesRejected,
    fullDatasetProcessed: false as const,
    importExecuted: false as const,
    supabaseWrite: false as const,
    runtimeIntegration: false as const,
    agent1Integration: false as const,
    safety: SAFETY_ALL_FALSE,
  };

  // Manifest validation failed → classifier fails safely, no sampling.
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
      sampleRowsSeen: 0,
      classificationCounts: emptyClassificationCounts(),
      exclusionCountsByReason: emptyExclusionReasonCounts(),
      legalNatureClassificationCounts: emptyLegalNatureClassificationCounts(),
      positiveCompanySignalCounts: emptyPositiveCompanySignalCounts(),
      fileReports: validation.fileReports.map(baseFileReport),
      rejectionReasons,
    };
  }

  // Real-file classifier: every ACCEPTED file MUST be official_headerless.
  const nonHeaderless = validation.fileReports.filter(
    (r) => r.status === 'accepted' && r.layoutMode !== BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_LAYOUT_MODE,
  );
  if (nonHeaderless.length > 0) {
    return {
      ...base,
      ok: false,
      manifestValidation: 'passed',
      sampleRowsSeen: 0,
      classificationCounts: emptyClassificationCounts(),
      exclusionCountsByReason: emptyExclusionReasonCounts(),
      legalNatureClassificationCounts: emptyLegalNatureClassificationCounts(),
      positiveCompanySignalCounts: emptyPositiveCompanySignalCounts(),
      fileReports: validation.fileReports.map(baseFileReport),
      rejectionReasons: nonHeaderless.map((r) => `${r.fileType}:layout_mode_not_official_headerless`),
    };
  }

  const descriptors = await readValidatedManifestDescriptors(options.manifestPath);
  const descriptorByType = new Map<string, ClassifierFileDescriptor>();
  for (const d of descriptors) descriptorByType.set(d.fileType, d);

  const totals: ClassifierTotals = {
    counts: emptyClassificationCounts(),
    reasons: emptyExclusionReasonCounts(),
    legalNature: emptyLegalNatureClassificationCounts(),
    signals: emptyPositiveCompanySignalCounts(),
  };
  const fileReports: BrReceitaCnpjPrivacyFileReport[] = [];
  const rejectionReasons: string[] = [];
  let sampleRowsSeen = 0;

  for (const v of validation.fileReports) {
    const report = baseFileReport(v);
    const descriptor = v.fileType !== 'unknown' ? descriptorByType.get(v.fileType) : undefined;
    if (descriptor === undefined || v.status !== 'accepted') {
      fileReports.push(report);
      continue;
    }

    let lines: string[];
    try {
      const outcome = await readBoundedSampleLines(
        descriptor.resolvedPath,
        descriptor.encoding,
        maxSampleRows,
        maxHeaderBytes,
      );
      if (outcome.limitExceeded) {
        rejectionReasons.push(`${v.fileType}:sample_read_failed`);
        fileReports.push(report);
        continue;
      }
      lines = outcome.lines;
    } catch {
      rejectionReasons.push(`${v.fileType}:sample_read_failed`);
      fileReports.push(report);
      continue;
    }

    const fileType = descriptor.fileType as BrReceitaCnpjLayoutFileType;
    const family = familyOf(v.fileType);
    const expectedColumns = getBrReceitaCnpjOfficialColumnCount(fileType);

    for (const line of lines) {
      if (line.trim() === '') continue;
      report.sampleRowsSeen += 1;
      sampleRowsSeen += 1;
      const cells = splitDelimitedCells(line, descriptor.delimiter);
      const rc = classifyRow(fileType, family, cells, expectedColumns, options.eligibilityPolicy);
      record(report, totals, rc);
    }
    fileReports.push(report);
  }

  const anyExcluded =
    totals.counts.excluded_person_or_pii_risk +
      totals.counts.excluded_forbidden_file_family +
      totals.counts.excluded_forbidden_token +
      totals.counts.excluded_unsupported_legal_nature +
      totals.counts.excluded_guard_triggered >
    0;

  const ok =
    rejectionReasons.length === 0 && !(options.failOnAnyExcluded === true && anyExcluded);

  return {
    ...base,
    ok,
    manifestValidation: 'passed',
    sampleRowsSeen,
    classificationCounts: totals.counts,
    exclusionCountsByReason: totals.reasons,
    legalNatureClassificationCounts: totals.legalNature,
    positiveCompanySignalCounts: totals.signals,
    fileReports,
    rejectionReasons,
  };
}
