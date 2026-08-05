/**
 * BR Receita CNPJ — controlled execution readiness orchestrator (BR-SOURCE-13H).
 *
 * BR-SOURCE-13G produces the per-step ATTEMPT record: a runner that walks a plan and refuses every
 * step. What the chain still could not produce is the answer to the question a reader actually arrives
 * with — "so is Brazil ready?" — stated in one artefact, over the whole chain, in a form that cannot be
 * mistaken for a green light.
 *
 * 13H is that answer:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *                          →  13G controlled execution attempt runner scaffold
 *                          →  13H controlled execution readiness report
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A readiness report may say "the synthetic chain runs".
 *   A readiness report may NEVER say "ready", and it may never say "authorized".
 *
 *   Readiness report is not execution authorization.
 *
 * Two distinctions carry this module:
 *
 *   synthetic_chain_operational  ≠  production_ready
 *   readiness_report_generated   ≠  execution_authorization
 *
 * The whole point of a readiness report that cannot report readiness is the confusion it forecloses. By
 * 13G the chain has seven official components, all of them working, and a reader who watches seven
 * green modules produce a clean result can very reasonably conclude that the hard part is done. It is
 * not: every one of those components is synthetic, and not one of them moved a gate. So this module
 * reports both facts in the same artefact — the chain is operational, and Brazil is blocked — because
 * separating them is exactly how "the pipeline works" becomes "the pipeline is approved".
 *
 * ── Why a fully operational chain is still `NO_GO` ────────────────────────────
 * `synthetic_chain_operational_execution_blocked` is the interesting status, and it is deliberately a
 * compound sentence. Its first half is a genuine, earned yes: 13A through 13G exist, they run, and they
 * produced a result over a review-ready plan. Its second half is an unconditional no, and the second
 * half wins, because everything the first half describes happened over a SYNTHETIC fixture with no
 * owner authorization, no legal / privacy / security review, no approved cap and input policy, and no
 * GATE-2 or GATE-7 approval. A working chain is a statement about software. Readiness is a statement
 * about permission, and no amount of working software produces permission.
 *
 * `synthetic_chain_blocked` is the weaker case: the chain refused earlier — a fixture that never
 * reached a reviewable packet, or a reviewer who did not approve — so the plan's steps were never even
 * reached.
 *
 * Neither status is a pass. `productionReadiness` has exactly one member, `goNoGo` is always `NO_GO`,
 * and `readinessConclusion` is always `BRAZIL_REMAINS_BLOCKED`, so a `ready`, an `approved` or a `GO`
 * cannot be spelled in this module's types at all.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no filesystem, no path module, no network, no environment read, no
 *     argument vector, no child-process spawn.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - executes anything: the runner it consumes already refused every step, and this module only reads
 *     that refusal.
 *   - approves a gate, authorizes a cap, or marks Brazil ready for import, runtime or Agent 1.
 *   - re-implements any upstream rule. Every verdict it prints was produced by 13A–13G, and 13G's
 *     result travels inside the report verbatim.
 *
 * It is a pure function: same fixture and same decision, same report, no side effects, no mutation of
 * the input, no clock and no randomness. The report carries the chain's STATIC timestamp, so two runs
 * are byte-identical.
 */

import {
  BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES,
  BRAZIL_RECEITA_ATTEMPT_RUNNER_FORMATS,
  runBrazilReceitaControlledExecutionAttemptRunnerScaffold,
  type BrazilReceitaControlledExecutionAttemptRunnerFormat,
  type BrazilReceitaControlledExecutionAttemptRunnerResult,
} from './br-receita-cnpj-controlled-execution-attempt-runner-scaffold';
import type { BrazilReceitaControlledExecutionReviewDecisionValue } from './br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Stable identity of the artefact this module emits. */
export const BRAZIL_RECEITA_READINESS_REPORT_TYPE =
  'br_receita_cnpj_controlled_execution_readiness_report' as const;

/** Report schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_READINESS_VERSION = 1 as const;

/** The sentence that must accompany every report, including one over a fully operational chain. */
export const BRAZIL_RECEITA_READINESS_DISCLAIMER =
  'Readiness report is not execution authorization.' as const;

/** The single conclusion this module is permitted to reach, whatever the chain reported. */
export const BRAZIL_RECEITA_READINESS_CONCLUSION = 'BRAZIL_REMAINS_BLOCKED' as const;

/**
 * Output formats, aliased to 13G's type rather than restated, so the two lists can never drift.
 */
export type BrazilReceitaControlledExecutionReadinessFormat =
  BrazilReceitaControlledExecutionAttemptRunnerFormat;

/** Every output format, in documentation order, re-exported verbatim from 13G. */
export const BRAZIL_RECEITA_READINESS_FORMATS: readonly BrazilReceitaControlledExecutionReadinessFormat[] =
  BRAZIL_RECEITA_ATTEMPT_RUNNER_FORMATS;

/** The fixture catalogue, re-exported verbatim down the chain from 13C. */
export const BRAZIL_RECEITA_READINESS_FIXTURE_NAMES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_ATTEMPT_RUNNER_FIXTURE_NAMES;

/**
 * The two states a report can be in — both blocked for production, by construction.
 *
 * `synthetic_chain_operational_execution_blocked` is the compound one: 13A–13G ran end to end and
 * produced a result over a review-ready plan, and real execution is STILL refused.
 * `synthetic_chain_blocked` is the earlier refusal: the chain stopped before a reviewable plan existed.
 *
 * There is deliberately no third member. A `ready`, a `production_ready` or a `partially_ready` status
 * cannot be expressed in this type, so no code path and no future edit can report one without changing
 * this module's public contract.
 */
export type BrazilReceitaControlledExecutionReadinessStatus =
  | 'synthetic_chain_operational_execution_blocked'
  | 'synthetic_chain_blocked';

/**
 * Production readiness, as a type with exactly ONE member.
 *
 * This is the load-bearing shape of the whole module. A boolean would admit a `true`, and a wider union
 * would admit a `ready`; a single-member union admits neither. Marking Brazil ready is not a value this
 * module can produce — it is a change to this module's exported types, which no report is authorized to
 * make.
 */
export type BrazilReceitaControlledExecutionProductionReadiness = 'not_ready_blocked';

/** The one production-readiness value, named so callers never spell the literal themselves. */
export const BRAZIL_RECEITA_READINESS_PRODUCTION_READINESS: BrazilReceitaControlledExecutionProductionReadiness =
  'not_ready_blocked';

/**
 * Which layer of the chain raised a blocker. Kept explicit so a reader can tell an objection this
 * module owns from one it inherited, and act on the right artefact.
 */
export type BrazilReceitaControlledExecutionReadinessBlockerLayer =
  | 'owner_decision'
  | 'preflight'
  | 'request_packet'
  | 'review_decision'
  | 'attempt_plan'
  | 'runner_scaffold'
  | 'production_readiness';

export type BrazilReceitaControlledExecutionReadinessBlocker = {
  blockerId: string;
  layer: BrazilReceitaControlledExecutionReadinessBlockerLayer;
  severity: 'blocking';
  description: string;
};

/**
 * Every blocker is `blocking`. There is no advisory tier on purpose: a readiness report whose findings
 * could be graded down to "warning" would invite exactly the triage that produces a premature
 * execution.
 */
const BLOCKING: BrazilReceitaControlledExecutionReadinessBlocker['severity'] = 'blocking';

// ─── Withheld state ───────────────────────────────────────────────────────────

/**
 * Everything a readiness report can never assert, in any code path. Frozen as literal `false` so the
 * report type itself forbids a `true`; a future edit that tried to set one would have to change this
 * module's exported type, which no report is authorized to do.
 *
 * The four gate and authorization rows at the bottom are the ones this module exists to hold down. A
 * report that summarizes a working chain is precisely the document someone might read as "the
 * approvals must have happened by now", and these rows answer that in the artefact rather than in a
 * person's memory.
 */
export const BRAZIL_RECEITA_READINESS_WITHHELD = {
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
export const BRAZIL_RECEITA_READINESS_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_READINESS_WITHHELD)[] =
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

// ─── The official stack ───────────────────────────────────────────────────────

/**
 * The seven official components the report answers over, each `true` because each one is merged and
 * official.
 *
 * These are the only `true` values in the whole report besides `syntheticOnly`,
 * `readinessReportGenerated` and possibly `syntheticChainOperational` — and every one of them is a
 * statement about SOFTWARE existing, never about permission being granted. That is the distinction the
 * report is built to keep visible: seven official components and zero approvals is a coherent state,
 * and it is the state Brazil is actually in.
 */
export type BrazilReceitaControlledExecutionReadinessOfficialStack = {
  ownerDecisionValidator13A: true;
  preflightEvaluator13B: true;
  syntheticHarness13C: true;
  requestPacketGenerator13D: true;
  reviewDecisionValidator13E: true;
  attemptPlanGenerator13F: true;
  runnerScaffold13G: true;
};

const OFFICIAL_STACK: BrazilReceitaControlledExecutionReadinessOfficialStack = {
  ownerDecisionValidator13A: true,
  preflightEvaluator13B: true,
  syntheticHarness13C: true,
  requestPacketGenerator13D: true,
  reviewDecisionValidator13E: true,
  attemptPlanGenerator13F: true,
  runnerScaffold13G: true,
};

/** The official-stack keys, for callers that sweep every component. */
export const BRAZIL_RECEITA_READINESS_OFFICIAL_STACK_KEYS: readonly (keyof BrazilReceitaControlledExecutionReadinessOfficialStack)[] =
  [
    'ownerDecisionValidator13A',
    'preflightEvaluator13B',
    'syntheticHarness13C',
    'requestPacketGenerator13D',
    'reviewDecisionValidator13E',
    'attemptPlanGenerator13F',
    'runnerScaffold13G',
  ] as const;

// ─── Production blockers ──────────────────────────────────────────────────────

/**
 * The blockers every report carries, whatever the chain reported, each with the reason it stands.
 *
 * The list is deliberately longer than 13G's. 13G names what stops an ATTEMPT; a readiness report is
 * also asked whether Brazil is ready for the full join, for import, for runtime and for Agent 1, and
 * each of those is a separate unapproved thing that no other approval implies. Answering "is Brazil
 * ready?" with only the attempt-level blockers would leave four questions silently unanswered, and
 * silence in a readiness report reads as yes.
 */
export const BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKERS: readonly BrazilReceitaControlledExecutionReadinessBlocker[] =
  [
    {
      blockerId: 'CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'No controlled execution attempt is authorized. The synthetic chain produced a plan and an attempt record; neither is an authorization, and no signed owner decision exists.',
    },
    {
      blockerId: 'GATE_2_REMAINS_NOT_APPROVED',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'GATE-2 has not been approved. Nothing in the synthetic chain moves it, and a readiness report cannot approve it.',
    },
    {
      blockerId: 'GATE_7_REMAINS_NOT_APPROVED',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'GATE-7 has not been approved. Nothing in the synthetic chain moves it, and a readiness report cannot approve it.',
    },
    {
      blockerId: 'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'The cap and input policy has not been approved. Without it there is no agreed bound on what a controlled execution could read or spend.',
    },
    {
      blockerId: 'REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'Real-data execution is not authorized. Every artefact in this chain was built from a synthetic fixture, and no real record was read at any point.',
    },
    {
      blockerId: 'FULL_JOIN_EXECUTION_NOT_READY',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'Full join execution is not ready. No join and no coverage computation is authorized, and a reviewed plan does not imply one.',
    },
    {
      blockerId: 'IMPORT_NOT_READY',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'Import is not ready. No import path, no database write and no migration is authorized, and import readiness requires its own separate approval.',
    },
    {
      blockerId: 'RUNTIME_NOT_READY',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'Runtime is not ready. No runtime integration, feature flag or serving path is switched on, and runtime readiness requires its own separate approval.',
    },
    {
      blockerId: 'AGENT1_NOT_READY',
      layer: 'production_readiness',
      severity: BLOCKING,
      description:
        'Agent 1 is not ready. No Agent 1 path is opened and no provider is called, so no credit can be spent and no prospect generated; Agent 1 readiness requires its own separate approval.',
    },
  ] as const;

/** The production blocker ids, for callers that only need the identifiers. */
export const BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKER_IDS: readonly string[] =
  BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKERS.map((blocker) => blocker.blockerId);

// ─── Safety assertions and human actions ──────────────────────────────────────

/**
 * What this module asserts about its own behaviour, as a checkable list rather than a paragraph of
 * prose. Each line is a thing a reader might reasonably suspect an "orchestrator" of doing, denied
 * individually so no single denial has to carry all of them.
 *
 * The last line is this module's own addition to 13G's list, and it is the one that matters here: a
 * readiness report is the artefact most likely to be mistaken for a grant of readiness, so it denies
 * granting readiness explicitly.
 */
export const BRAZIL_RECEITA_READINESS_SAFETY_ASSERTIONS: readonly string[] = [
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
] as const;

/**
 * The actions that stay with a human no matter what the chain reported. Unconditional: a report over a
 * fully operational chain removes none of them, because no gate moved and no owner decision was made.
 *
 * The last four are spelled separately rather than folded into one "get authorization" line, because
 * they are four independent authorizations. A single line would let one approval be read as covering
 * all four, which is the specific mistake that turns a reviewed plan into an unreviewed import.
 */
export const BRAZIL_RECEITA_READINESS_REQUIRED_HUMAN_ACTIONS: readonly string[] = [
  'HUMAN_REVIEW_READINESS_REPORT',
  'OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION',
  'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
  'FULL_JOIN_EXECUTION_REQUIRES_SEPARATE_AUTHORIZATION',
  'IMPORT_REQUIRES_SEPARATE_AUTHORIZATION',
  'RUNTIME_REQUIRES_SEPARATE_AUTHORIZATION',
  'AGENT1_REQUIRES_SEPARATE_AUTHORIZATION',
] as const;

// ─── Report shape ─────────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionReadinessReport = {
  reportType: typeof BRAZIL_RECEITA_READINESS_REPORT_TYPE;
  version: typeof BRAZIL_RECEITA_READINESS_VERSION;
  generatedAt: BrazilReceitaControlledExecutionAttemptRunnerResult['generatedAt'];
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  reviewDecisionValue: BrazilReceitaControlledExecutionAttemptRunnerResult['reviewDecisionValue'];

  status: BrazilReceitaControlledExecutionReadinessStatus;
  goNoGo: 'NO_GO';
  productionReadiness: BrazilReceitaControlledExecutionProductionReadiness;

  syntheticOnly: true;
  readinessReportGenerated: true;
  syntheticChainOperational: boolean;

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

  runnerResult: BrazilReceitaControlledExecutionAttemptRunnerResult;

  officialStack: BrazilReceitaControlledExecutionReadinessOfficialStack;

  blockers: BrazilReceitaControlledExecutionReadinessBlocker[];
  safetyAssertions: string[];
  requiredNextHumanActions: string[];

  readinessConclusion: typeof BRAZIL_RECEITA_READINESS_CONCLUSION;
  disclaimer: typeof BRAZIL_RECEITA_READINESS_DISCLAIMER;
};

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Whether the synthetic chain ran end to end. Read straight off 13G's status; this module adds no
 * condition of its own and relaxes none.
 *
 * Note what this predicate does NOT decide: whether anything may run. Nothing in this module can make
 * that true, so there is no branch here that leads to an execution or to a readiness grant — both
 * branches end at `NO_GO`, and they differ only in which of the two blocked statuses is reported.
 */
function isSyntheticChainOperational(
  runnerResult: BrazilReceitaControlledExecutionAttemptRunnerResult,
): boolean {
  return runnerResult.status === 'blocked_no_execution_authorization';
}

/**
 * Wraps a blocker 13G reported as a typed readiness blocker at the `runner_scaffold` layer, preserving
 * the id verbatim.
 *
 * 13G's ids already carry their own provenance where they have one (`PLAN/` for a plan-layer objection,
 * `PLAN/REVIEW/` for a review-layer finding it passed up), and that inner prefix is deliberately kept
 * rather than rewritten: it is the trail back to the artefact that raised the objection, and this
 * module has no authority to discard it.
 */
function inheritRunnerBlocker(
  blockerId: string,
): BrazilReceitaControlledExecutionReadinessBlocker {
  return {
    blockerId,
    layer: 'runner_scaffold',
    severity: BLOCKING,
    description: `Raised by the BR-SOURCE-13G controlled execution attempt runner scaffold and carried into this report unchanged: ${blockerId}.`,
  };
}

/**
 * Collects every reason Brazil is not ready: this module's unconditional production list first, then
 * every blocker 13G reported, tagged with its layer.
 *
 * The production list comes first, and it is never conditional. A report that only forwarded the
 * chain's blockers would present the operational case as having five objections — all of them about
 * the ATTEMPT — and say nothing at all about the full join, import, runtime or Agent 1, which is
 * precisely the reading this module exists to prevent.
 *
 * An id can therefore appear twice, once per layer. That repetition is information, not noise: it
 * distinguishes "the production-readiness layer holds this open" from "the runner scaffold also raised
 * it", and collapsing the two would erase which layer a reader has to go and satisfy.
 */
function collectBlockers(
  runnerResult: BrazilReceitaControlledExecutionAttemptRunnerResult,
): BrazilReceitaControlledExecutionReadinessBlocker[] {
  return [
    ...BRAZIL_RECEITA_READINESS_PRODUCTION_BLOCKERS,
    ...runnerResult.blockers.map(inheritRunnerBlocker),
  ];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Builds the controlled execution readiness report for a named 13C fixture and a reviewer position.
 *
 * The attempt record comes from 13G — which walked 13F's plan, which sourced its packet from 13D and
 * its verdict from 13E, and delegated the owner artifact through 13B to 13A. This function adds no
 * upstream rule and relaxes none. What it adds is the readiness answer: whether the synthetic chain
 * ran, what still blocks real execution, and what a human must do next.
 *
 * The report is ALWAYS `NO_GO`, always `not_ready_blocked` and always concludes
 * `BRAZIL_REMAINS_BLOCKED`, including over a chain that ran end to end and produced a result over a
 * review-ready plan. Nothing is started, nothing is attempted, and no execution, real-data read,
 * manifest / CSV / ZIP read, row read, join, coverage, import, Supabase write, runtime, Agent 1 or
 * provider path is opened. No gate is approved, no cap is set, and Brazil is marked ready for nothing.
 *
 * @throws Error when `fixtureName` is not one of {@link BRAZIL_RECEITA_READINESS_FIXTURE_NAMES} (raised
 *   by 13C, and surfaced through 13D, 13F and 13G).
 */
export function buildBrazilReceitaControlledExecutionReadinessReport(input: {
  readonly fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly reviewDecisionValue: BrazilReceitaControlledExecutionReviewDecisionValue;
}): BrazilReceitaControlledExecutionReadinessReport {
  const runnerResult = runBrazilReceitaControlledExecutionAttemptRunnerScaffold({
    fixtureName: input.fixtureName,
    reviewDecisionValue: input.reviewDecisionValue,
  });

  const operational = isSyntheticChainOperational(runnerResult);

  return {
    reportType: BRAZIL_RECEITA_READINESS_REPORT_TYPE,
    version: BRAZIL_RECEITA_READINESS_VERSION,
    generatedAt: runnerResult.generatedAt,
    fixture: input.fixtureName,
    reviewDecisionValue: runnerResult.reviewDecisionValue,

    status: operational
      ? 'synthetic_chain_operational_execution_blocked'
      : 'synthetic_chain_blocked',
    goNoGo: 'NO_GO',
    productionReadiness: BRAZIL_RECEITA_READINESS_PRODUCTION_READINESS,

    syntheticOnly: true,
    readinessReportGenerated: true,
    syntheticChainOperational: operational,

    ...BRAZIL_RECEITA_READINESS_WITHHELD,

    runnerResult,
    officialStack: { ...OFFICIAL_STACK },

    blockers: collectBlockers(runnerResult),
    safetyAssertions: [...BRAZIL_RECEITA_READINESS_SAFETY_ASSERTIONS],
    requiredNextHumanActions: [...BRAZIL_RECEITA_READINESS_REQUIRED_HUMAN_ACTIONS],

    readinessConclusion: BRAZIL_RECEITA_READINESS_CONCLUSION,
    disclaimer: BRAZIL_RECEITA_READINESS_DISCLAIMER,
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

function renderBlockers(
  blockers: readonly BrazilReceitaControlledExecutionReadinessBlocker[],
): readonly string[] {
  if (blockers.length === 0) return ['- none'];

  return blockers.flatMap((blocker) => [
    `- \`${blocker.blockerId}\` — layer \`${blocker.layer}\`, severity **${blocker.severity}**`,
    `  - ${blocker.description}`,
  ]);
}

/**
 * Renders the report as Markdown. Pure and deterministic: every line is derived from the report in a
 * fixed order, so the same report always renders byte-identically.
 *
 * The two headline questions are answered next to each other on purpose — "did the chain run" and "is
 * Brazil ready" — because a reader who sees only the first will supply the wrong answer to the second.
 */
export function renderBrazilReceitaControlledExecutionReadinessReportMarkdown(
  report: BrazilReceitaControlledExecutionReadinessReport,
): string {
  const { runnerResult } = report;

  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution readiness report',
    '',
    `- Report type: \`${report.reportType}\``,
    `- Version: ${report.version}`,
    `- Generated at: \`${report.generatedAt}\``,
    `- Fixture: \`${report.fixture}\``,
    `- Review decision: **${report.reviewDecisionValue}**`,
    `- Status: **${report.status}**`,
    `- Go / No-Go: **${report.goNoGo}**`,
    `- Production readiness: **${report.productionReadiness}**`,
    `- Synthetic only: ${yesNo(report.syntheticOnly)}`,
    `- Readiness report generated: ${yesNo(report.readinessReportGenerated)}`,
    `- Synthetic chain operational: ${yesNo(report.syntheticChainOperational)}`,
    '',
    '## The two questions, answered separately',
    '',
    `1. Does the synthetic chain 13A→13G exist and run? **${yesNo(report.syntheticChainOperational)}**`,
    `2. Is Brazil ready for real controlled execution, import, runtime or Agent 1? **NO**`,
    '',
    'These are different questions, and only the first one is about software. An operational synthetic',
    'chain is a statement about code that exists and runs. Readiness is a statement about permission,',
    'and no amount of working code produces permission.',
    '',
    'A generated readiness report is not an execution authorization, and an operational synthetic chain',
    'is not production readiness.',
    '',
    '## Official stack this report answers over',
    '',
    '| Component | Official |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_READINESS_OFFICIAL_STACK_KEYS.map(
      (key) => `| ${key} | ${yesNo(report.officialStack[key])} |`,
    ),
    '',
    'Seven official components and zero approvals is a coherent state, and it is the state Brazil is in.',
    '',
    '## State and authorizations withheld by this report',
    '',
    'Every row below is withheld by construction. Generating a readiness report — or reading one —',
    'cannot change a single one of them.',
    '',
    '| State or authorization | Value |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_READINESS_WITHHELD_KEYS.map((key) => `| ${key} | ${yesNo(report[key])} |`),
    '',
    '## What blocks real execution',
    '',
    'Every blocker below is `blocking`. There is no advisory tier, and no blocker is satisfied by any',
    'other: the four readiness questions — full join, import, runtime, Agent 1 — each require their own',
    'separate authorization.',
    '',
    ...renderBlockers(report.blockers),
    '',
    '## Safety assertions',
    '',
    ...renderList(report.safetyAssertions),
    '',
    '## Required next human actions',
    '',
    ...report.requiredNextHumanActions.map((action, index) => `${index + 1}. \`${action}\``),
    '',
    '## Attempt record this report summarizes (BR-SOURCE-13G)',
    '',
    `- Result type: \`${runnerResult.resultType}\``,
    `- Runner status: \`${runnerResult.status}\``,
    `- Runner Go / No-Go: \`${runnerResult.goNoGo}\``,
    `- Plan status: \`${runnerResult.plan.status}\``,
    `- Plan Go / No-Go: \`${runnerResult.plan.goNoGo}\``,
    `- Step results: ${runnerResult.stepResults.length}`,
    `- Runner blockers: ${runnerResult.blockers.length}`,
    `- Execution started by the runner: ${yesNo(runnerResult.executionStarted)}`,
    `- Controlled execution attempt authorized by the runner: ${yesNo(runnerResult.controlledExecutionAttemptAuthorized)}`,
    `- Runner disclaimer: ${runnerResult.disclaimer}`,
    '',
    'No step in that record was executed, and summarizing it here did not execute one either.',
    '',
    '## Conclusion',
    '',
    `- Readiness conclusion: **${report.readinessConclusion}**`,
    '',
    report.disclaimer,
    '',
    'Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes the report in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionReadinessReport(
  report: BrazilReceitaControlledExecutionReadinessReport,
  format: BrazilReceitaControlledExecutionReadinessFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionReadinessReportMarkdown(report);
  }

  return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
}
