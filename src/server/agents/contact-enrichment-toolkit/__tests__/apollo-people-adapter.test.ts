/**
 * Tests — Apollo People Adapter (Agente 2A, Hito 17A.3A)
 *
 * Verifica skip por datos insuficientes, error por proveedor no conectado,
 * y búsqueda exitosa con filtros HR. Usa inyección de dependencias (sin red).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchApolloPeopleForCompany,
  HR_PERSON_TITLES,
  TARGET_SENIORITIES,
} from '../apollo-people-adapter';
import type { ApolloPerson, ApolloSearchResult, SearchPeopleParams } from '@/server/integrations/apollo-client';

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

  it('aplica filtros HR/seniority y limita resultados', async () => {
    const captured: SearchPeopleParams[] = [];
    const result = await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com', maxCandidates: 5 },
      {
        isConnected: async () => true,
        searchPeople: async (params): Promise<ApolloSearchResult<ApolloPerson>> => {
          captured.push(params);
          return {
            success: true,
            data: Array.from({ length: 8 }, (_, i) => person(`p-${i}`)),
          };
        },
      },
    );

    assert.equal(result.status, 'success');
    // Se respeta el límite de maxCandidates
    assert.equal(result.people.length, 5);
    assert.equal(result.providerUsage?.creditsUsed, 5);
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].person_titles, HR_PERSON_TITLES);
    assert.deepEqual(captured[0].person_seniorities, TARGET_SENIORITIES);
    assert.deepEqual(captured[0].q_organization_domains, ['corp.com']);
  });

  it('propaga error del proveedor como status error', async () => {
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
