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
import {
  isApolloCompanySearchEnabled,
  isApolloOrganizationEnrichmentCascadeEnabled,
  resolveApolloMaxEnrichmentsPerRun,
} from '@/lib/feature-flags.server';
import {
  searchApolloOrganizations,
  enrichApolloOrganization,
  type ApolloOrganization,
  type EnrichOrganizationParams,
  type ApolloEnrichResult,
  type SearchOrganizationsParams,
} from '@/server/integrations/apollo-client';
import {
  runApolloOrganizationEnrichmentCascade,
  buildDisabledCascadeMeta,
  type ApolloEnrichmentCascadeMeta,
  type ApolloIndustryRawFields,
} from '../apollo-organization-enrichment-cascade';
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
// A1-APOLLO-WIZARD-1 — paginación acotada, normalización con prioridad de
// `organizations[]`, taxonomía de errores y lectura de cuota real.
import { searchApolloOrganizationsPage } from '@/server/integrations/apollo-client';
import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
  type ApolloPageLogEntry,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
// A1-APOLLO-BUDGET-RECONCILIATION-1 — contrato único de observabilidad de gasto.
import {
  buildApolloSpendObservabilityRecord,
  toApolloSpendObservabilityMetadata,
  APOLLO_SPEND_OBSERVABILITY_KEY,
} from '../apollo-spend-observability';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
import {
  toApolloErrorLogMetadata,
  type ApolloErrorClassification,
} from '../apollo-organizations-error-taxonomy';
import { toRateLimitLogMetadata } from '@/server/integrations/apollo-rate-limit-headers';
import type { ApolloOrganizationsRequestInput } from '../apollo-organizations-request-contract';
import { applyApolloSectorRelevanceGate } from '../apollo-sector-relevance-gate';
import { ingestApolloOrganizationIndustryRawLabels } from '@/modules/industry-mapping/apollo-industry-raw-label-ingestion';
import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import { captureProviderIndustryRawLabelObservations } from '../provider-industry-raw-label-capture';

// ─── Versión de mapping de perfil ────────────────────────────────────────────

export const APOLLO_PROFILE_MAPPING_VERSION = 'v1.L2.14';

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
  /** L2.14: Array alternativo de industrias que Apollo puede devolver en lugar de o junto a `industry`. */
  industries?: string[] | null;
  estimated_num_employees?: number | null;
  city?: string | null;
  country?: string | null;
  short_description?: string | null;
  /** L2.14: SEO description — fallback cuando short_description es null. */
  seo_description?: string | null;
  /** L2.14: Full description — más larga que short_description. */
  description?: string | null;
  keywords?: string[];
  /** L2.14: Array alternativo de keywords que Apollo usa en algunas respuestas de plan. */
  organization_keywords?: string[] | null;
};

/** Perfil Apollo sanitizado — sin secretos, sin PII personal. */
export type ApolloProfileMetadata = {
  organization_id: string;
  website_url: string | null;
  primary_domain: string | null;
  linkedin_url: string | null;
  industry: string | null;
  /** L2.14: Array alternativo de industrias (max 10 elementos). */
  industries: string[];
  keywords: string[];
  /** L2.14: Array alternativo de keywords de organización (max 10 elementos). */
  organization_keywords: string[];
  estimated_num_employees: number | null;
  employee_count_source: 'estimated_num_employees' | 'employee_count' | 'none';
  city: string | null;
  country: string | null;
  short_description: string | null;
  /** L2.14: SEO description — max 300 chars. */
  seo_description: string | null;
  /** L2.14: Full description — max 300 chars. */
  description: string | null;
  /** Nombres de campos no vacíos presentes en la respuesta Apollo — útil para debug. */
  raw_fields_present: string[];
  mapping_version: string;
};

/** Sample sanitizado de raw Apollo para diagnóstico en usage logs — sin PII, sin datos sensibles. */
export type ApolloRawResultSample = {
  name: string;
  domain: string | null;
  raw_keys_present: string[];
  evidence_fields_present: string[];
  industry: string | null;
  industries_sample: string[];
  keywords_sample: string[];
  organization_keywords_sample: string[];
  has_description: boolean;
  has_short_description: boolean;
  employee_count: number | null;
  description_sample: string | null;
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
  // L2.14: También incluye industries, organization_keywords y description cuando están disponibles.
  const snippetParts: string[] = [`Empresa: ${org.name}`];
  if (org.industry) snippetParts.push(`Industria: ${org.industry}`);
  if (org.industries?.length) snippetParts.push(`Industrias: ${org.industries.slice(0, 3).join(', ')}`);
  if (org.estimated_num_employees) snippetParts.push(`Empleados: ${org.estimated_num_employees}`);
  if (org.city) snippetParts.push(`Ciudad: ${org.city}`);
  if (org.country) snippetParts.push(`País: ${org.country}`);
  const descText = org.short_description ?? org.seo_description ?? org.description ?? null;
  if (descText) snippetParts.push(descText.slice(0, 200));
  const allKeywords = [...(org.keywords ?? []), ...(org.organization_keywords ?? [])];
  if (allKeywords.length) snippetParts.push(`Keywords: ${allKeywords.slice(0, 8).join(', ')}`);
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
  // L2.14: Captura campos adicionales para audit de evidencia raw.
  const rawFieldsPresent: string[] = [];
  if (org.website_url) rawFieldsPresent.push('website_url');
  if (org.primary_domain) rawFieldsPresent.push('primary_domain');
  if (org.linkedin_url) rawFieldsPresent.push('linkedin_url');
  if (org.industry) rawFieldsPresent.push('industry');
  if (org.industries?.length) rawFieldsPresent.push('industries');
  if (org.keywords?.length) rawFieldsPresent.push('keywords');
  if (org.organization_keywords?.length) rawFieldsPresent.push('organization_keywords');
  if (employeeCount !== null) rawFieldsPresent.push('estimated_num_employees');
  if (org.city) rawFieldsPresent.push('city');
  if (org.country) rawFieldsPresent.push('country');
  if (org.short_description) rawFieldsPresent.push('short_description');
  if (org.seo_description) rawFieldsPresent.push('seo_description');
  if (org.description) rawFieldsPresent.push('description');

  const apolloProfile: ApolloProfileMetadata = {
    organization_id: org.id,
    website_url: org.website_url ?? null,
    primary_domain: domain,
    linkedin_url: org.linkedin_url ?? null,
    industry: org.industry ?? null,
    industries: (org.industries ?? []).slice(0, 10),
    keywords: (org.keywords ?? []).slice(0, 10),
    organization_keywords: (org.organization_keywords ?? []).slice(0, 10),
    estimated_num_employees: employeeCount,
    employee_count_source: employeeCount !== null ? 'estimated_num_employees' : 'none',
    city: org.city ?? null,
    country: org.country ?? null,
    short_description: org.short_description ? org.short_description.slice(0, 300) : null,
    seo_description: org.seo_description ? org.seo_description.slice(0, 300) : null,
    description: org.description ? org.description.slice(0, 300) : null,
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
    industries: org.industries ?? [],
    estimated_num_employees: org.estimated_num_employees ?? org.employee_count,
    city: org.city,
    country: org.country,
    // L2.14: preservar short_description, seo_description y description por separado
    // (no colapsar en uno: el gate los consume individualmente para evidencia sectorial)
    short_description: org.short_description ?? null,
    seo_description: org.seo_description ?? null,
    description: org.description ?? null,
    keywords: org.keywords ?? [],
    organization_keywords: org.organization_keywords ?? [],
  };
}

// ─── L2.14: Safe raw sample builder ──────────────────────────────────────────

/**
 * Construye un sample diagnóstico seguro de un ApolloOrganization raw.
 * Sin PII (sin emails, teléfonos, personas). Sin datos sensibles.
 * Captura exactamente qué campos devolvió Apollo para audit de evidencia.
 */
export function buildApolloRawResultSample(org: ApolloOrganization): ApolloRawResultSample {
  const rawKeysPresent: string[] = [];
  if (org.name) rawKeysPresent.push('name');
  if (org.website_url) rawKeysPresent.push('website_url');
  if (org.primary_domain) rawKeysPresent.push('primary_domain');
  if (org.industry) rawKeysPresent.push('industry');
  if (org.industries?.length) rawKeysPresent.push('industries');
  if (org.employee_count != null) rawKeysPresent.push('employee_count');
  if (org.estimated_num_employees != null) rawKeysPresent.push('estimated_num_employees');
  if (org.keywords?.length) rawKeysPresent.push('keywords');
  if (org.organization_keywords?.length) rawKeysPresent.push('organization_keywords');
  if (org.short_description) rawKeysPresent.push('short_description');
  if (org.seo_description) rawKeysPresent.push('seo_description');
  if (org.description) rawKeysPresent.push('description');
  if (org.linkedin_url) rawKeysPresent.push('linkedin_url');
  if (org.city) rawKeysPresent.push('city');
  if (org.country) rawKeysPresent.push('country');
  if (org.technologies?.length) rawKeysPresent.push('technologies');

  const evidenceFieldsPresent: string[] = [];
  if (org.industry) evidenceFieldsPresent.push('industry');
  if (org.industries?.length) evidenceFieldsPresent.push('industries');
  if (org.keywords?.length) evidenceFieldsPresent.push('keywords');
  if (org.organization_keywords?.length) evidenceFieldsPresent.push('organization_keywords');
  if (org.short_description) evidenceFieldsPresent.push('short_description');
  if (org.seo_description) evidenceFieldsPresent.push('seo_description');
  if (org.description) evidenceFieldsPresent.push('description');
  if (org.estimated_num_employees != null || org.employee_count != null) {
    evidenceFieldsPresent.push('employee_count');
  }

  const descText = org.short_description ?? org.seo_description ?? org.description ?? null;

  return {
    name: org.name ?? 'unknown',
    domain: org.primary_domain ?? extractDomain(org.website_url),
    raw_keys_present: rawKeysPresent,
    evidence_fields_present: evidenceFieldsPresent,
    industry: org.industry ?? null,
    industries_sample: (org.industries ?? []).slice(0, 5),
    keywords_sample: (org.keywords ?? []).slice(0, 5),
    organization_keywords_sample: (org.organization_keywords ?? []).slice(0, 5),
    has_description: !!(org.short_description ?? org.seo_description ?? org.description),
    has_short_description: !!org.short_description,
    employee_count: org.estimated_num_employees ?? org.employee_count ?? null,
    description_sample: descText ? descText.slice(0, 150) : null,
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
  /**
   * A1-APOLLO-WIZARD-1: transporte por página. Cuando se omite, se usa
   * `searchApolloOrganizationsPage` (real). Los tests existentes que inyectan
   * `searchOrgs` siguen funcionando: se adapta a esta forma.
   */
  fetchPage?: (body: Record<string, unknown>) => Promise<ApolloPageFetchResult>;
  /** Reloj inyectable — sólo tests. */
  now?: () => number;
  /** Jitter inyectable ∈ [0,1) — sólo tests. */
  random?: () => number;
  /** Espera entre reintentos — los tests la anulan. */
  sleep?: (ms: number) => Promise<void>;
  logUsage?: typeof realLogApolloOrgsUsage;
  /** L2.15: injectable enrichment fn — for tests only, never call real in production without flag. */
  enrichOrg?: (params: EnrichOrganizationParams) => Promise<ApolloEnrichResult<ApolloOrganization>>;
  /**
   * Q3F-5AU.7: injectable raw industry label capture fn — for tests only.
   * Best-effort observability; never affects results, ranking, or scoring.
   */
  captureIndustryLabels?: typeof captureProviderIndustryRawLabelObservations;
};

// ─── A1-APOLLO-WIZARD-1: adaptadores de la ruta paginada ─────────────────────

/**
 * Adapta el resultado de `searchApolloOrganizations` (forma antigua) a la forma
 * de página. Existe para que los callers y tests que ya inyectan `searchOrgs`
 * sigan funcionando sin cambios mientras la ruta real usa el transporte nuevo.
 */
function adaptSearchOrgsToPage(
  result: Awaited<ReturnType<typeof searchApolloOrganizations>>,
): ApolloPageFetchResult {
  if (!result.success || result.error) {
    const status = result.error?.statusCode ?? 500;
    return {
      ok: false,
      status,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: undefined,
      headers: null,
      errorBody: result.error?.message,
    };
  }
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    // La forma antigua ya colapsó accounts/organizations en `data`. Se entrega
    // como `organizations` porque es la fuente principal por contrato.
    payload: {
      organizations: result.data ?? [],
      pagination: {
        page: result.page,
        per_page: result.per_page,
        total_entries: result.total,
      },
    },
    headers: null,
  };
}

/**
 * Traduce los params del mapper de query a los filtros tipados del contrato de
 * request. `page` y `per_page` los gobierna el presupuesto de paginación, no el
 * mapper, así que se descartan aquí a propósito.
 */
function buildPaginatedSearchFilters(
  params: SearchOrganizationsParams,
): Omit<ApolloOrganizationsRequestInput, 'page' | 'perPage'> {
  return {
    locations: params.organization_locations ?? null,
    employeeRanges: params.organization_num_employees_ranges ?? null,
    keywordTags: params.q_organization_keyword_tags ?? null,
    organizationName: params.q_organization_name ?? null,
    domainsList: params.q_organization_domains ?? null,
  };
}

/**
 * Convierte la organización normalizada a la forma `ApolloOrganization` que
 * consumen el gate sectorial, el cascade y los diagnósticos.
 *
 * `primary_domain` queda ya normalizado y `all_domains` viaja como alias de
 * identidad, sin desplazar al dominio principal.
 */
function toApolloOrganizationShape(
  organization: NormalizedApolloOrganization,
): ApolloOrganization & { all_domains?: string[] } {
  return {
    id: organization.providerReference.providerOrganizationId,
    name: organization.name,
    website_url: organization.websiteUrl,
    primary_domain: organization.primaryDomain,
    all_domains: organization.normalizedDomains,
    linkedin_url: organization.linkedinUrl,
    industry: organization.industry,
    industry_tag_ids: [],
    employee_count: organization.estimatedNumEmployees,
    estimated_num_employees: organization.estimatedNumEmployees,
    city: organization.city,
    country: organization.country,
    phone: organization.phone,
    annual_revenue: null,
    technologies: organization.technologies,
    short_description: organization.shortDescription,
    seo_description: organization.seoDescription,
    description: organization.description,
    keywords: organization.keywords,
    industries: organization.industries,
    organization_keywords: organization.organizationKeywords,
  };
}

/**
 * Traduce la categoría del error al `skipReason` histórico del provider, para
 * no romper a los consumidores que ya discriminan por esos códigos.
 */
function mapClassificationToLegacySkipReason(
  classification: ApolloErrorClassification,
): string {
  switch (classification.category) {
    case 'rate_limited':
      return 'apollo_quota_exceeded';
    case 'invalid_credential':
      return 'apollo_auth_error_401';
    case 'insufficient_plan_or_scope':
      return 'apollo_auth_error_403';
    case 'network_timeout':
    case 'malformed_response':
      return 'apollo_fetch_exception';
    default:
      return 'apollo_api_error';
  }
}

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

  const logFn = deps?.logUsage ?? realLogApolloOrgsUsage;

  // Q3F-5AU.10S: usage logging failures (e.g. FK violation on batch_id) must
  // stay visible in metadata instead of being silently swallowed. Mirrors the
  // usage_logging_failed pattern already used for Tavily (web-search-tool.ts).
  // Never throws in production — a logging failure must not block real
  // results that already cost real Apollo credits.
  let usageLoggingFailed = false;
  const usageLoggingErrors: string[] = [];
  function trackLogResult(result: Awaited<ReturnType<typeof logFn>>): void {
    if (result.kind === 'failed') {
      usageLoggingFailed = true;
      usageLoggingErrors.push(result.error.slice(0, 200));
    }
  }

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

  // ── A1-APOLLO-WIZARD-1: búsqueda paginada acotada ───────────────────────────
  // Una invocación de este provider = UNA query = UNA página.
  //
  // maxPages se fija en 1 a propósito. El presupuesto entre queries y rondas ya
  // lo gobierna aguas arriba `AGENT1_APOLLO_MAX_QUERIES_PER_RUN` (cap global
  // acumulado en incremental-search.ts, v1.16K-AC), y el wizard reserva créditos
  // como maxQueries × maxResults antes de ejecutar. Derivar maxPages de esa
  // misma variable multiplicaría el gasto por query (N queries × N páginas) y
  // dejaría el consumo real por encima de lo reservado — exactamente la causa
  // raíz que v1.16K-AC cerró. Paginar dentro de una query requiere un
  // presupuesto propio, no reutilizar el cap de queries.
  const paginationBudget = createApolloPaginationBudget({ perPage: cap, maxPages: 1 });
  const apolloPageLogs: ApolloPageLogEntry[] = [];

  // Transporte: el real por defecto; `searchOrgs` se adapta para no romper a
  // los callers y tests que ya lo inyectan.
  const fetchPage: (body: Record<string, unknown>) => Promise<ApolloPageFetchResult> =
    deps?.fetchPage
      ?? (deps?.searchOrgs
        ? async (body) => adaptSearchOrgsToPage(await deps.searchOrgs!(body as never))
        : (body) => searchApolloOrganizationsPage(body));

  const paginated = await runApolloOrganizationsPaginatedSearch(
    {
      filters: buildPaginatedSearchFilters(apolloParams),
      budget: paginationBudget,
      wizardRunId: usageContext?.batchId ?? `no_batch:${startMs}`,
      agentRunId: usageContext?.agentRunId ?? null,
    },
    {
      fetchPage,
      now: deps?.now ?? (() => Date.now()),
      random: deps?.random ?? Math.random,
      sleep: deps?.sleep,
      logPage: (entry) => { apolloPageLogs.push(entry); },
    },
  );

  // Trazabilidad de paginación y cuota — sin secretos, sin PII.
  const apolloPaginationMetadata = {
    pages_processed: paginated.pagesProcessed,
    max_pages: paginationBudget.maxPages,
    max_credits: paginationBudget.maxCredits,
    max_candidates: paginationBudget.maxCandidates,
    per_page: paginationBudget.perPage,
    timeout_budget_ms: paginationBudget.timeoutBudgetMs,
    budget_derived_from: paginationBudget.derivedFrom,
    stop_reason: paginated.stopReason,
    estimated_credits: paginated.estimatedCredits,
    total_entries: paginated.paginationMeta.totalEntries,
    total_pages: paginated.paginationMeta.totalPages,
    request_fingerprint: paginated.requestFingerprint,
    indeterminate_pages: paginated.indeterminatePages,
    rejected_forbidden_params: paginated.rejectedForbiddenParams,
    rejected_unknown_params: paginated.rejectedUnknownParams,
    omitted_filters: paginated.omittedFilters,
    page_outcomes: paginated.pageOutcomes,
    normalization: paginated.normalizationMeta,
    rate_limit: paginated.lastRateLimit
      ? toRateLimitLogMetadata(paginated.lastRateLimit)
      : null,
  };

  // A1-APOLLO-BUDGET-RECONCILIATION-1 — un único registro de observabilidad de
  // gasto, construido una vez y persistido por AMBAS rutas. Antes la paginación
  // y los headers de cuota sólo llegaban a provider_usage_logs en el fallo
  // terminal: las corridas que sí gastaban eran las que menos podíamos explicar
  // después. Todo campo ausente queda null (nunca 0: "no llegó el header" y
  // "cuota agotada" son hechos distintos).
  const lastPageLog = apolloPageLogs.length > 0 ? apolloPageLogs[apolloPageLogs.length - 1] : null;
  const buildSpendObservability = (
    resultsReturned: number | null,
    recordedUsageCredits: number | null,
  ) =>
    toApolloSpendObservabilityMetadata(
      buildApolloSpendObservabilityRecord({
        // El transporte no expone el status HTTP a esta capa; queda null en vez
        // de un 200 inventado.
        httpStatus: null,
        latencyMs: lastPageLog?.latencyMs ?? null,
        page: lastPageLog?.page ?? null,
        perPage: lastPageLog?.perPage ?? paginationBudget.perPage,
        paginationPage: paginated.paginationMeta.lastPage,
        paginationTotalPages: paginated.paginationMeta.totalPages,
        paginationTotalEntries: paginated.paginationMeta.totalEntries,
        resultsReturned,
        rateLimit: paginated.lastRateLimit,
        // El vocabulario por página ('charged' | 'not_charged' | 'unknown') se
        // traduce al de conciliación: cobrado ⇒ lo registramos nosotros
        // ('recorded'); no cobrado ⇒ sólo tenemos la estimación; desconocido se
        // preserva como desconocido y jamás se promueve a confirmado.
        billingState:
          lastPageLog?.billingState === 'charged'
            ? 'recorded'
            : lastPageLog?.billingState === 'not_charged'
              ? 'estimated'
              : 'unknown',
        estimatedCredits: paginated.estimatedCredits,
        recordedUsageCredits,
      }),
    );

  // Un fallo terminal se reporta como fallo, nunca como búsqueda vacía.
  if (paginated.terminalError && paginated.organizations.length === 0) {
    const classification = paginated.terminalError;
    const isQuota = classification.category === 'rate_limited';
    const usageStatus: ApolloOrganizationsUsageMetadata['status'] = isQuota
      ? 'quota_exceeded'
      : 'error';

    const usageMeta: ApolloOrganizationsUsageMetadata = {
      operation_key: 'organizations_search',
      provider_key: 'apollo',
      credits_used: 0,
      estimated_cost_usd: 0,
      status: usageStatus,
    };

    trackLogResult(await logFn({
      usage_key: usageKey,
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      batch_id: usageContext?.batchId ?? undefined,
      agent_run_id: usageContext?.agentRunId ?? undefined,
      credits_used: 0,
      results_returned: 0,
      estimated_cost_usd: 0,
      status: isQuota ? 'quota_exceeded' : 'error',
      error_code: classification.code,
      error_message: `${classification.category} (billing=${classification.billingState})`.slice(0, 200),
      duration_ms: Date.now() - startMs,
      triggered_by: usageContext?.triggeredByUserId ?? undefined,
      metadata: {
        ...buildUsageMetadata(input, cap, wasCapped, 0, false, usageStatus, apolloParamsSanitized),
        ...toApolloErrorLogMetadata(classification),
        apollo_pagination: apolloPaginationMetadata,
        apollo_page_logs: apolloPageLogs,
        [APOLLO_SPEND_OBSERVABILITY_KEY]: buildSpendObservability(0, 0),
      },
    }));

    return {
      provider: 'apollo_organizations',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: mapClassificationToLegacySkipReason(classification),
      estimatedCostUsd: 0,
      metadata: {
        dry_run: false,
        provider_mode: 'real_limited',
        usage: usageMeta,
        apollo_error: toApolloErrorLogMetadata(classification),
        apollo_pagination: apolloPaginationMetadata,
        ...(usageLoggingFailed
          ? { usage_logging_failed: true, usage_logging_errors: usageLoggingErrors }
          : {}),
      },
    };
  }

  // ── Mapping resultados ───────────────────────────────────────────────────────
  // Se reconstruye la forma que ya consume el resto del provider (gate
  // sectorial, cascade, diagnósticos), pero con la precedencia correcta de
  // `organizations[]` y con los dominios ya normalizados.
  const rawOrgs: ApolloOrganization[] = paginated.organizations.map(toApolloOrganizationShape);

  // ── Q3F-5AU.7: best-effort raw industry label observation capture ──────────
  // Reads rawOrgs only — runs before any mapping/enrichment/gate step, so it
  // cannot influence candidates, ranking, scoring, filters, dedup, or the
  // writer. captureIndustryLabels never throws by contract; the try/catch is
  // defense in depth so a future regression there still can't break this flow.
  const rawIndustryLabels = ingestApolloOrganizationIndustryRawLabels(rawOrgs);
  if (rawIndustryLabels.length > 0) {
    const captureIndustryLabels = deps?.captureIndustryLabels ?? captureProviderIndustryRawLabelObservations;
    try {
      await captureIndustryLabels({
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'organizations_search',
        labels: rawIndustryLabels.map((label) => ({
          rawLabel: label.rawLabel,
          normalizedLookupKey: normalizeClassificationValue(label.rawLabel),
        })),
        countryCode: input.countryCode ?? null,
        requestedIndustry: input.industry ?? null,
        agentRunId: usageContext?.agentRunId ?? null,
        sourceContext: {
          operation: 'apollo_organizations_search',
          resultCount: rawOrgs.length,
        },
      });
    } catch {
      // Best-effort observability only — never let capture failures affect
      // the Apollo organizations search flow.
    }
  }

  const mapped: WebSearchResult[] = [];
  // L2.8: track cuántas orgs se perdieron en normalización (sin name o error de mapping)
  let normalizationDroppedCount = 0;
  // L2.14: hasta 3 samples del raw Apollo para audit de evidencia en usage logs
  const rawResultSamples: ApolloRawResultSample[] = [];

  for (const raw of rawOrgs) {
    if (rawResultSamples.length < 3) rawResultSamples.push(buildApolloRawResultSample(raw));
    const normalized = normalizeApolloOrg(raw);
    if (!normalized) { normalizationDroppedCount++; continue; }
    try {
      mapped.push(mapApolloOrganizationToSearchResult(normalized, mapped.length + 1));
    } catch {
      normalizationDroppedCount++;
    }
  }
  const normalizedResultsCount = mapped.length; // pre-gate count

  // ── L2.15: Apollo Organization Enrichment cascade ────────────────────────────
  // ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE=false (default) → skip, results intactos.
  // ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE=true → enriquecer hasta max cap antes del gate.
  // Enriquece metadata.apollo_profile para que el sector gate tenga más evidencia.
  let enrichedMapped: WebSearchResult[] = mapped;
  let enrichmentCascadeMeta: ApolloEnrichmentCascadeMeta;
  if (isApolloOrganizationEnrichmentCascadeEnabled()) {
    // Q3F-5AU.16: true run-level cap. perCallCap is this invocation's own
    // ceiling; remainingRunBudget is what incremental-search.ts (via
    // web-search-tool.ts) says is left for the whole wizard execution across
    // ALL rounds/queries. Absent remainingEnrichmentBudget (older callers that
    // never wire usageContext.remainingEnrichmentBudget) falls back to
    // perCallCap — identical to pre-Q3F-5AU.16 behavior.
    const perCallCap = resolveApolloMaxEnrichmentsPerRun();
    const remainingRunBudget =
      typeof usageContext?.remainingEnrichmentBudget === 'number'
        ? Math.max(0, usageContext.remainingEnrichmentBudget)
        : perCallCap;
    const maxEnrichments = Math.max(0, Math.min(perCallCap, remainingRunBudget));
    // A1-APOLLO-BUDGET-RECONCILIATION-1: los gates baratos corren ANTES del cap
    // y antes de cualquier llamada pagada. Un candidato de otro país, con
    // dominio de correo, de una plataforma externa o sin evidencia sectorial
    // deja de costar un crédito para descubrir que no servía.
    const cascadeResult = await runApolloOrganizationEnrichmentCascade(
      mapped,
      maxEnrichments,
      { enrichOrg: deps?.enrichOrg ?? enrichApolloOrganization },
      {
        eligibility: {
          targetCountryCode: input.countryCode ?? null,
          sector: input.industry ?? null,
          subindustry: input.subindustries?.[0] ?? null,
        },
      },
    );
    enrichedMapped = cascadeResult.results;
    enrichmentCascadeMeta = cascadeResult.meta;
  } else {
    enrichmentCascadeMeta = buildDisabledCascadeMeta();
  }

  // ── Sector relevance gate (v1.16K-AD, L2.13) ─────────────────────────────────
  // Filtra candidatos sin evidencia sectorial antes de persistir.
  // Gate solo actúa para apollo_organizations; Tavily no afectado.
  // L2.13: pasar subindustria primaria para activar señales estrictas de subindustria
  // (ej. 'formacion corporativa' rechaza universidades, solo pasa LMS/corporate training).
  // L2.15: gate recibe enrichedMapped (con apollo_profile más completo si cascade activo).
  const primarySubindustry = input.subindustries?.[0] ?? null;
  const gateResult = applyApolloSectorRelevanceGate(enrichedMapped, input.industry, 'apollo_organizations', primarySubindustry);
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
      evidence_fields_present: s.evidence_fields_present ?? [],
      apollo_keywords_sample: s.apollo_keywords_sample ?? [],
      description_present: s.description_present ?? false,
      apollo_industry: s.apollo_industry ?? null,
      apollo_employee_count: s.apollo_employee_count ?? null,
      provider_evidence_used: s.provider_evidence_used ?? [],
    })),
    output_results_count: postGateCount,
    empty_output_reason: emptyOutputReason,
    // L2.14: samples del raw Apollo para ver exactamente qué campos devolvió la API
    apollo_raw_result_samples_sanitized: rawResultSamples,
  };

  // ── Usage logging: organizations_search ──────────────────────────────────────
  trackLogResult(await logFn({
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
      // L2.15: cascade meta — visible en DB para auditoría
      apollo_enrichment_cascade: enrichmentCascadeMeta,
      // A1-APOLLO-BUDGET-RECONCILIATION-1: mismo contrato de observabilidad que
      // la ruta de error terminal — paginación, cuota y latencia también en la
      // ruta exitosa, que es la que realmente gasta.
      apollo_pagination: apolloPaginationMetadata,
      apollo_page_logs: apolloPageLogs,
      [APOLLO_SPEND_OBSERVABILITY_KEY]: buildSpendObservability(rawOrgs.length, creditsUsed),
    },
  }));

  // ── Usage logging: organization_enrichment (one log per real API call) ────────
  // Emite un log separado por cada enrichment real intentado (success o failure).
  // Skips por missing_domain o cap_reached no generan log (sin llamada real).
  // Q3F-5AU.16: el costo ya NO usa APOLLO_ORGANIZATIONS_UNIT_COST_USD (ese
  // hardcode sigue siendo la fuente de verdad solo para organizations_search).
  // organization_enrichment usa el unit cost vivo de provider_pricing_config,
  // resuelto una vez por wizard execution y pasado vía usageContext. Si no hay
  // pricing vivo, estimated_cost_usd queda null (SQL NULL — costo desconocido,
  // nunca 0 fabricado) en lugar de un valor inventado.
  const organizationEnrichmentUnitCostUsd = usageContext?.organizationEnrichmentUnitCostUsd ?? null;
  for (const entry of enrichmentCascadeMeta.entries) {
    const wasRealCall = entry.enriched || entry.skip_reason === 'enrichment_failed';
    if (!wasRealCall) continue;

    const enrichStatus = entry.enriched ? 'success' : 'error';
    const enrichUsageKey = usageContext?.batchId
      ? `organization_enrichment:${usageContext.batchId}:${entry.domain ?? 'unknown'}`
      : `organization_enrichment:no_batch:${entry.domain ?? 'unknown'}:${startMs}`;

    trackLogResult(await logFn({
      usage_key: enrichUsageKey,
      provider_key: 'apollo',
      operation_key: 'organization_enrichment',
      batch_id: usageContext?.batchId ?? undefined,
      agent_run_id: usageContext?.agentRunId ?? undefined,
      credits_used: 1,
      results_returned: entry.enriched ? 1 : 0,
      estimated_cost_usd: organizationEnrichmentUnitCostUsd,
      status: enrichStatus,
      error_code: entry.enriched ? undefined : 'enrichment_failed',
      error_message: entry.error ? entry.error.slice(0, 200) : undefined,
      duration_ms: undefined,
      triggered_by: usageContext?.triggeredByUserId ?? undefined,
      metadata: {
        domain: entry.domain,
        fields_added: entry.fields_added ?? [],
        cascade_version: enrichmentCascadeMeta.cascade_version,
        pricing_missing_warning: organizationEnrichmentUnitCostUsd === null,
      },
    }));
  }

  // ── Q3F-5AU.12: best-effort raw industry label capture from Apollo
  // Organization Enrichment ────────────────────────────────────────────────
  // Reuses the same ingestion boundary and capture helper as Q3F-5AU.7
  // (organizations_search); only the operationKey differs. This never
  // triggers a new enrichment call — it only reads rawIndustryFields already
  // carried on enrichmentCascadeMeta.entries for entries the cascade already
  // enriched under its own feature flag. captureIndustryLabels never throws
  // by contract; the try/catch is defense in depth so a future regression
  // there still can't affect results, ranking, scoring, or usage logging.
  const enrichedIndustryObservations: ApolloIndustryRawFields[] = enrichmentCascadeMeta.entries
    .filter((entry) => entry.enriched && entry.rawIndustryFields !== undefined)
    .map((entry) => entry.rawIndustryFields as ApolloIndustryRawFields);
  const enrichmentRawIndustryLabels = ingestApolloOrganizationIndustryRawLabels(enrichedIndustryObservations);
  if (enrichmentRawIndustryLabels.length > 0) {
    const captureEnrichmentIndustryLabels = deps?.captureIndustryLabels ?? captureProviderIndustryRawLabelObservations;
    try {
      await captureEnrichmentIndustryLabels({
        sourceVocabularyKey: 'apollo_organization_industry',
        providerKey: 'apollo',
        operationKey: 'organization_enrichment',
        labels: enrichmentRawIndustryLabels.map((label) => ({
          rawLabel: label.rawLabel,
          normalizedLookupKey: normalizeClassificationValue(label.rawLabel),
        })),
        countryCode: input.countryCode ?? null,
        requestedIndustry: input.industry ?? null,
        agentRunId: usageContext?.agentRunId ?? null,
        sourceContext: {
          operation: 'apollo_organization_enrichment',
          resultCount: enrichedIndustryObservations.length,
        },
      });
    } catch {
      // Best-effort observability only — never let capture failures affect
      // the Apollo organizations search flow.
    }
  }

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
      // L2.14: samples raw de Apollo — para ver exactamente qué campos devolvió la API
      apollo_raw_result_samples_sanitized: rawResultSamples,
      // L2.15: metadata del enrichment cascade (enabled=false cuando flag OFF)
      apollo_enrichment_cascade: enrichmentCascadeMeta,
      // A1-APOLLO-WIZARD-1: paginación, presupuesto, cuota y trazabilidad por página.
      apollo_pagination: apolloPaginationMetadata,
      apollo_page_logs: apolloPageLogs,
      // Un fallo parcial tras haber obtenido resultados queda visible en vez de
      // desaparecer detrás de un resultado "exitoso".
      ...(paginated.terminalError
        ? { apollo_partial_failure: toApolloErrorLogMetadata(paginated.terminalError) }
        : {}),
      // Q3F-5AU.10S: real Apollo results were returned even if usage logging
      // failed (e.g. FK violation on batch_id) — never block results on this.
      ...(usageLoggingFailed
        ? { usage_logging_failed: true, usage_logging_errors: usageLoggingErrors }
        : {}),
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
