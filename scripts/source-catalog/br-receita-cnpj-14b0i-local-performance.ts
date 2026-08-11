/**
 * BR Receita CNPJ — 14B.0I SYNTHETIC SOURCE-READ THROUGHPUT: local performance runner.
 *
 * A MANUAL, LOCAL harness. It is not a CI gate and never fails a build on a slow machine: it
 * generates a large SYNTHETIC fixture, drives the REAL production pipeline over it 1..N times
 * (default 3), and prints the § 22/§ 23 performance and decision reports. Every number it prints is
 * ENGINEERING_TARGET_ONLY — never Gate 2 evidence, never real-data evidence, never a production SLA.
 *
 * Usage:
 *   npx tsx scripts/source-catalog/br-receita-cnpj-14b0i-local-performance.ts \
 *     [--profile narrow|typical|wide] [--matched-companies N] [--runs N]
 *
 * ── This script NEVER ───────────────────────────────────────────────────────────
 *   - touches a real Receita file, a real manifest, Supabase, the runtime, Agent 1, a provider,
 *     HubSpot or the UI.
 *   - executes a real full-scan benchmark or authorizes one. It calls the SYNTHETIC entry point
 *     only, and `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` stays `false` throughout.
 *   - runs `sudo`, clears an OS cache, or spawns a process.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-resource-benchmark';
import {
  classifyBrazilReceita14B0ISourceReadThroughput,
  recommendBrazilReceita14B0ISecondRealBenchmark,
  runBrazilReceita14B0ISyntheticThroughputRuns,
  type BrazilReceita14B0IHarnessRunRequest,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0i-synthetic-throughput-harness';
import type { BrazilReceita14B0ISyntheticProfile } from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0i-synthetic-source-generator';

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface CliOptions {
  readonly profile: BrazilReceita14B0ISyntheticProfile;
  readonly matchedCompanies: number;
  readonly runs: number;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let profile: BrazilReceita14B0ISyntheticProfile = 'typical';
  let matchedCompanies = 480_000;
  let runs = 3;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      const value = argv[index + 1];
      if (value === 'narrow' || value === 'typical' || value === 'wide') profile = value;
      index += 1;
    } else if (arg === '--matched-companies') {
      const value = Number(argv[index + 1]);
      if (Number.isInteger(value) && value > 0) matchedCompanies = value;
      index += 1;
    } else if (arg === '--runs') {
      const value = Number(argv[index + 1]);
      if (Number.isInteger(value) && value > 0) runs = value;
      index += 1;
    }
  }
  return { profile, matchedCompanies, runs };
}

// ─── Working directory ────────────────────────────────────────────────────────

function findRepositoryRoot(startDirectory: string): string {
  let current = startDirectory;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string };
      if (typeof parsed.name === 'string' && parsed.name.startsWith('sellup')) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('could not locate the SellUp repository root from this script location');
}

function resolveWorkingDirectory(): BrazilReceita14B0IHarnessRunRequest['workingDirectory'] {
  const repositoryRoot = findRepositoryRoot(__dirname);
  const homeDirectory = os.homedir();
  const cwd = process.cwd();
  const packageName = (
    JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')) as { name: string }
  ).name;
  return {
    currentWorkingDirectory: cwd === homeDirectory ? repositoryRoot : cwd,
    homeDirectory,
    repositoryRoot,
    datasetRoot: null,
    repositoryPackageName: packageName,
  };
}

// ─── Report printing ──────────────────────────────────────────────────────────

function fmt(value: number | null, digits = 3): string {
  return value === null ? 'null' : value.toFixed(digits);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workingDirectory = resolveWorkingDirectory();

  const plan = {
    profile: options.profile,
    matchedCompanyCount: options.matchedCompanies,
    establishmentsPerMatchedCompany: 1,
    companiesWithoutEstablishmentCount: Math.round(options.matchedCompanies * 0.02),
    orphanEstablishmentCount: Math.round(options.matchedCompanies * 0.02),
    invalidKeyCompanyRows: 100,
    invalidKeyEstablishmentRows: 100,
    malformedCompanyRows: 50,
    malformedEstablishmentRows: 50,
    distribution: 'uniform' as const,
  };

  console.log('SYNTHETIC_PROFILE:', options.profile);
  console.log('MATCHED_COMPANIES:', options.matchedCompanies);
  console.log('RUNS:', options.runs);
  console.log('LOCAL_MACHINE_OBSERVATION: true');
  console.log('ENGINEERING_TARGET_ONLY: true');
  console.log('NOT_GATE2_EVIDENCE: true');
  console.log('NOT_REAL_DATA_EVIDENCE: true');
  console.log('NOT_PRODUCTION_SLA: true');
  console.log('');

  const aggregate = await runBrazilReceita14B0ISyntheticThroughputRuns(
    { mode: 'local_performance', plan, workingDirectory },
    options.runs,
  );

  for (const [index, run] of aggregate.runs.entries()) {
    console.log(`--- RUN ${index + 1} ---`);
    console.log('ok:', run.ok, 'exitStatus:', run.exitStatus, 'abortCode:', run.abortCode ?? 'none');
    console.log('SYNTHETIC_ROWS:', run.synthetic.syntheticRowsTotal);
    console.log('SYNTHETIC_SOURCE_BYTES:', run.synthetic.syntheticSourceBytesTotal);
    console.log('SOURCE_MIB_S:', fmt(run.synthetic.sourceReadMibPerSecondOverall));
    console.log('ROWS_S:', fmt(run.synthetic.rowsPerSecondOverall, 1));
    console.log('REFERENCES_S:', fmt(run.synthetic.referencesPerSecondOverall, 1));
    console.log('REFERENCE_WRITE_MIB_S:', fmt(run.synthetic.referenceWriteMibPerSecond));
    console.log('EMPRESAS_SOURCE_MIB_S:', fmt(run.synthetic.empresas.sourceMibPerSecond));
    console.log('ESTABELECIMENTOS_SOURCE_MIB_S:', fmt(run.synthetic.estabelecimentos.sourceMibPerSecond));
    console.log('PARTITIONED_JOIN_DURATION_MS:', fmt(run.synthetic.partitionedJoinDurationMs, 0));
    console.log('PARTITIONED_JOIN_EFFECTIVE_REFS_S:', fmt(run.synthetic.partitionedJoinEffectiveReferencesPerSecond, 1));
    console.log('CLEANUP_DURATION_MS:', fmt(run.synthetic.cleanupDurationMs, 0));
    console.log('SANITIZATION_DURATION_MS:', fmt(run.synthetic.sanitizationDurationMs, 0));
    console.log('matchCountMatchesOracle:', run.matchCountMatchesOracle);
    console.log('sanitizerPassed:', run.sanitizerPassed);
    console.log(
      'peakRssBytes:',
      run.exact?.resource.peakRssBytes,
      'peakHeapUsedBytes:',
      run.exact?.resource.peakHeapUsedBytes,
      'peakExternalMemoryBytes:',
      run.exact?.resource.peakExternalMemoryBytes,
    );
    console.log(
      'filesOpenedPeak:',
      run.exact?.filesOpenedPeak,
      'partitionHandlePeakOpen:',
      run.exact?.partitionHandlePeakOpen,
      'partitionHandleEvictions:',
      run.exact?.partitionHandleEvictions,
    );
    console.log('temporaryStoragePeakBytes:', run.exact?.resource.temporaryStoragePeakBytes);
    console.log('');
  }

  const classification = classifyBrazilReceita14B0ISourceReadThroughput(aggregate.sourceReadMibPerSecond.median);
  const recommendation = recommendBrazilReceita14B0ISecondRealBenchmark(classification);

  console.log('=== SOURCE-READ AGGREGATE (min / median / max, MiB/s) ===');
  console.log(
    fmt(aggregate.sourceReadMibPerSecond.min),
    '/',
    fmt(aggregate.sourceReadMibPerSecond.median),
    '/',
    fmt(aggregate.sourceReadMibPerSecond.max),
  );
  console.log('MEDIAN_ROWS_S:', fmt(aggregate.rowsPerSecond.median, 1));
  console.log('');
  console.log('SOURCE_READ_CLASSIFICATION:', classification);
  console.log('SECOND_REAL_BENCHMARK_RECOMMENDATION:', recommendation);
  console.log('END_TO_END_REAL_THROUGHPUT_PROVEN: false');
  console.log('SIX_HOUR_NATIONAL_FULL_JOIN_FEASIBILITY: STILL_UNPROVEN');
  console.log('GATE2_APPROVED: false');
  console.log('GATE7_APPROVED: false');
  console.log('REAL_DATA_ACCESSED: false');
  console.log('SECOND_REAL_BENCHMARK_EXECUTED: false');
  console.log('REAL_BENCHMARK_AUTHORIZED:', BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED);
  console.log('REAL_BENCHMARK_EXECUTED_DURABLE_STATE:', BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
