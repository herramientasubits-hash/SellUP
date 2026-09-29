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
import { estimateClassifierCostUsd } from './cost';
import { extractSearchResultUrls, extractSubmission, verifySubmission } from './evidence-verifier';
import { extractVisibleText } from './page-text';
import {
  SUBMIT_TOOL_DEFINITION,
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
  return {
    model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    webSearchRequests: totals.webSearchRequests,
    estimatedCostUsd: estimateClassifierCostUsd(totals, model),
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

  let conversation: AnthropicConversationResult;
  try {
    conversation = await deps.runConversation(buildClassifierRequestBody(params, pageFinalUrl, pageText));
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

  const verified = verifySubmission(submission, params.catalog, {
    pageUrls: [pageFinalUrl, page.requestedUrl],
    pageText,
    searchResultUrls: extractSearchResultUrls(conversation.content),
  }, params.company.currentIndustryId);
  const found = Number(verified.sector !== null) + Number(verified.employeeRange !== null);
  const outcome: ClassificationOutcome =
    found === 2 ? 'classified' : found === 1 ? 'partially_classified' : 'nothing_verifiable';

  return finish({ outcome, pageFinalUrl, usage, ...verified });
}

/** Dependencias reales (sólo servidor). */
export function buildLiveClassifyCompanyDeps(
  apiKey: string,
  fetchPage: ClassifyCompanyDeps['fetchPage'],
): ClassifyCompanyDeps {
  return {
    fetchPage,
    runConversation: (body) => runAnthropicConversation({ apiKey, body }),
    now: () => Date.now(),
  };
}
