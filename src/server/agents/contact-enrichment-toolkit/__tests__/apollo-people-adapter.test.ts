/**
 * Tests — Apollo People Adapter (Agente 2A, Hito 17A.3A)
 *
 * Verifica skip por datos insuficientes, error por proveedor no conectado,
 * y la estrategia de búsqueda por capas / fallback controlado:
 *  - Attempt 1 estricto (department HR, sin títulos), prioriza dominio.
 *  - Si trae 0 → ejecuta attempt 2 (títulos HR sin department).
 *  - Si attempt 2 trae resultados → no ejecuta attempt 3.
 *  - Si los 3 traen 0 → success con people [] y metadata de intentos.
 * Usa inyección de dependencias (sin red).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchApolloPeopleForCompany,
  HR_PERSON_TITLES,
  TARGET_SENIORITIES,
  HR_DEPARTMENTS,
} from '../apollo-people-adapter';
import type {
  ApolloPerson,
  ApolloSearchResult,
  SearchPeopleParams,
} from '@/server/integrations/apollo-client';

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

describe('searchApolloPeopleForCompany', () => {
  it('skipped cuando faltan datos mínimos (sin dominio y sin nombre)', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: '', companyDomain: null },
      {
        isConnected: async () => true,
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
        searchPeople: async (params) => {
          captured.push(params);
          return ok(captured.length === 1 ? [] : [person('p-0'), person('p-1')]);
        },
      },
    );

    assert.equal(captured.length, 2); // nunca llega al tercer intento
  });

  it('con dominio: si nada trae resultados → ejecuta los 7 intentos en orden (nombre HR antes del amplio)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.people.length, 0);
    assert.equal(result.chosenAttempt, null);
    // 3 capas por dominio + 3 por nombre con filtros HR + 1 amplio por nombre.
    assert.equal(captured.length, 7);
    assert.deepEqual(
      result.attempts.map((a) => a.attempt),
      [
        'strict_hr_department',
        'hr_titles_without_department',
        'broad_seniorities_only',
        'org_name_hr_department',
        'org_name_hr_titles',
        'org_name_hr_titles_no_seniority',
        'broad_org_name_only',
      ],
    );
    // Intentos 4-6 usan q_organization_name CON filtros HR (no el amplio).
    assert.equal(captured[3].q_organization_name, 'Corp');
    assert.deepEqual(captured[3].person_department_or_subdepartments, HR_DEPARTMENTS);
    assert.deepEqual(captured[4].person_titles, HR_PERSON_TITLES);
    assert.deepEqual(captured[4].person_seniorities, TARGET_SENIORITIES);
    assert.deepEqual(captured[5].person_titles, HR_PERSON_TITLES);
    assert.equal(captured[5].person_seniorities, undefined);
    // El 7º (último) intento es amplio: nombre sin filtros de persona.
    assert.equal(captured[6].q_organization_name, 'Corp');
    assert.equal(captured[6].q_organization_domains, undefined);
    assert.equal(captured[6].person_seniorities, undefined);
    assert.equal(captured[6].person_titles, undefined);
    assert.equal(captured[6].person_department_or_subdepartments, undefined);
    // raw_results_count total = 0 → providerUsage refleja 0.
    assert.equal(result.providerUsage?.rawResultsCount, 0);
    assert.equal(result.providerUsage?.creditsUsed, 0);
  });

  it('caso Bancolombia: dominio 0 en 3 capas, el 1er intento HR por nombre trae personas y para (no llega al amplio)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Bancolombia', companyDomain: 'bancolombia.com', maxCandidates: 5 },
      {
        isConnected: async () => true,
        searchPeople: async (params) => {
          captured.push(params);
          // Capas 1-3 (con dominio) → 0; capas por nombre (HR) → personas revisables.
          if (params.q_organization_domains) return ok([]);
          if (params.q_organization_name) return ok(Array.from({ length: 3 }, (_, i) => person(`p-${i}`)));
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.people.length, 3);
    // Stop early en el 4º intento (1er intento HR por nombre): nunca llega al amplio.
    assert.equal(captured.length, 4);
    assert.equal(result.chosenAttempt, 'org_name_hr_department');
    assert.equal(result.attempts[3].attempt, 'org_name_hr_department');
    assert.equal(result.attempts[3].rawResultsCount, 3);
    assert.ok(!result.attempts.some((a) => a.attempt === 'broad_org_name_only'));
    assert.equal(captured[3].q_organization_name, 'Bancolombia');
  });

  it('stop-early por revisabilidad: un intento amplio que solo trae ruido NO detiene la búsqueda', async () => {
    // attempt 3 (broad_seniorities_only) trae un perfil normalizable pero NO relevante
    // (Software Engineer); debe seguir hacia los intentos HR por nombre.
    const noise: ApolloPerson = {
      id: 'noise',
      first_name: 'Diego',
      last_name: 'Ramírez',
      title: 'Software Engineer',
      email: null,
      linkedin_url: null,
      phone_numbers: [],
      organization: null,
    };
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com', maxCandidates: 5 },
      {
        isConnected: async () => true,
        searchPeople: async (params) => {
          captured.push(params);
          // Capas 1-2 (dominio) → 0; capa 3 (broad seniorities) → ruido no relevante;
          // capa 4 (HR por nombre) → candidato revisable.
          if (captured.length === 3) return ok([noise]);
          if (params.q_organization_name && params.person_department_or_subdepartments) {
            return ok([person('hr-1')]);
          }
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    // No paró en el ruido del intento 3: continuó hasta el intento HR por nombre.
    assert.equal(result.chosenAttempt, 'org_name_hr_department');
    assert.equal(result.people.length, 1);
    assert.equal(result.people[0].id, 'hr-1');
  });

  it('sin dominio (solo nombre): NO añade 4º fallback por nombre (sería redundante)', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp SA', companyDomain: null },
      {
        isConnected: async () => true,
        searchPeople: async (params) => {
          captured.push(params);
          return ok([]);
        },
      },
    );

    assert.equal(result.status, 'success');
    // Solo 3 intentos: las capas ya usaban el nombre como filtro de organización.
    assert.equal(captured.length, 3);
    assert.ok(!result.attempts.some((a) => a.attempt === 'broad_org_name_only'));
  });

  it('no supera maxCandidates aunque Apollo devuelva más', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com', maxCandidates: 3 },
      {
        isConnected: async () => true,
        searchPeople: async () => ok(Array.from({ length: 20 }, (_, i) => person(`p-${i}`))),
      },
    );

    assert.equal(result.people.length, 3);
  });

  it('propaga error del proveedor como status error (con intentos previos)', async () => {
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
      {
        isConnected: async () => true,
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
