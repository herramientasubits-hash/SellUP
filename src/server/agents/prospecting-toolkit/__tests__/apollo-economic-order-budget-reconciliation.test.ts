/**
 * Tests — orden económico del provider Apollo
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§1, §3, §7, §10)
 *
 * Reproduce el run real de A1-APOLLO-LIVE-QA-1 a través de
 * `runApolloOrganizationsSearch` y comprueba que el enrichment pagado ya NO se
 * ejecuta para el candidato que el país descarta gratis.
 *
 * En el QA real: 3 créditos de organizations_search + 1 de organization_enrichment
 * (falabella.com.pe, país objetivo CO) = 4 cobrados frente a 3 reservados.
 *
 * Offline: el transporte y el enrichment se inyectan; cero llamadas reales, cero
 * créditos, cero escrituras.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloOrganization, ApolloEnrichResult } from '@/server/integrations/apollo-client';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { WebSearchInput } from '../types';

// ── Guard de red ─────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('network_access_forbidden_in_offline_test');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function org(overrides: Partial<ApolloOrganization> & Pick<ApolloOrganization, 'id' | 'name'>): ApolloOrganization {
  return {
    website_url: `https://${overrides.id}.example.com`,
    primary_domain: `${overrides.id}.example.com`,
    linkedin_url: null,
    industry: null,
    industry_tag_ids: [],
    employee_count: null,
    estimated_num_employees: 500,
    city: null,
    country: 'Colombia',
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: null,
    seo_description: null,
    description: null,
    keywords: [],
    industries: [],
    organization_keywords: [],
    ...overrides,
  } as ApolloOrganization;
}

// Las tres organizaciones que Apollo devolvió en el QA real.
const FALABELLA_PE = org({
  id: 'falabella',
  name: 'Falabella Retail Colombia',
  primary_domain: 'falabella.com.pe',
  website_url: 'https://www.falabella.com.pe',
  industry: 'retail',
  keywords: ['retail chain'],
  short_description: 'Cadena de tiendas por departamento.',
});

const CITIGROUP = org({
  id: 'citi',
  name: 'Citigroup',
  primary_domain: 'citi.com',
  website_url: 'https://www.citi.com',
  industry: 'banking',
  keywords: ['retail banking'],
  short_description: 'Global bank offering retail banking services.',
});

const GMAIL = org({
  id: 'google',
  name: 'gmail.com.co',
  primary_domain: 'google.com',
  website_url: 'https://www.google.com',
  industry: 'internet',
  keywords: ['email'],
});

const EXITO_CO = org({
  id: 'exito',
  name: 'Almacenes Exito',
  primary_domain: 'exito.com.co',
  website_url: 'https://www.exito.com.co',
  industry: 'retail',
  keywords: ['supermercado', 'grocery retail'],
  short_description: 'Cadena de supermercados e hipermercados en Colombia.',
});

const SEARCH_INPUT: WebSearchInput = {
  query: 'empresa supermercados e hipermercados colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  subindustries: ['Supermercados e Hipermercados'],
};

const QA_BATCH_ID = '7a75df68-aaa2-4558-9118-0846486a3e97';
const QA_RESERVATION_ID = '5dcc81fb-0000-0000-0000-000000000074';
const QA_CLIENT_REQUEST_ID = 'client-req-qa-live-1';

const RUN_CORRELATION: Record<string, string | null> = {
  correlation_version: 'wizard_run_correlation_v1',
  client_request_id: QA_CLIENT_REQUEST_ID,
  batch_id: QA_BATCH_ID,
  reservation_id: QA_RESERVATION_ID,
  wizard_run_id: null,
  agent_run_id: null,
  provider: 'apollo_organizations',
  request_fingerprint: null,
  idempotency_key: null,
};

type Harness = {
  logs: LogProviderUsageInput[];
  enrichedDomains: string[];
  deps: ApolloOrgsSearchDeps;
};

function makeHarness(orgs: ApolloOrganization[]): Harness {
  const logs: LogProviderUsageInput[] = [];
  const enrichedDomains: string[] = [];

  const deps: ApolloOrgsSearchDeps = {
    fetchPage: async () => ({
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: {
        organizations: orgs,
        pagination: { page: 1, per_page: orgs.length, total_entries: orgs.length },
      },
      headers: null,
    }),
    logUsage: async (input) => {
      logs.push({ ...input });
      return { kind: 'logged' as const };
    },
    enrichOrg: async ({ domain }): Promise<ApolloEnrichResult<ApolloOrganization>> => {
      // Cada invocación aquí es un crédito real en producción.
      enrichedDomains.push(domain);
      return { success: true, data: org({ id: 'enriched', name: 'Enriched' }) };
    },
    now: () => 1_700_000_000_000,
    random: () => 0.5,
    sleep: async () => undefined,
  };

  return { logs, enrichedDomains, deps };
}

function enrichmentLogs(logs: LogProviderUsageInput[]): LogProviderUsageInput[] {
  return logs.filter((l) => l.operation_key === 'organization_enrichment');
}

function searchLog(logs: LogProviderUsageInput[]): LogProviderUsageInput {
  const found = logs.find((l) => l.operation_key === 'organizations_search');
  assert.ok(found, 'debe existir un log de organizations_search');
  return found;
}

function withApolloEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const saved = {
      search: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
      cascade: process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE,
      maxEnrich: process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN,
      maxResults: process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY,
    };
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
    process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = '3';
    try {
      await fn();
    } finally {
      const restore = (key: string, value: string | undefined): void => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('ENABLE_APOLLO_COMPANY_SEARCH', saved.search);
      restore('ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE', saved.cascade);
      restore('AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN', saved.maxEnrich);
      restore('AGENT1_APOLLO_MAX_RESULTS_PER_QUERY', saved.maxResults);
    }
  };
}

// ── §7 El caso del QA real ───────────────────────────────────────────────────

describe('§7 orden económico: los gates baratos corren ANTES del enrichment pagado', () => {
  it(
    'el run real (Falabella PE + Citigroup + gmail) NO gasta ningún enrichment',
    withApolloEnv(async () => {
      const harness = makeHarness([FALABELLA_PE, CITIGROUP, GMAIL]);

      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      assert.deepEqual(
        harness.enrichedDomains,
        [],
        'ninguno de los tres candidatos justifica un enrichment pagado',
      );
      assert.equal(
        enrichmentLogs(harness.logs).length,
        0,
        'sin llamada real no debe emitirse log de organization_enrichment',
      );
    }),
  );

  it(
    'falabella.com.pe queda bloqueado por país, no por el cap',
    withApolloEnv(async () => {
      const harness = makeHarness([FALABELLA_PE]);

      const output = await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      assert.deepEqual(harness.enrichedDomains, []);

      const meta = output.metadata as Record<string, unknown>;
      const eligibility = meta['apollo_enrichment_eligibility'] as Record<string, unknown>;
      assert.equal(eligibility['eligible_count'], 0);
      const reasons = eligibility['skipped_reasons'] as Record<string, number>;
      assert.equal(reasons['country_tld_incompatible'], 1);

      const cascade = meta['apollo_enrichment_cascade'] as Record<string, unknown>;
      const cascadeReasons = cascade['skipped_reasons'] as Record<string, number>;
      assert.equal(
        cascadeReasons['eligibility_blocked'],
        1,
        'la cascada debe registrarlo como bloqueado por elegibilidad, no como cap_reached',
      );
      assert.equal(cascade['attempted_count'], 0, 'cero intentos = cero créditos');
      assert.equal(cascade['enrichment_credits_prevented'], 1);
    }),
  );

  it(
    'un supermercado colombiano legítimo SÍ recibe el enrichment',
    withApolloEnv(async () => {
      const harness = makeHarness([EXITO_CO]);

      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      assert.deepEqual(
        harness.enrichedDomains,
        ['exito.com.co'],
        'el reordenamiento no debe impedir enriquecer a un candidato válido',
      );
      assert.equal(enrichmentLogs(harness.logs).length, 1);
    }),
  );

  it(
    'con un candidato válido y otro bloqueado, el cap se gasta en el válido',
    withApolloEnv(async () => {
      // Cap = 1. Antes, el orden del array podía gastarlo en el bloqueado.
      const harness = makeHarness([FALABELLA_PE, EXITO_CO]);

      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      assert.deepEqual(harness.enrichedDomains, ['exito.com.co']);
    }),
  );

  it(
    'bloquear el enrichment NO descarta al candidato del resultado',
    withApolloEnv(async () => {
      // Éxito pasa el gate sectorial; el bloqueo de enrichment de Falabella no
      // debe alterar cuántos candidatos sobreviven al filtro final.
      const harness = makeHarness([EXITO_CO, FALABELLA_PE]);

      const output = await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      const meta = output.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_normalized_results_count'], 2);
      // Falabella trae 'retail chain', que es señal válida del sector: sigue en el
      // resultado aunque no se haya pagado su enrichment.
      assert.ok(output.resultsCount >= 1);
    }),
  );
});

// ── §5 Créditos del search desde la fuente única ─────────────────────────────

describe('§5 créditos del search', () => {
  it(
    'cobra por lo que Apollo devolvió (3 resultados = 3 créditos)',
    withApolloEnv(async () => {
      const harness = makeHarness([FALABELLA_PE, CITIGROUP, GMAIL]);
      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );
      assert.equal(searchLog(harness.logs).credits_used, 3);
    }),
  );

  it(
    'una organización descartada en normalización sigue contando como crédito',
    withApolloEnv(async () => {
      // Apollo cobró por devolverla aunque venga sin nombre utilizable.
      const nameless = { ...org({ id: 'nameless', name: 'x' }), name: '   ' } as ApolloOrganization;
      const harness = makeHarness([EXITO_CO, nameless]);

      const output = await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      const meta = output.metadata as Record<string, unknown>;
      assert.equal(meta['apollo_raw_results_count'], 2);
      assert.equal(meta['apollo_normalized_results_count'], 1);
      assert.equal(
        searchLog(harness.logs).credits_used,
        2,
        'la base son los resultados devueltos, no los normalizados',
      );
    }),
  );
});

// ── §1 / §3 Correlación en los usage logs ────────────────────────────────────

describe('§3 la correlación llega a los usage logs', () => {
  it(
    'el log de organizations_search lleva run_correlation completa',
    withApolloEnv(async () => {
      const harness = makeHarness([EXITO_CO]);
      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      const metadata = searchLog(harness.logs).metadata as Record<string, unknown>;
      const correlation = metadata['run_correlation'] as Record<string, unknown>;
      assert.equal(correlation['reservation_id'], QA_RESERVATION_ID);
      assert.equal(correlation['client_request_id'], QA_CLIENT_REQUEST_ID);
      assert.equal(correlation['batch_id'], QA_BATCH_ID);
    }),
  );

  it(
    'el log de organization_enrichment lleva la MISMA correlación (misma reserva)',
    withApolloEnv(async () => {
      const harness = makeHarness([EXITO_CO]);
      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      const enrichLog = enrichmentLogs(harness.logs)[0];
      assert.ok(enrichLog, 'debe existir el log de enrichment');
      const correlation = (enrichLog.metadata as Record<string, unknown>)['run_correlation'] as Record<string, unknown>;
      assert.equal(
        correlation['reservation_id'],
        QA_RESERVATION_ID,
        'search y enrichment deben reconciliar contra la misma reserva',
      );
    }),
  );

  it(
    'sin correlación (llamadas de diagnóstico) no se inventa el bloque',
    withApolloEnv(async () => {
      const harness = makeHarness([EXITO_CO]);
      await runApolloOrganizationsSearch(SEARCH_INPUT, 3, { batchId: QA_BATCH_ID }, harness.deps);

      const metadata = searchLog(harness.logs).metadata as Record<string, unknown>;
      assert.ok(!('run_correlation' in metadata));
    }),
  );
});

// ── §10 Observabilidad persistida ────────────────────────────────────────────

describe('§10 observabilidad en el usage log', () => {
  it(
    'el log de search persiste el bloque, con ausencias como null',
    withApolloEnv(async () => {
      const harness = makeHarness([EXITO_CO]);
      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      const metadata = searchLog(harness.logs).metadata as Record<string, unknown>;
      const observability = metadata['spend_observability'] as Record<string, unknown>;
      assert.ok(observability, 'debe existir el bloque de observabilidad');
      assert.equal(observability['page'], 1);
      assert.equal(observability['results_returned'], 1);
      assert.equal(observability['recorded_usage_credits'], 1);
      // El transporte falso no envía headers de cuota: null, nunca 0.
      assert.equal(observability['rate_limit_minute_remaining'], null);
      assert.equal(observability['retry_after_seconds'], null);
    }),
  );

  it(
    'el log de enrichment no hereda paginación ni cuota del search',
    withApolloEnv(async () => {
      const harness = makeHarness([EXITO_CO]);
      await runApolloOrganizationsSearch(
        SEARCH_INPUT,
        3,
        { batchId: QA_BATCH_ID, runCorrelation: RUN_CORRELATION },
        harness.deps,
      );

      const enrichLog = enrichmentLogs(harness.logs)[0];
      assert.ok(enrichLog);
      const observability = (enrichLog.metadata as Record<string, unknown>)['spend_observability'] as Record<string, unknown>;
      assert.equal(observability['page'], null);
      assert.equal(observability['pagination_total_entries'], null);
      assert.equal(observability['recorded_usage_credits'], 1);
      assert.equal(observability['billing_state'], 'charged');
    }),
  );
});

// ── Invariante: flag apagado sigue sin gastar ────────────────────────────────

describe('invariante: con ENABLE_APOLLO_COMPANY_SEARCH apagado no se llama a Apollo', () => {
  it('devuelve skipped sin coste y sin tocar el transporte', async () => {
    const saved = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    try {
      let transportCalls = 0;
      const output = await runApolloOrganizationsSearch(SEARCH_INPUT, 3, { batchId: QA_BATCH_ID }, {
        fetchPage: async () => {
          transportCalls += 1;
          throw new Error('should_never_be_called');
        },
      });
      assert.equal(transportCalls, 0);
      assert.equal(output.skipped, true);
      assert.equal(output.skipReason, 'apollo_company_search_disabled');
      assert.equal(output.estimatedCostUsd, 0);
    } finally {
      if (saved === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
      else process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved;
    }
  });
});
