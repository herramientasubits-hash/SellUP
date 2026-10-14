/**
 * Agente 1 · Fase B, paso 2 — una corrida del piloto «Claude busca empresas» (puro;
 * dependencias inyectadas).
 *
 * Se lanza desde un lote existente (hereda país, industria, subindustrias y criterios)
 * y escribe en un lote NUEVO: así el piloto se mide por separado de Apollo, Lusha y
 * Tavily, y no toca la cuenta de aceptadas de la corrida original. El escritor es el
 * de siempre (mismas compuertas) y las empresas quedan como `web_ai`, igual que las de
 * Tavily; el origen se marca en la metadata del lote. Nada se aprueba solo.
 */

import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { ActiveAnthropicModel } from './classify-batch-candidates';
import type { CompanySearchOutcome } from './company-search';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, CLAUDE_CLASSIFIER_PROVIDER_KEY } from './types';

export const CLAUDE_COMPANY_SEARCH_OPERATION_KEY = 'company_search';
/** Consultas por corrida (una llamada a Claude cada una, hasta 5 empresas por llamada). */
export const CLAUDE_COMPANY_SEARCH_MAX_QUERIES = 2;
export const CLAUDE_COMPANY_SEARCH_RESULTS_PER_QUERY = 5;
export const CLAUDE_COMPANY_SEARCH_TARGET = 10;
export const CLAUDE_COMPANY_SEARCH_METADATA_KEY = 'claude_company_search';
/**
 * Tiempo para EMPEZAR consultas a Claude desde que arranca la corrida. El resto de los
 * 300 s de Vercel queda para verificar sitios, revisar duplicados y escribir.
 */
export const CLAUDE_COMPANY_SEARCH_PHASE_MS = 170_000;

export type SourceBatch = {
  id: string;
  country: string;
  countryCode: string;
  industry: string;
  /** `metadata.industry_id`: lo usa el rescate para saber la macroindustria pedida. */
  industryId: string | null;
  /** Clave canónica de la macro (p. ej. 'technology'): para leer el banco de empresas. */
  macroIndustryKey: string | null;
  subindustries: string[];
  additionalCriteria: string | null;
  /**
   * AGENT1-SUPPLIER-SEARCH-1 — `metadata.supplier_search.reference_company_name`: el
   * lote es de «Proveedores de una empresa». Ausente/null = búsqueda por criterios.
   */
  referenceCompanyName?: string | null;
  /**
   * «Competidores de una empresa»: la empresa de referencia del lote. Con ella las
   * consultas buscan sus competidores en vez de «empresas de {industria}». Ausente
   * (null) en las demás búsquedas.
   */
  competitorReference?: CompetitorReference | null;
};

export type CompanySearchCall = CompanySearchOutcome & { query: string; durationMs: number };

export type WrittenCandidates = {
  batchId: string | null;
  candidatesCreated: number;
  /** La verdad del escritor (aceptadas para la meta); null = no medido. */
  completeValidCandidates?: number | null;
  acceptedCandidateIds?: readonly string[];
  errors: string[];
};

export type ClaudeCompanySearchDeps = {
  loadSourceBatch: (batchId: string) => Promise<SourceBatch | null>;
  /**
   * Dominios ya vistos en SellUp para este país × industria (candidatos, descartadas y,
   * si está disponible, el banco de empresas).
   */
  loadExcludedDomains: (source: SourceBatch) => Promise<string[]>;
  /** Corridas anteriores del piloto para este país × industria (para rotar regiones). */
  countPreviousRuns: (countryCode: string, industry: string) => Promise<number>;
  /** Regiones del país (las mismas que usa Tavily); vacío ⇒ sólo consultas nacionales. */
  resolveRegions: (countryCode: string) => readonly string[];
  resolveActiveModel: () => Promise<ActiveAnthropicModel | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  /** Corre la cadena de siempre con el proveedor `claude`; devuelve las llamadas hechas. */
  runSearch: (params: {
    source: SourceBatch;
    queries: string[];
    excludeDomains: string[];
    active: ActiveAnthropicModel;
    deadlineAtMs: number;
    /** Se llama al terminar CADA llamada a Claude: registra lo pagado al instante. */
    onCall: (call: CompanySearchCall) => Promise<void>;
  }) => Promise<{ pipelineOutput: unknown; calls: CompanySearchCall[] }>;
  /**
   * Escribe con el escritor de siempre: en un lote NUEVO (botón) o en el lote de la
   * corrida del asistente (`existingBatchId`, sin sellar su estado). batchId null = falló.
   */
  writeCandidates: (params: {
    pipelineOutput: unknown;
    metadata: Record<string, unknown>;
    existingBatchId?: string;
    /**
     * AGENT1-SUPPLIER-SEARCH-1 — `false`: lo que no cupo NO va al banco de empresas.
     * Un proveedor de X no es un candidato general del país × industria. Ausente = sí.
     */
    depositSurplusToBank?: boolean;
  }) => Promise<WrittenCandidates>;
  logUsage: (input: LogProviderUsageInput) => Promise<boolean>;
  newRunId: () => string;
  nowIso: () => string;
  nowMs: () => number;
};

export type ClaudeCompanySearchSummary =
  | {
      ok: true;
      batchId: string | null;
      candidatesCreated: number;
      completeValidCandidates: number | null;
      acceptedCandidateIds: readonly string[];
      proposed: number;
      passedPreFilter: number;
      rejected: Record<string, number>;
      estimatedCostUsd: number;
    }
  | {
      ok: false;
      error:
        | 'source_batch_not_found'
        | 'model_not_configured'
        | 'quota_exhausted'
        | 'exclusions_unavailable'
        | 'search_failed'
        | 'write_failed';
      detail?: string;
    };

/**
 * Consultas de la corrida.
 *  - 1.ª corrida de este país × industria: una general y, si hay, una por la primera
 *    subindustria (si no, «grandes empresas…»).
 *  - Siguientes: dos regiones del país por corrida, rotando (Antioquia, Valle del Cauca…).
 *    Una búsqueda nacional devuelve siempre las mismas empresas conocidas (Prod 01-10:
 *    CO×Tec, 8 de 10 ya vistas o sin sitio propio en la búsqueda).
 */
export function buildCompanySearchQueries(
  source: Pick<SourceBatch, 'country' | 'industry' | 'subindustries' | 'competitorReference'>,
  previousRuns = 0,
  regions: readonly string[] = [],
): string[] {
  if (source.competitorReference) return buildCompetitorSearchQueries(source.competitorReference, source.country);
  const subject = source.subindustries[0] ?? source.industry;
  if (previousRuns > 0 && regions.length > 0) {
    const start = ((previousRuns - 1) * CLAUDE_COMPANY_SEARCH_MAX_QUERIES) % regions.length;
    return Array.from({ length: Math.min(CLAUDE_COMPANY_SEARCH_MAX_QUERIES, regions.length) }, (_, i) => {
      const region = regions[(start + i) % regions.length];
      return `empresas de ${subject} en ${region}, ${source.country}`;
    });
  }
  const queries = [`empresas de ${source.industry} en ${source.country}`];
  for (const sub of source.subindustries) {
    if (queries.length >= CLAUDE_COMPANY_SEARCH_MAX_QUERIES) break;
    queries.push(`empresas de ${sub} en ${source.country}`);
  }
  if (queries.length < CLAUDE_COMPANY_SEARCH_MAX_QUERIES) {
    queries.push(`grandes empresas de ${source.industry} con sede en ${source.country}`);
  }
  return queries;
}

/**
 * «Competidores de una empresa»: las dos consultas nombran a la referencia. La
 * segunda añade qué vende, para que Claude no se quede sólo con las famosas.
 */
export function buildCompetitorSearchQueries(
  reference: CompetitorReference,
  country: string,
  round = 0,
): string[] {
  // Ronda 2+ (Prod 14-10, lote 16205dfb: las 3 de la 1.ª ronda ya estaban en HubSpot):
  // las famosas ya son clientes; se piden medianas, regionales y marcas alternativas.
  if (round > 0) {
    return [
      `empresas medianas y regionales que compiten con ${reference.name} en ${country}`,
      reference.description
        ? `alternativas nacionales a ${reference.name} (${reference.description}) en ${country}, menos conocidas`
        : `marcas y fabricantes nacionales alternativos a ${reference.name} en ${country}, menos conocidos`,
    ].slice(0, CLAUDE_COMPANY_SEARCH_MAX_QUERIES);
  }
  const queries = [`competidores de ${reference.name} en ${country}`];
  queries.push(
    reference.description
      ? `empresas similares a ${reference.name} (${reference.description}) en ${country}`
      : `empresas que compiten con ${reference.name} en ${country}`,
  );
  return queries.slice(0, CLAUDE_COMPANY_SEARCH_MAX_QUERIES);
}

/**
 * AGENT1-SUPPLIER-SEARCH-1/3 — consultas de «Proveedores de una empresa». Dos ángulos:
 * los proveedores que la nombran (casos de éxito, «nuestros clientes») y la relación
 * dicha desde fuera (notas, contratos). Siempre de la industria pedida y en el país.
 *
 * 🔴 Medido en Prod 14-10 (Ecopetrol × Tecnología): estas consultas propusieron 10
 * empresas; la variante «proveedores de tecnología de Ecopetrol» + «proveedores
 * destacados o aliados…» (#692) propuso 1. No cambiarlas sin medir con corridas reales.
 */
export function buildSupplierSearchQueries(
  source: Pick<SourceBatch, 'country' | 'industry' | 'subindustries'>,
  referenceCompanyName: string,
): string[] {
  const subject = source.subindustries[0] ?? source.industry;
  return [
    `empresas de ${subject} que son proveedores de ${referenceCompanyName} en ${source.country}`,
    `${referenceCompanyName} cliente caso de éxito ${subject} ${source.country}`,
  ].slice(0, CLAUDE_COMPANY_SEARCH_MAX_QUERIES);
}

function addCounts(target: Record<string, number>, extra: Partial<Record<string, number>>): Record<string, number> {
  const next = { ...target };
  for (const [key, value] of Object.entries(extra)) next[key] = (next[key] ?? 0) + (value ?? 0);
  return next;
}

/**
 * El uso se registra al terminar cada llamada, antes de que exista el lote nuevo: va
 * sin `batch_id` y con `run_id` + `source_batch_id`; el lote nuevo guarda el mismo
 * `run_id` en `metadata.claude_company_search`.
 */
export function buildCompanySearchUsageLog(
  call: CompanySearchCall,
  context: {
    runId: string;
    sourceBatchId: string;
    triggeredBy: string;
    index: number;
    batchId?: string | null;
    /** AGENT1-SUPPLIER-SEARCH-1 — para separar en Uso de IA lo de «Proveedores». */
    referenceCompanyName?: string | null;
    /** «Competidores de una empresa»: la referencia, para separarlo en Uso de IA. */
    competitorReferenceName?: string | null;
  },
): LogProviderUsageInput | null {
  if (!call.usage) return null;
  const isError = call.errorCode !== null;
  return {
    // En la corrida del asistente el lote ya existe: el uso queda asociado a él.
    ...(context.batchId ? { batch_id: context.batchId } : {}),
    usage_key: `${CLAUDE_COMPANY_SEARCH_OPERATION_KEY}:${context.runId}:${context.index}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CLAUDE_COMPANY_SEARCH_OPERATION_KEY,
    model: call.usage.model,
    input_tokens: call.usage.inputTokens,
    output_tokens: call.usage.outputTokens,
    results_returned: call.results.length,
    estimated_cost_usd: call.usage.estimatedCostUsd,
    status: isError && call.errorCode === 'rate_limited' ? 'rate_limited' : isError ? 'error' : 'success',
    error_code: call.errorCode ?? undefined,
    duration_ms: call.durationMs,
    triggered_by: context.triggeredBy,
    // La forma de búsqueda en su columna (el disparador de la 147 la respeta); sin
    // esto, el lote del asistente la deriva como «exploratory».
    ...(context.referenceCompanyName
      ? { search_mode: 'suppliers' }
      : context.competitorReferenceName
        ? { search_mode: 'competitors' }
        : {}),
    metadata: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      flow: 'claude_company_search',
      run_id: context.runId,
      source_batch_id: context.sourceBatchId,
      query: call.query,
      proposed: call.proposed,
      rejected: call.rejected,
      web_search_requests: call.usage.webSearchRequests,
      pricing_source: call.usage.pricingSource,
      ...(context.referenceCompanyName
        ? { search_mode: 'suppliers', reference_company_name: context.referenceCompanyName }
        : context.competitorReferenceName
          ? { search_mode: 'competitors', reference_company_name: context.competitorReferenceName }
          : {}),
    },
  };
}

export async function runClaudeCompanySearch(
  params: {
    sourceBatchId: string;
    triggeredBy: string;
    /**
     * Paso automático del asistente: escribe en ESTE lote (el de la corrida) y cuenta
     * para su meta. Ausente (botón) ⇒ lote nuevo.
     */
    writeIntoSourceBatch?: boolean;
    /** Tiempo para EMPEZAR consultas; por defecto CLAUDE_COMPANY_SEARCH_PHASE_MS. */
    phaseMs?: number;
    /**
     * «Competidores de una empresa»: ronda de la corrida (0 = primera). Las
     * siguientes piden empresas menos conocidas; lo ya visto se excluye solo.
     */
    round?: number;
  },
  deps: ClaudeCompanySearchDeps,
): Promise<ClaudeCompanySearchSummary> {
  const intoBatchId = params.writeIntoSourceBatch ? params.sourceBatchId : null;
  const source = await deps.loadSourceBatch(params.sourceBatchId);
  if (!source) return { ok: false, error: 'source_batch_not_found' };
  const active = await deps.resolveActiveModel();
  if ('error' in active) return { ok: false, error: 'model_not_configured', detail: active.error };
  if (!(await deps.checkQuota()).allowed) return { ok: false, error: 'quota_exhausted' };

  // Sin la lista de ya conocidas, Claude traería repetidas (y se pagarían): no se busca.
  let excludeDomains: string[];
  try {
    excludeDomains = await deps.loadExcludedDomains(source);
  } catch (err) {
    return { ok: false, error: 'exclusions_unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  // La empresa de referencia nunca es su propia competidora.
  const referenceDomain = source.competitorReference?.domain ?? null;
  if (referenceDomain && !excludeDomains.includes(referenceDomain)) excludeDomains = [referenceDomain, ...excludeDomains];
  const referenceCompanyName = source.referenceCompanyName?.trim() || null;
  // Proveedores y competidores no rotan regiones: sus consultas nombran a la referencia.
  const previousRuns =
    referenceCompanyName || source.competitorReference
      ? 0
      : await deps.countPreviousRuns(source.countryCode, source.industry).catch(() => 0);
  const queries = referenceCompanyName
    ? buildSupplierSearchQueries(source, referenceCompanyName)
    : source.competitorReference
      ? buildCompetitorSearchQueries(source.competitorReference, source.country, params.round ?? 0)
      : buildCompanySearchQueries(source, previousRuns, deps.resolveRegions(source.countryCode));
  const runId = deps.newRunId();
  let callIndex = 0;
  const onCall = async (call: CompanySearchCall) => {
    const log = buildCompanySearchUsageLog(call, {
      runId,
      sourceBatchId: source.id,
      triggeredBy: params.triggeredBy,
      index: callIndex++,
      batchId: intoBatchId,
      referenceCompanyName,
      competitorReferenceName: source.competitorReference?.name ?? null,
    });
    if (log) await deps.logUsage(log);
  };

  let search: Awaited<ReturnType<ClaudeCompanySearchDeps['runSearch']>>;
  try {
    search = await deps.runSearch({
      source,
      queries,
      excludeDomains,
      active,
      deadlineAtMs: deps.nowMs() + (params.phaseMs ?? CLAUDE_COMPANY_SEARCH_PHASE_MS),
      onCall,
    });
  } catch (err) {
    // Lo pagado ya quedó registrado por `onCall`, llamada a llamada.
    return { ok: false, error: 'search_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  const at = deps.nowIso();
  const proposed = search.calls.reduce((acc, c) => acc + c.proposed, 0);
  const passedPreFilter = search.calls.reduce((acc, c) => acc + c.results.length, 0);
  const rejected = search.calls.reduce<Record<string, number>>((acc, c) => addCounts(acc, c.rejected), {});
  const estimatedCostUsd =
    Math.round(search.calls.reduce((acc, c) => acc + (c.usage?.estimatedCostUsd ?? 0), 0) * 1_000_000) / 1_000_000;

  const written =
    passedPreFilter > 0
      ? await deps.writeCandidates({
          pipelineOutput: search.pipelineOutput,
          ...(intoBatchId ? { existingBatchId: intoBatchId } : {}),
          ...(referenceCompanyName ? { depositSurplusToBank: false } : {}),
          metadata: {
            // En el lote del asistente estas claves ya existen: no se tocan.
            ...(!intoBatchId && source.industryId ? { industry_id: source.industryId } : {}),
            ...(!intoBatchId && source.additionalCriteria ? { additional_criteria: source.additionalCriteria } : {}),
            [CLAUDE_COMPANY_SEARCH_METADATA_KEY]: {
              contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
              pilot: !intoBatchId,
              mode: referenceCompanyName ? 'supplier_search' : intoBatchId ? 'wizard_leg' : 'button',
              ...(referenceCompanyName ? { reference_company_name: referenceCompanyName } : {}),
              run_id: runId,
              ...(source.macroIndustryKey ? { macro_industry_key: source.macroIndustryKey } : {}),
              ...(source.competitorReference
                ? {
                    competitor_of: { name: source.competitorReference.name, domain: source.competitorReference.domain },
                    competitor_round: params.round ?? 0,
                  }
                : {}),
              source_batch_id: source.id,
              queries,
              previous_runs: previousRuns,
              excluded_domains_count: excludeDomains.length,
              proposed,
              passed_pre_filter: passedPreFilter,
              rejected,
              estimated_cost_usd: estimatedCostUsd,
              searched_at: at,
            },
          },
        })
      : ({ batchId: null, candidatesCreated: 0, errors: [] } as WrittenCandidates);

  if (passedPreFilter > 0 && !written.batchId) {
    return { ok: false, error: 'write_failed', detail: written.errors.join('; ') };
  }
  return {
    ok: true,
    batchId: written.batchId,
    candidatesCreated: written.candidatesCreated,
    completeValidCandidates: written.completeValidCandidates ?? null,
    acceptedCandidateIds: written.acceptedCandidateIds ?? [],
    proposed,
    passedPreFilter,
    rejected,
    estimatedCostUsd,
  };
}
