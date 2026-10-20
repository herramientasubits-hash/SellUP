import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readOrganizationId, runPeopleSearchDiagnostic } from '../apollo-people-search-diagnostic.server';
import type { ApolloPerson, PeopleApiSearchQuery } from '@/server/integrations/apollo-client';

const TARGET = { companyName: 'Davivienda Colombia', companyDomain: 'davivienda.com', countryCode: 'CO', organizationId: '615724934d1be900017177b1' };

describe('Diagnóstico de búsqueda de personas', () => {
  it('corre las dos versiones con el organization_id guardado y sólo devuelve conteos y cargos', async () => {
    const calls = { legacy: 0, v2: [] as PeopleApiSearchQuery[] };
    const report = await runPeopleSearchDiagnostic(TARGET, {
      isConnected: async () => true,
      searchPeople: async () => {
        calls.legacy += 1;
        return { success: true, data: [] };
      },
      searchPeopleByQuery: async (q) => {
        calls.v2.push(q);
        return {
          success: true,
          data: [{ id: 'x', first_name: 'Ana', last_name: null, title: 'Gerente de Gestión Humana', email: 'no@debe.salir' } as unknown as ApolloPerson],
        };
      },
    });
    assert.equal(report.creditsUsed, 0);
    assert.ok(calls.legacy > 0);
    assert.ok(calls.v2.length > 0);
    assert.deepEqual(calls.v2[0].organization_ids, [TARGET.organizationId]);
    assert.equal(report.current.peopleReturned, 0);
    // Tercera columna: la misma búsqueda documentada, sólo por dominio.
    assert.ok(report.documentedByDomain);
    assert.ok(calls.v2.some((q) => Array.isArray(q.q_organization_domains_list) && q.q_organization_domains_list[0] === 'davivienda.com'));
    assert.ok(report.documented.peopleReturned > 0);
    assert.deepEqual(report.documented.sampleTitles.slice(0, 1), ['Gerente de Gestión Humana']);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('no@debe.salir'), false);
    assert.equal(serialized.includes('"Ana"'), false);
  });

  it('lee el organization_id del summary de la búsqueda anterior', () => {
    assert.equal(readOrganizationId({ apollo_enrichment: { apollo_organization_resolution: { organization_id: ' abc ' } } }), 'abc');
    assert.equal(readOrganizationId({ apollo_enrichment: {} }), null);
    assert.equal(readOrganizationId(null), null);
  });

  it('la ruta es sólo para administradores y nunca resuelve la empresa en Apollo (eso cobra)', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/debug/agent2-apollo-people-search/route.ts'), 'utf8');
    assert.match(route, /rpc\('is_admin'/);
    const core = readFileSync(join(process.cwd(), 'src/server/agents/contact-enrichment-toolkit/apollo-people-search-diagnostic.server.ts'), 'utf8');
    assert.equal(/resolveApolloOrganization|searchApolloOrganizations|matchApolloPerson/.test(core), false);
  });
});
