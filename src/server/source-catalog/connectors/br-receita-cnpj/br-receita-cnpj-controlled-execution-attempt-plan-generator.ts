/**
 * BR Receita CNPJ — controlled execution attempt plan generator (BR-SOURCE-13F).
 *
 * BR-SOURCE-13E records the reviewer's ANSWER to a 13D packet, and an `approve` there means exactly
 * one thing: the request may advance to a future PLANNING / REVIEW step. What the chain still could
 * not produce is that plan — the document a human reads to see what a controlled execution attempt
 * would involve, in what order, under what preconditions, and at which points it must stop.
 *
 * 13F is that document:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A plan may say "plan_ready_for_human_review".
 *   A plan may NEVER say "started", and it may never say "authorized".
 *
 *   Plan ready for review is not execution authorization.
 *
 * Two distinctions carry this module:
 *
 *   approved_for_next_planning_review  ≠  execution authorization
 *   plan_generated                     ≠  execution_started
 *
 * A generated plan lists steps, preconditions, stop conditions and the human actions still owed. It
 * runs nothing. Its seventeen state and authorization fields are typed as the literal `false`, so no
 * caller — and no future edit — can flip one without changing this module's public type.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no fs, no path module, no network, no env, no argv.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - emits an executable command: every step is prose a human reads, never a command a tool runs.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *   - re-implements 13A's, 13B's, 13D's or 13E's rules; every verdict it prints was produced by them.
 *
 * It is a pure function: same fixture and same decision, same plan, no side effects, no mutation of
 * the input, no clock and no randomness. The plan carries 13D's STATIC timestamp, so two runs are
 * byte-identical.
 */

import {
  BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES,
  BRAZIL_RECEITA_REQUEST_PACKET_FORMATS,
  BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP,
  buildBrazilReceitaControlledExecutionRequestPacket,
  type BrazilReceitaControlledExecutionRequestPacket,
  type BrazilReceitaRequestPacketFormat,
} from './br-receita-cnpj-controlled-execution-request-packet-generator';
import {
  buildBrazilReceitaSyntheticControlledExecutionReviewDecision,
  validateBrazilReceitaControlledExecutionReviewDecision,
  type BrazilReceitaControlledExecutionReviewDecision,
  type BrazilReceitaControlledExecutionReviewDecisionValidationResult,
  type BrazilReceitaControlledExecutionReviewDecisionValue,
} from './br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Stable identity of the artefact this module emits. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_TYPE =
  'br_receita_cnpj_controlled_execution_attempt_plan' as const;

/** Plan schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_VERSION = 1 as const;

/** The sentence that must accompany every plan, including one that reached review-ready. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_DISCLAIMER =
  'Plan ready for review is not execution authorization.' as const;

/**
 * Output formats, aliased to 13D's type rather than restated, so the two lists can never drift.
 */
export type BrazilReceitaControlledExecutionAttemptPlanFormat = BrazilReceitaRequestPacketFormat;

/** Every output format, in documentation order, re-exported verbatim from 13D. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_FORMATS: readonly BrazilReceitaControlledExecutionAttemptPlanFormat[] =
  BRAZIL_RECEITA_REQUEST_PACKET_FORMATS;

/** The fixture catalogue, re-exported verbatim from 13D (which re-exports 13C's). */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES;

/**
 * The two states a plan can be in. `plan_ready_for_human_review` is a DOCUMENT state and nothing
 * else: a plan exists and a human may now be asked to read it.
 */
export type BrazilReceitaControlledExecutionAttemptPlanStatus =
  | 'plan_ready_for_human_review'
  | 'blocked';

/**
 * The reviewer position the plan was generated over. `unrecognized` covers a decision whose value was
 * absent, incomplete or outside 13E's vocabulary: such a plan is always `blocked`, and the field has
 * to be able to say so rather than misreport one of the three real positions.
 */
export type BrazilReceitaControlledExecutionAttemptPlanReviewDecisionValue =
  | BrazilReceitaControlledExecutionReviewDecisionValue
  | 'unrecognized';

// ─── Withheld state ───────────────────────────────────────────────────────────

/**
 * Everything a plan can never assert, in any code path. Frozen as literal `false` so the plan type
 * itself forbids a `true`; a future edit that tried to set one would have to change this module's
 * exported type, which no plan is authorized to do.
 *
 * `executionStarted` sits in this table on purpose. It is the field that separates a plan from a run,
 * and it is `false` for the same reason as the rest: nothing in this module can start anything.
 */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_WITHHELD = {
  executionStarted: false,
  executionAuthorized: false,
  realDataExecutionAuthorized: false,
  manifestReadAuthorized: false,
  csvZipReadAuthorized: false,
  rowReadsAuthorized: false,
  joinAuthorized: false,
  coverageAuthorized: false,
  importAuthorized: false,
  supabaseWritesAuthorized: false,
  runtimeAuthorized: false,
  agent1Authorized: false,
  providerCallsAuthorized: false,

  gate2Approved: false,
  gate7Approved: false,
  capInputPolicyApproved: false,
  controlledExecutionAttemptAuthorized: false,
} as const;

/** The withheld keys, for callers that sweep the whole set. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_ATTEMPT_PLAN_WITHHELD)[] =
  [
    'executionStarted',
    'executionAuthorized',
    'realDataExecutionAuthorized',
    'manifestReadAuthorized',
    'csvZipReadAuthorized',
    'rowReadsAuthorized',
    'joinAuthorized',
    'coverageAuthorized',
    'importAuthorized',
    'supabaseWritesAuthorized',
    'runtimeAuthorized',
    'agent1Authorized',
    'providerCallsAuthorized',
    'gate2Approved',
    'gate7Approved',
    'capInputPolicyApproved',
    'controlledExecutionAttemptAuthorized',
  ] as const;

// ─── Plan steps ───────────────────────────────────────────────────────────────

/** Every step identifier a plan carries, in execution-narrative order. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_STEP_IDS: readonly string[] = [
  'PLAN_STEP_RECONFIRM_SCOPE',
  'PLAN_STEP_RECONFIRM_NO_REAL_DATA',
  'PLAN_STEP_RECONFIRM_NO_PATH_INPUT',
  'PLAN_STEP_RECONFIRM_NO_IMPORT',
  'PLAN_STEP_RECONFIRM_NO_RUNTIME',
  'PLAN_STEP_RECONFIRM_NO_AGENT1',
  'PLAN_STEP_PREPARE_FUTURE_AUTHORIZATION_PACKET',
] as const;

export type BrazilReceitaControlledExecutionAttemptPlanStep = {
  stepId: string;
  title: string;
  description: string;
  executionAllowed: false;
  realDataAccessAllowed: false;
  requiresHumanApproval: true;
};

/**
 * The three properties every step shares. Literal `false` / `true`, so a step that permitted
 * execution or a real-data read could not be constructed without changing the step type.
 */
const STEP_CONSTRAINTS = {
  executionAllowed: false,
  realDataAccessAllowed: false,
  requiresHumanApproval: true,
} as const;

/**
 * The plan's steps. Each one is a RECONFIRMATION a human performs by reading, not an action a tool
 * takes: the descriptions deliberately contain no command, no location and no dataset name, because a
 * plan that carried a runnable command would be an execution script wearing a plan's name.
 *
 * The last step is the only forward-looking one, and what it prepares is a request for authorization —
 * never the authorization itself.
 */
const PLAN_STEPS: readonly BrazilReceitaControlledExecutionAttemptPlanStep[] = [
  {
    stepId: 'PLAN_STEP_RECONFIRM_SCOPE',
    title: 'Reconfirm the scope of the requested controlled execution attempt',
    description:
      'A human re-reads the BR-SOURCE-13D request packet and the BR-SOURCE-13E decision and restates, in their own words, what is being requested and what is not. Nothing advances until the scope on paper matches the scope the reviewer believed they approved.',
    ...STEP_CONSTRAINTS,
  },
  {
    stepId: 'PLAN_STEP_RECONFIRM_NO_REAL_DATA',
    title: 'Reconfirm that no real data is in scope',
    description:
      'A human confirms that the attempt under discussion still touches no real record: no manifest, no CSV, no ZIP, no dataset row, no join and no coverage computation. Real-data access is a separate authorization that has not been granted.',
    ...STEP_CONSTRAINTS,
  },
  {
    stepId: 'PLAN_STEP_RECONFIRM_NO_PATH_INPUT',
    title: 'Reconfirm that no location input is accepted',
    description:
      'A human confirms that the chain still exposes no location parameter of any kind. A plan that needed somewhere to point would be a different plan, and it would require its own review.',
    ...STEP_CONSTRAINTS,
  },
  {
    stepId: 'PLAN_STEP_RECONFIRM_NO_IMPORT',
    title: 'Reconfirm that no import and no database write is in scope',
    description:
      'A human confirms that no import path, no Supabase write and no migration is part of the attempt. Import readiness remains unapproved and is not implied by a reviewed plan.',
    ...STEP_CONSTRAINTS,
  },
  {
    stepId: 'PLAN_STEP_RECONFIRM_NO_RUNTIME',
    title: 'Reconfirm that no runtime surface is activated',
    description:
      'A human confirms that no runtime integration, feature flag or serving path is switched on by this plan or by its review. Runtime readiness remains unapproved.',
    ...STEP_CONSTRAINTS,
  },
  {
    stepId: 'PLAN_STEP_RECONFIRM_NO_AGENT1',
    title: 'Reconfirm that Agent 1 and every provider stay untouched',
    description:
      'A human confirms that no Agent 1 path is opened and no provider is called, so the attempt cannot spend a credit or generate a prospect. Agent 1 readiness remains unapproved.',
    ...STEP_CONSTRAINTS,
  },
  {
    stepId: 'PLAN_STEP_PREPARE_FUTURE_AUTHORIZATION_PACKET',
    title: 'Prepare a future authorization request for owner, legal, privacy and security review',
    description:
      'A human assembles what a real authorization request would have to contain — a signed owner decision, a legal / privacy / security review, an approved cap and input policy, and explicit GATE-2 and GATE-7 approvals. Preparing that request is not obtaining it, and this plan does not obtain any part of it.',
    ...STEP_CONSTRAINTS,
  },
] as const;

// ─── Preconditions, stop conditions, human actions ────────────────────────────

/**
 * What must already hold before this plan is even worth reading. The first five name the chain that
 * produced the plan; the last four restate what has NOT moved, because a precondition list that only
 * counted what was done would read like progress toward execution.
 */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_PRECONDITIONS: readonly string[] = [
  '13A_VALIDATOR_OFFICIAL',
  '13B_PREFLIGHT_EVALUATOR_OFFICIAL',
  '13C_SYNTHETIC_HARNESS_OFFICIAL',
  '13D_REQUEST_PACKET_GENERATOR_OFFICIAL',
  '13E_REVIEW_DECISION_VALIDATOR_OFFICIAL',
  'REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
] as const;

/**
 * The conditions under which the whole discussion halts. Each one names a way the plan could be
 * misread as permission — the last is the misreading this module exists to prevent.
 */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_STOP_CONDITIONS: readonly string[] = [
  'STOP_IF_ANY_REAL_DATA_PATH_IS_PROVIDED',
  'STOP_IF_MANIFEST_OR_CSV_OR_ZIP_IS_REQUESTED',
  'STOP_IF_IMPORT_OR_RUNTIME_OR_AGENT1_IS_REQUESTED',
  'STOP_IF_GATE_APPROVAL_IS_INFERRED',
  'STOP_IF_OWNER_DECISION_IS_MISSING',
  'STOP_IF_REVIEW_APPROVAL_IS_TREATED_AS_EXECUTION_AUTHORIZATION',
] as const;

/**
 * The actions that stay with a human no matter what the chain decided. Unconditional: a plan that
 * reached review-ready removes none of them, because no gate moved and no owner decision was made.
 */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_REQUIRED_HUMAN_ACTIONS: readonly string[] = [
  'HUMAN_REVIEW_ATTEMPT_PLAN',
  'OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION',
  'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
] as const;

/** Prepended when the plan is blocked, so the first thing a reader sees is what to fix. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_BLOCKED_HUMAN_ACTION =
  'RESOLVE_REVIEW_DECISION_BLOCKERS_BEFORE_REPLANNING' as const;

/** The plan-level blocker code, used when the review produced no approval to plan against. */
export const BRAZIL_RECEITA_ATTEMPT_PLAN_NOT_APPROVED_BLOCKER =
  'REVIEW_DECISION_DID_NOT_APPROVE' as const;

// ─── Plan shape ───────────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionAttemptPlan = {
  planType: typeof BRAZIL_RECEITA_ATTEMPT_PLAN_TYPE;
  version: typeof BRAZIL_RECEITA_ATTEMPT_PLAN_VERSION;
  generatedAt: typeof BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP;
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  reviewDecisionValue: BrazilReceitaControlledExecutionAttemptPlanReviewDecisionValue;
  status: BrazilReceitaControlledExecutionAttemptPlanStatus;
  goNoGo: 'GO' | 'NO_GO';

  syntheticOnly: true;
  planGenerated: true;
  executionStarted: false;
  executionAuthorized: false;
  realDataExecutionAuthorized: false;
  manifestReadAuthorized: false;
  csvZipReadAuthorized: false;
  rowReadsAuthorized: false;
  joinAuthorized: false;
  coverageAuthorized: false;
  importAuthorized: false;
  supabaseWritesAuthorized: false;
  runtimeAuthorized: false;
  agent1Authorized: false;
  providerCallsAuthorized: false;

  gate2Approved: false;
  gate7Approved: false;
  capInputPolicyApproved: false;
  controlledExecutionAttemptAuthorized: false;

  requestPacket: BrazilReceitaControlledExecutionRequestPacket;
  reviewValidation: BrazilReceitaControlledExecutionReviewDecisionValidationResult;

  planSteps: BrazilReceitaControlledExecutionAttemptPlanStep[];
  preconditions: string[];
  stopConditions: string[];
  requiredNextHumanActions: string[];
  blockers: string[];

  disclaimer: typeof BRAZIL_RECEITA_ATTEMPT_PLAN_DISCLAIMER;
};

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Classifies the decision value the plan was generated over. Anything 13E would not recognize is
 * reported as `unrecognized` rather than coerced into one of the three real positions.
 */
function readDecisionValue(
  decision: BrazilReceitaControlledExecutionReviewDecision,
): BrazilReceitaControlledExecutionAttemptPlanReviewDecisionValue {
  const raw = (decision as { readonly decisionValue?: unknown }).decisionValue;
  if (raw === 'approve' || raw === 'reject' || raw === 'defer') return raw;

  return 'unrecognized';
}

/**
 * A plan reaches `plan_ready_for_human_review` only when 13E's four signals all agree: the decision
 * was valid, it reached GO, its outcome was the approval-for-planning outcome, and it explicitly said
 * the request may proceed to a planning / review step. All four must hold; any disagreement blocks.
 *
 * Note what is deliberately absent from this predicate: there is nothing to check about execution,
 * because no combination of signals could ever authorize any.
 */
function isPlanReadyForHumanReview(
  review: BrazilReceitaControlledExecutionReviewDecisionValidationResult,
): boolean {
  return (
    review.status === 'valid' &&
    review.goNoGo === 'GO' &&
    review.decisionOutcome === 'approved_for_next_planning_review' &&
    review.canProceedToControlledExecutionAttemptPlanningReview
  );
}

/** Renders one blocking finding as a single line, keeping its origin visible. */
function formatReviewBlocker(finding: { readonly code: string; readonly field?: string }): string {
  return finding.field === undefined
    ? `REVIEW/${finding.code}`
    : `REVIEW/${finding.code} (${finding.field})`;
}

/**
 * Collects every reason the plan is blocked. The plan-level reason comes first — a reject or a defer
 * is a valid decision that leaves 13E with no blocking finding at all, so without this line a blocked
 * plan could present an empty blocker list and read like an oversight. The delegated 13E blocking
 * findings follow, in their own order, so the output stays deterministic.
 */
function collectBlockers(
  review: BrazilReceitaControlledExecutionReviewDecisionValidationResult,
  ready: boolean,
): string[] {
  const reviewBlockers = review.findings
    .filter((finding) => finding.severity === 'blocking')
    .map(formatReviewBlocker);

  if (ready) return reviewBlockers;

  return [
    `PLAN/${BRAZIL_RECEITA_ATTEMPT_PLAN_NOT_APPROVED_BLOCKER} (${review.decisionOutcome})`,
    ...reviewBlockers,
  ];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Builds the controlled execution attempt plan for a named 13C fixture and a reviewer decision.
 *
 * The packet comes from 13D and the verdict over the decision comes from 13E; this function adds no
 * upstream rule and relaxes none. What it adds is the plan itself: steps, preconditions, stop
 * conditions and the human actions still owed.
 *
 * A `plan_ready_for_human_review` plan states only that a plan EXISTS and a human may now be asked to
 * read it. It authorizes nothing: no gate is approved, no cap is set, nothing is started, and no
 * execution, real-data read, manifest/CSV/ZIP read, row read, join, coverage, import, Supabase write,
 * runtime, Agent 1 or provider path is opened. Brazil stays blocked.
 *
 * @throws Error when `fixtureName` is not one of
 *   {@link BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES} (raised by 13C, through 13D).
 */
export function buildBrazilReceitaControlledExecutionAttemptPlan(input: {
  readonly fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly reviewDecision: BrazilReceitaControlledExecutionReviewDecision;
}): BrazilReceitaControlledExecutionAttemptPlan {
  const requestPacket = buildBrazilReceitaControlledExecutionRequestPacket(input.fixtureName);
  const reviewValidation = validateBrazilReceitaControlledExecutionReviewDecision({
    packet: requestPacket,
    reviewDecision: input.reviewDecision,
  });

  const ready = isPlanReadyForHumanReview(reviewValidation);
  const blockers = collectBlockers(reviewValidation, ready);

  return {
    planType: BRAZIL_RECEITA_ATTEMPT_PLAN_TYPE,
    version: BRAZIL_RECEITA_ATTEMPT_PLAN_VERSION,
    generatedAt: BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP,
    fixture: input.fixtureName,
    reviewDecisionValue: readDecisionValue(input.reviewDecision),
    status: ready ? 'plan_ready_for_human_review' : 'blocked',
    goNoGo: ready ? 'GO' : 'NO_GO',

    syntheticOnly: true,
    planGenerated: true,
    ...BRAZIL_RECEITA_ATTEMPT_PLAN_WITHHELD,

    requestPacket,
    reviewValidation,

    planSteps: PLAN_STEPS.map((step) => ({ ...step })),
    preconditions: [...BRAZIL_RECEITA_ATTEMPT_PLAN_PRECONDITIONS],
    stopConditions: [...BRAZIL_RECEITA_ATTEMPT_PLAN_STOP_CONDITIONS],
    requiredNextHumanActions: ready
      ? [...BRAZIL_RECEITA_ATTEMPT_PLAN_REQUIRED_HUMAN_ACTIONS]
      : [
          BRAZIL_RECEITA_ATTEMPT_PLAN_BLOCKED_HUMAN_ACTION,
          ...BRAZIL_RECEITA_ATTEMPT_PLAN_REQUIRED_HUMAN_ACTIONS,
        ],
    blockers,

    disclaimer: BRAZIL_RECEITA_ATTEMPT_PLAN_DISCLAIMER,
  };
}

/**
 * Builds the whole synthetic plan for a named 13C fixture and a reviewer position: the 13D packet, a
 * SYNTHETIC 13E decision of the requested value, and the plan over both.
 *
 * The decision it feeds in is demonstration input built by 13E, never a human decision and never
 * evidence.
 *
 * @throws Error when `fixtureName` is not one of
 *   {@link BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES} (raised by 13C, through 13D).
 */
export function buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
  decisionValue: BrazilReceitaControlledExecutionReviewDecisionValue,
): BrazilReceitaControlledExecutionAttemptPlan {
  const packet = buildBrazilReceitaControlledExecutionRequestPacket(fixtureName);
  const reviewDecision = buildBrazilReceitaSyntheticControlledExecutionReviewDecision(
    packet,
    decisionValue,
  );

  return buildBrazilReceitaControlledExecutionAttemptPlan({ fixtureName, reviewDecision });
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

/** Booleans read as YES/NO, so a reader never has to parse a JSON literal. */
function yesNo(value: boolean): 'YES' | 'NO' {
  return value ? 'YES' : 'NO';
}

function renderList(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? ['- none'] : lines.map((line) => `- ${line}`);
}

function renderSteps(
  steps: readonly BrazilReceitaControlledExecutionAttemptPlanStep[],
): readonly string[] {
  return steps.flatMap((step, index) => [
    `### ${index + 1}. \`${step.stepId}\``,
    '',
    `- Title: ${step.title}`,
    `- Description: ${step.description}`,
    `- Execution allowed: ${yesNo(step.executionAllowed)}`,
    `- Real-data access allowed: ${yesNo(step.realDataAccessAllowed)}`,
    `- Requires human approval: ${yesNo(step.requiresHumanApproval)}`,
    '',
  ]);
}

/**
 * Renders the plan as Markdown. Pure and deterministic: every line is derived from the plan in a
 * fixed order, so the same plan always renders byte-identically.
 */
export function renderBrazilReceitaControlledExecutionAttemptPlanMarkdown(
  plan: BrazilReceitaControlledExecutionAttemptPlan,
): string {
  const { requestPacket, reviewValidation } = plan;

  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution attempt plan',
    '',
    `- Plan type: \`${plan.planType}\``,
    `- Version: ${plan.version}`,
    `- Generated at: \`${plan.generatedAt}\``,
    `- Fixture: \`${plan.fixture}\``,
    `- Review decision: **${plan.reviewDecisionValue}**`,
    `- Status: **${plan.status}**`,
    `- Go / No-Go: **${plan.goNoGo}**`,
    `- Synthetic only: ${yesNo(plan.syntheticOnly)}`,
    `- Plan generated: ${yesNo(plan.planGenerated)}`,
    '',
    '## State and authorizations withheld by this plan',
    '',
    'Every row below is withheld by construction. Generating a plan — or reviewing one — cannot',
    'change a single one of them.',
    '',
    '| State or authorization | Value |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_ATTEMPT_PLAN_WITHHELD_KEYS.map((key) => `| ${key} | ${yesNo(plan[key])} |`),
    '',
    '## Plan steps',
    '',
    'No step below is an executable command. Each one is a reconfirmation a human performs by reading.',
    '',
    ...renderSteps(plan.planSteps),
    '## Preconditions',
    '',
    ...renderList(plan.preconditions),
    '',
    '## Stop conditions',
    '',
    ...renderList(plan.stopConditions),
    '',
    '## Blockers',
    '',
    ...renderList(plan.blockers),
    '',
    '## Required next human actions',
    '',
    ...plan.requiredNextHumanActions.map((action, index) => `${index + 1}. \`${action}\``),
    '',
    '## Review decision this plan was generated over (BR-SOURCE-13E)',
    '',
    `- Review status: \`${reviewValidation.status}\``,
    `- Review Go / No-Go: \`${reviewValidation.goNoGo}\``,
    `- Review decision outcome: \`${reviewValidation.decisionOutcome}\``,
    `- May proceed to controlled execution attempt planning / review: ${yesNo(reviewValidation.canProceedToControlledExecutionAttemptPlanningReview)}`,
    `- Controlled execution attempt authorized by the review: ${yesNo(reviewValidation.controlledExecutionAttemptAuthorized)}`,
    '',
    'An approved review permits a planning / review step only. It is not an execution authorization,',
    'and this plan does not become one by existing.',
    '',
    '## Request packet under plan (BR-SOURCE-13D)',
    '',
    `- Packet type: \`${requestPacket.packetType}\``,
    `- Packet status: \`${requestPacket.status}\``,
    `- Packet Go / No-Go: \`${requestPacket.goNoGo}\``,
    `- Packet blockers: ${requestPacket.blockers.length}`,
    `- Packet disclaimer: ${requestPacket.disclaimer}`,
    '',
    '## Disclaimer',
    '',
    plan.disclaimer,
    '',
    'A generated plan is not a started run. Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes the plan in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionAttemptPlan(
  plan: BrazilReceitaControlledExecutionAttemptPlan,
  format: BrazilReceitaControlledExecutionAttemptPlanFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionAttemptPlanMarkdown(plan);
  }

  return pretty ? JSON.stringify(plan, null, 2) : JSON.stringify(plan);
}
