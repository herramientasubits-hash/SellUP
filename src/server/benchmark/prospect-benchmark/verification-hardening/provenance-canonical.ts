/**
 * Verification Hardening — Canonical Provenance Schema (Hotfix 16AB.24.11)
 *
 * Enforces the canonical EvidenceUrlOrigin enum across all candidates.
 * Eliminates legacy non-canonical terms:
 *   confirmed_match, confirmed_normalized, auditable
 *
 * Those legacy terms may exist as validation STATUS values in other parts of
 * the pipeline, but they must NEVER be used as EvidenceUrlOrigin values.
 *
 * Migration rules:
 *   'confirmed_match'      → 'tool_result_url'  (only when URL is in search results)
 *   'confirmed_normalized' → 'tool_result_url'  (only when canonical variant is in results)
 *   'auditable'            → recalculate from results/citations → fallback 'unknown_origin'
 *   anything not in enum   → 'unknown_origin'
 *
 * ProvenanceReport: uniform output shape per candidate.
 */

import type { EvidenceUrlOrigin } from '../multistage/web-search-audit';
export type { EvidenceUrlOrigin };

// ─── URL provenance record ─────────────────────────────────────────────────────

export type UrlProvenance = {
  url: string | null;
  origin: EvidenceUrlOrigin;
  verifiedAt: string | null;
};

// ─── Canonical provenance report per candidate ────────────────────────────────

export type ProvenanceReport = {
  officialWebsite: UrlProvenance;
  linkedin: UrlProvenance;
  primaryEvidence: UrlProvenance;
  uniqueSearchResultUrls: number;
  uniqueCitationUrls: number;
  auditStatus: 'auditable' | 'partially_auditable' | 'not_auditable';
};

// ─── Canonical enum values ─────────────────────────────────────────────────────

const CANONICAL_ORIGINS = new Set<EvidenceUrlOrigin>([
  'tool_result_url',
  'citation_url',
  'tool_result_and_citation',
  'model_generated_url',
  'unknown_origin',
]);

export function isCanonicalOrigin(value: string): value is EvidenceUrlOrigin {
  return CANONICAL_ORIGINS.has(value as EvidenceUrlOrigin);
}

// ─── Legacy migration ──────────────────────────────────────────────────────────

export type LegacyMigrationContext = {
  searchResultUrls: string[];
  citationUrls: string[];
};

export function migrateProvenanceOrigin(
  legacyOrigin: string,
  url: string | null,
  context: LegacyMigrationContext
): EvidenceUrlOrigin {
  if (isCanonicalOrigin(legacyOrigin)) {
    return legacyOrigin;
  }

  const normalizeUrl = (u: string): string => {
    try {
      const parsed = new URL(u);
      return parsed.hostname.replace(/^www\./, '').toLowerCase() + parsed.pathname.replace(/\/$/, '');
    } catch {
      return u.toLowerCase();
    }
  };

  const urlNorm = url ? normalizeUrl(url) : null;
  const resultNorms = context.searchResultUrls.map(normalizeUrl);
  const citationNorms = context.citationUrls.map(normalizeUrl);

  const inResults = urlNorm ? resultNorms.some((r) => r === urlNorm || r.startsWith(urlNorm) || urlNorm.startsWith(r)) : false;
  const inCitations = urlNorm ? citationNorms.some((c) => c === urlNorm || c.startsWith(urlNorm) || urlNorm.startsWith(c)) : false;

  switch (legacyOrigin) {
    case 'confirmed_match':
      return inResults ? 'tool_result_url' : 'unknown_origin';

    case 'confirmed_normalized':
      return inResults ? 'tool_result_url' : 'unknown_origin';

    case 'auditable':
      if (inResults && inCitations) return 'tool_result_and_citation';
      if (inResults) return 'tool_result_url';
      if (inCitations) return 'citation_url';
      return 'unknown_origin';

    default:
      return 'unknown_origin';
  }
}

// ─── Audit status computation ─────────────────────────────────────────────────

export function computeAuditStatus(
  report: Pick<ProvenanceReport, 'officialWebsite' | 'linkedin' | 'primaryEvidence'>
): ProvenanceReport['auditStatus'] {
  const urls = [report.officialWebsite, report.linkedin, report.primaryEvidence];

  const auditable = (origin: EvidenceUrlOrigin): boolean =>
    origin === 'tool_result_url' || origin === 'tool_result_and_citation' || origin === 'citation_url';

  const auditableCount = urls.filter((u) => u.url && auditable(u.origin)).length;
  const modelGeneratedCount = urls.filter((u) => u.origin === 'model_generated_url').length;

  if (auditableCount === urls.filter((u) => u.url !== null).length && auditableCount > 0) {
    return 'auditable';
  }
  if (auditableCount > 0 || modelGeneratedCount < urls.length) {
    return 'partially_auditable';
  }
  return 'not_auditable';
}

// ─── LinkedIn normalization ────────────────────────────────────────────────────

export function normalizeLinkedInUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.replace(/\/$/, '').split('/');
    const companyIdx = parts.indexOf('company');
    if (companyIdx === -1 || !parts[companyIdx + 1]) return url;
    const slug = parts[companyIdx + 1];
    return `https://www.linkedin.com/company/${slug}`;
  } catch {
    return url;
  }
}

// ─── Report builder ────────────────────────────────────────────────────────────

export type ProvenanceReportInput = {
  officialWebsite: { url: string | null; origin: string };
  linkedin: { url: string | null; origin: string };
  primaryEvidence: { url: string | null; origin: string };
  searchResultUrls: string[];
  citationUrls: string[];
};

export function buildProvenanceReport(input: ProvenanceReportInput): ProvenanceReport {
  const ctx: LegacyMigrationContext = {
    searchResultUrls: input.searchResultUrls,
    citationUrls: input.citationUrls,
  };

  const officialWebsite: UrlProvenance = {
    url: input.officialWebsite.url,
    origin: migrateProvenanceOrigin(input.officialWebsite.origin, input.officialWebsite.url, ctx),
    verifiedAt: null,
  };

  const rawLinkedin = input.linkedin.url;
  const normalizedLinkedin = normalizeLinkedInUrl(rawLinkedin);
  const linkedinCtx: LegacyMigrationContext = {
    searchResultUrls: input.searchResultUrls.map((u) => normalizeLinkedInUrl(u) ?? u),
    citationUrls: input.citationUrls.map((u) => normalizeLinkedInUrl(u) ?? u),
  };
  const linkedin: UrlProvenance = {
    url: normalizedLinkedin,
    origin: migrateProvenanceOrigin(input.linkedin.origin, normalizedLinkedin, linkedinCtx),
    verifiedAt: null,
  };

  const primaryEvidence: UrlProvenance = {
    url: input.primaryEvidence.url,
    origin: migrateProvenanceOrigin(input.primaryEvidence.origin, input.primaryEvidence.url, ctx),
    verifiedAt: null,
  };

  const uniqueSearchResultUrls = new Set(input.searchResultUrls).size;
  const uniqueCitationUrls = new Set(input.citationUrls).size;

  const auditStatus = computeAuditStatus({ officialWebsite, linkedin, primaryEvidence });

  return {
    officialWebsite,
    linkedin,
    primaryEvidence,
    uniqueSearchResultUrls,
    uniqueCitationUrls,
    auditStatus,
  };
}
