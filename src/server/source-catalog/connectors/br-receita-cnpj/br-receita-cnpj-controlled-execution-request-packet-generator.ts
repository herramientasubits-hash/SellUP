/**
 * BR Receita CNPJ — controlled execution request packet generator (BR-SOURCE-13D).
 *
 * BR-SOURCE-13A answers "is this owner artifact complete, consistent and safe?". 13B answers "may
 * this request proceed to a controlled execution attempt review?". 13C supplies the synthetic input
 * that lets both run without a real owner artifact. What none of them produce is the ARTEFACT a human
 * reviewer is actually asked to read: a packet that states, in one place, what is being requested,
 * what the chain decided, and — above all — everything the packet does NOT grant.
 *
 * 13D is that artefact:
 *
 *   13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
 *                          →  request packet (JSON or Markdown)
 *
 * ── Central rule ─────────────────────────────────────────────────────────────
 *   A packet may say "ready_for_review".
 *   A packet may NEVER say "ready to execute".
 *
 *   Ready for review is not ready for execution.
 *
 * `ready_for_review` names a DOCUMENT transition: a human may now be asked to read the request. It
 * is not an owner decision, not a gate approval, not a cap approval, and not permission to read a
 * byte of the dataset. The seven authorization fields on the packet are typed as the literal `false`,
 * so no caller — and no future edit — can flip one without changing this module's public type.
 *
 * ── This module NEVER (fail-closed by construction) ───────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - accepts a location: there is no path parameter, so there is nothing to point at real data.
 *   - reads a manifest, a CSV, a ZIP, a control file, or any dataset row.
 *   - executes a join or a coverage computation.
 *   - opens a Supabase client, writes to a database, or runs a migration.
 *   - touches runtime, Agent 1, or any provider.
 *   - approves a gate, authorizes a cap, or marks Brazil ready.
 *   - re-implements 13A's or 13B's rules; every verdict it prints was produced by them.
 *
 * It is a pure function: same fixture name, same packet, no side effects, no clock, no randomness.
 * The packet carries a STATIC timestamp so two runs are byte-identical.
 */

import {
  evaluateBrazilReceitaControlledExecutionPreflight,
  type BrazilReceitaControlledExecutionPreflightResult,
} from './br-receita-cnpj-controlled-execution-preflight-evaluator';
import {
  BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES,
  buildBrazilReceitaSyntheticOwnerArtifactFixture,
  type BrazilReceitaSyntheticOwnerArtifactFixtureName,
} from './br-receita-cnpj-synthetic-owner-artifact-fixtures';

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** Stable identity of the artefact this module emits. */
export const BRAZIL_RECEITA_REQUEST_PACKET_TYPE =
  'br_receita_cnpj_controlled_execution_attempt_review_request' as const;

/** Packet schema version. Bump only on a breaking change to the emitted shape. */
export const BRAZIL_RECEITA_REQUEST_PACKET_VERSION = 1 as const;

/**
 * A fixed literal instead of a clock reading. A reviewer comparing two packets is comparing the
 * chain's behaviour, not the time; a real timestamp would make every packet differ for no reason.
 */
export const BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP = 'STATIC_SYNTHETIC_TIMESTAMP' as const;

/** The review the packet asks a human to perform. Deliberately a review, never an execution. */
export const BRAZIL_RECEITA_REQUEST_PACKET_REQUESTED_REVIEW =
  'controlled_execution_attempt_review' as const;

/** The only mode of review this packet supports: reading a synthetic packet. */
export const BRAZIL_RECEITA_REQUEST_PACKET_REVIEW_MODE = 'synthetic_packet_only' as const;

/** The sentence that must accompany every packet, including a GO. */
export const BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER =
  'Synthetic GO is not real-data execution authorization.' as const;

export type BrazilReceitaRequestPacketFormat = 'json' | 'markdown';

/** Every output format, in documentation order. The single source of truth for callers. */
export const BRAZIL_RECEITA_REQUEST_PACKET_FORMATS: readonly BrazilReceitaRequestPacketFormat[] = [
  'json',
  'markdown',
] as const;

/**
 * The fixture catalogue, re-exported verbatim from 13C so the CLI needs exactly one import and the
 * two lists can never drift apart.
 */
export const BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES: readonly BrazilReceitaSyntheticOwnerArtifactFixtureName[] =
  BRAZIL_RECEITA_SYNTHETIC_OWNER_ARTIFACT_FIXTURE_NAMES;

/**
 * The authorizations this packet can never grant, in any code path. Frozen as literal `false` so the
 * packet type itself forbids a `true`; a future edit that tried to grant one would have to change
 * this module's exported type, which no request packet is authorized to do.
 */
export const BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATIONS = {
  realDataExecutionAuthorized: false,
  importAuthorized: false,
  runtimeAuthorized: false,
  agent1Authorized: false,
  gate2Approved: false,
  gate7Approved: false,
  capInputPolicyApproved: false,
} as const;

/** The withheld-authorization keys, for callers that assert the whole set stays denied. */
export const BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATION_KEYS: readonly (keyof typeof BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATIONS)[] =
  [
    'realDataExecutionAuthorized',
    'importAuthorized',
    'runtimeAuthorized',
    'agent1Authorized',
    'gate2Approved',
    'gate7Approved',
    'capInputPolicyApproved',
  ] as const;

/**
 * The safety facts every packet restates. They are literal `false` because this module has no
 * implementation of any of them; nothing in the code path could set one to `true`.
 */
export const BRAZIL_RECEITA_REQUEST_PACKET_SAFETY = {
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
} as const;

/** The safety keys, for callers that sweep the whole set. */
export const BRAZIL_RECEITA_REQUEST_PACKET_SAFETY_KEYS: readonly (keyof typeof BRAZIL_RECEITA_REQUEST_PACKET_SAFETY)[] =
  [
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
  ] as const;

/**
 * The actions that stay with a human no matter what the chain decided. They are unconditional: a
 * synthetic GO does not remove one of them, because a synthetic artifact is not an owner decision
 * and no gate moved.
 */
export const BRAZIL_RECEITA_REQUEST_PACKET_REQUIRED_HUMAN_ACTIONS: readonly string[] = [
  'HUMAN_REVIEW_CONTROLLED_EXECUTION_ATTEMPT_REQUEST',
  'OWNER_MUST_PROVIDE_REAL_SIGNED_DECISION',
  'LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED',
  'GATE_2_REMAINS_NOT_APPROVED',
  'GATE_7_REMAINS_NOT_APPROVED',
  'CAP_INPUT_POLICY_REMAINS_NOT_APPROVED',
] as const;

/** Prepended when the preflight refused, so the first thing a reader sees is the refusal. */
export const BRAZIL_RECEITA_REQUEST_PACKET_BLOCKED_HUMAN_ACTION =
  'RESOLVE_PREFLIGHT_BLOCKERS_BEFORE_RESUBMISSION' as const;

// ─── Packet shape ─────────────────────────────────────────────────────────────

export type BrazilReceitaControlledExecutionRequestPacket = {
  packetType: typeof BRAZIL_RECEITA_REQUEST_PACKET_TYPE;
  version: typeof BRAZIL_RECEITA_REQUEST_PACKET_VERSION;
  generatedAt: typeof BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP;
  fixture: BrazilReceitaSyntheticOwnerArtifactFixtureName;
  status: 'ready_for_review' | 'blocked';
  goNoGo: 'GO' | 'NO_GO';

  syntheticOnly: true;
  realDataExecutionAuthorized: false;
  importAuthorized: false;
  runtimeAuthorized: false;
  agent1Authorized: false;
  gate2Approved: false;
  gate7Approved: false;
  capInputPolicyApproved: false;

  preflight: BrazilReceitaControlledExecutionPreflightResult;

  ownerReviewRequest: {
    requestedReview: typeof BRAZIL_RECEITA_REQUEST_PACKET_REQUESTED_REVIEW;
    reviewMode: typeof BRAZIL_RECEITA_REQUEST_PACKET_REVIEW_MODE;
    requiredHumanDecision: true;
    approvalGrantedByThisPacket: false;
    syntheticGoIsExecutionAuthorization: false;
  };

  safety: typeof BRAZIL_RECEITA_REQUEST_PACKET_SAFETY;

  requiredNextHumanActions: string[];
  blockers: string[];
  disclaimer: typeof BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER;
};

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Renders one blocking finding as a single line. The origin prefix matters: `PREFLIGHT/` findings
 * come from 13B's own checks, `OWNER/` findings come from the 13A verdict 13B delegated.
 */
function formatBlocker(
  origin: 'PREFLIGHT' | 'OWNER',
  finding: { readonly code: string; readonly field?: string },
): string {
  return finding.field === undefined
    ? `${origin}/${finding.code}`
    : `${origin}/${finding.code} (${finding.field})`;
}

function blockingOnly<T extends { readonly severity: string }>(findings: readonly T[]): readonly T[] {
  return findings.filter((finding) => finding.severity === 'blocking');
}

/**
 * Collects every blocking reason from the preflight verdict, 13B's own findings first and the
 * delegated 13A findings after them. Order follows the findings arrays, so it is deterministic.
 */
function collectBlockers(preflight: BrazilReceitaControlledExecutionPreflightResult): string[] {
  return [
    ...blockingOnly(preflight.findings).map((finding) => formatBlocker('PREFLIGHT', finding)),
    ...blockingOnly(preflight.ownerDecisionValidation.findings).map((finding) =>
      formatBlocker('OWNER', finding),
    ),
  ];
}

/**
 * A packet reaches `ready_for_review` only when 13B said `ready` / `GO`, said the request may
 * proceed, and left no blocking reason behind. All three must hold; any disagreement blocks.
 */
function isReadyForReview(
  preflight: BrazilReceitaControlledExecutionPreflightResult,
  blockers: readonly string[],
): boolean {
  return (
    preflight.status === 'ready' &&
    preflight.goNoGo === 'GO' &&
    preflight.canProceedToControlledExecutionAttemptReview &&
    blockers.length === 0
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Builds the controlled execution attempt review request packet for a named 13C fixture.
 *
 * A `ready_for_review` packet states only that a human may now be asked to READ the request. It
 * authorizes nothing: no gate is approved, no cap is set, and no execution, real-data read,
 * manifest/CSV/ZIP read, row read, join, coverage, import, Supabase write, runtime or Agent 1 path
 * is opened. Brazil stays blocked.
 *
 * @throws Error when `fixtureName` is not one of
 *   {@link BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES} (raised by 13C).
 */
export function buildBrazilReceitaControlledExecutionRequestPacket(
  fixtureName: BrazilReceitaSyntheticOwnerArtifactFixtureName,
): BrazilReceitaControlledExecutionRequestPacket {
  const request = buildBrazilReceitaSyntheticOwnerArtifactFixture(fixtureName);
  const preflight = evaluateBrazilReceitaControlledExecutionPreflight(request);

  const blockers = collectBlockers(preflight);
  const readyForReview = isReadyForReview(preflight, blockers);

  return {
    packetType: BRAZIL_RECEITA_REQUEST_PACKET_TYPE,
    version: BRAZIL_RECEITA_REQUEST_PACKET_VERSION,
    generatedAt: BRAZIL_RECEITA_REQUEST_PACKET_STATIC_TIMESTAMP,
    fixture: fixtureName,
    status: readyForReview ? 'ready_for_review' : 'blocked',
    goNoGo: readyForReview ? 'GO' : 'NO_GO',

    syntheticOnly: true,
    ...BRAZIL_RECEITA_REQUEST_PACKET_WITHHELD_AUTHORIZATIONS,

    preflight,

    ownerReviewRequest: {
      requestedReview: BRAZIL_RECEITA_REQUEST_PACKET_REQUESTED_REVIEW,
      reviewMode: BRAZIL_RECEITA_REQUEST_PACKET_REVIEW_MODE,
      requiredHumanDecision: true,
      approvalGrantedByThisPacket: false,
      syntheticGoIsExecutionAuthorization: false,
    },

    safety: BRAZIL_RECEITA_REQUEST_PACKET_SAFETY,

    requiredNextHumanActions: readyForReview
      ? [...BRAZIL_RECEITA_REQUEST_PACKET_REQUIRED_HUMAN_ACTIONS]
      : [
          BRAZIL_RECEITA_REQUEST_PACKET_BLOCKED_HUMAN_ACTION,
          ...BRAZIL_RECEITA_REQUEST_PACKET_REQUIRED_HUMAN_ACTIONS,
        ],
    blockers,
    disclaimer: BRAZIL_RECEITA_REQUEST_PACKET_DISCLAIMER,
  };
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

/** Booleans read as YES/NO in the packet, so a reviewer never has to parse a JSON literal. */
function yesNo(value: boolean): 'YES' | 'NO' {
  return value ? 'YES' : 'NO';
}

function renderList(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? ['- none'] : lines.map((line) => `- ${line}`);
}

/**
 * Renders the packet as Markdown. Pure and deterministic: every line is derived from the packet in a
 * fixed order, so the same packet always renders byte-identically.
 */
export function renderBrazilReceitaControlledExecutionRequestPacketMarkdown(
  packet: BrazilReceitaControlledExecutionRequestPacket,
): string {
  const { preflight } = packet;
  const owner = preflight.ownerDecisionValidation;

  const lines: string[] = [
    '# BR Receita CNPJ — controlled execution attempt review request',
    '',
    `- Packet type: \`${packet.packetType}\``,
    `- Version: ${packet.version}`,
    `- Generated at: \`${packet.generatedAt}\``,
    `- Fixture: \`${packet.fixture}\``,
    `- Status: **${packet.status}**`,
    `- Go / No-Go: **${packet.goNoGo}**`,
    `- Synthetic only: ${yesNo(packet.syntheticOnly)}`,
    '',
    '## Authorizations withheld by this packet',
    '',
    'Every row below is withheld by construction. This packet cannot grant any of them.',
    '',
    '| Authorization | Granted |',
    '| --- | --- |',
    `| Real-data execution | ${yesNo(packet.realDataExecutionAuthorized)} |`,
    `| Import | ${yesNo(packet.importAuthorized)} |`,
    `| Runtime | ${yesNo(packet.runtimeAuthorized)} |`,
    `| Agent 1 | ${yesNo(packet.agent1Authorized)} |`,
    `| GATE-2 approval | ${yesNo(packet.gate2Approved)} |`,
    `| GATE-7 approval | ${yesNo(packet.gate7Approved)} |`,
    `| Cap / input policy approval | ${yesNo(packet.capInputPolicyApproved)} |`,
    '',
    '## Owner review request',
    '',
    `- Requested review: \`${packet.ownerReviewRequest.requestedReview}\``,
    `- Review mode: \`${packet.ownerReviewRequest.reviewMode}\``,
    `- Human decision required: ${yesNo(packet.ownerReviewRequest.requiredHumanDecision)}`,
    `- Approval granted by this packet: ${yesNo(packet.ownerReviewRequest.approvalGrantedByThisPacket)}`,
    `- Synthetic GO is an execution authorization: ${yesNo(packet.ownerReviewRequest.syntheticGoIsExecutionAuthorization)}`,
    '',
    '## Preflight verdict (BR-SOURCE-13B)',
    '',
    `- Preflight status: \`${preflight.status}\``,
    `- Preflight Go / No-Go: \`${preflight.goNoGo}\``,
    `- May proceed to controlled execution attempt review: ${yesNo(preflight.canProceedToControlledExecutionAttemptReview)}`,
    '',
    '### Owner decision validation (BR-SOURCE-13A)',
    '',
    `- Owner artifact status: \`${owner.status}\``,
    `- Owner artifact Go / No-Go: \`${owner.goNoGo}\``,
    `- GATE-2 approved in artifact: ${yesNo(owner.gate2Approved)}`,
    `- GATE-7 approved in artifact: ${yesNo(owner.gate7Approved)}`,
    `- Cap / input policy approved in artifact: ${yesNo(owner.capInputPolicyApproved)}`,
    `- Controlled execution attempt authorized in artifact: ${yesNo(owner.controlledExecutionAttemptAuthorized)}`,
    '',
    'An approval inside a SYNTHETIC artifact is not an owner approval. The gate table above is the',
    'authoritative one, and every row of it reads NO.',
    '',
    '## Blockers',
    '',
    ...renderList(packet.blockers),
    '',
    '## Safety',
    '',
    '| Fact | Value |',
    '| --- | --- |',
    ...BRAZIL_RECEITA_REQUEST_PACKET_SAFETY_KEYS.map(
      (key) => `| ${key} | ${yesNo(packet.safety[key])} |`,
    ),
    '',
    '## Required next human actions',
    '',
    ...packet.requiredNextHumanActions.map((action, index) => `${index + 1}. \`${action}\``),
    '',
    '## Disclaimer',
    '',
    packet.disclaimer,
    '',
    'Ready for review is not ready for execution. Brazil remains blocked.',
  ];

  return lines.join('\n');
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** Type guard over the 13C fixture catalogue, so the CLI needs only this module. */
export function isBrazilReceitaRequestPacketFixtureName(
  value: string,
): value is BrazilReceitaSyntheticOwnerArtifactFixtureName {
  return (BRAZIL_RECEITA_REQUEST_PACKET_FIXTURE_NAMES as readonly string[]).includes(value);
}

/** Type guard over the output formats, for the same reason. */
export function isBrazilReceitaRequestPacketFormat(
  value: string,
): value is BrazilReceitaRequestPacketFormat {
  return (BRAZIL_RECEITA_REQUEST_PACKET_FORMATS as readonly string[]).includes(value);
}

/**
 * Serializes the packet in the requested format. `pretty` indents JSON and is ignored for Markdown,
 * which has a single canonical rendering.
 */
export function formatBrazilReceitaControlledExecutionRequestPacket(
  packet: BrazilReceitaControlledExecutionRequestPacket,
  format: BrazilReceitaRequestPacketFormat,
  pretty = false,
): string {
  if (format === 'markdown') {
    return renderBrazilReceitaControlledExecutionRequestPacketMarkdown(packet);
  }

  return pretty ? JSON.stringify(packet, null, 2) : JSON.stringify(packet);
}
