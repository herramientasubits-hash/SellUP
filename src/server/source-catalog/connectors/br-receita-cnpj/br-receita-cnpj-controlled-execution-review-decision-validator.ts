/**
 * BR Receita CNPJ — controlled execution review decision validator (BR-SOURCE-13E).
 *
 * BR-SOURCE-13D produces the artefact a human reviewer is asked to read: a request packet that may
 * reach `ready_for_review`. What the chain still could not express is the reviewer's ANSWER. A human
 * who reads a packet says one of three things — approve, reject, defer — and until now that answer had
 * nowhere to live and no rule to check it against.
 *
 * 13E is that check:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A review decision may say "approve".
 *   An approval may NEVER say "execute".
 *
 *   Review approval is not execution authorization.
 *
 * `approve` names a DOCUMENT transition and nothing else: a human read a synthetic packet and agreed
 * that the request may advance to a future PLANNING / REVIEW step for a controlled execution attempt.
 * It is not an owner decision, not a gate approval, not a cap approval, and not permission to read a
 * byte of the dataset. The ten permission fields and the four approval fields on the result are typed
 * as the literal `false`, so no caller — and no future edit — can flip one without changing this
 * module's public type.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *   - re-implements 13A's, 13B's or 13D's rules; the packet verdict it reads was produced by them.
 *
 * It is a pure function: same packet and same decision, same result, no side effects, no mutation of
 * the input, no clock and no randomness.
 */

import {
  BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER,
  BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP,
  BRAZIL_RECEITA_REQUEST_PACKET_TYPE,
  BRAZIL_RECEITA_REQUEST_PACKET_VERSION,
  BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATION_KEYS,
  buildBrazilReceitaControlledExecutionRequestPacket,
  type BrazilReceitaControlledExecutionRequestPacket,
  type BrazilReceitaRequestPacketFormat,
} from './br-receita-cnpj-controlled-execution-request-packet-generator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The three positions a human reviewer may take on a 13D packet. */
export type BrazilReceitaControlledExecutionReviewDecisionValue = 'approve' | 'reject' | 'defer';

/** Every recognized decision value, in documentation order. The source of truth for callers. */
export const BRAZIL_RECEITA_REVIEW_DECISION_VALUES: readonly BrazilReceitaControlledExecutionReviewDecisionValue[] =
  ['approve', 'reject', 'defer'] as const;

/**
 * The only approval scope this validator accepts. A reviewer who approves is approving a SYNTHETIC
 * review and nothing wider; any other scope is refused rather than reinterpreted.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_APPROVAL_SCOPE = 'synthetic_review_only' as const;

/**
 * The 11W…12B placeholder token, restated here because this module imports 13D only. Its presence in
 * a field proves the field was never completed. The accompanying test asserts it still equals 13A's
 * exported constant, so a rename cannot drift.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN = 'TBD_BY_OWNER' as const;

/** The sentence that must accompany every review decision result, including an approval. */
export const BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER =
  'Review approval is not execution authorization.' as const;

/** Every finding code this validator can emit. The single source of truth for callers. */
export const BRAZIL_RECEITA_REVIEW_DECISION_FINDING_CODES = {
  inputMissing: 'REVIEW_DECISION_INPUT_MISSING',
  packetMissing: 'REVIEW_PACKET_MISSING',
  packetInvalid: 'REVIEW_PACKET_INVALID',
  packetNotReady: 'REVIEW_PACKET_NOT_READY',
  packetAuthorizationNotFalse: 'REVIEW_PACKET_AUTHORIZATION_FIELD_NOT_FALSE',
  packetDisclaimerMissing: 'REVIEW_PACKET_DISCLAIMER_MISSING',
  decisionMissing: 'REVIEW_DECISION_MISSING',
  fieldPlaceholder: 'REVIEW_DECISION_FIELD_PLACEHOLDER',
  forbiddenContent: 'REVIEW_DECISION_FORBIDDEN_CONTENT',
  valueMissing: 'REVIEW_DECISION_VALUE_MISSING',
  valueUnrecognized: 'REVIEW_DECISION_VALUE_UNRECOGNIZED',
  rejected: 'REVIEW_DECISION_REJECTED',
  deferred: 'REVIEW_DECISION_DEFERRED',
  requiredFieldMissing: 'REVIEW_DECISION_REQUIRED_FIELD_MISSING',
  requiredAckMissing: 'REVIEW_DECISION_REQUIRED_ACK_MISSING',
  approvalScopeInvalid: 'REVIEW_DECISION_APPROVAL_SCOPE_INVALID',
  packetMismatch: 'REVIEW_DECISION_PACKET_MISMATCH',
  isNotExecutionAuthorization: 'REVIEW_DECISION_IS_NOT_EXECUTION_AUTHORIZATION',
} as const;

const CODES = BRAZIL_RECEITA_REVIEW_DECISION_FINDING_CODES;

// ─── Unsafe content ───────────────────────────────────────────────────────────

/**
 * Assembles a forbidden token from harmless parts, so this source file contains no path-, host- or
 * credential-shaped literal for a secret scanner (or a reader) to trip over. The accompanying test
 * rebuilds every expected token the same way and asserts the list has not drifted.
 */
function token(...parts: readonly string[]): string {
  return parts.join('');
}

/**
 * Content a review decision must never carry. Matching is substring-based, deliberately narrow, and
 * never anchored on digits — a `decisionDate` must survive untouched.
 *
 * `caseSensitive` is set per pattern rather than globally: the three credential prefixes only ever
 * appear lowercase, and folding their case would reject ordinary prose. Location, host and env-name
 * markers are folded, since a real leak does not care about capitalization.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_FORBIDDEN_CONTENT_PATTERNS: readonly {
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
  { token: '@', caseSensitive: false, reason: 'address-shaped value' },
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
export const BRAZIL_RECEITA_REVIEW_DECISION_FORBIDDEN_CONTENT_TOKENS: readonly string[] =
  BRAZIL_RECEITA_REVIEW_DECISION_FORBIDDEN_CONTENT_PATTERNS.map((pattern) => pattern.token);

// ─── Decision shape ───────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionReviewDecision = {
  decisionValue?: BrazilReceitaControlledExecutionReviewDecisionValue;
  reviewerRole?: string;
  reviewerReference?: string;
  decisionDate?: string;
  expirationOrReviewDate?: string;
  reviewedPacketType?: string;
  reviewedPacketVersion?: 1;
  reviewedFixture?: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  approvalScope?: 'synthetic_review_only';
  requiredHumanDecisionAcknowledged?: boolean;
  readyForReviewIsNotReadyForExecutionAccepted?: boolean;
  syntheticGoIsNotExecutionAuthorizationAccepted?: boolean;
  noRealDataExecutionAccepted?: boolean;
  noManifestReadAccepted?: boolean;
  noCsvZipReadAccepted?: boolean;
  noRowReadsAccepted?: boolean;
  noImportAccepted?: boolean;
  noSupabaseWritesAccepted?: boolean;
  noRuntimeAccepted?: boolean;
  noAgent1Accepted?: boolean;
  noProviderCallsAccepted?: boolean;
  stopConditionsAccepted?: boolean;
};

export type BrazilReceitaControlledExecutionReviewDecisionValidationFinding = {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  field?: string;
};

export type BrazilReceitaControlledExecutionReviewDecisionValidationInput = {
  packet?: BrazilReceitaControlledExecutionRequestPacket | null;
  reviewDecision?: BrazilReceitaControlledExecutionReviewDecision | null;
};

export type BrazilReceitaControlledExecutionReviewDecisionValidationResult = {
  status: 'valid' | 'invalid';
  goNoGo: 'GO' | 'NO_GO';
  decisionOutcome:
    | 'approved_for_next_planning_review'
    | 'rejected'
    | 'deferred'
    | 'blocked';

  reviewDecisionAccepted: boolean;
  packetReadyForReview: boolean;
  canProceedToControlledExecutionAttemptPlanningReview: boolean;

  canExecuteRealData: false;
  canReadManifest: false;
  canReadCsv: false;
  canReadZip: false;
  canReadRows: false;
  canImport: false;
  canWriteSupabase: false;
  canActivateRuntime: false;
  canActivateAgent1: false;
  canCallProviders: false;

  gate2Approved: false;
  gate7Approved: false;
  capInputPolicyApproved: false;
  controlledExecutionAttemptAuthorized: false;

  findings: BrazilReceitaControlledExecutionReviewDecisionValidationFinding[];
};

/**
 * The permissions and approvals this validator can never grant, in any code path. Frozen as literal
 * `false` so the result type itself forbids a `true`; a future edit that tried to grant one would
 * have to change this module's exported type, which no review decision is authorized to do.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_WITHHELD = {
  canExecuteRealData: false,
  canReadManifest: false,
  canReadCsv: false,
  canReadZip: false,
  canReadRows: false,
  canImport: false,
  canWriteSupabase: false,
  canActivateRuntime: false,
  canActivateAgent1: false,
  canCallProviders: false,

  gate2Approved: false,
  gate7Approved: false,
  capInputPolicyApproved: false,
  controlledExecutionAttemptAuthorized: false,
} as const;

/** The withheld keys, for callers that sweep the whole set. */
export const BRAZIL_RECEITA_REVIEW_DECISION_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_REVIEW_DECISION_WITHHELD)[] =
  [
    'canExecuteRealData',
    'canReadManifest',
    'canReadCsv',
    'canReadZip',
    'canReadRows',
    'canImport',
    'canWriteSupabase',
    'canActivateRuntime',
    'canActivateAgent1',
    'canCallProviders',
    'gate2Approved',
    'gate7Approved',
    'capInputPolicyApproved',
    'controlledExecutionAttemptAuthorized',
  ] as const;

// ─── Required fields ──────────────────────────────────────────────────────────

/**
 * Every owner-supplied string field on a review decision, in declaration order. Each one is checked
 * for placeholders and unsafe content whenever it is present, whatever the decision value is.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_STRING_FIELDS: readonly string[] = [
  'reviewerRole',
  'reviewerReference',
  'decisionDate',
  'expirationOrReviewDate',
  'reviewedPacketType',
  'reviewedFixture',
  'approvalScope',
] as const;

/** String fields an `approve` decision must carry. A reject or a defer does not need them. */
export const BRAZIL_RECEITA_REVIEW_DECISION_APPROVE_REQUIRED_STRING_FIELDS: readonly string[] =
  BRAZIL_RECEITA_REVIEW_DECISION_STRING_FIELDS;

/**
 * Acknowledgements an `approve` decision must state explicitly as `true`. Absent and `false` block
 * identically: a reviewer who did not state one has not accepted it.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_APPROVE_REQUIRED_ACKS: readonly string[] = [
  'requiredHumanDecisionAcknowledged',
  'readyForReviewIsNotReadyForExecutionAccepted',
  'syntheticGoIsNotExecutionAuthorizationAccepted',
  'noRealDataExecutionAccepted',
  'noManifestReadAccepted',
  'noCsvZipReadAccepted',
  'noRowReadsAccepted',
  'noImportAccepted',
  'noSupabaseWritesAccepted',
  'noRuntimeAccepted',
  'noAgent1Accepted',
  'noProviderCallsAccepted',
  'stopConditionsAccepted',
] as const;

// ─── Pure checks ──────────────────────────────────────────────────────────────

type Finding = BrazilReceitaControlledExecutionReviewDecisionValidationFinding;

/** Every forbidden token carried by `value`, in declaration order. */
function findForbiddenTokens(value: string): readonly string[] {
  return BRAZIL_RECEITA_REVIEW_DECISION_FORBIDDEN_CONTENT_PATTERNS.filter((pattern) =>
    pattern.caseSensitive
      ? value.includes(pattern.token)
      : value.toLowerCase().includes(pattern.token.toLowerCase()),
  ).map((pattern) => pattern.token);
}

/**
 * Checks one present string field for hygiene: an empty, whitespace-only or placeholder value proves
 * the field was never completed, and any forbidden token makes it unsafe to carry. Absent fields are
 * not this function's business — required-field checks handle those.
 */
function checkStringHygiene(field: string, value: unknown): readonly Finding[] {
  if (value === undefined || value === null) return [];

  if (typeof value !== 'string') {
    return [
      {
        code: CODES.fieldPlaceholder,
        severity: 'blocking',
        message: `Review decision field ${field} must be a string.`,
        field,
      },
    ];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN) {
    return [
      {
        code: CODES.fieldPlaceholder,
        severity: 'blocking',
        message:
          trimmed.length === 0
            ? `Review decision field ${field} is empty or whitespace-only, so it was never completed.`
            : `Review decision field ${field} still holds the ${BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN} placeholder.`,
        field,
      },
    ];
  }

  return findForbiddenTokens(value).map((forbidden) => ({
    code: CODES.forbiddenContent,
    severity: 'blocking' as const,
    message: `Review decision field ${field} carries forbidden content (${forbidden}). Review decisions must not embed real locations, hosts, addresses or credentials.`,
    field,
  }));
}

/** Classifies the decision value, ignoring every other field on the decision. */
function checkDecisionValue(value: unknown): readonly Finding[] {
  const field = 'decisionValue';

  if (value === undefined || value === null) {
    return [
      {
        code: CODES.valueMissing,
        severity: 'blocking',
        message: 'No review decision value was recorded.',
        field,
      },
    ];
  }

  if (typeof value !== 'string') {
    return [
      {
        code: CODES.valueUnrecognized,
        severity: 'blocking',
        message: 'The review decision value must be a string.',
        field,
      },
    ];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === BRAZIL_RECEITA_REVIEW_DECISION_PLACEHOLDER_TOKEN) {
    return [
      {
        code: CODES.valueMissing,
        severity: 'blocking',
        message: 'The review decision value was never completed.',
        field,
      },
    ];
  }

  if (trimmed === 'reject') {
    return [
      {
        code: CODES.rejected,
        severity: 'info',
        message:
          'The reviewer rejected the request. A rejection is a recorded decision, and it does not let the request advance.',
        field,
      },
    ];
  }

  if (trimmed === 'defer') {
    return [
      {
        code: CODES.deferred,
        severity: 'info',
        message:
          'The reviewer deferred the request. A deferral is a recorded decision, and it is not an approval.',
        field,
      },
    ];
  }

  if (trimmed !== 'approve') {
    return [
      {
        code: CODES.valueUnrecognized,
        severity: 'blocking',
        message: `The review decision value is not one of ${BRAZIL_RECEITA_REVIEW_DECISION_VALUES.join(' / ')}.`,
        field,
      },
    ];
  }

  return [];
}

/**
 * Validates the packet a reviewer claims to have read. A review decision is only meaningful over a
 * genuine 13D packet that reached `ready_for_review`, so anything else blocks rather than being
 * reinterpreted.
 */
function checkPacket(packet: BrazilReceitaControlledExecutionRequestPacket): readonly Finding[] {
  const values = packet as unknown as Record<string, unknown>;
  const findings: Finding[] = [];

  if (values.packetType !== BRAZIL_RECEITA_REQUEST_PACKET_TYPE) {
    findings.push({
      code: CODES.packetInvalid,
      severity: 'blocking',
      message: `The reviewed packet is not a ${BRAZIL_RECEITA_REQUEST_PACKET_TYPE} packet.`,
      field: 'packet.packetType',
    });
  }

  if (values.version !== BRAZIL_RECEITA_REQUEST_PACKET_VERSION) {
    findings.push({
      code: CODES.packetInvalid,
      severity: 'blocking',
      message: `The reviewed packet is not version ${BRAZIL_RECEITA_REQUEST_PACKET_VERSION}.`,
      field: 'packet.version',
    });
  }

  if (values.syntheticOnly !== true) {
    findings.push({
      code: CODES.packetInvalid,
      severity: 'blocking',
      message:
        'The reviewed packet does not declare itself synthetic-only. This validator reviews synthetic packets only.',
      field: 'packet.syntheticOnly',
    });
  }

  if (values.status !== 'ready_for_review') {
    findings.push({
      code: CODES.packetNotReady,
      severity: 'blocking',
      message: `The reviewed packet is not ready for review (status: ${String(values.status)}). Resolve its blockers before recording a review decision.`,
      field: 'packet.status',
    });
  }

  if (values.goNoGo !== 'GO') {
    findings.push({
      code: CODES.packetNotReady,
      severity: 'blocking',
      message: `The reviewed packet did not reach GO (Go / No-Go: ${String(values.goNoGo)}).`,
      field: 'packet.goNoGo',
    });
  }

  if (values.disclaimer !== BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER) {
    findings.push({
      code: CODES.packetDisclaimerMissing,
      severity: 'blocking',
      message: `The reviewed packet does not carry the required disclaimer verbatim: "${BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER}".`,
      field: 'packet.disclaimer',
    });
  }

  for (const key of BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATION_KEYS) {
    if (values[key] !== false) {
      findings.push({
        code: CODES.packetAuthorizationNotFalse,
        severity: 'blocking',
        message: `The reviewed packet field ${key} is not false. A packet that grants an authorization is not reviewable.`,
        field: `packet.${key}`,
      });
    }
  }

  return findings;
}

/**
 * Checks the fields an `approve` decision must carry, and that the reviewer approved THIS packet:
 * a decision whose reviewed identity disagrees with the packet describes a different document.
 */
function checkApproveRequirements(
  decision: BrazilReceitaControlledExecutionReviewDecision,
  packet: BrazilReceitaControlledExecutionRequestPacket | null,
): readonly Finding[] {
  const values = decision as unknown as Record<string, unknown>;
  const findings: Finding[] = [];

  for (const field of BRAZIL_RECEITA_REVIEW_DECISION_APPROVE_REQUIRED_STRING_FIELDS) {
    if (values[field] === undefined || values[field] === null) {
      findings.push({
        code: CODES.requiredFieldMissing,
        severity: 'blocking',
        message: `An approve decision requires the field ${field}.`,
        field,
      });
    }
  }

  if (values.reviewedPacketVersion === undefined || values.reviewedPacketVersion === null) {
    findings.push({
      code: CODES.requiredFieldMissing,
      severity: 'blocking',
      message: 'An approve decision requires the field reviewedPacketVersion.',
      field: 'reviewedPacketVersion',
    });
  } else if (values.reviewedPacketVersion !== BRAZIL_RECEITA_REQUEST_PACKET_VERSION) {
    findings.push({
      code: CODES.packetMismatch,
      severity: 'blocking',
      message: `The decision reviewed packet version ${String(values.reviewedPacketVersion)}, but the reviewable packet version is ${BRAZIL_RECEITA_REQUEST_PACKET_VERSION}.`,
      field: 'reviewedPacketVersion',
    });
  }

  if (
    values.approvalScope !== undefined &&
    values.approvalScope !== null &&
    values.approvalScope !== BRAZIL_RECEITA_REVIEW_DECISION_APPROVAL_SCOPE
  ) {
    findings.push({
      code: CODES.approvalScopeInvalid,
      severity: 'blocking',
      message: `An approve decision may only carry the scope ${BRAZIL_RECEITA_REVIEW_DECISION_APPROVAL_SCOPE}.`,
      field: 'approvalScope',
    });
  }

  for (const field of BRAZIL_RECEITA_REVIEW_DECISION_APPROVE_REQUIRED_ACKS) {
    if (values[field] !== true) {
      findings.push({
        code: CODES.requiredAckMissing,
        severity: 'blocking',
        message: `An approve decision must state ${field} explicitly as true.`,
        field,
      });
    }
  }

  if (packet !== null) {
    if (
      values.reviewedPacketType !== undefined &&
      values.reviewedPacketType !== null &&
      values.reviewedPacketType !== packet.packetType
    ) {
      findings.push({
        code: CODES.packetMismatch,
        severity: 'blocking',
        message: 'The decision names a different packet type than the packet under review.',
        field: 'reviewedPacketType',
      });
    }

    if (
      values.reviewedFixture !== undefined &&
      values.reviewedFixture !== null &&
      values.reviewedFixture !== packet.fixture
    ) {
      findings.push({
        code: CODES.packetMismatch,
        severity: 'blocking',
        message: 'The decision names a different fixture than the packet under review.',
        field: 'reviewedFixture',
      });
    }
  }

  return findings;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** The info finding appended to every result, approval included. */
const DISCLAIMER_FINDING: Finding = {
  code: CODES.isNotExecutionAuthorization,
  severity: 'info',
  message:
    'Review approval is not execution authorization. An approved review permits a future planning / review step only; real-data execution, manifest, CSV, ZIP and row reads, join, coverage, import, Supabase writes, runtime, Agent 1 and provider calls remain denied, GATE-2, GATE-7 and the cap / input policy remain unapproved, and Brazil remains blocked.',
};

function buildResult(
  outcome: BrazilReceitaControlledExecutionReviewDecisionValidationResult['decisionOutcome'],
  parts: {
    readonly reviewDecisionAccepted: boolean;
    readonly packetReadyForReview: boolean;
    readonly findings: readonly Finding[];
  },
): BrazilReceitaControlledExecutionReviewDecisionValidationResult {
  const approved = outcome === 'approved_for_next_planning_review';

  return {
    status: outcome === 'blocked' ? 'invalid' : 'valid',
    goNoGo: approved ? 'GO' : 'NO_GO',
    decisionOutcome: outcome,

    reviewDecisionAccepted: parts.reviewDecisionAccepted,
    packetReadyForReview: parts.packetReadyForReview,
    canProceedToControlledExecutionAttemptPlanningReview: approved,

    ...BRAZIL_RECEITA_REVIEW_DECISION_WITHHELD,

    findings: [...parts.findings, DISCLAIMER_FINDING],
  };
}

/**
 * Validates a synthetic human review decision over a BR-SOURCE-13D request packet.
 *
 * An `approve` outcome states only that a reviewer read a SYNTHETIC packet and agreed the request may
 * advance to a future planning / review step. It authorizes nothing: no gate is approved, no cap is
 * set, and no execution, real-data read, manifest/CSV/ZIP read, row read, join, coverage, import,
 * Supabase write, runtime, Agent 1 or provider path is opened. Brazil stays blocked.
 *
 * A `reject` or a `defer` is a valid decision that never lets the request advance. Anything
 * incomplete, unrecognized, unsafe or recorded over a non-reviewable packet is `blocked`.
 */
export function validateBrazilReceitaControlledExecutionReviewDecision(
  input: BrazilReceitaControlledExecutionReviewDecisionValidationInput | null | undefined,
): BrazilReceitaControlledExecutionReviewDecisionValidationResult {
  if (input === undefined || input === null) {
    return buildResult('blocked', {
      reviewDecisionAccepted: false,
      packetReadyForReview: false,
      findings: [
        {
          code: CODES.inputMissing,
          severity: 'blocking',
          message: 'No review decision validation input was provided.',
        },
      ],
    });
  }

  const packet = input.packet ?? null;
  const decision = input.reviewDecision ?? null;

  const packetFindings: readonly Finding[] =
    packet === null
      ? [
          {
            code: CODES.packetMissing,
            severity: 'blocking',
            message:
              'No BR-SOURCE-13D request packet was provided. There is nothing for a reviewer to have read.',
            field: 'packet',
          },
        ]
      : checkPacket(packet);

  if (decision === null) {
    return buildResult('blocked', {
      reviewDecisionAccepted: false,
      packetReadyForReview: packet !== null && packetFindings.length === 0,
      findings: [
        ...packetFindings,
        {
          code: CODES.decisionMissing,
          severity: 'blocking',
          message: 'No review decision was provided.',
          field: 'reviewDecision',
        },
      ],
    });
  }

  const values = decision as unknown as Record<string, unknown>;

  const hygieneFindings = BRAZIL_RECEITA_REVIEW_DECISION_STRING_FIELDS.flatMap((field) =>
    checkStringHygiene(field, values[field]),
  );
  const valueFindings = checkDecisionValue(values.decisionValue);
  const rawValue = typeof values.decisionValue === 'string' ? values.decisionValue.trim() : '';
  const approveFindings =
    rawValue === 'approve' ? checkApproveRequirements(decision, packet) : [];

  const decisionFindings: readonly Finding[] = [
    ...hygieneFindings,
    ...valueFindings,
    ...approveFindings,
  ];

  const isBlocking = (finding: Finding): boolean => finding.severity === 'blocking';
  const packetReadyForReview = packet !== null && !packetFindings.some(isBlocking);
  const reviewDecisionAccepted = !decisionFindings.some(isBlocking);

  const findings = [...packetFindings, ...decisionFindings];
  const blocked = findings.some(isBlocking);

  const outcome: BrazilReceitaControlledExecutionReviewDecisionValidationResult['decisionOutcome'] =
    blocked
      ? 'blocked'
      : rawValue === 'approve'
        ? 'approved_for_next_planning_review'
        : rawValue === 'reject'
          ? 'rejected'
          : 'deferred';

  return buildResult(outcome, { reviewDecisionAccepted, packetReadyForReview, findings });
}

// ─── Synthetic report ─────────────────────────────────────────────────────────

/** Stable identity of the report the CLI emits. */
export const BRAZIL_RECEITA_REVIEW_DECISION_REPORT_TYPE =
  'br_receita_cnpj_controlled_execution_review_decision_report' as const;

/** Report schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_REVIEW_DECISION_REPORT_VERSION = 1 as const;

/**
 * The two synthetic dates the generated decisions use: a decision date and a later review date.
 * Fixed literals, not clock readings, so two runs are byte-identical.
 */
export const BRAZIL_RECEITA_REVIEW_DECISION_SYNTHETIC_DECISION_DATE = '2026-08-04' as const;
export const BRAZIL_RECEITA_REVIEW_DECISION_SYNTHETIC_REVIEW_DATE = '2026-09-04' as const;

export type BrazilReceitaControlledExecutionReviewDecisionReport = {
  reportType: typeof BRAZIL_RECEITA_REVIEW_DECISION_REPORT_TYPE;
  version: typeof BRAZIL_RECEITA_REVIEW_DECISION_REPORT_VERSION;
  generatedAt: typeof BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP;
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  decisionValue: BrazilReceitaControlledExecutionReviewDecisionValue;
  syntheticOnly: true;
  packet: BrazilReceitaControlledExecutionRequestPacket;
  reviewDecision: BrazilReceitaControlledExecutionReviewDecision;
  result: BrazilReceitaControlledExecutionReviewDecisionValidationResult;
  disclaimer: typeof BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER;
};

/**
 * Builds a complete SYNTHETIC review decision for a packet. Every acknowledgement is stated, and the
 * reviewed identity is derived from the packet, so the only thing that varies between the three
 * decision values is the position the reviewer took.
 *
 * This is demonstration input, never a human decision and never evidence.
 */
export function buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
  packet: BrazilReceitaControlledExecutionRequestPacket,
  decisionValue: BrazilReceitaControlledExecutionReviewDecisionValue,
): BrazilReceitaControlledExecutionReviewDecision {
  return {
    decisionValue,
    reviewerRole: 'REVIEWER_ROLE_SYNTHETIC_CONTROLLED_EXECUTION_REVIEW',
    reviewerReference: 'REVIEWER_REF_SYNTHETIC_CONTROLLED_EXECUTION_REVIEW',
    decisionDate: BRAZIL_RECEITA_REVIEW_DECISION_SYNTHETIC_DECISION_DATE,
    expirationOrReviewDate: BRAZIL_RECEITA_REVIEW_DECISION_SYNTHETIC_REVIEW_DATE,
    reviewedPacketType: packet.packetType,
    reviewedPacketVersion: packet.version,
    reviewedFixture: packet.fixture,
    approvalScope: BRAZIL_RECEITA_REVIEW_DECISION_APPROVAL_SCOPE,
    requiredHumanDecisionAcknowledged: true,
    readyForReviewIsNotReadyForExecutionAccepted: true,
    syntheticGoIsNotExecutionAuthorizationAccepted: true,
    noRealDataExecutionAccepted: true,
    noManifestReadAccepted: true,
    noCsvZipReadAccepted: true,
    noRowReadsAccepted: true,
    noImportAccepted: true,
    noSupabaseWritesAccepted: true,
    noRuntimeAccepted: true,
    noAgent1Accepted: true,
    noProviderCallsAccepted: true,
    stopConditionsAccepted: true,
  };
}

/**
 * Builds the whole synthetic review for a named 13C fixture: the 13D packet, a synthetic decision of
 * the requested value, and this validator's verdict over both.
 *
 * @throws Error when `fixtureName` is not a known 13C fixture (raised by 13C, through 13D).
 */
export function buildBrazilReceitaControlledExecutionReviewDecisionReport(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
  decisionValue: BrazilReceitaControlledExecutionReviewDecisionValue,
): BrazilReceitaControlledExecutionReviewDecisionReport {
  const packet = buildBrazilReceitaControlledExecutionRequestPacket(fixtureName);
  const reviewDecision = buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
    packet,
    decisionValue,
  );

  return {
    reportType: BRAZIL_RECEITA_REVIEW_DECISION_REPORT_TYPE,
    version: BRAZIL_RECEITA_REVIEW_DECISION_REPORT_VERSION,
    generatedAt: BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP,
    fixture: fixtureName,
    decisionValue,
    syntheticOnly: true,
    packet,
    reviewDecision,
    result: validateBrazilReceitaControlledExecutionReviewDecision({ packet, reviewDecision }),
    disclaimer: BRAZIL_RECEITA_REVIEW_DECISION_DISCLAIMER,
  };
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

/** Booleans read as YES/NO, so a reviewer never has to parse a JSON literal. */
function yesNo(value: boolean): 'YES' | 'NO' {
  return value ? 'YES' : 'NO';
}

function renderFindings(findings: readonly Finding[]): readonly string[] {
  if (findings.length === 0) return ['- none'];

  return findings.map((finding) => {
    const where = finding.field === undefined ? '' : ` (${finding.field})`;
    return `- \`${finding.code}\` [${finding.severity}]${where}: ${finding.message}`;
  });
}

/**
 * Renders the report as Markdown. Pure and deterministic: every line is derived from the report in a
 * fixed order, so the same report always renders byte-identically.
 */
export function renderBrazilReceitaControlledExecutionReviewDecisionReportMarkdown(
  report: BrazilReceitaControlledExecutionReviewDecisionReport,
): string {
  const { packet, result } = report;

  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution review decision',
    '',
    `- Report type: \`${report.reportType}\``,
    `- Version: ${report.version}`,
    `- Generated at: \`${report.generatedAt}\``,
    `- Fixture: \`${report.fixture}\``,
    `- Review decision: **${report.decisionValue}**`,
    `- Synthetic only: ${yesNo(report.syntheticOnly)}`,
    '',
    '## Verdict',
    '',
    `- Status: **${result.status}**`,
    `- Go / No-Go: **${result.goNoGo}**`,
    `- Decision outcome: **${result.decisionOutcome}**`,
    `- Review decision accepted: ${yesNo(result.reviewDecisionAccepted)}`,
    `- Packet ready for review: ${yesNo(result.packetReadyForReview)}`,
    `- May proceed to controlled execution attempt planning / review: ${yesNo(result.canProceedToControlledExecutionAttemptPlanningReview)}`,
    '',
    '## Permissions and approvals withheld by this review',
    '',
    'Every row below is withheld by construction. No review decision can grant any of them.',
    '',
    '| Permission or approval | Granted |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_REVIEW_DECISION_WITHHELD_KEYS.map(
      (key) => `| ${key} | ${yesNo(result[key])} |`,
    ),
    '',
    '## Packet under review (BR-SOURCE-13D)',
    '',
    `- Packet type: \`${packet.packetType}\``,
    `- Packet status: \`${packet.status}\``,
    `- Packet Go / No-Go: \`${packet.goNoGo}\``,
    `- Packet blockers: ${packet.blockers.length}`,
    `- Packet disclaimer: ${packet.disclaimer}`,
    '',
    '## Findings',
    '',
    ...renderFindings(result.findings),
    '',
    '## Disclaimer',
    '',
    report.disclaimer,
    '',
    'Ready for review is not ready for execution. Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** Type guard over the recognized decision values, so the CLI needs only this module. */
export function isBrazilReceitaReviewDecisionValue(
  value: string,
): value is BrazilReceitaControlledExecutionReviewDecisionValue {
  return (BRAZIL_RECEITA_REVIEW_DECISION_VALUES as readonly string[]).includes(value);
}

/**
 * Serializes the report in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionReviewDecisionReport(
  report: BrazilReceitaControlledExecutionReviewDecisionReport,
  format: BrazilReceitaRequestPacketFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionReviewDecisionReportMarkdown(report);
  }

  return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
}
