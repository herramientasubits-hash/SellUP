/**
 * BR Receita CNPJ — the FINAL HUMAN SIGNOFF PACKET (BR-SOURCE-FAST-TRACK-6).
 *
 * Five gates are waiting on a named human's answer. This module is the machine-readable form of the
 * packet those five humans receive: one decision section per gate, each with the exact question, the
 * required role or roles, the required response fields, and the restrictions the answer carries.
 *
 * ── 🔴 Update (BR-SOURCE-FAST-TRACK-7) — the five gates this packet asked about are now approved ──
 *
 * GATE-2, GATE-3, GATE-4 (all three of 4A/4B/4C), GATE-5 and GATE-6 have since been approved by owner
 * relay, recorded directly in each gate's own module rather than by filling this packet's fields. That
 * is not a defect in this module: `findBrazilReceitaSignoffPacketDefects()` now correctly reports
 * every section here `gate_already_approved` — the defect class that exists precisely to catch a
 * packet still asking about an already-decided gate — and `brazilReceitaSignoffPacketIsUnanswered()`
 * now correctly returns `false`. The sections are KEPT, unedited, as the historical record of the
 * exact questions, roles and restrictions that were asked; they are not re-answered here, and this
 * module still approves nothing on its own.
 *
 * ── 🔴 The engineering blocker that WAS outstanding, and is now closed ───────
 *
 * An earlier draft said the five gates wait on a human answer "and on nothing else". That was untrue:
 * the legacy `BrazilReceitaFullJoinEnginePublicReport` was serialized to `cli_stdout` by the benchmark
 * path without passing the GATE-5 closed allowlist. The FINAL FAIL-CLOSED EMITTER REMOVAL deleted that
 * serialization, so the claim is true again — but it is now COMPUTED rather than asserted.
 *
 * `brazilReceitaSignoffHumanAnswersAreTheOnlyRemainingWork()` derives from the live emitter set and the
 * live blocker list. A boolean somebody types is a boolean that can drift from the code; that is
 * exactly how the earlier draft came to say something false. The GATE-5 section still DISCLOSES the
 * whole history, because an approver who is only shown the clean end state cannot tell that the legacy
 * object is still not an approved emission schema.
 *
 * ── 🔴 This packet is NOT an approval, and its shape is what enforces that ───
 *
 * Every response field below is `null`. Not "pending", not a default, not a placeholder that reads as
 * consent — `null`, with a validator that REFUSES a section whose fields are filled by anything other
 * than a real attributable human response. `BRAZIL_RECEITA_SIGNOFF_PACKET_IS_AN_APPROVAL` is `false`.
 *
 * ── 🔴 Why the sections are separate, and may not be bundled ─────────────────
 *
 * 10K § 4: "Gates may not be collapsed, merged, bundled, or approved as a batch. Eight gates means
 * eight recorded decisions." A single packet is a convenience for the humans reading it, and it becomes
 * a violation the moment one signature is taken to cover two gates. So the sections carry no shared
 * response field, no "approve all", and no ordering that implies one answer follows from another.
 *
 * ── 🔴 The one confusion this packet exists to prevent ───────────────────────
 *
 * BR-SOURCE-FAST-TRACK-6 received PROJECT TECHNICAL/PRODUCT DIRECTION — it superseded an owner
 * direction about `total_rows_scanned`, chose a residual label, and directed two renames. That
 * direction is real, it is recorded, and it is **not** a privacy signature, a legal determination, a
 * test-owner approval or an operator approval.
 * `BRAZIL_RECEITA_SIGNOFF_TECHNICAL_DIRECTION_IS_A_HUMAN_PRIVACY_APPROVAL` is `false`, and no section
 * below is pre-filled from it. Converting technical direction into a human privacy signature is the
 * specific failure this module is built to make impossible rather than merely discouraged.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate, records an approval, or supplies any half of a joint decision.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF. Roles are
 *     named; people are not.
 *   - authorizes a run, a rehearsal, a benchmark, real-data access, snapshot persistence, an import, a
 *     Supabase write, a migration, a runtime path, Agent 1, Agent 2A or a provider call.
 */

import {
  BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS,
  BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKERS,
} from './br-receita-cnpj-gate5-engine-report-boundary';
import {
  BRAZIL_RECEITA_GATE_APPROVED_STATUSES,
  BRAZIL_RECEITA_GATE_CURRENT_STATE,
  type BrazilReceitaGateStatus,
} from './br-receita-cnpj-gate-status-current-state';

// ─── What this packet is, and is not ──────────────────────────────────────────

export const BRAZIL_RECEITA_SIGNOFF_PACKET_VERSION =
  'br_receita_cnpj_final_owner_signoff_packet_v1' as const;

/** The packet prepares decisions. It records none. */
export const BRAZIL_RECEITA_SIGNOFF_PACKET_IS_AN_APPROVAL = false as const;

/** No agent may fill a response field, in whole or in part. */
export const BRAZIL_RECEITA_SIGNOFF_AGENT_MAY_ANSWER = false as const;

/** Project technical/product direction is not a human privacy, legal, test or operator approval. */
export const BRAZIL_RECEITA_SIGNOFF_TECHNICAL_DIRECTION_IS_A_HUMAN_PRIVACY_APPROVAL = false as const;

/** Decisions may not be bundled. Five sections means five recorded decisions (10K § 4). */
export const BRAZIL_RECEITA_SIGNOFF_DECISIONS_MAY_BE_BUNDLED = false as const;

/** Approval by inference — silence, a green check, a merged PR — is never an approval (10K § 3). */
export const BRAZIL_RECEITA_SIGNOFF_APPROVAL_BY_INFERENCE_PERMITTED = false as const;

// ─── The response shape ───────────────────────────────────────────────────────

export type BrazilReceitaSignoffVerdict = 'APPROVED' | 'NOT_APPROVED';

/**
 * One required response field. `value` is `null` in the packet as shipped, and a filled value is only
 * meaningful when it arrives with an attributable human role and date.
 */
export interface BrazilReceitaSignoffResponseField {
  readonly field: string;
  readonly kind: 'verdict' | 'role' | 'date' | 'boolean';
  readonly value: null;
}

export interface BrazilReceitaSignoffDecisionSection {
  readonly id: string;
  readonly gate: 2 | 3 | 4 | 5 | 6;
  /** The sub-decision letter, when a gate needs more than one separate authority. */
  readonly part: string | null;
  /** The roles required for THIS decision. More than one means jointly, and any may reject alone. */
  readonly requiredRoles: readonly string[];
  /** The exact question, stated as the approver must answer it. */
  readonly question: string;
  /** The restrictions the subject carries, which an approval is bounded by. */
  readonly restrictions: readonly string[];
  readonly responseFields: readonly BrazilReceitaSignoffResponseField[];
  /** Whether an approval here unblocks anything on its own. Almost always `false`. */
  readonly approvalUnblocksExecution: false;
}

function verdictField(field: string): BrazilReceitaSignoffResponseField {
  return { field, kind: 'verdict', value: null };
}
function roleField(field: string): BrazilReceitaSignoffResponseField {
  return { field, kind: 'role', value: null };
}
function dateField(field: string): BrazilReceitaSignoffResponseField {
  return { field, kind: 'date', value: null };
}
function booleanField(field: string): BrazilReceitaSignoffResponseField {
  return { field, kind: 'boolean', value: null };
}

// ─── § A · GATE-2 — the bucket ordinal ────────────────────────────────────────

const GATE2_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-2',
  gate: 2,
  part: null,
  requiredRoles: ['privacy owner'],
  question:
    'Does the privacy owner approve the bucket ordinal as structural_non_invertible_partition_metadata, subject to: process-memory only; no persistence; no filename or path; no log; no report; no evidence output; no Supabase; no provider; no HubSpot; and not treated as join-key material or as a derivative of it?',
  restrictions: [
    'the ordinal exists in process memory for the run and is never written to any surface',
    'approving this closes GATE-2 only; the numeric ceilings were already complete and are not re-opened',
    'GATE-2 approval flips no operational flag and does not authorize a run',
    'the technical half of GATE-2 is already recorded; this is the privacy half and nothing more',
  ],
  responseFields: [
    verdictField('GATE2_BUCKET_ORDINAL_PRIVACY'),
    roleField('APPROVER_ROLE'),
    dateField('APPROVAL_DATE'),
  ],
  approvalUnblocksExecution: false,
};

// ─── § B · GATE-3 — the field allowlist ───────────────────────────────────────

const GATE3_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-3',
  gate: 3,
  part: null,
  requiredRoles: ['product / data owner', 'legal/privacy owner'],
  question:
    'Do the product/data owner and the legal/privacy owner jointly approve br_receita_cnpj_field_allowlist_v1, confirming the final field classifications recorded after Round 2 — including the trade-name exclusion and the closed typed raw_data allowlist?',
  restrictions: [
    'approving binds field_allowlist_version and nothing else',
    'the 10J § 12 report marker stays "not_approved" until this decision is recorded',
    'it does not freeze the report SCHEMA — 10L § 9 forbids that while GATE-4 is open',
    'it authorizes no run, no import and no persistence',
  ],
  responseFields: [
    verdictField('GATE3_FIELD_POLICY'),
    roleField('PRODUCT_DATA_APPROVER_ROLE'),
    roleField('LEGAL_PRIVACY_APPROVER_ROLE'),
    dateField('APPROVAL_DATE'),
  ],
  approvalUnblocksExecution: false,
};

// ─── § C · GATE-4 — three separate authorities ────────────────────────────────

/**
 * 🔴 GATE-4 needs THREE separate authorities, and they are three sections rather than one with three
 * signature lines. A legal amendment, a data-architecture choice and a product-grain choice are
 * different decisions about different risks; a single combined verdict would let the easiest of the
 * three carry the other two.
 */
const GATE4_LEGAL_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-4-A-LEGAL',
  gate: 4,
  part: 'A',
  requiredRoles: ['legal/privacy owner'],
  question:
    'Does the legal/privacy owner approve a NARROW amendment to R4 of the GATE-1 record, allowing exactly ONE persisted representation of the establishment CNPJ solely for internal exact lookup — never user-visible, never printed, never logged, never reported, never in raw_data, never sent to a provider, never sent to HubSpot, internal snapshot lookup only?',
  restrictions: [
    'exactly one representation; a second is a new decision',
    'internal exact lookup is the only purpose the amendment covers',
    'the amendment does not authorize any Brazil snapshot write — see BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED',
    'it does not authorize a run, an import, a migration or a provider call',
  ],
  responseFields: [
    verdictField('GATE4_INTERNAL_CNPJ_LOOKUP_EXCEPTION'),
    booleanField('GATE4_R4_AMENDMENT_AUTHORIZED'),
    roleField('LEGAL_PRIVACY_APPROVER_ROLE'),
    dateField('DATE'),
  ],
  approvalUnblocksExecution: false,
};

const GATE4_ARCHITECTURE_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-4-B-ARCHITECTURE',
  gate: 4,
  part: 'B',
  requiredRoles: ['data architecture owner'],
  question:
    'Does the data architecture owner approve OPTION_D — establishment operational grain, company/root context, a monthly source_period of the form YYYY-MM, and exact idempotency per period?',
  restrictions: [
    'approving the grain does not create the physical period identity the grain needs',
    'the future migration is separately designed and separately reviewed',
    'it authorizes no snapshot write and no migration',
  ],
  responseFields: [
    verdictField('GATE4_DATA_ARCHITECTURE'),
    roleField('DATA_ARCHITECTURE_APPROVER_ROLE'),
    dateField('DATE'),
  ],
  approvalUnblocksExecution: false,
};

const GATE4_PRODUCT_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-4-C-PRODUCT',
  gate: 4,
  part: 'C',
  requiredRoles: ['product owner'],
  question:
    'Does the product owner approve the OPTION_D product grain, accepting that exact lookup is REQUIRED and that fuzzy-name lookup is not accepted as a replacement for it?',
  restrictions: [
    'the exact-runtime-lookup productization blocker is acknowledged, not solved, by this approval',
    'it authorizes no run, no import and no persistence',
  ],
  responseFields: [
    verdictField('GATE4_PRODUCT'),
    roleField('PRODUCT_APPROVER_ROLE'),
    dateField('DATE'),
  ],
  approvalUnblocksExecution: false,
};

/**
 * 🔴 The restriction that survives every GATE-4 approval.
 *
 * Even with all three authorities recorded, Brazil snapshot writes stay BLOCKED:
 * `source_company_snapshots` still has no physical `source_period` (YYYY-MM) identity, so the exact
 * per-period idempotency Option D depends on cannot be enforced by the table. The migration that would
 * add it must be separately designed and reviewed, and this round neither authors nor applies it.
 */
export const BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED = {
  brazilSnapshotWritesBlocked: true,
  reason:
    'source_company_snapshots lacks a physical source_period YYYY-MM identity, so per-period exact idempotency cannot be enforced by the table',
  requiredFutureMigration: 'separately designed and separately reviewed; NOT authored or applied here',
  unblockedByGate4Approval: false,
} as const;

// ─── § D · GATE-5 — the corrected output contract ─────────────────────────────

/**
 * 🔴 The SUBJECT of this decision is the contract as CORRECTED by BR-SOURCE-FAST-TRACK-6, not the
 * Round-3 version. Naming the subject precisely is what stops an approver blessing a superseded
 * document, and it is why this section enumerates the corrected terms rather than pointing at a round.
 */
export const BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS: readonly string[] = [
  'small-cell k = 10',
  'maximum output string length = 64',
  'total_rows_scanned is INTERNAL ONLY and emitted on no surface',
  'records_persisted is the output key (renamed from persisted_rows)',
  'records_seen_by_family is the output key (renamed from rows_seen_by_family)',
  'suppressed_other is the single residual bucket label',
  'no cross-tabulations',
  'no named municipality counts',
  'no raw rows, no raw cells, no identity keys, no stack, no path on any surface',
  'the allowlist governs and the denylist remains an independent second net',
  // 🔴 The FINAL BOUNDARY CORRECTION term. The approvers are approving an ARCHITECTURE, not only a
  // key list, and this is the part of it a reader of the key list alone would never see.
  'the legacy BR-SOURCE-11A / 14B engine public-report object is NOT a GATE-5 emission schema: a future emitter must project only the closed GATE-5 allowlist',
  'the direct benchmark stdout bypass of that legacy object has been REMOVED fail-closed; no GATE-5 projection exists yet, so there is currently no approved external report at all',
];

const GATE5_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-5',
  gate: 5,
  part: null,
  requiredRoles: ['security/privacy owner', 'test owner'],
  question:
    'Do the security/privacy owner and the test owner jointly approve the CORRECTED br_receita_cnpj_output_sanitization_v1 contract, on the terms enumerated in BRAZIL_RECEITA_SIGNOFF_GATE5_SUBJECT_TERMS?',
  restrictions: [
    'approving authorizes writing sanitization tests in a future, separately approved milestone and nothing else',
    'it does not authorize executing the full join',
    'it does not authorize emitting any report from real data',
    'it does not freeze the report SCHEMA while GATE-3 and GATE-4 are open',
    'the implementer of this subject may not supply either half of the approval',
    // 🔴 The disclosure the FINAL BOUNDARY CORRECTION requires, in the words it specified, plus the
    // five facts the FINAL FAIL-CLOSED EMITTER REMOVAL requires the approvers to be told.
    'DISCLOSURE: the historical BR-SOURCE-11A/14B engine public-report object still exists UNCHANGED, and is not itself a GATE-5-approved emission schema. Its legacy safety fields must not be directly emitted; a future emitter must project only the closed GATE-5 allowlist.',
    'DISCLOSURE: the previously-existing direct benchmark stdout bypass of that legacy object has been removed fail-closed. The withheld status now travels as a process exit code; no substitute report, no stderr fallback, no file or log fallback, and no stack.',
    'DISCLOSURE: no GATE-5 projection exists yet, and none is authorized now — so there is currently no approved external report of a full-join run at all. Any future external emission requires the separately-authorized GATE-5 projection plus the closed allowlist and value guards.',
  ],
  responseFields: [
    verdictField('GATE5_OUTPUT_SANITIZATION'),
    roleField('SECURITY_PRIVACY_APPROVER_ROLE'),
    roleField('TEST_OWNER_APPROVER_ROLE'),
    dateField('DATE'),
  ],
  approvalUnblocksExecution: false,
};

// ─── § E · GATE-6 — the executable cleanup contract ───────────────────────────

const GATE6_SECTION: BrazilReceitaSignoffDecisionSection = {
  id: 'DECISION-GATE-6',
  gate: 6,
  part: null,
  requiredRoles: ['technical owner', 'operator owner'],
  question:
    'Do the technical owner and the operator owner jointly approve the executable cleanup contract landed in BR-SOURCE-GATE-ROUND-2 — verified deletion on both the success and the failure path, no success-with-residue, and a failed or not_executed cleanup being terminal rather than retryable?',
  restrictions: [
    'a failed or not_executed cleanup stays terminal and may not be upgraded by a retry',
    'quarantine is not implemented and is not approved',
    'cleanup deletes only paths its owning module created; no path is accepted from a caller',
    'approving authorizes no run and flips no flag',
    'the implementer of this subject may not supply either half of the approval',
  ],
  responseFields: [
    verdictField('GATE6_CLEANUP_CONTRACT'),
    roleField('TECHNICAL_APPROVER_ROLE'),
    roleField('OPERATOR_APPROVER_ROLE'),
    dateField('DATE'),
  ],
  approvalUnblocksExecution: false,
};

// ─── The packet ───────────────────────────────────────────────────────────────

/**
 * The seven decision sections, covering five gates. GATE-4 contributes three because it needs three
 * distinct authorities and 10K § 4 forbids bundling them into one.
 *
 * Order is presentation only. No section's answer follows from another's, and none may be inferred
 * from another's.
 */
export const BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS: readonly BrazilReceitaSignoffDecisionSection[] =
  [
    GATE2_SECTION,
    GATE3_SECTION,
    GATE4_LEGAL_SECTION,
    GATE4_ARCHITECTURE_SECTION,
    GATE4_PRODUCT_SECTION,
    GATE5_SECTION,
    GATE6_SECTION,
  ];

/** The gates this packet covers. GATE-1 is approved; GATE-7 is blocked on these; GATE-8 is a contract. */
export const BRAZIL_RECEITA_SIGNOFF_COVERED_GATES: readonly number[] = [2, 3, 4, 5, 6];

/** GATE-7 is deliberately absent: it is not waiting on a signature, it is waiting on these five. */
export const BRAZIL_RECEITA_SIGNOFF_GATE7_ABSENT_REASON =
  'GATE-7 is blocked by GATE-2, GATE-5 and GATE-6 rather than by a missing signature of its own; it becomes reviewable only after they are approved' as const;

/**
 * 🔴 What is outstanding BESIDES the five human answers. Empty — and DERIVED, not declared.
 *
 * Kept as a derivation so the packet can never again imply that a human signature is the last thing
 * standing when it is not. An engineering blocker is not a gate blocker and not a signature: it is
 * work, it is owned by engineering, and only code closes it.
 */
export function brazilReceitaSignoffNonHumanOutstandingItems(): readonly string[] {
  return [
    ...BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CURRENT_DIRECT_EMITTERS.map(
      (emitter) =>
        `ENGINEERING: ${emitter.emittingModule} serializes the legacy engine report to ${emitter.surface} without passing the GATE-5 closed allowlist`,
    ),
    ...BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKERS,
  ];
}

/**
 * 🔴 Whether the five human answers are the ONLY remaining work. **DERIVED**, never typed.
 *
 * The previous draft asserted the equivalent claim in prose and was wrong, which is the whole reason
 * this is a function over the live sets instead of a constant. It returns `true` only while no emitter
 * and no engineering blocker remain, so it cannot outlive the facts it summarizes.
 */
export function brazilReceitaSignoffHumanAnswersAreTheOnlyRemainingWork(): boolean {
  return brazilReceitaSignoffNonHumanOutstandingItems().length === 0;
}

// ─── The refusal ──────────────────────────────────────────────────────────────

export type BrazilReceitaSignoffPacketDefect =
  | 'prefilled_response_field'
  | 'missing_required_role'
  | 'bundled_decision'
  | 'gate_already_approved';

export interface BrazilReceitaSignoffPacketFinding {
  readonly section: string;
  readonly defect: BrazilReceitaSignoffPacketDefect;
}

/**
 * Validates the packet as shipped and refuses it if it has become an approval.
 *
 * Four defect classes, and the first is the one this function exists for: a response field carrying
 * anything other than `null` means somebody — most plausibly an agent tidying up — turned a question
 * into an answer. The others catch a section that lost a required role, a section covering more than
 * one gate, and a section still asking about a gate that is already approved.
 *
 * PURE. Returns findings; approves nothing; never repairs the packet.
 */
export function findBrazilReceitaSignoffPacketDefects(
  sections: readonly BrazilReceitaSignoffDecisionSection[] = BRAZIL_RECEITA_SIGNOFF_DECISION_SECTIONS,
): readonly BrazilReceitaSignoffPacketFinding[] {
  const findings: BrazilReceitaSignoffPacketFinding[] = [];

  for (const section of sections) {
    for (const field of section.responseFields) {
      if (field.value !== null) {
        findings.push({ section: section.id, defect: 'prefilled_response_field' });
      }
    }
    if (section.requiredRoles.length === 0) {
      findings.push({ section: section.id, defect: 'missing_required_role' });
    }
    const status = statusOf(section.gate);
    if (status !== null && BRAZIL_RECEITA_GATE_APPROVED_STATUSES.includes(status)) {
      findings.push({ section: section.id, defect: 'gate_already_approved' });
    }
  }

  // A section that claims more than one gate is a bundled decision by construction; the type forbids
  // it, so what is checked instead is that no two sections share an id — two sections with one id
  // would collapse into a single recorded answer covering both.
  const ids = sections.map((section) => section.id);
  for (const [index, id] of ids.entries()) {
    if (ids.indexOf(id) !== index) findings.push({ section: id, defect: 'bundled_decision' });
  }

  return findings;
}

function statusOf(gate: number): BrazilReceitaGateStatus | null {
  const entry = BRAZIL_RECEITA_GATE_CURRENT_STATE.find((state) => state.gate === gate);
  return entry === undefined ? null : entry.status;
}

/** True when the packet is still a set of questions rather than a set of answers. */
export function brazilReceitaSignoffPacketIsUnanswered(): boolean {
  return findBrazilReceitaSignoffPacketDefects().length === 0;
}

// ─── What no approval in this packet authorizes ───────────────────────────────

/**
 * The operational crossings that stay forbidden even if all seven sections come back APPROVED.
 *
 * 🔴 This list is the reason the packet can be prepared at all. Five gates approving does not make a
 * run legal: GATE-7 would still be `blocked` on its own approval, § 4 would still forbid runner code
 * until every gate is approved, and execution would still need the separate explicit authorization of
 * a future milestone.
 */
export const BRAZIL_RECEITA_SIGNOFF_STILL_FORBIDDEN_AFTER_EVERY_APPROVAL: readonly string[] = [
  'reading real Receita data',
  'executing the full join',
  'running a benchmark, or resetting the benchmark attempt budget',
  'authoring or applying a migration',
  'any Supabase write',
  'any Brazil snapshot write',
  'implementing source_period identity',
  'connecting Agent 1 to Brazil',
  'any provider call',
  'enabling production',
  'writing full-join runner code while any gate is unapproved',
];
