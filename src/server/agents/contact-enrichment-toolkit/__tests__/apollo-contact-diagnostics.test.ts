/**
 * Tests — Apollo Contact Diagnostics (Agente 2A)
 *
 * Verifica el diagnóstico controlado (mockeando Apollo, sin red):
 *  - organization encontrado → intenta organization_id.
 *  - organization no encontrado → NO intenta organization_id.
 *  - people por dominio sin filtros trae resultados → lo reporta.
 *  - people por organization_id trae resultados → lo reporta.
 *  - no se exponen emails/teléfonos/API keys en el output.
 *  - presupuesto: máximo 4 llamadas Apollo, per_page tope 3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloContactDiagnostics,
  MAX_DIAGNOSTIC_APOLLO_CALLS,
} from '../apollo-contact-diagnostics';
import type {
  ApolloOrganization,
  ApolloPerson,
  ApolloSearchResult,
  SearchOrganizationsParams,
  SearchPeopleParams,
} from '@/server/integrations/apollo-client';

// ── Factories ──────────────────────────────────────────────────

function org(id: string): ApolloOrganization {
  return {
    id,
    name: 'Bancolombia',
    website_url: 'bancolombia.com',
    linkedin_url: null,
    industry: null,
    industry_tag_ids: [],
    employee_count: null,
    estimated_num_employees: null,
    city: null,
    country: null,
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: null,
    keywords: [],
  };
}

function person(id: string, title: string): ApolloPerson {
  return {
    id,
    first_name: 'Ana',
    last_name: 'Pérez',
    title,
    email: 'ana.perez@bancolombia.com',
    linkedin_url: 'https://linkedin.com/in/ana',
    phone_numbers: [{ sanitized_number: '+573001112233', type: 'work' }],
    organization: null,
    headline: `${title} en Bancolombia`,
  };
}

function okOrgs(data: ApolloOrganization[]): ApolloSearchResult<ApolloOrganization> {
  return { success: true, data, total: data.length };
}

function okPeople(data: ApolloPerson[], total?: number): ApolloSearchResult<ApolloPerson> {
  return { success: true, data, total: total ?? data.length };
}

const CONNECTED = { isConnected: async () => true };

// ── Tests ──────────────────────────────────────────────────────

describe('runApolloContactDiagnostics', () => {
  it('organization encontrado → intenta organization_id (Test 3 corre)', async () => {
    const peopleParams: SearchPeopleParams[] = [];
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com', companyName: 'Bancolombia' },
      {
        ...CONNECTED,
        searchOrganizations: async () => okOrgs([org('org-123')]),
        searchPeople: async (p) => {
          peopleParams.push(p);
          return okPeople([]);
        },
      },
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.test1OrgByDomain.found, true);
    assert.equal(result.test1OrgByDomain.firstOrganizationId, 'org-123');
    // Test 3 corre con organization_ids.
    assert.equal(result.test3PeopleByOrgId.ran, true);
    assert.ok(peopleParams.some((p) => p.organization_ids?.includes('org-123')));
  });

  it('organization NO encontrado → NO intenta organization_id (Test 3/4 no corren)', async () => {
    const peopleParams: SearchPeopleParams[] = [];
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'desconocida.com' },
      {
        ...CONNECTED,
        searchOrganizations: async () => okOrgs([]),
        searchPeople: async (p) => {
          peopleParams.push(p);
          return okPeople([]);
        },
      },
    );

    assert.equal(result.test1OrgByDomain.found, false);
    assert.equal(result.test3PeopleByOrgId.ran, false);
    assert.equal(result.test4PeopleByOrgIdWithHrFilters.ran, false);
    // Nunca se envía organization_ids.
    assert.ok(!peopleParams.some((p) => p.organization_ids));
    // Solo Test 1 (org) + Test 2 (people by domain) = 2 llamadas.
    assert.equal(result.apolloCallsUsed, 2);
  });

  it('people por dominio sin filtros trae resultados → lo reporta', async () => {
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com' },
      {
        ...CONNECTED,
        searchOrganizations: async () => okOrgs([]),
        searchPeople: async () => okPeople([person('p1', 'HR Manager'), person('p2', 'Recruiter')], 540),
      },
    );

    assert.equal(result.test2PeopleByDomain.ran, true);
    assert.equal(result.test2PeopleByDomain.rawResultsCount, 2);
    assert.equal(result.test2PeopleByDomain.totalEntries, 540);
    assert.deepEqual(result.test2PeopleByDomain.sampleTitles, ['HR Manager', 'Recruiter']);
  });

  it('people por organization_id trae resultados → lo reporta y corre Test 4', async () => {
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com' },
      {
        ...CONNECTED,
        searchOrganizations: async () => okOrgs([org('org-123')]),
        searchPeople: async (p) => {
          // Por dominio → 0; por organization_id → trae personas.
          if (p.q_organization_domains) return okPeople([]);
          if (p.organization_ids && !p.person_seniorities) return okPeople([person('p1', 'CHRO')], 12);
          // Test 4 (org_id + HR/seniority) → 0.
          return okPeople([]);
        },
      },
    );

    assert.equal(result.test3PeopleByOrgId.rawResultsCount, 1);
    assert.deepEqual(result.test3PeopleByOrgId.sampleTitles, ['CHRO']);
    // Test 4 corre porque Test 3 trajo personas.
    assert.equal(result.test4PeopleByOrgIdWithHrFilters.ran, true);
    assert.equal(result.test4PeopleByOrgIdWithHrFilters.rawResultsCount, 0);
    assert.ok(/organization_ids/.test(result.recommendation) || /relajar|org-only/i.test(result.recommendation));
  });

  it('NO expone emails, teléfonos ni API keys en el output', async () => {
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com' },
      {
        ...CONNECTED,
        searchOrganizations: async () => okOrgs([org('org-123')]),
        searchPeople: async () => okPeople([person('p1', 'HR Manager')], 5),
      },
    );

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('@bancolombia.com'), 'no debe filtrar emails');
    assert.ok(!serialized.includes('+57'), 'no debe filtrar teléfonos');
    assert.ok(!serialized.includes('Ana'), 'no debe filtrar nombres de personas');
    assert.ok(!/X-Api-Key|api[_-]?key/i.test(serialized), 'no debe filtrar API keys');
  });

  it('respeta el presupuesto de 4 llamadas y capa per_page a 3', async () => {
    const peopleParams: SearchPeopleParams[] = [];
    const orgParams: SearchOrganizationsParams[] = [];
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com', perPage: 50 },
      {
        ...CONNECTED,
        searchOrganizations: async (p) => {
          orgParams.push(p);
          return okOrgs([org('org-123')]);
        },
        searchPeople: async (p) => {
          peopleParams.push(p);
          return okPeople([person(`p${peopleParams.length}`, 'HR Manager')], 5);
        },
      },
    );

    assert.ok(result.apolloCallsUsed <= MAX_DIAGNOSTIC_APOLLO_CALLS);
    assert.equal(orgParams[0].per_page, 3);
    assert.ok(peopleParams.every((p) => p.per_page === 3));
  });

  it('error controlado cuando Apollo no está conectado (0 llamadas)', async () => {
    let called = false;
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com' },
      {
        isConnected: async () => false,
        searchOrganizations: async () => {
          called = true;
          return okOrgs([]);
        },
        searchPeople: async () => {
          called = true;
          return okPeople([]);
        },
      },
    );

    assert.equal(result.status, 'error');
    assert.equal(result.apolloCallsUsed, 0);
    assert.equal(called, false);
    assert.ok(result.reason?.toLowerCase().includes('apollo'));
  });

  it('reporta httpError de forma segura cuando Apollo devuelve error de proveedor', async () => {
    const result = await runApolloContactDiagnostics(
      { companyDomain: 'bancolombia.com' },
      {
        ...CONNECTED,
        searchOrganizations: async () => okOrgs([org('org-1')]),
        searchPeople: async () => ({
          success: false,
          error: { error: 'HTTP_403', message: 'insufficient permissions for people search' },
        }),
      },
    );

    assert.ok(result.test2PeopleByDomain.httpError?.includes('HTTP_403'));
    assert.ok(/permisos|Master Key/i.test(result.probableRootCause + result.recommendation));
  });
});
