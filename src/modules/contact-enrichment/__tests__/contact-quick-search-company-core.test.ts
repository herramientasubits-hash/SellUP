// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — empresa sugerida de la búsqueda puntual:
// HubSpot primero, después SellUp; sólo coincidencia ÚNICA y exacta. Dobles en memoria.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCompanyNameKey,
  quickSearchCandidateDomains,
  resolveQuickSearchCompany,
  type QuickSearchCompanyDeps,
} from '../contact-quick-search-company-core';
import type { HubSpotCompanyMatch, SellUpAccountMatch } from '@/server/agents/contact-enrichment-toolkit/types';
import type { CompanyCandidate } from '../types';

function hs(id: string, name: string, domain: string | null): HubSpotCompanyMatch {
  return { id, name, domain, website: null };
}
function su(id: string, name: string, domain: string | null): SellUpAccountMatch {
  return { id, name, domain, country: null, country_code: null, hubspot_company_id: null };
}

function makeDeps(overrides: Partial<QuickSearchCompanyDeps> = {}) {
  const calls: string[] = [];
  const deps: QuickSearchCompanyDeps = {
    getHubSpotCompanyById: async (id) => {
      calls.push(`hs-id:${id}`);
      return [];
    },
    searchHubSpotByDomain: async (domain) => {
      calls.push(`hs-domain:${domain}`);
      return [];
    },
    searchHubSpotByName: async (name) => {
      calls.push(`hs-name:${name}`);
      return [];
    },
    searchSellUpByDomain: async (domain) => {
      calls.push(`su-domain:${domain}`);
      return [];
    },
    searchSellUpByName: async (name) => {
      calls.push(`su-name:${name}`);
      return [];
    },
    toHubSpotCandidate: (m): CompanyCandidate => ({ source: 'hubspot', hubspotCompanyId: m.id, name: m.name ?? '', domain: m.domain, matchConfidence: 1 }),
    toSellUpCandidate: (m): CompanyCandidate => ({ source: 'sellup', sellupAccountId: m.id, name: m.name, domain: m.domain, matchConfidence: 1 }),
    ...overrides,
  };
  return { deps, calls };
}

const INPUT = { companyDomain: 'https://www.ficticia.test', companyName: 'Ficticia S.A.S.', email: 'ana@ficticia.test' };

describe('normalización', () => {
  it('el nombre se compara sin tildes, signos ni sufijo societario', () => {
    assert.equal(normalizeCompanyNameKey('Compañía Ficticia S.A.S.'), 'compania ficticia');
    assert.equal(normalizeCompanyNameKey('COMPAÑIA FICTICIA SAS'), 'compania ficticia');
    assert.notEqual(normalizeCompanyNameKey('Ficticia Perú'), normalizeCompanyNameKey('Ficticia'));
  });

  it('dominios: el del proveedor y el del correo, sin repetir ni genéricos', () => {
    assert.deepEqual(quickSearchCandidateDomains(INPUT), ['ficticia.test']);
    assert.deepEqual(quickSearchCandidateDomains({ companyDomain: 'a.test', email: 'x@b.test' }), ['a.test', 'b.test']);
    assert.deepEqual(quickSearchCandidateDomains({ email: 'x@gmail.com' }), []);
  });
});

describe('resolveQuickSearchCompany', () => {
  it('la empresa asociada al contacto de HubSpot manda (y no se busca más)', async () => {
    const { deps, calls } = makeDeps({ getHubSpotCompanyById: async () => [hs('777', 'Asociada', 'asociada.test')] });
    const result = await resolveQuickSearchCompany({ ...INPUT, hubspotCompanyId: '777' }, deps);
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.matchedBy, 'hubspot_contact_company');
    assert.deepEqual(calls, []);
  });

  it('HubSpot antes que SellUp: con coincidencia única en HubSpot no se mira SellUp', async () => {
    const { deps, calls } = makeDeps({
      searchHubSpotByDomain: async () => [hs('1', 'Ficticia', 'ficticia.test')],
      searchSellUpByDomain: async () => [su('acc-1', 'Ficticia', 'ficticia.test')],
    });
    const result = await resolveQuickSearchCompany(INPUT, deps);
    assert.equal(result.status === 'resolved' && result.company.source, 'hubspot');
    assert.equal(calls.some((c) => c.startsWith('su-')), false);
  });

  it('sólo cuenta el dominio EXACTO (la búsqueda del adaptador es parcial)', async () => {
    const { deps } = makeDeps({
      searchHubSpotByDomain: async () => [hs('1', 'Ficticia', 'ficticia.test'), hs('2', 'Ficticia Shop', 'shop.ficticia.test.co')],
    });
    const result = await resolveQuickSearchCompany(INPUT, deps);
    assert.equal(result.status === 'resolved' && result.company.hubspotCompanyId, '1');
  });

  it('varias exactas en HubSpot ⇒ ambiguo, sin empresa y sin seguir a SellUp', async () => {
    const { deps, calls } = makeDeps({
      searchHubSpotByDomain: async () => [hs('1', 'Ficticia', 'ficticia.test'), hs('2', 'Ficticia Dup', 'ficticia.test')],
    });
    const result = await resolveQuickSearchCompany(INPUT, deps);
    assert.deepEqual(result, { status: 'ambiguous', where: 'hubspot', count: 2, hubspotUnavailable: false });
    assert.equal(calls.some((c) => c.startsWith('su-')), false);
  });

  it('nada por dominio en HubSpot ⇒ HubSpot por nombre exacto', async () => {
    const { deps } = makeDeps({
      searchHubSpotByName: async () => [hs('5', 'FICTICIA SAS', null), hs('6', 'Ficticia Perú', null)],
    });
    const result = await resolveQuickSearchCompany(INPUT, deps);
    assert.equal(result.status === 'resolved' && result.matchedBy, 'hubspot_name');
    assert.equal(result.status === 'resolved' && result.company.hubspotCompanyId, '5');
  });

  it('nada en HubSpot ⇒ SellUp por dominio y luego por nombre', async () => {
    const byDomain = makeDeps({ searchSellUpByDomain: async () => [su('acc-1', 'Ficticia', 'www.ficticia.test')] });
    const r1 = await resolveQuickSearchCompany(INPUT, byDomain.deps);
    assert.equal(r1.status === 'resolved' && r1.matchedBy, 'sellup_domain');
    assert.deepEqual(byDomain.calls.slice(0, 2), ['hs-domain:ficticia.test', 'hs-name:Ficticia S.A.S.']);

    const byName = makeDeps({ searchSellUpByName: async () => [su('acc-2', 'Ficticia', null)] });
    const r2 = await resolveQuickSearchCompany(INPUT, byName.deps);
    assert.equal(r2.status === 'resolved' && r2.matchedBy, 'sellup_name');
  });

  it('dos cuentas de SellUp con el mismo dominio ⇒ ambiguo', async () => {
    const { deps } = makeDeps({
      searchSellUpByDomain: async () => [su('acc-1', 'Ficticia', 'ficticia.test'), su('acc-2', 'Ficticia 2', 'ficticia.test')],
    });
    const result = await resolveQuickSearchCompany(INPUT, deps);
    assert.equal(result.status === 'ambiguous' && result.where, 'sellup');
  });

  it('HubSpot caído no bloquea: se sigue con SellUp y se marca', async () => {
    const { deps, calls } = makeDeps({
      searchHubSpotByDomain: async () => null,
      searchSellUpByDomain: async () => [su('acc-1', 'Ficticia', 'ficticia.test')],
    });
    const result = await resolveQuickSearchCompany(INPUT, deps);
    assert.equal(result.status === 'resolved' && result.company.source, 'sellup');
    assert.equal(result.hubspotUnavailable, true);
    // Caído una vez, no se le vuelve a preguntar.
    assert.equal(calls.includes('hs-name:Ficticia S.A.S.'), false);
  });

  it('sin dominio útil ni nombre ⇒ none sin consultar nada', async () => {
    const { deps, calls } = makeDeps();
    const result = await resolveQuickSearchCompany({ email: 'ana@gmail.com' }, deps);
    assert.deepEqual(result, { status: 'none', hubspotUnavailable: false });
    assert.deepEqual(calls, []);
  });
});
