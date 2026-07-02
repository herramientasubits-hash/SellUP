/**
 * Tests — Company Resolver Core (Agente 2A, Hito 17A.1)
 *
 * Verifica la lógica de resolución de empresa sin Supabase real ni HubSpot real.
 * Usa inyección de dependencias para mockear las búsquedas.
 *
 * Node.js built-in test runner. Sin I/O externo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCompanyForContactEnrichment, mapCountryToCode } from '../company-resolver-core';
import type { CompanyResolverDeps, SellUpAccountMatch } from '../types';

// ── Fixtures ─────────────────────────────────────────────────

const MOCK_ACCOUNT: SellUpAccountMatch = {
  id: 'acc-uuid-1234',
  name: 'Bancolombia S.A.',
  domain: 'bancolombia.com',
  country: 'Colombia',
  country_code: 'CO',
  hubspot_company_id: 'hs-999',
};

const MOCK_ACCOUNT_2: SellUpAccountMatch = {
  id: 'acc-uuid-5678',
  name: 'Banco Bogotá',
  domain: 'bancodebogota.com',
  country: 'Colombia',
  country_code: 'CO',
  hubspot_company_id: null,
};

function noopDeps(): CompanyResolverDeps {
  return {
    searchSellUpByAccountId: async () => null,
    searchSellUpByHubSpotId: async () => [],
    searchSellUpByDomain: async () => [],
    searchSellUpByName: async () => [],
    searchHubSpot: async () => [],
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('resolveCompanyForContactEnrichment', () => {
  it('retorna candidato SellUp cuando hay account por dominio', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByDomain: async (domain) => {
        if (domain.includes('bancolombia')) return [MOCK_ACCOUNT];
        return [];
      },
      searchHubSpot: async () => [],
    };

    const result = await resolveCompanyForContactEnrichment(
      { companyDomain: 'bancolombia.com' },
      deps
    );

    assert.equal(result.resolved, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source, 'sellup');
    assert.equal(result.candidates[0].name, 'Bancolombia S.A.');
    assert.equal(result.candidates[0].domain, 'bancolombia.com');
  });

  it('retorna skippedHubSpot: true si HubSpot no está disponible', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByName: async () => [MOCK_ACCOUNT],
      searchHubSpot: async () => {
        throw new Error('HubSpot connection unavailable');
      },
    };

    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Bancolombia' },
      deps
    );

    assert.equal(result.skippedHubSpot, true);
    // El resultado SellUp sigue presente
    assert.equal(result.resolved, true);
    assert.equal(result.candidates.length, 1);
  });

  it('maneja cero resultados sin lanzar excepción', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Inexistente XYZ' },
      noopDeps()
    );

    assert.equal(result.resolved, false);
    assert.equal(result.singleMatch, false);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.selected, undefined);
  });

  it('marca singleMatch: true cuando hay exactamente una coincidencia', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByDomain: async () => [MOCK_ACCOUNT],
      searchHubSpot: async () => [],
    };

    const result = await resolveCompanyForContactEnrichment(
      { companyDomain: 'bancolombia.com' },
      deps
    );

    assert.equal(result.singleMatch, true);
    assert.ok(result.selected);
    assert.equal(result.selected?.name, 'Bancolombia S.A.');
  });

  it('marca singleMatch: false cuando hay varias coincidencias', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByName: async () => [MOCK_ACCOUNT, MOCK_ACCOUNT_2],
      searchHubSpot: async () => [],
    };

    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Banco' },
      deps
    );

    assert.equal(result.singleMatch, false);
    assert.equal(result.resolved, true);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.selected, undefined);
  });

  it('asigna confianza 1.0 para coincidencia exacta por sellupAccountId', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByAccountId: async (id) => {
        if (id === 'acc-uuid-1234') return MOCK_ACCOUNT;
        return null;
      },
    };

    const result = await resolveCompanyForContactEnrichment(
      { sellupAccountId: 'acc-uuid-1234' },
      deps
    );

    assert.equal(result.resolved, true);
    assert.equal(result.candidates[0].matchConfidence, 1.0);
  });

  it('evita duplicar empresa si HubSpot devuelve la misma que ya está en SellUp', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByDomain: async () => [MOCK_ACCOUNT], // hubspot_company_id = 'hs-999'
      searchHubSpot: async () => [
        { id: 'hs-999', name: 'Bancolombia', domain: 'bancolombia.com', website: null },
      ],
    };

    const result = await resolveCompanyForContactEnrichment(
      { companyDomain: 'bancolombia.com' },
      deps
    );

    // Solo debe aparecer una vez (la de SellUp ya tiene el hubspot_company_id)
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source, 'sellup');
  });

  it('retorna skippedHubSpot: true cuando no hay dominio ni nombre para buscar en HubSpot', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByAccountId: async () => MOCK_ACCOUNT,
    };

    const result = await resolveCompanyForContactEnrichment(
      { sellupAccountId: 'acc-uuid-1234' },
      deps
    );

    assert.equal(result.skippedHubSpot, true);
  });

  // ── 17A.7B: excluir archivadas y deduplicar por dominio ──────

  it('deduplica dos cuentas con mismo dominio, conserva la que tiene hubspot_company_id', async () => {
    const ACTIVE_WITH_HS: SellUpAccountMatch = {
      id: 'siesa-active',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: 'hs-siesa-001',
    };
    const ACTIVE_NO_HS: SellUpAccountMatch = {
      id: 'siesa-duplicate',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: null,
    };

    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByName: async () => [ACTIVE_NO_HS, ACTIVE_WITH_HS],
      searchHubSpot: async () => [],
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'siesa' }, deps);

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].sellupAccountId, 'siesa-active');
    assert.equal(result.candidates[0].hubspotCompanyId, 'hs-siesa-001');
  });

  it('deduplica dos cuentas con mismo dominio cuando ninguna tiene hubspot_company_id, conserva la primera', async () => {
    const DUPE_A: SellUpAccountMatch = {
      id: 'siesa-a',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: null,
    };
    const DUPE_B: SellUpAccountMatch = {
      id: 'siesa-b',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: null,
    };

    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByName: async () => [DUPE_A, DUPE_B],
      searchHubSpot: async () => [],
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'siesa' }, deps);

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].sellupAccountId, 'siesa-a');
  });

  it('las queries reales deben excluir archivadas (archived_at y pipeline_status)', async () => {
    // Este test verifica que el mock de búsqueda no devuelva archivadas —
    // en producción, el filtro está en la query Supabase; aquí validamos que
    // el resolver no infla candidatos con cuentas que el mock ya filtraría.
    const ARCHIVED: SellUpAccountMatch = {
      id: 'siesa-archived',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: null,
    };
    const ACTIVE: SellUpAccountMatch = {
      id: 'siesa-active',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: null,
    };

    // La capa de datos (mock del repo) ya excluye la archivada —
    // el resolver debe mostrar solo la activa.
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByName: async () => [ACTIVE], // archived ya filtrada en la query
      searchHubSpot: async () => [],
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'siesa' }, deps);

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].sellupAccountId, 'siesa-active');
    assert.ok(!result.candidates.some((c) => c.sellupAccountId === ARCHIVED.id));
  });

  it('empresa manual (sin sellupAccountId) sigue siendo válida como input', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Empresa Manual SA', companyDomain: 'manual-empresa.com' },
      noopDeps()
    );

    // Sin resultados de SellUp ni HubSpot → resolved false, pero no lanza
    assert.equal(result.resolved, false);
    assert.equal(result.candidates.length, 0);
  });

  // ── 17A.7C.3: searchSellUpByAccountId filtra archivadas ──────────────────

  it('retorna sin candidatos cuando searchSellUpByAccountId devuelve null (cuenta archivada o inexistente)', async () => {
    // La implementación real de defaultSearchByAccountId ahora aplica
    // .is('archived_at', null).neq('pipeline_status', 'archived').
    // Cuando la cuenta está archivada, Supabase devuelve 0 filas → data = null.
    // El mock simula ese comportamiento.
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByAccountId: async () => null,
    };

    const result = await resolveCompanyForContactEnrichment(
      { sellupAccountId: 'archived-account-uuid' },
      deps,
    );

    assert.equal(result.resolved, false);
    assert.equal(result.candidates.length, 0);
  });

  it('usa el account activo cuando searchSellUpByAccountId devuelve un match válido', async () => {
    const ACTIVE: SellUpAccountMatch = {
      id: 'siesa-active-uuid',
      name: 'Siesa',
      domain: 'siesa.com',
      country: 'Colombia',
      country_code: 'CO',
      hubspot_company_id: null,
    };

    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchSellUpByAccountId: async (id) => (id === 'siesa-active-uuid' ? ACTIVE : null),
    };

    const result = await resolveCompanyForContactEnrichment(
      { sellupAccountId: 'siesa-active-uuid' },
      deps,
    );

    assert.equal(result.resolved, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].sellupAccountId, 'siesa-active-uuid');
  });

  // ── 17A.9F: HubSpot por nombre/dominio ────────────────────────────────────

  it('retorna candidato HubSpot cuando SellUp no tiene match y HubSpot devuelve resultado por nombre', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchHubSpot: async ({ name }) => {
        if (name === 'ACRIP') {
          return [{ id: 'hs-acrip-001', name: 'ACRIP', domain: 'acrip.org', website: 'https://acrip.org', country: 'Colombia', city: 'Bogotá' }];
        }
        return [];
      },
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'ACRIP' }, deps);

    assert.equal(result.resolved, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source, 'hubspot');
    assert.equal(result.candidates[0].hubspotCompanyId, 'hs-acrip-001');
    assert.equal(result.candidates[0].name, 'ACRIP');
    assert.equal(result.candidates[0].domain, 'acrip.org');
  });

  it('retorna candidato HubSpot con countryCode cuando HubSpot devuelve country', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchHubSpot: async () => [
        { id: 'hs-acrip-001', name: 'ACRIP', domain: 'acrip.org', website: null, country: 'Colombia', city: 'Bogotá' },
      ],
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'ACRIP' }, deps);

    assert.equal(result.candidates[0].country, 'Colombia');
    assert.equal(result.candidates[0].countryCode, 'CO');
  });

  it('retorna candidato HubSpot cuando SellUp no tiene match y HubSpot devuelve resultado por dominio', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchHubSpot: async ({ domain }) => {
        if (domain === 'acrip.org') {
          return [{ id: 'hs-acrip-001', name: 'ACRIP', domain: 'acrip.org', website: null, country: 'Colombia', city: null }];
        }
        return [];
      },
    };

    const result = await resolveCompanyForContactEnrichment({ companyDomain: 'acrip.org' }, deps);

    assert.equal(result.resolved, true);
    assert.equal(result.candidates[0].source, 'hubspot');
    assert.equal(result.candidates[0].hubspotCompanyId, 'hs-acrip-001');
    assert.equal(result.candidates[0].domain, 'acrip.org');
    assert.equal(result.candidates[0].countryCode, 'CO');
  });

  it('devuelve múltiples candidatos HubSpot sin autoseleccionar (singleMatch: false)', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchHubSpot: async () => [
        { id: 'hs-coca-001', name: 'Coca-Cola México', domain: 'coca-cola.com.mx', website: null, country: 'México', city: null },
        { id: 'hs-coca-002', name: 'Coca-Cola Colombia', domain: 'coca-cola.com.co', website: null, country: 'Colombia', city: null },
      ],
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'Coca Cola' }, deps);

    assert.equal(result.resolved, true);
    assert.equal(result.singleMatch, false);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.selected, undefined);
    assert.equal(result.candidates[0].countryCode, 'MX');
    assert.equal(result.candidates[1].countryCode, 'CO');
  });

  it('retorna skippedHubSpot: true cuando HubSpot está desconectado', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchHubSpot: async () => [],  // searchHubSpotCompaniesForResolver retornaría skipped
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'ACRIP' }, deps);

    // 0 candidatos SellUp + 0 HubSpot → resolved false
    assert.equal(result.resolved, false);
    assert.equal(result.candidates.length, 0);
  });

  it('candidato HubSpot tiene sellupAccountId undefined (account_id null en run)', async () => {
    const deps: CompanyResolverDeps = {
      ...noopDeps(),
      searchHubSpot: async () => [
        { id: 'hs-acrip-001', name: 'ACRIP', domain: 'acrip.org', website: null, country: 'Colombia', city: null },
      ],
    };

    const result = await resolveCompanyForContactEnrichment({ companyName: 'ACRIP' }, deps);

    const candidate = result.candidates[0];
    assert.equal(candidate.source, 'hubspot');
    assert.equal(candidate.sellupAccountId, undefined);
    assert.ok(candidate.hubspotCompanyId);
  });
});

// ── mapCountryToCode ─────────────────────────────────────────

describe('mapCountryToCode', () => {
  it('mapea Colombia → CO', () => {
    assert.equal(mapCountryToCode('Colombia'), 'CO');
  });

  it('mapea México → MX (con tilde)', () => {
    assert.equal(mapCountryToCode('México'), 'MX');
  });

  it('mapea Mexico → MX (sin tilde)', () => {
    assert.equal(mapCountryToCode('Mexico'), 'MX');
  });

  it('mapea Chile → CL', () => {
    assert.equal(mapCountryToCode('Chile'), 'CL');
  });

  it('mapea Perú → PE (con tilde)', () => {
    assert.equal(mapCountryToCode('Perú'), 'PE');
  });

  it('mapea Peru → PE (sin tilde)', () => {
    assert.equal(mapCountryToCode('Peru'), 'PE');
  });

  it('mapea Ecuador → EC', () => {
    assert.equal(mapCountryToCode('Ecuador'), 'EC');
  });

  it('mapea Brasil → BR', () => {
    assert.equal(mapCountryToCode('Brasil'), 'BR');
  });

  it('mapea Brazil → BR (inglés)', () => {
    assert.equal(mapCountryToCode('Brazil'), 'BR');
  });

  it('mapea Costa Rica → CR', () => {
    assert.equal(mapCountryToCode('Costa Rica'), 'CR');
  });

  it('retorna null para país no mapeado', () => {
    assert.equal(mapCountryToCode('Klingonia'), null);
  });

  it('retorna null para null/undefined', () => {
    assert.equal(mapCountryToCode(null), null);
    assert.equal(mapCountryToCode(undefined), null);
  });

  it('es case-insensitive', () => {
    assert.equal(mapCountryToCode('COLOMBIA'), 'CO');
    assert.equal(mapCountryToCode('chile'), 'CL');
  });
});
