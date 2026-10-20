import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { organizationsForPeopleSearch } from '../apollo-org-search-for-people.server';
import { resolveApolloOrganization, type ApolloOrgResolverDeps } from '../apollo-organization-resolver';
import { apolloOrgResolutionCredits } from '../apollo-people-adapter';

const REAL_ORG = { id: '5f2a9c1e7b3d4a0012ab34cd', name: 'Banco Davivienda', primary_domain: 'davivienda.com', website_url: 'http://www.davivienda.com' };

describe('identificar la empresa: cuentas del espacio vs. empresas de Apollo', () => {
  it('con `accounts: []` NO se pierden las empresas reales (el `accounts ?? organizations` de antes)', () => {
    const { organizations, rawEntries } = organizationsForPeopleSearch({ accounts: [], organizations: [REAL_ORG] });
    assert.deepEqual(organizations.map((o) => o.id), [REAL_ORG.id]);
    assert.equal(rawEntries, 1);
  });

  it('una cuenta guardada por nosotros sin organization_id no es una empresa (caso «La boliviana Ciacruz»)', () => {
    const { organizations, rawEntries } = organizationsForPeopleSearch({
      accounts: [{ id: '6a3d5a9e33d3160001022400', name: 'La boliviana Ciacruz', organization_id: null }],
      organizations: [],
    });
    assert.deepEqual(organizations, []);
    // Apollo cobra la página igual: el conteo crudo lo refleja.
    assert.equal(rawEntries, 1);
  });

  it('una cuenta con organization_id cuenta por ESE id, nunca por el de la cuenta', () => {
    const { organizations } = organizationsForPeopleSearch({
      accounts: [{ id: '615724934d1be900017177b1', name: 'Davivienda Colombia', organization_id: REAL_ORG.id }],
    });
    assert.deepEqual(organizations.map((o) => o.id), [REAL_ORG.id]);
  });

  it('payload vacío o ilegible: nada, sin lanzar', () => {
    assert.deepEqual(organizationsForPeopleSearch(null), { organizations: [], rawEntries: 0 });
    assert.deepEqual(organizationsForPeopleSearch({ organizations: 'x' }), { organizations: [], rawEntries: 0 });
  });
});

describe('resolvedor con cuentas sin empresa', () => {
  it('sólo cuentas por dominio y por nombre ⇒ no encontrada (la búsqueda de personas irá por dominio) y los créditos se cuentan', async () => {
    const deps: ApolloOrgResolverDeps = {
      searchOrganizations: async () => ({ success: true, data: [], rawEntries: 1 }) as never,
    };
    const result = await resolveApolloOrganization('lbc.bo.co', 'La boliviana Ciacruz', deps);
    assert.equal(result.organizationId, null);
    assert.equal(result.resolutionStatus, 'not_found');
    assert.equal(result.diagnostics.domain_query_results, 1);
    assert.equal(result.diagnostics.name_query_results, 1);
    assert.equal(
      apolloOrgResolutionCredits({
        status: result.resolutionStatus,
        organization_id: null,
        organization_name: null,
        organization_domain: null,
        resolution_method: null,
        domain_query_results: result.diagnostics.domain_query_results,
        name_query_results: result.diagnostics.name_query_results,
      }),
      2,
    );
  });
});
