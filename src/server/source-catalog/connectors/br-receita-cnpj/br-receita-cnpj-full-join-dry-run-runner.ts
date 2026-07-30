/**
 * BR Receita CNPJ — FULL JOIN dry-run runner scaffold (BR-SOURCE-11A).
 *
 * The first technical runner for the Receita CNPJ full join, implemented as a LOCAL
 * NO-WRITE / NO-RUNTIME scaffold. It composes the three BR-SOURCE-11A safety modules
 * — the no-write guard, the output sanitizer, and the failure-cleanup model — into a
 * single entry point that produces an AGGREGATE, sanitized report.
 *
 * ── Why this runner cannot execute the real dataset ─────────────────────────────
 * None of the eight approval gates is approved (legal/privacy, temporary storage
 * envelope, field allowlist, identity grain, output sanitization, failure cleanup,
 * operator runbook, no-write/no-runtime). So:
 *
 *   - `synthetic_fixture_only` (the DEFAULT) is the only mode that produces metrics.
 *     It scores an injected or built-in SYNTHETIC fixture with no file I/O at all.
 *
 *   - `local_manifest_dry_run` is DECLARED and fully gated, but fails closed with
 *     `local_manifest_execution_not_authorized` — first because it requires
 *     `allowLocalManifest: true`, and then because reading a real local manifest is
 *     exactly what GATE-1 (legal/privacy) and GATE-2 (temporary storage envelope)
 *     would have to authorize. The runner therefore performs ZERO filesystem reads
 *     in this hito: the mode's shape exists so the contract is testable, not so the
 *     dataset can be touched.
 *
 * ── The runner NEVER ────────────────────────────────────────────────────────────
 *   - downloads, unzips, imports, or processes the full dataset.
 *   - opens a manifest, a CSV, a ZIP, or any file.
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - integrates runtime, Agent 1, providers, HubSpot, or Slack.
 *   - constructs a `record_identity_key` or a `normalized_tax_id`.
 *   - returns a row, a cell value, a full CNPJ, a CNPJ básico, a CPF, a legal name, a
 *     trade name, an email, a phone, an address, a join key, or a hash of any of them.
 *   - approves a gate, or declares Brazil ready for import, runtime, or Agent 1.
 *
 * Synthetic fixture rows carry OPAQUE structural refs (never dataset-shaped) that are
 * used for in-memory association only and are never counted into, or emitted by, the
 * report.
 */

import {
  BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
} from './br-receita-cnpj-manifest';
import {
  BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS,
  BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT,
} from './br-receita-cnpj-company-establishment-join-dry-run';
import {
  BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT,
} from './br-receita-cnpj-privacy-safe-classifier';
import {
  BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_GUARD_ERROR_CODE,
  assertBrazilReceitaFullJoinNoWrite,
} from './br-receita-cnpj-full-join-no-write-guard';
import {
  BRAZIL_RECEITA_FULL_JOIN_SANITIZER_ERROR_CODE,
  sanitizeBrazilReceitaFullJoinReport,
} from './br-receita-cnpj-full-join-output-sanitizer';
import {
  planBrazilReceitaFullJoinCleanup,
  type BrazilReceitaFullJoinCleanupReport,
} from './br-receita-cnpj-full-join-cleanup';

// ─── Public constants ─────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_DRY_RUN_MODE = 'br_receita_full_join_dry_run' as const;

export type BrazilReceitaFullJoinRunMode = 'synthetic_fixture_only' | 'local_manifest_dry_run';

export const BRAZIL_RECEITA_FULL_JOIN_RUN_MODES: readonly BrazilReceitaFullJoinRunMode[] = [
  'synthetic_fixture_only',
  'local_manifest_dry_run',
];

/** The DEFAULT mode. A caller that states nothing gets the safest behaviour. */
export const BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE: BrazilReceitaFullJoinRunMode =
  'synthetic_fixture_only';

/**
 * Absolute ceiling on synthetic fixture size. A fixture beyond this is not a fixture
 * — it is a dataset, and it fails closed. Keeps "synthetic" structurally small.
 */
export const BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS = 10_000 as const;

/** The only output-sanitization version this hito recognizes: GATE-5 is not approved. */
export const BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION = 'not_approved' as const;

// ─── Synthetic fixture contract ───────────────────────────────────────────────

export type BrazilReceitaFullJoinSyntheticEligibility =
  | 'eligible_for_future_import'
  | 'needs_legal_review'
  | 'excluded_privacy_signal'
  | 'excluded_legal_nature';

/**
 * One synthetic company row. `companyRef` is an OPAQUE structural reference used for
 * in-memory association only — it is deliberately not dataset-shaped, and it is never
 * counted into or emitted by the report.
 */
export interface BrazilReceitaFullJoinSyntheticCompanyRow {
  readonly companyRef: string;
  readonly eligibility: BrazilReceitaFullJoinSyntheticEligibility;
}

/** One synthetic establishment row. `companyRef: null` models a missing join ref. */
export interface BrazilReceitaFullJoinSyntheticEstablishmentRow {
  readonly companyRef: string | null;
  readonly privacySignal: boolean;
}

export interface BrazilReceitaFullJoinSyntheticFixture {
  readonly companies: readonly BrazilReceitaFullJoinSyntheticCompanyRow[];
  readonly establishments: readonly BrazilReceitaFullJoinSyntheticEstablishmentRow[];
}

/**
 * The built-in synthetic fixture: one of every join outcome, so a default run
 * exercises every branch. Refs are opaque labels, never dataset-shaped values.
 */
export function defaultBrazilReceitaFullJoinSyntheticFixture(): BrazilReceitaFullJoinSyntheticFixture {
  return {
    companies: [
      { companyRef: 'SYNTHETIC_COMPANY_REF_ALPHA', eligibility: 'eligible_for_future_import' },
      { companyRef: 'SYNTHETIC_COMPANY_REF_BRAVO', eligibility: 'needs_legal_review' },
      { companyRef: 'SYNTHETIC_COMPANY_REF_CHARLIE', eligibility: 'excluded_privacy_signal' },
      { companyRef: 'SYNTHETIC_COMPANY_REF_DELTA', eligibility: 'excluded_legal_nature' },
    ],
    establishments: [
      { companyRef: 'SYNTHETIC_COMPANY_REF_ALPHA', privacySignal: false },
      { companyRef: 'SYNTHETIC_COMPANY_REF_BRAVO', privacySignal: false },
      { companyRef: 'SYNTHETIC_COMPANY_REF_CHARLIE', privacySignal: false },
      { companyRef: 'SYNTHETIC_COMPANY_REF_DELTA', privacySignal: false },
      { companyRef: 'SYNTHETIC_COMPANY_REF_ECHO_ABSENT', privacySignal: false },
      { companyRef: null, privacySignal: false },
      { companyRef: 'SYNTHETIC_COMPANY_REF_ALPHA', privacySignal: true },
    ],
  };
}

// ─── Input contract ───────────────────────────────────────────────────────────

/**
 * The runner's input. The escalation fields are literal-typed so no internal caller
 * can request a write, a runtime hop, an Agent 1 call, or an import without a type
 * error — and the no-write guard re-validates them at runtime anyway, because input
 * can arrive from a CLI boundary as `unknown`.
 */
export interface BrazilReceitaFullJoinDryRunInput {
  /** Accepted but NEVER opened in this hito. Present so the contract is complete. */
  readonly manifest?: unknown;
  readonly mode?: BrazilReceitaFullJoinRunMode;
  readonly allowLocalManifest?: boolean;
  readonly maxCompanyRows?: number;
  readonly maxEstablishmentRows?: number;
  readonly maxCompanyScanRows?: number;
  readonly outputSanitizationVersion?: typeof BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION;
  /** Optional injected fixture; defaults to the built-in synthetic fixture. */
  readonly syntheticFixture?: BrazilReceitaFullJoinSyntheticFixture;

  readonly noWriteMode: true;
  readonly runtimeIntegration: false;
  readonly agent1Integration: false;
  readonly supabaseWrite: false;
  readonly providerCalls?: false;
  readonly importExecuted?: false;
}

// ─── Report contract ──────────────────────────────────────────────────────────

/** Every gate stays `not_approved` in BR-SOURCE-11A — asserted, not computed. */
export interface BrazilReceitaFullJoinDecisionStatus {
  readonly gate_1_legal_privacy: 'not_approved';
  readonly gate_2_temporary_storage: 'not_approved';
  readonly gate_3_field_allowlist: 'not_approved';
  readonly gate_4_identity_grain: 'not_approved';
  readonly gate_5_output_sanitization: 'not_approved';
  readonly gate_6_failure_cleanup: 'not_approved';
  readonly gate_7_operator_runbook: 'not_approved';
  readonly gate_8_no_write_no_runtime: 'not_approved';
}

const DECISION_STATUS_ALL_NOT_APPROVED: BrazilReceitaFullJoinDecisionStatus = {
  gate_1_legal_privacy: 'not_approved',
  gate_2_temporary_storage: 'not_approved',
  gate_3_field_allowlist: 'not_approved',
  gate_4_identity_grain: 'not_approved',
  gate_5_output_sanitization: 'not_approved',
  gate_6_failure_cleanup: 'not_approved',
  gate_7_operator_runbook: 'not_approved',
  gate_8_no_write_no_runtime: 'not_approved',
};

export interface BrazilReceitaFullJoinRunScope {
  readonly full_dataset_processed: false;
  readonly import_executed: false;
  readonly supabase_write: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly provider_calls: false;
  readonly production_writes: false;
}

const RUN_SCOPE_ALL_FALSE: BrazilReceitaFullJoinRunScope = {
  full_dataset_processed: false,
  import_executed: false,
  supabase_write: false,
  runtime_integration: false,
  agent1_integration: false,
  provider_calls: false,
  production_writes: false,
};

export interface BrazilReceitaFullJoinSafety {
  readonly raw_rows_printed: false;
  readonly cnpj_basico_printed: false;
  readonly cnpj_completo_printed: false;
  readonly cpf_printed: false;
  readonly join_keys_printed: false;
  readonly identity_keys_constructed: false;
  readonly identity_keys_printed: false;
  readonly record_identity_keys_printed: false;
  readonly normalized_tax_ids_printed: false;
  readonly person_data_printed: false;
  readonly hashes_of_identifiers_printed: false;
}

const SAFETY_ALL_FALSE: BrazilReceitaFullJoinSafety = {
  raw_rows_printed: false,
  cnpj_basico_printed: false,
  cnpj_completo_printed: false,
  cpf_printed: false,
  join_keys_printed: false,
  identity_keys_constructed: false,
  identity_keys_printed: false,
  record_identity_keys_printed: false,
  normalized_tax_ids_printed: false,
  person_data_printed: false,
  hashes_of_identifiers_printed: false,
};

/** Where in the run an error was raised. Fixed stage labels, never a path. */
export type BrazilReceitaFullJoinErrorStage =
  | 'no_write_guard'
  | 'mode_resolution'
  | 'limit_validation'
  | 'fixture_validation'
  | 'synthetic_join'
  | 'output_sanitization';

/** Why the run failed. Fixed machine codes; a raw message is NEVER carried. */
export type BrazilReceitaFullJoinErrorCode =
  | typeof BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_GUARD_ERROR_CODE
  | typeof BRAZIL_RECEITA_FULL_JOIN_SANITIZER_ERROR_CODE
  | 'invalid_run_mode'
  | 'allow_local_manifest_required'
  | 'local_manifest_execution_not_authorized'
  | 'sample_row_limit_exceeded'
  | 'company_scan_row_limit_exceeded'
  | 'full_dataset_processing_not_allowed'
  | 'output_sanitization_version_not_approved'
  | 'synthetic_fixture_invalid';

export interface BrazilReceitaFullJoinReportError {
  readonly error_code: BrazilReceitaFullJoinErrorCode;
  readonly stage: BrazilReceitaFullJoinErrorStage;
}

export interface BrazilReceitaFullJoinDryRunReport {
  readonly ok: boolean;
  readonly mode: typeof BRAZIL_RECEITA_FULL_JOIN_DRY_RUN_MODE;
  readonly run_mode: BrazilReceitaFullJoinRunMode;
  readonly source_key: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  /** Always null in this hito: no manifest is opened, so no period is known. */
  readonly source_period: string | null;
  readonly decision_status: BrazilReceitaFullJoinDecisionStatus;
  readonly run_scope: BrazilReceitaFullJoinRunScope;
  readonly safety: BrazilReceitaFullJoinSafety;
  readonly aggregate_counts: Record<string, number>;
  readonly eligibility_counts: Record<string, number>;
  readonly join_counts: Record<string, number>;
  readonly guardrail_counts: Record<string, number>;
  readonly cleanup: BrazilReceitaFullJoinCleanupReport;
  readonly errors: readonly BrazilReceitaFullJoinReportError[];
}

// ─── Count scaffolding ────────────────────────────────────────────────────────

const AGGREGATE_COUNT_KEYS = [
  'company_rows_scanned',
  'company_rows_sampled',
  'company_rows_indexed',
  'company_rows_excluded',
  'establishment_rows_scanned',
  'establishment_refs_held_in_memory',
] as const;

const ELIGIBILITY_COUNT_KEYS = [
  'eligible_for_future_import',
  'needs_legal_review',
  'excluded_privacy_signal',
  'excluded_legal_nature',
] as const;

const JOIN_COUNT_KEYS = [
  'joined_with_company_context',
  'missing_company_context',
  'excluded_by_company_context',
  'excluded_by_establishment_privacy_signal',
  'pending_full_join_context',
] as const;

const GUARDRAIL_COUNT_KEYS = [
  'company_sample_cap_applied',
  'company_scan_cap_applied',
  'establishment_sample_cap_applied',
  'coverage_scan_limit_reached',
  'no_write_guard_violations',
  'forbidden_output_findings',
] as const;

function zeroCounts(keys: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = 0;
  return counts;
}

// ─── Limit validation ─────────────────────────────────────────────────────────

interface ResolvedLimits {
  readonly maxCompanyRows: number;
  readonly maxEstablishmentRows: number;
  readonly maxCompanyScanRows: number;
}

interface LimitFailure {
  readonly code: BrazilReceitaFullJoinErrorCode;
}

function resolveBoundedRows(
  requested: number | undefined,
  fallback: number,
): ResolvedLimitOutcome<number> {
  const value = requested ?? fallback;
  if (!Number.isFinite(value)) {
    return { ok: false, failure: { code: 'full_dataset_processing_not_allowed' } };
  }
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, failure: { code: 'sample_row_limit_exceeded' } };
  }
  if (value > BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT) {
    return { ok: false, failure: { code: 'sample_row_limit_exceeded' } };
  }
  return { ok: true, value };
}

function resolveCompanyScanRows(requested: number | undefined): ResolvedLimitOutcome<number> {
  const value = requested ?? BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS;
  if (!Number.isFinite(value)) {
    return { ok: false, failure: { code: 'full_dataset_processing_not_allowed' } };
  }
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, failure: { code: 'company_scan_row_limit_exceeded' } };
  }
  if (value > BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT) {
    return { ok: false, failure: { code: 'company_scan_row_limit_exceeded' } };
  }
  return { ok: true, value };
}

type ResolvedLimitOutcome<T> = { ok: true; value: T } | { ok: false; failure: LimitFailure };

function resolveLimits(
  input: BrazilReceitaFullJoinDryRunInput,
): ResolvedLimitOutcome<ResolvedLimits> {
  const company = resolveBoundedRows(
    input.maxCompanyRows,
    BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  );
  if (!company.ok) return company;
  const establishment = resolveBoundedRows(
    input.maxEstablishmentRows,
    BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  );
  if (!establishment.ok) return establishment;
  const scan = resolveCompanyScanRows(input.maxCompanyScanRows);
  if (!scan.ok) return scan;
  return {
    ok: true,
    value: {
      maxCompanyRows: company.value,
      maxEstablishmentRows: establishment.value,
      maxCompanyScanRows: scan.value,
    },
  };
}

// ─── Synthetic join scoring (pure, aggregate-only) ────────────────────────────

type CompanyContextKind = 'usable_context' | 'blocked_context';

interface SyntheticJoinOutcome {
  readonly aggregate: Record<string, number>;
  readonly eligibility: Record<string, number>;
  readonly join: Record<string, number>;
  readonly coverageScanLimitReached: boolean;
}

function contextKindOf(eligibility: BrazilReceitaFullJoinSyntheticEligibility): CompanyContextKind {
  return eligibility === 'eligible_for_future_import' || eligibility === 'needs_legal_review'
    ? 'usable_context'
    : 'blocked_context';
}

/**
 * Scores the synthetic fixture into aggregate counts. PURE and value-free: company
 * refs live only in a local Map that is discarded on return, and no ref, label, or
 * fixture value is ever written into the returned counts.
 *
 * The company index is built over the bounded SCAN window (the deeper probe, mirroring
 * the BR-SOURCE-10H coverage strategy); `company_rows_sampled` separately reports the
 * shallower bounded sample so both bounds stay visible in the report.
 */
function scoreSyntheticJoin(
  fixture: BrazilReceitaFullJoinSyntheticFixture,
  limits: ResolvedLimits,
): SyntheticJoinOutcome {
  const aggregate = zeroCounts(AGGREGATE_COUNT_KEYS);
  const eligibility = zeroCounts(ELIGIBILITY_COUNT_KEYS);
  const join = zeroCounts(JOIN_COUNT_KEYS);

  const companyIndex = new Map<string, CompanyContextKind>();
  const scanWindow = fixture.companies.slice(0, limits.maxCompanyScanRows);
  for (const row of scanWindow) {
    aggregate.company_rows_scanned += 1;
    eligibility[row.eligibility] += 1;
    const kind = contextKindOf(row.eligibility);
    if (row.companyRef.trim() === '') {
      aggregate.company_rows_excluded += 1;
      continue;
    }
    if (!companyIndex.has(row.companyRef)) companyIndex.set(row.companyRef, kind);
    if (kind === 'usable_context') aggregate.company_rows_indexed += 1;
    else aggregate.company_rows_excluded += 1;
  }
  aggregate.company_rows_sampled = Math.min(fixture.companies.length, limits.maxCompanyRows);

  const establishmentWindow = fixture.establishments.slice(0, limits.maxEstablishmentRows);
  const refsHeld = new Set<string>();
  for (const row of establishmentWindow) {
    aggregate.establishment_rows_scanned += 1;

    if (row.privacySignal) {
      join.excluded_by_establishment_privacy_signal += 1;
      continue;
    }
    const ref = row.companyRef?.trim() ?? '';
    if (ref === '') {
      join.pending_full_join_context += 1;
      continue;
    }
    refsHeld.add(ref);
    if (companyIndex.size === 0) {
      join.pending_full_join_context += 1;
      continue;
    }
    const context = companyIndex.get(ref);
    if (context === undefined) {
      join.missing_company_context += 1;
      continue;
    }
    if (context === 'usable_context') join.joined_with_company_context += 1;
    else join.excluded_by_company_context += 1;
  }
  aggregate.establishment_refs_held_in_memory = refsHeld.size;

  return {
    aggregate,
    eligibility,
    join,
    coverageScanLimitReached: fixture.companies.length > limits.maxCompanyScanRows,
  };
}

// ─── Report assembly ──────────────────────────────────────────────────────────

interface ReportDraft {
  readonly ok: boolean;
  readonly runMode: BrazilReceitaFullJoinRunMode;
  readonly aggregate: Record<string, number>;
  readonly eligibility: Record<string, number>;
  readonly join: Record<string, number>;
  readonly guardrail: Record<string, number>;
  readonly cleanup: BrazilReceitaFullJoinCleanupReport;
  readonly errors: readonly BrazilReceitaFullJoinReportError[];
}

function assembleReport(draft: ReportDraft): BrazilReceitaFullJoinDryRunReport {
  return {
    ok: draft.ok,
    mode: BRAZIL_RECEITA_FULL_JOIN_DRY_RUN_MODE,
    run_mode: draft.runMode,
    source_key: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    source_period: null,
    decision_status: DECISION_STATUS_ALL_NOT_APPROVED,
    run_scope: RUN_SCOPE_ALL_FALSE,
    safety: SAFETY_ALL_FALSE,
    aggregate_counts: draft.aggregate,
    eligibility_counts: draft.eligibility,
    join_counts: draft.join,
    guardrail_counts: draft.guardrail,
    cleanup: draft.cleanup,
    errors: draft.errors,
  };
}

/**
 * Builds the fail-closed report for an aborted run: every count zero, cleanup marked
 * required, and the sanitized error recorded. No partial metric survives a failure.
 */
function failClosedReport(
  runMode: BrazilReceitaFullJoinRunMode,
  errors: readonly BrazilReceitaFullJoinReportError[],
  guardViolations: number,
  sanitizerFindings: number,
): BrazilReceitaFullJoinDryRunReport {
  const guardrail = zeroCounts(GUARDRAIL_COUNT_KEYS);
  guardrail.no_write_guard_violations = guardViolations;
  guardrail.forbidden_output_findings = sanitizerFindings;

  return assembleReport({
    ok: false,
    runMode,
    aggregate: zeroCounts(AGGREGATE_COUNT_KEYS),
    eligibility: zeroCounts(ELIGIBILITY_COUNT_KEYS),
    join: zeroCounts(JOIN_COUNT_KEYS),
    guardrail,
    cleanup: planBrazilReceitaFullJoinCleanup({
      sanitizerFailed: sanitizerFindings > 0,
      guardFailed: guardViolations > 0,
      errorCount: errors.length,
    }),
    errors,
  });
}

// ─── Fixture validation ───────────────────────────────────────────────────────

function isValidFixture(fixture: BrazilReceitaFullJoinSyntheticFixture): boolean {
  if (!Array.isArray(fixture.companies) || !Array.isArray(fixture.establishments)) return false;
  for (const row of fixture.companies) {
    if (typeof row?.companyRef !== 'string') return false;
    if (!ELIGIBILITY_COUNT_KEYS.includes(row.eligibility)) return false;
  }
  for (const row of fixture.establishments) {
    if (row?.companyRef !== null && typeof row?.companyRef !== 'string') return false;
    if (typeof row?.privacySignal !== 'boolean') return false;
  }
  return true;
}

function exceedsSyntheticCeiling(fixture: BrazilReceitaFullJoinSyntheticFixture): boolean {
  return (
    fixture.companies.length > BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS ||
    fixture.establishments.length > BRAZIL_RECEITA_FULL_JOIN_MAX_SYNTHETIC_ROWS
  );
}

// ─── Guard config projection ──────────────────────────────────────────────────

/**
 * Projects the input into the object handed to the no-write guard: every declared
 * field EXCEPT the synthetic fixture (structural test data, not config), with the two
 * optional escalation flags defaulted to `false` so an omission is still a declaration.
 *
 * Passing the whole input matters: the guard's second job is detecting dangerous
 * indicators, and it can only find one if it is allowed to see it.
 */
function buildGuardConfig(input: BrazilReceitaFullJoinDryRunInput): Record<string, unknown> {
  const guardConfig: Record<string, unknown> = { providerCalls: false, importExecuted: false };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'syntheticFixture') continue;
    if (value === undefined) continue;
    guardConfig[key] = value;
  }
  return guardConfig;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Runs the BR-SOURCE-11A full join dry-run scaffold and returns an AGGREGATE,
 * SANITIZED report. Never throws for a policy violation — every refusal comes back as
 * `ok: false` plus a value-free error code, so a caller can print the report safely.
 *
 * Order of operations is deliberate and fail-closed at every step:
 *   1. no-write/no-runtime guard (nothing else runs if the contract is not declared);
 *   2. output-sanitization version check (GATE-5 is not approved);
 *   3. run-mode resolution (`local_manifest_dry_run` always refuses in this hito);
 *   4. bounded-limit validation (hard caps shared with the BR-SOURCE-10G/10H join);
 *   5. synthetic fixture validation and scoring;
 *   6. output sanitization of the assembled report — a leak discards the metrics.
 */
export function runBrazilReceitaFullJoinDryRun(
  input: BrazilReceitaFullJoinDryRunInput,
): BrazilReceitaFullJoinDryRunReport {
  const requestedMode = input.mode ?? BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE;
  const knownMode = BRAZIL_RECEITA_FULL_JOIN_RUN_MODES.includes(requestedMode);
  // An unknown mode is still reported against the SAFE default, never echoed back.
  const reportedMode = knownMode ? requestedMode : BRAZIL_RECEITA_FULL_JOIN_DEFAULT_RUN_MODE;

  // 1) No-write / no-runtime guard. The WHOLE input is handed to the guard (minus the
  //    synthetic fixture, which is structural test data rather than config) so that a
  //    dangerous indicator smuggled alongside the declared contract — a service-role
  //    key, a Supabase URL, a runtime endpoint — is detected rather than ignored.
  const guard = assertBrazilReceitaFullJoinNoWrite(buildGuardConfig(input));
  if (!guard.ok) {
    return failClosedReport(
      reportedMode,
      [{ error_code: BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_GUARD_ERROR_CODE, stage: 'no_write_guard' }],
      guard.violations.length,
      0,
    );
  }

  // 2) Output-sanitization version: GATE-5 is not approved, so nothing else is valid.
  if (
    input.outputSanitizationVersion !== undefined &&
    input.outputSanitizationVersion !== BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION
  ) {
    return failClosedReport(
      reportedMode,
      [{ error_code: 'output_sanitization_version_not_approved', stage: 'mode_resolution' }],
      0,
      0,
    );
  }

  // 3) Run mode.
  if (!knownMode) {
    return failClosedReport(
      reportedMode,
      [{ error_code: 'invalid_run_mode', stage: 'mode_resolution' }],
      0,
      0,
    );
  }
  if (requestedMode === 'local_manifest_dry_run') {
    // Gate A: the explicit opt-in must be present at all.
    if (input.allowLocalManifest !== true) {
      return failClosedReport(
        reportedMode,
        [{ error_code: 'allow_local_manifest_required', stage: 'mode_resolution' }],
        0,
        0,
      );
    }
    // Gate B: even WITH the opt-in, reading a real local manifest is what GATE-1 and
    // GATE-2 would have to authorize. Neither is approved, so this refuses and the
    // runner performs no filesystem read whatsoever in BR-SOURCE-11A.
    return failClosedReport(
      reportedMode,
      [{ error_code: 'local_manifest_execution_not_authorized', stage: 'mode_resolution' }],
      0,
      0,
    );
  }

  // 4) Bounded limits.
  const limits = resolveLimits(input);
  if (!limits.ok) {
    return failClosedReport(
      reportedMode,
      [{ error_code: limits.failure.code, stage: 'limit_validation' }],
      0,
      0,
    );
  }

  // 5) Synthetic fixture.
  const fixture = input.syntheticFixture ?? defaultBrazilReceitaFullJoinSyntheticFixture();
  if (!isValidFixture(fixture)) {
    return failClosedReport(
      reportedMode,
      [{ error_code: 'synthetic_fixture_invalid', stage: 'fixture_validation' }],
      0,
      0,
    );
  }
  if (exceedsSyntheticCeiling(fixture)) {
    return failClosedReport(
      reportedMode,
      [{ error_code: 'full_dataset_processing_not_allowed', stage: 'fixture_validation' }],
      0,
      0,
    );
  }

  const outcome = scoreSyntheticJoin(fixture, limits.value);

  const guardrail = zeroCounts(GUARDRAIL_COUNT_KEYS);
  guardrail.company_sample_cap_applied =
    fixture.companies.length > limits.value.maxCompanyRows ? 1 : 0;
  guardrail.company_scan_cap_applied = outcome.coverageScanLimitReached ? 1 : 0;
  guardrail.establishment_sample_cap_applied =
    fixture.establishments.length > limits.value.maxEstablishmentRows ? 1 : 0;
  guardrail.coverage_scan_limit_reached = outcome.coverageScanLimitReached ? 1 : 0;

  const candidate = assembleReport({
    ok: true,
    runMode: reportedMode,
    aggregate: outcome.aggregate,
    eligibility: outcome.eligibility,
    join: outcome.join,
    guardrail,
    cleanup: planBrazilReceitaFullJoinCleanup({
      sanitizerFailed: false,
      guardFailed: false,
      errorCount: 0,
    }),
    errors: [],
  });

  // 6) Output sanitization. A leak discards every metric — the report never ships
  //    partially-sanitized data, and the offending value is never surfaced.
  const sanitized = sanitizeBrazilReceitaFullJoinReport(candidate);
  if (!sanitized.ok) {
    return failClosedReport(
      reportedMode,
      [
        {
          error_code: BRAZIL_RECEITA_FULL_JOIN_SANITIZER_ERROR_CODE,
          stage: 'output_sanitization',
        },
      ],
      0,
      sanitized.findings.length,
    );
  }

  return candidate;
}
