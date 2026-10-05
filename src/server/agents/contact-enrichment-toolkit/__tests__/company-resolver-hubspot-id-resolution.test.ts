/**
 * Tests — AGENT2A-HUBSPOT-ID-RESOLUTION: buscar empresa por Company ID de HubSpot.
 *
 * Caso real: la operadora pega `52817179673` (Pizza Pizza). No hay cuenta SellUp con
 * ese ID. Antes el resolver no consultaba HubSpot (sin nombre ni dominio) y el wizard
 * enriquecía una empresa «manual» llamada «52817179673», sin dominio ni país.
 *
 * Orden esperado: 1) SellUp por hubspot_company_id; 2) HubSpot por ID.
 * 0 Supabase, 0 red. Datos de HubSpot ficticios salvo el ID.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCompanyForContactEnrichment,
  mapHubSpotCompanyByIdResultToMatches,
} from '../company-resolver-core';
import type { CompanyResolverDeps, HubSpotCompanyMatch, SellUpAccountMatch } from '../types';

const HS_ID = '52817179673';

const HS_COMPANY: HubSpotCompanyMatch = {
  id: HS_ID,
  name: 'Pizza Pizza',
  domain: 'www.pizzapizza.cl',
  website: 'https://www.pizzapizza.cl',
  country: 'Chile',
  city: null,
};

const LINKED_ACCOUNT: SellUpAccountMatch = {
  id: 'acc-pizza',
  name: 'Pizza Pizza',
  domain: 'pizzapizza.cl',
  country: 'Chile',
  country_code: 'CL',
  hubspot_company_id: HS_ID,
};

function deps(overrides: Partial<CompanyResolverDeps> = {}): CompanyResolverDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchSellUpByAccountId: async () => null,
    searchSellUpByHubSpotId: async () => {
      calls.push('sellup_by_hs_id');
      return [];
    },
    searchSellUpByDomain: async () => [],
    searchSellUpByName: async () => [],
    searchHubSpot: async () => {
      calls.push('hubspot_search');
      return [];
    },
    getHubSpotCompanyById: async () => {
      calls.push('hubspot_by_id');
      return [HS_COMPANY];
    },
    ...overrides,
  };
}

describe('resolveCompanyForContactEnrichment — Company ID de HubSpot', () => {
  it('sin cuenta SellUp: lee la empresa en HubSpot por ID y devuelve nombre, dominio y país reales', async () => {
    const d = deps();
    const result = await resolveCompanyForContactEnrichment({ hubspotCompanyId: HS_ID }, d);

    assert.deepEqual(d.calls, ['sellup_by_hs_id', 'hubspot_by_id']);
    assert.equal(result.resolved, true);
    assert.equal(result.singleMatch, true);
    assert.equal(result.skippedHubSpot, false);
    const c = result.selected!;
    assert.equal(c.source, 'hubspot');
    assert.equal(c.hubspotCompanyId, HS_ID);
    assert.equal(c.name, 'Pizza Pizza');
    assert.equal(c.domain, 'www.pizzapizza.cl');
    assert.equal(c.countryCode, 'CL');
    assert.equal(c.matchConfidence, 1.0);
  });

  it('con cuenta SellUp vinculada a ese ID: la usa y NO llama a HubSpot', async () => {
    const d = deps({
      searchSellUpByHubSpotId: async () => [LINKED_ACCOUNT],
    });
    const result = await resolveCompanyForContactEnrichment({ hubspotCompanyId: HS_ID }, d);

    assert.ok(!d.calls.includes('hubspot_by_id'));
    assert.ok(!d.calls.includes('hubspot_search'));
    assert.equal(result.selected?.source, 'sellup');
    assert.equal(result.selected?.sellupAccountId, 'acc-pizza');
    assert.equal(result.skippedHubSpot, false);
  });

  it('ID inexistente en HubSpot (404): sin candidatos y sin afirmar que HubSpot está caído', async () => {
    const d = deps({ getHubSpotCompanyById: async () => [] });
    const result = await resolveCompanyForContactEnrichment({ hubspotCompanyId: '999999999' }, d);

    assert.equal(result.resolved, false);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.skippedHubSpot, false);
  });

  it('HubSpot no disponible: skippedHubSpot, sin reventar', async () => {
    const d = deps({ getHubSpotCompanyById: async () => null });
    const result = await resolveCompanyForContactEnrichment({ hubspotCompanyId: HS_ID }, d);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.skippedHubSpot, true);
  });

  it('HubSpot que lanza: skippedHubSpot, sin reventar', async () => {
    const d = deps({
      getHubSpotCompanyById: async () => {
        throw new Error('boom');
      },
    });
    const result = await resolveCompanyForContactEnrichment({ hubspotCompanyId: HS_ID }, d);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.skippedHubSpot, true);
  });

  it('búsquedas por nombre o dominio no consultan HubSpot por ID', async () => {
    const d = deps();
    await resolveCompanyForContactEnrichment({ companyName: 'Pizza Pizza' }, d);
    await resolveCompanyForContactEnrichment({ companyDomain: 'pizzapizza.cl' }, d);
    assert.ok(!d.calls.includes('hubspot_by_id'));
  });
});

describe('mapHubSpotCompanyByIdResultToMatches', () => {
  it('distingue no consultable (null), no existe ([]) y encontrada ([x])', () => {
    assert.equal(mapHubSpotCompanyByIdResultToMatches({ company: null, skipped: true }), null);
    assert.equal(mapHubSpotCompanyByIdResultToMatches({ company: null, skipped: false, error: 'x' }), null);
    assert.deepEqual(mapHubSpotCompanyByIdResultToMatches({ company: null, skipped: false }), []);
    assert.deepEqual(mapHubSpotCompanyByIdResultToMatches({ company: HS_COMPANY, skipped: false }), [HS_COMPANY]);
  });
});
