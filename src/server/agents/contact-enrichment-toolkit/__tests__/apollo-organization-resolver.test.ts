/**
 * Tests — Apollo Organization Resolver (Agente 2A, Hito 17A.8A)
 *
 * Verifica:
 *  - Resolución por dominio (paso A): encuentra org, elige el mejor candidato.
 *  - Fallback por nombre (paso B): sin dominio o dominio sin resultados.
 *  - Sin resultados en ningún paso → status 'not_found'.
 *  - Error de red → status 'error' (no rompe el flujo).
 *  - Sin datos mínimos → 'not_found' inmediato.
 *  - Scoring: candidato con dominio ≅ empresa y nombre ≅ empresa gana.
 * Usa inyección de dependencias (sin red).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveApolloOrganization } from '../apollo-organization-resolver';
import type { ApolloOrganization, ApolloSearchResult } from '@/server/integrations/apollo-client';

function org(overrides: Partial<ApolloOrganization> & { id: string }): ApolloOrganization {
  return {
    name: overrides.name ?? 'Empresa Test',
    website_url: overrides.website_url ?? null,
    linkedin_url: null,
    industry: null,
    industry_tag_ids: [],
    employee_count: null,
    estimated_num_employees: null,
    city: null,
    country: overrides.country ?? null,
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: null,
    keywords: [],
    ...overrides,
  };
}

function okOrgs(data: ApolloOrganization[]): ApolloSearchResult<ApolloOrganization> {
  return { success: true, data };
}

function emptyOrgs(): ApolloSearchResult<ApolloOrganization> {
  return { success: true, data: [] };
}

describe('resolveApolloOrganization', () => {
  it('sin dominio y sin nombre → not_found inmediato sin llamar Apollo', async () => {
    const result = await resolveApolloOrganization(null, '', {
      searchOrganizations: async () => {
        throw new Error('no debe llamarse');
      },
    });

    assert.equal(result.resolutionStatus, 'not_found');
    assert.equal(result.organizationId, null);
    assert.equal(result.resolutionMethod, null);
    assert.equal(result.candidatesCount, 0);
  });

  it('encuentra org por dominio → resolutionStatus found_by_domain', async () => {
    const calls: string[] = [];
    const result = await resolveApolloOrganization('siesa.com', 'Siesa', {
      searchOrganizations: async (params) => {
        if (params.q_organization_domains) {
          calls.push('domain');
          return okOrgs([org({ id: 'org-siesa-1', name: 'Siesa', website_url: 'https://siesa.com' })]);
        }
        calls.push('name');
        return emptyOrgs();
      },
    });

    assert.equal(result.resolutionStatus, 'found_by_domain');
    assert.equal(result.resolutionMethod, 'domain');
    assert.equal(result.organizationId, 'org-siesa-1');
    assert.equal(result.organizationName, 'Siesa');
    assert.equal(result.candidatesCount, 1);
    assert.deepEqual(calls, ['domain']); // no llama al paso B
    assert.equal(result.diagnostics.domain_query_results, 1);
    assert.equal(result.diagnostics.name_query_results, 0);
  });

  it('dominio sin resultados → fallback por nombre (found_by_name)', async () => {
    const calls: string[] = [];
    const result = await resolveApolloOrganization('siesa.com', 'Siesa', {
      searchOrganizations: async (params) => {
        if (params.q_organization_domains) {
          calls.push('domain');
          return emptyOrgs();
        }
        calls.push('name');
        return okOrgs([org({ id: 'org-siesa-2', name: 'Siesa S.A.S', website_url: 'https://www.siesa.com' })]);
      },
    });

    assert.equal(result.resolutionStatus, 'found_by_name');
    assert.equal(result.resolutionMethod, 'name');
    assert.equal(result.organizationId, 'org-siesa-2');
    assert.deepEqual(calls, ['domain', 'name']); // ejecutó ambos pasos
    assert.equal(result.diagnostics.name_query_results, 1);
  });

  it('sin dominio → busca directamente por nombre', async () => {
    const calls: string[] = [];
    const result = await resolveApolloOrganization(null, 'Siesa', {
      searchOrganizations: async (params) => {
        if (params.q_organization_name) {
          calls.push('name');
          return okOrgs([org({ id: 'org-siesa-3', name: 'Siesa' })]);
        }
        calls.push('domain');
        return emptyOrgs();
      },
    });

    assert.equal(result.resolutionStatus, 'found_by_name');
    assert.equal(result.organizationId, 'org-siesa-3');
    assert.deepEqual(calls, ['name']); // solo nombre, sin paso por dominio
  });

  it('ningún resultado en ningún paso → not_found', async () => {
    const result = await resolveApolloOrganization('siesa.com', 'Siesa', {
      searchOrganizations: async () => emptyOrgs(),
    });

    assert.equal(result.resolutionStatus, 'not_found');
    assert.equal(result.organizationId, null);
    assert.equal(result.resolutionMethod, null);
    assert.equal(result.candidatesCount, 0);
  });

  it('error de red en paso A → status error (non-blocking)', async () => {
    const result = await resolveApolloOrganization('siesa.com', 'Siesa', {
      searchOrganizations: async () => {
        throw new Error('connection timeout');
      },
    });

    assert.equal(result.resolutionStatus, 'error');
    assert.equal(result.organizationId, null);
    assert.ok(result.error?.includes('connection timeout'));
  });

  it('elige el mejor candidato cuando hay múltiples — prefiere coincidencia exacta de dominio', async () => {
    const result = await resolveApolloOrganization('siesa.com', 'Siesa', {
      searchOrganizations: async (params) => {
        if (params.q_organization_domains) {
          return okOrgs([
            // Candidato malo: nombre diferente, sin dominio
            org({ id: 'bad-org', name: 'Otro Corp', website_url: null }),
            // Candidato bueno: nombre exacto + dominio exacto
            org({ id: 'good-org', name: 'Siesa', website_url: 'https://siesa.com' }),
          ]);
        }
        return emptyOrgs();
      },
    });

    assert.equal(result.organizationId, 'good-org');
    assert.equal(result.candidatesCount, 2);
  });

  it('elige el mejor candidato por nombre cuando no hay dominio exacto', async () => {
    const result = await resolveApolloOrganization('siesa.com', 'Siesa', {
      searchOrganizations: async (params) => {
        if (params.q_organization_domains) {
          return okOrgs([
            // Ambos candidatos son similares; el nombre exacto debería ganar
            org({ id: 'partial', name: 'Siesa Technologies', website_url: 'https://tech.siesa.com' }),
            org({ id: 'exact', name: 'Siesa', website_url: 'https://siesa.com' }),
          ]);
        }
        return emptyOrgs();
      },
    });

    assert.equal(result.organizationId, 'exact');
  });

  it('diagnostics incluyen conteos correctos de ambos pasos', async () => {
    const result = await resolveApolloOrganization('noop.com', 'Target Corp', {
      searchOrganizations: async (params) => {
        if (params.q_organization_domains) return emptyOrgs();
        return okOrgs([
          org({ id: 'org-a', name: 'Target Corp' }),
          org({ id: 'org-b', name: 'Target Corp SA' }),
        ]);
      },
    });

    assert.equal(result.resolutionStatus, 'found_by_name');
    assert.equal(result.diagnostics.domain_query_results, 0);
    assert.equal(result.diagnostics.name_query_results, 2);
    assert.equal(result.diagnostics.selected_organization_id, result.organizationId);
  });
});
