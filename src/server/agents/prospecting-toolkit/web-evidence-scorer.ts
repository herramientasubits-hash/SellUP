/**
 * Web Evidence Scorer — 16AK.13B
 *
 * Scoring y extracción de evidencia web para candidatos RUES.
 * No inventa datos. Solo clasifica, puntúa y extrae desde URLs/snippets explícitos.
 *
 * Contratos:
 * - Solo retorna datos respaldados por URLs en la evidencia recibida.
 * - Nunca infiere website/LinkedIn si no hay URL explícita.
 * - Rechaza resultados de directorios, redes sociales personales y buscadores.
 * - Directorios van a public_evidence, NUNCA a official_website.
 * - LinkedIn requiere /company/ path Y name match fuerte para ser confirmado.
 */

// ─── Domain blacklists ────────────────────────────────────────────────────────

const SOCIAL_PERSONAL = new Set([
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'youtube.com', 'tiktok.com', 'whatsapp.com', 'telegram.org',
  'linkedin.com', 'gmail.com', 'google.com',
]);

const SEARCH_ENGINES = new Set([
  'google.com', 'google.com.co', 'bing.com', 'yahoo.com', 'duckduckgo.com',
]);

const EMAIL_PROVIDERS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'live.com',
]);

/** Dominios de directorios comerciales. NUNCA son website oficial. */
const COMMERCIAL_DIRECTORY_DOMAINS = new Set([
  'registronit.com',
  'informacolombia.com',
  'datacreditoempresas.com.co',
  'einforma.co',
  'empresite.eleconomistaamerica.co',
  'empresite.com',
  'paginasamarillas.com.co',
  'wikipedia.org',
]);

/**
 * Dominios académicos, repositorios documentales y plataformas de documentos.
 * Pueden ser public_evidence si mencionan nombre/NIT, pero NUNCA website oficial.
 */
const ACADEMIC_REPOSITORY_DOMAINS = new Set([
  'academia.edu',
  'researchgate.net',
  'docs.google.com',
  'drive.google.com',
  'scribd.com',
  'issuu.com',
  'pdfcoffee.com',
  'studocu.com',
]);

const ACADEMIC_REPOSITORY_SUBSTRINGS = [
  'repositorio.',
  'repository.',
  'scholar.',
  'researchgate.',
  'scielo.',
  'dialnet.',
  'redalyc.',
  'semanticscholar.',
  '.edu.co/repositorio',
  '.edu/repositorio',
];

const DIRECTORY_SUBSTRINGS = [
  'paginasamarillas', 'paginas-amarillas', 'kompass', 'opencorporates',
  'dnb.com', 'zoominfo', 'clutch.co', 'crunchbase', 'emis.com', 'cylex',
  'listado.net', 'empresite', 'infobel', 'registrociv', 'yellowpages',
  'directoriocomercial', 'mapas.google', 'maps.google',
  'registronit', 'informacolombia', 'datacreditoempresas', 'einforma',
  'datospymes', 'directorioempresas', 'buscaempresas', 'procolombia', 'b2bmarketplace',
];

const REGISTRY_SUBSTRINGS = [
  'rues.gov', 'rues.org', 'supersociedades', 'camaracomercio',
  'ccb.org', 'ccb.com', 'camaramedellin', 'registraduría',
];

const CHAMBER_OF_COMMERCE_SUBSTRINGS = [
  'ccb.org.co', 'camaramedellin.com.co', 'ccc.org.co', 'ccv.org.co',
  'camarabaq.org.co', 'ccmpc.org.co',
];

const NEWS_SUBSTRINGS = [
  'portafolio.co', 'larepublica.co', 'eltiempo.com', 'elespectador.com',
  'dinero.com', 'semana.com', 'revistapym', 'revista-',
];

const LEGAL_SUFFIXES = [
  'S\\.A\\.S', 'S\\.A', 'LTDA', 'SAS', 'SA', 'E\\.S\\.P',
  'S\\.C\\.A', 'S\\.C\\.S', 'E\\.U', 'EU', 'EN LIQUIDACION', 'EN LIQUIDACIÓN',
];

/**
 * Tokens genéricos que no identifican a ninguna empresa específica.
 * Usados para filtrar en el matching de LinkedIn.
 */
const GENERIC_COMPANY_TOKENS = new Set([
  'sas', 'sa', 'ltda', 'limitada', 'empresa', 'compania', 'compañia',
  'agencia', 'seguros', 'inversiones', 'servicios', 'asesores',
  'consultores', 'grupo', 'colombia', 'cia', 'comercial', 'industrial',
  'nacional', 'internacional', 'soluciones', 'tecnologia', 'tecnologias',
  'distribuciones', 'distribuidora', 'constructora', 'ingenieria',
  'asociados', 'hermanos', 'bogota', 'medellin', 'cali', 'barranquilla',
  'bucaramanga', 'manizales', 'pereira', 'armenia', 'cucuta', 'ibague',
  'neiva', 'villavicencio', 'pasto', 'monteria', 'sincelejo', 'valledupar',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceType =
  | 'official_website'
  | 'linkedin_company'
  | 'commercial_directory'
  | 'public_registry'
  | 'chamber_of_commerce'
  | 'news'
  | 'social'
  | 'unknown';

/** @deprecated use SourceType */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _LegacySourceType = 'directory' | 'registry';

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

export interface PossibleLinkedInMatch {
  url: string;
  title?: string;
  confidence: EvidenceConfidence;
  evidence_url: string;
  reason: string;
  match_quality: 'partial' | 'weak';
}

export interface PublicDescriptionEvidence {
  text: string;
  confidence: EvidenceConfidence;
  evidence_used: string[];
}

export interface PublicEvidenceItem {
  title: string;
  url: string;
  domain: string;
  source_type: SourceType;
  confidence: EvidenceConfidence;
  reason: string;
}

export interface RejectedWebsiteEntry {
  url: string;
  domain: string;
  reason: string;
}

/** Resultado estructurado completo del enriquecimiento web — 16AK.13B */
export interface WebEnrichmentResult {
  official_website: OfficialWebsiteEvidence | null;
  linkedin_company: LinkedInEvidence | null;
  possible_linkedin_matches: PossibleLinkedInMatch[];
  public_evidence: PublicEvidenceItem[];
  rejected_as_official_website: RejectedWebsiteEntry[];
}

// ─── Search intent types — base para 16AK.13C ────────────────────────────────

/**
 * Intents de búsqueda diferenciados.
 * En 16AK.13B solo usamos official_website y linkedin_company.
 * Los demás están documentados para 16AK.13C sin aumentar queries/costo aún.
 *
 * 16AK.13C roadmap:
 *   - contact_info: buscar emails/teléfonos desde el sitio oficial
 *   - public_evidence: query específica para directorios/RUES
 *   - company_description: buscar descripciones/About en fuentes de calidad
 */
export type SearchQueryIntent =
  | 'official_website'
  | 'linkedin_company'
  | 'public_evidence'   // disponible para 16AK.13C
  | 'contact_info'      // disponible para 16AK.13C
  | 'company_description'; // disponible para 16AK.13C

export interface QueryStrategy {
  query: string;
  intent: SearchQueryIntent;
  /** @deprecated use intent */
  purpose?: 'website' | 'linkedin_description';
}

export interface CandidateBasicInfo {
  name: string | null;
  legal_name: string | null;
  tax_identifier: string | null;
  city: string | null;
  industry: string | null;
}

// ─── NIT / tax identifier helpers ────────────────────────────────────────────

/**
 * Extracts candidate Colombian tax identifiers (NIT) from arbitrary text.
 * Handles: "901955673", "901.955.673", "901955673-2", "63456575-8".
 * Returns normalized base digits (8 or 9 digits, no check digit, no dots).
 */
export function extractColombianTaxIdentifiersFromText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // Match digit sequences (with optional dot separators) optionally followed by -digit (check digit)
  const pattern = /\b(\d[\d.]{6,11}\d)(?:-\d)?\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1];
    const digits = raw.replace(/\./g, '');
    if (digits.length === 8 || digits.length === 9) {
      found.add(digits);
    }
  }
  return Array.from(found);
}

/** Normalizes a NIT string to its base digits (strips dots, spaces, check digit). */
export function normalizeNIT(nit: string): string {
  if (!nit) return '';
  const withoutDots = nit.replace(/[.\s]/g, '');
  const withoutCheck = withoutDots.replace(/-\d$/, '');
  return withoutCheck.replace(/\D/g, '');
}

export type TaxIdCheckResult = 'match' | 'conflict' | 'neutral';

/**
 * Checks if evidence text contains a NIT that conflicts or matches the candidate's NIT.
 * - 'match': evidence contains the candidate's NIT → boosts confidence
 * - 'conflict': evidence contains a different NIT → lowers confidence
 * - 'neutral': no NIT found in evidence
 */
export function hasTaxIdentifierConflict(
  candidateTaxId: string | null,
  evidenceText: string,
): TaxIdCheckResult {
  if (!candidateTaxId) return 'neutral';
  const normalizedCandidate = normalizeNIT(candidateTaxId);
  if (!normalizedCandidate || normalizedCandidate.length < 8) return 'neutral';

  const foundNITs = extractColombianTaxIdentifiersFromText(evidenceText);
  if (foundNITs.length === 0) return 'neutral';

  const hasMatch = foundNITs.some(
    (n) => n === normalizedCandidate || n.startsWith(normalizedCandidate) || normalizedCandidate.startsWith(n),
  );
  return hasMatch ? 'match' : 'conflict';
}

// ─── Distinctive token helpers ────────────────────────────────────────────────

/**
 * Splits a company name into distinctive vs generic tokens.
 * Distinctive tokens identify a specific company; generic ones don't.
 */
export function getDistinctiveCompanyTokens(name: string): {
  distinctive: string[];
  generic: string[];
} {
  const normalized = normalizeCompanyNameForSearch(name);
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2);

  const distinctive: string[] = [];
  const generic: string[] = [];

  for (const token of tokens) {
    const clean = token.replace(/[^a-z0-9áéíóúüñ]/g, '');
    if (!clean || clean.length < 2) continue;
    if (GENERIC_COMPANY_TOKENS.has(clean)) {
      generic.push(clean);
    } else {
      distinctive.push(clean);
    }
  }

  return { distinctive, generic };
}

// ─── Public domain helpers ─────────────────────────────────────────────────────

/**
 * Returns true if a domain is a directory, registry, social network,
 * third-party aggregator, or academic/repository site — i.e. it must NEVER
 * be stored as an official website. May still be used as public_evidence.
 */
export function isDirectoryOrThirdPartyEvidenceDomain(domain: string): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (COMMERCIAL_DIRECTORY_DOMAINS.has(d)) return true;
  if (ACADEMIC_REPOSITORY_DOMAINS.has(d)) return true;
  if (SOCIAL_PERSONAL.has(d)) return true;
  if (SEARCH_ENGINES.has(d)) return true;
  if (EMAIL_PROVIDERS.has(d)) return true;
  if (DIRECTORY_SUBSTRINGS.some((k) => d.includes(k))) return true;
  if (REGISTRY_SUBSTRINGS.some((k) => d.includes(k))) return true;
  if (CHAMBER_OF_COMMERCE_SUBSTRINGS.some((k) => d.includes(k))) return true;
  if (ACADEMIC_REPOSITORY_SUBSTRINGS.some((k) => d.includes(k) || domain.toLowerCase().includes(k))) return true;
  // Reject any subdomain of a university (.edu, .edu.co, .edu.mx, etc.)
  if (/\.edu(\.[a-z]{2})?$/.test(d)) return true;
  // Colombian government institutional domains (.gov.co) — always governmental, never a commercial company website
  if (/\.gov\.co$/.test(d) || d === 'gov.co') return true;
  // Government procurement portals (Colombia Compra Eficiente, SECOP, etc.)
  if (d.includes('colombiacompra') || d.includes('secop')) return true;
  return false;
}

/**
 * Returns a rejection reason if the domain cannot be an official website,
 * or null if the domain passes all guards.
 * More descriptive than isDirectoryOrThirdPartyEvidenceDomain — used in debug reports.
 */
export function getOfficialWebsiteRejectionReason(domain: string): string | null {
  if (!domain) return 'empty_domain';
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (ACADEMIC_REPOSITORY_DOMAINS.has(d)) return 'academic_repository_domain';
  if (ACADEMIC_REPOSITORY_SUBSTRINGS.some((k) => d.includes(k) || domain.toLowerCase().includes(k))) return 'academic_repository_substring';
  if (/\.edu(\.[a-z]{2})?$/.test(d)) return 'university_edu_domain';
  if (COMMERCIAL_DIRECTORY_DOMAINS.has(d)) return 'commercial_directory';
  if (DIRECTORY_SUBSTRINGS.some((k) => d.includes(k))) return 'directory_substring';
  if (REGISTRY_SUBSTRINGS.some((k) => d.includes(k))) return 'public_registry_substring';
  if (CHAMBER_OF_COMMERCE_SUBSTRINGS.some((k) => d.includes(k))) return 'chamber_of_commerce';
  if (NEWS_SUBSTRINGS.some((k) => d.includes(k))) return 'news_media_domain';
  if (SOCIAL_PERSONAL.has(d)) return 'social_network';
  if (SEARCH_ENGINES.has(d)) return 'search_engine';
  if (EMAIL_PROVIDERS.has(d)) return 'email_provider';
  return null;
}

/**
 * Returns true if the URL/domain is a strong candidate for an official company website.
 * Stricter than the classifier — used for the final guard before accepting a result.
 */
export function isOfficialWebsiteCandidate(url: string): boolean {
  const domain = extractDomainFromUrl(url);
  if (!domain) return false;
  if (isDirectoryOrThirdPartyEvidenceDomain(domain)) return false;
  // Must not be linkedin
  if (domain.includes('linkedin.com')) return false;
  // Must have at least one dot (basic sanity)
  if (!domain.includes('.')) return false;
  return true;
}

/**
 * Validates whether a website can be shown as the official website of a Chilean company.
 * Returns { valid, reason }.
 */
export function validateChileOfficialWebsite(
  url: string | null,
  companyName: string,
): { valid: boolean; reason: string } {
  if (!url) return { valid: false, reason: 'empty' };
  const domain = extractDomainFromUrl(url);
  if (!domain) return { valid: false, reason: 'invalid_url' };

  // 1. Check directory/marketplace domain list
  if (isDirectoryOrThirdPartyEvidenceDomain(domain)) {
    return { valid: false, reason: 'directory_or_third_party' };
  }

  // 2. Reject explicitly procolombia or b2bmarketplace
  if (domain.includes('procolombia.co') || domain.includes('b2bmarketplace')) {
    return { valid: false, reason: 'colombia_marketplace' };
  }

  // 3. Reject other country domains (like Colombia .co)
  if (
    domain.endsWith('.co') ||
    domain.includes('.com.co') ||
    domain.includes('.org.co') ||
    domain.includes('.gov.co')
  ) {
    return { valid: false, reason: 'other_country_domain' };
  }

  // 4. Require distinctive match with company name
  const { distinctive } = getDistinctiveCompanyTokens(companyName);
  if (distinctive.length > 0) {
    const domainLower = domain.toLowerCase();
    const hasDistinctiveMatch = distinctive.some((token) => domainLower.includes(token));
    if (!hasDistinctiveMatch) {
      return { valid: false, reason: 'no_distinctive_match' };
    }
  }

  return { valid: true, reason: 'ok' };
}

/**
 * Returns true if the evidence is sufficient to warrant calling Claude.
 *
 * 16AK.16B rules:
 * - Block if any result carries a NIT conflict and no result carries a NIT match.
 * - Block if only similar-named companies found (no entity match with name_in_title).
 * - Allow only if: official website confirmed, LinkedIn confirmed, public_evidence
 *   with high confidence + nit_match signal, or non-directory medium+ with name_in_title.
 */
export function hasMinimumEvidenceForClaude(
  webResult: WebEnrichmentResult,
  scoredResults: ScoredWebResult[],
  candidate?: CandidateBasicInfo,
): boolean {
  // ── NIT conflict gate ─────────────────────────────────────────────────────
  if (candidate?.tax_identifier) {
    const allText = scoredResults
      .map((r) => `${r.url} ${r.title} ${r.snippet ?? ''}`)
      .join(' ');
    const anyMatch = scoredResults.some((r) => {
      const t = `${r.url} ${r.title} ${r.snippet ?? ''}`;
      return hasTaxIdentifierConflict(candidate.tax_identifier, t) === 'match';
    });
    const anyConflict = scoredResults.some((r) => {
      const t = `${r.url} ${r.title} ${r.snippet ?? ''}`;
      return hasTaxIdentifierConflict(candidate.tax_identifier, t) === 'conflict';
    });
    // Conflict without any corroborating NIT match → block Claude
    if (anyConflict && !anyMatch) return false;
    void allText; // suppress unused var
  }

  if (webResult.official_website !== null) return true;
  if (webResult.linkedin_company !== null) return true;

  // Public evidence: require high confidence AND explicit NIT match signal
  if (webResult.public_evidence.length > 0) {
    const strongWithNit = webResult.public_evidence.some(
      (e) => e.confidence === 'high' && e.reason.includes('nit_match'),
    );
    if (strongWithNit) return true;
  }

  // Non-directory result with medium+ confidence AND name_in_title (not just similar company)
  const hasUsableResult = scoredResults.some(
    (r) =>
      r.source_type !== 'commercial_directory' &&
      r.source_type !== 'public_registry' &&
      r.source_type !== 'chamber_of_commerce' &&
      r.source_type !== 'unknown' &&
      r.source_type !== 'social' &&
      (r.confidence === 'high' || r.confidence === 'medium') &&
      r.matched_signals.includes('name_in_title'),
  );
  return hasUsableResult;
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

/**
 * Normalizes a company name specifically for search queries:
 * lowercased, no special chars, trimmed legal suffixes.
 * Reutilizable en 16AK.13C para scoring de entity matching.
 */
export function normalizeCompanyNameForSearch(name: string): string {
  return normalizeCompanyName(name)
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds name variants for broader matching (e.g., with/without accents,
 * abbreviations). Designed for 16AK.13C entity matching — currently used
 * only for LinkedIn name validation.
 */
export function buildCompanyNameVariants(
  name: string,
  city?: string | null,
  nit?: string | null,
): string[] {
  const normalized = normalizeCompanyNameForSearch(name);
  const noAccents = normalized
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const variants = new Set<string>([normalized, name.toLowerCase()]);
  if (noAccents !== normalized) variants.add(noAccents);

  if (city) {
    const cleanCity = city.toLowerCase().trim();
    variants.add(`${normalized} ${cleanCity}`);
    if (noAccents !== normalized) variants.add(`${noAccents} ${cleanCity}`);
  }

  if (nit) {
    const cleanNit = nit.toLowerCase().trim();
    variants.add(`${normalized} ${cleanNit}`);
    if (noAccents !== normalized) variants.add(`${noAccents} ${cleanNit}`);
  }

  // Brand/marca probable: first 2-3 words of the normalized name
  const words = normalized.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 2) {
    variants.add(words.slice(0, 2).join(' '));
    if (words.length >= 3) {
      variants.add(words.slice(0, 3).join(' '));
    }
  }

  return Array.from(variants).filter(Boolean);
}

/**
 * Scores entity match between a candidate name and text found in a result.
 * Returns 0–100. Reutilizable en 16AK.13C para deduplicación y validación.
 *
 * @param candidateName   - Company name from RUES/official source
 * @param textToMatch     - Title or snippet to match against
 */
export function scoreEntityMatch(
  candidateName: string,
  textToMatch: string,
  city?: string | null,
  nit?: string | null,
): number {
  if (!candidateName || !textToMatch) return 0;
  const variants = buildCompanyNameVariants(candidateName, city, nit);
  const text = textToMatch.toLowerCase();

  let best = 0;
  for (const variant of variants) {
    if (!variant) continue;
    // Exact match
    if (text.includes(variant)) { best = Math.max(best, 100); break; }

    // Word-level match
    const words = variant.split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) continue;
    const matched = words.filter((w) => text.includes(w));
    const ratio = matched.length / words.length;
    const wordScore = Math.round(ratio * 90);
    best = Math.max(best, wordScore);
  }
  return Math.min(best, 100);
}

/**
 * Builds search queries differentiated by intent.
 * 16AK.13B: uses only official_website and linkedin_company (2 queries max).
 * 16AK.13C roadmap: add public_evidence, company_description intents
 *   without increasing cost per candidate until latency/budget allows.
 */
export function buildSearchQueriesByIntent(
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
  linkedinParts.push('site:linkedin.com/company');
  const industryShard = industry ? industry.split(/[\/,]/)[0].trim() : '';
  if (industryShard) linkedinParts.push(industryShard);

  const publicEvidenceParts: string[] = [];
  if (normalized) publicEvidenceParts.push(`"${normalized}"`);
  if (nit) publicEvidenceParts.push(`NIT ${nit}`);
  publicEvidenceParts.push('Colombia registro directorio ciiu');

  return [
    { query: websiteParts.filter(Boolean).join(' '), intent: 'official_website', purpose: 'website' },
    { query: linkedinParts.filter(Boolean).join(' '), intent: 'linkedin_company', purpose: 'linkedin_description' },
    { query: publicEvidenceParts.filter(Boolean).join(' '), intent: 'public_evidence' },
  ];
}

/** @deprecated use buildSearchQueriesByIntent */
export function buildQueryStrategies(
  candidate: CandidateBasicInfo,
  industry: string,
): QueryStrategy[] {
  return buildSearchQueriesByIntent(candidate, industry);
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

// ─── Source classifier ────────────────────────────────────────────────────────

function classifySourceType(url: string, title: string, snippet: string | null): SourceType {
  const domain = extractDomainFromUrl(url) ?? '';
  const combined = `${url} ${title} ${snippet ?? ''}`.toLowerCase();

  // LinkedIn company page (strict: must have /company/ path)
  if (domain.includes('linkedin.com')) {
    if (url.includes('/company/')) return 'linkedin_company';
    return 'social';
  }

  // Social networks, search engines, email providers
  if (SOCIAL_PERSONAL.has(domain)) return 'social';
  if (SEARCH_ENGINES.has(domain)) return 'unknown';
  if (EMAIL_PROVIDERS.has(domain)) return 'unknown';

  // Colombian commercial directories — explicit set check first
  if (COMMERCIAL_DIRECTORY_DOMAINS.has(domain)) return 'commercial_directory';

  // Directory substrings
  if (domainMatchesList(domain, DIRECTORY_SUBSTRINGS)) return 'commercial_directory';
  if (domainMatchesList(combined, DIRECTORY_SUBSTRINGS)) return 'commercial_directory';

  // Chamber of commerce
  if (domainMatchesList(domain, CHAMBER_OF_COMMERCE_SUBSTRINGS)) return 'chamber_of_commerce';

  // Public registry (RUES, Supersociedades)
  if (domainMatchesList(domain, REGISTRY_SUBSTRINGS)) return 'public_registry';

  // Academic repositories and document platforms — treated as public_registry
  // so they flow into public_evidence, never official_website
  if (ACADEMIC_REPOSITORY_DOMAINS.has(domain)) return 'public_registry';
  if (domainMatchesList(domain, ACADEMIC_REPOSITORY_SUBSTRINGS)) return 'public_registry';
  if (/\.edu(\.[a-z]{2})?$/.test(domain)) return 'public_registry';

  // News / media
  if (domainMatchesList(domain, NEWS_SUBSTRINGS)) return 'news';

  return 'official_website';
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreResult(candidate: CandidateBasicInfo, result: RawWebResult): number {
  const name = (candidate.legal_name ?? candidate.name ?? '').trim();
  const domain = extractDomainFromUrl(result.url) ?? '';
  const combined = `${result.title} ${result.snippet ?? ''}`.toLowerCase();

  // Hard rejects
  if (EMAIL_PROVIDERS.has(domain)) return 0;
  if (SOCIAL_PERSONAL.has(domain) && !result.url.includes('/company/')) return 0;
  if (SEARCH_ENGINES.has(domain)) return 0;

  let score = 0;

  // Entity match using reusable scoreEntityMatch helper
  const titleMatchScore = scoreEntityMatch(name, result.title, candidate.city, candidate.tax_identifier);
  if (titleMatchScore >= 90) score += 35;
  else if (titleMatchScore >= 60) score += 20;
  else if (titleMatchScore >= 30) score += 8;

  // NIT / tax identifier explicit match (very strong signal)
  if (candidate.tax_identifier && combined.includes(candidate.tax_identifier)) score += 30;

  // Country
  if (combined.includes('colombia')) score += 8;

  // City
  if (candidate.city && combined.includes(candidate.city.toLowerCase())) score += 8;

  // Own domain (not a directory)
  if (!isDirectoryOrThirdPartyEvidenceDomain(domain) && domain.length > 0) score += 12;

  // Industry/sector match
  if (candidate.industry) {
    const industryWords = candidate.industry.toLowerCase().split(/[\/,\s]/).filter((w) => w.length > 3);
    if (industryWords.some((w) => combined.includes(w))) score += 5;
  }

  return Math.min(score, 100);
}

function scoreToConfidence(score: number, sourceType: SourceType): EvidenceConfidence {
  if (sourceType === 'unknown' || sourceType === 'social') return 'rejected';
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
  const name = candidate.legal_name ?? candidate.name ?? '';

  return results.map((r) => {
    const sourceType = classifySourceType(r.url, r.title, r.snippet);
    const rawScore = scoreResult(candidate, r);
    // LinkedIn gets a boost since it passed the /company/ gate
    const adjustedScore = sourceType === 'linkedin_company' ? Math.min(rawScore + 12, 100) : rawScore;
    const confidence = scoreToConfidence(adjustedScore, sourceType);

    const signals: string[] = [];
    const text = `${r.title} ${r.snippet ?? ''}`.toLowerCase();
    const fullText = `${r.url} ${r.title} ${r.snippet ?? ''}`;
    if (candidate.tax_identifier && text.includes(candidate.tax_identifier)) signals.push('nit_match');
    if (text.includes('colombia')) signals.push('country_match');
    if (candidate.city && text.includes(candidate.city.toLowerCase())) signals.push('city_match');
    if (scoreEntityMatch(name, r.title, candidate.city, candidate.tax_identifier) >= 60) signals.push('name_in_title');
    // NIT conflict/match signals using normalized extraction
    if (candidate.tax_identifier) {
      const taxCheck = hasTaxIdentifierConflict(candidate.tax_identifier, fullText);
      if (taxCheck === 'conflict') signals.push('tax_id_conflict');
      else if (taxCheck === 'match') signals.push('tax_id_match');
    }

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
    .filter((r) => !r.matched_signals.includes('tax_id_conflict'))
    .sort((a, b) => b.raw_score - a.raw_score);

  if (candidates.length === 0) return null;

  const best = candidates[0];
  const domain = extractDomainFromUrl(best.url);
  if (!domain) return null;

  // Final guard: if by any chance the classifier missed a directory domain, reject it
  if (isDirectoryOrThirdPartyEvidenceDomain(domain)) return null;

  return {
    url: best.url,
    domain,
    confidence: best.confidence,
    evidence_url: best.url,
    reason: `score=${best.raw_score} signals=[${best.matched_signals.join(',')}]`,
  };
}

/**
 * Extracts a confirmed LinkedIn company page.
 * 16AK.16B rules:
 * - Requires /company/ path + name_match >= 70.
 * - At least one distinctive token (non-generic) must appear in title/snippet/url.
 * - If only generic tokens match (e.g. "Agencia de Seguros"), the result is rejected.
 * Weak matches go to extractPossibleLinkedInMatches instead.
 */
export function extractLinkedInCompany(
  candidate: CandidateBasicInfo,
  scoredResults: ScoredWebResult[],
): LinkedInEvidence | null {
  const name = candidate.legal_name ?? candidate.name ?? '';
  const linkedInResults = scoredResults
    .filter((r) => r.source_type === 'linkedin_company')
    .filter((r) => r.confidence !== 'rejected')
    .sort((a, b) => b.raw_score - a.raw_score);

  if (linkedInResults.length === 0) return null;

  const best = linkedInResults[0];
  const nameMatchScore = scoreEntityMatch(name, `${best.title} ${best.snippet ?? ''}`, candidate.city, candidate.tax_identifier);
  if (nameMatchScore < 70) return null;

  // 16AK.16B: require at least one distinctive token to be present in the evidence
  const { distinctive } = getDistinctiveCompanyTokens(name);
  if (distinctive.length > 0) {
    const evidenceText = `${best.url} ${best.title} ${best.snippet ?? ''}`.toLowerCase();
    const hasDistinctiveMatch = distinctive.some((token) => evidenceText.includes(token));
    if (!hasDistinctiveMatch) return null;
  }

  return {
    url: best.url,
    confidence: best.confidence,
    evidence_url: best.url,
    reason: `score=${best.raw_score} name_match=${nameMatchScore} signals=[${best.matched_signals.join(',')}]`,
  };
}

/**
 * Extracts LinkedIn results that didn't pass the name match threshold for
 * "confirmed" but may still be relevant. Shown in UI as "posible · requiere revisión".
 */
export function extractPossibleLinkedInMatches(
  candidate: CandidateBasicInfo,
  scoredResults: ScoredWebResult[],
): PossibleLinkedInMatch[] {
  const name = candidate.legal_name ?? candidate.name ?? '';
  return scoredResults
    .filter((r) => r.source_type === 'linkedin_company')
    .filter((r) => r.confidence !== 'rejected')
    .filter((r) => {
      const nameMatch = scoreEntityMatch(name, `${r.title} ${r.snippet ?? ''}`, candidate.city, candidate.tax_identifier);
      return nameMatch < 70 && nameMatch >= 20; // only the ones that didn't qualify as confirmed
    })
    .sort((a, b) => b.raw_score - a.raw_score)
    .slice(0, 2)
    .map((r) => {
      const nameMatch = scoreEntityMatch(name, `${r.title} ${r.snippet ?? ''}`, candidate.city, candidate.tax_identifier);
      return {
        url: r.url,
        title: r.title,
        confidence: r.confidence,
        evidence_url: r.url,
        reason: `score=${r.raw_score} name_match=${nameMatch}`,
        match_quality: nameMatch >= 40 ? ('partial' as const) : ('weak' as const),
      };
    });
}

/** Collects directory/registry results as public evidence items (not official). */
export function extractPublicEvidence(
  scoredResults: ScoredWebResult[],
): PublicEvidenceItem[] {
  const publicSourceTypes: SourceType[] = [
    'commercial_directory', 'public_registry', 'chamber_of_commerce',
  ];
  return scoredResults
    .filter((r) => publicSourceTypes.includes(r.source_type))
    .filter((r) => r.confidence !== 'rejected')
    .sort((a, b) => b.raw_score - a.raw_score)
    .slice(0, 5)
    .map((r) => ({
      title: r.title,
      url: r.url,
      domain: extractDomainFromUrl(r.url) ?? r.url,
      source_type: r.source_type,
      confidence: r.confidence,
      reason: `score=${r.raw_score} signals=[${r.matched_signals.join(',')}]`,
    }));
}

/** Collects URLs that were classified as official_website candidates but rejected by domain guard. */
export function extractRejectedAsOfficialWebsite(
  scoredResults: ScoredWebResult[],
): RejectedWebsiteEntry[] {
  return scoredResults
    .filter((r) => r.source_type === 'official_website')
    .filter((r) => {
      const domain = extractDomainFromUrl(r.url);
      return domain ? isDirectoryOrThirdPartyEvidenceDomain(domain) : false;
    })
    .map((r) => ({
      url: r.url,
      domain: extractDomainFromUrl(r.url) ?? r.url,
      reason: 'classified_as_third_party_by_domain_guard',
    }));
}

export function buildPublicDescription(
  scoredResults: ScoredWebResult[],
): PublicDescriptionEvidence | null {
  const relevant = scoredResults
    .filter((r) => r.confidence === 'high' || r.confidence === 'medium')
    .filter((r) => r.snippet && r.snippet.length > 40)
    .filter((r) => !r.matched_signals.includes('tax_id_conflict'))
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

/**
 * Main entry point — returns the full structured web enrichment result.
 * Replaces calling individual extractors separately.
 */
export function extractWebEnrichmentResult(
  candidate: CandidateBasicInfo,
  scoredResults: ScoredWebResult[],
): WebEnrichmentResult {
  return {
    official_website: extractOfficialWebsite(scoredResults),
    linkedin_company: extractLinkedInCompany(candidate, scoredResults),
    possible_linkedin_matches: extractPossibleLinkedInMatches(candidate, scoredResults),
    public_evidence: extractPublicEvidence(scoredResults),
    rejected_as_official_website: extractRejectedAsOfficialWebsite(scoredResults),
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
