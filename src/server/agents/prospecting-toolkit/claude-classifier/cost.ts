/**
 * Agente 1 · Clasificador Claude — costo estimado por llamada (puro).
 *
 * La tabla `ai_model_pricing` está vacía en Prod y `KNOWN_MODEL_PRICING` del
 * evaluador sólo reconoce IDs exactos (un ID con fecha cae al precio por
 * defecto). Aquí se busca por PREFIJO de familia y, si el modelo no se conoce,
 * se usa un precio conservador (alto) y se marca `pricingSource: 'fallback'`.
 *
 * Caché: lectura 0,1× y escritura 1,25× del precio de entrada.
 * Búsqueda web: US$10 por 1.000 (no se descuenta con lotes ni caché).
 */

import type { AnthropicUsageTotals } from './anthropic-messages-client';

export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;
export const CACHE_READ_INPUT_MULTIPLIER = 0.1;
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;

type ModelPrice = { inputPerMillion: number; outputPerMillion: number };

/** Precio público por familia (USD por millón de tokens). El prefijo más largo gana. */
export const CLAUDE_MODEL_PRICES: ReadonlyArray<readonly [prefix: string, price: ModelPrice]> = [
  ['claude-haiku-4-5', { inputPerMillion: 1, outputPerMillion: 5 }],
  ['claude-3-5-haiku', { inputPerMillion: 0.8, outputPerMillion: 4 }],
  ['claude-sonnet-4', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['claude-3-5-sonnet', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['claude-opus-4-5', { inputPerMillion: 5, outputPerMillion: 25 }],
  ['claude-opus-4-6', { inputPerMillion: 5, outputPerMillion: 25 }],
  ['claude-opus-4-7', { inputPerMillion: 5, outputPerMillion: 25 }],
  ['claude-opus-4-8', { inputPerMillion: 5, outputPerMillion: 25 }],
  ['claude-opus-4-1', { inputPerMillion: 15, outputPerMillion: 75 }],
  ['claude-opus-4-2', { inputPerMillion: 15, outputPerMillion: 75 }],
];

/** Precio para un modelo que no está en la tabla: el de Sonnet (conservador para clasificar). */
export const FALLBACK_MODEL_PRICE: ModelPrice = { inputPerMillion: 3, outputPerMillion: 15 };

export function resolveModelPrice(model: string): { price: ModelPrice; source: 'table' | 'fallback' } {
  const match = [...CLAUDE_MODEL_PRICES]
    .filter(([prefix]) => model.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? { price: match[1], source: 'table' } : { price: FALLBACK_MODEL_PRICE, source: 'fallback' };
}

export function estimateClassifierCost(
  usage: AnthropicUsageTotals,
  model: string,
): { usd: number; pricingSource: 'table' | 'fallback' } {
  const { price, source } = resolveModelPrice(model);
  const inputUnit = price.inputPerMillion / 1_000_000;
  const outputUnit = price.outputPerMillion / 1_000_000;
  const usd =
    usage.inputTokens * inputUnit +
    usage.outputTokens * outputUnit +
    usage.cacheReadInputTokens * inputUnit * CACHE_READ_INPUT_MULTIPLIER +
    usage.cacheCreationInputTokens * inputUnit * CACHE_WRITE_INPUT_MULTIPLIER +
    usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  return { usd: Math.round(usd * 1_000_000) / 1_000_000, pricingSource: source };
}
