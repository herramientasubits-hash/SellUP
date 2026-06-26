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

  it('si los 3 intentos traen 0 → success con people [] y 3 intentos registrados', async () => {
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
    assert.equal(captured.length, 3);
    assert.equal(result.attempts.length, 3);
    assert.deepEqual(
      result.attempts.map((a) => a.attempt),
      ['strict_hr_department', 'hr_titles_without_department', 'broad_seniorities_only'],
    );
    // El tercer intento es el fallback amplio: solo seniorities.
    assert.equal(captured[2].person_titles, undefined);
    assert.equal(captured[2].person_department_or_subdepartments, undefined);
    assert.deepEqual(captured[2].person_seniorities, TARGET_SENIORITIES);
    // raw_results_count total = 0 → providerUsage refleja 0.
    assert.equal(result.providerUsage?.rawResultsCount, 0);
    assert.equal(result.providerUsage?.creditsUsed, 0);
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
