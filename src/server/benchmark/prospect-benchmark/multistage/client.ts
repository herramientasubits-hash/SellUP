/**
 * Multistage Orchestrator — Anthropic API Client (16AB.23.3)
 *
 * Wraps fetch with:
 *   - Per-call AbortController timeout (no single connection > 90s)
 *   - Exponential backoff on 429
 *   - Error classification (rate_limit / timeout / connection_terminated / etc.)
 *   - Agentic loop (model may make multiple web_search tool uses within one call)
 *
 * Injectable fetch for tests — never use real timers in tests.
 */

import { MULTISTAGE_CONFIG, COST_RATES } from './config';
import type { ApiCallResult, BatchUsage, MultistageErrorCode } from './ms-types';

// ─── Internal Anthropic types ─────────────────────────────────────────────────

type AContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AMessage = { role: 'user' | 'assistant'; content: AContent[] | string };

type AResponse = {
  id: string;
  type: string;
  role: string;
  content: AContent[];
  model: string;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
};

export type FetchFn = typeof fetch;

export type ACallOptions = {
  maxSearchUses?: number;
  timeoutMs?: number;
  systemPrompt: string;
};

// ─── Error classification ─────────────────────────────────────────────────────

export function classifyError(err: unknown): MultistageErrorCode {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('too many requests')) {
    return 'rate_limit';
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('time out')) {
    return 'timeout';
  }
  if (msg.includes('terminated') || msg.includes('aborted') || msg.includes('abort')) {
    return 'connection_terminated';
  }
  if (msg.includes('invalid') || msg.includes('parse') || msg.includes('json')) {
    return 'invalid_response';
  }
  return 'provider_error';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: AContent[]): string {
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function countToolUses(messages: AMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      n += (m.content as AContent[]).filter((c) => c.type === 'tool_use').length;
    }
  }
  return n;
}

export function estimateCost(inputTokens: number, outputTokens: number, searches: number): number {
  return (
    (inputTokens / 1_000_000) * COST_RATES.input_per_million +
    (outputTokens / 1_000_000) * COST_RATES.output_per_million +
    (searches / 1_000) * COST_RATES.search_per_thousand
  );
}

async function rawCall(
  apiKey: string,
  messages: AMessage[],
  systemPrompt: string,
  maxSearchUses: number,
  signal: AbortSignal,
  fetchFn: FetchFn
): Promise<AResponse> {
  const body: Record<string, unknown> = {
    model: MULTISTAGE_CONFIG.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  };
  if (maxSearchUses > 0) {
    body['tools'] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearchUses }];
  }

  const res = await fetchFn(MULTISTAGE_CONFIG.anthropic_api, {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
    (err as Error & { _status: number })._status = res.status;
    throw err;
  }

  return res.json() as Promise<AResponse>;
}

// ─── One agentic turn (may span multiple messages for tool use) ───────────────

export async function callAgentic(
  apiKey: string,
  userPrompt: string,
  opts: ACallOptions,
  fetchFn: FetchFn = fetch
): Promise<ApiCallResult<string>> {
  const {
    maxSearchUses = 0,
    timeoutMs = MULTISTAGE_CONFIG.per_call_timeout_ms,
    systemPrompt,
  } = opts;

  const startMs = Date.now();
  const messages: AMessage[] = [
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let finalText = '';
  let iterations = 0;
  const MAX_ITER = 12;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (iterations < MAX_ITER) {
      iterations++;

      const resp = await rawCall(apiKey, messages, systemPrompt, maxSearchUses, controller.signal, fetchFn);

      totalInput += resp.usage?.input_tokens ?? 0;
      totalOutput += resp.usage?.output_tokens ?? 0;
      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason !== 'tool_use') {
        finalText = extractText(resp.content);
        break;
      }

      // Acknowledge tool uses (web_search_20250305 handles results server-side)
      const acks: AContent[] = resp.content
        .filter((c) => c.type === 'tool_use')
        .map((c) => ({
          type: 'tool_result' as const,
          tool_use_id: (c as { type: 'tool_use'; id: string }).id,
          content: 'Search completed.',
        }));
      if (acks.length > 0) {
        messages.push({ role: 'user', content: acks });
      }
    }
  } catch (err) {
    clearTimeout(timer);
    const errorCode = classifyError(err);
    const searches = countToolUses(messages);
    const usage: BatchUsage = {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      search_calls: searches,
      cost_usd: estimateCost(totalInput, totalOutput, searches),
    };
    return {
      data: null,
      usage,
      errorCode,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }

  clearTimeout(timer);
  const searches = countToolUses(messages);
  const usage: BatchUsage = {
    input_tokens: totalInput,
    output_tokens: totalOutput,
    search_calls: searches,
    cost_usd: estimateCost(totalInput, totalOutput, searches),
  };

  return {
    data: finalText || null,
    usage,
    errorCode: finalText ? null : 'invalid_response',
    errorMessage: finalText ? null : 'No text content in response',
    durationMs: Date.now() - startMs,
  };
}

// ─── Retry wrapper (exponential backoff on 429) ───────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RetryResult = ApiCallResult<string> & { retried: boolean };

export async function callWithRetry(
  apiKey: string,
  userPrompt: string,
  opts: ACallOptions,
  onRateLimitWait?: (ms: number) => void,
  fetchFn: FetchFn = fetch,
  sleepFn: (ms: number) => Promise<void> = sleep
): Promise<RetryResult> {
  let last: ApiCallResult<string> | null = null;
  let retried = false;

  for (let attempt = 0; attempt <= MULTISTAGE_CONFIG.max_retries_per_call; attempt++) {
    if (attempt > 0) {
      retried = true;
      const waitMs = Math.min(MULTISTAGE_CONFIG.backoff_base_ms * Math.pow(2, attempt - 1), 60_000);
      onRateLimitWait?.(waitMs);
      await sleepFn(waitMs);
    }

    const result = await callAgentic(apiKey, userPrompt, opts, fetchFn);
    last = result;

    // Only retry on rate limit
    if (result.errorCode !== 'rate_limit') break;
  }

  return { ...last!, retried };
}
