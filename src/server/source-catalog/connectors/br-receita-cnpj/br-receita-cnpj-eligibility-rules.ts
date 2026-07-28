/**
 * BR Receita CNPJ — eligibility & legal-nature calibration rules (BR-SOURCE-10F).
 *
 * A PURE, dependency-injected rule layer that formalizes the docs § 3–§ 8 / § 11
 * eligibility contract consumed by the privacy-safe classifier. It NEVER reads a
 * file, opens a client, holds a value, or authorizes anything — it maps a
 * STRUCTURAL fact (file family) and an ALREADY-EXTRACTED legal-nature code to a
 * conservative risk class plus the positive-company signals a future import would
 * look for. No personal value is ever an input or an output; the caller passes a
 * bare legal-nature CODE and gets back a machine risk class.
 *
 * ── Conservative-by-construction (fail-closed) ─────────────────────────────────
 *   - NO default eligible-natureza allowlist ships here. docs § 11 (open question
 *     #2) leaves the eligible-commercial allowlist UNDECIDED, so membership of the
 *     eligible / risky / MEI sets is INJECTED by a caller (a synthetic test, or a
 *     future legal GO) — never hardcoded. With no policy, every company legal
 *     nature falls to `needs_legal_review`; the runtime runner injects no policy.
 *   - Exclusions are FLOORS, not ceilings (docs § 3): a policy may WIDEN the block
 *     sets, never narrow them. Widening a block set can only make MORE records
 *     ineligible, so it needs no legal GO; adding to the eligible allowlist does.
 *   - "Reduce `needs_legal_review` when safe" is achieved STRUCTURALLY, not by
 *     relaxing legal nature: reference lookups are not company candidates at all
 *     (`not_applicable_lookup`), and establishments in isolation are a data-join
 *     hold (`establishment_requires_join_context`) — neither is a legal question,
 *     so routing them out of `needs_legal_review` authorizes no import.
 *
 * This module authorizes NO import, NO Supabase write, NO runtime, NO Agent 1, and
 * NO live prospect generation. It is signal/classification logic only.
 */

// ─── File families (single source of truth; reused by the classifier) ──────────

/** Company-grain families whose rows are candidate company records. */
export const BR_RECEITA_COMPANY_FAMILIES: ReadonlySet<string> = new Set([
  'empresas',
  'estabelecimentos',
]);

/** Reference / regime families — catalog rows, never a company candidate. */
export const BR_RECEITA_REFERENCE_FAMILIES: ReadonlySet<string> = new Set([
  'simples',
  'cnaes',
  'municipios',
  'naturezas',
]);

/** True when a file type is a company-grain family (empresas / estabelecimentos). */
export function isCompanyFamily(fileType: string): boolean {
  return BR_RECEITA_COMPANY_FAMILIES.has(fileType);
}

/** True when a file type is a reference/regime lookup (cnaes / municipios / …). */
export function isReferenceLookupFamily(fileType: string): boolean {
  return BR_RECEITA_REFERENCE_FAMILIES.has(fileType);
}

// ─── Legal-nature risk classes (conceptual buckets, docs § 4 / § 7 / § 8) ──────

/**
 * The conservative risk class a legal nature resolves to. A determination is only
 * made where a legal nature is meaningful (an `empresas` row) or where a row is a
 * reference lookup; `blocked_*` widen the exclusion floor, `allowed_*` requires an
 * injected legal GO, and everything else is held for review.
 */
export type BrReceitaLegalNatureRiskClass =
  | 'allowed_commercial_organization'
  | 'blocked_person_or_individual'
  | 'blocked_risky_or_unsupported'
  | 'needs_legal_review'
  | 'not_applicable_lookup';

export const BR_RECEITA_LEGAL_NATURE_RISK_CLASSES: readonly BrReceitaLegalNatureRiskClass[] = [
  'allowed_commercial_organization',
  'blocked_person_or_individual',
  'blocked_risky_or_unsupported',
  'needs_legal_review',
  'not_applicable_lookup',
];

/**
 * Positive signals that a record is an organization a future import would keep.
 * These are structural booleans (presence / classification), never a value.
 */
export type BrReceitaPositiveCompanySignal =
  | 'commercial_legal_nature'
  | 'company_name_present'
  | 'establishment_requires_join_context';

export const BR_RECEITA_POSITIVE_COMPANY_SIGNALS: readonly BrReceitaPositiveCompanySignal[] = [
  'commercial_legal_nature',
  'company_name_present',
  'establishment_requires_join_context',
];

// ─── Injected legal-nature policy (UNSET by default = fail-closed) ─────────────

/**
 * Optional legal-nature code membership. When ABSENT (the default, and what the
 * runner uses) NO code is eligible and NO code is blocked-by-nature — every
 * company legal nature resolves to `needs_legal_review`. A caller may inject sets
 * (a test, or a future legal GO). Membership is CONSERVATIVE and EXPANDABLE ONLY
 * with an explicit legal/privacy approval; this module never hardcodes a set.
 */
export interface BrReceitaCnpjLegalNaturePolicy {
  /** natureza jurídica codes affirmatively on the eligible-commercial allowlist. */
  readonly eligibleLegalNatureCodes?: ReadonlySet<string>;
  /** natureza jurídica codes that are risky / unsupported / out of scope. */
  readonly riskyLegalNatureCodes?: ReadonlySet<string>;
  /** natureza jurídica codes flagged as MEI / empresário individual (person-risk). */
  readonly meiIndividualLegalNatureCodes?: ReadonlySet<string>;
}

// ─── Aggregate count shapes ────────────────────────────────────────────────────

export type BrReceitaLegalNatureClassificationCounts = Record<
  BrReceitaLegalNatureRiskClass,
  number
>;
export type BrReceitaPositiveCompanySignalCounts = Record<BrReceitaPositiveCompanySignal, number>;

export function emptyLegalNatureClassificationCounts(): BrReceitaLegalNatureClassificationCounts {
  const counts = {} as BrReceitaLegalNatureClassificationCounts;
  for (const riskClass of BR_RECEITA_LEGAL_NATURE_RISK_CLASSES) counts[riskClass] = 0;
  return counts;
}

export function emptyPositiveCompanySignalCounts(): BrReceitaPositiveCompanySignalCounts {
  const counts = {} as BrReceitaPositiveCompanySignalCounts;
  for (const signal of BR_RECEITA_POSITIVE_COMPANY_SIGNALS) counts[signal] = 0;
  return counts;
}

// ─── Core rule ─────────────────────────────────────────────────────────────────

/**
 * Classifies an already-extracted legal-nature CODE into a conservative risk
 * class, given an optional injected policy. Fail-closed and most-restrictive
 * first: a risky code outranks a MEI/individual code, which outranks an eligible
 * code; with no positive allowlist match the nature is HELD for an explicit legal
 * GO (`needs_legal_review`). Never inspects, retains, or returns a value — only the
 * code is read, and only a machine risk class is returned.
 */
export function classifyLegalNatureRiskClass(
  legalNatureCode: string,
  policy: BrReceitaCnpjLegalNaturePolicy | undefined,
): BrReceitaLegalNatureRiskClass {
  const code = legalNatureCode.trim();
  if (policy?.riskyLegalNatureCodes?.has(code)) return 'blocked_risky_or_unsupported';
  if (policy?.meiIndividualLegalNatureCodes?.has(code)) return 'blocked_person_or_individual';
  if (policy?.eligibleLegalNatureCodes?.has(code)) return 'allowed_commercial_organization';
  // Unlisted / unknown nature, or no policy at all → held (docs § 11 open #2).
  return 'needs_legal_review';
}
