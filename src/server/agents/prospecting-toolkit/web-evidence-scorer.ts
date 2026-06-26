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
  // Chilean registry / tax authority — 16AK.17B
  'sii.cl', 'registrocomercial.cl', 'empresaenundia.cl',
  // Government procurement portals (Chile/LatAm) — 16AK.17D
  // These list companies as state suppliers; they are registries, not company websites.
  'todolicitaciones.', 'mercadopublico.', 'portaldelicitaciones.',
  'compraspublicas.', 'contratacionesabiertas.',
];

/**
 * Legal document portals, jurisprudence platforms, and judicial databases.
 * These provide legal filings and case data — may be public_evidence,
 * but NEVER an official company website. — 16AK.17D
 */
const LEGAL_DOCUMENT_PORTAL_SUBSTRINGS = [
  'vlex.',
  'datalux.',
  'laley.',
  'elderecho.',
  'lexisnexis.',
  'westlaw.',
  'legaltoday.',
  'tirant.',
  'derechocomercial.',
  'microjuris.',
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
  // Chilean legal/generic terms — 16AK.17B
  'spa', 'eirl', 'srl', 'corporacion', 'fundacion', 'asociacion', 'chile',
  'santiago', 'valparaiso', 'concepcion', 'antofagasta', 'temuco',
  'rancagua', 'iquique', 'talca', 'arica', 'chillan', 'osorno',
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
  geographic_coherence?: GeographicCoherenceResult;  // Added 16AK.17B
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
  country_code?: string | null;  // Added 16AK.17B — 'CL' for Chile, 'CO' for Colombia
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

// ─── Country search context — 16AK.17B ───────────────────────────────────────

export interface CountrySearchContext {
  countryTerm: string;
  taxIdLabel: string;
  officialRegistryLabel: string;
  expectedCountryCode: string;
  preferredTLDs: string[];
  foreignHints: string[];
}

export function getCountrySearchContext(candidate: CandidateBasicInfo): CountrySearchContext {
  if (candidate.country_code === 'CO') {
    return {
      countryTerm: 'Colombia',
      taxIdLabel: 'NIT',
      officialRegistryLabel: 'RUES',
      expectedCountryCode: 'CO',
      preferredTLDs: ['.com.co', '.co'],
      foreignHints: [
        'chile', 'peru', 'perú', 'argentina', 'espana', 'españa', 'italia',
        'usa', 'united states', 'estados unidos', 'mexico', 'brasil', 'brazil',
      ],
    };
  }
  if (candidate.country_code === 'MX') {
    return {
      countryTerm: 'México',
      taxIdLabel: 'RFC',
      officialRegistryLabel: 'DENUE/SAT',
      expectedCountryCode: 'MX',
      preferredTLDs: ['.com.mx', '.mx'],
      foreignHints: [
        'colombia', 'chile', 'peru', 'perú', 'argentina', 'espana', 'españa',
        'usa', 'united states', 'estados unidos', 'brasil', 'brazil',
        'germany', 'alemania', 'france', 'austria',
      ],
    };
  }
  if (candidate.country_code === 'CL') {
    return {
      countryTerm: 'Chile',
      taxIdLabel: 'RUT',
      officialRegistryLabel: 'RES Chile',
      expectedCountryCode: 'CL',
      preferredTLDs: ['.cl'],
      foreignHints: [
        'colombia', 'peru', 'perú', 'argentina', 'italia', 'suiza', 'switzerland',
        'usa', 'united states', 'estados unidos', 'mexico', 'brasil', 'brazil',
        'germany', 'alemania', 'france', 'austria',
      ],
    };
  }
  if (candidate.country_code === 'PE') {
    return {
      countryTerm: 'Perú',
      taxIdLabel: 'RUC',
      officialRegistryLabel: 'SUNAT',
      expectedCountryCode: 'PE',
      preferredTLDs: ['.com.pe', '.pe'],
      foreignHints: [
        'colombia', 'chile', 'argentina', 'espana', 'españa', 'italia',
        'usa', 'united states', 'estados unidos', 'mexico', 'brasil', 'brazil',
      ],
    };
  }
  if (candidate.country_code === 'EC') {
    return {
      countryTerm: 'Ecuador',
      taxIdLabel: 'RUC',
      officialRegistryLabel: 'SRI Ecuador',
      expectedCountryCode: 'EC',
      preferredTLDs: ['.com.ec', '.ec'],
      foreignHints: [
        'colombia', 'chile', 'peru', 'perú', 'argentina', 'espana', 'españa',
        'usa', 'united states', 'estados unidos', 'mexico', 'brasil', 'brazil',
      ],
    };
  }
  // Generic fallback: does not assume Colombia context for unknown country codes
  return {
    countryTerm: candidate.country_code ?? 'Unknown',
    taxIdLabel: 'ID',
    officialRegistryLabel: 'Official Registry',
    expectedCountryCode: candidate.country_code ?? '',
    preferredTLDs: [],
    foreignHints: [],
  };
}

export interface GeographicCoherenceResult {
  coherent: boolean;
  country_signals_found: string[];
  foreign_signals_found: string[];
  matched_city_region: boolean;
  matched_tax_id: boolean;
  matched_exact_legal_name: boolean;
  rejection_reason: string | null;
}

/**
 * Evaluates geographic coherence of a web result for a given candidate.
 * For Chile: requires .cl TLD, "Chile" in text, city/RUT match, or exact legal name.
 * Penalizes results with explicit foreign signals (foreign TLDs, foreign country mentions).
 */
export function evaluateGeographicCoherence(
  result: RawWebResult,
  candidate: CandidateBasicInfo,
  ctx: CountrySearchContext,
): GeographicCoherenceResult {
  const domain = extractDomainFromUrl(result.url) ?? '';
  const fullText = `${result.url} ${result.title} ${result.snippet ?? ''}`.toLowerCase();

  const countrySignals: string[] = [];
  const foreignSignals: string[] = [];

  // 1. Preferred TLD match
  const matchedTLD = ctx.preferredTLDs.find((tld) => domain.endsWith(tld));
  if (matchedTLD) countrySignals.push(`domain_tld:${matchedTLD}`);

  // 2. Foreign TLD detection (Chile: .co/.com.co is Colombia; European TLDs are foreign)
  if (ctx.expectedCountryCode === 'CL') {
    if (domain.endsWith('.co') || domain.includes('.com.co') || domain.includes('.gov.co')) {
      foreignSignals.push('domain_tld:.co');
    }
    const knownForeignTLDs = ['.it', '.ch', '.de', '.fr', '.at', '.es', '.us', '.uk', '.com.ar', '.com.br'];
    const foundForeignTLD = knownForeignTLDs.find((tld) => domain.endsWith(tld));
    if (foundForeignTLD) foreignSignals.push(`domain_tld:${foundForeignTLD}`);
  } else if (ctx.expectedCountryCode === 'CO') {
    if (domain.endsWith('.cl')) foreignSignals.push('domain_tld:.cl');
  }

  // 3. Country term in text
  if (fullText.includes(ctx.countryTerm.toLowerCase())) {
    countrySignals.push(`country_term:${ctx.countryTerm}`);
  }

  // 4. City/region match (accent-tolerant)
  let matchedCityRegion = false;
  if (candidate.city) {
    const cityNorm = candidate.city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const textNorm = fullText.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (fullText.includes(candidate.city.toLowerCase()) || textNorm.includes(cityNorm)) {
      countrySignals.push(`city:${candidate.city}`);
      matchedCityRegion = true;
    }
  }

  // 5. Tax ID match (RUT for Chile, NIT for Colombia)
  let matchedTaxId = false;
  if (candidate.tax_identifier) {
    const taxNorm = normalizeNIT(candidate.tax_identifier);
    if (taxNorm && taxNorm.length >= 7) {
      const textStripped = fullText.replace(/[\s.\-]/g, '');
      if (textStripped.includes(taxNorm)) {
        countrySignals.push(`tax_id:${ctx.taxIdLabel}`);
        matchedTaxId = true;
      }
    }
  }

  // 6. Exact legal name match
  const legalName = (candidate.legal_name ?? candidate.name ?? '').toLowerCase().trim();
  const matchedExactLegalName = legalName.length > 6 && fullText.includes(legalName);
  if (matchedExactLegalName) countrySignals.push('exact_legal_name');

  // 7. Foreign hint words in text
  for (const hint of ctx.foreignHints) {
    if (fullText.includes(hint)) foreignSignals.push(`text:${hint}`);
  }

  // ── Coherence decision ───────────────────────────────────────────────────
  let coherent = false;
  let rejectionReason: string | null = null;

  if (matchedTaxId || matchedExactLegalName) {
    // Strong entity signal — overrides geographic ambiguity
    coherent = true;
  } else if (countrySignals.length > 0 && foreignSignals.length === 0) {
    coherent = true;
  } else if (countrySignals.length > 0 && foreignSignals.length > 0) {
    // Mixed signals — coherent only if domain TLD or city+country term present
    const hasStrongLocal =
      matchedTLD !== undefined ||
      (matchedCityRegion && countrySignals.includes(`country_term:${ctx.countryTerm}`));
    coherent = hasStrongLocal;
    if (!coherent) rejectionReason = 'weak_country_match';
  } else if (foreignSignals.length > 0) {
    coherent = false;
    rejectionReason = 'foreign_entity_match';
  } else {
    coherent = false;
    rejectionReason = 'no_country_signal';
  }

  return {
    coherent,
    country_signals_found: countrySignals,
    foreign_signals_found: foreignSignals,
    matched_city_region: matchedCityRegion,
    matched_tax_id: matchedTaxId,
    matched_exact_legal_name: matchedExactLegalName,
    rejection_reason: rejectionReason,
  };
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
    // Normalize accents for set lookup so 'corporación' matches 'corporacion'
    const cleanNoAccents = clean.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (GENERIC_COMPANY_TOKENS.has(clean) || GENERIC_COMPANY_TOKENS.has(cleanNoAccents)) {
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
  // 16AK.17D: Legal document portals — never official website
  if (LEGAL_DOCUMENT_PORTAL_SUBSTRINGS.some((k) => d.includes(k))) return true;
  // Reject any subdomain of a university (.edu, .edu.co, .edu.mx, etc.)
  if (/\.edu(\.[a-z]{2})?$/.test(d)) return true;
  // Colombian government institutional domains (.gov.co) — always governmental, never a commercial company website
  if (/\.gov\.co$/.test(d) || d === 'gov.co') return true;
  // Chilean government domains (.gob.cl) — 16AK.17B
  if (/\.gob\.cl$/.test(d) || d === 'gob.cl') return true;
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
  // 16AK.17D: Legal document portals
  if (LEGAL_DOCUMENT_PORTAL_SUBSTRINGS.some((k) => d.includes(k))) return 'third_party_legal_or_directory_source';
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
  // ── Geographic coherence gate (Chile) — 16AK.17B ─────────────────────────
  // If ALL results lack geographic coherence for Chile, block Claude entirely.
  if (candidate?.country_code === 'CL' && scoredResults.length > 0) {
    const hasAnyCoherent = scoredResults.some((r) => r.geographic_coherence?.coherent === true);
    if (!hasAnyCoherent) return false;
  }

  // ── NIT/RUT conflict gate ─────────────────────────────────────────────────
  // Only run tax-identifier conflict check for Colombia (Chile RUT conflicts are less structured)
  if (candidate?.tax_identifier && candidate.country_code !== 'CL') {
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
 * 16AK.17B: country-aware queries — Chile uses RUT/Chile/.cl, Colombia uses NIT/Colombia/RUES.
 */
export function buildSearchQueriesByIntent(
  candidate: CandidateBasicInfo,
  industry: string,
): QueryStrategy[] {
  const name = (candidate.legal_name ?? candidate.name ?? '').trim();
  const normalized = normalizeCompanyName(name);
  const taxId = candidate.tax_identifier;
  const city = candidate.city ?? '';
  const ctx = getCountrySearchContext(candidate);

  if (ctx.expectedCountryCode === 'CL') {
    // ── Chile queries — RUT, Chile, .cl signals ───────────────────────────
    const queries: QueryStrategy[] = [];

    // Q1: name + RUT + Chile
    const q1Parts: string[] = [];
    if (name) q1Parts.push(`"${name}"`);
    if (taxId) q1Parts.push(`"${taxId}"`);
    q1Parts.push('Chile');
    queries.push({ query: q1Parts.filter(Boolean).join(' '), intent: 'official_website' });

    // Q2: name + Chile + city + sitio oficial
    const q2Parts: string[] = [];
    if (normalized) q2Parts.push(`"${normalized}"`);
    q2Parts.push('Chile');
    if (city) q2Parts.push(city);
    q2Parts.push('sitio oficial');
    queries.push({ query: q2Parts.filter(Boolean).join(' '), intent: 'official_website' });

    // Q3: LinkedIn company + Chile
    const q3Parts: string[] = [];
    if (name) q3Parts.push(`"${name}"`);
    q3Parts.push('Chile');
    if (city) q3Parts.push(city);
    q3Parts.push('site:linkedin.com/company');
    queries.push({ query: q3Parts.filter(Boolean).join(' '), intent: 'linkedin_company' });

    // Q4: public evidence — RUT label
    const q4Parts: string[] = [];
    if (normalized) q4Parts.push(`"${normalized}"`);
    if (taxId) q4Parts.push(`RUT ${taxId}`);
    q4Parts.push('Chile registro empresa');
    queries.push({ query: q4Parts.filter(Boolean).join(' '), intent: 'public_evidence' });

    // Q5: city + region + Chile (if city present)
    if (city) {
      const q5Parts: string[] = [];
      if (name) q5Parts.push(`"${name}"`);
      q5Parts.push(city);
      q5Parts.push('Chile');
      queries.push({ query: q5Parts.filter(Boolean).join(' '), intent: 'official_website' });
    }

    return queries;
  }

  // ── Colombia queries (default) — NIT, Colombia, RUES ─────────────────────
  const websiteParts: string[] = [];
  if (name) websiteParts.push(`"${name}"`);
  if (taxId) websiteParts.push(`NIT ${taxId}`);
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
  if (taxId) publicEvidenceParts.push(`NIT ${taxId}`);
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

  // 16AK.17D: Legal document portals → public_registry, never official_website
  if (domainMatchesList(domain, LEGAL_DOCUMENT_PORTAL_SUBSTRINGS)) return 'public_registry';

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

  // Country term (country-aware — 16AK.17B)
  const _ctx = getCountrySearchContext(candidate);
  if (combined.includes(_ctx.countryTerm.toLowerCase())) score += 8;

  // City
  if (candidate.city && combined.includes(candidate.city.toLowerCase())) score += 8;

  // Own domain (not a directory) — base bonus
  if (!isDirectoryOrThirdPartyEvidenceDomain(domain) && domain.length > 0) {
    score += 12;
    // 16AK.17D: Brand/distinctive token present in domain → strong ownership signal
    const { distinctive: brandTokens } = getDistinctiveCompanyTokens(name);
    if (brandTokens.length > 0 && brandTokens.some((t) => domain.toLowerCase().includes(t))) {
      score += 20;
    }
    // 16AK.17D: Root domain (no subdomain beyond www) preferred over subdomains.
    // buk.cl gets +10 over supportcenter.buk.cl.
    const parts = domain.split('.');
    const isRoot =
      parts.length === 2 ||
      (parts.length === 3 && ['com', 'org', 'net', 'gob', 'gov', 'edu'].includes(parts[1]));
    if (isRoot) score += 10;
  }

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
  const ctx = getCountrySearchContext(candidate);
  const isChile = candidate.country_code === 'CL';

  return results.map((r) => {
    const sourceType = classifySourceType(r.url, r.title, r.snippet);
    let baseScore = scoreResult(candidate, r);

    // 16AK.17B: Distinctive token check — penalize results with no match on the
    // company's distinctive tokens (prevents wrong-entity matches like
    // "Corporacion Municipal de Macul" matching "Corporacion Pedrazzini SpA").
    if (sourceType === 'official_website' || sourceType === 'linkedin_company') {
      const { distinctive } = getDistinctiveCompanyTokens(name);
      if (distinctive.length > 0) {
        const evidenceText = `${r.url} ${r.title} ${r.snippet ?? ''}`.toLowerCase();
        const hasDistinctiveMatch = distinctive.some((t) => evidenceText.includes(t));
        if (!hasDistinctiveMatch) baseScore = Math.max(0, baseScore - 30);
      }
    }

    // 16AK.17B: Geographic coherence evaluation and penalty
    const geo = evaluateGeographicCoherence(r, candidate, ctx);
    if (isChile && !geo.coherent) {
      // Heavy penalty for results with no Chilean geographic coherence
      baseScore = Math.max(0, baseScore - 50);
    }

    // LinkedIn gets a boost since it passed the /company/ gate
    const adjustedScore = sourceType === 'linkedin_company' ? Math.min(baseScore + 12, 100) : baseScore;
    const confidence = scoreToConfidence(adjustedScore, sourceType);

    const signals: string[] = [];
    const text = `${r.title} ${r.snippet ?? ''}`.toLowerCase();
    const fullText = `${r.url} ${r.title} ${r.snippet ?? ''}`;
    if (candidate.tax_identifier && text.includes(candidate.tax_identifier)) signals.push('nit_match');
    if (text.includes(ctx.countryTerm.toLowerCase())) signals.push('country_match');
    if (candidate.city && text.includes(candidate.city.toLowerCase())) signals.push('city_match');
    if (scoreEntityMatch(name, r.title, candidate.city, candidate.tax_identifier) >= 60) signals.push('name_in_title');
    // Tax ID conflict/match signals (works for both NIT and RUT)
    if (candidate.tax_identifier) {
      const taxCheck = hasTaxIdentifierConflict(candidate.tax_identifier, fullText);
      if (taxCheck === 'conflict') signals.push('tax_id_conflict');
      else if (taxCheck === 'match') signals.push('tax_id_match');
    }
    // Geographic coherence signals — 16AK.17B
    if (geo.coherent) signals.push('geo_coherent');
    else if (geo.foreign_signals_found.length > 0) signals.push('geo_foreign');
    else if (!geo.coherent) signals.push('geo_no_signal');

    return {
      ...r,
      source_type: sourceType,
      confidence,
      matched_signals: signals,
      raw_score: adjustedScore,
      geographic_coherence: geo,
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

  // 16AK.17D: iterate candidates in score order; return first that passes all checks.
  // Do NOT stop on first rejection — a high-scoring wrong company (e.g. one that merely
  // mentions our brand in its snippet) must not block the correct lower-scoring result.
  const { distinctive } = getDistinctiveCompanyTokens(name);

  for (const candidate_li of linkedInResults) {
    const nameMatchScore = scoreEntityMatch(
      name,
      `${candidate_li.title} ${candidate_li.snippet ?? ''}`,
      candidate.city,
      candidate.tax_identifier,
    );

    let verdictReason = 'confirmed_no_distinctive_tokens';
    let slugMatchFound = false;
    let titleMatchFound = false;

    if (distinctive.length > 0) {
      const slugSegment = (() => {
        const m = candidate_li.url.toLowerCase().match(/\/company\/([^/?#]+)/);
        return m ? m[1] : '';
      })();
      slugMatchFound = distinctive.some((t) => slugSegment.includes(t));
      titleMatchFound = !slugMatchFound && distinctive.some((t) => candidate_li.title.toLowerCase().includes(t));
      const snippetOnlyMatch =
        !slugMatchFound &&
        !titleMatchFound &&
        distinctive.some((t) => (candidate_li.snippet ?? '').toLowerCase().includes(t));

      if (slugMatchFound) {
        verdictReason = 'confirmed_slug_match';
      } else if (titleMatchFound) {
        verdictReason = 'confirmed_title_match';
      } else {
        // Snippet-only or no match at all → skip this candidate, try the next.
        continue;
      }
    }

    // Slug directly encodes company identity → lower threshold.
    const effectiveThreshold = slugMatchFound ? 30 : 70;
    if (nameMatchScore < effectiveThreshold) continue;

    return {
      url: candidate_li.url,
      confidence: candidate_li.confidence,
      evidence_url: candidate_li.url,
      reason: `score=${candidate_li.raw_score} name_match=${nameMatchScore} verdict=${verdictReason} signals=[${candidate_li.matched_signals.join(',')}]`,
    };
  }

  return null;
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
