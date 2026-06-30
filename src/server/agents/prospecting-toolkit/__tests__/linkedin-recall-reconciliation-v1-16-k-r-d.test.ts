/**
 * Tests — Agent 1 · v1.16K-R-D — LinkedIn recall improvement & reconciliation fix
 *
 * Verifies two independent fixes:
 *
 *   FIX 1 — maxResultsPerQuery=3 improves LinkedIn recall at the same credit cost.
 *     - Selector picks first valid /company/ URL when Tavily returns [/posts/, /company/foo].
 *     - Accepts regional subdomain variants (co.linkedin.com/company/foo).
 *     - Rejects /in/, /jobs/, /school/, /showcase/, /feed/, /posts/ as non-company.
 *     - With maxResultsPerQuery=3, usage log records 1 credit per query (not 3).
 *     - found_count increments when selector picks a valid company URL.
 *
 *   FIX 2 — tavily_usage_reconciliation counts only multi_query_web_search logs.
 *     - A batch with 16 multi_query_web_search logs + 3 linkedin_company_search logs:
 *       credits_used_logged in the discovery reconciliation = 16, not 19.
 *     - readWizardConsumedCreditsFromDb already scopes by operation_key (sanity check).
 *
 * NO real Tavily / Apollo / Supabase / LinkedIn calls.
 * Provider is an injected mock; logger is captured in-memory.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runControlledLinkedInCompanySearch,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
  type LinkedInSearchConfig,
  type ControlledLinkedInSearchCandidate,
  type LinkedInSearchProviderFn,
  type LinkedInUsageLogPayload,
  type LinkedInUsageLoggerFn,
} from '../linkedin-company-search';
import { normalizeLinkedInCompanyUrl } from '../linkedin-company-enrichment';
import { LINKEDIN_SEARCH_STRICT_CONFIG } from '../incremental-search';
import { readWizardConsumedCreditsFromDb } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reconciliation';

const CHECKED_AT = '2026-06-30T10:00:00.000Z';
const BATCH_ID = 'dddddddd-eeee-ffff-0000-111111111111';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TAVILY_UNIT_COST = 0.008;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TAVILY_CONFIG_3: LinkedInSearchConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: 3,
  minConfidenceScore: 70,
  maxQueriesPerCandidate: 1,
  maxResultsPerQuery: 3,
};

function makeCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'Acme Colombia',
    domain: 'acme.com.co',
    countryCode: 'CO',
    sourceTitle: 'Acme Colombia',
    sourceSnippet: 'Software ERP.',
    confidenceScore: 80,
    currentEnrichment: {
      enabled: true,
      status: 'not_found',
      confidence: 0,
      warnings: ['No LinkedIn company URL.'],
      source: 'none',
      checked_at: CHECKED_AT,
    },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
    ...overrides,
  };
}

function makeCapturingLogger(): {
  payloads: LinkedInUsageLogPayload[];
  fn: LinkedInUsageLoggerFn;
} {
  const payloads: LinkedInUsageLogPayload[] = [];
  return {
    payloads,
    fn: async (payload: LinkedInUsageLogPayload) => {
      payloads.push(payload);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ════════════════════════════════════════════════════════════════════════════

describe('DEFAULT_LINKEDIN_SEARCH_CONFIG.maxResultsPerQuery', () => {
  it('is 3 (cost-free recall improvement)', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.maxResultsPerQuery, 3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// STRICT CONFIG (v1.16K-R-D.1) — real config used by incremental-search caller
// ════════════════════════════════════════════════════════════════════════════

describe('LINKEDIN_SEARCH_STRICT_CONFIG — caller config used by buildLinkedInSearchOverride', () => {
  it('maxResultsPerQuery is 3, not 1 (v1.16K-R-D.1 fix)', () => {
    assert.equal(
      LINKEDIN_SEARCH_STRICT_CONFIG.maxResultsPerQuery,
      3,
      'LINKEDIN_SEARCH_STRICT_CONFIG must use maxResultsPerQuery=3 so runtime does not override to 1',
    );
  });

  it('maxPerBatch stays 3 (credit cap unchanged)', () => {
    assert.equal(LINKEDIN_SEARCH_STRICT_CONFIG.maxPerBatch, 3);
  });

  it('maxQueriesPerCandidate stays 1 (1 Tavily call per candidate)', () => {
    assert.equal(LINKEDIN_SEARCH_STRICT_CONFIG.maxQueriesPerCandidate, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 1a — Selector picks first valid /company/ URL among multiple results
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 1a — selector picks valid company URL when first result is /posts/', () => {
  it('returns found when Tavily gives [/posts/..., /company/acme-co]', async () => {
    const provider: LinkedInSearchProviderFn = async () => [
      'https://www.linkedin.com/posts/acme-co_foo-bar-123456',
      'https://www.linkedin.com/company/acme-co',
    ];
    const logger = makeCapturingLogger();

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      TAVILY_CONFIG_3,
      provider,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: logger.fn,
      },
    );

    assert.equal(output.batchMetadata.found_count, 1, 'should find 1 company URL');
    assert.equal(output.batchMetadata.rejected_count, 0);
    assert.equal(output.results[0].enrichment.status, 'found');
    assert.ok(
      output.results[0].enrichment.company_url?.includes('/company/acme-co'),
      'company_url must point to the company page',
    );

    // Sample diagnostic fields
    const sample = output.batchMetadata.samples[0];
    assert.ok(sample, 'sample must exist');
    assert.equal(sample.raw_result_count, 2, 'Tavily returned 2 URLs');
    assert.ok(sample.rejected_urls_count >= 1, 'at least 1 rejected URL (/posts/)');
    assert.equal(sample.found_urls_count, 1);
  });

  it('returns rejected when ALL results are /posts/ paths', async () => {
    const provider: LinkedInSearchProviderFn = async () => [
      'https://www.linkedin.com/posts/acme-co_foo-123',
      'https://www.linkedin.com/posts/acme-co_bar-456',
    ];
    const logger = makeCapturingLogger();

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      TAVILY_CONFIG_3,
      provider,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: logger.fn,
      },
    );

    assert.equal(output.batchMetadata.found_count, 0);
    const status = output.results[0].enrichment.status;
    assert.ok(status === 'rejected' || status === 'not_found', `unexpected status: ${status}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 1b — Regional subdomains accepted
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 1b — regional subdomains (co.linkedin.com/company/...)', () => {
  it('normalizeLinkedInCompanyUrl accepts co.linkedin.com/company/<slug> — not rejected', () => {
    const result = normalizeLinkedInCompanyUrl('https://co.linkedin.com/company/acme-colombia');
    assert.equal(result.rejected, false, `co.linkedin.com/company/ must not be rejected; rejectReason=${result.rejectReason}`);
    assert.equal(result.slug, 'acme-colombia');
    assert.equal(result.normalized, 'https://www.linkedin.com/company/acme-colombia');
  });

  it('normalizeLinkedInCompanyUrl accepts es.linkedin.com/company/<slug>', () => {
    const result = normalizeLinkedInCompanyUrl('https://es.linkedin.com/company/empresa-sa');
    assert.equal(result.rejected, false, `es.linkedin.com/company/ must not be rejected; rejectReason=${result.rejectReason}`);
    assert.equal(result.normalized, 'https://www.linkedin.com/company/empresa-sa');
  });

  it('normalizeLinkedInCompanyUrl rejects co.linkedin.com/in/<person> — still a person profile', () => {
    const result = normalizeLinkedInCompanyUrl('https://co.linkedin.com/in/john-doe');
    assert.equal(result.rejected, true);
    assert.ok(result.rejectReason?.includes('/in/'), `expected /in/ reject reason, got ${result.rejectReason}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 1c — Non-company paths rejected regardless of maxResultsPerQuery
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 1c — non-company paths always rejected', () => {
  const NON_COMPANY_URLS = [
    'https://www.linkedin.com/in/john-doe',
    'https://www.linkedin.com/jobs/view/123456',
    'https://www.linkedin.com/school/mit',
    'https://www.linkedin.com/showcase/acme-showcase',
    'https://www.linkedin.com/feed/',
    'https://www.linkedin.com/posts/acme_foo-bar',
    'https://www.linkedin.com/pulse/some-article',
    'https://www.linkedin.com/search/results/companies/',
    'https://www.linkedin.com/login',
    'https://www.linkedin.com/signup',
  ];

  for (const url of NON_COMPANY_URLS) {
    it(`rejects: ${url}`, async () => {
      const provider: LinkedInSearchProviderFn = async () => [url];
      const logger = makeCapturingLogger();

      const output = await runControlledLinkedInCompanySearch(
        [makeCandidate()],
        TAVILY_CONFIG_3,
        provider,
        CHECKED_AT,
        {
          usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
          usageLoggerFn: logger.fn,
        },
      );

      const status = output.results[0].enrichment.status;
      assert.ok(
        status === 'rejected' || status === 'not_found',
        `URL "${url}" should be rejected or not_found, got status="${status}"`,
      );
      assert.equal(output.batchMetadata.found_count, 0, 'non-company URL must not increment found_count');
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 1d — maxResultsPerQuery=3 still logs 1 credit per query
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 1d — maxResultsPerQuery=3 logs 1 credit per query (not 3)', () => {
  it('usage log records max_results=3 but 1 credit (basic search billing)', async () => {
    const provider: LinkedInSearchProviderFn = async () => [
      'https://www.linkedin.com/company/acme-co',
      'https://www.linkedin.com/company/acme-co-alt',
      'https://www.linkedin.com/posts/acme_foo',
    ];
    const logger = makeCapturingLogger();

    await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      TAVILY_CONFIG_3,
      provider,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: logger.fn,
      },
    );

    assert.equal(logger.payloads.length, 1, 'exactly 1 usage log per query call');
    const logged = logger.payloads[0];
    assert.equal(logged.max_results, 3, 'max_results field reflects config');
    assert.equal(logged.estimated_cost_usd, TAVILY_UNIT_COST, '1 credit cost regardless of max_results');
  });

  it('3 candidates → at most 3 usage logs (one per provider call)', async () => {
    const provider: LinkedInSearchProviderFn = async () => [
      'https://www.linkedin.com/company/foo',
      'https://www.linkedin.com/posts/foo_bar',
    ];
    const logger = makeCapturingLogger();

    await runControlledLinkedInCompanySearch(
      [
        makeCandidate({ name: 'Alpha SAS', domain: 'alpha.co' }),
        makeCandidate({ name: 'Beta SAS', domain: 'beta.co' }),
        makeCandidate({ name: 'Gamma SAS', domain: 'gamma.co' }),
      ],
      TAVILY_CONFIG_3,
      provider,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: logger.fn,
      },
    );

    assert.ok(logger.payloads.length <= 3, 'maxPerBatch=3 caps usage logs to 3');
    for (const p of logger.payloads) {
      assert.equal(p.max_results, 3);
      assert.equal(p.estimated_cost_usd, TAVILY_UNIT_COST);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FIX 2 — readWizardConsumedCreditsFromDb scopes to multi_query_web_search
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 2 — readWizardConsumedCreditsFromDb excludes linkedin_company_search logs', () => {
  /**
   * Simulates a batch with:
   *   16 rows operation_key='multi_query_web_search' each with credits_used=1
   *    3 rows operation_key='linkedin_company_search' each with credits_used=1
   *
   * The function must return 16 (only multi_query rows), not 19.
   */
  it('returns 16 for 16 discovery rows + 3 linkedin rows in the batch', async () => {
    const discoveryRows = Array.from({ length: 16 }, () => ({ credits_used: 1 }));

    const fakeDb = {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          eq: (_col1: string, _val1: string) => ({
            eq: (_col2: string, _val2: string) => ({
              eq: (_col3: string, val3: string) => {
                // Only return rows when operation_key='multi_query_web_search'
                const rows = val3 === 'multi_query_web_search' ? discoveryRows : [];
                return Promise.resolve({ data: rows, error: null });
              },
            }),
          }),
        }),
      }),
    };

    const result = await readWizardConsumedCreditsFromDb(BATCH_ID, fakeDb as Parameters<typeof readWizardConsumedCreditsFromDb>[1]);
    assert.equal(result, 16, 'credits_used_logged must be 16 (discovery only), not 19');
  });

  it('returns null when no multi_query_web_search rows exist (even if linkedin rows do)', async () => {
    const fakeDb = {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          eq: (_col1: string, _val1: string) => ({
            eq: (_col2: string, _val2: string) => ({
              eq: (_col3: string, _val3: string) => {
                // Simulate: no multi_query rows, but linkedin rows exist
                return Promise.resolve({ data: [], error: null });
              },
            }),
          }),
        }),
      }),
    };

    const result = await readWizardConsumedCreditsFromDb(BATCH_ID, fakeDb as Parameters<typeof readWizardConsumedCreditsFromDb>[1]);
    assert.equal(result, null, 'zero rows must return null (unverifiable, not zero)');
  });
});
