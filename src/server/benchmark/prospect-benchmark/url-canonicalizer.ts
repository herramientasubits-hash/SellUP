/**
 * URL Canonicalizer for Evidence Provenance (Hotfix 16AB.23.6)
 *
 * Provides normalized URL forms exclusively for comparison, deduplication,
 * and provenance classification. Original visible URLs are NEVER modified.
 *
 * Normalization rules:
 *   - Protocol: http ≡ https (both become https for comparison)
 *   - Host: lowercase, www. stripped, LinkedIn regional subdomains normalized
 *   - Path: trailing slash removed, duplicate slashes collapsed
 *   - Fragment: stripped (#section ignored)
 *   - Tracking params: utm_*, fbclid, gclid, mc_cid, mc_eid removed
 *   - Remaining params: sorted for stable comparison
 *   - Only http/https schemes accepted; others return null
 *
 * Not in scope: redirect resolution, network requests.
 */

/** Bump when canonicalization logic changes to invalidate cached provenance. */
export const EVIDENCE_PROVENANCE_VERSION = 1 as const;

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

const SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Returns a normalized URL string for comparison and deduplication.
 * Returns null for invalid URLs, empty input, or unsupported schemes
 * (javascript:, data:, file:, etc.).
 * Never throws.
 */
export function canonicalizeEvidenceUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;

  let hostname = parsed.hostname.toLowerCase();

  // Strip www. prefix (www.example.com ≡ example.com)
  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4);
  }

  // Normalize LinkedIn regional subdomains to linkedin.com.
  // Applies to co.linkedin.com, mx.linkedin.com, cl.linkedin.com, pe.linkedin.com, etc.
  // Slug differences are preserved: /company/b-secure ≠ /company/bsecure-latam
  if (/^[a-z]{2}\.linkedin\.com$/.test(hostname)) {
    hostname = 'linkedin.com';
  }

  // Normalize path: collapse duplicate slashes, remove trailing slash
  const pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');

  // Remove tracking parameters; sort remaining ones alphabetically for stability
  const params = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      params.append(key, value);
    }
  }
  params.sort();

  const qs = params.toString();

  // Fragment is always dropped (example.com/page#section ≡ example.com/page)
  // Use https as canonical scheme (http ≡ https for evidence comparison)
  return `https://${hostname}${pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * Returns true when two URLs refer to the same resource for evidence purposes.
 * Returns false if either URL is null, invalid, or uses an unsupported scheme.
 */
export function areEvidenceUrlsEquivalent(a: string, b: string): boolean {
  const ca = canonicalizeEvidenceUrl(a);
  const cb = canonicalizeEvidenceUrl(b);
  return ca !== null && cb !== null && ca === cb;
}
