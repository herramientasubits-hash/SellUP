/**
 * BR Receita CNPJ — company↔establishment BOUNDED JOIN dry-run runner (BR-SOURCE-10G).
 *
 * Runs the privacy-safe company↔establishment join dry-run over a LOCAL
 * `official_headerless` Receita CNPJ manifest and prints ONLY sanitized, aggregated
 * join metrics. It is an EXPLICIT, SEPARATE mode from the BR-SOURCE-7 hard-block
 * dry-run and the BR-SOURCE-10E privacy-safe classifier runner: it neither replaces
 * nor weakens them.
 *
 * ── This runner NEVER (fail-closed by construction) ─────────────────────────
 *   - accepts a CSV/ZIP payload, a directory, a URL, or a remote location.
 *   - downloads, unzips, imports, executes, or runs a full/expansion pass.
 *   - opens a Supabase client or performs a production/runtime write.
 *   - touches Agent 1 runtime, providers, HubSpot, or Slack.
 *   - prints a real row, a full CNPJ, a CNPJ básico, a CPF, an email, a phone, an
 *     address, or the JOIN KEY — output is aggregate join metrics only.
 *   - authorizes an import — establishments remain non-importable.
 *
 * A real LOCAL manifest is accepted ONLY behind `--allow-local-manifest`; a URL
 * manifest, a non-`.json` manifest, `--max-company-rows`/`--max-establishment-rows`
 * > 20, `--max-company-scan-rows` above its hard cap, an unrecognized
 * `--sampling-strategy`, or any forbidden ingestion flag is rejected before the
 * dry-run runs. `--fail-on-any-privacy-exclusion` is opt-in; by default the run
 * stays ok even when records are excluded (only a structural/leak/manifest failure
 * makes it fail).
 *
 * BR-SOURCE-10H adds `--sampling-strategy`:
 *   - `first_rows` (default): the BR-SOURCE-10G first-N-of-each-file behaviour.
 *   - `establishment_keys_then_company_probe`: sample establishments first, then
 *     scan a BOUNDED `--max-company-scan-rows` window of empresas for their company
 *     context. Aggregate coverage metrics only; `coverage_is_representative` is
 *     always false and it authorizes no import.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-company-establishment-join-dry-run.ts \
 *     --manifest ./manifest.json --allow-local-manifest --format json --strict \
 *     --sampling-strategy establishment_keys_then_company_probe \
 *     --max-company-rows 20 --max-establishment-rows 20 --max-company-scan-rows 1000
 */

import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-privacy-safe-classifier';
import {
  BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS,
  BR_RECEITA_CNPJ_JOIN_DEFAULT_SAMPLING_STRATEGY,
  BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT,
  BR_RECEITA_CNPJ_JOIN_SAMPLING_STRATEGIES,
  runBrReceitaCnpjCompanyEstablishmentJoinDryRun,
  type BrReceitaCnpjJoinDryRunResult,
  type BrReceitaCnpjJoinSamplingStrategy,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-company-establishment-join-dry-run';

// ─── Constants ───────────────────────────────────────────────────────────────

export const ALLOWED_FORMATS = ['text', 'json'] as const;
export type JoinRunnerFormat = (typeof ALLOWED_FORMATS)[number];

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
  'nome_fantasia',
  'trade_name',
  'cnpj_basico',
  'cnpj_completo',
  'cpf',
  'join_key',
  'company_key',
  'establishment_key',
  'row_hash',
] as const;

/**
 * Output keys that would be an ARRAY / DUMP of join keys rather than an aggregate
 * count, blocked by EXACT match (BR-SOURCE-10H). Kept separate from the substring
 * token list so aggregate COUNT fields such as `establishment_keys_collected_in_memory`
 * and the boolean `establishment_keys_printed` are still allowed — only a bare
 * plural dump (`establishment_keys`, `company_keys`, …) is rejected.
 */
export const FORBIDDEN_EXACT_OUTPUT_KEYS = [
  'establishment_keys',
  'company_keys',
  'join_keys',
  'establishment_key_list',
  'company_key_list',
  'join_key_list',
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ForbiddenJoinRunnerModeError extends Error {
  constructor(message: string) {
    super(`BRSOURCE10G_FORBIDDEN_JOIN_MODE: ${message}`);
    this.name = 'ForbiddenJoinRunnerModeError';
  }
}

export class UnknownJoinRunnerFlagError extends Error {
  constructor(flag: string) {
    super(`BRSOURCE10G_UNKNOWN_FLAG: unrecognized option "--${flag}"`);
    this.name = 'UnknownJoinRunnerFlagError';
  }
}

export class JoinRunnerOutputSanitizationError extends Error {
  constructor(message: string) {
    super(`BRSOURCE10G_SENSITIVE_OUTPUT_LEAK: ${message}`);
    this.name = 'JoinRunnerOutputSanitizationError';
  }
}

// ─── Options / report shapes ─────────────────────────────────────────────────

export interface JoinRunnerOptions {
  readonly manifestPath: string;
  readonly format: JoinRunnerFormat;
  readonly strict: boolean;
  readonly samplingStrategy: BrReceitaCnpjJoinSamplingStrategy;
  readonly maxCompanyRows: number;
  readonly maxEstablishmentRows: number;
  readonly maxCompanyScanRows: number;
  readonly failOnAnyPrivacyExclusion: boolean;
}

export interface JoinRunnerSafety {
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
  readonly join_keys_printed: false;
  readonly establishment_keys_printed: false;
}

const SAFETY_ALL_FALSE: JoinRunnerSafety = {
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
  join_keys_printed: false,
  establishment_keys_printed: false,
};

/** Bounded-scan coverage interpretation (never representative in this hito). */
export interface JoinRunnerCoverageSummary {
  readonly establishments_with_company_context_in_bounded_scan: number;
  readonly establishments_without_company_context_in_bounded_scan: number;
  readonly coverage_scan_limit_reached: boolean;
  readonly coverage_is_representative: false;
}

/** The sanitized, printable report. No full CNPJ, no CNPJ básico, no join key. */
export interface JoinRunnerReport {
  readonly ok: boolean;
  readonly mode: string;
  readonly source_key: string;
  readonly country_code: string;
  readonly source_year: number;
  readonly source_period: string;
  readonly manifest_validation: 'passed' | 'failed';
  readonly layout_mode: string;
  readonly sampling_strategy: string;
  readonly max_company_rows: number;
  readonly max_establishment_rows: number;
  readonly max_company_scan_rows: number;
  readonly companies_sampled: number;
  readonly companies_scanned_for_coverage: number;
  readonly companies_indexed_for_join: number;
  readonly companies_excluded_from_join: number;
  readonly establishments_sampled: number;
  readonly establishment_keys_collected_in_memory: number;
  readonly establishment_keys_printed: false;
  readonly join_counts: Record<string, number>;
  readonly join_reason_counts: Record<string, number>;
  readonly company_classification_counts: Record<string, number>;
  readonly establishment_classification_counts: Record<string, number>;
  readonly coverage_summary: JoinRunnerCoverageSummary;
  readonly rejection_reasons: string[];
  readonly full_dataset_processed: false;
  readonly import_executed: false;
  readonly supabase_write: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly safety: JoinRunnerSafety;
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
    throw new ForbiddenJoinRunnerModeError(
      `option "--${flag}" is not available — this runner never reads CSV/ZIP, downloads, imports, executes, writes to Supabase, runs in production, integrates runtime/Agent 1, or processes the full dataset`,
    );
  }
}

function parseBoundedRows(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ForbiddenJoinRunnerModeError(
      `--${flag} must be a non-negative integer, got "${value}"`,
    );
  }
  const parsed = Number(value);
  if (parsed > BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT) {
    throw new ForbiddenJoinRunnerModeError(
      `--${flag} (${parsed}) exceeds the hard limit of ${BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT}`,
    );
  }
  return parsed;
}

function parseCompanyScanRows(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ForbiddenJoinRunnerModeError(
      `--max-company-scan-rows must be a non-negative integer, got "${value}"`,
    );
  }
  const parsed = Number(value);
  if (parsed > BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT) {
    throw new ForbiddenJoinRunnerModeError(
      `--max-company-scan-rows (${parsed}) exceeds the hard limit of ${BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT}`,
    );
  }
  return parsed;
}

function parseSamplingStrategy(value: string): BrReceitaCnpjJoinSamplingStrategy {
  if (!(BR_RECEITA_CNPJ_JOIN_SAMPLING_STRATEGIES as readonly string[]).includes(value)) {
    throw new ForbiddenJoinRunnerModeError(
      `--sampling-strategy must be one of: ${BR_RECEITA_CNPJ_JOIN_SAMPLING_STRATEGIES.join(', ')} (got "${value}")`,
    );
  }
  return value as BrReceitaCnpjJoinSamplingStrategy;
}

/**
 * Parses the join dry-run runner CLI args. Fail-closed: forbidden flags, unknown
 * flags, URL manifests, non-`.json` manifests, bounded-row flags > 20, and a
 * missing `--manifest`/`--allow-local-manifest` all throw before any read runs.
 */
export function parseJoinRunnerArgs(argv: string[]): JoinRunnerOptions {
  let manifest: string | null = null;
  let allowLocalManifest = false;
  let format: JoinRunnerFormat = 'text';
  let strict = false;
  let samplingStrategy: BrReceitaCnpjJoinSamplingStrategy | null = null;
  let maxCompanyRows: number | null = null;
  let maxEstablishmentRows: number | null = null;
  let maxCompanyScanRows: number | null = null;
  let failOnAnyPrivacyExclusion = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new UnknownJoinRunnerFlagError(token);
    }
    const { flag, inlineValue } = readFlag(token);
    assertNoForbiddenFlag(flag);

    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UnknownJoinRunnerFlagError(`${flag} (missing value)`);
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
      case 'sampling-strategy':
        samplingStrategy = parseSamplingStrategy(takeValue());
        break;
      case 'max-company-rows':
        maxCompanyRows = parseBoundedRows('max-company-rows', takeValue());
        break;
      case 'max-establishment-rows':
        maxEstablishmentRows = parseBoundedRows('max-establishment-rows', takeValue());
        break;
      case 'max-company-scan-rows':
        maxCompanyScanRows = parseCompanyScanRows(takeValue());
        break;
      case 'fail-on-any-privacy-exclusion':
        failOnAnyPrivacyExclusion = true;
        break;
      case 'format': {
        const value = takeValue();
        if (!(ALLOWED_FORMATS as readonly string[]).includes(value)) {
          throw new UnknownJoinRunnerFlagError(`format=${value}`);
        }
        format = value as JoinRunnerFormat;
        break;
      }
      case 'strict':
        strict = true;
        break;
      default:
        throw new UnknownJoinRunnerFlagError(flag);
    }
  }

  if (manifest === null) {
    throw new ForbiddenJoinRunnerModeError(
      '--manifest <path> --allow-local-manifest is required (this is the real-file join dry-run)',
    );
  }
  if (!allowLocalManifest) {
    throw new ForbiddenJoinRunnerModeError(
      '--manifest requires the explicit --allow-local-manifest flag',
    );
  }
  if (looksLikeUrl(manifest)) {
    throw new ForbiddenJoinRunnerModeError('--manifest must be a LOCAL path, never a URL');
  }
  if (path.extname(manifest).toLowerCase() !== '.json') {
    throw new ForbiddenJoinRunnerModeError('--manifest must point to a local .json manifest');
  }

  return {
    manifestPath: manifest,
    format,
    strict,
    samplingStrategy: samplingStrategy ?? BR_RECEITA_CNPJ_JOIN_DEFAULT_SAMPLING_STRATEGY,
    maxCompanyRows: maxCompanyRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
    maxEstablishmentRows: maxEstablishmentRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
    maxCompanyScanRows: maxCompanyScanRows ?? BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS,
    failOnAnyPrivacyExclusion,
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
  const exactBlocked = new Set<string>(FORBIDDEN_EXACT_OUTPUT_KEYS);
  for (const key of keys) {
    if (exactBlocked.has(key.toLowerCase())) {
      throw new JoinRunnerOutputSanitizationError(
        `forbidden output key "${key}" (exact-match join-key dump is never emitted)`,
      );
    }
    for (const token of FORBIDDEN_OUTPUT_KEY_TOKENS) {
      if (keyContainsToken(key, token)) {
        throw new JoinRunnerOutputSanitizationError(
          `forbidden output key "${key}" (matches blocked token "${token}")`,
        );
      }
    }
  }
}

/**
 * assertSanitizedRunnerOutput: no CPF/CNPJ-like literal, no CNPJ-básico-like literal,
 * and no email marker in the rendered output. The join dry-run never returns cell
 * values or the join key, so nothing sensitive can reach here — defense-in-depth.
 */
export function assertSanitizedRunnerOutput(rendered: string): void {
  if (/\b\d{8}\b/.test(rendered)) {
    throw new JoinRunnerOutputSanitizationError(
      'rendered output contains an 8-digit CNPJ-básico-like literal',
    );
  }
  if (/\b\d{11}\b/.test(rendered)) {
    throw new JoinRunnerOutputSanitizationError('rendered output contains an 11-digit CPF-like literal');
  }
  if (/\b\d{14}\b/.test(rendered)) {
    throw new JoinRunnerOutputSanitizationError('rendered output contains a 14-digit CNPJ-like literal');
  }
  if (/\b[A-Z0-9]{14}\b/.test(rendered)) {
    throw new JoinRunnerOutputSanitizationError('rendered output contains a 14-char CNPJ-like literal');
  }
  if (rendered.includes(String.fromCharCode(64))) {
    throw new JoinRunnerOutputSanitizationError('rendered output contains an email marker');
  }
}

// ─── Report building ─────────────────────────────────────────────────────────

export function buildJoinRunnerReport(result: BrReceitaCnpjJoinDryRunResult): JoinRunnerReport {
  return {
    ok: result.ok,
    mode: result.mode,
    source_key: result.sourceKey,
    country_code: result.countryCode,
    source_year: result.sourceYear,
    source_period: result.sourcePeriod,
    manifest_validation: result.manifestValidation,
    layout_mode: result.layoutMode,
    sampling_strategy: result.samplingStrategy,
    max_company_rows: result.maxCompanyRows,
    max_establishment_rows: result.maxEstablishmentRows,
    max_company_scan_rows: result.maxCompanyScanRows,
    companies_sampled: result.companiesSampled,
    companies_scanned_for_coverage: result.companiesScannedForCoverage,
    companies_indexed_for_join: result.companiesIndexedForJoin,
    companies_excluded_from_join: result.companiesExcludedFromJoin,
    establishments_sampled: result.establishmentsSampled,
    establishment_keys_collected_in_memory: result.establishmentKeysCollectedInMemory,
    establishment_keys_printed: false,
    join_counts: { ...result.joinCounts },
    join_reason_counts: { ...result.joinReasonCounts },
    company_classification_counts: { ...result.companyClassificationCounts },
    establishment_classification_counts: { ...result.establishmentClassificationCounts },
    coverage_summary: {
      establishments_with_company_context_in_bounded_scan:
        result.coverageSummary.establishmentsWithCompanyContextInBoundedScan,
      establishments_without_company_context_in_bounded_scan:
        result.coverageSummary.establishmentsWithoutCompanyContextInBoundedScan,
      coverage_scan_limit_reached: result.coverageSummary.coverageScanLimitReached,
      coverage_is_representative: false,
    },
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

export async function runJoinDryRun(options: JoinRunnerOptions): Promise<JoinRunnerReport> {
  const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
    manifestPath: options.manifestPath,
    allowLocalManifest: true,
    strict: options.strict,
    samplingStrategy: options.samplingStrategy,
    maxCompanyRows: options.maxCompanyRows,
    maxEstablishmentRows: options.maxEstablishmentRows,
    maxCompanyScanRows: options.maxCompanyScanRows,
    failOnAnyPrivacyExclusion: options.failOnAnyPrivacyExclusion,
  });
  return buildJoinRunnerReport(result);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function formatReportJson(report: JoinRunnerReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatReportText(report: JoinRunnerReport): string {
  const lines: string[] = [];
  lines.push('Brazil Receita CNPJ company↔establishment bounded join dry-run');
  lines.push(`ok: ${report.ok}`);
  lines.push(`mode: ${report.mode}`);
  lines.push(`source_key: ${report.source_key}`);
  lines.push(`country_code: ${report.country_code}`);
  lines.push(`source_year: ${report.source_year}`);
  lines.push(`source_period: ${report.source_period}`);
  lines.push(`manifest_validation: ${report.manifest_validation}`);
  lines.push(`layout_mode: ${report.layout_mode}`);
  lines.push(`sampling_strategy: ${report.sampling_strategy}`);
  lines.push(`max_company_rows: ${report.max_company_rows}`);
  lines.push(`max_establishment_rows: ${report.max_establishment_rows}`);
  lines.push(`max_company_scan_rows: ${report.max_company_scan_rows}`);
  lines.push(`companies_sampled: ${report.companies_sampled}`);
  lines.push(`companies_scanned_for_coverage: ${report.companies_scanned_for_coverage}`);
  lines.push(`companies_indexed_for_join: ${report.companies_indexed_for_join}`);
  lines.push(`companies_excluded_from_join: ${report.companies_excluded_from_join}`);
  lines.push(`establishments_sampled: ${report.establishments_sampled}`);
  lines.push(
    `establishment_keys_collected_in_memory: ${report.establishment_keys_collected_in_memory}`,
  );
  lines.push(`establishment_keys_printed: ${report.establishment_keys_printed}`);
  lines.push('join_counts:');
  for (const [key, value] of Object.entries(report.join_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('join_reason_counts:');
  for (const [key, value] of Object.entries(report.join_reason_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('company_classification_counts:');
  for (const [key, value] of Object.entries(report.company_classification_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('establishment_classification_counts:');
  for (const [key, value] of Object.entries(report.establishment_classification_counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('coverage_summary:');
  for (const [key, value] of Object.entries(report.coverage_summary)) {
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
  let options: JoinRunnerOptions;
  try {
    options = parseJoinRunnerArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runJoinDryRun(options);
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
if (executedFile.endsWith('run-br-receita-cnpj-company-establishment-join-dry-run.ts')) {
  void main();
}
