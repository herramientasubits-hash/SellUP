/**
 * BR Receita CNPJ — controlled execution authorization handoff packet (BR-SOURCE-13I).
 *
 * BR-SOURCE-13H answers the question a reader arrives with — "is Brazil ready?" — and answers it `NO_GO`
 * over a chain that is fully operational. What it does NOT answer is the question that follows
 * immediately: "then what, exactly, is missing, and who has to decide it?" A readiness report enumerates
 * blockers; blockers describe a state. A person who has to unblock Brazil needs decisions, addressed to
 * owners, each one bounded so that granting it cannot be read as granting the next.
 *
 * 13I is that document:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  13D request packet
 *                          →  13E review decision validation
 *                          →  13F controlled execution attempt plan
 *                          →  13G controlled execution attempt runner scaffold
 *                          →  13H controlled execution readiness report
 *                          →  13I controlled execution authorization handoff packet
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   handoff_packet_ready  ≠  execution_authorized
 *   human_decision_packet ≠  owner approval
 *
 *   Authorization handoff packet is not execution authorization.
 *
 * The first line is the one this module exists to hold. A handoff packet is, by construction, the most
 * approval-shaped artefact in the chain: it is addressed to owners, it lists decisions, and it is
 * explicitly "ready for human decision". Every one of those properties describes a document that has
 * been PREPARED, and none of them describes a decision that has been MADE. Preparing a decision request
 * is not answering it, and a packet that is ready to be reviewed is precisely a packet that has not been
 * reviewed.
 *
 * The second line guards the other direction. This module writes the nine decisions down, together with
 * who should take each one; it does not take any of them, and it has no input by which an approval could
 * be supplied. The `reviewDecisionValue` it accepts is a SYNTHETIC reviewer position travelling down from
 * 13E, whose own verdict is `approved_for_next_planning_review` — permission to keep planning, never
 * permission to run.
 *
 * ── Why nine decisions and not one ───────────────────────────────────────────
 * The nine are separated because they are genuinely independent, and because folding them together is the
 * specific failure this chain has been built to prevent. Approving GATE-2 does not authorize import.
 * Approving GATE-7 does not authorize import. An approved cap and input policy does not authorize
 * runtime. Authorizing a full join does not authorize import. Authorizing import does not authorize
 * runtime. Authorizing runtime does not authorize Agent 1. And authorizing Agent 1 cannot skip GATE-2,
 * GATE-7 or the cap and input policy — the last one matters most, because Agent 1 is where a credit is
 * actually spent, so it is where an implied approval becomes an invoice.
 *
 * Each decision therefore carries its own `approvalDoesNotGrant` list and its own
 * `separateAuthorizationRequired: true`. A reader who approves one line has, in the same artefact, the
 * list of things they did not approve.
 *
 * ── Two statuses, both blocked ───────────────────────────────────────────────
 * `handoff_ready_for_human_decision` means 13H reported an operational synthetic chain, so there is a
 * coherent packet to hand over. `handoff_blocked_by_readiness` means the chain stopped earlier and the
 * packet reports that instead. Neither is a pass: `goNoGo` is always `NO_GO`, `authorizationStatus` is
 * always `not_authorized`, and `brazilReadiness` is always `blocked`. The latter two are single-member
 * unions, so an `authorized` and a `ready` cannot be spelled in this module's types at all — marking
 * Brazil ready is not a value this module can produce, it is a change to this module's public contract.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no filesystem, no path module, no network, no environment read, no
 *     argument vector, no child spawn.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - runs a join or a coverage computation.
 *   - opens a database client, writes to a database, or applies a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - runs anything: the runner inside the report it consumes already refused every step, and this module
 *     only reads that refusal.
 *   - approves a gate, authorizes a cap, or marks Brazil ready for the full join, import, runtime or
 *     Agent 1.
 *   - re-implements any upstream rule. Every verdict it prints was produced by 13A–13H, and 13H's report
 *     travels inside the packet verbatim.
 *
 * It is a pure function: same fixture and same decision, same packet, no side effects, no mutation of the
 * input, no clock and no randomness. The packet carries the chain's STATIC timestamp, so two runs are
 * byte-identical.
 */

import {
  BRAZIL_RECEITA_READINESS_FIXTURE_NAMES,
  BRAZIL_RECEITA_READINESS_FORMATS,
  buildBrazilReceitaControlledExecutionReadinessReport,
  type BrazilReceitaControlledExecutionReadinessFormat,
  type BrazilReceitaControlledExecutionReadinessReport,
} from './br-receita-cnpj-controlled-execution-readiness-orchestrator';
import type { BrazilReceitaControlledExecutionReviewDecisionValue } from './br-receita-cnpj-controlled-execution-review-decision-validator';
import type { BrazilReceitaSyntheticOwnerArtifactFixtureName } from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Stable identity of the artefact this module emits. */
export const BRAZIL_RECEITA_HANDOFF_PACKET_TYPE =
  'br_receita_cnpj_controlled_execution_authorization_handoff_packet' as const;

/** Packet schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_HANDOFF_VERSION = 1 as const;

/** The sentence that must accompany every packet, including one that is ready for review. */
export const BRAZIL_RECEITA_HANDOFF_DISCLAIMER =
  'Authorization handoff packet is not execution authorization.' as const;

/** The one conclusion this module may reach about the handoff itself. */
export const BRAZIL_RECEITA_HANDOFF_CONCLUSION = 'OWNER_LEGAL_SECURITY_DECISION_REQUIRED' as const;

/** The one conclusion this module may reach about Brazil, whatever the chain reported. */
export const BRAZIL_RECEITA_HANDOFF_READINESS_CONCLUSION = 'BRAZIL_REMAINS_BLOCKED' as const;

/**
 * Output formats, aliased down the chain rather than restated, so the lists can never drift.
 */
export type BrazilReceitaControlledExecutionAuthorizationHandoffFormat =
  BrazilReceitaControlledExecutionReadinessFormat;

/** Every output format, in documentation order, re-exported verbatim from 13H. */
export const BRAZIL_RECEITA_HANDOFF_FORMATS: readonly BrazilReceitaControlledExecutionAuthorizationHandoffFormat[] =
  BRAZIL_RECEITA_READINESS_FORMATS;

/** The fixture catalogue, re-exported verbatim down the chain from 13C. */
export const BRAZIL_RECEITA_HANDOFF_FIXTURE_NAMES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_READINESS_FIXTURE_NAMES;

/**
 * The two states a handoff packet can be in — both blocked, by construction.
 *
 * `handoff_ready_for_human_decision` is the interesting one, and it is deliberately named for the
 * REVIEW being ready rather than for anything being permitted. Its precondition is 13H reporting an
 * operational synthetic chain; its consequence is a document a human can now read. Nothing about it is a
 * grant.
 *
 * `handoff_blocked_by_readiness` is the earlier refusal: 13H reported a chain that stopped before a
 * reviewable plan existed, so there is no coherent decision packet to hand over yet.
 *
 * There is deliberately no third member. A `handoff_approved`, an `authorized` or a `ready` cannot be
 * expressed in this type.
 */
export type BrazilReceitaControlledExecutionAuthorizationHandoffStatus =
  | 'handoff_ready_for_human_decision'
  | 'handoff_blocked_by_readiness';

/**
 * Authorization status, as a type with exactly ONE member.
 *
 * A boolean would admit a `true` and a wider union would admit an `authorized`; a single-member union
 * admits neither. This module cannot report an authorization because it cannot express one.
 */
export type BrazilReceitaControlledExecutionAuthorizationStatus = 'not_authorized';

/** The one authorization value, named so callers never spell the literal themselves. */
export const BRAZIL_RECEITA_HANDOFF_AUTHORIZATION_STATUS: BrazilReceitaControlledExecutionAuthorizationStatus =
  'not_authorized';

/**
 * Brazil readiness, also a type with exactly ONE member, for the same reason.
 */
export type BrazilReceitaControlledExecutionBrazilReadiness = 'blocked';

/** The one Brazil-readiness value. */
export const BRAZIL_RECEITA_HANDOFF_BRAZIL_READINESS: BrazilReceitaControlledExecutionBrazilReadiness =
  'blocked';

// ─── The nine decisions ───────────────────────────────────────────────────────

/**
 * The nine pending decisions, as identifiers.
 *
 * They are ordered as a human would take them — the owner's own resubmission first, the two gates and
 * the cap and input policy next, then the four escalating authorizations — but the order is presentation
 * only. No decision unlocks another, and the list is exhaustive in both directions: nothing outside it
 * is being requested here, and nothing inside it can be skipped.
 */
export type BrazilReceitaControlledExecutionAuthorizationDecisionId =
  | 'OWNER_COMPLETION_RESUBMISSION'
  | 'GATE_2_ROUTE_DECISION'
  | 'GATE_7_PRIVACY_SECURITY_DECISION'
  | 'CAP_INPUT_POLICY_APPROVAL'
  | 'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION'
  | 'FULL_JOIN_EXECUTION_AUTHORIZATION'
  | 'IMPORT_AUTHORIZATION'
  | 'RUNTIME_AUTHORIZATION'
  | 'AGENT1_AUTHORIZATION';

/**
 * Who should take a decision. Kept explicit because "someone should approve this" is how a decision
 * stays unowned, and an unowned decision is the one that eventually gets taken implicitly by whoever is
 * closest to the keyboard.
 */
export type BrazilReceitaControlledExecutionAuthorizationDecisionOwner =
  | 'owner'
  | 'legal_security_privacy'
  | 'technical_owner'
  | 'commercial_operations';

/**
 * The current state of a decision. Every member is a negative, and that is the whole point: there is no
 * `approved` and no `authorized` in this union, so no packet can report a decision as taken.
 *
 * `missing` means the input itself has not arrived. `not_approved` means an approval was asked for and
 * has not been given. `not_authorized` means an authorization was asked for and has not been granted.
 */
export type BrazilReceitaControlledExecutionAuthorizationDecisionStatus =
  | 'missing'
  | 'not_approved'
  | 'not_authorized';

export type BrazilReceitaControlledExecutionAuthorizationDecisionRequest = {
  decisionId: BrazilReceitaControlledExecutionAuthorizationDecisionId;
  decisionOwner: BrazilReceitaControlledExecutionAuthorizationDecisionOwner;
  currentStatus: BrazilReceitaControlledExecutionAuthorizationDecisionStatus;
  requiredDecision: string;
  approvalEffect: string;
  approvalDoesNotGrant: string[];
  separateAuthorizationRequired: true;
};

/**
 * The nine decision requests, in full.
 *
 * Every entry answers six questions in a fixed shape: who decides, where the decision stands, what is
 * being asked, what saying yes would achieve, what saying yes would NOT achieve, and whether anything
 * else still needs its own authorization. The fifth field is the load-bearing one — it is where the
 * chain of implication is broken explicitly, one approval at a time — and the sixth is `true` for all
 * nine without exception, because there is no decision here that carries another.
 */
const DECISION_REQUESTS: readonly BrazilReceitaControlledExecutionAuthorizationDecisionRequest[] = [
  {
    decisionId: 'OWNER_COMPLETION_RESUBMISSION',
    decisionOwner: 'owner',
    currentStatus: 'missing',
    requiredDecision:
      'The owner must complete and resubmit the owner decision completion packet, with every required section filled in, every placeholder replaced, and the evidence mode stated for each answer.',
    approvalEffect:
      'A valid resubmission gives the chain a REAL owner artifact to validate instead of a synthetic fixture, so BR-SOURCE-13A and BR-SOURCE-13B would evaluate a genuine submission for the first time.',
    approvalDoesNotGrant: [
      'GATE_2_APPROVAL',
      'GATE_7_APPROVAL',
      'CAP_INPUT_POLICY_APPROVAL',
      'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      'FULL_JOIN_EXECUTION_AUTHORIZATION',
      'IMPORT_AUTHORIZATION',
      'RUNTIME_AUTHORIZATION',
      'AGENT1_AUTHORIZATION',
    ],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'GATE_2_ROUTE_DECISION',
    decisionOwner: 'owner',
    currentStatus: 'not_approved',
    requiredDecision:
      'The owner must take the GATE-2 route decision on the record: which route is chosen, which controls apply to it, and what evidence supports the choice.',
    approvalEffect:
      'An approved GATE-2 route decision settles WHICH route is sanctioned and under which controls. It settles nothing else.',
    approvalDoesNotGrant: [
      'GATE_7_APPROVAL',
      'CAP_INPUT_POLICY_APPROVAL',
      'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      'FULL_JOIN_EXECUTION_AUTHORIZATION',
      'IMPORT_AUTHORIZATION',
      'RUNTIME_AUTHORIZATION',
      'AGENT1_AUTHORIZATION',
    ],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'GATE_7_PRIVACY_SECURITY_DECISION',
    decisionOwner: 'legal_security_privacy',
    currentStatus: 'not_approved',
    requiredDecision:
      'Legal, privacy and security must take the GATE-7 decision on the record, covering the lawful basis, the personal-data boundary, retention, and the security controls that apply to anything handled under it.',
    approvalEffect:
      'An approved GATE-7 decision settles the privacy and security position. It is a legal and security finding, not an operational permission.',
    approvalDoesNotGrant: [
      'GATE_2_APPROVAL',
      'CAP_INPUT_POLICY_APPROVAL',
      'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      'FULL_JOIN_EXECUTION_AUTHORIZATION',
      'IMPORT_AUTHORIZATION',
      'RUNTIME_AUTHORIZATION',
      'AGENT1_AUTHORIZATION',
    ],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'CAP_INPUT_POLICY_APPROVAL',
    decisionOwner: 'technical_owner',
    currentStatus: 'not_approved',
    requiredDecision:
      'The technical owner must approve the cap and input policy: which inputs are admissible, which are refused, and the hard bound on volume, cost and credits that any bounded run may not exceed.',
    approvalEffect:
      'An approved cap and input policy gives a future bounded run an agreed ceiling and an agreed input surface. It bounds a run that is still not authorized.',
    approvalDoesNotGrant: [
      'GATE_2_APPROVAL',
      'GATE_7_APPROVAL',
      'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      'FULL_JOIN_EXECUTION_AUTHORIZATION',
      'IMPORT_AUTHORIZATION',
      'RUNTIME_AUTHORIZATION',
      'AGENT1_AUTHORIZATION',
    ],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
    decisionOwner: 'owner',
    currentStatus: 'not_authorized',
    requiredDecision:
      'The owner must issue a real, signed authorization for one bounded controlled execution attempt, naming its scope, its cap and the evidence it must produce. No such authorization exists.',
    approvalEffect:
      'A signed attempt authorization would permit exactly ONE bounded attempt inside the approved cap, and only once GATE-2, GATE-7 and the cap and input policy are approved.',
    approvalDoesNotGrant: [
      'GATE_2_APPROVAL',
      'GATE_7_APPROVAL',
      'CAP_INPUT_POLICY_APPROVAL',
      'FULL_JOIN_EXECUTION_AUTHORIZATION',
      'IMPORT_AUTHORIZATION',
      'RUNTIME_AUTHORIZATION',
      'AGENT1_AUTHORIZATION',
    ],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'FULL_JOIN_EXECUTION_AUTHORIZATION',
    decisionOwner: 'technical_owner',
    currentStatus: 'not_authorized',
    requiredDecision:
      'The technical owner must authorize full join execution separately, including the join grain, the field allowlist, the output sanitization and the coverage computation it is permitted to run.',
    approvalEffect:
      'A full join authorization would permit a join and its coverage computation over an approved input, writing sanitized output to nothing but a reviewable artefact.',
    approvalDoesNotGrant: ['IMPORT_AUTHORIZATION', 'RUNTIME_AUTHORIZATION', 'AGENT1_AUTHORIZATION'],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'IMPORT_AUTHORIZATION',
    decisionOwner: 'technical_owner',
    currentStatus: 'not_authorized',
    requiredDecision:
      'The technical owner must authorize import separately, naming the staging contract, the eligibility rules, the database writes it may perform and the migrations it depends on.',
    approvalEffect:
      'An import authorization would permit writing an approved, sanitized result into the agreed staging surface.',
    approvalDoesNotGrant: ['RUNTIME_AUTHORIZATION', 'AGENT1_AUTHORIZATION'],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'RUNTIME_AUTHORIZATION',
    decisionOwner: 'technical_owner',
    currentStatus: 'not_authorized',
    requiredDecision:
      'The technical owner must authorize runtime separately, naming the serving path, the feature flags involved and the rollback procedure.',
    approvalEffect:
      'A runtime authorization would permit imported data to be served. Serving data is not generating prospects from it.',
    approvalDoesNotGrant: ['AGENT1_AUTHORIZATION'],
    separateAuthorizationRequired: true,
  },
  {
    decisionId: 'AGENT1_AUTHORIZATION',
    decisionOwner: 'commercial_operations',
    currentStatus: 'not_authorized',
    requiredDecision:
      'Commercial operations must authorize Agent 1 separately, naming the credit budget, the provider calls permitted and the spend ceiling per run. Agent 1 is where a credit is actually spent.',
    approvalEffect:
      'An Agent 1 authorization would permit live prospect generation over served data, inside an explicit credit budget.',
    approvalDoesNotGrant: [
      'GATE_2_APPROVAL',
      'GATE_7_APPROVAL',
      'CAP_INPUT_POLICY_APPROVAL',
      'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION',
      'FULL_JOIN_EXECUTION_AUTHORIZATION',
      'IMPORT_AUTHORIZATION',
      'RUNTIME_AUTHORIZATION',
    ],
    separateAuthorizationRequired: true,
  },
] as const;

/** The nine decision requests, exposed so callers never restate them. */
export const BRAZIL_RECEITA_HANDOFF_DECISION_REQUESTS: readonly BrazilReceitaControlledExecutionAuthorizationDecisionRequest[] =
  DECISION_REQUESTS;

/** The nine decision ids, in the same order, for callers that only need the identifiers. */
export const BRAZIL_RECEITA_HANDOFF_DECISION_IDS: readonly BrazilReceitaControlledExecutionAuthorizationDecisionId[] =
  DECISION_REQUESTS.map((request) => request.decisionId);

// ─── Withheld state ───────────────────────────────────────────────────────────

/**
 * Everything a handoff packet can never assert, in any code path. Frozen as literal `false` so the
 * packet type itself forbids a `true`.
 *
 * The four gate and authorization rows at the bottom are the ones this module exists to hold down. A
 * packet addressed to owners, listing decisions, marked ready for human decision, is exactly the
 * document someone might read as "so the approvals are in" — and these rows answer that in the artefact
 * rather than in a person's memory.
 */
export const BRAZIL_RECEITA_HANDOFF_WITHHELD = {
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
export const BRAZIL_RECEITA_HANDOFF_WITHHELD_KEYS: readonly (keyof typeof BRAZIL_RECEITA_HANDOFF_WITHHELD)[] =
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

// ─── Blockers ─────────────────────────────────────────────────────────────────

/**
 * The blockers every packet carries, whatever the chain reported.
 *
 * The first four cover the inputs and approvals that have not arrived; the next five cover the five
 * separate authorizations that have not been granted; the last states the conclusion as a blocker in its
 * own right, so a reader who scans only this list still reaches it.
 *
 * The list is unconditional on purpose. A packet whose blocker list shrank when the synthetic chain ran
 * cleanly would be telling a reader that progress had been made on permission, when the only progress
 * was in software.
 */
export const BRAZIL_RECEITA_HANDOFF_BLOCKERS: readonly string[] = [
  'OWNER_COMPLETION_RESUBMISSION_NOT_RECEIVED',
  'OWNER_DECISIONS_NOT_CAPTURED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
  'CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED',
  'FULL_JOIN_EXECUTION_NOT_AUTHORIZED',
  'IMPORT_NOT_AUTHORIZED',
  'RUNTIME_NOT_AUTHORIZED',
  'AGENT1_NOT_AUTHORIZED',
  'BRAZIL_REMAINS_BLOCKED',
] as const;

/**
 * The prefix applied to every blocker inherited from 13H.
 *
 * Provenance is kept because the two layers are satisfied in different places: a blocker this module
 * owns is closed by a human decision, while a `READINESS/` blocker is closed — if ever — by the chain
 * reporting differently. Erasing the prefix would send a reader to the wrong artefact.
 */
export const BRAZIL_RECEITA_HANDOFF_READINESS_BLOCKER_PREFIX = 'READINESS/' as const;

// ─── Safety assertions and human actions ──────────────────────────────────────

/**
 * What this module asserts about its own behaviour, as a checkable list rather than prose. Each line is
 * a thing a reader might reasonably suspect a "handoff packet generator" of doing, denied individually so
 * no single denial has to carry all of them.
 *
 * The last three are the ones that matter here. A packet that requests nine approvals is the artefact
 * most likely to be mistaken for having received one, so it denies granting a gate approval, granting
 * production readiness, and granting execution authorization, explicitly and separately.
 */
export const BRAZIL_RECEITA_HANDOFF_SAFETY_ASSERTIONS: readonly string[] = [
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
] as const;

/**
 * The actions that stay with a human no matter what the chain reported. Unconditional: a packet over a
 * fully operational chain removes none of them.
 *
 * The nine decision-shaped lines mirror the nine decision requests one for one, deliberately. A single
 * "obtain the necessary authorizations" line would let one approval be read as covering all nine, which
 * is the exact mistake that turns a reviewed plan into an unreviewed import.
 */
export const BRAZIL_RECEITA_HANDOFF_REQUIRED_HUMAN_ACTIONS: readonly string[] = [
  'HUMAN_REVIEW_AUTHORIZATION_HANDOFF_PACKET',
  'OWNER_MUST_COMPLETE_RESUBMISSION',
  'OWNER_MUST_CAPTURE_FORMAL_DECISIONS',
  'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
  'GATE_2_DECISION_REQUIRED',
  'GATE_7_DECISION_REQUIRED',
  'CAP_INPUT_POLICY_DECISION_REQUIRED',
  'CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION_REQUIRED',
  'FULL_JOIN_EXECUTION_AUTHORIZATION_REQUIRED',
  'IMPORT_AUTHORIZATION_REQUIRED',
  'RUNTIME_AUTHORIZATION_REQUIRED',
  'AGENT1_AUTHORIZATION_REQUIRED',
] as const;

// ─── Packet shape ─────────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionAuthorizationHandoffPacket = {
  packetType: typeof BRAZIL_RECEITA_HANDOFF_PACKET_TYPE;
  version: typeof BRAZIL_RECEITA_HANDOFF_VERSION;
  generatedAt: BrazilReceitaControlledExecutionReadinessReport['generatedAt'];
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  reviewDecisionValue: BrazilReceitaControlledExecutionReadinessReport['reviewDecisionValue'];

  status: BrazilReceitaControlledExecutionAuthorizationHandoffStatus;
  goNoGo: 'NO_GO';
  authorizationStatus: BrazilReceitaControlledExecutionAuthorizationStatus;
  brazilReadiness: BrazilReceitaControlledExecutionBrazilReadiness;

  syntheticOnly: true;
  handoffPacketGenerated: true;
  humanDecisionPacketReady: boolean;

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

  readinessReport: BrazilReceitaControlledExecutionReadinessReport;

  decisionRequests: BrazilReceitaControlledExecutionAuthorizationDecisionRequest[];
  unresolvedAuthorizations: BrazilReceitaControlledExecutionAuthorizationDecisionId[];
  blockers: string[];
  safetyAssertions: string[];
  requiredNextHumanActions: string[];

  handoffConclusion: typeof BRAZIL_RECEITA_HANDOFF_CONCLUSION;
  readinessConclusion: typeof BRAZIL_RECEITA_HANDOFF_READINESS_CONCLUSION;

  disclaimer: typeof BRAZIL_RECEITA_HANDOFF_DISCLAIMER;
};

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Whether there is a coherent packet to hand over. Read straight off 13H's status; this module adds no
 * condition of its own and relaxes none.
 *
 * Note what this predicate does NOT decide: whether anything may run, or whether any decision has been
 * taken. Nothing in this module can make either true, so both branches end at `NO_GO` and differ only in
 * which of the two blocked statuses is reported.
 */
function isHandoffReadyForHumanDecision(
  readinessReport: BrazilReceitaControlledExecutionReadinessReport,
): boolean {
  return readinessReport.status === 'synthetic_chain_operational_execution_blocked';
}

/**
 * Collects every reason Brazil is blocked: this module's unconditional list first, then every blocker
 * 13H reported, each prefixed with its provenance.
 *
 * Identical inherited ids are collapsed to one entry, in first-seen order. 13H keeps its repetitions
 * because each carries a distinct `layer` field that tells them apart; here a blocker is a bare string,
 * so two identical strings would carry no information at all beyond the first.
 */
function collectBlockers(
  readinessReport: BrazilReceitaControlledExecutionReadinessReport,
): string[] {
  const inherited: string[] = [];

  for (const blocker of readinessReport.blockers) {
    const prefixed = `${BRAZIL_RECEITA_HANDOFF_READINESS_BLOCKER_PREFIX}${blocker.blockerId}`;
    if (!inherited.includes(prefixed)) inherited.push(prefixed);
  }

  return [...BRAZIL_RECEITA_HANDOFF_BLOCKERS, ...inherited];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Builds the controlled execution authorization handoff packet for a named 13C fixture and a synthetic
 * reviewer position.
 *
 * The readiness report comes from 13H — which summarized 13G's attempt record over 13F's plan, whose
 * packet came from 13D and whose verdict came from 13E, and which delegated the owner artifact through
 * 13B to 13A. This function adds no upstream rule and relaxes none. What it adds is the handoff: the
 * nine decisions that are still open, who should take each one, and what taking one would and would not
 * grant.
 *
 * The packet is ALWAYS `NO_GO`, always `not_authorized`, always `blocked`, and always concludes
 * `BRAZIL_REMAINS_BLOCKED` — including over a chain that ran end to end. Nothing is started, nothing is
 * attempted, and no execution, real-data read, manifest / CSV / ZIP read, row read, join, coverage,
 * import, database write, runtime, Agent 1 or provider path is opened. No gate is approved, no cap is
 * set, and Brazil is marked ready for nothing.
 *
 * @throws Error when `fixtureName` is not one of {@link BRAZIL_RECEITA_HANDOFF_FIXTURE_NAMES} (raised by
 *   13C, and surfaced down the chain through 13D, 13F, 13G and 13H).
 */
export function buildBrazilReceitaControlledExecutionAuthorizationHandoffPacket(input: {
  readonly fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  readonly reviewDecisionValue: BrazilReceitaControlledExecutionReviewDecisionValue;
}): BrazilReceitaControlledExecutionAuthorizationHandoffPacket {
  const readinessReport = buildBrazilReceitaControlledExecutionReadinessReport({
    fixtureName: input.fixtureName,
    reviewDecisionValue: input.reviewDecisionValue,
  });

  const ready = isHandoffReadyForHumanDecision(readinessReport);

  return {
    packetType: BRAZIL_RECEITA_HANDOFF_PACKET_TYPE,
    version: BRAZIL_RECEITA_HANDOFF_VERSION,
    generatedAt: readinessReport.generatedAt,
    fixture: input.fixtureName,
    reviewDecisionValue: readinessReport.reviewDecisionValue,

    status: ready ? 'handoff_ready_for_human_decision' : 'handoff_blocked_by_readiness',
    goNoGo: 'NO_GO',
    authorizationStatus: BRAZIL_RECEITA_HANDOFF_AUTHORIZATION_STATUS,
    brazilReadiness: BRAZIL_RECEITA_HANDOFF_BRAZIL_READINESS,

    syntheticOnly: true,
    handoffPacketGenerated: true,
    humanDecisionPacketReady: ready,

    ...BRAZIL_RECEITA_HANDOFF_WITHHELD,

    readinessReport,

    decisionRequests: DECISION_REQUESTS.map((request) => ({
      ...request,
      approvalDoesNotGrant: [...request.approvalDoesNotGrant],
    })),
    unresolvedAuthorizations: [...BRAZIL_RECEITA_HANDOFF_DECISION_IDS],
    blockers: collectBlockers(readinessReport),
    safetyAssertions: [...BRAZIL_RECEITA_HANDOFF_SAFETY_ASSERTIONS],
    requiredNextHumanActions: [...BRAZIL_RECEITA_HANDOFF_REQUIRED_HUMAN_ACTIONS],

    handoffConclusion: BRAZIL_RECEITA_HANDOFF_CONCLUSION,
    readinessConclusion: BRAZIL_RECEITA_HANDOFF_READINESS_CONCLUSION,

    disclaimer: BRAZIL_RECEITA_HANDOFF_DISCLAIMER,
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

/**
 * Renders one decision request as its own subsection. Each of the six fields is rendered on its own
 * line, and `approvalDoesNotGrant` as its own nested list, so no field can be skimmed past.
 */
function renderDecisionRequest(
  request: BrazilReceitaControlledExecutionAuthorizationDecisionRequest,
  index: number,
): readonly string[] {
  return [
    `### ${index + 1}. \`${request.decisionId}\``,
    '',
    `- Decision owner: \`${request.decisionOwner}\``,
    `- Current status: **${request.currentStatus}**`,
    `- Separate authorization required: ${yesNo(request.separateAuthorizationRequired)}`,
    `- Required decision: ${request.requiredDecision}`,
    `- What approving it would achieve: ${request.approvalEffect}`,
    '- What approving it would NOT grant:',
    ...request.approvalDoesNotGrant.map((item) => `  - \`${item}\``),
    '',
  ];
}

/**
 * Renders the packet as Markdown. Pure and deterministic: every line is derived from the packet in a
 * fixed order, so the same packet always renders byte-identically.
 *
 * The two headline questions are answered next to each other on purpose — "is the packet ready" and "is
 * Brazil authorized" — because a reader who sees only the first will supply the wrong answer to the
 * second.
 */
export function renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(
  packet: BrazilReceitaControlledExecutionAuthorizationHandoffPacket,
): string {
  const { readinessReport } = packet;

  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution authorization handoff packet',
    '',
    `- Packet type: \`${packet.packetType}\``,
    `- Version: ${packet.version}`,
    `- Generated at: \`${packet.generatedAt}\``,
    `- Fixture: \`${packet.fixture}\``,
    `- Review decision: **${packet.reviewDecisionValue}**`,
    `- Status: **${packet.status}**`,
    `- Go / No-Go: **${packet.goNoGo}**`,
    `- Authorization status: **${packet.authorizationStatus}**`,
    `- Brazil readiness: **${packet.brazilReadiness}**`,
    `- Synthetic only: ${yesNo(packet.syntheticOnly)}`,
    `- Handoff packet generated: ${yesNo(packet.handoffPacketGenerated)}`,
    `- Human decision packet ready: ${yesNo(packet.humanDecisionPacketReady)}`,
    '',
    '## The two questions, answered separately',
    '',
    `1. Is there a packet a human can now review? **${yesNo(packet.humanDecisionPacketReady)}**`,
    '2. Is any controlled execution, full join, import, runtime or Agent 1 path authorized? **NO**',
    '',
    'These are different questions. A packet that is ready to be reviewed is precisely a packet that has',
    'not been reviewed, and preparing a decision request is not answering it.',
    '',
    'A generated handoff packet is not an execution authorization, and a human decision packet is not an',
    'owner approval.',
    '',
    '## Decisions still pending',
    '',
    `There are ${packet.decisionRequests.length} pending decisions, and they are independent. No approval`,
    'below carries any other: each one states what it would grant and what it would not, and every one of',
    'them requires its own separate authorization.',
    '',
    ...packet.decisionRequests.flatMap(renderDecisionRequest),
    '## Unresolved authorizations',
    '',
    ...renderList(packet.unresolvedAuthorizations),
    '',
    '## State and authorizations withheld by this packet',
    '',
    'Every row below is withheld by construction. Generating a handoff packet — or reading one — cannot',
    'change a single one of them.',
    '',
    '| State or authorization | Value |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_HANDOFF_WITHHELD_KEYS.map((key) => `| ${key} | ${yesNo(packet[key])} |`),
    '',
    '## Blockers',
    '',
    'Blockers this packet owns are closed by a human decision. Blockers prefixed',
    `\`${BRAZIL_RECEITA_HANDOFF_READINESS_BLOCKER_PREFIX}\` were raised by the BR-SOURCE-13H readiness`,
    'report and are carried here unchanged.',
    '',
    ...renderList(packet.blockers),
    '',
    '## Safety assertions',
    '',
    ...renderList(packet.safetyAssertions),
    '',
    '## Required next human actions',
    '',
    ...packet.requiredNextHumanActions.map((action, index) => `${index + 1}. \`${action}\``),
    '',
    '## Readiness report this packet hands over (BR-SOURCE-13H)',
    '',
    `- Report type: \`${readinessReport.reportType}\``,
    `- Readiness status: \`${readinessReport.status}\``,
    `- Readiness Go / No-Go: \`${readinessReport.goNoGo}\``,
    `- Production readiness: \`${readinessReport.productionReadiness}\``,
    `- Synthetic chain operational: ${yesNo(readinessReport.syntheticChainOperational)}`,
    `- Readiness blockers: ${readinessReport.blockers.length}`,
    `- Controlled execution attempt authorized by the readiness report: ${yesNo(readinessReport.controlledExecutionAttemptAuthorized)}`,
    `- Readiness disclaimer: ${readinessReport.disclaimer}`,
    '',
    'Handing that report to a reader did not approve a gate, authorize a run, or move Brazil one step',
    'closer to ready.',
    '',
    '## Conclusion',
    '',
    `- Handoff conclusion: **${packet.handoffConclusion}**`,
    `- Readiness conclusion: **${packet.readinessConclusion}**`,
    '',
    packet.disclaimer,
    '',
    'Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes the packet in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionAuthorizationHandoffPacket(
  packet: BrazilReceitaControlledExecutionAuthorizationHandoffPacket,
  format: BrazilReceitaControlledExecutionAuthorizationHandoffFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionAuthorizationHandoffPacketMarkdown(packet);
  }

  return pretty ? JSON.stringify(packet, null, 2) : JSON.stringify(packet);
}
