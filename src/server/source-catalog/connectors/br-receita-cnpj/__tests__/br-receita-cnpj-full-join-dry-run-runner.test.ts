/**
 * BR Receita CNPJ FULL JOIN dry-run runner scaffold — tests (BR-SOURCE-11A).
 *
 * Proves the runner is the no-write/no-runtime scaffold the milestone claims:
 *   - `synthetic_fixture_only` (the DEFAULT) produces an ok, aggregate report;
 *   - every gate stays `not_approved` and every `run_scope` flag stays false;
 *   - every safety assertion stays false, including `identity_keys_constructed`;
 *   - the serialized report contains no row, no CNPJ/CNPJ básico/CPF, no email, no
 *     phone, no LinkedIn URL, and no synthetic fixture ref;
 *   - `local_manifest_dry_run` fails closed WITHOUT `allowLocalManifest`, and STILL
 *     fails closed WITH it (GATE-1/GATE-2 are not approved), so no file is opened;
 *   - a dangerous config (Supabase write / runtime / Agent 1 / provider / import)
 *     fails closed with zeroed metrics;
 *   - the bounded caps are enforced and a fixture beyond the synthetic ceiling fails.
 *
 * A final STATIC-GUARD suite reads the BR-SOURCE-11A source files and asserts their
 * IMPORT surface never reaches Supabase, Agent 1, HubSpot, Slack, or a provider, that
 * no snapshot write exists, and that no real operator path is embedded.
 *
 * 100% synthetic. No dataset, no manifest, no Supabase, no network, no runtime. Every
 * identifier-shaped token is assembled by CONCATENATION so no 8-/11-/14-digit literal
 * exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE,
  BRAZIL_RECEITA_FULL_JOIN_DRY_RUN_MODE,
  BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS,
  defaultBrazilReceitaFullJoinSyntheticFixture,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunInput,
  type BrazilReceitaFullJoinDryRunReport,
} from '../br-receita-cnpj-full-join-dry-run-runner';

// ─── Shared input ─────────────────────────────────────────────────────────────

const SAFE_INPUT: BrazilReceitaFullJoinDryRunInput = {
  noWriteMode: true,
  runtimeIntegration: false,
  agent1Integration: false,
  supabaseWrite: false,
  providerCalls: false,
  importExecuted: false,
};

/** Builds an input whose escalation fields are deliberately falsified for a test. */
function dangerousInput(overrides: Record<string, unknown>): BrazilReceitaFullJoinDryRunInput {
  return { ...SAFE_INPUT, ...overrides } as unknown as BrazilReceitaFullJoinDryRunInput;
}

// ─── Forbidden-output patterns (quantifiers only, no literals) ─────────────────

const FORBIDDEN_OUTPUT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['cnpj_completo', /(?<!\d)\d{14}(?!\d)/],
  ['cnpj_formatted', /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/],
  ['cpf', /(?<!\d)\d{11}(?!\d)/],
  ['cnpj_basico', /(?<!\d)\d{8}(?!\d)/],
  ['long_digit_run', /(?<!\d)\d{8,}(?!\d)/],
  ['email', new RegExp(`[A-Za-z0-9._%+-]+${String.fromCharCode(64)}[A-Za-z0-9.-]+\\.[A-Za-z]{2,}`)],
  ['phone', /\+\d[\d\s().-]{7,}/],
  ['linkedin', /linkedin\./i],
];

function assertNoForbiddenOutput(report: BrazilReceitaFullJoinDryRunReport): void {
  const serialized = JSON.stringify(report);
  for (const [label, pattern] of FORBIDDEN_OUTPUT_PATTERNS) {
    assert.ok(!pattern.test(serialized), `report must not contain a ${label} pattern`);
  }
}

// ─── Synthetic fixture mode ───────────────────────────────────────────────────

describe('BR-SOURCE-11A runner — synthetic fixture mode', () => {
  it('defaults to synthetic_fixture_only', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE, 'synthetic_fixture_only');
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    assert.equal(report.run_mode, 'synthetic_fixture_only');
  });

  it('returns an ok report with no errors', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.equal(report.mode, BRAZIL_RECEITA_FULL_JOIN_DRY_RUN_MODE);
    assert.equal(report.country_code, 'BR');
  });

  it('keeps source_period null — no manifest is opened, so no period is known', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    assert.equal(report.source_period, null);
  });

  it('holds every approval gate at not_approved', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    const gates = Object.values(report.decision_status);
    assert.equal(gates.length, 8);
    for (const gate of gates) assert.equal(gate, 'not_approved');
  });

  it('holds every run_scope flag at false', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    for (const [key, value] of Object.entries(report.run_scope)) {
      assert.equal(value, false, `run_scope.${key} must be false`);
    }
  });

  it('holds every safety assertion at false, including identity_keys_constructed', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    for (const [key, value] of Object.entries(report.safety)) {
      assert.equal(value, false, `safety.${key} must be false`);
    }
    assert.equal(report.safety.identity_keys_constructed, false);
  });

  it('needs no cleanup on a clean run', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    assert.equal(report.cleanup.cleanup_required, false);
    assert.equal(report.cleanup.cleanup_status, 'not_needed');
    assert.equal(report.cleanup.unsafe_artifacts_detected, false);
  });

  it('scores the built-in fixture into aggregate join counts', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      maxCompanyRows: 20,
      maxEstablishmentRows: 20,
    });
    // Built-in fixture: 2 usable companies, 2 blocked, 1 absent ref, 1 null ref,
    // 1 establishment carrying its own privacy signal.
    assert.equal(report.join_counts.joined_with_company_context, 2);
    assert.equal(report.join_counts.excluded_by_company_context, 2);
    assert.equal(report.join_counts.missing_company_context, 1);
    assert.equal(report.join_counts.pending_full_join_context, 1);
    assert.equal(report.join_counts.excluded_by_establishment_privacy_signal, 1);
  });

  it('reports aggregate and eligibility counts as plain numbers only', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    for (const counts of [
      report.aggregate_counts,
      report.eligibility_counts,
      report.join_counts,
      report.guardrail_counts,
    ]) {
      for (const [key, value] of Object.entries(counts)) {
        assert.equal(typeof value, 'number', `${key} must be a number`);
        assert.ok(Number.isInteger(value));
      }
    }
  });
});

// ─── Output safety ────────────────────────────────────────────────────────────

describe('BR-SOURCE-11A runner — output safety', () => {
  it('emits no raw row and no forbidden identifier pattern', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      maxCompanyRows: 20,
      maxEstablishmentRows: 20,
    });
    const serialized = JSON.stringify(report);
    // A raw-row/raw-data PAYLOAD key must not exist. `raw_rows_printed: false` is an
    // absence ASSERTION, not a payload, so it is matched out by requiring the bare key.
    assert.ok(!/"raw_(row|rows|data|cell)s?"\s*:/i.test(serialized));
    assert.ok(!/"record_identity_key"\s*:/i.test(serialized));
    assert.ok(!/"normalized_tax_id"\s*:/i.test(serialized));
    // The safety assertions themselves must be present and held.
    assert.equal(report.safety.raw_rows_printed, false);
    assert.equal(report.safety.record_identity_keys_printed, false);
    assertNoForbiddenOutput(report);
  });

  it('never emits a synthetic fixture ref, not even an opaque one', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      maxCompanyRows: 20,
      maxEstablishmentRows: 20,
    });
    const serialized = JSON.stringify(report);
    for (const row of defaultBrazilReceitaFullJoinSyntheticFixture().companies) {
      assert.ok(!serialized.includes(row.companyRef), 'a company ref must never be emitted');
    }
  });

  it('never emits an injected fixture ref', () => {
    const injectedRef = 'INJECTED' + '_SYNTHETIC_REF';
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      syntheticFixture: {
        companies: [{ companyRef: injectedRef, eligibility: 'eligible_for_future_import' }],
        establishments: [{ companyRef: injectedRef, privacySignal: false }],
      },
    });
    assert.equal(report.ok, true);
    assert.ok(!JSON.stringify(report).includes(injectedRef));
  });

  it('emits no dataset-shaped value even when the fixture carries one', () => {
    // A hostile fixture whose ref LOOKS like a dataset identifier must not leak: the
    // runner counts refs, it never emits them.
    const datasetShapedRef = '1122' + '2333' + '000199';
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      syntheticFixture: {
        companies: [{ companyRef: datasetShapedRef, eligibility: 'eligible_for_future_import' }],
        establishments: [{ companyRef: datasetShapedRef, privacySignal: false }],
      },
    });
    assert.ok(!JSON.stringify(report).includes(datasetShapedRef));
    assertNoForbiddenOutput(report);
  });
});

// ─── Local manifest mode: fail-closed twice ───────────────────────────────────

describe('BR-SOURCE-11A runner — local manifest mode fails closed', () => {
  it('refuses local_manifest_dry_run without allowLocalManifest', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
    });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'allow_local_manifest_required');
    assert.equal(report.errors[0]?.stage, 'mode_resolution');
  });

  it('STILL refuses local_manifest_dry_run with allowLocalManifest — no gate is approved', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      allowLocalManifest: true,
      manifest: { anything: true },
    });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'local_manifest_execution_not_authorized');
    assert.equal(report.run_scope.full_dataset_processed, false);
  });

  it('zeroes every metric when a run is refused', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      allowLocalManifest: true,
    });
    for (const counts of [report.aggregate_counts, report.eligibility_counts, report.join_counts]) {
      for (const value of Object.values(counts)) assert.equal(value, 0);
    }
    assert.equal(report.cleanup.cleanup_required, true);
    assert.equal(report.cleanup.cleanup_status, 'not_executed');
  });

  it('refuses an unrecognized run mode and reports against the safe default', () => {
    const report = runBrazilReceitaFullJoinDryRun(dangerousInput({ mode: 'full_dataset' }));
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'invalid_run_mode');
    assert.equal(report.run_mode, BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE);
  });
});

// ─── Dangerous config: fail-closed ────────────────────────────────────────────

describe('BR-SOURCE-11A runner — dangerous config fails closed', () => {
  const dangerousCases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['supabaseWrite', { supabaseWrite: true }],
    ['runtimeIntegration', { runtimeIntegration: true }],
    ['agent1Integration', { agent1Integration: true }],
    ['providerCalls', { providerCalls: true }],
    ['importExecuted', { importExecuted: true }],
    ['noWriteMode not declared', { noWriteMode: false }],
    ['serviceRoleKey present', { serviceRoleKey: 'SYNTHETIC' + '_NOT_REAL' }],
  ];

  for (const [label, overrides] of dangerousCases) {
    it(`refuses when ${label}`, () => {
      const report = runBrazilReceitaFullJoinDryRun(dangerousInput(overrides));
      assert.equal(report.ok, false, `${label} must fail closed`);
      assert.equal(report.errors[0]?.error_code, 'no_write_guard_failed');
      assert.equal(report.errors[0]?.stage, 'no_write_guard');
      assert.ok(report.guardrail_counts.no_write_guard_violations > 0);
    });
  }

  it('never echoes a detected secret in the refused report', () => {
    const secret = 'SYNTHETIC' + '_NOT_A_REAL_CREDENTIAL';
    const report = runBrazilReceitaFullJoinDryRun(dangerousInput({ serviceRoleKey: secret }));
    assert.equal(report.ok, false);
    assert.ok(!JSON.stringify(report).includes(secret));
  });

  it('refuses an unapproved output sanitization version', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      dangerousInput({ outputSanitizationVersion: 'approved' }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'output_sanitization_version_not_approved');
  });
});

// ─── Bounded caps ─────────────────────────────────────────────────────────────

describe('BR-SOURCE-11A runner — bounded caps', () => {
  it('refuses a company sample beyond the hard sample limit', () => {
    const report = runBrazilReceitaFullJoinDryRun({ ...SAFE_INPUT, maxCompanyRows: 21 });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'sample_row_limit_exceeded');
    assert.equal(report.errors[0]?.stage, 'limit_validation');
  });

  it('refuses an establishment sample beyond the hard sample limit', () => {
    const report = runBrazilReceitaFullJoinDryRun({ ...SAFE_INPUT, maxEstablishmentRows: 21 });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'sample_row_limit_exceeded');
  });

  it('refuses a coverage scan beyond the hard scan limit', () => {
    const report = runBrazilReceitaFullJoinDryRun({ ...SAFE_INPUT, maxCompanyScanRows: 5001 });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'company_scan_row_limit_exceeded');
  });

  it('refuses a non-finite limit as full-dataset processing', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      maxCompanyRows: Number.POSITIVE_INFINITY,
    });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'full_dataset_processing_not_allowed');
  });

  it('truncates the establishment window to the cap and flags it', () => {
    const report = runBrazilReceitaFullJoinDryRun({ ...SAFE_INPUT, maxEstablishmentRows: 1 });
    assert.equal(report.ok, true);
    assert.equal(report.aggregate_counts.establishment_rows_scanned, 1);
    assert.equal(report.guardrail_counts.establishment_sample_cap_applied, 1);
  });

  it('flags the coverage scan cap when the fixture exceeds the scan window', () => {
    const report = runBrazilReceitaFullJoinDryRun({ ...SAFE_INPUT, maxCompanyScanRows: 1 });
    assert.equal(report.ok, true);
    assert.equal(report.aggregate_counts.company_rows_scanned, 1);
    assert.equal(report.guardrail_counts.coverage_scan_limit_reached, 1);
  });
});

// ─── Fixture validation ───────────────────────────────────────────────────────

describe('BR-SOURCE-11A runner — fixture validation', () => {
  it('refuses a malformed fixture', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      dangerousInput({ syntheticFixture: { companies: 'nope', establishments: [] } }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'synthetic_fixture_invalid');
    assert.equal(report.errors[0]?.stage, 'fixture_validation');
  });

  it('refuses a fixture beyond the synthetic ceiling as full-dataset processing', () => {
    const oversized = Array.from(
      { length: BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS + 1 },
      (_unused, index) => ({
        companyRef: `SYNTHETIC_REF_${index}`,
        eligibility: 'eligible_for_future_import' as const,
      }),
    );
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      syntheticFixture: { companies: oversized, establishments: [] },
    });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'full_dataset_processing_not_allowed');
  });

  it('accepts an empty fixture as an ok, all-zero run', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      syntheticFixture: { companies: [], establishments: [] },
    });
    assert.equal(report.ok, true);
    assert.equal(report.aggregate_counts.company_rows_scanned, 0);
    assert.equal(report.aggregate_counts.establishment_rows_scanned, 0);
  });
});

// ─── Static guards over the BR-SOURCE-11A source surface ──────────────────────

const CONNECTOR_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'source-catalog');

const RUNNER_SOURCE_FILES: readonly string[] = [
  path.join(CONNECTOR_DIR, 'br-receita-cnpj-full-join-dry-run-runner.ts'),
  path.join(CONNECTOR_DIR, 'br-receita-cnpj-full-join-output-sanitizer.ts'),
  path.join(CONNECTOR_DIR, 'br-receita-cnpj-full-join-no-write-guard.ts'),
  path.join(CONNECTOR_DIR, 'br-receita-cnpj-full-join-cleanup.ts'),
  path.join(SCRIPTS_DIR, 'run-br-receita-cnpj-full-join-dry-run.ts'),
];

/** Returns only the IMPORT / REQUIRE lines, so a denylist token used as DATA (e.g. a
 *  forbidden-flag name in the CLI) is not mistaken for a real dependency. */
function importLinesOf(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /\brequire\s*\(/.test(line));
}

/**
 * Strips block and line comments so the static guards assert on CODE, not prose. These
 * files document what they refuse to do ("never reads process.env"), and a naive scan
 * would read that documentation as the very thing it forbids.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('BR-SOURCE-11A runner — static import guards', () => {
  it('every BR-SOURCE-11A source file exists', () => {
    for (const file of RUNNER_SOURCE_FILES) {
      assert.ok(fs.existsSync(file), `expected ${path.basename(file)} to exist`);
    }
  });

  it('imports no Supabase client', () => {
    for (const file of RUNNER_SOURCE_FILES) {
      for (const line of importLinesOf(fs.readFileSync(file, 'utf8'))) {
        assert.ok(!/supabase/i.test(line), `${path.basename(file)} must not import Supabase`);
      }
    }
  });

  it('imports no Agent 1, provider, HubSpot or Slack module', () => {
    for (const file of RUNNER_SOURCE_FILES) {
      for (const line of importLinesOf(fs.readFileSync(file, 'utf8'))) {
        assert.ok(
          !/agent1|agents\/|hubspot|slack|apollo|lusha|tavily/i.test(line),
          `${path.basename(file)} must not import a runtime/provider module`,
        );
      }
    }
  });

  it('contains no snapshot write, no credential USE and no client construction', () => {
    for (const file of RUNNER_SOURCE_FILES) {
      const source = codeOf(fs.readFileSync(file, 'utf8'));
      const name = path.basename(file);
      assert.ok(!/source_company_snapshots/.test(source), `${name}: snapshot table`);
      assert.ok(!/\.insert\(|\.upsert\(|\.delete\(/.test(source), `${name}: db write`);
      assert.ok(!/createSupabaseAdminClient|createClient\(/.test(source), `${name}: client`);
      // Reading ANY env var is forbidden: it is the only way a credential could enter.
      // (`service_role` appears in these files solely as a violation-code LABEL, which
      // is why this asserts on credential USE rather than on the substring.)
      assert.ok(!/process\.env/.test(source), `${name}: env read`);
      assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY\b/.test(source), `${name}: env name`);
    }
  });

  it('embeds no real operator path', () => {
    for (const file of RUNNER_SOURCE_FILES) {
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(!/\/Users\//.test(source), `${path.basename(file)}: absolute user path`);
      assert.ok(!/\/home\/[a-z]/.test(source), `${path.basename(file)}: absolute home path`);
    }
  });

  it('the runner core performs no filesystem or network I/O of its own', () => {
    const runner = codeOf(
      fs.readFileSync(
        path.join(CONNECTOR_DIR, 'br-receita-cnpj-full-join-dry-run-runner.ts'),
        'utf8',
      ),
    );
    for (const line of importLinesOf(runner)) {
      assert.ok(!/node:fs|node:https?|node:net|\bfetch\b/.test(line), 'runner core must stay pure');
    }
    assert.ok(!/readFile|writeFile|createReadStream/.test(runner));
  });
});
