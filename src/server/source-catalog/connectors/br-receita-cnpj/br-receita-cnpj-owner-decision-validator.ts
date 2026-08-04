/**
 * BR Receita CNPJ — owner decision artifact validator (BR-SOURCE-13A).
 *
 * BR-SOURCE-11W … 12B produced a documentary chain that defines WHAT owners must decide for
 * GATE-2, GATE-7, cap/input policy and a controlled execution attempt — and each milestone found
 * the same thing: nothing was submitted, every owner field still reads `TBD_BY_OWNER`. This module
 * is the first executable link in that chain: given a *future* owner decision artifact, it says
 * whether that artifact is structurally complete, internally consistent and free of unsafe
 * content, so a reviewer never has to eyeball fifty-one fields by hand.
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 * A `valid` / `GO` verdict means only that the ARTIFACT could be handed to the next preflight.
 * It is NOT an approval, NOT an authorization, and NOT a statement that Brazil may execute
 * anything. `canProceedToControlledExecutionPreflight` names a *document* transition, never a
 * *data* transition.
 *
 * ── This validator NEVER (fail-closed by construction) ───────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *   - accepts a real cap number, a real path, an address-shaped value, or a credential-shaped
 *     value — those are refused as unsafe content, not stored.
 *
 * It is a pure function: same input, same result, no side effects, no mutation of the input.
 */

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The three decision positions the owner packets recognize. Anything else is unrecognized. */
export type OwnerDecisionValue = 'approved' | 'rejected' | 'deferred';

/** Recognized decision values, in packet order. */
export const BRAZIL_RECEITA_OWNER_DECISION_VALUES: readonly OwnerDecisionValue[] = [
  'approved',
  'rejected',
  'deferred',
] as const;

/**
 * The literal placeholder the 11W…12B packets print in every owner-supplied field. Its presence
 * proves the field was never completed, so it blocks exactly like an empty string.
 */
export const BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN = 'TBD_BY_OWNER' as const;

/** Every finding code this validator can emit. The single source of truth for callers. */
export const BRAZIL_RECEITA_OWNER_DECISION_FINDING_CODES = {
  artifactMissing: 'OWNER_ARTIFACT_MISSING',
  decisionMissing: 'OWNER_DECISION_MISSING',
  decisionRejected: 'OWNER_DECISION_REJECTED',
  decisionDeferred: 'OWNER_DECISION_DEFERRED',
  decisionValueUnrecognized: 'OWNER_DECISION_VALUE_UNRECOGNIZED',
  requiredFieldMissing: 'OWNER_REQUIRED_FIELD_MISSING',
  fieldPlaceholder: 'OWNER_FIELD_PLACEHOLDER',
  fieldForbiddenContent: 'OWNER_FIELD_FORBIDDEN_CONTENT',
  fieldInvalidType: 'OWNER_FIELD_INVALID_TYPE',
  stopConditionsNotAccepted: 'OWNER_STOP_CONDITIONS_NOT_ACCEPTED',
  capMaximaRealValue: 'CAP_MAXIMA_REAL_VALUE_NOT_ALLOWED_IN_VALIDATOR_FIXTURE',
  gate7CannotPrecedeGate2: 'GATE7_CANNOT_PRECEDE_GATE2',
  controlledExecutionWithoutGates: 'CONTROLLED_EXECUTION_AUTH_WITHOUT_REQUIRED_GATES',
  validationIsNotAuthorization: 'OWNER_VALIDATION_IS_NOT_EXECUTION_AUTHORIZATION',
} as const;

const CODES = BRAZIL_RECEITA_OWNER_DECISION_FINDING_CODES;

// ─── Unsafe content ───────────────────────────────────────────────────────────

/**
 * Content an owner artifact must never carry. Matching is substring-based, deliberately narrow,
 * and never anchored on digits — a `decisionDate` like `2026-08-04` must survive untouched.
 *
 * `caseSensitive` is set per pattern rather than globally: `sk-` and `xoxb-` are credential
 * prefixes that only ever appear lowercase, and folding their case would reject ordinary prose
 * (`RISK-BASED` contains `SK-`). Path, host and env-name markers are folded, since a real leak
 * does not care about capitalization.
 */
export const BRAZIL_RECEITA_OWNER_DECISION_FORBIDDEN_CONTENT_PATTERNS: readonly {
  readonly token: string;
  readonly caseSensitive: boolean;
  readonly reason: string;
}[] = [
  { token: '/Users/', caseSensitive: false, reason: 'absolute local path' },
  { token: 'Downloads', caseSensitive: false, reason: 'local download directory' },
  { token: 'manifest.headerless.json', caseSensitive: false, reason: 'real manifest file name' },
  { token: 'sellup-source-data', caseSensitive: false, reason: 'real dataset root' },
  { token: 'raw-zips', caseSensitive: false, reason: 'real dataset subtree' },
  { token: 'extracted', caseSensitive: false, reason: 'real dataset subtree' },
  { token: 'manifest-input', caseSensitive: false, reason: 'real manifest input subtree' },
  { token: 'linkedin.com', caseSensitive: false, reason: 'personal profile host' },
  { token: '@', caseSensitive: false, reason: 'address-shaped value' },
  { token: 'postgres://', caseSensitive: false, reason: 'database connection string' },
  { token: 'service_role', caseSensitive: false, reason: 'privileged database role' },
  { token: 'SUPABASE_SERVICE', caseSensitive: false, reason: 'privileged env var name' },
  { token: 'BEGIN PRIVATE', caseSensitive: false, reason: 'private key block' },
  { token: 'PRIVATE KEY', caseSensitive: false, reason: 'private key block' },
  { token: 'eyJ', caseSensitive: true, reason: 'JWT-shaped value' },
  { token: 'sk-', caseSensitive: true, reason: 'API-key-shaped value' },
  { token: 'xoxb-', caseSensitive: true, reason: 'Slack-token-shaped value' },
] as const;

// ─── Artifact shape ───────────────────────────────────────────────────────────

export type OwnerDecisionArtifact = {
  gate2?: {
    decisionValue?: OwnerDecisionValue;
    ownerRole?: string;
    ownerReference?: string;
    decisionDate?: string;
    expirationOrReviewDate?: string;
    evidencePacketReference?: string;
    legalPrivacySecurityReference?: string;
    operatorReviewerRequirement?: string;
    incidentEscalationReference?: string;
    stopConditionsAccepted?: boolean;
  };
  gate7?: {
    decisionValue?: OwnerDecisionValue;
    ownerRole?: string;
    ownerReference?: string;
    decisionDate?: string;
    expirationOrReviewDate?: string;
    operatorRole?: string;
    reviewerRole?: string;
    runbookReference?: string;
    evidenceCaptureProcedure?: string;
    sanitizerProcedure?: string;
    cleanupProcedure?: string;
    incidentPath?: string;
    escalationPath?: string;
    stopConditionsAccepted?: boolean;
    dryRunRehearsalReference?: string;
  };
  capInputPolicy?: {
    decisionValue?: OwnerDecisionValue;
    ownerRole?: string;
    ownerReference?: string;
    decisionDate?: string;
    expirationOrReviewDate?: string;
    capMaximaDecision?: string;
    inputRootDecision?: string;
    outputRootDecision?: string;
    tempStorageDecision?: string;
    evidenceBucketDecision?: string;
    familyAllowDenyDecision?: string;
    manifestControlFilePolicyDecision?: string;
    exactPercentagePolicyDecision?: string;
    fullDatasetDenominatorPolicyDecision?: string;
    coverageLanguageDecision?: string;
    stopConditionsAccepted?: boolean;
    legalPrivacySecurityReference?: string;
  };
  controlledExecutionAttempt?: {
    authorizationDecision?: OwnerDecisionValue;
    ownerRole?: string;
    ownerReference?: string;
    decisionDate?: string;
    expirationOrReviewDate?: string;
    scopeBoundary?: string;
    stopConditionsAccepted?: boolean;
  };
};

export type OwnerDecisionValidationFinding = {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  field?: string;
};

export type OwnerDecisionValidationResult = {
  status: 'valid' | 'invalid';
  goNoGo: 'GO' | 'NO_GO';
  canProceedToControlledExecutionPreflight: boolean;
  gate2Approved: boolean;
  gate7Approved: boolean;
  capInputPolicyApproved: boolean;
  controlledExecutionAttemptAuthorized: boolean;
  findings: OwnerDecisionValidationFinding[];
};

// ─── Required fields per section ───────────────────────────────────────────────

/**
 * Owner-supplied string fields required for each section, mirroring 12B § 6–§ 9. A section can be
 * `approved` only when every one of its fields below is present, non-placeholder and safe.
 */
export const BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS = {
  gate2: [
    'ownerRole',
    'ownerReference',
    'decisionDate',
    'expirationOrReviewDate',
    'evidencePacketReference',
    'legalPrivacySecurityReference',
    'operatorReviewerRequirement',
    'incidentEscalationReference',
  ],
  gate7: [
    'ownerRole',
    'ownerReference',
    'decisionDate',
    'expirationOrReviewDate',
    'operatorRole',
    'reviewerRole',
    'runbookReference',
    'evidenceCaptureProcedure',
    'sanitizerProcedure',
    'cleanupProcedure',
    'incidentPath',
    'escalationPath',
    'dryRunRehearsalReference',
  ],
  capInputPolicy: [
    'ownerRole',
    'ownerReference',
    'decisionDate',
    'expirationOrReviewDate',
    'capMaximaDecision',
    'inputRootDecision',
    'outputRootDecision',
    'tempStorageDecision',
    'evidenceBucketDecision',
    'familyAllowDenyDecision',
    'manifestControlFilePolicyDecision',
    'exactPercentagePolicyDecision',
    'fullDatasetDenominatorPolicyDecision',
    'coverageLanguageDecision',
    'legalPrivacySecurityReference',
  ],
  controlledExecutionAttempt: [
    'ownerRole',
    'ownerReference',
    'decisionDate',
    'expirationOrReviewDate',
    'scopeBoundary',
  ],
} as const satisfies Record<string, readonly string[]>;

/** Section keys in evaluation order: gates first, authorization last. */
type SectionKey = keyof typeof BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS;

/** The decision field is named `authorizationDecision` on the controlled-execution section only. */
const DECISION_FIELD_BY_SECTION: Record<SectionKey, string> = {
  gate2: 'decisionValue',
  gate7: 'decisionValue',
  capInputPolicy: 'decisionValue',
  controlledExecutionAttempt: 'authorizationDecision',
};

const SECTION_LABEL: Record<SectionKey, string> = {
  gate2: 'GATE-2',
  gate7: 'GATE-7',
  capInputPolicy: 'cap/input policy',
  controlledExecutionAttempt: 'controlled execution attempt',
};

// ─── Pure field checks ────────────────────────────────────────────────────────

/** Every forbidden token carried by `value`, in declaration order. */
function findForbiddenTokens(value: string): readonly string[] {
  return BRAZIL_RECEITA_OWNER_DECISION_FORBIDDEN_CONTENT_PATTERNS.filter((pattern) =>
    pattern.caseSensitive
      ? value.includes(pattern.token)
      : value.toLowerCase().includes(pattern.token.toLowerCase()),
  ).map((pattern) => pattern.token);
}

/**
 * Validates one owner-supplied string field. Returns the findings it produced — an empty array
 * means the field is present, completed and safe.
 */
function checkStringField(
  field: string,
  value: unknown,
): readonly OwnerDecisionValidationFinding[] {
  if (value === undefined || value === null) {
    return [
      {
        code: CODES.requiredFieldMissing,
        severity: 'blocking',
        message: `Required owner field is missing: ${field}.`,
        field,
      },
    ];
  }

  if (typeof value !== 'string') {
    return [
      {
        code: CODES.fieldInvalidType,
        severity: 'blocking',
        message: `Owner field ${field} must be a string.`,
        field,
      },
    ];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN) {
    return [
      {
        code: CODES.fieldPlaceholder,
        severity: 'blocking',
        message:
          trimmed.length === 0
            ? `Owner field ${field} is empty or whitespace-only, so it was never completed.`
            : `Owner field ${field} still holds the ${BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN} placeholder.`,
        field,
      },
    ];
  }

  const forbidden = findForbiddenTokens(value);
  return forbidden.map((token) => ({
    code: CODES.fieldForbiddenContent,
    severity: 'blocking' as const,
    message: `Owner field ${field} carries forbidden content (${token}). Owner artifacts must not embed real paths, hosts, addresses or credentials.`,
    field,
  }));
}

/** `stopConditionsAccepted` must be an explicit `true`; absent and `false` both block. */
function checkStopConditions(
  field: string,
  value: unknown,
): readonly OwnerDecisionValidationFinding[] {
  if (value === true) return [];
  if (value === undefined || value === null) {
    return [
      {
        code: CODES.requiredFieldMissing,
        severity: 'blocking',
        message: `Required owner field is missing: ${field}.`,
        field,
      },
    ];
  }
  return [
    {
      code: CODES.stopConditionsNotAccepted,
      severity: 'blocking',
      message: `Owner field ${field} must be accepted explicitly (true).`,
      field,
    },
  ];
}

/**
 * `capMaximaDecision` may state a POLICY, never a number. Cap maxima are unapproved at 13A, so a
 * digit in this field means the artifact is smuggling a real cap through a structural validator.
 */
function checkCapMaximaDecision(
  field: string,
  value: unknown,
): readonly OwnerDecisionValidationFinding[] {
  if (typeof value !== 'string' || !/[0-9]/.test(value)) return [];
  return [
    {
      code: CODES.capMaximaRealValue,
      severity: 'blocking',
      message: `Owner field ${field} contains a numeric value. This validator accepts a cap policy statement only; cap maxima are not approved and must not be carried here.`,
      field,
    },
  ];
}

/** Classifies the section's decision value, ignoring the rest of the section's fields. */
function checkDecisionValue(
  section: SectionKey,
  decision: unknown,
): readonly OwnerDecisionValidationFinding[] {
  const field = `${section}.${DECISION_FIELD_BY_SECTION[section]}`;
  const label = SECTION_LABEL[section];

  if (decision === undefined || decision === null) {
    return [
      {
        code: CODES.decisionMissing,
        severity: 'blocking',
        message: `No owner decision was recorded for ${label}.`,
        field,
      },
    ];
  }

  if (typeof decision !== 'string') {
    return [
      {
        code: CODES.fieldInvalidType,
        severity: 'blocking',
        message: `Owner decision for ${label} must be a string.`,
        field,
      },
    ];
  }

  const trimmed = decision.trim();
  if (trimmed.length === 0 || trimmed === BRAZIL_RECEITA_OWNER_DECISION_PLACEHOLDER_TOKEN) {
    return [
      {
        code: CODES.fieldPlaceholder,
        severity: 'blocking',
        message: `Owner decision for ${label} was never completed.`,
        field,
      },
    ];
  }

  if (trimmed === 'rejected') {
    return [
      {
        code: CODES.decisionRejected,
        severity: 'blocking',
        message: `Owner rejected ${label}.`,
        field,
      },
    ];
  }

  if (trimmed === 'deferred') {
    return [
      {
        code: CODES.decisionDeferred,
        severity: 'blocking',
        message: `Owner deferred ${label}; a deferral is not an approval.`,
        field,
      },
    ];
  }

  if (trimmed !== 'approved') {
    return [
      {
        code: CODES.decisionValueUnrecognized,
        severity: 'blocking',
        message: `Owner decision for ${label} is not one of approved / rejected / deferred.`,
        field,
      },
    ];
  }

  return [];
}

// ─── Section evaluation ───────────────────────────────────────────────────────

type SectionOutcome = {
  readonly approved: boolean;
  readonly decisionIsApproved: boolean;
  readonly findings: readonly OwnerDecisionValidationFinding[];
};

/**
 * Evaluates one section in isolation. `approved` requires BOTH an `approved` decision and a clean
 * section — an approval carried on incomplete or unsafe fields is not an approval.
 */
function evaluateSection(section: SectionKey, raw: unknown): SectionOutcome {
  const label = SECTION_LABEL[section];

  if (raw === undefined || raw === null) {
    return {
      approved: false,
      decisionIsApproved: false,
      findings: [
        {
          code: CODES.decisionMissing,
          severity: 'blocking',
          message: `No owner decision section was provided for ${label}.`,
          field: section,
        },
      ],
    };
  }

  if (typeof raw !== 'object') {
    return {
      approved: false,
      decisionIsApproved: false,
      findings: [
        {
          code: CODES.fieldInvalidType,
          severity: 'blocking',
          message: `Owner decision section ${label} must be an object.`,
          field: section,
        },
      ],
    };
  }

  const values = raw as Record<string, unknown>;
  const decisionField = DECISION_FIELD_BY_SECTION[section];
  const decisionFindings = checkDecisionValue(section, values[decisionField]);

  const fieldFindings = BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS[section].flatMap(
    (field) => [
      ...checkStringField(`${section}.${field}`, values[field]),
      ...(field === 'capMaximaDecision'
        ? checkCapMaximaDecision(`${section}.${field}`, values[field])
        : []),
    ],
  );

  const stopFindings = checkStopConditions(
    `${section}.stopConditionsAccepted`,
    values.stopConditionsAccepted,
  );

  const findings = [...decisionFindings, ...fieldFindings, ...stopFindings];
  const decisionIsApproved =
    typeof values[decisionField] === 'string' &&
    (values[decisionField] as string).trim() === 'approved';

  return {
    approved: decisionIsApproved && findings.every((finding) => finding.severity !== 'blocking'),
    decisionIsApproved,
    findings,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Validates a synthetic owner decision artifact for Brazil Receita CNPJ.
 *
 * A `valid` / `GO` result states only that the artifact is complete, consistent and safe enough to
 * be handed to the next preflight. It authorizes nothing: no gate is approved, no cap is set, no
 * execution, import, runtime or Agent 1 path is opened, and Brazil stays blocked.
 */
export function validateBrazilReceitaOwnerDecisionArtifact(
  artifact: OwnerDecisionArtifact | null | undefined,
): OwnerDecisionValidationResult {
  const disclaimer: OwnerDecisionValidationFinding = {
    code: CODES.validationIsNotAuthorization,
    severity: 'info',
    message:
      'Artifact validation is not an execution authorization. A GO verdict permits the next document preflight only; gates, caps, import, runtime and Agent 1 remain unapproved.',
  };

  if (artifact === undefined || artifact === null) {
    return {
      status: 'invalid',
      goNoGo: 'NO_GO',
      canProceedToControlledExecutionPreflight: false,
      gate2Approved: false,
      gate7Approved: false,
      capInputPolicyApproved: false,
      controlledExecutionAttemptAuthorized: false,
      findings: [
        {
          code: CODES.artifactMissing,
          severity: 'blocking',
          message: 'No owner decision artifact was provided.',
        },
        disclaimer,
      ],
    };
  }

  const gate2 = evaluateSection('gate2', artifact.gate2);
  const gate7 = evaluateSection('gate7', artifact.gate7);
  const capInputPolicy = evaluateSection('capInputPolicy', artifact.capInputPolicy);
  const controlled = evaluateSection(
    'controlledExecutionAttempt',
    artifact.controlledExecutionAttempt,
  );

  // Ordering rules. A later approval can never stand on an earlier one that is not in place.
  const gate7PrecedenceFindings: readonly OwnerDecisionValidationFinding[] =
    gate7.decisionIsApproved && !gate2.approved
      ? [
          {
            code: CODES.gate7CannotPrecedeGate2,
            severity: 'blocking',
            message:
              'GATE-7 is approved while GATE-2 is not. GATE-7 depends on GATE-2 and cannot precede it.',
            field: 'gate7',
          },
        ]
      : [];

  const controlledPrecedenceFindings: readonly OwnerDecisionValidationFinding[] =
    controlled.decisionIsApproved &&
    !(gate2.approved && gate7.approved && capInputPolicy.approved)
      ? [
          {
            code: CODES.controlledExecutionWithoutGates,
            severity: 'blocking',
            message:
              'A controlled execution attempt is authorized while GATE-2, GATE-7 or cap/input policy is not approved. All three are prerequisites.',
            field: 'controlledExecutionAttempt',
          },
        ]
      : [];

  const findings: OwnerDecisionValidationFinding[] = [
    ...gate2.findings,
    ...gate7.findings,
    ...capInputPolicy.findings,
    ...controlled.findings,
    ...gate7PrecedenceFindings,
    ...controlledPrecedenceFindings,
    disclaimer,
  ];

  const hasBlocking = findings.some((finding) => finding.severity === 'blocking');
  const allApproved =
    gate2.approved && gate7.approved && capInputPolicy.approved && controlled.approved;

  return {
    status: hasBlocking ? 'invalid' : 'valid',
    goNoGo: hasBlocking ? 'NO_GO' : 'GO',
    canProceedToControlledExecutionPreflight: allApproved && !hasBlocking,
    gate2Approved: gate2.approved,
    gate7Approved: gate7.approved,
    capInputPolicyApproved: capInputPolicy.approved,
    controlledExecutionAttemptAuthorized: controlled.approved,
    findings,
  };
}
