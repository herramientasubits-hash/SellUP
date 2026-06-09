/**
 * Benchmark Provider — Current SellUp (Baseline) (Hito 16AB.23)
 *
 * Ejecuta el pipeline actual: Tavily (web search) + Anthropic (LLM evaluator).
 * Modo dryRun=true — no escribe en Supabase ni HubSpot.
 * Actúa como baseline para comparar contra proveedores nativos.
 */

import { runIncrementalProspectingSearch } from '@/server/agents/prospecting-toolkit/incremental-search';
import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
  getSourceGuidedQueryMeta,
} from '@/server/agents/prospecting-toolkit/query-builder';
import { getTavilyApiKey } from '@/server/services/tavily-connection';
import { getAIProviderCredentialValue } from '@/server/services/ai-credentials';
import type {
  BenchmarkCandidate,
  BenchmarkError,
  BenchmarkUsage,
  ProviderRunResult,
  SearchPlan,
  BenchmarkRequest,
} from '../types';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import { noWebSearchUsageFields } from './shared';

const PROVIDER_ID = 'current_sellup' as const;
const MODEL_ID = 'claude-haiku-4-5-20251001 + tavily';

// ─── Mapeo de candidato pipeline → benchmark ─────────────────────────────────

function mapConfidence(
  qualityLabel: string,
  llmConfidence: number | null
): 'Alta' | 'Media' | 'Baja' {
  if (qualityLabel === 'high_quality_new') return 'Alta';
  if (qualityLabel === 'needs_review') {
    if (llmConfidence !== null && llmConfidence >= 0.8) return 'Alta';
    return 'Media';
  }
  return 'Baja';
}

function mapCandidate(
  c: ProspectingPipelineCandidate,
  industry: string
): BenchmarkCandidate {
  const llm = c.llmEvaluation;
  const confidence = mapConfidence(
    c.scoring.qualityLabel,
    llm?.confidence ?? null
  );

  const evidenceSnippet = llm?.evidence?.slice(0, 2).join('. ') ?? c.sourceSnippet ?? null;

  const notes: string[] = [];
  if (llm?.risk_flags?.length) {
    notes.push(`Flags: ${llm.risk_flags.join(', ')}`);
  }
  if (c.scoring.warnings?.length) {
    notes.push(c.scoring.warnings.slice(0, 2).join('. '));
  }

  return {
    name: llm?.clean_company_name ?? c.name,
    country: c.country,
    sector: `${industry}${llm ? ` / fit:${llm.sector_fit_score}/10` : ''}`,
    website: c.website ?? null,
    linkedin: null,
    city: (c.scoring.metadata?.city as string | undefined) ?? null,
    estimated_size: null,
    description: llm?.reason ?? null,
    evidence_url: c.sourceUrl ?? null,
    evidence_source: evidenceSnippet,
    confidence,
    notes: notes.join(' | ') || null,
    _quality_label: c.scoring.qualityLabel,
    _duplicate_status: c.duplicateCheck?.status ?? 'unchecked',
    _rejection_reason: c.scoring.qualityLabel === 'discard' ? (c.scoring.reasons[0] ?? undefined) : undefined,
    _queries_used: c.searchTrace?.query_text ? [c.searchTrace.query_text] : undefined,
  };
}

// ─── Construir plan de búsqueda desde query builder ──────────────────────────

function buildSearchPlan(request: BenchmarkRequest): SearchPlan {
  const r1Queries = buildCleanMultiQueryDiscoveryQueries(request.industry, request.country);
  const r2Queries = buildExpandedMultiQueryDiscoveryQueries(request.industry, request.country);
  const sourceMeta = getSourceGuidedQueryMeta(request.country, request.industry, 1);

  return {
    subsectors: ['Software B2B', 'Fintech', 'Datos y Analytics', 'Ciberseguridad', 'EdTech'],
    cities: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla'],
    queries_planned: [...r1Queries, ...r2Queries],
    sources_prioritized: sourceMeta.enabled
      ? sourceMeta.sources_used
      : ['Tavily Web Search', 'Fedesoft', 'Colombia Fintech'],
    exclusions: ['empresas cerradas', 'marcas/productos', 'duplicados internos'],
    quality_criteria: ['sitio web funcional', 'empresa real', 'sector tecnología Colombia'],
    diversification_strategy: 'Rondas 1+2 con queries geográficas y por subsector',
  };
}

// ─── Runner principal ─────────────────────────────────────────────────────────

export async function runCurrentSellUpProvider(
  request: BenchmarkRequest
): Promise<ProviderRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: BenchmarkError[] = [];

  // Verificar credenciales
  const tavilyKey = await getTavilyApiKey().catch(() => null);
  if (!tavilyKey) {
    return buildSkippedResult(request, startedAt, 'TAVILY_API_KEY no configurado');
  }

  const anthropicCred = await getAIProviderCredentialValue('anthropic');
  if (!anthropicCred.success) {
    return buildSkippedResult(request, startedAt, 'ANTHROPIC_API_KEY no configurado (requerido para LLM evaluator)');
  }

  const searchPlan = buildSearchPlan(request);

  try {
    const output = await runIncrementalProspectingSearch({
      country: request.country,
      countryCode: request.country_code,
      industry: request.industry,
      webSearchProvider: 'tavily',
      minUsefulCandidates: 7,
      targetInternal: 15,
      maxRounds: 2,
      maxTotalRawToEvaluate: 50,
      dryRun: true,
    });

    const allCandidates = output.candidates;
    const mapped = allCandidates
      .filter((c) => c.scoring.qualityLabel !== 'discard')
      .map((c) => mapCandidate(c, request.industry));

    const finalists = mapped
      .filter((c) => c._quality_label === 'high_quality_new' || c._quality_label === 'needs_review')
      .slice(0, request.requested_count);

    const rejected = allCandidates.length - finalists.length;

    const rounds = output.metadata.rounds ?? [];
    const totalSearches = rounds.reduce(
      (sum, r) => sum + (r.queriesUsed?.length ?? 0),
      0
    );

    const usage: BenchmarkUsage = {
      input_tokens: null,
      output_tokens: null,
      searches_executed: totalSearches || output.metadata.rounds_executed * 5,
      estimated_cost_usd: null,
      cost_status: 'unavailable',
      ...noWebSearchUsageFields(),
    };

    return {
      provider: PROVIDER_ID,
      model: MODEL_ID,
      status: output.metadata.stopped_reason === 'error' ? 'partial' : 'completed',
      request,
      search_plan: searchPlan,
      candidates_discovered: allCandidates.length,
      candidates_rejected: rejected,
      candidates: finalists,
      duplicate_results: [],
      diversification: null,
      usage,
      timings: {
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startMs,
      },
      errors: output.warnings.map((w) => ({ phase: 'pipeline', message: w, recoverable: true })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ phase: 'pipeline', message, recoverable: false });

    return {
      provider: PROVIDER_ID,
      model: MODEL_ID,
      status: 'error',
      request,
      search_plan: searchPlan,
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
}

function buildSkippedResult(
  request: BenchmarkRequest,
  startedAt: string,
  reason: string
): ProviderRunResult {
  return {
    provider: PROVIDER_ID,
    model: MODEL_ID,
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
