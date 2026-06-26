/**
 * Canonical Candidate Name Resolution — Hito 16K-L
 *
 * When a candidate's detected name is a generic SEO service title, resolves
 * the actual company name using two strategies:
 *
 *   A. Title suffix: "[generic service] – [brand]" patterns
 *      Example: "Consultoría ERP, CRM, HCM – dinámica cd" → "Dinámica CD"
 *
 *   B. Domain inference fallback: inferred_company_name from ownership gate
 *      Example: domain "dinamicacd.com.co" → "Dinamicacd"
 *
 *   C. Passthrough: if the detected name is not a generic service title,
 *      no substitution is made (e.g. "SITECO" stays "SITECO").
 *
 * No external calls. No writes. Deterministic.
 */

import { normalizeProspectCompanyName } from './company-name-normalizer';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanonicalCandidateNameSource =
  | 'title_suffix'    // Brand extracted from source_title after separator
  | 'domain_inferred' // Brand inferred from domain (via company-name-normalizer)
  | 'passthrough';    // Name was not generic; kept as-is

export type CanonicalCandidateNameResolution = {
  /** The original name as detected by the pipeline. Always preserved. */
  originalDetectedName: string;
  /** The resolved canonical company name. Equals originalDetectedName when applied=false. */
  canonicalName: string;
  /** Normalized form of canonicalName (lowercase, no accents, no punctuation). */
  normalizedCanonicalName: string;
  /** True when a substitution was applied (generic title replaced by real company name). */
  applied: boolean;
  /** Strategy used to resolve the canonical name. */
  source: CanonicalCandidateNameSource;
  /** Confidence of the resolution. */
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable explanation of why this resolution was applied. */
  reason: string;
};

type ResolveInput = {
  /** Raw name returned by the pipeline (may be a generic SEO title). */
  detectedName: string;
  /** Source title from Tavily result (may embed brand after separator). */
  sourceTitle: string | null;
  /** Effective domain extracted from candidate URL. */
  domain: string | null;
  /**
   * Identity resolution computed by the company ownership gate.
   * Present only when the ownership gate detected a generic service title
   * and inferred the company name from the domain.
   */
  identityResolution: {
    inferred_company_name: string;
    identity_source: string;
  } | null;
};

// ─── Separator pattern for title suffix extraction ────────────────────────────
// Matches em-dash (U+2013), en-dash (U+2014), or " - " (with surrounding spaces).
// Does NOT split on bare hyphens (e.g. "e-commerce") to avoid false positives.
const TITLE_SEPARATOR_RE = /\s*[–—]\s*|\s+-\s+/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeForCompare(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title-cases a brand string extracted from source_title.
 * Short all-ASCII words (≤3 chars) are uppercased (acronym heuristic).
 * Preserves accents on longer words.
 */
function titleCaseBrand(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return word;
      // Short all-ASCII-letter words are treated as acronyms → uppercase
      if (word.length <= 3 && /^[a-zA-Z]+$/.test(word)) return word.toUpperCase();
      // Otherwise capitalize first char, preserve rest (keeps accents)
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Returns true if the text is a generic service title (not a company name).
 * Uses company-name-normalizer to avoid duplicating detection logic.
 */
function isGenericServiceTitle(text: string): boolean {
  const result = normalizeProspectCompanyName(text, undefined);
  return (
    result.normalizationReason === 'seo_phrase_no_clean_fallback' ||
    result.normalizationReason === 'keyword_stuffing_separator_extracted'
  );
}

/**
 * Attempts to extract a brand name from a source_title that follows the
 * "[generic service] – [brand]" or "[brand] – [generic service]" pattern.
 *
 * Returns null when:
 * - No separator found
 * - Neither part is a generic service title
 * - The brand segment is too short (< 2 chars)
 */
function extractBrandFromTitle(sourceTitle: string): { brand: string; strategy: 'suffix_after_generic' | 'prefix_before_generic' } | null {
  const parts = sourceTitle.split(TITLE_SEPARATOR_RE).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < 2) return null;

  const firstPart = parts[0];
  const lastPart = parts[parts.length - 1];

  // Pattern A: "[generic service] – [brand]"  (brand is AFTER separator)
  if (isGenericServiceTitle(firstPart) && !isGenericServiceTitle(lastPart) && lastPart.length >= 2) {
    return { brand: titleCaseBrand(lastPart), strategy: 'suffix_after_generic' };
  }

  // Pattern B: "[brand] – [generic service]"  (brand is BEFORE separator)
  if (isGenericServiceTitle(lastPart) && !isGenericServiceTitle(firstPart) && firstPart.length >= 2) {
    return { brand: titleCaseBrand(firstPart), strategy: 'prefix_before_generic' };
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves the canonical company name for a candidate whose detected name may
 * be a generic SEO service title.
 *
 * Priority:
 *   1. Title suffix extraction (best quality — preserves accents and full brand)
 *   2. Domain inference (from identityResolution.inferred_company_name)
 *   3. Passthrough (name is not generic; keep as-is)
 */
export function resolveCanonicalCandidateName(input: ResolveInput): CanonicalCandidateNameResolution {
  const { detectedName, sourceTitle, identityResolution } = input;

  const passthrough = (): CanonicalCandidateNameResolution => ({
    originalDetectedName: detectedName,
    canonicalName: detectedName,
    normalizedCanonicalName: normalizeForCompare(detectedName),
    applied: false,
    source: 'passthrough',
    confidence: 'high',
    reason: 'detected_name_is_already_a_company_name',
  });

  // Guard: only apply when identity_resolution signals a generic service title
  if (!identityResolution) return passthrough();

  // Strategy A: extract brand from source_title separator pattern
  if (sourceTitle) {
    const titleResult = extractBrandFromTitle(sourceTitle);
    if (titleResult) {
      return {
        originalDetectedName: detectedName,
        canonicalName: titleResult.brand,
        normalizedCanonicalName: normalizeForCompare(titleResult.brand),
        applied: true,
        source: 'title_suffix',
        confidence: 'high',
        reason: 'generic_service_title_replaced_by_brand_extracted_from_source_title',
      };
    }
  }

  // Strategy B: use inferred_company_name from domain inference
  const inferred = identityResolution.inferred_company_name;
  if (inferred && inferred !== detectedName) {
    return {
      originalDetectedName: detectedName,
      canonicalName: inferred,
      normalizedCanonicalName: normalizeForCompare(inferred),
      applied: true,
      source: 'domain_inferred',
      confidence: 'medium',
      reason: 'generic_service_title_replaced_by_domain_inferred_company_name',
    };
  }

  // Fallback: no better name available
  return passthrough();
}
