/**
 * BR Receita CNPJ controlled parser runner — tests (BR-SOURCE-3).
 *
 * Verifies the runner is a safe, synthetic-only, sanitized smoke tool:
 *   - runs the merged offline parser over the synthetic fixture (exit 0);
 *   - text and JSON output never leak a full CNPJ;
 *   - output carries hash12 identifiers and an all-false safety block;
 *   - forbidden ingestion/runtime flags (--input/--download/--import/--execute/
 *     --supabase/--production/--hubspot) are rejected;
 *   - --max-rows beyond the hard limit is rejected;
 *   - no sensitive-data key ever appears in the output object.
 *
 * 100% synthetic. No real dataset, no Supabase, no runtime integration.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  MAX_ROWS_LIMIT,
  ALLOWED_FIXTURE,
  SYNTHETIC_CSV_FIXTURE,
  FORBIDDEN_FLAGS,
  FORBIDDEN_OUTPUT_KEY_TOKENS,
  ForbiddenRuntimeModeError,
  MaxRowsLimitError,
  UnknownRunnerFlagError,
  RunnerOutputSanitizationError,
  parseControlledRunnerArgs,
  runControlledParser,
  formatReportText,
  formatReportJson,
  assertNoForbiddenKeysInOutput,
  assertSanitizedRunnerOutput,
  assertMaxRowsLimit,
  type ControlledRunnerReport,
} from '../run-br-receita-cnpj-controlled-parser';

const RUNNER_FILE = 'run-br-receita-cnpj-controlled-parser.ts';

function synthReport(extraArgs: string[] = []) {
  const options = parseControlledRunnerArgs(['--fixture', 'synthetic', ...extraArgs]);
  return runControlledParser(options);
}

// A full 14-position CNPJ is 14 chars in [A-Z0-9]; masked/hash values never are.
const FULL_CNPJ_PATTERN = /\b[A-Z0-9]{14}\b/;
const FOURTEEN_DIGITS_PATTERN = /\b\d{14}\b/;

// ─── Arg parsing: defaults & allowed flags ────────────────────────────────────

describe('parseControlledRunnerArgs — allowed options', () => {
  it('requires --fixture synthetic', () => {
    assert.throws(() => parseControlledRunnerArgs([]), ForbiddenRuntimeModeError);
  });

  it('accepts --fixture synthetic with text default', () => {
    const options = parseControlledRunnerArgs(['--fixture', 'synthetic']);
    assert.equal(options.fixture, ALLOWED_FIXTURE);
    assert.equal(options.format, 'text');
    assert.equal(options.maxRows, null);
    assert.equal(options.strict, false);
  });

  it('accepts --format json, --max-rows, and --strict', () => {
    const options = parseControlledRunnerArgs([
      '--fixture',
      'synthetic',
      '--format',
      'json',
      '--max-rows',
      '5',
      '--strict',
    ]);
    assert.equal(options.format, 'json');
    assert.equal(options.maxRows, 5);
    assert.equal(options.strict, true);
  });

  it('supports --flag=value form', () => {
    const options = parseControlledRunnerArgs(['--fixture=synthetic', '--format=json']);
    assert.equal(options.fixture, ALLOWED_FIXTURE);
    assert.equal(options.format, 'json');
  });

  it('rejects a non-synthetic fixture', () => {
    assert.throws(
      () => parseControlledRunnerArgs(['--fixture', 'real']),
      ForbiddenRuntimeModeError,
    );
  });

  it('rejects an unknown flag', () => {
    assert.throws(
      () => parseControlledRunnerArgs(['--fixture', 'synthetic', '--wat']),
      UnknownRunnerFlagError,
    );
  });
});

// ─── Arg parsing: forbidden runtime modes ─────────────────────────────────────

describe('parseControlledRunnerArgs — forbidden runtime modes', () => {
  for (const flag of FORBIDDEN_FLAGS) {
    it(`rejects --${flag}`, () => {
      assert.throws(
        () => parseControlledRunnerArgs(['--fixture', 'synthetic', `--${flag}`, 'x']),
        ForbiddenRuntimeModeError,
      );
    });
  }

  it('rejects the classic real-ingestion flags individually', () => {
    for (const flag of ['input', 'download', 'import', 'execute', 'supabase', 'production']) {
      assert.throws(
        () => parseControlledRunnerArgs(['--fixture', 'synthetic', `--${flag}`]),
        ForbiddenRuntimeModeError,
        `expected --${flag} to be rejected`,
      );
    }
  });
});

// ─── Arg parsing: max-rows limit ──────────────────────────────────────────────

describe('assertMaxRowsLimit / --max-rows', () => {
  it('rejects --max-rows greater than the hard limit', () => {
    assert.throws(
      () => parseControlledRunnerArgs(['--fixture', 'synthetic', '--max-rows', String(MAX_ROWS_LIMIT + 1)]),
      MaxRowsLimitError,
    );
  });

  it('rejects a non-positive / non-integer --max-rows', () => {
    assert.throws(() => assertMaxRowsLimit(0), MaxRowsLimitError);
    assert.throws(() => assertMaxRowsLimit(-3), MaxRowsLimitError);
    assert.throws(() => assertMaxRowsLimit(2.5), MaxRowsLimitError);
  });

  it('accepts --max-rows at the hard limit', () => {
    const options = parseControlledRunnerArgs([
      '--fixture',
      'synthetic',
      '--max-rows',
      String(MAX_ROWS_LIMIT),
    ]);
    assert.equal(options.maxRows, MAX_ROWS_LIMIT);
  });
});

// ─── Core run: parser results over the synthetic fixture ──────────────────────

describe('runControlledParser — synthetic fixture', () => {
  it('produces accepted snapshots and expected rejections', () => {
    const { report } = synthReport();
    assert.equal(report.mode, 'fixture');
    assert.equal(report.fixture, ALLOWED_FIXTURE);
    assert.equal(report.source_key, 'br_receita_cnpj_dados_abertos');
    assert.ok(report.snapshots_created > 0, 'expected at least one accepted snapshot');
    assert.ok(report.rejected_rows > 0, 'expected at least one rejected row');
    assert.equal(
      report.total_establishment_rows,
      report.snapshots_created + report.rejected_rows,
    );
  });

  it('prints NO CNPJ derivative for accepted rows (GATE-3 hardening)', () => {
    // Was: one truncated SHA-256 per accepted CNPJ under `valid_cnpj_hashes`. The
    // GATE-1 approval record (R4) forbids a hash or truncation of a CNPJ anywhere,
    // so "safe because hashed" was never an exemption.
    const { report } = synthReport();
    const asRecord = report as unknown as Record<string, unknown>;
    assert.ok(!('valid_cnpj_hashes' in asRecord), 'valid_cnpj_hashes must be gone');
    assert.equal(report.cnpj_derivatives_printed, false);
  });

  it('carries an all-false safety block', () => {
    const { report } = synthReport();
    for (const value of Object.values(report.safety)) {
      assert.equal(value, false);
    }
    // Import / runtime / live generation flags specifically remain false.
    assert.equal(report.safety.import, false);
    assert.equal(report.safety.runtime, false);
    assert.equal(report.safety.live_prospect_generation, false);
  });

  it('honors --max-rows by capping establishment rows', () => {
    const { report } = synthReport(['--max-rows', '2']);
    assert.equal(report.total_establishment_rows, 2);
  });

  it('stamps fixture_source=memory and layout_validation=passed for the memory fixture', () => {
    const { report } = synthReport();
    assert.equal(report.fixture_source, 'memory');
    assert.equal(report.layout_validation, 'passed');
  });
});

// ─── Synthetic-CSV fixture (BR-SOURCE-4) ──────────────────────────────────────

function csvReport(extraArgs: string[] = []) {
  const options = parseControlledRunnerArgs(['--fixture', SYNTHETIC_CSV_FIXTURE, ...extraArgs]);
  return runControlledParser(options);
}

describe('runControlledParser — synthetic-csv fixture', () => {
  it('accepts --fixture synthetic-csv', () => {
    const options = parseControlledRunnerArgs(['--fixture', SYNTHETIC_CSV_FIXTURE]);
    assert.equal(options.fixture, SYNTHETIC_CSV_FIXTURE);
  });

  it('reads the synthetic CSV files and produces the same 3 accepted / 3 rejected result', () => {
    const { report } = csvReport();
    assert.equal(report.mode, 'fixture');
    assert.equal(report.fixture, SYNTHETIC_CSV_FIXTURE);
    assert.equal(report.snapshots_created, 3);
    assert.equal(report.rejected_rows, 3);
    assert.equal(report.total_establishment_rows, 6);
  });

  it('stamps fixture_source=synthetic_csv and layout_validation=passed', () => {
    const { report } = csvReport();
    assert.equal(report.fixture_source, 'synthetic_csv');
    assert.equal(report.layout_validation, 'passed');
  });

  it('carries an all-false safety block', () => {
    const { report } = csvReport();
    for (const value of Object.values(report.safety)) {
      assert.equal(value, false);
    }
  });

  it('renders sanitized text output with no full CNPJ', () => {
    const { report, sensitiveFullCnpjs } = csvReport();
    const text = formatReportText(report);
    assert.match(text, /fixture_source: synthetic_csv/);
    assert.match(text, /layout_validation: passed/);
    assert.doesNotMatch(text, FULL_CNPJ_PATTERN);
    assert.doesNotMatch(text, FOURTEEN_DIGITS_PATTERN);
    for (const cnpj of sensitiveFullCnpjs) {
      assert.ok(!text.includes(cnpj), 'full CNPJ leaked into synthetic-csv text output');
    }
    assert.doesNotThrow(() => assertSanitizedRunnerOutput(text, sensitiveFullCnpjs));
  });

  it('renders valid JSON with no full CNPJ and hash12 identifiers', () => {
    const { report, sensitiveFullCnpjs } = csvReport(['--format', 'json']);
    const json = formatReportJson(report);
    const parsed = JSON.parse(json) as ControlledRunnerReport;
    assert.equal(parsed.fixture_source, 'synthetic_csv');
    assert.equal(parsed.layout_validation, 'passed');
    assert.doesNotMatch(json, FULL_CNPJ_PATTERN);
    assert.doesNotMatch(json, FOURTEEN_DIGITS_PATTERN);
    assert.equal(parsed.cnpj_derivatives_printed, false);
    for (const cnpj of sensitiveFullCnpjs) {
      assert.ok(!json.includes(cnpj), 'full CNPJ leaked into synthetic-csv json output');
    }
  });

  it('output object contains no forbidden data keys', () => {
    const { report } = csvReport();
    assert.doesNotThrow(() => assertNoForbiddenKeysInOutput(report));
  });

  it('still rejects forbidden ingestion/runtime flags in csv mode', () => {
    for (const flag of ['input', 'download', 'import', 'execute', 'supabase', 'production']) {
      assert.throws(
        () => parseControlledRunnerArgs(['--fixture', SYNTHETIC_CSV_FIXTURE, `--${flag}`]),
        ForbiddenRuntimeModeError,
        `expected --${flag} to be rejected in csv mode`,
      );
    }
  });
});

// ─── Output sanitization: text ────────────────────────────────────────────────

describe('text output sanitization', () => {
  it('does not contain a full CNPJ', () => {
    const { report, sensitiveFullCnpjs } = synthReport();
    const text = formatReportText(report);
    assert.doesNotMatch(text, FULL_CNPJ_PATTERN);
    assert.doesNotMatch(text, FOURTEEN_DIGITS_PATTERN);
    for (const cnpj of sensitiveFullCnpjs) {
      assert.ok(!text.includes(cnpj), 'full CNPJ leaked into text output');
    }
  });

  it('renders the held-absence assertion instead of identifier hashes', () => {
    const { report } = synthReport();
    const text = formatReportText(report);
    assert.ok(text.includes('cnpj_derivatives_printed: false'));
    assert.ok(!text.includes('valid_cnpj_hashes'), 'the hash line must be gone');
    // No 12-hex-with-a-digit run anywhere — the shape the removed derivative had.
    assert.doesNotMatch(text, /(?<![0-9a-f])(?=[0-9a-f]*\d)[0-9a-f]{12,}(?![0-9a-f])/i);
  });

  it('passes assertSanitizedRunnerOutput', () => {
    const { report, sensitiveFullCnpjs } = synthReport();
    const text = formatReportText(report);
    assert.doesNotThrow(() => assertSanitizedRunnerOutput(text, sensitiveFullCnpjs));
  });
});

// ─── Output sanitization: json ────────────────────────────────────────────────

describe('json output sanitization', () => {
  it('parses to valid JSON and contains no full CNPJ', () => {
    const { report, sensitiveFullCnpjs } = synthReport(['--format', 'json']);
    const json = formatReportJson(report);
    const parsed = JSON.parse(json) as ControlledRunnerReport;
    assert.equal(parsed.mode, 'fixture');
    assert.doesNotMatch(json, FULL_CNPJ_PATTERN);
    assert.doesNotMatch(json, FOURTEEN_DIGITS_PATTERN);
    for (const cnpj of sensitiveFullCnpjs) {
      assert.ok(!json.includes(cnpj), 'full CNPJ leaked into json output');
    }
  });

  it('carries no identifier derivative and no per-row identifier', () => {
    const { report } = synthReport(['--format', 'json']);
    const json = formatReportJson(report);
    const parsed = JSON.parse(json) as ControlledRunnerReport;
    assert.equal(parsed.cnpj_derivatives_printed, false);
    assert.doesNotMatch(json, /(?<![0-9a-f])(?=[0-9a-f]*\d)[0-9a-f]{12,}(?![0-9a-f])/i);
    for (const rejection of parsed.rejection_reasons) {
      const asRecord = rejection as unknown as Record<string, unknown>;
      assert.ok(!('safe_identifier' in asRecord), 'safe_identifier must be gone');
      assert.equal(typeof rejection.source_row_index, 'number');
    }
  });
});

// ─── Forbidden keys ────────────────────────────────────────────────────────────

describe('assertNoForbiddenKeysInOutput', () => {
  it('passes for the real report object', () => {
    const { report } = synthReport();
    assert.doesNotThrow(() => assertNoForbiddenKeysInOutput(report));
  });

  it('throws when a forbidden data key is present', () => {
    assert.throws(
      () => assertNoForbiddenKeysInOutput({ telefone: '5551234' }),
      RunnerOutputSanitizationError,
    );
    assert.throws(
      () => assertNoForbiddenKeysInOutput({ nested: [{ cpf: 'x' }] }),
      RunnerOutputSanitizationError,
    );
  });

  it('report keys contain none of the blocked tokens', () => {
    const { report } = synthReport();
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) {
          keys.push(k.toLowerCase());
          walk(child);
        }
      }
    };
    walk(report);
    for (const token of FORBIDDEN_OUTPUT_KEY_TOKENS) {
      assert.ok(!keys.some((k) => k.includes(token)), `report leaked blocked token "${token}"`);
    }
  });
});

// ─── Static safety: the runner file itself ────────────────────────────────────

describe('runner source — static safety', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', RUNNER_FILE), 'utf8');

  it('does not import a Supabase client', () => {
    assert.doesNotMatch(source, /createSupabase|@supabase|supabase-js/i);
  });

  it('does not read the filesystem, network, or process env for data', () => {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /readFileSync|createReadStream|node:fs/);
    assert.doesNotMatch(source, /process\.env\b/);
  });

  it('only reaches the runtime for argv/stdout/stderr/exit — never a data source', () => {
    // The runner uses process for CLI I/O only; assert no import/network/db call.
    assert.doesNotMatch(source, /https?:\/\/\S/);
    assert.doesNotMatch(source, /\bimport\s*\(/); // no dynamic import of ingestion code
  });
});
