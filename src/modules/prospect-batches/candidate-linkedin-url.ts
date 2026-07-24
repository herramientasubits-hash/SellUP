/**
 * Helper para extraer la URL de LinkedIn corporativo de un candidato prospecto.
 *
 * Fallback order (safe — solo lecturas de metadata, sin inventar URLs):
 *   1. metadata.linkedin_enrichment.company_url        (Tavily / Apollo enrichment v1.16K-R)
 *   2. metadata.rich_profile.company.linkedin_url       (rich_profile builder)
 *   3. metadata.enrichment.web.linkedin_company.url     (web enrichment)
 *   4. metadata.enrichment.linkedin_url
 *   5. metadata.enrichment.linkedin
 *   6. metadata.external.linkedin_url                   (import externo)
 *   7. metadata.import.linkedin_url                     (import externo)
 *   8. metadata.linkedin_url                            (Lusha company prospecting — Q3F-5BB.7D)
 *
 * Solo acepta perfiles de empresa (/company/).
 * Rechaza /in/, /posts/, /jobs/, /school/, /showcase/.
 *
 * v1.16K-R-H: getCandidateLinkedInDisplay distingue found vs suggested (ambiguous).
 * Q3F-5BB.7D: se añade fallback a metadata.linkedin_url (ruta plana escrita por el
 *   writer de Lusha) más las rutas de enrichment/import, sin romper el orden
 *   canónico ni el filtro /company/. Backward compatible.
 */

const LINKEDIN_COMPANY_RE = /linkedin\.com\/company\//i;
const LINKEDIN_INVALID_PATH_RE = /linkedin\.com\/(in|posts|jobs|school|showcase)\//i;

export function isLinkedInCompanyUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (LINKEDIN_INVALID_PATH_RE.test(url)) return false;
  return LINKEDIN_COMPANY_RE.test(url);
}

type CandidateMetadata = Record<string, unknown> | null | undefined;

/** Safely read a nested value from a metadata object without throwing. */
function readNested(meta: Record<string, unknown>, path: readonly string[]): unknown {
  let node: unknown = meta;
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * Ordered metadata paths (after the canonical linkedin_enrichment.company_url,
 * which the display helper treats specially). Kept in one place so the URL and
 * display helpers stay in sync.
 */
const LINKEDIN_FALLBACK_PATHS: readonly (readonly string[])[] = [
  ['rich_profile', 'company', 'linkedin_url'],
  ['enrichment', 'web', 'linkedin_company', 'url'],
  ['enrichment', 'linkedin_url'],
  ['enrichment', 'linkedin'],
  ['external', 'linkedin_url'],
  ['import', 'linkedin_url'],
  ['linkedin_url'],
];

export function getCandidateLinkedInUrl(metadata: CandidateMetadata): string | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const meta = metadata as Record<string, unknown>;

  // 1. Canonical: metadata.linkedin_enrichment.company_url
  const linkedinEnrichment = meta.linkedin_enrichment as Record<string, unknown> | undefined;
  const companyUrl = linkedinEnrichment?.company_url;
  if (isLinkedInCompanyUrl(companyUrl)) return companyUrl as string;

  // 2..8. Ordered fallbacks (rich_profile, enrichment, external/import, flat linkedin_url).
  for (const path of LINKEDIN_FALLBACK_PATHS) {
    const value = readNested(meta, path);
    if (isLinkedInCompanyUrl(value)) return value as string;
  }

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

  // Fallback to the ordered plain paths (rich_profile, enrichment, external/import,
  // flat metadata.linkedin_url). All are treated as `found` — they come from
  // trusted enrichment/import/provider data, never a low-confidence suggestion.
  for (const path of LINKEDIN_FALLBACK_PATHS) {
    const value = readNested(meta, path);
    if (isLinkedInCompanyUrl(value)) {
      return {
        url: value as string,
        status: 'found',
        label: 'LinkedIn corporativo',
        reviewRequired: false,
      };
    }
  }

  return null;
}
