/**
 * Benchmark Provider — Anthropic Native Search (Hito 16AB.23)
 *
 * Usa Anthropic Messages API con la herramienta web_search_20250305 (beta).
 * El modelo planifica, busca y selecciona en un bucle agéntico controlado.
 * No usa Tavily. No escribe en DB. No escribe en HubSpot.
 *
 * Límites: max 12 búsquedas, 1 reparación estructural.
 */

import { getAIProviderCredentialValue } from '@/server/services/ai-credentials';
import {
  buildProviderSystemPrompt,
  buildProviderUserPrompt,
  parseProviderResponse,
} from '../prompt-builder';
import { normalizeBenchmarkCandidate } from './shared';
import type { BenchmarkCandidate, BenchmarkError, BenchmarkUsage, ProviderRunResult, SearchPlan } from '../types';
import type { BenchmarkRequest } from '../types';
import { BENCHMARK_LIMITS } from '../canonical-request';

const PROVIDER_ID = 'anthropic_native_search' as const;
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicContent[] | string };
type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicResponse = {
  id: string;
  type: string;
  role: string;
  content: AnthropicContent[];
  model: string;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
};

async function callAnthropic(
  apiKey: string,
  messages: AnthropicMessage[],
  signal?: AbortSignal
): Promise<AnthropicResponse> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system: buildProviderSystemPrompt(),
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: BENCHMARK_LIMITS.max_searches_per_provider,
      }],
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<AnthropicResponse>;
}

function extractText(content: AnthropicContent[]): string {
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function countSearchCalls(messageHistory: AnthropicMessage[]): number {
  let count = 0;
  for (const msg of messageHistory) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      count += (msg.content as AnthropicContent[]).filter((c) => c.type === 'tool_use').length;
    }
  }
  return count;
}

export async function runAnthropicSearchProvider(
  request: BenchmarkRequest
): Promise<ProviderRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: BenchmarkError[] = [];

  // Verificar credencial
  const cred = await getAIProviderCredentialValue('anthropic');
  if (!cred.success || !cred.apiKey) {
    return buildSkippedResult(request, startedAt, 'ANTHROPIC_API_KEY no configurado');
  }

  const apiKey = cred.apiKey;
  const messages: AnthropicMessage[] = [{
    role: 'user',
    content: [{ type: 'text', text: buildProviderUserPrompt(request) }],
  }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalText = '';
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const resp = await callAnthropic(apiKey, messages);

      totalInputTokens += resp.usage?.input_tokens ?? 0;
      totalOutputTokens += resp.usage?.output_tokens ?? 0;

      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason !== 'tool_use') {
        finalText = extractText(resp.content);
        break;
      }

      // Execute tool calls (web search — results already embedded by Anthropic)
      // Anthropic handles the actual search internally; we just need to pass tool results
      const toolResults: AnthropicContent[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          // For web_search_20250305, the tool results are handled internally.
          // We acknowledge each tool_use with a minimal tool_result.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Search completed.',
          });
        }
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }
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
      usage: { input_tokens: totalInputTokens || null, output_tokens: totalOutputTokens || null, searches_executed: countSearchCalls(messages), estimated_cost_usd: null, cost_status: 'unavailable' },
      timings: { started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - startMs },
      errors,
    };
  }

  const searchesExecuted = countSearchCalls(messages);

  // Parse structured output
  let parsed = parseProviderResponse(finalText);

  // Attempt one repair if parse fails
  if (!parsed && BENCHMARK_LIMITS.max_structural_repairs > 0) {
    errors.push({ phase: 'parse', message: 'Primer parse falló — intentando reparación', recoverable: true });
    try {
      const repairMessages: AnthropicMessage[] = [
        ...messages,
        {
          role: 'user',
          content: [{ type: 'text', text: 'Your previous response was not valid JSON. Please repeat your answer as a single JSON object wrapped in <json_output>...</json_output> tags, with no other text.' }],
        },
      ];
      const repairResp = await callAnthropic(apiKey, repairMessages);
      totalInputTokens += repairResp.usage?.input_tokens ?? 0;
      totalOutputTokens += repairResp.usage?.output_tokens ?? 0;
      parsed = parseProviderResponse(extractText(repairResp.content));
    } catch (repairErr) {
      errors.push({ phase: 'parse_repair', message: String(repairErr), recoverable: false });
    }
  }

  if (!parsed) {
    errors.push({ phase: 'parse', message: 'No se pudo extraer JSON estructurado de la respuesta', recoverable: false });
  }

  const rawCandidates = Array.isArray(parsed?.candidates) ? parsed!.candidates : [];
  const searchPlan = extractSearchPlan(parsed);

  const candidates: BenchmarkCandidate[] = rawCandidates
    .slice(0, request.requested_count)
    .map((raw) => normalizeBenchmarkCandidate(raw));

  // Cost estimation (Sonnet: $3/M in, $15/M out + $10/1000 searches)
  const estimatedCost =
    (totalInputTokens / 1_000_000) * 3.0 +
    (totalOutputTokens / 1_000_000) * 15.0 +
    (searchesExecuted / 1000) * 10.0;

  const usage: BenchmarkUsage = {
    input_tokens: totalInputTokens || null,
    output_tokens: totalOutputTokens || null,
    searches_executed: searchesExecuted,
    estimated_cost_usd: totalInputTokens > 0 ? estimatedCost : null,
    cost_status: totalInputTokens > 0 ? 'estimated' : 'unavailable',
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
    usage: { input_tokens: null, output_tokens: null, searches_executed: 0, estimated_cost_usd: null, cost_status: 'unavailable' },
    timings: { started_at: startedAt, finished_at: startedAt, duration_ms: 0 },
    errors: [],
  };
}
