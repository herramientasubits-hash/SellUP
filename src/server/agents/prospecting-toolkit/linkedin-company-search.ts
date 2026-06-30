/**
 * LinkedIn Company Controlled Search — Hito v1.15.7
 *
 * Búsqueda controlada de LinkedIn Company URL para candidatos donde
 * linkedin_enrichment.status === 'not_found', usando el proveedor de
 * búsqueda existente bajo caps estrictos y feature flag.
 *
 * Caps v1.15.6:
 *   - max 2 queries por candidato por defecto (configurable)
 *   - max 5 queries totales por batch (configurable, hard cap 5)
 *   - max_results = 1 por defecto, 3 en modo recall test (configurable)
 *   - Se detiene por candidato en cuanto encuentra status=found
 *
 * v1.15.7 — Controlled LinkedIn Enablement + Usage Logging:
 *   - Usage logging inyectable por llamada al provider (LinkedInUsageLoggerFn)
 *   - Contexto de trazabilidad: batchId, userId, dryRun, unitCostUsd
 *   - estimated_cost_usd en batch metadata (null si no hay pricing)
 *   - usage_logged en batch metadata
 *   - usagePayloads en output para flush diferido por el caller
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled sigue false
 *
 * Query variants por candidato:
 *   Q1: "<company_name>" "<domain>" site:linkedin.com/company  (si hay dominio)
 *   Q2: "<company_name>" site:linkedin.com/company             (siempre)
 *
 * Sin llamadas reales en tests. Usa mock provider inyectable.
 * Sin scraping. Sin login. Sin cookies. Sin Sales Navigator.
 * Sin búsqueda de contactos, personas ni decisores.
 */

import { buildLinkedInEnrichmentMetadata } from './linkedin-company-enrichment';
import type { LinkedInEnrichmentMetadata, LinkedInEnrichmentSource } from './types';

// ─── Config ───────────────────────────────────────────────────────────────────

export type LinkedInSearchProvider = 'mock' | 'tavily' | 'disabled';

export type LinkedInSearchConfig = {
  enabled: boolean;
  provider: LinkedInSearchProvider;
  maxPerBatch: number;
  minConfidenceScore: number;
  /** Máximo de queries a ejecutar por candidato. Default 2. */
  maxQueriesPerCandidate?: number;
  /** Máximo de resultados a solicitar al provider por query. Default 1. */
  maxResultsPerQuery?: number;
};

export const DEFAULT_LINKEDIN_SEARCH_CONFIG: LinkedInSearchConfig = {
  enabled: false,
  provider: 'disabled',
  maxPerBatch: 5,
  minConfidenceScore: 70,
  maxQueriesPerCandidate: 2,
  // Tavily bills per query call, not per result returned. Requesting 3 results
  // per query costs the same 1 credit as requesting 1, but gives the selector
  // up to 3 URLs to pick from — increasing the chance that at least one is a
  // valid /company/ page even when the top result is a /posts/ or /feed/ URL.
  maxResultsPerQuery: 3,
};

// ─── Usage logging (v1.15.7) ─────────────────────────────────────────────────

/** Payload de trazabilidad por cada llamada real al provider para LinkedIn Search. */
export type LinkedInUsageLogPayload = {
  usage_key: string;
  provider: 'tavily';
  feature: 'linkedin_company_search';
  agent: 'agent_1';
  batch_id: string | null;
  user_id: string | null;
  candidate_name: string;
  candidate_domain: string | null;
  query: string;
  search_depth: 'basic';
  max_results: number;
  estimated_cost_usd: number | null;
  status: 'success' | 'failed' | 'skipped';
  result_count: number;
  selected_status: 'found' | 'ambiguous' | 'rejected' | 'not_found' | 'skipped';
  selected_url: string | null;
  created_at: string;
};

/**
 * Logger inyectable por llamada al provider.
 * En tests: captura payloads sin tocar Supabase.
 * En prod real: escribe a provider_usage_logs.
 * En dryRun: no se invoca.
 */
export type LinkedInUsageLoggerFn = (payload: LinkedInUsageLogPayload) => Promise<void>;

/** Contexto de trazabilidad para las llamadas LinkedIn Search. */
export type LinkedInUsageContext = {
  batchId?: string | null;
  userId?: string | null;
  dryRun?: boolean;
  /** Costo por crédito Tavily basic (1 crédito/llamada). null = sin pricing disponible. */
  unitCostUsd?: number | null;
};

/**
 * Clave determinística por llamada LinkedIn Search para deduplicación.
 * Formato: tavily:linkedin_search:{batchId}:{nameSlug}:{queryIndex}
 */
export function buildLinkedInUsageKey(
  batchId: string | null | undefined,
  candidateName: string,
  queryIndex: number,
): string {
  const safeId = (batchId ?? 'no_batch').slice(0, 36);
  const safeSlug = candidateName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  return `tavily:linkedin_search:${safeId}:${safeSlug}:q${queryIndex}`;
}

// ─── Batch metadata ───────────────────────────────────────────────────────────

export type LinkedInSearchSample = {
  candidate_name: string;
  domain: string | null;
  query: string;
  status: string;
  company_url: string | null;
  reason: string;
  // v1.15.6 extended fields
  raw_result_count: number;
  selected_url: string | null;
  selected_status: string;
  confidence: number;
  found_urls_count: number;
  ambiguous_urls_count: number;
  rejected_urls_count: number;
};

export type LinkedInBatchSearchMetadata = {
  enabled: boolean;
  /** Candidatos para los que se ejecutó al menos una query. Backwards-compat alias de attempted_candidate_count. */
  attempted_count: number;
  /** Candidatos para los que se ejecutó al menos una query (v1.15.6). */
  attempted_candidate_count: number;
  /** Total de llamadas al provider (queries) ejecutadas (v1.15.6). */
  attempted_query_count: number;
  skipped_count: number;
  found_count: number;
  ambiguous_count: number;
  rejected_count: number;
  not_found_count: number;
  max_per_batch: number;
  /** Máximo de queries configurado por candidato (v1.15.6). */
  max_queries_per_candidate: number;
  /** Máximo de resultados configurado por query (v1.15.6). */
  max_results_per_query: number;
  /** true si al menos un candidato detuvo la búsqueda tras encontrar found (v1.15.6). */
  stopped_after_found: boolean;
  provider: string;
  samples: LinkedInSearchSample[];
  /** Costo estimado total (USD) de las llamadas LinkedIn Search en el batch. null si sin pricing. (v1.15.7) */
  estimated_cost_usd: number | null;
  /** true si usageLoggerFn fue invocado por cada provider call (no dryRun). (v1.15.7) */
  usage_logged: boolean;
  /** Total de llamadas a usageLoggerFn intentadas (v1.15.7.1) */
  usage_log_attempted_count: number;
  /** Total de llamadas a usageLoggerFn exitosas (v1.15.7.1) */
  usage_log_success_count: number;
  /** Total de llamadas a usageLoggerFn fallidas (v1.15.7.1) */
  usage_log_failed_count: number;
  /** Payloads diferidos pendientes de flush (v1.15.7.1) — actualmente siempre 0 */
  usage_log_deferred_count: number;
  /** Payloads diferidos ya flusheados con batch_id real (v1.15.7.1) — actualmente siempre 0 */
  usage_log_flushed_count: number;
  /** Errores sanitizados del usageLoggerFn (v1.15.7.1) */
  usage_log_errors: string[];
  /** Razón por la que usage logging fue omitido o búsqueda fue bloqueada (v1.15.7.1) */
  skipped_reason: string | null;
};

// ─── Eligibility ──────────────────────────────────────────────────────────────

export type LinkedInSearchEligibility = {
  eligible: boolean;
  skipReason: string | null;
};

export type EligibleCandidateForSearch = {
  name: string;
  domain: string | null;
  confidenceScore: number;
  currentEnrichment: LinkedInEnrichmentMetadata;
};

export function isEligibleForLinkedInSearch(
  candidate: EligibleCandidateForSearch,
  config: LinkedInSearchConfig,
): LinkedInSearchEligibility {
  if (!config.enabled) {
    return { eligible: false, skipReason: 'feature_disabled' };
  }

  if (candidate.currentEnrichment.status !== 'not_found') {
    return {
      eligible: false,
      skipReason: `enrichment_already_${candidate.currentEnrichment.status}`,
    };
  }

  if (candidate.confidenceScore < config.minConfidenceScore) {
    return { eligible: false, skipReason: 'low_confidence' };
  }

  if (!candidate.name || candidate.name.trim().length < 3) {
    return { eligible: false, skipReason: 'invalid_name' };
  }

  if ((candidate as ControlledLinkedInSearchCandidate).isBlockedByDuplicateGuard) {
    return { eligible: false, skipReason: 'duplicate_guard_blocked' };
  }

  if ((candidate as ControlledLinkedInSearchCandidate).isBlockedByEvidencePolicy) {
    return { eligible: false, skipReason: 'evidence_policy_blocked' };
  }

  return { eligible: true, skipReason: null };
}

// ─── Candidate prioritisation for LinkedIn search (v1.16K-R-C) ─────────────────

// Dominios genéricos / de correo gratuito que NO son un dominio corporativo
// confiable y por tanto restan señal para encontrar la company page.
const GENERIC_FREE_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'yahoo.es',
  'live.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'gmx.com',
]);

// Palabras conectores que delatan un nombre tipo eslogan ("Tu Partner de
// Bienestar") en lugar de una razón social canónica.
const SLOGAN_CONNECTOR_RE = /\b(tu|de|del|la|el|los|las|para|por|con|y|en|tus|su)\b/i;

/** Un dominio es confiable si tiene TLD, base > 2 chars y no es correo gratuito. */
export function hasReliableDomain(domain: string | null): boolean {
  if (!domain) return false;
  const clean = domain.trim().toLowerCase().replace(/^www\./, '');
  if (!clean.includes('.')) return false;
  if (GENERIC_FREE_DOMAINS.has(clean)) return false;
  const base = clean.split('.')[0] ?? '';
  return base.length > 2;
}

/** Un nombre parece eslogan/genérico si es muy largo o usa conectores. */
export function isSloganLikeName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return true;
  const words = trimmed.split(/\s+/);
  // 4+ palabras con un conector ("Tu Partner de Bienestar") → eslogan.
  if (words.length >= 4 && SLOGAN_CONNECTOR_RE.test(trimmed)) return true;
  // 6+ palabras casi siempre es una frase, no una razón social.
  if (words.length >= 6) return true;
  return false;
}

/**
 * Puntúa qué tan probable es encontrar una LinkedIn company page para el
 * candidato. Mayor score = se intenta primero dentro del cap del batch.
 *
 * Heurística pura (sin I/O):
 *   + dominio corporativo confiable        → +40
 *   + nombre canónico (no eslogan)         → +30
 *   + no bloqueado por duplicate guard     → +20
 *   + no bloqueado por evidence policy     → +10
 *   + confianza base (escala 0..10)        → +0..10
 *   − nombre tipo eslogan/genérico         → −30
 */
export function linkedInSearchPriorityScore(
  c: ControlledLinkedInSearchCandidate,
): number {
  let score = 0;
  if (hasReliableDomain(c.domain)) score += 40;
  if (!isSloganLikeName(c.name)) score += 30;
  if (!c.isBlockedByDuplicateGuard) score += 20;
  if (!c.isBlockedByEvidencePolicy) score += 10;
  score += (Math.max(0, Math.min(c.confidenceScore, 100)) / 100) * 10;
  if (isSloganLikeName(c.name)) score -= 30;
  return score;
}

/**
 * Devuelve los índices de `candidates` en el orden en que deben INTENTARSE las
 * búsquedas LinkedIn: candidatos elegibles primero (mejor score primero), luego
 * los no elegibles. El orden de salida de resultados sigue siendo el original;
 * esto solo decide en quién se gasta el cap del batch (v1.16K-R-C).
 *
 * Orden estable: ante empate, se respeta el índice original.
 */
export function prioritizeCandidatesForLinkedInSearch(
  candidates: ControlledLinkedInSearchCandidate[],
  config: LinkedInSearchConfig,
): number[] {
  return candidates
    .map((c, index) => ({
      index,
      eligible: isEligibleForLinkedInSearch(c, config).eligible,
      score: linkedInSearchPriorityScore(c),
    }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.index);
}

// ─── Query builder ────────────────────────────────────────────────────────────

/**
 * Mapeo countryCode → término de país legible para usar como señal blanda
 * (sin comillas) en la query. Solo países LatAm + ES/US donde opera el agente.
 * No bloquea resultados: es un keyword adicional, no una frase exacta requerida.
 */
const COUNTRY_QUERY_TERMS: Record<string, string> = {
  CO: 'Colombia',
  MX: 'Mexico',
  AR: 'Argentina',
  CL: 'Chile',
  PE: 'Peru',
  EC: 'Ecuador',
  BO: 'Bolivia',
  UY: 'Uruguay',
  PY: 'Paraguay',
  VE: 'Venezuela',
  US: 'United States',
  ES: 'Spain',
};

export type LinkedInSearchQueryOptions = {
  /** countryCode del candidato. Si mapea a un país conocido, se añade como señal blanda. */
  countryCode?: string | null;
  /**
   * Si true, añade el dominio como señal blanda (sin comillas) al final.
   * El dominio NUNCA se exige con comillas: rara vez aparece literal en el
   * snippet de LinkedIn y bloquearía el recall (causa raíz v1.16K-R-B).
   */
  includeDomainSignal?: boolean;
};

/**
 * Construye una query conservadora pero menos restrictiva para buscar la página
 * LinkedIn de la empresa (v1.16K-R-C).
 *
 * Cambio v1.16K-R-C — la query ya NO exige el dominio entre comillas. El dominio
 * literal casi nunca aparece en el snippet/título de una página company de
 * LinkedIn, por lo que `"<name>" "<domain>" site:...` bloqueaba el recall
 * (0 found en la prueba real). Ahora:
 *   - El nombre va entre comillas (señal exacta, evita falsos positivos amplios).
 *   - El operador site:linkedin.com/company va PRIMERO (sesga el motor a company pages).
 *   - El país se añade como señal blanda (sin comillas) cuando se conoce.
 *   - El dominio solo se añade como señal blanda secundaria (sin comillas) y solo
 *     cuando includeDomainSignal=true (variante de fallback).
 *
 * Reglas mantenidas:
 *   - Siempre incluye site:linkedin.com/company.
 *   - NO busca por sector, industria ni keywords genéricas.
 *   - La validación posterior estricta (evaluateLinkedInCompanyMatch) es la que
 *     decide found/ambiguous; aflojar la query no afloja la validación.
 */
export function buildLinkedInSearchQuery(
  candidateName: string,
  domain: string | null,
  options?: LinkedInSearchQueryOptions,
): string {
  const escapedName = `"${candidateName.trim()}"`;
  const parts: string[] = ['site:linkedin.com/company', escapedName];

  const cc = options?.countryCode?.toUpperCase();
  const countryTerm = cc ? COUNTRY_QUERY_TERMS[cc] : undefined;
  if (countryTerm) parts.push(countryTerm);

  if (options?.includeDomainSignal && domain) {
    const cleanDomain = domain.replace(/^www\./, '');
    if (cleanDomain.length > 2) parts.push(cleanDomain);
  }

  return parts.join(' ');
}

/**
 * Construye variantes de query para mejorar recall (v1.16K-R-C).
 *
 * Variantes (en orden de uso):
 *   Q1 (primaria, menos restrictiva): site:linkedin.com/company "<name>" [country]
 *   Q2 (fallback): site:linkedin.com/company "<name>" [country] <domain>
 *
 * Con maxQueries=1 (config estricta de producción) solo se ejecuta Q1, que es
 * la forma de mayor recall (sin dominio bloqueante). Q2 añade el dominio como
 * señal blanda únicamente cuando se permite una segunda query.
 *
 * Si no hay dominio válido, Q1 == Q2 → una sola variante.
 */
export function buildLinkedInSearchQueryVariants(
  candidateName: string,
  domain: string | null,
  maxQueries: number = 2,
  options?: LinkedInSearchQueryOptions,
): string[] {
  const q1 = buildLinkedInSearchQuery(candidateName, domain, {
    countryCode: options?.countryCode,
    includeDomainSignal: false,
  });
  const q2 = buildLinkedInSearchQuery(candidateName, domain, {
    countryCode: options?.countryCode,
    includeDomainSignal: true,
  });

  // Sin dominio válido, Q1 y Q2 son idénticas → solo 1 variante
  if (q1 === q2) {
    return [q1].slice(0, maxQueries);
  }

  return [q1, q2].slice(0, maxQueries);
}

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Función de búsqueda inyectable.
 * Recibe una query y retorna URLs encontradas.
 * En tests, retorna URLs mockeadas sin llamadas externas.
 */
export type LinkedInSearchProviderFn = (query: string) => Promise<string[]>;

/**
 * Crea un mock provider a partir de un mapa query-clave → URLs.
 * Útil para tests: la clave es una substring de la query.
 */
export function createMockLinkedInSearchProvider(
  mockResults: Record<string, string[]>,
): LinkedInSearchProviderFn {
  return async (query: string): Promise<string[]> => {
    for (const [key, urls] of Object.entries(mockResults)) {
      if (query.toLowerCase().includes(key.toLowerCase())) {
        return urls;
      }
    }
    return [];
  };
}

// ─── Candidate input type ─────────────────────────────────────────────────────

export type ControlledLinkedInSearchCandidate = {
  name: string;
  domain: string | null;
  countryCode: string | null;
  sourceTitle?: string | null;
  sourceSnippet?: string | null;
  confidenceScore: number;
  currentEnrichment: LinkedInEnrichmentMetadata;
  /** Pre-computed: true if the candidate will be blocked by active duplicate guard. */
  isBlockedByDuplicateGuard?: boolean;
  /** Pre-computed: true if the candidate will be blocked by evidence persistence policy. */
  isBlockedByEvidencePolicy?: boolean;
};

// ─── Result types ─────────────────────────────────────────────────────────────

export type ControlledLinkedInSearchResult = {
  candidateName: string;
  attempted: boolean;
  skipReason: string | null;
  enrichment: LinkedInEnrichmentMetadata;
  /** Última query ejecutada para este candidato, o null si no se ejecutó. */
  query: string | null;
};

export type RunControlledLinkedInSearchOutput = {
  results: ControlledLinkedInSearchResult[];
  batchMetadata: LinkedInBatchSearchMetadata;
  /** Payloads de usage acumulados durante la corrida. Vacío si feature disabled o dryRun. (v1.15.7) */
  usagePayloads: LinkedInUsageLogPayload[];
};

// ─── Multi-result selection ───────────────────────────────────────────────────

type MultiResultStats = {
  raw_result_count: number;
  found_urls_count: number;
  ambiguous_urls_count: number;
  rejected_urls_count: number;
};

type SelectionResult = {
  enrichment: LinkedInEnrichmentMetadata;
  stats: MultiResultStats;
};

/**
 * Evalúa múltiples URLs y selecciona el mejor resultado de enrichment.
 *
 * Estrategia de selección:
 *   1. found con mayor confidence.
 *   2. ambiguous con mayor confidence.
 *   3. Primer resultado (not_found/rejected).
 *
 * Rechaza implícitamente paths no-company (/in/, /jobs/, /school/, /feed/, /posts/)
 * a través del pipeline de enrichment existente.
 */
function selectBestEnrichmentFromUrls(
  urls: string[],
  candidate: ControlledLinkedInSearchCandidate,
  source: LinkedInEnrichmentSource,
  checkedAt: string,
): SelectionResult {
  const stats: MultiResultStats = {
    raw_result_count: urls.length,
    found_urls_count: 0,
    ambiguous_urls_count: 0,
    rejected_urls_count: 0,
  };

  if (urls.length === 0) {
    return {
      enrichment: {
        enabled: true,
        status: 'not_found',
        confidence: 0,
        warnings: ['controlled search returned no valid LinkedIn company URL.'],
        source,
        checked_at: checkedAt,
      },
      stats,
    };
  }

  // Evaluar cada URL a través del pipeline de enrichment
  const evaluations = urls.map((url) =>
    buildLinkedInEnrichmentMetadata({
      candidateName: candidate.name,
      candidateDomain: candidate.domain,
      countryCode: candidate.countryCode ?? undefined,
      sourceTitle: candidate.sourceTitle ?? undefined,
      sourceSnippet: candidate.sourceSnippet ?? undefined,
      sourceUrl: url,
      source,
      checkedAt,
    }),
  );

  for (const ev of evaluations) {
    if (ev.status === 'found') stats.found_urls_count++;
    else if (ev.status === 'ambiguous') stats.ambiguous_urls_count++;
    else if (ev.status === 'rejected') stats.rejected_urls_count++;
  }

  const found = evaluations
    .filter((e) => e.status === 'found')
    .sort((a, b) => b.confidence - a.confidence);
  if (found.length > 0) return { enrichment: found[0], stats };

  const ambiguous = evaluations
    .filter((e) => e.status === 'ambiguous')
    .sort((a, b) => b.confidence - a.confidence);
  if (ambiguous.length > 0) return { enrichment: ambiguous[0], stats };

  return { enrichment: evaluations[0], stats };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Ejecuta búsqueda controlada de LinkedIn Company para un conjunto de candidatos.
 *
 * Comportamiento v1.15.6:
 *   - Construye hasta maxQueriesPerCandidate variantes por candidato.
 *   - Se detiene por candidato en cuanto encuentra status=found.
 *   - Respeta el cap total de queries por batch (config.maxPerBatch, hard cap 5).
 *   - Soporta múltiples resultados por query: elige el mejor (found > ambiguous > rest).
 *   - Rechaza /in/, /jobs/, /school/, /feed/, /posts/ via pipeline de enrichment.
 *   - checkedAt debe ser un ISO timestamp fijo para reproducibilidad en tests.
 *
 * v1.15.7 — Usage logging:
 *   - options.usageLoggerFn: si se provee y no es dryRun, se invoca por cada provider call.
 *   - options.usageContext: contexto de trazabilidad (batchId, userId, dryRun, unitCostUsd).
 *   - El output incluye usagePayloads acumulados para flush diferido por el caller.
 */
export async function runControlledLinkedInCompanySearch(
  candidates: ControlledLinkedInSearchCandidate[],
  config: LinkedInSearchConfig,
  providerFn: LinkedInSearchProviderFn,
  checkedAt: string,
  options?: {
    usageContext?: LinkedInUsageContext;
    usageLoggerFn?: LinkedInUsageLoggerFn;
  },
): Promise<RunControlledLinkedInSearchOutput> {
  // Hard cap: nunca exceder 5 queries totales por batch, aunque config pida más
  const effectiveMaxPerBatch = Math.min(config.maxPerBatch, 5);
  // Default 1 para backward compat con configs sin maxQueriesPerCandidate.
  // DEFAULT_LINKEDIN_SEARCH_CONFIG lo fija en 2 explícitamente.
  const maxQueriesPerCandidate = config.maxQueriesPerCandidate ?? 1;
  const maxResultsPerQuery = config.maxResultsPerQuery ?? 1;

  const resolvedSource: LinkedInEnrichmentSource =
    config.provider === 'mock' ? 'mock_linkedin_search' : 'tavily_linkedin_search';

  const usageCtx = options?.usageContext;
  const usageLoggerFn = options?.usageLoggerFn;
  const isDryRun = usageCtx?.dryRun ?? false;
  const unitCostUsd = usageCtx?.unitCostUsd ?? null;

  const usagePayloads: LinkedInUsageLogPayload[] = [];
  let totalEstimatedCostUsd = 0;

  const batchMeta: LinkedInBatchSearchMetadata = {
    enabled: config.enabled,
    attempted_count: 0,
    attempted_candidate_count: 0,
    attempted_query_count: 0,
    skipped_count: 0,
    found_count: 0,
    ambiguous_count: 0,
    rejected_count: 0,
    not_found_count: 0,
    max_per_batch: effectiveMaxPerBatch,
    max_queries_per_candidate: maxQueriesPerCandidate,
    max_results_per_query: maxResultsPerQuery,
    stopped_after_found: false,
    provider: config.provider,
    samples: [],
    estimated_cost_usd: null,
    usage_logged: false,
    usage_log_attempted_count: 0,
    usage_log_success_count: 0,
    usage_log_failed_count: 0,
    usage_log_deferred_count: 0,
    usage_log_flushed_count: 0,
    usage_log_errors: [],
    skipped_reason: null,
  };

  // ── v1.15.7.1: Fail-safe guards ──────────────────────────────────────────────
  // Guard A: Tavily real mode requires usageLoggerFn for trazabilidad.
  // Running real Tavily calls without a usage logger in production is not allowed.
  if (config.provider === 'tavily' && config.enabled && !isDryRun && !usageLoggerFn) {
    batchMeta.skipped_reason = 'missing_usage_logger';
    batchMeta.skipped_count = candidates.length;
    return {
      results: candidates.map((c) => ({
        candidateName: c.name,
        attempted: false,
        skipReason: 'missing_usage_logger',
        enrichment: c.currentEnrichment,
        query: null,
      })),
      batchMetadata: batchMeta,
      usagePayloads: [],
    };
  }

  // Guard B (v1.16K-R-B): Tavily real mode requires resolved pricing.
  // Without a unit cost, every usage log would record estimated_cost_usd = 0,
  // silently breaking economic traceability and budget tracking. Fail visibly
  // (zero provider calls, explicit skipped_reason) instead of logging $0.
  if (config.provider === 'tavily' && config.enabled && !isDryRun && unitCostUsd === null) {
    batchMeta.skipped_reason = 'missing_pricing';
    batchMeta.skipped_count = candidates.length;
    return {
      results: candidates.map((c) => ({
        candidateName: c.name,
        attempted: false,
        skipReason: 'missing_pricing',
        enrichment: c.currentEnrichment,
        query: null,
      })),
      batchMetadata: batchMeta,
      usagePayloads: [],
    };
  }

  // Guard C: Tavily real mode with a logger requires a real batch_id.
  // Usage logs with batch_id=null cannot be traced back to a batch.
  if (config.provider === 'tavily' && config.enabled && !isDryRun && usageLoggerFn && (usageCtx?.batchId == null)) {
    batchMeta.skipped_reason = 'missing_batch_id';
    batchMeta.skipped_count = candidates.length;
    return {
      results: candidates.map((c) => ({
        candidateName: c.name,
        attempted: false,
        skipReason: 'missing_batch_id',
        enrichment: c.currentEnrichment,
        query: null,
      })),
      batchMetadata: batchMeta,
      usagePayloads: [],
    };
  }

  let usageLogAttemptedCount = 0;
  let usageLogSuccessCount = 0;
  let usageLogFailedCount = 0;
  const usageLogErrors: string[] = [];

  // v1.16K-R-C: attempt the most LinkedIn-findable candidates first so the batch
  // cap is spent on high-signal candidates. Results are still keyed by original
  // index and emitted in input order (the writer maps enrichments back by index).
  const attemptOrder = prioritizeCandidatesForLinkedInSearch(candidates, config);
  const resultByIndex = new Map<number, ControlledLinkedInSearchResult>();

  for (const candidateIndex of attemptOrder) {
    const candidate = candidates[candidateIndex];
    const eligibility = isEligibleForLinkedInSearch(candidate, config);

    if (!eligibility.eligible) {
      batchMeta.skipped_count++;
      resultByIndex.set(candidateIndex, {
        candidateName: candidate.name,
        attempted: false,
        skipReason: eligibility.skipReason,
        enrichment: candidate.currentEnrichment,
        query: null,
      });
      continue;
    }

    // Cap check: se compara contra queries totales ejecutadas (no candidatos)
    if (batchMeta.attempted_query_count >= effectiveMaxPerBatch) {
      batchMeta.skipped_count++;
      resultByIndex.set(candidateIndex, {
        candidateName: candidate.name,
        attempted: false,
        skipReason: 'batch_cap_reached',
        enrichment: candidate.currentEnrichment,
        query: null,
      });
      continue;
    }

    const queryVariants = buildLinkedInSearchQueryVariants(
      candidate.name,
      candidate.domain,
      maxQueriesPerCandidate,
      { countryCode: candidate.countryCode },
    );

    batchMeta.attempted_count++;
    batchMeta.attempted_candidate_count++;

    let finalEnrichment: LinkedInEnrichmentMetadata | null = null;
    let lastQuery: string = queryVariants[0] ?? '';

    for (let qi = 0; qi < queryVariants.length; qi++) {
      // Check query budget antes de cada query dentro del candidato
      if (batchMeta.attempted_query_count >= effectiveMaxPerBatch) break;

      const query = queryVariants[qi];
      batchMeta.attempted_query_count++;

      let urls: string[] = [];
      try {
        urls = await providerFn(query);
      } catch {
        urls = [];
      }

      // Para URLs vacías o error usa 'controlled_linkedin_search' (backward compat v1.15.2).
      // Solo usa resolvedSource (mock/tavily) cuando hay URLs reales que evaluar.
      const selection: ReturnType<typeof selectBestEnrichmentFromUrls> =
        urls.length === 0
          ? {
              enrichment: {
                enabled: true,
                status: 'not_found',
                confidence: 0,
                warnings: ['controlled search returned no valid LinkedIn company URL.'],
                source: 'controlled_linkedin_search',
                checked_at: checkedAt,
              },
              stats: {
                raw_result_count: 0,
                found_urls_count: 0,
                ambiguous_urls_count: 0,
                rejected_urls_count: 0,
              },
            }
          : selectBestEnrichmentFromUrls(urls, candidate, resolvedSource, checkedAt);

      if (batchMeta.samples.length < 20) {
        batchMeta.samples.push({
          candidate_name: candidate.name,
          domain: candidate.domain,
          query,
          status: selection.enrichment.status,
          company_url: selection.enrichment.company_url ?? null,
          reason:
            selection.enrichment.match_reason ??
            selection.enrichment.warnings[0] ??
            '',
          raw_result_count: selection.stats.raw_result_count,
          selected_url: selection.enrichment.company_url ?? null,
          selected_status: selection.enrichment.status,
          confidence: selection.enrichment.confidence,
          found_urls_count: selection.stats.found_urls_count,
          ambiguous_urls_count: selection.stats.ambiguous_urls_count,
          rejected_urls_count: selection.stats.rejected_urls_count,
        });
      }

      finalEnrichment = selection.enrichment;
      lastQuery = query;

      // ── Usage logging (v1.15.7 + v1.15.7.1 hardening) ──────────────────────────
      if (!isDryRun) {
        const callCostUsd = unitCostUsd !== null ? unitCostUsd : null;
        if (callCostUsd !== null) totalEstimatedCostUsd += callCostUsd;

        const payload: LinkedInUsageLogPayload = {
          usage_key: buildLinkedInUsageKey(usageCtx?.batchId, candidate.name, qi),
          provider: 'tavily',
          feature: 'linkedin_company_search',
          agent: 'agent_1',
          batch_id: usageCtx?.batchId ?? null,
          user_id: usageCtx?.userId ?? null,
          candidate_name: candidate.name,
          candidate_domain: candidate.domain,
          query,
          search_depth: 'basic',
          max_results: maxResultsPerQuery,
          estimated_cost_usd: callCostUsd,
          status: 'success',
          result_count: urls.length,
          selected_status: selection.enrichment.status,
          selected_url: selection.enrichment.company_url ?? null,
          created_at: checkedAt,
        };

        usagePayloads.push(payload);

        if (usageLoggerFn) {
          usageLogAttemptedCount++;
          try {
            await usageLoggerFn(payload);
            usageLogSuccessCount++;
          } catch (err: unknown) {
            usageLogFailedCount++;
            const rawMsg = err instanceof Error ? err.message : 'unknown_logger_error';
            if (usageLogErrors.length < 5) usageLogErrors.push(rawMsg.slice(0, 200));
          }
        }
      }

      if (selection.enrichment.status === 'found') {
        // Detener búsqueda para este candidato al encontrar found
        if (qi < queryVariants.length - 1) {
          batchMeta.stopped_after_found = true;
        }
        break;
      }
    }

    const enrichment: LinkedInEnrichmentMetadata = finalEnrichment ?? {
      enabled: true,
      status: 'not_found',
      confidence: 0,
      warnings: ['controlled search provider error.'],
      source: resolvedSource,
      checked_at: checkedAt,
    };

    if (enrichment.status === 'found') batchMeta.found_count++;
    else if (enrichment.status === 'ambiguous') batchMeta.ambiguous_count++;
    else if (enrichment.status === 'rejected') batchMeta.rejected_count++;
    else batchMeta.not_found_count++;

    resultByIndex.set(candidateIndex, {
      candidateName: candidate.name,
      attempted: true,
      skipReason: null,
      enrichment,
      query: lastQuery,
    });
  }

  // Emit results in the original input order (writer aligns enrichments by index).
  const results: ControlledLinkedInSearchResult[] = candidates.map((candidate, index) =>
    resultByIndex.get(index) ?? {
      candidateName: candidate.name,
      attempted: false,
      skipReason: 'not_processed',
      enrichment: candidate.currentEnrichment,
      query: null,
    },
  );

  // Finalise batch metadata (v1.15.7 + v1.15.7.1)
  batchMeta.estimated_cost_usd = unitCostUsd !== null ? totalEstimatedCostUsd : null;
  batchMeta.usage_log_attempted_count = usageLogAttemptedCount;
  batchMeta.usage_log_success_count = usageLogSuccessCount;
  batchMeta.usage_log_failed_count = usageLogFailedCount;
  batchMeta.usage_log_deferred_count = 0;
  batchMeta.usage_log_flushed_count = 0;
  batchMeta.usage_log_errors = usageLogErrors;
  batchMeta.usage_logged =
    usageLogAttemptedCount > 0 && usageLogFailedCount === 0 && usageLogSuccessCount === usageLogAttemptedCount;

  if (isDryRun && batchMeta.attempted_query_count > 0) {
    batchMeta.usage_logged = false;
    if (config.provider === 'tavily') {
      batchMeta.skipped_reason = 'dry_run';
    }
  }

  return { results, batchMetadata: batchMeta, usagePayloads };
}
