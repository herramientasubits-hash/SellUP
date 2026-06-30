/**
 * Helper para extraer la URL de LinkedIn corporativo de un candidato prospecto.
 *
 * Fallback order:
 *   1. metadata.linkedin_enrichment.company_url  (Tavily / Apollo enrichment v1.16K-R)
 *   2. metadata.rich_profile.company.linkedin_url (rich_profile builder)
 *
 * Solo acepta perfiles de empresa (/company/).
 * Rechaza /in/, /posts/, /jobs/, /school/, /showcase/.
 *
 * v1.16K-R-H: getCandidateLinkedInDisplay distingue found vs suggested (ambiguous).
 */

const LINKEDIN_COMPANY_RE = /linkedin\.com\/company\//i;
const LINKEDIN_INVALID_PATH_RE = /linkedin\.com\/(in|posts|jobs|school|showcase)\//i;

export function isLinkedInCompanyUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (LINKEDIN_INVALID_PATH_RE.test(url)) return false;
  return LINKEDIN_COMPANY_RE.test(url);
}

type CandidateMetadata = Record<string, unknown> | null | undefined;

export function getCandidateLinkedInUrl(metadata: CandidateMetadata): string | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const meta = metadata as Record<string, unknown>;

  // 1. metadata.linkedin_enrichment.company_url
  const linkedinEnrichment = meta.linkedin_enrichment as Record<string, unknown> | undefined;
  const companyUrl = linkedinEnrichment?.company_url;
  if (isLinkedInCompanyUrl(companyUrl)) return companyUrl as string;

  // 2. metadata.rich_profile.company.linkedin_url
  const richProfile = meta.rich_profile as Record<string, unknown> | undefined;
  const company = richProfile?.company as Record<string, unknown> | undefined;
  const rpUrl = company?.linkedin_url;
  if (isLinkedInCompanyUrl(rpUrl)) return rpUrl as string;

  return null;
}

// ─── v1.16K-R-H: Display helper ───────────────────────────────────────────────

export type LinkedInDisplayStatus = 'found' | 'suggested' | null;

export type LinkedInDisplayResult = {
  url: string;
  status: LinkedInDisplayStatus;
  label: string;
  reviewRequired: boolean;
} | null;

/**
 * Returns a display descriptor for the LinkedIn URL of a candidate, distinguishing
 * confirmed finds (status=found) from reviewable suggestions (status=ambiguous).
 *
 * Returns null when:
 *   - No valid company URL present.
 *   - ambiguous without a company_url.
 *   - URL is /in/, /posts/, or other non-company path.
 *   - status is not_found, rejected, or skipped.
 */
export function getCandidateLinkedInDisplay(metadata: CandidateMetadata): LinkedInDisplayResult {
  if (!metadata || typeof metadata !== 'object') return null;

  const meta = metadata as Record<string, unknown>;
  const linkedinEnrichment = meta.linkedin_enrichment as Record<string, unknown> | undefined;

  if (linkedinEnrichment) {
    const status = linkedinEnrichment.status as string | undefined;
    const companyUrl = linkedinEnrichment.company_url;

    if (status === 'found' && isLinkedInCompanyUrl(companyUrl)) {
      return {
        url: companyUrl as string,
        status: 'found',
        label: 'LinkedIn corporativo',
        reviewRequired: false,
      };
    }

    if (status === 'ambiguous' && isLinkedInCompanyUrl(companyUrl)) {
      return {
        url: companyUrl as string,
        status: 'suggested',
        label: 'LinkedIn sugerido, revisar antes de aprobar',
        reviewRequired: true,
      };
    }
  }

  // Fallback to rich_profile (always treated as found — came from trusted enrichment)
  const richProfile = meta.rich_profile as Record<string, unknown> | undefined;
  const company = richProfile?.company as Record<string, unknown> | undefined;
  const rpUrl = company?.linkedin_url;
  if (isLinkedInCompanyUrl(rpUrl)) {
    return {
      url: rpUrl as string,
      status: 'found',
      label: 'LinkedIn corporativo',
      reviewRequired: false,
    };
  }

  return null;
}
