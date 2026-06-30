/**
 * Tests — Agent 1 · v1.16K-R — LinkedIn company URL pre-review wiring
 *
 * Covers two cost-zero changes:
 *
 *   FIX 1 — Apollo legacy mapping preserves the company linkedin_url that Apollo
 *           already returns, exposing it as canonical linkedin_enrichment metadata
 *           (buildApolloLinkedInEnrichment). No invented data when absent.
 *
 *   FIX 2 — Incremental search wires a strictly-capped Tavily LinkedIn company
 *           search into the writer ONLY when ENABLE_LINKEDIN_COMPANY_SEARCH=true.
 *           Default (flag off) → no override → zero Tavily calls.
 *
 * NO real Apollo / Tavily / Lusha / LLM / LinkedIn calls. No Supabase writes.
 * The writer is faked; the LinkedIn provider is a mock; the flag is toggled via env.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloLinkedInEnrichment,
  APOLLO_LINKEDIN_CONFIDENCE,
} from '../apollo-linkedin-enrichment';
import {
  isLinkedInCompanySearchEnabled,
  LINKEDIN_COMPANY_SEARCH_FLAG,
} from '@/lib/feature-flags.server';
import {
  createMockLinkedInSearchProvider,
  runControlledLinkedInCompanySearch,
  type LinkedInSearchConfig,
  type ControlledLinkedInSearchCandidate,
} from '../linkedin-company-search';
import { runIncrementalProspectingSearch } from '../incremental-search';
import type { LinkedInSearchOverride } from '../candidate-writer';
import type { CandidateWriterInput, CandidateWriterOutput } from '../types';
import type { IncrementalSearchInput } from '../incremental-search-types';

const CHECKED_AT = '2026-06-26T10:00:00.000Z';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';

// ════════════════════════════════════════════════════════════════════════════
// FIX 1 — buildApolloLinkedInEnrichment
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 1 — buildApolloLinkedInEnrichment (Apollo company URL preservation)', () => {
  it('present company URL → found, source=apollo, normalized company_url', () => {
    const result = buildApolloLinkedInEnrichment(
      'https://www.linkedin.com/company/acme-corp/',
      CHECKED_AT,
    );

    assert.ok(result, 'enrichment must be built');
    assert.equal(result.status, 'found');
    assert.equal(result.source, 'apollo');
    assert.equal(result.company_url, 'https://www.linkedin.com/company/acme-corp');
    assert.equal(result.normalized_company_slug, 'acme-corp');
    assert.equal(result.confidence, APOLLO_LINKEDIN_CONFIDENCE);
    assert.equal(result.enabled, true);
    assert.equal(result.checked_at, CHECKED_AT);
  });

  it('URL with tracking params/uppercase → normalized to canonical company URL', () => {
    const result = buildApolloLinkedInEnrichment(
      'http://LinkedIn.com/company/Acme-Corp?trk=abc',
      CHECKED_AT,
    );
    assert.ok(result);
    assert.equal(result.company_url, 'https://www.linkedin.com/company/acme-corp');
    assert.equal(result.source, 'apollo');
  });

  it('null → null (no invented value)', () => {
    assert.equal(buildApolloLinkedInEnrichment(null, CHECKED_AT), null);
  });

  it('undefined → null (no invented value)', () => {
    assert.equal(buildApolloLinkedInEnrichment(undefined, CHECKED_AT), null);
  });

  it('empty / whitespace string → null', () => {
    assert.equal(buildApolloLinkedInEnrichment('', CHECKED_AT), null);
    assert.equal(buildApolloLinkedInEnrichment('   ', CHECKED_AT), null);
  });

  it('person profile URL (/in/...) → null (not a company page, no invented value)', () => {
    assert.equal(
      buildApolloLinkedInEnrichment('https://www.linkedin.com/in/john-doe', CHECKED_AT),
      null,
    );
  });

  it('non-linkedin URL → null', () => {
    assert.equal(
      buildApolloLinkedInEnrichment('https://acme.com/about', CHECKED_AT),
      null,
    );
  });

  it('malformed URL → null', () => {
    assert.equal(buildApolloLinkedInEnrichment('not a url', CHECKED_AT), null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 2 — feature flag parser
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 2 — isLinkedInCompanySearchEnabled (flag parser, default false)', () => {
  afterEach(() => {
    delete process.env[LINKEDIN_COMPANY_SEARCH_FLAG];
  });

  it('undefined (default) → false', () => {
    delete process.env[LINKEDIN_COMPANY_SEARCH_FLAG];
    assert.equal(isLinkedInCompanySearchEnabled(), false);
  });

  it('"true" → true', () => {
    process.env[LINKEDIN_COMPANY_SEARCH_FLAG] = 'true';
    assert.equal(isLinkedInCompanySearchEnabled(), true);
  });

  it('"TRUE" / " true " → true (case-insensitive, trimmed)', () => {
    process.env[LINKEDIN_COMPANY_SEARCH_FLAG] = 'TRUE';
    assert.equal(isLinkedInCompanySearchEnabled(), true);
    process.env[LINKEDIN_COMPANY_SEARCH_FLAG] = ' true ';
    assert.equal(isLinkedInCompanySearchEnabled(), true);
  });

  it('"false" / "" / "1" / "yes" → false', () => {
    for (const v of ['false', '', '1', 'yes']) {
      process.env[LINKEDIN_COMPANY_SEARCH_FLAG] = v;
      assert.equal(isLinkedInCompanySearchEnabled(), false, `value "${v}" must be false`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 2 — incremental-search forwards the LinkedIn override behind the flag
// ════════════════════════════════════════════════════════════════════════════

type CapturedWriterArgs = {
  input: CandidateWriterInput;
  linkedInSearchOverride: LinkedInSearchOverride | undefined;
};

function makeCapturingWriter(captured: { args: CapturedWriterArgs | null }) {
  // Matches the positional signature of writeProspectingCandidates:
  // (input, adminClientOverride?, linkedInSearchOverride?, richProfileEnrichmentOverride?)
  return async (
    input: CandidateWriterInput,
    _admin?: unknown,
    linkedInSearchOverride?: LinkedInSearchOverride,
  ): Promise<CandidateWriterOutput> => {
    captured.args = { input, linkedInSearchOverride };
    return {
      dryRun: false,
      batchId: 'batch-fake-0000-0000-0000-000000000001',
      candidatesCreated: 1,
      candidatesSkipped: 0,
      createdCandidateIds: ['cand-001'],
      skipped: [],
      status: 'success',
      errors: [],
    };
  };
}

function makeIncrementalInput(): IncrementalSearchInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'EdTech',
    webSearchProvider: 'mock',
    dryRun: false,
    triggeredByUserId: USER_A,
    ownerId: USER_A,
  };
}

describe('FIX 2 — runIncrementalProspectingSearch wires LinkedIn override by flag', () => {
  afterEach(() => {
    delete process.env[LINKEDIN_COMPANY_SEARCH_FLAG];
  });

  it('flag OFF (default) → writer receives NO LinkedIn override (no Tavily path)', async () => {
    delete process.env[LINKEDIN_COMPANY_SEARCH_FLAG];
    const captured: { args: CapturedWriterArgs | null } = { args: null };

    await runIncrementalProspectingSearch(makeIncrementalInput(), makeCapturingWriter(captured));

    assert.ok(captured.args, 'writer should have been called');
    assert.equal(
      captured.args.linkedInSearchOverride,
      undefined,
      'no LinkedIn override must be passed when the flag is off',
    );
  });

  it('flag ON → writer receives a strictly-capped Tavily LinkedIn override', async () => {
    process.env[LINKEDIN_COMPANY_SEARCH_FLAG] = 'true';
    const captured: { args: CapturedWriterArgs | null } = { args: null };

    await runIncrementalProspectingSearch(makeIncrementalInput(), makeCapturingWriter(captured));

    assert.ok(captured.args, 'writer should have been called');
    const override = captured.args.linkedInSearchOverride;
    assert.ok(override, 'a LinkedIn override must be passed when the flag is on');
    assert.equal(override.config.enabled, true);
    assert.equal(override.config.provider, 'tavily');
    // Strict caps: low per-batch and per-candidate.
    assert.ok(override.config.maxPerBatch <= 5, 'maxPerBatch must respect the hard cap');
    assert.equal(override.config.maxQueriesPerCandidate, 1, 'one query per candidate');
    assert.equal(override.config.maxResultsPerQuery, 3, 'three results per query (v1.16K-R-D.1: improves recall at same credit cost)');
    assert.equal(typeof override.providerFn, 'function', 'a provider fn must be wired');
    assert.equal(typeof override.usageLoggerFn, 'function', 'a usage logger must be wired');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 2 — controlled search with a MOCK provider (no real Tavily)
// ════════════════════════════════════════════════════════════════════════════

const ENABLED_MOCK_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'mock',
  maxPerBatch: 3,
  minConfidenceScore: 70,
  maxQueriesPerCandidate: 1,
  maxResultsPerQuery: 1,
};

function makeSearchCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'Softland Colombia',
    domain: 'softland.com.co',
    countryCode: 'CO',
    sourceTitle: 'Softland Colombia - Software ERP',
    sourceSnippet: 'Software ERP para empresas en Colombia.',
    confidenceScore: 80,
    currentEnrichment: {
      enabled: true,
      status: 'not_found',
      confidence: 0,
      warnings: ['No LinkedIn company URL available in current evidence.'],
      source: 'none',
      checked_at: CHECKED_AT,
    },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
    ...overrides,
  };
}

describe('FIX 2 — controlled LinkedIn search with mock provider', () => {
  it('mock returns a company URL → enrichment becomes found with company_url', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
    });

    const output = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      ENABLED_MOCK_CONFIG,
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = output.results[0].enrichment;
    assert.equal(enrichment.status, 'found');
    assert.equal(enrichment.company_url, 'https://www.linkedin.com/company/softland');
    assert.ok(output.batchMetadata.attempted_count >= 1, 'search must have been attempted');
  });

  it('mock returns nothing → status not_found, flow does not break', async () => {
    const emptyProvider = createMockLinkedInSearchProvider({});

    const output = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      ENABLED_MOCK_CONFIG,
      emptyProvider,
      CHECKED_AT,
    );

    assert.equal(output.results.length, 1, 'result must still be produced');
    assert.equal(output.results[0].enrichment.status, 'not_found');
  });
});
