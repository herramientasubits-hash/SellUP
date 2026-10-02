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
  const logs: Array<{ operation_key: string; batch_id?: string }> = [];
  const writes: Array<Record<string, unknown>> = [];
  const deps: ClaudeCompanySearchDeps = {
    loadSourceBatch: async () => SOURCE,
    loadExcludedDomains: async () => ['siigo.com'],
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    runSearch: async () => ({ pipelineOutput: { candidates: [] }, calls: [call(3), call(2)] }),
    writeCandidates: async ({ metadata }) => (writes.push(metadata), { batchId: 'new-b', candidatesCreated: 4, errors: [] }),
    logUsage: async (input) => (logs.push(input as { operation_key: string; batch_id?: string }), true),
    nowIso: () => '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
  return { deps, logs, writes };
}

describe('C. runClaudeCompanySearch', () => {
  it('escribe en un lote NUEVO, marca el piloto y registra cada llamada con ese lote', async () => {
    const f = fakeDeps();
    const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.batchId, 'new-b');
    assert.equal(s.passedPreFilter, 5);
    assert.equal(s.proposed, 7);
    assert.deepEqual(s.rejected, { not_in_search_results: 2 });
    assert.ok(Math.abs(s.estimatedCostUsd - 0.14) < 1e-9);
    const meta = f.writes[0] as { industry_id: string; claude_company_search: { source_batch_id: string; pilot: boolean } };
    assert.equal(meta.industry_id, 'tec-id');
    assert.equal(meta.claude_company_search.source_batch_id, 'b1');
    assert.equal(meta.claude_company_search.pilot, true);
    assert.deepEqual(f.logs.map((l) => [l.operation_key, l.batch_id]), [
      ['company_search', 'new-b'],
      ['company_search', 'new-b'],
    ]);
  });

  it('sin empresas que pasen el filtro no crea lote, pero registra lo pagado', async () => {
    const f = fakeDeps({ runSearch: async () => ({ pipelineOutput: {}, calls: [call(0)] }) });
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
    ];
    for (const [override, error] of cases) {
      const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, fakeDeps({ ...override, runSearch }).deps);
      assert.deepEqual(s.ok ? null : s.error, error);
    }
    assert.equal(searched, 0);
  });

  it('si el escritor falla con empresas encontradas, se informa', async () => {
    const f = fakeDeps({ writeCandidates: async () => ({ batchId: null, candidatesCreated: 0, errors: ['boom'] }) });
    const s = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.deepEqual(s.ok ? null : s.error, 'write_failed');
    assert.equal(f.logs.length, 2); // lo pagado se registra igual
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
