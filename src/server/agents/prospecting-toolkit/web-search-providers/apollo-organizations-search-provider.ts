/**
 * Web Search Provider — Apollo Organizations (v1.16K-X)
 *
 * Adapter de Apollo organization search para Agent 1 company discovery.
 *
 * Modos de operación:
 *   ENABLE_APOLLO_COMPANY_SEARCH=false (default) → skipped, sin llamada real, sin créditos.
 *   ENABLE_APOLLO_COMPANY_SEARCH=true            → llamada real a Apollo con guardrails duros.
 *
 * Guardrails (real-limited):
 *   MAX_APOLLO_ORGANIZATIONS_PER_RUN    = 10  orgs como máximo por invocación.
 *   MAX_APOLLO_ORGANIZATIONS_CREDITS    = 10  créditos estimados máximos por invocación.
 *   1 organización retornada = 1 crédito estimado.
 *
 * Errores controlados:
 *   - API key faltante       → skipped con skipReason 'apollo_api_key_missing'.
 *   - HTTP 401/403           → error controlado, no throw.
 *   - HTTP 429/quota         → quota_exceeded, no retry agresivo.
 *   - Org sin name           → descartada silenciosamente.
 *   - Cualquier otro error   → error controlado.
 *
 * Reglas críticas:
 *   - No usa searchApolloPeople().
 *   - No modifica Tavily ni Agent 2A.
 *   - No reemplaza Tavily como default.
 */

import type { WebSearchInput, WebSearchOutput, WebSearchResult } from '../types';
import { isApolloCompanySearchEnabled } from '@/lib/feature-flags.server';
import {
  searchApolloOrganizations,
  type ApolloOrganization,
} from '@/server/integrations/apollo-client';
import {
  buildApolloOrgsUsageKey,
  realLogApolloOrgsUsage,
  type ApolloOrgsUsageContext,
} from '../apollo-organizations-usage-logging';
import {
  buildApolloOrganizationsSearchParams,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import { resolveApolloMaxResultsPerQuery } from '../apollo-cost-guardrails';
import { applyApolloSectorRelevanceGate } from '../apollo-sector-relevance-gate';

// ─── Versión de mapping de perfil ────────────────────────────────────────────

export const APOLLO_PROFILE_MAPPING_VERSION = 'v1.16K-AE';

/** Umbral ICP de tamaño (empleados). Sincronizado con icp-size-gate.ts DEFAULT_THRESHOLD. */
export const ICP_SIZE_THRESHOLD = 200;

// ─── Tipos internos ───────────────────────────────────────────────────────────

/** Subconjunto mínimo de ApolloOrganization relevante para company discovery. */
export type ApolloOrganizationInput = {
  id: string;
  name: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  city?: string | null;
  country?: string | null;
  short_description?: string | null;
  keywords?: string[];
};

/** Perfil Apollo sanitizado — sin secretos, sin PII personal. */
export type ApolloProfileMetadata = {
  organization_id: string;
  website_url: string | null;
  primary_domain: string | null;
  linkedin_url: string | null;
  industry: string | null;
  keywords: string[];
  estimated_num_employees: number | null;
  employee_count_source: 'estimated_num_employees' | 'employee_count' | 'none';
  city: string | null;
  country: string | null;
  short_description: string | null;
  /** Nombres de campos no vacíos presentes en la respuesta Apollo — útil para debug. */
  raw_fields_present: string[];
  mapping_version: string;
};

export type SizeEvidenceStatus = 'passes' | 'below_threshold' | 'unknown';

/** Evidencia de tamaño para ICP gate — sin inventar datos. */
export type SizeEvidenceMetadata = {
  source: 'apollo';
  employee_count: number | null;
  threshold: number;
  status: SizeEvidenceStatus;
  reason: string;
};

/** Metadata estructurada que el provider inyecta en cada WebSearchResult. */
export type ApolloOrganizationSearchResultMetadata = {
  apollo_organization_id: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employee_count: number | null;
  city: string | null;
  country: string | null;
  linkedin_url: string | null;
  keywords: string[];
  short_description: string | null;
  source_provider: 'apollo';
  source_key: 'apollo_organizations';
  source_type: 'structured_company_database';
  apollo_profile: ApolloProfileMetadata;
  size_evidence: SizeEvidenceMetadata;
};

/** Metadata de uso registrada en cada WebSearchOutput. */
export type ApolloOrganizationsUsageMetadata = {
  operation_key: 'organizations_search';
  provider_key: 'apollo';
  credits_used: number;
  estimated_cost_usd: number;
  status: 'dry_run' | 'real' | 'skipped' | 'error' | 'quota_exceeded';
};

// ─── Guardrails ───────────────────────────────────────────────────────────────

const MAX_APOLLO_ORGANIZATIONS_PER_RUN = 10;
const MAX_APOLLO_ORGANIZATIONS_CREDITS = 10;
const APOLLO_ORGANIZATIONS_UNIT_COST_USD = 0.00875;

function cappedMaxResults(requested: number): { cap: number; wasCapped: boolean; maxResultsCapSource: string } {
  // Two-layer cap: env-configurable QA guardrail first, then hard provider limit.
  const envCap = resolveApolloMaxResultsPerQuery();
  const cap = Math.min(requested, envCap, MAX_APOLLO_ORGANIZATIONS_PER_RUN);
  const maxResultsCapSource = cap < requested ? 'agent1_apollo_cost_guardrail' : 'none';
  return { cap, wasCapped: cap < requested, maxResultsCapSource };
}

// ─── Mapping puro Apollo org → WebSearchResult ────────────────────────────────

/**
 * Mapea un ApolloOrganizationInput al contrato WebSearchResult de Agent 1.
 * Pura: no hace llamadas externas, no tiene side effects.
 * Lanza si name está ausente (candidato inválido no debe fluir al pipeline).
 */
export function mapApolloOrganizationToSearchResult(
  org: ApolloOrganizationInput,
  rank: number,
): WebSearchResult {
  if (!org.name?.trim()) {
    throw new Error(
      `Apollo organization id=${org.id} has no name — cannot map to search result`,
    );
  }

  const domain = org.primary_domain ?? extractDomain(org.website_url) ?? null;
  const website = org.website_url ?? (domain ? `https://${domain}` : null);
  const url = website ?? `https://apollo.io/companies/${org.id}`;

  // Snippet enriquecido — incluye description y keywords para el sector gate.
  const snippetParts: string[] = [`Empresa: ${org.name}`];
  if (org.industry) snippetParts.push(`Industria: ${org.industry}`);
  if (org.estimated_num_employees) snippetParts.push(`Empleados: ${org.estimated_num_employees}`);
  if (org.city) snippetParts.push(`Ciudad: ${org.city}`);
  if (org.country) snippetParts.push(`País: ${org.country}`);
  if (org.short_description) snippetParts.push(org.short_description.slice(0, 200));
  if (org.keywords?.length) snippetParts.push(`Keywords: ${org.keywords.slice(0, 5).join(', ')}`);
  snippetParts.push('[Fuente: Apollo Organizations]');

  // ── Size evidence ────────────────────────────────────────────────────────────
  const employeeCount = org.estimated_num_employees ?? null;
  let sizeStatus: SizeEvidenceStatus;
  let sizeReason: string;
  if (employeeCount === null) {
    sizeStatus = 'unknown';
    sizeReason = 'apollo_did_not_return_employee_count';
  } else if (employeeCount >= ICP_SIZE_THRESHOLD) {
    sizeStatus = 'passes';
    sizeReason = `employee_count_${employeeCount}_gte_threshold_${ICP_SIZE_THRESHOLD}`;
  } else {
    sizeStatus = 'below_threshold';
    sizeReason = `employee_count_${employeeCount}_lt_threshold_${ICP_SIZE_THRESHOLD}`;
  }

  const sizeEvidence: SizeEvidenceMetadata = {
    source: 'apollo',
    employee_count: employeeCount,
    threshold: ICP_SIZE_THRESHOLD,
    status: sizeStatus,
    reason: sizeReason,
  };

  // ── Apollo profile sanitizado (sin secretos, sin PII personal) ────────────
  const rawFieldsPresent: string[] = [];
  if (org.website_url) rawFieldsPresent.push('website_url');
  if (org.primary_domain) rawFieldsPresent.push('primary_domain');
  if (org.linkedin_url) rawFieldsPresent.push('linkedin_url');
  if (org.industry) rawFieldsPresent.push('industry');
  if (org.keywords?.length) rawFieldsPresent.push('keywords');
  if (employeeCount !== null) rawFieldsPresent.push('estimated_num_employees');
  if (org.city) rawFieldsPresent.push('city');
  if (org.country) rawFieldsPresent.push('country');
  if (org.short_description) rawFieldsPresent.push('short_description');

  const apolloProfile: ApolloProfileMetadata = {
    organization_id: org.id,
    website_url: org.website_url ?? null,
    primary_domain: domain,
    linkedin_url: org.linkedin_url ?? null,
    industry: org.industry ?? null,
    keywords: org.keywords ?? [],
    estimated_num_employees: employeeCount,
    employee_count_source: employeeCount !== null ? 'estimated_num_employees' : 'none',
    city: org.city ?? null,
    country: org.country ?? null,
    short_description: org.short_description ?? null,
    raw_fields_present: rawFieldsPresent,
    mapping_version: APOLLO_PROFILE_MAPPING_VERSION,
  };

  const orgMetadata: ApolloOrganizationSearchResultMetadata = {
    apollo_organization_id: org.id,
    domain,
    website,
    industry: org.industry ?? null,
    employee_count: employeeCount,
    city: org.city ?? null,
    country: org.country ?? null,
    linkedin_url: org.linkedin_url ?? null,
    keywords: org.keywords ?? [],
    short_description: org.short_description ?? null,
    source_provider: 'apollo',
    source_key: 'apollo_organizations',
    source_type: 'structured_company_database',
    apollo_profile: apolloProfile,
    size_evidence: sizeEvidence,
  };

  return {
    title: org.name.trim(),
    url,
    snippet: snippetParts.join(' | '),
    source: 'apollo_organizations',
    rank,
    provider: 'apollo_organizations',
    confidence: 0.85,
    metadata: orgMetadata,
  };
}

// ─── Helper interno ───────────────────────────────────────────────────────────

function extractDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Convierte ApolloOrganization (apollo-client.ts) → ApolloOrganizationInput.
 * Descarta orgs sin name: retorna null y el caller las filtra.
 * Usa primary_domain de Apollo directamente (más fiable que derivarlo de website_url).
 */
function normalizeApolloOrg(org: ApolloOrganization): ApolloOrganizationInput | null {
  if (!org.name?.trim()) return null;
  return {
    id: org.id,
    name: org.name,
    website_url: org.website_url,
    primary_domain: org.primary_domain ?? extractDomain(org.website_url),
    linkedin_url: org.linkedin_url,
    industry: org.industry,
    estimated_num_employees: org.estimated_num_employees ?? org.employee_count,
    city: org.city,
    country: org.country,
    short_description: org.short_description ?? org.seo_description,
    keywords: org.keywords ?? [],
  };
}

// ─── Fixture dry-run (solo usado cuando flag=off, para compatibilidad v1.16K-W) ──

const DRY_RUN_FIXTURE_ORGS: ApolloOrganizationInput[] = [
  {
    id: 'dry-run-apollo-org-001',
    name: 'Empresa Demo Apollo A S.A.S',
    website_url: 'https://demo-apollo-a.example.com',
    primary_domain: 'demo-apollo-a.example.com',
    linkedin_url: 'https://www.linkedin.com/company/demo-apollo-a',
    industry: 'Technology',
    estimated_num_employees: 250,
    country: 'Colombia',
  },
  {
    id: 'dry-run-apollo-org-002',
    name: 'Empresa Demo Apollo B Ltda',
    website_url: 'https://demo-apollo-b.example.com',
    primary_domain: 'demo-apollo-b.example.com',
    linkedin_url: null,
    industry: 'Software',
    estimated_num_employees: 80,
    country: 'Colombia',
  },
];

// ─── Deps inyectables (para tests) ───────────────────────────────────────────

export type ApolloOrgsSearchDeps = {
  searchOrgs?: typeof searchApolloOrganizations;
  logUsage?: typeof realLogApolloOrgsUsage;
};

// ─── Provider público ─────────────────────────────────────────────────────────

/**
 * Provider apollo_organizations para Agent 1.
 *
 * ENABLE_APOLLO_COMPANY_SEARCH=false → skipped, sin llamada real, sin créditos.
 * ENABLE_APOLLO_COMPANY_SEARCH=true  → llamada real limitada (max 10 orgs).
 *
 * @param usageContext  Contexto de trazabilidad (batchId, agentRunId) — opcional.
 * @param deps          Dependencias inyectables para tests.
 */
export async function runApolloOrganizationsSearch(
  input: WebSearchInput,
  maxResults: number,
  usageContext?: ApolloOrgsUsageContext,
  deps?: ApolloOrgsSearchDeps,
): Promise<WebSearchOutput> {
  // ── Flag apagado: skipped sin costo ──────────────────────────────────────────
  if (!isApolloCompanySearchEnabled()) {
    const usageMeta: ApolloOrganizationsUsageMetadata = {
      operation_key: 'organizations_search',
      provider_key: 'apollo',
      credits_used: 0,
      estimated_cost_usd: 0,
      status: 'dry_run',
    };

    return {
      provider: 'apollo_organizations',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'apollo_company_search_disabled',
      estimatedCostUsd: 0,
      metadata: {
        dry_run: true,
        note: 'ENABLE_APOLLO_COMPANY_SEARCH=false — no Apollo API call made',
        usage: usageMeta,
      },
    };
  }

  // ── Guardrail: cap de resultados (env + hard limit) ─────────────────────────
  const { cap, wasCapped, maxResultsCapSource } = cappedMaxResults(maxResults);

  const startMs = Date.now();
  const usageKey = buildApolloOrgsUsageKey(
    input.query,
    usageContext?.batchId,
    startMs,
  );

  const searchFn = deps?.searchOrgs ?? searchApolloOrganizations;
  const logFn = deps?.logUsage ?? realLogApolloOrgsUsage;

  // ── Construir params estructurados Apollo (v1.16K-AA) ───────────────────────
  // Usa q_keywords (búsqueda libre) en lugar de q_organization_name (nombre exacto).
  // organization_locations recibe el país como filtro estructurado.
  const { params: apolloParams, meta: mappingMeta } = buildApolloOrganizationsSearchParams(
    input,
    cap,
  );
  const apolloParamsSanitized = {
    ...mappingMeta,
    was_capped: wasCapped,
    capped_max_results: cap,
    requested_max_results: maxResults,
    max_results_cap_source: maxResultsCapSource,
  };

  // ── Llamada real a Apollo ────────────────────────────────────────────────────
  let apolloResult: Awaited<ReturnType<typeof searchApolloOrganizations>>;
  try {
    apolloResult = await searchFn(apolloParams);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    const usageMeta: ApolloOrganizationsUsageMetadata = {
      operation_key: 'organizations_search',
      provider_key: 'apollo',
      credits_used: 0,
      estimated_cost_usd: 0,
      status: 'error',
    };

    await logFn({
      usage_key: usageKey,
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      batch_id: usageContext?.batchId ?? undefined,
      agent_run_id: usageContext?.agentRunId ?? undefined,
      credits_used: 0,
      results_returned: 0,
      estimated_cost_usd: 0,
      status: 'error',
      error_code: 'apollo_fetch_exception',
      error_message: msg.slice(0, 200),
      duration_ms: Date.now() - startMs,
      triggered_by: usageContext?.triggeredByUserId ?? undefined,
      metadata: buildUsageMetadata(input, cap, wasCapped, 0, false, 'error', apolloParamsSanitized),
    });

    return {
      provider: 'apollo_organizations',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'apollo_fetch_exception',
      estimatedCostUsd: 0,
      metadata: { dry_run: false, provider_mode: 'real_limited', usage: usageMeta },
    };
  }

  // ── Manejo de respuestas de error Apollo ─────────────────────────────────────
  if (!apolloResult.success || apolloResult.error) {
    const statusCode = apolloResult.error?.statusCode ?? 0;
    const isAuthError = statusCode === 401 || statusCode === 403;
    const isQuota = statusCode === 429;

    const usageStatus: ApolloOrganizationsUsageMetadata['status'] = isQuota
      ? 'quota_exceeded'
      : 'error';

    const providerUsageStatus = isQuota ? 'quota_exceeded' as const : 'error' as const;

    const usageMeta: ApolloOrganizationsUsageMetadata = {
      operation_key: 'organizations_search',
      provider_key: 'apollo',
      credits_used: 0,
      estimated_cost_usd: 0,
      status: usageStatus,
    };

    await logFn({
      usage_key: usageKey,
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      batch_id: usageContext?.batchId ?? undefined,
      agent_run_id: usageContext?.agentRunId ?? undefined,
      credits_used: 0,
      results_returned: 0,
      estimated_cost_usd: 0,
      status: providerUsageStatus,
      error_code: isAuthError
        ? `apollo_http_${statusCode}`
        : apolloResult.error?.error ?? 'apollo_api_error',
      error_message: (apolloResult.error?.message ?? 'Apollo API error').slice(0, 200),
      duration_ms: Date.now() - startMs,
      triggered_by: usageContext?.triggeredByUserId ?? undefined,
      metadata: buildUsageMetadata(input, cap, wasCapped, 0, false, usageStatus, apolloParamsSanitized),
    });

    const skipReason = isQuota
      ? 'apollo_quota_exceeded'
      : isAuthError
        ? `apollo_auth_error_${statusCode}`
        : 'apollo_api_error';

    return {
      provider: 'apollo_organizations',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason,
      estimatedCostUsd: 0,
      metadata: { dry_run: false, provider_mode: 'real_limited', usage: usageMeta },
    };
  }

  // ── Mapping resultados ───────────────────────────────────────────────────────
  const rawOrgs = apolloResult.data ?? [];
  const mapped: WebSearchResult[] = [];
  // L2.8: track cuántas orgs se perdieron en normalización (sin name o error de mapping)
  let normalizationDroppedCount = 0;

  for (const raw of rawOrgs) {
    const normalized = normalizeApolloOrg(raw);
    if (!normalized) { normalizationDroppedCount++; continue; }
    try {
      mapped.push(mapApolloOrganizationToSearchResult(normalized, mapped.length + 1));
    } catch {
      normalizationDroppedCount++;
    }
  }
  const normalizedResultsCount = mapped.length; // pre-gate count

  // ── Sector relevance gate (v1.16K-AD, L2.13) ─────────────────────────────────
  // Filtra candidatos sin evidencia sectorial antes de persistir.
  // Gate solo actúa para apollo_organizations; Tavily no afectado.
  // L2.13: pasar subindustria primaria para activar señales estrictas de subindustria
  // (ej. 'formacion corporativa' rechaza universidades, solo pasa LMS/corporate training).
  const primarySubindustry = input.subindustries?.[0] ?? null;
  const gateResult = applyApolloSectorRelevanceGate(mapped, input.industry, 'apollo_organizations', primarySubindustry);
  const filteredMapped = gateResult.passed;

  // ── Cálculo de créditos y costo ───────────────────────────────────────────────
  // Créditos basados en resultados retornados por Apollo (antes del gate),
  // porque Apollo ya cobró por la búsqueda.
  const creditsUsed = Math.min(mapped.length, MAX_APOLLO_ORGANIZATIONS_CREDITS);
  const estimatedCostUsd = creditsUsed * APOLLO_ORGANIZATIONS_UNIT_COST_USD;

  // ── L2.9: diagnóstico detallado construido ANTES del log para incluirlo ───────
  // Construir aquí (no después del log) para que provider_usage_logs.metadata
  // incluya apollo_result_diagnostics en la misma llamada a logFn.
  const sectorMapped = gateResult.metadata.sector_mapped;
  const postGateCount = filteredMapped.length;
  let emptyOutputReason: string | null = null;
  if (postGateCount === 0) {
    if (rawOrgs.length === 0) {
      emptyOutputReason = 'apollo_returned_no_results';
    } else if (normalizedResultsCount === 0) {
      emptyOutputReason = 'normalization_dropped_all';
    } else if (sectorMapped) {
      emptyOutputReason = 'all_results_rejected_by_sector_gate';
    } else {
      emptyOutputReason = 'unknown_empty';
    }
  }

  const apolloResultDiagnostics = {
    raw_results_count: rawOrgs.length,
    normalized_results_count: normalizedResultsCount,
    normalization_dropped_count: normalizationDroppedCount,
    post_sector_gate_results_count: postGateCount,
    rejected_count: normalizedResultsCount - postGateCount,
    rejected_by_reason: sectorMapped && normalizedResultsCount > postGateCount
      ? 'sector_gate_insufficient_sector_evidence'
      : 'none',
    rejected_samples: gateResult.metadata.rejected_samples.slice(0, 3).map(s => ({
      name: s.name,
      domain: s.domain,
      reason: s.reason ?? 'insufficient_sector_evidence',
    })),
    output_results_count: postGateCount,
    empty_output_reason: emptyOutputReason,
  };

  // ── Usage logging ─────────────────────────────────────────────────────────────
  await logFn({
    usage_key: usageKey,
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    batch_id: usageContext?.batchId ?? undefined,
    agent_run_id: usageContext?.agentRunId ?? undefined,
    credits_used: creditsUsed,
    results_returned: rawOrgs.length,
    estimated_cost_usd: estimatedCostUsd,
    status: 'success',
    error_code: undefined,
    error_message: undefined,
    duration_ms: Date.now() - startMs,
    triggered_by: usageContext?.triggeredByUserId ?? undefined,
    metadata: {
      ...buildUsageMetadata(input, cap, wasCapped, rawOrgs.length, false, 'real', apolloParamsSanitized),
      apollo_result_diagnostics: apolloResultDiagnostics,
    },
  });

  const usageMeta: ApolloOrganizationsUsageMetadata = {
    operation_key: 'organizations_search',
    provider_key: 'apollo',
    credits_used: creditsUsed,
    estimated_cost_usd: estimatedCostUsd,
    status: 'real',
  };

  return {
    provider: 'apollo_organizations',
    query: input.query,
    results: filteredMapped,
    resultsCount: filteredMapped.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: estimatedCostUsd,
    metadata: {
      dry_run: false,
      provider_mode: 'real_limited',
      capped: wasCapped,
      usage: usageMeta,
      // Pre/post gate counts — distinción clave para diagnóstico (v1.16K-AF, fixed L2.9)
      // apollo_raw_results_count = orgs desde Apollo API (pre-normalization)
      apollo_raw_results_count: rawOrgs.length,
      apollo_normalized_results_count: normalizedResultsCount,
      apollo_post_gate_results_count: postGateCount,
      apollo_sector_rejected_count: normalizedResultsCount - postGateCount,
      apollo_sector_relevance_gate: gateResult.metadata,
      // L2.8: diagnóstico detallado para trazabilidad en batch metadata
      apollo_result_diagnostics: apolloResultDiagnostics,
    },
  };
}

// ─── Helper de metadata ───────────────────────────────────────────────────────

function buildUsageMetadata(
  input: WebSearchInput,
  cappedMaxResults: number,
  wasCapped: boolean,
  resultsReturned: number,
  dryRun: boolean,
  status: string,
  apolloParamsSanitized?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    query: input.query.slice(0, 100),
    country: input.country ?? null,
    countryCode: input.countryCode ?? null,
    industry: input.industry ?? null,
    requested_max_results: cappedMaxResults,
    capped_max_results: cappedMaxResults,
    was_capped: wasCapped,
    results_returned: resultsReturned,
    dry_run: dryRun,
    provider_mode: dryRun ? 'dry_run' : 'real_limited',
    status,
    mapping_version: APOLLO_QUERY_MAPPING_VERSION,
    ...(apolloParamsSanitized ? { apollo_params_sanitized: apolloParamsSanitized } : {}),
  };
}
