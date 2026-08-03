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
 *                                  Requires --strict and both metadata caps. On its own it
 *                                  still refuses an operator's staged directory and a real
 *                                  prepared manifest basename.
 *   … --real-manifest-metadata-execution
 *                                  The BR-SOURCE-11E declaration, valid ONLY together with
 *                                  --real-manifest-metadata-only. Lets the run name the
 *                                  OPERATOR'S OWN prepared manifest document: it relaxes
 *                                  the staging-directory and prepared-basename refusals for
 *                                  --manifest, and NOTHING else. Still one manifest, still
 *                                  metadata-only, still no referenced file, no row, no
 *                                  join, no cap relief; --output keeps every refusal.
 *   … --required-family-probe --required-family-probe-authorized
 *                                  The BR-SOURCE-11F-IMPL Option C carve-out, valid ONLY
 *                                  together with --real-manifest-metadata-only and
 *                                  --real-manifest-metadata-execution-authorized. Opens ONE
 *                                  Empresas file and ONE Estabelecimentos file declared by
 *                                  the manifest, reads at most 64 KB / 20 rows per file and
 *                                  128 KB / 40 rows per run, and reports column-count shape,
 *                                  encoding, delimiter and headerless CLASS LABELS only.
 *                                  Requires --strict and all five probe caps. Opens no
 *                                  catalog file, no Sócios/QSA/CPF file, no ZIP; keeps no
 *                                  row, cell, identifier, filename, path or hash; computes
 *                                  no join and approves no gate.
 *   … --required-family-join-probe --required-family-join-probe-authorized
 *       --real-local-join-dry-run-authorized
 *                                  The BR-SOURCE-11G-IMPL Option C carve-out, valid ONLY
 *                                  together with --real-manifest-metadata-only,
 *                                  --real-manifest-metadata-execution-authorized and
 *                                  --required-family-probe-authorized, and mutually exclusive
 *                                  with --required-family-probe. Opens the SAME two files under
 *                                  the SAME caps, parses ONE field per row — the protected
 *                                  technical join key — holds it in a capped in-memory window,
 *                                  compares, and discards. Reports a coarse match BUCKET
 *                                  (zero | one_or_more | not_reported), where `not_reported` is
 *                                  a GREEN result. Requires --strict, all five probe caps and
 *                                  all four join caps. Prints no join key, no joined row, no
 *                                  joined sample, no join pair, no coverage percentage; makes
 *                                  no coverage claim; hashes nothing; approves no gate.
 *   … --aggregate-join-coverage-signal --aggregate-join-coverage-signal-authorized
 *       --real-local-join-coverage-signal-authorized
 *                                  The BR-SOURCE-11H-IMPL Option C carve-out, valid ONLY together
 *                                  with --real-manifest-metadata-only,
 *                                  --real-manifest-metadata-execution-authorized,
 *                                  --required-family-probe-authorized,
 *                                  --required-family-join-probe-authorized and
 *                                  --real-local-join-dry-run-authorized, and mutually exclusive
 *                                  with both probe modes. Opens the SAME two files and reads the
 *                                  SAME one field position per row, in a materially WIDER bounded
 *                                  window: ≤ 512 KB / ≤ 200 rows per file and ≤ 1,024,000 bytes /
 *                                  ≤ 400 rows per run. Reports a coarse match SIGNAL
 *                                  (zero | one_or_more | not_reported), where both `zero` and
 *                                  `not_reported` are GREEN results. Requires --strict, all five
 *                                  structural caps and all four coverage caps. Prints no join key,
 *                                  no joined row, no joined sample, no join pair, NO EXACT
 *                                  PERCENTAGE and NO FULL-DATASET DENOMINATOR; makes no coverage
 *                                  claim; states `denominator_scope = bounded_window_only`; infers
 *                                  nothing about production readiness; hashes nothing; approves no
 *                                  gate. It is a SIGNAL, never coverage proof or a guarantee.
 *   --manifest <p> --allow-local-manifest
 *                                  Declares REAL local-manifest EXECUTION intent. Still
 *                                  refused by the runner core: a real manifest can never
 *                                  carry synthetic-temp trust, and GATE-1/GATE-2 are not
 *                                  approved — so NO file is ever opened.
 *   --limited-broader-local-execution
 *                                  The BR-SOURCE-11P-IMPL control mode, and the ONLY mode that
 *                                  refuses unconditionally. It declares limited broader local
 *                                  execution intent and evaluates the request against the recorded
 *                                  GATE-2 state (`not_approved`) and the owner cap-ceiling table
 *                                  (empty), then prints the bucketed evidence packet as JSON and
 *                                  exits non-zero. Requires --strict, --aggregate-only,
 *                                  --temp-storage-disabled and all five --no-* invariants; refuses
 *                                  --manifest and --output outright. It holds no path, constructs
 *                                  no reader, opens no descriptor, creates no temp directory,
 *                                  reads no row, computes no coverage and approves no gate — and
 *                                  no argument can make it do any of those. Real limited broader
 *                                  local execution stays impossible by construction, not by
 *                                  configuration.
 *
 * Exactly one mode must be requested explicitly: a bare invocation is a fail-closed
 * usage error, never a silent default run.
 *
 * ── This CLI NEVER ──────────────────────────────────────────────────────────────
 *   - reads a CSV, a ZIP, or a directory; or any file a manifest references.
 *   - reads a manifest it did not generate itself, EXCEPT the single manifest document
 *     of an explicit `--real-manifest-metadata-only` run.
 *   - accepts a CSV/ZIP payload, a directory, a URL, or a remote location.
 *   - accepts a `--manifest` path under an operator's download or source-data directories,
 *     or one whose basename names a real prepared file set, UNLESS the run declares
 *     `--real-manifest-metadata-execution` (BR-SOURCE-11E) — which widens which manifest
 *     DOCUMENT may be named and nothing else. `--output` keeps both refusals on every flag.
 *   - reads, samples, or counts a row, EXCEPT under the two explicit probe carve-outs above.
 *   - computes a join over real data, EXCEPT the ultra-bounded in-memory membership test of an
 *     explicit `--required-family-join-probe` run — which emits a bucket, never a key, a joined
 *     row, a pair, a ratio, or a coverage claim.
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
  BRAZIL_RECEITA_FULL_JOIN_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_PAIRS_EMITTED,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_ROWS_PRINTED,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED,
  BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
  BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED,
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_FILES_OPENED,
  BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_TOTAL_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_PROBE_TRUST,
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
import {
  BrazilReceitaRequiredFamilyProbeError,
  createBrazilReceitaRequiredFamilyProbe,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-required-family-probe';
import {
  BrazilReceitaRequiredFamilyJoinProbeError,
  createBrazilReceitaRequiredFamilyJoinProbe,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-required-family-join-probe';
import {
  BrazilReceitaAggregateJoinCoverageSignalError,
  createBrazilReceitaAggregateJoinCoverageSignal,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-aggregate-join-coverage-signal';
import {
  BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_PARSE_CEILING,
  buildLimitedBroaderLocalExecutionReport,
  type BrazilReceitaLimitedBroaderLocalExecutionReport,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-limited-broader-local-execution';

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
  /**
   * True for the BR-SOURCE-11E declaration: the manifest DOCUMENT may be the operator's own
   * prepared one. Widens which `--manifest` is accepted; widens nothing about the run.
   */
  readonly realManifestMetadataExecution: boolean;
  /** True for the BR-SOURCE-11F-IMPL Option C mode: the ultra-bounded required-family probe. */
  readonly requiredFamilyProbe: boolean;
  /** True when the owner's 11F Option C phrase was declared on THIS invocation. */
  readonly requiredFamilyProbeAuthorized: boolean;
  /** True for the BR-SOURCE-11G-IMPL Option C mode: the ultra-bounded real JOIN probe. */
  readonly requiredFamilyJoinProbe: boolean;
  /** True when the owner's 11G Option C phrase was declared on THIS invocation. */
  readonly requiredFamilyJoinProbeAuthorized: boolean;
  /** True when the bounded join against the operator's own local files was declared. */
  readonly realLocalJoinDryRunAuthorized: boolean;
  readonly maxJoinInputRows: number | null;
  readonly maxJoinKeyValuesInMemory: number | null;
  readonly maxJoinPairsEmitted: number | null;
  readonly maxJoinedRowsPrinted: number | null;
  /** True for the BR-SOURCE-11H-IMPL Option C mode: the aggregate-only coverage SIGNAL. */
  readonly aggregateJoinCoverageSignal: boolean;
  /** True when the owner's 11H Option C phrase was declared on THIS invocation. */
  readonly aggregateJoinCoverageSignalAuthorized: boolean;
  /** True when the wider bounded signal against the operator's own local files was declared. */
  readonly realLocalJoinCoverageSignalAuthorized: boolean;
  readonly maxCoverageInputRows: number | null;
  readonly maxCoverageKeyValuesInMemory: number | null;
  readonly maxCoveragePairsEmitted: number | null;
  readonly maxCoverageRowsPrinted: number | null;
  readonly maxFilesOpened: number | null;
  readonly maxRowsPerFile: number | null;
  readonly maxTotalRows: number | null;
  readonly maxTotalBytes: number | null;
  readonly format: FullJoinRunnerFormat;
  readonly strict: boolean;
  readonly maxCompanyRows: number | null;
  readonly maxEstablishmentRows: number | null;
  readonly maxCompanyScanRows: number | null;
  readonly maxBytesPerFile: number | null;
  readonly maxManifestBytes: number | null;
  readonly maxDeclaredFiles: number | null;
  readonly outputPath: string | null;
  // ── BR-SOURCE-11P-IMPL: the limited broader local execution CONTROL mode ──
  /**
   * True for the BR-SOURCE-11P mode. Always fails closed: it evaluates the request against the
   * recorded gate state and the (empty) owner cap-ceiling table, prints the sanitized evidence
   * packet, and returns a non-zero exit code WITHOUT constructing a reader or opening a file.
   */
  readonly limitedBroaderLocalExecution: boolean;
  /**
   * The new booleans are `boolean | null`, where `null` means the flag was ABSENT. The mode needs
   * to tell "not declared" apart from "declared false", because § 8 requires every safety flag to
   * be explicit — an absent invariant is a refusal, not a default.
   */
  readonly limitedBroaderLocalExecutionAuthorized: boolean | null;
  readonly gate2Approved: boolean | null;
  readonly aggregateOnly: boolean | null;
  readonly tempStorageDisabled: boolean | null;
  readonly noImport: boolean | null;
  readonly noSupabaseWrite: boolean | null;
  readonly noRuntime: boolean | null;
  readonly noAgent1: boolean | null;
  readonly noProviderCalls: boolean | null;
  /** Repeatable `--allowed-family` LABELS. Classified by the control layer, never echoed. */
  readonly allowedFamilies: readonly string[];
  readonly maxFiles: number | null;
  readonly maxFilesPerFamily: number | null;
  readonly maxRuntimeSeconds: number | null;
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
 * Parses a BR-SOURCE-11P boolean flag that may carry an INLINE value: a bare `--flag` declares
 * `true`, `--flag=false` declares `false`, and anything else fails closed.
 *
 * It reads `inlineValue` only and never consumes the following token, so `--no-import --no-runtime`
 * cannot silently swallow the second flag as the first one's value. Any spelling other than the two
 * literals is refused rather than coerced — `--gate2-approved=yes` is a stop, never a `true`.
 */
function parseInlineBoolean(flag: string, inlineValue: string | null): boolean {
  if (inlineValue === null) return true;
  const normalized = inlineValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new ForbiddenFullJoinRunnerModeError(
    `--${flag} accepts only "true" or "false" (or the bare flag, which declares true)`,
  );
}

/**
 * Re-checks the four shared row/byte caps against the TIGHT BR-SOURCE-11F / 11G probe ceilings.
 *
 * The flags are shared by three modes with different ceilings, and a cap flag can arrive before
 * the mode flag that decides which ceiling applies — so parsing accepts the widest ceiling in the
 * tool and each probe mode narrows it here. Without this, declaring the 11H window on an 11F/11G
 * invocation would silently widen a probe that no authorization permits to widen.
 */
function assertProbeWindowCeilings(
  mode: string,
  caps: {
    readonly maxBytesPerFile: number | null;
    readonly maxRowsPerFile: number | null;
    readonly maxTotalRows: number | null;
    readonly maxTotalBytes: number | null;
  },
): void {
  const checks: ReadonlyArray<readonly [string, number | null, number]> = [
    ['--max-bytes-per-file', caps.maxBytesPerFile, BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_BYTES_PER_FILE],
    ['--max-rows-per-file', caps.maxRowsPerFile, BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_ROWS_PER_FILE],
    ['--max-total-rows', caps.maxTotalRows, BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_TOTAL_ROWS],
    ['--max-total-bytes', caps.maxTotalBytes, BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_TOTAL_BYTES],
  ];
  for (const [flag, value, ceiling] of checks) {
    if (value !== null && value > ceiling) {
      throw new ForbiddenFullJoinRunnerModeError(
        `${flag} exceeds the Option C ceiling for ${mode}`,
      );
    }
  }
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
  let realManifestMetadataExecution = false;
  let requiredFamilyProbe = false;
  let requiredFamilyProbeAuthorized = false;
  let requiredFamilyJoinProbe = false;
  let requiredFamilyJoinProbeAuthorized = false;
  let realLocalJoinDryRunAuthorized = false;
  let maxJoinInputRows: number | null = null;
  let maxJoinKeyValuesInMemory: number | null = null;
  let maxJoinPairsEmitted: number | null = null;
  let maxJoinedRowsPrinted: number | null = null;
  let aggregateJoinCoverageSignal = false;
  let aggregateJoinCoverageSignalAuthorized = false;
  let realLocalJoinCoverageSignalAuthorized = false;
  let maxCoverageInputRows: number | null = null;
  let maxCoverageKeyValuesInMemory: number | null = null;
  let maxCoveragePairsEmitted: number | null = null;
  let maxCoverageRowsPrinted: number | null = null;
  let maxFilesOpened: number | null = null;
  let maxRowsPerFile: number | null = null;
  let maxTotalRows: number | null = null;
  let maxTotalBytes: number | null = null;
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
  let limitedBroaderLocalExecution = false;
  let limitedBroaderLocalExecutionAuthorized: boolean | null = null;
  let gate2Approved: boolean | null = null;
  let aggregateOnly: boolean | null = null;
  let tempStorageDisabled: boolean | null = null;
  let noImport: boolean | null = null;
  let noSupabaseWrite: boolean | null = null;
  let noRuntime: boolean | null = null;
  let noAgent1: boolean | null = null;
  let noProviderCalls: boolean | null = null;
  const allowedFamilies: string[] = [];
  let maxFiles: number | null = null;
  let maxFilesPerFamily: number | null = null;
  let maxRuntimeSeconds: number | null = null;

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
      // Both spellings declare the SAME BR-SOURCE-11E authorization. The `-authorized`
      // spelling is the one the BR-SOURCE-11F-IMPL runbook uses; the original is kept so no
      // existing invocation breaks.
      case 'real-manifest-metadata-execution':
      case 'real-manifest-metadata-execution-authorized':
        realManifestMetadataExecution = true;
        break;
      case 'required-family-probe':
        requiredFamilyProbe = true;
        break;
      case 'required-family-probe-authorized':
        requiredFamilyProbeAuthorized = true;
        break;
      case 'required-family-join-probe':
        requiredFamilyJoinProbe = true;
        break;
      case 'required-family-join-probe-authorized':
        requiredFamilyJoinProbeAuthorized = true;
        break;
      case 'real-local-join-dry-run-authorized':
        realLocalJoinDryRunAuthorized = true;
        break;
      case 'max-join-input-rows':
        maxJoinInputRows = parseBoundedInteger(
          'max-join-input-rows',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
        );
        break;
      case 'max-join-key-values-in-memory':
        maxJoinKeyValuesInMemory = parseBoundedInteger(
          'max-join-key-values-in-memory',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
        );
        break;
      // The two zero-EQUALITIES. `parseBoundedInteger` with a ceiling of 0 refuses any positive
      // value outright, so `--max-join-pairs-emitted 1` never reaches the runner: asking for one
      // pair is an unauthorized capability, not a wider probe (11G § 9.1).
      case 'max-join-pairs-emitted':
        maxJoinPairsEmitted = parseBoundedInteger(
          'max-join-pairs-emitted',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED,
        );
        break;
      case 'max-joined-rows-printed':
        maxJoinedRowsPrinted = parseBoundedInteger(
          'max-joined-rows-printed',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED,
        );
        break;
      case 'aggregate-join-coverage-signal':
        aggregateJoinCoverageSignal = true;
        break;
      case 'aggregate-join-coverage-signal-authorized':
        aggregateJoinCoverageSignalAuthorized = true;
        break;
      case 'real-local-join-coverage-signal-authorized':
        realLocalJoinCoverageSignalAuthorized = true;
        break;
      case 'max-coverage-input-rows':
        maxCoverageInputRows = parseBoundedInteger(
          'max-coverage-input-rows',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_INPUT_ROWS,
        );
        break;
      case 'max-coverage-key-values-in-memory':
        maxCoverageKeyValuesInMemory = parseBoundedInteger(
          'max-coverage-key-values-in-memory',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_KEY_VALUES_IN_MEMORY,
        );
        break;
      // The two zero-EQUALITIES. A ceiling of 0 refuses any positive value outright, so
      // `--max-coverage-pairs-emitted 1` never reaches the runner.
      case 'max-coverage-pairs-emitted':
        maxCoveragePairsEmitted = parseBoundedInteger(
          'max-coverage-pairs-emitted',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_PAIRS_EMITTED,
        );
        break;
      case 'max-coverage-rows-printed':
        maxCoverageRowsPrinted = parseBoundedInteger(
          'max-coverage-rows-printed',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_COVERAGE_ROWS_PRINTED,
        );
        break;
      case 'max-files-opened':
        maxFilesOpened = parseBoundedInteger(
          'max-files-opened',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_PROBE_MAX_FILES_OPENED,
        );
        break;
      // The three row/byte caps are shared by three modes with DIFFERENT ceilings, and a flag can
      // arrive before the mode flag that decides which ceiling applies. So parsing accepts the
      // WIDEST ceiling in the tool (BR-SOURCE-11H's) and each mode block below re-checks the value
      // against its own, tighter ceiling — whatever order the flags arrived in. A probe run is
      // therefore bounded exactly as before this milestone.
      case 'max-rows-per-file':
        maxRowsPerFile = parseBoundedInteger(
          'max-rows-per-file',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_ROWS_PER_FILE,
        );
        break;
      case 'max-total-rows':
        maxTotalRows = parseBoundedInteger(
          'max-total-rows',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_ROWS,
        );
        break;
      case 'max-total-bytes':
        maxTotalBytes = parseBoundedInteger(
          'max-total-bytes',
          takeValue(),
          BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_TOTAL_BYTES,
        );
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
      // ── BR-SOURCE-11P-IMPL. The mode flag, its two state ASSERTIONS, the three caps this
      //    milestone adds, the family allowlist and the six invariant declarations.
      //
      //    Two flags from the 11O § 8 sketch are deliberately NOT implemented:
      //      - `--allowed-input-root` and `--manifest-control-file` are PATHS. This mode never
      //        receives one, so no path can reach a layer that might open it (`--manifest` is
      //        refused outright below). That is what makes "no file is opened" provable rather
      //        than merely intended.
      //      - `--forbidden-family` would let a caller NAME the denylist and therefore shrink it.
      //        The person-family block is a module constant instead, so no argument can narrow it.
      case 'limited-broader-local-execution':
        limitedBroaderLocalExecution = true;
        break;
      case 'limited-broader-local-execution-authorized':
        limitedBroaderLocalExecutionAuthorized = parseInlineBoolean(flag, inlineValue);
        break;
      case 'gate2-approved':
        gate2Approved = parseInlineBoolean(flag, inlineValue);
        break;
      case 'aggregate-only':
        aggregateOnly = parseInlineBoolean(flag, inlineValue);
        break;
      case 'temp-storage-disabled':
        tempStorageDisabled = parseInlineBoolean(flag, inlineValue);
        break;
      case 'no-import':
        noImport = parseInlineBoolean(flag, inlineValue);
        break;
      case 'no-supabase-write':
        noSupabaseWrite = parseInlineBoolean(flag, inlineValue);
        break;
      case 'no-runtime':
        noRuntime = parseInlineBoolean(flag, inlineValue);
        break;
      case 'no-agent1':
        noAgent1 = parseInlineBoolean(flag, inlineValue);
        break;
      case 'no-provider-calls':
        noProviderCalls = parseInlineBoolean(flag, inlineValue);
        break;
      case 'allowed-family':
        allowedFamilies.push(takeValue());
        break;
      // The three caps this milestone adds are bounded by a PARSER sanity ceiling only. It
      // authorizes no window: the control layer refuses every stated cap with
      // `cap_ceiling_not_authorized`, because no owner cap maximum is recorded.
      case 'max-files':
        maxFiles = parseBoundedInteger(
          'max-files',
          takeValue(),
          BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_PARSE_CEILING,
        );
        break;
      case 'max-files-per-family':
        maxFilesPerFamily = parseBoundedInteger(
          'max-files-per-family',
          takeValue(),
          BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_PARSE_CEILING,
        );
        break;
      case 'max-runtime-seconds':
        maxRuntimeSeconds = parseBoundedInteger(
          'max-runtime-seconds',
          takeValue(),
          BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_PARSE_CEILING,
        );
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
    // These two refusals — and only these two — are what the BR-SOURCE-11E declaration
    // relaxes, for the manifest DOCUMENT only. The URL and non-`.json` refusals above hold
    // on every flag, `--output` below keeps both refusals unconditionally, and nothing the
    // manifest references is opened or stat-ed on any path.
    if (!realManifestMetadataExecution) {
      assertNoForbiddenPathSegment('--manifest', manifest);
      assertNoForbiddenManifestBasename(manifest);
    }
  }

  // ── BR-SOURCE-11P-IMPL. The limited broader local execution CONTROL mode.
  //
  // Every check here is a PRE-OPEN check, and the mode holds no path at all: `--manifest` is
  // refused outright, `--output` is refused outright, and no reader, workspace or probe is ever
  // constructed for this mode (see `main`). 11O § 7 makes the ORDER the safety property — a
  // violation found after the first open "has already produced the read it was meant to prevent"
  // — and this mode satisfies it trivially by never reaching a step that could open anything.
  //
  // The nine riders below are meaningless without the mode, so each is refused rather than
  // silently ignored, exactly as the 11E–11H riders are.
  const limitedBroaderRiders: ReadonlyArray<readonly [flag: string, declared: boolean]> = [
    ['--limited-broader-local-execution-authorized', limitedBroaderLocalExecutionAuthorized !== null],
    ['--gate2-approved', gate2Approved !== null],
    ['--aggregate-only', aggregateOnly !== null],
    ['--temp-storage-disabled', tempStorageDisabled !== null],
    ['--no-import', noImport !== null],
    ['--no-supabase-write', noSupabaseWrite !== null],
    ['--no-runtime', noRuntime !== null],
    ['--no-agent1', noAgent1 !== null],
    ['--no-provider-calls', noProviderCalls !== null],
    ['--allowed-family', allowedFamilies.length > 0],
    ['--max-files', maxFiles !== null],
    ['--max-files-per-family', maxFilesPerFamily !== null],
    ['--max-runtime-seconds', maxRuntimeSeconds !== null],
  ];
  if (!limitedBroaderLocalExecution) {
    for (const [flag, declared] of limitedBroaderRiders) {
      if (declared) {
        throw new ForbiddenFullJoinRunnerModeError(
          `${flag} is only valid together with --limited-broader-local-execution`,
        );
      }
    }
  }
  if (limitedBroaderLocalExecution) {
    // A manifest is a real control DOCUMENT. This mode never opens one, so it never accepts one:
    // refusing the flag is what makes "no file is opened" a property of the argument surface
    // rather than a promise about the code below it.
    if (manifest !== null) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--limited-broader-local-execution never accepts --manifest — the control layer opens no file and is given no path',
      );
    }
    if (outputPath !== null) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--limited-broader-local-execution never accepts --output — 11O § 11 sets outputRoot to no-output-file',
      );
    }
    if (!strict) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--limited-broader-local-execution requires --strict — the control mode has no lenient mode',
      );
    }
    // § 8: "every safety flag is explicit; there is no implicit default that widens scope". So an
    // ABSENT invariant is refused here rather than defaulted, and the control layer refuses the
    // request again on its own terms afterwards.
    const missingDeclarations: string[] = [];
    if (aggregateOnly === null) missingDeclarations.push('--aggregate-only');
    if (tempStorageDisabled === null) missingDeclarations.push('--temp-storage-disabled');
    if (noImport === null) missingDeclarations.push('--no-import');
    if (noSupabaseWrite === null) missingDeclarations.push('--no-supabase-write');
    if (noRuntime === null) missingDeclarations.push('--no-runtime');
    if (noAgent1 === null) missingDeclarations.push('--no-agent1');
    if (noProviderCalls === null) missingDeclarations.push('--no-provider-calls');
    if (missingDeclarations.length > 0) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--limited-broader-local-execution requires every explicit safety declaration (missing: ${missingDeclarations.join(', ')})`,
      );
    }
  }

  const requestedModes = [
    syntheticFixture,
    syntheticTempManifest,
    manifest !== null,
    limitedBroaderLocalExecution,
  ].filter(Boolean).length;
  if (requestedModes === 0) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--synthetic-fixture or --synthetic-temp-manifest is required (--manifest <path> --allow-local-manifest declares REAL local-manifest intent, which the runner core still refuses; --limited-broader-local-execution declares BR-SOURCE-11P control intent, which the control layer always refuses)',
    );
  }
  if (requestedModes > 1) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--synthetic-fixture, --synthetic-temp-manifest, --manifest and --limited-broader-local-execution are mutually exclusive — pick exactly one mode',
    );
  }

  // BR-SOURCE-11E is a rider on the metadata-only carve-out, never a mode of its own: on
  // any other invocation it would be a declaration with no carve-out to qualify, so it is
  // refused here rather than silently ignored.
  if (realManifestMetadataExecution && !realManifestMetadataOnly) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--real-manifest-metadata-execution is only valid together with --real-manifest-metadata-only',
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

  // Option C (BR-SOURCE-11F-IMPL) is a rider on the metadata-only carve-out too, and the
  // NARROWEST mode in the tool: it is the only one that opens a file the manifest references,
  // so every precondition is refused HERE, before the probe is constructed and before the
  // runner core is consulted.
  // The 11F structural authorization qualifies EITHER probe mode: a join probe opens the same
  // two files, so it requires the 11F declaration in addition to its own (it is never a
  // substitute for it). On any other invocation the declaration has no carve-out to qualify.
  if (
    requiredFamilyProbeAuthorized &&
    !requiredFamilyProbe &&
    !requiredFamilyJoinProbe &&
    !aggregateJoinCoverageSignal
  ) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--required-family-probe-authorized is only valid together with --required-family-probe, --required-family-join-probe or --aggregate-join-coverage-signal',
    );
  }
  // The two probe modes are mutually exclusive: running both would open four data files, which
  // no authorization in the series permits.
  if (requiredFamilyProbe && requiredFamilyJoinProbe) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--required-family-probe and --required-family-join-probe are mutually exclusive — pick exactly one probe mode',
    );
  }
  // The BR-SOURCE-11H coverage signal is a THIRD mode on the same two files, and it is checked
  // here — before either probe block validates its own caps — so a two-mode invocation is refused
  // for what it actually is rather than for whichever cap happened to be missing.
  if (aggregateJoinCoverageSignal && (requiredFamilyProbe || requiredFamilyJoinProbe)) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--aggregate-join-coverage-signal, --required-family-probe and --required-family-join-probe are mutually exclusive — pick exactly one probe mode',
    );
  }
  if (requiredFamilyProbe) {
    if (!requiredFamilyProbeAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-probe requires the explicit --required-family-probe-authorized declaration — the Option C carve-out is never implied',
      );
    }
    if (!realManifestMetadataOnly) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-probe requires --real-manifest-metadata-only — the manifest is read as a control document first',
      );
    }
    if (!realManifestMetadataExecution) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-probe requires --real-manifest-metadata-execution-authorized — a probe reads an operator-prepared file set',
      );
    }
    if (manifest === null) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-probe requires --manifest <path> — it reads exactly one manifest document',
      );
    }
    if (!allowLocalManifest) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-probe requires the explicit --allow-local-manifest flag',
      );
    }
    if (!strict) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-probe requires --strict — the Option C carve-out has no lenient mode',
      );
    }
    const missingProbeCaps: string[] = [];
    if (maxFilesOpened === null) missingProbeCaps.push('--max-files-opened');
    if (maxBytesPerFile === null) missingProbeCaps.push('--max-bytes-per-file');
    if (maxRowsPerFile === null) missingProbeCaps.push('--max-rows-per-file');
    if (maxTotalRows === null) missingProbeCaps.push('--max-total-rows');
    if (maxTotalBytes === null) missingProbeCaps.push('--max-total-bytes');
    if (missingProbeCaps.length > 0) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--required-family-probe requires every bounded cap (missing: ${missingProbeCaps.join(', ')})`,
      );
    }
    // The four row/byte caps are shared with Option B and with BR-SOURCE-11H, whose ceilings are
    // wider. A probe run re-checks every one of them against the much tighter 11F ceilings,
    // whatever order the flags arrived in.
    assertProbeWindowCeilings('--required-family-probe', {
      maxBytesPerFile,
      maxRowsPerFile,
      maxTotalRows,
      maxTotalBytes,
    });
  }

  // BR-SOURCE-11G Option C is the NARROWEST mode in the tool: the only one that reads a VALUE
  // out of a required-family file. Every precondition — five authorizations, the manifest, the
  // five structural caps and the four join caps — is refused HERE, before the probe is
  // constructed and before the runner core is consulted.
  // The 11G declarations qualify EITHER the join-probe mode or the BR-SOURCE-11H coverage signal:
  // the signal parses the same protected technical key, so it requires them in addition to its
  // own (never as a substitute). On any other invocation they have no carve-out to qualify.
  if (requiredFamilyJoinProbeAuthorized && !requiredFamilyJoinProbe && !aggregateJoinCoverageSignal) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--required-family-join-probe-authorized is only valid together with --required-family-join-probe or --aggregate-join-coverage-signal',
    );
  }
  if (realLocalJoinDryRunAuthorized && !requiredFamilyJoinProbe && !aggregateJoinCoverageSignal) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--real-local-join-dry-run-authorized is only valid together with --required-family-join-probe or --aggregate-join-coverage-signal',
    );
  }
  if (requiredFamilyJoinProbe) {
    if (!requiredFamilyJoinProbeAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires the explicit --required-family-join-probe-authorized declaration — the 11G Option C carve-out is never implied',
      );
    }
    if (!realLocalJoinDryRunAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires --real-local-join-dry-run-authorized — executing the bounded join against local files is a separate declaration',
      );
    }
    // The 11F authorization is required IN ADDITION: a join probe opens the same two files, and
    // the 11G phrase says nothing about opening them.
    if (!requiredFamilyProbeAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires --required-family-probe-authorized — the 11G phrase does not stand in for the file-opening authorization',
      );
    }
    if (!realManifestMetadataOnly) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires --real-manifest-metadata-only — the manifest is read as a control document first',
      );
    }
    if (!realManifestMetadataExecution) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires --real-manifest-metadata-execution-authorized — a join probe reads an operator-prepared file set',
      );
    }
    if (manifest === null) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires --manifest <path> — it reads exactly one manifest document',
      );
    }
    if (!allowLocalManifest) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires the explicit --allow-local-manifest flag',
      );
    }
    if (!strict) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--required-family-join-probe requires --strict — the 11G Option C carve-out has no lenient mode',
      );
    }
    const missingJoinCaps: string[] = [];
    if (maxFilesOpened === null) missingJoinCaps.push('--max-files-opened');
    if (maxBytesPerFile === null) missingJoinCaps.push('--max-bytes-per-file');
    if (maxRowsPerFile === null) missingJoinCaps.push('--max-rows-per-file');
    if (maxTotalRows === null) missingJoinCaps.push('--max-total-rows');
    if (maxTotalBytes === null) missingJoinCaps.push('--max-total-bytes');
    if (maxJoinInputRows === null) missingJoinCaps.push('--max-join-input-rows');
    if (maxJoinKeyValuesInMemory === null) missingJoinCaps.push('--max-join-key-values-in-memory');
    if (maxJoinPairsEmitted === null) missingJoinCaps.push('--max-join-pairs-emitted');
    if (maxJoinedRowsPrinted === null) missingJoinCaps.push('--max-joined-rows-printed');
    if (missingJoinCaps.length > 0) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--required-family-join-probe requires every bounded cap (missing: ${missingJoinCaps.join(', ')})`,
      );
    }
    // Shared with Option B and with BR-SOURCE-11H, whose ceilings are wider. A join-probe run
    // re-checks every row/byte cap against the much tighter 11F/11G ceilings, whatever order the
    // flags arrived in: the 11H window is a SEPARATE authorization and never reaches this mode.
    assertProbeWindowCeilings('--required-family-join-probe', {
      maxBytesPerFile,
      maxRowsPerFile,
      maxTotalRows,
      maxTotalBytes,
    });
  }

  // BR-SOURCE-11H Option C is the WIDEST bounded mode in the tool and the only one that reads a
  // 512 KB / 200-row window. Every precondition — seven authorizations, the manifest, the five
  // structural caps and the four coverage caps — is refused HERE, before the port is constructed
  // and before the runner core is consulted.
  if (aggregateJoinCoverageSignalAuthorized && !aggregateJoinCoverageSignal) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--aggregate-join-coverage-signal-authorized is only valid together with --aggregate-join-coverage-signal',
    );
  }
  if (realLocalJoinCoverageSignalAuthorized && !aggregateJoinCoverageSignal) {
    throw new ForbiddenFullJoinRunnerModeError(
      '--real-local-join-coverage-signal-authorized is only valid together with --aggregate-join-coverage-signal',
    );
  }
  if (aggregateJoinCoverageSignal) {
    if (!aggregateJoinCoverageSignalAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires the explicit --aggregate-join-coverage-signal-authorized declaration — the 11H Option C carve-out is never implied',
      );
    }
    if (!realLocalJoinCoverageSignalAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --real-local-join-coverage-signal-authorized — executing the wider bounded signal against local files is a separate declaration',
      );
    }
    // The 11G authorizations are required IN ADDITION: a coverage signal parses and compares the
    // same protected technical key, and the 11H phrase says nothing about doing that at all.
    if (!requiredFamilyJoinProbeAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --required-family-join-probe-authorized — the 11H phrase does not stand in for the key-parsing authorization',
      );
    }
    if (!realLocalJoinDryRunAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --real-local-join-dry-run-authorized — the 11H declaration does not stand in for the 11G one',
      );
    }
    // The 11F authorization is required too: the same two files still have to be opened.
    if (!requiredFamilyProbeAuthorized) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --required-family-probe-authorized — the 11H phrase does not stand in for the file-opening authorization',
      );
    }
    if (!realManifestMetadataOnly) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --real-manifest-metadata-only — the manifest is read as a control document first',
      );
    }
    if (!realManifestMetadataExecution) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --real-manifest-metadata-execution-authorized — a coverage signal reads an operator-prepared file set',
      );
    }
    if (manifest === null) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --manifest <path> — it reads exactly one manifest document',
      );
    }
    if (!allowLocalManifest) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires the explicit --allow-local-manifest flag',
      );
    }
    if (!strict) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--aggregate-join-coverage-signal requires --strict — the 11H Option C carve-out has no lenient mode',
      );
    }
    const missingCoverageCaps: string[] = [];
    if (maxFilesOpened === null) missingCoverageCaps.push('--max-files-opened');
    if (maxBytesPerFile === null) missingCoverageCaps.push('--max-bytes-per-file');
    if (maxRowsPerFile === null) missingCoverageCaps.push('--max-rows-per-file');
    if (maxTotalRows === null) missingCoverageCaps.push('--max-total-rows');
    if (maxTotalBytes === null) missingCoverageCaps.push('--max-total-bytes');
    if (maxCoverageInputRows === null) missingCoverageCaps.push('--max-coverage-input-rows');
    if (maxCoverageKeyValuesInMemory === null) {
      missingCoverageCaps.push('--max-coverage-key-values-in-memory');
    }
    if (maxCoveragePairsEmitted === null) missingCoverageCaps.push('--max-coverage-pairs-emitted');
    if (maxCoverageRowsPrinted === null) missingCoverageCaps.push('--max-coverage-rows-printed');
    if (missingCoverageCaps.length > 0) {
      throw new ForbiddenFullJoinRunnerModeError(
        `--aggregate-join-coverage-signal requires every bounded cap (missing: ${missingCoverageCaps.join(', ')})`,
      );
    }
    // `--max-bytes-per-file` is shared with Option B, whose ceiling is wider still.
    if ((maxBytesPerFile as number) > BRAZIL_RECEITA_FULL_JOIN_COVERAGE_SIGNAL_MAX_BYTES_PER_FILE) {
      throw new ForbiddenFullJoinRunnerModeError(
        '--max-bytes-per-file exceeds the BR-SOURCE-11H per-file ceiling',
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
    realManifestMetadataExecution,
    requiredFamilyProbe,
    requiredFamilyProbeAuthorized,
    requiredFamilyJoinProbe,
    requiredFamilyJoinProbeAuthorized,
    realLocalJoinDryRunAuthorized,
    maxJoinInputRows,
    maxJoinKeyValuesInMemory,
    maxJoinPairsEmitted,
    maxJoinedRowsPrinted,
    aggregateJoinCoverageSignal,
    aggregateJoinCoverageSignalAuthorized,
    realLocalJoinCoverageSignalAuthorized,
    maxCoverageInputRows,
    maxCoverageKeyValuesInMemory,
    maxCoveragePairsEmitted,
    maxCoverageRowsPrinted,
    format,
    strict,
    maxCompanyRows,
    maxEstablishmentRows,
    maxCompanyScanRows,
    maxBytesPerFile,
    maxManifestBytes,
    maxDeclaredFiles,
    maxFilesOpened,
    maxRowsPerFile,
    maxTotalRows,
    maxTotalBytes,
    outputPath,
    limitedBroaderLocalExecution,
    limitedBroaderLocalExecutionAuthorized,
    gate2Approved,
    aggregateOnly,
    tempStorageDisabled,
    noImport,
    noSupabaseWrite,
    noRuntime,
    noAgent1,
    noProviderCalls,
    allowedFamilies,
    maxFiles,
    maxFilesPerFamily,
    maxRuntimeSeconds,
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
  lines.push(
    `real_manifest_metadata_only_execution_authorized: ${report.real_manifest_metadata_only_execution_authorized}`,
  );
  lines.push(`required_family_probe_authorized: ${report.required_family_probe_authorized}`);
  lines.push(
    `required_family_join_probe_authorized: ${report.required_family_join_probe_authorized}`,
  );
  lines.push(
    `real_local_join_dry_run_authorized: ${report.real_local_join_dry_run_authorized}`,
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
  lines.push(
    `required_family_probe: ${report.required_family_probe === null ? 'null' : ''}`.trimEnd(),
  );
  if (report.required_family_probe !== null) {
    const probe = report.required_family_probe;
    lines.push(`  families_attempted: ${probe.families_attempted.join(', ')}`);
    lines.push(`  files_opened_count: ${probe.files_opened_count}`);
    renderCounts('  files_opened_by_family', probe.files_opened_by_family, lines);
    for (const [label, statuses] of [
      ['bytes_read_bucket', probe.bytes_read_bucket],
      ['rows_read_bucket', probe.rows_read_bucket],
      ['encoding_status', probe.encoding_status],
      ['delimiter_status', probe.delimiter_status],
      ['headerless_status', probe.headerless_status],
    ] as ReadonlyArray<readonly [string, Record<string, string>]>) {
      lines.push(`  ${label}:`);
      for (const [family, value] of Object.entries(statuses)) lines.push(`    ${family}: ${value}`);
    }
    lines.push('  row_shape:');
    for (const [family, shape] of Object.entries(probe.row_shape)) {
      lines.push(`    ${family}:`);
      lines.push(`      expected_min_columns: ${shape.expected_min_columns}`);
      renderCounts(
        '      observed_column_count_distribution',
        shape.observed_column_count_distribution,
        lines,
      );
      lines.push(`      row_shape_valid_count: ${shape.row_shape_valid_count}`);
      lines.push(`      row_shape_invalid_count: ${shape.row_shape_invalid_count}`);
    }
    lines.push(`  selection_class: ${probe.selection_class}`);
    lines.push(`  forbidden_family_attempted: ${probe.forbidden_family_attempted}`);
    lines.push(`  forbidden_family_declared_count: ${probe.forbidden_family_declared_count}`);
    lines.push(`  never_opened_family_declared_count: ${probe.never_opened_family_declared_count}`);
    lines.push(`  raw_rows_printed: ${probe.raw_rows_printed}`);
    lines.push(`  raw_cells_printed: ${probe.raw_cells_printed}`);
    lines.push(`  identifiers_printed: ${probe.identifiers_printed}`);
    lines.push(`  filenames_printed: ${probe.filenames_printed}`);
    lines.push(`  absolute_paths_printed: ${probe.absolute_paths_printed}`);
    lines.push(`  hashes_printed: ${probe.hashes_printed}`);
    lines.push(`  joins_executed: ${probe.joins_executed}`);
    lines.push(`  join_coverage_computed: ${probe.join_coverage_computed}`);
    lines.push(`  full_dataset_processed: ${probe.full_dataset_processed}`);
  }
  lines.push(
    `required_family_join_probe: ${report.required_family_join_probe === null ? 'null' : ''}`.trimEnd(),
  );
  if (report.required_family_join_probe !== null) {
    const joinProbe = report.required_family_join_probe;
    lines.push(`  families_attempted: ${joinProbe.families_attempted.join(', ')}`);
    lines.push(`  files_opened_count: ${joinProbe.files_opened_count}`);
    renderCounts('  files_opened_by_family', joinProbe.files_opened_by_family, lines);
    for (const [label, statuses] of [
      ['bytes_read_bucket', joinProbe.bytes_read_bucket],
      ['rows_read_bucket', joinProbe.rows_read_bucket],
      ['encoding_status', joinProbe.encoding_status],
      ['delimiter_status', joinProbe.delimiter_status],
      ['headerless_status', joinProbe.headerless_status],
    ] as ReadonlyArray<readonly [string, Record<string, string>]>) {
      lines.push(`  ${label}:`);
      for (const [family, value] of Object.entries(statuses)) lines.push(`    ${family}: ${value}`);
    }
    lines.push('  row_shape:');
    for (const [family, shape] of Object.entries(joinProbe.row_shape)) {
      lines.push(`    ${family}:`);
      lines.push(`      expected_min_columns: ${shape.expected_min_columns}`);
      renderCounts(
        '      observed_column_count_distribution',
        shape.observed_column_count_distribution,
        lines,
      );
      lines.push(`      row_shape_valid_count: ${shape.row_shape_valid_count}`);
      lines.push(`      row_shape_invalid_count: ${shape.row_shape_invalid_count}`);
    }
    lines.push(`  selection_class: ${joinProbe.selection_class}`);
    lines.push(`  forbidden_family_attempted: ${joinProbe.forbidden_family_attempted}`);
    lines.push(`  forbidden_family_declared_count: ${joinProbe.forbidden_family_declared_count}`);
    lines.push(
      `  never_opened_family_declared_count: ${joinProbe.never_opened_family_declared_count}`,
    );
    lines.push('  join_probe:');
    for (const [key, value] of Object.entries(joinProbe.join_probe)) {
      lines.push(`    ${key}: ${value}`);
    }
    lines.push(`  raw_rows_printed: ${joinProbe.raw_rows_printed}`);
    lines.push(`  raw_cells_printed: ${joinProbe.raw_cells_printed}`);
    lines.push(`  identifiers_printed: ${joinProbe.identifiers_printed}`);
    lines.push(`  filenames_printed: ${joinProbe.filenames_printed}`);
    lines.push(`  absolute_paths_printed: ${joinProbe.absolute_paths_printed}`);
    lines.push(`  hashes_printed: ${joinProbe.hashes_printed}`);
    lines.push(`  joins_executed: ${joinProbe.joins_executed}`);
    lines.push(`  join_coverage_computed: ${joinProbe.join_coverage_computed}`);
    lines.push(`  full_dataset_processed: ${joinProbe.full_dataset_processed}`);
  }
  lines.push(
    `aggregate_join_coverage_signal: ${report.aggregate_join_coverage_signal === null ? 'null' : ''}`.trimEnd(),
  );
  if (report.aggregate_join_coverage_signal !== null) {
    const signal = report.aggregate_join_coverage_signal;
    lines.push(`  authorized: ${signal.authorized}`);
    lines.push(
      `  real_local_join_coverage_signal_authorized: ${signal.real_local_join_coverage_signal_authorized}`,
    );
    lines.push(`  families_attempted: ${signal.families_attempted.join(', ')}`);
    lines.push(`  files_opened_count: ${signal.files_opened_count}`);
    renderCounts('  files_opened_by_family', signal.files_opened_by_family, lines);
    for (const [label, statuses] of [
      ['bytes_read_bucket', signal.bytes_read_bucket],
      ['rows_read_bucket', signal.rows_read_bucket],
      ['encoding_status', signal.encoding_status],
      ['delimiter_status', signal.delimiter_status],
      ['headerless_status', signal.headerless_status],
    ] as ReadonlyArray<readonly [string, Record<string, string>]>) {
      lines.push(`  ${label}:`);
      for (const [family, value] of Object.entries(statuses)) lines.push(`    ${family}: ${value}`);
    }
    lines.push('  row_shape:');
    for (const [family, shape] of Object.entries(signal.row_shape)) {
      lines.push(`    ${family}:`);
      lines.push(`      expected_min_columns: ${shape.expected_min_columns}`);
      renderCounts(
        '      observed_column_count_distribution',
        shape.observed_column_count_distribution,
        lines,
      );
      lines.push(`      row_shape_valid_count: ${shape.row_shape_valid_count}`);
      lines.push(`      row_shape_invalid_count: ${shape.row_shape_invalid_count}`);
    }
    lines.push(`  selection_class: ${signal.selection_class}`);
    lines.push(`  forbidden_family_attempted: ${signal.forbidden_family_attempted}`);
    lines.push(`  forbidden_family_declared_count: ${signal.forbidden_family_declared_count}`);
    lines.push(
      `  never_opened_family_declared_count: ${signal.never_opened_family_declared_count}`,
    );
    lines.push('  coverage_signal:');
    for (const [key, value] of Object.entries(signal.coverage_signal)) {
      lines.push(`    ${key}: ${value}`);
    }
    lines.push(`  raw_rows_printed: ${signal.raw_rows_printed}`);
    lines.push(`  raw_cells_printed: ${signal.raw_cells_printed}`);
    lines.push(`  identifiers_printed: ${signal.identifiers_printed}`);
    lines.push(`  filenames_printed: ${signal.filenames_printed}`);
    lines.push(`  absolute_paths_printed: ${signal.absolute_paths_printed}`);
    lines.push(`  hashes_printed: ${signal.hashes_printed}`);
    lines.push(`  joins_executed: ${signal.joins_executed}`);
    lines.push(`  join_coverage_computed: ${signal.join_coverage_computed}`);
    lines.push(`  full_dataset_processed: ${signal.full_dataset_processed}`);
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

// ─── BR-SOURCE-11P control run ────────────────────────────────────────────────

/**
 * Runs the BR-SOURCE-11P control mode: translate the parsed flags into a control-layer request,
 * evaluate it, and return the sanitized evidence packet.
 *
 * This function is the whole mode. It opens nothing, constructs no reader, creates no workspace,
 * creates no temp directory, writes no file, and never calls `runFullJoinDryRun` — so the "no file
 * is opened" property does not depend on a downstream refusal. The report always carries
 * `ok: false`, `decision_status: not_authorized`, `gate2_status: not_approved` and every readiness
 * flag `false`.
 *
 * The `--no-*` flags are INVARIANTS, not toggles (11O § 8): `--no-import` means "import is not
 * requested", so `--no-import=false` is read as REQUESTING import and refused by the control layer.
 * The positive spellings (`--import`, `--runtime`, `--agent1`, …) never get this far — the
 * forbidden-flag list refuses them during parsing.
 */
export function runLimitedBroaderLocalExecution(
  options: FullJoinRunnerOptions,
): BrazilReceitaLimitedBroaderLocalExecutionReport {
  return buildLimitedBroaderLocalExecutionReport({
    // No phrase flag exists: an execution authorization phrase is not recorded anywhere, so there
    // is nothing for a caller to supply and no string for the control layer to match.
    authorizationPhrase: null,
    limitedBroaderLocalExecutionAuthorized: options.limitedBroaderLocalExecutionAuthorized === true,
    gate2Approved: options.gate2Approved === true,
    strict: options.strict,
    aggregateOnly: options.aggregateOnly === true,
    requestedFamilies: options.allowedFamilies,
    caps: {
      maxFiles: options.maxFiles,
      maxFilesPerFamily: options.maxFilesPerFamily,
      maxBytesPerFile: options.maxBytesPerFile,
      maxRowsPerFile: options.maxRowsPerFile,
      maxTotalBytes: options.maxTotalBytes,
      maxTotalRows: options.maxTotalRows,
      maxRuntimeSeconds: options.maxRuntimeSeconds,
    },
    // No input-root or manifest-control-file flag exists, so no root is ever declared authorized
    // and none of the traversal / symlink / unsafe-basename / output-in-repo shapes is reachable
    // from the argument surface at all.
    directoryPolicy: {
      allowedInputRootAuthorized: false,
      pathTraversalRequested: false,
      symlinkRequested: false,
      unsafeBasenameRequested: false,
      outputInsideRepoRequested: false,
    },
    tempStorage: {
      enabled: options.tempStorageDisabled !== true,
      authorized: false,
    },
    // There is no flag that can ask for any of these. They are stated as structural falses so the
    // control layer evaluates the full § 13 surface rather than a subset of it.
    outputRequests: {
      rawRows: false,
      rawCells: false,
      identifiers: false,
      joinKeys: false,
      joinKeyHashes: false,
      exactCoveragePercentage: false,
      fullDatasetDenominator: false,
      coverageProof: false,
      coverageGuarantee: false,
      productionInference: false,
      absolutePaths: false,
      realFilenames: false,
    },
    escalations: {
      importExecuted: options.noImport !== true,
      supabaseWrite: options.noSupabaseWrite !== true,
      runtimeIntegration: options.noRuntime !== true,
      agent1Integration: options.noAgent1 !== true,
      providerCalls: options.noProviderCalls !== true,
      productionWrites: false,
    },
  });
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
          // BR-SOURCE-11E: declared only when the operator asked for it on this invocation.
          realManifestMetadataOnlyExecutionAuthorized: options.realManifestMetadataExecution,
          maxManifestBytes: options.maxManifestBytes ?? undefined,
          maxDeclaredFiles: options.maxDeclaredFiles ?? undefined,
        })
      : null;

  // Option C: build the required-family probe. It resolves the manifest and at most two
  // declared required-family paths inside its own closure, so this CLI never holds one and
  // never reports one. The probe validates its three authorizations, its forbidden-output
  // refusals, its seven caps and the manifest path shape eagerly, so a refused request never
  // opens a descriptor at all.
  const requiredFamilyProbeReader =
    options.requiredFamilyProbe && options.manifestPath !== null
      ? createBrazilReceitaRequiredFamilyProbe({
          manifestPath: options.manifestPath,
          requiredFamilyProbeAuthorized: options.requiredFamilyProbeAuthorized,
          realManifestMetadataOnlyOptionBAuthorized: options.realManifestMetadataOnly,
          realManifestMetadataOnlyExecutionAuthorized: options.realManifestMetadataExecution,
          maxManifestBytes: options.maxManifestBytes ?? undefined,
          maxDeclaredFiles: options.maxDeclaredFiles ?? undefined,
          maxFilesOpened: options.maxFilesOpened ?? undefined,
          maxBytesPerFile: options.maxBytesPerFile ?? undefined,
          maxRowsPerFile: options.maxRowsPerFile ?? undefined,
          maxTotalRows: options.maxTotalRows ?? undefined,
          maxTotalBytes: options.maxTotalBytes ?? undefined,
        })
      : null;

  // BR-SOURCE-11G Option C: build the required-family JOIN probe. It resolves the manifest and
  // at most two declared required-family paths inside its own closure, and it owns the bounded
  // in-memory join-key window — so this CLI never holds a path and never holds a key. The probe
  // validates its five authorizations, its forbidden-output refusals (including any coverage
  // request), its eleven caps and the manifest path shape eagerly, so a refused request never
  // opens a descriptor at all.
  const requiredFamilyJoinProbeReader =
    options.requiredFamilyJoinProbe && options.manifestPath !== null
      ? createBrazilReceitaRequiredFamilyJoinProbe({
          manifestPath: options.manifestPath,
          requiredFamilyJoinProbeAuthorized: options.requiredFamilyJoinProbeAuthorized,
          realLocalJoinDryRunAuthorized: options.realLocalJoinDryRunAuthorized,
          requiredFamilyProbeAuthorized: options.requiredFamilyProbeAuthorized,
          realManifestMetadataOnlyOptionBAuthorized: options.realManifestMetadataOnly,
          realManifestMetadataOnlyExecutionAuthorized: options.realManifestMetadataExecution,
          maxManifestBytes: options.maxManifestBytes ?? undefined,
          maxDeclaredFiles: options.maxDeclaredFiles ?? undefined,
          maxFilesOpened: options.maxFilesOpened ?? undefined,
          maxBytesPerFile: options.maxBytesPerFile ?? undefined,
          maxRowsPerFile: options.maxRowsPerFile ?? undefined,
          maxTotalRows: options.maxTotalRows ?? undefined,
          maxTotalBytes: options.maxTotalBytes ?? undefined,
          maxJoinInputRows: options.maxJoinInputRows ?? undefined,
          maxJoinKeyValuesInMemory: options.maxJoinKeyValuesInMemory ?? undefined,
          maxJoinPairsEmitted: options.maxJoinPairsEmitted ?? undefined,
          maxJoinedRowsPrinted: options.maxJoinedRowsPrinted ?? undefined,
        })
      : null;

  // BR-SOURCE-11H Option C: build the aggregate-only coverage SIGNAL port. It resolves the
  // manifest and at most two declared required-family paths inside its own closure, and it owns
  // the bounded in-memory key window — so this CLI never holds a path and never holds a key. The
  // port validates its seven authorizations, its forbidden-output refusals (including any exact
  // percentage, denominator, coverage claim or production inference), its eleven caps and the
  // manifest path shape eagerly, so a refused request never opens a descriptor at all.
  const aggregateJoinCoverageSignalReader =
    options.aggregateJoinCoverageSignal && options.manifestPath !== null
      ? createBrazilReceitaAggregateJoinCoverageSignal({
          manifestPath: options.manifestPath,
          aggregateOnlyJoinCoverageSignalAuthorized:
            options.aggregateJoinCoverageSignalAuthorized,
          realLocalJoinCoverageSignalAuthorized: options.realLocalJoinCoverageSignalAuthorized,
          requiredFamilyJoinProbeAuthorized: options.requiredFamilyJoinProbeAuthorized,
          realLocalJoinDryRunAuthorized: options.realLocalJoinDryRunAuthorized,
          requiredFamilyProbeAuthorized: options.requiredFamilyProbeAuthorized,
          realManifestMetadataOnlyOptionBAuthorized: options.realManifestMetadataOnly,
          realManifestMetadataOnlyExecutionAuthorized: options.realManifestMetadataExecution,
          maxManifestBytes: options.maxManifestBytes ?? undefined,
          maxDeclaredFiles: options.maxDeclaredFiles ?? undefined,
          maxFilesOpened: options.maxFilesOpened ?? undefined,
          maxBytesPerFile: options.maxBytesPerFile ?? undefined,
          maxRowsPerFile: options.maxRowsPerFile ?? undefined,
          maxTotalRows: options.maxTotalRows ?? undefined,
          maxTotalBytes: options.maxTotalBytes ?? undefined,
          maxCoverageInputRows: options.maxCoverageInputRows ?? undefined,
          maxCoverageKeyValuesInMemory: options.maxCoverageKeyValuesInMemory ?? undefined,
          maxCoveragePairsEmitted: options.maxCoveragePairsEmitted ?? undefined,
          maxCoverageRowsPrinted: options.maxCoverageRowsPrinted ?? undefined,
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
            realManifestMetadataOnlyExecutionAuthorized: options.realManifestMetadataExecution,
            outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
            realManifestMetadataReader: metadataReader,
          }
        : {}),
      // Option C REPLACES the declared trust — a probe run is dispatched by its own trust —
      // while keeping the metadata reader above, because the manifest is still read as a
      // control document first. Every other authorization stays exactly as declared.
      ...(requiredFamilyProbeReader !== null
        ? {
            manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_PROBE_TRUST,
            requiredFamilyProbeAuthorized: options.requiredFamilyProbeAuthorized,
            requiredFamilyProbeReader,
            ...(options.maxFilesOpened !== null ? { maxFilesOpened: options.maxFilesOpened } : {}),
            ...(options.maxRowsPerFile !== null ? { maxRowsPerFile: options.maxRowsPerFile } : {}),
            ...(options.maxTotalRows !== null ? { maxTotalRows: options.maxTotalRows } : {}),
            ...(options.maxTotalBytes !== null ? { maxTotalBytes: options.maxTotalBytes } : {}),
          }
        : {}),
      // BR-SOURCE-11G Option C REPLACES the declared trust in turn — a join-probe run is
      // dispatched by its own trust — while keeping the metadata reader above, because the
      // manifest is still read as a control document first. Every other authorization stays
      // exactly as declared, and the 11F structural declaration is passed through unchanged
      // because a join probe still needs it to open the two files at all.
      ...(requiredFamilyJoinProbeReader !== null
        ? {
            manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
            requiredFamilyProbeAuthorized: options.requiredFamilyProbeAuthorized,
            requiredFamilyJoinProbeAuthorized: options.requiredFamilyJoinProbeAuthorized,
            realLocalJoinDryRunAuthorized: options.realLocalJoinDryRunAuthorized,
            requiredFamilyJoinProbeReader,
            ...(options.maxFilesOpened !== null ? { maxFilesOpened: options.maxFilesOpened } : {}),
            ...(options.maxRowsPerFile !== null ? { maxRowsPerFile: options.maxRowsPerFile } : {}),
            ...(options.maxTotalRows !== null ? { maxTotalRows: options.maxTotalRows } : {}),
            ...(options.maxTotalBytes !== null ? { maxTotalBytes: options.maxTotalBytes } : {}),
            ...(options.maxJoinInputRows !== null
              ? { maxJoinInputRows: options.maxJoinInputRows }
              : {}),
            ...(options.maxJoinKeyValuesInMemory !== null
              ? { maxJoinKeyValuesInMemory: options.maxJoinKeyValuesInMemory }
              : {}),
            ...(options.maxJoinPairsEmitted !== null
              ? { maxJoinPairsEmitted: options.maxJoinPairsEmitted }
              : {}),
            ...(options.maxJoinedRowsPrinted !== null
              ? { maxJoinedRowsPrinted: options.maxJoinedRowsPrinted }
              : {}),
          }
        : {}),
      // BR-SOURCE-11H Option C REPLACES the declared trust in turn — a coverage-signal run is
      // dispatched by its own trust — while keeping the metadata reader above, because the
      // manifest is still read as a control document first. Every other authorization stays
      // exactly as declared, and the 11F and 11G declarations are passed through unchanged
      // because a coverage signal still needs them to open the files and to parse a key at all.
      ...(aggregateJoinCoverageSignalReader !== null
        ? {
            manifestTrust: BRAZIL_RECEITA_FULL_JOIN_AGGREGATE_JOIN_COVERAGE_SIGNAL_TRUST,
            requiredFamilyProbeAuthorized: options.requiredFamilyProbeAuthorized,
            requiredFamilyJoinProbeAuthorized: options.requiredFamilyJoinProbeAuthorized,
            realLocalJoinDryRunAuthorized: options.realLocalJoinDryRunAuthorized,
            aggregateOnlyJoinCoverageSignalAuthorized:
              options.aggregateJoinCoverageSignalAuthorized,
            realLocalJoinCoverageSignalAuthorized: options.realLocalJoinCoverageSignalAuthorized,
            aggregateJoinCoverageSignalReader,
            ...(options.maxFilesOpened !== null ? { maxFilesOpened: options.maxFilesOpened } : {}),
            ...(options.maxRowsPerFile !== null ? { maxRowsPerFile: options.maxRowsPerFile } : {}),
            ...(options.maxTotalRows !== null ? { maxTotalRows: options.maxTotalRows } : {}),
            ...(options.maxTotalBytes !== null ? { maxTotalBytes: options.maxTotalBytes } : {}),
            ...(options.maxCoverageInputRows !== null
              ? { maxCoverageInputRows: options.maxCoverageInputRows }
              : {}),
            ...(options.maxCoverageKeyValuesInMemory !== null
              ? { maxCoverageKeyValuesInMemory: options.maxCoverageKeyValuesInMemory }
              : {}),
            ...(options.maxCoveragePairsEmitted !== null
              ? { maxCoveragePairsEmitted: options.maxCoveragePairsEmitted }
              : {}),
            ...(options.maxCoverageRowsPrinted !== null
              ? { maxCoverageRowsPrinted: options.maxCoverageRowsPrinted }
              : {}),
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

  // BR-SOURCE-11P: handled in its own branch, BEFORE `runFullJoinDryRun` is reached. Nothing in
  // this path constructs a reader, a workspace or a probe, so no descriptor is ever opened. The
  // evidence packet is emitted as JSON on every `--format` — this report has no text renderer, and
  // silently degrading a refusal to a partial rendering would be worse than ignoring the flag.
  if (options.limitedBroaderLocalExecution) {
    const report = runLimitedBroaderLocalExecution(options);
    const rendered = JSON.stringify(report, null, 2);
    const sanitized = sanitizeBrazilReceitaFullJoinRenderedOutput(rendered);
    if (!sanitized.ok) {
      process.stderr.write(
        `${new FullJoinRunnerOutputSanitizationError(sanitized.findings.map((f) => f.kind)).message}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${rendered}\n`);
    // Always non-zero: an unauthorized attempt is a failed attempt, and a zero exit code would
    // read as a successful limited broader local execution to any caller or CI step.
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
      err instanceof BrazilReceitaRealManifestMetadataError ||
      err instanceof BrazilReceitaRequiredFamilyProbeError ||
      // The join probe's message is a fixed refusal CODE too: it carries no path, no filename,
      // no document fragment and — critically — no join key (11G § 5.1).
      err instanceof BrazilReceitaRequiredFamilyJoinProbeError ||
      // The coverage signal's message is a fixed refusal CODE too: no path, no filename, no
      // document fragment, no join key, no exact figure and no denominator.
      err instanceof BrazilReceitaAggregateJoinCoverageSignalError
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
