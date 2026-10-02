/**
 * Tests — Agente 1 · piloto «Claude busca empresas» (AGENT1-CLAUDE-COMPANY-SEARCH-1).
 *
 * Sin red ni base de datos: Claude, Supabase y el escritor son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AnthropicConversationResult, AnthropicRequestBody } from '../anthropic-messages-client';
import {
  buildCompanySearchRequestBody,
  COMPANY_SEARCH_PROMPT_EXCLUSIONS,
  searchCompaniesWithClaude,
  SUBMIT_COMPANIES_TOOL_NAME,
} from '../company-search';
import {
  buildCompanySearchQueries,
  runClaudeCompanySearch,
  type ClaudeCompanySearchDeps,
  type CompanySearchCall,
  type SourceBatch,
} from '../company-search-run';
import { isRegistrableDomain, searchConfirmsDomain } from '../site-match';
import {
  runClaudeWebSearch,
  withClaudeSearchContext,
  type ClaudeSearchRunContext,
} from '../../web-search-providers/claude-web-search-provider';

const MODEL = 'claude-haiku-4-5-20251001';
const USAGE = {
  inputTokens: 40_000,
  outputTokens: 900,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 4,
  webFetchRequests: 0,
};

const INPUT = {
  query: 'empresas de Tecnología en Colombia',
  countryName: 'Colombia',
  countryCode: 'CO',
  industryName: 'Tecnología',
  subindustries: [],
  additionalCriteria: null,
  excludeDomains: ['siigo.com'],
  maxCompanies: 5,
};

function conversation(
  companies: Array<Record<string, unknown>>,
  searchUrls: string[],
  { submit = true }: { submit?: boolean } = {},
): AnthropicConversationResult {
  return {
    content: [
      { type: 'web_search_tool_result', content: searchUrls.map((url) => ({ type: 'web_search_result', url, title: 't' })) },
      ...(submit ? [{ type: 'tool_use', name: SUBMIT_COMPANIES_TOOL_NAME, input: { companies } }] : []),
    ],
    stopReason: submit ? 'tool_use' : 'end_turn',
    usage: USAGE,
    requests: 1,
  };
}

const COMPANY = (name: string, website: string, extra: Record<string, unknown> = {}) => ({
  name,
  website_url: website,
  evidence: `${name} es una empresa de software en Bogotá`,
  source_url: website,
  linkedin_url: null,
  ...extra,
});

describe('A. searchCompaniesWithClaude — sólo pasa lo que salió de la búsqueda', () => {
  it('filtra inventadas, plataformas, ya conocidas y repetidas', async () => {
    const conv = conversation(
      [
        COMPANY('Sophos Solutions', 'https://www.sophossolutions.com'),
        COMPANY('Inventada SAS', 'https://inventada-sas.co'),
        COMPANY('Siigo', 'https://www.siigo.com'),
        COMPANY('Perfil', 'https://www.linkedin.com/company/x'),
        COMPANY('Sophos otra vez', 'https://sophossolutions.com/contacto'),
        COMPANY('Heinsohn', 'https://heinsohn.com.co', { linkedin_url: 'https://www.linkedin.com/company/heinsohn' }),
      ],
      [
        'https://www.sophossolutions.com/nosotros',
        'https://www.siigo.com/',
        'https://www.linkedin.com/company/x',
        'https://heinsohn.com.co/',
        'https://www.linkedin.com/company/heinsohn',
      ],
    );
    const out = await searchCompaniesWithClaude(INPUT, MODEL, { runConversation: async () => conv });
    assert.deepEqual(
      out.results.map((r) => r.url),
      ['https://sophossolutions.com', 'https://heinsohn.com.co'],
    );
    assert.deepEqual(out.rejected, {
      not_in_search_results: 1,
      excluded_domain: 1,
      platform_domain: 1,
      duplicate_in_response: 1,
    });
    assert.equal(out.proposed, 6);
    assert.equal(out.results[0].provider, 'claude');
    assert.equal(out.results[0].title, 'Sophos Solutions');
    assert.equal(out.results[1].metadata?.linkedin_url, 'https://www.linkedin.com/company/heinsohn');
    assert.ok((out.usage?.estimatedCostUsd ?? 0) > 0);
  });

  it('fuera de la búsqueda, con fuente que sí salió: se baja el sitio y vale sólo si es de esa empresa', async () => {
    const FILLER = ' Desarrollamos software a la medida para bancos y retail en Colombia.'.repeat(6);
    const pages: Record<string, string> = {
      'https://www.sophossolutions.com': `<html><head><title>Sophos Solutions | Tecnología</title></head><body><p>${FILLER}</p></body></html>`,
      'https://parked.co': `<html><head><title>Este dominio está en venta</title></head><body><p>${FILLER}</p></body></html>`,
    };
    const fetchPage = async (url: string) => ({
      requestedUrl: url,
      finalUrl: url,
      httpStatus: 200,
      redirected: false,
      html: pages[url] ?? null,
      error: null,
    });
    const ranking = 'https://www.ranking.co/top-tecnologicas';
    const conv = conversation(
      [
        COMPANY('Sophos Solutions', 'https://www.sophossolutions.com', { source_url: ranking }),
        COMPANY('Parqueada SAS', 'https://parked.co', { source_url: ranking }),
        COMPANY('Sin fuente', 'https://sinfuente.co', { source_url: 'https://otra-fuente.co/x' }),
      ],
      [ranking],
    );
    const out = await searchCompaniesWithClaude(INPUT, MODEL, { runConversation: async () => conv, fetchPage });
    assert.deepEqual(out.results.map((r) => r.url), ['https://sophossolutions.com']);
    assert.equal(out.results[0].metadata?.site_in_search_results, false);
    assert.equal(out.results[0].metadata?.outside_search_verification, 'name_match');
    assert.deepEqual(out.rejected, { outside_search_unverified: 1, not_in_search_results: 1 });

    // Sin descarga disponible, lo de fuera de la búsqueda se rechaza como antes.
    const noFetch = await searchCompaniesWithClaude(INPUT, MODEL, { runConversation: async () => conv });
    assert.equal(noFetch.results.length, 0);
  });

  it('respeta el máximo de empresas por consulta', async () => {
    const urls = ['a.co', 'b.co', 'c.co'].map((d) => `https://${d}`);
    const conv = conversation(urls.map((u, i) => COMPANY(`E${i}`, u)), urls);
    const out = await searchCompaniesWithClaude({ ...INPUT, maxCompanies: 2 }, MODEL, { runConversation: async () => conv });
    assert.equal(out.results.length, 2);
  });

  it('si no entrega, se le obliga una vez; un error no lanza', async () => {
    const bodies: AnthropicRequestBody[] = [];
    const out = await searchCompaniesWithClaude(INPUT, MODEL, {
      runConversation: async (body) => (bodies.push(body), bodies.length === 1 ? conversation([], [], { submit: false }) : conversation([], [])),
    });
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1].tool_choice, { type: 'tool', name: SUBMIT_COMPANIES_TOOL_NAME });
    assert.equal(out.results.length, 0);

    const failed = await searchCompaniesWithClaude(INPUT, MODEL, {
      runConversation: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(failed.errorCode, 'unexpected_error');
  });

  it('el mensaje lleva la lista de ya conocidas, con tope', () => {
    const many = Array.from({ length: 120 }, (_, i) => `d${i}.co`);
    const body = buildCompanySearchRequestBody({ ...INPUT, excludeDomains: many }, MODEL);
    const text = JSON.stringify(body.messages);
    assert.match(text, /d0\.co/);
    assert.match(text, new RegExp(`d${COMPANY_SEARCH_PROMPT_EXCLUSIONS - 1}\\.co`));
    assert.doesNotMatch(text, new RegExp(`d${COMPANY_SEARCH_PROMPT_EXCLUSIONS}\\.co`));
    const tools = body.tools as Array<{ user_location?: unknown }>;
    assert.equal(tools.some((t) => t.user_location !== undefined), false);
  });
});

describe('B. proveedor «claude» de la búsqueda web', () => {
  it('sin el contexto del piloto no llama a nadie', async () => {
    const out = await runClaudeWebSearch({ query: 'x', countryCode: 'CO' } as never, 5);
    assert.equal(out.skipped, true);
    assert.equal(out.skipReason, 'claude_search_context_missing');
  });

  it('con contexto: registra la llamada y no repite dominios en la siguiente consulta', async () => {
    const seenExclusions: string[][] = [];
    const ctx: ClaudeSearchRunContext = {
      model: MODEL,
      apiKey: 'test-key',
      countryName: 'Colombia',
      industryName: 'Tecnología',
      subindustries: [],
      additionalCriteria: null,
      excludeDomains: ['siigo.com'],
      calls: [],
      deadlineAtMs: Date.now() + 1_000_000,
      runConversation: async (body) => {
        seenExclusions.push([String(JSON.stringify(body.messages))]);
        return conversation([COMPANY('Sophos', 'https://sophossolutions.com')], ['https://sophossolutions.com']);
      },
    };
    const first = await withClaudeSearchContext(ctx, () => runClaudeWebSearch({ query: 'q1', countryCode: 'CO' } as never, 5));
    const second = await withClaudeSearchContext(ctx, () => runClaudeWebSearch({ query: 'q2', countryCode: 'CO' } as never, 5));
    assert.equal(first.resultsCount, 1);
    assert.equal(second.resultsCount, 0); // la segunda ya la excluye
    assert.equal(ctx.calls.length, 2);
    assert.match(seenExclusions[1][0], /sophossolutions\.com/);
  });

  it('registra cada llamada al terminar y no empieza otra sin tiempo', async () => {
    const logged: string[] = [];
    let clock = 0;
    const ctx: ClaudeSearchRunContext = {
      model: MODEL,
      apiKey: 'test-key',
      countryName: 'Colombia',
      industryName: 'Tecnología',
      subindustries: [],
      additionalCriteria: null,
      excludeDomains: [],
      calls: [],
      deadlineAtMs: 100_000,
      nowMs: () => clock,
      onCall: async (call) => void logged.push(call.query),
      runConversation: async () => {
        clock += 60_000; // la llamada tarda 60 s
        return conversation([], []);
      },
    };
    await withClaudeSearchContext(ctx, () => runClaudeWebSearch({ query: 'q1', countryCode: 'CO' } as never, 5));
    const second = await withClaudeSearchContext(ctx, () => runClaudeWebSearch({ query: 'q2', countryCode: 'CO' } as never, 5));
    assert.deepEqual(logged, ['q1']);
    assert.equal(second.skipReason, 'claude_time_budget');
  });
});

describe('B2. ¿la búsqueda respalda el dominio?', () => {
  it('igual o subdominio vale; un sufijo compartido o un alojamiento no', () => {
    assert.equal(searchConfirmsDomain('unam.mx', 'unam.mx'), true);
    assert.equal(searchConfirmsDomain('unam.mx', 'portal.unam.mx'), true);
    assert.equal(searchConfirmsDomain('portal.unam.mx', 'unam.mx'), true);
    assert.equal(searchConfirmsDomain('com.co', 'empresa.com.co'), false);
    assert.equal(searchConfirmsDomain('gov.co', 'alcaldia.gov.co'), false);
    assert.equal(searchConfirmsDomain('blogspot.com', 'empresa.blogspot.com'), false);
    assert.equal(searchConfirmsDomain('otra.com', 'empresa.com'), false);
    assert.equal(isRegistrableDomain('sii-group.com'), true);
    assert.equal(isRegistrableDomain('com.mx'), false);
  });
});

const SOURCE: SourceBatch = {
  id: 'b1',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  industryId: 'tec-id',
  subindustries: [],
  additionalCriteria: null,
};

function call(results: number, cost = 0.07): CompanySearchCall {
  return {
    results: Array.from({ length: results }, (_, i) => ({
      title: `E${i}`,
      url: `https://e${i}.co`,
      rank: i + 1,
      provider: 'claude' as const,
    })),
    proposed: results + 1,
    rejected: { not_in_search_results: 1 },
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: cost, pricingSource: 'table' },
    errorCode: null,
    query: 'q',
    durationMs: 20_000,
  };
}

function fakeDeps(overrides: Partial<ClaudeCompanySearchDeps> = {}) {
  const logs: Array<{ operation_key: string; batch_id?: string; metadata?: Record<string, unknown> }> = [];
  const writes: Array<Record<string, unknown>> = [];
  const deps: ClaudeCompanySearchDeps = {
    loadSourceBatch: async () => SOURCE,
    loadExcludedDomains: async () => ['siigo.com'],
    countPreviousRuns: async () => 0,
    resolveRegions: () => ['Bogotá', 'Antioquia', 'Valle del Cauca'],
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    runSearch: async ({ onCall }) => {
      const calls = [call(3), call(2)];
      for (const c of calls) await onCall(c);
      return { pipelineOutput: { candidates: [] }, calls };
    },
    writeCandidates: async ({ metadata }) => (writes.push(metadata), { batchId: 'new-b', candidatesCreated: 4, errors: [] }),
    logUsage: async (input) => (logs.push(input as (typeof logs)[number]), true),
    newRunId: () => 'run-1',
    nowIso: () => '2026-10-01T12:00:00.000Z',
    nowMs: () => 0,
    ...overrides,
  };
  return { deps, logs, writes };
}

describe('C. runClaudeCompanySearch', () => {
  it('escribe en un lote NUEVO, marca el piloto y registra cada llamada con la corrida', async () => {
    const f = fakeDeps();
    const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.batchId, 'new-b');
    assert.equal(s.passedPreFilter, 5);
    assert.equal(s.proposed, 7);
    assert.deepEqual(s.rejected, { not_in_search_results: 2 });
    assert.ok(Math.abs(s.estimatedCostUsd - 0.14) < 1e-9);
    const meta = f.writes[0] as {
      industry_id: string;
      claude_company_search: { source_batch_id: string; pilot: boolean; run_id: string };
    };
    assert.equal(meta.industry_id, 'tec-id');
    assert.equal(meta.claude_company_search.source_batch_id, 'b1');
    assert.equal(meta.claude_company_search.pilot, true);
    assert.equal(meta.claude_company_search.run_id, 'run-1');
    assert.deepEqual(
      f.logs.map((l) => [l.operation_key, l.batch_id, l.metadata?.run_id, l.metadata?.source_batch_id]),
      [
        ['company_search', undefined, 'run-1', 'b1'],
        ['company_search', undefined, 'run-1', 'b1'],
      ],
    );
  });

  it('sin empresas que pasen el filtro no crea lote, pero registra lo pagado', async () => {
    const f = fakeDeps({
      runSearch: async ({ onCall }) => {
        await onCall(call(0));
        return { pipelineOutput: {}, calls: [call(0)] };
      },
    });
    const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.batchId, null);
    assert.equal(f.writes.length, 0);
    assert.equal(f.logs.length, 1);
  });

  it('modelo sin configurar, cuota agotada o lote inválido ⇒ no llama a Claude', async () => {
    let searched = 0;
    const runSearch: ClaudeCompanySearchDeps['runSearch'] = async () => ((searched += 1), { pipelineOutput: {}, calls: [] });
    const cases: Array<[Partial<ClaudeCompanySearchDeps>, string]> = [
      [{ loadSourceBatch: async () => null }, 'source_batch_not_found'],
      [{ resolveActiveModel: async () => ({ error: 'x' }) }, 'model_not_configured'],
      [{ checkQuota: async () => ({ allowed: false }) }, 'quota_exhausted'],
      [
        {
          loadExcludedDomains: async () => {
            throw new Error('read');
          },
        },
        'exclusions_unavailable',
      ],
    ];
    for (const [override, error] of cases) {
      const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, fakeDeps({ ...override, runSearch }).deps);
      assert.deepEqual(s.ok ? null : s.error, error);
    }
    assert.equal(searched, 0);
  });

  it('si la búsqueda se cae a mitad, lo ya pagado quedó registrado', async () => {
    const f = fakeDeps({
      runSearch: async ({ onCall }) => {
        await onCall(call(2));
        throw new Error('pipeline crash');
      },
    });
    const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.deepEqual(s.ok ? null : s.error, 'search_failed');
    assert.equal(f.logs.length, 1);
  });

  it('si el escritor falla con empresas encontradas, se informa', async () => {
    const f = fakeDeps({ writeCandidates: async () => ({ batchId: null, candidatesCreated: 0, errors: ['boom'] }) });
    const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.deepEqual(s.ok ? null : s.error, 'write_failed');
    assert.equal(f.logs.length, 2); // lo pagado se registra igual
  });

  it('corridas siguientes rotan regiones del país, dos por corrida', () => {
    const regions = ['Bogotá', 'Antioquia', 'Valle del Cauca'];
    assert.deepEqual(buildCompanySearchQueries(SOURCE, 1, regions), [
      'empresas de Tecnología en Bogotá, Colombia',
      'empresas de Tecnología en Antioquia, Colombia',
    ]);
    assert.deepEqual(buildCompanySearchQueries(SOURCE, 2, regions), [
      'empresas de Tecnología en Valle del Cauca, Colombia',
      'empresas de Tecnología en Bogotá, Colombia',
    ]);
    // Sin regiones conocidas para el país ⇒ consultas nacionales.
    assert.equal(buildCompanySearchQueries(SOURCE, 3, []).length, 2);
  });

  it('consultas: una general y una por subindustria (máx. 2)', () => {
    assert.deepEqual(buildCompanySearchQueries(SOURCE), [
      'empresas de Tecnología en Colombia',
      'grandes empresas de Tecnología con sede en Colombia',
    ]);
    assert.deepEqual(buildCompanySearchQueries({ ...SOURCE, subindustries: ['Software', 'Telecom'] }), [
      'empresas de Tecnología en Colombia',
      'empresas de Software en Colombia',
    ]);
  });
});
