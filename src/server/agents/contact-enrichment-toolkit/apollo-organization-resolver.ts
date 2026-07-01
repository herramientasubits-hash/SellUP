// Agente 2A — Apollo Organization Resolver
// Hito 17A.8A — Resuelve el organization_id de Apollo para una empresa ANTES de
// buscar personas. Evita depender de q_organization_domains (poco fiable para
// empresas grandes como Siesa o Bancolombia) usando organization_ids en su lugar.
//
// Flujo:
//  A. Busca la organización por dominio: mixed_companies/search con q_organization_domains.
//  B. Si no encuentra → busca por nombre: q_organization_name.
//  C. Elige el mejor candidato por puntuación (dominio ≅ empresa + nombre ≅ nombre + país).
//  D. Devuelve organization_id cuando existe.
//
// Sin efectos secundarios: no escribe en DB, no llama a people_search.
// Inyectable para tests.

import {
  searchApolloOrganizations,
  type ApolloOrganization,
  type SearchOrganizationsParams,
  type ApolloSearchResult,
} from '@/server/integrations/apollo-client';

// ── Tipos ──────────────────────────────────────────────────────

export type ApolloOrgResolutionStatus =
  | 'found_by_domain'
  | 'found_by_name'
  | 'not_found'
  | 'error';

export interface ApolloOrgResolutionDiagnostics {
  domain_query_results: number;
  name_query_results: number;
  selected_organization_id: string | null;
  selected_organization_name: string | null;
  selected_organization_domain: string | null;
}

export interface ApolloOrgResolutionResult {
  organizationId: string | null;
  organizationName: string | null;
  organizationDomain: string | null;
  resolutionStatus: ApolloOrgResolutionStatus;
  resolutionMethod: 'domain' | 'name' | null;
  candidatesCount: number;
  diagnostics: ApolloOrgResolutionDiagnostics;
  error?: string;
}

export interface ApolloOrgResolverDeps {
  searchOrganizations?: (
    params: SearchOrganizationsParams,
  ) => Promise<ApolloSearchResult<ApolloOrganization>>;
}

// ── Scoring ────────────────────────────────────────────────────

/**
 * Puntúa un candidato de organización Apollo contra los criterios de búsqueda.
 * Criterios (mayor puntaje = mejor match):
 *  +3 dominio de website_url coincide con el dominio buscado
 *  +3 nombre exacto (case-insensitive)
 *  +1 nombre contiene/está contenido en el nombre buscado (parcial)
 *  +0.5 la organización tiene algún país registrado
 */
function scoreOrganizationCandidate(
  org: ApolloOrganization,
  queryDomain: string | null,
  queryName: string,
): number {
  let score = 0;

  if (queryDomain && org.website_url) {
    const orgDomain = org.website_url
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .split('/')[0]
      .trim();
    const normalizedQuery = queryDomain.toLowerCase().replace(/^www\./, '').trim();
    if (orgDomain === normalizedQuery || orgDomain.endsWith(`.${normalizedQuery}`) || normalizedQuery.endsWith(`.${orgDomain}`)) {
      score += 3;
    } else if (orgDomain.includes(normalizedQuery) || normalizedQuery.includes(orgDomain)) {
      score += 1;
    }
  }

  if (org.name) {
    const orgNameNorm = org.name.toLowerCase().trim();
    const queryNameNorm = queryName.toLowerCase().trim();
    if (orgNameNorm === queryNameNorm) {
      score += 3;
    } else if (orgNameNorm.includes(queryNameNorm) || queryNameNorm.includes(orgNameNorm)) {
      score += 1;
    }
  }

  if (org.country) {
    score += 0.5;
  }

  return score;
}

function pickBestCandidate(
  candidates: ApolloOrganization[],
  queryDomain: string | null,
  queryName: string,
): ApolloOrganization {
  return [...candidates].sort(
    (a, b) =>
      scoreOrganizationCandidate(b, queryDomain, queryName) -
      scoreOrganizationCandidate(a, queryDomain, queryName),
  )[0];
}

// ── Resolver principal ─────────────────────────────────────────

const ORG_SEARCH_PER_PAGE = 5;

/**
 * Resuelve el organization_id de Apollo para una empresa dada.
 *
 * Paso A: busca por dominio (q_organization_domains).
 * Paso B: si no encuentra → busca por nombre (q_organization_name).
 * Devuelve el mejor candidato o status='not_found'.
 */
export async function resolveApolloOrganization(
  domain: string | null | undefined,
  name: string,
  deps: ApolloOrgResolverDeps = {},
): Promise<ApolloOrgResolutionResult> {
  const { searchOrganizations = searchApolloOrganizations } = deps;

  const emptyDiagnostics: ApolloOrgResolutionDiagnostics = {
    domain_query_results: 0,
    name_query_results: 0,
    selected_organization_id: null,
    selected_organization_name: null,
    selected_organization_domain: null,
  };

  const normalizedDomain = domain?.trim() || null;
  const normalizedName = name?.trim() || '';

  if (!normalizedDomain && !normalizedName) {
    return {
      organizationId: null,
      organizationName: null,
      organizationDomain: null,
      resolutionStatus: 'not_found',
      resolutionMethod: null,
      candidatesCount: 0,
      diagnostics: emptyDiagnostics,
    };
  }

  // Paso A: búsqueda por dominio
  if (normalizedDomain) {
    let domainResult: ApolloSearchResult<ApolloOrganization>;
    try {
      domainResult = await searchOrganizations({
        q_organization_domains: [normalizedDomain],
        per_page: ORG_SEARCH_PER_PAGE,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        organizationId: null,
        organizationName: null,
        organizationDomain: null,
        resolutionStatus: 'error',
        resolutionMethod: null,
        candidatesCount: 0,
        diagnostics: emptyDiagnostics,
        error: `Error en resolución por dominio: ${msg}`,
      };
    }

    if (domainResult.success && domainResult.data && domainResult.data.length > 0) {
      const candidates = domainResult.data;
      const best = pickBestCandidate(candidates, normalizedDomain, normalizedName);
      return {
        organizationId: best.id,
        organizationName: best.name,
        organizationDomain: best.website_url,
        resolutionStatus: 'found_by_domain',
        resolutionMethod: 'domain',
        candidatesCount: candidates.length,
        diagnostics: {
          domain_query_results: candidates.length,
          name_query_results: 0,
          selected_organization_id: best.id,
          selected_organization_name: best.name,
          selected_organization_domain: best.website_url,
        },
      };
    }
  }

  // Paso B: búsqueda por nombre (si no encontró por dominio o no había dominio)
  if (!normalizedName) {
    return {
      organizationId: null,
      organizationName: null,
      organizationDomain: null,
      resolutionStatus: 'not_found',
      resolutionMethod: null,
      candidatesCount: 0,
      diagnostics: { ...emptyDiagnostics, domain_query_results: normalizedDomain ? 0 : 0 },
    };
  }

  let nameResult: ApolloSearchResult<ApolloOrganization>;
  try {
    nameResult = await searchOrganizations({
      q_organization_name: normalizedName,
      per_page: ORG_SEARCH_PER_PAGE,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      organizationId: null,
      organizationName: null,
      organizationDomain: null,
      resolutionStatus: 'error',
      resolutionMethod: null,
      candidatesCount: 0,
      diagnostics: emptyDiagnostics,
      error: `Error en resolución por nombre: ${msg}`,
    };
  }

  if (nameResult.success && nameResult.data && nameResult.data.length > 0) {
    const candidates = nameResult.data;
    const best = pickBestCandidate(candidates, normalizedDomain, normalizedName);
    return {
      organizationId: best.id,
      organizationName: best.name,
      organizationDomain: best.website_url,
      resolutionStatus: 'found_by_name',
      resolutionMethod: 'name',
      candidatesCount: candidates.length,
      diagnostics: {
        domain_query_results: normalizedDomain ? 0 : 0,
        name_query_results: candidates.length,
        selected_organization_id: best.id,
        selected_organization_name: best.name,
        selected_organization_domain: best.website_url,
      },
    };
  }

  return {
    organizationId: null,
    organizationName: null,
    organizationDomain: null,
    resolutionStatus: 'not_found',
    resolutionMethod: null,
    candidatesCount: 0,
    diagnostics: emptyDiagnostics,
  };
}
