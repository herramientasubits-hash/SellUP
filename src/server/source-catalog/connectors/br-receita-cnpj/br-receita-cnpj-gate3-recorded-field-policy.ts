/**
 * BR Receita CNPJ — RECORDED GATE-3 field policy (BR-SOURCE-GATE-ROUND-1; legal/privacy approval
 * recorded BR-SOURCE-FAST-TRACK-7).
 *
 * GATE-3 is the field allowlist gate (10K § 7): it freezes which signals survive the join, closes
 * the denylist, labels every ambiguous field, and assigns a `field_allowlist_version`.
 *
 * ── 🔴 This record does NOT approve GATE-3 ───────────────────────────────────
 *
 * The owners supplied the FIELD POLICY. The CNPJ snapshot blocker that originally conditioned
 * approval on (RB-2) is now fixed and merged in this same workstream. GATE-3 still does not move to
 * `approved`, because two residual blockers remain open and unresolved — RB-1 (owned by GATE-4) and
 * RB-3 (owned by the GATE-3 joint approvers). So this module records a policy and an explicit
 * `needs_evidence` status, and the two must not be collapsed:
 *
 *   - the policy is DECIDED — the prohibited set, the include set, `trade_name`, `raw_data`;
 *   - the gate is NOT approved — RB-1 and RB-3 still need an owner decision.
 *
 * Recording the policy while the gate stays shut is the only honest shape available. Recording it as
 * `approved` while RB-1 and RB-3 are unresolved would mean the repository claimed a frozen allowlist
 * with two of its residual blockers still unlabelled, and 10K § 7's "nothing unlabelled" pass
 * criterion would then apply to an approval that was wrong the moment it was written.
 *
 * ── 🔴 Update (BR-SOURCE-FAST-TRACK-7) — the legal/privacy half is now recorded ──
 *
 * RB-1 and RB-3 were closed by BR-SOURCE-GATE-ROUND-2 (§ 7.2). What remained was the legal/privacy
 * owner's half of the joint approval, which no agent may supply. It is now recorded, by owner relay
 * 2026-08-24: the legal/privacy owner approves the field policy exactly as recorded —
 * `br_receita_cnpj_field_allowlist_v1`, as corrected by the RB-3 residual-field classification
 * (`br-receita-cnpj-gate3-residual-field-classification.ts`). Nothing about the allowlist, the
 * denylist, or RB-1's boundary with GATE-4 (§ 13.1) is widened or re-decided by this approval; it
 * completes the joint approval this gate has needed since it was first recorded.
 *
 * ── The blocker that WAS here, and is now closed ─────────────────────────────
 *
 * `br-receita-cnpj-types.ts` labelled `BrReceitaCnpjSnapshotRawData` "Sanitized snapshot output
 * (allowlist only — data-contract § 5.2)". That claim was FALSE: the block carried `cnpj_root`
 * (CNPJ básico), `cnpj_order` and `cnpj_dv`, which together reconstruct the full 14-position CNPJ
 * exactly. And the builder's own defence, `assertSanitizedRawData`, only ever inspected KEY NAMES —
 * so a forbidden VALUE under a permitted key passed untouched. Both are fixed in this workstream.
 *
 * A second, subtler instance of the same R4 prohibition was found and fixed alongside it: the
 * rejected-row diagnostic (`safeIdentifier`) carried a truncated SHA-256 fingerprint of the CNPJ.
 * That was RB-2, and it is now discharged too — see `BRAZIL_RECEITA_GATE3_DISCHARGED_BY_THIS_WORKSTREAM`.
 *
 * What this workstream's fix does NOT reach is recorded below as
 * `BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS`, because a partial fix silently described as complete is
 * how a gate gets approved on a false premise.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate, or emits an `OwnerDecisionArtifact` section. 13A has no `gate3` section, and
 *     inventing one here would let a structural validator report an approval nobody recorded.
 *   - authorizes persistence, an import, a Supabase write, a migration, a runtime path, Agent 1,
 *     Agent 2A or a provider call. An approved allowlist is a TARGET, never a writer authorization.
 *   - widens the eligibility design § 5 allowlist.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * The GATE-3 status. Advanced by BR-SOURCE-GATE-ROUND-2 from `needs_evidence` to
 * `ready_for_review` — and still NOT `approved`.
 *
 * 🔴 History of this value, because each step renamed the reason rather than merely relaxing it:
 *
 *   `not_approved_pending_cnpj_snapshot_blocker` → the cnpj_root/cnpj_order/cnpj_dv output leak and
 *       RB-2 (the CNPJ-hash rejection diagnostic). Both fixed in Round 1.
 *   `needs_evidence`                             → RB-1 and RB-3 open. Neither was evidence the gate
 *       lacked; both were decisions nobody had made.
 *   `ready_for_review`                           → Round 2. RB-3 is CLOSED (every field labelled, and
 *       now MECHANICALLY checkable), and RB-1 is discharged as far as this gate's subject reaches:
 *       GATE-4 recorded the disposition and, more to the point, persisting the prohibited identity
 *       material is now REFUSED in code. So every item in 10K § 7's required-evidence and pass-criteria
 *       lists exists in recorded form.
 *
 * 🔴 Update (BR-SOURCE-FAST-TRACK-7): the legal/privacy owner's half of the joint approval is now
 * recorded (see the module header above), by owner relay 2026-08-24. Both halves of the required
 * joint approval — product/data owner AND legal/privacy owner — are attributable, so
 * `BRAZIL_RECEITA_GATE3_STATUS` moves from `ready_for_review` to `approved`.
 */
export const BRAZIL_RECEITA_GATE3_STATUS = 'approved' as const;

/** Whether this record approves the gate. It does, as of BR-SOURCE-FAST-TRACK-7. */
export const BRAZIL_RECEITA_GATE3_APPROVED = true as const;

/**
 * The GATE-3 joint approval criterion, kept under its original name for continuity with prior rounds'
 * suites, now updated to record that BOTH halves are complete (BR-SOURCE-FAST-TRACK-7).
 *
 * The legal/privacy half is an owner RELAY, the same evidentiary form used for every prior approval in
 * this series — not a personal signature: no name, no email, no message id, no URL, and no
 * more-precise timestamp than the date below.
 */
export const BRAZIL_RECEITA_GATE3_SINGLE_REMAINING_CRITERION = {
  criterion:
    'the legal/privacy owner half of the § 14 joint approval entry for the recorded field allowlist and denylist — RECORDED 2026-08-24',
  productDataHalfRecorded: true,
  productDataOwnerReference: 'OWNER_REF_GATE3_PRODUCT_DATA_OWNER_RELAY_2026_08_21',
  legalPrivacyHalfRecorded: true,
  legalPrivacyOwnerReference: 'OWNER_REF_GATE3_LEGAL_PRIVACY_OWNER_RELAY_2026_08_24',
  legalPrivacyApprovalDate: '2026-08-24',
  coveredByTheGate1Determination: false,
  whyNotCoveredByGate1:
    'the GATE-1 determination is the broad development-may-continue decision and states in its own text that GATE-2 through GATE-8 remain not_started at the time it was written; it never reached the field allowlist, which is why a separate legal/privacy confirmation was required and is now recorded',
  agentMayApprove: false,
} as const;

/** The date the legal/privacy owner's confirmation was relayed and recorded. */
export const BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVAL_DATE = '2026-08-24' as const;

/**
 * The joint approvers GATE-3 requires (10K § 7): product / data owner AND legal/privacy owner.
 * Recorded as roles, never identities.
 */
export const BRAZIL_RECEITA_GATE3_PRODUCT_APPROVER_ROLE = 'product / data owner' as const;
export const BRAZIL_RECEITA_GATE3_LEGAL_PRIVACY_APPROVER_ROLE = 'legal/privacy owner' as const;

/** The date the field policy was relayed and recorded. Not an approval date — there is none yet. */
export const BRAZIL_RECEITA_GATE3_POLICY_RECORDED_DATE = '2026-08-21' as const;

// ─── The version identifier ───────────────────────────────────────────────────

/**
 * The assigned `field_allowlist_version`.
 *
 * 🔴 No version had ever been assigned — the 10J § 12 report marker has read `"not_approved"` since
 * it was introduced — so "the next valid version" is the FIRST one. It is scoped to this source so a
 * future report naming it cannot be confused with another country's allowlist.
 *
 * 🔴 Assigning a version to the POLICY is not automatically the same as releasing the report MARKER.
 * The marker was designed to stay `"not_approved"` only UNTIL GATE-3 itself is approved — a report
 * that named `..._v1` before approval would have asserted an approved allowlist that did not exist.
 * That condition is now satisfied: BR-SOURCE-FAST-TRACK-7 recorded GATE-3 as `approved` (see the
 * module header). This constant records the CONSEQUENCE of that approval as data — it is not itself
 * an emitter, no report exists that reads it, and no projection is implemented
 * (`GATE5_ENGINE_REPORT_PROJECTION_REQUIRED` stays `true` in the GATE-5 contract).
 */
export const BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION =
  'br_receita_cnpj_field_allowlist_v1' as const;

/**
 * What a report may print for `field_allowlist_version`, now that GATE-3 is approved. Equal to the
 * version above by construction, never restated as a second literal, so the two cannot drift.
 */
export const BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE = BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION;

// ─── Prohibited output ────────────────────────────────────────────────────────

/**
 * The closed prohibited-output set, ENUMERATED. 10K § 7 requires an explicit, closed denylist, and
 * "and equivalents" is precisely the tail that lets a prohibition drift.
 *
 * `normalized_tax_id snapshot survival` deserves a note: 10O already held that `normalized_tax_id`
 * stays out of OUTPUT however the § 10 persistence question resolves. The owners' policy now says
 * the same thing about SNAPSHOT survival, which is the persistence half. See the residual blockers
 * below for what that implies about code that is not yet compliant.
 */
export const BRAZIL_RECEITA_GATE3_PROHIBITED_OUTPUT: readonly string[] = [
  'CNPJ básico',
  'full CNPJ',
  'cnpj_root',
  'cnpj_order',
  'cnpj_dv',
  'reconstructable CNPJ parts',
  'normalized_tax_id snapshot survival',
  'Socios',
  'QSA',
  'CPF',
  'person-linked data',
  'prohibited CNPJ derivatives',
] as const;

// ─── Included fields ──────────────────────────────────────────────────────────

/**
 * The closed include set the owners approved.
 *
 * 🔴 This is the set of DATA SIGNALS. It is not, and does not claim to be, a field-by-field
 * enumeration of every key `raw_data` may carry: `provenance` covers a group of provenance keys, and
 * the owners named it as a group. `BRAZIL_RECEITA_GATE3_FIELDS_PRESENT_BUT_NOT_IN_INCLUDE_SET`
 * below carries the delta, unresolved, rather than an agent deciding it by deletion.
 */
export const BRAZIL_RECEITA_GATE3_INCLUDED: readonly string[] = [
  'sanitized legal_name',
  'CNAE approved fields',
  'registration status',
  'company size',
  'UF',
  'municipality',
  'opened_at',
  'source period',
  'provenance',
  'capital_social_value',
] as const;

/** `trade_name` (nome fantasia): excluded, and NOT implemented. Two statements, both required. */
export const BRAZIL_RECEITA_GATE3_TRADE_NAME_DISPOSITION = 'EXCLUDED_NOT_IMPLEMENTED' as const;

/** `raw_data`: permitted only as a closed typed allowlist. Never an unfiltered blob. */
export const BRAZIL_RECEITA_GATE3_RAW_DATA_DISPOSITION = 'CLOSED_TYPED_ALLOWLIST' as const;

/**
 * The fields that WERE unlabelled — RB-3's subject. Kept for the audit trail; no longer open.
 *
 * 🔴 BR-SOURCE-GATE-ROUND-2 closed this, and corrected one premise while doing so. Round 1 declined
 * to touch these fields because "`mei_flag` is how a downstream filter knows which rows those are".
 * The caution was right and the premise was false: `raw_data.mei_flag` had exactly one non-test
 * consumer in the repository, a COUNT. The R5 exclusion is enforced by
 * `br-receita-cnpj-privacy-safe-classifier`, which reads natureza jurídica off the EMPRESAS source
 * row and never reads the snapshot payload at all. So the control could not be weakened by removing
 * the payload key — and the count survives, off the internal control array, which is the proof.
 *
 * Each field now carries exactly one label. See
 * `br-receita-cnpj-gate3-residual-field-classification.ts`, which also binds this prose include set
 * to real payload keys so "nothing unlabelled" is a function rather than an argument.
 */
export const BRAZIL_RECEITA_GATE3_FIELDS_PRESENT_BUT_NOT_IN_INCLUDE_SET = [
  {
    field: 'legal_nature_code / legal_nature_label',
    note: 'natureza jurídica; a company attribute, not named in the include set',
  },
  {
    field: 'matrix_branch_flag',
    note: 'identificador matriz/filial; derived from its own source column, never from the CNPJ',
  },
  {
    field: 'simples_opt_in / simei_opt_in',
    note: 'tax regime flags; the inputs that produce mei_flag',
  },
  {
    field: 'mei_flag',
    note: 'the GATE-1 R5 control marker; removing it would weaken a privacy control',
  },
] as const satisfies readonly { readonly field: string; readonly note: string }[];

// ─── Residual blockers ────────────────────────────────────────────────────────

/**
 * What the CNPJ-hardening work in this same workstream does NOT reach, and why GATE-3 therefore
 * stays shut even after that work merges.
 *
 * 🔴 RB-2 (the twelve-character CNPJ hash used as a rejection diagnostic) is NO LONGER here — it is
 * discharged, below, by this same workstream. Only RB-1 and RB-3 remain, and neither is a deletion
 * an agent may perform while fixing a different defect:
 *
 * RB-1: `BrReceitaCnpjSnapshotRow` carries `tax_id` (the raw full CNPJ), `normalized_tax_id` (the
 * normalized full CNPJ) and `record_identity_key` (`tax:<14>`) as TOP-LEVEL columns of the shared
 * `source_company_snapshots` contract — not as part of the § 5.2 "sanitized snapshot output
 * (allowlist only)" block that GATE-3 governs. Removing them is a change to the record identity
 * GRAIN, which is GATE-4's subject and 10K § 3's "changing the subject re-opens the gate". It also
 * diverges Brazil from every other TAX_GRAIN source, whose record identity is derived from that same
 * column. That is a decision for the owners, in the round that owns GATE-4.
 *
 * RB-3: the four unlabelled fields still need the GATE-3 joint approvers to mark each `approved` or
 * `excluded`; 10K § 7 requires nothing unlabelled.
 */
export const BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS = [
  {
    id: 'RB-1',
    subject: 'top-level tax_id / normalized_tax_id / record_identity_key survival',
    detail:
      'CLOSED for this gate in BR-SOURCE-GATE-ROUND-2. These three are top-level columns of the shared source_company_snapshots contract, NOT members of the § 5.2 sanitized block GATE-3 governs — so their grain was never this gate subject, which is why Round 1 handed them to GATE-4. GATE-4 has now recorded them TRANSIENT_ONLY and, decisively for GATE-3, persisting them is REFUSED in code by assertBrazilReceitaSnapshotRowIsPersistable. This gate prohibited-output set is therefore enforced rather than merely asserted. What stays open is which key may EVENTUALLY persist, which is GATE-4 own unresolved owner question and not a GATE-3 criterion.',
    ownedBy: 'GATE_4_IDENTITY_GRAIN',
    resolvedByThisWorkstream: true,
  },
  {
    id: 'RB-3',
    subject: 'the four unlabelled fields',
    detail:
      'CLOSED in BR-SOURCE-GATE-ROUND-2. Every field carries exactly one of INCLUDED_OUTPUT / INTERNAL_PRIVACY_CONTROL_ONLY / EXCLUDED_OUTPUT / NOT_IMPLEMENTED, and the prose include set is now bound to real payload keys, so "nothing unlabelled" is checked by a function instead of argued in a review. See br-receita-cnpj-gate3-residual-field-classification.ts.',
    ownedBy: 'GATE_3_JOINT_APPROVERS',
    resolvedByThisWorkstream: true,
  },
] as const satisfies readonly {
  readonly id: string;
  readonly subject: string;
  readonly detail: string;
  readonly ownedBy: string;
  readonly resolvedByThisWorkstream: boolean;
}[];

/** What the hardening work in this workstream DOES discharge. Stated so the split is legible. */
export const BRAZIL_RECEITA_GATE3_DISCHARGED_BY_THIS_WORKSTREAM: readonly string[] = [
  'cnpj_root removed from the sanitized snapshot output',
  'cnpj_order removed from the sanitized snapshot output',
  'cnpj_dv removed from the sanitized snapshot output',
  'full CNPJ reconstruction from the sanitized snapshot output made impossible',
  'the snapshot output sanitizer extended from key-only to key and value validation',
  'RB-2: the twelve-character CNPJ hash used as a rejection diagnostic replaced with a non-CNPJ execution-local ordinal (safeIdentifier derived from sourceRowIndex)',
  // BR-SOURCE-GATE-ROUND-2.
  'RB-3: every previously unlabelled field carries exactly one of the four dispositions',
  'the prose include set bound to real payload keys, so "nothing unlabelled" is mechanically checkable',
  'legal_nature_code, legal_nature_label, simples_opt_in, simei_opt_in and mei_flag removed from the persisted business payload',
  'the R5 enforcement point identified and recorded, correcting the premise that the payload flag enforced it',
  'RB-1 enforced for this gate: persisting tax_id, normalized_tax_id or a tax-namespaced record_identity_key is refused in code',
] as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this recorded policy carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE3_RESTRICTIONS: readonly string[] = [
  'an approved allowlist is a target, never a writer authorization',
  'no persistence, import, Supabase write, migration, runtime path or Agent 1 integration',
  'the eligibility design allowlist is not widened',
  'free-text fields fail closed: not on the allowlist means excluded',
  'GATE-4 and GATE-5 have their own separate approval requirements',
  // BR-SOURCE-GATE-ROUND-2.
  'RB-3 classifications are product/data decisions and carry no legal/privacy determination on their own',
  'a field labelled INTERNAL_PRIVACY_CONTROL_ONLY may not be promoted to output without a recorded owner decision',
  // BR-SOURCE-FAST-TRACK-7.
  'this approval covers the field policy exactly as recorded; it does not widen the allowlist, the denylist, or RB-1s GATE-4 boundary',
  'no operational flag is flipped by this approval',
] as const;
