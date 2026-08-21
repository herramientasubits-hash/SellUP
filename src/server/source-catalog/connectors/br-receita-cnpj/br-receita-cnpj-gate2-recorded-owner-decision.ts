/**
 * BR Receita CNPJ — RECORDED GATE-2 owner decision (BR-SOURCE-GATE-ROUND-1).
 *
 * GATE-2 is the temporary storage envelope (10K § 6): it decides whether Option C — a temporary
 * local discardable index — is permitted at all, and it replaces every
 * `TBD_BY_GATE_2_STORAGE_ENVELOPE` placeholder in 10J § 10 with a number. Until this record it was
 * `not_started`, and `br-receita-cnpj-gate1-recorded-owner-decision.ts` said so in its own header:
 * GATE-2 … GATE-8 were absent from that artifact on purpose, so 13A read them unapproved by
 * absence.
 *
 * This module is the GATE-2 section of a § 14 approval entry, expressed as data. It follows the
 * GATE-1 record exactly — same shape, same restrictions, same silences — because the ordering rule
 * `GATE2_CANNOT_PRECEDE_GATE1` means a GATE-2 record is only readable ALONGSIDE the GATE-1 one, and
 * two artifacts that disagreed about GATE-1 would be worse than one that carries both.
 *
 * ── What this record IS ──────────────────────────────────────────────────────
 * The recorded joint decision of the technical owner (storage / execution model) and the privacy
 * owner: Option C is permitted, inside the envelope enumerated below.
 *
 * ── What this record is NOT ──────────────────────────────────────────────────
 * GATE-3 … GATE-8 and the cap/input policy remain ABSENT, exactly as in the GATE-1 record, so 13A
 * still reads them unapproved and the whole-artifact verdict stays `invalid` / `NO_GO`. That is the
 * CORRECT verdict while five gates are `not_started`, not a defect in this record.
 *
 * 🔴 It flips NO operational flag, and the checklist says so in GATE-2's own *Relation to flags*
 * clause: GATE-2 "flips **no** operational flag". Concretely, and deliberately:
 *
 *   - `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED` stays the tracked `false`. This
 *     module does not import it, does not read it and does not reproduce a writable copy of it. A
 *     real run still needs an invocation-scoped operator grant, which is a different authority.
 *   - `BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL` is NOT rewritten. Its
 *     `maxTemporaryStorageBytes: 0` is a *proposal* whose own status string says
 *     `..._not_approved_for_production`, and overwriting a proposal with an approval would merge
 *     two authorities into one number nobody could later attribute. The approved ceilings live
 *     here, as their own constants, and a future runner reads them from here.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access. Its only
 *     import is a TYPE import plus the GATE-1 record's builder, so it contributes no executable
 *     dependency beyond the one it must compose with.
 *   - approves, or carries a section for, any gate other than GATE-1 (composed) and GATE-2.
 *   - authorizes execution, a benchmark, a benchmark retry, real-data access, a manifest / CSV /
 *     ZIP / row read, snapshot output, persistence, an import, a Supabase write, a migration, a
 *     runtime path, Agent 1, Agent 2A, or a provider call.
 *   - resets, reads or influences the real-benchmark attempt ledger.
 *   - carries a personal name, a signature, a mail address, a real path, a host, a credential, a
 *     CNPJ or a CPF. Roles only, per 10K § 14's recording rules.
 *
 * Every builder returns a freshly constructed object, so no caller can mutate a shared record.
 */

import type { OwnerDecisionArtifact } from './br-receita-cnpj-owner-decision-validator';
import { buildBrazilReceitaGate1RecordedOwnerDecisionArtifact } from './br-receita-cnpj-gate1-recorded-owner-decision';

// ─── Approvers ────────────────────────────────────────────────────────────────

/**
 * GATE-2 requires the technical owner (storage / execution model) AND the privacy owner, jointly —
 * "either may reject alone; approval requires both" (10K § 6).
 *
 * 🔴 The artifact's `gate2` section carries a single `ownerRole` string, so the JOINT nature has to
 * be expressed inside it rather than assumed from two fields that do not exist. Both roles are
 * named there, and the privacy half is additionally carried by `legalPrivacySecurityReference` so a
 * reader cannot lose it by reading one field.
 *
 * Per 10K § 3, neither approver may be the implementer of the gate's subject, and per 10K § 14 the
 * identity behind each role is deliberately not recorded — here or anywhere in this repository.
 */
export const BRAZIL_RECEITA_GATE2_TECHNICAL_APPROVER_ROLE =
  'technical owner (storage and execution model)' as const;
export const BRAZIL_RECEITA_GATE2_PRIVACY_APPROVER_ROLE = 'privacy owner' as const;
export const BRAZIL_RECEITA_GATE2_APPROVAL_IS_JOINT = true as const;

/** The date the human decision was relayed and recorded. */
export const BRAZIL_RECEITA_GATE2_APPROVAL_DATE = '2026-08-21' as const;

// ─── The storage option ───────────────────────────────────────────────────────

/**
 * The three 10J § 5 options, and which one the owners approved. The two not approved are NAMED
 * rather than omitted, because GATE-2's pass criteria require exactly that: "a single storage
 * option is approved explicitly, with the other two named as not-approved".
 */
export const BRAZIL_RECEITA_GATE2_STORAGE_OPTIONS = {
  optionA: { label: 'pure in-memory map', approved: false },
  optionB: { label: 'streaming two-pass scan', approved: false },
  optionC: { label: 'temporary local discardable index', approved: true },
} as const;

export const BRAZIL_RECEITA_GATE2_APPROVED_STORAGE_OPTION = 'option_c' as const;

// ─── The numeric envelope ─────────────────────────────────────────────────────

/**
 * The ceilings the owners supplied, as numbers. These are the values that replace 10J § 10's
 * placeholders for the seven caps the owners decided.
 *
 * 🔴 They are recorded here and NOT written into the resource-envelope proposal. See the header:
 * a proposal and an approval are two authorities, and a future runner must be able to say which one
 * it read.
 *
 * Comparison against the provisional proposal, so a reader is not surprised by a raise:
 *   maxHeapUsedBytes        128 MiB — RAISED from the proposal's 64 MiB.
 *   maxExternalMemoryBytes   64 MiB — unchanged from the proposal.
 *   maxRssBytes             512 MiB — unchanged from the proposal.
 *   maxTemporaryStorageBytes  4 GiB — the proposal held 0 because GATE-2 was unapproved. Option C
 *                                     being approved is exactly what changes that zero, and this is
 *                                     the only cap whose change is a change of KIND.
 *   maxRuntimeMs               6 h  — new; the proposal refused to invent one.
 *   maxPhaseRuntimeMs          3 h  — new; same.
 *   maxRowsRead        360,000,000  — new. See the classification below before reading this number
 *                                     as anything about Brazil's actual size.
 */
export const BRAZIL_RECEITA_GATE2_APPROVED_CAPS = {
  maxHeapUsedBytes: 134_217_728,
  maxExternalMemoryBytes: 67_108_864,
  maxRssBytes: 536_870_912,
  maxRuntimeMs: 21_600_000,
  maxPhaseRuntimeMs: 10_800_000,
  maxTemporaryStorageBytes: 4_294_967_296,
  maxRowsRead: 360_000_000,
} as const;

/**
 * 🔴 What `maxRowsRead` IS and, more importantly, what it is NOT.
 *
 * BR-SOURCE has been burned once already by a number that travelled without its provenance: the
 * "co_siis ≈ 902k" figure turned out to be a table total rather than evidence of anything. A
 * nine-digit row ceiling sitting next to six measured byte ceilings is the same accident waiting to
 * happen — a reader would reasonably assume somebody counted Brazil's rows.
 *
 * Nobody did. This is a BUDGET ceiling the owner chose to bound a run that does not exist yet. It
 * is not an observation, and it is not evidence of the national row count.
 */
export const BRAZIL_RECEITA_GATE2_MAX_ROWS_READ_CLASSIFICATION = [
  'OWNER_BUDGET_CEILING',
  'NOT_OBSERVED',
  'NOT_NATIONAL_ROW_COUNT_EVIDENCE',
] as const;

/**
 * The cap keys the owners did NOT decide, named so the gap is visible instead of inferred.
 *
 * 🔴 GATE-2's pass criteria say "every ceiling has a number; no `TBD` survives". Three of the eleven
 * cap keys have no OWNER number — and the distinction that matters is that each of them does have a
 * PROPOSED one, in `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS`, whose own status string reads
 * `proposed_benchmark_caps_not_production_caps`. A proposal is not an approval, and reading one as
 * the other is how a gate passes on evidence nobody supplied.
 *
 * `maxJoinKeysInMemory` is the pointed one: it is a temp-index limit, squarely inside 10J § 10, which
 * is exactly what GATE-2 governs. This record therefore approves a BOUNDED envelope, per 10K § 3's
 * "`approved` is scoped and revocable" — a run that needs one of these three is outside this
 * approval and must come back for it.
 *
 * They remain operator-supplied and fail-closed in
 * `BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS`; nothing here gives them a default.
 */
export const BRAZIL_RECEITA_GATE2_CAPS_STILL_UNSUPPLIED = [
  'maxFilesOpened',
  'maxBytesRead',
  'maxJoinKeysInMemory',
] as const;

/**
 * 🔴 Where the owners' envelope is TIGHTER than the standing benchmark proposal.
 *
 * Six of the seven decided ceilings match `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS`
 * exactly. `maxPhaseRuntimeMs` does not: the owners decided three hours, and that proposal carries
 * six — it sets `maxPhaseRuntimeMs` equal to `maxRuntimeMs`, which is the same thing as declining to
 * bound a phase separately.
 *
 * The consequence is concrete and easy to miss: a future run that took its caps from the standing
 * proposal would exceed the GATE-2 envelope on that one number, and nothing today would say so,
 * because the proposal and the approval live in different modules with different authorities.
 *
 * This record does NOT edit the proposal. That module is a proposal by declaration, editing it here
 * would merge two authorities into one figure nobody could attribute later, and lowering a benchmark
 * cap is a behavioural change to a benchmark that is not this round's subject. The conflict is
 * RECORDED instead, and a test asserts the invariant that actually matters: the GATE-2 ceiling is
 * never looser than the proposal it diverges from.
 */
export const BRAZIL_RECEITA_GATE2_TIGHTER_THAN_STANDING_PROPOSAL = [
  {
    cap: 'maxPhaseRuntimeMs',
    gate2Value: 10_800_000,
    standingProposalValue: 21_600_000,
    disposition: 'gate2_envelope_governs_and_the_proposal_is_not_edited_here',
  },
] as const satisfies readonly {
  readonly cap: string;
  readonly gate2Value: number;
  readonly standingProposalValue: number;
  readonly disposition: string;
}[];

/**
 * `maxOutputRows` is deliberately not in `BRAZIL_RECEITA_GATE2_APPROVED_CAPS`. It is GATE-8's
 * invariant, it is `0`, and GATE-2 may not restate a value it does not own — a second copy is how
 * two numbers start to disagree.
 */
export const BRAZIL_RECEITA_GATE2_MAX_OUTPUT_ROWS_OWNER = 'GATE_8' as const;

// ─── The workspace ────────────────────────────────────────────────────────────

/**
 * Where temporary material may live, and how it must be permissioned.
 *
 * Every entry is a CONSTRAINT, never a location: 10K § 14 forbids a real path in an approval
 * record, and 13A refuses one as unsafe content. The operator resolves a concrete directory against
 * these constraints at run time; this record never learns which one.
 */
export const BRAZIL_RECEITA_GATE2_WORKSPACE_CONSTRAINTS = {
  outsideRepository: true,
  outsideHomeDirectory: true,
  outsideDatasetRoot: true,
  symlinkPermitted: false,
  directoryMode: 0o700,
  fileMode: 0o600,
} as const;

/** The temporary material exists for the run and for nothing longer. */
export const BRAZIL_RECEITA_GATE2_TEMPORARY_MATERIAL_TTL = 'run_lifetime' as const;

/**
 * Cleanup, on both paths, and what happens when cleanup itself does not succeed.
 *
 * 🔴 `verified_deletion_required` on BOTH the success and the failure path is the point. GATE-2's
 * fail criteria reject "a cleanup path that is unverifiable", and its pass criteria require cleanup
 * to be "verifiable, not merely intended" — an unlink whose result nobody checked is an intention.
 *
 * And both terminal states are TERMINAL: a run whose cleanup failed is `failed`, and one that never
 * ran its cleanup is `not_executed`. Neither may resolve to success-with-residue, which is the one
 * outcome GATE-2 names explicitly as a failure.
 */
export const BRAZIL_RECEITA_GATE2_CLEANUP_CONTRACT = {
  onSuccess: 'verified_deletion_required',
  onFailure: 'verified_deletion_required',
  cleanupFailedDisposition: 'terminal',
  cleanupNotExecutedDisposition: 'terminal',
  successWithResiduePermitted: false,
} as const;

// ─── Option C encryption, and the condition it hangs on ───────────────────────

/**
 * 🔴 The subtlest thing in this record, and the one most likely to be misread.
 *
 * GATE-2's fail criteria say "Option C approved without encryption at rest and a verified destroy
 * step" is a failure, and its required evidence qualifies the first half: encryption at rest "for
 * any material that materializes the join key". The two halves are not symmetrical. The destroy
 * step is unconditional and this record requires it. The encryption requirement has a TRIGGER, and
 * the owners' disposition is about that trigger, not about waiving the requirement.
 *
 * The disposition: encryption at rest is not required WHILE no raw key, no normalized key, no hash
 * of either, no truncation of either and no fingerprint of either is materialized to temporary
 * storage. If any of those appears in the temporary record or file layout, the trigger fires, this
 * disposition no longer applies, and the GATE-2 encryption decision REOPENS.
 *
 * Recording it as a condition rather than as a blanket "not required" is what keeps a future layout
 * change from silently inheriting a permission that was never given for it.
 */
export const BRAZIL_RECEITA_GATE2_OPTION_C_ENCRYPTION = {
  requiredNow: false,
  conditionUnderWhichNotRequired:
    'no raw or normalized join key, and no hash, truncation or fingerprint of either, is materialized to temporary storage',
  reopenTrigger:
    'the temporary record or file layout materializes prohibited key-derived material',
  verifiedDestroyStepRequired: true,
} as const;

/** The prohibited key-derived material, enumerated. A summarized prohibition is how a bound widens. */
export const BRAZIL_RECEITA_GATE2_PROHIBITED_TEMPORARY_KEY_MATERIAL: readonly string[] = [
  'raw join key',
  'normalized join key',
  'hash of a raw or normalized join key',
  'truncation of a raw or normalized join key',
  'fingerprint of a raw or normalized join key',
] as const;

// ─── The bucket ordinal ───────────────────────────────────────────────────────

/**
 * The partition bucket ordinal, and why it is not join-key material.
 *
 * A bucket ordinal is a small integer naming which partition a record was routed to. It is
 * structural: many records share one ordinal, and no ordinal can be turned back into the value that
 * produced it. It is therefore partition metadata rather than a derivative of the key.
 *
 * 🔴 This is a PRIVACY disposition, and 10K § 3 forbids a gate's subject being approved by the party
 * that implements it. It is attributed to the privacy owner, who is a GATE-2 joint approver. It is
 * NOT an agent determination, and this constant exists so nobody can later read it as one.
 */
export const BRAZIL_RECEITA_GATE2_BUCKET_ORDINAL_DISPOSITION = {
  classification: 'structural_non_invertible_partition_metadata',
  isJoinKeyMaterial: false,
  attributedTo: BRAZIL_RECEITA_GATE2_PRIVACY_APPROVER_ROLE,
  attributedToAgent: false,
} as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/**
 * The GATE-2 restrictions, ENUMERATED rather than summarized, per 10K § 14. Every entry restates a
 * bound the Brazil contract already established or that GATE-2's own *Does NOT allow* clause names.
 * None is new.
 */
export const BRAZIL_RECEITA_GATE2_RESTRICTIONS: readonly string[] = [
  'no operational flag is flipped by this approval',
  'the tracked temporary-storage policy constant stays false and is not read or rewritten here',
  'the provisional resource-cap proposal is not rewritten by this approval',
  'no approved source data may be persisted',
  'no source company snapshot row may be created',
  'no real data may be stored inside the repository',
  'a temporary technical artifact is never a source snapshot',
  'temporary material may not outlive the run',
  'structural keys are forbidden in file names, log lines, report fields and paths',
  'zero raw-value logs remains an absolute invariant and is not a tunable',
  'the three unsupplied caps stay operator-supplied and fail-closed',
  'a run needing an unsupplied cap is outside this approval',
  'the encryption disposition reopens if prohibited key-derived material is materialized',
  'downstream gates remain independently required and are not approved by this decision',
] as const;

// ─── The artifact ─────────────────────────────────────────────────────────────

/**
 * The recorded GATE-1 + GATE-2 owner decisions, shaped for BR-SOURCE-13A.
 *
 * 🔴 GATE-1 is composed in from its own record rather than restated. `GATE2_CANNOT_PRECEDE_GATE1`
 * means a GATE-2 section is only evaluable next to a GATE-1 one, and a hand-copied GATE-1 section
 * here would be a second source of truth for a decision that already has one.
 *
 * `expirationOrReviewDate` carries a review CONDITION rather than a calendar date, for the same
 * reason the GATE-1 record does: the human response supplied no expiry, and inventing one would be
 * manufacturing an owner decision.
 *
 * Returns a new object on every call.
 */
export function buildBrazilReceitaGate2RecordedOwnerDecisionArtifact(): OwnerDecisionArtifact {
  const gate1Artifact = buildBrazilReceitaGate1RecordedOwnerDecisionArtifact();

  return {
    gate1: gate1Artifact.gate1,
    gate2: {
      decisionValue: 'approved',
      ownerRole:
        'joint approval by the technical owner (storage and execution model) and the privacy owner',
      ownerReference: 'OWNER_REF_GATE2_TECHNICAL_AND_PRIVACY_OWNER_JOINT_RELAY_2026_08_21',
      decisionDate: BRAZIL_RECEITA_GATE2_APPROVAL_DATE,
      expirationOrReviewDate:
        'REVIEW_REQUIRED_IF_TEMPORARY_LAYOUT_MATERIALIZES_PROHIBITED_KEY_DERIVED_MATERIAL_OR_AT_NEXT_GOVERNANCE_ROUND',
      evidencePacketReference: 'DOC_BR_RECEITA_CNPJ_GATE2_CONTROLS_AND_EVIDENCE_TEMPLATE',
      legalPrivacySecurityReference:
        'DOC_BR_RECEITA_CNPJ_LEGAL_PRIVACY_DECISION_RECORD_PLUS_PRIVACY_OWNER_BUCKET_ORDINAL_DISPOSITION',
      operatorReviewerRequirement:
        'operator and reviewer remain distinct roles, and neither may be the implementer of this gate subject',
      incidentEscalationReference: 'DOC_BR_RECEITA_CNPJ_EXECUTION_RUNBOOK_INCIDENT_AND_ESCALATION',
      stopConditionsAccepted: true,
    },
    // GATE-7, cap/input policy and the controlled execution attempt stay ABSENT, exactly as in the
    // GATE-1 record: they are `not_started`, and 13A reads an absent section as unapproved.
  };
}
