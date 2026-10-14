/**
 * Tests — Agente 1 · «Proveedores de una empresa», Fase 1 (AGENT1-SUPPLIER-SEARCH-1).
 *
 * Sin red ni base de datos: Claude y el escritor son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AnthropicConversationResult } from '../anthropic-messages-client';
import {
  buildCompanySearchRequestBody,
  searchCompaniesWithClaude,
  SUBMIT_COMPANIES_TOOL_NAME,
} from '../company-search';
import {
  buildCompanySearchUsageLog,
  buildSupplierSearchQueries,
  runClaudeCompanySearch,
  type ClaudeCompanySearchDeps,
  type CompanySearchCall,
  type SourceBatch,
} from '../company-search-run';
import { readRelationshipEvidence } from '../../prospecting-pipeline';

const MODEL = 'claude-haiku-4-5-20251001';
const USAGE = {
  inputTokens: 30_000,
  outputTokens: 800,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 3,
  webFetchRequests: 0,
};

const INPUT = {
  query: 'empresas de Tecnología que son proveedores de Ecopetrol en Colombia',
  countryName: 'Colombia',
  countryCode: 'CO',
  industryName: 'Tecnología',
  subindustries: [],
  additionalCriteria: null,
  excludeDomains: [],
  maxCompanies: 5,
  referenceCompanyName: 'Ecopetrol',
};

function conversation(companies: Array<Record<string, unknown>>, searchUrls: string[]): AnthropicConversationResult {
  return {
    content: [
      { type: 'web_search_tool_result', content: searchUrls.map((url) => ({ type: 'web_search_result', url, title: 't' })) },
      { type: 'tool_use', name: SUBMIT_COMPANIES_TOOL_NAME, input: { companies } },
    ],
    stopReason: 'tool_use',
    usage: USAGE,
    requests: 1,
  };
}

describe('A. instrucción de «Proveedores»', () => {
  it('pide proveedores de la empresa de referencia, con la página que prueba la relación', () => {
    const body = buildCompanySearchRequestBody(INPUT, MODEL);
    const system = String(body.system);
    assert.match(system, /PROVEEDORES/);
    assert.match(system, /«Ecopetrol»/);
    assert.match(system, /Nunca entregues a «Ecopetrol»/);
    const user = JSON.stringify(body.messages);
    assert.match(user, /Empresa de referencia \(a la que le venden\): Ecopetrol/);
    assert.match(user, /Industria de los proveedores: Tecnología/);
    const submit = (body.tools as Array<{ name?: string; input_schema?: unknown }>).find(
      (t) => t.name === SUBMIT_COMPANIES_TOOL_NAME,
    );
    assert.match(JSON.stringify(submit?.input_schema), /prueba la relación/);
  });

  it('sin empresa de referencia la instrucción es la de siempre', () => {
    const body = buildCompanySearchRequestBody({ ...INPUT, referenceCompanyName: null }, MODEL);
    assert.doesNotMatch(String(body.system), /PROVEEDORES/);
    assert.match(String(body.system), /Buscas EMPRESAS reales/);
  });
});

describe('B. filtro posterior', () => {
  it('descarta a la propia empresa de referencia y marca a quién le venden las demás', async () => {
    const conv = conversation(
      [
        { name: 'ECOPETROL S.A.', website_url: 'https://www.ecopetrol.com.co', evidence: 'x', source_url: 'https://www.ecopetrol.com.co' },
        {
          name: 'Sophos Solutions',
          website_url: 'https://www.sophossolutions.com',
          evidence: 'Ecopetrol confió en Sophos para su nube',
          source_url: 'https://www.sophossolutions.com/casos/ecopetrol',
        },
      ],
      ['https://www.ecopetrol.com.co/', 'https://www.sophossolutions.com/casos/ecopetrol'],
    );
    const out = await searchCompaniesWithClaude(INPUT, MODEL, { runConversation: async () => conv });
    assert.deepEqual(out.results.map((r) => r.url), ['https://sophossolutions.com']);
    assert.deepEqual(out.rejected, { reference_company: 1 });
    assert.equal(out.results[0].metadata?.supplier_of, 'Ecopetrol');
    assert.equal(out.results[0].metadata?.evidence_source_url, 'https://www.sophossolutions.com/casos/ecopetrol');

    const evidence = readRelationshipEvidence(out.results[0]);
    assert.deepEqual(evidence, {
      kind: 'supplier_of',
      referenceCompanyName: 'Ecopetrol',
      evidenceUrl: 'https://www.sophossolutions.com/casos/ecopetrol',
      evidence: 'Ecopetrol confió en Sophos para su nube',
    });
  });

  it('un resultado de búsqueda por criterios no lleva relación', () => {
    assert.equal(
      readRelationshipEvidence({ title: 'x', url: 'https://x.co', rank: 1, provider: 'claude', metadata: { evidence_source_url: 'https://y.co' } }),
      null,
    );
  });
});

describe('C. corrida de «Proveedores»', () => {
  const SOURCE: SourceBatch = {
    id: 'b1',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    industryId: 'tec-id',
    macroIndustryKey: 'technology',
    subindustries: [],
    additionalCriteria: null,
    referenceCompanyName: 'Ecopetrol',
  };

  const CALL: CompanySearchCall = {
    results: [{ title: 'Sophos', url: 'https://sophossolutions.com', rank: 1, provider: 'claude' }],
    proposed: 2,
    rejected: { reference_company: 1 },
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.1, pricingSource: 'table' },
    errorCode: null,
    query: 'q',
    durationMs: 10_000,
  };

  it('consultas de proveedores; escribe en el lote de la corrida, sin banco y con el modo marcado', async () => {
    const searched: string[][] = [];
    const writes: Array<Parameters<ClaudeCompanySearchDeps['writeCandidates']>[0]> = [];
    let previousRunsAsked = false;
    const deps: ClaudeCompanySearchDeps = {
      loadSourceBatch: async () => SOURCE,
      loadExcludedDomains: async () => [],
      countPreviousRuns: async () => ((previousRunsAsked = true), 3),
      resolveRegions: () => ['Antioquia'],
      resolveActiveModel: async () => ({ model: MODEL, apiKey: 'k' }),
      checkQuota: async () => ({ allowed: true }),
      runSearch: async ({ queries, onCall }) => {
        searched.push(queries);
        await onCall(CALL);
        return { pipelineOutput: { candidates: [] }, calls: [CALL] };
      },
      writeCandidates: async (params) => (writes.push(params), { batchId: 'b1', candidatesCreated: 1, completeValidCandidates: 1, acceptedCandidateIds: ['c1'], errors: [] }),
      logUsage: async () => true,
      newRunId: () => 'run-1',
      nowIso: () => '2026-10-14T12:00:00.000Z',
      nowMs: () => 0,
    };
    const summary = await runClaudeCompanySearch({ sourceBatchId: 'b1', triggeredBy: 'u1', writeIntoSourceBatch: true }, deps);
    assert.equal(summary.ok, true);
    assert.equal(previousRunsAsked, false, 'la rotación por regiones no aplica a «Proveedores»');
    assert.deepEqual(searched[0], buildSupplierSearchQueries(SOURCE, 'Ecopetrol'));
    assert.equal(writes[0].existingBatchId, 'b1');
    assert.equal(writes[0].depositSurplusToBank, false);
    const meta = writes[0].metadata.claude_company_search as Record<string, unknown>;
    assert.equal(meta.mode, 'supplier_search');
    assert.equal(meta.reference_company_name, 'Ecopetrol');
  });

  it('las consultas nombran a la empresa, la industria y el país', () => {
    const queries = buildSupplierSearchQueries(SOURCE, 'Ecopetrol');
    assert.equal(queries.length, 2);
    for (const q of queries) {
      assert.match(q, /Ecopetrol/);
      assert.match(q, /Tecnología/);
      assert.match(q, /Colombia/);
    }
  });

  it('el uso de Claude queda marcado como «Proveedores»', () => {
    const log = buildCompanySearchUsageLog(CALL, {
      runId: 'r',
      sourceBatchId: 'b1',
      triggeredBy: 'u1',
      index: 0,
      batchId: 'b1',
      referenceCompanyName: 'Ecopetrol',
    });
    assert.equal(log?.metadata?.search_mode, 'suppliers');
    assert.equal(log?.metadata?.reference_company_name, 'Ecopetrol');
    const plain = buildCompanySearchUsageLog(CALL, { runId: 'r', sourceBatchId: 'b1', triggeredBy: 'u1', index: 0 });
    assert.equal(plain?.metadata?.search_mode, undefined);
  });
});
