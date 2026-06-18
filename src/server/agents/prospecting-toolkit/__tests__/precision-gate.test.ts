/**
 * Tests — Precision Gate, Country Compatibility, Generic Name Gate,
 * Target Cap, Query Cleanup (Hito 16AB.43.27)
 *
 * Fixture A — Target cap: writer receives targetPersistibleCandidates from input
 * Fixture B — Country compatibility: .mx/.cl bloqueados para CO
 * Fixture C — Country compatibility: dominios CO + paths CO permitidos
 * Fixture D — Generic name gate: "Nosotros", "Quiénes Somos", "Aliado Élite" bloqueados
 * Fixture E — Legitimate company names pass through
 * Fixture F — Query cleanup: R3/R4 sin "nosotros"/"contacto"
 * Fixture G — Adaptive metadata reconciliation post-writer
 * Fixture H — countryCompatibilityRankWeight ordering
 *
 * Uses Node.js built-in test runner. No Supabase, Tavily, or real I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCountryCompatibility,
  countryCompatibilityRankWeight,
} from '../country-compatibility';

import { buildCanonicalCompanyIdentity } from '../canonical-company-identity';

import { runIncrementalProspectingSearch } from '../incremental-search';
import type { IncrementalSearchInput } from '../incremental-search-types';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineInput,
  CatalogContextResult,
  CandidateWriterInput,
  CandidateWriterOutput,
} from '../types';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const FAKE_CATALOG: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

function makeCandidate(name: string, domain: string): ProspectingPipelineOutput['candidates'][number] {
  return {
    name,
    website: `https://${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourceUrl: 'https://example.com',
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title_prefix',
    websiteVerification: null,
    duplicateCheck: null,
    scoring: {
      confidenceScore: 60,
      fitScore: 50,
      dataCompletenessScore: 50,
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      breakdown: {
        existenceSignals: 0,
        websiteSignals: 0,
        duplicateSignals: 0,
        sourceSignals: 0,
        fitSignals: 0,
        completenessSignals: 0,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
    searchTrace: null,
    llmEvaluation: null,
  };
}

function fakePipelineOutput(count: number): ProspectingPipelineOutput {
  const candidates = Array.from({ length: count }, (_, i) =>
    makeCandidate(`Empresa Legítima ${i + 1}`, `empresa${i + 1}.com.co`),
  );

  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      mode: 'multi_query',
    },
    catalogContext: FAKE_CATALOG,
    searchQuery: 'test',
    webSearch: {
      provider: 'mock',
      query: 'test',
      results: [],
      resultsCount: count,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: 10,
      searched: count,
      returned: count,
      highQualityNew: 0,
      needsReview: count,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: { provider: 'mock', pipelineVersion: 'test', executedAt: new Date().toISOString() },
  };
}

// ── Fixture A — Target cap ─────────────────────────────────────────────────────

describe('Fixture A — Target cap', () => {
  it('17 pipeline candidates with target 10 → writer receives targetPersistibleCandidates=10', async () => {
    let capturedTarget: number | null | undefined = undefined;

    const fakePipeline = async (_input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> =>
      fakePipelineOutput(17);

    const fakeWriter = async (writerInput: CandidateWriterInput): Promise<CandidateWriterOutput> => {
      capturedTarget = writerInput.targetPersistibleCandidates;
      return {
        dryRun: false,
        batchId: 'fake-batch-id',
        candidatesCreated: 10,
        candidatesSkipped: 7,
        createdCandidateIds: Array.from({ length: 10 }, (_, i) => `id-${i}`),
        skipped: [],
        status: 'success',
        errors: [],
      };
    };

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        dryRun: false,
        maxRounds: 1,
        targetPersistibleCandidates: 10,
      },
      fakeWriter,
      fakePipeline,
    );

    assert.notEqual(capturedTarget, undefined, 'Writer must have been called');
    assert.equal(capturedTarget, 10, 'Writer must receive targetPersistibleCandidates=10');
  });

  it('8 pipeline candidates with target 10 → writer still receives targetPersistibleCandidates=10', async () => {
    let capturedTarget: number | null | undefined = undefined;

    const fakePipeline = async (_input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> =>
      fakePipelineOutput(8);

    const fakeWriter = async (writerInput: CandidateWriterInput): Promise<CandidateWriterOutput> => {
      capturedTarget = writerInput.targetPersistibleCandidates;
      return {
        dryRun: false,
        batchId: 'fake-batch-id',
        candidatesCreated: 8,
        candidatesSkipped: 0,
        createdCandidateIds: Array.from({ length: 8 }, (_, i) => `id-${i}`),
        skipped: [],
        status: 'success',
        errors: [],
      };
    };

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        dryRun: false,
        maxRounds: 1,
        targetPersistibleCandidates: 10,
      },
      fakeWriter,
      fakePipeline,
    );

    assert.notEqual(capturedTarget, undefined, 'Writer must have been called');
    assert.equal(capturedTarget, 10);
  });

  it('no targetPersistibleCandidates provided → writer receives default 10', async () => {
    let capturedTarget: number | null | undefined = undefined;

    const fakePipeline = async (_input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> =>
      fakePipelineOutput(3);

    const fakeWriter = async (writerInput: CandidateWriterInput): Promise<CandidateWriterOutput> => {
      capturedTarget = writerInput.targetPersistibleCandidates;
      return {
        dryRun: false,
        batchId: 'fake-batch-id',
        candidatesCreated: 3,
        candidatesSkipped: 0,
        createdCandidateIds: ['id1', 'id2', 'id3'],
        skipped: [],
        status: 'success',
        errors: [],
      };
    };

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        dryRun: false,
        maxRounds: 1,
      },
      fakeWriter,
      fakePipeline,
    );

    assert.notEqual(capturedTarget, undefined, 'Writer must have been called');
    assert.equal(capturedTarget, 10, 'Default target must be 10');
  });
});

// ── Fixture B — Country incompatible URLs blocked for CO ──────────────────────

describe('Fixture B — Country incompatible URLs for Colombia', () => {
  const INCOMPATIBLE_CASES: Array<{ url: string; label: string }> = [
    { url: 'https://integradores.com.mx', label: '.com.mx TLD' },
    { url: 'https://integrador-technology.mx', label: '.mx TLD' },
    { url: 'https://cosmoconsult.com/cl/consultoria', label: '.com with /cl/ path' },
    { url: 'https://softwareempresa.cl', label: '.cl TLD' },
    { url: 'https://empresa.com.br', label: '.com.br TLD' },
    { url: 'https://proveedor.com.pe', label: '.com.pe TLD' },
    { url: 'https://solucion.com.ar', label: '.com.ar TLD' },
  ];

  for (const { url, label } of INCOMPATIBLE_CASES) {
    it(`blocks ${label}: ${url}`, () => {
      const result = evaluateCountryCompatibility(url, 'CO');
      assert.equal(result.compatible, false, `Expected incompatible for ${url}, got reason: ${result.reason}`);
    });
  }
});

// ── Fixture C — Compatible URLs for Colombia ──────────────────────────────────

describe('Fixture C — Compatible URLs for Colombia', () => {
  const COMPATIBLE_CASES: Array<{ url: string; expectedConfidence: 'high' | 'medium' | 'low'; label: string }> = [
    { url: 'https://protiviti.com/co-es/servicios', expectedConfidence: 'high', label: 'global .com with /co-es/ path' },
    { url: 'https://internexa.com/es-co', expectedConfidence: 'high', label: 'global .com with /es-co path' },
    { url: 'https://indragroup.com/servicios/colombia', expectedConfidence: 'high', label: 'global .com with /colombia path' },
    { url: 'https://contarerp.com.co', expectedConfidence: 'high', label: '.com.co native TLD' },
    { url: 'https://bielcom.com.co', expectedConfidence: 'high', label: '.com.co TLD' },
    { url: 'https://datatecnologia.com.co', expectedConfidence: 'high', label: '.com.co TLD' },
    { url: 'https://empresa.co', expectedConfidence: 'high', label: '.co TLD' },
    { url: 'https://globaltech.com', expectedConfidence: 'medium', label: 'neutral global domain' },
  ];

  for (const { url, expectedConfidence, label } of COMPATIBLE_CASES) {
    it(`allows ${label}: ${url}`, () => {
      const result = evaluateCountryCompatibility(url, 'CO');
      assert.equal(result.compatible, true, `Expected compatible for ${url}, got reason: ${result.reason}`);
      assert.equal(
        result.confidence,
        expectedConfidence,
        `Expected confidence=${expectedConfidence} for ${url}, got ${result.confidence}`,
      );
    });
  }
});

// ── Fixture D — Generic name gate ─────────────────────────────────────────────

describe('Fixture D — Generic name gate blocks page titles and commercial labels', () => {
  const BLOCKED_NAMES = [
    'Nosotros',
    'nosotros',
    'NOSOTROS',
    'Quiénes Somos',
    'quienes somos',
    'Quienes Somos',
    'Sobre nosotros',
    'Acerca de nosotros',
    'Aliado Élite',
    'Aliado Elite',
    'aliado élite',
    'Partner tecnológico',
    'partner tecnologico',
    'Proveedor especializado',
    'Soluciones empresariales',
    'Servicios tecnológicos',
    'servicios tecnologicos',
  ];

  for (const name of BLOCKED_NAMES) {
    it(`blocks "${name}" as company name`, () => {
      const result = buildCanonicalCompanyIdentity(name);
      assert.equal(
        result.isNonCompanyPhrase,
        true,
        `"${name}" must be detected as non-company phrase, got: identityKey="${result.identityKey}"`,
      );
    });
  }
});

// ── Fixture E — Legitimate company names pass through ─────────────────────────

describe('Fixture E — Legitimate company names are not blocked', () => {
  const VALID_NAMES = [
    'ITS Colombia',
    'Tech Colombia Industrial',
    'Data Tecnologia',
    'Bielcom',
    'Nearbridge Global',
    'Protiviti Colombia',
    'Siesa Enterprise',
    'Internexa',
    'Omnicon',
    'Solutek Colombia',
    'Datatecnologia',
  ];

  for (const name of VALID_NAMES) {
    it(`allows "${name}" as company name`, () => {
      const result = buildCanonicalCompanyIdentity(name);
      assert.equal(
        result.isNonCompanyPhrase,
        false,
        `"${name}" must NOT be blocked, but got: nonCompanyReason="${result.nonCompanyReason}"`,
      );
      assert.ok(result.identityKey.length > 0, `identityKey must not be empty for "${name}"`);
    });
  }
});

// ── Fixture F — Query cleanup: R3/R4 no contienen "nosotros"/"contacto" ────────

describe('Fixture F — Query cleanup: R3/R4 templates are free of "nosotros"/"contacto"', () => {
  it('R3/R4 query arrays contain no "nosotros" or standalone "contacto"', async () => {
    const queriesByRound: Record<number, string[]> = {};
    let roundNumber = 0;

    const trackingPipeline = async (pipelineInput: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> => {
      roundNumber++;
      const extended = pipelineInput as ProspectingPipelineInput & { queryOverrides?: string[] };
      queriesByRound[roundNumber] = extended.queryOverrides ?? [];
      return {
        input: { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', mode: 'multi_query' },
        catalogContext: FAKE_CATALOG,
        searchQuery: 'test',
        webSearch: { provider: 'mock', query: 'test', results: [], resultsCount: 2, skipped: false, estimatedCostUsd: null, metadata: {} },
        candidates: [],
        summary: { requested: 10, searched: 2, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
        warnings: [],
        metadata: {},
      };
    };

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        dryRun: true,
        maxRounds: 4,
        targetPersistibleCandidates: 999,
        minUsefulCandidates: 999,
      },
      undefined,
      trackingPipeline,
    );

    assert.ok(roundNumber >= 3, `Expected at least 3 rounds, got ${roundNumber}`);

    for (const round of [3, 4]) {
      const queries = queriesByRound[round];
      if (!queries || queries.length === 0) continue;

      const text = queries.join(' ').toLowerCase();
      assert.ok(
        !text.includes('nosotros'),
        `R${round} queries must not contain "nosotros": ${queries.join(' | ')}`,
      );
      assert.ok(
        !/\bcontacto\b/.test(text),
        `R${round} queries must not contain standalone "contacto": ${queries.join(' | ')}`,
      );
    }
  });

  it('R3 queries still contain diversification keywords', async () => {
    const queriesByRound: Record<number, string[]> = {};
    let roundNumber = 0;

    const trackingPipeline = async (pipelineInput: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> => {
      roundNumber++;
      const extended = pipelineInput as ProspectingPipelineInput & { queryOverrides?: string[] };
      queriesByRound[roundNumber] = extended.queryOverrides ?? [];
      return {
        input: { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', mode: 'multi_query' },
        catalogContext: FAKE_CATALOG,
        searchQuery: 'test',
        webSearch: { provider: 'mock', query: 'test', results: [], resultsCount: 2, skipped: false, estimatedCostUsd: null, metadata: {} },
        candidates: [],
        summary: { requested: 10, searched: 2, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
        warnings: [],
        metadata: {},
      };
    };

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        dryRun: true,
        maxRounds: 4,
        targetPersistibleCandidates: 999,
        minUsefulCandidates: 999,
      },
      undefined,
      trackingPipeline,
    );

    const r3Queries = queriesByRound[3];
    if (r3Queries && r3Queries.length > 0) {
      const text = r3Queries.join(' ').toLowerCase();
      const hasDiversification =
        text.includes('implementador') ||
        text.includes('partner') ||
        text.includes('integrador') ||
        text.includes('consultor') ||
        text.includes('proveedor');
      assert.ok(hasDiversification, `R3 must keep diversification keywords: ${text}`);
    }
  });
});

// ── Fixture G — Adaptive metadata reconciliation ──────────────────────────────

describe('Fixture G — Adaptive metadata reconciliation post-writer', () => {
  function makeSearchInput(overrides: Partial<IncrementalSearchInput> = {}): IncrementalSearchInput {
    return {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: false,
      maxRounds: 1,
      targetPersistibleCandidates: 10,
      ...overrides,
    };
  }

  function makeFakePipeline(candidateCount: number) {
    return async (_input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> =>
      fakePipelineOutput(candidateCount);
  }

  function makeFakeWriter(persistedCount: number) {
    return async (): Promise<CandidateWriterOutput> => ({
      dryRun: false,
      batchId: 'batch-test',
      candidatesCreated: persistedCount,
      candidatesSkipped: 0,
      createdCandidateIds: Array.from({ length: persistedCount }, (_, i) => `id-${i}`),
      skipped: [],
      status: 'success',
      errors: [],
    });
  }

  it('writer persisted 10 (target 10) → persisted_count=10, remaining=0, result_status=success_target_reached', async () => {
    const result = await runIncrementalProspectingSearch(
      makeSearchInput({ targetPersistibleCandidates: 10 }),
      makeFakeWriter(10),
      makeFakePipeline(12),
    );

    const adaptive = result.metadata.adaptive_discovery;
    assert.ok(adaptive, 'adaptive_discovery must not be null/undefined');
    assert.equal(adaptive.persisted_count, 10);
    assert.equal(adaptive.remaining_to_target, 0);
    assert.equal(adaptive.result_status, 'success_target_reached');
  });

  it('writer persisted 4 (target 10) → success_partial, remaining=6', async () => {
    const result = await runIncrementalProspectingSearch(
      makeSearchInput({ targetPersistibleCandidates: 10 }),
      makeFakeWriter(4),
      makeFakePipeline(6),
    );

    const adaptive = result.metadata.adaptive_discovery;
    assert.ok(adaptive, 'adaptive_discovery must not be null/undefined');
    assert.equal(adaptive.persisted_count, 4);
    assert.equal(adaptive.remaining_to_target, 6);
    assert.equal(adaptive.result_status, 'success_partial');
  });

  it('writer persisted 0 → no_new_candidates', async () => {
    const result = await runIncrementalProspectingSearch(
      makeSearchInput({ targetPersistibleCandidates: 10 }),
      makeFakeWriter(0),
      makeFakePipeline(3),
    );

    const adaptive = result.metadata.adaptive_discovery;
    assert.ok(adaptive, 'adaptive_discovery must not be null/undefined');
    assert.equal(adaptive.persisted_count, 0);
    assert.equal(adaptive.result_status, 'no_new_candidates');
  });

  it('dryRun=true → adaptive_discovery is not null', async () => {
    const result = await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock',
        dryRun: true, maxRounds: 1, targetPersistibleCandidates: 10,
      },
      undefined,
      async (_: ProspectingPipelineInput) => fakePipelineOutput(3),
    );

    assert.ok(result.metadata.adaptive_discovery, 'adaptive_discovery must not be null');
    assert.equal(result.metadata.adaptive_discovery.enabled, true);
  });
});

// ── Fixture H — Country compatibility ranking weight ──────────────────────────

describe('Fixture H — countryCompatibilityRankWeight ordering', () => {
  it('CO native TLD (high confidence) ranks above neutral global domain (medium confidence)', () => {
    const native = evaluateCountryCompatibility('https://empresa.com.co', 'CO');
    const global = evaluateCountryCompatibility('https://empresa.com', 'CO');

    const weightNative = countryCompatibilityRankWeight(native);
    const weightGlobal = countryCompatibilityRankWeight(global);

    assert.ok(weightNative > weightGlobal, `Native CO TLD weight (${weightNative}) must exceed global (${weightGlobal})`);
  });

  it('incompatible domain (.mx) has rank weight 0', () => {
    const incompatible = evaluateCountryCompatibility('https://empresa.com.mx', 'CO');
    assert.equal(countryCompatibilityRankWeight(incompatible), 0);
  });

  it('null URL gets a positive weight (uncertain, not blocked)', () => {
    const noUrl = evaluateCountryCompatibility(null, 'CO');
    assert.ok(countryCompatibilityRankWeight(noUrl) > 0, 'No-URL candidates should get positive rank weight');
  });
});
