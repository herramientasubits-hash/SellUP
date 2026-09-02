/**
 * BR Receita CNPJ — NATIONAL CHUNK OPERATOR CLI (BR-SOURCE prod-resume loader).
 *
 * The operator entry point for ONE thing: running a single Stage-3 ordinal window through the
 * ALREADY-EXISTING national chunk loader. It holds no join logic, no accounting rules and no
 * refusal semantics of its own beyond argument shape — everything that decides whether a chunk
 * is acceptable lives in `loadBrReceitaNationalChunk()`, which this file calls and never
 * reimplements.
 *
 * ── The only mode ───────────────────────────────────────────────────────────────
 *   --mode benchmark
 *       Loads one ordinal window into a detached, already-created run and prints the accounting.
 *       It is the ONLY value this CLI recognises. `publish`, `attach` and `begin-run` are not
 *       unimplemented-but-reachable: they are not in `BR_RECEITA_OPERATOR_CHUNK_MODES`, so an
 *       operator asking for one is refused at parse time with `mode_not_supported`, before any
 *       port is touched and before a single byte is read.
 *
 * ── What it structurally cannot do ──────────────────────────────────────────────
 * Promote a run, demote a run, attach a partition, create a run, or write outside the run the
 * operator named. That is not a promise this file makes: the loader it calls returns
 * `published: false` on every path, and the two gateway methods that could change a period's
 * published state are never referenced here. A grep of this file's code for a promotion or
 * run-creation call comes back empty, and the test suite asserts exactly that against the
 * comment-stripped source.
 *
 * ── Runtime ports ───────────────────────────────────────────────────────────────
 * The SQL executor, the write gateway, the reference catalogs and the engine request are
 * INJECTED. There is no production wiring in this file and no connection string anywhere near
 * it — an invocation that arrives without ports is refused with `runtime_ports_not_wired`
 * rather than defaulting to some environment the operator did not name.
 *
 * `runBrReceitaOperatorChunkCli()` is the executable path: it asks
 * `br-receita-operator-chunk-runtime` for those ports and hands them to `main()`. The provider is
 * a SEPARATE module on purpose — it is the only file that reads `DATABASE_URL`, resolves the
 * manifest and refuses the transaction pooler, so this file's "cannot invent a runtime" property
 * stays a property of this source rather than a claim about it. `main(argv, null)` still refuses.
 *
 * ── What it prints ──────────────────────────────────────────────────────────────
 * Mode, period, run id, fingerprint, ordinals, statuses and counts. No path, no file name, no
 * directory, no row, no cell, no CNPJ, no join key. Refusals carry a fixed code and never
 * embed an operator value.
 *
 * Usage:
 *   npm run br-source:operator-chunk -- \
 *     --run-id <uuid> \
 *     --period 2026-07 \
 *     --fingerprint sha256:<64 hex> \
 *     --partition-start 0 \
 *     --partition-count 128 \
 *     --mode benchmark \
 *     --manifest /absolute/path/to/manifest.json \
 *     --workspace-parent /absolute/path/outside/repo/and/home \
 *     --max-output-rows <n> \
 *     --second-real-attempt-owner-authorized \
 *     --temporary-storage-policy-approved \
 *     --cap-input-policy-approved
 *
 * with `DATABASE_URL` pointing at a SESSION or DIRECT connection on port 5432.
 */

import { BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-existing-run-chunk-writer';
import {
  BrReceitaNationalChunkLoaderError,
  loadBrReceitaNationalChunk,
  type BrReceitaNationalChunkEngineBaseRequest,
  type BrReceitaNationalChunkEngineRunner,
  type BrReceitaNationalChunkLoadResult,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-chunk-loader';
import type { BrReceitaNationalReferenceCatalogs } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-match-projector';
import type { BrReceitaNationalMaterializationCapKey } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-materialization-envelope';
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BrReceitaOperatorChunkRuntimeError,
  createBrReceitaOperatorChunkRuntimeEnvironment,
  parseBrReceitaOperatorChunkRuntimeArgs,
  provideBrReceitaOperatorChunkRuntime,
  type BrReceitaOperatorChunkRuntimeEnvironment,
} from './br-receita-operator-chunk-runtime';

/**
 * The whole mode surface. A mode absent from this tuple is refused at parse time — which is why
 * publication and run creation are unreachable by construction rather than by a guard someone
 * could later relax.
 */
export const BR_RECEITA_OPERATOR_CHUNK_MODES = ['benchmark'] as const;

export type BrReceitaOperatorChunkMode = (typeof BR_RECEITA_OPERATOR_CHUNK_MODES)[number];

/** Fixed refusal codes. A code never embeds an operator value. */
export const BR_RECEITA_OPERATOR_CHUNK_REFUSALS = [
  'run_id_not_declared',
  'run_id_invalid',
  'period_not_declared',
  'period_invalid',
  'fingerprint_not_declared',
  'fingerprint_invalid',
  'partition_start_not_declared',
  'partition_start_invalid',
  'partition_count_not_declared',
  'partition_count_invalid',
  'partition_range_invalid',
  'mode_not_declared',
  'mode_not_supported',
  'runtime_ports_not_wired',
  'chunk_loader_refused',
] as const;

export type BrReceitaOperatorChunkRefusal = (typeof BR_RECEITA_OPERATOR_CHUNK_REFUSALS)[number];

export class BrReceitaOperatorChunkRefusalError extends Error {
  readonly code: BrReceitaOperatorChunkRefusal;

  constructor(code: BrReceitaOperatorChunkRefusal) {
    super(`br receita operator chunk refused (${code})`);
    this.name = 'BrReceitaOperatorChunkRefusalError';
    this.code = code;
  }
}

/** Exit codes. `2` is always a refusal; `1` is a real run the engine did not complete. */
export const BR_RECEITA_OPERATOR_CHUNK_EXIT = {
  loaded: 0,
  engineAborted: 1,
  refused: 2,
} as const;

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/**
 * Shape only. The loader re-derives and re-validates the fingerprint and remains authoritative;
 * this check exists so a malformed declaration is refused before any port is opened.
 */
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

export interface BrReceitaOperatorChunkOptions {
  readonly mode: BrReceitaOperatorChunkMode;
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly inventoryFingerprint: string;
  readonly partitionOrdinalStart: number;
  readonly partitionOrdinalCount: number;
}

/**
 * Everything the loader needs that this CLI refuses to invent. Supplied by the caller; there is
 * no default, no environment lookup and no fallback.
 */
export interface BrReceitaOperatorChunkPorts {
  readonly sourceYear: number;
  readonly sql: BrReceitaSqlExecutor;
  readonly gateway: BrReceitaSnapshotWriteGateway;
  readonly catalogs: BrReceitaNationalReferenceCatalogs;
  readonly materializationCaps: Readonly<
    Partial<Record<BrReceitaNationalMaterializationCapKey, unknown>>
  > | null;
  readonly engineRequest: BrReceitaNationalChunkEngineBaseRequest;
  readonly runEngine?: BrReceitaNationalChunkEngineRunner;
}

function refuse(code: BrReceitaOperatorChunkRefusal): never {
  throw new BrReceitaOperatorChunkRefusalError(code);
}

function readFlag(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
}

function readOrdinal(
  argv: readonly string[],
  flag: string,
  missing: BrReceitaOperatorChunkRefusal,
  invalid: BrReceitaOperatorChunkRefusal,
): number {
  const raw = readFlag(argv, flag);
  if (raw === null) refuse(missing);
  // A decimal, a sign, whitespace or a hex literal is a malformed declaration, not a number to
  // coerce: `Number('0x40')` would silently accept an ordinal the operator did not type.
  if (!INTEGER_PATTERN.test(raw)) refuse(invalid);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) refuse(invalid);
  return parsed;
}

/**
 * Parses and validates the operator declaration. Argument SHAPE only — every substantive rule
 * (existing detached run, pinned 1024-partition map, reject duplicate policy, materialization
 * caps, accounting) belongs to the loader and is re-checked there.
 */
export function parseBrReceitaOperatorChunkArgs(
  argv: readonly string[],
): BrReceitaOperatorChunkOptions {
  const mode = readFlag(argv, '--mode');
  if (mode === null) refuse('mode_not_declared');
  if (!(BR_RECEITA_OPERATOR_CHUNK_MODES as readonly string[]).includes(mode)) {
    refuse('mode_not_supported');
  }

  const runId = readFlag(argv, '--run-id');
  if (runId === null) refuse('run_id_not_declared');
  if (!RUN_ID_PATTERN.test(runId)) refuse('run_id_invalid');

  const period = readFlag(argv, '--period');
  if (period === null) refuse('period_not_declared');
  if (!PERIOD_PATTERN.test(period)) refuse('period_invalid');

  const fingerprint = readFlag(argv, '--fingerprint');
  if (fingerprint === null) refuse('fingerprint_not_declared');
  if (!FINGERPRINT_PATTERN.test(fingerprint)) refuse('fingerprint_invalid');

  const partitionOrdinalStart = readOrdinal(
    argv,
    '--partition-start',
    'partition_start_not_declared',
    'partition_start_invalid',
  );
  const partitionOrdinalCount = readOrdinal(
    argv,
    '--partition-count',
    'partition_count_not_declared',
    'partition_count_invalid',
  );

  if (
    partitionOrdinalCount <= 0 ||
    partitionOrdinalStart >= BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT ||
    partitionOrdinalStart + partitionOrdinalCount > BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT
  ) {
    refuse('partition_range_invalid');
  }

  return {
    mode: mode as BrReceitaOperatorChunkMode,
    snapshotRunId: runId,
    sourcePeriod: period,
    inventoryFingerprint: fingerprint,
    partitionOrdinalStart,
    partitionOrdinalCount,
  };
}

export interface BrReceitaOperatorChunkReport {
  readonly mode: BrReceitaOperatorChunkMode;
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly inventoryFingerprint: string;
  readonly partitionOrdinalStart: number;
  readonly partitionOrdinalCount: number;
  readonly partitionOrdinalEndExclusive: number;
  readonly status: BrReceitaNationalChunkLoadResult['status'];
  readonly published: false;
  readonly engineExitStatus: string;
  readonly matchesReceived: number;
  readonly parserAcceptedRows: number;
  readonly parserRejectedRows: number;
  readonly writerAcceptedRows: number;
  readonly writerWrittenRows: number;
  readonly writerCollapsedInBatchCount: number;
}

/**
 * Runs ONE window through the loader. The loader is called, never reimplemented: this function
 * forwards the operator declaration and the injected ports and shapes the result for printing.
 */
export async function runBrReceitaOperatorChunk(
  options: BrReceitaOperatorChunkOptions,
  ports: BrReceitaOperatorChunkPorts,
): Promise<BrReceitaOperatorChunkReport> {
  const result = await loadBrReceitaNationalChunk({
    snapshotRunId: options.snapshotRunId,
    sourcePeriod: options.sourcePeriod,
    sourceYear: ports.sourceYear,
    inventoryFingerprint: options.inventoryFingerprint,
    partitionOrdinalStart: options.partitionOrdinalStart,
    partitionOrdinalCount: options.partitionOrdinalCount,
    materializationCaps: ports.materializationCaps,
    sql: ports.sql,
    gateway: ports.gateway,
    catalogs: ports.catalogs,
    engineRequest: ports.engineRequest,
    runEngine: ports.runEngine,
  });

  return {
    mode: options.mode,
    snapshotRunId: result.snapshotRunId,
    sourcePeriod: result.sourcePeriod,
    inventoryFingerprint: result.inventoryFingerprint,
    partitionOrdinalStart: result.partitionOrdinalStart,
    partitionOrdinalCount: result.partitionOrdinalCount,
    partitionOrdinalEndExclusive: result.partitionOrdinalStart + result.partitionOrdinalCount,
    status: result.status,
    published: false,
    engineExitStatus: result.engine.exitStatus,
    matchesReceived: result.projector.matchesReceived,
    parserAcceptedRows: result.projector.parserAcceptedRows,
    parserRejectedRows: result.projector.parserRejectedRows,
    writerAcceptedRows: result.writer.acceptedRows,
    writerWrittenRows: result.writer.writtenRows,
    writerCollapsedInBatchCount: result.writer.collapsedInBatchCount,
  };
}

export function formatBrReceitaOperatorChunkReport(report: BrReceitaOperatorChunkReport): string {
  return [
    'BR-SOURCE — NATIONAL CHUNK OPERATOR',
    `mode                                 ${report.mode}`,
    `period                               ${report.sourcePeriod}`,
    `snapshot_run_id                      ${report.snapshotRunId}`,
    `inventory_fingerprint                ${report.inventoryFingerprint}`,
    `partition_ordinal_start              ${report.partitionOrdinalStart}`,
    `partition_ordinal_count              ${report.partitionOrdinalCount}`,
    `partition_ordinal_end_exclusive      ${report.partitionOrdinalEndExclusive}`,
    `status                               ${report.status}`,
    `engine_exit_status                   ${report.engineExitStatus}`,
    `matches_received                     ${report.matchesReceived}`,
    `parser_accepted_rows                 ${report.parserAcceptedRows}`,
    `parser_rejected_rows                 ${report.parserRejectedRows}`,
    `writer_accepted_rows                 ${report.writerAcceptedRows}`,
    `writer_written_rows                  ${report.writerWrittenRows}`,
    `writer_collapsed_in_batch            ${report.writerCollapsedInBatchCount}`,
    // Printed next to the status, because a status alone reads as a finished import until this
    // line says the month is still unpublished.
    `published                            ${report.published}`,
  ].join('\n');
}

/**
 * RETURNS the process exit code; it does not set `process.exitCode` and never calls
 * `process.exit`. Only the direct-execution block below turns the returned code into a process
 * status, which is what lets the whole path — refusals included — run in-process under the test
 * runner without a refusal marking the test process itself as failed.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  ports: BrReceitaOperatorChunkPorts | null = null,
): Promise<number> {
  let options: BrReceitaOperatorChunkOptions;
  try {
    options = parseBrReceitaOperatorChunkArgs(argv);
  } catch (error) {
    const code =
      error instanceof BrReceitaOperatorChunkRefusalError ? error.code : 'mode_not_supported';
    process.stderr.write(`REFUSED ${code}\n`);
    return BR_RECEITA_OPERATOR_CHUNK_EXIT.refused;
  }

  if (ports === null) {
    // No environment lookup, no connection string, no default gateway. An operator who has not
    // supplied a runtime gets a refusal, not a run against whatever database happened to be
    // reachable.
    process.stderr.write('REFUSED runtime_ports_not_wired\n');
    return BR_RECEITA_OPERATOR_CHUNK_EXIT.refused;
  }

  let report: BrReceitaOperatorChunkReport;
  try {
    report = await runBrReceitaOperatorChunk(options, ports);
  } catch (error) {
    const reason =
      error instanceof BrReceitaNationalChunkLoaderError ? error.reason : 'chunk_loader_refused';
    process.stderr.write(`REFUSED chunk_loader_refused ${reason}\n`);
    return BR_RECEITA_OPERATOR_CHUNK_EXIT.refused;
  }

  process.stdout.write(`${formatBrReceitaOperatorChunkReport(report)}\n`);
  return report.status === 'loaded_not_published'
    ? BR_RECEITA_OPERATOR_CHUNK_EXIT.loaded
    : BR_RECEITA_OPERATOR_CHUNK_EXIT.engineAborted;
}

/**
 * The EXECUTABLE path: provision a runtime, run one window, release the session.
 *
 * Kept separate from `main()` so `main(argv, null)` keeps meaning exactly what it meant — a
 * declaration that arrived with no runtime is refused, not quietly provisioned.
 *
 * The declaration's SHAPE is checked first, by the same parser `main()` uses. Parsing twice is the
 * price of an ordering guarantee worth having: a missing `--run-id` must not open a manifest, read a
 * catalog or connect to a database before anyone notices, and the parser is pure.
 */
export async function runBrReceitaOperatorChunkCli(
  argv: readonly string[] = process.argv.slice(2),
  environment: BrReceitaOperatorChunkRuntimeEnvironment = createBrReceitaOperatorChunkRuntimeEnvironment(),
): Promise<number> {
  try {
    parseBrReceitaOperatorChunkArgs(argv);
  } catch (error) {
    const code =
      error instanceof BrReceitaOperatorChunkRefusalError ? error.code : 'mode_not_supported';
    process.stderr.write(`REFUSED ${code}\n`);
    return BR_RECEITA_OPERATOR_CHUNK_EXIT.refused;
  }

  let runtime: Awaited<ReturnType<typeof provideBrReceitaOperatorChunkRuntime>>;
  try {
    runtime = await provideBrReceitaOperatorChunkRuntime(
      parseBrReceitaOperatorChunkRuntimeArgs(argv),
      environment,
    );
  } catch (error) {
    const code =
      error instanceof BrReceitaOperatorChunkRuntimeError ? error.code : 'runtime_ports_not_wired';
    process.stderr.write(`REFUSED ${code}\n`);
    return BR_RECEITA_OPERATOR_CHUNK_EXIT.refused;
  }

  try {
    return await main(argv, runtime.ports);
  } finally {
    // Released whatever happened, including a refusal inside the loader: a held session would keep
    // the run's detached partition pinned by an idle backend.
    await runtime.close();
  }
}

// Only auto-run when executed directly (never when imported by a test file, whose path ends with
// ".test.ts", and never from the runtime module, whose path ends with "-runtime.ts").
const executedFile = process.argv[1] ?? '';
if (executedFile.endsWith('br-receita-operator-chunk.ts')) {
  void runBrReceitaOperatorChunkCli().then((exit) => {
    process.exitCode = exit;
  });
}
