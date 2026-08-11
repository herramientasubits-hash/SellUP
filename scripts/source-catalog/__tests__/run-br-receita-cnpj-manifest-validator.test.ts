/**
 * BR Receita CNPJ manifest validator runner — tests (BR-SOURCE-6).
 *
 * Verifies the runner is a safe, local-only, sanitized manifest tool:
 *   - validates the internal synthetic manifest (exit 0, ok);
 *   - text and JSON output never leak a full CNPJ/CPF or row content;
 *   - forbidden ingestion/runtime flags and URL/CSV/ZIP inputs are rejected;
 *   - --manifest requires the explicit --allow-local-manifest flag;
 *   - safety flags are all false.
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
  ForbiddenManifestModeError,
  UnknownRunnerFlagError,
  RunnerOutputSanitizationError,
  parseManifestRunnerArgs,
  runManifestValidator,
  buildManifestRunnerReport,
  formatReportText,
  formatReportJson,
  assertNoForbiddenKeysInOutput,
  assertSanitizedRunnerOutput,
  type ManifestRunnerReport,
} from '../run-br-receita-cnpj-manifest-validator';

const RUNNER_FILE = 'run-br-receita-cnpj-manifest-validator.ts';
const RUNNER_PATH = path.join(__dirname, '..', RUNNER_FILE);

const FOURTEEN_DIGITS = /\b\d{14}\b/;
const FOURTEEN_ALNUM = /\b[A-Z0-9]{14}\b/;

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', RUNNER_PATH, ...args], {
    encoding: 'utf8',
  });
}

// ─── Arg parsing ───────────────────────────────────────────────────────────────

describe('parseManifestRunnerArgs — allowed options', () => {
  it('requires a fixture or a local manifest', () => {
    assert.throws(() => parseManifestRunnerArgs([]), ForbiddenManifestModeError);
  });

  it('accepts --fixture synthetic-manifest with text default', () => {
    const options = parseManifestRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE]);
    assert.equal(options.source, 'fixture');
    assert.equal(options.format, 'text');
    assert.equal(options.strict, false);
  });

  it('accepts --format json and --strict', () => {
    const options = parseManifestRunnerArgs([
      '--fixture',
      SYNTHETIC_MANIFEST_FIXTURE,
      '--format',
      'json',
      '--strict',
    ]);
    assert.equal(options.format, 'json');
    assert.equal(options.strict, true);
  });

  it('rejects a non-synthetic fixture', () => {
    assert.throws(
      () => parseManifestRunnerArgs(['--fixture', 'real-manifest']),
      ForbiddenManifestModeError,
    );
  });

  it('rejects an unknown flag', () => {
    assert.throws(
      () => parseManifestRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--wat']),
      UnknownRunnerFlagError,
    );
  });
});

describe('parseManifestRunnerArgs — forbidden modes', () => {
  for (const flag of FORBIDDEN_FLAGS) {
    it(`rejects --${flag}`, () => {
      assert.throws(
        () => parseManifestRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, `--${flag}`, 'x']),
        ForbiddenManifestModeError,
      );
    });
  }

  it('rejects --manifest without --allow-local-manifest', () => {
    assert.throws(
      () => parseManifestRunnerArgs(['--manifest', './manifest.json']),
      ForbiddenManifestModeError,
    );
  });

  it('rejects a URL --manifest', () => {
    assert.throws(
      () =>
        parseManifestRunnerArgs([
          '--manifest',
          'https://example.com/manifest.json',
          '--allow-local-manifest',
        ]),
      ForbiddenManifestModeError,
    );
  });

  it('rejects a non-json --manifest', () => {
    assert.throws(
      () => parseManifestRunnerArgs(['--manifest', './data.csv', '--allow-local-manifest']),
      ForbiddenManifestModeError,
    );
  });

  it('rejects --allow-local-manifest without --manifest', () => {
    assert.throws(
      () => parseManifestRunnerArgs(['--allow-local-manifest']),
      ForbiddenManifestModeError,
    );
  });

  it('accepts a local .json manifest behind --allow-local-manifest', () => {
    const options = parseManifestRunnerArgs([
      '--manifest',
      './some/manifest.json',
      '--allow-local-manifest',
    ]);
    assert.equal(options.source, 'local-manifest');
    assert.equal(options.manifestPath, './some/manifest.json');
  });
});

// ─── Core run over the internal synthetic manifest ────────────────────────────

describe('runManifestValidator — synthetic manifest', () => {
  it('validates the internal synthetic manifest (ok, 6 files accepted)', async () => {
    const options = parseManifestRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--strict']);
    const report = await runManifestValidator(options);
    assert.equal(report.ok, true);
    assert.equal(report.mode, 'local_manifest_validation');
    assert.equal(report.fixture, SYNTHETIC_MANIFEST_FIXTURE);
    assert.equal(report.source_key, 'br_receita_cnpj_dados_abertos');
    assert.equal(report.files_seen, 6);
    assert.equal(report.files_accepted, 6);
    assert.equal(report.files_rejected, 0);
    assert.equal(report.layout_validation, 'passed');
    assert.equal(report.rejection_reasons.length, 0);
    assert.equal(report.file_hashes.length, 6);
    for (const hash of report.file_hashes) {
      assert.match(hash, /^[0-9a-f]{12}$/);
    }
  });

  it('carries an all-false safety block', async () => {
    const options = parseManifestRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE]);
    const report = await runManifestValidator(options);
    for (const value of Object.values(report.safety)) {
      assert.equal(value, false);
    }
  });
});

// ─── Output sanitization ───────────────────────────────────────────────────────

describe('output sanitization', () => {
  async function fixtureReport(): Promise<ManifestRunnerReport> {
    const options = parseManifestRunnerArgs(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--strict']);
    return runManifestValidator(options);
  }

  it('text output leaks no full CNPJ and only hash12 identifiers', async () => {
    const report = await fixtureReport();
    const text = formatReportText(report);
    assert.match(text, /mode: local_manifest_validation/);
    assert.match(text, /file_hashes: \[[0-9a-f, ]*\]/);
    assert.doesNotMatch(text, FOURTEEN_DIGITS);
    assert.doesNotMatch(text, FOURTEEN_ALNUM);
    assert.doesNotThrow(() => assertSanitizedRunnerOutput(text));
  });

  it('json output parses and contains no forbidden tokens or CNPJ/CPF', async () => {
    const report = await fixtureReport();
    const json = formatReportJson(report);
    const parsed = JSON.parse(json) as ManifestRunnerReport;
    assert.equal(parsed.mode, 'local_manifest_validation');
    assert.doesNotMatch(json, FOURTEEN_DIGITS);
    assert.doesNotMatch(json, FOURTEEN_ALNUM);
    const lower = json.toLowerCase();
    for (const token of ['cpf', 'telefone', 'fax', 'correio_eletronico', 'logradouro', 'bairro', 'cep']) {
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

  it('buildManifestRunnerReport marks a structural rejection safely', () => {
    const report = buildManifestRunnerReport(
      { source: 'local-manifest', manifestPath: 'x.json', format: 'text', strict: false },
      {
        ok: false,
        sourceKey: 'br_receita_cnpj_dados_abertos',
        countryCode: 'BR',
        sourceYear: 0,
        sourcePeriod: '',
        inputScope: 'staged_subset',
        filesSeen: 0,
        filesAccepted: 0,
        filesRejected: 0,
        fileReports: [],
        reasonCode: 'manifest_source_key_invalid',
        safety: {
          datasetDownload: false,
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
    assert.deepEqual(report.rejection_reasons, ['manifest_source_key_invalid']);
  });
});

// ─── CLI (subprocess) — exit codes and rendered output ────────────────────────

describe('CLI subprocess', () => {
  it('fixture text run exits 0', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--format', 'text', '--strict']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /mode: local_manifest_validation/);
    assert.match(res.stdout, /files_accepted: 6/);
    assert.doesNotMatch(res.stdout, FOURTEEN_DIGITS);
  });

  it('fixture json run exits 0 and parses', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--format', 'json', '--strict']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout) as ManifestRunnerReport;
    assert.equal(parsed.ok, true);
    assert.equal(parsed.files_accepted, 6);
    for (const hash of parsed.file_hashes) {
      assert.match(hash, /^[0-9a-f]{12}$/);
    }
  });

  it('output does not contain a CNPJ/CPF or personal-data tokens', () => {
    const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, '--format', 'json']);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, FOURTEEN_DIGITS);
    assert.doesNotMatch(res.stdout, FOURTEEN_ALNUM);
    const lower = res.stdout.toLowerCase();
    for (const token of ['"cpf"', '"telefone"', '"fax"', '"logradouro"', '"bairro"', '"cep"']) {
      assert.ok(!lower.includes(token), `stdout leaked ${token}`);
    }
  });

  for (const flag of ['input', 'csv', 'zip', 'download', 'import', 'execute', 'supabase', 'production']) {
    it(`rejects --${flag} with exit 1`, () => {
      const res = runCli(['--fixture', SYNTHETIC_MANIFEST_FIXTURE, `--${flag}`, 'x']);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /BRSOURCE6_FORBIDDEN_MANIFEST_MODE/);
    });
  }

  it('rejects --manifest without --allow-local-manifest with exit 1', () => {
    const res = runCli(['--manifest', './manifest.json']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BRSOURCE6_FORBIDDEN_MANIFEST_MODE/);
  });

  it('rejects a URL manifest with exit 1', () => {
    const res = runCli(['--manifest', 'https://example.com/m.json', '--allow-local-manifest']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /BRSOURCE6_FORBIDDEN_MANIFEST_MODE/);
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

  it('declares an all-false-safety runner with the forbidden output tokens list', () => {
    assert.ok(FORBIDDEN_OUTPUT_KEY_TOKENS.includes('cpf'));
    assert.ok(FORBIDDEN_OUTPUT_KEY_TOKENS.includes('telefone'));
  });
});
