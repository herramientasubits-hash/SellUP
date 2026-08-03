/**
 * BR Receita CNPJ — LIMITED BROADER LOCAL EXECUTION control contract (BR-SOURCE-11P-IMPL).
 *
 * The fail-closed CONTROL LAYER for a *possible future* limited broader local execution, built
 * against the design package merged as BR-SOURCE-11O-LAND. It exists because the owner
 * authorized exactly one thing:
 *
 *     AUTHORIZE BR-SOURCE-11P — LIMITED BROADER LOCAL EXECUTION IMPLEMENTATION
 *
 * That phrase authorizes IMPLEMENTATION and nothing else. It does not approve GATE-2, does not
 * authorize limited broader local execution, does not authorize broader local execution, does
 * not authorize temp storage, and does not authorize reading a single real byte.
 *
 * ── The one property this module is built to hold ───────────────────────────────
 * Real limited broader local execution must remain IMPOSSIBLE, and impossible by CONSTRUCTION
 * rather than by configuration. Two independent structural blocks enforce that, and neither can
 * be lifted by a caller, a flag, or an argument:
 *
 *   1. The RECORDED gate state is `not_approved` and the RECORDED execution authorization phrase
 *      does not exist (`null`). Both are module constants, never caller input. Per 11O § 8 a
 *      `--gate2-approved` argument is "a state assertion validated against the recorded gate
 *      state, never a self-declaration" — so a caller asserting approval is a VIOLATION, not an
 *      approval, and a caller asserting non-approval is simply the truth. Either way: refused.
 *
 *   2. No cap ceiling is owner-approved. 11O § 10 leaves every cap "TBD by owner" and states that
 *      "an unset cap is not an unlimited cap": absent an explicit owner value each cap resolves
 *      to `not_authorized`. So `..._AUTHORIZED_CAP_MAXIMA` is deliberately all-`null`, and a
 *      fully-capped request is *still* refused — `cap_ceiling_not_authorized`. Inventing a
 *      ceiling here would be granting a cap this milestone has no authority to grant.
 *
 * Those blocks are expressed in the TYPES, not only in the logic: `ok` is the literal `false`,
 * `decisionStatus` is a single-member union `'not_authorized'`, and `fileAccessAllowed` is the
 * literal `false`. There is no value of any input for which this module can report otherwise,
 * and no caller can write a branch that proceeds to open a file.
 *
 * ── Why this module never touches the filesystem ────────────────────────────────
 * 11O § 7 makes the ORDER the safety property: steps 1–8 (authorization, gate state, strict
 * mode, control file, input root, families, caps, temp policy) are ALL pre-open checks, and a
 * violation discovered after the first open "has already produced the read it was meant to
 * prevent". So this module is PURE — it imports no `fs`, no `path`, performs no I/O, reads no
 * environment variable — and it receives no filesystem path at all. Directory policy arrives as
 * CLASS LABELS (`pathTraversalRequested`, `symlinkRequested`, …), never as a string that could
 * name an operator's machine. A layer that cannot hold a path cannot leak one.
 *
 * ── Why the report echoes no caller string ──────────────────────────────────────
 * 11O § 17 proposes a `families_requested` field. This implementation keeps the field NAME but
 * makes it a CLASS TALLY (`allowed` / `forbidden` / `unexpected` counts) rather than the raw
 * list, because a raw list would echo arbitrary caller input straight into an evidence packet —
 * and arbitrary input can carry an identifier. The tally answers the reviewer's question (was a
 * forbidden family requested?) while making the leak structurally impossible. Every other report
 * value is a fixed label or a small count, and the `_bucket` suffix on magnitude fields is
 * load-bearing per § 17: a bucket, never an exact figure, so no two fields can be differenced
 * back into a dataset-level number.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens, stats, reads, or names a file, a manifest, a CSV, a ZIP, or a directory.
 *   - accepts, holds, returns, or logs a filesystem path, a filename, or a basename.
 *   - reads a row, a cell, an identifier, or a join key; it is never given one.
 *   - computes coverage, a percentage, a ratio, or a denominator.
 *   - hashes anything.
 *   - approves a gate, or lets a caller approve one.
 *   - opens a Supabase client, writes, imports, activates runtime, touches Agent 1, or calls a
 *     provider — and reports all five as structurally `false` regardless of what was requested.
 *   - echoes a caller-supplied string in a result, a report, or an error.
 */

import {
  assertBrazilReceitaFullJoinNoWrite,
  type BrazilReceitaFullJoinNoWriteViolationCode,
} from './br-receita-cnpj-full-join-no-write-guard';
import { BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS } from './br-receita-cnpj-real-manifest-metadata-reader';
import { BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES } from './br-receita-cnpj-required-family-probe';

// ─── Recorded state (never caller input) ──────────────────────────────────────

/** The hito this control layer belongs to. A label, never an approval. */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_MILESTONE = 'BR-SOURCE-11P' as const;

/**
 * The RECORDED GATE-2 state. BR-SOURCE-11M closed the formal decision record with GATE-2
 * `not_started / not approved`, and no later milestone changed it. A caller cannot widen this:
 * a `gate2Approved: true` assertion is validated AGAINST this constant and reported as a
 * self-declaration violation.
 */
export const BRAZIL_RECEITA_RECORDED_GATE2_STATUS = 'not_approved' as const;

/**
 * The RECORDED owner authorization phrase for EXECUTION. There is none — `null`.
 *
 * Deliberately not a string. The 11P phrase authorizes implementation, and no execution phrase
 * exists in any merged decision record, so the honest recorded value is "absent". Encoding it as
 * `null` also means no literal phrase sits in source waiting to be satisfied by an edit: every
 * phrase a caller can pass mismatches, because there is nothing to match.
 */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_RECORDED_AUTHORIZATION_PHRASE: string | null =
  null;

/**
 * Families that MAY be named by a future authorized request — Empresas and Estabelecimentos,
 * the two required families, reused from the 11F structural probe rather than restated so the
 * allowlist cannot drift between modules (11O § 6: prefer extending existing modules).
 *
 * This is an ALLOWLIST, never a denylist alone (§ 9): a family absent from it is blocked even
 * when it is also absent from the forbidden-token list, so a newly published family in a future
 * dataset release cannot become readable by omission.
 */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_ALLOWED_FAMILIES: readonly string[] = [
  ...BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES,
];

/**
 * Person-family tokens that are categorically blocked (§ 9) — Sócios/QSA/CPF and the rest.
 * Reused from the metadata reader so the person-data block has exactly one definition.
 */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_FORBIDDEN_FAMILY_TOKENS: readonly string[] =
  [...BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS];

// ─── Caps ─────────────────────────────────────────────────────────────────────

/** The seven caps 11O § 10 requires a request to state EXPLICITLY. Order is declaration order. */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_NAMES = [
  'maxFiles',
  'maxFilesPerFamily',
  'maxBytesPerFile',
  'maxRowsPerFile',
  'maxTotalBytes',
  'maxTotalRows',
  'maxRuntimeSeconds',
] as const;

export type BrazilReceitaLimitedBroaderLocalExecutionCapName =
  (typeof BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_NAMES)[number];

/**
 * The owner-approved MAXIMUM for each cap. Every entry is `null` = `not_authorized`.
 *
 * This is the second structural block described in the header, and the reason a fully-capped
 * request is still refused. 11O § 10 lists every cap as "TBD by owner"; filling one in here
 * would be an authorization decision, which this milestone explicitly does not carry. When an
 * owner records values, they land HERE and nowhere else — the ceiling check below already reads
 * from this table, so no other code changes.
 */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED_CAP_MAXIMA: {
  readonly [K in BrazilReceitaLimitedBroaderLocalExecutionCapName]: number | null;
} = {
  maxFiles: null,
  maxFilesPerFamily: null,
  maxBytesPerFile: null,
  maxRowsPerFile: null,
  maxTotalBytes: null,
  maxTotalRows: null,
  maxRuntimeSeconds: null,
};

/**
 * A PARSER sanity bound, not a cap authorization.
 *
 * A CLI adapter needs *some* bound so an absurd numeric argument is refused at parse time rather
 * than carried around; this is that bound and nothing more. It authorizes no window, appears in
 * no ceiling check, and is unrelated to
 * `..._AUTHORIZED_CAP_MAXIMA` above — which remains all-`null`. A value inside this bound is
 * still refused with `cap_ceiling_not_authorized`.
 */
export const BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_PARSE_CEILING = 1_000_000 as const;

// ─── Fail-closed codes ────────────────────────────────────────────────────────

/**
 * Why the control layer refused. Fixed machine codes only: a code names the CONDITION and, where
 * it helps a reviewer, the FLAG or CAP involved. It never embeds a caller value, a path, a
 * filename, a family string, an identifier, or a number.
 *
 * Every case in 11O § 14 has a code here.
 */
export type BrazilReceitaLimitedBroaderLocalExecutionRefusalCode =
  // Request shape.
  | 'request_not_an_object'
  // § 14 — authorization and gate state.
  | 'authorization_phrase_missing'
  | 'authorization_phrase_mismatch'
  | 'limited_broader_local_execution_not_authorized'
  | 'gate2_not_approved'
  | 'gate2_approval_self_declared'
  // § 14 — mandatory modes.
  | 'strict_mode_not_declared'
  | 'aggregate_only_not_declared'
  // § 14 — families.
  | 'family_not_declared'
  | 'forbidden_family_requested'
  | 'unexpected_family_requested'
  // § 14 — caps. One code per cap, plus the two ceiling outcomes.
  | 'max_files_not_declared'
  | 'max_files_per_family_not_declared'
  | 'max_bytes_per_file_not_declared'
  | 'max_rows_per_file_not_declared'
  | 'max_total_bytes_not_declared'
  | 'max_total_rows_not_declared'
  | 'max_runtime_seconds_not_declared'
  | 'cap_ceiling_not_authorized'
  | 'cap_above_authorized_maximum'
  // § 14 — directory and temp storage.
  | 'allowed_input_root_not_authorized'
  | 'path_traversal_requested'
  | 'symlink_requested'
  | 'unsafe_basename_requested'
  | 'output_inside_repo_requested'
  | 'temp_storage_not_authorized'
  // § 14 — forbidden output requests (§ 12, § 13).
  | 'raw_row_output_requested'
  | 'raw_cell_output_requested'
  | 'identifier_output_requested'
  | 'join_key_output_requested'
  | 'join_key_hash_output_requested'
  | 'exact_coverage_percentage_requested'
  | 'full_dataset_denominator_requested'
  | 'coverage_proof_requested'
  | 'coverage_guarantee_requested'
  | 'production_inference_requested'
  | 'absolute_path_output_requested'
  | 'real_filename_output_requested'
  // § 14 — escalation flags. The first five are the shared 11A guard's own codes, reused rather
  // than renamed so one vocabulary covers both layers.
  | BrazilReceitaFullJoinNoWriteViolationCode
  | 'production_writes_requested';

/** Maps each cap to the code raised when the request does not state it. */
const CAP_NOT_DECLARED_CODES: {
  readonly [K in BrazilReceitaLimitedBroaderLocalExecutionCapName]: BrazilReceitaLimitedBroaderLocalExecutionRefusalCode;
} = {
  maxFiles: 'max_files_not_declared',
  maxFilesPerFamily: 'max_files_per_family_not_declared',
  maxBytesPerFile: 'max_bytes_per_file_not_declared',
  maxRowsPerFile: 'max_rows_per_file_not_declared',
  maxTotalBytes: 'max_total_bytes_not_declared',
  maxTotalRows: 'max_total_rows_not_declared',
  maxRuntimeSeconds: 'max_runtime_seconds_not_declared',
};

// ─── Request ──────────────────────────────────────────────────────────────────

/**
 * The conceptual 11O § 8 CLI/API surface, as a value.
 *
 * Every field is explicit and there is no default that widens scope. The negative guards are
 * asserted INVARIANTS rather than toggles (§ 8): `escalations` records what the caller declared,
 * and any `true` is a refusal — there is no code path that turns one off.
 *
 * `directoryPolicy` carries CLASS LABELS only. No field of this interface is, or may become, a
 * filesystem path.
 */
export interface BrazilReceitaLimitedBroaderLocalExecutionRequest {
  /** The owner phrase declared on this invocation, if any. Compared, never echoed. */
  readonly authorizationPhrase: string | null;
  /** State assertion (§ 8), validated against the recorded authorization — not a grant. */
  readonly limitedBroaderLocalExecutionAuthorized: boolean;
  /** State assertion (§ 8), validated against `..._RECORDED_GATE2_STATUS` — not a grant. */
  readonly gate2Approved: boolean;
  readonly strict: boolean;
  /** Mandatory, not optional (§ 8). */
  readonly aggregateOnly: boolean;
  /** Family LABELS requested. Classified into counts; never echoed. */
  readonly requestedFamilies: readonly string[];
  readonly caps: {
    readonly [K in BrazilReceitaLimitedBroaderLocalExecutionCapName]: number | null;
  };
  readonly directoryPolicy: {
    readonly allowedInputRootAuthorized: boolean;
    readonly pathTraversalRequested: boolean;
    readonly symlinkRequested: boolean;
    readonly unsafeBasenameRequested: boolean;
    readonly outputInsideRepoRequested: boolean;
  };
  readonly tempStorage: {
    readonly enabled: boolean;
    readonly authorized: boolean;
  };
  readonly outputRequests: {
    readonly rawRows: boolean;
    readonly rawCells: boolean;
    readonly identifiers: boolean;
    readonly joinKeys: boolean;
    readonly joinKeyHashes: boolean;
    readonly exactCoveragePercentage: boolean;
    readonly fullDatasetDenominator: boolean;
    readonly coverageProof: boolean;
    readonly coverageGuarantee: boolean;
    readonly productionInference: boolean;
    readonly absolutePaths: boolean;
    readonly realFilenames: boolean;
  };
  readonly escalations: {
    readonly importExecuted: boolean;
    readonly supabaseWrite: boolean;
    readonly runtimeIntegration: boolean;
    readonly agent1Integration: boolean;
    readonly providerCalls: boolean;
    readonly productionWrites: boolean;
  };
}

// ─── Evaluation result ────────────────────────────────────────────────────────

/**
 * Single-member union. There is no authorized decision status in this milestone, and making that
 * a TYPE rather than a runtime value means a caller cannot write a branch that proceeds.
 */
export type BrazilReceitaLimitedBroaderLocalExecutionDecisionStatus = 'not_authorized';

export interface BrazilReceitaLimitedBroaderLocalExecutionEvaluation {
  /** Literal `false`: the evaluation can never pass while the two structural blocks hold. */
  readonly ok: false;
  readonly decisionStatus: BrazilReceitaLimitedBroaderLocalExecutionDecisionStatus;
  readonly gate2Status: typeof BRAZIL_RECEITA_RECORDED_GATE2_STATUS;
  readonly limitedBroaderLocalExecutionAuthorized: false;
  /**
   * Literal `false`. The control layer's answer to "may step 9 open the first file?" — and the
   * reason a CLI adapter can be proven not to open one.
   */
  readonly fileAccessAllowed: false;
  /** Every refusal found, de-duplicated, in declaration order. Value-free. */
  readonly errors: readonly BrazilReceitaLimitedBroaderLocalExecutionRefusalCode[];
}

// ─── Input reading (fail-closed) ──────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNested(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = record[key];
  return isRecord(child) ? child : {};
}

/**
 * A DECLARATION: only the literal `true` counts. An absent, malformed, or truthy-but-not-`true`
 * value is "not declared" — never inferred as declared.
 */
function isDeclared(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

/**
 * A REQUEST for something forbidden: only the literal `false` counts as "not requested". Absence
 * therefore does NOT trip a refusal (a caller who says nothing about raw rows has not asked for
 * them), but any non-`false` value — `true`, a string, a number — does. The asymmetry with
 * `isDeclared` is deliberate: a missing permission is a stop, a missing prohibition-breach is not
 * an accusation.
 */
function isRequested(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return value !== undefined && value !== false;
}

/** A cap value: a finite, non-negative integer, or `null` for "not stated". */
function readCap(caps: Record<string, unknown>, name: string): number | null {
  const value = caps[name];
  if (typeof value !== 'number') return null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ─── Family classification ────────────────────────────────────────────────────

/** How a requested family label resolves against the allowlist and the person-family block. */
export type BrazilReceitaLimitedBroaderLocalExecutionFamilyClass =
  | 'allowed'
  | 'forbidden'
  | 'unexpected';

function normalizeFamily(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Classifies one family label. The person-family block is checked FIRST, so a label that is
 * somehow both person-shaped and allowlist-shaped resolves as `forbidden` rather than `allowed`.
 */
export function classifyLimitedBroaderLocalExecutionFamily(
  family: string,
): BrazilReceitaLimitedBroaderLocalExecutionFamilyClass {
  const normalized = normalizeFamily(family);
  if (
    BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_FORBIDDEN_FAMILY_TOKENS.some((token) =>
      normalized.includes(normalizeFamily(token)),
    )
  ) {
    return 'forbidden';
  }
  if (
    BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_ALLOWED_FAMILIES.some(
      (allowed) => normalizeFamily(allowed) === normalized,
    )
  ) {
    return 'allowed';
  }
  return 'unexpected';
}

export interface BrazilReceitaLimitedBroaderLocalExecutionFamilyTally {
  readonly allowed: number;
  readonly forbidden: number;
  readonly unexpected: number;
}

function tallyFamilies(
  families: readonly string[],
): BrazilReceitaLimitedBroaderLocalExecutionFamilyTally {
  let allowed = 0;
  let forbidden = 0;
  let unexpected = 0;
  for (const family of families) {
    const classification = classifyLimitedBroaderLocalExecutionFamily(family);
    if (classification === 'allowed') allowed += 1;
    else if (classification === 'forbidden') forbidden += 1;
    else unexpected += 1;
  }
  return { allowed, forbidden, unexpected };
}

// ─── Forbidden-output request mapping ─────────────────────────────────────────

const OUTPUT_REQUEST_CODES: ReadonlyArray<
  readonly [field: string, code: BrazilReceitaLimitedBroaderLocalExecutionRefusalCode]
> = [
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

const DIRECTORY_REQUEST_CODES: ReadonlyArray<
  readonly [field: string, code: BrazilReceitaLimitedBroaderLocalExecutionRefusalCode]
> = [
  ['pathTraversalRequested', 'path_traversal_requested'],
  ['symlinkRequested', 'symlink_requested'],
  ['unsafeBasenameRequested', 'unsafe_basename_requested'],
  ['outputInsideRepoRequested', 'output_inside_repo_requested'],
];

// ─── Public entry point: evaluation ───────────────────────────────────────────

/**
 * Evaluates a limited broader local execution request, fail-closed, in 11O § 7 order: steps 1–8
 * are all resolved here and every one of them is a PRE-OPEN check, so a caller that honours
 * `fileAccessAllowed` never reaches step 9.
 *
 * PURE: no I/O, no path, no env read, no client. Returns every refusal (value-free machine codes)
 * so a CLI adapter can fail closed with one sanitized report — it never throws on a refusal and
 * never echoes a caller value.
 *
 * `request` is intentionally `unknown`: it arrives from a CLI boundary or a test, and the layer
 * must be able to refuse a malformed one rather than trust it.
 */
export function evaluateLimitedBroaderLocalExecutionRequest(
  request: unknown,
): BrazilReceitaLimitedBroaderLocalExecutionEvaluation {
  const errors: BrazilReceitaLimitedBroaderLocalExecutionRefusalCode[] = [];
  const push = (code: BrazilReceitaLimitedBroaderLocalExecutionRefusalCode): void => {
    if (!errors.includes(code)) errors.push(code);
  };

  if (!isRecord(request)) {
    return {
      ok: false,
      decisionStatus: 'not_authorized',
      gate2Status: BRAZIL_RECEITA_RECORDED_GATE2_STATUS,
      limitedBroaderLocalExecutionAuthorized: false,
      fileAccessAllowed: false,
      errors: ['request_not_an_object'],
    };
  }

  // § 7 step 1 — the authorization phrase. Compared against the RECORDED phrase, which is
  // absent, so every phrase mismatches. The phrase itself is never echoed.
  const phrase = typeof request.authorizationPhrase === 'string' ? request.authorizationPhrase : '';
  if (phrase.trim() === '') {
    push('authorization_phrase_missing');
  } else if (phrase !== BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_RECORDED_AUTHORIZATION_PHRASE) {
    push('authorization_phrase_mismatch');
  }
  // The authorization STATE, independent of the phrase: recorded authorization does not exist,
  // so this refusal stands whether or not a phrase was supplied.
  push('limited_broader_local_execution_not_authorized');

  // § 7 step 2 — the gate state. A caller asserting approval is asserting something the recorded
  // state contradicts, which is its own violation on top of the gate refusal.
  if (isDeclared(request, 'gate2Approved')) push('gate2_approval_self_declared');
  push('gate2_not_approved');

  // § 7 step 3 — the two mandatory modes.
  if (!isDeclared(request, 'strict')) push('strict_mode_not_declared');
  if (!isDeclared(request, 'aggregateOnly')) push('aggregate_only_not_declared');

  // § 7 step 6 — families. An allowlist: absent from it is blocked, and an empty request is a
  // stop rather than an implicit "all".
  const families = readStringArray(request, 'requestedFamilies');
  if (families.length === 0) push('family_not_declared');
  const familyTally = tallyFamilies(families);
  if (familyTally.forbidden > 0) push('forbidden_family_requested');
  if (familyTally.unexpected > 0) push('unexpected_family_requested');

  // § 7 step 7 — caps. Each must be STATED, and each stated value must sit under an owner
  // ceiling. No ceiling is authorized, so a fully-capped request still stops here.
  const caps = readNested(request, 'caps');
  for (const name of BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_CAP_NAMES) {
    const value = readCap(caps, name);
    if (value === null) {
      push(CAP_NOT_DECLARED_CODES[name]);
      continue;
    }
    const ceiling = BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED_CAP_MAXIMA[name];
    if (ceiling === null) {
      push('cap_ceiling_not_authorized');
    } else if (value > ceiling) {
      push('cap_above_authorized_maximum');
    }
  }

  // § 7 step 5 — the input root and the directory refusals.
  const directoryPolicy = readNested(request, 'directoryPolicy');
  if (!isDeclared(directoryPolicy, 'allowedInputRootAuthorized')) {
    push('allowed_input_root_not_authorized');
  }
  for (const [field, code] of DIRECTORY_REQUEST_CODES) {
    if (isRequested(directoryPolicy, field)) push(code);
  }

  // § 7 step 8 — temp storage. `not_authorized` by default (§ 11): enabling it without a
  // separate approval is a stop, and no separate approval exists.
  const tempStorage = readNested(request, 'tempStorage');
  if (isRequested(tempStorage, 'enabled') || isRequested(tempStorage, 'authorized')) {
    push('temp_storage_not_authorized');
  }

  // § 12 / § 13 — forbidden output requests, declined at the INPUT boundary as well as blocked
  // at the output one by the sanitizer.
  const outputRequests = readNested(request, 'outputRequests');
  for (const [field, code] of OUTPUT_REQUEST_CODES) {
    if (isRequested(outputRequests, field)) push(code);
  }

  // The escalation invariants. Delegated to the shared BR-SOURCE-11A guard rather than
  // re-implemented, so import / Supabase / runtime / Agent 1 / provider have ONE definition; its
  // codes are reused verbatim. `productionWrites` is not part of that contract, so it is checked
  // here alongside.
  const escalations = readNested(request, 'escalations');
  const noWrite = assertBrazilReceitaFullJoinNoWrite({
    noWriteMode: true,
    supabaseWrite: escalations.supabaseWrite === true,
    runtimeIntegration: escalations.runtimeIntegration === true,
    agent1Integration: escalations.agent1Integration === true,
    providerCalls: escalations.providerCalls === true,
    importExecuted: escalations.importExecuted === true,
  });
  for (const violation of noWrite.violations) push(violation);
  if (isRequested(escalations, 'productionWrites')) push('production_writes_requested');

  return {
    ok: false,
    decisionStatus: 'not_authorized',
    gate2Status: BRAZIL_RECEITA_RECORDED_GATE2_STATUS,
    limitedBroaderLocalExecutionAuthorized: false,
    fileAccessAllowed: false,
    errors,
  };
}

// ─── Public entry point: evidence packet ──────────────────────────────────────

/**
 * The 11O § 17 evidence packet. Bucketed, path-free, filename-free, identifier-free.
 *
 * Every magnitude field carries the literal `none` bucket rather than a figure, because nothing
 * was opened, read, or compared — the `_bucket` suffix is load-bearing (§ 17) and a scaffold that
 * reported exact zeros would still be reporting exact counts.
 *
 * The `no_*` / `*_executed` fields are STRUCTURAL literals, not derived from the request: they
 * describe what HAPPENED (nothing), while `fail_closed_findings` describes what was REFUSED. A
 * caller who declares `importExecuted: true` gets `import_executed: false` here AND
 * `import_execution_requested` there.
 */
export interface BrazilReceitaLimitedBroaderLocalExecutionReport {
  readonly milestone: typeof BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_MILESTONE;
  readonly authorization_status: 'not_authorized';
  readonly gate2_status: typeof BRAZIL_RECEITA_RECORDED_GATE2_STATUS;
  readonly run_mode: 'limited_broader_local_execution_refused';
  readonly decision_status: BrazilReceitaLimitedBroaderLocalExecutionDecisionStatus;
  readonly ok: false;
  /** Class TALLY, never the raw caller list — see the module header. */
  readonly families_requested: BrazilReceitaLimitedBroaderLocalExecutionFamilyTally;
  readonly families_opened_bucket: 'none';
  readonly files_opened_bucket: 'none';
  readonly bytes_read_bucket: 'none';
  readonly rows_read_bucket: 'none';
  readonly runtime_bucket: 'none';
  readonly join_executed_bucket: 'none';
  readonly temp_storage_used: false;
  readonly cleanup_status: 'nothing_to_clean';
  readonly aggregate_output_status: 'aggregate_only';
  readonly denominator_scope: 'not_computed';
  readonly coverage_claimed: false;
  readonly exact_coverage_percentage_printed: false;
  readonly full_dataset_denominator_printed: false;
  readonly production_inference_allowed: false;
  readonly identifiers_printed: false;
  readonly join_keys_printed: false;
  readonly hashes_printed: false;
  readonly absolute_paths_printed: false;
  readonly real_file_names_printed: false;
  readonly rows_printed: false;
  readonly sanitizer_findings: readonly never[];
  readonly sensitive_scan_findings: readonly never[];
  readonly fail_closed_findings: readonly BrazilReceitaLimitedBroaderLocalExecutionRefusalCode[];
  readonly no_write_status: 'held';
  readonly no_runtime_status: 'held';
  readonly no_agent1_status: 'held';
  readonly no_provider_status: 'held';
  readonly import_executed: false;
  readonly supabase_write: false;
  readonly runtime_integration: false;
  readonly agent1_integration: false;
  readonly provider_calls: false;
  readonly production_writes: false;
  readonly file_access_allowed: false;
  readonly gate_status: {
    readonly gate1: 'not_approved';
    readonly gate2: 'not_approved';
    readonly gate3: 'not_approved';
    readonly gate4: 'not_approved';
    readonly gate5: 'not_approved';
    readonly gate6: 'not_approved';
    readonly gate7: 'not_approved';
    readonly gate8: 'not_approved';
  };
  readonly brazil_readiness: {
    readonly full_join_execution_ready: false;
    readonly import_ready: false;
    readonly runtime_ready: false;
    readonly agent1_ready: false;
    readonly live_prospect_generation_ready: false;
  };
}

/**
 * Builds the evidence packet for a request. PURE. Runs the evaluation itself, so a caller cannot
 * assemble a report that disagrees with the refusal it came from.
 */
export function buildLimitedBroaderLocalExecutionReport(
  request: unknown,
): BrazilReceitaLimitedBroaderLocalExecutionReport {
  const evaluation = evaluateLimitedBroaderLocalExecutionRequest(request);
  const families = isRecord(request) ? readStringArray(request, 'requestedFamilies') : [];

  return {
    milestone: BRAZIL_RECEITA_LIMITED_BROADER_LOCAL_EXECUTION_MILESTONE,
    authorization_status: 'not_authorized',
    gate2_status: BRAZIL_RECEITA_RECORDED_GATE2_STATUS,
    run_mode: 'limited_broader_local_execution_refused',
    decision_status: evaluation.decisionStatus,
    ok: false,
    families_requested: tallyFamilies(families),
    families_opened_bucket: 'none',
    files_opened_bucket: 'none',
    bytes_read_bucket: 'none',
    rows_read_bucket: 'none',
    runtime_bucket: 'none',
    join_executed_bucket: 'none',
    temp_storage_used: false,
    cleanup_status: 'nothing_to_clean',
    aggregate_output_status: 'aggregate_only',
    denominator_scope: 'not_computed',
    coverage_claimed: false,
    exact_coverage_percentage_printed: false,
    full_dataset_denominator_printed: false,
    production_inference_allowed: false,
    identifiers_printed: false,
    join_keys_printed: false,
    hashes_printed: false,
    absolute_paths_printed: false,
    real_file_names_printed: false,
    rows_printed: false,
    sanitizer_findings: [],
    sensitive_scan_findings: [],
    fail_closed_findings: evaluation.errors,
    no_write_status: 'held',
    no_runtime_status: 'held',
    no_agent1_status: 'held',
    no_provider_status: 'held',
    import_executed: false,
    supabase_write: false,
    runtime_integration: false,
    agent1_integration: false,
    provider_calls: false,
    production_writes: false,
    file_access_allowed: false,
    gate_status: {
      gate1: 'not_approved',
      gate2: 'not_approved',
      gate3: 'not_approved',
      gate4: 'not_approved',
      gate5: 'not_approved',
      gate6: 'not_approved',
      gate7: 'not_approved',
      gate8: 'not_approved',
    },
    brazil_readiness: {
      full_join_execution_ready: false,
      import_ready: false,
      runtime_ready: false,
      agent1_ready: false,
      live_prospect_generation_ready: false,
    },
  };
}
