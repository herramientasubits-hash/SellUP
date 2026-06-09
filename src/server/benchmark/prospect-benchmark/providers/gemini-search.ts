/**
 * Benchmark Provider — Gemini Native Search (Hito 16AB.23)
 *
 * Usa Gemini API con Google Search Grounding.
 * El modelo genera respuesta apoyada en búsquedas reales de Google.
 * No usa Tavily. No escribe en DB. No escribe en HubSpot.
 *
 * API: generativelanguage.googleapis.com
 * Tool: google_search (grounding)
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

const PROVIDER_ID = 'gemini_native_search' as const;
const MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type GeminiContent = {
  role: string;
  parts: Array<{ text: string }>;
};

type GeminiGroundingChunk = {
  web?: { uri: string; title: string };
};

type GeminiResponse = {
  candidates?: Array<{
    content: {
      parts: Array<{ text?: string }>;
      role: string;
    };
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
      groundingSupports?: unknown[];
      webSearchQueries?: string[];
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: { code: number; message: string; status: string };
};

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<GeminiResponse> {
  const endpoint = `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        } as GeminiContent,
      ],
      tools: [
        { google_search: {} },
      ],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<GeminiResponse>;
}

function extractTextFromGemini(resp: GeminiResponse): string {
  const candidate = resp.candidates?.[0];
  if (!candidate) return '';
  return candidate.content.parts
    .filter((p) => p.text)
    .map((p) => p.text!)
    .join('\n');
}

function extractGroundingSources(resp: GeminiResponse): string[] {
  const candidate = resp.candidates?.[0];
  if (!candidate?.groundingMetadata) return [];
  const chunks = candidate.groundingMetadata.groundingChunks ?? [];
  return chunks
    .filter((c) => c.web?.uri)
    .map((c) => c.web!.uri);
}

function extractWebSearchQueries(resp: GeminiResponse): string[] {
  const candidate = resp.candidates?.[0];
  return candidate?.groundingMetadata?.webSearchQueries ?? [];
}

function extractSearchPlan(
  parsed: ReturnType<typeof parseProviderResponse>,
  webSearchQueries: string[]
): SearchPlan | null {
  if (!parsed?.search_plan && webSearchQueries.length === 0) return null;
  const sp = (parsed?.search_plan ?? {}) as Record<string, unknown>;
  return {
    subsectors: Array.isArray(sp.subsectors) ? sp.subsectors as string[] : [],
    cities: Array.isArray(sp.cities) ? sp.cities as string[] : [],
    queries_planned: Array.isArray(sp.queries_planned)
      ? sp.queries_planned as string[]
      : webSearchQueries,
    sources_prioritized: Array.isArray(sp.sources_prioritized)
      ? sp.sources_prioritized as string[]
      : ['Google Search Grounding'],
    exclusions: Array.isArray(sp.exclusions) ? sp.exclusions as string[] : [],
    quality_criteria: Array.isArray(sp.quality_criteria) ? sp.quality_criteria as string[] : [],
    diversification_strategy: String(sp.diversification_strategy ?? ''),
  };
}

export async function runGeminiSearchProvider(
  request: BenchmarkRequest
): Promise<ProviderRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: BenchmarkError[] = [];

  const cred = await getAIProviderCredentialValue('google');
  if (!cred.success || !cred.apiKey) {
    return buildSkippedResult(request, startedAt, 'GEMINI_API_KEY no configurado');
  }

  const apiKey = cred.apiKey;
  let resp: GeminiResponse;

  try {
    resp = await callGemini(
      apiKey,
      buildProviderSystemPrompt(),
      buildProviderUserPrompt(request)
    );
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
      usage: { input_tokens: null, output_tokens: null, searches_executed: 0, estimated_cost_usd: null, cost_status: 'unavailable' },
      timings: { started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - startMs },
      errors,
    };
  }

  if (resp.error) {
    errors.push({ phase: 'api_call', message: `${resp.error.status}: ${resp.error.message}`, recoverable: false });
    return buildErrorResult(request, startedAt, Date.now() - startMs, errors);
  }

  const finalText = extractTextFromGemini(resp);
  const webSearchQueries = extractWebSearchQueries(resp);
  const groundingSources = extractGroundingSources(resp);
  const searchesExecuted = webSearchQueries.length;

  let parsed = parseProviderResponse(finalText);

  if (!parsed && BENCHMARK_LIMITS.max_structural_repairs > 0) {
    errors.push({ phase: 'parse', message: 'Primer parse falló — intentando reparación', recoverable: true });
    try {
      const repairResp = await callGemini(
        apiKey,
        buildProviderSystemPrompt(),
        `${buildProviderUserPrompt(request)}\n\nIMPORTANT: Return ONLY the JSON object wrapped in <json_output>...</json_output> tags.`
      );
      parsed = parseProviderResponse(extractTextFromGemini(repairResp));
    } catch (repairErr) {
      errors.push({ phase: 'parse_repair', message: String(repairErr), recoverable: false });
    }
  }

  if (!parsed) {
    errors.push({ phase: 'parse', message: 'No se pudo extraer JSON de la respuesta Gemini', recoverable: false });
  }

  const rawCandidates = Array.isArray(parsed?.candidates) ? parsed!.candidates : [];
  const searchPlan = extractSearchPlan(parsed, webSearchQueries);

  // Enrich evidence_url with grounding sources when missing
  const candidates: BenchmarkCandidate[] = rawCandidates
    .slice(0, request.requested_count)
    .map((raw, idx) => {
      const c = normalizeBenchmarkCandidate(raw);
      if (!c.evidence_url && groundingSources[idx]) {
        c.evidence_url = groundingSources[idx];
      }
      return c;
    });

  const inputTokens = resp.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = resp.usageMetadata?.candidatesTokenCount ?? 0;

  // Gemini 2.0 Flash pricing: ~$0.075/M in, $0.30/M out (very cheap)
  const estimatedCost = inputTokens > 0
    ? (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.30
    : null;

  const usage: BenchmarkUsage = {
    input_tokens: inputTokens || null,
    output_tokens: outputTokens || null,
    searches_executed: searchesExecuted,
    estimated_cost_usd: estimatedCost,
    cost_status: inputTokens > 0 ? 'estimated' : 'unavailable',
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
    usage: { input_tokens: null, output_tokens: null, searches_executed: 0, estimated_cost_usd: null, cost_status: 'unavailable' },
    timings: { started_at: startedAt, finished_at: startedAt, duration_ms: 0 },
    errors: [],
  };
}

function buildErrorResult(
  request: BenchmarkRequest,
  startedAt: string,
  durationMs: number,
  errors: BenchmarkError[]
): ProviderRunResult {
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
    usage: { input_tokens: null, output_tokens: null, searches_executed: 0, estimated_cost_usd: null, cost_status: 'unavailable' },
    timings: { started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: durationMs },
    errors,
  };
}
