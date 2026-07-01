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
  country?: string | null;
};

/** Metadata estructurada que el provider inyecta en cada WebSearchResult. */
export type ApolloOrganizationSearchResultMetadata = {
  apollo_organization_id: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  linkedin_url: string | null;
  source_provider: 'apollo';
  source_key: 'apollo_organizations';
  source_type: 'structured_company_database';
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

  const snippetParts: string[] = [`Empresa: ${org.name}`];
  if (org.industry) snippetParts.push(`Industria: ${org.industry}`);
  if (org.estimated_num_employees)
    snippetParts.push(`Empleados: ${org.estimated_num_employees}`);
  if (org.country) snippetParts.push(`País: ${org.country}`);
  snippetParts.push('[Fuente: Apollo Organizations]');

  const orgMetadata: ApolloOrganizationSearchResultMetadata = {
    apollo_organization_id: org.id,
    domain,
    website,
    industry: org.industry ?? null,
    employee_count: org.estimated_num_employees ?? null,
    country: org.country ?? null,
    linkedin_url: org.linkedin_url ?? null,
    source_provider: 'apollo',
    source_key: 'apollo_organizations',
    source_type: 'structured_company_database',
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
 */
function normalizeApolloOrg(org: ApolloOrganization): ApolloOrganizationInput | null {
  if (!org.name?.trim()) return null;
  return {
    id: org.id,
    name: org.name,
    website_url: org.website_url,
    primary_domain: extractDomain(org.website_url),
    linkedin_url: org.linkedin_url,
    industry: org.industry,
    estimated_num_employees: org.estimated_num_employees ?? org.employee_count,
    country: org.country,
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

  for (const raw of rawOrgs) {
    const normalized = normalizeApolloOrg(raw);
    if (!normalized) continue; // descarta orgs sin name
    try {
      mapped.push(mapApolloOrganizationToSearchResult(normalized, mapped.length + 1));
    } catch {
      // descarta silenciosamente orgs que no se pueden mapear
    }
  }

  // ── Sector relevance gate (v1.16K-AD) ────────────────────────────────────────
  // Filtra candidatos sin evidencia sectorial antes de persistir.
  // Gate solo actúa para apollo_organizations; Tavily no afectado.
  const gateResult = applyApolloSectorRelevanceGate(mapped, input.industry, 'apollo_organizations');
  const filteredMapped = gateResult.passed;

  // ── Cálculo de créditos y costo ───────────────────────────────────────────────
  // Créditos basados en resultados retornados por Apollo (antes del gate),
  // porque Apollo ya cobró por la búsqueda.
  const creditsUsed = Math.min(mapped.length, MAX_APOLLO_ORGANIZATIONS_CREDITS);
  const estimatedCostUsd = creditsUsed * APOLLO_ORGANIZATIONS_UNIT_COST_USD;

  // ── Usage logging ─────────────────────────────────────────────────────────────
  await logFn({
    usage_key: usageKey,
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    batch_id: usageContext?.batchId ?? undefined,
    agent_run_id: usageContext?.agentRunId ?? undefined,
    credits_used: creditsUsed,
    results_returned: mapped.length,
    estimated_cost_usd: estimatedCostUsd,
    status: 'success',
    error_code: undefined,
    error_message: undefined,
    duration_ms: Date.now() - startMs,
    triggered_by: usageContext?.triggeredByUserId ?? undefined,
    metadata: buildUsageMetadata(input, cap, wasCapped, mapped.length, false, 'real', apolloParamsSanitized),
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
      apollo_sector_relevance_gate: gateResult.metadata,
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
