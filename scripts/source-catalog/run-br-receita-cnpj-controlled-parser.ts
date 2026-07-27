/**
 * BR Receita CNPJ — controlled local/sample parser runner (BR-SOURCE-3).
 *
 * Runs the ALREADY-MERGED offline BR Receita CNPJ parser (BR-SOURCE-2) against
 * the connector's SYNTHETIC fixtures and prints a sanitized summary. This is an
 * operational smoke tool: repeatable, deterministic, and safe.
 *
 * ── This runner NEVER (fail-closed by construction) ─────────────────────────
 *   - downloads or reads a real Receita dataset (no ZIP/CSV, no fetch, no fs read).
 *   - accepts an external input path / directory.
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - imports data, runs a production import, or performs live enrichment.
 *   - touches Agent 1 runtime, providers, HubSpot, or Slack.
 *   - prints a full CNPJ, a CPF, contact fields, or fine-grained address.
 *
 * It is a PURE in-memory transform over `sampleParserInput()` fixtures. Any
 * forbidden runtime mode (input path, download, import, execute, supabase,
 * production, hubspot, …) is rejected before the parser is ever invoked.
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-controlled-parser.ts --fixture synthetic
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-controlled-parser.ts --fixture synthetic --format json
 */

import {
  buildBrReceitaCnpjSnapshotRows,
  buildBrazilCnpjHash12,
  sampleParserInput,
  type BrReceitaCnpjParserInput,
  type BrReceitaCnpjParserResult,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj';

// ─── Hard limits ─────────────────────────────────────────────────────────────

/** Ceiling on `--max-rows`; the controlled runner never processes more. */
export const MAX_ROWS_LIMIT = 10 as const;

/** The only fixture the runner accepts — 100% synthetic, no real data. */
export const ALLOWED_FIXTURE = 'synthetic' as const;

/** Output formats the runner can render. */
export const ALLOWED_FORMATS = ['text', 'json'] as const;
export type ControlledRunnerFormat = (typeof ALLOWED_FORMATS)[number];

/**
 * Flags that would turn this into a real ingestion/import/runtime tool. Their
 * mere presence is a fail-closed error — the runner has NO code path for them.
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
] as const;

/**
 * Tokens that must NEVER appear as a key in the runner's rendered output. These
 * name personal-data / fine-address concepts the parser already excludes; the
 * runner asserts they never leak into its summary. Listing them here is a
 * blocklist declaration, not output data.
 */
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
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Raised when a forbidden runtime mode (input/download/import/execute/…) is requested. */
export class ForbiddenRuntimeModeError extends Error {
  constructor(message: string) {
    super(`BRSOURCE3_FORBIDDEN_RUNTIME_MODE: ${message}`);
    this.name = 'ForbiddenRuntimeModeError';
  }
}

/** Raised for an unrecognized flag (fail-closed: unknown input is never guessed). */
export class UnknownRunnerFlagError extends Error {
  constructor(flag: string) {
    super(`BRSOURCE3_UNKNOWN_FLAG: unrecognized option "--${flag}"`);
    this.name = 'UnknownRunnerFlagError';
  }
}

/** Raised when `--max-rows` is invalid or exceeds MAX_ROWS_LIMIT. */
export class MaxRowsLimitError extends Error {
  constructor(message: string) {
    super(`BRSOURCE3_MAX_ROWS_LIMIT: ${message}`);
    this.name = 'MaxRowsLimitError';
  }
}

/** Raised when a sanitized-output invariant is violated (defensive). */
export class RunnerOutputSanitizationError extends Error {
  constructor(message: string) {
    super(`BRSOURCE3_OUTPUT_SANITIZATION: ${message}`);
    this.name = 'RunnerOutputSanitizationError';
  }
}

// ─── Options / report shapes ──────────────────────────────────────────────────

export interface ControlledRunnerOptions {
  readonly fixture: typeof ALLOWED_FIXTURE;
  readonly format: ControlledRunnerFormat;
  /** Optional cap on establishment rows fed to the parser (1..MAX_ROWS_LIMIT). */
  readonly maxRows: number | null;
  readonly strict: boolean;
}

/** All-false safety block asserted on every run. */
export interface ControlledRunnerSafety {
  readonly dataset_download: false;
  readonly supabase_write: false;
  readonly production_import: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly hubspot: false;
  readonly slack: false;
  readonly import: false;
  readonly runtime: false;
  readonly live_prospect_generation: false;
}

export interface ControlledRunnerRejection {
  readonly reason: string;
  /** hash12 or masked — NEVER a full CNPJ. */
  readonly safe_identifier: string;
}

/** The sanitized, printable report. Contains no full CNPJ and no personal data. */
export interface ControlledRunnerReport {
  readonly mode: 'fixture';
  readonly fixture: typeof ALLOWED_FIXTURE;
  readonly source_key: string;
  readonly source_year: number;
  readonly total_establishment_rows: number;
  readonly snapshots_created: number;
  readonly rejected_rows: number;
  /** Non-reversible 12-hex hashes of accepted CNPJs. */
  readonly valid_cnpj_hashes: string[];
  readonly rejection_reasons: ControlledRunnerRejection[];
  readonly distinct_record_identity_keys: number;
  readonly mei_flagged_rows: number;
  readonly safety: ControlledRunnerSafety;
}

export interface ControlledRunnerRunResult {
  readonly report: ControlledRunnerReport;
  /**
   * Full CNPJ strings present in the fixture input/output — kept ONLY so the
   * internal leak scan can confirm none of them appears in the rendered output.
   * NEVER printed.
   */
  readonly sensitiveFullCnpjs: string[];
}

const SAFETY_ALL_FALSE: ControlledRunnerSafety = {
  dataset_download: false,
  supabase_write: false,
  production_import: false,
  runtime_integration: false,
  agent1_integration: false,
  hubspot: false,
  slack: false,
  import: false,
  runtime: false,
  live_prospect_generation: false,
};

// ─── Guards (Task 6) ──────────────────────────────────────────────────────────

/** assertFixtureModeOnly: the runner only ever operates on the synthetic fixture. */
export function assertFixtureModeOnly(fixture: string): asserts fixture is typeof ALLOWED_FIXTURE {
  if (fixture !== ALLOWED_FIXTURE) {
    throw new ForbiddenRuntimeModeError(
      `only "--fixture ${ALLOWED_FIXTURE}" is supported; got "${fixture}"`,
    );
  }
}

/** assertNoExternalInputOptions: no forbidden ingestion/runtime flag may be present. */
export function assertNoExternalInputOptions(flag: string): void {
  const normalized = flag.toLowerCase();
  if ((FORBIDDEN_FLAGS as readonly string[]).includes(normalized)) {
    throw new ForbiddenRuntimeModeError(
      `option "--${flag}" is not available — this runner never reads external input, downloads, imports, writes to Supabase, or runs in production`,
    );
  }
}

/** assertMaxRowsLimit: `--max-rows` must be an integer in 1..MAX_ROWS_LIMIT. */
export function assertMaxRowsLimit(maxRows: number): void {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new MaxRowsLimitError(`--max-rows must be a positive integer, got "${maxRows}"`);
  }
  if (maxRows > MAX_ROWS_LIMIT) {
    throw new MaxRowsLimitError(
      `--max-rows (${maxRows}) exceeds the hard limit of ${MAX_ROWS_LIMIT}`,
    );
  }
}

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

/** assertNoForbiddenKeysInOutput: no sensitive-data key may appear in the report object. */
export function assertNoForbiddenKeysInOutput(report: unknown): void {
  const keys: string[] = [];
  collectOutputKeys(report, keys);
  for (const key of keys) {
    const lower = key.toLowerCase();
    for (const token of FORBIDDEN_OUTPUT_KEY_TOKENS) {
      if (lower === token || lower.includes(token)) {
        throw new RunnerOutputSanitizationError(
          `forbidden output key "${key}" (matches blocked token "${token}")`,
        );
      }
    }
  }
}

/** assertSanitizedRunnerOutput: the rendered output must not leak any full CNPJ. */
export function assertSanitizedRunnerOutput(rendered: string, sensitiveFullCnpjs: string[]): void {
  for (const cnpj of sensitiveFullCnpjs) {
    if (cnpj.length > 0 && rendered.includes(cnpj)) {
      throw new RunnerOutputSanitizationError('rendered output contains a full CNPJ');
    }
  }
  // Defense in depth: no 14-position all-digit CNPJ literal anywhere in the output.
  if (/\b\d{14}\b/.test(rendered)) {
    throw new RunnerOutputSanitizationError('rendered output contains a 14-digit CNPJ-like literal');
  }
}

// ─── Arg parsing ───────────────────────────────────────────────────────────────

function readFlag(token: string): { flag: string; inlineValue: string | null } {
  const withoutDashes = token.replace(/^--/, '');
  const eq = withoutDashes.indexOf('=');
  if (eq >= 0) {
    return { flag: withoutDashes.slice(0, eq), inlineValue: withoutDashes.slice(eq + 1) };
  }
  return { flag: withoutDashes, inlineValue: null };
}

/**
 * Parses the controlled runner CLI args. Fail-closed: forbidden flags and
 * unknown flags throw; the parser never silently ignores an option.
 */
export function parseControlledRunnerArgs(argv: string[]): ControlledRunnerOptions {
  let fixture: string | null = null;
  let format: ControlledRunnerFormat = 'text';
  let maxRows: number | null = null;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new UnknownRunnerFlagError(token);
    }
    const { flag, inlineValue } = readFlag(token);

    // Reject forbidden ingestion/runtime flags before anything else.
    assertNoExternalInputOptions(flag);

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
      case 'fixture':
        fixture = takeValue();
        break;
      case 'format': {
        const value = takeValue();
        if (!(ALLOWED_FORMATS as readonly string[]).includes(value)) {
          throw new UnknownRunnerFlagError(`format=${value}`);
        }
        format = value as ControlledRunnerFormat;
        break;
      }
      case 'max-rows': {
        const value = Number(takeValue());
        assertMaxRowsLimit(value);
        maxRows = value;
        break;
      }
      case 'strict':
        strict = true;
        break;
      default:
        throw new UnknownRunnerFlagError(flag);
    }
  }

  if (fixture === null) {
    throw new ForbiddenRuntimeModeError(
      `--fixture ${ALLOWED_FIXTURE} is required (the runner only accepts synthetic fixtures)`,
    );
  }
  assertFixtureModeOnly(fixture);

  return { fixture, format, maxRows, strict };
}

// ─── Core run ──────────────────────────────────────────────────────────────────

function buildFixtureInput(options: ControlledRunnerOptions): BrReceitaCnpjParserInput {
  const base = sampleParserInput();
  if (options.maxRows === null) return base;
  return {
    ...base,
    estabelecimentosRows: base.estabelecimentosRows.slice(0, options.maxRows),
  };
}

/**
 * Collects every full CNPJ string derivable from the fixture (input rows and
 * accepted snapshots) for the internal leak scan. These are never rendered.
 */
function collectSensitiveFullCnpjs(
  input: BrReceitaCnpjParserInput,
  result: BrReceitaCnpjParserResult,
): string[] {
  const values = new Set<string>();
  for (const row of input.estabelecimentosRows) {
    const basico = typeof row.cnpj_basico === 'string' ? row.cnpj_basico : '';
    const ordem = typeof row.cnpj_ordem === 'string' ? row.cnpj_ordem : '';
    const dv = typeof row.cnpj_dv === 'string' ? row.cnpj_dv : '';
    const full = `${basico}${ordem}${dv}`;
    if (full.length > 0) values.add(full);
  }
  for (const snapshot of result.snapshots) {
    if (snapshot.tax_id.length > 0) values.add(snapshot.tax_id);
    if (snapshot.normalized_tax_id.length > 0) values.add(snapshot.normalized_tax_id);
  }
  return [...values];
}

/**
 * Runs the merged offline parser over the synthetic fixture and returns a
 * sanitized report plus the internal (never-printed) sensitive-value list.
 */
export function runControlledParser(options: ControlledRunnerOptions): ControlledRunnerRunResult {
  assertFixtureModeOnly(options.fixture);

  const input = buildFixtureInput(options);
  const result = buildBrReceitaCnpjSnapshotRows(input);

  const report: ControlledRunnerReport = {
    mode: 'fixture',
    fixture: options.fixture,
    source_key: result.snapshots[0]?.source_key ?? 'br_receita_cnpj_dados_abertos',
    source_year: input.sourceYear,
    total_establishment_rows: result.summary.totalEstablishmentRows,
    snapshots_created: result.summary.acceptedRows,
    rejected_rows: result.summary.rejectedRows,
    valid_cnpj_hashes: result.snapshots.map((s) => buildBrazilCnpjHash12(s.normalized_tax_id)),
    rejection_reasons: result.rejected.map((r) => ({
      reason: r.reasonCode,
      safe_identifier: r.safeIdentifier,
    })),
    distinct_record_identity_keys: result.summary.distinctRecordIdentityKeys,
    mei_flagged_rows: result.summary.meiFlaggedRows,
    safety: SAFETY_ALL_FALSE,
  };

  return { report, sensitiveFullCnpjs: collectSensitiveFullCnpjs(input, result) };
}

// ─── Rendering ──────────────────────────────────────────────────────────────────

export function formatReportText(report: ControlledRunnerReport): string {
  const lines: string[] = [];
  lines.push('Brazil Receita CNPJ controlled parser run');
  lines.push(`mode: ${report.mode}`);
  lines.push(`fixture: ${report.fixture}`);
  lines.push(`source_key: ${report.source_key}`);
  lines.push(`source_year: ${report.source_year}`);
  lines.push(`total_establishment_rows: ${report.total_establishment_rows}`);
  lines.push(`snapshots_created: ${report.snapshots_created}`);
  lines.push(`rejected_rows: ${report.rejected_rows}`);
  lines.push(`distinct_record_identity_keys: ${report.distinct_record_identity_keys}`);
  lines.push(`mei_flagged_rows: ${report.mei_flagged_rows}`);
  lines.push(`valid_cnpj_hashes: [${report.valid_cnpj_hashes.join(', ')}]`);
  lines.push(
    `rejection_reasons: [${report.rejection_reasons
      .map((r) => `${r.reason}:${r.safe_identifier}`)
      .join(', ')}]`,
  );
  lines.push('safety:');
  for (const [key, value] of Object.entries(report.safety)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
}

export function formatReportJson(report: ControlledRunnerReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── main ──────────────────────────────────────────────────────────────────────

export function main(argv: string[] = process.argv.slice(2)): void {
  let options: ControlledRunnerOptions;
  try {
    options = parseControlledRunnerArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const { report, sensitiveFullCnpjs } = runControlledParser(options);
    const rendered =
      options.format === 'json' ? formatReportJson(report) : formatReportText(report);

    // Always run the output guards; --strict additionally asserts the safety block.
    assertNoForbiddenKeysInOutput(report);
    assertSanitizedRunnerOutput(rendered, sensitiveFullCnpjs);
    if (options.strict) {
      for (const [key, value] of Object.entries(report.safety)) {
        if (value !== false) {
          throw new RunnerOutputSanitizationError(`safety flag "${key}" must be false`);
        }
      }
    }

    process.stdout.write(`${rendered}\n`);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (never when imported by the test file,
// whose path ends with ".test.ts", not with the runner filename).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('run-br-receita-cnpj-controlled-parser.ts')) {
  main();
}
