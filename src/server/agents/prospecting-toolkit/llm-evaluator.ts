/**
 * LLM Evaluator — Core (Hito 16H)
 *
 * Evalúa resultados crudos de Tavily usando LLM (Anthropic).
 *
 * Contrato:
 * - No escribe en DB.
 * - No llama Tavily.
 * - No inventa URLs, dominios ni nombres de empresa.
 * - No aprueba candidatos automáticamente.
 * - No imprime API keys.
 * - Falla con LLMEvaluatorNotConfiguredError si no hay credencial.
 * - Falla con LLMEvaluatorParseError si el LLM retorna JSON inválido.
 *
 * Flujo principal (evaluateTavilyResultsWithLLM):
 *   1. Carga API key desde Vault via getAiProviderCredential('anthropic')
 *   2. Construye prompt con evidencia de cada resultado Tavily
 *   3. Llama Anthropic Messages API
 *   4. Parsea respuesta JSON estrictamente
 *   5. Aplica thresholds (keep+bajo_threshold → review)
 *   6. Deduplica por dominio + nombre normalizado
 *   7. Selecciona top N por score compuesto
 *   8. Retorna output con usage/costo estimado
 */

import { normalizeCompanyName, normalizeDomain } from './normalization';
import { buildLLMEvaluatorPrompt } from './llm-evaluator-prompts';
import {
  DEFAULT_LLM_EVALUATOR_THRESHOLDS,
  KNOWN_MODEL_PRICING,
  type LLMEvaluatorInput,
  type LLMEvaluatorOutput,
  type LLMEvaluatorResult,
  type LLMEvaluatorThresholds,
  type LLMEvaluationMetadata,
  type LLMEvaluatorUsage,
} from './llm-evaluator-types';
import { getAiProviderCredential } from '../../services/ai-connection';

// ─── Constants ────────────────────────────────────────────────────────────────

// Tech debt: model hardcoded as fallback. Validated in Hito 16G.
// Replace with ai_active_config DB read when pipeline-to-DB config bridge is built.
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const FALLBACK_PROVIDER = 'anthropic';
const DEFAULT_MAX_RAW = 30;
const DEFAULT_TARGET_COUNT = 10;

// ─── Custom errors ────────────────────────────────────────────────────────────

export class LLMEvaluatorNotConfiguredError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'LLM evaluator not configured: no credential found for provider "anthropic". ' +
        'Configure the Anthropic provider in AI Settings before using the LLM evaluator.'
    );
    this.name = 'LLMEvaluatorNotConfiguredError';
  }
}

export class LLMEvaluatorParseError extends Error {
  constructor(
    public readonly raw: string,
    message?: string
  ) {
    super(message ?? 'LLM evaluator returned unparseable response');
    this.name = 'LLMEvaluatorParseError';
  }
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

export function estimateLLMCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const pricing = KNOWN_MODEL_PRICING[model] ?? {
    inputCostPerMillion: 1.0,
    outputCostPerMillion: 5.0,
  };
  return (
    (inputTokens / 1_000_000) * pricing.inputCostPerMillion +
    (outputTokens / 1_000_000) * pricing.outputCostPerMillion
  );
}

// ─── Name normalization for dedup ─────────────────────────────────────────────

function normalizeEvaluatorName(name: string | null): string {
  if (!name) return '';
  // Remove language markers like "(EN)", "(ES)", "(FR)"
  const cleaned = name.replace(/\s*\([A-Z]{2}\)\s*/gi, ' ').trim();
  return normalizeCompanyName(cleaned);
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function compositeScore(r: LLMEvaluatorResult): number {
  return (
    r.sector_fit_score +
    r.country_fit_score +
    r.prospectability_score +
    r.confidence * 10
  );
}

/**
 * Deduplica resultados evaluados por (1) dominio normalizado o (2) nombre normalizado.
 * Conserva el resultado con mayor score compuesto.
 * Retorna [kept, deduplicatedCount].
 */
export function deduplicateEvaluatedResults(
  results: LLMEvaluatorResult[]
): [LLMEvaluatorResult[], number] {
  const seenDomains = new Map<string, number>(); // domain → index in kept[]
  const seenNames = new Map<string, number>();   // normalizedName → index in kept[]
  const kept: LLMEvaluatorResult[] = [];
  let deduplicatedCount = 0;

  for (const result of results) {
    const domain =
      result.domain
        ? (normalizeDomain(result.domain) ?? null)
        : result.website
        ? (normalizeDomain(result.website) ?? null)
        : null;

    const normalizedName = normalizeEvaluatorName(result.clean_company_name);

    let duplicateOfIdx: number | null = null;

    if (domain) {
      const idx = seenDomains.get(domain);
      if (idx !== undefined) duplicateOfIdx = idx;
    }

    if (duplicateOfIdx === null && normalizedName) {
      const idx = seenNames.get(normalizedName);
      if (idx !== undefined) duplicateOfIdx = idx;
    }

    if (duplicateOfIdx !== null) {
      const existing = kept[duplicateOfIdx];
      if (existing && compositeScore(result) > compositeScore(existing)) {
        kept[duplicateOfIdx] = result;
        if (domain) seenDomains.set(domain, duplicateOfIdx);
        if (normalizedName) seenNames.set(normalizedName, duplicateOfIdx);
      }
      deduplicatedCount++;
    } else {
      const newIdx = kept.length;
      kept.push(result);
      if (domain) seenDomains.set(domain, newIdx);
      if (normalizedName) seenNames.set(normalizedName, newIdx);
    }
  }

  return [kept, deduplicatedCount];
}

// ─── Threshold enforcement ────────────────────────────────────────────────────

/**
 * Si un resultado "keep" no cumple los thresholds → lo baja a "review".
 * Los resultados "discard" y "review" no se modifican.
 */
export function applyThresholds(
  result: LLMEvaluatorResult,
  thresholds: LLMEvaluatorThresholds
): LLMEvaluatorResult {
  if (result.decision !== 'keep') return result;

  const meetsThresholds =
    result.sector_fit_score >= thresholds.sectorFitScore &&
    result.country_fit_score >= thresholds.countryFitScore &&
    result.prospectability_score >= thresholds.prospectabilityScore &&
    result.confidence >= thresholds.confidence;

  if (meetsThresholds) return result;

  return {
    ...result,
    decision: 'review',
    risk_flags: [...result.risk_flags, 'below_threshold'],
  };
}

// ─── Top-N selection ──────────────────────────────────────────────────────────

export function selectTopEvaluatedCandidates(
  keptResults: LLMEvaluatorResult[],
  targetCount: number
): LLMEvaluatorResult[] {
  return [...keptResults]
    .sort((a, b) => compositeScore(b) - compositeScore(a))
    .slice(0, targetCount);
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

async function callAnthropicEvaluator(
  prompt: string,
  apiKey: string,
  model: string
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Anthropic API error ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textContent = data.content.find((c) => c.type === 'text');
  if (!textContent) {
    throw new Error('Anthropic response contained no text content');
  }

  return {
    content: textContent.text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

function clampInt(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function clampFloat(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function parseEvaluatorJSON(raw: string): LLMEvaluatorResult[] {
  const trimmed = raw.trim();

  // Strip markdown code blocks if the model added them despite instructions
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Try to extract a JSON array from within surrounding text
    const match = /\[[\s\S]*\]/.exec(stripped);
    if (!match) {
      throw new LLMEvaluatorParseError(
        raw,
        'Could not find a JSON array in LLM response'
      );
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new LLMEvaluatorParseError(
        raw,
        'Extracted JSON array could not be parsed'
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new LLMEvaluatorParseError(raw, 'LLM response root is not a JSON array');
  }

  return parsed.map((item: unknown, i: number) => {
    if (typeof item !== 'object' || item === null) {
      throw new LLMEvaluatorParseError(raw, `Element ${i} is not an object`);
    }

    const r = item as Record<string, unknown>;
    const rawDecision = String(r.decision ?? 'review');
    const decision: LLMEvaluatorResult['decision'] = ['keep', 'discard', 'review'].includes(
      rawDecision
    )
      ? (rawDecision as LLMEvaluatorResult['decision'])
      : 'review';

    return {
      idx: typeof r.idx === 'number' ? Math.round(r.idx) : i,
      decision,
      clean_company_name:
        typeof r.clean_company_name === 'string' && r.clean_company_name.length > 0
          ? r.clean_company_name
          : null,
      website: typeof r.website === 'string' && r.website.length > 0 ? r.website : null,
      domain: typeof r.domain === 'string' && r.domain.length > 0 ? r.domain : null,
      sector_fit_score: clampInt(r.sector_fit_score, 0, 10),
      country_fit_score: clampInt(r.country_fit_score, 0, 10),
      prospectability_score: clampInt(r.prospectability_score, 0, 10),
      confidence: clampFloat(r.confidence, 0, 1),
      evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
      reason: typeof r.reason === 'string' ? r.reason : '',
      risk_flags: Array.isArray(r.risk_flags) ? r.risk_flags.map(String) : [],
    } satisfies LLMEvaluatorResult;
  });
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evalúa resultados crudos de Tavily usando LLM (Anthropic).
 *
 * Si `input.modelConfig` está completo, lo usa directamente.
 * Si no, carga la API key de Vault para el proveedor 'anthropic'.
 * Lanza LLMEvaluatorNotConfiguredError si no hay credencial.
 */
export async function evaluateTavilyResultsWithLLM(
  input: LLMEvaluatorInput,
  thresholds: LLMEvaluatorThresholds = DEFAULT_LLM_EVALUATOR_THRESHOLDS
): Promise<LLMEvaluatorOutput> {
  const warnings: string[] = [];

  const maxRaw = input.maxRawToEvaluate ?? DEFAULT_MAX_RAW;
  const targetCount = input.targetCount ?? DEFAULT_TARGET_COUNT;
  const resultsToEvaluate = input.rawResults.slice(0, maxRaw);

  if (input.rawResults.length > maxRaw) {
    warnings.push(
      `Resultados truncados de ${input.rawResults.length} a ${maxRaw} para evaluación LLM.`
    );
  }

  // ── Resolve LLM config ─────────────────────────────────────────────────────
  let apiKey: string;
  let provider: string;
  let model: string;

  if (
    input.modelConfig?.apiKey &&
    input.modelConfig.provider &&
    input.modelConfig.model
  ) {
    apiKey = input.modelConfig.apiKey;
    provider = input.modelConfig.provider;
    model = input.modelConfig.model;
  } else {
    const credResult = await getAiProviderCredential('anthropic');
    if (!credResult.success || !credResult.apiKey) {
      throw new LLMEvaluatorNotConfiguredError();
    }
    apiKey = credResult.apiKey;
    provider = FALLBACK_PROVIDER;
    model = FALLBACK_MODEL;
    // Tech debt: read model from ai_active_config when provider=anthropic
    warnings.push(
      `[tech-debt] Modelo LLM hardcoded como "${FALLBACK_MODEL}". ` +
        'Migrar a lectura desde ai_active_config en hito posterior.'
    );
  }

  // ── Build prompt ───────────────────────────────────────────────────────────
  const prompt = buildLLMEvaluatorPrompt(
    input.country,
    input.countryCode,
    input.industry,
    resultsToEvaluate
  );

  // ── Call LLM ───────────────────────────────────────────────────────────────
  const { content, inputTokens, outputTokens } = await callAnthropicEvaluator(
    prompt,
    apiKey,
    model
  );

  // ── Parse response ─────────────────────────────────────────────────────────
  const rawEvaluated = parseEvaluatorJSON(content);

  // ── Apply thresholds ───────────────────────────────────────────────────────
  const withThresholds = rawEvaluated.map((r) => applyThresholds(r, thresholds));

  // ── Partition by decision ──────────────────────────────────────────────────
  const keptRaw = withThresholds.filter((r) => r.decision === 'keep');
  const reviewResults = withThresholds.filter((r) => r.decision === 'review');
  const discardedResults = withThresholds.filter((r) => r.decision === 'discard');

  // ── Deduplicate kept results ───────────────────────────────────────────────
  const [dedupedKept, deduplicatedCount] = deduplicateEvaluatedResults(keptRaw);

  if (deduplicatedCount > 0) {
    warnings.push(
      `Se eliminaron ${deduplicatedCount} resultado(s) duplicado(s) por dominio o nombre normalizado.`
    );
  }

  // ── Select top N ──────────────────────────────────────────────────────────
  const topCandidates = selectTopEvaluatedCandidates(dedupedKept, targetCount);

  // ── Cost ───────────────────────────────────────────────────────────────────
  const estimatedCostUsd = estimateLLMCost(inputTokens, outputTokens, model);
  const costPerKeptCandidate =
    dedupedKept.length > 0 ? estimatedCostUsd / dedupedKept.length : 0;

  const usage: LLMEvaluatorUsage = {
    provider,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    evaluatedCount: resultsToEvaluate.length,
    costPerKeptCandidate,
  };

  return {
    evaluatedResults: withThresholds,
    keptResults: dedupedKept,
    reviewResults,
    discardedResults,
    topCandidates,
    deduplicatedCount,
    usage,
    warnings,
  };
}

// ─── Metadata builder ─────────────────────────────────────────────────────────

/**
 * Construye el bloque metadata.llm_evaluation para persistir por candidato.
 * No incluye el prompt completo ni la API key.
 */
export function buildLLMEvaluationMetadata(
  result: LLMEvaluatorResult,
  usage: Pick<LLMEvaluatorUsage, 'provider' | 'model'>
): LLMEvaluationMetadata {
  return {
    provider: usage.provider,
    model: usage.model,
    decision: result.decision,
    clean_company_name: result.clean_company_name,
    sector_fit_score: result.sector_fit_score,
    country_fit_score: result.country_fit_score,
    prospectability_score: result.prospectability_score,
    confidence: result.confidence,
    evidence: result.evidence,
    reason: result.reason,
    risk_flags: result.risk_flags,
    evaluated_at: new Date().toISOString(),
  };
}
