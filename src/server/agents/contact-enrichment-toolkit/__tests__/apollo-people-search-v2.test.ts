import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPeopleApiSearchQueryString, type PeopleApiSearchQuery } from '@/server/integrations/apollo-client';
import { buildPeopleSearchV2Plans, LEADERSHIP_SENIORITIES } from '../apollo-people-search-v2-plans';
import { searchApolloPeopleForCompany, TARGET_PERSON_TITLES } from '../apollo-people-adapter';
import type { ApolloPerson, SearchPeopleParams } from '@/server/integrations/apollo-client';

const ORG = '615724934d1be900017177b1';

describe('Apollo People Search v2 — consulta en la URL', () => {
  it('las listas van como `clave[]` repetida; booleanos y números como texto; vacíos fuera', () => {
    const qs = buildPeopleApiSearchQueryString({
      organization_ids: [ORG],
      person_titles: ['Recursos Humanos', 'L&D', '  '],
      include_similar_titles: true,
      person_locations: ['Costa Rica'],
      page: 1,
      per_page: 10,
    });
    const params = new URLSearchParams(qs);
    assert.deepEqual(params.getAll('organization_ids[]'), [ORG]);
    assert.deepEqual(params.getAll('person_titles[]'), ['Recursos Humanos', 'L&D']);
    assert.equal(params.get('include_similar_titles'), 'true');
    assert.equal(params.get('person_locations[]'), 'Costa Rica');
    assert.equal(params.get('per_page'), '10');
    // Nada de los filtros que la búsqueda de personas no documenta.
    assert.equal(qs.includes('department'), false);
    assert.equal(qs.includes('q_organization_name'), false);
  });
});

describe('Apollo People Search v2 — intentos', () => {
  const base = { titles: TARGET_PERSON_TITLES, perPage: 10, maxAttempts: 3 };

  it('con organization_id: cargos+país, cargos sin país y niveles de dirección', () => {
    const plans = buildPeopleSearchV2Plans({ ...base, organizationId: ORG, companyDomain: 'davivienda.com', personLocation: 'Colombia' });
    assert.deepEqual(plans.map((p) => p.name), ['v2_hr_titles_country', 'v2_hr_titles_any_country', 'v2_leadership']);
    for (const plan of plans) {
      assert.deepEqual(plan.query.organization_ids, [ORG]);
      assert.equal(plan.query.q_organization_domains_list, undefined);
    }
    assert.deepEqual(plans[0].query.person_locations, ['Colombia']);
    assert.equal(plans[0].query.include_similar_titles, true);
    assert.equal(plans[1].query.person_locations, undefined);
    assert.deepEqual(plans[2].query.person_seniorities, [...LEADERSHIP_SENIORITIES]);
    assert.equal(plans[2].query.person_titles, undefined);
  });

  it('sin organization_id usa el dominio documentado (q_organization_domains_list)', () => {
    const plans = buildPeopleSearchV2Plans({ ...base, organizationId: null, companyDomain: ' ACME.co ', personLocation: null });
    assert.equal(plans.length, 2);
    assert.deepEqual(plans[0].query.q_organization_domains_list, ['acme.co']);
  });

  it('sin organization_id ni dominio no hay forma documentada de acotar la empresa', () => {
    assert.deepEqual(buildPeopleSearchV2Plans({ ...base, organizationId: null, companyDomain: '', personLocation: 'Peru' }), []);
  });

  it('respeta el tope de intentos', () => {
    assert.equal(buildPeopleSearchV2Plans({ ...base, maxAttempts: 2, organizationId: ORG, companyDomain: null, personLocation: 'Peru' }).length, 2);
  });
});

function person(over: Partial<ApolloPerson> = {}): ApolloPerson {
  return { id: 'p1', first_name: 'Laura', last_name: 'Gómez', title: 'Directora de Gestión Humana', ...over } as ApolloPerson;
}

function adapterHarness(useV2: boolean, v2People: ApolloPerson[] = []) {
  const calls = { legacy: [] as SearchPeopleParams[], v2: [] as PeopleApiSearchQuery[] };
  return {
    calls,
    deps: {
      isConnected: async () => true,
      resolveOrganization: async () =>
        ({
          organizationId: ORG,
          organizationName: 'Davivienda',
          organizationDomain: 'davivienda.com',
          resolutionStatus: 'resolved',
          resolutionMethod: 'domain',
          diagnostics: { domain_query_results: 1, name_query_results: 0 },
        }) as never,
      searchPeople: async (params: SearchPeopleParams) => {
        calls.legacy.push(params);
        return { success: true, data: [] };
      },
      searchPeopleByQuery: async (query: PeopleApiSearchQuery) => {
        calls.v2.push(query);
        return { success: true, data: v2People };
      },
      isDocumentedPeopleSearchEnabled: () => useV2,
    },
  };
}

const INPUT = { runId: 'run-1', companyName: 'Davivienda Colombia', companyDomain: 'davivienda.com', companyCountryCode: 'CO' };

describe('Apollo People Search v2 — adaptador', () => {
  it('bandera apagada: sólo los intentos de siempre', async () => {
    const { deps, calls } = adapterHarness(false);
    await searchApolloPeopleForCompany(INPUT, deps);
    assert.ok(calls.legacy.length > 0);
    assert.equal(calls.v2.length, 0);
  });

  it('bandera encendida: sólo intentos documentados, y se detiene al juntar suficientes revisables', async () => {
    const people = Array.from({ length: 5 }, (_, i) =>
      person({ id: `p${i}`, first_name: `Nombre${i}`, last_name: `Apellido${i}`, linkedin_url: `https://linkedin.com/in/p${i}` } as Partial<ApolloPerson>),
    );
    const { deps, calls } = adapterHarness(true, people);
    const result = await searchApolloPeopleForCompany(INPUT, deps);
    assert.equal(calls.legacy.length, 0);
    assert.equal(calls.v2.length, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.chosenAttempt, 'v2_hr_titles_country');
    assert.equal(result.people.length, 5);
    assert.equal(result.providerUsage?.creditsUsed, 0);
  });

  it('bandera encendida y sin resultados: prueba los tres intentos documentados y nada más', async () => {
    const { deps, calls } = adapterHarness(true, []);
    const result = await searchApolloPeopleForCompany(INPUT, deps);
    assert.equal(calls.v2.length, 3);
    assert.equal(calls.legacy.length, 0);
    assert.deepEqual(result.attempts.map((a) => a.attempt), ['v2_hr_titles_country', 'v2_hr_titles_any_country', 'v2_leadership']);
  });

  it('bandera encendida pero sin org_id ni dominio: vuelve a los intentos de siempre', async () => {
    const { deps, calls } = adapterHarness(true, []);
    await searchApolloPeopleForCompany(
      { runId: 'run-1', companyName: 'Empresa Sin Web' },
      { ...deps, resolveOrganization: async () => null },
    );
    assert.equal(calls.v2.length, 0);
    assert.ok(calls.legacy.length > 0);
  });
});
