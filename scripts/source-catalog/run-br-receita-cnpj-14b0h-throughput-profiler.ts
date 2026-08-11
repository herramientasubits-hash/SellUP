/**
 * BR Receita CNPJ — BR-SOURCE-14B.0H SYNTHETIC THROUGHPUT PROFILER (local, not a CI gate).
 *
 * Answers ONE question with a measurement instead of an assumption: why did BR-SOURCE-14B.0G's
 * reference pass run at ~642 rows/s, and does buffering the partition writer fix it. SYNTHETIC ONLY —
 * no Receita manifest, no Empresas file, no Estabelecimentos file, and no import of anything that
 * could open one. This script never touches Supabase, the runtime, Agent 1, Agent 2A, a provider or
 * HubSpot, and it performs no second real benchmark: `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_*`
 * constants are not imported here at all.
 *
 * ── What is actually compared ────────────────────────────────────────────────────
 * The BASELINE harness below is a deliberately small, non-productive reimplementation of exactly the
 * write pattern BR-SOURCE-14B.0G's engine used: one synchronous `fs.write`-shaped syscall per 16-byte
 * reference, through the SAME handle pool, the SAME encoder and the SAME partition-naming function the
 * production workspace uses. It is not a second engine — it shares every primitive with production
 * except the one line that used to call `fileSystem.write` per record, which this script keeps for
 * comparison ONLY because BR-SOURCE-14B.0H's own spec allows exactly that ("no duplicar el engine
 * productivo entero"). The OPTIMIZED side calls the real, current, buffered
 * `createBrazilReceitaFullJoinPartitionWorkspace` — no reimplementation at all.
 *
 * Run with: node --import tsx scripts/source-catalog/run-br-receita-cnpj-14b0h-throughput-profiler.ts
 *           [--rows=200000] [--partitions=1024]
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBrazilReceitaFullJoinOpenHandleLedger,
  type BrazilReceitaFullJoinOpenHandleLedger,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-open-handle-ledger';
import {
  BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES,
  createBrazilReceitaFullJoinPartitionHandlePool,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-partition-handle-pool';
import {
  brazilReceitaFullJoinPartitionOrdinalFor,
  normalizeBrazilReceitaFullJoinKey,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine-contract';
import {
  BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE,
  brazilReceitaFullJoinPartitionFileName,
  createBrazilReceitaFullJoinPartitionWorkspace,
  encodeBrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinWorkspaceFileSystem,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-partition-workspace';

// ─── CLI args ───────────────────────────────────────────────────────────────────

function argNumber(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found === undefined) return fallback;
  const value = Number(found.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const TOTAL_REFERENCES = argNumber('rows', 200_000);
const PARTITION_COUNT = argNumber('partitions', 1_024);

// ─── Real fs primitives (this script is a benchmark harness, not the engine) ──

function realWorkspaceFileSystem(): BrazilReceitaFullJoinWorkspaceFileSystem {
  return {
    makeTemporaryDirectory(parentDirectory, prefix) {
      return fs.mkdtempSync(path.join(parentDirectory, prefix));
    },
    chmod(targetPath, mode) {
      fs.chmodSync(targetPath, mode);
    },
    statMode(targetPath) {
      return fs.lstatSync(targetPath).mode;
    },
    isSymbolicLink(targetPath) {
      return fs.lstatSync(targetPath).isSymbolicLink();
    },
    realPath(targetPath) {
      return fs.realpathSync(targetPath);
    },
    exists(targetPath) {
      try {
        fs.lstatSync(targetPath);
        return true;
      } catch {
        return false;
      }
    },
    openForAppend(filePath, mode) {
      return fs.openSync(filePath, 'a', mode);
    },
    openForRead(filePath) {
      return fs.openSync(filePath, 'r');
    },
    write(handle, data) {
      return fs.writeSync(handle, data);
    },
    read(handle, buffer, bufferOffset, length, position) {
      return fs.readSync(handle, buffer, bufferOffset, length, position);
    },
    close(handle) {
      fs.closeSync(handle);
    },
    listNames(directoryPath) {
      return fs.readdirSync(directoryPath);
    },
    removeFile(filePath) {
      fs.unlinkSync(filePath);
    },
    removeDirectory(directoryPath) {
      fs.rmdirSync(directoryPath);
    },
  };
}

/** Synthetic keys well under the sanitizer's 8-digit threshold even at millions of references. */
function syntheticKey(index: number): string {
  return `SYN_K${String(index).padStart(7, '0')}`;
}

interface GeneratedReference {
  readonly reference: BrazilReceitaFullJoinRowReference;
  readonly ordinal: number;
}

/**
 * Deterministic, shared between both harnesses so they see byte-identical work.
 *
 * ONE family fully, then the other — never interleaved. This matters: the real engine's reference
 * pass processes Empresas to EOF and Estabelecimentos to EOF as two SEPARATE passes (BR-SOURCE-
 * 14B.0D's "three passes" design), so within any one pass only ONE family's partition names are ever
 * being touched. Interleaving them here would double the distinct names competing for the same
 * `maxOpenPartitionFiles` cache and manufacture eviction pressure the real engine never has.
 */
function generateReferences(count: number, partitionCount: number): readonly GeneratedReference[] {
  const out: GeneratedReference[] = [];
  const families: readonly ('empresas' | 'estabelecimentos')[] = ['empresas', 'estabelecimentos'];
  const perFamily = Math.ceil(count / families.length);
  let index = 0;
  for (const family of families) {
    for (let withinFamily = 0; withinFamily < perFamily && index < count; withinFamily += 1) {
      const key = normalizeBrazilReceitaFullJoinKey(syntheticKey(index));
      const ordinal = key === null ? 0 : brazilReceitaFullJoinPartitionOrdinalFor(key, partitionCount);
      out.push({
        reference: {
          sourceFileOrdinal: 0,
          byteOffset: index * 61,
          byteLength: 60,
          family,
        },
        ordinal,
      });
      index += 1;
    }
  }
  return out;
}

// ─── BASELINE: one synchronous write syscall per reference (pre-14B.0H behavior) ─

interface BaselineResult {
  readonly durationMs: number;
  readonly partitionWriteSyscalls: number;
  readonly bytesWritten: number;
  readonly evictions: number;
  readonly reopens: number;
  readonly peakOpen: number;
}

function runBaselineUnbufferedWriter(
  parentDirectory: string,
  references: readonly GeneratedReference[],
  maxOpenPartitionFiles: number,
): BaselineResult {
  const directory = fs.mkdtempSync(path.join(parentDirectory, 'baseline-'));
  const fileSystem = realWorkspaceFileSystem();
  const ledger: BrazilReceitaFullJoinOpenHandleLedger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const hardened = new Set<string>();
  let partitionWriteSyscalls = 0;
  let bytesWritten = 0;

  const pool = createBrazilReceitaFullJoinPartitionHandlePool({
    maxOpenPartitionFiles,
    ledger,
    port: {
      open(key) {
        const name = key.slice(2);
        return fs.openSync(
          path.join(directory, name),
          'a',
          BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE,
        );
      },
      close(handle) {
        fs.closeSync(handle);
      },
    },
  });

  const startedAt = process.hrtime.bigint();
  for (const { reference, ordinal } of references) {
    const name = brazilReceitaFullJoinPartitionFileName(reference.family, ordinal);
    if (name === null) continue;
    const encoded = encodeBrazilReceitaFullJoinRowReference(reference);
    if (!encoded.ok) continue;
    const acquired = pool.acquire(`a:${name}`);
    if (!acquired.ok) continue;
    if (!hardened.has(name)) {
      fs.chmodSync(path.join(directory, name), BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE);
      hardened.add(name);
    }
    // The exact pattern BR-SOURCE-14B.0G ran: one `fs.write` syscall for this one 16-byte record.
    fileSystem.write(acquired.handle, encoded.record);
    partitionWriteSyscalls += 1;
    bytesWritten += BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;
  }
  const stats = pool.stats();
  pool.closeAll();
  const elapsedNs = process.hrtime.bigint() - startedAt;

  for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
  fs.rmdirSync(directory);

  return {
    durationMs: Number(elapsedNs) / 1_000_000,
    partitionWriteSyscalls,
    bytesWritten,
    evictions: stats.evictions,
    reopens: stats.reopens,
    peakOpen: stats.peakOpen,
  };
}

// ─── OPTIMIZED: the real, current, buffered production workspace ──────────────

interface OptimizedResult {
  readonly durationMs: number;
  readonly partitionWriteSyscalls: number;
  readonly fullBufferFlushes: number;
  readonly flushCount: number;
  readonly bytesWritten: number;
  readonly evictions: number;
  readonly reopens: number;
  readonly peakOpen: number;
}

function runOptimizedBufferedWriter(
  parentDirectory: string,
  references: readonly GeneratedReference[],
  maxOpenPartitionFiles: number,
): OptimizedResult {
  // `minimumFreeDiskReserve` must be >= `maxTemporaryStorageBytes` (the workspace enforces that the
  // reserve threshold can never be looser than the cap it backs), so the cap is sized to the run and
  // the reserve/before-start thresholds are set comfortably above it.
  const maxTemporaryStorageBytes =
    references.length * BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES + 1_048_576;
  const creation = createBrazilReceitaFullJoinPartitionWorkspace({
    parentDirectory,
    boundaries: {
      repositoryRoot: '/nonexistent/repo-root-for-benchmark',
      homeDirectory: '/nonexistent/home-for-benchmark',
      datasetRoot: null,
    },
    fileSystem: realWorkspaceFileSystem(),
    maxTemporaryStorageBytes,
    maxOpenPartitionFiles,
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(64),
    minimumFreeDiskBeforeStart: maxTemporaryStorageBytes,
    minimumFreeDiskReserve: maxTemporaryStorageBytes,
    freeDiskProbe: () => 64 * 1024 * 1024 * 1024,
    realDataRun: false,
  });
  if (!creation.ok) {
    throw new Error(`benchmark workspace refused to create: ${JSON.stringify(creation.rejections)}`);
  }
  const { workspace } = creation;

  // Timed end-to-end, INCLUDING dispose(): BR-SOURCE-14B.0H decouples a partition's write buffer from
  // its handle, so most of a run's actual bytes-to-disk work can now happen inside dispose()'s final
  // flush of whatever never filled a buffer on its own during the append loop. Timing only the append
  // loop would under-report the real cost — the engine calls this exact path (via `releaseWorkspace`)
  // on every run, success or abort, so dispose() is not optional overhead to exclude.
  const startedAt = process.hrtime.bigint();
  for (const { reference, ordinal } of references) {
    workspace.appendReference(reference, ordinal);
  }
  const bytesWritten = workspace.bytesWritten();
  workspace.dispose();
  const elapsedNs = process.hrtime.bigint() - startedAt;

  const writeStats = workspace.writeStats();
  const handleStats = workspace.handleStats();

  return {
    durationMs: Number(elapsedNs) / 1_000_000,
    partitionWriteSyscalls: writeStats.partitionWriteSyscalls,
    fullBufferFlushes: writeStats.fullBufferFlushes,
    flushCount: writeStats.flushCount,
    bytesWritten,
    evictions: handleStats.evictions,
    reopens: handleStats.reopens,
    peakOpen: handleStats.peakOpen,
  };
}

// ─── Report ─────────────────────────────────────────────────────────────────────

function rowsPerSecond(rows: number, durationMs: number): number {
  return durationMs <= 0 ? Infinity : (rows / durationMs) * 1_000;
}

/**
 * MiB/s over SYNTHETIC REFERENCE-WRITE BYTES — 16 bytes per reference, the bytes this profiler's write
 * path actually moves.
 *
 * NOT source bytes read. The 68 GiB / 6 h requirement that motivated BR-SOURCE-14B.0G is expressed in
 * SOURCE bytes (~3.2 MiB/s of Receita file read), and the two denominators are not interchangeable:
 * one source row is tens to hundreds of bytes read and produces exactly one 16-byte reference written,
 * so a figure in this unit cannot be compared with, converted into, or substituted for a source-read
 * figure. Every key computed from this function is named `..._SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND`
 * so the denominator travels with the number.
 */
function syntheticReferenceWriteMibPerSecond(bytes: number, durationMs: number): number {
  return durationMs <= 0 ? Infinity : (bytes / (1024 * 1024) / durationMs) * 1_000;
}

// `--skip-baseline` — the pre-14B.0H write pattern is one syscall per reference, a per-row-constant
// cost independent of scale (measured stable across 5k/20k/200k rows in this same session); a 1M-row
// baseline run would take on the order of 20+ minutes to confirm a rate already established. This flag
// lets a large OPTIMIZED-only run complete quickly; the report labels baseline figures as extrapolated
// when this is set, rather than fabricating a new measurement.
const SKIP_BASELINE = process.argv.includes('--skip-baseline');

function main(): void {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const runRoot = fs.mkdtempSync(path.join(temporaryRoot, 'brfj-14b0h-profiler-'));

  const references = generateReferences(TOTAL_REFERENCES, PARTITION_COUNT);
  const maxOpenPartitionFiles = BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES;

  const baseline: BaselineResult = SKIP_BASELINE
    ? { durationMs: NaN, partitionWriteSyscalls: NaN, bytesWritten: NaN, evictions: NaN, reopens: NaN, peakOpen: NaN }
    : runBaselineUnbufferedWriter(runRoot, references, maxOpenPartitionFiles);
  const optimized = runOptimizedBufferedWriter(runRoot, references, maxOpenPartitionFiles);

  fs.rmSync(runRoot, { recursive: true, force: true });

  const report = {
    BASELINE_SKIPPED_THIS_RUN: SKIP_BASELINE,
    SYNTHETIC_FIXTURE_ROWS: TOTAL_REFERENCES,
    SYNTHETIC_FIXTURE_BYTES: TOTAL_REFERENCES * BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
    PARTITION_COUNT,
    MAX_OPEN_PARTITION_FILES: maxOpenPartitionFiles,

    BASELINE_DURATION_MS: Math.round(baseline.durationMs * 100) / 100,
    OPTIMIZED_DURATION_MS: Math.round(optimized.durationMs * 100) / 100,

    BASELINE_ROWS_PER_SECOND: Math.round(rowsPerSecond(TOTAL_REFERENCES, baseline.durationMs)),
    OPTIMIZED_ROWS_PER_SECOND: Math.round(rowsPerSecond(TOTAL_REFERENCES, optimized.durationMs)),
    SPEEDUP_ROWS_RATIO:
      Math.round(
        (rowsPerSecond(TOTAL_REFERENCES, optimized.durationMs) /
          rowsPerSecond(TOTAL_REFERENCES, baseline.durationMs)) *
          100,
      ) / 100,

    // Denominator carried in the key name on purpose — see `syntheticReferenceWriteMibPerSecond`.
    // These are REFERENCE-WRITE bytes (16 B/reference), never SOURCE-READ bytes, and therefore are not
    // comparable with the ~3.2 MiB/s source-read rate the 68 GiB / 6 h budget implies.
    THROUGHPUT_DENOMINATOR_NOTE:
      'MiB/s below = synthetic reference-write bytes (16 B/reference). NOT source bytes read. ' +
      'NOT comparable with, and never convertible into, SOURCE_READ_MIB_PER_SECOND.',
    BASELINE_SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND:
      Math.round(syntheticReferenceWriteMibPerSecond(baseline.bytesWritten, baseline.durationMs) * 1000) /
      1000,
    OPTIMIZED_SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND:
      Math.round(syntheticReferenceWriteMibPerSecond(optimized.bytesWritten, optimized.durationMs) * 1000) /
      1000,

    REFERENCE_RECORDS: TOTAL_REFERENCES,
    BASELINE_PARTITION_WRITE_CALLS: baseline.partitionWriteSyscalls,
    OPTIMIZED_PARTITION_WRITE_CALLS: optimized.partitionWriteSyscalls,
    WRITE_CALL_REDUCTION_RATIO:
      Math.round((baseline.partitionWriteSyscalls / Math.max(1, optimized.partitionWriteSyscalls)) * 100) /
      100,

    OPTIMIZED_FULL_BUFFER_FLUSHES: optimized.fullBufferFlushes,
    OPTIMIZED_FLUSH_COUNT: optimized.flushCount,

    BASELINE_EVICTIONS: baseline.evictions,
    BASELINE_REOPENS: baseline.reopens,
    BASELINE_PEAK_OPEN: baseline.peakOpen,
    OPTIMIZED_EVICTIONS: optimized.evictions,
    OPTIMIZED_REOPENS: optimized.reopens,
    OPTIMIZED_PEAK_OPEN: optimized.peakOpen,
    CACHE_HIT_RATE_APPROX:
      Math.round((1 - optimized.evictions / Math.max(1, TOTAL_REFERENCES)) * 10000) / 100,

    REAL_14B0G_OBSERVED_ROWS_PER_SECOND_HISTORICAL_REFERENCE_ONLY: 642,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
