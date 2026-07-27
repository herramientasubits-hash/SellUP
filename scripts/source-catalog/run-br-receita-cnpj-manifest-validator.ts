/**
 * BR Receita CNPJ — controlled local manifest validator runner (BR-SOURCE-6).
 *
 * Validates a LOCAL Receita CNPJ manifest and prints a sanitized report. It is a
 * safe boundary tool for a future real-file dry-run: it confirms a file set's
 * identity, layout, and integrity WITHOUT importing, downloading, or reading rows.
 *
 * ── This runner NEVER (fail-closed by construction) ─────────────────────────
 *   - accepts a CSV/ZIP payload, a directory, a URL, or a remote location.
 *   - downloads, unzips, imports, or executes an ingestion.
 *   - opens a Supabase client or performs a production/runtime write.
 *   - touches Agent 1 runtime, providers, HubSpot, or Slack.
 *   - prints a full CNPJ, a CPF, a full local path, or row content.
 *
 * Fixture mode reads the internal synthetic manifest + synthetic CSVs. A real
 * LOCAL manifest is accepted ONLY behind the explicit `--allow-local-manifest`
 * flag; a `--manifest` that is a URL, or any forbidden ingestion flag, is
 * rejected with BRSOURCE6_FORBIDDEN_MANIFEST_MODE before the validator runs.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-manifest-validator.ts --fixture synthetic-manifest --format text --strict
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-manifest-validator.ts --fixture synthetic-manifest --format json --strict
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-manifest-validator.ts --manifest ./manifest.json --allow-local-manifest
 */

import * as path from 'node:path';

import { validateBrReceitaCnpjLocalManifest } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-manifest-validator';
import type { BrReceitaCnpjManifestValidationResult } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-manifest';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The only fixture the runner accepts — the internal synthetic manifest. */
export const SYNTHETIC_MANIFEST_FIXTURE = 'synthetic-manifest' as const;

/** Output formats. */
export const ALLOWED_FORMATS = ['text', 'json'] as const;
export type ManifestRunnerFormat = (typeof ALLOWED_FORMATS)[number];

/** The internal synthetic manifest path (resolved from this module's location). */
export const SYNTHETIC_MANIFEST_PATH = path.resolve(
  __dirname,
  'fixtures',
  'br-receita-cnpj-synthetic',
  'manifest.synthetic.json',
);

/**
 * Flags that would turn this into a real ingestion / download / import / runtime
 * tool. Their mere presence is a fail-closed error — the runner has NO code path
 * for them.
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
  'complemento',
  'bairro',
  'cep',
  'raw_row',
  'original_row',
  'full_row',
  'full_path',
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Raised when a forbidden manifest mode (URL / CSV / ZIP / download / import / …) is requested. */
export class ForbiddenManifestModeError extends Error {
  constructor(message: string) {
    super(`BRSOURCE6_FORBIDDEN_MANIFEST_MODE: ${message}`);
    this.name = 'ForbiddenManifestModeError';
  }
}

/** Raised for an unrecognized flag (fail-closed: unknown input is never guessed). */
export class UnknownRunnerFlagError extends Error {
  constructor(flag: string) {
    super(`BRSOURCE6_UNKNOWN_FLAG: unrecognized option "--${flag}"`);
    this.name = 'UnknownRunnerFlagError';
  }
}

/** Raised when a sanitized-output invariant is violated (defensive). */
export class RunnerOutputSanitizationError extends Error {
  constructor(message: string) {
    super(`BRSOURCE6_OUTPUT_SANITIZATION: ${message}`);
    this.name = 'RunnerOutputSanitizationError';
  }
}

// ─── Options / report shapes ─────────────────────────────────────────────────

export interface ManifestRunnerOptions {
  readonly source: 'fixture' | 'local-manifest';
  /** Absolute/relative local manifest path (fixture path when source === 'fixture'). */
  readonly manifestPath: string;
  readonly format: ManifestRunnerFormat;
  readonly strict: boolean;
}

export interface ManifestRunnerSafety {
  readonly dataset_download: false;
  readonly supabase_write: false;
  readonly production_import: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly hubspot: false;
  readonly slack: false;
  readonly live_prospect_generation: false;
}

const SAFETY_ALL_FALSE: ManifestRunnerSafety = {
  dataset_download: false,
  supabase_write: false,
  production_import: false,
  runtime_integration: false,
  agent1_integration: false,
  hubspot: false,
  slack: false,
  live_prospect_generation: false,
};

/** The sanitized, printable report. No full CNPJ, no full path, no row content. */
export interface ManifestRunnerReport {
  readonly mode: 'local_manifest_validation';
  readonly fixture: typeof SYNTHETIC_MANIFEST_FIXTURE | 'local-manifest';
  readonly ok: boolean;
  readonly source_key: string;
  readonly source_year: number;
  readonly source_period: string;
  readonly files_seen: number;
  readonly files_accepted: number;
  readonly files_rejected: number;
  readonly layout_validation: 'passed' | 'failed';
  /** Non-reversible 12-hex file hashes. */
  readonly file_hashes: string[];
  readonly rejection_reasons: string[];
  readonly safety: ManifestRunnerSafety;
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

/** assertNoForbiddenFlag: no forbidden ingestion/runtime flag may be present. */
export function assertNoForbiddenFlag(flag: string): void {
  if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag.toLowerCase())) {
    throw new ForbiddenManifestModeError(
      `option "--${flag}" is not available — this runner never reads CSV/ZIP, downloads, imports, executes, writes to Supabase, or runs in production`,
    );
  }
}

/**
 * Parses the manifest runner CLI args. Fail-closed: forbidden flags, unknown
 * flags, URL manifests, and a `--manifest` without `--allow-local-manifest` all
 * throw before any validation runs.
 */
export function parseManifestRunnerArgs(argv: string[]): ManifestRunnerOptions {
  let fixture: string | null = null;
  let manifest: string | null = null;
  let allowLocalManifest = false;
  let format: ManifestRunnerFormat = 'text';
  let strict = false;

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
          throw new ForbiddenManifestModeError(
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
      case 'format': {
        const value = takeValue();
        if (!(ALLOWED_FORMATS as readonly string[]).includes(value)) {
          throw new UnknownRunnerFlagError(`format=${value}`);
        }
        format = value as ManifestRunnerFormat;
        break;
      }
      case 'strict':
        strict = true;
        break;
      default:
        throw new UnknownRunnerFlagError(flag);
    }
  }

  if (manifest !== null) {
    if (fixture !== null) {
      throw new ForbiddenManifestModeError('use either --fixture or --manifest, not both');
    }
    if (!allowLocalManifest) {
      throw new ForbiddenManifestModeError(
        '--manifest requires the explicit --allow-local-manifest flag',
      );
    }
    if (looksLikeUrl(manifest)) {
      throw new ForbiddenManifestModeError('--manifest must be a LOCAL path, never a URL');
    }
    if (path.extname(manifest).toLowerCase() !== '.json') {
      throw new ForbiddenManifestModeError('--manifest must point to a local .json manifest');
    }
    return { source: 'local-manifest', manifestPath: manifest, format, strict };
  }

  if (allowLocalManifest) {
    throw new ForbiddenManifestModeError('--allow-local-manifest requires a --manifest path');
  }

  if (fixture === null) {
    throw new ForbiddenManifestModeError(
      `--fixture ${SYNTHETIC_MANIFEST_FIXTURE} is required (or --manifest <path> --allow-local-manifest)`,
    );
  }

  return { source: 'fixture', manifestPath: SYNTHETIC_MANIFEST_PATH, format, strict };
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
 * start/end of the key or by a non-alphanumeric character). This avoids false
 * positives such as "cep" inside "files_accepted" while still catching real
 * leaks like "correio_eletronico" or "ddd_1".
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
 * assertSanitizedRunnerOutput: no full CNPJ literal in output. Uses a 14-position
 * bound (a full CNPJ is 14 chars); the 12-hex file hashes are shorter and cannot
 * match. The validator never reads rows, so no CPF/CNPJ value can reach here — a
 * defense-in-depth check, not the primary guarantee.
 */
export function assertSanitizedRunnerOutput(rendered: string): void {
  if (/\b\d{14}\b/.test(rendered)) {
    throw new RunnerOutputSanitizationError('rendered output contains a 14-digit CNPJ-like literal');
  }
  if (/\b[A-Z0-9]{14}\b/.test(rendered)) {
    throw new RunnerOutputSanitizationError('rendered output contains a 14-char CNPJ-like literal');
  }
}

// ─── Report building ─────────────────────────────────────────────────────────

export function buildManifestRunnerReport(
  options: ManifestRunnerOptions,
  result: BrReceitaCnpjManifestValidationResult,
): ManifestRunnerReport {
  const layoutFailed = result.fileReports.some((r) => r.layoutValidation === 'failed');
  const fileHashes = result.fileReports
    .map((r) => r.sha256Hash12)
    .filter((h): h is string => typeof h === 'string');

  const rejectionReasons: string[] = [];
  if (result.reasonCode) rejectionReasons.push(result.reasonCode);
  for (const r of result.fileReports) {
    if (r.status === 'rejected' && r.reasonCode) {
      rejectionReasons.push(`${r.fileType}:${r.reasonCode}`);
    }
  }

  return {
    mode: 'local_manifest_validation',
    fixture: options.source === 'fixture' ? SYNTHETIC_MANIFEST_FIXTURE : 'local-manifest',
    ok: result.ok,
    source_key: result.sourceKey,
    source_year: result.sourceYear,
    source_period: result.sourcePeriod,
    files_seen: result.filesSeen,
    files_accepted: result.filesAccepted,
    files_rejected: result.filesRejected,
    layout_validation: layoutFailed ? 'failed' : 'passed',
    file_hashes: fileHashes,
    rejection_reasons: rejectionReasons,
    safety: SAFETY_ALL_FALSE,
  };
}

// ─── Core run ────────────────────────────────────────────────────────────────

export async function runManifestValidator(options: ManifestRunnerOptions): Promise<ManifestRunnerReport> {
  const result = await validateBrReceitaCnpjLocalManifest({
    manifestPath: options.manifestPath,
    strict: options.strict,
    allowRealLocalFiles: true,
  });
  return buildManifestRunnerReport(options, result);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function formatReportText(report: ManifestRunnerReport): string {
  const lines: string[] = [];
  lines.push('Brazil Receita CNPJ local manifest validation');
  lines.push(`mode: ${report.mode}`);
  lines.push(`fixture: ${report.fixture}`);
  lines.push(`ok: ${report.ok}`);
  lines.push(`source_key: ${report.source_key}`);
  lines.push(`source_year: ${report.source_year}`);
  lines.push(`source_period: ${report.source_period}`);
  lines.push(`files_seen: ${report.files_seen}`);
  lines.push(`files_accepted: ${report.files_accepted}`);
  lines.push(`files_rejected: ${report.files_rejected}`);
  lines.push(`layout_validation: ${report.layout_validation}`);
  lines.push(`file_hashes: [${report.file_hashes.join(', ')}]`);
  lines.push(`rejection_reasons: [${report.rejection_reasons.join(', ')}]`);
  lines.push('safety:');
  for (const [key, value] of Object.entries(report.safety)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
}

export function formatReportJson(report: ManifestRunnerReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let options: ManifestRunnerOptions;
  try {
    options = parseManifestRunnerArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runManifestValidator(options);
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
if (executedFile.endsWith('run-br-receita-cnpj-manifest-validator.ts')) {
  void main();
}
