/**
 * Rich Profile Controlled Enrichment — Agent 1 v1.16B
 *
 * Arquitectura controlada para enriquecimiento externo de rich_profile.
 * Sin llamadas reales en este hito. Sin Tavily. Sin LLM.
 *
 * Este módulo provee:
 *   - Config default (disabled por defecto)
 *   - Provider interface + mock provider
 *   - Eligibility gate (quién califica para enrichment)
 *   - Query builder determinístico
 *   - Output merge hacia CandidateRichProfileV1 (función pura)
 *   - Usage payload contract (para logging diferido)
 *   - Batch runner con cap total maxPerBatch
 *
 * Reglas:
 *   - enabled=false por defecto → 0 llamadas, 0 payloads
 *   - provider='disabled' → gate rechaza todo sin llamar proveedor
 *   - maxPerBatch limita queries totales del enrichment, no candidatos
 *   - No inventa ciudad, país ni tamaño
 *   - No toca vendors, partners, content_providers, technology_providers
 *   - No toca duplicate_guard_blocked ni evidence_policy_blocked
 */

import type { CandidateRichProfileV1 } from './candidate-rich-profile';

// ─── Config ───────────────────────────────────────────────────────────────────

export type RichProfileEnrichmentProvider = 'disabled' | 'mock' | 'tavily';

export type RichProfileEnrichmentConfig = {
  enabled: boolean;
  provider: RichProfileEnrichmentProvider;
  /** Máximo de queries totales por batch (no por candidato). */
  maxPerBatch: number;
  /** Máximo de queries por candidato. */
  maxQueriesPerCandidate: number;
  /** Score mínimo para ser elegible. */
  minConfidenceScore: number;
  enrichCity: boolean;
  enrichSize: boolean;
  enrichDescription: boolean;
};

export const DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG: RichProfileEnrichmentConfig = {
  enabled: false,
  provider: 'disabled',
  maxPerBatch: 3,
  maxQueriesPerCandidate: 1,
  minConfidenceScore: 60,
  enrichCity: true,
  enrichSize: true,
  enrichDescription: false,
};

// ─── Tipos de candidato para enrichment ───────────────────────────────────────

export type RichProfileEnrichmentCandidate = {
  candidateId?: string;
  name: string;
  domain?: string | null;
  website?: string | null;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  confidenceScore?: number | null;
  fitScore?: number | null;
  richProfile?: CandidateRichProfileV1 | null;
  isBlockedByDuplicateGuard?: boolean;
  isBlockedByEvidencePolicy?: boolean;
};

// ─── Resultado del proveedor ───────────────────────────────────────────────────

export type RichProfileEnrichmentProviderResult = {
  status: 'found' | 'partial' | 'not_found' | 'failed';
  city?: string | null;
  hq_country?: string | null;
  size_range?: string | null;
  description?: string | null;
  evidence_url?: string | null;
  evidence_summary?: string | null;
  confidence?: number | null;
  warnings?: string[];
};

// ─── Provider interface ───────────────────────────────────────────────────────

export type RichProfileEnrichmentProviderFn = (
  candidate: RichProfileEnrichmentCandidate,
  query: string,
) => Promise<RichProfileEnrichmentProviderResult>;

// ─── Output merge ─────────────────────────────────────────────────────────────

export type RichProfileEnrichmentResultWithContext = {
  candidate: RichProfileEnrichmentCandidate;
  query: string;
  providerResult: RichProfileEnrichmentProviderResult;
  /** Costo estimado de esta llamada (0 para mock, unitCostUsd para real). */
  estimatedCostUsd: number;
  /** True si el proveedor fue un proveedor externo real o mock simulando external. */
  externalCallUsed: boolean;
};

export type RichProfileEnrichmentBatchMetadata = {
  enabled: boolean;
  provider: RichProfileEnrichmentProvider;
  attempted_candidate_count: number;
  attempted_query_count: number;
  found_count: number;
  partial_count: number;
  not_found_count: number;
  skipped_count: number;
  failed_count: number;
  estimated_cost_usd: number;
  usage_logged: boolean;
  skipped_reasons: Record<string, number>;
  samples: Array<{
    candidate_name: string;
    candidate_domain: string | null;
    status: string;
    city: string | null;
    size_range: string | null;
  }>;
};

// ─── Usage payload contract ───────────────────────────────────────────────────

export type RichProfileEnrichmentUsagePayload = {
  usage_key: string;
  provider: RichProfileEnrichmentProvider;
  feature: 'rich_profile_enrichment';
  agent: 'agent_1';
  batch_id: string | null;
  user_id: string | null;
  candidate_name: string;
  candidate_domain: string | null;
  query_type: 'company_profile';
  query: string;
  search_depth: 'basic';
  max_results: number;
  estimated_cost_usd: number;
  status: 'success' | 'failed' | 'skipped';
  result_count: number;
  selected_status: RichProfileEnrichmentProviderResult['status'] | 'skipped';
  selected_url: string | null;
  created_at: string;
};

export type RichProfileEnrichmentUsageLoggerFn = (
  payload: RichProfileEnrichmentUsagePayload,
) => Promise<void>;

// ─── Usage key builder ────────────────────────────────────────────────────────

/**
 * Clave determinística de uso por candidato.
 * Formato: {provider}:rich_profile_enrichment:{batchId}:{candidateSlug}:q
 * Mismo candidato + mismo lote + mismo provider → misma clave. Idempotente.
 */
export function buildRichProfileEnrichmentUsageKey(
  provider: RichProfileEnrichmentProvider,
  batchId: string,
  candidateName: string,
): string {
  const slug = candidateName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
  return `${provider}:rich_profile_enrichment:${batchId}:${slug}:q`;
}

// ─── Eligibility gate ─────────────────────────────────────────────────────────

export type EligibilitySkipReason =
  | 'enrichment_disabled'
  | 'provider_disabled'
  | 'duplicate_guard_blocked'
  | 'evidence_policy_blocked'
  | 'low_confidence'
  | 'missing_domain_or_website'
  | 'no_rich_profile'
  | 'city_and_size_already_known'
  | 'non_sales_relationship'
  | 'guard_missing_batch_id'
  | 'guard_missing_usage_logger'
  | 'guard_missing_unit_cost';

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilitySkipReason };

const NON_ELIGIBLE_RELATIONSHIP_TYPES = new Set<string>([
  'vendor',
  'partner',
  'content_provider',
  'technology_provider',
]);

export function evaluateRichProfileEnrichmentEligibility(
  candidate: RichProfileEnrichmentCandidate,
  config: RichProfileEnrichmentConfig,
): EligibilityResult {
  if (!config.enabled) {
    return { eligible: false, reason: 'enrichment_disabled' };
  }

  if (config.provider === 'disabled') {
    return { eligible: false, reason: 'provider_disabled' };
  }

  if (candidate.isBlockedByDuplicateGuard) {
    return { eligible: false, reason: 'duplicate_guard_blocked' };
  }

  if (candidate.isBlockedByEvidencePolicy) {
    return { eligible: false, reason: 'evidence_policy_blocked' };
  }

  const score = candidate.confidenceScore ?? 0;
  if (score < config.minConfidenceScore) {
    return { eligible: false, reason: 'low_confidence' };
  }

  if (!candidate.domain && !candidate.website) {
    return { eligible: false, reason: 'missing_domain_or_website' };
  }

  if (!candidate.richProfile) {
    return { eligible: false, reason: 'no_rich_profile' };
  }

  // Relationship type check: only sales_prospect and unknown are eligible
  const relType = candidate.richProfile.classification.relationship_type;
  if (relType && NON_ELIGIBLE_RELATIONSHIP_TYPES.has(relType)) {
    return { eligible: false, reason: 'non_sales_relationship' };
  }
  if (candidate.richProfile.classification.not_sales_prospect === true) {
    return { eligible: false, reason: 'non_sales_relationship' };
  }

  // Only enrich if city is null OR size is unknown — otherwise skip
  const cityKnown = !!candidate.richProfile.location.city;
  const sizeKnown = candidate.richProfile.size.status !== 'unknown';
  if (cityKnown && sizeKnown) {
    return { eligible: false, reason: 'city_and_size_already_known' };
  }

  return { eligible: true };
}

// ─── Query builder ────────────────────────────────────────────────────────────

/**
 * Construye query determinística para enrichment de company profile.
 * No ejecuta nada. Puro string building.
 *
 * Ejemplo: `"Globant" "globant.com" company headquarters employees official`
 */
export function buildRichProfileEnrichmentQuery(
  candidate: RichProfileEnrichmentCandidate,
): string {
  const parts: string[] = [];

  parts.push(`"${candidate.name}"`);

  const domain = candidate.domain ?? extractDomainFromUrl(candidate.website ?? '');
  if (domain) {
    parts.push(`"${domain}"`);
  }

  parts.push('company headquarters employees official');

  return parts.join(' ');
}

function extractDomainFromUrl(urlOrDomain: string): string | null {
  if (!urlOrDomain) return null;
  try {
    const normalized = urlOrDomain.includes('://') ? urlOrDomain : `https://${urlOrDomain}`;
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// ─── Output merge (función pura) ─────────────────────────────────────────────

/**
 * Merge del resultado de enrichment hacia CandidateRichProfileV1.
 * Función pura — no muta el profile original.
 *
 * Reglas:
 *   - Solo llena campos que realmente vienen en result (no inventa)
 *   - city: solo si result.city es string no vacío
 *   - hq_country: solo si result.hq_country es string no vacío
 *   - size_range: solo si result.size_range es string no vacío
 *   - description.short: solo si result.description es string no vacío Y profile no tiene description
 *   - evidence_url: solo si result.evidence_url existe y candidate no tiene primary_url
 *     o result.confidence > evidencia actual
 *   - provenance.enrichment_level → 'controlled'
 *   - provenance.external_calls_used → true si externalCallUsed=true
 *   - provenance.cost_usd suma estimatedCostUsd
 *   - notes.requires_human_review=true si size fue estimado o city fue inferida de snippet
 */
export function mergeRichProfileEnrichmentResult(
  profile: CandidateRichProfileV1,
  result: RichProfileEnrichmentProviderResult,
  opts: {
    externalCallUsed: boolean;
    estimatedCostUsd: number;
  },
): CandidateRichProfileV1 {
  const { externalCallUsed, estimatedCostUsd } = opts;

  // Location
  const cityFilled = typeof result.city === 'string' && result.city.trim().length > 0;
  const hqCountryFilled =
    typeof result.hq_country === 'string' && result.hq_country.trim().length > 0;

  const newLocation: CandidateRichProfileV1['location'] = {
    ...profile.location,
    ...(cityFilled
      ? {
          city: result.city!.trim(),
          source:
            result.evidence_url
              ? 'website'
              : 'snippet',
        }
      : {}),
    ...(hqCountryFilled ? { hq_country: result.hq_country!.trim() } : {}),
  };

  // Size
  const sizeFilled =
    typeof result.size_range === 'string' && result.size_range.trim().length > 0;

  const newSize: CandidateRichProfileV1['size'] = sizeFilled
    ? {
        ...profile.size,
        estimated_range: result.size_range!.trim(),
        status: 'estimated',
        source: result.evidence_url ? 'website' : 'snippet',
      }
    : profile.size;

  // Description
  const descFilled =
    typeof result.description === 'string' && result.description.trim().length > 0;
  const hasExistingDesc = !!profile.description.short;

  const newDescription: CandidateRichProfileV1['description'] =
    descFilled && !hasExistingDesc
      ? { short: result.description!.trim(), source: 'snippet' }
      : profile.description;

  // Evidence
  const evidenceFilled =
    typeof result.evidence_url === 'string' && result.evidence_url.trim().length > 0;
  const hasPrimaryUrl = !!profile.evidence.primary_url;
  const resultConfidence = result.confidence ?? 0;
  const profileConfidence = profile.confidence.confidence_score ?? 0;

  const newEvidence: CandidateRichProfileV1['evidence'] =
    evidenceFilled && (!hasPrimaryUrl || resultConfidence > profileConfidence)
      ? {
          ...profile.evidence,
          primary_url: result.evidence_url!.trim(),
          evidence_summary: result.evidence_summary?.slice(0, 300) ?? profile.evidence.evidence_summary,
        }
      : profile.evidence;

  // Notes
  const requiresReview =
    sizeFilled ||
    (cityFilled && !result.evidence_url) || // city inferred from snippet
    profile.notes.requires_human_review === true;

  const missingAfterMerge = (profile.notes.missing_fields ?? []).filter((f) => {
    if (f === 'city' && cityFilled) return false;
    if (f === 'size' && sizeFilled) return false;
    return true;
  });

  const newNotes: CandidateRichProfileV1['notes'] = {
    ...profile.notes,
    requires_human_review: requiresReview,
    missing_fields: missingAfterMerge,
  };

  // Provenance — cost_usd accumulated
  const newCostUsd = profile.provenance.cost_usd + estimatedCostUsd;

  const newProvenance: CandidateRichProfileV1['provenance'] = {
    ...profile.provenance,
    enrichment_level: 'controlled',
    external_calls_used: externalCallUsed,
    cost_usd: newCostUsd,
  };

  return {
    ...profile,
    location: newLocation,
    size: newSize,
    description: newDescription,
    evidence: newEvidence,
    notes: newNotes,
    provenance: newProvenance,
  };
}

// ─── Usage payload builder ────────────────────────────────────────────────────

export function buildRichProfileEnrichmentUsagePayload(opts: {
  candidate: RichProfileEnrichmentCandidate;
  query: string;
  config: RichProfileEnrichmentConfig;
  providerResult: RichProfileEnrichmentProviderResult | null;
  estimatedCostUsd: number;
  batchId: string | null;
  userId: string | null;
  createdAt: string;
  maxResults?: number;
}): RichProfileEnrichmentUsagePayload {
  const { candidate, query, config, providerResult, estimatedCostUsd, batchId, userId, createdAt } = opts;

  const status = providerResult === null
    ? 'skipped'
    : providerResult.status === 'failed'
      ? 'failed'
      : 'success';

  const selectedStatus: RichProfileEnrichmentUsagePayload['selected_status'] =
    providerResult === null ? 'skipped' : providerResult.status;

  const effectiveBatchId = batchId ?? 'no_batch';
  const usageKey = buildRichProfileEnrichmentUsageKey(config.provider, effectiveBatchId, candidate.name);

  return {
    usage_key: usageKey,
    provider: config.provider,
    feature: 'rich_profile_enrichment',
    agent: 'agent_1',
    batch_id: batchId,
    user_id: userId,
    candidate_name: candidate.name,
    candidate_domain: candidate.domain ?? null,
    query_type: 'company_profile',
    query,
    search_depth: 'basic',
    max_results: opts.maxResults ?? 3,
    estimated_cost_usd: estimatedCostUsd,
    status,
    result_count: providerResult && providerResult.status !== 'failed' ? 1 : 0,
    selected_status: selectedStatus,
    selected_url: providerResult?.evidence_url ?? null,
    created_at: createdAt,
  };
}

// ─── Mock provider ────────────────────────────────────────────────────────────

export type MockEnrichmentScenario =
  | 'found_city_and_size'
  | 'partial_city_only'
  | 'partial_size_only'
  | 'not_found'
  | 'failed'
  | 'vague_no_city_no_size';

/**
 * Crea un mock provider para tests.
 * El mock simula una llamada externa (externalCallUsed=true en el runner).
 */
export function createMockRichProfileEnrichmentProvider(
  scenario: MockEnrichmentScenario,
  unitCostUsd = 0.01,
): {
  providerFn: RichProfileEnrichmentProviderFn;
  unitCostUsd: number;
  callCount: () => number;
} {
  let calls = 0;

  const providerFn: RichProfileEnrichmentProviderFn = async (
    _candidate,
    _query,
  ): Promise<RichProfileEnrichmentProviderResult> => {
    calls++;

    switch (scenario) {
      case 'found_city_and_size':
        return {
          status: 'found',
          city: 'Bogotá',
          hq_country: 'Colombia',
          size_range: '201-500',
          evidence_url: 'https://example.com/about',
          evidence_summary: 'Empresa tecnológica con sede en Bogotá, 200-500 empleados.',
          confidence: 80,
        };

      case 'partial_city_only':
        return {
          status: 'partial',
          city: 'Medellín',
          hq_country: null,
          size_range: null,
          evidence_url: null,
          confidence: 60,
        };

      case 'partial_size_only':
        return {
          status: 'partial',
          city: null,
          hq_country: null,
          size_range: '51-200',
          evidence_url: null,
          confidence: 55,
        };

      case 'not_found':
        return {
          status: 'not_found',
          city: null,
          hq_country: null,
          size_range: null,
          evidence_url: null,
          confidence: null,
        };

      case 'failed':
        return {
          status: 'failed',
          warnings: ['provider_timeout'],
        };

      case 'vague_no_city_no_size':
        return {
          status: 'found',
          city: null,
          hq_country: null,
          size_range: null,
          evidence_summary:
            'Es una empresa de tecnología reconocida en la región latinoamericana.',
          confidence: 40,
        };
    }
  };

  return { providerFn, unitCostUsd, callCount: () => calls };
}

// ─── Batch runner ─────────────────────────────────────────────────────────────

export type RichProfileEnrichmentRunnerOpts = {
  config: RichProfileEnrichmentConfig;
  providerFn: RichProfileEnrichmentProviderFn;
  unitCostUsd?: number;
  batchId?: string | null;
  userId?: string | null;
  clockFn?: () => string;
  dryRun?: boolean;
  usageLoggerFn?: RichProfileEnrichmentUsageLoggerFn;
};

export type RichProfileEnrichmentRunnerOutput = {
  enrichedProfiles: Array<{
    candidate: RichProfileEnrichmentCandidate;
    enrichedProfile: CandidateRichProfileV1;
    providerResult: RichProfileEnrichmentProviderResult;
    usagePayload: RichProfileEnrichmentUsagePayload;
  }>;
  skipped: Array<{
    candidate: RichProfileEnrichmentCandidate;
    reason: EligibilitySkipReason | 'batch_cap_reached';
  }>;
  usagePayloads: RichProfileEnrichmentUsagePayload[];
  batchMetadata: RichProfileEnrichmentBatchMetadata;
};

/**
 * Corre el enrichment controlado sobre un batch de candidatos.
 *
 * - No ejecuta nada si config.enabled=false
 * - Respeta maxPerBatch (cap total de queries, no de candidatos)
 * - Genera usage payloads para cada llamada
 * - Función pura excepto por las llamadas al providerFn
 */
export async function runRichProfileEnrichmentBatch(
  candidates: RichProfileEnrichmentCandidate[],
  opts: RichProfileEnrichmentRunnerOpts,
): Promise<RichProfileEnrichmentRunnerOutput> {
  const { config, providerFn, unitCostUsd = 0, batchId = null, userId = null } = opts;
  const clock = opts.clockFn ?? (() => new Date().toISOString());

  // ─── Production guards for Tavily ─────────────────────────────────────────
  if (config.enabled && config.provider === 'tavily' && !opts.dryRun) {
    const guardReason: EligibilitySkipReason | null =
      !batchId ? 'guard_missing_batch_id' :
      !opts.usageLoggerFn ? 'guard_missing_usage_logger' :
      (opts.unitCostUsd === undefined || opts.unitCostUsd === null) ? 'guard_missing_unit_cost' :
      null;

    if (guardReason) {
      const skippedAll = candidates.map((c) => ({ candidate: c, reason: guardReason }));
      const reasons: Record<string, number> = { [guardReason]: candidates.length };
      return {
        enrichedProfiles: [],
        skipped: skippedAll,
        usagePayloads: [],
        batchMetadata: {
          enabled: config.enabled,
          provider: config.provider,
          attempted_candidate_count: 0,
          attempted_query_count: 0,
          found_count: 0,
          partial_count: 0,
          not_found_count: 0,
          skipped_count: candidates.length,
          failed_count: 0,
          estimated_cost_usd: 0,
          usage_logged: false,
          skipped_reasons: reasons,
          samples: [],
        },
      };
    }
  }

  const enrichedProfiles: RichProfileEnrichmentRunnerOutput['enrichedProfiles'] = [];
  const skipped: RichProfileEnrichmentRunnerOutput['skipped'] = [];
  const usagePayloads: RichProfileEnrichmentUsagePayload[] = [];

  const skippedReasons: Record<string, number> = {};
  let queriesUsed = 0;
  let foundCount = 0;
  let partialCount = 0;
  let notFoundCount = 0;
  let failedCount = 0;
  let attemptedCandidateCount = 0;
  let estimatedTotalCostUsd = 0;

  for (const candidate of candidates) {
    // Check eligibility
    const eligibility = evaluateRichProfileEnrichmentEligibility(candidate, config);
    if (!eligibility.eligible) {
      skipped.push({ candidate, reason: eligibility.reason });
      skippedReasons[eligibility.reason] = (skippedReasons[eligibility.reason] ?? 0) + 1;
      continue;
    }

    // Check batch cap
    if (queriesUsed >= config.maxPerBatch) {
      skipped.push({ candidate, reason: 'batch_cap_reached' });
      skippedReasons['batch_cap_reached'] = (skippedReasons['batch_cap_reached'] ?? 0) + 1;
      continue;
    }

    attemptedCandidateCount++;
    const query = buildRichProfileEnrichmentQuery(candidate);

    let providerResult: RichProfileEnrichmentProviderResult;
    try {
      providerResult = await providerFn(candidate, query);
    } catch (err) {
      providerResult = {
        status: 'failed',
        warnings: [err instanceof Error ? err.message : 'unknown_error'],
      };
    }

    queriesUsed++;
    const callCostUsd = unitCostUsd;
    estimatedTotalCostUsd += callCostUsd;

    // Build usage payload
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate,
      query,
      config,
      providerResult,
      estimatedCostUsd: callCostUsd,
      batchId,
      userId,
      createdAt: clock(),
    });
    usagePayloads.push(payload);

    // Count results
    if (providerResult.status === 'found') foundCount++;
    else if (providerResult.status === 'partial') partialCount++;
    else if (providerResult.status === 'not_found') notFoundCount++;
    else if (providerResult.status === 'failed') {
      failedCount++;
      // Don't merge failed results — keep original profile
      enrichedProfiles.push({
        candidate,
        enrichedProfile: candidate.richProfile!,
        providerResult,
        usagePayload: payload,
      });
      continue;
    }

    // Merge result into rich profile
    const enrichedProfile = mergeRichProfileEnrichmentResult(
      candidate.richProfile!,
      providerResult,
      { externalCallUsed: true, estimatedCostUsd: callCostUsd },
    );

    enrichedProfiles.push({ candidate, enrichedProfile, providerResult, usagePayload: payload });
  }

  const samples = enrichedProfiles.slice(0, 5).map((e) => ({
    candidate_name: e.candidate.name,
    candidate_domain: e.candidate.domain ?? null,
    status: e.providerResult.status,
    city: e.enrichedProfile.location.city ?? null,
    size_range: e.enrichedProfile.size.estimated_range ?? null,
  }));

  const batchMetadata: RichProfileEnrichmentBatchMetadata = {
    enabled: config.enabled,
    provider: config.provider,
    attempted_candidate_count: attemptedCandidateCount,
    attempted_query_count: queriesUsed,
    found_count: foundCount,
    partial_count: partialCount,
    not_found_count: notFoundCount,
    skipped_count: skipped.length,
    failed_count: failedCount,
    estimated_cost_usd: estimatedTotalCostUsd,
    usage_logged: false,
    skipped_reasons: skippedReasons,
    samples,
  };

  return { enrichedProfiles, skipped, usagePayloads, batchMetadata };
}
