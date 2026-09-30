/**
 * Agente 1 · Clasificador Claude — clasificar UNA empresa.
 *
 * 1. Descargamos NOSOTROS la página oficial (anti-SSRF, 50 KB). Si no responde → no se gasta.
 * 2. Claude lee el texto y, si falta el tamaño, busca en la web (≤2 búsquedas).
 * 3. Verificamos cada dato contra la página o contra las URLs de su búsqueda.
 *
 * Todas las dependencias con efectos (red, reloj) son inyectables.
 */

import type { SafePageFetchResult } from '../website-verifier';
import {
  AnthropicApiError,
  runAnthropicConversation,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
  type AnthropicUsageTotals,
} from './anthropic-messages-client';
import { estimateClassifierCost } from './cost';
import {
  canonicalUrl,
  extractCitedTextsByUrl,
  extractWebFetchTexts,
  extractSearchResultUrls,
  extractSubmission,
  verifySubmission,
} from './evidence-verifier';
import { normalizeDomain } from '../normalization';
import { extractLinkedInCompanyUrlsFromHtml } from '../linkedin-website-social-extractor';
import { verifyLinkedInCompany } from './linkedin-verifier';
import { extractVisibleText } from './page-text';
import {
  buildSubmitToolDefinition,
  buildWebFetchTool,
  SUBMIT_TOOL_NAME,
  buildClassifierSystemPrompt,
  buildClassifierUserMessage,
  buildWebSearchTool,
} from './prompt';
import type {
  ClassificationOutcome,
  ClassifierPageSource,
  ClassifierCatalogIndustry,
  ClassifierCompanyInput,
  ClassifierUsage,
  CompanyClassificationResult,
} from './types';

/** Menos texto que esto = página vacía o bloqueada: no vale la pena gastar. */
export const MIN_PAGE_TEXT_CHARS = 200;
export const CLASSIFIER_MAX_OUTPUT_TOKENS = 1_500;
/** Por petición; con el tope de tiempo de la corrida, cabe en 300 s de Vercel. */
export const ANTHROPIC_REQUEST_TIMEOUT_MS = 60_000;

export type ClassifyCompanyDeps = {
  fetchPage: (websiteOrDomain: string) => Promise<SafePageFetchResult>;
  runConversation: (body: AnthropicRequestBody) => Promise<AnthropicConversationResult>;
  now: () => number;
};

export type ClassifyCompanyParams = {
  company: ClassifierCompanyInput;
  catalog: readonly ClassifierCatalogIndustry[];
  /** Modelo activo en Configuración → IA. */
  model: string;
};

/**
 * `pageText === null` = no pudimos descargar la página: se habilita la lectura
 * web de Anthropic (`web_fetch`) como respaldo, sobre la URL oficial del mensaje.
 */
export function buildClassifierRequestBody(
  params: ClassifyCompanyParams,
  pageUrl: string,
  pageText: string | null,
): AnthropicRequestBody {
  const tools =
    pageText === null
      ? [buildWebFetchTool(), buildWebSearchTool(), buildSubmitToolDefinition(params.catalog)]
      : [buildWebSearchTool(), buildSubmitToolDefinition(params.catalog)];
  return {
    model: params.model,
    max_tokens: CLASSIFIER_MAX_OUTPUT_TOKENS,
    system: [
      {
        type: 'text',
        text: buildClassifierSystemPrompt(params.catalog),
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools,
    messages: [{ role: 'user', content: buildClassifierUserMessage(params.company, pageUrl, pageText) }],
  };
}

function toUsage(totals: AnthropicUsageTotals, model: string): ClassifierUsage {
  const cost = estimateClassifierCost(totals, model);
  return {
    model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    webSearchRequests: totals.webSearchRequests,
    webFetchRequests: totals.webFetchRequests,
    estimatedCostUsd: cost.usd,
    pricingSource: cost.pricingSource,
  };
}

export async function classifyCompany(
  params: ClassifyCompanyParams,
  deps: ClassifyCompanyDeps,
): Promise<CompanyClassificationResult> {
  const startedAt = deps.now();
  const base = {
    candidateId: params.company.candidateId,
    sector: null,
    employeeRange: null,
    rejected: [],
    isOperatingCompany: null,
    pageFinalUrl: null,
    usage: null,
    errorCode: null,
  } satisfies Omit<CompanyClassificationResult, 'outcome' | 'durationMs'>;
  const finish = (partial: Partial<CompanyClassificationResult> & { outcome: ClassificationOutcome }) => ({
    ...base,
    ...partial,
    durationMs: deps.now() - startedAt,
  });

  const website = params.company.websiteOrDomain?.trim();
  if (!website) return finish({ outcome: 'no_website' });

  const page = await deps.fetchPage(website);
  const ownText = page.html ? extractVisibleText(page.html) : '';
  const pageFinalUrl = page.finalUrl ?? page.requestedUrl;
  // Un sitio que redirige a OTRO dominio (directorio, red social, dominio vendido)
  // no es la página oficial: no se gasta en clasificarlo.
  if (page.html && isOffsiteRedirect(website, pageFinalUrl)) {
    return finish({ outcome: 'website_redirected_offsite', pageFinalUrl, errorCode: 'redirected_offsite' });
  }
  const ownPageUsable = !!page.html && ownText.length >= MIN_PAGE_TEXT_CHARS && (page.httpStatus ?? 0) < 400;
  const ownFetchError = ownPageUsable
    ? null
    : page.error ?? (page.httpStatus ? `http_${page.httpStatus}` : 'empty_page');
  // Sin página propia, Claude la lee con web_fetch: la URL tiene que ir en el mensaje.
  const officialUrl = ownPageUsable ? pageFinalUrl : toFetchableUrl(pageFinalUrl ?? website);

  const body = buildClassifierRequestBody(params, officialUrl, ownPageUsable ? ownText : null);
  let conversation: AnthropicConversationResult;
  try {
    conversation = await deps.runConversation(body);
    if (!extractSubmission(conversation.content) && conversation.stopReason === 'end_turn') {
      conversation = await forceSubmission(body, conversation, deps);
    }
  } catch (err) {
    const apiError = err instanceof AnthropicApiError ? err : null;
    return finish({
      outcome: 'model_error',
      pageFinalUrl,
      errorCode: apiError?.code ?? 'unexpected_error',
      errorMessage: (apiError?.message ?? (err instanceof Error ? err.message : String(err))).slice(0, 300),
      usage: apiError ? toUsage(apiError.partialUsage, params.model) : null,
    });
  }

  const usage = toUsage(conversation.usage, params.model);
  const remoteTexts = extractWebFetchTexts(conversation.content);
  const remoteOfficialText = officialTextFrom(remoteTexts, officialUrl);
  const pageText = ownPageUsable ? ownText : remoteOfficialText;
  const pageSource: ClassifierPageSource = ownPageUsable ? 'own_fetch' : pageText ? 'anthropic_web_fetch' : 'none';

  const submission = extractSubmission(conversation.content);
  if (!submission) {
    return finish({ outcome: 'model_error', pageFinalUrl, usage, pageSource, errorCode: 'no_submission' });
  }

  const baseCtx = {
    pageUrls: [officialUrl, pageFinalUrl, page.requestedUrl].filter((u): u is string => !!u),
    pageText,
    // Lo leído con web_fetch cuenta como fuente listada y su texto permite comprobar la cita.
    searchResultUrls: [...extractSearchResultUrls(conversation.content), ...remoteTexts.keys()].map(toFetchableUrl),
    citedTextsByUrl: extractCitedTextsByUrl(conversation.content),
    fetchedSourceTexts: remoteTexts,
  };
  const currentIndustry = {
    id: params.company.currentIndustryId,
    name: params.company.currentIndustryName,
  };
  const firstPass = verifySubmission(submission, params.catalog, baseCtx, currentIndustry);
  // Una cita de búsqueda que no pudimos comprobar: intentamos leer NOSOTROS esa fuente.
  const ownSourceTexts = await fetchUnverifiedSources(firstPass, deps);
  const verified =
    ownSourceTexts.size > 0
      ? verifySubmission(
          submission,
          params.catalog,
          { ...baseCtx, fetchedSourceTexts: new Map([...remoteTexts, ...ownSourceTexts]) },
          currentIndustry,
        )
      : firstPass;

  // LinkedIn: sólo con fuente (enlace en el sitio oficial o resultado de búsqueda con slug coincidente).
  const linkedinCheck = verifyLinkedInCompany({
    claimedUrl: submission.linkedin_company_url,
    officialSiteLinks: page.html ? extractLinkedInCompanyUrlsFromHtml(page.html) : [],
    searchResultUrls: extractSearchResultUrls(conversation.content),
    companyName: params.company.name,
    companyDomain: normalizeDomain(website),
    countryCode: params.company.countryCode,
  });
  const verifiedWithLinkedIn = {
    ...verified,
    linkedin: linkedinCheck.linkedin,
    rejected: linkedinCheck.rejected ? [...verified.rejected, linkedinCheck.rejected] : verified.rejected,
  };

  const found = Number(verified.sector !== null) + Number(verified.employeeRange !== null);
  // Sin página por ninguna vía y nada verificable: es el sitio, no la empresa → reintentable.
  if (found === 0 && pageSource === 'none') {
    return finish({ outcome: 'website_unreachable', pageFinalUrl, usage, pageSource, errorCode: ownFetchError, ...verifiedWithLinkedIn });
  }
  const outcome: ClassificationOutcome =
    found === 2 ? 'classified' : found === 1 ? 'partially_classified' : 'nothing_verifiable';

  return finish({ outcome, pageFinalUrl, usage, pageSource, ...verifiedWithLinkedIn });
}

/** `http://x` → `https://x`: la lectura web y la comparación de URLs usan la forma canónica. */
function toFetchableUrl(urlOrDomain: string): string {
  const trimmed = urlOrDomain.trim();
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) return `https://${trimmed.slice(7)}`;
  return `https://${trimmed}`;
}

function officialTextFrom(texts: ReadonlyMap<string, string>, officialUrl: string): string {
  const officialDomain = normalizeDomain(officialUrl);
  if (!officialDomain) return '';
  return [...texts.entries()]
    .filter(([url]) => normalizeDomain(`https://${url}`) === officialDomain)
    .map(([, text]) => text)
    .join('\n');
}

export function isOffsiteRedirect(requested: string, finalUrl: string | null): boolean {
  if (!finalUrl) return false;
  const from = normalizeDomain(requested);
  const to = normalizeDomain(finalUrl);
  return !!from && !!to && from !== to && !to.endsWith(`.${from}`) && !from.endsWith(`.${to}`);
}

/** Claude terminó sin entregar: un turno más, obligándolo a usar el tool (reusa la caché). */
async function forceSubmission(
  body: AnthropicRequestBody,
  first: AnthropicConversationResult,
  deps: ClassifyCompanyDeps,
): Promise<AnthropicConversationResult> {
  const second = await deps.runConversation({
    ...body,
    tool_choice: { type: 'tool', name: SUBMIT_TOOL_NAME },
    messages: [
      ...body.messages,
      { role: 'assistant', content: first.content },
      { role: 'user', content: `Entrega ahora tu resultado con ${SUBMIT_TOOL_NAME}. Sin fuente, deja el dato en null.` },
    ],
  });
  return {
    content: [...first.content, ...second.content],
    stopReason: second.stopReason,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
      cacheReadInputTokens: first.usage.cacheReadInputTokens + second.usage.cacheReadInputTokens,
      cacheCreationInputTokens: first.usage.cacheCreationInputTokens + second.usage.cacheCreationInputTokens,
      webSearchRequests: first.usage.webSearchRequests + second.usage.webSearchRequests,
      webFetchRequests: first.usage.webFetchRequests + second.usage.webFetchRequests,
    },
    requests: first.requests + second.requests,
  };
}

async function fetchUnverifiedSources(
  verified: ReturnType<typeof verifySubmission>,
  deps: ClassifyCompanyDeps,
): Promise<Map<string, string>> {
  const urls = [verified.sector, verified.employeeRange]
    .filter((f) => f?.verification === 'source_listed')
    .map((f) => f!.sourceUrl);
  const texts = new Map<string, string>();
  for (const url of [...new Set(urls)]) {
    const key = canonicalUrl(url);
    if (!key) continue;
    try {
      const fetched = await deps.fetchPage(url);
      if (fetched.html && (fetched.httpStatus ?? 0) < 400) texts.set(key, extractVisibleText(fetched.html));
    } catch {
      // Fuente no descargable (p. ej. LinkedIn): queda como `source_listed`.
    }
  }
  return texts;
}

/** Dependencias reales (sólo servidor). */
export function buildLiveClassifyCompanyDeps(
  apiKey: string,
  fetchPage: ClassifyCompanyDeps['fetchPage'],
): ClassifyCompanyDeps {
  return {
    fetchPage,
    runConversation: (body) => runAnthropicConversation({ apiKey, body, timeoutMs: ANTHROPIC_REQUEST_TIMEOUT_MS }),
    now: () => Date.now(),
  };
}
