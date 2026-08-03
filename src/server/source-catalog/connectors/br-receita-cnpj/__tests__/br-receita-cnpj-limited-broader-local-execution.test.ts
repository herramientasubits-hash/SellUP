/**
 * BR Receita CNPJ — LIMITED BROADER LOCAL EXECUTION control layer — tests (BR-SOURCE-11P-IMPL).
 *
 * Proves the one property the milestone claims: real limited broader local execution is
 * IMPOSSIBLE, and impossible by construction rather than by configuration.
 *
 * The load-bearing test is the FIRST one: a maximally-compliant request — every authorization
 * declared, every cap stated, strict and aggregate-only on, only allowlisted families, temp storage
 * off, no escalation, no forbidden output — is STILL refused. Everything after it shows that each
 * individual omission or breach adds its own refusal on top.
 *
 * 100% synthetic and offline. No dataset, no manifest, no CSV, no ZIP, no row, no path, no
 * Supabase, no network, no runtime, no provider, no file I/O beyond reading this repository's OWN
 * source files for the static guards at the end. Identifier-shaped values are assembled by
 * CONCATENATION so no identifier-shaped literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';

import {
  BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_ALLOWED_FAMILIES,
  BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED_CAP_MAXIMA,
  BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_NAMES,
  BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_FORBIDDEN_FAMILY_TOKENS,
  BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_RECORDED_AUTHORIZATION_PHRASE,
  BRAZIL_RECEITA_RECORDED_GATE2_STATUS,
  buildLimitedBroaderLocalExecutionReport,
  classifyLimitedBroaderLocalExecutionFamily,
  evaluateLimitedBroaderLocalExecutionRequest,
} from '../br-receita-cnpj-limited-broader-local-execution';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  ForbiddenFullJoinRunnerModeError,
  UnknownFullJoinRunnerFlagError,
  parseFullJoinRunnerArgs,
  runLimitedBroaderLocalExecution,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run';

const require_ = createRequire(__filename);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** The 11P owner phrase. It authorizes IMPLEMENTATION — never execution — so it must not match. */
const IMPLEMENTATION_PHRASE =
  'AUTHORIZE BR-SOURCE-11P — LIMITED BROADER LOCAL EXECUTION IMPLEMENTATION';

/** A CNPJ-shaped synthetic value, assembled so no identifier-shaped literal lives in source. */
const SYNTHETIC_IDENTIFIER = '1234' + '5678' + '9012' + '34';

type MutableRequest = {
  authorizationPhrase: string | null;
  limitedBroaderLocalExecutionAuthorized: boolean;
  gate2Approved: boolean;
  strict: boolean;
  aggregateOnly: boolean;
  requestedFamilies: string[];
  caps: Record<string, number | null>;
  directoryPolicy: Record<string, boolean>;
  tempStorage: Record<string, boolean>;
  outputRequests: Record<string, boolean>;
  escalations: Record<string, boolean>;
};

/**
 * The MAXIMALLY-COMPLIANT request: everything a caller could possibly declare correctly, declared
 * correctly. It is the strongest input the control layer can be handed, and it must still fail.
 */
function compliantRequest(): MutableRequest {
  return {
    authorizationPhrase: IMPLEMENTATION_PHRASE,
    limitedBroaderLocalExecutionAuthorized: true,
    gate2Approved: false,
    strict: true,
    aggregateOnly: true,
    requestedFamilies: [...BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_ALLOWED_FAMILIES],
    caps: {
      maxFiles: 2,
      maxFilesPerFamily: 1,
      maxBytesPerFile: 1024,
      maxRowsPerFile: 10,
      maxTotalBytes: 2048,
      maxTotalRows: 20,
      maxRuntimeSeconds: 10,
    },
    directoryPolicy: {
      allowedInputRootAuthorized: true,
      pathTraversalRequested: false,
      symlinkRequested: false,
      unsafeBasenameRequested: false,
      outputInsideRepoRequested: false,
    },
    tempStorage: { enabled: false, authorized: false },
    outputRequests: {
      rawRows: false,
      rawCells: false,
      identifiers: false,
      joinKeys: false,
      joinKeyHashes: false,
      exactCoveragePercentage: false,
      fullDatasetDenominator: false,
      coverageProof: false,
      coverageGuarantee: false,
      productionInference: false,
      absolutePaths: false,
      realFilenames: false,
    },
    escalations: {
      importExecuted: false,
      supabaseWrite: false,
      runtimeIntegration: false,
      agent1Integration: false,
      providerCalls: false,
      productionWrites: false,
    },
  };
}

// ─── 1. The structural refusal ────────────────────────────────────────────────

describe('BR-SOURCE-11P control layer — real execution is impossible', () => {
  it('refuses the MAXIMALLY-COMPLIANT request', () => {
    const result = evaluateLimitedBroaderLocalExecutionRequest(compliantRequest());
    assert.equal(result.ok, false);
    assert.equal(result.decisionStatus, 'not_authorized');
    assert.equal(result.gate2Status, 'not_approved');
    assert.equal(result.limitedBroaderLocalExecutionAuthorized, false);
    assert.equal(result.fileAccessAllowed, false);
    // The two independent structural blocks, plus the phrase that cannot match.
    assert.ok(result.errors.includes('gate2_not_approved'));
    assert.ok(result.errors.includes('limited_broader_local_execution_not_authorized'));
    assert.ok(result.errors.includes('cap_ceiling_not_authorized'));
    assert.ok(result.errors.includes('authorization_phrase_mismatch'));
  });

  it('records GATE-2 as not approved and no execution authorization phrase', () => {
    assert.equal(BRAZIL_RECEITA_RECORDED_GATE2_STATUS, 'not_approved');
    assert.equal(BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_RECORDED_AUTHORIZATION_PHRASE, null);
  });

  it('authorizes no cap maximum — an unset cap is not an unlimited cap', () => {
    for (const name of BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_NAMES) {
      assert.equal(
        BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED_CAP_MAXIMA[name],
        null,
        `cap ${name} must remain not_authorized`,
      );
    }
  });

  it('refuses a malformed request outright', () => {
    for (const value of [undefined, null, 'run', 42, [], true]) {
      const result = evaluateLimitedBroaderLocalExecutionRequest(value);
      assert.equal(result.ok, false);
      assert.deepEqual(result.errors, ['request_not_an_object']);
    }
  });
});

// ─── 2. Authorization and gate state ──────────────────────────────────────────

describe('BR-SOURCE-11P control layer — authorization', () => {
  it('fails closed with no authorization phrase at all', () => {
    for (const phrase of [null, '', '   ', undefined]) {
      const result = evaluateLimitedBroaderLocalExecutionRequest({
        ...compliantRequest(),
        authorizationPhrase: phrase,
      });
      assert.ok(result.errors.includes('authorization_phrase_missing'));
      assert.ok(result.errors.includes('limited_broader_local_execution_not_authorized'));
    }
  });

  it('fails closed even when the authorization flag is declared true', () => {
    const result = evaluateLimitedBroaderLocalExecutionRequest({
      ...compliantRequest(),
      limitedBroaderLocalExecutionAuthorized: true,
    });
    assert.equal(result.limitedBroaderLocalExecutionAuthorized, false);
    assert.ok(result.errors.includes('limited_broader_local_execution_not_authorized'));
  });

  it('treats a gate2-approved assertion as a violation, not an approval', () => {
    const result = evaluateLimitedBroaderLocalExecutionRequest({
      ...compliantRequest(),
      gate2Approved: true,
    });
    assert.equal(result.gate2Status, 'not_approved');
    assert.ok(result.errors.includes('gate2_approval_self_declared'));
    assert.ok(result.errors.includes('gate2_not_approved'));
  });

  it('fails closed on missing strict mode and missing aggregate-only', () => {
    const noStrict = evaluateLimitedBroaderLocalExecutionRequest({
      ...compliantRequest(),
      strict: false,
    });
    assert.ok(noStrict.errors.includes('strict_mode_not_declared'));

    const noAggregate = evaluateLimitedBroaderLocalExecutionRequest({
      ...compliantRequest(),
      aggregateOnly: false,
    });
    assert.ok(noAggregate.errors.includes('aggregate_only_not_declared'));
  });
});

// ─── 3. Caps ──────────────────────────────────────────────────────────────────

describe('BR-SOURCE-11P control layer — caps', () => {
  it('fails closed when ANY required cap is not stated', () => {
    const expected: Record<string, string> = {
      maxFiles: 'max_files_not_declared',
      maxFilesPerFamily: 'max_files_per_family_not_declared',
      maxBytesPerFile: 'max_bytes_per_file_not_declared',
      maxRowsPerFile: 'max_rows_per_file_not_declared',
      maxTotalBytes: 'max_total_bytes_not_declared',
      maxTotalRows: 'max_total_rows_not_declared',
      maxRuntimeSeconds: 'max_runtime_seconds_not_declared',
    };
    for (const name of BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_NAMES) {
      const request = compliantRequest();
      request.caps[name] = null;
      const result = evaluateLimitedBroaderLocalExecutionRequest(request);
      assert.ok(
        result.errors.includes(expected[name] as never),
        `omitting ${name} must raise ${expected[name]}`,
      );
    }
  });

  it('fails closed on a cap that is not a safe non-negative integer', () => {
    for (const value of ['10', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const request = compliantRequest();
      request.caps.maxFiles = value as number;
      const result = evaluateLimitedBroaderLocalExecutionRequest(request);
      assert.ok(result.errors.includes('max_files_not_declared'));
    }
  });

  it('fails closed on a fully-capped request because no ceiling is authorized', () => {
    const result = evaluateLimitedBroaderLocalExecutionRequest(compliantRequest());
    assert.ok(result.errors.includes('cap_ceiling_not_authorized'));
    // No cap can be "above the maximum" while no maximum exists — the refusal is the absence.
    assert.ok(!result.errors.includes('cap_above_authorized_maximum'));
  });
});

// ─── 4. Families ──────────────────────────────────────────────────────────────

describe('BR-SOURCE-11P control layer — family allowlist', () => {
  it('fails closed when no family is declared — an empty request is not "all"', () => {
    const result = evaluateLimitedBroaderLocalExecutionRequest({
      ...compliantRequest(),
      requestedFamilies: [],
    });
    assert.ok(result.errors.includes('family_not_declared'));
  });

  it('fails closed on a forbidden person family', () => {
    for (const token of BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_FORBIDDEN_FAMILY_TOKENS) {
      const result = evaluateLimitedBroaderLocalExecutionRequest({
        ...compliantRequest(),
        requestedFamilies: [token],
      });
      assert.ok(
        result.errors.includes('forbidden_family_requested'),
        `family "${token}" must be refused`,
      );
    }
  });

  it('fails closed on an UNEXPECTED family — absence from the allowlist is a block', () => {
    for (const family of ['simples', 'cnaes', 'municipios', 'naturezas', 'brand_new_family']) {
      const result = evaluateLimitedBroaderLocalExecutionRequest({
        ...compliantRequest(),
        requestedFamilies: [family],
      });
      assert.ok(
        result.errors.includes('unexpected_family_requested'),
        `family "${family}" must be refused as unexpected`,
      );
    }
  });

  it('classifies a person family as forbidden even when it also looks allowlisted', () => {
    const allowed = BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_ALLOWED_FAMILIES[0]!;
    assert.equal(classifyLimitedBroaderLocalExecutionFamily(allowed), 'allowed');
    assert.equal(classifyLimitedBroaderLocalExecutionFamily(`${allowed}_socios`), 'forbidden');
  });

  it('ignores non-string entries rather than coercing them', () => {
    const result = evaluateLimitedBroaderLocalExecutionRequest({
      ...compliantRequest(),
      requestedFamilies: [42, null, {}],
    });
    assert.ok(result.errors.includes('family_not_declared'));
  });
});

// ─── 5. Directory, temp storage, forbidden output ─────────────────────────────

describe('BR-SOURCE-11P control layer — directory and temp storage', () => {
  it('fails closed when the input root is not authorized', () => {
    const request = compliantRequest();
    request.directoryPolicy.allowedInputRootAuthorized = false;
    const result = evaluateLimitedBroaderLocalExecutionRequest(request);
    assert.ok(result.errors.includes('allowed_input_root_not_authorized'));
  });

  it('fails closed on traversal, symlink, unsafe basename and output-in-repo', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['pathTraversalRequested', 'path_traversal_requested'],
      ['symlinkRequested', 'symlink_requested'],
      ['unsafeBasenameRequested', 'unsafe_basename_requested'],
      ['outputInsideRepoRequested', 'output_inside_repo_requested'],
    ];
    for (const [field, code] of cases) {
      const request = compliantRequest();
      request.directoryPolicy[field] = true;
      const result = evaluateLimitedBroaderLocalExecutionRequest(request);
      assert.ok(result.errors.includes(code as never), `${field} must raise ${code}`);
    }
  });

  it('fails closed when temp storage is enabled OR self-authorized', () => {
    for (const field of ['enabled', 'authorized']) {
      const request = compliantRequest();
      request.tempStorage[field] = true;
      const result = evaluateLimitedBroaderLocalExecutionRequest(request);
      assert.ok(result.errors.includes('temp_storage_not_authorized'));
    }
  });
});

describe('BR-SOURCE-11P control layer — forbidden output requests', () => {
  it('fails closed on every § 13 forbidden output request', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['rawRows', 'raw_row_output_requested'],
      ['rawCells', 'raw_cell_output_requested'],
      ['identifiers', 'identifier_output_requested'],
      ['joinKeys', 'join_key_output_requested'],
      ['joinKeyHashes', 'join_key_hash_output_requested'],
      ['exactCoveragePercentage', 'exact_coverage_percentage_requested'],
      ['fullDatasetDenominator', 'full_dataset_denominator_requested'],
      ['coverageProof', 'coverage_proof_requested'],
      ['coverageGuarantee', 'coverage_guarantee_requested'],
      ['productionInference', 'production_inference_requested'],
      ['absolutePaths', 'absolute_path_output_requested'],
      ['realFilenames', 'real_filename_output_requested'],
    ];
    for (const [field, code] of cases) {
      const request = compliantRequest();
      request.outputRequests[field] = true;
      const result = evaluateLimitedBroaderLocalExecutionRequest(request);
      assert.ok(result.errors.includes(code as never), `${field} must raise ${code}`);
    }
  });
});

// ─── 6. Escalations ───────────────────────────────────────────────────────────

describe('BR-SOURCE-11P control layer — escalation invariants', () => {
  it('fails closed on import, Supabase, runtime, Agent 1, provider and production writes', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['importExecuted', 'import_execution_requested'],
      ['supabaseWrite', 'supabase_write_requested'],
      ['runtimeIntegration', 'runtime_integration_requested'],
      ['agent1Integration', 'agent1_integration_requested'],
      ['providerCalls', 'provider_calls_requested'],
      ['productionWrites', 'production_writes_requested'],
    ];
    for (const [field, code] of cases) {
      const request = compliantRequest();
      request.escalations[field] = true;
      const result = evaluateLimitedBroaderLocalExecutionRequest(request);
      assert.ok(result.errors.includes(code as never), `${field} must raise ${code}`);
    }
  });
});

// ─── 7. Nothing leaks ─────────────────────────────────────────────────────────

describe('BR-SOURCE-11P control layer — no value ever leaves', () => {
  it('emits only fixed machine codes, never a caller value', () => {
    const request = compliantRequest();
    request.requestedFamilies = [`socios_${SYNTHETIC_IDENTIFIER}`];
    request.authorizationPhrase = `PHRASE_${SYNTHETIC_IDENTIFIER}`;
    const result = evaluateLimitedBroaderLocalExecutionRequest(request);

    for (const code of result.errors) {
      assert.match(code, /^[a-z0-9_]+$/);
    }
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SYNTHETIC_IDENTIFIER));
    assert.ok(!serialized.includes('PHRASE_'));
  });

  it('never echoes a family label, an identifier, a path, a filename or a hash in the report', () => {
    const request = compliantRequest();
    request.requestedFamilies = [`empresas_${SYNTHETIC_IDENTIFIER}`, 'socios'];
    const report = buildLimitedBroaderLocalExecutionReport(request);
    const serialized = JSON.stringify(report);

    assert.ok(!serialized.includes(SYNTHETIC_IDENTIFIER));
    // A class TALLY, never the raw caller list.
    assert.deepEqual(report.families_requested, { allowed: 0, forbidden: 1, unexpected: 1 });
    for (const forbidden of ['/Users', 'Downloads', 'manifest.headerless', '.csv', '.zip']) {
      assert.ok(!serialized.includes(forbidden), `report must not carry "${forbidden}"`);
    }
  });

  it('produces a report that the output sanitizer accepts', () => {
    const result = sanitizeBrazilReceitaFullJoinReport(
      buildLimitedBroaderLocalExecutionReport(compliantRequest()),
    );
    assert.equal(result.ok, true, `unexpected findings: ${JSON.stringify(result.findings)}`);
  });
});

// ─── 8. Evidence packet shape ─────────────────────────────────────────────────

describe('BR-SOURCE-11P evidence packet', () => {
  it('reports every readiness and escalation flag as false, whatever was requested', () => {
    const request = compliantRequest();
    // A caller declaring every escalation still gets structural falses in the report…
    for (const field of Object.keys(request.escalations)) request.escalations[field] = true;
    const report = buildLimitedBroaderLocalExecutionReport(request);

    assert.equal(report.ok, false);
    assert.equal(report.decision_status, 'not_authorized');
    assert.equal(report.gate2_status, 'not_approved');
    assert.equal(report.file_access_allowed, false);
    assert.equal(report.import_executed, false);
    assert.equal(report.supabase_write, false);
    assert.equal(report.runtime_integration, false);
    assert.equal(report.agent1_integration, false);
    assert.equal(report.provider_calls, false);
    assert.equal(report.production_writes, false);
    assert.equal(report.temp_storage_used, false);
    for (const value of Object.values(report.brazil_readiness)) assert.equal(value, false);
    for (const value of Object.values(report.gate_status)) assert.equal(value, 'not_approved');

    // …and the refusals appear in the findings instead.
    assert.ok(report.fail_closed_findings.includes('import_execution_requested'));
    assert.ok(report.fail_closed_findings.includes('supabase_write_requested'));
  });

  it('reports magnitudes as buckets, never as figures, and computes no coverage', () => {
    const report = buildLimitedBroaderLocalExecutionReport(compliantRequest());
    for (const bucket of [
      report.families_opened_bucket,
      report.files_opened_bucket,
      report.bytes_read_bucket,
      report.rows_read_bucket,
      report.runtime_bucket,
      report.join_executed_bucket,
    ]) {
      assert.equal(bucket, 'none');
    }
    assert.equal(report.coverage_claimed, false);
    assert.equal(report.exact_coverage_percentage_printed, false);
    assert.equal(report.full_dataset_denominator_printed, false);
    assert.equal(report.production_inference_allowed, false);
    assert.equal(report.denominator_scope, 'not_computed');
    assert.equal(report.aggregate_output_status, 'aggregate_only');
  });
});

// ─── 9. Sanitizer extension ───────────────────────────────────────────────────

describe('BR-SOURCE-11P sanitizer extension — approval language', () => {
  it('blocks a claimed approval, gate approval, or readiness', () => {
    const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ limited_broader_local_execution_authorized: true }, 'limited_broader_execution_approval_payload'],
      [{ broaderLocalExecutionApproved: 'yes' }, 'limited_broader_execution_approval_payload'],
      [{ full_join_execution_ready: true }, 'limited_broader_execution_approval_payload'],
      [{ gate2_approved: true }, 'gate2_approval_payload'],
      [{ gate2Approval: 'granted' }, 'gate2_approval_payload'],
      [{ import_ready: true }, 'import_readiness_payload'],
      [{ ready_for_import: true }, 'import_readiness_payload'],
      [{ runtime_ready: true }, 'runtime_readiness_payload'],
      [{ agent1_ready: true }, 'agent1_readiness_payload'],
    ];
    for (const [report, kind] of cases) {
      const result = sanitizeBrazilReceitaFullJoinReport(report);
      assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(report)}`);
      assert.ok(
        result.findings.some((finding) => finding.kind === kind),
        `expected ${kind} for ${JSON.stringify(report)}`,
      );
    }
  });

  it('still accepts the held-absence spellings and the runner’s own carve-out declarations', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      limited_broader_local_execution_authorized: false,
      gate2_approved: false,
      import_ready: false,
      runtime_ready: false,
      agent1_ready: false,
      // These are legitimately `true` on an authorized 11E–11H run and must keep passing.
      required_family_probe_authorized: true,
      required_family_join_probe_authorized: true,
      real_manifest_metadata_only_execution_authorized: true,
      aggregate_join_coverage_signal_authorized: true,
      real_local_join_dry_run_authorized: true,
      gate_2_temporary_storage: 'not_approved',
    });
    assert.equal(result.ok, true, `unexpected findings: ${JSON.stringify(result.findings)}`);
  });
});

// ─── 10. CLI adapter ──────────────────────────────────────────────────────────

/** The compliant CLI invocation: every flag the mode requires, nothing that names a file. */
const CLI_ARGS: readonly string[] = [
  '--limited-broader-local-execution',
  '--limited-broader-local-execution-authorized',
  '--strict',
  '--gate2-approved=false',
  '--max-files=2',
  '--max-files-per-family=1',
  '--max-bytes-per-file=1024',
  '--max-rows-per-file=10',
  '--max-total-bytes=2048',
  '--max-total-rows=20',
  '--max-runtime-seconds=10',
  '--temp-storage-disabled',
  '--aggregate-only',
  '--no-import',
  '--no-supabase-write',
  '--no-runtime',
  '--no-agent1',
  '--no-provider-calls',
];

describe('BR-SOURCE-11P CLI — fails closed before any file access', () => {
  it('parses the compliant invocation and refuses it without opening anything', () => {
    const options = parseFullJoinRunnerArgs([...CLI_ARGS]);
    assert.equal(options.limitedBroaderLocalExecution, true);
    assert.equal(options.manifestPath, null);
    assert.equal(options.outputPath, null);
    assert.equal(options.gate2Approved, false);

    const report = runLimitedBroaderLocalExecution(options);
    assert.equal(report.ok, false);
    assert.equal(report.gate2_status, 'not_approved');
    assert.equal(report.decision_status, 'not_authorized');
    assert.equal(report.file_access_allowed, false);
    assert.ok(report.fail_closed_findings.includes('gate2_not_approved'));
    assert.ok(report.fail_closed_findings.includes('cap_ceiling_not_authorized'));
    // No family and no input root can be named from the argument surface, so both are refused.
    assert.ok(report.fail_closed_findings.includes('family_not_declared'));
    assert.ok(report.fail_closed_findings.includes('allowed_input_root_not_authorized'));
  });

  it('never accepts a manifest or an output path in this mode', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs([...CLI_ARGS, '--manifest', 'x.json', '--allow-local-manifest']),
      ForbiddenFullJoinRunnerModeError,
    );
    // An opaque synthetic label, never an absolute path: the mode refuses `--output` before any
    // path is resolved, so the test needs no real location to prove it.
    assert.throws(
      () => parseFullJoinRunnerArgs([...CLI_ARGS, '--output', 'synthetic-report.json']),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('requires --strict and every explicit safety INVARIANT at parse time', () => {
    // The seven invariant declarations 11O § 8 calls asserted invariants. Omitting any of them is
    // an argument-surface error, refused before the control layer is even consulted.
    const requiredInvariants = [
      '--strict',
      '--aggregate-only',
      '--temp-storage-disabled',
      '--no-import',
      '--no-supabase-write',
      '--no-runtime',
      '--no-agent1',
      '--no-provider-calls',
    ];
    for (const arg of requiredInvariants) {
      assert.throws(
        () => parseFullJoinRunnerArgs(CLI_ARGS.filter((candidate) => candidate !== arg)),
        ForbiddenFullJoinRunnerModeError,
        `omitting ${arg} must be refused at parse time`,
      );
    }
  });

  it('leaves the two STATE ASSERTIONS to the control layer, not to parsing', () => {
    // `--limited-broader-local-execution-authorized` and `--gate2-approved` assert a recorded
    // state; omitting either is simply "not asserted", which the control layer refuses on its own
    // terms. Refusing them at parse time would turn a state question into a syntax question.
    for (const arg of ['--limited-broader-local-execution-authorized', '--gate2-approved=false']) {
      const options = parseFullJoinRunnerArgs(
        CLI_ARGS.filter((candidate) => candidate !== arg),
      );
      const report = runLimitedBroaderLocalExecution(options);
      assert.equal(report.ok, false);
      assert.ok(report.fail_closed_findings.includes('gate2_not_approved'));
      assert.ok(
        report.fail_closed_findings.includes('limited_broader_local_execution_not_authorized'),
      );
    }
  });

  it('refuses a cap that is stated but has no owner ceiling, and one that is omitted', () => {
    // Cap flags are refused by the CONTROL LAYER rather than by parsing: a stated cap has no
    // authorized ceiling, and an omitted one is not declared. Both are stops.
    const stated = runLimitedBroaderLocalExecution(parseFullJoinRunnerArgs([...CLI_ARGS]));
    assert.ok(stated.fail_closed_findings.includes('cap_ceiling_not_authorized'));

    const withoutMaxFiles = runLimitedBroaderLocalExecution(
      parseFullJoinRunnerArgs(CLI_ARGS.filter((arg) => arg !== '--max-files=2')),
    );
    assert.ok(withoutMaxFiles.fail_closed_findings.includes('max_files_not_declared'));
  });

  it('treats a --no-* invariant set to false as REQUESTING the escalation', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['--no-import', 'import_execution_requested'],
      ['--no-supabase-write', 'supabase_write_requested'],
      ['--no-runtime', 'runtime_integration_requested'],
      ['--no-agent1', 'agent1_integration_requested'],
      ['--no-provider-calls', 'provider_calls_requested'],
      ['--temp-storage-disabled', 'temp_storage_not_authorized'],
    ];
    for (const [flag, code] of cases) {
      const args = CLI_ARGS.map((arg) => (arg === flag ? `${flag}=false` : arg));
      const report = runLimitedBroaderLocalExecution(parseFullJoinRunnerArgs([...args]));
      assert.ok(
        report.fail_closed_findings.includes(code as never),
        `${flag}=false must raise ${code}`,
      );
    }
  });

  it('refuses the positive escalation spellings during parsing', () => {
    for (const flag of ['--import', '--runtime', '--agent1', '--supabase', '--write', '--full']) {
      assert.throws(
        () => parseFullJoinRunnerArgs([...CLI_ARGS, flag]),
        ForbiddenFullJoinRunnerModeError,
        `${flag} must be refused`,
      );
    }
  });

  it('refuses a non-boolean value on an inline boolean flag rather than coercing it', () => {
    for (const value of ['yes', '1', 'TRUE ok', '']) {
      const args = CLI_ARGS.map((arg) =>
        arg === '--gate2-approved=false' ? `--gate2-approved=${value}` : arg,
      );
      assert.throws(() => parseFullJoinRunnerArgs([...args]), ForbiddenFullJoinRunnerModeError);
    }
  });

  it('refuses every 11P rider without the mode flag', () => {
    const riders = [
      '--limited-broader-local-execution-authorized',
      '--gate2-approved=false',
      '--aggregate-only',
      '--temp-storage-disabled',
      '--no-import',
      '--no-supabase-write',
      '--no-runtime',
      '--no-agent1',
      '--no-provider-calls',
    ];
    for (const rider of riders) {
      assert.throws(
        () => parseFullJoinRunnerArgs(['--synthetic-fixture', '--strict', rider]),
        ForbiddenFullJoinRunnerModeError,
        `${rider} must require the mode flag`,
      );
    }
  });

  it('is mutually exclusive with every other mode', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs([...CLI_ARGS, '--synthetic-fixture']),
      ForbiddenFullJoinRunnerModeError,
    );
  });
});

// ─── 11. Existing modes are untouched ─────────────────────────────────────────

describe('BR-SOURCE-11A–11H modes still parse unchanged', () => {
  it('keeps the synthetic-fixture mode working', () => {
    const options = parseFullJoinRunnerArgs(['--synthetic-fixture', '--strict', '--format', 'json']);
    assert.equal(options.runMode, 'synthetic_fixture_only');
    assert.equal(options.limitedBroaderLocalExecution, false);
    assert.equal(options.strict, true);
  });

  it('keeps the Option B synthetic-temp-manifest mode working', () => {
    const options = parseFullJoinRunnerArgs([
      '--synthetic-temp-manifest',
      '--strict',
      '--max-company-rows',
      '20',
      '--max-establishment-rows',
      '20',
      '--max-company-scan-rows',
      '1000',
      '--max-bytes-per-file',
      '1000000',
    ]);
    assert.equal(options.syntheticTempManifest, true);
    assert.equal(options.limitedBroaderLocalExecution, false);
  });

  it('keeps a bare invocation and an unknown flag fail-closed', () => {
    assert.throws(() => parseFullJoinRunnerArgs([]), ForbiddenFullJoinRunnerModeError);
    assert.throws(
      () => parseFullJoinRunnerArgs(['--synthetic-fixture', '--not-a-flag']),
      UnknownFullJoinRunnerFlagError,
    );
  });

  it('keeps the 11F/11G/11H riders bound to their own modes', () => {
    assert.throws(
      () => parseFullJoinRunnerArgs(['--synthetic-fixture', '--required-family-probe-authorized']),
      ForbiddenFullJoinRunnerModeError,
    );
    assert.throws(
      () => parseFullJoinRunnerArgs(['--synthetic-fixture', '--real-local-join-dry-run-authorized']),
      ForbiddenFullJoinRunnerModeError,
    );
  });
});

// ─── 12. Static guards ────────────────────────────────────────────────────────

/** The control module's CODE, with comments stripped: these guards are about what it DOES. */
function controlLayerSource(): string {
  const raw = fs.readFileSync(
    require_.resolve('../br-receita-cnpj-limited-broader-local-execution'),
    'utf8',
  );
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('BR-SOURCE-11P control layer — static guards', () => {
  it('imports no filesystem, network, process or child-process module', () => {
    const source = controlLayerSource();
    for (const forbidden of [
      "from 'node:fs'",
      "from 'node:path'",
      "from 'node:http'",
      "from 'node:https'",
      "from 'node:child_process'",
      "from 'node:os'",
      'require(',
      'process.env',
      'process.exit',
    ]) {
      assert.ok(!source.includes(forbidden), `control layer must not reference "${forbidden}"`);
    }
  });

  it('performs no file, directory or descriptor operation at all', () => {
    const source = controlLayerSource();
    for (const forbidden of [
      'openSync',
      'readSync',
      'readFileSync',
      'writeFileSync',
      'mkdtempSync',
      'mkdirSync',
      'statSync',
      'existsSync',
      'readdirSync',
      'rmSync',
      'unlinkSync',
      'createReadStream',
    ]) {
      assert.ok(!source.includes(forbidden), `control layer must not call "${forbidden}"`);
    }
  });

  it('imports no Supabase, Agent 1, provider, HubSpot or Slack module', () => {
    const source = controlLayerSource().toLowerCase();
    for (const forbidden of ['supabase', 'agent1', 'apollo', 'lusha', 'tavily', 'hubspot', 'slack']) {
      assert.ok(!source.includes(`'${forbidden}`), `control layer must not import "${forbidden}"`);
    }
  });

  it('never logs, and never hashes', () => {
    const source = controlLayerSource();
    for (const forbidden of [
      'console.log',
      'console.warn',
      'console.error',
      'createHash',
      'crypto',
      'digest',
    ]) {
      assert.ok(!source.includes(forbidden), `control layer must not use "${forbidden}"`);
    }
  });

  it('embeds no absolute path, dataset directory or real manifest basename', () => {
    const raw = fs.readFileSync(
      require_.resolve('../br-receita-cnpj-limited-broader-local-execution'),
      'utf8',
    );
    for (const forbidden of [
      '/Users/',
      '/home/',
      'Downloads',
      'sellup-source-data',
      'raw-zips',
      'manifest-input',
      'manifest.headerless',
      '.csv',
      '.zip',
    ]) {
      assert.ok(!raw.includes(forbidden), `control layer must not embed "${forbidden}"`);
    }
  });

  it('contains no digit run long enough to be an identifier', () => {
    const source = controlLayerSource();
    // Numeric separators are stripped first: `1_000_000` is a cap parse ceiling, not an identifier.
    const withoutSeparators = source.replace(/(\d)_(?=\d)/g, '$1');
    const longRuns = withoutSeparators.match(/(?<!\d)\d{8,}(?!\d)/g) ?? [];
    assert.deepEqual(longRuns, []);
  });
});
