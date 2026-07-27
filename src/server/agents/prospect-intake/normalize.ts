/**
 * Q3F-5BB.10B1 — Provider-agnostic normalization.
 *
 * `normalizeProviderDiscoveredCompany` turns a provider-mapped
 * `ProviderDiscoveredCompany` into the common `NormalizedProspectCandidate`.
 *
 * PURE: no I/O, no DB, no provider calls, no env, no fetch, no mutation of the
 * input. It reuses the battle-tested pure normalizers already in the toolkit
 * (name/domain/website) and the corporate-LinkedIn guard, so every provider
 * shares identical normalization semantics.
 *
 * NOT in scope: this does NOT gate/exclude candidates. It only ACCUMULATES
 * warnings/issues. The mandatory gate is the next slice (10B2).
 */

import {
  normalizeCompanyName,
  normalizeDomain,
  extractDomainFromWebsite,
} from '@/server/agents/prospecting-toolkit/normalization';
import { isLinkedInCompanyUrl } from '@/modules/prospect-batches/candidate-linkedin-url';

import type {
  IntakeIndustryCodes,
  IntakeNormalizationIssue,
  IntakeNormalizationWarning,
  NormalizedProspectCandidate,
  ProspectSearchCriteria,
  ProviderDiscoveredCompany,
} from './types';

/** Below this provider-reported confidence the candidate is flagged (soft). */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  // ISO-3166 alpha-2 only; anything else is passed through as-is uppercased so
  // downstream can decide. We do NOT invent a code from a country name here.
  return /^[A-Z]{2}$/.test(upper) ? upper : upper;
}

function normalizeEmployeeCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

/** Copy the provider industry codes without ever mutating the input arrays. */
function copyIndustryCodes(codes: IntakeIndustryCodes | undefined): IntakeIndustryCodes {
  if (!codes) return {};
  const out: IntakeIndustryCodes = {};
  if (Array.isArray(codes.naics)) out.naics = [...codes.naics];
  if (Array.isArray(codes.sic)) out.sic = [...codes.sic];
  if (Array.isArray(codes.providerIndustryIds)) {
    out.providerIndustryIds = [...codes.providerIndustryIds];
  }
  return out;
}

/**
 * Normalize a provider-discovered company into the common candidate shape.
 * Deterministic and pure — the same input always yields the same output.
 */
export function normalizeProviderDiscoveredCompany(
  discovered: ProviderDiscoveredCompany,
  criteria: ProspectSearchCriteria,
): NormalizedProspectCandidate {
  const warnings: IntakeNormalizationWarning[] = [];
  const issues: IntakeNormalizationIssue[] = [];

  // ── Names ────────────────────────────────────────────────────────────────
  const companyName = cleanString(discovered.companyName);
  const commercialName = cleanString(discovered.commercialName);
  const legalName = cleanString(discovered.legalName);
  const canonicalName = companyName ?? commercialName ?? legalName;
  const normalizedName = canonicalName ? normalizeCompanyName(canonicalName) || null : null;
  if (!normalizedName) issues.push('missing_name');

  // ── Domain / website (each derives the other when one is missing) ─────────
  const explicitDomain = normalizeDomain(cleanString(discovered.domain) ?? '');
  const websiteDerivedDomain = extractDomainFromWebsite(discovered.websiteUrl ?? undefined);
  const domain = explicitDomain ?? websiteDerivedDomain;
  if (!domain) warnings.push('missing_domain');

  const explicitWebsite = cleanString(discovered.websiteUrl);
  const websiteUrl = explicitWebsite ?? (domain ? `https://${domain}` : null);

  // ── Corporate LinkedIn (only /company/, never personal /in/) ──────────────
  const rawLinkedin = cleanString(discovered.linkedinUrl);
  const corporateLinkedinUrl = isLinkedInCompanyUrl(rawLinkedin) ? rawLinkedin : null;
  if (!corporateLinkedinUrl) warnings.push('missing_corporate_linkedin');

  // ── Geography ─────────────────────────────────────────────────────────────
  const countryCode = normalizeCountryCode(discovered.countryCode);
  const requestedCountryCode = normalizeCountryCode(criteria.countryCode);
  if (countryCode && requestedCountryCode && countryCode !== requestedCountryCode) {
    issues.push('country_mismatch');
  }

  // ── Employees ──────────────────────────────────────────────────────────────
  const employeeCount = normalizeEmployeeCount(discovered.employeeCount);
  if (employeeCount === null) {
    warnings.push('employee_count_unknown');
  } else if (
    typeof criteria.minEmployees === 'number' &&
    Number.isFinite(criteria.minEmployees) &&
    employeeCount < criteria.minEmployees
  ) {
    issues.push('known_employee_count_below_min');
  }

  // ── Provider confidence ────────────────────────────────────────────────────
  const sourceConfidence =
    typeof discovered.sourceConfidence === 'number' && Number.isFinite(discovered.sourceConfidence)
      ? discovered.sourceConfidence
      : null;
  if (sourceConfidence !== null && sourceConfidence < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push('low_provider_confidence');
  }

  return {
    sourceProvider: discovered.provider,
    providerRecordId: cleanString(discovered.providerRecordId),
    providerRequestId: cleanString(discovered.providerRequestId),

    canonicalName,
    normalizedName,
    commercialName,
    legalName,

    websiteUrl,
    domain,
    corporateLinkedinUrl,

    country: cleanString(discovered.country),
    countryCode,
    requestedCountryCode,
    region: cleanString(discovered.region),
    city: cleanString(discovered.city),

    industry: cleanString(discovered.industry),
    subindustry: cleanString(discovered.subindustry),
    industryCodes: copyIndustryCodes(discovered.industryCodes),

    employeeCount,
    employeeRange: cleanString(discovered.employeeRange),

    sourceUrl: cleanString(discovered.sourceUrl),
    sourceConfidence,

    // Fresh copy so callers can't mutate the caller-provided criteria object.
    searchCriteria: { ...criteria },

    warnings,
    issues,

    providerMetadataSafe: { ...(discovered.providerMetadataSafe ?? {}) },
    trace: {
      sourceProvider: discovered.provider,
      providerRecordId: cleanString(discovered.providerRecordId),
      providerRequestId: cleanString(discovered.providerRequestId),
      sourceUrl: cleanString(discovered.sourceUrl),
    },
  };
}
