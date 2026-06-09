/**
 * Benchmark Provider — OpenAI Native Search (Hito 16AB.23)
 *
 * Usa OpenAI Responses API con la herramienta web_search_preview.
 * El modelo planifica, busca y selecciona en un bucle agéntico.
 * No usa Tavily. No escribe en DB. No escribe en HubSpot.
 *
 * API: POST https://api.openai.com/v1/responses
 * Ref: OpenAI Responses API (2025) con web_search_preview tool
 */

import { getAIProviderCredentialValue } from '@/server/services/ai-credentials';
import {
  buildProviderSystemPrompt,
  buildProviderUserPrompt,
  parseProviderResponse,
} from '../prompt-builder';
import { normalizeBenchmarkCandidate, noWebSearchUsageFields } from './shared';
import type { BenchmarkCandidate, BenchmarkError, BenchmarkUsage, ProviderRunResult, SearchPlan } from '../types';
import type { BenchmarkRequest } from '../types';
import { BENCHMARK_LIMITS } from '../canonical-request';

const PROVIDER_ID = 'openai_native_search' as const;
const MODEL = 'gpt-4o';
const OPENAI_RESPONSES_API = 'https://api.openai.com/v1/responses';

type OpenAIResponseOutput = {
  id: string;
  object: string;
  model: string;
  output: Array<{
    type: string;
    text?: string;
    content?: Array<{ type: string; text?: string; annotations?: unknown[] }>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  status?: string;
  error?: { code: string; message: string };
};

async function callOpenAIResponses(
  apiKey: string,
  prompt: string
): Promise<OpenAIResponseOutput> {
  const res = await fetch(OPENAI_RESPONSES_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: buildProviderSystemPrompt(),
      input: prompt,
      tools: [
        {
          type: 'web_search_preview',
          search_context_size: 'medium',
        },
      ],
      max_output_tokens: 8192,
      // Limit search usage
      tool_choice: 'auto',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<OpenAIResponseOutput>;
}

function extractTextFromOutput(output: OpenAIResponseOutput['output']): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type === 'message' && item.content) {
      for (const c of item.content) {
        if (c.type === 'output_text' && c.text) {
          parts.push(c.text);
        }
      }
    } else if (item.type === 'text' && item.text) {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

function countWebSearchCalls(output: OpenAIResponseOutput['output']): number {
  return output.filter((item) => item.type === 'web_search_call').length;
}

function extractSearchPlan(parsed: ReturnType<typeof parseProviderResponse>): SearchPlan | null {
  if (!parsed?.search_plan) return null;
  const sp = parsed.search_plan as Record<string, unknown>;
  return {
    subsectors: Array.isArray(sp.subsectors) ? sp.subsectors as string[] : [],
    cities: Array.isArray(sp.cities) ? sp.cities as string[] : [],
    queries_planned: Array.isArray(sp.queries_planned) ? sp.queries_planned as string[] : [],
    sources_prioritized: Array.isArray(sp.sources_prioritized) ? sp.sources_prioritized as string[] : [],
    exclusions: Array.isArray(sp.exclusions) ? sp.exclusions as string[] : [],
    quality_criteria: Array.isArray(sp.quality_criteria) ? sp.quality_criteria as string[] : [],
    diversification_strategy: String(sp.diversification_strategy ?? ''),
  };
}

export async function runOpenAISearchProvider(
  request: BenchmarkRequest
): Promise<ProviderRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: BenchmarkError[] = [];

  const cred = await getAIProviderCredentialValue('openai');
  if (!cred.success || !cred.apiKey) {
    return buildSkippedResult(request, startedAt, 'OPENAI_API_KEY no configurado');
  }

  const apiKey = cred.apiKey;
  let resp: OpenAIResponseOutput;

  try {
    resp = await callOpenAIResponses(apiKey, buildProviderUserPrompt(request));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ phase: 'api_call', message, recoverable: false });

    return {
      provider: PROVIDER_ID,
      model: MODEL,
      status: 'error',
      request,
      search_plan: null,
      candidates_discovered: 0,
      candidates_rejected: 0,
      candidates: [],
      duplicate_results: [],
      diversification: null,
      usage: { input_tokens: null, output_tokens: null, searches_executed: 0, estimated_cost_usd: null, cost_status: 'unavailable', ...noWebSearchUsageFields() },
      timings: { started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - startMs },
      errors,
    };
  }

  const finalText = extractTextFromOutput(resp.output);
  const searchesExecuted = countWebSearchCalls(resp.output);
  const inputTokens = resp.usage?.input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;

  let parsed = parseProviderResponse(finalText);

  if (!parsed && BENCHMARK_LIMITS.max_structural_repairs > 0) {
    errors.push({ phase: 'parse', message: 'Primer parse falló — intentando reparación', recoverable: true });
    try {
      const repairResp = await callOpenAIResponses(
        apiKey,
        `${buildProviderUserPrompt(request)}\n\nIMPORTANT: Return ONLY the JSON object wrapped in <json_output>...</json_output> tags. No other text.`
      );
      parsed = parseProviderResponse(extractTextFromOutput(repairResp.output));
    } catch (repairErr) {
      errors.push({ phase: 'parse_repair', message: String(repairErr), recoverable: false });
    }
  }

  if (!parsed) {
    errors.push({ phase: 'parse', message: 'No se pudo extraer JSON de la respuesta OpenAI', recoverable: false });
  }

  const rawCandidates = Array.isArray(parsed?.candidates) ? parsed!.candidates : [];
  const searchPlan = extractSearchPlan(parsed);

  const candidates: BenchmarkCandidate[] = rawCandidates
    .slice(0, request.requested_count)
    .map((raw) => normalizeBenchmarkCandidate(raw));

  // Cost estimation: gpt-4o $2.5/M in, $10/M out + web search varies
  const estimatedCost = inputTokens > 0
    ? (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 10.0
    : null;

  const usage: BenchmarkUsage = {
    input_tokens: inputTokens || null,
    output_tokens: outputTokens || null,
    searches_executed: searchesExecuted,
    estimated_cost_usd: estimatedCost,
    cost_status: inputTokens > 0 ? 'estimated' : 'unavailable',
    ...noWebSearchUsageFields(),
  };

  return {
    provider: PROVIDER_ID,
    model: MODEL,
    status: candidates.length > 0 ? 'completed' : (errors.some((e) => !e.recoverable) ? 'error' : 'partial'),
    request,
    search_plan: searchPlan,
    candidates_discovered: parsed?.candidates_discovered ?? rawCandidates.length,
    candidates_rejected: Math.max(0, (parsed?.candidates_discovered ?? rawCandidates.length) - candidates.length),
    candidates,
    duplicate_results: [],
    diversification: null,
    usage,
    timings: { started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - startMs },
    errors,
  };
}

function buildSkippedResult(
  request: BenchmarkRequest,
  startedAt: string,
  reason: string
): ProviderRunResult {
  return {
    provider: PROVIDER_ID,
    model: MODEL,
    status: 'skipped_not_configured',
    skip_reason: reason,
    request,
    search_plan: null,
    candidates_discovered: 0,
    candidates_rejected: 0,
    candidates: [],
    duplicate_results: [],
    diversification: null,
    usage: { input_tokens: null, output_tokens: null, searches_executed: 0, estimated_cost_usd: null, cost_status: 'unavailable', ...noWebSearchUsageFields() },
    timings: { started_at: startedAt, finished_at: startedAt, duration_ms: 0 },
    errors: [],
  };
}
