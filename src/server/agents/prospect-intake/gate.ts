/**
 * Q3F-5BB.10B2 — Shared provider-agnostic mandatory gate.
 *
 * `evaluateProspectIntakeGate` takes a `NormalizedProspectCandidate` (the common
 * shape every provider maps into via `normalizeProviderDiscoveredCompany`) and
 * decides whether it is:
 *   - hard_excluded            → fails a mandatory minimum, must NOT reach review;
 *   - reviewable_with_warnings → passes minimums but a human should look closer;
 *   - reviewable_clean         → passes minimums with no relevant warnings.
 *
 * PURE: no I/O, no DB, no provider calls, no env, no fetch, no mutation of the
 * inputs. The same candidate + criteria + policy always yields the same result.
 *
 * SCOPE (this slice ONLY): the pure gate function + its result/policy types +
 * a bounded audit-entry helper. This is NOT wired into the live Agent 1 pipeline
 * (Lusha / Apollo / Tavily runtime, writers, duplicate checker, source catalog,
 * approval, UI). Wiring is a later slice.
 *
 * Policy decisions implemented by default (confirmed for 10B2):
 *   D1 missing corporate LinkedIn → soft warning, never a hard exclude.
 *   D2 unknown employee_count     → soft warning, never a hard exclude.
 *   D3 country without a source catalog → non-blocking warning (dormant here;
 *      surfaced only if the normalizer already flagged it).
 *   D4 tax-keyed-only sources are not blocked at discovery.
 * Hard minimums: usable name, usable domain, requested-country match, and a
 * KNOWN employee count that is >= the requested minimum.
 */

import type {
  NormalizedProspectCandidate,
  ProspectIntakeProvider,
  ProspectSearchCriteria,
} from './types';

// ============================================================
// Gate result / policy types
// ============================================================

/** The three mutually-exclusive outcomes of the mandatory gate. */
export type ProspectIntakeGateDecision =
  | 'hard_excluded'
  | 'reviewable_with_warnings'
  | 'reviewable_clean';

/**
 * Every reason the gate can attach to a decision. `hard` reasons drive
 * exclusion; `warning` reasons drive human review. A single reason is always
 * one severity (see `GATE_REASON_SEVERITY`).
 */
export type ProspectIntakeGateReason =
  | 'missing_name'
  | 'missing_domain'
  | 'country_mismatch'
  | 'known_employee_count_below_min'
  | 'obviously_wrong_sector'
  | 'employee_count_unknown'
  | 'missing_corporate_linkedin'
  | 'ambiguous_sector'
  | 'low_provider_confidence'
  | 'source_catalog_unavailable'
  | 'unsupported_country';

export type ProspectIntakeGateSeverity = 'hard' | 'warning';

/**
 * Configurable minimums. Every field has a safe, conservative default (see
 * `DEFAULT_PROSPECT_INTAKE_GATE_POLICY`). Callers override only what they need.
 */
export interface ProspectIntakeGatePolicy {
  requireName: boolean;
  requireDomain: boolean;
  requireCountryMatch: boolean;
  requireKnownEmployeeAboveMin: boolean;
  allowUnknownEmployeeCountWithWarning: boolean;
  requireCorporateLinkedin: boolean;
  allowMissingLinkedinWithWarning: boolean;
  hardExcludeObviousSectorMismatch: boolean;
  allowAmbiguousSectorWithWarning: boolean;
}

/** Bounded, side-effect-free snapshot of what the gate saw. Never a raw payload. */
export interface ProspectIntakeGateAudit {
  provider: ProspectIntakeProvider;
  canonicalName: string | null;
  domain: string | null;
  countryCode: string | null;
  employeeCount: number | null;
  corporateLinkedinPresent: boolean;
  requestedCountryCode: string | null;
  minEmployees: number | null;
}

export interface ProspectIntakeGateResult {
  decision: ProspectIntakeGateDecision;
  hardReasons: ProspectIntakeGateReason[];
  warnings: ProspectIntakeGateReason[];
  reviewFlags: string[];
  summary: {
    hardExcluded: boolean;
    requiresHumanReview: boolean;
    cleanForReview: boolean;
  };
  audit: ProspectIntakeGateAudit;
}

// ============================================================
// Defaults + reason metadata
// ============================================================

/**
 * Conservative default policy. Mirrors the confirmed 10B2 decisions: only the
 * true minimums are hard; LinkedIn and unknown employee count stay soft.
 */
export const DEFAULT_PROSPECT_INTAKE_GATE_POLICY: ProspectIntakeGatePolicy = {
  requireName: true,
  requireDomain: true,
  requireCountryMatch: true,
  requireKnownEmployeeAboveMin: true,
  allowUnknownEmployeeCountWithWarning: true,
  requireCorporateLinkedin: false,
  allowMissingLinkedinWithWarning: true,
  hardExcludeObviousSectorMismatch: true,
  allowAmbiguousSectorWithWarning: true,
};

/** Canonical severity of each reason when it is emitted as a hard exclusion. */
const HARD_REASONS: ReadonlySet<ProspectIntakeGateReason> = new Set([
  'missing_name',
  'missing_domain',
  'country_mismatch',
  'known_employee_count_below_min',
  'obviously_wrong_sector',
]);

// ============================================================
// Helpers (pure)
// ============================================================

function pushUnique(list: ProspectIntakeGateReason[], reason: ProspectIntakeGateReason): void {
  if (!list.includes(reason)) list.push(reason);
}

function hasUsableName(candidate: NormalizedProspectCandidate): boolean {
  return Boolean(candidate.canonicalName && candidate.normalizedName);
}

function resolveMinEmployees(
  candidate: NormalizedProspectCandidate,
  criteria: ProspectSearchCriteria,
): number | null {
  const fromCriteria = criteria.minEmployees;
  const fromCandidate = candidate.searchCriteria?.minEmployees;
  const value =
    typeof fromCriteria === 'number' && Number.isFinite(fromCriteria)
      ? fromCriteria
      : typeof fromCandidate === 'number' && Number.isFinite(fromCandidate)
        ? fromCandidate
        : null;
  return value;
}

// ============================================================
// Main gate
// ============================================================

/**
 * Evaluate the mandatory gate for a normalized candidate. Reads the candidate's
 * own fields plus the normalizer's already-computed `warnings`/`issues`; never
 * mutates anything, never touches I/O.
 */
export function evaluateProspectIntakeGate(
  candidate: NormalizedProspectCandidate,
  criteria: ProspectSearchCriteria,
  policy: Partial<ProspectIntakeGatePolicy> = {},
): ProspectIntakeGateResult {
  const effective: ProspectIntakeGatePolicy = {
    ...DEFAULT_PROSPECT_INTAKE_GATE_POLICY,
    ...policy,
  };

  const hardReasons: ProspectIntakeGateReason[] = [];
  const warnings: ProspectIntakeGateReason[] = [];

  const minEmployees = resolveMinEmployees(candidate, criteria);

  // ── 1. Name (hard) ─────────────────────────────────────────────────────────
  if (effective.requireName && !hasUsableName(candidate)) {
    pushUnique(hardReasons, 'missing_name');
  }

  // ── 2. Domain (hard) ────────────────────────────────────────────────────────
  if (effective.requireDomain && !candidate.domain) {
    pushUnique(hardReasons, 'missing_domain');
  }

  // ── 3. Country ──────────────────────────────────────────────────────────────
  // A confirmed mismatch is hard. A requested country the provider could not
  // confirm (candidate country missing) is soft — we surface it but never block.
  const requestedCountry = candidate.requestedCountryCode ?? criteria.countryCode ?? null;
  if (effective.requireCountryMatch) {
    const confirmedMismatch =
      Boolean(requestedCountry) &&
      Boolean(candidate.countryCode) &&
      candidate.countryCode !== requestedCountry;
    if (confirmedMismatch || candidate.issues.includes('country_mismatch')) {
      pushUnique(hardReasons, 'country_mismatch');
    } else if (Boolean(requestedCountry) && !candidate.countryCode) {
      // Requested a country the provider did not return — cannot confirm the
      // jurisdiction is supported. Soft only (D3).
      pushUnique(warnings, 'unsupported_country');
    }
  }
  if (candidate.issues.includes('unsupported_country')) {
    pushUnique(warnings, 'unsupported_country');
  }

  // ── 4. Employees ─────────────────────────────────────────────────────────────
  if (candidate.employeeCount === null) {
    // Unknown headcount is never a hard exclude while the allowance holds (D2).
    if (
      effective.requireKnownEmployeeAboveMin &&
      minEmployees !== null &&
      !effective.allowUnknownEmployeeCountWithWarning
    ) {
      pushUnique(hardReasons, 'known_employee_count_below_min');
    } else {
      pushUnique(warnings, 'employee_count_unknown');
    }
  } else if (
    effective.requireKnownEmployeeAboveMin &&
    minEmployees !== null &&
    candidate.employeeCount < minEmployees
  ) {
    pushUnique(hardReasons, 'known_employee_count_below_min');
  }

  // ── 5. Corporate LinkedIn ────────────────────────────────────────────────────
  if (!candidate.corporateLinkedinUrl) {
    if (effective.requireCorporateLinkedin) {
      pushUnique(hardReasons, 'missing_corporate_linkedin');
    } else if (effective.allowMissingLinkedinWithWarning) {
      pushUnique(warnings, 'missing_corporate_linkedin');
    }
  }

  // ── 6. Sector ────────────────────────────────────────────────────────────────
  // No fuzzy sector matching in this slice — only trust signals the normalizer
  // already produced. `obviously_wrong_sector` is not emitted by the current
  // normalizer; the hard path stays dormant until a future slice adds it.
  // TODO(10C+): add sector classification that can emit `obviously_wrong_sector`.
  if (
    effective.hardExcludeObviousSectorMismatch &&
    candidate.issues.includes('obviously_wrong_sector' as never)
  ) {
    pushUnique(hardReasons, 'obviously_wrong_sector');
  } else if (
    effective.allowAmbiguousSectorWithWarning &&
    (candidate.warnings.includes('ambiguous_sector') ||
      candidate.warnings.includes('sector_pending_review'))
  ) {
    pushUnique(warnings, 'ambiguous_sector');
  }

  // ── 7. Pass-through soft signals from the normalizer ─────────────────────────
  if (candidate.warnings.includes('low_provider_confidence')) {
    pushUnique(warnings, 'low_provider_confidence');
  }
  if (candidate.warnings.includes('source_catalog_unavailable')) {
    pushUnique(warnings, 'source_catalog_unavailable');
  }

  // ── Decision ─────────────────────────────────────────────────────────────────
  const decision: ProspectIntakeGateDecision =
    hardReasons.length > 0
      ? 'hard_excluded'
      : warnings.length > 0
        ? 'reviewable_with_warnings'
        : 'reviewable_clean';

  return {
    decision,
    hardReasons,
    warnings,
    reviewFlags: [...warnings],
    summary: {
      hardExcluded: decision === 'hard_excluded',
      requiresHumanReview: decision === 'reviewable_with_warnings',
      cleanForReview: decision === 'reviewable_clean',
    },
    audit: {
      provider: candidate.sourceProvider,
      canonicalName: candidate.canonicalName,
      domain: candidate.domain,
      countryCode: candidate.countryCode,
      employeeCount: candidate.employeeCount,
      corporateLinkedinPresent: Boolean(candidate.corporateLinkedinUrl),
      requestedCountryCode: requestedCountry,
      minEmployees,
    },
  };
}

// ============================================================
// Audit-entry helper (bounded, safe for future batch metadata)
// ============================================================

/**
 * Build a bounded, PII-safe audit entry describing a gate outcome. Intended for
 * future batch-exclusion metadata — deliberately small: no raw payload, no full
 * `providerMetadataSafe`, no secrets.
 */
export function buildProspectIntakeGateAuditEntry(
  candidate: NormalizedProspectCandidate,
  gateResult: ProspectIntakeGateResult,
): {
  provider: ProspectIntakeProvider;
  decision: ProspectIntakeGateDecision;
  reason: ProspectIntakeGateReason | null;
  reasons: ProspectIntakeGateReason[];
  name: string | null;
  domain: string | null;
  employeeCount: number | null;
  countryCode: string | null;
  requestedCountryCode: string | null;
  hasCorporateLinkedin: boolean;
} {
  const reasons: ProspectIntakeGateReason[] = [
    ...gateResult.hardReasons,
    ...gateResult.warnings,
  ];
  return {
    provider: candidate.sourceProvider,
    decision: gateResult.decision,
    reason: gateResult.hardReasons[0] ?? gateResult.warnings[0] ?? null,
    reasons,
    name: candidate.canonicalName,
    domain: candidate.domain,
    employeeCount: candidate.employeeCount,
    countryCode: candidate.countryCode,
    requestedCountryCode: gateResult.audit.requestedCountryCode,
    hasCorporateLinkedin: Boolean(candidate.corporateLinkedinUrl),
  };
}

/** Exposed for tests + reviewer tooling: the fixed severity of each reason. */
export function getProspectIntakeGateReasonSeverity(
  reason: ProspectIntakeGateReason,
): ProspectIntakeGateSeverity {
  return HARD_REASONS.has(reason) ? 'hard' : 'warning';
}
