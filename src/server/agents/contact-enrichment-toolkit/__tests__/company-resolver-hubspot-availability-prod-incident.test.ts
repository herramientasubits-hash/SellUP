/**
 * Tests — resolución de empresa: HubSpot no disponible ≠ HubSpot sin coincidencias
 * (AGENT2A-PROD-INCIDENT · incidente B, contact search).
 *
 * El resolver YA tenía escrita la rama que enciende `skippedHubSpot` y la UI YA
 * tenía el aviso «HubSpot no disponible — resultados solo desde SellUp.». Pero el
 * adaptador por defecto devolvía `[]` tanto cuando HubSpot no se podía consultar
 * como cuando contestaba sin coincidencias, así que esa rama era INALCANZABLE: una
 * caída de HubSpot se le presentaba a la operadora como que la empresa no está en
 * HubSpot. Al ponerle techo de espera a la petición, ese silencio habría convertido
 * cada timeout en una respuesta falsa «no está en HubSpot».
 *
 * Casos cubiertos (§ 14 del brief):
 *   A. resultado de SellUp
 *   B. resultado de HubSpot
 *   C. resultado de ambos
 *   D. resultado vacío — HubSpot contestó y no hay nada
 *   E. HubSpot no disponible ⇒ skippedHubSpot, y NO se afirma que no exista
 *   F. techo de espera vencido ⇒ mismo trato que no disponible
 *   G. HubSpot que lanza ⇒ la resolución no revienta
 *   H. el mapeo distingue `null` (no consultable) de `[]` (sin coincidencias)
 *
 * Antes del fix, E/F/H fallan.
 *
 * Todo por inyección de dependencias: 0 Supabase, 0 red, 0 HubSpot real,
 * 0 créditos. Datos 100 % ficticios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCompanyForContactEnrichment,
  mapHubSpotSearchResultToMatches,
} from '../company-resolver-core';
import type { CompanyResolverDeps, SellUpAccountMatch, HubSpotCompanyMatch } from '../types';

const HUBSPOT_UNAVAILABLE = null;

function fakeSellUpAccount(
  overrides: Partial<SellUpAccountMatch> = {},
): SellUpAccountMatch {
  return {
    id: 'account-ficticia-1',
    name: 'Empresa Ficticia SAS',
    domain: 'empresa-ficticia.test',
    country: 'Colombia',
    country_code: 'CO',
    hubspot_company_id: null,
    ...overrides,
  } as SellUpAccountMatch;
}

function fakeHubSpotCompany(
  overrides: Partial<HubSpotCompanyMatch> = {},
): HubSpotCompanyMatch {
  return {
    id: 'hs-ficticia-1',
    name: 'Empresa Ficticia (HubSpot)',
    domain: 'empresa-ficticia.test',
    website: null,
    country: 'Colombia',
    city: null,
    ...overrides,
  } as HubSpotCompanyMatch;
}

/** Dependencias que nunca encuentran nada, para sobrescribir solo lo relevante. */
function emptyDeps(overrides: CompanyResolverDeps = {}): CompanyResolverDeps {
  return {
    searchSellUpByAccountId: async () => null,
    searchSellUpByHubSpotId: async () => [],
    searchSellUpByDomain: async () => [],
    searchSellUpByName: async () => [],
    searchHubSpot: async () => [],
    ...overrides,
  };
}

describe('AGENT2A-PROD-INCIDENT — disponibilidad de HubSpot en la resolución', () => {
  it('A. resultado de SellUp', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Ficticia' },
      emptyDeps({ searchSellUpByName: async () => [fakeSellUpAccount()] }),
    );

    assert.ok(result.candidates.length >= 1);
    assert.ok(result.candidates.some((c) => c.source === 'sellup'));
  });

  it('B. resultado de HubSpot', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Ficticia' },
      emptyDeps({ searchHubSpot: async () => [fakeHubSpotCompany()] }),
    );

    assert.ok(result.candidates.some((c) => c.source === 'hubspot'));
    assert.equal(result.skippedHubSpot, false, 'HubSpot SÍ se consultó');
  });

  it('C. resultado de ambos', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Ficticia' },
      emptyDeps({
        searchSellUpByName: async () => [fakeSellUpAccount()],
        searchHubSpot: async () => [fakeHubSpotCompany({ id: 'hs-otra' })],
      }),
    );

    assert.ok(result.candidates.some((c) => c.source === 'sellup'));
    assert.ok(result.candidates.some((c) => c.source === 'hubspot'));
    assert.equal(result.skippedHubSpot, false);
  });

  it('D. resultado vacío: HubSpot contestó y no hay coincidencias', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Que No Existe' },
      emptyDeps({ searchHubSpot: async () => [] }),
    );

    assert.equal(result.candidates.length, 0);
    assert.equal(
      result.skippedHubSpot,
      false,
      'una respuesta real sin coincidencias NO es «HubSpot no disponible»',
    );
  });

  it('E. HubSpot no disponible ⇒ skippedHubSpot (no se afirma que no exista)', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Ficticia' },
      emptyDeps({
        searchSellUpByName: async () => [fakeSellUpAccount()],
        searchHubSpot: async () => HUBSPOT_UNAVAILABLE,
      }),
    );

    assert.equal(
      result.skippedHubSpot,
      true,
      'sin esto la UI dice «no está en HubSpot» cuando HubSpot no contestó',
    );
    // La resolución sigue sirviendo lo de SellUp: la búsqueda TERMINA.
    assert.ok(result.candidates.some((c) => c.source === 'sellup'));
    assert.ok(
      !result.candidates.some((c) => c.source === 'hubspot'),
      'no se inventan candidatos de un HubSpot que no contestó',
    );
  });

  it('F. techo de espera vencido ⇒ mismo trato que no disponible', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Ficticia' },
      emptyDeps({
        // Es lo que produce el adaptador cuando `AbortSignal.timeout` vence.
        searchHubSpot: async () => HUBSPOT_UNAVAILABLE,
      }),
    );

    assert.equal(result.skippedHubSpot, true);
    assert.equal(result.candidates.length, 0);
  });

  it('G. un HubSpot que lanza no revienta la resolución', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Ficticia' },
      emptyDeps({
        searchSellUpByName: async () => [fakeSellUpAccount()],
        searchHubSpot: async () => {
          throw new Error('HubSpot caído');
        },
      }),
    );

    assert.equal(result.skippedHubSpot, true);
    assert.ok(result.candidates.some((c) => c.source === 'sellup'));
  });

  it('H. el mapeo distingue `null` (no consultable) de `[]` (sin coincidencias)', () => {
    assert.equal(
      mapHubSpotSearchResultToMatches({ companies: [], skipped: true }),
      null,
      'skipped ⇒ null',
    );
    assert.equal(
      mapHubSpotSearchResultToMatches({ companies: [], skipped: false, error: 'timeout' }),
      null,
      'error/timeout ⇒ null',
    );
    assert.deepEqual(
      mapHubSpotSearchResultToMatches({ companies: [], skipped: false }),
      [],
      'respuesta real sin coincidencias ⇒ [] (NO null)',
    );
    const companies = [fakeHubSpotCompany()];
    assert.deepEqual(
      mapHubSpotSearchResultToMatches({ companies, skipped: false }),
      companies,
      'respuesta con coincidencias ⇒ las coincidencias',
    );
  });
});
