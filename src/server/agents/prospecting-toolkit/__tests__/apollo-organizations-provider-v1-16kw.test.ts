/**
 * Tests — Apollo Organizations Provider v1.16K-W
 *
 * Verifica:
 *   A. Mapping puro ApolloOrganization → WebSearchResult
 *   B. Provider dry-run (flag apagado y flag encendido con fixture)
 *   C. dispatchWebSearch enruta apollo_organizations al provider correcto
 *   D. Compatibilidad de tipos con el pipeline (source URL gate, candidate writer)
 *
 * Sin Apollo real. Sin Tavily real. Sin Supabase. Sin créditos. Node.js test runner.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapApolloOrganizationToSearchResult,
  runApolloOrganizationsSearch,
  type ApolloOrganizationInput,
  type ApolloOrganizationSearchResultMetadata,
} from '../web-search-providers/apollo-organizations-search-provider';
import { runWebSearch } from '../web-search-tool';
import {
  isApolloSyntheticProfileUrl,
  readApolloCandidateDomain,
  readApolloCandidateWebsite,
  readApolloProviderOrganizationId,
} from '../apollo-candidate-identity-readers';

// ─── A. Mapping puro ──────────────────────────────────────────────────────────

describe('mapApolloOrganizationToSearchResult', () => {
  it('mapea org completa con name + website + domain', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-abc-123',
      name: 'Acme Corp S.A.S',
      website_url: 'https://acme.example.com',
      primary_domain: 'acme.example.com',
      linkedin_url: 'https://www.linkedin.com/company/acme',
      industry: 'Technology',
      estimated_num_employees: 500,
      country: 'Colombia',
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);

    assert.equal(result.title, 'Acme Corp S.A.S');
    assert.equal(result.url, 'https://acme.example.com');
    assert.equal(result.provider, 'apollo_organizations');
    assert.equal(result.rank, 1);
    assert.ok(result.snippet?.includes('Technology'));
    assert.ok(result.snippet?.includes('[Fuente: Apollo Organizations]'));

    const meta = result.metadata as ApolloOrganizationSearchResultMetadata;
    assert.equal(meta.apollo_organization_id, 'org-abc-123');
    assert.equal(meta.domain, 'acme.example.com');
    assert.equal(meta.website, 'https://acme.example.com');
    assert.equal(meta.industry, 'Technology');
    assert.equal(meta.employee_count, 500);
    assert.equal(meta.country, 'Colombia');
    assert.equal(meta.linkedin_url, 'https://www.linkedin.com/company/acme');
    assert.equal(meta.source_provider, 'apollo');
    assert.equal(meta.source_key, 'apollo_organizations');
    assert.equal(meta.source_type, 'structured_company_database');
  });

  it('mapea org sin website_url usando primary_domain como fallback', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-no-website',
      name: 'Solo Domain Corp',
      website_url: null,
      primary_domain: 'solodomain.example.com',
      industry: 'Finance',
      estimated_num_employees: 100,
      country: 'México',
    };

    const result = mapApolloOrganizationToSearchResult(org, 2);

    assert.equal(result.title, 'Solo Domain Corp');
    assert.ok(result.url.includes('solodomain.example.com'));
    assert.equal(result.provider, 'apollo_organizations');

    const meta = result.metadata as ApolloOrganizationSearchResultMetadata;
    assert.equal(meta.domain, 'solodomain.example.com');
    assert.ok(meta.website?.includes('solodomain.example.com'));
  });

  it('lanza si name es null', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-no-name',
      name: null,
      website_url: 'https://noname.example.com',
    };

    assert.throws(
      () => mapApolloOrganizationToSearchResult(org, 1),
      /has no name/,
    );
  });

  it('lanza si name es string vacío', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-empty-name',
      name: '   ',
      website_url: 'https://empty.example.com',
    };

    assert.throws(
      () => mapApolloOrganizationToSearchResult(org, 1),
      /has no name/,
    );
  });

  it('employee_count e industry quedan en metadata', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-meta-check',
      name: 'Meta Check Corp',
      website_url: 'https://meta.example.com',
      industry: 'Healthcare',
      estimated_num_employees: 1200,
    };

    const result = mapApolloOrganizationToSearchResult(org, 3);
    const meta = result.metadata as ApolloOrganizationSearchResultMetadata;

    assert.equal(meta.industry, 'Healthcare');
    assert.equal(meta.employee_count, 1200);
  });

  it('linkedin_url queda en metadata cuando existe', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-with-li',
      name: 'LinkedIn Corp',
      website_url: 'https://li-corp.example.com',
      linkedin_url: 'https://www.linkedin.com/company/li-corp',
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);
    const meta = result.metadata as ApolloOrganizationSearchResultMetadata;

    assert.equal(meta.linkedin_url, 'https://www.linkedin.com/company/li-corp');
  });

  it('linkedin_url es null en metadata cuando no existe', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-no-li',
      name: 'No LinkedIn Corp',
      website_url: 'https://noli.example.com',
      linkedin_url: null,
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);
    const meta = result.metadata as ApolloOrganizationSearchResultMetadata;

    assert.equal(meta.linkedin_url, null);
  });
});

// ─── B. Provider dry-run ──────────────────────────────────────────────────────

describe('runApolloOrganizationsSearch — flag apagado (default)', () => {
  before(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });

  it('devuelve skipped=true con skipReason apollo_company_search_disabled', async () => {
    const output = await runApolloOrganizationsSearch(
      { query: 'empresas tecnología Colombia' },
      10,
    );

    assert.equal(output.skipped, true);
    assert.equal(output.skipReason, 'apollo_company_search_disabled');
    assert.equal(output.provider, 'apollo_organizations');
    assert.equal(output.results.length, 0);
    assert.equal(output.estimatedCostUsd, 0);
  });

  it('no genera resultados reales con flag apagado', async () => {
    const output = await runApolloOrganizationsSearch(
      { query: 'fintech Bogotá' },
      5,
    );

    assert.equal(output.results.length, 0);
  });

  it('metadata indica dry_run cuando flag está apagado', async () => {
    const output = await runApolloOrganizationsSearch(
      { query: 'manufactura Medellín' },
      3,
    );

    assert.equal((output.metadata as Record<string, unknown>)?.dry_run, true);
    const usage = (output.metadata as Record<string, unknown>)?.usage as Record<string, unknown>;
    assert.equal(usage?.credits_used, 0);
    assert.equal(usage?.estimated_cost_usd, 0);
    assert.equal(usage?.status, 'dry_run');
  });
});

// v1.16K-X: el fixture fue reemplazado por llamadas reales con mock inyectable.
// Con flag=true y sin API key configurada (entorno de test), Apollo responde 401
// y el provider retorna skipped=true de forma controlada.
describe('runApolloOrganizationsSearch — flag encendido sin API key (v1.16K-X)', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  });

  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });

  it('flag encendido sin API key → skipped controlado (no throw)', async () => {
    // Sin mock inyectado: intenta Apollo real, getApolloApiKey devuelve null → 401 controlado.
    let threw = false;
    let output;
    try {
      output = await runApolloOrganizationsSearch({ query: 'software Colombia' }, 10);
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'No debe lanzar aunque no haya API key');
    assert.equal(output?.provider, 'apollo_organizations');
    assert.ok(output?.skipped, 'Debe retornar skipped cuando no hay API key');
  });

  it('resultado tiene provider=apollo_organizations cuando flag activo', async () => {
    const output = await runApolloOrganizationsSearch({ query: 'tech Bogotá' }, 5);
    assert.equal(output.provider, 'apollo_organizations');
  });

  it('flag encendido sin API key → estimatedCostUsd=0, credits=0', async () => {
    const output = await runApolloOrganizationsSearch({ query: 'empresa demo' }, 2);
    assert.equal(output.estimatedCostUsd, 0);
    const usage = (output.metadata as Record<string, unknown>)?.usage as Record<string, unknown>;
    assert.equal(usage?.credits_used, 0);
  });

  it('flag encendido sin API key → dry_run=false (es modo real con error controlado)', async () => {
    const output = await runApolloOrganizationsSearch({ query: 'test real mode' }, 1);
    // v1.16K-X: dry_run=false cuando el flag está activo; el error es controlado
    assert.equal((output.metadata as Record<string, unknown>)?.dry_run, false);
  });
});

// ─── C. Dispatch routing ──────────────────────────────────────────────────────

describe('runWebSearch — routing apollo_organizations', () => {
  before(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });

  it('enruta apollo_organizations al provider correcto (retorna WebSearchOutput válido)', async () => {
    const output = await runWebSearch({
      query: 'empresas fintech Colombia',
      provider: 'apollo_organizations',
    });

    assert.equal(output.provider, 'apollo_organizations');
    assert.ok(typeof output.skipped === 'boolean');
    assert.ok(Array.isArray(output.results));
  });

  it('apollo_organizations con flag apagado devuelve skipped=true', async () => {
    const output = await runWebSearch({
      query: 'test apollo disabled',
      provider: 'apollo_organizations',
    });

    assert.equal(output.skipped, true);
    assert.equal(output.skipReason, 'apollo_company_search_disabled');
  });

  it('tavily sigue siendo un provider key válido (no afectado por apollo)', () => {
    // Verificación estática: 'tavily' sigue siendo un valor válido en WebSearchProviderKey.
    // No llamamos al provider real (requiere Supabase/API key).
    // La coexistencia se verifica a nivel de tipos y routing en el switch de dispatchToProvider.
    const tavilyKey: Parameters<typeof runWebSearch>[0]['provider'] = 'tavily';
    assert.equal(tavilyKey, 'tavily');
  });

  it('mock sigue funcionando independientemente de apollo', async () => {
    const mockOutput = await runWebSearch({
      query: 'test mock empresas',
      provider: 'mock',
    });

    assert.equal(mockOutput.provider, 'mock');
    assert.equal(mockOutput.skipped, false);
    assert.ok(mockOutput.results.length > 0);
  });

  it('provider desconocido sigue manejándose con skipReason provider_not_implemented_*', async () => {
    const output = await runWebSearch({
      query: 'test unknown provider',
      provider: 'brave' as 'brave',
    });

    assert.equal(output.skipped, true);
    assert.ok(output.skipReason?.includes('provider_not_implemented'));
  });
});

// ─── D. Compatibilidad con pipeline ──────────────────────────────────────────

describe('compatibilidad con pipeline', () => {
  it('resultado Apollo tiene url string válida (no null) para source-url-quality-gate', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-pipeline',
      name: 'Pipeline Test Corp',
      website_url: 'https://pipeline.example.com',
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);

    // source-url-quality-gate espera url string
    assert.equal(typeof result.url, 'string');
    assert.ok(result.url.length > 0);
  });

  // AGENT1-APOLLO-NULL-DOMAIN-IDENTITY-1 § 9 — este test EXIGÍA que la URL
  // sintética existiera y ahí se quedaba, así que fijaba el valor defectuoso: un
  // trinquete que defendía el defecto y habría bloqueado su corrección.
  //
  // La URL de perfil SIGUE existiendo —`WebSearchResult.url` es `string` y
  // `runMultiQuerySearch` descarta lo que no parsea— pero ahora el test declara
  // lo que de verdad importa: esa URL es TRAZABILIDAD, y ni el dominio ni el
  // website del candidato se derivan de ella.
  it('resultado Apollo sin website ni domain: url de perfil trazable, pero identidad SIN dominio', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-no-url-123',
      name: 'No URL Corp',
      website_url: null,
      primary_domain: null,
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);

    // La url sigue siendo una URL válida y navegable (contrato del pipeline).
    assert.equal(typeof result.url, 'string');
    assert.ok(result.url.length > 0);
    assert.doesNotThrow(() => new URL(result.url));
    assert.ok(isApolloSyntheticProfileUrl(result.url), 'es la URL de perfil, no un sitio de empresa');

    // Y la identidad NO la toca: sin dominio declarado, el dominio es null.
    assert.equal(readApolloCandidateDomain(result), null);
    assert.equal(readApolloCandidateWebsite(result), null);
    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['domain'], null);
    assert.equal(meta['website'], null);

    // Lo que SÍ identifica a esta organización es el id que Apollo emitió.
    assert.equal(readApolloProviderOrganizationId(result), 'org-no-url-123');
  });

  it('resultado Apollo CON website real: dominio y website se conservan igual que antes', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-with-site',
      name: 'Con Sitio SAS',
      website_url: 'https://www.consitio.com.co',
      primary_domain: null,
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);

    assert.equal(result.url, 'https://www.consitio.com.co');
    assert.equal(isApolloSyntheticProfileUrl(result.url), false);
    assert.equal(readApolloCandidateDomain(result), 'consitio.com.co');
    assert.equal(readApolloCandidateWebsite(result), 'https://www.consitio.com.co');
  });

  it('Apollo devolviendo apollo.io como website REAL lo conserva como dominio', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-apollo-itself',
      name: 'Apollo',
      website_url: 'https://apollo.io',
      primary_domain: 'apollo.io',
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);

    // La corrección NO es una lista negra de la cadena: cuando Apollo DECLARA
    // el dominio, se respeta.
    assert.equal(readApolloCandidateDomain(result), 'apollo.io');
    assert.equal(readApolloCandidateWebsite(result), 'https://apollo.io');
    assert.equal(
      isApolloSyntheticProfileUrl(result.url),
      false,
      'un website real no es la URL de perfil, aunque el host coincida',
    );
  });

  it('resultado Apollo tiene title, snippet y provider — campos mínimos del pipeline', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-min-fields',
      name: 'Minimal Corp',
      website_url: 'https://minimal.example.com',
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);

    assert.ok(result.title);
    assert.ok(result.snippet);
    assert.ok(result.provider);
    assert.ok(typeof result.rank === 'number');
  });

  it('WebSearchOutput de apollo_organizations es compatible con el contrato MultiQuerySearchResultEntry', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';

    const output = await runApolloOrganizationsSearch(
      { query: 'test pipeline compat' },
      2,
    );

    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;

    // MultiQuerySearchResultEntry extiende WebSearchResult con originQuery
    // — validamos que cada result satisface WebSearchResult
    for (const r of output.results) {
      assert.ok(r.title);
      assert.ok(r.url);
      assert.ok(r.provider);
      assert.ok(typeof r.rank === 'number');
    }
  });
});
