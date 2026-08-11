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
import { evaluateBrazilReceitaNationalInputCompleteness } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-input-completeness';
import { evaluateBrazilReceitaRealBenchmarkAttemptRequest } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-benchmark-attempt-ledger';
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
  // BR-SOURCE-14B.0J § 12. The attempt number is declared, never defaulted, and a real attempt beyond
  // the first is refused here before any port is built.
  'real_attempt_number_not_declared',
  'real_attempt_number_not_an_integer',
  'real_attempt_owner_declaration_missing',
  'real_benchmark_attempt_limit_reached',
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
  /** Which real attempt this invocation claims to be (BR-SOURCE-14B.0J § 5). Never defaulted. */
  readonly requestedRealAttemptNumber: number;
  /**
   * Whether the operator passed the second-attempt owner declaration flag.
   *
   * A SEPARATE thing from the attempt number: `--real-attempt-number 2` says which attempt this is, and
   * this says an owner approved running it. The CLI refuses when the number is beyond the first and this
   * is absent, so `--real-attempt-number 2` alone can never start a run.
   */
  readonly secondRealAttemptOwnerDeclared: boolean;
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
        // `--readiness` reports; it never runs. A zero here is not an attempt number and cannot be
        // mistaken for one: the ledger refuses anything below 1 as `real_attempt_number_invalid`.
        requestedRealAttemptNumber: 0,
        secondRealAttemptOwnerDeclared: false,
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

  // BR-SOURCE-14B.0J § 5. Required of BOTH real and synthetic-smoke modes: the smoke test exists to
  // prove the wiring, and a smoke run that could skip the attempt declaration would be proving the
  // wiring of a different code path from the one a real run takes.
  const rawAttemptNumber = flagValue(argv, '--real-attempt-number');
  if (rawAttemptNumber === null) return { ok: false, refusal: 'real_attempt_number_not_declared' };
  const requestedRealAttemptNumber = Number(rawAttemptNumber);
  if (!Number.isInteger(requestedRealAttemptNumber) || requestedRealAttemptNumber < 1) {
    return { ok: false, refusal: 'real_attempt_number_not_an_integer' };
  }

  return {
    ok: true,
    options: {
      mode,
      requestedRealAttemptNumber,
      secondRealAttemptOwnerDeclared: argv.includes('--second-real-attempt-owner-authorized'),
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
    requestedRealAttemptNumber: options.requestedRealAttemptNumber,
    // The § 7 gate, evaluated here from the metadata this CLI actually has — which is NONE. No expected
    // national inventory exists (`BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN` is `false`), so the
    // observed side is declared as empty and the verdict comes back `indeterminate`.
    //
    // This CLI deliberately cannot do better, and that is the § 9 boundary: producing a `complete`
    // verdict would mean reading an inventory of the operator's staged files, and this milestone opens
    // nothing. When a real inventory contract lands, this is the one call site that changes.
    nationalInputCompleteness: evaluateBrazilReceitaNationalInputCompleteness({
      period: options.datasetPeriod,
      // `null`, not an empty record: this CLI has not inspected anything, and `null` is how the gate is
      // told that. An empty record would be read as "inspected, and every field is wrong".
      observed: null,
      expected: null,
    }),
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
        '--dataset-period <YYYY-MM> --private-metric-acknowledgement <phrase> ' +
        '--real-attempt-number <n> [--second-real-attempt-owner-authorized]\n',
    );
    process.exitCode = 1;
    return;
  }

  if (parsed.options.mode === 'readiness') {
    process.stdout.write(`${JSON.stringify(summarizeBrazilReceitaRealFullScanReadiness(), null, 2)}\n`);
    return;
  }

  // ── Wall order (BR-SOURCE-14B.0J § 12) ──────────────────────────────────────
  // The second-attempt wall fires BEFORE the authorization wall, deliberately. Both refuse today, so the
  // order changes only which message the operator sees — and the specific one is the useful one. 14B.0F
  // built this CLI so that "an operator preparing for a future authorization can find out that their
  // declarations are complete without being told only 'not authorized'"; an operator preparing attempt #2
  // should likewise learn that the owner declaration is missing NOW, rather than discovering it after the
  // authorization constant flips. It also means this wall is demonstrable today instead of being masked.
  // The ATTEMPT-LIMIT wall (BR-SOURCE-14B.0J § 6). Attempt #3 is refused unconditionally, at the operator
  // surface as well as inside the entry point's `real_attempt_eligibility` stage. Two independent refusals
  // for the same rule, on purpose: the entry point's is the guarantee, and a CLI that let a `3` through to
  // a generic "not authorized" would tell an operator to go and get an authorization that can never make
  // this run legal. It also holds if the authorization constant is ever flipped.
  if (parsed.options.mode === 'real-full-scan-resource-benchmark') {
    const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(
      parsed.options.requestedRealAttemptNumber,
    );
    if (eligibility.rejectionCode === 'real_benchmark_attempt_limit_reached') {
      process.stderr.write('real_benchmark_attempt_limit_reached\n');
      process.stderr.write(
        `Attempts consumed: ${eligibility.attemptsConsumed}. ` +
          `Structurally supported: ${eligibility.structurallySupportedAttempts}. ` +
          'There is no third real attempt, and no authorization can create one.\n',
      );
      process.exitCode = 1;
      return;
    }
  }

  // The SECOND-ATTEMPT wall (BR-SOURCE-14B.0J § 12). A real attempt beyond the first needs an owner
  // declaration on the command line, and this refusal fires whether or not the authorization constant is
  // ever flipped. Two independent walls rather than one: flipping `..._AUTHORIZED` grants "a real
  // benchmark may run", and this asks the separate question "which attempt, and who approved a second
  // one" — the § 6 rule against inferring one declaration from another, applied at the operator surface.
  if (
    parsed.options.mode === 'real-full-scan-resource-benchmark' &&
    parsed.options.requestedRealAttemptNumber > 1 &&
    !parsed.options.secondRealAttemptOwnerDeclared
  ) {
    process.stderr.write('real_attempt_owner_declaration_missing\n');
    process.stderr.write(
      'A real attempt beyond the first requires --second-real-attempt-owner-authorized. ' +
        'Attempts consumed so far: see --readiness. Attempt 3 is refused unconditionally.\n',
    );
    process.exitCode = 1;
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
          // BR-SOURCE-14B.0J § 5, § 11: a refusal spends nothing, and says so rather than leaving the
          // operator to infer it from the absence of a complaint.
          realDataBoundaryCrossed: outcome.realDataBoundaryCrossed,
          attemptsConsumedAfterRefusal: outcome.attemptsConsumedAfterRefusal,
          attemptRejectionCode: outcome.attemptRejectionCode,
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
