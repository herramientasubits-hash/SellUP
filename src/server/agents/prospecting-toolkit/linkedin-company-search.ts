/**
 * LinkedIn Company Controlled Search — Hito v1.15.2
 *
 * Búsqueda controlada de LinkedIn Company URL para candidatos donde
 * linkedin_enrichment.status === 'not_found', usando el proveedor de
 * búsqueda existente bajo caps estrictos y feature flag.
 *
 * Caps:
 *   - max 1 búsqueda por candidato
 *   - max 5 búsquedas por batch (configurable)
 *   - max_results = 1, search_depth = basic
 *
 * Query conservadora:
 *   "<company_name>" site:linkedin.com/company
 *   "<company_name>" "<domain_base>" site:linkedin.com/company  (si hay dominio)
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
};

export const DEFAULT_LINKEDIN_SEARCH_CONFIG: LinkedInSearchConfig = {
  enabled: false,
  provider: 'disabled',
  maxPerBatch: 5,
  minConfidenceScore: 70,
};

// ─── Batch metadata ───────────────────────────────────────────────────────────

export type LinkedInSearchSample = {
  candidate_name: string;
  query: string;
  status: string;
  company_url: string | null;
  reason: string;
};

export type LinkedInBatchSearchMetadata = {
  enabled: boolean;
  attempted_count: number;
  skipped_count: number;
  found_count: number;
  ambiguous_count: number;
  rejected_count: number;
  not_found_count: number;
  max_per_batch: number;
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
 *   - Si hay dominio válido, añade el base domain como señal adicional.
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
    const baseDomain = cleanDomain.split('.')[0] ?? '';
    if (baseDomain.length > 2) {
      return `${escapedName} "${baseDomain}" site:linkedin.com/company`;
    }
  }

  return `${escapedName} site:linkedin.com/company`;
}

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Función de búsqueda inyectable.
 * Recibe una query y retorna URLs encontradas (max 1 en producción).
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
  query: string | null;
};

export type RunControlledLinkedInSearchOutput = {
  results: ControlledLinkedInSearchResult[];
  batchMetadata: LinkedInBatchSearchMetadata;
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Ejecuta búsqueda controlada de LinkedIn Company para un conjunto de candidatos.
 *
 * - Solo busca cuando currentEnrichment.status === 'not_found'.
 * - Respeta el cap por batch (config.maxPerBatch).
 * - Procesa resultado con el core v1.15 (extract → evaluate → build).
 * - No hace llamadas reales si providerFn es el mock.
 * - checkedAt debe ser un ISO timestamp fijo para reproducibilidad en tests.
 */
export async function runControlledLinkedInCompanySearch(
  candidates: ControlledLinkedInSearchCandidate[],
  config: LinkedInSearchConfig,
  providerFn: LinkedInSearchProviderFn,
  checkedAt: string,
): Promise<RunControlledLinkedInSearchOutput> {
  const batchMeta: LinkedInBatchSearchMetadata = {
    enabled: config.enabled,
    attempted_count: 0,
    skipped_count: 0,
    found_count: 0,
    ambiguous_count: 0,
    rejected_count: 0,
    not_found_count: 0,
    max_per_batch: config.maxPerBatch,
    provider: config.provider,
    samples: [],
  };

  const results: ControlledLinkedInSearchResult[] = [];

  for (const candidate of candidates) {
    // Check eligibility (feature flag, status, confidence)
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

    // Check batch cap
    if (batchMeta.attempted_count >= config.maxPerBatch) {
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

    const query = buildLinkedInSearchQuery(candidate.name, candidate.domain);
    batchMeta.attempted_count++;

    let updatedEnrichment: LinkedInEnrichmentMetadata;

    try {
      const urls = await providerFn(query);

      if (urls.length === 0) {
        updatedEnrichment = {
          enabled: true,
          status: 'not_found',
          confidence: 0,
          warnings: ['controlled search returned no valid LinkedIn company URL.'],
          source: 'controlled_linkedin_search',
          checked_at: checkedAt,
        };
        batchMeta.not_found_count++;
      } else {
        // Resolve source label based on provider
        const resolvedSource: LinkedInEnrichmentSource =
          config.provider === 'mock' ? 'mock_linkedin_search' : 'tavily_linkedin_search';

        // Process through v1.15 core: extract → evaluate → build
        updatedEnrichment = buildLinkedInEnrichmentMetadata({
          candidateName: candidate.name,
          candidateDomain: candidate.domain,
          countryCode: candidate.countryCode ?? undefined,
          sourceTitle: candidate.sourceTitle ?? undefined,
          sourceSnippet: candidate.sourceSnippet ?? undefined,
          // Inject the found URL as the sourceUrl so the extractor picks it up
          sourceUrl: urls[0],
          source: resolvedSource,
          checkedAt,
        });

        if (updatedEnrichment.status === 'found') {
          batchMeta.found_count++;
        } else if (updatedEnrichment.status === 'ambiguous') {
          batchMeta.ambiguous_count++;
        } else if (updatedEnrichment.status === 'rejected') {
          batchMeta.rejected_count++;
        } else {
          batchMeta.not_found_count++;
        }
      }
    } catch {
      updatedEnrichment = {
        enabled: true,
        status: 'not_found',
        confidence: 0,
        warnings: ['controlled search provider error.'],
        source: 'controlled_linkedin_search',
        checked_at: checkedAt,
      };
      batchMeta.not_found_count++;
    }

    if (batchMeta.samples.length < 10) {
      batchMeta.samples.push({
        candidate_name: candidate.name,
        query,
        status: updatedEnrichment.status,
        company_url: updatedEnrichment.company_url ?? null,
        reason:
          updatedEnrichment.match_reason ??
          updatedEnrichment.warnings[0] ??
          '',
      });
    }

    results.push({
      candidateName: candidate.name,
      attempted: true,
      skipReason: null,
      enrichment: updatedEnrichment,
      query,
    });
  }

  return { results, batchMetadata: batchMeta };
}
