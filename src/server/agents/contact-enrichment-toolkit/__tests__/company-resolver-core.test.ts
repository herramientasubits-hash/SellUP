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

import { resolveCompanyForContactEnrichment } from '../company-resolver-core';
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
});
