/**
 * BR Receita CNPJ — local manifest schema & validation result types (BR-SOURCE-6).
 *
 * A manifest is a small, LOCAL JSON document that DESCRIBES a set of Receita CNPJ
 * files (empresas / estabelecimentos / …) sitting on disk next to it. It is the
 * boundary object for a future controlled, real-file *dry-run*: it lets the
 * validator confirm a file set's identity, layout, and integrity WITHOUT ever
 * importing, downloading, or reading data rows.
 *
 * ── The manifest layer NEVER (by construction) ──────────────────────────────
 *   - describes or references SOCIOS / QSA / CPF / contact-enrichment files.
 *   - carries a URL, a remote location, or a ZIP/CSV payload inline.
 *   - triggers a download, an import, a Supabase write, or any runtime.
 *
 * These are TYPES ONLY. All I/O and fail-closed enforcement lives in
 * `br-receita-cnpj-manifest-validator.ts`.
 */

import type { BrReceitaCnpjLayoutFileType } from './br-receita-cnpj-file-reader';

export const BR_RECEITA_CNPJ_MANIFEST_MODE = 'local_manifest_validation' as const;
export const BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY = 'br_receita_cnpj_dados_abertos' as const;
export const BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE = 'BR' as const;

/** File types a manifest MAY describe. Mirrors the reader's layout file types. */
export type BrReceitaCnpjManifestFileType = BrReceitaCnpjLayoutFileType;

/** The two file types every manifest MUST include. */
export const BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES = ['empresas', 'estabelecimentos'] as const;

/** The optional (allowed) reference/regime file types. */
export const BR_RECEITA_CNPJ_OPTIONAL_FILE_TYPES = [
  'simples',
  'cnaes',
  'municipios',
  'naturezas',
] as const;

/** Every file type the manifest layer recognizes as valid. */
export const BR_RECEITA_CNPJ_ALLOWED_FILE_TYPES = [
  ...BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
  ...BR_RECEITA_CNPJ_OPTIONAL_FILE_TYPES,
] as const;

/** Data-file extensions the validator will accept (a ZIP is explicitly rejected). */
export const BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS = ['.csv', '.txt'] as const;
export type BrReceitaCnpjAllowedExtension = (typeof BR_RECEITA_CNPJ_ALLOWED_EXTENSIONS)[number];

export type BrReceitaCnpjManifestEncoding = 'latin1' | 'utf8';
export type BrReceitaCnpjManifestDelimiter = ',' | ';';

/** One described file within a manifest. `path` is ALWAYS local + relative. */
export interface BrReceitaCnpjManifestFile {
  fileType: BrReceitaCnpjManifestFileType;
  /** Local path relative to the manifest directory (never absolute, never a URL). */
  path: string;
  expectedSha256?: string;
  expectedSizeBytes?: number;
  encoding?: BrReceitaCnpjManifestEncoding;
  delimiter?: BrReceitaCnpjManifestDelimiter;
}

/** The manifest document shape (validated structurally at read time). */
export interface BrReceitaCnpjManifest {
  sourceKey: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  countryCode: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  sourceYear: number;
  /** Monthly period tag, format `YYYY-MM`. */
  sourcePeriod: string;
  mode: typeof BR_RECEITA_CNPJ_MANIFEST_MODE;
  files: BrReceitaCnpjManifestFile[];
}

// ─── Rejection taxonomy (all outcomes are safe, sanitized) ──────────────────

export type BrReceitaCnpjManifestReasonCode =
  // Manifest-structural (fatal — the whole manifest is rejected).
  | 'manifest_not_json'
  | 'manifest_path_not_allowed'
  | 'manifest_url_not_allowed'
  | 'manifest_mode_invalid'
  | 'manifest_source_key_invalid'
  | 'manifest_country_invalid'
  | 'source_year_invalid'
  | 'source_period_invalid'
  | 'required_file_missing'
  | 'duplicate_file_type'
  | 'forbidden_file_type'
  | 'forbidden_file_name'
  | 'too_many_files'
  // Per-file (recorded against the individual file report).
  | 'unsupported_extension'
  | 'zip_not_allowed'
  | 'file_not_found'
  | 'file_size_mismatch'
  | 'file_hash_mismatch'
  | 'header_validation_failed'
  | 'forbidden_header'
  | 'dangerous_unknown_header'
  | 'path_traversal_blocked'
  | 'header_read_limit_exceeded'
  // Catch-all.
  | 'unexpected_error';

export type BrReceitaCnpjManifestLayoutValidation = 'passed' | 'failed' | 'skipped';
export type BrReceitaCnpjManifestFileStatus = 'accepted' | 'rejected';

/** A sanitized per-file report. Carries NO full path, NO CNPJ, NO row content. */
export interface BrReceitaCnpjManifestFileReport {
  fileType: BrReceitaCnpjManifestFileType | 'unknown';
  /** Sanitized basename only — never a full local path. */
  safeFileLabel: string;
  extension: string;
  sizeBytes?: number;
  /** Non-reversible SHA-256 truncated to 12 hex chars. */
  sha256Hash12?: string;
  layoutValidation: BrReceitaCnpjManifestLayoutValidation;
  status: BrReceitaCnpjManifestFileStatus;
  reasonCode?: BrReceitaCnpjManifestReasonCode;
}

/** All-false safety block asserted on every result. */
export interface BrReceitaCnpjManifestSafety {
  datasetDownload: false;
  supabaseWrite: false;
  productionImport: false;
  runtimeIntegration: false;
  agent1Integration: false;
  hubspot: false;
  slack: false;
  liveProspectGeneration: false;
}

export interface BrReceitaCnpjManifestValidationResult {
  ok: boolean;
  sourceKey: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  countryCode: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  sourceYear: number;
  sourcePeriod: string;
  filesSeen: number;
  filesAccepted: number;
  filesRejected: number;
  fileReports: BrReceitaCnpjManifestFileReport[];
  /** Set only when the manifest is rejected at the structural (manifest-wide) level. */
  reasonCode?: BrReceitaCnpjManifestReasonCode;
  safety: BrReceitaCnpjManifestSafety;
}
