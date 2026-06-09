/**
 * Benchmark Providers — Registry (Hito 16AB.23)
 */

export { runCurrentSellUpProvider } from './current-sellup';
export { runAnthropicSearchProvider } from './anthropic-search';
export { runOpenAISearchProvider } from './openai-search';
export { runGeminiSearchProvider } from './gemini-search';

import type { BenchmarkProviderMode, BenchmarkRunOptions, ProviderRunResult } from '../types';
import type { BenchmarkRequest } from '../types';
import { runCurrentSellUpProvider } from './current-sellup';
import { runAnthropicSearchProvider } from './anthropic-search';
import { runOpenAISearchProvider } from './openai-search';
import { runGeminiSearchProvider } from './gemini-search';

export type ProviderRunner = (request: BenchmarkRequest, options?: BenchmarkRunOptions) => Promise<ProviderRunResult>;

export const PROVIDER_RUNNERS: Record<BenchmarkProviderMode, ProviderRunner> = {
  current_sellup: runCurrentSellUpProvider,
  anthropic_native_search: runAnthropicSearchProvider,
  openai_native_search: runOpenAISearchProvider,
  gemini_native_search: runGeminiSearchProvider,
};

export const ALL_MODES: BenchmarkProviderMode[] = [
  'current_sellup',
  'anthropic_native_search',
  'openai_native_search',
  'gemini_native_search',
];
