/**
 * BR Receita CNPJ FULL JOIN dry-run runner scaffold — tests (BR-SOURCE-11A / 11C).
 *
 * Proves the runner is the no-write/no-runtime scaffold the milestone claims:
 *   - `synthetic_fixture_only` (the DEFAULT) produces an ok, aggregate report;
 *   - every gate stays `not_approved` and every `run_scope` flag stays false;
 *   - every safety assertion stays false, including `identity_keys_constructed`;
 *   - the serialized report contains no row, no CNPJ/CNPJ básico/CPF, no email, no
 *     phone, no LinkedIn URL, and no synthetic fixture ref;
 *   - `local_manifest_dry_run` fails closed WITHOUT `allowLocalManifest`, and STILL
 *     fails closed WITH it whenever the manifest is not a SYNTHETIC TEMP manifest;
 *   - the BR-SOURCE-11C **Option B** carve-out runs ONLY with the full contract — the
 *     carve-out authorization, synthetic-temp trust, strict mode, an explicit
 *     unapproved sanitization version, all four bounded caps within their maxima, and
 *     an injected reader — and every gate/scope/safety assertion still holds;
 *   - a dangerous config (Supabase write / runtime / Agent 1 / provider / import)
 *     fails closed with zeroed metrics;
 *   - the bounded caps are enforced and a fixture beyond the synthetic ceiling fails.
 *
 * A CLI suite proves the argument surface refuses a real manifest, a download or
 * source-data path, a real prepared manifest basename, an uncapped or lenient Option B
 * run, and every escalation flag.
 *
 * A final STATIC-GUARD suite reads the source files and asserts their IMPORT surface
 * never reaches Supabase, Agent 1, HubSpot, Slack, or a provider, that no snapshot
 * write exists, that the runner core stays filesystem-free, and that no real operator
 * or dataset path is embedded anywhere.
 *
 * 100% synthetic. No dataset, no real manifest, no Supabase, no network, no runtime.
 * Every identifier-shaped token is assembled by CONCATENATION so no 8-/11-/14-digit
 * literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE,
  BRAZIL_RECEITA_FULL_JOIN_DRY_RUN_MODE,
  BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_ALLOWED_FAMILY_KEYS,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_COMPANY_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_COMPANY_SCAN_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_ESTABLISHMENT_ROWS,
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
  BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
  defaultBrazilReceitaFullJoinSyntheticFixture,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunInput,
  type BrazilReceitaFullJoinDryRunReport,
  type BrazilReceitaFullJoinLocalManifestScan,
  type BrazilReceitaFullJoinRealManifestMetadataScan,
} from '../br-receita-cnpj-full-join-dry-run-runner';
import {
  ForbiddenFullJoinRunnerModeError,
  parseFullJoinRunnerArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run';

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

// ─── Option B: a stubbed synthetic-temp reader ────────────────────────────────

/**
 * The scan a compliant synthetic-temp reader returns. Stubbed here so the runner's gate
 * is tested in isolation from the filesystem — the real generator has its own suite.
 * Refs are opaque labels, never dataset-shaped.
 */
function syntheticTempScan(
  overrides: Partial<BrazilReceitaFullJoinLocalManifestScan> = {},
): BrazilReceitaFullJoinLocalManifestScan {
  return {
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
    layoutMode: 'official_headerless',
    familiesScanned: ['empresas', 'estabelecimentos', 'cnaes'],
    filesScanned: 4,
    bytesCapApplied: true,
    bytesCapExceeded: false,
    fixture: {
      companies: [
        { companyRef: 'SYN_COMP_A', eligibility: 'eligible_for_future_import' },
        { companyRef: 'SYN_COMP_B', eligibility: 'excluded_legal_nature' },
      ],
      establishments: [
        { companyRef: 'SYN_COMP_A', privacySignal: false },
        { companyRef: 'SYN_COMP_B', privacySignal: false },
        { companyRef: null, privacySignal: false },
      ],
    },
    ...overrides,
  };
}

/** The FULL Option B contract. Individual tests remove exactly one condition. */
const OPTION_B_INPUT: BrazilReceitaFullJoinDryRunInput = {
  ...SAFE_INPUT,
  mode: 'local_manifest_dry_run',
  allowLocalManifest: true,
  manifestTrust: BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
  optionBCarveoutAuthorized: true,
  strict: true,
  productionWrites: false,
  outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  maxCompanyRows: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_COMPANY_ROWS,
  maxEstablishmentRows: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_ESTABLISHMENT_ROWS,
  maxCompanyScanRows: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_COMPANY_SCAN_ROWS,
  maxBytesPerFile: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE,
  localManifestReader: () => syntheticTempScan(),
};

/** Builds an Option B input with fields overridden or (via `undefined`) removed. */
function optionBInput(overrides: Record<string, unknown>): BrazilReceitaFullJoinDryRunInput {
  const merged: Record<string, unknown> = { ...OPTION_B_INPUT, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
  }
  return merged as unknown as BrazilReceitaFullJoinDryRunInput;
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
    assert.equal(report.errors[0]?.stage, 'option_b_gate');
  });

  it('STILL refuses local_manifest_dry_run with allowLocalManifest — a REAL manifest is never trusted', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      allowLocalManifest: true,
      manifest: { anything: true },
    });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'local_manifest_execution_not_authorized');
    assert.equal(report.manifest_trust, 'real_manifest_not_authorized');
    assert.equal(report.run_scope.full_dataset_processed, false);
  });

  it('refuses a real manifest even WITH the Option B authorization and a reader', () => {
    // Option B authorizes SYNTHETIC TEMP manifests. Declaring the carve-out over a real
    // manifest does not widen it: trust is checked before the authorization.
    const report = runBrazilReceitaFullJoinDryRun({
      ...OPTION_B_INPUT,
      manifestTrust: 'real_manifest_not_authorized',
      manifest: { declared: true },
    });
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'local_manifest_execution_not_authorized');
    assert.equal(report.aggregate_counts.local_manifest_files_scanned, 0);
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

// ─── Option B: the authorized synthetic temp-manifest carve-out ───────────────

describe('BR-SOURCE-11C Option B — an authorized synthetic temp-manifest run', () => {
  it('produces an ok report from the injected synthetic temp scan', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.equal(report.run_mode, 'local_manifest_dry_run');
    assert.equal(report.manifest_trust, 'synthetic_temp_manifest_only');
    assert.equal(report.option_b_carveout_authorized, true);
  });

  it('holds every approval gate at not_approved', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
    const gates = Object.values(report.decision_status);
    assert.equal(gates.length, 8);
    for (const gate of gates) assert.equal(gate, 'not_approved');
  });

  it('holds every run_scope flag at false', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
    for (const [key, value] of Object.entries(report.run_scope)) {
      assert.equal(value, false, `run_scope.${key} must be false`);
    }
  });

  it('holds every safety assertion at false, including identity_keys_constructed', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
    for (const [key, value] of Object.entries(report.safety)) {
      assert.equal(value, false, `safety.${key} must be false`);
    }
    assert.equal(report.safety.identity_keys_constructed, false);
  });

  it('keeps source_period null even though a manifest was generated', () => {
    assert.equal(runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT).source_period, null);
  });

  it('scores the scanned structure into aggregate join counts', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
    assert.equal(report.aggregate_counts.company_rows_scanned, 2);
    assert.equal(report.aggregate_counts.establishment_rows_scanned, 3);
    assert.equal(report.join_counts.joined_with_company_context, 1);
    assert.equal(report.join_counts.excluded_by_company_context, 1);
    assert.equal(report.join_counts.pending_full_join_context, 1);
  });

  it('reports the scanned file and family counts, and the applied byte ceiling', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
    assert.equal(report.aggregate_counts.local_manifest_files_scanned, 4);
    assert.equal(report.aggregate_counts.local_manifest_families_scanned, 3);
    assert.equal(report.guardrail_counts.local_manifest_bytes_cap_applied, 1);
  });

  it('emits only enums and integer counts — no row, no cell, no path', () => {
    const report = runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT);
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
    const serialized = JSON.stringify(report);
    assert.ok(!/"raw_(row|rows|data|cell)s?"\s*:/i.test(serialized));
    assert.ok(!/"record_identity_key"\s*:/i.test(serialized));
    assert.ok(!/"normalized_tax_id"\s*:/i.test(serialized));
    assert.ok(!serialized.includes('SYN_COMP_A'), 'a scanned ref must never be emitted');
    assert.ok(!/\.csv|\.json/i.test(serialized), 'no filename may reach the report');
    assert.ok(!serialized.includes('/'), 'no path separator may reach the report');
    assertNoForbiddenOutput(report);
  });

  it('passes the caps through to the reader', () => {
    const seen: Array<Record<string, number>> = [];
    runBrazilReceitaFullJoinDryRun(
      optionBInput({
        maxBytesPerFile: 1_024,
        maxCompanyScanRows: 7,
        localManifestReader: (request: Record<string, number>) => {
          seen.push({ ...request });
          return syntheticTempScan();
        },
      }),
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.maxBytesPerFile, 1_024);
    assert.equal(seen[0]?.maxCompanyScanRows, 7);
    assert.equal(seen[0]?.maxEstablishmentRows, BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_ESTABLISHMENT_ROWS);
  });

  it('calls the reader exactly once', () => {
    let calls = 0;
    runBrazilReceitaFullJoinDryRun(
      optionBInput({
        localManifestReader: () => {
          calls += 1;
          return syntheticTempScan();
        },
      }),
    );
    assert.equal(calls, 1);
  });
});

// ─── Option B: every missing condition fails closed ───────────────────────────

describe('BR-SOURCE-11C Option B — an incomplete contract fails closed', () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
    [
      'the carve-out authorization is absent',
      { optionBCarveoutAuthorized: undefined },
      'option_b_carveout_not_authorized',
    ],
    [
      'the carve-out authorization is false',
      { optionBCarveoutAuthorized: false },
      'option_b_carveout_not_authorized',
    ],
    [
      'the manifest trust is not synthetic-temp',
      { manifestTrust: 'real_manifest_not_authorized' },
      'local_manifest_execution_not_authorized',
    ],
    ['the manifest trust is absent', { manifestTrust: undefined }, 'local_manifest_execution_not_authorized'],
    ['allowLocalManifest is absent', { allowLocalManifest: undefined }, 'allow_local_manifest_required'],
    ['strict is absent', { strict: undefined }, 'strict_mode_required'],
    ['strict is false', { strict: false }, 'strict_mode_required'],
    ['production writes are requested', { productionWrites: true }, 'production_writes_requested'],
    [
      'the sanitization version is absent',
      { outputSanitizationVersion: undefined },
      'output_sanitization_version_not_approved',
    ],
    ['maxCompanyRows is absent', { maxCompanyRows: undefined }, 'local_manifest_caps_required'],
    [
      'maxEstablishmentRows is absent',
      { maxEstablishmentRows: undefined },
      'local_manifest_caps_required',
    ],
    [
      'maxCompanyScanRows is absent',
      { maxCompanyScanRows: undefined },
      'local_manifest_caps_required',
    ],
    ['maxBytesPerFile is absent', { maxBytesPerFile: undefined }, 'local_manifest_caps_required'],
    ['maxCompanyRows exceeds its maximum', { maxCompanyRows: 21 }, 'local_manifest_cap_exceeded'],
    [
      'maxEstablishmentRows exceeds its maximum',
      { maxEstablishmentRows: 21 },
      'local_manifest_cap_exceeded',
    ],
    [
      'maxCompanyScanRows exceeds its maximum',
      { maxCompanyScanRows: 1_001 },
      'local_manifest_cap_exceeded',
    ],
    [
      'maxBytesPerFile exceeds its maximum',
      { maxBytesPerFile: BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE + 1 },
      'local_manifest_cap_exceeded',
    ],
    ['a cap is negative', { maxCompanyRows: -1 }, 'local_manifest_cap_exceeded'],
    ['a cap is not an integer', { maxCompanyRows: 1.5 }, 'local_manifest_cap_exceeded'],
    [
      'no reader is injected',
      { localManifestReader: undefined },
      'local_manifest_reader_required',
    ],
  ];

  for (const [label, overrides, expectedCode] of cases) {
    it(`refuses when ${label}`, () => {
      const report = runBrazilReceitaFullJoinDryRun(optionBInput(overrides));
      assert.equal(report.ok, false, `${label} must fail closed`);
      assert.equal(report.errors[0]?.error_code, expectedCode);
      assert.equal(report.errors[0]?.stage, 'option_b_gate');
      // A refused run holds every gate, scope and safety assertion, and zeroes metrics.
      for (const gate of Object.values(report.decision_status)) assert.equal(gate, 'not_approved');
      for (const value of Object.values(report.run_scope)) assert.equal(value, false);
      for (const value of Object.values(report.safety)) assert.equal(value, false);
      for (const value of Object.values(report.aggregate_counts)) assert.equal(value, 0);
      assert.equal(report.cleanup.cleanup_required, true);
      assert.equal(report.cleanup.cleanup_status, 'not_executed');
    });
  }

  it('never invokes the reader when the gate refuses', () => {
    let calls = 0;
    const report = runBrazilReceitaFullJoinDryRun(
      optionBInput({
        strict: false,
        localManifestReader: () => {
          calls += 1;
          return syntheticTempScan();
        },
      }),
    );
    assert.equal(report.ok, false);
    assert.equal(calls, 0, 'a refused gate must read nothing at all');
  });
});

// ─── Option B: the reader's own claims are re-validated ───────────────────────

describe('BR-SOURCE-11C Option B — a non-compliant scan fails closed', () => {
  const scanCases: ReadonlyArray<
    readonly [string, Partial<BrazilReceitaFullJoinLocalManifestScan>, string]
  > = [
    [
      'the scan claims a real manifest',
      { manifestTrust: 'real_manifest_not_authorized' },
      'local_manifest_execution_not_authorized',
    ],
    [
      'the layout mode is not official_headerless',
      { layoutMode: 'header' },
      'local_manifest_layout_mode_not_authorized',
    ],
    [
      'a forbidden SOCIOS family was scanned',
      { familiesScanned: ['empresas', 'socios'] },
      'local_manifest_forbidden_file_family',
    ],
    [
      'a forbidden QSA family was scanned',
      { familiesScanned: ['qsa'] },
      'local_manifest_forbidden_file_family',
    ],
    [
      'an unrecognized family was scanned',
      { familiesScanned: ['contatos'] },
      'local_manifest_forbidden_file_family',
    ],
    [
      'a file exceeded the per-file byte ceiling',
      { bytesCapExceeded: true },
      'local_manifest_bytes_cap_exceeded',
    ],
    ['the scanned file count is not an integer', { filesScanned: 1.5 }, 'local_manifest_scan_invalid'],
  ];

  for (const [label, overrides, expectedCode] of scanCases) {
    it(`refuses when ${label}`, () => {
      const report = runBrazilReceitaFullJoinDryRun(
        optionBInput({ localManifestReader: () => syntheticTempScan(overrides) }),
      );
      assert.equal(report.ok, false, `${label} must fail closed`);
      assert.equal(report.errors[0]?.error_code, expectedCode);
      assert.equal(report.errors[0]?.stage, 'local_manifest_read');
      for (const value of Object.values(report.aggregate_counts)) assert.equal(value, 0);
    });
  }

  it('counts the forbidden families it refused', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      optionBInput({
        localManifestReader: () => syntheticTempScan({ familiesScanned: ['socios', 'qsa'] }),
      }),
    );
    assert.equal(report.guardrail_counts.local_manifest_forbidden_family_findings, 2);
  });

  it('refuses a malformed fixture inside an otherwise valid scan', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      optionBInput({
        localManifestReader: () =>
          syntheticTempScan({
            fixture: { companies: 'nope', establishments: [] },
          } as unknown as Partial<BrazilReceitaFullJoinLocalManifestScan>),
      }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'synthetic_fixture_invalid');
    assert.equal(report.errors[0]?.stage, 'fixture_validation');
  });

  it('swallows a reader failure into a value-free error code', () => {
    const secret = 'SYNTHETIC' + '_PATH_LIKE_DETAIL';
    const report = runBrazilReceitaFullJoinDryRun(
      optionBInput({
        localManifestReader: () => {
          throw new Error(secret);
        },
      }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]?.error_code, 'local_manifest_read_failed');
    assert.equal(report.errors[0]?.stage, 'local_manifest_read');
    assert.ok(!JSON.stringify(report).includes(secret), 'a reader message must never survive');
  });

  it('never emits a ref, even a dataset-shaped one, that the scan carried', () => {
    const datasetShapedRef = '1122' + '2333' + '000199';
    const report = runBrazilReceitaFullJoinDryRun(
      optionBInput({
        localManifestReader: () =>
          syntheticTempScan({
            fixture: {
              companies: [
                { companyRef: datasetShapedRef, eligibility: 'eligible_for_future_import' },
              ],
              establishments: [{ companyRef: datasetShapedRef, privacySignal: false }],
            },
          }),
      }),
    );
    assert.equal(report.ok, true);
    assert.ok(!JSON.stringify(report).includes(datasetShapedRef));
    assertNoForbiddenOutput(report);
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

// ─── CLI argument surface ─────────────────────────────────────────────────────

/** The four bounded caps every Option B CLI invocation must state. */
const CLI_CAPS = [
  '--max-company-rows',
  '20',
  '--max-establishment-rows',
  '20',
  '--max-company-scan-rows',
  '1000',
  '--max-bytes-per-file',
  '1000000',
];

describe('BR-SOURCE-11C CLI — accepted modes', () => {
  it('accepts --synthetic-fixture', () => {
    const options = parseFullJoinRunnerArgs(['--synthetic-fixture', '--format', 'json', '--strict']);
    assert.equal(options.runMode, 'synthetic_fixture_only');
    assert.equal(options.syntheticTempManifest, false);
    assert.equal(options.manifestPath, null);
  });

  it('accepts --synthetic-temp-manifest with --strict and every cap', () => {
    const options = parseFullJoinRunnerArgs([
      '--synthetic-temp-manifest',
      '--format',
      'json',
      '--strict',
      ...CLI_CAPS,
    ]);
    assert.equal(options.runMode, 'local_manifest_dry_run');
    assert.equal(options.syntheticTempManifest, true);
    assert.equal(options.allowLocalManifest, true);
    assert.equal(options.strict, true);
    assert.equal(options.maxBytesPerFile, 1_000_000);
    // Option B never involves an operator-supplied manifest path.
    assert.equal(options.manifestPath, null);
  });
});

describe('BR-SOURCE-11C CLI — refuses a real manifest', () => {
  const realManifestCases: ReadonlyArray<readonly [string, string[]]> = [
    ['--manifest without --allow-local-manifest', ['--manifest', 'some-manifest.json']],
    [
      'a Downloads path',
      ['--manifest', 'Downloads/manifest.json', '--allow-local-manifest'],
    ],
    [
      'a sellup-source-data path',
      ['--manifest', 'sellup-source-data/manifest.json', '--allow-local-manifest'],
    ],
    [
      'a raw-zips path',
      ['--manifest', 'staging/raw-zips/manifest.json', '--allow-local-manifest'],
    ],
    [
      'an extracted path',
      ['--manifest', 'staging/extracted/manifest.json', '--allow-local-manifest'],
    ],
    [
      'a manifest-input path',
      ['--manifest', 'staging/manifest-input/manifest.json', '--allow-local-manifest'],
    ],
    [
      'a dados_abertos path',
      ['--manifest', 'dados_abertos/manifest.json', '--allow-local-manifest'],
    ],
    [
      'the real prepared manifest basename',
      ['--manifest', 'prepared/manifest.headerless.json', '--allow-local-manifest'],
    ],
    ['a URL manifest', ['--manifest', 'https://example.test/manifest.json', '--allow-local-manifest']],
    ['a non-JSON manifest', ['--manifest', 'manifest.csv', '--allow-local-manifest']],
  ];

  for (const [label, argv] of realManifestCases) {
    it(`refuses ${label}`, () => {
      assert.throws(
        () => parseFullJoinRunnerArgs([...argv, '--format', 'json', '--strict', ...CLI_CAPS]),
        ForbiddenFullJoinRunnerModeError,
      );
    });
  }

  it('never echoes the refused path', () => {
    const marker = 'SYNTHETIC' + '_OPERATOR_DIR';
    try {
      parseFullJoinRunnerArgs([
        '--manifest',
        `${marker}/Downloads/manifest.json`,
        '--allow-local-manifest',
      ]);
      assert.fail('expected a refusal');
    } catch (err) {
      assert.ok(err instanceof ForbiddenFullJoinRunnerModeError);
      assert.ok(!err.message.includes(marker), 'the refused path must never be echoed');
    }
  });
});

describe('BR-SOURCE-11C CLI — refuses an incomplete Option B invocation', () => {
  it('refuses --synthetic-temp-manifest without --strict', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs(['--synthetic-temp-manifest', '--format', 'json', ...CLI_CAPS]),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  const capFlags = [
    '--max-company-rows',
    '--max-establishment-rows',
    '--max-company-scan-rows',
    '--max-bytes-per-file',
  ];

  for (const omitted of capFlags) {
    it(`refuses --synthetic-temp-manifest without ${omitted}`, () => {
      const kept: string[] = [];
      for (let i = 0; i < CLI_CAPS.length; i += 2) {
        if (CLI_CAPS[i] !== omitted) kept.push(CLI_CAPS[i]!, CLI_CAPS[i + 1]!);
      }
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            '--synthetic-temp-manifest',
            '--format',
            'json',
            '--strict',
            ...kept,
          ]),
        ForbiddenFullJoinRunnerModeError,
      );
    });
  }

  it('refuses a byte ceiling above the Option B maximum', () => {
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([
          '--synthetic-temp-manifest',
          '--strict',
          '--max-company-rows',
          '20',
          '--max-establishment-rows',
          '20',
          '--max-company-scan-rows',
          '1000',
          '--max-bytes-per-file',
          String(BRAZIL_RECEITA_FULL_JOIN_OPTION_B_MAX_BYTES_PER_FILE + 1),
        ]),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('refuses a bare invocation with no mode', () => {
    assert.throws(() => parseFullJoinRunnerArgs([]), ForbiddenFullJoinRunnerModeError);
  });

  it('refuses two modes at once', () => {
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([
          '--synthetic-fixture',
          '--synthetic-temp-manifest',
          '--strict',
          ...CLI_CAPS,
        ]),
      ForbiddenFullJoinRunnerModeError,
    );
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([
          '--synthetic-temp-manifest',
          '--manifest',
          'x.json',
          '--allow-local-manifest',
          '--strict',
          ...CLI_CAPS,
        ]),
      ForbiddenFullJoinRunnerModeError,
    );
  });
});

describe('BR-SOURCE-11C CLI — refuses every escalation flag', () => {
  const forbiddenFlags = [
    '--import',
    '--execute',
    '--download',
    '--runtime',
    '--agent1',
    '--provider',
    '--supabase',
    '--service-role',
    '--production',
    '--hubspot',
    '--slack',
    '--url',
    '--remote',
    '--full-dataset',
    '--write',
    '--csv',
    '--zip',
    '--input',
  ];

  for (const flag of forbiddenFlags) {
    it(`refuses ${flag}`, () => {
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            '--synthetic-temp-manifest',
            '--strict',
            ...CLI_CAPS,
            flag,
            'anything',
          ]),
        ForbiddenFullJoinRunnerModeError,
      );
    });
  }

  it('refuses an --output path inside the repository', () => {
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([
          '--synthetic-fixture',
          '--output',
          path.join(path.resolve(__dirname, '..'), 'report.json'),
        ]),
      ForbiddenFullJoinRunnerModeError,
    );
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
  path.join(CONNECTOR_DIR, 'br-receita-cnpj-synthetic-temp-manifest.ts'),
  path.join(CONNECTOR_DIR, 'br-receita-cnpj-real-manifest-metadata-reader.ts'),
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

  it('embeds no real dataset path and no real manifest name', () => {
    // A denylist ENTRY (a bare segment such as `extracted`) is legitimate — that is how
    // the CLI refuses one. A real PATH literal (a segment sitting between separators)
    // is not, so the guard asserts on the path shape rather than on the token.
    const realPathShape =
      /['"`][^'"`]*\/(?:downloads|descargas|dados[_-]abertos|sellup[_-]source[_-]data|raw[_-]zips|extracted|manifest[_-]input)\//i;
    for (const file of RUNNER_SOURCE_FILES) {
      const source = codeOf(fs.readFileSync(file, 'utf8'));
      const name = path.basename(file);
      assert.ok(!realPathShape.test(source), `${name}: embedded real dataset path`);
      // The real prepared manifest may be NAMED in the refusal denylist, never opened.
      const opensRealManifest = /(?:readFileSync|openSync|createReadStream)\([^)]*headerless/i;
      assert.ok(!opensRealManifest.test(source), `${name}: opens a real prepared manifest`);
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
      assert.ok(!/node:fs|node:os|node:https?|node:net|\bfetch\b/.test(line), 'runner core must stay pure');
    }
    assert.ok(!/readFile|writeFile|createReadStream|mkdtemp|rmSync/.test(runner));
  });

  it('only the two reader modules and the CLI touch the filesystem', () => {
    const filesystemOwners = new Set([
      'br-receita-cnpj-synthetic-temp-manifest.ts',
      'br-receita-cnpj-real-manifest-metadata-reader.ts',
      'run-br-receita-cnpj-full-join-dry-run.ts',
    ]);
    for (const file of RUNNER_SOURCE_FILES) {
      const name = path.basename(file);
      if (filesystemOwners.has(name)) continue;
      const source = codeOf(fs.readFileSync(file, 'utf8'));
      assert.ok(!/\bfs\./.test(source), `${name} must not touch the filesystem`);
    }
  });

  it('the synthetic temp-manifest module reads only a workspace it created', () => {
    const source = codeOf(
      fs.readFileSync(path.join(CONNECTOR_DIR, 'br-receita-cnpj-synthetic-temp-manifest.ts'), 'utf8'),
    );
    assert.ok(source.includes('mkdtempSync'), 'the workspace must be self-created');
    assert.ok(source.includes('os.tmpdir()'), 'the workspace must live under the OS temp root');
    // Every path it builds is rooted in `directory` (its own workspace) or in os.tmpdir().
    for (const joined of source.match(/path\.join\([^)]*\)/g) ?? []) {
      assert.ok(
        /path\.join\(\s*(?:directory|os\.tmpdir\(\))/.test(joined),
        'every joined path must be rooted in the self-created workspace or the temp root',
      );
    }
  });

  it('the metadata reader opens exactly one path and never a second file', () => {
    const source = codeOf(
      fs.readFileSync(
        path.join(CONNECTOR_DIR, 'br-receita-cnpj-real-manifest-metadata-reader.ts'),
        'utf8',
      ),
    );
    // Exactly ONE descriptor, on the captured manifest path — the load-bearing invariant
    // of the metadata-only carve-out (decision record § 4.3 / § 7.1).
    assert.equal((source.match(/openSync\s*\(/g) ?? []).length, 1, 'exactly one open call');
    assert.ok(/fs\.openSync\(\s*manifestPath\s*,/.test(source), 'the open targets the manifest');
    for (const forbidden of [
      'statSync',
      'existsSync',
      'readdirSync',
      'readFileSync',
      'createReadStream',
      'writeFileSync',
      'path.join',
      'path.resolve',
    ]) {
      assert.ok(!source.includes(forbidden), `the metadata reader must not use ${forbidden}`);
    }
  });
});

// ─── BR-SOURCE-11D-META-IMPL: the metadata-only carve-out at the runner ───────

/** A compliant metadata scan. Stubbed so the runner's gate is tested in isolation. */
function metadataScan(
  overrides: Partial<BrazilReceitaFullJoinRealManifestMetadataScan> = {},
): BrazilReceitaFullJoinRealManifestMetadataScan {
  return {
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
    layoutMode: 'official_headerless',
    schemaVersionPresent: true,
    sourcePeriodPresent: true,
    declaredFileCount: 5,
    declaredFamilyCounts: {
      empresas: 1,
      estabelecimentos: 1,
      simples: 0,
      cnaes: 1,
      municipios: 1,
      naturezas: 1,
      other: 0,
    },
    requiredFamilyCount: 2,
    missingRequiredFamilyCount: 0,
    forbiddenFamilyCount: 0,
    manifestBytesReadBucket: 'lte_1mb',
    referencedDataFilesOpened: false,
    referencedDataFilesStatted: false,
    refusalCode: null,
    ...overrides,
  };
}

/** The FULL metadata-only contract. Individual tests remove exactly one condition. */
const METADATA_ONLY_INPUT: BrazilReceitaFullJoinDryRunInput = {
  ...SAFE_INPUT,
  mode: 'local_manifest_dry_run',
  allowLocalManifest: true,
  manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
  realManifestMetadataOnlyOptionBAuthorized: true,
  strict: true,
  productionWrites: false,
  outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  maxManifestBytes: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
  realManifestMetadataReader: () => metadataScan(),
};

function metadataInput(overrides: Record<string, unknown>): BrazilReceitaFullJoinDryRunInput {
  const merged: Record<string, unknown> = { ...METADATA_ONLY_INPUT, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
  }
  return merged as unknown as BrazilReceitaFullJoinDryRunInput;
}

describe('BR-SOURCE-11D-META-IMPL — an authorized metadata-only run', () => {
  it('produces an ok report from the injected metadata scan', () => {
    const report = runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT);
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.equal(report.run_mode, 'local_manifest_dry_run');
    assert.equal(report.manifest_trust, 'real_manifest_metadata_only');
    assert.equal(report.real_manifest_metadata_only_option_b_authorized, true);
    // The synthetic temp-manifest carve-out was NOT declared, and is not implied.
    assert.equal(report.option_b_carveout_authorized, false);
  });

  it('holds every approval gate at not_approved', () => {
    const gates = Object.values(runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT).decision_status);
    assert.equal(gates.length, 8);
    for (const gate of gates) assert.equal(gate, 'not_approved');
  });

  it('holds every run_scope flag and every safety assertion at false', () => {
    const report = runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT);
    for (const [key, value] of Object.entries(report.run_scope)) {
      assert.equal(value, false, `run_scope.${key} must be false`);
    }
    for (const [key, value] of Object.entries(report.safety)) {
      assert.equal(value, false, `safety.${key} must be false`);
    }
  });

  it('reports the aggregate manifest metadata', () => {
    const metadata = runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT).manifest_metadata;
    assert.ok(metadata !== null);
    assert.equal(metadata.schema_version_present, true);
    assert.equal(metadata.source_period_present, true);
    assert.equal(metadata.layout_mode, 'official_headerless');
    assert.equal(metadata.declared_file_count, 5);
    assert.equal(metadata.required_family_count, 2);
    assert.equal(metadata.missing_required_family_count, 0);
    assert.equal(metadata.forbidden_family_count, 0);
    assert.equal(metadata.required_families_present, true);
    assert.equal(metadata.forbidden_families_present, false);
    assert.equal(metadata.manifest_bytes_read_bucket, 'lte_1mb');
  });

  it('asserts no referenced data file was opened, statted, or printed', () => {
    const metadata = runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT).manifest_metadata;
    assert.ok(metadata !== null);
    assert.equal(metadata.referenced_data_files_opened, false);
    assert.equal(metadata.referenced_data_files_statted, false);
    assert.equal(metadata.raw_manifest_printed, false);
    assert.equal(metadata.absolute_paths_printed, false);
  });

  it('reads no row: every row, eligibility and join count stays zero', () => {
    const report = runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT);
    for (const [key, value] of Object.entries(report.aggregate_counts)) {
      assert.equal(value, 0, `aggregate_counts.${key} must be zero — no row is read`);
    }
    for (const [key, value] of Object.entries(report.eligibility_counts)) {
      assert.equal(value, 0, `eligibility_counts.${key} must be zero`);
    }
    for (const [key, value] of Object.entries(report.join_counts)) {
      assert.equal(value, 0, `join_counts.${key} must be zero — no join is computed`);
    }
    assert.equal(report.source_period, null);
  });

  it('keys family counts only under the allowlist, and drops anything else', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      metadataInput({
        realManifestMetadataReader: () =>
          metadataScan({
            declaredFamilyCounts: { empresas: 1, estabelecimentos: 1, socios: 3, other: 0 },
          }),
      }),
    );
    const metadata = report.manifest_metadata;
    assert.ok(metadata !== null);
    assert.ok(!Object.keys(metadata.declared_family_counts).includes('socios'));
    for (const key of Object.keys(metadata.declared_family_counts)) {
      assert.ok(
        BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_ALLOWED_FAMILY_KEYS.includes(key),
        `unexpected family key ${key}`,
      );
    }
  });

  it('emits no forbidden pattern anywhere in the report', () => {
    assertNoForbiddenOutput(runBrazilReceitaFullJoinDryRun(METADATA_ONLY_INPUT));
  });

  it('leaves manifest_metadata null on every non-metadata mode', () => {
    assert.equal(runBrazilReceitaFullJoinDryRun(SAFE_INPUT).manifest_metadata, null);
    assert.equal(runBrazilReceitaFullJoinDryRun(OPTION_B_INPUT).manifest_metadata, null);
  });
});

describe('BR-SOURCE-11D-META-IMPL — an incomplete contract fails closed', () => {
  const cases: ReadonlyArray<readonly [label: string, overrides: Record<string, unknown>, code: string]> =
    [
      ['no allowLocalManifest', { allowLocalManifest: undefined }, 'allow_local_manifest_required'],
      [
        'no metadata-only authorization',
        { realManifestMetadataOnlyOptionBAuthorized: undefined },
        'real_manifest_metadata_only_not_authorized',
      ],
      [
        'the SYNTHETIC carve-out flag instead of the metadata one',
        { realManifestMetadataOnlyOptionBAuthorized: undefined, optionBCarveoutAuthorized: true },
        'real_manifest_metadata_only_not_authorized',
      ],
      ['no strict mode', { strict: undefined }, 'strict_mode_required'],
      ['production writes requested', { productionWrites: true }, 'production_writes_requested'],
      [
        'no sanitization version',
        { outputSanitizationVersion: undefined },
        'output_sanitization_version_not_approved',
      ],
      [
        'no maxManifestBytes',
        { maxManifestBytes: undefined },
        'real_manifest_metadata_caps_required',
      ],
      [
        'no maxDeclaredFiles',
        { maxDeclaredFiles: undefined },
        'real_manifest_metadata_caps_required',
      ],
      [
        'maxManifestBytes above its ceiling',
        { maxManifestBytes: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES + 1 },
        'real_manifest_metadata_cap_exceeded',
      ],
      [
        'maxDeclaredFiles above its ceiling',
        { maxDeclaredFiles: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES + 1 },
        'real_manifest_metadata_cap_exceeded',
      ],
      [
        'no injected reader',
        { realManifestMetadataReader: undefined },
        'real_manifest_metadata_reader_required',
      ],
    ];

  for (const [label, overrides, code] of cases) {
    it(`fails closed with ${label}`, () => {
      const report = runBrazilReceitaFullJoinDryRun(metadataInput(overrides));
      assert.equal(report.ok, false);
      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0]!.error_code, code);
      assert.equal(report.errors[0]!.stage, 'real_manifest_metadata_gate');
      assert.equal(report.manifest_metadata, null);
      // No partial metric survives a refusal.
      for (const value of Object.values(report.aggregate_counts)) assert.equal(value, 0);
      assert.equal(report.cleanup.cleanup_required, true);
    });
  }

  it('refuses the metadata flag on a SYNTHETIC temp-manifest run', () => {
    // The metadata-only phrase buys nothing on the synthetic path, exactly as the
    // synthetic phrase buys nothing on the metadata path.
    const report = runBrazilReceitaFullJoinDryRun(
      optionBInput({
        optionBCarveoutAuthorized: undefined,
        realManifestMetadataOnlyOptionBAuthorized: true,
      }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]!.error_code, 'option_b_carveout_not_authorized');
  });

  it('still refuses a real manifest offered for EXECUTION', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      metadataInput({ manifestTrust: 'real_manifest_not_authorized' }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]!.error_code, 'local_manifest_execution_not_authorized');
    assert.equal(report.manifest_metadata, null);
  });

  it('never calls the reader when the gate refuses', () => {
    let calls = 0;
    runBrazilReceitaFullJoinDryRun(
      metadataInput({
        strict: undefined,
        realManifestMetadataReader: () => {
          calls += 1;
          return metadataScan();
        },
      }),
    );
    assert.equal(calls, 0, 'a refused gate must not reach the reader');
  });

  it('calls the reader at most once on an authorized run', () => {
    let calls = 0;
    runBrazilReceitaFullJoinDryRun(
      metadataInput({
        realManifestMetadataReader: () => {
          calls += 1;
          return metadataScan();
        },
      }),
    );
    assert.equal(calls, 1);
  });
});

describe('BR-SOURCE-11D-META-IMPL — a non-compliant scan fails closed', () => {
  const scanCases: ReadonlyArray<
    readonly [label: string, scan: unknown, code: string, metadataExpected: boolean]
  > = [
    ['a non-object scan', 'not-a-scan', 'real_manifest_metadata_scan_invalid', false],
    [
      'a mis-declared trust level',
      metadataScan({ manifestTrust: 'synthetic_temp_manifest_only' }),
      'local_manifest_execution_not_authorized',
      false,
    ],
    [
      'an admitted referenced-file open',
      metadataScan({ referencedDataFilesOpened: true as never }),
      'real_manifest_metadata_referenced_file_access_detected',
      false,
    ],
    [
      'an admitted referenced-file stat',
      metadataScan({ referencedDataFilesStatted: true as never }),
      'real_manifest_metadata_referenced_file_access_detected',
      false,
    ],
    [
      'an unrecognized byte bucket',
      metadataScan({ manifestBytesReadBucket: 'unbounded' }),
      'real_manifest_metadata_scan_invalid',
      false,
    ],
    [
      'a non-integer declared count',
      metadataScan({ declaredFileCount: 1.5 }),
      'real_manifest_metadata_scan_invalid',
      false,
    ],
    [
      'an unsupported layout mode',
      metadataScan({ layoutMode: 'header', refusalCode: 'manifest_layout_unsupported' }),
      'real_manifest_metadata_layout_mode_not_authorized',
      true,
    ],
    [
      'an unsupported layout mode the reader forgot to report',
      metadataScan({ layoutMode: 'header' }),
      'real_manifest_metadata_layout_mode_not_authorized',
      true,
    ],
    [
      'a forbidden family',
      metadataScan({ forbiddenFamilyCount: 2, refusalCode: 'manifest_forbidden_family_detected' }),
      'real_manifest_metadata_forbidden_family_detected',
      true,
    ],
    [
      'a forbidden family the reader forgot to report',
      metadataScan({ forbiddenFamilyCount: 1 }),
      'real_manifest_metadata_forbidden_family_detected',
      true,
    ],
    [
      'a missing required family',
      metadataScan({
        missingRequiredFamilyCount: 1,
        requiredFamilyCount: 1,
        refusalCode: 'manifest_missing_required_family',
      }),
      'real_manifest_metadata_missing_required_family',
      true,
    ],
    [
      'an oversized manifest',
      metadataScan({
        manifestBytesReadBucket: 'over_limit_blocked',
        refusalCode: 'manifest_metadata_cap_exceeded',
      }),
      'real_manifest_metadata_cap_exceeded',
      true,
    ],
    [
      // An unmappable refusal means the reader is not one this runner understands, so the
      // scan is treated as structurally invalid and nothing from it is reported.
      'an unrecognized refusal code',
      metadataScan({ refusalCode: 'something_else' }),
      'real_manifest_metadata_scan_invalid',
      false,
    ],
  ];

  for (const [label, scan, code, metadataExpected] of scanCases) {
    it(`fails closed on ${label}`, () => {
      const report = runBrazilReceitaFullJoinDryRun(
        metadataInput({
          realManifestMetadataReader: () => scan as BrazilReceitaFullJoinRealManifestMetadataScan,
        }),
      );
      assert.equal(report.ok, false);
      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0]!.error_code, code);
      assert.equal(report.errors[0]!.stage, 'real_manifest_metadata_read');
      // A CONTENT refusal still reports the aggregate that explains it; a structurally
      // invalid scan carries nothing reportable.
      assert.equal(report.manifest_metadata !== null, metadataExpected);
      for (const value of Object.values(report.join_counts)) assert.equal(value, 0);
      assertNoForbiddenOutput(report);
    });
  }

  it('fails closed when the reader throws, without carrying its message', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      metadataInput({
        realManifestMetadataReader: () => {
          throw new Error('/synthetic/absolute/path/that/must/not/leak.json');
        },
      }),
    );
    assert.equal(report.ok, false);
    assert.equal(report.errors[0]!.error_code, 'real_manifest_metadata_read_failed');
    assert.equal(report.errors[0]!.stage, 'real_manifest_metadata_read');
    assert.ok(!JSON.stringify(report).includes('must/not/leak'));
    assertNoForbiddenOutput(report);
  });

  it('reports a forbidden family as a COUNT and never as a label', () => {
    const report = runBrazilReceitaFullJoinDryRun(
      metadataInput({
        realManifestMetadataReader: () =>
          metadataScan({
            forbiddenFamilyCount: 3,
            refusalCode: 'manifest_forbidden_family_detected',
          }),
      }),
    );
    assert.equal(report.manifest_metadata?.forbidden_family_count, 3);
    assert.equal(report.manifest_metadata?.forbidden_families_present, true);
    assert.equal(report.guardrail_counts.local_manifest_forbidden_family_findings, 3);
  });
});

// ─── CLI: the metadata-only argument surface ──────────────────────────────────

const METADATA_CLI_CAPS = [
  '--max-manifest-bytes',
  '1000000',
  '--max-declared-files',
  '20',
];

/** A synthetic, non-existent manifest path. Parsing never opens it. */
const SYNTHETIC_CLI_MANIFEST = path.join('synthetic-root', 'synthetic-metadata-manifest.json');

describe('BR-SOURCE-11D-META-IMPL CLI — accepts a complete metadata-only invocation', () => {
  it('parses the full metadata-only contract', () => {
    const options = parseFullJoinRunnerArgs([
      '--manifest',
      SYNTHETIC_CLI_MANIFEST,
      '--allow-local-manifest',
      '--real-manifest-metadata-only',
      '--format',
      'json',
      '--strict',
      ...METADATA_CLI_CAPS,
    ]);
    assert.equal(options.runMode, 'local_manifest_dry_run');
    assert.equal(options.realManifestMetadataOnly, true);
    assert.equal(options.allowLocalManifest, true);
    assert.equal(options.strict, true);
    assert.equal(options.maxManifestBytes, 1_000_000);
    assert.equal(options.maxDeclaredFiles, 20);
    assert.equal(options.syntheticTempManifest, false);
  });

  it('leaves realManifestMetadataOnly false on the synthetic modes', () => {
    assert.equal(parseFullJoinRunnerArgs(['--synthetic-fixture']).realManifestMetadataOnly, false);
    assert.equal(
      parseFullJoinRunnerArgs(['--synthetic-temp-manifest', '--strict', ...CLI_CAPS])
        .realManifestMetadataOnly,
      false,
    );
  });
});

describe('BR-SOURCE-11D-META-IMPL CLI — refuses an incomplete metadata-only invocation', () => {
  const refusals: ReadonlyArray<readonly [label: string, argv: readonly string[]]> = [
    ['no --manifest', ['--real-manifest-metadata-only', '--strict', ...METADATA_CLI_CAPS, '--synthetic-fixture']],
    [
      'no --allow-local-manifest',
      ['--manifest', SYNTHETIC_CLI_MANIFEST, '--real-manifest-metadata-only', '--strict', ...METADATA_CLI_CAPS],
    ],
    [
      'no --strict',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        ...METADATA_CLI_CAPS,
      ],
    ],
    [
      'no caps at all',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
      ],
    ],
    [
      'only --max-manifest-bytes',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        '--max-manifest-bytes',
        '1000000',
      ],
    ],
    [
      'only --max-declared-files',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        '--max-declared-files',
        '20',
      ],
    ],
    [
      '--max-manifest-bytes above its ceiling',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        '--max-manifest-bytes',
        '1000001',
        '--max-declared-files',
        '20',
      ],
    ],
    [
      '--max-declared-files above its ceiling',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        '--max-manifest-bytes',
        '1000000',
        '--max-declared-files',
        '21',
      ],
    ],
    [
      'a URL manifest',
      [
        '--manifest',
        'https://example.invalid/manifest.json',
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        ...METADATA_CLI_CAPS,
      ],
    ],
    [
      'a non-.json manifest',
      [
        '--manifest',
        path.join('synthetic-root', 'empresas.csv'),
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        ...METADATA_CLI_CAPS,
      ],
    ],
    [
      'a real prepared manifest basename',
      [
        '--manifest',
        path.join('synthetic-root', 'manifest.headerless.json'),
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        ...METADATA_CLI_CAPS,
      ],
    ],
    [
      'a dataset staging directory',
      [
        '--manifest',
        path.join('synthetic-root', 'extracted', 'manifest.json'),
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--strict',
        ...METADATA_CLI_CAPS,
      ],
    ],
    [
      'combined with --synthetic-temp-manifest',
      [
        '--manifest',
        SYNTHETIC_CLI_MANIFEST,
        '--allow-local-manifest',
        '--real-manifest-metadata-only',
        '--synthetic-temp-manifest',
        '--strict',
        ...METADATA_CLI_CAPS,
      ],
    ],
  ];

  for (const [label, argv] of refusals) {
    it(`refuses ${label}`, () => {
      assert.throws(() => parseFullJoinRunnerArgs([...argv]), ForbiddenFullJoinRunnerModeError);
    });
  }

  for (const flag of ['--import', '--runtime', '--agent1', '--provider']) {
    it(`refuses ${flag} on a metadata-only invocation`, () => {
      assert.throws(
        () =>
          parseFullJoinRunnerArgs([
            '--manifest',
            SYNTHETIC_CLI_MANIFEST,
            '--allow-local-manifest',
            '--real-manifest-metadata-only',
            '--strict',
            ...METADATA_CLI_CAPS,
            flag,
            'anything',
          ]),
        ForbiddenFullJoinRunnerModeError,
      );
    });
  }
});

// ─── BR-SOURCE-11F-IMPL: the required-family probe trust, from the runner's side ─

/**
 * These tests cover what the RUNNER owes the Option C carve-out: the probe trust is
 * dispatched separately, it is refused without its own authorization, it never leaks into a
 * run that did not ask for it, and no earlier authorization substitutes for it. The probe
 * module, the caps and the real bounded read have their own dedicated suite
 * (`br-receita-cnpj-required-family-probe.test.ts`).
 */
describe('BR-SOURCE-11F-IMPL required-family probe trust — runner dispatch', () => {
  const PROBE_TRUST = 'real_manifest_required_family_probe';

  it('reports no probe block on a synthetic-fixture run', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    assert.equal(report.required_family_probe, null);
    assert.equal(report.required_family_probe_authorized, false);
  });

  it('reports no probe block on an Option B synthetic-temp run', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...OPTION_B_INPUT,
      localManifestReader: () => syntheticTempScan(),
    });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.required_family_probe, null);
    assert.equal(report.required_family_probe_authorized, false);
  });

  it('refuses the probe trust when NO probe authorization is declared', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      manifestTrust: PROBE_TRUST,
      allowLocalManifest: true,
      strict: true,
      outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
      maxManifestBytes: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
      maxDeclaredFiles: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
    } as unknown as BrazilReceitaFullJoinDryRunInput);

    assert.equal(report.ok, false);
    assert.equal(report.manifest_trust, PROBE_TRUST);
    assert.equal(report.required_family_probe, null);
    // The manifest gate runs FIRST: a probe never opens a data file on a run that could not
    // even read its control document.
    assert.equal(report.errors[0]!.error_code, 'real_manifest_metadata_only_not_authorized');
    assert.equal(report.errors[0]!.stage, 'real_manifest_metadata_gate');
  });

  it('refuses the probe trust when only the EARLIER authorizations are declared', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      manifestTrust: PROBE_TRUST,
      allowLocalManifest: true,
      strict: true,
      optionBCarveoutAuthorized: true,
      realManifestMetadataOnlyOptionBAuthorized: true,
      realManifestMetadataOnlyExecutionAuthorized: true,
      outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
      maxManifestBytes: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_MANIFEST_BYTES,
      maxDeclaredFiles: BRAZIL_RECEITA_FULL_JOIN_METADATA_ONLY_MAX_DECLARED_FILES,
      realManifestMetadataReader: () =>
        ({
          manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
          layoutMode: 'official_headerless',
          schemaVersionPresent: true,
          sourcePeriodPresent: true,
          declaredFileCount: 2,
          declaredFamilyCounts: { empresas: 1, estabelecimentos: 1 },
          requiredFamilyCount: 2,
          missingRequiredFamilyCount: 0,
          forbiddenFamilyCount: 0,
          manifestBytesReadBucket: 'lte_1mb',
          operatorPreparedManifestAuthorized: true,
          referencedDataFilesOpened: false,
          referencedDataFilesStatted: false,
          refusalCode: null,
        }) as BrazilReceitaFullJoinRealManifestMetadataScan,
    } as unknown as BrazilReceitaFullJoinDryRunInput);

    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      { error_code: 'required_family_probe_not_authorized', stage: 'required_family_probe_gate' },
    ]);
    // The manifest metadata that explains the refusal is still reported as an aggregate.
    assert.notEqual(report.manifest_metadata, null);
    assert.equal(report.required_family_probe, null);
  });

  it('does not let the probe authorization unlock the Option B or metadata paths', () => {
    const optionB = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      manifestTrust: BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
      allowLocalManifest: true,
      strict: true,
      requiredFamilyProbeAuthorized: true,
      outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
    } as unknown as BrazilReceitaFullJoinDryRunInput);
    assert.equal(optionB.ok, false);
    assert.equal(optionB.errors[0]!.error_code, 'option_b_carveout_not_authorized');

    const metadata = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
      allowLocalManifest: true,
      strict: true,
      requiredFamilyProbeAuthorized: true,
      outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
    } as unknown as BrazilReceitaFullJoinDryRunInput);
    assert.equal(metadata.ok, false);
    assert.equal(metadata.errors[0]!.error_code, 'real_manifest_metadata_only_not_authorized');
  });
});

// ─── BR-SOURCE-11G-IMPL: the join-probe fields on every OTHER path ─────────────

/**
 * The 11G join-probe carve-out added two provenance flags and one report block. These assert
 * the additions are INERT everywhere else: an unauthorized run reports them `false` / `null`
 * rather than omitting them, and a real-manifest trust it does not recognize is still refused.
 */
describe('BR Receita full join dry-run — 11G join-probe fields stay inert elsewhere', () => {
  it('reports the join-probe flags as false and the block as null on a synthetic run', () => {
    const report = runBrazilReceitaFullJoinDryRun(SAFE_INPUT);
    assert.equal(report.ok, true);
    assert.equal(report.required_family_join_probe_authorized, false);
    assert.equal(report.real_local_join_dry_run_authorized, false);
    assert.equal(report.required_family_join_probe, null);
    assert.equal(report.guardrail_counts.required_family_join_probe_files_opened, 0);
    assert.equal(report.guardrail_counts.required_family_join_probe_forbidden_family_findings, 0);
  });

  it('refuses the join-probe trust without any of its authorizations, opening nothing', () => {
    const report = runBrazilReceitaFullJoinDryRun({
      ...SAFE_INPUT,
      mode: 'local_manifest_dry_run',
      manifestTrust: 'real_manifest_required_family_join_probe',
      allowLocalManifest: true,
      strict: true,
      outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
    } as unknown as BrazilReceitaFullJoinDryRunInput);

    assert.equal(report.ok, false);
    assert.equal(report.required_family_join_probe, null);
    // The manifest gate refuses first: a join probe whose control document cannot be read never
    // reaches the join gate, let alone a data file.
    assert.equal(report.errors[0]!.error_code, 'real_manifest_metadata_only_not_authorized');
  });

  it('keeps the join-probe flags out of the metadata-only and Option B provenance', () => {
    for (const trust of [
      BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
      BRAZIL_RECEITA_FULL_JOIN_REAL_MANIFEST_METADATA_ONLY_TRUST,
    ]) {
      const report = runBrazilReceitaFullJoinDryRun({
        ...SAFE_INPUT,
        mode: 'local_manifest_dry_run',
        manifestTrust: trust,
        allowLocalManifest: true,
        strict: true,
        outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
      } as unknown as BrazilReceitaFullJoinDryRunInput);
      assert.equal(report.ok, false);
      assert.equal(report.required_family_join_probe_authorized, false);
      assert.equal(report.real_local_join_dry_run_authorized, false);
      assert.equal(report.required_family_join_probe, null);
    }
  });
});
