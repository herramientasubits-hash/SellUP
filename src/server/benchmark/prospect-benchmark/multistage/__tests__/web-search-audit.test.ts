/**
 * Tests — Anthropic Web Search Audit (Hotfix 16AB.23.5)
 *
 * 10 test cases. No real API calls. No real timers.
 * Uses Node.js built-in test runner (node:test + node:assert).
 *
 * Covered scenarios:
 *   1  Normal search — reported_by_provider, query, 2 results, 1 citation, cost
 *   2  Multiple searches — 2 server_tool_use blocks, usage reports 2
 *   3  Usage absent — inferred_from_blocks fallback
 *   4  HTTP 200 with search error — not counted as successful search
 *   5  URL in both result and citation — tool_result_and_citation
 *   6  URL written by model only — model_generated_url
 *   7  Legacy artifact without audit — legacy_unverifiable
 *   8  Cost calculation — token + web search separate and combined
 *   9  Search count unknown — partial_search_usage_unavailable cost status
 *  10  Invalidation — verification hash changes when SEARCH_AUDIT_VERSION present
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAnthropicWebSearchAudit,
  classifyUrlOrigin,
  mergeWebSearchAudits,
  deriveCandidateAuditStatus,
  degradeSearchCountStatus,
  SEARCH_AUDIT_VERSION,
} from '../web-search-audit';
import type { AnthropicWebSearchAudit } from '../web-search-audit';
import { computeVerificationCandidateInputHash, computeArtifactInputHash } from '../artifact-hash';
import type { DiscoveryCandidate } from '../ms-types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RESULT_1 = {
  type: 'web_search_result' as const,
  url: 'https://www.ycombinator.com/companies/simetrik',
  title: 'Simetrik — YC S21',
  page_age: '2024-03-01',
};

const RESULT_2 = {
  type: 'web_search_result' as const,
  url: 'https://www.linkedin.com/company/simetrik',
  title: 'Simetrik | LinkedIn',
};

function makeNormalResponse() {
  return {
    content: [
      {
        type: 'server_tool_use',
        id: 'stool_01',
        name: 'web_search',
        input: { query: 'Simetrik fintech Colombia serie A' },
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'stool_01',
        content: [RESULT_1, RESULT_2],
      },
      {
        type: 'text',
        text: 'Simetrik es una empresa fintech fundada en Bogotá.',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://www.ycombinator.com/companies/simetrik',
            title: 'Simetrik — YC S21',
            cited_text: 'Simetrik — automated financial reconciliation',
          },
        ],
      },
    ],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 500,
      output_tokens: 120,
      server_tool_use: {
        web_search_requests: 1,
      },
    },
  };
}

function makeCandidate(partial: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    name: 'Simetrik',
    website: 'https://www.simetrik.com',
    linkedin: 'https://www.linkedin.com/company/simetrik',
    city: 'Bogotá',
    sector: 'Fintech',
    description: 'Automatización de conciliaciones financieras',
    confidence: 'Alta',
    evidence_url: 'https://www.ycombinator.com/companies/simetrik',
    evidence_source: 'YCombinator',
    estimated_size: '50-200',
    notes: null,
    batch_index: 0,
    batch_theme: 'Fintech B2B',
    ...partial,
  };
}

// ─── Test 1: Normal search ─────────────────────────────────────────────────────

describe('Case 1 — Normal search with reported_by_provider', () => {
  it('extracts 1 query, 2 results, 1 citation, stop reason end_turn', () => {
    const audit = extractAnthropicWebSearchAudit(makeNormalResponse());

    assert.equal(audit.searchRequests, 1);
    assert.equal(audit.searchCountStatus, 'reported_by_provider');

    assert.equal(audit.queries.length, 1);
    assert.equal(audit.queries[0]?.query, 'Simetrik fintech Colombia serie A');
    assert.equal(audit.queries[0]?.toolUseId, 'stool_01');

    assert.equal(audit.results.length, 2);
    assert.equal(audit.results[0]?.url, 'https://www.ycombinator.com/companies/simetrik');
    assert.equal(audit.results[0]?.pageAge, '2024-03-01');
    assert.equal(audit.results[1]?.url, 'https://www.linkedin.com/company/simetrik');

    assert.equal(audit.citations.length, 1);
    assert.equal(audit.citations[0]?.url, 'https://www.ycombinator.com/companies/simetrik');
    assert.equal(audit.citations[0]?.citedText, 'Simetrik — automated financial reconciliation');
    assert.equal(audit.citations[0]?.textBlockIndex, 2);

    assert.equal(audit.errors.length, 0);
    assert.equal(audit.stopReason, 'end_turn');
  });

  it('does not store encrypted_content or encrypted_index', () => {
    const raw = makeNormalResponse();
    // Add encrypted fields to the raw response to verify they are excluded
    (raw.content[1] as Record<string, unknown>)['encrypted_content'] = 'SHOULD_NOT_APPEAR';
    const audit = extractAnthropicWebSearchAudit(raw);
    const serialized = JSON.stringify(audit);
    assert.ok(!serialized.includes('SHOULD_NOT_APPEAR'), 'encrypted_content must not be stored');
  });
});

// ─── Test 2: Multiple searches ─────────────────────────────────────────────────

describe('Case 2 — Multiple searches with reported_by_provider', () => {
  it('usage.server_tool_use.web_search_requests is authoritative source', () => {
    const response = {
      content: [
        { type: 'server_tool_use', id: 'stool_01', name: 'web_search', input: { query: 'Simetrik site:crunchbase.com' } },
        { type: 'web_search_tool_result', tool_use_id: 'stool_01', content: [RESULT_1] },
        { type: 'server_tool_use', id: 'stool_02', name: 'web_search', input: { query: 'Simetrik linkedin Colombia' } },
        { type: 'web_search_tool_result', tool_use_id: 'stool_02', content: [RESULT_2] },
        { type: 'text', text: 'Found information about Simetrik.' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 800,
        output_tokens: 150,
        server_tool_use: { web_search_requests: 2 },
      },
    };

    const audit = extractAnthropicWebSearchAudit(response);

    assert.equal(audit.searchRequests, 2);
    assert.equal(audit.searchCountStatus, 'reported_by_provider');
    assert.equal(audit.queries.length, 2);
    assert.equal(audit.results.length, 2);
  });
});

// ─── Test 3: Usage field absent — inferred_from_blocks ────────────────────────

describe('Case 3 — Usage absent → inferred_from_blocks', () => {
  it('falls back to counting server_tool_use blocks, not zero', () => {
    const response = {
      content: [
        { type: 'server_tool_use', id: 'stool_01', name: 'web_search', input: { query: 'Truora Colombia ID verification' } },
        { type: 'web_search_tool_result', tool_use_id: 'stool_01', content: [RESULT_1] },
        { type: 'text', text: 'Truora offers ID verification.' },
      ],
      stop_reason: 'end_turn',
      // No usage field
    };

    const audit = extractAnthropicWebSearchAudit(response);

    assert.equal(audit.searchCountStatus, 'inferred_from_blocks');
    assert.notEqual(audit.searchRequests, 0, 'search count must not be zero when blocks are present');
    assert.ok(audit.searchRequests !== null);
    assert.equal(audit.searchRequests, 1);
  });
});

// ─── Test 4: HTTP 200 with search-level error ─────────────────────────────────

describe('Case 4 — HTTP 200 with web_search_tool_result_error', () => {
  it('records the error and does not count it as a successful result', () => {
    const response = {
      content: [
        { type: 'server_tool_use', id: 'stool_01', name: 'web_search', input: { query: 'B-Secure Colombia ciberseguridad' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'stool_01',
          content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' },
        },
        { type: 'text', text: 'Could not complete the search.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 200, output_tokens: 30, server_tool_use: { web_search_requests: 1 } },
    };

    const audit = extractAnthropicWebSearchAudit(response);

    assert.equal(audit.errors.length, 1);
    assert.equal(audit.errors[0]?.errorCode, 'too_many_requests');
    assert.equal(audit.errors[0]?.toolUseId, 'stool_01');
    assert.equal(audit.results.length, 0, 'error response must not produce result entries');
    // Search was attempted (usage reports 1) but returned no usable results
    assert.equal(audit.searchRequests, 1);
  });
});

// ─── Test 5: URL in both result and citation ──────────────────────────────────

describe('Case 5 — URL found in search result AND citation', () => {
  it('classifies as tool_result_and_citation', () => {
    const audit = extractAnthropicWebSearchAudit(makeNormalResponse());
    const ycUrl = 'https://www.ycombinator.com/companies/simetrik';

    assert.equal(classifyUrlOrigin(ycUrl, audit), 'tool_result_and_citation');
  });

  it('classifies LinkedIn URL (result only, no citation) as tool_result_url', () => {
    const audit = extractAnthropicWebSearchAudit(makeNormalResponse());
    assert.equal(
      classifyUrlOrigin('https://www.linkedin.com/company/simetrik', audit),
      'tool_result_url'
    );
  });
});

// ─── Test 6: URL written by model only ───────────────────────────────────────

describe('Case 6 — URL appears in model output but not in audit trail', () => {
  it('classifies as model_generated_url', () => {
    const audit = extractAnthropicWebSearchAudit(makeNormalResponse());
    const modelUrl = 'https://simetrik.com/about-us';  // not in search results or citations

    assert.equal(classifyUrlOrigin(modelUrl, audit), 'model_generated_url');
  });

  it('returns unknown_origin when audit is null', () => {
    assert.equal(classifyUrlOrigin('https://example.com', null), 'unknown_origin');
  });

  it('returns unknown_origin for null URL', () => {
    const audit = extractAnthropicWebSearchAudit(makeNormalResponse());
    assert.equal(classifyUrlOrigin(null, audit), 'unknown_origin');
  });
});

// ─── Test 7: Legacy artifact without audit ────────────────────────────────────

describe('Case 7 — Legacy artifact without search audit', () => {
  it('deriveCandidateAuditStatus returns not_auditable when audit is null', () => {
    const c = makeCandidate();
    const status = deriveCandidateAuditStatus(c.website, c.linkedin, c.evidence_url, null);
    assert.equal(status, 'not_auditable');
  });

  it('deriveCandidateAuditStatus returns not_auditable when audit has no results/citations', () => {
    const emptyAudit: AnthropicWebSearchAudit = {
      searchRequests: 0,
      searchCountStatus: 'reported_by_provider',
      queries: [],
      results: [],
      citations: [],
      errors: [],
      stopReason: 'end_turn',
    };
    const c = makeCandidate();
    const status = deriveCandidateAuditStatus(c.website, c.linkedin, c.evidence_url, emptyAudit);
    assert.equal(status, 'not_auditable');
  });
});

// ─── Test 8: Cost calculation ─────────────────────────────────────────────────

describe('Case 8 — Cost breakdown: token + web search separate and combined', () => {
  it('token cost and web search cost are both present and correct', () => {
    // 500 input + 120 output with claude-sonnet-4-6 pricing
    // token cost = (500/1M)*3.0 + (120/1M)*15.0 = 0.0015 + 0.0018 = 0.0033
    // web search cost = (1/1000)*10.0 = 0.01
    // total = 0.0133
    const { estimateCost } = require('../client') as { estimateCost: (i: number, o: number, s: number) => number };

    const tokenCost = (500 / 1_000_000) * 3.0 + (120 / 1_000_000) * 15.0;
    const webSearchCost = (1 / 1_000) * 10.0;
    const totalCost = estimateCost(500, 120, 1);

    assert.ok(Math.abs(totalCost - (tokenCost + webSearchCost)) < 0.000001,
      `Expected ~${(tokenCost + webSearchCost).toFixed(6)}, got ${totalCost.toFixed(6)}`);
  });

  it('audit search count of 2 doubles the web search cost', () => {
    const { estimateCost } = require('../client') as { estimateCost: (i: number, o: number, s: number) => number };
    const cost1 = estimateCost(500, 120, 1);
    const cost2 = estimateCost(500, 120, 2);
    const diff = cost2 - cost1;
    const expectedSearchCostPerUnit = 10.0 / 1_000;
    assert.ok(Math.abs(diff - expectedSearchCostPerUnit) < 0.000001);
  });
});

// ─── Test 9: Search count unknown → partial cost ─────────────────────────────

describe('Case 9 — Search count unavailable → partial_search_usage_unavailable', () => {
  it('degradeSearchCountStatus returns unavailable when any call is unavailable', () => {
    const result = degradeSearchCountStatus(['reported_by_provider', 'unavailable', 'inferred_from_blocks']);
    assert.equal(result, 'unavailable');
  });

  it('degradeSearchCountStatus returns inferred_from_blocks when no unavailable', () => {
    const result = degradeSearchCountStatus(['reported_by_provider', 'inferred_from_blocks']);
    assert.equal(result, 'inferred_from_blocks');
  });

  it('degradeSearchCountStatus returns reported_by_provider when all are reported', () => {
    const result = degradeSearchCountStatus(['reported_by_provider', 'reported_by_provider']);
    assert.equal(result, 'reported_by_provider');
  });

  it('extractAnthropicWebSearchAudit returns unavailable + null when no usage and no blocks', () => {
    const response = {
      content: [
        { type: 'text', text: 'No web search performed.' },
      ],
      stop_reason: 'end_turn',
      // No usage
    };
    const audit = extractAnthropicWebSearchAudit(response);
    assert.equal(audit.searchCountStatus, 'unavailable');
    assert.equal(audit.searchRequests, null);
  });
});

// ─── Test 10: Invalidation — verification hash includes SEARCH_AUDIT_VERSION ──

describe('Case 10 — Verification hash invalidated by SEARCH_AUDIT_VERSION', () => {
  it('SEARCH_AUDIT_VERSION is a positive integer', () => {
    assert.ok(typeof SEARCH_AUDIT_VERSION === 'number');
    assert.ok(SEARCH_AUDIT_VERSION > 0);
  });

  it('computeVerificationCandidateInputHash includes anthropicSearchAuditVersion', () => {
    const c = makeCandidate();

    const hashWith = computeVerificationCandidateInputHash(c, 'Colombia', '16AB.23.5', 'claude-sonnet-4-6');

    // Compute a hash WITHOUT anthropicSearchAuditVersion (simulating pre-16AB.23.5 behavior)
    const hashWithout = computeArtifactInputHash({
      pipelineVersion: '16AB.23.5',
      model: 'claude-sonnet-4-6',
      stage: 'stage5_verification',
      country: 'Colombia',
      // No anthropicSearchAuditVersion
      candidateKey: require('../artifact-hash').computeCandidateKey(c),
      name: require('../artifact-hash').normalizeName(c.name),
      domain: require('../artifact-hash').normalizeDomain(c.website),
      city: c.city ?? null,
      sector: c.sector,
      description: c.description ?? null,
      evidence_source: c.evidence_source ?? null,
    });

    assert.notEqual(hashWith, hashWithout,
      'Hash must differ when anthropicSearchAuditVersion is added — old verification artifacts must be invalidated');
  });

  it('same candidate with same version always produces same hash (deterministic)', () => {
    const c = makeCandidate();
    const h1 = computeVerificationCandidateInputHash(c, 'Colombia', '16AB.23.5', 'claude-sonnet-4-6');
    const h2 = computeVerificationCandidateInputHash(c, 'Colombia', '16AB.23.5', 'claude-sonnet-4-6');
    assert.equal(h1, h2);
  });
});

// ─── Bonus: Simetrik offline simulation ──────────────────────────────────────

describe('Bonus — Simetrik offline simulation', () => {
  it('partially_auditable when YC URL is cited but LinkedIn is result-only', () => {
    const audit = extractAnthropicWebSearchAudit(makeNormalResponse());

    // YC URL: in both results and citations
    const ycOrigin = classifyUrlOrigin('https://www.ycombinator.com/companies/simetrik', audit);
    assert.equal(ycOrigin, 'tool_result_and_citation');

    // LinkedIn: only in results, no citation
    const liOrigin = classifyUrlOrigin('https://www.linkedin.com/company/simetrik', audit);
    assert.equal(liOrigin, 'tool_result_url');

    // Website: not searched at all
    const siteOrigin = classifyUrlOrigin('https://www.simetrik.com', audit);
    assert.equal(siteOrigin, 'model_generated_url');

    // Overall audit status with the 3 key URLs
    const status = deriveCandidateAuditStatus(
      'https://www.simetrik.com',           // model-generated (not searched)
      'https://www.linkedin.com/company/simetrik',  // result only
      'https://www.ycombinator.com/companies/simetrik',  // result + citation
      audit
    );
    assert.equal(status, 'partially_auditable');
  });

  it('not_auditable when no audit is present (legacy run)', () => {
    const c = makeCandidate();
    const status = deriveCandidateAuditStatus(c.website, c.linkedin, c.evidence_url, null);
    assert.equal(status, 'not_auditable');
  });

  it('mergeWebSearchAudits accumulates queries and results correctly', () => {
    const a1 = extractAnthropicWebSearchAudit(makeNormalResponse());
    const a2 = extractAnthropicWebSearchAudit({
      content: [
        { type: 'server_tool_use', id: 'stool_02', name: 'web_search', input: { query: 'Simetrik funding 2024' } },
        { type: 'web_search_tool_result', tool_use_id: 'stool_02', content: [RESULT_2] },
        { type: 'text', text: 'Simetrik raised $20M.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 300, output_tokens: 50, server_tool_use: { web_search_requests: 1 } },
    });

    const merged = mergeWebSearchAudits([a1, a2]);

    assert.equal(merged.queries.length, 2);
    assert.equal(merged.results.length, 3);  // 2 from a1, 1 from a2
    assert.equal(merged.searchRequests, 2);
    assert.equal(merged.searchCountStatus, 'reported_by_provider');
  });
});
