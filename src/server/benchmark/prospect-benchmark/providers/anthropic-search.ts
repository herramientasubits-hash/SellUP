/**
 * Benchmark Provider — Anthropic Native Search (Hito 16AB.23.3)
 *
 * Delegates to the multistage orchestrator.
 * Each stage is bounded by a per-call timeout — no single HTTP connection
 * exceeds 90 seconds. State is persisted in state/ under the output directory.
 *
 * Not modified: production routes, HubSpot, Supabase, cron, UI.
 */

import { getAIProviderCredentialValue } from '@/server/services/ai-credentials';
import { runMultistageProvider } from '../multistage/orchestrator';
import type { BenchmarkRequest, BenchmarkRunOptions, ProviderRunResult } from '../types';

const PROVIDER_ID = 'anthropic_native_search' as const;
const MODEL = 'claude-sonnet-4-6';

export async function runAnthropicSearchProvider(
  request: BenchmarkRequest,
  options?: BenchmarkRunOptions
): Promise<ProviderRunResult> {
  const startedAt = new Date().toISOString();

  const cred = await getAIProviderCredentialValue('anthropic');
  if (!cred.success || !cred.apiKey) {
    return buildSkippedResult(request, startedAt, 'ANTHROPIC_API_KEY no configurado');
  }

  if (!options?.outputDir) {
    return buildSkippedResult(request, startedAt, 'outputDir requerido para el proveedor multietapa (16AB.23.3)');
  }

  return runMultistageProvider(request, cred.apiKey, {
    outputDir: options.outputDir,
    resumeRunId: options.resumeRunId,
    fetchFn: options.fetchFn,
  });
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
    usage: {
      input_tokens: null,
      output_tokens: null,
      searches_executed: 0,
      estimated_cost_usd: null,
      cost_status: 'unavailable',
    },
    timings: { started_at: startedAt, finished_at: startedAt, duration_ms: 0 },
    errors: [],
  };
}
