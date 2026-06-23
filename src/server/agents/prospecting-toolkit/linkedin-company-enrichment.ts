/**
 * LinkedIn Company Enrichment — Hito v1.15
 *
 * Funciones puras para procesar señales de LinkedIn corporativo.
 * Sin llamadas externas. Sin I/O. Sin scraping. Sin login.
 * Sin Tavily. Sin Supabase. Determinístico.
 */

import type {
  LinkedInEnrichmentMetadata,
  LinkedInEnrichmentStatus,
  LinkedInEnrichmentSource,
  LinkedInEnrichmentSignals,
} from './types';

// ─── Paths de LinkedIn que se rechazan ───────────────────────────────────────

const REJECTED_PATH_PREFIXES = [
  '/in/',
  '/pub/',
  '/school/',
  '/jobs/',
  '/feed/',
  '/posts/',
  '/pulse/',
  '/search',
  '/uas/',
  '/checkpoint/',
  '/authwall',
  '/login',
  '/signup',
  '/start/',
  '/mynetwork/',
  '/messaging/',
  '/notifications/',
  '/me/',
  '/groups/',
];

// Slugs de plataformas globales cuyo LinkedIn page NO debe auto-asociarse
// a un implementador/partner con nombre diferente.
const GLOBAL_PLATFORM_SLUGS = new Set([
  'odoo',
  'zoho',
  'salesforce',
  'hubspot',
  'sap',
  'oracle',
  'microsoft',
  'google',
  'amazon',
  'adobe',
  'servicenow',
  'zendesk',
  'freshworks',
  'dynamics',
  'netsuite',
  'sage',
  'epicor',
  'infor',
  'workday',
  'successfactors',
  'bamboohr',
  'paylocity',
  'adp',
]);

// ─── Helpers de texto ─────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugToWords(slug: string): string {
  return slug.replace(/[-_]/g, ' ').toLowerCase().trim();
}

// ─── Tipos públicos de este módulo ────────────────────────────────────────────

export type NormalizeLinkedInResult = {
  normalized: string | null;
  slug: string | null;
  rejected: boolean;
  rejectReason: string | null;
};

export type LinkedInURLCandidate = {
  url: string;
  normalized: string;
  slug: string;
  foundIn: 'source_url' | 'source_snippet' | 'source_title' | 'website';
};

export type LinkedInExtractionInput = {
  candidateName?: string | null;
  candidateDomain?: string | null;
  website?: string | null;
  countryCode?: string | null;
  sourceTitle?: string | null;
  sourceSnippet?: string | null;
  sourceUrl?: string | null;
};

export type LinkedInMatchInput = {
  candidateName: string;
  candidateDomain?: string | null;
  countryCode?: string | null;
  sourceTitle?: string | null;
  sourceSnippet?: string | null;
};

export type LinkedInMatchResult = {
  status: LinkedInEnrichmentStatus;
  confidence: number;
  match_reason: string | null;
  warnings: string[];
  signals: LinkedInEnrichmentSignals;
};

export type BuildLinkedInEnrichmentInput = {
  candidateName: string;
  candidateDomain?: string | null;
  countryCode?: string | null;
  sourceTitle?: string | null;
  sourceSnippet?: string | null;
  sourceUrl?: string | null;
  website?: string | null;
  /** URL de LinkedIn proporcionada explícitamente (e.g. del scoring input). */
  providedLinkedInUrl?: string | null;
  source?: LinkedInEnrichmentSource;
  /** ISO timestamp para el campo checked_at. Si no se provee, se usa la hora actual. */
  checkedAt?: string;
};

// ─── normalizeLinkedInCompanyUrl ──────────────────────────────────────────────

/**
 * Normaliza una URL de empresa de LinkedIn a la forma canónica:
 *   https://www.linkedin.com/company/<slug>
 *
 * - Acepta: /company/<slug> con o sin https/www/query params/trailing slash.
 * - Rechaza: /in/, /pub/, /school/, /jobs/, /feed/, /posts/, /pulse/, /search y otros paths.
 * - Rechaza: cualquier hostname que no sea linkedin.com.
 */
export function normalizeLinkedInCompanyUrl(input: string): NormalizeLinkedInResult {
  if (!input || typeof input !== 'string') {
    return { normalized: null, slug: null, rejected: true, rejectReason: 'empty_input' };
  }

  const trimmed = input.trim();

  let parsed: URL;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProto);
  } catch {
    return { normalized: null, slug: null, rejected: true, rejectReason: 'invalid_url' };
  }

  const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (!hostname.endsWith('linkedin.com')) {
    return { normalized: null, slug: null, rejected: true, rejectReason: 'not_linkedin' };
  }

  // Quitar trailing slash para comparación limpia
  const rawPath = parsed.pathname.replace(/\/$/, '');

  for (const prefix of REJECTED_PATH_PREFIXES) {
    const cleanPrefix = prefix.replace(/\/$/, '');
    if (rawPath === cleanPrefix || rawPath.startsWith(prefix)) {
      return {
        normalized: null,
        slug: null,
        rejected: true,
        rejectReason: `rejected_path:${prefix.trim()}`,
      };
    }
  }

  const companyMatch = rawPath.match(/^\/company\/([^/?#]+)/);
  if (!companyMatch) {
    return { normalized: null, slug: null, rejected: true, rejectReason: 'not_company_path' };
  }

  const slug = companyMatch[1].toLowerCase();
  if (!slug) {
    return { normalized: null, slug: null, rejected: true, rejectReason: 'empty_slug' };
  }

  const normalized = `https://www.linkedin.com/company/${slug}`;
  return { normalized, slug, rejected: false, rejectReason: null };
}

// ─── extractLinkedInCompanyCandidates ─────────────────────────────────────────

const LINKEDIN_URL_REGEX = /https?:\/\/(?:www\.)?linkedin\.com\/company\/[A-Za-z0-9_%-]+/gi;

/**
 * Extrae candidatos de URL de empresa LinkedIn desde los campos de texto disponibles.
 * No hace llamadas externas. Devuelve sólo URLs válidas (company path).
 */
export function extractLinkedInCompanyCandidates(
  input: LinkedInExtractionInput,
): LinkedInURLCandidate[] {
  const candidates: LinkedInURLCandidate[] = [];
  const seen = new Set<string>();

  function tryExtract(text: string | null | undefined, foundIn: LinkedInURLCandidate['foundIn']) {
    if (!text) return;
    const matches = text.match(LINKEDIN_URL_REGEX) ?? [];
    for (const raw of matches) {
      const result = normalizeLinkedInCompanyUrl(raw);
      if (!result.rejected && result.normalized && result.slug && !seen.has(result.normalized)) {
        seen.add(result.normalized);
        candidates.push({ url: raw, normalized: result.normalized, slug: result.slug, foundIn });
      }
    }
  }

  tryExtract(input.sourceUrl, 'source_url');
  tryExtract(input.sourceSnippet, 'source_snippet');
  tryExtract(input.sourceTitle, 'source_title');
  tryExtract(input.website, 'website');

  return candidates;
}

// ─── evaluateLinkedInCompanyMatch ─────────────────────────────────────────────

// Mapeo heurístico de country code → términos que pueden aparecer en slugs.
const COUNTRY_SLUG_TERMS: Record<string, string[]> = {
  CO: ['colombia', 'col'],
  MX: ['mexico', 'mex'],
  AR: ['argentina', 'arg'],
  CL: ['chile', 'chl', 'cl'],
  PE: ['peru', 'per'],
  EC: ['ecuador', 'ec', 'ecu'],
  BO: ['bolivia', 'bo'],
  UY: ['uruguay', 'uy', 'uru'],
  PY: ['paraguay', 'py'],
  VE: ['venezuela', 've'],
  US: ['usa', 'us', 'estados-unidos'],
  ES: ['spain', 'espana'],
};

/**
 * Evalúa si un candidato de LinkedIn company corresponde a la empresa candidata.
 *
 * Determinístico. Sin I/O. No aprueba automáticamente candidatos query_only.
 * No reemplaza evidencia de país. No anula el duplicate guard.
 */
export function evaluateLinkedInCompanyMatch(
  candidate: LinkedInMatchInput,
  linkedinCandidate: LinkedInURLCandidate,
): LinkedInMatchResult {
  const warnings: string[] = [];
  const signals: LinkedInEnrichmentSignals = {
    name_match: false,
    domain_match: false,
    country_match: false,
    is_company_page: true, // ya validado por normalizeLinkedInCompanyUrl
  };

  const slug = linkedinCandidate.slug;
  const slugWords = slugToWords(slug);

  // ── Guard: slug de plataforma global ───────────────────────────────────────
  // Si el slug es un proveedor global (Odoo, Zoho, etc.) pero el nombre del
  // candidato NO coincide con ese proveedor, el resultado es ambiguous.
  if (GLOBAL_PLATFORM_SLUGS.has(slug)) {
    const normalizedCandidateName = normalizeText(candidate.candidateName);
    const normalizedSlugWords = normalizeText(slugWords);
    const nameMatchesPlatform =
      normalizedCandidateName.includes(normalizedSlugWords) ||
      normalizedSlugWords.includes(normalizedCandidateName);
    if (!nameMatchesPlatform) {
      warnings.push(
        `LinkedIn slug "${slug}" corresponde a una plataforma global. El candidato "${candidate.candidateName}" no coincide — posiblemente es un reseller o partner, no la empresa propietaria de esa página.`,
      );
      return {
        status: 'ambiguous',
        confidence: 10,
        match_reason: 'global_platform_slug_mismatch',
        warnings,
        signals,
      };
    }
  }

  // ── Name match: slug vs candidate name ────────────────────────────────────
  const normalizedName = normalizeText(candidate.candidateName);
  const normalizedSlug = normalizeText(slugWords);

  const nameTokens = normalizedName.split(' ').filter((t) => t.length > 0);
  const slugTokens = normalizedSlug.split(' ').filter((t) => t.length > 0);

  const exactMatch = normalizedName === normalizedSlug;
  const nameContainsSlug = normalizedSlug.length > 2 && normalizedName.includes(normalizedSlug);
  const slugContainsName = normalizedName.length > 2 && normalizedSlug.includes(normalizedName);
  const sharedTokens = nameTokens.filter((t) => t.length > 2 && slugTokens.includes(t));
  const tokenMatchRatio = nameTokens.length > 0 ? sharedTokens.length / nameTokens.length : 0;

  signals.name_match = exactMatch || nameContainsSlug || slugContainsName || tokenMatchRatio >= 0.5;

  // ── Domain match: slug vs domain base ────────────────────────────────────
  if (candidate.candidateDomain) {
    const domainBase = normalizeText(candidate.candidateDomain.split('.')[0] ?? '');
    signals.domain_match =
      domainBase.length > 2 &&
      (normalizedSlug.includes(domainBase) || domainBase.includes(normalizedSlug));
  }

  // ── Snippet/title mention ─────────────────────────────────────────────────
  const combinedText = [candidate.sourceTitle, candidate.sourceSnippet]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const nameInText = normalizedName.length > 2 && combinedText.includes(normalizedName);

  // ── Country match heurístico ─────────────────────────────────────────────
  if (candidate.countryCode) {
    const terms = COUNTRY_SLUG_TERMS[candidate.countryCode.toUpperCase()] ?? [];
    signals.country_match = terms.some((term) => slugWords.includes(term));
  }

  // ── Calcular confidence ───────────────────────────────────────────────────
  let confidence = 0;
  const matchReasons: string[] = [];

  if (signals.name_match) {
    confidence += 40;
    matchReasons.push('name_match_slug');
  }

  if (signals.domain_match) {
    confidence += 25;
    matchReasons.push('domain_match_slug');
  }

  if (nameInText) {
    confidence += 20;
    matchReasons.push('company_name_in_snippet');
  }

  if (signals.country_match) {
    confidence += 10;
    matchReasons.push('country_match_in_slug');
  }

  if (!signals.name_match && !signals.domain_match) {
    warnings.push(
      `Slug "${slug}" no coincide con el nombre "${candidate.candidateName}" ni con el dominio. Verificación manual recomendada.`,
    );
  }

  // ── Status final ──────────────────────────────────────────────────────────
  // Umbral 65: name_match(40) + domain_match(25) es evidencia suficiente de match.
  let status: LinkedInEnrichmentStatus;
  if (confidence >= 65) {
    status = 'found';
  } else if (confidence >= 30) {
    status = 'ambiguous';
    if (warnings.length === 0) {
      warnings.push('Coincidencia parcial. Verificación manual recomendada.');
    }
  } else {
    status = 'ambiguous';
    warnings.push('Confianza baja. La URL de LinkedIn podría no corresponder a esta empresa.');
  }

  return {
    status,
    confidence,
    match_reason: matchReasons.length > 0 ? matchReasons.join(', ') : null,
    warnings,
    signals,
  };
}

// ─── buildLinkedInEnrichmentMetadata ─────────────────────────────────────────

/**
 * Construye el objeto completo de metadata linkedin_enrichment para persistir
 * en candidate.metadata.linkedin_enrichment.
 *
 * Sin I/O. Determinístico dado el mismo input.
 */
export function buildLinkedInEnrichmentMetadata(
  input: BuildLinkedInEnrichmentInput,
): LinkedInEnrichmentMetadata {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const requestedSource: LinkedInEnrichmentSource = input.source ?? 'none';

  // Extraer candidatos LinkedIn desde los textos disponibles
  const extractedCandidates = extractLinkedInCompanyCandidates({
    candidateName: input.candidateName,
    candidateDomain: input.candidateDomain,
    countryCode: input.countryCode,
    sourceTitle: input.sourceTitle,
    sourceSnippet: input.sourceSnippet,
    sourceUrl: input.sourceUrl,
    website: input.website,
  });

  // Si hay una URL explícita, añadirla en primera posición si no está ya
  if (input.providedLinkedInUrl) {
    const explicit = normalizeLinkedInCompanyUrl(input.providedLinkedInUrl);
    if (explicit.rejected) {
      return {
        enabled: true,
        status: 'rejected',
        confidence: 0,
        warnings: [`URL de LinkedIn rechazada: ${explicit.rejectReason}`],
        source: requestedSource,
        checked_at: checkedAt,
      };
    }
    if (explicit.normalized && explicit.slug) {
      const alreadyHave = extractedCandidates.some((c) => c.normalized === explicit.normalized);
      if (!alreadyHave) {
        extractedCandidates.unshift({
          url: input.providedLinkedInUrl,
          normalized: explicit.normalized,
          slug: explicit.slug,
          foundIn: 'source_url',
        });
      }
    }
  }

  if (extractedCandidates.length === 0) {
    return {
      enabled: true,
      status: 'not_found',
      confidence: 0,
      warnings: ['No LinkedIn company URL available in current evidence.'],
      source: 'none',
      checked_at: checkedAt,
    };
  }

  // Evaluar el candidato primario (el primero encontrado, con prioridad a provided)
  const primary = extractedCandidates[0];
  const matchResult = evaluateLinkedInCompanyMatch(
    {
      candidateName: input.candidateName,
      candidateDomain: input.candidateDomain,
      countryCode: input.countryCode,
      sourceTitle: input.sourceTitle,
      sourceSnippet: input.sourceSnippet,
    },
    primary,
  );

  const resolvedSource: LinkedInEnrichmentSource =
    requestedSource !== 'none' ? requestedSource : 'provided_search_result';

  return {
    enabled: true,
    status: matchResult.status,
    company_url: primary.normalized,
    normalized_company_slug: primary.slug,
    confidence: matchResult.confidence,
    match_reason: matchResult.match_reason,
    signals: matchResult.signals,
    warnings: matchResult.warnings,
    source: resolvedSource,
    checked_at: checkedAt,
  };
}
