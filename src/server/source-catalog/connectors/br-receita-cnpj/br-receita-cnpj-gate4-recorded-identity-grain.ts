/**
 * BR Receita CNPJ — RECORDED GATE-4 identity grain decision (BR-SOURCE-GATE-ROUND-2; approved via
 * three independent sub-decisions 4A/4B/4C, BR-SOURCE-FAST-TRACK-7).
 *
 * GATE-4 is the identity grain gate (10K § 8): it picks one of 10J § 14's four options, defines the
 * future `record_identity_key`, and sets `record_identity_grain_decision`. It has been
 * `not_started` since 10K was written, and 10N landed a proposal for it —
 * `proposed_for_owner_review`, option D recommended, key construction deliberately deferred.
 *
 * This module records what Round 2 can actually decide, and refuses to record what it cannot.
 *
 * ── 🔴 The headline: the GRAIN is decided; the PERSISTED IDENTITY is not ─────
 *
 * `BRAZIL_RECEITA_GATE4_STATUS` is `needs_owner_decision`, and there is exactly ONE unresolved
 * question behind it — `BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION`. It is not vague, and it is
 * not "more evidence". It is a collision between two constraints that are BOTH already recorded and
 * one of which is a human legal/privacy decision this round may not reinterpret:
 *
 *   1. GATE-1 R4 (approved by the legal/privacy owner, 2026-08-21): "CNPJ basico and full CNPJ are
 *      both categorically non-printable and non-persistible, with no hash, truncation or fingerprint
 *      of either anywhere."
 *   2. 10K § 8 pass criterion: "`record_identity_key` is DETERMINISTIC and derivable without
 *      printing or persisting a prohibited identifier."
 *
 * The only stable natural identifier Receita publishes for an establishment IS its CNPJ. A
 * deterministic key for an establishment must therefore be a function of the CNPJ — and every
 * function of it (raw, normalized, hashed, truncated, fingerprinted, encoded) is barred by (1). A
 * key derived from non-identifier attributes instead is not unique, and 10N § 5.4 already records
 * that piling coarse attributes onto one row makes indirect identifiability WORSE, not better. So
 * (1) and (2) cannot both be satisfied by any construction that exists.
 *
 * That is a real finding, not a gap in the analysis. It is recorded as
 * `BRAZIL_RECEITA_GATE4_CONSTRAINT_COLLISION`, and it is why a non-derived surrogate — the safest
 * thing available — is ALSO not sufficient on its own: see the runtime lookup section.
 *
 * ── 🔴 Update (BR-SOURCE-FAST-TRACK-7) — the question is answered; GATE-4 is APPROVED ──
 *
 * The legal/privacy owner has answered `BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION` YES, by owner
 * relay recorded 2026-08-24: a narrow, ENUMERATED exception to GATE-1 R4 is authorized for exactly one
 * persisted, never-printed, never-logged, never-reported representation of the establishment CNPJ,
 * solely to serve as the row's internal exact-lookup key. That answer is recorded as `4A` below.
 * `4B` (data architecture owner) and `4C` (product owner) separately record OWNER approval of the
 * grain this module already evaluated and recorded as decided. Per 10K § 4's rule against collapsing
 * decisions into a batch, the three are recorded independently rather than as one "approve everything"
 * entry — see the BR-SOURCE-FAST-TRACK-7 section near the end of this module.
 *
 * With 4A + 4B + 4C all recorded, `BRAZIL_RECEITA_GATE4_STATUS` moves from `needs_owner_decision` to
 * `approved`. That is a decision about the GRAIN and about WHETHER an exception may exist — it is not
 * an implementation. No surrogate is built, no migration is authored or applied, the runtime lookup
 * productization blocker stays recorded as one, and `tax_id` / `normalized_tax_id` /
 * `record_identity_key` stay exactly `TRANSIENT_ONLY`. See
 * `BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT` for the closed list.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves GATE-4, or any other gate.
 *   - emits an `OwnerDecisionArtifact` section. 13A has no `gate4` section, and inventing one would
 *     let a structural validator report an approval nobody recorded.
 *   - generates, derives or implements a record identity. It records constraints; it builds no key.
 *     A surrogate generator is deliberately ABSENT — implementing one would be implementing the half
 *     of the decision the owners have not made.
 *   - creates, edits or applies a migration, and changes no index and no physical schema. The DDL
 *     that a monthly grain WOULD need is recorded as TEXT, precisely so that recording it is not
 *     doing it.
 *   - authorizes persistence, an import, a Supabase write, a runtime path, Agent 1, Agent 2A or a
 *     provider call.
 *   - registers this source in `SOURCE_FAMILY_BY_SOURCE_KEY`. That registry throws for an unknown
 *     key, and a throw is the correct answer while the persisted identity is unresolved.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 */

import type { BrReceitaCnpjSnapshotRow } from './br-receita-cnpj-types';
// 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — the guard below now has to VALIDATE the one representation it
// permits, not merely detect its presence. Both validators are the canonical repository
// primitives, imported rather than restated: a second notion of "a valid CNPJ" or "a valid period"
// living in the guard would be the drift this whole line of work exists to prevent.
import { normalizeBrazilCnpj, BR_CNPJ_LENGTH } from './br-cnpj';
import { isValidSourcePeriod } from '../../source-period';

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * GATE-4's status. `approved` as of BR-SOURCE-FAST-TRACK-7: the single legal/privacy question is
 * answered (4A), and the grain is owner-approved by both required roles (4B, 4C). See
 * `BRAZIL_RECEITA_GATE4_SUB_DECISIONS` for the three independent records and
 * `BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT` for what this approval does not do.
 */
export const BRAZIL_RECEITA_GATE4_STATUS = 'approved' as const;

/**
 * The joint approvers GATE-4 requires (10K § 8): data architecture owner AND product owner. Roles
 * only, and neither may be the implementer of the gate's subject (10K § 3).
 */
export const BRAZIL_RECEITA_GATE4_DATA_ARCHITECTURE_APPROVER_ROLE =
  'data architecture owner' as const;
export const BRAZIL_RECEITA_GATE4_PRODUCT_APPROVER_ROLE = 'product owner' as const;
export const BRAZIL_RECEITA_GATE4_APPROVAL_IS_JOINT = true as const;

/** The date this record was written. Not an approval date — there is none. */
export const BRAZIL_RECEITA_GATE4_RECORDED_DATE = '2026-08-21' as const;

/**
 * Which halves of GATE-4 are settled. Split so a reader cannot take the grain decision as the whole
 * gate, which is the single most likely misreading of this module.
 */
export const BRAZIL_RECEITA_GATE4_DECIDED_PARTS = {
  grain: 'decided_and_owner_approved',
  deduplicationConsequence: 'decided',
  publicationPeriodModel: 'decided',
  replacementSemantics: 'decided',
  identityFieldPersistenceClassification: 'decided',
  legalPrivacyExceptionQuestion: 'answered_yes_by_owner_relay_2026_08_24',
  persistedRecordIdentityConstruction: 'exception_granted_concrete_construction_not_implemented',
  runtimeExactLookupMechanism: 'productization_blocker_recorded_not_resolved',
} as const;

// ─── A. The grain ─────────────────────────────────────────────────────────────

/**
 * The four options 10K § 8 requires to be evaluated explicitly, and the one chosen.
 *
 * This is a PRODUCT / DATA decision, and it is the one part of GATE-4 that Round 2 can make: it
 * touches no privacy contract, it inherits 10N's evaluation of all four options rather than
 * re-deriving it, and it is the shape CN1 § 4 already describes.
 *
 * D is chosen, and D is NOT "we already default to A" — the failure mode 10K § 8 names explicitly.
 * D is A plus three things A leaves silent: company context is mandatory on the row, the structural
 * root is never an identity, and root-level grouping is a read-time projection rather than a stored
 * key.
 */
export const BRAZIL_RECEITA_GATE4_GRAIN_OPTIONS = {
  optionA: {
    label: 'record_identity_key per estabelecimento (full-CNPJ grain)',
    chosen: false,
    rejectedBecause:
      'silent on company context, so a fail-closed eligibility classifier has no legal-nature signal on the row, and silent on root grouping, which is where the over-counting risk lives',
  },
  optionB: {
    label: 'record_identity_key per empresa / root (cnpj_basico grain)',
    chosen: false,
    rejectedBecause:
      'requires the structural root to become a record identity, which 10I § 5 forbids, and collapses units that genuinely differ in UF, municipality, activity, status and opening date',
  },
  optionC: {
    label: 'two separate snapshots (company snapshot + establishment snapshot)',
    chosen: false,
    rejectedBecause:
      'introduces a second grain into a single-grain table, needing a discriminator and a migration on grain grounds, and still makes the root an identity for half of itself',
  },
  optionD: {
    label:
      'single operational snapshot — establishment as the operational unit, company / root as context',
    chosen: true,
    rejectedBecause: null,
  },
} as const;

export const BRAZIL_RECEITA_GATE4_CHOSEN_GRAIN = 'option_d' as const;

/**
 * 🔴 What a report may print for `record_identity_grain_decision`, now that GATE-4 is APPROVED
 * (BR-SOURCE-FAST-TRACK-7). Equal to the chosen grain by construction, never a second literal, so the
 * two cannot drift. This is the GRAIN marker only — it says nothing about the persisted-identity
 * CONSTRUCTION, which stays unimplemented (see `BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT`). No emitter
 * or report exists that reads this constant; recording it is not implementing a projection.
 */
export const BRAZIL_RECEITA_GATE4_REPORT_MARKER_VALUE = BRAZIL_RECEITA_GATE4_CHOSEN_GRAIN;

/**
 * A. What real-world entity ONE Brazil snapshot record is. Stated as one sentence because ambiguity
 * between company and establishment is the failure mode 10K § 8 and this round both name.
 */
export const BRAZIL_RECEITA_GATE4_RECORD_ENTITY =
  'one Receita ESTABELECIMENTO (operational unit), carrying its EMPRESA (root) attributes as context on the same row' as const;

/** The root is context, never an identity, and never a stored key. */
export const BRAZIL_RECEITA_GATE4_ROOT_DISPOSITION = {
  persistedAsIdentity: false,
  persistedAsStoredGroupingKey: false,
  rootLevelGrouping: 'read_time_projection_only',
} as const;

// ─── E. Deduplication, update, monthly replacement ────────────────────────────

/**
 * E. What supports dedup / update / monthly replacement under option D.
 *
 * 🔴 The important entry is the last one. Under a period-scoped replacement model, row-level
 * durable identity is NOT what makes a refresh idempotent — the PERIOD is the unit of replacement.
 * That is what makes a non-derived surrogate viable as row identity at all, and it is also why the
 * surrogate alone does not solve runtime lookup: replacing a month and FINDING a company are
 * different problems, and only the first one is solved here.
 */
export const BRAZIL_RECEITA_GATE4_DEDUPLICATION_MODEL = {
  dedupBy: 'operational_unit_within_one_publication_period',
  dedupByRoot: false,
  dedupByLegalName: false,
  multipleUnitsOfOneEntityAreDistinctRows: true,
  consumerRuleForRollup: 'read_time_projection_never_a_stored_key',
  nUnitsAreNotNCommercialAccounts: true,
  idempotencyUnit: 'publication_period',
} as const;

// ─── C / D. What may persist, and what may not ───────────────────────────────

/** The persistence disposition vocabulary § 8 of the Round-2 brief requires. */
export type BrazilReceitaGate4FieldPersistence =
  | 'PERSISTED'
  | 'TRANSIENT_ONLY'
  | 'REMOVED'
  | 'SURROGATE';

export interface BrazilReceitaGate4IdentityFieldDisposition {
  readonly field: string;
  readonly persistence: BrazilReceitaGate4FieldPersistence;
  /** The contract or gate that OWNS this disposition. Never "GATE-4" alone where R4 governs. */
  readonly owner: string;
  readonly reason: string;
}

/**
 * RB-1, resolved as far as a non-privacy owner may resolve it: the three top-level identity columns
 * are TRANSIENT_ONLY.
 *
 * 🔴 `TRANSIENT_ONLY` and not `REMOVED`, deliberately, and the distinction is the whole of RB-1:
 *
 *   - REMOVED would delete the fields from the in-memory parser row. That destroys the parser's own
 *     duplicate detection, and it also PRE-EMPTS the owner question below — if the owners grant the
 *     narrow exception, the field has to be there to carry it.
 *   - TRANSIENT_ONLY keeps them in memory and makes PERSISTING them fail closed. That enforces the
 *     already-recorded R4 prohibition and the already-recorded GATE-3 prohibited-output set without
 *     deciding anything new.
 *
 * The enforcement is `assertBrazilReceitaSnapshotRowIsPersistable` below. It is not advice.
 */
export const BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS = [
  {
    field: 'tax_id',
    persistence: 'TRANSIENT_ONLY',
    owner: 'GATE_1_R4_LEGAL_PRIVACY',
    reason:
      'the raw full CNPJ. R4 makes the full CNPJ categorically non-persistible, and GATE-3 lists "full CNPJ" in its closed prohibited-output set. Kept in memory for duplicate detection; refused at any persistence boundary.',
  },
  {
    field: 'normalized_tax_id',
    persistence: 'PERSISTED',
    owner: 'GATE_4A_EXCEPTION_EXERCISED_BY_FUNCTIONAL_CUT_A',
    reason:
      'the normalized full CNPJ, and — since BR-SOURCE-FUNCTIONAL-CUT-A — the ONE persisted internal exact-lookup representation 4A authorized. It is never printed, never logged, never reported and never present in a public projection. It is PERSISTED rather than TRANSIENT_ONLY because 4A granted exactly one such representation and this is the column the existing read primitives already take, which is the branch 4A\'s own `ifYes` anticipated. tax_id and record_identity_key stay refused, so "exactly one" is enforced rather than asserted.',
  },
  {
    field: 'record_identity_key',
    persistence: 'TRANSIENT_ONLY',
    owner: 'GATE_1_R4_LEGAL_PRIVACY',
    reason:
      'literally `tax:<normalized_14>` — the prohibited identifier wearing a namespace. A namespace prefix is not a transformation. Kept in memory; refused at any persistence boundary. What a PERSISTED key may be is the unresolved owner question.',
  },
] as const satisfies readonly BrazilReceitaGate4IdentityFieldDisposition[];

/**
 * What is allowed to persist (C) once — and only once — an import is separately authorized: the
 * allowlisted business payload GATE-3 governs, plus the source/country/period coordinates. No
 * identity column among them, which is exactly the problem the owner question below names.
 */
export const BRAZIL_RECEITA_GATE4_PERSISTABLE_TODAY: readonly string[] = [
  'source_key',
  'country_code',
  'source_year',
  'legal_name (sanitized)',
  'raw_data (GATE-3 closed typed allowlist)',
  // BR-SOURCE-FUNCTIONAL-CUT-A — the monthly identity. `source_period` is the identity dimension
  // and `normalized_tax_id` is the single exact-lookup representation 4A authorized; together they
  // are what closed the "no identity column among them" problem this list used to name.
  'source_period (YYYY-MM, the identity dimension)',
  'normalized_tax_id (the ONE internal exact-lookup representation, 4A)',
] as const;

/** D. Transient-only, enumerated. */
export const BRAZIL_RECEITA_GATE4_TRANSIENT_ONLY: readonly string[] =
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.map((entry) => entry.field);

// ─── The constraint collision, and the surrogate ─────────────────────────────

/**
 * Why no construction satisfies both recorded constraints. Recorded as data so a future reader
 * cannot resolve it by forgetting one half.
 */
export const BRAZIL_RECEITA_GATE4_CONSTRAINT_COLLISION = {
  constraintOne:
    'GATE-1 R4 (human legal/privacy decision): no full CNPJ, no básico, and no hash, truncation or fingerprint of either, ANYWHERE',
  constraintTwo:
    '10K § 8 pass criterion: record_identity_key must be DETERMINISTIC and derivable without persisting a prohibited identifier',
  whyBothCannotHold:
    'the only stable natural identifier Receita publishes for an establishment is its CNPJ, so any deterministic establishment key is a function of the CNPJ, and every function of it is barred by constraint one',
  attributeDerivedKeyRejected:
    'a key derived from coarse attributes instead is not unique and increases indirect identifiability (10N § 5.4), so it fails both exactness and privacy',
  resolvableByAgent: false,
} as const;

/**
 * The surrogate options, and the honest verdict on each. § 9 of the Round-2 brief asks for a
 * NON-derived surrogate to be preferred, and it is preferred here — but preferring it does not make
 * it sufficient, and saying otherwise would be the "fake-safe surrogate" that brief forbids.
 */
export const BRAZIL_RECEITA_GATE4_SURROGATE_EVALUATION = [
  {
    candidate: 'normalized full CNPJ as the key payload (10N construction 1)',
    admissible: false,
    because: 'barred by GATE-1 R4. A namespace prefix is not a transformation.',
  },
  {
    candidate: 'hash / truncation / fingerprint / base64 of the CNPJ',
    admissible: false,
    because:
      'barred by GATE-1 R4 by name. A derived value of a prohibited identifier is prohibited, and proposing it as a privacy workaround would be wrong rather than clever.',
  },
  {
    candidate: 'random UUID or opaque generated record id, not derived from the CNPJ',
    admissible: true,
    because:
      'carries no identifier material, so R4 does not reach it. It satisfies row identity under period-scoped replacement, where the period rather than the row is the idempotency unit.',
    butInsufficientBecause:
      'it is not DETERMINISTIC in the 10K § 8 sense, and — decisively — it gives a future consumer no way to FIND the row for a known company. See the runtime lookup finding.',
  },
  {
    candidate: 'legal-name or fuzzy-name lookup key',
    admissible: false,
    because:
      'the shared record-identity module forbids the `name` namespace globally, in code, precisely so a company name can never become an identity fallback. It is also not exact identity.',
  },
] as const;

/** B. The stable record identity, as far as it is decided. */
export const BRAZIL_RECEITA_GATE4_RECORD_IDENTITY = {
  conceptualShape: 'br_receita_establishment:<non_cnpj_derived_opaque_surrogate>',
  surrogateMustNotBeDerivedFromCnpj: true,
  concreteConstructionDecided: false,
  implementedInThisRound: false,
  namespaceReservedNotBound: true,
} as const;

// ─── The runtime lookup problem (§ 10) ───────────────────────────────────────

/**
 * 🔴 The finding that decides GATE-4, and the reason this record does not close it.
 *
 * The question is not academic: if Brazil rows are ever written, a future Agent 1 has to be able to
 * find the row for a company it is holding. Every lookup primitive that exists takes one of exactly
 * two entry points, and Brazil can supply neither:
 *
 *   `readSnapshotByRecordIdentityKey`        — needs the caller to already KNOW the key. With a
 *                                              non-derived surrogate, nobody outside the writing run
 *                                              can compute it. Unusable.
 *   `readTaxGrainSnapshotByTaxId`            — needs `normalized_tax_id`. TRANSIENT_ONLY. Unusable.
 *   `readLatestTaxGrainSnapshotByTaxId`      — same. Unusable.
 *   `probeNativeSnapshotsByTaxId`            — same. Unusable.
 *   `probeLatestNativeSnapshotsByTaxId`      — same. Unusable.
 *
 * Note what the NATIVE_RECORD_GRAIN family shows: `ec_scvs` keeps a provider-native `expediente` as
 * its record identity AND persists `normalized_tax_id` as the lookup entry point. That model works
 * because the two are separate fields. Brazil cannot copy it, because Brazil's blocked field IS the
 * lookup entry point — and Receita publishes no second native identifier to put in its place.
 *
 * So the outcome is (C) of the three the brief allows: no compliant exact-lookup mechanism exists.
 * That is a PRODUCTIZATION BLOCKER and it is recorded as one.
 */
export const BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING = {
  outcome: 'C_NO_COMPLIANT_LOOKUP_MECHANISM_EXISTS',
  isProductizationBlocker: true,
  existingPrimitivesRequire: ['normalized_tax_id', 'a caller-known record_identity_key'],
  brazilCanSupply: [],
  fuzzyNameLookupConsidered: 'rejected_forbidden_namespace_and_not_exact_identity',
  nativeGrainAnalogyFails:
    'ec_scvs persists normalized_tax_id as its lookup entry point alongside a native record identity; Brazil has no second native identifier and its lookup entry point is the blocked field',
} as const;

/** Receita publishes no establishment identifier other than the CNPJ. Stated so it is not re-searched. */
export const BRAZIL_RECEITA_GATE4_NO_ALTERNATIVE_NATIVE_IDENTIFIER = true as const;

/**
 * The single unresolved question. ONE, exact, and addressed to the owner who can actually answer it.
 *
 * 🔴 It is a LEGAL/PRIVACY question. No agent answered it, recommended an answer, or attributed an
 * answer to anyone — `agentMayAnswer` stays `false`. `answeredBy` was `null` until BR-SOURCE-FAST-TRACK-7,
 * when the legal/privacy owner answered it YES by owner relay, recorded as `4A` below.
 */
export const BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION = {
  question:
    'Does the legal/privacy owner authorize exactly ONE persisted, never-printed, never-logged, never-reported representation of the establishment CNPJ inside source_company_snapshots, to serve as the row exact-lookup key, as a narrow enumerated exception to GATE-1 R4 — or not?',
  askedOf: 'LEGAL_PRIVACY_OWNER',
  answeredBy: 'OWNER_REF_GATE4A_LEGAL_PRIVACY_OWNER_RELAY_2026_08_24',
  answer: 'yes',
  ifYes:
    'GATE-4 can be approved with a deterministic key, the existing lookup primitives work unchanged, and the exception must be recorded with its own enumerated bounds',
  ifNo:
    'Brazil cannot support exact runtime lookup at all; the productization path stops at GATE-4, and any Brazil snapshot would be write-only data no consumer can address',
  agentMayAnswer: false,
} as const;

// ─── BR-SOURCE-FAST-TRACK-7 — GATE-4 approved via three independent sub-decisions ──

/**
 * 🔴 GATE-4 is APPROVED via three separately recorded decisions — 4A, 4B, 4C — never bundled into one
 * "approve everything" record. 10K § 4 forbids collapsing gates or decisions into a batch, and that
 * spirit applies to a gate's own sub-decisions too:
 *
 *   4A — legal/privacy owner: answers the single unresolved question above YES, as a narrow
 *        enumerated exception to GATE-1 R4. Does not choose a storage encoding.
 *   4B — data architecture owner: approves option D as the identity grain — the SAME grain already
 *        recorded as decided above — now recorded as owner-APPROVED.
 *   4C — product owner: approves option D as the product grain, explicitly on the record that exact
 *        lookup is required and a fuzzy/name-based lookup is NOT an acceptable substitute.
 *
 * Each is an owner RELAY — the evidentiary form this series has used for every prior approval
 * (`OWNER_REF_GATE{n}_{ROLE}_RELAY_{date}`) — not a personal signature: no name, no email, no message
 * id, no URL, no more-precise timestamp than the date below.
 */
export const BRAZIL_RECEITA_GATE4A_APPROVAL = {
  approvedBy: 'LEGAL_PRIVACY_OWNER',
  approvedByAgent: false,
  decision: 'yes',
  grants:
    'a narrow, ENUMERATED exception to GATE-1 R4: exactly one persisted, never-printed, never-logged, never-reported representation of the establishment CNPJ inside source_company_snapshots, solely to serve as that row internal exact-lookup key',
  choosesAStorageEncoding: false,
  ownerReference: 'OWNER_REF_GATE4A_LEGAL_PRIVACY_OWNER_RELAY_2026_08_24',
  decisionDate: '2026-08-24',
} as const;

/**
 * 🔴 GATE-4A LOCATION AMENDMENT — BR-COMPACT-SNAPSHOT-PRODUCTIZATION.
 *
 * Recorded SEPARATELY from `BRAZIL_RECEITA_GATE4A_APPROVAL`, which is preserved verbatim above,
 * because 4A is the evidentiary record of what the legal/privacy owner approved on 2026-08-24 and
 * that record does not get rewritten. This is a later, narrower owner decision ABOUT that record.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 *
 * ONLY the location of the single permitted representation:
 *
 *     FROM  public.source_company_snapshots.normalized_tax_id
 *     TO    public.br_receita_snapshots.normalized_tax_id
 *
 * BR-PROD-STORAGE-RIGHT-SIZING measured the generic projection at 1409 B/row — 94.9 GB for one
 * national month — and moved Brazil onto a dedicated, run-partitioned table. The single persisted
 * exact-CNPJ representation moved with it. The SUBSTANCE of 4A is untouched: still exactly one,
 * still never printed, never logged, never reported, never publicly projected.
 *
 * ── 🔴 What is still prohibited, and is now UNREPRESENTABLE ─────────────────
 *
 * `br_receita_snapshots` has no `tax_id` column, no `record_identity_key` column and no jsonb at
 * all, so the prohibitions below are enforced by the table's shape rather than by a writer that
 * remembers them:
 *
 *   · `tax_id` persistence · `record_identity_key` persistence · CNPJ in JSON
 *   · CNPJ fragments · any hash/fingerprint/surrogate derived from the CNPJ
 *   · logging, reporting or public projection of `normalized_tax_id`
 *
 * ── 🔴 What this amendment is NOT ───────────────────────────────────────────
 *
 * It is not a WIDENING. It authorizes no second representation, no additional column, no other
 * table and no other connector — `appliesToBrazilOnly` is the whole scope. And it authorizes no
 * apply: migration 134 is authored and numbered, not applied.
 */
export const BRAZIL_RECEITA_GATE4A_LOCATION_AMENDMENT = {
  milestone: 'BR-COMPACT-SNAPSHOT-PRODUCTIZATION',
  amends: 'BRAZIL_RECEITA_GATE4A_APPROVAL',
  approvedBy: 'OWNER',
  approvedByAgent: false,
  decision: 'approved',
  changes: 'location_only',
  fromPersistedIdentityColumn: 'source_company_snapshots.normalized_tax_id',
  toPersistedIdentityColumn: 'br_receita_snapshots.normalized_tax_id',
  /** The count 4A granted, unchanged. */
  identityRepresentationCount: 1,
  widensThePermission: false,
  appliesToBrazilOnly: true,
  authorizesASecondRepresentation: false,
  authorizesAnyOtherTable: false,
  authorizesAnyOtherConnector: false,
  authorizesAnApply: false,
  /** Still prohibited, verbatim from the owner decision. */
  stillProhibited: [
    'tax_id persistence',
    'record_identity_key persistence',
    'CNPJ in JSON',
    'CNPJ fragments',
    'hash/fingerprint/surrogate derived from CNPJ',
    'logging/reporting/public projection of normalized_tax_id',
  ] as readonly string[],
  migrationFile: '134_br_receita_compact_snapshot.sql',
  migrationApplied: false,
  ownerReference: 'OWNER_REF_GATE4A_LOCATION_AMENDMENT_BR_COMPACT_SNAPSHOT_PRODUCTIZATION',
} as const;

/**
 * The location that is AUTHORITATIVE today.
 *
 * 🔴 One exported constant, so a reader never has to decide which of two historical records to
 * believe. `BRAZIL_RECEITA_GATE4A_APPROVAL` and `BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION`
 * both still name the pre-amendment location, correctly, as the record of what was approved and
 * what CUT A built at the time.
 */
export const BRAZIL_RECEITA_CURRENT_PERSISTED_IDENTITY_COLUMN =
  BRAZIL_RECEITA_GATE4A_LOCATION_AMENDMENT.toPersistedIdentityColumn;

export const BRAZIL_RECEITA_GATE4B_APPROVAL = {
  approvedBy: 'DATA_ARCHITECTURE_OWNER',
  approvedByAgent: false,
  approves: 'option_d',
  approvesTheSameGrainAlreadyRecordedAsDecided: true,
  ownerReference: 'OWNER_REF_GATE4B_DATA_ARCHITECTURE_OWNER_RELAY_2026_08_24',
  decisionDate: '2026-08-24',
} as const;

export const BRAZIL_RECEITA_GATE4C_APPROVAL = {
  approvedBy: 'PRODUCT_OWNER',
  approvedByAgent: false,
  approves: 'option_d',
  exactLookupRequired: true,
  fuzzyOrNameBasedLookupAcceptable: false,
  ownerReference: 'OWNER_REF_GATE4C_PRODUCT_OWNER_RELAY_2026_08_24',
  decisionDate: '2026-08-24',
} as const;

/** The date all three GATE-4 sub-decisions were relayed and recorded. */
export const BRAZIL_RECEITA_GATE4_SUB_DECISIONS_RECORDED_DATE = '2026-08-24' as const;

/**
 * The three sub-decisions, listed so a test can assert exactly three independently-recorded records,
 * each with its own owner reference and date — never one bundled approval.
 */
export const BRAZIL_RECEITA_GATE4_SUB_DECISIONS = [
  { id: '4A', approver: 'LEGAL_PRIVACY_OWNER', record: BRAZIL_RECEITA_GATE4A_APPROVAL },
  { id: '4B', approver: 'DATA_ARCHITECTURE_OWNER', record: BRAZIL_RECEITA_GATE4B_APPROVAL },
  { id: '4C', approver: 'PRODUCT_OWNER', record: BRAZIL_RECEITA_GATE4C_APPROVAL },
] as const;

/**
 * 🔴 What 4A/4B/4C together do NOT do. Enumerated so an approved GATE-4 is never misread as a solved
 * productization path or as an implementation.
 */
export const BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT: readonly string[] = [
  'implement a surrogate generator or any key-construction code',
  'author or apply the source_period migration or its unique index',
  'change tax_id, normalized_tax_id or record_identity_key from TRANSIENT_ONLY',
  'resolve the runtime lookup productization blocker — it stays recorded as one',
  'register this source in SOURCE_FAMILY_BY_SOURCE_KEY',
  'authorize persistence, an import, a Supabase write, a runtime path, Agent 1 or Agent 2A',
] as const;

// ─── Project technical direction — NOT a legal/privacy approval ──────────────

/**
 * 🔴 Project TECHNICAL DIRECTION only, recorded separately from 4A/4B/4C because it is a DIFFERENT
 * kind of statement: a preference for the eventual implementation, not a legal/privacy approval and
 * not a human privacy signature. It authorizes NO persistence.
 *
 * The direction: if and when a persisted exact-lookup representation is ever implemented under 4A's
 * exception, it should be a single normalized 14-character establishment CNPJ — never a hash,
 * fingerprint, truncation, partial CNPJ, other encoded derivative, or multiple representations.
 * Reasoning: exact lookup needs an exact key, and a hash or other derivative only adds
 * derivative-privacy ambiguity with no product benefit — it remains a CNPJ derivative under GATE-1
 * R4's own terms, which is exactly why `BRAZIL_RECEITA_GATE4_SURROGATE_EVALUATION` above already
 * rejected the hash / truncation / fingerprint / base64 candidate.
 *
 * This direction does not author or apply the source_period migration
 * (`BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION` stays exactly as recorded — not authorized, not
 * authored), does not change the TRANSIENT_ONLY disposition of tax_id / normalized_tax_id /
 * record_identity_key, and does not resolve the recorded productization blocker
 * (`BRAZIL_RECEITA_GATE4_RUNTIME_LOOKUP_FINDING` stays exactly as recorded) — it narrows what a
 * FUTURE resolution would look like; it does not implement one.
 */
export const BRAZIL_RECEITA_GATE4_TECHNICAL_DIRECTION_EXACT_LOOKUP_REPRESENTATION = {
  isALegalPrivacyApproval: false,
  isAHumanPrivacySignature: false,
  decidedBy: 'project_technical_direction',
  preferredRepresentation: 'single_normalized_14_character_establishment_cnpj',
  rejectedRepresentations: [
    'hash',
    'fingerprint',
    'truncation',
    'partial_cnpj',
    'other_encoded_derivative',
    'multiple_representations',
  ] as readonly string[],
  reasoning:
    'exact lookup requires an exact key; a hash or other derivative only adds derivative-privacy ambiguity with no product benefit, and remains a CNPJ derivative under GATE-1 R4',
  authorizesPersistence: false,
  authorsOrAppliesMigration: false,
  changesTransientOnlyDisposition: false,
  resolvesRuntimeLookupBlocker: false,
  recordedDate: '2026-08-24',
} as const;

// ─── Monthly identity (§ 11) ─────────────────────────────────────────────────

/**
 * F. How 2026-07 differs from a later month — and the schema fact that makes it a problem today.
 *
 * Receita publishes MONTHLY. The physical table is YEAR-grained:
 *
 *   - `source_company_snapshots` has `source_year int NOT NULL` and NO `source_period` column.
 *     The monthly period exists only inside `raw_data.source_period`, i.e. inside a JSONB blob, where
 *     no unique constraint can see it.
 *   - the only physical uniqueness is `UNIQUE (source_key, country_code, source_year,
 *     normalized_tax_id)` (migration 065).
 *   - `record_identity_key` was added nullable, non-unique, with a `NOT VALID` check (migration 087),
 *     and both shared conflict targets are year-grained.
 *
 * 🔴 Two concrete consequences, and neither is theoretical:
 *
 *   1. With `normalized_tax_id` populated, 2026-08 would UPSERT ONTO 2026-07 for the same
 *      establishment, because the constraint cannot tell the two months apart. Monthly history is
 *      destroyed by a constraint that believes it is preventing duplicates.
 *   2. With `normalized_tax_id` NULL — which is what TRANSIENT_ONLY means — Postgres treats NULLs as
 *      DISTINCT, so that unique constraint stops constraining ANYTHING. Every month would insert a
 *      full duplicate set, unbounded, with no idempotency and no dedup. This is the more dangerous
 *      of the two, and it is the state Brazil is actually in.
 *
 * Monthly grain therefore CANNOT be expressed without a schema change, and GATE-4's *Does NOT allow*
 * clause forbids creating one. So the required DDL is recorded as TEXT below and no migration file
 * is authored.
 */
export const BRAZIL_RECEITA_GATE4_PERIOD_MODEL = {
  publicationCadence: 'monthly',
  sourcePeriodGrain: 'YYYY-MM',
  firstTargetPeriod: '2026-07',
  // 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — the last dimension is `normalized_tax_id`, NOT
  // `record_identity_key`. Round 2 could only name the key it hoped would exist; 4A's exception
  // made the fiscal column itself the persisted representation, and `record_identity_key` stays
  // refused precisely so there is exactly one.
  identityDimensionsRequired: ['source_key', 'country_code', 'source_period', 'normalized_tax_id'],
  schemaSupportsMonthlyToday: false,
  sourcePeriodColumnExists: false,
  sourcePeriodLivesOnlyIn: 'raw_data.source_period (JSONB, invisible to any unique constraint)',
  currentPhysicalUniqueness: 'UNIQUE (source_key, country_code, source_year, normalized_tax_id)',
  recordIdentityKeyIsUnique: false,
} as const;

/**
 * 🔴 The two ways the year-grained constraint fails Brazil, kept as separate named facts because
 * they need different fixes and the second one is easy to miss.
 */
export const BRAZIL_RECEITA_GATE4_YEAR_GRAIN_HAZARDS = [
  {
    id: 'YH-1',
    condition: 'normalized_tax_id populated',
    consequence: 'a later month upserts onto an earlier month of the same year; monthly history lost',
  },
  {
    id: 'YH-2',
    condition: 'normalized_tax_id NULL (the TRANSIENT_ONLY outcome)',
    consequence:
      'NULLS DISTINCT makes the unique constraint vacuous; every month inserts a full duplicate set with no idempotency and no dedup',
  },
] as const;

/**
 * The exact future migration a monthly grain requires. TEXT, not a migration file.
 *
 * 🔴 Recorded and NOT authored: GATE-4's *Does NOT allow* clause is "creating or modifying a
 * migration" and "changing the physical schema". Writing the `.sql` would be doing the thing the gate
 * forbids while claiming to respect it. It is also premature in a second way — the unique index
 * below has to name whatever key the unresolved owner question settles on, and that name does not
 * exist yet.
 */
export const BRAZIL_RECEITA_GATE4_REQUIRED_FUTURE_MIGRATION = {
  authorizedNow: false,
  authoredInThisRound: false,
  blockedUntil: 'the single unresolved owner question is answered',
  statements: [
    'ALTER TABLE public.source_company_snapshots ADD COLUMN source_period text NULL;',
    "ALTER TABLE public.source_company_snapshots ADD CONSTRAINT source_company_snapshots_source_period_format_chk CHECK (source_period IS NULL OR source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;",
    'CREATE UNIQUE INDEX CONCURRENTLY source_company_snapshots_period_identity_uidx ON public.source_company_snapshots (source_key, country_code, source_period, record_identity_key) WHERE source_period IS NOT NULL AND record_identity_key IS NOT NULL;',
  ],
  note: 'the unique index must name the key the unresolved owner question settles on; it cannot be authored before that answer exists',
  // 🔴 Kept VERBATIM as the Round-2 record. `authoredInThisRound` refers to Round 2 and stays
  // false: Round 2 genuinely did not author it. BR-SOURCE-FUNCTIONAL-CUT-A did, as migration 126,
  // and the statements it actually authored differ from the draft above in two ways that matter —
  // the unique index is keyed on `normalized_tax_id`, and it is paired with a CHECK that makes both
  // identity columns NOT NULL for Brazil, without which a partial index over nullable columns is
  // just YH-2 wearing a new name.
  supersededBy: 'BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION',
} as const;

// ─── Atomic replacement semantics (§ 12) ─────────────────────────────────────

/**
 * What happens when a new Receita month replaces the old one. DEFINED here as the identity contract
 * GATE-4 owns; the atomic publish MECHANISM stays GATE-8's deferred proof and the snapshot/runtime
 * engineering round's code. Nothing below is implemented in this round.
 */
export const BRAZIL_RECEITA_GATE4_REPLACEMENT_SEMANTICS = {
  currentSnapshot: 'the complete row set of the greatest source_period present for this source',
  previousSnapshot: 'the complete row set of the immediately preceding source_period',
  publicationPeriodIsTheUnitOfReplacement: true,
  supersession: 'a period is superseded as a whole, never row by row',
  crossMonthOverwritePermitted: false,
  partialMonthVisible: false,
  rollbackIdentity: 'the immediately preceding source_period row set, addressed by source_period',
  atomicPublishImplementedHere: false,
  atomicPublishOwner: 'GATE_8_DEFERRED_PROOF_AND_SNAPSHOT_RUNTIME_ROUND',
} as const;

// ─── BR-SOURCE-FUNCTIONAL-CUT-A — 4A's exception, exercised ──────────────────

/**
 * 🔴 The record of what FUNCTIONAL CUT A actually did with the exception 4A granted.
 *
 * Recorded separately from 4A/4B/4C, which are preserved verbatim, because it is a different kind
 * of statement. 4A granted a permission in principle and deliberately chose no storage encoding;
 * `BRAZIL_RECEITA_GATE4_APPROVAL_DOES_NOT` correctly says that approval did not author a migration
 * and did not change any field's disposition. Both remain true about that approval. This record is
 * the round that USED the permission, and it is the only place the narrowing lives.
 *
 * ── What was exercised ──────────────────────────────────────────────────────
 *
 * Exactly ONE persisted representation, in `source_company_snapshots.normalized_tax_id`: the
 * normalized establishment CNPJ, 14 CHARACTERS, validated by the canonical `normalizeBrazilCnpj`
 * DV validator. `tax_id` and `record_identity_key` stay TRANSIENT_ONLY and stay refused by the
 * guard below, and migration 126 makes both NULL-for-Brazil a CHECK constraint — so "exactly one"
 * is a schema fact, not a promise.
 *
 * 🔴 14 CHARACTERS, not 14 decimal digits. Alphanumeric CNPJs are official from July 2026
 * (positions 1-12 in [A-Z0-9], the 2-position DV numeric) and the first target period is 2026-07.
 * A decimal-only identity would reject valid establishments in the very first month it ran, so the
 * character set follows the canonical validator rather than a digits-only reading.
 *
 * ── What is still NOT authorized ────────────────────────────────────────────
 *
 * The exception covers STORAGE and internal LOOKUP. It does not make the identifier printable,
 * loggable, reportable or publicly projectable, and it authorizes no import, no Supabase write, no
 * runtime registration and no agent integration. The GATE-5 report projection stays unimplemented
 * and the engine report stays non-emittable.
 */
export const BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-A',
  exercisesGate4aException: true,
  exceptionOwnerReference: 'OWNER_REF_GATE4A_LEGAL_PRIVACY_OWNER_RELAY_2026_08_24',
  /**
   * The single persisted representation, as an exact table.column.
   *
   * 🔴 AMENDED by BR-COMPACT-SNAPSHOT-PRODUCTIZATION. The owner moved the authorized LOCATION —
   * and only the location — onto Brazil's dedicated table; see
   * `BRAZIL_RECEITA_GATE4A_LOCATION_AMENDMENT`. The pre-amendment value is kept alongside rather
   * than erased, because migration 126's Brazil constraints on `source_company_snapshots` still
   * exist in Production: what changed is that no Brazil row is written there any more, so that
   * column is no longer where the one representation lives.
   *
   * The COUNT is untouched. It was one, it is one, and the new table has nowhere to put a second.
   */
  persistedIdentityColumn: 'br_receita_snapshots.normalized_tax_id',
  persistedIdentityColumnBeforeAmendment: 'source_company_snapshots.normalized_tax_id',
  persistedIdentityColumnAmendedBy: 'BRAZIL_RECEITA_GATE4A_LOCATION_AMENDMENT',
  identityRepresentation: 'normalized 14-character establishment CNPJ',
  identityRepresentationCount: 1,
  /** Character set of the identity — alphanumeric-aware, never digits-only. */
  identityCharacterSet: 'positions 1-12 [A-Z0-9], positions 13-14 (DV) [0-9]',
  identityLength: BR_CNPJ_LENGTH,
  /** Columns that stay refused, so the count above cannot quietly become two. */
  refusedIdentityColumns: ['tax_id', 'record_identity_key'] as readonly string[],
  periodColumn: 'source_company_snapshots.source_period',
  periodGrain: 'YYYY-MM',
  periodAwareUniqueIndex: 'source_company_snapshots_br_period_identity_uidx',
  /**
   * 🔴 Renamed by BR-SOURCE CUT A.1: non-Brazil uniqueness moved off `normalized_tax_id` entirely
   * onto the generic `record_identity_key` grain (Production had already made this move outside
   * the migration ledger). This is no longer a Brazil-adjacent index name — it is the constraint
   * that PROTECTS every non-Brazil row FROM ever being confused with Brazil's.
   */
  nonBrazilUniqueIndex: 'source_company_snapshots_cn1_record_identity_key',
  nullUniquenessHazardClosed: true,
  /** 🔴 Renamed from 125 to 126 by BR-SOURCE CUT A.1 to make room for the generic reconciliation
   * migration; the SQL body this cut authored is unchanged. */
  migrationFile: '126_br_receita_monthly_snapshot_identity.sql',
  migrationAuthored: true,
  /** 🔴 Authored is not applied. CUT A applies nothing, anywhere. */
  migrationApplied: false,
  /**
   * 🔴 The read-path gap CUT B must close, recorded here so CUT B does not rediscover it late.
   *
   * The five existing lookup primitives in `snapshot-read/` all filter on `source_year`, not
   * `source_period`. For Brazil two months share a year, so a year-scoped read of one fiscal
   * identity legitimately sees TWO rows and would report a cardinality violation. CUT A therefore
   * does NOT register this source in `SOURCE_FAMILY_BY_SOURCE_KEY` — the registry keeps throwing,
   * which is the correct fail-closed answer until a period-aware primitive exists.
   */
  periodAwareReadPrimitiveRequired: true,
  registeredInSourceFamilyRegistry: false,
  /** Bounds. Storage and internal lookup only. */
  authorizesPrinting: false,
  authorizesLogging: false,
  authorizesReporting: false,
  authorizesPublicProjection: false,
  authorizesImport: false,
  authorizesSupabaseWrite: false,
  authorizesRuntimeRegistration: false,
  authorizesAgentIntegration: false,
  recordedDate: '2026-08-24',
} as const;

// ─── The executable guard ─────────────────────────────────────────────────────

/**
 * The fields whose persistence is refused. Derived, so it cannot drift from the table above.
 *
 * 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — this is now TWO fields, not three. `normalized_tax_id` became
 * PERSISTED when 4A's exception was exercised. It is derived rather than listed precisely so that
 * flipping a disposition and forgetting the guard is impossible.
 */
export const BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS: readonly string[] =
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.filter(
    (entry) => entry.persistence === 'TRANSIENT_ONLY',
  ).map((entry) => entry.field);

/** The single field 4A's exception permits, derived from the same table for the same reason. */
export const BRAZIL_RECEITA_GATE4_PERSISTED_IDENTITY_FIELDS: readonly string[] =
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.filter(
    (entry) => entry.persistence === 'PERSISTED',
  ).map((entry) => entry.field);

export type BrazilReceitaGate4PersistabilityViolation = {
  readonly field: string;
  readonly violation:
    | 'transient_only_field_present'
    | 'prohibited_identity_namespace'
    // BR-SOURCE-FUNCTIONAL-CUT-A — the guard no longer only refuses. It also REQUIRES the identity
    // it permits, because a Brazil row with no exact identity is exactly the write the null
    // uniqueness hazard used to swallow.
    | 'persisted_identity_missing'
    | 'persisted_identity_invalid'
    | 'source_period_missing_or_malformed';
};

/**
 * Raised when a caller tries to persist a row carrying prohibited identity material.
 *
 * A distinct error class rather than a bare `Error`: a future writer's failure mode should be
 * greppable and impossible to catch by accident alongside an ordinary parse failure.
 */
export class BrazilReceitaGate4NonPersistableRowError extends Error {
  readonly violations: readonly BrazilReceitaGate4PersistabilityViolation[];

  constructor(violations: readonly BrazilReceitaGate4PersistabilityViolation[]) {
    super(
      `BR Receita CNPJ: row is not persistable — ${violations
        .map((v) => `${v.field} (${v.violation})`)
        .join(', ')}. GATE-1 R4 forbids a second representation of the CNPJ, or any hash, truncation or fingerprint of it, anywhere; 4A permits exactly ONE, in normalized_tax_id, and a monthly row must also carry a valid source_period.`,
    );
    this.name = 'BrazilReceitaGate4NonPersistableRowError';
    this.violations = violations;
  }
}

/**
 * Reports every reason a row may not be persisted. PURE — no I/O, no mutation.
 *
 * 🔴 The namespace check is still the one that matters most. A future author could plausibly null
 * `tax_id`, leave `record_identity_key` as `tax:<14>`, and believe the row was clean — the
 * prohibited SECOND representation would then persist under a namespace that looks like a
 * transformation and is not. So the key is checked for the `tax:` namespace independently.
 *
 * 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — the guard gained a second job. It used to only REFUSE identity
 * material. Now that 4A's exception is exercised it must also REQUIRE the one representation it
 * permits, and require the period, because the failure mode has inverted: a Brazil row with a NULL
 * identity or a missing period is precisely the write that the vacuous `NULLS DISTINCT` uniqueness
 * used to accept without limit. Refusing too much and requiring nothing would have replaced one
 * silent duplication with another.
 *
 * Both required values are validated with the canonical primitives — `validateBrazilCnpj` (DV
 * check, alphanumeric-aware) and `isValidSourcePeriod` — never with a local regex.
 */
export function findBrazilReceitaSnapshotRowPersistabilityViolations(
  row: Pick<
    BrReceitaCnpjSnapshotRow,
    'tax_id' | 'normalized_tax_id' | 'record_identity_key' | 'source_period'
  >,
): readonly BrazilReceitaGate4PersistabilityViolation[] {
  const violations: BrazilReceitaGate4PersistabilityViolation[] = [];

  const present = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;

  // ── refused: the second representations ───────────────────────────────────
  if (present(row.tax_id)) {
    violations.push({ field: 'tax_id', violation: 'transient_only_field_present' });
  }

  const key = typeof row.record_identity_key === 'string' ? row.record_identity_key.trim() : '';
  if (key.length > 0) {
    // The `tax:` namespace is the prohibited identifier wearing a prefix, and it is checked on its
    // own so nulling the other field cannot make this one look clean.
    if (key.toLowerCase().startsWith('tax:')) {
      violations.push({
        field: 'record_identity_key',
        violation: 'prohibited_identity_namespace',
      });
    } else {
      violations.push({
        field: 'record_identity_key',
        violation: 'transient_only_field_present',
      });
    }
  }

  // ── required: the ONE permitted representation, and the period ────────────
  violations.push(...findBrazilReceitaPersistedIdentityViolations(row));

  return violations;
}

/**
 * The REQUIREMENT half of the guard, on its own: is there a valid identity and a valid period?
 *
 * 🔴 Separated from the refusal half because the two are needed at DIFFERENT boundaries, and
 * conflating them was a real bug worth naming. The parser's in-memory row legitimately carries all
 * three CNPJ representations, so:
 *
 *   · a writer handed a RAW row must be refused — that is
 *     `findBrazilReceitaSnapshotRowPersistabilityViolations`, refusal AND requirement;
 *   · the sanctioned projection (`toBrReceitaPersistedSnapshot`) DROPS the two refused fields, so
 *     refusing its input for carrying them would refuse every real row and make the projection
 *     unreachable. It needs the requirement half only.
 *
 * Composed, never duplicated: the function above delegates here, so there is one definition of
 * "the identity is present and valid".
 */
export function findBrazilReceitaPersistedIdentityViolations(
  identity: Pick<BrReceitaCnpjSnapshotRow, 'normalized_tax_id' | 'source_period'>,
): readonly BrazilReceitaGate4PersistabilityViolation[] {
  const violations: BrazilReceitaGate4PersistabilityViolation[] = [];

  const hasIdentity =
    typeof identity.normalized_tax_id === 'string' && identity.normalized_tax_id.trim().length > 0;

  if (!hasIdentity) {
    violations.push({ field: 'normalized_tax_id', violation: 'persisted_identity_missing' });
  } else if (normalizeBrazilCnpj(identity.normalized_tax_id).normalized !== identity.normalized_tax_id) {
    // 🔴 DV-valid is NOT sufficient — the value must ALREADY BE the normalized form.
    //
    // `validateBrazilCnpj` normalizes before it validates, so it accepts `11222333/0001-81`. This
    // column is the persisted identity and migration 126 constrains it to
    // `^[A-Z0-9]{12}[0-9]{2}$`, so accepting a punctuated or lower-case spelling here would mean
    // the guard passing a value the database then refuses — and, worse, two spellings of one
    // establishment being two different identities to the unique index.
    //
    // Comparing against the normalizer's OWN output makes "already normalized" exactly as strict as
    // the DDL, without a second regex to keep in sync. An unparseable value normalizes to `null`,
    // which is also unequal, so the same branch covers it.
    //
    // The violation names the FIELD and the KIND only: a guard that echoed the value it caught
    // would be the leak it exists to prevent.
    violations.push({ field: 'normalized_tax_id', violation: 'persisted_identity_invalid' });
  }

  if (!isValidSourcePeriod(identity.source_period)) {
    violations.push({
      field: 'source_period',
      violation: 'source_period_missing_or_malformed',
    });
  }

  return violations;
}

/** Fail-closed form of the requirement half. Used by the sanctioned projection. */
export function assertBrazilReceitaPersistedIdentityIsValid(
  identity: Pick<BrReceitaCnpjSnapshotRow, 'normalized_tax_id' | 'source_period'>,
): void {
  const violations = findBrazilReceitaPersistedIdentityViolations(identity);
  if (violations.length > 0) {
    throw new BrazilReceitaGate4NonPersistableRowError(violations);
  }
}

/**
 * Fails closed at any persistence boundary. There is no writer today; if one is ever built, this is
 * the call that refuses before a prohibited identifier reaches a database.
 *
 * It is deliberately unconditional — no flag, no override parameter, no "allow" argument. Relaxing
 * it takes a source edit, a PR and the owner decision that is currently missing, which is exactly
 * the ceremony this boundary deserves.
 */
export function assertBrazilReceitaSnapshotRowIsPersistable(
  row: Pick<
    BrReceitaCnpjSnapshotRow,
    'tax_id' | 'normalized_tax_id' | 'record_identity_key' | 'source_period'
  >,
): void {
  const violations = findBrazilReceitaSnapshotRowPersistabilityViolations(row);
  if (violations.length > 0) {
    throw new BrazilReceitaGate4NonPersistableRowError(violations);
  }
}

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this record carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE4_RESTRICTIONS: readonly string[] = [
  // 🔴 BR-SOURCE-FUNCTIONAL-CUT-A updated the four restrictions below that it legitimately
  // superseded by exercising 4A. Every other bound in this list is untouched, and the ones it
  // changed are changed by NARROWING, never by deletion: a migration now exists but is not
  // applied, and one identity column is now persistable while the other two stay refused.
  // 🔴 Renamed from 125 to 126 by BR-SOURCE CUT A.1 (production schema reconciliation): the string
  // below still names this cut's OWN migration file, which moved when a sibling generic
  // reconciliation migration was inserted as 125.
  'migration 126 is AUTHORED and is NOT APPLIED — no Supabase apply, no SQL editor, no remote SQL, no ledger write',
  'the DDL is now a migration artifact rather than recorded text, and applying it is a separate authorization',
  'no surrogate generator is implemented; a key nobody has implemented is a key that does not exist yet',
  'this source stays absent from SOURCE_FAMILY_BY_SOURCE_KEY, so the registry keeps throwing for it',
  'tax_id and record_identity_key stay TRANSIENT_ONLY and persisting them is refused; normalized_tax_id is the ONE persisted representation 4A authorized, and it is never printed, logged, reported or publicly projected',
  'exact runtime lookup is unblocked at the STORAGE boundary only — the existing read primitives are year-scoped, so a period-aware primitive is still required and belongs to CUT B',
  'fuzzy or name-based lookup is not an acceptable substitute for exact identity',
  'the atomic publish CONTRACT and the write PLAN are implemented and PURE; no executor exists, nothing is written, and the runtime reader that consumes a published period belongs to CUT B',
  'no persistence, import, Supabase write, runtime path, Agent 1 or Agent 2A integration',
  // BR-SOURCE-FAST-TRACK-7.
  'the report marker record_identity_grain_decision may now legitimately read option_d, but no emitter or projection reads it — none is implemented',
  'the 4A exception grants a permission in principle; it does not choose or implement a storage encoding',
  'the technical direction for the eventual encoding is project direction only, not a legal/privacy approval, and authorizes no persistence',
  'no operational flag is flipped by this approval',
] as const;
