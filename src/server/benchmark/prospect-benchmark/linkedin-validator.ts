/**
 * Benchmark — LinkedIn Validator (Hito 16AB.23.1)
 *
 * Valida URLs de LinkedIn sin llamadas externas.
 * Distingue entre perfiles corporativos, personales y publicaciones.
 */

import type { LinkedInStatus } from './types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type LinkedInValidation = {
  status: LinkedInStatus;
  normalized_url: string | null;
  reason: string;
};

// ─── Patrones ─────────────────────────────────────────────────────────────────

// Soporta linkedin.com, www.linkedin.com y dominios regionales (co.linkedin.com, es.linkedin.com, etc.)
const LINKEDIN_COMPANY_RE = /^https?:\/\/(?:(?:[a-z]{2})\.)?(?:www\.)?linkedin\.com\/company\/([a-z0-9\-_%]+)\/?.*$/i;
const LINKEDIN_PERSONAL_RE = /^https?:\/\/(?:(?:[a-z]{2})\.)?(?:www\.)?linkedin\.com\/in\//i;
const LINKEDIN_POST_RE = /^https?:\/\/(?:(?:[a-z]{2})\.)?(?:www\.)?linkedin\.com\/(posts?|feed|pulse)\//i;
const LINKEDIN_SEARCH_RE = /^https?:\/\/(?:(?:[a-z]{2})\.)?(?:www\.)?linkedin\.com\/search\//i;
const LINKEDIN_ROOT_RE = /^https?:\/\/(?:(?:[a-z]{2})\.)?(?:www\.)?linkedin\.com\/?$/i;

// Slugs that clearly do not correspond to a company
const INVALID_SLUGS = new Set([
  'company',
  'companies',
  'search',
  'feed',
  'posts',
  'login',
  'signup',
  'home',
]);

// ─── Validación ───────────────────────────────────────────────────────────────

/**
 * Valida una URL de LinkedIn.
 * @param url  URL a validar
 * @param companyName  Nombre de la empresa (opcional) — si se provee, permite
 *   distinguir entre http_unverified y url_format_valid según coherencia del slug.
 */
export function validateLinkedIn(url: string | null, companyName?: string | null): LinkedInValidation {
  if (!url || url.trim() === '') {
    return { status: 'not_searched', normalized_url: null, reason: 'LinkedIn URL not provided and not searched' };
  }

  const trimmed = url.trim();

  // Must contain linkedin.com
  if (!trimmed.toLowerCase().includes('linkedin.com')) {
    return { status: 'invalid', normalized_url: null, reason: `URL does not belong to linkedin.com: "${trimmed}"` };
  }

  // Root linkedin.com — no company specified
  if (LINKEDIN_ROOT_RE.test(trimmed)) {
    return { status: 'invalid', normalized_url: null, reason: 'URL points to linkedin.com root — no specific company page' };
  }

  // Personal profile
  if (LINKEDIN_PERSONAL_RE.test(trimmed)) {
    return { status: 'invalid', normalized_url: null, reason: 'URL is a personal LinkedIn profile, not a company page' };
  }

  // Post or article
  if (LINKEDIN_POST_RE.test(trimmed)) {
    return { status: 'invalid', normalized_url: null, reason: 'URL is a LinkedIn post or article, not a company page' };
  }

  // Search result
  if (LINKEDIN_SEARCH_RE.test(trimmed)) {
    return { status: 'invalid', normalized_url: null, reason: 'URL is a LinkedIn search results page' };
  }

  // Corporate page — /company/{slug}
  // Group 1 = slug (all other groups are non-capturing in the updated regex)
  const companyMatch = trimmed.match(LINKEDIN_COMPANY_RE);
  if (companyMatch) {
    const slug = companyMatch[1].toLowerCase();

    if (INVALID_SLUGS.has(slug)) {
      return { status: 'invalid', normalized_url: null, reason: `LinkedIn company slug "${slug}" is not a valid company identifier` };
    }

    const normalized = `https://www.linkedin.com/company/${slug}/`;

    // Determine granular status
    if (companyName) {
      const slugMatches = linkedInSlugMatchesCompany(trimmed, companyName);
      if (slugMatches) {
        // Format valid + slug coherent with company name → http_unverified (probable)
        return { status: 'http_unverified', normalized_url: normalized, reason: `LinkedIn corporativo probable: slug coherente con empresa (${normalized})` };
      } else {
        // Format valid but slug not obviously related
        return { status: 'url_format_valid', normalized_url: normalized, reason: `LinkedIn con formato válido, slug no confirmado para "${companyName}": ${normalized}` };
      }
    }

    // No company name provided — use http_unverified as default for valid /company/ URLs
    return { status: 'http_unverified', normalized_url: normalized, reason: `LinkedIn corporativo con formato válido: ${normalized}` };
  }

  // Anything else on linkedin.com — cannot classify
  return { status: 'invalid', normalized_url: null, reason: `LinkedIn URL does not match /company/{slug} pattern: "${trimmed}"` };
}

/**
 * Checks that a LinkedIn URL's slug corresponds reasonably to the company name.
 * Heuristic: tokenize both and check overlap.
 */
export function linkedInSlugMatchesCompany(linkedInUrl: string, companyName: string): boolean {
  const match = linkedInUrl.match(LINKEDIN_COMPANY_RE);
  if (!match) return false;

  // Group 1 = slug (all others are non-capturing)
  const slugRaw = match[1].toLowerCase();
  const slug = slugRaw.replace(/-/g, ' ');
  const nameLower = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  const slugTokens = new Set(slug.split(/\s+/).filter((t) => t.length > 2));
  const nameTokens = nameLower.split(/\s+/).filter((t) => t.length > 2);

  // Exact token overlap
  const overlap = nameTokens.filter((t) => slugTokens.has(t)).length;
  if (overlap >= 1) return true;

  // Substring match: slug contains any name token (handles "simetrikinc" containing "simetrik")
  const slugContainsToken = nameTokens.some((t) => t.length >= 4 && slugRaw.includes(t));
  if (slugContainsToken) return true;

  // Name token contains slug (handles short slugs that are subsets of multi-word names)
  const nameContainsSlug = nameTokens.some((t) => t.length >= 4 && slug.split(' ').some((s) => s.length >= 4 && t.includes(s)));
  return nameContainsSlug;
}
