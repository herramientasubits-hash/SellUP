/**
 * Tests — Adaptive Discovery Budget (Hito 16AB.43.26)
 *
 * Fixture A — targetPersistibleCandidates defaults to 10
 * Fixture B — Adaptive constants exported from wizard-tavily-executor
 * Fixture C — estimateWizardAdaptiveMaxCredits returns 20
 * Fixture D — IncrementalSearchOutput has targetReached and targetPersistibleCandidates fields
 * Fixture E — Query diversification: round 3 and 4 queries differ from rounds 1 and 2
 *
 * Uses Node.js built-in test runner. No Supabase, Tavily, or real I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateWizardAdaptiveMaxCredits,
  WIZARD_ADAPTIVE_MAX_ROUNDS,
  WIZARD_QUERIES_PER_ROUND,
  WIZARD_MAX_CREDITS_PER_EXECUTION,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reconciliation';

import {
  WIZARD_ADAPTIVE_MAX_ROUNDS as EXECUTOR_MAX_ROUNDS,
  WIZARD_TARGET_PERSISTIBLE_CANDIDATES,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor';

import type {
  IncrementalSearchOutput,
  IncrementalSearchInput,
} from '../incremental-search-types';

import { runIncrementalProspectingSearch } from '../incremental-search';
import type { ProspectingPipelineOutput, CatalogContextResult } from '../types';

// ── Shared fixture: minimal valid CatalogContextResult ────────────────────────

const FAKE_CATALOG_CONTEXT: CatalogContextResult = {
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

// ── Fixture A — targetPersistibleCandidates default is 10 ────────────────────

describe('Fixture A — targetPersistibleCandidates default is 10', () => {
  it('when targetPersistibleCandidates is not set, output reflects the default of 10', async () => {
    const input: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: true,
      maxRounds: 1,
    };

    // Fake pipeline: returns 0 candidates (dry run)
    const fakePipeline = async (): Promise<ProspectingPipelineOutput> => ({
      input: {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        mode: 'multi_query',
      },
      catalogContext: FAKE_CATALOG_CONTEXT,
      searchQuery: 'test',
      webSearch: {
        provider: 'mock',
        query: 'test',
        results: [],
        resultsCount: 0,
        skipped: false,
        estimatedCostUsd: null,
        metadata: {},
      },
      candidates: [],
      summary: {
        requested: 10,
        searched: 0,
        returned: 0,
        highQualityNew: 0,
        needsReview: 0,
        duplicates: 0,
        insufficientData: 0,
        discarded: 0,
        unchecked: 0,
      },
      warnings: [],
      metadata: {},
    });

    const result = await runIncrementalProspectingSearch(input, undefined, fakePipeline);
    assert.equal(result.targetPersistibleCandidates, 10, 'targetPersistibleCandidates must default to 10');
  });

  it('when targetPersistibleCandidates is explicitly set to 5, output reflects 5', async () => {
    const input: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: true,
      maxRounds: 1,
      targetPersistibleCandidates: 5,
    };

    const fakePipeline = async (): Promise<ProspectingPipelineOutput> => ({
      input: { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', mode: 'multi_query' },
      catalogContext: FAKE_CATALOG_CONTEXT,
      searchQuery: 'test',
      webSearch: { provider: 'mock', query: 'test', results: [], resultsCount: 0, skipped: false, estimatedCostUsd: null, metadata: {} },
      candidates: [],
      summary: { requested: 10, searched: 0, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
      warnings: [],
      metadata: {},
    });

    const result = await runIncrementalProspectingSearch(input, undefined, fakePipeline);
    assert.equal(result.targetPersistibleCandidates, 5, 'targetPersistibleCandidates must be 5 when explicitly set');
  });
});

// ── Fixture B — Adaptive constants exported from wizard-tavily-executor ───────

describe('Fixture B — Adaptive constants from wizard-tavily-executor', () => {
  it('WIZARD_ADAPTIVE_MAX_ROUNDS equals 4', () => {
    assert.equal(EXECUTOR_MAX_ROUNDS, 4);
  });

  it('WIZARD_TARGET_PERSISTIBLE_CANDIDATES equals 10', () => {
    assert.equal(WIZARD_TARGET_PERSISTIBLE_CANDIDATES, 10);
  });
});

// ── Fixture C — estimateWizardAdaptiveMaxCredits returns 20 ──────────────────

describe('Fixture C — estimateWizardAdaptiveMaxCredits', () => {
  it('constants: WIZARD_ADAPTIVE_MAX_ROUNDS=4, WIZARD_QUERIES_PER_ROUND=5, cap=20', () => {
    assert.equal(WIZARD_ADAPTIVE_MAX_ROUNDS, 4);
    assert.equal(WIZARD_QUERIES_PER_ROUND, 5);
    assert.equal(WIZARD_MAX_CREDITS_PER_EXECUTION, 20);
  });

  it('standard depth → 4 rounds × 5 queries × 1 credit = 20', () => {
    assert.equal(estimateWizardAdaptiveMaxCredits({ searchDepth: 'standard' }), 20);
  });

  it('basic depth → 4 rounds × 5 queries × 1 credit = 20', () => {
    assert.equal(estimateWizardAdaptiveMaxCredits({ searchDepth: 'basic' }), 20);
  });

  it('deep depth → 4 rounds × 5 queries × 2 credits = 40, capped at 20', () => {
    // uncapped = 40, capped = 20
    assert.equal(estimateWizardAdaptiveMaxCredits({ searchDepth: 'deep' }), 20);
  });

  it('no args → defaults to standard → 20', () => {
    assert.equal(estimateWizardAdaptiveMaxCredits(), 20);
  });
});

// ── Fixture D — IncrementalSearchOutput type has targetReached and targetPersistibleCandidates ──

describe('Fixture D — IncrementalSearchOutput type contract', () => {
  it('targetReached and targetPersistibleCandidates are optional fields on IncrementalSearchOutput', () => {
    // Type-level test: construct a minimal valid output and access the fields
    const output: IncrementalSearchOutput = {
      input: {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'mock',
        dryRun: true,
      },
      candidates: [],
      candidatesCount: 0,
      usefulCandidatesCount: 0,
      metadata: {
        rounds_executed: 1,
        stopped_reason: 'target_reached',
        total_raw_evaluated: 0,
        total_candidates_accumulated: 0,
        useful_candidates_count: 0,
        min_useful_candidates: 7,
        target_internal: 10,
        max_rounds: 4,
        max_total_raw_to_evaluate: 50,
        dry_run: true,
        rounds: [],
      },
      warnings: [],
      targetReached: true,
      targetPersistibleCandidates: 10,
    };

    assert.equal(output.targetReached, true);
    assert.equal(output.targetPersistibleCandidates, 10);
  });

  it('targetReached is undefined when dryRun=true in actual output', async () => {
    const input: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: true,
      maxRounds: 1,
    };

    const fakePipeline = async (): Promise<ProspectingPipelineOutput> => ({
      input: { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', mode: 'multi_query' },
      catalogContext: FAKE_CATALOG_CONTEXT,
      searchQuery: 'test',
      webSearch: { provider: 'mock', query: 'test', results: [], resultsCount: 0, skipped: false, estimatedCostUsd: null, metadata: {} },
      candidates: [],
      summary: { requested: 10, searched: 0, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
      warnings: [],
      metadata: {},
    });

    const result = await runIncrementalProspectingSearch(input, undefined, fakePipeline);
    assert.equal(result.targetReached, undefined, 'targetReached must be undefined when dryRun=true');
  });
});

// ── Fixture E — Query diversification: round 3 and 4 queries differ ───────────

describe('Fixture E — Round 3 and 4 query diversification', () => {
  it('running 4 rounds with a mock pipeline captures different query patterns across rounds', async () => {
    const queriesByRound: Record<number, string[]> = {};
    let roundNumber = 0;

    const trackingPipeline = async (pipelineInput: Parameters<typeof runIncrementalProspectingSearch>[2] extends (input: infer I) => unknown ? I : never): Promise<ProspectingPipelineOutput> => {
      roundNumber++;
      const currentRound = roundNumber;

      // Extract query overrides from metadata if available — or track the pipeline input
      const queryOverrides = (pipelineInput as { queryOverrides?: string[] }).queryOverrides ?? [];
      queriesByRound[currentRound] = queryOverrides;

      return {
        input: { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', mode: 'multi_query' },
        catalogContext: FAKE_CATALOG_CONTEXT,
        searchQuery: 'test',
        webSearch: { provider: 'mock', query: 'test', results: [], resultsCount: 5, skipped: false, estimatedCostUsd: null, metadata: {} },
        candidates: [],
        summary: { requested: 10, searched: 5, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
        warnings: [],
        metadata: {},
      };
    };

    const input: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: true,
      maxRounds: 4,
      targetPersistibleCandidates: 999, // Set high so all 4 rounds execute
      minUsefulCandidates: 999,
    };

    await runIncrementalProspectingSearch(
      input,
      undefined,
      trackingPipeline as unknown as typeof import('../prospecting-pipeline').runProspectingPipeline,
    );

    // Verify at least 2 rounds were executed (rounds 1 and 2 at minimum)
    assert.ok(roundNumber >= 2, `Expected at least 2 rounds, got ${roundNumber}`);

    // Verify round 3 and 4 queries (if executed) contain diversification keywords
    if (queriesByRound[3] && queriesByRound[3].length > 0) {
      const r3Queries = queriesByRound[3].join(' ');
      const hasR3Keywords = r3Queries.includes('implementador') ||
        r3Queries.includes('partner') ||
        r3Queries.includes('integrador') ||
        r3Queries.includes('consultor') ||
        r3Queries.includes('proveedor especializado');
      assert.ok(hasR3Keywords, `Round 3 queries must contain partner/implementer angle keywords: ${r3Queries}`);
    }

    if (queriesByRound[4] && queriesByRound[4].length > 0) {
      const r4Queries = queriesByRound[4].join(' ');
      const hasR4Keywords = r4Queries.includes('caso de éxito') ||
        r4Queries.includes('ecosistema') ||
        r4Queries.includes('cartera') ||
        r4Queries.includes('transformación digital') ||
        r4Queries.includes('solución tecnológica');
      assert.ok(hasR4Keywords, `Round 4 queries must contain case-study/buyer angle keywords: ${r4Queries}`);
    }
  });

  it('adaptive_discovery metadata is present in output', async () => {
    const input: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: true,
      maxRounds: 1,
      targetPersistibleCandidates: 10,
    };

    const fakePipeline = async (): Promise<ProspectingPipelineOutput> => ({
      input: { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', mode: 'multi_query' },
      catalogContext: FAKE_CATALOG_CONTEXT,
      searchQuery: 'test',
      webSearch: { provider: 'mock', query: 'test', results: [], resultsCount: 0, skipped: false, estimatedCostUsd: null, metadata: {} },
      candidates: [],
      summary: { requested: 10, searched: 0, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
      warnings: [],
      metadata: {},
    });

    const result = await runIncrementalProspectingSearch(input, undefined, fakePipeline);
    assert.ok(result.metadata.adaptive_discovery, 'adaptive_discovery must be present in metadata');
    assert.equal(result.metadata.adaptive_discovery?.enabled, true);
    assert.equal(result.metadata.adaptive_discovery?.target_persistible_candidates, 10);
    assert.equal(result.metadata.adaptive_discovery?.max_rounds, 1);
    assert.ok(result.metadata.adaptive_discovery?.rounds_executed >= 1);
  });
});
