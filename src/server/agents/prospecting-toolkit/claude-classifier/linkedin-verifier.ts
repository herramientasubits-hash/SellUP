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
  if (
    (match.status === 'rejected' || !match.signals.name_match) &&
    !slugIsDomainBrandWithCountry(claimed.slug, params.companyDomain)
  ) {
    return { linkedin: null, rejected: { field: 'linkedin', reason: 'linkedin_slug_name_mismatch' } };
  }
  return { linkedin: { url: claimed.normalized, slug: claimed.slug, source: 'provided_search_result' }, rejected: null };
}

/**
 * AGENT1-CLAUDE-LINKEDIN-FROM-EVIDENCE-1 — páginas de LinkedIn de empresa que
 * Claude usó como FUENTE de un dato (tamaño, sector), sin repetir.
 *
 * Prod 02-10 (lote 97c86cf7): el tamaño de Volcan salió de
 * linkedin.com/company/volcan-compañia-minera pero `linkedin_company_url` vino
 * vacío ⇒ la empresa no contaba para la meta sólo por el LinkedIn. Estas URLs son
 * CANDIDATAS: cada una pasa por `verifyLinkedInCompany` con las reglas de siempre.
 */
export function linkedInCompanyUrlsFromEvidence(urls: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    const normalized = normalizeLinkedInCompanyUrl(raw);
    if (normalized.rejected || !normalized.normalized || !normalized.slug) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/** Países y regiones que las empresas pegan a su marca en el slug de LinkedIn. */
const COUNTRY_SLUG_AFFIXES: readonly string[] = [
  'peru', 'chile', 'colombia', 'mexico', 'argentina', 'ecuador', 'bolivia', 'uruguay',
  'paraguay', 'venezuela', 'panama', 'guatemala', 'honduras', 'costarica', 'dominicana',
  'espana', 'spain', 'brasil', 'brazil', 'usa', 'latam', 'latinoamerica',
  'pe', 'cl', 'co', 'mx', 'ar', 'ec', 'bo', 'uy', 'py', 'es', 'br',
];

/**
 * AGENT1-TAVILY-FIRST-5 — el slug es la MARCA del dominio más un país
 * (`engieperu` para `engie-energia.pe`). Prod 02-10 (2fc07f4a): Engie quedó sin
 * LinkedIn por «slug_name_mismatch» con un nombre inferido del dominio. Sólo con
 * la marca del dominio (la identidad que ya se verificó) y de 4+ letras.
 */
export function slugIsDomainBrandWithCountry(slug: string, companyDomain: string | null): boolean {
  if (!companyDomain) return false;
  const brand = companyDomain.toLowerCase().replace(/^www\./, '').split('.')[0].split('-')[0];
  if (brand.length < 4) return false;
  const compact = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const affix of COUNTRY_SLUG_AFFIXES) {
    if (compact === `${brand}${affix}` || compact === `${affix}${brand}`) return true;
  }
  return false;
}
