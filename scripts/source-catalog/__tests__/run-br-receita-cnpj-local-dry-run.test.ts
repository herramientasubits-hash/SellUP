/**
 * BR Receita CNPJ local real-file dry-run runner — tests (BR-SOURCE-7).
 *
 * Verifies the runner is a safe, local-only, bounded, sanitized dry-run tool:
 *   - runs the internal synthetic manifest (exit 0, ok) in text and JSON;
 *   - output never leaks a full CNPJ/CPF, contact/address token, or row content;
 *   - forbidden ingestion/runtime/expansion flags and URL/CSV/ZIP are rejected;
 *   - --manifest requires BOTH --allow-local-manifest and --dry-run-only;
 *   - --max-sample-rows > 20 is refused; safety flags are all false.
 *
 * 100% synthetic. No real dataset, no Supabase, no download, no runtime.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  SYNTHETIC_MANIFEST_FIXTURE,
  FORBIDDEN_FLAGS,
  FORBIDDEN_OUTPUT_KEY_TOKENS,
  ForbiddenDryRunModeError,
  UnknownRunnerFlagError,
  RunnerOutputSanitizationError,
  parseDryRunRunnerArgs,
  runDryRun,
  buildDryRunRunnerReport,
  formatReportText,
  formatReportJson,
  assertNoForbiddenKeysInOutput,
  assertSanitizedRunnerOutput,
  type DryRunRunnerReport,
} from '../run-br-receita-cnpj-local-dry-run';

const RUNNER_FILE = 'run-br-receita-cnpj-local-dry-run.ts';
const RUNNER_PATH = path.join(__dirname, '..', RUNNER_FILE);

const FOURTEEN_DIGITS = /\b\d{14}\b/;
const FOURTEEN_ALNUM = /\b[A-Z0-9]{14}\b/;
const ELEVEN_DIGITS = /\b\d{11}\b/;

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', RUNNER_PATH, ...args], {
    encoding: 'utf8',
  });
}

// ─── Arg parsing — allowed options ────────────────────────────────────────────

describe('parseDryRunRunnerArgs — allowed options', () => {
  it('requires a fixture or a local manifest', () => {
    assert.throws(() => parseDryRunRunnerArgs([]), ForbiddenDryRunModeError);
  });

  it('accepts --fixture synthetic-manifest with defaults', () => {
    const options = parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE]);
    assert.equal(options.source, 'fixture');
    assert.equal(options.format, 'text');
    assert.equal(options.strict, false);
    assert.equal(options.maxSampleRows, 5);
  });

  it('accepts --format json, --strict, and --max-sample-rows', () => {
    const options = parseDryRunRunnerArgs([
      '--fixture',
      SYNTHETIC_MANIFEST_FIXTURE,
      '--format',
      'json',
      '--strict',
      '--max-sample-rows',
      '10',
    ]);
    assert.equal(options.format, 'json');
    assert.equal(options.strict, true);
    assert.equal(options.maxSampleRows, 10);
  });

  it('accepts a local manifest behind --allow-local-manifest and --dry-run-only', () => {
    const options = parseDryRunRunnerArgs([
      '--manifest',
      './some/manifest.json',
      '--allow-local-manifest',
      '--dry-run-only',
    ]);
    assert.equal(options.source, 'local-manifest');
    assert.equal(options.manifestPath, './some/manifest.json');
  });

  it('rejects a non-synthetic fixture', () => {
    assert.throws(() => parseDryRunRunnerArgs(['--fixture', 'real-manifest']), ForbiddenDryRunModeError);
  });

  it('rejects an unknown flag', () => {
    assert.throws(
      () => parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--wat']),
      UnknownRunnerFlagError,
    );
  });
});

// ─── Arg parsing — forbidden modes ────────────────────────────────────────────

describe('parseDryRunRunnerArgs — forbidden modes', () => {
  for (const flag of FORBIDDEN_FLAGS) {
    it(`rejects --${flag}`, () => {
      assert.throws(
        () => parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, `--${flag}`, 'x']),
        ForbiddenDryRunModeError,
      );
    });
  }

  it('rejects --manifest without --allow-local-manifest', () => {
    assert.throws(
      () => parseDryRunRunnerArgs(['--manifest', './manifest.json', '--dry-run-only']),
      ForbiddenDryRunModeError,
    );
  });

  it('rejects --manifest without --dry-run-only', () => {
    assert.throws(
      () => parseDryRunRunnerArgs(['--manifest', './manifest.json', '--allow-local-manifest']),
      ForbiddenDryRunModeError,
    );
  });

  it('rejects a URL --manifest', () => {
    assert.throws(
      () =>
        parseDryRunRunnerArgs([
          '--manifest',
          'https://example.com/manifest.json',
          '--allow-local-manifest',
          '--dry-run-only',
        ]),
      ForbiddenDryRunModeError,
    );
  });

  it('rejects a non-json --manifest', () => {
    assert.throws(
      () =>
        parseDryRunRunnerArgs([
          '--manifest',
          './data.csv',
          '--allow-local-manifest',
          '--dry-run-only',
        ]),
      ForbiddenDryRunModeError,
    );
  });

  it('rejects --allow-local-manifest / --dry-run-only without --manifest', () => {
    assert.throws(
      () => parseDryRunRunnerArgs(['--allow-local-manifest', '--dry-run-only']),
      ForbiddenDryRunModeError,
    );
  });

  it('rejects --max-sample-rows > 20', () => {
    assert.throws(
      () => parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--max-sample-rows', '21']),
      ForbiddenDryRunModeError,
    );
  });

  it('rejects a non-numeric --max-sample-rows', () => {
    assert.throws(
      () => parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--max-sample-rows', 'x']),
      ForbiddenDryRunModeError,
    );
  });
});

// ─── Core run over the internal synthetic manifest ────────────────────────────

describe('runDryRun — synthetic manifest', () => {
  it('runs the dry-run (ok, 6 files accepted, bounded sampling)', async () => {
    const options = parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--strict']);
    const report = await runDryRun(options);
    assert.equal(report.ok, true);
    assert.equal(report.mode, 'local_real_file_dry_run');
    assert.equal(report.fixture, SYNTHETIC_MANIFEST_FIXTURE);
    assert.equal(report.manifest_validation, 'passed');
    assert.equal(report.source_key, 'br_receita_cnpj_dados_abertos');
    assert.equal(report.country_code, 'BR');
    assert.equal(report.files_seen, 6);
    assert.equal(report.files_accepted, 6);
    assert.equal(report.files_rejected, 0);
    assert.equal(report.full_dataset_processed, false);
    assert.equal(report.import_executed, false);
    assert.equal(report.supabase_write, false);
    assert.equal(report.file_hashes.length, 6);
    for (const hash of report.file_hashes) {
      assert.match(hash, /^[0-9a-f]{12}$/);
    }
  });

  it('carries an all-false safety block', async () => {
    const options = parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE]);
    const report = await runDryRun(options);
    for (const value of Object.values(report.safety)) {
      assert.equal(value, false);
    }
  });
});

// ─── Output sanitization ───────────────────────────────────────────────────────

describe('output sanitization', () => {
  async function fixtureReport(): Promise<DryRunRunnerReport> {
    const options = parseDryRunRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--strict']);
    return runDryRun(options);
  }

  it('text output leaks no full CNPJ/CPF and only hash12 identifiers', async () => {
    const report = await fixtureReport();
    const text = formatReportText(report);
    assert.match(text, /mode: local_real_file_dry_run/);
    assert.match(text, /file_hashes: \[[0-9a-f, ]*\]/);
    assert.doesNotMatch(text, FOURTEEN_DIGITS);
    assert.doesNotMatch(text, FOURTEEN_ALNUM);
    assert.doesNotMatch(text, ELEVEN_DIGITS);
    assert.doesNotThrow(() => assertSanitizedRunnerOutput(text));
  });

  it('json output parses and contains no forbidden tokens or CNPJ/CPF', async () => {
    const report = await fixtureReport();
    const json = formatReportJson(report);
    const parsed = JSON.parse(json) as DryRunRunnerReport;
    assert.equal(parsed.mode, 'local_real_file_dry_run');
    assert.doesNotMatch(json, FOURTEEN_DIGITS);
    assert.doesNotMatch(json, FOURTEEN_ALNUM);
    assert.doesNotMatch(json, ELEVEN_DIGITS);
    const lower = json.toLowerCase();
    for (const token of [
      'cpf',
      'telefone',
      'fax',
      'correio_eletronico',
      'logradouro',
      'numero',
      'complemento',
      'bairro',
      'cep',
    ]) {
      assert.ok(!lower.includes(`"${token}"`), `output leaked token "${token}"`);
    }
  });

  it('report object contains no forbidden data keys', async () => {
    const report = await fixtureReport();
    assert.doesNotThrow(() => assertNoForbiddenKeysInOutput(report));
  });

  it('assertNoForbiddenKeysInOutput throws on a leaked key', () => {
    assert.throws(() => assertNoForbiddenKeysInOutput({ cpf: 'x' }), RunnerOutputSanitizationError);
    assert.throws(
      () => assertNoForbiddenKeysInOutput({ nested: [{ telefone: 'x' }] }),
      RunnerOutputSanitizationError,
    );
  });

  it('buildDryRunRunnerReport marks a manifest-validation failure safely', () => {
    const report = buildDryRunRunnerReport(
      { source: 'local-manifest', manifestPath: 'x.json', format: 'text', strict: false, maxSampleRows: 5 },
      {
        ok: false,
        mode: 'local_real_file_dry_run',
        sourceKey: 'br_receita_cnpj_dados_abertos',
        countryCode: 'BR',
        sourceYear: 0,
        sourcePeriod: '',
        manifestValidation: 'failed',
        filesSeen: 0,
        filesAccepted: 0,
        filesRejected: 0,
        sampleRowsRead: 0,
        sampleRowsAcceptedForStructure: 0,
        sampleRowsRejectedForStructure: 0,
        fullDatasetProcessed: false,
        importExecuted: false,
        supabaseWrite: false,
        fileReports: [],
        rejectionReasons: ['manifest_source_key_invalid'],
        safety: {
          datasetDownload: false,
          fullDatasetProcessed: false,
          importExecuted: false,
          supabaseWrite: false,
          productionImport: false,
          runtimeIntegration: false,
          agent1Integration: false,
          hubspot: false,
          slack: false,
          liveProspectGeneration: false,
        },
      },
    );
    assert.equal(report.ok, false);
    assert.equal(report.manifest_validation, 'failed');
    assert.deepEqual(report.rejection_reasons, ['manifest_source_key_invalid']);
  });
});

// ─── CLI (subprocess) — exit codes and rendered output ────────────────────────

describe('CLI subprocess', () => {
  it('fixture text run exits 0', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--format', 'text', '--strict']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /mode: local_real_file_dry_run/);
    assert.match(res.stdout, /files_accepted: 6/);
    assert.match(res.stdout, /full_dataset_processed: false/);
    assert.doesNotMatch(res.stdout, FOURTEEN_DIGITS);
  });

  it('fixture json run exits 0 and parses', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--format', 'json', '--strict']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout) as DryRunRunnerReport;
    assert.equal(parsed.ok, true);
    assert.equal(parsed.files_accepted, 6);
    assert.equal(parsed.full_dataset_processed, false);
    for (const hash of parsed.file_hashes) {
      assert.match(hash, /^[0-9a-f]{12}$/);
    }
  });

  it('output does not contain a CNPJ/CPF or personal-data tokens', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--format', 'json']);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, FOURTEEN_DIGITS);
    assert.doesNotMatch(res.stdout, FOURTEEN_ALNUM);
    assert.doesNotMatch(res.stdout, ELEVEN_DIGITS);
    const lower = res.stdout.toLowerCase();
    for (const token of ['"cpf"', '"telefone"', '"fax"', '"logradouro"', '"bairro"', '"cep"']) {
      assert.ok(!lower.includes(token), `stdout leaked ${token}`);
    }
  });

  for (const flag of [
    'input',
    'csv',
    'zip',
    'download',
    'import',
    'execute',
    'supabase',
    'production',
    'full',
    'all',
  ]) {
    it(`rejects --${flag} with exit 1`, () => {
      const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, `--${flag}`, 'x']);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /BRSOURCE7_FORBIDDEN_DRY_RUN_MODE/);
    });
  }

  it('rejects --manifest without --allow-local-manifest with exit 1', () => {
    const res = runCli(['--manifest', './manifest.json', '--dry-run-only']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BRSOURCE7_FORBIDDEN_DRY_RUN_MODE/);
  });

  it('rejects --manifest without --dry-run-only with exit 1', () => {
    const res = runCli(['--manifest', './manifest.json', '--allow-local-manifest']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BRSOURCE7_FORBIDDEN_DRY_RUN_MODE/);
  });

  it('rejects --max-sample-rows 21 with exit 1', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--max-sample-rows', '21']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BRSOURCE7_FORBIDDEN_DRY_RUN_MODE/);
  });

  it('rejects a URL manifest with exit 1', () => {
    const res = runCli([
      '--manifest',
      'https://example.com/m.json',
      '--allow-local-manifest',
      '--dry-run-only',
    ]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BRSOURCE7_FORBIDDEN_DRY_RUN_MODE/);
  });
});

// ─── Static safety of the runner source ────────────────────────────────────────

describe('runner source — static safety', () => {
  const source = fs.readFileSync(RUNNER_PATH, 'utf8');

  it('does not import a Supabase client', () => {
    assert.doesNotMatch(source, /createSupabase|@supabase|supabase-js/i);
  });

  it('does not fetch, read the filesystem directly, or read process env for data', () => {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /node:fs\b|readFileSync|createReadStream/);
    assert.doesNotMatch(source, /process\.env\b/);
  });

  it('lists the full-dataset / expansion flags among the forbidden set', () => {
    assert.ok((FORBIDDEN_FLAGS as readonly string[]).includes('full'));
    assert.ok((FORBIDDEN_FLAGS as readonly string[]).includes('all'));
    assert.ok(FORBIDDEN_OUTPUT_KEY_TOKENS.includes('cpf'));
  });
});
