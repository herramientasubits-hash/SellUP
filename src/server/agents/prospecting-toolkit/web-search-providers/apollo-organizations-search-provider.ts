/**
 * Web Search Provider — Apollo Organizations (v1.16K-W)
 *
 * Adapter de Apollo organization search para Agent 1 company discovery.
 * En este hito opera exclusivamente en modo dry-run: no llama a la API real,
 * no consume créditos, no escribe usage logs.
 *
 * El flag ENABLE_APOLLO_COMPANY_SEARCH (default: false) controla si las
 * llamadas reales están habilitadas. Mientras esté apagado, el provider
 * devuelve skipped=true con status="dry_run".
 *
 * Reglas críticas:
 * - No llama a searchApolloOrganizations() en este hito.
 * - No usa la API key de Apollo.
 * - No escribe provider_usage_logs.
 * - No modifica Tavily ni Agent 2A.
 */

import type { WebSearchInput, WebSearchOutput, WebSearchResult } from '../types';
import { isApolloCompanySearchEnabled } from '@/lib/feature-flags.server';

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

/** Contrato de usage metadata para cuando se implemente el hito real. */
export type ApolloOrganizationsUsageMetadata = {
  operation_key: 'organizations_search';
  provider_key: 'apollo';
  credits_used: number;
  estimated_cost_usd: number;
  status: 'dry_run' | 'real';
};

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

// ─── Fixture dry-run ──────────────────────────────────────────────────────────

/** Fixture representativo para dry-run. No se usa en producción real. */
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

// ─── Provider público ─────────────────────────────────────────────────────────

/**
 * Provider apollo_organizations para Agent 1.
 *
 * Mientras ENABLE_APOLLO_COMPANY_SEARCH=false (default), devuelve:
 * - skipped: true
 * - skipReason: 'apollo_company_search_disabled'
 * - estimatedCostUsd: 0
 * - status: 'dry_run' en metadata
 *
 * Cuando el flag esté activo (hito siguiente), aquí se conectará
 * searchApolloOrganizations() con budget caps y usage logging real.
 */
export async function runApolloOrganizationsSearch(
  input: WebSearchInput,
  maxResults: number,
): Promise<WebSearchOutput> {
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

  // Dry-run explícito: devuelve fixture sin llamar Apollo real.
  // El hito real conectará searchApolloOrganizations() aquí.
  const cap = Math.min(maxResults, DRY_RUN_FIXTURE_ORGS.length);
  const results = DRY_RUN_FIXTURE_ORGS.slice(0, cap).map((org, i) =>
    mapApolloOrganizationToSearchResult(org, i + 1),
  );

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
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: {
      dry_run: true,
      note: 'Apollo Organizations dry-run — fixture data, no real API call',
      usage: usageMeta,
    },
  };
}
