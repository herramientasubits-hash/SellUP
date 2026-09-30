/**
 * Agente 1 · Clasificador Claude — lectura de la respuesta y verificación (puro).
 *
 * Nada de lo que dice Claude se acepta sin fuente:
 *  - la URL tiene que ser la página que descargamos o una URL que devolvió su
 *    búsqueda web (lista extraída de los bloques `web_search_tool_result`);
 *  - si la fuente es nuestra página, la cita tiene que aparecer TEXTUAL en ella;
 *  - la macroindustria (y la subindustria, si viene) tiene que ser del catálogo activo;
 *  - el tamaño es siempre un rango «estimado», nunca «confirmado».
 */

import { normalizeDomain } from '../normalization';
import type { AnthropicContentBlock } from './anthropic-messages-client';
import { MIN_QUOTE_CHARS, normalizeForQuoteMatch, quoteAppearsInText } from './page-text';
import { SUBMIT_TOOL_NAME } from './prompt';
import type {
  ClassifierCatalogIndustry,
  EvidenceVerificationLevel,
  RawClassifierSubmission,
  RejectedField,
  VerifiedEmployeeRangeSuggestion,
  VerifiedSectorSuggestion,
} from './types';

/** Tope de sensatez: por encima no es un rango de empleados creíble. */
export const MAX_PLAUSIBLE_EMPLOYEES = 2_000_000;

export function extractSubmission(content: readonly AnthropicContentBlock[]): RawClassifierSubmission | null {
  const block = [...content]
    .reverse()
    .find((b) => b.type === 'tool_use' && b.name === SUBMIT_TOOL_NAME);
  if (!block || typeof block.input !== 'object' || block.input === null) return null;
  return block.input as RawClassifierSubmission;
}

/**
 * Textos citados por la búsqueda web (`web_search_result_location.cited_text`),
 * por URL. Es texto de la fuente devuelto por Anthropic, no escrito por Claude.
 */
export function extractCitedTextsByUrl(content: readonly AnthropicContentBlock[]): Map<string, string[]> {
  const byUrl = new Map<string, string[]>();
  for (const block of content) {
    if (block.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations as Array<Record<string, unknown>>) {
      if (citation?.type !== 'web_search_result_location') continue;
      if (typeof citation.url !== 'string' || typeof citation.cited_text !== 'string') continue;
      const key = canonicalUrl(citation.url);
      if (!key) continue;
      byUrl.set(key, [...(byUrl.get(key) ?? []), citation.cited_text]);
    }
  }
  return byUrl;
}

/**
 * Texto de las páginas que leyó la herramienta web_fetch de Anthropic, por URL
 * canónica. Es el texto de la fuente devuelto por Anthropic, no escrito por Claude.
 */
export function extractWebFetchTexts(content: readonly AnthropicContentBlock[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const block of content) {
    if (block.type !== 'web_fetch_tool_result') continue;
    const result = block.content as Record<string, unknown> | undefined;
    if (result?.type !== 'web_fetch_result' || typeof result.url !== 'string') continue;
    const doc = result.content as { source?: { type?: unknown; data?: unknown } } | undefined;
    if (doc?.source?.type !== 'text' || typeof doc.source.data !== 'string') continue;
    const key = canonicalUrl(result.url);
    if (key) texts.set(key, doc.source.data);
  }
  return texts;
}

export function extractSearchResultUrls(content: readonly AnthropicContentBlock[]): string[] {
  const urls = content
    .filter((b) => b.type === 'web_search_tool_result' && Array.isArray(b.content))
    .flatMap((b) => b.content as Array<Record<string, unknown>>)
    .filter((r) => r?.type === 'web_search_result' && typeof r.url === 'string')
    .map((r) => r.url as string);
  return [...new Set(urls)];
}

export function canonicalUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

type SourceContext = {
  /** URL final de la página oficial que descargamos (y sus variantes). */
  pageUrls: readonly string[];
  pageText: string;
  searchResultUrls: readonly string[];
  /** `cited_text` de la búsqueda web, indexado por `canonicalUrl`. */
  citedTextsByUrl?: ReadonlyMap<string, readonly string[]>;
  /** Texto de fuentes de búsqueda que descargamos nosotros, indexado por `canonicalUrl`. */
  fetchedSourceTexts?: ReadonlyMap<string, string>;
};

function isOfficialPageSource(sourceUrl: string, ctx: SourceContext): boolean {
  const source = canonicalUrl(sourceUrl);
  if (!source) return false;
  const pageDomains = ctx.pageUrls.map((u) => normalizeDomain(u)).filter(Boolean);
  const sourceDomain = normalizeDomain(sourceUrl);
  return ctx.pageUrls.some((u) => canonicalUrl(u) === source) || (!!sourceDomain && pageDomains.includes(sourceDomain));
}

/** Una cita de sector de menos de esto («MUNICIPALIDAD») no describe a qué se dedica. */
export const MIN_SECTOR_QUOTE_CHARS = 25;

/**
 * «Ver los 198 empleados» / «198 empleados en LinkedIn» = personas con perfil en
 * LinkedIn, siempre menos que la plantilla. No es el tamaño (Prod 30-09: 2 de 9).
 */
const LINKEDIN_MEMBER_COUNT_PATTERN =
  /\bver (?:a )?(?:los|las|todos los)?\s*[\d.,]+\s*emplead|[\d.,]+\s*emplead\w*\s+en\s+linkedin|see all [\d.,]+ employees|[\d.,]+ employees on linkedin/i;

export function isLinkedInMemberCountQuote(quote: string): boolean {
  return LINKEDIN_MEMBER_COUNT_PATTERN.test(normalizeForQuoteMatch(quote));
}

function verifySource(
  quote: string | null,
  sourceUrl: string | null,
  ctx: SourceContext,
  minQuoteChars: number = MIN_QUOTE_CHARS,
): { level: EvidenceVerificationLevel; reason: string | null } {
  if (!quote || normalizeForQuoteMatch(quote).length < minQuoteChars) {
    return { level: 'rejected', reason: 'missing_quote' };
  }
  if (!sourceUrl || !sourceUrl.trim()) return { level: 'rejected', reason: 'missing_source_url' };
  const source = canonicalUrl(sourceUrl);
  if (!source) return { level: 'rejected', reason: 'invalid_source_url' };

  const isOfficial = isOfficialPageSource(sourceUrl, ctx);
  if (isOfficial && quoteAppearsInText(quote, ctx.pageText)) {
    return { level: 'quote_verified', reason: null };
  }
  if (ctx.searchResultUrls.some((u) => canonicalUrl(u) === source)) {
    const cited = ctx.citedTextsByUrl?.get(source) ?? [];
    const fetched = ctx.fetchedSourceTexts?.get(source);
    const verified =
      cited.some((text) => quoteAppearsInText(quote, text)) || (!!fetched && quoteAppearsInText(quote, fetched));
    return { level: verified ? 'quote_verified' : 'source_listed', reason: null };
  }
  return {
    level: 'rejected',
    reason: isOfficial ? 'quote_not_found_in_official_page' : 'source_url_not_in_search_results',
  };
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
}

function matchesIndustry(
  industry: ClassifierCatalogIndustry,
  current: { id: string | null; name: string | null },
): boolean | null {
  if (current.id) return current.id === industry.industryId;
  if (current.name) return normalizeForQuoteMatch(current.name) === normalizeForQuoteMatch(industry.industryName);
  return null;
}

export type VerifiedSubmission = {
  sector: VerifiedSectorSuggestion | null;
  employeeRange: VerifiedEmployeeRangeSuggestion | null;
  rejected: RejectedField[];
  isOperatingCompany: boolean | null;
};

export function verifySubmission(
  submission: RawClassifierSubmission,
  catalog: readonly ClassifierCatalogIndustry[],
  ctx: SourceContext,
  currentIndustry: { id: string | null; name: string | null },
): VerifiedSubmission {
  const rejected: RejectedField[] = [];

  let sector: VerifiedSectorSuggestion | null = null;
  const rawSector = submission.sector;
  if (rawSector?.industry_id) {
    const industry = catalog.find((o) => o.industryId === rawSector.industry_id);
    const check = verifySource(rawSector.quote, rawSector.source_url, ctx, MIN_SECTOR_QUOTE_CHARS);
    if (!industry) {
      rejected.push({ field: 'sector', reason: 'industry_not_in_catalog' });
    } else if (check.level === 'rejected') {
      rejected.push({ field: 'sector', reason: check.reason ?? 'unverifiable' });
    } else {
      const sub = rawSector.subindustry_id
        ? industry.subindustries.find((s) => s.id === rawSector.subindustry_id) ?? null
        : null;
      if (rawSector.subindustry_id && !sub) {
        rejected.push({ field: 'subindustry', reason: 'subindustry_not_in_industry' });
      }
      sector = {
        industryId: industry.industryId,
        industryName: industry.industryName,
        subindustryId: sub?.id ?? null,
        subindustryName: sub?.name ?? null,
        matchesCurrentIndustry: matchesIndustry(industry, currentIndustry),
        quote: rawSector.quote!.trim().slice(0, 400),
        sourceUrl: rawSector.source_url!.trim(),
        confidence: clampConfidence(rawSector.confidence),
        verification: check.level,
      };
    }
  }

  let employeeRange: VerifiedEmployeeRangeSuggestion | null = null;
  const rawSize = submission.employee_range;
  if (rawSize && (rawSize.min !== null || rawSize.max !== null)) {
    const min = rawSize.min ?? null;
    const max = rawSize.max ?? null;
    const check = verifySource(rawSize.quote, rawSize.source_url, ctx);
    const validNumbers =
      min !== null &&
      Number.isInteger(min) &&
      min >= 1 &&
      min <= MAX_PLAUSIBLE_EMPLOYEES &&
      (max === null || (Number.isInteger(max) && max >= min && max <= MAX_PLAUSIBLE_EMPLOYEES));
    if (!validNumbers) {
      rejected.push({ field: 'employee_range', reason: 'invalid_range' });
    } else if (rawSize.quote && isLinkedInMemberCountQuote(rawSize.quote)) {
      rejected.push({ field: 'employee_range', reason: 'linkedin_member_count_not_company_size' });
    } else if (check.level === 'rejected') {
      rejected.push({ field: 'employee_range', reason: check.reason ?? 'unverifiable' });
    } else {
      employeeRange = {
        min,
        max,
        quote: rawSize.quote!.trim().slice(0, 400),
        sourceUrl: rawSize.source_url!.trim(),
        confidence: clampConfidence(rawSize.confidence),
        verification: check.level,
        status: 'estimated',
      };
    }
  }

  return {
    sector,
    employeeRange,
    rejected,
    isOperatingCompany: typeof submission.is_operating_company === 'boolean' ? submission.is_operating_company : null,
  };
}
