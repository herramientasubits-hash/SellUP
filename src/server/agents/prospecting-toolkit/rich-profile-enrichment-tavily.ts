/**
 * Tavily Rich Profile Enrichment Provider — Agent 1 v1.16G
 *
 * Provider real para enriquecimiento de rich_profile vía Tavily Basic Search.
 *
 * REGLAS:
 * - search_depth = 'basic' siempre.
 * - max_results default 3.
 * - NO scraping. NO extracción LinkedIn. NO LLM. NO retries agresivos.
 * - NO imprimir API key. NO exponer secretos.
 * - Solo devuelve datos con evidencia textual explícita.
 * - NO inventa ciudad, tamaño, empleados, país, relación contractual.
 * - Transport inyectable para tests — en producción usa fetch real.
 * - Quality gate: degrada careers/jobs/dev/staging; prioriza official/about pages.
 */

import type {
  RichProfileEnrichmentProviderFn,
  RichProfileEnrichmentProviderResult,
  RichProfileEnrichmentCandidate,
} from './rich-profile-enrichment';

// ─── Transport types ──────────────────────────────────────────────────────────

export type TavilySearchOpts = {
  api_key: string;
  query: string;
  search_depth: 'basic' | 'advanced';
  max_results: number;
  include_domains?: string[];
};

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type TavilySearchResponse = {
  query: string;
  results: TavilySearchResult[];
  error?: string;
};

/** Transport inyectable. En producción usa fetch. En tests usa mock. */
export type TavilySearchTransport = (opts: TavilySearchOpts) => Promise<TavilySearchResponse>;

// ─── Real transport ───────────────────────────────────────────────────────────

async function defaultTavilyTransport(opts: TavilySearchOpts): Promise<TavilySearchResponse> {
  const { api_key, ...body } = opts;
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`tavily_http_error_${response.status}`);
  }

  return response.json() as Promise<TavilySearchResponse>;
}

// ─── Result quality gate — v1.16G ────────────────────────────────────────────

export type RichProfileResultQualityTier = 'strong' | 'medium' | 'weak' | 'blocked';

export type RichProfileResultQualityAssessment = {
  quality: RichProfileResultQualityTier;
  score: number;
  reasons: string[];
  warnings: string[];
};

const OFFICIAL_FIRST_SEGMENTS = new Set([
  'about', 'about-us', 'about_us', 'aboutus',
  'company', 'company-profile', 'our-company',
  'who-we-are', 'nosotros', 'nuestra-empresa', 'quienes-somos', 'quien-somos',
  'corporate', 'profile', 'overview', 'our-story', 'perfil', 'perfil-empresa',
  'acerca', 'acerca-de', 'conocenos',
]);

const CAREER_PATH_SEGMENTS = new Set([
  'careers', 'career', 'jobs', 'job', 'hiring', 'join-us',
  'vacantes', 'vacancies', 'vacancy', 'empleo', 'empleos',
  'trabaja', 'openings', 'recruitment', 'recruiting', 'reclutamiento',
  'work-with-us', 'trabaja-con-nosotros',
]);

const CONTENT_PATH_SEGMENTS = new Set([
  'blog', 'news', 'noticias', 'press', 'media', 'articles', 'article',
  'academy', 'learning', 'resources', 'recursos', 'insights', 'research',
  'events', 'event', 'webinar', 'post', 'posts',
]);

const BLOCKED_PATH_SEGMENTS = new Set([
  'login', 'auth', 'signin', 'sign-in', 'signup', 'sign-up',
  'oauth', 'register', 'registration', 'sso',
]);

const BLOCKED_SUBDOMAIN_NAMES = new Set([
  'dev', 'staging', 'test', 'testing', 'local', 'uat', 'qa',
  'sandbox', 'demo', 'preview', 'beta', 'alpha', 'preprod', 'pre',
]);

/**
 * Evalúa la calidad de un resultado de Tavily para rich profile enrichment.
 * Función pura — no hace llamadas externas.
 *
 * Tiers:
 *   strong  — official page (/about, /about-us, root) en dominio correcto
 *   medium  — secondary page en dominio correcto, o LinkedIn company page
 *   weak    — careers/blog/content page; datos no confiables para city/size
 *   blocked — dev/staging subdomain, login/auth page, dominio no relacionado
 */
export function evaluateRichProfileResultQuality(
  result: TavilySearchResult,
  candidate: RichProfileEnrichmentCandidate,
): RichProfileResultQualityAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];

  let hostname: string;
  let pathname: string;
  try {
    const parsed = new URL(result.url);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return { quality: 'blocked', score: 0, reasons: ['invalid_url'], warnings: [] };
  }

  const hostWithoutWww = hostname.replace(/^www\./, '');
  const candidateDomain = candidate.domain
    ? candidate.domain.toLowerCase().replace(/^www\./, '')
    : null;

  // ── Domain analysis ────────────────────────────────────────────────────
  const isSameDomain = !!(
    candidateDomain &&
    (hostWithoutWww === candidateDomain || hostWithoutWww.endsWith('.' + candidateDomain))
  );

  // Detect blocked subdomain when same domain
  let isBlockedSubdomain = false;
  if (isSameDomain && candidateDomain) {
    const subdomainPart =
      hostWithoutWww === candidateDomain
        ? ''
        : hostWithoutWww.slice(0, hostWithoutWww.length - candidateDomain.length - 1);
    if (subdomainPart) {
      const subParts = subdomainPart.split('.');
      const blockedPart = subParts.find((p) => BLOCKED_SUBDOMAIN_NAMES.has(p));
      if (blockedPart) {
        isBlockedSubdomain = true;
        warnings.push(`blocked_subdomain:${subdomainPart}`);
      }
    }
  }

  // Also detect blocked subdomains even without candidateDomain
  if (!isBlockedSubdomain) {
    const hostParts = hostWithoutWww.split('.');
    if (hostParts.length >= 2 && BLOCKED_SUBDOMAIN_NAMES.has(hostParts[0])) {
      isBlockedSubdomain = true;
      warnings.push(`blocked_subdomain:${hostParts[0]}`);
    }
  }

  const isLinkedIn = hostname.includes('linkedin.com') && pathname.includes('/company');
  const isUnrelatedDomain = !isSameDomain && !isLinkedIn;

  // ── Path analysis ──────────────────────────────────────────────────────
  const pathSegments = pathname.split('/').filter(Boolean);
  const firstSegment = pathSegments[0] ?? '';

  const hasBlockedPath = pathSegments.some((s) => BLOCKED_PATH_SEGMENTS.has(s));
  const isCareerPath = pathSegments.some((s) => CAREER_PATH_SEGMENTS.has(s));
  const isContentPath = pathSegments.some((s) => CONTENT_PATH_SEGMENTS.has(s));
  const isRootPage = pathSegments.length === 0;
  // Official path: first segment is official AND no career segment anywhere in path
  const isOfficialPath = (OFFICIAL_FIRST_SEGMENTS.has(firstSegment) || isRootPage) && !isCareerPath;

  // ── Blocked gate ───────────────────────────────────────────────────────
  if (isBlockedSubdomain) {
    reasons.push('dev_or_staging_subdomain');
    warnings.push('blocked_subdomain_result');
    return { quality: 'blocked', score: 5, reasons, warnings };
  }

  if (hasBlockedPath) {
    reasons.push('login_or_auth_path');
    return { quality: 'blocked', score: 0, reasons, warnings };
  }

  if (isUnrelatedDomain) {
    reasons.push('unrelated_domain');
    return { quality: 'blocked', score: 0, reasons, warnings };
  }

  // ── Score calculation ──────────────────────────────────────────────────
  let score: number;

  if (isLinkedIn) {
    score = 60;
    reasons.push('linkedin_company_page');
  } else if (isSameDomain && isOfficialPath) {
    score = isRootPage ? 78 : 85;
    reasons.push(isRootPage ? 'official_domain_root' : 'official_domain_official_path');
  } else if (isSameDomain && isCareerPath) {
    score = 15;
    reasons.push('official_domain_careers_path');
    warnings.push('careers_page');
  } else if (isSameDomain && isContentPath) {
    score = 22;
    reasons.push('official_domain_content_path');
  } else if (isSameDomain) {
    score = 55;
    reasons.push('official_domain_secondary_path');
  } else {
    score = 0;
    reasons.push('unknown_domain');
  }

  // Snippet signals boost
  const text = `${result.title ?? ''} ${result.content ?? ''}`;
  if (/headquarter|headquarters|\bHQ\b|sede\b|sede principal/i.test(text)) {
    score = Math.min(100, score + 8);
    reasons.push('hq_signal_in_snippet');
  }
  if (/\bemployees?\b|\bempleados?\b|\bcompany size\b|\bworkforce\b/i.test(text)) {
    score = Math.min(100, score + 5);
    reasons.push('employee_signal_in_snippet');
  }

  // ── Quality tier ───────────────────────────────────────────────────────
  let quality: RichProfileResultQualityTier;
  if (score >= 75) {
    quality = 'strong';
  } else if (score >= 45) {
    quality = 'medium';
  } else {
    quality = 'weak';
  }

  return { quality, score, reasons, warnings };
}

/**
 * Selecciona el mejor resultado de Tavily para rich profile enrichment.
 * Prioriza: strong > medium > weak > blocked, desempate por score.
 * Devuelve null solo si results es vacío.
 */
export function selectBestRichProfileResult(
  results: TavilySearchResult[],
  candidate: RichProfileEnrichmentCandidate,
): { result: TavilySearchResult; assessment: RichProfileResultQualityAssessment } | null {
  if (results.length === 0) return null;

  const QUALITY_ORDER: Record<RichProfileResultQualityTier, number> = {
    strong: 3, medium: 2, weak: 1, blocked: 0,
  };

  const assessed = results.map((r) => ({
    result: r,
    assessment: evaluateRichProfileResultQuality(r, candidate),
  }));

  const nonBlocked = assessed.filter((a) => a.assessment.quality !== 'blocked');
  const pool = nonBlocked.length > 0 ? nonBlocked : assessed;

  return pool.reduce((best, curr) => {
    const bestOrder = QUALITY_ORDER[best.assessment.quality];
    const currOrder = QUALITY_ORDER[curr.assessment.quality];
    if (currOrder > bestOrder) return curr;
    if (currOrder < bestOrder) return best;
    return curr.assessment.score >= best.assessment.score ? curr : best;
  });
}

// ─── Standard employee ranges ─────────────────────────────────────────────────

const STANDARD_SIZE_RANGES = [
  '1-10', '11-50', '51-200', '201-500', '501-1000',
  '1001-5000', '5001-10000', '10001+',
] as const;

function normalizeToSizeRange(low: number, high: number): string | null {
  const effective = Math.max(low, high);
  if (effective <= 0) return null;
  if (effective <= 10) return '1-10';
  if (effective <= 50) return '11-50';
  if (effective <= 200) return '51-200';
  if (effective <= 500) return '201-500';
  if (effective <= 1000) return '501-1000';
  if (effective <= 5000) return '1001-5000';
  if (effective <= 10000) return '5001-10000';
  return '10001+';
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Extrae ciudad explícita de snippets/títulos.
 * Solo extrae si hay evidencia de HQ/sede/headquarters — NO inventa.
 */
function parseCityFromResults(results: TavilySearchResult[]): string | null {
  const hqPatterns = [
    /headquartered?\s+in\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]{1,29}?)(?:[,.\s(]|$)/i,
    /headquarters?\s+(?:in|at|located in|based in)\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]{1,29}?)(?:[,.\s(]|$)/i,
    /\bHQ\s+(?:in|at)\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]{1,29}?)(?:[,.\s(]|$)/i,
    /sede\s+(?:en|principal\s+en)\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]{1,29}?)(?:[,.\s(]|$)/i,
    /oficina\s+principal\s+en\s+([A-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]{1,29}?)(?:[,.\s(]|$)/i,
  ];

  for (const result of results) {
    const text = `${result.title} ${result.content}`;
    for (const pattern of hqPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const city = match[1].trim().replace(/\s+/g, ' ');
        if (city.length >= 2 && city.length <= 50) {
          return city;
        }
      }
    }
  }

  return null;
}

/**
 * Extrae size_range explícito de snippets/títulos.
 * Solo extrae si hay evidencia numérica de empleados — NO infiere de adjetivos.
 */
function parseSizeRangeFromResults(results: TavilySearchResult[]): string | null {
  for (const result of results) {
    const text = `${result.title} ${result.content}`;

    // 1. Exact LinkedIn standard range
    // Use negative lookaround: not preceded/followed by digit to avoid partial matches.
    // Note: "10001+" ends with '+' (non-word char), so \b won't work after '+'.
    for (const range of STANDARD_SIZE_RANGES) {
      const escaped = range.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<!\\d)${escaped}(?!\\d)`).test(text)) {
        return range;
      }
    }

    // 2. "200-500 employees" or "200 to 500 employees"
    const rangeEmployeeMatch = text.match(
      /(\d{1,5})\s*[-–—]\s*(\d{1,5})\s*(?:employees?|empleados?|workers?|staff)\b/i,
    );
    if (rangeEmployeeMatch) {
      const low = parseInt(rangeEmployeeMatch[1], 10);
      const high = parseInt(rangeEmployeeMatch[2], 10);
      const normalized = normalizeToSizeRange(low, high);
      if (normalized) return normalized;
    }

    // 3. "employees: 200-500"
    const labelRangeMatch = text.match(
      /(?:employees?|empleados?|company size|workforce|staff)\s*[:=]\s*(\d{1,5})\s*[-–—]\s*(\d{1,5})/i,
    );
    if (labelRangeMatch) {
      const low = parseInt(labelRangeMatch[1], 10);
      const high = parseInt(labelRangeMatch[2], 10);
      const normalized = normalizeToSizeRange(low, high);
      if (normalized) return normalized;
    }

    // 4. "1,234 employees" (single number)
    const singleCountMatch = text.match(
      /\b(\d{1,3}(?:,\d{3})+|\d{3,5})\s*(?:employees?|empleados?|workers?|staff)\b/i,
    );
    if (singleCountMatch) {
      const count = parseInt(singleCountMatch[1].replace(/,/g, ''), 10);
      if (count > 0) {
        const normalized = normalizeToSizeRange(count, count);
        if (normalized) return normalized;
      }
    }
  }

  return null;
}

/**
 * Extrae descripción corta desde snippet/título. Máximo 280 caracteres.
 */
function parseDescriptionFromResults(results: TavilySearchResult[]): string | null {
  for (const result of results) {
    if (result.content && result.content.trim().length > 20) {
      return result.content.trim().slice(0, 280);
    }
    if (result.title && result.title.trim().length > 10) {
      return result.title.trim().slice(0, 280);
    }
  }
  return null;
}

function extractIncludeDomains(candidate: RichProfileEnrichmentCandidate): string[] | undefined {
  if (candidate.domain) return [candidate.domain];
  return undefined;
}

// ─── Provider factory ─────────────────────────────────────────────────────────

/**
 * Crea un Tavily provider real para rich_profile_enrichment.
 *
 * @param maxResultsPerQuery - Máximo de resultados por query (default 3).
 * @param transportOverride - Transport inyectable para tests. Omitir en producción.
 * @param searchDepth - Profundidad de búsqueda Tavily (default 'basic'). Usar 'advanced' con autorización explícita.
 */
export function createTavilyRichProfileEnrichmentProvider(
  maxResultsPerQuery = 3,
  transportOverride?: TavilySearchTransport,
  searchDepth: 'basic' | 'advanced' = 'basic',
): RichProfileEnrichmentProviderFn {
  const transport = transportOverride ?? defaultTavilyTransport;

  return async (
    candidate: RichProfileEnrichmentCandidate,
    query: string,
  ): Promise<RichProfileEnrichmentProviderResult> => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return { status: 'failed', warnings: ['tavily_api_key_not_configured'] };
    }

    const searchOpts: TavilySearchOpts = {
      api_key: apiKey,
      query,
      search_depth: searchDepth,
      max_results: maxResultsPerQuery,
      ...(() => {
        const domains = extractIncludeDomains(candidate);
        return domains ? { include_domains: domains } : {};
      })(),
    };

    let response: TavilySearchResponse;
    try {
      response = await transport(searchOpts);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'transport_error';
      const sanitized = raw.replace(/tvly-[A-Za-z0-9_-]{10,}/g, '[REDACTED]').slice(0, 200);
      return { status: 'failed', warnings: [sanitized] };
    }

    if (response.error) {
      const sanitized = response.error
        .replace(/tvly-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
        .slice(0, 200);
      return { status: 'failed', warnings: [sanitized] };
    }

    const results = response.results ?? [];

    if (results.length === 0) {
      return {
        status: 'not_found',
        city: null,
        hq_country: null,
        size_range: null,
        evidence_url: null,
        confidence: null,
      };
    }

    // ── Quality gate v1.16G ────────────────────────────────────────────────
    const selection = selectBestRichProfileResult(results, candidate);
    if (!selection) {
      return {
        status: 'not_found',
        city: null,
        hq_country: null,
        size_range: null,
        evidence_url: null,
        confidence: null,
      };
    }

    const { result: selectedResult, assessment: selectedAssessment } = selection;

    // Data extraction only from strong/medium results — careers/dev/staging don't
    // provide reliable city or size evidence.
    const highQualityResults = results.filter((r) => {
      const a = evaluateRichProfileResultQuality(r, candidate);
      return a.quality === 'strong' || a.quality === 'medium';
    });

    const city = parseCityFromResults(highQualityResults);
    const sizeRange = parseSizeRangeFromResults(highQualityResults);

    // Description can come from any non-blocked result
    const nonBlockedResults = results.filter((r) => {
      const a = evaluateRichProfileResultQuality(r, candidate);
      return a.quality !== 'blocked';
    });
    const description = parseDescriptionFromResults(
      nonBlockedResults.length > 0 ? nonBlockedResults : results,
    );

    // Evidence URL only when result is not blocked
    const evidenceUrl =
      selectedAssessment.quality !== 'blocked' ? (selectedResult.url ?? null) : null;

    // Confidence: higher when both fields found
    let confidence = 0;
    if (city && sizeRange) confidence = 80;
    else if (city || sizeRange) confidence = 60;
    else if (description) confidence = 30;

    // Warnings
    const warnings: string[] = [];
    if (sizeRange && !city) warnings.push('size_without_city');

    if (selectedAssessment.quality === 'weak') {
      for (const w of selectedAssessment.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
      warnings.push('weak_result_selected');
    } else if (selectedAssessment.quality === 'blocked') {
      for (const w of selectedAssessment.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
      warnings.push('only_blocked_results_available');
    }

    // Status determination
    const hasBothData = city !== null && sizeRange !== null;
    const hasSomeData = city !== null || sizeRange !== null;

    const status: RichProfileEnrichmentProviderResult['status'] = hasBothData
      ? 'found'
      : hasSomeData
        ? 'partial'
        : 'not_found';

    return {
      status,
      city,
      size_range: sizeRange,
      hq_country: null,
      evidence_url: evidenceUrl,
      evidence_summary:
        selectedAssessment.quality !== 'blocked' && selectedResult.title
          ? selectedResult.title.slice(0, 150)
          : undefined,
      description: description ?? undefined,
      confidence,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  };
}
