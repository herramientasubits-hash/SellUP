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
  extractSearchResultUrls,
  extractSubmission,
  verifySubmission,
} from './evidence-verifier';
import { normalizeDomain } from '../normalization';
import { extractVisibleText } from './page-text';
import {
  SUBMIT_TOOL_DEFINITION,
  SUBMIT_TOOL_NAME,
  buildClassifierSystemPrompt,
  buildClassifierUserMessage,
  buildWebSearchTool,
} from './prompt';
import type {
  ClassificationOutcome,
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

export function buildClassifierRequestBody(
  params: ClassifyCompanyParams,
  pageUrl: string,
  pageText: string,
): AnthropicRequestBody {
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
    tools: [buildWebSearchTool(params.company.countryCode), SUBMIT_TOOL_DEFINITION],
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
  const pageText = page.html ? extractVisibleText(page.html) : '';
  const pageFinalUrl = page.finalUrl ?? page.requestedUrl;
  if (!page.html || pageText.length < MIN_PAGE_TEXT_CHARS || (page.httpStatus ?? 0) >= 400) {
    return finish({
      outcome: 'website_unreachable',
      pageFinalUrl,
      errorCode: page.error ?? (page.httpStatus ? `http_${page.httpStatus}` : 'empty_page'),
    });
  }
  // Un sitio que redirige a OTRO dominio (directorio, red social, dominio vendido)
  // no es la página oficial: no se gasta en clasificarlo.
  if (isOffsiteRedirect(website, pageFinalUrl)) {
    return finish({ outcome: 'website_redirected_offsite', pageFinalUrl, errorCode: 'redirected_offsite' });
  }

  const body = buildClassifierRequestBody(params, pageFinalUrl, pageText);
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
      usage: apiError ? toUsage(apiError.partialUsage, params.model) : null,
    });
  }

  const usage = toUsage(conversation.usage, params.model);
  const submission = extractSubmission(conversation.content);
  if (!submission) {
    return finish({ outcome: 'model_error', pageFinalUrl, usage, errorCode: 'no_submission' });
  }

  const baseCtx = {
    pageUrls: [pageFinalUrl, page.requestedUrl],
    pageText,
    searchResultUrls: extractSearchResultUrls(conversation.content),
    citedTextsByUrl: extractCitedTextsByUrl(conversation.content),
  };
  const firstPass = verifySubmission(submission, params.catalog, baseCtx, params.company.currentIndustryId);
  // Una cita de búsqueda que no pudimos comprobar: intentamos leer NOSOTROS esa fuente.
  const fetchedSourceTexts = await fetchUnverifiedSources(firstPass, deps);
  const verified =
    fetchedSourceTexts.size > 0
      ? verifySubmission(submission, params.catalog, { ...baseCtx, fetchedSourceTexts }, params.company.currentIndustryId)
      : firstPass;

  const found = Number(verified.sector !== null) + Number(verified.employeeRange !== null);
  const outcome: ClassificationOutcome =
    found === 2 ? 'classified' : found === 1 ? 'partially_classified' : 'nothing_verifiable';

  return finish({ outcome, pageFinalUrl, usage, ...verified });
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
