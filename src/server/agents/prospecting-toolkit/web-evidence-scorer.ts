/**
 * Web Evidence Scorer — 16AK.13
 *
 * Scoring y extracción de evidencia web para candidatos RUES.
 * No inventa datos. Solo clasifica, puntúa y extrae desde URLs/snippets explícitos.
 *
 * Contratos:
 * - Solo retorna datos respaldados por URLs en la evidencia recibida.
 * - Nunca infiere website/LinkedIn si no hay URL explícita.
 * - Rechaza resultados de directorios, redes sociales personales y buscadores.
 */

// ─── Domain blacklists ────────────────────────────────────────────────────────

const SOCIAL_PERSONAL = new Set([
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'youtube.com', 'tiktok.com', 'whatsapp.com', 'telegram.org',
]);

const SEARCH_ENGINES = new Set([
  'google.com', 'google.com.co', 'bing.com', 'yahoo.com', 'duckduckgo.com',
]);

const EMAIL_PROVIDERS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'live.com',
]);

const DIRECTORY_SUBSTRINGS = [
  'paginasamarillas', 'paginas-amarillas', 'kompass', 'opencorporates',
  'dnb.com', 'zoominfo', 'clutch.co', 'crunchbase', 'emis.com', 'cylex',
  'listado.net', 'empresite', 'infobel', 'registrociv', 'yellowpages',
  'directoriocomercial', 'mapas.google', 'maps.google',
];

const REGISTRY_SUBSTRINGS = [
  'rues.gov', 'rues.org', 'supersociedades', 'camaracomercio',
  'ccb.org', 'ccb.com', 'camaramedellin', 'registraduría',
];

const NEWS_SUBSTRINGS = [
  'portafolio.co', 'larepublica.co', 'eltiempo.com', 'elespectador.com',
  'dinero.com', 'semana.com', 'revistapym', 'revista-',
];

const LEGAL_SUFFIXES = [
  'S\\.A\\.S', 'S\\.A', 'LTDA', 'SAS', 'SA', 'E\\.S\\.P',
  'S\\.C\\.A', 'S\\.C\\.S', 'E\\.U', 'EU',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType =
  | 'official_website'
  | 'linkedin_company'
  | 'directory'
  | 'news'
  | 'registry'
  | 'unknown';

export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'rejected';

export interface RawWebResult {
  url: string;
  title: string;
  snippet: string | null;
}

export interface ScoredWebResult extends RawWebResult {
  source_type: SourceType;
  confidence: EvidenceConfidence;
  matched_signals: string[];
  raw_score: number;
}

export interface OfficialWebsiteEvidence {
  url: string;
  domain: string;
  confidence: EvidenceConfidence;
  evidence_url: string;
  reason: string;
}

export interface LinkedInEvidence {
  url: string;
  confidence: EvidenceConfidence;
  evidence_url: string;
  reason: string;
}

export interface PublicDescriptionEvidence {
  text: string;
  confidence: EvidenceConfidence;
  evidence_used: string[];
}

export interface QueryStrategy {
  query: string;
  purpose: 'website' | 'linkedin_description';
}

export interface CandidateBasicInfo {
  name: string | null;
  legal_name: string | null;
  tax_identifier: string | null;
  city: string | null;
  industry: string | null;
}

// ─── Name normalization ───────────────────────────────────────────────────────

export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  let n = name.toUpperCase().trim();
  for (const suffix of LEGAL_SUFFIXES) {
    n = n.replace(new RegExp(`[,\\s]+${suffix}\\.?\\s*$`, 'i'), '').trim();
  }
  return n.trim();
}

// ─── Domain helpers ───────────────────────────────────────────────────────────

export function extractDomainFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function domainMatchesList(domain: string, list: string[]): boolean {
  return list.some((k) => domain.includes(k));
}

// ─── Query builder ────────────────────────────────────────────────────────────

export function buildQueryStrategies(
  candidate: CandidateBasicInfo,
  industry: string,
): QueryStrategy[] {
  const name = (candidate.legal_name ?? candidate.name ?? '').trim();
  const normalized = normalizeCompanyName(name);
  const nit = candidate.tax_identifier;
  const city = candidate.city ?? '';

  const websiteParts: string[] = [];
  if (name) websiteParts.push(`"${name}"`);
  if (nit) websiteParts.push(`NIT ${nit}`);
  websiteParts.push('Colombia');
  if (city) websiteParts.push(city);
  websiteParts.push('sitio web empresa');

  const linkedinParts: string[] = [];
  if (normalized) linkedinParts.push(`"${normalized}"`);
  linkedinParts.push('Colombia empresa');
  if (city) linkedinParts.push(city);
  linkedinParts.push('LinkedIn');
  // Also get description/activity from this query
  const industryShard = industry ? industry.split(/[\/,]/)[0].trim() : '';
  if (industryShard) linkedinParts.push(industryShard);

  return [
    { query: websiteParts.filter(Boolean).join(' '), purpose: 'website' },
    { query: linkedinParts.filter(Boolean).join(' '), purpose: 'linkedin_description' },
  ];
}

// ─── Source classifier ────────────────────────────────────────────────────────

function classifySourceType(url: string, title: string, snippet: string | null): SourceType {
  const domain = extractDomainFromUrl(url) ?? '';
  const combined = `${url} ${title} ${snippet ?? ''}`.toLowerCase();

  // LinkedIn company page (strict: must have /company/ path)
  if (domain.includes('linkedin.com')) {
    if (url.includes('/company/')) return 'linkedin_company';
    return 'unknown'; // personal profile or other LinkedIn page
  }

  // Registry sources
  if (domainMatchesList(domain, REGISTRY_SUBSTRINGS)) return 'registry';

  // Blacklisted: social, search, email
  if (SOCIAL_PERSONAL.has(domain)) return 'unknown';
  if (SEARCH_ENGINES.has(domain)) return 'unknown';
  if (EMAIL_PROVIDERS.has(domain)) return 'unknown';

  // Directory
  if (domainMatchesList(domain, DIRECTORY_SUBSTRINGS)) return 'directory';
  if (domainMatchesList(combined, DIRECTORY_SUBSTRINGS)) return 'directory';

  // News
  if (domainMatchesList(domain, NEWS_SUBSTRINGS)) return 'news';

  return 'official_website';
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreResult(candidate: CandidateBasicInfo, result: RawWebResult): number {
  const name = (candidate.legal_name ?? candidate.name ?? '').trim();
  const normalized = normalizeCompanyName(name);
  const domain = extractDomainFromUrl(result.url) ?? '';
  const combined = `${result.title} ${result.snippet ?? ''}`.toLowerCase();

  // Hard rejects
  if (EMAIL_PROVIDERS.has(domain)) return 0;
  if (SOCIAL_PERSONAL.has(domain) && !result.url.includes('/company/')) return 0;
  if (SEARCH_ENGINES.has(domain)) return 0;

  let score = 0;

  // Name match in title (strongest signal)
  const titleLower = result.title.toLowerCase();
  const nameWords = normalized
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const wordsInTitle = nameWords.filter((w) => titleLower.includes(w));
  if (nameWords.length > 0) {
    const ratio = wordsInTitle.length / nameWords.length;
    if (ratio >= 0.7) score += 35;
    else if (ratio >= 0.4) score += 18;
    else if (ratio >= 0.2) score += 8;
  }

  // NIT / tax identifier explicit match (very strong signal)
  if (candidate.tax_identifier && combined.includes(candidate.tax_identifier)) score += 30;

  // Country
  if (combined.includes('colombia')) score += 8;

  // City
  if (candidate.city && combined.includes(candidate.city.toLowerCase())) score += 8;

  // Own domain (not a directory)
  const isDirectory = domainMatchesList(domain, DIRECTORY_SUBSTRINGS);
  if (!isDirectory && domain.length > 0) score += 12;

  // Industry/sector match
  if (candidate.industry) {
    const industryWords = candidate.industry.toLowerCase().split(/[\/,\s]/).filter((w) => w.length > 3);
    if (industryWords.some((w) => combined.includes(w))) score += 5;
  }

  return Math.min(score, 100);
}

function scoreToConfidence(score: number, sourceType: SourceType): EvidenceConfidence {
  if (sourceType === 'unknown') return 'rejected';
  if (score < 12) return 'rejected';
  if (score < 28) return 'low';
  if (score < 52) return 'medium';
  return 'high';
}

// ─── Public scorer ────────────────────────────────────────────────────────────

export function scoreWebEvidence(
  candidate: CandidateBasicInfo,
  results: RawWebResult[],
): ScoredWebResult[] {
  return results.map((r) => {
    const sourceType = classifySourceType(r.url, r.title, r.snippet);
    const rawScore = scoreResult(candidate, r);
    // LinkedIn gets a small boost since it passed the /company/ gate
    const adjustedScore = sourceType === 'linkedin_company' ? Math.min(rawScore + 12, 100) : rawScore;
    const confidence = scoreToConfidence(adjustedScore, sourceType);

    const signals: string[] = [];
    const text = `${r.title} ${r.snippet ?? ''}`.toLowerCase();
    if (candidate.tax_identifier && text.includes(candidate.tax_identifier)) signals.push('nit_match');
    if (text.includes('colombia')) signals.push('country_match');
    if (candidate.city && text.includes(candidate.city.toLowerCase())) signals.push('city_match');
    const normalizedName = normalizeCompanyName(candidate.legal_name ?? candidate.name ?? '');
    const nameWords = normalizedName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (nameWords.some((w) => r.title.toLowerCase().includes(w))) signals.push('name_in_title');

    return {
      ...r,
      source_type: sourceType,
      confidence,
      matched_signals: signals,
      raw_score: adjustedScore,
    };
  });
}

// ─── Evidence extractors ──────────────────────────────────────────────────────

export function extractOfficialWebsite(
  scoredResults: ScoredWebResult[],
): OfficialWebsiteEvidence | null {
  const candidates = scoredResults
    .filter((r) => r.source_type === 'official_website')
    .filter((r) => r.confidence === 'high' || r.confidence === 'medium')
    .sort((a, b) => b.raw_score - a.raw_score);

  if (candidates.length === 0) return null;

  const best = candidates[0];
  const domain = extractDomainFromUrl(best.url);
  if (!domain) return null;

  return {
    url: best.url,
    domain,
    confidence: best.confidence,
    evidence_url: best.url,
    reason: `score=${best.raw_score} signals=[${best.matched_signals.join(',')}]`,
  };
}

export function extractLinkedInCompany(
  scoredResults: ScoredWebResult[],
): LinkedInEvidence | null {
  const candidates = scoredResults
    .filter((r) => r.source_type === 'linkedin_company')
    .filter((r) => r.confidence !== 'rejected')
    .sort((a, b) => b.raw_score - a.raw_score);

  if (candidates.length === 0) return null;

  const best = candidates[0];
  return {
    url: best.url,
    confidence: best.confidence,
    evidence_url: best.url,
    reason: `score=${best.raw_score} signals=[${best.matched_signals.join(',')}]`,
  };
}

export function buildPublicDescription(
  scoredResults: ScoredWebResult[],
): PublicDescriptionEvidence | null {
  const relevant = scoredResults
    .filter((r) => r.confidence === 'high' || r.confidence === 'medium')
    .filter((r) => r.snippet && r.snippet.length > 40)
    .sort((a, b) => b.raw_score - a.raw_score)
    .slice(0, 3);

  if (relevant.length === 0) return null;

  const best = relevant[0];
  const text = (best.snippet ?? '').slice(0, 400).trim();
  if (text.length < 30) return null;

  return {
    text,
    confidence: best.confidence,
    evidence_used: relevant.map((r) => r.url),
  };
}

// ─── Early-stop signal ────────────────────────────────────────────────────────

/** Returns true if we already have enough evidence from the first query. */
export function hasHighConfidenceEvidence(scoredResults: ScoredWebResult[]): boolean {
  const hasWebsite = scoredResults.some(
    (r) => r.source_type === 'official_website' && r.confidence === 'high',
  );
  const hasLinkedIn = scoredResults.some(
    (r) => r.source_type === 'linkedin_company' && r.confidence !== 'rejected',
  );
  return hasWebsite && hasLinkedIn;
}
