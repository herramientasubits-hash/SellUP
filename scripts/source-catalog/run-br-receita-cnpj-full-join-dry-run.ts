/**
 * BR Receita CNPJ — FULL JOIN dry-run runner CLI (BR-SOURCE-11A / 11C Option B).
 *
 * A safe, local, no-write/no-runtime entry point to the full-join dry-run scaffold.
 * It prints ONLY the sanitized, aggregate report produced by the runner core.
 *
 * ── Modes ───────────────────────────────────────────────────────────────────────
 *   --synthetic-fixture            Scores the built-in synthetic fixture in memory,
 *                                  with zero file I/O.
 *   --synthetic-temp-manifest      The BR-SOURCE-11C Option B carve-out. GENERATES a
 *                                  synthetic manifest and synthetic headerless CSVs in
 *                                  a temp workspace this tool creates, runs the local
 *                                  manifest dry-run against ONLY those files, and
 *                                  removes the workspace afterwards. Requires --strict
 *                                  and all four bounded caps.
 *   --manifest <p> --allow-local-manifest --real-manifest-metadata-only
 *                                  The BR-SOURCE-11D-META-IMPL carve-out. Opens ONE real
 *                                  local manifest as a CONTROL DOCUMENT and reports
 *                                  schema-level metadata only. **No file the manifest
 *                                  references is opened or stat-ed, and no row is read.**
 *                                  Requires --strict and both metadata caps.
 *   --manifest <p> --allow-local-manifest
 *                                  Declares REAL local-manifest EXECUTION intent. Still
 *                                  refused by the runner core: a real manifest can never
 *                                  carry synthetic-temp trust, and GATE-1/GATE-2 are not
 *                                  approved — so NO file is ever opened.
 *
 * Exactly one mode must be requested explicitly: a bare invocation is a fail-closed
 * usage error, never a silent default run.
 *
 * ── This CLI NEVER ──────────────────────────────────────────────────────────────
 *   - reads a CSV, a ZIP, or a directory; or any file a manifest references.
 *   - reads a manifest it did not generate itself, EXCEPT the single manifest document
 *     of an explicit `--real-manifest-metadata-only` run.
 *   - accepts a CSV/ZIP payload, a directory, a URL, or a remote location.
 *   - accepts a path under an operator's download or source-data directories.
 *   - accepts a manifest whose basename names a real prepared file set, on any flag.
 *   - reads, samples, or counts a row; or computes a join over real data.
 *   - downloads, unzips, imports, executes, or processes the full dataset.
 *   - opens a Supabase client or performs a production/runtime write.
 *   - touches Agent 1, providers, HubSpot, or Slack.
 *   - echoes the manifest, a filesystem path, a filename, a declared period value, a raw
 *     error message, or a stack trace.
 *   - prints a row, a full CNPJ, a CNPJ básico, a CPF, a name, or a join key.
 *   - writes a report that failed sanitization.
 *   - leaves its synthetic temp workspace behind (cleanup runs in a `finally`).
 *
 * Usage:
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts \
 *     --synthetic-fixture --format json --strict
 *
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts \
 *     --synthetic-temp-manifest --format json --strict \
 *     --max-company-rows 20 --max-establishment-rows 20 \
 *     --max-company-scan-rows 1000 --max-bytes-per-file 1000000
 *
 *   node --import tsx scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts \
 *     --manifest <path-to-manifest-json> --allow-local-manifest \
 *     --real-manifest-metadata-only --format json --strict \
 *     --max-manifest-bytes 1000000 --max-declared-files 20
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunReport,
  type BrazilReceitaFullJoinRunMode,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-dry-run-runner';
import { sanitizeBrazilReceitaFullJoinRenderedOutput } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-output-sanitizer';
import { createBrazilReceitaSyntheticTempManifest } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-temp-manifest';
import {
  BrazilReceitaRealManifestMetadataError,
  createBrazilReceitaRealManifestMetadataReader,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-manifest-metadata-reader';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_FORMATS = ['text', 'json'] as const;
export type FullJoinRunnerFormat = (typeof ALLOWED_FORMATS)[number];

/**
 * Flags that would turn this into a real ingestion / download / import / runtime /
 * full-expansion tool. Their mere presence is a fail-closed error.
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
  'service-role',
  'production',
  'prod',
  'hubspot',
  'slack',
  'provider',
  'url',
  'remote',
  'full',
  'full-dataset',
  'all',
  'runtime',
  'agent1',
  'migrate',
  'write',
] as const;

/**
 * Directory names that indicate an operator's real downloaded / staged dataset. A
 * `--manifest` or `--output` path containing one of these is refused outright, before
 * the runner core is even consulted.
 */
export const FORBIDDEN_PATH_SEGMENTS = [
  'downloads',
  'download',
  'descargas',
  'dados_abertos',
  'dados-abertos',
  'sellup-source-data',
  'sellup_source_data',
  'raw-zips',
  'raw_zips',
  'extracted',
  'manifest-input',
  'manifest_input',
] as const;

/**
 * Manifest FILENAMES that identify a real prepared Receita file set. Refused by name,
 * independently of the directory it sits in.
 */
export const FORBIDDEN_MANIFEST_BASENAMES = [
  'manifest.headerless.json',
  'manifest.real.json',
] as const;

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ForbiddenFullJoinRunnerModeError extends Error {
  constructor(message: string) {
    super(`BRSOURCE11A_FORBIDDEN_FULL_JOIN_MODE: ${message}`);
    this.name = 'ForbiddenFullJoinRunnerModeError';
  }
}

export class UnknownFullJoinRunnerFlagError extends Error {
  constructor(flag: string) {
    super(`BRSOURCE11A_UNKNOWN_FLAG: unrecognized option "--${flag}"`);
    this.name = 'UnknownFullJoinRunnerFlagError';
  }
}

export class FullJoinRunnerOutputSanitizationError extends Error {
  constructor(kinds: readonly string[]) {
    super(`BRSOURCE11A_SENSITIVE_OUTPUT_LEAK: blocked output (${kinds.join(', ')})`);
    this.name = 'FullJoinRunnerOutputSanitizationError';
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface FullJoinRunnerOptions {
  readonly runMode: BrazilReceitaFullJoinRunMode;
  readonly manifestPath: string | null;
  readonly allowLocalManifest: boolean;
  /** True for the Option B carve-out: a self-generated synthetic temp workspace. */
  readonly syntheticTempManifest: boolean;
  /** True for the metadata-only carve-out: ONE real manifest, parsed, no data file read. */
  readonly realManifestMetadataOnly: boolean;
  readonly format: FullJoinRunnerFormat;
  readonly strict: boolean;
  readonly maxCompanyRows: number | null;
  readonly maxEstablishmentRows: number | null;
  readonly maxCompanyScanRows: number | null;
  readonly maxBytesPerFile: number | null;
  readonly maxManifestBytes: number | null;
  readonly maxDeclaredFiles: number | null;
  readonly outputPath: string | null;
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

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
    throw new ForbiddenFullJoinRunnerModeError(
      `option "--${flag}" is not available — this runner never reads CSV/ZIP, downloads, imports, executes, writes to Supabase, runs in production, integrates runtime/Agent 1/providers, or processes the full dataset`,
    );
  }
}

/**
 * Refuses a path that points at an operator's real dataset download area. The offending
 * path is NEVER echoed — only the segment class that tripped the check.
 */
export function assertNoForbiddenPathSegment(label: string, value: string): void {
  const segments = value.toLowerCase().split(/[\\/]+/);
  for (const forbidden of FORBIDDEN_PATH_SEGMENTS) {
    if (segments.includes(forbidden)) {
      throw new ForbiddenFullJoinRunnerModeError(
        `${label} points into a "${forbidden}" directory — this runner never reads or writes an operator's real dataset location`,
      );
    }
  }
}

/**
 * Refuses a manifest whose FILENAME identifies a real prepared Receita file set. The
 * path is never echoed — only the basename class that tripped the check.
 */
export function assertNoForbiddenManifestBasename(value: string): void {
  const basename = path.basename(value).toLowerCase();
  for (const forbidden of FORBIDDEN_MANIFEST_BASENAMES) {
    if (basename === forbidden) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--manifest names a real prepared file set ("${forbidden}") — this runner never opens one`,
      );
    }
  }
}

function parseBoundedInteger(flag: string, value: string, ceiling: number): number {
  if (!/^\d+$/.test(value)) {
    throw new ForbiddenFullJoinRunnerModeError(
      `--${flag} must be a non-negative integer, got "${value}"`,
    );
  }
  const parsed = Number(value);
  if (parsed > ceiling) {
    throw new ForbiddenFullJoinRunnerModeError(
      `--${flag} (${parsed}) is far beyond any bounded dry-run window`,
    );
  }
  return parsed;
}

function parsePositiveInteger(flag: string, value: string): number {
  return parseBoundedInteger(flag, value, BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS);
}

/**
 * Parses the CLI args, fail-closed. Forbidden flags, unknown flags, URL manifests,
 * non-`.json` manifests, download-directory paths, a `--manifest` without
 * `--allow-local-manifest`, and a bare invocation with neither mode all throw before
 * the runner core is consulted.
 */
export function parseFullJoinRunnerArgs(argv: string[]): FullJoinRunnerOptions {
  let syntheticFixture = false;
  let syntheticTempManifest = false;
  let realManifestMetadataOnly = false;
  let manifest: string | null = null;
  let allowLocalManifest = false;
  let format: FullJoinRunnerFormat = 'text';
  let strict = false;
  let maxCompanyRows: number | null = null;
  let maxEstablishmentRows: number | null = null;
  let maxCompanyScanRows: number | null = null;
  let maxBytesPerFile: number | null = null;
  let maxManifestBytes: number | null = null;
  let maxDeclaredFiles: number | null = null;
  let outputPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new UnknownFullJoinRunnerFlagError(token);
    }
    const { flag, inlineValue } = readFlag(token);
    assertNoForbiddenFlag(flag);

    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UnknownFullJoinRunnerFlagError(`${flag} (missing value)`);
      }
      i += 1;
      return next;
    };

    switch (flag) {
      case 'synthetic-fixture':
        syntheticFixture = true;
        break;
      case 'synthetic-temp-manifest':
        syntheticTempManifest = true;
        break;
      case 'real-manifest-metadata-only':
        realManifestMetadataOnly = true;
        break;
      case 'manifest':
        manifest = takeValue();
        break;
      case 'allow-local-manifest':
        allowLocalManifest = true;
        break;
      case 'max-company-rows':
        maxCompanyRows = parsePositiveInteger('max-company-rows', takeValue());
        break;
      case 'max-establishment-rows':
        maxEstablishmentRows = parsePositiveInteger('max-establishment-rows', takeValue());
        break;
      case 'max-company-scan-rows':
        maxCompanyScanRows = parsePositiveInteger('max-company-scan-rows', takeValue());
        break;
      case 'max-bytes-per-file':
        maxBytesPerFile = parseBoundedInteger(
          'max-bytes-per-file',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
        );
        break;
      case 'max-manifest-bytes':
        maxManifestBytes = parseBoundedInteger(
          'max-manifest-bytes',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
        );
        break;
      case 'max-declared-files':
        maxDeclaredFiles = parseBoundedInteger(
          'max-declared-files',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
        );
        break;
      case 'output':
        outputPath = takeValue();
        break;
      case 'format': {
        const value = takeValue();
        if (!(ALLOWED_FORMATS as readonly string[]).includes(value)) {
          throw new UnknownFullJoinRunnerFlagError(`format=${value}`);
        }
        format = value as FullJoinRunnerFormat;
        break;
      }
      case 'strict':
        strict = true;
        break;
      default:
        throw new UnknownFullJoinRunnerFlagError(flag);
    }
  }

  if (manifest !== null) {
    if (!allowLocalManifest) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--manifest requires the explicit --allow-local-manifest flag',
      );
    }
    if (looksLikeUrl(manifest)) {
      throw new ForbiddenFullJoinRunnerModeError('--manifest must be a LOCAL path, never a URL');
    }
    if (path.extname(manifest).toLowerCase() !== '.json') {
      throw new ForbiddenFullJoinRunnerModeError('--manifest must point to a local .json manifest');
    }
    assertNoForbiddenPathSegment('--manifest', manifest);
    assertNoForbiddenManifestBasename(manifest);
  }

  const requestedModes = [syntheticFixture, syntheticTempManifest, manifest !== null].filter(
    Boolean,
  ).length;
  if (requestedModes === 0) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--synthetic-fixture or --synthetic-temp-manifest is required (--manifest <path> --allow-local-manifest declares REAL local-manifest intent, which the runner core still refuses)',
    );
  }
  if (requestedModes > 1) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--synthetic-fixture, --synthetic-temp-manifest and --manifest are mutually exclusive — pick exactly one mode',
    );
  }

  if (realManifestMetadataOnly) {
    // The metadata-only carve-out is manifest-bound, strict-only and fully capped: a
    // metadata-only run without a manifest, without the explicit local-manifest
    // acknowledgement, without strict, or without both caps does not exist. Every
    // omission is refused HERE, before the reader is constructed and before the runner
    // core is consulted.
    if (manifest === null) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--real-manifest-metadata-only requires --manifest <path> — it reads exactly one manifest document',
      );
    }
    if (!allowLocalManifest) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--real-manifest-metadata-only requires the explicit --allow-local-manifest flag',
      );
    }
    if (!strict) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--real-manifest-metadata-only requires --strict — the metadata-only carve-out has no lenient mode',
      );
    }
    const missingMetadataCaps: string[] = [];
    if (maxManifestBytes === null) missingMetadataCaps.push('--max-manifest-bytes');
    if (maxDeclaredFiles === null) missingMetadataCaps.push('--max-declared-files');
    if (missingMetadataCaps.length > 0) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--real-manifest-metadata-only requires every bounded cap (missing: ${missingMetadataCaps.join(', ')})`,
      );
    }
  }

  if (syntheticTempManifest) {
    // Option B is strict-only and fully-capped: a lenient or uncapped synthetic
    // temp-manifest run does not exist, so the omission is refused HERE, before the
    // workspace is created and before the runner core is consulted.
    if (!strict) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--synthetic-temp-manifest requires --strict — the Option B carve-out has no lenient mode',
      );
    }
    const missing: string[] = [];
    if (maxCompanyRows === null) missing.push('--max-company-rows');
    if (maxEstablishmentRows === null) missing.push('--max-establishment-rows');
    if (maxCompanyScanRows === null) missing.push('--max-company-scan-rows');
    if (maxBytesPerFile === null) missing.push('--max-bytes-per-file');
    if (missing.length > 0) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--synthetic-temp-manifest requires every bounded cap (missing: ${missing.join(', ')})`,
      );
    }
  }

  if (outputPath !== null) {
    if (looksLikeUrl(outputPath)) {
      throw new ForbiddenFullJoinRunnerModeError('--output must be a LOCAL path, never a URL');
    }
    assertNoForbiddenPathSegment('--output', outputPath);
    if (isInsideRepository(outputPath)) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--output must resolve OUTSIDE the repository — a dry-run report is never written into the repo',
      );
    }
  }

  return {
    runMode:
      manifest !== null || syntheticTempManifest
        ? 'local_manifest_dry_run'
        : 'synthetic_fixture_only',
    manifestPath: manifest,
    allowLocalManifest: allowLocalManifest || syntheticTempManifest,
    syntheticTempManifest,
    realManifestMetadataOnly,
    format,
    strict,
    maxCompanyRows,
    maxEstablishmentRows,
    maxCompanyScanRows,
    maxBytesPerFile,
    maxManifestBytes,
    maxDeclaredFiles,
    outputPath,
  };
}

// ─── Repository containment ───────────────────────────────────────────────────

/** The repository root, derived from this script's own location (never from cwd). */
export function repositoryRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

/** True when `candidate` resolves inside the repository (report writes are refused). */
export function isInsideRepository(candidate: string): boolean {
  const root = repositoryRoot();
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function formatReportJson(report: BrazilReceitaFullJoinDryRunReport): string {
  return JSON.stringify(report, null, 2);
}

function renderCounts(label: string, counts: Record<string, number>, lines: string[]): void {
  lines.push(`${label}:`);
  for (const [key, value] of Object.entries(counts)) lines.push(`  ${key}: ${value}`);
}

export function formatReportText(report: BrazilReceitaFullJoinDryRunReport): string {
  const lines: string[] = [];
  lines.push('Brazil Receita CNPJ full join dry-run (BR-SOURCE-11A / 11C Option B scaffold)');
  lines.push(`ok: ${report.ok}`);
  lines.push(`mode: ${report.mode}`);
  lines.push(`run_mode: ${report.run_mode}`);
  lines.push(`manifest_trust: ${report.manifest_trust}`);
  lines.push(`option_b_carveout_authorized: ${report.option_b_carveout_authorized}`);
  lines.push(
    `real_manifest_metadata_only_option_b_authorized: ${report.real_manifest_metadata_only_option_b_authorized}`,
  );
  lines.push(`source_key: ${report.source_key}`);
  lines.push(`country_code: ${report.country_code}`);
  lines.push(`source_period: ${report.source_period ?? 'null'}`);
  lines.push('decision_status:');
  for (const [key, value] of Object.entries(report.decision_status)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('run_scope:');
  for (const [key, value] of Object.entries(report.run_scope)) lines.push(`  ${key}: ${value}`);
  lines.push('safety:');
  for (const [key, value] of Object.entries(report.safety)) lines.push(`  ${key}: ${value}`);
  renderCounts('aggregate_counts', report.aggregate_counts, lines);
  renderCounts('eligibility_counts', report.eligibility_counts, lines);
  renderCounts('join_counts', report.join_counts, lines);
  renderCounts('guardrail_counts', report.guardrail_counts, lines);
  lines.push(`manifest_metadata: ${report.manifest_metadata === null ? 'null' : ''}`.trimEnd());
  if (report.manifest_metadata !== null) {
    for (const [key, value] of Object.entries(report.manifest_metadata)) {
      if (key === 'declared_family_counts') continue;
      lines.push(`  ${key}: ${value}`);
    }
    renderCounts('  declared_family_counts', report.manifest_metadata.declared_family_counts, lines);
  }
  lines.push('cleanup:');
  lines.push(`  cleanup_required: ${report.cleanup.cleanup_required}`);
  lines.push(`  cleanup_status: ${report.cleanup.cleanup_status}`);
  lines.push(`  unsafe_artifacts_detected: ${report.cleanup.unsafe_artifacts_detected}`);
  renderCounts('  artifact_counts_by_type', report.cleanup.artifact_counts_by_type, lines);
  renderCounts('  cleanup_error_counts_by_code', report.cleanup.cleanup_error_counts_by_code, lines);
  lines.push('errors:');
  for (const error of report.errors) {
    lines.push(`  ${error.stage}: ${error.error_code}`);
  }
  return lines.join('\n');
}

// ─── Core run ─────────────────────────────────────────────────────────────────

export function runFullJoinDryRun(
  options: FullJoinRunnerOptions,
): BrazilReceitaFullJoinDryRunReport {
  // Option B: GENERATE a synthetic temp workspace, read only that, and release it. The
  // workspace path is chosen by the generator, so this CLI never holds one.
  const workspace = options.syntheticTempManifest
    ? createBrazilReceitaSyntheticTempManifest()
    : null;

  // Metadata-only: build the single-path reader. The path stays inside the reader's
  // closure, so this CLI never hands one to the runner core and never reports one. The
  // reader validates the path and the caps eagerly, so a refused request never opens a
  // descriptor at all.
  const metadataReader =
    options.realManifestMetadataOnly && options.manifestPath !== null
      ? createBrazilReceitaRealManifestMetadataReader({
          manifestPath: options.manifestPath,
          realManifestMetadataOnlyOptionBAuthorized: true,
          maxManifestBytes: options.maxManifestBytes ?? undefined,
          maxDeclaredFiles: options.maxDeclaredFiles ?? undefined,
        })
      : null;

  try {
    return runBrazilReceitaFullJoinDryRun({
      mode: options.runMode,
      // A REAL manifest offered for EXECUTION is DECLARED, never opened: the core refuses
      // it because a real manifest can never carry synthetic-temp trust. Under
      // metadata-only the manifest DOCUMENT is opened by the injected reader — and
      // nothing it references ever is.
      ...(options.manifestPath !== null ? { manifest: { declared: true } } : {}),
      allowLocalManifest: options.allowLocalManifest,
      ...(workspace !== null
        ? {
            manifestTrust: BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
            optionBCarveoutAuthorized: true,
            outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
            localManifestReader: workspace.read,
          }
        : {}),
      ...(metadataReader !== null
        ? {
            manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
            realManifestMetadataOnlyOptionBAuthorized: true,
            outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
            realManifestMetadataReader: metadataReader,
          }
        : {}),
      ...(options.maxManifestBytes !== null ? { maxManifestBytes: options.maxManifestBytes } : {}),
      ...(options.maxDeclaredFiles !== null ? { maxDeclaredFiles: options.maxDeclaredFiles } : {}),
      strict: options.strict,
      ...(options.maxCompanyRows !== null ? { maxCompanyRows: options.maxCompanyRows } : {}),
      ...(options.maxEstablishmentRows !== null
        ? { maxEstablishmentRows: options.maxEstablishmentRows }
        : {}),
      ...(options.maxCompanyScanRows !== null
        ? { maxCompanyScanRows: options.maxCompanyScanRows }
        : {}),
      ...(options.maxBytesPerFile !== null ? { maxBytesPerFile: options.maxBytesPerFile } : {}),
      noWriteMode: true,
      runtimeIntegration: false,
      agent1Integration: false,
      supabaseWrite: false,
      providerCalls: false,
      importExecuted: false,
      productionWrites: false,
    });
  } finally {
    // Cleanup runs on EVERY path, including a thrown error: a synthetic workspace never
    // outlives its run. `dispose` only ever removes the directory it created itself.
    workspace?.dispose();
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let options: FullJoinRunnerOptions;
  try {
    options = parseFullJoinRunnerArgs(argv);
  } catch (err) {
    // Only our own sanitized messages are printed; never a raw/underlying error.
    const message =
      err instanceof ForbiddenFullJoinRunnerModeError || err instanceof UnknownFullJoinRunnerFlagError
        ? err.message
        : 'BRSOURCE11A_ARG_PARSE_FAILED';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = runFullJoinDryRun(options);
    const rendered = options.format === 'json' ? formatReportJson(report) : formatReportText(report);

    // Defense-in-depth: the core already sanitized the report tree; re-check the
    // RENDERED string, so a leak introduced by rendering is still blocked.
    const sanitized = sanitizeBrazilReceitaFullJoinRenderedOutput(rendered);
    if (!sanitized.ok) {
      throw new FullJoinRunnerOutputSanitizationError(sanitized.findings.map((f) => f.kind));
    }

    if (options.outputPath !== null) {
      fs.writeFileSync(options.outputPath, `${rendered}\n`, { encoding: 'utf8' });
    }
    process.stdout.write(`${rendered}\n`);
    if (!report.ok) process.exitCode = 1;
    if (options.strict && report.cleanup.cleanup_required) process.exitCode = 1;
  } catch (err) {
    // Only our own sanitized messages are printed. The metadata reader's message is a
    // fixed refusal CODE and carries no path, filename, or document fragment.
    const message =
      err instanceof FullJoinRunnerOutputSanitizationError ||
      err instanceof BrazilReceitaRealManifestMetadataError
        ? err.message
        : 'BRSOURCE11A_RUN_FAILED';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (never when imported by a test file).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('run-br-receita-cnpj-full-join-dry-run.ts')) {
  void main();
}
