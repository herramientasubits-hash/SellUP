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
 *       The real thing. Since BR-SOURCE-ATTEMPT2-OPS it no longer refuses because a tracked constant
 *       says so: it refuses because THIS invocation carries no owner grant. Three separate flags —
 *       `--second-real-attempt-owner-authorized`, `--temporary-storage-policy-approved` and
 *       `--cap-input-policy-approved` — each grant one approval for one process, all three are required,
 *       and none of them defaults to granted. Every other flag is still parsed and validated first, so
 *       an operator preparing an authorized run finds out that their declarations are complete without
 *       being told only "not authorized".
 *
 *       The tracked constant `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` is untouched and
 *       still `false`. It is now an ALTERNATIVE to the operator grant, not a precondition for it.
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

import { evaluateBrazilReceitaAttempt2NationalInputPreflight } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-attempt2-national-input-preflight';
import {
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
  findBrazilReceitaAttempt2MissingOperatorApprovals,
  resolveBrazilReceitaAttempt2OperatorAuthorization,
  type BrazilReceitaAttempt2OperatorAuthorization,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-attempt2-operator-authorization';
import {
  buildBrazilReceitaObservedInputInventory,
  type BrazilReceitaObservedInputInventoryResult,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-attempt2-observed-input-inventory';
import { createBrazilReceitaFullJoinBridgeFileSystem } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-manifest-bridge-fs';
import {
  createBrazilReceitaFullJoinFreeDiskProbe,
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine-fs';
import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-no-write-guard';
import { createBrazilReceitaFullJoinPrivateChannelFileSystem } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-private-channel-fs';
import { createBrazilReceitaFullJoinBenchmarkAttemptLedger } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-resource-benchmark';
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
  // BR-SOURCE-ATTEMPT2-OPS § 3, § 4. The three process-scoped approvals, and the flags that grant them.
  //
  // Two codes rather than one because the two situations call for different operator actions. An
  // invocation carrying NONE of the three never attempted to authorize anything and is told so; one
  // carrying two of three tried and left a gap, and is told which.
  'operator_approval_declarations_missing',
  'generic_override_flag_not_supported',
  // The observed side of the national-input gate (§ 7). A manifest that cannot be read as a control
  // document yields no inventory at all, which is a different fact from an inventory that is short.
  'national_input_inventory_unreadable',
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
   *
   * The same fact as `operatorAuthorization.ownerAuthorization`, read from the same flag and kept as a
   * named field because 14B.0J's wall is phrased in terms of it. It is a view of the grant, never a
   * second source of truth.
   */
  readonly secondRealAttemptOwnerDeclared: boolean;
  /**
   * The three PROCESS-SCOPED approvals this invocation carries (BR-SOURCE-ATTEMPT2-OPS § 2–§ 4).
   *
   * Each is `false` unless its own explicit flag is present. Nothing derives one from another, nothing
   * derives any of them from the tracked authorization constant, and the grant is not written anywhere:
   * it lives in this parse result, is handed to the entry point, and dies with the process.
   */
  readonly operatorAuthorization: BrazilReceitaAttempt2OperatorAuthorization;
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
  // BR-SOURCE-ATTEMPT2-OPS § 3. A generic override flag is refused before the mode is even read: it
  // names no policy, so there is no invocation shape in which honouring it would be correct, and
  // ignoring it would let an operator believe they had granted something.
  const operatorGrant = resolveBrazilReceitaAttempt2OperatorAuthorization(argv);
  if (!operatorGrant.ok) return { ok: false, refusal: 'generic_override_flag_not_supported' };

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
        // `--readiness` reports the MECHANISM, so it reports the default grant rather than the one on the
        // command line: a readiness call that echoed an operator's flags back would make the report a
        // function of how it was invoked.
        secondRealAttemptOwnerDeclared: false,
        operatorAuthorization: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
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
      secondRealAttemptOwnerDeclared: operatorGrant.authorization.ownerAuthorization,
      operatorAuthorization: operatorGrant.authorization,
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
 * Builds the nineteen declarations from the parsed options, the § 11 proposed profile and — since
 * BR-SOURCE-ATTEMPT2-OPS — this invocation's operator grant and observed input inventory.
 *
 * ── The three POLICY approvals (§ 2) ────────────────────────────────────────────
 * They used to be three copies of one tracked constant, which meant an operator could not express any
 * of them and a source edit expressed all three at once. They are now read from the grant, one flag
 * each: `temporaryStoragePolicyApproved` is not inferred from `capInputPolicyApproved`, neither is
 * inferred from `benchmarkAuthorization`, and none of them is read from
 * `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG`. An invocation with no flags produces
 * three `false`s, exactly as before.
 *
 * ── The § 7 national-input gate, now with both sides (§ 6–§ 8) ──────────────────
 * EXPECTED comes from 14B.0K's publisher-derived 2026-07 inventory, resolved for the DECLARED period —
 * a period with no transcribed listing still gets no expectation. OBSERVED comes from the manifest this
 * invocation selected, scanned for family, part ordinal, presence, regular-file-ness and symlink-ness
 * and nothing else. `observedInventory` is optional and defaults to "not inspected", which the gate
 * answers with `indeterminate`: a caller that has not looked is refused, never waved through.
 *
 * Exported for the same reason the parser is: it is the part a synthetic test needs to exercise.
 */
export function buildBrazilReceitaRealFullScanDeclarations(
  options: BrazilReceitaRealFullScanCliOptions,
  observedInventory: BrazilReceitaObservedInputInventoryResult | null = null,
): BrazilReceitaRealFullScanDeclarations {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  const grant = options.operatorAuthorization ?? BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT;
  return {
    // Three separate approvals from three separate flags. Never one value copied three times.
    temporaryStoragePolicyApproved: grant.temporaryStoragePolicyApproved,
    capInputPolicyApproved: grant.capInputPolicyApproved,
    benchmarkAuthorization: grant.ownerAuthorization,
    attemptCount: proposal.attemptCount,
    requestedRealAttemptNumber: options.requestedRealAttemptNumber,
    nationalInputCompleteness: evaluateBrazilReceitaAttempt2NationalInputPreflight({
      period: options.datasetPeriod,
      observedInventory,
    }).completeness,
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
  observedInventory: BrazilReceitaObservedInputInventoryResult | null = null,
): BrazilReceitaRealFullScanBenchmarkRequest {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  return {
    declarations: buildBrazilReceitaRealFullScanDeclarations(options, observedInventory),
    // The grant travels WITH the request rather than being read from a module, so it is scoped to this
    // call and there is nowhere for it to persist (BR-SOURCE-ATTEMPT2-OPS § 13).
    operatorAuthorization: options.operatorAuthorization,
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
        '--real-attempt-number <n> ' +
        '[--second-real-attempt-owner-authorized --temporary-storage-policy-approved ' +
        '--cap-input-policy-approved]\n',
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

  // The AUTHORIZATION wall, at the operator surface (BR-SOURCE-ATTEMPT2-OPS § 2–§ 4).
  //
  // It no longer asks whether a tracked constant is `true`; it asks whether THIS invocation carries all
  // three approvals. Refused HERE, before any port is built, so the message names the missing flags —
  // the entry point's `authorization` stage refuses too, and that one is the guarantee.
  //
  // Two codes, because the two situations need different words. An invocation with none of the three
  // never tried to authorize anything; one with a gap did, and needs to be told where the gap is.
  if (parsed.options.mode === 'real-full-scan-resource-benchmark') {
    const missingApprovals = findBrazilReceitaAttempt2MissingOperatorApprovals(
      parsed.options.operatorAuthorization,
    );
    if (
      missingApprovals.length > 0 &&
      !BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG
    ) {
      const code =
        missingApprovals.length === 3
          ? 'real_benchmark_not_authorized'
          : 'operator_approval_declarations_missing';
      process.stderr.write(`${code}\n`);
      process.stderr.write(
        `Missing operator approvals: ${missingApprovals.join(', ')}. ` +
          'All three are required, none is inferred from another, and each lasts for this ' +
          'invocation only. Re-run with the corresponding flags after an owner decision.\n',
      );
      process.exitCode = 1;
      return;
    }
  }

  // ── The OBSERVED side of the national-input gate (§ 7, § 8, § 12) ─────────────
  //
  // Built from the manifest THIS invocation selected, through the same size-capped `lstat`-only adapter
  // the descriptor bridge uses. Metadata only: family, part ordinal, presence, regular-file-ness,
  // symlink-ness. No CSV row is read, no source reader is constructed, and no join is performed.
  //
  // It runs for the synthetic mode too. The smoke test exists to prove the wiring, and a smoke run that
  // skipped the inventory would be proving a different code path from the one a real run takes.
  const observedInventory = buildBrazilReceitaObservedInputInventory({
    manifestPath: parsed.options.manifestPath,
    fileSystem: createBrazilReceitaFullJoinBridgeFileSystem(),
  });
  if (!observedInventory.ok) {
    // Nothing was inspected, so there is no observed inventory to compare. Refused here rather than
    // handed to the gate as an empty record: "the manifest could not be read" and "the manifest is
    // short" are different facts and must not share a verdict.
    process.stderr.write('national_input_inventory_unreadable\n');
    process.stderr.write(`${observedInventory.refusals.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  // The preflight, reported before the run so an operator sees WHY the gate answered as it did — the
  // expected part identities, the observed descriptor counts per required family (§ 11's 10 + 10), and
  // the verdict. Codes, counts and opaque part keys only; no path and no file name.
  const nationalInput = evaluateBrazilReceitaAttempt2NationalInputPreflight({
    period: parsed.options.datasetPeriod,
    observedInventory,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        nationalInputPreflight: {
          period: nationalInput.period,
          expectedInventorySource: nationalInput.expectedInventorySource,
          expectedInventoryStatus: nationalInput.expectedInventoryStatus,
          expectedInventoryDeclared: nationalInput.expectedInventoryDeclared,
          observedInventoryDeclared: nationalInput.observedInventoryDeclared,
          expectedPartKeysByFamily: nationalInput.expectedPartKeysByFamily,
          observedDescriptorCountsByFamily: nationalInput.observedDescriptorCountsByFamily,
          declaredInputScope: observedInventory.declaredInputScope,
          partFindings: observedInventory.partFindings,
          verdict: nationalInput.completeness.verdict,
          inputScope: nationalInput.completeness.inputScope,
          findings: nationalInput.completeness.findings,
          satisfiesAttempt2: nationalInput.satisfiesAttempt2,
          requiredAttempt2InputScope: nationalInput.requiredAttempt2InputScope,
          rowsRead: nationalInput.rowsRead,
          sourceReaderCalls: nationalInput.sourceReaderCalls,
        },
      },
      null,
      2,
    )}\n`,
  );

  // Synthetic smoke: the same entry point, the same declarations, the same ports — against whatever
  // synthetic manifest the operator pointed at. It refuses at `authorization` exactly as the real
  // mode does when no grant is present, which is the point: the smoke test proves the wiring, not the
  // permission.
  const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(
    buildBrazilReceitaRealFullScanRequest(parsed.options, Date.now(), observedInventory),
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
          // BR-SOURCE-ATTEMPT2-OPS § 4: which of the three approvals this invocation did not carry.
          missingOperatorApprovals: outcome.missingOperatorApprovals,
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
