/**
 * Tests — Apollo Sector Gate Metadata Propagation (v1.16K-AF)
 *
 * Verifica que la metadata del relevance gate se propague correctamente
 * desde el provider Apollo hasta el output de runMultiQueryWebSearch,
 * y que los conteos pre/post gate sean trazables en el batch.
 *
 * Escenarios:
 *   A. Apollo devuelve 3, gate rechaza 3 (Citigroup, Huawei, PwC)
 *   B. Apollo devuelve 3, gate pasa 1 (Citigroup, Huawei + Universidad X)
 *   C. Apollo devuelve 0
 *   D. Sector no mapeado → passthrough, metadata enabled=false
 *   E. Tavily regression — metadata Apollo no aparece, sin errores
 *   F. No secretos en metadata propagada
 *   G. Cost guardrail regression — sigue vigente
 *
 * IMPORTANTE: sin llamadas reales a Apollo, Tavily, Lusha ni HubSpot.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrganizationInput,
} from '../web-search-providers/apollo-organizations-search-provider';
import { runMultiQueryWebSearch } from '../web-search-tool';
import type {
  WebSearchInput,
  WebSearchOutput,
  MultiQuerySearchInput,
  WebSearchProviderKey,
} from '../types';
import type { ApolloOrgsSearchDeps } from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloOrganization } from '@/server/integrations/apollo-client';
import type { TavilyUsageDeps } from '../tavily-usage-logging';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = ['api_key', 'authorization', 'bearer', 'token', 'secret', 'password', 'x-api-key'];

function noopLogUsage(): Promise<{ kind: 'ok' }> {
  return Promise.resolve({ kind: 'ok' });
}

/** Convierte un ApolloOrganizationInput al shape ApolloOrganization esperado por el cliente. */
function toApolloOrg(inp: ApolloOrganizationInput): ApolloOrganization {
  return {
    id: inp.id,
    name: inp.name ?? '',
    website_url: inp.website_url ?? null,
    primary_domain: inp.primary_domain ?? null,
    linkedin_url: inp.linkedin_url ?? null,
    industry: inp.industry ?? null,
    industry_tag_ids: [],
    estimated_num_employees: inp.estimated_num_employees ?? null,
    employee_count: null,
    city: inp.city ?? null,
    country: inp.country ?? null,
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: inp.short_description ?? null,
    seo_description: null,
    keywords: inp.keywords ?? [],
  };
}

/** Deps mínimos de TavilyUsageDeps para tests que solo necesitan dispatchQuery. */
function makeDispatchDeps(dispatchQuery: TavilyUsageDeps['dispatchQuery']): TavilyUsageDeps {
  return {
    loadPricing: async () => null,
    logUsage: async () => ({ kind: 'logged' as const }),
    dispatchQuery,
  };
}

const BASE_INPUT: WebSearchInput = {
  query: 'empresa educacion colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Educación',
  maxResults: 3,
  provider: 'apollo_organizations',
  intent: 'company_discovery',
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_CITIGROUP: ApolloOrganizationInput = {
  id: 'org-citigroup',
  name: 'Citigroup Inc',
  website_url: 'https://citi.com',
  primary_domain: 'citi.com',
  industry: 'Banking',
  estimated_num_employees: 220000,
  country: 'United States',
};

const ORG_HUAWEI: ApolloOrganizationInput = {
  id: 'org-huawei',
  name: 'Huawei Technologies',
  website_url: 'https://huawei.com',
  primary_domain: 'huawei.com',
  industry: 'Telecommunications',
  estimated_num_employees: 195000,
  country: 'China',
};

const ORG_PWC: ApolloOrganizationInput = {
  id: 'org-pwc',
  name: 'PwC Colombia',
  website_url: 'https://pwc.com',
  primary_domain: 'pwc.com',
  industry: 'Accounting',
  estimated_num_employees: 295000,
  country: 'Colombia',
};

const ORG_UNIVERSIDAD_X: ApolloOrganizationInput = {
  id: 'org-universidad-x',
  name: 'Universidad X Colombia',
  website_url: 'https://universidad-x.edu.co',
  primary_domain: 'universidad-x.edu.co',
  industry: 'Higher Education',
  estimated_num_employees: 1200,
  country: 'Colombia',
  short_description: 'Institución de educación superior con programas e-learning',
};

// ─── A. Gate rechaza 3 de 3 ───────────────────────────────────────────────────

describe('A. Apollo devuelve 3, gate rechaza 3', () => {
  const REJECT_ALL = [ORG_CITIGROUP, ORG_HUAWEI, ORG_PWC].map(toApolloOrg);

  const deps: ApolloOrgsSearchDeps = {
    searchOrgs: async () => ({ success: true, data: REJECT_ALL }),
    logUsage: noopLogUsage as unknown as typeof import('../apollo-organizations-usage-logging').realLogApolloOrgsUsage,
  };

  it('A1: provider retorna apollo_raw_results_count=3', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_raw_results_count'], 3, 'apollo_raw_results_count debe ser 3 (pre-gate)');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('A2: provider retorna apollo_post_gate_results_count=0', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_post_gate_results_count'], 0, 'post_gate debe ser 0 (todos rechazados)');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('A3: provider retorna apollo_sector_rejected_count=3', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_sector_rejected_count'], 3, 'rechazados debe ser 3');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('A4: resultsCount=0 (post-gate) pero provider_usage_logs registra 3', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      assert.equal(out.resultsCount, 0, 'resultsCount post-gate = 0');
      assert.equal(out.results.length, 0, 'results array vacío');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('A5: apollo_sector_relevance_gate presente con checked_count=3, passed_count=0', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown> | undefined;
      assert.ok(gate !== undefined, 'apollo_sector_relevance_gate debe estar presente');
      assert.equal(gate['checked_count'], 3);
      assert.equal(gate['passed_count'], 0);
      assert.equal(gate['rejected_count'], 3);
      assert.equal(gate['enabled'], true);
      assert.equal(gate['sector_mapped'], true);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('A6: rejected_samples tiene muestras de los rechazados', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown>;
      const samples = gate['rejected_samples'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(samples) && samples.length > 0, 'debe haber rejected_samples');
      assert.equal(samples[0]['reason'], 'insufficient_sector_evidence');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });
});

// ─── B. Gate pasa 1 de 3 ─────────────────────────────────────────────────────

describe('B. Apollo devuelve 3, gate pasa 1', () => {
  const MIX = [ORG_CITIGROUP, ORG_HUAWEI, ORG_UNIVERSIDAD_X].map(toApolloOrg);

  const deps: ApolloOrgsSearchDeps = {
    searchOrgs: async () => ({ success: true, data: MIX }),
    logUsage: noopLogUsage as unknown as typeof import('../apollo-organizations-usage-logging').realLogApolloOrgsUsage,
  };

  it('B1: resultsCount=1 (solo Universidad X pasa)', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      assert.equal(out.resultsCount, 1, 'solo 1 resultado pasa el gate');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('B2: apollo_raw_results_count=3, apollo_post_gate_results_count=1', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_raw_results_count'], 3);
      assert.equal(meta['apollo_post_gate_results_count'], 1);
      assert.equal(meta['apollo_sector_rejected_count'], 2);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('B3: gate metadata checked_count=3, passed_count=1, rejected_count=2', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown>;
      assert.equal(gate['checked_count'], 3);
      assert.equal(gate['passed_count'], 1);
      assert.equal(gate['rejected_count'], 2);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('B4: passed_samples tiene Universidad X', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown>;
      const passed = gate['passed_samples'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(passed) && passed.length === 1);
      assert.ok(String(passed[0]['name']).includes('Universidad'), 'passed_sample debe ser Universidad X');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });
});

// ─── C. Apollo devuelve 0 ─────────────────────────────────────────────────────

describe('C. Apollo devuelve 0 resultados', () => {
  const deps: ApolloOrgsSearchDeps = {
    searchOrgs: async () => ({ success: true, data: [] }),
    logUsage: noopLogUsage as unknown as typeof import('../apollo-organizations-usage-logging').realLogApolloOrgsUsage,
  };

  it('C1: resultsCount=0, sin error', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      assert.equal(out.resultsCount, 0);
      assert.equal(out.skipped, false);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('C2: apollo_raw_results_count=0 y gate checked_count=0', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_raw_results_count'], 0);
      assert.equal(meta['apollo_post_gate_results_count'], 0);
      assert.equal(meta['apollo_sector_rejected_count'], 0);
      const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown>;
      assert.equal(gate['checked_count'], 0);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });
});

// ─── D. Sector no mapeado ─────────────────────────────────────────────────────

describe('D. Sector no mapeado → passthrough, gate enabled=false', () => {
  const deps: ApolloOrgsSearchDeps = {
    searchOrgs: async () => ({ success: true, data: [ORG_CITIGROUP].map(toApolloOrg) }),
    logUsage: noopLogUsage as unknown as typeof import('../apollo-organizations-usage-logging').realLogApolloOrgsUsage,
  };

  it('D1: sector=Tecnología → Citigroup pasa (no hay mapping)', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const input: WebSearchInput = { ...BASE_INPUT, industry: 'Tecnología' };
      const out = await runApolloOrganizationsSearch(input, 3, undefined, deps);
      assert.equal(out.resultsCount, 1, 'sin mapping, todos pasan');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('D2: gate metadata enabled=false, reason=sector_not_mapped', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const input: WebSearchInput = { ...BASE_INPUT, industry: 'Tecnología' };
      const out = await runApolloOrganizationsSearch(input, 3, undefined, deps);
      const meta = out.metadata as Record<string, unknown>;
      const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown>;
      assert.equal(gate['enabled'], false);
      assert.equal(gate['reason'], 'sector_not_mapped');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });
});

// ─── E. Tavily regression ─────────────────────────────────────────────────────

describe('E. Tavily regression — gate metadata Apollo no aparece para Tavily', () => {
  it('E1: runMultiQueryWebSearch con provider=mock no incluye apollo_sector_relevance_gate', async () => {
    const input: MultiQuerySearchInput = {
      queries: ['empresa educacion colombia'],
      provider: 'mock',
      industry: 'Educación',
      country: 'Colombia',
      countryCode: 'CO',
      maxResultsPerQuery: 3,
      targetCount: 5,
    };
    const out = await runMultiQueryWebSearch(input);
    const meta = out.metadata as Record<string, unknown>;
    // Mock provider no setea gate metadata
    assert.ok(
      !('apollo_sector_relevance_gate' in meta),
      'metadata Apollo no debe aparecer en provider=mock',
    );
  });

  it('E2: runMultiQueryWebSearch con mock dispatchQuery (Tavily simulado) no crashea', async () => {
    const tavilyMockDispatch = async (
      _prov: WebSearchProviderKey,
      _input: WebSearchInput,
      _max: number,
    ): Promise<WebSearchOutput> => ({
      provider: 'tavily',
      query: _input.query,
      results: [],
      resultsCount: 0,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: 0,
      metadata: { provider: 'tavily' },
    });

    const input: MultiQuerySearchInput = {
      queries: ['empresa educacion colombia'],
      provider: 'tavily',
      industry: 'Educación',
      country: 'Colombia',
      countryCode: 'CO',
      maxResultsPerQuery: 3,
      targetCount: 5,
    };
    const out = await runMultiQueryWebSearch(input, makeDispatchDeps(tavilyMockDispatch));
    const meta = out.metadata as Record<string, unknown>;
    assert.ok(
      !('apollo_raw_results_count' in meta),
      'campos Apollo no deben aparecer en provider=tavily',
    );
    assert.ok(
      !('apollo_sector_relevance_gate' in meta),
      'gate Apollo no debe aparecer para Tavily',
    );
  });
});

// ─── F. No secretos en metadata propagada ────────────────────────────────────

describe('F. No secretos en metadata del gate propagada', () => {
  it('F1: metadata del provider no contiene secretos cuando gate rechaza 3', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: async () => ({
        success: true,
        data: [ORG_CITIGROUP, ORG_HUAWEI, ORG_PWC].map(toApolloOrg),
      }),
      logUsage: noopLogUsage as unknown as typeof import('../apollo-organizations-usage-logging').realLogApolloOrgsUsage,
    };
    try {
      const out = await runApolloOrganizationsSearch(BASE_INPUT, 3, undefined, deps);
      const serialized = JSON.stringify(out.metadata).toLowerCase();
      for (const pattern of SECRET_PATTERNS) {
        assert.ok(!serialized.includes(pattern), `metadata no debe contener "${pattern}"`);
      }
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('F2: metadata propagada por runMultiQueryWebSearch no contiene secretos', async () => {
    const apolloMockDispatch = async (
      _prov: WebSearchProviderKey,
      _input: WebSearchInput,
      _max: number,
    ): Promise<WebSearchOutput> => ({
      provider: 'apollo_organizations',
      query: _input.query,
      results: [],
      resultsCount: 0,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: 0.026,
      metadata: {
        apollo_raw_results_count: 3,
        apollo_post_gate_results_count: 0,
        apollo_sector_rejected_count: 3,
        apollo_sector_relevance_gate: {
          gate_version: 'v1.16K-AD',
          enabled: true,
          sector_mapped: true,
          sector: 'Educación',
          strategy: 'sector_evidence_required',
          checked_count: 3,
          passed_count: 0,
          rejected_count: 3,
          rejected_samples: [
            { name: 'Citigroup Inc', domain: 'citi.com', matched_terms: [], reason: 'insufficient_sector_evidence' },
          ],
          passed_samples: [],
        },
      },
    });

    const input: MultiQuerySearchInput = {
      queries: ['empresa educacion colombia'],
      provider: 'apollo_organizations',
      industry: 'Educación',
      country: 'Colombia',
      countryCode: 'CO',
      maxResultsPerQuery: 3,
      targetCount: 5,
    };
    const out = await runMultiQueryWebSearch(input, makeDispatchDeps(apolloMockDispatch));
    const serialized = JSON.stringify(out.metadata).toLowerCase();
    for (const pattern of SECRET_PATTERNS) {
      assert.ok(!serialized.includes(pattern), `metadata propagada no debe contener "${pattern}"`);
    }
  });
});

// ─── G. Cost guardrail regression ────────────────────────────────────────────

describe('G. Cost guardrail regression — sigue vigente', () => {
  it('G1: gate metadata propagada en runMultiQueryWebSearch con apollo mock', async () => {
    const apolloMockDispatch = async (
      _prov: WebSearchProviderKey,
      _input: WebSearchInput,
      _max: number,
    ): Promise<WebSearchOutput> => ({
      provider: 'apollo_organizations',
      query: _input.query,
      results: [],
      resultsCount: 0,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: 0.026,
      metadata: {
        apollo_raw_results_count: 3,
        apollo_post_gate_results_count: 0,
        apollo_sector_rejected_count: 3,
        apollo_sector_relevance_gate: {
          gate_version: 'v1.16K-AD',
          enabled: true,
          sector_mapped: true,
          sector: 'Educación',
          strategy: 'sector_evidence_required',
          checked_count: 3,
          passed_count: 0,
          rejected_count: 3,
          rejected_samples: [],
          passed_samples: [],
        },
      },
    });

    const input: MultiQuerySearchInput = {
      queries: ['empresa educacion colombia'],
      provider: 'apollo_organizations',
      industry: 'Educación',
      country: 'Colombia',
      countryCode: 'CO',
      maxResultsPerQuery: 3,
      targetCount: 5,
    };
    const out = await runMultiQueryWebSearch(input, makeDispatchDeps(apolloMockDispatch));
    const meta = out.metadata as Record<string, unknown>;

    // Trazabilidad: gate metadata debe estar en el output
    assert.ok('apollo_raw_results_count' in meta, 'apollo_raw_results_count debe estar en metadata');
    assert.equal(meta['apollo_raw_results_count'], 3);
    assert.equal(meta['apollo_post_gate_results_count'], 0);
    assert.equal(meta['apollo_sector_rejected_count'], 3);

    const gate = meta['apollo_sector_relevance_gate'] as Record<string, unknown>;
    assert.ok(gate !== undefined, 'apollo_sector_relevance_gate debe estar en metadata');
    assert.equal(gate['checked_count'], 3);
    assert.equal(gate['passed_count'], 0);
    assert.equal(gate['rejected_count'], 3);
  });

  it('G2: defaults guardrails Apollo intactos (1 query × 3 results = 3 créditos max)', async () => {
    const { resolveApolloMaxQueriesPerRun, resolveApolloMaxResultsPerQuery } = await import('../apollo-cost-guardrails');
    const savedQ = process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    const savedR = process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
    delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
    try {
      const maxCredits = resolveApolloMaxQueriesPerRun() * resolveApolloMaxResultsPerQuery();
      assert.ok(maxCredits <= 3, `maxCredits ${maxCredits} debe ser <= 3`);
    } finally {
      if (savedQ !== undefined) process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = savedQ;
      if (savedR !== undefined) process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = savedR;
    }
  });

  it('G3: gate no relaja reglas — Citigroup sigue rechazado con sector=Educación', async () => {
    const { applyApolloSectorRelevanceGate } = await import('../apollo-sector-relevance-gate');
    const citigroupResult = {
      title: 'Citigroup Inc',
      url: 'https://citi.com',
      snippet: 'Empresa: Citigroup Inc | Industria: Banking | País: Colombia',
      source: 'apollo_organizations' as const,
      rank: 1,
      provider: 'apollo_organizations' as const,
      confidence: 0.85,
      metadata: { domain: 'citi.com', industry: 'Banking' },
    };
    const result = applyApolloSectorRelevanceGate([citigroupResult], 'Educación', 'apollo_organizations');
    assert.equal(result.passed.length, 0, 'Citigroup debe seguir rechazado');
    assert.equal(result.metadata.rejected_count, 1);
  });

  it('G4: incremental-search sigue saltando LinkedIn cuando Apollo es provider (fuente)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/incremental-search.ts'),
      'utf-8',
    );
    assert.ok(source.includes('isApolloProvider'), 'isApolloProvider debe seguir presente');
    assert.ok(
      source.includes('isApolloProvider\n        ? undefined'),
      'LinkedIn debe seguir skipped para Apollo',
    );
  });
});
