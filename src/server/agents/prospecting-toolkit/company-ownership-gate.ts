/**
 * Official Company Ownership Gate — Hito 16AB.43.30
 *
 * Evalúa si el dominio de una URL candidata pertenece oficialmente a la
 * empresa candidata (sitio propio) o si la URL es de un sitio externo
 * que menciona/describe a la empresa.
 *
 * Reglas:
 *   - El dominio debe coincidir razonablemente con el nombre de la empresa.
 *   - Si el dominio tiene marca equivalente/canónica → allowed.
 *   - Si no hay coincidencia entre nombre y dominio → blocked.
 *   - Excepciones: dominios .com.co, .com, .net, .org con señales de marca
 *     en el path también pueden ser válidos si la marca aparece en el dominio.
 *
 * Sin IA. Sin llamadas externas. Determinístico.
 */

export type CompanyOwnershipConfidence = 'high' | 'medium' | 'low' | 'reject' | 'domain_inferred';

export type CompanyOwnershipResult = {
  allowed: boolean;
  confidence: CompanyOwnershipConfidence;
  reason: string;
  candidateIdentityKey: string;
  domainIdentityKey: string;
  matchedSignals: string[];
  missingSignals: string[];
  /** v1.10: Nombre inferido desde dominio cuando el nombre detectado era un título genérico. */
  domainInferredName?: string;
  /** v1.10: Nombre original detectado por Tavily (título de página genérico). */
  originalDetectedName?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForDomain(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function extractDomainNamePart(hostname: string): string {
  const parts = hostname.replace(/^www\./, '').split('.');
  return parts[0] ?? '';
}

// ─── Known TLDs to strip for domain matching ──────────────────────────────────

const STRIP_TLDS = [
  '.com.co', '.net.co', '.org.co', '.edu.co', '.gov.co', '.mil.co',
  '.co', '.com', '.net', '.org', '.io', '.biz', '.info',
  '.es', '.mx', '.com.mx', '.cl', '.com.cl', '.pe', '.com.pe',
  '.ar', '.com.ar', '.br', '.com.br', '.ec', '.com.ec',
  '.ve', '.com.ve', '.py', '.com.py', '.uy', '.com.uy',
  '.bo', '.com.bo', '.cr',
  '.gt', '.sv', '.hn', '.ni', '.do', '.pa',
];

function stripTLD(domain: string): string {
  let stripped = domain.toLowerCase();
  const sorted = [...STRIP_TLDS].sort((a, b) => b.length - a.length);
  for (const tld of sorted) {
    if (stripped.endsWith(tld)) {
      stripped = stripped.slice(0, -tld.length);
      break;
    }
  }
  return stripped;
}

// ─── Company suffixes to remove for matching ──────────────────────────────────

const COMPANY_SUFFIXES = [
  ' sa', ' sas', ' ltda', ' e u', ' s a', ' s a s',
  ' corp', ' inc', ' llc', ' srl', ' sa de cv',
  ' colombia', ' col', ' de colombia', ' en colombia',
  ' latam', ' americas', ' global', ' international',
  ' group', ' groups', ' solutions', ' software',
  ' technologies', ' technology', ' tech',
  ' consulting', ' consultoria', ' servicios',
];

function stripCompanySuffixes(name: string): string {
  let result = name.toLowerCase();
  for (const suffix of COMPANY_SUFFIXES) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
    }
  }
  return result;
}

// ─── Known generic domain words that indicate no company ownership ────────────

const GENERIC_DOMAIN_WORDS = new Set([
  'software', 'tecnologia', 'tecnología', 'digital', 'solutions',
  'soluciones', 'servicios', 'services', 'group', 'groups',
  'global', 'latin', 'latam', 'americas', 'international',
  'consulting', 'consultora', 'consultoria', 'negocios',
  'business', 'company', 'empresa', 'corporation', 'corporativo',
  'technology', 'technologies', 'tech', 'systems', 'system',
  'sistemas', 'plataforma', 'platform', 'app', 'apps',
  'online', 'web', 'site', 'home', 'page', 'info',
  'knowledge', 'learning', 'campus', 'academy', 'instituto',
  'compania', 'compañía',
]);

// ─── Main evaluation function ─────────────────────────────────────────────────

/**
 * Evalúa si un dominio pertenece oficialmente a la empresa candidata.
 *
 * @param companyName    - Nombre de la empresa candidata
 * @param url            - URL del candidato (website o sourceUrl)
 * @param domain         - Dominio extraído (opcional, se extrae de URL si no se provee)
 */
export function evaluateCompanyOwnership(
  companyName: string,
  url: string | null,
  domain?: string | null,
): CompanyOwnershipResult {
  const candidateIdentityKey = normalizeText(companyName);
  const effectiveDomain = domain ?? (url ? extractDomain(url) : null);

  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];

  if (!effectiveDomain) {
    return {
      allowed: false,
      confidence: 'reject',
      reason: 'No domain available to evaluate ownership',
      candidateIdentityKey,
      domainIdentityKey: '',
      matchedSignals,
      missingSignals: ['domain'],
    };
  }

  const domainNamePart = extractDomainNamePart(effectiveDomain);
  const domainIdentityKey = stripTLD(effectiveDomain);
  const domainIdentityKeyClean = normalizeForDomain(domainIdentityKey);
  const nameNormalized = normalizeForDomain(companyName);
  const nameStripped = normalizeForDomain(stripCompanySuffixes(companyName));
  const nameWithoutSuffix = normalizeForDomain(stripCompanySuffixes(
    stripCompanySuffixes(stripCompanySuffixes(companyName))
  ));

  // ── 1. Exact match: domain identity key equals company name ─────────────────
  if (domainIdentityKeyClean === nameNormalized || domainIdentityKeyClean === nameStripped) {
    matchedSignals.push('exact_domain_name_match');
    return {
      allowed: true,
      confidence: 'high',
      reason: `Domain matches company name exactly (${domainIdentityKeyClean} ≈ ${nameNormalized})`,
      candidateIdentityKey,
      domainIdentityKey,
      matchedSignals,
      missingSignals,
    };
  }

  // ── 2. Domain contains company name ─────────────────────────────────────────
  if (nameStripped.length >= 3 && domainIdentityKeyClean.includes(nameStripped)) {
    matchedSignals.push('domain_contains_company_name');
    return {
      allowed: true,
      confidence: 'high',
      reason: `Domain includes company name (${domainIdentityKeyClean} contains ${nameStripped})`,
      candidateIdentityKey,
      domainIdentityKey,
      matchedSignals,
      missingSignals,
    };
  }

  // ── 3. Company name contains domain word ────────────────────────────────────
  if (domainNamePart.length >= 3 && nameNormalized.includes(domainNamePart)) {
    matchedSignals.push('company_name_contains_domain_word');
    return {
      allowed: true,
      confidence: 'medium',
      reason: `Company name contains domain root word (${nameNormalized} contains ${domainNamePart})`,
      candidateIdentityKey,
      domainIdentityKey,
      matchedSignals,
      missingSignals,
    };
  }

  // ── 4. Domain name part (first segment) matches company name ────────────────
  const nameFirstWord = nameStripped.split(/\s+/)[0] ?? '';
  if (nameFirstWord.length >= 3 && domainNamePart.includes(nameFirstWord)) {
    matchedSignals.push('domain_starts_with_company_first_word');
    return {
      allowed: true,
      confidence: 'medium',
      reason: `Domain starts with company first word (${domainNamePart} starts with ${nameFirstWord})`,
      candidateIdentityKey,
      domainIdentityKey,
      matchedSignals,
      missingSignals,
    };
  }

  // ── 5. Check if domain is a generic word that doesn't represent a company ──
  if (domainNamePart.length >= 3 && GENERIC_DOMAIN_WORDS.has(domainNamePart)) {
    matchedSignals.push('generic_domain_word');
    return {
      allowed: false,
      confidence: 'low',
      reason: `Domain root "${domainNamePart}" is a generic word, not a specific company name`,
      candidateIdentityKey,
      domainIdentityKey,
      matchedSignals,
      missingSignals: ['specific_company_name_in_domain'],
    };
  }

  // ── 6. No match found ──────────────────────────────────────────────────────
  missingSignals.push('domain_name_match');
  return {
    allowed: false,
    confidence: 'reject',
    reason: `Domain "${effectiveDomain}" does not match company name "${companyName}" (normalized: "${nameStripped}" vs "${domainIdentityKeyClean}")`,
    candidateIdentityKey,
    domainIdentityKey,
    matchedSignals,
    missingSignals,
  };
}

/**
 * True si el resultado del company ownership gate permite persistir el candidato.
 * Se permite si confidence es high o medium.
 * Se bloquea si confidence es low o reject.
 */
export function isBlockedByCompanyOwnership(result: CompanyOwnershipResult): boolean {
  return result.confidence === 'reject' || result.confidence === 'low';
}
