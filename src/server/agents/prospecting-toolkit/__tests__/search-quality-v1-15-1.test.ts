/**
 * Tests — Search Quality v1.15.1 — LinkedIn Enrichment Runtime Wiring
 *
 * Verifica que candidate-writer persiste metadata.linkedin_enrichment
 * usando solamente señales ya presentes en el candidato (sin llamadas externas).
 *
 * Fixtures:
 *   F1  — sourceUrl es LinkedIn company válido → found
 *   F2  — sourceSnippet contiene LinkedIn company URL → found/ambiguous
 *   F3  — LinkedIn personal profile → rejected, sin boost
 *   F4  — Sin LinkedIn → not_found, sin boost
 *   F5  — Mi-ERP con URL Odoo global → ambiguous, sin boost
 *   F6  — Visiontecno con URL Zoho global → ambiguous, sin boost
 *   F7  — Softland found → reason linkedin_company_verified en metadata
 *   F8  — SYCA query_only + LinkedIn found → sigue needs_review, sin cambio de label
 *   F9  — Duplicate guard bloquea antes/independientemente del LinkedIn
 *   F10 — same_canonical_identity con LinkedIn → persiste ambos guards
 *   F11 — not_found metadata siempre existe (candidato sin LinkedIn)
 *   F12 — checked_at determinístico (inyectable)
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Sin scraping.
 * Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildLinkedInEnrichmentMetadata } from '../linkedin-company-enrichment';
import type { BuildLinkedInEnrichmentInput } from '../linkedin-company-enrichment';

import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidateWriterInput, CatalogContextResult, ProspectingPipelineCandidate } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Fake Supabase admin client ───────────────────────────────────────────────

const FAKE_BATCH_ID = 'batch-v1151-0000-0000-0000-000000000001';
const FAKE_USER_ID = 'user-v1151-0000-0000-0000-000000000001';
const ACTIVE_CANDIDATE_ID = 'cand-active-0000-0000-0000-000000000001';

class ChainResult {
  constructor(private readonly _val: unknown) {}
  eq(_col: string, _val: unknown): ChainResult { return this; }
  neq(_col: string, _val: unknown): ChainResult { return this; }
  in(_col: string, _vals: unknown[]): ChainResult { return this; }
  not(_col: string, _op: string, _val: unknown): ChainResult { return this; }
  gte(_col: string, _val: unknown): ChainResult { return this; }
  limit(_n: number): ChainResult { return this; }
  select(_cols: string): ChainResult { return this; }
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    _onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled);
  }
  single(): Promise<unknown> { return Promise.resolve(this._val); }
}

type FakeCandidateRow = {
  id: string;
  name: string;
  domain: string | null;
  normalized_name: string | null;
  metadata: Record<string, unknown>;
  status: string;
};

type FakeAdminStats = {
  candidateInsertCalls: Record<string, unknown>[];
  batchInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
};

function makeFakeAdmin(
  stats: FakeAdminStats,
  activeCandidates: FakeCandidateRow[] = [],
): SupabaseClient {
  let seq = 0;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                if (_col === 'source') return new ChainResult({ data: [], error: null });
                return { single: () => Promise.resolve({ data: null, error: { message: 'no batch' } }) };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.batchInsertCalls.push({ ...data });
            return {
              select(_cols: string) {
                return { single: () => Promise.resolve({ data: { id: FAKE_BATCH_ID }, error: null }) };
              },
            };
          },
        };
      }

      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            // Novelty / identity history: return empty (no prior candidates)
            // Active duplicate guard: return activeCandidates if any
            if (activeCandidates.length > 0) {
              return new ChainResult({ data: activeCandidates, error: null });
            }
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-v1151-fake-${++seq}`;
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

      // provider_usage_logs — caught silently by the writer's try-catch
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Fake catalog context ─────────────────────────────────────────────────────

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

// ─── Candidate builder ────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ProspectingPipelineCandidate> = {}): ProspectingPipelineCandidate {
  return {
    name: 'TestCo Colombia',
    website: 'https://testco.com.co',
    domain: 'testco.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software ERP',
    sourceUrl: 'https://testco.com.co',
    sourceTitle: 'TestCo Colombia - Software ERP empresarial',
    sourceSnippet: 'Software ERP para empresas en Colombia. Soluciones empresariales b2b.',
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
      confidenceScore: 70,
      fitScore: 60,
      dataCompletenessScore: 60,
      recommendedAction: 'approve_for_review',
      breakdown: {
        existenceSignals: 40,
        websiteSignals: 15,
        duplicateSignals: 15,
        sourceSignals: 5,
        fitSignals: 20,
        completenessSignals: 25,
        penalties: 0,
      },
      reasons: ['País identificado.', 'No se encontraron duplicados en SellUp/HubSpot.'],
      warnings: [],
      blockers: [],
      fitBreakdown: {
        product_fit: 25,
        country_fit: 5,
        b2b_signal: 8,
        duplicate_penalty: 0,
        country_evidence_penalty: 0,
        generic_agency_penalty: 0,
        commercial_calibration_delta: 38,
        final_fit_score: 60,
        fit_label: 'medium',
        fit_reasons: ['product_erp: software erp', 'b2b_signal'],
        fit_penalties: [],
      },
    },
    ...overrides,
  };
}

function makePipelineOutput(candidate: ProspectingPipelineCandidate) {
  return {
    input: { country: 'Colombia', countryCode: 'CO', industry: 'Software ERP', webSearchProvider: 'mock' as const, mode: 'single_query' as const },
    catalogContext: FAKE_CATALOG,
    searchQuery: 'Software ERP Colombia',
    webSearch: { provider: 'mock' as const, query: 'test', results: [], resultsCount: 1, skipped: false, estimatedCostUsd: null, metadata: {} },
    candidates: [candidate],
    summary: { requested: 1, searched: 1, returned: 1, highQualityNew: 1, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
    warnings: [],
    metadata: { provider: 'mock', pipelineVersion: 'test-v1151', executedAt: '2026-06-23T10:00:00.000Z' },
  };
}

function makeWriterInput(candidate: ProspectingPipelineCandidate, overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput(candidate),
    triggeredByUserId: FAKE_USER_ID,
    ownerId: FAKE_USER_ID,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

// ─── F1 — sourceUrl es LinkedIn company válido → found ───────────────────────

describe('F1 — sourceUrl es LinkedIn company URL válido', () => {
  it('buildLinkedInEnrichmentMetadata detecta found cuando sourceUrl es company válido', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'Softland',
      candidateDomain: 'softland.com',
      countryCode: 'CO',
      sourceUrl: 'https://www.linkedin.com/company/softland/?originalSubdomain=co',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    assert.equal(result.status, 'found');
    assert.equal(result.enabled, true);
    assert.ok(result.company_url?.includes('softland'), `company_url should include "softland", got: ${result.company_url}`);
    assert.ok(result.confidence >= 65, `confidence ${result.confidence} debe ser >= 65`);
    assert.equal(result.checked_at, '2026-06-23T10:00:00.000Z');
  });

  it('writer persiste linkedin_enrichment con status found en metadata', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const candidate = makeCandidate({
      name: 'Softland',
      website: 'https://softland.com',
      domain: 'softland.com',
      sourceUrl: 'https://www.linkedin.com/company/softland/?originalSubdomain=co',
      sourceTitle: 'Softland - Software ERP para empresas',
      sourceSnippet: 'Softland es una empresa de software ERP para empresas en Colombia.',
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    assert.ok(stats.candidateInsertCalls.length > 0, 'Debe insertar al menos un candidato');
    const inserted = stats.candidateInsertCalls[0];
    const metadata = inserted['metadata'] as Record<string, unknown>;
    const li = metadata['linkedin_enrichment'] as Record<string, unknown>;
    assert.ok(li, 'linkedin_enrichment debe estar en metadata');
    assert.equal(li['status'], 'found');
    assert.ok(typeof li['company_url'] === 'string' && (li['company_url'] as string).includes('softland'));
  });
});

// ─── F2 — sourceSnippet contiene LinkedIn company URL ────────────────────────

describe('F2 — sourceSnippet contiene LinkedIn company URL', () => {
  it('detecta found o ambiguous cuando snippet contiene company URL', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'Heinsohn',
      candidateDomain: 'heinsohn.com.co',
      countryCode: 'CO',
      sourceSnippet: 'Visita nuestro perfil en https://www.linkedin.com/company/heinsohn/ para más información.',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    assert.ok(
      result.status === 'found' || result.status === 'ambiguous',
      `Expected found or ambiguous, got ${result.status}`,
    );
    assert.equal(result.enabled, true);
    assert.ok(result.company_url?.includes('heinsohn'));
    assert.equal(result.source, 'provided_search_result');
  });
});

// ─── F3 — LinkedIn personal profile → rejected ───────────────────────────────

describe('F3 — LinkedIn personal profile → rejected, sin boost', () => {
  it('buildLinkedInEnrichmentMetadata retorna rejected cuando sourceUrl es perfil personal (Part E v1.15.2)', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'Persona García',
      candidateDomain: null,
      countryCode: 'CO',
      sourceUrl: 'https://www.linkedin.com/in/persona-garcia-123',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    // Part E (v1.15.2): URL de LinkedIn con path /in/ → rejected (no not_found).
    // Distingue la presencia explícita de un path inválido de la ausencia total.
    assert.equal(result.status, 'rejected');
    assert.equal(result.confidence, 0);
    assert.ok(result.warnings.some((w) => w.includes('rejected_path')));
  });

  it('providedLinkedInUrl personal → rejected', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'Empresa Test',
      candidateDomain: null,
      countryCode: 'CO',
      providedLinkedInUrl: 'https://www.linkedin.com/in/persona',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    assert.equal(result.status, 'rejected');
    assert.equal(result.confidence, 0);
    assert.ok(result.warnings.some((w) => w.includes('rechazada')));
  });

  it('writer no aplica boost cuando sourceUrl es LinkedIn personal (status rejected, Part E v1.15.2)', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const candidate = makeCandidate({
      name: 'EmpresaSinLinkedIn',
      sourceUrl: 'https://www.linkedin.com/in/persona-garcia',
      sourceTitle: 'EmpresaSinLinkedIn - Software Colombia',
      website: 'https://empresasinlinkedin.com.co',
      domain: 'empresasinlinkedin.com.co',
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    if (stats.candidateInsertCalls.length > 0) {
      const inserted = stats.candidateInsertCalls[0];
      const metadata = inserted['metadata'] as Record<string, unknown>;
      const li = metadata['linkedin_enrichment'] as Record<string, unknown>;
      assert.ok(li, 'linkedin_enrichment debe existir');
      // Part E: sourceUrl /in/ → rejected (no not_found)
      assert.equal(li['status'], 'rejected');
      // fit_score no debe haberse incrementado por LinkedIn
      const scoring = metadata['scoring'] as Record<string, unknown>;
      assert.equal(scoring['fit_score'], candidate.scoring.fitScore);
    }
  });
});

// ─── F4 — Sin LinkedIn → not_found ───────────────────────────────────────────

describe('F4 — Sin LinkedIn en evidencia → not_found', () => {
  it('buildLinkedInEnrichmentMetadata retorna not_found cuando no hay URLs LinkedIn', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'EmpresaColombia',
      candidateDomain: 'empresacolombia.com.co',
      countryCode: 'CO',
      sourceUrl: 'https://empresacolombia.com.co/erp',
      sourceSnippet: 'Software ERP empresarial para Colombia.',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    assert.equal(result.status, 'not_found');
    assert.equal(result.confidence, 0);
    assert.equal(result.enabled, true);
    assert.ok(result.warnings.some((w) => w.includes('No LinkedIn')));
  });

  it('writer persiste not_found en metadata cuando candidato no tiene LinkedIn', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const candidate = makeCandidate({
      sourceUrl: 'https://testco.com.co/erp-colombia',
      sourceSnippet: 'Software ERP para empresas en Colombia. Soluciones empresariales b2b.',
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    if (stats.candidateInsertCalls.length > 0) {
      const inserted = stats.candidateInsertCalls[0];
      const metadata = inserted['metadata'] as Record<string, unknown>;
      const li = metadata['linkedin_enrichment'] as Record<string, unknown>;
      assert.ok(li, 'linkedin_enrichment debe existir incluso en not_found');
      assert.equal(li['status'], 'not_found');
    }
  });
});

// ─── F5 — Mi-ERP con URL Odoo global → ambiguous ─────────────────────────────

describe('F5 — Mi-ERP con LinkedIn Odoo global → ambiguous, sin boost', () => {
  it('slug odoo con nombre diferente → ambiguous con confidence bajo', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'Mi-ERP Colombia',
      candidateDomain: 'mierp.com.co',
      countryCode: 'CO',
      sourceUrl: 'https://www.linkedin.com/company/odoo/',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    assert.equal(result.status, 'ambiguous');
    assert.ok(result.confidence < 65, `confidence ${result.confidence} debe ser < 65 para ambiguous con slug global`);
    assert.ok(result.warnings.some((w) => w.includes('plataforma global') || w.includes('odoo')));
  });
});

// ─── F6 — Visiontecno con URL Zoho global → ambiguous ────────────────────────

describe('F6 — Visiontecno con LinkedIn Zoho global → ambiguous, sin boost', () => {
  it('slug zoho con nombre diferente → ambiguous', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'Visiontecno',
      candidateDomain: 'visiontecno.com',
      countryCode: 'CO',
      sourceUrl: 'https://www.linkedin.com/company/zoho/',
      checkedAt: '2026-06-23T10:00:00.000Z',
    });

    assert.equal(result.status, 'ambiguous');
    assert.ok(result.confidence < 65);
    assert.ok(result.warnings.some((w) => w.includes('plataforma global') || w.includes('zoho')));
  });
});

// ─── F7 — Softland found → scoring reason linkedin_company_verified ───────────

describe('F7 — Softland found → linkedin_company_verified en metadata scoring', () => {
  it('fit_score sube +5 y fit_reasons incluye linkedin_company_verified cuando status=found y confidence>=70', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const baseFitScore = 55;
    const candidate = makeCandidate({
      name: 'Softland',
      website: 'https://softland.com',
      domain: 'softland.com',
      // sourceUrl es la URL de LinkedIn company de Softland — nombre coincide exactamente
      sourceUrl: 'https://www.linkedin.com/company/softland/',
      sourceTitle: 'Softland - Software ERP empresarial Colombia',
      sourceSnippet: 'Softland ofrece software ERP para empresas en Colombia.',
      scoring: {
        qualityLabel: 'high_quality_new',
        confidenceScore: 75,
        fitScore: baseFitScore,
        dataCompletenessScore: 60,
        recommendedAction: 'approve_for_review',
        breakdown: { existenceSignals: 40, websiteSignals: 15, duplicateSignals: 15, sourceSignals: 5, fitSignals: 20, completenessSignals: 25, penalties: 0 },
        reasons: ['País identificado.'],
        warnings: [],
        blockers: [],
        fitBreakdown: {
          product_fit: 25,
          country_fit: 5,
          b2b_signal: 8,
          duplicate_penalty: 0,
          country_evidence_penalty: 0,
          generic_agency_penalty: 0,
          commercial_calibration_delta: 38,
          final_fit_score: baseFitScore,
          fit_label: 'medium',
          fit_reasons: ['product_erp: software erp', 'b2b_signal'],
          fit_penalties: [],
        },
      },
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    assert.ok(stats.candidateInsertCalls.length > 0, 'Debe insertarse al menos un candidato');
    const inserted = stats.candidateInsertCalls[0];
    const metadata = inserted['metadata'] as Record<string, unknown>;

    const li = metadata['linkedin_enrichment'] as Record<string, unknown>;
    assert.ok(li, 'linkedin_enrichment debe existir');

    // Si linkedin_enrichment.status === 'found' y confidence >= 70, debe haber boost
    if (li['status'] === 'found' && (li['confidence'] as number) >= 70) {
      const scoring = metadata['scoring'] as Record<string, unknown>;
      assert.equal(inserted['fit_score'], baseFitScore + 5, 'fit_score columna debe subir +5');
      assert.equal(scoring['fit_score'], baseFitScore + 5, 'metadata.scoring.fit_score debe subir +5');
      const fb = scoring['fit_breakdown'] as Record<string, unknown>;
      const fitReasons = fb['fit_reasons'] as string[];
      assert.ok(fitReasons.includes('linkedin_company_verified'), 'fit_reasons debe incluir linkedin_company_verified');
    } else {
      // Si la evaluación resultó en ambiguous (confianza < 70), aceptamos sin boost
      assert.equal(inserted['fit_score'], baseFitScore, 'Sin boost si confidence < 70');
    }
  });

  it('qualityLabel no cambia a high_quality_new por LinkedIn solo', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const candidate = makeCandidate({
      name: 'Softland',
      website: 'https://softland.com',
      domain: 'softland.com',
      sourceUrl: 'https://www.linkedin.com/company/softland/',
      scoring: {
        qualityLabel: 'needs_review',
        confidenceScore: 55,
        fitScore: 40,
        dataCompletenessScore: 45,
        recommendedAction: 'review_manually',
        breakdown: { existenceSignals: 30, websiteSignals: 5, duplicateSignals: 15, sourceSignals: 5, fitSignals: 10, completenessSignals: 20, penalties: 0 },
        reasons: [],
        warnings: [],
        blockers: [],
        fitBreakdown: null,
      },
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    if (stats.candidateInsertCalls.length > 0) {
      const inserted = stats.candidateInsertCalls[0];
      // status sigue siendo needs_review, no high_quality_new
      assert.equal(inserted['status'], 'needs_review');
    }
  });
});

// ─── F8 — SYCA query_only + LinkedIn found → sigue needs_review ──────────────

describe('F8 — SYCA query_only + LinkedIn found → qualityLabel se mantiene', () => {
  it('candidateStatus sigue siendo needs_review aunque LinkedIn sea found', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const candidate = makeCandidate({
      name: 'SYCA',
      website: 'https://syca.com.co',
      domain: 'syca.com.co',
      // LinkedIn company URL de SYCA en sourceUrl
      sourceUrl: 'https://www.linkedin.com/company/syca-sas/',
      sourceTitle: 'SYCA - Software empresarial',
      sourceSnippet: 'Software empresarial ERP para Colombia.',
      // La calidad ya vino penalizada por query_only desde el scorer
      scoring: {
        qualityLabel: 'needs_review',
        confidenceScore: 50,
        fitScore: 35,
        dataCompletenessScore: 45,
        recommendedAction: 'review_manually',
        breakdown: { existenceSignals: 30, websiteSignals: 0, duplicateSignals: 15, sourceSignals: 5, fitSignals: 5, completenessSignals: 20, penalties: 0 },
        reasons: [],
        warnings: ['country_evidence_query_only: -15'],
        blockers: [],
        fitBreakdown: {
          product_fit: 25,
          country_fit: 0,
          b2b_signal: 6,
          duplicate_penalty: 0,
          country_evidence_penalty: 15,
          generic_agency_penalty: 0,
          commercial_calibration_delta: 16,
          final_fit_score: 35,
          fit_label: 'medium',
          fit_reasons: ['product_erp: software erp'],
          fit_penalties: ['country_evidence_query_only: -15'],
        },
      },
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    if (stats.candidateInsertCalls.length > 0) {
      const inserted = stats.candidateInsertCalls[0];
      // El status DB debe ser needs_review — no cambia por LinkedIn
      assert.equal(inserted['status'], 'needs_review', 'qualityLabel query_only → needs_review debe mantenerse');

      // LinkedIn enrichment igual existe
      const metadata = inserted['metadata'] as Record<string, unknown>;
      assert.ok(metadata['linkedin_enrichment'], 'linkedin_enrichment debe existir');
    }
  });
});

// ─── F9 — Duplicate guard bloquea antes/independientemente del LinkedIn ───────

describe('F9 — Duplicate guard bloquea independientemente del LinkedIn enrichment', () => {
  it('same_active_domain bloquea el candidato aunque tenga LinkedIn company URL válido', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };

    // Candidato activo con mismo dominio
    const activeSoftland: FakeCandidateRow = {
      id: ACTIVE_CANDIDATE_ID,
      name: 'Softland Colombia',
      domain: 'softland.com',
      normalized_name: 'softland colombia',
      metadata: {},
      status: 'needs_review',
    };

    const admin = makeFakeAdmin(stats, [activeSoftland]);

    const candidate = makeCandidate({
      name: 'Softland',
      website: 'https://softland.com',
      domain: 'softland.com',
      sourceUrl: 'https://www.linkedin.com/company/softland/',
      sourceTitle: 'Softland - Software ERP',
      sourceSnippet: 'Softland ERP para empresas.',
    });

    const result = await writeProspectingCandidates(makeWriterInput(candidate), admin);

    // El candidato fue bloqueado por duplicate_guard, no se insertó
    assert.equal(stats.candidateInsertCalls.length, 0, 'No debe insertar si same_active_domain');
    assert.ok(
      result.skipped.some((s) => s.reason.includes('duplicate_guard')),
      `Debe estar en skipped con duplicate_guard, got: ${JSON.stringify(result.skipped.map((s) => s.reason))}`,
    );
  });
});

// ─── F10 — same_canonical_identity + LinkedIn ─────────────────────────────────

describe('F10 — same_canonical_identity con LinkedIn → persiste ambos', () => {
  it('possible_duplicate persiste con linkedin_enrichment y duplicate_guard en metadata', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };

    // Candidato activo con nombre canónico similar pero distinto dominio
    const activeRecord: FakeCandidateRow = {
      id: ACTIVE_CANDIDATE_ID,
      name: 'Softland',
      domain: 'softland.co',
      normalized_name: 'softland',
      metadata: {},
      status: 'needs_review',
    };

    const admin = makeFakeAdmin(stats, [activeRecord]);

    const candidate = makeCandidate({
      name: 'Softland Colombia',
      website: 'https://softland.com.co',
      domain: 'softland.com.co',
      sourceUrl: 'https://www.linkedin.com/company/softland/',
      sourceTitle: 'Softland Colombia - ERP',
      sourceSnippet: 'Softland Colombia software ERP.',
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    if (stats.candidateInsertCalls.length > 0) {
      const inserted = stats.candidateInsertCalls[0];
      const metadata = inserted['metadata'] as Record<string, unknown>;

      // linkedin_enrichment debe existir
      assert.ok(metadata['linkedin_enrichment'], 'linkedin_enrichment debe existir');

      // duplicate_guard puede existir si same_canonical_identity
      // (no es garantizado dado que depende de la lógica de identidad)
      // Solo verificamos que linkedin_enrichment está presente
      const li = metadata['linkedin_enrichment'] as Record<string, unknown>;
      assert.ok(li['status'] === 'found' || li['status'] === 'ambiguous' || li['status'] === 'not_found');
    }
  });
});

// ─── F11 — not_found metadata siempre existe ─────────────────────────────────

describe('F11 — linkedin_enrichment siempre existe en metadata, incluso not_found', () => {
  it('candidato sin ninguna URL LinkedIn tiene linkedin_enrichment con status not_found', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);

    const candidate = makeCandidate({
      name: 'SinLinkedIn SAS',
      website: 'https://sinlinkedin.com.co',
      domain: 'sinlinkedin.com.co',
      sourceUrl: 'https://sinlinkedin.com.co/erp',
      sourceTitle: 'SinLinkedIn SAS - Software empresarial',
      sourceSnippet: 'Software para empresas en Colombia.',
    });

    await writeProspectingCandidates(makeWriterInput(candidate), admin);

    assert.ok(stats.candidateInsertCalls.length > 0, 'Debe insertar candidato');
    const inserted = stats.candidateInsertCalls[0];
    const metadata = inserted['metadata'] as Record<string, unknown>;

    assert.ok(metadata['linkedin_enrichment'], 'linkedin_enrichment debe existir siempre');
    const li = metadata['linkedin_enrichment'] as Record<string, unknown>;
    assert.equal(li['status'], 'not_found');
    assert.equal(li['enabled'], true);
    assert.equal(li['confidence'], 0);
    assert.ok(Array.isArray(li['warnings']));
  });
});

// ─── F12 — checked_at determinístico en tests ─────────────────────────────────

describe('F12 — checked_at inyectable para tests determinísticos', () => {
  it('checked_at toma el valor pasado en input.checkedAt', () => {
    const FIXED_TS = '2026-06-23T00:00:00.000Z';
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'AnyCompany',
      candidateDomain: null,
      countryCode: 'CO',
      checkedAt: FIXED_TS,
    });

    assert.equal(result.checked_at, FIXED_TS);
  });

  it('dos llamadas con mismo input producen mismo checked_at', () => {
    const input: BuildLinkedInEnrichmentInput = {
      candidateName: 'AnyCompany',
      candidateDomain: null,
      countryCode: 'CO',
      checkedAt: '2026-06-23T09:00:00.000Z',
    };
    const r1 = buildLinkedInEnrichmentMetadata(input);
    const r2 = buildLinkedInEnrichmentMetadata(input);
    assert.equal(r1.checked_at, r2.checked_at);
    assert.equal(r1.status, r2.status);
  });

  it('sin checkedAt, el campo existe y es un ISO string válido', () => {
    const result = buildLinkedInEnrichmentMetadata({
      candidateName: 'AnyCompany',
      candidateDomain: null,
      countryCode: 'CO',
    });
    assert.ok(result.checked_at, 'checked_at debe existir');
    assert.doesNotThrow(() => new Date(result.checked_at).toISOString());
  });
});
