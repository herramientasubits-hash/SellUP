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

  it('exposes hash12 identifiers for accepted CNPJs (never full)', () => {
    const { report } = synthReport();
    assert.equal(report.valid_cnpj_hashes.length, report.snapshots_created);
    for (const hash of report.valid_cnpj_hashes) {
      assert.match(hash, /^[0-9a-f]{12}$/, 'expected a 12-hex hash');
    }
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

  it('contains hash12 identifiers', () => {
    const { report } = synthReport();
    const text = formatReportText(report);
    for (const hash of report.valid_cnpj_hashes) {
      assert.ok(text.includes(hash), 'expected hash12 in text output');
    }
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

  it('contains hash12 identifiers and masked-free structure', () => {
    const { report } = synthReport(['--format', 'json']);
    const parsed = JSON.parse(formatReportJson(report)) as ControlledRunnerReport;
    assert.equal(parsed.valid_cnpj_hashes.length, report.snapshots_created);
    for (const hash of parsed.valid_cnpj_hashes) {
      assert.match(hash, /^[0-9a-f]{12}$/);
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
