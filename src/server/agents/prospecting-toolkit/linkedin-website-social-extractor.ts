/**
 * LinkedIn Website Social Extractor — Hito v1.16K-R-G
 *
 * Extrae la URL de LinkedIn Company desde el sitio web oficial de un candidato.
 * Costo monetario: $0 — no usa ningún proveedor de búsqueda externo.
 * Corre para todos los candidatos con website antes de Tavily.
 *
 * Funciones puras:
 *   - extractLinkedInCompanyUrlsFromHtml: parser determinístico
 *
 * Función con I/O controlado:
 *   - extractLinkedInFromOfficialWebsite: fetch del home con timeout/size limit
 *
 * Sin scraping de páginas internas. Sin login. Sin cookies. Sin Tavily.
 * No crea provider_usage_logs. No suma costos.
 */

import { normalizeLinkedInCompanyUrl, evaluateLinkedInCompanyMatch } from './linkedin-company-enrichment';
import { buildLinkedInEnrichmentMetadata } from './linkedin-company-enrichment';
import type { LinkedInEnrichmentMetadata } from './types';

// ─── Regex extendido para subdominios regionales ───────────────────────────

// Captura linkedin.com/company/<slug> con cualquier subdominio regional (co., es., etc.)
const LINKEDIN_COMPANY_HTML_REGEX =
  /https?:\/\/(?:[a-z]{2,6}\.)?linkedin\.com\/company\/[A-Za-z0-9_%-]+(?:\/[A-Za-z0-9_%-]*)?/gi;

// Límites de fetch
const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000; // 512 KB — suficiente para footer/head sin cargar la página entera

// ─── Tipos públicos ────────────────────────────────────────────────────────

export type WebsiteLinkedInExtractionStatus = 'found' | 'not_found' | 'skipped' | 'error';

export type WebsiteLinkedInExtractionResult = {
  status: WebsiteLinkedInExtractionStatus;
  /** URL normalizada de linkedin.com/company/<slug>, o null si no found. */
  linkedInUrl: string | null;
  /** Slug extraído, o null si no found. */
  slug: string | null;
  /** Razón del skip o error, si aplica. */
  reason: string | null;
};

export type WebsiteLinkedInExtractorInput = {
  website: string;
  candidateName: string;
  candidateDomain: string | null;
  countryCode: string | null;
};

export type WebsiteExtractionBatchSummary = {
  enabled: true;
  attempted_count: number;
  found_count: number;
  not_found_count: number;
  skipped_count: number;
  error_count: number;
};

// ─── Pure helper: HTML parser ─────────────────────────────────────────────

/**
 * Extrae y deduplica URLs de LinkedIn Company desde HTML crudo.
 *
 * - Acepta linkedin.com/company/<slug> con cualquier subdominio regional.
 * - Normaliza a https://www.linkedin.com/company/<slug>.
 * - Rechaza /in/, /posts/, /jobs/, /school/, /showcase/, /search, /feed/, etc.
 *   (delegado a normalizeLinkedInCompanyUrl).
 * - Deduplica por URL normalizada.
 */
export function extractLinkedInCompanyUrlsFromHtml(html: string): string[] {
  if (!html || typeof html !== 'string') return [];

  const raw = html.match(LINKEDIN_COMPANY_HTML_REGEX) ?? [];
  const seen = new Set<string>();
  const results: string[] = [];

  for (const candidate of raw) {
    // Strip trailing slash and query params before normalizing
    const clean = candidate.replace(/[/?#].*$/, (m) => {
      // Keep /company/<slug> but drop query params and trailing slashes
      const parts = candidate.split('/');
      // Reconstruct just the company path
      const companyIdx = parts.findIndex((p) => p === 'company');
      if (companyIdx === -1) return m;
      const slug = parts[companyIdx + 1];
      if (!slug) return m;
      return '';
    });

    const result = normalizeLinkedInCompanyUrl(candidate);
    if (!result.rejected && result.normalized && !seen.has(result.normalized)) {
      seen.add(result.normalized);
      results.push(result.normalized);
    }
  }

  return results;
}

// ─── Controlled fetcher ───────────────────────────────────────────────────

/**
 * Normaliza un website input a una URL con protocolo.
 * Retorna null si no se puede normalizar.
 */
function normalizeWebsiteUrl(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProto);
    // Solo aceptar hostname válido (descarta localhost, IPs internas, etc.)
    if (!parsed.hostname.includes('.')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Selecciona la mejor URL de LinkedIn entre múltiples candidatas para el
 * candidato dado. Reutiliza evaluateLinkedInCompanyMatch para la validación.
 *
 * Retorna la URL con mayor confidence si supera umbral mínimo (40).
 */
function selectBestLinkedInFromCandidates(
  urls: string[],
  input: WebsiteLinkedInExtractorInput,
): { url: string; confidence: number } | null {
  let best: { url: string; confidence: number } | null = null;

  for (const url of urls) {
    const normalized = normalizeLinkedInCompanyUrl(url);
    if (normalized.rejected || !normalized.normalized || !normalized.slug) continue;

    const matchResult = evaluateLinkedInCompanyMatch(
      {
        candidateName: input.candidateName,
        candidateDomain: input.candidateDomain,
        countryCode: input.countryCode,
      },
      {
        url,
        normalized: normalized.normalized,
        slug: normalized.slug,
        foundIn: 'website',
      },
    );

    if (matchResult.status === 'found' && matchResult.confidence >= 40) {
      if (!best || matchResult.confidence > best.confidence) {
        best = { url: normalized.normalized, confidence: matchResult.confidence };
      }
    }
  }

  return best;
}

/**
 * Intenta extraer una URL de LinkedIn Company desde el home del sitio oficial.
 *
 * - Timeout máximo: FETCH_TIMEOUT_MS.
 * - Lee máximo MAX_HTML_BYTES del response stream.
 * - No sigue más de 3 redirects.
 * - No falla el pipeline si fetch falla — retorna status=error.
 * - No llama Tavily. No crea logs de uso.
 */
export async function extractLinkedInFromOfficialWebsite(
  input: WebsiteLinkedInExtractorInput,
): Promise<WebsiteLinkedInExtractionResult> {
  const normalizedUrl = normalizeWebsiteUrl(input.website);

  if (!normalizedUrl) {
    return { status: 'skipped', linkedInUrl: null, slug: null, reason: 'invalid_website_url' };
  }

  // Rechazar URLs que no sean HTTP/HTTPS (e.g. mailto:, javascript:)
  if (!normalizedUrl.startsWith('http')) {
    return { status: 'skipped', linkedInUrl: null, slug: null, reason: 'non_http_url' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(normalizedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SellUpBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: 'error',
        linkedInUrl: null,
        slug: null,
        reason: `http_${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return { status: 'skipped', linkedInUrl: null, slug: null, reason: 'non_html_content_type' };
    }

    // Leer solo hasta MAX_HTML_BYTES para evitar páginas masivas
    const reader = response.body?.getReader();
    if (!reader) {
      return { status: 'error', linkedInUrl: null, slug: null, reason: 'no_readable_body' };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalBytes += value.byteLength;
        if (totalBytes >= MAX_HTML_BYTES) break;
      }
    }

    // Cancel the reader to free resources
    reader.cancel().catch(() => {});

    // Decode the accumulated chunks
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const html = decoder.decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array(0)),
    );

    const foundUrls = extractLinkedInCompanyUrlsFromHtml(html);

    if (foundUrls.length === 0) {
      return { status: 'not_found', linkedInUrl: null, slug: null, reason: null };
    }

    const best = selectBestLinkedInFromCandidates(foundUrls, input);

    if (!best) {
      return {
        status: 'not_found',
        linkedInUrl: null,
        slug: null,
        reason: 'urls_found_but_no_confident_match',
      };
    }

    const normalized = normalizeLinkedInCompanyUrl(best.url);
    return {
      status: 'found',
      linkedInUrl: normalized.normalized ?? best.url,
      slug: normalized.slug,
      reason: null,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      status: 'error',
      linkedInUrl: null,
      slug: null,
      reason: isAbort ? 'timeout' : 'fetch_error',
    };
  }
}

// ─── Batch runner ─────────────────────────────────────────────────────────

export type WebsiteLinkedInBatchCandidate = {
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  currentEnrichment: LinkedInEnrichmentMetadata;
};

export type WebsiteLinkedInBatchResult = {
  /** Updated enrichment (may be same as input if not found/skipped/error). */
  enrichment: LinkedInEnrichmentMetadata;
  extractionStatus: WebsiteLinkedInExtractionStatus;
};

/**
 * Corre extracción de LinkedIn desde website para todos los candidatos elegibles.
 *
 * Candidato elegible: tiene website y su enrichment actual es not_found.
 * Corre para TODOS los candidatos elegibles, sin cap de batch.
 * No crea provider_usage_logs. No suma costo monetario.
 */
export async function runWebsiteLinkedInExtraction(
  candidates: WebsiteLinkedInBatchCandidate[],
  checkedAt: string,
): Promise<{
  results: WebsiteLinkedInBatchResult[];
  batchSummary: WebsiteExtractionBatchSummary;
}> {
  const summary: WebsiteExtractionBatchSummary = {
    enabled: true,
    attempted_count: 0,
    found_count: 0,
    not_found_count: 0,
    skipped_count: 0,
    error_count: 0,
  };

  const results: WebsiteLinkedInBatchResult[] = [];

  for (const candidate of candidates) {
    // Only run for candidates without LinkedIn yet and with a website
    if (candidate.currentEnrichment.status !== 'not_found' || !candidate.website) {
      results.push({
        enrichment: candidate.currentEnrichment,
        extractionStatus: 'skipped',
      });
      summary.skipped_count++;
      continue;
    }

    summary.attempted_count++;

    const extraction = await extractLinkedInFromOfficialWebsite({
      website: candidate.website,
      candidateName: candidate.name,
      candidateDomain: candidate.domain,
      countryCode: candidate.countryCode,
    });

    if (extraction.status === 'found' && extraction.linkedInUrl) {
      // Build enrichment through the canonical pipeline for consistent metadata shape
      const enrichment = buildLinkedInEnrichmentMetadata({
        candidateName: candidate.name,
        candidateDomain: candidate.domain,
        countryCode: candidate.countryCode,
        sourceUrl: extraction.linkedInUrl,
        source: 'website_social_link',
        checkedAt,
      });

      if (enrichment.status === 'found') {
        summary.found_count++;
        results.push({ enrichment, extractionStatus: 'found' });
      } else {
        // URL found but match validation rejected it
        summary.not_found_count++;
        results.push({ enrichment: candidate.currentEnrichment, extractionStatus: 'not_found' });
      }
    } else if (extraction.status === 'not_found') {
      summary.not_found_count++;
      results.push({ enrichment: candidate.currentEnrichment, extractionStatus: 'not_found' });
    } else if (extraction.status === 'skipped') {
      summary.skipped_count++;
      results.push({ enrichment: candidate.currentEnrichment, extractionStatus: 'skipped' });
    } else {
      // error — non-blocking
      summary.error_count++;
      results.push({ enrichment: candidate.currentEnrichment, extractionStatus: 'error' });
    }
  }

  return { results, batchSummary: summary };
}
