/**
 * BR Receita CNPJ — controlled execution authorization intake validator (BR-SOURCE-13J).
 *
 * BR-SOURCE-13I hands a reader nine open decisions and asks who should take each one. What it does not
 * do — and could not do, since it accepts no decision as input — is check what happens once a reviewer
 * claims to have answered. A completed intake form is the next artefact in that story: a document a
 * human (or, here, a SYNTHETIC stand-in for one) fills in, naming who decided what, on what date, under
 * what scope, having acknowledged what they did and did not just grant.
 *
 * 13J is the validator for that intake:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *                          →  13G controlled execution attempt runner scaffold
 *                          →  13H controlled execution readiness report
 *                          →  13I controlled execution authorization handoff packet
 *                          →  13J controlled execution authorization intake validation
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   intake_complete          ≠  execution_authorized
 *   synthetic_intake_valid   ≠  gate approval
 *
 *   Authorization intake validation is not execution authorization.
 *
 * A completed intake is, if anything, MORE dangerous to misread than 13I's empty decision list, because
 * a completed intake looks like an answer. It names nine reviewers, nine roles, nine dates, and — in the
 * one fixture built to look as finished as possible — nine acceptances. Every property of that document
 * describes an intake that was FILLED IN, and none of them describes an authorization that was GRANTED.
 * `complete_synthetic_accept` is the fixture this warning exists for: it is the best-case, most-complete,
 * every-box-checked input this module can receive, and it still concludes `NO_GO`, `blocked`, and
 * `executionAuthorized: false` — identically to the worst-case fixture. Completeness of the SYNTHETIC
 * intake never flips execution authorization, because there is no code path in this module that reads
 * completeness as permission.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no filesystem, no path module, no network, no environment read, no
 *     argument vector, no child spawn, no clock, no randomness.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - runs a join or a coverage computation.
 *   - opens a database client, writes to a database, or applies a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - runs anything: it validates a document, it does not act on one.
 *   - approves a gate, authorizes a cap, or marks Brazil ready for the full join, import, runtime or
 *     Agent 1 — regardless of how complete or how "accepted" the intake it validates is.
 *   - re-implements any upstream rule. The 13I handoff packet it always builds and carries was produced
 *     by 13A–13I, verbatim.
 *
 * It is a pure function: same fixture, same review decision and same intake, same result, no side
 * effects, no mutation of the input. The result carries the static synthetic timestamp, so two runs are
 * byte-identical.
 */

import {
  BRAZIL_RECEITA_HANDOFF_DECISION_IDS,
  buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket,
  type BrazilReceitaControlledExecutionAuthorizationDecisionId,
  type BrazilReceitaControlledExecutionAuthorizationHandoffPacket,
} from './br-receita-cnpj-controlled-execution-authorization-handoff-packet';
import type { BrazilReceitaControlledExecutionReviewDecisionValue } from './br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Stable identity of the artefact this module emits. */
export const BRAZIL_RECEITA_INTAKE_VALIDATION_RESULT_TYPE =
  'br_receita_cnpj_controlled_execution_authorization_intake_validation_result' as const;

/** Result schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_INTAKE_VALIDATION_VERSION = 1 as const;

/** The static synthetic timestamp every result carries, so two runs are byte-identical. */
export const BRAZIL_RECEITA_INTAKE_STATIC_TIMESTAMP = 'STATIC_SYNTHETIC_TIMESTAMP' as const;

/** The sentence that must accompany every validation result, including the most complete intake. */
export const BRAZIL_RECEITA_INTAKE_DISCLAIMER =
  'Authorization intake validation is not execution authorization.' as const;

/** The one conclusion this module may reach about Brazil, whatever the intake reports. */
export const BRAZIL_RECEITA_INTAKE_READINESS_CONCLUSION = 'BRAZIL_REMAINS_BLOCKED' as const;

export type BrazilReceitaControlledExecutionAuthorizationIntakeFormat = 'json' | 'markdown';

/** Every output format, in documentation order. The single source of truth for callers. */
export const BRAZIL_RECEITA_INTAKE_FORMATS: readonly BrazilReceitaControlledExecutionAuthorizationIntakeFormat[] =
  ['json', 'markdown'] as const;

export function isBrazilReceitaIntakeFormat(
  value: string,
): value is BrazilReceitaControlledExecutionAuthorizationIntakeFormat {
  return (BRAZIL_RECEITA_INTAKE_FORMATS as readonly string[]).includes(value);
}

/**
 * The seventeen named synthetic intake scenarios this module can build and validate. One is built to
 * look as complete as an intake can look; the rest each isolate one way a real intake could fail — a
 * missing decision, a rejection, a deferral, an inconsistency between two decisions, an unrecognized
 * approver role, or unsafe content.
 */
export type BrazilReceitaControlledExecutionAuthorizationIntakeFixture =
  | 'complete_synthetic_accept'
  | 'missing_owner_completion'
  | 'missing_gate_2'
  | 'missing_gate_7'
  | 'missing_cap_input'
  | 'missing_controlled_execution'
  | 'missing_full_join'
  | 'missing_import'
  | 'missing_runtime'
  | 'missing_agent1'
  | 'rejected_gate_2'
  | 'deferred_gate_7'
  | 'inconsistent_import_without_full_join'
  | 'inconsistent_agent1_without_runtime'
  | 'placeholder_values'
  | 'forbidden_content'
  | 'invalid_reviewer_role';

/** Every intake fixture name, in documentation order. The single source of truth for callers. */
export const BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES: readonly BrazilReceitaControlledExecutionAuthorizationIntakeFixture[] =
  [
    'complete_synthetic_accept',
    'missing_owner_completion',
    'missing_gate_2',
    'missing_gate_7',
    'missing_cap_input',
    'missing_controlled_execution',
    'missing_full_join',
    'missing_import',
    'missing_runtime',
    'missing_agent1',
    'rejected_gate_2',
    'deferred_gate_7',
    'inconsistent_import_without_full_join',
    'inconsistent_agent1_without_runtime',
    'placeholder_values',
    'forbidden_content',
    'invalid_reviewer_role',
  ] as const;

export function isBrazilReceitaIntakeFixtureName(
  value: string,
): value is BrazilReceitaControlledExecutionAuthorizationIntakeFixture {
  return (BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES as readonly string[]).includes(value);
}

/** Thrown for an intake fixture name this module does not recognize. */
export const BRAZIL_RECEITA_INTAKE_UNKNOWN_FIXTURE_CODE = 'BRSOURCE13J_UNKNOWN_INTAKE_FIXTURE' as const;

/**
 * The 11W…12B placeholder token, restated here because this module imports no upstream module that
 * carries it. Its presence in a field is proof the field was never completed.
 */
export const BRAZIL_RECEITA_INTAKE_PLACEHOLDER_TOKEN = 'TBD_BY_OWNER' as const;

/** The only approval scope an intake decision may declare. */
export const BRAZIL_RECEITA_INTAKE_SCOPE = 'synthetic_validation_only' as const;

/** The four values an intake decision can carry. */
export type BrazilReceitaControlledExecutionAuthorizationIntakeDecisionValue =
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'missing';

/** Every recognized decision value, in documentation order. */
export const BRAZIL_RECEITA_INTAKE_DECISION_VALUES: readonly BrazilReceitaControlledExecutionAuthorizationIntakeDecisionValue[] =
  ['accepted', 'rejected', 'deferred', 'missing'] as const;

/** Who took a decision, restated from 13I plus one generic synthetic role for fixture convenience. */
export type BrazilReceitaControlledExecutionAuthorizationIntakeReviewerRole =
  | 'owner'
  | 'legal_security_privacy'
  | 'technical_owner'
  | 'commercial_operations'
  | 'synthetic_reviewer';

/** Every recognized reviewer role, in documentation order. The single source of truth for callers. */
export const BRAZIL_RECEITA_INTAKE_REVIEWER_ROLES: readonly BrazilReceitaControlledExecutionAuthorizationIntakeReviewerRole[] =
  ['owner', 'legal_security_privacy', 'technical_owner', 'commercial_operations', 'synthetic_reviewer'] as const;

/**
 * Whether `value` is one of the five recognized reviewer roles. The intake type declares `reviewerRole`
 * as that closed union, but nothing upstream of this module parses untyped input — a decision entry a
 * caller builds by hand (or, eventually, reads from a real submission) can carry any string in that
 * field, so the validator must check it at runtime rather than trust the type.
 */
export function isBrazilReceitaIntakeReviewerRole(
  value: unknown,
): value is BrazilReceitaControlledExecutionAuthorizationIntakeReviewerRole {
  return (
    typeof value === 'string' &&
    (BRAZIL_RECEITA_INTAKE_REVIEWER_ROLES as readonly string[]).includes(value)
  );
}

export type BrazilReceitaControlledExecutionAuthorizationIntakeDecision = {
  decisionId: BrazilReceitaControlledExecutionAuthorizationDecisionId;
  decisionValue: BrazilReceitaControlledExecutionAuthorizationIntakeDecisionValue;
  reviewerRole: BrazilReceitaControlledExecutionAuthorizationIntakeReviewerRole;
  reviewerReference: string;
  decisionDate: string;
  scope: typeof BRAZIL_RECEITA_INTAKE_SCOPE;
  acknowledgesSeparateAuthorizationRequired: boolean;
  acknowledgesNoExecutionAuthorizationGranted: boolean;
  acknowledgesNoGateApprovalByInference: boolean;
  notes?: string;
};

export type BrazilReceitaControlledExecutionAuthorizationIntake = {
  intakeType: 'br_receita_cnpj_controlled_execution_authorization_intake';
  version: 1;
  syntheticOnly: true;
  intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;
  decisions: BrazilReceitaControlledExecutionAuthorizationIntakeDecision[];
};

/** Stable identity of the intake object this module builds and validates. */
export const BRAZIL_RECEITA_INTAKE_TYPE =
  'br_receita_cnpj_controlled_execution_authorization_intake' as const;

// ─── Findings ─────────────────────────────────────────────────────────────────

/** Every finding code this validator can emit. The single source of truth for callers. */
export const BRAZIL_RECEITA_INTAKE_FINDING_CODES = {
  decisionMissing: 'INTAKE_DECISION_MISSING',
  decisionRejected: 'INTAKE_DECISION_REJECTED',
  decisionDeferred: 'INTAKE_DECISION_DEFERRED',
  inconsistentImportWithoutFullJoin: 'INTAKE_INCONSISTENT_IMPORT_WITHOUT_FULL_JOIN',
  inconsistentRuntimeWithoutImport: 'INTAKE_INCONSISTENT_RUNTIME_WITHOUT_IMPORT',
  inconsistentAgent1WithoutRuntime: 'INTAKE_INCONSISTENT_AGENT1_WITHOUT_RUNTIME',
  inconsistentExecutionWithoutGates: 'INTAKE_INCONSISTENT_EXECUTION_WITHOUT_GATES',
  fieldPlaceholder: 'INTAKE_FIELD_PLACEHOLDER',
  scopeInvalid: 'INTAKE_SCOPE_INVALID',
  requiredAckMissing: 'INTAKE_REQUIRED_ACK_MISSING',
  forbiddenContent: 'INTAKE_FORBIDDEN_CONTENT',
  reviewerRoleInvalid: 'INTAKE_REVIEWER_ROLE_INVALID',
} as const;

const CODES = BRAZIL_RECEITA_INTAKE_FINDING_CODES;

export type BrazilReceitaControlledExecutionAuthorizationIntakeValidationFinding = {
  findingId: string;
  severity: 'blocking';
  decisionId?: BrazilReceitaControlledExecutionAuthorizationDecisionId;
  description: string;
};

type Finding = BrazilReceitaControlledExecutionAuthorizationIntakeValidationFinding;

// ─── Forbidden content ────────────────────────────────────────────────────────

/**
 * Assembles a forbidden token from harmless parts, so this source file contains no path-, host- or
 * credential-shaped literal for a secret scanner (or a reader) to trip over. The accompanying test
 * rebuilds every expected token the same way and asserts the list has not drifted.
 */
function token(...parts: readonly string[]): string {
  return parts.join('');
}

/**
 * Content an intake must never carry. Matching is substring-based and deliberately narrow: it is never
 * anchored on digits, so a `decisionDate` survives untouched.
 */
export const BRAZIL_RECEITA_INTAKE_FORBIDDEN_CONTENT_PATTERNS: readonly {
  readonly token: string;
  readonly caseSensitive: boolean;
  readonly reason: string;
}[] = [
  { token: token('/', 'Users', '/'), caseSensitive: false, reason: 'absolute local path' },
  { token: token('Down', 'loads'), caseSensitive: false, reason: 'local download directory' },
  {
    token: token('manifest', '.headerless', '.json'),
    caseSensitive: false,
    reason: 'real manifest file name',
  },
  { token: token('sellup', '-source', '-data'), caseSensitive: false, reason: 'real dataset root' },
  { token: token('raw', '-zips'), caseSensitive: false, reason: 'real dataset subtree' },
  { token: token('extra', 'cted'), caseSensitive: false, reason: 'real dataset subtree' },
  {
    token: token('manifest', '-input'),
    caseSensitive: false,
    reason: 'real manifest input subtree',
  },
  { token: token('linkedin', '.com'), caseSensitive: false, reason: 'personal profile host' },
  { token: token('postgres', '://'), caseSensitive: false, reason: 'database connection string' },
  { token: token('service', '_role'), caseSensitive: false, reason: 'privileged database role' },
  { token: token('SUPABASE', '_SERVICE'), caseSensitive: false, reason: 'privileged env var name' },
  { token: token('BEGIN ', 'PRIVATE'), caseSensitive: false, reason: 'private key block' },
  { token: token('PRIVATE', ' KEY'), caseSensitive: false, reason: 'private key block' },
  { token: token('ey', 'J'), caseSensitive: true, reason: 'JWT-shaped value' },
  { token: token('sk', '-'), caseSensitive: true, reason: 'API-key-shaped value' },
  { token: token('xoxb', '-'), caseSensitive: true, reason: 'chat-token-shaped value' },
] as const;

/** The forbidden tokens alone, for callers that only need the list. */
export const BRAZIL_RECEITA_INTAKE_FORBIDDEN_CONTENT_TOKENS: readonly string[] =
  BRAZIL_RECEITA_INTAKE_FORBIDDEN_CONTENT_PATTERNS.map((pattern) => pattern.token);

/** An address-shaped value: a narrow, non-anchored email-like pattern. Never matched on digits alone. */
const EMAIL_SHAPED_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Every forbidden token carried by `value`, in declaration order, plus an email-shaped match. */
function findForbiddenContent(value: string): readonly string[] {
  const tokenHits = BRAZIL_RECEITA_INTAKE_FORBIDDEN_CONTENT_PATTERNS.filter((pattern) =>
    pattern.caseSensitive
      ? value.includes(pattern.token)
      : value.toLowerCase().includes(pattern.token.toLowerCase()),
  ).map((pattern) => pattern.token);

  return EMAIL_SHAPED_PATTERN.test(value) ? [...tokenHits, 'address-shaped value'] : tokenHits;
}

// ─── Decision ids and helpers ─────────────────────────────────────────────────

/** The nine required decision ids, re-exported verbatim from 13I so the two catalogues cannot drift. */
export const BRAZIL_RECEITA_INTAKE_REQUIRED_DECISION_IDS: readonly BrazilReceitaControlledExecutionAuthorizationDecisionId[] =
  BRAZIL_RECEITA_HANDOFF_DECISION_IDS;

type DecisionId = BrazilReceitaControlledExecutionAuthorizationDecisionId;

/** The first decision entry naming `decisionId`, or `null` when none is present. */
function findIntakeDecision(
  intake: BrazilReceitaControlledExecutionAuthorizationIntake,
  decisionId: DecisionId,
): BrazilReceitaControlledExecutionAuthorizationIntakeDecision | null {
  return intake.decisions.find((decision) => decision.decisionId === decisionId) ?? null;
}

/**
 * The effective status of a decision: `missing` when no entry names it (or the entry itself declares
 * `missing`), and the entry's own value otherwise. Absent and explicitly-missing are treated identically
 * on purpose — a reviewer who never filled a field has not stated anything different from one who wrote
 * "missing" in it.
 */
function effectiveStatus(
  decision: BrazilReceitaControlledExecutionAuthorizationIntakeDecision | null,
): BrazilReceitaControlledExecutionAuthorizationIntakeDecisionValue {
  if (decision === null) return 'missing';
  return decision.decisionValue;
}

// ─── Hygiene checks (invalid content) ─────────────────────────────────────────

/** Every owner-supplied string field on an intake decision, in declaration order. */
const STRING_FIELDS: readonly (keyof BrazilReceitaControlledExecutionAuthorizationIntakeDecision)[] = [
  'reviewerReference',
  'decisionDate',
  'notes',
];

/**
 * Checks one present string field for hygiene: an empty, whitespace-only or placeholder value proves the
 * field was never completed, and forbidden content makes it unsafe to carry.
 */
function checkFieldHygiene(
  decisionId: DecisionId,
  field: string,
  value: unknown,
): readonly Finding[] {
  if (value === undefined || value === null) return [];

  if (typeof value !== 'string') {
    return [
      {
        findingId: CODES.fieldPlaceholder,
        severity: 'blocking',
        decisionId,
        description: `Intake decision ${decisionId} field ${field} must be a string.`,
      },
    ];
  }

  const findings: Finding[] = [];
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed === BRAZIL_RECEITA_INTAKE_PLACEHOLDER_TOKEN) {
    findings.push({
      findingId: CODES.fieldPlaceholder,
      severity: 'blocking',
      decisionId,
      description:
        trimmed.length === 0
          ? `Intake decision ${decisionId} field ${field} is empty or whitespace-only, so it was never completed.`
          : `Intake decision ${decisionId} field ${field} still holds the ${BRAZIL_RECEITA_INTAKE_PLACEHOLDER_TOKEN} placeholder.`,
    });
  }

  for (const forbidden of findForbiddenContent(value)) {
    findings.push({
      findingId: CODES.forbiddenContent,
      severity: 'blocking',
      decisionId,
      description: `Intake decision ${decisionId} field ${field} carries forbidden content (${forbidden}). Intake decisions must not embed real locations, hosts, addresses or credentials.`,
    });
  }

  return findings;
}

/** The three acknowledgements an `accepted` decision must state explicitly as `true`. */
const REQUIRED_ACKS: readonly (keyof BrazilReceitaControlledExecutionAuthorizationIntakeDecision)[] = [
  'acknowledgesSeparateAuthorizationRequired',
  'acknowledgesNoExecutionAuthorizationGranted',
  'acknowledgesNoGateApprovalByInference',
];

/**
 * Checks one intake decision entry for invalid content: field hygiene on every string field, an
 * unrecognized reviewer role, an invalid scope, and — for an `accepted` decision only — the three
 * required acknowledgements.
 */
function checkDecisionContent(
  decision: BrazilReceitaControlledExecutionAuthorizationIntakeDecision,
): readonly Finding[] {
  const values = decision as unknown as Record<string, unknown>;
  const findings: Finding[] = [];

  for (const field of STRING_FIELDS) {
    findings.push(...checkFieldHygiene(decision.decisionId, field, values[field]));
  }

  // The type declares `reviewerRole` as a closed union, but that is a compile-time promise only: a
  // decision entry assembled from anything other than a literal in this file (a hand-built object, or
  // eventually a real submission) can carry any string here, so who-approved-this must be checked at
  // runtime, exactly like the scope check just below it.
  if (!isBrazilReceitaIntakeReviewerRole(values.reviewerRole)) {
    findings.push({
      findingId: CODES.reviewerRoleInvalid,
      severity: 'blocking',
      decisionId: decision.decisionId,
      description: `Intake decision ${decision.decisionId} reviewerRole must be one of ${BRAZIL_RECEITA_INTAKE_REVIEWER_ROLES.join(', ')}.`,
    });
  }

  if (values.scope !== undefined && values.scope !== BRAZIL_RECEITA_INTAKE_SCOPE) {
    findings.push({
      findingId: CODES.scopeInvalid,
      severity: 'blocking',
      decisionId: decision.decisionId,
      description: `Intake decision ${decision.decisionId} may only carry the scope ${BRAZIL_RECEITA_INTAKE_SCOPE}.`,
    });
  }

  if (decision.decisionValue === 'accepted') {
    for (const ack of REQUIRED_ACKS) {
      if (values[ack] !== true) {
        findings.push({
          findingId: CODES.requiredAckMissing,
          severity: 'blocking',
          decisionId: decision.decisionId,
          description: `Intake decision ${decision.decisionId} is accepted but does not state ${ack} explicitly as true.`,
        });
      }
    }
  }

  return findings;
}

// ─── Inconsistency checks ─────────────────────────────────────────────────────

/**
 * Checks the four cross-decision consistency rules. An intake may not accept a downstream decision while
 * leaving the decision it depends on unresolved: doing so is exactly the "one approval implies the next"
 * failure the whole 13A–13J chain exists to prevent.
 */
function checkInconsistencies(
  intake: BrazilReceitaControlledExecutionAuthorizationIntake,
): { readonly inconsistentDecisions: readonly DecisionId[]; readonly findings: readonly Finding[] } {
  const status = (id: DecisionId) => effectiveStatus(findIntakeDecision(intake, id));
  const inconsistentDecisions: DecisionId[] = [];
  const findings: Finding[] = [];

  if (
    status('IMPORT_AUTHORIZATION') === 'accepted' &&
    status('FULL_JOIN_EXECUTION_AUTHORIZATION') !== 'accepted'
  ) {
    inconsistentDecisions.push('IMPORT_AUTHORIZATION');
    findings.push({
      findingId: CODES.inconsistentImportWithoutFullJoin,
      severity: 'blocking',
      decisionId: 'IMPORT_AUTHORIZATION',
      description:
        'IMPORT_AUTHORIZATION is accepted but FULL_JOIN_EXECUTION_AUTHORIZATION is not. Import authorization cannot stand in for full join authorization.',
    });
  }

  if (
    status('RUNTIME_AUTHORIZATION') === 'accepted' &&
    status('IMPORT_AUTHORIZATION') !== 'accepted'
  ) {
    inconsistentDecisions.push('RUNTIME_AUTHORIZATION');
    findings.push({
      findingId: CODES.inconsistentRuntimeWithoutImport,
      severity: 'blocking',
      decisionId: 'RUNTIME_AUTHORIZATION',
      description:
        'RUNTIME_AUTHORIZATION is accepted but IMPORT_AUTHORIZATION is not. Runtime authorization cannot stand in for import authorization.',
    });
  }

  if (
    status('AGENT1_AUTHORIZATION') === 'accepted' &&
    status('RUNTIME_AUTHORIZATION') !== 'accepted'
  ) {
    inconsistentDecisions.push('AGENT1_AUTHORIZATION');
    findings.push({
      findingId: CODES.inconsistentAgent1WithoutRuntime,
      severity: 'blocking',
      decisionId: 'AGENT1_AUTHORIZATION',
      description:
        'AGENT1_AUTHORIZATION is accepted but RUNTIME_AUTHORIZATION is not. Agent 1 authorization cannot stand in for runtime authorization.',
    });
  }

  const gatesAllAccepted =
    status('GATE_2_ROUTE_DECISION') === 'accepted' &&
    status('GATE_7_PRIVACY_SECURITY_DECISION') === 'accepted' &&
    status('CAP_INPUT_POLICY_APPROVAL') === 'accepted';

  if (
    status('CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION') === 'accepted' &&
    !gatesAllAccepted
  ) {
    inconsistentDecisions.push('CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION');
    findings.push({
      findingId: CODES.inconsistentExecutionWithoutGates,
      severity: 'blocking',
      decisionId: 'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      description:
        'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION is accepted but GATE_2_ROUTE_DECISION, GATE_7_PRIVACY_SECURITY_DECISION and CAP_INPUT_POLICY_APPROVAL are not all accepted. A controlled execution attempt cannot be authorized ahead of its gates.',
    });
  }

  return { inconsistentDecisions, findings };
}

// ─── Result shape ─────────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionAuthorizationIntakeValidationStatus =
  | 'intake_complete_synthetic_only'
  | 'intake_incomplete'
  | 'intake_rejected'
  | 'intake_deferred'
  | 'intake_inconsistent'
  | 'intake_invalid';

/**
 * Everything this module can never assert, in any code path. Frozen as literal `false` so the result
 * type itself forbids a `true` — a future edit that tried to grant one would have to change this
 * module's exported type, which no intake is authorized to do.
 */
export const BRAZIL_RECEITA_INTAKE_WITHHELD = {
  executionStarted: false,
  executionAttempted: false,
  executionAuthorized: false,
  realDataExecutionAuthorized: false,
  realDataAccessed: false,
  pathInputAccepted: false,
  manifestRead: false,
  csvRead: false,
  zipRead: false,
  rowReads: false,
  joinExecuted: false,
  coverageExecuted: false,
  importExecuted: false,
  supabaseWrites: false,
  runtimeActivated: false,
  agent1Activated: false,
  providerCalls: false,

  gate2Approved: false,
  gate7Approved: false,
  capInputPolicyApproved: false,
  controlledExecutionAttemptAuthorized: false,

  fullJoinAuthorized: false,
  importAuthorized: false,
  runtimeAuthorized: false,
  agent1Authorized: false,
} as const;

/** The withheld keys, for callers that sweep the whole set. */
export const BRAZIL_RECEITA_INTAKE_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_INTAKE_WITHHELD)[] =
  [
    'executionStarted',
    'executionAttempted',
    'executionAuthorized',
    'realDataExecutionAuthorized',
    'realDataAccessed',
    'pathInputAccepted',
    'manifestRead',
    'csvRead',
    'zipRead',
    'rowReads',
    'joinExecuted',
    'coverageExecuted',
    'importExecuted',
    'supabaseWrites',
    'runtimeActivated',
    'agent1Activated',
    'providerCalls',
    'gate2Approved',
    'gate7Approved',
    'capInputPolicyApproved',
    'controlledExecutionAttemptAuthorized',
    'fullJoinAuthorized',
    'importAuthorized',
    'runtimeAuthorized',
    'agent1Authorized',
  ] as const;

/**
 * Every safety assertion this module states about its own behaviour. The last one is specific to this
 * layer: intake VALIDATION is a distinct act from intake EXECUTION, and this list says so explicitly, so
 * no reader mistakes a validated intake for an executed one.
 */
export const BRAZIL_RECEITA_INTAKE_SAFETY_ASSERTIONS: readonly string[] = [
  'NO_REAL_DATA_ACCESSED',
  'NO_PATH_INPUT_ACCEPTED',
  'NO_MANIFEST_READ',
  'NO_CSV_OR_ZIP_READ',
  'NO_ROW_READS',
  'NO_JOIN_EXECUTED',
  'NO_COVERAGE_EXECUTED',
  'NO_IMPORT_EXECUTED',
  'NO_SUPABASE_WRITES',
  'NO_RUNTIME_ACTIVATED',
  'NO_AGENT1_ACTIVATED',
  'NO_PROVIDER_CALLS',
  'NO_GATE_APPROVAL_GRANTED',
  'NO_PRODUCTION_READINESS_GRANTED',
  'NO_EXECUTION_AUTHORIZATION_GRANTED',
  'INTAKE_VALIDATION_SYNTHETIC_ONLY',
] as const;

/** The actions that stay with a human no matter how complete the synthetic intake is. */
export const BRAZIL_RECEITA_INTAKE_REQUIRED_HUMAN_ACTIONS: readonly string[] = [
  'HUMAN_REVIEW_AUTHORIZATION_INTAKE_VALIDATION',
  'REAL_OWNER_INTAKE_REQUIRED',
  'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
  'SEPARATE_GATE_2_APPROVAL_REQUIRED',
  'SEPARATE_GATE_7_APPROVAL_REQUIRED',
  'SEPARATE_CAP_INPUT_APPROVAL_REQUIRED',
  'SEPARATE_CONTROLLED_EXECUTION_AUTHORIZATION_REQUIRED',
  'SEPARATE_FULL_JOIN_AUTHORIZATION_REQUIRED',
  'SEPARATE_IMPORT_AUTHORIZATION_REQUIRED',
  'SEPARATE_RUNTIME_AUTHORIZATION_REQUIRED',
  'SEPARATE_AGENT1_AUTHORIZATION_REQUIRED',
] as const;

export type BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult = {
  resultType: typeof BRAZIL_RECEITA_INTAKE_VALIDATION_RESULT_TYPE;
  version: typeof BRAZIL_RECEITA_INTAKE_VALIDATION_VERSION;
  generatedAt: typeof BRAZIL_RECEITA_INTAKE_STATIC_TIMESTAMP;
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  reviewDecisionValue: BrazilReceitaControlledExecutionReviewDecisionValue | 'unrecognized';
  intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;

  status: BrazilReceitaControlledExecutionAuthorizationIntakeValidationStatus;
  goNoGo: 'NO_GO';
  syntheticOnly: true;
  intakeValidated: true;
  syntheticIntakeComplete: boolean;
  ownerDecisionsCapturedSynthetic: boolean;
  ownerDecisionsValidSynthetic: boolean;

  executionStarted: false;
  executionAttempted: false;
  executionAuthorized: false;
  realDataExecutionAuthorized: false;
  realDataAccessed: false;
  pathInputAccepted: false;
  manifestRead: false;
  csvRead: false;
  zipRead: false;
  rowReads: false;
  joinExecuted: false;
  coverageExecuted: false;
  importExecuted: false;
  supabaseWrites: false;
  runtimeActivated: false;
  agent1Activated: false;
  providerCalls: false;

  gate2Approved: false;
  gate7Approved: false;
  capInputPolicyApproved: false;
  controlledExecutionAttemptAuthorized: false;

  fullJoinAuthorized: false;
  importAuthorized: false;
  runtimeAuthorized: false;
  agent1Authorized: false;

  brazilReadiness: 'blocked';
  readinessConclusion: typeof BRAZIL_RECEITA_INTAKE_READINESS_CONCLUSION;

  handoffPacket: BrazilReceitaControlledExecutionAuthorizationHandoffPacket;
  intake: BrazilReceitaControlledExecutionAuthorizationIntake;

  missingDecisions: BrazilReceitaControlledExecutionAuthorizationDecisionId[];
  rejectedDecisions: BrazilReceitaControlledExecutionAuthorizationDecisionId[];
  deferredDecisions: BrazilReceitaControlledExecutionAuthorizationDecisionId[];
  inconsistentDecisions: BrazilReceitaControlledExecutionAuthorizationDecisionId[];

  findings: BrazilReceitaControlledExecutionAuthorizationIntakeValidationFinding[];
  safetyAssertions: string[];
  requiredNextHumanActions: string[];

  disclaimer: typeof BRAZIL_RECEITA_INTAKE_DISCLAIMER;
};

// ─── Validation entry point ───────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionAuthorizationIntakeValidationInput = {
  readonly fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly reviewDecisionValue: BrazilReceitaControlledExecutionReviewDecisionValue;
  readonly intake: BrazilReceitaControlledExecutionAuthorizationIntake;
};

/**
 * Finding-code precedence, most severe first. A single intake can trip more than one category at once
 * (a placeholder value AND a missing decision, for instance); the STATUS reported is always the most
 * severe category present, so a reader scanning only `status` never misses the worst problem.
 */
const INVALID_CODES: readonly string[] = [
  CODES.fieldPlaceholder,
  CODES.scopeInvalid,
  CODES.requiredAckMissing,
  CODES.forbiddenContent,
  CODES.reviewerRoleInvalid,
];
const INCONSISTENT_CODES: readonly string[] = [
  CODES.inconsistentImportWithoutFullJoin,
  CODES.inconsistentRuntimeWithoutImport,
  CODES.inconsistentAgent1WithoutRuntime,
  CODES.inconsistentExecutionWithoutGates,
];

/**
 * Validates a SYNTHETIC controlled execution authorization intake against the nine decisions BR-SOURCE-
 * 13I lists as pending.
 *
 * The status precedence — invalid, then inconsistent, then rejected, then deferred, then incomplete,
 * then complete — is deliberate: an intake with unsafe content is worse than one that is merely
 * incomplete, and an intake whose two decisions contradict each other is worse than one that plainly
 * rejected a single decision. `complete_synthetic_accept` is the only fixture that can reach
 * `intake_complete_synthetic_only`, and even there `goNoGo` stays `NO_GO`, `brazilReadiness` stays
 * `blocked`, and every gate, cap, execution and activation field stays `false`: intake completeness is a
 * fact about a DOCUMENT, never a grant of an AUTHORIZATION.
 */
export function validateBrazilReceitaControlledExecutionAuthorizationIntake(
  input: BrazilReceitaControlledExecutionAuthorizationIntakeValidationInput,
): BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult {
  const handoffPacket = buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket({
    fixtureName: input.fixtureName,
    reviewDecisionValue: input.reviewDecisionValue,
  });

  const { intake } = input;

  const missingDecisions: DecisionId[] = [];
  const rejectedDecisions: DecisionId[] = [];
  const deferredDecisions: DecisionId[] = [];
  const findings: Finding[] = [];

  for (const decisionId of BRAZIL_RECEITA_INTAKE_REQUIRED_DECISION_IDS) {
    const decision = findIntakeDecision(intake, decisionId);
    const status = effectiveStatus(decision);

    if (status === 'missing') {
      missingDecisions.push(decisionId);
      findings.push({
        findingId: CODES.decisionMissing,
        severity: 'blocking',
        decisionId,
        description: `Intake decision ${decisionId} is missing. The input itself has not arrived.`,
      });
      continue;
    }

    if (status === 'rejected') {
      rejectedDecisions.push(decisionId);
      findings.push({
        findingId: CODES.decisionRejected,
        severity: 'blocking',
        decisionId,
        description: `Intake decision ${decisionId} was rejected.`,
      });
    }

    if (status === 'deferred') {
      deferredDecisions.push(decisionId);
      findings.push({
        findingId: CODES.decisionDeferred,
        severity: 'blocking',
        decisionId,
        description: `Intake decision ${decisionId} was deferred.`,
      });
    }

    if (decision !== null) {
      findings.push(...checkDecisionContent(decision));
    }
  }

  const { inconsistentDecisions, findings: inconsistencyFindings } = checkInconsistencies(intake);
  findings.push(...inconsistencyFindings);

  const findingCodes = new Set(findings.map((finding) => finding.findingId));
  const hasInvalid = INVALID_CODES.some((code) => findingCodes.has(code));
  const hasInconsistent = INCONSISTENT_CODES.some((code) => findingCodes.has(code));
  const hasRejected = rejectedDecisions.length > 0;
  const hasDeferred = deferredDecisions.length > 0;
  const hasMissing = missingDecisions.length > 0;

  const status: BrazilReceitaControlledExecutionAuthorizationIntakeValidationStatus = hasInvalid
    ? 'intake_invalid'
    : hasInconsistent
      ? 'intake_inconsistent'
      : hasRejected
        ? 'intake_rejected'
        : hasDeferred
          ? 'intake_deferred'
          : hasMissing
            ? 'intake_incomplete'
            : 'intake_complete_synthetic_only';

  const syntheticIntakeComplete = status === 'intake_complete_synthetic_only';
  const ownerDecisionsCapturedSynthetic = !hasMissing;
  const ownerDecisionsValidSynthetic = syntheticIntakeComplete;

  return {
    resultType: BRAZIL_RECEITA_INTAKE_VALIDATION_RESULT_TYPE,
    version: BRAZIL_RECEITA_INTAKE_VALIDATION_VERSION,
    generatedAt: BRAZIL_RECEITA_INTAKE_STATIC_TIMESTAMP,
    fixture: input.fixtureName,
    reviewDecisionValue: handoffPacket.reviewDecisionValue,
    intakeFixture: intake.intakeFixture,

    status,
    goNoGo: 'NO_GO',
    syntheticOnly: true,
    intakeValidated: true,
    syntheticIntakeComplete,
    ownerDecisionsCapturedSynthetic,
    ownerDecisionsValidSynthetic,

    ...BRAZIL_RECEITA_INTAKE_WITHHELD,

    brazilReadiness: 'blocked',
    readinessConclusion: BRAZIL_RECEITA_INTAKE_READINESS_CONCLUSION,

    handoffPacket,
    intake,

    missingDecisions,
    rejectedDecisions,
    deferredDecisions,
    inconsistentDecisions: [...inconsistentDecisions],

    findings,
    safetyAssertions: [...BRAZIL_RECEITA_INTAKE_SAFETY_ASSERTIONS],
    requiredNextHumanActions: [...BRAZIL_RECEITA_INTAKE_REQUIRED_HUMAN_ACTIONS],

    disclaimer: BRAZIL_RECEITA_INTAKE_DISCLAIMER,
  };
}

// ─── Fixture builders ─────────────────────────────────────────────────────────

/** The two synthetic dates every fixture decision uses. Fixed literals, never a clock reading. */
const SYNTHETIC_DECISION_DATE = '2026-01-01';

/** A forbidden-content marker assembled at runtime, so this file carries no path-shaped literal. */
function buildForbiddenLocalPathMarker(): string {
  return ['', 'Users', ''].join('/');
}

/** Builds a fully accepted decision entry for `decisionId`, numbered for a stable reviewer reference. */
function buildAcceptedDecision(
  decisionId: DecisionId,
  ordinal: number,
): BrazilReceitaControlledExecutionAuthorizationIntakeDecision {
  const padded = String(ordinal).padStart(2, '0');

  return {
    decisionId,
    decisionValue: 'accepted',
    reviewerRole: 'synthetic_reviewer',
    reviewerReference: `SYNTHETIC-REVIEWER-${padded}`,
    decisionDate: SYNTHETIC_DECISION_DATE,
    scope: BRAZIL_RECEITA_INTAKE_SCOPE,
    acknowledgesSeparateAuthorizationRequired: true,
    acknowledgesNoExecutionAuthorizationGranted: true,
    acknowledgesNoGateApprovalByInference: true,
  };
}

/** All nine decisions, accepted, in the same order 13I lists them. Never mutated by a caller. */
function buildAllAcceptedDecisions(): BrazilReceitaControlledExecutionAuthorizationIntakeDecision[] {
  return BRAZIL_RECEITA_INTAKE_REQUIRED_DECISION_IDS.map((decisionId, index) =>
    buildAcceptedDecision(decisionId, index + 1),
  );
}

/** Returns a copy of the fully accepted set with one decision entry omitted entirely. */
function withoutDecision(
  decisionId: DecisionId,
): BrazilReceitaControlledExecutionAuthorizationIntakeDecision[] {
  return buildAllAcceptedDecisions().filter((decision) => decision.decisionId !== decisionId);
}

/** Returns a copy of the fully accepted set with one decision entry patched. Never mutates the source. */
function withDecisionPatch(
  decisionId: DecisionId,
  patch: Partial<BrazilReceitaControlledExecutionAuthorizationIntakeDecision>,
): BrazilReceitaControlledExecutionAuthorizationIntakeDecision[] {
  return buildAllAcceptedDecisions().map((decision) =>
    decision.decisionId === decisionId ? { ...decision, ...patch } : decision,
  );
}

/**
 * The structural dependency edges the four consistency checks encode: `DIRECT_DEPENDENTS[X]` is every
 * decision whose acceptance is inconsistent once X is not accepted. Used only by the `missing_*` fixture
 * builders below, so an isolated "this one decision never arrived" fixture cannot ALSO read as
 * "these two decisions contradict each other" — that failure mode is what the `inconsistent_*` fixtures
 * exist to isolate instead, deliberately built without this cascade.
 */
const DIRECT_DEPENDENTS: Partial<Record<DecisionId, readonly DecisionId[]>> = {
  GATE_2_ROUTE_DECISION: ['CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'],
  GATE_7_PRIVACY_SECURITY_DECISION: ['CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'],
  CAP_INPUT_POLICY_APPROVAL: ['CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'],
  FULL_JOIN_EXECUTION_AUTHORIZATION: ['IMPORT_AUTHORIZATION'],
  IMPORT_AUTHORIZATION: ['RUNTIME_AUTHORIZATION'],
  RUNTIME_AUTHORIZATION: ['AGENT1_AUTHORIZATION'],
};

/** Every decision structurally downstream of `decisionId`, direct and transitive, in discovery order. */
function transitiveDependents(decisionId: DecisionId): DecisionId[] {
  const found: DecisionId[] = [];
  const queue: DecisionId[] = [decisionId];

  while (queue.length > 0) {
    const current = queue.shift() as DecisionId;
    for (const dependent of DIRECT_DEPENDENTS[current] ?? []) {
      if (!found.includes(dependent)) {
        found.push(dependent);
        queue.push(dependent);
      }
    }
  }

  return found;
}

/**
 * Returns a copy of the fully accepted set with `decisionId`, and everything structurally downstream of
 * it, omitted entirely. Used to build a `missing_*` fixture that reports ONLY a missing decision — never
 * an incidental inconsistency finding produced by a downstream decision that is still (nonsensically)
 * marked accepted.
 */
function withoutDecisionAndDependents(
  decisionId: DecisionId,
): BrazilReceitaControlledExecutionAuthorizationIntakeDecision[] {
  const removed = new Set<DecisionId>([decisionId, ...transitiveDependents(decisionId)]);
  return buildAllAcceptedDecisions().filter((decision) => !removed.has(decision.decisionId));
}

/**
 * Returns a copy of the fully accepted set with `decisionId` rejected or deferred, and everything
 * structurally downstream of it omitted — for the same reason as {@link withoutDecisionAndDependents}: a
 * `rejected_*` or `deferred_*` fixture should report ONLY that rejection or deferral, never an incidental
 * inconsistency from a decision that depends on it and was left (nonsensically) accepted.
 */
function withDecisionRejectedOrDeferred(
  decisionId: DecisionId,
  decisionValue: 'rejected' | 'deferred',
): BrazilReceitaControlledExecutionAuthorizationIntakeDecision[] {
  const dependentsRemoved = new Set<DecisionId>(transitiveDependents(decisionId));

  return buildAllAcceptedDecisions()
    .filter((decision) => !dependentsRemoved.has(decision.decisionId))
    .map((decision) =>
      decision.decisionId === decisionId
        ? {
            ...decision,
            decisionValue,
            acknowledgesSeparateAuthorizationRequired: false,
            acknowledgesNoExecutionAuthorizationGranted: false,
            acknowledgesNoGateApprovalByInference: false,
          }
        : decision,
    );
}

function buildIntake(
  intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture,
  decisions: BrazilReceitaControlledExecutionAuthorizationIntakeDecision[],
): BrazilReceitaControlledExecutionAuthorizationIntake {
  return {
    intakeType: BRAZIL_RECEITA_INTAKE_TYPE,
    version: 1,
    syntheticOnly: true,
    intakeFixture,
    decisions,
  };
}

/**
 * Builds the named synthetic intake fixture.
 *
 * The returned value is synthetic input for this module's own validator — never an owner decision, never
 * evidence, and never an authorization. Even `complete_synthetic_accept`, the fixture built to look as
 * finished as an intake can look, is not privileged in the validator: it is not passed anywhere that
 * skips a check, and its "acceptance" of all nine decisions changes no boolean this module withholds.
 *
 * @throws Error when `intakeFixture` is not one of {@link BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES}.
 */
export function buildBrazilReceitaControlledExecutionAuthorizationIntakeFixture(input: {
  readonly intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;
}): BrazilReceitaControlledExecutionAuthorizationIntake {
  const { intakeFixture } = input;

  switch (intakeFixture) {
    // The only fixture built to look as complete as an intake can look. It still validates to a
    // synthetic-only NO_GO: completeness is a fact about the document, not a grant.
    case 'complete_synthetic_accept':
      return buildIntake(intakeFixture, buildAllAcceptedDecisions());

    // Every `missing_*` fixture below uses the dependents-aware cascade, so it reports ONLY the missing
    // decision (and, where the domain requires it, the decisions structurally downstream of it) — never
    // an incidental inconsistency finding from a downstream decision left nonsensically "accepted".
    case 'missing_owner_completion':
      return buildIntake(
        intakeFixture,
        withoutDecisionAndDependents('OWNER_COMPLETION_RESUBMISSION'),
      );

    case 'missing_gate_2':
      return buildIntake(intakeFixture, withoutDecisionAndDependents('GATE_2_ROUTE_DECISION'));

    case 'missing_gate_7':
      return buildIntake(
        intakeFixture,
        withoutDecisionAndDependents('GATE_7_PRIVACY_SECURITY_DECISION'),
      );

    case 'missing_cap_input':
      return buildIntake(intakeFixture, withoutDecisionAndDependents('CAP_INPUT_POLICY_APPROVAL'));

    case 'missing_controlled_execution':
      return buildIntake(
        intakeFixture,
        withoutDecisionAndDependents('CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'),
      );

    case 'missing_full_join':
      return buildIntake(
        intakeFixture,
        withoutDecisionAndDependents('FULL_JOIN_EXECUTION_AUTHORIZATION'),
      );

    case 'missing_import':
      return buildIntake(intakeFixture, withoutDecisionAndDependents('IMPORT_AUTHORIZATION'));

    case 'missing_runtime':
      return buildIntake(intakeFixture, withoutDecisionAndDependents('RUNTIME_AUTHORIZATION'));

    case 'missing_agent1':
      return buildIntake(intakeFixture, withoutDecisionAndDependents('AGENT1_AUTHORIZATION'));

    // An explicit rejection, over an otherwise fully answered intake. CONTROLLED_EXECUTION_ATTEMPT_
    // AUTHORIZATION — the one decision structurally downstream of GATE-2 — is cascaded away too, so this
    // fixture reports the rejection alone and never an incidental gate inconsistency.
    case 'rejected_gate_2':
      return buildIntake(
        intakeFixture,
        withDecisionRejectedOrDeferred('GATE_2_ROUTE_DECISION', 'rejected'),
      );

    // An explicit deferral, over an otherwise fully answered intake. Same cascade, for the same reason.
    case 'deferred_gate_7':
      return buildIntake(
        intakeFixture,
        withDecisionRejectedOrDeferred('GATE_7_PRIVACY_SECURITY_DECISION', 'deferred'),
      );

    // IMPORT_AUTHORIZATION accepted while FULL_JOIN_EXECUTION_AUTHORIZATION never arrived — the exact
    // "one approval implies the next" failure this validator exists to catch.
    case 'inconsistent_import_without_full_join':
      return buildIntake(
        intakeFixture,
        withoutDecision('FULL_JOIN_EXECUTION_AUTHORIZATION'),
      );

    // AGENT1_AUTHORIZATION accepted while RUNTIME_AUTHORIZATION never arrived.
    case 'inconsistent_agent1_without_runtime':
      return buildIntake(intakeFixture, withoutDecision('RUNTIME_AUTHORIZATION'));

    // A field that was never completed still holds the packet placeholder.
    case 'placeholder_values':
      return buildIntake(
        intakeFixture,
        withDecisionPatch('OWNER_COMPLETION_RESUBMISSION', {
          reviewerReference: BRAZIL_RECEITA_INTAKE_PLACEHOLDER_TOKEN,
        }),
      );

    // A field carrying an absolute local path — refused as unsafe content, not stored.
    case 'forbidden_content':
      return buildIntake(
        intakeFixture,
        withDecisionPatch('OWNER_COMPLETION_RESUBMISSION', {
          notes: `resubmission staged at${buildForbiddenLocalPathMarker()}intake`,
        }),
      );

    // A reviewerRole outside the five recognized roles — the shape a real, hand-assembled submission
    // (never one built by this module's own literals) could get wrong, and the one field this module did
    // not check at runtime until this fixture was added to prove it now does.
    case 'invalid_reviewer_role':
      return buildIntake(
        intakeFixture,
        withDecisionPatch('OWNER_COMPLETION_RESUBMISSION', {
          reviewerRole: 'unspecified' as BrazilReceitaControlledExecutionAuthorizationIntakeReviewerRole,
        }),
      );

    default: {
      const unknownName: string = intakeFixture;
      throw new Error(
        `${BRAZIL_RECEITA_INTAKE_UNKNOWN_FIXTURE_CODE}: unknown intake fixture "${unknownName}". Known intake fixtures: ${BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES.join(', ')}.`,
      );
    }
  }
}

// ─── Convenience builder ──────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionAuthorizationIntakeValidationResultInput = {
  readonly fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly reviewDecisionValue: BrazilReceitaControlledExecutionReviewDecisionValue;
  readonly intakeFixture: BrazilReceitaControlledExecutionAuthorizationIntakeFixture;
};

/**
 * Builds the named intake fixture and validates it in one call, over the named 13C fixture and 13E
 * review decision.
 *
 * @throws Error when `fixtureName` is not a known 13C fixture (raised by 13I, through 13B–13H), or when
 *   `intakeFixture` is not one of {@link BRAZIL_RECEITA_INTAKE_FIXTURE_NAMES}.
 */
export function buildBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
  input: BrazilReceitaControlledExecutionAuthorizationIntakeValidationResultInput,
): BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult {
  const intake = buildBrazilReceitaControlledExecutionAuthorizationIntakeFixture({
    intakeFixture: input.intakeFixture,
  });

  return validateBrazilReceitaControlledExecutionAuthorizationIntake({
    fixtureName: input.fixtureName,
    reviewDecisionValue: input.reviewDecisionValue,
    intake,
  });
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

/** Booleans read as YES/NO, so a reader never has to parse a JSON literal. */
function yesNo(value: boolean): 'YES' | 'NO' {
  return value ? 'YES' : 'NO';
}

function renderList(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? ['- none'] : lines.map((line) => `- ${line}`);
}

function renderFindings(findings: readonly Finding[]): readonly string[] {
  if (findings.length === 0) return ['- none'];

  return findings.map((finding) => {
    const where = finding.decisionId === undefined ? '' : ` (${finding.decisionId})`;
    return `- \`${finding.findingId}\` [${finding.severity}]${where}: ${finding.description}`;
  });
}

function renderDecision(
  decision: BrazilReceitaControlledExecutionAuthorizationIntakeDecision,
): readonly string[] {
  return [
    `- \`${decision.decisionId}\`: **${decision.decisionValue}** (${decision.reviewerRole}, ${decision.reviewerReference}, ${decision.decisionDate})`,
  ];
}

/**
 * Renders the result as Markdown. Pure and deterministic: every line is derived from the result in a
 * fixed order, so the same result always renders byte-identically.
 */
export function renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(
  result: BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
): string {
  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution authorization intake validation',
    '',
    `- Result type: \`${result.resultType}\``,
    `- Version: ${result.version}`,
    `- Generated at: \`${result.generatedAt}\``,
    `- Fixture: \`${result.fixture}\``,
    `- Review decision: **${result.reviewDecisionValue}**`,
    `- Intake fixture: \`${result.intakeFixture}\``,
    `- Status: **${result.status}**`,
    `- Go / No-Go: **${result.goNoGo}**`,
    `- Synthetic only: ${yesNo(result.syntheticOnly)}`,
    `- Intake validated: ${yesNo(result.intakeValidated)}`,
    `- Synthetic intake complete: ${yesNo(result.syntheticIntakeComplete)}`,
    `- Owner decisions captured (synthetic): ${yesNo(result.ownerDecisionsCapturedSynthetic)}`,
    `- Owner decisions valid (synthetic): ${yesNo(result.ownerDecisionsValidSynthetic)}`,
    `- Brazil readiness: **${result.brazilReadiness}**`,
    '',
    '## The question this document does NOT answer',
    '',
    'A completed intake is a statement about a DOCUMENT. It is never a statement about an AUTHORIZATION.',
    'Even the most complete synthetic intake this module can validate leaves every gate unapproved and',
    'every execution, import, runtime and Agent 1 path closed.',
    '',
    '## Intake decisions',
    '',
    ...result.intake.decisions.flatMap(renderDecision),
    '',
    '## Missing decisions',
    '',
    ...renderList(result.missingDecisions),
    '',
    '## Rejected decisions',
    '',
    ...renderList(result.rejectedDecisions),
    '',
    '## Deferred decisions',
    '',
    ...renderList(result.deferredDecisions),
    '',
    '## Inconsistent decisions',
    '',
    ...renderList(result.inconsistentDecisions),
    '',
    '## State and authorizations withheld by this validation',
    '',
    'Every row below is withheld by construction. Validating an intake — or reading one — cannot change a',
    'single one of them.',
    '',
    '| State or authorization | Value |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_INTAKE_WITHHELD_KEYS.map((key) => `| ${key} | ${yesNo(result[key])} |`),
    '',
    '## Findings',
    '',
    ...renderFindings(result.findings),
    '',
    '## Safety assertions',
    '',
    ...renderList(result.safetyAssertions),
    '',
    '## Required next human actions',
    '',
    ...result.requiredNextHumanActions.map((action, index) => `${index + 1}. \`${action}\``),
    '',
    '## Handoff packet this validation was checked against (BR-SOURCE-13I)',
    '',
    `- Packet type: \`${result.handoffPacket.packetType}\``,
    `- Packet status: \`${result.handoffPacket.status}\``,
    `- Packet Go / No-Go: \`${result.handoffPacket.goNoGo}\``,
    `- Packet authorization status: \`${result.handoffPacket.authorizationStatus}\``,
    `- Packet disclaimer: ${result.handoffPacket.disclaimer}`,
    '',
    '## Conclusion',
    '',
    `- Readiness conclusion: **${result.readinessConclusion}**`,
    '',
    result.disclaimer,
    '',
    'Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes the result in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionAuthorizationIntakeValidationResult(
  result: BrazilReceitaControlledExecutionAuthorizationIntakeValidationResult,
  format: BrazilReceitaControlledExecutionAuthorizationIntakeFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionAuthorizationIntakeValidationMarkdown(result);
  }

  return pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
}
