/**
 * Apollo LinkedIn company URL preservation (Agent 1 · v1.16K-R)
 *
 * Cost-zero helper. Apollo's organization search (searchApolloOrganizations)
 * already returns `linkedin_url` in its payload, but the legacy normalization in
 * prospect-generation.ts dropped it. This module turns that already-paid-for URL
 * into the canonical `linkedin_enrichment` metadata shape used by the rest of the
 * pipeline (same shape the writer produces via buildLinkedInEnrichmentMetadata).
 *
 * No external calls. No invented data: when Apollo provides no usable company URL,
 * the helper returns null and the caller keeps its current behavior.
 */

import { normalizeLinkedInCompanyUrl } from './linkedin-company-enrichment';
import type { LinkedInEnrichmentMetadata } from './types';

/**
 * Confidence assigned to a LinkedIn company URL supplied directly by Apollo.
 * Apollo resolves the company entity itself, so the URL is high-trust, but we
 * keep it below a hand-verified 100 to reflect that we did not re-match it
 * against name/domain/country signals.
 */
export const APOLLO_LINKEDIN_CONFIDENCE = 80;

/**
 * Builds `linkedin_enrichment` metadata from an Apollo organization's
 * `linkedin_url`. Returns null (caller preserves current behavior) when:
 *   - the URL is missing / empty, or
 *   - it is not a usable LinkedIn *company* URL (person profiles, search pages,
 *     non-LinkedIn hosts, malformed URLs are all rejected by the normalizer).
 *
 * @param linkedinUrl Raw `linkedin_url` from the Apollo organization payload.
 * @param checkedAt   ISO timestamp to stamp on the enrichment record.
 */
export function buildApolloLinkedInEnrichment(
  linkedinUrl: string | null | undefined,
  checkedAt: string,
): LinkedInEnrichmentMetadata | null {
  const raw = typeof linkedinUrl === 'string' ? linkedinUrl.trim() : '';
  if (!raw) return null;

  const normalized = normalizeLinkedInCompanyUrl(raw);
  if (normalized.rejected || !normalized.normalized) {
    // Not a usable company URL — do NOT invent enrichment.
    return null;
  }

  return {
    enabled: true,
    status: 'found',
    company_url: normalized.normalized,
    normalized_company_slug: normalized.slug,
    confidence: APOLLO_LINKEDIN_CONFIDENCE,
    match_reason: 'apollo_provided_company_url',
    signals: null,
    warnings: [],
    source: 'apollo',
    checked_at: checkedAt,
  };
}
