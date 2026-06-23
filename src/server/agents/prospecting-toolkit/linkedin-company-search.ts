/**
 * LinkedIn Company Controlled Search — Hito v1.15.6
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
  maxResultsPerQuery: 1,
};

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

// ─── Query builder ────────────────────────────────────────────────────────────

/**
 * Construye una query conservadora para buscar la página LinkedIn de la empresa.
 *
 * Reglas:
 *   - Siempre usa comillas alrededor del nombre exacto.
 *   - Si hay dominio válido, añade el dominio completo como señal adicional.
 *   - NO busca por sector, país, keywords genéricas, ni industria.
 *   - Siempre termina en site:linkedin.com/company.
 */
export function buildLinkedInSearchQuery(
  candidateName: string,
  domain: string | null,
): string {
  const escapedName = `"${candidateName.trim()}"`;

  if (domain) {
    const cleanDomain = domain.replace(/^www\./, '');
    if (cleanDomain.length > 2) {
      return `${escapedName} "${cleanDomain}" site:linkedin.com/company`;
    }
  }

  return `${escapedName} site:linkedin.com/company`;
}

/**
 * Construye variantes de query para mejorar recall.
 *
 * Variantes (en orden de precisión):
 *   Q1: "<name>" "<domain>" site:linkedin.com/company  (si hay dominio válido)
 *   Q2: "<name>" site:linkedin.com/company             (siempre)
 *
 * Si no hay dominio o el dominio es inválido, Q1 == Q2, por lo que solo
 * se retorna una variante única.
 *
 * Reglas:
 *   - NO usa sector, país, keywords genéricas, industria.
 *   - Devuelve máximo maxQueries variantes únicas.
 */
export function buildLinkedInSearchQueryVariants(
  candidateName: string,
  domain: string | null,
  maxQueries: number = 2,
): string[] {
  const q1 = buildLinkedInSearchQuery(candidateName, domain);
  const q2 = buildLinkedInSearchQuery(candidateName, null);

  // Si no hay dominio o dominio inválido, Q1 y Q2 son idénticas → solo 1 variante
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
 */
export async function runControlledLinkedInCompanySearch(
  candidates: ControlledLinkedInSearchCandidate[],
  config: LinkedInSearchConfig,
  providerFn: LinkedInSearchProviderFn,
  checkedAt: string,
): Promise<RunControlledLinkedInSearchOutput> {
  // Hard cap: nunca exceder 5 queries totales por batch, aunque config pida más
  const effectiveMaxPerBatch = Math.min(config.maxPerBatch, 5);
  // Default 1 para backward compat con configs sin maxQueriesPerCandidate.
  // DEFAULT_LINKEDIN_SEARCH_CONFIG lo fija en 2 explícitamente.
  const maxQueriesPerCandidate = config.maxQueriesPerCandidate ?? 1;
  const maxResultsPerQuery = config.maxResultsPerQuery ?? 1;

  const resolvedSource: LinkedInEnrichmentSource =
    config.provider === 'mock' ? 'mock_linkedin_search' : 'tavily_linkedin_search';

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
  };

  const results: ControlledLinkedInSearchResult[] = [];

  for (const candidate of candidates) {
    const eligibility = isEligibleForLinkedInSearch(candidate, config);

    if (!eligibility.eligible) {
      batchMeta.skipped_count++;
      results.push({
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
      results.push({
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

    results.push({
      candidateName: candidate.name,
      attempted: true,
      skipReason: null,
      enrichment,
      query: lastQuery,
    });
  }

  return { results, batchMetadata: batchMeta };
}
