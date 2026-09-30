/**
 * Agente 1 · Clasificador Claude — LinkedIn de la empresa, verificado (puro).
 *
 * Se acepta sólo si (a) el sitio oficial —que descargamos nosotros— enlaza a esa
 * página, o (b) la devolvió la búsqueda web de Claude Y el slug coincide con el
 * nombre de la empresa según el mismo evaluador que usa el resto de SellUp. Una URL que
 * Claude escribió sin fuente se descarta.
 */

import { evaluateLinkedInCompanyMatch, normalizeLinkedInCompanyUrl } from '../linkedin-company-enrichment';
import type { RejectedField, VerifiedLinkedInCompany } from './types';

export function verifyLinkedInCompany(params: {
  claimedUrl: string | null | undefined;
  /** Enlaces a linkedin.com/company del HTML oficial (ya normalizados). */
  officialSiteLinks: readonly string[];
  searchResultUrls: readonly string[];
  companyName: string;
  companyDomain: string | null;
  countryCode: string | null;
}): { linkedin: VerifiedLinkedInCompany | null; rejected: RejectedField | null } {
  const { officialSiteLinks } = params;

  const claimed = params.claimedUrl ? normalizeLinkedInCompanyUrl(params.claimedUrl) : null;
  // Sin propuesta de Claude, pero el sitio oficial enlaza UNA sola página: es ésa (costo cero).
  if (!claimed || claimed.rejected || !claimed.normalized || !claimed.slug) {
    if (officialSiteLinks.length === 1) {
      const only = normalizeLinkedInCompanyUrl(officialSiteLinks[0]);
      if (!only.rejected && only.normalized && only.slug) {
        return { linkedin: { url: only.normalized, slug: only.slug, source: 'website_social_link' }, rejected: null };
      }
    }
    return {
      linkedin: null,
      rejected: params.claimedUrl ? { field: 'linkedin', reason: 'not_a_linkedin_company_page' } : null,
    };
  }

  if (officialSiteLinks.includes(claimed.normalized)) {
    return { linkedin: { url: claimed.normalized, slug: claimed.slug, source: 'website_social_link' }, rejected: null };
  }

  const inSearch = params.searchResultUrls.some((u) => normalizeLinkedInCompanyUrl(u).normalized === claimed.normalized);
  if (!inSearch) return { linkedin: null, rejected: { field: 'linkedin', reason: 'linkedin_url_without_source' } };

  const match = evaluateLinkedInCompanyMatch(
    { candidateName: params.companyName, candidateDomain: params.companyDomain, countryCode: params.countryCode },
    { url: claimed.normalized, normalized: claimed.normalized, slug: claimed.slug, foundIn: 'source_url' },
  );
  // El slug tiene que coincidir con el NOMBRE de la empresa (el evaluador deja
  // «ambiguous» cuando sólo hay nombre, sin título/snippet: eso basta aquí,
  // porque la URL además vino de la búsqueda y la empresa queda en revisión).
  if (match.status === 'rejected' || !match.signals.name_match) {
    return { linkedin: null, rejected: { field: 'linkedin', reason: 'linkedin_slug_name_mismatch' } };
  }
  return { linkedin: { url: claimed.normalized, slug: claimed.slug, source: 'provided_search_result' }, rejected: null };
}
