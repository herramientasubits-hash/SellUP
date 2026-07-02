/**
 * Tests — Apollo People Adapter (Agente 2A, Hito 17A.3A + 17A.8A)
 *
 * Sección 1 — Comportamiento legacy (sin org resolution):
 *  - Skip por datos insuficientes.
 *  - Error por proveedor no conectado.
 *  - Estrategia por capas / fallback por dominio.
 *  - Guardrail de intentos y resultados.
 *
 * Sección 2 — Resolución de organización (Hito 17A.8A):
 *  - Cuando resolveOrganization devuelve org_id, people_search usa organization_ids.
 *  - Fallback por nombre como 3º intento cuando hay org_id.
 *  - Cuando resolveOrganization devuelve null, el flujo legacy continúa.
 *  - Metadata de organizationResolution en el resultado.
 *
 * Usa inyección de dependencias (sin red).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchApolloPeopleForCompany,
  mapCountryCodeToApolloLocation,
  HR_PERSON_TITLES,
  TARGET_SENIORITIES,
  HR_DEPARTMENTS,
} from '../apollo-people-adapter';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import type {
  ApolloPerson,
  ApolloSearchResult,
  SearchPeopleParams,
} from '@/server/integrations/apollo-client';
import type { ApolloOrgResolutionResult } from '../apollo-organization-resolver';

function person(id: string): ApolloPerson {
  return {
    id,
    first_name: 'Ana',
    last_name: 'López',
    title: 'HR Manager',
    email: 'ana@corp.com',
    linkedin_url: null,
    phone_numbers: [],
    organization: null,
  };
}

function ok(data: ApolloPerson[]): ApolloSearchResult<ApolloPerson> {
  return { success: true, data };
}

/** Org resolution que devuelve el org_id dado. */
function orgFound(orgId: string): () => Promise<ApolloOrgResolutionResult> {
  return async () => ({
    organizationId: orgId,
    organizationName: 'Corp SA',
    organizationDomain: 'corp.com',
    resolutionStatus: 'found_by_domain',
    resolutionMethod: 'domain',
    candidatesCount: 1,
    diagnostics: {
      domain_query_results: 1,
      name_query_results: 0,
      selected_organization_id: orgId,
      selected_organization_name: 'Corp SA',
      selected_organization_domain: 'corp.com',
    },
  });
}

/** Org resolution que no encuentra nada (preserva comportamiento legacy). */
const noOrg = async (): Promise<ApolloOrgResolutionResult> => ({
  organizationId: null,
  organizationName: null,
  organizationDomain: null,
  resolutionStatus: 'not_found',
  resolutionMethod: null,
  candidatesCount: 0,
  diagnostics: {
    domain_query_results: 0,
    name_query_results: 0,
    selected_organization_id: null,
    selected_organization_name: null,
    selected_organization_domain: null,
  },
});

// ═══════════════════════════════════════════════════════════════
// Sección 1 — Comportamiento legacy (resolveOrganization → null / noOrg)
// ═══════════════════════════════════════════════════════════════

describe('searchApolloPeopleForCompany — legacy (sin org_id)', () => {
  it('skipped cuando faltan datos mínimos (sin dominio y sin nombre)', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: '', companyDomain: null },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async () => {
          throw new Error('no debe llamarse');
        },
      },
    );

    assert.equal(result.status, 'skipped');
    assert.equal(result.people.length, 0);
    assert.deepEqual(result.attempts, []);
    assert.ok(result.reason?.includes('insuficientes'));
  });

  it('error controlado cuando Apollo no está conectado', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => false,
        resolveOrganization: noOrg,
        searchPeople: async () => {
          throw new Error('no debe llamarse');
        },
      },
    );

    assert.equal(result.status, 'error');
    assert.equal(result.people.length, 0);
    assert.ok(result.reason?.toLowerCase().includes('apollo'));
  });

  it('attempt 1 estricto: prioriza dominio (sin q_organization_name), department HR, sin títulos', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Bancolombia QA Apollo', companyDomain: 'bancolombia.com', maxCandidates: 5 },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok(Array.from({ length: 8 }, (_, i) => person(`p-${i}`)));
        },
      },
    );

    assert.equal(result.status, 'success');
    // Stop early en attempt 1: una sola llamada.
    assert.equal(captured.length, 1);
    // Respeta maxCandidates.
    assert.equal(result.people.length, 5);
    // Prioriza dominio: NO envía el nombre libre (evita AND que excluye empresas grandes).
    assert.equal(captured[0].q_organization_name, undefined);
    assert.deepEqual(captured[0].q_organization_domains, ['bancolombia.com']);
    // Attempt 1 usa department + seniorities, sin títulos.
    assert.deepEqual(captured[0].person_department_or_subdepartments, HR_DEPARTMENTS);
    assert.deepEqual(captured[0].person_seniorities, TARGET_SENIORITIES);
    assert.equal(captured[0].person_titles, undefined);
    // Metadata de intentos.
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].attempt, 'strict_hr_department');
    assert.equal(result.attempts[0].rawResultsCount, 8);
  });

  it('sin dominio usa q_organization_name como fallback', async () => {
    const captured: SearchPeopleParams[] = [];
    await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp SA', companyDomain: null },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([person('p-0')]);
        },
      },
    );

    assert.equal(captured[0].q_organization_name, 'Corp SA');
    assert.equal(captured[0].q_organization_domains, undefined);
  });

  it('si attempt 1 trae 0 → ejecuta attempt 2 (títulos HR sin department)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          // attempt 1 → 0, attempt 2 → 4
          return ok(captured.length === 1 ? [] : Array.from({ length: 4 }, (_, i) => person(`p-${i}`)));
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(captured.length, 2);
    assert.equal(result.people.length, 4);
    // attempt 2: títulos HR + seniorities, sin department.
    assert.deepEqual(captured[1].person_titles, HR_PERSON_TITLES);
    assert.deepEqual(captured[1].person_seniorities, TARGET_SENIORITIES);
    assert.equal(captured[1].person_department_or_subdepartments, undefined);
    assert.deepEqual(
      result.attempts.map((a) => a.attempt),
      ['strict_hr_department', 'hr_titles_without_department'],
    );
    assert.deepEqual(
      result.attempts.map((a) => a.rawResultsCount),
      [0, 4],
    );
  });

  it('si attempt 2 trae resultados → NO ejecuta attempt 3', async () => {
    const captured: SearchPeopleParams[] = [];
    await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok(captured.length === 1 ? [] : [person('p-0'), person('p-1')]);
        },
      },
    );

    assert.equal(captured.length, 2); // nunca llega al tercer intento
  });

  it('con dominio: si nada trae resultados → ejecuta los 3 intentos del guardrail (solo capas por dominio)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.people.length, 0);
    assert.equal(result.chosenAttempt, null);
    // Guardrail limita a maxSearchAttempts=3: solo las 3 capas por dominio.
    assert.equal(captured.length, APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxSearchAttempts);
    assert.deepEqual(
      result.attempts.map((a) => a.attempt),
      ['strict_hr_department', 'hr_titles_without_department', 'broad_seniorities_only'],
    );
    // Todos los intentos usan el dominio como filtro de organización.
    assert.ok(captured.every((p) => Array.isArray(p.q_organization_domains)));
    // raw_results_count total = 0 → providerUsage refleja 0.
    assert.equal(result.providerUsage?.rawResultsCount, 0);
    assert.equal(result.providerUsage?.creditsUsed, 0);
  });

  it('caso Bancolombia: guardrail limita a 3 intentos por dominio aunque devuelvan 0 (sin fallback por nombre)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Bancolombia', companyDomain: 'bancolombia.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.people.length, 0);
    // Solo las 3 capas del guardrail, todas por dominio.
    assert.equal(captured.length, APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxSearchAttempts);
    assert.ok(captured.every((p) => Array.isArray(p.q_organization_domains)));
    assert.ok(!result.attempts.some((a) => a.attempt === 'org_name_hr_department'));
  });

  it('stop-early por revisabilidad: al alcanzar targetReviewableContacts en attempt 1, no ejecuta attempt 2', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([person('p-0'), person('p-1'), person('p-2')]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(captured.length, 1);
    assert.equal(result.attempts[0].attempt, 'strict_hr_department');
    assert.equal(result.searchGuardrail?.stopped_early_reason, 'target_reviewable_reached');
  });

  it('sin dominio (solo nombre): NO añade 4º fallback por nombre (sería redundante)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp SA', companyDomain: null },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(captured.length, 3);
    assert.ok(!result.attempts.some((a) => a.attempt === 'broad_org_name_only'));
  });

  it('no supera maxResultsPerSearchAttempt del guardrail aunque Apollo devuelva más', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async () => ok(Array.from({ length: 20 }, (_, i) => person(`p-${i}`))),
      },
    );

    assert.equal(result.people.length, APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxResultsPerSearchAttempt);
  });

  it('propaga error del proveedor como status error (con intentos previos)', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async () => ({
          success: false,
          error: { error: 'HTTP_429', message: 'rate limited' },
        }),
      },
    );

    assert.equal(result.status, 'error');
    assert.ok(result.reason?.includes('rate limited'));
  });
});

// ═══════════════════════════════════════════════════════════════
// Sección 2 — Con org_id resuelto (Hito 17A.8A)
// ═══════════════════════════════════════════════════════════════

describe('searchApolloPeopleForCompany — con organization_id resuelto (17A.8A)', () => {
  it('usa organization_ids en el primer intento cuando se resuelve org_id', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        searchPeople: async (params) => {
          captured.push(params);
          // Primer intento trae resultados suficientes → stop early.
          return ok([person('p-0'), person('p-1'), person('p-2')]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(captured.length, 1); // stop early
    // Debe usar organization_ids, NO q_organization_domains.
    assert.deepEqual(captured[0].organization_ids, ['apollo-siesa-123']);
    assert.equal(captured[0].q_organization_domains, undefined);
    assert.equal(captured[0].q_organization_name, undefined);
    // Primer intento: HR department + seniorities.
    assert.deepEqual(captured[0].person_department_or_subdepartments, HR_DEPARTMENTS);
    assert.deepEqual(captured[0].person_seniorities, TARGET_SENIORITIES);
    assert.equal(result.attempts[0].attempt, 'org_id_hr_department');
  });

  it('org_id intento 1 sin resultados → intento 2 también usa organization_ids', async () => {
    const captured: SearchPeopleParams[] = [];
    const result2 = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        searchPeople: async (params) => {
          captured.push(params);
          // intento 1 → vacío, intento 2 → resultados
          return ok(captured.length === 1 ? [] : [person('p-0'), person('p-1')]);
        },
      },
    );

    assert.equal(captured.length, 2);
    assert.deepEqual(captured[0].organization_ids, ['apollo-siesa-123']);
    assert.deepEqual(captured[1].organization_ids, ['apollo-siesa-123']);
    assert.deepEqual(captured[1].person_titles, HR_PERSON_TITLES);
    assert.equal(result2.attempts[1]?.attempt, 'org_id_hr_titles');
  });

  it('org_id intentos 1 y 2 vacíos → intento 3 usa q_organization_name como fallback', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        searchPeople: async (params) => {
          captured.push(params);
          // intentos 1-2 → vacíos, intento 3 → resultados
          return ok(captured.length <= 2 ? [] : [person('p-0'), person('p-1')]);
        },
      },
    );

    assert.equal(captured.length, 3);
    // Intento 3: nombre como fallback, no org_id.
    assert.equal(captured[2].q_organization_name, 'Siesa');
    assert.equal(captured[2].organization_ids, undefined);
    assert.deepEqual(
      result.attempts.map((a) => a.attempt),
      ['org_id_hr_department', 'org_id_hr_titles', 'org_name_hr_titles_fallback'],
    );
  });

  it('org_id → los 3 intentos agotan sin resultados → all_attempts_exhausted', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.people.length, 0);
    assert.equal(result.searchGuardrail?.stopped_early_reason, 'all_attempts_exhausted');
    assert.equal(captured.length, 3);
    assert.equal(captured[0].organization_ids?.[0], 'apollo-siesa-123');
    assert.equal(captured[1].organization_ids?.[0], 'apollo-siesa-123');
    assert.equal(captured[2].q_organization_name, 'Siesa');
  });

  it('resolveOrganization devuelve null → flujo legacy por dominio (backward compat)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: async () => null,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    // Flujo legacy: usa q_organization_domains.
    assert.ok(captured.every((p) => Array.isArray(p.q_organization_domains)));
    assert.ok(captured.every((p) => p.organization_ids === undefined));
  });

  it('organizationResolution metadata incluida en el resultado cuando se encuentra org_id', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        searchPeople: async () => ok([person('p-0'), person('p-1')]),
      },
    );

    assert.ok(result.organizationResolution !== undefined);
    assert.equal(result.organizationResolution?.status, 'found_by_domain');
    assert.equal(result.organizationResolution?.organization_id, 'apollo-siesa-123');
    assert.equal(result.organizationResolution?.resolution_method, 'domain');
    assert.equal(result.organizationResolution?.domain_query_results, 1);
  });

  it('organizationResolution metadata incluida cuando no se encuentra org_id', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async () => ok([]),
      },
    );

    assert.ok(result.organizationResolution !== undefined);
    assert.equal(result.organizationResolution?.status, 'not_found');
    assert.equal(result.organizationResolution?.organization_id, null);
  });

  it('error en resolveOrganization es non-blocking: continúa con flujo legacy', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: async () => {
          throw new Error('resolver falló');
        },
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    // Aunque resolver falló, la búsqueda continúa con flujo legacy.
    assert.equal(result.status, 'success');
    assert.ok(captured.length > 0);
    assert.ok(captured.every((p) => Array.isArray(p.q_organization_domains)));
    // organizationResolution ausente (resolver lanzó excepción).
    assert.equal(result.organizationResolution, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════
// Sección 3 — Filtro de país (Hito 17A.9B.2)
// ═══════════════════════════════════════════════════════════════

describe('mapCountryCodeToApolloLocation', () => {
  it('CO → Colombia', () => {
    assert.equal(mapCountryCodeToApolloLocation('CO'), 'Colombia');
  });

  it('MX → Mexico', () => {
    assert.equal(mapCountryCodeToApolloLocation('MX'), 'Mexico');
  });

  it('CL → Chile', () => {
    assert.equal(mapCountryCodeToApolloLocation('CL'), 'Chile');
  });

  it('PE → Peru', () => {
    assert.equal(mapCountryCodeToApolloLocation('PE'), 'Peru');
  });

  it('código no soportado → null (sin bloqueo)', () => {
    assert.equal(mapCountryCodeToApolloLocation('ZZ'), null);
  });

  it('null → null', () => {
    assert.equal(mapCountryCodeToApolloLocation(null), null);
  });

  it('undefined → null', () => {
    assert.equal(mapCountryCodeToApolloLocation(undefined), null);
  });

  it('lowercase acepted (case-insensitive)', () => {
    assert.equal(mapCountryCodeToApolloLocation('co'), 'Colombia');
  });
});

describe('searchApolloPeopleForCompany — filtro de país (17A.9B.2)', () => {
  it('CO → person_locations=[Colombia] en todos los intentos (legacy sin org_id)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Bancolombia', companyDomain: 'bancolombia.com', companyCountryCode: 'CO' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.ok(captured.length > 0);
    assert.ok(captured.every((p) => Array.isArray(p.person_locations) && p.person_locations[0] === 'Colombia'));
    assert.equal(result.countryFilter?.country_filter_applied, true);
    assert.equal(result.countryFilter?.apollo_person_location_sent, 'Colombia');
    assert.equal(result.countryFilter?.country_code_received, 'CO');
  });

  it('MX → person_locations=[Mexico] en todos los intentos', async () => {
    const captured: SearchPeopleParams[] = [];
    await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'OXXO', companyDomain: 'oxxo.com', companyCountryCode: 'MX' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.ok(captured.every((p) => Array.isArray(p.person_locations) && p.person_locations[0] === 'Mexico'));
  });

  it('sin countryCode → no envía person_locations', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.ok(captured.every((p) => p.person_locations === undefined));
    assert.equal(result.countryFilter?.country_filter_applied, false);
    assert.equal(result.countryFilter?.apollo_person_location_sent, null);
    assert.equal(result.countryFilter?.country_code_received, null);
  });

  it('countryCode no soportado → no bloquea, no envía person_locations, registra metadata', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com', companyCountryCode: 'ZZ' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.ok(captured.length > 0);
    assert.ok(captured.every((p) => p.person_locations === undefined));
    assert.equal(result.countryFilter?.country_filter_applied, false);
    assert.equal(result.countryFilter?.country_code_received, 'ZZ');
    assert.equal(result.countryFilter?.apollo_person_location_sent, null);
    assert.ok(result.countryFilter?.country_filter_reason.includes('ZZ'));
  });

  it('CO con org_id resuelto → person_locations=[Colombia] en intentos con organization_ids', async () => {
    const captured: SearchPeopleParams[] = [];
    await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com', companyCountryCode: 'CO' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    // Los intentos con org_id conservan el filtro de país.
    const orgIdAttempts = captured.filter((p) => Array.isArray(p.organization_ids));
    assert.ok(orgIdAttempts.length > 0);
    assert.ok(orgIdAttempts.every((p) => Array.isArray(p.person_locations) && p.person_locations[0] === 'Colombia'));
  });

  it('CO con org_id: intento fallback por q_organization_name también conserva person_locations', async () => {
    const captured: SearchPeopleParams[] = [];
    await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Siesa', companyDomain: 'siesa.com', companyCountryCode: 'CO' },
      {
        isConnected: async () => true,
        resolveOrganization: orgFound('apollo-siesa-123'),
        // todos vacíos → llega al intento fallback por nombre
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    const nameAttempt = captured.find((p) => p.q_organization_name === 'Siesa');
    assert.ok(nameAttempt !== undefined);
    assert.deepEqual(nameAttempt?.person_locations, ['Colombia']);
  });

  it('countryFilter.country_filter_applied = true cuando countryCode está soportado', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com', companyCountryCode: 'CL' },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async () => ok([]),
      },
    );

    assert.equal(result.countryFilter?.country_filter_applied, true);
    assert.equal(result.countryFilter?.apollo_person_location_sent, 'Chile');
  });

  it('countryFilter.country_filter_applied = false cuando no hay countryCode', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com', companyCountryCode: null },
      {
        isConnected: async () => true,
        resolveOrganization: noOrg,
        searchPeople: async () => ok([]),
      },
    );

    assert.equal(result.countryFilter?.country_filter_applied, false);
    assert.equal(result.countryFilter?.country_code_received, null);
  });
});
