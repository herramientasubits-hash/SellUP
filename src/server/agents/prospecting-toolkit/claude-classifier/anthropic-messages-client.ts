/**
 * Agente 1 · Clasificador Claude — cliente mínimo de la Messages API.
 *
 * Mismo estilo que `llm-evaluator.ts` (fetch directo, sin SDK). `fetchImpl` es
 * inyectable: los tests NUNCA salen a la red.
 */

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/** Continuaciones máximas cuando el servidor pausa el turno (`pause_turn`). */
export const MAX_PAUSE_TURN_CONTINUATIONS = 2;

export type AnthropicContentBlock = { type: string; [key: string]: unknown };

export type AnthropicUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
};

export type AnthropicConversationResult = {
  /** Bloques de contenido de TODAS las respuestas del asistente, en orden. */
  content: AnthropicContentBlock[];
  stopReason: string | null;
  usage: AnthropicUsageTotals;
  requests: number;
};

export type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  system: unknown;
  tools: unknown[];
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
};

export class AnthropicApiError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly code: string,
    message: string,
    public readonly partialUsage: AnthropicUsageTotals,
  ) {
    super(message);
    this.name = 'AnthropicApiError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function addUsage(acc: AnthropicUsageTotals, raw: unknown): AnthropicUsageTotals {
  const usage = (raw ?? {}) as Record<string, unknown>;
  const serverToolUse = (usage.server_tool_use ?? {}) as Record<string, unknown>;
  return {
    inputTokens: acc.inputTokens + num(usage.input_tokens),
    outputTokens: acc.outputTokens + num(usage.output_tokens),
    cacheReadInputTokens: acc.cacheReadInputTokens + num(usage.cache_read_input_tokens),
    cacheCreationInputTokens: acc.cacheCreationInputTokens + num(usage.cache_creation_input_tokens),
    webSearchRequests: acc.webSearchRequests + num(serverToolUse.web_search_requests),
  };
}

export const EMPTY_USAGE: AnthropicUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
};

export async function runAnthropicConversation(params: {
  apiKey: string;
  body: AnthropicRequestBody;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<AnthropicConversationResult> {
  const fetchImpl = params.fetchImpl ?? (fetch as FetchLike);
  const timeoutMs = params.timeoutMs ?? 90_000;
  let messages = params.body.messages;
  let usage = EMPTY_USAGE;
  let content: AnthropicContentBlock[] = [];
  let stopReason: string | null = null;
  let requests = 0;

  for (let attempt = 0; attempt <= MAX_PAUSE_TURN_CONTINUATIONS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': params.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({ ...params.body, messages }),
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new AnthropicApiError(null, isAbort ? 'timeout' : 'network_error', String(err), usage);
    } finally {
      clearTimeout(timer);
    }
    requests += 1;

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const code = response.status === 429 ? 'rate_limited' : `http_${response.status}`;
      throw new AnthropicApiError(response.status, code, bodyText.slice(0, 300), usage);
    }

    const data = (await response.json()) as {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
      usage?: unknown;
    };
    const turnContent = Array.isArray(data.content) ? data.content : [];
    usage = addUsage(usage, data.usage);
    content = [...content, ...turnContent];
    stopReason = data.stop_reason ?? null;

    if (stopReason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: turnContent }];
  }

  return { content, stopReason, usage, requests };
}
