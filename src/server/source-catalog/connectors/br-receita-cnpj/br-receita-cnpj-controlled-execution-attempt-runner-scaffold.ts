/**
 * BR Receita CNPJ — controlled execution attempt runner scaffold (BR-SOURCE-13G).
 *
 * BR-SOURCE-13F produces the PLAN a human reads before a controlled execution attempt: its steps, its
 * preconditions, its stop conditions, and the human actions still owed. What the chain still could not
 * produce is the shape of the ATTEMPT itself — the per-step record a reader can point at to see, step
 * by step, that nothing ran and why.
 *
 * 13G is that record:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *                          →  13G controlled execution attempt runner scaffold
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A runner scaffold may say "blocked".
 *   A runner scaffold may NEVER say "started", and it may never say "authorized".
 *
 *   Runner scaffold result is not execution authorization.
 *
 * Two distinctions carry this module:
 *
 *   runner_scaffold_created   ≠  execution_started
 *   attempt_result_generated  ≠  real_data_execution
 *
 * The point of a runner that cannot run is the asymmetry it makes visible. 13F could be misread as the
 * last document before execution — a plan marked `plan_ready_for_human_review` with a `GO`, sitting
 * there looking like a green light. 13G takes that exact plan, walks every step it contains, and
 * produces `NO_GO` with a blocked result for each one. A reader who reaches a review-ready plan and
 * asks "so does it run now?" gets the answer in the artifact instead of in a person's memory.
 *
 * ── Why `GO` upstream still means `NO_GO` here ────────────────────────────────
 * 13F's `GO` is a statement about a DOCUMENT: a plan exists and is worth a human's attention. It says
 * nothing about permission to act, because 13E's `approve` only ever authorized a planning / review
 * step. So the readiest possible plan produces the runner's `blocked_no_execution_authorization`:
 * there is nothing wrong with the plan, and there is still no authorization to execute it. The other
 * status, `blocked_plan_not_ready`, is the weaker case — the plan itself never became reviewable, so
 * its steps are not even reached.
 *
 * Neither status is a failure of this module. Both are the correct outcome, and there is no third one:
 * the status type has exactly two members, so a `ran`, a `started` or a `completed` cannot be spelled.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no fs, no path module, no network, no env, no argv, no child-process
 *     spawn.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - executes a plan step: every step becomes a `blocked` or `skipped` RECORD, never an action.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *   - re-implements 13A's, 13B's, 13D's, 13E's or 13F's rules; every verdict it prints was produced by
 *     them, and the plan it walks travels inside the result verbatim.
 *
 * It is a pure function: same fixture and same decision, same result, no side effects, no mutation of
 * the input, no clock and no randomness. The result carries the plan's STATIC timestamp, so two runs
 * are byte-identical.
 */

import {
  BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES,
  BRAZIL_RECEITA_ATTEMPT_PLAN_FORMATS,
  buildBrazilReceitaSyntheticControlledExecutionAttemptPlan,
  type BrazilReceitaControlledExecutionAttemptPlan,
  type BrazilReceitaControlledExecutionAttemptPlanFormat,
  type BrazilReceitaControlledExecutionAttemptPlanStep,
} from './br-receita-cnpj-controlled-execution-attempt-plan-generator';
import type { BrazilReceitaControlledExecutionReviewDecisionValue } from './br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Stable identity of the artefact this module emits. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_RESULT_TYPE =
  'br_receita_cnpj_controlled_execution_attempt_runner_scaffold_result' as const;

/** Result schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_VERSION = 1 as const;

/** The sentence that must accompany every result, including one over a review-ready plan. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_DISCLAIMER =
  'Runner scaffold result is not execution authorization.' as const;

/**
 * Output formats, aliased to 13F's type rather than restated, so the two lists can never drift.
 */
export type BrazilReceitaControlledExecutionAttemptRunnerFormat =
  BrazilReceitaControlledExecutionAttemptPlanFormat;

/** Every output format, in documentation order, re-exported verbatim from 13F. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_FORMATS: readonly BrazilReceitaControlledExecutionAttemptRunnerFormat[] =
  BRAZIL_RECEITA_ATTEMPT_PLAN_FORMATS;

/** The fixture catalogue, re-exported verbatim from 13F (which re-exports 13D's, which re-exports 13C's). */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_ATTEMPT_PLAN_FIXTURE_NAMES;

/**
 * The two states a result can be in — both blocked, by construction.
 *
 * `blocked_no_execution_authorization` is the interesting one: the plan was review-ready and the
 * attempt is STILL refused, because no execution authorization exists. `blocked_plan_not_ready` is the
 * earlier refusal: the plan never became reviewable, so its steps are not reached at all.
 *
 * There is deliberately no third member. A `ran`, a `started`, a `partial` or a `completed` status
 * cannot be expressed in this type, so no code path and no future edit can report one without changing
 * this module's public contract.
 */
export type BrazilReceitaControlledExecutionAttemptRunnerStatus =
  | 'blocked_no_execution_authorization'
  | 'blocked_plan_not_ready';

/**
 * The reviewer position the attempt was scaffolded over. Read straight off 13F's plan — 13G classifies
 * nothing itself — so `unrecognized` travels through whenever 13F reported it.
 */
export type BrazilReceitaControlledExecutionAttemptRunnerReviewDecisionValue =
  BrazilReceitaControlledExecutionAttemptPlan['reviewDecisionValue'];

// ─── Withheld state ───────────────────────────────────────────────────────────

/**
 * Everything a runner scaffold result can never assert, in any code path. Frozen as literal `false` so
 * the result type itself forbids a `true`; a future edit that tried to set one would have to change
 * this module's exported type, which no result is authorized to do.
 *
 * `executionStarted` and `executionAttempted` sit in this table on purpose, and they are the two that
 * matter most here. A runner is exactly the component a reader would expect to flip them, and this one
 * cannot: it has no code that acts, only code that records that it did not.
 */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_WITHHELD = {
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
} as const;

/** The withheld keys, for callers that sweep the whole set. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_ATTEMPT_RUNNER_WITHHELD)[] =
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
  ] as const;

// ─── Step results ─────────────────────────────────────────────────────────────

/**
 * What a step record can never claim. Same construction as the result-level table: literal `false`, so
 * a step that had touched real data could not be built without changing the step type.
 */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_WITHHELD = {
  executionAttempted: false,
  realDataAccessed: false,
  manifestRead: false,
  csvZipRead: false,
  rowReads: false,
  importExecuted: false,
  supabaseWrites: false,
  runtimeActivated: false,
  agent1Activated: false,
  providerCalls: false,
} as const;

/** The withheld step keys, for callers that sweep every step of every result. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_WITHHELD)[] =
  [
    'executionAttempted',
    'realDataAccessed',
    'manifestRead',
    'csvZipRead',
    'rowReads',
    'importExecuted',
    'supabaseWrites',
    'runtimeActivated',
    'agent1Activated',
    'providerCalls',
  ] as const;

/**
 * The two dispositions a step can receive, and neither is an execution.
 *
 * `blocked` means the step was REACHED and refused: the plan was review-ready, so this step is one a
 * human would genuinely perform next, and it stops for want of authorization. `skipped` means the step
 * was never reached, because the plan it belongs to never became reviewable.
 *
 * The distinction is worth keeping: `blocked` says "this is the wall", `skipped` says "we never got to
 * the wall". Collapsing them would lose which of the two refusals actually happened.
 */
export type BrazilReceitaControlledExecutionAttemptStepStatus = 'blocked' | 'skipped';

/** Why a step was blocked: the plan was reviewable, and there is still no authorization to act. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_BLOCKED_REASON =
  'CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED' as const;

/** Why a step was skipped: the plan never reached review-ready, so its steps are not reached. */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_SKIPPED_REASON =
  'PLAN_NOT_READY_FOR_ATTEMPT' as const;

export type BrazilReceitaControlledExecutionAttemptStepResult = {
  stepId: string;
  title: string;
  status: BrazilReceitaControlledExecutionAttemptStepStatus;
  reason: string;
  executionAttempted: false;
  realDataAccessed: false;
  manifestRead: false;
  csvZipRead: false;
  rowReads: false;
  importExecuted: false;
  supabaseWrites: false;
  runtimeActivated: false;
  agent1Activated: false;
  providerCalls: false;
};

// ─── Blockers, assertions, human actions ──────────────────────────────────────

/**
 * The blockers every result carries, whatever the plan said. The first names what this module refuses;
 * the rest restate what has NOT moved, because a blocker list that only named the immediate refusal
 * could be read as "authorize the attempt and the rest follows". It does not: four separate approvals
 * are still outstanding, and none of them is implied by any of the others.
 */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS: readonly string[] = [
  'CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
  'REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED',
] as const;

/**
 * What this module asserts about its own behaviour, as a checkable list rather than a paragraph of
 * prose. Each line is a thing a reader might reasonably suspect a "runner" of doing, denied
 * individually so no single denial has to carry all of them.
 */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_SAFETY_ASSERTIONS: readonly string[] = [
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
] as const;

/**
 * The actions that stay with a human no matter what the plan or the review decided. Unconditional: a
 * result over a review-ready plan removes none of them, because no gate moved and no owner decision
 * was made.
 */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_REQUIRED_HUMAN_ACTIONS: readonly string[] = [
  'HUMAN_REVIEW_RUNNER_SCAFFOLD_RESULT',
  'OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION',
  'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
] as const;

/**
 * Prefix applied to every blocker inherited from 13F, so a reader can tell a plan-layer objection from
 * this module's own. 13F's blockers already carry their own origin (`PLAN/` for its plan-level reason,
 * `REVIEW/` for a delegated 13E finding), and that inner prefix is deliberately preserved rather than
 * rewritten: `PLAN/REVIEW/...` reads as "the plan layer passed up a review-layer finding", which is
 * exactly the provenance a reviewer needs, and stripping or collapsing it would destroy information
 * this module has no authority to discard.
 */
export const BRAZIL_RECEITA_ATTEMPT_RUNNER_PLAN_BLOCKER_PREFIX = 'PLAN' as const;

// ─── Result shape ─────────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionAttemptRunnerResult = {
  resultType: typeof BRAZIL_RECEITA_ATTEMPT_RUNNER_RESULT_TYPE;
  version: typeof BRAZIL_RECEITA_ATTEMPT_RUNNER_VERSION;
  generatedAt: BrazilReceitaControlledExecutionAttemptPlan['generatedAt'];
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  reviewDecisionValue: BrazilReceitaControlledExecutionAttemptRunnerReviewDecisionValue;
  status: BrazilReceitaControlledExecutionAttemptRunnerStatus;
  goNoGo: 'NO_GO';

  syntheticOnly: true;
  runnerScaffoldCreated: true;
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

  plan: BrazilReceitaControlledExecutionAttemptPlan;
  stepResults: BrazilReceitaControlledExecutionAttemptStepResult[];

  blockers: string[];
  safetyAssertions: string[];
  requiredNextHumanActions: string[];

  disclaimer: typeof BRAZIL_RECEITA_ATTEMPT_RUNNER_DISCLAIMER;
};

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Whether 13F's plan reached the document state that makes its steps worth walking. Both of 13F's own
 * signals must agree; this module adds no condition of its own and relaxes none.
 *
 * Note what this predicate does NOT decide: whether anything may run. Nothing in this module can make
 * that true, so there is no branch here that leads to an execution.
 */
function isPlanReadyForAttemptWalk(plan: BrazilReceitaControlledExecutionAttemptPlan): boolean {
  return plan.status === 'plan_ready_for_human_review' && plan.goNoGo === 'GO';
}

/**
 * Records one plan step as a step RESULT. `ready` selects which refusal applies — the step was reached
 * and blocked, or never reached and skipped — and nothing else about the step changes: the title comes
 * from 13F verbatim, and every permission stays false through the shared withheld table.
 */
function recordStep(
  step: BrazilReceitaControlledExecutionAttemptPlanStep,
  ready: boolean,
): BrazilReceitaControlledExecutionAttemptStepResult {
  return {
    stepId: step.stepId,
    title: step.title,
    status: ready ? 'blocked' : 'skipped',
    reason: ready
      ? BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_BLOCKED_REASON
      : BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_SKIPPED_REASON,
    ...BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_WITHHELD,
  };
}

/**
 * Collects every reason the attempt is blocked: this module's unconditional list first, then — when the
 * plan itself was blocked — the plan's own blockers, each tagged with its origin layer.
 *
 * The unconditional list comes first on purpose. A review-ready plan leaves 13F with no blockers at
 * all, so a result that only forwarded the plan's list would present an empty one and read like an
 * oversight, when in fact the readiest possible plan is refused for four separate outstanding
 * approvals.
 */
function collectBlockers(
  plan: BrazilReceitaControlledExecutionAttemptPlan,
  ready: boolean,
): string[] {
  if (ready) return [...BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS];

  return [
    ...BRAZIL_RECEITA_ATTEMPT_RUNNER_BLOCKERS,
    ...plan.blockers.map(
      (blocker) => `${BRAZIL_RECEITA_ATTEMPT_RUNNER_PLAN_BLOCKER_PREFIX}/${blocker}`,
    ),
  ];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Builds the controlled execution attempt runner scaffold result for a named 13C fixture and a reviewer
 * position.
 *
 * The plan comes from 13F — which sourced its packet from 13D and its verdict from 13E, and delegated
 * the owner artifact through 13B to 13A. This function adds no upstream rule and relaxes none. What it
 * adds is the attempt record: a per-step disposition, the blockers in force, and the human actions
 * still owed.
 *
 * The result is ALWAYS `NO_GO` and always blocked, including over a plan that reached
 * `plan_ready_for_human_review` with a `GO`. Nothing is started, nothing is attempted, and no
 * execution, real-data read, manifest / CSV / ZIP read, row read, join, coverage, import, Supabase
 * write, runtime, Agent 1 or provider path is opened. No gate is approved, no cap is set. Brazil stays
 * blocked.
 *
 * The synthetic reviewer decision is built by 13F's own synthetic builder rather than reconstructed
 * here, so this module cannot drift from how 13E and 13F spell a decision of a given value.
 *
 * @throws Error when `fixtureName` is not one of
 *   {@link BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES} (raised by 13C, through 13D and 13F).
 */
export function runBrazilReceitaControlledExecutionAttemptRunnerScaffold(input: {
  readonly fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly reviewDecisionValue: BrazilReceitaControlledExecutionReviewDecisionValue;
}): BrazilReceitaControlledExecutionAttemptRunnerResult {
  const plan = buildBrazilReceitaSyntheticControlledExecutionAttemptPlan(
    input.fixtureName,
    input.reviewDecisionValue,
  );

  const ready = isPlanReadyForAttemptWalk(plan);

  return {
    resultType: BRAZIL_RECEITA_ATTEMPT_RUNNER_RESULT_TYPE,
    version: BRAZIL_RECEITA_ATTEMPT_RUNNER_VERSION,
    generatedAt: plan.generatedAt,
    fixture: input.fixtureName,
    reviewDecisionValue: plan.reviewDecisionValue,
    status: ready ? 'blocked_no_execution_authorization' : 'blocked_plan_not_ready',
    goNoGo: 'NO_GO',

    syntheticOnly: true,
    runnerScaffoldCreated: true,
    ...BRAZIL_RECEITA_ATTEMPT_RUNNER_WITHHELD,

    plan,
    stepResults: plan.planSteps.map((step) => recordStep(step, ready)),

    blockers: collectBlockers(plan, ready),
    safetyAssertions: [...BRAZIL_RECEITA_ATTEMPT_RUNNER_SAFETY_ASSERTIONS],
    requiredNextHumanActions: [...BRAZIL_RECEITA_ATTEMPT_RUNNER_REQUIRED_HUMAN_ACTIONS],

    disclaimer: BRAZIL_RECEITA_ATTEMPT_RUNNER_DISCLAIMER,
  };
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

/** Booleans read as YES/NO, so a reader never has to parse a JSON literal. */
function yesNo(value: boolean): 'YES' | 'NO' {
  return value ? 'YES' : 'NO';
}

function renderList(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? ['- none'] : lines.map((line) => `- ${line}`);
}

function renderStepResults(
  stepResults: readonly BrazilReceitaControlledExecutionAttemptStepResult[],
): readonly string[] {
  return stepResults.flatMap((step, index) => [
    `### ${index + 1}. \`${step.stepId}\``,
    '',
    `- Title: ${step.title}`,
    `- Status: **${step.status}**`,
    `- Reason: \`${step.reason}\``,
    ...BRAZIL_RECEITA_ATTEMPT_RUNNER_STEP_WITHHELD_KEYS.map(
      (key) => `- ${key}: ${yesNo(step[key])}`,
    ),
    '',
  ]);
}

/**
 * Renders the result as Markdown. Pure and deterministic: every line is derived from the result in a
 * fixed order, so the same result always renders byte-identically.
 */
export function renderBrazilReceitaControlledExecutionAttemptRunnerScaffoldMarkdown(
  result: BrazilReceitaControlledExecutionAttemptRunnerResult,
): string {
  const { plan } = result;

  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution attempt runner scaffold result',
    '',
    `- Result type: \`${result.resultType}\``,
    `- Version: ${result.version}`,
    `- Generated at: \`${result.generatedAt}\``,
    `- Fixture: \`${result.fixture}\``,
    `- Review decision: **${result.reviewDecisionValue}**`,
    `- Status: **${result.status}**`,
    `- Go / No-Go: **${result.goNoGo}**`,
    `- Synthetic only: ${yesNo(result.syntheticOnly)}`,
    `- Runner scaffold created: ${yesNo(result.runnerScaffoldCreated)}`,
    '',
    '## No execution authorization',
    '',
    'This runner scaffold did not execute anything, and it could not have. There is no execution',
    'authorization, so the attempt is blocked in every case — including over a plan that reached',
    '`plan_ready_for_human_review` with a `GO`, which states only that a plan exists and is worth a',
    "human's attention.",
    '',
    'A created runner scaffold is not a started run, and a generated attempt result is not a real-data',
    'execution.',
    '',
    '## State and authorizations withheld by this result',
    '',
    'Every row below is withheld by construction. Creating a runner scaffold — or reading its result —',
    'cannot change a single one of them.',
    '',
    '| State or authorization | Value |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_ATTEMPT_RUNNER_WITHHELD_KEYS.map((key) => `| ${key} | ${yesNo(result[key])} |`),
    '',
    '## Step results',
    '',
    'No step below was executed. `blocked` means the step was reached and refused for want of',
    'authorization; `skipped` means the plan never became reviewable, so the step was never reached.',
    '',
    ...renderStepResults(result.stepResults),
    '## Blockers',
    '',
    ...renderList(result.blockers),
    '',
    '## Safety assertions',
    '',
    ...renderList(result.safetyAssertions),
    '',
    '## Required next human actions',
    '',
    ...result.requiredNextHumanActions.map((action, index) => `${index + 1}. \`${action}\``),
    '',
    '## Plan this attempt was scaffolded over (BR-SOURCE-13F)',
    '',
    `- Plan type: \`${plan.planType}\``,
    `- Plan status: \`${plan.status}\``,
    `- Plan Go / No-Go: \`${plan.goNoGo}\``,
    `- Plan steps: ${plan.planSteps.length}`,
    `- Plan blockers: ${plan.blockers.length}`,
    `- Execution started by the plan: ${yesNo(plan.executionStarted)}`,
    `- Controlled execution attempt authorized by the plan: ${yesNo(plan.controlledExecutionAttemptAuthorized)}`,
    `- Plan disclaimer: ${plan.disclaimer}`,
    '',
    'A plan ready for human review permits a human to read it. It is not an execution authorization,',
    'and walking its steps here did not make it one.',
    '',
    '## Disclaimer',
    '',
    result.disclaimer,
    '',
    'A created runner scaffold is not a started run. Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes the result in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionAttemptRunnerScaffoldResult(
  result: BrazilReceitaControlledExecutionAttemptRunnerResult,
  format: BrazilReceitaControlledExecutionAttemptRunnerFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionAttemptRunnerScaffoldMarkdown(result);
  }

  return pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
}
