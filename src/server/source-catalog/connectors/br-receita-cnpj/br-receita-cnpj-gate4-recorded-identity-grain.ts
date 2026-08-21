/**
 * BR Receita CNPJ — RECORDED GATE-4 identity grain decision (BR-SOURCE-GATE-ROUND-2).
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

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * GATE-4's status after this round. `needs_owner_decision` rather than `needs_evidence`: the
 * evidence is complete — all four options evaluated, consequences stated, the collision named — and
 * what is missing is a decision, from a named owner, on one question.
 */
export const BRAZIL_RECEITA_GATE4_STATUS = 'needs_owner_decision' as const;

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
  grain: 'decided',
  deduplicationConsequence: 'decided',
  publicationPeriodModel: 'decided',
  replacementSemantics: 'decided',
  identityFieldPersistenceClassification: 'decided',
  persistedRecordIdentityConstruction: 'blocked_on_owner_decision',
  runtimeExactLookupMechanism: 'blocked_on_owner_decision',
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
    persistence: 'TRANSIENT_ONLY',
    owner: 'GATE_1_R4_LEGAL_PRIVACY',
    reason:
      'the normalized full CNPJ. Same R4 prohibition, and GATE-3 names "normalized_tax_id snapshot survival" explicitly. Kept in memory; refused at any persistence boundary.',
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
 * 🔴 It is a LEGAL/PRIVACY question, so this round does not answer it, does not recommend an answer,
 * and does not attribute an answer to anyone. `askedOf` names the role; `answeredBy` is null and
 * stays null until a human decision is relayed and recorded in the § 14 shape.
 */
export const BRAZIL_RECEITA_GATE4_SINGLE_UNRESOLVED_QUESTION = {
  question:
    'Does the legal/privacy owner authorize exactly ONE persisted, never-printed, never-logged, never-reported representation of the establishment CNPJ inside source_company_snapshots, to serve as the row exact-lookup key, as a narrow enumerated exception to GATE-1 R4 — or not?',
  askedOf: 'LEGAL_PRIVACY_OWNER',
  answeredBy: null,
  ifYes:
    'GATE-4 can be approved with a deterministic key, the existing lookup primitives work unchanged, and the exception must be recorded with its own enumerated bounds',
  ifNo:
    'Brazil cannot support exact runtime lookup at all; the productization path stops at GATE-4, and any Brazil snapshot would be write-only data no consumer can address',
  agentMayAnswer: false,
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
  identityDimensionsRequired: ['source_key', 'country_code', 'source_period', 'record_identity_key'],
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

// ─── The executable guard ─────────────────────────────────────────────────────

/** The three fields whose persistence is refused. Derived, so it cannot drift from the table above. */
export const BRAZIL_RECEITA_GATE4_NON_PERSISTABLE_FIELDS: readonly string[] =
  BRAZIL_RECEITA_GATE4_IDENTITY_FIELD_DISPOSITIONS.filter(
    (entry) => entry.persistence === 'TRANSIENT_ONLY',
  ).map((entry) => entry.field);

export type BrazilReceitaGate4PersistabilityViolation = {
  readonly field: string;
  readonly violation: 'transient_only_field_present' | 'prohibited_identity_namespace';
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
        .join(', ')}. GATE-1 R4 forbids persisting the full CNPJ, the básico, or any hash, truncation or fingerprint of either; GATE-4 has not recorded an approved persisted identity.`,
    );
    this.name = 'BrazilReceitaGate4NonPersistableRowError';
    this.violations = violations;
  }
}

/**
 * Reports every reason a row may not be persisted. PURE — no I/O, no mutation.
 *
 * 🔴 The namespace check is the one that matters. A future author could plausibly null `tax_id` and
 * `normalized_tax_id`, leave `record_identity_key` as `tax:<14>`, and believe the row was clean —
 * the prohibited identifier would then persist under a namespace that looks like a transformation
 * and is not. So the key is checked for the `tax:` namespace independently of the other two fields.
 */
export function findBrazilReceitaSnapshotRowPersistabilityViolations(
  row: Pick<BrReceitaCnpjSnapshotRow, 'tax_id' | 'normalized_tax_id' | 'record_identity_key'>,
): readonly BrazilReceitaGate4PersistabilityViolation[] {
  const violations: BrazilReceitaGate4PersistabilityViolation[] = [];

  const present = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;

  if (present(row.tax_id)) {
    violations.push({ field: 'tax_id', violation: 'transient_only_field_present' });
  }
  if (present(row.normalized_tax_id)) {
    violations.push({ field: 'normalized_tax_id', violation: 'transient_only_field_present' });
  }

  const key = typeof row.record_identity_key === 'string' ? row.record_identity_key.trim() : '';
  if (key.length > 0) {
    // The `tax:` namespace is the prohibited identifier wearing a prefix, and it is checked on its
    // own so nulling the other two fields cannot make this one look clean.
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

  return violations;
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
  row: Pick<BrReceitaCnpjSnapshotRow, 'tax_id' | 'normalized_tax_id' | 'record_identity_key'>,
): void {
  const violations = findBrazilReceitaSnapshotRowPersistabilityViolations(row);
  if (violations.length > 0) {
    throw new BrazilReceitaGate4NonPersistableRowError(violations);
  }
}

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this record carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE4_RESTRICTIONS: readonly string[] = [
  'this record approves no gate',
  'the report marker record_identity_grain_decision stays not_decided until GATE-4 is approved',
  'no migration is created, edited or applied, and no index and no physical schema is changed',
  'the required future DDL is recorded as text and is not authorized',
  'no surrogate generator is implemented; a key nobody approved is a key nobody may build',
  'this source stays absent from SOURCE_FAMILY_BY_SOURCE_KEY, so the registry keeps throwing for it',
  'tax_id, normalized_tax_id and record_identity_key stay TRANSIENT_ONLY and persisting them is refused',
  'the single unresolved question is legal/privacy and no agent may answer it',
  'exact runtime lookup is a recorded PRODUCTIZATION BLOCKER, not a solved problem',
  'fuzzy or name-based lookup is not an acceptable substitute for exact identity',
  'atomic publish is defined as identity semantics only and is not implemented',
  'no persistence, import, Supabase write, runtime path, Agent 1 or Agent 2A integration',
  'GATE-3 and GATE-5 remain separate, and GATE-5 remains not_started and unaffected',
] as const;
