/**
 * BR Receita CNPJ — controlled local real-file dry-run runner (BR-SOURCE-7).
 *
 * Runs a bounded, sanitized dry-run over a LOCAL Receita CNPJ manifest and prints
 * a report. It confirms a file set would parse cleanly — identity, layout, and a
 * BOUNDED structural sample of rows — WITHOUT importing, downloading, writing to
 * Supabase, or processing the full dataset.
 *
 * ── This runner NEVER (fail-closed by construction) ─────────────────────────
 *   - accepts a CSV/ZIP payload, a directory, a URL, or a remote location.
 *   - downloads, unzips, imports, executes, or runs a full/expansion pass.
 *   - opens a Supabase client or performs a production/runtime write.
 *   - touches Agent 1 runtime, providers, HubSpot, or Slack.
 *   - prints a full CNPJ, a CPF, a full local path, or row content.
 *
 * Fixture mode reads the internal synthetic manifest + synthetic CSVs. A real
 * LOCAL manifest is accepted ONLY behind BOTH `--allow-local-manifest` and
 * `--dry-run-only`; a URL manifest, `--max-sample-rows > 20`, or any forbidden
 * ingestion flag is rejected with BRSOURCE7_FORBIDDEN_DRY_RUN_MODE before the
 * dry-run runs.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-local-dry-run.ts --fixture synthetic-manifest --format text --strict
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-local-dry-run.ts --fixture synthetic-manifest --format json --strict
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-local-dry-run.ts --manifest ./manifest.json --allow-local-manifest --dry-run-only --format json --strict --max-sample-rows 5
 */

import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS,
  BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT,
  runBrReceitaCnpjLocalDryRun,
  type BrReceitaCnpjLocalDryRunResult,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-local-dry-run';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The only fixture the runner accepts — the internal synthetic manifest. */
export const SYNTHETIC_MANIFEST_FIXTURE = 'synthetic-manifest' as const;

/** Output formats. */
export const ALLOWED_FORMATS = ['text', 'json'] as const;
export type DryRunRunnerFormat = (typeof ALLOWED_FORMATS)[number];

/** The internal synthetic manifest path (resolved from this module's location). */
export const SYNTHETIC_MANIFEST_PATH = path.resolve(
  __dirname,
  'fixtures',
  'br-receita-cnpj-synthetic',
  'manifest.synthetic.json',
);

/**
 * Flags that would turn this into a real ingestion / download / import / runtime
 * / full-expansion tool. Their mere presence is a fail-closed error — the runner
 * has NO code path for them.
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
] as const;

/** Tokens that must NEVER appear as a key in the rendered output (defensive). */
export const FORBIDDEN_OUTPUT_KEY_TOKENS = [
  'socios',
  'qsa',
  'cpf',
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
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Raised when a forbidden dry-run mode (URL / CSV / ZIP / download / import / bad limit) is requested. */
export class ForbiddenDryRunModeError extends Error {
  constructor(message: string) {
    super(`BRSOURCE7_FORBIDDEN_DRY_RUN_MODE: ${message}`);
    this.name = 'ForbiddenDryRunModeError';
  }
}

/** Raised for an unrecognized flag (fail-closed: unknown input is never guessed). */
export class UnknownRunnerFlagError extends Error {
  constructor(flag: string) {
    super(`BRSOURCE7_UNKNOWN_FLAG: unrecognized option "--${flag}"`);
    this.name = 'UnknownRunnerFlagError';
  }
}

/** Raised when a sanitized-output invariant is violated (defensive). */
export class RunnerOutputSanitizationError extends Error {
  constructor(message: string) {
    super(`BRSOURCE7_OUTPUT_SANITIZATION: ${message}`);
    this.name = 'RunnerOutputSanitizationError';
  }
}

// ─── Options / report shapes ─────────────────────────────────────────────────

export interface DryRunRunnerOptions {
  readonly source: 'fixture' | 'local-manifest';
  /** Absolute/relative local manifest path (fixture path when source === 'fixture'). */
  readonly manifestPath: string;
  readonly format: DryRunRunnerFormat;
  readonly strict: boolean;
  readonly maxSampleRows: number;
}

export interface DryRunRunnerSafety {
  readonly dataset_download: false;
  readonly full_dataset_processed: false;
  readonly import_executed: false;
  readonly supabase_write: false;
  readonly production_import: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly hubspot: false;
  readonly slack: false;
  readonly live_prospect_generation: false;
}

const SAFETY_ALL_FALSE: DryRunRunnerSafety = {
  dataset_download: false,
  full_dataset_processed: false,
  import_executed: false,
  supabase_write: false,
  production_import: false,
  runtime_integration: false,
  agent1_integration: false,
  hubspot: false,
  slack: false,
  live_prospect_generation: false,
};

/** The sanitized, printable dry-run report. No full CNPJ, no full path, no row content. */
export interface DryRunRunnerReport {
  readonly mode: 'local_real_file_dry_run';
  readonly fixture: typeof SYNTHETIC_MANIFEST_FIXTURE | 'local-manifest';
  readonly ok: boolean;
  readonly source_key: string;
  readonly country_code: string;
  readonly source_year: number;
  readonly source_period: string;
  readonly manifest_validation: 'passed' | 'failed';
  readonly files_seen: number;
  readonly files_accepted: number;
  readonly files_rejected: number;
  readonly sample_rows_read: number;
  readonly sample_rows_accepted_for_structure: number;
  readonly sample_rows_rejected_for_structure: number;
  readonly full_dataset_processed: false;
  readonly import_executed: false;
  readonly supabase_write: false;
  /** Non-reversible 12-hex file hashes. */
  readonly file_hashes: string[];
  readonly rejection_reasons: string[];
  readonly safety: DryRunRunnerSafety;
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

/** assertNoForbiddenFlag: no forbidden ingestion/runtime/expansion flag may be present. */
export function assertNoForbiddenFlag(flag: string): void {
  if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag.toLowerCase())) {
    throw new ForbiddenDryRunModeError(
      `option "--${flag}" is not available — this runner never reads CSV/ZIP, downloads, imports, executes, writes to Supabase, runs in production, or processes the full dataset`,
    );
  }
}

function parseMaxSampleRows(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ForbiddenDryRunModeError(`--max-sample-rows must be a non-negative integer, got "${value}"`);
  }
  const parsed = Number(value);
  if (parsed > BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT) {
    throw new ForbiddenDryRunModeError(
      `--max-sample-rows (${parsed}) exceeds the hard limit of ${BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT}`,
    );
  }
  return parsed;
}

/**
 * Parses the dry-run runner CLI args. Fail-closed: forbidden flags, unknown flags,
 * URL manifests, `--max-sample-rows > 20`, and a `--manifest` without BOTH
 * `--allow-local-manifest` and `--dry-run-only` all throw before any read runs.
 */
export function parseDryRunRunnerArgs(argv: string[]): DryRunRunnerOptions {
  let fixture: string | null = null;
  let manifest: string | null = null;
  let allowLocalManifest = false;
  let dryRunOnly = false;
  let format: DryRunRunnerFormat = 'text';
  let strict = false;
  let maxSampleRows: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new UnknownRunnerFlagError(token);
    }
    const { flag, inlineValue } = readFlag(token);
    assertNoForbiddenFlag(flag);

    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UnknownRunnerFlagError(`${flag} (missing value)`);
      }
      i += 1;
      return next;
    };

    switch (flag) {
      case 'fixture': {
        const value = takeValue();
        if (value !== SYNTHETIC_MANIFEST_FIXTURE) {
          throw new ForbiddenDryRunModeError(
            `only "--fixture ${SYNTHETIC_MANIFEST_FIXTURE}" is supported; got "${value}"`,
          );
        }
        fixture = value;
        break;
      }
      case 'manifest':
        manifest = takeValue();
        break;
      case 'allow-local-manifest':
        allowLocalManifest = true;
        break;
      case 'dry-run-only':
        dryRunOnly = true;
        break;
      case 'max-sample-rows':
        maxSampleRows = parseMaxSampleRows(takeValue());
        break;
      case 'format': {
        const value = takeValue();
        if (!(ALLOWED_FORMATS as readonly string[]).includes(value)) {
          throw new UnknownRunnerFlagError(`format=${value}`);
        }
        format = value as DryRunRunnerFormat;
        break;
      }
      case 'strict':
        strict = true;
        break;
      default:
        throw new UnknownRunnerFlagError(flag);
    }
  }

  const resolvedMaxSampleRows = maxSampleRows ?? BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS;

  if (manifest !== null) {
    if (fixture !== null) {
      throw new ForbiddenDryRunModeError('use either --fixture or --manifest, not both');
    }
    if (!allowLocalManifest) {
      throw new ForbiddenDryRunModeError('--manifest requires the explicit --allow-local-manifest flag');
    }
    if (!dryRunOnly) {
      throw new ForbiddenDryRunModeError('--manifest requires the explicit --dry-run-only flag');
    }
    if (looksLikeUrl(manifest)) {
      throw new ForbiddenDryRunModeError('--manifest must be a LOCAL path, never a URL');
    }
    if (path.extname(manifest).toLowerCase() !== '.json') {
      throw new ForbiddenDryRunModeError('--manifest must point to a local .json manifest');
    }
    return { source: 'local-manifest', manifestPath: manifest, format, strict, maxSampleRows: resolvedMaxSampleRows };
  }

  if (allowLocalManifest || dryRunOnly) {
    throw new ForbiddenDryRunModeError('--allow-local-manifest / --dry-run-only require a --manifest path');
  }

  if (fixture === null) {
    throw new ForbiddenDryRunModeError(
      `--fixture ${SYNTHETIC_MANIFEST_FIXTURE} is required (or --manifest <path> --allow-local-manifest --dry-run-only)`,
    );
  }

  return {
    source: 'fixture',
    manifestPath: SYNTHETIC_MANIFEST_PATH,
    format,
    strict,
    maxSampleRows: resolvedMaxSampleRows,
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

/**
 * True when `token` appears in `key` as a whole delimited segment (bounded by the
 * start/end of the key or by a non-alphanumeric character). Avoids false positives
 * such as "cep" inside "files_accepted" while catching real leaks like
 * "correio_eletronico" or "ddd_1".
 */
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
        throw new RunnerOutputSanitizationError(
          `forbidden output key "${key}" (matches blocked token "${token}")`,
        );
      }
    }
  }
}

/**
 * assertSanitizedRunnerOutput: no CPF/CNPJ-like literal in output. Bounds an
 * 11-digit (CPF) or 14-digit/char (CNPJ) run. The dry-run never returns cell
 * values, so nothing sensitive can reach here — a defense-in-depth check.
 */
export function assertSanitizedRunnerOutput(rendered: string): void {
  if (/\b\d{11}\b/.test(rendered)) {
    throw new RunnerOutputSanitizationError('rendered output contains an 11-digit CPF-like literal');
  }
  if (/\b\d{14}\b/.test(rendered)) {
    throw new RunnerOutputSanitizationError('rendered output contains a 14-digit CNPJ-like literal');
  }
  if (/\b[A-Z0-9]{14}\b/.test(rendered)) {
    throw new RunnerOutputSanitizationError('rendered output contains a 14-char CNPJ-like literal');
  }
}

// ─── Report building ─────────────────────────────────────────────────────────

export function buildDryRunRunnerReport(
  options: DryRunRunnerOptions,
  result: BrReceitaCnpjLocalDryRunResult,
): DryRunRunnerReport {
  const fileHashes = result.fileReports
    .map((r) => r.sha256Hash12)
    .filter((h): h is string => typeof h === 'string');

  return {
    mode: 'local_real_file_dry_run',
    fixture: options.source === 'fixture' ? SYNTHETIC_MANIFEST_FIXTURE : 'local-manifest',
    ok: result.ok,
    source_key: result.sourceKey,
    country_code: result.countryCode,
    source_year: result.sourceYear,
    source_period: result.sourcePeriod,
    manifest_validation: result.manifestValidation,
    files_seen: result.filesSeen,
    files_accepted: result.filesAccepted,
    files_rejected: result.filesRejected,
    sample_rows_read: result.sampleRowsRead,
    sample_rows_accepted_for_structure: result.sampleRowsAcceptedForStructure,
    sample_rows_rejected_for_structure: result.sampleRowsRejectedForStructure,
    full_dataset_processed: false,
    import_executed: false,
    supabase_write: false,
    file_hashes: fileHashes,
    rejection_reasons: result.rejectionReasons,
    safety: SAFETY_ALL_FALSE,
  };
}

// ─── Core run ────────────────────────────────────────────────────────────────

export async function runDryRun(options: DryRunRunnerOptions): Promise<DryRunRunnerReport> {
  const result = await runBrReceitaCnpjLocalDryRun({
    manifestPath: options.manifestPath,
    allowLocalManifest: true,
    dryRunOnly: true,
    strict: options.strict,
    maxSampleRowsPerFile: options.maxSampleRows,
  });
  return buildDryRunRunnerReport(options, result);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function formatReportText(report: DryRunRunnerReport): string {
  const lines: string[] = [];
  lines.push('Brazil Receita CNPJ local real-file dry-run');
  lines.push(`mode: ${report.mode}`);
  lines.push(`fixture: ${report.fixture}`);
  lines.push(`ok: ${report.ok}`);
  lines.push(`source_key: ${report.source_key}`);
  lines.push(`country_code: ${report.country_code}`);
  lines.push(`source_year: ${report.source_year}`);
  lines.push(`source_period: ${report.source_period}`);
  lines.push(`manifest_validation: ${report.manifest_validation}`);
  lines.push(`files_seen: ${report.files_seen}`);
  lines.push(`files_accepted: ${report.files_accepted}`);
  lines.push(`files_rejected: ${report.files_rejected}`);
  lines.push(`sample_rows_read: ${report.sample_rows_read}`);
  lines.push(`sample_rows_accepted_for_structure: ${report.sample_rows_accepted_for_structure}`);
  lines.push(`sample_rows_rejected_for_structure: ${report.sample_rows_rejected_for_structure}`);
  lines.push(`full_dataset_processed: ${report.full_dataset_processed}`);
  lines.push(`import_executed: ${report.import_executed}`);
  lines.push(`supabase_write: ${report.supabase_write}`);
  lines.push(`file_hashes: [${report.file_hashes.join(', ')}]`);
  lines.push(`rejection_reasons: [${report.rejection_reasons.join(', ')}]`);
  lines.push('safety:');
  for (const [key, value] of Object.entries(report.safety)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
}

export function formatReportJson(report: DryRunRunnerReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let options: DryRunRunnerOptions;
  try {
    options = parseDryRunRunnerArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runDryRun(options);
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

// Only auto-run when executed directly (never when imported by the test file,
// whose path ends with ".test.ts", not with the runner filename).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('run-br-receita-cnpj-local-dry-run.ts')) {
  void main();
}
