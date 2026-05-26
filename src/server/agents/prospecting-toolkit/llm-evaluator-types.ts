/**
 * LLM Evaluator — Tipos (Hito 16H)
 *
 * Contratos para el evaluador LLM de resultados Tavily.
 * Sin lógica, sin dependencias externas.
 */

// ─── Decision ─────────────────────────────────────────────────────────────────

export type LLMEvaluatorDecision = 'keep' | 'discard' | 'review';

// ─── Input ────────────────────────────────────────────────────────────────────

export type LLMEvaluatorRawInput = {
  idx: number;
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  query: string;
};

export type LLMEvaluatorModelConfig = {
  provider: string;
  model: string;
  apiKey: string;
};

export type LLMEvaluatorInput = {
  country: string;
  countryCode: string;
  industry: string;
  rawResults: LLMEvaluatorRawInput[];
  maxRawToEvaluate?: number;
  targetCount?: number;
  modelConfig?: LLMEvaluatorModelConfig;
};

// ─── Result per evaluated item ─────────────────────────────────────────────────

export type LLMEvaluatorResult = {
  idx: number;
  decision: LLMEvaluatorDecision;
  clean_company_name: string | null;
  website: string | null;
  domain: string | null;
  sector_fit_score: number;       // 0-10
  country_fit_score: number;      // 0-10
  prospectability_score: number;  // 0-10
  confidence: number;             // 0.0-1.0
  evidence: string[];
  reason: string;
  risk_flags: string[];
};

// ─── Usage / Cost ──────────────────────────────────────────────────────────────

export type LLMEvaluatorUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  evaluatedCount: number;
  costPerKeptCandidate: number;
};

// ─── Output ───────────────────────────────────────────────────────────────────

export type LLMEvaluatorOutput = {
  evaluatedResults: LLMEvaluatorResult[];
  keptResults: LLMEvaluatorResult[];
  reviewResults: LLMEvaluatorResult[];
  discardedResults: LLMEvaluatorResult[];
  topCandidates: LLMEvaluatorResult[];
  deduplicatedCount: number;
  usage: LLMEvaluatorUsage;
  warnings: string[];
};

// ─── Per-candidate metadata ────────────────────────────────────────────────────

/** Stored in candidate.metadata.llm_evaluation when evaluator was used. */
export type LLMEvaluationMetadata = {
  provider: string;
  model: string;
  decision: LLMEvaluatorDecision;
  clean_company_name: string | null;
  sector_fit_score: number;
  country_fit_score: number;
  prospectability_score: number;
  confidence: number;
  evidence: string[];
  reason: string;
  risk_flags: string[];
  evaluated_at: string;
};

// ─── Thresholds ───────────────────────────────────────────────────────────────

export type LLMEvaluatorThresholds = {
  sectorFitScore: number;
  countryFitScore: number;
  prospectabilityScore: number;
  confidence: number;
};

export const DEFAULT_LLM_EVALUATOR_THRESHOLDS: LLMEvaluatorThresholds = {
  sectorFitScore: 7,
  countryFitScore: 7,
  prospectabilityScore: 7,
  confidence: 0.75,
};

// ─── Model pricing ────────────────────────────────────────────────────────────

export type LLMModelPricing = {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
};

/**
 * Known model pricing (USD per 1M tokens).
 * Tech debt: should be read from ai_model_pricing table. Hardcoded as fallback.
 */
export const KNOWN_MODEL_PRICING: Record<string, LLMModelPricing> = {
  'claude-haiku-4-5-20251001': { inputCostPerMillion: 0.80, outputCostPerMillion: 4.00 },
  'claude-haiku-4-5':          { inputCostPerMillion: 0.80, outputCostPerMillion: 4.00 },
  'claude-sonnet-4-5':         { inputCostPerMillion: 3.00, outputCostPerMillion: 15.00 },
  'claude-sonnet-4-6':         { inputCostPerMillion: 3.00, outputCostPerMillion: 15.00 },
  'claude-opus-4-5':           { inputCostPerMillion: 15.00, outputCostPerMillion: 75.00 },
  'claude-opus-4-7':           { inputCostPerMillion: 15.00, outputCostPerMillion: 75.00 },
};
