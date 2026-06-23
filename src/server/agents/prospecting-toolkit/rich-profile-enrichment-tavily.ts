/**
 * Tavily Rich Profile Enrichment Provider — Agent 1 v1.16C
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
 */
export function createTavilyRichProfileEnrichmentProvider(
  maxResultsPerQuery = 3,
  transportOverride?: TavilySearchTransport,
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
      search_depth: 'basic',
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

    const city = parseCityFromResults(results);
    const sizeRange = parseSizeRangeFromResults(results);
    const description = parseDescriptionFromResults(results);

    // Best result by score
    const bestResult = results.reduce(
      (best, r) => ((r.score ?? 0) >= (best.score ?? 0) ? r : best),
      results[0],
    );

    // Confidence: higher when both fields found
    let confidence = 0;
    if (city && sizeRange) confidence = 80;
    else if (city || sizeRange) confidence = 60;
    else if (description) confidence = 30;

    // Warnings for ambiguous data
    const warnings: string[] = [];
    if (sizeRange && !city) warnings.push('size_without_city');

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
      evidence_url: bestResult.url ?? null,
      evidence_summary: bestResult.title ? bestResult.title.slice(0, 150) : undefined,
      description: description ?? undefined,
      confidence,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  };
}
