/**
 * BR Receita CNPJ — RECORDED GATE-3 field policy (BR-SOURCE-GATE-ROUND-1).
 *
 * GATE-3 is the field allowlist gate (10K § 7): it freezes which signals survive the join, closes
 * the denylist, labels every ambiguous field, and assigns a `field_allowlist_version`.
 *
 * ── 🔴 This record does NOT approve GATE-3 ───────────────────────────────────
 *
 * The owners supplied the FIELD POLICY. They also attached a condition to its approval: GATE-3 does
 * not move to `approved` until the CNPJ snapshot blocker is fixed and merged. So this module records
 * a policy and an explicit `not_approved` status, and the two must not be collapsed:
 *
 *   - the policy is DECIDED — the prohibited set, the include set, `trade_name`, `raw_data`;
 *   - the gate is NOT approved — because the code did not yet obey the policy when it was given.
 *
 * Recording the policy while the gate stays shut is the only honest shape available. Recording it as
 * `approved` would mean the repository claimed a frozen allowlist while the sanitized snapshot
 * output still emitted CNPJ básico, and 10K § 4's "any sensitive leak resets the affected gate(s) to
 * `not_started`" would then apply to an approval that was wrong the moment it was written.
 *
 * ── The blocker, precisely ───────────────────────────────────────────────────
 *
 * `br-receita-cnpj-types.ts` labels `BrReceitaCnpjSnapshotRawData` "Sanitized snapshot output
 * (allowlist only — data-contract § 5.2)". That claim was FALSE: the block carried `cnpj_root`
 * (CNPJ básico), `cnpj_order` and `cnpj_dv`, which together reconstruct the full 14-position CNPJ
 * exactly. And the builder's own defence, `assertSanitizedRawData`, only ever inspected KEY NAMES —
 * so a forbidden VALUE under a permitted key passed untouched.
 *
 * Both are addressed in the same workstream as this record. What that fix does NOT reach is
 * recorded below as `BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS`, because a partial fix silently
 * described as complete is how a gate gets approved on a false premise.
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

/** The GATE-3 status this record leaves in place. Not `approved`, and not by accident. */
export const BRAZIL_RECEITA_GATE3_STATUS = 'not_approved_pending_cnpj_snapshot_blocker' as const;

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
 * 🔴 Assigning a version to the POLICY is not the same as releasing the report MARKER. The marker
 * stays `"not_approved"` until GATE-3 itself is approved: a report that named `..._v1` today would
 * be asserting an approved allowlist that does not exist. The two constants below keep that
 * distinction where a reader cannot miss it.
 */
export const BRAZIL_RECEITA_GATE3_FIELD_ALLOWLIST_VERSION =
  'br_receita_cnpj_field_allowlist_v1' as const;

/** What a report may print for `field_allowlist_version` today. Unchanged, on purpose. */
export const BRAZIL_RECEITA_GATE3_REPORT_MARKER_VALUE = 'not_approved' as const;

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
 * Fields the sanitized snapshot output carries today that the owners' include set does not name.
 *
 * 🔴 They are NOT deleted by this record, and the reason matters: `mei_flag`, `simples_opt_in` and
 * `simei_opt_in` are the machinery behind GATE-1's R5 restriction — MEI / empresário individual /
 * natural-person-risk records are excluded by default, and `mei_flag` is how a downstream filter
 * knows which rows those are. Removing a privacy CONTROL because it was absent from an include list
 * of privacy-relevant OUTPUT would be an agent quietly weakening the thing the list exists to
 * protect.
 *
 * So each is recorded as an open item for the joint approvers to label `approved` or `excluded`,
 * which 10K § 7's "nothing unlabelled" criterion requires before GATE-3 can pass.
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
 * 🔴 The first entry is the important one. `BrReceitaCnpjSnapshotRow` carries `tax_id` (the raw full
 * CNPJ), `normalized_tax_id` (the normalized full CNPJ) and `record_identity_key` (`tax:<14>`) as
 * TOP-LEVEL columns of the shared `source_company_snapshots` contract — not as part of the § 5.2
 * "sanitized snapshot output (allowlist only)" block that GATE-3 governs. Removing them is a change
 * to the record identity GRAIN, which is GATE-4's subject and 10K § 3's "changing the subject
 * re-opens the gate". It also diverges Brazil from every other TAX_GRAIN source, whose record
 * identity is derived from that same column.
 *
 * That is a decision for the owners, in the round that owns GATE-4 — not a deletion an agent
 * performs while fixing a different defect.
 */
export const BRAZIL_RECEITA_GATE3_RESIDUAL_BLOCKERS = [
  {
    id: 'RB-1',
    subject: 'top-level tax_id / normalized_tax_id / record_identity_key survival',
    detail:
      'the prohibited-output set forbids full CNPJ and normalized_tax_id snapshot survival; these three shared-contract columns still carry it. Removing them changes the record identity grain.',
    ownedBy: 'GATE_4_IDENTITY_GRAIN',
    resolvedByThisWorkstream: false,
  },
  {
    id: 'RB-2',
    subject: 'twelve-character CNPJ hash used as a rejection diagnostic',
    detail:
      'rejected rows carry a truncated sha-256 fingerprint of the CNPJ as safeIdentifier, and the fixture-only controlled parser reports a list of them. GATE-1 R4 forbids a hash, truncation or fingerprint of the CNPJ anywhere, and the prohibited-output set forbids prohibited CNPJ derivatives. Replacing it needs an owner decision, because it exists to make a rejection diagnosable without printing a CNPJ.',
    ownedBy: 'GATE_3_JOINT_APPROVERS',
    resolvedByThisWorkstream: false,
  },
  {
    id: 'RB-3',
    subject: 'the four unlabelled fields',
    detail:
      'BRAZIL_RECEITA_GATE3_FIELDS_PRESENT_BUT_NOT_IN_INCLUDE_SET must each end as approved or excluded; 10K § 7 requires nothing unlabelled.',
    ownedBy: 'GATE_3_JOINT_APPROVERS',
    resolvedByThisWorkstream: false,
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
] as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this recorded policy carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE3_RESTRICTIONS: readonly string[] = [
  'this record approves no gate',
  'the report marker for field_allowlist_version stays not_approved',
  'an approved allowlist is a target, never a writer authorization',
  'no persistence, import, Supabase write, migration, runtime path or Agent 1 integration',
  'the eligibility design allowlist is not widened',
  'free-text fields fail closed: not on the allowlist means excluded',
  'GATE-4 and GATE-5 remain separate, unapproved and unaffected',
  'every residual blocker must be closed by its named owner before GATE-3 can be approved',
] as const;
