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

const LINKEDIN_COMPANY_RE = /^https?:\/\/(www\.)?linkedin\.com\/company\/([a-z0-9\-_%]+)\/?.*$/i;
const LINKEDIN_PERSONAL_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\//i;
const LINKEDIN_POST_RE = /^https?:\/\/(www\.)?linkedin\.com\/(posts?|feed|pulse)\//i;
const LINKEDIN_SEARCH_RE = /^https?:\/\/(www\.)?linkedin\.com\/search\//i;
const LINKEDIN_ROOT_RE = /^https?:\/\/(www\.)?linkedin\.com\/?$/i;

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

export function validateLinkedIn(url: string | null): LinkedInValidation {
  if (!url || url.trim() === '') {
    return { status: 'not_searched', normalized_url: null, reason: 'LinkedIn URL not provided and not searched' };
  }

  const trimmed = url.trim();

  // Must start with linkedin.com
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
  const companyMatch = trimmed.match(LINKEDIN_COMPANY_RE);
  if (companyMatch) {
    const slug = companyMatch[2].toLowerCase();

    if (INVALID_SLUGS.has(slug)) {
      return { status: 'invalid', normalized_url: null, reason: `LinkedIn company slug "${slug}" is not a valid company identifier` };
    }

    const normalized = `https://www.linkedin.com/company/${slug}/`;
    return { status: 'found', normalized_url: normalized, reason: `Valid LinkedIn company page: ${normalized}` };
  }

  // Anything else linkedin.com — cannot verify
  return { status: 'invalid', normalized_url: null, reason: `LinkedIn URL does not match /company/{slug} pattern: "${trimmed}"` };
}

/**
 * Checks that a LinkedIn URL's slug corresponds reasonably to the company name.
 * Heuristic: tokenize both and check overlap.
 */
export function linkedInSlugMatchesCompany(linkedInUrl: string, companyName: string): boolean {
  const match = linkedInUrl.match(LINKEDIN_COMPANY_RE);
  if (!match) return false;

  const slug = match[2].toLowerCase().replace(/-/g, ' ');
  const nameLower = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  const slugTokens = new Set(slug.split(/\s+/).filter((t) => t.length > 2));
  const nameTokens = nameLower.split(/\s+/).filter((t) => t.length > 2);

  const overlap = nameTokens.filter((t) => slugTokens.has(t)).length;
  return overlap >= 1;
}
