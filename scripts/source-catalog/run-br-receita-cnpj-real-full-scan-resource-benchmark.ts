/**
 * BR Receita CNPJ — REAL FULL-SCAN RESOURCE BENCHMARK: operator CLI (BR-SOURCE-14B.0F § 7).
 *
 * The operator entry point for ONE thing: the full-scan resource benchmark. It is not an import CLI,
 * not a production CLI and not an Agent 1 CLI, and it cannot become one — the only functions it can
 * reach are the benchmark entry point and the synthetic smoke path, and neither of those can write a
 * row anywhere.
 *
 * ── Two modes, and only one of them can run today ───────────────────────────────
 *   --real-full-scan-resource-benchmark
 *       The real thing. REFUSES while `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` is
 *       `false`, which it is, and the refusal happens before the manifest is opened. Every flag it
 *       accepts is still parsed and validated first, so an operator preparing for a future
 *       authorization can find out that their declarations are complete without being told only
 *       "not authorized".
 *
 *   --synthetic-smoke
 *       The whole path — declarations, caps, handle ledger, free-disk thresholds, private channel
 *       resolution, manifest bridge — exercised against a SYNTHETIC manifest the operator supplies,
 *       with scripted ports. This is how § 7's "the CLI can be validated completely with a synthetic
 *       fixture" is satisfied without the real dataset existing anywhere in the loop.
 *
 * ── What it does NOT print ──────────────────────────────────────────────────────
 * No path, no file name, no directory, no row, no cell, no CNPJ, no join key, and no exact figure.
 * It accepts paths and acknowledgement phrases as arguments and never echoes them: the report it
 * prints is the § 10 bucketed public report, and the exact figures go to the private artifact or
 * nowhere. `--manifest` is read from `process.argv`, used, and never rendered.
 *
 * ── This CLI NEVER ──────────────────────────────────────────────────────────────
 *   - imports Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or Slack.
 *   - spawns a process. There is no `child_process` reference, which is how "no git command may run
 *     with cwd = dataset root" is guaranteed rather than promised.
 *   - downloads, unzips, moves, copies or modifies a dataset file.
 *   - writes anything except the private metric artifact, and only when the run is authorized and the
 *     acknowledgement phrase is exact.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createBrazilReceitaFullJoinBridgeFileSystem } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-manifest-bridge-fs';
import {
  createBrazilReceitaFullJoinFreeDiskProbe,
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine-fs';
import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-no-write-guard';
import { createBrazilReceitaFullJoinPrivateChannelFileSystem } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-private-channel-fs';
import { createBrazilReceitaFullJoinBenchmarkAttemptLedger } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-resource-benchmark';
import { validateBrReceitaCnpjLocalManifest } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-manifest-validator';
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
  brazilReceitaProposedFullScanResourceCaps,
  runBrazilReceitaRealFullScanResourceBenchmark,
  summarizeBrazilReceitaRealFullScanReadiness,
  type BrazilReceitaRealFullScanBenchmarkRequest,
  type BrazilReceitaRealFullScanDeclarations,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-full-scan-benchmark';

// ─── Modes ────────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_MODES = [
  'real-full-scan-resource-benchmark',
  'synthetic-smoke',
  'readiness',
] as const;

export type BrazilReceitaRealFullScanCliMode =
  (typeof BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_MODES)[number];

/** Fixed, value-free refusal codes. A code never embeds a path, a phrase or a figure. */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_REFUSALS = [
  'mode_not_declared',
  'mode_ambiguous',
  'manifest_not_declared',
  'manifest_path_not_absolute',
  'workspace_parent_not_declared',
  'private_destination_not_declared',
  'dataset_period_not_declared',
  'acknowledgement_not_declared',
  'real_benchmark_not_authorized',
] as const;

export type BrazilReceitaRealFullScanCliRefusal =
  (typeof BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_REFUSALS)[number];

// ─── Argument parsing ─────────────────────────────────────────────────────────

export interface BrazilReceitaRealFullScanCliOptions {
  readonly mode: BrazilReceitaRealFullScanCliMode;
  readonly manifestPath: string;
  readonly workspaceParentDirectory: string;
  readonly privateMetricDestinationDirectory: string;
  readonly privateMetricArtifactSlug: string;
  readonly datasetPeriod: string;
  readonly acknowledgement: string;
}

export type BrazilReceitaRealFullScanCliParse =
  | { readonly ok: true; readonly options: BrazilReceitaRealFullScanCliOptions }
  | { readonly ok: false; readonly refusal: BrazilReceitaRealFullScanCliRefusal };

function flagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
}

/**
 * Parses the command line, or refuses.
 *
 * Exported so the synthetic smoke test can drive it directly: § 7 requires the CLI to be fully
 * validatable against a synthetic fixture, and a parser that only runs inside `main()` can only be
 * tested by running `main()`.
 *
 * The two modes are MUTUALLY EXCLUSIVE and neither is a default. A CLI that defaulted to the real
 * mode would make a typo into an attempt at a six-hour run; one that defaulted to synthetic would let
 * an operator believe they had run the real thing.
 */
export function parseBrazilReceitaRealFullScanCliArgs(
  argv: readonly string[],
): BrazilReceitaRealFullScanCliParse {
  const wantsReal = argv.includes('--real-full-scan-resource-benchmark');
  const wantsSynthetic = argv.includes('--synthetic-smoke');
  const wantsReadiness = argv.includes('--readiness');

  const declared = [wantsReal, wantsSynthetic, wantsReadiness].filter(Boolean).length;
  if (declared === 0) return { ok: false, refusal: 'mode_not_declared' };
  if (declared > 1) return { ok: false, refusal: 'mode_ambiguous' };

  const mode: BrazilReceitaRealFullScanCliMode = wantsReal
    ? 'real-full-scan-resource-benchmark'
    : wantsSynthetic
      ? 'synthetic-smoke'
      : 'readiness';

  if (mode === 'readiness') {
    return {
      ok: true,
      options: {
        mode,
        manifestPath: '',
        workspaceParentDirectory: '',
        privateMetricDestinationDirectory: '',
        privateMetricArtifactSlug: '',
        datasetPeriod: '',
        acknowledgement: '',
      },
    };
  }

  const manifestPath = flagValue(argv, '--manifest');
  if (manifestPath === null) return { ok: false, refusal: 'manifest_not_declared' };
  if (!path.isAbsolute(manifestPath)) return { ok: false, refusal: 'manifest_path_not_absolute' };

  const workspaceParentDirectory = flagValue(argv, '--workspace-parent');
  if (workspaceParentDirectory === null) {
    return { ok: false, refusal: 'workspace_parent_not_declared' };
  }

  const privateMetricDestinationDirectory = flagValue(argv, '--private-metric-directory');
  if (privateMetricDestinationDirectory === null) {
    return { ok: false, refusal: 'private_destination_not_declared' };
  }

  const datasetPeriod = flagValue(argv, '--dataset-period');
  if (datasetPeriod === null) return { ok: false, refusal: 'dataset_period_not_declared' };

  const acknowledgement = flagValue(argv, '--private-metric-acknowledgement');
  if (acknowledgement === null) return { ok: false, refusal: 'acknowledgement_not_declared' };

  return {
    ok: true,
    options: {
      mode,
      manifestPath,
      workspaceParentDirectory,
      privateMetricDestinationDirectory,
      privateMetricArtifactSlug: flagValue(argv, '--private-metric-slug') ?? 'brfj-metrics',
      datasetPeriod,
      acknowledgement,
    },
  };
}

// ─── Declaration assembly ─────────────────────────────────────────────────────

/**
 * Builds the nineteen declarations from the parsed options and the § 11 proposed profile.
 *
 * The three POLICY approvals are the interesting part. They are set from the proposed profile's
 * standing, which is to say they are `false`: the CLI cannot approve GATE-2 or the CAP-input policy,
 * and an operator running this command is not thereby approving them either. When those approvals
 * arrive they arrive as a source edit to the constants, and this function will read them from there.
 *
 * Exported for the same reason the parser is: it is the part a synthetic test needs to exercise.
 */
export function buildBrazilReceitaRealFullScanDeclarations(
  options: BrazilReceitaRealFullScanCliOptions,
): BrazilReceitaRealFullScanDeclarations {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  return {
    // Not approvals this CLI can grant. They mirror the authorization constant, which is `false`.
    temporaryStoragePolicyApproved: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
    capInputPolicyApproved: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
    benchmarkAuthorization: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
    attemptCount: proposal.attemptCount,
    datasetPeriod: options.datasetPeriod,
    manifestPath: options.manifestPath,
    privateMetricChannelAcknowledgement: options.acknowledgement,
    resourceCaps: brazilReceitaProposedFullScanResourceCaps(),
    maxOpenPartitionFiles: proposal.maxOpenPartitionFiles,
    minimumFreeDiskBeforeStart: proposal.minimumFreeDiskBeforeStart,
    minimumFreeDiskReserve: proposal.minimumFreeDiskReserve,
    readerCaps: {
      maxChunkBytes: proposal.maxChunkBytes,
      maxCarryBytes: proposal.maxCarryBytes,
      maxRowBytes: proposal.maxRowBytes,
      maxColumnsPerRow: proposal.maxColumnsPerRow,
    },
    partitioningCaps: {
      partitionCount: proposal.partitionCount,
      maxPartitionCount: proposal.maxPartitionCount,
      maxPartitionDepth: proposal.maxPartitionDepth,
      maxReferencesPerPartition: proposal.maxReferencesPerPartition,
      maxReferenceBytesPerPartition: proposal.maxReferenceBytesPerPartition,
    },
    workspaceParentDirectory: options.workspaceParentDirectory,
    workspaceBoundaries: {
      repositoryRoot: path.resolve(__dirname, '..', '..'),
      homeDirectory: os.homedir(),
      // Declared as absent rather than guessed. This CLI does not locate the dataset, and a
      // dataset root it invented would be a boundary check against the wrong directory.
      datasetRoot: null,
    },
    privateMetricDestinationDirectory: options.privateMetricDestinationDirectory,
    privateMetricArtifactSlug: options.privateMetricArtifactSlug,
    privateMetricArtifactTtlMs: proposal.privateMetricArtifactTtlMs,
    noWriteContract: BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
  };
}

/** Assembles the full request, with the real process-backed ports. */
export function buildBrazilReceitaRealFullScanRequest(
  options: BrazilReceitaRealFullScanCliOptions,
  nowMs: number,
): BrazilReceitaRealFullScanBenchmarkRequest {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  return {
    declarations: buildBrazilReceitaRealFullScanDeclarations(options),
    workingDirectory: {
      currentWorkingDirectory: process.cwd(),
      homeDirectory: os.homedir(),
      repositoryRoot,
      datasetRoot: null,
      repositoryPackageName: readRepositoryPackageName(repositoryRoot),
    },
    attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
    bridgeFileSystem: createBrazilReceitaFullJoinBridgeFileSystem(),
    validateManifest: (validationOptions) =>
      validateBrReceitaCnpjLocalManifest({
        manifestPath: validationOptions.manifestPath,
        allowRealLocalFiles: validationOptions.allowRealLocalFiles,
        strict: true,
      }),
    readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    privateChannelFileSystem: createBrazilReceitaFullJoinPrivateChannelFileSystem(),
    privateChannelBoundaries: {
      repositoryRoot,
      homeDirectory: os.homedir(),
      datasetRoot: null,
    },
    freeDiskProbe: createBrazilReceitaFullJoinFreeDiskProbe(),
    nowMs,
  };
}

/**
 * Reads the repository's declared package name — the check that the cwd is a SellUp worktree.
 *
 * Returns an empty string on any failure, which the working-directory evaluator treats as
 * `repository_root_not_sellup_worktree`. Fail-closed: a run that cannot establish where it is
 * running must not proceed as though it had.
 */
function readRepositoryPackageName(repositoryRoot: string): string {
  try {
    const raw = fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
      const name = (parsed as { name?: unknown }).name;
      return typeof name === 'string' ? name : '';
    }
    return '';
  } catch {
    return '';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseBrazilReceitaRealFullScanCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.refusal}\n`);
    process.stderr.write(
      'usage: --readiness | --synthetic-smoke | --real-full-scan-resource-benchmark ' +
        '--manifest <abs> --workspace-parent <abs> --private-metric-directory <abs> ' +
        '--dataset-period <YYYY-MM> --private-metric-acknowledgement <phrase>\n',
    );
    process.exitCode = 1;
    return;
  }

  if (parsed.options.mode === 'readiness') {
    process.stdout.write(`${JSON.stringify(summarizeBrazilReceitaRealFullScanReadiness(), null, 2)}\n`);
    return;
  }

  // The mode wall. `--real-full-scan-resource-benchmark` is refused HERE, before any port is built
  // and before the manifest path is touched, so the refusal is visible in the CLI itself rather than
  // only deep inside the entry point's preflight. The entry point refuses too — see its
  // `authorization` stage — and both refusals are load-bearing: this one is the operator-facing
  // message, that one is the guarantee.
  if (
    parsed.options.mode === 'real-full-scan-resource-benchmark' &&
    !BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG
  ) {
    process.stderr.write('real_benchmark_not_authorized\n');
    process.stderr.write(
      'BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED is false. ' +
        'The execution path is complete and the run is not authorized; those are different facts. ' +
        'Authorizing it takes a source edit, a PR and an owner decision.\n',
    );
    process.exitCode = 1;
    return;
  }

  // Synthetic smoke: the same entry point, the same declarations, the same ports — against whatever
  // synthetic manifest the operator pointed at. It refuses at `authorization` exactly as the real
  // mode does, which is the point: the smoke test proves the wiring, not the permission.
  const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(
    buildBrazilReceitaRealFullScanRequest(parsed.options, Date.now()),
  );

  if (!outcome.ok) {
    // Value-free by construction: the refusal carries codes and enum members, never a path.
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          mode: outcome.mode,
          abortStage: outcome.abortStage,
          failedStage: outcome.failedStage,
          abortCode: outcome.abortCode,
          missingDeclarations: outcome.missingDeclarations,
          cwdViolations: outcome.cwdViolations,
          capRejections: outcome.capRejections,
          privateChannelRejections: outcome.privateChannelRejections,
          bridgeFindings: outcome.bridgeFindings,
          realManifestOpened: outcome.realManifestOpened,
          realDataAccessed: outcome.realDataAccessed,
          rowsEmitted: outcome.rowsEmitted,
          realFullScanBenchmarkExecuted: outcome.realFullScanBenchmarkExecuted,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify(outcome.publicReport, null, 2)}\n`);
  if (!outcome.cleanupVerified || !outcome.privateArtifactWritten) process.exitCode = 1;
}

// Only auto-run when executed directly (never when imported by a test file).
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('run-br-receita-cnpj-real-full-scan-resource-benchmark.ts')) {
  void main();
}
