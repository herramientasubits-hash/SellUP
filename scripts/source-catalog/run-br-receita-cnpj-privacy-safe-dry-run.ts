/**
 * BR Receita CNPJ — privacy-safe bounded dry-run CLASSIFIER runner (BR-SOURCE-10E).
 *
 * Runs the privacy-safe eligibility classifier over a LOCAL `official_headerless`
 * Receita CNPJ manifest and prints ONLY sanitized, aggregated counts. It is an
 * EXPLICIT, SEPARATE mode from the BR-SOURCE-7 hard-block dry-run
 * (`run-br-receita-cnpj-local-dry-run.ts`): where that runner ABORTS the moment a
 * sampled cell trips the anti-PII guard, this one turns the same finding into an
 * exclusion COUNT. Neither replaces the other.
 *
 * ── This runner NEVER (fail-closed by construction) ─────────────────────────
 *   - accepts a CSV/ZIP payload, a directory, a URL, or a remote location.
 *   - downloads, unzips, imports, executes, or runs a full/expansion pass.
 *   - opens a Supabase client or performs a production/runtime write.
 *   - touches Agent 1 runtime, providers, HubSpot, or Slack.
 *   - prints a real row, a full CNPJ, a CPF, an email, a phone, or an address.
 *   - authorizes an import — its output is observational aggregate metrics only.
 *
 * A real LOCAL manifest is accepted ONLY behind `--allow-local-manifest`; a URL
 * manifest, a non-`.json` manifest, `--max-sample-rows > 20`, or any forbidden
 * ingestion flag is rejected before the classifier runs. `--fail-on-any-excluded`
 * is opt-in; by default the run stays ok even when records are excluded (only a
 * structural/leak/manifest failure makes it fail).
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-privacy-safe-dry-run.ts \
 *     --manifest ./manifest.json --allow-local-manifest --format json --strict --max-sample-rows 5
 */

import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT,
  runBrReceitaCnpjPrivacySafeClassifier,
  type BrReceitaCnpjPrivacyClassificationResult,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-privacy-safe-classifier';

// ─── Constants ───────────────────────────────────────────────────────────────

export const ALLOWED_FORMATS = ['text', 'json'] as const;
export type PrivacyRunnerFormat = (typeof ALLOWED_FORMATS)[number];

/**
 * Flags that would turn this into a real ingestion / download / import / runtime
 * / full-expansion tool. Their mere presence is a fail-closed error.
 */
export const FORBIDDEN_FLAGS = [
  'input',
  'input-dir',
  'csv',
  'zip',
  'download',
  'import',
  'execute',
  'supabase',
  'production',
  'hubspot',
  'slack',
  'url',
  'remote',
  'full',
  'all',
  'runtime',
  'agent1',
] as const;

/** Tokens that must NEVER appear as a key in the rendered output (defensive). */
export const FORBIDDEN_OUTPUT_KEY_TOKENS = [
  'socios',
  'qsa',
  'telefone',
  'fax',
  'correio_eletronico',
  'ddd',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cep',
  'raw_row',
  'original_row',
  'full_row',
  'full_path',
  'razao_social',
  'legal_name',
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ForbiddenPrivacyRunnerModeError extends Error {
  constructor(message: string) {
    super(`BRSOURCE10E_FORBIDDEN_PRIVACY_MODE: ${message}`);
    this.name = 'ForbiddenPrivacyRunnerModeError';
  }
}

export class UnknownPrivacyRunnerFlagError extends Error {
  constructor(flag: string) {
    super(`BRSOURCE10E_UNKNOWN_FLAG: unrecognized option "--${flag}"`);
    this.name = 'UnknownPrivacyRunnerFlagError';
  }
}

export class PrivacyRunnerOutputSanitizationError extends Error {
  constructor(message: string) {
    super(`BRSOURCE10E_OUTPUT_SANITIZATION: ${message}`);
    this.name = 'PrivacyRunnerOutputSanitizationError';
  }
}

// ─── Options / report shapes ─────────────────────────────────────────────────

export interface PrivacyRunnerOptions {
  readonly manifestPath: string;
  readonly format: PrivacyRunnerFormat;
  readonly strict: boolean;
  readonly maxSampleRows: number;
  readonly failOnAnyExcluded: boolean;
}

export interface PrivacyRunnerSafety {
  readonly dataset_download: false;
  readonly supabase_write: false;
  readonly production_import: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly hubspot: false;
  readonly slack: false;
  readonly live_prospect_generation: false;
  readonly raw_rows_printed: false;
  readonly personal_values_printed: false;
}

const SAFETY_ALL_FALSE: PrivacyRunnerSafety = {
  dataset_download: false,
  supabase_write: false,
  production_import: false,
  runtime_integration: false,
  agent1_integration: false,
  hubspot: false,
  slack: false,
  live_prospect_generation: false,
  raw_rows_printed: false,
  personal_values_printed: false,
};

export interface PrivacyRunnerFileReport {
  readonly file_type: string;
  readonly safe_file_label: string;
  readonly family: string;
  readonly layout_validation: string;
  readonly sample_rows_seen: number;
  readonly classification_counts: Record<string, number>;
  readonly exclusion_counts_by_reason: Record<string, number>;
  readonly legal_nature_classification_counts: Record<string, number>;
  readonly positive_company_signal_counts: Record<string, number>;
  readonly sha256_hash12?: string;
}

/** The sanitized, printable report. No full CNPJ, no full path, no row content. */
export interface PrivacyRunnerReport {
  readonly ok: boolean;
  readonly mode: string;
  readonly source_key: string;
  readonly country_code: string;
  readonly source_year: number;
  readonly source_period: string;
  readonly manifest_validation: 'passed' | 'failed';
  readonly layout_mode: string;
  readonly max_sample_rows: number;
  readonly files_seen: number;
  readonly files_accepted: number;
  readonly files_rejected: number;
  readonly sample_rows_seen: number;
  readonly classification_counts: Record<string, number>;
  readonly exclusion_counts_by_reason: Record<string, number>;
  readonly legal_nature_classification_counts: Record<string, number>;
  readonly positive_company_signal_counts: Record<string, number>;
  readonly file_reports: PrivacyRunnerFileReport[];
  readonly rejection_reasons: string[];
  readonly full_dataset_processed: false;
  readonly import_executed: false;
  readonly supabase_write: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly safety: PrivacyRunnerSafety;
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function readFlag(token: string): { flag: string; inlineValue: string | null } {
  const withoutDashes = token.replace(/^--/, '');
  const eq = withoutDashes.indexOf('=');
  if (eq >= 0) {
    return { flag: withoutDashes.slice(0, eq), inlineValue: withoutDashes.slice(eq + 1) };
  }
  return { flag: withoutDashes, inlineValue: null };
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

export function assertNoForbiddenFlag(flag: string): void {
  if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag.toLowerCase())) {
    throw new ForbiddenPrivacyRunnerModeError(
      `option "--${flag}" is not available — this runner never reads CSV/ZIP, downloads, imports, executes, writes to Supabase, runs in production, integrates runtime/Agent 1, or processes the full dataset`,
    );
  }
}

function parseMaxSampleRows(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ForbiddenPrivacyRunnerModeError(
      `--max-sample-rows must be a non-negative integer, got "${value}"`,
    );
  }
  const parsed = Number(value);
  if (parsed > BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT) {
    throw new ForbiddenPrivacyRunnerModeError(
      `--max-sample-rows (${parsed}) exceeds the hard limit of ${BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT}`,
    );
  }
  return parsed;
}

/**
 * Parses the privacy-safe runner CLI args. Fail-closed: forbidden flags, unknown
 * flags, URL manifests, non-`.json` manifests, `--max-sample-rows > 20`, and a
 * missing `--manifest`/`--allow-local-manifest` all throw before any read runs.
 */
export function parsePrivacyRunnerArgs(argv: string[]): PrivacyRunnerOptions {
  let manifest: string | null = null;
  let allowLocalManifest = false;
  let format: PrivacyRunnerFormat = 'text';
  let strict = false;
  let maxSampleRows: number | null = null;
  let failOnAnyExcluded = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new UnknownPrivacyRunnerFlagError(token);
    }
    const { flag, inlineValue } = readFlag(token);
    assertNoForbiddenFlag(flag);

    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UnknownPrivacyRunnerFlagError(`${flag} (missing value)`);
      }
      i += 1;
      return next;
    };

    switch (flag) {
      case 'manifest':
        manifest = takeValue();
        break;
      case 'allow-local-manifest':
        allowLocalManifest = true;
        break;
      case 'max-sample-rows':
        maxSampleRows = parseMaxSampleRows(takeValue());
        break;
      case 'fail-on-any-excluded':
        failOnAnyExcluded = true;
        break;
      case 'format': {
        const value = takeValue();
        if (!(ALLOWED_FORMATS as readonly string[]).includes(value)) {
          throw new UnknownPrivacyRunnerFlagError(`format=${value}`);
        }
        format = value as PrivacyRunnerFormat;
        break;
      }
      case 'strict':
        strict = true;
        break;
      default:
        throw new UnknownPrivacyRunnerFlagError(flag);
    }
  }

  if (manifest === null) {
    throw new ForbiddenPrivacyRunnerModeError(
      '--manifest <path> --allow-local-manifest is required (this is the real-file classifier)',
    );
  }
  if (!allowLocalManifest) {
    throw new ForbiddenPrivacyRunnerModeError(
      '--manifest requires the explicit --allow-local-manifest flag',
    );
  }
  if (looksLikeUrl(manifest)) {
    throw new ForbiddenPrivacyRunnerModeError('--manifest must be a LOCAL path, never a URL');
  }
  if (path.extname(manifest).toLowerCase() !== '.json') {
    throw new ForbiddenPrivacyRunnerModeError('--manifest must point to a local .json manifest');
  }

  return {
    manifestPath: manifest,
    format,
    strict,
    maxSampleRows: maxSampleRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
    failOnAnyExcluded,
  };
}

// ─── Output guards ───────────────────────────────────────────────────────────

function collectOutputKeys(value: unknown, keys: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectOutputKeys(item, keys);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectOutputKeys(child, keys);
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keyContainsToken(key: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`).test(key.toLowerCase());
}

/** assertNoForbiddenKeysInOutput: no sensitive-data key may appear in the report. */
export function assertNoForbiddenKeysInOutput(report: unknown): void {
  const keys: string[] = [];
  collectOutputKeys(report, keys);
  for (const key of keys) {
    for (const token of FORBIDDEN_OUTPUT_KEY_TOKENS) {
      if (keyContainsToken(key, token)) {
        throw new PrivacyRunnerOutputSanitizationError(
          `forbidden output key "${key}" (matches blocked token "${token}")`,
        );
      }
    }
  }
}

/**
 * assertSanitizedRunnerOutput: no CPF/CNPJ-like literal and no email marker in the
 * rendered output. The classifier never returns cell values, so nothing sensitive
 * can reach here — a defense-in-depth check.
 */
export function assertSanitizedRunnerOutput(rendered: string): void {
  if (/\b\d{11}\b/.test(rendered)) {
    throw new PrivacyRunnerOutputSanitizationError('rendered output contains an 11-digit CPF-like literal');
  }
  if (/\b\d{14}\b/.test(rendered)) {
    throw new PrivacyRunnerOutputSanitizationError('rendered output contains a 14-digit CNPJ-like literal');
  }
  if (/\b[A-Z0-9]{14}\b/.test(rendered)) {
    throw new PrivacyRunnerOutputSanitizationError('rendered output contains a 14-char CNPJ-like literal');
  }
  if (rendered.includes(String.fromCharCode(64))) {
    throw new PrivacyRunnerOutputSanitizationError('rendered output contains an email marker');
  }
}

// ─── Report building ─────────────────────────────────────────────────────────

export function buildPrivacyRunnerReport(
  result: BrReceitaCnpjPrivacyClassificationResult,
): PrivacyRunnerReport {
  return {
    ok: result.ok,
    mode: result.mode,
    source_key: result.sourceKey,
    country_code: result.countryCode,
    source_year: result.sourceYear,
    source_period: result.sourcePeriod,
    manifest_validation: result.manifestValidation,
    layout_mode: result.layoutMode,
    max_sample_rows: result.maxSampleRows,
    files_seen: result.filesSeen,
    files_accepted: result.filesAccepted,
    files_rejected: result.filesRejected,
    sample_rows_seen: result.sampleRowsSeen,
    classification_counts: { ...result.classificationCounts },
    exclusion_counts_by_reason: { ...result.exclusionCountsByReason },
    legal_nature_classification_counts: { ...result.legalNatureClassificationCounts },
    positive_company_signal_counts: { ...result.positiveCompanySignalCounts },
    file_reports: result.fileReports.map((r) => ({
      file_type: r.fileType,
      safe_file_label: r.safeFileLabel,
      family: r.family,
      layout_validation: r.layoutValidation,
      sample_rows_seen: r.sampleRowsSeen,
      classification_counts: { ...r.classificationCounts },
      exclusion_counts_by_reason: { ...r.exclusionCountsByReason },
      legal_nature_classification_counts: { ...r.legalNatureClassificationCounts },
      positive_company_signal_counts: { ...r.positiveCompanySignalCounts },
      ...(r.sha256Hash12 !== undefined ? { sha256_hash12: r.sha256Hash12 } : {}),
    })),
    rejection_reasons: result.rejectionReasons,
    full_dataset_processed: false,
    import_executed: false,
    supabase_write: false,
    runtime_integration: false,
    agent1_integration: false,
    safety: SAFETY_ALL_FALSE,
  };
}

// ─── Core run ────────────────────────────────────────────────────────────────

export async function runPrivacyDryRun(options: PrivacyRunnerOptions): Promise<PrivacyRunnerReport> {
  const result = await runBrReceitaCnpjPrivacySafeClassifier({
    manifestPath: options.manifestPath,
    allowLocalManifest: true,
    strict: options.strict,
    maxSampleRowsPerFile: options.maxSampleRows,
    failOnAnyExcluded: options.failOnAnyExcluded,
  });
  return buildPrivacyRunnerReport(result);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function formatReportJson(report: PrivacyRunnerReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatReportText(report: PrivacyRunnerReport): string {
  const lines: string[] = [];
  lines.push('Brazil Receita CNPJ privacy-safe bounded dry-run classifier');
  lines.push(`ok: ${report.ok}`);
  lines.push(`mode: ${report.mode}`);
  lines.push(`source_key: ${report.source_key}`);
  lines.push(`country_code: ${report.country_code}`);
  lines.push(`source_year: ${report.source_year}`);
  lines.push(`source_period: ${report.source_period}`);
  lines.push(`manifest_validation: ${report.manifest_validation}`);
  lines.push(`layout_mode: ${report.layout_mode}`);
  lines.push(`max_sample_rows: ${report.max_sample_rows}`);
  lines.push(`files_seen: ${report.files_seen}`);
  lines.push(`files_accepted: ${report.files_accepted}`);
  lines.push(`files_rejected: ${report.files_rejected}`);
  lines.push(`sample_rows_seen: ${report.sample_rows_seen}`);
  lines.push('classification_counts:');
  for (const [key, value] of Object.entries(report.classification_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('exclusion_counts_by_reason:');
  for (const [key, value] of Object.entries(report.exclusion_counts_by_reason)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('legal_nature_classification_counts:');
  for (const [key, value] of Object.entries(report.legal_nature_classification_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('positive_company_signal_counts:');
  for (const [key, value] of Object.entries(report.positive_company_signal_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push(`rejection_reasons: [${report.rejection_reasons.join(', ')}]`);
  lines.push(`full_dataset_processed: ${report.full_dataset_processed}`);
  lines.push(`import_executed: ${report.import_executed}`);
  lines.push(`supabase_write: ${report.supabase_write}`);
  lines.push('safety:');
  for (const [key, value] of Object.entries(report.safety)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
}

// ─── main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let options: PrivacyRunnerOptions;
  try {
    options = parsePrivacyRunnerArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runPrivacyDryRun(options);
    const rendered = options.format === 'json' ? formatReportJson(report) : formatReportText(report);

    assertNoForbiddenKeysInOutput(report);
    assertSanitizedRunnerOutput(rendered);

    process.stdout.write(`${rendered}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (never when imported by the test file).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('run-br-receita-cnpj-privacy-safe-dry-run.ts')) {
  void main();
}
