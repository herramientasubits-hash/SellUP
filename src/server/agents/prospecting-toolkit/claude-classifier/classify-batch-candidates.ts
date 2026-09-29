/**
 * Agente 1 · Clasificador Claude — clasificar los candidatos «para revisión» de un lote.
 *
 * Igual que Apollo y Lusha, respeta lo que diga Configuración:
 *  - modelo y credencial: Configuración → IA (proveedor activo = anthropic);
 *  - cuota: `checkProviderQuotaAvailable('anthropic')` (sin tope configurado = sin límite).
 *
 * Cada llamada se registra en `provider_usage_logs` (provider_key='anthropic').
 * Sólo escribe `metadata.claude_classification`: NUNCA el estado del candidato.
 *
 * Una corrida tiene tope de empresas y de tiempo para no pasarse del límite de
 * la función en Vercel (si la matan, lo ya gastado no quedaría registrado). Lo
 * que no alcanza queda en `remaining` y se procesa pulsando otra vez.
 */

import {
  buildClassificationMetadata,
  buildInProgressMarker,
  needsClaudeClassification,
  type ClassifiableCandidateRow,
  type ClassificationInProgressMarker,
} from './classification-metadata';
import {
  CLAUDE_CLASSIFIER_CONTRACT_VERSION,
  CLAUDE_CLASSIFIER_OPERATION_KEY,
  CLAUDE_CLASSIFIER_PROVIDER_KEY,
  type ClassifierCatalogIndustry,
  type ClassifierCompanyInput,
  type ClaudeClassificationMetadata,
  type CompanyClassificationResult,
} from './types';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

/** Empresas clasificadas en paralelo (ritmo, no presupuesto). */
export const CLASSIFIER_CONCURRENCY = 4;
/** Empresas por corrida: cabe holgado en el tiempo de una función de Vercel. */
export const CLASSIFIER_MAX_COMPANIES_PER_RUN = 20;
/** Después de esto no se empieza ninguna empresa nueva (las que están en curso terminan). */
export const CLASSIFIER_RUN_DEADLINE_MS = 180_000;

export type ActiveAnthropicModel = { model: string; apiKey: string };

export type ClassifyBatchDeps = {
  resolveActiveModel: () => Promise<ActiveAnthropicModel | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  loadCatalog: () => Promise<ClassifierCatalogIndustry[]>;
  loadCandidates: (batchId: string) => Promise<ClassifiableCandidateRow[]>;
  classify: (
    company: ClassifierCompanyInput,
    catalog: readonly ClassifierCatalogIndustry[],
    active: ActiveAnthropicModel,
  ) => Promise<CompanyClassificationResult>;
  logUsage: (input: LogProviderUsageInput) => Promise<boolean>;
  /**
   * Escribe la sugerencia (o la marca «en proceso») sólo si el candidato sigue
   * «para revisión» y nadie más escribió en medio. false = no se escribió.
   */
  saveClassification: (
    candidateId: string,
    classification: ClaudeClassificationMetadata | ClassificationInProgressMarker,
  ) => Promise<boolean>;
  nowIso: () => string;
  nowMs: () => number;
};

export type ClassifyBatchSummary =
  | {
      ok: true;
      considered: number;
      classified: number;
      partiallyClassified: number;
      nothingVerifiable: number;
      skipped: number;
      failed: number;
      estimatedCostUsd: number;
      webSearchRequests: number;
      saveFailures: number;
      usageLogFailures: number;
      /** Elegibles que no entraron en esta corrida (tope o tiempo). */
      remaining: number;
      /** Elegibles que otra corrida ya estaba procesando. */
      claimedElsewhere: number;
    }
  | {
      ok: false;
      error: 'model_not_configured' | 'quota_exhausted' | 'catalog_unavailable' | 'candidates_unavailable';
      detail?: string;
    };

function toCompanyInput(row: ClassifiableCandidateRow): ClassifierCompanyInput {
  return {
    candidateId: row.id,
    name: row.name ?? '',
    websiteOrDomain: row.website ?? row.domain,
    countryCode: row.country_code,
    countryName: row.country,
    currentIndustryId: row.industry_id,
  };
}

export function buildClassifierUsageLog(
  result: CompanyClassificationResult,
  context: { batchId: string; triggeredBy: string | null; classifiedAt: string },
): LogProviderUsageInput | null {
  if (!result.usage) return null;
  const isError = result.outcome === 'model_error';
  return {
    batch_id: context.batchId,
    usage_key: `${CLAUDE_CLASSIFIER_OPERATION_KEY}:${result.candidateId}:${context.classifiedAt}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CLAUDE_CLASSIFIER_OPERATION_KEY,
    model: result.usage.model,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    results_returned: Number(result.sector !== null) + Number(result.employeeRange !== null),
    estimated_cost_usd: result.usage.estimatedCostUsd,
    status: isError && result.errorCode === 'rate_limited' ? 'rate_limited' : isError ? 'error' : 'success',
    error_code: result.errorCode ?? undefined,
    duration_ms: result.durationMs,
    triggered_by: context.triggeredBy ?? undefined,
    metadata: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      candidate_id: result.candidateId,
      outcome: result.outcome,
      web_search_requests: result.usage.webSearchRequests,
      cache_read_input_tokens: result.usage.cacheReadInputTokens,
      cache_creation_input_tokens: result.usage.cacheCreationInputTokens,
      pricing_source: result.usage.pricingSource,
    },
  };
}

/** Procesa en paralelo; deja de EMPEZAR ítems nuevos cuando `shouldStop()` es true. */
async function mapWithConcurrencyUntil<T, R>(
  items: readonly T[],
  limit: number,
  shouldStop: () => boolean,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++];
      results.push(await fn(item));
    }
  });
  await Promise.all(workers);
  return results;
}

/** Un fallo inesperado en UNA empresa no puede tumbar el lote entero. */
async function classifyOneSafely(
  row: ClassifiableCandidateRow,
  catalog: readonly ClassifierCatalogIndustry[],
  active: ActiveAnthropicModel,
  deps: ClassifyBatchDeps,
): Promise<CompanyClassificationResult> {
  try {
    return await deps.classify(toCompanyInput(row), catalog, active);
  } catch (err) {
    console.error('[claude-classifier] unexpected classify error:', err instanceof Error ? err.message : err);
    return {
      candidateId: row.id,
      outcome: 'model_error',
      sector: null,
      employeeRange: null,
      rejected: [],
      isOperatingCompany: null,
      pageFinalUrl: null,
      usage: null,
      errorCode: 'unexpected_error',
      durationMs: 0,
    };
  }
}

export async function classifyBatchCandidates(
  params: { batchId: string; triggeredBy: string | null; force?: boolean },
  deps: ClassifyBatchDeps,
): Promise<ClassifyBatchSummary> {
  const active = await deps.resolveActiveModel();
  if ('error' in active) return { ok: false, error: 'model_not_configured', detail: active.error };

  const quota = await deps.checkQuota();
  if (!quota.allowed) return { ok: false, error: 'quota_exhausted' };

  let catalog: ClassifierCatalogIndustry[];
  try {
    catalog = await deps.loadCatalog();
  } catch (err) {
    return { ok: false, error: 'catalog_unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  if (catalog.length === 0) return { ok: false, error: 'catalog_unavailable', detail: 'empty_catalog' };

  let rows: ClassifiableCandidateRow[];
  try {
    rows = await deps.loadCandidates(params.batchId);
  } catch (err) {
    return { ok: false, error: 'candidates_unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  const startedMs = deps.nowMs();
  const eligible = rows.filter((row) =>
    needsClaudeClassification(row, { force: params.force ?? false, nowMs: startedMs }),
  );
  const thisRun = eligible.slice(0, CLASSIFIER_MAX_COMPANIES_PER_RUN);
  const deadlineReached = () => deps.nowMs() - startedMs >= CLASSIFIER_RUN_DEADLINE_MS;

  const processed = await mapWithConcurrencyUntil(thisRun, CLASSIFIER_CONCURRENCY, deadlineReached, async (row) => {
    // Se reclama ANTES de gastar: si otra corrida lo tomó, no se paga dos veces.
    const claimed = await deps.saveClassification(row.id, buildInProgressMarker(deps.nowIso()));
    if (!claimed) return { claimed: false as const };
    const result = await classifyOneSafely(row, catalog, active, deps);
    const classifiedAt = deps.nowIso();
    const usageLog = buildClassifierUsageLog(result, {
      batchId: params.batchId,
      triggeredBy: params.triggeredBy,
      classifiedAt,
    });
    const logged = usageLog ? await deps.logUsage(usageLog) : true;
    const saved = await deps.saveClassification(row.id, buildClassificationMetadata(result, classifiedAt));
    return { claimed: true as const, result, logged, saved };
  });
  const outcomes = processed.filter((p): p is Extract<typeof p, { claimed: true }> => p.claimed);

  const count = (outcome: CompanyClassificationResult['outcome']) =>
    outcomes.filter((o) => o.result.outcome === outcome).length;
  const sum = (pick: (r: CompanyClassificationResult) => number) =>
    outcomes.reduce((acc, o) => acc + pick(o.result), 0);

  return {
    ok: true,
    considered: rows.length,
    classified: count('classified'),
    partiallyClassified: count('partially_classified'),
    nothingVerifiable: count('nothing_verifiable'),
    skipped: count('no_website') + count('website_unreachable') + count('website_redirected_offsite'),
    failed: count('model_error'),
    estimatedCostUsd: Math.round(sum((r) => r.usage?.estimatedCostUsd ?? 0) * 1_000_000) / 1_000_000,
    webSearchRequests: sum((r) => r.usage?.webSearchRequests ?? 0),
    saveFailures: outcomes.filter((o) => !o.saved).length,
    usageLogFailures: outcomes.filter((o) => !o.logged).length,
    remaining: eligible.length - processed.length,
    claimedElsewhere: processed.length - outcomes.length,
  };
}
