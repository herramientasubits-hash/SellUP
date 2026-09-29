/**
 * Agente 1 · Clasificador Claude — costo estimado por llamada (puro).
 *
 * Tokens: reutiliza `estimateLLMCost` (misma tabla que el evaluador LLM; la
 * tabla `ai_model_pricing` está vacía en Prod). Caché: lectura 0,1× y
 * escritura 1,25× del precio de entrada. Búsqueda web: US$10 por 1.000.
 */

import { estimateLLMCost } from '../llm-evaluator';
import type { AnthropicUsageTotals } from './anthropic-messages-client';

export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;
export const CACHE_READ_INPUT_MULTIPLIER = 0.1;
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;

export function estimateClassifierCostUsd(usage: AnthropicUsageTotals, model: string): number {
  const inputUnitCost = estimateLLMCost(1_000_000, 0, model) / 1_000_000;
  const tokens = estimateLLMCost(usage.inputTokens, usage.outputTokens, model);
  const cache =
    usage.cacheReadInputTokens * inputUnitCost * CACHE_READ_INPUT_MULTIPLIER +
    usage.cacheCreationInputTokens * inputUnitCost * CACHE_WRITE_INPUT_MULTIPLIER;
  const search = usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round((tokens + cache + search) * 1_000_000) / 1_000_000;
}
