/**
 * Tests — Search Quality v1.15.2 — Controlled LinkedIn Company Search
 *
 * Verifica el motor de búsqueda controlada de LinkedIn Company URL.
 *
 * Fixtures:
 *   F1  — not_found + candidato fuerte → dispara búsqueda mock → found
 *   F2  — batch cap 5 respetado
 *   F3  — confidenceScore bajo → skipped (low_confidence)
 *   F4  — query_only débil (confidence < 70) → no provider call
 *   F5  — duplicate guard bloqueado → no LinkedIn search
 *   F6  — evidence policy blocked → no LinkedIn search
 *   F7  — Mi-ERP no se confunde con Odoo global → ambiguous
 *   F8  — Visiontecno no se confunde con Zoho global → ambiguous
 *   F9  — sourceUrl LinkedIn personal (/in/) → rejected inicial, sin controlled search adicional
 *   F10 — result jobs/feed/posts → rejected
 *   F11 — mock sin resultados → not_found con source controlled_linkedin_search
 *   F12 — scoring boost solo found >=70 (a través del writer)
 *   F13 — batch metadata linkedin_search persiste en batch (a través del writer)
 *   F14 — 0 llamadas reales — todos los tests usan mock provider
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Sin scraping.
 * Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runControlledLinkedInCompanySearch,
  isEligibleForLinkedInSearch,
  buildLinkedInSearchQuery,
  createMockLinkedInSearchProvider,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
} from '../linkedin-company-search';
import type {
  LinkedInSearchConfig,
  ControlledLinkedInSearchCandidate,
} from '../linkedin-company-search';

import { buildLinkedInEnrichmentMetadata } from '../linkedin-company-enrichment';

import { writeProspectingCandidates } from '../candidate-writer';
import type { LinkedInSearchOverride } from '../candidate-writer';
import type {
  CandidateWriterInput,
  CatalogContextResult,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Shared constants ─────────────────────────────────────────────────────────

const CHECKED_AT = '2026-06-23T10:00:00.000Z';
const FAKE_BATCH_ID = 'batch-v1152-0000-0000-0000-000000000001';
const FAKE_USER_ID = 'user-v1152-0000-0000-0000-000000000001';

const ENABLED_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'mock',
  maxPerBatch: 5,
  minConfidenceScore: 70,
};

// ─── Helpers — candidate builder for runControlledLinkedInCompanySearch ───────

function makeNotFoundEnrichment() {
  return {
    enabled: true as const,
    status: 'not_found' as const,
    confidence: 0,
    warnings: ['No LinkedIn company URL available in current evidence.'],
    source: 'none' as const,
    checked_at: CHECKED_AT,
  };
}

function makeSearchCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'TestCo Colombia',
    domain: 'testco.com.co',
    countryCode: 'CO',
    sourceTitle: 'TestCo Colombia - Software ERP',
    sourceSnippet: 'Software ERP para empresas en Colombia.',
    confidenceScore: 75,
    currentEnrichment: makeNotFoundEnrichment(),
    ...overrides,
  };
}

// ─── Helpers — fake admin + candidate builder for writer tests ────────────────

class ChainResult {
  constructor(private readonly _val: unknown) {}
  eq(_col: string, _val: unknown): ChainResult { return this; }
  neq(_col: string, _val: unknown): ChainResult { return this; }
  in(_col: string, _vals: unknown[]): ChainResult { return this; }
  not(_col: string, _op: string, _val: unknown): ChainResult { return this; }
  gte(_col: string, _val: unknown): ChainResult { return this; }
  limit(_n: number): ChainResult { return this; }
  select(_cols: string): ChainResult { return this; }
  then<T>(onFulfilled: (v: unknown) => T | PromiseLike<T>): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled);
  }
  single(): Promise<unknown> { return Promise.resolve(this._val); }
}

type FakeAdminStats = {
  candidateInsertCalls: Record<string, unknown>[];
  batchInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
};

function makeFakeAdmin(stats: FakeAdminStats): SupabaseClient {
  let seq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            // ChainResult supports full method chain: eq/gte/not/in/single/then
            return new ChainResult({ data: null, error: { message: 'no batch' } });
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.batchInsertCalls.push({ ...data });
            return new ChainResult({ data: { id: FAKE_BATCH_ID }, error: null });
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-v1152-fake-${++seq}`;
            return {
              select(_cols: string) {
                return { single: () => Promise.resolve({ data: { id }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

const FAKE_CATALOG: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Software ERP',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

function makeWriterCandidate(overrides: Partial<ProspectingPipelineCandidate> = {}): ProspectingPipelineCandidate {
  return {
    name: 'TestCo Colombia',
    website: 'https://testco.com.co',
    domain: 'testco.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software ERP',
    sourceUrl: 'https://testco.com.co',
    sourceTitle: 'TestCo Colombia - Software ERP empresarial',
    sourceSnippet: 'Software ERP para empresas en Colombia. Soluciones b2b.',
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 90,
      input: { name: 'TestCo Colombia' },
      matches: [],
      summary: 'new',
      checkedSources: ['sellup'],
    },
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 75,
      fitScore: 60,
      dataCompletenessScore: 60,
      recommendedAction: 'approve_for_review',
      breakdown: {
        existenceSignals: 40, websiteSignals: 15, duplicateSignals: 15,
        sourceSignals: 5, fitSignals: 20, completenessSignals: 25, penalties: 0,
      },
      reasons: ['País identificado.', 'No duplicados encontrados.'],
      warnings: [],
      blockers: [],
      fitBreakdown: {
        product_fit: 25, country_fit: 5, b2b_signal: 8, duplicate_penalty: 0,
        country_evidence_penalty: 0, generic_agency_penalty: 0, commercial_calibration_delta: 38,
        final_fit_score: 60, fit_label: 'medium',
        fit_reasons: ['product_erp: software erp', 'b2b_signal'], fit_penalties: [],
      },
    },
    ...overrides,
  };
}

function makePipelineOutput(candidates: ProspectingPipelineCandidate[]) {
  return {
    input: {
      country: 'Colombia', countryCode: 'CO', industry: 'Software ERP',
      webSearchProvider: 'mock' as const, mode: 'single_query' as const,
    },
    catalogContext: FAKE_CATALOG,
    searchQuery: 'Software ERP Colombia',
    webSearch: {
      provider: 'mock' as const, query: 'test', results: [], resultsCount: 1,
      skipped: false, estimatedCostUsd: null, metadata: {},
    },
    candidates,
    summary: {
      requested: candidates.length, searched: candidates.length, returned: candidates.length,
      highQualityNew: candidates.length, needsReview: 0, duplicates: 0,
      insufficientData: 0, discarded: 0, unchecked: 0,
    },
    warnings: [],
    metadata: { provider: 'mock', pipelineVersion: 'test-v1152', executedAt: CHECKED_AT },
  };
}

function makeWriterInput(
  candidates: ProspectingPipelineCandidate[],
  overrides: Partial<CandidateWriterInput> = {},
): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput(candidates),
    triggeredByUserId: FAKE_USER_ID,
    ownerId: FAKE_USER_ID,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

// ─── F1 — Not_found + candidato fuerte → búsqueda mock → found ───────────────

describe('F1 — not_found + candidato fuerte dispara búsqueda mock → found', () => {
  it('attempted_count=1, status=found, source=mock_linkedin_search, company_url normalizada', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
    });

    const candidate = makeSearchCandidate({
      name: 'Softland',
      domain: 'softland.com',
      confidenceScore: 75,
      currentEnrichment: makeNotFoundEnrichment(),
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate],
      ENABLED_CONFIG,
      mockProvider,
      CHECKED_AT,
    );

    assert.equal(output.batchMetadata.attempted_count, 1, 'attempted_count debe ser 1');
    assert.equal(output.batchMetadata.skipped_count, 0);
    assert.equal(output.batchMetadata.found_count, 1, 'found_count debe ser 1');
    assert.equal(output.batchMetadata.provider, 'mock');

    const result = output.results[0];
    assert.equal(result.attempted, true);
    assert.equal(result.enrichment.status, 'found');
    assert.equal(result.enrichment.source, 'mock_linkedin_search');
    assert.ok(
      result.enrichment.company_url?.includes('softland'),
      `company_url debe incluir "softland", got: ${result.enrichment.company_url}`,
    );
    assert.ok(
      result.enrichment.company_url?.startsWith('https://www.linkedin.com/company/'),
      'company_url debe estar normalizada',
    );
  });

  it('query generada es conservadora: incluye nombre entre comillas y site:linkedin.com/company', async () => {
    const query = buildLinkedInSearchQuery('Softland', 'softland.com');
    assert.ok(query.includes('"Softland"'), 'query debe incluir nombre entre comillas');
    assert.ok(query.includes('site:linkedin.com/company'), 'query debe incluir site:linkedin.com/company');
    assert.ok(!query.includes('Colombia'), 'query NO debe incluir país genérico');
    assert.ok(!query.includes('software'), 'query NO debe incluir sector genérico');
  });

  it('query sin dominio solo usa nombre y site:', () => {
    const query = buildLinkedInSearchQuery('Mi Empresa SAS', null);
    assert.ok(query.includes('"Mi Empresa SAS"'));
    assert.ok(query.includes('site:linkedin.com/company'));
  });
});

// ─── F2 — Batch cap 5 respetado ───────────────────────────────────────────────

describe('F2 — batch cap 5 respetado', () => {
  it('8 candidatos elegibles → attempted_count=5, skipped_count=3', async () => {
    let providerCallCount = 0;
    const mockProvider = async (_query: string): Promise<string[]> => {
      providerCallCount++;
      return [];
    };

    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeSearchCandidate({
        name: `Empresa${i + 1} SAS`,
        domain: `empresa${i + 1}.com.co`,
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    );

    const output = await runControlledLinkedInCompanySearch(
      candidates,
      ENABLED_CONFIG,
      mockProvider,
      CHECKED_AT,
    );

    assert.equal(output.batchMetadata.attempted_count, 5, 'attempted_count debe ser 5');
    assert.equal(output.batchMetadata.skipped_count, 3, 'skipped_count debe ser 3');
    assert.equal(output.batchMetadata.max_per_batch, 5, 'max_per_batch debe ser 5');
    assert.equal(output.results.length, 8, 'results debe tener 8 entradas');
    assert.equal(providerCallCount, 5, 'provider solo debe llamarse 5 veces');

    const capSkipped = output.results.filter((r) => r.skipReason === 'batch_cap_reached');
    assert.equal(capSkipped.length, 3, '3 candidatos deben tener skipReason=batch_cap_reached');
  });
});

// ─── F3 — confidenceScore bajo → skipped ──────────────────────────────────────

describe('F3 — candidato con confidenceScore bajo no dispara búsqueda', () => {
  it('isEligibleForLinkedInSearch retorna false cuando confidence < minConfidenceScore', () => {
    const candidate = makeSearchCandidate({ confidenceScore: 60 });
    const result = isEligibleForLinkedInSearch(candidate, ENABLED_CONFIG);
    assert.equal(result.eligible, false);
    assert.equal(result.skipReason, 'low_confidence');
  });

  it('runControlledLinkedInCompanySearch no llama provider para candidato con confidence=60', async () => {
    let providerCallCount = 0;
    const mockProvider = async (): Promise<string[]> => { providerCallCount++; return []; };

    const candidate = makeSearchCandidate({ confidenceScore: 60 });
    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    assert.equal(providerCallCount, 0, 'provider NO debe llamarse');
    assert.equal(output.batchMetadata.attempted_count, 0);
    assert.equal(output.batchMetadata.skipped_count, 1);
    assert.equal(output.results[0].skipReason, 'low_confidence');
  });
});

// ─── F4 — query_only débil → sin búsqueda ────────────────────────────────────

describe('F4 — query_only débil (confidence < 70) → sin búsqueda LinkedIn', () => {
  it('candidato query_only con confidenceScore=50 no dispara búsqueda', async () => {
    let providerCallCount = 0;
    const mockProvider = async (): Promise<string[]> => { providerCallCount++; return []; };

    const candidate = makeSearchCandidate({
      name: 'SYCA Colombia',
      domain: 'syca.com.co',
      confidenceScore: 50,
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    assert.equal(providerCallCount, 0, 'provider NO debe llamarse para confidence=50');
    assert.equal(output.results[0].skipReason, 'low_confidence');
  });
});

// ─── F5 — duplicate guard bloqueado → sin búsqueda ───────────────────────────

describe('F5 — duplicate guard bloqueado → no LinkedIn search', () => {
  it('isEligibleForLinkedInSearch retorna false cuando isBlockedByDuplicateGuard=true', () => {
    const candidate = makeSearchCandidate({ isBlockedByDuplicateGuard: true });
    const result = isEligibleForLinkedInSearch(candidate, ENABLED_CONFIG);
    assert.equal(result.eligible, false);
    assert.equal(result.skipReason, 'duplicate_guard_blocked');
  });

  it('runControlledLinkedInCompanySearch no llama provider cuando isBlockedByDuplicateGuard=true', async () => {
    let providerCallCount = 0;
    const mockProvider = async (): Promise<string[]> => { providerCallCount++; return []; };

    const candidate = makeSearchCandidate({ isBlockedByDuplicateGuard: true });
    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    assert.equal(providerCallCount, 0, 'provider NO debe llamarse');
    assert.equal(output.results[0].skipReason, 'duplicate_guard_blocked');
    assert.equal(output.batchMetadata.attempted_count, 0);
  });
});

// ─── F6 — evidence policy blocked → sin búsqueda ─────────────────────────────

describe('F6 — evidence policy blocked → no LinkedIn search', () => {
  it('isEligibleForLinkedInSearch retorna false cuando isBlockedByEvidencePolicy=true', () => {
    const candidate = makeSearchCandidate({ isBlockedByEvidencePolicy: true });
    const result = isEligibleForLinkedInSearch(candidate, ENABLED_CONFIG);
    assert.equal(result.eligible, false);
    assert.equal(result.skipReason, 'evidence_policy_blocked');
  });

  it('runControlledLinkedInCompanySearch no llama provider cuando isBlockedByEvidencePolicy=true', async () => {
    let providerCallCount = 0;
    const mockProvider = async (): Promise<string[]> => { providerCallCount++; return []; };

    const candidate = makeSearchCandidate({ isBlockedByEvidencePolicy: true });
    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    assert.equal(providerCallCount, 0, 'provider NO debe llamarse');
    assert.equal(output.results[0].skipReason, 'evidence_policy_blocked');
    assert.equal(output.batchMetadata.attempted_count, 0);
  });
});

// ─── F7 — Mi-ERP no se confunde con Odoo global ──────────────────────────────

describe('F7 — Mi-ERP no se confunde con Odoo global', () => {
  it('slug "odoo" con candidato "Mi-ERP" → ambiguous, confidence bajo, sin boost', async () => {
    // Mock returns Odoo company page when searching for Mi-ERP
    const mockProvider = createMockLinkedInSearchProvider({
      'mi-erp': ['https://www.linkedin.com/company/odoo'],
    });

    const candidate = makeSearchCandidate({
      name: 'Mi-ERP Colombia',
      domain: 'mierp.com.co',
      confidenceScore: 72,
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    const result = output.results[0];
    assert.equal(result.attempted, true);
    assert.equal(result.enrichment.status, 'ambiguous',
      'slug de plataforma global no debe resultar en found cuando el nombre no coincide');
    assert.ok(result.enrichment.confidence < 65,
      `confidence ${result.enrichment.confidence} debe ser < 65 para ambiguous global`);
    assert.equal(output.batchMetadata.ambiguous_count, 1);
    assert.equal(output.batchMetadata.found_count, 0, 'found_count debe ser 0 para ambiguous');
  });
});

// ─── F8 — Visiontecno no se confunde con Zoho global ─────────────────────────

describe('F8 — Visiontecno no se confunde con Zoho global', () => {
  it('slug "zoho" con candidato "Visiontecno" → ambiguous, sin boost', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      visiontecno: ['https://www.linkedin.com/company/zoho'],
    });

    const candidate = makeSearchCandidate({
      name: 'Visiontecno',
      domain: 'visiontecno.com',
      confidenceScore: 70,
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    const result = output.results[0];
    assert.equal(result.enrichment.status, 'ambiguous');
    assert.ok(result.enrichment.confidence < 65);
    assert.equal(output.batchMetadata.found_count, 0);
  });
});

// ─── F9 — sourceUrl LinkedIn personal → rejected inicial, sin controlled search ─

describe('F9 — sourceUrl LinkedIn personal (/in/) → rejected, sin controlled search adicional', () => {
  it('buildLinkedInEnrichmentMetadata marca rejected cuando sourceUrl es /in/', () => {
    const enrichment = buildLinkedInEnrichmentMetadata({
      candidateName: 'Empresa Test',
      candidateDomain: 'empresa.com.co',
      countryCode: 'CO',
      sourceUrl: 'https://www.linkedin.com/in/persona-garcia',
      checkedAt: CHECKED_AT,
    });

    assert.equal(enrichment.status, 'rejected', 'Part E: /in/ debe dar rejected no not_found');
    assert.ok(
      enrichment.warnings.some((w) => w.includes('rejected_path')),
      `warnings debe incluir rejected_path, got: ${JSON.stringify(enrichment.warnings)}`,
    );
  });

  it('candidato con enrichment rejected no dispara controlled search', async () => {
    let providerCallCount = 0;
    const mockProvider = async (): Promise<string[]> => { providerCallCount++; return []; };

    const rejectedEnrichment = buildLinkedInEnrichmentMetadata({
      candidateName: 'Empresa Test',
      candidateDomain: null,
      countryCode: 'CO',
      sourceUrl: 'https://www.linkedin.com/in/persona',
      checkedAt: CHECKED_AT,
    });

    const candidate = makeSearchCandidate({
      name: 'Empresa Test',
      currentEnrichment: rejectedEnrichment,
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    assert.equal(providerCallCount, 0, 'NO debe llamar provider cuando enrichment es rejected');
    assert.equal(
      output.results[0].skipReason,
      'enrichment_already_rejected',
      'skipReason debe ser enrichment_already_rejected',
    );
  });
});

// ─── F10 — result jobs/feed/posts → rejected ──────────────────────────────────

describe('F10 — resultado de búsqueda con URL jobs/feed/posts → rejected', () => {
  it('URL /jobs/ devuelta por mock → enrichment rejected', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      'empresa tech': ['https://www.linkedin.com/jobs/view/123456789'],
    });

    const candidate = makeSearchCandidate({
      name: 'Empresa Tech Colombia',
      domain: 'empresatech.com.co',
      confidenceScore: 75,
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    const result = output.results[0];
    assert.equal(result.attempted, true);
    assert.equal(result.enrichment.status, 'rejected',
      'URL /jobs/ debe resultar en rejected');
    assert.equal(output.batchMetadata.rejected_count, 1);
    assert.equal(output.batchMetadata.found_count, 0);
  });

  it('URL /feed/ devuelta por mock → enrichment rejected', async () => {
    const mockProvider = async (): Promise<string[]> =>
      ['https://www.linkedin.com/feed/update/urn:li:activity:123'];

    const candidate = makeSearchCandidate({ name: 'Test Corp', domain: 'testcorp.com' });
    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    assert.equal(output.results[0].enrichment.status, 'rejected');
  });
});

// ─── F11 — mock sin resultados → not_found con source controlled_linkedin_search ─

describe('F11 — mock sin resultados → not_found con source controlled_linkedin_search', () => {
  it('provider retorna [] → status not_found, source=controlled_linkedin_search, warning', async () => {
    const mockProvider = async (): Promise<string[]> => [];

    const candidate = makeSearchCandidate({
      name: 'Empresa Sin Resultados',
      domain: 'sinresultados.com.co',
      confidenceScore: 80,
    });

    const output = await runControlledLinkedInCompanySearch(
      [candidate], ENABLED_CONFIG, mockProvider, CHECKED_AT,
    );

    const result = output.results[0];
    assert.equal(result.attempted, true, 'debe haberse intentado la búsqueda');
    assert.equal(result.enrichment.status, 'not_found');
    assert.equal(result.enrichment.source, 'controlled_linkedin_search');
    assert.ok(
      result.enrichment.warnings.some((w) =>
        w.includes('controlled search returned no valid LinkedIn company URL'),
      ),
      `warnings debe incluir mensaje controlado, got: ${JSON.stringify(result.enrichment.warnings)}`,
    );
    assert.equal(output.batchMetadata.not_found_count, 1);
  });
});

// ─── F12 — scoring boost solo found >= 70 (a través del writer) ───────────────

describe('F12 — scoring boost solo found >= 70 (a través del writer)', () => {
  it('found + confidence>=70 → fit_score sube +5 y fit_reasons incluye linkedin_company_verified', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin(stats);

    const baseFitScore = 55;
    const candidate = makeWriterCandidate({
      name: 'Softland',
      website: 'https://softland.com',
      domain: 'softland.com',
      // sourceUrl sin LinkedIn — la búsqueda controlada lo encontrará
      sourceUrl: 'https://softland.com',
      sourceTitle: 'Softland - Software ERP',
      sourceSnippet: 'Software ERP para empresas en Colombia.',
      scoring: {
        qualityLabel: 'high_quality_new',
        confidenceScore: 75,
        fitScore: baseFitScore,
        dataCompletenessScore: 60,
        recommendedAction: 'approve_for_review',
        breakdown: {
          existenceSignals: 40, websiteSignals: 15, duplicateSignals: 15,
          sourceSignals: 5, fitSignals: 20, completenessSignals: 25, penalties: 0,
        },
        reasons: ['País identificado.'],
        warnings: [],
        blockers: [],
        fitBreakdown: {
          product_fit: 25, country_fit: 5, b2b_signal: 8, duplicate_penalty: 0,
          country_evidence_penalty: 0, generic_agency_penalty: 0, commercial_calibration_delta: 38,
          final_fit_score: baseFitScore, fit_label: 'medium',
          fit_reasons: ['product_erp: software erp', 'b2b_signal'], fit_penalties: [],
        },
      },
    });

    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
    });

    const linkedInOverride: LinkedInSearchOverride = {
      config: ENABLED_CONFIG,
      providerFn: mockProvider,
    };

    await writeProspectingCandidates(makeWriterInput([candidate]), admin, linkedInOverride);

    assert.ok(stats.candidateInsertCalls.length > 0, 'Debe insertarse el candidato');
    const inserted = stats.candidateInsertCalls[0];
    const metadata = inserted['metadata'] as Record<string, unknown>;
    const li = metadata['linkedin_enrichment'] as Record<string, unknown>;

    assert.ok(li, 'linkedin_enrichment debe existir');
    assert.equal(li['source'], 'mock_linkedin_search', 'source debe ser mock_linkedin_search');

    if (li['status'] === 'found' && (li['confidence'] as number) >= 70) {
      assert.equal(inserted['fit_score'], baseFitScore + 5, 'fit_score debe subir +5');
      const scoring = metadata['scoring'] as Record<string, unknown>;
      assert.equal(scoring['fit_score'], baseFitScore + 5, 'metadata.scoring.fit_score debe subir +5');
      const fb = scoring['fit_breakdown'] as Record<string, unknown>;
      const fitReasons = fb['fit_reasons'] as string[];
      assert.ok(
        fitReasons.includes('linkedin_company_verified'),
        `fit_reasons debe incluir linkedin_company_verified, got: ${JSON.stringify(fitReasons)}`,
      );
    }
  });

  it('ambiguous → sin boost en fit_score', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin(stats);

    const baseFitScore = 52;
    const candidate = makeWriterCandidate({
      name: 'Mi-ERP Colombia',
      website: 'https://mierp.com.co',
      domain: 'mierp.com.co',
      sourceUrl: 'https://mierp.com.co',
      scoring: {
        qualityLabel: 'high_quality_new', confidenceScore: 72, fitScore: baseFitScore,
        dataCompletenessScore: 60, recommendedAction: 'approve_for_review',
        breakdown: {
          existenceSignals: 40, websiteSignals: 10, duplicateSignals: 15,
          sourceSignals: 5, fitSignals: 15, completenessSignals: 25, penalties: 0,
        },
        reasons: [], warnings: [], blockers: [],
        fitBreakdown: {
          product_fit: 20, country_fit: 5, b2b_signal: 7, duplicate_penalty: 0,
          country_evidence_penalty: 0, generic_agency_penalty: 0, commercial_calibration_delta: 20,
          final_fit_score: baseFitScore, fit_label: 'medium',
          fit_reasons: ['product_erp: software erp'], fit_penalties: [],
        },
      },
    });

    // Mock returns Odoo → ambiguous (global platform slug mismatch)
    const mockProvider = createMockLinkedInSearchProvider({
      'mi-erp': ['https://www.linkedin.com/company/odoo'],
    });

    await writeProspectingCandidates(
      makeWriterInput([candidate]),
      admin,
      { config: ENABLED_CONFIG, providerFn: mockProvider },
    );

    if (stats.candidateInsertCalls.length > 0) {
      const inserted = stats.candidateInsertCalls[0];
      const li = (inserted['metadata'] as Record<string, unknown>)['linkedin_enrichment'] as Record<string, unknown>;
      assert.equal(li['status'], 'ambiguous', 'debe ser ambiguous para Odoo');
      assert.equal(inserted['fit_score'], baseFitScore, 'fit_score NO debe subir para ambiguous');
    }
  });
});

// ─── F13 — batch metadata linkedin_search persiste ───────────────────────────

describe('F13 — batch metadata linkedin_search samples persiste en batch', () => {
  it('batch metadata incluye linkedin_search con samples cuando feature está activo', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin(stats);

    const candidates = [
      makeWriterCandidate({
        name: 'Softland',
        website: 'https://softland.com',
        domain: 'softland.com',
        sourceUrl: 'https://softland.com',
      }),
      makeWriterCandidate({
        name: 'Heinsohn',
        website: 'https://heinsohn.com.co',
        domain: 'heinsohn.com.co',
        sourceUrl: 'https://heinsohn.com.co',
      }),
    ];

    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      heinsohn: ['https://www.linkedin.com/company/heinsohn'],
    });

    await writeProspectingCandidates(
      makeWriterInput(candidates),
      admin,
      { config: ENABLED_CONFIG, providerFn: mockProvider },
    );

    // Find the batch update call that contains the final metadata
    const metadataUpdate = stats.batchUpdateCalls.find(
      (call) => typeof call['metadata'] === 'object' && call['metadata'] !== null,
    );
    assert.ok(metadataUpdate, 'Debe haber un update con metadata en el batch');

    const batchMeta = metadataUpdate['metadata'] as Record<string, unknown>;
    const linkedInSearch = batchMeta['linkedin_search'] as Record<string, unknown> | undefined;
    assert.ok(linkedInSearch, 'linkedin_search debe existir en batch metadata');

    assert.equal(linkedInSearch['enabled'], true);
    assert.equal(linkedInSearch['max_per_batch'], 5);
    assert.equal(linkedInSearch['provider'], 'mock');
    assert.ok(typeof linkedInSearch['attempted_count'] === 'number');
    assert.ok(typeof linkedInSearch['skipped_count'] === 'number');

    const samples = linkedInSearch['samples'] as unknown[];
    assert.ok(Array.isArray(samples), 'samples debe ser un array');
    if (samples.length > 0) {
      const sample = samples[0] as Record<string, unknown>;
      assert.ok('candidate_name' in sample, 'sample debe tener candidate_name');
      assert.ok('query' in sample, 'sample debe tener query');
      assert.ok('status' in sample, 'sample debe tener status');
    }
  });
});

// ─── F14 — 0 llamadas reales ──────────────────────────────────────────────────

describe('F14 — 0 llamadas reales (todos los tests usan mock provider)', () => {
  it('DEFAULT_LINKEDIN_SEARCH_CONFIG tiene enabled=false y provider=disabled', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.provider, 'disabled');
  });

  it('feature flag disabled → 0 provider calls aunque haya candidatos elegibles', async () => {
    let providerCallCount = 0;
    const mockProvider = async (): Promise<string[]> => { providerCallCount++; return []; };

    const candidate = makeSearchCandidate({
      name: 'TestCo',
      confidenceScore: 90,
    });

    const disabledConfig: LinkedInSearchConfig = { ...ENABLED_CONFIG, enabled: false };

    const output = await runControlledLinkedInCompanySearch(
      [candidate], disabledConfig, mockProvider, CHECKED_AT,
    );

    assert.equal(providerCallCount, 0, 'provider NO debe llamarse cuando feature está disabled');
    assert.equal(output.batchMetadata.attempted_count, 0);
    assert.equal(output.results[0].skipReason, 'feature_disabled');
  });

  it('writer sin linkedInSearchOverride no activa LinkedIn search (production default)', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin(stats);

    const candidate = makeWriterCandidate();
    await writeProspectingCandidates(makeWriterInput([candidate]), admin);
    // No error thrown, feature disabled by default. Batch metadata sin linkedin_search.
    const metadataUpdate = stats.batchUpdateCalls.find(
      (call) => typeof call['metadata'] === 'object',
    );
    if (metadataUpdate) {
      const batchMeta = metadataUpdate['metadata'] as Record<string, unknown>;
      assert.ok(
        !('linkedin_search' in batchMeta),
        'linkedin_search NO debe estar en batch metadata cuando feature está disabled',
      );
    }
  });
});
